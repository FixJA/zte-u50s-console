import test from "node:test";
import assert from "node:assert/strict";
import { createDebugLogger } from "../lib/debug-log.mjs";
import { normalizeBaseUrl, RouterClient } from "../lib/router-client.mjs";

test("router base URL accepts bare host and strips path", () => {
  assert.equal(normalizeBaseUrl("192.168.0.1"), "http://192.168.0.1");
  assert.equal(normalizeBaseUrl("http://192.168.0.1/index.html#home"), "http://192.168.0.1");
  assert.equal(normalizeBaseUrl("https://router.local/"), "https://router.local");
});

test("router base URL rejects unsupported schemes", () => {
  assert.throws(() => normalizeBaseUrl("ftp://192.168.0.1"), /只支持/);
  assert.throws(() => normalizeBaseUrl(""), /请输入/);
});

test("changing router target clears session and seeds", () => {
  const client = new RouterClient({ baseUrl: "192.168.0.1" });
  client.loggedIn = true;
  client.rd0 = "old";
  client.rd1 = "seed";
  client.cookieJar.set("stok", "abc");
  client.setBaseUrl("192.168.8.1");
  assert.equal(client.session().router, "http://192.168.8.1");
  assert.equal(client.session().loggedIn, false);
  assert.equal(client.rd0, "");
  assert.equal(client.rd1, "");
  assert.equal(client.cookieHeader(), "");
});

test("live network re-logins when protected 5G cell fields disappear", async () => {
  const calls = [];
  const responses = [
    { Language: "zh-cn", cr_version: "cr", wa_inner_version: "wa" },
    { LD: "ld1" },
    { result: "0" },
    {
      network_type: "SA",
      Z5g_rsrp: "-76",
      Z5g_SINR: "17.5",
      nr5g_pci: "",
      nr5g_action_band: "",
      nr5g_cell_id: "",
      nr5g_action_channel: "",
      loginfo: "",
    },
    { LD: "ld2" },
    { result: "0" },
    {
      network_type: "SA",
      Z5g_rsrp: "-75",
      Z5g_SINR: "18",
      nr5g_pci: "23C",
      nr5g_action_band: "N41",
      nr5g_cell_id: "134",
      nr5g_action_channel: "504990",
      loginfo: "ok",
    },
  ];
  const client = new RouterClient({ baseUrl: "192.168.0.1", fetchImpl: createJsonFetch(responses) });

  await client.login("secret");
  const data = await client.liveNetwork();

  assert.equal(data.nr5g.band, "N41");
  assert.equal(data.nr5g.channel, "504990");
  assert.equal(data.nr5g.pci, "572");
  assert.equal(data.session.loggedIn, true);
  assert.equal(client.session().loggedIn, true);
  assert.equal(calls.length, 7);
  assert.equal(calls.filter((call) => call.options.method === "POST").length, 2);

  function createJsonFetch(items) {
    return async (url, options = {}) => {
      calls.push({ url: String(url), options });
      const body = items.shift();
      assert.ok(body, `unexpected request ${options.method || "GET"} ${url}`);
      return jsonResponse(body);
    };
  }
});

test("requestJson emits redacted debug logs when debug logger is enabled", async () => {
  const lines = [];
  const debugLogger = createDebugLogger({ enabled: true, sink: (line) => lines.push(line) });
  const client = new RouterClient({
    baseUrl: "192.168.0.1",
    debugLogger,
    fetchImpl: async () =>
      jsonResponse({
        result: "0",
        LD: "ld-secret",
        nested: { RD: "rd-secret" },
      }),
  });

  await client.requestJson("/goform/goform_set_cmd_process", {
    method: "POST",
    body: {
      goformId: "LOGIN",
      isTest: "false",
      password: "password-secret",
      AD: "ad-secret",
      nested: { token: "token-secret" },
    },
  });

  assert.equal(lines.length, 2);
  assert.match(lines[0], /发送路由器请求/);
  assert.match(lines[1], /收到路由器响应/);
  const joined = lines.join("\n");
  assert.match(joined, /<redacted>/);
  assert.doesNotMatch(joined, /password-secret|ad-secret|token-secret|ld-secret|rd-secret/);
});

test("requestJson stays quiet when debug logger is disabled", async () => {
  const lines = [];
  const debugLogger = createDebugLogger({ enabled: false, sink: (line) => lines.push(line) });
  const client = new RouterClient({
    baseUrl: "192.168.0.1",
    debugLogger,
    fetchImpl: async () => jsonResponse({ result: "0" }),
  });

  await client.requestJson("/goform/goform_get_cmd_process", {
    method: "GET",
    query: { cmd: "loginfo" },
  });

  assert.deepEqual(lines, []);
});

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    headers: {
      get: () => null,
    },
    text: async () => JSON.stringify(body),
  };
}
