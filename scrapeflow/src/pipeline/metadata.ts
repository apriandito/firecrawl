import * as cheerio from "cheerio";
import type { Transformer } from "../core/ports.js";
import type { Document } from "../types.js";

/** Derives title/description/language from raw HTML <head>. */
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
    };
    return doc;
  },
};
