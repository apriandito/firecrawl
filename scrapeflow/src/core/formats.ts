import type { OutputFormat } from "../types.js";

export const DEFAULT_FORMATS: OutputFormat[] = ["markdown"];

export function resolveFormats(formats?: OutputFormat[]): OutputFormat[] {
  return formats && formats.length > 0 ? formats : DEFAULT_FORMATS;
}

export function hasFormat(
  formats: OutputFormat[] | undefined,
  format: OutputFormat,
): boolean {
  return resolveFormats(formats).includes(format);
}

/**
 * Markdown is required not only for the "markdown" format but also as the
 * source text for LLM structured extraction ("json").
 */
export function needsMarkdown(formats?: OutputFormat[]): boolean {
  const f = resolveFormats(formats);
  return f.includes("markdown") || f.includes("json");
}
