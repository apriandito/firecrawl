import * as cheerio from "cheerio";

/**
 * Detects the most common LLM-extractor failure: a selector written from a
 * small HTML sample that is too strict on the real page — typically a child
 * combinator (`>`) that breaks on an unseen wrapper element. When a looser
 * variant matches, we can tell the model exactly what to change.
 */

export interface TooStrictSelector {
  selector: string;
  loosened: string;
  count: number;
}

// Literal selectors inside querySelector/querySelectorAll. Skips ${...} templates.
const SELECTOR_CALL = /querySelector(?:All)?\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;

function extractSelectorLiterals(code: string): string[] {
  const out = new Set<string>();
  for (const m of code.matchAll(SELECTOR_CALL)) {
    const sel = m[2];
    if (sel && !sel.includes("${")) out.add(sel);
  }
  return [...out];
}

/** Relax `>` combinators to descendant, ignoring `>` inside [attr] or quotes. */
export function loosenCombinators(selector: string): string {
  let out = "";
  let depth = 0;
  let quote = "";
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i]!;
    if (quote) {
      out += ch;
      if (ch === quote && selector[i - 1] !== "\\") quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
    } else if (ch === "[") {
      depth++;
      out += ch;
    } else if (ch === "]") {
      depth = Math.max(0, depth - 1);
      out += ch;
    } else if (ch === ">" && depth === 0) {
      out = out.replace(/\s+$/, "") + " ";
      while (i + 1 < selector.length && /\s/.test(selector[i + 1]!)) i++;
    } else {
      out += ch;
    }
  }
  return out.trim();
}

export function tooStrictSelectors(
  code: string,
  html: string,
): TooStrictSelector[] {
  const selectors = extractSelectorLiterals(code).filter((s) => s.includes(">"));
  if (selectors.length === 0) return [];

  const $ = cheerio.load(html);
  const count = (sel: string): number | null => {
    try {
      return $(sel).length;
    } catch {
      return null; // invalid CSS — the sandbox surfaces those itself
    }
  };

  const out: TooStrictSelector[] = [];
  for (const selector of selectors) {
    if (count(selector) !== 0) continue;
    const loosened = loosenCombinators(selector);
    const loosenedCount = count(loosened);
    if (loosenedCount != null && loosenedCount > 0) {
      out.push({ selector, loosened, count: loosenedCount });
    }
  }
  return out;
}

export function tooStrictFeedback(broken: TooStrictSelector[]): string {
  return (
    "Some selectors matched 0 elements even though the target IS on the page — " +
    "a child combinator (`>`) is breaking on a wrapper element that wasn't in " +
    "the sample. Switch these to descendant combinators:\n" +
    broken
      .map((b) => `- \`${b.selector}\` matched 0; \`${b.loosened}\` matches ${b.count}`)
      .join("\n") +
    "\nRewrite these (and re-check other selectors for the same issue). Leave " +
    "genuinely-absent fields empty — never broaden a selector just to match something."
  );
}
