import * as cheerio from "cheerio";
import type { Transformer, TransformContext } from "../core/ports.js";
import type { Document } from "../types.js";
import { hasFormat } from "../core/formats.js";

/** Extracts absolute links. Only runs when the "links" format is requested. */
export const deriveLinks: Transformer = {
  name: "deriveLinks",
  transform(doc: Document, ctx: TransformContext): Document {
    if (!hasFormat(ctx.options.formats, "links")) return doc;
    if (doc.html === undefined) return doc;

    const base = doc.metadata.url ?? ctx.url;
    const $ = cheerio.load(doc.html);
    const seen = new Set<string>();

    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      try {
        const abs = new URL(href, base).toString();
        if (abs.startsWith("http")) seen.add(abs);
      } catch {
        /* ignore malformed hrefs */
      }
    });

    doc.links = [...seen];
    return doc;
  },
};
