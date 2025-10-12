import fs from "node:fs";
import path from "node:path";

import { globby } from "globby";
import OpenAI from "openai";
import pdfParse from "pdf-parse";

import {
  AgentInput,
  AgentRuntimeConfig,
  runPreprocessorAgent,
  runResearchAgent,
  runStrategistAgent,
  runSynthesisAgent,
} from "./agents";
import { appConfig } from "./config";
import { LessonPack } from "./schemas";

const MAX_TEXT_CHARS = 18000;

export type DocumentKind = "pdf" | "markdown" | "raw-notes";

export interface PreprocessedDocument {
  absolutePath: string;
  filename: string;
  kind: DocumentKind;
  text: string;
  contextHint: string | null;
}

export interface FileProcessingResult {
  file: string;
  success: boolean;
  error?: string;
  googleDocUrl?: string;
}

function detectKind(filePath: string): DocumentKind {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".pdf") return "pdf";
  if (extension === ".md" || extension === ".markdown") return "markdown";
  return "raw-notes";
}

async function readDocument(filePath: string): Promise<string> {
  const kind = detectKind(filePath);

  if (kind === "pdf") {
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  }

  return fs.readFileSync(filePath, "utf8");
}

function extractContextHint(text: string): string | null {
  const headingMatch = text.match(/^#\s{0,3}(.+)$/m);
  if (headingMatch && headingMatch[1]) {
    return headingMatch[1].trim();
  }

  const firstSentence = text.trim().split(/\.?\s+/)[0];
  return firstSentence.length > 5 ? firstSentence.slice(0, 120) : null;
}

function preprocessText(rawText: string): string {
  const cleaned = rawText.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n");
  if (cleaned.length <= MAX_TEXT_CHARS) {
    return cleaned;
  }

  return cleaned.slice(0, MAX_TEXT_CHARS) + "\n\n[TRUNCATED]";
}

export async function preprocessDocument(filePath: string): Promise<PreprocessedDocument> {
  const text = await readDocument(filePath);
  const normalized = preprocessText(text);
  const kind = detectKind(filePath);

  return {
    absolutePath: filePath,
    filename: path.basename(filePath),
    kind,
    text: normalized,
    contextHint: extractContextHint(normalized),
  };
}

async function discoverInputFiles(inputDir: string): Promise<string[]> {
  const files = await globby(["**/*.{pdf,md,markdown}"], {
    cwd: inputDir,
    absolute: true,
    dot: false,
  });

  return files.sort();
}

function buildAgentInput(doc: PreprocessedDocument): AgentInput {
  return {
    filename: doc.filename,
    documentText: doc.text,
    contextHint: doc.contextHint,
  };
}

async function processSingleFile(params: {
  doc: PreprocessedDocument;
  runtime: AgentRuntimeConfig;
}): Promise<FileProcessingResult> {
  const { doc, runtime } = params;

  try {
    // Step 0: Read & simple normalization (existing)
    const initialAgentInput = buildAgentInput(doc);

    // Step 1: Preprocessor agent (NEW) — produce { title, markdown }
    const pre = await runPreprocessorAgent(runtime, initialAgentInput);

    // Build downstream input from the Preprocessor output
    const normalizedInput: AgentInput = {
      filename: pre.title || initialAgentInput.filename,
      documentText: pre.markdown,
      contextHint: pre.title || initialAgentInput.contextHint,
    };

    // Step 2 & 3: Strategist + Research (in parallel), now consuming normalized markdown
    const [strategist, researcher] = await Promise.all([
      runStrategistAgent(runtime, normalizedInput),
      runResearchAgent(runtime, normalizedInput),
    ]);

    // Step 4: Synthesis/QA (NEW signature includes preprocessor content)
    const pack = await runSynthesisAgent({
      runtime,
      preprocessor: pre,
      strategist,
      researcher,
      input: normalizedInput,
    });

    const finalPack = LessonPack.parse({
      ...pack,
      inputMetadata: {
        filename: doc.filename,
        kind: doc.kind,
      },
    });

    const publishResult = await publishLessonPack(appConfig.google, finalPack);

    return {
      file: doc.absolutePath,
      success: true,
      googleDocUrl: publishResult?.docUrl,
    };
  } catch (error) {
    return {
      file: doc.absolutePath,
      success: false,
      error: (error as Error).message,
    };
  }
}

import { publishLessonPack } from "./googleDocs";

export async function runPipeline(
  client: OpenAI,
  opts?: { inputDir?: string }
): Promise<FileProcessingResult[]> {
  const runtime: AgentRuntimeConfig = {
    client,
    models: appConfig.models,
  };

  const inputDir = opts?.inputDir ?? appConfig.notesInputDir;
  const files = await discoverInputFiles(inputDir);
  if (files.length === 0) {
    console.warn(`No input files found in ${inputDir}`);
    return [];
  }

  const results: FileProcessingResult[] = [];
  for (const file of files) {
    console.log(`Processing ${path.relative(process.cwd(), file)}...`);
    const doc = await preprocessDocument(file);
    const result = await processSingleFile({ doc, runtime });
    if (!result.success && result.error) {
      console.error(`Failed to process ${doc.filename}: ${result.error}`);
    }
    results.push(result);
  }

  return results;
}
