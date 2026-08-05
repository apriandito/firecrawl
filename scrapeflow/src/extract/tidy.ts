import type { ExtractedTable } from "./tables.js";
import { coerceCell, inferColumnType, stripFootnotes, type CellType } from "../lib/coerce.js";

/**
 * A "tidy" table: clean column names, an inferred type per column, and cells
 * coerced to those types (numbers as numbers, dates as ISO, footnotes stripped,
 * blanks as null). Tidy-data shape — one variable per column, one observation
 * per row — ready for analysis/DuckDB without further cleaning.
 */
export interface TidyColumn {
  name: string;
  type: CellType;
}

export interface TidyTable {
  caption: string | null;
  columns: TidyColumn[];
  rows: Record<string, string | number | null>[];
  rowCount: number;
}

/** Normalize a header: strip footnotes, collapse whitespace, trim. */
function cleanHeader(h: string): string {
  return stripFootnotes(h).replace(/\s+/g, " ").trim() || "col";
}

export interface TidyOptions {
  /** snake_case the column names (e.g. for SQL/DuckDB). Default false. */
  snakeCase?: boolean;
  /** Type-inference threshold (fraction of cells). Default 0.7. */
  threshold?: number;
}

function snake(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_") || "col";
}

/** Turn a raw ExtractedTable into a typed, cleaned TidyTable. */
export function tidyTable(table: ExtractedTable, opts: TidyOptions = {}): TidyTable {
  const rename = opts.snakeCase ? (h: string) => snake(cleanHeader(h)) : cleanHeader;

  // Clean + de-duplicate column names.
  const seen = new Map<string, number>();
  const names = table.headers.map((h) => {
    const base = rename(h);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}_${n + 1}`;
  });

  // Infer a type per column from its raw values.
  const columns: TidyColumn[] = names.map((name, i) => {
    const raw = table.rows.map((r) => r[table.headers[i]] ?? "");
    return { name, type: inferColumnType(raw, opts.threshold) };
  });

  const rows = table.rows.map((r) => {
    const out: Record<string, string | number | null> = {};
    columns.forEach((col, i) => {
      out[col.name] = coerceCell(String(r[table.headers[i]] ?? ""), col.type);
    });
    return out;
  });

  return { caption: table.caption, columns, rows, rowCount: rows.length };
}
