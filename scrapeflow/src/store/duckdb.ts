import type { TidyTable } from "../extract/tidy.js";
import type { CellType } from "../lib/coerce.js";

/**
 * DuckDB landing store for scraped datasets. DuckDB is an embedded analytical
 * database — no server — so a local file (or :memory:) becomes a queryable data
 * warehouse: land a TidyTable, then run SQL joins/aggregations and export to
 * CSV/Parquet. The native dep is loaded lazily, so the rest of ScrapeFlow works
 * without it installed.
 */

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function duckType(type: CellType): string {
  // Dates are stored as ISO VARCHAR (clean round-trip, sorts correctly); numeric
  // types become DOUBLE. Keep it simple and portable.
  return type === "number" || type === "percent" ? "DOUBLE" : "VARCHAR";
}

function normalizeValue(v: unknown): unknown {
  if (typeof v === "bigint") return Number(v);
  // DuckDB returns DATE as { days } and some temporal types as wrappers.
  if (v && typeof v === "object" && "days" in (v as Record<string, unknown>)) {
    const days = Number((v as { days: number }).days);
    return new Date(days * 86_400_000).toISOString().slice(0, 10);
  }
  return v;
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = normalizeValue(v);
  return out;
}

export class DuckDBDatasetStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private constructor(private inst: any, private conn: any) {}

  /** Open a DuckDB database file (or ":memory:"). */
  static async open(path = ":memory:"): Promise<DuckDBDatasetStore> {
    let mod: typeof import("@duckdb/node-api");
    try {
      mod = await import("@duckdb/node-api");
    } catch {
      throw new Error(
        "DuckDBDatasetStore needs the optional dependency @duckdb/node-api (npm i @duckdb/node-api)",
      );
    }
    const inst = await mod.DuckDBInstance.create(path);
    const conn = await inst.connect();
    return new DuckDBDatasetStore(inst, conn);
  }

  /** Create a typed table from a TidyTable and insert its rows. */
  async createFromTidy(
    table: string,
    tidy: TidyTable,
    opts: { replace?: boolean } = {},
  ): Promise<number> {
    const ident = quoteIdent(table);
    if (opts.replace) await this.conn.run(`DROP TABLE IF EXISTS ${ident}`);
    const cols = tidy.columns.map((c) => `${quoteIdent(c.name)} ${duckType(c.type)}`).join(", ");
    await this.conn.run(`CREATE TABLE ${ident} (${cols})`);

    const placeholders = tidy.columns.map(() => "?").join(", ");
    const sql = `INSERT INTO ${ident} VALUES (${placeholders})`;
    for (const row of tidy.rows) {
      const values = tidy.columns.map((c) => {
        const v = row[c.name];
        return v === undefined ? null : v;
      });
      await this.conn.run(sql, values);
    }
    return tidy.rows.length;
  }

  /** Run SQL and return rows as plain objects (BigInt/DATE normalized). */
  async query(sql: string): Promise<Record<string, unknown>[]> {
    const reader = await this.conn.runAndReadAll(sql);
    return (reader.getRowObjects() as Record<string, unknown>[]).map(normalizeRow);
  }

  /** Run SQL expecting a single row (or undefined). */
  async queryOne(sql: string): Promise<Record<string, unknown> | undefined> {
    return (await this.query(sql))[0];
  }

  async exportCsv(table: string, path: string): Promise<void> {
    const p = path.replace(/'/g, "''");
    await this.conn.run(`COPY ${quoteIdent(table)} TO '${p}' (HEADER, DELIMITER ',')`);
  }

  async exportParquet(table: string, path: string): Promise<void> {
    const p = path.replace(/'/g, "''");
    await this.conn.run(`COPY ${quoteIdent(table)} TO '${p}' (FORMAT PARQUET)`);
  }

  async tables(): Promise<string[]> {
    const rows = await this.query("SELECT table_name FROM information_schema.tables ORDER BY 1");
    return rows.map((r) => String(r.table_name));
  }

  close(): void {
    this.conn?.closeSync?.();
    this.inst?.closeSync?.();
  }
}
