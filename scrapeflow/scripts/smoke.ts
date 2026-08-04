/* Smoke test for the robustness mechanisms that don't require an LLM key. */
import assert from "node:assert";
import { z } from "zod";
import { inProcessSandbox } from "../src/extract/deterministic/sandbox.js";
import {
  tooStrictSelectors,
  loosenCombinators,
} from "../src/extract/deterministic/selectorRepair.js";
import { extractorKey } from "../src/extract/deterministic/cache.js";
import { detectBlock, evaluateResult } from "../src/engines/resilience.js";
import { extractDeterministic } from "../src/extract/deterministic/extract.js";
import type { LLMProvider } from "../src/core/ports.js";

let passed = 0;
const ok = (name: string) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

const SAMPLE = `<!doctype html><html><head><title>Shop</title></head><body>
  <div class="wrapper"><article class="product">
    <h1 class="name">Kopi Gayo</h1>
    <span class="price">Rp 85.000</span>
  </article></div>
  <script>window.__pwned = "page script ran!";</script>
</body></html>`;

async function testSandbox() {
  console.log("sandbox:");
  // 1. A correct hand-written extractor returns clean JSON.
  const code = `async function extract(document) {
    return {
      name: document.querySelector('.name')?.textContent?.trim() ?? null,
      price: document.querySelector('.price')?.textContent?.trim() ?? null,
    };
  }`;
  const result = (await inProcessSandbox.run({
    code,
    html: SAMPLE,
    url: "https://shop.test/",
  })) as { name: string; price: string };
  assert.equal(result.name, "Kopi Gayo");
  assert.equal(result.price, "Rp 85.000");
  ok("runs extractor and returns structured JSON");

  // 2. Page scripts must NOT execute (runScripts: outside-only).
  const leak = `async function extract(document) {
    return { pwned: (document.defaultView).__pwned ?? null };
  }`;
  const r2 = (await inProcessSandbox.run({ code: leak, html: SAMPLE, url: "https://x/" })) as {
    pwned: string | null;
  };
  assert.equal(r2.pwned, null);
  ok("page's own <script> does not run");

  // 3. A circular (unserializable) return is rejected at the JSON boundary.
  const bad = `async function extract(document) { const o = {}; o.self = o; return o; }`;
  await assert.rejects(inProcessSandbox.run({ code: bad, html: SAMPLE, url: "https://x/" }));
  ok("circular / unserializable return is rejected at the realm boundary");

  // 4. Infinite loop is killed by the timeout.
  const spin = `async function extract(document) { while (true) {} }`;
  await assert.rejects(
    inProcessSandbox.run({ code: spin, html: SAMPLE, url: "https://x/", timeoutMs: 500 }),
    /timed out/,
  );
  ok("runaway extractor hits the wall-clock timeout");
}

function testSelectorRepair() {
  console.log("selector-repair:");
  assert.equal(loosenCombinators("div.wrapper > article > .name"), "div.wrapper article .name");
  ok("loosenCombinators relaxes > to descendant");

  // The sample has div.wrapper > article (not direct: article is a child of
  // wrapper, so use a case that IS too strict): .wrapper > .name matches 0,
  // but .wrapper .name matches 1.
  const code = `async function extract(d){ return d.querySelector('.wrapper > .name')?.textContent }`;
  const broken = tooStrictSelectors(code, SAMPLE);
  assert.equal(broken.length, 1);
  assert.equal(broken[0].loosened, ".wrapper .name");
  assert.equal(broken[0].count, 1);
  ok("detects a too-strict '>' selector and its working loosened form");

  // A selector inside [attr] with > must not be mangled.
  assert.equal(loosenCombinators('a[href*=">"]'), 'a[href*=">"]');
  ok("does not touch '>' inside attribute selectors");
}

function testCacheKey() {
  console.log("cache-key:");
  const a = extractorKey({ model: "m", url: "https://x/", schemaJson: "{}", prompt: "p" });
  const b = extractorKey({ model: "m", url: "https://x/", schemaJson: "{}", prompt: "p" });
  const c = extractorKey({ model: "m", url: "https://x/", schemaJson: "{}", prompt: "different" });
  assert.equal(a, b);
  assert.notEqual(a, c);
  ok("key is stable for same inputs and differs on prompt change");
}

function testResilience() {
  console.log("resilience:");
  assert.equal(detectBlock("<html><body>Just a moment...</body></html>"), "cloudflare-challenge");
  assert.ok(detectBlock("please complete the CAPTCHA"));
  assert.equal(detectBlock(SAMPLE), null);
  ok("detectBlock flags anti-bot walls, passes real content");

  assert.equal(evaluateResult({ rawHtml: SAMPLE, statusCode: 200 }).ok, true);
  assert.equal(evaluateResult({ rawHtml: "", statusCode: 200 }).ok, false);
  const blocked = evaluateResult({ rawHtml: "Just a moment...", statusCode: 200 });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.escalate, true);
  ok("evaluateResult rejects empty + blocked, marks escalate");
}

async function testDeterministicWithFakeLLM() {
  console.log("deterministic (fake LLM that writes code once):");
  let codegenCalls = 0;
  const fakeLLM: LLMProvider = {
    name: "fake",
    async generateText() {
      codegenCalls++;
      return "```js\nasync function extract(document){ return { name: document.querySelector('.name')?.textContent?.trim() ?? null }; }\n```";
    },
    async generateObject() {
      throw new Error("not used");
    },
  };
  const schema = z.object({ name: z.string().nullable() });

  const r1 = await extractDeterministic({ html: SAMPLE, url: "https://shop.test/", schema, llm: fakeLLM });
  assert.equal(r1.data.name, "Kopi Gayo");
  assert.equal(r1.fromCache, false);
  ok("first call generates + runs extractor (markdown fences stripped)");

  const r2 = await extractDeterministic({
    html: SAMPLE,
    url: "https://shop.test/",
    schema,
    llm: fakeLLM,
    cache: undefined,
  });
  // Different cache instance -> regenerates; verify code still runs.
  assert.equal(r2.data.name, "Kopi Gayo");
  ok("second call still produces valid data");

  console.log(`    (LLM codegen invoked ${codegenCalls}x total)`);
}

async function main() {
  await testSandbox();
  testSelectorRepair();
  testCacheKey();
  testResilience();
  await testDeterministicWithFakeLLM();
  console.log(`\nAll ${passed} checks passed ✅`);
}

main().catch((e) => {
  console.error("\n❌ FAILED:", e);
  process.exit(1);
});
