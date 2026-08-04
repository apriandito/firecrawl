import * as cheerio from "cheerio";
import type { Transformer, TransformContext } from "../core/ports.js";
import type { Document } from "../types.js";

const NOISE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "iframe",
  "svg",
  "template",
];

const NON_MAIN_SELECTORS = ["nav", "header", "footer", "aside"];

/**
 * Normalizes raw HTML into cleaned HTML (document.html). Always strips scripts
 * and styles. When onlyMainContent is on, it prefers <main>/<article> and drops
 * nav/header/footer/aside. Runs BEFORE markdown so every engine feeds the same
 * cleaned DOM into the converter — this is the root of cross-engine consistency.
 */
export const cleanHtml: Transformer = {
  name: "cleanHtml",
  transform(doc: Document, ctx: TransformContext): Document {
    if (doc.rawHtml === undefined) {
      throw new Error("cleanHtml: rawHtml missing (transformer out of order)");
    }

    if (doc.metadata.contentType?.includes("application/json")) {
      // Leave JSON payloads untouched; the markdown step fences them.
      doc.html = doc.rawHtml;
      return doc;
    }

    const $ = cheerio.load(doc.rawHtml);
    $(NOISE_SELECTORS.join(",")).remove();

    const onlyMain = ctx.options.onlyMainContent === true;
    const main = $("main").first();
    const article = $("article").first();
    const scope = main.length ? main : article.length ? article : null;

    doc.metadata.mainContent = onlyMain && !!scope;

    if (onlyMain) {
      if (scope) {
        doc.html = $.html(scope);
        return doc;
      }
      // No semantic main element — strip common chrome from the body instead.
      $(NON_MAIN_SELECTORS.join(",")).remove();
    }

    doc.html = $.html();
    return doc;
  },
};
