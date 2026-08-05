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

// Phase 3 — discovery & multi-page
export { mapSite, parseSitemap, parseRobotsSitemaps } from "./core/map.js";
export type { MapOptions, MapEntry } from "./core/map.js";
export { crawl } from "./core/crawl.js";
export type { CrawlOptions, CrawlResult } from "./core/crawl.js";
export {
  normalizeUrl,
  sameSite,
  matchesPrefix,
  makeUrlFilter,
} from "./lib/urls.js";
export { normalizeDate } from "./lib/dates.js";
export type { NormalizedDate } from "./lib/dates.js";

// Universal article extractor (single code path across news sites)
export { extractArticle } from "./extract/article.js";
export type { Article } from "./extract/article.js";

// Universal product extractor (single code path across e-commerce sites)
export { extractProduct } from "./extract/product.js";
export type { Product } from "./extract/product.js";

// Table extractor (HTML tables -> structured rows; for data/stats sites)
export { extractTables, largestTable } from "./extract/tables.js";
export type { ExtractedTable } from "./extract/tables.js";

// Tidy layer — clean names, inferred types, coerced cells (analysis-ready)
export { tidyTable } from "./extract/tidy.js";
export type { TidyTable, TidyColumn, TidyOptions } from "./extract/tidy.js";

// Deep extract — merge tables across many pages into one dataset
export { deepExtract } from "./extract/deep.js";
export type {
  DeepSource,
  DeepExtractOptions,
  DeepExtractResult,
} from "./extract/deep.js";
export {
  parseNumber,
  parsePercent,
  stripFootnotes,
  inferColumnType,
  coerceCell,
} from "./lib/coerce.js";
export type { CellType } from "./lib/coerce.js";

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

// Multi-job orchestration (run many scrapers/agents concurrently)
export { JobManager } from "./jobs/manager.js";
export type { JobManagerOptions } from "./jobs/manager.js";
export { InMemoryJobStore } from "./jobs/store.js";
export { createDefaultHandlers } from "./jobs/handlers.js";
export type {
  JobInput,
  JobRecord,
  JobStatus,
  JobHandler,
  JobEvent,
  JobStore,
} from "./jobs/types.js";
export { mapLimit } from "./lib/pool.js";

// Phase 4 — agentic
export { runAgent } from "./agent/runner.js";
export type { RunAgentOptions, RunAgentResult } from "./agent/runner.js";
export { AgentSession } from "./agent/session.js";
export { buildAgentTools } from "./agent/tools.js";
export type { ToolDeps } from "./agent/tools.js";
export { buildRecordSchema, hasSignal } from "./lib/fieldSchema.js";
export type { FieldSpec, FieldType } from "./lib/fieldSchema.js";
export { createOpenAIModel } from "./llm/provider.js";
