/**
 * File-mode local backend: appends NDJSON WindowSummary lines to
 * ${localDir}/${projectId}.jsonl. Each line carries protocolVersion "1.0".
 *
 * Rolls to .jsonl.1 once the current file exceeds maxFileBytes.
 * On stream errors, queues in memory up to maxLocalFileQueueSize and
 * fires onError(RecostLocalDiskError) once per episode.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FlushStatus, WindowSummary } from "./types.js";
import { RecostLocalDiskError } from "./types.js";
import type { TransportBackend } from "./transport-backend.js";

interface FileConfig {
  projectId: string | undefined;
  localDir: string | undefined;
  maxFileBytes: number;
  maxLocalFileQueueSize: number;
  onError: ((err: Error) => void) | undefined;
}

function sanitizeProjectId(raw: string | undefined): string {
  const s = (raw ?? "default").replace(/[^A-Za-z0-9_-]/g, "");
  return s === "" ? "default" : s;
}

function resolveDir(localDir: string | undefined): string {
  if (localDir !== undefined) return localDir;
  if (process.env.RECOST_LOCAL_DIR) return process.env.RECOST_LOCAL_DIR;
  return path.join(os.homedir(), ".recost", "local-telemetry");
}

export class FileBackend implements TransportBackend {
  private readonly _filePath: string;
  private readonly _cfg: FileConfig;
  private _stream: fs.WriteStream | null = null;
  private _bytesWritten = 0;
  private _queue: string[] = [];
  private _diskErrorNotified = false;
  private _overflowNotified = false;
  private _queueMode = false;
  private _lastFlushStatus: FlushStatus | null = null;
  private _disposed = false;

  constructor(cfg: FileConfig) {
    this._cfg = cfg;
    const dir = resolveDir(cfg.localDir);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this._filePath = path.join(dir, `${sanitizeProjectId(cfg.projectId)}.jsonl`);
  }

  get lastFlushStatus(): FlushStatus | null {
    return this._lastFlushStatus;
  }

  async send(summary: WindowSummary): Promise<void> {
    if (this._disposed) return;
    const line = JSON.stringify({ ...summary, protocolVersion: "1.0" }) + "\n";
    const windowSize = summary.metrics.length;

    // Once a disk error has put us in queue mode, subsequent sends queue
    // until a successful write happens (which can only occur via a future
    // recovery attempt — for now, dispose drains the queue best-effort).
    if (this._queueMode) {
      this._enqueue(line);
      // A send completed (even if only queued) — re-arm the disk-error
      // latch so the next error event fires another onError.
      this._diskErrorNotified = false;
      this._lastFlushStatus = { status: "error", windowSize, timestamp: Date.now() };
      return;
    }

    try {
      this._ensureStream();
      if (this._bytesWritten + line.length > this._cfg.maxFileBytes) {
        await this._rotate();
        this._ensureStream();
      }
      this._stream!.write(line);
      this._bytesWritten += line.length;
      this._drainQueue();
      // Re-arm latches after a successful write.
      this._diskErrorNotified = false;
      this._overflowNotified = false;
      this._lastFlushStatus = { status: "ok", windowSize, timestamp: Date.now() };
    } catch (err) {
      this._enqueue(line);
      this._handleDiskError(err as Error);
      this._lastFlushStatus = { status: "error", windowSize, timestamp: Date.now() };
    }
  }

  async dispose(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;
    // Best-effort sync drain — swallow throws.
    for (const queued of this._queue) {
      try { fs.appendFileSync(this._filePath, queued, { mode: 0o600 }); } catch { /* swallow */ }
    }
    this._queue = [];
    await new Promise<void>((resolve) => {
      if (!this._stream) return resolve();
      this._stream.end(() => resolve());
    });
    this._stream = null;
  }

  private _ensureStream(): void {
    if (this._stream) return;
    if (fs.existsSync(this._filePath)) {
      this._bytesWritten = fs.statSync(this._filePath).size;
    } else {
      this._bytesWritten = 0;
    }
    this._stream = fs.createWriteStream(this._filePath, { flags: "a", mode: 0o600 });
    this._stream.on("error", (err) => this._handleDiskError(err));
  }

  private async _rotate(): Promise<void> {
    if (this._stream) {
      const s = this._stream;
      this._stream = null;
      await new Promise<void>((resolve) => s.end(() => resolve()));
    }
    try {
      fs.renameSync(this._filePath, this._filePath + ".1");
    } catch {
      // If rotation fails (file vanished, permission), proceed with a fresh stream.
    }
    this._bytesWritten = 0;
  }

  private _enqueue(line: string): void {
    if (this._queue.length >= this._cfg.maxLocalFileQueueSize) {
      this._queue.shift();
      if (!this._overflowNotified) {
        this._overflowNotified = true;
        this._cfg.onError?.(
          new Error("recost: file-transport queue overflowed; oldest frames dropped"),
        );
      }
    }
    this._queue.push(line);
  }

  private _drainQueue(): void {
    if (this._queue.length === 0) return;
    while (this._queue.length > 0 && this._stream) {
      const line = this._queue.shift()!;
      this._stream.write(line);
      this._bytesWritten += line.length;
    }
  }

  private _handleDiskError(err: Error): void {
    // Enter queue mode so subsequent sends accumulate in memory rather
    // than trying to write to a stream we know is broken.
    this._queueMode = true;
    if (this._diskErrorNotified) return;
    this._diskErrorNotified = true;
    this._cfg.onError?.(new RecostLocalDiskError(err));
  }
}
