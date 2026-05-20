# @recost/node — Node.js Middleware

Node.js SDK that automatically tracks outbound HTTP API calls, matches them against a built-in provider registry, aggregates events into time-windowed summaries, and ships telemetry to the ReCost cloud API or VS Code extension.

## Tech Stack

- **TypeScript** — strict mode, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`
- **tsup** — dual ESM + CJS output (`dist/esm/`, `dist/cjs/`)
- **vitest** — unit testing (~291 tests across 12 files, +7 dist smoke)
- **Node.js ≥ 20** (vitest 4 requires `node:util.styleText`, added in Node 20)
- **ws** — WebSocket client for local transport mode

## Project Structure

```
src/
  index.ts                # Public API surface (re-exports only)
  init.ts                 # Main entry point — wires interceptor, registry, aggregator, transport
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
  frameworks/
    express.ts            # Express middleware adapter (thin wrapper around init())
    fastify.ts            # Fastify plugin adapter (thin wrapper around init())
tests/
  scaffold.test.ts        # 5 smoke tests
  provider-registry.test.ts  # 42 tests — all 34 providers, wildcards, Twilio refinement, custom priority, pinned-count regression
  interceptor.test.ts     # 32 tests — lifecycle, capture, query stripping, safety wrappers, double-count guard
  aggregator.test.ts      # 34 tests — flush/reset, grouping, percentiles, null provider handling
  transport.test.ts       # 19 tests — cloud POST, WebSocket, retry logic, rejection signalling
  file-transport.test.ts  # 15 tests — file backend semantics
  validate-config.test.ts # synchronous pre-flight checks
  init.test.ts            # 23 tests — integration: enrichment, exclude patterns, flush, dispose
  contract.test.ts        # 9 tests — serialized WindowSummary wire-format contract
  express.test.ts         # 6 tests — middleware arity, next(), config forwarding
  fastify.test.ts         # 4 tests — done(), config forwarding
  dist.test.ts            # 7 tests — dist smoke (ESM + CJS surface)
tsup.config.ts            # Dual ESM + CJS build config
tsconfig.json             # ES2020, bundler moduleResolution, strict
vitest.config.ts
package.json
LICENSE
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Dual ESM + CJS build via tsup |
| `npm run build:types` | Emit `.d.ts` declarations only |
| `npm run dev` | Watch mode build |
| `npm run test` | Run tests once (174 tests) |
| `npm run test:watch` | Watch mode tests |
| `npm run lint` | TypeScript type-check only (`--noEmit`) |

## Architecture Notes

- **`src/index.ts`** is the sole public API surface — only add exports here when something is ready for consumers
- **`core/types.ts`** defines all shared interfaces; never import from implementation files to avoid circular deps
- **Dual output**: tsup emits ESM to `dist/esm/` and CJS to `dist/cjs/`; `package.json` exports map selects the right one
- All `.js` extensions in imports are intentional — required for ESM output compatibility
- **Framework adapters** are thin wrappers; heavy logic lives in core and is reused across adapters
- **Interceptor** uses `getRawFetch()` to get the original unpatched fetch for SDK internal transport (avoids self-instrumentation)
- **Transport auto-excludes** its own endpoint URL from interception to prevent feedback loops
- **Timer.unref()** used on flush interval to avoid keeping the Node.js process alive
- **Safety wrappers** around all interception callbacks prevent SDK errors from breaking the host application
- **init()** returns a handle with `dispose()` that stops interception, cancels timers, and closes transport

## Provider Registry

34 built-in rules covering 14 providers:
- **AI**: OpenAI (6 endpoints), Anthropic
- **Payments**: Stripe (4 endpoints)
- **Communication**: Twilio (SMS + voice with path refinement), SendGrid
- **Infrastructure**: Pinecone, AWS (wildcard), Google Cloud (wildcard)
- **Other**: GitHub, CoinGecko, Hacker News, wttr.in, ZenQuotes, ip-api

Custom and built-in rules are merged and sorted by specificity at construction time: rules with a `pathPrefix` come before those without, longer `pathPrefix` wins, exact host beats `*.` wildcard, and on equal specificity custom rules win. So a custom catch-all does not shadow built-in path-specific rules, but a custom rule with an equal-or-more-specific `pathPrefix` overrides the built-in. Unrecognized hosts are grouped under `"unknown"`, and host-only catch-all matches return `"other"` as the endpoint category.

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
