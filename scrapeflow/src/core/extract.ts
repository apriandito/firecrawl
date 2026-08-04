import type { z } from "zod";
import type { ExtractorCache, LLMProvider, SandboxRunner } from "./ports.js";
import type { Document } from "../types.js";
import { extractDeterministic } from "../extract/deterministic/extract.js";

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
  /**
   * "llm" (default): ask the LLM to fill the schema on every call — flexible,
   * non-deterministic, one API call per page.
   * "deterministic": LLM writes an extractor once, it's cached, and every later
   * page runs pure code in a sandbox — consistent and cheap at scale.
   */
  strategy?: "llm" | "deterministic";
  cache?: ExtractorCache;
  sandbox?: SandboxRunner;
  log?: (msg: string) => void;
}

/**
 * Structured extraction use-case. Two strategies behind one signature so
 * callers (including the future agent layer) never change.
 */
export async function extractStructured<T>(args: ExtractArgs<T>): Promise<T> {
  const { document, schema, prompt, llm } = args;

  if (args.strategy === "deterministic") {
    const html = document.rawHtml ?? document.html;
    if (!html) {
      throw new Error(
        'deterministic strategy needs HTML; scrape with formats including "rawHtml" or "html".',
      );
    }
    const { data } = await extractDeterministic({
      html,
      url: document.metadata.url,
      schema,
      prompt,
      llm,
      cache: args.cache,
      sandbox: args.sandbox,
      log: args.log,
    });
    return data;
  }

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
