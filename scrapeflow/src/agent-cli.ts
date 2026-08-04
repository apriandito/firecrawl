#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { runAgent } from "./agent/runner.js";

/**
 * Natural-language agent CLI:
 *   OPENAI_API_KEY=... npm run agent -- "berita ekonomi syariah di CNBC ke Excel"
 * Writes any .xlsx the agent produces to the current directory.
 */
async function main() {
  const task = process.argv.slice(2).join(" ").trim();
  if (!task) {
    console.error('usage: agent "<natural-language task>"');
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error("error: OPENAI_API_KEY is required for the agent.");
    process.exit(1);
  }

  console.error(`[agent] task: ${task}`);
  const result = await runAgent({ task });

  for (const f of result.files) {
    await writeFile(f.name, f.bytes);
    console.error(`[agent] wrote ${f.name} (${f.bytes.length} bytes)`);
  }
  console.error(`[agent] rows extracted: ${result.records.length}`);
  console.error("[agent] steps log:");
  for (const line of result.session.log) console.error(`  - ${line}`);
  console.log("\n" + result.text);
}

main().catch((err) => {
  console.error(`[agent] error: ${err?.message ?? err}`);
  process.exit(1);
});
