/* Universal product extractor: schema.org Product + OG fallback + price parsing. */
import assert from "node:assert";
import { extractProduct } from "../src/extract/product.js";
import type { Document } from "../src/types.js";

let passed = 0;
const ok = (n: string) => (passed++, console.log(`  ✓ ${n}`));

const doc = (rawHtml: string, url = "https://shop.test/p"): Document => ({ rawHtml, metadata: { url } });

// Store A: full Product JSON-LD with AggregateRating + Offer.
const storeA = `<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"Kopi Gayo 250g",
 "brand":{"@type":"Brand","name":"Nusantara"},"sku":"KG-250",
 "image":"https://img/x.jpg","description":"Kopi arabika premium.",
 "aggregateRating":{"@type":"AggregateRating","ratingValue":"4.8","reviewCount":"1240"},
 "offers":{"@type":"Offer","price":"85000","priceCurrency":"IDR","availability":"https://schema.org/InStock"}}
</script></head><body></body></html>`;

// Store B: no JSON-LD; only Open Graph product meta.
const storeB = `<html><head>
<meta property="og:title" content="Sepatu Lari X">
<meta property="product:price:amount" content="1250000">
<meta property="product:price:currency" content="IDR">
<meta property="product:availability" content="in stock">
<meta property="og:image" content="https://img/shoe.jpg">
<meta property="og:description" content="Sepatu ringan.">
</head><body></body></html>`;

// Store C: price as a formatted string "Rp1.250.000" inside JSON-LD.
const storeC = `<html><head>
<script type="application/ld+json">
{"@type":"Product","name":"Tas Kulit","offers":{"@type":"Offer","price":"Rp1.250.000","priceCurrency":"IDR"}}
</script></head><body></body></html>`;

function main() {
  console.log("product extractor (single code, different stores):");

  const a = extractProduct(doc(storeA));
  assert.equal(a.name, "Kopi Gayo 250g");
  assert.equal(a.brand, "Nusantara");
  assert.equal(a.price, 85000);
  assert.equal(a.currency, "IDR");
  assert.equal(a.availability, "InStock");
  assert.equal(a.rating, 4.8);
  assert.equal(a.ratingCount, 1240);
  assert.equal(a.sku, "KG-250");
  assert.equal(a.sources.price, "json-ld");
  ok("Store A: full Product JSON-LD (price/brand/rating/availability)");

  const b = extractProduct(doc(storeB));
  assert.equal(b.name, "Sepatu Lari X");
  assert.equal(b.price, 1250000);
  assert.equal(b.currency, "IDR");
  assert.equal(b.sources.price, "meta");
  assert.equal(b.rating, null); // absent -> null, not invented
  ok("Store B: no JSON-LD -> price/currency/name from OG product meta");

  const c = extractProduct(doc(storeC));
  assert.equal(c.price, 1250000, `parsed ${c.price}`);
  ok('Store C: parses formatted "Rp1.250.000" -> 1250000');

  // Same canonical shape from all three.
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
  assert.deepEqual(Object.keys(a).sort(), Object.keys(c).sort());
  ok("all stores yield the identical canonical structure");

  console.log(`\nAll ${passed} product checks passed ✅`);
}

main();
