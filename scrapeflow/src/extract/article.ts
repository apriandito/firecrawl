import * as cheerio from "cheerio";
import type { Document } from "../types.js";
import { normalizeDate } from "../lib/dates.js";
import { convertHtmlToMarkdown } from "../pipeline/htmlToMarkdown.js";
import { extractMainContent, cleanArticleMarkdown } from "./readability.js";
import { asName, collectJsonLdNodes, findByType, firstString } from "./jsonld.js";

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

/** Reject URL-shaped, empty, or absurdly long "authors" (social links etc.). */
function sanitizeAuthor(v: string | null): string | null {
  if (!v) return null;
  const s = v.trim();
  if (!s || s.length > 120) return null;
  if (/^https?:\/\//i.test(s)) return null;
  if (/facebook|twitter|instagram|\.com\b/i.test(s) && /\//.test(s)) return null;
  return s;
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
  const article = findByType(ld, ARTICLE_TYPES);
  const publisher = findByType(ld, new Set(["organization"]));

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

  // Body: prefer JSON-LD articleBody (clean text), else Readability + cleaner.
  let body: string | null = null;
  const ldBody = article ? firstString(article.articleBody) : null;
  if (ldBody && ldBody.length > 200) {
    body = ldBody;
    sources.body = "json-ld";
  } else {
    const main = extractMainContent(html);
    if (main) {
      body = cleanArticleMarkdown(convertHtmlToMarkdown(main.html), title);
      sources.body = body ? "readability" : "none";
    } else {
      body = doc.markdown ? cleanArticleMarkdown(doc.markdown, title) : null;
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
