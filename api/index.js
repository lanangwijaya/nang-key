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
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0a;color:#e0e0e0;font-family:'Segoe UI',sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:20px}
.logo{font-size:2rem;font-weight:900;background:linear-gradient(135deg,#00ff88,#00ccff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin:20px 0 4px}
.sub{color:#666;font-size:0.85rem;margin-bottom:24px}
.tabs{display:flex;gap:4px;background:#111;border-radius:10px;padding:4px;margin-bottom:20px;width:100%;max-width:460px}
.tab{flex:1;padding:8px;border:none;border-radius:8px;cursor:pointer;font-size:0.85rem;font-weight:600;background:transparent;color:#666;transition:all .2s}
.tab.active{background:#1a1a1a;color:#00ff88}
.panel{width:100%;max-width:460px;display:none}
.panel.active{display:block}
.card{background:#111;border:1px solid #222;border-radius:12px;padding:16px;margin-bottom:12px}
.card h3{color:#00ff88;font-size:0.9rem;margin-bottom:12px;text-transform:uppercase;letter-spacing:1px}
.qr-img{width:100%;max-width:200px;display:block;margin:0 auto 12px;border-radius:8px}
.qr-note{text-align:center;font-size:0.8rem;color:#888;margin-bottom:12px}
.wa-btn{display:block;width:100%;padding:12px;background:linear-gradient(135deg,#25d366,#128c7e);color:#fff;border:none;border-radius:10px;font-size:1rem;font-weight:700;cursor:pointer;text-align:center;text-decoration:none;margin-top:8px}
.wa-btn:hover{opacity:.9}
.info-box{background:#0d1f0d;border:1px solid #1a3d1a;border-radius:8px;padding:10px;font-size:0.8rem;color:#aaa;line-height:1.6;margin-bottom:12px}
.info-box b{color:#00ff88}
input[type=text]{width:100%;padding:10px 12px;background:#1a1a1a;border:1px solid #333;border-radius:8px;color:#fff;font-size:0.9rem;outline:none;margin-bottom:8px}
input[type=text]:focus{border-color:#00ff88}
button.primary{width:100%;padding:11px;background:linear-gradient(135deg,#00ff88,#00ccff);color:#000;border:none;border-radius:8px;font-weight:700;font-size:0.95rem;cursor:pointer}
button.primary:hover{opacity:.9}
.result-box{background:#0a1a0a;border:1px solid #1a3d1a;border-radius:8px;padding:10px;font-size:0.8rem;color:#ccc;margin-top:8px;display:none;word-break:break-all}
.result-box.error{background:#1a0a0a;border-color:#3d1a1a;color:#ff6666}
.result-box.ok{background:#0a1a0a;border-color:#1a3d1a;color:#00ff88}
.supported-box{background:#0d1020;border:1px solid #1a2a3d;border-radius:8px;padding:10px;margin-bottom:10px}
.sup-title{font-size:0.75rem;color:#888;margin-bottom:8px}
.sup-tags{display:flex;flex-wrap:wrap;gap:5px}
.tag{background:#1a2a3d;color:#00ccff;font-size:0.7rem;padding:3px 8px;border-radius:20px;border:1px solid #1a3d5d}
.spinner{display:inline-block;width:16px;height:16px;border:2px solid #333;border-top-color:#00ff88;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:6px}
@keyframes spin{to{transform:rotate(360deg)}}
footer{margin-top:30px;color:#333;font-size:0.75rem;text-align:center}
</style>
</head>
<body>
<div class="logo">NANG</div>
<div class="sub">Key System · NANG Tool</div>

<div class="tabs">
  <button class="tab active" onclick="switchTab(0)">🛒 Beli Key</button>
  <button class="tab" onclick="switchTab(1)">🔓 Bypass Link</button>
</div>

<!-- TAB 0: Beli Key -->
<div class="panel active" id="tab0">
  <div class="card">
    <h3>💳 Pembayaran QRIS</h3>
    <img src="/qr.png" class="qr-img" alt="QR QRIS" onerror="this.style.display='none';document.getElementById('qr-fb').style.display='block'">
    <div id="qr-fb" style="display:none;text-align:center;padding:20px;color:#666;font-size:0.8rem;">QR tidak tersedia</div>
    <p class="qr-note">Scan QR · Rp500 · QRIS</p>
    <div class="info-box">
      <b>Format WA setelah bayar:</b><br>
      Beli Key NANG<br>
      Nama: [Nama kamu]<br>
      Roblox ID: [User ID Roblox]<br>
      Bukti TF: [Screenshot]
    </div>
    <a href="https://wa.me/${wa}?text=Beli%20Key%20NANG%0ANama%3A%20%0ARoblox%20ID%3A%20%0ABukti%20TF%3A%20" class="wa-btn" target="_blank">
      💬 Chat WhatsApp Owner
    </a>
  </div>
  <div class="card">
    <h3>🔍 Cek Username Roblox</h3>
    <input type="text" id="lookupId" placeholder="Masukkan Roblox User ID">
    <button class="primary" onclick="doLookup()">Cek Username</button>
    <div class="result-box" id="lookupResult"></div>
  </div>
</div>

<!-- TAB 1: Bypass -->
<div class="panel" id="tab1">
  <div class="card">
    <h3>🔓 Bypass Shortlink</h3>
    <div class="supported-box">
      <div class="sup-title">✅ Link yang didukung:</div>
      <div class="sup-tags">
        <span class="tag">Linkvertise</span>
        <span class="tag">Lootlabs</span>
        <span class="tag">Lootdest</span>
        <span class="tag">Playrole</span>
        <span class="tag">Sub2Unlock</span>
        <span class="tag">Work.ink</span>
        <span class="tag">Flux.li</span>
        <span class="tag">Paste.to</span>
        <span class="tag">Direct.lc</span>
        <span class="tag">Pastebin</span>
      </div>
    </div>
    <input type="text" id="bypassUrl" placeholder="Paste link di sini...">
    <button class="primary" onclick="doBypass()">⚡ Bypass Sekarang</button>
    <div class="result-box" id="bypassResult"></div>
  </div>
  <div class="card">
    <h3>📋 Cara Pakai</h3>
    <div class="info-box">
      1. Copy link dari game/script Roblox<br>
      2. Paste di kolom di atas<br>
      3. Klik Bypass Sekarang<br>
      4. Copy link hasil bypass ✅
    </div>
  </div>
</div>

<footer>NANG RBXM Tool</footer>

<script>
function switchTab(i) {
  document.querySelectorAll('.tab').forEach((t,j)=>t.classList.toggle('active',i===j));
  document.querySelectorAll('.panel').forEach((p,j)=>p.classList.toggle('active',i===j));
}

async function doLookup() {
  const uid = document.getElementById('lookupId').value.trim();
  const box = document.getElementById('lookupResult');
  if (!uid) return;
  box.style.display='block';
  box.className='result-box';
  box.innerHTML='<span class="spinner"></span>Mencari...';
  try {
    const r = await fetch('/?lookup='+encodeURIComponent(uid));
    const d = await r.json();
    if (d.name) {
      box.className='result-box ok';
      box.innerHTML='✅ Username: <b>'+d.name+'</b> (ID: '+d.uid+')';
    } else {
      box.className='result-box error';
      box.innerHTML='❌ User ID tidak ditemukan';
    }
  } catch(e) {
    box.className='result-box error';
    box.innerHTML='❌ Error: '+e.message;
  }
}

async function doBypass() {
  const link = document.getElementById('bypassUrl').value.trim();
  const box = document.getElementById('bypassResult');
  if (!link) return;
  box.style.display='block';
  box.className='result-box';
  box.innerHTML='<span class="spinner"></span>Memproses...';
  try {
    const r = await fetch('/?bypass='+encodeURIComponent(link));
    const d = await r.json();
    if (d.result || d.url || d.bypassed_url) {
      const url = d.result || d.url || d.bypassed_url;
      window._bypassUrl = url;
      box.className='result-box ok';
      box.innerHTML='✅ Bypass berhasil!<br><div style="margin-top:6px;background:#0a1a2a;padding:8px;border-radius:6px;border:1px solid #1a3d5d"><a href="'+url+'" target="_blank" style="color:#00ccff;word-break:break-all;font-size:0.8rem">'+url+'</a></div><button onclick="navigator.clipboard.writeText(window._bypassUrl);this.textContent=\'✅ Copied!\'" style="margin-top:8px;padding:6px 14px;background:#00ccff;color:#000;border:none;border-radius:6px;font-weight:bold;cursor:pointer;font-size:0.8rem">📋 Copy Link</button>';
    } else {
      box.className='result-box error';
      box.innerHTML='❌ '+(d.error||d.message||'Bypass gagal. Coba link lain.');
    }
  } catch(e) {
    box.className='result-box error';
    box.innerHTML='❌ Error: '+e.message;
  }
}
</script>
</body>
</html>`;
}
