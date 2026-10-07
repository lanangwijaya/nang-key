const BUILD = "68.5";
const NANG_WEBHOOK = "https://discord.com/api/webhooks/1554789657705844819/S-AEYb2JOZy7Ixr1KotRTjy91j2ogk3U6-6ODK41Zf4AyEyAnHTIUu6mGN_etsYcYMhS";

import { createHash, randomBytes } from "node:crypto";

const _KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const _KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const _HAS_KV = !!(_KV_URL && _KV_TOKEN);

async function _kvCmd(...args) {
  if (!_HAS_KV) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(_KV_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + _KV_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify([args]),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const d = await r.json();
    return d && d[0] ? d[0].result : null;
  } catch { return null; }
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

async function storeSet(key, val) {
  const raw = typeof val === "string" ? val : JSON.stringify(val);
  const now = Date.now();
  if (_HAS_KV && now > _kvBrokenUntil) {
    const r = await _kvCmd("SET", key, raw);
    if (r !== null) return true;
    _kvBrokenUntil = now + 60000;
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

async function getUser(username) {
  if (!username) return null;
  return storeGet("nang:user:" + String(username).toLowerCase());
}
async function saveUser(user) {
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
      if (u && u.username) { out.push(u); seen[u.username.toLowerCase()] = true; }
    }
  }
  for (const k of Object.keys(_memStore)) {
    const v = _memStore[k];
    if (v && v.username && v.passwordHash && !seen[v.username.toLowerCase()]) {
      out.push(v);
      seen[v.username.toLowerCase()] = true;
    }
  }
  return out;
}

const _SECRET = "NANG2024";
const _EXPIRE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_QUOTA = 10;
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
  function makeAuthLink(uid, key, username) {
    const payload = { u: String(uid), k: key, n: username || "", e: Math.floor(Date.now() / 1000) + 86400 };
    return "https://" + AUTH_DOMAIN + "/auth?d=" + b64urlEncode(payload);
  }

  const url = new URL(req.url, "https://" + AUTH_DOMAIN);
  const params = url.searchParams;
  const path = url.pathname;
  const method = req.method;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (method === "OPTIONS") { res.status(200).end(); return; }

  if (params.has("version")) { res.status(200).json({ version: BUILD, ts: Date.now() }); return; }

  if (params.has("api")) {
    const apiPath = "/api/" + String(params.get("api") || "");
    return await handleApi(req, res, apiPath, method, params, { ADMIN_PW, AUTH_DOMAIN });
  }
  if (path.startsWith("/api/")) {
    return await handleApi(req, res, path, method, params, { ADMIN_PW, AUTH_DOMAIN });
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

async function handleApi(req, res, path, method, params, ctx) {
  const { ADMIN_PW } = ctx;
  const route = path.replace(/^\/api\//, "").replace(/\/$/, "");

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

  // OWNER VERIFY
  if (route === "owner/verify" && method === "POST") {
    const pw = body && body.pw;
    if (pw === ADMIN_PW) {
      const token = randomHex(24);
      const expires = Date.now() + 12 * 3600 * 1000;
      const payload = { expiresAt: expires, role: "owner" };
      _memStore["nang:owner_token:" + token] = payload;
      storeSet("nang:owner_token:" + token, payload).catch(() => {});
      return res.status(200).json({ ok: true, token, role: "owner" });
    }
    return res.status(200).json({ ok: false, error: "password salah" });
  }

  // OWNER GENERATE KEY
  if (route === "owner/generate" && method === "POST") {
    const reqRole = await getOwnerRole(body && body.pw, body && body.ot);
    if (!reqRole || (reqRole !== "owner" && reqRole !== "admin")) {
      return res.status(200).json({ error: "forbidden" });
    }
    const uid = String((body && body.uid) || "").trim();
    if (!uid || !/^\d+$/.test(uid)) return res.status(200).json({ error: "User ID tidak valid" });
    const key = _makeKey(uid);
    const name = await _getRobloxUser(uid);
    sendWebhook([
      { name: "Event", value: "Key Generated (Owner Panel)", inline: false },
      { name: "Target", value: String(name || "Unknown"), inline: true },
      { name: "User ID", value: uid, inline: true },
      { name: "Key", value: key, inline: false },
      { name: "Expires", value: _expiryStr(uid, key), inline: true },
    ]);
    return res.status(200).json({ ok: true, key, expires: _expiryStr(uid, key), username: name });
  }

  // UPLOADER
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

  if (route === "upload-rbxm" && method === "POST") {
    const apiKey = (body && body.apiKey) || "";
    const userId = (body && body.userId) || "";
    const fileBase64 = (body && body.fileBase64) || "";
    const fileName = (body && body.fileName) || "model.rbxm";
    const displayName = (body && body.displayName) || "Model";
    const description = (body && body.description) || "";

    if (!apiKey) return res.status(200).json({ ok: false, error: "API key kosong" });
    if (!userId) return res.status(200).json({ ok: false, error: "userId kosong" });
    if (!fileBase64) return res.status(200).json({ ok: false, error: "file kosong" });

    try {
      const buffer = Buffer.from(fileBase64, "base64");
      const form = new FormData();
      const blob = new Blob([buffer], { type: "application/octet-stream" });
      form.append("file", blob, fileName);
      form.append("assetType", "Model");
      form.append("displayName", String(displayName).slice(0, 50));
      form.append("description", String(description).slice(0, 1000));
      form.append("creationContext", JSON.stringify({ creator: { userId: Number(userId) } }));

      const r = await fetch("https://apis.roblox.com/assets/v1/assets", {
        method: "POST",
        headers: { "x-api-key": apiKey },
        body: form,
      });

      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }

      if (!r.ok) {
        const msg = data.message || data.error || data.raw || ("HTTP " + r.status);
        return res.status(200).json({ ok: false, error: "Roblox: " + msg });
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

  // RESELLER — register
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
    const expires = Date.now() + 7 * 24 * 3600 * 1000;
    _memStore["nang:sess:" + token] = { username: user.username, expiresAt: expires };
    storeSet("nang:sess:" + token, { username: user.username, expiresAt: expires }).catch(() => {});
    return res.status(200).json({
      ok: true, token,
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
      },
    });
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
    if (!canGenerate) {
      return res.status(200).json({ error: "Role '" + u.role + "' belum bisa generate. Tunggu approve jadi reseller." });
    }
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

    sendWebhook([
      { name: "Event", value: "Key Generated", inline: false },
      { name: "By", value: u.username, inline: true },
      { name: "Role", value: u.role, inline: true },
      { name: "Target", value: String(name || "Unknown"), inline: true },
      { name: "User ID", value: uid, inline: true },
      { name: "Key", value: key, inline: false },
      { name: "Expires", value: _expiryStr(uid, key), inline: true },
    ]);
    return res.status(200).json({
      ok: true, key,
      expires: _expiryStr(uid, key),
      username: name,
      remaining: u.role === "reseller" ? (u.quota - u.keysToday) : "unlimited",
    });
  }

  // OWNER / ADMIN endpoints
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
      })),
    });
  }

  if (route === "owner/setrole" && method === "POST") {
    const reqRole = await getOwnerRole(body.pw, body.ot);
    if (!reqRole) return res.status(200).json({ error: "forbidden" });

    const target = String((body && body.username) || "").trim();
    const role = String((body && body.role) || "");
    const validRoles = ["member", "reseller", "admin", "owner", "banned"];
    if (!validRoles.includes(role)) {
      return res.status(200).json({ error: "role invalid" });
    }

    const u = await getUser(target);
    if (!u) return res.status(200).json({ error: "user tidak ditemukan" });

    if (reqRole === "admin") {
      if (u.role === "admin" || u.role === "owner") {
        return res.status(200).json({ error: "admin tidak bisa ubah " + u.role });
      }
      if (role === "admin" || role === "owner") {
        return res.status(200).json({ error: "admin tidak bisa promote ke " + role });
      }
    }

    u.role = role;
    if (role === "reseller" && (!u.quota || u.quota < 1)) u.quota = DEFAULT_QUOTA;
    await saveUser(u);
    sendWebhook([
      { name: "Event", value: "Role Changed", inline: false },
      { name: "Target", value: u.username, inline: true },
      { name: "New Role", value: role, inline: true },
      { name: "By", value: reqRole, inline: true },
    ]);
    return res.status(200).json({ ok: true });
  }

  if (route === "owner/setquota" && method === "POST") {
    const reqRole = await getOwnerRole(body.pw, body.ot);
    if (!reqRole || (reqRole !== "owner" && reqRole !== "admin")) {
      return res.status(200).json({ error: "forbidden" });
    }
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
    if (reqRole !== "owner") return res.status(200).json({ error: "cuma owner yang bisa hapus user" });
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
.info-label{color:#6b6b8a}
.info-value{color:#e8e8f0;font-weight:600;text-align:right;word-break:break-all;max-width:60%}
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
<div class="key-box"><div class="key-label">Your Key</div><div class="key-value" id="keyText">${key}</div><button class="copy-btn" id="copyBtn" onclick="copyKey()">SALIN KEY</button></div>
<div class="notice">Copy key → paste di <b>popup script NANG</b> → VERIFIKASI</div>
</div>
<script>
function copyKey(){const t=document.getElementById('keyText').textContent;navigator.clipboard.writeText(t).then(()=>{const b=document.getElementById('copyBtn');b.textContent='TERSALIN!';b.classList.add('copied');setTimeout(()=>{b.textContent='SALIN KEY';b.classList.remove('copied');},1800);});}
</script></body></html>`;
}

function mainPage(wa) {
  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NANG Key System</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--pink:#e03c8a;--purple:#9b4de0;--cyan:#00d4ff;--green:#00e87a;--yellow:#ffc832;--red:#ff6b6b;--bg:#08080f;--bg2:#0f0f1a;--bg3:#16162a;--border:#ffffff12;--text:#e8e8f0;--muted:#6b6b8a}
body{background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:60px 16px 24px}
.hero{text-align:center;margin-bottom:28px}
.logo{font-size:2.6rem;font-weight:900;background:linear-gradient(135deg,var(--pink),var(--purple),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1}
.logo-badge{display:inline-block;background:linear-gradient(135deg,var(--pink),var(--purple));color:#fff;font-size:0.6rem;font-weight:700;padding:2px 7px;border-radius:20px;vertical-align:super;margin-left:4px;letter-spacing:1px}
.sub{color:var(--muted);font-size:0.8rem;margin-top:6px}
.nav{display:flex;gap:6px;background:var(--bg2);border:1px solid var(--border);border-radius:14px;padding:5px;margin-bottom:22px;width:100%;max-width:480px;flex-wrap:wrap}
.nav-btn{flex:1;min-width:70px;padding:9px 6px;border:none;border-radius:10px;cursor:pointer;font-size:0.8rem;font-weight:600;background:transparent;color:var(--muted);font-family:inherit}
.nav-btn.active{background:linear-gradient(135deg,rgba(224,60,138,0.2),rgba(155,77,224,0.2));color:#fff;border:1px solid rgba(224,60,138,0.3)}
.panel{width:100%;max-width:480px;display:none}
.panel.active{display:block}
.card{background:var(--bg2);border:1px solid var(--border);border-radius:16px;padding:18px;margin-bottom:12px;position:relative;overflow:hidden}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(224,60,138,0.4),transparent)}
.card-title{font-size:0.7rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:14px}
.qr-wrap{display:flex;gap:14px;align-items:flex-start;margin-bottom:14px}
.qr-img{width:100px;height:100px;border-radius:10px;border:2px solid var(--border);object-fit:cover;flex-shrink:0}
.qr-img-placeholder{width:100px;height:100px;border-radius:10px;border:2px dashed var(--border);display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:0.7rem;text-align:center;flex-shrink:0}
.qr-info{flex:1}
.price-badge{display:inline-flex;background:linear-gradient(135deg,rgba(0,232,122,0.15),rgba(0,212,255,0.1));border:1px solid rgba(0,232,122,0.3);border-radius:8px;padding:5px 10px;font-size:0.85rem;font-weight:700;color:var(--green);margin-bottom:8px}
.qr-steps{font-size:0.75rem;color:var(--muted);line-height:1.8}
.qr-steps span{color:var(--text)}
.fmt-box{background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:0.75rem;color:var(--muted);line-height:1.9;margin-bottom:12px}
.fmt-box .label{color:var(--pink);font-weight:600}
.fmt-box .field{color:var(--text)}
.wa-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:13px;background:linear-gradient(135deg,#25d366,#128c7e);color:#fff;border:none;border-radius:12px;font-size:0.95rem;font-weight:700;cursor:pointer;text-decoration:none;font-family:inherit}
.wa-icon{width:18px;height:18px;fill:#fff}
.inp{width:100%;padding:11px 14px;background:var(--bg3);border:1px solid var(--border);border-radius:10px;color:var(--text);font-size:0.88rem;outline:none;margin-bottom:10px;font-family:inherit}
.inp:focus{border-color:rgba(224,60,138,0.5)}
.inp::placeholder{color:var(--muted)}
.btn-main{width:100%;padding:12px;background:linear-gradient(135deg,var(--pink),var(--purple));color:#fff;border:none;border-radius:11px;font-weight:700;font-size:0.9rem;cursor:pointer;font-family:inherit;margin-bottom:8px}
.btn-cyan{width:100%;padding:12px;background:linear-gradient(135deg,#0099cc,var(--cyan));color:#000;border:none;border-radius:11px;font-weight:700;font-size:0.9rem;cursor:pointer;font-family:inherit}
.btn-green{width:100%;padding:11px;background:linear-gradient(135deg,#00b866,var(--green));color:#000;border:none;border-radius:11px;font-weight:700;font-size:0.85rem;cursor:pointer;font-family:inherit;margin-top:8px}
.result{background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:0.78rem;margin-top:10px;display:none;word-break:break-all;line-height:1.6}
.result.ok{border-color:rgba(0,232,122,0.3);color:var(--green);display:block}
.result.err{border-color:rgba(255,80,80,0.3);color:#ff6b6b;background:rgba(255,40,40,0.05);display:block}
.result.warn{border-color:rgba(255,200,50,0.3);color:#ffc832;background:rgba(255,200,50,0.05);display:block}
.result.info{border-color:rgba(0,212,255,0.3);color:var(--cyan);background:rgba(0,212,255,0.05);display:block}
.result .key-line{font-family:monospace;font-size:0.9rem;color:var(--green);font-weight:700;margin:6px 0;padding:8px;background:#0a1520;border-radius:6px;word-break:break-all}
.result .link-line{font-family:monospace;font-size:0.7rem;color:var(--cyan);word-break:break-all;padding:6px;background:#0a1520;border-radius:6px;display:block;text-decoration:none;border:1px solid rgba(0,212,255,0.15);margin:6px 0}
.user-card{display:flex;align-items:center;gap:10px;background:var(--bg3);border:1px solid rgba(0,232,122,0.2);border-radius:10px;padding:10px;margin-top:10px}
.user-avatar{width:36px;height:36px;border-radius:8px;background:linear-gradient(135deg,var(--pink),var(--purple));display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1rem;color:#fff}
.user-info{flex:1}
.user-name{font-weight:700;font-size:0.9rem;color:var(--text)}
.user-id{font-size:0.72rem;color:var(--muted)}
.spinner{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.1);border-top-color:var(--pink);border-radius:50%;animation:spin .6s linear infinite;vertical-align:middle;margin-right:6px}
@keyframes spin{to{transform:rotate(360deg)}}
.drop{border:2px dashed var(--border);border-radius:12px;padding:24px 16px;text-align:center;cursor:pointer;transition:all .2s;background:var(--bg3);margin-bottom:12px}
.drop:hover,.drop.over{border-color:var(--pink);background:rgba(224,60,138,0.05)}
.drop.done{border-color:var(--green);background:rgba(0,232,122,0.05)}
.drop-icon{font-size:1.8rem;margin-bottom:6px;opacity:.6}
.drop-text{font-size:0.85rem;color:var(--text);margin-bottom:4px}
.drop-hint{font-size:0.7rem;color:var(--muted)}
.stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}
.stat{background:var(--bg3);padding:12px;border-radius:9px}
.stat .label{font-size:.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;font-weight:700}
.stat .value{font-size:1.4rem;font-weight:900;margin-top:4px}
.key-item{padding:10px;background:var(--bg3);border-radius:8px;margin-bottom:6px;font-size:.75rem;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
.key-item .info{flex:1;min-width:0}
.key-item .k{font-family:'JetBrains Mono',monospace;color:var(--green);font-weight:700;word-break:break-all}
.key-item .meta{color:var(--muted);font-size:.68rem;margin-top:4px}
.key-item .cp{padding:5px 10px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:.68rem;font-weight:700;cursor:pointer;font-family:inherit}
footer{margin-top:28px;color:var(--muted);font-size:0.7rem;text-align:center;opacity:0.5}
.hidden{display:none!important}
.auth-bar{position:fixed;top:16px;right:16px;z-index:50;display:flex;gap:8px;align-items:center;font-size:.8rem}
.auth-pill{display:flex;align-items:center;gap:8px;padding:7px 12px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;font-size:.8rem}
.auth-pill .uname{font-weight:700;color:var(--text)}
.auth-btn{padding:8px 14px;background:linear-gradient(135deg,var(--pink),var(--purple));color:#fff;border:none;border-radius:9px;font-weight:700;font-size:.8rem;cursor:pointer;font-family:inherit}
.auth-btn.gray{background:var(--bg2);border:1px solid var(--border);color:var(--text)}
.role-tag{font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:2px 7px;border-radius:5px}
.role-tag.owner{background:rgba(224,60,138,.2);color:var(--pink)}
.role-tag.admin{background:rgba(155,77,224,.2);color:#c899ff}
.role-tag.reseller{background:rgba(0,212,255,.15);color:var(--cyan)}
.role-tag.member{background:rgba(150,150,170,.15);color:var(--muted)}
.role-tag.banned{background:rgba(255,80,80,.15);color:var(--red)}
.modal-tabs{display:flex;gap:4px;background:var(--bg3);border-radius:9px;padding:3px;margin-bottom:14px}
.modal-tabs button{flex:1;padding:8px;border:none;border-radius:7px;background:transparent;color:var(--muted);font-family:inherit;font-weight:600;font-size:.8rem;cursor:pointer}
.modal-tabs button.on{background:linear-gradient(135deg,rgba(224,60,138,.2),rgba(155,77,224,.2));color:#fff}
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.75);display:none;align-items:center;justify-content:center;z-index:100;padding:20px}
.modal-bg.show{display:flex}
.modal-box{background:var(--bg2);border:1px solid var(--pink);border-radius:16px;padding:24px;max-width:420px;width:100%;position:relative;max-height:90vh;overflow-y:auto}
.modal-box h3{color:var(--pink);font-size:1rem;margin-bottom:14px}
.modal-box .x{position:absolute;top:12px;right:16px;cursor:pointer;color:var(--muted);font-size:22px;line-height:1}
.user-row{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--bg3);border-radius:9px;margin-bottom:6px;gap:8px;flex-wrap:wrap}
.user-row .name{font-weight:700;font-size:.9rem;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.user-row .meta{font-size:.7rem;color:var(--muted);margin-top:3px}
.row-actions{display:flex;gap:4px;flex-wrap:wrap}
.row-actions button{padding:5px 10px;border:none;border-radius:6px;font-size:.7rem;font-weight:700;cursor:pointer;font-family:inherit;background:var(--bg2);color:var(--text);border:1px solid var(--border)}
.row-actions button:hover{background:var(--bg3)}
.locked{padding:40px 20px;text-align:center;color:var(--muted);font-size:.85rem;line-height:1.7}
.locked button{margin-top:12px;padding:10px 24px;width:auto}
.warn-box{padding:10px 12px;background:rgba(255,200,50,0.06);border:1px solid rgba(255,200,50,0.2);border-radius:9px;font-size:0.75rem;color:var(--yellow);margin-bottom:12px;line-height:1.6}
.warn-box b{color:#fff}
.warn-box a{color:var(--yellow)}
.fab{position:fixed;bottom:20px;right:20px;width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,var(--pink),var(--purple));color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;cursor:pointer;z-index:80;box-shadow:0 6px 20px rgba(224,60,138,0.4);border:none;font-family:inherit;transition:transform .15s}
.fab:hover{transform:scale(1.05)}
.fab.active{background:linear-gradient(135deg,#00b866,var(--green))}
</style></head><body>

<div class="auth-bar" id="authBar"></div>

<button class="fab" id="ownerFab" onclick="openOwnerModal()" title="Owner">🔒</button>

<div class="hero"><div class="logo">NANG<span class="logo-badge">KEY</span></div><div class="sub">Roblox Script Key System</div></div>

<div id="loginWall">
  <div class="card" style="max-width:420px;width:100%">
    <div class="card-title">Masuk / Daftar</div>
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
</div>

<div class="panel active" id="tab0">
<div class="card">
<div class="card-title">Pembayaran QRIS</div>
<div class="qr-wrap">
<img src="/qr.png" class="qr-img" alt="QR" onerror="this.outerHTML='<div class=qr-img-placeholder>QR<br>belum<br>tersedia</div>'">
<div class="qr-info"><div class="price-badge">Rp500 / Key</div><div class="qr-steps">Scan QR di kiri<br>Transfer <span>Rp500</span><br>Chat WA owner<br>Key dikirim otomatis</div></div>
</div>
<div class="fmt-box"><span class="label">Format pesan WA:</span><br><span class="field">Beli Key NANG</span><br>Nama: <span class="field" id="waNama">[isi di bawah]</span><br>Roblox ID: <span class="field" id="waUid">[isi di bawah]</span><br>Bukti TF: <span class="field">[screenshot]</span></div>
<a href="https://wa.me/${wa}?text=Beli%20Key%20NANG" class="wa-btn" id="waBtn" target="_blank"><svg class="wa-icon" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347"/></svg>Chat WhatsApp Owner</a>
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
<div style="font-size:.7rem;margin-top:4px;color:var(--muted)">Hubungi owner buat naikin role.</div>
</div>
</div>
<div id="uploadContent" class="hidden">
<div class="warn-box">
<b>Butuh API Key Roblox.</b> Buat di
<a href="https://create.roblox.com/dashboard/credentials" target="_blank">Creator Dashboard → Credentials</a>.
Aktifkan <b>Assets API: Read & Write</b>. IP: Unrestricted.
</div>
<div class="card">
<div class="card-title">Akun Roblox</div>
<input type="text" class="inp" id="upUsername" placeholder="Username Roblox..." autocomplete="username">
<input type="password" class="inp" id="upApiKey" placeholder="API Key Roblox...">
</div>
<div class="card">
<div class="card-title">File Model</div>
<div class="drop" id="upDrop">
<div class="drop-icon">📦</div>
<div class="drop-text">Klik atau drop file di sini</div>
<div class="drop-hint">.rbxm / .rbxmx — max 3 MB</div>
</div>
<input type="file" id="upFileInput" accept=".rbxm,.rbxmx" hidden>
<input type="text" class="inp" id="upName" placeholder="Nama asset (opsional)">
<input type="text" class="inp" id="upDesc" placeholder="Deskripsi (opsional)">
<button class="btn-cyan" id="upBtn" onclick="doUploadRbxm()">UPLOAD KE ROBLOX</button>
<div class="result" id="upResult"></div>
</div>
</div>
</div>

<div class="panel" id="tab3">
<div class="card">
<div class="card-title">Kuota Saya</div>
<div class="stat-grid">
  <div class="stat"><div class="label">Kuota / hari</div><div class="value" id="mkQuota">—</div></div>
  <div class="stat"><div class="label">Dipakai hari ini</div><div class="value" id="mkToday">—</div></div>
  <div class="stat"><div class="label">Sisa</div><div class="value" id="mkLeft">—</div></div>
  <div class="stat"><div class="label">Total key</div><div class="value" id="mkTotal">—</div></div>
</div>
</div>
<div class="card">
<div class="card-title">Generate Key</div>
<div class="fmt-box">Masukkan Roblox User ID target. Key valid 24 jam dari sekarang.</div>
<input type="text" class="inp" id="mkUid" placeholder="Roblox User ID (angka)">
<button class="btn-cyan" id="mkGenBtn" onclick="doMyKeysGenerate()">GENERATE KEY</button>
<div class="result" id="mkResult"></div>
</div>
<div class="card">
<div class="card-title">Riwayat Key</div>
<div id="mkHistory"><div style="color:var(--muted);font-size:.8rem">Belum ada key.</div></div>
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

function $(id){return document.getElementById(id);}
function apiCall(url, opts){
  return fetch(url, opts).then(r=>{
    return r.text().then(t=>{
      try { return JSON.parse(t); }
      catch(e) { return { error: 'Server tidak balikin JSON. Response: '+t.slice(0,120) }; }
    });
  });
}

function switchTab(i){
  document.querySelectorAll('.nav-btn').forEach((b,j)=>b.classList.toggle('active',i===j));
  document.querySelectorAll('.panel').forEach((p,j)=>p.classList.toggle('active',i===j));
  if(i===3) refreshMyKeys();
}

async function checkSession(){
  if(!TOKEN){ ME=null; updateAuthUI(); return; }
  try{
    const d = await apiCall('/?api=reseller/me&token='+encodeURIComponent(TOKEN));
    if(d.ok){ ME = d.user; }
    else { TOKEN=null; localStorage.removeItem('nang_session'); }
  }catch(e){ TOKEN=null; }
  updateAuthUI();
}

function updateAuthUI(){
  const bar = $('authBar');
  const logged = !!ME && ME.role !== 'banned';

  if(logged){
    $('loginWall').classList.add('hidden');
    $('appContent').classList.remove('hidden');
    bar.innerHTML = '<div class="auth-pill"><span class="uname">'+ME.username+'</span><span class="role-tag '+ME.role+'">'+ME.role+'</span></div><button class="auth-btn gray" onclick="doAuthLogout()">Logout</button>';
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
  if(d.error){ box.className='result err'; box.innerHTML=d.error; return; }
  TOKEN = d.token;
  localStorage.setItem('nang_session', TOKEN);
  box.className='result ok'; box.innerHTML='Berhasil masuk';
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
  if(d.error){ box.className='result err'; box.innerHTML=d.error; return; }
  box.className='result ok'; box.innerHTML = (d.message || 'Terdaftar.') + ' Silakan login.';
  $('lwRegUser').value=''; $('lwRegEmail').value=''; $('lwRegPass').value=''; $('lwRegPass2').value='';
  setTimeout(()=>{ lwSwitch(0); $('lwUser').value = username; }, 800);
}

async function doAuthLogout(){
  if(TOKEN){
    try{ await apiCall('/?api=reseller/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TOKEN})}); }catch(e){}
  }
  TOKEN=null; ME=null;
  localStorage.removeItem('nang_session');
  updateAuthUI();
}

// === MY KEYS ===
async function refreshMyKeys(){
  if(!TOKEN) return;
  const d = await apiCall('/?api=reseller/me&token='+encodeURIComponent(TOKEN));
  if(!d.ok) return;
  ME = d.user;
  const isReseller = ME.role === 'reseller';
  const quota = isReseller ? ME.quota : '∞';
  const today = ME.keysToday || 0;
  const left = isReseller ? Math.max(0, ME.quota - today) : '∞';
  const total = (ME.keys || []).length;

  $('mkQuota').textContent = quota;
  $('mkToday').textContent = today;
  $('mkLeft').textContent = left;
  $('mkTotal').textContent = total;

  const hist = $('mkHistory');
  if(!ME.keys || !ME.keys.length){
    hist.innerHTML = '<div style="color:var(--muted);font-size:.8rem">Belum ada key.</div>';
    return;
  }
  hist.innerHTML = ME.keys.map(k => (
    '<div class="key-item">'+
      '<div class="info"><div class="k">'+k.key+'</div>'+
      '<div class="meta">UID: '+k.uid+' · '+(k.name||'?')+' · '+new Date(k.ts).toLocaleString('id-ID')+'</div></div>'+
      '<button class="cp" onclick="copyKey(\\''+k.key+'\\',this)">COPY</button>'+
    '</div>'
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
    if(d.error){ box.className='result err'; box.innerHTML=d.error; return; }
    box.className='result ok';
    box.innerHTML = '<b>'+(d.username||'Unknown')+'</b><div class="key-line">'+d.key+'</div><div style="font-size:.75rem;color:var(--muted)">Berlaku: '+d.expires+' · Sisa kuota: '+d.remaining+'</div><button class="btn-green" onclick="navigator.clipboard.writeText(\\''+d.key+'\\');this.textContent=\\'COPIED\\';setTimeout(()=>this.textContent=\\'COPY KEY\\',1500)">COPY KEY</button>';
    $('mkUid').value='';
    await refreshMyKeys();
  } catch(e) {
    box.className='result err'; box.innerHTML='Error: '+e.message;
  } finally {
    btn.disabled = false; btn.textContent = 'GENERATE KEY';
  }
}

// === OWNER FAB ===
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
    try { d = JSON.parse(txt); } catch(e) { box.className='result err'; box.innerHTML='Response bukan JSON: '+txt.slice(0,120); return; }
    if(!d.ok){ box.className='result err'; box.innerHTML=d.error||'Gagal'; return; }
    OWNER_TOKEN = d.token;
    localStorage.setItem('nang_owner', OWNER_TOKEN);
    $('oPw').value='';
    box.className='result'; box.innerHTML='';
    $('ownerLoginForm').classList.add('hidden');
    $('ownerPanel').classList.remove('hidden');
    $('ownerFab').classList.add('active');
    loadUsers();
  } catch(e) {
    box.className='result err'; box.innerHTML='Error: '+e.message;
  }
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
    if(d.error){ box.innerHTML='<div style="color:var(--red);font-size:.8rem">'+d.error+'</div>'; return; }
    if(!d.users || !d.users.length){ box.innerHTML='<div style="color:var(--muted);font-size:.8rem">Belum ada user</div>'; return; }
    box.innerHTML = d.users.map(u => {
      const isReseller = u.role === 'reseller';
      const isAdmin = u.role === 'admin';
      const isOwner = u.role === 'owner';
      const isBanned = u.role === 'banned';
      const isMember = u.role === 'member';

      let actions = '';

      if (!isReseller && !isAdmin && !isOwner) {
        actions += '<button onclick="setUserRole(\\''+u.username+'\\',\\'reseller\\')">→ Reseller</button>';
      }
      if (!isAdmin && !isOwner) {
        actions += '<button onclick="setUserRole(\\''+u.username+'\\',\\'admin\\')">→ Admin</button>';
      }
      if (!isOwner && !isMember) {
        actions += '<button onclick="setUserRole(\\''+u.username+'\\',\\'member\\')">→ Member</button>';
      }
      if (!isOwner) {
        if (isBanned) {
          actions += '<button onclick="setUserRole(\\''+u.username+'\\',\\'member\\')">Unban</button>';
        } else {
          actions += '<button onclick="setUserRole(\\''+u.username+'\\',\\'banned\\')">Ban</button>';
        }
      }
      if (isReseller) {
        actions += '<button onclick="editUserQuota(\\''+u.username+'\\','+u.quota+')">Q:'+u.quota+'</button>';
      }
      if (ME && ME.role === 'owner' && u.username !== ME.username) {
        actions += '<button onclick="delUser(\\''+u.username+'\\')">Hapus</button>';
      }

      return '<div class="user-row">'+
        '<div><div class="name">'+u.username+' <span class="role-tag '+u.role+'">'+u.role+'</span></div>'+
        '<div class="meta">'+(u.email ? u.email + ' · ' : '')+'q:'+u.quota+' t:'+u.keysToday+'</div></div>'+
        '<div class="row-actions">'+actions+'</div>'+
      '</div>';
    }).join('');
  }catch(e){
    box.innerHTML='<div style="color:var(--red);font-size:.8rem">Error: '+e.message+'</div>';
  }
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

async function doOwnerGen(){
  const uid = $('oGenUid').value.trim();
  const box = $('oGenResult');
  if(!uid) { box.className='result err'; box.innerHTML='Isi User ID'; return; }
  box.className='result info'; box.innerHTML='<span class="spinner"></span>Generate...';
  try {
    const r = await fetch('/?api=owner/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ot:OWNER_TOKEN, uid})});
    const d = await r.json();
    if(d.error){ box.className='result err'; box.innerHTML=d.error; return; }
    box.className='result ok';
    box.innerHTML = '<b>'+(d.username||'Unknown')+'</b><div class="key-line">'+d.key+'</div><div style="font-size:.75rem;color:var(--muted)">Expires: '+d.expires+'</div>';
  } catch(e) {
    box.className='result err'; box.innerHTML='Error: '+e.message;
  }
}

function updateWA(){if(!lastLookup.name)return;const text="Beli Key NANG%0ANama: "+encodeURIComponent(lastLookup.name)+"%0ARoblox ID: "+lastLookup.uid+"%0ABukti TF: [screenshot]";$('waBtn').href="https://wa.me/"+WA_NUMBER+"?text="+text;$('waNama').textContent=lastLookup.name;$('waUid').textContent=lastLookup.uid;}
async function doLookup(){const uid=$('lookupId').value.trim();const box=$('lookupResult');if(!uid)return;box.style.display='block';box.className='result info';box.innerHTML='<span class="spinner"></span>Mencari...';try{const r=await fetch('/?lookup='+encodeURIComponent(uid));const d=await r.json();if(d.name){lastLookup={uid:d.uid,name:d.name};updateWA();box.style.display='none';const ex=$('userCard');if(ex)ex.remove();const card=document.createElement('div');card.id='userCard';card.className='user-card';card.innerHTML='<div class="user-avatar">'+d.name.charAt(0).toUpperCase()+'</div><div class="user-info"><div class="user-name">'+d.name+'</div><div class="user-id">ID: '+d.uid+'</div></div>';box.parentNode.insertBefore(card,box.nextSibling);}else{box.className='result err';box.innerHTML='User ID tidak ditemukan';}}catch(e){box.className='result err';box.innerHTML='Error: '+e.message;}}
let lookupT;$('lookupId').addEventListener('input',()=>{clearTimeout(lookupT);lookupT=setTimeout(doLookup,600);});

async function doConvert(){
  const input=$('convFile');
  const box=$('convResult');
  if(!input.files||!input.files[0])return;
  const file=input.files[0];
  if(file.size>50*1024*1024){box.style.display='block';box.className='result err';box.innerHTML='File > 50 MB.';return;}
  box.style.display='block';box.className='result info';box.innerHTML='<span class="spinner"></span>Mengkonversi '+file.name+'...';
  try{
    const buf=await file.arrayBuffer();
    const r=await fetch('/?api=convert',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:buf});
    const text=await r.text();
    let errMsg=null;
    try{const j=JSON.parse(text);if(j&&j.ok===false){errMsg=j.error||'Konversi gagal';}}catch{}
    if(!r.ok||errMsg){box.className='result err';box.innerHTML='Gagal: '+(errMsg||text.slice(0,200));return;}
    const outName=file.name.replace(/\\.(rbxl|rbxm)$/i,'.rbxlx')||('converted-'+Date.now()+'.rbxlx');
    const blob=new Blob([text],{type:'text/xml'});
    const url=URL.createObjectURL(blob);
    box.className='result ok';
    box.innerHTML='Berhasil!<div class="key-line"><a href="'+url+'" download="'+outName+'" style="color:#00d4ff;text-decoration:none">⬇ Download '+outName+'</a></div>';
  }catch(e){box.className='result err';box.innerHTML='Error: '+e.message;}
}

let _upFile=null;
const upDrop=$('upDrop');
const upFileInput=$('upFileInput');
const upResult=$('upResult');
upDrop.addEventListener('click',()=>upFileInput.click());
upDrop.addEventListener('dragover',e=>{e.preventDefault();upDrop.classList.add('over');});
upDrop.addEventListener('dragleave',()=>upDrop.classList.remove('over'));
upDrop.addEventListener('drop',e=>{e.preventDefault();upDrop.classList.remove('over');if(e.dataTransfer.files.length)_upHandleFile(e.dataTransfer.files[0]);});
upFileInput.addEventListener('change',e=>{if(e.target.files.length)_upHandleFile(e.target.files[0]);});
function _upHandleFile(f){
  const n=f.name.toLowerCase();
  if(!n.endsWith('.rbxm')&&!n.endsWith('.rbxmx'))return _upShow('err','File harus .rbxm / .rbxmx');
  if(f.size>3*1024*1024)return _upShow('err','File > 3 MB.');
  _upFile=f;
  upDrop.classList.add('done');
  upDrop.querySelector('.drop-icon').textContent='✓';
  upDrop.querySelector('.drop-text').textContent=f.name;
  upDrop.querySelector('.drop-hint').textContent=(f.size/1024).toFixed(1)+' KB';
  upResult.style.display='none';
}
function _upShow(type,html){upResult.className='result '+type;upResult.innerHTML=html;}

async function doUploadRbxm(){
  const username=$('upUsername').value.trim();
  const apiKey=$('upApiKey').value.trim();
  const name=$('upName').value.trim();
  const desc=$('upDesc').value.trim();
  if(!username)return _upShow('err','Username kosong');
  if(!apiKey)return _upShow('err','API Key kosong');
  if(!_upFile)return _upShow('err','Belum pilih file');
  const btn=$('upBtn');
  btn.disabled=true;btn.textContent='...';
  _upShow('info','<span class="spinner"></span>Upload ke Roblox...');
  try{
    const base64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(',')[1]);r.onerror=rej;r.readAsDataURL(_upFile);});
    const lk=await apiCall('/?api=lookup-username',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username})});
    if(!lk.ok)throw new Error(lk.error);
    const up=await apiCall('/?api=upload-rbxm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey,userId:lk.userId,fileName:_upFile.name,fileBase64:base64,displayName:name||_upFile.name.replace(/\\.(rbxm|rbxmx)$/i,''),description:desc||'Upload via NANG web'})});
    if(!up.ok)throw new Error(up.error);
    let assetId=null;
    for(let i=0;i<30;i++){
      await new Promise(r=>setTimeout(r,1500));
      const st=await apiCall('/?api=upload-status&id='+encodeURIComponent(up.operationId)+'&k='+encodeURIComponent(apiKey));
      if(!st.ok)throw new Error(st.error);
      if(st.done){if(st.error)throw new Error(st.error);assetId=st.assetId;break;}
    }
    if(!assetId)throw new Error('Timeout.');
    _upShow('ok','<b>BERHASIL</b><div class="key-line">Asset ID: '+assetId+'</div><a class="link-line" href="https://www.roblox.com/library/'+assetId+'" target="_blank">https://www.roblox.com/library/'+assetId+'</a>');
  }catch(e){_upShow('err','Gagal: '+e.message);}
  finally{btn.disabled=false;btn.textContent='UPLOAD KE ROBLOX';}
}

document.addEventListener('DOMContentLoaded',()=>{
  checkSession();
  ['lwUser','lwPass'].forEach(id=>$(id).addEventListener('keydown',e=>{if(e.key==='Enter')lwDoLogin();}));
  ['lwRegUser','lwRegEmail','lwRegPass','lwRegPass2'].forEach(id=>$(id).addEventListener('keydown',e=>{if(e.key==='Enter')lwDoRegister();}));
  ['oPw'].forEach(id=>$(id).addEventListener('keydown',e=>{if(e.key==='Enter')doOwnerLogin();}));
  ['oGenUid'].forEach(id=>$(id).addEventListener('keydown',e=>{if(e.key==='Enter')doOwnerGen();}));
  ['mkUid'].forEach(id=>$(id).addEventListener('keydown',e=>{if(e.key==='Enter')doMyKeysGenerate();}));
});
</script></body></html>`;
}
