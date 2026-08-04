import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { z } from "zod";
import { scrapeUrl } from "../core/scrape.js";
import { extractStructured } from "../core/extract.js";
import { createOpenAIProvider } from "../llm/provider.js";
import { getSink } from "../export/registry.js";
import type { OutputFormat, ScrapeOptions } from "../types.js";

const app = new Hono();

const scrapeBody = z.object({
  url: z.string().url(),
  formats: z
    .array(
      z.enum(["markdown", "html", "rawHtml", "links", "metadata", "json"]),
    )
    .optional(),
  onlyMainContent: z.boolean().optional(),
  requiresJs: z.boolean().optional(),
  engine: z.string().optional(),
});

app.get("/health", (c) => c.json({ ok: true, service: "scrapeflow" }));

/** POST /scrape — the core capability. */
app.post("/scrape", async (c) => {
  const parsed = scrapeBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const { url, ...rest } = parsed.data;
  const opts: ScrapeOptions = { ...rest, formats: rest.formats as OutputFormat[] };
  try {
    const doc = await scrapeUrl(url, opts);
    return c.json({ success: true, document: doc });
  } catch (err) {
    return c.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      502,
    );
  }
});

/**
 * POST /extract — scrape + LLM structured extraction against a JSON schema.
 * Body: { url, schema (JSON Schema-ish via zod on client), prompt? }
 * For simplicity here we accept a flat record schema: { field: "string"|"number"|"boolean" }.
 */
const extractBody = z.object({
  url: z.string().url(),
  prompt: z.string().optional(),
  fields: z.record(z.enum(["string", "number", "boolean"])),
  export: z.enum(["json", "xlsx"]).optional(),
});

function buildSchema(fields: Record<string, "string" | "number" | "boolean">) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, type] of Object.entries(fields)) {
    shape[key] =
      type === "number"
        ? z.number().nullable()
        : type === "boolean"
          ? z.boolean().nullable()
          : z.string().nullable();
  }
  return z.object(shape);
}

app.post("/extract", async (c) => {
  const parsed = extractBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const { url, prompt, fields, export: exportFormat } = parsed.data;
  try {
    const doc = await scrapeUrl(url, { formats: ["markdown"] });
    const llm = createOpenAIProvider();
    const schema = buildSchema(fields);
    const record = await extractStructured({ document: doc, schema, prompt, llm });

    if (exportFormat) {
      const sink = getSink(exportFormat);
      const out = await sink.write([doc], { records: [record] });
      if (exportFormat === "xlsx") {
        const bytes = new Uint8Array(out as Buffer);
        return new Response(bytes, {
          headers: {
            "content-type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "content-disposition": 'attachment; filename="extract.xlsx"',
          },
        });
      }
      return c.body(out as string, 200, { "content-type": "application/json" });
    }
    return c.json({ success: true, data: record });
  } catch (err) {
    return c.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      502,
    );
  }
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`scrapeflow listening on http://localhost:${info.port}`);
});

export { app };
