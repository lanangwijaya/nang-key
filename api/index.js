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

    // ── RBXL/RBXLX Import ──
    if (path === "/rbxl" || path === "/rbxl/") {
      try {
        // Parse XML RBXLX → simplified JSON tree
        function parseRbxlx(xml) {
          function getAttr(tag, attr) {
            const m = tag.match(new RegExp(attr + '=["\']([^"\']*)["\']'));
            return m ? m[1] : "";
          }
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
            // Parse properties block
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
            // Parse children
            const children = [];
            const childRe = /<Item class="[^"]*"[\s\S]*?<\/Item>/g;
            // Remove properties block first to avoid false matches
            const withoutProps = itemXml.replace(/<Properties>[\s\S]*?<\/Properties>/, "");
            let cm;
            while ((cm = childRe.exec(withoutProps)) !== null) {
              const child = parseItem(cm[0]);
              if (child) children.push(child);
            }
            return { class: className, properties: props, children };
          }
          // Get top-level Items
          const items = [];
          const topRe = /<Item class="[^"]*"[\s\S]*?<\/Item>/g;
          // Remove roblox wrapper
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

  // ═══ BYPASS ═══
  if (params.has("bypass")) {
    const link = params.get("bypass");
    if (!link) { res.status(200).json({ error: "no link" }); return; }
    const low = link.toLowerCase();
    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36";
    const isCleanUrl = (u) => u && typeof u === "string" && u.startsWith("http") &&
      !["lootlabs","lootlinks","lootdest","platorelay","linkvertise","work.ink","sub2unlock","sub2get","playrole"].some(s => u.toLowerCase().includes(s));
    const needBrowser = low.includes("lootlabs") || low.includes("lootlinks") || low.includes("lootdest") || low.includes("platorelay") || low.includes("linkvertise") || low.includes("work.ink") || low.includes("sub2unlock") || low.includes("sub2get") || low.includes("playrole");

    // ── LAYER 0: Dedicated API per platform (tercepat) ──
    // Linkvertise → bypassall.lol
    if (low.includes("linkvertise") || low.includes("work.ink")) {
      try {
        const r = await fetch("https://bypassall.lol/api/bypass?url=" + encodeURIComponent(link), {
          headers: { "User-Agent": UA }
        });
        if (r.ok) {
          const d = await r.json();
          const result = d.destination || d.result || d.url || d.bypassed;
          if (isCleanUrl(result)) { res.status(200).json({ result, source: "bypassall" }); return; }
        }
      } catch {}
      // Fallback: bypass.bot for linkvertise
      try {
        const r = await fetch("https://bypass.bot.nu/bypass?url=" + encodeURIComponent(link), {
          headers: { "User-Agent": UA }
        });
        if (r.ok) {
          const d = await r.json();
          const result = d.result || d.destination || d.url;
          if (isCleanUrl(result)) { res.status(200).json({ result, source: "bypass.bot" }); return; }
        }
      } catch {}
      // Fallback: linklm.com bypass API
      try {
        const r = await fetch("https://linklm.com/api/bypass?url=" + encodeURIComponent(link), {
          headers: { "User-Agent": UA, "Accept": "application/json" }
        });
        if (r.ok) {
          const d = await r.json();
          const result = d.result || d.destination || d.url || d.data;
          if (isCleanUrl(result)) { res.status(200).json({ result, source: "linklm" }); return; }
        }
      } catch {}
    }

    // LAYER 1: Browserless
    if (needBrowser) {
      try {
        const r = await fetch(BROWSERLESS_URL + "?token=" + BROWSERLESS_TOKEN + "&timeout=90000", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: `export default async function ({ page, context }) {
              const startUrl = context.url;
              const low = startUrl.toLowerCase();
              const isPlatorelay = low.includes("platorelay");
              const isLoot = low.includes("lootlabs") || low.includes("lootlinks") || low.includes("lootdest");
              const isLinkvertise = low.includes("linkvertise") || low.includes("work.ink");
              const isWrapped = (u) => ["platorelay","lootlabs","lootlinks","lootdest","linkvertise","work.ink","sub2unlock","sub2get","playrole"].some(s => u.toLowerCase().includes(s));
              function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
              async function clickButtons(pg) {
                return pg.evaluate(() => {
                  let clicked = 0;
                  const els = document.querySelectorAll("button, a, [role='button'], [onclick], input[type='submit'], input[type='button']");
                  els.forEach(el => {
                    if (el.disabled) return;
                    const style = window.getComputedStyle(el);
                    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
                    const t = (el.textContent || el.value || "").toLowerCase().trim();
                    const patterns = ["continue","get link","unlock","proceed","go to link","visit","lanjut","claim","get","next","done","finish","complete","open","dapatkan","klik di sini","klik","click here","access","go","enter"];
                    if (patterns.some(p => t.includes(p))) {
                      try { el.click(); clicked++; } catch {}
                    }
                  });
                  return clicked;
                });
              }
              async function skipCountdown(pg) {
                // Try to force-skip timers by overriding setTimeout/setInterval on the page
                await pg.evaluate(() => {
                  try {
                    // Override timers to expire immediately
                    const orig = window.setTimeout;
                    window.setTimeout = (fn, delay, ...args) => orig(fn, Math.min(delay || 0, 100), ...args);
                    window.setInterval = (fn, delay, ...args) => {
                      const id = orig(fn, Math.min(delay || 0, 100), ...args);
                      return id;
                    };
                    // Try to find and click hidden/disabled buttons that become enabled after countdown
                    document.querySelectorAll("button[disabled], a.disabled, .btn-disabled, [data-countdown]").forEach(el => {
                      try {
                        el.disabled = false;
                        el.classList.remove('disabled');
                        el.removeAttribute('disabled');
                        el.click();
                      } catch {}
                    });
                    // platorelay specific: look for countdown containers and remove them
                    document.querySelectorAll("[id*='countdown'], [class*='countdown'], [id*='timer'], [class*='timer'], [id*='wait'], [class*='wait']").forEach(el => {
                      try { el.style.display = 'none'; el.remove(); } catch {}
                    });
                  } catch {}
                });
              }
              async function grabFinalUrl(pg) {
                const cur = pg.url();
                if (!isWrapped(cur)) return cur;
                // Try to find destination link in DOM
                const found = await pg.evaluate(() => {
                  const selectors = [
                    "a[href^='http']:not([href*='platorelay']):not([href*='lootlabs']):not([href*='lootlinks']):not([href*='linkvertise']):not([href*='work.ink']):not([href*='sub2unlock']):not([href*='playrole']):not([href*='google']):not([href*='cloudflare']):not([href*='discord']):not([href*='facebook']):not([href*='twitter']):not([href*='t.co'])",
                    "[data-url]", "[data-href]", "[data-link]", "input[type='hidden'][name*='url']", "input[type='hidden'][name*='link']"
                  ];
                  for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el) {
                      const v = el.href || el.getAttribute("data-url") || el.getAttribute("data-href") || el.getAttribute("data-link") || el.value || "";
                      if (v && v.startsWith("http")) return v;
                    }
                  }
                  // Check page source for redirect patterns
                  const scripts = [...document.querySelectorAll("script")].map(s => s.textContent || "").join(" ");
                  const m = scripts.match(/(?:redirect|destination|final_url|target_url|go_url)['":\\s]+["'](https?:\/\/[^"']+)/i);
                  if (m) return m[1];
                  return null;
                });
                return found || cur;
              }
              try {
                await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");
                await page.setViewport({ width: 1366, height: 768 });
                // Block ads/tracking to speed up
                await page.setRequestInterception(true);
                page.on("request", req => {
                  const url = req.url().toLowerCase();
                  const blockPatterns = ["google-analytics","googletagmanager","doubleclick","googlesyndication","adsbygoogle","amazon-adsystem","pagead","moatads","adsrvr","advertising","analytics","tracker","hotjar","fbevents","ga.js","gtag","clarity.ms"];
                  if (blockPatterns.some(p => url.includes(p))) { req.abort(); return; }
                  req.continue();
                });
                await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
                await sleep(isLinkvertise ? 5000 : isPlatorelay ? 3000 : 4000);
                if (isPlatorelay) await skipCountdown(page);
                // linkvertise: scroll + wait for the interstitial button
                if (isLinkvertise) {
                  await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight / 2); });
                  await sleep(3000);
                  // Try clicking the "Free Access" / "Continue" / "Visit" button
                  await page.evaluate(() => {
                    document.querySelectorAll("button,a,[role='button']").forEach(el => {
                      const t = (el.textContent || "").toLowerCase();
                      if (t.includes("free access") || t.includes("continue") || t.includes("visit now") || t.includes("get") || t.includes("unlock") || t.includes("proceed")) {
                        try { el.click(); } catch {}
                      }
                    });
                  });
                  await sleep(4000);
                }
                await sleep(1500);
                for (let i = 0; i < 8; i++) {
                  await clickButtons(page);
                  await sleep(i < 3 ? 2000 : 3000);
                  if (isPlatorelay && i % 2 === 1) await skipCountdown(page);
                  const cur = page.url();
                  if (!isWrapped(cur)) break;
                }
                if (isPlatorelay) await sleep(8000);
                await sleep(isLoot ? 6000 : isLinkvertise ? 4000 : 3000);
                const finalUrl = await grabFinalUrl(page);
                const isCleaned = !isWrapped(finalUrl);
                return { url: finalUrl, status: isCleaned ? "resolved" : "still_wrapped" };
              } catch (e) {
                return { url: startUrl, status: "error", error: String(e.message || e) };
              }
            }`,
            context: { url: link },
          }),
        });
        if (r.ok) {
          const d = await r.json();
          const isClean = (u) => u && typeof u === "string" && u.startsWith("http") && !u.includes("lootlabs") && !u.includes("lootlinks") && !u.includes("lootdest") && !u.includes("platorelay") && !u.includes("linkvertise") && !u.includes("work.ink") && !u.includes("sub2unlock") && !u.includes("sub2get") && !u.includes("playrole");
          if (isClean(d && d.url)) {
            res.status(200).json({ result: d.url, source: "browserless" });
            return;
          }
          // Auto-retry sekali lagi kalau masih wrapped
          if (d && (d.status === "still_wrapped" || d.status === "error")) {
            try {
              const r2 = await fetch(BROWSERLESS_URL + "?token=" + BROWSERLESS_TOKEN + "&timeout=90000", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: (await (async () => { const prev = await r.clone().text().catch(() => ""); return prev; })()) || JSON.stringify({ code: "", context: { url: link } }),
              }).catch(() => null);
              // Retry dengan request body yang sama
              const body2 = JSON.stringify({
                code: `export default async function({page,context}){const url=context.url;const isPR=url.includes("platorelay");function sleep(ms){return new Promise(r=>setTimeout(r,ms));}try{await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");await page.setViewport({width:1366,height:768});await page.setRequestInterception(true);page.on("request",req=>{const u=req.url().toLowerCase();if(["google-analytics","googlesyndication","adsbygoogle","doubleclick","pagead","hotjar"].some(p=>u.includes(p))){req.abort();return;}req.continue();});await page.goto(url,{waitUntil:"domcontentloaded",timeout:35000});await sleep(5000);await page.evaluate(()=>{try{window.setTimeout=(fn,d,...a)=>window._origST?window._origST(fn,Math.min(d||0,50),...a):fn();document.querySelectorAll("button[disabled],[data-countdown],[class*='countdown'],[class*='timer'],[id*='countdown'],[id*='timer']").forEach(el=>{try{el.disabled=false;el.removeAttribute('disabled');el.classList.remove('disabled');}catch{}});}catch{}});await sleep(2000);for(let i=0;i<10;i++){await page.evaluate(()=>{document.querySelectorAll("button,a,[role='button'],[onclick],input[type='submit']").forEach(el=>{if(el.disabled)return;const s=window.getComputedStyle(el);if(s.display==='none'||s.visibility==='hidden')return;const t=(el.textContent||el.value||"").toLowerCase();if(["continue","get link","unlock","proceed","go to","visit","lanjut","claim","get","next","done","finish","open","dapatkan","klik","access","go","enter"].some(p=>t.includes(p))){try{el.click();}catch{}}});});await sleep(i<5?2000:3500);if(isPR)await page.evaluate(()=>{try{document.querySelectorAll("[class*='countdown'],[class*='timer'],[id*='countdown'],[id*='timer'],[class*='wait']").forEach(el=>{try{el.remove();}catch{}});}catch{}});const cur=page.url();if(!cur.includes("platorelay")&&!cur.includes("lootlabs")&&!cur.includes("lootlinks"))break;}if(isPR)await sleep(10000);const finalUrl=page.url();const isClean=!finalUrl.includes("platorelay")&&!finalUrl.includes("lootlabs")&&!finalUrl.includes("lootlinks");if(isClean)return{url:finalUrl,status:"resolved"};const found=await page.evaluate(()=>{const a=document.querySelector("a[href^='http']:not([href*='platorelay']):not([href*='lootlabs']):not([href*='google']):not([href*='cloudflare']):not([href*='discord'])");return a?a.href:null;});return{url:found||finalUrl,status:found?"resolved":"failed"};}catch(e){return{url:url,status:"error",error:String(e.message||e)};}}`,
                context: { url: link },
              });
              const r2b = await fetch(BROWSERLESS_URL + "?token=" + BROWSERLESS_TOKEN + "&timeout=90000", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: body2,
              });
              if (r2b.ok) {
                const d2 = await r2b.json();
                if (isClean(d2 && d2.url)) {
                  res.status(200).json({ result: d2.url, source: "browserless" });
                  return;
                }
              }
            } catch (e2) { console.error("Browserless retry:", e2); }
          }
          if (d && d.status === "error") console.error("Browserless error:", d.error);
        } else {
          console.error("Browserless HTTP", r.status, (await r.text()).slice(0, 300));
        }
      } catch (e) { console.error("Browserless:", e); }
    }

    // LAYER 2: bypass.vip
    try {
      const r = await fetch("https://api.bypass.vip/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA, "Origin": "https://bypass.vip", "Referer": "https://bypass.vip/" },
        body: "url=" + encodeURIComponent(link),
      });
      if (r.ok) {
        const d = await r.json();
        const result = d.result || d.url || d.destination || d.data;
        if (isCleanUrl(result)) { res.status(200).json({ result, source: "bypass.vip" }); return; }
      }
    } catch {}

    // LAYER 3: bypass.city
    try {
      const r = await fetch("https://api.bypass.city/api/bypass", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA, "Origin": "https://bypass.city", "Referer": "https://bypass.city/" },
        body: JSON.stringify({ url: link }),
      });
      if (r.ok) {
        const d = await r.json();
        const result = d.result || d.destination || d.url || d.data;
        if (isCleanUrl(result)) { res.status(200).json({ result, source: "bypass.city" }); return; }
      }
    } catch {}

    // LAYER 4: BypassKing API
    try {
      const r = await fetch("https://api.bypassking.com/bypass?url=" + encodeURIComponent(link), {
        headers: { "User-Agent": UA }
      });
      if (r.ok) {
        const d = await r.json();
        const result = d.destination || d.result || d.url;
        if (isCleanUrl(result)) { res.status(200).json({ result, source: "bypassking" }); return; }
      }
    } catch {}

    // LAYER 5: HEAD redirect (untuk link simpel)
    if (!needBrowser) {
      try {
        const r = await fetch(link, { method: "HEAD", redirect: "manual", headers: { "User-Agent": UA } });
        const loc = r.headers.get("location");
        if (loc && loc.startsWith("http") && loc !== link) {
          res.status(200).json({ result: loc, source: "redirect" }); return;
        }
      } catch {}
    }

    res.status(200).json({
      result: link,
      source: "original",
      warning: "Bypass gagal semua layer. Coba buka manual.",
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
<div class="nav"><button class="nav-btn active" onclick="switchTab(0)">Beli Key</button><button class="nav-btn" onclick="switchTab(1)">Bypass</button></div>

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
<div class="tags"><span class="tag">Linkvertise</span><span class="tag">Work.ink</span><span class="tag">Sub2Unlock</span><span class="tag">Playrole</span><span class="tag">LootLabs</span><span class="tag">Platorelay</span></div>
<input type="text" class="inp" id="bypassUrl" placeholder="Paste link shortlink di sini...">
<button class="btn-cyan" onclick="doBypass()">Bypass Sekarang</button>
<div class="result" id="bypassResult"></div>
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
async function doBypass(){const link=document.getElementById('bypassUrl').value.trim();const box=document.getElementById('bypassResult');if(!link)return;box.style.display='block';box.className='result';box.innerHTML='<span class="spinner"></span>Memproses (LootLabs/platorelay bisa 20-30 detik)...';try{const r=await fetch('/?bypass='+encodeURIComponent(link));const d=await r.json();if(d.result){const url=d.result;window._bypassUrl=url;const cls=d.source==='browserless'?'ok':(d.source==='original'?'warn':'ok');box.className='result '+cls;let label='Bypass berhasil!';if(d.source==='original')label='Belum selesai — klik bypass lagi:';const src=d.source?'<div style="font-size:.7rem;color:#6b6b8a;margin-top:4px">via '+d.source+'</div>':'';box.innerHTML=label+src+'<div class="key-line"><a href="'+url+'" target="_blank" style="color:#00d4ff;text-decoration:none">'+url+'</a></div>'+(d.source!=='original'?'<button class="btn-green" onclick="navigator.clipboard.writeText(window._bypassUrl);this.textContent=\\'COPIED\\';setTimeout(()=>this.textContent=\\'COPY LINK\\',1500)">COPY LINK</button>':'')+(d.warning?'<div style="font-size:.72rem;color:#ffc832;margin-top:8px">'+d.warning+'</div>':'');}else{box.className='result err';box.innerHTML=d.error||'Bypass gagal.';}}catch(e){box.className='result err';box.innerHTML='Error: '+e.message;}}
</script></body></html>`;
}
