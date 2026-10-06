const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { preparePage, ensureHelpers, scrollTo, waitImages } = require('./browser');
const { sleep, log, mkdir } = require('./util');

const HIGH_VALUE = /product|producten|collectie|assortiment|categorie|category|shop|winkel|vloer|inspiratie|inspiration|project|projecten|portfolio|cases|werk|referenties|diensten|services|oplossingen|over-ons|about|showroom|aanbod|modellen|keuken|interieur/i;
const LOW_VALUE = /contact|privacy|cookie|voorwaarden|terms|disclaimer|login|inloggen|account|cart|winkelwagen|checkout|vacature|jobs|sitemap|faq|klantenservice|retour|verzend|blog\/page|tag\/|author\/|wp-admin|feed|\?/i;

function pngDiff(a, b) {
  try {
    const A = PNG.sync.read(a), B = PNG.sync.read(b);
    if (A.width !== B.width || A.height !== B.height) return 1;
    let changed = 0, total = 0;
    const step = 6;
    for (let y = 0; y < A.height; y += step) {
      for (let x = 0; x < A.width; x += step) {
        const i = (y * A.width + x) * 4;
        const d = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]);
        if (d > 40) changed++;
        total++;
      }
    }
    return changed / total;
  } catch (e) {
    return 0;
  }
}

async function pickPages(page, startUrl, max) {
  const links = await page.evaluate(() => window.__wmc.links()).catch(() => []);
  const scored = links
    .map((l) => {
      const p = new URL(l.url).pathname;
      let s = 0;
      if (l.nav) s += 20;
      if (l.img) s += 8;
      s += Math.min(10, l.count * 2);
      if (HIGH_VALUE.test(p + ' ' + l.text)) s += 25;
      if (LOW_VALUE.test(l.url + ' ' + l.text)) s -= 60;
      const depth = p.split('/').filter(Boolean).length;
      if (depth === 0) s -= 50;
      if (depth > 3) s -= 10;
      return { ...l, path: p, depth, score: s };
    })
    .filter((l) => l.score > 0)
    .sort((a, b) => b.score - a.score);
  // variatie: maximaal 1 pagina per eerste padsegment + 1 diepere (detail)pagina
  const out = [];
  const firstSeg = new Set();
  for (const l of scored) {
    const seg = l.path.split('/').filter(Boolean)[0] || '';
    if (firstSeg.has(seg) && !(l.depth >= 2 && !out.some((o) => o.depth >= 2))) continue;
    firstSeg.add(seg);
    out.push(l);
    if (out.length >= max) break;
  }
  return out;
}

// Scrolt de hele pagina door: laadt lazy content en meet scroll-reveals
async function scrollPass(page, cfg) {
  await page.evaluate(() => window.__wmc.revealInit());
  const reveals = [];
  const H = cfg.height;
  let y = 0;
  let docH = await page.evaluate(() => document.documentElement.scrollHeight);
  let steps = 0;
  while (y < docH - H && steps < 45) {
    y += Math.round(H * 0.7);
    await scrollTo(page, y);
    await sleep(320);
    reveals.push(...(await page.evaluate(() => window.__wmc.revealCheck(false)).catch(() => [])));
    docH = await page.evaluate(() => document.documentElement.scrollHeight);
    steps++;
  }
  await sleep(1200);
  reveals.push(...(await page.evaluate(() => window.__wmc.revealCheck(true)).catch(() => [])));
  await scrollTo(page, 0);
  await sleep(600);
  return reveals;
}

async function measureParallax(page, cfg, sec) {
  const n = await page.evaluate((s) => window.__wmc.parallaxTargets(s), sec.selector);
  if (!n) return [];
  const H = cfg.height;
  const maxY = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  const top = sec.rect.y;
  const positions = [top - H * 0.9, top - H * 0.6, top - H * 0.3, top, top + Math.min(sec.rect.h * 0.4, H * 0.3)]
    .map((v) => Math.round(Math.max(0, Math.min(maxY, v))))
    .filter((v, i, a) => a.indexOf(v) === i);
  if (positions.length < 3) return [];
  const samples = [];
  for (const p of positions) {
    await scrollTo(page, p);
    await sleep(380);
    samples.push(await page.evaluate(() => window.__wmc.parallaxSample()));
  }
  const res = [];
  for (const id of Object.keys(samples[0].o)) {
    const ratios = [], xs = [], ops = [], trs = new Set(), bps = new Set();
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i];
      const ds = b.sy - a.sy;
      if (!a.o[id] || !b.o[id] || Math.abs(ds) < 20) continue;
      const dy = b.o[id].y - a.o[id].y;
      ratios.push(-dy / ds);
      xs.push(b.o[id].x - a.o[id].x);
      ops.push(b.o[id].o - a.o[id].o);
    }
    samples.forEach((s) => { if (s.o[id]) { trs.add(s.o[id].t); bps.add(s.o[id].bp); } });
    if (!ratios.length) continue;
    const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const pos = samples[0].o[id].pos;
    const ba = samples[0].o[id].ba;
    const effects = [];
    if (ba === 'fixed') effects.push({ type: 'fixed-background', note: 'background-attachment: fixed (achtergrond blijft staan, content schuift eroverheen)' });
    if (pos !== 'fixed' && Math.abs(avg - 1) > 0.1 && ratios.every((r) => Math.sign(r - 1) === Math.sign(avg - 1) || Math.abs(r - 1) < 0.05)) {
      effects.push({ type: avg < 1 ? 'parallax-slower' : 'parallax-faster', speed_factor: +avg.toFixed(2), note: `beweegt met ${Math.round(avg * 100)}% van de scrollsnelheid` });
    }
    if (pos === 'sticky' || ratios.some((r) => Math.abs(r) < 0.08)) effects.push({ type: 'sticky', note: 'blijft (tijdelijk) staan tijdens scrollen' });
    const xMove = xs.reduce((a, b) => a + Math.abs(b), 0);
    if (xMove > 25) effects.push({ type: 'scroll-horizontal', px: Math.round(xMove), note: 'beweegt horizontaal bij verticaal scrollen' });
    if (trs.size > 2 && !effects.some((e) => e.type.startsWith('parallax'))) effects.push({ type: 'scroll-linked-transform', note: 'transform verandert mee met scrollpositie', values: [...trs].slice(0, 3) });
    if (bps.size > 2) effects.push({ type: 'background-position-parallax', note: 'background-position verandert met scroll' });
    const opd = ops.reduce((a, b) => a + b, 0);
    if (Math.abs(opd) > 0.3) effects.push({ type: 'scroll-linked-opacity', delta: +opd.toFixed(2) });
    if (effects.length) {
      const d = await page.evaluate((i) => window.__wmc.pxDescribe(i), id);
      if (d) res.push({ ...d, effects, samples: ratios.map((r) => +r.toFixed(2)) });
    }
  }
  return res;
}

async function probeHovers(page, cfg, pageNo, dirs) {
  const cands = await page.evaluate(() => window.__wmc.hoverCandidates());
  const results = [];
  const H = cfg.height, Wd = cfg.width;
  const seenGroups = {};
  const list = cands
    .sort((a, b) => (a.role === 'cta' ? -1 : 0) - (b.role === 'cta' ? -1 : 0) || a.rect.y - b.rect.y)
    .filter((c) => { const k = c.role + ':' + c.rect.w + 'x' + c.rect.h; seenGroups[k] = (seenGroups[k] || 0) + 1; return seenGroups[k] <= 3; })
    .slice(0, cfg.maxHoverProbes);
  let n = 0;
  for (const c of list) {
    const hh = await page.evaluate(() => window.__wmc.headerHeight());
    const y = Math.max(0, c.rect.y - Math.max(hh, (H - c.rect.h) / 2));
    await scrollTo(page, y);
    await page.mouse.move(Wd - 2, H - 2).catch(() => {});
    await sleep(280);
    const vr = await page.evaluate((s) => { const e = window.__wmc.q(s); return e ? window.__wmc.vrect(e) : null; }, c.selector);
    if (!vr || vr.y < 0 || vr.y + Math.min(vr.h, 60) > H) continue;
    const before = await page.evaluate((s) => window.__wmc.deepSnap(window.__wmc.q(s)), c.selector).catch(() => null);
    if (!before) continue;
    const poolN = await page.evaluate((s) => window.__wmc.revealPool(s), c.selector);
    const pool0 = await page.evaluate(() => window.__wmc.poolState());
    const shotA = await page.screenshot({ type: 'png' });
    const cx = vr.x + Math.min(vr.w / 2, vr.w - 4), cy = vr.y + Math.min(vr.h / 2, H - vr.y - 4);
    await page.mouse.move(cx, cy, { steps: 6 });
    const wait = Math.min(1300, Math.max(450, ((c.motion && c.motion.transition && c.motion.transition.duration_ms) || 300) + 200));
    await sleep(wait);
    const after = await page.evaluate((s) => { const e = window.__wmc.q(s); return e ? window.__wmc.deepSnap(e) : null; }, c.selector).catch(() => null);
    if (!after) continue;
    const changes = await page.evaluate(([a, b]) => window.__wmc.diffSnap(a, b), [before, after]);
    const pool1 = await page.evaluate(() => window.__wmc.poolState());
    const revealed = [];
    for (const k of Object.keys(pool1)) {
      if (pool0[k] && !pool0[k].v && pool1[k].v && pool1[k].w * pool1[k].h > 8000) revealed.push(k);
    }
    const url0 = page.url();
    if (!changes.length && !revealed.length) continue;
    await page.evaluate(([x, y]) => { window.__wmc.cursorInstall(); window.__wmc.cursorTo(x, y); }, [cx, cy]);
    const shotB = await page.screenshot({ type: 'png' });
    await page.evaluate(() => window.__wmc.cursorHide());
    const diff = pngDiff(shotA, shotB);
    const revInfo = revealed.length ? await page.evaluate((ids) => ids.map((i) => { const e = document.querySelector('[data-wmc-pool="' + i + '"]'); return e ? { selector: window.__wmc.path(e), cls: window.__wmc.cls(e).slice(0, 60), rect: window.__wmc.vrect(e), declared: window.__wmc.motionDecl(e) } : null; }).filter(Boolean), revealed.slice(0, 3)) : [];
    n++;
    const id = `p${pageNo}-h${String(n).padStart(2, '0')}`;
    const kind = revInfo.length ? 'hover-dropdown' : c.role === 'card' ? 'hover-card' : c.role === 'cta' ? 'hover-cta' : c.role === 'nav-link' ? 'hover-nav' : 'hover';
    const fA = path.join(dirs.states, `${id}_${kind}_A-voor.png`);
    const fB = path.join(dirs.states, `${id}_${kind}_B-hover.png`);
    fs.writeFileSync(fA, shotA);
    fs.writeFileSync(fB, shotB);
    results.push({
      id, type: 'hover', kind, target: { selector: c.selector, role: c.role, text: c.text, rect_page: c.rect, rect_view: vr },
      scrollY: y, changes: changes.slice(0, 12), revealed: revInfo, declared: c.motion, visual_change: +diff.toFixed(3), verified: true, stills: [fA, fB], url: url0,
    });
    await page.mouse.move(Wd - 2, H - 2).catch(() => {});
    await sleep(250);
  }
  return results;
}

async function probeClicks(page, cfg, pageUrl, pageNo, dirs) {
  await scrollTo(page, 0);
  const cands = (await page.evaluate(() => window.__wmc.clickCandidates())).slice(0, cfg.maxClickProbes);
  const results = [];
  const H = cfg.height, Wd = cfg.width;
  let n = 0;
  for (const c of cands) {
    await preparePage(page, pageUrl, cfg, { settle: 500 });
    const hh = await page.evaluate(() => window.__wmc.headerHeight());
    const y = c.rect.y < H * 0.6 ? 0 : Math.max(0, c.rect.y - Math.max(hh + 40, H * 0.35));
    await scrollTo(page, y);
    await sleep(350);
    const vr = await page.evaluate((s) => { const e = window.__wmc.q(s); return e && window.__wmc.visible(e) ? window.__wmc.vrect(e) : null; }, c.selector);
    if (!vr || vr.y < 0 || vr.y + 10 > H) continue;
    await page.evaluate((s) => window.__wmc.revealPool(s), c.selector);
    await page.mouse.move(Wd - 2, H - 2).catch(() => {});
    await sleep(200);
    const shotA = await page.screenshot({ type: 'png' });
    const cx = vr.x + vr.w / 2, cy = vr.y + vr.h / 2;
    await page.mouse.move(cx, cy, { steps: 6 });
    await sleep(350);
    const url0 = page.url();
    let popup = null;
    const onPopup = (p) => { popup = p; };
    page.context().once('page', onPopup);
    await page.evaluate(() => window.__wmc.startTrack());
    await page.mouse.down();
    await sleep(80);
    await page.mouse.up();
    await sleep(1500);
    const url1 = page.url();
    page.context().off('page', onPopup);
    if (popup) await popup.close().catch(() => {});
    if (url1.split('#')[0] !== url0.split('#')[0]) {
      continue; // navigeerde weg: niet bruikbaar als state-interactie
    }
    await ensureHelpers(page);
    const motion = await page.evaluate(() => (window.__wmc.stopTrack ? window.__wmc.stopTrack() : [])).catch(() => []);
    await page.evaluate(([x, y]) => { window.__wmc.cursorInstall(); window.__wmc.cursorTo(x, y); }, [cx, cy]).catch(() => {});
    const shotC = await page.screenshot({ type: 'png' });
    await page.evaluate(() => window.__wmc.cursorHide()).catch(() => {});
    const diff = pngDiff(shotA, shotC);
    if (diff < 0.01 && !motion.length) continue;
    n++;
    let kind = c.kind;
    const big = motion[0];
    if (big && big.area_after > Wd * H * 0.45 && (big.visible[1] || big.opacity[1] > 0.5)) kind = c.kind === 'menu' || c.kind === 'dropdown' ? 'menu-open' : c.kind === 'slider' ? 'slider' : 'overlay-open';
    else if (c.kind === 'menu') kind = 'menu-open';
    const id = `p${pageNo}-c${String(n).padStart(2, '0')}`;
    const fA = path.join(dirs.states, `${id}_${kind}_A-voor.png`);
    const fC = path.join(dirs.states, `${id}_${kind}_C-na-klik.png`);
    fs.writeFileSync(fA, shotA);
    fs.writeFileSync(fC, shotC);
    results.push({
      id, type: 'click', kind, target: { selector: c.selector, text: c.text, rect_page: c.rect, rect_view: vr },
      scrollY: y, result_motion: motion, visual_change: +diff.toFixed(3), verified: true, stills: [fA, fC], url: url0,
    });
  }
  return results;
}

async function probeSliders(page, cfg) {
  const sl = await page.evaluate(() => window.__wmc.sliders());
  const out = [];
  for (const s of sl) {
    const H = cfg.height;
    const y = Math.max(0, s.rect.y - (H - s.rect.h) / 2);
    await scrollTo(page, y);
    await sleep(300);
    const states = new Set();
    const t0 = Date.now();
    let firstChange = null;
    while (Date.now() - t0 < cfg.autoplayWatchMs) {
      const st = await page.evaluate((sel) => window.__wmc.trackState(sel), s.track || s.selector);
      if (st && states.size && !states.has(st) && firstChange === null) firstChange = Date.now() - t0;
      states.add(st);
      await sleep(150);
    }
    out.push({ ...s, scrollY: Math.round(y), autoplay: states.size > 2, autoplay_first_change_ms: firstChange, states_seen: states.size });
  }
  return out;
}

async function analyzePage(page, cfg, pageUrl, pageNo, dirs) {
  log(`\n[pagina ${pageNo}] ${pageUrl}`);
  await preparePage(page, pageUrl, cfg);
  const title = await page.title().catch(() => '');
  log('  scrollen, lazy-load en scroll-reveals meten...');
  const reveals = await scrollPass(page, cfg);
  await waitImages(page);
  const header = await page.evaluate(() => window.__wmc.headerHeight());
  const sectionsRaw = await page.evaluate(() => window.__wmc.sections().map((s) => window.__wmc.sectionInfo(s)));
  const sections = sectionsRaw.map((s, i) => ({ ...s, index: i + 1 }));
  const elements = await page.evaluate(() => window.__wmc.collectElements().map((e) => ({ selector: window.__wmc.path(e.el), role: e.role, rect: e.rect, text: e.text, motion: e.motion, importance: e.importance })));
  const keyframes = await page.evaluate(() => {
    const k = [];
    for (const sh of document.styleSheets) { try { for (const r of sh.cssRules) if (r.type === 7) k.push(r.name); } catch (e) {} }
    return [...new Set(k)].slice(0, 40);
  });
  const running = await page.evaluate(() => { try { return document.getAnimations().slice(0, 40).map((a) => { const t = a.effect.getTiming(); return { name: a.animationName || a.transitionProperty || a.constructor.name, target: a.effect.target ? window.__wmc.path(a.effect.target) : null, duration: t.duration, iterations: t.iterations, easing: t.easing }; }); } catch (e) { return []; } });
  const libs = await page.evaluate(() => ({
    gsap: !!window.gsap, scrollTrigger: !!(window.ScrollTrigger || (window.gsap && window.gsap.plugins && window.gsap.plugins.scrollTrigger)), lenis: !!(window.Lenis || document.documentElement.classList.contains('lenis')),
    swiper: !!window.Swiper || !!document.querySelector('.swiper'), aos: !!window.AOS || !!document.querySelector('[data-aos]'), locomotive: !!document.querySelector('[data-scroll-container]'),
    framer: !!document.querySelector('[data-framer-name],[data-framer-component-type]'), webflow: !!document.querySelector('html[data-wf-page]'), elementor: !!document.querySelector('.elementor'), lottie: !!document.querySelector('lottie-player,dotlottie-player,[class*=lottie]'), threejs: !!window.THREE, video_bg: !!document.querySelector('video[autoplay]'),
  }));

  log(`  ${sections.length} secties, ${elements.length} elementen, ${reveals.length} scroll-reveals`);
  log('  parallax/sticky meten...');
  const parallax = [];
  const pxSecs = sections.filter((s) => !s.footer).sort((a, b) => b.score - a.score).slice(0, cfg.maxParallaxSections);
  for (const s of pxSecs) {
    const r = await measureParallax(page, cfg, s).catch(() => []);
    if (r.length) parallax.push({ section: s.index, section_selector: s.selector, section_rect: s.rect, elements: r });
  }
  await scrollTo(page, 0);
  log(`  ${parallax.length} secties met scroll-gekoppelde beweging`);
  log('  sliders/carousels volgen...');
  const sliders = await probeSliders(page, cfg).catch(() => []);
  log('  hover-effecten testen...');
  await scrollTo(page, 0);
  const hovers = await probeHovers(page, cfg, pageNo, dirs).catch((e) => { log('  ! hover-probe: ' + e.message); return []; });
  log(`  ${hovers.length} hover-effecten bevestigd`);
  log('  klik-interacties testen (menu, tabs, accordions, slider-pijlen)...');
  const clicks = await probeClicks(page, cfg, pageUrl, pageNo, dirs).catch((e) => { log('  ! klik-probe: ' + e.message); return []; });
  log(`  ${clicks.length} klik-interacties bevestigd`);

  // volledige pagina-overzicht (verkleind)
  await preparePage(page, pageUrl, cfg, { settle: 400 });
  let links = [];
  if (pageNo === 1) links = await pickPages(page, pageUrl, cfg.pages - 1);
  const docH = await page.evaluate(() => document.documentElement.scrollHeight);
  // alles even langs laten komen zodat reveals zichtbaar zijn in de overzichtsfoto
  for (let y = 0; y < docH; y += cfg.height * 0.8) { await scrollTo(page, y); await sleep(120); }
  await sleep(800);
  await scrollTo(page, 0);
  await sleep(300);
  const overview = path.join(dirs.pages, `pagina${pageNo}_overzicht.jpg`);
  await page.screenshot({ path: overview, fullPage: true, type: 'jpeg', quality: 70 }).catch(() => {});

  return { pageNo, url: pageUrl, path: new URL(pageUrl).pathname, title, docHeight: docH, header_height: header, sections, elements, reveals, parallax, sliders, hovers, clicks, keyframes, running_animations: running, libraries: libs, links, overview };
}

module.exports = { analyzePage, pickPages };
