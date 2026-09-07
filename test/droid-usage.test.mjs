import assert from "node:assert/strict";
import test from "node:test";

import {
  baseRecord,
  managedComputerUsage,
  normalizePercent,
  parseFlexibleDate,
  poolLimits,
  staleRecord,
  successRecord,
  tokenExpired,
} from "../droid-usage.mjs";

test("normalizes API percentages to panel ratios", () => {
  assert.equal(normalizePercent(23), 0.23);
  assert.equal(normalizePercent(0.23), 0.23);
  assert.equal(normalizePercent(150), 1);
  assert.equal(normalizePercent(-1), -1);
});

test("normalizes reset timestamps and rolling windows", () => {
  const now = Date.parse("2026-09-07T12:00:00.000Z");
  const limits = poolLimits({
    fiveHour: { usedPercent: 23, secondsRemaining: 3600 },
    weekly: { usedPercent: 10, windowEnd: "2026-09-08T12:00:00Z" },
    monthly: { usedPercent: 9, windowEnd: 1788782400 },
  }, now);

  assert.deepEqual(limits.map((limit) => limit.label), ["5-hour", "Weekly", "Monthly"]);
  assert.equal(limits[0].percent, 0.23);
  assert.equal(limits[0].resetsAt, "2026-09-07T13:00:00.000Z");
  assert.equal(limits[1].resetsAt, "2026-09-08T12:00:00.000Z");
  assert.equal(parseFlexibleDate(1788782400), "2026-09-07T12:00:00.000Z");
});

test("resets expired usage when Factory leaves a stale percentage", () => {
  const now = Date.parse("2026-09-07T12:00:00.000Z");
  const limits = poolLimits({
    fiveHour: { usedPercent: 62, windowEnd: "2026-09-07T11:00:00Z" },
  }, now);

  assert.equal(limits[0].percent, 0);
  assert.equal(limits[0].resetsAt, "");
});

test("normalizes Managed Computers usage", () => {
  assert.deepEqual(managedComputerUsage({
    orgUsageMs: 2250000,
    limitMs: 36000000,
    periodEnd: "2026-10-01T00:00:00Z",
    overageAllowed: false,
  }), {
    usedMs: 2250000,
    limitMs: 36000000,
    percent: 0.0625,
    resetsAt: "2026-10-01T00:00:00.000Z",
    overageAllowed: false,
  });
});

test("maps Standard, Core, Managed Computers, and Extra Usage", () => {
  const record = successRecord({
    limits: {
      standard: {
        fiveHour: { usedPercent: 23, secondsRemaining: 3600 },
        weekly: { usedPercent: 10, secondsRemaining: 86400 },
        monthly: { usedPercent: 9, secondsRemaining: 1468800 },
      },
      core: {
        fiveHour: { usedPercent: 0 },
        weekly: { usedPercent: 31, secondsRemaining: 86400 },
        monthly: { usedPercent: 0 },
      },
    },
    extraUsageBalanceCents: 0,
  }, new Date("2026-09-07T12:00:00Z"), {
    orgUsageMs: 2250000,
    limitMs: 36000000,
    periodEnd: "2026-10-01T00:00:00Z",
  });

  assert.equal(record.ready, true);
  assert.equal(record.limits[0].percent, 0.23);
  assert.equal(record.coreLimits[1].percent, 0.31);
  assert.equal(record.droidCoreAvailable, true);
  assert.equal(record.managedComputers.percent, 0.0625);
  assert.equal(record.balance.remaining, 0);
});

test("keeps the last successful record while marking failures stale", () => {
  const previous = {
    ...baseRecord(new Date("2026-09-07T11:00:00Z")),
    ready: true,
    limits: [{ label: "5-hour", percent: 0.23, resetsAt: "2026-09-07T13:00:00Z" }],
  };
  const stale = staleRecord(
    previous,
    "Droid login expired",
    "Open Droid to refresh its login, then refresh this panel.",
    false,
    new Date("2026-09-07T12:00:00Z")
  );

  assert.equal(stale.ready, true);
  assert.equal(stale.limits[0].percent, 0.23);
  assert.equal(stale.usageStatusText, "Stale · Droid login expired");
  assert.equal(stale.retryAdvised, undefined);
});

test("treats malformed or near-expiry JWTs as expired", () => {
  assert.equal(tokenExpired("not-a-token", Date.now()), true);
  const payload = Buffer.from(JSON.stringify({ exp: 1000 })).toString("base64url");
  assert.equal(tokenExpired(`a.${payload}.c`, 1000 * 1000 - 60 * 1000), true);
});
