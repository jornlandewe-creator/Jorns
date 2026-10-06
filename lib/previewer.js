// Warme preview-browser: blijft open tussen aanroepen, zodat previews voor Claude en de Studio snel zijn.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { prepareAssets, loadParams, PAGE } = require('./showcase');
const TLMOD = require('./showcase-timeline');

class Previewer {
  constructor() { this.browser = null; this.pages = {}; this.timer = null; }
  async ensure() {
    if (this.browser && this.browser.isConnected()) return;
    const o = { headless: true, args: ['--allow-file-access-from-files', '--force-color-profile=srgb', '--hide-scrollbars'] };
    if (process.env.CHROME_PATH) { o.executablePath = process.env.CHROME_PATH; o.args.push('--no-sandbox', '--no-zygote', '--use-gl=angle', '--use-angle=swiftshader'); }
    this.browser = await chromium.launch(o);
    this.pages = {};
  }
  touch() { clearTimeout(this.timer); this.timer = setTimeout(() => this.close(), 4 * 60 * 1000); }
  async close() { try { if (this.browser) await this.browser.close(); } catch (e) {} this.browser = null; this.pages = {}; }
  async page(dir, w, h) {
    await this.ensure();
    const key = dir + '|' + w + 'x' + h;
    if (this.pages[key]) return this.pages[key];
    const html = path.join(dir, 'showcase', '_assets', 'render.html');
    fs.copyFileSync(path.join(__dirname, 'showcase-engine.browser.js'), path.join(dir, 'showcase', '_assets', 'engine.js'));
    fs.writeFileSync(html, PAGE(null));
    const pg = await this.browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await pg.goto('file://' + html, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await pg.waitForFunction(() => window.SC && window.SC.ready, null, { timeout: 60000 });
    this.pages[key] = pg;
    return pg;
  }
  async timeline(dir, params) {
    const a = await prepareAssets(dir);
    return TLMOD.buildTimeline(a.A, a.R, loadParams(dir, params || {}));
  }
  // frames: lijst tijden → jpeg-buffers
  async frames(dir, tl, times, quality = 82) {
    this.touch();
    const pg = await this.page(dir, tl.width, tl.height);
    await pg.evaluate((tl) => window.SC.init(tl), tl);
    const out = [];
    for (const t of times) {
      await pg.evaluate((t) => window.SC.render(t), t);
      out.push({ t, buf: await pg.screenshot({ type: 'jpeg', quality }) });
    }
    this.touch();
    return out;
  }
  async analyse(dir, tl, step = 0.1) {
    this.touch();
    const pg = await this.page(dir, tl.width, tl.height);
    await pg.evaluate((tl) => window.SC.init({ ...tl, live: true }), tl);
    return pg.evaluate(([d, step]) => { const o = []; for (let t = 0; t <= d; t += step) o.push({ t: +t.toFixed(2), ...window.SC.qa(t) }); return o; }, [tl.duration, step]);
  }
}

// QA: problemen vinden (leeg beeld, te schuin, te ver ingezoomd) buiten de overgangen
function qaIssues(tl, samples) {
  const issues = [];
  const inTransition = (t) => tl.shots.some((s) => t >= s.start && t <= s.end && (t < s.start + 0.55 || t > s.end - 0.55)) || (tl.swaps || []).some(([a, b]) => t >= a - 0.1 && t <= b + 0.1);
  const shotAt = (t) => (tl.shots.find((s) => t >= s.start && t <= s.end) || {}).id || '?';
  const runs = (pred) => { const r = []; let cur = null; samples.forEach((s) => { if (pred(s) && !inTransition(s.t)) { if (!cur) cur = { a: s.t, b: s.t, worst: s }; else { cur.b = s.t; cur.worst = s; } } else if (cur) { r.push(cur); cur = null; } }); if (cur) r.push(cur); return r.filter((x) => x.b - x.a >= 0.25); };
  runs((s) => s.coverage < 0.1 && !['intro', 'outro'].includes(shotAt(s.t))).forEach((r) => issues.push({ type: 'leeg beeld', from: r.a, to: r.b, shot: shotAt(r.a), detail: `maar ${Math.round(r.worst.coverage * 100)}% van het beeld gevuld` }));
  runs((s) => s.angle > 64 && s.coverage > 0.15).forEach((r) => issues.push({ type: 'te schuin', from: r.a, to: r.b, shot: shotAt(r.a), detail: `hoofdvlak staat ${Math.round(r.worst.angle)} graden gedraaid` }));
  runs((s) => s.zoom > 1.25).forEach((r) => issues.push({ type: 'te ver ingezoomd (kan onscherp zijn)', from: r.a, to: r.b, shot: shotAt(r.a), detail: `${r.worst.zoom.toFixed(2)}x de bronresolutie` }));
  // onrustige camera: het focuspunt schiet binnen een shot hard heen en weer (niet tijdens overgangen)
  const sw = [];
  for (let i = 1; i < samples.length - 1; i++) {
    const a = samples[i - 1], b = samples[i + 1], c = samples[i];
    if (a.main !== c.main || b.main !== c.main) continue;
    const v = (b.fx - a.fx) / Math.max(0.01, b.t - a.t);
    sw.push({ t: c.t, v, fx: c.fx });
  }
  const swing = [];
  let cur = null;
  const CRAZY = ['stack', 'orbit', 'spin', 'travel'];
  sw.forEach((p) => { const bad = Math.abs(p.v) > 0.55 && !inTransition(p.t) && !CRAZY.includes(shotAt(p.t)); if (bad) { if (!cur) cur = { a: p.t, b: p.t, max: Math.abs(p.v) }; else { cur.b = p.t; cur.max = Math.max(cur.max, Math.abs(p.v)); } } else if (cur) { swing.push(cur); cur = null; } });
  if (cur) swing.push(cur);
  swing.filter((r) => r.b - r.a >= 0.15).forEach((r) => issues.push({ type: 'camera zwaait te hard', from: r.a, to: r.b, shot: shotAt(r.a), detail: `focus schuift ${Math.round(r.max * 100)}% beeldbreedte per seconde; calm hoger of shotTempo voor dit shot hoger` }));
  runs((s) => (Math.abs(s.fx - 0.5) > 0.3 || s.fy < 0.12 || s.fy > 0.88) && s.coverage > 0.15).forEach((r) => issues.push({ type: 'focus uit het midden', from: r.a, to: r.b, shot: shotAt(r.a), detail: `focuspunt op ${Math.round(r.worst.fx * 100)}% / ${Math.round(r.worst.fy * 100)}% van het beeld` }));
  runs((s) => s.margin > 0.01).forEach((r) => issues.push({ type: 'belangrijk deel buiten beeld/marge', from: r.a, to: r.b, shot: shotAt(r.a), detail: `valt ${Math.round(r.worst.margin * 100)}% van de beeldbreedte over de rand; zet voor dit shot frame.zoom lager (bv. 0.85)` }));
  runs((s) => s.clip > 0).forEach((r) => issues.push({ type: 'vlak te dicht op de camera', from: r.a, to: r.b, shot: shotAt(r.a), detail: 'een vlak komt bijna door de camera heen (vervorming/knip); zoom lager of shot korter' }));
  issues.sort((a, b) => a.from - b.from);
  return issues;
}

module.exports = { Previewer, qaIssues };
