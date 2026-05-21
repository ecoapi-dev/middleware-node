/**
 * Tests for src/core/transport-file.ts — NDJSON-to-disk local transport.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileBackend } from "../src/core/transport-file.js";
import { RecostLocalDiskError, type WindowSummary } from "../src/core/types.js";

function makeSummary(overrides: Partial<WindowSummary> = {}): WindowSummary {
  return {
    environment: "test",
    sdkLanguage: "node",
    sdkVersion: "0.1.0",
    windowStart: "2026-05-19T00:00:00.000Z",
    windowEnd: "2026-05-19T00:00:30.000Z",
    metrics: [],
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "recost-file-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.RECOST_LOCAL_DIR;
});

function readLines(p: string): unknown[] {
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

describe("FileBackend basic write", () => {
  it("writes three NDJSON lines with protocolVersion 1.0", async () => {
    const backend = new FileBackend({
      projectId: "proj_x",
      localDir: tmpDir,
      maxFileBytes: 10_000_000,
      maxLocalFileQueueSize: 1000,
      onError: undefined,
    });
    await backend.send(makeSummary());
    await backend.send(makeSummary());
    await backend.send(makeSummary());
    await backend.dispose();

    const lines = readLines(path.join(tmpDir, "proj_x.jsonl")) as Array<{
      protocolVersion: string;
      environment: string;
    }>;
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.protocolVersion === "1.0")).toBe(true);
    expect(lines[0]!.environment).toBe("test");
  });
});

describe("FileBackend permissions and path", () => {
  it.skipIf(process.platform === "win32")(
    "creates file with mode 0o600 on POSIX",
    async () => {
      const backend = new FileBackend({
        projectId: "proj_x", localDir: tmpDir,
        maxFileBytes: 10_000_000, maxLocalFileQueueSize: 1000, onError: undefined,
      });
      await backend.send(makeSummary());
      await backend.dispose();
      const stat = fs.statSync(path.join(tmpDir, "proj_x.jsonl"));
      expect(stat.mode & 0o777).toBe(0o600);
    },
  );

  it("honors RECOST_LOCAL_DIR env var", async () => {
    process.env.RECOST_LOCAL_DIR = tmpDir;
    const backend = new FileBackend({
      projectId: "envtest", localDir: undefined,
      maxFileBytes: 10_000_000, maxLocalFileQueueSize: 1000, onError: undefined,
    });
    await backend.send(makeSummary());
    await backend.dispose();
    expect(fs.existsSync(path.join(tmpDir, "envtest.jsonl"))).toBe(true);
  });

  it("config.localDir overrides RECOST_LOCAL_DIR", async () => {
    process.env.RECOST_LOCAL_DIR = "/dev/null/should-not-be-used";
    const backend = new FileBackend({
      projectId: "ovr", localDir: tmpDir,
      maxFileBytes: 10_000_000, maxLocalFileQueueSize: 1000, onError: undefined,
    });
    await backend.send(makeSummary());
    await backend.dispose();
    expect(fs.existsSync(path.join(tmpDir, "ovr.jsonl"))).toBe(true);
  });

  it("falls back to ~/.recost/local-telemetry when no override is set", () => {
    // We don't actually write here — just verify the resolved path
    // points at the homedir fallback. Construct with a doomed path that
    // would never be writable, but check the directory was attempted via mkdirSync.
    // Easiest: spy on mkdirSync.
    const spy = vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    try {
      // eslint-disable-next-line @typescript-eslint/no-new
      new FileBackend({
        projectId: "fb", localDir: undefined,
        maxFileBytes: 10_000_000, maxLocalFileQueueSize: 1000, onError: undefined,
      });
      const expected = path.join(os.homedir(), ".recost", "local-telemetry");
      expect(spy).toHaveBeenCalledWith(expected, expect.objectContaining({ recursive: true }));
    } finally {
      spy.mockRestore();
    }
  });
});

describe("FileBackend projectId sanitization", () => {
  it("strips slashes from projectId", async () => {
    const backend = new FileBackend({
      projectId: "proj/x", localDir: tmpDir,
      maxFileBytes: 10_000_000, maxLocalFileQueueSize: 1000, onError: undefined,
    });
    await backend.send(makeSummary());
    await backend.dispose();
    expect(fs.existsSync(path.join(tmpDir, "projx.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "proj/x.jsonl"))).toBe(false);
  });

  it("defaults to 'default' when projectId is omitted", async () => {
    const backend = new FileBackend({
      projectId: undefined, localDir: tmpDir,
      maxFileBytes: 10_000_000, maxLocalFileQueueSize: 1000, onError: undefined,
    });
    await backend.send(makeSummary());
    await backend.dispose();
    expect(fs.existsSync(path.join(tmpDir, "default.jsonl"))).toBe(true);
  });
});

describe("FileBackend rotation", () => {
  it("rolls to .jsonl.1 once maxFileBytes is exceeded", async () => {
    // Tiny maxFileBytes forces rotation after the first write
    const backend = new FileBackend({
      projectId: "rot", localDir: tmpDir,
      maxFileBytes: 1024, maxLocalFileQueueSize: 1000, onError: undefined,
    });
    // Each write is small but the cumulative threshold trips after enough writes
    for (let i = 0; i < 20; i++) await backend.send(makeSummary());
    await backend.dispose();
    expect(fs.existsSync(path.join(tmpDir, "rot.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "rot.jsonl.1"))).toBe(true);
  });

  it("overwrites .jsonl.1 on the second rotation (no .jsonl.2)", async () => {
    const backend = new FileBackend({
      projectId: "rot2", localDir: tmpDir,
      maxFileBytes: 1024, maxLocalFileQueueSize: 1000, onError: undefined,
    });
    for (let i = 0; i < 40; i++) await backend.send(makeSummary());
    await backend.dispose();
    expect(fs.existsSync(path.join(tmpDir, "rot2.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "rot2.jsonl.1"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "rot2.jsonl.2"))).toBe(false);
  });
});

describe("FileBackend disk errors", () => {
  it("fires onError(RecostLocalDiskError) once per error episode", async () => {
    const errors: Error[] = [];
    const backend = new FileBackend({
      projectId: "err", localDir: tmpDir,
      maxFileBytes: 10_000_000, maxLocalFileQueueSize: 1000,
      onError: (e) => errors.push(e),
    });
    await backend.send(makeSummary());           // open + happy path
    // Simulate a disk error. Calling _handleDiskError directly avoids the
    // side effect of `stream.emit("error", ...)` which would also put Node's
    // WriteStream into an errored state and drop any buffered writes before
    // the lazy fd open completed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (backend as any)._handleDiskError(new Error("simulated disk error"));
    // Next send opens a fresh stream and succeeds — no second onError fires
    // because no second error happened.
    await backend.send(makeSummary());
    expect(errors.filter((e) => e instanceof RecostLocalDiskError)).toHaveLength(1);
    await backend.dispose();
  });

  it("recovers from queue mode on next successful write — drains queue, re-arms latch", async () => {
    const errors: Error[] = [];
    const backend = new FileBackend({
      projectId: "recov", localDir: tmpDir,
      maxFileBytes: 10_000_000, maxLocalFileQueueSize: 1000,
      onError: (e) => errors.push(e),
    });
    await backend.send(makeSummary({ environment: "env_a" }));
    // Simulate disk error via the internal handler — backend enters queue
    // mode and discards the broken stream.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (backend as any)._handleDiskError(new Error("transient disk error"));
    expect(errors.filter((e) => e instanceof RecostLocalDiskError)).toHaveLength(1);

    // Disk is healthy again. Next send reopens, writes through, and clears
    // queue mode.
    await backend.send(makeSummary({ environment: "env_b" }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((backend as any)._queueMode).toBe(false);

    // Trigger a second error episode — onError fires again because the latch
    // was re-armed by a real successful write, not by a silent queue-mode
    // no-op (the prior bug).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (backend as any)._handleDiskError(new Error("err2"));
    expect(errors.filter((e) => e instanceof RecostLocalDiskError)).toHaveLength(2);

    await backend.dispose();

    // Both writes reach disk. The old stream's flush and the new stream's
    // write race against each other (both async, same path, O_APPEND), so
    // assert as a set rather than a sequence.
    const lines = readLines(path.join(tmpDir, "recov.jsonl")) as Array<{
      environment: string;
    }>;
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.environment).sort()).toEqual(["env_a", "env_b"]);
  });

  it("drains queued frames in chronological order when disk recovers", async () => {
    const errors: Error[] = [];
    // Force the first stream creation to fail so send() catches and enqueues.
    const realCreate = fs.createWriteStream.bind(fs);
    let failCount = 1;
    const spy = vi
      .spyOn(fs, "createWriteStream")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation(((p: fs.PathLike, opts: any) => {
        if (failCount-- > 0) throw new Error("simulated open failure");
        return realCreate(p, opts);
      }) as typeof fs.createWriteStream);

    try {
      const backend = new FileBackend({
        projectId: "drain", localDir: tmpDir,
        maxFileBytes: 10_000_000, maxLocalFileQueueSize: 1000,
        onError: (e) => errors.push(e),
      });
      // First send: createWriteStream throws → catch enqueues, fires disk error.
      await backend.send(makeSummary({ environment: "env_first" }));
      expect(errors.filter((e) => e instanceof RecostLocalDiskError)).toHaveLength(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((backend as any)._queue).toHaveLength(1);

      // Disk recovers. Second send opens a real stream and drains the queued
      // frame BEFORE writing the current frame.
      await backend.send(makeSummary({ environment: "env_second" }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((backend as any)._queueMode).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((backend as any)._queue).toHaveLength(0);

      await backend.dispose();
      const lines = readLines(path.join(tmpDir, "drain.jsonl")) as Array<{
        environment: string;
      }>;
      expect(lines.map((l) => l.environment)).toEqual(["env_first", "env_second"]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("FileBackend queue overflow", () => {
  it("drops oldest frame and fires onError once during a sustained outage", async () => {
    const errors: Error[] = [];
    // Sustained disk failure — createWriteStream always throws so every send
    // hits the catch path and enqueues, exercising the overflow eviction.
    const spy = vi
      .spyOn(fs, "createWriteStream")
      .mockImplementation((() => {
        throw new Error("disk gone");
      }) as typeof fs.createWriteStream);
    try {
      const backend = new FileBackend({
        projectId: "ovf", localDir: tmpDir,
        maxFileBytes: 10_000_000, maxLocalFileQueueSize: 2,
        onError: (e) => errors.push(e),
      });
      // Push 5 — queue cap is 2 — should drop 3 and fire one overflow error.
      for (let i = 0; i < 5; i++) await backend.send(makeSummary());
      expect(errors.filter((e) => e.message.includes("queue overflowed"))).toHaveLength(1);
      await backend.dispose();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("FileBackend dispose", () => {
  it("flushes the queue and closes the stream", async () => {
    const backend = new FileBackend({
      projectId: "disp", localDir: tmpDir,
      maxFileBytes: 10_000_000, maxLocalFileQueueSize: 1000, onError: undefined,
    });
    await backend.send(makeSummary());
    await backend.send(makeSummary());
    await backend.dispose();
    // Second dispose is a no-op
    await backend.dispose();
    expect(readLines(path.join(tmpDir, "disp.jsonl"))).toHaveLength(2);
  });
});

describe("FileBackend continuity", () => {
  it("appends — does not overwrite — across backend instances", async () => {
    const cfg = {
      projectId: "cont", localDir: tmpDir,
      maxFileBytes: 10_000_000, maxLocalFileQueueSize: 1000, onError: undefined,
    };
    const a = new FileBackend(cfg);
    await a.send(makeSummary());
    await a.dispose();
    const b = new FileBackend(cfg);
    await b.send(makeSummary());
    await b.dispose();
    expect(readLines(path.join(tmpDir, "cont.jsonl"))).toHaveLength(2);
  });

  it("writes an empty-metrics summary as a single valid NDJSON line", async () => {
    const backend = new FileBackend({
      projectId: "empty", localDir: tmpDir,
      maxFileBytes: 10_000_000, maxLocalFileQueueSize: 1000, onError: undefined,
    });
    await backend.send(makeSummary({ metrics: [] }));
    await backend.dispose();
    const lines = readLines(path.join(tmpDir, "empty.jsonl")) as Array<{ metrics: unknown[] }>;
    expect(lines).toHaveLength(1);
    expect(Array.isArray(lines[0]!.metrics)).toBe(true);
    expect(lines[0]!.metrics).toHaveLength(0);
  });
});
