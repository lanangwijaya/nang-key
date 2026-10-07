export const config = {
  api: {
    bodyParser: {
      sizeLimit: '6mb',
    },
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const operationId = req.query.id;
    const apiKey = req.query.k;
    if (!operationId || !apiKey) return res.status(200).json({ ok: false, error: 'missing' });
    try {
      const r = await fetch('https://apis.roblox.com/assets/v1/operations/' + encodeURIComponent(operationId), {
        method: 'GET',
        headers: { 'x-api-key': apiKey },
      });
      const data = await r.json();
      if (data.done) {
        if (data.error) return res.status(200).json({ ok: true, done: true, error: data.error.message || 'Upload gagal' });
        return res.status(200).json({ ok: true, done: true, assetId: data.response && data.response.assetId });
      }
      return res.status(200).json({ ok: true, done: false });
    } catch (e) { return res.status(200).json({ ok: false, error: String(e.message || e) }); }
  }

  if (req.method === 'POST') {
    const body = req.body;
    if (!body || !body.action) return res.status(200).json({ ok: false, error: 'bad request' });

    if (body.action === 'lookup') {
      const username = String(body.username || '').trim();
      if (!username) return res.status(200).json({ ok: false, error: 'username kosong' });
      try {
        const r = await fetch('https://users.roblox.com/v1/usernames/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ usernames: [username], excludeBannedUsers: true }),
        });
        const data = await r.json();
        if (!data.data || !data.data[0]) return res.status(200).json({ ok: false, error: 'Username tidak ditemukan' });
        return res.status(200).json({ ok: true, userId: data.data[0].id, name: data.data[0].name });
      } catch (e) { return res.status(200).json({ ok: false, error: String(e.message || e) }); }
    }

    if (body.action === 'upload') {
      const { apiKey, userId, fileName, fileBase64, displayName, description } = body;
      if (!apiKey) return res.status(200).json({ ok: false, error: 'API key kosong' });
      if (!userId) return res.status(200).json({ ok: false, error: 'userId kosong' });
      if (!fileBase64) return res.status(200).json({ ok: false, error: 'file kosong' });
      try {
        const buffer = Buffer.from(fileBase64, 'base64');
        const form = new FormData();
        const blob = new Blob([buffer], { type: 'application/octet-stream' });
        form.append('file', blob, fileName || 'model.rbxm');
        form.append('assetType', 'Model');
        form.append('displayName', String(displayName || 'Model').slice(0, 50));
        form.append('description', String(description || '').slice(0, 1000));
        form.append('creationContext', JSON.stringify({ creator: { userId: Number(userId) } }));
        const r = await fetch('https://apis.roblox.com/assets/v1/assets', {
          method: 'POST',
          headers: { 'x-api-key': apiKey },
          body: form,
        });
        const text = await r.text();
        let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
        if (!r.ok) {
          const msg = data.message || data.error || data.raw || ('HTTP ' + r.status);
          return res.status(200).json({ ok: false, error: 'Roblox: ' + msg });
        }
        const operationId = data.operationId || (data.path && data.path.split('/').pop());
        if (!operationId) return res.status(200).json({ ok: false, error: 'Tidak dapat operationId' });
        return res.status(200).json({ ok: true, operationId });
      } catch (e) { return res.status(200).json({ ok: false, error: String(e.message || e) }); }
    }

    return res.status(200).json({ ok: false, error: 'unknown action' });
  }

  return res.status(200).json({ ok: false, error: 'method not allowed' });
}
