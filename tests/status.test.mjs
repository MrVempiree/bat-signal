import test from "node:test";
import assert from "node:assert/strict";
import {
  isValidUrl,
  validateTargetInput,
  computeUptime,
  summarize,
  sparklinePoints,
  addHistoryPoint,
  probeTarget,
  simulateProbe,
  applyProbeResult,
  createTarget,
  HISTORY_CAP,
} from "../app.js";

test("isValidUrl accepts http/https and rejects junk", () => {
  assert.equal(isValidUrl("https://example.com"), true);
  assert.equal(isValidUrl("http://example.com/path"), true);
  assert.equal(isValidUrl("ftp://example.com"), false);
  assert.equal(isValidUrl("example.com"), false);
  assert.equal(isValidUrl(""), false);
  assert.equal(isValidUrl(null), false);
});

test("validateTargetInput requires name and valid URL", () => {
  assert.equal(validateTargetInput("HQ", "https://example.com").valid, true);
  assert.equal(validateTargetInput("", "https://example.com").valid, false);
  assert.equal(validateTargetInput("HQ", "nope").valid, false);
});

test("computeUptime calculates percentage and handles empty history", () => {
  assert.equal(computeUptime([]), null);
  assert.equal(computeUptime([{ ok: true }, { ok: true }, { ok: false }, { ok: true }]), 75);
  assert.equal(computeUptime([{ ok: false }, { ok: false }]), 0);
  assert.equal(computeUptime([{ ok: true }]), 100);
});

test("summarize aggregates counts and average response", () => {
  const s = summarize([
    { lastStatus: "up", lastMs: 100 },
    { lastStatus: "up", lastMs: 300 },
    { lastStatus: "down", lastMs: 900 },
    { lastStatus: "unknown", lastMs: null },
  ]);
  assert.deepEqual(s, { total: 4, up: 2, down: 1, unknown: 1, avgResponseMs: 433 });
  assert.deepEqual(summarize([]), { total: 0, up: 0, down: 0, unknown: 0, avgResponseMs: null });
});

test("sparklinePoints generates polyline points within bounds", () => {
  assert.equal(sparklinePoints([]), "");
  const pts = sparklinePoints([{ ok: true, ms: 100 }, { ok: true, ms: 200 }, { ok: false, ms: 900 }], 120, 32);
  const pairs = pts.split(" ");
  assert.equal(pairs.length, 3);
  assert.ok(pairs[0].startsWith("0,"));
  assert.ok(pairs[2].startsWith("120,"));
  for (const p of pairs) {
    const [x, y] = p.split(",").map(Number);
    assert.ok(x >= 0 && x <= 120 && y >= 0 && y <= 32);
  }
  assert.equal(sparklinePoints([{ ok: true, ms: 50 }], 120, 32).split(" ").length, 2);
});

test("addHistoryPoint caps history at the limit", () => {
  let h = [];
  for (let i = 0; i < 60; i++) h = addHistoryPoint(h, { t: i, ok: true, ms: i });
  assert.equal(h.length, HISTORY_CAP);
  assert.equal(h[0].t, 10);
  assert.equal(h.at(-1).t, 59);
  assert.equal(addHistoryPoint([1, 2], 3, 2).join(","), "2,3");
});

test("probeTarget counts opaque no-cors response as up (mocked fetch)", async () => {
  let calls = 0;
  const fetchFn = async (url, opts) => { calls++; assert.equal(opts.mode, "no-cors"); return { type: "opaque" }; };
  let t = 1000;
  const r = await probeTarget("https://example.com", { fetchFn, nowFn: () => (t += 120) });
  assert.equal(calls, 1);
  assert.equal(r.ok, true);
  assert.equal(r.status, "up");
  assert.equal(r.ms, 120);
});

test("probeTarget reports down when fetch rejects", async () => {
  const r = await probeTarget("https://example.com", { fetchFn: async () => { throw new Error("boom"); }, nowFn: () => 0 });
  assert.equal(r.ok, false);
  assert.equal(r.status, "down");
});

test("simulateProbe is deterministic with injected random", () => {
  assert.equal(simulateProbe(() => 0.9).ok, true);
  assert.equal(simulateProbe(() => 0.1).ok, false);
});

test("applyProbeResult updates target status and history", () => {
  const t0 = createTarget("HQ", "https://example.com", "fixed-id");
  const t1 = applyProbeResult(t0, { ok: true, ms: 42 }, 1234);
  assert.equal(t1.lastStatus, "up");
  assert.equal(t1.lastMs, 42);
  assert.equal(t1.lastChecked, 1234);
  assert.equal(t1.history.length, 1);
  assert.equal(t0.history.length, 0); // original untouched
});
