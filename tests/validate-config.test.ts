/**
 * Tests for src/core/validate-config.ts.
 *
 * validateConfig is a pure function — no servers, no patching, no async.
 * Every assertion runs in microseconds.
 */

import { describe, it, expect } from "vitest";
import { validateConfig } from "../src/core/validate-config.js";

describe("validateConfig — apiKey format", () => {
  it("accepts apiKey starting with 'rc-'", () => {
    expect(() => validateConfig({ apiKey: "rc-abc123", projectId: "proj_1" })).not.toThrow();
  });

  it("rejects apiKey not starting with 'rc-'", () => {
    expect(() => validateConfig({ apiKey: "sk-bad", projectId: "proj_1" })).toThrow(
      /apiKey must be a string beginning with "rc-"/,
    );
  });

  it("rejects the literal string 'undefined' as apiKey (common env-misread footgun)", () => {
    expect(() => validateConfig({ apiKey: "undefined", projectId: "proj_1" })).toThrow(
      /apiKey must be a string beginning with "rc-"/,
    );
  });

  it("rejects empty-string apiKey", () => {
    expect(() => validateConfig({ apiKey: "", projectId: "proj_1" })).toThrow(
      /apiKey must be a string beginning with "rc-"/,
    );
  });

  it("includes a redacted prefix in the error message so users can identify which key failed", () => {
    expect(() => validateConfig({ apiKey: "sk-abcdefghij", projectId: "proj_1" })).toThrow(
      /sk-abcde/,
    );
  });

  it("does not echo the full apiKey in the error message (avoid leaking secrets to logs)", () => {
    const fullKey = "sk-DO_NOT_LOG_THIS_FULL_KEY_PLEASE";
    try {
      validateConfig({ apiKey: fullKey, projectId: "proj_1" });
    } catch (err) {
      expect((err as Error).message).not.toContain("DO_NOT_LOG_THIS_FULL_KEY_PLEASE");
      return;
    }
    throw new Error("expected validateConfig to throw");
  });

  it("undefined apiKey is fine — local mode, no validation needed", () => {
    expect(() => validateConfig({})).not.toThrow();
  });
});

describe("validateConfig — projectId required with apiKey", () => {
  it("throws when apiKey is set but projectId is omitted", () => {
    expect(() => validateConfig({ apiKey: "rc-abc123" })).toThrow(
      /projectId is required when apiKey is set/,
    );
  });

  it("throws when apiKey is set but projectId is empty string", () => {
    expect(() => validateConfig({ apiKey: "rc-abc123", projectId: "" })).toThrow(
      /projectId is required when apiKey is set/,
    );
  });

  it("throws when apiKey is set but projectId is whitespace-only", () => {
    expect(() => validateConfig({ apiKey: "rc-abc123", projectId: "   " })).toThrow(
      /projectId is required when apiKey is set/,
    );
  });

  it("error message points to the dashboard so the user knows where to look", () => {
    expect(() => validateConfig({ apiKey: "rc-abc123" })).toThrow(
      /recost\.dev\/dashboard\/projects/,
    );
  });

  it("accepts apiKey + non-empty projectId", () => {
    expect(() => validateConfig({ apiKey: "rc-abc123", projectId: "proj_xyz" })).not.toThrow();
  });

  it("local mode (no apiKey) does not require projectId", () => {
    expect(() => validateConfig({})).not.toThrow();
    expect(() => validateConfig({ projectId: "" })).not.toThrow();
    expect(() => validateConfig({ projectId: undefined })).not.toThrow();
  });
});

describe("validateConfig — localTransport", () => {
  it("accepts 'ws'", () => {
    expect(() => validateConfig({ localTransport: "ws" })).not.toThrow();
  });
  it("accepts 'file'", () => {
    expect(() => validateConfig({ localTransport: "file" })).not.toThrow();
  });
  it("rejects an unknown value", () => {
    expect(() =>
      validateConfig({ localTransport: "tcp" as unknown as "ws" })
    ).toThrow(/localTransport must be "ws" or "file"/);
  });
});

describe("validateConfig — maxFileBytes", () => {
  it("accepts 1024", () => {
    expect(() => validateConfig({ maxFileBytes: 1024 })).not.toThrow();
  });
  it("rejects values below 1024", () => {
    expect(() => validateConfig({ maxFileBytes: 1023 })).toThrow(
      /maxFileBytes must be a positive integer >= 1024/,
    );
  });
  it("rejects non-integers", () => {
    expect(() => validateConfig({ maxFileBytes: 1024.5 })).toThrow(
      /maxFileBytes must be a positive integer/,
    );
  });
});

describe("validateConfig — maxLocalFileQueueSize", () => {
  it("accepts 1", () => {
    expect(() => validateConfig({ maxLocalFileQueueSize: 1 })).not.toThrow();
  });
  it("rejects 0", () => {
    expect(() => validateConfig({ maxLocalFileQueueSize: 0 })).toThrow(
      /maxLocalFileQueueSize must be a positive integer/,
    );
  });
});

describe("validateConfig — localDir", () => {
  it("accepts a non-empty string", () => {
    expect(() => validateConfig({ localDir: "/tmp/recost" })).not.toThrow();
  });
  it("rejects an empty string", () => {
    expect(() => validateConfig({ localDir: "" })).toThrow(
      /localDir must be a non-empty string/,
    );
  });
});
