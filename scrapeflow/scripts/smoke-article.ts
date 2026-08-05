/* Universal article extractor: same code, different site layouts -> same shape.
   Uses synthetic pages modeled on how CNN/Detik/Kompas actually publish. */
import assert from "node:assert";
import { extractArticle } from "../src/extract/article.js";
import type { Document } from "../src/types.js";

let passed = 0;
const ok = (n: string) => (passed++, console.log(`  ✓ ${n}`));

const doc = (rawHtml: string, url: string): Document => ({
  rawHtml,
  metadata: { url },
});

// Site A: full schema.org NewsArticle in a @graph (Kompas/Detik style).
const siteA = `<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
  {"@type":"Organization","name":"Detik Finance"},
  {"@type":"NewsArticle","headline":"Rupiah Menguat Tipis","datePublished":"2026-08-04T08:00:00+07:00",
   "author":{"@type":"Person","name":"Budi Santoso"},"articleSection":"Ekonomi",
   "description":"Nilai tukar rupiah menguat.","image":["https://a/x.jpg"],
   "articleBody":"Rupiah hari ini menguat tipis terhadap dolar AS di tengah sentimen positif pasar. Analis menyebut data inflasi yang terkendali mendorong penguatan mata uang Garuda. Perdagangan berlangsung stabil sepanjang sesi, dengan volume transaksi yang meningkat dibanding hari sebelumnya. Bank Indonesia disebut tetap menjaga stabilitas nilai tukar melalui intervensi terukur di pasar valuta asing."}
]}
</script></head><body><article><p>ignored, body from json-ld</p></article></body></html>`;

// Site B: NO JSON-LD; only OG/meta + article body (CNN-ish minimal).
const siteB = `<html><head>
<meta property="og:title" content="Harga Emas Naik">
<meta name="author" content="Siti Aminah">
<meta property="article:published_time" content="2026-08-03T15:30:00+07:00">
<meta property="og:description" content="Harga emas melonjak.">
<meta property="article:section" content="Market">
<meta property="og:site_name" content="CNN Indonesia">
</head><body>
<nav><a href="/">home</a><a href="/x">x</a></nav>
<article>
<p>Harga emas dunia naik signifikan pada perdagangan hari ini seiring melemahnya dolar.</p>
<p>Kenaikan ini didorong oleh meningkatnya permintaan safe haven di tengah ketidakpastian global yang terus berlanjut.</p>
<p>Para analis memperkirakan tren ini masih akan berlanjut dalam beberapa pekan ke depan.</p>
</article></body></html>`;

function assertArticleShape(a: ReturnType<typeof extractArticle>) {
  // Every field key exists (same shape regardless of source layer).
  for (const k of ["title", "author", "publishedDate", "description", "section", "siteName", "body", "url"]) {
    assert.ok(k in a, `missing field ${k}`);
  }
}

function main() {
  console.log("article extractor (single code, different layouts):");

  const a = extractArticle(doc(siteA, "https://finance.detik.com/a1"));
  assertArticleShape(a);
  assert.equal(a.title, "Rupiah Menguat Tipis");
  assert.equal(a.author, "Budi Santoso");
  assert.equal(a.publishedDate, "2026-08-04");
  assert.equal(a.section, "Ekonomi");
  assert.equal(a.siteName, "Detik Finance");
  assert.ok(a.body && a.body.includes("menguat tipis"));
  assert.equal(a.sources.title, "json-ld");
  assert.equal(a.sources.body, "json-ld");
  ok("Site A (schema.org @graph): all fields from JSON-LD");

  const b = extractArticle(doc(siteB, "https://www.cnnindonesia.com/e/b1"));
  assertArticleShape(b);
  assert.equal(b.title, "Harga Emas Naik");
  assert.equal(b.author, "Siti Aminah");
  assert.equal(b.publishedDate, "2026-08-03");
  assert.equal(b.siteName, "CNN Indonesia");
  assert.equal(b.sources.title, "meta");
  // Body has no JSON-LD -> Readability-lite from <article>, nav stripped.
  assert.ok(b.body && b.body.includes("safe haven"));
  assert.ok(!b.body!.includes("home"), "nav should be stripped from body");
  assert.equal(b.sources.body, "readability");
  ok("Site B (no JSON-LD): title/date from meta, body from Readability-lite");

  // The KEY property: both produce the identical field set.
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
  ok("both sites yield the identical canonical structure");

  console.log(`\nAll ${passed} article checks passed ✅`);
}

main();
