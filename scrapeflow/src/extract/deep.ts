import type { Document, ScrapeOptions } from "../types.js";
import { scrapeUrl as defaultScrape } from "../core/scrape.js";
import { mapLimit } from "../lib/pool.js";
import { extractTables, largestTable } from "./tables.js";
import { tidyTable, type TidyColumn, type TidyOptions, type TidyTable } from "./tidy.js";
import type { CellType } from "../lib/coerce.js";

/**
 * Combine data spread across many pages into ONE tidy dataset — the
 * "multiple halaman jadi 1" capability. Each source is scraped + its table
 * tidied concurrently, then merged:
 *   - "union": stack rows (paginated lists / same schema across pages)
 *   - "join":  widen by a key column (e.g. one page per year, joined by region)
 */

export interface DeepSource {
  url: string;
  /** Tag for this page — becomes the source column (union) or value suffix (join). */
  label?: string;
  /** Which table on the page (default: the largest). */
  tableIndex?: number;
}

export interface DeepExtractOptions {
  merge: "union" | "join";
  /** Join key: a column name, or "@first" to use each table's first column. */
  key?: string;
  concurrency?: number;
  scrape?: (url: string, opts: ScrapeOptions) => Promise<Document>;
  tidy?: TidyOptions;
  /** Union only: add a column holding each row's source label/url. */
  sourceColumn?: string;
  log?: (msg: string) => void;
}

export interface DeepExtractResult {
  table: TidyTable;
  merge: "union" | "join";
  sources: { url: string; label?: string; rowCount: number; error?: string }[];
  /** Join only: how many keys appeared in more than one source. */
  matchedKeys?: number;
}

interface SourceTable {
  src: DeepSource;
  tidy: TidyTable | null;
  error?: string;
}

async function fetchTidy(
  src: DeepSource,
  scrape: (url: string, opts: ScrapeOptions) => Promise<Document>,
  tidyOpts: TidyOptions,
): Promise<SourceTable> {
  try {
    const doc = await scrape(src.url, { formats: ["rawHtml"] });
    const raw =
      src.tableIndex !== undefined
        ? extractTables(doc)[src.tableIndex]
        : largestTable(doc);
    if (!raw) return { src, tidy: null, error: "no table found" };
    return { src, tidy: tidyTable(raw, tidyOpts) };
  } catch (e) {
    return { src, tidy: null, error: (e as Error).message };
  }
}

export async function deepExtract(
  sources: DeepSource[],
  opts: DeepExtractOptions,
): Promise<DeepExtractResult> {
  const scrape = opts.scrape ?? defaultScrape;
  const tidyOpts: TidyOptions = { snakeCase: true, ...opts.tidy };
  const log = opts.log ?? (() => {});

  const results = await mapLimit(sources, opts.concurrency ?? 4, (src) => {
    log(`fetch ${src.label ?? src.url}`);
    return fetchTidy(src, scrape, tidyOpts);
  });

  const ok = results.filter((r): r is SourceTable & { tidy: TidyTable } => !!r.tidy);
  const sourceReport = results.map((r) => ({
    url: r.src.url,
    label: r.src.label,
    rowCount: r.tidy?.rowCount ?? 0,
    error: r.error,
  }));

  const table =
    opts.merge === "join"
      ? mergeJoin(ok, opts)
      : mergeUnion(ok, opts);

  return {
    table: table.table,
    merge: opts.merge,
    sources: sourceReport,
    matchedKeys: table.matchedKeys,
  };
}

// ---- union -----------------------------------------------------------------

function mergeUnion(
  sources: (SourceTable & { tidy: TidyTable })[],
  opts: DeepExtractOptions,
): { table: TidyTable; matchedKeys?: number } {
  const colType = new Map<string, CellType>();
  const order: string[] = [];
  const add = (name: string, type: CellType) => {
    if (!colType.has(name)) {
      colType.set(name, type);
      order.push(name);
    }
  };
  if (opts.sourceColumn) add(opts.sourceColumn, "text");
  for (const s of sources) for (const c of s.tidy.columns) add(c.name, c.type);

  const rows: Record<string, string | number | null>[] = [];
  for (const s of sources) {
    const tag = s.src.label ?? s.src.url;
    for (const r of s.tidy.rows) {
      const row: Record<string, string | number | null> = {};
      for (const name of order) row[name] = null;
      if (opts.sourceColumn) row[opts.sourceColumn] = tag;
      for (const c of s.tidy.columns) row[c.name] = r[c.name];
      rows.push(row);
    }
  }

  const columns: TidyColumn[] = order.map((name) => ({ name, type: colType.get(name)! }));
  return { table: { caption: null, columns, rows, rowCount: rows.length } };
}

// ---- join ------------------------------------------------------------------

function keyNameFor(t: TidyTable, key: string): string | null {
  if (key === "@first") return t.columns[0]?.name ?? null;
  return t.columns.some((c) => c.name === key) ? key : null;
}

function mergeJoin(
  sources: (SourceTable & { tidy: TidyTable })[],
  opts: DeepExtractOptions,
): { table: TidyTable; matchedKeys: number } {
  if (!opts.key) throw new Error('deepExtract join requires opts.key (a column name or "@first")');

  const outKeyName = sources.length ? keyNameFor(sources[0].tidy, opts.key) ?? "key" : "key";
  const colType = new Map<string, CellType>([[outKeyName, sources[0]?.tidy.columns[0]?.type ?? "text"]]);
  const order: string[] = [outKeyName];
  const map = new Map<string, Record<string, string | number | null>>();
  const keySourceCount = new Map<string, Set<number>>();

  sources.forEach((s, i) => {
    const kName = keyNameFor(s.tidy, opts.key!);
    if (!kName) return;
    const suffix = s.src.label ? `_${s.src.label}` : sources.length > 1 ? `_${i + 1}` : "";
    const valueCols = s.tidy.columns.filter((c) => c.name !== kName);

    for (const c of valueCols) {
      const outName = `${c.name}${suffix}`;
      if (!colType.has(outName)) {
        colType.set(outName, c.type);
        order.push(outName);
      }
    }

    for (const r of s.tidy.rows) {
      const kv = r[kName];
      if (kv === null || kv === undefined || kv === "") continue;
      const kStr = String(kv);
      let rec = map.get(kStr);
      if (!rec) {
        rec = { [outKeyName]: kv };
        map.set(kStr, rec);
      }
      for (const c of valueCols) rec[`${c.name}${suffix}`] = r[c.name];
      if (!keySourceCount.has(kStr)) keySourceCount.set(kStr, new Set());
      keySourceCount.get(kStr)!.add(i);
    }
  });

  // Fill missing cells with null for a rectangular table.
  const rows = [...map.values()].map((rec) => {
    const full: Record<string, string | number | null> = {};
    for (const name of order) full[name] = rec[name] ?? null;
    return full;
  });

  const matchedKeys = [...keySourceCount.values()].filter((set) => set.size > 1).length;
  const columns: TidyColumn[] = order.map((name) => ({ name, type: colType.get(name)! }));
  return { table: { caption: null, columns, rows, rowCount: rows.length }, matchedKeys };
}
