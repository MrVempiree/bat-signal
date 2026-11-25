// bat-signal — Vempire uptime/status dashboard
// Pure logic is exported for tests; UI is guarded so importing in Node is safe.

export const HISTORY_CAP = 50;
export const STORAGE_KEY = "bat-signal-targets-v1";
export const DEMO_KEY = "bat-signal-demo-v1";

// ---------- Pure logic ----------

export function isValidUrl(value) {
  if (typeof value !== "string" || value.trim() === "") return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateTargetInput(name, url) {
  const errors = [];
  if (typeof name !== "string" || name.trim() === "") errors.push("Name is required.");
  if (!isValidUrl(url)) errors.push("A valid http:// or https:// URL is required.");
  return { valid: errors.length === 0, errors };
}

export function createTarget(name, url, id) {
  return {
    id: id || `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: String(name).trim(),
    url: String(url).trim(),
    history: [],
    lastStatus: "unknown",
    lastChecked: null,
    lastMs: null,
  };
}

export function addHistoryPoint(history, point, cap = HISTORY_CAP) {
  const next = [...(Array.isArray(history) ? history : []), point];
  return cap > 0 && next.length > cap ? next.slice(next.length - cap) : next;
}

export function computeUptime(history) {
  if (!Array.isArray(history) || history.length === 0) return null;
  const up = history.filter((p) => p && p.ok === true).length;
  return Math.round((up / history.length) * 1000) / 10;
}

export function summarize(targets) {
  const list = Array.isArray(targets) ? targets : [];
  let up = 0;
  let down = 0;
  let unknown = 0;
  const times = [];
  for (const t of list) {
    if (t.lastStatus === "up") up += 1;
    else if (t.lastStatus === "down") down += 1;
    else unknown += 1;
    if (typeof t.lastMs === "number" && Number.isFinite(t.lastMs)) times.push(t.lastMs);
  }
  const avgResponseMs = times.length
    ? Math.round(times.reduce((a, b) => a + b, 0) / times.length)
    : null;
  return { total: list.length, up, down, unknown, avgResponseMs };
}

export function sparklinePoints(history, width = 120, height = 32) {
  if (!Array.isArray(history) || history.length === 0) return "";
  const pad = 2;
  const usableH = Math.max(1, height - pad * 2);
  const values = history.map((p) => (p && typeof p.ms === "number" ? p.ms : 0));
  const maxMs = Math.max(...values, 1);
  if (history.length === 1) {
    const y = history[0].ok ? pad + usableH - (values[0] / maxMs) * usableH : height - pad;
    return `0,${round2(y)} ${width},${round2(y)}`;
  }
  return history
    .map((p, i) => {
      const x = (i / (history.length - 1)) * width;
      const y = p && p.ok ? pad + usableH - ((p.ms || 0) / maxMs) * usableH : height - pad;
      return `${round2(x)},${round2(y)}`;
    })
    .join(" ");
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

export function simulateProbe(random = Math.random) {
  const ok = random() > 0.18;
  const ms = ok ? Math.round(40 + random() * 420) : Math.round(800 + random() * 1200);
  return { ok, ms, status: ok ? "up" : "down" };
}

export async function probeTarget(url, { fetchFn, nowFn } = {}) {
  const doFetch = fetchFn || (typeof fetch !== "undefined" ? fetch : null);
  const now = nowFn || (() => Date.now());
  if (!doFetch) return { ok: false, ms: null, status: "down", error: "fetch unavailable" };
  const start = now();
  try {
    // no-cors: opaque response counts as reachable; we cannot read HTTP status.
    await doFetch(url, { mode: "no-cors", cache: "no-store" });
    const ms = Math.max(0, Math.round(now() - start));
    return { ok: true, ms, status: "up" };
  } catch (err) {
    const ms = Math.max(0, Math.round(now() - start));
    return { ok: false, ms, status: "down", error: String(err && err.message ? err.message : err) };
  }
}

export function applyProbeResult(target, result, timestamp) {
  const t = timestamp ?? Date.now();
  const point = { t, ok: !!result.ok, ms: typeof result.ms === "number" ? result.ms : null };
  return {
    ...target,
    history: addHistoryPoint(target.history, point),
    lastStatus: result.ok ? "up" : "down",
    lastChecked: t,
    lastMs: point.ms,
  };
}

// ---------- UI (browser only) ----------

if (typeof document !== "undefined") {
  const $ = (s) => document.querySelector(s);
  let targets = loadTargets();
  let demoMode = localStorage.getItem(DEMO_KEY) === "1";

  function loadTargets() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(targets));
    localStorage.setItem(DEMO_KEY, demoMode ? "1" : "0");
  }

  function seedDemo() {
    if (targets.length) return;
    const seeds = [
      ["Vempire HQ", "https://example.com"],
      ["Night API", "https://example.org"],
      ["Gotham Mirror", "https://example.net"],
    ];
    targets = seeds.map(([n, u]) => {
      let t = createTarget(n, u);
      for (let i = 0; i < 18; i++) t = applyProbeResult(t, simulateProbe(), Date.now() - (18 - i) * 60000);
      return t;
    });
    save();
  }

  async function checkOne(id) {
    const idx = targets.findIndex((t) => t.id === id);
    if (idx < 0) return;
    targets[idx] = { ...targets[idx], lastStatus: "unknown" };
    render();
    const result = demoMode ? simulateProbe() : await probeTarget(targets[idx].url);
    targets[idx] = applyProbeResult(targets[idx], result);
    save();
    render();
  }

  async function checkAll() {
    for (const t of [...targets]) await checkOne(t.id);
  }

  function fmtTime(ts) {
    return ts ? new Date(ts).toLocaleTimeString() : "never";
  }

  function render() {
    const s = summarize(targets);
    $("#stat-total").textContent = s.total;
    $("#stat-up").textContent = s.up;
    $("#stat-down").textContent = s.down;
    $("#stat-avg").textContent = s.avgResponseMs === null ? "—" : `${s.avgResponseMs} ms`;
    $("#demo-toggle").checked = demoMode;

    const grid = $("#grid");
    grid.innerHTML = "";
    if (!targets.length) {
      grid.innerHTML = `<p class="empty">No targets yet. Add a URL above — or flip Demo Mode to see the signal light up.</p>`;
      return;
    }
    for (const t of targets) {
      const uptime = computeUptime(t.history);
      const card = document.createElement("article");
      card.className = `card status-${t.lastStatus}`;
      card.innerHTML = `
        <div class="card-head">
          <span class="dot" aria-hidden="true"></span>
          <div><h3></h3><a target="_blank" rel="noopener noreferrer"></a></div>
          <span class="badge"></span>
        </div>
        <svg class="spark" viewBox="0 0 120 32" preserveAspectRatio="none" aria-hidden="true">
          <polyline points="${sparklinePoints(t.history)}" fill="none" stroke-width="2"></polyline>
        </svg>
        <dl>
          <div><dt>Response</dt><dd>${t.lastMs === null ? "—" : t.lastMs + " ms"}</dd></div>
          <div><dt>Uptime</dt><dd>${uptime === null ? "—" : uptime + "%"}</dd></div>
          <div><dt>Checked</dt><dd>${fmtTime(t.lastChecked)}</dd></div>
        </dl>
        <div class="card-actions">
          <button type="button" data-check="${t.id}">Check now</button>
          <button type="button" class="ghost" data-remove="${t.id}">Remove</button>
        </div>`;
      card.querySelector("h3").textContent = t.name;
      const a = card.querySelector("a");
      a.href = t.url;
      a.textContent = t.url;
      card.querySelector(".badge").textContent = t.lastStatus;
      grid.appendChild(card);
    }
    grid.querySelectorAll("[data-check]").forEach((b) => b.addEventListener("click", () => checkOne(b.dataset.check)));
    grid.querySelectorAll("[data-remove]").forEach((b) =>
      b.addEventListener("click", () => {
        targets = targets.filter((t) => t.id !== b.dataset.remove);
        save();
        render();
      })
    );
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (demoMode) seedDemo();
    render();
    $("#add-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = $("#name-input").value;
      const url = $("#url-input").value;
      const { valid, errors } = validateTargetInput(name, url);
      const msg = $("#form-msg");
      if (!valid) {
        msg.textContent = errors.join(" ");
        return;
      }
      msg.textContent = "";
      targets = [...targets, createTarget(name, url)];
      save();
      render();
      e.target.reset();
    });
    $("#check-all").addEventListener("click", checkAll);
    $("#demo-toggle").addEventListener("change", (e) => {
      demoMode = e.target.checked;
      if (demoMode) seedDemo();
      save();
      render();
    });
  });
}
