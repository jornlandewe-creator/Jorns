#!/usr/bin/env node
// Voert één job uit (los proces). Gebruik: node jobrun.js <job.json>
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const jf = process.argv[2];
let job = JSON.parse(fs.readFileSync(jf, 'utf8'));
const save = (patch) => { job = { ...job, ...patch, updated: Date.now() }; fs.writeFileSync(jf, JSON.stringify(job, null, 1)); };
save({ status: 'running', pid: process.pid });

(async () => {
  try {
    if (job.kind === 'capture') {
      const args = [path.join(__dirname, 'capture.js'), job.url, '--out', job.out, '--no-showcase', '--noZip', '--pages', String(job.pages || 3)];
      const steps = [/\[pagina 1\]/, /Extra pagina/, /\[stills\]/, /\[features\]/, /\[clips\]/, /clip 3\//, /clip 6\//, /\[mobiel\]/, /\[output\]/, /Klaar in/];
      await new Promise((res, rej) => {
        const p = spawn(process.execPath, args, { cwd: __dirname, env: process.env });
        let buf = '';
        const on = (d) => {
          process.stdout.write(d);
          buf += d; let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const l = buf.slice(0, i); buf = buf.slice(i + 1);
            steps.forEach((re, k) => { if (re.test(l)) save({ pct: Math.max(job.pct || 0, Math.round(((k + 1) / steps.length) * 90)) }); });
            const m = /^\s+map: (.+)$/.exec(l); if (m) save({ project: path.basename(m[1].trim()) });
          }
        };
        p.stdout.on('data', on); p.stderr.on('data', on);
        p.on('close', (c) => (c === 0 ? res() : rej(new Error('capture stopte met code ' + c))));
      });
      if (!job.project) throw new Error('geen project gevonden');
      console.log('Assets voorbereiden...');
      const { prepareAssets } = require('./lib/showcase');
      await prepareAssets(path.join(job.out, job.project));
      save({ status: 'done', pct: 100 });
    } else if (job.kind === 'prepare') {
      const { prepareAssets } = require('./lib/showcase');
      await prepareAssets(path.join(job.out, job.project));
      save({ status: 'done', pct: 100 });
    } else if (job.kind === 'render') {
      const { renderShowcase } = require('./lib/showcase');
      let settings = {}; try { settings = JSON.parse(fs.readFileSync(path.join(__dirname, 'settings.json'), 'utf8')); } catch (e) {}
      let last = 0;
      const r = await renderShowcase(path.join(job.out, job.project), {
        params: job.params || {}, noSave: !!job.noSave, maxSubframes: job.quality === 'draft' ? 3 : (settings.maxSubframes || 12), workers: settings.workers,
        onProgress: (p) => { if (Date.now() - last > 1500) { last = Date.now(); save({ pct: p.pct, eta: p.frame > 5 ? Math.round((p.elapsed / p.frame) * (p.total - p.frame)) : null }); } },
      });
      save({ status: 'done', pct: 100, file: r.file, duration: r.duration });
    }
  } catch (e) {
    console.error(e);
    save({ status: 'error', error: String(e.message || e).split('\n')[0] });
  }
  process.exit(0);
})();
