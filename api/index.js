// NANG RBXM - Key System (Single File)
// Deploy ke Vercel: buat repo GitHub, upload file ini ke folder api/index.js
// Vercel otomatis detect sebagai serverless function

const SECRET = "NANG_SECRET_2024_XK9Z"; // ganti kalau mau
const EXPIRE_MS = 24 * 60 * 60 * 1000;

function getTimeWindow() {
    return Math.floor(Date.now() / EXPIRE_MS);
}

function generateKey(userId, window) {
    const raw = `${SECRET}:${userId}:${window}`;
    let h = 2166136261;
    for (let i = 0; i < raw.length; i++) {
        h ^= raw.charCodeAt(i);
        h = Math.imul(h, 16777619);
        h >>>= 0;
    }
    const part1 = String(userId).slice(0, 5).padEnd(5, "0");
    const part2 = (h & 0xFFFF).toString(16).toUpperCase().padStart(4, "0");
    const part3 = ((h >>> 16) & 0xFFFF).toString(16).toUpperCase().padStart(4, "0");
    return `NANG-${part1}-${part2}-${part3}`;
}

function isValidKey(userId, key) {
    const w = getTimeWindow();
    return key === generateKey(userId, w) || key === generateKey(userId, w - 1);
}

const PAGE_HTML = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NANG RBXM â€” Key System</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#050e05;color:#c8f0c8;font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
body::before{content:'';position:fixed;inset:0;background-image:linear-gradient(rgba(40,160,40,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(40,160,40,.04) 1px,transparent 1px);background-size:40px 40px;pointer-events:none;z-index:0}
.card{position:relative;z-index:1;background:#081408;border:1.5px solid #1a6b1a;border-radius:18px;padding:36px;max-width:420px;width:100%;box-shadow:0 0 40px rgba(40,160,40,.08),0 8px 32px rgba(0,0,0,.6)}
.accent-bar{position:absolute;top:0;left:20px;right:20px;height:3px;background:linear-gradient(90deg,#1a8c1a,#28a028,#1a8c1a);border-radius:0 0 4px 4px}
.logo{font-size:26px;font-weight:800;color:#28c828;letter-spacing:2px;margin-bottom:4px}
.logo span{color:#50a050;font-size:18px;font-weight:600}
.sub{font-size:11px;color:#5a9a5a;margin-bottom:28px;line-height:1.6}
label{display:block;font-size:10px;font-weight:700;color:#4a8a4a;letter-spacing:.5px;margin-bottom:7px;text-transform:uppercase}
input{width:100%;background:#0a1e0a;border:1.5px solid #1a4a1a;border-radius:10px;padding:13px 15px;font-size:14px;color:#c8f0c8;outline:none;transition:border-color .2s;margin-bottom:14px;font-family:inherit}
input:focus{border-color:#28a028;box-shadow:0 0 0 3px rgba(40,160,40,.12)}
input::placeholder{color:#2a5a2a}
button{width:100%;background:#1e7a1e;border:none;border-radius:10px;padding:13px;font-size:13px;font-weight:700;color:#fff;cursor:pointer;transition:background .2s,transform .1s;letter-spacing:1px}
button:hover{background:#28a028}
button:active{transform:scale(.98)}
button:disabled{background:#0f3a0f;color:#2a5a2a;cursor:not-allowed}
.result{display:none;margin-top:22px;background:#0a1e0a;border:1.5px solid #1e6a1e;border-radius:12px;padding:18px}
.result.show{display:block}
.rl{font-size:10px;font-weight:700;color:#4a8a4a;text-transform:uppercase;letter-spacing:.5px;margin-bottom:7px}
.key-display{font-family:'Courier New',monospace;font-size:17px;font-weight:700;color:#50e050;letter-spacing:2px;background:#061006;border:1px solid #1a4a1a;border-radius:8px;padding:11px 15px;word-break:break-all;margin-bottom:10px}
.copy-btn{width:auto;padding:7px 18px;font-size:11px;background:#144a14;margin-bottom:10px}
.copy-btn:hover{background:#1e6a1e}
.exp{font-size:11px;color:#3a7a3a;display:flex;align-items:center;gap:6px}
.dot{width:6px;height:6px;background:#28a028;border-radius:50%;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.err{display:none;margin-top:10px;padding:9px 13px;background:#1a0808;border:1px solid #5a1a1a;border-radius:8px;font-size:11px;color:#e06060}
.err.show{display:block}
.footer{margin-top:24px;font-size:10px;color:#1e4e1e;text-align:center;line-height:1.6}
</style>
</head>
<body>
<div class="card">
<div class="accent-bar"></div>
<div class="logo">NANG <span>RBXM</span></div>
<p class="sub">Masukkan Roblox UserId kamu untuk mendapatkan key akses.<br>Key berlaku <strong style="color:#28a028">24 jam</strong> lalu expired otomatis.</p>
<label for="uid">Roblox UserId</label>
<input type="number" id="uid" placeholder="Contoh: 8236629801" min="1">
<button id="btn" onclick="getKey()">DAPATKAN KEY</button>
<div class="err" id="err"></div>
<div class="result" id="res">
<div class="rl">Key Kamu</div>
<div class="key-display" id="key">â€”</div>
<button class="copy-btn" onclick="copyKey()">ðŸ“‹ COPY KEY</button>
<div class="exp"><div class="dot"></div><span id="exp">â€”</span></div>
</div>
<div class="footer">NANG RBXM v64.0 â€¢ Key expired tiap 24 jam â€” generate ulang kalau habis</div>
</div>
<script>
const p=new URLSearchParams(location.search);
if(p.get('uid'))document.getElementById('uid').value=p.get('uid');
async function getKey(){
  const uid=document.getElementById('uid').value.trim();
  const btn=document.getElementById('btn');
  const err=document.getElementById('err');
  const res=document.getElementById('res');
  err.classList.remove('show');res.classList.remove('show');
  if(!uid||isNaN(+uid)||+uid<1){err.textContent='UserId tidak valid.';err.classList.add('show');return}
  btn.disabled=true;btn.textContent='MEMUAT...';
  try{
    const r=await fetch('/api?uid='+uid);
    const d=await r.json();
    if(!d.ok){err.textContent=d.error||'Terjadi kesalahan.';err.classList.add('show');return}
    document.getElementById('key').textContent=d.key;
    document.getElementById('exp').textContent='Expired dalam '+d.expiresIn;
    res.classList.add('show');
  }catch(e){err.textContent='Gagal hubungi server.';err.classList.add('show');}
  finally{btn.disabled=false;btn.textContent='DAPATKAN KEY';}
}
function copyKey(){
  const k=document.getElementById('key').textContent;
  navigator.clipboard.writeText(k).then(()=>{
    const b=document.querySelector('.copy-btn');
    b.textContent='âœ“ TERSALIN!';
    setTimeout(()=>b.textContent='ðŸ“‹ COPY KEY',2000);
  });
}
document.getElementById('uid').addEventListener('keydown',e=>{if(e.key==='Enter')getKey()});
</script>
</body>
</html>`;

export default function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(200).end();

    // Tampilkan halaman HTML
    if (req.method === "GET" && !req.query.uid && !req.query.validate) {
        res.setHeader("Content-Type", "text/html");
        return res.status(200).send(PAGE_HTML);
    }

    // GET ?uid=xxx&key=yyy â†’ validate key dari Roblox (Delta pakai GetAsync)
    if (req.method === "GET" && req.query.uid && req.query.key) {
        const userId = Number(req.query.uid);
        if (!userId || isNaN(userId)) return res.status(400).json({ ok: false, error: "UserId tidak valid" });
        const valid = isValidKey(userId, String(req.query.key).toUpperCase().trim());
        return res.status(200).json({ ok: valid, userId });
    }

    // GET ?uid=xxx â†’ generate key (untuk website)
    if (req.method === "GET" && req.query.uid) {
        const userId = Number(req.query.uid);
        if (!userId || isNaN(userId)) return res.status(400).json({ ok: false, error: "UserId tidak valid" });
        const w = getTimeWindow();
        const key = generateKey(userId, w);
        const msLeft = ((w + 1) * EXPIRE_MS) - Date.now();
        const h = Math.floor(msLeft / 3600000);
        const m = Math.floor((msLeft % 3600000) / 60000);
        return res.status(200).json({ ok: true, key, userId, expiresIn: `${h}j ${m}m` });
    }

    // POST â†’ validate key dari Roblox
    if (req.method === "POST") {
        let body = req.body;
        if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
        const { uid, key } = body || {};
        const userId = Number(uid);
        if (!userId || isNaN(userId) || !key) return res.status(400).json({ ok: false, error: "uid dan key wajib" });
        const valid = isValidKey(userId, String(key).toUpperCase().trim());
        return res.status(200).json({ ok: valid, userId });
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" });
}
