import fs from "node:fs";
import path from "node:path";

import dotenv from "dotenv";
import OpenAI from "openai";
import { z } from "zod";

const ROOT_DIR = path.resolve(__dirname, "..");
const ENV_FILES = [
  path.join(ROOT_DIR, ".env.local"),
  path.join(ROOT_DIR, ".env"),
];

for (const file of ENV_FILES) {
  if (fs.existsSync(file)) {
    dotenv.config({ path: file });
  }
}

type ServiceAccountCredentials = {
  type: "service_account";
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  token_uri: string;
};

type GoogleMode = "service-account" | "oauth" | "none";

type GoogleConfig =
  | {
      mode: "service-account";
      exportFolderId?: string;
      serviceAccount: ServiceAccountCredentials;
    }
  | {
      mode: "oauth";
      exportFolderId?: string;
      oauth: {
        clientId: string;
        clientSecret: string;
        redirectUri: string;
        tokenPath: string;
      };
    }
  | {
      mode: "none";
    };

const envSchema = z
  .object({
    OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
    NOTES_INPUT_DIR: z.string().trim().default("for_processing"),
    OPENAI_MODEL_STRATEGIST: z.string().trim().default("gpt-5-mini-2025-08-07"),
    OPENAI_MODEL_RESEARCH: z.string().trim().default("gpt-5-mini-2025-08-07"),
    OPENAI_MODEL_SYNTHESIZER: z.string().trim().default("gpt-5-mini-2025-08-07"),
    GOOGLE_CREDENTIALS_JSON: z.string().trim().optional(),
    GOOGLE_CREDENTIALS_JSON_PATH: z.string().trim().optional(),
    GOOGLE_EXPORT_FOLDER_ID: z.string().trim().optional(),
    GOOGLE_OAUTH_CLIENT_ID: z.string().trim().optional(),
    GOOGLE_OAUTH_CLIENT_SECRET: z.string().trim().optional(),
    GOOGLE_OAUTH_REDIRECT_URI: z.string().trim().optional(),
    GOOGLE_OAUTH_TOKEN_PATH: z.string().trim().optional(),
  })
  .transform((values) => ({
    ...values,
    NOTES_INPUT_DIR: path.resolve(ROOT_DIR, values.NOTES_INPUT_DIR),
    GOOGLE_CREDENTIALS_JSON_PATH: values.GOOGLE_CREDENTIALS_JSON_PATH
      ? path.resolve(ROOT_DIR, values.GOOGLE_CREDENTIALS_JSON_PATH)
      : undefined,
    GOOGLE_OAUTH_TOKEN_PATH: values.GOOGLE_OAUTH_TOKEN_PATH
      ? path.resolve(ROOT_DIR, values.GOOGLE_OAUTH_TOKEN_PATH)
      : undefined,
  }));

const parsedEnv = envSchema.parse(process.env);

function normalizePrivateKey(privateKey: string): string {
  if (privateKey.includes("\n")) {
    return privateKey;
  }
  return privateKey.replace(/\\n/g, "\n");
}

function parseServiceAccount(json: string): ServiceAccountCredentials {
  const schema = z.object({
    type: z.literal("service_account"),
    project_id: z.string(),
    private_key_id: z.string(),
    private_key: z.string(),
    client_email: z.string(),
    client_id: z.string(),
    token_uri: z.string(),
  });

  const data = schema.parse(JSON.parse(json));
  return {
    ...data,
    private_key: normalizePrivateKey(data.private_key),
  };
}

function loadServiceAccount(
  env: z.infer<typeof envSchema>
): ServiceAccountCredentials | undefined {
  if (env.GOOGLE_CREDENTIALS_JSON) {
    return parseServiceAccount(env.GOOGLE_CREDENTIALS_JSON);
  }

  if (env.GOOGLE_CREDENTIALS_JSON_PATH) {
    if (!fs.existsSync(env.GOOGLE_CREDENTIALS_JSON_PATH)) {
      throw new Error(
        `Expected GOOGLE_CREDENTIALS_JSON_PATH to point to an existing file, but "${env.GOOGLE_CREDENTIALS_JSON_PATH}" was not found.`
      );
    }

    const fileContents = fs.readFileSync(env.GOOGLE_CREDENTIALS_JSON_PATH, "utf8");
    return parseServiceAccount(fileContents);
  }

  const b64 = process.env.GOOGLE_CREDENTIALS_BASE64;
  if (b64) {
    const decoded = Buffer.from(b64, "base64").toString("utf8");
    return parseServiceAccount(decoded);
  }

  const appCredsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (appCredsPath) {
    const resolved = path.resolve(ROOT_DIR, appCredsPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(
        `Expected GOOGLE_APPLICATION_CREDENTIALS to point to an existing file, but "${resolved}" was not found.`
      );
    }
    const fileContents = fs.readFileSync(resolved, "utf8");
    return parseServiceAccount(fileContents);
  }

  return undefined;
}

function loadGoogleConfig(env: z.infer<typeof envSchema>): GoogleConfig {
  const serviceAccount = loadServiceAccount(env);

  if (serviceAccount) {
    return {
      mode: "service-account",
      exportFolderId: env.GOOGLE_EXPORT_FOLDER_ID || undefined,
      serviceAccount,
    };
  }

  if (
    env.GOOGLE_OAUTH_CLIENT_ID &&
    env.GOOGLE_OAUTH_CLIENT_SECRET &&
    env.GOOGLE_OAUTH_REDIRECT_URI &&
    (env.GOOGLE_OAUTH_TOKEN_PATH || process.env.OAUTH_TOKEN_PATH)
  ) {
    const tokenPath =
      env.GOOGLE_OAUTH_TOKEN_PATH
        ? env.GOOGLE_OAUTH_TOKEN_PATH
        : path.resolve(
            ROOT_DIR,
            process.env.OAUTH_TOKEN_PATH as string
          );
    return {
      mode: "oauth",
      exportFolderId: env.GOOGLE_EXPORT_FOLDER_ID || undefined,
      oauth: {
        clientId: env.GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
        tokenPath: tokenPath,
      },
    };
  }

  return { mode: "none" };
}

export const appConfig = {
  openAiApiKey: parsedEnv.OPENAI_API_KEY,
  notesInputDir: parsedEnv.NOTES_INPUT_DIR,
  models: {
    strategist: parsedEnv.OPENAI_MODEL_STRATEGIST,
    research: parsedEnv.OPENAI_MODEL_RESEARCH,
    synthesizer: parsedEnv.OPENAI_MODEL_SYNTHESIZER,
  },
  google: loadGoogleConfig(parsedEnv),
};

export function createOpenAIClient(): OpenAI {
  return new OpenAI({ apiKey: appConfig.openAiApiKey });
}

export type AppConfig = typeof appConfig;
export type GoogleConfiguration = GoogleConfig;
