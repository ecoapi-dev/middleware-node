# Wave 7 — JSON-file local-mode transport + excludePatterns contract (design)

**Status:** approved 2026-05-19 (revised to bundle #14)
**Issues:**
- [recost-dev/middleware-node#37](https://github.com/recost-dev/middleware-node/issues/37) — Add JSON-file local-mode transport (P1)
- [recost-dev/middleware-node#14](https://github.com/recost-dev/middleware-node/issues/14) — `excludePatterns` substring matching contract is unscoped and untested (P2)
**Related:** `recost-dev/extension#91` (WS server not hosted), `recost-dev/extension#99` (protocolVersion)
**Cross-SDK mirror:** `recost-dev/middleware-python` (separate wave on that side)

## Bundling rationale

These are the only two open issues on `middleware-node` and both touch `src/init.ts` + `tests/init.test.ts`. Wave 4 established the precedent of bundling a small fix (`#21`) into a larger wave (`#13`) when they share files. Closing both in one PR finishes the issue-waves backlog.

## Motivation

`Transport` defaults to local mode when `apiKey` is missing and opens `ws://127.0.0.1:9847`. The VS Code extension does not host that server and has decided not to (`recost-dev/extension#91`). Every default-configured SDK in local mode reconnects forever to nothing.

Replace the default local transport with NDJSON-to-disk. WebSockets remain available behind an opt-in flag for users running custom local consumers; removal is tracked separately.

## Public API surface

Additions to `RecostConfig` (`src/core/types.ts`):

```ts
/** Local-mode transport flavor. Only meaningful when apiKey is absent. Defaults to "file". */
localTransport?: "ws" | "file";

/** Override the directory used by the file transport. Falls back to RECOST_LOCAL_DIR env, then ~/.recost/local-telemetry. */
localDir?: string;

/** Roll the .jsonl file to .jsonl.1 once the current file exceeds this size. Defaults to 10_000_000 (10 MB). */
maxFileBytes?: number;

/** Maximum WindowSummary frames buffered in memory while disk writes are failing. Defaults to 1000. */
maxLocalFileQueueSize?: number;
```

New error class in the same file:

```ts
/** Disk write failure on the file transport. Fired once per overflow/error episode; resets on next successful write. */
export class RecostLocalDiskError extends RecostError { ... }
```

`TransportMode` stays `"local" | "cloud"`. The file vs ws split is internal.

## Backend refactor

The existing `src/core/transport.ts` (437 lines) mixes three concerns: cloud retry/auth, WS queue/reconnect, top-level dispatch + bucket chunking. Adding a fourth concern (file IO with its own queue) without splitting will push it past maintainability. Targeted split:

| File | Responsibility |
|---|---|
| `src/core/transport.ts` | Public `Transport` class. Resolves config, selects backend, delegates `send/dispose/lastFlushStatus`. Owns the bucket-overflow chunking loop (one path for all backends). |
| `src/core/transport-cloud.ts` | Cloud POST + retries + auth-failure latch. Lifted from current `transport.ts`. |
| `src/core/transport-ws.ts` | Local WS queue + reconnect + unreachable-latch. Lifted from current `transport.ts`. |
| `src/core/transport-file.ts` | New. NDJSON append, rotation, in-memory failure queue. |

Shared interface:

```ts
interface TransportBackend {
  send(summary: WindowSummary): Promise<void>;
  dispose(): Promise<void>;
  readonly lastFlushStatus: FlushStatus | null;
}
```

The current `Transport.dispose()` is synchronous (`transport.ts:427`); the file backend's drain-then-close sequence is inherently async (awaits the stream `"close"` event). The refactor makes `Transport.dispose()` `async` to await the backend, and `init.ts:180` is updated to `await transport.dispose()`. Existing sync callers (no production code reads the return value) are unaffected — the cloud and WS backend disposes resolve effectively immediately.

The selector picks one backend at construction:

```ts
mode === "cloud"            → CloudBackend
mode === "local" && ws      → WsBackend
mode === "local" && file    → FileBackend
```

Each backend owns and emits `FlushStatus` independently; `Transport.lastFlushStatus` returns whichever backend is selected.

## File backend behavior

### Path resolution

Resolved once at construction:

1. `config.localDir` if set, else
2. `process.env.RECOST_LOCAL_DIR` if set, else
3. `path.join(os.homedir(), ".recost", "local-telemetry")`.

Directory is created with `fs.mkdirSync(dir, { recursive: true, mode: 0o700 })`.

Filename: `${sanitize(config.projectId ?? "default")}.jsonl` where `sanitize` strips anything outside `[A-Za-z0-9_-]`. A user who omits `projectId` in local mode writes to `default.jsonl`; documented in CLAUDE.md.

### Stream lifecycle

`fs.createWriteStream(path, { flags: "a", mode: 0o600 })` opened lazily on first `send()`. The `0o600` mode is honored on POSIX and ignored on Windows; the Windows ACL limitation is documented.

`bytesWritten` is tracked locally: seeded from `fs.statSync(path).size` if the file pre-exists, incremented on every `stream.write()` by the byte length of the line.

### Wire format

```ts
const line = JSON.stringify({ ...summary, protocolVersion: "1.0" }) + "\n";
```

`protocolVersion` is injected at serialization time — it does NOT join the `WindowSummary` type. The existing contract test (`tests/contract.test.ts`) covers the WS/cloud wire shape and stays unchanged. A new contract assertion covers the file shape (see test plan).

### Failure handling and queue

In-memory FIFO queue, cap = `maxLocalFileQueueSize`.

- Normal write succeeds → `lastFlushStatus = "ok"`, no queue activity.
- Stream `"error"` event → enter degraded mode, fire `onError(new RecostLocalDiskError(...))` once (latch), buffer subsequent frames in the queue.
- Queue full → `shift()` oldest, fire `onError` once per overflow episode (separate latch from the disk-error latch).
- Next successful write → drain queue (in order), reset both latches.

This mirrors the WS path's queue/drain semantics in shape, so users observing both transports see consistent error patterns.

### Rotation (single-rollover at size)

Before each write, if `bytesWritten + line.length > maxFileBytes`:

1. Close current stream (await flush).
2. `fs.renameSync(path, path + ".1")` — overwrites any prior `.1`.
3. Open a fresh stream, reset `bytesWritten = 0`.

Result: disk usage bounded at ~`2 × maxFileBytes`. No time-based pruning, no multi-backup retention, no compression. Out of scope for this wave.

### Multi-process atomicity

No file locking. Contract documented in CLAUDE.md:

- **POSIX:** `O_APPEND` (the `"a"` flag) guarantees the kernel bumps the file offset atomically. Lines up to `PIPE_BUF` (4096 bytes on Linux) are byte-atomic. Typical `WindowSummary` lines are <2KB. Degenerate large summaries — close to `maxBuckets` (2000) metric entries — may interleave under concurrent writers; extremely rare in practice.
- **Windows:** no append atomicity. Recommend per-process `projectId` disambiguation (e.g. `${app}-${pid}`) if multi-process telemetry on Windows is needed.

Cost of `proper-lockfile` or equivalent: extra dependency, fsync per write, real perf hit. Not justified for a path with no consumer yet.

### Dispose

1. Best-effort synchronous drain of in-memory queue via `fs.appendFileSync(path, line)` per frame, bounded by current queue size. Throws from `appendFileSync` (disk still broken at dispose time) are swallowed — `dispose()` never rejects.
2. `stream.end()` and await `"close"` event.
3. Whole sequence capped by `shutdownFlushTimeoutMs` (default 3000ms, already plumbed in `init.ts`).

## `init.ts` wiring

- Resolved config picks up `localTransport` (default `"file"`).
- Exclusion list (`init.ts:75-81`):
  - Cloud: push `https://api.recost.dev` (or `baseUrl`) as a URL prefix.
  - Local + `"ws"`: push `ws://127.0.0.1:${localPort}` and `ws://localhost:${localPort}` as URL prefixes.
  - Local + `"file"`: push nothing — file writes aren't HTTP, no self-instrumentation risk.
- Second `init()` call: existing handle's `dispose()` runs first, which closes the file stream before the new one opens.

## `excludePatterns` matching contract (#14)

The current match at `init.ts:90` is `event.url.includes(p) || event.host.includes(p)`. Short user patterns (e.g. `"api"`) over-match silently — any URL containing `"api"` is dropped. The contract is undocumented and untested.

### New contract

```ts
excludePatterns.some((p) => event.url.startsWith(p) || event.host === p)
```

- URL match: `startsWith` — a pattern is a URL prefix (e.g. `https://api.example.com/v1/private`).
- Host match: exact equality — a pattern is a complete hostname (e.g. `api.example.com`).
- No wildcards. No substring matching.

### Migration impact

- Internal SDK exclusions are rewritten to satisfy the new contract:
  - Cloud: `https://api.recost.dev` (or `baseUrl`) — already a URL prefix.
  - WS: `ws://127.0.0.1:${localPort}` and `ws://localhost:${localPort}` — URL prefixes (previously `127.0.0.1:${port}` substring; the WS URL still starts with `ws://`).
- External users on `0.1.0` who passed substrings like `"recost"` to drop any URL containing it: must switch to full URL prefixes or exact hostnames. Documented in CLAUDE.md and README. Breaking change at 0.x is acceptable.

### `RecostConfig.excludePatterns` jsdoc

Updated to:

> URL prefixes or exact hostnames that cause a matching request to be silently dropped. A pattern matches when `event.url.startsWith(pattern)` OR `event.host === pattern`. No substring or wildcard semantics.

## Validation (`src/core/validate-config.ts`)

| Field | Rule |
|---|---|
| `localTransport` | If present, must be `"ws"` or `"file"`. |
| `maxFileBytes` | If present, positive integer ≥ 1024. |
| `maxLocalFileQueueSize` | If present, positive integer. |
| `localDir` | If present, non-empty string. No filesystem check at validate time. |

## Test plan

Target: **~197 tests** (current 174 + ~23 net new: ~19 for #37 across `file-transport`, `init`, `validate-config`; ~4 for #14 in `init`). Exact count locked in the plan.

### New `tests/file-transport.test.ts` (~14 tests, #37)

1. Three `send()` calls produce three NDJSON lines; each parses; each carries `protocolVersion: "1.0"`.
2. File created with mode `0o600` on POSIX (skip via `process.platform === "win32"`).
3. `RECOST_LOCAL_DIR` env honored.
4. `config.localDir` overrides `RECOST_LOCAL_DIR` when both set.
5. Falls back to `os.homedir()/.recost/local-telemetry` when neither set.
6. `projectId` sanitization: `proj/x` → `projx`.
7. `projectId` defaults to `"default"` when omitted.
8. Rotation triggers when `maxFileBytes` exceeded; `.jsonl.1` overwritten on second rotation.
9. Stream `"error"` event fires `onError(RecostLocalDiskError)` once per episode; subsequent errors in the same episode are silent.
10. Recovery: a successful write after the error episode re-arms the latch.
11. Queue overflow drops oldest frame; fires `onError` once per overflow episode.
12. `dispose()` flushes the in-memory queue and closes the stream within `shutdownFlushTimeoutMs`.
13. Writes survive `init()` → `dispose()` → `init()` again on the same `projectId` (append, not overwrite).
14. Empty `WindowSummary.metrics` still writes a valid NDJSON line.

### Updated tests

- `tests/init.test.ts` (#37 +2, #14 +4):
  - Default `localTransport === "file"`.
  - Explicit `"ws"` routes through the WS backend.
  - `excludePatterns` URL prefix match: `"https://api.example.com/v1"` excludes `https://api.example.com/v1/foo` but not `https://api.example.com/v2/foo`.
  - `excludePatterns` exact-host match: `"api.example.com"` excludes any URL whose host is `api.example.com`.
  - `excludePatterns` no-substring regression: `"api"` does NOT exclude `https://example.com/api/foo`.
  - Internal exclusions cover the SDK's own endpoints: WS connection URLs are dropped from telemetry under `localTransport: "ws"`; cloud telemetry POSTs are dropped under cloud mode.
- `tests/validate-config.test.ts` (+~3): new field validation cases for `localTransport`, `maxFileBytes`, `maxLocalFileQueueSize`, `localDir`.
- `tests/transport.test.ts`: existing local-WS tests pass `localTransport: "ws"` explicitly (or move into a new `tests/transport-ws.test.ts` if the refactor warrants its own file).
- `tests/dist.test.ts`: stays at 7 — `FileTransport` is not re-exported from `src/index.ts`.

## Documentation

- **CLAUDE.md → "Transport Modes":** describe both file (default) and ws (opt-in). Document the multi-process atomicity contract and the Windows ACL limitation.
- **CLAUDE.md → "Architecture Notes" (or new "Config Contract" section):** document the new `excludePatterns` contract (URL prefix OR exact host).
- **README.md:** brief mention of the new default + `RECOST_LOCAL_DIR` + how to opt back into WS. Update any `excludePatterns` example to reflect the new contract.

## Implementation task preview

Detailed tasks land in the plan doc (`docs/superpowers/plans/2026-05-19-json-file-local-transport.md`):

1. Types + validation (`types.ts`, `validate-config.ts`, tests).
2. Backend refactor: split `transport.ts` into selector + `transport-cloud.ts` + `transport-ws.ts`. No behavior change; existing tests stay green.
3. `transport-file.ts` + `tests/file-transport.test.ts` (TDD).
4. Wire `Transport` selector to route by `localTransport`.
5. `init.ts` exclusion logic + default routing.
6. `excludePatterns` contract tightening (#14): change match to `startsWith` || exact host, update internal exclusions, jsdoc, tests.
7. CLAUDE.md + README updates.

## Out of scope

- Reading the files / consumer tooling (no consumer exists; extension explicitly opted out).
- Removing the WS transport (separate issue).
- Encryption / signing on-disk frames.
- Time-based rotation, multi-backup retention, compression.
- File locking for multi-process atomicity.
- Per-PID filename suffixing (recommended in docs, not enforced).
