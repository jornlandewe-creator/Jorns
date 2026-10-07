/* Showcase engine: draait in de browser. Bouwt een 3D-scene uit vlakken (matrix3d),
   met depth of field per vlak, schaduwen, belichting, cursor en klik-ringen.
   window.SC.render(t) zet de scene op tijd t; window.SC.speed(t, dt) geeft de schermsnelheid (px). */
(function () {
  let TL, VW, VH, P, CX, CY;

  // ---------- easing ----------
  function bez(x1, y1, x2, y2) {
    return (t) => {
      if (t <= 0) return 0; if (t >= 1) return 1;
      let a = 0, b = 1, u = t;
      for (let i = 0; i < 28; i++) { u = (a + b) / 2; const x = 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u; if (x < t) a = u; else b = u; }
      return 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u;
    };
  }
  const E = {
    linear: (t) => t, inout: bez(0.65, 0, 0.35, 1), out: bez(0.16, 1, 0.3, 1), outSoft: bez(0.22, 1, 0.36, 1),
    in: bez(0.7, 0, 0.84, 0), inQuad: bez(0.55, 0, 1, 0.45), ramp: bez(0.83, 0, 0.17, 1), expo: bez(0.87, 0, 0.13, 1),
    whipIn: bez(0.9, 0, 1, 0.6), whipOut: bez(0, 0.45, 0.1, 1), settle: bez(0.1, 0.9, 0.2, 1),
    back: bez(0.34, 1.5, 0.64, 1), silk: bez(0.45, 0, 0.15, 1),
  };
  const PROPS = ['x', 'y', 'z', 'rx', 'ry', 'rz', 's', 'o', 'px', 'py', 'pz', 'fz', 'dw', 'db', 'lift', 'mx', 'my', 'ms'];

  // Tangenten voor 'flow'-segmenten: monotone Hermite (Fritsch-Butland), dus doorlopende
  // camerabeweging door keyframes heen, zonder overshoot. Aan het begin/eind van een flow-reeks: 0.
  function tangents(kfs) {
    const tan = kfs.map(() => ({}));
    for (let j = 1; j < kfs.length - 1; j++) {
      if (kfs[j].ease !== 'flow' || kfs[j + 1].ease !== 'flow') continue;
      const h0 = kfs[j].t - kfs[j - 1].t, h1 = kfs[j + 1].t - kfs[j].t;
      if (h0 <= 0 || h1 <= 0) continue;
      for (const p of PROPS) {
        const a = kfs[j - 1][p], b = kfs[j][p], c = kfs[j + 1][p];
        if (a === undefined || b === undefined || c === undefined) continue;
        const d0 = (b - a) / h0, d1 = (c - b) / h1;
        // Catmull-Rom (niet-uniform): camera blijft doorbewegen door keyframes, geen stilstand bij een richtingswissel.
        let m = (d0 * h1 + d1 * h0) / (h0 + h1);
        const a0 = Math.abs(d0), a1 = Math.abs(d1), big = Math.max(a0, a1), small = Math.min(a0, a1);
        if (d0 * d1 > 0) { const lim = 3 * small; m = Math.sign(m) * Math.min(Math.abs(m), lim); }
        // grote sprong naast een rustig stuk (overgang -> kadrering): landen zonder doorschieten, meteen in de rustige beweging
        else if (big > 4 * small) m = a0 < a1 ? d0 * 0.5 : d1 * 0.5;
        else m *= 0.3; // echt omkeerpunt: zacht door, heel beperkte overshoot
        tan[j][p] = m;
      }
    }
    // 'fly': shot begint/eindigt op snelheid (speed ramp: snel in, rustig midden, snel uit)
    const n = kfs.length;
    // de grote in-/uitsprong van een overgang mag niet 'lekken' naar het rustige deel: de keyframe ernaast kijkt alleen naar binnen
    const HOLD = ['x', 'y', 'z', 'rx', 'ry', 'rz', 's'];
    if (n >= 3 && kfs[n - 1].fly) { const j = n - 2, h0 = kfs[j].t - kfs[j - 1].t; if (h0 > 0) HOLD.forEach((p) => { if (kfs[j][p] === undefined || kfs[j - 1][p] === undefined) return; tan[j][p] = ((kfs[j][p] - kfs[j - 1][p]) / h0) * 0.5; }); }
    if (n >= 3 && kfs[0].fly) { const j = 1, h1 = kfs[2].t - kfs[1].t; if (h1 > 0) HOLD.forEach((p) => { if (kfs[j][p] === undefined || kfs[2][p] === undefined) return; tan[j][p] = ((kfs[2][p] - kfs[j][p]) / h1) * 0.5; }); }
    if (n > 1 && kfs[0].fly && kfs[1].ease === 'flow') {
      const h = kfs[1].t - kfs[0].t;
      if (h > 0) for (const p of PROPS) { if (kfs[0][p] === undefined) continue; tan[0][p] = ((kfs[1][p] - kfs[0][p]) / h) * kfs[0].fly; }
    }
    if (n > 1 && kfs[n - 1].fly && kfs[n - 1].ease === 'flow') {
      const h = kfs[n - 1].t - kfs[n - 2].t;
      if (h > 0) for (const p of PROPS) { if (kfs[n - 1][p] === undefined) continue; tan[n - 1][p] = ((kfs[n - 1][p] - kfs[n - 2][p]) / h) * kfs[n - 1].fly; }
    }
    return tan;
  }
  function sample(kfs, t, tan) {
    if (!kfs || !kfs.length) return null;
    if (t < kfs[0].t || t > kfs[kfs.length - 1].t) return null;
    if (t === kfs[0].t || kfs.length === 1) return kfs[0];
    for (let i = 1; i < kfs.length; i++) {
      if (t <= kfs[i].t) {
        const a = kfs[i - 1], b = kfs[i];
        const h = Math.max(1e-6, b.t - a.t);
        const o = {};
        if (b.ease === 'flow') {
          const u = (t - a.t) / h, u2 = u * u, u3 = u2 * u;
          const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
          const ta = tan ? tan[i - 1] : {}, tb = tan ? tan[i] : {};
          for (const p of PROPS) if (a[p] !== undefined) o[p] = h00 * a[p] + h10 * h * (ta[p] || 0) + h01 * b[p] + h11 * h * (tb[p] || 0);
        } else {
          const f = (E[b.ease] || E.inout)((t - a.t) / h);
          for (const p of PROPS) if (a[p] !== undefined) o[p] = a[p] + (b[p] - a[p]) * f;
        }
        return o;
      }
    }
    return kfs[kfs.length - 1];
  }

  // clip-tijd met optionele slow-motion ramps: rate(t) = rate * (1 - (1-min) * exp(-((t-k)/w)^2))
  function erf(x) { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; }
  function clipTime(m, t) {
    let ct = (t - m.t0);
    (m.ramp || []).forEach((r) => { ct -= (1 - r.min) * r.w * 0.886227 * (erf((t - r.t) / r.w) - erf((m.t0 - r.t) / r.w)); });
    return m.c0 + ct * (m.rate || 1);
  }

  // ---------- helpers ----------
  const world = document.getElementById('world');
  function el(tag, css, parent) { const e = document.createElement(tag); if (css) e.style.cssText = css; (parent || world).appendChild(e); return e; }

  function makeSurface(w, h, opts) {
    // Een 3D-vlak. Inhoud: scherpe laag + wazige laag (gemaskeerd voor DOF) + shading + rim light.
    const s = el('div', `position:absolute;left:0;top:0;width:${w}px;height:${h}px;transform-origin:0 0;backface-visibility:hidden;overflow:hidden;border-radius:${opts.radius || 0}px;display:none;${opts.bg ? 'background:' + opts.bg + ';' : ''}`);
    const sharp = el('div', 'position:absolute;inset:0;background-repeat:no-repeat', s);
    const blur = el('div', 'position:absolute;inset:0;background-repeat:no-repeat;opacity:1', s);
    const extra = el('div', 'position:absolute;inset:0', s); // patches/schaduwen van opgetilde elementen
    const shade = el('div', 'position:absolute;inset:0;pointer-events:none;background:#000;opacity:0', s);
    // glans: een smalle, zachte lichtstreep die meedraait (schuiver), plus een vaste glasgradient voor schermen
    const sheen = el('div', `position:absolute;inset:0;pointer-events:none;mix-blend-mode:screen;background:linear-gradient(115deg,transparent 34%,rgba(255,255,255,${SHEEN * 0.12}) 47%,rgba(255,255,255,${SHEEN * 0.03}) 54%,transparent 64%);background-size:300% 100%;opacity:.9`, s);
    // rim light: dunne lichte rand langs de bovenkant/zijkant, zodat elk vlak loskomt van de achtergrond (premium, geen 'plaatje')
    const rim = el('div', `position:absolute;inset:0;pointer-events:none;border-radius:${opts.radius || 0}px;box-shadow:inset 0 0 0 1px rgba(255,255,255,${RIM * 0.10}),inset 0 1px 0 rgba(255,255,255,${RIM * 0.16});opacity:0`, s);
    return { el: s, sharp, blur, extra, shade, sheen, rim, w, h, radius: opts.radius || 0, noDof: !!opts.noDof };
  }
  // sterktes uit de timeline (worden in init gezet, vóór de objecten gebouwd worden)
  let SHEEN = 1, RIM = 1, SHADOW = 0.7, DRIFT = 0, SWEEP = 0;
  function setImage(surf, sharpUrl, blurUrl, crop, scaleFull) {
    // Echte <img>-elementen (geen background-image). Render: we wachten tot precies dit beeld gedecodeerd is.
    // Live preview: twee buffers per laag; het nieuwe frame laadt onzichtbaar en wordt pas getoond als het er is,
    // zodat er nooit een leeg of half geladen frame in beeld komt (geen flikkering).
    const mk = (layer) => {
      const im = document.createElement('img');
      im.decoding = 'sync';
      im.style.cssText = 'position:absolute;display:block;max-width:none;user-select:none';
      if (!crop) { im.style.left = '0'; im.style.top = '0'; im.style.width = '100%'; im.style.height = '100%'; }
      else {
        const k = surf.w / crop.w;
        im.style.width = scaleFull.w * k + 'px'; im.style.height = scaleFull.h * k + 'px';
        im.style.left = -crop.x * k + 'px'; im.style.top = -crop.y * k + 'px';
      }
      layer.appendChild(im);
      return im;
    };
    const set = (layer, url) => {
      if (!url) return null;
      if (!layer._imgs) { layer._imgs = [mk(layer), mk(layer)]; layer._cur = 0; layer._imgs[1].style.display = 'none'; }
      const cur = layer._imgs[layer._cur];
      if (cur._url === url) return null;
      if (!TL.live) { cur._url = url; cur.src = url; return cur; }
      const nxt = layer._imgs[1 - layer._cur];
      if (nxt._url !== url) { nxt._url = url; nxt.src = url; }
      if (nxt.complete && nxt.naturalWidth > 0) { nxt.style.display = 'block'; cur.style.display = 'none'; layer._cur = 1 - layer._cur; }
      return null;
    };
    return [set(surf.sharp, sharpUrl), set(surf.blur, blurUrl)].filter(Boolean);
  }

  // ---------- keyboard texture (canvas) ----------
  function keyboardCanvas(blurPx) {
    if (blurPx) { // één keer blurren i.p.v. elke tekenoperatie (veel sneller)
      const src = new Image(); const sc = document.createElement('canvas'); sc.width = 1500; sc.height = 1000;
      const base = keyboardCanvasEl(); const g2 = sc.getContext('2d'); g2.filter = `blur(${blurPx}px)`; g2.drawImage(base, 0, 0);
      return sc.toDataURL('image/jpeg', 0.9);
    }
    return keyboardCanvasEl().toDataURL('image/jpeg', 0.92);
  }
  function keyboardCanvasEl() {
    const c = document.createElement('canvas'); c.width = 1500; c.height = 1000;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 1000); grd.addColorStop(0, '#2a2b2f'); grd.addColorStop(1, '#1b1c1f');
    g.fillStyle = grd; g.fillRect(0, 0, 1500, 1000);
    // speaker grilles
    g.fillStyle = '#131416';
    for (let side = 0; side < 2; side++) for (let y = 70; y < 520; y += 12) for (let x = 0; x < 9; x++) { g.beginPath(); g.arc((side ? 1340 : 70) + x * 11, y, 2.2, 0, 6.3); g.fill(); }
    const rows = [[14, 60], [14, 78], [14, 78], [13, 78], [12, 78], [10, 78]];
    let y = 60;
    const kx0 = 180, kw = 1140;
    rows.forEach((r, ri) => {
      const [n, h] = r; const gap = 12; const w = (kw - gap * (n - 1)) / n;
      for (let i = 0; i < n; i++) {
        let x = kx0 + i * (w + gap), ww = w;
        if (ri === 5 && i === 4) { ww = w * 4.2; }
        if (ri === 5 && i > 4) x += w * 3.2 + gap * 0.2;
        if (ri === 5 && i > 4 && x + ww > kx0 + kw) continue;
        g.fillStyle = '#0c0d0f'; roundRect(g, x, y, ww, h, 9); g.fill();
        g.fillStyle = 'rgba(255,255,255,.05)'; roundRect(g, x + 2, y + 2, ww - 4, 6, 4); g.fill();
      }
      y += h + 12;
    });
    // trackpad
    g.fillStyle = '#232428'; roundRect(g, 490, 600, 520, 330, 22); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 2; roundRect(g, 490, 600, 520, 330, 22); g.stroke();
    // subtle vignette
    const v = g.createRadialGradient(750, 450, 200, 750, 500, 900); v.addColorStop(0, 'rgba(255,255,255,.03)'); v.addColorStop(1, 'rgba(0,0,0,.25)');
    g.fillStyle = v; g.fillRect(0, 0, 1500, 1000);
    return c;
  }
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  // ---------- objecten bouwen ----------
  let LID, objects = [], byId = {}, cursorObj = null, POP = false;
  const KB = {};
  function init(tl) {
    TL = tl; VW = TL.width; VH = TL.height; P = TL.perspective; CX = VW / 2; CY = VH / 2; LID = TL.laptop;
    const look = TL.look || {};
    SHEEN = look.sheen ?? 1; RIM = look.rim ?? 1; SHADOW = look.shadow ?? 0.7; DRIFT = look.drift ?? 0; SWEEP = look.sweep ?? 0;
    document.documentElement.style.width = document.body.style.width = VW + 'px';
    document.documentElement.style.height = document.body.style.height = VH + 'px';
    const stage = document.getElementById('stage');
    stage.style.perspective = P + 'px';
    const bg = TL.bg || '#1d1d1f';
    buildBackground(stage, TL.bgStyle || 'studio', bg, TL.accent || '#ff7a2f', TL.accent2 || '#f5f0e8');
    const vig = document.getElementById('vig'); if (vig) vig.style.opacity = String((look.vignette ?? 0.6) * ((TL.bgStyle === 'pastel' || TL.bgStyle === 'lila') ? 0.35 : 1));
    buildGround(); buildCaptions();
    camTan = TL.camera ? (TL.camera.segments || (TL.camera.kfs ? [TL.camera] : [])).map((sg) => tangents(sg.kfs)) : [];
    POP = !!TL.pop;
    const wmEl = document.getElementById('wm');
    const wm = TL.watermark;
    if (wm) { wmEl.style.display = 'block'; wmEl.style.width = wm.w + 'px'; wmEl.style.height = wm.h + 'px'; wmEl.style.background = `url("${wm.src}") no-repeat`; wmEl.style.backgroundSize = `${wm.bw}px ${wm.bh}px`; wmEl.style.backgroundPosition = `${-wm.bx}px ${-wm.by}px`; }
    else wmEl.style.display = 'none';
    world.innerHTML = ''; document.getElementById('overlay').innerHTML = '';
    buildFx();
    objects = TL.objects.map(build);
    byId = {}; objects.forEach((o) => (byId[o.id] = o));
    objects.forEach((o) => { if (o.kfs) o.tan = tangents(o.kfs); });
    if (TL.autoframe !== false) autoFrame();
    cursorObj = objects.find((o) => o.type === 'cursor');
    computeBgPath();
  }
  // ---------- automatische kadrering ----------
  // Voor elke tussen-keyframe: waar staat het focuspunt (pivot) echt in beeld, met perspectief, rotatie en camera?
  // Staat het meer dan een paar procent uit het midden, dan schuift het object terug. Eerste/laatste keyframe (overgangen) blijven zoals ze zijn.
  function autoFrame() {
    DW = null;
    const tx = CX, strength = TL.autoframe === undefined ? 0.85 : Math.max(0, Math.min(1, +TL.autoframe || 0.85));
    // veilige marge: 7% links/rechts, 10% boven, 12% onder (ruimte voor UI van social apps)
    const SX0 = VW * 0.07, SX1 = VW * 0.93, SY0 = VH * 0.1;
    // staat er op dat moment een tekstregel onderin? dan het onderwerp iets hoger kadreren en de ondermarge groter
    const capAt = (t) => (TL.captions || []).some((c) => c.pos !== 'tc' && t >= c.t0 - 0.3 && t <= c.t1 + 0.3);
    let ty = CY * 0.97, SY1 = VH * 0.88;
    const proj = (o, k, C, u, w, z) => { const pw = objMatrix(o, k, C).transformPoint(new DOMPoint(u, w, z || 0, 1)); const kk = P / Math.max(1, P - pw.z); return { x: CX + (pw.x - CX) * kk, y: CY + (pw.y - CY) * kk, kk }; };
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (const o of objects) {
        if (!o.kfs || o.kfs.length < 3 || !o.surfaces || !o.surfaces.length || /^(intro|outro|dev-|travel|fill|stack|fan|ring|phonering)/.test(o.id)) continue;
        if (o.frame && o.frame.auto === false) continue;
        o._noFrame = true;
        let oc = false;
        for (let i = 1; i < o.kfs.length - 1; i++) {
          const k = o.kfs[i];
          if ((k.o ?? 1) < 0.5 || k.noAuto) continue;
          const C = camAt(k.t);
          if (capAt(k.t)) { ty = CY * 0.9; SY1 = VH * 0.76; } else { ty = CY * 0.97; SY1 = VH * 0.88; }
          const kc = { ...k, mx: 0, my: 0, ms: 1 };
          // 1) focuspunt naar het midden
          const pc = k.fr && o.type === 'plane' ? proj(o, kc, C, k.fr.x + k.fr.w / 2, k.fr.y + k.fr.h / 2, k.frz ?? k.pz ?? 0) : proj(o, kc, C, k.px || 0, k.py || 0, k.pz || 0);
          const dx = pc.x - tx, dy = pc.y - ty;
          if (Math.abs(dx) > VW * 0.04 || Math.abs(dy) > VH * 0.04) { k.x = (k.x || 0) - (dx / pc.kk) * strength; k.y = (k.y || 0) - (dy / pc.kk) * strength; kc.x = k.x; kc.y = k.y; oc = true; }
          // 2) het belangrijke gebied (fr) moet binnen de veilige marge passen: kleiner zoomen en/of verschuiven
          if (k.fr && o.type === 'plane') {
            const r = k.fr, pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].map(([u, w]) => proj(o, kc, C, u, w, k.frz ?? k.pz ?? 0));
            const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x)), y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y));
            const f = Math.min(1, (SX1 - SX0) / Math.max(1, x1 - x0), (SY1 - SY0) / Math.max(1, y1 - y0));
            if (f < 0.97) { k.s = (k.s ?? 1) * Math.max(0.55, f * 0.98); oc = true; }
          }
        }
        o._noFrame = false;
        if (oc) { o.tan = tangents(o.kfs); changed = true; }
      }
      if (!changed) break;
    }
  }

  // ---------- effectlagen: flitsen, film burn, light leaks, gloed (screen-blend boven het beeld) ----------
  let FX = null;
  function buildFx() {
    const host = document.getElementById('fxl'); if (!host) { FX = null; return; }
    host.innerHTML = '';
    const mk = (css, tag = 'div') => { const d = document.createElement(tag); d.style.cssText = 'position:absolute;pointer-events:none;mix-blend-mode:screen;opacity:0;display:none;' + css; host.appendChild(d); return d; };
    const acc = TL.accent || '#ff7a2f';
    FX = {
      flash: mk('inset:0;background:#fff4e6'),
      glow: mk(`left:-60%;top:-20%;width:220%;height:140%;background:radial-gradient(ellipse 35% 45% at 50% 50%, ${rgba(acc, 0.85)} 0%, ${rgba(acc, 0.35)} 35%, ${rgba(acc, 0)} 70%);filter:blur(30px);will-change:transform`),
      burn: mk('left:50%;top:50%;object-fit:cover;will-change:transform', 'img'),
      leak: mk('left:50%;top:50%;object-fit:cover;will-change:transform', 'img'),
      cur: { burn: '', leak: '' },
    };
    // de beeldjes zijn liggend; groot genoeg maken om een staand frame te vullen, ook gedraaid
    const D = Math.hypot(VW, VH) * 1.05;
    [FX.burn, FX.leak].forEach((im) => { im.style.width = D + 'px'; im.style.height = D + 'px'; im.style.marginLeft = -D / 2 + 'px'; im.style.marginTop = -D / 2 + 'px'; });
  }
  function renderFx(t, waits) {
    if (!FX) return;
    const evs = TL.fx || [];
    let fl = 0, gl = 0, gx = 0, burn = null, leak = null;
    for (const e of evs) {
      const d = t - e.t;
      if (d < -0.6 || d > (e.dur || 1) + 0.1) continue;
      if (e.type === 'flash') { const a = d < 0 ? Math.max(0, 1 + d / 0.05) : Math.exp(-d / ((e.dur || 0.3) * 0.35)); fl = Math.max(fl, a * (e.amt ?? 1)); }
      else if (e.type === 'glow') { const u = (d + 0.3) / ((e.dur || 0.9) + 0.3); if (u > 0 && u < 1) { const a = Math.sin(Math.PI * u); if (a * (e.amt ?? 1) > gl) { gl = a * (e.amt ?? 1); gx = (u - 0.5) * 70 * (e.flip ? -1 : 1); } } }
      else if (e.type === 'burn' || e.type === 'leak') {
        const fps = e.type === 'burn' ? 24 : 14, n = (TL.fxAssets && TL.fxAssets[e.type] || []).length;
        const i = Math.floor((d + (e.type === 'burn' ? 0.08 : 0.25)) * fps);
        if (n && i >= 0 && i < n) { const o = { src: TL.fxAssets[e.type][i], amt: e.amt ?? 1, rot: e.rot || 0, flip: e.flip }; if (e.type === 'burn') burn = o; else leak = o; }
      }
    }
    const setImg = (im, key, o) => {
      if (!o) { im.style.display = 'none'; return; }
      if (FX.cur[key] !== o.src) { FX.cur[key] = o.src; im.src = o.src; if (!TL.live && im.decode) waits.push(im.decode().catch(() => {})); }
      im.style.display = 'block'; im.style.opacity = Math.min(1, o.amt).toFixed(3);
      im.style.transform = `rotate(${o.rot}deg) scaleX(${o.flip ? -1 : 1})`;
    };
    setImg(FX.burn, 'burn', burn); setImg(FX.leak, 'leak', leak);
    if (fl > 0.003) { FX.flash.style.display = 'block'; FX.flash.style.opacity = Math.min(1, fl).toFixed(3); } else FX.flash.style.display = 'none';
    if (gl > 0.003) { FX.glow.style.display = 'block'; FX.glow.style.opacity = Math.min(1, gl).toFixed(3); FX.glow.style.transform = `translateX(${gx.toFixed(1)}%)`; } else FX.glow.style.display = 'none';
  }

  // ---------- grondschaduw: zachte ovale schaduw onder elk object, zodat laptop, telefoon en pagina's 'staan' in de ruimte ----------
  let GROUND = null;
  function buildGround() {
    const host = document.getElementById('ground'); if (!host) { GROUND = null; return; }
    host.innerHTML = ''; GROUND = { host, pool: [] };
  }
  function groundShadow(i, bb, alpha) {
    // bb = geprojecteerde bounding box van het hoofdvlak; de schaduw ligt iets onder de onderrand, breedte ~ het vlak
    let d = GROUND.pool[i];
    // geen blur-filter (dat zou elk frame opnieuw gerasterd worden en de live preview laten haperen): de zachtheid zit in de gradient zelf
    if (!d) { d = document.createElement('div'); d.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;border-radius:50%;background:radial-gradient(ellipse at 50% 50%, rgba(0,0,0,.55) 0%, rgba(0,0,0,.32) 30%, rgba(0,0,0,.12) 55%, rgba(0,0,0,0) 72%);will-change:transform,opacity'; GROUND.host.appendChild(d); GROUND.pool[i] = d; }
    const depth = Math.max(0, Math.min(1, (bb.z + 900) / 1800)); // verder weg = kleiner en zachter
    const w = bb.w * (1.15 + 0.25 * (1 - depth)), h = Math.max(40, Math.min(bb.h * 0.3, w * 0.26));
    d.style.display = 'block';
    d.style.width = w + 'px'; d.style.height = h + 'px';
    d.style.transform = `translate(${(bb.cx - w / 2).toFixed(1)}px,${(bb.y1 - h * 0.45).toFixed(1)}px)`;
    d.style.opacity = (alpha * (0.4 + 0.45 * depth)).toFixed(3);
  }
  function hideGround(from) { if (!GROUND) return; for (let i = from; i < GROUND.pool.length; i++) GROUND.pool[i].style.display = 'none'; }

  // ---------- captions: strakke tekstlaag (kicker + regel) met maskeer-reveal, in de veilige marge ----------
  let CAP = null;
  function buildCaptions() {
    const host = document.getElementById('cap'); if (!host) { CAP = null; return; }
    host.innerHTML = '';
    const st = TL.captionStyle || 'clean';
    const fs = Math.round(VW * (st === 'bold' ? 0.062 : 0.046));
    const acc = TL.accent || '#ff7a2f';
    // scrim: zachte donkere waas onderin zolang er een tekst staat, zodat de tekst ook op lichte beelden leesbaar blijft
    const scrim = document.createElement('div');
    scrim.style.cssText = `position:absolute;left:0;right:0;bottom:0;height:${Math.round(VH * 0.46)}px;opacity:0;pointer-events:none;background:linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,.34) 50%, rgba(0,0,0,.62) 100%)`;
    host.appendChild(scrim);
    CAP = { host, scrim, items: (TL.captions || []).map((c) => {
      const pos = c.pos || 'bl';
      const d = document.createElement('div');
      d.style.cssText = `position:absolute;display:none;opacity:0;will-change:transform,opacity;font-family:Inter,-apple-system,"Helvetica Neue",Arial,sans-serif;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.35),0 4px 28px rgba(0,0,0,.55);${pos === 'bl' ? `left:${Math.round(VW * 0.07)}px;bottom:${Math.round(VH * 0.13)}px;max-width:${Math.round(VW * 0.8)}px;text-align:left` : pos === 'tc' ? `left:0;right:0;top:${Math.round(VH * 0.11)}px;text-align:center;padding:0 ${Math.round(VW * 0.07)}px` : `left:0;right:0;bottom:${Math.round(VH * 0.13)}px;text-align:center;padding:0 ${Math.round(VW * 0.07)}px`}`;
      const k = document.createElement('div');
      k.style.cssText = `display:${c.sub ? 'inline-flex' : 'none'};align-items:center;gap:10px;font-size:${Math.round(fs * 0.36)}px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.82);margin-bottom:${Math.round(fs * 0.34)}px;overflow:hidden`;
      k.innerHTML = `<i style="display:inline-block;width:${Math.round(fs * 0.5)}px;height:3px;border-radius:2px;background:${acc};flex:none"></i><span>${esc(c.sub || '')}</span>`;
      const w = document.createElement('div'); w.style.cssText = 'overflow:hidden';
      const tx = document.createElement('div');
      tx.style.cssText = `font-size:${fs}px;line-height:1.08;font-weight:${st === 'bold' ? 700 : 600};letter-spacing:-.022em;will-change:transform`;
      tx.textContent = c.text || '';
      w.appendChild(tx); d.appendChild(k); d.appendChild(w); host.appendChild(d);
      return { c, d, k, tx, fs };
    }) };
  }
  const esc = (s) => String(s).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
  function renderCaptions(t) {
    if (!CAP) return;
    let sc = 0;
    for (const it of CAP.items) {
      const c = it.c, IN_ = 0.55, OUT_ = 0.4;
      if (t < c.t0 - 0.02 || t > c.t1 + 0.02) { it.d.style.display = 'none'; continue; }
      const a = Math.min(1, Math.max(0, (t - c.t0) / IN_)), b = Math.min(1, Math.max(0, (c.t1 - t) / OUT_));
      const ea = E.out(a), eb = E.in(1 - b);
      if (c.pos !== 'tc') sc = Math.max(sc, Math.min(ea, 1 - eb));
      it.d.style.display = 'block';
      it.d.style.opacity = Math.min(ea, 1 - eb).toFixed(3);
      it.d.style.transform = `translateY(${((1 - ea) * it.fs * 0.35 + eb * it.fs * -0.25).toFixed(1)}px)`;
      it.tx.style.transform = `translateY(${((1 - ea) * 108).toFixed(1)}%)`;
      it.k.style.opacity = Math.min(1, a * 1.6).toFixed(3);
    }
    CAP.scrim.style.opacity = sc.toFixed(3);
  }

  // Achtergrond-parallax: deterministisch pad, opgebouwd uit de beweging van het hoofdobject (+ camera).
  // Integratie van snelheden: geen sprongen bij shotwissels, langzaam terugveren naar het midden.
  let BGP = null;
  function computeBgPath() {
    const step = 1 / 60, n = Math.ceil((TL.duration || 0) / step) + 2;
    const xs = new Float32Array(n), ys = new Float32Array(n), rs = new Float32Array(n);
    let px = 0, py = 0, pr = 0, prev = null;
    const k = TL.bgParallax ?? 1;
    for (let i = 0; i < n; i++) {
      const t = i * step;
      let cur = null;
      for (const o of objects) {
        if (!o.surfaces || !o.surfaces.length) continue;
        const v = sample(o.kfs, t, o.tan);
        if (v && (v.o ?? 1) > 0.05) { cur = { id: o.id, v }; break; }
      }
      const cm = camAt(t); const c = cm ? cm._pose : null;
      if (cur && prev && prev.id === cur.id) {
        const a = cur.v, b = prev.v;
        px += (-(a.x - b.x) * 0.16 - ((a.ry || 0) - (b.ry || 0)) * 9) * k;
        py += (-(a.y - b.y) * 0.16 + ((a.rx || 0) - (b.rx || 0)) * 7) * k;
        pr += ((a.rz || 0) - (b.rz || 0)) * 0.3 * k;
      }
      if (c && prev && prev.c) { px -= (c.x - prev.c.x) * 0.08 * k; py -= (c.y - prev.c.y) * 0.08 * k; pr -= ((c.rz || 0) - (prev.c.rz || 0)) * 0.3 * k; }
      px *= 0.992; py *= 0.992; pr *= 0.992;
      px = Math.max(-170, Math.min(170, px)); py = Math.max(-170, Math.min(170, py)); pr = Math.max(-6, Math.min(6, pr));
      xs[i] = px; ys[i] = py; rs[i] = pr;
      prev = cur ? { ...cur, c } : (c ? { id: null, c } : null);
    }
    BGP = { step, xs, ys, rs, n };
  }
  function bgAt(t) {
    if (!BGP) return { x: 0, y: 0, r: 0 };
    const f = Math.max(0, Math.min(BGP.n - 1.001, t / BGP.step)), i = Math.floor(f), u = f - i;
    const L = (a) => a[i] + (a[i + 1] - a[i]) * u;
    return { x: L(BGP.xs), y: L(BGP.ys), r: L(BGP.rs) };
  }
  // ---------- achtergronden ----------
  let BG = { style: 'studio', els: [] }, camTan = null;
  function hexRgb(c) {
    const m = /^#?([0-9a-f]{6})$/i.exec(c || ''); if (m) { const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
    const r = /rgba?\(([^)]+)\)/.exec(c || ''); if (r) return r[1].split(',').slice(0, 3).map((x) => +x);
    return [128, 128, 128];
  }
  const rgba = (c, a) => { const [r, g, b] = hexRgb(c); return `rgba(${r},${g},${b},${a})`; };
  function buildBackground(stage, style, bg, accent, accent2) {
    const host = document.getElementById('bg');
    host.innerHTML = ''; BG = { style, els: [] };
    const base = `radial-gradient(ellipse 70% 45% at 50% 45%, ${shadeHex(bg, 20)} 0%, ${bg} 55%, ${shadeHex(bg, -14)} 100%)`;
    stage.style.background = shadeHex(bg, -14);
    const add = (css) => { const d = document.createElement('div'); d.style.cssText = 'position:absolute;pointer-events:none;' + css; host.appendChild(d); BG.els.push(d); return d; };
    // basisgloed als eigen laag, zodat hij mee kan parallaxen
    add(`left:-60%;top:-60%;right:-60%;bottom:-60%;background:${style === 'solid' ? bg : base}`);
    if (style === 'aurora') {
      stage.style.background = shadeHex(bg, -8);
      [[accent, 0.5], [accent2, 0.32], [shadeHex(accent, -60), 0.5]].forEach(([c, a], i) => {
        add(`left:0;top:0;width:${VW * 1.1}px;height:${VW * 1.1}px;border-radius:50%;background:radial-gradient(circle, ${rgba(c, a)} 0%, ${rgba(c, 0)} 65%);filter:blur(40px);will-change:transform`)._i = i;
      });
    } else if (style === 'grid') {
      const g = add(`left:50%;top:${VH * 0.52}px;width:${VW * 5}px;height:${VH * 2.2}px;margin-left:${-VW * 2.5}px;transform-origin:50% 0;
        background-image:linear-gradient(${rgba(accent, 0.28)} 2px, transparent 2px),linear-gradient(90deg, ${rgba(accent, 0.28)} 2px, transparent 2px);background-size:140px 140px;
        -webkit-mask-image:linear-gradient(to bottom, transparent 0%, #000 22%, #000 60%, transparent 100%);mask-image:linear-gradient(to bottom, transparent 0%, #000 22%, #000 60%, transparent 100%)`);
      g._grid = true;
      add(`left:0;right:0;top:${VH * 0.3}px;height:${VH * 0.4}px;background:radial-gradient(ellipse 60% 50% at 50% 60%, ${rgba(accent, 0.22)}, transparent 70%)`);
    } else if (style === 'pastel') {
      // licht en zacht: een pastel uit de merkkleur, met een iets lichtere vlek bovenin en wat diepte onderin
      const p1 = mixHex(accent, '#ffffff', 0.8), p2 = mixHex(accent2, '#ffffff', 0.55), p3 = mixHex(accent, '#ffffff', 0.68);
      stage.style.background = p1;
      add(`left:-60%;top:-60%;right:-60%;bottom:-60%;background:radial-gradient(ellipse 70% 50% at 50% 30%, ${p2} 0%, ${p1} 55%, ${p3} 100%)`);
      add(`left:0;top:0;width:${VW * 1.4}px;height:${VW * 1.4}px;border-radius:50%;background:radial-gradient(circle, rgba(255,255,255,.55) 0%, rgba(255,255,255,0) 62%);filter:blur(60px);will-change:transform`)._m = 0;
    } else if (style === 'lila') {
      // vaste lichte lila, zoals in motion-graphics-referenties: zacht verloop met wat licht bovenin
      stage.style.background = '#d6cff2';
      add(`left:-60%;top:-60%;right:-60%;bottom:-60%;background:radial-gradient(ellipse 75% 55% at 50% 28%, #ebe7fa 0%, #d9d3f3 50%, #c6bdec 100%)`);
      add(`left:0;top:0;width:${VW * 1.4}px;height:${VW * 1.4}px;border-radius:50%;background:radial-gradient(circle, rgba(255,255,255,.5) 0%, rgba(255,255,255,0) 62%);filter:blur(60px);will-change:transform`)._m = 0;
    } else if (style === 'mesh') {
      // mesh-gradient: drie grote, zachte kleurvlekken in de merkkleuren die heel langzaam drijven (subtieler dan aurora)
      stage.style.background = shadeHex(bg, -6);
      [[accent, 0.22], [accent2, 0.14], [shadeHex(accent, 70), 0.12]].forEach(([c, a], i) => {
        add(`left:0;top:0;width:${VW * 1.5}px;height:${VW * 1.5}px;border-radius:50%;background:radial-gradient(circle, ${rgba(c, a)} 0%, ${rgba(c, 0)} 62%);filter:blur(70px);will-change:transform`)._m = i;
      });
      add(`left:0;right:0;bottom:0;height:${VH * 0.5}px;background:linear-gradient(to bottom, transparent, ${rgba(shadeHex(bg, -30), 0.75)})`);
    } else if (style === 'spotlight') {
      stage.style.background = shadeHex(bg, -10);
      add(`left:0;top:0;width:${VW * 1.6}px;height:${VW * 1.6}px;border-radius:50%;background:radial-gradient(circle, rgba(255,248,235,.16) 0%, rgba(255,248,235,0) 60%);will-change:transform`)._spot = true;
      add(`left:${-VW * 0.2}px;right:${-VW * 0.2}px;bottom:${-VH * 0.1}px;height:${VH * 0.4}px;background:radial-gradient(ellipse 50% 40% at 50% 30%, ${rgba(accent, 0.14)}, transparent 70%)`);
    }
  }
  function animateBackground(t) {
    for (const d of BG.els) {
      if (d._i !== undefined) {
        const i = d._i, a = t * (0.22 + i * 0.07) + i * 2.1;
        const x = VW * (0.5 + 0.42 * Math.sin(a)) - VW * 0.55, y = VH * (0.5 + 0.35 * Math.cos(a * 0.8 + i)) - VW * 0.55;
        d.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
      } else if (d._m !== undefined) {
        const i = d._m, a = t * (0.09 + i * 0.03) + i * 2.4;
        const x = VW * (0.5 + 0.3 * Math.sin(a)) - VW * 0.75, y = VH * (0.45 + 0.25 * Math.cos(a * 0.7 + i)) - VW * 0.75;
        d.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
      } else if (d._grid) {
        d.style.transform = `perspective(900px) rotateX(74deg) translateY(${((t * 110) % 140).toFixed(1)}px)`;
      } else if (d._spot) {
        const x = VW * (0.5 + 0.3 * Math.sin(t * 0.35)) - VW * 0.8, y = VH * (0.35 + 0.1 * Math.cos(t * 0.5)) - VW * 0.8;
        d.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
      }
    }
  }

  function mixHex(a, b, t) { const [r1, g1, b1] = hexRgb(a), [r2, g2, b2] = hexRgb(b); const m = (x, y) => Math.round(x + (y - x) * t); return `rgb(${m(r1, r2)},${m(g1, g2)},${m(b1, b2)})`; }
  function shadeHex(hex, amt) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return hex;
    const n = parseInt(m[1], 16); const c = (v) => Math.max(0, Math.min(255, v + amt));
    return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
  }
  function build(o) {
    const obj = { ...o, surfaces: [] };
    if (o.type === 'plane') {
      const s = makeSurface(o.w, o.h, { radius: o.radius || 18, bg: '#111' });
      s.local = new DOMMatrix();
      s.src = o.src; s.kind = 'page';
      if (TL.reflection && !o.noReflect) s.el.style.webkitBoxReflect = 'below 14px linear-gradient(transparent 64%, rgba(255,255,255,.26))';
      obj.surfaces.push(s);
      obj.page = s;
      // dikte: de pagina is een plaat (zijkanten + achterkant), geen plat plaatje
      if (TL.slab !== false && !o.noSlab) {
        const T = TL.slabDepth || 16, R = o.radius || 18, W = o.w, H = o.h;
        const side = (w, h, bg) => { const e = makeSurface(w, h, { radius: 2, bg, noDof: true }); e.kind = 'edge'; e.sheen.style.display = 'none'; return e; };
        const eR = side(T, H - 2 * R, 'linear-gradient(90deg,#e9e5df,#a9a49c)'); eR.local = new DOMMatrix().translate(W - 1, R, 0).rotateAxisAngle(0, 1, 0, 90);
        const eL = side(T, H - 2 * R, 'linear-gradient(90deg,#a9a49c,#e9e5df)'); eL.local = new DOMMatrix().translate(1, R, -T).rotateAxisAngle(0, 1, 0, -90);
        const eT = side(W - 2 * R, T, 'linear-gradient(0deg,#f2eee8,#bdb8b0)'); eT.local = new DOMMatrix().translate(R, 1, -T).rotateAxisAngle(1, 0, 0, 90);
        const eB = side(W - 2 * R, T, 'linear-gradient(180deg,#d6d1ca,#8f8a83)'); eB.local = new DOMMatrix().translate(R, H - 1, -T).rotateAxisAngle(1, 0, 0, 90);
        const bk = makeSurface(W, H, { radius: R, bg: 'linear-gradient(150deg,#34353a,#1b1c1f)', noDof: true }); bk.kind = 'lidback';
        bk.local = new DOMMatrix().translate(W, 0, -T).rotateAxisAngle(0, 1, 0, 180);
        obj.surfaces.push(bk, eL, eR, eT, eB);
      }
      (o.lifts || []).forEach((L, i) => {
        // tekst met matte: de lift beslaat de hele opgevulde zone, zodat uitstekende letters niet worden afgesneden
        if (L.patchMode === 'plate' && L.plate && L.plate.matte && L.soft) L = { ...L, rect: { x: L.plate.x, y: L.plate.y, w: L.plate.w, h: L.plate.h } };
        // patch op de pagina (lege plek + schaduw) en een opgetild vlak
        // lege plek waar het element uit komt:
        //  solid = effen kleur van de ondergrond (schoon 'gat', met een zachte binnenrand), blur = wazige ondergrond, none = geen gat (element dekt zichzelf af)
        const solid = L.patchMode === 'solid' || (!L.patchMode && L.patch && L.patch !== 'transparent');
        let patch;
        if (L.patchMode === 'plate' && L.plate) {
          // clean plate: de plek wordt opgevuld met de omringende ondergrond, alsof het element er nooit zat
          const pl = L.plate;
          patch = el('div', `position:absolute;left:${pl.x}px;top:${pl.y}px;width:${pl.w}px;height:${pl.h}px;background:url("${pl.url}") no-repeat 0 0 / 100% 100%;opacity:0`, s.extra);
        } else {
          const patchBg = solid ? (L.patch || '#fff') : L.patchMode === 'blur' && o.src && o.src.burl ? `url("${o.src.burl}") no-repeat ${-L.rect.x}px ${-L.rect.y}px / 1920px 1080px` : 'transparent';
          patch = el('div', `position:absolute;left:${L.rect.x - 2}px;top:${L.rect.y - 2}px;width:${L.rect.w + 4}px;height:${L.rect.h + 4}px;background:${patchBg};border-radius:${(L.radius || 0) + 2}px;opacity:0;${solid ? 'box-shadow:inset 0 3px 12px rgba(0,0,0,.10)' : L.patchMode === 'blur' ? `filter:blur(${L.soft ? 30 : 10}px)` : 'display:none'}`, s.extra);
        }
        // schaduw: kleiner dan het element, ronde hoeken, zacht; groeit en vervaagt mee met de hoogte
        const ins = Math.min(L.rect.w, L.rect.h) * 0.1, rr = Math.max(L.radius || 0, 16);
        const shadow = el('div', `position:absolute;left:${L.rect.x + ins}px;top:${L.rect.y + ins}px;width:${Math.max(4, L.rect.w - 2 * ins)}px;height:${Math.max(4, L.rect.h - 2 * ins)}px;border-radius:${rr}px;background:rgba(0,0,0,.5);opacity:0`, s.extra);
        const ls = makeSurface(L.rect.w, L.rect.h, { radius: L.radius || 0 });
        ls.kind = 'lift'; ls.lift = L; ls.patch = patch; ls.shadow = shadow; ls.src = o.src; ls.crop = L.rect;
        if (L.patchMode === 'plate' && L.plate && L.plate.matte && L.soft) {
          // tekst op een foto: alleen de letters zelf komen los (matte uit het verschil met de clean plate)
          const mk = `url("${L.plate.matte}")`;
          ls.el.style.webkitMaskImage = mk; ls.el.style.maskImage = mk; ls.el.style.webkitMaskSize = '100% 100%'; ls.el.style.maskSize = '100% 100%';
          ls.sheen.style.display = 'none'; ls.matte = true;
        } else if (L.soft) {
          // tekst die loskomt: geen harde rechthoek, randen zacht uitlopen
          const fe = Math.min(22, Math.min(L.rect.w, L.rect.h) * 0.18);
          const mk = `linear-gradient(to right, transparent, #000 ${fe}px, #000 calc(100% - ${fe}px), transparent), linear-gradient(to bottom, transparent, #000 ${fe}px, #000 calc(100% - ${fe}px), transparent)`;
          ls.el.style.webkitMaskImage = mk; ls.el.style.maskImage = mk; ls.el.style.webkitMaskComposite = 'source-in'; ls.el.style.maskComposite = 'intersect';
        } else ls.el.style.boxShadow = '0 26px 50px -22px rgba(0,0,0,.42), 0 6px 14px -6px rgba(0,0,0,.18)';
        obj.surfaces.push(ls);
      });
    } else if (o.type === 'curved') {
      // gebogen scherm: het beeld in verticale stroken, elke strook op een cilinder (straal uit de buiging). Zo buigt de kaart echt mee,
      // zoals een card-ring in een motion-graphics-video. Schaduw en belichting per strook geven de ronding vanzelf.
      const W = o.w, Hh = o.h, K = o.strips || 10, bend = (o.bend || 26) * Math.PI / 180, R = (W / 2) / Math.sin(bend / 2);
      const sw = W / K, ov = 2.5; // kleine overlap tegen naadlijntjes
      for (let i = 0; i < K; i++) {
        const st = makeSurface(sw + ov, Hh, { radius: 0, bg: '#111' });
        st.kind = 'strip'; st.src = o.src; st.crop = { x: i * sw, y: 0, w: sw + ov, h: Hh };
        const a = ((i + 0.5) / K - 0.5) * bend; // hoek van deze strook op de cilinder
        const cx = R * Math.sin(a), cz = R * Math.cos(a) - R;
        st.local = new DOMMatrix().translate(W / 2 + cx, 0, cz).rotateAxisAngle(0, 1, 0, a * 180 / Math.PI).translate(-(sw + ov) / 2, 0, 0); // bolle kant naar de kijker: rechterstroken draaien hun rechterrand naar achteren
        st.sheen.style.display = 'none';
        obj.surfaces.push(st);
      }
      // afgeronde hoeken en een zachte rand over het geheel: masker op de buitenste stroken
      const rr = o.radius || 28;
      obj.surfaces[0].el.style.borderRadius = `${rr}px 0 0 ${rr}px`; obj.surfaces[K - 1].el.style.borderRadius = `0 ${rr}px ${rr}px 0`;
      obj.curved = { W, Hh };
    } else if (o.type === 'crop') {
      const s = makeSurface(o.w, o.h, { radius: o.radius || 20 });
      s.local = new DOMMatrix(); s.src = o.src; s.crop = o.crop; s.kind = 'crop';
      s.el.style.boxShadow = '0 60px 120px -30px rgba(0,0,0,.85)';
      if (TL.reflection) s.el.style.webkitBoxReflect = 'below 12px linear-gradient(transparent 55%, rgba(255,255,255,.3))';
      obj.surfaces.push(s);
    } else if (o.type === 'laptop') {
      const W = LID.W, D = LID.D, LH = LID.LH, ang = LID.open;
      const base = makeSurface(W, D, { radius: 26 });
      const kb = KB.a || (KB.a = keyboardCanvas(0)), kbB = KB.b || (KB.b = keyboardCanvas(10));
      base.sharp.style.backgroundImage = `url(${kb})`; base.sharp.style.backgroundSize = '100% 100%';
      base.blur.style.backgroundImage = `url(${kbB})`; base.blur.style.backgroundSize = '100% 100%';
      base.local = new DOMMatrix().translate(-W / 2, 0, 0).rotateAxisAngle(1, 0, 0, 90);
      base.kind = 'kb';
      const edge = makeSurface(W, 26, { radius: 8, bg: 'linear-gradient(#3a3b40,#16171a)', noDof: true });
      edge.local = new DOMMatrix().translate(-W / 2, 0, D);
      edge.kind = 'edge';
      const lidBack = makeSurface(W, LH, { radius: 30, bg: 'linear-gradient(160deg,#3b3c41,#202124)', noDof: true });
      lidBack.local = new DOMMatrix().translate(-W / 2, 0, 0).rotateAxisAngle(1, 0, 0, ang).translate(0, -LH, -6).translate(W, 0, 0).rotateAxisAngle(0, 1, 0, 180);
      lidBack.kind = 'lidback';
      const lid = makeSurface(W, LH, { radius: 30, bg: '#050506' });
      lid.local = new DOMMatrix().translate(-W / 2, 0, 0).rotateAxisAngle(1, 0, 0, ang).translate(0, -LH, 0);
      lid.kind = 'lid';
      // scherm-inhoud zit in een binnenvak van het deksel
      const inner = { x: LID.bezel, y: LID.bezel, w: W - LID.bezel * 2, h: (W - LID.bezel * 2) * 9 / 16 };
      [lid.sharp, lid.blur].forEach((l) => { l.style.left = inner.x + 'px'; l.style.top = inner.y + 'px'; l.style.width = inner.w + 'px'; l.style.height = inner.h + 'px'; l.style.right = 'auto'; l.style.bottom = 'auto'; l.style.borderRadius = '6px'; });
      const cam = el('div', `position:absolute;left:${W / 2 - 5}px;top:${LID.bezel / 2 - 5}px;width:10px;height:10px;border-radius:50%;background:#1a1a1c`, lid.extra);
      // glas: vaste zachte lichtval over het scherm (linksboven), zoals een echte glasplaat
      el('div', `position:absolute;left:${inner.x}px;top:${inner.y}px;width:${inner.w}px;height:${inner.h}px;border-radius:6px;pointer-events:none;background:linear-gradient(160deg,rgba(255,255,255,${0.07 * SHEEN}) 0%,rgba(255,255,255,${0.02 * SHEEN}) 30%,transparent 48%)`, lid.extra);
      lid.src = o.screen; lid.inner = inner;
      // lid eerst: sortering gebeurt via 3D
      obj.surfaces.push(lidBack, base, edge, lid);
      obj.lid = lid;
    } else if (o.type === 'phone') {
      const PW = 430, PH = 884, T = 18, R = 66;
      const body = makeSurface(PW, PH, { radius: R, bg: 'linear-gradient(160deg,#2c2d31,#0d0d0f)' });
      body.local = new DOMMatrix().translate(-PW / 2, -PH / 2, 0);
      body.kind = 'phone';
      const inner = { x: 20, y: 20, w: 390, h: 844 };
      [body.sharp, body.blur].forEach((l) => { l.style.left = inner.x + 'px'; l.style.top = inner.y + 'px'; l.style.width = inner.w + 'px'; l.style.height = inner.h + 'px'; l.style.right = 'auto'; l.style.bottom = 'auto'; l.style.borderRadius = '48px'; l.style.overflow = 'hidden'; });
      el('div', `position:absolute;left:${PW / 2 - 62}px;top:34px;width:124px;height:36px;border-radius:20px;background:#050505`, body.extra);
      el('div', `position:absolute;inset:0;border-radius:${R}px;box-shadow:inset 0 0 0 2px rgba(255,255,255,.14),inset 0 0 0 7px #111`, body.extra);
      el('div', `position:absolute;left:${inner.x}px;top:${inner.y}px;width:${inner.w}px;height:${inner.h}px;border-radius:48px;pointer-events:none;background:linear-gradient(165deg,rgba(255,255,255,${0.08 * SHEEN}) 0%,rgba(255,255,255,${0.02 * SHEEN}) 28%,transparent 46%)`, body.extra);
      const EH = PH - R * 2 + 8, EY = -PH / 2 + R - 4, EI = 1.5;
      const edgeR = makeSurface(T, EH, { radius: 9, bg: 'linear-gradient(90deg,#3a3b40,#18191c)', noDof: true });
      edgeR.local = new DOMMatrix().translate(PW / 2 - EI, EY, 0).rotateAxisAngle(0, 1, 0, 90); edgeR.kind = 'edge';
      const edgeL = makeSurface(T, EH, { radius: 9, bg: 'linear-gradient(90deg,#18191c,#3a3b40)', noDof: true });
      edgeL.local = new DOMMatrix().translate(-PW / 2 + EI, EY, -T).rotateAxisAngle(0, 1, 0, -90); edgeL.kind = 'edge';
      const back = makeSurface(PW, PH, { radius: R, bg: 'linear-gradient(150deg,#3b3c42,#1a1b1e)', noDof: true });
      back.local = new DOMMatrix().translate(PW / 2, -PH / 2, -T).rotateAxisAngle(0, 1, 0, 180); back.kind = 'lidback';
      el('div', 'position:absolute;left:30px;top:30px;width:150px;height:150px;border-radius:40px;background:#111;box-shadow:inset 0 0 0 2px #2a2a2e', back.extra);
      body.src = o.screen; body.inner = inner;
      obj.surfaces.push(back, edgeL, edgeR, body);
      obj.lid = body; obj.screenW = 390;
    } else if (o.type === 'fill') {
      obj.div = el('div', `position:absolute;inset:0;background:${o.color};opacity:0;display:none`, document.getElementById('overlay'));
    } else if (o.type === 'cursor') {
      obj.div = el('div', 'position:absolute;left:0;top:0;width:44px;height:44px;display:none;will-change:transform;z-index:5', document.getElementById('overlay'));
      obj.div.innerHTML = '<div class="cin" style="transform-origin:6px 4px;transition:none"><svg width="44" height="44" viewBox="0 0 30 30"><path d="M4 3 L4 24 L9.6 18.8 L13.4 27.2 L17 25.6 L13.3 17.4 L20.8 17.4 Z" fill="#111" stroke="#fff" stroke-width="1.8" stroke-linejoin="round" style="filter:drop-shadow(0 3px 5px rgba(0,0,0,.45))"/></svg></div>';
      obj.inner = obj.div.firstChild;
      obj.rings = (o.clicks || []).map(() => el('div', 'position:absolute;left:0;top:0;width:70px;height:70px;border-radius:50%;border:3px solid rgba(255,255,255,.95);box-shadow:0 0 0 1px rgba(0,0,0,.2);display:none', document.getElementById('overlay')));
    }
    return obj;
  }

  // ---------- matrices ----------
  function camAt(t) {
    if (!TL.camera) return null;
    const segs = TL.camera.segments || (TL.camera.kfs ? [TL.camera] : []);
    let c = null;
    for (let i = 0; i < segs.length; i++) { const k = segs[i].kfs; if (k.length && t >= k[0].t && t <= k[k.length - 1].t) { c = sample(k, t, camTan[i]); break; } }
    if (!c) return null;
    const C = new DOMMatrix().translate(c.x || 0, c.y || 0, c.z || 0).rotateAxisAngle(0, 0, 1, c.rz || 0).rotateAxisAngle(1, 0, 0, c.rx || 0).rotateAxisAngle(0, 1, 0, c.ry || 0);
    const M = new DOMMatrix().translate(CX, CY, 0).multiply(C.inverse()).translate(-CX, -CY, 0);
    M._fz = c.fz || 0; M._pose = c;
    return M;
  }
  // levende camera: trage, kleine zweving van de hele scene. In de wiskunde (niet als CSS-transform op #world), zodat
  // cursor, klik-ringen, grondschaduwen en QA precies dezelfde projectie gebruiken.
  let DW = null;
  function setDrift(t) {
    if (!(DRIFT > 0) || t === undefined) { DW = null; return; }
    const dx = (Math.sin(t * 0.61) * 5 + Math.sin(t * 0.23 + 1.3) * 3) * DRIFT, dy = (Math.cos(t * 0.47 + 0.7) * 3.5 + Math.sin(t * 0.19) * 2) * DRIFT, dr = (Math.sin(t * 0.29 + 2.1) * 0.22) * DRIFT;
    DW = new DOMMatrix().translate(CX + dx, CY + dy, 0).rotateAxisAngle(0, 0, 1, dr).translate(-CX, -CY, 0);
  }
  function objMatrix(o, v, C) {
    const B = objBase(v, o._noFrame ? null : o.frame);
    const M = C ? C.multiply(B) : B;
    return DW ? DW.multiply(M) : M;
  }
  function objBase(v, fr) {
    // fr = handmatige kadrering per shot (Studio/Claude), bovenop de automatische
    const S = (v.s ?? 1) * (v.ms ?? 1) * (fr ? fr.zoom || 1 : 1);
    return new DOMMatrix().translate(CX + (v.x || 0) + (v.mx || 0) + (fr ? fr.x || 0 : 0), CY + (v.y || 0) + (v.my || 0) + (fr ? fr.y || 0 : 0), v.z || 0)
      .rotateAxisAngle(0, 0, 1, (v.rz || 0) + (fr ? fr.tilt || 0 : 0)).rotateAxisAngle(1, 0, 0, v.rx || 0).rotateAxisAngle(0, 1, 0, v.ry || 0)
      .scale(S, S, S).translate(-(v.px || 0), -(v.py || 0), -(v.pz || 0));
  }
  function project(M, u, v) {
    const p = M.transformPoint(new DOMPoint(u, v, 0, 1));
    const k = P / Math.max(1, P - p.z);
    return { x: CX + (p.x - CX) * k, y: CY + (p.y - CY) * k, z: p.z };
  }
  function surfaceMatrices(o, v, C) {
    const M = objMatrix(o, v, C);
    return o.surfaces.map((s) => {
      if (s.kind === 'lift') {
        const liftAmt = (v.lift || 0) * (s.lift.h || 1) * (s.lift.max || 160);
        const stagger = s.lift.stagger || 0;
        const la = Math.max(0, liftStagger(v.lift || 0, stagger, s.lift.win));
        const LM = new DOMMatrix().translate(s.lift.rect.x, s.lift.rect.y, 6 + la * (s.lift.max || 160));
        // 'cover': zonder gat; het opgetilde element groeit een fractie zodat het origineel eronder nooit dubbel te zien is
        if (s.lift.cover) { const k = 1 + 0.05 * Math.min(1, la * 3); LM.translateSelf(s.lift.rect.w / 2, s.lift.rect.h / 2).scaleSelf(k, k).translateSelf(-s.lift.rect.w / 2, -s.lift.rect.h / 2); }
        return M.multiply(LM);
      }
      return M.multiply(s.local);
    });
  }
  function liftStagger(l, st, win) { // l 0..1 over het geheel; ieder element begint later (win = eigen duur, optioneel)
    const a = Math.min(1, Math.max(0, (l - st) / (win || Math.max(0.2, 1 - st))));
    return POP ? E.back(a) : E.out(a);
  }

  // ---------- DOF ----------
  function applyDof(s, M, v, focusZ) {
    if (s.noDof) { s.blur.style.opacity = 0; return; }
    const dw = v.dw ?? 90, db = v.db ?? 1;
    if (db <= 0.01) { s.blur.style.opacity = 0; s.blur.style.webkitMaskImage = 'none'; return; }
    const w = s.w, h = s.h;
    const gx = M.m13, gy = M.m23; // dz per lokale px
    const zc = M.transformPoint(new DOMPoint(w / 2, h / 2, 0, 1)).z;
    let gl = Math.hypot(gx, gy);
    s.blur.style.opacity = Math.min(1, db).toFixed(3);
    // in de render: extra echte lensblur bovenop het voorbereide wazige beeld (schaalt mee met de zoom)
    if (!TL.live) { const sx = Math.hypot(M.m11, M.m12); const bp = Math.max(0, Math.min(9, 2.2 * db * sx)); const fv = bp > 0.3 ? `blur(${bp.toFixed(1)}px)` : 'none'; if (s._bf !== fv) { s._bf = fv; s.blur.style.filter = fv; } }
    // vrijwel frontaal vlak: één uniforme scherpte, vloeiend overgaand (geen harde omslag = geen flikkering)
    const flat = Math.min(1, Math.max(0, (0.03 - gl) / 0.02));
    if (flat >= 1) {
      const a = Math.min(1, Math.max(0, (Math.abs(zc - focusZ) - dw) / dw));
      s.blur.style.webkitMaskImage = 'none'; s.blur.style.maskImage = 'none';
      s.blur.style.opacity = (a * Math.min(1, db)).toFixed(3);
      return;
    }
    gl = Math.max(gl, 0.01);
    const dx = gx / gl, dy = gy / gl;
    const ang = Math.atan2(dx, -dy) * 180 / Math.PI;
    const ar = ang * Math.PI / 180;
    const L = Math.abs(w * Math.sin(ar)) + Math.abs(h * Math.cos(ar));
    const t1 = L / 2 + (focusZ - dw - zc) / gl;
    const t2 = L / 2 + (focusZ + dw - zc) / gl;
    const f = Math.max(40, dw * 1.6 / gl);
    const lo = Math.min(t1, t2), hi = Math.max(t1, t2);
    const cl = (v) => Math.max(-20000, Math.min(20000, v)).toFixed(1);
    const m = `linear-gradient(${ang.toFixed(2)}deg, #000 ${cl(lo - f)}px, transparent ${cl(lo)}px, transparent ${cl(hi)}px, #000 ${cl(hi + f)}px)`;
    if (flat > 0) { const a = Math.min(1, Math.max(0, (Math.abs(zc - focusZ) - dw) / dw)); s.blur.style.opacity = ((1 - flat) * Math.min(1, db) + flat * a * Math.min(1, db)).toFixed(3); }
    s.blur.style.webkitMaskImage = m; s.blur.style.maskImage = m;
  }

  // ---------- render ----------
  function anchorPos(a, t) {
    if (!a.obj) return { x: a.x, y: a.y };
    const o = byId[a.obj]; const v = sample(o.kfs, t, o.tan) || o.kfs[o.kfs.length - 1];
    const Ms = surfaceMatrices(o, v, camAt(t));
    const idx = a.surface || 0; const s = o.surfaces[idx];
    let u = a.u, w = a.v;
    if (o.type === 'laptop' || o.type === 'phone') { const lid = o.lid; const k = lid.inner.w / (o.screenW || 1920); u = lid.inner.x + a.u * k; w = lid.inner.y + a.v * k; return project(Ms[o.surfaces.indexOf(lid)], u, w); }
    return project(Ms[idx], u, w);
  }

  async function render(t) {
    const waits = [];
    setDrift(t);
    const C = camAt(t);
    animateBackground(t);
    let gi = 0;
    for (const o of objects) {
      const v = sample(o.kfs, t, o.tan);
      if (o.type === 'fill') { if (!v || v.o <= 0.001) { o.div.style.display = 'none'; continue; } o.div.style.display = 'block'; o.div.style.opacity = v.o; if (o.colorKfs) { /* vaste kleur */ } continue; }
      if (o.type === 'cursor') continue;
      if (!v || (v.o ?? 1) <= 0.002) { o.surfaces.forEach((s) => (s.el.style.display = 'none')); continue; }
      const Ms = surfaceMatrices(o, v, C);
      // focus: diepte van het pivot-punt, plus offset. Met camera: één gezamenlijk focusvlak.
      let focusZ;
      if (C && o.camFocus !== false) focusZ = C._fz;
      else { const Mo = objMatrix(o, v, C); const pv = Mo.transformPoint(new DOMPoint(v.px || 0, v.py || 0, v.pz || 0, 1)); focusZ = pv.z + (v.fz || 0); }
      o.surfaces.forEach((s, i) => {
        const M = Ms[i];
        if (s.kind === 'lift' && liftStagger(v.lift || 0, s.lift.stagger || 0, s.lift.win) < 0.012) { s.el.style.display = 'none'; s.patch.style.opacity = 0; s.shadow.style.opacity = 0; return; }
        s.el.style.display = 'block';
        s.el.style.transform = M.toString();
        s.el.style.opacity = Math.min(1, v.o ?? 1).toFixed(3);
        // belichting: hoe schuiner, hoe donkerder; sheen schuift mee; rim light sterker naarmate het vlak schuiner staat
        const nz = M.m33 / Math.hypot(M.m31, M.m32, M.m33);
        s.shade.style.opacity = Math.max(0, Math.min(0.6, (1 - Math.abs(nz)) * 0.55 + (s.kind === 'kb' ? 0.05 : 0))).toFixed(3);
        // glans: schuift mee met de draai, en trekt per shot één keer als lichtstreep over het vlak (van links naar rechts)
        let sw = 0;
        if (SWEEP > 0 && o.kfs && o.kfs.length > 1 && (s.kind === 'page' || s.kind === 'lid' || s.kind === 'phone' || s.kind === 'crop')) { const t0 = o.kfs[0].t, t1 = o.kfs[o.kfs.length - 1].t; const u = Math.min(1, Math.max(0, (t - t0) / Math.max(0.1, t1 - t0))); sw = (E.inout(u) - 0.5) * 90 * SWEEP; }
        s.sheen.style.backgroundPosition = `${(50 + sw + (v.ry || 0) * 1.5 + (v.rz || 0) * 1.2 - (v.x || 0) / 40).toFixed(1)}% 0`;
        if (s.rim) s.rim.style.opacity = (RIM > 0 && (s.kind === 'page' || s.kind === 'lid' || s.kind === 'phone') ? 0.55 + 0.45 * (1 - Math.abs(nz)) : 0).toFixed(3);
        applyDof(s, M, v, focusZ);
        // grondschaduw onder het hoofdvlak (pagina, deksel, telefoon, crop): projectie van de hoeken
        if (GROUND && SHADOW > 0 && (s.kind === 'page' || s.kind === 'lid' || s.kind === 'phone') && (v.o ?? 1) > 0.05) {
          const P4 = [[0, 0], [s.w, 0], [s.w, s.h], [0, s.h]].map(([u, w]) => project(M, u, w));
          if (!P4.some((p) => p.z > P - 120)) {
            const x0 = Math.min(...P4.map((p) => p.x)), x1 = Math.max(...P4.map((p) => p.x)), y1 = Math.max(...P4.map((p) => p.y));
            const zc = P4.reduce((a, p) => a + p.z, 0) / 4;
            const fill = Math.max(0, Math.min(1, (2.4 * VW - (x1 - x0)) / (0.9 * VW))); // close-up die het beeld vult: geen donkere balk onderin
            if (fill > 0.02 && x1 - x0 > 40 && x1 > -VW && x0 < 2 * VW && y1 > -VH && y1 < 2.2 * VH) groundShadow(gi++, { cx: (x0 + x1) / 2, w: x1 - x0, h: y1 - Math.min(...P4.map((p) => p.y)), y1, z: zc }, SHADOW * fill * Math.min(1, v.o ?? 1));
          }
        }
        // bronbeeld
        if (s.src) {
          let sharp, blur;
          if (s.src.kind === 'clip') {
            const m = s.src.map; const ct = m ? Math.max(0, clipTime(m, t)) : (t % Math.max(0.5, (s.src.count || 30) / (s.src.fps || 30))); // eigen video zonder vaste timing: loopt gewoon door
            const idx = Math.min(s.src.count, Math.max(1, Math.floor(ct * s.src.fps) + 1));
            const n = String(idx).padStart(5, '0');
            sharp = `${TL.proxy && s.src.pdir ? s.src.pdir : s.src.dir}/${n}.jpg`; blur = `${s.src.bdir}/${n}.jpg`;
          } else { sharp = s.src.url; blur = s.src.burl; }
          const imgs = setImage(s, sharp, blur, s.crop || null, { w: 1920, h: 1080 });
          if (!TL.live) imgs.forEach((im) => waits.push(im.decode().catch(() => {})));
        }
        if (s.kind === 'lift') {
          const a = liftStagger(v.lift || 0, s.lift.stagger || 0, s.lift.win);
          // gat direct volledig dicht zodra het element beweegt: nooit een doorschijnend spookbeeld van de tekst
          s.patch.style.opacity = Math.min(1, a * 4).toFixed(3);
          s.shadow.style.opacity = (a * (s.lift.soft ? 0.07 : 0.5)).toFixed(3);
          const off = a * 30, fb = `blur(${Math.round(14 + a * 26)}px)`;
          if (s._sf !== fb) { s._sf = fb; s.shadow.style.filter = fb; }
          s.shadow.style.transform = `translate(${off * 0.3}px,${off}px) scale(${1 + a * 0.06})`;
        }
      });
      if (o.curved && GROUND && SHADOW > 0 && (v.o ?? 1) > 0.05) {
        const pts = [];
        o.surfaces.forEach((s, i) => { if (s.kind !== 'strip') return; const M = Ms[i]; pts.push(project(M, 0, 0), project(M, s.w, 0), project(M, 0, s.h), project(M, s.w, s.h)); });
        if (pts.length && !pts.some((p) => p.z > P - 120)) {
          const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x)), y1 = Math.max(...pts.map((p) => p.y)), y0 = Math.min(...pts.map((p) => p.y));
          const zc = pts.reduce((a, p) => a + p.z, 0) / pts.length;
          if (x1 - x0 > 40 && x1 > -VW && x0 < 2 * VW && y1 > -VH && y1 < 2.2 * VH) groundShadow(gi++, { cx: (x0 + x1) / 2, w: (x1 - x0) * 0.9, h: y1 - y0, y1, z: zc }, SHADOW * 0.8 * Math.min(1, v.o ?? 1));
        }
      }
    }
    // cursor
    if (cursorObj) {
      const c = cursorObj; const k = c.kfs;
      if (t < k[0].t || t > k[k.length - 1].t) { c.div.style.display = 'none'; c.rings.forEach((r) => (r.style.display = 'none')); }
      else {
        let i = 1; while (i < k.length - 1 && t > k[i].t) i++;
        const a = k[i - 1], b = k[i];
        const f = (E[b.ease] || E.inout)((t - a.t) / Math.max(1e-6, b.t - a.t));
        const pa = anchorPos(a, t), pb = anchorPos(b, t);
        // lichte boog
        const mx = (pa.x + pb.x) / 2 + (pb.y - pa.y) * 0.12, my = (pa.y + pb.y) / 2 - (pb.x - pa.x) * 0.12;
        const x = (1 - f) * (1 - f) * pa.x + 2 * (1 - f) * f * mx + f * f * pb.x;
        const y = (1 - f) * (1 - f) * pa.y + 2 * (1 - f) * f * my + f * f * pb.y;
        const op = a.o !== undefined ? a.o + ((b.o ?? a.o) - a.o) * f : 1;
        c.div.style.display = 'block'; c.div.style.opacity = op;
        c.div.style.transform = `translate(${(x - 8).toFixed(1)}px,${(y - 5).toFixed(1)}px)`;
        let press = 1;
        (c.clicks || []).forEach((ct, j) => {
          const d = t - ct; const r = c.rings[j];
          if (d > -0.08 && d < 0.12) press = 0.82;
          if (d >= 0 && d < 0.5) { const p = E.out(d / 0.5); r.style.display = 'block'; r.style.opacity = (1 - p).toFixed(3); r.style.transform = `translate(${x - 35}px,${y - 35}px) scale(${0.3 + p * 1.3})`; }
          else r.style.display = 'none';
        });
        c.inner.style.transform = `scale(${press})`;
      }
    }
    // watermerk drift
    const bp = bgAt(t);
    const bgEl = document.getElementById('bg');
    if (bgEl) bgEl.style.transform = `translate(${bp.x.toFixed(1)}px,${bp.y.toFixed(1)}px) rotate(${bp.r.toFixed(2)}deg) scale(1.25)`;
    const wm = document.getElementById('wm');
    if (wm) wm.style.transform = `translate(-50%,-50%) translate(${(bp.x * 1.8).toFixed(1)}px,${(bp.y * 1.8).toFixed(1)}px) rotate(${(-12 + bp.r * 1.5).toFixed(2)}deg) translate(${(-t * 14).toFixed(1)}px,0)`;
    hideGround(gi);
    renderCaptions(t);
    renderFx(t, waits);
    if (TL.live) return true;
    await Promise.all(waits);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return true;
  }

  // schermsnelheid rond t (max verplaatsing van hoekpunten in px over dt)
  function speed(t, dt) { return flow(t, dt).max; }
  // beweging in beeld tijdens de sluitertijd: grootste verplaatsing (px) en de hoofdrichting (voor de restblur)
  function flow(t, dt) {
    setDrift(t);
    let max = 0, fx = 0, fy = 0, fw = 0;
    for (const o of objects) {
      if (!o.surfaces || !o.surfaces.length) continue;
      const a = sample(o.kfs, t - dt / 2, o.tan), b = sample(o.kfs, t + dt / 2, o.tan);
      if (!a || !b) continue;
      if ((a.o ?? 1) < 0.02 && (b.o ?? 1) < 0.02) continue;
      const Ma = surfaceMatrices(o, a, camAt(t - dt / 2)), Mb = surfaceMatrices(o, b, camAt(t + dt / 2));
      o.surfaces.forEach((s, i) => {
        for (const [u, w] of [[0, 0], [s.w, 0], [0, s.h], [s.w, s.h], [s.w / 2, s.h / 2]]) {
          const pa = project(Ma[i], u, w), pb = project(Mb[i], u, w);
          // alleen punten die (ongeveer) in beeld zijn tellen
          if ((pa.x < -VW || pa.x > 2 * VW || pa.y < -VH || pa.y > 2 * VH) && (pb.x < -VW || pb.x > 2 * VW || pb.y < -VH || pb.y > 2 * VH)) continue;
          const d = Math.hypot(pb.x - pa.x, pb.y - pa.y);
          max = Math.max(max, d); fx += (pb.x - pa.x) * d; fy += (pb.y - pa.y) * d; fw += d;
        }
      });
    }
    return { max, dx: fw ? fx / fw : 0, dy: fw ? fy / fw : 0 };
  }

  // beweging voor sound design: snelheid (px/frame) en horizontale richting
  function motion(t, dt) {
    setDrift(t);
    let max = 0, dxs = 0, n = 0;
    const Ca = camAt(t - dt / 2), Cb = camAt(t + dt / 2);
    for (const o of objects) {
      if (!o.surfaces || !o.surfaces.length) continue;
      const a = sample(o.kfs, t - dt / 2, o.tan), b = sample(o.kfs, t + dt / 2, o.tan);
      if (!a || !b || (b.o ?? 1) < 0.05) continue;
      const Ma = surfaceMatrices(o, a, Ca), Mb = surfaceMatrices(o, b, Cb);
      const i = o.surfaces.length - 1, s = o.surfaces[i];
      const pa = project(Ma[i], s.w / 2, s.h / 2), pb = project(Mb[i], s.w / 2, s.h / 2);
      const d = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      const za = Math.abs(pb.z - pa.z) * 0.5;
      const sp = d + za;
      if (sp > max) max = sp;
      dxs += pb.x - pa.x; n++;
    }
    return { speed: max, dx: n ? dxs / n : 0 };
  }

  // QA: hoeveel van het beeld is gevuld, hoe schuin staat het hoofdvlak, hoe ver is er ingezoomd (schermpx per CSS-px)
  function clipPoly(pts) {
    const edges = [(p) => p.x >= 0, (p) => p.x <= VW, (p) => p.y >= 0, (p) => p.y <= VH];
    const inter = (a, b, k) => { let u; if (k === 0) u = (0 - a.x) / (b.x - a.x); else if (k === 1) u = (VW - a.x) / (b.x - a.x); else if (k === 2) u = (0 - a.y) / (b.y - a.y); else u = (VH - a.y) / (b.y - a.y); return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }; };
    let out = pts;
    edges.forEach((inside, k) => { const inp = out; out = []; for (let i = 0; i < inp.length; i++) { const a = inp[i], b = inp[(i + 1) % inp.length]; const ia = inside(a), ib = inside(b); if (ia) out.push(a); if (ia !== ib) out.push(inter(a, b, k)); } });
    let A = 0; for (let i = 0; i < out.length; i++) { const a = out[i], b = out[(i + 1) % out.length]; A += a.x * b.y - b.x * a.y; }
    return Math.abs(A) / 2;
  }
  function qa(t) {
    setDrift(t);
    const C = camAt(t);
    let cov = 0, angle = 0, zoom = 0, main = null, clip = 0, clipId = null;
    for (const o of objects) {
      if (!o.surfaces || !o.surfaces.length) continue;
      const v = sample(o.kfs, t, o.tan);
      if (!v || (v.o ?? 1) < 0.3) continue;
      const Ms = surfaceMatrices(o, v, C);
      o.surfaces.forEach((s, i) => {
        if (['edge', 'lidback', 'kb'].includes(s.kind)) return;
        const M = Ms[i];
        const P4 = [[0, 0], [s.w, 0], [s.w, s.h], [0, s.h]].map(([u, w]) => project(M, u, w));
        if (P4.some((p) => p.z > P - 250) && P4.some((p) => p.x > -VW && p.x < 2 * VW && p.y > -VH && p.y < 2 * VH) && (v.o ?? 1) > 0.3) { clip = Math.max(clip, 1); clipId = o.id + ':' + s.kind; }
        if (P4.some((p) => p.z > P - 50)) return;
        const a = clipPoly(P4);
        cov += a;
        const nz = Math.abs(M.m33 / Math.hypot(M.m31, M.m32, M.m33));
        if (s.kind === 'page' || s.kind === 'lid' || s.kind === 'phone' || s.kind === 'crop' || s.kind === 'strip') {
          const ang = Math.acos(Math.min(1, nz)) * 180 / Math.PI;
          if (!main || a > main.a) {
            // waar staat het focuspunt (pivot) van dit object in beeld?
            const Mo = objMatrix(o, v, C); const pw = Mo.transformPoint(new DOMPoint(v.px || 0, v.py || 0, v.pz || 0, 1)); const k = P / Math.max(1, P - pw.z);
            main = { a, ang, id: o.id, fx: CX + (pw.x - CX) * k, fy: CY + (pw.y - CY) * k, margin: 0 };
            // valt het belangrijke gebied buiten de veilige marge?
            let kf0 = null; for (const kk of o.kfs) if (Math.abs(kk.t - t) < 0.2 && (!kf0 || Math.abs(kk.t - t) < Math.abs(kf0.t - t))) kf0 = kk;
            if (kf0 && kf0.fr && o.type === 'plane') {
              const r = kf0.fr, z = kf0.frz ?? v.pz ?? 0;
              const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].map(([u, w2]) => { const q = Mo.transformPoint(new DOMPoint(u, w2, z, 1)); const kq = P / Math.max(1, P - q.z); return { x: CX + (q.x - CX) * kq, y: CY + (q.y - CY) * kq }; });
              const out = Math.max(0, VW * 0.04 - Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x)) - VW * 0.96, VH * 0.06 - Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y)) - VH * 0.94);
              main.margin = out / VW;
            }
          }
          const c = project(M, s.w / 2, s.h / 2), dx = project(M, s.w / 2 + 10, s.h / 2);
          const dens = { page: 2, lid: 2.67, phone: 3, crop: 1.1 }[s.kind] || 2;
          if (a > VW * VH * 0.05) zoom = Math.max(zoom, Math.hypot(dx.x - c.x, dx.y - c.y) / 10 / dens);
        }
      });
    }
    return { clip, clipId, margin: main ? main.margin : 0, coverage: Math.min(1, cov / (VW * VH)), angle: main ? main.ang : 0, zoom, main: main ? main.id : null, fx: main ? main.fx / VW : 0.5, fy: main ? main.fy / VH : 0.5 };
  }

  // live kadrering vanuit de Studio: geen herbouw, alleen het frame van de objecten van dat shot aanpassen
  function setFrame(shotIdx, fr) { objects.forEach((o) => { if (o.shotIdx === shotIdx && o.type !== 'fill') o.frame = fr ? { zoom: fr.zoom || 1, x: fr.x || 0, y: fr.y || 0, tilt: fr.tilt || 0, auto: fr.auto !== false } : null; }); }
  window.SC = { init, render, setFrame, speed, flow, motion, qa, get duration() { return TL ? TL.duration : 0; }, ready: true };
  if (window.TIMELINE) init(window.TIMELINE);
})();
