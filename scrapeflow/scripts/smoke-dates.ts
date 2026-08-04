/* Date normalization + metadata publish-date extraction (no network/LLM). */
import assert from "node:assert";
import { normalizeDate } from "../src/lib/dates.js";
import { deriveMetadata } from "../src/pipeline/metadata.js";
import type { Document } from "../src/types.js";

let passed = 0;
const ok = (n: string) => (passed++, console.log(`  ✓ ${n}`));

function testNormalize() {
  console.log("normalizeDate:");
  const cases: [string, string][] = [
    ["2026-08-04T09:00:42+07:00", "2026-08-04"], // ISO w/ offset
    ["2026-08-04", "2026-08-04"], // ISO date
    ["04 August 2026 09:00", "2026-08-04"], // English + time
    ["27 July 2026 19:47", "2026-07-27"], // English + time
    ["16 Juni 2026", "2026-06-16"], // Indonesian month
    ["1 Januari 2026", "2026-01-01"], // Indonesian, single digit
    ["31 Desember 2025", "2025-12-31"], // Indonesian December
    ["August 4, 2026", "2026-08-04"], // Month-first
    ["04/08/2026", "2026-08-04"], // Numeric day-first (ID convention)
    ["20260804093404", "2026-08-04"], // compact URL timestamp
  ];
  for (const [input, expected] of cases) {
    const r = normalizeDate(input);
    assert.equal(r?.date, expected, `"${input}" -> ${r?.date} (want ${expected})`);
  }
  ok(`normalizes ${cases.length} mixed formats (EN + ID + ISO + numeric) to YYYY-MM-DD`);

  assert.equal(normalizeDate("04 August 2026 09:00")?.iso, "2026-08-04T09:00:00");
  assert.equal(normalizeDate("04 August 2026 09:00")?.hasTime, true);
  assert.equal(normalizeDate("16 Juni 2026")?.hasTime, false);
  ok("keeps time in iso when present, flags hasTime");

  assert.equal(normalizeDate("not a date"), null);
  assert.equal(normalizeDate(""), null);
  assert.equal(normalizeDate("32 Juni 2026"), null); // invalid day
  ok("returns null for garbage / invalid dates");
}

async function testMetadataExtraction() {
  console.log("metadata publish-date:");
  const html = `<!doctype html><html><head><title>Berita</title>
    <script type="application/ld+json">
      {"@type":"NewsArticle","datePublished":"2026-08-04T09:00:42+07:00"}
    </script>
  </head><body><p>isi</p></body></html>`;
  const doc: Document = { rawHtml: html, metadata: { url: "https://x/a" } };
  const out = await deriveMetadata.transform(doc, { url: "https://x/a", options: {}, log: () => {} });
  assert.equal(out.metadata.publishedDate, "2026-08-04");
  assert.equal(out.metadata.publishedTime, "2026-08-04T09:00:42+07:00");
  ok("pulls ISO datePublished from JSON-LD");

  const html2 = `<html><head><meta property="article:published_time" content="16 Juni 2026"></head><body></body></html>`;
  const doc2: Document = { rawHtml: html2, metadata: { url: "https://x/b" } };
  const out2 = await deriveMetadata.transform(doc2, { url: "https://x/b", options: {}, log: () => {} });
  assert.equal(out2.metadata.publishedDate, "2026-06-16");
  ok("falls back to <meta article:published_time> and normalizes ID month");

  const html3 = `<html><head></head><body><time datetime="2026-01-02">2 Jan</time></body></html>`;
  const doc3: Document = { rawHtml: html3, metadata: { url: "https://x/c" } };
  const out3 = await deriveMetadata.transform(doc3, { url: "https://x/c", options: {}, log: () => {} });
  assert.equal(out3.metadata.publishedDate, "2026-01-02");
  ok("falls back to <time datetime>");
}

async function main() {
  testNormalize();
  await testMetadataExtraction();
  console.log(`\nAll ${passed} date checks passed ✅`);
}

main().catch((e) => {
  console.error("\n❌ FAILED:", e);
  process.exit(1);
});
