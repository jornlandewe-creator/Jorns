const fs = require('fs');
const path = require('path');
const os = require('os');
const { sleep, easeInOutCubic, ffmpegPath, run, mkdir } = require('./util');

// Neemt de pagina op via het Chrome DevTools screencast-kanaal (JPEG q95 per frame,
// met echte tijdstempels) en bouwt er een H.264 MP4 met constante 30 fps van.
class Recorder {
  constructor(page, cfg) {
    this.page = page;
    this.cfg = cfg;
    this.frames = [];
    this.timeline = [];
    this.cursor = [];
  }
  async start() {
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on('Page.screencastFrame', (f) => {
      this.frames.push({ data: f.data, ts: f.metadata.timestamp });
      this.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    // Forceer een eerste frame
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: this.cfg.width * this.cfg.scale, maxHeight: this.cfg.height * this.cfg.scale, everyNthFrame: 1 });
    this.t0 = Date.now() / 1000;
    await this.page.evaluate(() => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:.01;pointer-events:none'; document.documentElement.appendChild(d); requestAnimationFrame(() => d.remove()); }).catch(() => {});
  }
  now() {
    return +(Date.now() / 1000 - this.t0).toFixed(2);
  }
  mark(event, extra = {}) {
    this.timeline.push({ t: this.now(), event, ...extra });
  }
  async stop() {
    this.tEnd = Date.now() / 1000;
    await this.cdp.send('Page.stopScreencast').catch(() => {});
    await sleep(120);
    await this.cdp.detach().catch(() => {});
  }
  async encode(outFile, { trimStart = 0, maxDur = null, timewarp = 1 } = {}) {
    if (!this.frames.length) throw new Error('geen frames opgenomen');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wmc-'));
    const fr = this.frames.slice().sort((a, b) => a.ts - b.ts);
    // tijdstempels t.o.v. start
    const list = [];
    fr.forEach((f, i) => {
      const file = path.join(tmp, 'f' + String(i).padStart(5, '0') + '.jpg');
      fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
      const start = i === 0 ? this.t0 : f.ts;
      const end = i < fr.length - 1 ? fr[i + 1].ts : this.tEnd;
      list.push({ file, dur: Math.max(0.001, end - start) });
    });
    const txt = list.map((l) => `file '${l.file.replace(/'/g, "'\\''")}'\nduration ${l.dur.toFixed(4)}`).join('\n') + `\nfile '${list[list.length - 1].file}'\n`;
    const listFile = path.join(tmp, 'list.txt');
    fs.writeFileSync(listFile, txt);
    const W = this.cfg.width * this.cfg.scale, H = this.cfg.height * this.cfg.scale;
    const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listFile];
    if (trimStart > 0) args.push('-ss', String(trimStart * timewarp));
    if (maxDur) args.push('-t', String(maxDur));
    args.push('-vf', `setpts=PTS/${timewarp},fps=30,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-profile:v', 'high', '-movflags', '+faststart', '-an', outFile);
    mkdir(path.dirname(outFile));
    await run(ffmpegPath(), args);
    fs.rmSync(tmp, { recursive: true, force: true });
    const real = this.tEnd - this.t0;
    return { frames: fr.length, duration: +((real - trimStart * timewarp) / timewarp).toFixed(2), fps_source: +((fr.length / real) * timewarp).toFixed(1) };
  }
}

// ---------- Cursor ----------
class Cursor {
  constructor(page, cfg) {
    this.page = page;
    this.cfg = cfg;
    this.x = cfg.width + 40;
    this.y = cfg.height * 0.85;
    this.visible = cfg.cursor;
  }
  async install(startX, startY) {
    if (startX !== undefined) { this.x = startX; this.y = startY; }
    if (this.visible) {
      await this.page.evaluate(() => window.__wmc.cursorInstall());
      await this.page.evaluate(([x, y]) => window.__wmc.cursorTo(x, y), [this.x, this.y]);
    }
  }
  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.cfg.width && y < this.cfg.height;
  }
  // Vloeiende boog met ease-in-out, tijdgestuurd (niet framegestuurd)
  async moveTo(tx, ty, ms = 900, { arc = 0.12 } = {}) {
    const sx = this.x, sy = this.y;
    const dx = tx - sx, dy = ty - sy;
    const dist = Math.hypot(dx, dy) || 1;
    const cx = sx + dx * 0.5 - (dy / dist) * dist * arc;
    const cy = sy + dy * 0.5 + (dx / dist) * dist * arc;
    const t0 = Date.now();
    ms *= this.cfg.timewarp || 1;
    for (;;) {
      const raw = Math.min(1, (Date.now() - t0) / ms);
      const t = easeInOutCubic(raw);
      const x = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * cx + t * t * tx;
      const y = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * cy + t * t * ty;
      this.x = x; this.y = y;
      if (this.rec) this.rec.cursor.push({ t: this.rec.now(), x: Math.round(x), y: Math.round(y) });
      if (this.visible) await this.page.evaluate(([x, y]) => window.__wmc && window.__wmc.cursorTo(x, y), [x, y]).catch(() => {});
      if (this.inside(x, y)) await this.page.mouse.move(x, y).catch(() => {});
      if (raw >= 1) break;
      await sleep(8);
    }
  }
  async click() {
    if (this.visible) await this.page.evaluate(() => window.__wmc.cursorPress(true)).catch(() => {});
    await this.page.mouse.down();
    await sleep(90 * (this.cfg.timewarp || 1));
    await this.page.mouse.up();
    if (this.visible) await this.page.evaluate(() => window.__wmc.cursorPress(false)).catch(() => {});
  }
  async hide() {
    await this.page.evaluate(() => window.__wmc && window.__wmc.cursorHide()).catch(() => {});
  }
}

// Vloeiend scrollen, tijdgestuurd. Standaard exacte scrollTo per frame (vuurt gewone scroll-events,
// werkt met ScrollTrigger/IntersectionObserver). Bij Lenis/smooth-scroll libraries: echte wheel-events.
async function wheelScroll(page, cfg, distance, ms, ease = easeInOutCubic, mode = 'native') {
  await page.mouse.move(cfg.width / 2, cfg.height / 2).catch(() => {});
  const y0 = await page.evaluate(() => scrollY);
  let sent = 0;
  const t0 = Date.now();
  for (;;) {
    const raw = Math.min(1, (Date.now() - t0) / ms);
    const target = ease(raw) * distance;
    if (mode === 'wheel') {
      const d = Math.round(target - sent);
      if (Math.abs(d) >= 4 || raw >= 1) { await page.mouse.wheel(0, d).catch(() => {}); sent += d; }
    } else {
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), Math.round(y0 + target)).catch(() => {});
    }
    if (raw >= 1) break;
    await sleep(mode === 'wheel' ? 30 : 12);
  }
}

module.exports = { Recorder, Cursor, wheelScroll };
