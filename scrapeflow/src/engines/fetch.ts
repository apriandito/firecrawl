import type { FetchEngine } from "../core/ports.js";
import type { RawResult, ScrapeOptions } from "../types.js";

const DEFAULT_UA =
  "Mozilla/5.0 (compatible; ScrapeFlow/0.1; +https://example.invalid/bot)";

/**
 * The cheapest engine: a plain HTTP GET. Handles the majority of static/SSR
 * pages. Skips itself when the caller explicitly asked for a JS-rendered page.
 */
export const fetchEngine: FetchEngine = {
  name: "fetch",

  canHandle(_url: string, opts: ScrapeOptions): boolean {
    return opts.requiresJs !== true;
  },

  async fetch(url: string, opts: ScrapeOptions): Promise<RawResult> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      opts.timeoutMs ?? 30_000,
    );
    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "user-agent": DEFAULT_UA,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          ...opts.headers,
        },
      });
      const rawHtml = await res.text();
      return {
        rawHtml,
        statusCode: res.status,
        contentType: res.headers.get("content-type") ?? undefined,
        resolvedUrl: res.url || url,
      };
    } finally {
      clearTimeout(timeout);
    }
  },
};
