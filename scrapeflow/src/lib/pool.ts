/**
 * Run `items` through `worker` with at most `concurrency` in flight at once,
 * preserving result order. The workhorse behind fan-out job execution.
 */
export async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i], i);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

/**
 * A concurrency-limited work queue that supports enqueuing MORE work while
 * running — exactly what a crawler needs (each scraped page discovers links).
 * In-process by design; swap for a distributed queue (BullMQ) behind the same
 * shape later if you need multi-worker scale.
 */
export class CrawlQueue<T> {
  private active = 0;
  private readonly queue: T[] = [];
  private readonly seen = new Set<string>();
  private resolveIdle: (() => void) | null = null;
  private idlePromise: Promise<void> | null = null;

  constructor(
    private readonly concurrency: number,
    private readonly worker: (item: T) => Promise<void>,
    private readonly keyOf: (item: T) => string,
  ) {}

  /** Add an item unless its key was already seen. Returns true if enqueued. */
  add(item: T): boolean {
    const key = this.keyOf(item);
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    this.queue.push(item);
    this.pump();
    return true;
  }

  get seenCount(): number {
    return this.seen.size;
  }

  private pump(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.active++;
      this.worker(item)
        .catch(() => {}) // worker owns its error handling
        .finally(() => {
          this.active--;
          this.pump();
          if (this.active === 0 && this.queue.length === 0 && this.resolveIdle) {
            this.resolveIdle();
          }
        });
    }
  }

  /** Resolves when the queue has fully drained (no active + none pending). */
  onIdle(): Promise<void> {
    if (this.active === 0 && this.queue.length === 0) return Promise.resolve();
    if (!this.idlePromise) {
      this.idlePromise = new Promise((res) => (this.resolveIdle = res));
    }
    return this.idlePromise;
  }
}
