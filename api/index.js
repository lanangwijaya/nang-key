// NANG RBXM - Key System
const SECRET = "NANG_SECRET_2024_XK9Z";
const EXPIRE_S = 86400;

function getTimeWindow() {
    return Math.floor(Date.now() / 1000 / EXPIRE_S);
}

function fnv1a(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
        h >>>= 0;
    }
    return h;
}

function generateKey(userId, w) {
    const raw = SECRET + ":" + userId + ":" + w;
    const h = fnv1a(raw);
    const part1 = String(userId).slice(0, 5).padEnd(5, "0");
    const part2 = (h & 0xFFFF).toString(16).toUpperCase().padStart(4, "0");
    const part3 = ((h >>> 16) & 0xFFFF).toString(16).toUpperCase().padStart(4, "0");
    return "NANG-" + part1 + "-" + part2 + "-" + part3;
}

function isValidKey(userId, key) {
    const w = getTimeWindow();
    return key === generateKey(userId, w) || key === generateKey(userId, w - 1);
}

function getExpiresIn() {
    const w = getTimeWindow();
    const msLeft = ((w + 1) * EXPIRE_S * 1000) - Date.now();
    const h = Math.floor(msLeft / 3600000);
    const m = Math.floor((msLeft % 3600000) / 60000);
    return h + "j " + m + "m";
}

const ADMIN_PASS = "nangowner123";

const USER_PAGE = '<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>NANG RBXM - Key</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#050e05;color:#c8f0c8;font-family:system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.card{background:#081408;border:1.5px solid #1a6b1a;border-radius:18px;padding:36px;max-width:420px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.6);position:relative}.bar{position:absolute;top:0;left:20px;right:20px;height:3px;background:linear-gradient(90deg,#1a8c1a,#28a028,#1a8c1a);border-radius:0 0 4px 4px}.logo{font-size:26px;font-weight:800;color:#28c828;letter-spacing:2px;margin-bottom:4px}.sub{font-size:11px;color:#5a9a5a;margin-bottom:24px;line-height:1.6}label{display:block;font-size:10px;font-weight:700;color:#4a8a4a;margin-bottom:7px;text-transform:uppercase}input{width:100%;background:#0a1e0a;border:1.5px solid #1a4a1a;border-radius:10px;padding:13px 15px;font-size:14px;color:#c8f0c8;outline:none;margin-bottom:14px;font-family:inherit}input:focus{border-color:#28a028}input::placeholder{color:#2a5a2a}button{width:100%;background:#1e7a1e;border:none;border-radius:10px;padding:13px;font-size:13px;font-weight:700;color:#fff;cursor:pointer;letter-spacing:1px}.res{display:none;margin-top:20px;background:#0a1e0a;border:1.5px solid #1e6a1e;border-radius:12px;padding:18px}.res.show{display:block}.rl{font-size:10px;font-weight:700;color:#4a8a4a;text-transform:uppercase;margin-bottom:7px}.kd{font-family:monospace;font-size:17px;font-weight:700;color:#50e050;background:#061006;border:1px solid #1a4a1a;border-radius:8px;padding:11px 15px;word-break:break-all;margin-bottom:10px}.cb{width:auto;padding:7px 18px;font-size:11px;background:#144a14;margin-bottom:10px}.exp{font-size:11px;color:#3a7a3a}.err{display:none;margin-top:10px;padding:9px 13px;background:#1a0808;border:1px solid #5a1a1a;border-radius:8px;font-size:11px;color:#e06060}.err.show{display:block}</style></head><body><div class="card"><div class="bar"></div><div class="logo">NANG RBXM</div><p class="sub">Masukkan UserId kamu untuk dapatkan key akses.<br>Key berlaku <strong style="color:#28a028">24 jam</strong>.</p><label>Roblox UserId</label><input type="number" id="uid" placeholder="Contoh: 9714755396" min="1"><button onclick="go()">DAPATKAN KEY</button><div class="err" id="err"></div><div class="res" id="res"><div class="rl">Key Kamu</div><div class="kd" id="key">-</div><button class="cb" onclick="cp()">Salin Key</button><div class="exp" id="exp"></div></div></div><script>const p=new URLSearchParams(location.search);if(p.get("uid"))document.getElementById("uid").value=p.get("uid");async function go(){const u=document.getElementById("uid").value.trim();const e=document.getElementById("err");const r=document.getElementById("res");e.classList.remove("show");r.classList.remove("show");if(!u||isNaN(+u)||+u<1){e.textContent="UserId tidak valid.";e.classList.add("show");return}const b=document.getElementById("uid").previousElementSibling.nextElementSibling;b.textContent="MEMUAT...";b.disabled=true;try{const x=await fetch("/api?uid="+u);const d=await x.json();if(!d.ok){e.textContent=d.error||"Error";e.classList.add("show");return}document.getElementById("key").textContent=d.key;document.getElementById("exp").textContent="Expired dalam "+d.exp;r.classList.add("show")}catch(err){e.textContent="Gagal hubungi server.";e.classList.add("show")}finally{b.textContent="DAPATKAN KEY";b.disabled=false}}function cp(){const k=document.getElementById("key").textContent;navigator.clipboard.writeText(k).then(()=>{const b=document.querySelector(".cb");b.textContent="Tersalin!";setTimeout(()=>b.textContent="Salin Key",2000)})}document.getElementById("uid").addEventListener("keydown",e=>{if(e.key==="Enter")go()})</script></body></html>';

const ADMIN_PAGE = '<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>NANG Admin</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#050e05;color:#c8f0c8;font-family:system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.card{background:#081408;border:1.5px solid #6b1a1a;border-radius:18px;padding:36px;max-width:420px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.6);position:relative}.bar{position:absolute;top:0;left:20px;right:20px;height:3px;background:linear-gradient(90deg,#8c1a1a,#c02828,#8c1a1a);border-radius:0 0 4px 4px}.logo{font-size:24px;font-weight:800;color:#e05050;letter-spacing:2px;margin-bottom:4px}.badge{display:inline-block;background:#3a0a0a;border:1px solid #6a1a1a;border-radius:6px;padding:3px 10px;font-size:10px;color:#e05050;font-weight:700;margin-bottom:16px;letter-spacing:1px}.sub{font-size:11px;color:#5a9a5a;margin-bottom:24px;line-height:1.6}label{display:block;font-size:10px;font-weight:700;color:#4a8a4a;margin-bottom:7px;text-transform:uppercase}input{width:100%;background:#0a1e0a;border:1.5px solid #1a4a1a;border-radius:10px;padding:13px 15px;font-size:14px;color:#c8f0c8;outline:none;margin-bottom:14px;font-family:inherit}input:focus{border-color:#28a028}input::placeholder{color:#2a5a2a}button{width:100%;background:#7a1e1e;border:none;border-radius:10px;padding:13px;font-size:13px;font-weight:700;color:#fff;cursor:pointer;letter-spacing:1px}.res{display:none;margin-top:20px;background:#0a1e0a;border:1.5px solid #1e6a1e;border-radius:12px;padding:18px}.res.show{display:block}.rl{font-size:10px;font-weight:700;color:#4a8a4a;text-transform:uppercase;margin-bottom:7px}.kd{font-family:monospace;font-size:17px;font-weight:700;color:#50e050;background:#061006;border:1px solid #1a4a1a;border-radius:8px;padding:11px 15px;word-break:break-all;margin-bottom:10px}.cb{width:auto;padding:7px 18px;font-size:11px;background:#144a14;margin-bottom:10px}.exp{font-size:11px;color:#3a7a3a}.err{display:none;margin-top:10px;padding:9px 13px;background:#1a0808;border:1px solid #5a1a1a;border-radius:8px;font-size:11px;color:#e06060}.err.show{display:block}</style></head><body><div class="card"><div class="bar"></div><div class="logo">NANG ADMIN</div><div class="badge">OWNER ONLY</div><p class="sub">Generate key untuk player yang sudah bayar.<br>Input UserId player lalu kirim key ke mereka.</p><label>UserId Player</label><input type="number" id="uid" placeholder="Contoh: 9714755396" min="1" autofocus><button onclick="go()">GENERATE KEY</button><div class="err" id="err"></div><div class="res" id="res"><div class="rl">Key Player</div><div class="kd" id="key">-</div><button class="cb" onclick="cp()">Salin Key</button><div class="exp" id="exp"></div></div></div><script>async function go(){const u=document.getElementById("uid").value.trim();const e=document.getElementById("err");const r=document.getElementById("res");e.classList.remove("show");r.classList.remove("show");if(!u||isNaN(+u)||+u<1){e.textContent="UserId tidak valid.";e.classList.add("show");return}try{const x=await fetch("/api?uid="+u);const d=await x.json();if(!d.ok){e.textContent=d.error||"Error";e.classList.add("show");return}document.getElementById("key").textContent=d.key;document.getElementById("exp").textContent="Expired dalam "+d.exp;r.classList.add("show")}catch(err){e.textContent="Gagal.";e.classList.add("show")}}function cp(){const k=document.getElementById("key").textContent;navigator.clipboard.writeText(k).then(()=>{const b=document.querySelector(".cb");b.textContent="Tersalin!";setTimeout(()=>b.textContent="Salin Key",2000)})}document.getElementById("uid").addEventListener("keydown",e=>{if(e.key==="Enter")go()})</script></body></html>';

export default function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(200).end();

    // Admin panel
    if (req.method === "GET" && req.query.admin !== undefined) {
        if (req.query.admin !== ADMIN_PASS) {
            res.setHeader("Content-Type", "text/html");
            return res.status(403).send("<body style='background:#050e05;color:#e05050;font-family:sans-serif;padding:40px'><h2>Password salah.</h2></body>");
        }
        res.setHeader("Content-Type", "text/html");
        return res.status(200).send(ADMIN_PAGE);
    }

    // GET ?uid=xxx&key=yyy → validate (dari Roblox)
    if (req.method === "GET" && req.query.uid && req.query.key) {
        const userId = Number(req.query.uid);
        if (!userId || isNaN(userId)) return res.status(400).json({ ok: false, error: "UserId tidak valid" });
        const valid = isValidKey(userId, String(req.query.key).toUpperCase().trim());
        return res.status(200).json({ ok: valid });
    }

    // GET ?uid=xxx → generate key
    if (req.method === "GET" && req.query.uid) {
        const userId = Number(req.query.uid);
        if (!userId || isNaN(userId)) return res.status(400).json({ ok: false, error: "UserId tidak valid" });
        const w = getTimeWindow();
        const key = generateKey(userId, w);
        return res.status(200).json({ ok: true, key, userId, exp: getExpiresIn() });
    }

    // GET / → halaman user
    if (req.method === "GET") {
        res.setHeader("Content-Type", "text/html");
        return res.status(200).send(USER_PAGE);
    }

    // POST → validate (alternatif)
    if (req.method === "POST") {
        let body = req.body || {};
        if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
        const userId = Number(body.uid);
        if (!userId || isNaN(userId) || !body.key) return res.status(400).json({ ok: false, error: "uid dan key wajib" });
        const valid = isValidKey(userId, String(body.key).toUpperCase().trim());
        return res.status(200).json({ ok: valid });
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" });
}
