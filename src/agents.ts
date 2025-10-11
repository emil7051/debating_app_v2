import OpenAI from "openai";

import {
  LessonPack,
  StrategistOutput,
  TLessonPack,
  TResearchAdjOutput,
  TStrategistOutput,
  ResearchAdjOutput,
} from "./schemas";

export type AgentRuntimeConfig = {
  client: OpenAI;
  models: {
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

const MAX_ATTEMPTS_DEFAULT = 3;

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

export async function runStrategistAgent(
  runtime: AgentRuntimeConfig,
  input: AgentInput
): Promise<TStrategistOutput> {
  const systemPrompt =
    "You are a debating strategist creating structured cases for competitive debate." +
    " Return JSON that exactly matches the provided schema.";

  const userPrompt = `Document name: ${input.filename}\n\n${
    input.contextHint ? `Context hint: ${input.contextHint}\n\n` : ""
  }Source notes:\n${input.documentText}`;

  return callJsonModel({
    client: runtime.client,
    model: runtime.models.strategist,
    systemPrompt,
    userPrompt,
    schema: StrategistOutput,
    formatHint: STRATEGIST_FORMAT_HINT,
  });
}

export async function runResearchAgent(
  runtime: AgentRuntimeConfig,
  input: AgentInput
): Promise<TResearchAdjOutput> {
  const systemPrompt =
    "You are a research adjudicator compiling examples, weighing, and drills for debate prep." +
    " Return JSON that exactly matches the provided schema.";

  const userPrompt = `Document name: ${input.filename}\n\n${
    input.contextHint ? `Context hint: ${input.contextHint}\n\n` : ""
  }Source notes:\n${input.documentText}`;

  return callJsonModel({
    client: runtime.client,
    model: runtime.models.research,
    systemPrompt,
    userPrompt,
    schema: ResearchAdjOutput,
    formatHint: RESEARCH_FORMAT_HINT,
  });
}

export async function runSynthesisAgent(params: {
  runtime: AgentRuntimeConfig;
  strategist: TStrategistOutput;
  researcher: TResearchAdjOutput;
  input: AgentInput;
}): Promise<TLessonPack> {
  const { runtime, strategist, researcher, input } = params;
  const systemPrompt =
    "You are compiling a complete debating lesson pack that will be handed to coaches." +
    " Merge the strategist and research outputs into a single pack." +
    " Ensure all required fields are present and cite examples appropriately.";

  const userPrompt = JSON.stringify(
    {
      filename: input.filename,
      contextHint: input.contextHint,
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
