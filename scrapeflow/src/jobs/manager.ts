import { mapLimit } from "../lib/pool.js";
import { InMemoryJobStore } from "./store.js";
import type { JobEvent, JobHandler, JobInput, JobRecord, JobStore } from "./types.js";

export interface JobManagerOptions {
  /** Map of job kind -> handler. */
  handlers: Record<string, JobHandler>;
  /** Max jobs running at once. Default 4. */
  concurrency?: number;
  /** Persistence (in-memory by default). */
  store?: JobStore;
  /** Observe lifecycle events (for live dashboards/logs). */
  onEvent?: (e: JobEvent) => void;
  /** Provide timestamps (injectable for deterministic tests). */
  now?: () => number;
}

/**
 * Runs many jobs concurrently — the user's "submit several jobs, let agents
 * loose in parallel" model. Each job is dispatched to the handler for its
 * `kind`; a bounded worker pool keeps `concurrency` in flight. Status + results
 * live in the store, so a server/dashboard can poll progress while it runs.
 */
export class JobManager {
  private readonly handlers: Record<string, JobHandler>;
  private readonly concurrency: number;
  private readonly store: JobStore;
  private readonly onEvent?: (e: JobEvent) => void;
  private readonly now: () => number;
  private seq = 0;

  constructor(opts: JobManagerOptions) {
    this.handlers = opts.handlers;
    this.concurrency = opts.concurrency ?? 4;
    this.store = opts.store ?? new InMemoryJobStore();
    this.onEvent = opts.onEvent;
    this.now = opts.now ?? (() => Date.now());
  }

  private id(input: JobInput): string {
    return input.id ?? `job-${++this.seq}`;
  }

  /** Register jobs as queued and return their records (nothing runs yet). */
  async enqueue(inputs: JobInput[]): Promise<JobRecord[]> {
    const records: JobRecord[] = inputs.map((i) => ({
      id: this.id(i),
      kind: i.kind,
      label: i.label,
      input: i.input,
      status: "queued",
      queuedAt: this.now(),
    }));
    for (const r of records) await this.store.put(r);
    return records;
  }

  /** Run every currently-queued job to completion, `concurrency` at a time. */
  async runQueued(): Promise<JobRecord[]> {
    const all = await this.store.list();
    const pending = all.filter((j) => j.status === "queued");
    await mapLimit(pending, this.concurrency, (job) => this.execute(job));
    return this.store.list();
  }

  /** Convenience: enqueue + run + return final records. */
  async submitAndRun(inputs: JobInput[]): Promise<JobRecord[]> {
    await this.enqueue(inputs);
    return this.runQueued();
  }

  async status(id: string): Promise<JobRecord | undefined> {
    return this.store.get(id);
  }

  private async execute(job: JobRecord): Promise<void> {
    const handler = this.handlers[job.kind];
    const started =
      (await this.store.update(job.id, { status: "running", startedAt: this.now() })) ?? job;
    this.onEvent?.({ type: "started", job: started });

    if (!handler) {
      const failed =
        (await this.store.update(job.id, {
          status: "failed",
          error: `no handler for kind "${job.kind}"`,
          finishedAt: this.now(),
        })) ?? started;
      this.onEvent?.({ type: "finished", job: failed });
      return;
    }

    const progress = async (msg: string) => {
      const p = await this.store.update(job.id, { progress: msg });
      if (p) this.onEvent?.({ type: "progress", job: p });
    };

    try {
      const result = await handler(job.input, {
        job: started,
        progress: (m) => void progress(m),
      });
      const done =
        (await this.store.update(job.id, {
          status: "done",
          result,
          finishedAt: this.now(),
        })) ?? started;
      this.onEvent?.({ type: "finished", job: done });
    } catch (err) {
      const failed =
        (await this.store.update(job.id, {
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
          finishedAt: this.now(),
        })) ?? started;
      this.onEvent?.({ type: "finished", job: failed });
    }
  }
}
