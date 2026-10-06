const fs = require('fs');
const path = require('path');
const { preparePage, scrollTo, waitImages } = require('./browser');
const { Recorder, Cursor, wheelScroll } = require('./record');
const { sleep, log, pad, slug, easeInOutCubic, easeOutQuart, ffmpegPath, run, mkdir } = require('./util');

const TYPE_CAP = { 'menu-open': 1, 'hero-cta': 1, 'scroll-tour': 2, 'slider-autoplay': 1 };

function planClips(analyses, cfg) {
  const H = cfg.height;
  const c = [];
  for (const a of analyses) {
    const pg = { page: a.pageNo, url: a.url, path: a.path, scrollMode: a.libraries.lenis || a.libraries.locomotive ? 'wheel' : 'native' };
    // Hero + CTA
    if (a.pageNo === 1) {
      const ctas = a.elements.filter((e) => e.role === 'cta' && e.rect.y + e.rect.h < H * 0.95 && e.rect.y > 40).sort((x, y) => y.importance - x.importance);
      if (ctas[0]) {
        const hv = a.hovers.find((h) => h.target.selector === ctas[0].selector);
        c.push({ ...pg, type: 'hero-cta', label: 'hero-cursor-naar-cta', score: 72 + (hv ? 12 : 0), cursor: true, targets: [ctas[0].selector], scrollY: 0, evidence: hv ? [hv.id] : [], note: `Cursor glijdt naar de hoofd-CTA "${ctas[0].text}"` + (hv ? ' en triggert het echte hover-effect' : '') });
      }
    }
    // Klik-interacties
    const clickScore = { 'menu-open': 92, 'overlay-open': 82, dropdown: 78, slider: 70, search: 58, tab: 62, panel: 56, accordion: 52, menu: 80 };
    for (const k of a.clicks) {
      c.push({ ...pg, type: k.kind, label: slug(k.kind + '-' + (k.target.text || 'klik'), 36), score: (clickScore[k.kind] || 50) + Math.min(15, k.visual_change * 40), cursor: true, targets: [k.target.selector], scrollY: k.scrollY, click: true, measured: k.result_motion, evidence: [k.id], note: `Cursor klikt op "${k.target.text || k.kind}" → ${k.kind}` });
    }
    // Hover
    const cards = a.hovers.filter((h) => h.kind === 'hover-card');
    const rows = {};
    cards.forEach((h) => { const k = Math.round(h.target.rect_page.y / 120); (rows[k] = rows[k] || []).push(h); });
    for (const r of Object.values(rows)) {
      if (r.length >= 2) {
        const pick = r.sort((x, y) => x.target.rect_page.x - y.target.rect_page.x).slice(0, 3);
        c.push({ ...pg, type: 'card-hover-sweep', label: 'cursor-langs-kaarten', score: 76 + Math.min(12, Math.max(...pick.map((p) => p.visual_change)) * 60), cursor: true, targets: pick.map((p) => p.target.selector), scrollY: pick[0].scrollY, evidence: pick.map((p) => p.id), note: `Cursor beweegt langs ${pick.length} kaarten; ieder toont zijn echte hover-effect` });
      } else {
        const h = r[0];
        c.push({ ...pg, type: 'hover-card', label: slug('hover-' + (h.target.text || 'kaart'), 36), score: 58 + Math.min(12, h.visual_change * 60), cursor: true, targets: [h.target.selector], scrollY: h.scrollY, evidence: [h.id], note: 'Hover op kaart' });
      }
    }
    for (const h of a.hovers.filter((h) => h.kind === 'hover-dropdown')) {
      c.push({ ...pg, type: 'hover-dropdown', label: slug('dropdown-' + (h.target.text || 'nav'), 36), score: 80, cursor: true, targets: [h.target.selector], scrollY: h.scrollY, dropdown: h.revealed[0] || null, evidence: [h.id], note: `Hover op "${h.target.text}" opent een dropdown/megamenu` });
    }
    for (const h of a.hovers.filter((h) => h.kind === 'hover-cta' && h.visual_change > 0.002)) {
      c.push({ ...pg, type: 'hover-cta', label: slug('hover-' + (h.target.text || 'knop'), 36), score: 50 + Math.min(10, h.visual_change * 100), cursor: true, targets: [h.target.selector], scrollY: h.scrollY, evidence: [h.id], note: `Hover op knop "${h.target.text}"` });
    }
    // Parallax / sticky
    for (const p of a.parallax) {
      const types = p.elements.flatMap((e) => e.effects.map((x) => x.type));
      const best = types.some((t) => t.startsWith('parallax')) ? 88 : types.includes('scroll-horizontal') ? 84 : types.includes('sticky') ? 78 : types.includes('fixed-background') ? 74 : 60;
      c.push({ ...pg, type: 'parallax-scroll', label: slug('parallax-' + ([...new Set(types)].join('-')), 36), score: best, cursor: false, section: p.section_rect, evidence: p.elements.map((e) => e.selector).slice(0, 4), effects: [...new Set(types)], note: `Scroll door sectie ${p.section} met ${[...new Set(types)].join(', ')}` });
    }
    // Scroll-reveals per sectie
    for (const s of a.sections) {
      const rv = a.reveals.filter((r) => r.rect.y >= s.rect.y - 20 && r.rect.y < s.rect.y + s.rect.h);
      if (rv.length >= 2 && !s.footer) {
        c.push({ ...pg, type: 'scroll-reveal', label: slug('reveal-' + (s.heading || s.kind), 36), score: 60 + Math.min(12, rv.length * 2) + (s.score > 40 ? 6 : 0), cursor: false, section: s.rect, evidence: rv.slice(0, 6).map((r) => r.selector), reveals: rv.length, note: `${rv.length} elementen komen in beeld met hun eigen reveal-animatie (${[...new Set(rv.map((r) => r.lib).filter(Boolean))].join(', ') || 'CSS/JS'})` });
      }
    }
    // Autoplay sliders
    for (const s of a.sliders.filter((s) => s.autoplay)) {
      c.push({ ...pg, type: 'slider-autoplay', label: 'slider-autoplay', score: 64, cursor: false, scrollY: s.scrollY, slider: s, evidence: [s.selector], note: 'Slider/carousel die zelf doorloopt' });
    }
    c.push({ ...pg, type: 'scroll-tour', label: slug('scroll-' + (a.pageNo === 1 ? 'home' : a.path), 30), score: a.pageNo === 1 ? 42 : 34, cursor: false, scrollY: 0, docHeight: a.docHeight, note: 'Vloeiende scroll vanaf de top (referentie voor ritme en opbouw van de pagina)' });
  }
  c.sort((x, y) => y.score - x.score);
  const out = [];
  const count = {};
  const seenTargets = new Set();
  // Pas 1: van ieder type eerst de beste (variatie), pas 2: aanvullen tot de caps
  for (const pass of [1, 2]) {
    for (const k of c) {
      if (out.length >= cfg.clips) break;
      if (out.includes(k)) continue;
      const cap = pass === 1 ? 1 : TYPE_CAP[k.type] ?? 2;
      if ((count[k.type] || 0) >= cap) continue;
      const tk = k.url + '|' + (k.targets || [k.label]).join(',');
      if (seenTargets.has(tk)) continue;
      // zelfde interactie op een andere pagina (template) is dubbel
      const same = out.find((o) => o.type === k.type && o.page !== k.page && (o.note === k.note));
      if (same) continue;
      seenTargets.add(tk);
      count[k.type] = (count[k.type] || 0) + 1;
      out.push(k);
    }
  }
  return out.sort((x, y) => y.score - x.score);
}

// Tijd in de pagina K keer langzamer laten lopen (JS-timers, rAF, performance.now, Date, video).
// We nemen K keer langzamer op en versnellen de video daarna K keer: effectief K x zoveel frames.
function timewarpInit(K) {
  const rNow = performance.now.bind(performance);
  const rDate = Date.now;
  const p0 = rNow(), d0 = rDate();
  performance.now = () => p0 + (rNow() - p0) / K;
  Date.now = () => Math.round(d0 + (rDate() - d0) / K);
  const RD = Date;
  // eslint-disable-next-line no-global-assign
  Date = class extends RD { constructor(...a) { if (a.length) super(...a); else super(Date.now()); } static now() { return Math.round(d0 + (rDate() - d0) / K); } };
  const rRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => rRaf((t) => cb(p0 + (t - p0) / K));
  const rST = window.setTimeout.bind(window), rSI = window.setInterval.bind(window);
  window.setTimeout = (fn, d, ...a) => rST(fn, (d || 0) * K, ...a);
  window.setInterval = (fn, d, ...a) => rSI(fn, (d || 0) * K, ...a);
  const fixVideos = () => document.querySelectorAll('video').forEach((v) => { if (v.playbackRate !== 1 / K) v.playbackRate = 1 / K; });
  document.addEventListener('DOMContentLoaded', () => { fixVideos(); rSI(fixVideos, 500); });
}

async function slowAnimations(page, K) {
  const s = await page.context().newCDPSession(page);
  await s.send('Animation.enable').catch(() => {});
  await s.send('Animation.setPlaybackRate', { playbackRate: 1 / K }).catch(() => {});
}

async function vrectOf(page, sel) {
  return page.evaluate((s) => { const e = window.__wmc.q(s); return e && window.__wmc.visible(e) ? window.__wmc.vrect(e) : null; }, sel).catch(() => null);
}
const center = (r, H) => [Math.round(r.x + r.w / 2), Math.round(Math.min(r.y + r.h / 2, H - 20))];

async function choreograph(page, cfg, clip, rec, cur) {
  const H = cfg.height, Wd = cfg.width;
  const K = cfg.timewarp || 1;
  const ws = (ms) => sleep(ms * K);
  switch (clip.type) {
    case 'hero-cta': {
      const r = await vrectOf(page, clip.targets[0]);
      if (!r) throw new Error('CTA niet gevonden');
      await ws(550); rec.mark('start: hero in rust');
      const [x, y] = center(r, H);
      rec.mark('cursor komt binnen');
      await cur.moveTo(x, y, 1150);
      rec.mark('hover op CTA', { target: clip.targets[0] });
      await ws(1500);
      await cur.moveTo(Math.min(Wd - 60, x + 190), Math.min(H - 40, y + 110), 750);
      rec.mark('cursor glijdt weg');
      await ws(500);
      return;
    }
    case 'hover-dropdown':
    case 'hover-cta':
    case 'hover-card': {
      const r = await vrectOf(page, clip.targets[0]);
      if (!r) throw new Error('doel niet gevonden');
      await ws(450); rec.mark('start');
      const [x, y] = center(r, H);
      await cur.moveTo(x, y, 1000);
      rec.mark('hover', { target: clip.targets[0] });
      await ws(clip.type === 'hover-dropdown' ? 1100 : 1500);
      if (clip.type === 'hover-dropdown' && clip.dropdown && clip.dropdown.rect) {
        const d = clip.dropdown.rect;
        await cur.moveTo(Math.round(d.x + Math.min(d.w / 2, 180)), Math.round(d.y + Math.min(d.h / 2, 120)), 700);
        rec.mark('cursor in dropdown');
        await ws(900);
      } else {
        await ws(300);
      }
      return;
    }
    case 'card-hover-sweep': {
      await ws(400); rec.mark('start');
      let first = true;
      for (const sel of clip.targets) {
        const r = await vrectOf(page, sel);
        if (!r) continue;
        const [x, y] = center(r, H);
        await cur.moveTo(x, y, first ? 900 : 620, { arc: first ? 0.12 : 0.05 });
        rec.mark('hover kaart', { target: sel });
        await ws(850);
        first = false;
      }
      await ws(250);
      return;
    }
    case 'parallax-scroll': {
      await ws(350); rec.mark('start scroll');
      const dist = Math.round(Math.min(clip.section.h + H * 0.55, H * 1.7));
      await wheelScroll(page, cfg, dist, 3900 * K, easeInOutCubic, clip.scrollMode);
      rec.mark('einde scroll', { distance_px: dist });
      await ws(600);
      return;
    }
    case 'scroll-reveal': {
      await ws(400); rec.mark('start: sectie net onder beeld');
      await wheelScroll(page, cfg, Math.round(H * 0.75), 1500 * K, easeOutQuart, clip.scrollMode);
      rec.mark('sectie in beeld, reveals spelen af');
      await ws(2300);
      return;
    }
    case 'slider-autoplay': {
      rec.mark('start');
      const first = clip.slider.autoplay_first_change_ms || 2000;
      await ws(Math.max(4300, Math.min(6500, first + 3200)));
      rec.mark('einde');
      return;
    }
    case 'scroll-tour': {
      await ws(500); rec.mark('start top');
      const dist = Math.round(Math.min((clip.docHeight || H * 3) - H, H * 2.6));
      await wheelScroll(page, cfg, dist, 5200 * K, easeInOutCubic, clip.scrollMode);
      rec.mark('einde scroll', { distance_px: dist });
      await ws(400);
      return;
    }
    default: {
      // klik-interacties: menu-open, dropdown, overlay-open, slider, tab, accordion, search, panel
      const r = await vrectOf(page, clip.targets[0]);
      if (!r) throw new Error('klikdoel niet gevonden');
      await ws(450); rec.mark('start');
      const [x, y] = center(r, H);
      await cur.moveTo(x, y, 1000);
      rec.mark('hover op doel', { target: clip.targets[0] });
      await ws(400);
      // welke links zijn klikbaar zichtbaar voor de klik? (om na afloop het geopende menu te vinden)
      const LINKS = () => page.evaluate(() => {
        const out = [];
        document.querySelectorAll('a,button,[role=menuitem]').forEach((el, i) => {
          const r = el.getBoundingClientRect();
          if (r.width < 8 || r.height < 8 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return;
          const h = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)));
          if (!h || !(h === el || el.contains(h))) return;
          if (!el.dataset.wmcId) el.dataset.wmcId = 'l' + (window.__wmcN = (window.__wmcN || 0) + 1);
          out.push({ id: el.dataset.wmcId, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), text: (el.innerText || '').trim().slice(0, 30) });
        });
        return out;
      }).catch(() => []);
      const before = await LINKS();
      await cur.click();
      rec.mark('klik');
      const m = (clip.measured || [])[0];
      const decl = m && m.declared && m.declared.transition ? m.declared.transition.duration_ms : 0;
      const hold = Math.max(2300, Math.min(3300, Math.max((m && m.measured_duration_ms) || 600, decl) + 1600));
      if (clip.type === 'slider') {
        await ws(1300);
        await cur.click();
        rec.mark('tweede klik');
        await ws(1500);
      } else {
        await ws(hold);
      }
      const seen = new Set(before.map((l) => l.id));
      const fresh = (await LINKS()).filter((l) => !seen.has(l.id));
      rec.mark('einde', fresh.length ? { new_links: fresh.slice(0, 12) } : {});
    }
  }
}

async function positionFor(page, cfg, clip) {
  const H = cfg.height;
  if (clip.type === 'parallax-scroll') return Math.max(0, Math.round(clip.section.y - H * 0.8));
  if (clip.type === 'scroll-reveal') return Math.max(0, Math.round(clip.section.y - H + 40));
  return clip.scrollY || 0;
}

async function contactSheet(page, cfg, file, clip, info, outPng) {
  const tmp = outPng + '_frames';
  mkdir(tmp);
  const n = 6;
  const imgs = [];
  for (let i = 0; i < n; i++) {
    const t = Math.max(0.05, (info.duration - 0.1) * (i / (n - 1)));
    const f = path.join(tmp, `f${i}.jpg`);
    await run(ffmpegPath(), ['-y', '-ss', t.toFixed(2), '-i', file, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '3', f]).catch(() => {});
    if (fs.existsSync(f)) imgs.push({ t: t.toFixed(1), data: fs.readFileSync(f).toString('base64') });
  }
  const html = `<html><body style="margin:0;background:#141414;color:#eee;font:14px -apple-system,Helvetica,Arial,sans-serif;padding:18px;width:1990px">
  <div style="font-size:22px;font-weight:700;margin-bottom:4px">${clip.fileBase}</div>
  <div style="opacity:.75;margin-bottom:14px">${clip.note.replace(/</g, '&lt;')} · ${info.duration}s · pagina ${clip.page} ${clip.path}</div>
  <div style="display:grid;grid-template-columns:repeat(3,640px);gap:14px">${imgs.map((i) => `<div><img src="data:image/jpeg;base64,${i.data}" style="width:640px;display:block;border-radius:4px"><div style="margin-top:5px;opacity:.8">t = ${i.t}s</div></div>`).join('')}</div>
  <div style="margin-top:14px;opacity:.85">${clip.timeline.map((e) => `<b>${e.t.toFixed(2)}s</b> ${e.event}`).join(' &nbsp;·&nbsp; ')}</div></body></html>`;
  const sp = await page.context().newPage();
  await sp.setViewportSize({ width: 2026, height: 400 });
  await sp.setContent(html);
  await sp.screenshot({ path: outPng, fullPage: true });
  await sp.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

async function recordOne(context, cfg, clip, n, dirs, K) {
  const page = await context.newPage();
  const ccfg = { ...cfg, timewarp: K };
  if (K > 1) await page.addInitScript(timewarpInit, K);
  try {
    await preparePage(page, clip.url, cfg, { settle: 600 });
    const y = await positionFor(page, cfg, clip);
    await scrollTo(page, y);
    await sleep(clip.type === 'scroll-reveal' ? 500 : 700);
    await waitImages(page, 3000);
    await page.mouse.move(cfg.width - 2, cfg.height - 2).catch(() => {});
    await sleep(clip.type === 'scroll-reveal' ? 300 : 900);
    const cur = new Cursor(page, { ...ccfg, cursor: cfg.cursor && clip.cursor });
    if (clip.cursor) await cur.install(cfg.width + 40, Math.round(cfg.height * 0.82));
    const rec = new Recorder(page, cfg);
    if (K > 1) await slowAnimations(page, K);
    cur.rec = rec;
    await rec.start();
    await choreograph(page, ccfg, clip, rec, cur);
    await rec.stop();
    const trim = 0.15;
    rec.timeline.forEach((e) => (e.t = +(e.t / K).toFixed(2)));
    const timeline = rec.timeline.map((e) => ({ ...e, t: Math.max(0, +(e.t - trim).toFixed(2)) }));
    // cursorpad (viewport-px, clip-tijd), uitgedund naar ~25 punten per seconde
    const cursorPath = [];
    rec.cursor.forEach((c) => { const t = +(c.t / K - trim).toFixed(3); if (t >= 0 && (!cursorPath.length || t - cursorPath[cursorPath.length - 1].t >= 0.04)) cursorPath.push({ t, x: c.x, y: c.y }); });
    const fileBase = `clip${pad(n)}_p${clip.page}_${clip.label}`;
    const file = path.join(dirs.clips, fileBase + '.mp4');
    const info = await rec.encode(file, { trimStart: trim, timewarp: K });
    return { page, timeline, fileBase, file, info, y, cursorPath };
  } catch (e) {
    await page.close().catch(() => {});
    throw e;
  }
}

async function recordClips(context, cfg, plan, dirs) {
  const done = [];
  let n = 0;
  const minFps = cfg.minClipFps || 24;
  for (const clip of plan) {
    n++;
    let K = (['parallax-scroll', 'scroll-reveal', 'scroll-tour'].includes(clip.type) ? cfg.timewarpScroll : cfg.timewarp) || 1;
    try {
      log(`  clip ${n}/${plan.length}: ${clip.type} (${clip.path})`);
      let r = await recordOne(context, cfg, clip, n, dirs, K);
      // Te weinig echte frames? Automatisch opnieuw met sterkere vertraging.
      while (r.info.fps_source < minFps && K < (cfg.maxTimewarp || 16)) {
        const next = Math.min(cfg.maxTimewarp || 16, Math.ceil(K * (minFps / Math.max(1, r.info.fps_source)) * 1.25));
        log(`    ${r.info.fps_source} fps, opnieuw met timewarp ${next}...`);
        await r.page.close().catch(() => {});
        K = next;
        r = await recordOne(context, cfg, clip, n, dirs, K);
      }
      if (r.info.fps_source < minFps) log(`    let op: ${r.info.fps_source} fps haalbaar op deze computer`);
      const { page, timeline, fileBase, file, info, y, cursorPath } = r;
      clip.cursorPath = cursorPath;
      clip.timeline = timeline;
      clip.no = n;
      clip.fileBase = fileBase;
      clip.file = file;
      clip.duration = info.duration;
      clip.source_fps = info.fps_source;
      clip.timewarp = K;
      clip.scrollStart = y;
      const sheet = path.join(dirs.clips, clip.fileBase + '_frames.png');
      await contactSheet(page, cfg, file, clip, info, sheet).catch((e) => log('  ! contactsheet: ' + e.message));
      clip.sheet = sheet;
      fs.writeFileSync(path.join(dirs.clips, clip.fileBase + '.json'), JSON.stringify(clipPublic(clip), null, 2));
      done.push(clip);
      await page.close().catch(() => {});
    } catch (e) {
      log(`  ! clip overgeslagen (${clip.type}): ${e.message.split('\n')[0]}`);
      n--;
    }
  }
  return done;
}

function clipPublic(c) {
  return { clip: c.no, file: path.basename(c.file || ''), type: c.type, targets: c.targets, page: c.page, url: c.url, duration_s: c.duration, cursor_visible: !!c.cursor, what_happens: c.note, timeline: c.timeline, cursor_path: c.cursorPath, viewport: c.viewport, tap: c.tap, evidence: c.evidence, effects: c.effects, measured_motion: c.measured, source_fps: c.source_fps, scroll_start_px: c.scrollStart };
}

// Kortere versie voor Seedance: rondom het kernmoment, max N seconden
async function trimForSeedance(clip, maxDur, outFile) {
  let start = 0;
  const key = clip.timeline.find((e) => /klik|hover|in beeld/.test(e.event));
  if (clip.duration > maxDur && key) start = Math.max(0, Math.min(clip.duration - maxDur, key.t - maxDur * 0.45));
  const dur = Math.min(maxDur, clip.duration - start);
  await run(ffmpegPath(), ['-y', '-ss', start.toFixed(2), '-i', clip.file, '-t', dur.toFixed(2), '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', outFile]);
  return { start: +start.toFixed(2), duration: +dur.toFixed(2) };
}

module.exports = { planClips, recordClips, trimForSeedance, clipPublic, timewarpInit, slowAnimations, contactSheet };
