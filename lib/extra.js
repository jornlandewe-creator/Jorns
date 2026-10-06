// Extra opnames voor de showcase: key features (close-ups) en een mobiele versie van de site.
const fs = require('fs');
const path = require('path');
const { preparePage, scrollTo, waitImages } = require('./browser');
const { Recorder, Cursor, wheelScroll } = require('./record');
const { timewarpInit, slowAnimations, contactSheet } = require('./clips');
const { sleep, log, pad, mkdir, easeInOutCubic } = require('./util');

async function revealAll(page, cfg) {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += Math.round(cfg.height * 0.6)) { await scrollTo(page, y); await sleep(160); }
  await sleep(900);
  await scrollTo(page, 0); await sleep(300);
}

// Key features: per pagina de sterkste USP's/aanbod/cijfers/reviews/prijzen, elk met een eigen screenshot
async function captureFeatures(page, cfg, analyses, dirs) {
  const fdir = path.join(dirs.out, 'features'); mkdir(fdir);
  let all = [];
  for (const a of analyses.slice(0, 3)) {
    await preparePage(page, a.url, cfg, { settle: 500 });
    await revealAll(page, cfg);
    const f = await page.evaluate(() => window.__wmc.features()).catch(() => []);
    f.forEach((x) => all.push({ ...x, page: a.pageNo, url: a.url }));
  }
  const seen = new Set();
  const overlap = (a, b) => { const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y), x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h); const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1); return i / Math.max(1, Math.min(a.w * a.h, b.w * b.h)); };
  const kept = [];
  all = all.sort((a, b) => b.score - a.score).filter((x) => {
    const k = x.text.toLowerCase().slice(0, 30); if (seen.has(k)) return false; seen.add(k);
    if (kept.some((y) => y.page === x.page && (y.selector === x.selector || overlap(y.rect, x.rect) > 0.5))) return false;
    kept.push(x); return true;
  });
  const kinds = {}; const pick = [];
  for (const pass of [1, 2]) for (const x of all) { if (pick.includes(x) || pick.length >= (cfg.features || 6)) continue; if ((kinds[x.kind] || 0) >= pass) continue; kinds[x.kind] = (kinds[x.kind] || 0) + 1; pick.push(x); }
  pick.sort((a, b) => b.score - a.score);
  const out = [];
  let n = 0;
  for (const x of pick) {
    await preparePage(page, x.url, cfg, { settle: 400 });
    const y = Math.max(0, x.rect.y - cfg.height * 0.42 + x.rect.h / 2);
    await scrollTo(page, Math.max(0, y - cfg.height * 0.3)); await sleep(250);
    await scrollTo(page, y); await sleep(1300);
    await waitImages(page, 2500);
    const vr = await page.evaluate((s) => { const e = window.__wmc.q(s); return e && window.__wmc.visible(e) ? window.__wmc.vrect(e) : null; }, x.selector);
    if (!vr || vr.y < 0 || vr.y + vr.h > cfg.height) continue;
    n++;
    const file = path.join(fdir, `feature${pad(n)}_${x.kind}.png`);
    await page.mouse.move(cfg.width - 2, cfg.height - 2).catch(() => {});
    await page.screenshot({ path: file, type: 'png' });
    out.push({ no: n, kind: x.kind, text: x.text, page: x.page, url: x.url, score: x.score, file: path.relative(dirs.out, file).split(path.sep).join('/'), rect: vr, scrollY: Math.round(y) });
    log(`  feature ${n}: [${x.kind}] ${x.text.slice(0, 60)}`);
  }
  // groepen (rij USP's / cijfers / kaarten): één schermafbeelding met de rechthoek van elk blok erin
  let groups = [];
  for (const a of analyses.slice(0, 3)) {
    await preparePage(page, a.url, cfg, { settle: 400 });
    await revealAll(page, cfg);
    const g = await page.evaluate(() => window.__wmc.featureGroups()).catch(() => []);
    g.forEach((x) => groups.push({ ...x, page: a.pageNo, url: a.url }));
  }
  groups.sort((a, b) => b.score - a.score);
  const gout = [];
  for (const x of groups.slice(0, 2)) {
    await preparePage(page, x.url, cfg, { settle: 400 });
    const y = Math.max(0, x.rect.y - cfg.height * 0.5 + x.rect.h / 2);
    await scrollTo(page, Math.max(0, y - cfg.height * 0.3)); await sleep(250);
    await scrollTo(page, y); await sleep(1300);
    await waitImages(page, 2500);
    const vr = await page.evaluate(([s, items]) => { const W = window.__wmc; const e = W.q(s); if (!e || !W.visible(e)) return null; return { rect: W.vrect(e), items: items.map((i) => { const k = W.q(i); return k ? W.vrect(k) : null; }).filter(Boolean) }; }, [x.selector, x.items]);
    if (!vr || vr.items.length < 3 || vr.rect.y < -10 || vr.rect.y + vr.rect.h > cfg.height + 10) continue;
    const file = path.join(fdir, `group${pad(gout.length + 1)}_${x.kind}.png`);
    await page.mouse.move(cfg.width - 2, cfg.height - 2).catch(() => {});
    await page.screenshot({ path: file, type: 'png' });
    gout.push({ no: gout.length + 1, kind: x.kind, texts: x.texts, page: x.page, url: x.url, score: x.score, file: path.relative(dirs.out, file).split(path.sep).join('/'), rect: vr.rect, items: vr.items });
    log(`  groep ${gout.length}: [${x.kind}] ${x.texts.join(' | ').slice(0, 80)}`);
  }
  out.groups = gout;
  return out;
}

// Volledige pagina als één hoog beeld, betrouwbaar: schermvullende screenshots per scrollstap (na de reveals), aan elkaar geplakt.
// Een full-page screenshot van de browser gaat vaak mis bij 100vh-secties, sticky headers en scroll-effecten (pagina staat er dubbel in).
// De sticky header staat maar één keer: elk volgend segment begint onder de header en de stappen overlappen precies die hoogte.
async function captureLongPages(page, cfg, analyses, dirs, opts = {}) {
  const sharp = require('sharp');
  const out = [];
  const MAXH = opts.maxHeight || 7200;
  for (const a of analyses.slice(0, opts.pages || 2)) {
    try {
      await preparePage(page, a.url, cfg, { settle: 500 });
      await revealAll(page, cfg);
      await waitImages(page, 2500);
      const docH = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
      let hh = a.header_height || 0;
      if (!hh) { try { hh = await page.evaluate(() => window.__wmc.headerHeight()); } catch (e) { hh = 0; } }
      hh = Math.max(0, Math.min(Math.round(hh || 0), 240));
      const H = Math.min(docH, MAXH), step = cfg.height - hh;
      const segs = [];
      for (let y = 0; y < H; y += step) {
        await scrollTo(page, y); await sleep(y === 0 ? 400 : 260);
        const sy = await page.evaluate(() => window.scrollY);
        await page.mouse.move(cfg.width - 2, cfg.height - 2).catch(() => {});
        const buf = await page.screenshot({ type: 'png' });
        segs.push({ sy: Math.round(sy), buf, first: y === 0 });
        if (sy + cfg.height >= H - 1 || (segs.length > 1 && Math.abs(sy - segs[segs.length - 2].sy) < 4)) break;
        if (segs.length >= 12) break;
      }
      const sc = cfg.scale || 1, W = cfg.width * sc, totalH = Math.min(H, segs[segs.length - 1].sy + cfg.height) * sc;
      const comps = [];
      for (const sg of segs) {
        const top = sg.first ? 0 : hh;
        const h = cfg.height - top;
        const img = await sharp(sg.buf).extract({ left: 0, top: top * sc, width: W, height: Math.min(h * sc, totalH - (sg.sy + top) * sc) }).png().toBuffer();
        comps.push({ input: img, top: (sg.sy + top) * sc, left: 0 });
      }
      const file = path.join(dirs.pages || path.join(dirs.out, 'pages'), `pagina${a.pageNo}_lang.jpg`);
      mkdir(path.dirname(file));
      await sharp({ create: { width: W, height: Math.round(totalH), channels: 3, background: '#ffffff' } }).composite(comps).jpeg({ quality: 88 }).toFile(file);
      out.push({ page: a.pageNo, url: a.url, file: path.relative(dirs.out, file).split(path.sep).join('/'), h: Math.round(totalH / sc), w: cfg.width });
      log(`  lange pagina ${a.pageNo}: ${Math.round(totalH / sc)} px (${segs.length} delen)`);
    } catch (e) { log('  ! lange pagina: ' + e.message.split('\n')[0]); }
  }
  await scrollTo(page, 0).catch(() => {});
  return out;
}

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function recordMobile(browser, cfg, url, dirs, startNo) {
  const mcfg = { ...cfg, width: 390, height: 844, scale: 3 };
  const clips = [];
  const make = async (type, K, choreo) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA, locale: 'nl-NL' });
    const page = await ctx.newPage();
    if (K > 1) await page.addInitScript(timewarpInit, K);
    try {
      await preparePage(page, url, mcfg, { settle: 700 });
      await revealAll(page, mcfg);
      await waitImages(page, 3000);
      const rec = new Recorder(page, mcfg);
      const cur = new Cursor(page, { ...mcfg, timewarp: K, cursor: false });
      cur.rec = rec;
      if (K > 1) await slowAnimations(page, K);
      await rec.start();
      const extra = await choreo(page, rec, cur, K);
      await rec.stop();
      const trim = 0.15;
      rec.timeline.forEach((e) => (e.t = Math.max(0, +(e.t / K - trim).toFixed(2))));
      const cursorPath = [];
      rec.cursor.forEach((c) => { const t = +(c.t / K - trim).toFixed(3); if (t >= 0 && (!cursorPath.length || t - cursorPath[cursorPath.length - 1].t >= 0.04)) cursorPath.push({ t, x: c.x, y: c.y }); });
      const no = startNo + clips.length + 1;
      const fileBase = `clip${pad(no)}_p1_${type}`;
      const file = path.join(dirs.clips, fileBase + '.mp4');
      const info = await rec.encode(file, { trimStart: trim, timewarp: K });
      await ctx.close();
      return { no, type, file, fileBase, info, timeline: rec.timeline, cursorPath, extra };
    } catch (e) { await ctx.close().catch(() => {}); throw e; }
  };
  const adaptive = async (type, choreo) => {
    let K = type === 'mobile-scroll' ? cfg.timewarpScroll || 4 : cfg.timewarp || 2;
    let r = await make(type, K, choreo);
    while (r.info.fps_source < (cfg.minClipFps || 24) && K < 16) {
      K = Math.min(16, Math.ceil(K * ((cfg.minClipFps || 24) / Math.max(1, r.info.fps_source)) * 1.25));
      log(`    ${r.info.fps_source} fps, opnieuw met timewarp ${K}...`);
      r = await make(type, K, choreo);
    }
    return r;
  };
  // 1. scroll door de mobiele pagina
  log('  mobiel: scroll-clip');
  try {
    const r = await adaptive('mobile-scroll', async (page, rec, cur, K) => {
      await sleep(600 * K); rec.mark('start');
      const h = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      const dist = Math.min(h, 844 * 3.2);
      await wheelScroll(page, mcfg, dist, 5200 * K, easeInOutCubic, 'native');
      rec.mark('einde scroll', { distance_px: Math.round(dist) });
      await sleep(400 * K);
    });
    clips.push({ ...r, note: 'Mobiele site: vloeiende scroll vanaf de hero' });
  } catch (e) { log('  ! mobiele scroll mislukt: ' + e.message.split('\n')[0]); }
  // 2. menu openen op mobiel (tik)
  log('  mobiel: menu-clip');
  try {
    const r = await adaptive('mobile-menu', async (page, rec, cur, K) => {
      const c = (await page.evaluate(() => window.__wmc.clickCandidates())).find((x) => x.kind === 'menu' && x.rect.y < 200);
      if (!c) throw new Error('geen menuknop gevonden');
      const vr = await page.evaluate((s) => window.__wmc.vrect(window.__wmc.q(s)), c.selector);
      const x = vr.x + vr.w / 2, y = vr.y + vr.h / 2;
      await sleep(700 * K); rec.mark('start');
      cur.x = x - 60; cur.y = y + 160;
      await cur.moveTo(x, y, 600);
      rec.mark('tik', { x, y });
      await page.touchscreen.tap(x, y).catch(async () => { await page.mouse.click(x, y); });
      await sleep(2600 * K);
      rec.mark('einde');
      return { tap: { x, y } };
    });
    clips.push({ ...r, note: 'Mobiele site: tik op de menuknop, menu opent' });
  } catch (e) { log('  ! mobiel menu mislukt: ' + e.message.split('\n')[0]); }
  // 3. mobiele stills (hero)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA, locale: 'nl-NL' });
  const page = await ctx.newPage();
  const stills = [];
  try {
    await preparePage(page, url, mcfg, { settle: 900 });
    await revealAll(page, mcfg);
    await sleep(800);
    const mdir = path.join(dirs.out, 'mobile'); mkdir(mdir);
    const f = path.join(mdir, 'mobile_hero.png');
    await page.screenshot({ path: f, type: 'png' });
    stills.push({ kind: 'mobile-hero', file: path.relative(dirs.out, f).split(path.sep).join('/'), width: 390, height: 844 });
  } catch (e) { log('  ! mobiele still mislukt: ' + e.message.split('\n')[0]); }
  await ctx.close();

  const out = [];
  for (const c of clips) {
    const clip = { no: c.no, type: c.type, label: c.type, page: 1, url, path: '/', note: c.note, timeline: c.timeline, cursorPath: c.cursorPath, file: c.file, fileBase: c.fileBase, duration: c.info.duration, source_fps: c.info.fps_source, cursor: false, viewport: { width: 390, height: 844 }, tap: c.extra && c.extra.tap, evidence: [], score: 0 };
    fs.writeFileSync(path.join(dirs.clips, c.fileBase + '.json'), JSON.stringify({ clip: c.no, type: c.type, file: path.basename(c.file), duration_s: c.info.duration, viewport: clip.viewport, timeline: c.timeline, cursor_path: c.cursorPath, tap: clip.tap }, null, 2));
    out.push(clip);
  }
  return { clips: out, stills };
}

module.exports = { captureFeatures, recordMobile, captureLongPages };
