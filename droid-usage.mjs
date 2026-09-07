import { createDecipheriv } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const HOME = process.env.HOME || "";
const FACTORY_DIR = `${HOME}/.factory`;
const USAGE_PATH = `${process.env.XDG_STATE_HOME || `${HOME}/.local/state`}/omarchy/agents/usage/droid.json`;
const API_URL = "https://api.factory.ai/api/billing/limits";
const COMPUTE_USAGE_API_URL = "https://api.factory.ai/api/organization/compute-usage";
const AUTH_KEYRING_FILE = `${FACTORY_DIR}/auth.v2.keyring`;
const AUTH_KEYFILE = `${FACTORY_DIR}/auth.v2.file`;
const AUTH_KEYFILE_KEY = `${FACTORY_DIR}/auth.v2.key`;
const AGENT_ID = "droid";
const AGENT_NAME = "Droid";
const TOKEN_EXPIRY_SKEW_SECONDS = 60;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function parseFlexibleDate(value) {
  const numeric = finiteNumber(value);
  if (numeric !== null) {
    const milliseconds = numeric > 1e12 ? numeric : numeric * 1000;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }
  if (typeof value === "string" && value.trim() !== "") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }
  return "";
}

function resetAt(window, nowMs) {
  if (!window || typeof window !== "object") return "";
  const secondsRemaining = finiteNumber(window.secondsRemaining);
  if (secondsRemaining !== null && secondsRemaining > 0) {
    return new Date(nowMs + secondsRemaining * 1000).toISOString();
  }
  const windowEnd = parseFlexibleDate(window.windowEnd);
  return windowEnd && Date.parse(windowEnd) > nowMs ? windowEnd : "";
}

function windowPercent(window, nowMs) {
  const percent = normalizePercent(window?.usedPercent);
  if (percent < 0) return -1;
  const secondsRemaining = finiteNumber(window?.secondsRemaining);
  const windowEnd = parseFlexibleDate(window?.windowEnd);
  const expired = (secondsRemaining === null || secondsRemaining <= 0)
    && windowEnd !== "" && Date.parse(windowEnd) <= nowMs;
  return expired ? 0 : percent;
}

function normalizePercent(value) {
  const percent = finiteNumber(value);
  if (percent === null || percent < 0) return -1;
  const ratio = percent > 1 ? percent / 100 : percent;
  return clamp(ratio, 0, 1);
}

function poolLimits(pool, nowMs = Date.now()) {
  if (!pool || typeof pool !== "object") return [];
  const windows = [
    ["5-hour", pool.fiveHour],
    ["Weekly", pool.weekly],
    ["Monthly", pool.monthly],
  ];
  return windows.flatMap(([label, window]) => {
    const percent = windowPercent(window, nowMs);
    if (percent < 0) return [];
    return [{ label, percent, resetsAt: resetAt(window, nowMs) }];
  });
}

function centsBalance(value) {
  const cents = finiteNumber(value);
  if (cents === null || cents < 0) return null;
  return {
    remaining: cents / 100,
    funded: 0,
    spent: 0,
    currency: "USD",
    estimated: false,
  };
}

function managedComputerUsage(payload) {
  if (!payload || typeof payload !== "object") return null;
  const usedMs = finiteNumber(payload.orgUsageMs);
  const limitMs = finiteNumber(payload.limitMs);
  if (usedMs === null || usedMs < 0 || limitMs === null || limitMs <= 0) return null;
  return {
    usedMs,
    limitMs,
    percent: clamp(usedMs / limitMs, 0, 1),
    resetsAt: parseFlexibleDate(payload.periodEnd),
    overageAllowed: payload.overageAllowed === true,
  };
}

function baseRecord(now = new Date()) {
  return {
    schemaVersion: 1,
    id: AGENT_ID,
    name: AGENT_NAME,
    updatedAt: now.toISOString(),
    ready: false,
    hasLocalStats: false,
    hasPromptStats: false,
    scope: "account",
    tierLabel: "Factory",
    usageStatusText: "",
    authHelpText: "",
    limits: [],
    coreLimits: [],
    managedComputers: null,
    balance: null,
    todayPrompts: 0,
    todaySessions: 0,
    todayTotalTokens: 0,
    todayTokensByModel: {},
    recentDays: [],
    totalPrompts: 0,
    totalSessions: 0,
    activeDays: 0,
    activeDates: [],
    modelUsage: {},
  };
}

function previousRecord() {
  try {
    if (!existsSync(USAGE_PATH)) return null;
    const parsed = JSON.parse(readFileSync(USAGE_PATH, "utf8"));
    return parsed && parsed.id === AGENT_ID ? parsed : null;
  } catch {
    return null;
  }
}

function staleRecord(previous, status, help, retryAdvised, now = new Date()) {
  const record = previous && previous.id === AGENT_ID ? { ...previous } : baseRecord(now);
  record.updatedAt = now.toISOString();
  record.ready = record.ready === true || record.limits?.length > 0
    || record.coreLimits?.length > 0 || !!record.balance;
  record.usageStatusText = `Stale · ${status}`;
  record.authHelpText = help;
  if (retryAdvised) record.retryAdvised = true;
  else delete record.retryAdvised;
  return record;
}

function decodeBase64(value) {
  return Buffer.from(String(value || "").trim(), "base64");
}

function decryptEnvelope(envelope, key) {
  const parts = String(envelope || "").trim().split(":");
  if (parts.length !== 3 || key.length !== 32) return null;
  try {
    const iv = decodeBase64(parts[0]);
    const authTag = decodeBase64(parts[1]);
    const ciphertext = decodeBase64(parts[2]);
    if (iv.length !== 16 || authTag.length !== 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function validCredentials(plaintext) {
  try {
    const credentials = JSON.parse(plaintext);
    if (typeof credentials?.access_token !== "string") return null;
    return { access_token: credentials.access_token };
  } catch {
    return null;
  }
}

function keyringKey(account) {
  try {
    const result = execFileSync(
      "secret-tool",
      ["lookup", "service", "Factory CLI", "account", account],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1000 }
    ).trim();
    const key = decodeBase64(result);
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

function fileKey() {
  try {
    const key = decodeBase64(readFileSync(AUTH_KEYFILE_KEY, "utf8"));
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

function readEncryptedCredentials() {
  const candidates = [];
  for (const account of ["auth-encryption-key", "auth-encryption-key-dev"]) {
    const key = keyringKey(account);
    if (key) candidates.push([AUTH_KEYRING_FILE, key]);
  }
  const key = fileKey();
  if (key) candidates.push([AUTH_KEYFILE, key]);

  for (const [ciphertextPath, encryptionKey] of candidates) {
    try {
      const credentials = validCredentials(
        decryptEnvelope(readFileSync(ciphertextPath, "utf8"), encryptionKey)
      );
      if (credentials) return credentials;
    } catch {
      // A stale key/ciphertext pairing is indistinguishable from a missing login.
    }
  }
  return null;
}

function tokenExpired(token, nowMs = Date.now()) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return true;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof claims.exp !== "number"
      || nowMs >= claims.exp * 1000 - TOKEN_EXPIRY_SKEW_SECONDS * 1000;
  } catch {
    return true;
  }
}

async function fetchLimits(token) {
  const response = await fetch(API_URL, {
    signal: AbortSignal.timeout(5000),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: "https://app.factory.ai",
      Referer: "https://app.factory.ai/",
      "x-factory-client": "web-app",
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) throw new Error("Factory usage request failed");
  const payload = await response.json();
  if (!payload || typeof payload !== "object" || !payload.limits) {
    throw new Error("Factory usage response was invalid");
  }
  return payload;
}

async function fetchComputeUsage(token) {
  const response = await fetch(COMPUTE_USAGE_API_URL, {
    signal: AbortSignal.timeout(5000),
    headers: {
      Accept: "application/json",
      Origin: "https://app.factory.ai",
      Referer: "https://app.factory.ai/",
      "x-factory-client": "web-app",
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) throw new Error("Factory compute usage request failed");
  const payload = await response.json();
  if (!payload || typeof payload !== "object") {
    throw new Error("Factory compute usage response was invalid");
  }
  return payload;
}

function successRecord(payload, now = new Date(), computePayload = null, previous = null) {
  const standard = poolLimits(payload.limits?.standard, now.getTime());
  const core = poolLimits(payload.limits?.core, now.getTime());
  const balance = centsBalance(payload.extraUsageBalanceCents);
  const managedComputers = managedComputerUsage(computePayload)
    || (previous?.managedComputers ?? null);
  const record = {
    ...baseRecord(now),
    ready: standard.length > 0 || core.length > 0 || !!managedComputers || !!balance,
    limits: standard,
    coreLimits: core,
    managedComputers,
    balance,
  };
  if (payload.limits?.core) record.droidCoreAvailable = true;
  return record;
}

function errorRecord(reason, retryAdvised, now = new Date()) {
  const previous = previousRecord();
  return staleRecord(previous, reason, "Open Droid to refresh its login, then refresh this panel.", retryAdvised, now);
}

function writeUsageRecord(record) {
  mkdirSync(dirname(USAGE_PATH), { recursive: true, mode: 0o700 });
  const temporaryPath = `${USAGE_PATH}.${process.pid}.${Math.random().toString(16).slice(2)}`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    renameSync(temporaryPath, USAGE_PATH);
  } finally {
    try {
      if (existsSync(temporaryPath)) {
        // A failed rename must not leave a readable partial snapshot behind.
        unlinkSync(temporaryPath);
      }
    } catch {
      // The next collector run can safely replace the uniquely named temp file.
    }
  }
}

export {
  baseRecord,
  normalizePercent,
  parseFlexibleDate,
  poolLimits,
  managedComputerUsage,
  staleRecord,
  successRecord,
  tokenExpired,
  writeUsageRecord,
};

async function main() {
  const credentials = readEncryptedCredentials();
  let record;
  if (!credentials) {
    record = errorRecord("Droid login unavailable", false);
  } else if (tokenExpired(credentials.access_token)) {
    record = errorRecord("Droid login expired", false);
  } else {
    try {
      const [limits, computeResult] = await Promise.all([
        fetchLimits(credentials.access_token),
        fetchComputeUsage(credentials.access_token).catch(() => null),
      ]);
      record = successRecord(limits, new Date(), computeResult, previousRecord());
    } catch {
      record = errorRecord("Factory usage unavailable", true);
    }
  }
  writeUsageRecord(record);
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
