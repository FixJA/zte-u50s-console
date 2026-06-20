import http from "node:http";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDebugLogger } from "./lib/debug-log.mjs";
import { RouterClient } from "./lib/router-client.mjs";
import { saveCredentials, loadCredentials, clearCredentials } from "./lib/credentials-store.mjs";
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  buildDisableThermalPayload,
  buildLock4gPayload,
  buildLock5gCellPayload,
  buildLock5gPayload,
  buildSetNetworkModePayload,
  buildRebootPayload,
  buildThermalSwitchPayload,
  buildUnlock5gCellPayload,
  buildWifiSwitchPayload,
  buildWpsPbcPayload,
  publicConfig,
} from "./lib/zte-protocol.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const host = process.env.HOST || DEFAULT_HOST;
const port = Number(process.env.PORT || DEFAULT_PORT);
const router = new RouterClient();
const debugLog = createDebugLogger();
const pendingActions = new Map();
const KEEPALIVE_INTERVAL_MS = 30_000;
let keepaliveTimer = null;

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    sendJson(res, statusFromError(error), { ok: false, message: error.message || "请求失败" });
  }
});

export function startServer(options = {}) {
  const host = options.host ?? process.env.HOST ?? DEFAULT_HOST;
  const port = options.port ?? Number(process.env.PORT || DEFAULT_PORT);
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host, async () => {
      const { address, port: actualPort } = server.address();
      const url = `http://${address}:${actualPort}`;
      console.log(`ZTE 5G debug console: ${url}`);
      console.log(`Router target: ${router.baseUrl}`);
      await attemptAutoLogin();
      resolve({ url, close: () => server.close() });
    });
  });
}

async function attemptAutoLogin() {
  let creds;
  try {
    creds = await loadCredentials();
  } catch (err) {
    console.warn("[boot] 凭证文件已损坏, 清除:", err.message);
    try { await clearCredentials(); } catch (_) {}
    return;
  }
  if (!creds) return;
  try {
    if (creds.routerBaseUrl && creds.routerBaseUrl !== router.baseUrl) {
      router.setBaseUrl(creds.routerBaseUrl);
      console.log(`[boot] 已恢复路由器地址: ${router.baseUrl}`);
    }
    const result = await router.login(creds.password);
    if (result.ok) {
      startKeepalive();
      console.log("[boot] 自动登录成功");
      return;
    }
    console.warn("[boot] 自动登录失败:", result.message, "— 清除已保存凭证");
    await clearCredentials();
  } catch (err) {
    if (isNetworkError(err)) {
      console.warn("[boot] 路由器暂不可达, 保留凭证下次重试:", err.message);
    } else {
      console.warn("[boot] 自动登录异常:", err.message);
      try { await clearCredentials(); } catch (_) {}
    }
  }
}

const NETWORK_ERROR_CODES = new Set([
  "ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT",
  "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "EHOSTDOWN",
]);

function isNetworkError(err) {
  let cursor = err;
  while (cursor) {
    if (cursor.code && NETWORK_ERROR_CODES.has(cursor.code)) return true;
    cursor = cursor.cause;
  }
  return false;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  startServer();
}

async function handleApi(req, res) {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  const startedAt = Date.now();
  let failed = false;
  debugLog("api", "收到 API 请求", { method: req.method, path: pathname });
  try {
  if (req.method === "GET" && pathname === "/api/config") {
    sendJson(res, 200, publicConfig());
    return;
  }
  if (req.method === "GET" && pathname === "/api/session") {
    const session = router.session();
    sendJson(res, 200, { ...session, autoReLogin: router.hasStoredPassword });
    return;
  }
  if (req.method === "POST" && pathname === "/api/router-target") {
    const body = await readJson(req);
    router.setBaseUrl(body.router);
    pendingActions.clear();
    stopKeepalive();
    try { await clearCredentials(); } catch (err) { console.warn("[router-target] 清除凭证失败:", err.message); }
    sendJson(res, 200, { ok: true, message: "路由器地址已更新", session: router.session() });
    return;
  }
  if (req.method === "POST" && pathname === "/api/login") {
    const body = await readJson(req);
    if (!body.password) throw badRequest("请输入路由器后台密码");
    const result = await router.login(body.password);
    if (result.ok) {
      startKeepalive();
      try {
        await saveCredentials({ password: body.password, routerBaseUrl: router.baseUrl });
      } catch (err) {
        console.warn("[login] 凭证持久化失败:", err.message);
      }
    }
    sendJson(res, 200, result);
    return;
  }
  if (req.method === "POST" && pathname === "/api/logout") {
    stopKeepalive();
    await router.logout();
    try { await clearCredentials(); } catch (err) { console.warn("[logout] 清除凭证失败:", err.message); }
    sendJson(res, 200, { ok: true });
    return;
  }
  requireLogin();
  if (req.method === "POST" && pathname === "/api/reboot-preview") {
    sendJson(res, 200, createPendingAction("reboot", buildRebootPayload()));
    return;
  }
  if (req.method === "POST" && pathname === "/api/reboot") {
    const body = await readJson(req);
    const payload = consumePendingAction(body, "reboot");
    sendJson(res, 200, { ok: true, request: redactAd(payload), result: await router.setForm(payload) });
    return;
  }
  if (req.method === "GET" && pathname === "/api/network/mode") {
    sendJson(res, 200, await router.networkMode());
    return;
  }
  if (req.method === "POST" && pathname === "/api/network/mode-preview") {
    const body = await readJson(req);
    if (!body.mode) throw badRequest("请选择网络模式");
    const payload = buildSetNetworkModePayload(body.mode);
    sendJson(res, 200, createPendingAction("set-network-mode", payload));
    return;
  }
  if (req.method === "POST" && pathname === "/api/network/mode") {
    const body = await readJson(req);
    const payload = consumePendingAction(body, "set-network-mode");
    sendJson(res, 200, { ok: true, request: redactAd(payload), result: await router.setForm(payload) });
    return;
  }
  if (req.method === "GET" && pathname === "/api/network/live") {
    sendJson(res, 200, await router.liveNetwork());
    return;
  }
  if (req.method === "GET" && pathname === "/api/bands/current") {
    sendJson(res, 200, await router.bandStatus());
    return;
  }
  if (req.method === "GET" && pathname === "/api/thermal/status") {
    sendJson(res, 200, await router.thermalStatus());
    return;
  }
  if (req.method === "POST" && pathname === "/api/bands/preview-4g") {
    const body = await readJson(req);
    const payload = buildLock4gPayload(body.bands);
    sendJson(res, 200, createPendingAction("lock-4g", payload));
    return;
  }
  if (req.method === "POST" && pathname === "/api/bands/preview-5g") {
    const body = await readJson(req);
    const payload = buildLock5gPayload(body.bands);
    sendJson(res, 200, createPendingAction("lock-5g", payload));
    return;
  }
  if (req.method === "POST" && pathname === "/api/thermal/disable-preview") {
    sendJson(res, 200, createPendingAction("thermal-disable", buildDisableThermalPayload()));
    return;
  }
  if (req.method === "POST" && pathname === "/api/thermal/switch-preview") {
    const body = await readJson(req);
    if (typeof body.enabled !== "boolean") throw badRequest("温控开关状态必须是 true 或 false");
    const payload = buildThermalSwitchPayload(body.enabled);
    sendJson(res, 200, createPendingAction("thermal-switch", payload));
    return;
  }
  if (req.method === "POST" && pathname === "/api/bands/lock-4g") {
    const body = await readJson(req);
    const payload = consumePendingAction(body, "lock-4g");
    sendJson(res, 200, { ok: true, request: redactAd(payload), result: await router.setForm(payload) });
    return;
  }
  if (req.method === "POST" && pathname === "/api/bands/lock-5g") {
    const body = await readJson(req);
    const payload = consumePendingAction(body, "lock-5g");
    sendJson(res, 200, { ok: true, request: redactAd(payload), result: await router.setForm(payload) });
    return;
  }
  if (req.method === "POST" && pathname === "/api/cells/preview-5g") {
    const body = await readJson(req);
    const payload =
      body.action === "unlock"
        ? buildUnlock5gCellPayload()
        : buildLock5gCellPayload({
            pci: body.pci,
            earfcn: body.earfcn,
            band: body.band,
            scs: body.scs,
          });
    sendJson(res, 200, createPendingAction("lock-5g-cell", payload));
    return;
  }
  if (req.method === "POST" && pathname === "/api/cells/lock-5g") {
    const body = await readJson(req);
    const payload = consumePendingAction(body, "lock-5g-cell");
    sendJson(res, 200, { ok: true, request: redactAd(payload), result: await router.setForm(payload) });
    return;
  }
  if (req.method === "POST" && pathname === "/api/thermal/disable") {
    const body = await readJson(req);
    const payload = consumePendingAction(body, "thermal-disable");
    sendJson(res, 200, { ok: true, request: redactAd(payload), result: await router.setForm(payload) });
    return;
  }
  if (req.method === "POST" && pathname === "/api/thermal/switch") {
    const body = await readJson(req);
    const payload = consumePendingAction(body, "thermal-switch");
    sendJson(res, 200, { ok: true, request: redactAd(payload), result: await router.setForm(payload) });
    return;
  }
  if (req.method === "GET" && pathname === "/api/wifi/status") {
    sendJson(res, 200, await router.wifiStatus());
    return;
  }
  if (req.method === "GET" && pathname === "/api/wifi/wps-status") {
    sendJson(res, 200, await router.wpsStatus());
    return;
  }
  if (req.method === "POST" && pathname === "/api/wifi/switch-preview") {
    const body = await readJson(req);
    if (typeof body.enabled !== "boolean") throw badRequest("WiFi 开关状态必须是 true 或 false");
    sendJson(res, 200, createPendingAction("wifi-switch", buildWifiSwitchPayload(body.enabled)));
    return;
  }
  if (req.method === "POST" && pathname === "/api/wifi/switch") {
    const body = await readJson(req);
    const payload = consumePendingAction(body, "wifi-switch");
    sendJson(res, 200, { ok: true, request: redactAd(payload), result: await router.setForm(payload) });
    return;
  }
  if (req.method === "POST" && pathname === "/api/wifi/wps-preview") {
    const body = await readJson(req);
    sendJson(res, 200, createPendingAction("wifi-wps", buildWpsPbcPayload({ chipIndex: body.chipIndex })));
    return;
  }
  if (req.method === "POST" && pathname === "/api/wifi/wps") {
    const body = await readJson(req);
    const payload = consumePendingAction(body, "wifi-wps");
    sendJson(res, 200, { ok: true, request: redactAd(payload), result: await router.setForm(payload) });
    return;
  }
  throw notFound("API 不存在");
  } catch (error) {
    failed = true;
    debugLog("api", "API 请求失败", {
      method: req.method,
      path: pathname,
      status: statusFromError(error),
      durationMs: Date.now() - startedAt,
      message: error.message || "请求失败",
    });
    throw error;
  } finally {
    if (!failed) {
      debugLog("api", "API 请求完成", {
        method: req.method,
        path: pathname,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
      });
    }
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const safePath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(publicDir, safePath));
  if (!filePath.startsWith(publicDir)) throw notFound("文件不存在");
  const data = await fs.readFile(filePath);
  res.writeHead(200, {
    "Content-Type": mime(filePath),
    "Cache-Control": "no-store",
  });
  res.end(data);
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw badRequest("请求体不是合法 JSON");
  }
}

function requireLogin() {
  if (!router.session().loggedIn) {
    const error = new Error("请先登录路由器后台");
    error.statusCode = 401;
    throw error;
  }
}

function createPendingAction(kind, payload) {
  const token = crypto.randomUUID();
  const record = {
    kind,
    payload,
    expiresAt: Date.now() + 60_000,
  };
  pendingActions.set(token, record);
  return {
    ok: true,
    token,
    expiresInMs: 60_000,
    request: redactAd(payload),
  };
}

function consumePendingAction(body, kind) {
  if (body.confirmed !== true || !body.confirmToken) {
    const error = new Error("此操作需要先生成确认令牌");
    error.statusCode = 400;
    throw error;
  }
  const record = pendingActions.get(body.confirmToken);
  pendingActions.delete(body.confirmToken);
  if (!record || record.kind !== kind || record.expiresAt < Date.now()) {
    const error = new Error("确认令牌不存在或已过期");
    error.statusCode = 400;
    throw error;
  }
  return record.payload;
}

function redactAd(payload) {
  const copy = { ...payload };
  if (copy.AD) copy.AD = "<attached-by-server>";
  return copy;
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

function statusFromError(error) {
  return error.statusCode || 500;
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

function mime(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

function startKeepalive() {
  stopKeepalive();
  keepaliveTimer = setInterval(async () => {
    try {
      const status = await router.keepalive();
      if (!status.alive) {
        console.log(`[keepalive] 会话已失效: ${status.reason}`);
        stopKeepalive();
      } else if (status.reLoggedIn) {
        console.log("[keepalive] 会话过期，已自动重新登录");
      }
    } catch (error) {
      console.error("[keepalive] 异常:", error.message);
      stopKeepalive();
    }
  }, KEEPALIVE_INTERVAL_MS);
}

function stopKeepalive() {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
}
