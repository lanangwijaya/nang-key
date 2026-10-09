const BUILD = "74.0";
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
function _getWindow() { return Math.floor(Date.now() / 86400000); }
function _makeKeyAt(uid, w) {
  const h = _simpleHash(_SECRET + String(uid) + String(w));
  const p1 = String(uid).slice(0, 5).padEnd(5, "0");
  return "NANG-" + p1 + "-" + String(h % 10000).padStart(4, "0") + "-" + String(Math.floor(h / 10000) % 10000).padStart(4, "0");
}
function _makeKey(uid) { return _makeKeyAt(uid, _getWindow()); }
function _verifyKey(uid, key) {
  const k = String(key || "").toUpperCase().replace(/\s+/g, "");
  if (!k) return { valid: false, remainingMs: 0 };
  const w = _getWindow();
  const now = Date.now();
  const endOfToday = (w + 1) * 86400000;
  if (_makeKeyAt(uid, w) === k || _makeKeyAt(uid, w - 1) === k) {
    const rem = Math.max(0, endOfToday - now);
    return { valid: rem > 0, remainingMs: rem };
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

// ═══════════════════════════════════════════════════════
// DEOBF — Pure JS, no fengari
// ═══════════════════════════════════════════════════════

function detectObfuscator(src) {
  const s = String(src || "");
  const len = s.length;
  if (len < 50) return { type: "plain", confidence: 1, reason: "terlalu pendek" };

  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s.slice(0, 200))) {
    return { type: "bytecode", confidence: 0.9, reason: "binary header" };
  }

  const sig = [
    { type: "IronBrew2",     re: /IronBrew|AztupBrew|ironbrew/i, conf: 0.9 },
    { type: "MoonSec",       re: /Moonsec|MoonsecV\d|MoonsecVM/i, conf: 0.95 },
    { type: "MoonSec",       re: /Moonsec\s*V?\d|moonsec\s*[Vv]\d/i, conf: 0.9 },
    { type: "Luraph",        re: /Luraph|LPH_\d|LPH_no_vm/i, conf: 0.95 },
    { type: "Psu",           re: /Psu|PSU_|_psu_/i, conf: 0.9 },
    { type: "WeAreDevs",     re: /WeAreDevs|WAD_OBFUSCATOR/i, conf: 0.9 },
    { type: "Obfuscator.io", re: /obfuscator\.io|obfuscator_io/i, conf: 0.9 },
    { type: "SynapseBC",     re: /Synapse|synapse_load|syn_load/i, conf: 0.9 },
    { type: "Prometheus",    re: /Prometheus|prometheus_v/i, conf: 0.9 },
    { type: "AztupBrew",     re: /AztupBrew|aztupbrew/i, conf: 0.9 },
  ];

  for (const x of sig) if (x.re.test(s)) return { type: x.type, confidence: x.conf };

  const printable = (s.match(/[\x20-\x7e\n\r\t]/g) || []).length;
  if (printable / s.length < 0.4) return { type: "bytecode-or-encrypted", confidence: 0.7 };

  const shortIds = (s.match(/\b[a-zA-Z]{1,2}\b/g) || []).length;
  if (shortIds / s.length > 0.15) return { type: "minified", confidence: 0.5 };

  return { type: "plain", confidence: 0.4 };
}

// decode base64 (Lua-compatible, supports +/-, padding optional)
function _b64decode(str) {
  let s = String(str).replace(/[^A-Za-z0-9+/=]/g, "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  try { return Buffer.from(s, "base64").toString("utf8"); } catch { return null; }
}

// decode Lua string literal "\x41\x42" or "ABC"
function _decodeLuaString(raw) {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === "\\") {
      const n = raw[i + 1];
      if (n === "n") { out += "\n"; i++; }
      else if (n === "t") { out += "\t"; i++; }
      else if (n === "r") { out += "\r"; i++; }
      else if (n === "\\") { out += "\\"; i++; }
      else if (n === '"') { out += '"'; i++; }
      else if (n === "'") { out += "'"; i++; }
      else if (n === "a") { out += String.fromCharCode(7); i++; }
      else if (n === "b") { out += "\b"; i++; }
      else if (n === "f") { out += "\f"; i++; }
      else if (n === "v") { out += "\v"; i++; }
      else if (n === "x") {
        const hex = raw.slice(i + 2, i + 4);
        if (/^[0-9a-f]{2}$/i.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 3; }
        else { out += "x"; i++; }
      }
      else if (/[0-9]/.test(n)) {
        let num = n, j = i + 2;
        while (j < raw.length && /[0-9]/.test(raw[j]) && num.length < 3) { num += raw[j]; j++; }
        out += String.fromCharCode(parseInt(num, 10) & 0xff);
        i = j - 1;
      }
      else { out += n; i++; }
    } else out += c;
  }
  return out;
}

// ekstrak string literal dari Lua source
function _extractLuaString(expr) {
  expr = expr.trim();
  // "..." atau '...'
  let m = expr.match(/^"((?:[^"\\]|\\.)*)"$/s);
  if (m) return _decodeLuaString(m[1]);
  m = expr.match(/^'((?:[^'\\]|\\.)*)'$/s);
  if (m) return _decodeLuaString(m[1]);
  m = expr.match(/^\[\[([\s\S]*?)\]\]$/);
  if (m) return m[1];
  return null;
}

// evaluate string.char(n1, n2, ...)
function _evalStringChar(expr) {
  const m = expr.match(/^\s*(?:string\.)?char\s*\(([\s\S]+)\)\s*$/);
  if (!m) return null;
  const args = m[1].split(",").map(x => x.trim());
  let out = "";
  for (const a of args) {
    const n = Number(a);
    if (!isNaN(n)) out += String.fromCharCode(n & 0xff);
    else return null;
  }
  return out;
}

// evaluate table.concat({...}, sep)
function _evalTableConcat(expr) {
  const m = expr.match(/^\s*table\.concat\s*\(\s*\{([\s\S]*?)\}\s*(?:,\s*(.+?))?\s*\)\s*$/);
  if (!m) return null;
  const items = m[1].split(",").map(x => x.trim());
  const sep = m[2] ? (_extractLuaString(m[2]) || "") : "";
  let out = [];
  for (const it of items) {
    let v = _extractLuaString(it);
    if (v === null) v = _evalStringChar(it);
    if (v === null) return null;
    out.push(v);
  }
  return out.join(sep);
}

// recursive evaluator untuk expression string
function _evalLuaStringExpr(expr, depth) {
  depth = depth || 0;
  if (depth > 10) return null;
  expr = String(expr || "").trim();

  // unwrap outer parens
  while (expr.startsWith("(") && expr.endsWith(")")) {
    let balanced = 0, ok = true;
    for (let i = 0; i < expr.length; i++) {
      if (expr[i] === "(") balanced++;
      else if (expr[i] === ")") { balanced--; if (balanced === 0 && i < expr.length - 1) { ok = false; break; } }
    }
    if (ok) expr = expr.slice(1, -1).trim();
    else break;
  }

  // direct string literal
  let s = _extractLuaString(expr);
  if (s !== null) return s;

  // string.char(...)
  s = _evalStringChar(expr);
  if (s !== null) return s;

  // table.concat({...}, sep)
  s = _evalTableConcat(expr);
  if (s !== null) return s;

  // base64 decode via various functions
  const b64re = /^(?:base64[_]?decode|base64|b64d|atob)\s*\(\s*([\s\S]+)\s*\)\s*$/i;
  const bm = expr.match(b64re);
  if (bm) {
    const inner = _evalLuaStringExpr(bm[1], depth + 1);
    if (inner !== null) return _b64decode(inner);
  }

  // string.rep(s, n)
  const rm = expr.match(/^string\.rep\s*\(\s*([\s\S]+?)\s*,\s*(\d+)\s*\)\s*$/);
  if (rm) {
    const inner = _evalLuaStringExpr(rm[1], depth + 1);
    if (inner !== null) return inner.repeat(Number(rm[2]));
  }

  // string.reverse
  const revm = expr.match(/^string\.reverse\s*\(\s*([\s\S]+)\s*\)\s*$/);
  if (revm) {
    const inner = _evalLuaStringExpr(revm[1], depth + 1);
    if (inner !== null) return inner.split("").reverse().join("");
  }

  // string.gsub(s, pat, rep) — handle simple cases
  const gsm = expr.match(/^string\.gsub\s*\(\s*([\s\S]+?)\s*,\s*(.+?)\s*,\s*(.+?)\s*\)\s*$/);
  if (gsm) {
    const inner = _evalLuaStringExpr(gsm[1], depth + 1);
    const pat = _extractLuaString(gsm[2]);
    const rep = _extractLuaString(gsm[3]);
    if (inner !== null && pat !== null && rep !== null) {
      try { return inner.replace(new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), rep); }
      catch { return inner.split(pat).join(rep); }
    }
  }

  // concatenation a .. b .. c
  if (expr.includes("..")) {
    // split on .. not inside quotes
    const parts = [];
    let cur = "", depth2 = 0, inStr = null;
    for (let i = 0; i < expr.length; i++) {
      const c = expr[i];
      if (inStr) {
        cur += c;
        if (c === inStr && expr[i - 1] !== "\\") inStr = null;
      } else if (c === '"' || c === "'") {
        inStr = c; cur += c;
      } else if (c === "(") { depth2++; cur += c; }
      else if (c === ")") { depth2--; cur += c; }
      else if (c === "." && expr[i + 1] === "." && depth2 === 0) {
        parts.push(cur); cur = ""; i++;
      } else cur += c;
    }
    parts.push(cur);
    if (parts.length > 1) {
      const vals = parts.map(p => _evalLuaStringExpr(p, depth + 1));
      if (vals.every(v => v !== null)) return vals.join("");
    }
  }

  return null;
}

// main deobf function
function deobfuscate(src) {
  const s = String(src || "");
  const trimmed = s.trim();

  // pattern 1: file cuma loadstring(EXPR)() di akhir, atau ada prefix kode lain
  // cari loadstring(...)() — yang terakhir
  const m = trimmed.match(/loadstring\s*\(\s*([\s\S]+?)\s*\)\s*\(\s*\)\s*;?\s*$/);
  if (m) {
    const expr = m[1];
    const result = _evalLuaStringExpr(expr);
    if (result !== null && result.length > 0) return { ok: true, code: result, method: "loadstring-expr" };
  }

  // pattern 2: pcall(loadstring, EXPR) atau load(EXPR)
  const m2 = trimmed.match(/(?:loadstring|load)\s*\(\s*([\s\S]+?)\s*\)/);
  if (m2) {
    const result = _evalLuaStringExpr(m2[1]);
    if (result !== null && result.length > 0) return { ok: true, code: result, method: "load" };
  }

  // pattern 3: return EXPR di mana EXPR adalah string concat
  const m3 = trimmed.match(/^return\s+([\s\S]+)$/);
  if (m3) {
    const result = _evalLuaStringExpr(m3[1]);
    if (result !== null && result.length > 0) return { ok: true, code: result, method: "return" };
  }

  // pattern 4: file cuma string literal (base64 dll)
  const direct = _extractLuaString(trimmed);
  if (direct !== null && direct.length > 20) {
    // coba decode sebagai base64
    const decoded = _b64decode(direct);
    if (decoded && decoded.length > 10 && /[\x20-\x7e\n\r\t]/.test(decoded.slice(0, 100))) {
      return { ok: true, code: decoded, method: "base64-literal" };
    }
    return { ok: true, code: direct, method: "string-literal" };
  }

  return { ok: false };
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
    const role = String(params.get("role") || "").slice(0, 32);
    sendWebhook([
      { name: "Event", value: event, inline: false },
      { name: "Username", value: user, inline: true },
      { name: "User ID", value: uid, inline: true },
      { name: "Role", value: role || "-", inline: true },
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
    for (const e of data.errors) parts.push(typeof e === "string" ? e : (e.message || JSON.stringify(e)));
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
    mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", flac: "audio/flac"
  };
  const mime = MIME_MAP[ext] || "application/octet-stream";

  const creator = groupId
    ? { groupId: Number(groupId) }
    : { userId: Number(userId) };

  const form = new FormData();
  form.append("request", JSON.stringify({
    assetType: assetType || "Model",
    displayName: String(displayName).slice(0, 50),
    description: String(description).slice(0, 1000),
    creationContext: { creator }
  }));
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
    else if (r.status === 403) msg = groupId
      ? "Forbidden — cek: key punya akses grup? akun dedicated udah masuk grup & punya role cukup?"
      : "Forbidden — cek permission/key/userId/creator status";
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
  if (groupId) {
    if (!/^\d+$/.test(groupId)) return res.status(200).json({ ok: false, error: "groupId invalid" });
  } else {
    if (!userId || !/^\d+$/.test(userId)) return res.status(200).json({ ok: false, error: "userId invalid" });
  }

  const buffer = await _readRawBody(req);
  if (!buffer) return res.status(200).json({ ok: false, error: "Gagal baca body" });
  if (!buffer.length) return res.status(200).json({ ok: false, error: "File kosong" });

  const ext = fileName.toLowerCase().split(".").pop();
  const allowed = assetType === "Audio" ? ["mp3","ogg","wav","flac"] : ["rbxm","rbxmx"];
  if (!allowed.includes(ext)) {
    return res.status(200).json({ ok: false, error: assetType === "Audio" ? "Audio harus .mp3/.ogg/.wav/.flac" : "Model harus .rbxm/.rbxmx" });
  }

  const result = await _robloxUploadDirect({ apiKey, userId, groupId, buffer, fileName, assetType, displayName, description });
  if (!result.ok) {
    return res.status(200).json({ ok: false, error: result.error, debug: { fileName, size: buffer.length, userId, groupId: groupId || null, status: result.status, assetType } });
  }
  return res.status(200).json({ ok: true, operationId: result.operationId, groupId: groupId || null });
}

async function handleApi(req, res, path, method, params, ctx) {
  const { ADMIN_PW } = ctx;
  const route = path.replace(/^\/api\//, "").replace(/\/$/, "");

  if (route === "upload-rbxm-raw" && method === "POST") {
    return await handleRawUpload(req, res);
  }

  if (route === "deobf/detect" && method === "POST") {
    const buf = await _readRawBody(req);
    res.setHeader("Content-Type", "application/json");
    if (!buf || !buf.length) return res.status(200).json({ ok: false, error: "kosong" });
    const src = buf.toString("utf8");
    return res.status(200).json({ ok: true, detected: detectObfuscator(src), size: src.length });
  }

  if (route === "deobf/run" && method === "POST") {
    const buf = await _readRawBody(req);
    res.setHeader("Content-Type", "application/json");
    if (!buf || !buf.length) return res.status(200).json({ ok: false, error: "kosong" });
    const src = buf.toString("utf8");
    const det = detectObfuscator(src);
    const out = { detected: det, size: src.length, deobf: null, deobfErr: null, method: null };

    const result = deobfuscate(src);
    if (result.ok) {
      out.deobf = result.code;
      out.method = result.method;
    } else {
      if (det.confidence >= 0.9) {
        out.deobfErr = "Tipe " + det.type + " pakai VM/interpreter runtime. Gak bisa deobf statically — butuh runtime trace.";
      } else {
        out.deobfErr = "Pola wrapper gak ketemu. Kemungkinan obfuscator custom atau VM.";
      }
    }

    return res.status(200).json({ ok: true, ...out });
  }

  if (route === "convert" && method === "POST") {
    const buffer = await _readRawBody(req);
    res.setHeader("Content-Type", "application/json");
    if (!buffer || !buffer.length) return res.status(200).json({ ok: false, error: "File kosong" });

    const head8 = buffer.subarray(0, 8).toString("latin1");
    const headXml = buffer.subarray(0, 64).toString("utf8").trim().toLowerCase();

    if (headXml.startsWith("<?xml") || headXml.startsWith("<roblox")) {
      res.setHeader("Content-Type", "text/xml; charset=utf-8");
      return res.status(200).send(buffer.toString("utf8"));
    }

    if (head8 !== "<roblox!") {
      return res.status(200).json({ ok: false, error: "File bukan RBXM/RBXL/RBXMX/RBXLX valid" });
    }

    try {
      const mod = await import("rbx-dom");
      const BinaryFormat = mod.BinaryFormat || (mod.default && mod.default.BinaryFormat);
      const XmlFormat = mod.XmlFormat || (mod.default && mod.default.XmlFormat);
      if (!BinaryFormat || !XmlFormat) throw new Error("rbx-dom tidak punya BinaryFormat/XmlFormat");
      const deserialized = BinaryFormat.deserialize(buffer);
      const xml = XmlFormat.serialize(deserialized);
      res.setHeader("Content-Type", "text/xml; charset=utf-8");
      return res.status(200).send(xml);
    } catch (e) {
      return res.status(200).json({
        ok: false,
        error: "Server belum install paket 'rbx-dom'. Jalankan: npm install rbx-dom lalu redeploy.",
        detail: String(e.message || e)
      });
    }
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
    let body = null;
    try { body = JSON.parse(raw); } catch { body = null; }

    const sid = String((body && body.sid) || "").trim();
    const apiKey = String((body && body.apiKey) || "").trim();
    const userId = String((body && body.userId) || "").trim();
    const groupId = String((body && body.groupId) || "").trim();
    const displayName = String((body && body.displayName) || "Asset").slice(0, 50);
    const description = String((body && body.description) || "").slice(0, 1000);

    if (!sid || !apiKey) return res.status(200).json({ ok: false, error: "data kurang" });
    if (groupId) {
      if (!/^\d+$/.test(groupId)) return res.status(200).json({ ok: false, error: "groupId invalid" });
    } else {
      if (!userId || !/^\d+$/.test(userId)) return res.status(200).json({ ok: false, error: "userId invalid" });
    }

    const meta = await storeGet("nang:up:" + sid + ":meta");
    if (!meta || !meta.total) return res.status(200).json({ ok: false, error: "Session tidak ditemukan / kadaluarsa" });

    const finalGroupId = groupId || meta.groupId || null;

    const buffers = [];
    for (let i = 0; i < meta.total; i++) {
      const key = "nang:up:" + sid + ":" + String(i).padStart(4, "0");
      const b64 = await storeGet(key);
      if (typeof b64 !== "string" || !b64.length) return res.status(200).json({ ok: false, error: "Bagian " + (i + 1) + " dari " + meta.total + " hilang — coba upload ulang" });
      buffers.push(Buffer.from(b64, "base64"));
    }
    const fullBuffer = Buffer.concat(buffers);

    for (let i = 0; i < meta.total; i++) storeDel("nang:up:" + sid + ":" + String(i).padStart(4, "0")).catch(() => {});
    storeDel("nang:up:" + sid + ":meta").catch(() => {});

    const result = await _robloxUploadDirect({ apiKey, userId, groupId: finalGroupId, buffer: fullBuffer, fileName: meta.fileName, assetType: meta.assetType, displayName, description });
    if (!result.ok) return res.status(200).json({ ok: false, error: result.error, debug: { fileName: meta.fileName, size: fullBuffer.length, userId, groupId: finalGroupId, status: result.status, assetType: meta.assetType } });
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
    if (mem && mem.expiresAt > Date.now()) {
      const u = await getUser(mem.username);
      if (u && u.role !== "banned") return u;
    }
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
      const r = await fetch("https://apis.roblox.com/assets/v1/assets", {
        method: "POST", headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ __nang_probe: true }),
      });
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
      const r = await fetch("https://apis.roblox.com/assets/v1/operations/" + encodeURIComponent(operationId), {
        method: "GET", headers: { "x-api-key": apiKey },
      });
      const data = await r.json();
      if (data.done) {
        if (data.error) return res.status(200).json({ ok: true, done: true, error: data.error.message || "Upload gagal" });
        return res.status(200).json({ ok: true, done: true, assetId: data.response && data.response.assetId });
      }
      return res.status(200).json({ ok: true, done: false });
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
    if (!name)    return res.status(200).json({ error: "Nama kosong" });
    if (!fileB64) return res.status(200).json({ error: "File kosong" });
    const allowedExt = ["rbxm","rbxmx","rbxl","rbxlx","lua","txt","zip"];
    if (!allowedExt.includes(ext)) return res.status(200).json({ error: "Ekstensi tidak didukung" });
    const size = Math.floor(fileB64.length * 0.75);
    if (size > MAX_FREE_SIZE) return res.status(200).json({ error: "File > " + (MAX_FREE_SIZE/1024/1024) + " MB" });
    const id = randomHex(8);
    const item = { id, name, desc, ext, size, author: u.username, ts: Date.now(), downloads: 0, file: fileB64 };
    await storeSet("nang:free:" + id, item);
    const list = (await storeGet("nang:freelist")) || [];
    list.unshift(id);
    if (list.length > 200) list.length = 200;
    await storeSet("nang:freelist", list);
    sendWebhook([
      { name: "Event", value: "Free Model Uploaded", inline: false },
      { name: "Name", value: name, inline: true },
      { name: "Author", value: u.username, inline: true },
      { name: "Size", value: (size/1024).toFixed(1) + " KB", inline: true },
    ]);
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
      const key = "nang:fmchunk:" + sid + ":" + String(i).padStart(4, "0");
      const b64 = await storeGet(key);
      if (typeof b64 !== "string" || !b64.length) return res.status(200).json({ error: "Bagian " + (i+1) + "/" + meta.total + " hilang" });
      buffers.push(Buffer.from(b64, "base64"));
    }
    const fullBuffer = Buffer.concat(buffers);
    if (fullBuffer.length > MAX_FREE_SIZE) return res.status(200).json({ error: "File > " + (MAX_FREE_SIZE/1024/1024) + " MB" });

    const allowedExt = ["rbxm","rbxmx","rbxl","rbxlx","lua","txt","zip"];
    if (!allowedExt.includes(meta.ext)) return res.status(200).json({ error: "Ekstensi tidak didukung" });

    const fileB64 = fullBuffer.toString("base64");
    const id = randomHex(8);
    const item = { id, name: meta.name, desc: meta.desc, ext: meta.ext, size: fullBuffer.length, author: u.username, ts: Date.now(), downloads: 0, file: fileB64 };
    await storeSet("nang:free:" + id, item);

    const list = (await storeGet("nang:freelist")) || [];
    list.unshift(id);
    if (list.length > 200) list.length = 200;
    await storeSet("nang:freelist", list);

    for (let i = 0; i < meta.total; i++) storeDel("nang:fmchunk:" + sid + ":" + String(i).padStart(4, "0")).catch(() => {});
    storeDel("nang:fmchunk:" + sid + ":meta").catch(() => {});

    sendWebhook([
      { name: "Event", value: "Free Model Uploaded (chunked)", inline: false },
      { name: "Name", value: meta.name, inline: true },
      { name: "Author", value: u.username, inline: true },
      { name: "Size", value: (fullBuffer.length/1024).toFixed(1) + " KB", inline: true },
    ]);
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
    u.salt = salt;
    u.passwordHash = hashPw(newPw, salt);
    await saveUser(u);
    sendWebhook([
      { name: "Event", value: "Password Changed", inline: false },
      { name: "Username", value: u.username, inline: true },
      { name: "IP", value: _getClientIP(req), inline: true },
    ]);
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
    const oldEmail = u.email;
    if (oldEmail && oldEmail.toLowerCase() !== newEmail) {
      await storeDel("nang:email:" + oldEmail.toLowerCase());
    }
    u.email = newEmail;
    await saveUser(u);
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
      username, email,
      passwordHash: hashPw(password, salt), salt,
      role: isAutoOwner ? "owner" : "member",
      quota: isAutoOwner ? 9999 : DEFAULT_QUOTA,
      keysToday: 0, lastReset: Date.now(),
      createdAt: Date.now(), keys: [],
      store: { price: 500, wa: "", dana: "", name: username, active: false, qr: "" },
    };
    await saveUser(user);
    await storeSet(emailKey, username);
    sendWebhook([
      { name: "Event", value: isAutoOwner ? "New OWNER Registered" : "New Member Registered", inline: false },
      { name: "Username", value: username, inline: true },
      { name: "Email", value: email, inline: true },
      { name: "Role", value: isAutoOwner ? "owner" : "member", inline: true },
      { name: "IP", value: _getClientIP(req), inline: true },
    ]);
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
    return res.status(200).json({
      ok: true,
      user: { username: u.username, email: u.email || null, role: u.role, quota: u.quota, keysToday: u.keysToday, keys: u.keys || [], createdAt: u.createdAt, store: u.store || { ...DEFAULT_STORE } },
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
    if (qr.length > 700000) return res.status(200).json({ error: "QR terlalu besar (max ~500 KB)" });
    if (wa && wa.length < 8) return res.status(200).json({ error: "Nomor WA minimal 8 digit" });
    if (dana && dana.length < 8) return res.status(200).json({ error: "Nomor DANA minimal 8 digit" });
    if (wa.startsWith("0")) wa = "62" + wa.slice(1);
    const hasPay = qr.length > 0 || dana.length >= 8;
    const canActive = active && wa.length >= 8 && hasPay;
    u.store = { price, wa, dana, name: name || u.username, active: canActive, qr };
    await saveUser(u);
    sendWebhook([
      { name: "Event", value: "Store Updated", inline: false },
      { name: "Username", value: u.username, inline: true },
      { name: "Price", value: "Rp" + price, inline: true },
      { name: "WA", value: wa || "-", inline: true },
      { name: "DANA", value: dana || "-", inline: true },
      { name: "Active", value: u.store.active ? "Ya" : "Tidak", inline: true },
      { name: "QR", value: qr ? "Ada" : "Tidak" , inline: true },
    ]);
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
    return res.status(200).json({
      ok: true,
      users: users.map(u => ({ username: u.username, email: u.email || null, role: u.role, quota: u.quota, keysToday: u.keysToday, totalKeys: (u.keys || []).length, createdAt: u.createdAt, store: u.store || null })),
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
body{background:#050510;color:#e8e8f0;font-family:'Inter',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px}
.card{background:rgba(15,15,30,0.75);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.08);border-radius:24px;padding:32px 28px;max-width:420px;width:100%}
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
<div class="row"><span class="label">Sisa</span><span class="val">${hours}j ${mins}m</span></div>
<div class="key" id="keyText">${key}</div>
<button class="btn" onclick="navigator.clipboard.writeText(document.getElementById('keyText').textContent);this.textContent='✓ TERSALIN!';setTimeout(()=>this.textContent='⎘ SALIN KEY',1500)">⎘ SALIN KEY</button>
<div class="notice">Copy key → paste di popup script NANG → verifikasi</div>
</div></body></html>`;
}

function mainPage(wa) {
  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NANG Key System</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--pink:#e03c8a;--purple:#9b4de0;--cyan:#00d4ff;--green:#00e87a;--yellow:#ffc832;--red:#ff6b6b;--bg:#06060e;--bg2:#0d0d1c;--bg3:#13132a;--border:#ffffff10;--border2:#ffffff1a;--text:#eaeaf4;--muted:#5a5a7a}
body{background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:60px 16px 32px;position:relative;overflow-x:hidden}
.hero{text-align:center;margin-bottom:28px;position:relative;z-index:1}
.logo{font-size:2.8rem;font-weight:900;background:linear-gradient(135deg,var(--pink),var(--purple),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent;line-height:1}
.logo-badge{display:inline-block;background:linear-gradient(135deg,var(--pink),var(--purple));color:#fff;font-size:0.55rem;font-weight:800;padding:2px 8px;border-radius:20px;vertical-align:super;margin-left:5px}
.sub{color:var(--muted);font-size:0.78rem;margin-top:7px}
.nav{display:flex;gap:5px;background:rgba(13,13,28,0.8);border:1px solid var(--border2);border-radius:16px;padding:5px;margin-bottom:22px;width:100%;max-width:480px;flex-wrap:wrap;position:relative;z-index:1}
.nav-btn{flex:1;min-width:70px;padding:9px 6px;border:none;border-radius:11px;cursor:pointer;font-size:0.78rem;font-weight:600;background:transparent;color:var(--muted);font-family:inherit}
.nav-btn.active{background:linear-gradient(135deg,rgba(224,60,138,0.25),rgba(155,77,224,0.2));color:#fff;border:1px solid rgba(224,60,138,0.35)}
.panel{width:100%;max-width:480px;display:none}
.panel.active{display:block}
.card{background:rgba(13,13,28,0.7);border:1px solid var(--border2);border-radius:18px;padding:20px;margin-bottom:14px}
.card-title{font-size:0.65rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:2px;margin-bottom:16px}
.card-title::before{content:'';display:inline-block;width:3px;height:12px;background:linear-gradient(to bottom,var(--pink),var(--purple));border-radius:2px;margin-right:8px;vertical-align:middle}
.inp{width:100%;padding:12px 15px;background:rgba(10,10,22,0.8);border:1px solid var(--border2);border-radius:11px;color:var(--text);font-size:0.88rem;outline:none;margin-bottom:10px;font-family:inherit}
.inp:focus{border-color:rgba(224,60,138,0.5)}
.inp::placeholder{color:var(--muted)}
select.inp{cursor:pointer}
.btn-main{width:100%;padding:13px;background:linear-gradient(135deg,var(--pink),var(--purple));color:#fff;border:none;border-radius:12px;font-weight:700;font-size:0.9rem;cursor:pointer;font-family:inherit;margin-bottom:8px}
.btn-cyan{width:100%;padding:13px;background:linear-gradient(135deg,#0099cc,var(--cyan));color:#000;border:none;border-radius:12px;font-weight:700;font-size:0.9rem;cursor:pointer;font-family:inherit}
.btn-green{width:100%;padding:12px;background:linear-gradient(135deg,#00b866,var(--green));color:#000;border:none;border-radius:12px;font-weight:700;font-size:0.85rem;cursor:pointer;font-family:inherit;margin-top:8px}
.result{background:rgba(10,10,22,0.8);border:1px solid var(--border);border-radius:12px;padding:13px;font-size:0.78rem;margin-top:10px;display:none;word-break:break-all}
.result.ok{border-color:rgba(0,232,122,0.35);color:var(--green);display:block}
.result.err{border-color:rgba(255,80,80,0.35);color:#ff6b6b;display:block}
.result.warn{border-color:rgba(255,200,50,0.35);color:#ffc832;display:block}
.result.info{border-color:rgba(0,212,255,0.35);color:var(--cyan);display:block}
.key-line{font-family:'JetBrains Mono',monospace;font-size:0.85rem;color:var(--green);font-weight:700;margin:6px 0;padding:10px;background:rgba(0,20,10,0.8);border-radius:8px;word-break:break-all;border:1px solid rgba(0,232,122,0.2)}
.spinner{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.08);border-top-color:var(--pink);border-radius:50%;animation:spin .6s linear infinite;vertical-align:middle;margin-right:6px}
@keyframes spin{to{transform:rotate(360deg)}}
.hidden{display:none!important}
.auth-bar{position:fixed;top:14px;right:14px;z-index:50;display:flex;gap:8px}
.auth-pill{display:flex;align-items:center;gap:8px;padding:8px 14px;background:rgba(13,13,28,0.85);border:1px solid var(--border2);border-radius:12px;font-size:.8rem}
.auth-pill .uname{font-weight:700}
.auth-btn{padding:8px 14px;background:linear-gradient(135deg,var(--pink),var(--purple));color:#fff;border:none;border-radius:9px;font-weight:700;font-size:.78rem;cursor:pointer;font-family:inherit}
.auth-btn.gray{background:rgba(255,255,255,0.07);border:1px solid var(--border2);color:var(--text)}
.role-tag{font-size:.58rem;font-weight:800;text-transform:uppercase;padding:2px 8px;border-radius:6px}
.role-tag.owner{background:rgba(224,60,138,.15);color:var(--pink)}
.role-tag.admin{background:rgba(155,77,224,.15);color:#c899ff}
.role-tag.reseller{background:rgba(0,212,255,.1);color:var(--cyan)}
.role-tag.member{background:rgba(150,150,170,.1);color:var(--muted)}
.role-tag.banned{background:rgba(255,80,80,.12);color:var(--red)}
.role-badge{display:inline-block;font-size:.55rem;font-weight:800;text-transform:uppercase;padding:2px 7px;border-radius:5px;margin-left:6px}
.role-badge.owner{background:rgba(224,60,138,.2);color:var(--pink)}
.role-badge.admin{background:rgba(155,77,224,.2);color:#c899ff}
.role-badge.reseller{background:rgba(0,212,255,.15);color:var(--cyan)}
.role-badge.member{background:rgba(150,150,170,.12);color:var(--muted)}
.stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}
.stat{background:rgba(255,255,255,0.03);border:1px solid var(--border);padding:14px;border-radius:12px}
.stat .label{font-size:.63rem;color:var(--muted);text-transform:uppercase;letter-spacing:1.2px;font-weight:700}
.stat .value{font-size:1.5rem;font-weight:900;margin-top:5px;font-family:'JetBrains Mono',monospace}
.stat .value.small{font-size:1rem}
.key-item{padding:11px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:10px;margin-bottom:6px;font-size:.75rem;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
.key-item .info{flex:1;min-width:0}
.key-item .k{font-family:'JetBrains Mono',monospace;color:var(--green);font-weight:700;word-break:break-all}
.key-item .meta{color:var(--muted);font-size:.67rem;margin-top:4px}
.key-item .cp{padding:5px 11px;background:rgba(255,255,255,0.05);border:1px solid var(--border2);border-radius:7px;color:var(--text);font-size:.67rem;font-weight:700;cursor:pointer;font-family:inherit}
.key-item .cp:hover{background:rgba(0,232,122,0.1);color:var(--green)}
.modal-tabs{display:flex;gap:4px;background:rgba(10,10,22,0.8);border-radius:10px;padding:4px;margin-bottom:14px;border:1px solid var(--border)}
.modal-tabs button{flex:1;padding:8px;border:none;border-radius:7px;background:transparent;color:var(--muted);font-family:inherit;font-weight:600;font-size:.8rem;cursor:pointer}
.modal-tabs button.on{background:linear-gradient(135deg,rgba(224,60,138,.25),rgba(155,77,224,.2));color:#fff}
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.8);backdrop-filter:blur(8px);display:none;align-items:center;justify-content:center;z-index:100;padding:20px}
.modal-bg.show{display:flex}
.modal-box{background:rgba(13,13,28,0.95);border:1px solid rgba(224,60,138,.3);border-radius:20px;padding:24px;max-width:420px;width:100%;position:relative;max-height:90vh;overflow-y:auto}
.modal-box h3{color:var(--pink);font-size:1rem;margin-bottom:14px;font-weight:800}
.modal-box .x{position:absolute;top:14px;right:18px;cursor:pointer;color:var(--muted);font-size:22px}
.user-row{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:10px;margin-bottom:6px;gap:8px;flex-wrap:wrap}
.user-row .name{font-weight:700;font-size:.9rem;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.user-row .meta{font-size:.7rem;color:var(--muted);margin-top:3px}
.row-actions{display:flex;gap:4px;flex-wrap:wrap}
.row-actions button{padding:5px 10px;border:none;border-radius:7px;font-size:.68rem;font-weight:700;cursor:pointer;font-family:inherit;background:rgba(255,255,255,0.05);color:var(--text);border:1px solid var(--border)}
.row-actions button:hover{background:rgba(255,255,255,0.1)}
.locked{padding:40px 20px;text-align:center;color:var(--muted);font-size:.85rem;line-height:1.8}
.fab{position:fixed;bottom:22px;right:22px;width:50px;height:50px;border-radius:50%;background:linear-gradient(135deg,var(--pink),var(--purple));color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;cursor:pointer;z-index:80;border:none;font-family:inherit}
.fab.active{background:linear-gradient(135deg,#00b866,var(--green))}
.hint{font-size:.7rem;margin:-6px 0 10px;padding-left:4px;color:var(--muted);min-height:14px}
.hint.ok{color:var(--green)}
.hint.err{color:var(--red)}
.kv-warning{max-width:480px;width:100%;padding:10px 14px;background:rgba(255,200,50,.06);border:1px solid rgba(255,200,50,.25);border-radius:10px;font-size:.75rem;color:#ffc832;margin-bottom:14px;text-align:center;position:relative;z-index:1}
.kv-warning b{color:#fff}
.drop{border:2px dashed rgba(255,255,255,0.12);border-radius:14px;padding:28px 16px;text-align:center;cursor:pointer;background:rgba(255,255,255,0.02);margin-bottom:12px}
.drop.done{border-color:var(--green);background:rgba(0,232,122,0.05)}
.drop-icon{font-size:2rem;margin-bottom:8px;opacity:.7}
.drop-text{font-size:0.85rem;margin-bottom:4px;word-break:break-all}
.drop-hint{font-size:0.7rem;color:var(--muted)}
.warn-box{padding:11px 14px;background:rgba(255,200,50,0.05);border:1px solid rgba(255,200,50,0.2);border-radius:11px;font-size:0.75rem;color:var(--yellow);margin-bottom:12px;line-height:1.7}
.warn-box b{color:#fff}
.warn-box a{color:var(--yellow)}
.qr-wrap{display:flex;gap:14px;align-items:flex-start;margin-bottom:14px}
.qr-img{width:100px;height:100px;border-radius:12px;border:2px solid var(--border2);object-fit:cover;flex-shrink:0;background:#fff}
.qr-img-placeholder{width:100px;height:100px;border-radius:12px;border:2px dashed rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:0.7rem;text-align:center;flex-shrink:0;background:rgba(255,255,255,0.02)}
.qr-info{flex:1}
.price-badge{display:inline-flex;background:linear-gradient(135deg,rgba(0,232,122,0.12),rgba(0,212,255,0.08));border:1px solid rgba(0,232,122,0.25);border-radius:10px;padding:6px 12px;font-size:0.9rem;font-weight:800;color:var(--green);margin-bottom:8px;font-family:'JetBrains Mono',monospace}
.fmt-box{background:rgba(10,10,20,0.6);border:1px solid var(--border);border-radius:12px;padding:14px;font-size:0.75rem;color:var(--muted);line-height:2;margin-bottom:12px}
.fmt-box .label{color:var(--pink);font-weight:700}
.fmt-box .field{color:var(--text);font-weight:500}
.fmt-box a{color:var(--cyan);text-decoration:none}
.wa-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:14px;background:linear-gradient(135deg,#1ebe5d,#128c7e);color:#fff;border:none;border-radius:13px;font-size:0.95rem;font-weight:700;cursor:pointer;text-decoration:none;font-family:inherit}
.toggle{display:flex;align-items:center;justify-content:space-between;padding:10px 0;font-size:.85rem}
.toggle .switch{position:relative;width:44px;height:24px;background:rgba(255,255,255,0.08);border-radius:12px;cursor:pointer;border:1px solid var(--border)}
.toggle .switch.on{background:linear-gradient(135deg,var(--pink),var(--purple));border-color:transparent}
.toggle .switch::after{content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;background:#fff;border-radius:50%;transition:.25s}
.toggle .switch.on::after{left:22px}
footer{margin-top:32px;color:var(--muted);font-size:0.68rem;text-align:center;opacity:0.4}
#nangLoader{position:fixed;inset:0;z-index:9999;background:radial-gradient(circle at 50% 50%,#0a0a20 0%,#06060e 100%);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:24px;transition:opacity .5s ease,visibility .5s ease}
#nangLoader.hide{opacity:0;visibility:hidden;pointer-events:none}
.loader-logo{font-size:3.2rem;font-weight:900;background:linear-gradient(135deg,#ff6eb4,#c084fc,#67e8f9,#ff6eb4);background-size:300% 300%;-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:-1.5px;animation:logoGlow 3s ease infinite}
@keyframes logoGlow{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
.loader-sub{color:rgba(255,255,255,.35);font-size:.7rem;letter-spacing:5px;text-transform:uppercase;font-weight:700;margin-top:-10px}
.loader-spinner{width:60px;height:60px;border-radius:50%;position:relative}
.loader-spinner::before,.loader-spinner::after{content:'';position:absolute;inset:0;border-radius:50%;border:3px solid transparent}
.loader-spinner::before{border-top-color:#e03c8a;border-right-color:#9b4de0;animation:spinCW 1s linear infinite}
.loader-spinner::after{inset:8px;border-top-color:#00d4ff;border-left-color:#00e87a;animation:spinCCW 1.4s linear infinite}
@keyframes spinCW{to{transform:rotate(360deg)}}
@keyframes spinCCW{to{transform:rotate(-360deg)}}
.loader-bar{width:220px;height:4px;background:rgba(255,255,255,.05);border-radius:4px;overflow:hidden}
.loader-bar-fill{height:100%;width:0;background:linear-gradient(90deg,#e03c8a,#9b4de0,#00d4ff);border-radius:4px;animation:barFill 1.8s ease forwards}
@keyframes barFill{0%{width:0}100%{width:100%}}
.loader-status{color:rgba(255,255,255,.4);font-size:.72rem;letter-spacing:1.5px;text-transform:uppercase;font-weight:600}
.loader-dots::after{content:'';animation:dots 1.5s steps(4,end) infinite}
@keyframes dots{0%{content:''}25%{content:'.'}50%{content:'..'}75%{content:'...'}}
.loader-version{position:absolute;bottom:20px;right:24px;font-family:'JetBrains Mono',monospace;font-size:.65rem;color:rgba(255,255,255,.2)}
.upload-mode-tabs{display:flex;gap:4px;background:rgba(10,10,22,0.8);border-radius:10px;padding:4px;border:1px solid var(--border);margin-bottom:14px}
.upload-mode-tabs button{flex:1;padding:8px;border:none;border-radius:7px;background:transparent;color:var(--muted);font-family:inherit;font-weight:600;font-size:.8rem;cursor:pointer}
.upload-mode-tabs button.on{background:linear-gradient(135deg,rgba(224,60,138,.25),rgba(155,77,224,.2));color:#fff}
</style></head><body>

<div id="nangLoader">
  <div class="loader-logo">NANG</div>
  <div class="loader-sub">Loading System</div>
  <div class="loader-spinner"></div>
  <div class="loader-bar"><div class="loader-bar-fill"></div></div>
  <div class="loader-status" id="loaderStatus">Initializing<span class="loader-dots"></span></div>
  <div class="loader-version">v${BUILD}</div>
</div>

<div class="auth-bar" id="authBar"></div>
<button class="fab" id="ownerFab" onclick="openOwnerModal()" title="Owner">🔒</button>

<div class="hero">
  <div class="logo">NANG<span class="logo-badge">KEY</span></div>
  <div class="sub">✦ Roblox Script Key System ✦</div>
</div>

<div id="kvWarning" class="kv-warning hidden">
  ⚠️ <b>KV Storage belum aktif</b> — data user akan hilang saat server restart.
</div>

<div id="loginWall">
  <div class="card" style="max-width:420px;width:100%">
    <div style="text-align:center;margin-bottom:18px">
      <div style="font-weight:800;font-size:1rem;color:var(--text)">Masuk ke NANG Key</div>
      <div style="font-size:.72rem;color:var(--muted);margin-top:4px">Login atau daftar akun baru</div>
    </div>
    <div class="modal-tabs">
      <button id="lwTabLogin" class="on" onclick="lwSwitch(0)">Masuk</button>
      <button id="lwTabRegister" onclick="lwSwitch(1)">Daftar</button>
    </div>
    <div id="lwLogin">
      <input class="inp" id="lwUser" placeholder="Username atau Email">
      <input class="inp" id="lwPass" type="password" placeholder="Password">
      <button class="btn-main" onclick="lwDoLogin()">Masuk</button>
      <div class="result" id="lwLoginResult"></div>
    </div>
    <div id="lwRegister" class="hidden">
      <input class="inp" id="lwRegUser" placeholder="Username (huruf/angka/_)">
      <input class="inp" id="lwRegEmail" type="email" placeholder="Email aktif">
      <input class="inp" id="lwRegPass" type="password" placeholder="Password min 5 karakter">
      <input class="inp" id="lwRegPass2" type="password" placeholder="Konfirmasi password">
      <button class="btn-main" onclick="lwDoRegister()">Daftar</button>
      <div class="result" id="lwRegResult"></div>
    </div>
  </div>
</div>

<div id="appContent" class="hidden">
<div class="nav">
  <button class="nav-btn active" onclick="switchTab(0)">Beli Key</button>
  <button class="nav-btn" onclick="switchTab(1)">Convert</button>
  <button class="nav-btn" onclick="switchTab(2)">Upload</button>
  <button class="nav-btn hidden" id="navMyKeys" onclick="switchTab(3)">My Keys</button>
  <button class="nav-btn hidden" id="navStore" onclick="switchTab(4)">Toko</button>
  <button class="nav-btn" onclick="switchTab(5)">Free</button>
  <button class="nav-btn" onclick="switchTab(6)">Profile</button>
</div>

<div class="panel active" id="tab0">
<div class="card">
<div class="card-title">Pilih Penjual</div>
<select class="inp" id="buyStoreSel" onchange="onStoreChange()"><option value="">Memuat...</option></select>
<div class="fmt-box" id="buyStoreInfo">Pilih penjual di atas buat liat harga + WA.</div>
</div>
<div class="card">
<div class="card-title">Pembayaran</div>
<div class="qr-wrap">
<img id="buyQrImg" class="qr-img" style="display:none" alt="QRIS">
<div id="buyDanaBox" class="qr-img-placeholder" style="display:none;border-color:rgba(0,232,122,.4);color:var(--green)"><div>💳<br>DANA</div></div>
<div id="buyQrPlaceholder" class="qr-img-placeholder">QR /<br>DANA<br>kosong</div>
<div class="qr-info">
  <div class="price-badge" id="buyPrice">Rp500 / Key</div>
  <div style="font-size:.75rem;color:var(--muted);line-height:1.9">Transfer <span id="buyPriceTransfer" style="color:var(--text)">Rp500</span><br><span id="buyPayHint" style="font-size:.7rem">Scan QR / nomor WA di bawah</span></div>
</div>
</div>
<div id="buyDanaDetail" style="display:none;margin-top:10px;padding:12px;background:rgba(0,232,122,.05);border:1px solid rgba(0,232,122,.25);border-radius:10px;text-align:center">
  <div style="font-size:.65rem;color:var(--muted);letter-spacing:1.5px;font-weight:800;text-transform:uppercase;margin-bottom:6px">Nomor DANA</div>
  <div style="font-family:'JetBrains Mono',monospace;font-size:1.3rem;font-weight:900;color:var(--green)" id="buyDanaNum">-</div>
  <button class="btn-green" style="margin-top:8px" onclick="copyDana(event)">📋 COPY NOMOR DANA</button>
</div>
<div class="fmt-box"><span class="label">Format pesan WA:</span><br><span class="field" id="buyWaName">Beli Key NANG</span><br>Nama: <span class="field" id="waNama">[isi]</span><br>Roblox ID: <span class="field" id="waUid">[isi]</span><br>Bukti TF: <span class="field">[screenshot]</span><br><br><span class="label">Nomor WA:</span><br><a href="#" id="buyWaNumLink" target="_blank" style="color:var(--green);font-family:'JetBrains Mono',monospace;font-weight:700;text-decoration:none">-</a></div>
<a href="#" class="wa-btn" id="waBtn" target="_blank"><span id="buyWaBtnText">Chat WhatsApp Penjual</span></a>
</div>
<div class="card"><div class="card-title">Cek Username Roblox</div><input type="text" class="inp" id="lookupId" placeholder="Roblox User ID..."><button class="btn-main" onclick="doLookup()">Cek Username</button><div id="lookupResult"></div></div>
</div>

<div class="panel" id="tab1">
<div class="card">
<div class="card-title">RBXL / RBXM → RBXLX</div>
<div class="fmt-box">Upload <span class="field">.rbxl / .rbxm</span> (binary) atau <span class="field">.rbxlx / .rbxmx</span> (XML). Hasil: <span class="field">.rbxlx</span>.<br><br><b style="color:var(--yellow)">Butuh paket <code style="color:var(--cyan)">rbx-dom</code> di server.</b></div>
<input type="file" id="convFile" accept=".rbxl,.rbxm,.rbxlx,.rbxmx" style="display:none" onchange="doConvert()">
<button class="btn-cyan" onclick="document.getElementById('convFile').click()">Pilih File</button>
<div class="result" id="convResult"></div>
</div>
<div class="card">
<div class="card-title">Deobf Detector</div>
<div class="fmt-box">Deteksi tipe obfuscator + coba deobf kalau wrapper-only (loadstring / base64 / string.char).</div>
<input type="file" id="deobfFile" accept=".lua,.txt" style="display:none" onchange="doDeobf()">
<button class="btn-cyan" onclick="document.getElementById('deobfFile').click()">Pilih File Lua</button>
<div class="result" id="deobfResult"></div>
</div>
</div>

<div class="panel" id="tab2">
<div id="uploadLocked" class="card"><div class="locked">🔒 Login dulu buat upload</div></div>
<div id="uploadContent" class="hidden">
<div class="card">
<div class="card-title">📖 Cara Bikin API Key</div>
<div class="fmt-box">
<span class="label">Personal Upload:</span><br>
1. Buka <a href="https://create.roblox.com/dashboard/credentials" target="_blank">create.roblox.com/dashboard/credentials</a><br>
2. Create API Key → Assets API → Write + Read<br>
3. Experience/IP restriction: nonaktif<br>
4. Save & Generate → copy key<br><br>
<span class="label">Group Upload:</span><br>
1. Bikin akun Roblox khusus automation<br>
2. Invite akun ke grup + role min bikin asset<br>
3. Login pakai akun itu → bikin API key<br>
4. Sama kayak di atas, tapi key punya akses grup<br>
5. <b style="color:var(--pink)">Jangan pakai akun utama</b> — key bisa akses semua akun itu
</div>
</div>
<div class="card">
<div class="card-title">📦 Format</div>
<div class="fmt-box">
<b style="color:var(--pink)">📦 Model</b> — .rbxm / .rbxmx — max 20 MB<br>
<b style="color:var(--cyan)">🎵 Audio</b> — .mp3 .ogg .wav .flac — max 7 menit<br>
Limit web: max <span class="field">15 MB</span>
</div>
</div>
<div class="card">
<div class="card-title">Tipe Asset</div>
<div class="modal-tabs" style="margin-bottom:0">
  <button id="upTypeModel" class="on" onclick="upSetType('Model')">📦 Model</button>
  <button id="upTypeAudio" onclick="upSetType('Audio')">🎵 Audio</button>
</div>
</div>
<div class="card">
<div class="card-title">Upload Sebagai</div>
<div class="upload-mode-tabs">
  <button id="upModePersonal" class="on" onclick="upSetMode('personal')">👤 Personal</button>
  <button id="upModeGroup" onclick="upSetMode('group')">👥 Grup</button>
</div>
<div id="upGroupWrap" class="hidden">
  <input type="text" class="inp" id="upGroupId" placeholder="Group ID (contoh: 7654321)" inputmode="numeric">
  <div class="hint" id="upGroupHint">Masukkan ID grup komunitas lu</div>
  <div class="fmt-box" style="font-size:.7rem;line-height:1.7">
    <b style="color:var(--yellow)">⚠️ Penting:</b> API key harus dari <b>akun yang jadi member grup</b> dengan role yang bisa bikin asset. Kalau bukan, upload bakal kena <b>403</b>.
  </div>
</div>
</div>
<div class="card">
<div class="card-title">Akun Roblox / Pemilik API Key</div>
<input type="text" class="inp" id="upUsername" placeholder="Username / User ID pemilik API key...">
<div class="hint" id="upUserHint"></div>
<input type="password" class="inp" id="upApiKey" placeholder="API Key Roblox...">
<div class="hint" id="upKeyHint"></div>
<button class="btn-main" style="background:var(--bg3);color:var(--red);border:1px solid var(--border);margin-top:6px"
  onclick="if(confirm('Hapus data tersimpan untuk akun ini?')){const b=_LS_BASE;Object.values(b).forEach(k=>localStorage.removeItem(_lsKey(k)));_upClearFieldsUI();}">🗑 Hapus Data Tersimpan</button>
</div>
<div class="card">
<div class="card-title">File</div>
<div class="drop" id="upDrop"><div class="drop-icon">📦</div><div class="drop-text">Klik atau drop file</div><div class="drop-hint">.rbxm / .rbxmx — max 15 MB</div></div>
<input type="file" id="upFileInput" accept=".rbxm,.rbxmx" hidden>
<input type="text" class="inp" id="upName" placeholder="Nama asset (opsional)">
<input type="text" class="inp" id="upDesc" placeholder="Deskripsi (opsional)">
<button class="btn-cyan" id="upBtn" onclick="doUploadRbxm()">UPLOAD KE ROBLOX</button>
<div class="result" id="upBigResult"></div>
<div id="upProgress" style="margin-top:12px;display:none">
  <div style="font-size:.82rem;padding:6px 0;color:var(--muted)" id="step1">1. Cari akun Roblox</div>
  <div style="font-size:.82rem;padding:6px 0;color:var(--muted)" id="step2">2. Verifikasi API Key</div>
  <div style="font-size:.82rem;padding:6px 0;color:var(--muted)" id="step3">3. Upload file</div>
  <div style="font-size:.82rem;padding:6px 0;color:var(--muted)" id="step4">4. Tunggu proses</div>
</div>
</div>
</div>
</div>

<div class="panel" id="tab3">
<div class="card">
<div class="card-title">Kuota Saya</div>
<div class="stat-grid">
  <div class="stat"><div class="label">Kuota/hari</div><div class="value" id="mkQuota">—</div></div>
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
<input type="text" class="inp" id="stName" placeholder="Nama toko">
<input type="text" class="inp" id="stPrice" placeholder="Harga per key" inputmode="numeric">
<input type="text" class="inp" id="stWa" placeholder="Nomor WA" inputmode="tel">
<input type="text" class="inp" id="stDana" placeholder="Nomor DANA (kalau gak upload QR)" inputmode="tel">
<div class="toggle"><span>Aktifkan toko</span><div class="switch" id="stActiveSw" onclick="toggleStoreActive()"></div></div>
</div>
<div class="card">
<div class="card-title">📷 QRIS</div>
<input type="file" id="stQrFile" accept="image/*" style="display:none" onchange="onQrFileChange(event)">
<div id="stQrPreviewWrap" class="hidden" style="text-align:center;margin-bottom:12px"><img id="stQrPreview" style="max-width:200px;border-radius:12px;background:#fff;padding:6px"></div>
<div id="stQrEmpty" class="drop" onclick="document.getElementById('stQrFile').click()"><div class="drop-icon">📷</div><div class="drop-text">Klik upload QRIS</div><div class="drop-hint">PNG / JPG — max 500 KB</div></div>
<button class="btn-main" id="stQrDelBtn" style="background:var(--bg3);color:var(--red);display:none" onclick="delQr()">Hapus QR</button>
</div>
<div class="card"><button class="btn-cyan" onclick="doSaveStore()">SIMPAN TOKO</button><div class="result" id="stResult"></div></div>
</div>

<div class="panel" id="tab5">
<div class="card">
<div class="card-title">📥 Upload Free Model</div>
<div class="fmt-box">Share model/script. Support: <span class="field">.rbxm .rbxmx .rbxl .rbxlx .lua .txt .zip</span> — max <span class="field">8 MB</span>.</div>
<input type="text" class="inp" id="fmName" placeholder="Nama model">
<input type="text" class="inp" id="fmDesc" placeholder="Deskripsi (opsional)">
<input type="file" id="fmFile" accept=".rbxm,.rbxmx,.rbxl,.rbxlx,.lua,.txt,.zip" style="display:none" onchange="fmOnFile(event)">
<button class="btn-cyan" onclick="document.getElementById('fmFile').click()">📎 Pilih File</button>
<div class="hint" id="fmFileHint"></div>
<button class="btn-main" id="fmUploadBtn" onclick="fmUpload()">⬆ UPLOAD FREE MODEL</button>
<div class="result" id="fmResult"></div>
</div>
<div class="card">
<div class="card-title">📦 Daftar Free Model</div>
<button class="btn-cyan" style="margin-bottom:10px" onclick="loadFreeModels()">🔄 Refresh</button>
<div id="fmList"><div style="color:var(--muted);font-size:.8rem">Loading...</div></div>
</div>
</div>

<div class="panel" id="tab6">
<div class="card">
<div class="card-title">👤 Akun Saya</div>
<div class="stat-grid">
  <div class="stat"><div class="label">Username</div><div class="value small" id="pfUsername">—</div></div>
  <div class="stat"><div class="label">Role</div><div class="value small" id="pfRole">—</div></div>
  <div class="stat"><div class="label">Email</div><div class="value small" id="pfEmail" style="word-break:break-all;font-size:.7rem">—</div></div>
  <div class="stat"><div class="label">Dibuat</div><div class="value small" id="pfCreated" style="font-size:.75rem">—</div></div>
</div>
</div>
<div class="card">
<div class="card-title">🔒 Ganti Password</div>
<input type="password" class="inp" id="pfOldPw" placeholder="Password lama">
<input type="password" class="inp" id="pfNewPw" placeholder="Password baru (min 5)">
<input type="password" class="inp" id="pfNewPw2" placeholder="Konfirmasi password baru">
<button class="btn-cyan" onclick="pfChangePassword()">GANTI PASSWORD</button>
<div class="result" id="pfPwResult"></div>
</div>
<div class="card">
<div class="card-title">📧 Ganti Email</div>
<input type="password" class="inp" id="pfEmailPw" placeholder="Password (verifikasi)">
<input type="email" class="inp" id="pfNewEmail" placeholder="Email baru">
<button class="btn-cyan" onclick="pfChangeEmail()">GANTI EMAIL</button>
<div class="result" id="pfEmailResult"></div>
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
      <button class="btn-main" style="background:linear-gradient(135deg,#00b866,var(--green));color:#000" onclick="closeOwnerModal();switchTab(4)">🏪 Atur Toko Saya</button>
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
let MY_STORE = { price: 500, wa: "", dana: "", name: "", active: false, qr: "" };
let _qrData = "";
let _upAssetType = "Model";
let _upMode = "personal";
const MAX_FREE_MB = 8;

function $(id){return document.getElementById(id);}
function apiCall(url, opts){
  return fetch(url, opts).then(r=>r.text().then(t=>{
    try { return JSON.parse(t); } catch(e) { return { error: 'Server tidak balikin JSON: '+t.slice(0,120) }; }
  }));
}
function setCookie(n,v,d){ try { document.cookie = n + '=' + encodeURIComponent(v) + '; max-age=' + (d*24*3600) + '; path=/; SameSite=Lax'; } catch(e) {} }
function getCookie(n){ try { const m = document.cookie.match(new RegExp('(^|;\\\\s*)' + n + '=([^;]*)')); return m ? decodeURIComponent(m[2]) : null; } catch(e) { return null; } }
function delCookie(n){ setCookie(n, '', -1); }
function fmtRp(n){ n = parseInt(n) || 0; return 'Rp' + n.toLocaleString('id-ID'); }
function esc(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function _randHex(n){ const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a).map(x => x.toString(16).padStart(2,'0')).join(''); }

function nangLoaderSetStatus(text){ const el = $('loaderStatus'); if(el) el.innerHTML = text + '<span class="loader-dots"></span>'; }
function nangLoaderHide(){
  const el = $('nangLoader');
  if(!el) return;
  nangLoaderSetStatus('Ready');
  setTimeout(()=>{ el.classList.add('hide'); setTimeout(()=>{ try{ el.remove(); }catch(e){} }, 600); }, 400);
}

function switchTab(i){
  document.querySelectorAll('.nav-btn').forEach((b,j)=>b.classList.toggle('active',i===j));
  document.querySelectorAll('.panel').forEach((p,j)=>p.classList.toggle('active',i===j));
  if(i===3) refreshMyKeys();
  if(i===4) refreshStore();
  if(i===5) loadFreeModels();
  if(i===6) loadProfile();
  if(i===0) loadStores();
}

let _lastRefreshAt = parseInt(localStorage.getItem('nang_last_refresh') || '0');

async function checkSession(){
  if(!TOKEN){ const ck = getCookie('nang_session'); if(ck){ TOKEN = ck; localStorage.setItem('nang_session', ck); } }
  if(!TOKEN){ ME=null; updateAuthUI(); return; }
  try{
    const d = await apiCall('/?api=reseller/me&token='+encodeURIComponent(TOKEN));
    if(d.ok){
      ME = d.user;
      const now = Date.now();
      if((now - _lastRefreshAt) > 23 * 3600 * 1000){
        try {
          const rf = await apiCall('/?api=reseller/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TOKEN})});
          if(rf.ok && rf.token){
            TOKEN = rf.token; localStorage.setItem('nang_session', TOKEN); setCookie('nang_session', TOKEN, 30);
            _lastRefreshAt = now; localStorage.setItem('nang_last_refresh', String(now));
          }
        } catch(e) {}
      }
    } else {
      TOKEN=null; ME=null;
      localStorage.removeItem('nang_session'); localStorage.removeItem('nang_last_refresh');
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
    bar.innerHTML = '<div class="auth-pill"><span class="uname">'+esc(ME.username)+'</span><span class="role-tag '+ME.role+'">'+ME.role+'</span><span id="kvStatusPill" title="Storage status" style="font-size:.75rem">⏳</span></div><button class="auth-btn gray" onclick="doAuthLogout()">Logout</button>';
  } else {
    $('loginWall').classList.remove('hidden');
    $('appContent').classList.add('hidden');
    bar.innerHTML = '';
  }
  $('uploadLocked').classList.toggle('hidden', logged);
  $('uploadContent').classList.toggle('hidden', !logged);
  const canMyKeys = logged && (ME.role==='owner'||ME.role==='admin'||ME.role==='reseller');
  $('navMyKeys').classList.toggle('hidden', !canMyKeys);
  const canStore = logged && (ME.role==='owner'||ME.role==='admin'||ME.role==='reseller');
  $('navStore').classList.toggle('hidden', !canStore);
  try { _upLoadFields(); } catch(e) {}
  if(logged) setTimeout(checkKvStatus, 200);
}

async function checkKvStatus(){
  const el = $('kvStatusPill');
  if(!el) return;
  try {
    const r = await fetch('/?kvtest');
    const d = await r.json();
    if(d.ok && d.hasKv){ el.textContent = '🟢'; el.title = 'KV Storage: Connected'; $('kvWarning').classList.add('hidden'); }
    else if(!d.hasKv){ el.textContent = '🟡'; el.title = 'In-Memory Storage'; $('kvWarning').classList.remove('hidden'); }
    else { el.textContent = '🔴'; el.title = 'KV Error: ' + (d.error || 'unknown'); }
  } catch(e){ el.textContent = '🔴'; el.title = 'KV Error: ' + e.message; }
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
  box.className = d.noKv ? 'result warn' : 'result ok';
  box.innerHTML = d.noKv ? '⚠️ Berhasil masuk — server belum pakai KV!' : 'Berhasil masuk';
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
  if(TOKEN){ try{ await apiCall('/?api=reseller/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TOKEN})}); }catch(e){} }
  TOKEN=null; ME=null;
  localStorage.removeItem('nang_session'); localStorage.removeItem('nang_last_refresh');
  _lastRefreshAt = 0; delCookie('nang_session');
  _upClearFieldsUI(); updateAuthUI();
}

async function loadStores(){
  if(!TOKEN) return;
  const d = await apiCall('/?api=stores/list&token='+encodeURIComponent(TOKEN));
  STORES = d.ok ? (d.stores || []) : [];
  const sel = $('buyStoreSel');
  if(!STORES.length){
    sel.innerHTML = '<option value="">Belum ada penjual aktif</option>';
    $('buyStoreInfo').innerHTML = 'Belum ada penjual aktif.';
    return;
  }
  const prev = sel.value;
  sel.innerHTML = STORES.map((s,i)=>'<option value="'+i+'">'+esc(s.name)+' ('+s.role+') — Rp'+(s.price||0).toLocaleString('id-ID')+'</option>').join('');
  if(prev && STORES[prev]) sel.value = prev;
  onStoreChange();
}
function onStoreChange(){
  const idx = parseInt($('buyStoreSel').value);
  if(isNaN(idx) || !STORES[idx]){
    $('buyStoreInfo').innerHTML = 'Pilih penjual di atas.';
    $('buyQrImg').style.display = 'none'; $('buyDanaBox').style.display = 'none';
    $('buyQrPlaceholder').style.display = 'flex'; $('buyDanaDetail').style.display = 'none';
    $('buyWaNumLink').textContent = '-'; $('buyWaNumLink').href = '#';
    return;
  }
  const s = STORES[idx];
  const price = s.price || 500;
  $('buyStoreInfo').innerHTML = 'Penjual: <span class="field">'+esc(s.name)+'</span><br>Harga: <span class="field">'+fmtRp(price)+'</span><br>WA: <span class="field">+'+esc(s.wa)+'</span>'+(s.dana ? '<br>DANA: <span class="field">+'+esc(s.dana)+'</span>' : '');
  $('buyPrice').textContent = fmtRp(price) + ' / Key';
  $('buyPriceTransfer').textContent = fmtRp(price);
  $('buyWaName').textContent = 'Beli Key ' + s.name;
  $('buyWaBtnText').textContent = 'Chat WhatsApp ' + s.name;
  $('buyWaNumLink').textContent = '+' + s.wa;
  $('buyWaNumLink').href = 'https://wa.me/' + s.wa;
  updateWA();
  $('buyQrImg').style.display = 'none'; $('buyDanaBox').style.display = 'none';
  $('buyQrPlaceholder').style.display = 'none'; $('buyDanaDetail').style.display = 'none';
  if(s.hasQr){
    $('buyQrImg').style.display = 'block'; $('buyQrImg').src = "";
    $('buyPayHint').textContent = 'Scan QR untuk bayar';
    apiCall('/?api=stores/pay&username='+encodeURIComponent(s.username)+'&token='+encodeURIComponent(TOKEN))
      .then(r => {
        if(r.ok && r.qr) $('buyQrImg').src = r.qr;
        else if(s.dana){ $('buyQrImg').style.display='none'; _showDana(s); }
        else { $('buyQrImg').style.display='none'; $('buyQrPlaceholder').style.display='flex'; }
      })
      .catch(() => {
        if(s.dana){ $('buyQrImg').style.display='none'; _showDana(s); }
        else { $('buyQrImg').style.display='none'; $('buyQrPlaceholder').style.display='flex'; }
      });
  } else if (s.dana && s.dana.length >= 8) { _showDana(s); }
  else { $('buyQrPlaceholder').style.display = 'flex'; $('buyPayHint').textContent = 'Penjual belum pasang QR / DANA'; }
}
function _showDana(s){
  $('buyDanaBox').style.display = 'flex';
  $('buyPayHint').textContent = 'Bayar via DANA';
  $('buyDanaDetail').style.display = 'block';
  $('buyDanaNum').textContent = '+' + s.dana;
  $('buyDanaDetail').dataset.dana = s.dana;
}
function copyDana(ev){
  const d = $('buyDanaDetail').dataset.dana || '';
  if(!d) return;
  navigator.clipboard.writeText('+' + d).then(() => {
    const b = (ev && ev.target) || null; if(!b) return;
    const orig = b.textContent; b.textContent = '✓ COPIED!';
    setTimeout(() => { b.textContent = orig; }, 1500);
  });
}
function updateWA(){
  const idx = parseInt($('buyStoreSel').value);
  if(isNaN(idx) || !STORES[idx]){ $('waBtn').href = '#'; return; }
  const s = STORES[idx];
  const nama = lastLookup.name || '[isi]';
  const uid = lastLookup.uid || '[isi]';
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
      lastLookup={uid:d.uid,name:d.name}; updateWA();
      box.className='result ok';
      box.innerHTML='Username: <b>'+esc(d.name)+'</b> · ID: '+esc(d.uid);
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
  if(!ME.keys || !ME.keys.length){ hist.innerHTML = '<div style="color:var(--muted);font-size:.8rem">Belum ada key.</div>'; return; }
  hist.innerHTML = ME.keys.map(k =>
    '<div class="key-item"><div class="info"><div class="k">'+esc(k.key)+'</div>'+
    '<div class="meta">UID: '+esc(k.uid)+' · '+esc(k.name||'?')+' · '+new Date(k.ts).toLocaleString('id-ID')+'</div></div>'+
    '<button class="cp" onclick="copyKey(\\''+k.key+'\\',this)">COPY</button></div>'
  ).join('');
}
function copyKey(k, btn){ navigator.clipboard.writeText(k).then(()=>{ if(btn){ btn.textContent = 'OK'; setTimeout(()=>{ btn.textContent = 'COPY'; }, 1200); } }); }
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
    box.innerHTML = '<b>'+esc(d.username||'Unknown')+'</b><span class="role-badge '+d.role+'">'+d.role+'</span><div class="key-line">'+esc(d.key)+'</div><div style="font-size:.75rem;color:var(--muted)">Berlaku: '+esc(d.expires)+' · Sisa: '+esc(d.remaining)+'</div><button class="btn-green" onclick="navigator.clipboard.writeText(\\''+d.key+'\\');this.textContent=\\'COPIED\\';setTimeout(()=>this.textContent=\\'COPY KEY\\',1500)">COPY KEY</button>';
    $('mkUid').value='';
    await refreshMyKeys();
  } catch(e) { box.className='result err'; box.innerHTML='Error: '+esc(e.message); }
  finally { btn.disabled = false; btn.textContent = 'GENERATE KEY'; }
}

async function refreshStore(){
  if(!TOKEN) return;
  const d = await apiCall('/?api=reseller/store&token='+encodeURIComponent(TOKEN));
  if(!d.ok) return;
  MY_STORE = d.store || { price: 500, wa: "", dana: "", name: "", active: false, qr: "" };
  $('stName').value = MY_STORE.name || '';
  $('stPrice').value = MY_STORE.price || 500;
  $('stWa').value = MY_STORE.wa || '';
  $('stDana').value = MY_STORE.dana || '';
  $('stActiveSw').classList.toggle('on', !!MY_STORE.active);
  _qrData = MY_STORE.qr || "";
  if(_qrData){
    $('stQrPreview').src = _qrData; $('stQrPreviewWrap').classList.remove('hidden');
    $('stQrEmpty').classList.add('hidden'); $('stQrDelBtn').style.display = 'block';
  } else {
    $('stQrPreview').src = ""; $('stQrPreviewWrap').classList.add('hidden');
    $('stQrEmpty').classList.remove('hidden'); $('stQrDelBtn').style.display = 'none';
  }
}
function toggleStoreActive(){ $('stActiveSw').classList.toggle('on'); }
function onQrFileChange(e){
  const f = e.target.files[0]; if(!f) return;
  if(!f.type.startsWith("image/")) { alert("Harus gambar"); return; }
  if(f.size > 500*1024) { alert("Max 500 KB"); return; }
  const r = new FileReader();
  r.onload = () => {
    _qrData = r.result;
    $('stQrPreview').src = _qrData; $('stQrPreviewWrap').classList.remove('hidden');
    $('stQrEmpty').classList.add('hidden'); $('stQrDelBtn').style.display = 'block';
  };
  r.readAsDataURL(f); e.target.value = "";
}
function delQr(){
  _qrData = ""; $('stQrPreview').src = "";
  $('stQrPreviewWrap').classList.add('hidden'); $('stQrEmpty').classList.remove('hidden');
  $('stQrDelBtn').style.display = 'none';
}
async function doSaveStore(){
  const name = $('stName').value.trim();
  const price = parseInt($('stPrice').value) || 0;
  let wa = $('stWa').value.trim().replace(/[^0-9]/g, '');
  let dana = $('stDana').value.trim().replace(/[^0-9]/g, '');
  const active = $('stActiveSw').classList.contains('on');
  const box = $('stResult');
  if(active && wa.length < 8){ box.className='result err'; box.innerHTML='Kalau toko aktif, WA wajib'; return; }
  if(active && !_qrData && dana.length < 8){ box.className='result err'; box.innerHTML='Wajib ada QR atau DANA'; return; }
  box.className='result info'; box.innerHTML='<span class="spinner"></span>Menyimpan...';
  try {
    const d = await apiCall('/?api=reseller/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TOKEN, name, price, wa, dana, active, qr: _qrData || ""})});
    if(d.error){ box.className='result err'; box.innerHTML=esc(d.error); return; }
    MY_STORE = d.store;
    box.className='result ok';
    box.innerHTML = 'Toko tersimpan! ' + (d.store.active ? 'Toko aktif.' : 'Nonaktif.');
    await refreshStore(); await loadStores();
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
    const d = await r.json();
    if(!d.ok){ box.className='result err'; box.innerHTML=esc(d.error||'Gagal'); return; }
    OWNER_TOKEN = d.token;
    localStorage.setItem('nang_owner', OWNER_TOKEN);
    $('oPw').value=''; box.className='result'; box.innerHTML='';
    $('ownerLoginForm').classList.add('hidden');
    $('ownerPanel').classList.remove('hidden');
    $('ownerFab').classList.add('active');
    loadUsers();
  } catch(e) { box.className='result err'; box.innerHTML='Error: '+esc(e.message); }
}
function doOwnerLogout(){
  OWNER_TOKEN = null; localStorage.removeItem('nang_owner');
  $('ownerLoginForm').classList.remove('hidden'); $('ownerPanel').classList.add('hidden');
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
      const isOwner = u.role === 'owner';
      const isAdmin = u.role === 'admin';
      const isReseller = u.role === 'reseller';
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
  const st = u.store || { price: 500, wa: '', dana: '', name: username, active: false };
  const name = prompt('Nama toko untuk '+username+':', st.name || username); if(name === null) return;
  const price = prompt('Harga per key:', st.price || 500); if(price === null) return;
  const wa = prompt('Nomor WA:', st.wa || ''); if(wa === null) return;
  const dana = prompt('Nomor DANA (kosongkan kalau ada QR):', st.dana || ''); if(dana === null) return;
  const active = confirm('Aktifkan toko?');
  const d = await apiCall('/?api=owner/setstore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ot:OWNER_TOKEN, username, name, price: parseInt(price)||0, wa, dana, active})});
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
    box.innerHTML = '<b>'+esc(d.username||'Unknown')+'</b><span class="role-badge owner">owner</span><div class="key-line">'+esc(d.key)+'</div><div style="font-size:.75rem;color:var(--muted)">Expires: '+esc(d.expires)+'</div>';
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
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("xml")) {
      const xml = await r.text();
      const outName = file.name.replace(/\\.(rbxl|rbxm)$/i,'.rbxlx') || 'converted.rbxlx';
      const blob = new Blob([xml], {type:'text/xml'});
      const url = URL.createObjectURL(blob);
      box.className='result ok';
      box.innerHTML='Berhasil!<div class="key-line"><a href="'+url+'" download="'+outName+'" style="color:#00d4ff;text-decoration:none">⬇ Download '+outName+'</a></div>';
      return;
    }
    const text = await r.text();
    let d; try { d = JSON.parse(text); } catch(e) { d = { error: text.slice(0,200) }; }
    box.className='result err';
    box.innerHTML = 'Gagal: ' + esc(d.error || 'unknown') + (d.detail ? '<br><small style="color:var(--muted)">'+esc(d.detail)+'</small>' : '');
  }catch(e){box.className='result err';box.innerHTML='Error: '+esc(e.message);}
}

async function doDeobf(){
  const input = $('deobfFile');
  const box = $('deobfResult');
  if(!input.files || !input.files[0]) return;
  const f = input.files[0];
  if(f.size > 5*1024*1024){ box.className='result err'; box.innerHTML='File > 5 MB'; return; }
  box.className='result info';
  box.innerHTML='<span class="spinner"></span>Analisis...';
  try {
    const buf = await f.arrayBuffer();
    const r = await fetch('/?api=deobf/run', { method:'POST', headers:{'Content-Type':'application/octet-stream'}, body:buf });
    const d = await r.json();
    if(!d.ok){ box.className='result err'; box.innerHTML='Gagal: '+esc(d.error); return; }
    const t = d.detected;
    let html = '<b>Tipe:</b> '+esc(t.type)+' ('+Math.round((t.confidence||0)*100)+'%)<br>';
    html += '<b>Size:</b> '+d.size.toLocaleString('id-ID')+' bytes';
    if(d.deobf){
      html += '<br><b style="color:var(--green)">✓ Deobf berhasil!</b> ('+esc(d.method||'-')+')';
      html += '<br>Output: '+d.deobf.length.toLocaleString('id-ID')+' bytes';
      html += '<br><button class="btn-green" style="margin-top:8px" onclick="downloadDeobf()">⬇ Download .lua</button>';
      window.__deobfOut = d.deobf;
    } else if(d.deobfErr){
      html += '<br><span style="color:var(--yellow)">⚠️</span> '+esc(d.deobfErr);
    }
    box.className='result ok';
    box.innerHTML = html;
  } catch(e){ box.className='result err'; box.innerHTML='Error: '+esc(e.message); }
}
function downloadDeobf(){
  const s = window.__deobfOut || '';
  const blob = new Blob([s], {type:'text/plain'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'deobfuscated.lua';
  a.click();
}

let _upFile=null;
const upDrop=$('upDrop');
const upFileInput=$('upFileInput');
const upBigResult=$('upBigResult');

const _LS_BASE = {
  user: 'nang_up_username',
  key: 'nang_up_apikey',
  name: 'nang_up_name',
  desc: 'nang_up_desc',
  type: 'nang_up_type',
  mode: 'nang_up_mode',
  group: 'nang_up_group',
};
function _lsKey(k){ const who = (ME && ME.username) ? ME.username.toLowerCase() : '_guest'; return k + ':' + who; }
function _upSaveFields(){
  try{
    localStorage.setItem(_lsKey(_LS_BASE.user), $('upUsername').value.trim());
    localStorage.setItem(_lsKey(_LS_BASE.key),  $('upApiKey').value.trim());
    localStorage.setItem(_lsKey(_LS_BASE.name), $('upName').value.trim());
    localStorage.setItem(_lsKey(_LS_BASE.desc), $('upDesc').value.trim());
    localStorage.setItem(_lsKey(_LS_BASE.type), _upAssetType);
    localStorage.setItem(_lsKey(_LS_BASE.mode), _upMode);
    localStorage.setItem(_lsKey(_LS_BASE.group), $('upGroupId').value.trim());
  }catch(e){}
}
function _upClearFieldsUI(){
  try{
    $('upUsername').value = ''; $('upApiKey').value = ''; $('upName').value = ''; $('upDesc').value = ''; $('upGroupId').value = '';
    $('upUserHint').className='hint'; $('upUserHint').textContent='';
    $('upKeyHint').className='hint'; $('upKeyHint').textContent='';
    $('upGroupHint').className='hint'; $('upGroupHint').textContent='Masukkan ID grup komunitas lu';
  }catch(e){}
}
function _upLoadFields(){
  try{
    const u = localStorage.getItem(_lsKey(_LS_BASE.user));
    const k = localStorage.getItem(_lsKey(_LS_BASE.key));
    const n = localStorage.getItem(_lsKey(_LS_BASE.name));
    const d = localStorage.getItem(_lsKey(_LS_BASE.desc));
    const t = localStorage.getItem(_lsKey(_LS_BASE.type));
    const m = localStorage.getItem(_lsKey(_LS_BASE.mode));
    const g = localStorage.getItem(_lsKey(_LS_BASE.group));
    $('upUsername').value = u || ''; $('upApiKey').value = k || '';
    $('upName').value = n || ''; $('upDesc').value = d || '';
    $('upGroupId').value = g || '';
    if(t === 'Audio' || t === 'Model') upSetType(t); else upSetType('Model');
    upSetMode(m === 'group' ? 'group' : 'personal', true);
    if(u){
      try { $('upUsername').dispatchEvent(new Event('input', { bubbles:true })); } catch(e){}
      try { $('upApiKey').dispatchEvent(new Event('blur', { bubbles:true })); } catch(e){}
    }
    if(g){
      try { $('upGroupId').dispatchEvent(new Event('input', { bubbles:true })); } catch(e){}
    }
  }catch(e){}
}

function upSetMode(mode, silent){
  _upMode = mode;
  $('upModePersonal').classList.toggle('on', mode === 'personal');
  $('upModeGroup').classList.toggle('on', mode === 'group');
  $('upGroupWrap').classList.toggle('hidden', mode !== 'group');
  if(!silent) _upSaveFields();
}

upDrop.addEventListener('click',()=>upFileInput.click());
upDrop.addEventListener('dragover',e=>{e.preventDefault();upDrop.classList.add('over');});
upDrop.addEventListener('dragleave',()=>upDrop.classList.remove('over'));
upDrop.addEventListener('drop',e=>{e.preventDefault();upDrop.classList.remove('over');if(e.dataTransfer.files.length)_upHandleFile(e.dataTransfer.files[0]);});
upFileInput.addEventListener('change',e=>{if(e.target.files.length)_upHandleFile(e.target.files[0]);});

function upSetType(t){
  try{ localStorage.setItem(_lsKey(_LS_BASE.type), t); }catch(e){}
  _upAssetType = t;
  $('upTypeModel').classList.toggle('on', t === 'Model');
  $('upTypeAudio').classList.toggle('on', t === 'Audio');
  const isAudio = t === 'Audio';
  const accept = isAudio ? '.mp3,.ogg,.wav,.flac' : '.rbxm,.rbxmx';
  const hint = isAudio ? '.mp3 / .ogg / .wav / .flac — max 15 MB' : '.rbxm / .rbxmx — max 15 MB';
  const icon = isAudio ? '🎵' : '📦';
  upFileInput.setAttribute('accept', accept);
  upDrop.querySelector('.drop-hint').textContent = hint;
  if (_upFile) {
    const n = _upFile.name.toLowerCase();
    const ok = isAudio ? /\.(mp3|ogg|wav|flac)$/.test(n) : /\.(rbxm|rbxmx)$/.test(n);
    if (!ok) {
      _upFile = null; upDrop.classList.remove('done');
      upDrop.querySelector('.drop-icon').textContent = icon;
      upDrop.querySelector('.drop-text').textContent = 'Klik atau drop file';
      upDrop.querySelector('.drop-hint').textContent = hint;
      _upHideBig();
    }
  } else { upDrop.querySelector('.drop-icon').textContent = icon; }
}

function _upHandleFile(f){
  const n=f.name.toLowerCase();
  const isAudio = _upAssetType === 'Audio';
  const valid = isAudio ? /\.(mp3|ogg|wav|flac)$/.test(n) : /\.(rbxm|rbxmx)$/.test(n);
  if(!valid){ return _upBigShowFail(isAudio ? 'File harus .mp3 / .ogg / .wav / .flac' : 'File harus .rbxm atau .rbxmx'); }
  if(f.size>15*1024*1024){ return _upBigShowFail('File > 15 MB'); }
  _upFile=f;
  upDrop.classList.add('done');
  upDrop.querySelector('.drop-icon').textContent='✓';
  upDrop.querySelector('.drop-text').textContent=f.name;
  upDrop.querySelector('.drop-hint').textContent=(f.size/1024).toFixed(1)+' KB';
  _upHideBig();
}
function _upHideBig(){ upBigResult.className='result'; upBigResult.innerHTML=''; }
function _upBigShowFail(msg, hint){
  $('upProgress').style.display='none';
  upBigResult.className='result err';
  upBigResult.innerHTML = '❌ '+esc(msg)+(hint ? '<br><small>💡 '+esc(hint)+'</small>' : '');
}
function _upBigShowSuccess(assetId, assetName, assetType, groupId){
  $('upProgress').style.display='none';
  const ico = assetType === 'Audio' ? '🎵' : '📦';
  const target = groupId ? 'Grup #' + groupId : 'Akun pribadi';
  upBigResult.className='result ok';
  upBigResult.innerHTML = '✅ UPLOAD BERHASIL ke <b>'+esc(target)+'</b><br>'+ico+' <b>'+esc(assetName||'Asset')+'</b><br><div class="key-line">Asset ID: '+esc(assetId)+'</div>'+
    '<a href="https://www.roblox.com/library/'+encodeURIComponent(assetId)+'" target="_blank" style="color:var(--cyan)">🌐 Buka di Roblox</a> '+
    '<button class="cp" onclick="navigator.clipboard.writeText(\\''+assetId+'\\');this.textContent=\\'✓ COPIED\\';setTimeout(()=>this.textContent=\\'📋 COPY ID\\',1500)">📋 COPY ID</button>';
}
function _upStep(n, state){
  const el = $('step'+n);
  if(!el) return;
  const colors = { active:'var(--cyan)', done:'var(--green)', err:'var(--red)' };
  el.style.color = state ? colors[state] : 'var(--muted)';
}
function _upShowStep3(text){
  const el = $('step3');
  if (el) el.innerHTML = '<span class="spinner"></span>' + esc(text);
}

async function doUploadRbxm(){
  const username=$('upUsername').value.trim();
  const apiKey=$('upApiKey').value.trim();
  const name=$('upName').value.trim();
  const desc=$('upDesc').value.trim();
  const groupId = _upMode === 'group' ? $('upGroupId').value.trim() : '';

  if(!username) return _upBigShowFail('Username / User ID kosong');
  if(!apiKey) return _upBigShowFail('API Key kosong');
  if(_upMode === 'group' && !groupId) return _upBigShowFail('Group ID kosong', 'Isi Group ID di panel "Upload Sebagai → Grup"');
  if(_upMode === 'group' && !/^\d+$/.test(groupId)) return _upBigShowFail('Group ID tidak valid', 'Hanya angka');
  if(!_upFile) return _upBigShowFail('Belum ada file dipilih');

  _upSaveFields();
  const btn=$('upBtn');
  btn.disabled=true; btn.textContent='⏳ PROSES...';
  _upHideBig();
  $('upProgress').style.display='block';
  _upStep(1,'active'); _upStep(2,''); _upStep(3,''); _upStep(4,'');

  try{
    const lk=await apiCall('/?api=lookup-user',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:username})});
    if(!lk.ok){ _upStep(1,'err'); throw new Error('Gagal cari akun: '+(lk.error||'tidak ditemukan')); }
    _upStep(1,'done');

    if(_upMode === 'group'){
      const gk = await apiCall('/?api=lookup-group',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({groupId})});
      if(!gk.ok){ _upStep(1,'err'); throw new Error('Grup tidak ditemukan: '+(gk.error||'')); }
    }

    _upStep(2,'active');
    const vk=await apiCall('/?api=verify-apikey',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey})});
    if(!vk.ok){ _upStep(2,'err'); throw new Error('API Key: '+(vk.error||'tidak valid')); }
    _upStep(2,'done');
    _upStep(3,'active');

    const CHUNK_SIZE = 500 * 1024;
    const totalChunks = Math.max(1, Math.ceil(_upFile.size / CHUNK_SIZE));
    let operationId = null;

    if (totalChunks <= 1) {
      _upShowStep3('Mengirim file...');
      const headers = {
        'Content-Type': 'application/octet-stream',
        'x-nang-apikey': apiKey,
        'x-nang-filename': _upFile.name,
        'x-nang-display': (name || _upFile.name.replace(/\.(rbxm|rbxmx|mp3|ogg|wav|flac)$/i,'')).slice(0,50),
        'x-nang-desc': (desc || 'Upload via NANG web').slice(0,1000),
        'x-nang-assettype': _upAssetType
      };
      if(groupId) headers['x-nang-groupid'] = groupId;
      else headers['x-nang-userid'] = String(lk.userId);

      const r = await fetch('/?api=upload-rbxm-raw', { method: 'POST', headers, body: _upFile });
      const upText = await r.text();
      let up; try { up = JSON.parse(upText); } catch(e){ throw new Error('Server tidak balikin JSON'); }
      if(!up.ok){ _upStep(3,'err'); throw new Error(up.error || 'Upload gagal'); }
      operationId = up.operationId;
    } else {
      const sid = _randHex(16);
      const displayName = (name || _upFile.name.replace(/\.(rbxm|rbxmx|mp3|ogg|wav|flac)$/i,'')).slice(0,50);
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, _upFile.size);
        const chunk = _upFile.slice(start, end);
        const pct = Math.round((end / _upFile.size) * 100);
        _upShowStep3('Kirim bagian '+(i+1)+'/'+totalChunks+' ('+pct+'%)...');
        let url = '/?api=upload-chunk&sid=' + encodeURIComponent(sid) + '&idx=' + i + '&total=' + totalChunks + '&fn=' + encodeURIComponent(_upFile.name) + '&at=' + encodeURIComponent(_upAssetType);
        if(groupId) url += '&gid=' + encodeURIComponent(groupId);
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: chunk });
        const d = await r.json();
        if (!d.ok) { _upStep(3,'err'); throw new Error('Gagal bagian '+(i+1)+': '+(d.error||'unknown')); }
      }
      _upShowStep3('Gabung & upload ke Roblox...');
      const commitBody = { sid, apiKey, displayName, description: desc || 'Upload via NANG web' };
      if(groupId) commitBody.groupId = groupId;
      else commitBody.userId = lk.userId;
      const commit = await apiCall('/?api=upload-commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(commitBody) });
      if (!commit.ok) { _upStep(3,'err'); throw new Error(commit.error || 'Commit gagal'); }
      operationId = commit.operationId;
    }
    _upStep(3,'done');
    _upStep(4,'active');
    let assetId=null, lastErr=null;
    for(let i=0;i<80;i++){
      await new Promise(res=>setTimeout(res,1500));
      const st=await apiCall('/?api=upload-status&id='+encodeURIComponent(operationId)+'&k='+encodeURIComponent(apiKey));
      if(!st.ok){ lastErr = st.error; continue; }
      if(st.done){
        if(st.error){ _upStep(4,'err'); throw new Error('Roblox tolak: ' + st.error); }
        assetId = st.assetId;
        break;
      }
    }
    if(!assetId){ _upStep(4,'err'); throw new Error(lastErr || 'Timeout. Cek dashboard Roblox.'); }
    _upStep(4,'done');
    _upBigShowSuccess(assetId, name || _upFile.name.replace(/\.(rbxm|rbxmx|mp3|ogg|wav|flac)$/i,''), _upAssetType, groupId);
  }
  catch(e){ _upBigShowFail(e.message || 'Error tidak diketahui'); }
  finally{ btn.disabled=false; btn.textContent='UPLOAD KE ROBLOX'; }
}

let _fmFile = null;

function fmOnFile(e){
  const f = e.target.files[0];
  if(!f) return;
  if(f.size > MAX_FREE_MB * 1024 * 1024){
    $('fmFileHint').className = 'hint err';
    $('fmFileHint').textContent = '✗ File > ' + MAX_FREE_MB + ' MB (' + (f.size/1024/1024).toFixed(2) + ' MB)';
    _fmFile = null; return;
  }
  _fmFile = f;
  $('fmFileHint').className = 'hint ok';
  $('fmFileHint').textContent = '✓ ' + f.name + ' (' + (f.size/1024).toFixed(1) + ' KB)';
  e.target.value = '';
}

async function fmUpload(){
  const box = $('fmResult');
  const name = $('fmName').value.trim();
  const desc = $('fmDesc').value.trim();
  if(!name){ box.className='result err'; box.innerHTML='Isi nama'; return; }
  if(!_fmFile){ box.className='result err'; box.innerHTML='Pilih file'; return; }
  const ext = _fmFile.name.toLowerCase().split('.').pop();
  const btn = $('fmUploadBtn');
  btn.disabled = true; btn.textContent = '⏳ PROSES...';
  box.className='result info'; box.innerHTML='<span class="spinner"></span>Upload...';
  try {
    if (_fmFile.size < 2.5 * 1024 * 1024) {
      const buf = await _fmFile.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let b64 = '';
      const chunkSz = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSz) b64 += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSz));
      b64 = btoa(b64);
      const d = await apiCall('/?api=free/upload', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ token:TOKEN, name, desc, ext, file:b64 }) });
      if(d.error){ box.className='result err'; box.innerHTML=esc(d.error); return; }
    } else {
      const sid = _randHex(16);
      const CHUNK_SIZE = 1 * 1024 * 1024;
      const total = Math.ceil(_fmFile.size / CHUNK_SIZE);
      for (let i = 0; i < total; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, _fmFile.size);
        const chunk = _fmFile.slice(start, end);
        const pct = Math.round((end / _fmFile.size) * 80);
        box.className='result info';
        box.innerHTML='<span class="spinner"></span>Upload '+ (i+1) +'/'+ total +' ('+ pct +'%)...';
        const url = '/?api=free/upload-chunk&sid=' + encodeURIComponent(sid) + '&idx=' + i + '&total=' + total + '&name=' + encodeURIComponent(name) + '&desc=' + encodeURIComponent(desc) + '&ext=' + encodeURIComponent(ext) + '&token=' + encodeURIComponent(TOKEN);
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: chunk });
        const d = await r.json();
        if (!d.ok) { box.className='result err'; box.innerHTML='Gagal bagian '+(i+1)+': '+esc(d.error||'unknown'); return; }
      }
      box.className='result info'; box.innerHTML='<span class="spinner"></span>Gabung...';
      const commit = await apiCall('/?api=free/upload-commit', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ token:TOKEN, sid }) });
      if(commit.error){ box.className='result err'; box.innerHTML=esc(commit.error); return; }
    }
    box.className='result ok'; box.innerHTML='✓ Upload berhasil!';
    $('fmName').value=''; $('fmDesc').value=''; _fmFile=null;
    $('fmFileHint').className='hint'; $('fmFileHint').textContent='';
    loadFreeModels();
  } catch(e) { box.className='result err'; box.innerHTML='Error: '+esc(e.message); }
  finally { btn.disabled = false; btn.textContent = '⬆ UPLOAD FREE MODEL'; }
}

async function loadFreeModels(){
  const box = $('fmList');
  if(!TOKEN){ box.innerHTML='<div style="color:var(--muted);font-size:.8rem">Login dulu</div>'; return; }
  box.innerHTML='<div style="color:var(--muted);font-size:.8rem"><span class="spinner"></span>Loading...</div>';
  try{
    const d = await apiCall('/?api=free/list&token='+encodeURIComponent(TOKEN));
    if(!d.ok){ box.innerHTML='<div style="color:var(--red);font-size:.8rem">'+esc(d.error||'Gagal')+'</div>'; return; }
    if(!d.items || !d.items.length){ box.innerHTML='<div style="color:var(--muted);font-size:.8rem">Belum ada model. Jadi yang pertama! 🚀</div>'; return; }
    const canDel = ME && (ME.role==='owner'||ME.role==='admin');
    box.innerHTML = d.items.map(m => {
      const canDelThis = canDel || (ME && ME.username === m.author);
      const sizeKb = (m.size/1024).toFixed(1);
      const safeName = esc(m.name).replace(/'/g, '');
      return '<div class="key-item" style="align-items:flex-start"><div class="info">'+
        '<div class="k" style="color:var(--cyan)">'+esc(m.name)+' <span style="color:var(--muted);font-size:.7rem">.'+esc(m.ext)+'</span></div>'+
        '<div class="meta">'+(m.desc ? esc(m.desc)+' · ' : '')+'by <b>'+esc(m.author)+'</b> · '+sizeKb+' KB · ⬇ '+(m.downloads||0)+'</div></div>'+
        '<div style="display:flex;gap:4px;flex-direction:column">'+
        '<button class="cp" onclick="fmDownload(\\''+m.id+'\\',\\''+safeName+'\\',\\''+m.ext+'\\')">⬇ DOWNLOAD</button>'+
        (canDelThis ? '<button class="cp" style="border-color:rgba(255,80,80,.3);color:#ff8080" onclick="fmDelete(\\''+m.id+'\\')">🗑 HAPUS</button>' : '')+
        '</div></div>';
    }).join('');
  } catch(e){ box.innerHTML='<div style="color:var(--red);font-size:.8rem">Error: '+esc(e.message)+'</div>'; }
}

async function fmDownload(id, name, ext){
  const d = await apiCall('/?api=free/download&id='+encodeURIComponent(id)+'&token='+encodeURIComponent(TOKEN));
  if(d.error){ alert(d.error); return; }
  const bin = atob(d.file);
  const arr = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
  const blob = new Blob([arr], {type:'application/octet-stream'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name + '.' + ext; a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
  loadFreeModels();
}

async function fmDelete(id){
  if(!confirm('Hapus model ini?')) return;
  const d = await apiCall('/?api=free/delete', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ token:TOKEN, id }) });
  if(d.error){ alert(d.error); return; }
  loadFreeModels();
}

async function loadProfile(){
  if(!ME) return;
  $('pfUsername').textContent = ME.username || '—';
  $('pfRole').textContent = ME.role || '—';
  $('pfEmail').textContent = ME.email || '—';
  $('pfCreated').textContent = ME.createdAt ? new Date(ME.createdAt).toLocaleDateString('id-ID') : '—';
  $('pfPwResult').className = 'result'; $('pfPwResult').innerHTML = '';
  $('pfEmailResult').className = 'result'; $('pfEmailResult').innerHTML = '';
}

async function pfChangePassword(){
  const box = $('pfPwResult');
  const current = $('pfOldPw').value;
  const newPw = $('pfNewPw').value;
  const newPw2 = $('pfNewPw2').value;
  if(!current || !newPw){ box.className='result err'; box.innerHTML='Isi semua field'; return; }
  if(newPw !== newPw2){ box.className='result err'; box.innerHTML='Konfirmasi password tidak sama'; return; }
  if(newPw.length < 5){ box.className='result err'; box.innerHTML='Password baru minimal 5 karakter'; return; }
  box.className='result info'; box.innerHTML='<span class="spinner"></span>Menyimpan...';
  try {
    const d = await apiCall('/?api=profile/change-password', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ token:TOKEN, current, newPw })
    });
    if(d.error){ box.className='result err'; box.innerHTML=esc(d.error); return; }
    box.className='result ok'; box.innerHTML='✓ '+esc(d.message);
    $('pfOldPw').value=''; $('pfNewPw').value=''; $('pfNewPw2').value='';
  } catch(e){ box.className='result err'; box.innerHTML='Error: '+esc(e.message); }
}

async function pfChangeEmail(){
  const box = $('pfEmailResult');
  const password = $('pfEmailPw').value;
  const newEmail = $('pfNewEmail').value.trim();
  if(!password || !newEmail){ box.className='result err'; box.innerHTML='Isi semua field'; return; }
  box.className='result info'; box.innerHTML='<span class="spinner"></span>Menyimpan...';
  try {
    const d = await apiCall('/?api=profile/change-email', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ token:TOKEN, password, newEmail })
    });
    if(d.error){ box.className='result err'; box.innerHTML=esc(d.error); return; }
    box.className='result ok'; box.innerHTML='✓ '+esc(d.message);
    $('pfEmailPw').value=''; $('pfNewEmail').value='';
    if(ME) ME.email = newEmail;
    loadProfile();
  } catch(e){ box.className='result err'; box.innerHTML='Error: '+esc(e.message); }
}

document.addEventListener('DOMContentLoaded', async ()=>{
  nangLoaderSetStatus('Checking session');
  if(!TOKEN){ const ck = getCookie('nang_session'); if(ck){ TOKEN = ck; localStorage.setItem('nang_session', ck); } }

  nangLoaderSetStatus('Loading data');
  try { await checkSession(); } catch(e){}

  nangLoaderSetStatus('Preparing UI');
  _upLoadFields();

  ['upUsername','upApiKey','upName','upDesc','upGroupId'].forEach(id=>{
    $(id).addEventListener('input', _upSaveFields);
    $(id).addEventListener('change', _upSaveFields);
  });

  ['lwUser','lwPass'].forEach(id=>$(id).addEventListener('keydown',e=>{if(e.key==='Enter')lwDoLogin();}));
  ['lwRegUser','lwRegEmail','lwRegPass','lwRegPass2'].forEach(id=>$(id).addEventListener('keydown',e=>{if(e.key==='Enter')lwDoRegister();}));
  ['oPw'].forEach(id=>$(id).addEventListener('keydown',e=>{if(e.key==='Enter')doOwnerLogin();}));
  ['oGenUid'].forEach(id=>$(id).addEventListener('keydown',e=>{if(e.key==='Enter')doOwnerGen();}));
  ['mkUid'].forEach(id=>$(id).addEventListener('keydown',e=>{if(e.key==='Enter')doMyKeysGenerate();}));

  let _upUserT;
  $('upUsername').addEventListener('input',()=>{
    clearTimeout(_upUserT);
    const v=$('upUsername').value.trim();
    const h=$('upUserHint');
    if(!v){h.className='hint';h.textContent='';return;}
    h.className='hint'; h.innerHTML='<span class="spinner"></span>Mencari...';
    _upUserT=setTimeout(async()=>{
      const d=await apiCall('/?api=lookup-user',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:v})});
      if(d.ok){ h.className='hint ok'; h.textContent='✓ '+d.name+(d.displayName&&d.displayName!==d.name?' ('+d.displayName+')':'')+' · ID '+d.userId; }
      else{ h.className='hint err'; h.textContent='✗ '+(d.error||'tidak ditemukan'); }
    },500);
  });

  let _upGroupT;
  $('upGroupId').addEventListener('input',()=>{
    clearTimeout(_upGroupT);
    const v=$('upGroupId').value.trim();
    const h=$('upGroupHint');
    if(!v){h.className='hint';h.textContent='Masukkan ID grup komunitas lu';return;}
    if(!/^\d+$/.test(v)){ h.className='hint err'; h.textContent='✗ Group ID cuma angka'; return; }
    h.className='hint'; h.innerHTML='<span class="spinner"></span>Mencari grup...';
    _upGroupT=setTimeout(async()=>{
      const d=await apiCall('/?api=lookup-group',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({groupId:v})});
      if(d.ok){ h.className='hint ok'; h.textContent='✓ '+d.name+(d.owner?' (owner: '+d.owner+')':'')+' · '+d.memberCount+' member'; }
      else{ h.className='hint err'; h.textContent='✗ '+(d.error||'Grup tidak ditemukan'); }
    },500);
  });

  $('upApiKey').addEventListener('blur',async()=>{
    const k=$('upApiKey').value.trim();
    const h=$('upKeyHint');
    if(!k){h.className='hint';h.textContent='';return;}
    h.className='hint'; h.innerHTML='<span class="spinner"></span>Verifikasi...';
    const d=await apiCall('/?api=verify-apikey',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:k})});
    if(d.ok){ h.className='hint ok'; h.textContent='✓ API key valid'; }
    else { h.className='hint err'; h.textContent='✗ '+(d.error||'tidak valid'); }
  });

  checkKvStatus();
  setTimeout(nangLoaderHide, 600);
});

setTimeout(()=>{ const el = $('nangLoader'); if(el && !el.classList.contains('hide')) nangLoaderHide(); }, 3000);
</script></body></html>`;
}
