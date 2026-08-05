/* Tidy layer: type inference + coercion + footnote stripping (tame data). */
import assert from "node:assert";
import { parseNumber, parsePercent, stripFootnotes, classifyValue } from "../src/lib/coerce.js";
import { tidyTable } from "../src/extract/tidy.js";
import type { ExtractedTable } from "../src/extract/tables.js";

let passed = 0;
const ok = (n: string) => (passed++, console.log(`  ✓ ${n}`));

function testPrimitives() {
  console.log("coerce primitives:");
  assert.equal(parseNumber("8,232,000,000"), 8232000000);
  assert.equal(parseNumber("341,784,857"), 341784857);
  assert.equal(parseNumber("2,4"), 2.4); // Indonesian decimal
  assert.equal(parseNumber("1.250"), 1250); // thousands
  assert.equal(parseNumber("4.8"), 4.8); // decimal
  assert.equal(parseNumber("-3,5"), -3.5);
  assert.equal(parseNumber("N/A"), null);
  ok("parseNumber handles thousands/decimal/negatives, null on junk");

  assert.equal(parsePercent("17.3%"), 17.3);
  assert.equal(parsePercent("no percent"), null);
  ok("parsePercent extracts the number");

  assert.equal(stripFootnotes("UN projection[1][3]"), "UN projection");
  assert.equal(stripFootnotes("Value[b]"), "Value");
  ok("stripFootnotes removes [refs]");

  assert.equal(classifyValue("13 Jun 2025"), "date");
  assert.equal(classifyValue("100%"), "percent");
  assert.equal(classifyValue("1,404,890,000"), "number");
  assert.equal(classifyValue("China"), "text");
  ok("classifyValue picks percent/date/number/text correctly");
}

function testTidy() {
  console.log("tidyTable:");
  const raw: ExtractedTable = {
    caption: "Populasi",
    headers: ["Location", "Population", "% ofworld", "Date", "Source[1]"],
    rows: [
      { Location: "India", Population: "1,429,404,000", "% ofworld": "17.3%", Date: "1 Jul 2026", "Source[1]": "Official[4]" },
      { Location: "China", Population: "1,404,890,000", "% ofworld": "17.0%", Date: "31 Dec 2025", "Source[1]": "Estimate[5]" },
      { Location: "USA", Population: "341,784,857", "% ofworld": "4.1%", Date: "1 Jul 2025", "Source[1]": "Estimate[6]" },
    ],
    rowCount: 3,
    colCount: 5,
  };

  const t = tidyTable(raw);
  const types = Object.fromEntries(t.columns.map((c) => [c.name, c.type]));
  assert.equal(types["Population"], "number");
  assert.equal(types["% ofworld"], "percent");
  assert.equal(types["Date"], "date");
  assert.equal(types["Location"], "text");
  ok("infers column types (number/percent/date/text)");

  // Cells are coerced to real types, footnotes stripped.
  assert.strictEqual(t.rows[0].Population, 1429404000);
  assert.strictEqual(t.rows[0]["% ofworld"], 17.3);
  assert.strictEqual(t.rows[0].Date, "2026-07-01");
  assert.equal(t.rows[0]["Source"], "Official"); // header [1] + cell [4] stripped
  ok("coerces cells to typed values, ISO dates, footnotes removed");

  // snake_case option for SQL/DuckDB.
  const s = tidyTable(raw, { snakeCase: true });
  assert.ok(s.columns.some((c) => c.name === "of_world" || c.name === "ofworld"));
  assert.ok(s.columns.some((c) => c.name === "population"));
  ok("snakeCase option produces SQL-friendly column names");

  console.log(`\nAll ${passed} tidy checks passed ✅`);
}

testPrimitives();
testTidy();
