/* JobManager: concurrency bound, independent completion, status + events.
   Deterministic — fake handlers, no network/LLM. */
import assert from "node:assert";
import { JobManager } from "../src/jobs/manager.js";
import type { JobEvent, JobHandler } from "../src/jobs/types.js";

let passed = 0;
const ok = (n: string) => (passed++, console.log(`  ✓ ${n}`));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("JobManager (fake handlers):");

  // Track live concurrency to prove the pool is bounded.
  let inFlight = 0;
  let peak = 0;
  const slow: JobHandler = async (input, { progress }) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    progress("working");
    await sleep(40);
    inFlight--;
    return { echo: input };
  };
  const boom: JobHandler = async () => {
    throw new Error("kaboom");
  };

  const events: JobEvent[] = [];
  const mgr = new JobManager({
    handlers: { slow, boom },
    concurrency: 2,
    onEvent: (e) => events.push(e),
  });

  const inputs = [
    { kind: "slow", input: 1 },
    { kind: "slow", input: 2 },
    { kind: "slow", input: 3 },
    { kind: "slow", input: 4 },
    { kind: "boom", input: 5 },
    { kind: "mystery", input: 6 }, // no handler
  ];

  const records = await mgr.submitAndRun(inputs);

  // 1. Concurrency never exceeded the configured limit.
  assert.ok(peak <= 2, `peak concurrency ${peak} > 2`);
  assert.equal(peak, 2, `expected pool to reach 2, got ${peak}`);
  ok(`bounded pool: peak concurrency = ${peak} (limit 2)`);

  // 2. All jobs finished; statuses correct.
  const byInput = (n: number) => records.find((r) => r.input === n)!;
  assert.equal(records.filter((r) => r.status === "done").length, 4);
  assert.equal(byInput(1).status, "done");
  assert.deepEqual(byInput(1).result, { echo: 1 });
  ok("4 slow jobs completed with results");

  // 3. A throwing job fails independently (others still done).
  assert.equal(byInput(5).status, "failed");
  assert.match(byInput(5).error!, /kaboom/);
  ok("a failing job is isolated: status=failed, error captured, siblings unaffected");

  // 4. Unknown kind -> failed with a clear message.
  assert.equal(byInput(6).status, "failed");
  assert.match(byInput(6).error!, /no handler/);
  ok("unknown job kind fails with 'no handler'");

  // 5. Timestamps + progress recorded.
  assert.ok(byInput(1).startedAt! >= byInput(1).queuedAt);
  assert.ok(byInput(1).finishedAt! >= byInput(1).startedAt!);
  assert.equal(byInput(1).progress, "working");
  ok("timestamps ordered (queued<=started<=finished) and progress captured");

  // 6. Lifecycle events emitted for every job.
  const started = events.filter((e) => e.type === "started").length;
  const finished = events.filter((e) => e.type === "finished").length;
  assert.equal(started, 6);
  assert.equal(finished, 6);
  ok(`events: ${started} started, ${finished} finished`);

  // 7. Live status query works.
  const one = await mgr.status(byInput(2).id);
  assert.equal(one?.status, "done");
  ok("status(id) returns the live record");

  console.log(`\nAll ${passed} job checks passed ✅`);
}

main().catch((e) => {
  console.error("\n❌ FAILED:", e);
  process.exit(1);
});
