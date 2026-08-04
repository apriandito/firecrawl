import * as cheerio from "cheerio";
import type { Transformer } from "../core/ports.js";
import type { Document } from "../types.js";
import { normalizeDate } from "../lib/dates.js";

/**
 * Find a publish date from machine-readable sources, in order of reliability:
 * JSON-LD datePublished -> <meta article:published_time> -> <time datetime>.
 * Deterministic; no LLM. Returns the first that normalizes cleanly.
 */
function findPublishDate(
  $: cheerio.CheerioAPI,
): { publishedDate?: string; publishedTime?: string } {
  const candidates: string[] = [];

  // 1. JSON-LD (most reliable — usually already ISO with offset).
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    const m = /"datePublished"\s*:\s*"([^"]+)"/.exec(raw);
    if (m) candidates.push(m[1]);
  });

  // 2. Open Graph / article meta.
  const meta =
    $('meta[property="article:published_time"]').attr("content") ||
    $('meta[itemprop="datePublished"]').attr("content") ||
    $('meta[name="pubdate"]').attr("content");
  if (meta) candidates.push(meta);

  // 3. <time datetime="...">
  const timeAttr = $("time[datetime]").first().attr("datetime");
  if (timeAttr) candidates.push(timeAttr);

  for (const c of candidates) {
    const norm = normalizeDate(c);
    if (norm) return { publishedDate: norm.date, publishedTime: norm.iso };
  }
  return {};
}

/** Derives title/description/language/publishDate from raw HTML. */
export const deriveMetadata: Transformer = {
  name: "deriveMetadata",
  transform(doc: Document): Document {
    if (doc.rawHtml === undefined) return doc;
    const $ = cheerio.load(doc.rawHtml);

    const pick = (sel: string, attr = "content"): string | undefined =>
      $(sel).first().attr(attr)?.trim() || undefined;

    doc.metadata = {
      ...doc.metadata,
      title:
        $("title").first().text().trim() ||
        pick('meta[property="og:title"]') ||
        doc.metadata.title,
      description:
        pick('meta[name="description"]') ||
        pick('meta[property="og:description"]') ||
        doc.metadata.description,
      language:
        $("html").attr("lang")?.trim() ||
        pick('meta[http-equiv="content-language"]') ||
        doc.metadata.language,
      ...findPublishDate($),
    };
    return doc;
  },
};
