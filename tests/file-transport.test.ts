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
    // Simulate stream error
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream = (backend as any)._stream as fs.WriteStream;
    stream.emit("error", new Error("simulated disk error"));
    await backend.send(makeSummary());           // would error again — silent
    expect(errors.filter((e) => e instanceof RecostLocalDiskError)).toHaveLength(1);
    await backend.dispose();
  });

  it("re-arms the error latch on next successful write", async () => {
    const errors: Error[] = [];
    const backend = new FileBackend({
      projectId: "recov", localDir: tmpDir,
      maxFileBytes: 10_000_000, maxLocalFileQueueSize: 1000,
      onError: (e) => errors.push(e),
    });
    await backend.send(makeSummary());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (backend as any)._stream.emit("error", new Error("err1"));
    expect(errors).toHaveLength(1);
    await backend.send(makeSummary());          // succeeds, drain, re-arm
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (backend as any)._stream.emit("error", new Error("err2"));
    expect(errors).toHaveLength(2);
    await backend.dispose();
  });
});

describe("FileBackend queue overflow", () => {
  it("drops oldest frame and fires onError once when queue is full", async () => {
    const errors: Error[] = [];
    const backend = new FileBackend({
      projectId: "ovf", localDir: tmpDir,
      maxFileBytes: 10_000_000, maxLocalFileQueueSize: 2,
      onError: (e) => errors.push(e),
    });
    await backend.send(makeSummary());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (backend as any)._stream.emit("error", new Error("disk gone"));
    // Now writes queue. Push 5 — queue cap is 2 — should drop 3.
    for (let i = 0; i < 5; i++) await backend.send(makeSummary());
    expect(errors.filter((e) => e.message.includes("queue overflowed"))).toHaveLength(1);
    await backend.dispose();
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
