# Multi-realm Patch Safety & Dispose Parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move interceptor singleton state onto a `globalThis`-keyed shared object so dual-package loads coordinate ([#11.1](https://github.com/recost-dev/middleware-node/issues/11)); make `uninstall()` identity-check before restoring each binding so third-party wrappers aren't clobbered ([#11.2](https://github.com/recost-dev/middleware-node/issues/11)); document the `worker_threads` per-realm limitation ([#11.3](https://github.com/recost-dev/middleware-node/issues/11)); add a `RecostHandle.flush(): Promise<void>` method for Python `flush_blocking()` parity ([#19](https://github.com/recost-dev/middleware-node/issues/19)). One bundled PR.

**Architecture:**

- **#11.1 + #11.2 (interceptor):** Replace the five module-level `let` slots in `src/core/interceptor.ts` with an `InterceptorState` object stored on `globalThis[Symbol.for("@recost-dev/node:interceptor-state")]`. Patched function closures read from this state object (not module-scope vars), so a second copy of the package loaded in the same realm sees the same state and `install()` becomes a no-op that fires `RecostInterceptorAlreadyInstalledError`. `uninstall()` checks each global against the saved `state.patched*` reference — only restores when they match; mismatches fire `RecostInterceptorPatchOverwrittenError` with a list of skipped bindings and leave the state in a "skipped" mode that refuses re-install. Errors route through a new `setOnError(cb)` setter that `init.ts` wires up at install time.
- **#11.3 (docs):** Single README subsection under "Cleanup / teardown" explaining workers must call `init()` themselves. No code change.
- **#19 (handle):** `RecostHandle` grows a `flush(): Promise<void>` method that invokes the existing `flushAndSend()` closure once. Idempotent after `dispose()`. No new config field.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), vitest, tsup dual ESM + CJS build, Node.js ≥ 18.

---

## File Structure

- **Modify** `src/core/types.ts`:
  - Add two new error class declarations after `RecostLocalUnreachableError` (~line 273): `RecostInterceptorAlreadyInstalledError` and `RecostInterceptorPatchOverwrittenError extends RecostError`.

- **Modify** `src/core/interceptor.ts` — substantial refactor:
  - Define `STATE_KEY = Symbol.for("@recost-dev/node:interceptor-state")` and `interface InterceptorState`.
  - Replace lines 27–38 (`_installed`, `_callback`, `_inFetchWrapper`, `_originalFetch`, `_originalHttp*`, `_originalHttps*`) with `getState()` helper that lazily creates the state object on `globalThis`.
  - Update `patchedFetch` (lines 204–335) to read `state.originalFetch`, `state.callback`, `state.inFetchWrapper` from `getState()`. Add an early-return passthrough `if (state.callback == null) return state.originalFetch!(input, init);` at the top of the wrapper.
  - Update `makeRequestWrapper` (lines 344–468) and `makeGetWrapper` (lines 470–483) similarly — closures over `state`, not module-scope vars.
  - Rewrite `install()` (lines 493–515): if `state.installed`, fire `RecostInterceptorAlreadyInstalledError` via `state.onError` and return. Otherwise snapshot originals + build patches + store patched refs in `state.patched*`.
  - Rewrite `uninstall()` (lines 520–537): identity-check each binding, restore only matching ones, fire `RecostInterceptorPatchOverwrittenError` listing skipped bindings, set `state.callback = null` but leave `state.installed = true` if any binding was skipped (refuses re-install).
  - Add `export function setOnError(cb: ((err: Error) => void) | null): void` that writes `state.onError = cb`.
  - `isInstalled()` reads `state.installed`. `getRawFetch()` reads `state.originalFetch ?? globalThis.fetch`.

- **Modify** `src/init.ts`:
  - Import `setOnError` from interceptor. Call `setOnError(config.onError ?? null)` before `install(...)` (around line 94).
  - Add `flush(): Promise<void>` to `RecostHandle` interface (line 14–29). Implement on the handle object (line 156): captures the same `disposed` flag; resolves immediately if disposed; otherwise `await flushAndSend()` and swallows errors the same way the existing flushes do.

- **Modify** `src/index.ts`:
  - Re-export `RecostInterceptorAlreadyInstalledError` and `RecostInterceptorPatchOverwrittenError` from the typed-errors block (around lines 18–23).
  - Re-export `setOnError` from interceptor.

- **Modify** `tests/interceptor.test.ts`:
  - Add 4 tests under a new `describe("interceptor — dual-package state (#11.1)")` block: state lives on globalThis under expected symbol; second install fires `RecostInterceptorAlreadyInstalledError`; first install's wrapper remains the active globalThis.fetch; clean uninstall clears state so re-install succeeds.
  - Add 5 tests under a new `describe("interceptor — uninstall identity check (#11.2)")` block: third-party wraps fetch post-install → uninstall fires `RecostInterceptorPatchOverwrittenError(["fetch"])` and leaves globalThis.fetch alone; third-party wraps only fetch → uninstall restores http.request normally; post-uninstall patched fetch behaves as passthrough (no callback fires); no third-party wrap → no error fires; re-init after conflict-uninstall is a no-op + fires AlreadyInstalled.

- **Modify** `tests/init.test.ts`:
  - Add 2 tests under a new `describe("init — flush (#19)")` block: `handle.flush()` flushes current window without disposing (subsequent `dispose()` still runs); post-`dispose()` `flush()` resolves immediately.

- **Modify** `README.md`:
  - Add subsection `### Worker threads` between `### Cleanup / teardown` (line 192) and `### Disabling in tests` (line 203). 4–6 lines explaining per-realm patching.
  - Update `### Cleanup / teardown` (line 192–201) to mention `flush()` as the Python `flush_blocking()` parallel — one paragraph + code snippet.
  - Update the error-handling code samples at lines 152, 156–160 to optionally pattern-match the two new error classes (1 additional `else if` branch each).

- **Modify** `docs/superpowers/roadmap-2026-05-13-issue-waves.md`:
  - Flip Wave 4 status from `pending` to `done`; add `**Merged PR:** https://github.com/recost-dev/middleware-node/pull/38`.
  - Flip Wave 5 status from `pending` to `in-progress`; add `**Spec:** \`specs/2026-05-18-multi-realm-and-dispose-parity-design.md\`` and `**Plan:** \`plans/2026-05-18-multi-realm-and-dispose-parity.md\``.

- **Create** `docs/superpowers/plans/2026-05-18-multi-realm-and-dispose-parity.md` — this file (already exists locally; copied into the worktree by Task 1).

**Test count delta:** baseline **253/253** vitest (246 unit + 7 `tests/dist.test.ts` smoke), verified locally on origin/main `c6c2a64`. Wave 5 adds **14** new tests, modifies zero existing tests:

| Task | New tests | What they cover |
|---|---|---|
| 2 | 2 | `RecostInterceptorAlreadyInstalledError` / `…PatchOverwrittenError` instanceof + name + skippedBindings |
| 3 | 1 | state object lives on `globalThis[STATE_KEY]` after install |
| 4 | 4 | second install is a no-op + fires error, only first callback fires, `setOnError(null)` clears, clean re-install after uninstall |
| 5 | 5 | third-party wrap detected, other bindings still restore, post-conflict patched fn is passthrough, no-wrap = no error, re-init after conflict fires AlreadyInstalled |
| 6 | 2 | `handle.flush()` works without disposing; post-`dispose()` `flush()` is a no-op |

Final: **267/267** vitest.

`src/core/aggregator.ts`, `src/core/transport.ts`, `src/core/provider-registry.ts`, `src/core/validate-config.ts`, `src/core/time.ts`, framework adapters, `package.json`, `tsup.config.ts` are untouched.

---

## Task 1: Set up Wave 5 worktree, commit the roadmap + plan + spec

**Files:**
- Create worktree: `.claude/worktrees/wave-5-multi-realm-dispose/`
- Modify: `docs/superpowers/roadmap-2026-05-13-issue-waves.md`
- Create: `docs/superpowers/plans/2026-05-18-multi-realm-and-dispose-parity.md`
- Create: `docs/superpowers/specs/2026-05-18-multi-realm-and-dispose-parity-design.md`

Mirrors the Wave 4 handoff convention: first commit bundles the prior wave's roadmap-done update + this wave's plan/spec docs.

- [ ] **Step 1: Verify no stale Wave 5 worktree exists**

```bash
git -C /home/andresl/Projects/recost/middleware-node worktree list
```

Expected: the list does NOT contain `.claude/worktrees/wave-5-multi-realm-dispose`. If it does, that worktree was created earlier — skip step 2 and `cd` into it.

- [ ] **Step 2: Create the Wave 5 worktree off the latest `origin/main`**

Run from `/home/andresl/Projects/recost/middleware-node` (the main repo root, NOT a worktree):

```bash
cd /home/andresl/Projects/recost/middleware-node
git fetch origin main
git worktree add -b feat/11-19-multi-realm-dispose-parity .claude/worktrees/wave-5-multi-realm-dispose origin/main
cd .claude/worktrees/wave-5-multi-realm-dispose
```

Expected: `Preparing worktree (new branch 'feat/11-19-multi-realm-dispose-parity')` and `HEAD is now at c6c2a64 Merge pull request #38 ...`.

All subsequent steps in this plan run from `.claude/worktrees/wave-5-multi-realm-dispose/` unless stated otherwise.

- [ ] **Step 3: Copy the plan and spec files into the new worktree**

```bash
cp /home/andresl/Projects/recost/middleware-node/docs/superpowers/plans/2026-05-18-multi-realm-and-dispose-parity.md docs/superpowers/plans/2026-05-18-multi-realm-and-dispose-parity.md
cp /home/andresl/Projects/recost/middleware-node/docs/superpowers/specs/2026-05-18-multi-realm-and-dispose-parity-design.md docs/superpowers/specs/2026-05-18-multi-realm-and-dispose-parity-design.md
```

Expected: both files exist inside the worktree's `docs/superpowers/{plans,specs}/`.

- [ ] **Step 4: Update the roadmap doc — flip Wave 4 to done, Wave 5 to in-progress**

Open `docs/superpowers/roadmap-2026-05-13-issue-waves.md`.

Find the Wave 4 header block (currently around lines 81–83):

```markdown
## Wave 4 — Provider registry overhaul

**Status:** in-progress

**Plan:** `plans/2026-05-15-provider-registry-overhaul.md`
```

Replace with:

```markdown
## Wave 4 — Provider registry overhaul

**Status:** done

**Merged PR:** https://github.com/recost-dev/middleware-node/pull/38

**Plan:** `plans/2026-05-15-provider-registry-overhaul.md`
```

Find the Wave 5 header block (currently around lines 102–104):

```markdown
## Wave 5 — Architectural / lifecycle (riskiest, save for last)

**Status:** pending
```

Replace with:

```markdown
## Wave 5 — Architectural / lifecycle (riskiest, save for last)

**Status:** in-progress

**Spec:** `specs/2026-05-18-multi-realm-and-dispose-parity-design.md`

**Plan:** `plans/2026-05-18-multi-realm-and-dispose-parity.md`
```

- [ ] **Step 5: Verify tests still pass on the fresh branch**

```bash
npm install
npm run lint
npm run build
npm test
```

Expected: lint clean, build succeeds, vitest reports `Tests  253 passed (253)` from `npm run test:unit` (the first phase of `npm test`), and the dist smoke phase reports `7 passed (7)`.

If `npm install` modifies `package-lock.json`, that is an environment artifact — `git checkout -- package-lock.json` before staging.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/roadmap-2026-05-13-issue-waves.md \
        docs/superpowers/plans/2026-05-18-multi-realm-and-dispose-parity.md \
        docs/superpowers/specs/2026-05-18-multi-realm-and-dispose-parity-design.md
git commit -m "docs: mark wave 4 done; add wave 5 multi-realm + dispose-parity plan (#11, #19)"
```

Verify: `git log --oneline -1` shows the new commit on top of `c6c2a64`.

---

## Task 2: Add the two new error classes

**Files:**
- Modify: `src/core/types.ts` (append two classes after `RecostLocalUnreachableError`)
- Modify: `tests/interceptor.test.ts` (add a small `describe` block at the bottom; will be expanded in Tasks 4 & 5)

TDD: write a tiny instanceof + message test for each class first, watch it fail (classes don't exist), then implement.

- [ ] **Step 1: Write the failing tests**

Open `tests/interceptor.test.ts`. Append at the very bottom of the file (after the existing closing brace of the last `describe`):

```typescript
describe("interceptor — typed errors (#11)", () => {
  it("RecostInterceptorAlreadyInstalledError extends RecostError and is named correctly", async () => {
    const { RecostError, RecostInterceptorAlreadyInstalledError } = await import(
      "../src/core/types.js"
    );
    const err = new RecostInterceptorAlreadyInstalledError();
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(RecostError);
    expect(err.name).toBe("RecostInterceptorAlreadyInstalledError");
    expect(err.message).toMatch(/installed twice/i);
  });

  it("RecostInterceptorPatchOverwrittenError exposes skippedBindings and an informative message", async () => {
    const { RecostError, RecostInterceptorPatchOverwrittenError } = await import(
      "../src/core/types.js"
    );
    const err = new RecostInterceptorPatchOverwrittenError(["fetch", "http.request"]);
    expect(err).toBeInstanceOf(RecostError);
    expect(err.name).toBe("RecostInterceptorPatchOverwrittenError");
    expect(err.skippedBindings).toEqual(["fetch", "http.request"]);
    expect(err.message).toContain("fetch");
    expect(err.message).toContain("http.request");
  });
});
```

- [ ] **Step 2: Run the new tests to confirm they fail**

```bash
npx vitest run tests/interceptor.test.ts -t "typed errors"
```

Expected: 2 tests, both failing with module-resolution errors complaining that `RecostInterceptorAlreadyInstalledError` / `RecostInterceptorPatchOverwrittenError` are not exported from `../src/core/types.js`.

- [ ] **Step 3: Implement the two error classes**

Open `src/core/types.ts`. Find the bottom of the file (after the closing brace of `RecostLocalUnreachableError`, currently around line 272). Append:

```typescript

/**
 * A second `install()` was attempted in the same realm while interceptor state
 * was already populated. This usually means two copies of `@recost-dev/node`
 * were loaded into the same process (e.g. one via `import`, one via `require`
 * in a monorepo with dual-package layout). The first install remains active;
 * this second install is a no-op. Fired through the first installer's
 * `onError` callback.
 *
 * Recovery: deduplicate the package in the host's dependency tree.
 */
export class RecostInterceptorAlreadyInstalledError extends RecostError {
  constructor() {
    super(
      "@recost-dev/node interceptor was installed twice in the same realm. " +
        "This usually means two copies of the package were loaded (e.g. via " +
        "both `import` and `require`). The first install remains active; this " +
        "second install is a no-op.",
    );
    this.name = "RecostInterceptorAlreadyInstalledError";
  }
}

/** One of the five HTTP bindings the interceptor patches. */
export type InterceptorBinding =
  | "fetch"
  | "http.request"
  | "http.get"
  | "https.request"
  | "https.get";

/**
 * `uninstall()` found that one or more of the bindings the interceptor patched
 * had been wrapped by another library after `install()` ran. Restoring the
 * original under those bindings would silently overwrite the third-party
 * wrapper, so the interceptor leaves them alone. The interceptor callback is
 * detached (no further events recorded) and the singleton state stays in a
 * "skipped" mode — a subsequent `init()` becomes a no-op that fires
 * `RecostInterceptorAlreadyInstalledError`. Process restart is the recovery.
 */
export class RecostInterceptorPatchOverwrittenError extends RecostError {
  readonly skippedBindings: ReadonlyArray<InterceptorBinding>;
  constructor(skipped: ReadonlyArray<InterceptorBinding>) {
    super(
      `uninstall() found ${skipped.length} binding(s) wrapped by another library after install(); ` +
        `leaving those wrappers in place: ${skipped.join(", ")}. ` +
        "The recost callback has been detached so no further events are recorded.",
    );
    this.name = "RecostInterceptorPatchOverwrittenError";
    this.skippedBindings = skipped;
  }
}
```

- [ ] **Step 4: Re-export the two new classes from `src/index.ts`**

Open `src/index.ts`. Find the `// Typed error classes` re-export block (lines 17–23):

```typescript
// Typed error classes (runtime values — separate export from the type-only block above)
export {
  RecostError,
  RecostAuthError,
  RecostFatalAuthError,
  RecostLocalUnreachableError,
} from "./core/types.js";
```

Replace with:

```typescript
// Typed error classes (runtime values — separate export from the type-only block above)
export {
  RecostError,
  RecostAuthError,
  RecostFatalAuthError,
  RecostLocalUnreachableError,
  RecostInterceptorAlreadyInstalledError,
  RecostInterceptorPatchOverwrittenError,
} from "./core/types.js";

export type { InterceptorBinding } from "./core/types.js";
```

- [ ] **Step 5: Run the two new tests to confirm they pass**

```bash
npx vitest run tests/interceptor.test.ts -t "typed errors"
```

Expected: 2 passing.

- [ ] **Step 6: Run lint to catch any type drift**

```bash
npm run lint
```

Expected: clean exit.

- [ ] **Step 7: Run the full vitest suite to confirm no regressions**

```bash
npm run test:unit
```

Expected: `Tests  255 passed (255)` (253 baseline + 2 new tests from this task).

- [ ] **Step 8: Commit**

```bash
git add src/core/types.ts src/index.ts tests/interceptor.test.ts
git commit -m "feat(types): RecostInterceptor{AlreadyInstalled,PatchOverwritten}Error (#11)"
```

---

## Task 3: Move interceptor singleton state onto `globalThis` (refactor only, no behavior change)

**Files:**
- Modify: `src/core/interceptor.ts` — replace module-level `let` state with a `globalThis`-keyed `InterceptorState` object; closures over the state object.
- Modify: `tests/interceptor.test.ts` — add 1 regression test that the state lives on `globalThis` under the expected symbol.

The goal here is *invariant-preserving refactor*: after this task, every existing test must still pass without modification. `install()` / `uninstall()` behave identically to today; only the storage location of the singleton state moves.

- [ ] **Step 1: Write the failing state-location test**

Open `tests/interceptor.test.ts`. Find the `describe("interceptor — typed errors (#11)", ...)` block added in Task 2. Insert a new `describe` block above it (or anywhere after the existing test blocks, before "typed errors"):

```typescript
describe("interceptor — globalThis-keyed state (#11.1)", () => {
  const STATE_KEY = Symbol.for("@recost-dev/node:interceptor-state");

  afterEach(() => {
    uninstall();
  });

  it("install() populates globalThis[STATE_KEY] with installed=true and saved originals", () => {
    expect((globalThis as Record<symbol, unknown>)[STATE_KEY]).toBeUndefined();

    const events: RawEvent[] = [];
    install((e) => events.push(e));

    const state = (globalThis as Record<symbol, unknown>)[STATE_KEY] as
      | { installed: boolean; originalFetch: unknown; patchedFetch: unknown }
      | undefined;

    expect(state).toBeDefined();
    expect(state!.installed).toBe(true);
    expect(state!.originalFetch).toBeTypeOf("function");
    expect(state!.patchedFetch).toBeTypeOf("function");
    expect(globalThis.fetch).toBe(state!.patchedFetch);
  });
});
```

- [ ] **Step 2: Run the new test to confirm it fails**

```bash
npx vitest run tests/interceptor.test.ts -t "globalThis-keyed"
```

Expected: 1 test failing. The failure message will be either "expected undefined to be defined" (state object missing) or that the symbol entry doesn't exist on `globalThis`.

- [ ] **Step 3: Refactor `src/core/interceptor.ts` — introduce `InterceptorState`**

Open `src/core/interceptor.ts`. Replace lines 23–38 (the entire `// Module-level singleton state` block) with:

```typescript
// ---------------------------------------------------------------------------
// Singleton state — stored on globalThis under a registry symbol so two
// copies of @recost-dev/node loaded in the same realm (dual-package hazard)
// coordinate through a single state object.
// ---------------------------------------------------------------------------

const STATE_KEY = Symbol.for("@recost-dev/node:interceptor-state");

/**
 * Shape of the shared interceptor state. The patched wrappers close over a
 * reference to this object, so reading state via property access always sees
 * the current snapshot regardless of which package copy installed first.
 *
 * The shape is intentionally permanent — every present and future copy of
 * the SDK reads/writes through this contract. New fields must default to
 * `null` so older copies stay backwards-compatible.
 */
interface InterceptorState {
  installed: boolean;
  callback: EventCallback | null;
  onError: ((err: Error) => void) | null;
  inFetchWrapper: boolean;
  originalFetch: typeof globalThis.fetch | null;
  originalHttpRequest: typeof http.request | null;
  originalHttpGet: typeof http.get | null;
  originalHttpsRequest: typeof https.request | null;
  originalHttpsGet: typeof https.get | null;
  patchedFetch: typeof globalThis.fetch | null;
  patchedHttpRequest: typeof http.request | null;
  patchedHttpGet: typeof http.get | null;
  patchedHttpsRequest: typeof https.request | null;
  patchedHttpsGet: typeof https.get | null;
}

function getState(): InterceptorState {
  const g = globalThis as Record<symbol, InterceptorState | undefined>;
  let s = g[STATE_KEY];
  if (s === undefined) {
    s = {
      installed: false,
      callback: null,
      onError: null,
      inFetchWrapper: false,
      originalFetch: null,
      originalHttpRequest: null,
      originalHttpGet: null,
      originalHttpsRequest: null,
      originalHttpsGet: null,
      patchedFetch: null,
      patchedHttpRequest: null,
      patchedHttpGet: null,
      patchedHttpsRequest: null,
      patchedHttpsGet: null,
    };
    g[STATE_KEY] = s;
  }
  return s;
}
```

- [ ] **Step 4: Rewrite `patchedFetch` to read from `getState()`**

Still in `src/core/interceptor.ts`. Replace the entire `patchedFetch` constant (lines starting with `const patchedFetch: typeof globalThis.fetch = async (input, init?) => {` and ending with `};` after the `finally` block — roughly lines 204–335) with:

```typescript
const patchedFetch: typeof globalThis.fetch = async (input, init?) => {
  const state = getState();

  // If the SDK has been detached (callback cleared on uninstall, but our
  // wrapper still chained underneath a third-party wrapper), short-circuit
  // to a pure passthrough. No instrumentation, no measurement, no events.
  if (state.callback === null || state.originalFetch === null) {
    return (state.originalFetch ?? globalThis.fetch)(input, init);
  }

  let parsed: ParsedUrl | null = null;
  let method = "GET";
  let requestBytesPromise: Promise<number> | null = null;

  try {
    parsed = extractUrl(input);
    if (typeof input === "object" && input !== null && "method" in input) {
      method = (input as Request).method ?? "GET";
    }
    if (init?.method) method = init.method;
  } catch {
    // Metadata extraction failed — proceed without instrumentation
  }

  if (parsed === null) {
    return state.originalFetch(input, init);
  }

  requestBytesPromise = estimateRequestBytes(input, init);

  const startTime = performance.now();
  state.inFetchWrapper = true;

  try {
    const response = await state.originalFetch(input, init);

    const capturedParsed = parsed;
    const capturedMethod = method;
    const capturedRequestBytesPromise = requestBytesPromise;
    const status = response.status;
    const contentLengthHeader = response.headers.get("content-length");
    const headerBytes = contentLengthHeader != null ? (parseInt(contentLengthHeader, 10) || 0) : 0;

    if (response.body == null) {
      const latencyMs = performance.now() - startTime;
      void (async (): Promise<void> => {
        try {
          const rb = capturedRequestBytesPromise !== null
            ? await capturedRequestBytesPromise
            : 0;
          state.callback?.(buildEvent(capturedParsed, capturedMethod, status, latencyMs, rb, headerBytes));
        } catch {
          // Telemetry error — swallow
        }
      })();
      return response;
    }

    let observedBytes = 0;
    let telemetryFired = false;
    const fireTelemetry = async (statusForEvent: number): Promise<void> => {
      if (telemetryFired) return;
      telemetryFired = true;
      try {
        const rb = capturedRequestBytesPromise !== null
          ? await capturedRequestBytesPromise
          : 0;
        const latencyMs = performance.now() - startTime;
        const responseBytes = observedBytes > 0 ? observedBytes : headerBytes;
        state.callback?.(buildEvent(capturedParsed, capturedMethod, statusForEvent, latencyMs, rb, responseBytes));
      } catch {
        // Telemetry error — swallow
      }
    };

    const [forCaller, forCounter] = response.body.tee();

    void (async (): Promise<void> => {
      const reader = forCounter.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value != null) observedBytes += value.byteLength;
        }
      } catch {
        // Source errored — still fire telemetry with whatever we observed.
      } finally {
        await fireTelemetry(status);
      }
    })();

    return new Response(forCaller, response);
  } catch (fetchError) {
    const capturedParsed = parsed;
    const capturedMethod = method;
    const capturedRequestBytesPromise = requestBytesPromise;
    const latencyMs = performance.now() - startTime;
    void (async (): Promise<void> => {
      try {
        const rb = capturedRequestBytesPromise !== null
          ? await capturedRequestBytesPromise
          : 0;
        state.callback?.(buildEvent(capturedParsed, capturedMethod, 0, latencyMs, rb, 0));
      } catch {
        // Telemetry error — swallow
      }
    })();

    throw fetchError;
  } finally {
    state.inFetchWrapper = false;
  }
};
```

(Diff vs. the original: `_originalFetch!` → `state.originalFetch`, `_callback?.(` → `state.callback?.(`, `_inFetchWrapper = …` → `state.inFetchWrapper = …`, and a new short-circuit passthrough at the top of the wrapper. Logic is otherwise byte-for-byte identical.)

- [ ] **Step 5: Rewrite `makeRequestWrapper` to read from state**

Still in `src/core/interceptor.ts`. Replace the `makeRequestWrapper` function (currently around lines 344–468) with:

```typescript
function makeRequestWrapper(originalRequest: HttpRequestFn): HttpRequestFn {
  const wrapper = function (
    urlOrOptions: string | URL | http.RequestOptions,
    optionsOrCallback?: http.RequestOptions | ((res: http.IncomingMessage) => void),
    maybeCallback?: (res: http.IncomingMessage) => void,
  ): http.ClientRequest {
    const state = getState();

    // Detached: pure passthrough.
    if (state.callback === null) {
      // @ts-expect-error forwarding original overloaded signature
      return originalRequest(urlOrOptions, optionsOrCallback, maybeCallback);
    }

    if (state.inFetchWrapper) {
      // @ts-expect-error forwarding original overloaded signature
      return originalRequest(urlOrOptions, optionsOrCallback, maybeCallback);
    }

    let parsed: ParsedUrl | null = null;
    let method = "GET";
    let requestBytes = 0;

    try {
      const firstArgIsUrlish =
        typeof urlOrOptions === "string" || urlOrOptions instanceof URL;
      const secondArgPath: string | undefined =
        typeof optionsOrCallback === "object" &&
        optionsOrCallback !== null &&
        typeof (optionsOrCallback as http.RequestOptions).path === "string"
          ? ((optionsOrCallback as http.RequestOptions).path as string)
          : undefined;
      const pathOverride = firstArgIsUrlish ? secondArgPath : undefined;

      parsed = extractUrl(urlOrOptions, pathOverride);

      if (typeof urlOrOptions === "object" && !(urlOrOptions instanceof URL) && urlOrOptions.method) {
        method = urlOrOptions.method;
      }
      if (
        typeof optionsOrCallback === "object" &&
        optionsOrCallback !== null &&
        (optionsOrCallback as http.RequestOptions).method
      ) {
        method = (optionsOrCallback as http.RequestOptions).method!;
      }

      const opts = typeof urlOrOptions === "object" && !(urlOrOptions instanceof URL)
        ? urlOrOptions as http.RequestOptions
        : typeof optionsOrCallback === "object" && optionsOrCallback !== null
          ? optionsOrCallback as http.RequestOptions
          : null;

      if (opts?.headers && typeof opts.headers === "object") {
        const cl = (opts.headers as Record<string, string | string[]>)["content-length"];
        if (cl != null) {
          requestBytes = parseInt(Array.isArray(cl) ? cl[0]! : cl, 10) || 0;
        }
      }
    } catch {
      // Metadata extraction failed — proceed without instrumentation
    }

    const startTime = performance.now();

    // @ts-expect-error forwarding original overloaded signature
    const req: http.ClientRequest = originalRequest(urlOrOptions, optionsOrCallback, maybeCallback);

    if (parsed === null) return req;

    const capturedParsed = parsed;
    const capturedMethod = method;
    const capturedRequestBytes = requestBytes;

    try {
      req.once("response", (res: http.IncomingMessage) => {
        try {
          const statusCode = res.statusCode ?? 0;
          const contentLength = res.headers["content-length"];
          const headerBytes = contentLength != null ? (parseInt(contentLength, 10) || 0) : 0;

          let observedBytes = 0;
          res.on("data", (chunk: Buffer | string) => {
            try {
              observedBytes += typeof chunk === "string"
                ? Buffer.byteLength(chunk)
                : chunk.length;
            } catch {
              // Swallow
            }
          });

          res.once("close", () => {
            try {
              const latencyMs = performance.now() - startTime;
              const responseBytes = observedBytes > 0 ? observedBytes : headerBytes;
              state.callback?.(buildEvent(capturedParsed, capturedMethod, statusCode, latencyMs, capturedRequestBytes, responseBytes));
            } catch {
              // Swallow
            }
          });
        } catch {
          // Swallow
        }
      });

      req.once("error", () => {
        try {
          const latencyMs = performance.now() - startTime;
          state.callback?.(buildEvent(capturedParsed, capturedMethod, 0, latencyMs, capturedRequestBytes, 0));
        } catch {
          // Swallow
        }
      });
    } catch {
      // Event listener attachment failed — return request untouched
    }

    return req;
  };

  return wrapper as unknown as HttpRequestFn;
}
```

(Diff vs. original: identical except for the new passthrough at top, `_inFetchWrapper` → `state.inFetchWrapper`, and `_callback?.(` → `state.callback?.(`.)

- [ ] **Step 6: Rewrite `install()` and `uninstall()` — refactor only (no behavior change yet)**

Replace the `install`, `uninstall`, `isInstalled`, and `getRawFetch` functions (currently lines ~489–551) with:

```typescript
/**
 * Installs patches on globalThis.fetch, http.request, https.request,
 * http.get, and https.get. No-op if already installed.
 *
 * (Task 3 retains the original "no-op if installed" semantics; Task 4 adds
 * the typed-error signal and dual-package coordination.)
 */
export function install(callback: EventCallback): void {
  const state = getState();
  if (state.installed) return;

  state.callback = callback;

  state.originalFetch = globalThis.fetch;
  state.originalHttpRequest = http.request;
  state.originalHttpGet = http.get;
  state.originalHttpsRequest = https.request;
  state.originalHttpsGet = https.get;

  state.patchedFetch = patchedFetch;
  globalThis.fetch = patchedFetch;

  const patchedHttpRequest = makeRequestWrapper(state.originalHttpRequest);
  const patchedHttpsRequest = makeRequestWrapper(state.originalHttpsRequest);
  const patchedHttpGet = makeGetWrapper(patchedHttpRequest);
  const patchedHttpsGet = makeGetWrapper(patchedHttpsRequest);

  state.patchedHttpRequest = patchedHttpRequest;
  state.patchedHttpsRequest = patchedHttpsRequest;
  state.patchedHttpGet = patchedHttpGet;
  state.patchedHttpsGet = patchedHttpsGet;

  (http as unknown as { request: HttpRequestFn }).request = patchedHttpRequest;
  (http as unknown as { get: HttpGetFn }).get = patchedHttpGet;
  (https as unknown as { request: HttpRequestFn }).request = patchedHttpsRequest;
  (https as unknown as { get: HttpGetFn }).get = patchedHttpsGet;

  state.installed = true;
}

/**
 * Restores all patched functions to their originals. No-op if not installed.
 *
 * (Task 3 retains blind-restore semantics; Task 5 adds the per-binding
 * identity check + typed-error signal for third-party wrappers.)
 */
export function uninstall(): void {
  const state = getState();
  if (!state.installed) return;

  if (state.originalFetch != null) globalThis.fetch = state.originalFetch;
  if (state.originalHttpRequest != null) (http as unknown as { request: HttpRequestFn }).request = state.originalHttpRequest;
  if (state.originalHttpGet != null) (http as unknown as { get: HttpGetFn }).get = state.originalHttpGet;
  if (state.originalHttpsRequest != null) (https as unknown as { request: HttpRequestFn }).request = state.originalHttpsRequest;
  if (state.originalHttpsGet != null) (https as unknown as { get: HttpGetFn }).get = state.originalHttpsGet;

  state.callback = null;
  state.originalFetch = null;
  state.originalHttpRequest = null;
  state.originalHttpGet = null;
  state.originalHttpsRequest = null;
  state.originalHttpsGet = null;
  state.patchedFetch = null;
  state.patchedHttpRequest = null;
  state.patchedHttpGet = null;
  state.patchedHttpsRequest = null;
  state.patchedHttpsGet = null;
  state.inFetchWrapper = false;
  state.installed = false;
}

/** Returns true if patches are currently active. */
export function isInstalled(): boolean {
  return getState().installed;
}

/**
 * Returns the original, unpatched fetch for internal SDK use (e.g. transport).
 * Falls back to globalThis.fetch if called before install().
 */
export function getRawFetch(): typeof globalThis.fetch {
  return getState().originalFetch ?? globalThis.fetch;
}
```

- [ ] **Step 7: Run the new state-location test**

```bash
npx vitest run tests/interceptor.test.ts -t "globalThis-keyed"
```

Expected: 1 passing.

- [ ] **Step 8: Run the full interceptor + init test files to confirm no regressions**

```bash
npx vitest run tests/interceptor.test.ts tests/init.test.ts
```

Expected: all tests in those two files passing. After Tasks 2 + 3 the combined `interceptor.test.ts + init.test.ts` count is **81** (baseline 78 + 2 from Task 2 + 1 from this task).

- [ ] **Step 9: Run the full test suite**

```bash
npm run test:unit
```

Expected: `Tests  256 passed (256)` (253 baseline + 2 from Task 2 + 1 from this task).

- [ ] **Step 10: Lint and commit**

```bash
npm run lint
git add src/core/interceptor.ts tests/interceptor.test.ts
git commit -m "refactor(interceptor): move singleton state to globalThis-keyed object (#11)"
```

---

## Task 4: `install()` — dual-package detection via `RecostInterceptorAlreadyInstalledError` (#11.1)

**Files:**
- Modify: `src/core/interceptor.ts` — add `setOnError()` setter; update `install()` to fire the typed error on second install.
- Modify: `src/init.ts` — call `setOnError(config.onError ?? null)` before `install(...)`.
- Modify: `src/index.ts` — re-export `setOnError`.
- Modify: `tests/interceptor.test.ts` — add 4 tests under `describe("interceptor — dual-package state (#11.1)")`.

- [ ] **Step 1: Write the four failing tests**

Open `tests/interceptor.test.ts`. Insert a new describe block right after the `describe("interceptor — globalThis-keyed state (#11.1)", ...)` block from Task 3:

```typescript
describe("interceptor — dual-package state (#11.1)", () => {
  afterEach(() => {
    uninstall();
  });

  it("second install() fires RecostInterceptorAlreadyInstalledError and is a no-op", async () => {
    const { setOnError } = await import("../src/core/interceptor.js");
    const { RecostInterceptorAlreadyInstalledError } = await import("../src/core/types.js");

    const errors: Error[] = [];
    setOnError((e) => errors.push(e));

    const eventsFirst: RawEvent[] = [];
    const eventsSecond: RawEvent[] = [];

    install((e) => eventsFirst.push(e));
    const firstPatched = globalThis.fetch;

    install((e) => eventsSecond.push(e));
    const afterSecondPatched = globalThis.fetch;

    expect(afterSecondPatched).toBe(firstPatched); // not re-wrapped
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(RecostInterceptorAlreadyInstalledError);
  });

  it("after a no-op second install, only the first callback fires", async () => {
    const server = await startServer((_req, res) => {
      res.end("ok");
    });
    try {
      const eventsFirst: RawEvent[] = [];
      const eventsSecond: RawEvent[] = [];
      install((e) => eventsFirst.push(e));
      install((e) => eventsSecond.push(e)); // no-op

      await fetch(`${server.baseUrl}/x`);
      await flushDeferred();

      expect(eventsFirst).toHaveLength(1);
      expect(eventsSecond).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("setOnError(null) clears the registered error handler", async () => {
    const { setOnError } = await import("../src/core/interceptor.js");
    const errors: Error[] = [];
    setOnError((e) => errors.push(e));
    install(() => {});
    setOnError(null);

    install(() => {}); // second install — should not fire any callback
    expect(errors).toHaveLength(0);
  });

  it("after a clean uninstall, install() succeeds again with no error fired", async () => {
    const { setOnError } = await import("../src/core/interceptor.js");
    const errors: Error[] = [];
    setOnError((e) => errors.push(e));

    install(() => {});
    uninstall();
    install(() => {}); // clean re-install
    expect(errors).toHaveLength(0);
    expect(isInstalled()).toBe(true);
  });
});
```

(Note: the test file already imports `startServer`, `flushDeferred`, `install`, `uninstall`, `isInstalled` near the top of the file. The two new tests using `setOnError` import it via a dynamic `import("../src/core/interceptor.js")` to avoid editing the static import block — vitest handles this transparently.)

- [ ] **Step 2: Run the new tests to confirm they fail**

```bash
npx vitest run tests/interceptor.test.ts -t "dual-package"
```

Expected: 4 tests, all failing — `setOnError` is not exported yet, and the existing `install()` is silently a no-op on the second call (which trips the "no error fired" expectations and the "only the first callback fires" expectation passes accidentally but the rest fail).

- [ ] **Step 3: Add `setOnError()` to `src/core/interceptor.ts`**

Open `src/core/interceptor.ts`. Anywhere in the public API section (after `getRawFetch`), append:

```typescript
/**
 * Wire a host-supplied error callback into the interceptor's state. Used by
 * `init()` to route typed interceptor errors (dual-package detection,
 * uninstall conflicts) through the user's configured `onError`. Setting to
 * `null` clears the registration.
 */
export function setOnError(cb: ((err: Error) => void) | null): void {
  getState().onError = cb;
}
```

- [ ] **Step 4: Update `install()` to fire `RecostInterceptorAlreadyInstalledError` on second install**

Still in `src/core/interceptor.ts`. Find the `install()` function (rewritten in Task 3). Add an import at the top of the file (after the existing `import type { RawEvent } from "./types.js";` line):

```typescript
import {
  RecostInterceptorAlreadyInstalledError,
} from "./types.js";
```

Then replace the opening of `install()`:

```typescript
export function install(callback: EventCallback): void {
  const state = getState();
  if (state.installed) return;
```

With:

```typescript
export function install(callback: EventCallback): void {
  const state = getState();
  if (state.installed) {
    try {
      state.onError?.(new RecostInterceptorAlreadyInstalledError());
    } catch {
      // The host's onError threw — swallow so we never break their app
      // from inside an advisory notification.
    }
    return;
  }
```

- [ ] **Step 5: Wire `setOnError` through `init.ts`**

Open `src/init.ts`. Find the import for `install` / `uninstall` (line 8):

```typescript
import { install, uninstall } from "./core/interceptor.js";
```

Replace with:

```typescript
import { install, setOnError, uninstall } from "./core/interceptor.js";
```

Then find the line that calls `install((event) => { … })` (line ~94). Insert immediately above it:

```typescript
  // Route advisory interceptor errors (dual-package detection, uninstall
  // conflicts) through the user's onError. setOnError(null) is called by
  // dispose() implicitly via uninstall() resetting the state.
  setOnError(config.onError ?? null);

  install((event) => {
```

- [ ] **Step 6: Re-export `setOnError` from `src/index.ts`**

Open `src/index.ts`. Find the line:

```typescript
export { install, uninstall, isInstalled } from "./core/interceptor.js";
```

Replace with:

```typescript
export { install, uninstall, isInstalled, setOnError } from "./core/interceptor.js";
```

- [ ] **Step 7: Run the four new tests to confirm they pass**

```bash
npx vitest run tests/interceptor.test.ts -t "dual-package"
```

Expected: 4 passing.

- [ ] **Step 8: Run the full vitest suite to confirm no regressions**

```bash
npm run test:unit
```

Expected: `Tests  260 passed (260)` (256 from end of Task 3 + 4 new from this task).

- [ ] **Step 9: Lint and commit**

```bash
npm run lint
git add src/core/interceptor.ts src/init.ts src/index.ts tests/interceptor.test.ts
git commit -m "feat(interceptor): detect duplicate install across package copies (#11)"
```

---

## Task 5: `uninstall()` — per-binding identity check + `RecostInterceptorPatchOverwrittenError` (#11.2)

**Files:**
- Modify: `src/core/interceptor.ts` — `uninstall()` checks each binding's current value against `state.patched*` before restoring; fires the typed error with the list of skipped bindings; leaves `state.installed = true` when any binding was skipped so subsequent installs are gated.
- Modify: `tests/interceptor.test.ts` — add 5 tests under `describe("interceptor — uninstall identity check (#11.2)")`.

- [ ] **Step 1: Write the five failing tests**

Open `tests/interceptor.test.ts`. Insert a new `describe` block after the `describe("interceptor — dual-package state (#11.1)")` block:

```typescript
describe("interceptor — uninstall identity check (#11.2)", () => {
  afterEach(() => {
    // Best-effort cleanup: if a previous test left a third-party wrapper on
    // globalThis.fetch, restore the original from the state we saved.
    const STATE_KEY = Symbol.for("@recost-dev/node:interceptor-state");
    const s = (globalThis as Record<symbol, unknown>)[STATE_KEY] as
      | { originalFetch?: typeof globalThis.fetch | null }
      | undefined;
    if (s?.originalFetch) globalThis.fetch = s.originalFetch;
    uninstall();
  });

  it("third-party wrap of fetch causes uninstall to fire PatchOverwrittenError and leave fetch alone", async () => {
    const { setOnError } = await import("../src/core/interceptor.js");
    const { RecostInterceptorPatchOverwrittenError } = await import("../src/core/types.js");

    const errors: Error[] = [];
    setOnError((e) => errors.push(e));
    install(() => {});

    const ourPatched = globalThis.fetch;
    const thirdPartyWrapper: typeof globalThis.fetch = (input, init) =>
      ourPatched(input, init);
    globalThis.fetch = thirdPartyWrapper;

    uninstall();

    expect(globalThis.fetch).toBe(thirdPartyWrapper); // not clobbered
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(RecostInterceptorPatchOverwrittenError);
    expect(
      (errors[0] as InstanceType<typeof RecostInterceptorPatchOverwrittenError>).skippedBindings,
    ).toEqual(["fetch"]);
  });

  it("uninstall restores http.request even when fetch was wrapped by a third party", async () => {
    const { setOnError } = await import("../src/core/interceptor.js");
    setOnError(() => {});

    const originalHttpRequest = http.request;
    install(() => {});
    const ourPatchedFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => ourPatchedFetch(input, init); // third-party wrap

    uninstall();

    // http.request was NOT wrapped by a third party, so it should be restored
    expect(http.request).toBe(originalHttpRequest);
  });

  it("after a conflict-uninstall, our patched fetch (still in the chain) is a pure passthrough", async () => {
    const { setOnError } = await import("../src/core/interceptor.js");
    setOnError(() => {});

    const events: RawEvent[] = [];
    install((e) => events.push(e));

    const ourPatched = globalThis.fetch;
    globalThis.fetch = (input, init) => ourPatched(input, init); // wrap on top
    uninstall();

    const server = await startServer((_req, res) => res.end("x"));
    try {
      // The third-party wrapper still calls ourPatched, which after uninstall
      // sees state.callback === null and falls through to state.originalFetch.
      // No event should be recorded.
      await fetch(`${server.baseUrl}/x`);
      await flushDeferred();
      expect(events).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("no third-party wrap = clean uninstall, no error fired", async () => {
    const { setOnError } = await import("../src/core/interceptor.js");
    const errors: Error[] = [];
    setOnError((e) => errors.push(e));
    install(() => {});
    uninstall();
    expect(errors).toHaveLength(0);
  });

  it("re-init after a conflict-uninstall fires AlreadyInstalledError and is a no-op", async () => {
    const { setOnError } = await import("../src/core/interceptor.js");
    const { RecostInterceptorAlreadyInstalledError } = await import("../src/core/types.js");
    const errors: Error[] = [];
    setOnError((e) => errors.push(e));

    install(() => {});
    const ourPatched = globalThis.fetch;
    globalThis.fetch = (input, init) => ourPatched(input, init); // wrap on top
    uninstall(); // fires PatchOverwrittenError

    install(() => {}); // attempted re-install
    expect(errors).toHaveLength(2);
    expect(errors[1]).toBeInstanceOf(RecostInterceptorAlreadyInstalledError);
  });
});
```

- [ ] **Step 2: Run the new tests to confirm they fail**

```bash
npx vitest run tests/interceptor.test.ts -t "uninstall identity check"
```

Expected: 5 tests failing — the current `uninstall()` blindly restores `state.originalFetch` regardless of whether `globalThis.fetch === state.patchedFetch`, so the third-party-wrapper assertions fail (`expect(globalThis.fetch).toBe(thirdPartyWrapper)` becomes `expect(originalFetch).toBe(thirdPartyWrapper)` — never true).

- [ ] **Step 3: Rewrite `uninstall()` with per-binding identity check**

Open `src/core/interceptor.ts`. Add to the existing import from `./types.js`:

```typescript
import {
  RecostInterceptorAlreadyInstalledError,
  RecostInterceptorPatchOverwrittenError,
  type InterceptorBinding,
} from "./types.js";
```

Replace the `uninstall()` function with:

```typescript
/**
 * Restores all patched functions to their originals — but only when the
 * current global still points at *our* patched function. If another library
 * wrapped our wrapper after install(), we cannot safely restore (doing so
 * would overwrite the third party's wrapper). In that case the binding is
 * left alone and recorded as skipped. Skipped bindings cause an advisory
 * `RecostInterceptorPatchOverwrittenError` to fire through `state.onError`,
 * and the state remains `installed === true` so subsequent `install()` calls
 * become no-ops that fire `RecostInterceptorAlreadyInstalledError`. Recovery
 * requires a process restart.
 *
 * No-op if not installed.
 */
export function uninstall(): void {
  const state = getState();
  if (!state.installed) return;

  const skipped: InterceptorBinding[] = [];

  if (state.originalFetch != null && state.patchedFetch != null) {
    if (globalThis.fetch === state.patchedFetch) {
      globalThis.fetch = state.originalFetch;
    } else {
      skipped.push("fetch");
    }
  }
  if (state.originalHttpRequest != null && state.patchedHttpRequest != null) {
    if ((http as unknown as { request: HttpRequestFn }).request === state.patchedHttpRequest) {
      (http as unknown as { request: HttpRequestFn }).request = state.originalHttpRequest;
    } else {
      skipped.push("http.request");
    }
  }
  if (state.originalHttpGet != null && state.patchedHttpGet != null) {
    if ((http as unknown as { get: HttpGetFn }).get === state.patchedHttpGet) {
      (http as unknown as { get: HttpGetFn }).get = state.originalHttpGet;
    } else {
      skipped.push("http.get");
    }
  }
  if (state.originalHttpsRequest != null && state.patchedHttpsRequest != null) {
    if ((https as unknown as { request: HttpRequestFn }).request === state.patchedHttpsRequest) {
      (https as unknown as { request: HttpRequestFn }).request = state.originalHttpsRequest;
    } else {
      skipped.push("https.request");
    }
  }
  if (state.originalHttpsGet != null && state.patchedHttpsGet != null) {
    if ((https as unknown as { get: HttpGetFn }).get === state.patchedHttpsGet) {
      (https as unknown as { get: HttpGetFn }).get = state.originalHttpsGet;
    } else {
      skipped.push("https.get");
    }
  }

  // Detach the callback so the orphaned patched functions (still in chain
  // under any third-party wrapper) become pure passthroughs. This must
  // happen regardless of whether any binding was skipped.
  state.callback = null;
  state.inFetchWrapper = false;

  if (skipped.length > 0) {
    // Conflict path: leave originals in state (the orphaned patched fns
    // dereference them via state.originalFetch when called) and refuse
    // re-install. `state.installed` stays true.
    try {
      state.onError?.(new RecostInterceptorPatchOverwrittenError(skipped));
    } catch {
      // Swallow host onError errors
    }
    // Do NOT null state.original* / state.patched* — the orphaned wrappers
    // close over state and still need to dereference state.originalFetch on
    // every call. They become pure passthroughs because state.callback is null.
    return;
  }

  // Clean path: clear everything and allow future installs.
  state.originalFetch = null;
  state.originalHttpRequest = null;
  state.originalHttpGet = null;
  state.originalHttpsRequest = null;
  state.originalHttpsGet = null;
  state.patchedFetch = null;
  state.patchedHttpRequest = null;
  state.patchedHttpGet = null;
  state.patchedHttpsRequest = null;
  state.patchedHttpsGet = null;
  state.installed = false;
}
```

- [ ] **Step 4: Run the five new tests to confirm they pass**

```bash
npx vitest run tests/interceptor.test.ts -t "uninstall identity check"
```

Expected: 5 passing.

- [ ] **Step 5: Run the full interceptor + init test files**

```bash
npx vitest run tests/interceptor.test.ts tests/init.test.ts
```

Expected: all passing. Note: the existing tests that call `uninstall()` in `afterEach` after a clean install path still trip the clean branch (skipped.length === 0), so no existing test should regress.

- [ ] **Step 6: Run the full vitest suite**

```bash
npm run test:unit
```

Expected: `Tests  265 passed (265)` (260 from end of Task 4 + 5 new from this task).

- [ ] **Step 7: Lint and commit**

```bash
npm run lint
git add src/core/interceptor.ts tests/interceptor.test.ts
git commit -m "feat(interceptor): identity-check restore on uninstall to avoid clobbering third-party patches (#11)"
```

---

## Task 6: `RecostHandle.flush()` for Python parity (#19)

**Files:**
- Modify: `src/init.ts` — add `flush()` to `RecostHandle` interface and to the returned handle object.
- Modify: `tests/init.test.ts` — add 2 tests under `describe("init — flush (#19)")`.

- [ ] **Step 1: Write the two failing tests**

Open `tests/init.test.ts`. Append at the bottom of the file (after the last existing `describe` block):

```typescript
describe("init — flush (#19)", () => {
  afterEach(() => {
    // Belt-and-suspenders cleanup in case a test left things installed.
    uninstall();
  });

  it("handle.flush() flushes the current window without disposing", async () => {
    const ws = await startWsCollector();
    const httpServer = await startHttpServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    const handle = init({ localPort: ws.port, flushIntervalMs: 60_000 });

    try {
      // Generate one event so the aggregator window is non-empty.
      await fetch(`${httpServer.url}/x`);

      // The fetch wrapper emits telemetry on the next macrotask; give it a
      // tick. (interceptor.test.ts uses the same pattern.)
      await new Promise<void>((r) => setTimeout(r, 50));

      await handle.flush();

      // Wait briefly for the WS write to be delivered.
      const deadline = Date.now() + 1_000;
      while (ws.summaries.length === 0 && Date.now() < deadline) {
        await new Promise<void>((r) => setTimeout(r, 25));
      }

      expect(ws.summaries.length).toBeGreaterThanOrEqual(1);
      // Handle is still alive: dispose() should still run cleanly.
      expect(isInstalled()).toBe(true);
      await handle.dispose();
      expect(isInstalled()).toBe(false);
    } finally {
      await httpServer.close();
      await ws.close();
    }
  });

  it("handle.flush() after dispose() resolves immediately as a no-op", async () => {
    const handle = init({ flushIntervalMs: 60_000 });
    await handle.dispose();
    // Should resolve without throwing and without re-installing anything.
    await expect(handle.flush()).resolves.toBeUndefined();
    expect(isInstalled()).toBe(false);
  });
});
```

(Helper names match the file's existing conventions: `startHttpServer` returns `{ url, close }`; `startWsCollector` returns `{ port, summaries, close }`. No new helper imports needed; the existing top-of-file imports of `init`, `isInstalled`, `uninstall`, `WindowSummary` already cover everything used here.)

- [ ] **Step 2: Verify the new tests fail**

```bash
npx vitest run tests/init.test.ts -t "init — flush"
```

Expected: 2 tests failing — `handle.flush is not a function`.

- [ ] **Step 3: Add `flush()` to the `RecostHandle` interface**

Open `src/init.ts`. Replace the `RecostHandle` interface (lines 13–29) with:

```typescript
/** Returned by init() to allow explicit teardown. */
export interface RecostHandle {
  /**
   * Stop intercepting, perform one final shutdown flush, then close transport
   * connections. The returned promise resolves once the final flush completes
   * or `shutdownFlushTimeoutMs` elapses (whichever comes first). It never
   * rejects — flush errors are routed through the configured `onError`.
   *
   * Awaiting is optional: callers that don't care about flush completion can
   * keep calling `dispose()` synchronously, but in long-running services or
   * test teardown you probably want to `await` so the in-flight POST isn't
   * cut off when the process exits.
   */
  dispose(): Promise<void>;

  /**
   * Flush the current aggregator window without disposing. Resolves when the
   * flush completes; never rejects — errors route through the configured
   * `onError` callback (or are swallowed silently if none is configured).
   *
   * Useful before a known process-exit boundary on platforms where
   * `dispose()` doesn't fit your shutdown ordering. After `dispose()` has
   * run, `flush()` resolves immediately as a no-op.
   *
   * Cross-SDK parity: equivalent to the Python SDK's `flush_blocking()`. JS
   * has no thread-blocking primitive, so the Node parallel is the awaited
   * promise. See the README "Cleanup / teardown" section.
   */
  flush(): Promise<void>;

  /** Outcome of the most recent flush, or null if no flush has completed yet. */
  readonly lastFlushStatus: FlushStatus | null;
}
```

- [ ] **Step 4: Implement `flush()` on the handle**

Still in `src/init.ts`. Find the `handle: RecostHandle = { …, async dispose(): Promise<void> { … }, get lastFlushStatus(): … }` object (currently around lines 156–186). Replace it with:

```typescript
  const handle: RecostHandle = {
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;

      // Stop the periodic timer first so a tick can't race the shutdown
      // flush, then uninstall so post-dispose user requests aren't captured.
      clearInterval(timer);
      uninstall();

      // One final flush, bounded by shutdownFlushTimeoutMs.
      try {
        await Promise.race([
          flushAndSend(),
          new Promise<void>((resolve) => setTimeout(resolve, shutdownFlushTimeoutMs)),
        ]);
      } catch {
        // flushAndSend already routes errors through onError
      }

      transport.dispose();
      if (_handle === handle) _handle = null;
    },
    async flush(): Promise<void> {
      // No-op after dispose. Idempotent and safe to call from a final-exit
      // handler that also calls dispose() — order doesn't matter.
      if (disposed) return;
      try {
        await flushAndSend();
      } catch {
        // flushAndSend already routes errors through onError
      }
    },
    get lastFlushStatus(): FlushStatus | null {
      return transport.lastFlushStatus;
    },
  };
```

- [ ] **Step 5: Run the new tests to confirm they pass**

```bash
npx vitest run tests/init.test.ts -t "init — flush"
```

Expected: 2 passing.

- [ ] **Step 6: Run the full vitest suite**

```bash
npm run test:unit
```

Expected: `Tests  267 passed (267)` (265 from end of Task 5 + 2 new from this task).

- [ ] **Step 7: Lint and commit**

```bash
npm run lint
git add src/init.ts tests/init.test.ts
git commit -m "feat(handle): add flush() for Python flush_blocking() parity (#19)"
```

---

## Task 7: README documentation updates

**Files:**
- Modify: `README.md` — add Worker threads subsection (#11.3); document `handle.flush()` and reference Python parity (#19); update the error-handling code samples to include the two new error classes (#11.1, #11.2).

This task is documentation-only — no tests.

- [ ] **Step 1: Add the Worker threads subsection**

Open `README.md`. Find the `### Cleanup / teardown` subsection (currently around line 192). Insert *between* the `### Cleanup / teardown` block and the next `### Disabling in tests` subsection:

```markdown
### Worker threads

`init()` patches `fetch`, `http`, and `https` for the worker that calls it. Workers spawned via `node:worker_threads` get their own module instances and their own `globalThis`, so they will not be instrumented until you call `init()` inside the worker's own entry point. SDK errors thrown in a worker route through that worker's own `onError`.

```ts
// In worker.ts (the worker entry point)
import { init } from "@recost-dev/node";

init({ apiKey: process.env.RECOST_API_KEY });

// …rest of worker logic…
```

The main thread's `init()` does not propagate to workers, and the SDK does not detect or warn about worker spawns — instrumenting workers is the host's responsibility.
```

- [ ] **Step 2: Update the Cleanup / teardown subsection to document `flush()`**

Still in `README.md`. Find the existing `### Cleanup / teardown` subsection (currently 192–201):

```markdown
### Cleanup / teardown

`init()` returns a handle with a `dispose()` method that stops the interceptor, cancels the flush timer, and closes the transport connection. Useful in tests or when you want to reinitialize with different config.

```ts
const recost = init({ … });

// … later …
recost.dispose();
```
```

Replace with:

```markdown
### Cleanup / teardown

`init()` returns a handle with two lifecycle methods:

- **`dispose(): Promise<void>`** — stop intercepting, perform one final shutdown flush (bounded by `shutdownFlushTimeoutMs`), close the transport. Calling this twice is a no-op.
- **`flush(): Promise<void>`** — flush the current aggregator window *without* disposing. Useful before a known process-exit boundary where `dispose()` doesn't fit your shutdown ordering. After `dispose()` has run, `flush()` resolves immediately.

Both methods route flush errors through your configured `onError`; they never reject.

```ts
const recost = init({ … });

// Manual checkpoint flush before a non-graceful exit:
await recost.flush();

// Graceful shutdown:
await recost.dispose();
```

**Cross-SDK parity.** The Python SDK's `dispose()` is synchronous (returns immediately after spawning a flush thread); its `flush_blocking(timeout_s=…)` blocks the calling thread until the flush completes. Node's `await handle.dispose()` already provides blocking semantics, and `await handle.flush()` is the direct parallel of Python's `flush_blocking()`. There is no thread-blocking primitive in JavaScript, so the awaited promise is the only honest analogue.
```

- [ ] **Step 3: Update the error-handling code sample to include the two new error classes**

Still in `README.md`. Find the error-handling code sample under `### Local-mode unavailability` (lines 150–162):

```markdown
```ts
import { init, RecostAuthError, RecostFatalAuthError, RecostLocalUnreachableError } from "@recost-dev/node";

init({
  apiKey: process.env.RECOST_API_KEY,
  onError(err) {
    if (err instanceof RecostLocalUnreachableError) log.warn("recost: local extension unreachable; check VS Code");
    else if (err instanceof RecostFatalAuthError) pagerduty.fire(err);
    else if (err instanceof RecostAuthError) log.warn(err);
  },
});
```
```

Replace with:

```markdown
```ts
import {
  init,
  RecostAuthError,
  RecostFatalAuthError,
  RecostLocalUnreachableError,
  RecostInterceptorAlreadyInstalledError,
  RecostInterceptorPatchOverwrittenError,
} from "@recost-dev/node";

init({
  apiKey: process.env.RECOST_API_KEY,
  onError(err) {
    if (err instanceof RecostLocalUnreachableError) log.warn("recost: local extension unreachable; check VS Code");
    else if (err instanceof RecostFatalAuthError) pagerduty.fire(err);
    else if (err instanceof RecostAuthError) log.warn(err);
    else if (err instanceof RecostInterceptorAlreadyInstalledError) log.warn("recost: duplicate package load — first install is active");
    else if (err instanceof RecostInterceptorPatchOverwrittenError) log.warn(`recost: third-party wrapper detected on ${err.skippedBindings.join(", ")} — restart to recover`);
  },
});
```

These two interceptor errors are advisory: the SDK either keeps the first install active (`AlreadyInstalled`) or detaches the callback and refuses re-install (`PatchOverwritten`). Recovery from `PatchOverwritten` requires a process restart with the conflicting library either removed or installed before recost.
```

- [ ] **Step 4: Sanity-check the rendered README**

Run:

```bash
npx --yes markdownlint-cli2 README.md 2>&1 | head -30 || true
```

Expected: either no output (markdownlint not present, which is fine) or a clean output. Do NOT install markdownlint as a dev dep — this is a smoke check only.

If you have a markdown previewer available locally, scan the diff visually for code-fence balance and section ordering. The README order should now be: Cleanup / teardown → Worker threads → Disabling in tests.

- [ ] **Step 5: Run the full test suite to confirm docs-only changes don't regress anything**

```bash
npm run test:unit
```

Expected: `Tests  267 passed (267)` (unchanged from Task 6 — docs don't affect tests).

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs(readme): worker_threads limitation, flush() / Python parity, new error classes (#11, #19)"
```

---

## Task 8: Final verification + push

**Files:** none modified — verification only.

- [ ] **Step 1: Run lint, build, and the full test suite (both phases)**

```bash
npm run lint
npm run build
npm test
```

Expected:
- `npm run lint`: clean exit (no TypeScript errors).
- `npm run build`: ESM + CJS + DTS builds all succeed (~15ms each, dist/types/index.d.ts size approximately +500 bytes for the new exports).
- `npm test`: phase 1 (`vitest run`) reports `Tests  267 passed (267)`; phase 2 (`npm run test:dist`) reports `Tests  7 passed (7)`. The +14 delta vs. baseline 253 breaks down as: 2 (Task 2) + 1 (Task 3) + 4 (Task 4) + 5 (Task 5) + 2 (Task 6) + 0 (Task 7).

- [ ] **Step 2: Verify the dist bundle exports the new symbols**

```bash
node -e 'import("./dist/esm/index.js").then(m => { console.log(Object.keys(m).filter(k => k.startsWith("Recost") || k === "setOnError")); })'
```

Expected output contains at minimum: `RecostError`, `RecostAuthError`, `RecostFatalAuthError`, `RecostLocalUnreachableError`, `RecostInterceptorAlreadyInstalledError`, `RecostInterceptorPatchOverwrittenError`, `setOnError`.

- [ ] **Step 3: Verify the CJS bundle exports the new symbols**

```bash
node -e 'const m = require("./dist/cjs/index.cjs"); console.log(Object.keys(m).filter(k => k.startsWith("Recost") || k === "setOnError"));'
```

Expected output: identical to the ESM check.

- [ ] **Step 4: Review the commit history before pushing**

```bash
git log --oneline origin/main..HEAD
```

Expected 6 commits (in this order, newest first):
1. `docs(readme): worker_threads limitation, flush() / Python parity, new error classes (#11, #19)`
2. `feat(handle): add flush() for Python flush_blocking() parity (#19)`
3. `feat(interceptor): identity-check restore on uninstall to avoid clobbering third-party patches (#11)`
4. `feat(interceptor): detect duplicate install across package copies (#11)`
5. `refactor(interceptor): move singleton state to globalThis-keyed object (#11)`
6. `feat(types): RecostInterceptor{AlreadyInstalled,PatchOverwritten}Error (#11)`

Plus the Task 1 commit at the base: `docs: mark wave 4 done; add wave 5 multi-realm + dispose-parity plan (#11, #19)`.

- [ ] **Step 5: Push the branch**

```bash
git push -u origin feat/11-19-multi-realm-dispose-parity
```

Expected: branch created on remote, no force-push (this is a new branch). Output includes a URL like `https://github.com/recost-dev/middleware-node/pull/new/feat/11-19-multi-realm-dispose-parity`.

- [ ] **Step 6: Open the PR**

Use the `gh` CLI (the user has it configured):

```bash
gh pr create --base main \
  --title "feat: multi-realm patch safety + handle.flush() for dispose parity (#11, #19)" \
  --body "$(cat <<'EOF'
## Summary
Closes #11 and #19.

- **#11.1 dual-package hazard:** interceptor singleton state now lives on \`globalThis[Symbol.for("@recost-dev/node:interceptor-state")]\`, so a second copy of the package loaded into the same realm coordinates through the same state object. A second \`install()\` fires \`RecostInterceptorAlreadyInstalledError\` via \`onError\` and is a no-op.
- **#11.2 uninstall identity check:** \`uninstall()\` now checks each binding's current value against the patched function we stored at install time. Mismatches fire \`RecostInterceptorPatchOverwrittenError\` with the list of skipped bindings, leave the third-party wrapper in place, detach the callback, and refuse re-install. Recovery requires a process restart.
- **#11.3 worker_threads:** documented in the README as a per-realm limitation. No code change — workers must call \`init()\` themselves.
- **#19 dispose parity:** \`RecostHandle\` grows a \`flush(): Promise<void>\` method as the Node parallel of Python's \`flush_blocking()\`. Idempotent after \`dispose()\`. JS has no thread-blocking primitive, so the awaited promise is the contract.

Cross-SDK: a corresponding Python tracking issue will be filed in \`recost-dev/middleware-python\` once this PR opens; link it here before requesting review.

## Tests
- +14 vitest tests (2 typed-error class, 1 state-on-globalThis, 4 dual-package, 5 uninstall identity check, 2 \`handle.flush()\`).
- Total: 267 vitest unit + 7 dist smoke = 274 across \`npm test\`'s two phases.

## Test plan
- [ ] CI: lint clean, build green, tests pass.
- [ ] Manual smoke: \`npm test\` locally on a fresh clone.
- [ ] Manual smoke: import + log the two new error classes from a small reproducer to confirm they ship in both ESM and CJS bundles.
EOF
)"
```

Expected: PR URL printed to stdout.

- [ ] **Step 7: Mark Wave 5 implementation done in the worktree-side roadmap**

This step lands in the *next* wave's first commit per convention (Wave 6 will bundle this flip). Do **not** edit the roadmap again in this PR.

---

## Self-review hand-off

After Task 8 completes, the wave is done from this plan's perspective. CodeRabbit will pick up the PR push and provide its independent review. Any CodeRabbit follow-ups go into a separate `claude/fix-coderabbit-comments-*` branch — do not amend the merged commits.
