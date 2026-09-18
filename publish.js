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
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token
    };
    if (method === "GET") {
      headers["Cache-Control"] = "no-cache";
      url += (url.indexOf("?") >= 0 ? "&" : "?") + "ts=" + Date.now();
    }
    if (body) headers["Content-Type"] = "application/json";
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs || (method === "GET" ? 12000 : 25000)) : null;
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
    } finally {
      if (timer) clearTimeout(timer);
    }
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

  async function readRaces(token) {
    const sha = await headSha(token);
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 20000) : null;
    try {
      const res = await fetch(API + "/contents/races.js?ref=" + encodeURIComponent(sha) + "&ts=" + Date.now(), {
        headers: {
          Accept: "application/vnd.github.raw",
          Authorization: "Bearer " + token,
          "Cache-Control": "no-cache"
        },
        signal: ctrl ? ctrl.signal : undefined
      });
      if (res.status === 404) return {};
      const text = await res.text();
      if (!res.ok) throw new Error("Kunde inte läsa katalogen");
      return parseRaces(text);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function walkStops(race, fn) {
    ((race && race.groups) || []).forEach((g) => {
      ["kortast", "iga"].forEach((mn) => {
        const stops = g && g.modes && g.modes[mn] && g.modes[mn].stops;
        (stops || []).forEach((s) => fn(g, s));
      });
    });
  }

  function indexImages(race) {
    const map = {};
    walkStops(race || {}, (g, s) => {
      const img = s && s.image;
      if (img && String(img).indexOf("img/") === 0) {
        map[String(g.id) + "|" + String(s.label || "").toLowerCase()] = img;
      }
    });
    return map;
  }

  function mergeRaces(remote, local, opts) {
    const removed = (opts && opts.removed) || [];
    const uploads = (opts && opts.uploads) || [];
    const up = {};
    uploads.forEach((u) => {
      up[String(u.evId) + "|" + String(u.teamId) + "|" + String(u.label || "").toLowerCase()] = u.path;
    });
    const out = JSON.parse(JSON.stringify(remote || {}));
    Object.keys(local || {}).forEach((id) => {
      if (removed.indexOf(id) >= 0) return;
      const loc = JSON.parse(JSON.stringify(local[id]));
      const remoteImgs = indexImages(remote && remote[id]);
      walkStops(loc, (g, s) => {
        if (!s) return;
        const uk = id + "|" + g.id + "|" + String(s.label || "").toLowerCase();
        const sk = g.id + "|" + String(s.label || "").toLowerCase();
        if (up[uk]) s.image = up[uk];
        else if (s.image && String(s.image).indexOf("img/") === 0) return;
        else if (remoteImgs[sk]) s.image = remoteImgs[sk];
        else if (s.image && String(s.image).indexOf("data:") === 0) s.image = "";
      });
      out[id] = loc;
    });
    removed.forEach((id) => { delete out[id]; });
    return out;
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
    isNet,
    isConflict
  };
})(window);
