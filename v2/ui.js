(function () {
  const PUBLIC_BASE = "https://thomazzo91.github.io/utsattning/v2/";
  const M = window.Mattor;
  const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>';
  const VISITED_KEY = "visited-v2";
  const LEGACY_VISIT_KEY = "hbgm26-visited-v1";

  const map = L.map("map", { tap: true, zoomControl: false, attributionControl: true }).setView([62.5, 17], 5);
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
  let publishing = false;
  const GH_REPO = "Thomazzo91/utsattning";
  const GH_TOKEN_KEY = "utsattning-publish-token";
  let liveMap = null;
  let liveLayer = null;
  let liveFitId = "";
  let liveFocusKey = "";

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
  function imgSrc(src) {
    if (!src) return "";
    if (/^(data:|https?:|\/\/)/i.test(src)) return src;
    return "../" + String(src).replace(/^\.\//, "");
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
    if (document.body.classList.contains("in-race") && currentId) {
      const g = viewOf(currentId, currentMode);
      renderCard(g);
      renderChips(g);
      paintMarkers(g);
      renderList(g);
    }
  }
  function liveEvent() {
    if (document.body.classList.contains("in-race")) return currentEvent();
    const lopp = new URLSearchParams(location.search).get("lopp");
    if (lopp && store && store.events) return store.events.find((e) => e.id === lopp) || null;
    return null;
  }
  function liveStops(ev) {
    const out = [];
    ((ev && ev.teams) || []).forEach((t) => {
      (M.pointsOf(t) || []).forEach((s, i) => {
        if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) return;
        out.push({ team: t, stop: s, idx: i + 1, key: ev.id + "|" + t.id + "|" + s.label });
      });
    });
    return out;
  }
  function liveMarkerIcon(color, up, n) {
    return L.divIcon({
      className: "",
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      html: `<div class="live-mk${up ? " is-up" : ""}"><div class="live-mk-num" style="background:${up ? "var(--ok)" : color}">${up ? CHECK_SVG : n}</div></div>`
    });
  }
  function ensureLiveMap() {
    const el = document.getElementById("liveMap");
    if (!el) return;
    if (liveMap) {
      setTimeout(() => liveMap.invalidateSize(), 60);
      return;
    }
    liveMap = L.map(el, { tap: true, zoomControl: false, attributionControl: true }).setView([62.5, 17], 5);
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
    liveLayer.clearLayers();
    const latlngs = [];
    pts.forEach((p) => {
      const rec = Llive ? Llive.get(ev.id, p.team.id, p.stop.label) : null;
      const up = !!(rec && rec.on);
      const m = L.marker([p.stop.lat, p.stop.lon], {
        icon: liveMarkerIcon(p.team.color, up, p.idx),
        zIndexOffset: up ? 400 : 0
      });
      m.on("click", () => {
        liveFocusKey = p.key;
        const info = document.getElementById("liveInfo");
        const meta = up
          ? ("Uppe " + liveClock(rec.t) + (rec.who ? " · " + rec.who : ""))
          : "Inte uppe";
        if (info) info.innerHTML = `<strong>${esc(p.stop.label || p.stop.name || "Punkt")}</strong><span>${esc(p.team.name)} · ${esc(meta)}</span>`;
      });
      m.addTo(liveLayer);
      latlngs.push([p.stop.lat, p.stop.lon]);
      if (p.key === liveFocusKey) {
        const infoEl = document.getElementById("liveInfo");
        const meta = up
          ? ("Uppe " + liveClock(rec.t) + (rec.who ? " · " + rec.who : ""))
          : "Inte uppe";
        if (infoEl) infoEl.innerHTML = `<strong>${esc(p.stop.label || p.stop.name || "Punkt")}</strong><span>${esc(p.team.name)} · ${esc(meta)}</span>`;
      }
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
      if (info) info.textContent = "";
      return;
    }
    const pts = liveStops(ev);
    const upCount = pts.filter((p) => Llive && Llive.isOn(ev.id, p.team.id, p.stop.label)).length;
    if (title) title.textContent = ev.name;
    if (prog) prog.textContent = upCount + " av " + pts.length + " uppe";
    if (legend) {
      legend.innerHTML = "";
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
    if (info && !liveFocusKey) info.textContent = "Tryck på en punkt för detaljer";
    ensureLiveMap();
    paintLiveMarkers(ev, liveFitId !== ev.id);
  }
  function openLiveBoard() {
    document.getElementById("more").style.display = "none";
    if (!liveEvent()) {
      showToast("Öppna ett lopp först");
      return;
    }
    document.getElementById("liveBoard").classList.add("open");
    document.body.classList.add("live-open");
    renderLiveBoard();
    setTimeout(() => { if (liveMap) liveMap.invalidateSize(); }, 80);
  }
  function closeLiveBoard() {
    document.getElementById("liveBoard").classList.remove("open");
    document.body.classList.remove("live-open");
    liveFitId = "";
    liveFocusKey = "";
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
      b.addEventListener("click", () => show(t.id, currentMode, 0, false));
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
    const img = s.image ? `<img class="thumb" src="${esc(imgSrc(s.image))}" alt="">` : "";
    const nextLeg = g.legs[selected];
    card.innerHTML = `
      <div class="card-head">
        <span class="num" style="background:${g.color}">${selected + 1}</span>
        <div style="flex:1;min-width:0">
          <h2>${esc(s.label || s.name || "Punkt")}</h2>
          <p class="setup">${esc(s.setup || "")}${nextLeg ? " · " + nextLeg.km + " km till nästa" : ""}</p>
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
    if (thumb) {
      thumb.addEventListener("click", () => {
        const ov = document.getElementById("imgOverlay");
        document.getElementById("imgOverlayImg").src = imgSrc(s.image);
        ov.classList.add("open");
        ov.setAttribute("aria-hidden", "false");
      });
    }
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
    if (on) on.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
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

  function drawMap(g, panToStop) {
    layer.clearLayers();
    markers = [];
    routeLines = [];
    const curSegs = (g.segs && g.segs.length) ? g.segs : null;
    if (curSegs) {
      curSegs.forEach((s) => {
        if (!s || !s.geom || !s.geom.length) return;
        const latlngs = s.geom.map(([lon, lat]) => [lat, lon]);
        let opts = { color: g.color, weight: 6, opacity: 0.92 };
        if (s.profile === "foot") opts = { color: "#0b1220", weight: 7, opacity: 0.92, dashArray: "16 8" };
        else if (s.profile === "bike") opts = { color: "#0b1220", weight: 6, opacity: 0.9, dashArray: "14 8" };
        else if (s.profile === "crow") opts = { color: "#111827", weight: 3, opacity: 0.85, dashArray: "2 8" };
        routeLines.push(L.polyline(latlngs, opts).addTo(layer));
      });
    } else if (g.track && g.track.length) {
      const latlngs = g.track.map(([lon, lat]) => [lat, lon]);
      routeLines.push(L.polyline(latlngs, { color: g.color, weight: 6, opacity: 0.92 }).addTo(layer));
    } else {
      const fallback = g.stops.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon)).map((s) => [s.lat, s.lon]);
      if (fallback.length >= 2) routeLines.push(L.polyline(fallback, { color: g.color, weight: 5, opacity: 0.75 }).addTo(layer));
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
    map.invalidateSize();
    if (panToStop && g.stops[selected]) {
      map.setView([g.stops[selected].lat, g.stops[selected].lon], Math.max(map.getZoom(), 15), { animate: true });
      return;
    }
    if (routeLines.length) {
      let b = routeLines[0].getBounds();
      for (let i = 1; i < routeLines.length; i++) b.extend(routeLines[i].getBounds());
      map.fitBounds(b, mapPad());
    } else if (g.stops.length) {
      map.fitBounds(L.latLngBounds(g.stops.map((s) => [s.lat, s.lon])), mapPad());
    }
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
    paintGroups();
    renderChips(g);
    renderCard(g);
    renderList(g);
    drawMap(g, !!pan);
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
      b.addEventListener("click", () => enterEvent(ev.id));
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
  function enterEvent(id) {
    if (!store.events.some((e) => e.id === id)) return;
    store.currentEventId = id;
    persist();
    closeChooser();
    document.body.classList.add("in-race");
    const tid = (currentEvent() && currentEvent().teams[0] && currentEvent().teams[0].id) || "";
    ignoreHash = true;
    history.replaceState(null, "", location.pathname + "?lopp=" + encodeURIComponent(id) + hashFor(tid, "kortast", 0));
    setTimeout(() => { ignoreHash = false; }, 0);
    show(tid, "kortast", 0, true, false);
    setTimeout(() => map.invalidateSize(), 80);
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
  document.getElementById("liveMenuBtn").addEventListener("click", openLiveBoard);
  document.getElementById("liveClose").addEventListener("click", closeLiveBoard);
  document.getElementById("publishBtn").addEventListener("click", async () => {
    document.getElementById("more").style.display = "none";
    await publishCatalog();
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
    show(id, mode, idx, true, true);
  });
  window.addEventListener("resize", () => map.invalidateSize());

  function persist() {
    if (isViewOnly()) return;
    try { M.saveStore(store); } catch (e) {
      showToast("Kunde inte spara lokalt");
    }
  }
  function utf8ToB64(str) { return btoa(unescape(encodeURIComponent(str))); }
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
  async function ghJson(method, url, body) {
    const token = localStorage.getItem(GH_TOKEN_KEY) || "";
    const headers = { Accept: "application/vnd.github+json", Authorization: "Bearer " + token };
    if (body) headers["Content-Type"] = "application/json";
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (e) {}
    if (!res.ok) throw new Error((data && data.message) || ("HTTP " + res.status));
    return data;
  }
  async function putRepoFile(rel, b64, message) {
    let sha;
    try { sha = (await ghJson("GET", "https://api.github.com/repos/" + GH_REPO + "/contents/" + rel)).sha; } catch (e) {}
    const body = { message: message || ("Uppdatera " + rel), content: b64, branch: "main" };
    if (sha) body.sha = sha;
    await ghJson("PUT", "https://api.github.com/repos/" + GH_REPO + "/contents/" + rel, body);
  }
  async function ensurePublishToken() {
    let t = (localStorage.getItem(GH_TOKEN_KEY) || "").trim();
    if (t) return t;
    t = (window.prompt("Klistra in GitHub-token med skrivrätt till utsattning (en gång). Sen syns ändringar för alla.") || "").trim();
    if (t) localStorage.setItem(GH_TOKEN_KEY, t);
    return t;
  }
  async function publishStopImages() {
    const seen = new Map();
    for (const ev of store.events || []) {
      for (const t of ev.teams || []) {
        for (const modeName of ["kortast", "iga"]) {
          const stops = t.modes && t.modes[modeName] && t.modes[modeName].stops;
          if (!Array.isArray(stops)) continue;
          for (const s of stops) {
            if (!s || typeof s.image !== "string" || s.image.indexOf("data:image") !== 0) continue;
            const raw = s.image;
            if (seen.has(raw)) { s.image = seen.get(raw); continue; }
            const payload = dataImagePayload(raw);
            if (!payload) continue;
            const fname = (ev.id || "lopp") + "-" + fileSlug(t.id) + "-" + fileSlug(s.label || s.name || "punkt") + "." + payload.ext;
            const rel = "img/" + fname;
            document.getElementById("busyText").textContent = "Laddar upp bild " + (s.label || fname) + "…";
            await putRepoFile(rel, payload.b64, "Bild " + (s.label || fname));
            seen.set(raw, rel);
            s.image = rel;
          }
        }
      }
    }
  }
  async function bustHtmlCache(path, stamp) {
    const meta = await ghJson("GET", "https://api.github.com/repos/" + GH_REPO + "/contents/" + path);
    let html = decodeURIComponent(escape(atob(meta.content.replace(/\s/g, ""))));
    html = html.replace(/races\.js\?v=\d+/g, "races.js?v=" + stamp);
    html = html.replace(/app\.js\?v=\d+/g, "app.js?v=" + stamp);
    html = html.replace(/ui\.js\?v=\d+/g, "ui.js?v=" + stamp);
    await ghJson("PUT", "https://api.github.com/repos/" + GH_REPO + "/contents/" + path, {
      message: "Cache-bust efter publicering",
      content: utf8ToB64(html),
      branch: "main",
      sha: meta.sha
    });
  }
  async function publishCatalog() {
    if (isViewOnly() || publishing) return false;
    const token = await ensurePublishToken();
    if (!token) {
      showToast("Sparat på den här enheten. Publicera via Meny → Spara för alla");
      return false;
    }
    publishing = true;
    setBusy(true, "Sparar för alla…");
    try {
      for (const ev of store.events || []) {
        for (const t of ev.teams || []) {
          if (M.needsRouteRebuild(t)) {
            document.getElementById("busyText").textContent = "Beräknar " + t.name + "…";
            try { await M.recalcTeam(t); } catch (e) {}
          }
        }
      }
      persist();
      await publishStopImages();
      persist();
      const races = M.buildRacesObject(store.events);
      const racesBody = "window.RACES = " + JSON.stringify(races, null, 1) + ";\n";
      const racesMeta = await ghJson("GET", "https://api.github.com/repos/" + GH_REPO + "/contents/races.js");
      await ghJson("PUT", "https://api.github.com/repos/" + GH_REPO + "/contents/races.js", {
        message: "Uppdatera lopp för alla",
        content: utf8ToB64(racesBody),
        branch: "main",
        sha: racesMeta.sha
      });
      const stamp = String(Date.now());
      await bustHtmlCache("index.html", stamp);
      await bustHtmlCache("v2/index.html", stamp);
      window.RACES = races;
      (store.events || []).forEach((ev) => {
        if (races[ev.id] && races[ev.id].rev) ev.rev = races[ev.id].rev;
      });
      persist();
      showToast("Sparat för alla på utsattning-länken");
      return true;
    } catch (e) {
      const msg = (e && e.message) || "";
      if (/bad credentials|401|unauthorized/i.test(msg)) {
        try { localStorage.removeItem(GH_TOKEN_KEY); } catch (err) {}
        showToast("Token ogiltig. Försök Spara för alla igen.");
      } else showToast("Kunde inte publicera: " + String(msg).slice(0, 120));
      return false;
    } finally {
      publishing = false;
      setBusy(false);
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
    pts[i].label = box.querySelector("#pLabel").value.trim();
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
    const preview = p.image ? `<img class="pt-img" src="${esc(imgSrc(p.image))}" alt="">` : "";
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
          const dataUrl = await M.compressImage(file, 1600, 0.82);
          const list = M.pointsOf(teamById(editTeamId));
          if (list[i]) list[i].image = dataUrl;
          writePoints(teamById(editTeamId), list);
          renderEditor();
          renderPointForm(i);
          showToast("Bild sparad. Tryck Klar så alla ser den");
        } catch (e) { showToast("Kunde inte läsa bilden"); }
        finally { setBusy(false); }
      });
    }
    const delImg = box.querySelector("#pImgDel");
    if (delImg) delImg.addEventListener("click", () => {
      const list = M.pointsOf(teamById(editTeamId));
      if (list[i]) list[i].image = "";
      writePoints(teamById(editTeamId), list);
      renderEditor();
      renderPointForm(i);
    });
  }
  async function savePoint(i) {
    readPointForm(i);
    renderEditor();
    renderPointForm(i);
    if ((localStorage.getItem(GH_TOKEN_KEY) || "").trim()) {
      showToast("Punkt sparad, publicerar…");
      await publishCatalog();
    } else showToast("Sparat här. Tryck Klar · spara för alla");
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
  function newEvent() {
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
    enterEvent(ev.id);
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
    editTeamId = currentId || (teams()[0] && teams()[0].id) || "";
    document.body.classList.add("editing");
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
    for (const t of teams()) {
      const pts = M.pointsOf(t).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
      const routed = t.modes && t.modes.kortast && t.modes.kortast.track && t.modes.kortast.track.length;
      if (pts.length && !routed) {
        setBusy(true, "Beräknar körväg för " + t.name + "…");
        try { await M.recalcTeam(t); } catch (err) {}
      }
    }
    persist();
    setBusy(false);
    const ev = currentEvent();
    if (ev) {
      document.body.classList.add("in-race");
      closeChooser();
      show(editTeamId || currentId, currentMode, 0, true, false);
    }
    map.invalidateSize();
    await publishCatalog();
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
    const lopp = params.get("lopp");
    store = M.loadStore();
    if (!store) {
      const events = (M.getAllBuiltInIds() || []).map((id) => M.seedEvent(id)).filter(Boolean);
      store = { currentEventId: M.defaultEventId(), events };
    }
    ensureSeed();
    document.body.classList.toggle("view-only", isViewOnly());
    if (!isViewOnly()) persist();
    if (lopp && store.events.some((e) => e.id === lopp)) store.currentEventId = lopp;

    if (window.MattorLive) applyLiveCache();

    const focusEv = currentEvent();
    if (focusEv) {
      const need = (focusEv.teams || []).filter((t) => M.needsRouteRebuild(t));
      if (need.length) {
        setBusy(true, "Laddar körvägar…");
        try {
          for (const t of need) await M.recalcTeam(t);
          persist();
        } catch (e) {}
        setBusy(false);
      }
    }

    if (lopp && store.events.some((e) => e.id === lopp)) {
      document.body.classList.add("in-race");
      closeChooser();
      const startH = parseHash();
      show(startH.id, startH.mode, startH.idx, true, false);
      if (params.get("oversikt") === "1" || params.get("admin") === "1") openLiveBoard();
      return;
    }
    if (isViewOnly()) {
      const bid = lopp && M.isBuiltIn(lopp) ? lopp : M.defaultEventId();
      enterEvent(bid);
      if (params.get("oversikt") === "1" || params.get("admin") === "1") openLiveBoard();
      return;
    }
    openChooser();
  }
  if (window.MattorLive) {
    window.MattorLive.on(() => {
      applyingLive = true;
      try { refreshLiveUi(); } finally { applyingLive = false; }
    });
  }
  start();
})();
