import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";
import type {
  ExtractorCache,
  LLMProvider,
  SandboxRunner,
} from "../../core/ports.js";
import { inProcessSandbox } from "./sandbox.js";
import { createMemoryCache, extractorKey } from "./cache.js";
import { generateExtractor } from "./codegen.js";
import {
  tooStrictFeedback,
  tooStrictSelectors,
} from "./selectorRepair.js";

export interface DeterministicExtractArgs<T> {
  html: string;
  url: string;
  schema: z.ZodType<T>;
  prompt?: string;
  llm: LLMProvider;
  cache?: ExtractorCache;
  sandbox?: SandboxRunner;
  /** Ignore a cached extractor and regenerate. */
  forceRegenerate?: boolean;
  log?: (msg: string) => void;
}

/**
 * Extract structured data by having the LLM WRITE an extractor once, caching
 * the code, then running deterministic code for every subsequent page. Two
 * self-repair paths guard robustness:
 *   1. Static: too-strict `>` selectors → regenerate once with precise feedback.
 *   2. Runtime: sandbox throw or schema mismatch → regenerate once with the error.
 * A second failure PROPAGATES — we never disguise a real failure as empty data.
 */
export async function extractDeterministic<T>(
  args: DeterministicExtractArgs<T>,
): Promise<{ data: T; code: string; fromCache: boolean; repaired: boolean }> {
  const {
    html,
    url,
    schema,
    prompt = "",
    llm,
    cache = createMemoryCache(),
    sandbox = inProcessSandbox,
    forceRegenerate,
    log = () => {},
  } = args;

  const schemaJson = JSON.stringify(zodToJsonSchema(schema, "Result"));
  const key = extractorKey({ model: llm.name, url, schemaJson, prompt });
  const meta = { url, model: llm.name, cacheVersion: 1 };

  const generate = (feedback?: string, previousCode?: string) =>
    generateExtractor({ llm, html, schemaJson, prompt, feedback, previousCode });

  const runAndValidate = async (code: string): Promise<T> => {
    const raw = await sandbox.run({ code, html, url });
    return schema.parse(raw); // throws on shape mismatch
  };

  let fromCache = false;
  let repaired = false;

  const cached = forceRegenerate ? undefined : await cache.get(key);
  let code: string;
  if (cached) {
    fromCache = true;
    code = cached.code;
    await cache.touch?.(key);
    log("using cached extractor");
  } else {
    log("generating extractor via LLM");
    code = await generate();
    await cache.set(key, code, meta);
  }

  try {
    const data = await runAndValidate(code);

    // Static self-repair: catch too-strict selectors even when the run "worked".
    const broken = tooStrictSelectors(code, html);
    if (broken.length > 0) {
      log(`repairing ${broken.length} too-strict selector(s)`);
      try {
        const fixed = await generate(tooStrictFeedback(broken), code);
        if (tooStrictSelectors(fixed, html).length < broken.length) {
          const fixedData = await runAndValidate(fixed);
          await cache.set(key, fixed, meta);
          return { data: fixedData, code: fixed, fromCache, repaired: true };
        }
      } catch (e) {
        log(`selector repair failed, keeping original: ${(e as Error).message}`);
      }
    }

    return { data, code, fromCache, repaired };
  } catch (err) {
    // Runtime self-repair: one regeneration with the error as feedback.
    log(`extractor failed (${(err as Error).message}); regenerating once`);
    const fixed = await generate((err as Error).message, code);
    const data = await runAndValidate(fixed); // a second failure propagates
    await cache.set(key, fixed, meta);
    repaired = true;
    return { data, code: fixed, fromCache, repaired };
  }
}
