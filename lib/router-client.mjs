import {
  BAND_STATUS_FIELDS,
  DEFAULT_ROUTER_BASE_URL,
  DEVICE_LIVE_FIELDS,
  SIGNAL_FIELDS,
  THERMAL_STATUS_FIELDS,
  NR5G_SESSION_PROBE_FIELDS,
  NETWORK_MODE_FIELDS,
  WIFI_STATUS_FIELDS,
  computeAd,
  encodeLoginPassword,
  isLoginExpired,
  isNr5gCellDataRestricted,
  normalizeBandStatus,
  normalizeLiveNetwork,
  normalizeNetworkMode,
  normalizeThermal,
  normalizeSession,
  normalizeWifiStatus,
  normalizeWpsStatus,
} from "./zte-protocol.mjs";
import { createDebugLogger } from "./debug-log.mjs";

export class RouterClient {
  #password = "";
  #reLoggingIn = false;

  constructor({
    baseUrl = process.env.ROUTER_BASE_URL || DEFAULT_ROUTER_BASE_URL,
    fetchImpl = globalThis.fetch,
    shaMode = process.env.ZTE_SHA_MODE || 2,
    accessibleId = process.env.ZTE_ACCESSIBLE_ID !== "0",
    debugLogger = createDebugLogger(),
  } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetch = fetchImpl;
    this.shaMode = shaMode;
    this.accessibleId = accessibleId;
    this.cookieJar = new Map();
    this.rd0 = "";
    this.rd1 = "";
    this.loggedIn = false;
    this.debugLog = debugLogger;
  }

  get hasStoredPassword() {
    return this.#password !== "";
  }

  setBaseUrl(baseUrl) {
    const previous = this.baseUrl;
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.rd0 = "";
    this.rd1 = "";
    this.#password = "";
    this.clearSession();
    this.debugLog("router", "路由器地址已更新", { previous, next: this.baseUrl });
  }

  session() {
    return {
      loggedIn: this.loggedIn,
      router: this.baseUrl,
    };
  }

  clearSession() {
    this.cookieJar.clear();
    this.loggedIn = false;
  }

  async login(password) {
    this.debugLog("router", "开始登录", { router: this.baseUrl, shaMode: this.shaMode, accessibleId: this.accessibleId });
    await this.refreshLanguageSeeds();
    const ld = (await this.getParams(["LD"])).LD || "";
    const payload = {
      isTest: "false",
      goformId: "LOGIN",
      password: encodeLoginPassword(password, ld, this.shaMode),
    };
    const result = await this.setForm(payload, { attachAd: false });
    this.loggedIn = result?.result === "0" || result?.result === "4" || result?.result === true || result?.result === "success";
    if (!this.loggedIn) {
      this.#password = "";
      const message = result?.result === "2" ? "已有用户登录" : result?.result === "3" ? "密码错误" : "登录失败";
      this.debugLog("router", "登录失败", { message, raw: result });
      return { ok: false, message, raw: result };
    }
    this.#password = password;
    this.debugLog("router", "登录成功", { loggedIn: this.loggedIn });
    return { ok: true, message: "登录成功" };
  }

  async logout() {
    this.debugLog("router", "开始退出登录");
    this.#password = "";
    try {
      await this.setForm({ isTest: "false", goformId: "LOGOUT" }, { attachAd: false });
    } catch (error) {
      // Local session cleanup should still happen if firmware lacks LOGOUT.
      this.debugLog("router", "路由器退出请求失败，继续清理本地会话", { message: error.message });
    }
    this.clearSession();
    this.debugLog("router", "本地会话已清理");
    return { ok: true };
  }

  async liveNetwork() {
    return this.withReLogin(async () => {
      const raw = await this.getParams([...SIGNAL_FIELDS, ...DEVICE_LIVE_FIELDS, ...THERMAL_STATUS_FIELDS]);
      this.assertRouterSession(raw, { requireLoginfoOk: true, checkNr5gCellData: true });
      return normalizeLiveNetwork(raw);
    });
  }

  async bandStatus() {
    return this.withReLogin(async () => {
      const raw = await this.getParams([...BAND_STATUS_FIELDS, "loginfo"]);
      this.assertRouterSession(raw);
      return normalizeBandStatus(raw);
    });
  }

  async thermalStatus() {
    return this.withReLogin(async () => {
      const raw = await this.getParams(THERMAL_STATUS_FIELDS);
      this.assertRouterSession(raw);
      return {
        thermal: normalizeThermal(raw),
        session: normalizeSession(raw),
        raw,
      };
    });
  }

  async networkMode() {
    return this.withReLogin(async () => {
      const raw = await this.getParams(NETWORK_MODE_FIELDS);
      this.assertRouterSession(raw);
      return normalizeNetworkMode(raw);
    });
  }

  async wifiStatus() {
    return this.withReLogin(async () => {
      const raw = await this.getParams([...WIFI_STATUS_FIELDS, "loginfo"]);
      this.assertRouterSession(raw);
      return normalizeWifiStatus(raw);
    });
  }

  async wpsStatus() {
    return this.withReLogin(async () => {
      const raw = await this.getParams("queryWpsStatus");
      this.assertRouterSession(raw);
      return normalizeWpsStatus(raw);
    });
  }

  async getParams(fields) {
    const cmd = Array.isArray(fields) ? fields.join(",") : String(fields);
    return this.requestJson("/goform/goform_get_cmd_process", {
      method: "GET",
      query: {
        isTest: "false",
        cmd,
        multi_data: Array.isArray(fields) ? "1" : undefined,
        _: Date.now().toString(),
      },
    });
  }

  async setForm(payload, { attachAd = true } = {}) {
    return this.withReLogin(async () => {
      const data = { ...payload };
      if (attachAd && this.accessibleId && data.goformId !== "LOGIN" && data.goformId !== "SET_WEB_LANGUAGE") {
        await this.refreshLanguageSeeds();
        const rd = (await this.getParams(["RD"])).RD || "";
        data.AD = computeAd(this.rd0, this.rd1, rd);
      }
      const result = await this.requestJson("/goform/goform_set_cmd_process", {
        method: "POST",
        body: data,
      });
      if (isLoginExpired(result)) this.assertRouterSession(result);
      return result;
    });
  }

  async refreshLanguageSeeds() {
    if (this.rd0 && this.rd1) return;
    const language = await this.getParams(["Language", "cr_version", "wa_inner_version"]);
    this.rd0 = language.wa_inner_version || "";
    this.rd1 = language.cr_version || "";
  }

  async requestJson(path, { method, query = {}, body } = {}) {
    const startedAt = Date.now();
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const headers = {
      Accept: "application/json, text/javascript, */*; q=0.01",
      Referer: `${this.baseUrl}/index.html`,
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": "Mozilla/5.0 ZTE-Debug-Console",
    };
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    let requestBody;
    if (body) {
      headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
      requestBody = new URLSearchParams(body).toString();
    }
    this.debugLog("router:http", "发送路由器请求", {
      method,
      path,
      query: Object.fromEntries(url.searchParams.entries()),
      body,
      hasCookie: Boolean(cookie),
    });
    try {
      const response = await this.fetch(url, {
        method,
        headers,
        body: requestBody,
        redirect: "manual",
      });
      this.storeCookies(response.headers);
      const text = await response.text();
      if (!response.ok && response.status !== 200) {
        throw new Error(`路由器返回 HTTP ${response.status}`);
      }
      if (!text.trim()) {
        this.debugLog("router:http", "收到路由器响应", {
          method,
          path,
          status: response.status,
          durationMs: Date.now() - startedAt,
          data: {},
        });
        return {};
      }
      try {
        const data = JSON.parse(text);
        this.debugLog("router:http", "收到路由器响应", {
          method,
          path,
          status: response.status,
          durationMs: Date.now() - startedAt,
          data,
        });
        return data;
      } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          const data = JSON.parse(match[0]);
          this.debugLog("router:http", "收到路由器响应", {
            method,
            path,
            status: response.status,
            durationMs: Date.now() - startedAt,
            data,
          });
          return data;
        }
        throw new Error("路由器返回了非 JSON 数据");
      }
    } catch (error) {
      this.debugLog("router:http", "路由器请求失败", {
        method,
        path,
        durationMs: Date.now() - startedAt,
        message: error.message,
      });
      throw error;
    }
  }

  cookieHeader() {
    return [...this.cookieJar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
  }

  storeCookies(headers) {
    const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
    for (const header of values) {
      const [pair] = header.split(";");
      const idx = pair.indexOf("=");
      if (idx > 0) this.cookieJar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }

  assertRouterSession(raw = {}, { requireLoginfoOk = false, checkNr5gCellData = false } = {}) {
    if (!isLoginExpired(raw, { requireLoginfoOk }) && !(checkNr5gCellData && isNr5gCellDataRestricted(raw))) return;
    this.clearSession();
    const error = new Error("路由器登录状态已失效，请重新登录");
    error.statusCode = 401;
    throw error;
  }

  async withReLogin(fn) {
    try {
      return await fn();
    } catch (error) {
      if (error.statusCode !== 401 || !this.#password || this.#reLoggingIn) throw error;
      this.debugLog("router", "检测到会话失效，尝试自动重新登录", { message: error.message });
      this.#reLoggingIn = true;
      try {
        const loginResult = await this.login(this.#password);
        if (!loginResult.ok) {
          this.#password = "";
          const retryError = new Error("自动重新登录失败，请手动重新登录");
          retryError.statusCode = 401;
          retryError.cause = loginResult;
          throw retryError;
        }
        this.debugLog("router", "自动重新登录成功，重试原请求");
        return await fn();
      } finally {
        this.#reLoggingIn = false;
      }
    }
  }

  async keepalive() {
    if (!this.#password) {
      this.debugLog("keepalive", "跳过保活：没有保存的密码");
      return { alive: false, reason: "no_password" };
    }
    try {
      this.debugLog("keepalive", "开始检查路由器会话");
      const raw = await this.getParams(NR5G_SESSION_PROBE_FIELDS);
      if (!isLoginExpired(raw, { requireLoginfoOk: true }) && !isNr5gCellDataRestricted(raw)) {
        this.debugLog("keepalive", "路由器会话仍然有效");
        return { alive: true };
      }
      this.debugLog("keepalive", "会话探测失败，尝试重新登录", { raw });
      const result = await this.login(this.#password);
      if (result.ok) {
        this.debugLog("keepalive", "保活重新登录成功");
        return { alive: true, reLoggedIn: true };
      }
      this.#password = "";
      this.debugLog("keepalive", "保活重新登录失败", { result });
      return { alive: false, reason: "relogin_failed" };
    } catch (error) {
      this.debugLog("keepalive", "保活请求异常", { message: error.message });
      return { alive: false, reason: "network_error" };
    }
  }
}

export function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("请输入路由器后台地址");
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("路由器后台地址格式不正确");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("路由器后台地址只支持 http 或 https");
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}
