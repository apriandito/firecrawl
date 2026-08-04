import type { LLMProvider } from "../../core/ports.js";

const SYSTEM = [
  "You write a JavaScript function that extracts structured data from a DOM.",
  "Output ONLY the function body of `async function extract(document) { ... }`",
  "as raw JavaScript — no markdown fences, no prose, no exports.",
  "",
  "Rules:",
  "- Define exactly: async function extract(document) { ... } returning a value",
  "  that matches the requested JSON schema.",
  "- Use only standard DOM APIs (querySelector/All, textContent, getAttribute).",
  "- Prefer robust selectors; prefer descendant combinators over `>`.",
  "- For fields genuinely not present, use null (or []). Never invent data.",
  "- Do not fetch, do not use timers, do not touch globals besides `document`.",
].join("\n");

function clip(text: string, max = 18_000): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.7);
  return (
    text.slice(0, head) +
    `\n\n<!-- ...${text.length - max} chars trimmed... -->\n\n` +
    text.slice(-(max - head))
  );
}

/** Strip accidental ```js fences the model may add despite instructions. */
function stripFences(code: string): string {
  return code
    .replace(/^\s*```(?:js|javascript)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

export interface GenerateArgs {
  llm: LLMProvider;
  html: string;
  schemaJson: string;
  prompt: string;
  /** Repair feedback from a previous attempt. */
  feedback?: string;
  previousCode?: string;
}

export async function generateExtractor(args: GenerateArgs): Promise<string> {
  const parts = [
    `JSON schema the return value must satisfy:\n${args.schemaJson}`,
    args.prompt ? `Extraction intent: ${args.prompt}` : "",
    `Page HTML (may be truncated):\n${clip(args.html)}`,
    args.previousCode ? `Your previous attempt:\n${args.previousCode}` : "",
    args.feedback ? `Fix this problem:\n${args.feedback}` : "",
    "Return the extractor code now.",
  ].filter(Boolean);

  const code = await args.llm.generateText({
    system: SYSTEM,
    prompt: parts.join("\n\n"),
  });
  return stripFences(code);
}
