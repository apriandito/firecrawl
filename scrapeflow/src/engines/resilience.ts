import type { RawResult } from "../types.js";

/** Retry an async op with exponential backoff. Only retries on thrown errors. */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number; onRetry?: (e: unknown, attempt: number) => void } = {},
): Promise<T> {
  const retries = opts.retries ?? 2;
  const base = opts.baseDelayMs ?? 400;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      opts.onRetry?.(err, attempt);
      await new Promise((r) => setTimeout(r, base * 2 ** attempt));
    }
  }
  throw lastErr;
}

const BLOCK_SIGNATURES: { pattern: RegExp; reason: string }[] = [
  { pattern: /just a moment\.\.\./i, reason: "cloudflare-challenge" },
  { pattern: /cf-browser-verification|cf_chl_opt|__cf_chl/i, reason: "cloudflare-challenge" },
  { pattern: /attention required!.*cloudflare/is, reason: "cloudflare-block" },
  { pattern: /captcha|recaptcha|hcaptcha/i, reason: "captcha" },
  { pattern: /access denied|you have been blocked|request blocked/i, reason: "access-denied" },
  { pattern: /enable javascript and cookies to continue/i, reason: "js-wall" },
];

/** Heuristic: does this look like an anti-bot interstitial rather than content? */
export function detectBlock(html: string): string | null {
  const head = html.slice(0, 4000);
  for (const { pattern, reason } of BLOCK_SIGNATURES) {
    if (pattern.test(head)) return reason;
  }
  return null;
}

export interface Verdict {
  ok: boolean;
  reason?: string;
  /** True when the failure is worth escalating to the next (heavier) engine. */
  escalate?: boolean;
}

/**
 * Decides whether an engine result is usable. Beyond HTTP status, it rejects
 * empty bodies and anti-bot walls — those should fall through to a stronger
 * engine instead of being returned as "the page".
 */
export function evaluateResult(raw: RawResult, minChars = 200): Verdict {
  if (raw.statusCode && raw.statusCode >= 400) {
    return { ok: false, reason: `http-${raw.statusCode}`, escalate: raw.statusCode !== 404 };
  }
  const html = raw.rawHtml ?? "";
  if (html.trim().length === 0) {
    return { ok: false, reason: "empty-body", escalate: true };
  }
  const block = detectBlock(html);
  if (block) {
    return { ok: false, reason: block, escalate: true };
  }
  // Very short HTML with no <body> content is suspicious for JS-only pages.
  const textish = html.replace(/<[^>]+>/g, "").trim();
  if (textish.length < minChars && /<div id="(root|app|__next)"/i.test(html)) {
    return { ok: false, reason: "js-shell", escalate: true };
  }
  return { ok: true };
}
