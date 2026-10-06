const path = require('path');
const { preparePage, scrollTo, waitImages } = require('./browser');
const { sleep, log, pad } = require('./util');

function chooseStills(analyses, cfg) {
  const all = [];
  analyses.forEach((a) => {
    a.sections.forEach((s) => {
      let score = s.score;
      if (a.pageNo === 1 && s.kind === 'hero') score += 40;
      // beweging in deze sectie telt mee
      const inSec = (r) => r && r.y >= s.rect.y - 50 && r.y < s.rect.y + s.rect.h;
      const motionHits = a.hovers.filter((h) => inSec(h.target.rect_page)).length + a.clicks.filter((c) => inSec(c.target.rect_page)).length + a.reveals.filter((r) => inSec(r.rect)).length * 0.5 + (a.parallax.some((p) => p.section === s.index) ? 3 : 0);
      score += Math.min(20, motionHits * 4);
      if (a.pageNo > 1 && s.kind === 'hero') score += 8;
      all.push({ page: a, section: s, score });
    });
  });
  all.sort((x, y) => y.score - x.score);
  const out = [];
  const perPage = {};
  for (const c of all) {
    if (c.section.footer) continue;
    const pp = perPage[c.page.pageNo] || 0;
    if (pp >= Math.max(2, Math.ceil(cfg.stills / 2))) continue;
    // geen twee stills die grotendeels hetzelfde viewport tonen
    if (out.some((o) => o.page === c.page && Math.abs(o.section.rect.y - c.section.rect.y) < cfg.height * 0.6)) continue;
    // zelfde sectie via template op een andere pagina
    if (out.some((o) => o.page !== c.page && o.section.kind === c.section.kind && o.section.heading === c.section.heading && o.section.rect.h === c.section.rect.h)) continue;
    out.push(c);
    perPage[c.page.pageNo] = pp + 1;
    if (out.length >= cfg.stills) break;
  }
  // volgorde: pagina 1 hero eerst, daarna op score
  out.sort((a, b) => (b.page.pageNo === 1 && b.section.kind === 'hero') - (a.page.pageNo === 1 && a.section.kind === 'hero') || b.score - a.score);
  return out;
}

async function captureStills(page, cfg, chosen, analyses, dirs) {
  const stills = [];
  let n = 0;
  for (const c of chosen) {
    n++;
    const a = c.page;
    log(`  still ${n}: pagina ${a.pageNo} ${a.path} / ${c.section.kind} ${c.section.heading ? '"' + c.section.heading.slice(0, 40) + '"' : ''}`);
    await preparePage(page, a.url, cfg, { settle: 500 });
    const hh = await page.evaluate(() => window.__wmc.headerHeight());
    const y = c.section.rect.y < 150 ? 0 : Math.max(0, c.section.rect.y - hh);
    // eerst iets erboven, dan erheen: scroll-reveals spelen dan netjes af
    await scrollTo(page, Math.max(0, y - cfg.height * 0.4));
    await sleep(250);
    await scrollTo(page, y);
    await sleep(1500);
    await waitImages(page);
    await sleep(300);
    const scrollY = await page.evaluate(() => scrollY);
    const base = `still${pad(n)}_p${a.pageNo}-${c.section.kind.replace(/[^a-z]+/g, '-')}`;
    const clean = path.join(dirs.stills, base + '.png');
    await page.mouse.move(cfg.width - 2, cfg.height - 2).catch(() => {});
    await page.screenshot({ path: clean, type: 'png' });

    const interSel = [...a.hovers, ...a.clicks].map((i) => ({ id: i.id, sel: i.target.selector, kind: i.kind }));
    const revSel = a.reveals.map((r) => r.selector);
    const pxSel = a.parallax.flatMap((p) => p.elements.map((e) => ({ sel: e.selector, effects: e.effects.map((x) => x.type) })));
    const tags = await page.evaluate(([max, interSel, revSel, pxSel]) => {
      const W = window.__wmc;
      const els = W.collectElements().filter((e) => W.inView(e.el, 0.6));
      els.sort((x, y) => y.importance - x.importance);
      const chosen = [];
      const iou = (a, b) => { const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y), x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h); const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1); return i / Math.min(a.w * a.h, b.w * b.h); };
      for (const e of els) {
        const r = W.vrect(e.el);
        if (r.w * r.h > innerWidth * innerHeight * 0.85) continue;
        if (chosen.some((c) => iou(c.r, r) > 0.75)) continue;
        const links = [];
        interSel.forEach((i) => { const t = W.q(i.sel); if (t && (t === e.el || e.el.contains(t) || t.contains(e.el))) links.push(i.id + ' (' + i.kind + ')'); });
        revSel.forEach((s) => { const t = W.q(s); if (t && (t === e.el || e.el.contains(t))) { if (!links.includes('scroll-reveal')) links.push('scroll-reveal'); } });
        pxSel.forEach((p) => { const t = W.q(p.sel); if (t && (t === e.el || e.el.contains(t) || t.contains(e.el))) p.effects.forEach((f) => !links.includes(f) && links.push(f)); });
        chosen.push({ el: e.el, r, role: e.role, text: e.text, motion: e.motion, importance: e.importance, links });
        if (chosen.length >= max) break;
      }
      chosen.sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x);
      return chosen.map((c) => ({ selector: W.path(c.el), role: c.role, text: c.text, rect: c.r, motion: c.motion, importance: c.importance, links: c.links }));
    }, [cfg.maxTags, interSel, revSel, pxSel]);
    tags.forEach((t, i) => (t.tag = `${n}.${i + 1}`));
    await page.evaluate((t) => window.__wmc.drawTags(t.map((x) => ({ ...x.rect, label: x.tag + ' ' + x.role }))), tags);
    const tagged = path.join(dirs.stills, base + '_tagged.png');
    await page.screenshot({ path: tagged, type: 'png' });
    await page.evaluate(() => window.__wmc.clearTags());
    stills.push({ no: n, page: a.pageNo, url: a.url, path: a.path, section: c.section.index, kind: c.section.kind, heading: c.section.heading, scrollY, score: Math.round(c.score), clean, tagged, tags });
  }
  return stills;
}

module.exports = { chooseStills, captureStills };
