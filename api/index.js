const BUILD = "66.4";

const LINK_PATTERNS = [
  { name: "LootLabs",     match: ["lootlabs","lootlinks","lootdest"],           auto: "low",    note: "Task-wall. Auto-bypass sering gagal." },
  { name: "Platorelay",   match: ["platorelay"],                                  auto: "medium", note: "Keysystem. Auto via API intercept." },
  { name: "Linkvertise",  match: ["linkvertise"],                                 auto: "high",   note: "Auto-bypass via API." },
  { name: "Work.ink",     match: ["work.ink","boost.ink","mboost.me"],            auto: "high",   note: "Auto-bypass via API." },
  { name: "Rekonise",     match: ["rekonise"],                                    auto: "high",   note: "Auto-bypass via API." },
  { name: "Sub2Unlock",   match: ["sub2unlock","sub2get","playrole"],             auto: "low",    note: "Butuh social unlock manual." },
  { name: "SocialWolvez", match: ["socialwolvez","cutsy"],                        auto: "low",    note: "Butuh social unlock manual." },
  { name: "Adf.ly",       match: ["adf.ly","adfoc"],                              auto: "high",   note: "Auto-bypass via redirect." },
  { name: "GPLinks",      match: ["gplinks","gplink","tnlink","tnshort"],         auto: "high",   note: "Auto-bypass via API." },
  { name: "ShrinkMe",     match: ["shrinkme","shrinkearn","shrinkforearn"],       auto: "high",   note: "Auto-bypass via API." },
  { name: "Ouo.io",       match: ["ouo.io","exe.io","fc.lc","ez4short"],          auto: "high",   note: "Auto-bypass via API." },
  { name: "Shortener",    match: ["shorte.st","bc.vc","cutt.ly","tii.ai","linkpoi","clk.sh","clicksfly","droplink","yoshort","spaste","za.gl","za.gd","try2link","kyshort","zshort","gtlink","omg10","weboasi","link1s","linkshortify","arolinks","ez4mod","atglinks","indlink","pndk","ldo.tn","mightytr.ee","urlshort","shortlink"], auto: "high", note: "Auto-bypass via API." },
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

  function simpleHash(str) { let h = 0; for (let i = 0; i < str.length; i++) h = ((h * 31) + str.charCodeAt(i)) % 1000000007; return h; }
  function getWindow(ts) { return Math.floor((ts || Date.now() / 1000) / EXPIRE_S); }
  function makeKey(uid, w) {
    const h = simpleHash(SECRET + uid + w);
    const p1 = String(uid).slice(0, 5).padEnd(5, "0");
    return "NANG-" + p1 + "-" + String(h % 10000).padStart(4, "0") + "-" + String(Math.floor(h / 10000) % 10000).padStart(4, "0");
  }
  function isValid(uid, key) { const w = getWindow(); return makeKey(uid, w) === key || makeKey(uid, w - 1) === key; }
  function expiryStr() {
    const now = Date.now() / 1000;
    const next = (getWindow() + 1) * EXPIRE_S;
    const left = Math.round(next - now);
    return Math.floor(left / 3600) + "j " + Math.floor((left % 3600) / 60) + "m";
  }
  function b64urlEncode(obj) { let b64 = Buffer.from(JSON.stringify(obj), "utf8").toString("base64"); return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function b64urlDecode(str) { let s = str.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Buffer.from(s, "base64").toString("utf8"); }
  function makeAuthLink(uid, key, username) {
    const payload = { u: String(uid), k: key, n: username || "", e: (getWindow() + 1) * EXPIRE_S };
    return "https://" + AUTH_DOMAIN + "/auth?d=" + b64urlEncode(payload);
  }
  async function getRobloxUser(uid) {
    try { const r = await fetch("https://users.roblox.com/v1/users/" + uid); if (!r.ok) return null; return (await r.json()).name || null; }
    catch { return null; }
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

  if (params.has("bypass")) {
    const link = params.get("bypass");
    if (!link) { res.status(200).json({ error: "no link" }); return; }

    const detection = detectLink(link);
    const low = link.toLowerCase();
    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
    const ACCEPT = "application/json, text/plain, */*";

    const wrappedTokens = [
      "lootlabs","lootlinks","lootdest","platorelay",
      "linkvertise","work.ink","sub2unlock","sub2get","playrole","boost.ink",
      "socialwolvez","cutsy","mboost.me","rekonise","adfoc","adf.ly","adfoc.us",
      "shrinkme","shrinkearn","ouo.io","exe.io","fc.lc","ez4short",
      "shorte.st","bc.vc","cutt.ly","tii.ai","linkpoi","bauval.org",
      "gplinks","gplink","tnlink","tnshort","mdiskshortner","indianshortner",
      "urlshort","shortlink","clk.sh","clicksfly","mightytr.ee","droplink",
      "yoshort","spaste","za.gl","za.gd","shrinkforearn","try2link",
      "kyshort","zshort","gtlink","omg10","weboasi","link1s","linkshortify",
      "arolinks","ez4mod","atglinks","indlink","pndk","ldo.tn"
    ];
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
        res.status(200).json({ result, source, detection });
        return true;
      }
      return false;
    };

    const isLootLink    = low.includes("lootlabs") || low.includes("lootlinks") || low.includes("lootdest");
    const isLinkvertise = low.includes("linkvertise") || low.includes("work.ink") || low.includes("boost.ink") || low.includes("mboost.me");
    const isRekonise    = low.includes("rekonise") || low.includes("socialwolvez") || low.includes("cutsy");
    const isPlatorelay  = low.includes("platorelay");

    if (!isPlatorelay && !isLootLink) {
      const q = encodeURIComponent(link);
      const tasks = [];

      tasks.push((async () => {
        const r = await tryFetch("https://api.bypass.vip/", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA, "Accept": ACCEPT, "Origin": "https://bypass.vip", "Referer": "https://bypass.vip/" },
          body: "url=" + q,
        });
        if (!r.ok) throw 0;
        const res = extract(await readJson(r));
        if (!isCleanUrl(res)) throw 0;
        return { result: res, source: "bypass.vip" };
      })());

      tasks.push((async () => {
        const r = await tryFetch("https://api.bypass.city/api/bypass", {
          method: "POST",
          headers: { "Content-Type": "application/json", "User-Agent": UA, "Accept": ACCEPT, "Origin": "https://bypass.city", "Referer": "https://bypass.city/" },
          body: JSON.stringify({ url: link }),
        });
        if (!r.ok) throw 0;
        const res = extract(await readJson(r));
        if (!isCleanUrl(res)) throw 0;
        return { result: res, source: "bypass.city" };
      })());

      const getProviders = [
        ["https://api.bypassall.lol/bypass?url=" + q, "bypassall"],
        ["https://bypassall.lol/api/bypass?url=" + q, "bypassall-2"],
        ["https://bypass.bot.nu/bypass?url=" + q, "bypass.bot"],
        ["https://linklm.com/api/bypass?url=" + q, "linklm"],
        ["https://api.bypass-unlocked.workers.dev/?url=" + q, "unlocked"],
        ["https://bypass.tools/api/bypass?url=" + q, "bypass.tools"],
        ["https://bypass.pm/api/bypass?url=" + q, "bypass.pm"],
        ["https://api.bypasser.workers.dev/bypass?url=" + q, "bypasser-1"],
        ["https://bypasser.workers.dev/bypass?url=" + q, "bypasser-2"],
        ["https://api.bypass.pro/bypass?url=" + q, "bypass.pro"],
        ["https://api.bypass.tf/api/bypass?url=" + q, "bypass.tf"],
        ["https://bypass.link/api/bypass?url=" + q, "bypass.link"],
        ["https://api.bypass.lol/bypass?url=" + q, "bypass.lol"],
        ["https://api.bypass.workers.dev/bypass?url=" + q, "bypass-workers"],
        ["https://api.linkvertise-bypass.com/bypass?url=" + q, "lv-bypass"],
        ["https://api.shortlink-bypass.com/bypass?url=" + q, "shortlink-bypass"],
        ["https://api.bypasser.io/bypass?url=" + q, "bypasser-io"],
      ];

      for (const [u, tag] of getProviders) {
        tasks.push((async () => {
          const r = await tryFetch(u, { method: "GET", headers: { "User-Agent": UA, "Accept": ACCEPT } });
          if (!r.ok) throw 0;
          const res = extract(await readJson(r));
          if (!isCleanUrl(res)) throw 0;
          return { result: res, source: tag };
        })());
      }

      if (isLinkvertise) {
        const lvId = link.match(/linkvertise\.com\/(\d+)/i)?.[1];
        if (lvId) {
          tasks.push((async () => {
            const r = await tryFetch("https://publisher.linkvertise.com/api/v1/redirect/link/static/" + lvId, {
              headers: { "User-Agent": UA, "Accept": ACCEPT, "Origin": "https://linkvertise.com" },
            });
            if (!r.ok) throw 0;
            const d = await readJson(r);
            const target = d?.data?.link?.target;
            if (!target || !isCleanUrl(target)) throw 0;
            return { result: target, source: "linkvertise-static" };
          })());
        }
      }

      if (isRekonise) {
        const slug = link.match(/rekonise\.com\/([a-z0-9]+)/i)?.[1];
        if (slug) {
          tasks.push((async () => {
            const r = await tryFetch("https://api.rekonise.com/socialunlocks/" + slug, { headers: { "User-Agent": UA, "Accept": ACCEPT } });
            if (!r.ok) throw 0;
            const res = extract(await readJson(r));
            if (!isCleanUrl(res)) throw 0;
            return { result: res, source: "rekonise-api" };
          })());
        }
      }

      if (tasks.length > 0) {
        try {
          const winner = await Promise.any(tasks);
          if (winner && sendOk(winner.result, winner.source)) return;
        } catch (e) {}
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
                document.querySelectorAll("*").forEach(el => {
                  const t = (el.textContent || "").trim();
                  if (t === "Bypassing keys is not allowed" || t.includes("Bypassing keys is not allowed")) {
                    try { el.style.display = "none"; el.remove(); } catch {}
                  }
                });
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
              for (let pi = 0; pi < popups.length; pi++) {
                const p = popups[pi];
                try {
                  await sleep(600);
                  for (let pr = 0; pr < 6; pr++) {
                    const clicked = await p.evaluate(() => {
                      const prio = ["continue", "lanjut", "next", "proceed", "click here", "klik", "claim", "get link", "unlock", "verify", "watch", "start", "open", "free access", "visit now", "get now"];
                      const skip = /\\b(survey|install|casino|register|play store|app store|watch a video|discord|telegram|instagram|youtube|tiktok)\\b/i;
                      const all = [...document.querySelectorAll("button, a, [role='button'], [onclick]")];
                      for (const el of all) {
                        const t = (el.textContent || "").toLowerCase().trim();
                        if (!t || t.length > 150) continue;
                        if (skip.test(t)) continue;
                        if (prio.some(pp => t === pp || t.startsWith(pp))) {
                          try { el.scrollIntoView({block:'center'}); el.click(); return 1; } catch {}
                        }
                      }
                      return 0;
                    }).catch(()=>0);
                    if (!clicked) break;
                    await sleep(700);
                    const pk = await tryScrapeKey(p);
                    if (pk) return { key: pk, url: p.url(), status: "key-found" };
                    const popupApis = await p.evaluate(() => window.__nangApi || []).catch(()=>[]);
                    popupApis.forEach(a => { if (a && a.url) apiCalls.push({ ...a, from: "popup" }); });
                    const pu = p.url();
                    if (pu && !reject(pu)) return { url: pu, status: "popup-final" };
                  }
                  try { await p.close(); } catch {}
                } catch {}
              }
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
              const done = await page.evaluate(() => {
                const body = document.body.innerText || "";
                if (/completed\\s+1\\s+of\\s+1/i.test(body) || /task.*complete/i.test(body)) {
                  const a = [...document.querySelectorAll("a[href^='http']")].find(x => !/platorelay|lootlabs|lootlinks/i.test(x.href));
                  return a ? a.href : null;
                }
                return null;
              });
              if (done && !reject(done)) return { url: done, status: "task-done" };
            }
            const dMatch = startUrl.match(/[?&]d=([^&]+)/);
            if (dMatch && dMatch[1]) {
              const ticket = dMatch[1];
              const directApis = [
                "https://auth.platorelay.com/api/complete?d=" + ticket,
                "https://auth.platorelay.com/api/destination?d=" + ticket,
                "https://auth.platorelay.com/api/verify?d=" + ticket,
                "https://auth.platorelay.com/api/claim?d=" + ticket,
                "https://platorelay.com/api/complete?d=" + ticket,
                "https://platorelay.com/api/destination?d=" + ticket,
              ];
              for (const api of directApis) {
                try {
                  const r = await page.evaluate(async (u) => {
                    try {
                      const resp = await fetch(u, { method: "GET", credentials: "include" });
                      return { ok: resp.ok, status: resp.status, body: await resp.text() };
                    } catch (e) { return { err: String(e) }; }
                  }, api);
                  if (r && r.body) {
                    const km = r.body.match(KEY_RE);
                    if (km) return { key: km[1], url: page.url(), status: "key-found" };
                    const m = r.body.match(/https?:\\/\\/[^"'\\s<>)]+/);
                    if (m && !reject(m[0])) return { url: m[0], status: "direct-api" };
                  }
                } catch {}
              }
            }
            try {
              await page.evaluate(() => {
                try {
                  Object.keys(localStorage).forEach(k => {
                    if (/task|complete|verified|unlock|claim/i.test(k)) localStorage[k] = "true";
                  });
                  Object.keys(sessionStorage).forEach(k => {
                    if (/task|complete|verified|unlock|claim/i.test(k)) sessionStorage[k] = "true";
                  });
                } catch {}
              });
              await page.reload({ waitUntil: "domcontentloaded", timeout: 4000 }).catch(()=>{});
              await sleep(1200);
              const keyAfter = await tryScrapeKey(page);
              if (keyAfter) return { key: keyAfter, url: page.url(), status: "key-found" };
              const newUrl = page.url();
              if (!reject(newUrl)) return { url: newUrl, status: "flag-set" };
              const btn = await page.evaluate(() => {
                const all = [...document.querySelectorAll("button, a, [role='button']")];
                for (const el of all) {
                  const t = (el.textContent || "").toLowerCase();
                  if (/continue|get link|claim|unlock/i.test(t) && !el.disabled) {
                    try { el.click(); return 1; } catch {}
                  }
                }
                return 0;
              });
              if (btn) {
                await sleep(1500);
                const kf = await tryScrapeKey(page);
                if (kf) return { key: kf, url: page.url(), status: "key-found" };
                const u2 = page.url();
                if (!reject(u2)) return { url: u2, status: "flag-then-click" };
              }
            } catch {}
            try { const html = await page.content(); harvest(html); } catch {}
            const finalKey = await tryScrapeKey(page);
            if (finalKey) return { key: finalKey, url: page.url(), status: "key-found" };
            if (leaked.size > 0) for (const u of leaked) return { url: u, status: "leak" };
            return { url: startUrl, status: "wrapped", apis: apiCalls.slice(-10) };
          } catch (e) {
            return { url: startUrl, status: "err", error: String(e.message || e), apis: apiCalls.slice(-10) };
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
            res.status(200).json({ result: d.key, key: d.key, source: "key-scrape", detection });
            return;
          }
          if (d && isCleanUrl(d.url)) {
            res.status(200).json({ result: d.url, source: "browserless-" + (d.status || "?"), detection });
            return;
          }
          if (d && d.apis && d.apis.length > 0) {
            console.log("[browserless api traces]", JSON.stringify(d.apis).slice(0, 1500));
          }
        }
      } catch (e) { console.error("Browserless:", e.message); }
    }

    try {
      const r = await tryFetch(link, { method: "HEAD", redirect: "manual", headers: { "User-Agent": UA } }, 3000);
      const loc = r.headers.get("location");
      if (loc && /^https?:\/\//.test(loc) && loc !== link && isCleanUrl(loc)) {
        res.status(200).json({ result: loc, source: "redirect", detection });
        return;
      }
    } catch {}

    let warning = "Bypass gagal semua layer.";
    if (detection && detection.auto === "low") {
      warning = detection.type + " pakai dinding follow/task manual — bukan auto-bypass-able.";
    } else {
      warning = "Provider publik kadang down. Coba lagi 1-2 menit, atau ganti link.";
    }

    res.status(200).json({ result: link, source: "original", detection, warning });
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
:root{--pink:#e03c8a;--purple:#9b4de0;--cyan:#00d4ff;--green:#00e87a;--yellow:#ffc832;--red:#ff6b6b;--bg:#08080f;--bg2:#0f0f1a;--bg3:#16162a;--border:#ffffff12;--text:#e8e8f0;--muted:#6b6b8a}
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
<input type="text" class="inp" id="bypassUrl" placeholder="Paste link shortlink di sini..." autocomplete="off" spellcheck="false">
<div class="detect" id="detectBox"><span class="d-badge" id="detectBadge">—</span><span class="d-text" id="detectText">Ketik link untuk deteksi otomatis</span></div>
<button class="btn-cyan" onclick="doBypass()">Bypass Sekarang</button>
<div class="result" id="bypassResult"></div>
</div>
</div>

<div class="panel" id="tab2">
<div class="card">
<div class="card-title">RBXL / RBXM → RBXLX</div>
<div class="fmt-box">Upload file <span class="field">.rbxl</span> / <span class="field">.rbxm</span> (biner) atau <span class="field">.rbxlx</span> / <span class="field">.rbxmx</span> (XML). File biner otomatis dikonversi ke XML. Hasil: <span class="field">.rbxlx</span> siap insert.</div>
<input type="file" id="convFile" accept=".rbxl,.rbxm,.rbxlx,.rbxmx" style="display:none" onchange="doConvert()">
<button class="btn-cyan" onclick="document.getElementById('convFile').click()">Pilih File (.rbxl / .rbxm / .rbxlx)</button>
<div class="result" id="convResult"></div>
</div>
</div>

<footer>NANG RBXM Tool &copy; 2025 &middot; v${BUILD}</footer>

<div id="ownerFab" onclick="openGen()" title="Owner Only">&#128274;</div>
<div id="genPanel"><div class="box"><span class="close" onclick="closeGen()">&times;</span><h3>Owner Panel</h3><input type="password" class="inp" id="genPw" placeholder="Password owner..."><button class="btn-main" onclick="doLogin()">Login</button><div id="genForm" style="display:none;margin-top:14px"><input type="text" class="inp" id="genUid" placeholder="Roblox User ID..."><button class="btn-main" onclick="doGenerate()">Generate Key</button><div class="result" id="genResult"></div></div></div></div>

<script>
const WA_NUMBER="${wa}";
let lastLookup={uid:null,name:null};
let ownerPw=null;
let detectTimer=null;
let lastDetect=null;
function switchTab(i){document.querySelectorAll('.nav-btn').forEach((b,j)=>b.classList.toggle('active',i===j));document.querySelectorAll('.panel').forEach((p,j)=>p.classList.toggle('active',i===j));}
function updateWA(){if(!lastLookup.name)return;const text="Beli Key NANG%0ANama: "+encodeURIComponent(lastLookup.name)+"%0ARoblox ID: "+lastLookup.uid+"%0ABukti TF: [screenshot]";document.getElementById('waBtn').href="https://wa.me/"+WA_NUMBER+"?text="+text;document.getElementById('waNama').textContent=lastLookup.name;document.getElementById('waUid').textContent=lastLookup.uid;}
async function doLookup(){const uid=document.getElementById('lookupId').value.trim();const box=document.getElementById('lookupResult');if(!uid)return;box.style.display='block';box.className='result';box.innerHTML='<span class="spinner"></span>Mencari...';try{const r=await fetch('/?lookup='+encodeURIComponent(uid));const d=await r.json();if(d.name){lastLookup={uid:d.uid,name:d.name};updateWA();box.style.display='none';const ex=document.getElementById('userCard');if(ex)ex.remove();const card=document.createElement('div');card.id='userCard';card.className='user-card';card.innerHTML='<div class="user-avatar">'+d.name.charAt(0).toUpperCase()+'</div><div class="user-info"><div class="user-name">'+d.name+'</div><div class="user-id">ID: '+d.uid+'</div></div>';box.parentNode.insertBefore(card,box.nextSibling);}else{box.className='result err';box.innerHTML='User ID tidak ditemukan';}}catch(e){box.className='result err';box.innerHTML='Error: '+e.message;}}
let lookupT;document.getElementById('lookupId').addEventListener('input',()=>{clearTimeout(lookupT);lookupT=setTimeout(doLookup,600);});
function openGen(){document.getElementById('genPanel').classList.add('show');}
function closeGen(){document.getElementById('genPanel').classList.remove('show');document.getElementById('genPw').value='';document.getElementById('genForm').style.display='none';document.getElementById('genResult').style.display='none';ownerPw=null;document.getElementById('genPw').disabled=false;}
document.getElementById('genPanel').addEventListener('click',(e)=>{if(e.target.id==='genPanel')closeGen();});
async function doLogin(){const pw=document.getElementById('genPw').value;if(!pw)return;try{const r=await fetch('/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'generate',pw:pw,uid:'1'})});const d=await r.json();if(d.error==='password salah'){document.getElementById('genPw').value='';document.getElementById('genPw').placeholder='password salah';}else if(d.ok){ownerPw=pw;document.getElementById('genForm').style.display='block';document.getElementById('genPw').disabled=true;}}catch(e){}}
async function doGenerate(){const uid=document.getElementById('genUid').value.trim();const box=document.getElementById('genResult');if(!uid||!ownerPw)return;box.style.display='block';box.className='result';box.innerHTML='<span class="spinner"></span>Generating...';try{const r=await fetch('/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'generate',pw:ownerPw,uid:uid})});const d=await r.json();if(d.ok){box.className='result ok';box.innerHTML='<b>Username:</b> '+(d.username||'Unknown')+'<div class="key-line">'+d.key+'</div><b style="color:#6b6b8a;font-size:.72rem">Auth Link:</b><a href="'+d.authLink+'" target="_blank" class="link-line">'+d.authLink+'</a><button class="btn-green" onclick="navigator.clipboard.writeText(\\''+d.key+'\\');this.textContent=\\'COPIED\\';setTimeout(()=>this.textContent=\\'COPY KEY\\',1500)">COPY KEY</button>';}else{box.className='result err';box.innerHTML=d.error||'Gagal';}}catch(e){box.className='result err';box.innerHTML='Error: '+e.message;}}
async function detectLinkNow(url){const box=document.getElementById('detectBox');const badge=document.getElementById('detectBadge');const text=document.getElementById('detectText');if(!url||url.length<8){box.classList.remove('show');lastDetect=null;return;}try{const r=await fetch('/?detect='+encodeURIComponent(url));const d=await r.json();const det=d.detection;if(!det){box.classList.remove('show');return;}lastDetect=det;box.className='detect show '+det.auto;const labels={high:'AUTO',medium:'COBA',low:'MANUAL',none:'INVALID'};badge.textContent=det.type+' · '+labels[det.auto];text.textContent=det.note;}catch(e){box.classList.remove('show');}}
document.getElementById('bypassUrl').addEventListener('input',()=>{clearTimeout(detectTimer);detectTimer=setTimeout(()=>detectLinkNow(document.getElementById('bypassUrl').value.trim()),500);});
async function doBypass(){
  const link=document.getElementById('bypassUrl').value.trim();
  const box=document.getElementById('bypassResult');
  if(!link)return;
  box.style.display='block';box.className='result';
  const detLabel=lastDetect?'('+lastDetect.type+')':'';
  box.innerHTML='<span class="spinner"></span>Memproses '+detLabel+' — max 10 detik...';
  try{
    const r=await fetch('/?bypass='+encodeURIComponent(link));
    const d=await r.json();
    if(d.key){
      box.className='result ok';
      box.innerHTML='<b>KEY DITEMUKAN</b><div class="key-line">'+d.key+'</div><button class="btn-green" onclick="navigator.clipboard.writeText(\\''+d.key+'\\');this.textContent=\\'COPIED\\';setTimeout(()=>this.textContent=\\'COPY KEY\\',1500)">COPY KEY</button><div style="font-size:.7rem;color:#6b6b8a;margin-top:6px">via '+(d.source||'?')+'</div>';
      return;
    }
    if(d.result){
      const url=d.result;
      window._bypassUrl=url;
      const cls=d.source==='browserless'?'ok':(d.source==='original'?'warn':'ok');
      box.className='result '+cls;
      let label='Bypass berhasil!';
      if(d.source==='original')label='Belum selesai — klik bypass lagi:';
      const detInfo=d.detection?'<div style="font-size:.7rem;color:#6b6b8a;margin-top:4px">Jenis: '+d.detection.type+' · via '+(d.source||'?')+'</div>':(d.source?'<div style="font-size:.7rem;color:#6b6b8a;margin-top:4px">via '+d.source+'</div>':'');
      box.innerHTML=label+detInfo+'<div class="key-line"><a href="'+url+'" target="_blank" style="color:#00d4ff;text-decoration:none">'+url+'</a></div>'+(d.source!=='original'?'<button class="btn-green" onclick="navigator.clipboard.writeText(window._bypassUrl);this.textContent=\\'COPIED\\';setTimeout(()=>this.textContent=\\'COPY LINK\\',1500)">COPY LINK</button>':'')+(d.warning?'<div style="font-size:.72rem;color:#ffc832;margin-top:8px">'+d.warning+'</div>':'');
    }else{
      box.className='result err';box.innerHTML=d.error||'Bypass gagal.';
    }
  }catch(e){box.className='result err';box.innerHTML='Error: '+e.message;}
}
async function doConvert(){
  const input=document.getElementById('convFile');
  const box=document.getElementById('convResult');
  if(!input.files||!input.files[0])return;
  const file=input.files[0];
  if(file.size>50*1024*1024){box.style.display='block';box.className='result err';box.innerHTML='File > 50 MB.';return;}
  box.style.display='block';box.className='result';box.innerHTML='<span class="spinner"></span>Mengkonversi '+file.name+'...';
  try{
    const buf=await file.arrayBuffer();
    const r=await fetch('/api/convert',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:buf});
    const text=await r.text();
    let errMsg=null;
    try{const j=JSON.parse(text);if(j&&j.ok===false){errMsg=j.error||'Konversi gagal';}}catch{}
    if(!r.ok||errMsg){box.className='result err';box.innerHTML='Gagal: '+(errMsg||text.slice(0,200));return;}
    const outName=file.name.replace(/\.(rbxl|rbxm)$/i,'.rbxlx')||('converted-'+Date.now()+'.rbxlx');
    const blob=new Blob([text],{type:'text/xml'});
    const url=URL.createObjectURL(blob);
    box.className='result ok';
    box.innerHTML='Berhasil dikonversi!<div class="key-line"><a href="'+url+'" download="'+outName+'" style="color:#00d4ff;text-decoration:none">⬇ Download '+outName+'</a></div><div style="font-size:.72rem;color:#6b6b8a;margin-top:6px">File XML siap di-insert ke Roblox Studio.</div>';
  }catch(e){
    box.className='result err';box.innerHTML='Error: '+e.message;
  }
}
</script></body></html>`;
}
