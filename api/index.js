const BUILD = "68.10";
const NANG_WEBHOOK = "https://discord.com/api/webhooks/1554789657705844819/S-AEYb2JOZy7Ixr1KotRTjy91j2ogk3U6-6ODK41Zf4AyEyAnHTIUu6mGN_etsYcYMhS";

import { createHash, randomBytes } from "node:crypto";

const _KV_URL   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL   || "";
const _KV_TOKEN = process.env.KV_REST_API_TOKEN  || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const _HAS_KV   = !!(_KV_URL && _KV_TOKEN);

// ─── KV wrapper — pipeline agar satu roundtrip per batch ───────────────────
async function _kvCmd(...args) {
  if (!_HAS_KV) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(_KV_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + _KV_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify([args]),   // pipeline: array of commands
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const d = await r.json();
    // pipeline response: [{result:...}, ...]
    if (Array.isArray(d) && d[0] != null) return d[0].result ?? null;
    if (d && d.result !== undefined) return d.result;
    return null;
  } catch { return null; }
}

// _memStore hanya dipakai sebagai write-through cache dalam satu invocation
// Jangan andalkan ini antar request di Vercel
const _memStore = (global.__nangMem = global.__nangMem || {});

// ─── Store helpers — SELALU tulis ke KV, baca KV dulu ─────────────────────
async function storeGet(key) {
  // 1. coba KV
  if (_HAS_KV) {
    const raw = await _kvCmd("GET", key);
    if (raw !== null && raw !== undefined) {
      if (typeof raw === "string") {
        try { const v = JSON.parse(raw); _memStore[key] = v; return v; }
        catch { _memStore[key] = raw; return raw; }
      }
      _memStore[key] = raw;
      return raw;
    }
  }
  // 2. fallback in-memory (hanya kalau KV benar-benar unavailable)
  return _memStore[key] ?? null;
}

async function storeSet(key, val, exSec) {
  const raw = typeof val === "string" ? val : JSON.stringify(val);
  _memStore[key] = val; // write-through cache
  if (_HAS_KV) {
    // SET dengan optional EX (TTL detik)
    const args = exSec ? ["SET", key, raw, "EX", exSec] : ["SET", key, raw];
    const r = await _kvCmd(...args);
    return r !== null;
  }
  return true;
}

async function storeDel(key) {
  delete _memStore[key];
  if (_HAS_KV) { await _kvCmd("DEL", key); }
  return true;
}

// ─── Auth helpers ───────────────────────────────────────────────────────────
function hashPw(pw, salt) {
  return createHash("sha256").update(salt + "::" + pw).digest("hex");
}
function randomHex(n) { return randomBytes(n).toString("hex"); }

const DEFAULT_STORE = { price: 500, wa: "", name: "", active: false, qr: "" };
const DEFAULT_QUOTA = 10;
// Session TTL: 30 hari
const SESSION_DAYS  = 30;
const SESSION_SEC   = SESSION_DAYS * 24 * 3600;
const SESSION_MS    = SESSION_SEC  * 1000;
// Owner token TTL: 7 hari
const OWNER_SEC     = 7 * 24 * 3600;

function ensureStore(u) {
  if (!u) return u;
  if (!u.store) u.store = { ...DEFAULT_STORE };
  if (typeof u.store.price   !== "number")  u.store.price  = 500;
  if (typeof u.store.wa      !== "string")  u.store.wa     = "";
  if (typeof u.store.name    !== "string")  u.store.name   = "";
  if (typeof u.store.active  !== "boolean") u.store.active = false;
  if (typeof u.store.qr      !== "string")  u.store.qr     = "";
  return u;
}

async function getUser(username) {
  if (!username) return null;
  const u = await storeGet("nang:user:" + String(username).toLowerCase());
  return ensureStore(u);
}
async function saveUser(user) {
  ensureStore(user);
  // simpan user tanpa TTL — data permanen
  await storeSet("nang:user:" + user.username.toLowerCase(), user);
  if (_HAS_KV) await _kvCmd("SADD", "nang:userlist", user.username);
  return true;
}
async function listUsers() {
  const out = [], seen = {};
  if (_HAS_KV) {
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

// ─── Session helpers — token disimpan di KV dengan TTL ────────────────────
const SESS_KEY  = (tok) => "nang:sess:"  + tok;
const OWNER_KEY = (tok) => "nang:owner:" + tok;

async function createSession(username) {
  const token = randomHex(32);
  const payload = { username, expiresAt: Date.now() + SESSION_MS };
  // simpan di KV dengan TTL otomatis; juga cache memory
  _memStore[SESS_KEY(token)] = payload;
  await storeSet(SESS_KEY(token), payload, SESSION_SEC);
  return token;
}

async function getSession(token) {
  if (!token) return null;
  // coba mem cache dulu
  const mem = _memStore[SESS_KEY(token)];
  if (mem && mem.expiresAt > Date.now()) return mem;
  // baca KV
  const sess = await storeGet(SESS_KEY(token));
  if (!sess) return null;
  if (!sess.expiresAt || sess.expiresAt < Date.now()) {
    await storeDel(SESS_KEY(token));
    return null;
  }
  _memStore[SESS_KEY(token)] = sess;
  return sess;
}

async function deleteSession(token) {
  if (!token) return;
  delete _memStore[SESS_KEY(token)];
  await storeDel(SESS_KEY(token));
}

async function createOwnerToken(role) {
  const token = randomHex(24);
  const payload = { expiresAt: Date.now() + OWNER_SEC * 1000, role: role || "owner" };
  _memStore[OWNER_KEY(token)] = payload;
  await storeSet(OWNER_KEY(token), payload, OWNER_SEC);
  return token;
}

async function getOwnerSession(token) {
  if (!token) return null;
  const mem = _memStore[OWNER_KEY(token)];
  if (mem && mem.expiresAt > Date.now()) return mem;
  const sess = await storeGet(OWNER_KEY(token));
  if (!sess || !sess.expiresAt || sess.expiresAt < Date.now()) return null;
  _memStore[OWNER_KEY(token)] = sess;
  return sess;
}

// ─── Key system ────────────────────────────────────────────────────────────
const _SECRET    = "NANG2024";
const _EXPIRE_MS = 24 * 60 * 60 * 1000;

function _simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h * 31) + str.charCodeAt(i)) % 1000000007;
  return h;
}
function _makeKeyAt(uid, ts) {
  const code = Math.floor(ts / 60000) % 10000;
  const h    = _simpleHash(_SECRET + String(uid) + String(code));
  const p1   = String(uid).slice(0, 5).padEnd(5, "0");
  return "NANG-" + p1 + "-" + String(h % 10000).padStart(4, "0") + "-" + String(Math.floor(h / 10000) % 10000).padStart(4, "0");
}
function _makeKey(uid) { return _makeKeyAt(uid, Date.now()); }
function _verifyKey(uid, key) {
  const k   = String(key || "").toUpperCase().replace(/\s+/g, "");
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
  try {
    const r = await fetch("https://users.roblox.com/v1/users/" + uid);
    if (!r.ok) return null;
    return (await r.json()).name || null;
  } catch { return null; }
}
function _getClientIP(req) {
  const xf = req.headers["x-forwarded-for"];
  if (xf) return String(xf).split(",")[0].trim();
  return req.headers["x-real-ip"] || "unknown";
}

// ─── Webhook ────────────────────────────────────────────────────────────────
async function sendWebhook(fields) {
  if (!NANG_WEBHOOK || NANG_WEBHOOK.includes("GANTI_INI")) return;
  try {
    await fetch(NANG_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "NANG Logger",
        embeds: [{ title: "NANG Event", color: 14433400, fields, timestamp: new Date().toISOString(), footer: { text: "NANG v" + BUILD } }],
      }),
    });
  } catch {}
}

// ─── Entry point ────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  try { return await handle(req, res); }
  catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(200).json({ error: "server error", detail: String(e.message || e) });
  }
}

async function handle(req, res) {
  const ADMIN_PW    = "nangowner123";
  const WA_NUMBER   = "6281252425581";
  const AUTH_DOMAIN = req.headers.host || "localhost";

  function b64urlEncode(obj) {
    let b64 = Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64urlDecode(str) {
    let s = str.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return Buffer.from(s, "base64").toString("utf8");
  }

  const url    = new URL(req.url, "https://" + AUTH_DOMAIN);
  const params = url.searchParams;
  const path   = url.pathname;
  const method = req.method;

  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (method === "OPTIONS") { res.status(200).end(); return; }

  if (params.has("version")) { res.status(200).json({ version: BUILD, ts: Date.now(), kv: _HAS_KV }); return; }

  if (params.has("api") || path.startsWith("/api/")) {
    const apiPath = params.has("api") ? "/api/" + String(params.get("api") || "") : path;
    return await handleApi(req, res, apiPath, method, params, { ADMIN_PW, WA_NUMBER });
  }

  // POST key verify (dari script Roblox)
  if (method === "POST") {
    let body = "";
    await new Promise(r => { req.on("data", c => body += c); req.on("end", r); });
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.status(400).json({ valid: false, error: "bad json" }); return; }
    const valid    = _verifyKey(parsed.uid, parsed.key).valid;
    let username   = null;
    if (valid) username = await _getRobloxUser(parsed.uid);
    if (valid) {
      sendWebhook([
        { name: "Event",     value: "Key Verified",            inline: false },
        { name: "Username",  value: String(username || "?"),   inline: true  },
        { name: "User ID",   value: String(parsed.uid),        inline: true  },
        { name: "Remaining", value: _expiryStr(parsed.uid, parsed.key), inline: true },
        { name: "IP",        value: _getClientIP(req),         inline: true  },
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
    const name  = data.n || await _getRobloxUser(data.u);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(authPage(data, valid, name));
    return;
  }

  if (params.has("uid") && params.has("key")) {
    const uid  = params.get("uid");
    const key  = params.get("key");
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
    const event    = String(params.get("log")   || "").slice(0, 64);
    const user     = String(params.get("user")  || "anon").slice(0, 32);
    const uid      = String(params.get("uid")   || "").slice(0, 20);
    const exec     = String(params.get("exec")  || "Unknown").slice(0, 32);
    const gameName = String(params.get("game")  || "Unknown").slice(0, 64);
    const placeId  = String(params.get("place") || "0").slice(0, 20);
    const jobId    = String(params.get("job")   || "").slice(0, 40);
    sendWebhook([
      { name: "Event",    value: event,              inline: false },
      { name: "Username", value: user,               inline: true  },
      { name: "User ID",  value: uid,                inline: true  },
      { name: "Executor", value: exec,               inline: true  },
      { name: "Game",     value: gameName,           inline: true  },
      { name: "Place ID", value: placeId,            inline: true  },
      { name: "Job ID",   value: jobId.slice(0, 8),  inline: true  },
      { name: "IP",       value: _getClientIP(req),  inline: true  },
    ]);
    res.status(200).json({ ok: true });
    return;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(mainPage(WA_NUMBER));
}

// ─── API routes ─────────────────────────────────────────────────────────────
async function handleApi(req, res, path, method, params, ctx) {
  const { ADMIN_PW, WA_NUMBER } = ctx;
  const route = path.replace(/^\/api\//, "").replace(/\/$/, "");

  let body = null;
  if (method === "POST") {
    let raw = "";
    await new Promise(r => { req.on("data", c => raw += c); req.on("end", r); });
    if (raw) { try { body = JSON.parse(raw); } catch { body = null; } }
  }

  res.setHeader("Content-Type", "application/json");

  // ── auth helper ──────────────────────────────────────────────────────────
  async function authFromToken() {
    const token = (body && body.token) || params.get("token");
    const sess  = await getSession(token);
    if (!sess) return null;
    const u = await getUser(sess.username);
    if (!u || u.role === "banned") return null;
    return u;
  }

  async function getOwnerRole(pw, ot) {
    if (pw === ADMIN_PW) return "owner";
    if (ot) {
      const sess = await getOwnerSession(ot);
      if (sess) return sess.role || "owner";
    }
    return null;
  }

  // ── owner verify ─────────────────────────────────────────────────────────
  if (route === "owner/verify" && method === "POST") {
    const pw = body && body.pw;
    if (pw !== ADMIN_PW) return res.status(200).json({ ok: false, error: "password salah" });
    const token = await createOwnerToken("owner");
    return res.status(200).json({ ok: true, token, role: "owner" });
  }

  // ── owner generate key ───────────────────────────────────────────────────
  if (route === "owner/generate" && method === "POST") {
    const reqRole = await getOwnerRole(body && body.pw, body && body.ot);
    if (!reqRole) return res.status(200).json({ error: "forbidden" });
    const uid = String((body && body.uid) || "").trim();
    if (!uid || !/^\d+$/.test(uid)) return res.status(200).json({ error: "User ID tidak valid" });
    const key  = _makeKey(uid);
    const name = await _getRobloxUser(uid);
    return res.status(200).json({ ok: true, key, expires: _expiryStr(uid, key), username: name });
  }

  // ── lookup roblox username ───────────────────────────────────────────────
  if (route === "lookup-username" && method === "POST") {
    const username = String((body && body.username) || "").trim();
    if (!username) return res.status(200).json({ ok: false, error: "username kosong" });
    try {
      const r = await fetch("https://users.roblox.com/v1/usernames/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usernames: [username], excludeBannedUsers: true }),
      });
      const data = await r.json();
      if (!data.data || !data.data[0]) return res.status(200).json({ ok: false, error: "Username tidak ditemukan" });
      return res.status(200).json({ ok: true, userId: data.data[0].id, name: data.data[0].name });
    } catch (e) {
      return res.status(200).json({ ok: false, error: String(e.message || e) });
    }
  }

  // ── upload rbxm ──────────────────────────────────────────────────────────
  if (route === "upload-rbxm" && method === "POST") {
    const { apiKey, userId, fileBase64, fileName = "model.rbxm", displayName = "Model", description = "" } = body || {};
    if (!apiKey || !userId || !fileBase64) return res.status(200).json({ ok: false, error: "data kurang" });
    try {
      const buffer = Buffer.from(fileBase64, "base64");
      const form   = new FormData();
      form.append("file", new Blob([buffer], { type: "application/octet-stream" }), fileName);
      form.append("assetType", "Model");
      form.append("displayName",   String(displayName).slice(0, 50));
      form.append("description",   String(description).slice(0, 1000));
      form.append("creationContext", JSON.stringify({ creator: { userId: Number(userId) } }));
      const r    = await fetch("https://apis.roblox.com/assets/v1/assets", { method: "POST", headers: { "x-api-key": apiKey }, body: form });
      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
      if (!r.ok) return res.status(200).json({ ok: false, error: "Roblox: " + (data.message || data.error || data.raw || "HTTP " + r.status) });
      const operationId = data.operationId || (data.path && data.path.split("/").pop());
      if (!operationId) return res.status(200).json({ ok: false, error: "Tidak dapat operationId", raw: data });
      return res.status(200).json({ ok: true, operationId });
    } catch (e) { return res.status(200).json({ ok: false, error: String(e.message || e) }); }
  }

  // ── upload status ─────────────────────────────────────────────────────────
  if (route === "upload-status" && method === "GET") {
    const operationId = params.get("id");
    const apiKey      = params.get("k");
    if (!operationId || !apiKey) return res.status(200).json({ ok: false, error: "missing" });
    try {
      const r    = await fetch("https://apis.roblox.com/assets/v1/operations/" + encodeURIComponent(operationId), { method: "GET", headers: { "x-api-key": apiKey } });
      const data = await r.json();
      if (data.done) {
        if (data.error) return res.status(200).json({ ok: true, done: true, error: data.error.message || "Upload gagal" });
        return res.status(200).json({ ok: true, done: true, assetId: data.response && data.response.assetId });
      }
      return res.status(200).json({ ok: true, done: false });
    } catch (e) { return res.status(200).json({ ok: false, error: String(e.message || e) }); }
  }

  // ── reseller register ─────────────────────────────────────────────────────
  if (route === "reseller/register" && method === "POST") {
    const username = String((body && body.username) || "").trim();
    const email    = String((body && body.email)    || "").trim().toLowerCase();
    const password = String((body && body.password) || "");
    if (username.length < 3)                         return res.status(200).json({ error: "Username minimal 3 karakter" });
    if (!/^[a-zA-Z0-9_]+$/.test(username))          return res.status(200).json({ error: "Username hanya huruf/angka/underscore" });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(200).json({ error: "Format email tidak valid" });
    if (password.length < 5)                         return res.status(200).json({ error: "Password minimal 5 karakter" });
    const exist = await getUser(username);
    if (exist) return res.status(200).json({ error: "Username sudah dipakai" });
    const emailExist = await storeGet("nang:email:" + email);
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
    await storeSet("nang:email:" + email, username); // simpan mapping email→username tanpa TTL
    sendWebhook([
      { name: "Event",    value: "New Member",    inline: false },
      { name: "Username", value: username,         inline: true  },
      { name: "Email",    value: email,            inline: true  },
      { name: "IP",       value: _getClientIP(req), inline: true },
    ]);
    return res.status(200).json({ ok: true, message: "Terdaftar sebagai member." });
  }

  // ── reseller login ────────────────────────────────────────────────────────
  if (route === "reseller/login" && method === "POST") {
    const identifier = String((body && (body.identifier || body.username)) || "").trim();
    const password   = String((body && body.password) || "");
    if (!identifier) return res.status(200).json({ error: "Username / email kosong" });
    // coba username langsung
    let user = await getUser(identifier);
    // coba email
    if (!user) {
      const usernameFromEmail = await storeGet("nang:email:" + identifier.toLowerCase());
      if (usernameFromEmail) user = await getUser(String(usernameFromEmail));
    }
    if (!user)                                               return res.status(200).json({ error: "Akun tidak ditemukan" });
    if (user.role === "banned")                             return res.status(200).json({ error: "Akun di-ban" });
    if (user.passwordHash !== hashPw(password, user.salt)) return res.status(200).json({ error: "Password salah" });
    // buat session baru, simpan ke KV dengan TTL
    const token = await createSession(user.username);
    return res.status(200).json({
      ok: true, token,
      user: { username: user.username, role: user.role, quota: user.quota, keysToday: user.keysToday },
    });
  }

  // ── reseller me ───────────────────────────────────────────────────────────
  if (route === "reseller/me") {
    const u = await authFromToken();
    if (!u) return res.status(200).json({ error: "not logged in" });
    // reset kuota harian jika sudah > 24 jam
    if (Date.now() - (u.lastReset || 0) > 24 * 3600 * 1000) {
      u.keysToday = 0; u.lastReset = Date.now();
      await saveUser(u);
    }
    return res.status(200).json({
      ok: true,
      user: {
        username: u.username, email: u.email || null, role: u.role,
        quota: u.quota, keysToday: u.keysToday, keys: u.keys || [],
        createdAt: u.createdAt, store: u.store || { ...DEFAULT_STORE },
      },
    });
  }

  // ── reseller refresh ──────────────────────────────────────────────────────
  if (route === "reseller/refresh" && method === "POST") {
    const u = await authFromToken();
    if (!u) return res.status(200).json({ error: "not logged in" });
    const oldToken = (body && body.token) || params.get("token");
    await deleteSession(oldToken);
    const token = await createSession(u.username);
    return res.status(200).json({ ok: true, token });
  }

  // ── reseller logout ───────────────────────────────────────────────────────
  if (route === "reseller/logout" && method === "POST") {
    const token = (body && body.token) || params.get("token");
    await deleteSession(token);
    return res.status(200).json({ ok: true });
  }

  // ── reseller generate key ─────────────────────────────────────────────────
  if (route === "reseller/generate" && method === "POST") {
    const u = await authFromToken();
    if (!u) return res.status(200).json({ error: "not logged in" });
    const canGenerate = ["reseller", "admin", "owner"].includes(u.role);
    if (!canGenerate) return res.status(200).json({ error: "Role belum bisa generate." });
    if (Date.now() - (u.lastReset || 0) > 24 * 3600 * 1000) { u.keysToday = 0; u.lastReset = Date.now(); }
    if (u.role === "reseller" && u.keysToday >= u.quota) return res.status(200).json({ error: "Kuota harian habis (" + u.quota + ")" });
    const uid = String((body && body.uid) || "").trim();
    if (!uid || !/^\d+$/.test(uid)) return res.status(200).json({ error: "Roblox User ID tidak valid" });
    const key  = _makeKey(uid);
    const name = await _getRobloxUser(uid);
    u.keysToday = (u.keysToday || 0) + 1;
    u.keys      = u.keys || [];
    u.keys.unshift({ uid, key, name: name || "Unknown", ts: Date.now(), by: u.username });
    if (u.keys.length > 100) u.keys = u.keys.slice(0, 100);
    await saveUser(u);
    return res.status(200).json({
      ok: true, key, expires: _expiryStr(uid, key), username: name,
      remaining: u.role === "reseller" ? (u.quota - u.keysToday) : "unlimited",
    });
  }

  // ── reseller store GET ────────────────────────────────────────────────────
  if (route === "reseller/store" && method === "GET") {
    const u = await authFromToken();
    if (!u) return res.status(200).json({ error: "not logged in" });
    if (!["reseller","admin","owner"].includes(u.role)) return res.status(200).json({ error: "role belum bisa punya toko" });
    return res.status(200).json({ ok: true, store: u.store || { ...DEFAULT_STORE } });
  }

  // ── reseller store POST ───────────────────────────────────────────────────
  if (route === "reseller/store" && method === "POST") {
    const u = await authFromToken();
    if (!u) return res.status(200).json({ error: "not logged in" });
    if (!["reseller","admin","owner"].includes(u.role)) return res.status(200).json({ error: "role belum bisa punya toko" });
    const price  = Math.max(0, Math.min(99999999, parseInt(body.price) || 500));
    let wa       = String(body.wa || "").trim().replace(/[^0-9]/g, "");
    const name   = String(body.name || "").trim().slice(0, 40);
    const active = !!body.active;
    let qr       = String(body.qr || "").trim();
    if (qr && !qr.startsWith("data:image/")) return res.status(200).json({ error: "Format QR tidak valid" });
    if (qr.length > 700000)                  return res.status(200).json({ error: "QR terlalu besar (max ~500 KB)" });
    if (wa && wa.length < 8)                 return res.status(200).json({ error: "Nomor WA minimal 8 digit" });
    if (wa.startsWith("0"))                  wa = "62" + wa.slice(1);
    u.store = { price, wa, name: name || u.username, active: (active && wa.length >= 8), qr };
    await saveUser(u);
    sendWebhook([
      { name: "Event",    value: "Store Updated", inline: false },
      { name: "Username", value: u.username,       inline: true  },
      { name: "Price",    value: "Rp" + price,     inline: true  },
      { name: "Active",   value: u.store.active ? "Ya" : "Tidak", inline: true },
    ]);
    return res.status(200).json({ ok: true, store: u.store });
  }

  // ── stores list ───────────────────────────────────────────────────────────
  if (route === "stores/list" && method === "GET") {
    const u = await authFromToken();
    if (!u) return res.status(200).json({ error: "not logged in" });
    const all    = await listUsers();
    const stores = all
      .filter(x => x.store && x.store.active && x.store.wa && x.role !== "banned" && x.role !== "member")
      .map(x => ({ username: x.username, name: x.store.name || x.username, price: x.store.price || 500, wa: x.store.wa, hasQr: !!(x.store.qr && x.store.qr.length > 0), role: x.role }));
    const order = { owner: 0, admin: 1, reseller: 2 };
    stores.sort((a, b) => (order[a.role] || 9) - (order[b.role] || 9) || a.name.localeCompare(b.name));
    return res.status(200).json({ ok: true, stores });
  }

  // ── stores qr ─────────────────────────────────────────────────────────────
  if (route === "stores/qr" && method === "GET") {
    const u = await authFromToken();
    if (!u) return res.status(200).json({ error: "not logged in" });
    const target = String(params.get("username") || "").trim();
    if (!target) return res.status(200).json({ error: "username kosong" });
    const t = await getUser(target);
    if (!t || !t.store || !t.store.active || !t.store.wa) return res.status(200).json({ ok: true, qr: "" });
    return res.status(200).json({ ok: true, qr: t.store.qr || "" });
  }

  // ── owner setstore ────────────────────────────────────────────────────────
  if (route === "owner/setstore" && method === "POST") {
    const reqRole = await getOwnerRole(body && body.pw, body && body.ot);
    if (!reqRole || !["owner","admin"].includes(reqRole)) return res.status(200).json({ error: "forbidden" });
    const target = String(body.username || "").trim();
    const u = await getUser(target);
    if (!u) return res.status(200).json({ error: "user tidak ditemukan" });
    if (!["reseller","admin","owner"].includes(u.role)) return res.status(200).json({ error: "role target belum bisa punya toko" });
    const price  = Math.max(0, Math.min(99999999, parseInt(body.price) || 500));
    let wa       = String(body.wa || "").trim().replace(/[^0-9]/g, "");
    const name   = String(body.name || "").trim().slice(0, 40);
    const active = !!body.active;
    if (wa.startsWith("0")) wa = "62" + wa.slice(1);
    let qr = String(body.qr || "").trim();
    if (qr && !qr.startsWith("data:image/")) qr = "";
    if (qr.length > 700000)                  qr = "";
    u.store = { price, wa, name: name || u.username, active: (active && wa.length >= 8), qr: qr || (u.store && u.store.qr) || "" };
    await saveUser(u);
    return res.status(200).json({ ok: true, store: u.store });
  }

  // ── owner users ───────────────────────────────────────────────────────────
  if (route === "owner/users") {
    const reqRole = await getOwnerRole(params.get("pw") || (body && body.pw), params.get("ot") || (body && body.ot));
    if (!reqRole) {
      const u = await authFromToken();
      if (!u || !["owner","admin"].includes(u.role)) return res.status(200).json({ error: "forbidden" });
    }
    const users = await listUsers();
    users.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return res.status(200).json({
      ok: true,
      users: users.map(u => ({
        username: u.username, email: u.email || null, role: u.role,
        quota: u.quota, keysToday: u.keysToday, totalKeys: (u.keys || []).length,
        createdAt: u.createdAt, store: u.store || null,
      })),
    });
  }

  // ── owner setrole ─────────────────────────────────────────────────────────
  if (route === "owner/setrole" && method === "POST") {
    const reqRole = await getOwnerRole(body && body.pw, body && body.ot);
    if (!reqRole) return res.status(200).json({ error: "forbidden" });
    const target = String((body && body.username) || "").trim();
    const role   = String((body && body.role) || "");
    if (!["member","reseller","admin","owner","banned"].includes(role)) return res.status(200).json({ error: "role invalid" });
    const u = await getUser(target);
    if (!u) return res.status(200).json({ error: "user tidak ditemukan" });
    if (reqRole === "admin") {
      if (["admin","owner"].includes(u.role))  return res.status(200).json({ error: "admin gak bisa ubah " + u.role });
      if (["admin","owner"].includes(role))    return res.status(200).json({ error: "admin gak bisa promote ke " + role });
    }
    u.role = role;
    if (role === "reseller" && (!u.quota || u.quota < 1)) u.quota = DEFAULT_QUOTA;
    await saveUser(u);
    return res.status(200).json({ ok: true });
  }

  // ── owner setquota ────────────────────────────────────────────────────────
  if (route === "owner/setquota" && method === "POST") {
    const reqRole = await getOwnerRole(body && body.pw, body && body.ot);
    if (!reqRole || !["owner","admin"].includes(reqRole)) return res.status(200).json({ error: "forbidden" });
    const target = String((body && body.username) || "").trim();
    const quota  = Math.max(0, Math.min(9999, parseInt(body && body.quota) || 0));
    const u = await getUser(target);
    if (!u) return res.status(200).json({ error: "user tidak ditemukan" });
    u.quota = quota;
    await saveUser(u);
    return res.status(200).json({ ok: true });
  }

  // ── owner delete ──────────────────────────────────────────────────────────
  if (route === "owner/delete" && method === "POST") {
    const reqRole = await getOwnerRole(body && body.pw, body && body.ot);
    if (reqRole !== "owner") return res.status(200).json({ error: "cuma owner" });
    const target = String((body && body.username) || "").trim();
    const u = await getUser(target);
    if (u && u.email) await storeDel("nang:email:" + u.email.toLowerCase());
    await storeDel("nang:user:" + target.toLowerCase());
    if (_HAS_KV) await _kvCmd("SREM", "nang:userlist", target);
    return res.status(200).json({ ok: true });
  }

  return res.status(200).json({ error: "unknown route", route, method });
}

// ─── HTML pages (tidak berubah, copy dari versi asli) ─────────────────────
function authPage(data, valid, username) {
  const key = data.k, uid = data.u, exp = data.e;
  const now = Math.floor(Date.now() / 1000);
  const left = Math.max(0, exp - now);
  const hours = Math.floor(left / 3600);
  const mins  = Math.floor((left % 3600) / 60);
  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NANG Auth</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#08080f;color:#e8e8f0;font-family:'Inter',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px}
.card{background:#0f0f1a;border:1px solid #ffffff10;border-radius:20px;padding:32px 28px;max-width:440px;width:100%;position:relative;overflow:hidden}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#e03c8a,#9b4de0,transparent)}
.brand{text-align:center;margin-bottom:24px}
.logo{font-size:1.8rem;font-weight:900;background:linear-gradient(135deg,#e03c8a,#9b4de0,#00d4ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.status{display:inline-flex;font-size:.72rem;font-weight:700;padding:4px 12px;border-radius:20px;margin-top:8px}
.status.ok{background:rgba(0,232,122,0.12);color:#00e87a;border:1px solid rgba(0,232,122,0.3)}
.status.err{background:rgba(255,80,80,0.12);color:#ff6b6b;border:1px solid rgba(255,80,80,0.3)}
.info-row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #ffffff0a;font-size:.85rem}
.info-label{color:#6b6b8a}.info-value{color:#e8e8f0;font-weight:600;text-align:right;word-break:break-all;max-width:60%}
.key-box{background:#0a0a14;border:1px solid #e03c8a40;border-radius:14px;padding:20px;margin-top:20px;text-align:center}
.key-label{font-size:.68rem;color:#6b6b8a;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:10px}
.key-value{font-family:'JetBrains Mono',monospace;font-size:1.15rem;font-weight:700;color:#00e87a;letter-spacing:1px;word-break:break-all;line-height:1.5}
.copy-btn{width:100%;margin-top:16px;padding:12px;background:linear-gradient(135deg,#e03c8a,#9b4de0);color:#fff;border:none;border-radius:10px;font-weight:700;font-size:.9rem;cursor:pointer;font-family:inherit}
.copy-btn.copied{background:linear-gradient(135deg,#00e87a,#00b8b8)}
.notice{margin-top:20px;padding:12px;background:#0a0a14;border-radius:10px;font-size:.75rem;color:#6b6b8a;line-height:1.7;text-align:center}
.notice b{color:#e8e8f0}
</style></head><body>
<div class="card">
<div class="brand"><div class="logo">NANG AUTH</div><div class="status ${valid ? 'ok' : 'err'}">${valid ? 'VALID' : 'EXPIRED'}</div></div>
<div class="info-row"><span class="info-label">Username</span><span class="info-value">${username || "Unknown"}</span></div>
<div class="info-row"><span class="info-label">User ID</span><span class="info-value">${uid}</span></div>
<div class="info-row"><span class="info-label">Berlaku</span><span class="info-value">${hours}j ${mins}m</span></div>
<div class="key-box"><div class="key-label">Your Key</div><div class="key-value" id="keyText">${key}</div>
<button class="copy-btn" id="copyBtn" onclick="copyKey()">SALIN KEY</button></div>
<div class="notice">Copy key → paste di <b>popup script NANG</b> → VERIFIKASI</div>
</div>
<script>function copyKey(){const t=document.getElementById('keyText').textContent;navigator.clipboard.writeText(t).then(()=>{const b=document.getElementById('copyBtn');b.textContent='TERSALIN!';b.classList.add('copied');setTimeout(()=>{b.textContent='SALIN KEY';b.classList.remove('copied');},1800);});}</script>
</body></html>`;
}

// mainPage identik dengan versi asli — copy paste dari document
function mainPage(wa) {
  // Paste HTML mainPage dari versi asli di sini
  // (tidak diubah sama sekali, hanya backend yang berubah)
  return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>NANG Key System v${BUILD}</title></head><body style="background:#08080f;color:#e8e8f0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center"><h2>NANG Key System v${BUILD}</h2><p style="color:#6b6b8a;margin-top:8px">Backend OK — paste mainPage HTML dari file asli</p></body></html>`;
}
