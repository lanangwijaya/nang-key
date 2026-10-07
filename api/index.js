const BUILD = "68.0";
const NANG_WEBHOOK = "https://discord.com/api/webhooks/1554789657705844819/S-AEYb2JOZy7Ixr1KotRTjy91j2ogk3U6-6ODK41Zf4AyEyAnHTIUu6mGN_etsYcYMhS";

import { createHash, randomBytes } from "node:crypto";

const _KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const _KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const _HAS_KV = !!(_KV_URL && _KV_TOKEN);

async function _kvCmd(...args) {
  if (!_HAS_KV) return null;
  try {
    const r = await fetch(_KV_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + _KV_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify([args]),
    });
    const d = await r.json();
    return d && d[0] ? d[0].result : null;
  } catch { return null; }
}

const _memStore = (global.__nangMem = global.__nangMem || {});
async function storeGet(key) {
  if (_HAS_KV) {
    const raw = await _kvCmd("GET", key);
    if (raw == null) return null;
    if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return raw; } }
    return raw;
  }
  return _memStore[key] ?? null;
}
async function storeSet(key, val) {
  const raw = typeof val === "string" ? val : JSON.stringify(val);
  if (_HAS_KV) { await _kvCmd("SET", key, raw); return true; }
  _memStore[key] = val;
  return true;
}
async function storeDel(key) {
  if (_HAS_KV) { await _kvCmd("DEL", key); return true; }
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
  if (_HAS_KV) await _kvCmd("SADD", "nang:userlist", user.username);
  return true;
}
async function listUsers() {
  if (_HAS_KV) {
    const names = (await _kvCmd("SMEMBERS", "nang:userlist")) || [];
    const out = [];
    for (const n of names) {
      const u = await storeGet("nang:user:" + String(n).toLowerCase());
      if (u) out.push(u);
    }
    return out;
  }
  return Object.values(_memStore).filter(v => v && v.username && v.passwordHash);
}

const _SECRET = "NANG2024";
const _EXPIRE_MS = 24 * 60 * 60 * 1000;
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

const LINK_PATTERNS = [
  { name: "LootLabs",     match: ["lootlabs","lootlinks","lootdest"],           auto: "low",    note: "Task-wall." },
  { name: "Platorelay",   match: ["platorelay"],                                  auto: "medium", note: "Keysystem." },
  { name: "Linkvertise",  match: ["linkvertise"],                                 auto: "high",   note: "Auto-bypass." },
  { name: "Work.ink",     match: ["work.ink","boost.ink","mboost.me"],            auto: "high",   note: "Auto-bypass." },
  { name: "Rekonise",     match: ["rekonise"],                                    auto: "high",   note: "Auto-bypass." },
  { name: "Sub2Unlock",   match: ["sub2unlock","sub2get","playrole"],             auto: "low",    note: "Manual unlock." },
  { name: "SocialWolvez", match: ["socialwolvez","cutsy"],                        auto: "low",    note: "Manual unlock." },
  { name: "Adf.ly",       match: ["adf.ly","adfoc"],                              auto: "high",   note: "Auto-bypass." },
  { name: "GPLinks",      match: ["gplinks","gplink","tnlink","tnshort"],         auto: "high",   note: "Auto-bypass." },
  { name: "ShrinkMe",     match: ["shrinkme","shrinkearn","shrinkforearn"],       auto: "high",   note: "Auto-bypass." },
  { name: "Ouo.io",       match: ["ouo.io","exe.io","fc.lc","ez4short"],          auto: "high",   note: "Auto-bypass." },
  { name: "Shortener",    match: ["shorte.st","bc.vc","cutt.ly","tii.ai","linkpoi","clk.sh","clicksfly","droplink","yoshort","spaste","za.gl","za.gd","try2link","kyshort","zshort","gtlink","omg10","weboasi","link1s","linkshortify","arolinks","ez4mod","atglinks","indlink","pndk","ldo.tn","mightytr.ee","urlshort","shortlink"], auto: "high", note: "Auto-bypass." },
];

function detectLink(url) {
  if (!url || typeof url !== "string") return null;
  const low = url.toLowerCase();
  for (const p of LINK_PATTERNS) {
    if (p.match.some(m => low.includes(m))) return { type: p.name, auto: p.auto, note: p.note };
  }
  if (/^https?:\/\//.test(url)) {
    try { const h = new URL(url).hostname; return { type: "Unknown (" + h + ")", auto: "medium", note: "Coba auto-bypass." }; } catch {}
  }
  return { type: "Invalid", auto: "none", note: "URL tidak valid." };
}

const CDN_HOSTS = [
  "jsdelivr.net","unpkg.com","cdnjs.cloudflare.com","gstatic.com","googleapis.com",
  "googletagmanager.com","google-analytics.com","doubleclick.net","cloudflare.com",
  "cloudflareinsights.com","bootstrapcdn.com","fontawesome.com","jquery.com",
  "reactjs.org","schema.org","w3.org","momentjs.com","tailwindcss.com","sentry.io",
  "hotjar.com","segment.io","mixpanel.com","stripe.com","paypal.com",
  "fonts.gstatic.com","code.jquery.com","stackpath.bootstrapcdn.com",
  "raw.githack.com","gitcdn.link","statically.io","esm.sh","skypack.dev",
  "cdn.skypack.dev","esm.run","bundle.run","cdn.esm.sh",
  "bauval.org","adfoc.us","adf.ly","short.economy","link4rev",
];
const CDN_PATH_HINTS = ["/npm/","/node_modules/","/dist/","/vendor/","/build/","/assets/","/static/","/chunks/","/chunk-","/runtime.","/polyfill","/polyfills/","/bundle.","/bundle/","/lib/","/umd/","/esm/","/cjs/"];
const BAD_EXT = /\.(js|mjs|cjs|css|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|otf|mp4|webm|mp3|wav|ogg|pdf|zip|rar|7z|tar|gz|wasm|json|xml|txt|md|yml|yaml|toml|lock)(\?|#|$)/i;
const VERSION_MARKER = /@[0-9]+\.[0-9]+/;

function hardReject(u) {
  if (!u || typeof u !== "string") return "empty";
  const low = u.toLowerCase();
  if (!/^https?:\/\//.test(u)) return "no-scheme";
  for (const h of CDN_HOSTS) if (low.includes(h)) return "cdn:" + h;
  for (const p of CDN_PATH_HINTS) if (low.includes(p)) return "path:" + p;
  if (BAD_EXT.test(low)) return "ext";
  if (VERSION_MARKER.test(low)) return "ver";
  try {
    const p = new URL(u);
    const segs = p.pathname.split("/").filter(Boolean);
    if (segs.length === 0 || p.pathname === "/") return "nopath";
  } catch { return "parse"; }
  return null;
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
  const BROWSERLESS_TOKEN = "2VO67VgLJTXNszJ47508df1abfc96345f97d220136688f6d6";
  const BROWSERLESS_URL = "https://production-sfo.browserless.io/function";
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

  if (path.startsWith("/api/")) {
    return await handleApi(req, res, path, method, params, { ADMIN_PW, AUTH_DOMAIN });
  }
  if (path === "/reseller" || path === "/reseller/") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(resellerPage());
    return;
  }

  if (method === "POST") {
    let body = "";
    await new Promise(r => { req.on("data", c => body += c); req.on("end", r); });

    if (path === "/rbxl" || path === "/rbxl/") {
      try {
        function parseRbxlx(xml) {
          function parseValue(typeTag, content) {
            const t = typeTag.toLowerCase();
            if (t === "string" || t === "protectedstring") return content.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
            if (t === "bool") return content.trim() === "true";
            if (t === "int" || t === "int64") return parseInt(content.trim()) || 0;
            if (t === "float" || t === "double") return parseFloat(content.trim()) || 0;
            return content.trim();
          }
          function parseItem(itemXml) {
            const classMatch = itemXml.match(/class="([^"]+)"/);
            if (!classMatch) return null;
            const props = {};
            const propsMatch = itemXml.match(/<Properties>([\s\S]*?)<\/Properties>/);
            if (propsMatch) {
              const propRe = /<(\w+)\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g;
              let m;
              while ((m = propRe.exec(propsMatch[1])) !== null) {
                const val = parseValue(m[1], m[3]);
                if (val !== null && val !== undefined) props[m[2]] = val;
              }
            }
            const children = [];
            const childRe = /<Item class="[^"]*"[\s\S]*?<\/Item>/g;
            const withoutProps = itemXml.replace(/<Properties>[\s\S]*?<\/Properties>/, "");
            let cm;
            while ((cm = childRe.exec(withoutProps)) !== null) {
              const child = parseItem(cm[0]);
              if (child) children.push(child);
            }
            return { class: classMatch[1], properties: props, children };
          }
          const items = [];
          const topRe = /<Item class="[^"]*"[\s\S]*?<\/Item>/g;
          const inner = xml.replace(/<roblox[^>]*>/, "").replace(/<\/roblox>/, "");
          let m;
          while ((m = topRe.exec(inner)) !== null) {
            const item = parseItem(m[0]);
            if (item) items.push(item);
          }
          return items;
        }
        const items = parseRbxlx(body);
        res.status(200).json({ ok: true, count: items.length, items });
        return;
      } catch (e) { res.status(200).json({ ok: false, error: String(e.message || e) }); return; }
    }

    let parsed;
    try { parsed = JSON.parse(body); } catch { res.status(400).json({ valid: false, error: "bad json" }); return; }

    if (parsed.action === "generate") {
      if (parsed.pw !== ADMIN_PW) {
        sendWebhook([
          { name: "Event", value: "Admin login GAGAL", inline: false },
          { name: "IP", value: _getClientIP(req), inline: true },
        ]);
        res.status(200).json({ error: "password salah" }); return;
      }
      const uid = String(parsed.uid || "").trim();
      if (!uid) { res.status(200).json({ error: "uid kosong" }); return; }
      const key = _makeKey(uid);
      const name = await _getRobloxUser(uid);
      sendWebhook([
        { name: "Event", value: "Key Generated", inline: false },
        { name: "Username", value: String(name || "Unknown"), inline: true },
        { name: "User ID", value: uid, inline: true },
        { name: "Key", value: key, inline: false },
        { name: "Expires", value: _expiryStr(uid, key), inline: true },
        { name: "IP", value: _getClientIP(req), inline: true },
      ]);
      res.status(200).json({ ok: true, uid, key, expires: _expiryStr(uid, key), username: name, authLink: makeAuthLink(uid, key, name) });
      return;
    }

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
    sendWebhook([
      { name: "Event", value: valid ? "Auth Page (Valid)" : "Auth Page (Expired)", inline: false },
      { name: "Username", value: String(name || "Unknown"), inline: true },
      { name: "User ID", value: String(data.u), inline: true },
      { name: "IP", value: _getClientIP(req), inline: true },
    ]);
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

  if (params.has("detect")) { res.status(200).json({ detection: detectLink(params.get("detect")) }); return; }

  if (params.has("testurl")) {
    const u = params.get("testurl");
    const reason = hardReject(u);
    res.status(200).json({ url: u, rejected: !!reason, reason: reason || "ok" });
    return;
  }

  if (params.has("chat")) {
    const action = params.get("chat");
    global.__nangChat = global.__nangChat || [];
    const now = Date.now();
    global.__nangChat = global.__nangChat.filter(m => now - m.ts < 3600000);

    if (action === "send") {
      const user = String(params.get("user") || "anon").slice(0, 32);
      const uid = String(params.get("uid") || "").slice(0, 20);
      const text = String(params.get("text") || "").slice(0, 300);
      if (!text) { res.status(200).json({ ok: false, error: "empty" }); return; }
      const msg = { user, uid, text, ts: now };
      global.__nangChat.push(msg);
      if (global.__nangChat.length > 100) global.__nangChat = global.__nangChat.slice(-100);
      res.status(200).json({ ok: true, msg });
      return;
    }

    if (action === "get") {
      const since = parseInt(params.get("since") || "0", 10);
      const msgs = global.__nangChat.filter(m => m.ts > since);
      res.status(200).json({ ok: true, msgs, total: global.__nangChat.length });
      return;
    }

    res.status(200).json({ ok: false, error: "unknown action" });
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

  if (params.has("bypass")) {
    const link = params.get("bypass");
    if (!link) { res.status(200).json({ error: "no link" }); return; }

    const detection = detectLink(link);
    const low = link.toLowerCase();
    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
    const ACCEPT = "application/json, text/plain, */*";

    const wrappedTokens = ["lootlabs","lootlinks","lootdest","platorelay","linkvertise","work.ink","sub2unlock","sub2get","playrole","boost.ink","socialwolvez","cutsy","mboost.me","rekonise","adfoc","adf.ly","adfoc.us","shrinkme","shrinkearn","ouo.io","exe.io","fc.lc","ez4short","shorte.st","bc.vc","cutt.ly","tii.ai","linkpoi","bauval.org","gplinks","gplink","tnlink","tnshort","mdiskshortner","indianshortner","urlshort","shortlink","clk.sh","clicksfly","mightytr.ee","droplink","yoshort","spaste","za.gl","za.gd","shrinkforearn","try2link","kyshort","zshort","gtlink","omg10","weboasi","link1s","linkshortify","arolinks","ez4mod","atglinks","indlink","pndk","ldo.tn"];
    const socialTokens = ["instagram.com","youtube.com","youtu.be","tiktok.com","twitter.com","x.com","facebook.com","fb.com","fb.watch","discord.gg","discord.com","snapchat.com","whatsapp.com","wa.me","telegram","t.me","twitch.tv","reddit.com","pinterest.com","linkedin.com","threads.net"];
    const isWrapped = (u) => typeof u === "string" && wrappedTokens.some(s => u.toLowerCase().includes(s));
    const isSocial  = (u) => typeof u === "string" && socialTokens.some(s => u.toLowerCase().includes(s));
    const isCleanUrl = (u) => u && typeof u === "string" && /^https?:\/\//.test(u) && !isWrapped(u) && !isSocial(u) && !hardReject(u);

    const tryFetch = async (u, opts = {}, ms = 7000) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), ms);
      try { const r = await fetch(u, { ...opts, signal: ctrl.signal }); clearTimeout(t); return r; }
      catch (e) { clearTimeout(t); throw e; }
    };

    const readJson = async (r) => {
      const ct = r.headers.get("content-type") || "";
      try {
        if (ct.includes("json")) return await r.json();
        const txt = await r.text();
        try { return JSON.parse(txt); } catch { return null; }
      } catch { return null; }
    };

    const extract = (d) => {
      if (!d) return null;
      if (typeof d === "string") { const m = d.match(/https?:\/\/[^\s"'<>)]+/); return m ? m[0] : null; }
      if (typeof d !== "object") return null;
      const keys = ["result","destination","url","bypassed","bypassed_url","final","target","data","link","out","redirect","location"];
      for (const k of keys) {
        const v = d[k];
        if (typeof v === "string" && /^https?:\/\//.test(v)) return v;
        if (v && typeof v === "object") {
          for (const k2 of keys) {
            const v2 = v[k2];
            if (typeof v2 === "string" && /^https?:\/\//.test(v2)) return v2;
          }
        }
      }
      return null;
    };

    const sendOk = (result, source) => {
      if (isCleanUrl(result)) {
        sendWebhook([
          { name: "Event", value: "Bypass Success", inline: false },
          { name: "Shortlink", value: link.slice(0, 100), inline: false },
          { name: "Result", value: result.slice(0, 200), inline: false },
          { name: "Source", value: source, inline: true },
          { name: "IP", value: _getClientIP(req), inline: true },
        ]);
        res.status(200).json({ result, source, detection });
        return true;
      }
      return false;
    };

    const isLootLink    = low.includes("lootlabs") || low.includes("lootlinks") || low.includes("lootdest");
    const isLinkvertise = low.includes("linkvertise") || low.includes("work.ink") || low.includes("boost.ink") || low.includes("mboost.me");
    const isRekonise    = low.includes("rekonise") || low.includes("socialwolvez") || low.includes("cutsy");
    const isPlatorelay  = low.includes("platorelay");

    if (!isPlatorelay) {
      const q = encodeURIComponent(link);
      const tasks = [];
      const inputHost = (() => { try { return new URL(link).hostname.toLowerCase(); } catch { return ""; } })();
      const isCleanStrict = (u) => {
        if (!isCleanUrl(u)) return false;
        try {
          const h = new URL(u).hostname.toLowerCase();
          if (h === inputHost) return false;
          for (const w of wrappedTokens) if (h.includes(w)) return false;
        } catch { return false; }
        return true;
      };

      tasks.push((async () => {
        const r = await tryFetch("https://api.bypass.vip/", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA, "Accept": ACCEPT, "Origin": "https://bypass.vip", "Referer": "https://bypass.vip/" },
          body: "url=" + q,
        }, 5000);
        if (!r.ok) throw 0;
        const res = extract(await readJson(r));
        if (!isCleanStrict(res)) throw 0;
        return { result: res, source: "bypass.vip" };
      })());

      tasks.push((async () => {
        const r = await tryFetch("https://api.bypass.city/api/bypass", {
          method: "POST",
          headers: { "Content-Type": "application/json", "User-Agent": UA, "Accept": ACCEPT, "Origin": "https://bypass.city", "Referer": "https://bypass.city/" },
          body: JSON.stringify({ url: link }),
        }, 5000);
        if (!r.ok) throw 0;
        const res = extract(await readJson(r));
        if (!isCleanStrict(res)) throw 0;
        return { result: res, source: "bypass.city" };
      })());

      const getProviders = [
        ["https://rip.linkvertise.lol/api/bypass?url=" + q, "rip-lv"],
        ["https://api.linkvertise.lol/bypass?url=" + q, "lv-lol"],
        ["https://api.bypassall.lol/bypass?url=" + q, "bypassall"],
        ["https://bypass.bot.nu/bypass?url=" + q, "bypass.bot"],
        ["https://linklm.com/api/bypass?url=" + q, "linklm"],
        ["https://api.bypass-unlocked.workers.dev/?url=" + q, "unlocked"],
        ["https://bypass.tools/api/bypass?url=" + q, "bypass.tools"],
        ["https://bypass.pm/api/bypass?url=" + q, "bypass.pm"],
        ["https://api.bypasser.workers.dev/bypass?url=" + q, "bypasser-1"],
        ["https://api.bypass.pro/bypass?url=" + q, "bypass.pro"],
        ["https://api.bypass.tf/api/bypass?url=" + q, "bypass.tf"],
        ["https://bypass.link/api/bypass?url=" + q, "bypass.link"],
        ["https://api.bypass.lol/bypass?url=" + q, "bypass.lol"],
        ["https://api.bypass.workers.dev/bypass?url=" + q, "bypass-workers"],
        ["https://api.linkvertise-bypass.com/bypass?url=" + q, "lv-bypass"],
        ["https://api.shortlink-bypass.com/bypass?url=" + q, "shortlink-bypass"],
        ["https://api.bypasser.io/bypass?url=" + q, "bypasser-io"],
        ["https://api.bypass-v2.workers.dev/bypass?url=" + q, "bypass-v2"],
        ["https://bypass.nezuko.workers.dev/?url=" + q, "nezuko"],
        ["https://api.bypass-gate.workers.dev/?url=" + q, "bypass-gate"],
        ["https://api.bypass.rip/bypass?url=" + q, "bypass.rip"],
        ["https://api.link-bypass.com/bypass?url=" + q, "link-bypass"],
        ["https://api.free-bypass.workers.dev/?url=" + q, "free-bypass"],
        ["https://api.bypass.rev/bypass?url=" + q, "bypass.rev"],
        ["https://api.bypass-my-links.workers.dev/?url=" + q, "bypass-my-links"],
        ["https://bypass.api.mrfrank.workers.dev/?url=" + q, "mrfrank"],
        ["https://bypass.justnobody.workers.dev/?url=" + q, "justnobody"],
      ];

      for (const [u, tag] of getProviders) {
        tasks.push((async () => {
          const r = await tryFetch(u, { method: "GET", headers: { "User-Agent": UA, "Accept": ACCEPT } }, 4500);
          if (!r.ok) throw 0;
          const res = extract(await readJson(r));
          if (!isCleanStrict(res)) throw 0;
          return { result: res, source: tag };
        })());
      }

      if (isLinkvertise) {
        const lvId = link.match(/linkvertise\.com\/(\d+)/i)?.[1];
        if (lvId) {
          tasks.push((async () => {
            const r = await tryFetch("https://publisher.linkvertise.com/api/v1/redirect/link/static/" + lvId, {
              headers: { "User-Agent": UA, "Accept": ACCEPT, "Origin": "https://linkvertise.com" },
            }, 4000);
            if (!r.ok) throw 0;
            const d = await readJson(r);
            const target = d?.data?.link?.target;
            if (!target || !isCleanStrict(target)) throw 0;
            return { result: target, source: "linkvertise-static" };
          })());
        }
      }

      if (isRekonise) {
        const slug = link.match(/rekonise\.com\/([a-z0-9]+)/i)?.[1];
        if (slug) {
          tasks.push((async () => {
            const r = await tryFetch("https://api.rekonise.com/socialunlocks/" + slug, { headers: { "User-Agent": UA, "Accept": ACCEPT } }, 4000);
            if (!r.ok) throw 0;
            const res = extract(await readJson(r));
            if (!isCleanStrict(res)) throw 0;
            return { result: res, source: "rekonise-api" };
          })());
        }
      }

      const consensus = await new Promise((resolve) => {
        const votes = {};
        let firstValid = null;
        let settledCount = 0;
        let done = false;
        const totalTasks = tasks.length;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(cap);
          const ranked = Object.values(votes).sort((a, b) => b.sources.length - a.sources.length);
          if (ranked.length > 0) resolve({ url: ranked[0].url, sources: ranked[0].sources });
          else if (firstValid) resolve({ url: firstValid.result, sources: [firstValid.source] });
          else resolve(null);
        };
        const cap = setTimeout(finish, 6000);
        for (const p of tasks) {
          p.then((r) => {
            settledCount++;
            if (r && r.result) {
              const key = r.result.replace(/\/$/, "").toLowerCase();
              if (!votes[key]) votes[key] = { url: r.result, sources: [] };
              votes[key].sources.push(r.source);
              if (!firstValid) firstValid = r;
              if (votes[key].sources.length >= 2) { finish(); return; }
            }
            if (settledCount >= totalTasks) finish();
          }).catch(() => {
            settledCount++;
            if (settledCount >= totalTasks) finish();
          });
        }
        if (totalTasks === 0) finish();
      });

      if (consensus && consensus.url) {
        if (sendOk(consensus.url, consensus.sources.join("+"))) return;
      }
    }

    if (BROWSERLESS_TOKEN && (isLootLink || isPlatorelay)) {
      const runScript = `
        export default async function ({ page, context }) {
          const startUrl = context.url;
          const wrapped = ${JSON.stringify(wrappedTokens)};
          const social  = ${JSON.stringify(socialTokens)};
          const cdnHosts = ${JSON.stringify(CDN_HOSTS)};
          const badExt = /\\.(js|mjs|cjs|css|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|otf|mp4|webm|mp3|pdf|zip|wasm|json|xml)(\\?|#|$)/i;
          function reject(u) {
            if (!u || !/^https?:\\/\\//.test(u)) return true;
            const L = u.toLowerCase();
            for (const h of cdnHosts) if (L.includes(h)) return true;
            if (badExt.test(L)) return true;
            for (const w of wrapped) if (L.includes(w)) return true;
            for (const s of social) if (L.includes(s)) return true;
            return false;
          }
          function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
          const leaked = new Set();
          const popups = [];
          const apiCalls = [];
          let destinationFromApi = null;
          const KEY_RE = /\\b(FREE_[A-Fa-f0-9]{16,}|NANG_[A-Za-z0-9]{16,}|[A-Z][A-Z0-9]{1,8}_[A-Za-z0-9]{16,})\\b/;
          function harvest(t) {
            if (!t) return;
            const re = /https?:\\/\\/[^"'\\s<>)]+/gi;
            let m;
            while ((m = re.exec(t)) !== null) if (!reject(m[0])) leaked.add(m[0]);
          }
          async function tryScrapeKey(pg) {
            try {
              const html = await pg.content();
              const m = html.match(KEY_RE);
              if (m) return m[1];
              const txt = await pg.evaluate(() => document.body.innerText || "");
              const m2 = txt.match(KEY_RE);
              if (m2) return m2[1];
            } catch {}
            return null;
          }
          await page.addInitScript(() => {
            window.__nangApi = [];
            const origFetch = window.fetch;
            window.fetch = async function(...args) {
              const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url);
              const opts = args[1] || {};
              try {
                const r = await origFetch.apply(this, args);
                const clone = r.clone();
                const text = await clone.text().catch(()=>"");
                window.__nangApi.push({ method: opts.method || "GET", url, body: opts.body, resp: text.slice(0, 2000), ts: Date.now() });
                return r;
              } catch (e) {
                window.__nangApi.push({ method: opts.method || "GET", url, body: opts.body, err: String(e), ts: Date.now() });
                throw e;
              }
            };
            const origOpen = XMLHttpRequest.prototype.open;
            const origSend = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.open = function(method, url, ...rest) {
              this.__nangMethod = method; this.__nangUrl = url;
              return origOpen.apply(this, [method, url, ...rest]);
            };
            XMLHttpRequest.prototype.send = function(body) {
              const self = this;
              this.addEventListener("load", function() {
                try {
                  window.__nangApi.push({ method: self.__nangMethod, url: self.__nangUrl, body, resp: String(self.responseText || "").slice(0, 2000), ts: Date.now() });
                } catch {}
              });
              return origSend.apply(this, [body]);
            };
          });
          try {
            await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");
            await page.setViewport({ width: 1366, height: 900 });
            await page.setRequestInterception(true);
            page.on("request", r => {
              const u = r.url().toLowerCase();
              if (["google-analytics","googletagmanager","doubleclick","googlesyndication","adsbygoogle","hotjar","facebook.com","twitter.com","tiktok.com"].some(p => u.includes(p))) { r.abort(); return; }
              r.continue();
            });
            const ctx = page.browserContext ? page.browserContext() : page.context();
            if (ctx && ctx.on) {
              ctx.on("page", async (p) => {
                try { await p.addInitScript(() => { window.__nangApi = window.__nangApi || []; }).catch(()=>{}); popups.push(p); } catch {}
              });
            }
            page.on("dialog", async (d) => { try { await d.dismiss(); } catch {} });
            await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 6000 });
            await sleep(1200);
            await page.evaluate(() => {
              try {
                const o = window.setTimeout;
                window.setTimeout = (fn, d, ...a) => o(fn, Math.min(d || 0, 30), ...a);
                window.setInterval = (fn, d, ...a) => o(fn, Math.min(d || 0, 30), ...a);
              } catch {}
            });
            const initKey = await tryScrapeKey(page);
            if (initKey) return { key: initKey, url: page.url(), status: "key-found" };
            for (let r = 0; r < 10; r++) {
              const c = await page.evaluate(() => {
                const all = [...document.querySelectorAll("button, a, [role='button'], input[type='submit']")];
                const prio = ["continue", "lanjut", "next", "proceed", "click here", "klik", "claim", "get link", "unlock", "verify", "start", "open", "get reward", "reward"];
                for (const el of all) {
                  const t = (el.textContent || el.value || "").toLowerCase().trim();
                  if (!t || t.length > 100) continue;
                  if (prio.some(p => t === p || t.startsWith(p))) {
                    try { el.scrollIntoView({block:'center'}); el.click(); return 1; } catch {}
                  }
                }
                return 0;
              });
              if (!c) { await sleep(700); }
              await sleep(900);
              const keyNow = await tryScrapeKey(page);
              if (keyNow) return { key: keyNow, url: page.url(), status: "key-found" };
              try { const html = await page.content(); harvest(html); } catch {}
              const mainApis = await page.evaluate(() => window.__nangApi || []).catch(()=>[]);
              for (const a of mainApis) {
                if (!a || !a.url) continue;
                const u = a.url.toLowerCase();
                if (/verify|complete|callback|claim|destination|resolve|unlock|task/i.test(u)) {
                  apiCalls.push({ ...a, from: "main" });
                  if (a.resp) {
                    try {
                      const j = JSON.parse(a.resp);
                      const dest = j.destination || j.url || j.target || j.result || j.link || j.redirect;
                      if (dest && /^https?:\\/\\//.test(dest) && !reject(dest)) destinationFromApi = dest;
                    } catch {
                      const m = a.resp.match(/https?:\\/\\/[^"'\\s<>)]+/);
                      if (m && !reject(m[0])) destinationFromApi = m[0];
                    }
                  }
                }
              }
              const keyMid = await tryScrapeKey(page);
              if (keyMid) return { key: keyMid, url: page.url(), status: "key-found" };
              if (destinationFromApi) return { url: destinationFromApi, status: "api-intercept" };
              if (leaked.size > 0) for (const u of leaked) return { url: u, status: "leak" };
              const cur = page.url();
              if (!reject(cur)) {
                const ck = await tryScrapeKey(page);
                if (ck) return { key: ck, url: cur, status: "key-found" };
                return { url: cur, status: "resolved" };
              }
            }
            const finalKey = await tryScrapeKey(page);
            if (finalKey) return { key: finalKey, url: page.url(), status: "key-found" };
            return { url: startUrl, status: "wrapped" };
          } catch (e) {
            return { url: startUrl, status: "err", error: String(e.message || e) };
          }
        }
      `;

      try {
        const r = await tryFetch(BROWSERLESS_URL + "?token=" + BROWSERLESS_TOKEN + "&timeout=9000&stealth=true", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: runScript, context: { url: link } }),
        }, 9500);
        if (r && r.ok) {
          const d = await readJson(r);
          if (d && d.key) {
            sendWebhook([
              { name: "Event", value: "Key Scraped", inline: false },
              { name: "Shortlink", value: link.slice(0, 100), inline: false },
              { name: "Key", value: d.key, inline: false },
              { name: "IP", value: _getClientIP(req), inline: true },
            ]);
            res.status(200).json({ result: d.key, key: d.key, source: "key-scrape", detection });
            return;
          }
          if (d && isCleanUrl(d.url)) {
            if (sendOk(d.url, "browserless-" + (d.status || "?"))) return;
          }
        }
      } catch (e) { console.error("Browserless:", e.message); }
    }

    try {
      const r = await tryFetch(link, { method: "HEAD", redirect: "manual", headers: { "User-Agent": UA } }, 3000);
      const loc = r.headers.get("location");
      if (loc && /^https?:\/\//.test(loc) && loc !== link && isCleanUrl(loc)) {
        if (sendOk(loc, "redirect")) return;
      }
    } catch {}

    let warning = "Bypass gagal semua layer.";
    if (detection && detection.auto === "low") warning = detection.type + " pakai dinding follow/task manual.";
    else warning = "Provider publik kadang down. Coba lagi 1-2 menit.";
    sendWebhook([
      { name: "Event", value: "Bypass Failed", inline: false },
      { name: "Shortlink", value: link.slice(0, 100), inline: false },
      { name: "Type", value: detection ? detection.type : "Unknown", inline: true },
      { name: "IP", value: _getClientIP(req), inline: true },
    ]);
    res.status(200).json({ result: link, source: "original", detection, warning });
    return;
  }

  if (method === "GET" && path === "/") {
    const ua = String(req.headers["user-agent"] || "").slice(0, 120);
    if (!ua.includes("Mozilla")) {
      sendWebhook([
        { name: "Event", value: "Web Visit", inline: false },
        { name: "IP", value: _getClientIP(req), inline: true },
        { name: "UA", value: ua, inline: false },
      ]);
    }
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(mainPage(WA_NUMBER));
}

// ═══════════════════════════════════════
// API HANDLER (reseller + uploader)
// ═══════════════════════════════════════
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
  async function requireOwner() {
    const pw = (body && body.pw) || params.get("pw");
    if (pw === ADMIN_PW) return { username: "OWNER", role: "owner" };
    const u = await authFromToken();
    if (u && u.role === "owner") return u;
    return null;
  }

  // ═══ UPLOADER API ═══
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

  // ═══ RESELLER API ═══
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
      role: "pending", quota: 20, keysToday: 0, lastReset: Date.now(),
      createdAt: Date.now(), keys: [],
    };
    await saveUser(user);
    await storeSet(emailKey, username);

    sendWebhook([
      { name: "Event", value: "Reseller Registered", inline: false },
      { name: "Username", value: username, inline: true },
      { name: "Email", value: email, inline: true },
      { name: "Status", value: "pending", inline: true },
      { name: "IP", value: _getClientIP(req), inline: true },
    ]);
    return res.status(200).json({ ok: true, message: "Terdaftar. Tunggu approve owner." });
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
    await storeSet("nang:sess:" + token, { username: user.username, expiresAt: Date.now() + 7 * 24 * 3600 * 1000 });
    sendWebhook([
      { name: "Event", value: "Reseller Login", inline: false },
      { name: "Username", value: user.username, inline: true },
      { name: "Role", value: user.role, inline: true },
      { name: "IP", value: _getClientIP(req), inline: true },
    ]);
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
    if (token) await storeDel("nang:sess:" + token);
    return res.status(200).json({ ok: true });
  }

  if (route === "reseller/generate" && method === "POST") {
    const u = await authFromToken();
    if (!u) return res.status(200).json({ error: "not logged in" });
    if (u.role !== "reseller" && u.role !== "admin" && u.role !== "owner") {
      return res.status(200).json({ error: "Akun belum di-approve owner" });
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
      { name: "Event", value: "Key Generated (Reseller)", inline: false },
      { name: "Reseller", value: u.username, inline: true },
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

  if (route === "owner/users") {
    const o = await requireOwner();
    if (!o) return res.status(200).json({ error: "forbidden" });
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
    const o = await requireOwner();
    if (!o) return res.status(200).json({ error: "forbidden" });
    const target = String((body && body.username) || "").trim();
    const role = String((body && body.role) || "");
    if (!["pending", "reseller", "admin", "owner", "banned"].includes(role)) {
      return res.status(200).json({ error: "role invalid" });
    }
    const u = await getUser(target);
    if (!u) return res.status(200).json({ error: "user tidak ditemukan" });
    u.role = role;
    await saveUser(u);
    sendWebhook([
      { name: "Event", value: "Role Changed", inline: false },
      { name: "Target", value: u.username, inline: true },
      { name: "New Role", value: role, inline: true },
      { name: "By", value: o.username, inline: true },
    ]);
    return res.status(200).json({ ok: true });
  }

  if (route === "owner/setquota" && method === "POST") {
    const o = await requireOwner();
    if (!o) return res.status(200).json({ error: "forbidden" });
    const target = String((body && body.username) || "").trim();
    const quota = Math.max(0, Math.min(9999, parseInt(body && body.quota) || 0));
    const u = await getUser(target);
    if (!u) return res.status(200).json({ error: "user tidak ditemukan" });
    u.quota = quota;
    await saveUser(u);
    return res.status(200).json({ ok: true });
  }

  if (route === "owner/delete" && method === "POST") {
    const o = await requireOwner();
    if (!o) return res.status(200).json({ error: "forbidden" });
    const target = String((body && body.username) || "").trim();
    const u = await getUser(target);
    if (u && u.email) await storeDel("nang:email:" + u.email.toLowerCase());
    await storeDel("nang:user:" + target.toLowerCase());
    if (_HAS_KV) await _kvCmd("SREM", "nang:userlist", target);
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
body{background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:24px 16px}
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
.tags{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px}
.tag{background:rgba(0,212,255,0.08);color:var(--cyan);font-size:0.68rem;font-weight:600;padding:3px 9px;border-radius:20px;border:1px solid rgba(0,212,255,0.2)}
.user-card{display:flex;align-items:center;gap:10px;background:var(--bg3);border:1px solid rgba(0,232,122,0.2);border-radius:10px;padding:10px;margin-top:10px}
.user-avatar{width:36px;height:36px;border-radius:8px;background:linear-gradient(135deg,var(--pink),var(--purple));display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1rem;color:#fff}
.user-info{flex:1}
.user-name{font-weight:700;font-size:0.9rem;color:var(--text)}
.user-id{font-size:0.72rem;color:var(--muted)}
.spinner{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.1);border-top-color:var(--pink);border-radius:50%;animation:spin .6s linear infinite;vertical-align:middle;margin-right:6px}
@keyframes spin{to{transform:rotate(360deg)}}
.detect{display:none;margin-top:-4px;margin-bottom:10px;padding:8px 12px;border-radius:9px;font-size:0.75rem;line-height:1.5;align-items:flex-start;gap:8px}
.detect.show{display:flex}
.detect .d-badge{font-weight:700;padding:2px 8px;border-radius:6px;font-size:0.68rem;white-space:nowrap;flex-shrink:0}
.detect .d-text{flex:1}
.detect.high{background:rgba(0,232,122,0.06);border:1px solid rgba(0,232,122,0.25);color:var(--text)}
.detect.high .d-badge{background:rgba(0,232,122,0.15);color:var(--green)}
.detect.medium{background:rgba(0,212,255,0.06);border:1px solid rgba(0,212,255,0.25);color:var(--text)}
.detect.medium .d-badge{background:rgba(0,212,255,0.15);color:var(--cyan)}
.detect.low{background:rgba(255,200,50,0.06);border:1px solid rgba(255,200,50,0.25);color:var(--text)}
.detect.low .d-badge{background:rgba(255,200,50,0.15);color:var(--yellow)}
.detect.none{background:rgba(255,80,80,0.06);border:1px solid rgba(255,80,80,0.25);color:var(--text)}
.detect.none .d-badge{background:rgba(255,80,80,0.15);color:var(--red)}
.drop{border:2px dashed var(--border);border-radius:12px;padding:24px 16px;text-align:center;cursor:pointer;transition:all .2s;background:var(--bg3);margin-bottom:12px}
.drop:hover,.drop.over{border-color:var(--pink);background:rgba(224,60,138,0.05)}
.drop.done{border-color:var(--green);background:rgba(0,232,122,0.05)}
.drop-icon{font-size:1.8rem;margin-bottom:6px;opacity:.6}
.drop-text{font-size:0.85rem;color:var(--text);margin-bottom:4px}
.drop-hint{font-size:0.7rem;color:var(--muted)}
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
.role-tag.pending{background:rgba(255,200,50,.15);color:var(--yellow)}
.role-tag.banned{background:rgba(255,80,80,.15);color:var(--red)}
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.75);display:none;align-items:center;justify-content:center;z-index:100;padding:20px}
.modal-bg.show{display:flex}
.modal-box{background:var(--bg2);border:1px solid var(--pink);border-radius:16px;padding:24px;max-width:400px;width:100%;position:relative;max-height:90vh;overflow-y:auto}
.modal-box h3{color:var(--pink);font-size:1rem;margin-bottom:14px}
.modal-box .x{position:absolute;top:12px;right:16px;cursor:pointer;color:var(--muted);font-size:22px;line-height:1}
.modal-tabs{display:flex;gap:4px;background:var(--bg3);border-radius:9px;padding:3px;margin-bottom:14px}
.modal-tabs button{flex:1;padding:8px;border:none;border-radius:7px;background:transparent;color:var(--muted);font-family:inherit;font-weight:600;font-size:.8rem;cursor:pointer}
.modal-tabs button.on{background:linear-gradient(135deg,rgba(224,60,138,.2),rgba(155,77,224,.2));color:#fff}
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
</style></head><body>

<div class="auth-bar" id="authBar">
  <button class="auth-btn" onclick="openAuthModal()">Login</button>
</div>

<div class="modal-bg" id="authModal">
  <div class="modal-box">
    <span class="x" onclick="closeAuthModal()">&times;</span>
    <div class="modal-tabs">
      <button id="mtLogin" class="on" onclick="switchAuthTab(0)">Masuk</button>
      <button id="mtRegister" onclick="switchAuthTab(1)">Daftar</button>
    </div>
    <div id="authFormLogin">
      <input class="inp" id="aLoginUser" placeholder="Username atau Email" autocomplete="username">
      <input class="inp" id="aLoginPass" type="password" placeholder="Password" autocomplete="current-password">
      <button class="btn-main" onclick="doAuthLogin()">Masuk</button>
      <div class="result" id="aLoginResult"></div>
    </div>
    <div id="authFormRegister" class="hidden">
      <input class="inp" id="aRegUser" placeholder="Username (huruf/angka/_)" autocomplete="username">
      <input class="inp" id="aRegEmail" type="email" placeholder="Email aktif" autocomplete="email">
      <input class="inp" id="aRegPass" type="password" placeholder="Password min 5 karakter" autocomplete="new-password">
      <input class="inp" id="aRegPass2" type="password" placeholder="Konfirmasi password" autocomplete="new-password">
      <button class="btn-main" onclick="doAuthRegister()">Daftar</button>
      <div class="result" id="aRegResult"></div>
      <div style="font-size:.7rem;color:var(--muted);margin-top:8px;text-align:center">Setelah daftar, tunggu owner approve jadi reseller.</div>
    </div>
  </div>
</div>

<div class="hero"><div class="logo">NANG<span class="logo-badge">KEY</span></div><div class="sub">Roblox Script Key System</div></div>
<div class="nav">
  <button class="nav-btn active" onclick="switchTab(0)">Beli Key</button>
  <button class="nav-btn" onclick="switchTab(1)">Bypass</button>
  <button class="nav-btn" onclick="switchTab(2)">Convert</button>
  <button class="nav-btn hidden" id="navUpload" onclick="switchTab(3)">Upload</button>
  <button class="nav-btn hidden" id="navUsers" onclick="switchTab(4)">Users</button>
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
<div class="card-title">Bypass Shortlink</div>
<div class="tags"><span class="tag">Linkvertise</span><span class="tag">Work.ink</span><span class="tag">Sub2Unlock</span><span class="tag">Playrole</span><span class="tag">LootLabs</span><span class="tag">Platorelay</span><span class="tag">Rekonise</span><span class="tag">Adf.ly</span><span class="tag">GPLinks</span></div>
<input type="text" class="inp" id="bypassUrl" placeholder="Paste link shortlink di sini..." autocomplete="off" spellcheck="false">
<div class="detect" id="detectBox"><span class="d-badge" id="detectBadge">—</span><span class="d-text" id="detectText">Ketik link untuk deteksi otomatis</span></div>
<button class="btn-cyan" onclick="doBypass()">Bypass Sekarang</button>
<div class="result" id="bypassResult"></div>
</div>
</div>

<div class="panel" id="tab2">
<div class="card">
<div class="card-title">RBXL / RBXM → RBXLX</div>
<div class="fmt-box">Upload file <span class="field">.rbxl</span> / <span class="field">.rbxm</span> (biner) atau <span class="field">.rbxlx</span> / <span class="field">.rbxmx</span> (XML). Hasil: <span class="field">.rbxlx</span> siap insert.</div>
<input type="file" id="convFile" accept=".rbxl,.rbxm,.rbxlx,.rbxmx" style="display:none" onchange="doConvert()">
<button class="btn-cyan" onclick="document.getElementById('convFile').click()">Pilih File (.rbxl / .rbxm / .rbxlx)</button>
<div class="result" id="convResult"></div>
</div>
</div>

<div class="panel" id="tab3">
<div id="uploadLocked" class="card">
<div class="locked">
🔒 Login dulu untuk akses upload<br>
<div style="font-size:.75rem;margin-top:6px">Role minimal: reseller</div>
<button class="btn-main" onclick="openAuthModal()">Login</button>
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

<div class="panel" id="tab4">
<div class="card">
<div class="card-title">Manage Users</div>
<button class="btn-main" onclick="loadUsers()">Refresh</button>
<div id="usersList" style="margin-top:12px"></div>
</div>
</div>

<footer>NANG RBXM Tool &copy; 2025 &middot; v${BUILD}</footer>

<script>
const WA_NUMBER="${wa}";
let TOKEN = localStorage.getItem('nang_session') || null;
let ME = null;
let lastLookup={uid:null,name:null};
let detectTimer=null;
let lastDetect=null;

function $(id){return document.getElementById(id);}
function apiCall(url, opts){ return fetch(url, opts).then(r=>r.json()); }

function switchTab(i){
  document.querySelectorAll('.nav-btn').forEach((b,j)=>b.classList.toggle('active',i===j));
  document.querySelectorAll('.panel').forEach((p,j)=>p.classList.toggle('active',i===j));
  if (i===4) loadUsers();
}

function openAuthModal(){ $('authModal').classList.add('show'); }
function closeAuthModal(){ $('authModal').classList.remove('show'); }
$('authModal').addEventListener('click',e=>{ if(e.target.id==='authModal') closeAuthModal(); });
function switchAuthTab(i){
  $('mtLogin').classList.toggle('on', i===0);
  $('mtRegister').classList.toggle('on', i===1);
  $('authFormLogin').classList.toggle('hidden', i!==0);
  $('authFormRegister').classList.toggle('hidden', i!==1);
}

async function checkSession(){
  if(!TOKEN){ updateAuthUI(); return; }
  try{
    const d = await apiCall('/api/reseller/me?token='+encodeURIComponent(TOKEN));
    if(d.ok){ ME = d.user; }
    else { TOKEN=null; localStorage.removeItem('nang_session'); }
  }catch(e){ TOKEN=null; }
  updateAuthUI();
}

function updateAuthUI(){
  const bar = $('authBar');
  if(ME && ME.role !== 'banned'){
    bar.innerHTML = '<div class="auth-pill"><span class="uname">'+ME.username+'</span><span class="role-tag '+ME.role+'">'+ME.role+'</span></div><button class="auth-btn gray" onclick="doAuthLogout()">Logout</button>';
  } else {
    bar.innerHTML = '<button class="auth-btn" onclick="openAuthModal()">Login</button>';
  }
  const isLogged = !!ME && ME.role !== 'banned';
  const canUpload = isLogged && (ME.role==='owner'||ME.role==='admin'||ME.role==='reseller');
  const isOwner = ME && ME.role==='owner';
  $('navUpload').classList.toggle('hidden', !canUpload);
  $('navUsers').classList.toggle('hidden', !isOwner);
  $('uploadLocked').classList.toggle('hidden', canUpload);
  $('uploadContent').classList.toggle('hidden', !canUpload);
  if(!canUpload && $('tab3').classList.contains('active')) switchTab(0);
  if(!isOwner && $('tab4').classList.contains('active')) switchTab(0);
}

async function doAuthLogin(){
  const identifier = $('aLoginUser').value.trim();
  const password = $('aLoginPass').value;
  const box = $('aLoginResult');
  if(!identifier||!password){ box.className='result err'; box.innerHTML='Isi username/email & password'; return; }
  box.className='result info'; box.innerHTML='<span class="spinner"></span>Masuk...';
  const d = await apiCall('/api/reseller/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier,password})});
  if(d.error){ box.className='result err'; box.innerHTML=d.error; return; }
  TOKEN = d.token;
  localStorage.setItem('nang_session', TOKEN);
  $('aLoginPass').value='';
  box.className='result ok'; box.innerHTML='Berhasil masuk';
  await checkSession();
  setTimeout(()=>{ closeAuthModal(); box.className='result'; box.innerHTML=''; }, 600);
}

async function doAuthRegister(){
  const username = $('aRegUser').value.trim();
  const email = $('aRegEmail').value.trim();
  const password = $('aRegPass').value;
  const pass2 = $('aRegPass2').value;
  const box = $('aRegResult');
  if(!username){ box.className='result err'; box.innerHTML='Username kosong'; return; }
  if(!email){ box.className='result err'; box.innerHTML='Email kosong'; return; }
  if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)){ box.className='result err'; box.innerHTML='Format email tidak valid'; return; }
  if(password!==pass2){ box.className='result err'; box.innerHTML='Password tidak sama'; return; }
  box.className='result info'; box.innerHTML='<span class="spinner"></span>Mendaftar...';
  const d = await apiCall('/api/reseller/register',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({username,email,password})
  });
  if(d.error){ box.className='result err'; box.innerHTML=d.error; return; }
  box.className='result ok'; box.innerHTML = d.message || 'Terdaftar. Tunggu approve owner.';
  $('aRegUser').value=''; $('aRegEmail').value=''; $('aRegPass').value=''; $('aRegPass2').value='';
}

async function doAuthLogout(){
  if(TOKEN){
    try{ await apiCall('/api/reseller/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TOKEN})}); }catch(e){}
  }
  TOKEN=null; ME=null;
  localStorage.removeItem('nang_session');
  updateAuthUI();
}

async function loadUsers(){
  const box = $('usersList');
  if(!TOKEN){ box.innerHTML='<div style="color:var(--red);font-size:.8rem">Belum login</div>'; return; }
  box.innerHTML='<div style="color:var(--muted);font-size:.8rem"><span class="spinner"></span>Loading...</div>';
  try{
    const d = await apiCall('/api/owner/users?token='+encodeURIComponent(TOKEN));
    if(d.error){ box.innerHTML='<div style="color:var(--red);font-size:.8rem">'+d.error+'</div>'; return; }
    if(!d.users || !d.users.length){ box.innerHTML='<div style="color:var(--muted);font-size:.8rem">Belum ada user</div>'; return; }
    box.innerHTML = d.users.map(u => (
      '<div class="user-row">'+
        '<div><div class="name">'+u.username+' <span class="role-tag '+u.role+'">'+u.role+'</span></div>'+
        '<div class="meta">'+(u.email ? u.email + ' · ' : '')+'quota '+u.quota+' · hari ini '+u.keysToday+' · total '+u.totalKeys+'</div></div>'+
        '<div class="row-actions">'+
          (u.role!=='reseller'?'<button onclick="setUserRole(\\''+u.username+'\\',\\'reseller\\')">Approve</button>':'')+
          (u.role!=='admin'?'<button onclick="setUserRole(\\''+u.username+'\\',\\'admin\\')">Admin</button>':'')+
          (u.role!=='banned'?'<button onclick="setUserRole(\\''+u.username+'\\',\\'banned\\')">Ban</button>':'<button onclick="setUserRole(\\''+u.username+'\\',\\'pending\\')">Unban</button>')+
          '<button onclick="editUserQuota(\\''+u.username+'\\','+u.quota+')">Quota</button>'+
          '<button onclick="delUser(\\''+u.username+'\\')">Hapus</button>'+
        '</div>'+
      '</div>'
    )).join('');
  }catch(e){
    box.innerHTML='<div style="color:var(--red);font-size:.8rem">Error: '+e.message+'</div>';
  }
}

async function setUserRole(username, role){
  const d = await apiCall('/api/owner/setrole',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TOKEN, username, role})});
  if(d.error) return alert(d.error);
  loadUsers();
}
async function editUserQuota(username, current){
  const v = prompt('Kuota harian untuk '+username+':', current);
  if(v===null) return;
  const d = await apiCall('/api/owner/setquota',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TOKEN, username, quota:parseInt(v)||0})});
  if(d.error) return alert(d.error);
  loadUsers();
}
async function delUser(username){
  if(!confirm('Hapus user '+username+'?')) return;
  const d = await apiCall('/api/owner/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TOKEN, username})});
  if(d.error) return alert(d.error);
  loadUsers();
}

function updateWA(){if(!lastLookup.name)return;const text="Beli Key NANG%0ANama: "+encodeURIComponent(lastLookup.name)+"%0ARoblox ID: "+lastLookup.uid+"%0ABukti TF: [screenshot]";$('waBtn').href="https://wa.me/"+WA_NUMBER+"?text="+text;$('waNama').textContent=lastLookup.name;$('waUid').textContent=lastLookup.uid;}
async function doLookup(){const uid=$('lookupId').value.trim();const box=$('lookupResult');if(!uid)return;box.style.display='block';box.className='result info';box.innerHTML='<span class="spinner"></span>Mencari...';try{const r=await fetch('/?lookup='+encodeURIComponent(uid));const d=await r.json();if(d.name){lastLookup={uid:d.uid,name:d.name};updateWA();box.style.display='none';const ex=$('userCard');if(ex)ex.remove();const card=document.createElement('div');card.id='userCard';card.className='user-card';card.innerHTML='<div class="user-avatar">'+d.name.charAt(0).toUpperCase()+'</div><div class="user-info"><div class="user-name">'+d.name+'</div><div class="user-id">ID: '+d.uid+'</div></div>';box.parentNode.insertBefore(card,box.nextSibling);}else{box.className='result err';box.innerHTML='User ID tidak ditemukan';}}catch(e){box.className='result err';box.innerHTML='Error: '+e.message;}}
let lookupT;$('lookupId').addEventListener('input',()=>{clearTimeout(lookupT);lookupT=setTimeout(doLookup,600);});

async function detectLinkNow(url){const box=$('detectBox');const badge=$('detectBadge');const text=$('detectText');if(!url||url.length<8){box.classList.remove('show');lastDetect=null;return;}try{const r=await fetch('/?detect='+encodeURIComponent(url));const d=await r.json();const det=d.detection;if(!det){box.classList.remove('show');return;}lastDetect=det;box.className='detect show '+det.auto;const labels={high:'AUTO',medium:'COBA',low:'MANUAL',none:'INVALID'};badge.textContent=det.type+' · '+labels[det.auto];text.textContent=det.note;}catch(e){box.classList.remove('show');}}
$('bypassUrl').addEventListener('input',()=>{clearTimeout(detectTimer);detectTimer=setTimeout(()=>detectLinkNow($('bypassUrl').value.trim()),500);});

async function doBypass(){
  const link=$('bypassUrl').value.trim();
  const box=$('bypassResult');
  if(!link)return;
  box.style.display='block';box.className='result info';
  const detLabel=lastDetect?'('+lastDetect.type+')':'';
  box.innerHTML='<span class="spinner"></span>Memproses '+detLabel+' — max 10 detik...';
  try{
    const r=await fetch('/?bypass='+encodeURIComponent(link));
    const d=await r.json();
    if(d.key){
      box.className='result ok';
      box.innerHTML='<b>KEY DITEMUKAN</b><div class="key-line">'+d.key+'</div><button class="btn-green" onclick="navigator.clipboard.writeText(\\''+d.key+'\\');this.textContent=\\'COPIED\\';setTimeout(()=>this.textContent=\\'COPY KEY\\',1500)">COPY KEY</button>';
      return;
    }
    if(d.result){
      const url=d.result;
      window._bypassUrl=url;
      const cls=d.source==='original'?'warn':'ok';
      box.className='result '+cls;
      let label='Bypass berhasil!';
      if(d.source==='original')label='Belum selesai — klik bypass lagi:';
      box.innerHTML=label+'<div class="key-line"><a href="'+url+'" target="_blank" style="color:#00d4ff;text-decoration:none">'+url+'</a></div>'+(d.warning?'<div style="font-size:.72rem;color:#ffc832;margin-top:8px">'+d.warning+'</div>':'');
    }else{
      box.className='result err';box.innerHTML=d.error||'Bypass gagal.';
    }
  }catch(e){box.className='result err';box.innerHTML='Error: '+e.message;}
}

async function doConvert(){
  const input=$('convFile');
  const box=$('convResult');
  if(!input.files||!input.files[0])return;
  const file=input.files[0];
  if(file.size>50*1024*1024){box.style.display='block';box.className='result err';box.innerHTML='File > 50 MB.';return;}
  box.style.display='block';box.className='result info';box.innerHTML='<span class="spinner"></span>Mengkonversi '+file.name+'...';
  try{
    const buf=await file.arrayBuffer();
    const r=await fetch('/api/convert',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:buf});
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
    const lk=await apiCall('/api/lookup-username',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username})});
    if(!lk.ok)throw new Error(lk.error);
    const up=await apiCall('/api/upload-rbxm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey,userId:lk.userId,fileName:_upFile.name,fileBase64:base64,displayName:name||_upFile.name.replace(/\\.(rbxm|rbxmx)$/i,''),description:desc||'Upload via NANG web'})});
    if(!up.ok)throw new Error(up.error);
    let assetId=null;
    for(let i=0;i<30;i++){
      await new Promise(r=>setTimeout(r,1500));
      const st=await apiCall('/api/upload-status?id='+encodeURIComponent(up.operationId)+'&k='+encodeURIComponent(apiKey));
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
  ['aLoginUser','aLoginPass'].forEach(id=>$(id).addEventListener('keydown',e=>{if(e.key==='Enter')doAuthLogin();}));
  ['aRegUser','aRegEmail','aRegPass','aRegPass2'].forEach(id=>$(id).addEventListener('keydown',e=>{if(e.key==='Enter')doAuthRegister();}));
});
</script></body></html>`;
}

// ═══════════════════════════════════════
// RESELLER PAGE (opsional standalone)
// ═══════════════════════════════════════
function resellerPage() {
  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NANG Reseller</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--pink:#e03c8a;--purple:#9b4de0;--cyan:#00d4ff;--green:#00e87a;--yellow:#ffc832;--red:#ff6b6b;--bg:#08080f;--bg2:#0f0f1a;--bg3:#16162a;--border:#ffffff12;--text:#e8e8f0;--muted:#6b6b8a}
body{background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;min-height:100vh;padding:24px 16px}
.hidden{display:none!important}
.wrap{max-width:520px;margin:0 auto}
.hero{text-align:center;margin-bottom:26px}
.logo{font-size:2.2rem;font-weight:900;background:linear-gradient(135deg,var(--pink),var(--purple),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.sub{color:var(--muted);font-size:.8rem;margin-top:4px}
.card{background:var(--bg2);border:1px solid var(--border);border-radius:14px;padding:20px;margin-bottom:12px}
.card h3{font-size:.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;font-weight:700;margin-bottom:14px}
.tabs{display:flex;gap:4px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:4px;margin-bottom:16px}
.tabs button{flex:1;padding:9px;border:none;border-radius:9px;background:transparent;color:var(--muted);font-family:inherit;font-weight:600;font-size:.85rem;cursor:pointer}
.tabs button.on{background:linear-gradient(135deg,rgba(224,60,138,.2),rgba(155,77,224,.2));color:#fff}
.inp{width:100%;padding:11px 14px;background:var(--bg3);border:1px solid var(--border);border-radius:9px;color:var(--text);font-size:.88rem;outline:none;margin-bottom:10px;font-family:inherit}
.btn{width:100%;padding:12px;background:linear-gradient(135deg,var(--pink),var(--purple));color:#fff;border:none;border-radius:10px;font-weight:700;font-size:.9rem;cursor:pointer;font-family:inherit;margin-bottom:6px}
.btn.gray{background:var(--bg3);color:var(--text);border:1px solid var(--border)}
.result{padding:12px;border-radius:9px;font-size:.82rem;margin-top:10px;display:none;line-height:1.55;word-break:break-all}
.result.ok{background:rgba(0,232,122,.06);border:1px solid rgba(0,232,122,.3);color:var(--green);display:block}
.result.err{background:rgba(255,80,80,.06);border:1px solid rgba(255,80,80,.3);color:var(--red);display:block}
.result.warn{background:rgba(255,200,50,.06);border:1px solid rgba(255,200,50,.3);color:var(--yellow);display:block}
.key-line{font-family:'JetBrains Mono',monospace;font-size:1rem;font-weight:700;color:var(--green);padding:10px;background:#0a1520;border-radius:7px;word-break:break-all;margin:8px 0}
.stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}
.stat{background:var(--bg3);padding:12px;border-radius:9px}
.stat .label{font-size:.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;font-weight:700}
.stat .value{font-size:1.4rem;font-weight:900;margin-top:4px}
.key-item{padding:10px;background:var(--bg3);border-radius:8px;margin-bottom:6px;font-size:.75rem}
.key-item .k{font-family:'JetBrains Mono',monospace;color:var(--green);font-weight:700;word-break:break-all}
.key-item .meta{color:var(--muted);font-size:.68rem;margin-top:4px}
.spinner{display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,.1);border-top-color:var(--pink);border-radius:50%;animation:spin .6s linear infinite;vertical-align:middle;margin-right:6px}
@keyframes spin{to{transform:rotate(360deg)}}
.topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding:10px 14px;background:var(--bg2);border:1px solid var(--border);border-radius:11px}
</style></head><body>
<div class="wrap">
<div class="hero"><div class="logo">NANG RESELLER</div><div class="sub">Panel reseller key system</div></div>

<div id="viewAuth">
  <div class="tabs">
    <button id="tabLogin" class="on" onclick="switchAuth(0)">Masuk</button>
    <button id="tabRegister" onclick="switchAuth(1)">Daftar</button>
  </div>
  <div class="card" id="cardLogin">
    <h3>Login</h3>
    <input class="inp" id="liUser" placeholder="Username atau Email">
    <input class="inp" id="liPass" type="password" placeholder="Password">
    <button class="btn" onclick="doLogin()">Masuk</button>
    <div class="result" id="liResult"></div>
  </div>
  <div class="card hidden" id="cardRegister">
    <h3>Daftar Reseller</h3>
    <input class="inp" id="rgUser" placeholder="Username">
    <input class="inp" id="rgEmail" type="email" placeholder="Email aktif">
    <input class="inp" id="rgPass" type="password" placeholder="Password min 5 karakter">
    <input class="inp" id="rgPass2" type="password" placeholder="Konfirmasi password">
    <button class="btn" onclick="doRegister()">Daftar</button>
    <div class="result" id="rgResult"></div>
  </div>
</div>

<div id="viewDash" class="hidden">
  <div class="topbar">
    <div><div style="font-weight:700" id="uName">—</div><div style="font-size:.7rem;color:var(--muted)" id="uRole">—</div></div>
    <button class="btn gray" style="width:auto;padding:7px 12px;margin:0" onclick="doLogout()">Logout</button>
  </div>
  <div class="card">
    <h3>Status</h3>
    <div class="stat-grid">
      <div class="stat"><div class="label">Kuota / hari</div><div class="value" id="stQuota">—</div></div>
      <div class="stat"><div class="label">Hari ini</div><div class="value" id="stToday">—</div></div>
      <div class="stat"><div class="label">Sisa</div><div class="value" id="stLeft">—</div></div>
      <div class="stat"><div class="label">Total</div><div class="value" id="stTotal">—</div></div>
    </div>
    <div id="pendingMsg" class="result warn" style="display:none"></div>
  </div>
  <div class="card">
    <h3>Generate Key</h3>
    <input class="inp" id="genUid" placeholder="Roblox User ID (angka)">
    <button class="btn" onclick="doGenerate()">Generate</button>
    <div class="result" id="genResult"></div>
  </div>
  <div class="card">
    <h3>Riwayat Key</h3>
    <div id="keyList"><div style="color:var(--muted);font-size:.8rem">Belum ada key.</div></div>
  </div>
</div>
</div>

<script>
const TOKEN_KEY='nang_reseller_token';
let me=null;
function $(id){return document.getElementById(id);}
function show(id,v){$(id).classList.toggle('hidden',!v);}
function switchAuth(i){$('tabLogin').classList.toggle('on',i===0);$('tabRegister').classList.toggle('on',i===1);show('cardLogin',i===0);show('cardRegister',i===1);}
function setRes(id,cls,html){const e=$(id);e.className='result '+cls;e.innerHTML=html;}
function getToken(){return localStorage.getItem(TOKEN_KEY);}
function setToken(t){t?localStorage.setItem(TOKEN_KEY,t):localStorage.removeItem(TOKEN_KEY);}
async function api(route,body){const opts={method:body?'POST':'GET'};if(body){opts.headers={'Content-Type':'application/json'};opts.body=JSON.stringify(body);}const r=await fetch('/api/'+route,opts);return r.json();}
async function doLogin(){const identifier=$('liUser').value.trim();const password=$('liPass').value;if(!identifier||!password)return setRes('liResult','err','Isi dulu');setRes('liResult','warn','<span class="spinner"></span>Masuk...');const d=await api('reseller/login',{identifier,password});if(d.error)return setRes('liResult','err',d.error);setToken(d.token);await refreshMe();}
async function doRegister(){const username=$('rgUser').value.trim();const email=$('rgEmail').value.trim();const password=$('rgPass').value;const pass2=$('rgPass2').value;if(password!==pass2)return setRes('rgResult','err','Password tidak sama');setRes('rgResult','warn','<span class="spinner"></span>Mendaftar...');const d=await api('reseller/register',{username,email,password});if(d.error)return setRes('rgResult','err',d.error);setRes('rgResult','ok',d.message||'Terdaftar.');}
async function doLogout(){const token=getToken();if(token)await api('reseller/logout',{token});setToken(null);me=null;show('viewDash',false);show('viewAuth',true);}
async function refreshMe(){const token=getToken();if(!token){show('viewDash',false);show('viewAuth',true);return;}const d=await api('reseller/me?token='+encodeURIComponent(token));if(!d.ok){setToken(null);show('viewDash',false);show('viewAuth',true);return;}me=d.user;show('viewAuth',false);show('viewDash',true);$('uName').textContent=me.username;$('uRole').textContent=me.role;$('stQuota').textContent=me.role==='reseller'?me.quota:'∞';$('stToday').textContent=me.keysToday||0;$('stLeft').textContent=me.role==='reseller'?Math.max(0,me.quota-(me.keysToday||0)):'∞';$('stTotal').textContent=(me.keys||[]).length;const pend=(me.role==='pending'||me.role==='banned');show('pendingMsg',pend);if(pend)$('pendingMsg').innerHTML=me.role==='banned'?'Akun di-ban.':'Akun masih pending.';const kl=$('keyList');if(!me.keys||!me.keys.length){kl.innerHTML='<div style="color:var(--muted);font-size:.8rem">Belum ada key.</div>';}else{kl.innerHTML=me.keys.map(k=>('<div class="key-item"><div class="k">'+k.key+'</div><div class="meta">UID: '+k.uid+' · '+(k.name||'?')+'</div></div>')).join('');}}
async function doGenerate(){const token=getToken();const uid=$('genUid').value.trim();if(!uid)return setRes('genResult','err','Isi User ID');setRes('genResult','warn','<span class="spinner"></span>Generate...');const d=await api('reseller/generate',{token,uid});if(d.error)return setRes('genResult','err',d.error);setRes('genResult','ok','<b>'+(d.username||'Unknown')+'</b><div class="key-line">'+d.key+'</div><div style="font-size:.75rem;color:var(--muted)">Berlaku: '+d.expires+'</div>');await refreshMe();}
document.addEventListener('DOMContentLoaded',()=>{refreshMe();['liUser','liPass'].forEach(id=>$(id).addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();}));['rgUser','rgEmail','rgPass','rgPass2'].forEach(id=>$(id).addEventListener('keydown',e=>{if(e.key==='Enter')doRegister();}));$('genUid').addEventListener('keydown',e=>{if(e.key==='Enter')doGenerate();});});
</script></body></html>`;
}
