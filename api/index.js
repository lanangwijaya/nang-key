async function doBypass(){
  const link = document.getElementById('bypassUrl').value.trim();
  const box = document.getElementById('bypassResult');
  if(!link) return;
  box.style.display = 'block';
  box.className = 'result';
  box.innerHTML = '<span class="spinner"></span>Memproses link...';
  try {
    const r = await fetch('/?bypass=' + encodeURIComponent(link));
    const d = await r.json();
    if(d.result){
      const url = d.result;
      window._bypassUrl = url;
      const isOriginal = d.source === 'original';
      box.className = 'result ' + (isOriginal ? 'err' : 'ok');
      const label = isOriginal ? 'Bypass API down — buka link asli:' : 'Bypass berhasil!';
      const src = d.source && d.source !== 'original' ? '<div style="font-size:.7rem;color:#6b6b8a;margin-top:4px">via ' + d.source + '</div>' : '';
      box.innerHTML = label + src +
        '<div class="key-line"><a href="' + url + '" target="_blank" style="color:#00d4ff;text-decoration:none">' + url + '</a></div>' +
        '<button class="btn-green" onclick="navigator.clipboard.writeText(window._bypassUrl);this.textContent=\\'COPIED\\';setTimeout(()=>this.textContent=\\'COPY LINK\\',1500)">COPY LINK</button>' +
        (d.warning ? '<div style="font-size:.72rem;color:#6b6b8a;margin-top:8px">' + d.warning + '</div>' : '');
    } else {
      box.className = 'result err';
      box.innerHTML = d.error || d.message || 'Bypass gagal.';
    }
  } catch(e) {
    box.className = 'result err';
    box.innerHTML = 'Error: ' + e.message;
  }
}
