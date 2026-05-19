/**
 * Interceptor — monkey-patches globalThis.fetch, http.request, https.request
 * (and their .get variants) to capture outbound request metadata as RawEvents.
 *
 * Singleton state lives on globalThis under a registry symbol so two copies
 * of @recost-dev/node loaded in the same realm coordinate. Only one set of
 * patches can be active at a time.
 * The interceptor never reads or modifies request/response bodies.
 * Every wrapper is safety-wrapped so SDK errors can never break application code.
 */

import http from "node:http";
import https from "node:https";
import { performance } from "node:perf_hooks";
import type { RawEvent } from "./types.js";
import { RecostInterceptorAlreadyInstalledError } from "./types.js";
import { isoNow } from "./time.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Callback invoked for every captured outbound HTTP request. */
export type EventCallback = (event: RawEvent) => void;

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

// ---------------------------------------------------------------------------
// URL extraction helper
// ---------------------------------------------------------------------------

interface ParsedUrl {
  url: string;   // origin + pathname only (query stripped)
  host: string;  // hostname without port
  path: string;  // pathname only
}

/**
 * Extracts a clean ParsedUrl from the various argument types accepted by
 * fetch (string | URL | Request) and http.request (string | URL | RequestOptions).
 * Returns null if parsing fails — callers should skip instrumentation in that case.
 */
function extractUrl(
  input: string | URL | http.RequestOptions | { url: string; method?: string },
  pathOverride?: string,
): ParsedUrl | null {
  try {
    let raw: string;

    if (typeof input === "string") {
      raw = input;
    } else if (input instanceof URL) {
      raw = input.toString();
    } else if (typeof input === "object" && input !== null && "url" in input && typeof (input as Request).url === "string") {
      // Request object
      raw = (input as Request).url;
    } else if (typeof input === "object" && input !== null) {
      // http.RequestOptions: reconstruct from parts
      const opts = input as http.RequestOptions;
      const protocol = opts.protocol ?? "http:";
      const hostRaw = opts.hostname ?? opts.host ?? "localhost";
      // Defensive: strip any port embedded in the host string so it does not
      // collide with a separately-specified `opts.port` (e.g. "h:8080" + 8080
      // would otherwise produce an unparseable "h:8080:8080"). The strip must
      // be IPv6-aware:
      //   - Bracketed IPv6 ("[::1]:8080"): strip ":port" after the closing "]"
      //   - Bare IPv6 ("::1"): preserve as-is (multi-colon → no strip). URL
      //     reconstruction may still fail downstream since unbracketed IPv6
      //     isn't valid in a URL, but that's a graceful null-return, not
      //     silent corruption.
      //   - Regular host/IPv4 ("host" or "host:port"): strip when exactly
      //     one colon, leave alone otherwise.
      let hostname: string;
      if (hostRaw.startsWith("[")) {
        const closeIdx = hostRaw.indexOf("]");
        hostname = closeIdx >= 0 ? hostRaw.slice(0, closeIdx + 1) : hostRaw;
      } else {
        const colonCount = (hostRaw.match(/:/g) || []).length;
        hostname = colonCount === 1
          ? hostRaw.slice(0, hostRaw.indexOf(":"))
          : hostRaw;
      }
      const port = opts.port ? `:${opts.port}` : "";
      const rawPath = opts.path ?? "/";
      // Strip query string from path for privacy
      const pathname = rawPath.includes("?") ? rawPath.slice(0, rawPath.indexOf("?")) : rawPath;
      raw = `${protocol}//${hostname}${port}${pathname}`;
    } else {
      return null;
    }

    const parsed = new URL(raw);

    // Apply the path override last, after URL parsing. The override beats the
    // URL's own pathname — this is the http.request(URL, { path }) case where
    // the second-arg options.path is the caller's actual intent.
    if (pathOverride != null && pathOverride !== "") {
      const overrideStripped = pathOverride.includes("?")
        ? pathOverride.slice(0, pathOverride.indexOf("?"))
        : pathOverride;
      return {
        url: parsed.origin + overrideStripped,
        host: parsed.hostname,
        path: overrideStripped,
      };
    }

    return {
      url: parsed.origin + parsed.pathname,
      host: parsed.hostname,
      path: parsed.pathname,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Request body size estimator (fetch)
// ---------------------------------------------------------------------------

async function estimateRequestBytes(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<number> {
  try {
    const body = init?.body;
    if (body != null) {
      if (typeof body === "string") return Buffer.byteLength(body);
      if (body instanceof ArrayBuffer) return body.byteLength;
      if (ArrayBuffer.isView(body)) return body.byteLength;
      // ReadableStream, FormData, URLSearchParams, Blob on init.body — don't
      // consume. (We can only safely consume a Request body via clone, below.)
      return 0;
    }
    // No init body — if input is a Request with a body, clone it and read the
    // cloned body. The clone tees the underlying body stream, so the original
    // Request remains intact for fetch to consume on the wire.
    if (
      typeof input === "object" &&
      input !== null &&
      !(input instanceof URL) &&
      typeof (input as Request).clone === "function" &&
      (input as Request).body != null
    ) {
      try {
        const cloned = (input as Request).clone();
        const buf = await cloned.arrayBuffer();
        return buf.byteLength;
      } catch {
        return 0;
      }
    }
    return 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// RawEvent builder
// ---------------------------------------------------------------------------

function buildEvent(
  parsed: ParsedUrl,
  method: string,
  statusCode: number,
  latencyMs: number,
  requestBytes: number,
  responseBytes: number,
): RawEvent {
  return {
    timestamp: isoNow(),
    method: method.toUpperCase(),
    url: parsed.url,
    host: parsed.host,
    path: parsed.path,
    statusCode,
    latencyMs: Math.round(latencyMs),
    requestBytes,
    responseBytes,
    provider: null,
    endpointCategory: null,
    error: statusCode === 0 || statusCode >= 400,
  };
}

// ---------------------------------------------------------------------------
// Fetch wrapper
// ---------------------------------------------------------------------------

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

  // Kick off async request-body measurement only once we know we'll record
  // an event for this fetch. Doing this before the parsed === null guard
  // would orphan a clone+arrayBuffer for requests we ultimately skip.
  requestBytesPromise = estimateRequestBytes(input, init);

  const startTime = performance.now();
  state.inFetchWrapper = true;

  try {
    const response = await state.originalFetch(input, init);

    // Capture immutable values up-front; the deferred telemetry emit and the
    // streaming body counter both run long after this scope returns.
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

    // Streaming / non-empty body: tee the body so we can count bytes
    // independently of the caller. The caller-facing branch is returned
    // in a cloned Response; the counting branch is drained internally
    // and resolves telemetry at end-of-body. This guarantees telemetry
    // fires whether the caller reads, cancels, or abandons the body.
    // fireTelemetry awaits the request-body measurement; this only delays
    // the eventual `state.callback` invocation, not the caller's fetch resolution
    // or response stream consumption.
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
    // Always reset the re-entrancy guard — a throw anywhere between
    // the `true` assignment and here would otherwise leak it permanently
    // and silently drop every future http.request event.
    state.inFetchWrapper = false;
  }
};

// ---------------------------------------------------------------------------
// http.request / https.request wrapper factory
// ---------------------------------------------------------------------------

type HttpRequestFn = typeof http.request;
type HttpGetFn = typeof http.get;

function makeRequestWrapper(originalRequest: HttpRequestFn): HttpRequestFn {
  const wrapper = function (
    urlOrOptions: string | URL | http.RequestOptions,
    optionsOrCallback?: http.RequestOptions | ((res: http.IncomingMessage) => void),
    maybeCallback?: (res: http.IncomingMessage) => void,
  ): http.ClientRequest {
    const state = getState();

    // Detached (callback nulled by uninstall, our wrapper still chained
    // under a third-party wrapper): forward to the captured `originalRequest`.
    // In the multi-realm/third-party scenario `originalRequest` may itself
    // be another library's wrapper — forwarding through it preserves the chain.
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

          // Accumulate observed bytes for chunked / no-content-length
          // responses. We do not consume data: IncomingMessage is a
          // multi-listener EventEmitter, so this listener runs alongside
          // the caller's listener with no effect on what the caller sees.
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

function makeGetWrapper(patchedRequest: HttpRequestFn): HttpGetFn {
  const wrapper = function (
    urlOrOptions: string | URL | http.RequestOptions,
    optionsOrCallback?: http.RequestOptions | ((res: http.IncomingMessage) => void),
    maybeCallback?: (res: http.IncomingMessage) => void,
  ): http.ClientRequest {
    // @ts-expect-error forwarding overloaded signature
    const req = patchedRequest(urlOrOptions, optionsOrCallback, maybeCallback);
    req.end();
    return req;
  };

  return wrapper as unknown as HttpGetFn;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Installs patches on globalThis.fetch, http.request, https.request,
 * http.get, and https.get. No-op if already installed.
 *
 * (Task 3 retains the original "no-op if installed" semantics; Task 4 adds
 * the typed-error signal and dual-package coordination.)
 */
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

/**
 * Wire a host-supplied error callback into the interceptor's state. Used by
 * `init()` to route typed interceptor errors (dual-package detection,
 * uninstall conflicts) through the user's configured `onError`. Setting to
 * `null` clears the registration.
 */
export function setOnError(cb: ((err: Error) => void) | null): void {
  getState().onError = cb;
}
