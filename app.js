/* Mattor — lopp, grupper, punkter och körvägar. Ingen server. */
(function (global) {
  const STORE = "mattor-app-v1";
  const REMOVED = "mattor-removed-v1";
  const STORE_VERSION = 3;
  const SNAP_M = 18;
  const COLORS = ["#d97706", "#2563eb", "#059669", "#ef4444", "#a855f7", "#14b8a6", "#f97316", "#6366f1"];
  const OSRM = "https://router.project-osrm.org";
  const OSRM_FOOT = "https://routing.openstreetmap.de/routed-foot";
  const OSRM_BIKE = "https://routing.openstreetmap.de/routed-bike";
  const OVERPASS = "https://overpass-api.de/api/interpreter";

  function uid(prefix) {
    return prefix + "-" + Math.random().toString(36).slice(2, 8);
  }

  function clone(x) {
    return JSON.parse(JSON.stringify(x));
  }

  function isBuiltIn(id) {
    return !!(id && global.RACES && typeof global.RACES[id] === "object");
  }

  const OBSOLETE_IDS = ["hbgm26", "malmo26", "hbgm", "malmomarathon", "hbgm26-marathon", "malmomarathon26"];
  function isObsoleteId(id) {
    return !!(id && typeof id === "string" && OBSOLETE_IDS.indexOf(id.toLowerCase()) >= 0);
  }

  function builtInDisplayName(id) {
    if (id && global.RACES && global.RACES[id]) return String(global.RACES[id].name || id);
    return String(id || "");
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const r = 6371000;
    const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
    const dp = (lat2 - lat1) * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * r * Math.asin(Math.sqrt(a));
  }

  function eventFromSeed(routes, id, displayName) {
    const rid = id || "lopp1";
    return clone({
      id: rid,
      name: displayName || builtInDisplayName(rid),
      teams: (routes.groups || []).map((g) => ({
        id: g.id,
        name: g.name,
        ansvarig: g.ansvarig || "",
        color: g.color,
        modes: g.modes
      }))
    });
  }

  function seedEvent(id) {
    const rid = id || "lopp1";
    if (!isBuiltIn(rid)) return null;
    return eventFromSeed(global.RACES[rid], rid, builtInDisplayName(rid));
  }

  function seedRev(id) {
    const rid = id || "lopp1";
    if (!isBuiltIn(rid)) return 1;
    return Number(global.RACES[rid].rev) || 1;
  }

  function defaultEventId() {
    if (isBuiltIn("lopp1")) return "lopp1";
    const first = Object.keys(global.RACES || {})[0];
    return first || "lopp1";
  }

  function getAllBuiltInIds() {
    return Object.keys(global.RACES || {});
  }

  function getRemovedIds() {
    try {
      const ids = JSON.parse(localStorage.getItem(REMOVED) || "[]");
      return Array.isArray(ids) ? ids.filter((id) => typeof id === "string" && id && !isBuiltIn(id)) : [];
    } catch (e) {
      return [];
    }
  }

  function rememberRemoved(id) {
    if (!id || isBuiltIn(id)) return;
    const ids = getRemovedIds();
    if (ids.indexOf(id) < 0) ids.push(id);
    try { localStorage.setItem(REMOVED, JSON.stringify(ids)); } catch (e) {}
  }

  function forgetRemoved(id) {
    if (!id) return;
    try { localStorage.setItem(REMOVED, JSON.stringify(getRemovedIds().filter((x) => x !== id))); } catch (e) {}
  }

  function isRemoved(id) {
    return !!(id && !isBuiltIn(id) && getRemovedIds().indexOf(id) >= 0);
  }

  function hydrateEvent(ev) {
    if (!ev || !ev.id) return null;
    if (isRemoved(ev.id)) return null;
    if (isBuiltIn(ev.id)) {
      const seed = seedEvent(ev.id);
      if (!seed) return null;
      if (!ev.teams || (Number(ev.rev) || 0) < seedRev(ev.id)) return seed;
      return mergeBuiltIn(ev, ev.id);
    }
    const t0 = ev.teams && ev.teams[0];
    if (t0 && Array.isArray(t0.points) && !t0.modes) return inflateEvent(ev);
    return ev;
  }

  function serializeStore(data) {
    const events = (data.events || []).filter((ev) => {
      if (!ev || !ev.id) return false;
      if (isRemoved(ev.id)) return false;
      if (isObsoleteId(ev.id)) { rememberRemoved(ev.id); return false; }
      return true;
    }).map((ev) => {
      if (isBuiltIn(ev.id)) {
        const rev = seedRev(ev.id);
        const seed = seedEvent(ev.id);
        try {
          if (JSON.stringify(compactEvent(ev)) === JSON.stringify(compactEvent(seed))) {
            return { id: ev.id, rev };
          }
        } catch (e) {}
        const c = compactEvent(ev);
        c.rev = rev;
        return c;
      }
      return compactEvent(ev);
    });
    getAllBuiltInIds().forEach((bid) => {
      if (!events.some((e) => e.id === bid)) events.push({ id: bid, rev: seedRev(bid) });
    });
    const currentId = (data.currentEventId && !isRemoved(data.currentEventId) && !isObsoleteId(data.currentEventId)) ? data.currentEventId :
      (isBuiltIn(data.currentEventId) ? data.currentEventId : defaultEventId());
    const hasCurrent = events.some((e) => e.id === currentId);
    const finalCurrent = hasCurrent ? currentId : (events[0] && events[0].id) || defaultEventId();
    return { v: STORE_VERSION, currentEventId: finalCurrent, events };
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.events) || !data.events.length) return null;
      const events = [];
      data.events.forEach((ev) => {
        if (!ev || isObsoleteId(ev && ev.id)) { rememberRemoved(ev && ev.id); return; }
        const full = hydrateEvent(ev);
        if (full) events.push(full);
      });
      getAllBuiltInIds().forEach((bid) => {
        if (!events.some((e) => e.id === bid)) {
          const s = seedEvent(bid);
          if (s) events.unshift(s);
        }
      });
      if (!events.length) return null;
      const currentEventId = events.some((e) => e.id === data.currentEventId) ? data.currentEventId : events[0].id;
      const customized = events.some((e) => !isBuiltIn(e.id));
      return { currentEventId, customized, events };
    } catch (e) {
      return null;
    }
  }

  function saveStore(data) {
    const payload = serializeStore(data);
    localStorage.setItem(STORE, JSON.stringify(payload));
    const check = JSON.parse(localStorage.getItem(STORE) || "null");
    const savedIds = ((check && check.events) || []).map((e) => e.id).filter((id) => !isObsoleteId(id));
    getRemovedIds().filter((id) => !isObsoleteId(id)).forEach((id) => {
      if (savedIds.indexOf(id) >= 0) {
        try {
          payload.events = (payload.events || []).filter((e) => e.id !== id);
          localStorage.setItem(STORE, JSON.stringify(payload));
        } catch (e) {}
      }
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
    return src.map((s, i) => {
      const fallbackLabel = s.name || ("Punkt " + (i + 1));
      return {
        idx: s.idx == null ? (i + 1) : s.idx,
        name: s.name || fallbackLabel,
        label: s.label || fallbackLabel,
        who: s.who || "",
        lat: Number(s.lat),
        lon: Number(s.lon),
        starth: Number(s.starth) || 0,
        startm: Number(s.startm) || 0,
        firsth: Number(s.firsth) || 0,
        firstm: Number(s.firstm) || 0,
        lasth: Number(s.lasth) || 0,
        lastm: Number(s.lastm) || 0,
        iga: s.iga || "",
        forsta: s.forsta || "",
        sista: s.sista || "",
        maps: s.maps || "",
        placering: s.placering || s.place || "",
        note: s.note || "",
        place: s.place || "",
        setup: s.setup || "",
        gpx: s.gpx || "",
        image: s.image || ""
      };
    });
  }

  async function compressImage(file, maxLongSide, quality) {
    const max = maxLongSide || 1600;
    const q = quality == null ? 0.82 : quality;
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error("FileReader"));
      reader.onload = () => {
        const dataUrl = reader.result;
        const img = new Image();
        img.onerror = () => reject(new Error("Image load"));
        img.onload = () => {
          const w = img.naturalWidth;
          const h = img.naturalHeight;
          let nw = w, nh = h;
          if (w > h && w > max) { nw = max; nh = Math.round(h * max / w); }
          else if (h >= w && h > max) { nh = max; nw = Math.round(w * max / h); }
          try {
            const c = document.createElement("canvas");
            c.width = nw;
            c.height = nh;
            const ctx = c.getContext("2d");
            ctx.drawImage(img, 0, 0, nw, nh);
            resolve(c.toDataURL("image/jpeg", q));
          } catch (e) {
            resolve(dataUrl);
          }
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  async function osrmJson(url, timeoutMs) {
    const ms = timeoutMs || 9000;
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
    try {
      const res = await fetch(url, ctrl ? { signal: ctrl.signal } : {});
      if (!res.ok) throw new Error("OSRM " + res.status);
      return await res.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function osrmEndpoints(profile) {
    if (profile === "foot") {
      return [{ base: OSRM_FOOT, name: "foot" }, { base: OSRM, name: "foot" }];
    }
    if (profile === "bike") {
      return [{ base: OSRM_BIKE, name: "cycling" }, { base: OSRM, name: "bike" }];
    }
    return [{ base: OSRM, name: "driving" }];
  }

  async function osrmRoute(profile, a, b) {
    const maxGap = profile === "driving" ? 250 : 90;
    const endpoints = osrmEndpoints(profile);
    for (let i = 0; i < endpoints.length; i++) {
      const ep = endpoints[i];
      try {
        const url = ep.base + "/route/v1/" + ep.name + "/" +
          a.lon.toFixed(6) + "," + a.lat.toFixed(6) + ";" +
          b.lon.toFixed(6) + "," + b.lat.toFixed(6) +
          "?overview=full&geometries=geojson";
        const data = await osrmJson(url, ep.base.indexOf("openstreetmap.de") >= 0 ? 6000 : 8000);
        if (data.code !== "Ok" || !data.routes || !data.routes[0]) continue;
        const r = data.routes[0];
        if (!r || !r.geometry || !Array.isArray(r.geometry.coordinates) || r.geometry.coordinates.length < 2) continue;
        const coords = r.geometry.coordinates;
        const first = coords[0];
        const last = coords[coords.length - 1];
        if (!first || !last) continue;
        if ((r.distance || 0) < 5 && (Math.abs(first[0] - last[0]) < 1e-6 && Math.abs(first[1] - last[1]) < 1e-6)) {
          continue;
        }
        const gapStartM = haversine(a.lat, a.lon, first[1], first[0]);
        const gapEndM = haversine(b.lat, b.lon, last[1], last[0]);
        if (gapStartM > maxGap || gapEndM > maxGap) continue;
        return { geom: coords, dist: r.distance, dur: r.duration };
      } catch (e) {
        continue;
      }
    }
    return null;
  }

  function gap(geom, lat, lon) {
    const last = geom[geom.length - 1];
    return haversine(last[1], last[0], lat, lon);
  }

  function gapStart(geom, lat, lon) {
    const first = geom[0];
    return haversine(first[1], first[0], lat, lon);
  }

  function nodeKey(lat, lon) {
    return lat.toFixed(6) + "," + lon.toFixed(6);
  }

  async function osmWalkRoute(a, b) {
    const crowM = haversine(a.lat, a.lon, b.lat, b.lon);
    if (crowM < 8 || crowM > 1200) return null;
    const pad = 0.0018;
    const south = Math.min(a.lat, b.lat) - pad;
    const west = Math.min(a.lon, b.lon) - pad;
    const north = Math.max(a.lat, b.lat) + pad;
    const east = Math.max(a.lon, b.lon) + pad;
    const q = "[out:json][timeout:20];way(" +
      south.toFixed(6) + "," + west.toFixed(6) + "," + north.toFixed(6) + "," + east.toFixed(6) +
      ")[highway~\"^(footway|path|pedestrian|cycleway|steps|track)$\"];out geom;";
    try {
      const data = await osrmJson(OVERPASS + "?data=" + encodeURIComponent(q), 16000);
      const elements = data.elements || [];
      if (!elements.length) return null;
      const nodes = new Map();
      function addNode(lat, lon) {
        const k = nodeKey(lat, lon);
        if (!nodes.has(k)) nodes.set(k, { lat, lon, edges: [] });
        return k;
      }
      function addEdge(k1, k2) {
        if (k1 === k2) return;
        const n1 = nodes.get(k1), n2 = nodes.get(k2);
        if (!n1 || !n2) return;
        const d = haversine(n1.lat, n1.lon, n2.lat, n2.lon);
        if (d < 0.3) return;
        n1.edges.push({ to: k2, dist: d });
        n2.edges.push({ to: k1, dist: d });
      }
      function projectOnSeg(lat, lon, lat1, lon1, lat2, lon2) {
        const dx = lon2 - lon1, dy = lat2 - lat1;
        const len2 = dx * dx + dy * dy;
        let t = len2 < 1e-18 ? 0 : ((lon - lon1) * dx + (lat - lat1) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        return { lat: lat1 + t * dy, lon: lon1 + t * dx };
      }
      elements.forEach((el) => {
        const geom = el.geometry || [];
        let prev = null;
        geom.forEach((g) => {
          const k = addNode(g.lat, g.lon);
          if (prev) addEdge(prev, k);
          prev = k;
        });
      });
      const startK = addNode(a.lat, a.lon);
      const endK = addNode(b.lat, b.lon);
      const linkMax = 80;
      function snapPoint(ptK, plat, plon) {
        let best = null;
        elements.forEach((el) => {
          const geom = el.geometry || [];
          for (let i = 1; i < geom.length; i++) {
            const g0 = geom[i - 1], g1 = geom[i];
            const pr = projectOnSeg(plat, plon, g0.lat, g0.lon, g1.lat, g1.lon);
            const d = haversine(plat, plon, pr.lat, pr.lon);
            if (d <= linkMax && (!best || d < best.d)) best = { d, pr, g0, g1 };
          }
        });
        if (!best) return;
        const pk = addNode(best.pr.lat, best.pr.lon);
        addEdge(ptK, pk);
        addEdge(pk, addNode(best.g0.lat, best.g0.lon));
        addEdge(pk, addNode(best.g1.lat, best.g1.lon));
      }
      snapPoint(startK, a.lat, a.lon);
      snapPoint(endK, b.lat, b.lon);
      nodes.forEach((n, k) => {
        if (k === startK || k === endK) return;
        const ds = haversine(a.lat, a.lon, n.lat, n.lon);
        const de = haversine(b.lat, b.lon, n.lat, n.lon);
        if (ds <= linkMax) addEdge(startK, k);
        if (de <= linkMax) addEdge(endK, k);
      });
      const distMap = new Map();
      const prevMap = new Map();
      distMap.set(startK, 0);
      const qn = [startK];
      while (qn.length) {
        let bestI = 0;
        for (let i = 1; i < qn.length; i++) {
          if ((distMap.get(qn[i]) || 1e15) < (distMap.get(qn[bestI]) || 1e15)) bestI = i;
        }
        const cur = qn.splice(bestI, 1)[0];
        if (cur === endK) break;
        const curD = distMap.get(cur) || 1e15;
        const curN = nodes.get(cur);
        (curN.edges || []).forEach((ed) => {
          const nd = curD + ed.dist;
          if (nd < (distMap.get(ed.to) || 1e15)) {
            distMap.set(ed.to, nd);
            prevMap.set(ed.to, cur);
            qn.push(ed.to);
          }
        });
      }
      if (!prevMap.has(endK) && startK !== endK) return null;
      const keys = [endK];
      let walk = endK;
      while (walk !== startK) {
        walk = prevMap.get(walk);
        if (!walk) return null;
        keys.push(walk);
      }
      keys.reverse();
      const geom = keys.map((k) => {
        const n = nodes.get(k);
        return [n.lon, n.lat];
      });
      const dist = distMap.get(endK) || crowM;
      if (geom.length < 2 || dist > crowM * 2.4) return null;
      return { geom, dist, dur: dist / 1.25 };
    } catch (e) {
      return null;
    }
  }

  async function reach(a, b) {
    const samePoint = haversine(a.lat, a.lon, b.lat, b.lon) < SNAP_M;
    const segs = [];
    const pushSeg = (profile, geom, extraDist, extraDur) => {
      if (!geom || !geom.length) return;
      if (geom.length === 1 && profile !== "crow") return;
      segs.push({ profile, geom: geom.slice(), dist: extraDist || 0, dur: extraDur || 0 });
    };
    if (samePoint) {
      return { geom: [[a.lon, a.lat]], dist: 0, dur: 0, segs: [] };
    }
    const crowM = haversine(a.lat, a.lon, b.lat, b.lon);
    const shortHop = crowM <= 450;
    let drive = null;
    let foot = null;
    let bike = null;
    if (shortHop) {
      foot = await osmWalkRoute(a, b);
      if (!foot) foot = await osrmRoute("foot", a, b);
      if (!foot) bike = await osrmRoute("bike", a, b);
      if (!foot && !bike) drive = await osrmRoute("driving", a, b);
    } else {
      drive = await osrmRoute("driving", a, b);
      if (!drive) {
        bike = await osrmRoute("bike", a, b);
        if (!bike) foot = await osrmRoute("foot", a, b) || await osmWalkRoute(a, b);
      }
    }
    const snapOf = (r) => {
      if (!r || !r.geom || !r.geom.length) return 1e9;
      return Math.max(gapStart(r.geom, a.lat, a.lon), gap(r.geom, b.lat, b.lon));
    };
    const footSnap = snapOf(foot);
    const driveSnap = snapOf(drive);
    const bikeSnap = snapOf(bike);
    const footOk = !!(foot && footSnap <= 90 && foot.dist >= 5 && foot.dist < crowM * 3 + 40);
    const driveOk = !!(drive && driveSnap <= 250);
    let used = null;
    let got = null;
    if (footOk && (shortHop || driveSnap > 55 || (driveOk && foot.dist * 1.2 < drive.dist))) {
      used = "foot";
      got = foot;
    } else if (driveOk) {
      used = "driving";
      got = drive;
    } else if (bike && bikeSnap <= 90) {
      used = "bike";
      got = bike;
    } else if (footOk) {
      used = "foot";
      got = foot;
    }
    let geom = [[a.lon, a.lat]];
    let dist = 0, dur = 0;
    if (got && used) {
      geom = got.geom.slice();
      dist = got.dist || 0;
      dur = got.dur || 0;
      const gStartM = gapStart(geom, a.lat, a.lon);
      if (gStartM > SNAP_M) {
        const pre = [[a.lon, a.lat], geom[0]];
        segs.unshift({ profile: (used === "driving" ? "crow" : "foot"), geom: pre, dist: gStartM, dur: 0 });
        geom = [[a.lon, a.lat]].concat(geom);
        dist += gStartM;
      }
      pushSeg(used, got.geom.slice(), got.dist || 0, got.dur || 0);
      if (gap(geom, b.lat, b.lon) <= SNAP_M) {
        geom.push([b.lon, b.lat]);
        return { geom, dist, dur, segs };
      }
    }
    let last = geom[geom.length - 1];
    if (gap(geom, b.lat, b.lon) > SNAP_M) {
      const crowGeom = [[last[0], last[1]], [b.lon, b.lat]];
      const crowGap = gap(geom.slice(), b.lat, b.lon);
      pushSeg("crow", crowGeom, crowGap, 0);
      geom.push([b.lon, b.lat]);
      dist += crowGap;
    }
    return { geom, dist, dur, segs };
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
    if (!stops.length) return { track: [], legs: [], km: 0, min: 0, segs: [] };
    if (stops.length === 1) {
      return { track: [[stops[0].lon, stops[0].lat]], legs: [], km: 0, min: 0,
        segs: [{ profile: "crow", geom: [[stops[0].lon, stops[0].lat]], dist: 0, dur: 0 }] };
    }
    let track = [[stops[0].lon, stops[0].lat]];
    const legs = [];
    const segs = [];
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
        min: Math.round(r.dur / 6) / 10,
        profiles: (r.segs || []).map((s) => s.profile)
      });
      (r.segs || []).forEach((s) => segs.push(s));
      totalM += r.dist;
      totalS += r.dur;
    }
    return {
      track,
      legs,
      segs,
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

  function isStaleParkMalgang(p) {
    const lat = Number(p && p.lat), lon = Number(p && p.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    return Math.abs(lat - 55.602339) < 2e-4 && Math.abs(lon - 12.968334) < 2e-4;
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
      stops, legs: built.legs || [], track: built.track || [],
      segs: built.segs || []
    };
  }

  function isSequentialIdx(pts) {
    if (!pts || !pts.length) return false;
    for (let i = 0; i < pts.length; i++) {
      if (pts[i].idx !== (i + 1)) return false;
    }
    return true;
  }

  async function recalcTeam(team, onProgress) {
    const pts = pointsOf(team).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    const seq = isSequentialIdx(pts);
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
      const ba = seq ? null : await buildPath([pts[1], pts[0]]);
      const useAb = seq || pathBetter(ab, ba);
      const kortStops = useAb ? [pts[0], pts[1]] : [pts[1], pts[0]];
      const kort = useAb ? ab : ba;
      const igaStops = igaSort(pts);
      const iga = sameOrder(igaStops, kortStops) ? { ...kort, stops: igaStops } : reverseBuilt(kort, igaStops);
      team.modes = { kortast: packMode(kort, kortStops), iga: packMode(iga, iga.stops) };
      return team;
    }
    if (onProgress) onProgress(seq ? "Beräknar körväg…" : "Beräknar kortaste körväg…");
    let order = pts.map((_, i) => i);
    if (!seq) {
      try {
        const matrix = await osrmTable(pts);
        order = shortestOrder(pts.length, matrix);
      } catch (e) {
        order = pts.map((_, i) => i);
      }
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
    if (typeof src.image === "string") dest.image = src.image;
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

  function mergeBuiltIn(saved, seedId) {
    const seed = seedEvent(seedId);
    if (!seed) return saved;
    if (saved.name) seed.name = saved.name;
    const savedRev = saved.rev || 0;
    const seedRev = seed.rev || 0;
    const revBumped = savedRev !== seedRev;
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
      const coordsChanged = revBumped || pts.length !== kort.length || pts.some((p, i) => !samePt(p, kort[i]));
      pts.forEach((p, i) => {
        if (!kort[i]) {
          kort[i] = Object.assign({}, p);
        } else if (revBumped) {
          const pt = kort[i];
          pt.who = p.who || pt.who;
          if (typeof p.image === "string" && p.image) pt.image = p.image;
          if (!samePt(p, pt) && !isStaleParkMalgang(p)) {
            if (Number.isFinite(Number(p.lat))) pt.lat = Number(p.lat);
            if (Number.isFinite(Number(p.lon))) pt.lon = Number(p.lon);
          }
          if (p.placering) pt.placering = p.placering;
        } else {
          applyPoint(kort[i], p);
        }
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

  function mergeFirstBuiltIn(saved) { return mergeBuiltIn(saved, defaultEventId()); }

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
      placering: p.placering || "",
      image: p.image || ""
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
          if (p.image) o.image = p.image;
          return o;
        })
      }))
    });
  }

  function decodeEvent(s) {
    return inflateEvent(fromB64url(s));
  }

  function builtInSharePatch(ev, seedId) {
    const bid = seedId || (ev && ev.id);
    if (!ev || !isBuiltIn(bid)) return false;
    const seed = seedEvent(bid);
    if (!seed) return false;
    if ((ev.teams || []).length !== seed.teams.length) return false;
    const patch = { id: bid, teams: [] };
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
        ["label", "lat", "lon", "iga", "setup", "placering", "image"].forEach((k) => {
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

  function firstBuiltInSharePatch(ev) { return builtInSharePatch(ev, ev?.id || defaultEventId()); }

  function applyBuiltInSharePatch(ev, patch) {
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

  function applyHbgmSharePatch(ev, patch) { return applyBuiltInSharePatch(ev, patch); }

  function patchMovesPoints(patch) {
    return !!(patch && (patch.teams || []).some((t) =>
      (t.points || []).some((row) => row[1] && (row[1].lat != null || row[1].lon != null))
    ));
  }

  function gpxFor(team, modeId) {
    const mode = team.modes[modeId] || team.modes.kortast;
    const stops = mode.stops || [];
    const n = stops.length;
    const desc = modeId === "iga" ? "Korrutt i igång-ordning." : "Kortaste körrutten.";
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
    firstBuiltInSharePatch, builtInSharePatch, applyBuiltInSharePatch, patchMovesPoints,
    toB64url, fromB64url,
    needsRouteRebuild,
    gpxFor, parseLatLon, igaSort, rememberRemoved, forgetRemoved, isRemoved,
    isBuiltIn, seedEvent, seedRev, builtInDisplayName, defaultEventId, getAllBuiltInIds,
    compressImage, mergeBuiltIn, mergeFirstBuiltIn
  };
})(window);
