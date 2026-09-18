(function (global) {
  const REPO = "Thomazzo91/utsattning";
  const API = "https://api.github.com/repos/" + REPO;

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
  function isNet(err) {
    const msg = String((err && err.message) || err || "");
    const name = String((err && err.name) || "");
    return /failed to fetch|networkerror|load failed|abort|timeout|network request failed/i.test(msg + " " + name);
  }
  function isConflict(err) {
    const status = err && err.status;
    const msg = String((err && err.message) || "");
    return status === 409 || status === 422 || /sha|conflict|fast.?forward/i.test(msg);
  }

  async function req(token, method, url, body, timeoutMs) {
    const headers = {
      Accept: "application/vnd.github+json"
    };
    if (token) headers.Authorization = "Bearer " + token;
    if (method === "GET") {
      url += (url.indexOf("?") >= 0 ? "&" : "?") + "ts=" + Date.now();
    }
    if (body) headers["Content-Type"] = "application/json";
    const tries = 2;
    const limitMs = timeoutMs || (method === "GET" ? 20000 : 30000);
    let lastErr;
    for (let attempt = 0; attempt < tries; attempt++) {
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), limitMs) : null;
      try {
        const res = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: ctrl ? ctrl.signal : undefined
        });
        const text = await res.text();
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (e) {}
        if (!res.ok) {
          const err = new Error((data && data.message) || ("HTTP " + res.status));
          err.status = res.status;
          throw err;
        }
        return data;
      } catch (e) {
        lastErr = e;
        if (!isNet(e) || attempt === tries - 1) throw e;
        await sleep(500 * (attempt + 1));
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    throw lastErr || new Error("GitHub");
  }

  async function githubReachable() {
    try {
      await req("", "GET", API, null, 15000);
      return true;
    } catch (e) {
      const status = e && e.status;
      return status === 401 || status === 403 || status === 404;
    }
  }

  function isAuthFail(err) {
    const status = err && err.status;
    return status === 401 || status === 403;
  }

  function utf8ToB64(str) {
    const bytes = new TextEncoder().encode(str);
    const chunk = 8192;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
    }
    return btoa(binary);
  }

  function b64ToUtf8(b64) {
    const bin = atob(String(b64 || "").replace(/\s/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function normalizeToken(t) {
    return String(t || "")
      .replace(/^\uFEFF/, "")
      .replace(/^\s*Bearer\s+/i, "")
      .replace(/[\s\u200b\u00a0\ufeff]+/g, "");
  }

  function parseRaces(text) {
    const a = String(text || "").indexOf("{");
    const b = String(text || "").lastIndexOf("}");
    if (a < 0 || b <= a) return {};
    return JSON.parse(text.slice(a, b + 1));
  }

  function racesFile(races) {
    return "window.RACES = " + JSON.stringify(races, null, 1) + ";\n";
  }

  async function headSha(token) {
    const ref = await req(token, "GET", API + "/git/ref/heads/main");
    const sha = ref && ref.object && ref.object.sha;
    if (!sha) throw new Error("Ingen main-branch");
    return sha;
  }

  async function checkToken(token) {
    try {
      await req(token, "GET", API, null, 20000);
    } catch (e) {
      if (isAuthFail(e)) throw e;
      if (isNet(e) && (await githubReachable())) {
        const err = new Error("Bad credentials");
        err.status = 401;
        throw err;
      }
      throw e;
    }
  }

  async function readRaces(token) {
    const sha = await headSha(token);
    const commit = await req(token, "GET", API + "/git/commits/" + sha);
    const treeSha = commit && commit.tree && commit.tree.sha;
    if (!treeSha) throw new Error("Kunde inte läsa katalogen");
    const tree = await req(token, "GET", API + "/git/trees/" + treeSha);
    const node = ((tree && tree.tree) || []).find((n) => n.path === "races.js");
    if (!node || !node.sha) return {};
    const blob = await req(token, "GET", API + "/git/blobs/" + node.sha, null, 30000);
    return parseRaces(b64ToUtf8(blob && blob.content));
  }

  function clone(x) {
    return JSON.parse(JSON.stringify(x));
  }

  function stopLabel(s) {
    return String((s && (s.label || s.name)) || "").trim().toLowerCase();
  }

  function pickText(localVal, remoteVal) {
    const l = localVal == null ? "" : String(localVal).trim();
    const r = remoteVal == null ? "" : String(remoteVal).trim();
    return l || r;
  }

  function mergeStop(remoteS, localS, uploadPath) {
    const r = Object.assign({}, remoteS || {}, localS || {});
    ["setup", "placering", "place", "note", "iga", "forsta", "sista", "maps", "who"].forEach((k) => {
      r[k] = pickText(localS && localS[k], remoteS && remoteS[k]);
    });
    r.place = r.placering || r.place || "";
    if (!r.note) r.note = r.placering || "";
    const llat = localS && Number(localS.lat);
    const llon = localS && Number(localS.lon);
    if (Number.isFinite(llat) && Number.isFinite(llon)) {
      r.lat = llat;
      r.lon = llon;
    } else if (remoteS && Number.isFinite(Number(remoteS.lat))) {
      r.lat = Number(remoteS.lat);
      r.lon = Number(remoteS.lon);
    }
    if (uploadPath) r.image = uploadPath;
    else if (localS && String(localS.image || "").indexOf("img/") === 0) r.image = localS.image;
    else if (remoteS && String(remoteS.image || "").indexOf("img/") === 0) r.image = remoteS.image;
    else if (localS && localS.image && String(localS.image).indexOf("data:") !== 0) r.image = localS.image;
    else r.image = (remoteS && remoteS.image && String(remoteS.image).indexOf("data:") !== 0) ? remoteS.image : "";
    if (localS && (localS.label || localS.name)) {
      r.label = localS.label || localS.name;
      r.name = localS.name || localS.label;
    }
    return r;
  }

  function indexStops(stops) {
    const m = {};
    (stops || []).forEach((s) => {
      const k = stopLabel(s);
      if (k && !m[k]) m[k] = s;
    });
    return m;
  }

  function mergeModeStops(remoteStops, localStops, upForGroup) {
    const rIndex = indexStops(remoteStops);
    const used = {};
    const src = (localStops && localStops.length) ? localStops : (remoteStops || []);
    const out = src.map((s) => {
      const k = stopLabel(s);
      if (k) used[k] = true;
      return mergeStop(rIndex[k], s, k && upForGroup[k]);
    });
    (remoteStops || []).forEach((s) => {
      const k = stopLabel(s);
      if (k && !used[k]) out.push(clone(s));
    });
    return out;
  }

  function mergeRaces(remote, local, opts) {
    const removed = (opts && opts.removed) || [];
    const uploads = (opts && opts.uploads) || [];
    const up = {};
    uploads.forEach((u) => {
      up[String(u.evId) + "|" + String(u.teamId) + "|" + String(u.label || "").toLowerCase()] = u.path;
    });
    const out = clone(remote || {});
    Object.keys(local || {}).forEach((id) => {
      if (removed.indexOf(id) >= 0) return;
      const loc = local[id];
      const rem = remote && remote[id];
      if (!rem) {
        out[id] = clone(loc);
        return;
      }
      const locGroups = loc.groups || [];
      const remGroups = rem.groups || [];
      const usedG = {};
      const groups = locGroups.map((lg) => {
        const rg = remGroups.find((g) => g.id === lg.id) || {};
        usedG[lg.id] = true;
        const g = clone(lg);
        if (!g.modes) g.modes = {};
        const upG = {};
        Object.keys(up).forEach((k) => {
          const p = k.split("|");
          if (p[0] === id && p[1] === String(lg.id)) upG[p.slice(2).join("|")] = up[k];
        });
        ["kortast", "iga"].forEach((mn) => {
          if (!g.modes[mn]) g.modes[mn] = (rg.modes && rg.modes[mn]) ? clone(rg.modes[mn]) : { stops: [] };
          g.modes[mn].stops = mergeModeStops(
            (rg.modes && rg.modes[mn] && rg.modes[mn].stops) || [],
            (lg.modes && lg.modes[mn] && lg.modes[mn].stops) || [],
            upG
          );
        });
        if (rg.name && !g.name) g.name = rg.name;
        return g;
      });
      remGroups.forEach((rg) => {
        if (!usedG[rg.id]) groups.push(clone(rg));
      });
      out[id] = Object.assign({}, rem, loc, {
        groups,
        name: loc.name || rem.name,
        rev: Math.max(Number(rem.rev) || 0, Number(loc.rev) || 0)
      });
    });
    removed.forEach((id) => { delete out[id]; });
    return out;
  }

  function walkStops(race, fn) {
    ((race && race.groups) || []).forEach((g) => {
      ["kortast", "iga"].forEach((mn) => {
        const stops = g && g.modes && g.modes[mn] && g.modes[mn].stops;
        (stops || []).forEach((s) => fn(g, s));
      });
    });
  }

  function missingNotes(live, localRaces) {
    const missing = [];
    Object.keys(localRaces || {}).forEach((id) => {
      ((localRaces[id] && localRaces[id].groups) || []).forEach((g) => {
        (((g.modes && g.modes.kortast && g.modes.kortast.stops) || [])).forEach((s) => {
          const want = String((s && (s.placering || s.note)) || "").trim();
          if (!want) return;
          let hit = "";
          ((live && live[id] && live[id].groups) || []).forEach((lg) => {
            if (lg.id !== g.id) return;
            (((lg.modes && lg.modes.kortast && lg.modes.kortast.stops) || [])).forEach((ls) => {
              if (stopLabel(ls) === stopLabel(s)) hit = String((ls && (ls.placering || ls.note)) || "").trim();
            });
          });
          if (hit !== want) missing.push((s.label || "") + ": " + want);
        });
      });
    });
    return missing;
  }

  async function commitFiles(token, files, message) {
    if (!files || !files.length) throw new Error("Inget att spara");
    const treeItems = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const blob = await req(token, "POST", API + "/git/blobs", {
        content: f.b64,
        encoding: "base64"
      }, 30000);
      if (!blob || !blob.sha) throw new Error("Kunde inte skapa " + f.path);
      treeItems.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
    }
    let lastErr;
    for (let attempt = 0; attempt < 10; attempt++) {
      let createdSha = "";
      try {
        const parent = await headSha(token);
        const commit = await req(token, "GET", API + "/git/commits/" + parent);
        const baseTree = commit && commit.tree && commit.tree.sha;
        if (!baseTree) throw new Error("Kunde inte läsa trädet");
        const tree = await req(token, "POST", API + "/git/trees", {
          base_tree: baseTree,
          tree: treeItems
        });
        if (!tree || !tree.sha) throw new Error("Kunde inte bygga commit");
        const created = await req(token, "POST", API + "/git/commits", {
          message: message || "Uppdatera lopp för alla",
          tree: tree.sha,
          parents: [parent]
        });
        createdSha = created && created.sha;
        if (!createdSha) throw new Error("Kunde inte skapa commit");
        await req(token, "PATCH", API + "/git/refs/heads/main", {
          sha: createdSha,
          force: false
        });
        const check = await headSha(token);
        if (check === createdSha) return createdSha;
        lastErr = new Error("Update is not a fast forward");
      } catch (e) {
        lastErr = e;
        if (createdSha) {
          try {
            if ((await headSha(token)) === createdSha) return createdSha;
          } catch (e2) {}
        }
        if (!isConflict(e) && !isNet(e)) throw e;
      }
      await sleep(280 * (attempt + 1));
    }
    throw lastErr || new Error("GitHub");
  }

  function uploadsInCatalog(races, uploads) {
    const text = JSON.stringify(races || {});
    return (uploads || []).every((u) => text.indexOf(u.path) >= 0);
  }

  global.MattorPublish = {
    utf8ToB64,
    parseRaces,
    racesFile,
    readRaces,
    mergeRaces,
    commitFiles,
    uploadsInCatalog,
    missingNotes,
    checkToken,
    normalizeToken,
    isNet,
    isConflict,
    isAuthFail,
    githubReachable
  };
})(window);
