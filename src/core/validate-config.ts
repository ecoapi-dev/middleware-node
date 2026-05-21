/**
 * validateConfig — synchronous pre-flight checks on RecostConfig.
 *
 * Called at the top of init() so misconfiguration fails fast with an
 * actionable message, instead of silently entering a broken cloud-mode
 * state that drops every telemetry window.
 *
 * Rules (in evaluation order):
 *   1. If `apiKey` is set, it must be a string beginning with "rc-".
 *   2. If `apiKey` is set, `projectId` must be a non-empty, non-whitespace string.
 *
 * Local mode (no apiKey) intentionally requires no projectId — the local
 * extension demultiplexes via the WebSocket connection identity, not the
 * payload's projectId field.
 */

import type { RecostConfig } from "./types.js";

/** Throws if `config` would cause the SDK to enter a known-broken state. */
export function validateConfig(config: RecostConfig): void {
  if (config.apiKey !== undefined) {
    if (typeof config.apiKey !== "string" || !config.apiKey.startsWith("rc-")) {
      const preview =
        typeof config.apiKey === "string"
          ? `"${config.apiKey.slice(0, 8)}..."`
          : `<${typeof config.apiKey}>`;
      throw new Error(
        `recost: apiKey must be a string beginning with "rc-". Got: ${preview}. ` +
          `If you're reading from an env var, confirm RECOST_API_KEY is set; ` +
          `a literal string "undefined" from a missing variable is a common cause.`,
      );
    }
    if (
      typeof config.projectId !== "string" ||
      config.projectId.trim() === ""
    ) {
      throw new Error(
        `recost: projectId is required when apiKey is set (cloud mode). ` +
          `Get a project ID from your dashboard at https://recost.dev/dashboard/projects`,
      );
    }
  }

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

  if (config.excludePatterns !== undefined) {
    for (let i = 0; i < config.excludePatterns.length; i++) {
      const p = config.excludePatterns[i];
      if (typeof p !== "string") {
        throw new Error(
          `recost: excludePatterns[${i}] must be a string. Got: ${JSON.stringify(p)}.`,
        );
      }
      // Empty/whitespace patterns would make startsWith() match everything,
      // silently excluding all telemetry. Fail fast.
      if (p.trim() === "") {
        throw new Error(
          `recost: excludePatterns[${i}] must be a non-empty string. ` +
            `Pass a URL prefix (e.g. "https://api.example.com/v1/private") or an exact hostname.`,
        );
      }
    }
  }
}
