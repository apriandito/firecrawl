import type { FetchEngine } from "../core/ports.js";
import type { ScrapeOptions } from "../types.js";
import { fetchEngine } from "./fetch.js";
import { playwrightEngine } from "./playwright.js";

/**
 * The ordered engine registry. To add a new engine (pdf, wikipedia, x, ...)
 * just register it here — nothing else in the system changes.
 *
 * Order matters: cheapest first. buildFallbackList() filters by canHandle()
 * and honors an explicit opts.engine override.
 */
export const engines: FetchEngine[] = [fetchEngine, playwrightEngine];

export function buildFallbackList(
  url: string,
  opts: ScrapeOptions,
): FetchEngine[] {
  if (opts.engine) {
    const forced = engines.find((e) => e.name === opts.engine);
    if (!forced) {
      throw new Error(`Unknown engine: ${opts.engine}`);
    }
    return [forced];
  }
  return engines.filter((e) => e.canHandle(url, opts));
}
