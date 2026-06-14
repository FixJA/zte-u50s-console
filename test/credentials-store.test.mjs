import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureMasterKey,
  saveCredentials,
  loadCredentials,
  clearCredentials,
  getMasterKeyPath,
  getCredentialsPath,
} from "../lib/credentials-store.mjs";

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "zte-creds-"));
}

test("save then load roundtrips password and routerBaseUrl", async () => {
  const dir = await makeTempDir();
  await saveCredentials({ password: "p@ssw0rd", routerBaseUrl: "http://192.168.0.1" }, { dir });
  const loaded = await loadCredentials({ dir });
  assert.deepEqual(loaded, { password: "p@ssw0rd", routerBaseUrl: "http://192.168.0.1" });
});

test("load returns null when credentials file is missing", async () => {
  const dir = await makeTempDir();
  const loaded = await loadCredentials({ dir });
  assert.equal(loaded, null);
});

test("load throws when ciphertext has been tampered with", async () => {
  const dir = await makeTempDir();
  await saveCredentials({ password: "secret", routerBaseUrl: "http://1.2.3.4" }, { dir });
  const credsPath = getCredentialsPath({ dir });
  const envelope = JSON.parse(await fs.readFile(credsPath, "utf8"));
  const flipped = envelope.ciphertext.slice(0, 4) + (envelope.ciphertext[4] === "A" ? "B" : "A") + envelope.ciphertext.slice(5);
  envelope.ciphertext = flipped;
  await fs.writeFile(credsPath, JSON.stringify(envelope));
  await assert.rejects(() => loadCredentials({ dir }));
});

test("load throws when auth tag has been tampered with", async () => {
  const dir = await makeTempDir();
  await saveCredentials({ password: "secret", routerBaseUrl: "http://1.2.3.4" }, { dir });
  const credsPath = getCredentialsPath({ dir });
  const envelope = JSON.parse(await fs.readFile(credsPath, "utf8"));
  const flipped = envelope.tag.slice(0, 4) + (envelope.tag[4] === "A" ? "B" : "A") + envelope.tag.slice(5);
  envelope.tag = flipped;
  await fs.writeFile(credsPath, JSON.stringify(envelope));
  await assert.rejects(() => loadCredentials({ dir }));
});

test("ensureMasterKey creates a 32-byte file with 0600 perms when missing", async () => {
  const dir = await makeTempDir();
  const key = await ensureMasterKey({ dir });
  assert.equal(key.length, 32);
  const stat = await fs.stat(getMasterKeyPath({ dir }));
  const mode = stat.mode & 0o777;
  assert.equal(mode, 0o600);
  assert.equal(stat.size, 32);
});

test("ensureMasterKey is idempotent — returns same bytes on repeated calls", async () => {
  const dir = await makeTempDir();
  const first = await ensureMasterKey({ dir });
  const second = await ensureMasterKey({ dir });
  assert.deepEqual(first, second);
});

test("load throws when master.key is missing but credentials.enc exists", async () => {
  const dir = await makeTempDir();
  await saveCredentials({ password: "x", routerBaseUrl: "http://r" }, { dir });
  await fs.unlink(getMasterKeyPath({ dir }));
  await assert.rejects(() => loadCredentials({ dir }));
});

test("clearCredentials is a no-op when file is missing", async () => {
  const dir = await makeTempDir();
  await clearCredentials({ dir });
  const stat = await fs.stat(getCredentialsPath({ dir })).catch(() => null);
  assert.equal(stat, null);
});

test("clearCredentials removes credentials.enc after save", async () => {
  const dir = await makeTempDir();
  await saveCredentials({ password: "x", routerBaseUrl: "http://r" }, { dir });
  await clearCredentials({ dir });
  const loaded = await loadCredentials({ dir });
  assert.equal(loaded, null);
});

test("clearCredentials never deletes master.key", async () => {
  const dir = await makeTempDir();
  await saveCredentials({ password: "x", routerBaseUrl: "http://r" }, { dir });
  await clearCredentials({ dir });
  const stat = await fs.stat(getMasterKeyPath({ dir }));
  assert.equal(stat.size, 32);
});
