# @recost-dev/node

Node.js SDK for [ReCost](https://recost.dev) — automatically tracks outbound HTTP API calls from your application and reports cost, latency, and usage patterns to the ReCost dashboard or your local VS Code extension.

## How it works

The SDK monkey-patches `fetch`, `http.request`, and `https.request` to intercept outbound requests at runtime. It captures metadata only (URL, method, status, latency, byte sizes — never headers or bodies), matches each request against a built-in provider registry, aggregates events into time-windowed summaries, and ships those summaries either to the ReCost cloud API or to the ReCost VS Code extension running locally.

```
Your app
  └─ fetch("https://api.openai.com/v1/chat/completions", ...)
       │
       ▼
  Interceptor               ← patches globalThis.fetch, http.request, https.request
       │  RawEvent { host, path, method, statusCode, latencyMs, ... }
       ▼
  ProviderRegistry          ← matches host/path → provider + endpointCategory + cost
       │
       ▼
  Aggregator                ← buffers events, flushes WindowSummary every 30s
       │
       ▼
  Transport
    ├─ local mode  → File (JSONL @ ~/.recost/local-telemetry by default)
    │                 or WebSocket (set localTransport: "ws", port 9847)
    └─ cloud mode  → HTTPS POST → api.recost.dev
```

## Installation

```bash
npm install @recost-dev/node
```

## Quick start

### Local mode

No API key needed. Telemetry is written to a local NDJSON file by default (see [Local mode](#local-mode-1) for details and the optional WebSocket sub-mode).

```ts
import { init } from "@recost-dev/node";

init(); // all defaults — local mode writes to ~/.recost/local-telemetry/default.jsonl
        // (file name is `${projectId}.jsonl`; defaults to "default" when projectId is unset)
```

### Cloud mode

```ts
import { init } from "@recost-dev/node";

init({
  apiKey: process.env.RECOST_API_KEY,
  projectId: process.env.RECOST_PROJECT_ID,
  environment: process.env.NODE_ENV ?? "development",
});
```

### Express

```ts
import express from "express";
import { createExpressMiddleware } from "@recost-dev/node";

const app = express();
app.use(createExpressMiddleware({ apiKey: process.env.RECOST_API_KEY }));
```

### Fastify

```ts
import Fastify from "fastify";
import { createFastifyPlugin } from "@recost-dev/node";

const app = Fastify();
await app.register(createFastifyPlugin, { apiKey: process.env.RECOST_API_KEY });
```

## Configuration

All fields are optional.

| Option | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | — | ReCost API key (`rc-...`). If omitted, runs in local mode. |
| `projectId` | `string` | — | ReCost project ID. Required in cloud mode. |
| `environment` | `string` | `"development"` | Environment tag attached to all telemetry. |
| `flushIntervalMs` | `number` | `30000` | Milliseconds between automatic flushes. |
| `maxBatchSize` | `number` | `100` | Early-flush threshold (number of events). |
| `maxBuckets` | `number` | `2000` | Maximum unique `(provider, endpoint, method)` triplets per window. Crossing this triggers an early flush so the cloud API does not reject the payload with a 422. |
| `localTransport` | `"file" \| "ws"` | `"file"` | Local-mode sub-mode. `"file"` writes NDJSON to disk (default); `"ws"` opens a WebSocket to a localhost consumer. |
| `localDir` | `string` | `~/.recost/local-telemetry` | File sub-mode only — directory for `${projectId}.jsonl`. Also honors `RECOST_LOCAL_DIR`. |
| `maxFileBytes` | `number` | `10000000` | File sub-mode only — rotate to `.jsonl.1` once the active file exceeds this many bytes. Disk usage bounded at ~2×. |
| `maxLocalFileQueueSize` | `number` | `1000` | File sub-mode only — in-memory frames buffered when disk writes fail. FIFO overflow fires `onError` once per episode. |
| `localPort` | `number` | `9847` | WS sub-mode only — WebSocket port for the local consumer (e.g. VS Code extension). |
| `debug` | `boolean` | `false` | Log telemetry activity to stdout. |
| `enabled` | `boolean` | `true` | Master kill switch. Set `false` to disable in tests. |
| `customProviders` | `ProviderDef[]` | `[]` | Extra provider rules merged with built-ins; sorted by specificity (longer `pathPrefix` wins; on tie, custom beats built-in). |
| `excludePatterns` | `string[]` | `[]` | URL prefixes or exact hostnames. Matches when `event.url.startsWith(pattern)` OR `event.host === pattern`. No substring matching. |
| `baseUrl` | `string` | `"https://api.recost.dev"` | Override for self-hosted deployments. |
| `maxRetries` | `number` | `3` | Retry attempts for failed cloud flushes. |
| `maxWsQueueSize` | `number` | `1000` | Local mode only — maximum serialized `WindowSummary` payloads buffered while the VS Code extension is unreachable. When full, the oldest payload is dropped (FIFO) and `onError` fires exactly once per overflow episode. The flag resets when the queue drains to empty (extension reconnects). |
| `maxConsecutiveAuthFailures` | `number` | `5` | Consecutive 401 responses after which the cloud transport is suspended for the lifetime of the process. See "Auth failures" below. |
| `maxConsecutiveReconnectFailures` | `number` | `20` | Consecutive failed WebSocket reconnect attempts after which the local transport is paused for the lifetime of the process. See "Local-mode unavailability" below. |
| `shutdownFlushTimeoutMs` | `number` | `3000` | Milliseconds `dispose()` waits for the final shutdown flush to complete before closing the transport. |
| `onError` | `(err: Error) => void` | — | Called on internal SDK errors. |

### Validation

`init()` validates the config synchronously and throws if it would put the SDK in a known-broken state:

**Cloud-mode rules (only checked when `apiKey` is set):**
- `apiKey` must be a string starting with `rc-`. The literal string `"undefined"` (a common env-var misread) is rejected.
- `projectId` is required and must be non-empty.

**Rules checked in both modes (file transport applies even without `apiKey`):**
- `localTransport`, if set, must be `"ws"` or `"file"`.
- `localDir`, if set, must be a non-empty string.
- `maxFileBytes`, if set, must be a positive integer ≥ 1024.
- `maxLocalFileQueueSize`, if set, must be a positive integer.
- `excludePatterns` entries must be non-empty strings (an empty entry would silently exclude every event).

Wrap `init()` in a try/catch if a misconfigured environment should not crash your host process.

### Auth failures

If `api.recost.dev` returns 401 (invalid or revoked `apiKey`), the SDK:

1. Logs a one-time warning to `stderr` on the first 401: `[recost] HTTP 401 — API key rejected. Telemetry will stop after 5 consecutive failures. Check your apiKey at https://recost.dev/dashboard/account.`
2. Calls `onError(new RecostAuthError(401, n))` on every 401, where `n` is the consecutive-failure count.
3. After `maxConsecutiveAuthFailures` (default 5) consecutive 401s, suspends the cloud transport for the lifetime of the process, logs a second `stderr` line announcing the suspension, and calls `onError(new RecostFatalAuthError(401, n))`. Subsequent `init`/`send` calls in this process are silent no-ops on the cloud transport.

Recovery is restart-only: update `apiKey` in your config and restart the process. The counter resets on any non-401 outcome (success, 403/404/422, 5xx after retries, network error), so transient outages do not accumulate toward the threshold.

Hosts can route auth failures separately from other errors by narrowing on the error class:

```ts
import { init, RecostAuthError, RecostFatalAuthError } from "@recost-dev/node";

init({
  apiKey: process.env.RECOST_API_KEY,
  projectId: process.env.RECOST_PROJECT_ID,
  onError(err) {
    if (err instanceof RecostFatalAuthError) pagerduty.fire(err);
    else if (err instanceof RecostAuthError) log.warn(err);
    else log.debug(err);
  },
});
```

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

### Local-mode unavailability

**WS sub-mode (`localTransport: "ws"`):** the SDK reconnects on disconnect with exponential backoff (500 ms → 30 s, ±25 % jitter). If the consumer (e.g. VS Code extension) is never running, the SDK would otherwise spin forever. Instead:

1. After `maxConsecutiveReconnectFailures` (default 20) consecutive failed reconnect attempts, the SDK pauses the local transport for the lifetime of the process.
2. Logs a one-time warning to `stderr`: `[recost] local WebSocket unreachable after 20 consecutive reconnect attempts. Restart the process after starting the VS Code extension.`
3. Calls `onError(new RecostLocalUnreachableError(n))` exactly once, where `n` is the consecutive-failure count at the trip.
4. Subsequent `send()` calls are silent no-ops on the local transport.

Recovery is restart-only: start the VS Code extension, then restart your host process. The counter resets on any successful WebSocket connect, so transient extension restarts do not accumulate toward the threshold.

Hosts can route local-unreachable separately from auth failures by narrowing on the error class:

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
  projectId: process.env.RECOST_PROJECT_ID,
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

### Custom providers

```ts
init({
  customProviders: [
    {
      hostPattern: "api.internal.acme.com",
      pathPrefix: "/payments",
      provider: "acme-payments",
      endpointCategory: "charge",
      costPerRequestCents: 0.5,
    },
  ],
});
```

### Custom provider priority

Custom and built-in rules are merged and sorted by specificity at `ProviderRegistry` construction time. The sort is:

1. Rules with a `pathPrefix` come before rules without.
2. Longer `pathPrefix` wins (more specific).
3. Exact host beats `*.` wildcard host.
4. On equal specificity, custom rules win.

So a custom catch-all (`{ hostPattern: "api.openai.com", provider: "openai-mock" }` with no `pathPrefix`) does NOT shadow built-in path-specific OpenAI rules — those are more specific. A custom rule with `pathPrefix: "/v1/chat/completions"` on the same host DOES override the built-in (equal specificity → custom wins).

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

### Worker threads

`init()` patches `fetch`, `http`, and `https` for the worker that calls it. Workers spawned via `node:worker_threads` get their own module instances and their own `globalThis`, so they will not be instrumented until you call `init()` inside the worker's own entry point. SDK errors thrown in a worker route through that worker's own `onError`.

```ts
// In worker.ts (the worker entry point)
import { init } from "@recost-dev/node";

init({ apiKey: process.env.RECOST_API_KEY });

// …rest of worker logic…
```

The main thread's `init()` does not propagate to workers, and the SDK does not detect or warn about worker spawns — instrumenting workers is the host's responsibility.

### Disabling in tests

```ts
init({ enabled: process.env.NODE_ENV !== "test" });
```

## Supported providers

The registry ships with built-in rules for these providers. Cost estimates are rough per-request averages for relative comparison — actual costs vary by model, token count, and region.

| Provider | Host | Tracked endpoints | Cost estimate |
|---|---|---|---|
| **OpenAI** | `api.openai.com` | chat completions, embeddings, image generation, audio transcription, TTS | 0.01–4.0¢/req |
| **Anthropic** | `api.anthropic.com` | messages | 1.5¢/req |
| **Stripe** | `api.stripe.com` | charges, payment intents, customers, subscriptions | 0¢ (% billing) |
| **Twilio** | `api.twilio.com` | SMS, voice calls | 0.79–1.3¢/req |
| **SendGrid** | `api.sendgrid.com` | mail send | 0.1¢/req |
| **Pinecone** | `*.pinecone.io` | vector upsert, query | 0.08¢/req |
| **AWS** | `*.amazonaws.com` | all services (wildcard) | 0¢ (complex pricing) |
| **Google Cloud** | `*.googleapis.com` | all services (wildcard) | 0¢ (complex pricing) |

Unrecognized hosts produce a `RawEvent` with `provider: null` — they still appear in telemetry grouped under `"unknown"`.

### Using the registry directly

```ts
import { ProviderRegistry, BUILTIN_PROVIDERS } from "@recost-dev/node";

// Default registry (built-ins only)
const registry = new ProviderRegistry();
const result = registry.match("https://api.openai.com/v1/chat/completions");
// → { provider: "openai", endpointCategory: "chat_completions", costPerRequestCents: 2 }

// Registry with custom rules — priority by specificity, custom wins on tie
const custom = new ProviderRegistry([
  { hostPattern: "api.acme.com", provider: "acme", endpointCategory: "api", costPerRequestCents: 0.1 },
]);

// Inspect all loaded rules
console.log(BUILTIN_PROVIDERS.length); // 34 built-in rules
```

## What is captured (and what is not)

**Captured:**
- Request timestamp, method, URL (query params stripped), host, path
- Response status code
- Round-trip latency (ms) — measured to **end of response body**, identically for `fetch` and `http.request` / `https.request`. For a streaming response this is the full stream duration, not time-to-first-byte.
- Request and response body size (bytes) — for streamed / chunked responses where the server does not send a `Content-Length` header, the SDK accumulates the observed byte count as the response body is transmitted. Bodyless responses (e.g. 204, 304, HEAD) fall back to the `Content-Length` header (typically 0).
- Matched provider, endpoint category, and estimated cost

**Never captured:**
- Request or response headers (contain API keys)
- Request or response body content (may contain user data or PII) — the SDK observes byte counts via a passthrough stream but never reads chunk contents.

## Core types and errors

Type-only imports (no runtime cost):

```ts
import type {
  RawEvent,
  MetricEntry,
  WindowSummary,
  RecostConfig,
  ProviderDef,
  TransportMode,
  FlushStatus,
  InterceptorBinding,
} from "@recost-dev/node";
```

Runtime error classes — narrow `onError` on these via `instanceof`:

```ts
import {
  RecostError,
  RecostAuthError,
  RecostFatalAuthError,
  RecostLocalUnreachableError,
  RecostLocalDiskError,
  RecostInterceptorAlreadyInstalledError,
  RecostInterceptorPatchOverwrittenError,
} from "@recost-dev/node";
```

All error classes extend `RecostError`, which extends `Error`. See [src/core/types.ts](src/core/types.ts) for the full type documentation.

## Testing

Run the full test suite (305 tests across 12 files):

```bash
npm test
```

Watch mode during development:

```bash
npm run test:watch
```

TypeScript type-check only (does not run tests):

```bash
npm run lint
```

### Test coverage

| File | Tests | What is covered |
|---|---|---|
| `tests/provider-registry.test.ts` | 50 | All 34 built-in rules, wildcard host matching, Twilio path refinement, edge cases (empty string, explicit port, query params), custom priority, specificity-based ordering, `BUILTIN_PROVIDERS` array ordering, pinned-count regression |
| `tests/interceptor.test.ts` | 60 | Lifecycle (install/uninstall/isInstalled), fetch/http.request/http.get capture, query stripping, URL/Request object inputs, safety wrappers, `getRawFetch` bypass, double-count guard, multi-realm install detection, identity-check restore on uninstall, IPv6 host preservation |
| `tests/aggregator.test.ts` | 38 | Flush/reset, event grouping, p50/p95 percentile edge cases, null provider/endpoint fallbacks, window timestamps, metadata forwarding, size/bucketCount tracking, soft bucket cap via `_overflow` bucket |
| `tests/transport.test.ts` | 39 | Cloud POST (URL, auth header, 4xx no-retry, 5xx retry + recovery, `onError`); 401 lifecycle (`RecostAuthError` → `RecostFatalAuthError`, counter reset rules); WebSocket send / queue-and-drain / FIFO overflow / reconnect-failure threshold (`RecostLocalUnreachableError`); rejection signalling |
| `tests/file-transport.test.ts` | 16 | NDJSON appends with `protocolVersion`, file mode `0o600` on POSIX, rotation at `maxFileBytes`, in-memory queue + drain on disk-write failure, `RecostLocalDiskError` once-per-episode |
| `tests/validate-config.test.ts` | 28 | `apiKey` prefix + `"undefined"` rejection, `projectId` required in cloud mode, `localTransport` allowed values, `localDir` / `maxFileBytes` / `maxLocalFileQueueSize` bounds, empty `excludePatterns` rejection |
| `tests/init.test.ts` | 38 | Interceptor install/dispose, `enabled: false`, double-init, event enrichment, unknown provider grouping, exclude patterns, auto-exclude transport URL, flush interval, early batch flush, `flush()` handle method, dispose-then-flush, environment forwarding |
| `tests/contract.test.ts` | 11 | Wire-format contract: serialized `WindowSummary` shape, field names, types, `windowStart` / `windowEnd` ms-precision-with-Z timestamp format |
| `tests/express.test.ts` | 7 | Middleware arity, `next()` called without error, config forwarding |
| `tests/fastify.test.ts` | 6 | `done()` called, config forwarding |
| `tests/scaffold.test.ts` | 5 | Public export smoke tests |
| `tests/dist.test.ts` | 7 | Built `dist/` smoke — emitted files exist; CJS (`dist/cjs/index.cjs`) and ESM (`dist/esm/index.js`) load and re-export the public surface; `package.json` `main` and `types` paths resolve |

## Implementation status

| Module | Status |
|---|---|
| `core/types.ts` | Shared interfaces (`RawEvent`, `MetricEntry`, `WindowSummary`, `RecostConfig`, `TransportBackend`, `FlushStatus`) and the `RecostError` class hierarchy |
| `core/provider-registry.ts` | 34 built-in rules across 14 providers, wildcard host matching, specificity-based sort (custom wins on tie) |
| `core/interceptor.ts` | Patches `fetch`, `http.request` / `.get`, `https.request` / `.get`; double-count guard; safety wrappers; multi-realm install detection; identity-check restore on uninstall |
| `core/aggregator.ts` | Time-windowed bucketing, p50/p95 percentiles, cost aggregation, soft `maxBuckets` cap via `_overflow` bucket |
| `core/validate-config.ts` | Synchronous pre-flight rules — `apiKey` shape, `projectId` requirement, local-transport bounds, `excludePatterns` non-empty entries |
| `core/transport.ts` | Backend selector — picks `CloudBackend`, `WsBackend`, or `FileBackend` based on config; owns bucket-overflow chunking |
| `core/transport-cloud.ts` | HTTPS POST with exponential-backoff retry; 401 → `RecostAuthError` → `RecostFatalAuthError` lifecycle |
| `core/transport-ws.ts` | WebSocket to localhost with queue + drain, exponential-backoff reconnect (±25% jitter), pause after `maxConsecutiveReconnectFailures` |
| `core/transport-file.ts` | NDJSON appends to `${localDir}/${projectId}.jsonl` (file mode `0o600` on POSIX), rotation at `maxFileBytes`, in-memory queue on write failure |
| `init.ts` | Wires all modules; resolves transport mode; returns handle with async `dispose()` (final flush, bounded by `shutdownFlushTimeoutMs`) and `flush()` (Python `flush_blocking()` parity) |
| `frameworks/express.ts` | Thin wrapper around `init()` |
| `frameworks/fastify.ts` | Thin wrapper around `init()` |

## API reference

All requests go to `https://api.recost.dev`. Authentication uses an `rc-` prefixed API key passed as `Authorization: Bearer {apiKey}`.

### Send telemetry manually (what the SDK does on flush)

```bash
curl -s -X POST https://api.recost.dev/projects/{projectId}/telemetry \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {apiKey}" \
  -d @payload.json | jq .
```

### View recent telemetry windows

```bash
curl -s "https://api.recost.dev/projects/{projectId}/telemetry/recent?limit=10" \
  -H "Authorization: Bearer {apiKey}" | jq .
```

### View analytics for a project

```bash
curl -s "https://api.recost.dev/projects/{projectId}/analytics?from=2026-01-01T00:00:00Z&to=2026-12-31T23:59:59Z" \
  -H "Authorization: Bearer {apiKey}" | jq .
```

## License

Licensed under the [Business Source License 1.1](./LICENSE). You may use this software in production, but you may not offer it as a commercial API cost tracking or monitoring service. The source code will convert to Apache 2.0 on April 1, 2030.
