import fs from "node:fs";
import path from "node:path";

import { globby } from "globby";
import OpenAI from "openai";
import pdfParse from "pdf-parse";

import { AgentInput, AgentRuntimeConfig, runResearchAgent, runStrategistAgent, runSynthesisAgent } from "./agents";
import { appConfig } from "./config";
import { publishLessonPack } from "./googleDocs";
import { LessonPack } from "./schemas";

function resolveNumericEnv(
  varValue: string | undefined,
  defaultValue: number,
  envVarName: string
): number {
  if (varValue === undefined) {
    return defaultValue;
  }

  const parsed = Number(varValue);
  if (!Number.isFinite(parsed)) {
    console.warn(
      `Invalid value for ${envVarName} ("${varValue}"). Falling back to default of ${defaultValue}.`
    );
    return defaultValue;
  }

  return parsed;
}

const MAX_TEXT_CHARS = resolveNumericEnv(process.env.MAX_TEXT_CHARS, 18000, "MAX_TEXT_CHARS");
const MAX_FILE_SIZE_BYTES = resolveNumericEnv(
  process.env.MAX_FILE_SIZE_BYTES,
  50 * 1024 * 1024,
  "MAX_FILE_SIZE_BYTES"
); // 50MB default

export type DocumentKind = "pdf" | "markdown" | "raw-notes";

export interface PreprocessedDocument {
  absolutePath: string;
  filename: string;
  kind: DocumentKind;
  text: string;
  contextHint: string | null;
  wasTruncated?: boolean;
  originalLength?: number;
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

/**
 * Validate file before processing to catch issues early
 * @throws Error if file is invalid
 */
function validateFile(filePath: string): void {
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  // Check if it's actually a file (not a directory)
  const stats = fs.statSync(filePath);
  if (!stats.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }

  // Check file size
  if (stats.size === 0) {
    throw new Error(`File is empty (0 bytes): ${filePath}`);
  }

  if (stats.size > MAX_FILE_SIZE_BYTES) {
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    const maxMB = (MAX_FILE_SIZE_BYTES / (1024 * 1024)).toFixed(2);
    throw new Error(
      `File too large (${sizeMB}MB exceeds limit of ${maxMB}MB): ${filePath}`
    );
  }
}

async function readDocument(filePath: string): Promise<string> {
  // Validate file before attempting to read
  validateFile(filePath);

  const kind = detectKind(filePath);

  if (kind === "pdf") {
    try {
      const buffer = fs.readFileSync(filePath);
      const data = await pdfParse(buffer);

      if (!data.text || data.text.trim().length === 0) {
        throw new Error("PDF contains no extractable text");
      }

      return data.text;
    } catch (error) {
      const message = (error as Error).message;
      throw new Error(
        `Failed to parse PDF "${path.basename(filePath)}": ${message}`
      );
    }
  }

  try {
    const content = fs.readFileSync(filePath, "utf8");
    if (content.trim().length === 0) {
      throw new Error("File contains no text content");
    }
    return content;
  } catch (error) {
    const message = (error as Error).message;
    throw new Error(
      `Failed to read file "${path.basename(filePath)}": ${message}`
    );
  }
}

/**
 * Extract a context hint from the document text
 * Tries to find a meaningful title or first sentence
 */
function extractContextHint(text: string): string | null {
  // Try to match a Markdown heading (# Title)
  const headingMatch = text.match(/^#{1,6}\s+(.+)$/m);
  if (headingMatch && headingMatch[1]) {
    return headingMatch[1].trim().slice(0, 120);
  }

  // Try to extract first sentence (ending with period, question mark, or exclamation)
  const sentenceMatch = text.trim().match(/^(.+?[.!?])\s/);
  if (sentenceMatch && sentenceMatch[1]) {
    const sentence = sentenceMatch[1].trim();
    return sentence.length > 5 ? sentence.slice(0, 120) : null;
  }

  // Fallback: take first line that's not too short
  const firstLine = text.trim().split(/\n/)[0];
  if (firstLine && firstLine.length > 10) {
    return firstLine.slice(0, 120);
  }

  return null;
}

function preprocessText(rawText: string): { text: string; wasTruncated: boolean; originalLength: number } {
  const cleaned = rawText.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n");
  const originalLength = cleaned.length;

  if (cleaned.length <= MAX_TEXT_CHARS) {
    return { text: cleaned, wasTruncated: false, originalLength };
  }

  return {
    text: cleaned.slice(0, MAX_TEXT_CHARS) + "\n\n[TRUNCATED]",
    wasTruncated: true,
    originalLength,
  };
}

export async function preprocessDocument(filePath: string): Promise<PreprocessedDocument> {
  const text = await readDocument(filePath);
  const { text: normalized, wasTruncated, originalLength } = preprocessText(text);
  const kind = detectKind(filePath);

  // Warn about truncation
  if (wasTruncated) {
    const truncatedChars = originalLength - MAX_TEXT_CHARS;
    const truncatedPercent = ((truncatedChars / originalLength) * 100).toFixed(1);
    console.warn(
      `⚠️  "${path.basename(filePath)}" was truncated: ` +
      `${originalLength.toLocaleString()} chars → ${MAX_TEXT_CHARS.toLocaleString()} chars ` +
      `(${truncatedPercent}% lost). Set MAX_TEXT_CHARS environment variable to increase limit.`
    );
  }

  return {
    absolutePath: filePath,
    filename: path.basename(filePath),
    kind,
    text: normalized,
    contextHint: extractContextHint(normalized),
    wasTruncated,
    originalLength,
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
  const agentInput = buildAgentInput(doc);

  try {
    const [strategist, researcher] = await Promise.all([
      runStrategistAgent(runtime, agentInput),
      runResearchAgent(runtime, agentInput),
    ]);

    const pack = await runSynthesisAgent({
      runtime,
      strategist,
      researcher,
      input: agentInput,
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

    try {
      const doc = await preprocessDocument(file);
      const result = await processSingleFile({ doc, runtime });
      if (!result.success && result.error) {
        console.error(`❌ Failed to process ${doc.filename}: ${result.error}`);
      } else {
        console.log(`✅ Successfully processed ${doc.filename}`);
      }
      results.push(result);
    } catch (error) {
      // Catch preprocessing errors (file validation, reading, parsing)
      const errorMessage = (error as Error).message;
      console.error(`❌ Failed to preprocess ${path.basename(file)}: ${errorMessage}`);
      results.push({
        file,
        success: false,
        error: errorMessage,
      });
    }
  }

  return results;
}
