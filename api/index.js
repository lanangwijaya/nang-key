const BUILD = "78.1";
const NANG_WEBHOOK = "https://discord.com/api/webhooks/1554789657705844819/S-AEYb2JOZy7Ixr1KotRTjy91j2ogk3U6-6ODK41Zf4AyEyAnHTIUu6mGN_etsYcYMhS";

import { createHash, randomBytes } from "node:crypto";

const _KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const _KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const _HAS_KV = !!(_KV_URL && _KV_TOKEN);

async function _kvCmd(...args) {
  if (!_HAS_KV) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(_KV_URL + "/pipeline", {
      method: "POST",
      headers: { Authorization: "Bearer " + _KV_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify([args]),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) { console.error("[NANG KV] HTTP", r.status); return null; }
    const d = await r.json();
    if (Array.isArray(d) && d[0] !== undefined) return d[0].result ?? null;
    if (d && d.result !== undefined) return d.result;
    return null;
  } catch (e) { console.error("[NANG KV] error:", e.message); return null; }
}

const _memStore = (global.__nangMem = global.__nangMem || {});
let _kvBrokenUntil = 0;

async function storeGet(key) {
  const now = Date.now();
  if (_HAS_KV && now > _kvBrokenUntil) {
    const raw = await _kvCmd("GET", key);
    if (raw == null) return _memStore[key] ?? null;
    if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return raw; } }
    return raw;
  }
  return _memStore[key] ?? null;
}

async function storeSet(key, val, ttlSec) {
  const raw = typeof val === "string" ? val : JSON.stringify(val);
  const now = Date.now();
  if (_HAS_KV && now > _kvBrokenUntil) {
    let r;
    if (ttlSec) r = await _kvCmd("SET", key, raw, "EX", ttlSec);
    else r = await _kvCmd("SET", key, raw);
    if (r !== null) { _memStore[key] = val; return true; }
    _kvBrokenUntil = now + 60000;
    console.error("[NANG] KV write failed, fallback to mem:", key);
  }
  _memStore[key] = val;
  return true;
}

async function storeDel(key) {
  const now = Date.now();
  if (_HAS_KV && now > _kvBrokenUntil) {
    const r = await _kvCmd("DEL", key);
    if (r !== null) return true;
    _kvBrokenUntil = now + 60000;
  }
  delete _memStore[key];
  return true;
}

function hashPw(pw, salt) { return createHash("sha256").update(salt + "::" + pw).digest("hex"); }
function randomHex(n) { return randomBytes(n).toString("hex"); }

const DEFAULT_STORE = { price: 500, wa: "", dana: "", name: "", active: false, qr: "" };
const OWNER_EMAILS = ["putraiful82@gmail.com"];
const OWNER_USERNAMES = ["nanang"];
const MAX_FREE_SIZE = 8 * 1024 * 1024;

function ensureStore(u) {
  if (!u) return u;
  if (!u.store) u.store = { ...DEFAULT_STORE };
  if (typeof u.store.price !== "number") u.store.price = 500;
  if (typeof u.store.wa !== "string") u.store.wa = "";
  if (typeof u.store.dana !== "string") u.store.dana = "";
  if (typeof u.store.name !== "string") u.store.name = "";
  if (typeof u.store.active !== "boolean") u.store.active = false;
  if (typeof u.store.qr !== "string") u.store.qr = "";
  return u;
}

async function getUser(username) {
  if (!username) return null;
  const u = await storeGet("nang:user:" + String(username).toLowerCase());
  return ensureStore(u);
}
async function saveUser(user) {
  ensureStore(user);
  await storeSet("nang:user:" + user.username.toLowerCase(), user);
  if (_HAS_KV && Date.now() > _kvBrokenUntil) await _kvCmd("SADD", "nang:userlist", user.username);
  return true;
}
async function listUsers() {
  const out = [];
  const seen = {};
  if (_HAS_KV && Date.now() > _kvBrokenUntil) {
    const names = (await _kvCmd("SMEMBERS", "nang:userlist")) || [];
    for (const n of names) {
      const u = await storeGet("nang:user:" + String(n).toLowerCase());
      if (u && u.username) { out.push(ensureStore(u)); seen[u.username.toLowerCase()] = true; }
    }
  }
  for (const k of Object.keys(_memStore)) {
    const v = _memStore[k];
    if (v && v.username && v.passwordHash && !seen[v.username.toLowerCase()]) {
      out.push(ensureStore({ ...v }));
      seen[v.username.toLowerCase()] = true;
    }
  }
  return out;
}

const _SECRET = "NANG2024";
const _EXPIRE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_QUOTA = 10;
const SESSION_MS = 30 * 24 * 3600 * 1000;
function _simpleHash(str) { let h = 0; for (let i = 0; i < str.length; i++) h = ((h * 31) + str.charCodeAt(i)) % 1000000007; return h; }
function _makeKeyAt(uid, ts) {
  const code = Math.floor(ts / 60000) % 10000;
  const h = _simpleHash(_SECRET + String(uid) + String(code));
  const p1 = String(uid).slice(0, 5).padEnd(5, "0");
  return "NANG-" + p1 + "-" + String(h % 10000).padStart(4, "0") + "-" + String(Math.floor(h / 10000) % 10000).padStart(4, "0");
}
function _makeKey(uid) { return _makeKeyAt(uid, Date.now()); }
function _verifyKey(uid, key) {
  const k = String(key || "").toUpperCase().replace(/\s+/g, "");
  if (!k) return { valid: false, remainingMs: 0 };
  const now = Date.now();
  for (let delta = 0; delta < 1440; delta++) {
    const ts = now - delta * 60000;
    if (_makeKeyAt(uid, ts) === k) {
      const rem = Math.max(0, (ts + _EXPIRE_MS) - now);
      return { valid: rem > 0, remainingMs: rem };
    }
  }
  return { valid: false, remainingMs: 0 };
}
function _fmtRemaining(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(s / 3600) + "j " + Math.floor((s % 3600) / 60) + "m";
}
function _expiryStr(uid, key) {
  const r = _verifyKey(uid, key);
  return r.valid ? _fmtRemaining(r.remainingMs) : null;
}
async function _getRobloxUser(uid) {
  try { const r = await fetch("https://users.roblox.com/v1/users/" + uid); if (!r.ok) return null; return (await r.json()).name || null; }
  catch { return null; }
}
function _getClientIP(req) {
  const xf = req.headers["x-forwarded-for"];
  if (xf) return String(xf).split(",")[0].trim();
  return req.headers["x-real-ip"] || "unknown";
}

async function _saveKeyRole(uid, key, role, by) {
  try { await storeSet("nang:key:" + uid + ":" + key, { role, by, ts: Date.now() }, 30 * 24 * 3600); }
  catch(e){}
}
async function _getKeyRole(uid, key) {
  try { return await storeGet("nang:key:" + uid + ":" + key); }
  catch(e){ return null; }
}

async function sendWebhook(fields) {
  if (!NANG_WEBHOOK || NANG_WEBHOOK.includes("GANTI_INI")) return;
  try {
    await fetch(NANG_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "NANG Logger",
        embeds: [{ title: "NANG Event", color: 14433400, fields, timestamp: new Date().toISOString(), footer: { text: "NANG v" + BUILD } }]
      })
    });
  } catch (e) {}
}

export default async function handler(req, res) {
  try { return await handle(req, res); }
  catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(200).json({ error: "server error", detail: String(e.message || e) });
  }
}

async function handle(req, res) {
  const ADMIN_PW = "lanang03";
  const WA_NUMBER = "6281252425581";
  const AUTH_DOMAIN = req.headers.host || "localhost";

  function b64urlEncode(obj) { let b64 = Buffer.from(JSON.stringify(obj), "utf8").toString("base64"); return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function b64urlDecode(str) { let s = str.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Buffer.from(s, "base64").toString("utf8"); }

  const url = new URL(req.url, "https://" + AUTH_DOMAIN);
  const params = url.searchParams;
  const path = url.pathname;
  const method = req.method;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-nang-apikey, x-nang-userid, x-nang-groupid, x-nang-filename, x-nang-display, x-nang-desc, x-nang-assettype");
  if (method === "OPTIONS") { res.status(200).end(); return; }

  if (params.has("version")) {
    let hasYtdl = false, ytdlErr = null;
    try { await import("@distube/ytdl-core"); hasYtdl = true; } catch(e) { ytdlErr = String(e.message || e).slice(0, 80); }
    res.status(200).json({ version: BUILD, ts: Date.now(), hasKv: _HAS_KV, hasRapid: !!process.env.RAPIDAPI_KEY, hasYtdl, ytdlErr });
    return;
  }

  if (params.has("kvtest")) {
    if (!_HAS_KV) return res.status(200).json({ ok: false, error: "KV env vars tidak ada", hasKv: false });
    try {
      const testKey = "nang:kvtest:" + Date.now();
      const writeRes = await _kvCmd("SET", testKey, "ok", "EX", 60);
      const readRes = await _kvCmd("GET", testKey);
      await _kvCmd("DEL", testKey);
      return res.status(200).json({ ok: true, hasKv: true, write: writeRes, read: readRes, kvUrl: _KV_URL.slice(0, 40) + "..." });
    } catch (e) {
      return res.status(200).json({ ok: false, error: String(e.message), hasKv: true });
    }
  }

  if (params.has("api")) {
    const apiPath = "/api/" + String(params.get("api") || "");
    return await handleApi(req, res, apiPath, method, params, { ADMIN_PW, AUTH_DOMAIN, WA_NUMBER });
  }
  if (path.startsWith("/api/")) {
    return await handleApi(req, res, path, method, params, { ADMIN_PW, AUTH_DOMAIN, WA_NUMBER });
  }

  // ─────────────────────────────────────────────
  // YT → MP3 resolver: ytdl → RapidAPI multi-host → cobalt
  // ─────────────────────────────────────────────
  if (params.has("yt")) {
    const action = String(params.get("yt") || "");

    function _extractVid(u) {
      const m1 = u.match(/[?&]v=([\w-]{11})/);
      const m2 = u.match(/youtu\.be\/([\w-]{11})/);
      const m3 = u.match(/shorts\/([\w-]{11})/);
      const m4 = u.match(/embed\/([\w-]{11})/);
      return (m1 && m1[1]) || (m2 && m2[1]) || (m3 && m3[1]) || (m4 && m4[1]) || "";
    }

    if (action === "resolve" && method === "POST") {
      let raw = "";
      await new Promise(r => { req.on("data", c => raw += c); req.on("end", r); });
      let body = null; try { body = JSON.parse(raw); } catch {}
      const ytUrl = String((body && body.url) || "").trim();
      if (!ytUrl || (!ytUrl.includes("youtube.com") && !ytUrl.includes("youtu.be"))) {
        res.status(200).json({ ok: false, error: "Bukan link YouTube" }); return;
      }
      const vid = _extractVid(ytUrl);
      if (!vid) { res.status(200).json({ ok: false, error: "Video ID tidak dapat diekstrak" }); return; }

      const errors = [];
      const RA_KEY = process.env.RAPIDAPI_KEY;

      // LAYER 1: ytdl-core (langsung ke YouTube)
      try {
        const ytdlMod = await import("@distube/ytdl-core");
        const ytdl = ytdlMod.default || ytdlMod;
        const info = await ytdl.getInfo(ytUrl);
        const audios = info.formats.filter(f => f.hasAudio && !f.hasVideo).sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));
        if (audios.length && audios[0].url) {
          res.status(200).json({ ok: true, direct: audios[0].url, source: "ytdl:" + (audios[0].audioBitrate || "?") + "kbps" });
          return;
        }
        const anyAudio = info.formats.filter(f => f.hasAudio).sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));
        if (anyAudio.length && anyAudio[0].url) {
          res.status(200).json({ ok: true, direct: anyAudio[0].url, source: "ytdl:combined" });
          return;
        }
        errors.push("ytdl: no audio format");
      } catch (e) { errors.push("ytdl: " + String(e.message || e).slice(0, 80)); }

      // LAYER 2: RapidAPI multi-host — cek semua field yang mungkin
      if (RA_KEY) {
        const rapidHosts = [
          { host: "youtube-to-mp315.p.rapidapi.com", method: "POST", path: "/download", body: { url: ytUrl, format: "mp3", quality: 0 }, fields: ["link", "downloadUrl", "url", "mp3"] },
          { host: "youtube-mp36.p.rapidapi.com", method: "GET", path: "/dl?id=" + vid, fields: ["link", "url"] },
          { host: "youtube-mp3-audio-video-downloader.p.rapidapi.com", method: "GET", path: "/youtube?id=" + vid + "&type=audio", fields: ["link", "url"] },
          { host: "youtube-multi-api.p.rapidapi.com", method: "GET", path: "/mp3?url=" + encodeURIComponent(ytUrl), fields: ["link", "downloadUrl", "url"] },
        ];
        for (const rh of rapidHosts) {
          try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 25000);
            const opts = { method: rh.method, headers: { "X-RapidAPI-Key": RA_KEY, "X-RapidAPI-Host": rh.host, "Accept": "application/json" }, signal: ctrl.signal };
            if (rh.body) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(rh.body); }
            const r = await fetch("https://" + rh.host + rh.path, opts);
            clearTimeout(t);
            const txt = await r.text();
            let data; try { data = JSON.parse(txt); } catch { data = { raw: txt.slice(0, 200) }; }

            if (r.ok) {
              // cek di top level
              for (const f of rh.fields) {
                if (data[f] && typeof data[f] === "string" && data[f].startsWith("http")) {
                  res.status(200).json({ ok: true, direct: data[f], source: "rapidapi:" + rh.host, title: data.title || "" });
                  return;
                }
              }
              // cek di data.data
              if (data.data && typeof data.data === "object") {
                for (const f of rh.fields) {
                  if (data.data[f] && typeof data.data[f] === "string" && data.data[f].startsWith("http")) {
                    res.status(200).json({ ok: true, direct: data.data[f], source: "rapidapi:" + rh.host, title: data.data.title || "" });
                    return;
                  }
                }
              }
              // cek di data.result
              if (data.result && typeof data.result === "object") {
                for (const f of rh.fields) {
                  if (data.result[f] && typeof data.result[f] === "string" && data.result[f].startsWith("http")) {
                    res.status(200).json({ ok: true, direct: data.result[f], source: "rapidapi:" + rh.host });
                    return;
                  }
                }
              }
              // kalau status:ok tapi gak ada link yang jelas
              if (data.status === "ok" || data.status === "success") {
                errors.push("rapidapi/" + rh.host + ": status ok tapi link gak ke-detect. Fields: " + Object.keys(data).join(","));
                continue;
              }
            }
            errors.push("rapidapi/" + rh.host + ": " + (data.message || data.error || data.msg || "HTTP " + r.status));
          } catch (e) { errors.push("rapidapi/" + rh.host + ": " + String(e.message || e).slice(0, 60)); }
        }
      } else {
        errors.push("rapidapi: RAPIDAPI_KEY belum di-set");
      }

      // LAYER 3: cobalt best-effort
      const cobaltInstances = ["https://cobalt-api.kwiatekmiki.com", "https://cobalt-api.drgns.space"];
      for (const base of cobaltInstances) {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 10000);
          const r = await fetch(base, {
            method: "POST",
            headers: { "Accept": "application/json", "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
            body: JSON.stringify({ url: ytUrl, downloadMode: "audio", audioFormat: "mp3", audioBitrate: "128", filenameStyle: "basic" }),
            signal: ctrl.signal,
          });
          clearTimeout(t);
          let data; try { data = JSON.parse(await r.text()); } catch { data = {}; }
          if (r.ok && data.url) { res.status(200).json({ ok: true, direct: data.url, source: "cobalt" }); return; }
          errors.push("cobalt/" + base.replace(/https?:\/\//, "") + ": " + (data.text || "HTTP " + r.status));
        } catch (e) { errors.push("cobalt/" + base.replace(/https?:\/\//, "") + ": " + String(e.message || e).slice(0, 40)); }
      }

      res.status(200).json({ ok: false, error: "Semua endpoint gagal.", detail: errors.slice(0, 10) });
      return;
    }

    if (action === "debug" && method === "GET") {
      const ytUrl = String(params.get("url") || "").trim();
      const vid = _extractVid(ytUrl);
      const out = { vid, ytdl: null, rapidapi: {} };
      try {
        const ytdlMod = await import("@distube/ytdl-core");
        const ytdl = ytdlMod.default || ytdlMod;
        const info = await ytdl.getInfo(ytUrl);
        out.ytdl = { ok: true, title: info.videoDetails.title, audioFormats: info.formats.filter(f => f.hasAudio).length };
      } catch (e) { out.ytdl = { ok: false, error: String(e.message || e).slice(0, 150) }; }
      const RA_KEY = process.env.RAPIDAPI_KEY;
      const rapidHosts = [
        { host: "youtube-to-mp315.p.rapidapi.com", method: "POST", path: "/download", body: { url: ytUrl, format: "mp3", quality: 0 } },
        { host: "youtube-mp36.p.rapidapi.com", method: "GET", path: "/dl?id=" + vid },
      ];
      for (const rh of rapidHosts) {
        if (!RA_KEY) { out.rapidapi[rh.host] = { error: "no RAPIDAPI_KEY" }; continue; }
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 15000);
          const opts = { method: rh.method, headers: { "X-RapidAPI-Key": RA_KEY, "X-RapidAPI-Host": rh.host }, signal: ctrl.signal };
          if (rh.body) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(rh.body); }
          const r = await fetch("https://" + rh.host + rh.path, opts);
          clearTimeout(t);
          out.rapidapi[rh.host] = { status: r.status, body: (await r.text()).slice(0, 400) };
        } catch (e) { out.rapidapi[rh.host] = { error: String(e.message || e).slice(0, 120) }; }
      }
      res.status(200).json({ ok: true, debug: out });
      return;
    }

    res.status(200).json({ ok: false, error: "unknown yt action" });
    return;
  }

  if (method === "POST") {
    let body = "";
    await new Promise(r => { req.on("data", c => body += c); req.on("end", r); });
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.status(400).json({ valid: false, error: "bad json" }); return; }
    const valid = _verifyKey(parsed.uid, parsed.key).valid;
    let username = null, role = "member", generatedBy = null;
    if (valid) {
      username = await _getRobloxUser(parsed.uid);
      const kr = await _getKeyRole(parsed.uid, parsed.key);
      if (kr) { role = kr.role || "member"; generatedBy = kr.by || null; }
      sendWebhook([
        { name: "Event", value: "Key Verified", inline: false },
        { name: "Username", value: String(username || "Unknown"), inline: true },
        { name: "User ID", value: String(parsed.uid), inline: true },
        { name: "Role", value: role, inline: true },
        { name: "Remaining", value: _expiryStr(parsed.uid, parsed.key), inline: true },
        { name: "IP", value: _getClientIP(req), inline: true },
      ]);
    }
    res.status(200).json({ valid, role, generatedBy, username, expires: valid ? _expiryStr(parsed.uid, parsed.key) : null });
    return;
  }

  if (path === "/auth" || path === "/auth/") {
    const d = params.get("d");
    if (!d) { res.status(400).send("Missing data"); return; }
    let data;
    try { data = JSON.parse(b64urlDecode(d)); } catch { res.status(400).send("Invalid link"); return; }
    if (!data.u || !data.k) { res.status(400).send("Invalid data"); return; }
    const valid = _verifyKey(data.u, data.k).valid;
    const name = data.n || await _getRobloxUser(data.u);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(authPage(data, valid, name));
    return;
  }

  if (params.has("uid") && params.has("key")) {
    const uid = params.get("uid");
    const key = params.get("key");
    const valid = _verifyKey(uid, key).valid;
    let username = null, role = "member";
    if (valid) {
      username = await _getRobloxUser(uid);
      const kr = await _getKeyRole(uid, key);
      if (kr) role = kr.role || "member";
    }
    res.status(200).json({ valid, role, expires: valid ? _expiryStr(uid, key) : null, username });
    return;
  }

  if (params.has("lookup")) {
    const name = await _getRobloxUser(params.get("lookup"));
    res.status(200).json({ uid: params.get("lookup"), name });
    return;
  }

  if (params.has("log")) {
    const event = String(params.get("log") || "").slice(0, 64);
    const user = String(params.get("user") || "anon").slice(0, 32);
    const uid = String(params.get("uid") || "").slice(0, 20);
    const exec = String(params.get("exec") || "Unknown").slice(0, 32);
    const gameName = String(params.get("game") || "Unknown").slice(0, 64);
    const placeId = String(params.get("place") || "0").slice(0, 20);
    const jobId = String(params.get("job") || "").slice(0, 40);
    sendWebhook([
      { name: "Event", value: event, inline: false },
      { name: "Username", value: user, inline: true },
      { name: "User ID", value: uid, inline: true },
      { name: "Executor", value: exec, inline: true },
      { name: "Game", value: gameName, inline: true },
      { name: "Place ID", value: placeId, inline: true },
      { name: "Job ID", value: jobId.slice(0, 8), inline: true },
      { name: "IP", value: _getClientIP(req), inline: true },
    ]);
    res.status(200).json({ ok: true });
    return;
  }

  if (params.has("chat")) {
    const action = String(params.get("chat") || "");
    if (action === "send") {
      const user = String(params.get("user") || "anon").slice(0, 32);
      const uid = String(params.get("uid") || "").slice(0, 20);
      const text = String(params.get("text") || "").slice(0, 500);
      if (!text) { res.status(200).json({ ok: false, error: "empty" }); return; }
      const list = (await storeGet("nang:chat")) || [];
      list.unshift({ user, uid, text, ts: Date.now() });
      if (list.length > 200) list.length = 200;
      await storeSet("nang:chat", list, 86400);
      res.status(200).json({ ok: true });
      return;
    }
    if (action === "get") {
      const since = parseInt(params.get("since") || "0", 10) || 0;
      const list = (await storeGet("nang:chat")) || [];
      const msgs = list.filter(m => (m.ts || 0) > since).slice().reverse();
      res.status(200).json({ ok: true, msgs });
      return;
    }
    res.status(200).json({ ok: false, error: "unknown chat action" });
    return;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(mainPage(WA_NUMBER));
}

function _flatRobloxErrors(data) {
  if (!data) return "unknown";
  if (typeof data === "string") return data;
  const parts = [];
  if (data.message) parts.push(String(data.message));
  if (data.error && typeof data.error === "string") parts.push(data.error);
  if (Array.isArray(data.errors)) { for (const e of data.errors) parts.push(typeof e === "string" ? e : (e.message || JSON.stringify(e))); }
  for (const k of Object.keys(data)) {
    if (k === "message" || k === "error" || k === "errors" || k === "raw") continue;
    const v = data[k];
    if (Array.isArray(v)) parts.push(k + ": " + v.join(", "));
    else if (typeof v === "string") parts.push(k + ": " + v);
    else if (v && typeof v === "object") parts.push(k + ": " + JSON.stringify(v));
  }
  if (data.raw) parts.push(String(data.raw).slice(0, 300));
  return parts.length ? parts.join(" · ") : JSON.stringify(data).slice(0, 300);
}

function _readRawBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => resolve(null));
  });
}

async function _robloxUploadDirect({ apiKey, userId, groupId, buffer, fileName, assetType, displayName, description }) {
  const ext = fileName.toLowerCase().split(".").pop();
  const MIME_MAP = {
    rbxm: "model/x-rbxm", rbxmx: "model/x-rbxm",
    mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", flac: "audio/flac",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    bmp: "image/bmp", tga: "image/x-tga"
  };
  const mime = MIME_MAP[ext] || "application/octet-stream";
  const creator = groupId ? { groupId: Number(groupId) } : { userId: Number(userId) };
  const form = new FormData();
  form.append("request", JSON.stringify({
    assetType: assetType || "Model",
    displayName: String(displayName).slice(0, 50),
    description: String(description).slice(0, 1000),
    creationContext: { creator }
  }));
  const blob = new Blob([new Uint8Array(buffer)], { type: mime });
  form.append("fileContent", blob, fileName);
  const r = await fetch("https://apis.roblox.com/assets/v1/assets", { method: "POST", headers: { "x-api-key": apiKey }, body: form });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!r.ok) {
    let msg;
    if (r.status === 401) msg = "API key tidak valid / expired";
    else if (r.status === 403) msg = groupId ? "Forbidden — cek: key punya akses grup? akun udah masuk grup & punya role cukup?" : "Forbidden — cek permission/key/userId/creator status";
    else if (r.status === 429) msg = "Rate limit Roblox";
    else if (r.status === 413) msg = "File terlalu besar untuk Roblox";
    else if (r.status === 400 || r.status === 415 || r.status === 422) msg = "Data ditolak Roblox: " + _flatRobloxErrors(data);
    else msg = data.message || data.error || _flatRobloxErrors(data) || ("HTTP " + r.status);
    return { ok: false, error: "[" + r.status + "] " + msg, status: r.status };
  }
  const operationId = data.operationId || (data.path && String(data.path).split("/").pop());
  if (!operationId) return { ok: false, error: "Tidak dapat operationId" };
  return { ok: true, operationId };
}

async function handleRawUpload(req, res) {
  res.setHeader("Content-Type", "application/json");
  const apiKey = String(req.headers["x-nang-apikey"] || "").trim();
  const userId = String(req.headers["x-nang-userid"] || "").trim();
  const groupId = String(req.headers["x-nang-groupid"] || "").trim();
  const fileName = String(req.headers["x-nang-filename"] || "file.bin").slice(0, 128);
  const displayName = String(req.headers["x-nang-display"] || "Asset").slice(0, 50);
  const description = String(req.headers["x-nang-desc"] || "").slice(0, 1000);
  const assetType = String(req.headers["x-nang-assettype"] || "Model").trim();
  if (!apiKey) return res.status(200).json({ ok: false, error: "API key kosong" });
  if (groupId) { if (!/^\d+$/.test(groupId)) return res.status(200).json({ ok: false, error: "groupId invalid" }); }
  else { if (!userId || !/^\d+$/.test(userId)) return res.status(200).json({ ok: false, error: "userId invalid" }); }
  const buffer = await _readRawBody(req);
  if (!buffer) return res.status(200).json({ ok: false, error: "Gagal baca body" });
  if (!buffer.length) return res.status(200).json({ ok: false, error: "File kosong" });
  const ext = fileName.toLowerCase().split(".").pop();
  let allowed;
  if (assetType === "Audio") allowed = ["mp3","ogg","wav","flac"];
  else if (assetType === "Decal") allowed = ["png","jpg","jpeg","bmp","tga"];
  else allowed = ["rbxm","rbxmx"];
  if (!allowed.includes(ext)) {
    const errMsg = assetType === "Audio" ? "Audio harus .mp3/.ogg/.wav/.flac" : assetType === "Decal" ? "Gambar harus .png/.jpg/.jpeg/.bmp/.tga" : "Model harus .rbxm/.rbxmx";
    return res.status(200).json({ ok: false, error: errMsg });
  }
  const result = await _robloxUploadDirect({ apiKey, userId, groupId, buffer, fileName, assetType, displayName, description });
  if (!result.ok) return res.status(200).json({ ok: false, error: result.error, debug: { fileName, size: buffer.length, userId, groupId: groupId || null, status: result.status, assetType } });
  return res.status(200).json({ ok: true, operationId: result.operationId, groupId: groupId || null });
}

async function handleApi(req, res, path, method, params, ctx) {
  const { ADMIN_PW } = ctx;
  const route = path.replace(/^\/api\//, "").replace(/\/$/, "");

  if (route === "upload-rbxm-raw" && method === "POST") return await handleRawUpload(req, res);

  if (route === "convert-to-model" && method === "POST") {
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json({ ok: false, error: "Converter otomatis gak aktif di server ini", hint: "Pakai Roblox Studio:\n\n1. Buka file RBXL di Roblox Studio\n2. Ctrl+A di Explorer\n3. Klik kanan → Save to File → .rbxm\n" });
  }

  if (route === "upload-chunk" && method === "POST") {
    res.setHeader("Content-Type", "application/json");
    const sid = String(params.get("sid") || "").trim();
    const idx = parseInt(params.get("idx") || "-1", 10);
    const total = parseInt(params.get("total") || "0", 10);
    const fileName = String(params.get("fn") || "file.bin").slice(0, 128);
    const assetType = String(params.get("at") || "Model");
    const groupId = String(params.get("gid") || "").trim();
    if (!sid || sid.length > 64 || !/^[a-f0-9]+$/i.test(sid)) return res.status(200).json({ ok: false, error: "sid invalid" });
    if (isNaN(idx) || idx < 0 || idx >= 200) return res.status(200).json({ ok: false, error: "idx invalid" });
    if (isNaN(total) || total < 1 || total > 200) return res.status(200).json({ ok: false, error: "total invalid" });
    if (groupId && !/^\d+$/.test(groupId)) return res.status(200).json({ ok: false, error: "groupId invalid" });
    const buffer = await _readRawBody(req);
    if (!buffer || !buffer.length) return res.status(200).json({ ok: false, error: "chunk kosong" });
    const b64 = buffer.toString("base64");
    const ok1 = await storeSet("nang:up:" + sid + ":" + String(idx).padStart(4, "0"), b64, 900);
    if (idx === 0) await storeSet("nang:up:" + sid + ":meta", { total, fileName, assetType, groupId: groupId || null, ts: Date.now() }, 900);
    return res.status(200).json({ ok: ok1, idx, bytes: buffer.length });
  }

  if (route === "upload-commit" && method === "POST") {
    let raw = "";
    await new Promise(r => { req.on("data", c => raw += c); req.on("end", r); });
    let body = null; try { body = JSON.parse(raw); } catch { body = null; }
    const sid = String((body && body.sid) || "").trim();
    const apiKey = String((body && body.apiKey) || "").trim();
    const userId = String((body && body.userId) || "").trim();
    const groupId = String((body && body.groupId) || "").trim();
    const displayName = String((body && body.displayName) || "Asset").slice(0, 50);
    const description = String((body && body.description) || "").slice(0, 1000);
    if (!sid || !apiKey) return res.status(200).json({ ok: false, error: "data kurang" });
    if (groupId) { if (!/^\d+$/.test(groupId)) return res.status(200).json({ ok: false, error: "groupId invalid" }); }
    else { if (!userId || !/^\d+$/.test(userId)) return res.status(200).json({ ok: false, error: "userId invalid" }); }
    const meta = await storeGet("nang:up:" + sid + ":meta");
    if (!meta || !meta.total) return res.status(200).json({ ok: false, error: "Session tidak ditemukan / kadaluarsa" });
    const finalGroupId = groupId || meta.groupId || null;
    const buffers = [];
    for (let i = 0; i < meta.total; i++) {
      const key = "nang:up:" + sid + ":" + String(i).padStart(4, "0");
      const b64 = await storeGet(key);
      if (typeof b64 !== "string" || !b64.length) return res.status(200).json({ ok: false, error: "Bagian " + (i + 1) + " dari " + meta.total + " hilang" });
      buffers.push(Buffer.from(b64, "base64"));
    }
    const fullBuffer = Buffer.concat(buffers);
    for (let i = 0; i < meta.total; i++) storeDel("nang:up:" + sid + ":" + String(i).padStart(4, "0")).catch(() => {});
    storeDel("nang:up:" + sid + ":meta").catch(() => {});
    const result = await _robloxUploadDirect({ apiKey, userId, groupId: finalGroupId, buffer: fullBuffer, fileName: meta.fileName, assetType: meta.assetType, displayName, description });
    if (!result.ok) return res.status(200).json({ ok: false, error: result.error });
    return res.status(200).json({ ok: true, operationId: result.operationId, size: fullBuffer.length, groupId: finalGroupId });
  }

  let body = null;
  if (method === "POST") {
    let raw = "";
    await new Promise(r => { req.on("data", c => raw += c); req.on("end", r); });
    if (raw) { try { body = JSON.parse(raw); } catch { body = null; } }
  }

  res.setHeader("Content-Type", "application/json");

  async function authFromToken() {
    const token = (body && body.token) || params.get("token");
    if (!token) return null;
    const mem = _memStore["nang:sess:" + token];
    if (mem && mem.expiresAt > Date.now()) { const u = await getUser(mem.username); if (u && u.role !== "banned") return u; }
    const sess = await storeGet("nang:sess:" + token);
    if (!sess) return null;
    if (!sess.expiresAt || sess.expiresAt < Date.now()) { await storeDel("nang:sess:" + token); return null; }
    const u = await getUser(sess.username);
    if (!u || u.role === "banned") return null;
    return u;
  }

  async function getOwnerRole(pw, ot) {
    if (pw === ADMIN_PW) return "owner";
    if (ot) {
      const memSess = _memStore["nang:owner_token:" + ot];
      if (memSess && memSess.expiresAt > Date.now()) return memSess.role || "owner";
      const sess = await storeGet("nang:owner_token:" + ot);
      if (sess && sess.expiresAt > Date.now()) return sess.role || "owner";
    }
    return null;
  }

  if (route === "owner/verify" && method === "POST") {
    const pw = body && body.pw;
    if (pw === ADMIN_PW) {
      const token = randomHex(24);
      const expires = Date.now() + SESSION_MS;
      const payload = { expiresAt: expires, role: "owner" };
      _memStore["nang:owner_token:" + token] = payload;
      storeSet("nang:owner_token:" + token, payload, Math.floor(SESSION_MS / 1000)).catch(() => {});
      return res.status(200).json({ ok: true, token, role: "owner" });
    }
    return res.status(200).json({ ok: false, error: "password salah" });
  }

  if (route === "owner/generate" && method === "POST") {
    const reqRole = await getOwnerRole(body && body.pw, body && body.ot);
    if (!reqRole || (reqRole !== "owner" && reqRole !== "admin")) return res.status(200).json({ error: "forbidden" });
    const uid = String((body && body.uid) || "").trim();
    if (!uid || !/^\d+$/.test(uid)) return res.status(200).json({ error: "User ID tidak valid" });
    const key = _makeKey(uid);
    await _saveKeyRole(uid, key, "owner", "owner");
    const name = await _getRobloxUser(uid);
    return res.status(200).json({ ok: true, key, role: "owner", expires: _expiryStr(uid, key), username: name });
  }

  if ((route === "lookup-user" || route === "lookup-username") && method === "POST") {
    const q = String((body && (body.query || body.username || body.userId)) || "").trim();
    if (!q) return res.status(200).json({ ok: false, error: "kosong" });
    if (/^\d+$/.test(q)) {
      try {
        const r = await fetch("https://users.roblox.com/v1/users/" + q);
        if (!r.ok) return res.status(200).json({ ok: false, error: "User ID tidak ditemukan" });
        const d = await r.json();
        return res.status(200).json({ ok: true, userId: d.id, name: d.name, displayName: d.displayName || d.name });
      } catch (e) { return res.status(200).json({ ok: false, error: String(e.message || e) }); }
    }
    try {
      const tryLookup = async (exclude) => {
        const r = await fetch("https://users.roblox.com/v1/usernames/users", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ usernames: [q], excludeBannedUsers: exclude }),
        });
        const d = await r.json();
        return d && d.data && d.data[0] ? d.data[0] : null;
      };
      let hit = await tryLookup(false);
      if (!hit) hit = await tryLookup(true);
      if (!hit) return res.status(200).json({ ok: false, error: "Username tidak ditemukan" });
      return res.status(200).json({ ok: true, userId: hit.id, name: hit.name, displayName: hit.displayName || hit.name });
    } catch (e) { return res.status(200).json({ ok: false, error: String(e.message || e) }); }
  }

  if (route === "lookup-group" && method === "POST") {
    const gid = String((body && body.groupId) || "").trim();
    if (!gid || !/^\d+$/.test(gid)) return res.status(200).json({ ok: false, error: "Group ID tidak valid" });
    try {
      const r = await fetch("https://groups.roblox.com/v1/groups/" + gid);
      if (!r.ok) return res.status(200).json({ ok: false, error: "Grup tidak ditemukan" });
      const d = await r.json();
      return res.status(200).json({ ok: true, groupId: d.id, name: d.name, memberCount: d.memberCount, owner: d.owner && d.owner.username });
    } catch (e) { return res.status(200).json({ ok: false, error: String(e.message || e) }); }
  }

  if (route === "verify-apikey" && method === "POST") {
    const apiKey = String((body && body.apiKey) || "").trim();
    if (!apiKey) return res.status(200).json({ ok: false, error: "API key kosong" });
    if (apiKey.length < 20) return res.status(200).json({ ok: false, error: "Format API key tidak valid (terlalu pendek)" });
    try {
      const r = await fetch("https://apis.roblox.com/assets/v1/assets", { method: "POST", headers: { "x-api-key": apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ __nang_probe: true }) });
      if (r.status === 401) return res.status(200).json({ ok: false, error: "API key tidak valid / sudah expired" });
      if (r.status === 403) return res.status(200).json({ ok: false, error: "API key valid, tapi tidak punya permission Assets API (Write)" });
      if (r.status === 429) return res.status(200).json({ ok: false, error: "Rate limit — coba lagi sebentar" });
      return res.status(200).json({ ok: true, status: r.status });
    } catch (e) { return res.status(200).json({ ok: false, error: "Gagal cek API key: " + String(e.message || e) }); }
  }

  if (route === "upload-status" && method === "GET") {
    const operationId = params.get("id");
    const apiKey = params.get("k");
    if (!operationId || !apiKey) return res.status(200).json({ ok: false, error: "missing" });
    try {
      const r = await fetch("https://apis.roblox.com/assets/v1/operations/" + encodeURIComponent(operationId), { method: "GET", headers: { "x-api-key": apiKey } });
      const data = await r.json();
      if (data.done) {
        if (data.error) return res.status(200).json({ ok: true, done: true, error: data.error.message || "Upload gagal" });
        return res.status(200).json({ ok: true, done: true, assetId: data.response && data.response.assetId });
      }
      return res.status(200).json({ ok: true, done: false });
    } catch (e) { return res.status(200).json({ ok: false, error: String(e.message || e) }); }
  }

  if (route === "moderation-status" && method === "GET") {
    const assetId = String(params.get("id") || "").trim();
    const apiKey = String(params.get("k") || "").trim();
    if (!assetId || !/^\d+$/.test(assetId)) return res.status(200).json({ ok: false, error: "assetId invalid" });
    if (!apiKey) return res.status(200).json({ ok: false, error: "apiKey kosong" });
    try {
      const r = await fetch("https://apis.roblox.com/assets/v1/assets/" + encodeURIComponent(assetId), { method: "GET", headers: { "x-api-key": apiKey } });
      const text = await r.text();
      let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
      if (r.status === 401) return res.status(200).json({ ok: false, error: "API key invalid/expired", code: 401 });
      if (r.status === 403) return res.status(200).json({ ok: false, error: "Forbidden", code: 403 });
      if (r.status === 404) return res.status(200).json({ ok: false, error: "Asset belum kebaca (delay)", code: 404 });
      if (!r.ok) return res.status(200).json({ ok: false, error: "HTTP " + r.status, code: r.status });
      const mod = data.moderationResult || data.moderation || (data.asset && data.asset.moderationResult) || null;
      let state = "Unknown", reason = null;
      if (mod) { state = mod.state || mod.moderationState || mod.status || "Unknown"; reason = (mod.moderationDetails && (mod.moderationDetails.message || mod.moderationDetails.reason)) || mod.reason || mod.message || null; }
      else if (data.assetState) state = data.assetState;
      const normalized = String(state).toLowerCase();
      let level = "pending";
      if (normalized.includes("approv")) level = "approved";
      else if (normalized.includes("reject")) level = "rejected";
      return res.status(200).json({ ok: true, assetId, state, level, reason });
    } catch (e) { return res.status(200).json({ ok: false, error: String(e.message || e) }); }
  }

  if (route === "free/list" && method === "GET") {
    const u = await authFromToken();
    if (!u) return res.status(200).json({ error: "not logged in" });
    const ids = (await storeGet("nang:freelist")) || [];
    const items = [];
    for (const id of ids) {
      const m = await storeGet("nang:free:" + id);
      if (m) items.push({ id: m.id, name: m.name, desc: m.desc, author: m.author, size: m.size, ext: m.ext, ts: m.ts, downloads: m.downloads || 0 });
    }
    items.sort((a,b) => (b.ts||0) - (a.ts||0));
    return res.status(200).json({ ok: true, items });
  }

  if (route === "free/upload" && method === "POST") {
    const u = await authFromToken();
    if (!u) return res.status(200).json({ error: "not logged in" });
    const name = String((body && body.name) || "").trim().slice(0, 60);
    const desc = String((body && body.desc) || "").trim().slice(0, 300);
    const ext  = String((body && body.ext)  || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
    const fileB64 = String((body && body.file) || "");
    if (!name) return res.status(200).json({ error: "Nama kosong" });
    if (!fileB64) return res.status(200).json({ error: "File kosong" });
    const allowedExt = ["rbxm","rbxmx","rbxl","rbxlx","lua","txt","zip"];
    if (!allowedExt.includes(ext)) return res.status(200).json({ error: "Ekstensi tidak didukung" });
    const size = Math.floor(fileB64.length * 0.75);
    if (size > MAX_FREE_SIZE) return res.status(200).json({ error: "File > " + (MAX_FREE_SIZE/1024/1024) + " MB" });
    const id = randomHex(8);
    await storeSet("nang:free:" + id, { id, name, desc, ext, size, author: u.username, ts: Date.now(), downloads: 0, file: fileB64 });
    const list = (await storeGet("nang:freelist")) || [];
    list.unshift(id); if (list.length > 200) list.length = 200;
    await storeSet("nang:freelist", list);
    return res.status(200).json({ ok: true, id });
  }

  if (route === "free/upload-chunk" && method === "POST") {
    const u = await authFromToken();
    if (!u) return res.status(200).json({ error: "not logged in" });
    const sid = String(params.get("sid") || "").trim();
    const idx = parseInt(params.get("idx") || "-1", 10);
    const total = parseInt(params.get("total") || "0", 10);
    const name = String(params.get("name") || "").trim().slice(0, 60);
    const desc = String(params.get("desc") || "").trim().slice(0, 300);
    const ext  = String(params.get("ext") || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
    if (!sid || !/^[a-f0-9]+$/i.test(sid)) return res.status(200).json({ ok: false, error: "sid invalid" });
    if (isNaN(idx) || idx < 0 || idx >= 500) return res.status(200).json({ ok: false, error: "idx invalid" });
    if (isNaN(total) || total < 1 || total > 500) return res.status(200).json({ ok: false, error: "total invalid" });
    const buffer = await _readRawBody(req);
    if (!buffer || !buffer.length) return res.status(200).json({ ok: false, error: "chunk kosong" });
    const b64 = buffer.toString("base64");
    const ok1 = await storeSet("nang:fmchunk:" + sid + ":" + String(idx).padStart(4, "0"), b64, 1800);
    if (idx === 0) await storeSet("nang:fmchunk:" + sid + ":meta", { total, name, desc, ext, ts: Date.now(), author: u.username }, 1800);
    return res.status(200).json({ ok: ok1, idx, bytes: buffer.length });
  }

  if (route === "free/upload-commit" && method === "POST") {
    const u = await authFromToken();
    if (!u) return res.status(200).json({ error: "not logged in" });
    const sid = String((body && body.sid) || "").trim();
    if (!sid) return res.status(200).json({ error: "sid kosong" });
    const meta = await storeGet("nang:fmchunk:" + sid + ":meta");
    if (!meta || !meta.total) return res.status(200).json({ error: "Session kadaluarsa" });
    if (meta.author !== u.username) return res.status(200).json({ error: "bukan uploader" });
    const buffers = [];
    for (let i = 0; i < meta.total; i++) {
      const b64 = await storeGet("nang:fmchunk:" + sid + ":" + String(i).padStart(4, "0"));
      if (typeof b64 !== "string" || !b64.length) return res.status(200).json({ error: "Bagian " + (i+1) + " hilang" });
      buffers.push(Buffer.from(b64, "base64"));
    }
    const fullBuffer = Buffer.concat(buffers);
    if (fullBuffer.length > MAX_FREE_SIZE) return res.status(200).json({ error: "File > " + (MAX_FREE_SIZE/1024/1024) + " MB" });
    const allowedExt = ["rbxm","rbxmx","rbxl","rbxlx","lua","txt","zip"];
    if (!allowedExt.includes(meta.ext)) return res.status(200).json({ error: "Ekstensi tidak didukung" });
    const fileB64 = fullBuffer.toString("base64");
    const id = randomHex(8);
    await storeSet("nang:free:" + id, { id, name: meta.name, desc: meta.desc, ext: meta.ext, size: fullBuffer.length, author: u.username, ts: Date.now(), downloads: 0, file: fileB64 });
    const list = (await storeGet("nang:freelist")) || [];
    list.unshift(id); if (list.length > 200) list.length = 200;
    await storeSet("nang:freelist", list);
    for (let i = 0; i < meta.total; i++) storeDel("nang:fmchunk:" + sid + ":" + String(i).padStart(4, "0")).catch(() => {});
    storeDel("nang:fmchunk:" + sid + ":meta").catch(() => {});
    return res.status(200).json({ ok: true, id });
  }

  if (route === "free/download" && method === "GET") {
    const u = await authFromToken();
    if (!u) return res.status(200).json({ error: "not logged in" });
    const id = String(params.get("id") || "").trim();
    if (!id || !/^[a-f0-9]+$/i.test(id)) return res.status(200).json({ error: "id invalid" });
    const m = await storeGet("nang:free:" + id);
    if (!m || !m.file) return res.status(200).json({ error: "tidak ditemukan" });
    m.downloads = (m.downloads || 0) + 1;
    storeSet("nang:free:" + id, m).catch(() => {});
    return res.status(200).json({ ok: true, name: m.name, ext: m.ext, file: m.file });
  }

  if (route === "free/delete" && method === "POST") {
    const u = await authFromToken();
    if (!u) return res.status(200).json({ error: "not logged in" });
    const id = String((body && body.id) || "").trim();
    const m = await storeGet("nang:free:" + id);
    if (!m) return res.status(200).json({ error: "tidak ditemukan" });
    const canDel = u.role === "owner" || u.role === "admin" || m.author === u.username;
    if (!canDel) return res.status(200).json({ error: "forbidden" });
    await storeDel("nang:free:" + id);
    const list = (await storeGet("nang:freelist")) || [];
    const idx = list.indexOf(id);
    if (idx >= 0) { list.splice(idx, 1); await storeSet("nang:freelist", list); }
    return res.status(200).json({ ok: true });
  }

  if (route === "profile/change-password" && method === "POST") {
    const u = await authFromToken();
    if (!u) return res.status(200).json({ error: "not logged in" });
    const current = String((body && body.current) || "");
    const newPw = String((body && body.newPw) || "");
    if (newPw.length < 5) return res.status(200).json({ error: "Password baru minimal 5 karakter" });
    if (u.passwordHash !== hashPw(current, u.salt)) return res.status(200).json({ error: "Password lama salah" });
    const salt = randomHex(8);
    u.salt = salt; u.passwordHash = hashPw(newPw, salt);
    await saveUser(u);
    return res.status(200).json({ ok: true, message: "Password berhasil diganti" });
  }

  if (route === "profile/change-email" && method === "POST") {
    const u = await authFromToken();
    if (!u) return res.status(200).json({ error: "not logged in" });
    const password = String((body && body.password) || "");
    const newEmail = String((body && body.newEmail) || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return res.status(200).json({ error: "Format email tidak valid" });
    if (u.passwordHash !== hashPw(password, u.salt)) return res.status(200).json({ error: "Password salah" });
    const existing = await storeGet("nang:email:" + newEmail);
    if (existing && existing !== u.username) return res.status(200).json({ error: "Email sudah dipakai user lain" });
    if (u.email && u.email.toLowerCase() !== newEmail) await storeDel("nang:email:" + u.email.toLowerCase());
    u.email = newEmail; await saveUser(u);
    await storeSet("nang:email:" + newEmail, u.username);
    return res.status(200).json({ ok: true, message: "Email berhasil diganti" });
  }

  if (route === "reseller/register" && method === "POST") {
    const username = String((body && body.username) || "").trim();
    const email = String((body && body.email) || "").trim().toLowerCase();
    const password = String((body && body.password) || "");
    if (username.length < 3) return res.status(200).json({ error: "Username minimal 3 karakter" });
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(200).json({ error: "Username hanya huruf/angka/underscore" });
    if (!email) return res.status(200).json({ error: "Email wajib diisi" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(200).json({ error: "Format email tidak valid" });
    if (password.length < 5) return res.status(200).json({ error: "Password minimal 5 karakter" });
    const exist = await getUser(username);
    if (exist) return res.status(200).json({ error: "Username sudah dipakai" });
    const emailKey = "nang:email:" + email;
    const emailExist = await storeGet(emailKey);
    if (emailExist) return res.status(200).json({ error: "Email sudah terdaftar" });
    const salt = randomHex(8);
    const isAutoOwner = OWNER_EMAILS.includes(email) || OWNER_USERNAMES.includes(username.toLowerCase());
    const user = {
      username, email, passwordHash: hashPw(password, salt), salt,
      role: isAutoOwner ? "owner" : "member",
      quota: isAutoOwner ? 9999 : DEFAULT_QUOTA,
      keysToday: 0, lastReset: Date.now(), createdAt: Date.now(), keys: [],
      store: { price: 500, wa: "", dana: "", name: username, active: false, qr: "" },
    };
    await saveUser(user); await storeSet(emailKey, username);
    return res.status(200).json({ ok: true, message: isAutoOwner ? "Terdaftar sebagai OWNER." : "Terdaftar sebagai member.", role: user.role });
  }

  if (route === "reseller/login" && method === "POST") {
    const identifier = String((body && (body.identifier || body.username)) || "").trim();
    const password = String((body && body.password) || "");
    if (!identifier) return res.status(200).json({ error: "Username / email kosong" });
    let user = await getUser(identifier);
    if (!user) {
      const emailKey = "nang:email:" + identifier.toLowerCase();
      const usernameFromEmail = await storeGet(emailKey);
      if (usernameFromEmail) user = await getUser(usernameFromEmail);
    }
    if (!user) return res.status(200).json({ error: "Akun tidak ditemukan" });
    if (user.role === "banned") return res.status(200).json({ error: "Akun di-ban" });
    if (user.passwordHash !== hashPw(password, user.salt)) return res.status(200).json({ error: "Password salah" });
    const token = randomHex(32);
    const expires = Date.now() + SESSION_MS;
    const sessData = { username: user.username, expiresAt: expires };
    _memStore["nang:sess:" + token] = sessData;
    storeSet("nang:sess:" + token, sessData, Math.floor(SESSION_MS / 1000)).catch(() => {});
    return res.status(200).json({ ok: true, token, noKv: !_HAS_KV, user: { username: user.username, role: user.role, quota: user.quota, keysToday: user.keysToday } });
  }

  if (route === "reseller/me") {
    const u = await authFromToken();
    if (!u) return res.status(200).json({ error: "not logged in" });
    if (Date.now() - u.lastReset > 24 * 3600 * 1000) { u.keysToday = 0; u.lastReset = Date.now(); await saveUser(u); }
    return res.status(200).json({ ok: true, user: { username: u.username, email: u.email || null, role: u.role, quota: u.quota, keysToday: u.keysToday, keys: u.keys || [], createdAt: u.createdAt, store: u.store || { ...DEFAULT_STORE } } });
  }

  if (route === "reseller/refresh" && method === "POST") {
    const u = await authFromToken();
    if (!u) return res.status(200).json({ error: "not logged in" });
    const token = randomHex(32);
    const expires = Date.now() + SESSION_MS;
    const sessData = { username: u.username, expiresAt: expires };
    _memStore["nang:sess:" + token] = sessData;
    await storeSet("nang:sess:" + token, sessData, Math.floor(SESSION_MS / 1000));
    const oldToken = (body && body.token) || params.get("token");
    if (oldToken && oldToken !== token) { delete _memStore["nang:sess:" + oldToken]; storeDel("nang:sess:" + oldToken).catch(() => {}); }
    return res.status(200).json({ ok: true, token });
  }

  if (route === "reseller/logout" && method === "POST") {
    const token = (body && body.token) || params.get("token");
    if (token) { delete _memStore["nang:sess:" + token]; await storeDel("nang:sess:" + token); }
    return res.status(200).json({ ok: true });
  }

  if (route === "reseller/generate" && method === "POST") {
    const u = await authFromToken();
    if (!u) return res.status(200).json({ error: "not logged in" });
    const canGenerate = u.role === "reseller" || u.role === "admin" || u.role === "owner";
    if (!canGenerate) return res.status(200).json({ error: "Role belum bisa generate." });
    if (Date.now() - u.lastReset > 24 * 3600 * 1000) { u.keysToday = 0; u.lastReset = Date.now(); }
    if (u.role === "reseller" && u.keysToday >= u.quota) return res.status(200).json({ error: "Kuota harian habis (" + u.quota + ")" });
    const uid = String((body && body.uid) || "").trim();
    if (!uid || !/^\d+$/.test(uid)) return res.status(200).json({ error: "Roblox User ID tidak valid" });
    const key = _makeKey(uid);
    await _saveKeyRole(uid, key, u.role, u.username);
    const name = await _getRobloxUser(uid);
    u.keysToday = (u.keysToday || 0) + 1;
    u.keys = u.keys || [];
    u.keys.unshift({ uid, key, name: name || "Unknown", ts: Date.now(), by: u.username });
    if (u.keys.length > 100) u.keys = u.keys.slice(0, 100);
    await saveUser(u);
    return res.status(200).json({ ok: true, key, role: u.role, expires: _expiryStr(uid, key), username: name, remaining: u.role === "reseller" ? (u.quota - u.keysToday) : "unlimited" });
  }

  if (route === "reseller/store" && method === "GET") {
    const u = await authFromToken();
    if (!u) return res.status(200).json({ error: "not logged in" });
    const can = u.role === "reseller" || u.role === "admin" || u.role === "owner";
    if (!can) return res.status(200).json({ error: "role belum bisa punya toko" });
    return res.status(200).json({ ok: true, store: u.store || { ...DEFAULT_STORE } });
  }

  if (route === "reseller/store" && method === "POST") {
    const u = await authFromToken();
    if (!u) return res.status(200).json({ error: "not logged in" });
    const can = u.role === "reseller" || u.role === "admin" || u.role === "owner";
    if (!can) return res.status(200).json({ error: "role belum bisa punya toko" });
    const price = Math.max(0, Math.min(99999999, parseInt(body.price) || 500));
    let wa = String(body.wa || "").trim().replace(/[^0-9]/g, "");
    let dana = String(body.dana || "").trim().replace(/[^0-9]/g, "");
    const name = String(body.name || "").trim().slice(0, 40);
    const active = !!body.active;
    let qr = String(body.qr || "").trim();
    if (qr && !qr.startsWith("data:image/")) return res.status(200).json({ error: "Format QR tidak valid" });
    if (qr.length > 700000) return res.status(200).json({ error: "QR terlalu besar" });
    if (wa && wa.length < 8) return res.status(200).json({ error: "Nomor WA minimal 8 digit" });
    if (dana && dana.length < 8) return res.status(200).json({ error: "Nomor DANA minimal 8 digit" });
    if (wa.startsWith("0")) wa = "62" + wa.slice(1);
    const hasPay = qr.length > 0 || dana.length >= 8;
    const canActive = active && wa.length >= 8 && hasPay;
    u.store = { price, wa, dana, name: name || u.username, active: canActive, qr };
    await saveUser(u);
    return res.status(200).json({ ok: true, store: u.store });
  }

  if (route === "stores/list" && method === "GET") {
    const u = await authFromToken();
    if (!u) return res.status(200).json({ error: "not logged in" });
    const all = await listUsers();
    const stores = all
      .filter(x => x.store && x.store.active && x.store.wa && x.role !== "banned" && x.role !== "member")
      .map(x => ({ username: x.username, name: x.store.name || x.username, price: x.store.price || 500, wa: x.store.wa, dana: x.store.dana || "", hasQr: !!(x.store.qr && x.store.qr.length > 0), role: x.role }));
    const order = { owner: 0, admin: 1, reseller: 2 };
    stores.sort((a, b) => (order[a.role] || 9) - (order[b.role] || 9) || a.name.localeCompare(b.name));
    return res.status(200).json({ ok: true, stores });
  }

  if ((route === "stores/qr" || route === "stores/pay") && method === "GET") {
    const u = await authFromToken();
    if (!u) return res.status(200).json({ error: "not logged in" });
    const target = String(params.get("username") || "").trim();
    if (!target) return res.status(200).json({ error: "username kosong" });
    const t = await getUser(target);
    if (!t || !t.store || !t.store.active || !t.store.wa) return res.status(200).json({ ok: true, qr: "", dana: "" });
    return res.status(200).json({ ok: true, qr: t.store.qr || "", dana: t.store.dana || "" });
  }

  if (route === "owner/setstore" && method === "POST") {
    const reqRole = await getOwnerRole(body.pw, body.ot);
    if (!reqRole || (reqRole !== "owner" && reqRole !== "admin")) return res.status(200).json({ error: "forbidden" });
    const target = String(body.username || "").trim();
    const u = await getUser(target);
    if (!u) return res.status(200).json({ error: "user tidak ditemukan" });
    const can = u.role === "reseller" || u.role === "admin" || u.role === "owner";
    if (!can) return res.status(200).json({ error: "role target belum bisa punya toko" });
    const price = Math.max(0, Math.min(99999999, parseInt(body.price) || 500));
    let wa = String(body.wa || "").trim().replace(/[^0-9]/g, "");
    let dana = String(body.dana || "").trim().replace(/[^0-9]/g, "");
    const name = String(body.name || "").trim().slice(0, 40);
    const active = !!body.active;
    if (wa.startsWith("0")) wa = "62" + wa.slice(1);
    if (dana.startsWith("0")) dana = "62" + dana.slice(1);
    let qr = String(body.qr || "").trim();
    if (qr && !qr.startsWith("data:image/")) qr = "";
    if (qr.length > 700000) qr = "";
    const finalQr = qr || (u.store && u.store.qr) || "";
    const finalDana = dana || (u.store && u.store.dana) || "";
    const hasPay = finalQr.length > 0 || finalDana.length >= 8;
    const canActive = active && wa.length >= 8 && hasPay;
    u.store = { price, wa, dana: finalDana, name: name || u.username, active: canActive, qr: finalQr };
    await saveUser(u);
    return res.status(200).json({ ok: true, store: u.store });
  }

  if (route === "owner/users") {
    const reqRole = await getOwnerRole(params.get("pw") || (body && body.pw), params.get("ot") || (body && body.ot));
    if (!reqRole) {
      const u = await authFromToken();
      if (!u || (u.role !== "owner" && u.role !== "admin")) return res.status(200).json({ error: "forbidden" });
    }
    const users = await listUsers();
    users.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return res.status(200).json({ ok: true, users: users.map(u => ({ username: u.username, email: u.email || null, role: u.role, quota: u.quota, keysToday: u.keysToday, totalKeys: (u.keys || []).length, createdAt: u.createdAt, store: u.store || null })) });
  }

  if (route === "owner/setrole" && method === "POST") {
    const reqRole = await getOwnerRole(body.pw, body.ot);
    if (!reqRole) return res.status(200).json({ error: "forbidden" });
    const target = String((body && body.username) || "").trim();
    const role = String((body && body.role) || "");
    const validRoles = ["member", "reseller", "admin", "owner", "banned"];
    if (!validRoles.includes(role)) return res.status(200).json({ error: "role invalid" });
    const u = await getUser(target);
    if (!u) return res.status(200).json({ error: "user tidak ditemukan" });
    if (reqRole === "admin") {
      if (u.role === "admin" || u.role === "owner") return res.status(200).json({ error: "admin gak bisa ubah " + u.role });
      if (role === "admin" || role === "owner") return res.status(200).json({ error: "admin gak bisa promote ke " + role });
    }
    u.role = role;
    if (role === "reseller" && (!u.quota || u.quota < 1)) u.quota = DEFAULT_QUOTA;
    await saveUser(u);
    return res.status(200).json({ ok: true });
  }

  if (route === "owner/setquota" && method === "POST") {
    const reqRole = await getOwnerRole(body.pw, body.ot);
    if (!reqRole || (reqRole !== "owner" && reqRole !== "admin")) return res.status(200).json({ error: "forbidden" });
    const target = String((body && body.username) || "").trim();
    const quota = Math.max(0, Math.min(9999, parseInt(body && body.quota) || 0));
    const u = await getUser(target);
    if (!u) return res.status(200).json({ error: "user tidak ditemukan" });
    u.quota = quota; await saveUser(u);
    return res.status(200).json({ ok: true });
  }

  if (route === "owner/delete" && method === "POST") {
    const reqRole = await getOwnerRole(body.pw, body.ot);
    if (reqRole !== "owner") return res.status(200).json({ error: "cuma owner" });
    const target = String((body && body.username) || "").trim();
    const u = await getUser(target);
    if (u && u.email) await storeDel("nang:email:" + u.email.toLowerCase());
    await storeDel("nang:user:" + target.toLowerCase());
    if (_HAS_KV && Date.now() > _kvBrokenUntil) await _kvCmd("SREM", "nang:userlist", target);
    return res.status(200).json({ ok: true });
  }

  return res.status(200).json({ error: "unknown route", route, method });
}

function authPage(data, valid, username) {
  const key = data.k, uid = data.u;
  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NANG Auth</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#050510;color:#e8e8f0;font-family:'Inter',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px}
.card{background:rgba(15,15,30,0.75);border:1px solid rgba(255,255,255,0.08);border-radius:24px;padding:32px 28px;max-width:420px;width:100%}
.logo{font-size:2rem;font-weight:900;background:linear-gradient(135deg,#ff6eb4,#c084fc,#67e8f9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;text-align:center}
.logo-sub{font-size:.65rem;color:rgba(255,255,255,.3);letter-spacing:4px;text-transform:uppercase;text-align:center;margin-top:4px}
.badge{display:inline-flex;font-size:.7rem;font-weight:700;padding:5px 14px;border-radius:20px;margin-top:10px}
.badge.ok{background:rgba(0,232,122,0.1);color:#4ade80}
.badge.err{background:rgba(255,80,80,0.1);color:#f87171}
.row{display:flex;justify-content:space-between;padding:11px 0;font-size:.84rem;border-bottom:1px solid rgba(255,255,255,0.06)}
.label{color:rgba(255,255,255,.35)}
.val{color:#e8e8f0;font-weight:600}
.key{font-family:'JetBrains Mono',monospace;font-size:1rem;font-weight:700;color:#4ade80;text-align:center;padding:16px;background:rgba(0,0,0,0.3);border:1px solid rgba(224,60,138,0.2);border-radius:12px;margin:16px 0;word-break:break-all}
.btn{width:100%;padding:13px;background:linear-gradient(135deg,#e03c8a,#9b4de0);color:#fff;border:none;border-radius:12px;font-weight:700;cursor:pointer;font-family:inherit;font-size:.9rem}
.notice{font-size:.73rem;color:rgba(255,255,255,.35);text-align:center;margin-top:16px;line-height:1.8}
</style></head><body>
<div class="card">
<div class="logo">NANG AUTH</div>
<div class="logo-sub">Key System</div>
<div style="text-align:center"><div class="badge ${valid?'ok':'err'}">${valid?'KEY VALID':'KEY EXPIRED'}</div></div>
<div class="row"><span class="label">Username</span><span class="val">${username||"Unknown"}</span></div>
<div class="row"><span class="label">User ID</span><span class="val">${uid}</span></div>
<div class="key" id="keyText">${key}</div>
<button class="btn" onclick="navigator.clipboard.writeText(document.getElementById('keyText').textContent);this.textContent='TERSALIN';setTimeout(()=>this.textContent='SALIN KEY',1500)">SALIN KEY</button>
</div></body></html>`;
}

function mainPage(wa) {
  // PANJANG — karena kode sebelumnya sudah ada, tinggal replace function mainPage() kamu dengan versi yang SAMA seperti file sebelumnya.
  // Yang berubah di file ini HANYA blok ?yt=resolve di atas.
  // Copy mainPage() dari file sebelumnya persis sama.
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>NANG</title></head><body>PLACEHOLDER — copy mainPage() dari file sebelumnya, tidak ada perubahan.</body></html>`;
}
