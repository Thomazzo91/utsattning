(function () {
  const PUBLIC_BASE = "https://thomazzo91.github.io/utsattning/";
  const M = window.Mattor;
  const groupBar = document.getElementById("groups");
  const sidebar = document.getElementById("sidebar");
  const nowEl = document.getElementById("now");
  const modeBar = document.getElementById("modes");
  const gmapsLink = document.getElementById("gmaps");
  const toast = document.getElementById("toast");
  const more = document.getElementById("more");
  const editorEl = document.getElementById("editor");
  const editorBody = document.getElementById("editorBody");
  const pickBanner = document.getElementById("pickBanner");
  const busyEl = document.getElementById("busy");
  const busyText = document.getElementById("busyText");
  const chooserEl = document.getElementById("chooser");
  const chooserList = document.getElementById("chooserList");
  const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';
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
  let pickingIndex = -1;
  let editTeamId = "";
  let ignoreHash = false;
  let ptFormIndex = -1;

  let visited = {};
  let applyingLive = false;
  try {
    visited = JSON.parse(localStorage.getItem(VISITED_KEY) || "{}") || {};
    if (typeof visited !== "object" || visited === null) visited = {};
  } catch (e) { visited = {}; }
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_VISIT_KEY) || "{}") || {};
    let migrated = 0;
    Object.keys(legacy).forEach((k) => {
      if (legacy[k] && !visited["lopp1|" + k]) {
        visited["lopp1|" + k] = true;
        migrated++;
      }
    });
    if (migrated > 0) {
      try { localStorage.setItem(VISITED_KEY, JSON.stringify(visited)); } catch (e) {}
    }
    let migrated2 = 0;
    Object.keys(visited).forEach((k) => {
      if (k.startsWith("hbgm26|")) {
        const nk = k.replace("hbgm26|", "lopp1|");
        if (!visited[nk]) { visited[nk] = true; migrated2++; }
      }
    });
    if (migrated2 > 0) saveVisited();
  } catch (e) {}

  function currentEvent() {
    return (store && store.events && store.events.find((e) => e.id === store.currentEventId)) ||
      (store && store.events && store.events[0]);
  }
  function teams() { const ce = currentEvent(); return ce ? (ce.teams || []) : []; }
  function teamById(id) { const ts = teams(); return ts.find((t) => t.id === id) || ts[0]; }

  function setTitle(name) {
    const t = String(name || "").trim();
    document.title = t || "Välj lopp";
  }

  const GH_TOKEN_KEY = "utsattning-publish-token";
  let publishing = false;

  function fileSlug(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[åä]/g, "a")
      .replace(/ö/g, "o")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
  }

  function dataImagePayload(dataUrl) {
    const t = String(dataUrl || "");
    const i = t.indexOf("base64,");
    if (i < 0) return null;
    const b64 = t.slice(i + 7).replace(/\s/g, "");
    if (!b64) return null;
    const ext = /image\/png/i.test(t.slice(0, i)) ? "png" : "jpg";
    return { b64, ext };
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
    const seen = {};
    (store.events || []).forEach((ev) => {
      (ev.teams || []).forEach((t) => {
        M.pointsOf(t).forEach((s) => {
          if (!s || typeof s.image !== "string" || s.image.indexOf("data:image") !== 0) return;
          const payload = dataImagePayload(s.image);
          if (!payload) return;
          const path = "img/" + fileSlug(ev.id || "lopp") + "-" + fileSlug(t.id) + "-" + fileSlug(s.label || s.name || "punkt") + ".jpg";
          s.image = path;
          if (seen[path]) return;
          seen[path] = true;
          uploads.push({ path, b64: payload.b64, evId: ev.id, teamId: t.id, label: s.label || "" });
        });
      });
    });
    return uploads;
  }

  async function publishCatalog(retried) {
    if (isViewOnly()) return false;
    if (publishing && !retried) {
      showToast("Publicerar redan…");
      return false;
    }
    const P = window.MattorPublish;
    if (!P) {
      showToast("Kunde inte publicera: publiceringskoden saknas");
      return false;
    }
    const token = await ensurePublishToken();
    if (!token) {
      showToast("Sparat på den här datorn. Publicera för alla via Meny → Spara för alla");
      return false;
    }
    publishing = true;
    setBusy(true, "Sparar för alla…");
    let keepBusy = false;
    try {
      await P.checkToken(token);
      persist();
      const uploads = collectUploads();
      persist();
      busyText.textContent = uploads.length ? "Publicerar bilder och lopp…" : "Sparar lopp…";
      const localRaces = M.buildRacesObject(store.events);
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
      showToast("Sparat för alla på utsattning-länken");
      return true;
    } catch (e) {
      const msg = (e && e.message) || "";
      const status = e && e.status;
      const authish = status === 401 || status === 403 || (P.isAuthFail && P.isAuthFail(e));
      const netish = P.isNet && P.isNet(e);
      if (!retried && (authish || netish)) {
        try { localStorage.removeItem(GH_TOKEN_KEY); } catch (err) {}
        keepBusy = true;
        publishing = false;
        setBusy(false);
        showToast("Klistra in GitHub-nyckeln igen (samma som på datorn).");
        const again = await askPublishToken();
        if (again) return publishCatalog(true);
        showToast("Sparat på den här enheten. Publicera via Meny → Spara för alla");
        return false;
      }
      if (authish) {
        showToast("Nyckeln avvisades. Meny → Ny GitHub-nyckel.");
      } else if (P.isConflict && P.isConflict(e)) {
        showToast("GitHub var upptaget. Tryck Klar igen.");
      } else if (netish) {
        showToast("Nådde inte GitHub. Meny → Ny GitHub-nyckel, sen Klar igen.");
      } else {
        showToast("Kunde inte publicera: " + String(msg).slice(0, 120));
      }
      return false;
    } finally {
      publishing = false;
      if (!keepBusy) setBusy(false);
    }
  }

  function persist() {
    if (isViewOnly()) return;
    try {
      M.saveStore(store);
    } catch (e) {
      const msg = (e && (e.message || String(e))) || "";
      const quota = /quota|full|storage|storlek|exceeded/i.test(msg) || (e && e.name === "QuotaExceededError");
      showToast(
        quota
          ? ("Lagret är fullt. Ta bort bilder från punkter eller rensa bort gamla lopp: " + (msg || "").slice(0, 60))
          : ("Kunde inte spara: " + ((msg || "Ta bort loppet igen.").slice(0, 140)))
      );
      if (window.console && console.error) console.error("persist failed:", e, store);
    }
  }

  function flushPointForm() {
    if (ptFormIndex < 0) return;
    const box = editorBody.querySelector("#ptForm");
    if (!box || !box.querySelector("#pLabel")) return;
    readPointForm(ptFormIndex);
  }

  function isViewOnly() {
    const p = new URLSearchParams(location.search);
    if (!p.has("view")) return false;
    const v = p.get("view");
    return v === "" || v === "1" || v === "true";
  }

  function applyViewMode() {
    document.body.classList.toggle("view-only", isViewOnly());
  }

  function pathWithHash(hash) {
    return location.pathname + location.search + hash;
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
    return !!(visited[visitKey(teamId, label)] ||
      (evId === "lopp1" && visited[teamId + "|" + label]));
  }
  function saveVisited() {
    try { localStorage.setItem(VISITED_KEY, JSON.stringify(visited)); } catch (e) {}
  }
  function setDone(teamId, label, on) {
    const ev = currentEvent();
    const k = visitKey(teamId, label);
    const legacy = ev && ev.id === "lopp1" ? teamId + "|" + label : null;
    if (on) {
      visited[k] = true;
    } else {
      delete visited[k];
      if (legacy) delete visited[legacy];
    }
    saveVisited();
    if (!applyingLive && window.MattorLive && ev) {
      const t = teamById(teamId);
      window.MattorLive.report(ev.id, teamId, label, on, t ? t.name : "");
    }
  }

  function viewOf(id, mode) {
    const t = teamById(id);
    if (!t) { return { id: "", name: "", ansvarig: "", color: "", km: 0, min: 0, stops: [], legs: [], track: [], segs: [] }; }
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
  function packedFromUrl() {
    const q = new URLSearchParams(location.search).get("e");
    if (q) return String(q).replace(/\s+/g, "");
    const p0 = (location.hash || "").replace(/^#/, "").split("/")[0] || "";
    return p0.indexOf("e.") === 0 ? p0.slice(2) : "";
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
  function setHash(id, mode, idx, replace) {
    const hash = hashFor(id, mode, idx);
    ignoreHash = true;
    if (replace) history.replaceState(null, "", pathWithHash(hash));
    else if (location.hash !== hash) history.pushState(null, "", pathWithHash(hash));
    setTimeout(() => { ignoreHash = false; }, 0);
  }
  function shareUrl() {
    const base = PUBLIC_BASE.replace(/\/?$/, "/");
    const ev = currentEvent();
    const firstId = (ev && ev.teams && ev.teams[0] && ev.teams[0].id) || "";
    const hash = hashFor(currentId || firstId, currentMode, selected);
    if (ev && M.isBuiltIn(ev.id)) {
      const patch = M.builtInSharePatch(ev, ev.id);
      if (patch !== false) {
        let url = base + "?view=1&lopp=" + encodeURIComponent(ev.id);
        if (patch) url += "&p=" + M.toB64url(patch);
        return url + hash;
      }
    }
    try {
      if (ev) {
        const packed = M.encodeEvent(ev);
        const short = base + "?view=1&e=" + packed + hash;
        if (short.length <= 1800) return short;
        return base + "?view=1#e." + packed + "/" + hash.slice(1);
      }
    } catch (e) {}
    return base + "?view=1&lopp=" + encodeURIComponent(M.defaultEventId()) + hash;
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

  function dropRemovedFromStore() {
    if (!store || !store.events) return;
    store.events = store.events.filter((e) => !M.isRemoved(e.id));
    ensureSeed();
    if (!store.events.some((e) => e.id === store.currentEventId)) {
      store.currentEventId = (store.events[0] && store.events[0].id) || M.defaultEventId();
    }
  }

  function renderChooser() {
    chooserList.innerHTML = "";
    dropRemovedFromStore();
    store.events.forEach((ev) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chooser-item";
      const names = (ev.teams || []).map((t) => t.name).join(" · ");
      b.innerHTML = `<strong>${esc(ev.name)}</strong><span>${esc(names) || "Inga grupper"}</span>`;
      b.addEventListener("click", () => enterEvent(ev.id));
      chooserList.appendChild(b);
    });
    const cancel = document.getElementById("chooserCancel");
    cancel.style.display = document.body.classList.contains("in-race") ? "" : "none";
  }

  function openChooser() {
    if (isViewOnly()) return;
    more.style.display = "none";
    editorEl.classList.remove("open");
    document.body.classList.remove("editing");
    chooserEl.classList.add("open");
    document.body.classList.add("choosing");
    renderChooser();
    setTitle("Välj lopp");
  }

  function closeChooser() {
    chooserEl.classList.remove("open");
    document.body.classList.remove("choosing");
    if (document.body.classList.contains("in-race")) setTitle(currentEvent() ? currentEvent().name : "");
  }

  function enterEvent(id) {
    if (!store.events.some((e) => e.id === id)) return;
    store.currentEventId = id;
    persist();
    closeChooser();
    document.body.classList.add("in-race");
    const tid = (currentEvent() && currentEvent().teams[0] && currentEvent().teams[0].id) || "";
    const p = new URLSearchParams();
    p.set("lopp", id);
    ignoreHash = true;
    history.replaceState(null, "", location.pathname + "?" + p.toString() + hashFor(tid, "kortast", 0));
    setTimeout(() => { ignoreHash = false; }, 0);
    bootView();
    map.invalidateSize();
  }

  function googleDir(g) {
    if (!g.stops.length) return "#";
    return "https://www.google.com/maps/dir/" + g.stops.map((s) => s.lat.toFixed(6) + "," + s.lon.toFixed(6)).join("/");
  }
  function markerIcon(color, n, on, done) {
    return L.divIcon({
      className: "",
      iconSize: on ? [42, 42] : [34, 34],
      iconAnchor: on ? [21, 21] : [17, 17],
      html: `<div class="mk${on ? " is-on" : ""}${done ? " is-done" : ""}"><div class="mk-num" style="background:${color}">${done ? CHECK_SVG : n}</div></div>`
    });
  }
  function showToast(text) {
    toast.textContent = text;
    toast.style.display = "block";
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => { toast.style.display = "none"; }, 1800);
  }
  function setBusy(on, text) {
    busyText.textContent = text || "Beräknar körväg…";
    busyEl.classList.toggle("on", !!on);
  }
  function isDesktop() {
    return window.matchMedia("(min-width: 860px) and (hover: hover) and (pointer: fine)").matches;
  }
  function mapPad() {
    map.invalidateSize();
    const header = document.querySelector("header").getBoundingClientRect();
    const landscape = !isDesktop() && window.matchMedia("(orientation: landscape)").matches;
    if (isDesktop() || landscape) return { paddingTopLeft: [16, 16], paddingBottomRight: [16, 16] };
    return { paddingTopLeft: [18, Math.round(header.height) + 10], paddingBottomRight: [18, 18] };
  }

  function renderTeamBar() {
    groupBar.innerHTML = "";
    teams().forEach((t) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.id = t.id;
      b.textContent = t.name;
      b.addEventListener("click", () => show(t.id, currentMode, 0, false));
      groupBar.appendChild(b);
    });
  }

  function paintTeamBar() {
    [...groupBar.children].forEach((b) => {
      const on = b.dataset.id === currentId;
      b.setAttribute("aria-pressed", String(on));
      const t = teamById(b.dataset.id);
      b.style.background = on && t ? t.color : "";
      b.style.color = on ? "#0b1220" : "";
    });
  }

  function doneCount(g) {
    return g.stops.filter((s) => isDone(g.id, s.label)).length;
  }

  function renderNow(g) {
    const s = g.stops[selected];
    if (!s) {
      nowEl.innerHTML = "<p class=\"who\">Inga punkter här. Meny → Nytt lopp eller Redigera lopp.</p>";
      return;
    }
    const nav = "https://www.google.com/maps/dir/?api=1&destination=" + s.lat + "," + s.lon + "&travelmode=driving";
    nowEl.innerHTML = `
      <div class="now-top">
        <span class="num" style="background:${g.color}">${selected + 1}</span>
        <div style="flex:1;min-width:0">
          <h2>${esc(s.label || s.name || "")}</h2>
          <p>${esc(s.setup || "")} · Igång ${esc(s.iga || "—")}</p>
        </div>
        <a class="nav-btn" href="${nav}" target="_blank" rel="noopener">Navigera</a>
      </div>`;
  }

  function toggleDone(i) {
    const g = viewOf(currentId, currentMode);
    const s = g.stops[i];
    if (!s) return;
    setDone(g.id, s.label, !isDone(g.id, s.label));
    paintDone(g);
  }

  function paintDone(g) {
    const orderHint = currentMode === "iga" ? "i igång-ordning" : "kortaste körvägen";
    const prog = document.getElementById("progress");
    if (prog) {
      prog.textContent = (g.ansvarig ? g.ansvarig + " · " : "") + g.km + " km · " + g.min + " min · " +
        doneCount(g) + "/" + g.stops.length + " avbockade · " + orderHint;
    }
    sidebar.querySelectorAll(".stop").forEach((el) => {
      const i = Number(el.dataset.i);
      const s = g.stops[i];
      const done = !!(s && isDone(g.id, s.label));
      el.classList.toggle("is-done", done);
      const btn = el.querySelector(".been");
      if (btn) btn.setAttribute("aria-pressed", String(done));
    });
    markers.forEach((m, n) => {
      const s = g.stops[n];
      m.setIcon(markerIcon(g.color, n + 1, n === selected, !!(s && isDone(g.id, s.label))));
    });
  }

  function openImageOverlay(src) {
    const overlay = document.getElementById("imgOverlay");
    const img = document.getElementById("imgOverlayImg");
    if (!overlay || !img) return;
    img.src = src;
    overlay.style.display = "flex";
    overlay.setAttribute("aria-hidden", "false");
  }
  function closeImageOverlay() {
    const overlay = document.getElementById("imgOverlay");
    const img = document.getElementById("imgOverlayImg");
    if (!overlay) return;
    overlay.style.display = "none";
    overlay.setAttribute("aria-hidden", "true");
    if (img) img.src = "";
  }

  function show(id, mode, idx, fromHash) {
    if (!teams().length) return;
    const g = viewOf(id, mode);
    currentId = g.id || ((teams()[0] && teams()[0].id) || "");
    currentMode = mode;
    selected = g.stops.length ? Math.max(0, Math.min(idx, g.stops.length - 1)) : 0;
    if (!fromHash && currentId) setHash(currentId, currentMode, selected, false);
    document.documentElement.style.setProperty("--accent", g.color || "#3b82f6");
    if (currentEvent()) setTitle(currentEvent().name);
    paintTeamBar();
    modeBar.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === currentMode)));
    gmapsLink.href = googleDir(g);

    layer.clearLayers();
    markers = [];
    routeLines = [];
    const usableSegs = (g.segs || []).filter((s) => s && s.geom && s.geom.length >= 2);
    const trackPts = (g.track && g.track.length) || 0;
    if (usableSegs.length) {
      usableSegs.forEach((s) => {
        if (!s || !s.geom || !s.geom.length) return;
        const latlngs = s.geom.map(([lon, lat]) => [lat, lon]);
        let opts;
        if (s.profile === "foot") {
          opts = { color: "#0b1220", weight: 7, opacity: 0.92, dashArray: "16 8" };
        } else if (s.profile === "bike") {
          opts = { color: "#0b1220", weight: 6, opacity: 0.9, dashArray: "14 8" };
        } else if (s.profile === "crow") {
          opts = { color: "#111827", weight: 3, opacity: 0.85, dashArray: "2 8", lineJoin: "round", lineCap: "round" };
        } else {
          opts = { color: g.color, weight: 6, opacity: 0.92 };
        }
        routeLines.push(L.polyline(latlngs, opts).addTo(layer));
      });
    } else if (trackPts >= 2) {
      const latlngs = g.track.map(([lon, lat]) => [lat, lon]);
      routeLines.push(L.polyline(latlngs, { color: g.color, weight: 6, opacity: 0.92 }).addTo(layer));
    } else {
      const fallback = (g.stops || []).filter((s) =>
        Number.isFinite(s.lat) && Number.isFinite(s.lon) && !(Math.abs(s.lat) < 1e-5 && Math.abs(s.lon) < 1e-5)
      ).map((s) => [s.lat, s.lon]);
      if (fallback.length >= 2) {
        routeLines.push(L.polyline(fallback, { color: g.color, weight: 5, opacity: 0.75 }).addTo(layer));
      }
    }
    g.stops.forEach((s, i) => {
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) return;
      if (Math.abs(s.lat) < 1e-5 && Math.abs(s.lon) < 1e-5) return;
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
        selectStop(i, true);
      });
      m.addTo(layer);
      markers.push(m);
    });
    function routeBounds() {
      if (!routeLines.length) return null;
      let b = routeLines[0].getBounds();
      for (let i = 1; i < routeLines.length; i++) b.extend(routeLines[i].getBounds());
      return b;
    }
    function layoutRoutes() {
      map.invalidateSize();
      routeLines.forEach((l) => { try { l.redraw(); } catch (e) {} });
      const rb = routeBounds();
      if (rb) map.fitBounds(rb, mapPad());
      else {
        const geo = (g.stops || []).filter((s) =>
          Number.isFinite(s.lat) && Number.isFinite(s.lon) && !(Math.abs(s.lat) < 1e-5 && Math.abs(s.lon) < 1e-5)
        );
        if (geo.length) map.fitBounds(L.latLngBounds(geo.map((s) => [s.lat, s.lon])), mapPad());
        else map.setView([62.5, 17], 5);
      }
    }
    layoutRoutes();
    requestAnimationFrame(() => {
      map.invalidateSize();
      routeLines.forEach((l) => { try { l.redraw(); } catch (e) {} });
    });
    renderNow(g);
    const orderHint = currentMode === "iga" ? "i igång-ordning" : "kortaste körvägen";
    if (!g.stops.length) {
      sidebar.innerHTML = "<p class=\"who\">Inga timingpunkter ännu. Meny → Redigera lopp.</p>";
      return;
    }
    sidebar.innerHTML = `
      <p class="who" id="progress">${g.ansvarig ? g.ansvarig + " · " : ""}${g.km} km · ${g.min} min · ${doneCount(g)}/${g.stops.length} avbockade · ${orderHint}</p>
      ${g.stops.map((s, i) => {
        const warn = /kod|fredriksdal|kolla bilden/i.test(s.placering || "");
        const done = isDone(g.id, s.label);
        const imgHtml = (s && s.image) ? `<img class="pt-img" data-src="${esc(s.image)}" src="${esc(imgSrc(s.image))}" alt="${esc(s.label || "")} bild" />` : "";
        return `<article class="stop${done ? " is-done" : ""}" data-i="${i}">
          <div class="stop-head">
            <h3><span class="num" style="background:${g.color}">${i + 1}</span>${esc(s.label || s.name || "Punkt")}</h3>
            <button type="button" class="been" data-i="${i}" aria-pressed="${done}" aria-label="Bocka av">${CHECK_SVG}</button>
          </div>
          <div class="note">${esc(s.setup || "")}</div>
          <div class="times"><span>Igång <strong>${esc(s.iga || "—")}</strong></span><span>Första <strong>${esc(s.forsta || "—")}</strong></span><span>Sista <strong>${esc(s.sista || "—")}</strong></span></div>
          ${s.placering ? `<div class="note${warn ? " warn" : ""}">${esc(s.placering)}</div>` : ""}
          ${imgHtml}
        </article>${g.legs[i] ? `<div class="leg">${g.legs[i].km} km · ${g.legs[i].min} min till nästa</div>` : ""}`;
      }).join("")}`;
    sidebar.querySelectorAll(".stop").forEach((el) => {
      el.addEventListener("click", () => selectStop(Number(el.dataset.i), true));
    });
    sidebar.querySelectorAll(".been").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        toggleDone(Number(btn.dataset.i));
      });
    });
    sidebar.querySelectorAll("img.pt-img").forEach((imgEl) => {
      imgEl.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const src = imgEl.getAttribute("data-src") || imgEl.src;
        if (src) openImageOverlay(imgSrc(src));
      });
    });
    paintSelection(fromHash && /\/[1-9]\d*$/.test(location.hash));
    setTimeout(() => {
      if (routeLines.length) {
        let b = routeLines[0].getBounds();
        for (let i = 1; i < routeLines.length; i++) b.extend(routeLines[i].getBounds());
        map.fitBounds(b, mapPad());
      }
      else map.invalidateSize();
    }, 250);
  }

  function selectStop(i, pan) {
    const g = viewOf(currentId, currentMode);
    if (!g.stops[i]) return;
    selected = i;
    setHash(currentId, currentMode, selected, true);
    markers.forEach((m, n) => {
      const s = g.stops[n];
      m.setIcon(markerIcon(g.color, n + 1, n === selected, !!(s && isDone(g.id, s.label))));
      m.setZIndexOffset(n === selected ? 800 : 0);
    });
    renderNow(g);
    paintSelection(pan);
  }

  function paintSelection(pan) {
    const g = viewOf(currentId, currentMode);
    sidebar.querySelectorAll(".stop").forEach((el) => {
      const on = Number(el.dataset.i) === selected;
      el.classList.toggle("is-on", on);
      if (on) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    if (pan && g.stops[selected]) {
      map.setView([g.stops[selected].lat, g.stops[selected].lon], Math.max(map.getZoom(), 16), { animate: true });
    }
  }

  function esc(t) {
    return String(t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  }
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
    const path = String(src).replace(/^\.\//, "");
    const v = imgCacheTag() || "1";
    return path + "?v=" + encodeURIComponent(v) + "&t=" + Date.now();
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
    if (curM && !seen.has(curM)) {
      mins.push(`<option value="${curM}" selected>${curM}</option>`);
    }
    return `<div class="time-pick">
      <select id="${id}H" aria-label="Timme">${hours.join("")}</select>
      <span>:</span>
      <select id="${id}M" aria-label="Minut">${mins.join("")}</select>
    </div>`;
  }

  function readTime(box, id) {
    const hEl = box.querySelector("#" + id + "H");
    if (!hEl) return "";
    const h = hEl.value;
    const min = (box.querySelector("#" + id + "M") || {}).value || "00";
    if (!h) return "";
    return h + ":" + min;
  }

  function isHintName(value) {
    const t = (value || "").trim();
    return !t || t === "Ny punkt";
  }

  function selectAllOnFocus(el) {
    if (!el) return;
    const select = () => {
      try {
        el.select();
        if (typeof el.setSelectionRange === "function") el.setSelectionRange(0, el.value.length);
      } catch (e) {}
    };
    el.addEventListener("focus", () => setTimeout(select, 0));
    el.addEventListener("click", select);
  }

  function renderEditor() {
    const ev = currentEvent();
    if (!ev) return;
    if (!editTeamId || !teamById(editTeamId)) editTeamId = (teams()[0] && teams()[0].id) || "";
    const team = teamById(editTeamId);
    const pts = team ? M.pointsOf(team) : [];
    const color = (team && team.color) || "#3b82f6";
    editorEl.style.setProperty("--edit-color", color);
    editorBody.innerHTML = `
      <label>Vilket lopp</label>
      <select id="evPick">${store.events.map((e) =>
        `<option value="${esc(e.id)}"${e.id === ev.id ? " selected" : ""}>${esc(e.name)}</option>`
      ).join("")}</select>
      <label>Namn på loppet</label>
      <input id="evName" value="${esc(ev.name)}" placeholder="Nytt lopp" />
      <div class="edit-actions">
        <button type="button" class="btn" id="newEvent">Nytt lopp</button>
        <button type="button" class="btn btn-danger" id="delEvent">Ta bort lopp</button>
      </div>
      <div class="edit-actions" id="teamChips"></div>
      <div class="edit-block">
      <div class="row">
        <div><label>Namn</label><input id="teamName" value="${esc(team ? team.name : "")}" placeholder="Grupp 1" /></div>
        <div><label>Färg</label><input id="teamColor" type="color" value="${team ? team.color : "#3b82f6"}" /></div>
      </div>
      <label>Ansvariga</label>
      <input id="teamPeople" value="${esc(team ? team.ansvarig : "")}" placeholder="Vilka som kör" />
      <div class="edit-actions">
        <button type="button" class="btn" id="addTeam">+ Grupp</button>
        <button type="button" class="btn btn-danger" id="delTeam">Ta bort grupp</button>
      </div>
      <label>Timingpunkter</label>
      <p class="who">Dra punkterna ⠿ för att byta ordning (t.ex. dra 20 km ovanför 12 km). Klicka för att redigera.</p>
      <div id="ptList"></div>
      <div class="edit-actions">
        <button type="button" class="btn" id="addPt">+ Punkt</button>
        <button type="button" class="btn btn-accent" id="recalc">Beräkna körvägar</button>
      </div>
      <div id="ptForm"></div>
      </div>
    `;
    const chips = editorBody.querySelector("#teamChips");
    teams().forEach((t) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn" + (t.id === editTeamId ? " chip-on" : "");
      b.textContent = t.name;
      if (t.id === editTeamId) {
        b.style.background = t.color;
        b.style.color = "#0b1220";
      }
      b.addEventListener("click", () => { saveEditorFields(); editTeamId = t.id; renderEditor(); });
      chips.appendChild(b);
    });
    const list = editorBody.querySelector("#ptList");
    let dragSrc = -1;
    pts.forEach((p, i) => {
      const card = document.createElement("div");
      card.className = "pt-card" + (p.image ? " has-img" : "");
      card.draggable = true;
      card.dataset.i = String(i);
      card.innerHTML = `<div class="pt-grip" draggable="false" title="Dra för att ändra ordning">⠿</div>
        <div class="pt-body">
          <strong>${i + 1}. ${esc(p.label) || "Namnlös"}</strong>
          <div class="who">${p.lat ? p.lat.toFixed(5) + ", " + p.lon.toFixed(5) : "Ingen GPS"} · Igång ${esc(p.iga) || "—"}${p.image ? ' 🖼️' : ''}</div>
        </div>
        <div class="pt-actions">
          <button type="button" class="icon-btn pt-up" title="Flytta upp" aria-label="Flytta upp"${i === 0 ? ' disabled' : ''}>▲</button>
          <button type="button" class="icon-btn pt-down" title="Flytta ner" aria-label="Flytta ner"${i === pts.length - 1 ? ' disabled' : ''}>▼</button>
        </div>`;
      card.addEventListener("click", (ev) => {
        if (ev.target.closest(".pt-grip") || ev.target.closest(".pt-actions")) return;
        renderPointForm(i);
      });
      const btnUp = card.querySelector(".pt-up");
      const btnDown = card.querySelector(".pt-down");
      const movePoint = (dir) => {
        if (dir === -1 && i === 0) return;
        if (dir === 1 && i === pts.length - 1) return;
        flushPointForm();
        const team = teamById(editTeamId);
        const list2 = M.pointsOf(team);
        const [moved] = list2.splice(i, 1);
        list2.splice(i + dir, 0, moved);
        list2.forEach((p, k) => { if (p && typeof p === "object") p.idx = k + 1; });
        team.orderLocked = true;
        writePoints(team, list2);
        renderEditor();
        showToast("Ordning uppdaterad — kör nu i denna följd. Tryck Beräkna körvägar för ny rutt");
      };
      if (btnUp) btnUp.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); movePoint(-1); });
      if (btnDown) btnDown.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); movePoint(1); });
      card.addEventListener("dragstart", (ev) => {
        dragSrc = i;
        card.classList.add("is-drag");
        try { ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", String(i)); } catch (e) {}
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("is-drag");
        list.querySelectorAll(".pt-card").forEach((c) => c.classList.remove("is-drop-before", "is-drop-after"));
      });
      card.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        const r = card.getBoundingClientRect();
        const before = (ev.clientY - r.top) < (r.height / 2);
        card.classList.toggle("is-drop-before", before);
        card.classList.toggle("is-drop-after", !before);
      });
      card.addEventListener("dragleave", () => {
        card.classList.remove("is-drop-before", "is-drop-after");
      });
      card.addEventListener("drop", (ev) => {
        ev.preventDefault();
        const r = card.getBoundingClientRect();
        const before = (ev.clientY - r.top) < (r.height / 2);
        const target = before ? i : (i + 1);
        list.querySelectorAll(".pt-card").forEach((c) => c.classList.remove("is-drop-before", "is-drop-after", "is-drag"));
        if (dragSrc < 0 || dragSrc === target || dragSrc + 1 === target) return;
        flushPointForm();
        const team = teamById(editTeamId);
        const src = dragSrc;
        let insertAt = target;
        if (src < insertAt) insertAt -= 1;
        const list2 = M.pointsOf(team);
        const [moved] = list2.splice(src, 1);
        list2.splice(insertAt, 0, moved);
        list2.forEach((p, k) => { if (p && typeof p === "object") p.idx = k + 1; });
        team.orderLocked = true;
        writePoints(team, list2);
        renderEditor();
        showToast("Ordning uppdaterad — kör nu i denna följd. Tryck Beräkna körvägar för ny rutt");
      });
      list.appendChild(card);
    });
    editorBody.querySelector("#evName").addEventListener("change", () => {
      saveEditorFields();
      renderEditor();
    });
    editorBody.querySelector("#evPick").addEventListener("change", (e) => {
      saveEditorFields();
      store.currentEventId = e.target.value;
      persist();
      editTeamId = "";
      bootView();
      renderEditor();
    });
    selectAllOnFocus(editorBody.querySelector("#evName"));
    selectAllOnFocus(editorBody.querySelector("#teamName"));
    editorBody.querySelector("#teamName").addEventListener("change", saveEditorFields);
    editorBody.querySelector("#teamColor").addEventListener("change", () => {
      saveEditorFields();
      renderEditor();
    });
    editorBody.querySelector("#teamPeople").addEventListener("change", saveEditorFields);
    editorBody.querySelector("#newEvent").addEventListener("click", newEvent);
    editorBody.querySelector("#delEvent").addEventListener("click", deleteEvent);
    editorBody.querySelector("#addTeam").addEventListener("click", addTeam);
    editorBody.querySelector("#delTeam").addEventListener("click", deleteTeam);
    editorBody.querySelector("#addPt").addEventListener("click", addPoint);
    editorBody.querySelector("#recalc").addEventListener("click", () => recalcCurrent(true));
  }

  function renderPointForm(i) {
    saveEditorFields();
    const team = teamById(editTeamId);
    const pts = M.pointsOf(team);
    const p = pts[i];
    if (!p) return;
    ptFormIndex = i;
    const box = editorBody.querySelector("#ptForm");
    const imgPreview = p.image ? `<img class="pt-img" id="pImgPreview" src="${esc(imgSrc(p.image))}" alt="Förhandsbild" />` : "";
    box.innerHTML = `
      <label>Namn</label><input id="pLabel" value="${esc(isHintName(p.label) ? "" : (p.label || ""))}" placeholder="Ny punkt" />
      <label>Igång</label>${timeSelectHtml("pIga", p.iga)}
      <label>Första</label>${timeSelectHtml("pForsta", p.forsta)}
      <label>Sista</label>${timeSelectHtml("pSista", p.sista)}
      <label>Vad ska sättas upp</label><input id="pSetup" value="${esc(p.setup)}" />
      <label>Placering / notering</label><textarea id="pNote">${esc(p.placering)}</textarea>
      <label>GPS eller kartlänk</label>
      <input id="pGps" value="${p.lat ? p.lat.toFixed(6) + ", " + p.lon.toFixed(6) : ""}" placeholder="lat, lon t.ex. 56.05, 12.68" />
      <label>Bild på placering (valfritt)</label>
      <div class="image-widget">
        ${imgPreview}
        <div class="edit-actions" style="flex-wrap:wrap;gap:8px">
          <input type="file" id="pImgFile" accept="image/*" style="display:none" />
          <button type="button" class="btn" id="pImgPick">Välj bild</button>
          ${p.image ? `<button type="button" class="btn btn-danger" id="pImgDel">Ta bort bild</button>` : ""}
          <span class="who" style="font-size:12px;opacity:.8;margin-left:8px;align-self:center">Komprimeras automatiskt (max 1600px, JPEG 82%)</span>
        </div>
      </div>
      <div class="edit-actions">
        <button type="button" class="btn btn-accent" id="pPick">Välj på karta</button>
        <button type="button" class="btn" id="pSave">Spara punkt</button>
        <button type="button" class="btn btn-danger" id="pDel">Ta bort punkt</button>
      </div>
    `;
    editorBody.querySelectorAll(".pt-card").forEach((c, n) => c.classList.toggle("is-edit", n === i));
    selectAllOnFocus(box.querySelector("#pLabel"));
    const autosave = () => readPointForm(i);
    box.querySelectorAll("input, textarea, select").forEach((el) => {
      if (el.id === "pImgFile") return;
      el.addEventListener("change", autosave);
    });
    box.querySelector("#pSave").addEventListener("click", () => savePoint(i));
    box.querySelector("#pDel").addEventListener("click", () => deletePoint(i));
    box.querySelector("#pPick").addEventListener("click", () => {
      readPointForm(i);
      startPick(i);
    });
    box.querySelector("#pGps").addEventListener("change", () => {
      const raw = box.querySelector("#pGps").value.trim();
      const parsed = M.parseLatLon(raw);
      if (parsed) {
        const t = teamById(editTeamId);
        const list = M.pointsOf(t);
        list[i].lat = parsed.lat;
        list[i].lon = parsed.lon;
        writePoints(t, list);
        box.querySelector("#pGps").value = parsed.lat.toFixed(6) + ", " + parsed.lon.toFixed(6);
      } else if (raw) {
        showToast("Kunde inte läsa GPS. Skriv latitud, longitud, t.ex. 56.05, 12.68");
      }
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
          const t = teamById(editTeamId);
          const list = M.pointsOf(t);
          if (list[i]) list[i].image = dataUrl;
          writePoints(t, list);
          renderEditor();
          renderPointForm(i);
          showToast("Bild vald. Tryck Klar så alla enheter ser den");
        } catch (e) {
          showToast("Kunde inte läsa bilden");
        } finally {
          setBusy(false);
        }
      });
    }
    const delImgBtn = box.querySelector("#pImgDel");
    if (delImgBtn) {
      delImgBtn.addEventListener("click", () => {
        const t = teamById(editTeamId);
        const list = M.pointsOf(t);
        if (list[i]) list[i].image = "";
        writePoints(t, list);
        renderEditor();
        renderPointForm(i);
        showToast("Bild borttagen");
      });
    }
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
    renderTeamBar();
    paintTeamBar();
    setTitle(ev.name);
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
    renderEditor();
  }

  function addTeam() {
    saveEditorFields();
    const ev = currentEvent();
    if (!ev) return;
    const t = {
      id: M.uid("grupp"),
      name: "Grupp " + (ev.teams.length + 1),
      ansvarig: "",
      color: M.COLORS[ev.teams.length % M.COLORS.length],
      modes: M.emptyModes()
    };
    ev.teams.push(t);
    editTeamId = t.id;
    store.customized = true;
    persist();
    renderTeamBar();
    renderEditor();
  }

  function deleteTeam() {
    const ev = currentEvent();
    if (!ev) return;
    if (ev.teams.length < 2) { showToast("Minst en grupp behövs"); return; }
    if (!confirm("Ta bort " + teamById(editTeamId).name + "?")) return;
    ev.teams = ev.teams.filter((t) => t.id !== editTeamId);
    editTeamId = ev.teams[0].id;
    store.customized = true;
    persist();
    currentId = editTeamId;
    renderTeamBar();
    renderEditor();
    show(currentId, currentMode, 0, false);
  }

  function newEvent() {
    if (isViewOnly()) return;
    saveEditorFields();
    const ev = {
      id: M.uid("lopp"),
      name: "Nytt lopp",
      teams: [{
        id: M.uid("grupp"),
        name: "Grupp 1",
        ansvarig: "",
        color: M.COLORS[0],
        modes: M.emptyModes()
      }]
    };
    store.events.push(ev);
    store.currentEventId = ev.id;
    store.customized = true;
    M.forgetRemoved(ev.id);
    persist();
    enterEvent(ev.id);
    openEditor();
  }

  function resetBuiltInStore(preferredId) {
    const bid = preferredId || M.defaultEventId();
    const seed = M.seedEvent(bid);
    const events = [];
    (M.getAllBuiltInIds() || []).forEach((id) => {
      if (id === bid && seed) events.push(seed);
      else {
        const s = M.seedEvent(id);
        if (s) events.push(s);
      }
    });
    store = { currentEventId: bid, customized: false, events: events.length ? events : (seed ? [seed] : []) };
  }

  function deleteEventById(id) {
    if (isViewOnly()) return;
    const ev = store.events.find((e) => e.id === id);
    if (!ev) return;
    if (M.isCoreRace(id)) {
      if (store.events.length > (M.getAllBuiltInIds() || []).length) {
        showToast(M.builtInDisplayName(id) + " kan inte tas bort");
        return;
      }
      if (!confirm("Rensa " + (ev.name || M.builtInDisplayName(id)) + " och återställ originalet?")) return;
      resetBuiltInStore(id);
    } else if (store.events.length < 2) {
      if (!confirm("Rensa det här loppet och återställ standardlopp?")) return;
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
    pickingIndex = -1;
    pickBanner.classList.remove("on");
    editorEl.classList.remove("open");
    document.body.classList.remove("editing", "in-race");
    ignoreHash = true;
    history.replaceState(null, "", location.pathname);
    setTimeout(() => { ignoreHash = false; }, 0);
    openChooser();
    showToast("Lopp borttaget");
    publishCatalog();
  }

  function deleteEvent() {
    deleteEventById(store.currentEventId);
  }

  function startPick(i) {
    pickingIndex = i;
    pickBanner.classList.add("on");
    showToast("Tryck på kartan");
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
      await M.recalcTeam(team, (msg) => { busyText.textContent = msg; });
      store.customized = true;
      persist();
      if (fromBtn) showToast("Körvägar uppdaterade");
      show(team.id, currentMode, 0, false);
      if (editorEl.classList.contains("open")) renderEditor();
    } catch (err) {
      showToast("Kunde inte räkna körväg. Kolla nätet.");
    }
    setBusy(false);
  }

  function openEditor() {
    if (isViewOnly()) return;
    more.style.display = "none";
    editTeamId = currentId;
    document.body.classList.add("editing");
    editorEl.classList.add("open");
    renderEditor();
    map.invalidateSize();
  }

  async function closeEditor() {
    saveEditorFields();
    pickingIndex = -1;
    pickBanner.classList.remove("on");
    editorEl.classList.remove("open");
    document.body.classList.remove("editing");
    for (const t of teams()) {
      const pts = M.pointsOf(t).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
      const routed = t.modes && t.modes.kortast && t.modes.kortast.track && t.modes.kortast.track.length;
      if (pts.length && !routed) {
        setBusy(true, "Beräknar körväg för " + t.name + "…");
        try {
          await M.recalcTeam(t, (msg) => { busyText.textContent = msg; });
        } catch (err) {
          showToast("Kunde inte räkna körväg för " + t.name);
        }
      }
    }
    persist();
    setBusy(false);
    renderTeamBar();
    show(currentId, currentMode, selected, true);
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

  function bootView() {
    closeChooser();
    renderTeamBar();
    const start = parseHash();
    const known = teams().some((t) => t.id === start.id);
    if (!known) {
      const first = teams()[0];
      if (first) show(first.id, "kortast", 0, false);
    }
    else show(start.id, start.mode, start.idx, true);
  }

  async function applyImported(ev) {
    M.forgetRemoved(ev.id);
    const existing = store.events.findIndex((e) => e.id === ev.id);
    if (existing >= 0) store.events[existing] = ev;
    else store.events.push(ev);
    store.currentEventId = ev.id;
    store.customized = true;
    persist();
    setBusy(true, "Beräknar körvägar…");
    try {
      for (const t of ev.teams) {
        busyText.textContent = "Beräknar " + t.name + "…";
        await M.recalcTeam(t);
      }
      persist();
    } catch (e) {}
    setBusy(false);
    enterEvent(ev.id);
  }

  modeBar.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      const next = b.dataset.mode;
      const prev = viewOf(currentId, currentMode);
      const label = prev.stops[selected] && prev.stops[selected].label;
      const nxt = viewOf(currentId, next);
      const idx = Math.max(0, nxt.stops.findIndex((s) => s.label === label));
      show(currentId, next, idx, false);
    });
  });

  document.getElementById("moreBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    more.style.display = more.style.display === "block" ? "none" : "block";
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#more") && !e.target.closest("#moreBtn")) more.style.display = "none";
  });
  document.getElementById("clearDone").addEventListener("click", () => {
    more.style.display = "none";
    const g = viewOf(currentId, currentMode);
    if (!confirm("Rensa avbockning för " + g.name + "?")) return;
    g.stops.forEach((s) => setDone(g.id, s.label, false));
    paintDone(g);
    showToast("Avbockning rensad");
  });
  document.getElementById("gpxBtn").addEventListener("click", () => {
    more.style.display = "none";
    const t = teamById(currentId);
    if (!t) return;
    const xml = M.gpxFor(t, currentMode);
    download((t.name || "grupp") + ".gpx", xml, "application/gpx+xml");
  });
  document.getElementById("editBtn").addEventListener("click", openEditor);
  document.getElementById("switchEventBtn").addEventListener("click", () => {
    more.style.display = "none";
    openChooser();
  });
  document.getElementById("chooserNew").addEventListener("click", newEvent);
  document.getElementById("chooserCancel").addEventListener("click", () => {
    if (document.body.classList.contains("in-race")) closeChooser();
  });
  document.getElementById("newEventBtn").addEventListener("click", () => {
    more.style.display = "none";
    newEvent();
  });
  document.getElementById("editorDone").addEventListener("click", closeEditor);
  document.getElementById("publishBtn").addEventListener("click", async () => {
    more.style.display = "none";
    await publishCatalog();
  });
  const tokenBtn = document.getElementById("tokenBtn");
  if (tokenBtn) tokenBtn.addEventListener("click", async () => {
    more.style.display = "none";
    const t = await askPublishToken();
    showToast(t ? "Nyckel sparad på den här enheten" : "Ingen nyckel sparad");
  });
  document.getElementById("exportBtn").addEventListener("click", () => {
    if (isViewOnly()) return;
    more.style.display = "none";
    const ev = currentEvent();
    if (!ev) return;
    download((ev.name || "lopp").replace(/\s+/g, "-") + ".json", JSON.stringify(M.compactEvent(ev), null, 2));
    showToast("Fil sparad");
  });
  document.getElementById("importBtn").addEventListener("click", () => {
    if (isViewOnly()) return;
    more.style.display = "none";
    document.getElementById("importFile").click();
  });
  document.getElementById("importFile").addEventListener("change", async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!file) return;
    try {
      const compact = JSON.parse(await file.text());
      await applyImported(M.inflateEvent(compact));
      showToast("Lopp öppnat");
    } catch (e) {
      showToast("Kunde inte läsa filen");
    }
  });

  document.getElementById("share").addEventListener("click", async (ev) => {
    ev.preventDefault();
    const url = shareUrl();
    try {
      await navigator.clipboard.writeText(url);
      showToast("Visningslänk kopierad till github.io");
    } catch {
      prompt("Kopiera länken", url);
    }
  });

  function bindImageOverlayHandlers() {
    const overlay = document.getElementById("imgOverlay");
    if (overlay) {
      overlay.addEventListener("click", (ev) => {
        if (ev.target.id === "imgOverlay" || ev.target.id === "imgOverlayImg") closeImageOverlay();
      });
    }
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeImageOverlay();
    });
  }

  window.addEventListener("storage", (e) => {
    if (e.key !== "mattor-app-v1" && e.key !== "mattor-removed-v1" && e.key !== VISITED_KEY && e.key !== LEGACY_VISIT_KEY) return;
    if (e.key === VISITED_KEY || e.key === LEGACY_VISIT_KEY) {
      try { visited = JSON.parse(localStorage.getItem(VISITED_KEY) || "{}") || {}; } catch (e) { visited = {}; }
      const g = viewOf(currentId, currentMode);
      if (g && g.id) paintDone(g);
      return;
    }
    const next = M.loadStore();
    if (!next) return;
    store = next;
    ensureSeed();
    dropRemovedFromStore();
    if (chooserEl.classList.contains("open")) renderChooser();
  });
  window.addEventListener("hashchange", () => {
    if (ignoreHash) return;
    const { id, mode, idx } = parseHash();
    if ((id || "") !== (currentId || "") || mode !== currentMode) show(id, mode, idx, true);
    else selectStop(idx, true);
  });
  window.addEventListener("resize", () => {
    map.invalidateSize();
    if (routeLines.length) {
      let b = routeLines[0].getBounds();
      for (let i = 1; i < routeLines.length; i++) b.extend(routeLines[i].getBounds());
      map.fitBounds(b, mapPad());
    }
  });
  try {
    new ResizeObserver(() => {
      map.invalidateSize();
      routeLines.forEach((l) => { try { l.redraw(); } catch (e) {} });
    }).observe(document.getElementById("map"));
  } catch (e) {}

  async function start() {
    bindImageOverlayHandlers();
    applyViewMode();
    const params = new URLSearchParams(location.search);
    const packed = packedFromUrl();
    const lopp = params.get("lopp");
    store = M.loadStore();
    if (!store) {
      resetBuiltInStore();
    }
    ensureSeed();
    dropRemovedFromStore();
    if (window.MattorLive) {
      window.MattorLive.on(() => {
        applyingLive = true;
        try {
          const g = viewOf(currentId, currentMode);
          if (g && g.id) paintDone(g);
        } finally { applyingLive = false; }
      });
    }
    if (lopp && store.events.some((e) => e.id === lopp)) {
      store.currentEventId = lopp;
    }

    async function restoreRoutes() {
      const focusId = lopp || (store && store.currentEventId);
      const focusEv = (store.events || []).find((e) => e.id === focusId) || currentEvent();
      const hashTeam = (location.hash || "").replace(/^#/, "").split("/")[0];
      const priorityId = (focusEv && (focusEv.teams || []).some((t) => t.id === hashTeam)) ? hashTeam : "";
      const need = [];
      for (const ev of store.events) {
        if (focusId && ev.id !== focusId) continue;
        for (const t of ev.teams || []) {
          if (M.needsRouteRebuild(t)) need.push(t);
        }
      }
      if (!need.length) return false;
      const first = priorityId ? need.filter((t) => t.id === priorityId) : [];
      const rest = first.length ? need.filter((t) => t.id !== priorityId) : need.slice();
      async function run(list) {
        for (const t of list) {
          busyText.textContent = "Beräknar " + t.name + "…";
          await M.recalcTeam(t);
        }
      }
      function refreshIfVisible() {
        if (!document.body.classList.contains("in-race")) return;
        const on = parseHash();
        show(on.id || currentId, on.mode || currentMode, on.idx || 0, true);
      }
      setBusy(true, "Laddar körvägar…");
      try {
        if (first.length) {
          await run(first);
          persist();
          setBusy(false);
          refreshIfVisible();
          if (rest.length) {
            (async () => {
              try {
                await run(rest);
                persist();
              } catch (e) {}
            })();
          }
          return true;
        }
        await run(rest);
        persist();
        refreshIfVisible();
      } catch (e) {
        if (window.console && console.error) console.error("restoreRoutes failed:", e);
      }
      setBusy(false);
      return true;
    }

    if (!isViewOnly()) {
      try { M.saveStore(store); } catch (e) {}
    }

    async function fixTwoPoint() {
      try {
        let fixed = false;
        for (const ev of store.events) {
          for (const t of ev.teams || []) {
            const pts = M.pointsOf(t).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
            const k = t.modes && t.modes.kortast;
            const g = t.modes && t.modes.iga;
            if (pts.length === 2 && k && g && Math.abs((k.km || 0) - (g.km || 0)) > 0.05) {
              await M.recalcTeam(t);
              fixed = true;
            }
          }
        }
        if (fixed) {
          persist();
          bootView();
        }
      } catch (e) {}
    }

    if (packed) {
      try {
        const ev = M.decodeEvent(packed);
        if (isViewOnly()) {
          store = { currentEventId: ev.id, customized: true, events: [ev] };
          document.body.classList.add("in-race");
          setBusy(true, "Laddar körvägar…");
          try {
            for (const t of ev.teams) {
              busyText.textContent = "Beräknar " + t.name + "…";
              await M.recalcTeam(t);
            }
          } catch (e) {}
          setBusy(false);
          bootView();
          return;
        }
        await applyImported(ev);
        return;
      } catch (e) {}
    }

    if (isViewOnly()) {
      const bid = lopp && M.isBuiltIn(lopp) ? lopp : (lopp && store && store.events && store.events.some((e) => e.id === lopp) ? "" : "");
      let ev;
      if (bid && M.isBuiltIn(bid)) {
        ev = M.seedEvent(bid);
        const packedPatch = params.get("p");
        if (packedPatch) {
          try {
            M.applyBuiltInSharePatch(ev, M.fromB64url(packedPatch));
          } catch (e) {}
        }
        store = { currentEventId: bid, customized: !!packedPatch, events: [ev] };
      } else if (lopp && store && store.events && store.events.some((e) => e.id === lopp)) {
        ev = store.events.find((e) => e.id === lopp);
        store = { currentEventId: lopp, customized: true, events: [ev] };
      } else {
        const defaultBid = M.defaultEventId();
        ev = M.seedEvent(defaultBid);
        const packedPatch = params.get("p");
        if (packedPatch) {
          try { M.applyBuiltInSharePatch(ev, M.fromB64url(packedPatch)); } catch (e) {}
        }
        store = { currentEventId: defaultBid, customized: !!packedPatch, events: [ev] };
      }
      document.body.classList.add("in-race");
      await restoreRoutes();
      bootView();
      return;
    }

    if (lopp && store.events.some((e) => e.id === lopp)) {
      document.body.classList.add("in-race");
      await restoreRoutes();
      bootView();
      await fixTwoPoint();
      return;
    }

    openChooser();
  }
  start();
})();
