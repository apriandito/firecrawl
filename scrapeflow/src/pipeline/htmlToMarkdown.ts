import TurndownService from "turndown";
// @ts-expect-error - no types shipped for this plugin
import { gfm } from "joplin-turndown-plugin-gfm";
import type { Transformer, TransformContext } from "../core/ports.js";
import type { Document } from "../types.js";
import { hasFormat, needsMarkdown } from "../core/formats.js";

/**
 * The single canonical HTML→Markdown converter. Every document — no matter
 * which engine produced it — passes through THIS one converter, which is why
 * output is consistent across engines. Swap the implementation here (e.g. a Go
 * service) and every path changes at once.
 */

function buildConverter(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  td.use(gfm);
  td.addRule("stripEmptyLinks", {
    filter: (node) =>
      node.nodeName === "A" && !node.getAttribute("href")?.trim(),
    replacement: (content) => content,
  });
  return td;
}

const converter = buildConverter();

function postProcess(md: string): string {
  return md
    .replace(/\[Skip to (?:main )?content\]\(#[^)]*\)/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const htmlToMarkdown: Transformer = {
  name: "htmlToMarkdown",
  transform(doc: Document, ctx: TransformContext): Document {
    if (!needsMarkdown(ctx.options.formats)) return doc;
    if (doc.html === undefined) {
      throw new Error("htmlToMarkdown: html missing (transformer out of order)");
    }

    if (doc.metadata.contentType?.includes("application/json")) {
      doc.markdown = "```json\n" + doc.rawHtml + "\n```";
      return doc;
    }

    doc.markdown = postProcess(converter.turndown(doc.html));

    // Anti-empty fallback: if main-content extraction yielded nothing, retry
    // against the full raw HTML so a page never comes back blank.
    if (
      ctx.options.onlyMainContent &&
      (!doc.markdown || doc.markdown.length === 0) &&
      doc.rawHtml
    ) {
      ctx.log("markdown empty after main-content extraction; retrying full");
      doc.markdown = postProcess(converter.turndown(doc.rawHtml));
    }

    return doc;
  },
};

export { hasFormat };
