import type { Document } from "../types.js";

/**
 * Shared state for an agent run. Tools store large artifacts (documents, rows)
 * HERE and return only compact summaries to the model — so page content never
 * bloats the LLM context. The final export tool reads rows back from here.
 */
export class AgentSession {
  readonly documents = new Map<string, Document>();
  readonly records: Record<string, unknown>[] = [];
  readonly files: { name: string; bytes: Buffer }[] = [];
  readonly log: string[] = [];

  note(msg: string): void {
    this.log.push(msg);
  }

  addDocument(doc: Document): void {
    this.documents.set(doc.metadata.url, doc);
  }

  addRecords(rows: Record<string, unknown>[]): void {
    this.records.push(...rows);
  }
}
