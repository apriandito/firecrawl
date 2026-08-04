import type { Transformer, TransformContext } from "../core/ports.js";
import type { Document, ScrapeOptions } from "../types.js";
import { cleanHtml } from "./cleanHtml.js";
import { htmlToMarkdown } from "./htmlToMarkdown.js";
import { deriveMetadata } from "./metadata.js";
import { deriveLinks } from "./links.js";
import { coerceFormats } from "./coerce.js";

/**
 * The single, ordered transformer stack. Every document flows through the exact
 * same steps in the exact same order — the reason two different engines yield
 * identical output. To add a capability (images, PII redaction, summary, ...)
 * insert one Transformer here; ordering is the only coupling.
 */
export const transformerStack: Transformer[] = [
  cleanHtml, // rawHtml -> html
  deriveMetadata, // rawHtml -> metadata
  htmlToMarkdown, // html -> markdown
  deriveLinks, // html -> links
  // (structured "json" extraction is applied separately via extractStructured)
  coerceFormats, // enforce output contract (must be last)
];

export async function runPipeline(
  doc: Document,
  opts: ScrapeOptions,
  log: (msg: string, meta?: unknown) => void = () => {},
): Promise<Document> {
  const ctx: TransformContext = { url: doc.metadata.url, options: opts, log };
  let current = doc;
  for (const t of transformerStack) {
    current = await t.transform(current, ctx);
  }
  return current;
}
