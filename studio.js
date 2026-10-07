#!/usr/bin/env node
// Website Motion Studio: lokale app. Link invoeren → capture → showcase met live preview, sliders en render.
// Start: node studio.js  (opent http://localhost:4747)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, exec } = require('child_process');
const { renderShowcase, renderAudioOnly, prepareAssets, loadParams, listSources, makeGrab, autoCut, addCustom, PAGE } = require('./lib/showcase');
const TLMOD = require('./lib/showcase-timeline');
const VERSION = require('./package.json').version;

const args = process.argv.slice(2);
const argv = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const PORT = +argv('port', 4747);
let OUT = argv('out', null);
if (!OUT) {
  try { const s = JSON.parse(fs.readFileSync(path.join(__dirname, 'settings.json'), 'utf8')); OUT = s.out; } catch (e) {}
  OUT = OUT || path.join(os.homedir(), 'Desktop', 'Website Captures');
}
fs.mkdirSync(OUT, { recursive: true });

const jobs = {};
const SRC_CACHE = {};
let jobSeq = 0;
function newJob(kind, name) {
  const id = String(++jobSeq);
  jobs[id] = { id, kind, name, status: 'running', log: [], pct: 0, result: null, error: null, started: Date.now(), stop: false };
  return jobs[id];
}
const logTo = (job, line) => { job.log.push(line); if (job.log.length > 300) job.log.shift(); };

const MIME = { '.wav': 'audio/wav', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mp4': 'video/mp4', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

function sendFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('niet gevonden'); }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;
    if (range && (type === 'video/mp4' || type === 'audio/wav')) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m[1] ? +m[1] : 0, end = m[2] ? +m[2] : st.size - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}
const json = (res, obj, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch (e) { r({}); } }); });
const safeName = (n) => path.basename(String(n || ''));

function listProjects() {
  if (!fs.existsSync(OUT)) return [];
  return fs.readdirSync(OUT).filter((d) => fs.existsSync(path.join(OUT, d, 'website-reference-context.json'))).map((d) => {
    const dir = path.join(OUT, d);
    let url = '';
    try { url = JSON.parse(fs.readFileSync(path.join(dir, 'website-reference-context.json'), 'utf8')).url; } catch (e) {}
    const sdir = path.join(dir, 'showcase');
    const renders = fs.existsSync(sdir) ? fs.readdirSync(sdir).filter((f) => /^SHOWCASE_.*_\d{8}-\d{6}(_shot)?\.mp4$/.test(f)).sort().reverse() : [];
    return { name: d, url, mtime: fs.statSync(dir).mtimeMs, prepared: fs.existsSync(path.join(sdir, '_assets', 'assets.json')), renders };
  }).sort((a, b) => b.mtime - a.mtime);
}

function writePlayer(name) {
  const dir = path.join(OUT, name, 'showcase', '_assets');
  fs.writeFileSync(path.join(dir, 'player.html'), PAGE(null).replace('<script src="engine.js"></script>', '<script src="engine.js"></script><script src="/studio/player.js"></script>'));
}

async function ensurePrepared(name, job) {
  const dir = path.join(OUT, name);
  if (job) logTo(job, 'Beelden voorbereiden (frames uit de clips halen)...');
  const a = await prepareAssets(dir);
  writePlayer(name);
  return a;
}

function startCapture(url, opts) {
  const job = newJob('capture', null);
  const a = [path.join(__dirname, 'capture.js'), url, '--out', OUT, '--no-showcase', '--noZip'];
  if (opts.pages) a.push('--pages', String(opts.pages));
  if (opts.clips) a.push('--clips', String(opts.clips));
  const p = spawn(process.execPath, a, { cwd: __dirname, env: process.env });
  job.proc = p;
  let buf = '';
  const steps = [/\[pagina 1\]/, /Extra pagina/, /\[stills\]/, /\[clips\]/, /clip 3\//, /clip 6\//, /\[output\]/, /Klaar in/];
  const onData = (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      logTo(job, line);
      steps.forEach((re, k) => { if (re.test(line)) job.pct = Math.max(job.pct, Math.round(((k + 1) / steps.length) * 85)); });
      const m = /^\s+map: (.+)$/.exec(line);
      if (m) job.name = path.basename(m[1].trim());
    }
  };
  p.stdout.on('data', onData); p.stderr.on('data', onData);
  p.on('close', async (code) => {
    if (job.stop) { job.status = 'stopped'; return; }
    if (code !== 0 || !job.name) { job.status = 'error'; job.error = 'Capture mislukt (zie log)'; return; }
    try { await ensurePrepared(job.name, job); job.pct = 100; job.status = 'done'; job.result = { name: job.name }; }
    catch (e) { job.status = 'error'; job.error = e.message; }
  });
  return job;
}

function startRender(name, params, quality, range) {
  const job = newJob('render', name);
  const dir = path.join(OUT, name);
  const settings = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'settings.json'), 'utf8')); } catch (e) { return {}; } })();
  // concept = snel (weinig motion blur), final = volle motion blur, ultra = final + supersampling (1,5x) voor de strakste randen
  const supersample = quality === 'ultra' ? (settings.supersample || 1.5) : 1;
  renderShowcase(dir, { params, range: Array.isArray(range) && range.length === 2 ? [+range[0], +range[1]] : undefined, maxSubframes: quality === 'draft' ? 4 : (settings.maxSubframes || 40), supersample, workers: settings.workers, onProgress: (p) => { job.pct = p.pct; job.eta = p.frame > 5 ? Math.round((p.elapsed / p.frame) * (p.total - p.frame)) : null; }, shouldStop: () => job.stop })
    .then((r) => { job.status = 'done'; job.pct = 100; job.result = { file: path.basename(r.file), url: `/p/${encodeURIComponent(name)}/showcase/${encodeURIComponent(path.basename(r.file))}` }; })
    .catch((e) => { job.status = job.stop ? 'stopped' : 'error'; job.error = e.message; });
  return job;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = decodeURIComponent(u.pathname);
  try {
    if (p === '/' || p === '/index.html') return sendFile(req, res, path.join(__dirname, 'studio', 'index.html'));
    if (p.startsWith('/studio/')) {
      if (p === '/studio/timeline.js') return sendFile(req, res, path.join(__dirname, 'lib', 'showcase-timeline.js'));
      return sendFile(req, res, path.join(__dirname, 'studio', safeName(p.slice(8))));
    }
    if (p.startsWith('/p/')) {
      const rest = p.slice(3);
      const name = rest.split('/')[0];
      const file = path.normalize(path.join(OUT, safeName(name), rest.slice(name.length)));
      if (!file.startsWith(path.join(OUT, safeName(name)))) { res.writeHead(403); return res.end(); }
      return sendFile(req, res, file);
    }
    if (p === '/favicon.ico') return sendFile(req, res, path.join(__dirname, 'studio', 'icon-32.png'));
    if (p === '/api/version') return json(res, { version: VERSION, dir: __dirname });
    // lopende taken (zodat de Studio na herladen of wegklikken de voortgang terugvindt)
    if (p === '/api/jobs') return json(res, { jobs: Object.values(jobs).filter((j) => j.status === 'running' || Date.now() - j.started < 10 * 60 * 1000).map(({ proc, log, ...pub }) => pub) });
    if (p === '/api/projects') return json(res, { out: OUT, projects: listProjects() });
    if (p === '/api/capture' && req.method === 'POST') {
      const b = await body(req);
      let url = String(b.url || '').trim();
      if (!url) return json(res, { error: 'Geen URL' }, 400);
      if (!/^https?:\/\//.test(url)) url = 'https://' + url;
      return json(res, { job: startCapture(url, b).id });
    }
    if (p.startsWith('/api/project/')) {
      const name = safeName(p.slice(13));
      const dir = path.join(OUT, name);
      if (!fs.existsSync(dir)) return json(res, { error: 'onbekend project' }, 404);
      const assets = await ensurePrepared(name);
      let brief = ''; try { brief = fs.readFileSync(path.join(dir, 'showcase', 'brief.txt'), 'utf8'); } catch (e) {}
      return json(res, { name, assets, brief, params: loadParams(dir), defaults: TLMOD.DEFAULTS, base: `/p/${encodeURIComponent(name)}/showcase/_assets/` });
    }
    if (p.startsWith('/api/sources/')) {
      const name = safeName(p.slice(13));
      const dir = path.join(OUT, name); SRC_CACHE[dir] = await listSources(dir);
      return json(res, { sources: SRC_CACHE[dir], base: `/p/${encodeURIComponent(name)}/` });
    }
    if (p === '/api/upload' && req.method === 'POST') {
      // eigen beeld of video: rauwe body, naam in de query
      const name = safeName(u.searchParams.get('name')), fname = path.basename(String(u.searchParams.get('file') || 'upload')).replace(/[^\w.\- ]+/g, '_');
      if (!/\.(png|jpe?g|webp|mp4|mov|m4v|webm)$/i.test(fname)) return json(res, { error: 'Alleen png, jpg, webp, mp4, mov of webm' }, 400);
      const dir = path.join(OUT, name); if (!fs.existsSync(dir)) return json(res, { error: 'onbekend project' }, 404);
      fs.mkdirSync(path.join(dir, 'custom'), { recursive: true });
      const dest = path.join(dir, 'custom', fname);
      await new Promise((ok, bad) => { const w = fs.createWriteStream(dest); req.pipe(w); w.on('finish', ok); w.on('error', bad); req.on('error', bad); });
      try { await addCustom(dir, dest); } catch (e) { return json(res, { error: 'Kon dit bestand niet verwerken: ' + e.message }, 500); }
      delete SRC_CACHE[dir];
      return json(res, { ok: true, file: 'custom/' + fname });
    }
    if (p === '/api/autocut' && req.method === 'POST') {
      const b = await body(req);
      const dir = path.join(OUT, safeName(b.name));
      const list = SRC_CACHE[dir] || (SRC_CACHE[dir] = await listSources(dir));
      const src = list.find((x) => x.file === b.source);
      const file = path.normalize(path.join(dir, String(b.source || '')));
      if (!file.startsWith(dir) || !fs.existsSync(file)) return json(res, { error: 'bron niet gevonden' }, 404);
      return json(res, { rects: await autoCut(file, b.area, { max: b.max || 6, purpose: b.purpose, spots: src ? src.spots : [] }) });
    }
    if (p === '/api/grab' && req.method === 'POST') {
      const b = await body(req);
      return json(res, await makeGrab(path.join(OUT, safeName(b.name)), String(b.source || ''), b.rects || [], b.video || null));
    }
    if (p === '/api/audio' && req.method === 'POST') {
      const b = await body(req);
      const dir = path.join(OUT, safeName(b.name));
      const f = path.join(dir, 'showcase', '_assets', 'preview_audio.wav');
      await renderAudioOnly(dir, b.params || {}, f);
      return json(res, { url: `/p/${encodeURIComponent(safeName(b.name))}/showcase/_assets/preview_audio.wav?v=${Date.now()}` });
    }
    if (p === '/api/refeatures' && req.method === 'POST') {
      const b = await body(req);
      const name = safeName(b.name), job = newJob('refeatures', name);
      const pr = spawn(process.execPath, [path.join(__dirname, 'refeatures.js'), path.join(OUT, name)], { cwd: __dirname, env: process.env });
      job.proc = pr;
      const onD = (d) => String(d).split('\n').filter(Boolean).forEach((l) => logTo(job, l));
      pr.stdout.on('data', onD); pr.stderr.on('data', onD);
      pr.on('close', async (code) => { if (code !== 0) { job.status = 'error'; job.error = 'Features zoeken mislukt'; return; } try { await ensurePrepared(name, job); job.status = 'done'; job.pct = 100; } catch (e) { job.status = 'error'; job.error = e.message; } });
      return json(res, { job: job.id });
    }
    if (p === '/api/brief' && req.method === 'POST') {
      const b = await body(req);
      const dir = path.join(OUT, safeName(b.name), 'showcase');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'brief.txt'), String(b.brief || ''));
      return json(res, { ok: true });
    }
    if (p === '/api/params' && req.method === 'POST') {
      const b = await body(req);
      const dir = path.join(OUT, safeName(b.name), 'showcase');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'params.json'), JSON.stringify(TLMOD.merge(b.params), null, 2));
      return json(res, { ok: true });
    }
    if (p === '/api/render' && req.method === 'POST') {
      const b = await body(req);
      if (Object.values(jobs).some((j) => j.kind === 'render' && j.status === 'running')) return json(res, { error: 'Er loopt al een render' }, 409);
      return json(res, { job: startRender(safeName(b.name), b.params, b.quality, b.range).id });
    }
    if (p.startsWith('/api/jobs/')) {
      const j = jobs[p.slice(10)];
      if (!j) return json(res, { error: 'onbekend' }, 404);
      const { proc, ...pub } = j;
      return json(res, { ...pub, log: j.log.slice(-40) });
    }
    if (p.startsWith('/api/stop/') && req.method === 'POST') {
      const j = jobs[p.slice(10)];
      if (j) { j.stop = true; if (j.proc) j.proc.kill(); }
      return json(res, { ok: true });
    }
    if (p === '/api/reveal' && req.method === 'POST') {
      const b = await body(req);
      const target = path.join(OUT, safeName(b.name), 'showcase');
      const cmd = process.platform === 'darwin' ? `open "${target}"` : process.platform === 'win32' ? `explorer "${target}"` : `xdg-open "${target}"`;
      exec(cmd);
      return json(res, { ok: true });
    }
    res.writeHead(404); res.end('niet gevonden');
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
});

// een fout in een render of capture mag nooit de hele Studio laten stoppen
process.on('unhandledRejection', (e) => console.error('Fout (Studio draait door):', e && e.message ? e.message : e));
process.on('uncaughtException', (e) => { if (e && e.code === 'EADDRINUSE') return; console.error('Fout (Studio draait door):', e && e.message ? e.message : e); });

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.log(`Poort ${PORT} is bezet (draait er nog een oude versie?). Sluit die of start via de snelkoppeling, die ruimt hem op.`); process.exit(1); }
  throw e;
});
server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Website Motion Studio ${VERSION} draait op ${url}\nCaptures: ${OUT}\n(Sluit dit venster om te stoppen.)`);
  if (!args.includes('--no-open')) {
    const cmd = process.platform === 'darwin' ? `open ${url}` : process.platform === 'win32' ? `start ${url}` : `xdg-open ${url}`;
    exec(cmd, () => {});
  }
});
