/**
 * Core domain types. These are deliberately provider-agnostic: nothing here
 * knows about a specific engine, LLM, or output format.
 */

export type OutputFormat =
  | "markdown"
  | "html"
  | "rawHtml"
  | "links"
  | "metadata"
  | "json";

export interface ScrapeOptions {
  /** Which fields to compute and return. Defaults to ["markdown"]. */
  formats?: OutputFormat[];
  /** Strip nav/aside/footer/scripts and keep the main content only. */
  onlyMainContent?: boolean;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /** Force a specific engine by name instead of the fallback list. */
  engine?: string;
  /** Extra headers forwarded to the fetch layer. */
  headers?: Record<string, string>;
  /** Hint that the page needs a real browser (JS-rendered). */
  requiresJs?: boolean;
}

export interface DocumentMetadata {
  url: string;
  sourceURL?: string;
  statusCode?: number;
  title?: string;
  description?: string;
  language?: string;
  contentType?: string;
  /** Canonical publish date "YYYY-MM-DD", deterministically derived if found. */
  publishedDate?: string;
  /** Full ISO publish timestamp when available (from JSON-LD/meta/time). */
  publishedTime?: string;
  /** Name of the engine that actually produced the raw HTML. */
  engine?: string;
  [key: string]: unknown;
}

/** The single, unified shape every scrape resolves to — regardless of engine. */
export interface Document {
  markdown?: string;
  html?: string;
  rawHtml?: string;
  links?: string[];
  json?: unknown;
  metadata: DocumentMetadata;
}

/** What an engine returns: raw material only. Engines never parse. */
export interface RawResult {
  rawHtml: string;
  statusCode?: number;
  contentType?: string;
  /** The final URL after redirects, if the engine can observe it. */
  resolvedUrl?: string;
}
