import { z } from "zod";

/** === Atomic example with provenance === */
export const SourceLink = z.object({
  title: z.string(),
  url: z.string().url(),
  note: z.string().nullable().optional(),
});

export const Example = z.object({
  label: z.string(),            // e.g., "Singapore POFMA (2019–)"
  whatHappened: z.string(),
  whyItMatters: z.string(),
  howToUse: z.array(z.string()),// bullet applications in debate
  sources: z.array(SourceLink).min(1),
});

export const Argument = z.object({
  claim: z.string(),
  mechanism: z.string(),        // how the world changes
  impacts: z.array(z.string()).min(1),
  stakeholders: z.array(z.string()).nullable().optional(),
  comparative: z.string().nullable().optional(), // vs other world / status quo
  preempts: z.array(z.string()).nullable().optional(), // likely replies and answers
  examples: z.array(Example).nullable().optional(),
});

export const Framework = z.object({
  burden: z.string(),           // what must be proven
  metric: z.string(),           // how to weigh (harms/benefits, rights, etc.)
  assumptions: z.array(z.string()),
  theories: z.array(z.string()),     // utilitarianism, deontology, etc.
  tests: z.array(z.string()).nullable().optional(), // proportionality, rights threshold
});

export const Weighing = z.object({
  method: z.string(), // magnitude, probability, reversibility, time horizon
  adjudicatorNotes: z.array(z.string()),
  commonPitfalls: z.array(z.string()),
  POIAdvice: z.array(z.string()).nullable().optional(),
  whipAdvice: z.array(z.string()).nullable().optional(),
});

export const WhenToUse = z.object({
  scenario: z.string(),        // e.g., "Opp claims tech-only solvency"
  why: z.string()              // short rationale
});

export const Argument = Argument.extend({
  whenToUse: z.array(WhenToUse).optional(),
  australsNotes: z.array(z.string()).optional(), // presentation tips for 1st/2nd/3rd speakers
  weighingCues: z.array(z.string()).optional(),  // 1–3 bullets: how to weigh THIS argument
  definitions: z.array(z.object({ term: z.string(), def: z.string() })).optional()
});

export const ExecutiveSummary = z.object({
  overview: z.array(z.string()).min(3), // paragraphs (aim ~2–3 pages total)
  keyConcepts: z.array(z.object({
    concept: z.string(),
    explanation: z.string(),
    example: z.string().nullable(),
    whenToUse: z.array(z.string())
  })).min(4),
  keyClashes: z.array(z.string()).min(3) // “value of nature”, “equity vs speed”, etc.
});

export const LessonPack = LessonPack.extend({
  executiveSummary: ExecutiveSummary.optional()
});

export const SourceLink = SourceLink; // keep

/** === Final pack shape === */
export const LessonPack = z.object({
  title: z.string(),
  motionOrTopic: z.string().nullable().optional(),
  context: z.string().nullable().optional(), // background required to be self-contained
  firstPrinciples: Framework,
  govCase: z.array(Argument).min(1),
  oppCase: z.array(Argument).min(1),
  counterCases: z.array(Argument).nullable().optional(), // alt models/neg worlds
  extensions: z.array(z.string()), // spaces for CG/CO or 3rd in Australs
  rebuttalLadders: z.array(z.object({
    target: z.string(),           // argument it targets
    ladder: z.array(z.string()),  // stepwise refutation
  })).nullable().optional(),
  weighing: Weighing,
  drills: z.array(z.string()), // exercises/homework
  glossary: z.array(z.object({ term: z.string(), def: z.string() })).nullable().optional(),
  examplesBank: z.array(Example).min(3),
  sources: z.array(SourceLink).min(3),
  inputMetadata: z.object({
    filename: z.string().nullable(),
    kind: z.enum(["pdf", "markdown", "transcript", "raw-notes"]).nullable(),
  }),
});
export type TLessonPack = z.infer<typeof LessonPack>;

/** === Agent output helper schemas === */
export const StrategistOutput = z.object({
  motionOrTopic: z.string().nullable().optional(),
  context: z.string().nullable().optional(),
  firstPrinciples: Framework,
  govCase: z.array(Argument).min(2).max(6),
  oppCase: z.array(Argument).min(2).max(6),
  extensions: z.array(z.string()).min(2).max(6),
});
export type TStrategistOutput = z.infer<typeof StrategistOutput>;

export const ResearchAdjOutput = z.object({
  examplesBank: z.array(Example).min(3).max(6),
  weighing: Weighing,
  drills: z.array(z.string()).min(2).max(4),
});
export type TResearchAdjOutput = z.infer<typeof ResearchAdjOutput>;
