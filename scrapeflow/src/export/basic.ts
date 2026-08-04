import type { ExportSink } from "../core/ports.js";
import type { Document } from "../types.js";

export const markdownSink: ExportSink = {
  format: "markdown",
  async write(docs: Document[]): Promise<string> {
    return docs
      .map((d) => {
        const title = d.metadata.title ?? d.metadata.url;
        return `# ${title}\n\n<!-- ${d.metadata.url} -->\n\n${d.markdown ?? ""}`;
      })
      .join("\n\n---\n\n");
  },
};

export const jsonSink: ExportSink = {
  format: "json",
  async write(
    docs: Document[],
    opts?: Record<string, unknown>,
  ): Promise<string> {
    const records = opts?.records as unknown[] | undefined;
    return JSON.stringify(records ?? docs, null, 2);
  },
};
