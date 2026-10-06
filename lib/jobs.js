// Jobs die los van de aanroeper draaien (capture, render). Status in <out>/.jobs/<id>.json,
// zodat Claude Desktop, de Studio en de terminal dezelfde jobs zien, ook na een herstart.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const dirOf = (OUT) => { const d = path.join(OUT, '.jobs'); fs.mkdirSync(d, { recursive: true }); return d; };

function startJob(OUT, kind, spec) {
  const id = kind[0] + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const d = dirOf(OUT);
  const jf = path.join(d, id + '.json');
  fs.writeFileSync(jf, JSON.stringify({ id, kind, status: 'queued', pct: 0, started: Date.now(), out: OUT, ...spec }, null, 1));
  const log = fs.openSync(path.join(d, id + '.log'), 'a');
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'jobrun.js'), jf], { detached: true, stdio: ['ignore', log, log], env: process.env, cwd: path.join(__dirname, '..') });
  p.unref();
  return id;
}

function readJob(OUT, id) {
  const d = dirOf(OUT);
  const jf = path.join(d, path.basename(id) + '.json');
  if (!fs.existsSync(jf)) return null;
  const j = JSON.parse(fs.readFileSync(jf, 'utf8'));
  let log = [];
  try { log = fs.readFileSync(path.join(d, path.basename(id) + '.log'), 'utf8').split('\n').filter(Boolean).slice(-10); } catch (e) {}
  // proces verdwenen terwijl status nog 'running'?
  if (j.status === 'running' && j.pid) { try { process.kill(j.pid, 0); } catch (e) { if (Date.now() - (j.updated || 0) > 30000) { j.status = 'error'; j.error = 'proces gestopt'; } } }
  return { ...j, log };
}

function stopJob(OUT, id) {
  const j = readJob(OUT, id);
  if (j && j.pid) { try { process.kill(j.pid); } catch (e) {} }
  const jf = path.join(dirOf(OUT), path.basename(id) + '.json');
  if (fs.existsSync(jf)) { const x = JSON.parse(fs.readFileSync(jf, 'utf8')); x.status = 'stopped'; fs.writeFileSync(jf, JSON.stringify(x, null, 1)); }
}

module.exports = { startJob, readJob, stopJob };
