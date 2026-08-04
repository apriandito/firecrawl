import { generateText } from "ai";
import { createOpenAIModel, createOpenAIProvider } from "../llm/provider.js";
import type { OpenAIProviderOptions } from "../llm/provider.js";
import { AgentSession } from "./session.js";
import { buildAgentTools, type ToolDeps } from "./tools.js";

const SYSTEM = [
  "You are a web-data agent. Given a natural-language request, gather the data",
  "and produce an Excel file. Work in this order:",
  "1. map_site to discover candidate URLs (use `prefix` to stay in the right section).",
  "2. scrape_pages on the most relevant URLs (skip obvious non-articles).",
  "3. extract_records with a `fields` schema that matches what the user wants",
  "   (always include a url/title column), and a `prompt` describing relevance.",
  "4. export_xlsx to write the final file.",
  "Keep the number of pages reasonable. Stop once the file is exported and",
  "briefly report what you produced.",
].join("\n");

export interface RunAgentOptions {
  /** The natural-language task, e.g. "berita ekonomi syariah di CNBC -> Excel". */
  task: string;
  llm?: OpenAIProviderOptions;
  /** Max tool-calling steps. Default 12. */
  maxSteps?: number;
  /** Override tool dependencies (inject fakes in tests). */
  toolDeps?: Partial<ToolDeps>;
}

export interface RunAgentResult {
  text: string;
  session: AgentSession;
  files: { name: string; bytes: Buffer }[];
  records: Record<string, unknown>[];
}

/**
 * The agentic entrypoint. The model plans and calls tools; the tools do the
 * real scraping/extraction/exporting and stash results in the session. This is
 * Phase 4 — and it required no rewrite of Phases 1–3, only wrapping them as
 * tools, exactly as the AgentTool port anticipated.
 */
export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const session = new AgentSession();
  const llm = createOpenAIProvider(opts.llm);
  const { model } = createOpenAIModel(opts.llm);
  const { aiTools } = buildAgentTools(session, { llm, ...opts.toolDeps });

  const { text } = await generateText({
    model,
    system: SYSTEM,
    prompt: opts.task,
    tools: aiTools,
    maxSteps: opts.maxSteps ?? 12,
  });

  return { text, session, files: session.files, records: session.records };
}
