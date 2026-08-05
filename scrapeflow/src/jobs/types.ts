/** A unit of work the user submits. `kind` selects which handler runs it. */
export interface JobInput {
  /** Optional caller-supplied id; auto-generated if omitted. */
  id?: string;
  kind: string; // "scrape" | "article" | "product" | "agent" | custom
  input: unknown; // handler-specific params
  /** Free-form label for display. */
  label?: string;
}

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface JobRecord {
  id: string;
  kind: string;
  label?: string;
  input: unknown;
  status: JobStatus;
  result?: unknown;
  error?: string;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  /** Latest progress line emitted by the handler. */
  progress?: string;
}

/** A handler runs one job kind. `ctx.progress` streams status back to the store. */
export type JobHandler = (
  input: unknown,
  ctx: { job: JobRecord; progress: (msg: string) => void },
) => Promise<unknown>;

export type JobEvent =
  | { type: "started"; job: JobRecord }
  | { type: "progress"; job: JobRecord }
  | { type: "finished"; job: JobRecord };

/**
 * Persistence seam for jobs. In-memory by default; swap for Postgres/Redis to
 * survive restarts and let a separate process query live status (the qm model).
 */
export interface JobStore {
  put(job: JobRecord): Promise<void>;
  update(id: string, patch: Partial<JobRecord>): Promise<JobRecord | undefined>;
  get(id: string): Promise<JobRecord | undefined>;
  list(): Promise<JobRecord[]>;
}
