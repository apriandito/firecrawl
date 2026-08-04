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

/**
 * Executes an LLM-generated extractor against a page inside an isolated
 * environment. Kept as a port so the default in-process runner (jsdom + vm)
 * can be swapped for a hardened jail (isolated-vm, a separate service) without
 * touching the extraction logic.
 */
export interface SandboxRunner {
  run(job: {
    /** Extractor source, defining `async function extract(document) {...}`. */
    code: string;
    html: string;
    url: string;
    timeoutMs?: number;
  }): Promise<unknown>;
}

/**
 * Persists LLM-generated extractor code so the (slow, non-deterministic) code
 * generation happens once per (url + schema + prompt), and every later run is
 * pure deterministic code. Swap memory ↔ file ↔ Postgres behind this port.
 */
export interface ExtractorCache {
  get(key: string): Promise<CachedExtractor | undefined>;
  set(key: string, code: string, meta: ExtractorMeta): Promise<void>;
  /** Optional: bump a last-used timestamp on a cache hit. */
  touch?(key: string): Promise<void>;
}

export interface CachedExtractor {
  code: string;
  createdAt: number;
}

export interface ExtractorMeta {
  url: string;
  model: string;
  cacheVersion: number;
}
