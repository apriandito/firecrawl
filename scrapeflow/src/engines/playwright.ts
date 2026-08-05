import { existsSync } from "node:fs";
import type { FetchEngine } from "../core/ports.js";
import type { RawResult, ScrapeOptions } from "../types.js";

/**
 * Browser engine for JS-heavy pages. Playwright is an OPTIONAL dependency and
 * the browser is launched lazily, so the whole project still installs and runs
 * (via the fetch engine) on machines without a browser. If Playwright isn't
 * present, canHandle() returns false and the fallback list skips this engine.
 *
 * Includes light stealth (realistic UA/viewport, navigator.webdriver hidden,
 * automation flags off) so basic bot checks don't immediately reject us. This
 * is NOT full stealth — hardened targets still need residential proxies.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-blink-features=AutomationControlled",
  "--disable-dev-shm-usage",
  // Background/telemetry traffic makes non-CONNECT requests that a CONNECT-only
  // egress proxy resets; disable it so only real navigation goes out.
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-domain-reliability",
  "--no-first-run",
  "--no-default-browser-check",
  "--no-pings",
];

/** Resolve a chromium executable: explicit env, or a common pre-installed path. */
function resolveExecutablePath(): string | undefined {
  const envPath = process.env.SCRAPEFLOW_CHROMIUM_PATH;
  if (envPath && existsSync(envPath)) return envPath;
  const common = "/opt/pw-browsers/chromium";
  if (existsSync(common)) return common;
  return undefined; // let Playwright find its own managed browser
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let browserPromise: Promise<any> | null = null;

async function getBrowser(): Promise<unknown> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import("playwright");
      // Chromium doesn't honor HTTP(S)_PROXY env vars automatically; pass it
      // explicitly so it works behind a corporate/agent proxy like fetch does.
      const proxyServer = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
      return chromium.launch({
        headless: true,
        executablePath: resolveExecutablePath(),
        args: LAUNCH_ARGS,
        proxy: proxyServer ? { server: proxyServer } : undefined,
      });
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

  canHandle(_url: string, _opts: ScrapeOptions): boolean {
    return playwrightAvailable !== false;
  },

  async fetch(url: string, opts: ScrapeOptions): Promise<RawResult> {
    if (!(await isPlaywrightInstalled())) {
      throw new Error("playwright is not installed");
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const browser = (await getBrowser()) as any;
    const context = await browser.newContext({
      userAgent: opts.headers?.["user-agent"] ?? UA,
      viewport: { width: 1366, height: 768 },
      locale: "id-ID",
      // The agent proxy terminates TLS with its own CA; trust it.
      ignoreHTTPSErrors: true,
    });
    // Hide the automation fingerprint before any page script runs.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    const page = await context.newPage();
    try {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: opts.timeoutMs ?? 45_000,
      });
      // Give client-rendered content a brief moment to populate.
      await page.waitForTimeout(1200);
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
