// NANG RBXM - Key System (Simple Hash)
const SECRET = "NANG2024";
const EXPIRE_S = 86400;

function getWindow() {
    return Math.floor(Date.now() / 1000 / EXPIRE_S);
}

// Hash simpel: sama persis di Lua dan JS
function simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = ((h * 31) + str.charCodeAt(i)) % 1000000007;
    }
    return h;
}

function makeKey(uid, w) {
    const raw = SECRET + uid + w;
    const h = simpleHash(raw);
    const p1 = String(uid).slice(0, 5).padEnd(5, "0");
    const p2 = String(h % 10000).padStart(4, "0");
    const p3 = String(Math.floor(h / 10000) % 10000).padStart(4, "0");
    return "NANG-" + p1 + "-" + p2 + "-" + p3;
}

function isValid(uid, key) {
    const w = getWindow();
    const k = key.toUpperCase().trim();
    return k === makeKey(uid, w) || k === makeKey(uid, w - 1);
}

function expiry() {
    const w = getWindow();
    const ms = ((w + 1) * EXPIRE_S * 1000) - Date.now();
    return Math.floor(ms / 3600000) + "j " + Math.floor((ms % 3600000) / 60000) + "m";
}

const ADMIN = "nangowner123";

const UPAGE = '<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>NANG RBXM - Key</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#050e05;color:#c8f0c8;font-family:system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.c{background:#081408;border:1.5px solid #1a6b1a;border-radius:18px;padding:36px;max-width:420px;width:100%;position:relative}.b{position:absolute;top:0;left:20px;right:20px;height:3px;background:linear-gradient(90deg,#1a8c1a,#28a028,#1a8c1a);border-radius:0 0 4px 4px}h1{font-size:24px;font-weight:800;color:#28c828;margin-bottom:6px}p{font-size:11px;color:#5a9a5a;margin-bottom:22px;line-height:1.6}input{width:100%;background:#0a1e0a;border:1.5px solid #1a4a1a;border-radius:10px;padding:12px 14px;font-size:14px;color:#c8f0c8;outline:none;margin-bottom:12px}input:focus{border-color:#28a028}input::placeholder{color:#2a5a2a}button{width:100%;background:#1e7a1e;border:none;border-radius:10px;padding:13px;font-size:13px;font-weight:700;color:#fff;cursor:pointer}.res{display:none;margin-top:18px;background:#0a1e0a;border:1.5px solid #1e6a1e;border-radius:12px;padding:16px}.res.on{display:block}.lbl{font-size:10px;font-weight:700;color:#4a8a4a;text-transform:uppercase;margin-bottom:6px}.kd{font-family:monospace;font-size:16px;font-weight:700;color:#50e050;background:#061006;border:1px solid #1a4a1a;border-radius:8px;padding:10px 14px;word-break:break-all;margin-bottom:8px}.cb{width:auto;padding:7px 16px;font-size:11px;background:#144a14;margin-bottom:8px}.exp{font-size:11px;color:#3a7a3a}.err{display:none;margin-top:10px;padding:9px 13px;background:#1a0808;border:1px solid #5a1a1a;border-radius:8px;font-size:11px;color:#e06060}.err.on{display:block}</style></head><body><div class="c"><div class="b"></div><h1>NANG RBXM</h1><p>Masukkan UserId Roblox kamu.<br>Key berlaku <b style="color:#28a028">24 jam</b>.</p><input type="number" id="u" placeholder="UserId kamu..." min="1"><button onclick="go()">DAPATKAN KEY</button><div class="err" id="e"></div><div class="res" id="r"><div class="lbl">Key Kamu</div><div class="kd" id="k">-</div><button class="cb" onclick="cp()">Salin Key</button><div class="exp" id="x"></div></div></div><script>const q=new URLSearchParams(location.search);if(q.get("uid"))document.getElementById("u").value=q.get("uid");async function go(){const u=document.getElementById("u").value.trim(),e=document.getElementById("e"),r=document.getElementById("r");e.classList.remove("on");r.classList.remove("on");if(!u||isNaN(+u)||+u<1){e.textContent="UserId tidak valid.";e.classList.add("on");return}try{const x=await fetch("/api?uid="+u),d=await x.json();if(!d.ok){e.textContent=d.error||"Error";e.classList.add("on");return}document.getElementById("k").textContent=d.key;document.getElementById("x").textContent="Expired dalam "+d.exp;r.classList.add("on")}catch(err){e.textContent="Gagal.";e.classList.add("on")}}function cp(){const k=document.getElementById("k").textContent;navigator.clipboard.writeText(k).then(()=>{const b=document.querySelector(".cb");b.textContent="Tersalin!";setTimeout(()=>b.textContent="Salin Key",2e3)})}document.getElementById("u").addEventListener("keydown",e=>{if(e.key==="Enter")go()})</script></body></html>';

const APAGE = '<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>NANG Admin</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#050e05;color:#c8f0c8;font-family:system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.c{background:#081408;border:1.5px solid #6b1a1a;border-radius:18px;padding:36px;max-width:420px;width:100%;position:relative}.b{position:absolute;top:0;left:20px;right:20px;height:3px;background:linear-gradient(90deg,#8c1a1a,#c02828,#8c1a1a);border-radius:0 0 4px 4px}h1{font-size:24px;font-weight:800;color:#e05050;margin-bottom:6px}.badge{display:inline-block;background:#3a0a0a;border:1px solid #6a1a1a;border-radius:6px;padding:3px 10px;font-size:10px;color:#e05050;font-weight:700;margin-bottom:14px}p{font-size:11px;color:#5a9a5a;margin-bottom:22px;line-height:1.6}input{width:100%;background:#0a1e0a;border:1.5px solid #1a4a1a;border-radius:10px;padding:12px 14px;font-size:14px;color:#c8f0c8;outline:none;margin-bottom:12px}input:focus{border-color:#28a028}input::placeholder{color:#2a5a2a}button{width:100%;background:#7a1e1e;border:none;border-radius:10px;padding:13px;font-size:13px;font-weight:700;color:#fff;cursor:pointer}.res{display:none;margin-top:18px;background:#0a1e0a;border:1.5px solid #1e6a1e;border-radius:12px;padding:16px}.res.on{display:block}.lbl{font-size:10px;font-weight:700;color:#4a8a4a;text-transform:uppercase;margin-bottom:6px}.kd{font-family:monospace;font-size:16px;font-weight:700;color:#50e050;background:#061006;border:1px solid #1a4a1a;border-radius:8px;padding:10px 14px;word-break:break-all;margin-bottom:8px}.cb{width:auto;padding:7px 16px;font-size:11px;background:#144a14;margin-bottom:8px}.exp{font-size:11px;color:#3a7a3a}.err{display:none;margin-top:10px;padding:9px 13px;background:#1a0808;border:1px solid #5a1a1a;border-radius:8px;font-size:11px;color:#e06060}.err.on{display:block}</style></head><body><div class="c"><div class="b"></div><h1>NANG ADMIN</h1><div class="badge">OWNER ONLY</div><p>Generate key untuk player yang sudah bayar.</p><input type="number" id="u" placeholder="UserId player..." min="1" autofocus><button onclick="go()">GENERATE KEY</button><div class="err" id="e"></div><div class="res" id="r"><div class="lbl">Key Player</div><div class="kd" id="k">-</div><button class="cb" onclick="cp()">Salin Key</button><div class="exp" id="x"></div></div></div><script>async function go(){const u=document.getElementById("u").value.trim(),e=document.getElementById("e"),r=document.getElementById("r");e.classList.remove("on");r.classList.remove("on");if(!u||isNaN(+u)||+u<1){e.textContent="UserId tidak valid.";e.classList.add("on");return}try{const x=await fetch("/api?uid="+u),d=await x.json();if(!d.ok){e.textContent=d.error||"Error";e.classList.add("on");return}document.getElementById("k").textContent=d.key;document.getElementById("x").textContent="Expired dalam "+d.exp;r.classList.add("on")}catch(err){e.textContent="Gagal.";e.classList.add("on")}}function cp(){const k=document.getElementById("k").textContent;navigator.clipboard.writeText(k).then(()=>{const b=document.querySelector(".cb");b.textContent="Tersalin!";setTimeout(()=>b.textContent="Salin Key",2e3)})}document.getElementById("u").addEventListener("keydown",e=>{if(e.key==="Enter")go()})</script></body></html>';

export default function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(200).end();

    if (req.method === "GET" && req.query.admin !== undefined) {
        if (req.query.admin !== ADMIN) {
            res.setHeader("Content-Type", "text/html");
            return res.status(403).send("<body style='background:#050e05;color:#e05050;padding:40px;font-family:sans-serif'><h2>Password salah.</h2></body>");
        }
        res.setHeader("Content-Type", "text/html");
        return res.status(200).send(APAGE);
    }

    if (req.method === "GET" && req.query.uid && req.query.key) {
        const uid = Number(req.query.uid);
        if (!uid || isNaN(uid)) return res.status(400).json({ ok: false, error: "UserId tidak valid" });
        const valid = isValid(uid, req.query.key);
        return res.status(200).json({ ok: valid });
    }

    if (req.method === "GET" && req.query.uid) {
        const uid = Number(req.query.uid);
        if (!uid || isNaN(uid)) return res.status(400).json({ ok: false, error: "UserId tidak valid" });
        const w = getWindow();
        return res.status(200).json({ ok: true, key: makeKey(uid, w), uid, exp: expiry() });
    }

    if (req.method === "GET") {
        res.setHeader("Content-Type", "text/html");
        return res.status(200).send(UPAGE);
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" });
}
