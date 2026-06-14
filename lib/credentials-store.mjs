import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_CREDS_DIR = path.join(os.homedir(), ".zte-debug");
const KEY_FILE = "master.key";
const CREDS_FILE = "credentials.enc";

export function getCredsDir({ dir = DEFAULT_CREDS_DIR } = {}) {
  return dir;
}

export function getMasterKeyPath({ dir = DEFAULT_CREDS_DIR } = {}) {
  return path.join(dir, KEY_FILE);
}

export function getCredentialsPath({ dir = DEFAULT_CREDS_DIR } = {}) {
  return path.join(dir, CREDS_FILE);
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 }).catch((err) => {
    if (err.code !== "EEXIST") throw err;
  });
}

// 读取或生成 32 字节主密钥。使用 flag:"wx" 原子创建, 不覆盖已有文件。
export async function ensureMasterKey({ dir = DEFAULT_CREDS_DIR } = {}) {
  await ensureDir(dir);
  const keyPath = getMasterKeyPath({ dir });
  try {
    return await fs.readFile(keyPath);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  const key = crypto.randomBytes(32);
  try {
    await fs.writeFile(keyPath, key, { mode: 0o600, flag: "wx" });
    return key;
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  }
  return fs.readFile(keyPath);
}

// AES-256-GCM 加密 { password, routerBaseUrl }, 写入 credentials.enc (0600)
export async function saveCredentials({ password, routerBaseUrl }, { dir = DEFAULT_CREDS_DIR } = {}) {
  await ensureDir(dir);
  const key = await ensureMasterKey({ dir });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify({ password, routerBaseUrl }), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope = {
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  await fs.writeFile(getCredentialsPath({ dir }), JSON.stringify(envelope), { mode: 0o600 });
  return { password, routerBaseUrl };
}

// 解密并返回 { password, routerBaseUrl }; credentials.enc 缺失返回 null;
// master.key 缺失或 GCM 标签不匹配时抛错。
export async function loadCredentials({ dir = DEFAULT_CREDS_DIR } = {}) {
  const credsPath = getCredentialsPath({ dir });
  let envelope;
  try {
    envelope = JSON.parse(await fs.readFile(credsPath, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  const key = await fs.readFile(getMasterKeyPath({ dir }));
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}

// 删除 credentials.enc; 文件不存在为 no-op; 永不触碰 master.key
export async function clearCredentials({ dir = DEFAULT_CREDS_DIR } = {}) {
  await fs.unlink(getCredentialsPath({ dir })).catch((err) => {
    if (err.code !== "ENOENT") throw err;
  });
}
