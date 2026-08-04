import type { z } from "zod";
import type { LLMProvider } from "./ports.js";
import type { Document } from "../types.js";

const SYSTEM_PROMPT = [
  "You extract structured data from a web page's content.",
  "Only use information present in the provided content.",
  "If a field is genuinely absent, leave it empty/null — never invent values.",
].join(" ");

/** Truncate very long pages to stay within context limits (head + tail). */
function clip(text: string, max = 24_000): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.7);
  return (
    text.slice(0, head) +
    `\n\n[...${text.length - max} chars trimmed...]\n\n` +
    text.slice(-(max - head))
  );
}

export interface ExtractArgs<T> {
  document: Document;
  schema: z.ZodType<T>;
  /** Extra natural-language guidance, e.g. "only Islamic-economy news". */
  prompt?: string;
  llm: LLMProvider;
}

/**
 * Structured extraction use-case. Uses the page's markdown as the source text
 * and asks the LLM to fill a Zod schema. This is the "LLM at runtime" strategy;
 * a deterministic code-generation strategy can be added later behind the same
 * signature without changing callers.
 */
export async function extractStructured<T>(args: ExtractArgs<T>): Promise<T> {
  const { document, schema, prompt, llm } = args;
  const source = document.markdown ?? document.html ?? document.rawHtml ?? "";
  if (!source.trim()) {
    throw new Error("extractStructured: document has no textual content");
  }

  const userPrompt = [
    prompt ? `Task: ${prompt}` : null,
    `URL: ${document.metadata.url}`,
    "Content:",
    clip(source),
  ]
    .filter(Boolean)
    .join("\n\n");

  return llm.generateObject({
    schema,
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
  });
}
