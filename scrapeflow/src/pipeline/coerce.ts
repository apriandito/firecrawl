import type { Transformer, TransformContext } from "../core/ports.js";
import type { Document, OutputFormat } from "../types.js";
import { resolveFormats } from "../core/formats.js";

/**
 * The output contract. The final transformer strips any field the caller did
 * not request, so the response shape is stable and predictable regardless of
 * what the engines/transformers happened to produce along the way.
 */
export const coerceFormats: Transformer = {
  name: "coerceFormats",
  transform(doc: Document, ctx: TransformContext): Document {
    const formats = resolveFormats(ctx.options.formats);
    const keep = (f: OutputFormat) => formats.includes(f);

    if (!keep("markdown")) delete doc.markdown;
    if (!keep("html")) delete doc.html;
    if (!keep("rawHtml")) delete doc.rawHtml;
    if (!keep("links")) delete doc.links;
    if (!keep("json")) delete doc.json;
    // metadata is always returned.

    return doc;
  },
};
