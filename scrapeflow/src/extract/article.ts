import * as cheerio from "cheerio";
import type { Document } from "../types.js";
import { normalizeDate } from "../lib/dates.js";
import { convertHtmlToMarkdown } from "../pipeline/htmlToMarkdown.js";

/**
 * One canonical shape every news article resolves to, regardless of publisher.
 * `sources` records which layer produced each field, so you can see WHY the
 * extractor generalizes (mostly schema.org, which CNN/Detik/Kompas all emit).
 */
export interface Article {
  title: string | null;
  author: string | null;
  publishedDate: string | null; // YYYY-MM-DD
  publishedTime: string | null; // full ISO
  description: string | null;
  section: string | null;
  siteName: string | null;
  image: string | null;
  body: string | null; // markdown
  url: string;
  sources: Record<string, FieldSource>;
}

type FieldSource = "json-ld" | "meta" | "readability" | "none";

// ---- JSON-LD ---------------------------------------------------------------

const ARTICLE_TYPES = new Set([
  "article",
  "newsarticle",
  "reportagenewsarticle",
  "blogposting",
  "liveblogposting",
]);

/** Flatten every JSON-LD node (handles @graph and arrays) into a flat list. */
function collectJsonLdNodes($: cheerio.CheerioAPI): Record<string, unknown>[] {
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

function typeMatches(node: Record<string, unknown>): boolean {
  const t = node["@type"];
  const types = Array.isArray(t) ? t : [t];
  return types.some((x) => typeof x === "string" && ARTICLE_TYPES.has(x.toLowerCase()));
}

function asName(v: unknown): string | null {
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

/** Reject URL-shaped, empty, or absurdly long "authors" (social links etc.). */
function sanitizeAuthor(v: string | null): string | null {
  if (!v) return null;
  const s = v.trim();
  if (!s || s.length > 120) return null;
  if (/^https?:\/\//i.test(s)) return null;
  if (/facebook|twitter|instagram|\.com\b/i.test(s) && /\//.test(s)) return null;
  return s;
}

/** Strip leading breadcrumb/nav/image chrome until real prose or a heading. */
function stripLeadingChrome(md: string): string {
  const lines = md.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line === "") { i++; continue; }
    if (line.startsWith("#")) break; // a heading = start of content
    // A line that is only links/images/short breadcrumb text -> chrome.
    const stripped = line.replace(/!?\[[^\]]*\]\([^)]*\)/g, "").replace(/[|›>/·-]/g, "").trim();
    if (stripped.length < 40) { i++; continue; }
    break; // substantial prose -> content starts here
  }
  return lines.slice(i).join("\n").trim();
}

function firstString(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
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

// ---- Readability-lite ------------------------------------------------------

const NOISE = "script,style,noscript,iframe,svg,template,nav,aside,footer,header,form,figure,figcaption";

/**
 * Pick the main content container by text density: among candidate blocks,
 * choose the one with the most paragraph text. Site-agnostic — no per-site
 * selectors. Returns cleaned HTML for markdown conversion.
 */
function pickMainContentHtml($: cheerio.CheerioAPI): string | null {
  $(NOISE).remove();

  const semantic = $("article").first();
  if (semantic.length && $("p", semantic).text().trim().length > 200) {
    return $.html(semantic);
  }

  let best: { el: cheerio.Cheerio<never>; score: number } | null = null;
  $("div, section, main").each((_, el) => {
    const $el = $(el) as unknown as cheerio.Cheerio<never>;
    const ps = $("p", $el);
    if (ps.length < 2) return;
    const textLen = ps.text().replace(/\s+/g, " ").trim().length;
    const linkLen = $("a", $el).text().length;
    // Prefer lots of paragraph text, penalize link-heavy (nav/related) blocks.
    const score = textLen - linkLen * 2;
    if (score > 300 && (!best || score > best.score)) best = { el: $el, score };
  });

  return best ? $.html((best as { el: cheerio.Cheerio<never> }).el) : null;
}

// ---- Main extractor --------------------------------------------------------

/**
 * Extract a canonical Article from any news page using a layered strategy:
 *   1. schema.org JSON-LD (headline/author/date/body) — the common denominator
 *   2. Open Graph / <meta> fallbacks
 *   3. Readability-lite for the body when JSON-LD lacks articleBody
 * Deterministic and single-code-path: the SAME function yields the SAME shape
 * for CNN, Detik, Kompas, CNBC, ... because they share these standards.
 */
export function extractArticle(doc: Document): Article {
  const html = doc.rawHtml ?? doc.html ?? "";
  const $ = cheerio.load(html);
  const url = doc.metadata.url;
  const sources: Record<string, FieldSource> = {};

  const ld = collectJsonLdNodes($);
  const article = ld.find(typeMatches);
  const publisher = ld.find((n) => {
    const t = n["@type"];
    const types = Array.isArray(t) ? t : [t];
    return types.some((x) => typeof x === "string" && x.toLowerCase() === "organization");
  });

  const metaProp = (p: string) => $(`meta[property="${p}"]`).attr("content")?.trim() || undefined;
  const metaName = (n: string) => $(`meta[name="${n}"]`).attr("content")?.trim() || undefined;

  const pick = (
    field: string,
    ldVal: string | null,
    metaVal: string | undefined,
  ): string | null => {
    if (ldVal) {
      sources[field] = "json-ld";
      return ldVal;
    }
    if (metaVal) {
      sources[field] = "meta";
      return metaVal;
    }
    sources[field] = "none";
    return null;
  };

  const title = pick(
    "title",
    article ? firstString(article.headline) ?? firstString(article.name) : null,
    metaProp("og:title") ?? ($("title").first().text().trim() || undefined),
  );

  // Author needs sanitizing: some sites put a social URL in <meta name=author>.
  const authorCandidates: [string | null, FieldSource][] = [
    [article ? asName(article.author) : null, "json-ld"],
    [metaName("author") ?? null, "meta"],
    [metaProp("article:author") ?? null, "meta"],
    [$('[rel="author"]').first().text().trim() || null, "readability"],
  ];
  let author: string | null = null;
  sources.author = "none";
  for (const [cand, src] of authorCandidates) {
    const clean = sanitizeAuthor(cand);
    if (clean) {
      author = clean;
      sources.author = src;
      break;
    }
  }

  const rawDate =
    (article ? firstString(article.datePublished) : null) ??
    metaProp("article:published_time") ??
    metaName("pubdate") ??
    $("time[datetime]").first().attr("datetime") ??
    null;
  const norm = normalizeDate(rawDate);
  if (norm) sources.publishedDate = article && firstString(article.datePublished) ? "json-ld" : "meta";
  else sources.publishedDate = "none";

  const description = pick(
    "description",
    article ? firstString(article.description) : null,
    metaName("description") ?? metaProp("og:description"),
  );

  const section = pick(
    "section",
    article ? firstString(article.articleSection) : null,
    metaProp("article:section"),
  );

  const siteName = pick(
    "siteName",
    publisher ? asName(publisher.name) : article ? asName(article.publisher) : null,
    metaProp("og:site_name"),
  );

  const image = pick(
    "image",
    article ? firstString(article.image) : null,
    metaProp("og:image"),
  );

  // Body: prefer JSON-LD articleBody (clean text), else Readability-lite.
  let body: string | null = null;
  const ldBody = article ? firstString(article.articleBody) : null;
  if (ldBody && ldBody.length > 200) {
    body = ldBody;
    sources.body = "json-ld";
  } else {
    const mainHtml = pickMainContentHtml(cheerio.load(html));
    if (mainHtml) {
      body = stripLeadingChrome(convertHtmlToMarkdown(mainHtml));
      sources.body = body ? "readability" : "none";
    } else {
      body = doc.markdown ?? null;
      sources.body = body ? "readability" : "none";
    }
  }

  return {
    title,
    author,
    publishedDate: norm?.date ?? null,
    publishedTime: norm?.iso ?? null,
    description,
    section,
    siteName,
    image,
    body,
    url,
    sources,
  };
}
