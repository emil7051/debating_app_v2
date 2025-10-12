import OpenAI from "openai";

import {
  LessonPack,
  StrategistOutput,
  TLessonPack,
  TResearchAdjOutput,
  TStrategistOutput,
  ResearchAdjOutput,
  PreprocessorOutput,
  TPreprocessorOutput,
} from "./schemas";

export type AgentRuntimeConfig = {
  client: OpenAI;
  models: {
    preprocessor: string;
    strategist: string;
    research: string;
    synthesizer: string;
  };
};

export interface AgentInput {
  filename: string;
  documentText: string;
  contextHint?: string | null;
}

const MAX_ATTEMPTS_DEFAULT = Math.max(
  1,
  Number(process.env.JSON_MAX_ATTEMPTS ?? 5)
);

// ===== Shared format hints (kept from existing app) =====
const STRATEGIST_FORMAT_HINT = `{
  "motionOrTopic": string | null,
  "context": string | null,
  "firstPrinciples": {
    "burden": string,
    "metric": string,
    "assumptions": string[],
    "theories": string[],
    "tests": string[] | null
  },
  "govCase": [Argument, ...],
  "oppCase": [Argument, ...],
  "extensions": string[]
}

Argument = {
  "claim": string,
  "mechanism": string,
  "impacts": string[],
  "stakeholders": string[] | null,
  "comparative": string | null,
  "preempts": string[] | null,
  "examples": Example[] | null
}

Example = {
  "label": string,
  "whatHappened": string,
  "whyItMatters": string,
  "howToUse": string[],
  "sources": [{ "title": string, "url": string, "note": string | null }]
}

Every key must be present. Use [] for empty arrays and null where allowed.`;

const RESEARCH_FORMAT_HINT = `{
  "examplesBank": Example[],
  "weighing": {
    "method": string,
    "adjudicatorNotes": string[],
    "commonPitfalls": string[],
    "POIAdvice": string[] | null,
    "whipAdvice": string[] | null
  },
  "drills": string[]
}

Example = {
  "label": string,
  "whatHappened": string,
  "whyItMatters": string,
  "howToUse": string[],
  "sources": [{ "title": string, "url": string, "note": string | null }]
}

Return JSON only.`;

const LESSON_FORMAT_HINT = `{
  "title": string,
  "motionOrTopic": string | null,
  "context": string | null,
  "firstPrinciples": {
    "burden": string,
    "metric": string,
    "assumptions": string[],
    "theories": string[],
    "tests": string[] | null
  },
  "govCase": [Argument, ...],
  "oppCase": [Argument, ...],
  "counterCases": Argument[] | null,
  "extensions": string[],
  "rebuttalLadders": [{ "target": string, "ladder": string[] }] | null,
  "weighing": {
    "method": string,
    "adjudicatorNotes": string[],
    "commonPitfalls": string[],
    "POIAdvice": string[] | null,
    "whipAdvice": string[] | null
  },
  "drills": string[],
  "glossary": [{ "term": string, "def": string }] | null,
  "examplesBank": Example[],
  "sources": [{ "title": string, "url": string, "note": string | null }],
  "inputMetadata": { "filename": string | null, "kind": "pdf" | "markdown" | "transcript" | "raw-notes" | null }
}

Argument and Example match the definitions above. Include all keys, even when arrays are empty.`;

// ===== NEW: shared debate context lifted from your earlier workflow =====
const sharedDebateContext = `
You are a world-class debate coach and adjudicator across British Parliamentary (WUDC) and Australasian formats.
Be strict about:
- explicit burdens/metrics and actor analysis,
- mechanism chains → plausible impacts,
- comparative worlds and extension space (OG/OO/CG/CO),
- no fabricated facts: any new factual claim MUST include a real, reputable URL.
When in doubt, err on explainability for senior high-school students, not policy jargon.
`;

// ===== Internal helper to extract content safely =====
type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function extractMessageContent(message: OpenAI.Chat.Completions.ChatCompletionMessage): string {
  const rawContent = (message as any)?.content;
  if (typeof rawContent === "string") {
    return rawContent;
  }
  if (!rawContent || !Array.isArray(rawContent)) {
    return "";
  }
  return rawContent
    .map((part: any) => {
      if (typeof part === "string") {
        return part;
      }
      if (part && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .join("");
}

async function callJsonModel<T>(params: {
  client: OpenAI;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  schema: { parse: (value: unknown) => T };
  formatHint?: string;
  maxAttempts?: number;
}): Promise<T> {
  const { client, model, systemPrompt, userPrompt, schema, formatHint, maxAttempts = MAX_ATTEMPTS_DEFAULT } = params;

  const systemMessage: ChatMessage = {
    role: "system",
    content: formatHint
      ? `${systemPrompt}\n\nREQUIRED JSON FORMAT (no commentary, no extra keys):\n${formatHint}`
      : systemPrompt,
  };

  const messages: ChatMessage[] = [
    systemMessage,
    { role: "user", content: userPrompt },
  ];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const completion = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages,
    });

    const message = completion.choices[0]?.message;
    if (!message) {
      throw new Error("OpenAI response did not contain a message to parse");
    }

    const content = extractMessageContent(message);

    try {
      const parsed = JSON.parse(content);
      return schema.parse(parsed);
    } catch (error) {
      const detail =
        typeof (error as any)?.issues !== "undefined"
          ? JSON.stringify((error as any).issues)
          : (error as Error).message;

      if (attempt === maxAttempts) {
        throw new Error(
          `Failed to parse OpenAI response as JSON after ${maxAttempts} attempts: ${detail}\nRaw response: ${content}`
        );
      }

      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content:
          `The previous JSON was invalid because: ${detail}. ` +
          "Reply again with strictly valid JSON that matches the required format.",
      });
    }
  }

  throw new Error("Failed to obtain a valid JSON response after multiple attempts");
}

// ===== NEW: Preprocessor agent =====
export async function runPreprocessorAgent(
  runtime: AgentRuntimeConfig,
  input: AgentInput
): Promise<TPreprocessorOutput> {
  const PREPROCESSOR_FORMAT_HINT = `{
    "title": string,
    "markdown": string
  }`;

  const systemPrompt = `${sharedDebateContext}
Normalize the input (pdf/markdown/text) into concise Markdown:
- preserve headings/lists/tables
- strip filler, timestamps, and disfluencies
- keep any explicit adjudicator feedback verbatim in a blockquote section
Return a short, descriptive title if possible. Return JSON only.`;

  const userPrompt = `Document name: ${input.filename}
${input.contextHint ? `Context hint: ${input.contextHint}\n` : ""}

Raw text to normalize:
${input.documentText}`;

  return callJsonModel({
    client: runtime.client,
    model: runtime.models.preprocessor,
    systemPrompt,
    userPrompt,
    schema: PreprocessorOutput,
    formatHint: PREPROCESSOR_FORMAT_HINT,
  });
}

// ===== Strategist agent (prompt aligned to your earlier version) =====
export async function runStrategistAgent(
  runtime: AgentRuntimeConfig,
  input: AgentInput
): Promise<TStrategistOutput> {
  const systemPrompt = `${sharedDebateContext}
From the normalized notes, produce:
- First principles (burden, metric, assumptions, theories, optional tests)
- 3–5 GOV arguments and 3–5 OPP arguments (claim → mechanism → stakeholders → impacts → preempts → examples if already present)
- 2–6 extension lanes for BP closing teams or Australs 3rd speaker
- Optional: motion/topic and compact context
Do not invent factual examples here; reference only what's in the notes.`;

  const userPrompt = `Document name: ${input.filename}
${input.contextHint ? `Context hint: ${input.contextHint}\n` : ""}
Normalized notes (Markdown):
${input.documentText}`;

  return callJsonModel({
    client: runtime.client,
    model: runtime.models.strategist,
    systemPrompt,
    userPrompt,
    schema: StrategistOutput,
    formatHint: STRATEGIST_FORMAT_HINT,
  });
}

// ===== Research & Adjudication agent (prompt aligned to your earlier version) =====
export async function runResearchAgent(
  runtime: AgentRuntimeConfig,
  input: AgentInput
): Promise<TResearchAdjOutput> {
  const systemPrompt = `${sharedDebateContext}
Curate diverse, verifiable examples with working URLs (jurisdictions/time periods/scales varied).
For each example: what happened, why it matters, and how to use in debate. Include at least one reputable source URL.
Provide adjudicator weighing (magnitude, probability, reversibility, time horizon), POI and Whip advice if relevant, and 2–8 drills.
Do not include paywalled or dead links if you can avoid it.`;

  const userPrompt = `Document name: ${input.filename}
${input.contextHint ? `Context hint: ${input.contextHint}\n` : ""}
Normalized notes (Markdown):
${input.documentText}`;

  return callJsonModel({
    client: runtime.client,
    model: runtime.models.research,
    systemPrompt,
    userPrompt,
    schema: ResearchAdjOutput,
    formatHint: RESEARCH_FORMAT_HINT,
  });
}

// ===== Synthesis/QA agent (prompt aligned to your earlier version) =====
export async function runSynthesisAgent(params: {
  runtime: AgentRuntimeConfig;
  preprocessor: TPreprocessorOutput;
  strategist: TStrategistOutput;
  researcher: TResearchAdjOutput;
  input: AgentInput;
}): Promise<TLessonPack> {
  const { runtime, preprocessor, strategist, researcher, input } = params;

  const systemPrompt = `${sharedDebateContext}
Merge strategist + research outputs into a single coherent LessonPack suitable for immediate teaching.
Rules:
- Only include factual content that originates from the Research agent (with sources) or was present in the input.
- Dedupe overlapping examples and sources.
- Create 2–3 rebuttal ladders that target the most central opposing claims.
- Keep a concise tone; ensure sections are directly usable by senior high-school students.`;

  const userPrompt = JSON.stringify(
    {
      filename: input.filename,
      contextHint: input.contextHint,
      sourceMarkdown: preprocessor.markdown,
      preprocessor,
      strategist,
      researcher,
    },
    null,
    2
  );

  return callJsonModel({
    client: runtime.client,
    model: runtime.models.synthesizer,
    systemPrompt,
    userPrompt,
    schema: LessonPack,
    formatHint: LESSON_FORMAT_HINT,
  });
}
