/* Gemensam live-status för avbockade tidtagningspunkter. */
(function (global) {
  const TOPIC = "utsattning_thomazzo91_v2live_r8k3n2";
  const HOSTS = [
    "https://ntfy.adminforge.de/" + TOPIC,
    "https://ntfy.sh/" + TOPIC
  ];
  const CACHE_KEY = "utsattning-live-cache";
  const items = {};
  const listeners = [];
  const feeds = HOSTS.map((base) => ({ base: base, es: null, since: "12h", failUntil: 0 }));
  let lastEventAt = 0;
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

  function applyEnvelope(raw, silent) {
    if (!raw) return false;
    let msg = raw;
    if (typeof raw === "string") {
      try { msg = JSON.parse(raw); } catch (e) { return false; }
    }
    if (!msg || typeof msg !== "object") return false;
    if (msg.event && msg.event !== "message") return false;
    const body = msg.message != null ? msg.message : msg;
    if (body && body.k) return applyRec(body, silent);
    if (typeof body === "string") {
      try { return applyRec(JSON.parse(body), silent); } catch (e) {}
    }
    return false;
  }

  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (cached && cached.items && typeof cached.items === "object") {
      Object.keys(cached.items).forEach((k) => { items[k] = cached.items[k]; });
    }
  } catch (e) {}

  function markOk() {
    okAt = Date.now();
  }

  async function replayOne(feed) {
    if (Date.now() < feed.failUntil) return;
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 5000) : null;
    try {
      const res = await fetch(feed.base + "/json?poll=1&since=" + encodeURIComponent(feed.since), {
        signal: ctrl ? ctrl.signal : undefined
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      markOk();
      feed.failUntil = 0;
      const text = await res.text();
      let changed = false;
      text.split("\n").forEach((line) => {
        if (!line.trim()) return;
        try {
          const msg = JSON.parse(line);
          if (msg && msg.id) feed.since = msg.id;
          if (applyEnvelope(msg, true)) changed = true;
        } catch (e) {}
      });
      if (changed) notify();
    } catch (e) {
      feed.failUntil = Date.now() + 8000;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function replay() {
    await Promise.all(feeds.map((feed) => replayOne(feed)));
  }

  function onSseData(feed, data) {
    markOk();
    feed.failUntil = 0;
    applyEnvelope(data);
  }

  function connectOne(feed) {
    if (feed.es) {
      try { feed.es.close(); } catch (e) {}
      feed.es = null;
    }
    if (Date.now() < feed.failUntil) return;
    try {
      const es = new EventSource(feed.base + "/sse?since=" + encodeURIComponent(feed.since));
      feed.es = es;
      es.onopen = () => { markOk(); feed.failUntil = 0; };
      es.onmessage = (e) => { onSseData(feed, e.data); };
      es.onerror = () => {
        if (es.readyState === 2) {
          feed.failUntil = Date.now() + 4000;
          try { es.close(); } catch (e) {}
          if (feed.es === es) feed.es = null;
        }
      };
    } catch (e) {
      feed.failUntil = Date.now() + 8000;
    }
  }

  function connect() {
    feeds.forEach(connectOne);
  }

  function start() {
    connect();
    replay();
    setInterval(() => { replay(); }, 5000);
    setInterval(() => {
      feeds.forEach((feed) => {
        if (!feed.es || feed.es.readyState === 2) connectOne(feed);
      });
    }, 4000);
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
    feeds.forEach((feed) => {
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 6000) : null;
      fetch(feed.base, {
        method: "POST",
        body: JSON.stringify(rec),
        signal: ctrl ? ctrl.signal : undefined
      }).then(() => { markOk(); feed.failUntil = 0; }, () => {
        feed.failUntil = Date.now() + 4000;
      }).finally(() => { if (timer) clearTimeout(timer); });
    });
  }

  function get(ev, team, label) {
    return items[String(ev || "") + "|" + String(team || "") + "|" + String(label || "")] || null;
  }

  function isOn(ev, team, label) {
    const rec = get(ev, team, label);
    return !!(rec && rec.on);
  }

  function isConnected() {
    if (feeds.some((feed) => feed.es && feed.es.readyState === 1)) return true;
    return Date.now() - okAt < 15000;
  }

  start();

  global.MattorLive = {
    report: report,
    get: get,
    isOn: isOn,
    items: items,
    on: function (fn) { listeners.push(fn); try { fn(items); } catch (e) {} },
    connected: isConnected,
    lastEventAt: function () { return lastEventAt; },
    replay: replay
  };
})(window);
