import type { JobRecord, JobStore } from "./types.js";

/** Process-memory job store. Good default; nothing to configure. */
export class InMemoryJobStore implements JobStore {
  private jobs = new Map<string, JobRecord>();

  async put(job: JobRecord): Promise<void> {
    this.jobs.set(job.id, { ...job });
  }

  async update(id: string, patch: Partial<JobRecord>): Promise<JobRecord | undefined> {
    const cur = this.jobs.get(id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch };
    this.jobs.set(id, next);
    return next;
  }

  async get(id: string): Promise<JobRecord | undefined> {
    const j = this.jobs.get(id);
    return j ? { ...j } : undefined;
  }

  async list(): Promise<JobRecord[]> {
    return [...this.jobs.values()].map((j) => ({ ...j }));
  }
}
