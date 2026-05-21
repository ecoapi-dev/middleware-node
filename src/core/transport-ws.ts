/**
 * Local WebSocket backend: connects to ws://127.0.0.1:${localPort}, queues
 * payloads while disconnected, exponential-backoff reconnect with jitter,
 * unreachable-pause latch after N consecutive failures.
 *
 * Extracted verbatim from src/core/transport.ts; no behavior change.
 */
import WebSocket from "ws";
import type { FlushStatus, TransportBackend, WindowSummary } from "./types.js";
import { RecostLocalUnreachableError } from "./types.js";

interface WsConfig {
  localPort: number;
  maxWsQueueSize: number;
  maxConsecutiveReconnectFailures: number;
  onError?: ((err: Error) => void) | undefined;
}

export class WsBackend implements TransportBackend {
  private _lastFlushStatus: FlushStatus | null = null;
  private _ws: WebSocket | null = null;
  private _wsQueue: string[] = [];
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _reconnectAttempts = 0;
  private _disposed = false;
  /**
   * True once we have already fired an onError notification for the current
   * overflow episode. Reset to false the moment the queue drains back to
   * empty (in the `ws.on("open", ...)` drain handler). Guarantees at most
   * one notification per outage.
   */
  private _dropNotified = false;

  /**
   * True once `_reconnectAttempts` has reached `cfg.maxConsecutiveReconnectFailures`.
   * Never flipped back — recovery is process-restart-only in this PR. Causes
   * `_scheduleReconnect` to no-op and `send`'s local branch to short-circuit
   * to a silent no-op.
   */
  private _localPaused = false;

  constructor(private readonly cfg: WsConfig) {
    this._connectWs();
  }

  get lastFlushStatus(): FlushStatus | null {
    return this._lastFlushStatus;
  }

  /**
   * Test-only accessor for the current queued-payload count. Intentionally
   * underscore-prefixed and not exported from `src/index.ts` — there is no
   * production reason to read the queue depth from outside this module.
   */
  _queueSize(): number {
    return this._wsQueue.length;
  }

  async send(summary: WindowSummary): Promise<void> {
    const body = JSON.stringify(summary);
    const windowSize = summary.metrics.length;
    try {
      // Local WebSocket
      if (this._localPaused) {
        this._lastFlushStatus = { status: "error", windowSize, timestamp: Date.now() };
        return;
      }

      if (this._ws?.readyState === WebSocket.OPEN) {
        this._ws.send(body);
      } else {
        // Queue for when the connection opens. If the queue is already at
        // capacity, drop the oldest payload (FIFO) and — on the first drop
        // of this overflow episode — fire one onError so the host knows
        // telemetry is being shed. _dropNotified is reset when the queue
        // next drains to empty (see ws.on("open", ...)) so a future outage
        // gets a fresh notification.
        if (this._wsQueue.length >= this.cfg.maxWsQueueSize) {
          this._wsQueue.shift();
          if (!this._dropNotified) {
            this._dropNotified = true;
            const overflowErr = new Error(
              "recost: WebSocket queue overflowed; oldest messages dropped",
            );
            if (this.cfg.onError) this.cfg.onError(overflowErr);
          }
        }
        this._wsQueue.push(body);
      }
      this._lastFlushStatus = { status: "ok", windowSize, timestamp: Date.now() };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const msg = `[recost] transport error (windowSize=${windowSize}): ${error.message}`;
      console.warn(msg);
      this.cfg.onError?.(error);
      this._lastFlushStatus = { status: "error", windowSize, timestamp: Date.now() };
    }
  }

  async dispose(): Promise<void> {
    this._disposed = true;
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._ws?.close();
    this._ws = null;
  }

  private _connectWs(): void {
    if (this._disposed || this._localPaused) return;

    const url = `ws://127.0.0.1:${this.cfg.localPort}`;
    let ws: WebSocket;

    try {
      ws = new WebSocket(url);
    } catch {
      this._scheduleReconnect();
      return;
    }

    // Track the socket from the moment it exists, not from "open". Otherwise a
    // dispose() called while the handshake is still in CONNECTING sees
    // `this._ws === null` and the in-flight socket leaks until OS timeout.
    this._ws = ws;

    ws.on("open", () => {
      // A racing dispose() may have already torn down this backend. Bail so
      // we don't reset state on a disposed instance.
      if (this._disposed) return;
      // Successful connect resets the backoff so the next disconnect retries
      // promptly instead of inheriting whatever delay the previous outage hit.
      this._reconnectAttempts = 0;
      // Drain queued messages
      for (const msg of this._wsQueue) {
        try { ws.send(msg); } catch { /* swallow */ }
      }
      this._wsQueue = [];
      // The queue is empty again — this overflow episode is over. Future
      // outages get a fresh notification.
      this._dropNotified = false;
    });

    ws.on("close", () => {
      // Don't try to reconnect a backend that's been torn down. dispose()
      // already nulled `_ws` and set `_disposed`; _scheduleReconnect already
      // checks _disposed but the early return keeps intent local.
      if (this._disposed) return;
      this._ws = null;
      this._scheduleReconnect();
    });

    ws.on("error", () => {
      // "error" always precedes "close" — handled there
    });
  }

  /**
   * Exponential backoff with ±25% jitter:
   *   500ms, 1s, 2s, 4s, 8s, 16s, 30s (capped) — each ±25% random.
   *
   * Aligned with the Python SDK's _LocalTransport so both languages behave
   * identically on flaky local-extension restarts. Linear 3s retry was chosen
   * for simplicity but tends to thrash when the extension is genuinely down.
   */
  private _computeBackoffMs(): number {
    const base = Math.min(500 * 2 ** this._reconnectAttempts, 30_000);
    const jitter = 1 + (Math.random() - 0.5) * 0.5; // 0.75..1.25
    return Math.floor(base * jitter);
  }

  private _scheduleReconnect(): void {
    if (this._disposed || this._reconnectTimer !== null) return;

    if (this._reconnectAttempts >= this.cfg.maxConsecutiveReconnectFailures) {
      this._handleLocalUnreachable();
      return;
    }

    const delay = this._computeBackoffMs();
    this._reconnectAttempts += 1;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connectWs();
    }, delay);
  }

  /**
   * Pause the local transport after the consecutive-failure threshold is
   * reached. Idempotent — the `_localPaused` latch and the early-return in
   * `_scheduleReconnect` prevent re-entry. Emits one stderr line, one
   * `onError(RecostLocalUnreachableError)`, and drops the queued payloads
   * we will never deliver.
   */
  private _handleLocalUnreachable(): void {
    if (this._localPaused) return;          // defensive — should not be reachable
    this._localPaused = true;
    const n = this._reconnectAttempts;

    process.stderr.write(
      `[recost] local WebSocket unreachable after ${n} consecutive reconnect attempts. ` +
      `Restart the process after starting the VS Code extension.\n`,
    );

    if (this.cfg.onError) {
      this.cfg.onError(new RecostLocalUnreachableError(n));
    }

    // We will never drain — release the bounded memory.
    this._wsQueue = [];
  }
}
