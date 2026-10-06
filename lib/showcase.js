// Showcase-render 9:16: cinematic 3D-showcase van de website, lokaal, zonder API.
// Laptop-swoop, vlakken met harde 3D-rotaties, opgetilde elementen, depth of field met focus pulls,
// cursor-klikjes, adaptieve motion blur. Frame-exact: altijd vloeiend, ongeacht de snelheid van de computer.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const { ffmpegPath, run, mkdir, log } = require('./util');


async function avgColor(file, x, y, w, h) {
  return new Promise((resolve) => {
    const args = ['-v', 'error', '-i', file, '-vf', `scale=1920:1080,crop=${Math.max(2, Math.round(w))}:${Math.max(2, Math.round(h))}:${Math.max(0, Math.round(x))}:${Math.max(0, Math.round(y))},scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'];
    const p = spawn(ffmpegPath(), args);
    const bufs = [];
    p.stdout.on('data', (d) => bufs.push(d));
    p.on('close', () => { const b = Buffer.concat(bufs); resolve(b.length >= 3 ? `rgb(${b[0]},${b[1]},${b[2]})` : '#111'); });
    p.on('error', () => resolve('#111'));
  });
}

// rand rond een element: gemiddelde kleur + hoe egaal (std). Egaal = schoon uit te knippen met een effen 'gat'.
const RAWC = new Map();
async function rawOf(file) {
  if (RAWC.has(file)) return RAWC.get(file);
  const sh = require('sharp');
  const r = await sh(file).resize(1920, 1080, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  RAWC.set(file, r); if (RAWC.size > 12) RAWC.delete(RAWC.keys().next().value);
  return r;
}
async function ringStats(file, rc) {
  try {
    const b = await rawOf(file);
    let n = 0, sr = 0, sg = 0, sb = 0, sq = 0;
    const add = (x, y) => { if (x < 0 || y < 0 || x >= 1920 || y >= 1080) return; const i = (Math.round(y) * 1920 + Math.round(x)) * 3; const r = b[i], g = b[i + 1], bl = b[i + 2]; sr += r; sg += g; sb += bl; sq += r * r + g * g + bl * bl; n++; };
    for (const d of [8, 14, 20]) {
      for (let x = rc.x - d; x <= rc.x + rc.w + d; x += 3) { add(x, rc.y - d); add(x, rc.y + rc.h + d); }
      for (let y = rc.y - d; y <= rc.y + rc.h + d; y += 3) { add(rc.x - d, y); add(rc.x + rc.w + d, y); }
    }
    if (!n) return { color: '#ffffff', std: 99 };
    const mr = sr / n, mg = sg / n, mb = sb / n;
    const std = Math.sqrt(Math.max(0, sq / n / 3 - (mr * mr + mg * mg + mb * mb) / 3));
    const hx = (v) => Math.round(v).toString(16).padStart(2, '0');
    const out = { color: '#' + hx(mr) + hx(mg) + hx(mb), std: +std.toFixed(1) };
    // niet egaal (foto, verloop): maak een 'clean plate' van de plek, opgevuld vanuit de omgeving (geen dubbele tekst, geen vlek)
    if (std >= 5) { try { out.plate = await plateOf(file, b, rc); } catch (e) {} }
    return out;
  } catch (e) { return { color: '#ffffff', std: 99 }; }
}

// clean plate: vult de rechthoek op uit de pixels er direct omheen (gewogen naar de dichtstbijzijnde rand),
// daarna zacht vervaagd zodat er geen strepen ontstaan. Zachte alfarand zodat de naad onzichtbaar is.
async function plateOf(file, b, rc) {
  const sh = require('sharp');
  const pad = Math.round(Math.max(4, Math.min(14, rc.h * 0.06))), ring = 4;
  const x0 = Math.max(0, Math.floor(rc.x - pad)), y0 = Math.max(0, Math.floor(rc.y - pad));
  const x1 = Math.min(1919, Math.ceil(rc.x + rc.w + pad)), y1 = Math.min(1079, Math.ceil(rc.y + rc.h + pad));
  const W = x1 - x0 + 1, H = y1 - y0 + 1;
  if (W < 4 || H < 4) return null;
  const px = (x, y) => { x = Math.max(0, Math.min(1919, x)); y = Math.max(0, Math.min(1079, y)); const i = (y * 1920 + x) * 3; return [b[i], b[i + 1], b[i + 2]]; };
  // randlijnen buiten de rechthoek, gemiddeld over een paar pixels diepte en langs de lijn gladgestreken
  const line = (n, f) => { const a = []; for (let k = 0; k < n; k++) { let r = 0, g = 0, bl = 0; for (let d = 1; d <= ring; d++) { const c = f(k, d); r += c[0]; g += c[1]; bl += c[2]; } a.push([r / ring, g / ring, bl / ring]); } return smooth(a, Math.max(3, Math.round(n / 40))); };
  const smooth = (a, w) => a.map((_, i) => { const s = [0, 0, 0]; let n = 0; for (let j = Math.max(0, i - w); j <= Math.min(a.length - 1, i + w); j++) { s[0] += a[j][0]; s[1] += a[j][1]; s[2] += a[j][2]; n++; } return [s[0] / n, s[1] / n, s[2] / n]; });
  const L = line(H, (k, d) => px(x0 - d, y0 + k)), Rr = line(H, (k, d) => px(x1 + d, y0 + k));
  const Tp = line(W, (k, d) => px(x0 + k, y0 - d)), Bt = line(W, (k, d) => px(x0 + k, y1 + d));
  const rgb = Buffer.alloc(W * H * 3);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  // Coons-patch: horizontale lijnen (horizon, randen) lopen door, verticale verlopen ook
  const avg = (a, b) => [0, 1, 2].map((c) => (a[c] + b[c]) / 2);
  const cTL = avg(L[0], Tp[0]), cTR = avg(Rr[0], Tp[W - 1]), cBL = avg(L[H - 1], Bt[0]), cBR = avg(Rr[H - 1], Bt[W - 1]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / (W - 1), v = y / (H - 1), i = (y * W + x) * 3;
    for (let c = 0; c < 3; c++) {
      const lh = (1 - u) * L[y][c] + u * Rr[y][c], lv = (1 - v) * Tp[x][c] + v * Bt[x][c];
      const bi = (1 - u) * (1 - v) * cTL[c] + u * (1 - v) * cTR[c] + (1 - u) * v * cBL[c] + u * v * cBR[c];
      rgb[i + c] = Math.max(0, Math.min(255, Math.round(lh + lv - bi)));
    }
  }
  const sig = Math.max(1, Math.min(5, Math.min(W, H) / 20));
  // alleen de kleur vervagen; de alfa blijft vol dekkend met een smalle zachte rand (anders schemert het origineel erdoor)
  const bl = await sh(rgb, { raw: { width: W, height: H, channels: 3 } }).blur(sig).raw().toBuffer();
  const buf = Buffer.alloc(W * H * 4), fe = 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x), e = Math.min(x, y, W - 1 - x, H - 1 - y), g = rnd() * 5;
    for (let c = 0; c < 3; c++) buf[i * 4 + c] = Math.max(0, Math.min(255, Math.round(bl[i * 3 + c] + g)));
    buf[i * 4 + 3] = Math.round(255 * Math.min(1, (e + 1) / fe));
  }
  const name = `plate_${path.basename(file).replace(/\W/g, '')}_${Math.round(rc.x)}_${Math.round(rc.y)}_${Math.round(rc.w)}_${Math.round(rc.h)}.png`;
  await sh(buf, { raw: { width: W, height: H, channels: 4 } }).png().toFile(path.join(path.dirname(file), name));
  const res = { url: name, x: x0, y: y0, w: W, h: H };
  // matte: alleen de pixels die echt van het element zijn (verschil met de clean plate). Tekst op een foto komt zo los
  // als losse letters, zonder rechthoek van de achtergrond eromheen.
  try {
    const meta = await sh(file).metadata(), k = meta.width / 1920;
    const rx = Math.round(x0 * k), ry = Math.round(y0 * k), rw = Math.max(2, Math.round(W * k)), rh = Math.max(2, Math.round(H * k)); // hele opgevulde zone: uitstekende letters (g, V) vallen er ook in
    const ex = { left: Math.max(0, rx), top: Math.max(0, ry), width: Math.min(rw, meta.width - Math.max(0, rx)), height: Math.min(rh, meta.height - Math.max(0, ry)) };
    const orig = await sh(file).extract(ex).removeAlpha().raw().toBuffer();
    const big = await sh(bl, { raw: { width: W, height: H, channels: 3 } }).resize(Math.round(W * k), Math.round(H * k), { fit: 'fill' }).raw().toBuffer();
    const BW = Math.round(W * k), ox = ex.left - Math.round(x0 * k), oy = ex.top - Math.round(y0 * k);
    const al = Buffer.alloc(ex.width * ex.height);
    let on = 0;
    for (let y = 0; y < ex.height; y++) for (let x = 0; x < ex.width; x++) {
      const i = (y * ex.width + x) * 3, j = (Math.min(Math.round(H * k) - 1, y + oy) * BW + Math.min(BW - 1, x + ox)) * 3;
      const d = Math.max(Math.abs(orig[i] - big[j]), Math.abs(orig[i + 1] - big[j + 1]), Math.abs(orig[i + 2] - big[j + 2]));
      const a = Math.max(0, Math.min(1, (d - 22) / 40));
      al[y * ex.width + x] = Math.round(255 * a * a * (3 - 2 * a)); if (a > 0.5) on++;
    }
    // alleen zinvol als het element een deel van de rechthoek is (tekst), niet als alles verschilt (een foto of blok)
    const frac = on / (ex.width * ex.height);
    if (frac > 0.02 && frac < 0.6) {
      const mname = name.replace('plate_', 'matte_');
      const mbuf = Buffer.alloc(ex.width * ex.height * 4);
      for (let i = 0; i < al.length; i++) { mbuf[i * 4] = mbuf[i * 4 + 1] = mbuf[i * 4 + 2] = 255; mbuf[i * 4 + 3] = al[i]; }
      await sh(mbuf, { raw: { width: ex.width, height: ex.height, channels: 4 } }).blur(0.5).png().toFile(path.join(path.dirname(file), mname));
      res.matte = mname;
    }
  } catch (e) {}
  return res;
}

function toHex(c) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || '');
  if (!m) return c;
  return '#' + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join('');
}

async function prepClip(outDir, work, clip) {
  const key = 'clip' + clip.clip;
  const dir = path.join(work, key), bdir = path.join(work, key + '_b');
  mkdir(dir); mkdir(bdir);
  const src = path.join(outDir, clip.file);
  await run(ffmpegPath(), ['-y', '-v', 'error', '-i', src, '-vf', 'fps=30', '-q:v', '2', path.join(dir, '%05d.jpg')]);
  await run(ffmpegPath(), ['-y', '-v', 'error', '-i', src, '-vf', 'fps=30,scale=1280:-2,gblur=sigma=6', '-q:v', '3', path.join(bdir, '%05d.jpg')]);
  const pdir = path.join(work, key + '_p'); mkdir(pdir);
  await run(ffmpegPath(), ['-y', '-v', 'error', '-i', src, '-vf', 'fps=30,scale=960:-2', '-q:v', '4', path.join(pdir, '%05d.jpg')]);
  const count = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).length;
  const last = path.join(dir, String(count).padStart(5, '0') + '.jpg');
  return { kind: 'clip', dir: key, bdir: key + '_b', pdir: key + '_p', count, fps: 30, lastFrame: last };
}
async function prepStill(outDir, work, still) {
  const key = 'still' + still.no;
  const src = path.join(outDir, still.clean);
  const sharp = path.join(work, key + '.jpg'), blur = path.join(work, key + '_b.jpg');
  await run(ffmpegPath(), ['-y', '-v', 'error', '-i', src, '-q:v', '2', sharp]);
  await run(ffmpegPath(), ['-y', '-v', 'error', '-i', src, '-vf', 'scale=1280:-2,gblur=sigma=6', '-q:v', '3', blur]);
  return { kind: 'still', url: key + '.jpg', burl: key + '_b.jpg', file: sharp };
}

// mobiele schermafbeeldingen (staand) als keuze voor telefoonschermen
async function mobileStills(outDir, work, ctx) {
  const out = [];
  for (const [i, m] of (ctx.mobile_stills || []).entries()) {
    if (!m.file || !fs.existsSync(path.join(outDir, m.file))) continue;
    try { out.push({ id: 'ms:' + i, label: 'mobiel · ' + (m.kind || 'scherm').replace(/^mobile-/, ''), src: await prepStill(outDir, work, { no: 'm' + i, clean: m.file }) }); } catch (e) {}
  }
  return out;
}

// alle vastgelegde stills (elke sectie van elke pagina): de keuzelijst in de Studio
async function buildLibrary(outDir, work, ctx) {
  const lib = [];
  for (const st of (ctx.stills || [])) {
    if (!st.clean || !fs.existsSync(path.join(outDir, st.clean))) continue;
    try {
      const src = await prepStill(outDir, work, st);
      const where = st.path && st.path !== '/' ? st.path.replace(/\.html?$/, '').replace(/^\//, '') : 'home';
      // losse elementen op dit scherm, al uitgeknipt: zo kan elk scherm een lagen- of pop-shot worden zonder dat je iets aanwijst
      let layers = [];
      try {
        const spots = (st.tags || []).filter((t) => t.rect).map((t) => ({ ...t.rect, role: t.role }));
        const rects = await autoCut(src.file, { x: 0, y: 0, w: 1920, h: 1080 }, { max: 7, spots });
        for (const r of rects) { const sp = spots.find((q) => Math.abs(q.x - r.x) < 3 && Math.abs(q.y - r.y) < 3 && Math.abs(q.w - r.w) < 6); layers.push({ rect: r, role: sp ? sp.role : 'blok', ring: await ringStats(src.file, r) }); }
      } catch (e) {}
      lib.push({ id: 'lib:' + st.no, label: `${where} · ${(st.heading || st.kind || '').slice(0, 42)}`, page: st.page, kind: st.kind, src, layers });
    } catch (e) {}
  }
  return lib;
}

function pickAssets(ctx) {
  const clips = ctx.clips || [];
  const by = (types) => types.map((t) => clips.find((c) => c.type === t)).find(Boolean);
  const inter = (id) => { for (const p of ctx.pages) { const x = [...(p.hovers || []), ...(p.clicks || [])].find((i) => i.id === id); if (x) return x; } return null; };
  const t = (c, re) => { const e = (c && c.timeline || []).find((x) => re.test(x.event)); return e ? e.t : null; };
  const center = (r) => r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null;

  const hero = by(['hero-cta', 'scroll-tour']);
  let heroFocus = null;
  if (hero && hero.evidence && hero.evidence[0]) { const h = inter(hero.evidence[0]); if (h) heroFocus = center(h.target.rect_view); }
  if (!heroFocus && ctx.stills[0]) { const c = ctx.stills[0].tags.find((x) => x.role === 'cta' && x.rect.y > 150); if (c) heroFocus = center(c.rect); }

  const menu = by(['menu-open', 'overlay-open', 'hover-dropdown', 'dropdown']);
  const menuFocus = menu && menu.evidence && inter(menu.evidence[0]) ? center(inter(menu.evidence[0]).target.rect_view) : { x: 1800, y: 60 };

  const cardStill = ctx.stills.filter((s) => s.tags.filter((x) => x.role === 'card').length >= 2).sort((a, b) => a.page - b.page)[0];
  const cards = cardStill ? cardStill.tags.filter((x) => x.role === 'card').sort((a, b) => a.rect.x - b.rect.x).slice(0, 4) : [];

  const depth = by(['parallax-scroll', 'scroll-reveal', 'slider-autoplay', 'scroll-tour']);
  const slide = by(['slider', 'card-hover-sweep', 'tab', 'hover-card', 'accordion']);

  // logo + CTA uit een still met lichte (gescrollde) header
  const withLogo = ctx.stills.filter((s) => s.tags.some((x) => x.role === 'logo')).sort((a, b) => (b.scrollY > 60) - (a.scrollY > 60));
  const logoStill = withLogo[0] || null;
  const logo = logoStill ? logoStill.tags.find((x) => x.role === 'logo') : null;
  const headerCta = logoStill ? logoStill.tags.filter((x) => x.role === 'cta' && x.rect.y < 120).sort((a, b) => b.rect.x - a.rect.x)[0] : null;
  const heroStill = ctx.stills.find((s) => s.kind === 'hero') || ctx.stills[0];
  const heroCtaTag = heroStill ? heroStill.tags.find((x) => x.role === 'cta' && x.rect.y > 150) : null;
  const outroCta = headerCta ? { still: logoStill, tag: headerCta } : heroCtaTag ? { still: heroStill, tag: heroCtaTag } : null;

  // framing-groepen
  const U = (rs) => { rs = rs.filter(Boolean); if (!rs.length) return null; const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y)); return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y }; };
  const tagOf = (st, fn) => (st ? st.tags.find(fn) : null);
  const hs = ctx.stills.find((s) => s.kind === 'hero') || ctx.stills[0];
  const heroCtaR = hero && hero.evidence && hero.evidence[0] && inter(hero.evidence[0]) ? inter(hero.evidence[0]).target.rect_view : (tagOf(hs, (x) => x.role === 'cta' && x.rect.y > 150) || {}).rect;
  const heroGroup = U([(tagOf(hs, (x) => x.role === 'headline') || {}).rect, heroCtaR]);
  const menuGroup = U([(tagOf(hs, (x) => x.role === 'menu-toggle') || {}).rect, (tagOf(hs, (x) => x.role === 'cta' && x.rect.y < 120) || {}).rect, menu && menu.evidence && inter(menu.evidence[0]) ? inter(menu.evidence[0]).target.rect_view : null]);
  // muis-tracking close-up: hover-clip met cursorpad
  const hov = by(['card-hover-sweep', 'hover-card', 'hover-dropdown', 'hover-cta']);
  const hovPts = hov ? (hov.evidence || []).map((id) => inter(id)).filter(Boolean).map((h) => center(h.target.rect_view)) : [];
  const hovKeys = hov ? (hov.timeline || []).filter((e) => /hover/.test(e.event)).map((e) => e.t) : [];
  let hovPath = hov && hov.cursor_path && hov.cursor_path.length > 3 ? hov.cursor_path : hovPts.map((p, i) => ({ t: hovKeys[i] ?? (0.8 + i), x: p.x, y: p.y }));

  // explode: lagen uit de hero-still
  const LAYER_ROLES = ['headline', 'cta', 'badge', 'logo', 'heading', 'menu-toggle', 'price'];
  const heroLayers = heroStill ? heroStill.tags.filter((x) => LAYER_ROLES.includes(x.role) && x.rect.w * x.rect.h < 1920 * 1080 * 0.3 && x.rect.y >= 0 && x.rect.y + x.rect.h <= 1080 && x.rect.w > 20)
    .sort((a, b) => (a.role === 'headline' ? -1 : 0) - (b.role === 'headline' ? -1 : 0)).slice(0, 8) : [];
  // travel: twee andere sterke stills
  let travel = ctx.stills.filter((x) => x !== heroStill && x !== cardStill && (!cardStill || x.kind !== cardStill.kind)).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 2);
  if (travel.length < 2) travel = ctx.stills.filter((x) => x !== heroStill && x !== cardStill).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 2);

  // kadrering per reis-pagina: kop + wat er direct onder hoort (groep), anders het midden
  const focusGroup = (st) => {
    const tags = (st && st.tags) || [];
    const hd = tags.filter((t) => /head/.test(t.role) && t.rect && t.rect.y < 1000).sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h)[0];
    if (!hd) return null;
    let r = { ...hd.rect };
    tags.forEach((t) => { if (!t.rect || t === hd || /nav|logo|menu/.test(t.role)) return; const q = t.rect; if (q.y >= hd.rect.y - 20 && q.y <= hd.rect.y + hd.rect.h + 420 && q.x < r.x + r.w + 200 && q.x + q.w > r.x - 200 && q.w < 1850) { const x0 = Math.min(r.x, q.x), y0 = Math.min(r.y, q.y); r = { x: x0, y: y0, w: Math.max(r.x + r.w, q.x + q.w) - x0, h: Math.max(r.y + r.h, q.y + q.h) - y0 }; } });
    if (r.h < 380) r.h = Math.min(1080 - r.y, 380);
    if (r.w < 700) r.w = Math.min(1920 - r.x, 700);
    r.w = Math.min(r.w, 1700); r.h = Math.min(r.h, 900);
    return r;
  };
  const travelFocus = travel.map(focusGroup);
  // kop van de site (voor de caption): headline uit de hero-still, anders de paginatitel
  const hlTag = heroStill ? heroStill.tags.find((x) => x.role === 'headline' && (x.text || '').trim().length > 3) : null;
  const pageTitle = ((ctx.pages && ctx.pages[0] && ctx.pages[0].title) || '').split(/\s[|·–-]\s/)[0];
  const headline = (hlTag && hlTag.text) || pageTitle || '';
  let host = ''; try { host = new URL(ctx.url).hostname; } catch (e) {}

  return {
    headline, host,
    travelFocus,
    features: ctx.key_features || [], hoverKeys: hovKeys,
    heroGroup, menuGroup, hover: hov, hoverPath: hovPath, menuPath: menu && menu.cursor_path ? menu.cursor_path : null,
    heroLayers, travel, heroStill,
    hero, heroKey: t(hero, /hover/) ?? 1.6, heroFocus,
    menu, menuKey: t(menu, /klik/) ?? t(menu, /hover/) ?? 1.5, menuFocus,
    cardStill, cards,
    depth,
    slide, slideKey: t(slide, /klik|hover/) ?? 1.0, slideFocus: slide && slide.evidence && inter(slide.evidence[0]) ? center(inter(slide.evidence[0]).target.rect_view) : null,
    logoStill, logo, outroCta,
  };
}

const TLMOD = require('./showcase-timeline');
const { renderAudio, setSfxDir } = require('./sound');
// eigen geluidsmap: settings.json "sfxDir", anders <capturemap>/_sfx als die bestaat
function useSfxDir(outDir) {
  let d = null;
  try { d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'settings.json'), 'utf8')).sfxDir || null; } catch (e) {}
  if (!d) { const c = path.join(path.dirname(outDir), '_sfx'); if (fs.existsSync(c)) d = c; }
  setSfxDir(d);
}

// HTML-pagina voor render en live preview. De engine leest window.TIMELINE of krijgt SC.init(tl).
const PAGE = (tl) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Inter;src:url(fonts/inter-latin-400-normal.woff2) format('woff2');font-weight:400}
@font-face{font-family:Inter;src:url(fonts/inter-latin-600-normal.woff2) format('woff2');font-weight:600}
@font-face{font-family:Inter;src:url(fonts/inter-latin-700-normal.woff2) format('woff2');font-weight:700}
html,body{margin:0;overflow:hidden;background:#0d0d0e;-webkit-font-smoothing:antialiased}
#stage{position:absolute;inset:0;overflow:hidden;perspective-origin:50% 50%}
#wm{position:absolute;left:50%;top:50%;opacity:.075;filter:grayscale(1) invert(1) contrast(1.4);mix-blend-mode:screen;display:none}
#ground{position:absolute;inset:0;pointer-events:none}
#world{position:absolute;inset:0;transform-style:preserve-3d}
#overlay{position:absolute;inset:0;pointer-events:none}
#cap{position:absolute;inset:0;pointer-events:none;overflow:hidden}
#vig{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 80% 70% at 50% 50%,transparent 55%,rgba(0,0,0,.6) 100%)}
</style></head><body><div id="stage"><div id="bg" style="position:absolute;inset:0"></div><div id="wm"></div><div id="ground"></div><div id="world"></div></div><div id="overlay"></div><div id="fxl" style="position:absolute;inset:0;pointer-events:none;overflow:hidden"></div><div id="vig"></div><div id="cap"></div>
<div style="position:absolute;left:-9999px;top:0;font-family:Inter;font-weight:600">a</div><div style="position:absolute;left:-9999px;top:0;font-family:Inter;font-weight:700">a</div>
${tl ? `<script>window.TIMELINE=${JSON.stringify(tl)};</script>` : ''}<script src="engine.js"></script></body></html>`;

// Wanneer staat het menu stil (volledig open)? Laatste moment na de klik met duidelijke beeldverandering.
async function menuOpenTime(work, R, key) {
  const sh = require('sharp');
  const dir = path.join(work, R.menu.pdir || R.menu.dir), fps = R.menu.fps || 30;
  const from = Math.max(1, Math.round(key * fps)), prevs = [];
  let prev = null, last = from;
  for (let i = from; i <= R.menu.count; i++) {
    const f = path.join(dir, String(i).padStart(5, '0') + '.jpg');
    if (!fs.existsSync(f)) continue;
    const buf = await sh(f).resize(64, 36, { fit: 'fill' }).greyscale().raw().toBuffer();
    if (prev) { let d = 0; for (let k = 0; k < buf.length; k++) d += Math.abs(buf[k] - prev[k]); d /= buf.length; if (d > 1.2) last = i; }
    prev = buf;
  }
  return Math.min(R.menu.count / fps, last / fps + 0.1);
}
// Links die pas na de klik zichtbaar werden (vastgelegd tijdens de capture) = het geopende menu
function menuLinksRect(clip) {
  const e = clip && (clip.timeline || []).find((x) => x.new_links && x.new_links.length);
  if (!e) return null;
  let L = e.new_links.filter((l) => l.w < 1200 && l.h < 400);
  // sluitknopjes/iconen niet meenemen (die staan vaak ver weg in een hoek)
  const txt = L.filter((l) => (l.text || '').replace(/[^\p{L}\p{N}]/gu, '').length >= 3);
  if (txt.length >= 2) L = txt;
  // grootste groep die op een kolom of rij ligt
  if (L.length > 2) { const byX = {}; L.forEach((l) => { const k = Math.round(l.x / 60); (byX[k] = byX[k] || []).push(l); }); const best = Object.values(byX).sort((a, b) => b.length - a.length)[0]; if (best.length >= 3) L = best; }
  if (!L.length) return null;
  const x0 = Math.min(...L.map((l) => l.x)), y0 = Math.min(...L.map((l) => l.y));
  const x1 = Math.max(...L.map((l) => l.x + l.w)), y1 = Math.max(...L.map((l) => l.y + l.h));
  const pad = 50;
  return { x: Math.max(0, x0 - pad), y: Math.max(0, y0 - pad), w: Math.min(1920, x1 + pad) - Math.max(0, x0 - pad), h: Math.min(1080, y1 + pad) - Math.max(0, y0 - pad) };
}
// Waar staat het geopende menu? Bounding box van wat veranderd is tussen vlak voor de klik en menu open.
async function menuOpenRect(work, R, key, openT) {
  const sh = require('sharp');
  const dir = path.join(work, R.menu.pdir || R.menu.dir), fps = R.menu.fps || 30;
  const fa = (t) => path.join(dir, String(Math.min(R.menu.count, Math.max(1, Math.round(t * fps)))).padStart(5, '0') + '.jpg');
  const W = 96, H = 54;
  const a = await sh(fa(key - 0.15)).resize(W, H, { fit: 'fill' }).greyscale().raw().toBuffer();
  const b = await sh(fa(openT - 0.05)).resize(W, H, { fit: 'fill' }).greyscale().raw().toBuffer();
  // drempel oplopend: bij een schermvullend menu blijft alleen het echt nieuwe vlak (paneel met links) over
  for (const thr of [18, 45, 70]) {
  const col = new Array(W).fill(0), row = new Array(H).fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.abs(a[y * W + x] - b[y * W + x]) > thr) { col[x]++; row[y]++; }
  const span = (arr, n, min) => { let lo = -1, hi = -1; arr.forEach((v, i) => { if (v >= min) { if (lo < 0) lo = i; hi = i; } }); return lo < 0 ? null : [lo / n, (hi + 1) / n]; };
  const sx = span(col, W, H * 0.2), sy = span(row, H, W * 0.08);
  if (!sx || !sy) return null;
  const r = { x: sx[0] * 1920, y: sy[0] * 1080, w: (sx[1] - sx[0]) * 1920, h: (sy[1] - sy[0]) * 1080 };
  if (r.w < 120 || r.h < 120) return null;
  if (r.w * r.h < 1920 * 1080 * 0.7 || thr === 70) return r;
  }
  return null;
}

// Assets voorbereiden (eenmalig per capture, daarna uit cache): frames van clips (scherp, proxy, wazig), stills, logo, CTA.
async function prepareAssets(outDir, opts = {}) {
  const work = path.join(outDir, 'showcase', '_assets');
  const cacheFile = path.join(work, 'assets.json');
  fs.mkdirSync(work, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'showcase-engine.browser.js'), path.join(work, 'engine.js'));
  fs.copyFileSync(path.join(__dirname, 'showcase-timeline.js'), path.join(work, 'timeline.js'));
  for (const k of ['burn', 'leak']) { const src = path.join(__dirname, 'fx', k), dst = path.join(work, 'fx', k); fs.mkdirSync(dst, { recursive: true }); fs.readdirSync(src).forEach((f) => fs.copyFileSync(path.join(src, f), path.join(dst, f))); }
  { const src = path.join(__dirname, 'fonts'), dst = path.join(work, 'fonts'); fs.mkdirSync(dst, { recursive: true }); if (fs.existsSync(src)) fs.readdirSync(src).forEach((f) => fs.copyFileSync(path.join(src, f), path.join(dst, f))); }
  if (!opts.force && fs.existsSync(cacheFile)) { const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); if (c.v === 22) {
    if (c.A.travelFocus === undefined) { try { const ctx = JSON.parse(fs.readFileSync(path.join(outDir, 'website-reference-context.json'), 'utf8')); c.A.travelFocus = pickAssets(ctx).travelFocus; fs.writeFileSync(cacheFile, JSON.stringify(c)); } catch (e) {} }
    if (c.A.headline === undefined || !c.R.host) { try { const ctx = JSON.parse(fs.readFileSync(path.join(outDir, 'website-reference-context.json'), 'utf8')); const a = pickAssets(ctx); c.A.headline = a.headline; c.R.host = a.host; fs.writeFileSync(cacheFile, JSON.stringify(c)); } catch (e) {} }
    if (c.R.menu && c.A.menuRect === undefined) {
      try {
        const A = c.A, R = c.R;
        A.menuOpen = await menuOpenTime(work, R, A.menuKey);
        A.menuRect = menuLinksRect(A.menu) || await menuOpenRect(work, R, A.menuKey, A.menuOpen);
        if (A.menuRect) A.menuDive = { x: A.menuRect.x + A.menuRect.w * 0.5, y: A.menuRect.y + A.menuRect.h * 0.55 };
        const idx = Math.min(R.menu.count, Math.max(1, Math.round((A.menuOpen + 0.1) * 30)));
        R.menuColor = await avgColor(path.join(work, R.menu.dir, String(idx).padStart(5, '0') + '.jpg'), A.menuDive.x - 40, A.menuDive.y - 40, 80, 80);
        fs.writeFileSync(cacheFile, JSON.stringify(c));
      } catch (e) {}
    }
    const ck = customFiles(outDir).map((x) => x.norm).join('|');
    if ((c.R.customKey || '') !== ck) { try { const ca = await customAssets(outDir, work); c.R.customLib = ca.lib; c.R.customClips = ca.clips; c.R.customPhone = ca.phone; c.R.customKey = ck; fs.writeFileSync(cacheFile, JSON.stringify(c)); } catch (e) {} }
    if (!c.R.mobileStills) { try { const ctx = JSON.parse(fs.readFileSync(path.join(outDir, 'website-reference-context.json'), 'utf8')); c.R.mobileStills = await mobileStills(outDir, work, ctx); fs.writeFileSync(cacheFile, JSON.stringify(c)); } catch (e) {} }
    if (!c.R.library || c.R.libraryV !== 2) { try { const ctx = JSON.parse(fs.readFileSync(path.join(outDir, 'website-reference-context.json'), 'utf8')); c.R.library = await buildLibrary(outDir, work, ctx); c.R.libraryV = 2; fs.writeFileSync(cacheFile, JSON.stringify(c)); } catch (e) {} }
    return c;
  } }
  const ctx = JSON.parse(fs.readFileSync(path.join(outDir, 'website-reference-context.json'), 'utf8'));
  const A = pickAssets(ctx);
  const R = {};
  if (A.hero) R.hero = await prepClip(outDir, work, A.hero);
  if (A.menu) {
    R.menu = await prepClip(outDir, work, A.menu);
    // duik-punt: vlak bij de aangeklikte knop, waar het geopende menu als eerste staat; kleur op dat punt
    const f = A.menuFocus;
    A.menuDive = { x: Math.max(80, Math.min(1840, f.x - 160)), y: Math.max(80, Math.min(1000, f.y + 220)) };
    try { A.menuOpen = await menuOpenTime(work, R, A.menuKey); } catch (e) { A.menuOpen = A.menuKey + 1.2; }
    A.menuRect = menuLinksRect(A.menu);
    if (!A.menuRect) { try { A.menuRect = await menuOpenRect(work, R, A.menuKey, A.menuOpen); } catch (e) { A.menuRect = null; } }
    if (A.menuRect) A.menuDive = { x: A.menuRect.x + A.menuRect.w * 0.5, y: A.menuRect.y + A.menuRect.h * 0.55 };
    const idx = Math.min(R.menu.count, Math.max(1, Math.round((A.menuOpen + 0.1) * 30)));
    const fr = path.join(work, R.menu.dir, String(idx).padStart(5, '0') + '.jpg');
    R.menuColor = await avgColor(fr, A.menuDive.x - 40, A.menuDive.y - 40, 80, 80);
  }
  if (A.cardStill) { R.cards = await prepStill(outDir, work, A.cardStill); const c0 = A.cards[0].rect; R.pageBg = await avgColor(R.cards.file, Math.max(0, c0.x - 40), c0.y + c0.h / 2, 24, 24); }
  if (A.depth) R.depth = await prepClip(outDir, work, A.depth);
  if (A.hover) R.hover = A.hover.clip === (A.menu && A.menu.clip) ? R.menu : await prepClip(outDir, work, A.hover);
  // key features (close-ups)
  if (A.features && A.features.length) {
    R.features = [];
    const PRI = { trust: 0, stat: 1, offer: 2, price: 3, service: 4 };
    const fs2 = A.features.slice().sort((a, b) => (PRI[a.kind] ?? 9) - (PRI[b.kind] ?? 9) || b.score - a.score);
    const oneEach = []; fs2.forEach((f) => { if (!oneEach.some((x) => x.kind === f.kind)) oneEach.push(f); });
    for (const f of oneEach.slice(0, 4)) {
      const st = await prepStill(outDir, work, { no: 'f' + f.no, clean: f.file });
      R.features.push({ src: st, rect: f.rect, kind: f.kind, text: f.text, ring: await ringStats(st.file, f.rect) });
    }
  }
  // feature-groepen (pop-wall): kaarten, reviews, USP's naast elkaar
  R.groups = [];
  for (const g of (ctx.key_feature_groups || []).slice(0, 2)) {
    try { const st = await prepStill(outDir, work, { no: 'g' + g.no, clean: g.file }); const rings = []; for (const it of g.items) rings.push(await ringStats(st.file, it)); R.groups.push({ src: st, rect: g.rect, items: g.items, kind: g.kind, texts: g.texts, rings }); } catch (e) {}
  }
  // mobiel
  const mScroll = (ctx.clips || []).find((c) => c.type === 'mobile-scroll');
  const mMenu = (ctx.clips || []).find((c) => c.type === 'mobile-menu');
  if (mScroll) { R.mobileScroll = await prepClip(outDir, work, mScroll); A.mobileScrollDur = mScroll.duration_s; }
  if (mMenu) {
    R.mobileMenu = await prepClip(outDir, work, mMenu);
    const tk = (mMenu.timeline || []).find((e) => /tik/.test(e.event));
    if (tk && mMenu.tap) A.mobileMenuTap = { t: tk.t, x: mMenu.tap.x, y: mMenu.tap.y };
  }
  if (A.slide) R.slide = await prepClip(outDir, work, A.slide);
  if (A.logo) {
    const st = await prepStill(outDir, work, A.logoStill);
    const r = A.logo.rect;
    const px = Math.min(56, r.x), py = Math.min(26, r.y);
    const crop = { x: r.x - px, y: r.y - py, w: r.w + px * 2, h: r.h + py * 2 };
    const sc = 640 / crop.w;
    R.logo = { crop, w: Math.round(crop.w * sc), h: Math.round(crop.h * sc) };
    R.logoSrc = st; R.logoBg = await avgColor(st.file, Math.max(0, r.x - 20), r.y + r.h / 2 - 3, 8, 6);
    const ws = 2600 / r.w;
    R.wm = { src: st.url, w: Math.round(r.w * ws), h: Math.round(r.h * ws), bw: Math.round(1920 * ws), bh: Math.round(1080 * ws), bx: Math.round(r.x * ws), by: Math.round(r.y * ws) };
  }
  if (A.outroCta) {
    const st = A.logoStill && A.outroCta.still.no === A.logoStill.no ? R.logoSrc : await prepStill(outDir, work, A.outroCta.still);
    const r = A.outroCta.tag.rect;
    const sc = 460 / r.w;
    R.cta = { crop: { x: r.x, y: r.y, w: r.w, h: r.h }, w: Math.round(r.w * sc), h: Math.round(r.h * sc) };
    R.ctaSrc = st;
  }
  if (A.heroStill && A.heroLayers.length) { R.heroStill = await prepStill(outDir, work, A.heroStill); R.heroRings = []; for (const t of A.heroLayers) R.heroRings.push(await ringStats(R.heroStill.file, t.rect)); }
  if (R.cards && A.cards) { R.cardRings = []; for (const c of A.cards) R.cardRings.push(await ringStats(R.cards.file, c.rect)); }
  if (A.travel.length >= 2) R.travel = [await prepStill(outDir, work, A.travel[0]), await prepStill(outDir, work, A.travel[1])];
  // merkkleuren: CTA-kleur als accent, logo-achtergrond als tweede
  const ctaTag = A.heroStill ? A.heroStill.tags.find((x) => x.role === 'cta') : null;
  if (ctaTag) { const hs = R.heroStill || (await prepStill(outDir, work, A.heroStill)); R.accent = await avgColor(hs.file, ctaTag.rect.x + ctaTag.rect.w * 0.12, ctaTag.rect.y + ctaTag.rect.h * 0.3, Math.max(4, ctaTag.rect.w * 0.08), Math.max(4, ctaTag.rect.h * 0.3)); }
  R.accent = toHex(R.accent || '#ff7a2f'); R.accent2 = toHex(R.logoBg || R.pageBg || '#f5f0e8');
  R.host = A.host;
  R.library = await buildLibrary(outDir, work, ctx); R.libraryV = 2;
  R.mobileStills = await mobileStills(outDir, work, ctx);
  { const ca = await customAssets(outDir, work); R.customLib = ca.lib; R.customClips = ca.clips; R.customPhone = ca.phone; R.customKey = customFiles(outDir).map((x) => x.norm).join('|'); }
  const out = { A, R, site: ctx.url, v: 22 };
  fs.writeFileSync(cacheFile, JSON.stringify(out));
  return out;
}

function framesForShots(tl, ids, per) {
  const at = [];
  tl.shots.filter((s) => !ids || !ids.length || ids.includes(s.id)).forEach((s) => {
    for (let i = 0; i < per; i++) at.push(+(s.start + (s.end - s.start) * (i + 0.5) / per).toFixed(2));
  });
  return at;
}

function loadParams(outDir, override) {
  const f = path.join(outDir, 'showcase', 'params.json');
  let p = {};
  if (fs.existsSync(f)) { try { p = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {} }
  return TLMOD.merge({ ...p, ...(override || {}), shots: { ...(p.shots || {}), ...((override && override.shots) || {}) } });
}

// hoeveel parallelle render-pagina's: helft van de kernen (M4 Pro: 6), minimaal 1
function defaultWorkers() {
  const os = require('os');
  const n = os.cpus().length, memGB = os.totalmem() / 2 ** 30;
  return Math.max(1, Math.min(8, Math.floor(n / 2), Math.floor(memGB / 2.5)));
}
// hardware-encoder op de Mac (VideoToolbox), anders x264
let ENC = null;
async function pickEncoder() {
  if (ENC) return ENC;
  const x264 = { name: 'x264', args: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'high', '-pix_fmt', 'yuv420p'] };
  if (process.platform === 'darwin') {
    try {
      await run(ffmpegPath(), ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=256x256:d=0.2', '-c:v', 'h264_videotoolbox', '-b:v', '2M', '-f', 'null', '-']);
      ENC = { name: 'VideoToolbox (hardware)', args: ['-c:v', 'h264_videotoolbox', '-b:v', '28M', '-maxrate', '40M', '-bufsize', '56M', '-profile:v', 'high', '-pix_fmt', 'yuv420p'] };
      return ENC;
    } catch (e) {}
  }
  ENC = x264; return ENC;
}

async function renderShowcase(outDir, cfg = {}) {
  const fps = cfg.showcaseFps || 30;
  const maxSub = cfg.maxSubframes || 14;
  const onProgress = cfg.onProgress || (() => {});
  const sdir = path.join(outDir, 'showcase');
  const assets = await prepareAssets(outDir);
  const work = path.join(sdir, '_assets');
  const params = loadParams(outDir, cfg.params);
  if (!cfg.stillsAt && !cfg.noSave) fs.writeFileSync(path.join(sdir, 'params.json'), JSON.stringify(params, null, 2));
  const tl = TLMOD.buildTimeline(assets.A, assets.R, params);
  if (cfg.stillsAtShots) cfg.stillsAt = framesForShots(tl, cfg.stillsAtShots.ids, cfg.stillsAtShots.per);
  const VW = tl.width, VH = tl.height;
  fs.writeFileSync(path.join(sdir, 'timeline.json'), JSON.stringify(tl, null, 1));
  const html = path.join(work, 'render.html');
  fs.writeFileSync(html, PAGE(tl));

  const launchOpts = { headless: true, args: ['--allow-file-access-from-files', '--force-color-profile=srgb', '--hide-scrollbars'] };
  if (process.env.CHROME_PATH) { launchOpts.executablePath = process.env.CHROME_PATH; launchOpts.args.push('--no-sandbox', '--no-zygote', '--use-gl=angle', '--use-angle=swiftshader'); }
  else if (process.platform === 'darwin') launchOpts.args.push('--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-zero-copy');
  const browser = await chromium.launch(launchOpts);
  // supersampling: de scene op 1,5x of 2x tekenen en terugschalen (Lanczos): schuine randen en kleine tekst zonder trapjes
  const SS = Math.max(1, Math.min(2, +cfg.supersample || 1));
  const openPage = async () => {
    const ctxB = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: SS });
    const pg = await ctxB.newPage();
    pg.on('pageerror', (e) => log('  ! engine: ' + e.message));
    pg.on('console', (m) => { if (m.type() === 'error') log('  ! console: ' + m.text().slice(0, 200)); });
    await pg.goto('file://' + html, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await pg.waitForFunction(() => window.SC && window.SC.ready, null, { timeout: 60000 });
    return pg;
  };
  const page = await openPage();

  const sharp = require('sharp');
  const grabOf = (pg) => async () => {
    const b = await pg.screenshot(SS > 1 ? { type: 'png' } : { type: 'jpeg', quality: 94 });
    const im = SS > 1 ? sharp(b).resize(VW, VH, { kernel: 'lanczos3', fit: 'fill' }) : sharp(b);
    return (await im.raw().toBuffer({ resolveWithObject: true })).data;
  };

  if (cfg.stillsAt) { // losse frames (preview / debug)
    const dir = cfg.framesDir || sdir;
    fs.mkdirSync(dir, { recursive: true });
    const files = [];
    for (const t of cfg.stillsAt) {
      await page.evaluate((t) => window.SC.render(t), t);
      const f = path.join(dir, `frame_${t.toFixed(2)}.jpg`);
      await page.screenshot({ path: f, type: 'jpeg', quality: 88 });
      files.push({ t, file: f });
    }
    await browser.close();
    return { frames: files, duration: tl.duration, timeline: tl };
  }

  const dn = new Date(); const pd = (n) => String(n).padStart(2, '0');
  const stamp = `${dn.getFullYear()}${pd(dn.getMonth() + 1)}${pd(dn.getDate())}-${pd(dn.getHours())}${pd(dn.getMinutes())}${pd(dn.getSeconds())}`;
  const fmt = params.format.replace(':', 'x');
  const outFile = path.join(sdir, `SHOWCASE_${fmt}_${stamp}.mp4`);
  fs.writeFileSync(outFile.replace(/\.mp4$/, '.timeline.json'), JSON.stringify({ shots: tl.shots, duration: tl.duration, edit: tl.edit, params }, null, 1));
  const soundOn = (params.sound || 'full') !== 'off';
  const vidFile = soundOn ? outFile.replace(/\.mp4$/, '_video.mp4') : outFile;
  const grain = Math.max(0, Math.round(3 * (params.grain ?? 1)));
  const RB = tl.render || {};
  const bloomA = Math.max(0, Math.min(1.5, RB.bloom || 0)), chromaA = Math.max(0, Math.min(1.5, RB.chroma || 0));
  // bloom: heldere delen licht laten stralen (drempel + blur + screen)
  const bloomF = bloomA > 0.01 ? `format=gbrp,split[bm][bb];[bb]curves=all='0/0 0.62/0 1/1',gblur=sigma=${Math.round(18 + 14 * bloomA)}[bg];[bm][bg]blend=all_mode=screen:all_opacity=${(0.55 * bloomA).toFixed(2)},` : '';
  // filmische grade: zachte S-curve (iets diepere schaduwen, iets opener licht) en een tikje meer verzadiging
  const gA = Math.max(0, Math.min(1.5, RB.grade || 0));
  const gradeF = gA > 0.01 ? `curves=master='0/0 0.25/${(0.25 - 0.022 * gA).toFixed(3)} 0.5/${(0.5 + 0.012 * gA).toFixed(3)} 0.75/${(0.75 + 0.02 * gA).toFixed(3)} 1/1',` : '';
  const eqF = gA > 0.01 ? `,eq=saturation=${(1 + 0.1 * gA).toFixed(3)}:contrast=${(1 + 0.03 * gA).toFixed(3)}` : '';
  const vf = bloomF + gradeF + 'format=yuv420p' + eqF + (grain > 0 ? `,noise=alls=${grain}:allf=t` : '');
  // RGB-verschuiving bij snelle bewegingen (rood en blauw uit elkaar, horizontaal)
  const lensA = Math.max(0, Math.min(1.5, RB.lens || 0));
  // lens-CA: rood iets naar buiten, blauw iets naar binnen, sterker naar de randen (zoals een echte lens)
  let LMAP = null;
  const lensShift = (buf) => {
    const K = 4.5 * lensA; if (K < 0.4) return buf;
    if (!LMAP) { // bronpixels één keer uitrekenen
      const cx = VW / 2, cy = VH / 2, inv = 1 / Math.hypot(cx, cy);
      LMAP = { r: new Int32Array(VW * VH), b: new Int32Array(VW * VH) };
      for (let y = 0; y < VH; y++) for (let x = 0; x < VW; x++) {
        const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy) * inv, f = K * r * r * inv;
        const xr = Math.min(VW - 1, Math.max(0, Math.round(x - dx * f))), yr = Math.min(VH - 1, Math.max(0, Math.round(y - dy * f)));
        const xb = Math.min(VW - 1, Math.max(0, Math.round(x + dx * f))), yb = Math.min(VH - 1, Math.max(0, Math.round(y + dy * f)));
        LMAP.r[y * VW + x] = (yr * VW + xr) * 3; LMAP.b[y * VW + x] = (yb * VW + xb) * 3 + 2;
      }
    }
    const o = Buffer.from(buf), R = LMAP.r, B = LMAP.b, n = VW * VH;
    for (let p = 0, i = 0; p < n; p++, i += 3) { o[i] = buf[R[p]]; o[i + 2] = buf[B[p]]; }
    return o;
  };
  const chromaShift = (buf, sp) => {
    const k = Math.round(Math.min(1, Math.max(0, (sp - 18) / 60)) * 7 * chromaA);
    if (k < 1) return buf;
    const o = Buffer.from(buf), row = VW * 3;
    for (let y = 0; y < VH; y++) {
      const b0 = y * row;
      for (let x = 0; x < VW; x++) {
        const i = b0 + x * 3;
        const xr = Math.max(0, x - k), xb = Math.min(VW - 1, x + k);
        o[i] = buf[b0 + xr * 3]; o[i + 2] = buf[b0 + xb * 3 + 2];
      }
    }
    return o;
  };
  // restblur: korte box-blur langs de hoofdrichting van de beweging (horizontaal, verticaal of diagonaal), zodat er tussen
  // de subframes geen losse kopieen van scherpe randen (tekst) te zien zijn
  const smear = (src, dx, dy, L) => {
    if (L < 2) return src;
    const len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    const ax = Math.abs(ux), ay = Math.abs(uy);
    const sx = ax > 0.38 ? Math.sign(ux) : 0, sy = ay > 0.38 ? Math.sign(uy) : 0;
    const steps = []; for (let k = -Math.floor(L / 2); k <= Math.floor(L / 2); k++) steps.push(k);
    const o = Buffer.alloc(VW * VH * 3);
    for (let y = 0; y < VH; y++) {
      for (let x = 0; x < VW; x++) {
        let r = 0, g = 0, b = 0, n = 0;
        for (const k of steps) { const xx = x + k * sx, yy = y + k * sy; if (xx < 0 || yy < 0 || xx >= VW || yy >= VH) continue; const i = (yy * VW + xx) * 3; r += src[i]; g += src[i + 1]; b += src[i + 2]; n++; }
        const i = (y * VW + x) * 3; o[i] = r / n; o[i + 1] = g / n; o[i + 2] = b / n;
      }
    }
    return o;
  };
  const enc = await pickEncoder();
  const total = Math.round(tl.duration * fps);
  const motion = await page.evaluate(([n, fps]) => { const o = []; for (let f = 0; f < n; f++) o.push(window.SC.motion(f / fps, 1 / fps)); return o; }, [total, fps]);
  const shutter = (0.55 * (params.motionBlur ?? 1)) / fps;
  // parallel renderen: elke worker een eigen pagina (eigen proces) en een eigen videostuk; daarna aan elkaar zonder hercoderen
  const W = Math.max(1, Math.min(cfg.workers || defaultWorkers(), Math.ceil(total / 30)));
  log(`  render: ${total} frames, ${W} parallel, encoder ${enc.name}`);
  const pages = [page];
  for (let i = 1; i < W; i++) pages.push(await openPage());
  const t0 = Date.now();
  let doneFrames = 0, subTotal = 0;
  const segs = [];
  // optioneel alleen een stuk renderen (testen van één shot): cfg.range = [van, tot] in seconden
  const F0 = cfg.range ? Math.max(0, Math.round(cfg.range[0] * fps)) : 0, F1 = cfg.range ? Math.min(total, Math.round(cfg.range[1] * fps)) : total;
  const bounds = Array.from({ length: W + 1 }, (_, i) => F0 + Math.round(((F1 - F0) * i) / W));
  const renderRange = async (pg, a, b, file) => {
    const grab = grabOf(pg);
    const ff = spawn(ffmpegPath(), ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${VW}x${VH}`, '-r', String(fps), '-i', '-',
      '-vf', vf, ...enc.args, '-movflags', '+faststart', file], { stdio: ['pipe', 'ignore', 'pipe'] });
    let ferr = ''; ff.stderr.on('data', (d) => (ferr += d));
    const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg: ' + ferr.slice(-600))))));
    done.catch(() => {}); // bij stoppen faalt ffmpeg bewust; nooit een losse foutmelding die het programma laat crashen
    ff.stdin.on('error', () => {});
    const acc = new Uint32Array(VW * VH * 3);
    const out = Buffer.alloc(VW * VH * 3);
    for (let f = a; f < b; f++) {
      if (cfg.shouldStop && cfg.shouldStop()) { try { ff.kill('SIGKILL'); } catch (e) {} throw new Error('gestopt'); }
      const t = f / fps;
      const fl = shutter > 0 || chromaA > 0.01 ? await pg.evaluate(([t, dt]) => window.SC.flow(t, dt), [t, shutter || 1 / fps]) : { max: 0, dx: 0, dy: 0 };
      const sp = fl.max;
      // echte sluiter: genoeg subframes dat er geen losse 'kopieen' ontstaan (max ~1,5 px per stap),
      // tijden per frame licht verschoven (gestratificeerd) en zachte randen aan het sluitervenster
      const n = shutter > 0 ? Math.max(1, Math.min(maxSub, Math.ceil(sp / 1.5))) : 1;
      const resid = shutter > 0 && n > 1 ? sp / n : 0; // stap tussen twee subframes; boven ~1,5 px vullen we die met een kleine richtingsblur
      subTotal += n;
      let frame;
      if (n === 1) {
        await pg.evaluate((t) => window.SC.render(t), t);
        frame = await grab();
      } else {
        acc.fill(0);
        let wsum = 0;
        const jr = ((f * 2654435761) >>> 0) / 4294967296;
        for (let k = 0; k < n; k++) {
          const u = (k + 0.25 + 0.5 * ((jr + k * 0.618) % 1)) / n;
          const tk = t + (u - 0.5) * shutter;
          const w = Math.round(16 * (1 - 0.55 * Math.abs(2 * u - 1)));
          wsum += w;
          await pg.evaluate((t) => window.SC.render(t), Math.max(0, tk));
          const px = await grab();
          for (let i = 0; i < px.length; i++) acc[i] += px[i] * w;
        }
        for (let i = 0; i < out.length; i++) out[i] = (acc[i] + (wsum >> 1)) / wsum | 0;
        frame = out;
        if (resid > 1.5) frame = smear(frame, fl.dx, fl.dy, Math.min(9, Math.round(resid * 1.1)));
      }
      if (chromaA > 0.01) frame = chromaShift(frame, sp / Math.max(1e-6, (shutter || 1 / fps) * fps));
      if (lensA > 0.01) frame = lensShift(frame);
      // altijd een kopie wegschrijven: de stream houdt de buffer vast tot ffmpeg hem leest, en wij hergebruiken onze buffers
      // voor het volgende frame. Zonder kopie kon een frame half overschreven worden (glitch).
      if (!ff.stdin.write(Buffer.from(frame))) await new Promise((r) => ff.stdin.once('drain', r));
      doneFrames++;
      const pct = Math.min(99, Math.round((doneFrames / (F1 - F0)) * 100));
      onProgress({ pct, frame: doneFrames, total: F1 - F0, elapsed: (Date.now() - t0) / 1000 });
      if (doneFrames % fps === 0) log(`  showcase ${pct}% (${((Date.now() - t0) / 1000).toFixed(0)}s, gem. ${(subTotal / doneFrames).toFixed(1)} subframes)`);
    }
    ff.stdin.end();
    await done;
  };
  try {
    await Promise.all(pages.map((pg, i) => { const f = W === 1 ? vidFile : outFile.replace(/\.mp4$/, `_part${i}.mp4`); segs.push(f); return renderRange(pg, bounds[i], bounds[i + 1], f); }));
  } catch (e) {
    await browser.close().catch(() => {});
    segs.forEach((f) => fs.rmSync(f, { force: true }));
    throw e;
  }
  await browser.close();
  if (W > 1) {
    const list = outFile.replace(/\.mp4$/, '_parts.txt');
    fs.writeFileSync(list, segs.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
    await run(ffmpegPath(), ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', vidFile]);
    segs.forEach((f) => fs.rmSync(f, { force: true })); fs.rmSync(list, { force: true });
  }
  onProgress({ pct: 100, frame: total, total, elapsed: (Date.now() - t0) / 1000 });
  log(`  video klaar in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (soundOn) {
    const wav = outFile.replace(/\.mp4$/, '_audio.wav');
    useSfxDir(outDir); renderAudio(tl, motion, fps, wav);
    await run(ffmpegPath(), ['-y', '-v', 'error', '-i', vidFile, '-i', wav, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', outFile]);
    fs.rmSync(vidFile, { force: true });
  }
  fs.copyFileSync(outFile, path.join(sdir, `SHOWCASE_${fmt}.mp4`));
  return { file: outFile, duration: tl.duration };
}

// Alleen geluid (voor de live preview in de Studio): bewegingsanalyse in een lichte pagina, dan synthese
async function renderAudioOnly(outDir, params, outWav) {
  const assets = await prepareAssets(outDir);
  const tl = TLMOD.buildTimeline(assets.A, assets.R, loadParams(outDir, params));
  const html = path.join(outDir, 'showcase', '_assets', 'render.html');
  fs.writeFileSync(html, PAGE(null));
  const launchOpts = { headless: true, args: ['--allow-file-access-from-files'] };
  if (process.env.CHROME_PATH) { launchOpts.executablePath = process.env.CHROME_PATH; launchOpts.args.push('--no-sandbox', '--no-zygote'); }
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: tl.width, height: tl.height } });
  await page.goto('file://' + html, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.SC && window.SC.ready);
  const fps = 30, n = Math.round(tl.duration * fps);
  const motion = await page.evaluate(([tl, n, fps]) => { window.SC.init({ ...tl, live: true }); const o = []; for (let f = 0; f < n; f++) o.push(window.SC.motion(f / fps, 1 / fps)); return o; }, [tl, n, fps]);
  await browser.close();
  useSfxDir(outDir); renderAudio(tl, motion, fps, outWav);
  return { file: outWav, duration: tl.duration };
}

// ---- eigen beelden en video's (map custom/ in het project) ----
const IMG_RE = /\.(png|jpe?g|webp)$/i, VID_RE = /\.(mp4|mov|m4v|webm)$/i;
async function addCustom(outDir, file) {
  // normaliseren: video naar 16:9 1920x1080, max 12 s, plus posterbeeld; beeld: een 16:9-versie (bovenkant) voor de snelle keuze
  const sh = require('sharp');
  const cdir = path.join(outDir, 'custom'), ndir = path.join(cdir, '_169'); fs.mkdirSync(ndir, { recursive: true });
  const base = path.basename(file).replace(/\.[^.]+$/, '');
  if (VID_RE.test(file)) {
    const out = path.join(ndir, base + '.mp4');
    await run(ffmpegPath(), ['-y', '-v', 'error', '-i', file, '-t', '12', '-an', '-vf', 'fps=30,scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', out]);
    await run(ffmpegPath(), ['-y', '-v', 'error', '-ss', '0.5', '-i', out, '-frames:v', '1', '-q:v', '3', path.join(ndir, base + '.jpg')]);
  } else if (IMG_RE.test(file)) {
    const m = await sh(file).metadata();
    const w = m.width, h = Math.min(m.height, Math.round(w * 9 / 16));
    await sh(file).extract({ left: 0, top: 0, width: w, height: h }).resize(1920, 1080, { fit: 'cover' }).removeAlpha().jpeg({ quality: 92 }).toFile(path.join(ndir, base + '.jpg'));
  }
  // telefoonversie (staand), zodat elk eigen beeld of video ook op een telefoonscherm kan
  const pdir = path.join(cdir, '_phone'); fs.mkdirSync(pdir, { recursive: true });
  if (VID_RE.test(file)) await run(ffmpegPath(), ['-y', '-v', 'error', '-i', file, '-t', '12', '-an', '-vf', 'fps=30,scale=780:1688:force_original_aspect_ratio=increase,crop=780:1688', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', path.join(pdir, base + '.mp4')]);
  else if (IMG_RE.test(file)) await sh(file).resize(1170, 2532, { fit: 'cover', position: 'top' }).removeAlpha().jpeg({ quality: 90 }).toFile(path.join(pdir, base + '.jpg'));
}
function customFiles(outDir) {
  const cdir = path.join(outDir, 'custom');
  if (!fs.existsSync(cdir)) return [];
  return fs.readdirSync(cdir).filter((f) => IMG_RE.test(f) || VID_RE.test(f)).sort().map((f) => ({ file: 'custom/' + f, video: VID_RE.test(f), norm: 'custom/_169/' + f.replace(/\.[^.]+$/, '') + (VID_RE.test(f) ? '.mp4' : '.jpg'), poster: 'custom/_169/' + f.replace(/\.[^.]+$/, '') + '.jpg' })).filter((c) => fs.existsSync(path.join(outDir, c.norm)));
}
async function customAssets(outDir, work) {
  const lib = [], clips = [], phone = [];
  for (const c of customFiles(outDir)) {
    const pf = 'custom/_phone/' + path.basename(c.norm);
    if (fs.existsSync(path.join(outDir, pf))) {
      const pk = require('crypto').createHash('md5').update(pf + fs.statSync(path.join(outDir, pf)).size).digest('hex').slice(0, 8);
      const plabel = 'eigen · ' + path.basename(c.file).replace(/\.[^.]+$/, '').slice(0, 30) + (c.video ? ' (video)' : '');
      try { phone.push({ id: 'cp:' + pk, label: plabel, src: c.video ? await prepClip(outDir, work, { clip: 'p' + pk, file: pf }) : await prepStill(outDir, work, { no: 'p' + pk, clean: pf }) }); } catch (e) {}
    }
    const key = require('crypto').createHash('md5').update(c.norm + fs.statSync(path.join(outDir, c.norm)).size).digest('hex').slice(0, 8);
    const label = 'eigen · ' + path.basename(c.file).replace(/\.[^.]+$/, '').slice(0, 36);
    if (c.video) { const cl = await prepClip(outDir, work, { clip: 'c' + key, file: c.norm }); clips.push({ id: 'cv:' + key, label: label + ' (video)', src: cl }); }
    else {
      const src = await prepStill(outDir, work, { no: 'c' + key, clean: c.norm });
      let layers = [];
      try { const rects = await autoCut(src.file, { x: 0, y: 0, w: 1920, h: 1080 }, { max: 7 }); for (const r of rects) layers.push({ rect: r, role: 'blok', ring: await ringStats(src.file, r) }); } catch (e) {}
      lib.push({ id: 'ci:' + key, label, page: 0, kind: 'eigen', src, layers });
    }
  }
  return { lib, clips, phone };
}

// ---- eigen uitsnede (Studio-viewer): elk deel van elke vastgelegde afbeelding wordt een 1920x1080-vlak ----
// source = pad binnen het project (pages/..., stills/..., states/...), rects in CSS-pixels van die afbeelding (breedte 1920 = 1x).
async function listSources(outDir) {
  const ctx = JSON.parse(fs.readFileSync(path.join(outDir, 'website-reference-context.json'), 'utf8'));
  const sh = require('sharp');
  const meta = async (f) => { try { const m = await sh(path.join(outDir, f)).metadata(); return m; } catch (e) { return null; } };
  const out = [];
  const rel = (u) => { try { const p = new URL(u).pathname.replace(/\.html?$/, '').replace(/^\//, ''); return p || 'home'; } catch (e) { return ''; } };
  for (const p of ctx.pages || []) {
    if (!p.overview) continue; const m = await meta(p.overview); if (!m) continue;
    const k = m.width / 1920;
    const spots = (p.elements || []).filter((e) => e.rect && e.rect.w > 30 && e.rect.h > 16 && !(e.rect.w >= 1900 && e.rect.h >= 900) && !(e.role === 'nav' && e.rect.h > 300)).map((e) => ({ ...e.rect, role: e.role, text: (e.text || '').slice(0, 60) }));
    (ctx.key_features || []).filter((f) => f.page === p.page && f.rect).forEach((f) => spots.push({ x: f.rect.x, y: f.rect.y + (f.scrollY || 0), w: f.rect.w, h: f.rect.h, role: 'feature', text: (f.text || '').slice(0, 60) }));
    out.push({ group: 'Volledige pagina', file: p.overview, label: `${rel(p.url)} · hele pagina`, w: 1920, h: Math.round(m.height / k), spots });
  }
  for (const s of ctx.stills || []) {
    if (!s.clean) continue; const m = await meta(s.clean); if (!m) continue;
    out.push({ group: 'Schermen', file: s.clean, label: `${rel(s.url)} · ${(s.heading || s.kind || '').slice(0, 40)}`, w: 1920, h: Math.round(m.height / (m.width / 1920)), spots: (s.tags || []).filter((t) => t.rect && t.rect.w > 30).map((t) => ({ ...t.rect, role: t.role, text: (t.text || '').slice(0, 60) })) });
  }
  for (const c of customFiles(outDir)) {
    if (c.video) out.push({ group: 'Eigen beelden', file: c.poster, video: c.norm, label: path.basename(c.file) + ' (video)', w: 1920, h: 1080, spots: [] });
    else { const m = await meta(c.file); if (!m) continue; out.push({ group: 'Eigen beelden', file: c.file, label: path.basename(c.file), w: 1920, h: Math.round(m.height / (m.width / 1920)), spots: [] }); }
  }
  const sdir = path.join(outDir, 'states');
  if (fs.existsSync(sdir)) for (const f of fs.readdirSync(sdir).filter((f) => /_(C-na-klik|B-hover)\.png$/.test(f)).slice(0, 24)) {
    const m = await meta('states/' + f); if (!m || m.width < 1000) continue;
    out.push({ group: 'Na klik of hover', file: 'states/' + f, label: f.replace(/^p\d+-/, '').replace(/\.png$/, '').replace(/_/g, ' '), w: 1920, h: Math.round(m.height / (m.width / 1920)), spots: [] });
  }
  return [...out.filter((x) => x.group === 'Eigen beelden'), ...out.filter((x) => x.group !== 'Eigen beelden')];
}
// ---- automatisch uitknippen: welke losse elementen staan er in dit gebied? ----
// 1) blokken die de tool op de echte pagina heeft gemeten (DOM), 2) beeldanalyse voor wat er niet in zit (eigen beelden, states).
async function autoCut(file, area, opts = {}) {
  const sh = require('sharp');
  const max = opts.max || 6, spots = opts.spots || [];
  const m = await sh(file).metadata(), k = m.width / 1920, H = m.height / k;
  const A = { x: Math.max(0, Math.round(area.x)), y: Math.max(0, Math.round(area.y)), w: Math.round(Math.min(1920 - Math.max(0, area.x), area.w)), h: Math.round(Math.min(H - Math.max(0, area.y), area.h)) };
  if (A.w < 40 || A.h < 40) return [];
  const aA = A.w * A.h;
  const inside = (r) => { const x0 = Math.max(A.x, r.x), y0 = Math.max(A.y, r.y), x1 = Math.min(A.x + A.w, r.x + r.w), y1 = Math.min(A.y + A.h, r.y + r.h); return Math.max(0, x1 - x0) * Math.max(0, y1 - y0) >= r.w * r.h * (opts.purpose === 'row' ? 0.55 : 0.85); };
  const iou = (a, b) => { const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h); const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0); return i / Math.min(a.w * a.h, b.w * b.h); };
  let cands = spots.filter((r) => inside(r) && r.w * r.h > aA * 0.004 && r.w * r.h < aA * 0.8 && r.w > 24 && r.h > 14).map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, src: 'dom' }));
  // beeldanalyse op halve resolutie: vlakken die afwijken van hun omgeving, letters samengevoegd tot blokken
  const sc = Math.min(1, 640 / A.w);
  const W = Math.max(8, Math.round(A.w * sc)), Hh = Math.max(8, Math.round(A.h * sc));
  const ex = { left: Math.round(A.x * k), top: Math.round(A.y * k), width: Math.min(m.width - Math.round(A.x * k), Math.round(A.w * k)), height: Math.min(m.height - Math.round(A.y * k), Math.round(A.h * k)) };
  const img = await sh(file).extract(ex).resize(W, Hh, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const blur = await sh(img, { raw: { width: W, height: Hh, channels: 3 } }).blur(Math.max(3, W / 60)).raw().toBuffer();
  // achtergrondkleur = de meest voorkomende kleur. Is die dominant (gewone pagina), dan is alles wat afwijkt een element;
  // anders (foto) alleen scherpe details zoals tekst en knoppen t.o.v. hun directe omgeving
  const hist = new Map(); for (let i = 0; i < W * Hh; i++) { const q = ((img[i * 3] >> 3) << 10) | ((img[i * 3 + 1] >> 3) << 5) | (img[i * 3 + 2] >> 3); hist.set(q, (hist.get(q) || 0) + 1); }
  let mq = 0, mn = 0; hist.forEach((n, q) => { if (n > mn) { mn = n; mq = q; } });
  const med = [((mq >> 10) & 31) * 8 + 4, ((mq >> 5) & 31) * 8 + 4, (mq & 31) * 8 + 4];
  const near = (i) => Math.abs(img[i * 3] - med[0]) < 14 && Math.abs(img[i * 3 + 1] - med[1]) < 14 && Math.abs(img[i * 3 + 2] - med[2]) < 14;
  const bord = []; for (let x = 0; x < W; x += 2) bord.push(x, x + (Hh - 1) * W); for (let y = 0; y < Hh; y += 2) bord.push(y * W, y * W + W - 1);
  const uniform = mn / (W * Hh) > 0.22 || (mn / (W * Hh) > 0.08 && bord.filter(near).length / bord.length > 0.45);
  const mask = new Uint8Array(W * Hh);
  for (let i = 0; i < W * Hh; i++) {
    let dg = 0, dl = 0;
    for (let c = 0; c < 3; c++) { dg = Math.max(dg, Math.abs(img[i * 3 + c] - med[c])); dl = Math.max(dl, Math.abs(img[i * 3 + c] - blur[i * 3 + c])); }
    mask[i] = (uniform && dg > 22) || (!uniform && dl > 34) ? 1 : 0;
  }
  // lange dunne lijnen (horizon, scheidingslijnen) zijn geen element
  for (let y = 0; y < Hh; y++) { let run = 0; for (let x = 0; x <= W; x++) { if (x < W && mask[y * W + x]) run++; else { if (run > W * 0.3 && !uniform) for (let q = x - run; q < x; q++) for (let dy = -2; dy <= 2; dy++) if (y + dy >= 0 && y + dy < Hh) mask[(y + dy) * W + q] = 0; run = 0; } } }
  // sluiten: letters en regels samen tot één blok
  const R = uniform ? Math.max(1, Math.round(W / 300)) : Math.max(2, Math.round(W / 120));
  const dil = (src, r, val) => { const o = new Uint8Array(src.length); for (let y = 0; y < Hh; y++) { let run = -1e9; for (let x = 0; x < W; x++) { if (src[y * W + x] === val) run = x; o[y * W + x] = x - run <= r ? val : 1 - val; } run = 1e9; for (let x = W - 1; x >= 0; x--) { if (src[y * W + x] === val) run = x; if (run - x <= r) o[y * W + x] = val; } } const o2 = new Uint8Array(src.length); for (let x = 0; x < W; x++) { let run = -1e9; for (let y = 0; y < Hh; y++) { if (o[y * W + x] === val) run = y; o2[y * W + x] = y - run <= r ? val : 1 - val; } run = 1e9; for (let y = Hh - 1; y >= 0; y--) { if (o[y * W + x] === val) run = y; if (run - y <= r) o2[y * W + x] = val; } } return o2; };
  const closed = dil(dil(mask, R, 1), Math.max(1, R - 1), 0);
  const seen = new Uint8Array(W * Hh), boxes = [];
  for (let i = 0; i < W * Hh; i++) {
    if (!closed[i] || seen[i]) continue;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0; const st = [i]; seen[i] = 1;
    while (st.length) { const j = st.pop(), x = j % W, y = (j / W) | 0; n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const q of [j - 1, j + 1, j - W, j + W]) { if (q < 0 || q >= W * Hh || seen[q] || !closed[q]) continue; if ((q === j - 1 && x === 0) || (q === j + 1 && x === W - 1)) continue; seen[q] = 1; st.push(q); } }
    const bw = (x1 - x0 + 1) / sc, bh = (y1 - y0 + 1) / sc;
    if (bw * bh < aA * 0.003 || bw < 20 || bh < 12) continue;
    if (bw * bh > aA * 0.75) continue;
    if (!uniform && bw > A.w * 0.9) continue; // over de hele breedte op een foto: achtergrondstructuur, geen element
    // afgesneden door de rand van het gebied (en daar loopt het beeld nog door): geen heel element
    const by0 = A.y + y0 / sc, by1 = A.y + (y1 + 1) / sc;
    if ((by1 >= A.y + A.h - 4 && A.y + A.h < H - 4) || (by0 <= A.y + 4 && A.y > 4)) continue;
    boxes.push({ x: A.x + x0 / sc - 3, y: A.y + y0 / sc - 3, w: bw + 6, h: bh + 6, src: 'img', fill: n / ((x1 - x0 + 1) * (y1 - y0 + 1)) });
  }
  boxes.forEach((b) => { if (!cands.some((c) => iou(c, b) > 0.35)) cands.push(b); });
  // geneste blokken: het buitenste houden (een kaart in plaats van de losse regels erin), tenzij dat bijna het hele gebied is
  cands = cands.filter((c) => !cands.some((o) => o !== c && o.w * o.h < aA * 0.6 && o.x <= c.x + 2 && o.y <= c.y + 2 && o.x + o.w >= c.x + c.w - 2 && o.y + o.h >= c.y + c.h - 2 && o.w * o.h > c.w * c.h * 1.15));
  // rij-doel (pop-wall, features, kaarten): de grootste reeks gelijksoortige blokken, geen headerknopjes
  if (opts.purpose === 'row') {
    const body = cands.filter((c) => !(c.y < 100 && c.h < 90));
    const sim = (a, b) => Math.abs(a.w - b.w) / Math.max(a.w, b.w) < 0.22 && Math.abs(a.h - b.h) / Math.max(a.h, b.h) < 0.3;
    let best = [];
    body.forEach((a) => { const c = body.filter((b) => sim(a, b) && !(b !== a && iou(a, b) > 0.3)); const sc = c.length * 10 + Math.sqrt(c[0].w * c[0].h) / 100; const bs = best.length ? best.length * 10 + Math.sqrt(best[0].w * best[0].h) / 100 : -1; if (c.length >= 2 && sc > bs) best = c; });
    if (best.length >= 2) cands = best; else cands = body.length ? body : cands;
  } else if (opts.purpose === 'layers') {
    // lagen: geen brede navigatiebalken of vlakken over (bijna) de hele breedte
    cands = cands.filter((c) => !(c.w > A.w * 0.92 && c.h > A.h * 0.5));
  }
  // de grootste/belangrijkste houden, daarna in leesvolgorde
  cands.sort((a, b) => (b.w * b.h * (b.src === 'dom' ? 1.3 : 1)) - (a.w * a.h * (a.src === 'dom' ? 1.3 : 1)));
  const pick = [];
  for (const c of cands) { if (pick.length >= max) break; if (pick.some((p) => iou(p, c) > 0.25)) continue; pick.push(c); }
  pick.sort((a, b) => (Math.abs(a.y - b.y) < 40 ? a.x - b.x : a.y - b.y));
  return pick.map((r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }));
}

async function makeGrab(outDir, source, rects, video) {
  if (video) {
    // eigen video: wordt een bewegend vlak; het kader is waar de camera op inzoomt (video is al 1920x1080)
    const work = path.join(outDir, 'showcase', '_assets');
    const f = path.normalize(path.join(outDir, video)); if (!f.startsWith(outDir) || !fs.existsSync(f)) throw new Error('video niet gevonden');
    const key = require('crypto').createHash('md5').update(video + fs.statSync(f).size).digest('hex').slice(0, 8);
    const src = await prepClip(outDir, work, { clip: 'c' + key, file: video });
    const rs = (rects || []).length ? rects : [{ x: 360, y: 200, w: 1200, h: 680 }];
    return { src, rects: rs.map((r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) })), rings: [], source, video: true };
  }
  const sh = require('sharp');
  const work = path.join(outDir, 'showcase', '_assets');
  const file = path.normalize(path.join(outDir, source));
  if (!file.startsWith(outDir) || !fs.existsSync(file)) throw new Error('bron niet gevonden');
  const m = await sh(file).metadata(), k = m.width / 1920, H = m.height / k;
  rects = (rects || []).map((r) => ({ x: Math.max(0, r.x), y: Math.max(0, r.y), w: Math.max(8, r.w), h: Math.max(8, r.h) }));
  if (!rects.length) rects = [{ x: 0, y: 0, w: 1920, h: Math.min(1080, H) }];
  const U = rects.reduce((a, r) => ({ x0: Math.min(a.x0, r.x), y0: Math.min(a.y0, r.y), x1: Math.max(a.x1, r.x + r.w), y1: Math.max(a.y1, r.y + r.h) }), { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 });
  const uw = U.x1 - U.x0, uh = U.y1 - U.y0;
  // venster 16:9 rond de keuze, met lucht eromheen; nooit kleiner dan halve breedte (anders te ver opgeblazen)
  const mg = Math.max(60, 0.18 * Math.max(uw, uh * 16 / 9));
  let w = Math.min(1920, Math.max(960, uw + 2 * mg, (uh + 2 * mg) * 16 / 9));
  let h = w * 9 / 16;
  if (h > H) { h = H; w = Math.min(1920, h * 16 / 9); }
  let x = Math.max(0, Math.min(1920 - w, (U.x0 + U.x1) / 2 - w / 2)), y = Math.max(0, Math.min(H - h, (U.y0 + U.y1) / 2 - h / 2));
  const s = 1920 / w;
  const key = require('crypto').createHash('md5').update(source + JSON.stringify(rects)).digest('hex').slice(0, 10);
  const sharpF = path.join(work, `grab_${key}.jpg`), blurF = path.join(work, `grab_${key}_b.jpg`);
  const ex = { left: Math.round(x * k), top: Math.round(y * k), width: Math.min(m.width - Math.round(x * k), Math.round(w * k)), height: Math.min(m.height - Math.round(y * k), Math.round(h * k)) };
  await sh(file).extract(ex).resize(3840, 2160, { fit: 'fill' }).removeAlpha().jpeg({ quality: 92 }).toFile(sharpF);
  await sh(sharpF).resize(1280, 720).blur(6).jpeg({ quality: 80 }).toFile(blurF);
  const out = rects.map((r) => ({ x: Math.round((r.x - x) * s), y: Math.round((r.y - y) * s), w: Math.round(r.w * s), h: Math.round(r.h * s) }));
  RAWC.delete(sharpF);
  const rings = []; for (const r of out) rings.push(await ringStats(sharpF, r));
  return { src: { kind: 'still', url: path.basename(sharpF), burl: path.basename(blurF) }, rects: out, rings, source };
}

module.exports = { renderShowcase, renderAudioOnly, prepareAssets, loadParams, framesForShots, listSources, makeGrab, autoCut, addCustom, PAGE };
