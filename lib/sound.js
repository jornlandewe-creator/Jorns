// Sound design voor de showcase: alles gesynthetiseerd (geen samples), 48 kHz stereo.
// Whooshes op snelle camerabewegingen (uit de bewegingsanalyse), klikjes, tikken, pops, impacts, risers, shimmer,
// plus een subtiele muziekbed. Master: reverb-send, zachte limiter, piek op -1 dBFS.
const fs = require('fs');

const SR = 48000;

function makeRng(seed) { let a = seed >>> 0 || 1; return () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; return ((a >>> 0) / 4294967296) * 2 - 1; }; }

class Bus {
  constructor(dur) { this.n = Math.ceil(dur * SR); this.L = new Float32Array(this.n); this.R = new Float32Array(this.n); }
  add(i, l, r) { if (i >= 0 && i < this.n) { this.L[i] += l; this.R[i] += r; } }
}
const panLR = (p) => { const a = (Math.max(-1, Math.min(1, p)) + 1) * Math.PI / 4; return [Math.cos(a), Math.sin(a)]; };

// ---------- bouwstenen ----------
// Whoosh met diepte: sub-laag (gewicht), gefilterd lichaam, brede lucht-laag (L/R ontkoppeld), doppler-achtige filterzwaai.
function whoosh(bus, rev, t0, { dur = 0.6, gain = 1, pan = 0, pan2 = null, bright = 0.5, seed = 1, depth = 1, width = 1, send = 0.3 }) {
  const rL = makeRng(seed * 7 + 3), rR = makeRng(seed * 13 + 5), rS = makeRng(seed * 3 + 11);
  const N = Math.round(dur * SR), peakU = 0.6, i0 = Math.round(t0 * SR) - Math.round(N * peakU);
  const pEnd = pan2 === null ? -pan * 0.8 : pan2;
  const sv = () => ({ low: 0, band: 0 });
  const bL = sv(), bR = sv(), aL = sv(), aR = sv(), sub = sv();
  let pkL = 0, pkR = 0, ph = 0, hpL = 0, hpR = 0, xl0 = 0, xr0 = 0, lpaL = 0, lpaR = 0;
  const svf = (st, x, fc, q) => { const f = 2 * Math.sin(Math.PI * Math.min(fc, 12000) / SR); const hi = x - st.low - q * st.band; st.band += f * hi; st.low += f * st.band; return st; };
  for (let i = 0; i < N; i++) {
    const u = i / N;
    // opbouw langzaam, passage snel, staart met sluitend filter
    const env = u < peakU ? Math.pow(u / peakU, 2.2) : Math.pow(1 - (u - peakU) / (1 - peakU), 1.35);
    const sweep = u < peakU ? Math.pow(u / peakU, 1.6) : Math.pow(1 - (u - peakU) / (1 - peakU), 0.8);
    const wl = rL(), wr = rR();
    pkL = 0.985 * pkL + 0.015 * wl; pkR = 0.985 * pkR + 0.015 * wr;
    const xl = wl * 0.25 + pkL * 3, xr = wr * 0.25 + pkR * 3;
    // lichaam (mid), licht ontkoppeld per kanaal
    const fc = 220 + (380 + 2200 * bright) * sweep;
    const ml = svf(bL, xl, fc, 0.75).band, mr = svf(bR, xr, fc * 1.04, 0.75).band;
    // lucht (hoog), breed
    const fa = 1800 + 5200 * bright * sweep;
    lpaL += 0.55 * (svf(aL, wl - xl0, fa, 1.1).band - lpaL); lpaR += 0.55 * (svf(aR, wr - xr0, fa * 1.07, 1.1).band - lpaR); xl0 = wl; xr0 = wr;
    const al = lpaL, ar = lpaR;
    // sub: laag gefilterde ruis + sinus die zakt (gewicht onder de passage)
    const sl = svf(sub, (wl + wr) * 0.5 + pkL * 2, 90 + 140 * sweep, 0.9).low;
    ph += 2 * Math.PI * (70 - 28 * Math.max(0, (u - peakU * 0.8) / (1 - peakU * 0.8))) / SR;
    const subEnv = Math.pow(env, 1.4);
    const subS = (sl * 0.9 + Math.sin(ph) * 0.22 * subEnv) * depth;
    const g = env * gain * 0.5;
    const p = pan + (pEnd - pan) * Math.pow(u, 1.2);
    const [gl, gr] = panLR(p);
    const W = 0.26 * width * bright;
    const L = (ml * 0.85) * gl + al * W * (0.6 + gl * 0.4) + subS * 0.7;
    const R = (mr * 0.85) * gr + ar * W * (0.6 + gr * 0.4) + subS * 0.7;
    bus.add(i0 + i, L * g, R * g);
    // reverb zonder sub (blijft strak)
    rev.add(i0 + i, (ml * gl + al * W) * g * send, (mr * gr + ar * W) * g * send);
  }
}
function tone(bus, rev, t0, parts, { gain = 1, pan = 0, send = 0.2, dur = 0.3 }) {
  const i0 = Math.round(t0 * SR), N = Math.round(dur * SR);
  const [gl, gr] = panLR(pan);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    let s = 0;
    for (const p of parts) {
      const f = p.f1 !== undefined ? p.f * Math.pow(p.f1 / p.f, Math.min(1, t / (p.sweep || dur))) : p.f;
      const ph = p._ph = (p._ph || 0) + 2 * Math.PI * f / SR;
      const att = p.att ? Math.min(1, t / p.att) : 1;
      s += p.a * Math.sin(ph) * Math.exp(-t / p.d) * att;
    }
    s *= gain;
    bus.add(i0 + i, s * gl, s * gr);
    if (send) rev.add(i0 + i, s * gl * send, s * gr * send);
  }
}
function noiseBurst(bus, rev, t0, { d = 0.002, gain = 0.3, pan = 0, hp = true, seed = 5, dur = 0.03, send = 0.1 }) {
  const rnd = makeRng(seed); const i0 = Math.round(t0 * SR), N = Math.round(dur * SR);
  const [gl, gr] = panLR(pan); let prev = 0;
  for (let i = 0; i < N; i++) { const t = i / SR; const w = rnd(); const x = hp ? w - prev : w; prev = w; const s = x * Math.exp(-t / d) * gain; bus.add(i0 + i, s * gl, s * gr); rev.add(i0 + i, s * gl * send, s * gr * send); }
}
// modale synthese: korte ruisimpuls door resonatoren = plastic/mechanisch klikje
function modal(bus, rev, t0, modes, { gain = 1, pan = 0, send = 0.04, exc = 0.0006, seed = 7, dur = 0.06 }) {
  const rnd = makeRng(seed); const i0 = Math.round(t0 * SR), N = Math.round(dur * SR), E = Math.max(8, Math.round(exc * SR));
  const st = modes.map((m) => { const w = 2 * Math.PI * m.f / SR, r = Math.exp(-1 / (m.d * SR)); return { a1: 2 * r * Math.cos(w), a2: -r * r, y1: 0, y2: 0, g: m.a * (1 - r) * 4 }; });
  const [gl, gr] = panLR(pan);
  for (let i = 0; i < N; i++) {
    const x = i < E ? rnd() * (1 - i / E) : 0;
    let s = x * 0.25;
    for (const m of st) { const y = m.a1 * m.y1 + m.a2 * m.y2 + x; m.y2 = m.y1; m.y1 = y; s += y * m.g; }
    s *= gain;
    bus.add(i0 + i, s * gl, s * gr);
    if (send) rev.add(i0 + i, s * gl * send, s * gr * send);
  }
}
const click = (bus, rev, t0, o = {}) => {
  const g = (o.gain ?? 1) * 1.4, pan = o.pan ?? 0.08, v = ((o.seed || 1) % 5) * 0.012;
  // indrukken: klik van de microswitch + holle 'tok' van de behuizing
  modal(bus, rev, t0, [{ f: 4100 * (1 + v), a: 0.9, d: 0.0016 }, { f: 2350, a: 0.7, d: 0.0032 }, { f: 6900, a: 0.35, d: 0.0009 }, { f: 240, a: 0.5, d: 0.009 }], { gain: g, pan, seed: 7 + (o.seed || 0), exc: 0.0005 });
  // loslaten: iets hoger en zachter, ~85 ms later
  modal(bus, rev, t0 + 0.085, [{ f: 4600 * (1 + v), a: 0.6, d: 0.0012 }, { f: 2800, a: 0.4, d: 0.0024 }, { f: 300, a: 0.2, d: 0.006 }], { gain: g * 0.55, pan, seed: 17 + (o.seed || 0), exc: 0.0004 });
};
const tap = (bus, rev, t0, o = {}) => {
  const g = o.gain ?? 1;
  // vinger op glas: zachte doffe tik
  modal(bus, rev, t0, [{ f: 1900, a: 0.5, d: 0.0025 }, { f: 3600, a: 0.25, d: 0.0012 }, { f: 420, a: 0.45, d: 0.008 }], { gain: g * 1.2, pan: o.pan ?? 0, seed: 11, exc: 0.0012, send: 0.06 });
};
const pop = (bus, rev, t0, o = {}) => {
  const g = o.gain ?? 1;
  tone(bus, rev, t0, [{ f: 760, f1: 330, a: 0.6, d: 0.06, sweep: 0.05, att: 0.002 }, { f: 1520, f1: 660, a: 0.12, d: 0.03, sweep: 0.05 }], { gain: g, pan: o.pan ?? 0, send: 0.22, dur: 0.18 });
};
const tick = (bus, rev, t0, o = {}) => {
  const g = o.gain ?? 1;
  tone(bus, rev, t0, [{ f: 2637, a: 0.35, d: 0.05, att: 0.001 }, { f: 5274, a: 0.12, d: 0.03 }, { f: 3951, a: 0.08, d: 0.04 }], { gain: g, pan: o.pan ?? 0.15, send: 0.35, dur: 0.25 });
};
const impact = (bus, rev, t0, o = {}) => {
  const g = o.gain ?? 1;
  tone(bus, rev, t0, [{ f: 78, f1: 36, a: 0.95, d: 0.38, sweep: 0.4, att: 0.003 }, { f: 156, f1: 72, a: 0.25, d: 0.12, sweep: 0.2 }], { gain: g, pan: 0, send: 0.25, dur: 1.2 });
  const rnd = makeRng(21); const i0 = Math.round(t0 * SR), N = Math.round(0.25 * SR); let lp = 0;
  for (let i = 0; i < N; i++) { const t = i / SR; lp += 0.06 * (rnd() - lp); const s = lp * 2.2 * Math.exp(-t / 0.05) * g; bus.add(i0 + i, s, s); rev.add(i0 + i, s * 0.6, s * 0.6); }
};
function riser(bus, rev, t0, { dur = 0.8, gain = 1, seed = 3 }) {
  const rnd = makeRng(seed); const i0 = Math.round(t0 * SR), N = Math.round(dur * SR);
  let low = 0, band = 0, ph = 0;
  for (let i = 0; i < N; i++) {
    const u = i / N;
    const env = Math.pow(u, 2.6) * (u > 0.96 ? (1 - u) / 0.04 : 1);
    const fc = 200 * Math.pow(25, u); const f = 2 * Math.sin(Math.PI * Math.min(fc, 7000) / SR);
    const x = rnd(); const hi = x - low - 0.6 * band; band += f * hi; low += f * band;
    ph += 2 * Math.PI * (220 * Math.pow(4, u)) / SR;
    const s = (band * 0.5 + Math.sin(ph) * 0.05) * env * gain;
    const w = Math.sin(u * Math.PI * 6) * 0.3;
    bus.add(i0 + i, s * (0.8 - w * 0.3), s * (0.8 + w * 0.3)); rev.add(i0 + i, s * 0.3, s * 0.3);
  }
}
const shimmer = (bus, rev, t0, o = {}) => {
  const g = o.gain ?? 1;
  [1318.5, 1760, 2217.5, 2637].forEach((f, k) => tone(bus, rev, t0 + k * 0.045, [{ f, a: 0.12, d: 0.35, att: 0.004 }, { f: f * 2, a: 0.03, d: 0.2 }], { gain: g, pan: (k - 1.5) * 0.35, send: 0.6, dur: 1.0 }));
};

// muziekbed: schone pad met akkoordwissels (Am - F - C - G, 100 bpm) + zachte sub-puls op de tel. Laag blijft leeg voor de whooshes.
function bed(bus, rev, dur, gain) {
  const bpm = 100, beat = 60 / bpm, bar = beat * 4;
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const chords = [[57, 60, 64, 69], [53, 57, 60, 65], [60, 64, 67, 72], [55, 59, 62, 67]];
  const roots = [45, 41, 48, 43];
  const N = Math.round(dur * SR);
  const ph = new Float64Array(16);
  let lpL = 0, lpR = 0, subPh = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const fade = Math.min(1, t / 1.2) * Math.min(1, (dur - t) / 1.0);
    const ci = Math.floor(t / (bar * 2)) % 4, cu = (t % (bar * 2)) / (bar * 2);
    // zachte crossfade rond de akkoordwissel
    const xf = cu > 0.94 ? (cu - 0.94) / 0.06 : 0;
    const nxt = (ci + 1) % 4;
    let l = 0, r = 0;
    for (let v = 0; v < 4; v++) {
      for (const [c, w] of [[ci, 1 - xf], [nxt, xf]]) {
        if (w <= 0) continue;
        const f = mtof(chords[c][v]);
        const k = v * 2 + (c === ci ? 0 : 1);
        ph[k] += 2 * Math.PI * f / SR;
        const sN = Math.sin(ph[k]) + 0.18 * Math.sin(2 * ph[k]);
        const a = 0.05 * w * (0.8 + 0.2 * Math.sin(t * 0.9 + v * 1.7));
        const pan = (v - 1.5) * 0.28;
        l += sN * a * (1 - pan); r += sN * a * (1 + pan);
      }
    }
    lpL += 0.08 * (l - lpL); lpR += 0.08 * (r - lpR);
    // sub-puls: korte ronde tel (geen kick), heel zacht
    const bt = t % beat; const root = mtof(roots[ci] - 12);
    subPh += 2 * Math.PI * root / SR;
    const sub = Math.sin(subPh) * Math.exp(-bt / 0.18) * Math.min(1, bt / 0.01) * 0.05;
    const g = gain * fade;
    bus.add(i, (lpL + sub) * g, (lpR + sub) * g);
    rev.add(i, lpL * g * 0.35, lpR * g * 0.35);
  }
}

// eenvoudige Schroeder-reverb (stereo)
function reverb(rev, bus, wet = 0.22) {
  const combs = [1557, 1617, 1491, 1422, 1277, 1356], ap = [225, 556];
  for (const [src, dst, off] of [[rev.L, bus.L, 0], [rev.R, bus.R, 23]]) {
    const out = new Float32Array(src.length);
    combs.forEach((c) => { const d = Math.round((c + off) * SR / 44100); const buf = new Float32Array(d); let idx = 0, lp = 0;
      for (let i = 0; i < src.length; i++) { const y = buf[idx]; lp = y * 0.62 + lp * 0.38; buf[idx] = src[i] + lp * 0.8; idx = (idx + 1) % d; out[i] += y; } });
    ap.forEach((a) => { const d = Math.round((a + off) * SR / 44100); const buf = new Float32Array(d); let idx = 0;
      for (let i = 0; i < src.length; i++) { const bo = buf[idx]; const x = out[i]; const y = -x + bo; buf[idx] = x + bo * 0.5; idx = (idx + 1) % d; out[i] = y; } });
    for (let i = 0; i < src.length; i++) dst[i] += out[i] * wet / combs.length;
  }
}

// Whooshes afleiden uit de bewegingsanalyse: pieken in schermsnelheid
function whooshesFromMotion(motion, fps, explicit, ST = STYLES.studio) {
  const v = motion.map((m) => m.speed);
  const out = [];
  const TH = ST.th;
  for (let i = 1; i < v.length - 1; i++) {
    if (v[i] < TH || v[i] < v[i - 1] || v[i] < v[i + 1]) continue;
    // breedte van de piek
    let a = i, b = i; while (a > 0 && v[a] > v[i] * 0.35) a--; while (b < v.length - 1 && v[b] > v[i] * 0.35) b++;
    const t = i / fps;
    if (out.length && t - out[out.length - 1].t < ST.gap) { if (v[i] > out[out.length - 1].peak) out[out.length - 1] = { t, peak: v[i], a, b, dx: motion[i].dx }; continue; }
    out.push({ t, peak: v[i], a, b, dx: motion[i].dx });
  }
  return out.filter((w) => !explicit.some((e) => e.type === 'whoosh' && Math.abs(e.t - w.t) < 0.25)).map((w, k) => ({
    t: w.t, type: 'whoosh', dur: Math.max(0.28, Math.min(1.0, (w.b - w.a) / fps * 1.3)),
    gain: Math.max(0.25, Math.min(0.9, 0.3 + Math.log(w.peak / TH) * 0.28)),
    pan: Math.max(-0.8, Math.min(0.8, -w.dx / 400)), bright: Math.max(0.3, Math.min(0.9, w.peak / 260)), seed: k + 1, auto: true,
  }));
}

// ---------- sample-pakket (echte opnames, CC0) ----------
const path = require('path');
let PACK = null;
function readWav(file) {
  const b = fs.readFileSync(file);
  let o = 12, fmt = null, data = null;
  while (o < b.length - 8) {
    const id = b.toString('ascii', o, o + 4), sz = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(o + 10), sr: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === 'data') data = b.subarray(o + 8, o + 8 + sz);
    o += 8 + sz + (sz & 1);
  }
  const B = fmt.bits / 8, n = Math.floor(data.length / (B * fmt.ch)), L = new Float32Array(n), R = new Float32Array(n);
  const rd = (o) => B === 2 ? data.readInt16LE(o) / 32768 : B === 3 ? ((data.readIntLE(o, 3)) / 8388608) : B === 4 ? data.readFloatLE(o) : (data[o] - 128) / 128;
  for (let i = 0; i < n; i++) { L[i] = rd(i * B * fmt.ch); R[i] = fmt.ch > 1 ? rd(i * B * fmt.ch + B) : L[i]; }
  return { L, R, sr: fmt.sr };
}
const CATS = ['whoosh_short', 'whoosh_mid', 'whoosh_big', 'transition', 'glitch', 'click', 'tick', 'tap', 'pop', 'thud', 'boom', 'shutter'];
const peakOf = (w) => { const win = Math.round(w.sr * 0.02); let best = 0, bi = 0, acc = 0; for (let i = 0; i < w.L.length; i++) { acc += Math.abs(w.L[i]) + Math.abs(w.R[i]); if (i >= win) acc -= Math.abs(w.L[i - win]) + Math.abs(w.R[i - win]); if (acc > best) { best = acc; bi = i - win / 2; } } return Math.max(0, bi) / w.sr; };
// Eigen geluiden: settings.json "sfxDir" (of <captures>/_sfx) met submappen per soort (whoosh_short, whoosh_mid, whoosh_big, transition, click, ...), .wav-bestanden.
// Ontbrekende soorten komen uit het meegeleverde pakket.
let PACK_DIR = null;
function setSfxDir(d) { if (d !== PACK_DIR) { PACK_DIR = d; PACK = null; } }
function loadPack() {
  if (PACK !== null) return PACK;
  PACK = {};
  try {
    const dir = path.join(__dirname, '..', 'sfx');
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8'));
    for (const [c, list] of Object.entries(meta)) PACK[c] = list.map((m) => ({ ...m, ...readWav(path.join(dir, m.file)) }));
  } catch (e) {}
  if (PACK_DIR && fs.existsSync(PACK_DIR)) {
    for (const c of CATS) {
      const d = path.join(PACK_DIR, c); if (!fs.existsSync(d)) continue;
      const list = fs.readdirSync(d).filter((f) => /\.wav$/i.test(f)).map((f) => { try { const w = readWav(path.join(d, f)); return { file: f, ...w, peak: peakOf(w) }; } catch (e) { return null; } }).filter(Boolean);
      if (list.length) PACK[c] = list;
    }
  }
  if (!Object.keys(PACK).length) PACK = false;
  return PACK;
}
// kiest per soort steeds een ander bestand (geschud, geen herhaling achter elkaar)
function picker(seed) {
  const rnd = makeRng(seed * 31 + 7), bags = {}, last = {};
  return (cat) => {
    const list = PACK[cat]; if (!list || !list.length) return null;
    if (!bags[cat] || !bags[cat].length) { bags[cat] = list.map((_, i) => i).sort(() => rnd()); if (bags[cat][0] === last[cat] && bags[cat].length > 1) bags[cat].push(bags[cat].shift()); }
    const i = bags[cat].shift(); last[cat] = i; return list[i];
  };
}
// sample afspelen: 'at' = moment van de piek (align 'peak'), het begin ('start') of het einde ('end')
function play(bus, rev, smp, at, { gain = 1, pan = 0, rate = 1, send = 0.15, align = 'peak', lp = 0, pre = 0, post = 0 } = {}) {
  if (!smp) return;
  const r = rate * smp.sr / SR, n = Math.floor(smp.L.length / r);
  const off = align === 'peak' ? smp.peak / rate : align === 'end' ? n / SR : 0;
  const i0 = Math.round((at - off) * SR);
  const [gl, gr] = panLR(pan);
  let fl = 0, fr = 0; const a = lp ? Math.min(1, 2 * Math.PI * lp / SR) : 1;
  // optioneel venster rond het uitlijnpunt (korter maken zonder harde knip)
  const pc = Math.round(off * SR), ws = pre ? Math.max(0, pc - Math.round(pre * SR)) : 0, we = post ? Math.min(n, pc + Math.round(post * SR)) : n;
  const fin = Math.max(1, Math.round((pre || 0.01) * SR * 0.5)), fout = Math.max(1, Math.round((post || 0.02) * SR * 0.6));
  for (let i = ws; i < we; i++) {
    const wg = (pre ? Math.min(1, (i - ws) / fin) : 1) * (post ? Math.min(1, (we - i) / fout) : 1);
    const x = i * r, k = Math.floor(x), u = x - k;
    const k1 = Math.min(k + 1, smp.L.length - 1);
    let l = smp.L[k] + (smp.L[k1] - smp.L[k]) * u, rr = smp.R[k] + (smp.R[k1] - smp.R[k]) * u;
    if (lp) { fl += a * (l - fl); fr += a * (rr - fr); l = fl; rr = fr; }
    const L = l * gain * gl * 1.41 * wg, R = rr * gain * gr * 1.41 * wg;
    bus.add(i0 + i, L, R);
    if (send) rev.add(i0 + i, L * send, R * send);
  }
}
// sample-gebaseerde versies van de events: laag + hoog gelaagd, variatie in toonhoogte, logische uitlijning
function sampleEvent(bus, rev, e, pick, rnd, ST, state) {
  const g = e.gain ?? 1, pan = e.pan ?? 0, vr = () => 1 + (rnd() - 0.5) * 0.08;
  switch (e.type) {
    case 'whoosh': {
      const dur = e.dur || 0.6;
      if (state.lastHit && Math.abs(e.t - state.lastHit) < 0.35) return; // transitie vult dit moment al
      const cat = dur < 0.55 ? 'whoosh_short' : dur < 1.1 ? (rnd() < 0.5 ? 'whoosh_mid' : 'whoosh_short') : 'whoosh_big';
      const smp = pick(cat); if (!smp) return;
      // lengte een beetje aanpassen aan de beweging (sneller afspelen = korter en hoger)
      const want = Math.max(0.35, dur * 1.1), have = Math.min(smp.dur, smp.peak * 2 + 0.2);
      const rate = Math.max(0.88, Math.min(1.25, have / want)) * vr();
      play(bus, rev, smp, e.t, { gain: g * 0.9, pan: pan * 0.6, rate, send: ST.send * 0.6 });
      break;
    }
    case 'click': play(bus, rev, pick('click'), e.t, { gain: g * 0.95, pan: pan || 0.06, rate: vr(), send: 0.04 }); break;
    case 'tap': play(bus, rev, pick('tap'), e.t, { gain: g * 0.8, pan, rate: vr(), send: 0.05 }); break;
    case 'tick': play(bus, rev, pick('tick'), e.t, { gain: g * 0.5, pan: pan || 0.15, rate: 1.1 * vr(), send: 0.08 }); break;
    case 'pop': play(bus, rev, pick('pop'), e.t, { gain: g * 0.55, pan, rate: vr(), send: 0.15 }); break;
    case 'riser': { // lange transitie die precies op het klapmoment piekt
      const hit = e.t + (e.dur || 0.6);
      play(bus, rev, pick('transition'), hit, { gain: g * 0.85, pan: 0, rate: vr(), send: ST.send * 0.5, pre: Math.max(0.5, (e.dur || 0.6) + 0.3), post: 1.2 });
      state.lastHit = hit;
      break;
    }
    case 'impact': // klap zit al in de transitie? dan alleen een zachte doffe laag eronder
      if (state.lastHit && Math.abs(state.lastHit - e.t) < 0.3) { play(bus, rev, pick('thud'), e.t, { gain: g * 0.35, rate: vr(), send: 0.1 }); break; }
      play(bus, rev, pick(rnd() < 0.5 ? 'boom' : 'thud'), e.t, { gain: g * 0.7, rate: vr(), send: 0.2 });
      break;
    case 'shutter': play(bus, rev, pick('shutter'), e.t, { gain: g * 0.75, pan: pan || -0.1, rate: vr(), send: 0.08, align: 'start' }); break;
    case 'shimmer': play(bus, rev, pick('glitch'), e.t, { gain: g * 0.3, pan: 0.2, rate: vr(), send: 0.3, post: 0.5 }); break;
  }
}

// geluidsstijlen: studio = strak met diepte, cinematic = groter (meer sub, langere galm), minimal = alleen klikjes en zachte whooshes
const STYLES = {
  studio: { depth: 1, width: 1, send: 0.2, wet: 0.2, th: 48, gap: 0.6, impact: 0.8, accent: 1 },
  cinematic: { depth: 1.6, width: 1.2, send: 0.32, wet: 0.3, th: 42, gap: 0.45, impact: 1.1, accent: 1 },
  minimal: { depth: 0.7, width: 0.8, send: 0.12, wet: 0.14, th: 65, gap: 0.9, impact: 0, accent: 0.5 },
};

function renderAudio(tl, motion, fps, outWav, opts = {}) {
  const R = tl.render || {};
  const mode = R.sound || 'full';
  const vol = R.volume ?? 1;
  const ST = STYLES[R.soundStyle] || STYLES.studio;
  const lv = (k) => Math.max(0, Math.min(2, R[k] ?? 1));
  const LV = { whoosh: lv('sfxWhoosh'), click: lv('sfxClick'), shutter: lv('sfxClick'), tap: lv('sfxClick'), pop: lv('sfxAccent') * ST.accent, tick: lv('sfxAccent') * ST.accent, shimmer: lv('sfxAccent') * ST.accent, impact: lv('sfxImpact') * ST.impact, riser: lv('sfxImpact') * ST.impact };
  const dur = tl.duration + 1.5;
  const bus = new Bus(dur), rev = new Bus(dur);
  const events = [...(tl.sfx || [])];
  if (motion && motion.length) events.push(...whooshesFromMotion(motion, fps, events, ST));
  events.sort((a, b) => a.t - b.t);
  // opschonen: niet twee keer hetzelfde geluid vlak na elkaar, whooshes niet op elkaar stapelen
  const MINGAP = { shutter: 0.3, whoosh: ST.gap * 0.8, tick: 0.35, pop: 0.18, click: 0.2, tap: 0.2, impact: 0.8, riser: 1.2, shimmer: 1.5 };
  const lastAt = {};
  for (let i = 0; i < events.length; i++) {
    const e = events[i], lt = lastAt[e.type];
    if (lt && e.t - lt.t < (MINGAP[e.type] || 0.2)) { if (e.type === 'whoosh' && (e.gain ?? 1) > (lt.gain ?? 1) && lt.auto) { lt.drop = true; lastAt[e.type] = e; } else e.drop = true; continue; }
    lastAt[e.type] = e;
  }
  for (let i = events.length - 1; i >= 0; i--) if (events[i].drop) events.splice(i, 1);
  const useSamples = R.soundEngine !== 'synth' && loadPack();
  const pick = useSamples ? picker(opts.seed || 1) : null, prnd = makeRng(77), sstate = {};
  if (mode !== 'off') {
    events.forEach((e, k) => {
      const g = LV[e.type] ?? 1;
      if (g <= 0.001) return;
      const o = { ...e, seed: e.seed || k + 1, gain: (e.gain ?? 1) * g };
      if (useSamples) { sampleEvent(bus, rev, o, pick, () => (prnd() + 1) / 2, ST, sstate); return; }
      if (e.type === 'whoosh') whoosh(bus, rev, e.t, { ...o, depth: ST.depth, width: ST.width, send: ST.send });
      else if (e.type === 'click' || e.type === 'shutter') click(bus, rev, e.t, o);
      else if (e.type === 'tap') tap(bus, rev, e.t, o);
      else if (e.type === 'pop') pop(bus, rev, e.t, o);
      else if (e.type === 'tick') tick(bus, rev, e.t, o);
      else if (e.type === 'impact') impact(bus, rev, e.t, o);
      else if (e.type === 'riser') riser(bus, rev, e.t, o);
      else if (e.type === 'shimmer') shimmer(bus, rev, e.t, o);
    });
    if (mode === 'full' && lv('music') > 0) bed(bus, rev, tl.duration, 0.32 * lv('music'));
  }
  reverb(rev, bus, ST.wet);
  // subsonisch weg (strak laag)
  for (const ch of [bus.L, bus.R]) { let y = 0, x1 = 0; const a = 0.9967; for (let i = 0; i < ch.length; i++) { const x = ch[i]; y = a * (y + x - x1); x1 = x; ch[i] = y; } }
  // master: normaliseren + zachte limiter
  let peak = 1e-6;
  for (let i = 0; i < bus.n; i++) peak = Math.max(peak, Math.abs(bus.L[i]), Math.abs(bus.R[i]));
  const pre = 1.15 / peak;
  const lim = (x) => Math.tanh(x * 1.1) / Math.tanh(1.1);
  const n = Math.round(tl.duration * SR);
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  const outGain = 0.89 * Math.max(0, Math.min(1.5, vol));
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, (n - i) / (SR * 0.05));
    const l = lim(bus.L[i] * pre) * outGain * fade, r = lim(bus.R[i] * pre) * outGain * fade;
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(l * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(r * 32767))), 46 + i * 4);
  }
  fs.writeFileSync(outWav, buf);
  return { events: events.length, file: outWav };
}

module.exports = { renderAudio, whooshesFromMotion, STYLES, setSfxDir };
