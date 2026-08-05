import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import type { Document } from "../types.js";

/**
 * Extract HTML <table> data into structured rows. Essential for statistics/data
 * sites (BPS, Wikipedia, gov portals) where the payload lives in tables, not
 * prose. Deterministic; site-agnostic. `colspan` cells are repeated across the
 * span; `rowspan` is NOT yet propagated down rows (a known limitation for tables
 * that group categories with rowspan — see review notes).
 */
export interface ExtractedTable {
  caption: string | null;
  headers: string[];
  rows: Record<string, string>[];
  rowCount: number;
  colCount: number;
}

function cellText($: cheerio.CheerioAPI, el: Element): string {
  return $(el).text().replace(/\s+/g, " ").trim();
}

/** Expand a <tr> into a flat cell list, repeating colspan cells. */
function rowCells($: cheerio.CheerioAPI, tr: Element): string[] {
  const cells: string[] = [];
  $(tr)
    .children("td,th")
    .each((_, td) => {
      const text = cellText($, td);
      const span = Math.max(1, parseInt($(td).attr("colspan") ?? "1", 10) || 1);
      for (let i = 0; i < span; i++) cells.push(text);
    });
  return cells;
}

function parseTable($: cheerio.CheerioAPI, table: Element): ExtractedTable | null {
  const $t = $(table);
  const caption = $t.children("caption").first().text().replace(/\s+/g, " ").trim() || null;

  // Header row: an explicit <thead> row, else the first row that is all <th>,
  // else the first row.
  const allRows = $t.find("tr").toArray();
  if (allRows.length === 0) return null;

  let headerRow: Element | undefined;
  const theadTr = $t.find("thead tr").first();
  if (theadTr.length) headerRow = theadTr.get(0);
  if (!headerRow) {
    headerRow = allRows.find((tr) => {
      const kids = $(tr).children("td,th");
      return kids.length > 0 && kids.toArray().every((c) => c.tagName === "th");
    });
  }
  const headerIsFirst = !headerRow;
  if (!headerRow) headerRow = allRows[0];

  let headers = rowCells($, headerRow);
  const bodyRows = allRows.filter((tr) => tr !== headerRow);

  const dataRows = headerIsFirst
    ? bodyRows // first row consumed as header
    : bodyRows;

  const colCount = Math.max(headers.length, ...dataRows.map((r) => rowCells($, r).length), 0);
  // Pad/patch headers to colCount with generic names.
  if (headers.length < colCount) {
    for (let i = headers.length; i < colCount; i++) headers.push(`col_${i + 1}`);
  }
  headers = headers.map((h, i) => h || `col_${i + 1}`);
  // Disambiguate duplicate header names.
  const seen = new Map<string, number>();
  headers = headers.map((h) => {
    const n = seen.get(h) ?? 0;
    seen.set(h, n + 1);
    return n === 0 ? h : `${h}_${n + 1}`;
  });

  const rows: Record<string, string>[] = [];
  for (const tr of dataRows) {
    const cells = rowCells($, tr);
    if (cells.length === 0 || cells.every((c) => c === "")) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = cells[i] ?? ""));
    rows.push(row);
  }

  if (rows.length === 0) return null;
  return { caption, headers, rows, rowCount: rows.length, colCount: headers.length };
}

/** Extract every data table on the page (skips tiny layout tables). */
export function extractTables(doc: Document, opts: { minRows?: number; minCols?: number } = {}): ExtractedTable[] {
  const html = doc.rawHtml ?? doc.html ?? "";
  const $ = cheerio.load(html);
  const minRows = opts.minRows ?? 1;
  const minCols = opts.minCols ?? 2;

  const out: ExtractedTable[] = [];
  $("table").each((_, table) => {
    // Skip nested layout tables and tables without real rows.
    const parsed = parseTable($, table);
    if (parsed && parsed.rowCount >= minRows && parsed.colCount >= minCols) {
      out.push(parsed);
    }
  });
  return out;
}

/** The largest table by cell count — usually the primary data table. */
export function largestTable(doc: Document): ExtractedTable | null {
  const tables = extractTables(doc);
  if (tables.length === 0) return null;
  return tables.reduce((best, t) =>
    t.rowCount * t.colCount > best.rowCount * best.colCount ? t : best,
  );
}
