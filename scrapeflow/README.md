# ScrapeFlow

A clean, extensible web-scraping + structured-extraction engine, built on a
**Ports & Adapters** (hexagonal) architecture so it can grow from
"URL → clean markdown" all the way to an agentic
"describe what you want → get an Excel" workflow without rewrites.

> Original, MIT-licensed, clean-room implementation. Not derived from any
> AGPL codebase — it shares only well-known architectural ideas.

## Why this shape

Fetching is the only thing that varies per site (static HTTP vs. a real
browser). Parsing should be identical no matter who fetched. So the design
splits hard along that line:

```
Entrypoints:  REST API · CLI · (future) MCP / Agent loop
                    │  call the same use-cases
Use-cases:    scrapeUrl · extractStructured · (future) crawl · runAgentTask
                    │  depend only on PORTS (interfaces)
Adapters:  FetchEngine │ Transformer │ LLMProvider │ ExportSink │ AgentTool
           fetch,play. │ clean,md,…  │ openai,…    │ md,json,xlsx│ (future)
```

Add an engine / LLM / output format = write **one adapter**. The core never
changes. That is the whole point.

## Layout

| Path | Role |
|------|------|
| `src/types.ts` | Domain types (`Document`, `ScrapeOptions`, `RawResult`) |
| `src/core/ports.ts` | The extension seams (all interfaces) |
| `src/core/scrape.ts` | `scrapeUrl` — engine fallback + pipeline |
| `src/core/extract.ts` | `extractStructured` — LLM → Zod schema |
| `src/engines/*` | Fetch strategies (`fetch`, `playwright`) + registry |
| `src/pipeline/*` | The single deterministic parse stack |
| `src/llm/provider.ts` | Provider-agnostic LLM adapter (Vercel AI SDK) |
| `src/export/*` | Output sinks: markdown, json, **xlsx** |
| `src/server/api.ts` | Hono REST API |
| `src/cli.ts` | CLI |

## Install

```bash
npm install
# Browser engine is optional. To enable JS-heavy pages:
npx playwright install chromium
```

## Use — as a library

```ts
import { scrapeUrl, extractStructured, createOpenAIProvider } from "scrapeflow";
import { z } from "zod";

const doc = await scrapeUrl("https://example.com", {
  formats: ["markdown"],
  onlyMainContent: true,
});
console.log(doc.markdown);

// Structured extraction
const llm = createOpenAIProvider(); // reads OPENAI_API_KEY
const data = await extractStructured({
  document: doc,
  prompt: "Extract the article headline and summary",
  schema: z.object({ title: z.string(), summary: z.string() }),
  llm,
});
```

## Use — CLI

```bash
npm run cli -- https://example.com --main
npm run cli -- https://example.com --format links
npm run cli -- https://example.com --js --engine playwright
```

## Use — API

```bash
npm run serve
curl -X POST localhost:3000/scrape \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com","formats":["markdown"],"onlyMainContent":true}'

# scrape + LLM extract → xlsx
curl -X POST localhost:3000/extract \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com","fields":{"title":"string"},"export":"xlsx"}' \
  -o out.xlsx
```

## Robustness mechanisms

Clean-room reimplementations of the smart ideas that make a scraper reliable:

**Resilience layer** (`src/engines/resilience.ts`)
- `withRetry` — exponential backoff per engine.
- `detectBlock` — recognizes Cloudflare/CAPTCHA/"just a moment" walls so they
  don't get returned as page content.
- `evaluateResult` — rejects empty bodies, block pages, and JS-only shells, and
  flags whether to **escalate** to a stronger engine.

**Deterministic extraction** (`src/extract/deterministic/`) — the big one.
Instead of calling the LLM on every page (non-deterministic, costly), the LLM
**writes an extractor once**; the code is cached and every later page runs pure
deterministic code:

```
first page:  HTML → LLM writes extract(document) → cache → sandbox → JSON
later pages: HTML → cached extractor → sandbox → JSON        (no LLM)
```

- **Sandbox** (`sandbox.ts`) — jsdom with `runScripts: "outside-only"` (the
  page's scripts never run), a `vm` context, a JSON realm boundary, and a
  synchronous+async timeout. `SandboxRunner` is a port, so a hardened jail
  (isolated-vm / external service) is a drop-in swap.
- **Self-repair** (`selectorRepair.ts`) — statically detects too-strict `>`
  selectors that match 0 elements and feeds the model precise fix instructions;
  regenerates once.
- **Fail honestly** — a sandbox throw or schema-validation mismatch triggers one
  regeneration; a second failure **propagates** instead of returning empty data.
- **Cache** (`cache.ts`) — memory or file backend, keyed by
  `hash(version + model + url + schema + prompt)`.

```ts
const data = await extractStructured({
  document: docWithHtml,          // scrape with formats: ["rawHtml"] or ["html"]
  schema: z.object({ title: z.string().nullable() }),
  prompt: "the article headline",
  llm,
  strategy: "deterministic",       // <- cached, sandboxed, self-repairing
});
```

Run the mechanism smoke tests (no API key needed):

```bash
npx tsx scripts/smoke.ts
```

## Phase 3 — discovery & multi-page

```ts
import { mapSite, crawl } from "scrapeflow";

const urls = await mapSite("https://example.com", { limit: 100 }); // sitemap + links
const { documents } = await crawl("https://example.com/blog", {
  prefix: "https://example.com/blog", // stay in a section
  maxDepth: 2,
  limit: 30,
  concurrency: 5,
});
```

`crawl` is a same-site BFS over a concurrency-limited queue that dedups by
normalized URL. `mapSite` reads `robots.txt` + `sitemap.xml` (following one index
level) and falls back to homepage links.

## Running many jobs at once (concurrent scrapers + agents)

Submit a batch of jobs — plain scrapes, article/product extraction, or full
natural-language agent tasks — and a bounded worker pool runs them concurrently,
tracking status and results. Inspired by the queue-of-agents model (qm), kept
in-process with a `JobStore` port you can swap for Postgres/Redis later.

```ts
import { JobManager, createDefaultHandlers } from "scrapeflow";

const mgr = new JobManager({ handlers: createDefaultHandlers(), concurrency: 4 });
const results = await mgr.submitAndRun([
  { kind: "article", input: { url: "https://finance.detik.com/..." } },
  { kind: "product", input: { url: "https://shop.example/p/123" } },
  { kind: "agent",   input: { task: "berita ekonomi syariah di CNBC jadi Excel" } },
]);
// each result: { id, kind, status, result | error, timings, progress }
```

```bash
npm run jobs -- jobs.json --concurrency 4 --out results.json
```

The pool is bounded (never more than `concurrency` in flight), a failing job is
isolated (siblings keep running), and status is queryable live (`mgr.status(id)`)
so a server/dashboard can show progress. Verified live: 4 mixed jobs across 4
sites finished in ~one job's wall-time, not the sum — real parallelism.

## Phase 4 — the agent (your mission)

```bash
OPENAI_API_KEY=... npm run agent -- "berita ekonomi syariah di CNBC, jadikan Excel"
```

```ts
import { runAgent } from "scrapeflow";

const { files, records } = await runAgent({
  task: "collect Islamic-economy news from CNBC Indonesia into an Excel file",
});
// files[0].bytes -> the .xlsx
```

The agent (`src/agent/`) is just Phases 1–3 wrapped as tools:

```
NL task → LLM plans → map_site → scrape_pages → extract_records → export_xlsx
```

Each tool stashes big artifacts (pages, rows) in an `AgentSession` and returns
only compact summaries, so page content never floods the model context. Adding
Phase 4 required **no changes** to earlier phases — exactly what the `AgentTool`
port was placed for on day one.

## Universal article extractor (one code, many sites)

The hard problem: CNN, Detik, Kompas, CNBC all lay out their HTML differently —
yet you want **the same structured record** from each, without writing per-site
code. `extractArticle(doc)` does this with a layered, single code path:

```
1. schema.org JSON-LD (NewsArticle)  → headline, author, datePublished, body …
2. Open Graph / <meta> fallbacks     → og:title, article:author, …
3. Readability-lite                  → main-content body when JSON-LD lacks it
```

It generalizes not by knowing each site, but by leaning on the **standards they
all emit for SEO** (JSON-LD is near-universal on news sites). Every field records
its `source` so you can see which layer produced it.

```ts
import { scrapeUrl, extractArticle } from "scrapeflow";
const doc = await scrapeUrl(url, { formats: ["rawHtml"] });
const a = extractArticle(doc);
// { title, author, publishedDate, publishedTime, description,
//   section, siteName, image, body, url, sources }
```

Verified **live** against CNN, Detik, Kompas, and CNBC Indonesia — one function,
identical output shape, all core fields resolved from JSON-LD, **no per-site code
and no LLM**. Author values are sanitized (social-URL "authors" rejected) and the
body is stripped of leading breadcrumb/nav chrome.

## Universal product extractor (e-commerce)

The same pattern generalizes past news. `extractProduct(doc)` resolves any
store's product page to one canonical shape via schema.org `Product` JSON-LD
(what shops emit for Google Shopping) with Open Graph product-meta fallback:

```ts
import { scrapeUrl, extractProduct } from "scrapeflow";
const doc = await scrapeUrl(url, { formats: ["rawHtml"] });
const p = extractProduct(doc);
// { name, brand, price, currency, priceText, availability,
//   rating, ratingCount, sku, image, description, url, sources }
```

Prices are parsed robustly (`"Rp1.250.000"`, `"1,250.00"`, `"4.8"` are all
disambiguated), missing fields stay `null` (never invented). Verified live on a
WooCommerce store: name/price/sku/availability/image all from JSON-LD, one code
path, no per-site rules.

**On anti-bot sites (e.g. Tokopedia):** hardened marketplaces return `503`/
challenges to plain HTTP and detect headless browsers. ScrapeFlow's resilience
layer *detects* the block, but getting *through* needs stealth + residential
proxies (a `FetchEngine` you plug in) — the extractor above still applies once
you have the HTML.

## Land data in DuckDB (query with SQL)

For local analysis, land a tidy dataset in an embedded DuckDB database and query
it with SQL — join, aggregate, export to CSV/Parquet, no server. DuckDB is an
optional dependency, loaded lazily.

```ts
import { deepExtract, DuckDBDatasetStore } from "scrapeflow";

const { table } = await deepExtract(sources, { merge: "join", key: "@first" });
const db = await DuckDBDatasetStore.open("data.duckdb"); // or ":memory:"
await db.createFromTidy("countries", table, { replace: true });

const top = await db.query(`
  SELECT location, round(imf_2026_gdp*1e6 / population_pop, 0) AS gdp_per_capita
  FROM countries WHERE population_pop > 5000000
  ORDER BY gdp_per_capita DESC LIMIT 10
`);
await db.exportCsv("countries", "countries.csv");
```

Column types carry over (numbers → DOUBLE, dates → ISO VARCHAR), NULLs are
preserved, and BigInt/DATE results are normalized to plain JS values. Verified
live end-to-end: two Wikipedia pages → merged dataset → DuckDB → a GDP-per-capita
query returning correct real-world rankings (Ireland, Switzerland, Singapore…).

```bash
npm run test:duck   # requires the optional @duckdb/node-api dep
```

## Deep extract — many pages into one dataset

Data is often spread across pages: one page per year, per region, or a paginated
list. `deepExtract` scrapes them concurrently, tidies each table, and merges into
a single dataset — two modes:

```ts
import { deepExtract } from "scrapeflow";

// UNION — stack rows from paginated pages (same schema), tag the source.
await deepExtract(pages, { merge: "union", sourceColumn: "page" });

// JOIN — widen by a key column: e.g. inflation per province, one page per year.
await deepExtract(
  [ { url: ".../2023", label: "2023" }, { url: ".../2024", label: "2024" } ],
  { merge: "join", key: "provinsi" },   // -> { provinsi, inflasi_2023, inflasi_2024 }
);
```

`key: "@first"` joins on each table's first column (handy when key headers differ
across pages). Missing cells become `null` (rectangular output), a page with no
table is reported but never fails the batch, and `matchedKeys` tells you how many
keys appeared in more than one source. Verified live: joined Wikipedia's
population and GDP tables by country into one dataset — **194 countries matched**,
`{ location, population_pop, imf_2026_gdp, ... }`, all typed.

## Tidy & tame data (from the start)

Scraped tables come out as strings — `"1,429,404,000"`, `"1 Jul 2026"`,
`"Official projection[4]"`. `tidyTable()` turns them into analysis-ready data in
one pass: it infers a type per column, coerces cells (numbers → `number`, dates
→ ISO, percents → number), strips footnote markers, drops blanks to `null`, and
can snake_case headers for SQL/DuckDB.

```ts
import { extractTables, largestTable, tidyTable } from "scrapeflow";

const t = tidyTable(largestTable(doc)!, { snakeCase: true });
// t.columns -> [{name:"population", type:"number"}, {name:"date", type:"date"}, ...]
// t.rows[0] -> { location:"India", population:1429404000, date:"2026-07-01", notes:null }
```

This is a design principle, not a post-step: every extractor aims to emit tidy,
typed data (one variable per column, one observation per row) so downstream code
never re-parses strings. The number parser disambiguates `"1.250"` (1250) from
`"4.8"` (4.8) and `"8,232,000,000"` (thousands), so Indonesian and US number
formats both land correctly.

## Data normalization (dates)

Extracted text is messy — news dates come as `16 Juni 2026`, `04 August 2026
09:00`, or ISO. Rather than trust the LLM to normalize (non-deterministic), the
pipeline pulls a machine-readable publish date deterministically:

```
JSON-LD datePublished → <meta article:published_time> → <time datetime>
```

and every scraped `document.metadata` carries a clean `publishedDate`
(`YYYY-MM-DD`) + `publishedTime` (ISO). For arbitrary strings there's
`normalizeDate()`, which understands ISO, English + Indonesian month names,
numeric day-first, and compact URL timestamps — all collapsed to `YYYY-MM-DD`.
Principle, again: **deterministic where possible, LLM only as fallback.**

```ts
normalizeDate("16 Juni 2026").date;        // "2026-06-16"
normalizeDate("04 August 2026 09:00").iso; // "2026-08-04T09:00:00"
doc.metadata.publishedDate;                // "2026-08-04" (from the page's JSON-LD)
```

## Tests

```bash
npm test   # 33 checks across all phases — no API key / network needed
```

Uses fake scrapers and a fake LLM so the full map→scrape→extract→xlsx pipeline
is verified deterministically (the final workbook is reopened and asserted).

## Roadmap

- [x] **Phase 1** — URL → clean markdown (engines + pipeline)
- [x] **Phase 2** — structured extract (Zod) + Excel export
- [x] **Robustness** — retry/backoff, block detection, deterministic
      sandboxed extraction with self-repair
- [x] **Phase 3** — map (sitemap) + same-site crawl (concurrency queue)
- [x] **Phase 4** — agentic: NL task → tools (map/scrape/extract/export)
- [ ] **Next** — distributed queue (BullMQ/Redis) behind `CrawlQueue`;
      a `search` tool; a hardened `SandboxRunner` (isolated-vm)

## License

MIT
