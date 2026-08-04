import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CachedExtractor, ExtractorCache, ExtractorMeta } from "../../core/ports.js";

export const CACHE_VERSION = 1;

/** Stable cache key for a (version, model, url, schema, prompt) tuple. */
export function extractorKey(parts: {
  model: string;
  url: string;
  schemaJson: string;
  prompt: string;
}): string {
  return createHash("sha256")
    .update([CACHE_VERSION, parts.model, parts.url, parts.schemaJson, parts.prompt].join("\0"))
    .digest("hex");
}

/** Process-lifetime cache. Good default; nothing to configure. */
export function createMemoryCache(): ExtractorCache {
  const store = new Map<string, CachedExtractor>();
  return {
    async get(key) {
      return store.get(key);
    },
    async set(key, code) {
      store.set(key, { code, createdAt: Date.now() });
    },
  };
}

/** Persists extractors as JSON files under a directory. Survives restarts. */
export function createFileCache(dir = ".scrapeflow-cache"): ExtractorCache {
  const path = (key: string) => join(dir, `${key}.json`);
  return {
    async get(key) {
      try {
        const raw = await readFile(path(key), "utf8");
        return JSON.parse(raw) as CachedExtractor;
      } catch {
        return undefined;
      }
    },
    async set(key, code, meta: ExtractorMeta) {
      await mkdir(dir, { recursive: true });
      const record = { code, createdAt: Date.now(), meta };
      await writeFile(path(key), JSON.stringify(record), "utf8");
    },
  };
}
