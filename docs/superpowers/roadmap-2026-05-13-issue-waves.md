# Issue Waves Roadmap — 2026-05-13

A planning document for tackling open `middleware-node` issues in 2–3-issue waves. Each wave groups issues that share files, themes, or dependencies so an agent orchestrator can produce a single coherent plan that covers them.

**Convention:** specs live under `docs/superpowers/specs/`, plans under `docs/superpowers/plans/`. One spec → one plan → one feature branch → one PR per sub-plan, except where the wave intentionally bundles two issues into one PR (called out per wave).

**Wave-status legend:** `pending` (not started) · `in-progress` (spec or plan exists) · `done` (PR merged).

---

## Wave 1 — Transport terminal failure & cross-SDK parity

**Status:** done

**Merged PR:** https://github.com/recost-dev/middleware-node/pull/33

**Theme:** Continuation of [PR #32](https://github.com/recost-dev/middleware-node/pull/32) (#16 — 401 auth failure handling). Adds the same "terminal failure mode" pattern to the local WebSocket transport, then mirrors the #16 hierarchy into the Python SDK.

**Sub-plans:**

| Sub-plan | Repo | Issue | Spec | Plan |
|---|---|---|---|---|
| A | `middleware-node` | [#22](https://github.com/recost-dev/middleware-node/issues/22) — WS reconnect retries forever | `specs/2026-05-13-ws-terminal-failure-design.md` | `plans/2026-05-13-ws-terminal-failure.md` |
| B | `middleware-python` | [recost-dev/middleware-python#32](https://github.com/recost-dev/middleware-python/issues/32) — bring 401 lifecycle to full Node parity (post #16) | (in `middleware-python`) | (in `middleware-python`) |

**Why first:** the design pattern (typed error class extending `RecostError`, threshold counter, latch flag, one-shot stderr + `onError`, restart-only recovery) is fresh from #16. Reuses the just-merged hierarchy. Smallest cognitive jump from the work that just shipped.

**Key design choices (Sub-plan A, settled in spec):**
- New error class `RecostLocalUnreachableError extends RecostError` (single class, not an intermediate `RecostTransportError` parent — YAGNI).
- New config field `maxConsecutiveReconnectFailures?: number` (default 20, per issue).
- Reuses existing `_reconnectAttempts` counter rather than introducing a new one.
- Recovery: process restart only. `handle.reconnect()` deferred to a future PR (same reasoning as #16 deferred `handle.reconfigure`).
- Threshold-only `onError` (no per-attempt firing, since reconnect spam is normal during connection blips).

---

## Wave 2 — Wire-format contract cleanup

**Status:** done

**Merged PR:** https://github.com/recost-dev/middleware-node/pull/34

**Theme:** Lock the cross-SDK wire format down so subsequent lifecycle changes (Wave 5) ride on a stable contract.

**Issues:**

| # | Title | Files | Repos |
|---|---|---|---|
| [#17](https://github.com/recost-dev/middleware-node/issues/17) | `WindowSummary` body carries redundant `projectId` | `src/core/aggregator.ts`, types, `tests/contract.test.ts` | node + python + api |
| [#20](https://github.com/recost-dev/middleware-node/issues/20) | ISO 8601 timestamp precision drift (Python μs vs Node ms) | `src/core/aggregator.ts` | node + python |

Both touch `WindowSummary` serialization. Coordinate Python + Node together so neither ships independently with a half-step contract.

**Recommended PR shape:** one plan, two PRs (`node` + `python`) coordinated. Or one PR per repo per issue if review preference favors smaller diffs.

---

## Wave 3 — Interceptor surgical fixes

**Status:** done

**Merged PR:** https://github.com/recost-dev/middleware-node/pull/35

**Plan:** `plans/2026-05-15-interceptor-surgical-fixes.md`

**Theme:** Two narrow correctness bugs in `interceptor.ts`. Low risk, can run in parallel.

**Issues:**

| # | Title | Files |
|---|---|---|
| [#12](https://github.com/recost-dev/middleware-node/issues/12) | `fetch(new Request(url, { body }))` reports `requestBytes: 0` | `src/core/interceptor.ts`, `tests/interceptor.test.ts` |
| [#10](https://github.com/recost-dev/middleware-node/issues/10) | `http.request` overload edges (`options.path` dropped, `host:port` collision) | `src/core/interceptor.ts`, `tests/interceptor.test.ts` |

**Recommended PR shape:** one plan, two PRs from one feature branch (or even one PR — they touch the same two files and are independent enough to commit-scope cleanly).

**Sequencing note:** finish Wave 3 before Wave 5, since #11 (multi-realm) rewrites parts of `interceptor.ts` and small fixes are easier to land first than after.

---

## Wave 4 — Provider registry overhaul

**Status:** done

**Merged PR:** https://github.com/recost-dev/middleware-node/pull/38

**Plan:** `plans/2026-05-15-provider-registry-overhaul.md`

**Theme:** Registry correctness — matching priority, cardinality, bucket cap.

**Issues:**

| # | Title | Files |
|---|---|---|
| [#13](https://github.com/recost-dev/middleware-node/issues/13) | Custom catch-alls shadow built-ins / cardinality leaks / soft bucket cap (3-in-1) | `src/core/provider-registry.ts`, `src/core/aggregator.ts`, `src/init.ts`, README, tests |
| [#21](https://github.com/recost-dev/middleware-node/issues/21) | Twilio pricing constants need source-of-truth comments | `src/core/provider-registry.ts` |

**Why bundled:** #21 is a 5-minute doc fix that lands naturally in the same review session as #13's registry rework. Same files, same context.

**Recommended PR shape:** one plan, one PR. #21 becomes a doc-cleanup commit inside the broader #13 PR.

---

## Wave 5 — Architectural / lifecycle (riskiest, save for last)

**Status:** done

**Merged PR:** https://github.com/recost-dev/middleware-node/pull/40

**Spec:** `specs/2026-05-18-multi-realm-and-dispose-parity-design.md`

**Plan:** `plans/2026-05-18-multi-realm-and-dispose-parity.md`

**Theme:** Larger-scope changes that touch the patch model (`init.ts` install/uninstall, interceptor patching strategy) and shutdown semantics. Defer until Waves 1–4 land so the small fixes don't collide with the rewrite.

**Issues:**

| # | Title | Files |
|---|---|---|
| [#11](https://github.com/recost-dev/middleware-node/issues/11) | Multi-realm: workers, dual-package hazard, third-party patch interaction | `src/core/interceptor.ts`, `src/init.ts`, README |
| [#19](https://github.com/recost-dev/middleware-node/issues/19) | Python sync vs Node async `dispose()` parity (Node may need `flushBlocking()`) | `src/init.ts` (this repo), Python side bigger |

**PR shape (actual):** one plan, one PR. #19's Node-side change is small (one new `RecostHandle.flush()` method plus README parity note), so it rides with #11 in a single bundled PR per the wave-execution convention. The Python-side parity work tracks separately in `recost-dev/middleware-python`.

---

## Wave 6 — Build pipeline & CI hygiene

**Status:** done

**Merged PR:** https://github.com/recost-dev/middleware-node/pull/41

**Plan:** `plans/2026-05-19-ci-and-build-cleanup.md`

**Theme:** Get PR-validation CI in place and remove the latent build race the new CI would otherwise periodically expose. Both touch build/CI infrastructure and land in one bundled PR per the wave-execution convention.

**Issues:**

| # | Title | Files |
|---|---|---|
| [#36](https://github.com/recost-dev/middleware-node/issues/36) | CI: add a workflow that runs lint + build + tests on every PR | `.github/workflows/ci.yml` |
| [#2](https://github.com/recost-dev/middleware-node/issues/2) | Build pipeline: tsup `clean: true` races between parallel configs | `tsup.config.ts`, `package.json` |

**Why bundled:** CI exercises the build under matrix Node versions, so any latent build race (#2) is more likely to surface in CI than locally. Fixing both together avoids a flaky first run on `main` once the workflow is live.

**Note:** the original Wave 6 candidate `#14` (excludePatterns substring matching) was deferred and bundled into Wave 7 — it's a runtime-config polish unrelated to build/CI hygiene.

---

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

---

## Cross-cutting reminders

- **Cross-SDK parity scoreboard.** Several waves touch both `middleware-node` and `middleware-python`. When a Node-side change lands, file or update the corresponding Python tracking issue in the same PR description.
- **Worktree hygiene.** Each wave's implementation work uses a fresh git worktree branched from latest `main`. Spec/plan docs land first as their own PR (or as the prefix commits of the implementation PR), then the implementation branch starts from there.
- **Test baseline.** As of 2026-05-19 after PRs #38, #40, #41, baseline is 267 tests (260 vitest + 7 dist-bundle). Each wave adjusts this number; the wave plan should record the new expected count.
