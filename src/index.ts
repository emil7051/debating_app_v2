import fs from "node:fs";
import path from "node:path";
import { appConfig, createOpenAIClient } from "./config";
import { runPipeline } from "./pipeline";

async function main() {
  const client = createOpenAIClient();
  const cliArg = process.argv.slice(2).find((a) => !a.startsWith("-")) || null;
  const inputDir = cliArg
  ? path.resolve(process.cwd(), cliArg)
  : appConfig.notesInputDir;
  if (!fs.existsSync(inputDir) || !fs.statSync(inputDir).isDirectory()) {
    console.error(`Input directory does not exist: ${inputDir}`);
    process.exitCode = 1;
    return;
  }
  const results = await runPipeline(client, { inputDir });

  if (results.length === 0) {
    console.log("No lesson packs were generated.");
    return;
  }

  // Count successes and failures
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log("\n" + "=".repeat(60));
  console.log("Run Summary");
  console.log("=".repeat(60) + "\n");

  for (const result of results) {
    if (result.success) {
      console.log(`✅ ${result.file}`);
      if (result.googleDocUrl) {
        console.log(`   → ${result.googleDocUrl}`);
      }
    } else {
      console.log(`❌ ${result.file}`);
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`Total: ${results.length} | Success: ${successful} | Failed: ${failed}`);
  console.log("=".repeat(60) + "\n");

  // Exit with non-zero code if any files failed (for CI/CD)
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exitCode = 1;
});
