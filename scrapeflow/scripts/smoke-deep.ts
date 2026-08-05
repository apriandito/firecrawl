/* deepExtract: merge tables across pages (union + join). Fake scrape, no net. */
import assert from "node:assert";
import { deepExtract, type DeepSource } from "../src/extract/deep.js";
import type { Document, ScrapeOptions } from "../src/types.js";

let passed = 0;
const ok = (n: string) => (passed++, console.log(`  ✓ ${n}`));

// Build a fake page whose rawHtml is a simple data table.
const page =
  (headers: string[], rows: string[][]) =>
  async (_url: string, _o: ScrapeOptions): Promise<Document> => ({
    rawHtml: `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
    metadata: { url: _url },
  });

// A scrape that dispatches by URL to different fake tables.
function router(map: Record<string, ReturnType<typeof page>>) {
  return (url: string, o: ScrapeOptions) => map[url](url, o);
}

async function testUnion() {
  console.log("deepExtract union:");
  const scrape = router({
    "p1": page(["Kota", "Populasi"], [["Bandung", "2.500.000"], ["Medan", "2.400.000"]]),
    "p2": page(["Kota", "Populasi"], [["Surabaya", "2.800.000"]]),
  });
  const sources: DeepSource[] = [
    { url: "p1", label: "hal1" },
    { url: "p2", label: "hal2" },
  ];
  const res = await deepExtract(sources, { merge: "union", sourceColumn: "sumber", scrape });

  assert.equal(res.table.rowCount, 3);
  assert.deepEqual(res.table.columns.map((c) => c.name), ["sumber", "kota", "populasi"]);
  assert.equal(res.table.columns.find((c) => c.name === "populasi")!.type, "number");
  assert.strictEqual(res.table.rows[0].populasi, 2500000); // tidy: number
  assert.equal(res.table.rows[0].sumber, "hal1");
  assert.equal(res.table.rows[2].sumber, "hal2");
  ok("stacks rows from all pages, adds source column, keeps types");
}

async function testJoin() {
  console.log("deepExtract join (BPS-style: inflasi per provinsi per tahun):");
  const scrape = router({
    "y2023": page(["Provinsi", "Inflasi"], [["Aceh", "2,1"], ["Bali", "3,0"]]),
    "y2024": page(["Provinsi", "Inflasi"], [["Aceh", "2,4"], ["Bali", "2,8"], ["Papua", "1,5"]]),
  });
  const res = await deepExtract(
    [
      { url: "y2023", label: "2023" },
      { url: "y2024", label: "2024" },
    ],
    { merge: "join", key: "provinsi", scrape },
  );

  assert.deepEqual(res.table.columns.map((c) => c.name), ["provinsi", "inflasi_2023", "inflasi_2024"]);
  const byProv = (p: string) => res.table.rows.find((r) => r.provinsi === p)!;
  assert.deepEqual(byProv("Aceh"), { provinsi: "Aceh", inflasi_2023: 2.1, inflasi_2024: 2.4 });
  assert.deepEqual(byProv("Bali"), { provinsi: "Bali", inflasi_2023: 3.0, inflasi_2024: 2.8 });
  // Papua only exists in 2024 -> 2023 value is null (rectangular table).
  assert.deepEqual(byProv("Papua"), { provinsi: "Papua", inflasi_2023: null, inflasi_2024: 1.5 });
  assert.equal(res.table.rowCount, 3);
  assert.equal(res.matchedKeys, 2); // Aceh + Bali present in both years
  ok("joins by key into a wide table (inflasi_2023/2024), null for missing");

  // "@first" resolves the key from each table's first column.
  const res2 = await deepExtract(
    [{ url: "y2023", label: "2023" }, { url: "y2024", label: "2024" }],
    { merge: "join", key: "@first", scrape },
  );
  assert.equal(res2.table.rowCount, 3);
  assert.ok(res2.table.columns.some((c) => c.name === "inflasi_2024"));
  ok('key "@first" uses each table\'s first column');
}

async function testResilience() {
  console.log("deepExtract resilience:");
  const scrape = router({
    "good": page(["A", "B"], [["1", "2"]]),
    "bad": async () => ({ rawHtml: "<p>no table here</p>", metadata: { url: "bad" } }),
  });
  const res = await deepExtract([{ url: "good" }, { url: "bad" }], { merge: "union", scrape });
  assert.equal(res.table.rowCount, 1); // only the good page contributed
  assert.equal(res.sources.find((s) => s.url === "bad")!.error, "no table found");
  ok("a page with no table is reported, others still merge");
}

async function main() {
  await testUnion();
  await testJoin();
  await testResilience();
  console.log(`\nAll ${passed} deep-extract checks passed ✅`);
}

main().catch((e) => {
  console.error("\n❌ FAILED:", e);
  process.exit(1);
});
