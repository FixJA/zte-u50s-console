const DEBUG_ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);
const REDACTED = "<redacted>";
const SENSITIVE_KEYS = new Set([
  "ad",
  "authorization",
  "cookie",
  "confirmtoken",
  "ld",
  "password",
  "rd",
  "set-cookie",
  "token",
]);

export function isDebugEnabled(value = process.env.ZTE_DEBUG) {
  return DEBUG_ENABLED_VALUES.has(String(value || "").trim().toLowerCase());
}

export function createDebugLogger({ enabled = isDebugEnabled(), sink = console.log } = {}) {
  return (scope, message, data) => {
    if (!enabled) return;
    writeDebugLog(sink, scope, message, data);
  };
}

export function debugLog(scope, message, data) {
  createDebugLogger()(scope, message, data);
}

export function redactDebugValue(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactDebugValue(item, seen));
  return redactDebugObject(value, seen);
}

export function redactDebugObject(value, seen = new WeakSet()) {
  const result = {};
  for (const [key, child] of Object.entries(value || {})) {
    if (isSensitiveKey(key)) {
      result[key] = REDACTED;
      continue;
    }
    result[key] = redactDebugValue(child, seen);
  }
  return result;
}

function writeDebugLog(sink, scope, message, data) {
  const prefix = `[debug][${scope}] ${message}`;
  if (data === undefined) {
    sink(prefix);
    return;
  }
  sink(`${prefix} ${JSON.stringify(redactDebugValue(data))}`);
}

function isSensitiveKey(key) {
  return SENSITIVE_KEYS.has(String(key).toLowerCase());
}
