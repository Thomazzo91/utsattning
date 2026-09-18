(function () {
  const PUBLIC_BASE = "https://thomazzo91.github.io/utsattning/v2/";
  const M = window.Mattor;
  const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>';
  const VISITED_KEY = "visited-v2";
  const LEGACY_VISIT_KEY = "hbgm26-visited-v1";

  const map = L.map("map", {
    tap: true,
    zoomControl: false,
    attributionControl: true,
    fadeAnimation: false,
    markerZoomAnimation: false
  }).setView([62.5, 17], 5);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "&copy; OpenStreetMap"
  }).addTo(map);
  let layer = L.layerGroup().addTo(map);
  let markers = [];
  let routeLines = [];
  let store;
  let currentId = "";
  let currentMode = "kortast";
  let selected = 0;
  let ignoreHash = false;
  let touchX = 0;
  let editTeamId = "";
  let pickingIndex = -1;
  let ptFormIndex = -1;
  let publishGate = Promise.resolve();
  const GH_TOKEN_KEY = "utsattning-publish-token";
  const editorEl = document.getElementById("editor");
  const editorBody = document.getElementById("editorBody");
  let liveMap = null;
  let liveLayer = null;
  let liveFitId = "";
  let liveFocusKey = "";
  let liveIgnorePopupClose = false;
  let liveMarkersByKey = {};
  let livePaintEvId = "";
  let liveLegendSig = "";

  let visited = {};
  let applyingLive = false;
  try {
    visited = JSON.parse(localStorage.getItem(VISITED_KEY) || "{}") || {};
    if (typeof visited !== "object" || visited === null) visited = {};
  } catch (e) { visited = {}; }
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_VISIT_KEY) || "{}") || {};
    Object.keys(legacy).forEach((k) => {
      if (legacy[k] && !visited["lopp1|" + k]) visited["lopp1|" + k] = true;
    });
  } catch (e) {}

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function currentEvent() {
    return (store && store.events && store.events.find((e) => e.id === store.currentEventId)) ||
      (store && store.events && store.events[0]);
  }
  function teams() { const ce = currentEvent(); return ce ? (ce.teams || []) : []; }
  function teamById(id) { const ts = teams(); return ts.find((t) => t.id === id) || ts[0]; }
  function imgCacheTag() {
    const ev = currentEvent();
    const id = ev && ev.id;
    const a = Number(ev && ev.rev) || 0;
    const b = Number(id && window.RACES && window.RACES[id] && window.RACES[id].rev) || 0;
    return String(Math.max(a, b) || "");
  }
  function imgSrc(src) {
    if (!src) return "";
    if (/^(data:|blob:|https?:|\/\/)/i.test(src)) return src;
    const path = "../" + String(src).replace(/^\.\//, "");
    const v = imgCacheTag() || "1";
    return path + "?v=" + encodeURIComponent(v) + "&t=" + Date.now();
  }
  function isOverview() {
    return !!window.OVERVIEW_ADMIN || /oversikt/i.test(location.pathname);
  }
  function isViewOnly() {
    const p = new URLSearchParams(location.search);
    if (!p.has("view")) return false;
    const v = p.get("view");
    return v === "" || v === "1" || v === "true";
  }
  function visitKey(teamId, label) {
    const ev = currentEvent() ? currentEvent().id : "";
    return ev + "|" + teamId + "|" + label;
  }
  function isDone(teamId, label) {
    const evId = currentEvent() ? currentEvent().id : "";
    if (window.MattorLive) {
      const rec = window.MattorLive.get(evId, teamId, label);
      if (rec) return !!rec.on;
    }
    return !!(visited[visitKey(teamId, label)] || (evId === "lopp1" && visited[teamId + "|" + label]));
  }
  function saveVisited() {
    try { localStorage.setItem(VISITED_KEY, JSON.stringify(visited)); } catch (e) {}
  }
  function setDone(teamId, label, on) {
    const ev = currentEvent();
    const k = visitKey(teamId, label);
    const legacy = ev && ev.id === "lopp1" ? teamId + "|" + label : null;
    if (on) visited[k] = true;
    else {
      delete visited[k];
      if (legacy) delete visited[legacy];
    }
    saveVisited();
    if (!applyingLive && window.MattorLive && ev) {
      const t = teamById(teamId);
      window.MattorLive.report(ev.id, teamId, label, on, t ? t.name : "");
    }
  }
  function liveClock(t) {
    const d = new Date(Number(t) || Date.now());
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  function applyLiveCache() {
    const L = window.MattorLive;
    if (!L) return;
    Object.keys(L.items || {}).forEach((k) => {
      const rec = L.items[k];
      if (!rec) return;
      if (rec.on) visited[k] = true;
      else delete visited[k];
    });
    saveVisited();
  }
  function refreshLiveUi() {
    applyLiveCache();
    const board = document.getElementById("liveBoard");
    if (board && board.classList.contains("open")) renderLiveBoard();
    if (!(document.body.classList.contains("in-race") && currentId)) return;
    const g = viewOf(currentId, currentMode);
    const s = g.stops[selected];
    const doneBtn = document.getElementById("doneBtn");
    if (doneBtn && s) doneBtn.setAttribute("aria-pressed", String(isDone(g.id, s.label)));
    const chips = document.getElementById("chips");
    if (chips) {
      chips.querySelectorAll("button").forEach((b, i) => {
        const stop = g.stops[i];
        if (!stop) return;
        const done = isDone(g.id, stop.label);
        b.classList.toggle("is-done", done);
        b.style.background = done ? "" : g.color;
      });
    }
    paintMarkers(g);
    const listSheet = document.getElementById("listSheet");
    if (listSheet && listSheet.classList.contains("open")) renderList(g);
  }
  function liveEvent() {
    return currentEvent();
  }
  function liveMinutes(v) {
    const m = String(v || "").trim().match(/^(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : 99999;
  }
  function liveRaceMeta(stop) {
    const raw = String((stop && (stop.label || stop.name)) || "").trim();
    const name = raw.toLowerCase();
    const half = /\bhalv\b/.test(name);
    const finish = /målgång|malgang|\bfinish\b/.test(name) || (/\bmål\b/.test(name) && !/start/.test(name));
    const start = /start/.test(name);
    const vxl = name.match(/vxl\s*(\d+)/);
    const kmM = name.match(/(\d+(?:[.,]\d+)?)\s*km/);
    const km = kmM ? parseFloat(kmM[1].replace(",", ".")) : NaN;
    let mark = raw ? raw.slice(0, 3) : "?";
    let sort = 5000 + liveMinutes(stop && stop.forsta);
    if (start) {
      mark = "S";
      sort = -1;
    } else if (finish) {
      mark = "M";
      sort = 10000;
    } else if (vxl) {
      mark = "V" + vxl[1] + (half ? "h" : "");
      sort = 800 + Number(vxl[1]) + (half ? 0.5 : 0);
    } else if (Number.isFinite(km)) {
      const shown = Math.abs(km - Math.round(km)) < 0.15 ? String(Math.round(km)) : String(km).replace(".", ",");
      mark = shown + (half ? "h" : "");
      sort = km * 10 + (half ? 1 : 0);
    }
    return { mark: mark, sort: sort, half: half, km: km };
  }
  function stopDistM(a, b) {
    if (!a || !b) return 1e9;
    const r = 6371000;
    const p1 = a.lat * Math.PI / 180, p2 = b.lat * Math.PI / 180;
    const dlat = p2 - p1, dlon = (b.lon - a.lon) * Math.PI / 180;
    const h = Math.sin(dlat / 2) * Math.sin(dlat / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dlon / 2) * Math.sin(dlon / 2);
    return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function bearingTo(a, b) {
    const lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180;
    const dLon = (b.lon - a.lon) * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  function cardinalSv(deg) {
    return ["N", "NO", "O", "SO", "S", "SV", "V", "NV"][Math.round(deg / 45) % 8];
  }
  function raceHeadingAt(stop) {
    const ev = currentEvent();
    if (!ev || !stop || !Number.isFinite(Number(stop.lat)) || !Number.isFinite(Number(stop.lon))) return null;
    const meta = liveRaceMeta(stop);
    const all = liveStops(ev);
    if (all.length < 2) return null;
    const same = all.filter((p) => !!p.half === !!meta.half);
    const raw = same.length >= 2 ? same : all;
    const pts = [];
    raw.forEach((p) => {
      if (pts.some((q) => q.sort === p.sort && stopDistM(q.stop, p.stop) < 40)) return;
      pts.push(p);
    });
    if (pts.length < 2) return null;
    const hereKey = ev.id + "|" + currentId + "|" + stop.label;
    let i = pts.findIndex((p) => p.key === hereKey);
    if (i < 0) i = pts.findIndex((p) => p.stop.label === stop.label && stopDistM(p.stop, stop) < 30);
    if (i < 0) {
      i = pts.reduce((best, p, idx) => {
        const d = stopDistM(p.stop, stop);
        if (d >= 40) return best;
        if (best < 0 || d < stopDistM(pts[best].stop, stop)) return idx;
        return best;
      }, -1);
    }
    if (i < 0) return null;
    const later = pts.slice(i + 1);
    const nextFar = later.find((p) => stopDistM(p.stop, stop) >= 600) ||
      later.find((p) => stopDistM(p.stop, stop) >= 80);
    if (nextFar) return bearingTo(stop, nextFar.stop);
    for (let k = i - 1; k >= 0; k--) {
      if (stopDistM(pts[k].stop, stop) >= 80) return bearingTo(pts[k].stop, stop);
    }
    return null;
  }
  let deviceHeading = null;
  let deviceHeadingSmooth = null;
  let compassListening = false;
  let compassLive = false;
  let compassRaf = 0;
  function circLerp(a, b, t) {
    const d = ((b - a + 540) % 360) - 180;
    return (a + d * t + 360) % 360;
  }
  function compassNeedsPermission() {
    return typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function";
  }
  function headingFromOrient(e) {
    if (!e) return null;
    if (typeof e.webkitCompassHeading === "number" && isFinite(e.webkitCompassHeading)) {
      if (e.webkitCompassAccuracy === -1) return null;
      return (Number(e.webkitCompassHeading) + 360) % 360;
    }
    const abs = e.absolute === true || e.type === "deviceorientationabsolute";
    if (!abs || typeof e.alpha !== "number" || !isFinite(e.alpha)) return null;
    return (360 - e.alpha + 360) % 360;
  }
  function onDeviceOrient(e) {
    const h = headingFromOrient(e);
    if (h == null) return;
    deviceHeading = h;
    compassLive = true;
    if (compassRaf) return;
    compassRaf = requestAnimationFrame(() => {
      compassRaf = 0;
      if (deviceHeadingSmooth == null) deviceHeadingSmooth = deviceHeading;
      else {
        const delta = Math.abs(((deviceHeading - deviceHeadingSmooth + 540) % 360) - 180);
        deviceHeadingSmooth = circLerp(deviceHeadingSmooth, deviceHeading, delta > 35 ? 0.5 : 0.22);
      }
      paintCompass();
    });
  }
  function startCompassListen() {
    if (compassListening) return;
    compassListening = true;
    window.addEventListener("deviceorientationabsolute", onDeviceOrient, true);
    window.addEventListener("deviceorientation", onDeviceOrient, true);
  }
  async function enableDeviceCompass() {
    try {
      if (compassNeedsPermission()) {
        const st = await DeviceOrientationEvent.requestPermission();
        if (st !== "granted") {
          showToast("Tillåt rörelse och riktning");
          return;
        }
      }
    } catch (err) {
      showToast("Kunde inte starta löpriktningen");
      return;
    }
    startCompassListen();
    paintCompass();
  }
  function paintCompass() {
    const el = document.getElementById("raceCompass");
    if (!el) return;
    const hide = !document.body.classList.contains("in-race") || isOverview() ||
      document.body.classList.contains("choosing") || document.body.classList.contains("editing");
    if (hide) {
      el.classList.remove("is-on", "is-live");
      el.setAttribute("aria-hidden", "true");
      return;
    }
    const g = viewOf(currentId, currentMode);
    const s = g.stops[selected];
    const heading = s ? raceHeadingAt(s) : null;
    if (heading == null) {
      el.classList.remove("is-on", "is-live");
      el.setAttribute("aria-hidden", "true");
      return;
    }
    startCompassListen();
    el.classList.add("is-on");
    el.setAttribute("aria-hidden", "false");
    const live = compassLive && deviceHeadingSmooth != null;
    el.classList.toggle("is-live", live);
    const needle = document.getElementById("raceNeedle");
    const rot = live ? ((heading - deviceHeadingSmooth + 360) % 360) : 0;
    if (needle) needle.style.transform = "rotate(" + rot.toFixed(1) + "deg)";
    const card = cardinalSv(heading);
    const label = document.getElementById("raceCompassLabel");
    if (label) label.textContent = (!live && compassNeedsPermission()) ? "Tryck" : "";
    el.setAttribute("aria-label", live ? "Löpriktning " + card : "Aktivera löpriktning, " + card);
  }
  function liveStops(ev) {
    const out = [];
    ((ev && ev.teams) || []).forEach((t) => {
      (M.pointsOf(t) || []).forEach((s) => {
        if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) return;
        const meta = liveRaceMeta(s);
        out.push({
          team: t,
          stop: s,
          mark: meta.mark,
          key: ev.id + "|" + t.id + "|" + s.label,
          sort: meta.sort,
          half: meta.half
        });
      });
    });
    out.sort((a, b) => a.sort - b.sort || String(a.mark).localeCompare(String(b.mark), "sv"));
    return out;
  }
  function liveMarkerIcon(color, up, mark) {
    const long = String(mark || "").length > 2;
    return L.divIcon({
      className: "",
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      html: `<div class="live-mk${up ? " is-up" : ""}"><div class="live-mk-num${long ? " is-long" : ""}" style="background:${up ? "var(--ok)" : color}">${esc(mark)}</div></div>`
    });
  }
  function liveStatusText(rec, up) {
    return up
      ? ("Uppe " + liveClock(rec.t) + (rec.who ? " · " + rec.who : ""))
      : "Inte uppe";
  }
  function livePopupHtml(p, rec, up) {
    const name = p.stop.label || p.stop.name || "Punkt";
    return `<div class="live-pop-body">
      <strong>${esc(name)}</strong>
      <em>${esc(p.team.name)} · ${esc(liveStatusText(rec, up))}</em>
      <div class="live-pop-times">
        <div><span>Igång</span><b>${esc(p.stop.iga || "—")}</b></div>
        <div class="is-first"><span>Första</span><b>${esc(p.stop.forsta || "—")}</b></div>
        <div><span>Sista</span><b>${esc(p.stop.sista || "—")}</b></div>
      </div>
    </div>`;
  }
  function fillLiveInfo(p, rec, up) {
    const info = document.getElementById("liveInfo");
    if (!info) return;
    info.innerHTML = `<strong>${esc(p.stop.label || p.stop.name || "Punkt")}</strong><span>${esc(p.team.name)} · ${esc(liveStatusText(rec, up))}</span>`;
  }
  function ensureLiveMap(forceSize) {
    const el = document.getElementById("liveMap");
    if (!el) return;
    if (liveMap) {
      if (forceSize) setTimeout(() => liveMap.invalidateSize(), 60);
      return;
    }
    liveMap = L.map(el, {
      tap: true,
      zoomControl: false,
      attributionControl: true,
      fadeAnimation: false,
      markerZoomAnimation: false
    }).setView([62.5, 17], 5);
    L.control.zoom({ position: "bottomright" }).addTo(liveMap);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "&copy; OpenStreetMap"
    }).addTo(liveMap);
    liveLayer = L.layerGroup().addTo(liveMap);
  }
  function paintLiveMarkers(ev, fit) {
    if (!liveMap || !liveLayer) return;
    const Llive = window.MattorLive;
    const pts = liveStops(ev);
    if (livePaintEvId !== ev.id) {
      liveIgnorePopupClose = true;
      liveLayer.clearLayers();
      liveIgnorePopupClose = false;
      liveMarkersByKey = {};
      livePaintEvId = ev.id;
    }
    const latlngs = [];
    const seen = {};
    pts.forEach((p) => {
      seen[p.key] = true;
      const rec = Llive ? Llive.get(ev.id, p.team.id, p.stop.label) : null;
      const up = !!(rec && rec.on);
      const html = livePopupHtml(p, rec, up);
      const sig = (up ? "1" : "0") + "|" + p.mark + "|" + p.team.color;
      let m = liveMarkersByKey[p.key];
      if (!m) {
        m = L.marker([p.stop.lat, p.stop.lon], {
          icon: liveMarkerIcon(p.team.color, up, p.mark),
          zIndexOffset: up ? 400 : (p.mark === "S" || p.mark === "M" ? 280 : 0)
        });
        m.bindPopup(html, {
          className: "live-pop",
          maxWidth: 300,
          closeButton: true,
          autoPan: true,
          autoPanPadding: [20, 56],
          autoClose: true,
          closeOnClick: true
        });
        m.on("popupopen", () => {
          const live = m._live || { p: p, rec: rec, up: up };
          liveFocusKey = live.p.key;
          fillLiveInfo(live.p, live.rec, live.up);
        });
        m.on("popupclose", () => {
          if (!liveIgnorePopupClose && m._live && liveFocusKey === m._live.p.key) liveFocusKey = "";
        });
        m.addTo(liveLayer);
        liveMarkersByKey[p.key] = m;
        m._liveSig = sig;
        m._liveHtml = html;
      } else {
        if (m._liveSig !== sig) {
          m.setIcon(liveMarkerIcon(p.team.color, up, p.mark));
          m.setZIndexOffset(up ? 400 : (p.mark === "S" || p.mark === "M" ? 280 : 0));
          m._liveSig = sig;
        }
        if (m._liveHtml !== html) {
          m.setPopupContent(html);
          m._liveHtml = html;
        }
      }
      m._live = { p: p, rec: rec, up: up };
      latlngs.push([p.stop.lat, p.stop.lon]);
      if (p.key === liveFocusKey) fillLiveInfo(p, rec, up);
    });
    Object.keys(liveMarkersByKey).forEach((k) => {
      if (seen[k]) return;
      liveIgnorePopupClose = true;
      try { liveLayer.removeLayer(liveMarkersByKey[k]); } catch (e) {}
      liveIgnorePopupClose = false;
      delete liveMarkersByKey[k];
    });
    if (fit && latlngs.length) {
      liveMap.fitBounds(L.latLngBounds(latlngs), { padding: [28, 28], maxZoom: 15 });
      liveFitId = ev.id;
    }
  }
  function renderLiveBoard() {
    const status = document.getElementById("liveStatus");
    const Llive = window.MattorLive;
    const ev = liveEvent();
    if (status) {
      const on = Llive && Llive.connected();
      status.classList.toggle("is-on", !!on);
      status.textContent = on ? "Live · kartan uppdateras när någon bockar av" : "Ansluter till live-status…";
    }
    const title = document.getElementById("liveTitle");
    const prog = document.getElementById("liveProg");
    const legend = document.getElementById("liveLegend");
    const info = document.getElementById("liveInfo");
    if (!ev) {
      if (title) title.textContent = "Vad som är uppe";
      if (prog) prog.textContent = "Öppna ett lopp först";
      if (legend) legend.innerHTML = "";
      liveLegendSig = "";
      if (info) info.textContent = "";
      return;
    }
    const pts = liveStops(ev);
    const upCount = pts.filter((p) => Llive && Llive.isOn(ev.id, p.team.id, p.stop.label)).length;
    if (title) title.textContent = ev.name;
    if (prog) prog.textContent = upCount + " av " + pts.length + " uppe";
    const legendSig = ev.id + "|" + upCount + "/" + pts.length + "|" + (ev.teams || []).map((t) => {
      const groupPts = pts.filter((p) => p.team.id === t.id);
      const nUp = groupPts.filter((p) => Llive && Llive.isOn(ev.id, t.id, p.stop.label)).length;
      return t.id + ":" + nUp + "/" + groupPts.length;
    }).join(",");
    if (legend && liveLegendSig !== legendSig) {
      liveLegendSig = legendSig;
      legend.innerHTML = "";
      const allBtn = document.createElement("button");
      allBtn.type = "button";
      allBtn.className = "live-chip is-all";
      allBtn.textContent = "Alla · " + upCount + "/" + pts.length;
      allBtn.addEventListener("click", () => {
        if (!liveMap || !pts.length) return;
        liveMap.fitBounds(L.latLngBounds(pts.map((p) => [p.stop.lat, p.stop.lon])), { padding: [28, 28], maxZoom: 15 });
      });
      legend.appendChild(allBtn);
      (ev.teams || []).forEach((t) => {
        const groupPts = pts.filter((p) => p.team.id === t.id);
        if (!groupPts.length) return;
        const nUp = groupPts.filter((p) => Llive && Llive.isOn(ev.id, t.id, p.stop.label)).length;
        const b = document.createElement("button");
        b.type = "button";
        b.className = "live-chip";
        b.style.background = t.color;
        b.textContent = t.name + " · " + nUp + "/" + groupPts.length;
        b.addEventListener("click", () => {
          if (!liveMap) return;
          liveMap.fitBounds(L.latLngBounds(groupPts.map((p) => [p.stop.lat, p.stop.lon])), { padding: [36, 36], maxZoom: 15 });
        });
        legend.appendChild(b);
      });
    }
    if (info && !liveFocusKey) info.textContent = "Siffra = km längs banan (h = halv) · tryck för tider";
    const needFit = liveFitId !== ev.id;
    ensureLiveMap(needFit);
    paintLiveMarkers(ev, needFit);
  }
  function openLiveBoard() {
    if (!isOverview()) return;
    const more = document.getElementById("more");
    if (more) more.style.display = "none";
    if (!liveEvent()) {
      showToast("Öppna ett lopp först");
      return;
    }
    const board = document.getElementById("liveBoard");
    if (!board) return;
    board.classList.add("open");
    document.body.classList.add("live-open");
    renderLiveBoard();
    setTimeout(() => { if (liveMap) liveMap.invalidateSize(); }, 80);
  }
  function closeLiveBoard() {
    const board = document.getElementById("liveBoard");
    if (board) board.classList.remove("open");
    document.body.classList.remove("live-open");
    liveFitId = "";
    liveFocusKey = "";
    livePaintEvId = "";
    liveLegendSig = "";
    liveMarkersByKey = {};
    if (isOverview()) {
      ignoreHash = true;
      history.replaceState(null, "", location.pathname);
      setTimeout(() => { ignoreHash = false; }, 0);
      openChooser();
    }
  }
  function viewOf(id, mode) {
    const t = teamById(id);
    if (!t) return { id: "", name: "", color: "", km: 0, min: 0, stops: [], legs: [], track: [], segs: [] };
    const m = (t.modes && t.modes[mode]) || (t.modes && t.modes.kortast) || M.emptyModes().kortast;
    return {
      id: t.id, name: t.name, ansvarig: t.ansvarig, color: t.color,
      km: m.km || 0, min: m.min || 0,
      stops: (m.stops || []).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon)),
      legs: m.legs || [], track: m.track || [], segs: m.segs || []
    };
  }
  function hashParts() {
    const parts = (location.hash || "").replace(/^#/, "").split("/").filter(Boolean);
    if (parts[0] && parts[0].indexOf("e.") === 0) parts.shift();
    return parts;
  }
  function parseHash() {
    const parts = hashParts();
    const list = teams();
    let id = (list[0] && list[0].id) || "";
    let mode = "kortast";
    let idx = 0;
    let i = 0;
    if (parts[0] && list.some((t) => t.id === parts[0])) { id = parts[0]; i = 1; }
    if (parts[i] === "iga") { mode = "iga"; i += 1; }
    const view = viewOf(id, mode);
    const n = parseInt(parts[i], 10);
    if (Number.isFinite(n) && n >= 1 && n <= view.stops.length) idx = n - 1;
    return { id, mode, idx };
  }
  function hashFor(id, mode, idx) {
    let h = "#" + (id || "");
    if (mode === "iga") h += "/iga";
    if (idx > 0) h += "/" + (idx + 1);
    return h;
  }
  function setHash(id, mode, idx) {
    const hash = hashFor(id, mode, idx);
    ignoreHash = true;
    history.replaceState(null, "", location.pathname + location.search + hash);
    setTimeout(() => { ignoreHash = false; }, 0);
  }
  function showToast(text) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = text;
    el.style.display = "block";
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => { el.style.display = "none"; }, 1800);
  }
  function setBusy(on, text) {
    document.getElementById("busyText").textContent = text || "Laddar…";
    document.getElementById("busy").classList.toggle("on", !!on);
  }
  function markerIcon(color, n, on, done) {
    return L.divIcon({
      className: "",
      iconSize: on ? [42, 42] : [34, 34],
      iconAnchor: on ? [21, 21] : [17, 17],
      html: `<div class="mk${on ? " is-on" : ""}${done ? " is-done" : ""}"><div class="mk-num" style="background:${color}">${done ? CHECK_SVG : n}</div></div>`
    });
  }
  function mapPad() {
    return { padding: [28, 28] };
  }
  function googleDir(g) {
    if (!g.stops.length) return "#";
    return "https://www.google.com/maps/dir/" + g.stops.map((s) => s.lat.toFixed(6) + "," + s.lon.toFixed(6)).join("/");
  }
  function navUrl(s) {
    return "https://www.google.com/maps/dir/?api=1&destination=" + s.lat + "," + s.lon + "&travelmode=driving";
  }

  function ensureSeed() {
    if (!store || !Array.isArray(store.events)) return;
    (M.getAllBuiltInIds() || []).forEach((bid) => {
      if (M.isRemoved(bid)) return;
      if (!store.events.some((e) => e.id === bid)) {
        const s = M.seedEvent(bid);
        if (s) store.events.unshift(s);
      }
    });
  }

  function paintGroups() {
    const bar = document.getElementById("groups");
    bar.innerHTML = "";
    teams().forEach((t) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = t.name;
      b.setAttribute("aria-pressed", String(t.id === currentId));
      if (t.id === currentId) b.style.background = t.color;
      b.addEventListener("click", () => {
        show(t.id, currentMode, 0, false);
        if (routingIds[t.id] || !M.needsRouteRebuild(t)) return;
        routingIds[t.id] = true;
        M.recalcTeam(t).then(() => {
          persist();
          if (currentId === t.id) {
            mapViewKey = "";
            show(t.id, currentMode, selected, true, false);
          }
        }).catch(() => {}).finally(() => { delete routingIds[t.id]; });
      });
      bar.appendChild(b);
    });
  }

  function renderCard(g) {
    const s = g.stops[selected];
    const card = document.getElementById("card");
    if (!s) {
      card.innerHTML = "<p class=\"setup\">Inga punkter i den här gruppen.</p>";
      return;
    }
    const done = isDone(g.id, s.label);
    const hasImg = !!(s.image || pendingFor(s) || catalogImage(s));
    const img = hasImg ? `<img class="thumb" alt="">` : "";
    const nextLeg = g.legs[selected];
    const heading = raceHeadingAt(s);
    const dirTxt = heading == null ? "" : " · Löper " + cardinalSv(heading);
    card.innerHTML = `
      <div class="card-head">
        <span class="num" style="background:${g.color}">${selected + 1}</span>
        <div style="flex:1;min-width:0">
          <h2>${esc(s.label || s.name || "Punkt")}</h2>
          <p class="setup">${esc(s.setup || "")}${nextLeg ? " · " + nextLeg.km + " km till nästa" : ""}${dirTxt}</p>
        </div>
        <div class="card-actions">
          <button type="button" class="been" id="doneBtn" aria-pressed="${done}" aria-label="Bocka av">${CHECK_SVG}</button>
          <a class="nav" href="${navUrl(s)}" target="_blank" rel="noopener">Navigera</a>
        </div>
      </div>
      <div class="times">
        <div><span>Igång</span><strong>${esc(s.iga || "—")}</strong></div>
        <div class="is-first"><span>Första</span><strong>${esc(s.forsta || "—")}</strong></div>
        <div><span>Sista</span><strong>${esc(s.sista || "—")}</strong></div>
      </div>
      <div class="meta">
        <div class="note">${esc(s.placering || s.note || "")}</div>
        ${img}
      </div>
    `;
    document.getElementById("doneBtn").addEventListener("click", (ev) => {
      ev.stopPropagation();
      setDone(g.id, s.label, !isDone(g.id, s.label));
      renderCard(g);
      renderChips(g);
      paintMarkers(g);
    });
    const thumb = card.querySelector(".thumb");
    if (thumb) bindStopImg(thumb, s);
  }

  function renderChips(g) {
    const el = document.getElementById("chips");
    el.innerHTML = "";
    g.stops.forEach((s, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (i === selected ? " is-on" : "") + (isDone(g.id, s.label) ? " is-done" : "");
      b.style.background = isDone(g.id, s.label) ? "" : g.color;
      b.textContent = String(i + 1);
      b.addEventListener("click", () => show(currentId, currentMode, i, false, true));
      el.appendChild(b);
    });
    const on = el.querySelector(".is-on");
    if (on) on.scrollIntoView({ inline: "center", block: "nearest" });
  }

  function renderList(g) {
    const list = document.getElementById("list");
    list.innerHTML = g.stops.map((s, i) => {
      const done = isDone(g.id, s.label);
      return `<button type="button" class="stop${i === selected ? " is-on" : ""}${done ? " is-done" : ""}" data-i="${i}">
        <span class="num" style="background:${g.color}">${i + 1}</span>
        <span style="flex:1"><strong>${esc(s.label || s.name)}</strong>
        <small>Igång ${esc(s.iga || "—")} · Första ${esc(s.forsta || "—")} · Sista ${esc(s.sista || "—")}</small></span>
      </button>`;
    }).join("");
    list.querySelectorAll(".stop").forEach((b) => {
      b.addEventListener("click", () => {
        document.getElementById("listSheet").classList.remove("open");
        show(currentId, currentMode, Number(b.dataset.i), false, true);
      });
    });
  }

  function paintMarkers(g) {
    markers.forEach((m, n) => {
      const s = g.stops[n];
      m.setIcon(markerIcon(g.color, n + 1, n === selected, !!(s && isDone(g.id, s.label))));
    });
  }

  let mapDrawGen = 0;
  let mapViewKey = "";
  let lastMapSizeKey = "";
  const routingIds = Object.create(null);
  function mapSizeKey() {
    const sz = map.getSize();
    return sz.x + "x" + sz.y;
  }
  function layoutMapIfNeeded() {
    const key = mapSizeKey();
    if (key === lastMapSizeKey) return false;
    lastMapSizeKey = key;
    map.invalidateSize({ animate: false, pan: false });
    return true;
  }
  function redrawRouteLines() {
    routeLines.forEach((l) => {
      try { l.redraw(); } catch (e) {}
    });
  }
  function drawMap(g, panToStop) {
    const gen = ++mapDrawGen;
    layer.clearLayers();
    markers = [];
    routeLines = [];
    const usableSegs = (g.segs || []).filter((s) => s && s.geom && s.geom.length >= 2);
    const trackPts = (g.track && g.track.length) || 0;
    const lineOpts = { interactive: false, bubblingMouseEvents: false };
    if (usableSegs.length) {
      usableSegs.forEach((s) => {
        const latlngs = s.geom.map(([lon, lat]) => [lat, lon]);
        let opts = Object.assign({ color: g.color, weight: 6, opacity: 0.92 }, lineOpts);
        if (s.profile === "foot") opts = Object.assign({ color: "#0b1220", weight: 7, opacity: 0.92, dashArray: "16 8" }, lineOpts);
        else if (s.profile === "bike") opts = Object.assign({ color: "#0b1220", weight: 6, opacity: 0.9, dashArray: "14 8" }, lineOpts);
        else if (s.profile === "crow") opts = Object.assign({ color: "#111827", weight: 3, opacity: 0.85, dashArray: "2 8" }, lineOpts);
        routeLines.push(L.polyline(latlngs, opts).addTo(layer));
      });
    } else if (trackPts >= 2) {
      const latlngs = g.track.map(([lon, lat]) => [lat, lon]);
      routeLines.push(L.polyline(latlngs, Object.assign({ color: g.color, weight: 6, opacity: 0.92 }, lineOpts)).addTo(layer));
    } else {
      const fallback = g.stops.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon)).map((s) => [s.lat, s.lon]);
      if (fallback.length >= 2) routeLines.push(L.polyline(fallback, Object.assign({ color: g.color, weight: 5, opacity: 0.75 }, lineOpts)).addTo(layer));
    }
    g.stops.forEach((s, i) => {
      const m = L.marker([s.lat, s.lon], {
        icon: markerIcon(g.color, i + 1, i === selected, isDone(g.id, s.label)),
        zIndexOffset: i === selected ? 700 : 0
      });
      m.on("click", (ev) => {
        if (pickingIndex >= 0) {
          L.DomEvent.stopPropagation(ev);
          applyPick(ev.latlng);
          return;
        }
        show(currentId, currentMode, i, false, true);
      });
      m.addTo(layer);
      markers.push(m);
    });
    function layout(fit) {
      if (gen !== mapDrawGen) return;
      layoutMapIfNeeded();
      if (!fit) return;
      if (panToStop && g.stops[selected]) {
        map.setView([g.stops[selected].lat, g.stops[selected].lon], Math.max(map.getZoom(), 15), { animate: false });
        return;
      }
      if (routeLines.length) {
        let b = routeLines[0].getBounds();
        for (let i = 1; i < routeLines.length; i++) b.extend(routeLines[i].getBounds());
        map.fitBounds(b, Object.assign({ animate: false }, mapPad()));
      } else if (g.stops.length) {
        map.fitBounds(L.latLngBounds(g.stops.map((s) => [s.lat, s.lon])), Object.assign({ animate: false }, mapPad()));
      }
    }
    layout(true);
    requestAnimationFrame(() => {
      const sz = map.getSize();
      if (sz.x < 40 || sz.y < 40) {
        lastMapSizeKey = "";
        setTimeout(() => layout(true), 60);
      }
    });
  }

  function selectStop(i, pan) {
    const g = viewOf(currentId, currentMode);
    if (!g.stops.length) return;
    selected = Math.max(0, Math.min(i, g.stops.length - 1));
    setHash(currentId, currentMode, selected);
    document.getElementById("gmaps").href = googleDir(g);
    renderChips(g);
    renderCard(g);
    const listSheet = document.getElementById("listSheet");
    if (listSheet && listSheet.classList.contains("open")) {
      document.getElementById("list").querySelectorAll(".stop").forEach((el) => {
        el.classList.toggle("is-on", Number(el.dataset.i) === selected);
      });
    }
    paintMarkers(g);
    markers.forEach((m, n) => m.setZIndexOffset(n === selected ? 700 : 0));
    if (pan && g.stops[selected]) {
      map.setView([g.stops[selected].lat, g.stops[selected].lon], Math.max(map.getZoom(), 15), { animate: false });
    }
    paintCompass();
  }

  function show(id, mode, idx, fromHash, pan) {
    if (!teams().length) return;
    const g = viewOf(id, mode);
    currentId = g.id || ((teams()[0] && teams()[0].id) || "");
    currentMode = mode;
    selected = g.stops.length ? Math.max(0, Math.min(idx, g.stops.length - 1)) : 0;
    if (!fromHash && currentId) setHash(currentId, currentMode, selected);
    document.documentElement.style.setProperty("--accent", g.color || "#f59e0b");
    const ev = currentEvent();
    document.getElementById("raceTitle").textContent = ev ? ev.name : "Utsättning 2.0";
    document.title = ev ? ev.name : "Utsättning 2.0";
    document.getElementById("modes").querySelectorAll("button").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.mode === currentMode));
    });
    document.getElementById("gmaps").href = googleDir(g);
    const key = (ev ? ev.id : "") + "|" + currentId + "|" + currentMode;
    if (key === mapViewKey && markers.length === g.stops.length) {
      selectStop(selected, !!pan);
      return;
    }
    paintGroups();
    renderChips(g);
    renderCard(g);
    if (document.getElementById("listSheet").classList.contains("open")) renderList(g);
    drawMap(g, !!pan);
    mapViewKey = key;
    paintCompass();
  }

  function renderChooser() {
    const box = document.getElementById("chooserList");
    box.innerHTML = "";
    (store.events || []).forEach((ev) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chooser-item";
      const names = (ev.teams || []).map((t) => t.name).join(" · ");
      b.innerHTML = `<strong>${esc(ev.name)}</strong><span>${esc(names) || "Inga grupper"}</span>`;
      b.addEventListener("click", () => {
        if (isOverview()) {
          store.currentEventId = ev.id;
          ignoreHash = true;
          history.replaceState(null, "", location.pathname + "?lopp=" + encodeURIComponent(ev.id));
          setTimeout(() => { ignoreHash = false; }, 0);
          closeChooser();
          liveFitId = "";
          openLiveBoard();
          return;
        }
        enterEvent(ev.id);
      });
      box.appendChild(b);
    });
  }
  function openChooser() {
    document.getElementById("chooser").classList.add("open");
    document.body.classList.add("choosing");
    renderChooser();
  }
  function closeChooser() {
    document.getElementById("chooser").classList.remove("open");
    document.body.classList.remove("choosing");
  }
  async function ensureEventRoutes(ev, priorityId) {
    if (!ev) return;
    const need = (ev.teams || []).filter((t) => M.needsRouteRebuild(t));
    if (!need.length) return;
    const first = priorityId ? need.filter((t) => t.id === priorityId) : [];
    const rest = first.length ? need.filter((t) => t.id !== priorityId) : need.slice();
    const run = async (list) => {
      let any = false;
      for (const t of list) {
        if (routingIds[t.id] || !M.needsRouteRebuild(t)) continue;
        routingIds[t.id] = true;
        try {
          await M.recalcTeam(t);
          any = true;
        } catch (e) {}
        delete routingIds[t.id];
      }
      return any;
    };
    try {
      const any = await run(first.length ? first : rest);
      if (any) {
        persist();
        if (document.body.classList.contains("in-race") && !isOverview() && currentEvent() && currentEvent().id === ev.id) {
          mapViewKey = "";
          show(currentId, currentMode, selected, true, false);
        }
      }
      if (first.length && rest.length) {
        run(rest).then((more) => { if (more) persist(); }).catch(() => {});
      }
    } catch (e) {}
  }

  async function enterEvent(id) {
    if (!store.events.some((e) => e.id === id)) return;
    store.currentEventId = id;
    closeChooser();
    document.body.classList.add("in-race");
    const tid = (currentEvent() && currentEvent().teams[0] && currentEvent().teams[0].id) || "";
    ignoreHash = true;
    history.replaceState(null, "", location.pathname + "?lopp=" + encodeURIComponent(id) + hashFor(tid, "kortast", 0));
    setTimeout(() => { ignoreHash = false; }, 0);
    mapViewKey = "";
    lastMapSizeKey = "";
    show(tid, "kortast", 0, true, false);
    ensureEventRoutes(currentEvent(), tid);
    setTimeout(persist, 0);
  }

  const raceCompassEl = document.getElementById("raceCompass");
  if (raceCompassEl) {
    raceCompassEl.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      enableDeviceCompass();
    });
  }
  document.getElementById("backBtn").addEventListener("click", openChooser);
  document.getElementById("moreBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    const m = document.getElementById("more");
    m.style.display = m.style.display === "block" ? "none" : "block";
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".more-wrap")) {
      document.getElementById("more").style.display = "none";
    }
  });
  document.getElementById("share").addEventListener("click", async () => {
    const ev = currentEvent();
    const url = PUBLIC_BASE.replace(/\/?$/, "/") + "?lopp=" + encodeURIComponent(ev ? ev.id : "") + hashFor(currentId, currentMode, selected);
    try {
      await navigator.clipboard.writeText(url);
      showToast("Länk till 2.0 kopierad");
    } catch {
      prompt("Kopiera länken", url);
    }
  });
  document.getElementById("gpxBtn").addEventListener("click", () => {
    document.getElementById("more").style.display = "none";
    const t = teamById(currentId);
    if (!t) return;
    const xml = M.gpxFor(t, currentMode);
    const blob = new Blob([xml], { type: "application/gpx+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (t.name || "grupp") + ".gpx";
    a.click();
  });
  document.getElementById("clearDone").addEventListener("click", () => {
    document.getElementById("more").style.display = "none";
    const g = viewOf(currentId, currentMode);
    if (!confirm("Rensa avbockning för " + g.name + "?")) return;
    g.stops.forEach((s) => setDone(g.id, s.label, false));
    show(currentId, currentMode, selected, true, false);
    showToast("Avbockning rensad");
  });
  document.getElementById("editBtn").addEventListener("click", openEditor);
  document.getElementById("newEventBtn").addEventListener("click", () => {
    document.getElementById("more").style.display = "none";
    newEvent();
  });
  document.getElementById("chooserNew").addEventListener("click", newEvent);
  const chooserLive = document.getElementById("chooserLive");
  if (chooserLive) {
    chooserLive.addEventListener("click", () => {
      location.href = "oversikt.html";
    });
  }
  const liveOverviewBtn = document.getElementById("liveOverviewBtn");
  if (liveOverviewBtn) {
    liveOverviewBtn.addEventListener("click", () => {
      const ev = currentEvent();
      location.href = "oversikt.html" + (ev && ev.id ? "?lopp=" + encodeURIComponent(ev.id) : "");
    });
  }
  const liveMenuBtn = document.getElementById("liveMenuBtn");
  if (liveMenuBtn) liveMenuBtn.addEventListener("click", openLiveBoard);
  document.getElementById("liveClose").addEventListener("click", closeLiveBoard);
  document.getElementById("publishBtn").addEventListener("click", async () => {
    document.getElementById("more").style.display = "none";
    await publishCatalog();
  });
  const tokenBtn = document.getElementById("tokenBtn");
  if (tokenBtn) tokenBtn.addEventListener("click", async () => {
    document.getElementById("more").style.display = "none";
    const t = await askPublishToken();
    showToast(t ? "Nyckel sparad på den här enheten" : "Ingen nyckel sparad");
  });
  document.getElementById("editorDone").addEventListener("click", closeEditor);
  document.getElementById("exportBtn").addEventListener("click", () => {
    document.getElementById("more").style.display = "none";
    const ev = currentEvent();
    if (!ev) return;
    download((ev.name || "lopp").replace(/\s+/g, "-") + ".json", JSON.stringify(M.compactEvent(ev), null, 2));
    showToast("Fil sparad");
  });
  document.getElementById("importBtn").addEventListener("click", () => {
    document.getElementById("more").style.display = "none";
    document.getElementById("importFile").click();
  });
  document.getElementById("importFile").addEventListener("change", async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!file) return;
    try {
      const compact = JSON.parse(await file.text());
      const imported = M.inflateEvent(compact);
      M.forgetRemoved(imported.id);
      const existing = store.events.findIndex((e) => e.id === imported.id);
      if (existing >= 0) store.events[existing] = imported;
      else store.events.push(imported);
      store.currentEventId = imported.id;
      persist();
      enterEvent(imported.id);
      showToast("Lopp öppnat");
    } catch (e) { showToast("Kunde inte läsa filen"); }
  });
  document.getElementById("prevBtn").addEventListener("click", () => {
    if (selected > 0) show(currentId, currentMode, selected - 1, false, true);
  });
  document.getElementById("nextBtn").addEventListener("click", () => {
    const g = viewOf(currentId, currentMode);
    if (selected < g.stops.length - 1) show(currentId, currentMode, selected + 1, false, true);
  });
  document.getElementById("listBtn").addEventListener("click", () => {
    renderList(viewOf(currentId, currentMode));
    document.getElementById("listSheet").classList.add("open");
  });
  document.getElementById("listClose").addEventListener("click", () => {
    document.getElementById("listSheet").classList.remove("open");
  });
  document.getElementById("modes").querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => show(currentId, b.dataset.mode, selected, false, false));
  });
  document.getElementById("imgOverlay").addEventListener("click", () => {
    const ov = document.getElementById("imgOverlay");
    ov.classList.remove("open");
    ov.setAttribute("aria-hidden", "true");
    document.getElementById("imgOverlayImg").src = "";
  });
  const card = document.getElementById("card");
  card.addEventListener("touchstart", (e) => { touchX = e.changedTouches[0].clientX; }, { passive: true });
  card.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - touchX;
    if (dx > 60) document.getElementById("prevBtn").click();
    else if (dx < -60) document.getElementById("nextBtn").click();
  }, { passive: true });
  window.addEventListener("hashchange", () => {
    if (ignoreHash) return;
    const { id, mode, idx } = parseHash();
    if (id === currentId && mode === currentMode) selectStop(idx, true);
    else show(id, mode, idx, true, true);
  });
  let resizeT = 0;
  function onMapResize() {
    if (!document.body.classList.contains("in-race")) return;
    if (!layoutMapIfNeeded()) return;
    redrawRouteLines();
  }
  window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(onMapResize, 80);
  });
  try {
    new ResizeObserver(() => {
      clearTimeout(resizeT);
      resizeT = setTimeout(onMapResize, 80);
    }).observe(document.getElementById("map"));
  } catch (e) {}

  function persist() {
    if (isViewOnly()) return;
    try { M.saveStore(store); } catch (e) {
      showToast("Kunde inte spara lokalt");
    }
  }
  function fileSlug(s) {
    return String(s || "").toLowerCase().replace(/[åä]/g, "a").replace(/ö/g, "o").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  }
  function dataImagePayload(dataUrl) {
    const t = String(dataUrl || "");
    const i = t.indexOf("base64,");
    if (i < 0) return null;
    const b64 = t.slice(i + 7).replace(/\s/g, "");
    if (!b64) return null;
    return { b64, ext: /image\/png/i.test(t.slice(0, i)) ? "png" : "jpg" };
  }
  function stopImgKey(evId, teamId, label) {
    return String(evId || "") + "|" + String(teamId || "") + "|" + String(label || "");
  }
  const pendingImgs = new Map();
  function pendingDb(fn) {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open("utsattning-img-v1", 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains("pending")) req.result.createObjectStore("pending");
        };
        req.onsuccess = () => {
          try { fn(req.result, resolve); } catch (e) { resolve(); }
        };
        req.onerror = () => resolve();
      } catch (e) { resolve(); }
    });
  }
  function pendingPut(key, dataUrl) {
    if (key && dataUrl) pendingImgs.set(key, dataUrl);
    return pendingDb((db, done) => {
      const tx = db.transaction("pending", "readwrite");
      tx.objectStore("pending").put(dataUrl, key);
      tx.oncomplete = () => done();
      tx.onerror = () => done();
    });
  }
  function pendingDel(key) {
    pendingImgs.delete(key);
    return pendingDb((db, done) => {
      const tx = db.transaction("pending", "readwrite");
      tx.objectStore("pending").delete(key);
      tx.oncomplete = () => done();
      tx.onerror = () => done();
    });
  }
  function pendingLoadAll() {
    return pendingDb((db, done) => {
      const tx = db.transaction("pending", "readonly");
      const r = tx.objectStore("pending").openCursor();
      r.onsuccess = (ev) => {
        const c = ev.target.result;
        if (!c) { done(); return; }
        pendingImgs.set(c.key, c.value);
        c.continue();
      };
      r.onerror = () => done();
    });
  }
  function catalogImage(stop, teamId, evId) {
    const id = evId || (currentEvent() && currentEvent().id);
    const race = id && window.RACES && window.RACES[id];
    const gid = teamId || currentId || "";
    const groups = (race && race.groups) || [];
    const g = groups.find((x) => x.id === gid) ||
      groups.find((x) => ((x.modes && x.modes.kortast && x.modes.kortast.stops) || []).some((s) => (s.label || "") === ((stop && stop.label) || "")));
    const stops = (g && g.modes && g.modes.kortast && g.modes.kortast.stops) || [];
    const hit = stops.find((s) => (s.label || "") === ((stop && stop.label) || ""));
    return (hit && hit.image) || "";
  }
  function pendingFor(stop, teamId) {
    const ev = currentEvent();
    return pendingImgs.get(stopImgKey(ev && ev.id, teamId || currentId, stop && stop.label)) || "";
  }
  function bindStopImg(el, stop, teamId) {
    if (!el || !stop) return;
    el.style.display = "";
    const urls = [];
    const pending = pendingFor(stop, teamId);
    const cat = catalogImage(stop, teamId);
    if (pending && String(pending).indexOf("data:") === 0) urls.push(pending);
    const file = (stop.image && String(stop.image).indexOf("img/") === 0) ? stop.image : (cat && String(cat).indexOf("img/") === 0 ? cat : "");
    if (file) urls.push(imgSrc(file));
    let i = 0;
    let retried = false;
    const go = () => {
      if (i >= urls.length) {
        el.style.display = "none";
        return;
      }
      const u = urls[i];
      el.onload = () => { el.style.display = ""; };
      el.onerror = () => {
        if (!retried && u.indexOf("data:") !== 0 && u.indexOf("blob:") !== 0) {
          retried = true;
          setTimeout(() => {
            el.src = u + (u.indexOf("?") >= 0 ? "&" : "?") + "rtry=" + Date.now();
          }, 700);
          return;
        }
        retried = false;
        i += 1;
        go();
      };
      el.src = u;
    };
    go();
    el.onclick = () => {
      const ov = document.getElementById("imgOverlay");
      document.getElementById("imgOverlayImg").src = el.currentSrc || el.src || imgSrc(stop.image || cat);
      ov.classList.add("open");
      ov.setAttribute("aria-hidden", "false");
    };
  }
  function stableImgPath(evId, teamId, label) {
    return "img/" + fileSlug(evId || "lopp") + "-" + fileSlug(teamId) + "-" + fileSlug(label || "punkt") + ".jpg";
  }
  function fitUploadImage(dataUrl) {
    const src = String(dataUrl || "");
    const maxChars = 220000;
    if (!src || src.indexOf("data:image") !== 0 || src.length <= maxChars) return Promise.resolve(src);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          let w = img.naturalWidth || 1600;
          let h = img.naturalHeight || 1200;
          let q = 0.72;
          let out = src;
          for (let n = 0; n < 7; n++) {
            const long = Math.max(w, h);
            if (long > 1400) {
              const s = 1400 / long;
              w = Math.max(1, Math.round(w * s));
              h = Math.max(1, Math.round(h * s));
            }
            const c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            c.getContext("2d").drawImage(img, 0, 0, w, h);
            out = c.toDataURL("image/jpeg", q);
            if (out.length <= maxChars) break;
            w = Math.max(640, Math.round(w * 0.84));
            h = Math.max(480, Math.round(h * 0.84));
            q = Math.max(0.5, q - 0.07);
          }
          resolve(out || src);
        } catch (e) { resolve(src); }
      };
      img.onerror = () => resolve(src);
      img.src = src;
    });
  }
  function stripInlineImages(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(stripInlineImages); return; }
    if (typeof node.image === "string" && node.image.indexOf("data:") === 0) node.image = "";
    Object.keys(node).forEach((k) => { if (k !== "image") stripInlineImages(node[k]); });
  }
  function stopImgPath(ev, team, stop) {
    if (stop && stop.image && String(stop.image).indexOf("img/") === 0) return String(stop.image).replace(/\.[a-z0-9]+$/i, ".jpg");
    const cat = catalogImage(stop, team && team.id, ev && ev.id);
    if (cat && String(cat).indexOf("img/") === 0) return String(cat).replace(/\.[a-z0-9]+$/i, ".jpg");
    return stableImgPath(ev && ev.id, team && team.id, stop && (stop.label || stop.name));
  }
  function loadPublishToken() {
    const P = window.MattorPublish;
    const raw = localStorage.getItem(GH_TOKEN_KEY) || "";
    return P && P.normalizeToken ? P.normalizeToken(raw) : String(raw).trim();
  }
  function savePublishToken(t) {
    const P = window.MattorPublish;
    t = P && P.normalizeToken ? P.normalizeToken(t) : String(t || "").trim();
    if (t) localStorage.setItem(GH_TOKEN_KEY, t);
    return t;
  }
  function askPublishToken() {
    return new Promise((resolve) => {
      const modal = document.getElementById("tokenModal");
      const input = document.getElementById("tokenInput");
      const save = document.getElementById("tokenSave");
      const cancel = document.getElementById("tokenCancel");
      if (!modal || !input || !save) {
        resolve(savePublishToken(window.prompt("Klistra in GitHub-token en gång på den här enheten.") || ""));
        return;
      }
      const finish = (val) => {
        modal.classList.remove("on");
        modal.setAttribute("aria-hidden", "true");
        save.onclick = null;
        if (cancel) cancel.onclick = null;
        resolve(savePublishToken(val || ""));
      };
      modal.classList.add("on");
      modal.setAttribute("aria-hidden", "false");
      input.value = "";
      setTimeout(() => { try { input.focus(); } catch (e) {} }, 50);
      save.onclick = () => finish(input.value);
      if (cancel) cancel.onclick = () => finish("");
    });
  }
  async function ensurePublishToken(force) {
    const t = loadPublishToken();
    if (!force && t && t.length >= 32) return t;
    if (t && t.length < 32) {
      try { localStorage.removeItem(GH_TOKEN_KEY); } catch (e) {}
    }
    return askPublishToken();
  }
  function collectUploads() {
    const uploads = [];
    const seen = new Map();
    function add(ev, t, s, raw) {
      if (!ev || !t || !s || !raw || String(raw).indexOf("data:image") !== 0) return;
      const payload = dataImagePayload(raw);
      if (!payload) return;
      const path = stopImgPath(ev, t, s);
      s.image = path;
      if (seen.has(path)) return;
      seen.set(path, true);
      uploads.push({ path, b64: payload.b64, evId: ev.id, teamId: t.id, label: s.label || "" });
    }
    (store.events || []).forEach((ev) => {
      (ev.teams || []).forEach((t) => {
        M.pointsOf(t).forEach((s) => {
          if (!s) return;
          let raw = "";
          if (typeof s.image === "string" && s.image.indexOf("data:image") === 0) raw = s.image;
          else raw = pendingImgs.get(stopImgKey(ev.id, t.id, s.label || "")) || "";
          add(ev, t, s, raw);
        });
      });
    });
    pendingImgs.forEach((raw, key) => {
      const parts = String(key).split("|");
      if (parts.length < 3) return;
      const ev = (store.events || []).find((e) => e.id === parts[0]);
      const t = ev && (ev.teams || []).find((x) => x.id === parts[1]);
      if (!ev || !t) return;
      const s = M.pointsOf(t).find((p) => (p.label || "") === parts.slice(2).join("|"));
      if (s) add(ev, t, s, raw);
    });
    return uploads;
  }
  function publishCatalog() {
    if (isViewOnly()) return Promise.resolve(false);
    const job = publishGate.then(() => publishCatalogNow(), () => publishCatalogNow());
    publishGate = job.then(() => undefined, () => undefined);
    return job;
  }
  async function publishCatalogNow(retried) {
    const P = window.MattorPublish;
    if (!P) {
      showToast("Kunde inte publicera: publiceringskoden saknas");
      return false;
    }
    const token = await ensurePublishToken();
    if (!token) {
      showToast("Sparat på den här enheten. Publicera via Meny → Spara för alla");
      return false;
    }
    setBusy(true, "Sparar för alla…");
    let keepBusy = false;
    try {
      await P.checkToken(token);
      persist();
      const uploads = collectUploads();
      persist();
      document.getElementById("busyText").textContent = uploads.length ? "Publicerar bilder och lopp…" : "Sparar lopp…";
      const localRaces = M.buildRacesObject(store.events);
      stripInlineImages(localRaces);
      const remote = await P.readRaces(token);
      const removedIds = [];
      Object.keys(remote).concat(Object.keys(localRaces)).forEach((id) => {
        if (M.isRemoved(id) && removedIds.indexOf(id) < 0) removedIds.push(id);
      });
      const races = P.mergeRaces(remote, localRaces, { removed: removedIds, uploads });
      const files = uploads.map((u) => ({ path: u.path, b64: u.b64 }));
      files.push({ path: "races.js", b64: P.utf8ToB64(P.racesFile(races)) });
      await P.commitFiles(token, files, uploads.length ? "Bilder och lopp" : "Uppdatera lopp för alla");
      const live = await P.readRaces(token);
      if (uploads.length && !P.uploadsInCatalog(live, uploads)) {
        throw new Error("Bilden nådde inte katalogen");
      }
      const lost = P.missingNotes ? P.missingNotes(live, localRaces) : [];
      if (lost.length) throw new Error("Noteringarna nådde inte katalogen");
      window.RACES = live;
      (store.events || []).forEach((ev) => {
        if (live[ev.id] && live[ev.id].rev) ev.rev = live[ev.id].rev;
      });
      persist();
      await Promise.all(uploads.map((u) => pendingDel(stopImgKey(u.evId, u.teamId, u.label))));
      showToast("Sparat för alla på utsattning-länken");
      return true;
    } catch (e) {
      const msg = (e && e.message) || "";
      const name = (e && e.name) || "";
      const status = e && e.status;
      const authish = status === 401 || status === 403 || (P.isAuthFail && P.isAuthFail(e));
      const netish = /abort/i.test(msg + " " + name) || (P.isNet && P.isNet(e));
      if (!retried && (authish || netish)) {
        try { localStorage.removeItem(GH_TOKEN_KEY); } catch (err) {}
        keepBusy = true;
        setBusy(false);
        showToast("Klistra in GitHub-nyckeln igen (samma som på datorn).");
        const again = await askPublishToken();
        if (again) return publishCatalogNow(true);
        showToast("Sparat på den här enheten. Publicera via Meny → Spara för alla");
        return false;
      }
      if (authish) {
        showToast("Nyckeln avvisades. Meny → Ny GitHub-nyckel.");
      } else if (P.isConflict && P.isConflict(e)) {
        showToast("GitHub var upptaget. Tryck Klar igen.");
      } else if (netish) {
        showToast("Nådde inte GitHub. Meny → Ny GitHub-nyckel, sen Klar igen.");
      } else showToast("Kunde inte publicera: " + String(msg).slice(0, 120));
      return false;
    } finally {
      if (!keepBusy) setBusy(false);
    }
  }
  function timeSelectHtml(id, value) {
    const m = String(value || "").trim().match(/^(\d{1,2}):(\d{2})/);
    const curH = m ? String(m[1]).padStart(2, "0") : "";
    const curM = m ? m[2] : "";
    const hours = ["<option value=\"\">—</option>"];
    for (let i = 0; i < 24; i++) {
      const v = String(i).padStart(2, "0");
      hours.push(`<option value="${v}"${curH === v ? " selected" : ""}>${v}</option>`);
    }
    const mins = ["<option value=\"\">—</option>"];
    const seen = new Set();
    for (let i = 0; i < 60; i += 5) {
      const v = String(i).padStart(2, "0");
      seen.add(v);
      mins.push(`<option value="${v}"${curM === v ? " selected" : ""}>${v}</option>`);
    }
    if (curM && !seen.has(curM)) mins.push(`<option value="${curM}" selected>${curM}</option>`);
    return `<div class="time-pick"><select id="${id}H">${hours.join("")}</select><span>:</span><select id="${id}M">${mins.join("")}</select></div>`;
  }
  function readTime(box, id) {
    const hEl = box.querySelector("#" + id + "H");
    if (!hEl) return "";
    const h = hEl.value;
    const min = (box.querySelector("#" + id + "M") || {}).value || "00";
    return h ? (h + ":" + min) : "";
  }
  function flushPointForm() {
    if (ptFormIndex < 0) return;
    const box = editorBody.querySelector("#ptForm");
    if (!box || !box.querySelector("#pLabel")) return;
    readPointForm(ptFormIndex);
  }
  function writePoints(team, pts) {
    (pts || []).forEach((p, i) => {
      if (!p || typeof p !== "object") return;
      p.idx = i + 1;
      if (p.label && !p.name) p.name = p.label;
      if (p.name && !p.label) p.label = p.name;
    });
    if (!team.modes) team.modes = M.emptyModes();
    team.modes.kortast.stops = pts;
    team.modes.kortast.track = [];
    team.modes.kortast.legs = [];
    team.modes.kortast.km = 0;
    team.modes.kortast.min = 0;
    if (!team.modes.iga) team.modes.iga = M.emptyModes().iga;
    team.modes.iga.stops = pts.slice();
    team.modes.iga.track = [];
    team.modes.iga.legs = [];
    team.modes.iga.km = 0;
    team.modes.iga.min = 0;
    if (store) store.customized = true;
    persist();
  }
  function readPointForm(i) {
    const team = teamById(editTeamId);
    const pts = M.pointsOf(team);
    const box = editorBody.querySelector("#ptForm");
    if (!box || !pts[i]) return;
    const ev = currentEvent();
    const oldLabel = pts[i].label || "";
    pts[i].label = box.querySelector("#pLabel").value.trim();
    if (ev && oldLabel !== (pts[i].label || "")) {
      const oldKey = stopImgKey(ev.id, editTeamId, oldLabel);
      const newKey = stopImgKey(ev.id, editTeamId, pts[i].label || "");
      const data = pendingImgs.get(oldKey);
      if (data) {
        pendingDel(oldKey);
        pendingPut(newKey, data);
      }
    }
    pts[i].iga = readTime(box, "pIga");
    pts[i].forsta = readTime(box, "pForsta");
    pts[i].sista = readTime(box, "pSista");
    pts[i].setup = box.querySelector("#pSetup").value.trim();
    pts[i].placering = box.querySelector("#pNote").value.trim();
    pts[i].note = pts[i].placering;
    pts[i].name = pts[i].label || pts[i].name;
    const parsed = M.parseLatLon(box.querySelector("#pGps").value);
    if (parsed) { pts[i].lat = parsed.lat; pts[i].lon = parsed.lon; }
    writePoints(team, pts);
  }
  function saveEditorFields() {
    flushPointForm();
    const ev = currentEvent();
    if (!ev) return;
    const nameEl = editorBody.querySelector("#evName");
    if (!nameEl) return;
    ev.name = nameEl.value.trim() || ev.name;
    const team = teamById(editTeamId);
    if (team) {
      team.name = editorBody.querySelector("#teamName").value.trim() || team.name;
      team.color = editorBody.querySelector("#teamColor").value || team.color;
      team.ansvarig = editorBody.querySelector("#teamPeople").value.trim();
    }
    if (store) store.customized = true;
    persist();
    document.getElementById("raceTitle").textContent = ev.name;
  }
  function renderEditor() {
    const ev = currentEvent();
    if (!ev) return;
    if (!editTeamId || !teamById(editTeamId)) editTeamId = (teams()[0] && teams()[0].id) || "";
    const team = teamById(editTeamId);
    const pts = team ? M.pointsOf(team) : [];
    editorBody.innerHTML = `
      <label>Namn på loppet</label>
      <input id="evName" value="${esc(ev.name)}" placeholder="Nytt lopp" />
      <div class="edit-actions">
        <button type="button" class="btn" id="newEvent">Nytt lopp</button>
        <button type="button" class="btn btn-danger" id="delEvent">Ta bort lopp</button>
      </div>
      <div class="edit-actions" id="teamChips"></div>
      <div class="row">
        <div><label>Grupp</label><input id="teamName" value="${esc(team ? team.name : "")}" /></div>
        <div><label>Färg</label><input id="teamColor" type="color" value="${team ? team.color : "#f59e0b"}" /></div>
      </div>
      <label>Ansvariga</label>
      <input id="teamPeople" value="${esc(team ? team.ansvarig : "")}" placeholder="Vilka som kör" />
      <div class="edit-actions">
        <button type="button" class="btn" id="addTeam">+ Grupp</button>
        <button type="button" class="btn btn-danger" id="delTeam">Ta bort grupp</button>
      </div>
      <label>Timingpunkter</label>
      <div id="ptList"></div>
      <div class="edit-actions">
        <button type="button" class="btn" id="addPt">+ Punkt</button>
        <button type="button" class="btn btn-accent" id="recalc">Beräkna körvägar</button>
      </div>
      <div id="ptForm"></div>
    `;
    const chips = editorBody.querySelector("#teamChips");
    teams().forEach((t) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn";
      b.textContent = t.name;
      if (t.id === editTeamId) { b.style.background = t.color; b.style.color = "#0b1220"; }
      b.addEventListener("click", () => { saveEditorFields(); editTeamId = t.id; renderEditor(); });
      chips.appendChild(b);
    });
    const list = editorBody.querySelector("#ptList");
    pts.forEach((p, i) => {
      const card = document.createElement("div");
      card.className = "pt-card" + (i === ptFormIndex ? " is-edit" : "");
      card.innerHTML = `<div class="pt-body"><strong>${i + 1}. ${esc(p.label) || "Namnlös"}</strong>
        <div class="who">${p.lat ? p.lat.toFixed(5) + ", " + p.lon.toFixed(5) : "Ingen GPS"} · Igång ${esc(p.iga) || "—"}${p.image ? " · bild" : ""}</div></div>
        <button type="button" class="btn pt-up" ${i === 0 ? "disabled" : ""}>▲</button>
        <button type="button" class="btn pt-down" ${i === pts.length - 1 ? "disabled" : ""}>▼</button>`;
      card.addEventListener("click", (ev) => {
        if (ev.target.closest(".pt-up, .pt-down")) return;
        renderPointForm(i);
      });
      card.querySelector(".pt-up").addEventListener("click", (ev) => { ev.stopPropagation(); movePoint(i, -1); });
      card.querySelector(".pt-down").addEventListener("click", (ev) => { ev.stopPropagation(); movePoint(i, 1); });
      list.appendChild(card);
    });
    editorBody.querySelector("#evName").addEventListener("change", saveEditorFields);
    editorBody.querySelector("#teamName").addEventListener("change", saveEditorFields);
    editorBody.querySelector("#teamColor").addEventListener("change", () => { saveEditorFields(); renderEditor(); });
    editorBody.querySelector("#teamPeople").addEventListener("change", saveEditorFields);
    editorBody.querySelector("#newEvent").addEventListener("click", newEvent);
    editorBody.querySelector("#delEvent").addEventListener("click", deleteEvent);
    editorBody.querySelector("#addTeam").addEventListener("click", addTeam);
    editorBody.querySelector("#delTeam").addEventListener("click", deleteTeam);
    editorBody.querySelector("#addPt").addEventListener("click", addPoint);
    editorBody.querySelector("#recalc").addEventListener("click", () => recalcCurrent(true));
  }
  function movePoint(i, dir) {
    const team = teamById(editTeamId);
    const list2 = M.pointsOf(team);
    const j = i + dir;
    if (j < 0 || j >= list2.length) return;
    flushPointForm();
    const tmp = list2[i]; list2[i] = list2[j]; list2[j] = tmp;
    team.orderLocked = true;
    writePoints(team, list2);
    renderEditor();
  }
  function renderPointForm(i) {
    saveEditorFields();
    const team = teamById(editTeamId);
    const pts = M.pointsOf(team);
    const p = pts[i];
    if (!p) return;
    ptFormIndex = i;
    const box = editorBody.querySelector("#ptForm");
    const preview = (p.image || pendingFor(p, editTeamId) || catalogImage(p, editTeamId)) ? `<img class="pt-img" alt="">` : "";
    box.innerHTML = `
      <label>Namn</label><input id="pLabel" value="${esc((p.label || "") === "Ny punkt" ? "" : (p.label || ""))}" placeholder="Ny punkt" />
      <label>Igång</label>${timeSelectHtml("pIga", p.iga)}
      <label>Första</label>${timeSelectHtml("pForsta", p.forsta)}
      <label>Sista</label>${timeSelectHtml("pSista", p.sista)}
      <label>Vad ska sättas upp</label><input id="pSetup" value="${esc(p.setup || "")}" />
      <label>Placering / notering</label><textarea id="pNote">${esc(p.placering || "")}</textarea>
      <label>GPS eller kartlänk</label>
      <input id="pGps" value="${p.lat ? p.lat.toFixed(6) + ", " + p.lon.toFixed(6) : ""}" placeholder="56.05, 12.68" />
      <label>Bild</label>
      ${preview}
      <div class="edit-actions">
        <input type="file" id="pImgFile" accept="image/*" hidden />
        <button type="button" class="btn" id="pImgPick">Välj bild</button>
        ${p.image ? `<button type="button" class="btn btn-danger" id="pImgDel">Ta bort bild</button>` : ""}
      </div>
      <div class="edit-actions">
        <button type="button" class="btn btn-accent" id="pPick">Välj på karta</button>
        <button type="button" class="btn" id="pSave">Spara punkt</button>
        <button type="button" class="btn btn-danger" id="pDel">Ta bort punkt</button>
      </div>
    `;
    editorBody.querySelectorAll(".pt-card").forEach((c, n) => c.classList.toggle("is-edit", n === i));
    const previewEl = box.querySelector(".pt-img");
    if (previewEl) bindStopImg(previewEl, p, editTeamId);
    box.querySelectorAll("input, textarea, select").forEach((el) => {
      if (el.id === "pImgFile") return;
      el.addEventListener("change", () => readPointForm(i));
    });
    box.querySelector("#pSave").addEventListener("click", () => savePoint(i));
    box.querySelector("#pDel").addEventListener("click", () => deletePoint(i));
    box.querySelector("#pPick").addEventListener("click", () => { readPointForm(i); startPick(i); });
    box.querySelector("#pGps").addEventListener("change", () => {
      const raw = box.querySelector("#pGps").value.trim();
      const parsed = M.parseLatLon(raw);
      if (parsed) {
        const list = M.pointsOf(teamById(editTeamId));
        list[i].lat = parsed.lat; list[i].lon = parsed.lon;
        writePoints(teamById(editTeamId), list);
        box.querySelector("#pGps").value = parsed.lat.toFixed(6) + ", " + parsed.lon.toFixed(6);
      } else if (raw) showToast("Kunde inte läsa GPS");
    });
    const fileInput = box.querySelector("#pImgFile");
    box.querySelector("#pImgPick").addEventListener("click", () => fileInput && fileInput.click());
    if (fileInput) {
      fileInput.addEventListener("change", async (ev) => {
        const file = ev.target.files && ev.target.files[0];
        if (!file) return;
        setBusy(true, "Komprimerar bild…");
        try {
          const dataUrl = await fitUploadImage(await M.compressImage(file, 1400, 0.75));
          const list = M.pointsOf(teamById(editTeamId));
          const ev = currentEvent();
          const stop = list[i];
          if (!stop) return;
          const path = stopImgPath(ev, teamById(editTeamId), stop);
          stop.image = path;
          await pendingPut(stopImgKey(ev && ev.id, editTeamId, stop.label || ""), dataUrl);
          writePoints(teamById(editTeamId), list);
          persist();
          renderEditor();
          renderPointForm(i);
          showToast("Bild vald. Tryck Klar så alla enheter ser den");
        } catch (e) { showToast("Kunde inte läsa bilden"); }
        finally { setBusy(false); }
      });
    }
    const delImg = box.querySelector("#pImgDel");
    if (delImg) delImg.addEventListener("click", () => {
      const list = M.pointsOf(teamById(editTeamId));
      const ev = currentEvent();
      if (list[i]) list[i].image = "";
      pendingDel(stopImgKey(ev && ev.id, editTeamId, list[i] && list[i].label));
      writePoints(teamById(editTeamId), list);
      persist();
      renderEditor();
      renderPointForm(i);
    });
  }
  async function savePoint(i) {
    readPointForm(i);
    renderEditor();
    renderPointForm(i);
    showToast("Punkten är sparad här. Tryck Klar så alla ser den");
  }
  function addPoint() {
    saveEditorFields();
    const team = teamById(editTeamId);
    const pts = M.pointsOf(team);
    pts.push({ label: "", lat: NaN, lon: NaN, iga: "", forsta: "", sista: "", maps: "", placering: "", setup: "", image: "" });
    writePoints(team, pts);
    renderEditor();
    renderPointForm(pts.length - 1);
    startPick(pts.length - 1);
  }
  function deletePoint(i) {
    const team = teamById(editTeamId);
    const pts = M.pointsOf(team);
    pts.splice(i, 1);
    writePoints(team, pts);
    pickingIndex = -1;
    pickBanner.classList.remove("on");
    document.body.classList.remove("picking");
    ptFormIndex = -1;
    renderEditor();
  }
  function addTeam() {
    saveEditorFields();
    const ev = currentEvent();
    const t = { id: M.uid("grupp"), name: "Grupp " + (ev.teams.length + 1), ansvarig: "", color: M.COLORS[ev.teams.length % M.COLORS.length], modes: M.emptyModes() };
    ev.teams.push(t);
    editTeamId = t.id;
    persist();
    renderEditor();
  }
  function deleteTeam() {
    const ev = currentEvent();
    if (ev.teams.length < 2) { showToast("Minst en grupp behövs"); return; }
    if (!confirm("Ta bort " + teamById(editTeamId).name + "?")) return;
    ev.teams = ev.teams.filter((t) => t.id !== editTeamId);
    editTeamId = ev.teams[0].id;
    persist();
    currentId = editTeamId;
    renderEditor();
    show(currentId, currentMode, 0, false);
  }
  async function newEvent() {
    if (isViewOnly()) return;
    if (editorEl.classList.contains("open")) saveEditorFields();
    const ev = {
      id: M.uid("lopp"),
      name: "Nytt lopp",
      teams: [{ id: M.uid("grupp"), name: "Grupp 1", ansvarig: "", color: M.COLORS[0], modes: M.emptyModes() }]
    };
    store.events.push(ev);
    store.currentEventId = ev.id;
    M.forgetRemoved(ev.id);
    persist();
    await enterEvent(ev.id);
    openEditor();
  }
  function resetBuiltInStore(preferredId) {
    const bid = preferredId || M.defaultEventId();
    const events = [];
    (M.getAllBuiltInIds() || []).forEach((id) => {
      const s = M.seedEvent(id);
      if (s) events.push(s);
    });
    store = { currentEventId: bid, customized: false, events };
  }
  function deleteEvent() {
    if (isViewOnly()) return;
    const id = store.currentEventId;
    const ev = store.events.find((e) => e.id === id);
    if (!ev) return;
    if (M.isCoreRace(id)) {
      if (!confirm("Rensa " + ev.name + " och återställ originalet?")) return;
      resetBuiltInStore(id);
    } else if (store.events.length < 2) {
      if (!confirm("Rensa loppet och återställ standardlopp?")) return;
      M.rememberRemoved(id);
      resetBuiltInStore();
    } else {
      if (!confirm("Ta bort loppet " + ev.name + "?")) return;
      M.rememberRemoved(id);
      store.events = store.events.filter((e) => e.id !== id);
      ensureSeed();
      store.currentEventId = store.events[0].id;
    }
    persist();
    editorEl.classList.remove("open");
    document.body.classList.remove("editing", "in-race", "picking");
    openChooser();
    showToast("Lopp borttaget");
    publishCatalog();
  }
  function startPick(i) {
    pickingIndex = i;
    document.body.classList.add("picking");
    pickBanner.classList.add("on");
    map.invalidateSize();
  }
  function applyPick(latlng) {
    if (pickingIndex < 0) return;
    const team = teamById(editTeamId);
    const pts = M.pointsOf(team);
    const idx = pickingIndex;
    if (!pts[idx]) return;
    pts[idx].lat = Math.round(latlng.lat * 1e6) / 1e6;
    pts[idx].lon = Math.round(latlng.lng * 1e6) / 1e6;
    writePoints(team, pts);
    pickingIndex = -1;
    pickBanner.classList.remove("on");
    document.body.classList.remove("picking");
    renderEditor();
    renderPointForm(idx);
    showToast("GPS sparad");
  }
  map.on("click", (e) => applyPick(e.latlng));
  async function recalcCurrent(fromBtn) {
    saveEditorFields();
    const team = teamById(editTeamId || currentId);
    if (!team) return;
    setBusy(true, "Beräknar körväg för " + team.name + "…");
    try {
      await M.recalcTeam(team, (msg) => { document.getElementById("busyText").textContent = msg; });
      persist();
      if (fromBtn) showToast("Körvägar uppdaterade");
      if (editorEl.classList.contains("open")) renderEditor();
    } catch (err) { showToast("Kunde inte räkna körväg"); }
    setBusy(false);
  }
  function openEditor() {
    if (isViewOnly()) return;
    document.getElementById("more").style.display = "none";
    closeChooser();
    editTeamId = currentId || (teams()[0] && teams()[0].id) || "";
    document.body.classList.add("editing", "in-race");
    editorEl.classList.add("open");
    renderEditor();
  }
  async function closeEditor() {
    saveEditorFields();
    pickingIndex = -1;
    pickBanner.classList.remove("on");
    document.body.classList.remove("picking");
    editorEl.classList.remove("open");
    document.body.classList.remove("editing");
    persist();
    const ev = currentEvent();
    await publishCatalog();
    if (ev) {
      document.body.classList.add("in-race");
      closeChooser();
      mapViewKey = "";
      lastMapSizeKey = "";
      show(editTeamId || currentId, currentMode, 0, true, false);
      ensureEventRoutes(ev, editTeamId || currentId);
    }
  }
  function download(name, text, type) {
    const blob = new Blob([text], { type: type || "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  async function start() {
    const params = new URLSearchParams(location.search);
    if (!isOverview() && (params.get("oversikt") === "1" || params.get("admin") === "1")) {
      params.delete("oversikt");
      params.delete("admin");
      const q = params.toString();
      location.replace("oversikt.html" + (q ? "?" + q : "") + location.hash);
      return;
    }
    const lopp = params.get("lopp");
    store = M.loadStore();
    if (!store) {
      const events = (M.getAllBuiltInIds() || []).map((id) => M.seedEvent(id)).filter(Boolean);
      store = { currentEventId: M.defaultEventId(), events };
    }
    ensureSeed();
    await pendingLoadAll();
    document.body.classList.toggle("view-only", isViewOnly());
    document.body.classList.toggle("overview-mode", isOverview());
    if (lopp && store.events.some((e) => e.id === lopp)) store.currentEventId = lopp;

    if (window.MattorLive) applyLiveCache();

    if (isOverview()) {
      if (lopp && store.events.some((e) => e.id === lopp)) {
        store.currentEventId = lopp;
        closeChooser();
        openLiveBoard();
        return;
      }
      openChooser();
      return;
    }

    const startH = parseHash();
    if (lopp && store.events.some((e) => e.id === lopp)) {
      document.body.classList.add("in-race");
      closeChooser();
      mapViewKey = "";
      lastMapSizeKey = "";
      show(startH.id, startH.mode, startH.idx, true, false);
      ensureEventRoutes(currentEvent(), startH.id);
      return;
    }
    if (isViewOnly()) {
      const bid = lopp && M.isBuiltIn(lopp) ? lopp : M.defaultEventId();
      await enterEvent(bid);
      return;
    }
    openChooser();
  }
  if (window.MattorLive) {
    window.MattorLive.on(() => {
      applyingLive = true;
      try { refreshLiveUi(); } finally { applyingLive = false; }
    });
    setInterval(() => {
      const board = document.getElementById("liveBoard");
      if (!board || !board.classList.contains("open")) return;
      const status = document.getElementById("liveStatus");
      const Llive = window.MattorLive;
      if (!status || !Llive) return;
      const on = Llive.connected();
      status.classList.toggle("is-on", !!on);
      status.textContent = on ? "Live · kartan uppdateras när någon bockar av" : "Ansluter till live-status…";
    }, 2000);
  }
  start();
})();
