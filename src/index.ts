import { createOpenAIClient } from "./config";
import { runPipeline } from "./pipeline";

async function main() {
  const client = createOpenAIClient();
  const results = await runPipeline(client);

  if (results.length === 0) {
    console.log("No lesson packs were generated.");
    return;
  }

  console.log("\nRun summary:\n");
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
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exitCode = 1;
});
