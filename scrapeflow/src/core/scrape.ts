import type { Document, ScrapeOptions } from "../types.js";
import { buildFallbackList } from "../engines/registry.js";
import { runPipeline } from "../pipeline/index.js";
import { evaluateResult, withRetry } from "../engines/resilience.js";

export class NoEnginesLeftError extends Error {
  constructor(
    public readonly url: string,
    public readonly attempts: { engine: string; error: string }[],
  ) {
    super(
      `All engines failed for ${url}: ` +
        attempts.map((a) => `${a.engine}(${a.error})`).join(", "),
    );
    this.name = "NoEnginesLeftError";
  }
}

/**
 * The primary use-case. Walks the engine fallback list until one succeeds,
 * then runs the shared parse pipeline. Fetch strategy varies per engine; the
 * parse layer is single and deterministic.
 */
export async function scrapeUrl(
  url: string,
  opts: ScrapeOptions = {},
  log: (msg: string, meta?: unknown) => void = () => {},
): Promise<Document> {
  new URL(url); // throws on invalid input — validate at the boundary.

  const engines = buildFallbackList(url, opts);
  if (engines.length === 0) {
    throw new NoEnginesLeftError(url, [
      { engine: "(none)", error: "no engine matched" },
    ]);
  }

  const attempts: { engine: string; error: string }[] = [];

  for (const engine of engines) {
    try {
      log(`trying engine: ${engine.name}`);
      const raw = await withRetry((attempt) => {
        if (attempt > 0) log(`  ${engine.name} retry #${attempt}`);
        return engine.fetch(url, opts);
      }, {
        retries: opts.engine ? 3 : 2,
        onRetry: (e) => log(`  ${engine.name} threw: ${(e as Error)?.message}`),
      });

      const verdict = evaluateResult(raw);
      if (!verdict.ok) {
        attempts.push({ engine: engine.name, error: verdict.reason ?? "unusable" });
        log(`  ${engine.name} rejected: ${verdict.reason}`);
        continue; // fall through to the next, stronger engine
      }

      const doc: Document = {
        rawHtml: raw.rawHtml,
        metadata: {
          url: raw.resolvedUrl ?? url,
          sourceURL: url,
          statusCode: raw.statusCode,
          contentType: raw.contentType,
          engine: engine.name,
        },
      };
      return await runPipeline(doc, opts, log);
    } catch (err) {
      attempts.push({
        engine: engine.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  throw new NoEnginesLeftError(url, attempts);
}
