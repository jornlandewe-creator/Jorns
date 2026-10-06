const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
// Snel optrekken, strak afremmen (speed ramp)
const easeRamp = (t) => (t < 0.35 ? 0.5 * Math.pow(t / 0.35, 2.2) * 0.62 : 0.31 + (1 - 0.31) * (1 - Math.pow(1 - (t - 0.35) / 0.65, 3)));
const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);

const slug = (s, n = 40) =>
  (s || '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, n)
    .replace(/-+$/, '') || 'x';

const pad = (n, w = 2) => String(n).padStart(w, '0');
const mkdir = (p) => fs.mkdirSync(p, { recursive: true });

function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const p = require('ffmpeg-static');
    if (p && fs.existsSync(p)) return p;
  } catch (e) {}
  return 'ffmpeg';
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], ...opts });
    let err = '';
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(cmd + ' exit ' + code + '\n' + err.slice(-1500)))));
  });
}

const rel = (base, p) => path.relative(base, p).split(path.sep).join('/');

module.exports = { sleep, log, easeInOutCubic, easeRamp, easeOutQuart, slug, pad, mkdir, ffmpegPath, run, rel };
