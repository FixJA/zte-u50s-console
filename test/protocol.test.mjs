import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLock4gPayload,
  buildLock5gCellPayload,
  buildLock5gPayload,
  buildUnlock5gCellPayload,
  buildDisableThermalPayload,
  buildEnableThermalPayload,
  buildThermalSwitchPayload,
  computeAd,
  decodeLteMask,
  encodeLoginPassword,
  formatRate,
  formatTemperature,
  inferThermalDetectedState,
  isLoginExpired,
  isNr5gCellDataRestricted,
  normalizeBattery,
  normalizeCoreThermalSensors,
  normalizeLiveNetwork,
  normalizeSignal,
  normalizeThermal,
  normalizeWifiStatus,
  normalizeWpsStatus,
  sha256Upper,
  wifiSecurityLabel,
  buildWifiQrPayload,
  buildWifiSwitchPayload,
  buildWpsPbcPayload,
  decodeBase64,
  escapeWifiQr,
  mapAuthModeToQr,
} from "../lib/zte-protocol.mjs";

test("login password encoding follows ZTE SHA mode 2", () => {
  const password = "router-pass";
  const ld = "nonce";
  assert.equal(encodeLoginPassword(password, ld, 2), sha256Upper(`${sha256Upper(password)}${ld}`));
});

test("AD uses nested SHA256 over rd seeds and RD", () => {
  assert.equal(computeAd("a", "b", "c"), sha256Upper(`${sha256Upper("ab")}c`));
});

test("4G lock payload converts selected bands to ZTE bitmask", () => {
  const payload = buildLock4gPayload(["1", "3"]);
  assert.deepEqual(payload, {
    goformId: "BAND_SELECT",
    isTest: "false",
    is_gw_band: "0",
    gw_band_mask: "0",
    is_lte_band: "1",
    lte_band_mask: "0x0000000000000005",
  });
  assert.deepEqual(decodeLteMask(payload.lte_band_mask), ["1", "3"]);
});

test("5G lock payload uses the effective generic goformId only", () => {
  assert.deepEqual(buildLock5gPayload(["41", "78"]), {
    goformId: "WAN_PERFORM_NR5G_BAND_LOCK",
    isTest: "false",
    nr5g_band_mask: "41,78",
  });
});

test("empty and unsupported bands are rejected", () => {
  assert.throws(() => buildLock4gPayload([]), /至少需要选择/);
  assert.throws(() => buildLock4gPayload(["2"]), /不支持/);
  assert.throws(() => buildLock5gPayload([]), /至少需要选择/);
  assert.throws(() => buildLock5gPayload(["2"]), /不支持/);
});

test("signal normalization tolerates missing fields", () => {
  const data = normalizeSignal({ network_type: "SA", Z5g_rsrp: "-82", Z5g_SINR: "22", nr5g_pci: "1A" });
  assert.equal(data.mode, "5G");
  assert.equal(data.nr5g.rsrp, "-82 dBm");
  assert.equal(data.nr5g.sinr, "22 dB");
  assert.equal(data.nr5g.pci, "26");
  assert.equal(data.lte.rsrp, "--");
});

test("live telemetry normalizes rate, battery, thermal and session fields", () => {
  const data = normalizeLiveNetwork({
    network_type: "ENDC",
    realtime_rx_thrpt: "125000",
    realtime_tx_thrpt: "25000",
    battery_value: "45",
    external_charging_flag: "1",
    battery_temp: "31000",
    battery_discharge_reason: "hot",
    thermal_control_enable: "1",
    thermal_led_enable: "0",
    wifi_chip_temp: "43",
    pm_modem_5g: "51500",
    loginfo: "ok",
  });
  assert.equal(data.traffic.download, "1 Mb/s");
  assert.equal(data.traffic.upload, "200 Kb/s");
  assert.equal(data.battery.percent, "45%");
  assert.equal(data.battery.externalPower, true);
  assert.equal(data.battery.temperature, "31 °C");
  assert.equal(data.battery.dischargeReason, "hot");
  assert.equal(data.thermal.enabled, "开启");
  assert.equal(data.thermal.ledEnabled, "关闭");
  assert.equal(data.thermal.detectedState, "on");
  assert.equal(data.thermal.hasCoreTemperature, true);
  assert.equal(data.thermal.sensors.wifiChip, "43 °C");
  assert.equal(data.thermal.sensors.modem5g, "51.5 °C");
  assert.equal(data.session.loggedIn, true);
});

test("blank telemetry values render safely", () => {
  assert.equal(formatRate(""), "--");
  assert.equal(formatTemperature(""), "--");
  assert.equal(formatTemperature("-274"), "--");
  assert.equal(normalizeBattery({}).percent, "--");
  assert.equal(normalizeThermal({}).sensors.pa, "--");
  assert.equal(normalizeThermal({ thermal_led_enable: "95" }).ledEnabled, "95");
});

test("core thermal sensors detect valid PA1 MDM or 5G modem temperatures", () => {
  const sensors = normalizeCoreThermalSensors({ pm_sensor_pa1: "-274", pm_sensor_mdm: "", pm_modem_5g: "NaN" });
  assert.equal(sensors.pa1.valid, false);
  assert.equal(sensors.pa1.closed, true);
  assert.equal(inferThermalDetectedState({ pm_sensor_pa1: "-274", pm_sensor_mdm: "46000", pm_modem_5g: "-274" }), "on");
  assert.equal(inferThermalDetectedState({ pm_sensor_pa1: "-274", pm_sensor_mdm: "", pm_modem_5g: "bad" }), "unknown");
});

test("-274 on all core thermal sensors means thermal control is closed", () => {
  const raw = { pm_sensor_pa1: "-274", pm_sensor_mdm: "-274", pm_modem_5g: "-274" };
  const thermal = normalizeThermal(raw);
  assert.equal(thermal.coreClosed, true);
  assert.equal(thermal.detectedState, "off");
  assert.equal(inferThermalDetectedState(raw), "off");
  assert.equal(inferThermalDetectedState(raw, { target: true, startedAtMs: 1000, nowMs: 2000, windowMs: 300000 }), "off");
});

test("thermal state probing window avoids early off detection", () => {
  const raw = { pm_sensor_pa1: "", pm_sensor_mdm: "", pm_modem_5g: "bad" };
  assert.equal(inferThermalDetectedState(raw, { target: true, startedAtMs: 1000, nowMs: 2000, windowMs: 300000 }), "probing");
  assert.equal(inferThermalDetectedState(raw, { target: false, startedAtMs: 1000, nowMs: 2000, windowMs: 300000 }), "probing");
  assert.equal(inferThermalDetectedState(raw, { target: false, startedAtMs: 1000, nowMs: 302000, windowMs: 300000 }), "off");
  assert.equal(inferThermalDetectedState(raw, { target: true, startedAtMs: 1000, nowMs: 302000, windowMs: 300000 }), "unknown");
});

test("login expiry is detected from loginfo", () => {
  assert.equal(isLoginExpired({ loginfo: "ok" }), false);
  assert.equal(isLoginExpired({ loginfo: "" }), false);
  assert.equal(isLoginExpired({ loginfo: "" }, { requireLoginfoOk: true }), true);
  assert.equal(isLoginExpired({ loginfo: "login" }), true);
});

test("restricted 5G cell data is detected only for active 5G signal", () => {
  assert.equal(isNr5gCellDataRestricted({ network_type: "SA", Z5g_rsrp: "-76" }), true);
  assert.equal(isNr5gCellDataRestricted({ network_type: "ENDC", Z5g_SINR: "18", nr5g_pci: "1A" }), false);
  assert.equal(isNr5gCellDataRestricted({ network_type: "LTE", lte_rsrp: "-80" }), false);
  assert.equal(isNr5gCellDataRestricted({ network_type: "SA" }), false);
});

test("thermal disable payload uses the original temp_status action only", () => {
  assert.deepEqual(buildDisableThermalPayload(), {
    goformId: "THERML_CONTROL_SWITCH_SET",
    isTest: "false",
    therml_control_switch: "0",
  });
});

test("thermal enable payload uses the original thermal switch action", () => {
  assert.deepEqual(buildEnableThermalPayload({ thermal_led_enable: "0" }), {
    goformId: "THERML_CONTROL_SWITCH_SET",
    isTest: "false",
    therml_control_switch: "1",
  });
});

test("thermal switch payload selects enable or disable action", () => {
  assert.deepEqual(buildThermalSwitchPayload(true, { thermal_led_enable: "1" }), {
    goformId: "THERML_CONTROL_SWITCH_SET",
    isTest: "false",
    therml_control_switch: "1",
  });
  assert.equal(buildThermalSwitchPayload(false).goformId, "THERML_CONTROL_SWITCH_SET");
  assert.throws(() => buildThermalSwitchPayload("true"), /必须是 true 或 false/);
});

test("5G cell lock payload joins PCI, EARFCN, band and SCS into one field", () => {
  assert.deepEqual(buildLock5gCellPayload({ pci: "572", earfcn: "504990", band: "41", scs: "1" }), {
    goformId: "NR5G_LOCK_CELL_SET",
    isTest: "false",
    nr5g_cell_lock: "572,504990,41,1",
  });
});

test("5G cell lock strips optional n prefix from band and trims whitespace", () => {
  assert.equal(
    buildLock5gCellPayload({ pci: " 26 ", earfcn: " 643360 ", band: "n78", scs: "1" }).nr5g_cell_lock,
    "26,643360,78,1",
  );
});

test("5G cell lock rejects missing, non-decimal or out-of-range PCI", () => {
  assert.throws(() => buildLock5gCellPayload({ earfcn: "504990", band: "41", scs: "1" }), /PCI/);
  assert.throws(() => buildLock5gCellPayload({ pci: "23C", earfcn: "504990", band: "41", scs: "1" }), /PCI 必须/);
  assert.throws(() => buildLock5gCellPayload({ pci: "2000", earfcn: "504990", band: "41", scs: "1" }), /PCI 取值/);
  assert.throws(() => buildLock5gCellPayload({ pci: "572", band: "41", scs: "1" }), /EARFCN/);
  assert.throws(() => buildLock5gCellPayload({ pci: "572", earfcn: "abc", band: "41", scs: "1" }), /EARFCN 必须/);
  assert.throws(() => buildLock5gCellPayload({ pci: "572", earfcn: "504990", scs: "1" }), /Band/);
  assert.throws(() => buildLock5gCellPayload({ pci: "572", earfcn: "504990", band: "n41a", scs: "1" }), /Band 必须/);
  assert.throws(() => buildLock5gCellPayload({ pci: "572", earfcn: "504990", band: "41", scs: "5" }), /SCS/);
});

test("5G cell unlock payload sends the canonical 1,1,1,1 release token", () => {
  assert.deepEqual(buildUnlock5gCellPayload(), {
    goformId: "NR5G_LOCK_CELL_SET",
    isTest: "false",
    nr5g_cell_lock: "1,1,1,1",
  });
});

test("WiFi switch payload maps boolean to SwitchOption and rejects non-boolean", () => {
  assert.deepEqual(buildWifiSwitchPayload(true), {
    goformId: "switchWiFiModule",
    isTest: "false",
    SwitchOption: "1",
  });
  assert.equal(buildWifiSwitchPayload(false).SwitchOption, "0");
  assert.throws(() => buildWifiSwitchPayload("true"), /必须是 true 或 false/);
});

test("WPS PBC payload defaults ChipIndex/AP index to 0 and coerces to string", () => {
  assert.deepEqual(buildWpsPbcPayload(), {
    goformId: "startWps",
    isTest: "false",
    ChipIndex: "0",
    WpsMode: "PBC",
    ActiveWpsAccessPointIndex: "0",
  });
  assert.equal(buildWpsPbcPayload({ chipIndex: 1 }).ChipIndex, "1");
  assert.equal(buildWpsPbcPayload({ accessPointIndex: 1 }).ActiveWpsAccessPointIndex, "1");
});

test("normalizeWpsStatus maps queryWpsStatus ResponseList to per-chip state", () => {
  const raw = {
    ResponseList: [
      { ChipIndex: "0", ActiveWpsAccessPointIndex: "0", WpsStatus: "1", WpsMode: "PBC" },
      { ChipIndex: "1", ActiveWpsAccessPointIndex: "0", WpsStatus: "0", WpsMode: "" },
    ],
  };
  assert.deepEqual(normalizeWpsStatus(raw), [
    { chipIndex: "0", accessPointIndex: "0", active: true, mode: "PBC" },
    { chipIndex: "1", accessPointIndex: "0", active: false, mode: "" },
  ]);
});

test("normalizeWpsStatus returns empty list when ResponseList is missing", () => {
  assert.deepEqual(normalizeWpsStatus({}), []);
  assert.deepEqual(normalizeWpsStatus(undefined), []);
});

test("normalizeWifiStatus emits separate 2.4G/5G QR codes when dual-band is split", () => {
  const data = normalizeWifiStatus({
    wifi_onoff_state: "1",
    wifi_chip1_ssid1_ssid: "MyHotspot",
    wifi_chip2_ssid1_ssid: "MyHotspot_5G",
    wifi_chip1_ssid1_auth_mode: "WPA2PSK",
    wifi_chip2_ssid1_auth_mode: "WPA2PSK",
    m_HideSSID: "0",
    wifi_chip1_ssid1_password: Buffer.from("s3cret").toString("base64"),
    wifi_chip2_ssid1_password: Buffer.from("five-pass").toString("base64"),
  });
  assert.equal(data.enabled, true);
  assert.equal(data.ssid, "MyHotspot");
  assert.equal(data.ssid5g, "MyHotspot_5G");
  assert.equal(data.sync, false);
  assert.equal(data.qrCodes.length, 2);
  assert.equal(data.qrCodes[0].label, "2.4G");
  assert.equal(data.qrCodes[0].qrPayload, "WIFI:T:WPA;S:MyHotspot;P:s3cret;;");
  assert.equal(data.qrCodes[1].label, "5G");
  assert.equal(data.qrCodes[1].qrPayload, "WIFI:T:WPA;S:MyHotspot_5G;P:five-pass;;");
});

test("normalizeWifiStatus collapses to a single QR when dual-band is unified", () => {
  const data = normalizeWifiStatus({
    wifi_onoff_state: "1",
    wifi_chip1_ssid1_ssid: "ZTE_4847F6",
    wifi_chip2_ssid1_ssid: "ZTE_4847F6",
    wifi_chip1_ssid1_auth_mode: "WPA2PSK",
    wifi_chip2_ssid1_auth_mode: "WPA2PSK",
    wifi_chip1_ssid1_password: Buffer.from("s3cret").toString("base64"),
    wifi_syncparas_flag: "1",
  });
  assert.equal(data.sync, true);
  assert.equal(data.qrCodes.length, 1);
  assert.equal(data.qrCodes[0].label, "2.4G 和 5G");
  assert.equal(data.qrCodes[0].qrPayload, "WIFI:T:WPA;S:ZTE_4847F6;P:s3cret;;");
});

test("normalizeWifiStatus returns placeholders and no QR codes when the router returns nothing", () => {
  const data = normalizeWifiStatus({});
  assert.equal(data.enabled, null);
  assert.equal(data.enabledLabel, "--");
  assert.equal(data.ssid, "--");
  assert.equal(data.security, "--");
  assert.equal(data.securityLabel, "--");
  assert.equal(data.hidden, false);
  assert.deepEqual(data.qrCodes, []);
});

test("mapAuthModeToQr collapses WPA variants to WPA and open networks to nopass", () => {
  assert.equal(mapAuthModeToQr("WPA2PSK"), "WPA");
  assert.equal(mapAuthModeToQr("WPA3PSK"), "WPA");
  assert.equal(mapAuthModeToQr("WPA2PSKWPA3PSK"), "WPA");
  assert.equal(mapAuthModeToQr("WPAPSK"), "WPA");
  assert.equal(mapAuthModeToQr("OPEN"), "nopass");
  assert.equal(mapAuthModeToQr(""), "nopass");
  assert.equal(mapAuthModeToQr("WEP"), "WEP");
});

test("wifiSecurityLabel renders friendly security names", () => {
  assert.equal(wifiSecurityLabel("WPA2PSK"), "WPA2-PSK");
  assert.equal(wifiSecurityLabel("WPA2PSKWPA3PSK"), "WPA2/WPA3");
  assert.equal(wifiSecurityLabel("OPEN"), "开放");
  assert.equal(wifiSecurityLabel(""), "--");
});

test("escapeWifiQr escapes backslash first then delimiters", () => {
  assert.equal(escapeWifiQr("a\\b;c,c:d"), "a\\\\b\\;c\\,c\\:d");
});

test("buildWifiQrPayload emits nopass for open networks and WPA when a password is known", () => {
  assert.equal(
    buildWifiQrPayload({ ssid: "Open", password: "", security: "OPEN", hidden: false }),
    "WIFI:T:nopass;S:Open;;",
  );
  assert.equal(
    buildWifiQrPayload({ ssid: "Net", password: "p", security: "WPA2PSK", hidden: true }),
    "WIFI:T:WPA;S:Net;P:p;H:true;;",
  );
  // 密码存在但 AuthMode 缺失:仍按 WPA 生成,避免误判为开放网络
  assert.equal(
    buildWifiQrPayload({ ssid: "Net", password: "p", security: "", hidden: false }),
    "WIFI:T:WPA;S:Net;P:p;;",
  );
  // SSID 未知:返回空串,前端据此跳过二维码渲染
  assert.equal(buildWifiQrPayload({ ssid: "--", password: "p", security: "WPA2PSK" }), "");
  assert.equal(buildWifiQrPayload({}), "");
});

test("decodeBase64 round-trips a base64 string back to utf-8", () => {
  assert.equal(decodeBase64(Buffer.from("hello").toString("base64")), "hello");
});
