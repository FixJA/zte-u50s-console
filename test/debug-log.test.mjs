import test from "node:test";
import assert from "node:assert/strict";
import { createDebugLogger, isDebugEnabled, redactDebugObject } from "../lib/debug-log.mjs";

test("debug flag accepts explicit enabled values", () => {
  for (const value of ["1", "true", "TRUE", "yes", "on", " On "]) {
    assert.equal(isDebugEnabled(value), true);
  }
});

test("debug flag rejects empty and disabled values", () => {
  for (const value of [undefined, "", "0", "false", "off", "no"]) {
    assert.equal(isDebugEnabled(value), false);
  }
});

test("debug redaction hides nested sensitive fields", () => {
  const redacted = redactDebugObject({
    password: "secret",
    AD: "ad-secret",
    nested: {
      RD: "rd-secret",
      values: [{ token: "confirm-secret" }, { safe: "ok" }],
    },
  });

  assert.deepEqual(redacted, {
    password: "<redacted>",
    AD: "<redacted>",
    nested: {
      RD: "<redacted>",
      values: [{ token: "<redacted>" }, { safe: "ok" }],
    },
  });
});

test("debug logger stays quiet when disabled", () => {
  const lines = [];
  const debugLog = createDebugLogger({ enabled: false, sink: (line) => lines.push(line) });

  debugLog("test", "不会输出", { password: "secret" });

  assert.deepEqual(lines, []);
});
