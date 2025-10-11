import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

import { google } from "googleapis";

import { appConfig } from "../src/config";

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    })
  );
}

async function main() {
  const googleConfig = appConfig.google;
  if (googleConfig.mode !== "oauth") {
    throw new Error("OAuth client configuration not detected. Set GOOGLE_OAUTH_* variables.");
  }

  const {
    clientId,
    clientSecret,
    redirectUri,
    tokenPath,
  } = googleConfig.oauth;

  const oauth2Client = new google.auth.OAuth2({
    clientId,
    clientSecret,
    redirectUri,
  });

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/drive.file",
    ],
    prompt: "consent",
  });

  console.log("Visit this URL to authorise the app:");
  console.log(authUrl);
  const code = await prompt("Enter the verification code: ");
  if (!code) {
    throw new Error("No verification code provided");
  }

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  const resolvedTokenPath = path.resolve(tokenPath);
  fs.mkdirSync(path.dirname(resolvedTokenPath), { recursive: true });
  fs.writeFileSync(resolvedTokenPath, JSON.stringify(tokens, null, 2), {
    mode: 0o600,
  });

  console.log(`Token saved to ${resolvedTokenPath}`);
}

main().catch((error) => {
  console.error("Failed to obtain OAuth token:", error);
  process.exitCode = 1;
});
