export default async function handler(req, res) {
  try { return await handle(req, res); }
  catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(200).json({ error: "server error", detail: String(e.message || e) });
  }
}

async function handle(req, res) {
  const SECRET = "NANG2024";
  const ADMIN_PW = "nangowner123";
  const EXPIRE_S = 86400;
  const WA_NUMBER = "6281252425581";
  const BROWSERLESS_TOKEN = "2VO67VgLJTXNszJ47508df1abfc96345f97d220136688f6d6";
  const BROWSERLESS_URL = "https://production-sfo.browserless.io/function";
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
            if (t === "vector3") {
              const nums = content.match(/<X>(.*?)<\/X>.*?<Y>(.*?)<\/Y>.*?<Z>(.*?)<\/Z>/s);
              return nums ? { X: parseFloat(nums[1]), Y: parseFloat(nums[2]), Z: parseFloat(nums[3]) } : null;
            }
            if (t === "color3uint8" || t === "color3") {
              const nums = content.match(/<R>(.*?)<\/R>.*?<G>(.*?)<\/G>.*?<B>(.*?)<\/B>/s);
              return nums ? { R: parseFloat(nums[1]), G: parseFloat(nums[2]), B: parseFloat(nums[3]) } : null;
            }
            if (t === "cframe") {
              const vals = [...content.matchAll(/<[XYZUVWR]>(.*?)<\/[XYZUVWR]>/g)].map(m => parseFloat(m[1]));
              return vals.length >= 3 ? { pos: { X: vals[0], Y: vals[1], Z: vals[2] } } : null;
            }
            return content.trim();
          }
          function parseItem(itemXml) {
            const classMatch = itemXml.match(/class="([^"]+)"/);
            if (!classMatch) return null;
            const className = classMatch[1];
            const props = {};
            const propsMatch = itemXml.match(/<Properties>([\s\S]*?)<\/Properties>/);
            if (propsMatch) {
              const propsXml = propsMatch[1];
              const propRe = /<(\w+)\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g;
              let m;
              while ((m = propRe.exec(propsXml)) !== null) {
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
            return { class: className, properties: props, children };
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
      } catch (e) {
        res.status(200).json({ ok: false, error: String(e.message || e) });
        return;
      }
    }

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

  if (params.has("uid") && params.has("key")) {
    const valid = isValid(params.get("uid"), params.get("key"));
    let username = null;
    if (valid) username = await getRobloxUser(params.get("uid"));
    res.status(200).json({ valid, expires: valid ? expiryStr() : null, username });
    return;
  }

  if (params.has("lookup")) {
    const name = await getRobloxUser(params.get("lookup"));
    res.status(200).json({ uid: params.get("lookup"), name });
    return;
  }

  if (params.has("bypass")) {
    const link = params.get("bypass");
    if (!link) { res.status(200).json({ error: "no link" }); return; }

    const low = link.toLowerCase();
    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
    const ACCEPT = "application/json, text/plain, */*";

    const wrappedTokens = [
      "lootlabs","lootlinks","lootdest","platorelay","linkvertise",
      "work.ink","sub2unlock","sub2get","playrole","boost.ink",
      "socialwolvez","cutsy","mboost.me","rekonise","adfoc","adf.ly",
      "shrinkme","shrinkearn","ouo.io","exe.io","fc.lc","ez4short",
      "shorte.st","bc.vc","cutt.ly","tii.ai","linkpoi",
      "gplinks","gplink","tnlink","tnshort","mdiskshortner","indianshortner",
      "urlshort","shortlink","clk.sh","clicksfly","mightytr.ee","droplink",
      "yoshort","spaste","za.gl","za.gd","shrinkforearn","try2link",
      "kyshort","zshort","gtlink","omg10","weboasi","link1s","linkshortify",
      "arolinks","ez4mod","atglinks","indlink","pndk","ldo.tn"
    ];
    const isWrapped = (u) => typeof u === "string" && wrappedTokens.some(s => u.toLowerCase().includes(s));
    const isCleanUrl = (u) => u && typeof u === "string" && /^https?:\/\//.test(u) && !isWrapped(u);

    const tryFetch = async (u, opts = {}, ms = 15000) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), ms);
      try {
        const r = await fetch(u, { ...opts, signal: ctrl.signal });
        clearTimeout(t);
        return r;
      } catch (e) {
        clearTimeout(t);
        throw e;
      }
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
      if (typeof d === "string") {
        const m = d.match(/https?:\/\/[^\s"'<>)]+/);
        return m ? m[0] : null;
      }
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

    const ok = (result, source) => {
      if (isCleanUrl(result)) {
        res.status(200).json({ result, source });
        return true;
      }
      return false;
    };

    // LAYER 1 — bypass.vip
    try {
      const r = await tryFetch("https://api.bypass.vip/", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": UA, "Accept": ACCEPT,
          "Origin": "https://bypass.vip",
          "Referer": "https://bypass.vip/",
        },
        body: "url=" + encodeURIComponent(link),
      });
      if (r.ok) {
        const d = await readJson(r);
        const result = extract(d);
        if (ok(result, "bypass.vip")) return;
      }
    } catch {}

    // LAYER 2 — bypass.city
    try {
      const r = await tryFetch("https://api.bypass.city/api/bypass", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": UA, "Accept": ACCEPT,
          "Origin": "https://bypass.city",
          "Referer": "https://bypass.city/",
        },
        body: JSON.stringify({ url: link }),
      });
      if (r.ok) {
        const d = await readJson(r);
        const result = extract(d);
        if (ok(result, "bypass.city")) return;
      }
    } catch {}

    // LAYER 3 — generic workers
    const genericApis = [
      "https://bypass.tools/api/bypass?url=" + encodeURIComponent(link),
      "https://api.bypassall.lol/bypass?url=" + encodeURIComponent(link),
      "https://bypassall.lol/api/bypass?url=" + encodeURIComponent(link),
      "https://api.bypass-unlocked.workers.dev/?url=" + encodeURIComponent(link),
      "https://bypass.pm/api/bypass?url=" + encodeURIComponent(link),
      "https://api.bypasser.workers.dev/bypass?url=" + encodeURIComponent(link),
      "https://bypasser.workers.dev/bypass?url=" + encodeURIComponent(link),
      "https://api.bypass.pro/bypass?url=" + encodeURIComponent(link),
    ];
    for (const u of genericApis) {
      try {
        const r = await tryFetch(u, { method: "GET", headers: { "User-Agent": UA, "Accept": ACCEPT } });
        if (!r.ok) continue;
        const d = await readJson(r);
        const result = extract(d);
        if (ok(result, "generic-api")) return;
      } catch {}
    }

    // LAYER 4 — linkvertise dedicated
    if (low.includes("linkvertise") || low.includes("work.ink") || low.includes("boost.ink") || low.includes("mboost.me")) {
      const lvApis = [
        "https://bypass.bot.nu/bypass?url=" + encodeURIComponent(link),
        "https://linklm.com/api/bypass?url=" + encodeURIComponent(link),
      ];
      for (const u of lvApis) {
        try {
          const r = await tryFetch(u, { method: "GET", headers: { "User-Agent": UA, "Accept": ACCEPT } });
          if (!r.ok) continue;
          const d = await readJson(r);
          const result = extract(d);
          if (ok(result, "linkvertise-api")) return;
        } catch {}
      }
    }

    // LAYER 5 — rekonise
    if (low.includes("rekonise") || low.includes("socialwolvez") || low.includes("cutsy")) {
      try {
        const slug = link.match(/rekonise\.com\/([a-z0-9]+)/i)?.[1] || "";
        if (slug) {
          const r = await tryFetch("https://api.rekonise.com/socialunlocks/" + slug, {
            headers: { "User-Agent": UA, "Accept": ACCEPT },
          });
          if (r.ok) {
            const d = await readJson(r);
            const result = extract(d);
            if (ok(result, "rekonise-api")) return;
          }
        }
      } catch {}
    }

    // LAYER 6 — browserless
    if (BROWSERLESS_TOKEN) {
      try {
        const r = await tryFetch(BROWSERLESS_URL + "?token=" + BROWSERLESS_TOKEN + "&timeout=90000", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: `export default async function ({ page, context }) {
              const startUrl = context.url;
              const low = startUrl.toLowerCase();
              const wrapped = ${JSON.stringify(wrappedTokens)};
              const isWrapped = (u) => wrapped.some(s => u.toLowerCase().includes(s));
              const isPlatorelay = low.includes("platorelay");
              const isLoot = low.includes("lootlabs") || low.includes("lootlinks") || low.includes("lootdest");
              const isLinkvertise = low.includes("linkvertise") || low.includes("work.ink") || low.includes("boost.ink");
              function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
              async function clickAll(pg) {
                return pg.evaluate(() => {
                  let n = 0;
                  const els = document.querySelectorAll("button, a, [role='button'], [onclick], input[type='submit'], input[type='button'], [class*='btn'], [id*='btn']");
                  els.forEach(el => {
                    if (el.disabled) return;
                    const st = getComputedStyle(el);
                    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return;
                    const t = (el.textContent || el.value || "").toLowerCase().trim();
                    const pat = ["continue","get link","unlock","proceed","go to link","visit","lanjut","claim","next","done","finish","complete","open","dapatkan","klik","click here","access","enter","download","get now","continue to","reveal","show link","generate link","free access","visit now","verify","submit"];
                    if (pat.some(p => t.includes(p))) { try { el.click(); n++; } catch {} }
                  });
                  return n;
                });
              }
              async function skipTimers(pg) {
                await pg.evaluate(() => {
                  try {
                    const origST = window.setTimeout;
                    const origSI = window.setInterval;
                    window.setTimeout = (fn, d, ...a) => origST(fn, Math.min(d || 0, 60), ...a);
                    window.setInterval = (fn, d, ...a) => origSI(fn, Math.min(d || 0, 60), ...a);
                    document.querySelectorAll("[class*='countdown'],[class*='timer'],[id*='countdown'],[id*='timer'],[class*='wait'],[id*='wait']").forEach(el => {
                      try { el.style.display = 'none'; el.remove(); } catch {}
                    });
                    document.querySelectorAll("button[disabled], a.disabled, .disabled").forEach(el => {
                      try { el.disabled = false; el.removeAttribute('disabled'); el.classList.remove('disabled'); } catch {}
                    });
                  } catch {}
                });
              }
              try {
                await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");
                await page.setViewport({ width: 1366, height: 900 });
                await page.setRequestInterception(true);
                page.on("request", req => {
                  const u = req.url().toLowerCase();
                  const block = ["google-analytics","googletagmanager","doubleclick","googlesyndication","adsbygoogle","amazon-adsystem","pagead","moatads","adsrvr","advertising","analytics","tracker","hotjar","fbevents","ga.js","gtag","clarity.ms","facebook.com","twitter.com","tiktok.com","criteo","taboola","outbrain","yandex","vungle","applovin"];
                  if (block.some(p => u.includes(p))) { req.abort(); return; }
                  req.continue();
                });
                await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 35000 });
                await sleep(4500);
                for (let i = 0; i < 15; i++) {
                  await clickAll(page);
                  if (isPlatorelay || isLoot) await skipTimers(page);
                  await sleep(2200);
                  const cur = page.url();
                  if (!isWrapped(cur)) return { url: cur, status: "resolved" };
                }
                await sleep(isLoot ? 6000 : isLinkvertise ? 4000 : 2500);
                const finalUrl = page.url();
                if (!isWrapped(finalUrl)) return { url: finalUrl, status: "resolved" };
                const found = await page.evaluate(() => {
                  const all = [...document.querySelectorAll("a[href^='http']")];
                  const bad = ${JSON.stringify(wrappedTokens)};
                  for (const a of all) {
                    const h = a.href;
                    if (bad.some(s => h.toLowerCase().includes(s))) continue;
                    if (h.includes("google") || h.includes("cloudflare") || h.includes("discord") || h.includes("facebook") || h.includes("twitter") || h.includes("tiktok")) continue;
                    return h;
                  }
                  return null;
                });
                if (found && !isWrapped(found)) return { url: found, status: "resolved" };
                return { url: finalUrl, status: "still_wrapped" };
              } catch (e) {
                return { url: startUrl, status: "error", error: String(e.message || e) };
              }
            }`,
            context: { url: link },
          }),
        }, 95000);
        if (r.ok) {
          const d = await readJson(r);
          if (d && isCleanUrl(d.url)) {
            res.status(200).json({ result: d.url, source: "browserless" });
            return;
          }
        }
      } catch (e) { console.error("Browserless:", e.message); }
    }

    // LAYER 7 — HEAD redirect
    try {
      const r = await tryFetch(link, { method: "HEAD", redirect: "manual", headers: { "User-Agent": UA } }, 7000);
      const loc = r.headers.get("location");
      if (loc && /^https?:\/\//.test(loc) && loc !== link && !isWrapped(loc)) {
        res.status(200).json({ result: loc, source: "redirect" });
        return;
      }
    } catch {}

    res.status(200).json({
      result: link,
      source: "original",
      warning: "Semua provider bypass gagal. Coba lagi dalam 1-2 menit, atau ganti link.",
    });
    return;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(mainPage(WA_NUMBER));
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
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--pink:#e03c8a;--purple:#9b4de0;--cyan:#00d4ff;--green:#00e87a;--bg:#08080f;--bg2:#0f0f1a;--bg3:#16162a;--border:#ffffff12;--text:#e8e8f0;--muted:#6b6b8a}
body{background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:24px 16px}
.hero{text-align:center;margin-bottom:28px}
.logo{font-size:2.6rem;font-weight:900;background:linear-gradient(135deg,var(--pink),var(--purple),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1}
.logo-badge{display:inline-block;background:linear-gradient(135deg,var(--pink),var(--purple));color:#fff;font-size:0.6rem;font-weight:700;padding:2px 7px;border-radius:20px;vertical-align:super;margin-left:4px;letter-spacing:1px}
.sub{color:var(--muted);font-size:0.8rem;margin-top:6px}
.nav{display:flex;gap:6px;background:var(--bg2);border:1px solid var(--border);border-radius:14px;padding:5px;margin-bottom:22px;width:100%;max-width:480px}
.nav-btn{flex:1;padding:9px 6px;border:none;border-radius:10px;cursor:pointer;font-size:0.8rem;font-weight:600;background:transparent;color:var(--muted);font-family:inherit}
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
.result.ok{border-color:rgba(0,232,122,0.3);color:var(--green)}
.result.err{border-color:rgba(255,80,80,0.3);color:#ff6b6b;background:rgba(255,40,40,0.05)}
.result.warn{border-color:rgba(255,200,50,0.3);color:#ffc832;background:rgba(255,200,50,0.05)}
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
footer{margin-top:28px;color:var(--muted);font-size:0.7rem;text-align:center;opacity:0.5}
#ownerFab{position:fixed;bottom:20px;right:20px;width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,var(--pink),var(--purple));display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 12px rgba(224,60,138,0.4);font-size:20px;user-select:none;opacity:0.35;transition:opacity .2s}
#ownerFab:hover{opacity:1}
#genPanel{position:fixed;inset:0;background:rgba(0,0,0,0.7);display:none;align-items:center;justify-content:center;z-index:100;padding:20px}
#genPanel.show{display:flex}
#genPanel .box{background:#0f0f1a;border:1px solid var(--pink);border-radius:16px;padding:24px;max-width:400px;width:100%;position:relative}
#genPanel h3{color:var(--pink);font-size:1rem;margin-bottom:14px}
#genPanel .close{position:absolute;top:12px;right:16px;cursor:pointer;color:var(--muted);font-size:22px}
</style></head><body>
<div class="hero"><div class="logo">NANG<span class="logo-badge">KEY</span></div><div class="sub">Roblox Script Key System</div></div>
<div class="nav"><button class="nav-btn active" onclick="switchTab(0)">Beli Key</button><button class="nav-btn" onclick="switchTab(1)">Bypass</button><button class="nav-btn" onclick="switchTab(2)">Convert</button></div>

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
<input type="text" class="inp" id="bypassUrl" placeholder="Paste link shortlink di sini...">
<button class="btn-cyan" onclick="doBypass()">Bypass Sekarang</button>
<div class="result" id="bypassResult"></div>
</div>
</div>

<div class="panel" id="tab2">
<div class="card">
<div class="card-title">RBXL / RBXM → RBXLX</div>
<div class="fmt-box">Upload file biner <span class="field">.rbxl</span> atau <span class="field">.rbxm</span>, lalu download hasilnya sebagai <span class="field">.rbxlx</span> (XML). File XML bisa langsung dibaca script NANG atau dibuka di Roblox Studio.<br><br><b style="color:#ffc832">Limit: 50 MB per file.</b></div>
<input type="file" id="convFile" accept=".rbxl,.rbxm" style="display:none" onchange="doConvert()">
<button class="btn-cyan" onclick="document.getElementById('convFile').click()">Pilih File (.rbxl / .rbxm)</button>
<div class="result" id="convResult"></div>
</div>
</div>

<footer>NANG RBXM Tool &copy; 2025</footer>

<div id="ownerFab" onclick="openGen()" title="Owner Only">&#128274;</div>
<div id="genPanel"><div class="box"><span class="close" onclick="closeGen()">&times;</span><h3>Owner Panel</h3><input type="password" class="inp" id="genPw" placeholder="Password owner..."><button class="btn-main" onclick="doLogin()">Login</button><div id="genForm" style="display:none;margin-top:14px"><input type="text" class="inp" id="genUid" placeholder="Roblox User ID..."><button class="btn-main" onclick="doGenerate()">Generate Key</button><div class="result" id="genResult"></div></div></div></div>

<script>
const WA_NUMBER="${wa}";
let lastLookup={uid:null,name:null};
let ownerPw=null;
function switchTab(i){document.querySelectorAll('.nav-btn').forEach((b,j)=>b.classList.toggle('active',i===j));document.querySelectorAll('.panel').forEach((p,j)=>p.classList.toggle('active',i===j));}
function updateWA(){if(!lastLookup.name)return;const text="Beli Key NANG%0ANama: "+encodeURIComponent(lastLookup.name)+"%0ARoblox ID: "+lastLookup.uid+"%0ABukti TF: [screenshot]";document.getElementById('waBtn').href="https://wa.me/"+WA_NUMBER+"?text="+text;document.getElementById('waNama').textContent=lastLookup.name;document.getElementById('waUid').textContent=lastLookup.uid;}
async function doLookup(){const uid=document.getElementById('lookupId').value.trim();const box=document.getElementById('lookupResult');if(!uid)return;box.style.display='block';box.className='result';box.innerHTML='<span class="spinner"></span>Mencari...';try{const r=await fetch('/?lookup='+encodeURIComponent(uid));const d=await r.json();if(d.name){lastLookup={uid:d.uid,name:d.name};updateWA();box.style.display='none';const existing=document.getElementById('userCard');if(existing)existing.remove();const card=document.createElement('div');card.id='userCard';card.className='user-card';card.innerHTML='<div class="user-avatar">'+d.name.charAt(0).toUpperCase()+'</div><div class="user-info"><div class="user-name">'+d.name+'</div><div class="user-id">ID: '+d.uid+'</div></div>';box.parentNode.insertBefore(card,box.nextSibling);}else{box.className='result err';box.innerHTML='User ID tidak ditemukan';}}catch(e){box.className='result err';box.innerHTML='Error: '+e.message;}}
let lookupT;document.getElementById('lookupId').addEventListener('input',()=>{clearTimeout(lookupT);lookupT=setTimeout(doLookup,600);});
function openGen(){document.getElementById('genPanel').classList.add('show');}
function closeGen(){document.getElementById('genPanel').classList.remove('show');document.getElementById('genPw').value='';document.getElementById('genForm').style.display='none';document.getElementById('genResult').style.display='none';ownerPw=null;document.getElementById('genPw').disabled=false;}
document.getElementById('genPanel').addEventListener('click',(e)=>{if(e.target.id==='genPanel')closeGen();});
async function doLogin(){const pw=document.getElementById('genPw').value;if(!pw)return;try{const r=await fetch('/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'generate',pw:pw,uid:'1'})});const d=await r.json();if(d.error==='password salah'){document.getElementById('genPw').value='';document.getElementById('genPw').placeholder='password salah';}else if(d.ok){ownerPw=pw;document.getElementById('genForm').style.display='block';document.getElementById('genPw').disabled=true;}}catch(e){}}
async function doGenerate(){const uid=document.getElementById('genUid').value.trim();const box=document.getElementById('genResult');if(!uid||!ownerPw)return;box.style.display='block';box.className='result';box.innerHTML='<span class="spinner"></span>Generating...';try{const r=await fetch('/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'generate',pw:ownerPw,uid:uid})});const d=await r.json();if(d.ok){box.className='result ok';box.innerHTML='<b>Username:</b> '+(d.username||'Unknown')+'<div class="key-line">'+d.key+'</div><b style="color:#6b6b8a;font-size:.72rem">Auth Link:</b><a href="'+d.authLink+'" target="_blank" class="link-line">'+d.authLink+'</a><button class="btn-green" onclick="navigator.clipboard.writeText(\\''+d.key+'\\');this.textContent=\\'COPIED\\';setTimeout(()=>this.textContent=\\'COPY KEY\\',1500)">COPY KEY</button>';}else{box.className='result err';box.innerHTML=d.error||'Gagal';}}catch(e){box.className='result err';box.innerHTML='Error: '+e.message;}}
async function doBypass(){const link=document.getElementById('bypassUrl').value.trim();const box=document.getElementById('bypassResult');if(!link)return;box.style.display='block';box.className='result';box.innerHTML='<span class="spinner"></span>Memproses (LootLabs/platorelay bisa 20-40 detik)...';try{const r=await fetch('/?bypass='+encodeURIComponent(link));const d=await r.json();if(d.result){const url=d.result;window._bypassUrl=url;const cls=d.source==='browserless'?'ok':(d.source==='original'?'warn':'ok');box.className='result '+cls;let label='Bypass berhasil!';if(d.source==='original')label='Belum selesai — klik bypass lagi:';const src=d.source?'<div style="font-size:.7rem;color:#6b6b8a;margin-top:4px">via '+d.source+'</div>':'';box.innerHTML=label+src+'<div class="key-line"><a href="'+url+'" target="_blank" style="color:#00d4ff;text-decoration:none">'+url+'</a></div>'+(d.source!=='original'?'<button class="btn-green" onclick="navigator.clipboard.writeText(window._bypassUrl);this.textContent=\\'COPIED\\';setTimeout(()=>this.textContent=\\'COPY LINK\\',1500)">COPY LINK</button>':'')+(d.warning?'<div style="font-size:.72rem;color:#ffc832;margin-top:8px">'+d.warning+'</div>':'');}else{box.className='result err';box.innerHTML=d.error||'Bypass gagal.';}}catch(e){box.className='result err';box.innerHTML='Error: '+e.message;}}
async function doConvert(){
  const input=document.getElementById('convFile');
  const box=document.getElementById('convResult');
  if(!input.files||!input.files[0])return;
  const file=input.files[0];
  if(file.size>50*1024*1024){box.style.display='block';box.className='result err';box.innerHTML='File > 50 MB, terlalu besar.';return;}
  box.style.display='block';box.className='result';box.innerHTML='<span class="spinner"></span>Mengkonversi '+file.name+' ('+(file.size/1024).toFixed(1)+' KB)...';
  try{
    const buf=await file.arrayBuffer();
    const r=await fetch('/api/convert',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:buf});
    const text=await r.text();
    if(!r.ok){
      let msg=text;
      try{msg=JSON.parse(text).error||text;}catch{}
      box.className='result err';box.innerHTML='Gagal ('+r.status+'): '+msg;return;
    }
    const blob=new Blob([text],{type:'application/xml'});
    const url=URL.createObjectURL(blob);
    const outName=file.name.replace(/\.(rbxl|rbxm)$/i,'.rbxlx');
    box.className='result ok';
    box.innerHTML='Berhasil! Ukuran output: '+(text.length/1024).toFixed(1)+' KB<div class="key-line"><a href="'+url+'" download="'+outName+'" style="color:#00d4ff;text-decoration:none">Download '+outName+'</a></div>';
  }catch(e){
    box.className='result err';box.innerHTML='Error: '+e.message;
  }
}
</script></body></html>`;
}
