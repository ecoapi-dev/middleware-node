# Multi-realm Patch Safety & Dispose Parity — Design

**Wave:** 5
**Issues:** [#11](https://github.com/recost-dev/middleware-node/issues/11) (multi-realm patch model), [#19](https://github.com/recost-dev/middleware-node/issues/19) (Python sync vs Node async dispose parity)
**Status:** draft (awaiting user review)

---

## Goal

Tighten three failure modes of the SDK's single-realm, module-level patch model (issue #11), and surface a manual-flush API on `RecostHandle` that gives Node a Python-symmetric story for graceful shutdown (issue #19). One bundled PR.

The three #11 sub-problems:

1. **Dual-package hazard.** When the same monorepo loads `@recost-dev/node` via both `import` and `require`, the two module copies each run their own `install()`, double-wrapping `globalThis.fetch`. Each copy's `_originalFetch` is the *other* copy's wrapped fetch, so neither uninstall fully restores the global.
2. **`uninstall()` clobbers third-party patches.** If another library wraps `globalThis.fetch` *after* recost installs, `uninstall()` blindly restores `_originalFetch` and silently breaks the third-party wrapper.
3. **`worker_threads` are not instrumented.** `http`, `https`, and `fetch` are per-worker module instances. `install()` patches only the calling worker; workers spawned afterwards miss telemetry with no detection or warning.

The #19 sub-problem:

- Node's `await handle.dispose()` already awaits the final flush; Python's `dispose()` returns synchronously after spawning a thread. A cross-SDK user porting shutdown paths gets inconsistent behavior. Node-side fix: expose a `flush()` method on the handle so the Python `flush_blocking()` parallel is `await handle.flush()`. Python is the bigger lift and lives in its own repo.

---

## Approach (recommended)

### Sub-problem 1: dual-package hazard — globalThis-keyed shared state

Move interceptor singleton state off the module scope and onto `globalThis`, keyed by a registry symbol:

```ts
const STATE_KEY = Symbol.for("@recost-dev/node:interceptor-state");

interface InterceptorState {
  installed: boolean;
  callback: EventCallback | null;
  inFetchWrapper: boolean;
  originalFetch: typeof globalThis.fetch | null;
  originalHttpRequest: typeof http.request | null;
  originalHttpGet:     typeof http.get     | null;
  originalHttpsRequest: typeof https.request | null;
  originalHttpsGet:     typeof https.get     | null;
  patchedFetch: typeof globalThis.fetch | null;
  patchedHttpRequest:  typeof http.request | null;
  patchedHttpGet:      typeof http.get     | null;
  patchedHttpsRequest: typeof https.request | null;
  patchedHttpsGet:     typeof https.get     | null;
}

function getState(): InterceptorState {
  const g = globalThis as { [STATE_KEY]?: InterceptorState };
  if (g[STATE_KEY] === undefined) {
    g[STATE_KEY] = { installed: false, callback: null, /* …all null… */ };
  }
  return g[STATE_KEY]!;
}
```

**Why `Symbol.for(...)`:** registry symbols are de-duplicated by string key across module instances within the same realm (one Node `globalThis`), so two copies of `@recost-dev/node` see the same state object.

**Why no version suffix in the key:** every copy of the SDK, present or future, must coordinate through the same key. A version suffix would re-introduce the hazard the moment two versions co-exist. We accept that the `InterceptorState` shape is a permanent contract — additions must be backwards-compatible (new fields default to null).

**Install semantics under the new state model:**
- `install(callback)` reads state. If `state.installed === true`, fire `RecostInterceptorAlreadyInstalledError` via the new caller-provided `onError` shim (passed through from `init.ts`) and return without re-patching. The first installer keeps working.
- Otherwise: snapshot originals into `state`, build patched functions, write them to `state.patchedFetch` / `state.patchedHttpRequest` / … and to the globals. Set `state.installed = true`. The patched functions close over `state` (not over module-scope variables) so the second module copy's wrappers — if they ever ran — would read the same state.

**Worker-thread visibility:** registry symbols are per-realm. Each worker has its own `globalThis` and therefore its own `InterceptorState`. This is correct behavior, not a bug — workers must call `init()` themselves. Sub-problem 3 (below) documents this.

### Sub-problem 2: uninstall identity check

`uninstall()` only restores a global if it still points at our patched function:

```ts
export function uninstall(): void {
  const state = getState();
  if (!state.installed) return;

  let conflictsDetected = false;
  const checkAndRestore = <T>(holder: { value: T }, ours: T, original: T): void => {
    if (holder.value === ours) holder.value = original;
    else conflictsDetected = true;
  };
  // …apply to globalThis.fetch, http.request, http.get, https.request, https.get…

  if (conflictsDetected) {
    // route through callback-installed onError; the wrapper still in place
    // (whoever wrapped us) continues to delegate to our patched fn, but we
    // null the callback so we stop recording.
    state.onError?.(new RecostInterceptorPatchOverwrittenError());
  }

  state.callback = null;
  state.installed = false;
  // Originals stay in state in case a future install() re-uses them, but the
  // installed flag is what gates re-entry.
}
```

Per-binding behavior: if `globalThis.fetch` was wrapped by a third party but `http.request` is still our patched fn, we restore `http.request` and leave `globalThis.fetch` alone. The error fires once per uninstall, summarizing which bindings were skipped.

The patched-fetch logic itself guards on `state.callback`: when `callback === null`, the wrapper is a thin passthrough to `state.originalFetch`. So even when a third-party wrapper keeps our function alive after `uninstall()`, no events are recorded.

**Post-conflict re-install:** if any binding was skipped during `uninstall()`, the state stays in a "skipped" mode — `state.installed` remains `true` and `state.callback` is nulled. A subsequent `init()` therefore sees `installed === true` and fires `RecostInterceptorAlreadyInstalledError` the same way the dual-package case does. Process restart is the recovery path. This avoids stacking a fresh wrapper on top of the third-party wrapper on top of our orphaned wrapper, which would silently double-count and confuse the wrapper chain. (Note: this contract assumes third-party wrappers delegate to the function they wrapped. Wrappers that swallow calls entirely are outside our control either way.)

### Sub-problem 3: worker_threads — documentation only

No new API. Add a README subsection under "Initialization" that says:

> **Worker threads.** `init()` patches only the worker that calls it. Workers spawned via `node:worker_threads` get their own `http`, `https`, `fetch`, and `globalThis`. Call `init()` inside each worker entry point to capture its outbound HTTP. SDK errors thrown inside a worker route through that worker's own `onError`.

Rationale for skipping `installInWorker()`: a helper would be an alias for `init()` — no per-worker logic to deduplicate, no signal it could detect at worker spawn time, and it would invite the false expectation that the main thread can patch its workers. Doc-only avoids the misleading API surface.

### Issue #19: `RecostHandle.flush(): Promise<void>`

Add a `flush()` method to the handle:

```ts
export interface RecostHandle {
  dispose(): Promise<void>;
  /**
   * Flush the current aggregator window without disposing. Resolves when the
   * flush completes; rejects only if you await it (errors also route through
   * onError). Useful before a known process-exit boundary on platforms where
   * `dispose()` doesn't fit your shutdown ordering.
   *
   * Parity note: equivalent to the Python SDK's `flush_blocking()`.
   */
  flush(): Promise<void>;
  readonly lastFlushStatus: FlushStatus | null;
}
```

Implementation: wraps the existing `flushAndSend()` closure that `dispose()` already calls. No new state, no new timer logic. After `dispose()` has run, `flush()` resolves immediately as a no-op (matches `dispose()` idempotency).

---

## Alternatives considered

**Refcounted install across dual packages.** Each copy's `install()` increments a counter; the last `uninstall()` actually restores. Rejected because it forces multi-callback fan-out — both copies want to record events — and the cross-copy callback contract is ill-defined (which `onError` fires? which provider registry wins?). First-install-wins matches the issue's "dedup" recommendation and keeps the state shape simple.

**`installInWorker()` helper for #11 sub-3.** Rejected — there's no per-worker logic to encapsulate. A helper would just call `init()`, which the worker can already do. The doc note carries the load.

**Restoring `globalThis.fetch` even when a third party wrapped us (current behavior).** Rejected — that's exactly the bug. Identity-check + skip + advisory error is the only correct option.

**Make `flush()` sync.** JS has no thread-blocking primitive; "sync" would have to mean fire-and-forget, which silently drops the very data users call `flush()` to preserve. Async + `await` is the only honest contract.

---

## API additions (public surface)

Both exported from `src/index.ts`:

```ts
export class RecostInterceptorAlreadyInstalledError extends RecostError {
  constructor() {
    super(
      "@recost-dev/node interceptor was installed twice in the same realm. " +
      "This usually means two copies of the package were loaded (e.g. via " +
      "both `import` and `require`). The first install remains active; this " +
      "second install is a no-op."
    );
    this.name = "RecostInterceptorAlreadyInstalledError";
  }
}

export class RecostInterceptorPatchOverwrittenError extends RecostError {
  readonly skippedBindings: ReadonlyArray<"fetch" | "http.request" | "http.get" | "https.request" | "https.get">;
  constructor(skipped: ReadonlyArray<"fetch" | "http.request" | "http.get" | "https.request" | "https.get">) {
    super(
      `uninstall() found ${skipped.length} binding(s) wrapped by another ` +
      `library after install(); leaving those wrappers in place: ${skipped.join(", ")}. ` +
      `The recost callback has been detached so no events are recorded.`
    );
    this.name = "RecostInterceptorPatchOverwrittenError";
    this.skippedBindings = skipped;
  }
}
```

New `RecostHandle.flush(): Promise<void>` method (see Issue #19 section).

No new `RecostConfig` fields. Both errors fire through the existing `onError` callback. The interceptor module gains an internal `setOnError(cb)` setter that `init.ts` wires up so the errors can reach the user's callback without coupling `interceptor.ts` to `RecostConfig`.

---

## Test strategy

| Sub-problem | Tests added | Coverage |
|---|---|---|
| Typed errors | 2 | `RecostInterceptorAlreadyInstalledError` and `RecostInterceptorPatchOverwrittenError` — instanceof checks, name, `skippedBindings`. Implementation-detail safety net. |
| State on `globalThis` | 1 | After `install()`, `globalThis[STATE_KEY]` exists and holds the patched/original references. Refactor regression guard. |
| #11.1 dual-package | 4 | (a) second install fires `RecostInterceptorAlreadyInstalledError` and is a no-op; (b) first install's callback keeps firing — second callback never fires; (c) `setOnError(null)` clears the registration; (d) clean uninstall lets re-install succeed without error. |
| #11.2 identity check | 5 | (a) third-party wraps `globalThis.fetch` post-install; uninstall fires `RecostInterceptorPatchOverwrittenError` listing `["fetch"]` and does not restore globalThis.fetch; (b) third-party leaves http.request alone; uninstall restores http.request normally; (c) post-uninstall patched fetch (still in chain) is a passthrough — no callback fires; (d) no third-party wrap = clean uninstall, no error fired; (e) re-init after a conflict-uninstall fires `RecostInterceptorAlreadyInstalledError` and is a no-op. |
| #11.3 worker_threads | 0 in vitest | Doc-only. README change is verified by visual review during the PR. |
| #19 flush() | 2 | (a) `handle.flush()` flushes current window without disposing — subsequent `handle.dispose()` still runs; (b) post-dispose `flush()` resolves immediately as a no-op. |

**Baseline:** 253 vitest tests (verified locally 2026-05-18 on origin/main `c6c2a64` after Wave 4 merged).
**Delta:** +14 tests.
**Projected:** 267 vitest tests.

All existing tests must still pass without modification — the public install/uninstall API is unchanged for single-copy callers.

---

## Files touched

- `src/core/interceptor.ts` — state on globalThis, identity-check uninstall, `setOnError()` setter. Largest diff in this PR.
- `src/core/types.ts` — two new error classes.
- `src/init.ts` — wire `setOnError(config.onError)` into the interceptor before `install()`; add `flush()` to the returned handle.
- `src/index.ts` — re-export the two new error classes.
- `tests/interceptor.test.ts` — 4 + 4 new tests.
- `tests/init.test.ts` — 2 new tests for `handle.flush()`.
- `README.md` — Worker threads subsection (#11.3); Cross-SDK section update describing `handle.flush()` (#19); error-handling section gains a paragraph on the two new error classes.
- `docs/superpowers/roadmap-2026-05-13-issue-waves.md` — flip Wave 4 → done with PR #38 link; flip Wave 5 → in-progress with this spec/plan linked.
- `docs/superpowers/plans/2026-05-18-multi-realm-and-dispose-parity.md` — implementation plan (next step after spec approval).

No changes to: `src/core/aggregator.ts`, `src/core/transport.ts`, `src/core/provider-registry.ts`, `src/core/validate-config.ts`, framework adapters, `package.json`, `tsup.config.ts`.

---

## PR shape

One bundled PR per wave-execution-pattern memory: #11 is the substantial work, #19 is small, both touch `init.ts` + README, same review context. Branch `feat/11-19-multi-realm-dispose-parity` off `origin/main`.

---

## Out of scope

- Python-side `flush_blocking()` — lives in `middleware-python`. This wave's PR description will reference the Python tracking issue but does not block on it.
- `handle.reconnect()` / `handle.reconfigure()` — deferred (same reasoning as #16 / #22 deferred theirs).
- Cross-realm telemetry aggregation (single dashboard view of worker + main thread telemetry) — out of scope; not requested in #11.
