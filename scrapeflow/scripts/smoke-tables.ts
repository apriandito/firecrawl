/* HTML table extraction: headers, rows, colspan, dedup, largest-table pick. */
import assert from "node:assert";
import { extractTables, largestTable } from "../src/extract/tables.js";
import type { Document } from "../src/types.js";

let passed = 0;
const ok = (n: string) => (passed++, console.log(`  ✓ ${n}`));
const doc = (rawHtml: string): Document => ({ rawHtml, metadata: { url: "https://data.test" } });

function main() {
  console.log("table extractor:");

  // Standard thead + tbody.
  const t1 = `<table><caption>Inflasi</caption>
    <thead><tr><th>Provinsi</th><th>2023</th><th>2024</th></tr></thead>
    <tbody>
      <tr><td>Aceh</td><td>2.1</td><td>2.4</td></tr>
      <tr><td>Bali</td><td>3.0</td><td>2.8</td></tr>
    </tbody></table>`;
  const [tbl] = extractTables(doc(t1));
  assert.equal(tbl.caption, "Inflasi");
  assert.deepEqual(tbl.headers, ["Provinsi", "2023", "2024"]);
  assert.equal(tbl.rowCount, 2);
  assert.deepEqual(tbl.rows[0], { Provinsi: "Aceh", "2023": "2.1", "2024": "2.4" });
  ok("thead headers + tbody rows -> keyed records");

  // No thead: first all-<th> row becomes header.
  const t2 = `<table><tr><th>Kota</th><th>Populasi</th></tr>
    <tr><td>Bandung</td><td>2500000</td></tr></table>`;
  const [tbl2] = extractTables(doc(t2));
  assert.deepEqual(tbl2.headers, ["Kota", "Populasi"]);
  assert.equal(tbl2.rows[0].Populasi, "2500000");
  ok("no <thead>: first all-<th> row used as header");

  // colspan expansion.
  const t3 = `<table><tr><th>A</th><th colspan="2">B</th></tr>
    <tr><td>1</td><td>2</td><td>3</td></tr></table>`;
  const [tbl3] = extractTables(doc(t3));
  assert.equal(tbl3.colCount, 3);
  assert.equal(tbl3.rows[0].col_3 ?? tbl3.rows[0]["B_2"], "3");
  ok("colspan header expanded to match data columns");

  // Duplicate headers disambiguated.
  const t4 = `<table><tr><th>X</th><th>X</th></tr><tr><td>a</td><td>b</td></tr></table>`;
  const [tbl4] = extractTables(doc(t4));
  assert.deepEqual(tbl4.headers, ["X", "X_2"]);
  ok("duplicate header names disambiguated (X, X_2)");

  // Multiple tables + largestTable picks the biggest.
  const multi = t2 + t1;
  assert.equal(extractTables(doc(multi)).length, 2);
  assert.equal(largestTable(doc(multi))?.caption, "Inflasi");
  ok("extractTables finds all; largestTable picks the biggest");

  // Layout table (1 col) skipped by default minCols.
  const layout = `<table><tr><td>only one col</td></tr><tr><td>x</td></tr></table>`;
  assert.equal(extractTables(doc(layout)).length, 0);
  ok("single-column layout table skipped");

  console.log(`\nAll ${passed} table checks passed ✅`);
}

main();
