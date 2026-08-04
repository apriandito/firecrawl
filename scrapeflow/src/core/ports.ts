/**
 * Ports = the extension seams of the system (Hexagonal architecture).
 *
 * The core only ever depends on these interfaces. Adding a new engine, LLM
 * provider, transformer, or output format means writing ONE adapter that
 * implements a port — the core is never touched. This is what keeps the
 * system future-proof (e.g. an agent layer plugs in as a set of AgentTools).
 */

import type { z } from "zod";
import type { Document, RawResult, ScrapeOptions } from "../types.js";

/** Fetches raw HTML for a URL. The ONLY layer that differs per strategy. */
export interface FetchEngine {
  readonly name: string;
  /** Cheap routing check: can/should this engine handle the request? */
  canHandle(url: string, opts: ScrapeOptions): boolean;
  fetch(url: string, opts: ScrapeOptions): Promise<RawResult>;
}

/** One deterministic step in the shared parse pipeline. */
export interface Transformer {
  readonly name: string;
  transform(doc: Document, ctx: TransformContext): Promise<Document> | Document;
}

export interface TransformContext {
  url: string;
  options: ScrapeOptions;
  log: (msg: string, meta?: unknown) => void;
}

/** Provider-agnostic LLM access. Swap OpenAI/Claude/Ollama behind this. */
export interface LLMProvider {
  readonly name: string;
  generateObject<T>(args: {
    prompt: string;
    schema: z.ZodType<T>;
    system?: string;
  }): Promise<T>;
  generateText(args: { prompt: string; system?: string }): Promise<string>;
}

/** Writes documents to some output format/destination. */
export interface ExportSink {
  readonly format: string;
  write(docs: Document[], opts?: Record<string, unknown>): Promise<Buffer | string | void>;
}

/**
 * A capability exposed to an agent. Every use-case (scrape, extract, crawl,
 * export) is wrapped as an AgentTool in the future agentic phase — the agent
 * loop just selects and runs tools. Defined now so the seam exists early.
 */
export interface AgentTool<TArgs = unknown, TResult = unknown> {
  readonly name: string;
  readonly description: string;
  readonly schema: z.ZodType<TArgs>;
  run(args: TArgs): Promise<TResult>;
}
