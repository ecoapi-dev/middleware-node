/**
 * Cloud-mode backend: HTTPS POST to api.recost.dev with exponential-backoff
 * retry and 401 lifecycle (RecostAuthError / RecostFatalAuthError).
 *
 * Extracted verbatim from src/core/transport.ts; no behavior change.
 */
import type { FlushStatus, WindowSummary } from "./types.js";
import { RecostAuthError, RecostFatalAuthError } from "./types.js";
import { getRawFetch } from "./interceptor.js";
import type { TransportBackend } from "./transport-backend.js";

interface CloudConfig {
  apiKey: string;
  projectId: string;
  baseUrl: string;
  maxRetries: number;
  maxConsecutiveAuthFailures: number;
  onError?: ((err: Error) => void) | undefined;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function postCloud(
  url: string,
  body: string,
  apiKey: string,
  maxRetries: number,
): Promise<{ ok: boolean; status: number }> {
  const rawFetch = getRawFetch();
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await rawFetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${apiKey}`,
        },
        body,
      });

      if (res.ok) return { ok: true, status: res.status };

      // 4xx errors are not retriable — drop the payload, but return status for logging
      if (res.status >= 400 && res.status < 500) return { ok: false, status: res.status };

      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }

    if (attempt < maxRetries) {
      await sleep(Math.min(1000 * 2 ** attempt, 10_000));
    }
  }

  throw lastError;
}

export class CloudBackend implements TransportBackend {
  private _lastFlushStatus: FlushStatus | null = null;
  private _consecutiveAuthFailures = 0;
  private _cloudSuspended = false;

  constructor(private readonly cfg: CloudConfig) {}

  get lastFlushStatus(): FlushStatus | null {
    return this._lastFlushStatus;
  }

  async send(summary: WindowSummary): Promise<void> {
    const body = JSON.stringify(summary);
    const windowSize = summary.metrics.length;
    try {
      // Suspended after N consecutive 401s — silent no-op until restart.
      if (this._cloudSuspended) {
        this._lastFlushStatus = { status: "error", windowSize, timestamp: Date.now() };
        return;
      }

      const url = `${this.cfg.baseUrl}/projects/${this.cfg.projectId}/telemetry`;
      const result = await postCloud(url, body, this.cfg.apiKey, this.cfg.maxRetries);

      if (result.ok) {
        this._consecutiveAuthFailures = 0;
        this._lastFlushStatus = { status: "ok", windowSize, timestamp: Date.now() };
        return;
      }

      if (result.status === 401) {
        this._handleAuthFailure(windowSize);
        return;
      }

      // Non-401 rejection (403/404/422/etc.) — counter resets, existing
      // behavior preserved.
      this._consecutiveAuthFailures = 0;
      this._reportRejection(result.status, windowSize);
      this._lastFlushStatus = { status: "error", windowSize, timestamp: Date.now() };
      return;
    } catch (err) {
      this._consecutiveAuthFailures = 0;
      const error = err instanceof Error ? err : new Error(String(err));
      const msg = `[recost] transport error (windowSize=${windowSize}): ${error.message}`;
      console.warn(msg);
      this.cfg.onError?.(error);
      this._lastFlushStatus = { status: "error", windowSize, timestamp: Date.now() };
    }
  }

  async dispose(): Promise<void> {
    // No resources to release.
  }

  /**
   * Emit a warning for a non-2xx ingest response. Warning is always logged
   * (regardless of debug) and onError is fired if configured. Data loss on
   * rejection was silent before — this restores observability.
   */
  private _reportRejection(status: number, windowSize: number): void {
    // 401 is handled in _handleAuthFailure before this method is reached.
    const reason = status === 403
      ? "API key does not have access to this project. Check RECOST_PROJECT_ID."
      : status === 404
        ? "Project not found. Check RECOST_PROJECT_ID."
        : status === 422
          ? "telemetry payload rejected (possibly over the 2000-bucket limit)"
          : "telemetry payload rejected";
    const msg = `[recost] HTTP ${status} — ${reason} (windowSize=${windowSize})`;
    console.warn(msg);
    if (this.cfg.onError) this.cfg.onError(new Error(msg));
  }

  /**
   * Handle a 401 response. Increments the consecutive-failure counter, emits
   * the appropriate stderr line(s), fires `RecostAuthError` (or
   * `RecostFatalAuthError` once the threshold is reached), and — when fatal —
   * flips `_cloudSuspended` so subsequent sends short-circuit to a no-op.
   *
   * The first 401 of an episode emits a one-time stderr warning so hosts that
   * never wired `onError` still see something. The fatal threshold emits a
   * second, distinct stderr line announcing the suspension. 401s between #1
   * and the threshold are stderr-silent — `onError` carries the per-event
   * detail for hosts that wired it.
   */
  private _handleAuthFailure(windowSize: number): void {
    this._consecutiveAuthFailures += 1;
    const n = this._consecutiveAuthFailures;
    const threshold = this.cfg.maxConsecutiveAuthFailures;
    const isFirst = n === 1;
    const isFatal = n >= threshold;

    if (isFirst) {
      process.stderr.write(
        `[recost] HTTP 401 — API key rejected. Telemetry will stop after ` +
        `${threshold} consecutive failures. Check your apiKey at ` +
        `https://recost.dev/dashboard/account.\n`,
      );
    }

    if (isFatal) {
      this._cloudSuspended = true;
      process.stderr.write(
        `[recost] cloud transport suspended after ${n} consecutive auth failures. ` +
        `Restart the process after rotating apiKey.\n`,
      );
      if (this.cfg.onError) {
        this.cfg.onError(new RecostFatalAuthError(401, n));
      }
    } else if (this.cfg.onError) {
      this.cfg.onError(new RecostAuthError(401, n));
    }

    this._lastFlushStatus = { status: "error", windowSize, timestamp: Date.now() };
  }
}
