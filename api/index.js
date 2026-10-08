const BUILD = "69.5";
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

const DEFAULT_STORE = { price: 500, wa: "", name: "", active: false, qr: "" };

function ensureStore(u) {
  if (!u) return u;
  if (!u.store) u.store = { ...DEFAULT_STORE };
  if (typeof u.store.price !== "number") u.store.price = 500;
  if (typeof u.store.wa !== "string") u.store.wa = "";
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

async function sendWebhook(fields) {
  if (!NANG_WEBHOOK || NANG_WEBHOOK.includes("GANTI_INI")) return;
  try {
    await fetch(NANG_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "NANG Logger",
        embeds: [{
          title: "NANG Event",
          color: 14433400,
          fields: fields,
          timestamp: new Date().toISOString(),
          footer: { text: "NANG v" + BUILD }
        }]
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
  const ADMIN_PW = "nangowner123";
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-nang-apikey, x-nang-userid, x-nang-filename, x-nang-display, x-nang-desc, x-nang-assettype");
  if (method === "OPTIONS") { res.status(200).end(); return; }

  if (params.has("version")) { res.status(200).json({ version: BUILD, ts: Date.now(), hasKv: _HAS_KV }); return; }

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

  if (method === "POST") {
    let body = "";
    await new Promise(r => { req.on("data", c => body += c); req.on("end", r); });
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.status(400).json({ valid: false, error: "bad json" }); return; }
    const valid = _verifyKey(parsed.uid, parsed.key).valid;
    let username = null;
    if (valid) username = await _getRobloxUser(parsed.uid);
    if (valid) {
      sendWebhook([
        { name: "Event", value: "Key Verified", inline: false },
        { name: "Username", value: String(username || "Unknown"), inline: true },
        { name: "User ID", value: String(parsed.uid), inline: true },
        { name: "Remaining", value: _expiryStr(parsed.uid, parsed.key), inline: true },
        { name: "IP", value: _getClientIP(req), inline: true },
      ]);
    }
    res.status(200).json({ valid, expires: valid ? _expiryStr(parsed.uid, parsed.key) : null, username });
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
    let username = null;
    if (valid) username = await _getRobloxUser(uid);
    res.status(200).json({ valid, expires: valid ? _expiryStr(uid, key) : null, username });
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

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(mainPage(WA_NUMBER));
}

function _flatRobloxErrors(data) {
  if (!data) return "unknown";
  if (typeof data === "string") return data;
  const parts = [];
  if (data.message) parts.push(String(data.message));
  if (data.error && typeof data.error === "string") parts.push(data.error);
  if (Array.isArray(data.errors)) {
    for (const e of data.errors) {
      parts.push(typeof e === "string" ? e : (e.message || JSON.stringify(e)));
    }
  }
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

// ============================================================
// RAW BINARY UPLOAD — support Model & Audio
//   Model : .rbxm / .rbxmx  → MIME "model/x-rbxm"      → assetType "Model"
//   Audio : .mp3 / .ogg / .wav / .flac → MIME sesuai    → assetType "Audio"
// ============================================================
async function handleRawUpload(req, res) {
  res.setHeader("Content-Type", "application/json");

  const apiKey = String(req.headers["x-nang-apikey"] || "").trim();
  const userId = String(req.headers["x-nang-userid"] || "").trim();
  const fileName = String(req.headers["x-nang-filename"] || "file.bin").slice(0, 128);
  const displayName = String(req.headers["x-nang-display"] || "Asset").slice(0, 50);
  const description = String(req.headers["x-nang-desc"] || "").slice(0, 1000);
  const assetType = String(req.headers["x-nang-assettype"] || "Model").trim();

  if (!apiKey) return res.status(200).json({ ok: false, error: "API key kosong" });
  if (!userId || !/^\d+$/.test(userId)) return res.status(200).json({ ok: false, error: "userId invalid" });
  if (assetType !== "Model" && assetType !== "Audio") {
    return res.status(200).json({ ok: false, error: "assetType harus Model atau Audio" });
  }

  let buffer;
  try {
    const chunks = [];
    await new Promise((resolve, reject) => {
      req.on("data", c => chunks.push(c));
      req.on("end", resolve);
      req.on("error", reject);
    });
    buffer = Buffer.concat(chunks);
  } catch (e) {
    return res.status(200).json({ ok: false, error: "Gagal baca body: " + String(e.message || e) });
  }

  if (!buffer.length) return res.status(200).json({ ok: false, error: "File kosong" });

  const ext = fileName.toLowerCase().split(".").pop();
  const MODEL_EXT = ["rbxm", "rbxmx"];
  const AUDIO_EXT = ["mp3", "ogg", "wav", "flac"];
  const MIME_MAP = {
    rbxm: "model/x-rbxm",
    rbxmx: "model/x-rbxm",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    wav: "audio/wav",
    flac: "audio/flac"
  };

  const allowed = assetType === "Audio" ? AUDIO_EXT : MODEL_EXT;
  if (!allowed.includes(ext)) {
    return res.status(200).json({
      ok: false,
      error: assetType === "Audio"
        ? "Audio harus .mp3 / .ogg / .wav / .flac (file lu: ." + ext + ")"
        : "Model harus .rbxm / .rbxmx (file lu: ." + ext + ")"
    });
  }

  const mime = MIME_MAP[ext] || "application/octet-stream";

  try {
    const form = new FormData();

    // Part "request" — metadata JSON
    form.append("request", JSON.stringify({
      assetType: assetType,
      displayName: displayName,
      description: description,
      creationContext: {
        creator: { userId: Number(userId) }
      }
    }));

    // Part "fileContent" — binary
    const blob = new Blob([new Uint8Array(buffer)], { type: mime });
    form.append("fileContent", blob, fileName);

    const r = await fetch("https://apis.roblox.com/assets/v1/assets", {
      method: "POST",
      headers: { "x-api-key": apiKey },
      body: form,
    });

    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!r.ok) {
      let msg;
      if (r.status === 401) msg = "API key tidak valid / expired";
      else if (r.status === 403) msg = "Forbidden — cek: (1) API key punya permission Assets API Write? (2) userId ini pemilik API key? (3) IP restriction OFF di dashboard Roblox? (4) Untuk Audio: akun harus verified creator";
      else if (r.status === 429) msg = "Rate limit Roblox — tunggu ~10 detik";
      else if (r.status === 413) msg = "File terlalu besar untuk Roblox (max ~20 MB)";
      else if (r.status === 400 || r.status === 415 || r.status === 422) {
        msg = "Data ditolak Roblox: " + _flatRobloxErrors(data);
      } else {
        msg = data.message || data.error || _flatRobloxErrors(data) || ("HTTP " + r.status);
      }
      return res.status(200).json({
        ok: false,
        error: "[" + r.status + "] " + msg,
        debug: { fileName, size: buffer.length, userId, status: r.status, assetType }
      });
    }

    const operationId = data.operationId || (data.path && String(data.path).split("/").pop());
    if (!operationId) return res.status(200).json({ ok: false, error: "Roblox tidak kasih operationId", raw: data });
    return res.status(200).json({ ok: true, operationId });
  } catch (e) {
    return res.status(200).json({ ok: false, error: "Upload error: " + String(e.message || e) });
  }
}

async function handleApi(req, res, path, method, params, ctx) {
  const { ADMIN_PW, WA_NUMBER } = ctx;
  const route = path.replace(/^\/api\//, "").replace(/\/$/, "");

  if (route === "upload-rbxm-raw" && method === "POST") {
    return await handleRawUpload(req, res);
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
    if (mem && mem.expiresAt > Date.now()) {
      const u = await getUser(mem.username);
      if (u && u.role !== "banned") return u;
    }
    const sess = await storeGet("nang:sess:" + token);
    if (!sess) return null;
    if (!sess.expiresAt || sess.expiresAt < Date.now()) {
      await storeDel("nang:sess:" + token);
      return null;
    }
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
    if (!reqRole || (reqRole !== "owner" && reqRole !== "admin")) {
      return res.status(200).json({ error: "forbidden" });
    }
    const uid = String((body && body.uid) || "").trim();
    if (!uid || !/^\d+$/.test(uid)) return res.status(200).json({ error: "User ID tidak valid" });
    const key = _makeKey(uid);
    const name = await _getRobloxUser(uid);
    return res.status(200).json({ ok: true, key, expires: _expiryStr(uid, key), username: name });
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
      } catch (e) {
        return res.status(200).json({ ok: false, error: String(e.message || e) });
      }
    }

    try {
      const tryLookup = async (exclude) => {
        const r = await fetch("https://users.roblox.com/v1/usernames/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ usernames: [q], excludeBannedUsers: exclude }),
        });
        const d = await r.json();
        return d && d.data && d.data[0] ? d.data[0] : null;
      };
      let hit = await tryLookup(false);
      if (!hit) hit = await tryLookup(true);
      if (!hit) return res.status(200).json({ ok: false, error: "Username tidak ditemukan" });
      return res.status(200).json({ ok: true, userId: hit.id, name: hit.name, displayName: hit.displayName || hit.name });
    } catch (e) {
      return res.status(200).json({ ok: false, error: String(e.message || e) });
    }
  }

  if (route === "verify-apikey" && method === "POST") {
    const apiKey = String((body && body.apiKey) || "").trim();
    if (!apiKey) return res.status(200).json({ ok: false, error: "API key kosong" });
    if (apiKey.length < 20) return res.status(200).json({ ok: false, error: "Format API key tidak valid (terlalu pendek)" });
    try {
      const r = await fetch("https://apis.roblox.com/assets/v1/assets", {
        method: "POST",
        headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ __nang_probe: true }),
      });
      if (r.status === 401) return res.status(200).json({ ok: false, error: "API key tidak valid / sudah expired" });
      if (r.status === 403) return res.status(200).json({ ok: false, error: "API key valid, tapi tidak punya permission Assets API (Write)" });
      if (r.status === 429) return res.status(200).json({ ok: false, error: "Rate limit — coba lagi sebentar" });
      return res.status(200).json({ ok: true, status: r.status });
    } catch (e) {
      return res.status(200).json({ ok: false, error: "Gagal cek API key: " + String(e.message || e) });
    }
  }

  if (route === "upload-rbxm" && method === "POST") {
    const apiKey = (body && body.apiKey) || "";
    const userId = (body && body.userId) || "";
    const fileBase64 = (body && body.fileBase64) || "";
    const fileName = (body && body.fileName) || "model.rbxm";
    const displayName = (body && body.displayName) || "Model";
    const description = (body && body.description) || "";
    const assetType = (body && body.assetType) || "Model";
    if (!apiKey || !userId || !fileBase64) return res.status(200).json({ ok: false, error: "data kurang" });
    try {
      const buffer = Buffer.from(fileBase64, "base64");
      const ext = fileName.toLowerCase().split(".").pop();
      const MIME_MAP = { rbxm: "model/x-rbxm", rbxmx: "model/x-rbxm", mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", flac: "audio/flac" };
      const mime = MIME_MAP[ext] || "application/octet-stream";
      const form = new FormData();
      form.append("request", JSON.stringify({
        assetType: assetType,
        displayName: String(displayName).slice(0, 50),
        description: String(description).slice(0, 1000),
        creationContext: { creator: { userId: Number(userId) } }
      }));
      const blob = new Blob([buffer], { type: mime });
      form.append("fileContent", blob, fileName);
      const r = await fetch("https://apis.roblox.com/assets/v1/assets", {
        method: "POST",
        headers: { "x-api-key": apiKey },
        body: form,
      });
      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
      if (!r.ok) {
        let msg;
        if (r.status === 401) msg = "API key tidak valid / expired";
        else if (r.status === 403) msg = "API key tidak punya permission Assets API (Write), atau creator tidak sesuai pemilik key";
        else if (r.status === 429) msg = "Rate limit Roblox — tunggu beberapa detik lalu coba lagi";
        else if (r.status === 400 || r.status === 415 || r.status === 422) msg = "Data ditolak Roblox: " + _flatRobloxErrors(data);
        else msg = data.message || data.error || _flatRobloxErrors(data) || ("HTTP " + r.status);
        return res.status(200).json({ ok: false, error: "[" + r.status + "] " + msg });
      }
      const operationId = data.operationId || (data.path && data.path.split("/").pop());
      if (!operationId) return res.status(200).json({ ok: false, error: "Tidak dapat operationId", raw: data });
      return res.status(200).json({ ok: true, operationId });
    } catch (e) {
      return res.status(200).json({ ok: false, error: String(e.message || e) });
    }
  }

  if (route === "upload-status" && method === "GET") {
    const operationId = params.get("id");
    const apiKey = params.get("k");
    if (!operationId || !apiKey) return res.status(200).json({ ok: false, error: "missing" });
    try {
      const r = await fetch("https://apis.roblox.com/assets/v1/operations/" + encodeURIComponent(operationId), {
        method: "GET",
        headers: { "x-api-key": apiKey },
      });
      const data = await r.json();
      if (data.done) {
        if (data.error) return res.status(200).json({ ok: true, done: true, error: data.error.message || "Upload gagal" });
        const assetId = data.response && data.response.assetId;
        return res.status(200).json({ ok: true, done: true, assetId });
      }
      return res.status(200).json({ ok: true, done: false });
    } catch (e) {
      return res.status(200).json({ ok: false, error: String(e.message || e) });
    }
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
    const user = {
      username, email,
      passwordHash: hashPw(password, salt), salt,
      role: "member", quota: DEFAULT_QUOTA, keysToday: 0, lastReset: Date.now(),
      createdAt: Date.now(), keys: [],
      store: { price: 500, wa: "", name: username, active: false, qr: "" },
    };
    await saveUser(user);
    await storeSet(emailKey, username);
    sendWebhook([
      { name: "Event", value: "New Member Registered", inline: false },
      { name: "Username", value: username, inline: true },
      { name: "Email", value: email, inline: true },
      { name: "Role", value: "member", inline: true },
      { name: "IP", value: _getClientIP(req), inline: true },
    ]);
    return res.status(200).json({ ok: true, message: "Terdaftar sebagai member." });
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
    return res.status(200).json({
      ok: true, token,
      noKv: !_HAS_KV,
      user: { username: user.username, role: user.role, quota: user.quota, keysToday: user.keysToday },
    });
  }

  if (route === "reseller/me") {
    const u = await authFromToken();
    if (!u) return res.status(200).json({ error: "not logged in" });
    if (Date.now() - u.lastReset > 24 * 3600 * 1000) {
      u.keysToday = 0; u.lastReset = Date.now();
      await saveUser(u);
    }
    return res.status(200).json({
      ok: true,
      user: {
        username: u.username, email: u.email || null, role: u.role, quota: u.quota,
        keysToday: u.keysToday, keys: u.keys || [], createdAt: u.createdAt,
        store: u.store || { ...DEFAULT_STORE },
      },
    });
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
    if (oldToken && oldToken !== token) {
      delete _memStore["nang:sess:" + oldToken];
      storeDel("nang:sess:" + oldToken).catch(() => {});
    }
    return res.status(200).json({ ok: true, token });
  }

  if (route === "reseller/logout" && method === "POST") {
    const token = (body && body.token) || params.get("token");
    if (token) {
      delete _memStore["nang:sess:" + token];
      await storeDel("nang:sess:" + token);
    }
    return res.status(200).json({ ok: true });
  }

  if (route === "reseller/generate" && method === "POST") {
    const u = await authFromToken();
    if (!u) return res.status(200).json({ error: "not logged in" });
    const canGenerate = u.role === "reseller" || u.role === "admin" || u.role === "owner";
    if (!canGenerate) return res.status(200).json({ error: "Role belum bisa generate." });
    if (Date.now() - u.lastReset > 24 * 3600 * 1000) { u.keysToday = 0; u.lastReset = Date.now(); }
    if (u.role === "reseller" && u.keysToday >= u.quota) {
      return res.status(200).json({ error: "Kuota harian habis (" + u.quota + ")" });
    }
    const uid = String((body && body.uid) || "").trim();
    if (!uid || !/^\d+$/.test(uid)) return res.status(200).json({ error: "Roblox User ID tidak valid" });
    const key = _makeKey(uid);
    const name = await _getRobloxUser(uid);
    u.keysToday = (u.keysToday || 0) + 1;
    u.keys = u.keys || [];
    u.keys.unshift({ uid, key, name: name || "Unknown", ts: Date.now(), by: u.username });
    if (u.keys.length > 100) u.keys = u.keys.slice(0, 100);
    await saveUser(u);
    return res.status(200).json({
      ok: true, key,
      expires: _expiryStr(uid, key),
      username: name,
      remaining: u.role === "reseller" ? (u.quota - u.keysToday) : "unlimited",
    });
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
    const name = String(body.name || "").trim().slice(0, 40);
    const active = !!body.active;
    let qr = String(body.qr || "").trim();
    if (qr && !qr.startsWith("data:image/")) return res.status(200).json({ error: "Format QR tidak valid" });
    if (qr.length > 700000) return res.status(200).json({ error: "QR terlalu besar (max ~500 KB)" });
    if (wa && wa.length < 8) return res.status(200).json({ error: "Nomor WA minimal 8 digit" });
    if (wa.startsWith("0")) wa = "62" + wa.slice(1);
    u.store = {
      price, wa,
      name: name || u.username,
      active: (active && wa.length >= 8) ? true : false,
      qr: qr,
    };
    await saveUser(u);
    sendWebhook([
      { name: "Event", value: "Store Updated", inline: false },
      { name: "Username", value: u.username, inline: true },
      { name: "Price", value: "Rp" + price, inline: true },
      { name: "WA", value: wa || "-", inline: true },
      { name: "Active", value: u.store.active ? "Ya" : "Tidak", inline: true },
      { name: "QR", value: qr ? "Ada" : "Tidak", inline: true },
    ]);
    return res.status(200).json({ ok: true, store: u.store });
  }

  if (route === "stores/list" && method === "GET") {
    const u = await authFromToken();
    if (!u) return res.status(200).json({ error: "not logged in" });
    const all = await listUsers();
    const stores = all
      .filter(x => x.store && x.store.active && x.store.wa && x.role !== "banned" && x.role !== "member")
      .map(x => ({
        username: x.username,
        name: x.store.name || x.username,
        price: x.store.price || 500,
        wa: x.store.wa,
        hasQr: !!(x.store.qr && x.store.qr.length > 0),
        role: x.role,
      }));
    const order = { owner: 0, admin: 1, reseller: 2 };
    stores.sort((a, b) => (order[a.role] || 9) - (order[b.role] || 9) || a.name.localeCompare(b.name));
    return res.status(200).json({ ok: true, stores });
  }

  if (route === "stores/qr" && method === "GET") {
    const u = await authFromToken();
    if (!u) return res.status(200).json({ error: "not logged in" });
    const target = String(params.get("username") || "").trim();
    if (!target) return res.status(200).json({ error: "username kosong" });
    const t = await getUser(target);
    if (!t || !t.store || !t.store.active || !t.store.wa) return res.status(200).json({ ok: true, qr: "" });
    return res.status(200).json({ ok: true, qr: t.store.qr || "" });
  }

  if (route === "owner/setstore" && method === "POST") {
    const reqRole = await getOwnerRole(body.pw, body.ot);
    if (!reqRole || (reqRole !== "owner" && reqRole !== "admin")) {
      return res.status(200).json({ error: "forbidden" });
    }
    const target = String(body.username || "").trim();
    const u = await getUser(target);
    if (!u) return res.status(200).json({ error: "user tidak ditemukan" });
    const can = u.role === "reseller" || u.role === "admin" || u.role === "owner";
    if (!can) return res.status(200).json({ error: "role target belum bisa punya toko" });
    const price = Math.max(0, Math.min(99999999, parseInt(body.price) || 500));
    let wa = String(body.wa || "").trim().replace(/[^0-9]/g, "");
    const name = String(body.name || "").trim().slice(0, 40);
    const active = !!body.active;
    if (wa.startsWith("0")) wa = "62" + wa.slice(1);
    let qr = String(body.qr || "").trim();
    if (qr && !qr.startsWith("data:image/")) qr = "";
    if (qr.length > 700000) qr = "";
    u.store = {
      price, wa,
      name: name || u.username,
      active: (active && wa.length >= 8) ? true : false,
      qr: qr || (u.store && u.store.qr) || "",
    };
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
    return res.status(200).json({
      ok: true,
      users: users.map(u => ({
        username: u.username, email: u.email || null, role: u.role, quota: u.quota,
        keysToday: u.keysToday, totalKeys: (u.keys || []).length,
        createdAt: u.createdAt,
        store: u.store || null,
      })),
    });
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
    u.quota = quota;
    await saveUser(u);
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
  const key = data.k, uid = data.u, exp = data.e;
  const now = Math.floor(Date.now() / 1000);
  const left = Math.max(0, exp - now);
  const hours = Math.floor(left / 3600);
  const mins = Math.floor((left % 3600) / 60);
  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NANG Auth</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#050510;color:#e8e8f0;font-family:'Inter',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;overflow:hidden}
.bg{position:fixed;inset:0;z-index:0;pointer-events:none}
.orb{position:absolute;border-radius:50%;filter:blur(80px);opacity:.35}
.orb1{width:400px;height:400px;background:radial-gradient(circle,#e03c8a,transparent 70%);top:-100px;left:-100px}
.orb2{width:350px;height:350px;background:radial-gradient(circle,#9b4de0,transparent 70%);bottom:-80px;right:-80px}
.orb3{width:250px;height:250px;background:radial-gradient(circle,#00d4ff,transparent 70%);top:40%;left:50%;transform:translate(-50%,-50%)}
.wrap{position:relative;z-index:1;width:100%;max-width:420px}
.card{background:rgba(15,15,30,0.75);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.08);border-radius:24px;padding:32px 28px;position:relative;overflow:hidden;box-shadow:0 32px 80px rgba(0,0,0,0.6),inset 0 1px 0 rgba(255,255,255,0.06)}
.card::before{content:'';position:absolute;top:0;left:10%;right:10%;height:1px;background:linear-gradient(90deg,transparent,rgba(224,60,138,0.8),rgba(155,77,224,0.8),transparent)}
.brand{text-align:center;margin-bottom:28px}
.logo{font-size:2rem;font-weight:900;background:linear-gradient(135deg,#ff6eb4,#c084fc,#67e8f9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:-1px}
.logo-sub{font-size:.65rem;color:rgba(255,255,255,.3);letter-spacing:4px;text-transform:uppercase;margin-top:4px;font-weight:600}
.badge{display:inline-flex;align-items:center;gap:6px;font-size:.7rem;font-weight:700;padding:5px 14px;border-radius:20px;margin-top:10px;letter-spacing:.5px}
.badge.ok{background:rgba(0,232,122,0.1);color:#4ade80;border:1px solid rgba(74,222,128,0.25);box-shadow:0 0 20px rgba(74,222,128,0.1)}
.badge.ok::before{content:'';width:6px;height:6px;border-radius:50%;background:#4ade80;box-shadow:0 0 8px #4ade80;animation:pulse 1.5s infinite}
.badge.err{background:rgba(255,80,80,0.1);color:#f87171;border:1px solid rgba(248,113,113,0.25)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.divider{height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.06),transparent);margin:4px 0}
.info-row{display:flex;justify-content:space-between;align-items:center;padding:11px 0;font-size:.84rem}
.info-label{color:rgba(255,255,255,.35);font-weight:500}
.info-value{color:#e8e8f0;font-weight:600;text-align:right;word-break:break-all;max-width:65%}
.timer{display:flex;justify-content:center;gap:10px;margin:20px 0 4px}
.timer-box{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:10px 16px;text-align:center;min-width:64px}
.timer-num{font-size:1.5rem;font-weight:900;color:#c084fc;font-family:'JetBrains Mono',monospace;line-height:1}
.timer-label{font-size:.6rem;color:rgba(255,255,255,.3);text-transform:uppercase;letter-spacing:1px;margin-top:4px;font-weight:600}
.timer-sep{font-size:1.4rem;font-weight:900;color:rgba(255,255,255,.2);align-self:center;margin-bottom:8px}
.key-section{background:rgba(0,0,0,0.3);border:1px solid rgba(224,60,138,0.2);border-radius:16px;padding:20px;margin-top:16px;position:relative;overflow:hidden}
.key-section::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(224,60,138,0.03),rgba(155,77,224,0.03));pointer-events:none}
.key-label{font-size:.6rem;color:rgba(255,255,255,.3);font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px;display:flex;align-items:center;gap:6px}
.key-label::before,.key-label::after{content:'';flex:1;height:1px;background:rgba(255,255,255,.06)}
.key-value{font-family:'JetBrains Mono',monospace;font-size:1.05rem;font-weight:700;color:#4ade80;letter-spacing:.5px;word-break:break-all;line-height:1.7;text-align:center;text-shadow:0 0 20px rgba(74,222,128,0.3)}
.copy-btn{width:100%;margin-top:16px;padding:13px;background:linear-gradient(135deg,#e03c8a,#9b4de0);color:#fff;border:none;border-radius:12px;font-weight:700;font-size:.9rem;cursor:pointer;font-family:inherit;position:relative;overflow:hidden;transition:transform .15s,box-shadow .15s;box-shadow:0 8px 24px rgba(224,60,138,0.3)}
.copy-btn:hover{transform:translateY(-1px);box-shadow:0 12px 32px rgba(224,60,138,0.4)}
.copy-btn:active{transform:translateY(0)}
.copy-btn.copied{background:linear-gradient(135deg,#059669,#0891b2);box-shadow:0 8px 24px rgba(5,150,105,0.3)}
.notice{margin-top:16px;padding:12px 16px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:12px;font-size:.73rem;color:rgba(255,255,255,.35);line-height:1.8;text-align:center}
.notice b{color:rgba(255,255,255,.6)}
</style></head>
<body>
<div class="bg"><div class="orb orb1"></div><div class="orb orb2"></div><div class="orb orb3"></div></div>
<div class="wrap">
<div class="card">
<div class="brand">
  <div class="logo">NANG AUTH</div>
  <div class="logo-sub">Key System</div>
  <div><div class="badge ${valid?'ok':'err'}">${valid?'KEY VALID':'KEY EXPIRED'}</div></div>
</div>
<div class="divider"></div>
<div class="info-row"><span class="info-label">Username</span><span class="info-value">${username||"Unknown"}</span></div>
<div class="divider"></div>
<div class="info-row"><span class="info-label">User ID</span><span class="info-value">${uid}</span></div>
<div class="divider"></div>
<div class="timer">
  <div class="timer-box"><div class="timer-num">${String(hours).padStart(2,'0')}</div><div class="timer-label">Jam</div></div>
  <div class="timer-sep">:</div>
  <div class="timer-box"><div class="timer-num">${String(mins).padStart(2,'0')}</div><div class="timer-label">Menit</div></div>
</div>
<div class="key-section">
  <div class="key-label">Your Key</div>
  <div class="key-value" id="keyText">${key}</div>
  <button class="copy-btn" id="copyBtn" onclick="copyKey()">⎘ SALIN KEY</button>
</div>
<div class="notice">Copy key di atas → paste di <b>popup script NANG</b> → klik VERIFIKASI</div>
</div>
</div>
<script>
function copyKey(){
  const t=document.getElementById('keyText').textContent;
  navigator.clipboard.writeText(t).then(()=>{
    const b=document.getElementById('copyBtn');
    b.textContent='✓ TERSALIN!';b.classList.add('copied');
    setTimeout(()=>{b.textContent='⎘ SALIN KEY';b.classList.remove('copied');},2000);
  });
}
</script></body></html>`;
}

function mainPage(wa) {
  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NANG Key System</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--pink:#e03c8a;--purple:#9b4de0;--cyan:#00d4ff;--green:#00e87a;--yellow:#ffc832;--red:#ff6b6b;--bg:#06060e;--bg2:#0d0d1c;--bg3:#13132a;--border:#ffffff10;--border2:#ffffff1a;--text:#eaeaf4;--muted:#5a5a7a}
body{background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:60px 16px 32px;position:relative;overflow-x:hidden}
body::before,body::after,.orb3{content:'';position:fixed;border-radius:50%;pointer-events:none;z-index:0}
body::before{width:500px;height:500px;background:radial-gradient(circle,rgba(224,60,138,0.09) 0%,transparent 70%);top:-120px;left:-100px;animation:orbDrift1 18s ease-in-out infinite alternate}
body::after{width:420px;height:420px;background:radial-gradient(circle,rgba(155,77,224,0.08) 0%,transparent 70%);bottom:-80px;right:-80px;animation:orbDrift2 22s ease-in-out infinite alternate}
.orb3{width:300px;height:300px;background:radial-gradient(circle,rgba(0,212,255,0.07) 0%,transparent 70%);top:50%;left:60%;transform:translate(-50%,-50%);animation:orbDrift3 16s ease-in-out infinite alternate}
@keyframes orbDrift1{0%{transform:translate(0,0) scale(1)}100%{transform:translate(40px,30px) scale(1.1)}}
@keyframes orbDrift2{0%{transform:translate(0,0) scale(1)}100%{transform:translate(-30px,-40px) scale(1.08)}}
@keyframes orbDrift3{0%{transform:translate(-50%,-50%) scale(1)}100%{transform:translate(-45%,-55%) scale(1.12)}}
.hero{text-align:center;margin-bottom:28px;position:relative;z-index:1}
.logo{font-size:2.8rem;font-weight:900;background:linear-gradient(135deg,var(--pink) 0%,var(--purple) 45%,var(--cyan) 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1;filter:drop-shadow(0 0 20px rgba(224,60,138,0.4))}
.logo-badge{display:inline-block;background:linear-gradient(135deg,var(--pink),var(--purple));color:#fff;font-size:0.55rem;font-weight:800;padding:2px 8px;border-radius:20px;vertical-align:super;margin-left:5px;letter-spacing:1.5px;box-shadow:0 0 12px rgba(224,60,138,0.5)}
.sub{color:var(--muted);font-size:0.78rem;margin-top:7px;letter-spacing:0.5px}
.nav{display:flex;gap:5px;background:rgba(13,13,28,0.8);border:1px solid var(--border2);border-radius:16px;padding:5px;margin-bottom:22px;width:100%;max-width:480px;flex-wrap:wrap;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);position:relative;z-index:1}
.nav::before{content:'';position:absolute;inset:0;border-radius:16px;background:linear-gradient(135deg,rgba(224,60,138,0.04),rgba(155,77,224,0.04));pointer-events:none}
.nav-btn{flex:1;min-width:70px;padding:9px 6px;border:none;border-radius:11px;cursor:pointer;font-size:0.78rem;font-weight:600;background:transparent;color:var(--muted);font-family:inherit;transition:all .2s;position:relative}
.nav-btn:hover{color:var(--text)}
.nav-btn.active{background:linear-gradient(135deg,rgba(224,60,138,0.25),rgba(155,77,224,0.2));color:#fff;border:1px solid rgba(224,60,138,0.35);box-shadow:0 2px 12px rgba(224,60,138,0.2),inset 0 1px 0 rgba(255,255,255,0.06)}
.panel{width:100%;max-width:480px;display:none;position:relative;z-index:1}
.panel.active{display:block}
.card{background:rgba(13,13,28,0.7);border:1px solid var(--border2);border-radius:18px;padding:20px;margin-bottom:14px;position:relative;overflow:hidden;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}
.card::before{content:'';position:absolute;top:0;left:20%;right:20%;height:1px;background:linear-gradient(90deg,transparent,rgba(224,60,138,0.6),rgba(155,77,224,0.4),transparent)}
.card::after{content:'';position:absolute;inset:0;border-radius:18px;background:linear-gradient(135deg,rgba(224,60,138,0.025) 0%,transparent 60%);pointer-events:none}
.card-title{font-size:0.65rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:2px;margin-bottom:16px;display:flex;align-items:center;gap:6px}
.card-title::before{content:'';display:inline-block;width:3px;height:12px;background:linear-gradient(to bottom,var(--pink),var(--purple));border-radius:2px}
.qr-wrap{display:flex;gap:14px;align-items:flex-start;margin-bottom:14px}
.qr-img{width:100px;height:100px;border-radius:12px;border:2px solid var(--border2);object-fit:cover;flex-shrink:0;box-shadow:0 0 20px rgba(224,60,138,0.15)}
.qr-img-placeholder{width:100px;height:100px;border-radius:12px;border:2px dashed rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:0.7rem;text-align:center;flex-shrink:0;background:rgba(255,255,255,0.02)}
.qr-info{flex:1}
.price-badge{display:inline-flex;background:linear-gradient(135deg,rgba(0,232,122,0.12),rgba(0,212,255,0.08));border:1px solid rgba(0,232,122,0.25);border-radius:10px;padding:6px 12px;font-size:0.9rem;font-weight:800;color:var(--green);margin-bottom:8px;font-family:'JetBrains Mono',monospace;box-shadow:0 0 14px rgba(0,232,122,0.1)}
.qr-steps{font-size:0.75rem;color:var(--muted);line-height:1.9}
.qr-steps span{color:var(--text)}
.fmt-box{background:rgba(10,10,20,0.6);border:1px solid var(--border);border-radius:12px;padding:14px;font-size:0.75rem;color:var(--muted);line-height:2;margin-bottom:12px;position:relative}
.fmt-box::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(155,77,224,0.3),transparent)}
.fmt-box .label{color:var(--pink);font-weight:700}
.fmt-box .field{color:var(--text);font-weight:500}
.fmt-box a{color:var(--cyan);text-decoration:none}
.fmt-box a:hover{text-decoration:underline}
.wa-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:14px;background:linear-gradient(135deg,#1ebe5d,#128c7e);color:#fff;border:none;border-radius:13px;font-size:0.95rem;font-weight:700;cursor:pointer;text-decoration:none;font-family:inherit;transition:all .2s;box-shadow:0 4px 16px rgba(30,190,93,0.25)}
.wa-btn:hover{transform:translateY(-1px);box-shadow:0 6px 24px rgba(30,190,93,0.35)}
.wa-icon{width:18px;height:18px;fill:#fff}
.inp{width:100%;padding:12px 15px;background:rgba(10,10,22,0.8);border:1px solid var(--border2);border-radius:11px;color:var(--text);font-size:0.88rem;outline:none;margin-bottom:10px;font-family:inherit;transition:border-color .2s,box-shadow .2s}
.inp:focus{border-color:rgba(224,60,138,0.5);box-shadow:0 0 0 3px rgba(224,60,138,0.08)}
.inp::placeholder{color:var(--muted)}
select.inp{cursor:pointer;-webkit-appearance:none;appearance:none;background-image:linear-gradient(45deg,transparent 50%,var(--muted) 50%),linear-gradient(135deg,var(--muted) 50%,transparent 50%);background-position:calc(100% - 18px) 50%,calc(100% - 13px) 50%;background-size:5px 5px,5px 5px;background-repeat:no-repeat;padding-right:34px}
.btn-main{width:100%;padding:13px;background:linear-gradient(135deg,var(--pink),var(--purple));color:#fff;border:none;border-radius:12px;font-weight:700;font-size:0.9rem;cursor:pointer;font-family:inherit;margin-bottom:8px;transition:all .2s;box-shadow:0 4px 16px rgba(224,60,138,0.3)}
.btn-main:hover{transform:translateY(-1px);box-shadow:0 6px 24px rgba(224,60,138,0.45)}
.btn-cyan{width:100%;padding:13px;background:linear-gradient(135deg,#0099cc,var(--cyan));color:#000;border:none;border-radius:12px;font-weight:700;font-size:0.9rem;cursor:pointer;font-family:inherit;transition:all .2s;box-shadow:0 4px 16px rgba(0,212,255,0.2)}
.btn-cyan:hover{transform:translateY(-1px);box-shadow:0 6px 24px rgba(0,212,255,0.35)}
.btn-green{width:100%;padding:12px;background:linear-gradient(135deg,#00b866,var(--green));color:#000;border:none;border-radius:12px;font-weight:700;font-size:0.85rem;cursor:pointer;font-family:inherit;margin-top:8px;transition:all .2s;box-shadow:0 4px 14px rgba(0,232,122,0.2)}
.btn-green:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(0,232,122,0.35)}
.result{background:rgba(10,10,22,0.8);border:1px solid var(--border);border-radius:12px;padding:13px;font-size:0.78rem;margin-top:10px;display:none;word-break:break-all;line-height:1.7}
.result.ok{border-color:rgba(0,232,122,0.35);color:var(--green);display:block;background:rgba(0,232,122,0.04)}
.result.err{border-color:rgba(255,80,80,0.35);color:#ff6b6b;background:rgba(255,30,30,0.05);display:block}
.result.warn{border-color:rgba(255,200,50,0.35);color:#ffc832;background:rgba(255,200,50,0.05);display:block}
.result.info{border-color:rgba(0,212,255,0.35);color:var(--cyan);background:rgba(0,212,255,0.04);display:block}
.result .key-line{font-family:'JetBrains Mono',monospace;font-size:0.85rem;color:var(--green);font-weight:700;margin:6px 0;padding:10px;background:rgba(0,20,10,0.8);border-radius:8px;word-break:break-all;border:1px solid rgba(0,232,122,0.2)}
.result .link-line{font-family:'JetBrains Mono',monospace;font-size:0.7rem;color:var(--cyan);word-break:break-all;padding:8px;background:rgba(0,10,20,0.8);border-radius:8px;display:block;text-decoration:none;border:1px solid rgba(0,212,255,0.15);margin:6px 0}
.result-big{padding:18px;border-radius:14px;margin-top:12px;font-size:0.9rem;line-height:1.7;display:none;border-width:2px;border-style:solid}
.result-big.show{display:block}
.result-big.success{background:linear-gradient(135deg,rgba(0,232,122,0.14),rgba(0,212,255,0.06));border-color:rgba(0,232,122,0.55);color:#4ade80;box-shadow:0 0 40px rgba(0,232,122,0.2)}
.result-big.fail{background:linear-gradient(135deg,rgba(255,80,80,0.14),rgba(255,0,80,0.06));border-color:rgba(255,80,80,0.55);color:#ff9090;box-shadow:0 0 40px rgba(255,80,80,0.2)}
.result-big .big-title{font-size:1.2rem;font-weight:900;margin-bottom:12px;display:flex;align-items:center;gap:10px;letter-spacing:.5px}
.result-big .big-title .ico{font-size:1.8rem}
.result-big .asset-id{font-family:'JetBrains Mono',monospace;font-size:1.2rem;font-weight:900;color:#fff;background:rgba(0,0,0,0.55);border:1px solid rgba(0,232,122,0.5);border-radius:10px;padding:16px;text-align:center;margin:12px 0;word-break:break-all;letter-spacing:1px;text-shadow:0 0 14px rgba(0,232,122,0.7)}
.result-big .err-msg{font-family:'JetBrains Mono',monospace;font-size:0.78rem;background:rgba(0,0,0,0.55);border:1px solid rgba(255,80,80,0.35);border-radius:10px;padding:12px;color:#ffb0b0;word-break:break-word;line-height:1.7;margin:8px 0}
.result-big .err-hint{font-size:0.78rem;color:rgba(255,255,255,.6);margin-top:12px;line-height:1.7}
.result-big .err-hint b{color:#fff}
.result-big .link-btn{display:inline-block;margin-top:12px;padding:11px 20px;background:linear-gradient(135deg,#0099cc,var(--cyan));color:#000;border-radius:10px;font-weight:700;text-decoration:none;font-size:0.88rem;box-shadow:0 4px 16px rgba(0,212,255,0.35);border:none;cursor:pointer;font-family:inherit}
.result-big .link-btn:hover{transform:translateY(-1px);box-shadow:0 6px 24px rgba(0,212,255,0.45)}
.result-big .cp-btn{display:inline-block;margin-top:12px;margin-left:6px;padding:11px 20px;background:linear-gradient(135deg,#00b866,var(--green));color:#000;border-radius:10px;font-weight:700;font-size:0.88rem;border:none;cursor:pointer;font-family:inherit;box-shadow:0 4px 14px rgba(0,232,122,0.35)}
.step{display:flex;align-items:center;gap:10px;padding:8px 0;font-size:0.82rem;color:var(--muted)}
.step .dot{width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:center;font-size:0.65rem;flex-shrink:0;border:1px solid var(--border);font-weight:800}
.step.active .dot{background:linear-gradient(135deg,var(--pink),var(--purple));color:#fff;border-color:transparent;animation:pulseDot 1.2s infinite}
.step.done .dot{background:var(--green);color:#000;border-color:transparent}
.step.err .dot{background:var(--red);color:#fff;border-color:transparent}
.step.active{color:var(--text)}
.step.done{color:var(--green)}
.step.err{color:var(--red)}
@keyframes pulseDot{0%,100%{transform:scale(1)}50%{transform:scale(1.15)}}
.spinner{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.08);border-top-color:var(--pink);border-radius:50%;animation:spin .6s linear infinite;vertical-align:middle;margin-right:6px}
@keyframes spin{to{transform:rotate(360deg)}}
.drop{border:2px dashed rgba(255,255,255,0.12);border-radius:14px;padding:28px 16px;text-align:center;cursor:pointer;transition:all .25s;background:rgba(255,255,255,0.02);margin-bottom:12px}
.drop:hover,.drop.over{border-color:var(--pink);background:rgba(224,60,138,0.06);box-shadow:0 0 20px rgba(224,60,138,0.1)}
.drop.done{border-color:var(--green);background:rgba(0,232,122,0.05)}
.drop-icon{font-size:2rem;margin-bottom:8px;opacity:.7}
.drop-text{font-size:0.85rem;color:var(--text);margin-bottom:4px;word-break:break-all}
.drop-hint{font-size:0.7rem;color:var(--muted)}
.stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}
.stat{background:rgba(255,255,255,0.03);border:1px solid var(--border);padding:14px;border-radius:12px;position:relative;overflow:hidden}
.stat::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(155,77,224,0.3),transparent)}
.stat .label{font-size:.63rem;color:var(--muted);text-transform:uppercase;letter-spacing:1.2px;font-weight:700}
.stat .value{font-size:1.5rem;font-weight:900;margin-top:5px;font-family:'JetBrains Mono',monospace}
.key-item{padding:11px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:10px;margin-bottom:6px;font-size:.75rem;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;transition:border-color .2s}
.key-item:hover{border-color:rgba(0,232,122,0.2)}
.key-item .info{flex:1;min-width:0}
.key-item .k{font-family:'JetBrains Mono',monospace;color:var(--green);font-weight:700;word-break:break-all}
.key-item .meta{color:var(--muted);font-size:.67rem;margin-top:4px}
.key-item .cp{padding:5px 11px;background:rgba(255,255,255,0.05);border:1px solid var(--border2);border-radius:7px;color:var(--text);font-size:.67rem;font-weight:700;cursor:pointer;font-family:inherit;transition:all .15s}
.key-item .cp:hover{background:rgba(0,232,122,0.1);border-color:rgba(0,232,122,0.3);color:var(--green)}
.toggle{display:flex;align-items:center;justify-content:space-between;padding:10px 0;font-size:.85rem}
.toggle .switch{position:relative;width:44px;height:24px;background:rgba(255,255,255,0.08);border-radius:12px;cursor:pointer;transition:.25s;border:1px solid var(--border)}
.toggle .switch.on{background:linear-gradient(135deg,var(--pink),var(--purple));border-color:transparent;box-shadow:0 0 12px rgba(224,60,138,0.4)}
.toggle .switch::after{content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;background:#fff;border-radius:50%;transition:.25s;box-shadow:0 1px 4px rgba(0,0,0,0.4)}
.toggle .switch.on::after{left:22px}
footer{margin-top:32px;color:var(--muted);font-size:0.68rem;text-align:center;opacity:0.4;position:relative;z-index:1}
.hidden{display:none!important}
.auth-bar{position:fixed;top:14px;right:14px;z-index:50;display:flex;gap:8px;align-items:center;font-size:.8rem}
.auth-pill{display:flex;align-items:center;gap:8px;padding:8px 14px;background:rgba(13,13,28,0.85);border:1px solid var(--border2);border-radius:12px;font-size:.8rem;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 4px 20px rgba(0,0,0,0.4)}
.auth-pill .uname{font-weight:700;color:var(--text)}
.auth-btn{padding:8px 14px;background:linear-gradient(135deg,var(--pink),var(--purple));color:#fff;border:none;border-radius:9px;font-weight:700;font-size:.78rem;cursor:pointer;font-family:inherit;box-shadow:0 2px 10px rgba(224,60,138,0.35);transition:all .2s}
.auth-btn:hover{box-shadow:0 4px 16px rgba(224,60,138,0.5)}
.auth-btn.gray{background:rgba(255,255,255,0.07);border:1px solid var(--border2);color:var(--text);box-shadow:none}
.auth-btn.gray:hover{background:rgba(255,255,255,0.1)}
.role-tag{font-size:.58rem;font-weight:800;text-transform:uppercase;letter-spacing:.8px;padding:2px 8px;border-radius:6px}
.role-tag.owner{background:rgba(224,60,138,.15);color:var(--pink);border:1px solid rgba(224,60,138,.3)}
.role-tag.admin{background:rgba(155,77,224,.15);color:#c899ff;border:1px solid rgba(155,77,224,.3)}
.role-tag.reseller{background:rgba(0,212,255,.1);color:var(--cyan);border:1px solid rgba(0,212,255,.25)}
.role-tag.member{background:rgba(150,150,170,.1);color:var(--muted);border:1px solid rgba(150,150,170,.2)}
.role-tag.banned{background:rgba(255,80,80,.12);color:var(--red);border:1px solid rgba(255,80,80,.25)}
.modal-tabs{display:flex;gap:4px;background:rgba(10,10,22,0.8);border-radius:10px;padding:4px;margin-bottom:14px;border:1px solid var(--border)}
.modal-tabs button{flex:1;padding:8px;border:none;border-radius:7px;background:transparent;color:var(--muted);font-family:inherit;font-weight:600;font-size:.8rem;cursor:pointer;transition:all .2s}
.modal-tabs button.on{background:linear-gradient(135deg,rgba(224,60,138,.25),rgba(155,77,224,.2));color:#fff;box-shadow:0 2px 8px rgba(224,60,138,.2)}
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.8);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:none;align-items:center;justify-content:center;z-index:100;padding:20px}
.modal-bg.show{display:flex}
.modal-box{background:rgba(13,13,28,0.95);border:1px solid rgba(224,60,138,.3);border-radius:20px;padding:24px;max-width:420px;width:100%;position:relative;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.6),0 0 40px rgba(224,60,138,.1)}
.modal-box h3{color:var(--pink);font-size:1rem;margin-bottom:14px;font-weight:800}
.modal-box .x{position:absolute;top:14px;right:18px;cursor:pointer;color:var(--muted);font-size:22px;line-height:1;transition:color .2s}
.modal-box .x:hover{color:var(--text)}
.user-row{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:10px;margin-bottom:6px;gap:8px;flex-wrap:wrap;transition:border-color .2s}
.user-row:hover{border-color:var(--border2)}
.user-row .name{font-weight:700;font-size:.9rem;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.user-row .meta{font-size:.7rem;color:var(--muted);margin-top:3px}
.row-actions{display:flex;gap:4px;flex-wrap:wrap}
.row-actions button{padding:5px 10px;border:none;border-radius:7px;font-size:.68rem;font-weight:700;cursor:pointer;font-family:inherit;background:rgba(255,255,255,0.05);color:var(--text);border:1px solid var(--border);transition:all .15s}
.row-actions button:hover{background:rgba(255,255,255,0.1);border-color:var(--border2)}
.locked{padding:40px 20px;text-align:center;color:var(--muted);font-size:.85rem;line-height:1.8}
.locked button{margin-top:14px;padding:10px 24px;width:auto}
.warn-box{padding:11px 14px;background:rgba(255,200,50,0.05);border:1px solid rgba(255,200,50,0.2);border-radius:11px;font-size:0.75rem;color:var(--yellow);margin-bottom:12px;line-height:1.7}
.warn-box b{color:#fff}
.warn-box a{color:var(--yellow)}
.fab{position:fixed;bottom:22px;right:22px;width:50px;height:50px;border-radius:50%;background:linear-gradient(135deg,var(--pink),var(--purple));color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;cursor:pointer;z-index:80;box-shadow:0 6px 24px rgba(224,60,138,0.45),0 0 40px rgba(224,60,138,0.15);border:none;font-family:inherit;transition:all .2s}
.fab:hover{transform:scale(1.07);box-shadow:0 8px 30px rgba(224,60,138,0.6)}
.fab.active{background:linear-gradient(135deg,#00b866,var(--green));box-shadow:0 6px 24px rgba(0,232,122,0.4)}
.hint{font-size:.7rem;margin:-6px 0 10px;padding-left:4px;color:var(--muted);min-height:14px;line-height:1.4}
.hint.ok{color:var(--green)}
.hint.err{color:var(--red)}
</style></head><body>
<div class="orb3"></div>

<div class="auth-bar" id="authBar"></div>
<button class="fab" id="ownerFab" onclick="openOwnerModal()" title="Owner">🔒</button>

<div class="hero">
  <div class="logo">NANG<span class="logo-badge">KEY</span></div>
  <div class="sub">✦ Roblox Script Key System ✦</div>
</div>

<div id="loginWall">
  <div class="card" style="max-width:420px;width:100%">
    <div style="text-align:center;margin-bottom:18px">
      <div style="width:48px;height:48px;border-radius:14px;background:linear-gradient(135deg,var(--pink),var(--purple));display:inline-flex;align-items:center;justify-content:center;font-size:1.4rem;margin-bottom:10px;box-shadow:0 0 24px rgba(224,60,138,0.4)">🔑</div>
      <div style="font-weight:800;font-size:1rem;color:var(--text)">Masuk ke NANG Key</div>
      <div style="font-size:.72rem;color:var(--muted);margin-top:4px">Login atau daftar akun baru</div>
    </div>
    <div class="modal-tabs" style="margin-bottom:14px">
      <button id="lwTabLogin" class="on" onclick="lwSwitch(0)">Masuk</button>
      <button id="lwTabRegister" onclick="lwSwitch(1)">Daftar</button>
    </div>
    <div id="lwLogin">
      <input class="inp" id="lwUser" placeholder="Username atau Email" autocomplete="username">
      <input class="inp" id="lwPass" type="password" placeholder="Password" autocomplete="current-password">
      <button class="btn-main" onclick="lwDoLogin()">Masuk</button>
      <div class="result" id="lwLoginResult"></div>
    </div>
    <div id="lwRegister" class="hidden">
      <input class="inp" id="lwRegUser" placeholder="Username (huruf/angka/_)" autocomplete="username">
      <input class="inp" id="lwRegEmail" type="email" placeholder="Email aktif" autocomplete="email">
      <input class="inp" id="lwRegPass" type="password" placeholder="Password min 5 karakter" autocomplete="new-password">
      <input class="inp" id="lwRegPass2" type="password" placeholder="Konfirmasi password" autocomplete="new-password">
      <button class="btn-main" onclick="lwDoRegister()">Daftar</button>
      <div class="result" id="lwRegResult"></div>
      <div style="font-size:.7rem;color:var(--muted);margin-top:8px;text-align:center">Setelah daftar, login buat akses tools.</div>
    </div>
  </div>
</div>

<div id="appContent" class="hidden">
<div class="nav">
  <button class="nav-btn active" onclick="switchTab(0)">Beli Key</button>
  <button class="nav-btn" onclick="switchTab(1)">Convert</button>
  <button class="nav-btn" id="navUpload" onclick="switchTab(2)">Upload</button>
  <button class="nav-btn hidden" id="navMyKeys" onclick="switchTab(3)">My Keys</button>
  <button class="nav-btn hidden" id="navStore" onclick="switchTab(4)">Toko</button>
</div>

<div class="panel active" id="tab0">
<div class="card">
<div class="card-title">Pilih Penjual</div>
<select class="inp" id="buyStoreSel" onchange="onStoreChange()">
  <option value="">Memuat...</option>
</select>
<div class="fmt-box" id="buyStoreInfo">Pilih penjual di atas buat liat harga + WA.</div>
</div>
<div class="card">
<div class="card-title">Pembayaran</div>
<div class="qr-wrap">
<img id="buyQrImg" class="qr-img" style="display:none;background:#fff;padding:4px" alt="QRIS">
<div id="buyQrPlaceholder" class="qr-img-placeholder">QR<br>belum<br>tersedia</div>
<div class="qr-info">
  <div class="price-badge" id="buyPrice">Rp500 / Key</div>
  <div class="qr-steps">
    Transfer <span id="buyPriceTransfer">Rp500</span><br>
    <span style="font-size:.7rem;color:var(--muted)">Scan QR atau klik nomor WA di bawah</span>
  </div>
</div>
</div>
<div class="fmt-box"><span class="label">Format pesan WA:</span><br><span class="field" id="buyWaName">Beli Key NANG</span><br>Nama: <span class="field" id="waNama">[isi di bawah]</span><br>Roblox ID: <span class="field" id="waUid">[isi di bawah]</span><br>Bukti TF: <span class="field">[screenshot]</span><br><br><span class="label">Nomor WA penjual:</span><br><a href="#" id="buyWaNumLink" target="_blank" style="color:var(--green);font-family:'JetBrains Mono',monospace;font-weight:700;font-size:.9rem;text-decoration:none">-</a></div>
<a href="#" class="wa-btn" id="waBtn" target="_blank"><svg class="wa-icon" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347"/></svg><span id="buyWaBtnText">Chat WhatsApp Penjual</span></a>
</div>
<div class="card"><div class="card-title">Cek Username Roblox</div><input type="text" class="inp" id="lookupId" placeholder="Masukkan Roblox User ID..."><button class="btn-main" onclick="doLookup()">Cek Username</button><div id="lookupResult"></div></div>
</div>

<div class="panel" id="tab1">
<div class="card">
<div class="card-title">RBXL / RBXM → RBXLX</div>
<div class="fmt-box">Upload file <span class="field">.rbxl</span> / <span class="field">.rbxm</span> (biner) atau <span class="field">.rbxlx</span> / <span class="field">.rbxmx</span> (XML). Hasil: <span class="field">.rbxlx</span> siap insert.</div>
<input type="file" id="convFile" accept=".rbxl,.rbxm,.rbxlx,.rbxmx" style="display:none" onchange="doConvert()">
<button class="btn-cyan" onclick="document.getElementById('convFile').click()">Pilih File (.rbxl / .rbxm / .rbxlx)</button>
<div class="result" id="convResult"></div>
</div>
</div>

<div class="panel" id="tab2">
<div id="uploadLocked" class="card">
<div class="locked">
🔒 Role lu belum bisa upload<br>
<div style="font-size:.75rem;margin-top:6px">Butuh role minimal: <b>reseller</b></div>
</div>
</div>
<div id="uploadContent" class="hidden">
<div class="card">
<div class="card-title">📖 Cara Bikin API Key Roblox</div>
<div class="fmt-box">
<span class="label">1. Buka:</span> <a href="https://create.roblox.com/dashboard/credentials" target="_blank">create.roblox.com/dashboard/credentials</a><br><br>
<span class="label">2. API Keys → Create API Key</span><br>
Nama: <span class="field">NANG_UPLOADER_KEY</span><br><br>
<span class="label">3. Access Permissions:</span><br>
• Select API System → <span class="field">Assets API</span><br>
• Centang <span class="field">Write</span> ✅<br>
• Centang <span class="field">Read</span> ✅<br><br>
<span class="label">4. Experience Restriction:</span> nonaktif<br>
<span class="label">5. IP Restriction:</span> nonaktif<br>
<span class="label">6. Save & Generate</span> → copy key<br>
⚠️ Cuma muncul sekali
</div>
</div>
<div class="card">
<div class="card-title">📦 Format Support</div>
<div class="fmt-box">
<b style="color:var(--pink)">📦 Model</b> — <span class="field">.rbxm</span> / <span class="field">.rbxmx</span> — max 20 MB<br>
<b style="color:var(--cyan)">🎵 Audio</b> — <span class="field">.mp3 .ogg .wav .flac</span> — max 7 menit<br>
Limit web ini: max <span class="field">4 MB</span> per upload
</div>
</div>
<div class="warn-box"><b>Penting:</b> Username di bawah HARUS <b>pemilik API Key</b> yang sama. Untuk <b>Audio</b>, akun Roblox harus sudah <b>verified creator</b>.</div>

<div class="card">
<div class="card-title">Tipe Asset</div>
<div class="modal-tabs" style="margin-bottom:0">
  <button id="upTypeModel" class="on" onclick="upSetType('Model')">📦 Model</button>
  <button id="upTypeAudio" onclick="upSetType('Audio')">🎵 Audio</button>
</div>
</div>

<div class="card">
<div class="card-title">Akun Roblox</div>
<input type="text" class="inp" id="upUsername" placeholder="Username / User ID pemilik API key..." autocomplete="off">
<div class="hint" id="upUserHint"></div>
<input type="password" class="inp" id="upApiKey" placeholder="API Key Roblox..." autocomplete="off">
<div class="hint" id="upKeyHint"></div>
</div>
<div class="card">
<div class="card-title">File</div>
<div class="drop" id="upDrop">
<div class="drop-icon">📦</div>
<div class="drop-text">Klik atau drop file</div>
<div class="drop-hint">.rbxm / .rbxmx — max 4 MB</div>
</div>
<input type="file" id="upFileInput" accept=".rbxm,.rbxmx" hidden>
<input type="text" class="inp" id="upName" placeholder="Nama asset (opsional)">
<input type="text" class="inp" id="upDesc" placeholder="Deskripsi (opsional)">
<button class="btn-cyan" id="upBtn" onclick="doUploadRbxm()">UPLOAD KE ROBLOX</button>

<div class="result-big" id="upBigResult"></div>
<div id="upProgress" style="margin-top:12px;display:none">
  <div class="step" id="step1"><div class="dot">1</div><span>Cari akun Roblox</span></div>
  <div class="step" id="step2"><div class="dot">2</div><span>Verifikasi API Key</span></div>
  <div class="step" id="step3"><div class="dot">3</div><span>Upload file ke Roblox</span></div>
  <div class="step" id="step4"><div class="dot">4</div><span>Tunggu Roblox proses asset</span></div>
</div>
</div>
</div>
</div>

<div class="panel" id="tab3">
<div class="card">
<div class="card-title">Kuota Saya</div>
<div class="stat-grid">
  <div class="stat"><div class="label">Kuota / hari</div><div class="value" id="mkQuota">—</div></div>
  <div class="stat"><div class="label">Dipakai</div><div class="value" id="mkToday">—</div></div>
  <div class="stat"><div class="label">Sisa</div><div class="value" id="mkLeft">—</div></div>
  <div class="stat"><div class="label">Total</div><div class="value" id="mkTotal">—</div></div>
</div>
</div>
<div class="card">
<div class="card-title">Generate Key</div>
<input type="text" class="inp" id="mkUid" placeholder="Roblox User ID">
<button class="btn-cyan" id="mkGenBtn" onclick="doMyKeysGenerate()">GENERATE KEY</button>
<div class="result" id="mkResult"></div>
</div>
<div class="card">
<div class="card-title">Riwayat Key</div>
<div id="mkHistory"><div style="color:var(--muted);font-size:.8rem">Belum ada key.</div></div>
</div>
</div>

<div class="panel" id="tab4">
<div class="card">
<div class="card-title">🏪 Toko Saya</div>
<div class="fmt-box">Atur nama toko, harga, dan nomor WA. Kalau diaktifkan, toko lu muncul di halaman Beli Key semua user.</div>
<input type="text" class="inp" id="stName" placeholder="Nama toko (contoh: NANG Store)">
<input type="text" class="inp" id="stPrice" placeholder="Harga per key (angka, contoh: 500)" inputmode="numeric">
<input type="text" class="inp" id="stWa" placeholder="Nomor WA (contoh: 081234567890)" inputmode="tel">
<div class="toggle">
  <span>Aktifkan toko di halaman Beli Key</span>
  <div class="switch" id="stActiveSw" onclick="toggleStoreActive()"></div>
</div>
</div>
<div class="card">
<div class="card-title">📷 QRIS (opsional)</div>
<div class="fmt-box">Upload gambar QRIS. Kalau ada, user bisa scan. Kalau kosong, user cuma bisa chat WA.</div>
<input type="file" id="stQrFile" accept="image/*" style="display:none" onchange="onQrFileChange(event)">
<div id="stQrPreviewWrap" class="hidden" style="text-align:center;margin-bottom:12px">
  <img id="stQrPreview" style="max-width:200px;max-height:200px;border-radius:12px;border:1px solid var(--border);background:#fff;padding:6px">
</div>
<div id="stQrEmpty" class="drop" onclick="document.getElementById('stQrFile').click()">
<div class="drop-icon">📷</div>
<div class="drop-text">Klik upload QRIS</div>
<div class="drop-hint">PNG / JPG — max 500 KB</div>
</div>
<button class="btn-main" id="stQrDelBtn" style="background:var(--bg3);color:var(--red);border:1px solid var(--border);display:none;margin-top:8px" onclick="delQr()">Hapus QR</button>
</div>
<div class="card">
<button class="btn-cyan" onclick="doSaveStore()">SIMPAN TOKO</button>
<div class="result" id="stResult"></div>
</div>
<div class="card">
<div class="card-title">Preview</div>
<div class="fmt-box" id="stPreview">
Nama: <span class="field">-</span><br>
Harga: <span class="field">-</span><br>
WA: <span class="field">-</span><br>
Status: <span class="field">Nonaktif</span>
</div>
</div>
</div>
</div>

<footer>NANG RBXM Tool &copy; 2025 &middot; v${BUILD}</footer>

<div class="modal-bg" id="ownerModal">
  <div class="modal-box">
    <span class="x" onclick="closeOwnerModal()">&times;</span>
    <h3>Owner Panel</h3>
    <div id="ownerLoginForm">
      <input class="inp" id="oPw" type="password" placeholder="Password owner...">
      <button class="btn-main" onclick="doOwnerLogin()">Masuk</button>
      <div class="result" id="oResult"></div>
    </div>
    <div id="ownerPanel" class="hidden">
      <button class="btn-main" onclick="loadUsers()">Refresh Users</button>
      <div id="usersList" style="margin-top:12px"></div>
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
        <div style="font-size:.72rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px">Generate Key</div>
        <input class="inp" id="oGenUid" placeholder="Roblox User ID">
        <button class="btn-main" onclick="doOwnerGen()">Generate Key</button>
        <div class="result" id="oGenResult"></div>
        <button class="btn-main" style="background:var(--bg3);color:var(--text);border:1px solid var(--border)" onclick="doOwnerLogout()">Logout Owner</button>
      </div>
    </div>
  </div>
</div>

<script>
const WA_NUMBER="${wa}";
let TOKEN = localStorage.getItem('nang_session') || null;
let OWNER_TOKEN = localStorage.getItem('nang_owner') || null;
let ME = null;
let lastLookup={uid:null,name:null};
let STORES = [];
let MY_STORE = { price: 500, wa: "", name: "", active: false, qr: "" };
let _qrData = "";
let _upAssetType = "Model";

function $(id){return document.getElementById(id);}
function apiCall(url, opts){
  return fetch(url, opts).then(r=>{
    return r.text().then(t=>{
      try { return JSON.parse(t); }
      catch(e) { return { error: 'Server tidak balikin JSON: '+t.slice(0,120) }; }
    });
  });
}
function setCookie(name, val, days){
  try { document.cookie = name + '=' + encodeURIComponent(val) + '; max-age=' + (days*24*3600) + '; path=/; SameSite=Lax'; } catch(e) {}
}
function getCookie(name){
  try {
    const m = document.cookie.match(new RegExp('(^|;\\\\s*)' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[2]) : null;
  } catch(e) { return null; }
}
function delCookie(name){ setCookie(name, '', -1); }
function fmtRp(n){ n = parseInt(n) || 0; return 'Rp' + n.toLocaleString('id-ID'); }
function esc(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function switchTab(i){
  document.querySelectorAll('.nav-btn').forEach((b,j)=>b.classList.toggle('active',i===j));
  document.querySelectorAll('.panel').forEach((p,j)=>p.classList.toggle('active',i===j));
  if(i===3) refreshMyKeys();
  if(i===4) refreshStore();
  if(i===0) loadStores();
}

let _lastRefreshAt = parseInt(localStorage.getItem('nang_last_refresh') || '0');

async function checkSession(){
  if(!TOKEN){
    const ck = getCookie('nang_session');
    if(ck){ TOKEN = ck; localStorage.setItem('nang_session', ck); }
  }
  if(!TOKEN){ ME=null; updateAuthUI(); return; }
  try{
    const d = await apiCall('/?api=reseller/me&token='+encodeURIComponent(TOKEN));
    if(d.ok){
      ME = d.user;
      const now = Date.now();
      const hoursSinceRefresh = (now - _lastRefreshAt) / (3600 * 1000);
      if(hoursSinceRefresh > 23){
        try {
          const rf = await apiCall('/?api=reseller/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TOKEN})});
          if(rf.ok && rf.token){
            TOKEN = rf.token;
            localStorage.setItem('nang_session', TOKEN);
            setCookie('nang_session', TOKEN, 30);
            _lastRefreshAt = now;
            localStorage.setItem('nang_last_refresh', String(now));
          }
        } catch(e) {}
      }
    } else {
      try {
        const d2 = await apiCall('/?api=reseller/me&token='+encodeURIComponent(TOKEN));
        if(d2.ok){ ME = d2.user; updateAuthUI(); if(ME && ME.role !== 'banned') loadStores(); return; }
      } catch(e2) {}
      TOKEN=null; ME=null;
      localStorage.removeItem('nang_session');
      localStorage.removeItem('nang_last_refresh');
      delCookie('nang_session');
    }
  }catch(e){}
  updateAuthUI();
  if(ME && ME.role !== 'banned') loadStores();
}

function updateAuthUI(){
  const bar = $('authBar');
  const logged = !!ME && ME.role !== 'banned';
  if(logged){
    $('loginWall').classList.add('hidden');
    $('appContent').classList.remove('hidden');
    bar.innerHTML = '<div class="auth-pill"><span class="uname">'+esc(ME.username)+'</span><span class="role-tag '+ME.role+'">'+ME.role+'</span></div><button class="auth-btn gray" onclick="doAuthLogout()">Logout</button>';
  } else {
    $('loginWall').classList.remove('hidden');
    $('appContent').classList.add('hidden');
    bar.innerHTML = '';
  }
  const canUpload = logged && (ME.role==='owner'||ME.role==='admin'||ME.role==='reseller');
  $('uploadLocked').classList.toggle('hidden', canUpload);
  $('uploadContent').classList.toggle('hidden', !canUpload);
  const canMyKeys = logged && (ME.role==='owner'||ME.role==='admin'||ME.role==='reseller');
  $('navMyKeys').classList.toggle('hidden', !canMyKeys);
  const canStore = logged && (ME.role==='owner'||ME.role==='admin'||ME.role==='reseller');
  $('navStore').classList.toggle('hidden', !canStore);
}

function lwSwitch(i){
  $('lwTabLogin').classList.toggle('on', i===0);
  $('lwTabRegister').classList.toggle('on', i===1);
  $('lwLogin').classList.toggle('hidden', i!==0);
  $('lwRegister').classList.toggle('hidden', i!==1);
}
async function lwDoLogin(){
  const identifier = $('lwUser').value.trim();
  const password = $('lwPass').value;
  const box = $('lwLoginResult');
  if(!identifier||!password){ box.className='result err'; box.innerHTML='Isi username/email & password'; return; }
  box.className='result info'; box.innerHTML='<span class="spinner"></span>Masuk...';
  const d = await apiCall('/?api=reseller/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier,password})});
  if(d.error){ box.className='result err'; box.innerHTML=esc(d.error); return; }
  TOKEN = d.token;
  localStorage.setItem('nang_session', TOKEN);
  setCookie('nang_session', TOKEN, 30);
  _lastRefreshAt = Date.now();
  localStorage.setItem('nang_last_refresh', String(_lastRefreshAt));
  if(d.noKv){
    box.className='result warn';
    box.innerHTML='⚠️ Berhasil masuk — tapi server belum pakai KV database!';
  } else {
    box.className='result ok'; box.innerHTML='Berhasil masuk';
  }
  await checkSession();
}
async function lwDoRegister(){
  const username = $('lwRegUser').value.trim();
  const email = $('lwRegEmail').value.trim();
  const password = $('lwRegPass').value;
  const pass2 = $('lwRegPass2').value;
  const box = $('lwRegResult');
  if(!username){ box.className='result err'; box.innerHTML='Username kosong'; return; }
  if(!email){ box.className='result err'; box.innerHTML='Email kosong'; return; }
  if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)){ box.className='result err'; box.innerHTML='Format email tidak valid'; return; }
  if(password!==pass2){ box.className='result err'; box.innerHTML='Password tidak sama'; return; }
  box.className='result info'; box.innerHTML='<span class="spinner"></span>Mendaftar...';
  const d = await apiCall('/?api=reseller/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,email,password})});
  if(d.error){ box.className='result err'; box.innerHTML=esc(d.error); return; }
  box.className='result ok'; box.innerHTML = esc(d.message || 'Terdaftar.') + ' Silakan login.';
  $('lwRegUser').value=''; $('lwRegEmail').value=''; $('lwRegPass').value=''; $('lwRegPass2').value='';
  setTimeout(()=>{ lwSwitch(0); $('lwUser').value = username; }, 800);
}
async function doAuthLogout(){
  if(TOKEN){
    try{ await apiCall('/?api=reseller/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TOKEN})}); }catch(e){}
  }
  TOKEN=null; ME=null;
  localStorage.removeItem('nang_session');
  localStorage.removeItem('nang_last_refresh');
  _lastRefreshAt = 0;
  delCookie('nang_session');
  updateAuthUI();
}

async function loadStores(){
  if(!TOKEN) return;
  const d = await apiCall('/?api=stores/list&token='+encodeURIComponent(TOKEN));
  if(!d.ok){ STORES = []; } else STORES = d.stores || [];
  const sel = $('buyStoreSel');
  if(!STORES.length){
    sel.innerHTML = '<option value="">Belum ada penjual aktif</option>';
    $('buyStoreInfo').innerHTML = 'Belum ada penjual aktif. Owner belum setup toko atau belum aktif.';
    return;
  }
  const prev = sel.value;
  sel.innerHTML = STORES.map((s,i)=>(
    '<option value="'+i+'">'+esc(s.name)+' ('+s.role+') — Rp'+(s.price||0).toLocaleString('id-ID')+'</option>'
  )).join('');
  if(prev && STORES[prev]) sel.value = prev;
  onStoreChange();
}
function onStoreChange(){
  const idx = parseInt($('buyStoreSel').value);
  if(isNaN(idx) || !STORES[idx]){
    $('buyStoreInfo').innerHTML = 'Pilih penjual di atas.';
    $('buyQrImg').style.display = 'none';
    $('buyQrPlaceholder').style.display = 'flex';
    $('buyWaNumLink').textContent = '-';
    $('buyWaNumLink').href = '#';
    return;
  }
  const s = STORES[idx];
  const price = s.price || 500;
  $('buyStoreInfo').innerHTML = 'Penjual: <span class="field">'+esc(s.name)+'</span><br>Harga: <span class="field">'+fmtRp(price)+'</span><br>WA: <span class="field">+'+esc(s.wa)+'</span>';
  $('buyPrice').textContent = fmtRp(price) + ' / Key';
  $('buyPriceTransfer').textContent = fmtRp(price);
  $('buyWaName').textContent = 'Beli Key ' + s.name;
  $('buyWaBtnText').textContent = 'Chat WhatsApp ' + s.name;
  $('buyWaNumLink').textContent = '+' + s.wa;
  $('buyWaNumLink').href = 'https://wa.me/' + s.wa;
  updateWA();
  if(s.hasQr){
    $('buyQrImg').style.display = 'block';
    $('buyQrPlaceholder').style.display = 'none';
    $('buyQrImg').src = "";
    apiCall('/?api=stores/qr&username='+encodeURIComponent(s.username)+'&token='+encodeURIComponent(TOKEN))
      .then(r => {
        if(r.ok && r.qr) $('buyQrImg').src = r.qr;
        else { $('buyQrImg').style.display = 'none'; $('buyQrPlaceholder').style.display = 'flex'; }
      })
      .catch(() => { $('buyQrImg').style.display = 'none'; $('buyQrPlaceholder').style.display = 'flex'; });
  } else {
    $('buyQrImg').style.display = 'none';
    $('buyQrPlaceholder').style.display = 'flex';
  }
}
function updateWA(){
  const idx = parseInt($('buyStoreSel').value);
  if(isNaN(idx) || !STORES[idx]){
    $('waBtn').href = '#'; $('waBtn').removeAttribute('target'); return;
  }
  const s = STORES[idx];
  const nama = lastLookup.name || '[isi di bawah]';
  const uid = lastLookup.uid || '[isi di bawah]';
  const text = 'Beli Key ' + s.name + '\\nNama: ' + nama + '\\nRoblox ID: ' + uid + '\\nBukti TF: [screenshot]';
  $('waBtn').href = 'https://wa.me/' + s.wa + '?text=' + encodeURIComponent(text);
  $('waBtn').setAttribute('target','_blank');
  $('waNama').textContent = nama;
  $('waUid').textContent = uid;
}
async function doLookup(){
  const uid=$('lookupId').value.trim();
  const box=$('lookupResult');
  if(!uid)return;
  box.style.display='block';box.className='result info';box.innerHTML='<span class="spinner"></span>Mencari...';
  try{
    const r=await fetch('/?lookup='+encodeURIComponent(uid));
    const d=await r.json();
    if(d.name){
      lastLookup={uid:d.uid,name:d.name};
      updateWA();
      box.style.display='none';
      const ex=$('userCard');if(ex)ex.remove();
      const card=document.createElement('div');
      card.id='userCard';card.className='user-card';
      card.innerHTML='<div class="user-avatar">'+esc(d.name.charAt(0).toUpperCase())+'</div><div class="user-info"><div class="user-name">'+esc(d.name)+'</div><div class="user-id">ID: '+esc(d.uid)+'</div></div>';
      box.parentNode.insertBefore(card,box.nextSibling);
    } else { box.className='result err';box.innerHTML='User ID tidak ditemukan'; }
  }catch(e){box.className='result err';box.innerHTML='Error: '+esc(e.message);}
}
let lookupT;$('lookupId').addEventListener('input',()=>{clearTimeout(lookupT);lookupT=setTimeout(doLookup,600);});

async function refreshMyKeys(){
  if(!TOKEN) return;
  const d = await apiCall('/?api=reseller/me&token='+encodeURIComponent(TOKEN));
  if(!d.ok) return;
  ME = d.user;
  const isReseller = ME.role === 'reseller';
  $('mkQuota').textContent = isReseller ? ME.quota : '∞';
  $('mkToday').textContent = ME.keysToday || 0;
  $('mkLeft').textContent = isReseller ? Math.max(0, ME.quota - (ME.keysToday||0)) : '∞';
  $('mkTotal').textContent = (ME.keys || []).length;
  const hist = $('mkHistory');
  if(!ME.keys || !ME.keys.length){
    hist.innerHTML = '<div style="color:var(--muted);font-size:.8rem">Belum ada key.</div>';
    return;
  }
  hist.innerHTML = ME.keys.map(k => (
    '<div class="key-item"><div class="info"><div class="k">'+esc(k.key)+'</div>'+
    '<div class="meta">UID: '+esc(k.uid)+' · '+esc(k.name||'?')+' · '+new Date(k.ts).toLocaleString('id-ID')+'</div></div>'+
    '<button class="cp" onclick="copyKey(\\''+k.key+'\\',this)">COPY</button></div>'
  )).join('');
}
function copyKey(k, btn){
  navigator.clipboard.writeText(k).then(()=>{
    if(btn){ btn.textContent = 'OK'; setTimeout(()=>{ btn.textContent = 'COPY'; }, 1200); }
  });
}
async function doMyKeysGenerate(){
  const uid = $('mkUid').value.trim();
  const box = $('mkResult');
  const btn = $('mkGenBtn');
  if(!uid){ box.className='result err'; box.innerHTML='Isi Roblox User ID'; return; }
  btn.disabled = true; btn.textContent = '...';
  box.className='result info'; box.innerHTML='<span class="spinner"></span>Generate...';
  try {
    const d = await apiCall('/?api=reseller/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TOKEN, uid})});
    if(d.error){ box.className='result err'; box.innerHTML=esc(d.error); return; }
    box.className='result ok';
    box.innerHTML = '<b>'+esc(d.username||'Unknown')+'</b><div class="key-line">'+esc(d.key)+'</div><div style="font-size:.75rem;color:var(--muted)">Berlaku: '+esc(d.expires)+' · Sisa: '+esc(d.remaining)+'</div><button class="btn-green" onclick="navigator.clipboard.writeText(\\''+d.key+'\\');this.textContent=\\'COPIED\\';setTimeout(()=>this.textContent=\\'COPY KEY\\',1500)">COPY KEY</button>';
    $('mkUid').value='';
    await refreshMyKeys();
  } catch(e) {
    box.className='result err'; box.innerHTML='Error: '+esc(e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'GENERATE KEY';
  }
}

async function refreshStore(){
  if(!TOKEN) return;
  const d = await apiCall('/?api=reseller/store&token='+encodeURIComponent(TOKEN));
  if(!d.ok) return;
  MY_STORE = d.store || { price: 500, wa: "", name: "", active: false, qr: "" };
  $('stName').value = MY_STORE.name || '';
  $('stPrice').value = MY_STORE.price || 500;
  $('stWa').value = MY_STORE.wa || '';
  $('stActiveSw').classList.toggle('on', !!MY_STORE.active);
  _qrData = MY_STORE.qr || "";
  if(_qrData){
    $('stQrPreview').src = _qrData;
    $('stQrPreviewWrap').classList.remove('hidden');
    $('stQrEmpty').classList.add('hidden');
    $('stQrDelBtn').style.display = 'block';
  } else {
    $('stQrPreview').src = "";
    $('stQrPreviewWrap').classList.add('hidden');
    $('stQrEmpty').classList.remove('hidden');
    $('stQrDelBtn').style.display = 'none';
  }
  updateStorePreview();
}
function toggleStoreActive(){ $('stActiveSw').classList.toggle('on'); updateStorePreview(); }
function onQrFileChange(e){
  const f = e.target.files[0];
  if(!f) return;
  if(!f.type.startsWith("image/")) { alert("Harus file gambar (PNG/JPG)"); return; }
  if(f.size > 500*1024) { alert("Max 500 KB"); return; }
  const r = new FileReader();
  r.onload = () => {
    _qrData = r.result;
    $('stQrPreview').src = _qrData;
    $('stQrPreviewWrap').classList.remove('hidden');
    $('stQrEmpty').classList.add('hidden');
    $('stQrDelBtn').style.display = 'block';
  };
  r.readAsDataURL(f);
  e.target.value = "";
}
function delQr(){
  _qrData = "";
  $('stQrPreview').src = "";
  $('stQrPreviewWrap').classList.add('hidden');
  $('stQrEmpty').classList.remove('hidden');
  $('stQrDelBtn').style.display = 'none';
}
function updateStorePreview(){
  const name = $('stName').value.trim() || '-';
  const price = parseInt($('stPrice').value) || 0;
  const waRaw = $('stWa').value.trim();
  let wa = waRaw.replace(/[^0-9]/g, '');
  if(wa.startsWith('0')) wa = '62' + wa.slice(1);
  wa = wa || '-';
  const active = $('stActiveSw').classList.contains('on');
  $('stPreview').innerHTML =
    'Nama: <span class="field">'+esc(name)+'</span><br>'+
    'Harga: <span class="field">'+fmtRp(price)+'</span><br>'+
    'WA: <span class="field">'+esc(wa)+'</span><br>'+
    'Status: <span class="field">'+(active ? 'Aktif' : 'Nonaktif')+'</span>';
}
$('stName').addEventListener('input', updateStorePreview);
$('stPrice').addEventListener('input', updateStorePreview);
$('stWa').addEventListener('input', updateStorePreview);

async function doSaveStore(){
  const name = $('stName').value.trim();
  const price = parseInt($('stPrice').value) || 0;
  let wa = $('stWa').value.trim().replace(/[^0-9]/g, '');
  const active = $('stActiveSw').classList.contains('on');
  const box = $('stResult');
  if(price < 0){ box.className='result err'; box.innerHTML='Harga tidak valid'; return; }
  if(active && wa.length < 8){ box.className='result err'; box.innerHTML='Kalau toko aktif, nomor WA wajib (min 8 digit)'; return; }
  box.className='result info'; box.innerHTML='<span class="spinner"></span>Menyimpan...';
  try {
    const d = await apiCall('/?api=reseller/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TOKEN, name, price, wa, active, qr: _qrData || ""})});
    if(d.error){ box.className='result err'; box.innerHTML=esc(d.error); return; }
    MY_STORE = d.store;
    box.className='result ok';
    box.innerHTML = 'Toko tersimpan! ' + (d.store.active ? 'Toko aktif, muncul di halaman Beli Key.' : 'Toko nonaktif.');
    await refreshStore();
    await loadStores();
  } catch(e) { box.className='result err'; box.innerHTML='Error: '+esc(e.message); }
}

function openOwnerModal(){
  $('ownerModal').classList.add('show');
  if(OWNER_TOKEN){
    $('ownerLoginForm').classList.add('hidden');
    $('ownerPanel').classList.remove('hidden');
    loadUsers();
  } else {
    $('ownerLoginForm').classList.remove('hidden');
    $('ownerPanel').classList.add('hidden');
  }
}
function closeOwnerModal(){ $('ownerModal').classList.remove('show'); }
$('ownerModal').addEventListener('click',e=>{ if(e.target.id==='ownerModal') closeOwnerModal(); });

async function doOwnerLogin(){
  const pw = $('oPw').value;
  const box = $('oResult');
  if(!pw){ box.className='result err'; box.innerHTML='Isi password'; return; }
  box.className='result info'; box.innerHTML='<span class="spinner"></span>Cek...';
  try {
    const r = await fetch('/?api=owner/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pw})});
    const txt = await r.text();
    let d;
    try { d = JSON.parse(txt); } catch(e) { box.className='result err'; box.innerHTML='Response bukan JSON: '+esc(txt.slice(0,120)); return; }
    if(!d.ok){ box.className='result err'; box.innerHTML=esc(d.error||'Gagal'); return; }
    OWNER_TOKEN = d.token;
    localStorage.setItem('nang_owner', OWNER_TOKEN);
    $('oPw').value='';
    box.className='result'; box.innerHTML='';
    $('ownerLoginForm').classList.add('hidden');
    $('ownerPanel').classList.remove('hidden');
    $('ownerFab').classList.add('active');
    loadUsers();
  } catch(e) { box.className='result err'; box.innerHTML='Error: '+esc(e.message); }
}
function doOwnerLogout(){
  OWNER_TOKEN = null;
  localStorage.removeItem('nang_owner');
  $('ownerLoginForm').classList.remove('hidden');
  $('ownerPanel').classList.add('hidden');
  $('ownerFab').classList.remove('active');
}
async function loadUsers(){
  const box = $('usersList');
  if(!OWNER_TOKEN){ box.innerHTML='<div style="color:var(--red);font-size:.8rem">Belum login owner</div>'; return; }
  box.innerHTML='<div style="color:var(--muted);font-size:.8rem"><span class="spinner"></span>Loading...</div>';
  try{
    const d = await apiCall('/?api=owner/users&ot='+encodeURIComponent(OWNER_TOKEN));
    if(d.error){ box.innerHTML='<div style="color:var(--red);font-size:.8rem">'+esc(d.error)+'</div>'; return; }
    if(!d.users || !d.users.length){ box.innerHTML='<div style="color:var(--muted);font-size:.8rem">Belum ada user</div>'; return; }
    box.innerHTML = d.users.map(u => {
      const isReseller = u.role === 'reseller';
      const isAdmin = u.role === 'admin';
      const isOwner = u.role === 'owner';
      const isBanned = u.role === 'banned';
      const isMember = u.role === 'member';
      let actions = '';
      if (!isReseller && !isAdmin && !isOwner) actions += '<button onclick="setUserRole(\\''+u.username+'\\',\\'reseller\\')">→ Reseller</button>';
      if (!isAdmin && !isOwner) actions += '<button onclick="setUserRole(\\''+u.username+'\\',\\'admin\\')">→ Admin</button>';
      if (!isOwner && !isMember) actions += '<button onclick="setUserRole(\\''+u.username+'\\',\\'member\\')">→ Member</button>';
      if (!isOwner) {
        if (isBanned) actions += '<button onclick="setUserRole(\\''+u.username+'\\',\\'member\\')">Unban</button>';
        else actions += '<button onclick="setUserRole(\\''+u.username+'\\',\\'banned\\')">Ban</button>';
      }
      if (isReseller) actions += '<button onclick="editUserQuota(\\''+u.username+'\\','+u.quota+')">Q:'+u.quota+'</button>';
      if ((isReseller || isAdmin || isOwner)) actions += '<button onclick="editUserStore(\\''+u.username+'\\')">🏪 Toko</button>';
      if (ME && ME.role === 'owner' && u.username !== ME.username) actions += '<button onclick="delUser(\\''+u.username+'\\')">Hapus</button>';
      const storeInfo = (u.store && u.store.active && u.store.wa) ? ' · 🏪 '+fmtRp(u.store.price||0) : '';
      return '<div class="user-row"><div><div class="name">'+esc(u.username)+' <span class="role-tag '+u.role+'">'+u.role+'</span></div>'+
        '<div class="meta">'+(u.email ? esc(u.email) + ' · ' : '')+'q:'+u.quota+' t:'+u.keysToday+storeInfo+'</div></div>'+
        '<div class="row-actions">'+actions+'</div></div>';
    }).join('');
  }catch(e){ box.innerHTML='<div style="color:var(--red);font-size:.8rem">Error: '+esc(e.message)+'</div>'; }
}
async function setUserRole(username, role){
  const d = await apiCall('/?api=owner/setrole',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ot:OWNER_TOKEN, username, role})});
  if(d.error) return alert(d.error);
  loadUsers();
}
async function editUserQuota(username, current){
  const v = prompt('Kuota harian untuk '+username+':', current);
  if(v===null) return;
  const d = await apiCall('/?api=owner/setquota',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ot:OWNER_TOKEN, username, quota:parseInt(v)||0})});
  if(d.error) return alert(d.error);
  loadUsers();
}
async function delUser(username){
  if(!confirm('Hapus user '+username+'?')) return;
  const d = await apiCall('/?api=owner/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ot:OWNER_TOKEN, username})});
  if(d.error) return alert(d.error);
  loadUsers();
}
async function editUserStore(username){
  const all = await apiCall('/?api=owner/users&ot='+encodeURIComponent(OWNER_TOKEN));
  if(!all.ok) return alert('Gagal load');
  const u = (all.users || []).find(x => x.username === username);
  if(!u) return alert('User gak ada');
  const st = u.store || { price: 500, wa: '', name: username, active: false };
  const name = prompt('Nama toko untuk '+username+':', st.name || username);
  if(name === null) return;
  const price = prompt('Harga per key (angka, Rp):', st.price || 500);
  if(price === null) return;
  const wa = prompt('Nomor WA (contoh 08123xxx / 628123xxx):', st.wa || '');
  if(wa === null) return;
  const active = confirm('Aktifkan toko di halaman Beli Key?\\n\\nOK = Aktifkan\\nCancel = Nonaktif');
  const d = await apiCall('/?api=owner/setstore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ot:OWNER_TOKEN, username, name, price: parseInt(price)||0, wa, active})});
  if(d.error) return alert(d.error);
  loadUsers();
}
async function doOwnerGen(){
  const uid = $('oGenUid').value.trim();
  const box = $('oGenResult');
  if(!uid) { box.className='result err'; box.innerHTML='Isi User ID'; return; }
  box.className='result info'; box.innerHTML='<span class="spinner"></span>Generate...';
  try {
    const r = await fetch('/?api=owner/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ot:OWNER_TOKEN, uid})});
    const d = await r.json();
    if(d.error){ box.className='result err'; box.innerHTML=esc(d.error); return; }
    box.className='result ok';
    box.innerHTML = '<b>'+esc(d.username||'Unknown')+'</b><div class="key-line">'+esc(d.key)+'</div><div style="font-size:.75rem;color:var(--muted)">Expires: '+esc(d.expires)+'</div>';
  } catch(e) { box.className='result err'; box.innerHTML='Error: '+esc(e.message); }
}

async function doConvert(){
  const input=$('convFile');
  const box=$('convResult');
  if(!input.files||!input.files[0])return;
  const file=input.files[0];
  if(file.size>50*1024*1024){box.style.display='block';box.className='result err';box.innerHTML='File > 50 MB.';return;}
  box.style.display='block';box.className='result info';box.innerHTML='<span class="spinner"></span>Mengkonversi '+esc(file.name)+'...';
  try{
    const buf=await file.arrayBuffer();
    const r=await fetch('/?api=convert',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:buf});
    const text=await r.text();
    let errMsg=null;
    try{const j=JSON.parse(text);if(j&&j.ok===false){errMsg=j.error||'Konversi gagal';}}catch{}
    if(!r.ok||errMsg){box.className='result err';box.innerHTML='Gagal: '+esc(errMsg||text.slice(0,200));return;}
    const outName=file.name.replace(/\\.(rbxl|rbxm)$/i,'.rbxlx')||('converted-'+Date.now()+'.rbxlx');
    const blob=new Blob([text],{type:'text/xml'});
    const url=URL.createObjectURL(blob);
    box.className='result ok';
    box.innerHTML='Berhasil!<div class="key-line"><a href="'+url+'" download="'+outName+'" style="color:#00d4ff;text-decoration:none">⬇ Download '+outName+'</a></div>';
  }catch(e){box.className='result err';box.innerHTML='Error: '+esc(e.message);}
}

// ============================================================
// UPLOAD — Model + Audio
// ============================================================
let _upFile=null;
const upDrop=$('upDrop');
const upFileInput=$('upFileInput');
const upBigResult=$('upBigResult');

upDrop.addEventListener('click',()=>upFileInput.click());
upDrop.addEventListener('dragover',e=>{e.preventDefault();upDrop.classList.add('over');});
upDrop.addEventListener('dragleave',()=>upDrop.classList.remove('over'));
upDrop.addEventListener('drop',e=>{e.preventDefault();upDrop.classList.remove('over');if(e.dataTransfer.files.length)_upHandleFile(e.dataTransfer.files[0]);});
upFileInput.addEventListener('change',e=>{if(e.target.files.length)_upHandleFile(e.target.files[0]);});

function upSetType(t){
  _upAssetType = t;
  $('upTypeModel').classList.toggle('on', t === 'Model');
  $('upTypeAudio').classList.toggle('on', t === 'Audio');
  const isAudio = t === 'Audio';
  const accept = isAudio ? '.mp3,.ogg,.wav,.flac' : '.rbxm,.rbxmx';
  const hint = isAudio ? '.mp3 / .ogg / .wav / .flac — max 4 MB' : '.rbxm / .rbxmx — max 4 MB';
  const icon = isAudio ? '🎵' : '📦';
  upFileInput.setAttribute('accept', accept);
  upDrop.querySelector('.drop-hint').textContent = hint;

  // Reset file kalau ekstensi gak match tipe baru
  if (_upFile) {
    const n = _upFile.name.toLowerCase();
    const ok = isAudio ? /\.(mp3|ogg|wav|flac)$/.test(n) : /\.(rbxm|rbxmx)$/.test(n);
    if (!ok) {
      _upFile = null;
      upDrop.classList.remove('done');
      upDrop.querySelector('.drop-icon').textContent = icon;
      upDrop.querySelector('.drop-text').textContent = 'Klik atau drop file';
      upDrop.querySelector('.drop-hint').textContent = hint;
      _upHideBig();
    }
  } else {
    upDrop.querySelector('.drop-icon').textContent = icon;
  }
}

function _upHandleFile(f){
  const n=f.name.toLowerCase();
  const isAudio = _upAssetType === 'Audio';
  const valid = isAudio ? /\.(mp3|ogg|wav|flac)$/.test(n) : /\.(rbxm|rbxmx)$/.test(n);
  if(!valid){
    return _upBigShowFail(
      isAudio ? 'File harus .mp3 / .ogg / .wav / .flac' : 'File harus .rbxm atau .rbxmx',
      'Ekstensi file lu: .' + f.name.split('.').pop()
    );
  }
  if(f.size>4*1024*1024){
    return _upBigShowFail('File > 4 MB', 'Ukuran: ' + (f.size/1024/1024).toFixed(2) + ' MB.');
  }
  _upFile=f;
  upDrop.classList.add('done');
  upDrop.querySelector('.drop-icon').textContent='✓';
  upDrop.querySelector('.drop-text').textContent=f.name;
  upDrop.querySelector('.drop-hint').textContent=(f.size/1024).toFixed(1)+' KB';
  _upHideBig();
}
function _upHideBig(){ upBigResult.className='result-big'; upBigResult.innerHTML=''; }
function _upBigShowFail(msg, hint){
  $('upProgress').style.display='none';
  upBigResult.className='result-big fail show';
  upBigResult.innerHTML =
    '<div class="big-title"><span class="ico">❌</span>GAGAL UPLOAD</div>'+
    '<div class="err-msg">'+esc(msg)+'</div>'+
    (hint ? '<div class="err-hint">💡 '+esc(hint)+'</div>' : '');
  try { window.scrollTo({top: upBigResult.offsetTop - 100, behavior:'smooth'}); } catch(e){}
}
function _upBigShowSuccess(assetId, assetName, assetType){
  $('upProgress').style.display='none';
  const ico = assetType === 'Audio' ? '🎵' : '📦';
  upBigResult.className='result-big success show';
  upBigResult.innerHTML =
    '<div class="big-title"><span class="ico">✅</span>UPLOAD BERHASIL!</div>'+
    '<div style="font-size:.88rem;margin-bottom:6px">'+ico+' <b>'+esc(assetName||'Asset')+'</b> sudah masuk ke Roblox:</div>'+
    '<div class="asset-id">Asset ID: '+esc(assetId)+'</div>'+
    '<a class="link-btn" href="https://www.roblox.com/library/'+encodeURIComponent(assetId)+'" target="_blank">🌐 Buka di Roblox</a>'+
    '<button class="cp-btn" onclick="navigator.clipboard.writeText(\\''+assetId+'\\');this.textContent=\\'✓ COPIED\\';setTimeout(()=>this.textContent=\\'📋 COPY ASSET ID\\',1500)">📋 COPY ASSET ID</button>'+
    '<div style="font-size:.74rem;margin-top:12px;color:rgba(255,255,255,.6);line-height:1.7">'+
      (assetType === 'Audio'
        ? 'Audio perlu <b>moderation Roblox</b> dulu — bisa 5-30 menit sebelum approved. Cek di <b>Creator Dashboard → Audio</b>.'
        : 'Asset perlu <b>beberapa menit</b> buat muncul di Roblox Studio. Cek di <b>Toolbox → Inventory → Models</b>.')+
    '</div>';
  try { window.scrollTo({top: upBigResult.offsetTop - 100, behavior:'smooth'}); } catch(e){}
}
function _upStep(n, state){
  const el = $('step'+n);
  if(!el) return;
  el.classList.remove('active','done','err');
  if(state) el.classList.add(state);
}

async function doUploadRbxm(){
  const username=$('upUsername').value.trim();
  const apiKey=$('upApiKey').value.trim();
  const name=$('upName').value.trim();
  const desc=$('upDesc').value.trim();

  if(!username) return _upBigShowFail('Username / User ID Roblox kosong', 'Isi kolom "Akun Roblox" dulu.');
  if(!apiKey) return _upBigShowFail('API Key Roblox kosong', 'Bikin key di create.roblox.com → Credentials.');
  if(!_upFile) return _upBigShowFail('Belum ada file dipilih', 'Klik/drop file dulu.');

  const btn=$('upBtn');
  btn.disabled=true; btn.textContent='⏳ PROSES...';
  _upHideBig();
  $('upProgress').style.display='block';
  _upStep(1,'active'); _upStep(2,''); _upStep(3,''); _upStep(4,'');

  try{
    const lk=await apiCall('/?api=lookup-user',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({query:username})
    });
    if(!lk.ok){
      _upStep(1,'err');
      throw new Error('Gagal cari akun Roblox: '+(lk.error||'tidak ditemukan'));
    }
    _upStep(1,'done');

    _upStep(2,'active');
    const vk=await apiCall('/?api=verify-apikey',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({apiKey})
    });
    if(!vk.ok){
      _upStep(2,'err');
      throw new Error('API Key bermasalah: '+(vk.error||'tidak valid'));
    }
    _upStep(2,'done');

    _upStep(3,'active');
    const r = await fetch('/?api=upload-rbxm-raw', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-nang-apikey': apiKey,
        'x-nang-userid': String(lk.userId),
        'x-nang-filename': _upFile.name,
        'x-nang-display': (name || _upFile.name.replace(/\.(rbxm|rbxmx|mp3|ogg|wav|flac)$/i,'')).slice(0,50),
        'x-nang-desc': (desc || 'Upload via NANG web').slice(0,1000),
        'x-nang-assettype': _upAssetType
      },
      body: _upFile
    });

    const upText = await r.text();
    let up;
    try { up = JSON.parse(upText); }
    catch(e){
      _upStep(3,'err');
      throw new Error('Server tidak balikin JSON. Response: ' + upText.slice(0, 200));
    }
    if(!up.ok){
      _upStep(3,'err');
      let em = up.error || 'Upload gagal';
      if(up.debug) em += ' · ['+up.debug.size+' bytes · userId '+up.debug.userId+' · type '+up.debug.assetType+' · HTTP '+up.debug.status+']';
      throw new Error(em);
    }
    _upStep(3,'done');

    _upStep(4,'active');
    let assetId=null, lastErr=null;
    for(let i=0;i<80;i++){
      await new Promise(res=>setTimeout(res,1500));
      const st=await apiCall('/?api=upload-status&id='+encodeURIComponent(up.operationId)+'&k='+encodeURIComponent(apiKey));
      if(!st.ok){ lastErr = st.error; continue; }
      if(st.done){
        if(st.error){
          _upStep(4,'err');
          throw new Error('Roblox tolak asset: ' + st.error);
        }
        assetId = st.assetId;
        break;
      }
    }
    if(!assetId){
      _upStep(4,'err');
      throw new Error(lastErr || 'Timeout setelah 2 menit. Cek dashboard Roblox.');
    }
    _upStep(4,'done');

    _upBigShowSuccess(assetId, name || _upFile.name.replace(/\.(rbxm|rbxmx|mp3|ogg|wav|flac)$/i,''), _upAssetType);
  }
  catch(e){
    _upBigShowFail(e.message || 'Error tidak diketahui');
  }
  finally{
    btn.disabled=false; btn.textContent='UPLOAD KE ROBLOX';
  }
}

document.addEventListener('DOMContentLoaded',()=>{
  if(!TOKEN){
    const ck = getCookie('nang_session');
    if(ck){ TOKEN = ck; localStorage.setItem('nang_session', ck); }
  }
  checkSession();
  ['lwUser','lwPass'].forEach(id=>$(id).addEventListener('keydown',e=>{if(e.key==='Enter')lwDoLogin();}));
  ['lwRegUser','lwRegEmail','lwRegPass','lwRegPass2'].forEach(id=>$(id).addEventListener('keydown',e=>{if(e.key==='Enter')lwDoRegister();}));
  ['oPw'].forEach(id=>$(id).addEventListener('keydown',e=>{if(e.key==='Enter')doOwnerLogin();}));
  ['oGenUid'].forEach(id=>$(id).addEventListener('keydown',e=>{if(e.key==='Enter')doOwnerGen();}));
  ['mkUid'].forEach(id=>$(id).addEventListener('keydown',e=>{if(e.key==='Enter')doMyKeysGenerate();}));

  // Auto-detect akun Roblox
  let _upUserT;
  $('upUsername').addEventListener('input',()=>{
    clearTimeout(_upUserT);
    const v=$('upUsername').value.trim();
    const h=$('upUserHint');
    if(!v){h.className='hint';h.textContent='';return;}
    h.className='hint';
    h.innerHTML='<span class="spinner"></span>Mencari...';
    _upUserT=setTimeout(async()=>{
      const d=await apiCall('/?api=lookup-user',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({query:v})
      });
      if(d.ok){
        h.className='hint ok';
        h.textContent='✓ '+d.name+(d.displayName&&d.displayName!==d.name?' ('+d.displayName+')':'')+' · ID '+d.userId;
      }else{
        h.className='hint err';
        h.textContent='✗ '+(d.error||'tidak ditemukan');
      }
    },500);
  });

  // Auto-verify API key
  $('upApiKey').addEventListener('blur',async()=>{
    const k=$('upApiKey').value.trim();
    const h=$('upKeyHint');
    if(!k){h.className='hint';h.textContent='';return;}
    h.className='hint';
    h.innerHTML='<span class="spinner"></span>Verifikasi API key...';
    const d=await apiCall('/?api=verify-apikey',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({apiKey:k})
    });
    if(d.ok){ h.className='hint ok'; h.textContent='✓ API key valid'; }
    else { h.className='hint err'; h.textContent='✗ '+(d.error||'tidak valid'); }
  });
});
</script></body></html>`;
}
