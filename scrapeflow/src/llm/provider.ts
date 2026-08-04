import { createOpenAI } from "@ai-sdk/openai";
import { generateObject, generateText } from "ai";
import type { z } from "zod";
import type { LLMProvider } from "../core/ports.js";

/**
 * LLM adapter built on the Vercel AI SDK, so swapping providers is a one-line
 * change (@ai-sdk/openai -> @ai-sdk/anthropic, or an Ollama base URL). The rest
 * of the system depends only on the LLMProvider port, never on this file.
 */
export interface OpenAIProviderOptions {
  apiKey?: string;
  model?: string;
  baseURL?: string;
}

export function createOpenAIProvider(
  opts: OpenAIProviderOptions = {},
): LLMProvider {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  const modelName = opts.model ?? process.env.SCRAPEFLOW_MODEL ?? "gpt-4o-mini";
  const openai = createOpenAI({
    apiKey,
    baseURL: opts.baseURL ?? process.env.OPENAI_BASE_URL,
  });
  const model = openai(modelName);

  return {
    name: `openai:${modelName}`,
    async generateObject<T>(args: {
      prompt: string;
      schema: z.ZodType<T>;
      system?: string;
    }): Promise<T> {
      const { object } = await generateObject({
        model,
        schema: args.schema,
        system: args.system,
        prompt: args.prompt,
      });
      return object as T;
    },
    async generateText(args: {
      prompt: string;
      system?: string;
    }): Promise<string> {
      const { text } = await generateText({
        model,
        system: args.system,
        prompt: args.prompt,
      });
      return text;
    },
  };
}
