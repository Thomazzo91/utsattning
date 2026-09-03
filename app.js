/* Mattor — lopp, grupper, punkter och körvägar. Ingen server. */
(function (global) {
  const STORE = "mattor-app-v1";
  const REMOVED = "mattor-removed-v1";
  const SNAP_M = 18;
  const COLORS = ["#d97706", "#2563eb", "#059669", "#ef4444", "#a855f7", "#14b8a6", "#f97316", "#6366f1"];
  const OSRM = "https://router.project-osrm.org";

  function uid(prefix) {
    return prefix + "-" + Math.random().toString(36).slice(2, 8);
  }

  function clone(x) {
    return JSON.parse(JSON.stringify(x));
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const r = 6371000;
    const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
    const dp = (lat2 - lat1) * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * r * Math.asin(Math.sqrt(a));
  }

  function eventFromSeed(routes) {
    return clone({
      id: "hbgm26",
      name: "HBGM 26",
      teams: (routes.groups || []).map((g) => ({
        id: g.id,
        name: g.name,
        ansvarig: g.ansvarig || "",
        color: g.color,
        modes: g.modes
      }))
    });
  }

  function getRemovedIds() {
    try {
      const ids = JSON.parse(localStorage.getItem(REMOVED) || "[]");
      return Array.isArray(ids) ? ids.filter((id) => typeof id === "string" && id && id !== "hbgm26") : [];
    } catch (e) {
      return [];
    }
  }

  function rememberRemoved(id) {
    if (!id || id === "hbgm26") return;
    const ids = getRemovedIds();
    if (ids.indexOf(id) < 0) ids.push(id);
    try { localStorage.setItem(REMOVED, JSON.stringify(ids)); } catch (e) {}
  }

  function forgetRemoved(id) {
    if (!id) return;
    try { localStorage.setItem(REMOVED, JSON.stringify(getRemovedIds().filter((x) => x !== id))); } catch (e) {}
  }

  function isRemoved(id) {
    return !!(id && id !== "hbgm26" && getRemovedIds().indexOf(id) >= 0);
  }

  function seedEvent() {
    return eventFromSeed(global.HBGM_ROUTES);
  }

  function hydrateEvent(ev) {
    if (!ev || !ev.id) return null;
    if (isRemoved(ev.id)) return null;
    if (ev.id === "hbgm26" && global.HBGM_ROUTES) {
      if (!ev.teams) return seedEvent();
      return mergeHbgm(ev);
    }
    const t0 = ev.teams && ev.teams[0];
    if (t0 && Array.isArray(t0.points) && !t0.modes) return inflateEvent(ev);
    return ev;
  }

  function serializeStore(data) {
    const events = (data.events || []).filter((ev) => ev && ev.id && !isRemoved(ev.id)).map((ev) => {
      if (ev.id === "hbgm26" && global.HBGM_ROUTES) {
        try {
          if (JSON.stringify(compactEvent(ev)) === JSON.stringify(compactEvent(seedEvent()))) {
            return { id: "hbgm26" };
          }
        } catch (e) {}
      }
      return compactEvent(ev);
    });
    if (!events.some((e) => e.id === "hbgm26")) events.unshift({ id: "hbgm26" });
    const current = (data.currentEventId && !isRemoved(data.currentEventId)) ? data.currentEventId : "hbgm26";
    return { v: 2, currentEventId: current, events };
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.events) || !data.events.length) return null;
      const events = [];
      data.events.forEach((ev) => {
        const full = hydrateEvent(ev);
        if (full) events.push(full);
      });
      if (!events.some((e) => e.id === "hbgm26") && global.HBGM_ROUTES) events.unshift(seedEvent());
      if (!events.length) return null;
      const currentEventId = events.some((e) => e.id === data.currentEventId) ? data.currentEventId : events[0].id;
      return { currentEventId, customized: events.some((e) => e.id !== "hbgm26"), events };
    } catch (e) {
      return null;
    }
  }

  function saveStore(data) {
    const payload = serializeStore(data);
    localStorage.setItem(STORE, JSON.stringify(payload));
    const check = JSON.parse(localStorage.getItem(STORE) || "null");
    const savedIds = ((check && check.events) || []).map((e) => e.id);
    getRemovedIds().forEach((id) => {
      if (savedIds.indexOf(id) >= 0) throw new Error("removed-event-saved");
    });
  }

  function emptyModes() {
    return {
      kortast: { km: 0, min: 0, gpx: "", stops: [], legs: [], track: [] },
      iga: { km: 0, min: 0, gpx: "", stops: [], legs: [], track: [] }
    };
  }

  function pointsOf(team) {
    const src = (team.modes && team.modes.kortast && team.modes.kortast.stops) || [];
    return src.map((s) => ({
      label: s.label || "",
      lat: Number(s.lat),
      lon: Number(s.lon),
      iga: s.iga || "",
      forsta: s.forsta || "",
      sista: s.sista || "",
      maps: s.maps || "",
      placering: s.placering || "",
      setup: s.setup || ""
    }));
  }

  async function osrmJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("OSRM " + res.status);
    return res.json();
  }

  async function osrmRoute(profile, a, b) {
    const url = OSRM + "/route/v1/" + profile + "/" +
      a.lon.toFixed(6) + "," + a.lat.toFixed(6) + ";" +
      b.lon.toFixed(6) + "," + b.lat.toFixed(6) +
      "?overview=full&geometries=geojson";
    const data = await osrmJson(url);
    if (data.code !== "Ok" || !data.routes || !data.routes[0]) return null;
    const r = data.routes[0];
    return { geom: r.geometry.coordinates, dist: r.distance, dur: r.duration };
  }

  function gap(geom, lat, lon) {
    const last = geom[geom.length - 1];
    return haversine(last[1], last[0], lat, lon);
  }

  async function reach(a, b) {
    let got = await osrmRoute("driving", a, b);
    let geom = got ? got.geom.slice() : [[a.lon, a.lat]];
    let dist = got ? got.dist : 0;
    let dur = got ? got.dur : 0;
    if (gap(geom, b.lat, b.lon) <= SNAP_M) {
      geom.push([b.lon, b.lat]);
      return { geom, dist, dur };
    }
    let last = geom[geom.length - 1];
    for (const profile of ["bike", "foot"]) {
      const extra = await osrmRoute(profile, { lat: last[1], lon: last[0] }, b);
      if (!extra) continue;
      geom = geom.concat(extra.geom.slice(1));
      dist += extra.dist;
      dur += extra.dur;
      last = geom[geom.length - 1];
      if (gap(geom, b.lat, b.lon) <= SNAP_M) {
        geom.push([b.lon, b.lat]);
        return { geom, dist, dur };
      }
    }
    geom.push([b.lon, b.lat]);
    dist += gap(geom.slice(0, -1), b.lat, b.lon);
    return { geom, dist, dur };
  }

  async function osrmTable(stops) {
    const n = stops.length;
    const matrix = Array.from({ length: n }, () => Array(n).fill(0));
    if (n < 2) return matrix;
    const coords = stops.map((s) => s.lon.toFixed(6) + "," + s.lat.toFixed(6)).join(";");
    const data = await osrmJson(OSRM + "/table/v1/driving/" + coords + "?annotations=duration");
    const durs = data.durations;
    if (!durs) throw new Error("Ingen matris");
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) matrix[i][j] = durs[i][j] == null ? 1e12 : durs[i][j];
    }
    return matrix;
  }

  function permutations(arr) {
    if (arr.length <= 1) return [arr.slice()];
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const rest = arr.slice(0, i).concat(arr.slice(i + 1));
      for (const p of permutations(rest)) out.push([arr[i]].concat(p));
    }
    return out;
  }

  function pathCost(order, matrix) {
    let c = 0;
    for (let i = 0; i < order.length - 1; i++) c += matrix[order[i]][order[i + 1]];
    return c;
  }

  function twoOpt(order, matrix) {
    let best = order.slice();
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < best.length - 1; i++) {
        for (let k = i + 1; k < best.length; k++) {
          const next = best.slice(0, i).concat(best.slice(i, k + 1).reverse(), best.slice(k + 1));
          if (pathCost(next, matrix) + 0.01 < pathCost(best, matrix)) {
            best = next;
            improved = true;
          }
        }
      }
    }
    return best;
  }

  function shortestOrder(n, matrix) {
    const idx = Array.from({ length: n }, (_, i) => i);
    if (n <= 8) {
      let best = idx, bestC = Infinity;
      for (const perm of permutations(idx)) {
        const c = pathCost(perm, matrix);
        if (c < bestC) { bestC = c; best = perm; }
      }
      return best;
    }
    let best = idx, bestC = Infinity;
    for (let start = 0; start < n; start++) {
      const used = new Set([start]);
      const order = [start];
      while (order.length < n) {
        const last = order[order.length - 1];
        let pick = -1, pickC = Infinity;
        for (let j = 0; j < n; j++) {
          if (!used.has(j) && matrix[last][j] < pickC) { pickC = matrix[last][j]; pick = j; }
        }
        used.add(pick);
        order.push(pick);
      }
      const opt = twoOpt(order, matrix);
      const c = pathCost(opt, matrix);
      if (c < bestC) { bestC = c; best = opt; }
    }
    return best;
  }

  async function buildPath(stops) {
    if (!stops.length) return { track: [], legs: [], km: 0, min: 0 };
    if (stops.length === 1) {
      return { track: [[stops[0].lon, stops[0].lat]], legs: [], km: 0, min: 0 };
    }
    let track = [[stops[0].lon, stops[0].lat]];
    const legs = [];
    let totalM = 0, totalS = 0;
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i], b = stops[i + 1];
      const r = await reach(a, b);
      if (track.length && r.geom.length && track[track.length - 1][0] === r.geom[0][0] && track[track.length - 1][1] === r.geom[0][1]) {
        track = track.concat(r.geom.slice(1));
      } else {
        track = track.concat(r.geom);
      }
      legs.push({
        from: a.label, to: b.label,
        km: Math.round(r.dist / 10) / 100,
        min: Math.round(r.dur / 6) / 10
      });
      totalM += r.dist;
      totalS += r.dur;
    }
    return {
      track,
      legs,
      km: Math.round(totalM / 10) / 100,
      min: Math.round(totalS / 6) / 10
    };
  }

  function igaSort(stops) {
    return stops.slice().sort((a, b) => String(a.iga || "").localeCompare(String(b.iga || "")));
  }

  function samePt(a, b) {
    return a && b &&
      Math.abs(Number(a.lat) - Number(b.lat)) < 1e-5 &&
      Math.abs(Number(a.lon) - Number(b.lon)) < 1e-5;
  }

  function sameOrder(a, b) {
    return a.length === b.length && a.every((p, i) => samePt(p, b[i]));
  }

  function reverseBuilt(built, stops) {
    return {
      km: built.km,
      min: built.min,
      track: (built.track || []).slice().reverse(),
      legs: (built.legs || []).slice().reverse().map((l) => ({
        from: l.to, to: l.from, km: l.km, min: l.min
      })),
      stops
    };
  }

  function pathBetter(a, b) {
    if (a.min + 0.05 < b.min) return true;
    if (b.min + 0.05 < a.min) return false;
    return a.km <= b.km;
  }

  function packMode(built, stops) {
    return {
      km: built.km, min: built.min, gpx: "",
      stops, legs: built.legs || [], track: built.track || []
    };
  }

  async function recalcTeam(team, onProgress) {
    const pts = pointsOf(team).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    if (!pts.length) {
      team.modes = emptyModes();
      return team;
    }
    if (pts.length === 1) {
      const one = packMode({ km: 0, min: 0, legs: [], track: [[pts[0].lon, pts[0].lat]] }, pts);
      team.modes = { kortast: one, iga: packMode(one, igaSort(pts)) };
      return team;
    }
    if (pts.length === 2) {
      if (onProgress) onProgress("Beräknar körväg…");
      const ab = await buildPath([pts[0], pts[1]]);
      const ba = await buildPath([pts[1], pts[0]]);
      const useAb = pathBetter(ab, ba);
      const kortStops = useAb ? [pts[0], pts[1]] : [pts[1], pts[0]];
      const kort = useAb ? ab : ba;
      const igaStops = igaSort(pts);
      const iga = sameOrder(igaStops, kortStops) ? { ...kort, stops: igaStops } : reverseBuilt(kort, igaStops);
      team.modes = { kortast: packMode(kort, kortStops), iga: packMode(iga, iga.stops) };
      return team;
    }
    if (onProgress) onProgress("Beräknar kortaste körväg…");
    let order = pts.map((_, i) => i);
    try {
      const matrix = await osrmTable(pts);
      order = shortestOrder(pts.length, matrix);
    } catch (e) {
      order = pts.map((_, i) => i);
    }
    const kortStops = order.map((i) => pts[i]);
    const kort = await buildPath(kortStops);
    if (onProgress) onProgress("Beräknar igång-ordning…");
    const igaStops = igaSort(pts);
    const iga = sameOrder(igaStops, kortStops)
      ? { ...kort, stops: igaStops }
      : await buildPath(igaStops);
    team.modes = {
      kortast: packMode(kort, kortStops),
      iga: packMode(iga, iga.stops || igaStops)
    };
    return team;
  }

  function applyPoint(dest, src) {
    if (!dest || !src) return;
    if (src.label) dest.label = src.label;
    if (Number.isFinite(Number(src.lat))) dest.lat = Number(src.lat);
    if (Number.isFinite(Number(src.lon))) dest.lon = Number(src.lon);
    if (src.iga) dest.iga = src.iga;
    if (src.setup) dest.setup = src.setup;
    if (src.placering) dest.placering = src.placering;
    if (src.forsta) dest.forsta = src.forsta;
    if (src.sista) dest.sista = src.sista;
    if (src.maps) dest.maps = src.maps;
  }

  function syncIgaFromKortast(team) {
    if (!team.modes) team.modes = emptyModes();
    if (!team.modes.kortast) team.modes.kortast = emptyModes().kortast;
    if (!team.modes.iga) team.modes.iga = emptyModes().iga;
    const kort = team.modes.kortast.stops || [];
    const igaStops = igaSort(kort.map((s) => Object.assign({}, s)));
    const old = team.modes.iga.stops || [];
    const orderChanged = old.length !== igaStops.length ||
      old.some((s, i) => (s.label || "") !== (igaStops[i].label || ""));
    team.modes.iga.stops = igaStops;
    if (orderChanged) {
      team.modes.iga.track = [];
      team.modes.iga.legs = [];
      team.modes.iga.km = 0;
      team.modes.iga.min = 0;
    }
  }

  function mergeHbgm(saved) {
    const seed = seedEvent();
    if (saved.name) seed.name = saved.name;
    (saved.teams || []).forEach((st) => {
      let t = seed.teams.find((x) => x.id === st.id);
      const pts = Array.isArray(st.points) ? st.points : pointsOf(st);
      if (!t) {
        seed.teams.push(inflateEvent({ teams: [{ id: st.id, name: st.name, ansvarig: st.ansvarig, color: st.color, points: pts }] }).teams[0]);
        return;
      }
      if (st.name) t.name = st.name;
      if (st.ansvarig) t.ansvarig = st.ansvarig;
      if (st.color) t.color = st.color;
      if (!pts.length) return;
      const kort = t.modes.kortast.stops;
      const coordsChanged = pts.length !== kort.length || pts.some((p, i) => !samePt(p, kort[i]));
      pts.forEach((p, i) => {
        if (!kort[i]) kort[i] = Object.assign({}, p);
        else applyPoint(kort[i], p);
      });
      if (pts.length < kort.length) kort.length = pts.length;
      if (coordsChanged) {
        t.modes.kortast.track = [];
        t.modes.kortast.legs = [];
        t.modes.kortast.km = 0;
        t.modes.kortast.min = 0;
      }
      syncIgaFromKortast(t);
    });
    return seed;
  }

  function needsRouteRebuild(team) {
    const pts = pointsOf(team).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    if (pts.length < 2) return false;
    const k = team.modes && team.modes.kortast;
    const g = team.modes && team.modes.iga;
    if (!k || !(k.stops && k.stops.length) || !(k.track && k.track.length)) return true;
    if (!g || !(g.stops && g.stops.length) || !(g.track && g.track.length)) return true;
    return false;
  }

  function compactEvent(ev) {
    return {
      id: ev.id,
      name: ev.name,
      teams: ev.teams.map((t) => ({
        id: t.id,
        name: t.name,
        ansvarig: t.ansvarig || "",
        color: t.color,
        points: pointsOf(t)
      }))
    };
  }

  function inflateEvent(compact) {
    return {
      id: compact.id || uid("ev"),
      name: compact.name || "Nytt lopp",
      teams: (compact.teams || []).map((t) => {
        const pts = (t.points || (t.modes && t.modes.kortast && t.modes.kortast.stops) || []).map((p) => Object.assign({}, p));
        return {
          id: t.id || uid("grupp"),
          name: t.name || "Grupp",
          ansvarig: t.ansvarig || "",
          color: t.color || COLORS[0],
          modes: {
            kortast: {
              km: 0, min: 0, gpx: "",
              stops: pts,
              legs: [], track: []
            },
            iga: {
              km: 0, min: 0, gpx: "",
              stops: igaSort(pts.map((p) => Object.assign({}, p))),
              legs: [], track: []
            }
          }
        };
      })
    };
  }

  function toB64url(obj) {
    const json = typeof obj === "string" ? obj : JSON.stringify(obj);
    return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function fromB64url(s) {
    let raw = String(s || "").replace(/\s+/g, "");
    try { raw = decodeURIComponent(raw); } catch (e) {}
    const pad = raw.length % 4 === 0 ? "" : "=".repeat(4 - (raw.length % 4));
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/") + pad;
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
  }

  function shareFields(p) {
    return {
      label: p.label || "",
      lat: Number(p.lat),
      lon: Number(p.lon),
      iga: p.iga || "",
      setup: p.setup || "",
      placering: p.placering || ""
    };
  }

  function encodeEvent(ev) {
    return toB64url({
      id: ev.id,
      name: ev.name,
      teams: (ev.teams || []).map((t) => ({
        id: t.id,
        name: t.name,
        ansvarig: t.ansvarig || "",
        color: t.color,
        points: pointsOf(t).map((p) => {
          const o = { label: p.label || "", lat: p.lat, lon: p.lon };
          if (p.iga) o.iga = p.iga;
          if (p.setup) o.setup = p.setup;
          if (p.placering) o.placering = p.placering;
          return o;
        })
      }))
    });
  }

  function decodeEvent(s) {
    return inflateEvent(fromB64url(s));
  }

  function hbgmSharePatch(ev) {
    if (!ev || ev.id !== "hbgm26" || !global.HBGM_ROUTES) return false;
    const seed = eventFromSeed(global.HBGM_ROUTES);
    if ((ev.teams || []).length !== seed.teams.length) return false;
    const patch = { teams: [] };
    if ((ev.name || "") !== (seed.name || "")) patch.name = ev.name;
    for (let i = 0; i < seed.teams.length; i++) {
      const st = seed.teams[i];
      const t = (ev.teams || []).find((x) => x.id === st.id);
      if (!t) return false;
      const seedPts = pointsOf(st).map(shareFields);
      const curPts = pointsOf(t).map(shareFields);
      if (curPts.length < seedPts.length) return false;
      const td = { id: t.id, points: [] };
      if ((t.name || "") !== (st.name || "")) td.name = t.name;
      if ((t.ansvarig || "") !== (st.ansvarig || "")) td.ansvarig = t.ansvarig;
      if ((t.color || "") !== (st.color || "")) td.color = t.color;
      curPts.forEach((p, pi) => {
        const s = seedPts[pi];
        if (!s) {
          td.points.push([pi, p]);
          return;
        }
        const d = {};
        ["label", "lat", "lon", "iga", "setup", "placering"].forEach((k) => {
          if (p[k] !== s[k]) d[k] = p[k];
        });
        if (Object.keys(d).length) td.points.push([pi, d]);
      });
      if (!td.name && !td.ansvarig && !td.color && !td.points.length) continue;
      if (!td.points.length) delete td.points;
      patch.teams.push(td);
    }
    if (!patch.name && !patch.teams.length) return null;
    return patch;
  }

  function applyHbgmSharePatch(ev, patch) {
    if (!ev || !patch) return ev;
    if (patch.name) ev.name = patch.name;
    (patch.teams || []).forEach((td) => {
      const t = (ev.teams || []).find((x) => x.id === td.id);
      if (!t) return;
      if (td.name) t.name = td.name;
      if (td.ansvarig != null) t.ansvarig = td.ansvarig;
      if (td.color) t.color = td.color;
      const stops = (((t.modes || {}).kortast || {}).stops) || [];
      (td.points || []).forEach((row) => {
        const i = row[0];
        const d = row[1] || {};
        if (!stops[i]) stops[i] = { label: "", lat: d.lat, lon: d.lon };
        Object.assign(stops[i], d);
      });
      syncIgaFromKortast(t);
    });
    return ev;
  }

  function patchMovesPoints(patch) {
    return !!(patch && (patch.teams || []).some((t) =>
      (t.points || []).some((row) => row[1] && (row[1].lat != null || row[1].lon != null))
    ));
  }

  function gpxFor(team, modeId) {
    const mode = team.modes[modeId] || team.modes.kortast;
    const stops = mode.stops || [];
    const n = stops.length;
    const desc = modeId === "iga" ? "Körrutt i igång-ordning." : "Kortaste körrutten.";
    const name = (team.name || "Grupp") + (modeId === "iga" ? " (igång-ordning)" : "");
    const esc = (t) => String(t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Mattor" xmlns="http://www.topografix.com/GPX/1/1">\n';
    xml += "  <metadata><name>" + esc(name) + "</name><desc>" + esc(desc) + "</desc></metadata>\n";
    stops.forEach((s, i) => {
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) return;
      const cmt = ["SÄTT UPP: " + (s.setup || ""), "Igång " + (s.iga || ""), s.placering || ""].filter(Boolean).join(" | ");
      xml += '  <wpt lat="' + s.lat.toFixed(6) + '" lon="' + s.lon.toFixed(6) + '">\n';
      xml += "    <name>" + (i + 1) + "/" + n + " " + esc(s.label) + "</name>\n";
      xml += "    <desc>" + esc(cmt) + "</desc>\n  </wpt>\n";
    });
    xml += "  <trk><name>" + esc(name) + "</name><trkseg>\n";
    (mode.track || []).forEach((p) => {
      xml += '    <trkpt lat="' + Number(p[1]).toFixed(6) + '" lon="' + Number(p[0]).toFixed(6) + '"/>\n';
    });
    xml += "  </trkseg></trk>\n</gpx>\n";
    return xml;
  }

  function parseLatLon(text) {
    const t = String(text || "").trim();
    let m = t.match(/(-?\d+\.\d+)\s*[, ]\s*(-?\d+\.\d+)/);
    if (m) {
      const a = Number(m[1]), b = Number(m[2]);
      if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lat: a, lon: b };
    }
    m = t.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m) return { lat: Number(m[1]), lon: Number(m[2]) };
    m = t.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m) return { lat: Number(m[1]), lon: Number(m[2]) };
    return null;
  }

  global.Mattor = {
    COLORS, uid, clone, eventFromSeed, loadStore, saveStore, emptyModes,
    pointsOf, recalcTeam, compactEvent, inflateEvent, encodeEvent, decodeEvent,
    hbgmSharePatch, applyHbgmSharePatch, patchMovesPoints, toB64url, fromB64url,
    needsRouteRebuild,
    gpxFor, parseLatLon, igaSort, rememberRemoved, forgetRemoved, isRemoved
  };
})(window);
