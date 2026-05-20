/**
 * Transport — selects a backend (cloud / ws / file) at construction and
 * delegates send/dispose/lastFlushStatus to it. Owns the bucket-overflow
 * chunking loop in send() because it is identical across backends.
 */
import type {
  FlushStatus,
  RecostConfig,
  TransportMode,
  WindowSummary,
} from "./types.js";
import { MAX_BUCKETS } from "./aggregator.js";
import type { TransportBackend } from "./transport-backend.js";
import { CloudBackend } from "./transport-cloud.js";
import { WsBackend } from "./transport-ws.js";

interface ResolvedConfig {
  mode: TransportMode;
  maxBuckets: number;
}

function resolveConfig(config: RecostConfig): ResolvedConfig {
  return {
    mode: config.apiKey ? "cloud" : "local",
    maxBuckets: config.maxBuckets ?? MAX_BUCKETS,
  };
}

/** Delivers WindowSummary objects to the cloud API or the local VS Code extension. */
export class Transport {
  readonly mode: TransportMode;
  private readonly _cfg: ResolvedConfig;
  private readonly _backend: TransportBackend;

  constructor(config: RecostConfig) {
    this._cfg = resolveConfig(config);
    this.mode = this._cfg.mode;

    if (this._cfg.mode === "cloud") {
      this._backend = new CloudBackend({
        apiKey: config.apiKey ?? "",
        projectId: config.projectId ?? "",
        baseUrl: (config.baseUrl ?? "https://api.recost.dev").replace(/\/$/, ""),
        maxRetries: config.maxRetries ?? 3,
        maxConsecutiveAuthFailures: config.maxConsecutiveAuthFailures ?? 5,
        onError: config.onError,
      });
    } else {
      // Local mode — sub-mode selection happens in Task 5.
      // For this refactor commit, route everything to the WS backend
      // exactly as before. Default flip happens in Task 5.
      this._backend = new WsBackend({
        localPort: config.localPort ?? 9847,
        maxWsQueueSize: config.maxWsQueueSize ?? 1000,
        maxConsecutiveReconnectFailures: config.maxConsecutiveReconnectFailures ?? 20,
        onError: config.onError,
      });
    }
  }

  /** Outcome of the most recent flush, or null if no flush has completed. */
  get lastFlushStatus(): FlushStatus | null {
    return this._backend.lastFlushStatus;
  }

  /**
   * Send a WindowSummary. Never throws — errors are forwarded to onError.
   *
   * If the summary has more than maxBuckets metrics (degenerate burst case),
   * it is split into chunks of up to maxBuckets and sent sequentially. The
   * lastFlushStatus property reflects the final chunk's outcome.
   */
  async send(summary: WindowSummary): Promise<void> {
    if (summary.metrics.length > this._cfg.maxBuckets) {
      const chunkSize = this._cfg.maxBuckets;
      for (let i = 0; i < summary.metrics.length; i += chunkSize) {
        const chunk: WindowSummary = {
          ...summary,
          metrics: summary.metrics.slice(i, i + chunkSize),
        };
        await this._backend.send(chunk);
      }
      return;
    }
    await this._backend.send(summary);
  }

  /** Close backend resources (WebSocket, file handles, etc.) and cancel pending work. */
  async dispose(): Promise<void> {
    await this._backend.dispose();
  }

  /** Test-only: forwards to WsBackend._queueSize when in WS mode. */
  _queueSize(): number {
    return (this._backend as { _queueSize?: () => number })._queueSize?.() ?? 0;
  }

  // ---------------------------------------------------------------------------
  // Test-only forwarders to backend internals. Underscore-prefixed and not
  // exported from src/index.ts. Used by tests/transport.test.ts which predates
  // the backend extraction and reaches into Transport via `as unknown as`.
  // ---------------------------------------------------------------------------

  /** Test-only: forwards to WsBackend._reconnectAttempts (0 for non-WS backends). */
  get _reconnectAttempts(): number {
    return (this._backend as { _reconnectAttempts?: number })._reconnectAttempts ?? 0;
  }

  /** Test-only: forwards to WsBackend._localPaused (false for non-WS backends). */
  get _localPaused(): boolean {
    return (this._backend as { _localPaused?: boolean })._localPaused ?? false;
  }

  /** Test-only: forwards to WsBackend._wsQueue (empty for non-WS backends). */
  get _wsQueue(): string[] {
    return (this._backend as { _wsQueue?: string[] })._wsQueue ?? [];
  }

  /** Test-only: forwards to WsBackend._scheduleReconnect (no-op for non-WS backends). */
  _scheduleReconnect(): void {
    (this._backend as { _scheduleReconnect?: () => void })._scheduleReconnect?.();
  }
}
