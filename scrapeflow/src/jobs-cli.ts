#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { JobManager } from "./jobs/manager.js";
import { createDefaultHandlers } from "./jobs/handlers.js";
import type { JobInput } from "./jobs/types.js";

/**
 * Batch job runner:
 *   npm run jobs -- jobs.json [--concurrency 4] [--out results.json]
 *
 * jobs.json is an array of { kind, input, label? }, e.g.
 *   [ { "kind": "article", "input": { "url": "https://..." } },
 *     { "kind": "product", "input": { "url": "https://..." } },
 *     { "kind": "agent",   "input": { "task": "berita X jadi Excel" } } ]
 */
async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("usage: jobs <jobs.json> [--concurrency N] [--out results.json]");
    process.exit(1);
  }
  const concurrency = Number(args[args.indexOf("--concurrency") + 1]) || 4;
  const outIdx = args.indexOf("--out");
  const out = outIdx !== -1 ? args[outIdx + 1] : undefined;

  const inputs = JSON.parse(await readFile(file, "utf8")) as JobInput[];
  console.error(`[jobs] ${inputs.length} jobs @ concurrency ${concurrency}\n`);

  const mgr = new JobManager({
    handlers: createDefaultHandlers(),
    concurrency,
    onEvent: (e) => {
      if (e.type === "started") console.error(`  ▶ ${e.job.id} [${e.job.kind}] ${e.job.label ?? ""}`);
      if (e.type === "finished") {
        const ms = e.job.finishedAt! - (e.job.startedAt ?? e.job.finishedAt!);
        console.error(
          `  ${e.job.status === "done" ? "✓" : "✗"} ${e.job.id} ${e.job.status} (${ms}ms)` +
            (e.job.error ? ` — ${e.job.error}` : ""),
        );
      }
    },
  });

  const records = await mgr.submitAndRun(inputs);
  const done = records.filter((r) => r.status === "done").length;
  console.error(`\n[jobs] done ${done}/${records.length}`);

  if (out) {
    await writeFile(out, JSON.stringify(records, null, 2));
    console.error(`[jobs] wrote ${out}`);
  } else {
    console.log(JSON.stringify(records.map((r) => ({ id: r.id, kind: r.kind, status: r.status, result: r.result, error: r.error })), null, 2));
  }
}

main().catch((err) => {
  console.error(`[jobs] error: ${err?.message ?? err}`);
  process.exit(1);
});
