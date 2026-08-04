/** Public entrypoint. Import from "scrapeflow". */

export type {
  Document,
  DocumentMetadata,
  RawResult,
  ScrapeOptions,
  OutputFormat,
} from "./types.js";

export type {
  FetchEngine,
  Transformer,
  TransformContext,
  LLMProvider,
  ExportSink,
  AgentTool,
  SandboxRunner,
  ExtractorCache,
  CachedExtractor,
  ExtractorMeta,
} from "./core/ports.js";

export { scrapeUrl, NoEnginesLeftError } from "./core/scrape.js";
export { extractStructured } from "./core/extract.js";
export type { ExtractArgs } from "./core/extract.js";

// Resilience layer
export { withRetry, detectBlock, evaluateResult } from "./engines/resilience.js";

// Deterministic extraction (LLM-writes-code-once, cached, sandboxed)
export { extractDeterministic } from "./extract/deterministic/extract.js";
export type { DeterministicExtractArgs } from "./extract/deterministic/extract.js";
export { inProcessSandbox } from "./extract/deterministic/sandbox.js";
export {
  createMemoryCache,
  createFileCache,
  extractorKey,
  CACHE_VERSION,
} from "./extract/deterministic/cache.js";
export {
  tooStrictSelectors,
  loosenCombinators,
  tooStrictFeedback,
} from "./extract/deterministic/selectorRepair.js";

export { engines, buildFallbackList } from "./engines/registry.js";
export { transformerStack, runPipeline } from "./pipeline/index.js";

export { createOpenAIProvider } from "./llm/provider.js";
export type { OpenAIProviderOptions } from "./llm/provider.js";

export { sinks, getSink } from "./export/registry.js";
