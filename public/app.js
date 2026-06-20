import { openConfirmDialog } from "./confirm-flow.mjs";
import makeQrCode from "./vendor/qrcode-generator.mjs";

const state = {
  config: null,
  bandStatus: null,
  thermalProbe: null,
  pendingAction: null,
  refreshTimer: null,
  lastLiveNetwork: null,
  wifiStatus: null,
  wpsTimer: null,
  wpsDeadline: null,
  wpsActivated: false,
  wpsPollTick: 0,
  wifiQrPayload2g: null,
  wifiQrPayload5g: null,
};

const THERMAL_DETECTION_WINDOW_MS = 5 * 60 * 1000;

const els = {
  routerTarget: document.querySelector("#routerTarget"),
  sessionBadge: document.querySelector("#sessionBadge"),
  loginPanel: document.querySelector("#loginPanel"),
  loginForm: document.querySelector("#loginForm"),
  routerBaseUrl: document.querySelector("#routerBaseUrl"),
  password: document.querySelector("#password"),
  logoutBtn: document.querySelector("#logoutBtn"),
  rebootBtn: document.querySelector("#rebootBtn"),
  message: document.querySelector("#message"),
  lastUpdated: document.querySelector("#lastUpdated"),
  networkType: document.querySelector("#networkType"),
  modePill: document.querySelector("#modePill"),
  lteBands: document.querySelector("#lteBands"),
  nrBands: document.querySelector("#nrBands"),
  lock4gBtn: document.querySelector("#lock4gBtn"),
  lock5gBtn: document.querySelector("#lock5gBtn"),
  refreshBandsBtn: document.querySelector("#refreshBandsBtn"),
  cellPci: document.querySelector("#cellPci"),
  cellEarfcn: document.querySelector("#cellEarfcn"),
  cellBand: document.querySelector("#cellBand"),
  cellScs: document.querySelector("#cellScs"),
  lockCell5gBtn: document.querySelector("#lockCell5gBtn"),
  unlockCell5gBtn: document.querySelector("#unlockCell5gBtn"),
  useCurrentCellBtn: document.querySelector("#useCurrentCellBtn"),
  enableThermalBtn: document.querySelector("#enableThermalBtn"),
  disableThermalBtn: document.querySelector("#disableThermalBtn"),
  networkModes: document.querySelector("#networkModes"),
  setModeBtn: document.querySelector("#setModeBtn"),
  currentMode: document.querySelector("#currentMode"),
  confirmDialog: document.querySelector("#confirmDialog"),
  confirmTitle: document.querySelector("#confirmTitle"),
  confirmPayload: document.querySelector("#confirmPayload"),
  confirmSubmitBtn: document.querySelector("#confirmSubmitBtn"),
  wifiSsid: document.querySelector("#wifiSsid"),
  wifiSsid5g: document.querySelector("#wifiSsid5g"),
  wifiSsid5gLabel: document.querySelector("#wifiSsid5gLabel"),
  wifiSecurity: document.querySelector("#wifiSecurity"),
  wifiHidden: document.querySelector("#wifiHidden"),
  enableWifiBtn: document.querySelector("#enableWifiBtn"),
  disableWifiBtn: document.querySelector("#disableWifiBtn"),
  wpsPbcBtn: document.querySelector("#wpsPbcBtn"),
  wpsBandField: document.querySelector("#wpsBandField"),
  wpsBand5g: document.querySelector("#wpsBand5g"),
  wpsCountdown: document.querySelector("#wpsCountdown"),
  wifiQrWrap: document.querySelector("#wifiQrWrap"),
  wifiQr2g: document.querySelector("#wifiQr2g"),
  wifiQr5g: document.querySelector("#wifiQr5g"),
  wifiQrLabel2g: document.querySelector("#wifiQrLabel2g"),
  wifiQrLabel5g: document.querySelector("#wifiQrLabel5g"),
  wifiQrCanvas2g: document.querySelector("#wifiQrCanvas2g"),
  wifiQrCanvas5g: document.querySelector("#wifiQrCanvas5g"),
};

const fieldMap = {
  nrRsrp: "nr5g.rsrp",
  nrSinr: "nr5g.sinr",
  nrBand: "nr5g.band",
  nrChannel: "nr5g.channel",
  nrPci: "nr5g.pci",
  nrCell: "nr5g.cellId",
  lteRsrp: "lte.rsrp",
  lteSinr: "lte.sinr",
  lteBand: "lte.band",
  lteChannel: "lte.channel",
  ltePci: "lte.pci",
  lteCa: "lte.ca",
};

const deviceFieldMap = {
  downloadRate: "traffic.download",
  uploadRate: "traffic.upload",
  batteryPercent: "battery.percent",
  batteryTemp: "battery.temperature",
  batteryReason: "battery.dischargeReason",
  thermalLed: "thermal.ledEnabled",
  tempWifiChip: "thermal.sensors.wifiChip",
  tempPa: "thermal.sensors.pa",
  tempPaFrl: "thermal.sensors.paFrl",
  tempTj: "thermal.sensors.tj",
  tempPa1: "thermal.sensors.pa1",
  tempMdm: "thermal.sensors.mdm",
  tempModem5g: "thermal.sensors.modem5g",
};

init();

async function init() {
  bindEvents();
  state.config = await api("/api/config");
  renderBandControls();
  await refreshSession();
}

function bindEvents() {
  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await applyRouterTarget({ silent: true });
      const result = await api("/api/login", { method: "POST", body: { password: els.password.value } });
      if (!result.ok) throw new Error(result.message || "登录失败");
      els.password.value = "";
      showMessage(result.message, "ok");
      await refreshSession();
    } catch (error) {
      showMessage(error.message, "error");
    } finally {
      setBusy(false);
    }
  });

  els.logoutBtn.addEventListener("click", async () => {
    await api("/api/logout", { method: "POST", body: {} });
    stopRefresh();
    await refreshSession();
    showMessage("已退出本地会话", "ok");
  });

  els.rebootBtn.addEventListener("click", confirmReboot);

  els.refreshBandsBtn.addEventListener("click", refreshBands);
  els.lock4gBtn.addEventListener("click", () => confirmLock("4g"));
  els.lock5gBtn.addEventListener("click", () => confirmLock("5g"));
  els.lockCell5gBtn.addEventListener("click", () => {
    previewCellLock({
      action: "lock",
      pci: els.cellPci.value,
      earfcn: els.cellEarfcn.value,
      band: els.cellBand.value,
      scs: els.cellScs.value,
    });
  });
  els.unlockCell5gBtn.addEventListener("click", () => previewCellLock({ action: "unlock" }));
  els.useCurrentCellBtn.addEventListener("click", prefillCurrentCell);
  els.enableThermalBtn.addEventListener("click", () => confirmThermalSwitch(true));
  els.disableThermalBtn.addEventListener("click", () => confirmThermalSwitch(false));
  els.setModeBtn.addEventListener("click", confirmNetworkMode);

  els.enableWifiBtn.addEventListener("click", () => confirmWifiSwitch(true));
  els.disableWifiBtn.addEventListener("click", () => confirmWifiSwitch(false));
  els.wpsPbcBtn.addEventListener("click", confirmWpsPbc);

  els.confirmDialog.addEventListener("close", async () => {
    if (els.confirmDialog.returnValue !== "confirm" || !state.pendingAction) {
      state.pendingAction = null;
      return;
    }
    await submitPendingAction();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshSession();
  });
}

async function refreshSession() {
  const session = await api("/api/session");
  els.routerTarget.textContent = `路由器: ${session.router || "--"}`;
  els.routerBaseUrl.value = session.router || "http://192.168.0.1";
  els.sessionBadge.textContent = session.loggedIn ? "已登录" : "未登录";
  els.sessionBadge.classList.toggle("ok", session.loggedIn);
  els.loginPanel.hidden = session.loggedIn;
  els.logoutBtn.hidden = !session.loggedIn;
  els.rebootBtn.hidden = !session.loggedIn;
  els.lock4gBtn.disabled = !session.loggedIn;
  els.lock5gBtn.disabled = !session.loggedIn;
  els.refreshBandsBtn.disabled = !session.loggedIn;
  els.lockCell5gBtn.disabled = !session.loggedIn;
  els.unlockCell5gBtn.disabled = !session.loggedIn;
  els.useCurrentCellBtn.disabled = !session.loggedIn;
  els.enableThermalBtn.disabled = !session.loggedIn;
  els.disableThermalBtn.disabled = !session.loggedIn;
  els.setModeBtn.disabled = !session.loggedIn;
  els.enableWifiBtn.disabled = !session.loggedIn;
  els.disableWifiBtn.disabled = !session.loggedIn;
  els.wpsPbcBtn.disabled = !session.loggedIn;
  if (session.loggedIn) {
    startRefresh();
    await refreshBands();
    await refreshWifi();
  } else {
    state.bandStatus = null;
    state.thermalProbe = null;
    state.lastLiveNetwork = null;
    state.wifiStatus = null;
    renderEmptyNetwork();
    renderEmptyDeviceStatus();
    renderEmptyWifi();
    syncBandSelections();
  }
}

async function applyRouterTarget({ silent = false } = {}) {
  const result = await api("/api/router-target", {
    method: "POST",
    body: { router: els.routerBaseUrl.value },
  });
  stopRefresh();
  state.bandStatus = null;
  state.thermalProbe = null;
  state.pendingAction = null;
  state.wifiStatus = null;
  renderEmptyNetwork();
  renderEmptyDeviceStatus();
  renderEmptyWifi();
  syncBandSelections();
  const session = result.session || {};
  els.routerTarget.textContent = `路由器: ${session.router || "--"}`;
  els.routerBaseUrl.value = session.router || els.routerBaseUrl.value;
  els.sessionBadge.textContent = "未登录";
  els.sessionBadge.classList.remove("ok");
  els.loginPanel.hidden = false;
  els.logoutBtn.hidden = true;
  els.rebootBtn.hidden = true;
  els.lock4gBtn.disabled = true;
  els.lock5gBtn.disabled = true;
  els.refreshBandsBtn.disabled = true;
  els.lockCell5gBtn.disabled = true;
  els.unlockCell5gBtn.disabled = true;
  els.useCurrentCellBtn.disabled = true;
  els.enableThermalBtn.disabled = true;
  els.disableThermalBtn.disabled = true;
  els.setModeBtn.disabled = true;
  els.enableWifiBtn.disabled = true;
  els.disableWifiBtn.disabled = true;
  els.wpsPbcBtn.disabled = true;
  if (!silent) showMessage(result.message || "路由器地址已更新", "ok");
  return result;
}

function startRefresh() {
  stopRefresh();
  refreshNetwork();
  state.refreshTimer = window.setInterval(refreshNetwork, 2000);
}

function stopRefresh() {
  if (state.refreshTimer) window.clearInterval(state.refreshTimer);
  state.refreshTimer = null;
}

async function refreshNetwork() {
  try {
    const data = await api("/api/network/live");
    state.lastLiveNetwork = data;
    els.networkType.textContent = data.networkType || "--";
    els.modePill.textContent = data.mode || "--";
    for (const [id, path] of Object.entries(fieldMap)) {
      document.querySelector(`#${id}`).textContent = getPath(data, path) || "--";
    }
    const is5g = data.mode === "5G";
    document.querySelector(".nr5g-metrics").style.display = is5g ? "" : "none";
    document.querySelector(".lte-metrics").style.display = is5g ? "none" : "";
    renderDeviceStatus(data);
    els.lastUpdated.textContent = new Date().toLocaleTimeString();
    document.querySelector("#deviceUpdated").textContent = els.lastUpdated.textContent;
    refreshWifi({ silent: true });
  } catch (error) {
    if (handleSessionExpired(error)) return;
    showMessage(error.message, "error");
  }
}

async function refreshBands() {
  try {
    const data = await api("/api/bands/current");
    state.bandStatus = data;
    document.querySelector("#current4g").textContent = data.lte.bands.length ? data.lte.bands.map((band) => `B${band}`).join(", ") : data.lte.mask || "--";
    document.querySelector("#current5g").textContent = formatNrBands(data.nr5g.all);
    syncBandSelections();
    await refreshNetworkMode();
  } catch (error) {
    if (handleSessionExpired(error)) return;
    showMessage(error.message, "error");
  }
}

async function refreshNetworkMode() {
  try {
    const data = await api("/api/network/mode");
    els.currentMode.textContent = data.label || "--";
    const radio = els.networkModes.querySelector(`input[value="${data.mode}"]`);
    if (radio) radio.checked = true;
  } catch (error) {
    if (handleSessionExpired(error)) return;
  }
}

async function confirmNetworkMode() {
  const radio = els.networkModes.querySelector("input[name='networkMode']:checked");
  if (!radio) {
    showMessage("请选择一个网络模式", "error");
    return;
  }
  const mode = radio.value;
  const label = radio.parentElement.querySelector("span").textContent;
  setBusy(true);
  try {
    const preview = await api("/api/network/mode-preview", { method: "POST", body: { mode } });
    openConfirmDialog({
      state,
      els,
      endpoint: "/api/network/mode",
      token: preview.token,
      successMessage: `网络模式已切换为 ${label}`,
      title: "确认切换网络模式",
      details: {
        action: `切换为 ${label}`,
        risk: "切换网络模式会导致网络短暂断开",
        expiresInMs: preview.expiresInMs,
        request: preview.request,
      },
    });
  } catch (error) {
    if (handleSessionExpired(error)) return;
    showMessage(error.message, "error");
  } finally {
    setBusy(false);
  }
}

function renderBandControls() {
  els.lteBands.innerHTML = state.config.lteBands.map((item) => checkbox("lteBand", item.band, item.label)).join("");
  renderNrBands();
  renderNetworkModes();
}

function renderNetworkModes() {
  els.networkModes.innerHTML = state.config.networkModes.map((m) =>
    `<label><input type="radio" name="networkMode" value="${m.value}"><span>${m.label}</span></label>`
  ).join("");
}

function renderNrBands() {
  els.nrBands.innerHTML = state.config.nr5gSaBands.map((band) => checkbox("nrBand", band, `n${band}`)).join("");
  syncBandSelections();
}

function checkbox(name, value, label) {
  return `<label><input type="checkbox" name="${name}" value="${value}"><span>${label}</span></label>`;
}

function confirmLock(kind) {
  const bands = selected(kind === "4g" ? "lteBand" : "nrBand");
  if (!bands.length) {
    showMessage("至少选择一个频段", "error");
    return;
  }
  previewLock(kind, bands);
}

async function previewLock(kind, bands) {
  setBusy(true);
  try {
    const preview = kind === "4g"
      ? await api("/api/bands/preview-4g", { method: "POST", body: { bands } })
      : await api("/api/bands/preview-5g", { method: "POST", body: { bands } });
    openConfirmDialog({
      state,
      els,
      endpoint: kind === "4g" ? "/api/bands/lock-4g" : "/api/bands/lock-5g",
      token: preview.token,
      successMessage: "锁频请求已提交",
      title: "确认锁频",
      details: {
        risk: "锁频可能导致网络短暂断开或无法驻网",
        expiresInMs: preview.expiresInMs,
        request: preview.request,
      },
    });
  } catch (error) {
    if (handleSessionExpired(error)) return;
    showMessage(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function confirmThermalSwitch(enabled) {
  setBusy(true);
  try {
    const preview = await api("/api/thermal/switch-preview", { method: "POST", body: { enabled } });
    const actionText = enabled ? "开启温控" : "关闭温控";
    openConfirmDialog({
      state,
      els,
      endpoint: "/api/thermal/switch",
      token: preview.token,
      successMessage: `${actionText}请求已提交`,
      title: `确认${actionText}`,
      details: {
        action: actionText,
        risk: enabled ? "开启温控会恢复设备温度保护策略" : "关闭温控可能影响设备降温保护，请确认当前散热条件可靠",
        expiresInMs: preview.expiresInMs,
        request: preview.request,
      },
      thermalTarget: enabled,
    });
  } catch (error) {
    if (handleSessionExpired(error)) return;
    showMessage(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function confirmReboot() {
  setBusy(true);
  try {
    const preview = await api("/api/reboot-preview", { method: "POST", body: {} });
    openConfirmDialog({
      state,
      els,
      endpoint: "/api/reboot",
      token: preview.token,
      successMessage: "重启指令已发送",
      title: "确认重启路由器",
      details: {
        action: "重启路由器",
        risk: "重启后路由器会断开所有连接，约 1-2 分钟后恢复",
        expiresInMs: preview.expiresInMs,
        request: preview.request,
      },
    });
  } catch (error) {
    if (handleSessionExpired(error)) return;
    showMessage(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function previewCellLock(body) {
  setBusy(true);
  try {
    const preview = await api("/api/cells/preview-5g", { method: "POST", body });
    const isUnlock = body.action === "unlock";
    openConfirmDialog({
      state,
      els,
      endpoint: "/api/cells/lock-5g",
      token: preview.token,
      successMessage: isUnlock ? "5G 小区解锁请求已提交" : "5G 锁小区请求已提交",
      title: isUnlock ? "确认解锁 5G 小区" : "确认锁定 5G 小区",
      details: {
        risk: isUnlock
          ? "解锁后将恢复路由器自动选小区"
          : "锁小区会强制驻留在指定小区，信号变化时可能掉线或无法驻网",
        expiresInMs: preview.expiresInMs,
        request: preview.request,
      },
    });
  } catch (error) {
    if (handleSessionExpired(error)) return;
    showMessage(error.message, "error");
  } finally {
    setBusy(false);
  }
}

function prefillCurrentCell() {
  const nr = state.lastLiveNetwork?.nr5g;
  if (!nr) {
    showMessage("暂无可用的实时网络数据", "error");
    return;
  }
  if (nr.pci && nr.pci !== "--") els.cellPci.value = nr.pci;
  if (nr.channel && nr.channel !== "--") els.cellEarfcn.value = nr.channel;
  if (nr.band && nr.band !== "--") els.cellBand.value = nr.band;
  showMessage("已填入当前 5G 小区信息（SCS 请手动确认）", "ok");
}

async function submitPendingAction() {
  const action = state.pendingAction;
  state.pendingAction = null;
  setBusy(true);
  try {
    const result = await api(action.endpoint, {
      method: "POST",
      body: { confirmed: true, confirmToken: action.token },
    });
    if (action.thermalTarget !== undefined) {
      state.thermalProbe = {
        target: action.thermalTarget,
        startedAt: Date.now(),
      };
    }
    showMessage(result.result?.result === "success" || result.ok ? action.successMessage : "请求返回异常", result.ok ? "ok" : "error");
    await refreshBands();
    await refreshNetwork();
    if (action.onSuccess) await action.onSuccess();
  } catch (error) {
    if (handleSessionExpired(error)) return;
    showMessage(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function refreshWifi({ silent = false } = {}) {
  try {
    const data = await api("/api/wifi/status");
    state.wifiStatus = data;
    renderWifi(data);
  } catch (error) {
    if (handleSessionExpired(error)) return;
    if (!silent) showMessage(error.message, "error");
  }
}

function renderWifi(data) {
  const on = data.enabled === true;
  els.enableWifiBtn.classList.toggle("selected", on);
  els.disableWifiBtn.classList.toggle("selected", on === false);
  els.wifiSsid.textContent = data.ssid || "--";
  const show5g = Boolean(data.ssid5g) && !data.sync;
  els.wifiSsid5gLabel.hidden = !show5g;
  els.wifiSsid5g.hidden = !show5g;
  els.wifiSsid5g.textContent = show5g ? data.ssid5g : "--";
  els.wifiSecurity.textContent = data.securityLabel || "--";
  els.wifiHidden.textContent = data.hidden ? "隐藏" : "广播";
  els.wpsBandField.hidden = !on;
  els.wpsPbcBtn.hidden = !on;
  els.wpsPbcBtn.disabled = Boolean(on && data.hidden);
  els.wpsPbcBtn.title = on && data.hidden ? "WPS 要求 SSID 广播，当前为隐藏" : "";
  if (!on) stopWpsCountdown();
  const codes = on ? data.qrCodes : null;
  if (codes && codes.length) {
    els.wifiQrWrap.hidden = false;
    renderWifiQrItem(els.wifiQr2g, els.wifiQrCanvas2g, els.wifiQrLabel2g, codes[0], "wifiQrPayload2g");
    renderWifiQrItem(els.wifiQr5g, els.wifiQrCanvas5g, els.wifiQrLabel5g, codes[1], "wifiQrPayload5g");
  } else {
    els.wifiQrWrap.hidden = true;
    state.wifiQrPayload2g = null;
    state.wifiQrPayload5g = null;
  }
}

function renderWifiQrItem(item, canvas, label, code, guardKey) {
  if (!code) {
    item.hidden = true;
    state[guardKey] = null;
    return;
  }
  item.hidden = false;
  label.textContent = code.label;
  if (state[guardKey] !== code.qrPayload) {
    drawWifiQr(canvas, code.qrPayload);
    state[guardKey] = code.qrPayload;
  }
}

function renderEmptyWifi() {
  state.wifiStatus = null;
  state.wifiQrPayload2g = null;
  state.wifiQrPayload5g = null;
  stopWpsCountdown();
  els.enableWifiBtn.classList.remove("selected");
  els.disableWifiBtn.classList.remove("selected");
  els.wifiSsid.textContent = "--";
  els.wifiSsid5g.hidden = true;
  els.wifiSsid5gLabel.hidden = true;
  els.wifiSsid5g.textContent = "--";
  els.wifiSecurity.textContent = "--";
  els.wifiHidden.textContent = "--";
  els.wifiQrWrap.hidden = true;
  els.wpsBandField.hidden = true;
  els.wpsPbcBtn.hidden = true;
}

async function confirmWifiSwitch(enabled) {
  setBusy(true);
  try {
    const preview = await api("/api/wifi/switch-preview", { method: "POST", body: { enabled } });
    const actionText = enabled ? "开启 WiFi" : "关闭 WiFi";
    openConfirmDialog({
      state,
      els,
      endpoint: "/api/wifi/switch",
      token: preview.token,
      successMessage: `${actionText}请求已提交`,
      title: `确认${actionText}`,
      details: {
        action: actionText,
        risk: enabled
          ? "开启 WiFi 将恢复无线广播"
          : "关闭 WiFi 会断开所有无线客户端；若本机正通过该热点的 WiFi 接入，自身连接也会断开，需经 USB 或重新接入恢复",
        expiresInMs: preview.expiresInMs,
        request: preview.request,
      },
      onSuccess: refreshWifi,
    });
  } catch (error) {
    if (handleSessionExpired(error)) return;
    showMessage(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function confirmWpsPbc() {
  setBusy(true);
  try {
    const chipIndex = selectedWpsChipIndex();
    const bandLabel = chipIndex === "1" ? "5G" : "2.4G";
    const preview = await api("/api/wifi/wps-preview", { method: "POST", body: { chipIndex } });
    openConfirmDialog({
      state,
      els,
      endpoint: "/api/wifi/wps",
      token: preview.token,
      successMessage: "WPS 已启动",
      title: "确认启动 WPS",
      details: {
        action: `WPS 连接（PBC，${bandLabel}）`,
        risk: "启动后请在 2 分钟内于待接入设备上启动 WPS，期间其他设备可能无法配对",
        expiresInMs: preview.expiresInMs,
        request: preview.request,
      },
      onSuccess: () => startWpsCountdown(120000, chipIndex),
    });
  } catch (error) {
    if (handleSessionExpired(error)) return;
    showMessage(error.message, "error");
  } finally {
    setBusy(false);
  }
}

function selectedWpsChipIndex() {
  const checked = document.querySelector('input[name="wpsBand"]:checked');
  return checked ? checked.value : "0";
}

function startWpsCountdown(durationMs = 120000, chipIndex = "0") {
  stopWpsCountdown();
  const bandLabel = chipIndex === "1" ? "5G" : "2.4G";
  state.wpsDeadline = Date.now() + durationMs;
  state.wpsActivated = false;
  state.wpsPollTick = 0;
  els.wpsCountdown.hidden = false;
  const render = () => {
    const remaining = Math.max(0, state.wpsDeadline - Date.now());
    const totalSeconds = Math.ceil(remaining / 1000);
    const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const ss = String(totalSeconds % 60).padStart(2, "0");
    els.wpsCountdown.textContent = `WPS ${state.wpsActivated ? "进行中" : "等待"} (${bandLabel}) ${mm}:${ss}`;
  };
  const poll = async () => {
    if (state.wpsActivated) return;
    try {
      const status = await api("/api/wifi/wps-status");
      const chip = Array.isArray(status) ? status.find((entry) => entry.chipIndex === chipIndex) : null;
      if (chip && chip.active) {
        state.wpsActivated = true;
        render();
      }
    } catch (error) {
      /* 轮询失败保持静默,不中断倒计时;最终由窗口结束统一判定 */
    }
  };
  render();
  poll();
  state.wpsTimer = window.setInterval(() => {
    render();
    state.wpsPollTick += 1;
    if (state.wpsPollTick % 3 === 0) poll();
    if (Math.max(0, state.wpsDeadline - Date.now()) <= 0) {
      stopWpsCountdown();
      showMessage(
        state.wpsActivated ? "WPS 窗口已结束" : "WPS 未启动：请确认 SSID 处于广播、且当前没有其他 WPS 进行中",
        state.wpsActivated ? "ok" : "error",
      );
    }
  }, 1000);
}

function stopWpsCountdown() {
  if (state.wpsTimer) {
    window.clearInterval(state.wpsTimer);
    state.wpsTimer = null;
  }
  els.wpsCountdown.hidden = true;
  els.wpsCountdown.textContent = "WPS 窗口: --";
}

function drawWifiQr(canvas, payload) {
  const qr = makeQrCode(0, "M");
  qr.addData(payload);
  qr.make();
  const count = qr.getModuleCount();
  const ctx = canvas.getContext("2d");
  const size = canvas.width;
  const cell = size / count;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#000";
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) {
        ctx.fillRect(Math.floor(col * cell), Math.floor(row * cell), Math.ceil(cell), Math.ceil(cell));
      }
    }
  }
}

function selected(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((item) => item.value);
}

function syncBandSelections() {
  const status = state.bandStatus;
  setCheckedBands("lteBand", status?.lte?.bands || []);
  setCheckedBands("nrBand", status?.nr5g?.all || []);
}

function setCheckedBands(name, bands) {
  const selectedBands = new Set((bands || []).map(String));
  document.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
    input.checked = selectedBands.has(input.value);
  });
}

function renderEmptyNetwork() {
  els.networkType.textContent = "--";
  els.modePill.textContent = "--";
  els.lastUpdated.textContent = "--";
  for (const id of Object.keys(fieldMap)) document.querySelector(`#${id}`).textContent = "--";
  document.querySelector(".nr5g-metrics").style.display = "";
  document.querySelector(".lte-metrics").style.display = "";
}

function renderDeviceStatus(data) {
  for (const [id, path] of Object.entries(deviceFieldMap)) {
    document.querySelector(`#${id}`).textContent = getPath(data, path) || "--";
  }
  const battery = data.battery || {};
  const power = battery.externalPower ? "外接供电" : battery.charging ? "充电中" : "电池供电";
  document.querySelector("#batteryCharging").textContent = battery.percent === "--" ? "--" : power;
  const level1 = getPath(data, "thermal.sensors.wifiLevel1");
  const level2 = getPath(data, "thermal.sensors.wifiLevel2");
  document.querySelector("#tempWifiLevel").textContent = [level1, level2].filter((item) => item && item !== "--").join(" / ") || "--";
  updateThermalSwitch(resolveThermalState(data.thermal));
}

function renderEmptyDeviceStatus() {
  document.querySelector("#deviceUpdated").textContent = "--";
  for (const id of Object.keys(deviceFieldMap)) document.querySelector(`#${id}`).textContent = "--";
  document.querySelector("#batteryCharging").textContent = "--";
  document.querySelector("#tempWifiLevel").textContent = "--";
  updateThermalSwitch({ state: "unknown", text: "--" });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.message || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function setBusy(value) {
  const loggedIn = els.loginPanel.hidden;
  const protectedIds = new Set([
    "logoutBtn",
    "rebootBtn",
    "lock4gBtn",
    "lock5gBtn",
    "refreshBandsBtn",
    "lockCell5gBtn",
    "unlockCell5gBtn",
    "useCurrentCellBtn",
    "enableThermalBtn",
    "disableThermalBtn",
    "setModeBtn",
    "enableWifiBtn",
    "disableWifiBtn",
    "wpsPbcBtn",
  ]);
  document.querySelectorAll("button, input").forEach((el) => {
    if (el.id === "password" || el.id === "routerBaseUrl") return;
    el.disabled = value || (protectedIds.has(el.id) && !loggedIn);
  });
}

function showMessage(text, type = "") {
  els.message.textContent = text || "";
  els.message.className = `message ${type}`;
}

function handleSessionExpired(error) {
  if (error.status !== 401) return false;
  stopRefresh();
  state.bandStatus = null;
  state.thermalProbe = null;
  state.pendingAction = null;
  state.wifiStatus = null;
  renderEmptyNetwork();
  renderEmptyDeviceStatus();
  renderEmptyWifi();
  syncBandSelections();
  els.sessionBadge.textContent = "未登录";
  els.sessionBadge.classList.remove("ok");
  els.loginPanel.hidden = false;
  els.logoutBtn.hidden = true;
  els.rebootBtn.hidden = true;
  els.lock4gBtn.disabled = true;
  els.lock5gBtn.disabled = true;
  els.refreshBandsBtn.disabled = true;
  els.lockCell5gBtn.disabled = true;
  els.unlockCell5gBtn.disabled = true;
  els.useCurrentCellBtn.disabled = true;
  els.enableThermalBtn.disabled = true;
  els.disableThermalBtn.disabled = true;
  els.setModeBtn.disabled = true;
  els.enableWifiBtn.disabled = true;
  els.disableWifiBtn.disabled = true;
  els.wpsPbcBtn.disabled = true;
  if (els.confirmDialog.open) els.confirmDialog.close("cancel");
  const msg = error.message?.includes("自动重新登录失败")
    ? "路由器会话已失效且自动重新登录失败，请手动重新登录"
    : error.message || "登录状态已失效，请重新登录";
  showMessage(msg, "error");
  return true;
}

function getPath(obj, path) {
  return path.split(".").reduce((acc, key) => acc?.[key], obj);
}

function resolveThermalState(thermal = {}) {
  if (thermal.hasCoreTemperature || thermal.detectedState === "on") {
    state.thermalProbe = null;
    return { state: "on", text: "开启" };
  }
  if (thermal.coreClosed || thermal.detectedState === "off") {
    state.thermalProbe = null;
    return { state: "off", text: "关闭" };
  }
  if (!state.thermalProbe) return { state: "unknown", text: "未知" };
  const elapsed = Date.now() - state.thermalProbe.startedAt;
  if (elapsed < THERMAL_DETECTION_WINDOW_MS) {
    return {
      state: "probing",
      text: state.thermalProbe.target ? "检测中（上次设置：开启）" : "关闭检测中（上次设置：关闭）",
    };
  }
  if (state.thermalProbe.target === false) return { state: "off", text: "关闭" };
  return { state: "unknown", text: "未知（上次设置：开启）" };
}

function updateThermalSwitch(status = {}) {
  const stateName = status.state || "unknown";
  document.querySelector("#thermalEnabled").textContent = status.text || "--";
  els.enableThermalBtn.classList.toggle("selected", stateName === "on" || (stateName === "probing" && state.thermalProbe?.target === true));
  els.disableThermalBtn.classList.toggle("selected", stateName === "off" || (stateName === "probing" && state.thermalProbe?.target === false));
}

function formatNrBands(bands) {
  return bands.length ? bands.map((band) => `n${band}`).join(", ") : "--";
}
