import crypto from "node:crypto";

export const DEFAULT_ROUTER_BASE_URL = "http://192.168.0.1";
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 5178;

export const LTE_BANDS = [
  { band: "1", label: "B1", value: "0x000000001" },
  { band: "3", label: "B3", value: "0x000000004" },
  { band: "5", label: "B5", value: "0x000000010" },
  { band: "8", label: "B8", value: "0x000000080" },
  { band: "34", label: "B34", value: "0x200000000" },
  { band: "39", label: "B39", value: "0x4000000000" },
  { band: "40", label: "B40", value: "0x8000000000" },
  { band: "41", label: "B41", value: "0x10000000000" },
];

export const NR5G_SA_BANDS = ["1", "3", "5", "8", "28", "41", "78"];

export const NETWORK_MODES = [
  { label: "5G/4G", value: "4G_AND_5G" },
  { label: "5G NSA", value: "LTE_AND_5G" },
  { label: "5G SA", value: "Only_5G" },
  { label: "4G Only", value: "Only_LTE" },
];

export const NETWORK_MODE_FIELDS = ["net_select"];

export const SIGNAL_FIELDS = [
  "network_type",
  "rssi",
  "rscp",
  "lte_rsrp",
  "Z5g_snr",
  "Z5g_rsrp",
  "ZCELLINFO_band",
  "Z5g_dlEarfcn",
  "lte_ca_pcell_arfcn",
  "lte_ca_pcell_band",
  "lte_ca_scell_band",
  "lte_ca_pcell_bandwidth",
  "lte_ca_scell_info",
  "lte_ca_scell_bandwidth",
  "wan_lte_ca",
  "lte_pci",
  "Z5g_CELL_ID",
  "Z5g_SINR",
  "cell_id",
  "lte_ca_scell_arfcn",
  "lte_multi_ca_scell_info",
  "wan_active_band",
  "nr5g_pci",
  "nr5g_action_band",
  "nr5g_cell_id",
  "lte_snr",
  "ecio",
  "wan_active_channel",
  "nr5g_action_channel",
];

export const NR5G_SESSION_PROBE_FIELDS = [
  "loginfo",
  "network_type",
  "Z5g_rsrp",
  "Z5g_SINR",
  "Z5g_snr",
  "nr5g_pci",
  "nr5g_action_band",
  "nr5g_cell_id",
  "nr5g_action_channel",
];

export const BAND_STATUS_FIELDS = [
  "lte_band_lock",
  "nr5g_band_lock",
  "nr5g_sa_band_lock",
  "nr5g_nsa_band_lock",
];

export const DEVICE_LIVE_FIELDS = [
  "realtime_tx_thrpt",
  "realtime_rx_thrpt",
  "battery_value",
  "battery_vol_percent",
  "battery_pers",
  "battery_charging",
  "battery_charg_type",
  "external_charging_flag",
  "battery_temp",
  "battery_discharge_reason",
  "loginfo",
];

export const THERMAL_STATUS_FIELDS = [
  "thermal_control_enable",
  "thermal_led_enable",
  "wifi_chip_temp",
  "therm_pa_level",
  "therm_pa_frl_level",
  "therm_tj_level",
  "pm_sensor_pa1",
  "pm_sensor_mdm",
  "pm_modem_5g",
  "wifi_temp_level_1",
  "wifi_temp_level_2",
  "battery_temp",
  "loginfo",
];

const LTE_VALUE_BY_BAND = new Map(LTE_BANDS.map((item) => [item.band, BigInt(item.value)]));
const CORE_THERMAL_SENSOR_KEYS = ["pm_sensor_pa1", "pm_sensor_mdm", "pm_modem_5g"];

export function sha256Upper(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex").toUpperCase();
}

export function base64(value) {
  return Buffer.from(String(value), "utf8").toString("base64");
}

export function encodeLoginPassword(password, ld = "", shaMode = 2) {
  if (String(shaMode) === "2") return sha256Upper(`${sha256Upper(password)}${ld}`);
  if (String(shaMode) === "1") return sha256Upper(base64(password));
  return base64(password);
}

export function computeAd(rd0, rd1, rd) {
  return sha256Upper(`${sha256Upper(`${rd0 || ""}${rd1 || ""}`)}${rd || ""}`);
}

export function validateBands(selected, allowed, label) {
  if (!Array.isArray(selected) || selected.length === 0) {
    throw new Error(`${label} 至少需要选择一个频段`);
  }
  const unique = [...new Set(selected.map(String))];
  const allowedSet = new Set(allowed.map(String));
  const invalid = unique.filter((band) => !allowedSet.has(band));
  if (invalid.length) throw new Error(`${label} 包含不支持的频段: ${invalid.join(", ")}`);
  return unique;
}

export function buildLteBandMask(selectedBands) {
  const bands = validateBands(selectedBands, LTE_BANDS.map((item) => item.band), "4G 锁频");
  const mask = bands.reduce((acc, band) => acc + LTE_VALUE_BY_BAND.get(band), 0n);
  return `0x${mask.toString(16).toUpperCase().padStart(16, "0")}`;
}

export function buildNr5gBandMask(selectedBands) {
  return validateBands(selectedBands, NR5G_SA_BANDS, "5G 锁频").join(",");
}

export function buildLock4gPayload(bands) {
  return {
    goformId: "BAND_SELECT",
    isTest: "false",
    is_gw_band: "0",
    gw_band_mask: "0",
    is_lte_band: "1",
    lte_band_mask: buildLteBandMask(bands),
  };
}

export function buildLock5gPayload(bands) {
  return {
    goformId: "WAN_PERFORM_NR5G_BAND_LOCK",
    isTest: "false",
    nr5g_band_mask: buildNr5gBandMask(bands),
  };
}

export function buildDisableThermalPayload() {
  return {
    goformId: "THERML_CONTROL_SWITCH_SET",
    isTest: "false",
    therml_control_switch: "0",
  };
}

export function buildEnableThermalPayload(raw = {}) {
  return {
    goformId: "THERML_CONTROL_SWITCH_SET",
    isTest: "false",
    therml_control_switch: "1",
  };
}

export function buildThermalSwitchPayload(enabled, raw = {}) {
  if (enabled === true) return buildEnableThermalPayload(raw);
  if (enabled === false) return buildDisableThermalPayload();
  throw new Error("温控开关状态必须是 true 或 false");
}

const NR5G_CELL_LOCK_SCS_VALUES = ["0", "1", "2", "3"];

export function buildLock5gCellPayload({ pci, earfcn, band, scs } = {}) {
  const normalizedPci = String(pci ?? "").trim();
  const normalizedEarfcn = String(earfcn ?? "").trim();
  const normalizedBand = String(band ?? "").trim().replace(/^n/i, "");
  const normalizedScs = String(scs ?? "").trim();
  if (!normalizedPci) throw new Error("5G 锁小区的 PCI 不能为空");
  if (!/^\d+$/.test(normalizedPci)) throw new Error("5G 锁小区的 PCI 必须是十进制数字");
  if (Number(normalizedPci) > 1007) throw new Error("5G 锁小区的 PCI 取值范围是 0–1007");
  if (!normalizedEarfcn) throw new Error("5G 锁小区的 EARFCN 不能为空");
  if (!/^\d+$/.test(normalizedEarfcn)) throw new Error("5G 锁小区的 EARFCN 必须是数字");
  if (!normalizedBand) throw new Error("5G 锁小区的 Band 不能为空");
  if (!/^\d+$/.test(normalizedBand)) throw new Error("5G 锁小区的 Band 必须是数字（无需 n 前缀）");
  if (!NR5G_CELL_LOCK_SCS_VALUES.includes(normalizedScs)) {
    throw new Error("5G 锁小区的 SCS 必须是 0、1、2 或 3");
  }
  return {
    goformId: "NR5G_LOCK_CELL_SET",
    isTest: "false",
    nr5g_cell_lock: `${normalizedPci},${normalizedEarfcn},${normalizedBand},${normalizedScs}`,
  };
}

export function buildUnlock5gCellPayload() {
  return {
    goformId: "NR5G_LOCK_CELL_SET",
    isTest: "false",
    nr5g_cell_lock: "1,1,1,1",
  };
}

export function buildSetNetworkModePayload(mode) {
  const valid = NETWORK_MODES.some((m) => m.value === mode);
  if (!valid) throw new Error(`不支持的网络模式: ${mode}`);
  return {
    goformId: "SET_BEARER_PREFERENCE",
    isTest: "false",
    BearerPreference: mode,
  };
}

export function buildRebootPayload() {
  return {
    goformId: "REBOOT_DEVICE",
    isTest: "false",
  };
}

export function normalizeNetworkMode(raw = {}) {
  const mode = String(raw.net_select || "");
  const match = NETWORK_MODES.find((m) => m.value === mode);
  return { mode, label: match ? match.label : mode || "--" };
}

export function normalizeSignal(raw = {}) {
  const type = String(raw.network_type || "");
  const upper = type.toUpperCase();
  const isSa = upper === "SA";
  const isEndc = upper === "ENDC";
  const isLte = ["LTE", "LTE_CA", "LTE_A", "LTE-NSA", "ENDC"].includes(upper);
  const displayMode = isSa || isEndc || upper === "LTE-NSA" ? "5G" : isLte ? "4G" : type || "--";

  return {
    networkType: type || "--",
    mode: displayMode,
    lte: {
      rsrp: formatDbm(raw.lte_rsrp),
      sinr: formatDb(raw.lte_snr || raw.ecio),
      pci: formatHexDecimal(raw.lte_pci),
      cellId: formatHexDecimal(raw.cell_id),
      band: raw.wan_active_band || "--",
      channel: raw.wan_active_channel || "--",
      ca: formatCa(raw.wan_lte_ca),
    },
    nr5g: {
      rsrp: formatDbm(raw.Z5g_rsrp),
      sinr: formatDb(raw.Z5g_SINR || raw.Z5g_snr),
      pci: formatHexDecimal(raw.nr5g_pci),
      cellId: formatHexDecimal(raw.nr5g_cell_id || raw.Z5g_CELL_ID),
      band: raw.nr5g_action_band ? String(raw.nr5g_action_band).toUpperCase() : "--",
      channel: raw.nr5g_action_channel || raw.Z5g_dlEarfcn || "--",
      active: isSa || isEndc || upper === "LTE-NSA",
    },
    raw,
  };
}

export function normalizeLiveNetwork(raw = {}) {
  return {
    ...normalizeSignal(raw),
    traffic: normalizeTraffic(raw),
    battery: normalizeBattery(raw),
    thermal: normalizeThermal(raw),
    session: normalizeSession(raw),
    raw,
  };
}

export function decodeLteMask(mask) {
  if (!mask) return [];
  let value;
  try {
    value = BigInt(mask);
  } catch {
    return [];
  }
  return LTE_BANDS.filter((item) => (value & BigInt(item.value)) !== 0n).map((item) => item.band);
}

export function normalizeTraffic(raw = {}) {
  return {
    upload: formatRate(raw.realtime_tx_thrpt),
    download: formatRate(raw.realtime_rx_thrpt),
    uploadRaw: raw.realtime_tx_thrpt ?? "",
    downloadRaw: raw.realtime_rx_thrpt ?? "",
  };
}

export function normalizeBattery(raw = {}) {
  const percent = firstPresent(raw.battery_value, raw.battery_vol_percent, raw.battery_pers);
  const externalPower = String(raw.external_charging_flag || "") === "1";
  const charging = externalPower || String(raw.battery_charging || "") === "1" || raw.battery_charg_type;
  return {
    percent: formatPercent(percent),
    charging: Boolean(charging),
    externalPower,
    chargeType: raw.battery_charg_type || "--",
    temperature: formatTemperature(raw.battery_temp),
    dischargeReason: raw.battery_discharge_reason || "--",
    raw: {
      battery_value: raw.battery_value ?? "",
      battery_vol_percent: raw.battery_vol_percent ?? "",
      battery_pers: raw.battery_pers ?? "",
      battery_charging: raw.battery_charging ?? "",
      battery_charg_type: raw.battery_charg_type ?? "",
      external_charging_flag: raw.external_charging_flag ?? "",
      battery_temp: raw.battery_temp ?? "",
    },
  };
}

export function normalizeThermal(raw = {}) {
  const coreSensors = normalizeCoreThermalSensors(raw);
  const hasCoreTemperature = Object.values(coreSensors).some((sensor) => sensor.valid);
  const coreClosed = areCoreThermalSensorsClosed(coreSensors);
  return {
    enabled: normalizeSwitch(raw.thermal_control_enable),
    ledEnabled: normalizeSwitch(raw.thermal_led_enable),
    detectedState: hasCoreTemperature ? "on" : coreClosed ? "off" : "unknown",
    hasCoreTemperature,
    coreClosed,
    coreSensors,
    sensors: {
      wifiChip: formatTemperature(raw.wifi_chip_temp),
      pa: formatTemperature(raw.therm_pa_level),
      paFrl: formatTemperature(raw.therm_pa_frl_level),
      tj: formatTemperature(raw.therm_tj_level),
      pa1: formatTemperature(raw.pm_sensor_pa1),
      mdm: formatTemperature(raw.pm_sensor_mdm),
      modem5g: formatTemperature(raw.pm_modem_5g),
      wifiLevel1: raw.wifi_temp_level_1 || "--",
      wifiLevel2: raw.wifi_temp_level_2 || "--",
    },
    raw: {
      thermal_control_enable: raw.thermal_control_enable ?? "",
      thermal_led_enable: raw.thermal_led_enable ?? "",
      wifi_chip_temp: raw.wifi_chip_temp ?? "",
      therm_pa_level: raw.therm_pa_level ?? "",
      therm_pa_frl_level: raw.therm_pa_frl_level ?? "",
      therm_tj_level: raw.therm_tj_level ?? "",
      pm_sensor_pa1: raw.pm_sensor_pa1 ?? "",
      pm_sensor_mdm: raw.pm_sensor_mdm ?? "",
      pm_modem_5g: raw.pm_modem_5g ?? "",
      wifi_temp_level_1: raw.wifi_temp_level_1 ?? "",
      wifi_temp_level_2: raw.wifi_temp_level_2 ?? "",
      battery_temp: raw.battery_temp ?? "",
    },
  };
}

export function normalizeCoreThermalSensors(raw = {}) {
  return {
    pa1: normalizeCoreThermalSensor(raw.pm_sensor_pa1),
    mdm: normalizeCoreThermalSensor(raw.pm_sensor_mdm),
    modem5g: normalizeCoreThermalSensor(raw.pm_modem_5g),
  };
}

export function normalizeCoreThermalSensor(value) {
  return {
    raw: value ?? "",
    display: formatTemperature(value),
    valid: isValidCoreTemperature(value),
    closed: isThermalClosedValue(value),
  };
}

export function isValidCoreTemperature(value) {
  if (isBlank(value)) return false;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > -273;
}

export function isThermalClosedValue(value) {
  if (isBlank(value)) return false;
  return Number(value) === -274;
}

export function areCoreThermalSensorsClosed(coreSensorsOrRaw = {}) {
  const coreSensors =
    coreSensorsOrRaw.pa1 && coreSensorsOrRaw.mdm && coreSensorsOrRaw.modem5g
      ? coreSensorsOrRaw
      : normalizeCoreThermalSensors(coreSensorsOrRaw);
  return Object.values(coreSensors).every((sensor) => sensor.closed);
}

export function inferThermalDetectedState(raw = {}, probe = {}) {
  const coreSensors = normalizeCoreThermalSensors(raw);
  if (Object.values(coreSensors).some((sensor) => sensor.valid)) return "on";
  if (areCoreThermalSensorsClosed(coreSensors)) return "off";
  if (!probe || probe.target === undefined || probe.startedAtMs === undefined) return "unknown";
  const nowMs = Number.isFinite(Number(probe.nowMs)) ? Number(probe.nowMs) : Date.now();
  const windowMs = Number.isFinite(Number(probe.windowMs)) ? Number(probe.windowMs) : 5 * 60 * 1000;
  if (nowMs - Number(probe.startedAtMs) < windowMs) return "probing";
  return probe.target === false ? "off" : "unknown";
}

export function normalizeSession(raw = {}) {
  return {
    loggedIn: !isLoginExpired(raw),
    loginfo: raw.loginfo || "",
  };
}

export function isLoginExpired(raw = {}, { requireLoginfoOk = false } = {}) {
  if (raw.loginfo === undefined || raw.loginfo === null) return false;
  if (raw.loginfo === "ok") return false;
  if (requireLoginfoOk && raw.loginfo === "") return true;
  return raw.loginfo !== "";
}

export function isNr5gCellDataRestricted(raw = {}) {
  const networkType = String(raw.network_type || "").toUpperCase();
  const is5gActive = networkType === "SA" || networkType === "ENDC" || networkType === "LTE-NSA";
  if (!is5gActive) return false;
  const has5gSignal = !isBlank(raw.Z5g_rsrp) || !isBlank(raw.Z5g_SINR) || !isBlank(raw.Z5g_snr);
  if (!has5gSignal) return false;
  return ["nr5g_pci", "nr5g_action_band", "nr5g_cell_id", "nr5g_action_channel"].every((key) => isBlank(raw[key]));
}

export function normalizeBandStatus(raw = {}) {
  return {
    lte: {
      mask: raw.lte_band_lock || "",
      bands: decodeLteMask(raw.lte_band_lock),
    },
    nr5g: {
      all: splitBands(raw.nr5g_band_lock),
      sa: splitBands(raw.nr5g_sa_band_lock),
      nsa: splitBands(raw.nr5g_nsa_band_lock),
    },
    raw,
  };
}

export function publicConfig() {
  return {
    lteBands: LTE_BANDS,
    nr5gSaBands: NR5G_SA_BANDS,
    networkModes: NETWORK_MODES,
  };
}

export function formatRate(value) {
  if (isBlank(value)) return "--";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  const bitsPerSecond = numeric * 8;
  return `${formatUnit(bitsPerSecond, ["b", "Kb", "Mb", "Gb"])}/s`;
}

export function formatTemperature(value) {
  if (isBlank(value)) return "--";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  if (numeric <= -273) return "--";
  const celsius = Math.abs(numeric) > 200 ? numeric / 1000 : numeric;
  return `${trimNumber(celsius)} °C`;
}

function splitBands(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstPresent(...values) {
  return values.find((value) => !isBlank(value));
}

function isBlank(value) {
  return value === undefined || value === null || value === "";
}

function normalizeSwitch(value) {
  if (isBlank(value)) return "--";
  if (String(value) === "1") return "开启";
  if (String(value) === "0") return "关闭";
  return String(value);
}

function formatPercent(value) {
  if (isBlank(value)) return "--";
  const text = String(value);
  return text.endsWith("%") ? text : `${text}%`;
}

function formatUnit(value, units) {
  let numeric = value;
  let index = 0;
  while (Math.abs(numeric) >= 1000 && index < units.length - 1) {
    numeric /= 1000;
    index += 1;
  }
  return `${trimNumber(numeric)} ${units[index]}`;
}

function trimNumber(value) {
  if (!Number.isFinite(value)) return "--";
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1).replace(/\.0$/, "");
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function formatDbm(value) {
  if (value === undefined || value === null || value === "" || String(value) === "-32768") return "--";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return `${value} dBm`;
  return `${numeric > 0 ? -numeric : numeric} dBm`;
}

function formatDb(value) {
  if (value === undefined || value === null || value === "") return "--";
  return `${value} dB`;
}

function formatHexDecimal(value) {
  if (value === undefined || value === null || value === "") return "--";
  const parsed = Number.parseInt(String(value), 16);
  return Number.isFinite(parsed) ? String(parsed) : String(value);
}

function formatCa(value) {
  if (value === "ca_activated") return "active";
  if (value === "ca_deactivated") return "inactive";
  return "none";
}
