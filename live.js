/* Gemensam live-status för avbockade tidtagningspunkter. */
(function (global) {
  const TOPIC = "utsattning_thomazzo91_v2live_r8k3n2";
  const BASE = "https://ntfy.sh/" + TOPIC;
  const CACHE_KEY = "utsattning-live-cache";
  const items = {};
  const listeners = [];
  let es = null;
  let connected = false;
  let lastEventAt = 0;
  let sinceId = "all";
  let okAt = 0;

  function notify() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ items: items, saved: Date.now() })); } catch (e) {}
    listeners.forEach((fn) => {
      try { fn(items); } catch (e) {}
    });
  }

  function sameRec(a, b) {
    return !!(a && b &&
      Number(a.t) === Number(b.t) &&
      !!a.on === !!b.on &&
      String(a.who || "") === String(b.who || "") &&
      String(a.label || "") === String(b.label || ""));
  }

  function applyRec(rec, silent) {
    if (!rec || !rec.k) return false;
    const prev = items[rec.k];
    if (prev && Number(prev.t) > Number(rec.t)) return false;
    if (sameRec(prev, rec)) return false;
    items[rec.k] = rec;
    lastEventAt = Math.max(lastEventAt, Number(rec.t) || 0);
    if (!silent) notify();
    return true;
  }

  function applyRaw(raw) {
    if (!raw) return;
    try { applyRec(typeof raw === "string" ? JSON.parse(raw) : raw); } catch (e) {}
  }

  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (cached && cached.items && typeof cached.items === "object") {
      Object.keys(cached.items).forEach((k) => { items[k] = cached.items[k]; });
    }
  } catch (e) {}

  async function replay() {
    const res = await fetch(BASE + "/json?poll=1&since=" + encodeURIComponent(sinceId), { cache: "no-store" });
    if (!res.ok) return;
    okAt = Date.now();
    connected = true;
    const text = await res.text();
    let changed = false;
    text.split("\n").forEach((line) => {
      if (!line.trim()) return;
      try {
        const msg = JSON.parse(line);
        if (msg && msg.id) sinceId = msg.id;
        if (msg && msg.event === "message") {
          if (applyRec(typeof msg.message === "string" ? JSON.parse(msg.message) : msg.message, true)) changed = true;
        }
      } catch (e) {}
    });
    if (sinceId === "all") sinceId = String(Math.floor(Date.now() / 1000));
    if (changed) notify();
  }

  function connect() {
    if (es) {
      try { es.close(); } catch (e) {}
      es = null;
    }
    es = new EventSource(BASE + "/sse");
    es.onopen = () => {
      const was = connected;
      connected = true;
      if (!was) notify();
    };
    es.onmessage = (e) => {
      connected = true;
      try {
        const msg = JSON.parse(e.data);
        if (msg && msg.event === "message") applyRaw(msg.message);
        else applyRaw(e.data);
      } catch (err) {
        applyRaw(e.data);
      }
    };
    es.onerror = () => {
      if (!connected) return;
      connected = false;
      notify();
    };
  }

  async function start() {
    try { await replay(); } catch (e) {}
    connect();
    setInterval(() => { replay().catch(() => {}); }, 2500);
  }

  function report(ev, team, label, on, who) {
    const rec = {
      k: String(ev || "") + "|" + String(team || "") + "|" + String(label || ""),
      ev: ev || "",
      team: team || "",
      label: label || "",
      on: !!on,
      t: Date.now(),
      who: who || ""
    };
    applyRec(rec);
    return fetch(BASE, { method: "POST", body: JSON.stringify(rec) }).catch(() => {});
  }

  function get(ev, team, label) {
    return items[String(ev || "") + "|" + String(team || "") + "|" + String(label || "")] || null;
  }

  function isOn(ev, team, label) {
    const rec = get(ev, team, label);
    return !!(rec && rec.on);
  }

  start();

  global.MattorLive = {
    report: report,
    get: get,
    isOn: isOn,
    items: items,
    on: function (fn) { listeners.push(fn); try { fn(items); } catch (e) {} },
    connected: function () { return connected && ((es && es.readyState === 1) || (Date.now() - okAt < 8000)); },
    lastEventAt: function () { return lastEventAt; },
    replay: replay
  };
})(window);
