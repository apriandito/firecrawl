/** URL utilities for crawling: normalization, same-site checks, filtering. */

export function normalizeUrl(input: string, base?: string): string | null {
  try {
    const u = new URL(input, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = ""; // fragments never identify a distinct document
    // Drop trailing slash on non-root paths for stable dedup.
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return null;
  }
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** Same registrable host, ignoring a leading "www." on either side. */
export function sameSite(a: string, b: string): boolean {
  const ha = hostOf(a)?.replace(/^www\./, "");
  const hb = hostOf(b)?.replace(/^www\./, "");
  return !!ha && ha === hb;
}

export function matchesPrefix(url: string, prefix?: string): boolean {
  if (!prefix) return true;
  const n = normalizeUrl(url);
  const p = normalizeUrl(prefix);
  return !!n && !!p && n.startsWith(p);
}

export interface UrlFilter {
  /** Only keep URLs on the same site as the seed. Default true. */
  sameSiteOnly?: boolean;
  /** Only keep URLs under this path prefix, e.g. "https://x.com/blog". */
  prefix?: string;
  /** Regexes a URL must match at least one of (if provided). */
  include?: RegExp[];
  /** Regexes that exclude a URL if any match. */
  exclude?: RegExp[];
}

export function makeUrlFilter(seed: string, filter: UrlFilter = {}) {
  const { sameSiteOnly = true, prefix, include, exclude } = filter;
  return (url: string): boolean => {
    if (sameSiteOnly && !sameSite(seed, url)) return false;
    if (!matchesPrefix(url, prefix)) return false;
    if (exclude && exclude.some((re) => re.test(url))) return false;
    if (include && include.length > 0 && !include.some((re) => re.test(url)))
      return false;
    return true;
  };
}
