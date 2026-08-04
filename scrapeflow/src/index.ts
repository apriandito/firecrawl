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
} from "./core/ports.js";

export { scrapeUrl, NoEnginesLeftError } from "./core/scrape.js";
export { extractStructured } from "./core/extract.js";
export type { ExtractArgs } from "./core/extract.js";

export { engines, buildFallbackList } from "./engines/registry.js";
export { transformerStack, runPipeline } from "./pipeline/index.js";

export { createOpenAIProvider } from "./llm/provider.js";
export type { OpenAIProviderOptions } from "./llm/provider.js";

export { sinks, getSink } from "./export/registry.js";
