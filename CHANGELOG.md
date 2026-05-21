# Changelog

All notable changes to `@recost-dev/node` are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html), with the caveat that pre-1.0 releases may include breaking changes in minor or patch bumps when the public API is still settling.

## [0.1.4] — 2026-05-21

Large feature release on the 0.1.x line. Adds a file-based local transport (now the default), a typed `RecostError` class hierarchy, async `dispose()` + `flush()` lifecycle parity with the Python SDK, multi-realm interceptor safety, specificity-based provider matching, and synchronous config validation. Node 20+ is now required.

### Breaking

- **`engines.node` raised to `>=20`** (was `>=18`). Vitest 4 depends on `node:util.styleText`, which was added in Node 20. Node 18 will continue to install but the test suite no longer covers it.
- **`init().dispose()` is now async** — returns `Promise<void>` instead of `void`. The previous synchronous behavior dropped the final in-flight window; the new behavior performs one bounded shutdown flush (default 3s, configurable via `shutdownFlushTimeoutMs`) so the most recent telemetry isn't lost on graceful shutdown. Adopters should `await handle.dispose()` in test teardown / process shutdown handlers.
- **Local-mode default switched from WebSocket to file** — `init()` with no `apiKey` now writes NDJSON `WindowSummary` lines to `~/.recost/local-telemetry/${projectId}.jsonl` (mode `0o600` on POSIX) instead of opening a WebSocket. Set `localTransport: "ws"` to opt back into the WebSocket transport.
- **`excludePatterns` matching tightened** from substring-contains to `event.url.startsWith(pattern) || event.host === pattern`. URL prefixes and exact hostnames are now the only supported pattern shapes — substring patterns silently stop matching. Common cases like `"https://api.example.com/v1/internal"` (prefix) and `"api.metrics.local"` (exact host) continue to work.

### Added

- **File transport backend** (`localTransport: "file"`, default). NDJSON appends to `${localDir}/${projectId}.jsonl`, rolls to `.jsonl.1` once `maxFileBytes` (default 10MB) is exceeded — disk usage bounded at ~2×. Disk-write failures buffer in memory up to `maxLocalFileQueueSize` and fire `onError(RecostLocalDiskError)` once per failure episode.
- **`RecostHandle.flush()`** — flush the current aggregator window without disposing. Direct parallel to the Python SDK's `flush_blocking()`. Useful before a non-graceful exit boundary or for manual checkpoints in long-running services.
- **`RecostError` class hierarchy**, exported from the package root for `instanceof` narrowing in `onError`:
  - `RecostAuthError` — fires on each 401 from the cloud API.
  - `RecostFatalAuthError` — fires once after `maxConsecutiveAuthFailures` 401s, suspends the cloud transport for the lifetime of the process.
  - `RecostLocalUnreachableError` — fires once after `maxConsecutiveReconnectFailures` failed WS reconnects, pauses the local transport.
  - `RecostLocalDiskError` — file backend disk-write failure (once per episode).
  - `RecostInterceptorAlreadyInstalledError` — advisory; thrown when a duplicate package copy tries to install. First install stays active.
  - `RecostInterceptorPatchOverwrittenError` — advisory; uninstall detected a third-party wrapper on `fetch` / `http` / `https` and detached the SDK callback rather than restoring an alien handler.
- **Multi-realm interceptor safety**. Singleton install state lives on a `globalThis`-keyed object so duplicate package copies (e.g. from monorepo deduplication misses) detect each other. Uninstall does an identity check before restoring the original handlers — if a third party wrapped `fetch` after us, we detach our callback instead of clobbering them.
- **Config validation** — `init()` now synchronously throws on known-broken config before installing the interceptor or opening a transport. Rules: `apiKey` shape (`rc-…`, rejects the literal string `"undefined"`), `projectId` required in cloud mode, `localTransport` ∈ `{"file", "ws"}`, `localDir` non-empty, `maxFileBytes` ≥ 1024, `maxLocalFileQueueSize` positive, `excludePatterns` entries non-empty.
- **Specificity-based provider matching**. Custom and built-in rules are merged and sorted at `ProviderRegistry` construction: rules with a `pathPrefix` come before those without, longer `pathPrefix` wins, exact host beats `*.` wildcard. On equal specificity, custom rules win. A custom catch-all no longer shadows built-in path-specific rules.
- **`"other"` endpoint category** for host-only catch-all matches (previously these returned the raw request path).
- **Worker threads guidance** in the README — each worker needs its own `init()` call; the main-thread call does not propagate.
- New config options: `localTransport`, `localDir`, `maxFileBytes`, `maxLocalFileQueueSize`, `maxConsecutiveAuthFailures`, `maxConsecutiveReconnectFailures`, `shutdownFlushTimeoutMs`.
- New public exports: `setOnError` (interceptor), `InterceptorBinding` (type), `BUILTIN_PROVIDERS`.
- `tests/dist.test.ts` — post-build smoke test asserting `dist/cjs/index.cjs`, `dist/esm/index.js`, and `dist/types/index.d.ts` all emit and the bundles load.
- `tests/validate-config.test.ts`, `tests/file-transport.test.ts` — new test files. Total suite is now 305 tests across 12 files.
- PR-validation CI workflow on Node 18 / 20 / 22 (Node 18 was later dropped; matrix retained at 20 / 22).

### Changed

- **Aggregator soft bucket cap** — instead of dropping events at `maxBuckets`, overflow now coalesces into an `_overflow` bucket so the count is preserved.
- **Interceptor body measurement** for `fetch` uses `Request.clone().arrayBuffer()` instead of inspecting the original body stream, so the host application's body isn't consumed.
- **Latency emission** is deferred until after response-body measurement so a slow body doesn't block the fetch caller.
- **IPv6 hosts** are preserved correctly when stripping embedded ports.
- **`WindowSummary` wire format** — dropped the redundant `projectId` field from the body (it's already on the URL). `windowStart` and `windowEnd` are now routed through a shared `isoNow()` helper that locks the cross-SDK millisecond-precision-with-`Z` format.
- **`tsup` clean step** moved to a `prebuild` script to avoid a concurrent-writer race during dual ESM/CJS builds.
- Local WebSocket reconnect now uses ±25% jitter (500ms → 30s) aligned with the Python SDK's `_LocalTransport`.

### Fixed

- `excludePatterns` entries that are empty or whitespace-only are now rejected by `validateConfig` (an empty entry previously matched every URL and silently dropped all telemetry).
- File transport recovers from queue mode on the next successful write (previously stayed in queue mode after disk recovered).
- WebSocket backend tracks the socket from creation, not from `open`, so dispose during connect is handled cleanly.
- Cloud auth-failure counter resets on any non-401 outcome (success, 403, 404, 422, 5xx after retries, network error) — transient outages don't accumulate toward the suspend threshold.
- `setInterval` callback in `init()` no longer dies silently if a synchronous throw escapes from `flushAndSend()`.

## [0.1.3] — 2026-05-13

Last patch release before 0.1.4. Bundled fixes for the interceptor and registry surface area landed in prior PRs (#10, #12, #13, #21, #34). See the git log between `v0.1.2` and `v0.1.3` for the full list.

## [0.1.2] — 2026-04-22

## [0.1.1] — 2026-04-05

## [0.1.0] — 2026-04-05

Initial 0.1.x line.

[0.1.4]: https://github.com/recost-dev/node-sdk/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/recost-dev/node-sdk/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/recost-dev/node-sdk/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/recost-dev/node-sdk/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/recost-dev/node-sdk/releases/tag/v0.1.0
