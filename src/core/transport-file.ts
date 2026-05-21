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
import type { FlushStatus, TransportBackend, WindowSummary } from "./types.js";
import { RecostLocalDiskError } from "./types.js";

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
  /**
   * In-flight `end()` promises for streams orphaned by a disk-error episode.
   * dispose() awaits these so buffered writes get to flush before the
   * backend tears down.
   */
  private _pendingFlushes: Promise<void>[] = [];

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

    // Always attempt a real write — even if we're in queue mode from a prior
    // outage. `_handleDiskError` discards the broken stream when an error
    // arrives, so `_ensureStream` will reopen the file. If the disk has
    // recovered, the queued frames drain in chronological order ahead of the
    // current line and queue mode clears. If the disk is still broken, the
    // catch block re-enqueues and the latch stays held — no double onError.
    try {
      this._ensureStream();
      if (this._bytesWritten + line.length > this._cfg.maxFileBytes) {
        await this._rotate();
        this._ensureStream();
      }
      // Drain queued frames from a prior outage BEFORE the current line so
      // the file reflects chronological order.
      this._drainQueue();
      this._stream!.write(line);
      this._bytesWritten += line.length;
      // Real write succeeded — clear queue mode and re-arm error latches so
      // a future outage gets a fresh onError notification.
      this._queueMode = false;
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
    // Wait for streams orphaned by prior disk-error episodes to finish
    // flushing — without this, their buffered writes are lost when dispose
    // returns.
    if (this._pendingFlushes.length > 0) {
      await Promise.all(this._pendingFlushes);
      this._pendingFlushes = [];
    }
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
    if (this._disposed) return;
    // Drop the broken stream so the next send() opens a fresh one. Use end()
    // rather than destroy() so any data already in the stream's internal
    // buffer gets a chance to flush before the fd closes. Null the reference
    // before calling end() so an error emitted by end() itself cannot
    // recurse into the if-block.
    this._queueMode = true;
    if (this._stream) {
      const s = this._stream;
      this._stream = null;
      // Track the flush so dispose() can await it. Swallow errors emitted
      // during the flush — the disk was already broken; this is best-effort.
      this._pendingFlushes.push(
        new Promise<void>((resolve) => {
          s.on("error", () => { /* swallow flush-time errors */ });
          try { s.end(() => resolve()); }
          catch { resolve(); }
        }),
      );
    }
    if (this._diskErrorNotified) return;
    this._diskErrorNotified = true;
    this._cfg.onError?.(new RecostLocalDiskError(err));
  }
}
