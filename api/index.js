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

  function simpleHash(str) { let h=0; for(let i=0;i<str.length;i++) h=((h*31)+str.charCodeAt(i))%1000000007; return h; }
  function getWindow(ts) { return Math.floor((ts || Date.now()/1000) / EXPIRE_S); }
  function makeKey(uid, w) {
    const h = simpleHash(SECRET + uid + w);
    const p1 = String(uid).slice(0,5).padEnd(5,"0");
    return "NANG-" + p1 + "-" + String(h%10000).padStart(4,"0") + "-" + String(Math.floor(h/10000)%10000).padStart(4,"0");
  }
  function isValid(uid, key) { const w=getWindow(); return makeKey(uid,w)===key || makeKey(uid,w-1)===key; }
  function expiryStr() {
    const now = Date.now()/1000;
    const next = (getWindow()+1)*EXPIRE_S;
    const left = Math.round(next-now);
    return Math.floor(left/3600)+"j "+Math.floor((left%3600)/60)+"m";
  }
  function b64urlEncode(obj) {
    let b64 = Buffer.from(JSON.stringify(obj),"utf8").toString("base64");
    return b64.replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  }
  function b64urlDecode(str) {
    let s = str.replace(/-/g,"+").replace(/_/g,"/");
    while(s.length%4) s+="=";
    return Buffer.from(s,"base64").toString("utf8");
  }
  function makeAuthLink(uid,key,username) {
    const payload = { u: String(uid), k: key, n: username||"", e: (getWindow()+1)*EXPIRE_S };
    return "https://" + AUTH_DOMAIN + "/auth?d=" + b64urlEncode(payload);
  }
  async function getRobloxUser(uid) {
    try {
      const r = await fetch("https://users.roblox.com/v1/users/"+uid);
      if(!r.ok) return null;
      return (await r.json()).name || null;
    } catch { return null; }
  }

  const url = new URL(req.url, "https://" + AUTH_DOMAIN);
  const params = url.searchParams;
  const path = url.pathname;
  const method = req.method;

  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  if (method === "OPTIONS") { res.status(200).end(); return; }

  if (method === "POST") {
    let body = "";
    await new Promise(r => { req.on("data", c => body += c); req.on("end", r); });
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.status(400).json({ valid:false, error:"bad json" }); return; }

    if (parsed.action === "generate") {
      if (parsed.pw !== ADMIN_PW) { res.status(200).json({ error:"password salah" }); return; }
      const uid = String(parsed.uid||"").trim();
      if(!uid) { res.status(200).json({ error:"uid kosong" }); return; }
      const key = makeKey(uid, getWindow());
      const name = await getRobloxUser(uid);
      res.status(200).json({ ok:true, uid, key, expires: expiryStr(), username: name, authLink: makeAuthLink(uid,key,name) });
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
    if(!d) { res.status(400).send("Missing data"); return; }
    let data;
    try { data = JSON.parse(b64urlDecode(d)); } catch { res.status(400).send("Invalid link"); return; }
    if(!data.u || !data.k) { res.status(400).send("Invalid data"); return; }
    const valid = isValid(data.u, data.k);
    const name = data.n || await getRobloxUser(data.u);
    res.setHeader("Content-Type","text/html; charset=utf-8");
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

  // ═══ BYPASS — FAST MODE ═══
  if (params.has("bypass")) {
    const link = params.get("bypass");
    if(!link) { res.status(200).json({ error:"no link" }); return; }
    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

    const WRAPPED = ["lootlabs","lootlinks","lootdest","platorelay","platoboost","linkvertise","link-to","work.ink","sub2unlock","sub2get","playrole","ouo.io","exe.io","shrinkme","shrinkearn"];
    const isClean = (u) => u && typeof u === "string" && u.startsWith("http") && !WRAPPED.some(s => u.toLowerCase().includes(s));
    const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

    // RACE 3 API paralel — ambil yang cepat jawab
    const apiCalls = [
      withTimeout(fetch("https://api.bypass.vip/", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent": UA, "Origin": "https://bypass.vip", "Referer": "https://bypass.vip/",
        },
        body: "url=" + encodeURIComponent(link),
      }).then(r => r.ok ? r.json().then(d => d.result || d.destination || d.url) : null), 6000).catch(() => null),

      withTimeout(fetch("https://api.bypass.city/api/bypass", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA, "Origin": "https://bypass.city", "Referer": "https://bypass.city/" },
        body: JSON.stringify({ url: link }),
      }).then(r => r.ok ? r.json().then(d => d.result || d.destination || d.url) : null), 6000).catch(() => null),

      withTimeout(fetch("https://bypass.pm/bypass2?url=" + encodeURIComponent(link), {
        headers: { "User-Agent": UA },
      }).then(r => r.ok ? r.text().then(t => {
        try { const d = JSON.parse(t); return d.result || d.destination || d.url; } catch {}
        const m = t.match(/https?:\/\/[^\s"'<>]+/);
        return m ? m[0] : null;
      }) : null), 6000).catch(() => null),
    ];

    const results = await Promise.all(apiCalls);
    for(const r of results) {
      if (isClean(r)) return res.status(200).json({ result: r, source: "api-fast" });
    }

    // Browserless fallback — 1 klik per 3s, max 8 iterasi
    try {
      const isLV = link.toLowerCase().includes("linkvertise") || link.toLowerCase().includes("link-to") || link.toLowerCase().includes("work.ink");

      const browserScript = `
export default async function ({ page, context }) {
  const url = context.url;
  const WRAPPED = ["lootlabs","lootlinks","lootdest","platorelay","platoboost","linkvertise","link-to","work.ink","sub2unlock","sub2get","playrole"];
  const LEGAL = ["/legal","/report","/terms","/privacy","/abuse","/contact","/dmca","/policy"];
  const isWrapped = (u) => WRAPPED.some(s => u.toLowerCase().includes(s));
  const isLegal = (u) => LEGAL.some(s => u.toLowerCase().includes(s));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function clickOne() {
    return page.evaluate(() => {
      const H = window.innerHeight, W = window.innerWidth;
      const BAD = ["report","legal","terms","privacy","abuse","contact","help","faq","dmca","policy","login","signup","register","share","facebook","twitter","instagram","discord","telegram","tiktok","youtube","about","cookie"];
      const GOOD = ["continue","get link","unlock","proceed","free access","go to link","visit now","click here","lanjut","dapatkan","klik","access","claim","skip ad"];
      const list = [];
      document.querySelectorAll("button, [role=button], input[type=submit], a.btn, a.button").forEach(el => {
        try {
          if (el.disabled) return;
          const s = window.getComputedStyle(el);
          if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) < 0.3) return;
          const rect = el.getBoundingClientRect();
          if (rect.width < 120 || rect.height < 35) return;
          if (rect.top < H * 0.15 || rect.bottom > H * 0.9) return;
          const cx = rect.left + rect.width / 2;
          if (Math.abs(cx - W / 2) > W * 0.35) return;
          const t = (el.textContent || el.value || "").toLowerCase().trim();
          if (BAD.some(b => t.includes(b))) return;
          if (!GOOD.some(g => t.includes(g))) return;
          list.push({ el, area: rect.width * rect.height, t });
        } catch {}
      });
      if (!list.length) return null;
      list.sort((a, b) => b.area - a.area);
      list[0].el.scrollIntoView({ block: "center", behavior: "instant" });
      list[0].el.click();
      return list[0].t;
    });
  }

  try {
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");
    await page.setViewport({ width: 1366, height: 768 });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    await sleep(${isLV ? 5000 : 6500});

    for (let i = 0; i < 8; i++) {
      const c = await clickOne();
      if (c) console.log("[click]", c);
      await sleep(2800);
      let cur = page.url();
      if (isLegal(cur)) { try { await page.goBack({ waitUntil: "domcontentloaded", timeout: 5000 }); } catch {} await sleep(2000); continue; }
      if (!isWrapped(cur)) return { url: cur, status: "resolved" };
    }

    await sleep(4000);
    const finalUrl = page.url();
    if (!isWrapped(finalUrl) && !isLegal(finalUrl)) return { url: finalUrl, status: "resolved" };
    return { url: finalUrl, status: "still_wrapped" };
  } catch (e) {
    return { url: url, status: "error", error: String(e.message || e) };
  }
}`;

      const r = await fetch(BROWSERLESS_URL + "?token=" + BROWSERLESS_TOKEN + "&timeout=45000", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: browserScript, context: { url: link } }),
      });

      if (r.ok) {
        const d = await r.json();
        if (isClean(d && d.url)) return res.status(200).json({ result: d.url, source: "browserless" });
      }
    } catch (e) { console.error("Browserless:", e); }

    try {
      const r = await fetch(link, { method: "HEAD", redirect: "manual", headers: { "User-Agent": UA } });
      const loc = r.headers.get("location");
      if (loc && loc.startsWith("http") && loc !== link && isClean(loc)) {
        return res.status(200).json({ result: loc, source: "redirect" });
      }
    } catch {}

    res.status(200).json({ result: link, source: "original", warning: "Klik bypass lagi." });
    return;
  }

  res.setHeader("Content-Type","text/html; charset=utf-8");
  res.status(200).send(mainPage(WA_NUMBER));
}

function authPage(data, valid, username) {
  const key = data.k, uid = data.u, exp = data.e;
  const now = Math.floor(Date.now()/1000);
  const left = Math.max(0, exp-now);
  const hours = Math.floor(left/3600);
  const mins = Math.floor((left%3600)/60);
  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NANG Auth</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#05050b;color:#f0f0f8;font-family:'Inter',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;position:relative;overflow:hidden}
body::before{content:'';position:fixed;inset:0;pointer-events:none;background:radial-gradient(circle at 15% 20%,rgba(224,60,138,0.15),transparent 45%),radial-gradient(circle at 85% 80%,rgba(155,77,224,0.15),transparent 45%);z-index:0}
.card{background:linear-gradient(135deg,rgba(15,15,26,0.95),rgba(10,10,20,0.95));border:1px solid rgba(255,255,255,0.1);border-radius:24px;padding:36px 30px;max-width:460px;width:100%;position:relative;overflow:hidden;backdrop-filter:blur(12px);box-shadow:0 20px 60px rgba(0,0,0,0.5);z-index:1;animation:pop .4s cubic-bezier(.4,0,.2,1)}
@keyframes pop{from{opacity:0;transform:scale(0.94)}to{opacity:1;transform:scale(1)}}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#e03c8a,#9b4de0,#00d4ff,transparent)}
.brand{text-align:center;margin-bottom:28px}
.logo{font-size:2rem;font-weight:900;letter-spacing:-1px;background:linear-gradient(135deg,#ff5fa8,#e03c8a,#9b4de0,#00d4ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;filter:drop-shadow(0 0 20px rgba(224,60,138,0.35))}
.status{display:inline-flex;align-items:center;gap:6px;font-size:.72rem;font-weight:800;padding:5px 14px;border-radius:20px;margin-top:12px;letter-spacing:1px}
.status.ok{background:rgba(0,232,122,0.12);color:#00e87a;border:1px solid rgba(0,232,122,0.35)}
.status.err{background:rgba(255,80,80,0.12);color:#ff6b6b;border:1px solid rgba(255,80,80,0.35)}
.status .dot{width:6px;height:6px;border-radius:50%;background:currentColor;box-shadow:0 0 8px currentColor;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
.info-row{display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:.88rem;gap:14px}
.info-row:last-of-type{border-bottom:none}
.info-label{color:#8b8ba8;font-weight:600;flex-shrink:0}
.info-value{color:#f0f0f8;font-weight:700;text-align:right;word-break:break-all;font-family:'JetBrains Mono',monospace;font-size:.85rem}
.key-box{background:rgba(0,0,0,0.5);border:1px solid rgba(224,60,138,0.35);border-radius:16px;padding:24px 20px;margin-top:24px;text-align:center;position:relative;overflow:hidden}
.key-box::before{content:'';position:absolute;inset:0;background:radial-gradient(circle at 50% 0%,rgba(224,60,138,0.15),transparent 60%);pointer-events:none}
.key-label{font-size:.68rem;color:#8b8ba8;font-weight:800;letter-spacing:2px;text-transform:uppercase;margin-bottom:14px;position:relative}
.key-value{font-family:'JetBrains Mono',monospace;font-size:1.25rem;font-weight:800;color:#00e87a;letter-spacing:1px;word-break:break-all;line-height:1.6;position:relative;text-shadow:0 0 20px rgba(0,232,122,0.3)}
.copy-btn{width:100%;margin-top:18px;padding:14px;background:linear-gradient(135deg,#e03c8a,#9b4de0);color:#fff;border:none;border-radius:12px;font-weight:800;font-size:.92rem;cursor:pointer;font-family:inherit;letter-spacing:0.5px;transition:all .2s;box-shadow:0 8px 24px rgba(224,60,138,0.35);position:relative}
.copy-btn:hover{transform:translateY(-1px);box-shadow:0 12px 32px rgba(224,60,138,0.5)}
.copy-btn.copied{background:linear-gradient(135deg,#00b866,#00e87a);color:#001018;box-shadow:0 8px 24px rgba(0,232,122,0.4)}
.notice{margin-top:22px;padding:14px;background:rgba(0,0,0,0.35);border-radius:12px;font-size:.75rem;color:#8b8ba8;line-height:1.8;text-align:center;border:1px solid rgba(255,255,255,0.06)}
.notice b{color:#f0f0f8;font-weight:700}
</style></head><body>
<div class="card">
<div class="brand"><div class="logo">NANG AUTH</div><div class="status ${valid?'ok':'err'}"><span class="dot"></span>${valid?'VALID':'EXPIRED'}</div></div>
<div class="info-row"><span class="info-label">Username</span><span class="info-value">${username||"Unknown"}</span></div>
<div class="info-row"><span class="info-label">User ID</span><span class="info-value">${uid}</span></div>
<div class="info-row"><span class="info-label">Berlaku</span><span class="info-value">${hours}j ${mins}m</span></div>
<div class="key-box"><div class="key-label">Your Key</div><div class="key-value" id="keyText">${key}</div><button class="copy-btn" id="copyBtn" onclick="copyKey()">SALIN KEY</button></div>
<div class="notice">Copy key → paste di <b>popup script NANG</b> → VERIFIKASI</div>
</div>
<script>
function copyKey(){const t=document.getElementById('keyText').textContent;navigator.clipboard.writeText(t).then(()=>{const b=document.getElementById('copyBtn');b.textContent='✓ TERSALIN!';b.classList.add('copied');setTimeout(()=>{b.textContent='SALIN KEY';b.classList.remove('copied');},1800);});}
</script></body></html>`;
}

function mainPage(wa) {
  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NANG Key System</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
:root{
  --pink:#e03c8a;--pink2:#ff5fa8;--purple:#9b4de0;--purple2:#b070f0;
  --cyan:#00d4ff;--green:#00e87a;--red:#ff5566;
  --bg:#05050b;--bg1:#0a0a14;--bg2:#0f0f1a;--bg3:#16162a;--bg4:#1e1e38;
  --border:#ffffff10;--border2:#ffffff18;
  --text:#f0f0f8;--muted:#8b8ba8;--dim:#5a5a78;
}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--text);font-family:'Inter',system-ui,sans-serif;min-height:100vh;overflow-x:hidden;position:relative}
body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:0;background:radial-gradient(circle at 15% 20%,rgba(224,60,138,0.15),transparent 45%),radial-gradient(circle at 85% 80%,rgba(155,77,224,0.15),transparent 45%),radial-gradient(circle at 50% 50%,rgba(0,212,255,0.05),transparent 60%)}
body::after{content:'';position:fixed;inset:0;pointer-events:none;z-index:0;opacity:0.03;background-image:linear-gradient(rgba(255,255,255,0.5) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.5) 1px,transparent 1px);background-size:40px 40px}
.wrap{position:relative;z-index:1;max-width:520px;margin:0 auto;padding:32px 18px 60px}
.hero{text-align:center;padding:12px 0 28px;position:relative}
.hero-orb{position:absolute;top:-40px;left:50%;transform:translateX(-50%);width:280px;height:180px;border-radius:50%;background:radial-gradient(ellipse at center,rgba(224,60,138,0.35),transparent 70%);filter:blur(30px);pointer-events:none}
.logo-wrap{display:inline-flex;align-items:center;gap:10px;position:relative}
.logo{font-size:3rem;font-weight:900;letter-spacing:-2px;line-height:0.9;background:linear-gradient(135deg,#ff5fa8 0%,#e03c8a 25%,#9b4de0 60%,#00d4ff 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;filter:drop-shadow(0 0 20px rgba(224,60,138,0.4))}
.logo-badge{display:inline-block;padding:4px 10px;border-radius:8px;background:linear-gradient(135deg,var(--pink),var(--purple));color:#fff;font-size:0.65rem;font-weight:900;letter-spacing:2px;box-shadow:0 4px 15px rgba(224,60,138,0.4);transform:rotate(-3deg)}
.tagline{color:var(--muted);font-size:0.82rem;margin-top:14px;letter-spacing:0.5px;font-weight:500}
.status-row{display:flex;justify-content:center;gap:8px;margin-top:14px;flex-wrap:wrap}
.pill{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:20px;background:rgba(255,255,255,0.04);border:1px solid var(--border2);font-size:0.7rem;font-weight:600;color:var(--muted)}
.pill .dot{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
.nav{display:flex;gap:4px;padding:5px;margin:24px auto 20px;background:linear-gradient(135deg,rgba(15,15,26,0.9),rgba(22,22,42,0.9));border:1px solid var(--border2);border-radius:16px;backdrop-filter:blur(12px);box-shadow:0 8px 32px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.05)}
.nav-btn{flex:1;padding:12px 8px;border:none;border-radius:12px;cursor:pointer;font-size:0.82rem;font-weight:700;background:transparent;color:var(--muted);font-family:inherit;transition:all .25s cubic-bezier(.4,0,.2,1);letter-spacing:0.3px}
.nav-btn:hover:not(.active){color:var(--text)}
.nav-btn.active{color:#fff;background:linear-gradient(135deg,var(--pink),var(--purple));box-shadow:0 4px 20px rgba(224,60,138,0.4)}
.panel{width:100%;display:none;animation:fadeUp .35s cubic-bezier(.4,0,.2,1)}
.panel.active{display:block}
@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.card{background:linear-gradient(135deg,rgba(15,15,26,0.95),rgba(10,10,20,0.95));border:1px solid var(--border2);border-radius:20px;padding:22px;margin-bottom:14px;position:relative;overflow:hidden;backdrop-filter:blur(12px);box-shadow:0 4px 24px rgba(0,0,0,0.35),inset 0 1px 0 rgba(255,255,255,0.03)}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(224,60,138,0.6),rgba(155,77,224,0.6),transparent)}
.card-title{font-size:0.72rem;font-weight:800;color:var(--text);text-transform:uppercase;letter-spacing:2px;margin-bottom:16px;display:flex;align-items:center;gap:8px}
.card-title .bar{width:3px;height:14px;background:linear-gradient(180deg,var(--pink),var(--purple));border-radius:2px}
.qr-wrap{display:flex;gap:16px;align-items:flex-start;margin-bottom:16px}
.qr-img{width:112px;height:112px;border-radius:14px;border:1px solid var(--border2);object-fit:cover;flex-shrink:0;box-shadow:0 4px 20px rgba(224,60,138,0.15);background:var(--bg3)}
.qr-img-placeholder{width:112px;height:112px;border-radius:14px;border:1.5px dashed var(--border2);display:flex;align-items:center;justify-content:center;color:var(--dim);font-size:0.7rem;text-align:center;flex-shrink:0;line-height:1.6;background:var(--bg3)}
.qr-info{flex:1;min-width:0}
.price-badge{display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,rgba(0,232,122,0.15),rgba(0,212,255,0.1));border:1px solid rgba(0,232,122,0.35);border-radius:10px;padding:7px 12px;font-size:0.9rem;font-weight:800;color:var(--green);margin-bottom:10px;letter-spacing:0.3px}
.qr-steps{font-size:0.76rem;color:var(--muted);line-height:1.9}
.qr-steps span{color:var(--text);font-weight:600}
.fmt-box{background:rgba(0,0,0,0.35);border:1px solid var(--border);border-radius:12px;padding:14px;font-size:0.76rem;color:var(--muted);line-height:2;margin-bottom:14px}
.fmt-box .label{color:var(--pink2);font-weight:700;letter-spacing:0.5px}
.fmt-box .field{color:var(--text);font-weight:600}
.fmt-box .field.highlight{color:var(--cyan)}
.wa-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:15px;background:linear-gradient(135deg,#25d366,#128c7e);color:#fff;border:none;border-radius:14px;font-size:0.95rem;font-weight:800;cursor:pointer;text-decoration:none;font-family:inherit;letter-spacing:0.3px;box-shadow:0 8px 24px rgba(37,211,102,0.3);transition:all .2s}
.wa-btn:active{transform:scale(0.98)}
.wa-btn:hover{box-shadow:0 12px 32px rgba(37,211,102,0.45)}
.wa-icon{width:20px;height:20px;fill:#fff}
.inp{width:100%;padding:14px 16px;background:rgba(0,0,0,0.4);border:1px solid var(--border2);border-radius:12px;color:var(--text);font-size:0.9rem;outline:none;margin-bottom:12px;font-family:inherit;transition:all .2s;font-weight:500}
.inp:focus{border-color:var(--pink);box-shadow:0 0 0 3px rgba(224,60,138,0.15);background:rgba(0,0,0,0.5)}
.inp::placeholder{color:var(--dim);font-weight:400}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:14px;border:none;border-radius:12px;font-weight:800;font-size:0.9rem;cursor:pointer;font-family:inherit;letter-spacing:0.3px;transition:all .2s}
.btn:active{transform:scale(0.98)}
.btn-main{background:linear-gradient(135deg,var(--pink),var(--purple));color:#fff;box-shadow:0 8px 24px rgba(224,60,138,0.3)}
.btn-main:hover{box-shadow:0 12px 32px rgba(224,60,138,0.45)}
.btn-cyan{background:linear-gradient(135deg,#0088bb,var(--cyan));color:#001018;box-shadow:0 8px 24px rgba(0,212,255,0.3);font-weight:900}
.btn-cyan:hover{box-shadow:0 12px 32px rgba(0,212,255,0.5)}
.btn-green{background:linear-gradient(135deg,#00b866,var(--green));color:#001018;box-shadow:0 6px 18px rgba(0,232,122,0.3);font-weight:900}
.btn-green:hover{box-shadow:0 10px 28px rgba(0,232,122,0.5)}
.result{background:rgba(0,0,0,0.4);border:1px solid var(--border);border-radius:12px;padding:14px;font-size:0.8rem;margin-top:12px;display:none;word-break:break-all;line-height:1.7;animation:fadeUp .3s}
.result.ok{border-color:rgba(0,232,122,0.4);color:var(--green);background:rgba(0,232,122,0.05)}
.result.err{border-color:rgba(255,80,80,0.4);color:var(--red);background:rgba(255,80,80,0.05)}
.result.warn{border-color:rgba(255,200,50,0.4);color:#ffc832;background:rgba(255,200,50,0.05)}
.result .key-line{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:0.92rem;color:var(--green);font-weight:700;margin:8px 0;padding:10px;background:rgba(0,0,0,0.5);border-radius:8px;word-break:break-all;border:1px solid rgba(0,232,122,0.15)}
.result .link-line{font-family:'JetBrains Mono',monospace;font-size:0.72rem;color:var(--cyan);word-break:break-all;padding:8px;background:rgba(0,0,0,0.5);border-radius:8px;display:block;text-decoration:none;border:1px solid rgba(0,212,255,0.15);margin:8px 0;transition:all .2s}
.result .link-line:hover{background:rgba(0,212,255,0.08);border-color:rgba(0,212,255,0.3)}
.user-card{display:flex;align-items:center;gap:12px;background:linear-gradient(135deg,rgba(0,232,122,0.08),rgba(0,212,255,0.05));border:1px solid rgba(0,232,122,0.25);border-radius:12px;padding:12px;margin-top:12px;animation:fadeUp .3s}
.user-avatar{width:42px;height:42px;border-radius:10px;background:linear-gradient(135deg,var(--pink),var(--purple));display:flex;align-items:center;justify-content:center;font-weight:900;font-size:1.05rem;color:#fff;flex-shrink:0;box-shadow:0 4px 12px rgba(224,60,138,0.4)}
.user-info{flex:1;min-width:0}
.user-name{font-weight:800;font-size:0.92rem;color:var(--text)}
.user-id{font-size:0.72rem;color:var(--muted);margin-top:2px;font-family:monospace}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
.tag{background:linear-gradient(135deg,rgba(0,212,255,0.08),rgba(155,77,224,0.08));color:var(--cyan);font-size:0.7rem;font-weight:700;padding:5px 11px;border-radius:20px;border:1px solid rgba(0,212,255,0.2);letter-spacing:0.3px}
.spinner{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.15);border-top-color:var(--pink);border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:8px}
@keyframes spin{to{transform:rotate(360deg)}}
footer{margin-top:36px;text-align:center;color:var(--dim);font-size:0.72rem;letter-spacing:0.5px;font-weight:500}
footer .heart{color:var(--pink)}
#ownerFab{position:fixed;bottom:22px;right:22px;width:48px;height:48px;border-radius:14px;background:linear-gradient(135deg,var(--pink),var(--purple));display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 8px 24px rgba(224,60,138,0.5);font-size:20px;user-select:none;opacity:0.4;transition:all .25s;z-index:50}
#ownerFab:hover,#ownerFab:active{opacity:1;transform:scale(1.05)}
#genPanel{position:fixed;inset:0;background:rgba(0,0,0,0.75);display:none;align-items:center;justify-content:center;z-index:100;padding:20px;backdrop-filter:blur(6px)}
#genPanel.show{display:flex;animation:fadeUp .25s}
#genPanel .box{background:linear-gradient(135deg,var(--bg2),var(--bg1));border:1px solid rgba(224,60,138,0.4);border-radius:20px;padding:28px;max-width:400px;width:100%;position:relative;box-shadow:0 20px 60px rgba(0,0,0,0.6),0 0 40px rgba(224,60,138,0.15);animation:popIn .3s cubic-bezier(.4,0,.2,1)}
@keyframes popIn{from{opacity:0;transform:scale(0.9)}to{opacity:1;transform:scale(1)}}
#genPanel h3{font-size:1.1rem;font-weight:900;margin-bottom:18px;background:linear-gradient(135deg,var(--pink),var(--purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;display:flex;align-items:center;gap:8px}
#genPanel h3::before{content:'🔒';font-size:1rem;-webkit-text-fill-color:initial}
#genPanel .close{position:absolute;top:16px;right:18px;cursor:pointer;color:var(--muted);font-size:24px;line-height:1;transition:color .2s;user-select:none}
#genPanel .close:hover{color:var(--pink)}
@media(max-width:480px){
  .wrap{padding:20px 14px 40px}
  .logo{font-size:2.4rem}
  .card{padding:18px}
  .qr-img,.qr-img-placeholder{width:96px;height:96px}
  .price-badge{font-size:0.82rem;padding:6px 10px}
  #ownerFab{width:42px;height:42px;bottom:16px;right:16px}
}
</style></head><body>
<div class="wrap">
  <div class="hero">
    <div class="hero-orb"></div>
    <div class="logo-wrap"><span class="logo">NANG</span><span class="logo-badge">KEY</span></div>
    <div class="tagline">Premium Roblox Script Access</div>
    <div class="status-row">
      <span class="pill"><span class="dot"></span>System Online</span>
      <span class="pill">24h Access</span>
      <span class="pill">Instant Delivery</span>
    </div>
  </div>

  <div class="nav">
    <button class="nav-btn active" onclick="switchTab(0)">🛒 Beli Key</button>
    <button class="nav-btn" onclick="switchTab(1)">⚡ Bypass</button>
  </div>

  <div class="panel active" id="tab0">
    <div class="card">
      <div class="card-title"><span class="bar"></span>Pembayaran QRIS</div>
      <div class="qr-wrap">
        <img src="/qr.png" class="qr-img" alt="QR" onerror="this.outerHTML='<div class=qr-img-placeholder>QR<br>belum<br>tersedia</div>'">
        <div class="qr-info">
          <div class="price-badge">💰 Rp 500 / Key</div>
          <div class="qr-steps">
            ① Scan QR di kiri<br>
            ② Transfer <span>Rp 500</span><br>
            ③ Chat WA owner<br>
            ④ Key otomatis dikirim
          </div>
        </div>
      </div>
      <div class="fmt-box">
        <span class="label">Format WA:</span><br>
        <span class="field">Beli Key NANG</span><br>
        Nama: <span class="field highlight" id="waNama">[isi di bawah]</span><br>
        Roblox ID: <span class="field highlight" id="waUid">[isi di bawah]</span><br>
        Bukti TF: <span class="field">[screenshot]</span>
      </div>
      <a href="https://wa.me/${wa}?text=Beli%20Key%20NANG" class="wa-btn" id="waBtn" target="_blank">
        <svg class="wa-icon" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347"/></svg>
        Chat WhatsApp Owner
      </a>
    </div>
    <div class="card">
      <div class="card-title"><span class="bar"></span>Cek Username Roblox</div>
      <input type="text" class="inp" id="lookupId" placeholder="Masukkan Roblox User ID..." inputmode="numeric">
      <button class="btn btn-main" onclick="doLookup()">🔍 Cek Username</button>
      <div id="lookupResult"></div>
    </div>
  </div>

  <div class="panel" id="tab1">
    <div class="card">
      <div class="card-title"><span class="bar"></span>Bypass Shortlink</div>
      <div class="tags">
        <span class="tag">Linkvertise</span><span class="tag">Work.ink</span><span class="tag">Sub2Unlock</span>
        <span class="tag">Playrole</span><span class="tag">LootLabs</span><span class="tag">Platorelay</span>
      </div>
      <input type="text" class="inp" id="bypassUrl" placeholder="Paste link shortlink di sini...">
      <button class="btn btn-cyan" onclick="doBypass()">⚡ Bypass Sekarang</button>
      <div class="result" id="bypassResult"></div>
    </div>
  </div>

  <footer>NANG RBXM Tool &copy; 2025 &middot; Made with <span class="heart">♥</span></footer>
</div>

<div id="ownerFab" onclick="openGen()" title="Owner Only">🔒</div>
<div id="genPanel">
  <div class="box">
    <span class="close" onclick="closeGen()">&times;</span>
    <h3>Owner Panel</h3>
    <input type="password" class="inp" id="genPw" placeholder="Password owner...">
    <button class="btn btn-main" onclick="doLogin()">Login</button>
    <div id="genForm" style="display:none;margin-top:16px">
      <input type="text" class="inp" id="genUid" placeholder="Roblox User ID..." inputmode="numeric">
      <button class="btn btn-green" onclick="doGenerate()">Generate Key</button>
      <div class="result" id="genResult"></div>
    </div>
  </div>
</div>

<script>
const WA_NUMBER="${wa}";
let lastLookup={uid:null,name:null};
let ownerPw=null;
function switchTab(i){
  document.querySelectorAll('.nav-btn').forEach((b,j)=>b.classList.toggle('active',i===j));
  document.querySelectorAll('.panel').forEach((p,j)=>p.classList.toggle('active',i===j));
}
function updateWA(){
  if(!lastLookup.name)return;
  const text="Beli Key NANG%0ANama: "+encodeURIComponent(lastLookup.name)+"%0ARoblox ID: "+lastLookup.uid+"%0ABukti TF: [screenshot]";
  document.getElementById('waBtn').href="https://wa.me/"+WA_NUMBER+"?text="+text;
  document.getElementById('waNama').textContent=lastLookup.name;
  document.getElementById('waUid').textContent=lastLookup.uid;
}
async function doLookup(){
  const uid=document.getElementById('lookupId').value.trim();
  const box=document.getElementById('lookupResult');
  if(!uid)return;
  box.style.display='block';box.className='result';
  box.innerHTML='<span class="spinner"></span>Mencari...';
  try{
    const r=await fetch('/?lookup='+encodeURIComponent(uid));
    const d=await r.json();
    if(d.name){
      lastLookup={uid:d.uid,name:d.name};updateWA();
      box.style.display='none';
      const existing=document.getElementById('userCard');
      if(existing)existing.remove();
      const card=document.createElement('div');
      card.id='userCard';
      card.className='user-card';
      card.innerHTML='<div class="user-avatar">'+d.name.charAt(0).toUpperCase()+'</div><div class="user-info"><div class="user-name">'+d.name+'</div><div class="user-id">ID: '+d.uid+'</div></div>';
      box.parentNode.insertBefore(card,box.nextSibling);
    }else{
      box.className='result err';
      box.innerHTML='❌ User ID tidak ditemukan';
    }
  }catch(e){
    box.className='result err';
    box.innerHTML='❌ Error: '+e.message;
  }
}
let lookupT;
document.getElementById('lookupId').addEventListener('input',()=>{
  clearTimeout(lookupT);lookupT=setTimeout(doLookup,600);
});
function openGen(){document.getElementById('genPanel').classList.add('show');}
function closeGen(){
  document.getElementById('genPanel').classList.remove('show');
  document.getElementById('genPw').value='';
  document.getElementById('genForm').style.display='none';
  document.getElementById('genResult').style.display='none';
  ownerPw=null;
  document.getElementById('genPw').disabled=false;
}
document.getElementById('genPanel').addEventListener('click',(e)=>{
  if(e.target.id==='genPanel')closeGen();
});
async function doLogin(){
  const pw=document.getElementById('genPw').value;
  if(!pw)return;
  try{
    const r=await fetch('/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'generate',pw:pw,uid:'1'})});
    const d=await r.json();
    if(d.error==='password salah'){
      document.getElementById('genPw').value='';
      document.getElementById('genPw').placeholder='password salah';
    }else if(d.ok){
      ownerPw=pw;
      document.getElementById('genForm').style.display='block';
      document.getElementById('genPw').disabled=true;
    }
  }catch(e){}
}
async function doGenerate(){
  const uid=document.getElementById('genUid').value.trim();
  const box=document.getElementById('genResult');
  if(!uid||!ownerPw)return;
  box.style.display='block';box.className='result';
  box.innerHTML='<span class="spinner"></span>Generating...';
  try{
    const r=await fetch('/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'generate',pw:ownerPw,uid:uid})});
    const d=await r.json();
    if(d.ok){
      box.className='result ok';
      box.innerHTML='<b>Username:</b> '+(d.username||'Unknown')+
        '<div class="key-line">'+d.key+'</div>'+
        '<b style="color:#6b6b8a;font-size:.72rem">Auth Link:</b>'+
        '<a href="'+d.authLink+'" target="_blank" class="link-line">'+d.authLink+'</a>'+
        '<button class="btn btn-green" onclick="navigator.clipboard.writeText(\\''+d.key+'\\');this.textContent=\\'✓ COPIED\\';setTimeout(()=>this.textContent=\\'COPY KEY\\',1500)">COPY KEY</button>';
    }else{
      box.className='result err';
      box.innerHTML=d.error||'Gagal';
    }
  }catch(e){
    box.className='result err';
    box.innerHTML='Error: '+e.message;
  }
}
async function doBypass(){
  const link=document.getElementById('bypassUrl').value.trim();
  const box=document.getElementById('bypassResult');
  if(!link)return;
  box.style.display='block';box.className='result';
  box.innerHTML='<span class="spinner"></span>Memproses (20-30 detik)...';
  try{
    const r=await fetch('/?bypass='+encodeURIComponent(link));
    const d=await r.json();
    if(d.result){
      const url=d.result;
      window._bypassUrl=url;
      const cls=d.source==='original'?'warn':'ok';
      box.className='result '+cls;
      let label='✅ Bypass berhasil!';
      if(d.source==='original')label='⚠ Belum selesai — klik bypass lagi:';
      const src=d.source?'<div style="font-size:.7rem;color:#6b6b8a;margin-top:4px">via '+d.source+'</div>':'';
      box.innerHTML=label+src+
        '<div class="key-line"><a href="'+url+'" target="_blank" style="color:#00d4ff;text-decoration:none">'+url+'</a></div>'+
        (d.source!=='original'?'<button class="btn btn-green" onclick="navigator.clipboard.writeText(window._bypassUrl);this.textContent=\\'✓ COPIED\\';setTimeout(()=>this.textContent=\\'COPY LINK\\',1500)">COPY LINK</button>':'')+
        (d.warning?'<div style="font-size:.72rem;color:#ffc832;margin-top:8px">'+d.warning+'</div>':'');
    }else{
      box.className='result err';
      box.innerHTML='❌ '+(d.error||'Bypass gagal.');
    }
  }catch(e){
    box.className='result err';
    box.innerHTML='❌ Error: '+e.message;
  }
}
</script></body></html>`;
}
