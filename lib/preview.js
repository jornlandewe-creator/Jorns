// Lokale preview-render: maakt zonder API een cinematic MP4 uit de capture.
// Frame-exact (virtuele tijd): elke frame wordt apart gerenderd, dus altijd vloeiend,
// ook op een trage computer. Motion blur via subframes (tmix).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const { planShots, writeDirectorBrief } = require('./director');
const { ffmpegPath, run, mkdir, log } = require('./util');

const W = 1920, H = 1080, K = 0.8; // K = schaal waarop een websitevlak "volledig in beeld" staat

async function avgColor(file, x, y, w, h) {
  return new Promise((resolve) => {
    const args = ['-v', 'error', '-i', file, '-vf', `crop=${Math.max(2, Math.round(w))}:${Math.max(2, Math.round(h))}:${Math.max(0, Math.round(x))}:${Math.max(0, Math.round(y))},scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'];
    const p = spawn(ffmpegPath(), args);
    const bufs = [];
    p.stdout.on('data', (d) => bufs.push(d));
    p.on('close', () => { const b = Buffer.concat(bufs); resolve(b.length >= 3 ? `rgb(${b[0]},${b[1]},${b[2]})` : '#111'); });
    p.on('error', () => resolve('#111'));
  });
}

async function extractFrames(clipFile, dir, fps) {
  mkdir(dir);
  await run(ffmpegPath(), ['-y', '-v', 'error', '-i', clipFile, '-vf', `fps=${fps}`, '-q:v', '2', path.join(dir, '%05d.jpg')]);
  return fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).length;
}

// ---------- timeline helpers ----------
const DEF = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, s: K, o: 1, blur: 0, ox: W / 2, oy: H / 2 };
const CENTER = { ox: W / 2, oy: H / 2 };
function focus(p, S, extra = {}) {
  if (!p) return { x: 0, y: 0, s: S, ...CENTER, ...extra };
  const tall = p.h > 300; // kaarten: iets onder het midden, zodat titel en prijs in beeld blijven
  return { x: 0, y: 0, ox: p.x + p.w / 2, oy: Math.min(H - 60, p.y + p.h * (tall ? 0.62 : 0.5)), s: S, ...extra };
}
function layer(id, type, extra) { return { id, type, kfs: [], ...extra }; }
function kf(L, t, props, ease = 'inout') { L.kfs.push({ t: +t.toFixed(3), ease, ...props }); return L; }
function normalize(L) {
  L.kfs.sort((a, b) => a.t - b.t);
  let prev = { ...DEF };
  L.kfs = L.kfs.map((k) => { const n = { ...prev, ...k }; prev = n; return n; });
  return L;
}

function buildTimeline(shots, assets) {
  const layers = [];
  const color = layer('fill', 'color', { color: '#000' });
  kf(color, 0, { o: 0 });
  let T = 0.15;
  let prevKind = null;
  let prevColorOut = null;

  for (const sh of shots) {
    if (sh.kind === 'establish') {
      const a = assets[sh.clip ? 'clip' + sh.clip.clip : 'still' + sh.still.no];
      const dur = 2.9;
      const keyLocal = 2.05;
      const c0 = sh.clip ? Math.max(0, (sh.key || 1.6) - keyLocal) : 0;
      const L = layer('s-establish', a.type, { src: a.src, frames: a.frames, map: sh.clip ? { t0: T, c0, rate: 1 } : null });
      kf(L, T, { z: -2600, x: 420, y: 90, ry: -36, rx: 13, o: 0 });
      kf(L, T + 0.35, { o: 1 }, 'out');
      kf(L, T + 1.35, { z: -240, x: 70, y: 12, ry: -9, rx: 3 }, 'ramp');
      kf(L, T + 2.2, { z: 0, x: 0, y: 0, ry: 0, rx: 0 }, 'outSoft');
      if (sh.focus) kf(L, T + 2.6, focus(sh.focus, K * 1.3), 'inout');
      kf(L, T + dur, { x: (sh.focus ? -2900 : -2700), ry: 24, blur: 16 }, 'in');
      layers.push(L);
      T += dur - 0.3;
    } else if (sh.kind === 'interaction') {
      const a = assets['clip' + sh.clip.clip];
      const dur = 3.5;
      const keyLocal = 1.1;
      const c0 = Math.max(0, (sh.key || 1.5) - keyLocal);
      const L = layer('s-interaction', 'clip', { frames: a.frames, map: { t0: T, c0, rate: 1 } });
      const S = 2.0;
      kf(L, T, focus(sh.focus, S, { ry: -22, rx: 4, blur: 16, o: 1 }));
      L.kfs[L.kfs.length - 1].x += 2900;
      kf(L, T + 0.38, focus(sh.focus, S, { ry: -7, rx: 2, blur: 0 }), 'out');
      kf(L, T + keyLocal, focus(sh.focus, S * 1.12, { ry: -4 }), 'inout');
      kf(L, T + 1.95, { x: 0, y: 0, z: 0, s: K * 1.02, ry: -13, rx: 5, ...CENTER }, 'ramp');
      kf(L, T + 2.95, { s: K * 1.07, ry: -4, rx: 2 }, 'inout');
      kf(L, T + dur, { s: K * 3.4, z: 150, ry: 0, rx: 0, ox: W * 0.3, oy: H * 0.45 }, 'in');
      layers.push(L);
      prevColorOut = { t0: T + dur - 0.38, t1: T + dur, color: a.endColor };
      T += dur;
    } else if (sh.kind === 'detail-sweep') {
      const a = assets['clip' + sh.clip.clip];
      const dur = 3.3;
      const keys = sh.keys && sh.keys.length ? sh.keys : [0.8];
      const pts = sh.points && sh.points.length ? sh.points : [null];
      const firstLocal = 0.75;
      const c0 = Math.max(0, keys[0] - firstLocal);
      const L = layer('s-detail', 'clip', { frames: a.frames, map: { t0: T, c0, rate: 1 } });
      const S = 1.22;
      kf(L, T, focus(pts[0], S * 1.3, { ry: 26, rx: 11, z: 0, o: 1, blur: 0 }));
      kf(L, T + 0.55, focus(pts[0], S, { ry: 20, rx: 9 }), 'out');
      let last = T + 0.55;
      keys.slice(1).forEach((k, i) => {
        const lt = T + firstLocal + (k - keys[0]);
        if (lt > last + 0.3 && lt < T + dur - 0.55 && pts[i + 1]) {
          kf(L, lt, focus(pts[i + 1], S, { ry: 20 - (i + 1) * 7, rx: 9 - (i + 1) * 2 }), 'ramp');
          last = lt;
        }
      });
      kf(L, T + dur - 0.35, {}, 'linear');
      kf(L, T + dur, { x: -3200, ry: -48, z: 380, blur: 10 }, 'in');
      if (prevColorOut) {
        kf(color, prevColorOut.t0, { o: 0, color: prevColorOut.color }, 'linear');
        kf(color, prevColorOut.t1, { o: 1, color: prevColorOut.color }, 'in');
        kf(color, T + 0.4, { o: 0, color: prevColorOut.color }, 'out');
        prevColorOut = null;
      }
      layers.push(L);
      T += dur - 0.35;
    } else if (sh.kind === 'depth') {
      const a = assets['clip' + sh.clip.clip];
      const dur = 3.0;
      const rate = Math.min(1.6, Math.max(1, (sh.clip.duration_s - 0.4) / dur));
      const L = layer('s-depth', 'clip', { frames: a.frames, map: { t0: T, c0: 0.2, rate } });
      kf(L, T, { z: -1600, x: 260, y: -40, ry: 18, rx: -13, o: 1 });
      kf(L, T + 0.85, { z: -110, x: 0, y: 0, ry: 11, rx: -6 }, 'ramp');
      kf(L, T + 2.45, { z: -40, ry: -13, rx: -3 }, 'inout');
      kf(L, T + dur, { z: -2800, ry: -26, o: 0 }, 'in');
      layers.push(L);
      T += dur - 0.35;
    } else if (sh.kind === 'fly-through') {
      const n = sh.stills.length;
      const offs = [{ x: -640, y: -110, ry: 20, rx: 4 }, { x: 600, y: 150, ry: -18, rx: -4 }, { x: 0, y: 0, ry: 0, rx: 0 }];
      sh.stills.forEach((s, i) => {
        const a = assets['still' + s.no];
        const L = layer('s-fly' + i, 'still', { src: a.src });
        const o = offs[n === 2 ? i + 1 : i];
        const isLast = i === n - 1;
        const z0 = -2400 - i * 1500;
        kf(L, T, { z: z0, x: o.x, y: o.y, ry: o.ry, rx: o.rx, o: 0 });
        kf(L, T + 0.3, { o: 1 }, 'out');
        if (!isLast) {
          const tEnd = T + 1.2 + i * 0.55;
          kf(L, tEnd - 0.18, { z: 700, o: 1 }, 'inQuad');
          kf(L, tEnd, { z: 1300, o: 0 }, 'linear');
        } else {
          kf(L, T + 2.1, { z: -60, x: 0, y: 0, ry: 0, rx: 0 }, 'out');
          kf(L, T + 2.75, { z: 0, s: K * 1.03 }, 'linear');
          kf(L, T + 3.05, { z: -2000, o: 0, ry: -14 }, 'in');
        }
        layers.push(L);
      });
      T += 2.8;
    } else if (sh.kind === 'brand-resolve') {
      const dur = 2.4;
      if (sh.logo && assets.logo) {
        const L = layer('s-logo', 'logo', { ...assets.logo });
        kf(L, T, { z: -700, s: 0.9, o: 0, blur: 18 });
        kf(L, T + 0.85, { z: 0, s: 1, o: 1, blur: 0 }, 'outSoft');
        kf(L, T + dur - 0.25, { z: 90, s: 1 }, 'linear');
        kf(L, T + dur, { o: 0 }, 'inout');
        layers.push(L);
      }
      kf(color, T + dur - 0.3, { o: 0, color: '#000' }, 'linear');
      kf(color, T + dur, { o: 1, color: '#000' }, 'inout');
      T += dur;
    }
    prevKind = sh.kind;
  }
  layers.forEach(normalize);
  normalize(color);
  // kleur-laag: kleur niet interpoleren, laatste waarde met o>0 geldt
  layers.push(color);
  return { layers, duration: +(T + 0.05).toFixed(2) };
}

// ---------- in-page renderer ----------
const PAGE_HTML = (tl) => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#0b0a09}
#stage{position:absolute;inset:0;perspective:2100px;perspective-origin:50% 46%;overflow:hidden;
 background:radial-gradient(ellipse 70% 60% at 50% 42%,#2e2a26 0%,#171513 55%,#090807 100%)}
#floor{position:absolute;left:-10%;right:-10%;bottom:-8%;height:46%;background:radial-gradient(ellipse 50% 40% at 50% 20%,rgba(255,236,210,.07),transparent 70%)}
.layer{position:absolute;left:0;top:0;transform-style:flat;will-change:transform,opacity,filter;backface-visibility:hidden}
.plane{width:${W}px;height:${H}px;border-radius:22px;overflow:hidden;background:#111;
 box-shadow:0 90px 160px -40px rgba(0,0,0,.85),0 30px 60px -20px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.05)}
.plane img{width:100%;height:100%;display:block;object-fit:cover}
.sheen{position:absolute;inset:0;pointer-events:none;background:linear-gradient(112deg,transparent 35%,rgba(255,255,255,.10) 48%,rgba(255,255,255,.03) 55%,transparent 65%);background-size:260% 100%;mix-blend-mode:screen}
.logo-card{border-radius:30px;box-shadow:0 90px 160px -40px rgba(0,0,0,.85);display:grid;place-items:center}
#fill{position:absolute;inset:0;opacity:0}
#vig{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 85% 75% at 50% 50%,transparent 55%,rgba(0,0,0,.55) 100%)}
#grain{position:absolute;inset:0;width:100%;height:100%;opacity:.07;mix-blend-mode:overlay;pointer-events:none}
</style></head><body><div id="stage"><div id="floor"></div></div><div id="fill"></div><div id="vig"></div><canvas id="grain" width="480" height="270"></canvas>
<script>
const TL=${JSON.stringify(tl)};
const FPS_CLIP=${30};
function bez(x1,y1,x2,y2){return t=>{if(t<=0)return 0;if(t>=1)return 1;let a=0,b=1,u=t;for(let i=0;i<30;i++){u=(a+b)/2;const x=3*(1-u)*(1-u)*u*x1+3*(1-u)*u*u*x2+u*u*u;if(x<t)a=u;else b=u}return 3*(1-u)*(1-u)*u*y1+3*(1-u)*u*u*y2+u*u*u}}
const E={linear:t=>t,inout:bez(.65,0,.35,1),out:bez(.16,1,.3,1),outSoft:bez(.22,1,.36,1),in:bez(.7,0,.84,0),inQuad:bez(.55,0,1,.45),ramp:bez(.83,0,.17,1)};
const P=['x','y','z','rx','ry','rz','s','o','blur','ox','oy'];
const stage=document.getElementById('stage');
const els={};
for(const L of TL.layers){
  if(L.type==='color'){els[L.id]=document.getElementById('fill');continue}
  const d=document.createElement('div');d.className='layer';
  if(L.type==='logo'){
    d.style.left=((${W}-L.iw)/2)+'px';d.style.top=((${H}-L.ih)/2)+'px';d._box=[(${W}-L.iw)/2,(${H}-L.ih)/2,L.iw,L.ih];
    const c=document.createElement('div');c.className='logo-card';c.style.cssText='overflow:hidden;width:'+L.iw+'px;height:'+L.ih+'px;background:url('+L.src+') no-repeat;background-size:'+L.bw+'px '+L.bh+'px;background-position:'+(-L.bx)+'px '+(-L.by)+'px';
    d.appendChild(c);
  } else {
    const p=document.createElement('div');p.className='plane';const im=document.createElement('img');if(L.src)im.src=L.src;p.appendChild(im);
    const sh=document.createElement('div');sh.className='sheen';p.appendChild(sh);d.appendChild(p);d._img=im;d._sheen=sh;
  }
  d.style.display='none';stage.appendChild(d);els[L.id]=d;
}
function val(L,t){const k=L.kfs;if(t<=k[0].t)return{...k[0],_before:t<k[0].t};if(t>=k[k.length-1].t)return{...k[k.length-1],_after:t>k[k.length-1].t};
  for(let i=1;i<k.length;i++){if(t<=k[i].t){const a=k[i-1],b=k[i];const f=E[b.ease||'inout']((t-a.t)/Math.max(1e-6,b.t-a.t));const o={color:b.color||a.color};for(const p of P)o[p]=a[p]+(b[p]-a[p])*f;return o}}}
let seed=1;function rnd(){seed=(seed*16807)%2147483647;return seed/2147483647}
const g=document.getElementById('grain').getContext('2d');const gd=g.createImageData(480,270);
window.render=async(t,fi)=>{
  const waits=[];
  for(const L of TL.layers){
    const el=els[L.id];const v=val(L,t);
    if(L.type==='color'){el.style.opacity=v.o;el.style.background=v.color||'#000';continue}
    const vis=!v._before&&!v._after&&v.o>0.002 || (v._after&&v.o>0.002&&false);
    if(!vis||v._before||v._after){el.style.display='none';continue}
    el.style.display='block';
    const bx=el._box||[0,0,${W},${H}];const ox=el._box?bx[2]/2:v.ox, oy=el._box?bx[3]/2:v.oy;
    el.style.transformOrigin=ox.toFixed(2)+'px '+oy.toFixed(2)+'px';
    const tx=v.x+${W}/2-(bx[0]+ox), ty=v.y+${H}/2-(bx[1]+oy);
    el.style.transform='translate3d('+tx.toFixed(2)+'px,'+ty.toFixed(2)+'px,'+v.z.toFixed(2)+'px) rotateX('+v.rx.toFixed(3)+'deg) rotateY('+v.ry.toFixed(3)+'deg) rotateZ('+v.rz.toFixed(3)+'deg) scale('+v.s.toFixed(4)+')';
    el.style.opacity=Math.min(1,v.o).toFixed(3);
    el.style.filter=v.blur>0.2?'blur('+v.blur.toFixed(1)+'px)':'none';
    el.style.zIndex=Math.round(5000+v.z);
    if(el._sheen)el._sheen.style.backgroundPosition=(50+v.ry*2.2-v.x/90)+'% 0';
    if(L.type==='clip'){
      const m=L.map;const ct=Math.max(0,m.c0+(t-m.t0)*m.rate);const idx=Math.min(L.frames.count,Math.max(1,Math.floor(ct*FPS_CLIP)+1));
      const src=L.frames.dir+'/'+String(idx).padStart(5,'0')+'.jpg';
      if(el._cur!==src){el._cur=src;el._img.src=src;waits.push(el._img.decode().catch(()=>{}))}
    }
  }
  seed=(fi%24)+7;for(let i=0;i<gd.data.length;i+=4){const n=rnd()*255;gd.data[i]=gd.data[i+1]=gd.data[i+2]=n;gd.data[i+3]=255}g.putImageData(gd,0,0);
  await Promise.all(waits);
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  return true;
};
</script></body></html>`;

async function renderPreview(outDir, cfg = {}) {
  const fps = cfg.previewFps || 30;
  const sub = cfg.previewSubframes || 3;
  const ctx = JSON.parse(fs.readFileSync(path.join(outDir, 'website-reference-context.json'), 'utf8'));
  const pdir = path.join(outDir, 'preview');
  const work = path.join(pdir, '_work');
  mkdir(work);
  const shots = planShots(ctx);
  writeDirectorBrief(outDir, ctx, shots);

  // assets
  const assets = {};
  for (const sh of shots) {
    const clipsNeeded = sh.clip ? [sh.clip] : [];
    for (const c of clipsNeeded) {
      const key = 'clip' + c.clip;
      if (assets[key]) continue;
      const dir = path.join(work, key);
      const count = await extractFrames(path.join(outDir, c.file), dir, 30);
      const lastFrame = path.join(dir, String(count).padStart(5, '0') + '.jpg');
      assets[key] = { type: 'clip', frames: { dir: '_work/' + key, count }, endColor: await avgColor(lastFrame, 700, 200, 900, 700) };
    }
    if (sh.still) assets['still' + sh.still.no] = { type: 'still', src: '../' + sh.still.clean };
    if (sh.stills) sh.stills.forEach((s) => (assets['still' + s.no] = { type: 'still', src: '../' + s.clean }));
    if (sh.logo) {
      const r = sh.logo.tag.rect;
      const px = Math.min(70, r.x), py = Math.min(24, r.y);
      const cx = r.x - px, cy = r.y - py, cw = r.w + px * 2, ch = r.h + py * 2;
      const sc = Math.min(3.4, 780 / cw);
      const file = path.join(outDir, sh.logo.still.clean);
      assets.logo = { src: '../' + sh.logo.still.clean, iw: Math.round(cw * sc), ih: Math.round(ch * sc), bw: Math.round(1920 * sc), bh: Math.round(1080 * sc), bx: Math.round(cx * sc), by: Math.round(cy * sc), cw: Math.round(cw * sc + 200), ch: Math.round(ch * sc + 170), bg: await avgColor(file, Math.max(0, r.x - 12), r.y + r.h / 2 - 3, 8, 6) };
    }
  }
  const tl = buildTimeline(shots, assets);
  fs.writeFileSync(path.join(pdir, 'timeline.json'), JSON.stringify({ shots: shots.map((s) => ({ kind: s.kind, clip: s.clip && s.clip.file, stills: s.stills && s.stills.map((x) => x.no), why: s.why })), ...tl }, null, 1));
  const htmlFile = path.join(pdir, 'composition.html');
  fs.writeFileSync(htmlFile, PAGE_HTML(tl));

  const launchOpts = { headless: true, args: ['--allow-file-access-from-files', '--force-color-profile=srgb', '--hide-scrollbars'] };
  if (process.env.CHROME_PATH) { launchOpts.executablePath = process.env.CHROME_PATH; launchOpts.args.push('--no-sandbox', '--no-zygote', '--use-gl=angle', '--use-angle=swiftshader'); }
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.goto('file://' + htmlFile);
  await page.waitForFunction(() => typeof window.render === 'function');

  const outFile = path.join(pdir, 'PREVIEW.mp4');
  const total = Math.round(tl.duration * fps * sub);
  const ff = spawn(ffmpegPath(), ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(fps * sub), '-c:v', 'mjpeg', '-i', '-',
    '-vf', `tmix=frames=${sub},select=not(mod(n\\,${sub})),setpts=N/${fps}/TB,format=yuv420p`, '-r', String(fps), '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-movflags', '+faststart', outFile], { stdio: ['pipe', 'ignore', 'pipe'] });
  let ferr = '';
  ff.stderr.on('data', (d) => (ferr += d));
  const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg: ' + ferr.slice(-800))))));
  const t0 = Date.now();
  for (let i = 0; i < total; i++) {
    const t = i / (fps * sub);
    await page.evaluate(([t, i]) => window.render(t, i), [t, Math.floor(i / sub)]);
    const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % (fps * sub) === 0) log(`  preview ${Math.round((i / total) * 100)}% (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  ff.stdin.end();
  await done;
  await browser.close();
  if (!cfg.keepWork) fs.rmSync(work, { recursive: true, force: true });
  return { file: outFile, duration: tl.duration, shots: shots.map((s) => s.kind) };
}

module.exports = { renderPreview };
