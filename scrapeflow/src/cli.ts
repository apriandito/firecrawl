#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { scrapeUrl } from "./core/scrape.js";
import { getSink } from "./export/registry.js";
import type { OutputFormat, ScrapeOptions } from "./types.js";

/**
 * Minimal CLI:
 *   scrapeflow <url> [--format markdown|json|rawHtml|links|html]
 *                     [--main] [--js] [--engine fetch|playwright]
 *                     [--out file] [--export markdown|json|xlsx]
 */
function parseArgs(argv: string[]) {
  const [url, ...rest] = argv;
  const opts: ScrapeOptions = { formats: ["markdown"] };
  let out: string | undefined;
  let exportFormat: string | undefined;

  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--format") opts.formats = [rest[++i] as OutputFormat];
    else if (a === "--main") opts.onlyMainContent = true;
    else if (a === "--js") opts.requiresJs = true;
    else if (a === "--engine") opts.engine = rest[++i];
    else if (a === "--out") out = rest[++i];
    else if (a === "--export") exportFormat = rest[++i];
  }
  return { url, opts, out, exportFormat };
}

async function main() {
  const { url, opts, out, exportFormat } = parseArgs(process.argv.slice(2));
  if (!url) {
    console.error(
      "usage: scrapeflow <url> [--format markdown|json|rawHtml|links|html] [--main] [--js] [--engine name] [--export markdown|json|xlsx] [--out file]",
    );
    process.exit(1);
  }

  const doc = await scrapeUrl(url, opts, (m) =>
    process.stderr.write(`[scrapeflow] ${m}\n`),
  );

  if (exportFormat) {
    const sink = getSink(exportFormat);
    const result = await sink.write([doc]);
    if (out) {
      await writeFile(out, result as Buffer | string);
      process.stderr.write(`[scrapeflow] wrote ${out}\n`);
    } else if (typeof result === "string") {
      process.stdout.write(result + "\n");
    }
    return;
  }

  const primary = opts.formats?.[0] ?? "markdown";
  const value =
    primary === "links"
      ? (doc.links ?? []).join("\n")
      : primary === "metadata"
        ? JSON.stringify(doc.metadata, null, 2)
        : primary === "markdown"
          ? doc.markdown
          : primary === "html"
            ? doc.html
            : primary === "rawHtml"
              ? doc.rawHtml
              : JSON.stringify(doc, null, 2);

  const output = value ?? "";
  if (out) {
    await writeFile(out, output);
    process.stderr.write(`[scrapeflow] wrote ${out}\n`);
  } else {
    process.stdout.write(output + "\n");
  }
}

main().catch((err) => {
  console.error(`[scrapeflow] error: ${err?.message ?? err}`);
  process.exit(1);
});
