/* DuckDB dataset store: land a TidyTable, query with SQL, export CSV.
   Requires the optional dep @duckdb/node-api. Run with: npm run test:duck */
import assert from "node:assert";
import { readFile, rm } from "node:fs/promises";
import { DuckDBDatasetStore } from "../src/store/duckdb.js";
import type { TidyTable } from "../src/extract/tidy.js";

let passed = 0;
const ok = (n: string) => (passed++, console.log(`  ✓ ${n}`));

const dataset: TidyTable = {
  caption: "inflasi",
  columns: [
    { name: "provinsi", type: "text" },
    { name: "inflasi_2023", type: "number" },
    { name: "inflasi_2024", type: "number" },
    { name: "tanggal", type: "date" },
  ],
  rows: [
    { provinsi: "Aceh", inflasi_2023: 2.1, inflasi_2024: 2.4, tanggal: "2024-01-01" },
    { provinsi: "Bali", inflasi_2023: 3.0, inflasi_2024: 2.8, tanggal: "2024-01-01" },
    { provinsi: "Papua", inflasi_2023: null, inflasi_2024: 1.5, tanggal: "2024-01-01" },
  ],
  rowCount: 3,
};

async function main() {
  console.log("DuckDBDatasetStore:");
  const store = await DuckDBDatasetStore.open(":memory:");

  const n = await store.createFromTidy("inflasi", dataset, { replace: true });
  assert.equal(n, 3);
  ok("created a typed table from a TidyTable (3 rows)");

  const count = await store.queryOne("SELECT count(*) AS n FROM inflasi");
  assert.equal(Number(count!.n), 3);
  ok("count query works (BigInt normalized to number)");

  // Real analytical SQL over landed data: average 2024 inflation, rounded.
  const avg = await store.queryOne("SELECT round(avg(inflasi_2024), 3) AS a FROM inflasi");
  assert.equal(Number(avg!.a), 2.233);
  ok("aggregation over typed numeric columns (avg inflasi_2024)");

  // NULLs preserved and filterable.
  const missing = await store.query("SELECT provinsi FROM inflasi WHERE inflasi_2023 IS NULL");
  assert.deepEqual(missing.map((r) => r.provinsi), ["Papua"]);
  ok("NULLs preserved (Papua has no 2023 value)");

  // Ordering + typed comparison.
  const top = await store.queryOne("SELECT provinsi FROM inflasi ORDER BY inflasi_2024 DESC LIMIT 1");
  assert.equal(top!.provinsi, "Bali");
  ok("ORDER BY on numeric column returns Bali (highest 2024)");

  // Export to CSV.
  const csvPath = "/tmp/scrapeflow-inflasi.csv";
  await store.exportCsv("inflasi", csvPath);
  const csv = await readFile(csvPath, "utf8");
  assert.match(csv, /provinsi,inflasi_2023,inflasi_2024,tanggal/);
  assert.match(csv, /Aceh,2.1,2.4/);
  ok("exports a clean CSV (header + typed values)");
  await rm(csvPath, { force: true });

  store.close();
  console.log(`\nAll ${passed} DuckDB checks passed ✅`);
}

main().catch((e) => {
  console.error("\n❌ FAILED:", e);
  process.exit(1);
});
