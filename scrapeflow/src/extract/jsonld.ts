import * as cheerio from "cheerio";

/**
 * Shared schema.org JSON-LD helpers. News, products, recipes, events — they all
 * ride the same standard, so one parser serves every domain-specific extractor.
 */

/** Flatten every JSON-LD node (handles @graph and arrays) into a flat list. */
export function collectJsonLdNodes($: cheerio.CheerioAPI): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // malformed JSON-LD is common; skip it
    }
    const stack = [parsed];
    while (stack.length) {
      const node = stack.pop();
      if (Array.isArray(node)) stack.push(...node);
      else if (node && typeof node === "object") {
        const obj = node as Record<string, unknown>;
        nodes.push(obj);
        if (Array.isArray(obj["@graph"])) stack.push(...(obj["@graph"] as unknown[]));
      }
    }
  });
  return nodes;
}

export function nodeHasType(node: Record<string, unknown>, types: Set<string>): boolean {
  const t = node["@type"];
  const list = Array.isArray(t) ? t : [t];
  return list.some((x) => typeof x === "string" && types.has(x.toLowerCase()));
}

export function findByType(
  nodes: Record<string, unknown>[],
  types: Set<string>,
): Record<string, unknown> | undefined {
  return nodes.find((n) => nodeHasType(n, types));
}

/** Extract a display name from string | {name} | array-of-those. */
export function asName(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v.trim() || null;
  if (Array.isArray(v)) {
    const names = v.map(asName).filter(Boolean);
    return names.length ? names.join(", ") : null;
  }
  if (typeof v === "object") {
    const name = (v as Record<string, unknown>).name;
    return typeof name === "string" ? name.trim() || null : null;
  }
  return null;
}

/** First usable string from string | array | {url}. */
export function firstString(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) {
    for (const x of v) {
      const s = firstString(x);
      if (s) return s;
    }
  }
  if (v && typeof v === "object") {
    const url = (v as Record<string, unknown>).url;
    if (typeof url === "string") return url;
  }
  return null;
}
