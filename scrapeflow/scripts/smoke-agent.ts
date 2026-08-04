/* Phase 4 smoke test: drive the agent TOOLS end-to-end with a fake scraper and
   a fake LLM, producing a real .xlsx — no API key, no network. This proves the
   map -> scrape -> extract -> export pipeline the real agent orchestrates. */
import assert from "node:assert";
import { readFile, writeFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { AgentSession } from "../src/agent/session.js";
import { buildAgentTools } from "../src/agent/tools.js";
import type { LLMProvider } from "../src/core/ports.js";
import type { Document, ScrapeOptions } from "../src/types.js";
import type { MapOptions } from "../src/core/map.js";

let passed = 0;
const ok = (n: string) => (passed++, console.log(`  ✓ ${n}`));

// A fake "CNBC syariah" section: a listing page linking three articles.
const ARTICLES: Record<string, { title: string; date: string; body: string }> = {
  "https://cnbc.test/syariah/a1": { title: "Bank Syariah Tumbuh 12%", date: "2026-08-01", body: "Ekonomi syariah naik." },
  "https://cnbc.test/syariah/a2": { title: "Sukuk Ritel Diminati", date: "2026-08-02", body: "Investasi syariah." },
  "https://cnbc.test/syariah/a3": { title: "Cuaca Cerah di Bandung", date: "2026-08-03", body: "Bukan berita ekonomi." },
};

const fakeMap = async (_seed: string, _o: MapOptions): Promise<{ url: string }[]> =>
  Object.keys(ARTICLES).map((url) => ({ url }));

const fakeScrape = async (url: string, _o: ScrapeOptions): Promise<Document> => {
  const a = ARTICLES[url];
  return {
    markdown: a ? `# ${a.title}\n\n${a.date}\n\n${a.body}` : "# not found",
    metadata: { url, statusCode: 200, engine: "fake" },
  };
};

// Fake LLM: reads the markdown and returns a record. Marks the weather article
// irrelevant by leaving fields null (so hasSignal filters it out).
const fakeLLM: LLMProvider = {
  name: "fake",
  async generateText() {
    return "";
  },
  async generateObject<T>(args: { prompt: string }): Promise<T> {
    const md = args.prompt;
    const isEconomy = /syariah|ekonomi|sukuk|bank/i.test(md) && !/cuaca/i.test(md);
    const title = /#\s*(.+)/.exec(md)?.[1]?.trim() ?? null;
    const date = /(\d{4}-\d{2}-\d{2})/.exec(md)?.[1] ?? null;
    return (isEconomy ? { title, date } : { title: null, date: null }) as T;
  },
};

async function main() {
  console.log("agent tools (fake scrape + fake LLM):");
  const session = new AgentSession();
  const { impl } = buildAgentTools(session, {
    llm: fakeLLM,
    scrape: fakeScrape,
    mapSite: fakeMap,
  });

  const mapped = await impl.map_site({ seed: "https://cnbc.test/syariah" });
  assert.equal(mapped.count, 3);
  ok("map_site returned 3 urls");

  const scraped = await impl.scrape_pages({ urls: mapped.urls });
  assert.equal(scraped.scraped, 3);
  ok("scrape_pages stored 3 documents");

  const extracted = await impl.extract_records({
    fields: { title: "string", date: "string" },
    prompt: "berita ekonomi syariah",
  });
  // Only the 2 economy articles carry signal; the weather one is filtered out.
  assert.equal(extracted.added, 2);
  ok("extract_records kept 2 relevant rows, dropped the off-topic one");

  const exported = await impl.export_xlsx({ filename: "berita.xlsx", sheetName: "Syariah" });
  assert.equal(exported.rows, 2);
  assert.ok(exported.bytes > 0);
  ok("export_xlsx wrote a non-empty workbook");

  // Verify the actual xlsx bytes parse and contain the expected data.
  const out = session.files[0].bytes;
  const path = "/tmp/scrapeflow-agent-test.xlsx";
  await writeFile(path, out);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await readFile(path));
  const ws = wb.getWorksheet("Syariah")!;
  assert.ok(ws, "sheet exists");
  const headers = (ws.getRow(1).values as unknown[]).filter(Boolean);
  assert.ok(headers.includes("title") && headers.includes("date"));
  assert.equal(ws.rowCount, 3); // header + 2 data rows
  ok("workbook reopens with correct sheet, headers, and 2 data rows");

  console.log(`\nAll ${passed} Phase-4 checks passed ✅`);
  console.log(`   (wrote sample ${path})`);
}

main().catch((e) => {
  console.error("\n❌ FAILED:", e);
  process.exit(1);
});
