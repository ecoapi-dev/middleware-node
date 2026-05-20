/**
 * Shared interface implemented by every transport backend
 * (cloud, ws, file). `Transport` selects one at construction and delegates.
 */
import type { FlushStatus, WindowSummary } from "./types.js";

export interface TransportBackend {
  send(summary: WindowSummary): Promise<void>;
  dispose(): Promise<void>;
  readonly lastFlushStatus: FlushStatus | null;
}
