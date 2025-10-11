import fs from "node:fs";
import path from "node:path";

import { appConfig } from "../src/config";

async function main() {
  const { google } = appConfig;

  if (google.mode === "none") {
    console.log("Google service account not configured (mode=none).");
    return;
  }

  if (google.mode === "oauth") {
    const tokenPath = google.oauth.tokenPath;
    const exists = fs.existsSync(tokenPath);
    console.log(`OAuth credentials${exists ? "" : " not"} found at ${tokenPath}`);
    return;
  }

  const credentials = google.serviceAccount;
  const keyPreview = `${credentials.private_key.slice(0, 40)}…`;

  console.log("Service account configuration detected:");
  console.log(`  project_id: ${credentials.project_id}`);
  console.log(`  client_email: ${credentials.client_email}`);
  console.log(`  private_key: ${keyPreview}`);

  if (appConfig.openAiApiKey.startsWith("sk-")) {
    console.log("OpenAI API key appears set.");
  }

  const fileEnv =
    process.env.GOOGLE_CREDENTIALS_JSON_PATH ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (fileEnv) {
    const resolved = path.resolve(fileEnv);
    console.log(`Credentials sourced from file: ${resolved}`);
    const stats = fs.statSync(resolved);
    console.log(`  size: ${stats.size} bytes`);
    console.log(`  permissions: ${stats.mode.toString(8)}`);
  } else {
    if (process.env.GOOGLE_CREDENTIALS_BASE64) {
      console.log("Credentials sourced from GOOGLE_CREDENTIALS_BASE64 environment variable.");
    } else {
      console.log("Credentials sourced from GOOGLE_CREDENTIALS_JSON environment variable.");
    }
  }
}

main().catch((error) => {
  console.error("Failed to inspect service account configuration:", error);
  process.exitCode = 1;
});
