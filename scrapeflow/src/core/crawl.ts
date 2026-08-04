import type { Document, ScrapeOptions } from "../types.js";
import { scrapeUrl as defaultScrape } from "./scrape.js";
import { CrawlQueue } from "../lib/pool.js";
import { makeUrlFilter, normalizeUrl, type UrlFilter } from "../lib/urls.js";

export interface CrawlOptions extends UrlFilter {
  /** Max pages to scrape. Default 50. */
  limit?: number;
  /** Max link depth from the seed (seed = 0). Default 2. */
  maxDepth?: number;
  /** Parallel scrapes. Default 5. */
  concurrency?: number;
  /** Scrape options applied to every page. Links are always derived internally. */
  scrapeOptions?: ScrapeOptions;
  /** Inject a scrape implementation (used for testing / custom engines). */
  scrape?: (url: string, opts: ScrapeOptions) => Promise<Document>;
  log?: (msg: string) => void;
  /** Called as each page completes — enables streaming/progress. */
  onDocument?: (doc: Document, depth: number) => void;
}

export interface CrawlResult {
  documents: Document[];
  /** URLs that were discovered/visited but errored or were skipped by the cap. */
  errors: { url: string; error: string }[];
}

interface Task {
  url: string;
  depth: number;
}

/**
 * Breadth-first same-site crawl. Scrapes the seed, harvests links, and follows
 * them within depth/limit/filter bounds using a concurrency-limited queue that
 * dedups by normalized URL. Fetch strategy per page still comes from the engine
 * fallback list — crawl only orchestrates.
 */
export async function crawl(seed: string, opts: CrawlOptions = {}): Promise<CrawlResult> {
  const {
    limit = 50,
    maxDepth = 2,
    concurrency = 5,
    scrapeOptions = { formats: ["markdown"] },
    scrape = defaultScrape,
    log = () => {},
    onDocument,
  } = opts;

  const seedNorm = normalizeUrl(seed);
  if (!seedNorm) throw new Error(`invalid seed url: ${seed}`);

  const keep = makeUrlFilter(seedNorm, opts);
  const documents: Document[] = [];
  const errors: { url: string; error: string }[] = [];
  let scrapedCount = 0;

  // Ensure links are available to discover children, regardless of caller formats.
  const formats = new Set(scrapeOptions.formats ?? ["markdown"]);
  formats.add("links");
  const effectiveScrapeOpts: ScrapeOptions = {
    ...scrapeOptions,
    formats: [...formats] as ScrapeOptions["formats"],
  };

  let queue: CrawlQueue<Task>;

  const worker = async (task: Task): Promise<void> => {
    if (scrapedCount >= limit) return;
    try {
      const doc = await scrape(task.url, effectiveScrapeOpts);
      if (scrapedCount >= limit) return; // re-check after await
      scrapedCount++;
      documents.push(doc);
      onDocument?.(doc, task.depth);
      log(`[${scrapedCount}/${limit}] d${task.depth} ${task.url}`);

      if (task.depth < maxDepth) {
        for (const link of doc.links ?? []) {
          const n = normalizeUrl(link, task.url);
          if (n && keep(n) && scrapedCount + queue.seenCount < limit * 4) {
            queue.add({ url: n, depth: task.depth + 1 });
          }
        }
      }
    } catch (e) {
      errors.push({ url: task.url, error: (e as Error).message });
    }
  };

  queue = new CrawlQueue<Task>(concurrency, worker, (t) => t.url);
  queue.add({ url: seedNorm, depth: 0 });
  await queue.onIdle();

  return { documents: documents.slice(0, limit), errors };
}
