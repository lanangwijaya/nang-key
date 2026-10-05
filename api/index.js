// NANG KEY SERVER - Fixed (no embedded base64)
export default async function handler(req, res) {
  const SECRET = "NANG2024";
  const ADMIN_PW = "nangowner123";
  const EXPIRE_S = 86400;
  const WA_NUMBER = "081252425581";
  const SYAA_KEY = "syaa_07f507a24e709cf2bc49b5ef6a094f8a60b47730b26fb3c7";

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
    const h = Math.floor(left / 3600);
    const m = Math.floor((left % 3600) / 60);
    return h + "j " + m + "m";
  }

  async function getRobloxUser(uid) {
    try {
      const r = await fetch("https://users.roblox.com/v1/users/" + uid);
      if (!r.ok) return null;
      const d = await r.json();
      return d.name || null;
    } catch { return null; }
  }

  const url = new URL(req.url, "https://nang-key.vercel.app");
  const params = url.searchParams;
  const method = req.method;

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (method === "OPTIONS") { res.status(200).end(); return; }

  // POST validate (from script)
  if (method === "POST") {
    let body = "";
    await new Promise(r => { req.on("data", c => body += c); req.on("end", r); });
    let uid, key;
    try { const j = JSON.parse(body); uid = j.uid; key = j.key; } catch { res.status(400).json({ valid: false, error: "bad json" }); return; }
    const valid = isValid(uid, key);
    res.json({ valid, expires: valid ? expiryStr() : null });
    return;
  }

  // GET validate
  if (params.has("uid") && params.has("key")) {
    const uid = params.get("uid");
    const key = params.get("key");
    const valid = isValid(uid, key);
    res.json({ valid, expires: valid ? expiryStr() : null });
    return;
  }

  // GET lookup username
  if (params.has("lookup")) {
    const uid = params.get("lookup");
    const name = await getRobloxUser(uid);
    res.json({ uid, name });
    return;
  }

  // GET generate key
  if (params.has("uid") && !params.has("key") && !params.has("admin") && !params.has("bypass")) {
    const uid = params.get("uid");
    const w = getWindow();
    const key = makeKey(uid, w);
    const name = await getRobloxUser(uid);
    res.json({ uid, key, expires: expiryStr(), username: name });
    return;
  }

  // GET admin panel
  if (params.has("admin")) {
    if (params.get("admin") !== ADMIN_PW) { res.status(403).send("Forbidden"); return; }
    const genUid = params.get("gen");
    let genResult = "";
    if (genUid) {
      const key = makeKey(genUid, getWindow());
      const name = await getRobloxUser(genUid) || "Unknown";
      genResult = `<div class="result"><b>Username:</b> ${name}<br><b>Key:</b> <code>${key}</code><br><b>Expires:</b> ${expiryStr()}</div>`;
    }
    res.setHeader("Content-Type", "text/html");
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Admin NANG</title>
<style>*{box-sizing:border-box}body{background:#0a0a0a;color:#fff;font-family:sans-serif;padding:20px}
h1{color:#00ff88}input{background:#1a1a1a;border:1px solid #333;color:#fff;padding:8px;border-radius:6px;width:300px}
button{background:#00ff88;color:#000;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:bold}
.result{background:#1a1a1a;padding:12px;border-radius:8px;margin-top:12px;border:1px solid #00ff88}
code{color:#00ff88;font-size:16px}</style></head><body>
<h1>🔑 Admin Panel NANG</h1>
<form method="GET"><input type="hidden" name="admin" value="${ADMIN_PW}">
<input type="text" name="gen" placeholder="Masukkan Roblox User ID" required>
<button type="submit">Generate Key</button></form>
${genResult}
<hr style="border-color:#333;margin:20px 0">
<a href="/" style="color:#888">← Kembali ke website</a>
</body></html>`);
    return;
  }

  // GET bypass (multi-API fallback)
  if (params.has("bypass")) {
    const link = params.get("bypass");
    if (!link) { res.json({ error: "no link" }); return; }

    // Try Syaa API first
    try {
      const r = await fetch("https://syaabot.my.id/v1/bypass", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": SYAA_KEY },
        body: JSON.stringify({ url: link })
      });
      if (r.ok) {
        const d = await r.json();
        if (d.result || d.url || d.bypassed_url) { res.json(d); return; }
      }
    } catch {}

    // Fallback: EvoBypass
    try {
      const r2 = await fetch("https://evobypasser.vercel.app/bypass?url=" + encodeURIComponent(link));
      if (r2.ok) {
        const d2 = await r2.json();
        if (d2.result || d2.url || d2.bypassed_url || d2.destination) {
          res.json({ result: d2.result || d2.url || d2.bypassed_url || d2.destination });
          return;
        }
      }
    } catch {}

    // Fallback 2: bypass.vip
    try {
      const r3 = await fetch("https://bypass.vip/bypass?url=" + encodeURIComponent(link));
      if (r3.ok) {
        const d3 = await r3.json();
        if (d3.result || d3.url || d3.destination) {
          res.json({ result: d3.result || d3.url || d3.destination });
          return;
        }
      }
    } catch {}

    res.json({ error: "Semua bypass gagal. Coba lagi nanti." });
    return;
  }

  // GET main HTML page
  res.setHeader("Content-Type", "text/html");
  res.send(getHTML(WA_NUMBER));
}

function getHTML(wa) {
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NANG Key System</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--pink:#e03c8a;--purple:#9b4de0;--cyan:#00d4ff;--green:#00e87a;--bg:#08080f;--bg2:#0f0f1a;--bg3:#16162a;--border:#ffffff12;--text:#e8e8f0;--muted:#6b6b8a}
body{background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:24px 16px}

/* HERO */
.hero{text-align:center;margin-bottom:28px;position:relative}
.hero-glow{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:300px;height:120px;background:radial-gradient(ellipse,rgba(224,60,138,0.18) 0%,transparent 70%);pointer-events:none}
.logo{font-size:2.6rem;font-weight:900;letter-spacing:-1px;background:linear-gradient(135deg,var(--pink),var(--purple),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1}
.logo-badge{display:inline-block;background:linear-gradient(135deg,var(--pink),var(--purple));color:#fff;font-size:0.6rem;font-weight:700;padding:2px 7px;border-radius:20px;vertical-align:super;margin-left:4px;letter-spacing:1px}
.sub{color:var(--muted);font-size:0.8rem;margin-top:6px;letter-spacing:0.5px}

/* NAV */
.nav{display:flex;gap:6px;background:var(--bg2);border:1px solid var(--border);border-radius:14px;padding:5px;margin-bottom:22px;width:100%;max-width:480px}
.nav-btn{flex:1;padding:9px 6px;border:none;border-radius:10px;cursor:pointer;font-size:0.8rem;font-weight:600;background:transparent;color:var(--muted);transition:all .2s;font-family:inherit}
.nav-btn.active{background:linear-gradient(135deg,rgba(224,60,138,0.2),rgba(155,77,224,0.2));color:#fff;border:1px solid rgba(224,60,138,0.3)}
.nav-btn:hover:not(.active){color:var(--text);background:rgba(255,255,255,0.04)}

/* PANEL */
.panel{width:100%;max-width:480px;display:none}
.panel.active{display:block}

/* CARD */
.card{background:var(--bg2);border:1px solid var(--border);border-radius:16px;padding:18px;margin-bottom:12px;position:relative;overflow:hidden}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(224,60,138,0.4),transparent)}
.card-title{font-size:0.7rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:14px}

/* QR */
.qr-wrap{display:flex;gap:14px;align-items:flex-start;margin-bottom:14px}
.qr-img{width:100px;height:100px;border-radius:10px;border:2px solid var(--border);object-fit:cover;flex-shrink:0}
.qr-img-placeholder{width:100px;height:100px;border-radius:10px;border:2px dashed var(--border);display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:0.7rem;text-align:center;flex-shrink:0}
.qr-info{flex:1}
.price-badge{display:inline-flex;align-items:center;gap:5px;background:linear-gradient(135deg,rgba(0,232,122,0.15),rgba(0,212,255,0.1));border:1px solid rgba(0,232,122,0.3);border-radius:8px;padding:5px 10px;font-size:0.85rem;font-weight:700;color:var(--green);margin-bottom:8px}
.qr-steps{font-size:0.75rem;color:var(--muted);line-height:1.8}
.qr-steps span{color:var(--text)}

/* FORMAT BOX */
.fmt-box{background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:0.75rem;color:var(--muted);line-height:1.9;margin-bottom:12px}
.fmt-box .label{color:var(--pink);font-weight:600}
.fmt-box .field{color:var(--text)}

/* WA BUTTON */
.wa-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:13px;background:linear-gradient(135deg,#25d366,#128c7e);color:#fff;border:none;border-radius:12px;font-size:0.95rem;font-weight:700;cursor:pointer;text-decoration:none;transition:opacity .2s;font-family:inherit}
.wa-btn:hover{opacity:.88}
.wa-icon{width:18px;height:18px;fill:#fff}

/* INPUT */
.inp{width:100%;padding:11px 14px;background:var(--bg3);border:1px solid var(--border);border-radius:10px;color:var(--text);font-size:0.88rem;outline:none;margin-bottom:10px;font-family:inherit;transition:border-color .2s}
.inp:focus{border-color:rgba(224,60,138,0.5)}
.inp::placeholder{color:var(--muted)}

/* BUTTONS */
.btn-main{width:100%;padding:12px;background:linear-gradient(135deg,var(--pink),var(--purple));color:#fff;border:none;border-radius:11px;font-weight:700;font-size:0.9rem;cursor:pointer;font-family:inherit;transition:opacity .2s;letter-spacing:0.3px}
.btn-main:hover{opacity:.88}
.btn-cyan{width:100%;padding:12px;background:linear-gradient(135deg,#0099cc,var(--cyan));color:#000;border:none;border-radius:11px;font-weight:700;font-size:0.9rem;cursor:pointer;font-family:inherit;transition:opacity .2s}
.btn-cyan:hover{opacity:.88}

/* RESULT */
.result{background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:0.8rem;margin-top:10px;display:none;word-break:break-all;line-height:1.6}
.result.ok{border-color:rgba(0,232,122,0.3);color:var(--green)}
.result.err{border-color:rgba(255,80,80,0.3);color:#ff6b6b;background:rgba(255,40,40,0.05)}

/* TAGS */
.tags{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px}
.tag{background:rgba(0,212,255,0.08);color:var(--cyan);font-size:0.68rem;font-weight:600;padding:3px 9px;border-radius:20px;border:1px solid rgba(0,212,255,0.2)}

/* STEPS */
.steps{counter-reset:step}
.step{display:flex;gap:10px;align-items:flex-start;margin-bottom:10px;font-size:0.78rem;color:var(--muted)}
.step-num{width:20px;height:20px;border-radius:50%;background:linear-gradient(135deg,var(--pink),var(--purple));color:#fff;font-size:0.65rem;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
.step span{color:var(--text)}

/* LOOKUP RESULT */
.user-card{display:flex;align-items:center;gap:10px;background:var(--bg3);border:1px solid rgba(0,232,122,0.2);border-radius:10px;padding:10px;margin-top:10px}
.user-avatar{width:36px;height:36px;border-radius:8px;background:linear-gradient(135deg,var(--pink),var(--purple));display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1rem;color:#fff}
.user-info{flex:1}
.user-name{font-weight:700;font-size:0.9rem;color:var(--text)}
.user-id{font-size:0.72rem;color:var(--muted)}

/* DIVIDER */
.divider{border:none;border-top:1px solid var(--border);margin:14px 0}

/* SPINNER */
.spinner{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.1);border-top-color:var(--pink);border-radius:50%;animation:spin .6s linear infinite;vertical-align:middle;margin-right:6px}
@keyframes spin{to{transform:rotate(360deg)}}

/* FOOTER */
footer{margin-top:28px;color:var(--muted);font-size:0.7rem;text-align:center;opacity:0.5}
</style>
</head>
<body>

<div class="hero">
  <div class="hero-glow"></div>
  <div class="logo">NANG<span class="logo-badge">KEY</span></div>
  <div class="sub">Roblox Script Key System</div>
</div>

<div class="nav">
  <button class="nav-btn active" onclick="switchTab(0)">🛒 Beli Key</button>
  <button class="nav-btn" onclick="switchTab(1)">🔓 Bypass Link</button>
</div>

<!-- TAB 0 -->
<div class="panel active" id="tab0">
  <div class="card">
    <div class="card-title">💳 Pembayaran QRIS</div>
    <div class="qr-wrap">
      <img src="/qr.png" class="qr-img" alt="QR" onerror="this.outerHTML='<div class=qr-img-placeholder>QR<br>tidak<br>tersedia</div>'">
      <div class="qr-info">
        <div class="price-badge">💰 Rp500 / Key</div>
        <div class="qr-steps">
          Scan QR di kiri<br>
          Transfer <span>Rp500</span><br>
          Chat WA owner<br>
          Key dikirim otomatis
        </div>
      </div>
    </div>
    <div class="fmt-box">
      <span class="label">Format pesan WA:</span><br>
      <span class="field">Beli Key NANG</span><br>
      Nama: <span class="field">[Nama kamu]</span><br>
      Roblox ID: <span class="field">[User ID]</span><br>
      Bukti TF: <span class="field">[Screenshot]</span>
    </div>
    <a href="https://wa.me/${wa}?text=Beli%20Key%20NANG%0ANama%3A%20%0ARoblox%20ID%3A%20%0ABukti%20TF%3A%20" class="wa-btn" target="_blank">
      <svg class="wa-icon" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
      Chat WhatsApp Owner
    </a>
  </div>

  <div class="card">
    <div class="card-title">🔍 Cek Username Roblox</div>
    <input type="text" class="inp" id="lookupId" placeholder="Masukkan Roblox User ID...">
    <button class="btn-main" onclick="doLookup()">Cek Username</button>
    <div id="lookupResult"></div>
  </div>
</div>

<!-- TAB 1 -->
<div class="panel" id="tab1">
  <div class="card">
    <div class="card-title">⚡ Bypass Shortlink</div>
    <div class="tags">
      <span class="tag">Linkvertise</span>
      <span class="tag">Lootlabs</span>
      <span class="tag">Lootdest</span>
      <span class="tag">Playrole</span>
      <span class="tag">Sub2Unlock</span>
      <span class="tag">Work.ink</span>
      <span class="tag">Flux.li</span>
      <span class="tag">Direct.lc</span>
      <span class="tag">Pastebin</span>
    </div>
    <input type="text" class="inp" id="bypassUrl" placeholder="Paste link shortlink di sini...">
    <button class="btn-cyan" onclick="doBypass()">⚡ Bypass Sekarang</button>
    <div class="result" id="bypassResult"></div>
  </div>

  <div class="card">
    <div class="card-title">📋 Cara Pakai</div>
    <div class="step"><div class="step-num">1</div><div>Copy link dari game/script Roblox</div></div>
    <div class="step"><div class="step-num">2</div><div>Paste di kolom atas</div></div>
    <div class="step"><div class="step-num">3</div><div>Klik <span>Bypass Sekarang</span></div></div>
    <div class="step"><div class="step-num">4</div><div>Copy hasil link bypass ✅</div></div>
  </div>
</div>

<footer>NANG RBXM Tool &copy; 2024</footer>

<script>
function switchTab(i){
  document.querySelectorAll('.nav-btn').forEach((b,j)=>b.classList.toggle('active',i===j));
  document.querySelectorAll('.panel').forEach((p,j)=>p.classList.toggle('active',i===j));
}

async function doLookup(){
  const uid=document.getElementById('lookupId').value.trim();
  const box=document.getElementById('lookupResult');
  if(!uid)return;
  box.style.display='block';
  box.className='result';
  box.innerHTML='<span class="spinner"></span>Mencari...';
  try{
    const r=await fetch('/?lookup='+encodeURIComponent(uid));
    const d=await r.json();
    if(d.name){
      box.style.display='none';
      const initials=d.name.charAt(0).toUpperCase();
      const existing=document.getElementById('userCard');
      if(existing)existing.remove();
      const card=document.createElement('div');
      card.id='userCard';
      card.className='user-card';
      card.innerHTML='<div class="user-avatar">'+initials+'</div><div class="user-info"><div class="user-name">'+d.name+'</div><div class="user-id">ID: '+d.uid+'</div></div>';
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

async function doBypass(){
  const link=document.getElementById('bypassUrl').value.trim();
  const box=document.getElementById('bypassResult');
  if(!link)return;
  box.style.display='block';
  box.className='result';
  box.innerHTML='<span class="spinner"></span>Memproses link...';
  try{
    const r=await fetch('/?bypass='+encodeURIComponent(link));
    const d=await r.json();
    if(d.result||d.url||d.bypassed_url){
      const url=d.result||d.url||d.bypassed_url;
      window._bypassUrl=url;
      box.className='result ok';
      box.innerHTML='✅ Bypass berhasil!<div style="margin-top:8px;background:#0a1520;padding:10px;border-radius:8px;border:1px solid rgba(0,212,255,0.2)"><a href="'+url+'" target="_blank" style="color:#00d4ff;word-break:break-all;font-size:0.78rem;text-decoration:none">'+url+'</a></div><button onclick="navigator.clipboard.writeText(window._bypassUrl);this.textContent=\'✅ Copied!\';this.style.background=\'#00e87a\'" style="margin-top:10px;padding:8px 16px;background:#00d4ff;color:#000;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:0.8rem;font-family:inherit;width:100%">📋 Copy Link</button>';
    }else{
      box.className='result err';
      box.innerHTML='❌ '+(d.error||d.message||'Bypass gagal. Coba link lain.');
    }
  }catch(e){
    box.className='result err';
    box.innerHTML='❌ Error: '+e.message;
  }
}
</script>
</body>
</html>`;
}
