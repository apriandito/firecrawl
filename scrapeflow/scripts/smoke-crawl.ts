/* Phase 3 smoke test: url helpers, sitemap parsing, and a crawl with a fake
   scraper (no network). */
import assert from "node:assert";
import { normalizeUrl, sameSite, makeUrlFilter } from "../src/lib/urls.js";
import { parseSitemap, parseRobotsSitemaps } from "../src/core/map.js";
import { crawl } from "../src/core/crawl.js";
import type { Document, ScrapeOptions } from "../src/types.js";

let passed = 0;
const ok = (n: string) => (passed++, console.log(`  ✓ ${n}`));

function testUrls() {
  console.log("urls:");
  assert.equal(normalizeUrl("https://x.com/a/"), "https://x.com/a");
  assert.equal(normalizeUrl("/b", "https://x.com/a"), "https://x.com/b");
  assert.equal(normalizeUrl("ftp://x.com"), null);
  assert.equal(normalizeUrl("https://x.com/a#frag"), "https://x.com/a");
  ok("normalizeUrl strips fragments/trailing slash, resolves relative");

  assert.ok(sameSite("https://www.x.com/a", "https://x.com/b"));
  assert.ok(!sameSite("https://x.com", "https://y.com"));
  ok("sameSite ignores www.");

  const f = makeUrlFilter("https://x.com/blog", { prefix: "https://x.com/blog" });
  assert.ok(f("https://x.com/blog/post-1"));
  assert.ok(!f("https://x.com/about"));
  assert.ok(!f("https://other.com/blog/x"));
  ok("makeUrlFilter enforces prefix + same-site");
}

function testSitemap() {
  console.log("sitemap:");
  const xml = `<?xml version="1.0"?><urlset>
    <url><loc>https://x.com/a</loc></url>
    <url><loc>https://x.com/b?q=1&amp;r=2</loc></url>
  </urlset>`;
  const { locs, isIndex } = parseSitemap(xml);
  assert.deepEqual(locs, ["https://x.com/a", "https://x.com/b?q=1&r=2"]);
  assert.equal(isIndex, false);
  ok("parseSitemap extracts + xml-decodes <loc>");

  const idx = `<sitemapindex><sitemap><loc>https://x.com/sm1.xml</loc></sitemap></sitemapindex>`;
  assert.equal(parseSitemap(idx).isIndex, true);
  ok("detects sitemap index");

  const robots = "User-agent: *\nDisallow: /x\nSitemap: https://x.com/sitemap.xml\n";
  assert.deepEqual(parseRobotsSitemaps(robots), ["https://x.com/sitemap.xml"]);
  ok("parseRobotsSitemaps reads Sitemap: directives");
}

async function testCrawl() {
  console.log("crawl (fake site graph, no network):");
  // A tiny site: home -> {p1, p2, external}; p1 -> {p1a}; depth-limited.
  const graph: Record<string, string[]> = {
    "https://site.test": ["https://site.test/p1", "https://site.test/p2", "https://ext.com/x"],
    "https://site.test/p1": ["https://site.test/p1a", "https://site.test/p2"],
    "https://site.test/p2": [],
    "https://site.test/p1a": [],
  };
  const scraped: string[] = [];
  const fakeScrape = async (url: string, _opts: ScrapeOptions): Promise<Document> => {
    scraped.push(url);
    // The root URL normalizes to a trailing slash ("https://site.test/"),
    // so look up both forms against the graph keys.
    const links = graph[url] ?? graph[url.replace(/\/$/, "")] ?? [];
    return {
      markdown: `# ${url}`,
      links,
      metadata: { url, statusCode: 200, engine: "fake" },
    };
  };

  const res = await crawl("https://site.test", {
    scrape: fakeScrape,
    maxDepth: 2,
    limit: 50,
    concurrency: 3,
  });

  const urls = res.documents.map((d) => d.metadata.url).sort();
  assert.deepEqual(urls, [
    "https://site.test/",
    "https://site.test/p1",
    "https://site.test/p1a",
    "https://site.test/p2",
  ]);
  ok("crawls same-site BFS, follows depth, excludes external domain");

  // p2 reachable from both home and p1 — must be scraped exactly once (dedup).
  assert.equal(scraped.filter((u) => u === "https://site.test/p2").length, 1);
  ok("dedups: p2 scraped once despite two inbound links");

  const limited = await crawl("https://site.test", {
    scrape: fakeScrape,
    maxDepth: 5,
    limit: 2,
  });
  assert.equal(limited.documents.length, 2);
  ok("honors page limit");

  const shallow = await crawl("https://site.test", {
    scrape: fakeScrape,
    maxDepth: 0,
  });
  assert.equal(shallow.documents.length, 1);
  ok("maxDepth 0 scrapes only the seed");
}

async function main() {
  testUrls();
  testSitemap();
  await testCrawl();
  console.log(`\nAll ${passed} Phase-3 checks passed ✅`);
}

main().catch((e) => {
  console.error("\n❌ FAILED:", e);
  process.exit(1);
});
