import { scrapeUrl } from "../core/scrape.js";
import { extractArticle } from "../extract/article.js";
import { extractProduct } from "../extract/product.js";
import { runAgent } from "../agent/runner.js";
import type { OpenAIProviderOptions } from "../llm/provider.js";
import type { OutputFormat, ScrapeOptions } from "../types.js";
import type { JobHandler } from "./types.js";

export interface DefaultHandlerDeps {
  /** LLM config for "agent" jobs (natural-language tasks). */
  llm?: OpenAIProviderOptions;
  agentMaxSteps?: number;
}

/**
 * The built-in job kinds. Each maps a job's `input` to one of ScrapeFlow's
 * use-cases — so a batch can mix plain scrapes, article/product extraction, and
 * full natural-language agent tasks, all running concurrently.
 */
export function createDefaultHandlers(deps: DefaultHandlerDeps = {}): Record<string, JobHandler> {
  return {
    // input: { url, formats?, onlyMainContent? }
    scrape: async (input, { progress }) => {
      const { url, ...rest } = input as { url: string } & ScrapeOptions;
      progress(`scraping ${url}`);
      return scrapeUrl(url, { formats: (rest.formats as OutputFormat[]) ?? ["markdown"], ...rest });
    },

    // input: { url }
    article: async (input, { progress }) => {
      const { url } = input as { url: string };
      progress(`article ${url}`);
      const doc = await scrapeUrl(url, { formats: ["rawHtml"] });
      return extractArticle(doc);
    },

    // input: { url }
    product: async (input, { progress }) => {
      const { url } = input as { url: string };
      progress(`product ${url}`);
      const doc = await scrapeUrl(url, { formats: ["rawHtml"] });
      return extractProduct(doc);
    },

    // input: { task } — a natural-language agent job (needs an LLM key)
    agent: async (input, { progress }) => {
      const { task } = input as { task: string };
      progress(`agent: ${task.slice(0, 60)}`);
      const res = await runAgent({ task, llm: deps.llm, maxSteps: deps.agentMaxSteps });
      return { text: res.text, records: res.records, files: res.files.map((f) => f.name) };
    },
  };
}
