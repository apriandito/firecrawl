import { tool } from "ai";
import { z } from "zod";
import type { Document, ScrapeOptions } from "../types.js";
import type { LLMProvider } from "../core/ports.js";
import { scrapeUrl as defaultScrape } from "../core/scrape.js";
import { mapSite as defaultMapSite, type MapOptions } from "../core/map.js";
import { extractStructured } from "../core/extract.js";
import { getSink } from "../export/registry.js";
import { buildRecordSchema, hasSignal, type FieldSpec } from "../lib/fieldSchema.js";
import { mapLimit } from "../lib/pool.js";
import { AgentSession } from "./session.js";

export interface ToolDeps {
  llm: LLMProvider;
  scrape?: (url: string, opts: ScrapeOptions) => Promise<Document>;
  mapSite?: (seed: string, opts: MapOptions) => Promise<{ url: string }[]>;
  /** How many pages to scrape/extract concurrently. */
  concurrency?: number;
}

/**
 * Builds the tool set bound to one session. Returns both a plain `impl` (call
 * directly, or in tests) and `aiTools` (for the LLM agent loop). Same logic,
 * two front doors — the whole point of the AgentTool seam.
 */
export function buildAgentTools(session: AgentSession, deps: ToolDeps) {
  const scrape = deps.scrape ?? defaultScrape;
  const mapSite = deps.mapSite ?? ((s, o) => defaultMapSite(s, o));
  const concurrency = deps.concurrency ?? 5;

  const impl = {
    async map_site(args: { seed: string; limit?: number; prefix?: string }) {
      const entries = await mapSite(args.seed, {
        limit: args.limit ?? 25,
        prefix: args.prefix,
      });
      const urls = entries.map((e) => e.url);
      session.note(`map_site(${args.seed}) -> ${urls.length} urls`);
      return { count: urls.length, urls };
    },

    async scrape_pages(args: { urls: string[] }) {
      const failed: { url: string; error: string }[] = [];
      await mapLimit(args.urls, concurrency, async (url) => {
        try {
          const doc = await scrape(url, { formats: ["markdown"] });
          session.addDocument(doc);
        } catch (e) {
          failed.push({ url, error: (e as Error).message });
        }
      });
      session.note(`scrape_pages -> ${session.documents.size} stored, ${failed.length} failed`);
      return { scraped: session.documents.size, failed };
    },

    async extract_records(args: { fields: FieldSpec; prompt?: string; urls?: string[] }) {
      const schema = buildRecordSchema(args.fields);
      const docs = args.urls
        ? args.urls.map((u) => session.documents.get(u)).filter((d): d is Document => !!d)
        : [...session.documents.values()];

      const rows = await mapLimit(docs, concurrency, async (doc) => {
        try {
          const rec = (await extractStructured({
            document: doc,
            schema,
            prompt: args.prompt,
            llm: deps.llm,
          })) as Record<string, unknown>;
          return { rec, url: doc.metadata.url };
        } catch {
          return null;
        }
      });

      // Relevance is judged on the extracted FIELDS only; the source url is
      // attached afterward so it never counts as a false signal.
      const kept = rows
        .filter((r): r is { rec: Record<string, unknown>; url: string } => !!r && hasSignal(r.rec))
        .map(({ rec, url }) => ("url" in args.fields ? rec : { ...rec, __url: url }));
      session.addRecords(kept);
      session.note(`extract_records -> +${kept.length} rows (total ${session.records.length})`);
      return { added: kept.length, total: session.records.length, sample: kept.slice(0, 3) };
    },

    async export_xlsx(args: { filename?: string; sheetName?: string }) {
      const name = args.filename ?? "output.xlsx";
      const sink = getSink("xlsx");
      const bytes = (await sink.write([], {
        records: session.records,
        sheetName: args.sheetName ?? "Data",
      })) as Buffer;
      session.files.push({ name, bytes });
      session.note(`export_xlsx -> ${name} (${session.records.length} rows)`);
      return { file: name, rows: session.records.length, bytes: bytes.length };
    },
  };

  const aiTools = {
    map_site: tool({
      description:
        "Discover URLs on a website via its sitemap and homepage links. Use first to find pages to scrape.",
      parameters: z.object({
        seed: z.string().url().describe("The site or section URL to map"),
        limit: z.number().int().positive().max(200).optional(),
        prefix: z
          .string()
          .optional()
          .describe("Only keep URLs under this path prefix, e.g. a section"),
      }),
      execute: (a) => impl.map_site(a),
    }),
    scrape_pages: tool({
      description: "Scrape a list of URLs to markdown and store them for extraction.",
      parameters: z.object({ urls: z.array(z.string().url()).min(1).max(100) }),
      execute: (a) => impl.scrape_pages(a),
    }),
    extract_records: tool({
      description:
        "Extract one structured record per scraped page into a table. Define the columns via `fields`.",
      parameters: z.object({
        fields: z
          .record(z.enum(["string", "number", "boolean"]))
          .describe('Column name -> type, e.g. {"title":"string","date":"string"}'),
        prompt: z.string().optional().describe("What to extract / relevance filter"),
        urls: z.array(z.string().url()).optional(),
      }),
      execute: (a) => impl.extract_records(a),
    }),
    export_xlsx: tool({
      description: "Write all extracted records to an .xlsx file. Call last.",
      parameters: z.object({
        filename: z.string().optional(),
        sheetName: z.string().optional(),
      }),
      execute: (a) => impl.export_xlsx(a),
    }),
  };

  return { impl, aiTools };
}
