import type { ExportSink } from "../core/ports.js";
import { markdownSink, jsonSink } from "./basic.js";
import { xlsxSink } from "./xlsx.js";

/** Registry of output formats. Add a sink here to support a new destination. */
export const sinks: ExportSink[] = [markdownSink, jsonSink, xlsxSink];

export function getSink(format: string): ExportSink {
  const sink = sinks.find((s) => s.format === format);
  if (!sink) {
    throw new Error(
      `Unknown export format: ${format}. Available: ${sinks
        .map((s) => s.format)
        .join(", ")}`,
    );
  }
  return sink;
}
