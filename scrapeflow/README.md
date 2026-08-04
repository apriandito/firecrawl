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

## Roadmap

- [x] **Phase 1** — URL → clean markdown (engines + pipeline)
- [x] **Phase 2** — structured extract (Zod) + Excel export
- [x] **Robustness** — retry/backoff, block detection, deterministic
      sandboxed extraction with self-repair
- [ ] **Phase 3** — crawl/map + job queue (BullMQ)
- [ ] **Phase 4** — agentic: wrap each use-case as an `AgentTool`; NL prompt
      → plan → search → scrape → extract → export. The `AgentTool` port
      already exists in `src/core/ports.ts` for exactly this.

## License

MIT
