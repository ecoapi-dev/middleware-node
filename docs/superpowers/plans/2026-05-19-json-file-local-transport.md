# Wave 7 — JSON-file local-mode transport + excludePatterns contract (plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the never-used `ws://127.0.0.1:9847` default with an NDJSON-to-disk local transport (#37), and tighten the `excludePatterns` matching contract from substring to URL-prefix-or-exact-host (#14). Closes both issues — finishes the issue-waves backlog.

**Architecture:** Refactor `src/core/transport.ts` into a thin selector backed by per-mode backend modules (`transport-cloud`, `transport-ws`, `transport-file`). Add a `RecostConfig.localTransport: "ws" | "file"` flag defaulting to `"file"`. The file backend appends NDJSON `WindowSummary` lines to `~/.recost/local-telemetry/${projectId}.jsonl`, rolls to `.jsonl.1` at a configurable size, and queues in memory on disk failure. The exclude-pattern matcher in `init.ts:90` switches from `includes` to `startsWith` (URL) or exact equality (host), with internal exclusions rewritten to satisfy the tighter contract.

**Tech Stack:** TypeScript strict mode, vitest, Node ≥ 18 (`fs.createWriteStream`, `os.homedir`, `path.join`). No new runtime dependencies.

**Spec:** [`docs/superpowers/specs/2026-05-19-json-file-local-transport-design.md`](../specs/2026-05-19-json-file-local-transport-design.md)

**Test count target:**
- Baseline: 253 vitest + 7 dist smoke = **260** total (as of `origin/main` at `cc473cb`).
- Net new: ~23 (14 file-transport + 6 init + 3 validate-config).
- Final target: **~276 vitest + 7 dist = ~283** total.

**Branch / worktree:**
- Branch: `feat/37-14-file-transport-and-exclude-contract` off latest `origin/main`.
- Worktree: `.claude/worktrees/wave-7-file-transport/` (created via `superpowers:using-git-worktrees`).

**PR shape:** One PR. Body includes `Closes #37.` and `Closes #14.` on separate lines (GitHub auto-close keyword matches per-issue references only).

---

## Task 1: Branch setup and foundation commit

**Files:**
- Modify: `docs/superpowers/roadmap-2026-05-13-issue-waves.md`
- Add (new in worktree, untracked at origin): `docs/superpowers/specs/2026-05-19-json-file-local-transport-design.md`
- Add (new in worktree): `docs/superpowers/plans/2026-05-19-json-file-local-transport.md`
- Add (likely-untracked from prior session): `docs/superpowers/specs/2026-05-18-multi-realm-and-dispose-parity-design.md`
- Add (likely-untracked from prior session): `docs/superpowers/plans/2026-05-18-multi-realm-and-dispose-parity.md`
- Add (likely-untracked from prior session): `docs/superpowers/plans/2026-05-19-ci-and-build-cleanup.md`

This task lands the worktree + first commit. It carries Wave 5 → done, Wave 6 → done, and lands all the spec/plan docs accumulated since Wave 4. Per the wave-execution-pattern memory: first commit on a new wave's branch bundles the prior wave's roadmap-done update.

- [ ] **Step 1: Create the worktree off latest origin/main**

```bash
git fetch origin main
git worktree add -b feat/37-14-file-transport-and-exclude-contract .claude/worktrees/wave-7-file-transport origin/main
cd .claude/worktrees/wave-7-file-transport
```

Expected: worktree created on the new branch tracking `origin/main`. `git status` shows clean.

- [ ] **Step 2: Copy untracked spec/plan docs from the source workspace into the worktree**

The source workspace at `/home/andresl/Projects/recost/middleware-node` has untracked files from prior wave sessions that never landed on `main`. Copy any that exist:

```bash
SRC=/home/andresl/Projects/recost/middleware-node
for f in \
  docs/superpowers/specs/2026-05-18-multi-realm-and-dispose-parity-design.md \
  docs/superpowers/plans/2026-05-18-multi-realm-and-dispose-parity.md \
  docs/superpowers/plans/2026-05-19-ci-and-build-cleanup.md \
  docs/superpowers/specs/2026-05-19-json-file-local-transport-design.md \
  docs/superpowers/plans/2026-05-19-json-file-local-transport.md \
; do
  if [ -f "$SRC/$f" ]; then
    mkdir -p "$(dirname "$f")"
    cp "$SRC/$f" "$f"
  fi
done
```

Expected: all five files (or however many exist) present in the worktree.

- [ ] **Step 3: Update the roadmap — Wave 5 → done, Wave 6 → done, add Wave 7**

Edit `docs/superpowers/roadmap-2026-05-13-issue-waves.md`:

- Find the **Wave 5** block (line ~102) and change `**Status:** pending` → `**Status:** done` and add a line `**Merged PR:** https://github.com/recost-dev/middleware-node/pull/40` underneath it.
- Find the **Wave 6** block (line ~119) and change `**Status:** pending` → `**Status:** done` and add a line `**Merged PR:** https://github.com/recost-dev/middleware-node/pull/41` underneath it. Note: the Wave 6 entry as written groups `#14` + `#2`; the actually-merged PR #41 covers `#2` (tsup clean race) + CI workflow only. Update the issue table to reflect that #14 was deferred:

```markdown
| # | Title | Files |
|---|---|---|
| [#2](https://github.com/recost-dev/middleware-node/issues/2) | Build pipeline: tsup `clean: true` races between parallel configs | `tsup.config.ts`, `package.json` |
| CI workflow | GitHub Actions: build + lint + test on push/PR | `.github/workflows/ci.yml` |

#14 was deferred and bundled into Wave 7.
```

- Append a new **Wave 7** block after Wave 6:

```markdown
## Wave 7 — JSON-file local-mode transport + excludePatterns contract (final wave)

**Status:** in-progress

**Spec:** `specs/2026-05-19-json-file-local-transport-design.md`
**Plan:** `plans/2026-05-19-json-file-local-transport.md`

**Theme:** Replace the never-used WS default with NDJSON-to-disk; tighten the `excludePatterns` substring contract. Closes the issue-waves backlog.

**Issues:**

| # | Title | Files |
|---|---|---|
| [#37](https://github.com/recost-dev/middleware-node/issues/37) | Add JSON-file local-mode transport (alternative to WebSocket) | `src/core/transport*.ts` (new files), `src/core/types.ts`, `src/init.ts`, tests |
| [#14](https://github.com/recost-dev/middleware-node/issues/14) | `excludePatterns` substring matching contract is unscoped and untested | `src/init.ts:90`, `tests/init.test.ts` |

**Why bundled:** Only two open issues left on `middleware-node`; both touch `src/init.ts` + `tests/init.test.ts`. Same Wave 4 precedent (`#13` + `#21`).

**Recommended PR shape:** one plan, one PR. Body uses `Closes #37.` + `Closes #14.` on separate lines.
```

- [ ] **Step 4: Update the baseline test count note at the bottom of the roadmap**

Replace the line `**Test baseline.** As of 2026-05-13 after PR #32, baseline is 228 tests (221 vitest + 7 dist-bundle).` with:

```markdown
- **Test baseline.** As of 2026-05-19 after PRs #38, #40, #41, baseline is 260 tests (253 vitest + 7 dist-bundle). Each wave adjusts this number; the wave plan should record the new expected count.
```

- [ ] **Step 5: Stage and commit the foundation**

```bash
git add docs/superpowers/roadmap-2026-05-13-issue-waves.md \
        docs/superpowers/specs/ \
        docs/superpowers/plans/
git commit -m "$(cat <<'EOF'
docs: land wave 7 plan; mark waves 5 + 6 done

Bundles #37 (JSON-file local transport) and #14 (excludePatterns
contract) into a single wave. Last open issues on the repo — closes
the issue-waves backlog.

Also lands the spec/plan/roadmap notes from waves 5 and 6 that were
written but never committed before their PRs merged.
EOF
)"
```

Expected: clean commit on the new branch. `git log --oneline -1` shows the commit.

---

## Task 2: Types, validation, and `RecostLocalDiskError`

**Files:**
- Modify: `src/core/types.ts` (add four config fields + new error class)
- Modify: `src/core/validate-config.ts` (validate new fields)
- Test: `tests/validate-config.test.ts`

- [ ] **Step 1: Add the four new config fields to `RecostConfig` in `src/core/types.ts`**

Insert after the existing `maxConsecutiveReconnectFailures` jsdoc block (currently the last field before `onError`):

```ts
/**
 * Selects which local-mode transport to use when `apiKey` is absent.
 * - `"file"` (default): append NDJSON to disk at `${localDir}/${projectId}.jsonl`.
 * - `"ws"`: connect to a localhost WebSocket on `localPort` (legacy; requires a custom consumer).
 *
 * Has no effect in cloud mode. Defaults to `"file"`.
 */
localTransport?: "ws" | "file";
/**
 * Directory used by the file transport. Resolved as:
 *   1. `config.localDir` if set
 *   2. `process.env.RECOST_LOCAL_DIR` if set
 *   3. `path.join(os.homedir(), ".recost", "local-telemetry")` (default)
 * The directory is created recursively at construction time.
 */
localDir?: string;
/**
 * Size threshold for the file transport. When the current `.jsonl` file
 * exceeds this many bytes the SDK renames it to `.jsonl.1` (overwriting
 * any prior backup) and opens a fresh file. Disk usage is bounded at
 * roughly `2 × maxFileBytes`. Defaults to `10_000_000` (10 MB).
 */
maxFileBytes?: number;
/**
 * Maximum WindowSummary frames buffered in memory while disk writes are
 * failing. When full, the oldest queued frame is dropped (FIFO) and
 * `onError` is fired once per overflow episode. Defaults to 1000.
 */
maxLocalFileQueueSize?: number;
```

- [ ] **Step 2: Append `RecostLocalDiskError` to the error hierarchy at the bottom of `src/core/types.ts`**

```ts
/**
 * The file transport encountered a disk write failure (e.g. `EACCES`,
 * `ENOSPC`). Fired through `onError` once per error episode; the latch
 * resets on the next successful write. Unlike `RecostLocalUnreachableError`,
 * this error is transient — the transport keeps trying.
 */
export class RecostLocalDiskError extends RecostError {
  readonly cause?: Error;
  constructor(cause?: Error) {
    super(
      `Recost file transport write failed${cause ? `: ${cause.message}` : ""}. ` +
      `Subsequent writes will be retried; check disk space and ${"~/.recost/local-telemetry"} permissions.`,
    );
    this.name = "RecostLocalDiskError";
    if (cause) this.cause = cause;
  }
}
```

- [ ] **Step 3: Add validation rules in `src/core/validate-config.ts`**

After the existing `apiKey`/`projectId` block, append (still inside the `validateConfig` function):

```ts
if (config.localTransport !== undefined) {
  if (config.localTransport !== "ws" && config.localTransport !== "file") {
    throw new Error(
      `recost: localTransport must be "ws" or "file". Got: ${JSON.stringify(config.localTransport)}.`,
    );
  }
}

if (config.maxFileBytes !== undefined) {
  if (
    typeof config.maxFileBytes !== "number" ||
    !Number.isInteger(config.maxFileBytes) ||
    config.maxFileBytes < 1024
  ) {
    throw new Error(
      `recost: maxFileBytes must be a positive integer >= 1024. Got: ${JSON.stringify(config.maxFileBytes)}.`,
    );
  }
}

if (config.maxLocalFileQueueSize !== undefined) {
  if (
    typeof config.maxLocalFileQueueSize !== "number" ||
    !Number.isInteger(config.maxLocalFileQueueSize) ||
    config.maxLocalFileQueueSize < 1
  ) {
    throw new Error(
      `recost: maxLocalFileQueueSize must be a positive integer. Got: ${JSON.stringify(config.maxLocalFileQueueSize)}.`,
    );
  }
}

if (config.localDir !== undefined) {
  if (typeof config.localDir !== "string" || config.localDir === "") {
    throw new Error(
      `recost: localDir must be a non-empty string. Got: ${JSON.stringify(config.localDir)}.`,
    );
  }
}
```

- [ ] **Step 4: Write the failing validation tests**

Append to `tests/validate-config.test.ts` inside the existing `describe("validateConfig", ...)` block:

```ts
describe("localTransport", () => {
  it("accepts 'ws'", () => {
    expect(() => validateConfig({ localTransport: "ws" })).not.toThrow();
  });
  it("accepts 'file'", () => {
    expect(() => validateConfig({ localTransport: "file" })).not.toThrow();
  });
  it("rejects an unknown value", () => {
    expect(() =>
      validateConfig({ localTransport: "tcp" as unknown as "ws" })
    ).toThrow(/localTransport must be "ws" or "file"/);
  });
});

describe("maxFileBytes", () => {
  it("accepts 1024", () => {
    expect(() => validateConfig({ maxFileBytes: 1024 })).not.toThrow();
  });
  it("rejects values below 1024", () => {
    expect(() => validateConfig({ maxFileBytes: 1023 })).toThrow(
      /maxFileBytes must be a positive integer >= 1024/,
    );
  });
  it("rejects non-integers", () => {
    expect(() => validateConfig({ maxFileBytes: 1024.5 })).toThrow(
      /maxFileBytes must be a positive integer/,
    );
  });
});

describe("maxLocalFileQueueSize", () => {
  it("accepts 1", () => {
    expect(() => validateConfig({ maxLocalFileQueueSize: 1 })).not.toThrow();
  });
  it("rejects 0", () => {
    expect(() => validateConfig({ maxLocalFileQueueSize: 0 })).toThrow(
      /maxLocalFileQueueSize must be a positive integer/,
    );
  });
});

describe("localDir", () => {
  it("accepts a non-empty string", () => {
    expect(() => validateConfig({ localDir: "/tmp/recost" })).not.toThrow();
  });
  it("rejects an empty string", () => {
    expect(() => validateConfig({ localDir: "" })).toThrow(
      /localDir must be a non-empty string/,
    );
  });
});
```

- [ ] **Step 5: Run the new tests and verify they pass**

```bash
npx vitest run tests/validate-config.test.ts
```

Expected: all tests pass, including the new ones (3+3+2+2 = 10 new tests under their describe blocks). Type-check the new error class import path is clean.

- [ ] **Step 6: Run the full suite — no regressions**

```bash
npx vitest run && npm run lint
```

Expected: 263 vitest tests pass (253 + 10 new). Lint clean.

- [ ] **Step 7: Commit**

```bash
git add src/core/types.ts src/core/validate-config.ts tests/validate-config.test.ts
git commit -m "feat(types): add file-transport config fields + RecostLocalDiskError (#37)

Adds localTransport, localDir, maxFileBytes, maxLocalFileQueueSize to
RecostConfig and a new RecostLocalDiskError class. Validation rejects
bad values up front so misconfigured callers fail fast in init()."
```

---

## Task 3: Extract cloud + WS backends behind a shared interface

**Files:**
- Create: `src/core/transport-backend.ts` (shared interface)
- Create: `src/core/transport-cloud.ts` (lifted cloud logic)
- Create: `src/core/transport-ws.ts` (lifted WS logic)
- Modify: `src/core/transport.ts` (becomes a selector)

This task is a pure refactor — no behavior change. Existing transport tests must stay green throughout.

- [ ] **Step 1: Define the shared backend interface**

Create `src/core/transport-backend.ts`:

```ts
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
```

- [ ] **Step 2: Create `transport-cloud.ts`**

Create the file with the imports, the `CloudConfig` interface, and a `CloudBackend` class implementing `TransportBackend`. Lift the following pieces from the current `src/core/transport.ts` (line numbers reference the file as it exists on `origin/main` before this task):

| Lift from `transport.ts` | Destination in `transport-cloud.ts` |
|---|---|
| Lines 55-93 (`sleep` helper + `postCloud` function) | Top-of-file module functions |
| Lines 133, 140 (`_consecutiveAuthFailures`, `_cloudSuspended` state) | Class private fields |
| Lines 293-320 (cloud branch of `_sendOne` body) | Body of `CloudBackend.send()` |
| Lines 369-381 (`_reportRejection`) | Class private method |
| Lines 395-424 (`_handleAuthFailure`) | Class private method |

Skeleton (paste this, then fill in the lifted method bodies verbatim — only renaming `this._cfg` → `this.cfg` where the config field names match):

```ts
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
  // [PASTE LINES 64-92 from original transport.ts verbatim]
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
      // [PASTE original lines 293-320: cloud branch of _sendOne, replacing this._cfg → this.cfg]
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

  private _reportRejection(status: number, windowSize: number): void {
    // [PASTE original lines 369-381 verbatim, replacing this._cfg → this.cfg]
  }

  private _handleAuthFailure(windowSize: number): void {
    // [PASTE original lines 396-423 verbatim, replacing this._cfg → this.cfg]
  }
}
```

After pasting the lifted blocks, run `npm run lint` — type errors point at remaining `this._cfg` references that need renaming.

- [ ] **Step 3: Create `transport-ws.ts`**

Same pattern. Lift from current `src/core/transport.ts`:

| Lift from `transport.ts` | Destination in `transport-ws.ts` |
|---|---|
| Lines 106-117 + 125, 147-149 (`_ws`, `_wsQueue`, `_reconnectTimer`, `_reconnectAttempts`, `_disposed`, `_dropNotified`, `_localPaused`, `_queueSize()`) | Class fields + method |
| Lines 164-200 (`_connectWs`) | Class private method |
| Lines 210-214 (`_computeBackoffMs`) | Class private method |
| Lines 216-230 (`_scheduleReconnect`) | Class private method |
| Lines 239-255 (`_handleLocalUnreachable`) | Class private method |
| Lines 322-349 (local branch of `_sendOne`) | Body of `WsBackend.send()` |
| Lines 427-435 (dispose body) | Body of `WsBackend.dispose()` (now async) |

Skeleton:

```ts
/**
 * Local WebSocket backend: connects to ws://127.0.0.1:${localPort}, queues
 * payloads while disconnected, exponential-backoff reconnect with jitter,
 * unreachable-pause latch after N consecutive failures.
 *
 * Extracted verbatim from src/core/transport.ts; no behavior change.
 */
import WebSocket from "ws";
import type { FlushStatus, WindowSummary } from "./types.js";
import { RecostLocalUnreachableError } from "./types.js";
import type { TransportBackend } from "./transport-backend.js";

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
  private _dropNotified = false;
  private _localPaused = false;

  constructor(private readonly cfg: WsConfig) {
    this._connectWs();
  }

  get lastFlushStatus(): FlushStatus | null {
    return this._lastFlushStatus;
  }

  _queueSize(): number { return this._wsQueue.length; }

  async send(summary: WindowSummary): Promise<void> {
    const body = JSON.stringify(summary);
    const windowSize = summary.metrics.length;
    try {
      // [PASTE original lines 322-349: local branch of _sendOne]
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
    // [PASTE original lines 165-200 verbatim, replacing this._cfg → this.cfg]
  }

  private _computeBackoffMs(): number {
    // [PASTE original lines 211-214 verbatim, replacing this._cfg → this.cfg]
  }

  private _scheduleReconnect(): void {
    // [PASTE original lines 217-230 verbatim, replacing this._cfg → this.cfg]
  }

  private _handleLocalUnreachable(): void {
    // [PASTE original lines 240-255 verbatim, replacing this._cfg → this.cfg]
  }
}
```

- [ ] **Step 4: Rewrite `src/core/transport.ts` as a selector**

Replace the file's body with a thin dispatcher:

```ts
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

  get lastFlushStatus(): FlushStatus | null {
    return this._backend.lastFlushStatus;
  }

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

  async dispose(): Promise<void> {
    await this._backend.dispose();
  }
}
```

- [ ] **Step 5: Update `init.ts` to await the now-async `transport.dispose()`**

Edit `src/init.ts` — find the line `transport.dispose();` (around line 180) and change it to:

```ts
await transport.dispose();
```

(The enclosing function is already `async`.)

- [ ] **Step 6: Update test-only access path for `_queueSize`**

`tests/transport.test.ts` references `transport._queueSize()`. After the refactor, the WS queue lives on the backend. Add a test-only accessor on `Transport`:

```ts
// Add to src/core/transport.ts inside the class
/** Test-only: forwards to WsBackend._queueSize when in WS mode. */
_queueSize(): number {
  return (this._backend as { _queueSize?: () => number })._queueSize?.() ?? 0;
}
```

- [ ] **Step 7: Run the full suite — verify no behavior change**

```bash
npx vitest run && npm run lint
```

Expected: all 263 tests still pass (no new tests yet; the validate-config additions from Task 2 carry forward). Lint clean.

If any test fails, the lifting was not verbatim — debug before continuing.

- [ ] **Step 8: Commit**

```bash
git add src/core/transport.ts src/core/transport-backend.ts \
        src/core/transport-cloud.ts src/core/transport-ws.ts \
        src/init.ts
git commit -m "refactor(transport): extract cloud + ws into backend modules (#37)

Pure refactor — no behavior change. Splits the 437-line transport.ts
into a thin selector plus per-mode backends behind a shared
TransportBackend interface. Required so the upcoming file transport
isn't a fourth concern crammed into a single file.

Transport.dispose() becomes async to await the backend; init.ts awaits
it on shutdown."
```

---

## Task 4: File backend implementation (TDD)

**Files:**
- Test: `tests/file-transport.test.ts` (new)
- Create: `src/core/transport-file.ts` (new)

This is the heart of #37. Write the tests first; the backend exists to make them pass.

- [ ] **Step 1: Scaffold `tests/file-transport.test.ts` with the test harness**

```ts
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
```

- [ ] **Step 2: Add the basic-write test (failing, since `FileBackend` doesn't exist)**

```ts
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
    expect(lines[0].environment).toBe("test");
  });
});
```

- [ ] **Step 3: Run the test — confirm it fails on missing module**

```bash
npx vitest run tests/file-transport.test.ts
```

Expected: FAIL — `Cannot find module '../src/core/transport-file.js'`.

- [ ] **Step 4: Create the minimal `FileBackend` to pass the first test**

Create `src/core/transport-file.ts`:

```ts
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

    try {
      this._ensureStream();
      if (this._bytesWritten + line.length > this._cfg.maxFileBytes) {
        this._rotate();
      }
      this._stream!.write(line);
      this._bytesWritten += line.length;
      this._drainQueue();
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

  private _rotate(): void {
    if (this._stream) {
      this._stream.end();
      this._stream = null;
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
    this._diskErrorNotified = false;
    this._overflowNotified = false;
  }

  private _handleDiskError(err: Error): void {
    if (this._diskErrorNotified) return;
    this._diskErrorNotified = true;
    this._cfg.onError?.(new RecostLocalDiskError(err));
  }
}
```

- [ ] **Step 5: Run the basic-write test — confirm it passes**

```bash
npx vitest run tests/file-transport.test.ts
```

Expected: PASS for `writes three NDJSON lines with protocolVersion 1.0`.

- [ ] **Step 6: Add the remaining 13 tests**

Append to `tests/file-transport.test.ts`:

```ts
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
    expect(Array.isArray(lines[0].metrics)).toBe(true);
    expect(lines[0].metrics).toHaveLength(0);
  });
});
```

- [ ] **Step 7: Run the file-transport tests — expect failures, then implement until green**

```bash
npx vitest run tests/file-transport.test.ts
```

Iterate: each failing test points at a missing capability or a bug in `transport-file.ts`. Fix until all 14 pass. Do NOT add behavior beyond what a test demands.

- [ ] **Step 8: Run the full suite**

```bash
npx vitest run && npm run lint
```

Expected: 277 tests pass (263 + 14 new file-transport). Lint clean.

- [ ] **Step 9: Commit**

```bash
git add src/core/transport-file.ts tests/file-transport.test.ts
git commit -m "feat(transport): add NDJSON-to-disk file backend (#37)

FileBackend writes WindowSummary lines to
\${localDir}/\${projectId}.jsonl, each carrying protocolVersion '1.0'.
Rotates to .jsonl.1 at maxFileBytes (default 10MB). Queues in memory
on stream errors and overflows FIFO with one-shot onError per
episode. Dispose flushes the queue best-effort and closes the stream."
```

---

## Task 5: Wire `FileBackend` into the selector + default routing in `init.ts`

**Files:**
- Modify: `src/core/transport.ts` (selector adds file branch)
- Modify: `src/init.ts` (exclusion list conditional on local sub-mode)
- Modify: `tests/init.test.ts` (+2 routing tests for #37)
- Modify: `tests/transport.test.ts` (existing local-WS tests pass `localTransport: "ws"` explicitly)

- [ ] **Step 1: Update the selector to route by `localTransport`**

Edit `src/core/transport.ts` — the `else` branch in the constructor (local mode) becomes:

```ts
} else {
  const sub: "ws" | "file" = config.localTransport ?? "file";
  if (sub === "ws") {
    this._backend = new WsBackend({
      localPort: config.localPort ?? 9847,
      maxWsQueueSize: config.maxWsQueueSize ?? 1000,
      maxConsecutiveReconnectFailures: config.maxConsecutiveReconnectFailures ?? 20,
      onError: config.onError,
    });
  } else {
    this._backend = new FileBackend({
      projectId: config.projectId,
      localDir: config.localDir,
      maxFileBytes: config.maxFileBytes ?? 10_000_000,
      maxLocalFileQueueSize: config.maxLocalFileQueueSize ?? 1000,
      onError: config.onError,
    });
  }
}
```

Add the import at the top:

```ts
import { FileBackend } from "./transport-file.js";
```

- [ ] **Step 2: Update `init.ts` exclusion list**

Edit `src/init.ts` lines 75-81. Replace with:

```ts
const excludePatterns: string[] = [...(config.excludePatterns ?? [])];
if (config.apiKey) {
  excludePatterns.push((config.baseUrl ?? "https://api.recost.dev").replace(/\/$/, ""));
} else if ((config.localTransport ?? "file") === "ws") {
  const port = config.localPort ?? 9847;
  excludePatterns.push(`ws://127.0.0.1:${port}`);
  excludePatterns.push(`ws://localhost:${port}`);
}
// File mode: no exclusion — disk writes aren't HTTP.
```

(Note: the new patterns are URL-prefix shaped, satisfying the tightened contract that lands in Task 6.)

- [ ] **Step 3: Update the existing local-WS tests to pass `localTransport: "ws"` explicitly**

Edit `tests/transport.test.ts`. Every test that constructs `new Transport({ projectId: "..." })` for local mode now needs `localTransport: "ws"`. Grep for `new Transport(`:

```bash
grep -n "new Transport(" tests/transport.test.ts
```

For each match that does NOT pass `apiKey`, append `, localTransport: "ws"` to the config object. Example before:

```ts
const t = new Transport({ projectId: "p", localPort });
```

After:

```ts
const t = new Transport({ projectId: "p", localPort, localTransport: "ws" });
```

- [ ] **Step 4: Add the two routing tests to `init.test.ts`**

Append to `tests/init.test.ts` inside the existing `describe("init", ...)` block:

```ts
describe("local transport routing", () => {
  it("defaults to file mode when localTransport is omitted", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "recost-init-"));
    const handle = init({ projectId: "route1", localDir: tmpDir });
    try {
      // Trigger one captured event so the aggregator has data to flush
      const server = await startHttpServer();
      try {
        await fetch(server.url);
        // Force flush
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (handle as any).flush?.();
      } finally {
        await server.close();
      }
    } finally {
      await handle.dispose();
    }
    // .jsonl file exists in the localDir — proves file backend ran
    expect(fs.existsSync(path.join(tmpDir, "route1.jsonl"))).toBe(true);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("routes through the WS backend when localTransport: 'ws'", async () => {
    const collector = await startWsCollector();
    try {
      const handle = init({
        projectId: "route2",
        localTransport: "ws",
        localPort: collector.port,
      });
      const server = await startHttpServer();
      try {
        await fetch(server.url);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (handle as any).flush?.();
      } finally {
        await server.close();
      }
      await handle.dispose();
    } finally {
      await collector.close();
    }
    expect(collector.summaries.length).toBeGreaterThan(0);
  });
});
```

Add the imports at the top of the file if missing:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
```

- [ ] **Step 5: Run init + transport tests, then full suite**

```bash
npx vitest run tests/init.test.ts tests/transport.test.ts tests/file-transport.test.ts
npx vitest run && npm run lint
```

Expected: full suite 279 tests pass (277 + 2 new init routing). Lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/core/transport.ts src/init.ts tests/init.test.ts tests/transport.test.ts
git commit -m "feat(init): default localTransport to file; WS opt-in (#37)

Routes local mode through FileBackend by default. Users with a custom
local WS consumer pass localTransport: 'ws' to keep the old behavior.
Self-instrumentation exclusion now scopes to the active sub-mode:
file writes need no exclusion, WS exclusion uses ws:// URL prefixes."
```

---

## Task 6: Tighten `excludePatterns` matching contract (#14)

**Files:**
- Modify: `src/init.ts` (matcher at line ~90)
- Modify: `src/core/types.ts` (jsdoc on `excludePatterns`)
- Modify: `tests/init.test.ts` (+4 contract tests)

The matcher currently lives as an inline arrow at `init.ts:96`. End-to-end testing of contract behavior against an arbitrary URL is awkward (we'd need a fake host that resolves at the literal pattern). Cleaner: extract the matcher into an exported pure helper and unit-test it directly. Re-export from `src/index.ts` is NOT needed — the helper is imported only by tests.

- [ ] **Step 1: Extract the matcher into an exported helper in `src/init.ts`**

Add to `src/init.ts` (near the top, before `init`):

```ts
/**
 * Returns true if any pattern in `patterns` matches the event.
 *
 * Contract:
 * - URL match: `event.url.startsWith(pattern)` — pattern is a URL prefix.
 * - Host match: `event.host === pattern` — pattern is an exact hostname.
 *
 * No substring matching. No wildcards.
 */
export function matchesExcludePattern(
  event: { url: string; host: string },
  patterns: readonly string[],
): boolean {
  for (const p of patterns) {
    if (event.url.startsWith(p)) return true;
    if (event.host === p) return true;
  }
  return false;
}
```

Then replace the matcher call at the current `init.ts:90`:

```ts
if (matchesExcludePattern(event, excludePatterns)) return;
```

- [ ] **Step 2: Write the contract tests against the extracted helper**

Append a new describe block to `tests/init.test.ts`:

```ts
describe("excludePatterns matching contract (#14)", () => {
  it("URL-prefix match: pattern excludes URLs starting with it", () => {
    expect(matchesExcludePattern(
      { url: "https://api.example.com/v1/foo", host: "api.example.com" },
      ["https://api.example.com/v1"],
    )).toBe(true);
    expect(matchesExcludePattern(
      { url: "https://api.example.com/v2/foo", host: "api.example.com" },
      ["https://api.example.com/v1"],
    )).toBe(false);
  });

  it("exact-host match: pattern excludes any URL whose host equals it", () => {
    expect(matchesExcludePattern(
      { url: "https://api.example.com/anything", host: "api.example.com" },
      ["api.example.com"],
    )).toBe(true);
    expect(matchesExcludePattern(
      { url: "https://api.example.com/anything", host: "api.example.com" },
      ["example.com"],
    )).toBe(false);
  });

  it("no substring matching: short pattern does NOT over-match", () => {
    expect(matchesExcludePattern(
      { url: "https://example.com/api/foo", host: "example.com" },
      ["api"],
    )).toBe(false);
  });

  it("internal SDK exclusions cover own WS endpoint URLs", () => {
    // The SDK pushes ws://127.0.0.1:PORT in WS local mode; the connection
    // attempt URL starts with that exact prefix.
    expect(matchesExcludePattern(
      { url: "ws://127.0.0.1:9847", host: "127.0.0.1" },
      ["ws://127.0.0.1:9847", "ws://localhost:9847"],
    )).toBe(true);
  });
});
```

Add the import at the top:

```ts
import { matchesExcludePattern } from "../src/init.js";
```

- [ ] **Step 3: Update the `excludePatterns` jsdoc in `src/core/types.ts`**

Find the line currently documenting `excludePatterns` (`src/core/types.ts:145` area):

```ts
/** URL substrings that cause a matching request to be silently dropped. */
excludePatterns?: string[];
```

Replace with:

```ts
/**
 * URL prefixes or exact hostnames that cause a matching request to be silently
 * dropped. A pattern matches when `event.url.startsWith(pattern)` OR
 * `event.host === pattern`. No substring or wildcard semantics — a pattern
 * like `"api"` will NOT match `https://example.com/api/foo`.
 */
excludePatterns?: string[];
```

- [ ] **Step 4: Run init tests and full suite**

```bash
npx vitest run tests/init.test.ts
npx vitest run && npm run lint
```

Expected: 283 tests pass (279 + 4 new contract). Lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/init.ts src/core/types.ts tests/init.test.ts
git commit -m "feat(init): tighten excludePatterns to startsWith || exact host (#14)

Previous contract was substring on URL and host — short patterns like
'api' over-matched silently. New contract:
  - URL match: event.url.startsWith(pattern)
  - Host match: event.host === pattern
Internal SDK exclusions already rewritten in the prior commit to be
URL-prefix shaped, so this change preserves self-instrumentation."
```

---

## Task 7: Docs (CLAUDE.md + README)

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Update CLAUDE.md "Transport Modes" section**

Replace the existing "Transport Modes" block with:

````markdown
## Transport Modes

Local mode is selected when `apiKey` is absent. The sub-mode is chosen by `RecostConfig.localTransport`:

- **`"file"` (default)** — `FileBackend` appends NDJSON `WindowSummary` lines (each with `protocolVersion: "1.0"`) to `${localDir}/${projectId}.jsonl`. `localDir` resolves from `config.localDir` → `process.env.RECOST_LOCAL_DIR` → `~/.recost/local-telemetry`. File mode is `0o600` on POSIX (Windows ACL behavior differs; not enforced). Rolls to `.jsonl.1` once `maxFileBytes` (10MB default) is exceeded; disk usage bounded at ~2× that. Disk write failures fire `onError(RecostLocalDiskError)` once per episode; frames buffer in memory up to `maxLocalFileQueueSize` with FIFO overflow.
- **`"ws"` (opt-in)** — `WsBackend` connects to `ws://127.0.0.1:${localPort}`, queues payloads while disconnected, exponential-backoff reconnect with ±25% jitter (500ms → 30s), pauses with `RecostLocalUnreachableError` after `maxConsecutiveReconnectFailures`. Default port 9847.

**Cloud mode** (when `apiKey` is provided): HTTPS POST to `api.recost.dev` with exponential-backoff retry (max 3 attempts, 4xx skips retry). 401 lifecycle: `RecostAuthError` fires per 401; `RecostFatalAuthError` and suspend after `maxConsecutiveAuthFailures`.

### File-mode multi-process atomicity

- **POSIX:** `O_APPEND` makes offset bumps atomic. Lines up to `PIPE_BUF` (4096 bytes on Linux) are byte-atomic. Typical `WindowSummary` lines are <2KB; degenerate large summaries may interleave under concurrent writers but this is extremely rare.
- **Windows:** no append atomicity. Recommend per-process `projectId` (e.g. `${app}-${pid}`) if true multi-process telemetry is needed.

### `excludePatterns` contract

```ts
excludePatterns?: string[];
```

A pattern matches when `event.url.startsWith(pattern)` OR `event.host === pattern`. Pass URL prefixes (e.g. `"https://api.example.com/v1/private"`) or exact hostnames (e.g. `"api.example.com"`). No substring matching, no wildcards.
````

- [ ] **Step 2: Update the "vitest" line in CLAUDE.md to reflect the new test count**

Find:

```markdown
- **vitest** — unit testing (174 tests across 9 files)
```

Replace with:

```markdown
- **vitest** — unit testing (~276 tests across 12 files, +7 dist smoke)
```

- [ ] **Step 3: Update the file structure block in CLAUDE.md**

In the `## Project Structure` block, replace the `core/` listing to reflect the new files:

```
core/
  types.ts                # All interfaces + error classes (RecostError, RecostAuthError, RecostFatalAuthError, RecostLocalUnreachableError, RecostLocalDiskError)
  provider-registry.ts    # ProviderRegistry — 34 built-in rules
  interceptor.ts          # Patches globalThis.fetch, http.request, https.request, http.get, https.get
  aggregator.ts           # Time-windowed bucketing, percentiles, cost aggregation
  validate-config.ts      # Synchronous pre-flight checks
  transport.ts            # Thin selector — delegates to a backend
  transport-backend.ts    # Shared TransportBackend interface
  transport-cloud.ts      # Cloud backend (HTTPS POST + 401 lifecycle)
  transport-ws.ts         # Local WebSocket backend (queue + reconnect)
  transport-file.ts       # Local file backend (NDJSON + rotation)
```

Add an entry to `tests/` listing in the same block: `  file-transport.test.ts     # ~14 tests — file backend semantics`.

- [ ] **Step 4: Update README.md**

Find the section on local mode (search README for `localPort` or `local mode`). Add or update:

````markdown
### Local mode

When `apiKey` is absent the SDK runs in local mode. By default it writes NDJSON `WindowSummary` lines to `~/.recost/local-telemetry/${projectId}.jsonl` (override the directory with `localDir` or the `RECOST_LOCAL_DIR` env var). Each line carries `protocolVersion: "1.0"`. File mode is `0o600` on POSIX.

To opt back into the WebSocket transport (e.g. you run a custom local consumer):

```ts
init({ projectId: "my-proj", localTransport: "ws", localPort: 9847 });
```

### `excludePatterns`

Pass URL prefixes or exact hostnames. A pattern matches when `event.url.startsWith(pattern)` OR `event.host === pattern`. Example:

```ts
init({
  excludePatterns: [
    "https://api.example.com/v1/internal",  // URL prefix
    "api.metrics.local",                     // exact host
  ],
});
```
````

(If README structure differs, place the additions in the most natural section. Don't rewrite untouched sections.)

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: file transport, excludePatterns contract, structure refresh

CLAUDE.md: describe both local sub-modes, multi-process atomicity
contract, new excludePatterns semantics, refreshed file/test counts.
README.md: local-mode quick start, WS opt-in example, excludePatterns
example matching the new contract."
```

---

## Task 8: Final verification and PR

- [ ] **Step 1: Run the full suite + dist smoke + lint**

```bash
npx vitest run
npm run test:dist
npm run lint
```

Expected:
- vitest: ~276 tests pass.
- dist: 7 tests pass.
- lint: clean.

- [ ] **Step 2: Verify the worktree branch state**

```bash
git log --oneline origin/main..HEAD
git diff --stat origin/main..HEAD
```

Expected commits (in order):
1. `docs: land wave 7 plan; mark waves 5 + 6 done`
2. `feat(types): add file-transport config fields + RecostLocalDiskError (#37)`
3. `refactor(transport): extract cloud + ws into backend modules (#37)`
4. `feat(transport): add NDJSON-to-disk file backend (#37)`
5. `feat(init): default localTransport to file; WS opt-in (#37)`
6. `feat(init): tighten excludePatterns to startsWith || exact host (#14)`
7. `docs: file transport, excludePatterns contract, structure refresh`

- [ ] **Step 3: Push the branch**

```bash
git push -u origin feat/37-14-file-transport-and-exclude-contract
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --title "feat: NDJSON-to-disk local transport + excludePatterns contract" --body "$(cat <<'EOF'
## Summary

- Adds `FileBackend`, a default-on NDJSON-to-disk local transport. Old WS default reconnected forever to a server the extension never hosted (`recost-dev/extension#91`); writes now land at `~/.recost/local-telemetry/${projectId}.jsonl`, each line carrying `protocolVersion: "1.0"`.
- Tightens `excludePatterns` matching from substring-includes to URL-prefix-or-exact-host. Short patterns no longer silently over-match.
- Refactors `transport.ts` into a thin selector over per-mode backend modules so the file path doesn't pile a fourth concern into one file.

Closes #37.
Closes #14.

## Test plan

- [x] `npx vitest run` — ~276 tests pass (baseline 253 + ~23 new across `file-transport`, `init`, `validate-config`).
- [x] `npm run test:dist` — 7 dist smoke tests pass; no new exports leaked.
- [x] `npm run lint` — clean.
- [x] Manual: `init({ projectId: "proj_x" })` + 3 `fetch()` calls produces 3 NDJSON lines in `~/.recost/local-telemetry/proj_x.jsonl`, each with `protocolVersion: "1.0"`, file mode `0o600` on POSIX.
- [x] Manual: `init({ projectId: "proj_x", localTransport: "ws" })` still attempts the WS path.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Update the roadmap to mark Wave 7 done after the PR merges**

(Post-merge follow-up — done by a future session or appended as a follow-up commit. The wave-execution-pattern memory says the first commit on the *next* wave's branch flips the prior wave to done; for Wave 7 there's no next wave, so a small standalone commit to `main` or a sentence in the merge commit is sufficient.)

---

## Cross-task notes

- **Type checking:** `npm run lint` is `tsc --noEmit`. Run after each task to catch type drift early.
- **The `local-fs.test.ts` pattern for spying:** `vi.spyOn(fs, "mkdirSync")` works because vitest's mock interception covers Node built-ins. If a spy on `fs.statSync` is also needed, restore in the test's `finally` block.
- **Test isolation:** every file-transport test uses `fs.mkdtempSync` in `beforeEach` and `fs.rmSync(... recursive: true ...)` in `afterEach`. No cross-test state. The `delete process.env.RECOST_LOCAL_DIR` in afterEach prevents leakage between tests.
- **Avoid `--no-verify` and `--no-edit`** — never bypass pre-commit hooks. If a hook fails, fix the underlying issue.
- **Subagent handoff:** when dispatching a per-task subagent, pass the task body verbatim plus the worktree path (`.claude/worktrees/wave-7-file-transport`) and the rule "stay inside the worktree; commit at the end of the task as specified; do not touch other tasks."
