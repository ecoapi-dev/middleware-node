# CI Workflow & Build-Pipeline Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a PR-validation CI workflow that runs `lint + build + test` on Node 18/20/22 ([#36](https://github.com/recost-dev/middleware-node/issues/36)) and remove the latent `tsup` build race where `clean: true` on the ESM entry races the CJS+DTS writers ([#2](https://github.com/recost-dev/middleware-node/issues/2)). One bundled PR.

**Architecture:**

- **#36 (CI):** Add `.github/workflows/ci.yml` triggered on `pull_request` and `push` to `main`. Matrix over Node `[18, 20, 22]`. Each job runs `npm ci → npm run lint → npm run build → npm run test`. No changes to existing release workflow (`.github/workflows/npm-publish.yml`).
- **#2 (build race):** Drop `clean: true` from the ESM entry in `tsup.config.ts`. Add a `prebuild` npm script that wipes `dist/` deterministically via a Node one-liner (`node -e "fs.rmSync('dist',{recursive:true,force:true})"`) — cross-platform, no new devDep. `npm run build` invokes the `prebuild` hook automatically before `tsup`, so the clean step always completes before any tsup writer runs.

**Tech Stack:** GitHub Actions, TypeScript (strict), tsup dual ESM + CJS build, vitest, Node.js ≥ 18.

---

## File Structure

- **Create** `.github/workflows/ci.yml` — single-job workflow with a 3-version Node matrix that runs lint+build+test.
- **Modify** `tsup.config.ts` — remove `clean: true` from the ESM entry (line 11).
- **Modify** `package.json` — add `"prebuild": "node -e \"require('fs').rmSync('dist',{recursive:true,force:true})\""` to scripts.
- **Modify** `docs/superpowers/roadmap-2026-05-13-issue-waves.md`:
  - Flip Wave 5 status from `in-progress` to `done`; add `**Merged PR:** https://github.com/recost-dev/middleware-node/pull/40`.
  - Wave 6 currently lists `#14, #2`. Replace with `#36, #2` (the rebundling reflects what actually ships). Status `in-progress`. Add `**Plan:** \`plans/2026-05-19-ci-and-build-cleanup.md\``. Add a `**Theme:**` note noting #14 deferred to a later wave.
- **Create** `docs/superpowers/plans/2026-05-19-ci-and-build-cleanup.md` — this file.

**Test count delta:** **0** new vitest tests. CI is a runtime/build concern; the `prebuild` change is verified by running `npm run build` once and confirming `dist/` is wiped + repopulated identically. Baseline 267 unit + 7 dist smoke; post-wave 267 + 7.

`src/**`, `tests/**` (other than reading them for CI), and all other files are untouched.

---

## Task 1: Set up worktree, first commit lands the roadmap update + this plan

**Files:**
- Create worktree: `.claude/worktrees/wave-6-ci-and-build-cleanup/`
- Modify: `docs/superpowers/roadmap-2026-05-13-issue-waves.md`
- Create: `docs/superpowers/plans/2026-05-19-ci-and-build-cleanup.md`

Wave 5 (PR #40) is merged on `main` at `459bfaf`. This commit flips Wave 5 → done and lands the Wave 6 plan.

- [ ] **Step 1: Verify no stale Wave 6 worktree exists**

```bash
git -C /home/andresl/Projects/recost/middleware-node worktree list
```

Expected: the list does NOT contain `.claude/worktrees/wave-6-ci-and-build-cleanup`. If it does, `cd` into it and skip Step 2.

- [ ] **Step 2: Create the Wave 6 worktree off the latest `origin/main`**

```bash
cd /home/andresl/Projects/recost/middleware-node
git fetch origin main
git worktree add -b feat/36-2-ci-and-build-cleanup .claude/worktrees/wave-6-ci-and-build-cleanup origin/main
cd .claude/worktrees/wave-6-ci-and-build-cleanup
```

Expected: `Preparing worktree (new branch 'feat/36-2-ci-and-build-cleanup')` and `HEAD is now at 459bfaf Merge pull request #40 ...`.

All subsequent steps run from `.claude/worktrees/wave-6-ci-and-build-cleanup/` unless stated otherwise.

- [ ] **Step 3: Copy this plan file into the new worktree**

```bash
cp /home/andresl/Projects/recost/middleware-node/docs/superpowers/plans/2026-05-19-ci-and-build-cleanup.md docs/superpowers/plans/2026-05-19-ci-and-build-cleanup.md
```

Expected: file exists in the worktree.

- [ ] **Step 4: Update the roadmap doc — flip Wave 5 to done, Wave 6 to in-progress with new bundle**

Open `docs/superpowers/roadmap-2026-05-13-issue-waves.md`.

Find the Wave 5 header block (currently around lines 102–110):

```markdown
## Wave 5 — Architectural / lifecycle (riskiest, save for last)

**Status:** in-progress

**Spec:** `specs/2026-05-18-multi-realm-and-dispose-parity-design.md`

**Plan:** `plans/2026-05-18-multi-realm-and-dispose-parity.md`
```

Replace with:

```markdown
## Wave 5 — Architectural / lifecycle (riskiest, save for last)

**Status:** done

**Merged PR:** https://github.com/recost-dev/middleware-node/pull/40

**Spec:** `specs/2026-05-18-multi-realm-and-dispose-parity-design.md`

**Plan:** `plans/2026-05-18-multi-realm-and-dispose-parity.md`
```

Find the Wave 6 header block (currently around lines 119–127):

```markdown
## Wave 6 — Polish / one-offs (opportunistic)

**Status:** pending

**Theme:** Tiny standalone fixes; can be picked up between waves whenever convenient.

**Issues:**

| # | Title | Files |
|---|---|---|
| [#14](https://github.com/recost-dev/middleware-node/issues/14) | `excludePatterns` substring matching contract is unscoped and untested | `src/init.ts`, `tests/init.test.ts` |
| [#2](https://github.com/recost-dev/middleware-node/issues/2) | Build pipeline: tsup `clean: true` races between parallel configs | `tsup.config.ts`, `package.json` |

**Recommended PR shape:** one PR each, no full plan needed (each fits in a single small commit).
```

Replace with:

```markdown
## Wave 6 — Build pipeline & CI hygiene

**Status:** in-progress

**Plan:** `plans/2026-05-19-ci-and-build-cleanup.md`

**Theme:** Get PR-validation CI in place and remove the latent build race the new CI would otherwise periodically expose. Both touch build/CI infrastructure and land in one bundled PR per the wave-execution convention.

**Issues:**

| # | Title | Files |
|---|---|---|
| [#36](https://github.com/recost-dev/middleware-node/issues/36) | CI: add a workflow that runs lint + build + tests on every PR | `.github/workflows/ci.yml` |
| [#2](https://github.com/recost-dev/middleware-node/issues/2) | Build pipeline: tsup `clean: true` races between parallel configs | `tsup.config.ts`, `package.json` |

**Why bundled:** CI exercises the build under matrix Node versions, so any latent build race (#2) is more likely to surface in CI than locally. Fixing both together avoids a flaky first run on `main` once the workflow is live.

**Note:** the original Wave 6 candidate `#14` (excludePatterns substring matching) is deferred — it's a runtime-config polish unrelated to build/CI hygiene and will land in a later wave.
```

- [ ] **Step 5: Verify the test suite + build still pass on the fresh branch**

```bash
npm install
npm run lint
npm run build
npm test
```

Expected: lint clean, build succeeds, `npm test` reports `Tests  267 passed (267)` (phase 1) and `Tests  7 passed (7)` (phase 2).

If `npm install` modifies `package-lock.json`, `git checkout -- package-lock.json` before staging.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/roadmap-2026-05-13-issue-waves.md \
        docs/superpowers/plans/2026-05-19-ci-and-build-cleanup.md
git commit -m "docs: mark wave 5 done; add wave 6 ci-and-build-cleanup plan (#36, #2)"
```

Verify: `git log --oneline -1` shows the new commit on top of `459bfaf`.

---

## Task 2: Fix the tsup `clean: true` race (#2)

**Files:**
- Modify: `tsup.config.ts` — drop `clean: true` from the ESM entry (line 11).
- Modify: `package.json` — add a `prebuild` script that wipes `dist/` before `tsup` runs.

The race today: `tsup.config.ts` declares three concurrent build entries (ESM, CJS, DTS) writing into sibling subdirs of `dist/`. Only the ESM entry has `clean: true`, which fires *during* the concurrent run — order-dependent. Build happens to succeed today, but a slower CI runner could surface the race. Move the clean step out-of-band: an explicit `prebuild` script wipes `dist/` *before* `tsup` ever starts, then all three entries write into a clean directory with no clean-step interleaving.

- [ ] **Step 1: Remove `clean: true` from the ESM entry in `tsup.config.ts`**

Open `tsup.config.ts`. Find the ESM entry (the first object in the array, currently lines 4–12):

```typescript
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    outDir: "dist/esm",
    target: "es2020",
    dts: false,
    sourcemap: true,
    clean: true,
  },
```

Replace with (delete the `clean: true,` line):

```typescript
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    outDir: "dist/esm",
    target: "es2020",
    dts: false,
    sourcemap: true,
  },
```

The other two entries (CJS, DTS) already lack `clean: true` — leave them as-is.

- [ ] **Step 2: Add `prebuild` to `package.json`**

Open `package.json`. Find the `"scripts"` block:

```json
  "scripts": {
    "build": "tsup",
    "build:types": "tsc --emitDeclarationOnly --outDir dist/types",
    "dev": "tsup --watch",
    "test": "vitest run && npm run test:dist",
    ...
  },
```

Insert `"prebuild"` immediately before `"build"`:

```json
  "scripts": {
    "prebuild": "node -e \"require('fs').rmSync('dist',{recursive:true,force:true})\"",
    "build": "tsup",
    "build:types": "tsc --emitDeclarationOnly --outDir dist/types",
    "dev": "tsup --watch",
    "test": "vitest run && npm run test:dist",
    ...
  },
```

npm automatically invokes the `prebuild` hook before `npm run build` runs, so no other call site needs to change. The Node one-liner is cross-platform (no `rm -rf`, no new devDep like `rimraf`); `fs.rmSync(..., {force: true})` is idempotent — first build (no `dist/`) succeeds silently.

- [ ] **Step 3: Verify the build is clean and deterministic**

```bash
npm run build
ls dist/
```

Expected: `dist/cjs/  dist/esm/  dist/types/` — all three subdirs populated with their respective bundles. No "no such file" or other errors.

Run again to confirm the wipe-and-repopulate is idempotent:

```bash
npm run build
ls dist/esm/ dist/cjs/ dist/types/
```

Expected: same three subdirs populated, same file sizes (within a byte or two for timestamp variation).

- [ ] **Step 4: Run the full test suite to confirm nothing regressed**

```bash
npm test
```

Expected: `Tests  267 passed (267)` (phase 1) and `Tests  7 passed (7)` (phase 2 — dist smoke tests, which depend on a fresh build).

- [ ] **Step 5: Lint**

```bash
npm run lint
```

Expected: clean exit.

- [ ] **Step 6: Commit**

```bash
git add tsup.config.ts package.json
git commit -m "fix(build): move tsup clean to prebuild script to avoid concurrent-writer race (#2)"
```

---

## Task 3: Add `.github/workflows/ci.yml` (#36)

**Files:**
- Create: `.github/workflows/ci.yml`

The workflow runs `lint + build + test` on a Node 18/20/22 matrix for every PR and every push to `main`. No changes to the existing release workflow at `.github/workflows/npm-publish.yml`.

- [ ] **Step 1: Verify the `.github/workflows/` directory exists and inspect the existing workflow**

```bash
ls .github/workflows/
```

Expected: `npm-publish.yml` exists. We will add a sibling `ci.yml` — do not touch `npm-publish.yml`.

- [ ] **Step 2: Create `.github/workflows/ci.yml`**

Write the following content to `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    name: lint + build + test (Node ${{ matrix.node-version }})
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node-version: [18, 20, 22]
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Node ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Build
        run: npm run build

      - name: Test
        run: npm test
```

Notes on the choices:

- `fail-fast: false` so a failure on one Node version doesn't cancel the others — easier to triage matrix-specific regressions.
- `cache: npm` keys `setup-node`'s cache on `package-lock.json`, cutting cold-start install time from ~30s to a few seconds on warm runs.
- `npm test` (rather than `npm run test:unit`) runs the full two-phase suite: vitest + dist smoke tests. The dist phase depends on `npm run build` having populated `dist/`, which the previous step guarantees.
- `ubuntu-latest` only — Windows / macOS matrices are out of scope per the issue body (#36 only lists Node versions, not OS).

- [ ] **Step 3: Validate YAML syntax locally**

If `yamllint` is available, run it. Otherwise, run a no-op Node YAML parse to catch syntax errors before pushing:

```bash
node -e "const yaml=require('node:fs').readFileSync('.github/workflows/ci.yml','utf8'); console.log('bytes=',yaml.length)"
```

Expected: `bytes= <a number around 700–900>`. The lack of error confirms the file is readable; GitHub Actions will validate the workflow grammar when the file lands on a branch.

Alternatively, run `gh workflow view` after pushing — but pushing is Task 4's job.

- [ ] **Step 4: Confirm `npm ci` works against the current lockfile**

This is what CI will run on a fresh checkout. Validate locally:

```bash
rm -rf node_modules
npm ci 2>&1 | tail -5
```

Expected: `added <N> packages, and audited ...` with no errors. (If there's any error, `npm ci` is stricter than `npm install` — the lockfile must match `package.json` exactly. Fix any drift before pushing.)

Then re-verify the suite still passes:

```bash
npm run lint && npm run build && npm test
```

Expected: lint clean, build succeeds, `Tests  267 passed (267)` and `Tests  7 passed (7)`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add PR-validation workflow on Node 18/20/22 (#36)"
```

---

## Task 4: Final verification + push + PR

**Files:** none modified — verification and PR creation only.

- [ ] **Step 1: Confirm commit history**

```bash
git log --oneline origin/main..HEAD
```

Expected 3 commits (newest first):

1. `ci: add PR-validation workflow on Node 18/20/22 (#36)`
2. `fix(build): move tsup clean to prebuild script to avoid concurrent-writer race (#2)`
3. `docs: mark wave 5 done; add wave 6 ci-and-build-cleanup plan (#36, #2)`

- [ ] **Step 2: Run the full pipeline one more time**

```bash
npm run lint
npm run build
npm test
```

All three should succeed cleanly. If any fail, fix before pushing.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin feat/36-2-ci-and-build-cleanup
```

Expected: new branch on remote, no force-push (this is a new branch). Output includes a PR-creation URL.

- [ ] **Step 4: Open the PR**

```bash
gh pr create --base main \
  --title "ci: PR-validation workflow + tsup clean-step deflake (#36, #2)" \
  --body "$(cat <<'EOF'
## Summary
Closes #36.
Closes #2.

- **#36 CI:** new `.github/workflows/ci.yml` runs `lint + build + test` on every PR and every push to \`main\`. Matrix over Node \`[18, 20, 22]\` so multi-version fetch/http edge cases get caught before merge. \`fail-fast: false\` so matrix-specific regressions are individually triageable. \`cache: npm\` keys on \`package-lock.json\` for warm-cache speed.
- **#2 build race:** dropped \`clean: true\` from the ESM entry in \`tsup.config.ts\` and added a \`prebuild\` npm script (\`node -e "fs.rmSync('dist',{recursive:true,force:true})"\`) that wipes \`dist/\` deterministically before \`tsup\`'s three concurrent writers start. No new devDep.

This wave will be the first to land with CI gating. Once it merges, every subsequent PR (including future waves) gets lint+build+test enforcement automatically.

## Tests
- No new vitest tests. CI is a runtime/build concern; the prebuild change is verified by \`npm run build\` succeeding repeatedly with a clean \`dist/\`.
- Baseline 267 + 7 unchanged after this PR.

## Test plan
- [ ] CI's own first run on this PR passes on all three Node versions.
- [ ] Manual smoke: \`rm -rf node_modules dist && npm ci && npm run lint && npm run build && npm test\` locally on a fresh checkout — confirm the full pipeline.
- [ ] Manual smoke: \`npm run build && npm run build\` back-to-back — confirm the second build wipes \`dist/\` cleanly and reproduces identical artifacts.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed to stdout.

- [ ] **Step 5: Watch the first CI run**

After the PR opens, CI will trigger immediately. Monitor with:

```bash
gh pr checks --watch
```

Expected: three matrix jobs (Node 18, 20, 22), all green. If any fails, address the failure and push the fix to the same branch.

---

## Self-review hand-off

After Task 4 completes, the wave is done from this plan's perspective. CodeRabbit will pick up the PR push and provide its independent review.

Any follow-ups (CodeRabbit findings or first-CI-run failures) land as additional commits on the same branch before merge. Do not amend merged commits.
