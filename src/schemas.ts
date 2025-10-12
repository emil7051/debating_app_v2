import { z } from "zod";

/** Primitive link metadata used throughout lesson packs */
export const SourceLink = z.object({
  title: z.string(),
  url: z.string().url(),
  note: z.string().nullable().optional(),
});
export type SourceLink = z.infer<typeof SourceLink>;

/** Example blocks capture concrete case studies with provenance */
export const Example = z.object({
  label: z.string(),
  whatHappened: z.string(),
  whyItMatters: z.string(),
  howToUse: z.array(z.string()),
  sources: z.array(SourceLink).min(1),
});
export type Example = z.infer<typeof Example>;

export const PreprocessorOutput = z.object({
  title: z.string(),       // e.g., "Environment — Complete Debating Lesson Pack"
  markdown: z.string(),    // normalized, concise Markdown
});
export type TPreprocessorOutput = z.infer<typeof PreprocessorOutput>;

/** Core argumentative unit used in strategist / synthesis outputs */
export const Argument = z.object({
  claim: z.string(),
  mechanism: z.string(),
  impacts: z.array(z.string()).min(1),
  stakeholders: z.array(z.string()).nullable().optional(),
  comparative: z.string().nullable().optional(),
  preempts: z.array(z.string()).nullable().optional(),
  examples: z.array(Example).nullable().optional(),
});
export type Argument = z.infer<typeof Argument>;

/** Framework that pins down burdens, metrics, and shared assumptions */
export const Framework = z.object({
  burden: z.string(),
  metric: z.string(),
  assumptions: z.array(z.string()),
  theories: z.array(z.string()),
  tests: z.array(z.string()).nullable().optional(),
});
export type Framework = z.infer<typeof Framework>;

/** Weighing layer keeps adjudication advice consistent across outputs */
export const Weighing = z.object({
  method: z.string(),
  adjudicatorNotes: z.array(z.string()),
  commonPitfalls: z.array(z.string()),
  POIAdvice: z.array(z.string()).nullable().optional(),
  whipAdvice: z.array(z.string()).nullable().optional(),
});
export type Weighing = z.infer<typeof Weighing>;

/** === Final pack shape === */
export const LessonPack = z.object({
  title: z.string(),
  motionOrTopic: z.string().nullable().optional(),
  context: z.string().nullable().optional(),
  firstPrinciples: Framework,
  govCase: z.array(Argument).min(1),
  oppCase: z.array(Argument).min(1),
  counterCases: z.array(Argument).nullable().optional(),
  extensions: z.array(z.string()),
  rebuttalLadders: z
    .array(
      z.object({
        target: z.string(),
        ladder: z.array(z.string()),
      })
    )
    .nullable()
    .optional(),
  weighing: Weighing,
  drills: z.array(z.string()),
  glossary: z
    .array(
      z.object({
        term: z.string(),
        def: z.string(),
      })
    )
    .nullable()
    .optional(),
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
  govCase: z.array(Argument).min(3).max(6),
  oppCase: z.array(Argument).min(3).max(6),
  extensions: z.array(z.string()).min(2).max(6),
});
export type TStrategistOutput = z.infer<typeof StrategistOutput>;

export const ResearchAdjOutput = z.object({
  examplesBank: z.array(Example).min(5).max(12),
  weighing: Weighing,
  drills: z.array(z.string()).min(2).max(8),
});
export type TResearchAdjOutput = z.infer<typeof ResearchAdjOutput>;
