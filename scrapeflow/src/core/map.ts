import { scrapeUrl } from "./scrape.js";
import { makeUrlFilter, normalizeUrl, type UrlFilter } from "../lib/urls.js";

/** Parse <loc> entries from a sitemap or sitemap-index XML. Pure + testable. */
export function parseSitemap(xml: string): { locs: string[]; isIndex: boolean } {
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const locs: string[] = [];
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    const loc = m[1]?.trim();
    if (loc) locs.push(decodeXml(loc));
  }
  return { locs, isIndex };
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Extract "Sitemap:" directives from robots.txt. Pure + testable. */
export function parseRobotsSitemaps(robots: string): string[] {
  const out: string[] = [];
  for (const line of robots.split(/\r?\n/)) {
    const m = /^\s*sitemap:\s*(\S+)/i.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

export interface MapOptions extends UrlFilter {
  /** Cap on returned URLs. Default 500. */
  limit?: number;
  /** Also scrape the seed page and harvest its <a> links. Default true. */
  includeSeedLinks?: boolean;
  /** Follow sitemap index files one level deep. Default true. */
  followSitemapIndex?: boolean;
  timeoutMs?: number;
  log?: (msg: string) => void;
}

export interface MapEntry {
  url: string;
  source: "sitemap" | "links";
}

async function tryFetchText(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Discover URLs on a site: sitemap(s) first (authoritative), then optionally
 * the seed page's own links. Deduped, filtered, and capped.
 */
export async function mapSite(seed: string, opts: MapOptions = {}): Promise<MapEntry[]> {
  const {
    limit = 500,
    includeSeedLinks = true,
    followSitemapIndex = true,
    timeoutMs = 20_000,
    log = () => {},
  } = opts;

  const origin = new URL(seed).origin;
  const keep = makeUrlFilter(seed, opts);
  const found = new Map<string, MapEntry>();

  const addLoc = (raw: string, source: MapEntry["source"]) => {
    const n = normalizeUrl(raw, seed);
    if (n && keep(n) && !found.has(n)) found.set(n, { url: n, source });
  };

  // 1. Sitemaps from robots.txt + the conventional /sitemap.xml.
  const robots = await tryFetchText(`${origin}/robots.txt`, timeoutMs);
  const sitemapUrls = new Set<string>([`${origin}/sitemap.xml`]);
  if (robots) parseRobotsSitemaps(robots).forEach((u) => sitemapUrls.add(u));

  for (const sm of sitemapUrls) {
    const xml = await tryFetchText(sm, timeoutMs);
    if (!xml) continue;
    const { locs, isIndex } = parseSitemap(xml);
    log(`sitemap ${sm}: ${locs.length} locs${isIndex ? " (index)" : ""}`);
    if (isIndex && followSitemapIndex) {
      for (const child of locs.slice(0, 20)) {
        const childXml = await tryFetchText(child, timeoutMs);
        if (childXml) parseSitemap(childXml).locs.forEach((l) => addLoc(l, "sitemap"));
        if (found.size >= limit) break;
      }
    } else {
      locs.forEach((l) => addLoc(l, "sitemap"));
    }
    if (found.size >= limit) break;
  }

  // 2. Seed page links (fills gaps when a sitemap is missing/partial).
  if (includeSeedLinks && found.size < limit) {
    try {
      const doc = await scrapeUrl(seed, { formats: ["links"], timeoutMs });
      (doc.links ?? []).forEach((l) => addLoc(l, "links"));
    } catch (e) {
      log(`seed link harvest failed: ${(e as Error).message}`);
    }
  }

  return [...found.values()].slice(0, limit);
}
