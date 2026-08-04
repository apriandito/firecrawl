import type { FetchEngine } from "../core/ports.js";
import type { RawResult, ScrapeOptions } from "../types.js";

/**
 * Browser engine for JS-heavy pages. Playwright is an OPTIONAL dependency and
 * the browser is launched lazily, so the whole project still installs and runs
 * (via the fetch engine) on machines without a browser. If Playwright isn't
 * present, canHandle() returns false and the fallback list skips this engine.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let browserPromise: Promise<any> | null = null;

async function getBrowser(): Promise<unknown> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import("playwright");
      return chromium.launch({ headless: true });
    })();
  }
  return browserPromise;
}

let playwrightAvailable: boolean | null = null;
async function isPlaywrightInstalled(): Promise<boolean> {
  if (playwrightAvailable !== null) return playwrightAvailable;
  try {
    await import("playwright");
    playwrightAvailable = true;
  } catch {
    playwrightAvailable = false;
  }
  return playwrightAvailable;
}

export const playwrightEngine: FetchEngine = {
  name: "playwright",

  // Synchronous routing hint. Actual availability is re-checked in fetch().
  canHandle(_url: string, _opts: ScrapeOptions): boolean {
    // Eligible for anything; the fallback list decides ordering. If the module
    // is missing, fetch() throws and the orchestrator moves on.
    return playwrightAvailable !== false;
  },

  async fetch(url: string, opts: ScrapeOptions): Promise<RawResult> {
    if (!(await isPlaywrightInstalled())) {
      throw new Error("playwright is not installed");
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const browser = (await getBrowser()) as any;
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: opts.timeoutMs ?? 45_000,
      });
      const rawHtml = await page.content();
      return {
        rawHtml,
        statusCode: response?.status(),
        contentType: response?.headers()?.["content-type"],
        resolvedUrl: page.url(),
      };
    } finally {
      await context.close();
    }
  },
};
