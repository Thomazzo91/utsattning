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

  let visited = {};
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
    return !!(visited[visitKey(teamId, label)] || (evId === "lopp1" && visited[teamId + "|" + label]));
  }
  function saveVisited() {
    try { localStorage.setItem(VISITED_KEY, JSON.stringify(visited)); } catch (e) {}
  }
  function setDone(teamId, label, on) {
    const k = visitKey(teamId, label);
    const legacy = currentEvent() && currentEvent().id === "lopp1" ? teamId + "|" + label : null;
    if (on) visited[k] = true;
    else {
      delete visited[k];
      if (legacy) delete visited[legacy];
    }
    saveVisited();
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
        ov.style.display = "flex";
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
      m.on("click", () => show(currentId, currentMode, i, false, true));
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
    document.getElementById("editV1").href = "../?lopp=" + encodeURIComponent(ev ? ev.id : "") + hashFor(currentId, currentMode, selected);
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
    if (!e.target.closest("#more") && !e.target.closest("#moreBtn")) {
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
    document.getElementById("imgOverlay").style.display = "none";
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

  async function start() {
    const params = new URLSearchParams(location.search);
    const lopp = params.get("lopp");
    store = M.loadStore();
    if (!store) {
      const events = (M.getAllBuiltInIds() || []).map((id) => M.seedEvent(id)).filter(Boolean);
      store = { currentEventId: M.defaultEventId(), events };
    }
    ensureSeed();
    if (lopp && store.events.some((e) => e.id === lopp)) store.currentEventId = lopp;

    const focusEv = currentEvent();
    if (focusEv) {
      const need = (focusEv.teams || []).filter((t) => M.needsRouteRebuild(t));
      if (need.length) {
        setBusy(true, "Laddar körvägar…");
        try {
          for (const t of need) await M.recalcTeam(t);
        } catch (e) {}
        setBusy(false);
      }
    }

    if (lopp && store.events.some((e) => e.id === lopp)) {
      document.body.classList.add("in-race");
      closeChooser();
      const startH = parseHash();
      show(startH.id, startH.mode, startH.idx, true, false);
      return;
    }
    if (isViewOnly()) {
      const bid = lopp && M.isBuiltIn(lopp) ? lopp : M.defaultEventId();
      enterEvent(bid);
      return;
    }
    openChooser();
  }
  start();
})();
