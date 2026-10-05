export default async function handler(req, res) {
  try { return await handle(req, res); }
  catch (e) {
    console.error("HANDLER ERROR:", e);
    if (!res.headersSent) res.status(200).json({ error: "server error", detail: String(e.message || e) });
  }
}

async function handle(req, res) {
  const SECRET = "NANG2024";
  const ADMIN_PW = "nangowner123";
  const EXPIRE_S = 86400;
  const WA_NUMBER = "6281252425581";
  const AUTH_DOMAIN = req.headers.host || "localhost";

  function simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = ((h * 31) + str.charCodeAt(i)) % 1000000007;
    return h;
  }
  function getWindow(ts) { return Math.floor((ts || Date.now() / 1000) / EXPIRE_S); }
  function makeKey(uid, w) {
    const h = simpleHash(SECRET + uid + w);
    const p1 = String(uid).slice(0, 5).padEnd(5, "0");
    return "NANG-" + p1 + "-" + String(h % 10000).padStart(4, "0") + "-" + String(Math.floor(h / 10000) % 10000).padStart(4, "0");
  }
  function isValid(uid, key) {
    const w = getWindow();
    return makeKey(uid, w) === key || makeKey(uid, w - 1) === key;
  }
  function expiryStr() {
    const now = Date.now() / 1000;
    const next = (getWindow() + 1) * EXPIRE_S;
    const left = Math.round(next - now);
    return Math.floor(left / 3600) + "j " + Math.floor((left % 3600) / 60) + "m";
  }
  function b64urlEncode(obj) {
    let b64 = Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64urlDecode(str) {
    let s = str.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return Buffer.from(s, "base64").toString("utf8");
  }
  function makeAuthLink(uid, key, username) {
    const payload = { u: String(uid), k: key, n: username || "", e: (getWindow() + 1) * EXPIRE_S };
    return "https://" + AUTH_DOMAIN + "/auth?d=" + b64urlEncode(payload);
  }
  async function getRobloxUser(uid) {
    try {
      const r = await fetch("https://users.roblox.com/v1/users/" + uid);
      if (!r.ok) return null;
      return (await r.json()).name || null;
    } catch { return null; }
  }

  const url = new URL(req.url, "https://" + AUTH_DOMAIN);
  const params = url.searchParams;
  const path = url.pathname;
  const method = req.method;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (method === "OPTIONS") { res.status(200).end(); return; }

  // ═══ POST — validate + private generate ═══
  if (method === "POST") {
    let body = "";
    await new Promise(r => { req.on("data", c => body += c); req.on("end", r); });
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.status(400).json({ valid: false, error: "bad json" }); return; }

    if (parsed.action === "generate") {
      if (parsed.pw !== ADMIN_PW) { res.status(200).json({ error: "password salah" }); return; }
      const uid = String(parsed.uid || "").trim();
      if (!uid) { res.status(200).json({ error: "uid kosong" }); return; }
      const key = makeKey(uid, getWindow());
      const name = await getRobloxUser(uid);
      res.status(200).json({ ok: true, uid, key, expires: expiryStr(), username: name, authLink: makeAuthLink(uid, key, name) });
      return;
    }

    const valid = isValid(parsed.uid, parsed.key);
    let username = null;
    if (valid) username = await getRobloxUser(parsed.uid);
    res.status(200).json({ valid, expires: valid ? expiryStr() : null, username });
    return;
  }

  // ═══ GET /auth ═══
  if (path === "/auth" || path === "/auth/") {
    const d = params.get("d");
    if (!d) { res.status(400).send("Missing data"); return; }
    let data;
    try { data = JSON.parse(b64urlDecode(d)); } catch { res.status(400).send("Invalid link"); return; }
    if (!data.u || !data.k) { res.status(400).send("Invalid data"); return; }
    const valid = isValid(data.u, data.k);
    const name = data.n || await getRobloxUser(data.u);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(authPage(data, valid, name));
    return;
  }

  // ═══ GET validate ═══
  if (params.has("uid") && params.has("key")) {
    const valid = isValid(params.get("uid"), params.get("key"));
    let username = null;
    if (valid) username = await getRobloxUser(params.get("uid"));
    res.status(200).json({ valid, expires: valid ? expiryStr() : null, username });
    return;
  }

  // ═══ GET lookup ═══
  if (params.has("lookup")) {
    const name = await getRobloxUser(params.get("lookup"));
    res.status(200).json({ uid: params.get("lookup"), name });
    return;
  }

  // ═══ GET bypass — 6+ API fallback ═══
  if (params.has("bypass")) {
    const link = params.get("bypass");
    if (!link) { res.status(200).json({ error: "no link" }); return; }
    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
    const tried = [];

    // ─── 1. bypass.vip (POST form) — verified working 2026 ───
    try {
      const r = await fetch("https://api.bypass.vip/", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": UA,
          "Accept": "application/json, text/plain, */*",
          "Origin": "https://bypass.vip",
          "Referer": "https://bypass.vip/",
        },
        body: "url=" + encodeURIComponent(link),
      });
      if (r.ok) {
        const d = await r.json();
        const result = d.result || d.url || d.destination || d.data || d.bypassed;
        if (result && typeof result === "string" && result.startsWith("http")) {
          res.status(200).json({ result, source: "bypass.vip" });
          return;
        }
        tried.push("bypass.vip:" + (d.message || "no result"));
      } else tried.push("bypass.vip:HTTP" + r.status);
    } catch (e) { tried.push("bypass.vip:err"); }

    // ─── 2. bypass.city (POST) ───
    try {
      const r = await fetch("https://api.bypass.city/api/bypass", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA, "Origin": "https://bypass.city", "Referer": "https://bypass.city/" },
        body: JSON.stringify({ url: link }),
      });
      if (r.ok) {
        const d = await r.json();
        const result = d.result || d.destination || d.url || d.data;
        if (result && typeof result === "string" && result.startsWith("http")) {
          res.status(200).json({ result, source: "bypass.city" });
          return;
        }
        tried.push("bypass.city:" + (d.message || "no result"));
      } else tried.push("bypass.city:HTTP" + r.status);
    } catch (e) { tried.push("bypass.city:err"); }

    // ─── 3. bypass.city (GET) ───
    try {
      const r = await fetch("https://api.bypass.city/api/bypass?url=" + encodeURIComponent(link), {
        headers: { "User-Agent": UA, "Origin": "https://bypass.city", "Referer": "https://bypass.city/" },
      });
      if (r.ok) {
        const d = await r.json();
        const result = d.result || d.destination || d.url || d.data;
        if (result && typeof result === "string" && result.startsWith("http")) {
          res.status(200).json({ result, source: "bypass.city-get" });
          return;
        }
      }
    } catch {}

    // ─── 4. bypass.tools (public endpoint) — verified operational 2026 ───
    try {
      const r = await fetch("https://bypass.tools/api/bypass", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA, "Origin": "https://bypass.tools", "Referer": "https://bypass.tools/" },
        body: JSON.stringify({ url: link }),
      });
      if (r.ok) {
        const d = await r.json();
        const result = d.result || d.destination || d.url || d.data;
        if (result && typeof result === "string" && result.startsWith("http")) {
          res.status(200).json({ result, source: "bypass.tools" });
          return;
        }
        tried.push("bypass.tools:" + (d.message || "no result"));
      } else tried.push("bypass.tools:HTTP" + r.status);
    } catch (e) { tried.push("bypass.tools:err"); }

    // ─── 5. Evo-Bypass (open source endpoint) ───
    try {
      const r = await fetch("https://api.bypass-unlock.com/api/bypass", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA },
        body: JSON.stringify({ url: link }),
      });
      if (r.ok) {
        const d = await r.json();
        const result = d.result || d.destination || d.url;
        if (result && typeof result === "string" && result.startsWith("http")) {
          res.status(200).json({ result, source: "bypass-unlock" });
          return;
        }
      }
    } catch {}

    // ─── 6. BypassLinks (public resolver) ───
    try {
      const r = await fetch("https://bypass-links.com/api/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA, "Origin": "https://bypass-links.com", "Referer": "https://bypass-links.com/" },
        body: JSON.stringify({ url: link }),
      });
      if (r.ok) {
        const d = await r.json();
        const result = d.result || d.destination || d.url || d.data;
        if (result && typeof result === "string" && result.startsWith("http")) {
          res.status(200).json({ result, source: "bypass-links" });
          return;
        }
      }
    } catch {}

    // ─── 7. HEAD redirect extract (bit.ly, tinyurl, dll) ───
    try {
      const r = await fetch(link, { method: "HEAD", redirect: "manual", headers: { "User-Agent": UA } });
      const loc = r.headers.get("location");
      if (loc && loc.startsWith("http") && loc !== link) {
        res.status(200).json({ result: loc, source: "redirect-extract" });
        return;
      }
    } catch {}

    // ─── 8. TRW free bypass endpoint ───
    try {
      const r = await fetch("https://api.trw.lat/bypass?url=" + encodeURIComponent(link), {
        headers: { "User-Agent": UA, "Accept": "application/json" },
      });
      if (r.ok) {
        const d = await r.json();
        const result = d.result || d.destination || d.url;
        if (result && typeof result === "string" && result.startsWith("http")) {
          res.status(200).json({ result, source: "trw-api" });
          return;
        }
      }
    } catch {}

    // ─── Fallback: return link asli ───
    res.status(200).json({
      result: link,
      source: "original",
      warning: "Semua API bypass gagal. Link asli dikembalikan — buka manual.",
      tried: tried.join(" | "),
    });
    return;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(mainPage(WA_NUMBER));
}
