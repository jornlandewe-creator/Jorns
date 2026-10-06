// Live preview in de Studio: draait de showcase-engine realtime in een iframe.
(function () {
  let tl = null, t = 0, playing = true, last = performance.now(), loop = true;
  const preloaded = new Set();
  function preload(tl) {
    (tl.objects || []).forEach((o) => {
      const srcs = [];
      if (o.src) srcs.push(o.src);
      if (o.screen) srcs.push(o.screen);
      srcs.forEach((s) => {
        if (s.kind === 'clip') {
          for (let i = 1; i <= s.count; i++) {
            const n = String(i).padStart(5, '0');
            [`${s.pdir || s.dir}/${n}.jpg`, `${s.bdir}/${n}.jpg`].forEach((u) => { if (!preloaded.has(u)) { preloaded.add(u); const im = new Image(); im.src = u; } });
          }
        } else if (s.url) {
          [s.url, s.burl].forEach((u) => { if (u && !preloaded.has(u)) { preloaded.add(u); const im = new Image(); im.src = u; } });
        }
      });
    });
  }
  window.addEventListener('message', (e) => {
    const m = e.data || {};
    if (m.type === 'timeline') {
      tl = { ...m.tl, live: true, proxy: true };
      window.SC.init(tl);
      preload(tl);
      if (t > tl.duration) t = 0;
      window.SC.render(t);
    } else if (m.type === 'play') { playing = true; last = performance.now(); }
    else if (m.type === 'pause') { playing = false; }
    else if (m.type === 'seek') { t = Math.max(0, Math.min(tl ? tl.duration : 0, m.t)); window.SC.render(t); }
    else if (m.type === 'loop') { loop = !!m.on; }
    else if (m.type === 'frame') { window.SC.setFrame(m.k, m.frame); window.SC.render(t); }
  });
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (tl && playing) {
      t += dt;
      if (t > tl.duration) { if (loop) t = 0; else { t = tl.duration; playing = false; } }
      window.SC.render(t);
    }
    if (tl) parent.postMessage({ type: 'time', t, duration: tl.duration, playing }, '*');
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  parent.postMessage({ type: 'ready' }, '*');
})();
