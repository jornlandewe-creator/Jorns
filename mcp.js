#!/usr/bin/env node
// MCP-server voor Claude Desktop (geen API-key nodig; alles draait lokaal).
// Claude kan hiermee websites vastleggen, per video een eigen edit regisseren (shots, hoeken, apparaat, volgorde),
// previews en varianten bekijken, een final pass (QA) doen en renderen.
// Zware taken (capture, voorbereiden, render) draaien als losse processen met statusbestanden.
// stdout is voor het MCP-protocol: alle logging gaat naar stderr.
console.log = (...a) => console.error(...a);

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const OUT_DEFAULT = path.join(os.homedir(), 'Desktop', 'Website Captures');
let OUT = process.env.WMC_OUT;
if (!OUT) { try { OUT = JSON.parse(fs.readFileSync(path.join(__dirname, 'settings.json'), 'utf8')).out; } catch (e) {} }
OUT = OUT || OUT_DEFAULT;

async function selftest() {
  const ok = (m) => console.error('OK   ' + m), bad = (m) => { console.error('FOUT ' + m); process.exitCode = 1; };
  console.error(`Website Motion Studio ${require('./package.json').version} · Node ${process.version} · map ${OUT} · code ${__dirname}`);
  try { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, '.write-test'), 'x'); fs.rmSync(path.join(OUT, '.write-test')); ok('map schrijfbaar'); } catch (e) { bad('map niet schrijfbaar: ' + e.message); }
  try { require('@modelcontextprotocol/sdk/server/mcp.js'); ok('MCP SDK'); } catch (e) { bad('MCP SDK ontbreekt (npm install)'); }
  try { require('sharp'); ok('sharp'); } catch (e) { bad('sharp ontbreekt (npm install)'); }
  try { const { ffmpegPath } = require('./lib/util'); const p = ffmpegPath(); await new Promise((r, j) => { const x = spawn(p, ['-version']); x.on('close', (c) => (c === 0 ? r() : j(new Error('exit ' + c)))); x.on('error', j); }); ok('ffmpeg: ' + p); } catch (e) { bad('ffmpeg werkt niet: ' + e.message); }
  try { const { chromium } = require('playwright'); const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] } : {}); await b.close(); ok('Chromium'); } catch (e) { bad('Chromium start niet (npx playwright install chromium): ' + e.message.split('\n')[0]); }
  console.error(process.exitCode ? '\nNiet alles werkt, zie hierboven.' : '\nAlles werkt.');
}

if (process.argv.includes('--selftest')) {
  selftest();
} else {
  main();
}

function main() {
  const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
  const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
  const { z } = require('zod');
  const sharp = require('sharp');
  const { loadParams } = require('./lib/showcase');
  const TLMOD = require('./lib/showcase-timeline');
  const { Previewer, qaIssues } = require('./lib/previewer');
  const { startJob, readJob } = require('./lib/jobs');

  fs.mkdirSync(OUT, { recursive: true });
  const PV = new Previewer();
  const text = (t) => ({ type: 'text', text: t });
  const img = (buf) => ({ type: 'image', data: buf.toString('base64'), mimeType: 'image/jpeg' });

  function projects() {
    return fs.readdirSync(OUT).filter((d) => fs.existsSync(path.join(OUT, d, 'website-reference-context.json'))).map((d) => {
      const dir = path.join(OUT, d);
      let url = ''; try { url = JSON.parse(fs.readFileSync(path.join(dir, 'website-reference-context.json'), 'utf8')).url; } catch (e) {}
      const sd = path.join(dir, 'showcase');
      const renders = fs.existsSync(sd) ? fs.readdirSync(sd).filter((f) => /^SHOWCASE_.*_\d{8}-\d{6}\.mp4$/.test(f)).sort().reverse() : [];
      return { project: d, url, modified: fs.statSync(dir).mtime.toISOString(), renders };
    }).sort((a, b) => b.modified.localeCompare(a.modified));
  }
  function projectDir(name) {
    const n = path.basename(String(name || ''));
    const dir = path.join(OUT, n);
    if (!n || !fs.existsSync(path.join(dir, 'website-reference-context.json'))) throw new Error(`Project "${name}" niet gevonden. Gebruik list_projects.`);
    return dir;
  }
  function prepared(dir) {
    try { const a = JSON.parse(fs.readFileSync(path.join(dir, 'showcase', '_assets', 'assets.json'), 'utf8')); return a.v === 22 ? a : null; } catch (e) { return null; }
  }
  function needPrepared(dir) {
    const a = prepared(dir);
    if (a) return { a };
    const jd = path.join(OUT, '.jobs');
    const running = fs.existsSync(jd) && fs.readdirSync(jd).filter((f) => f.endsWith('.json')).map((f) => readJob(OUT, f.replace('.json', ''))).find((j) => j && j.kind === 'prepare' && j.project === path.basename(dir) && ['queued', 'running'].includes(j.status));
    const id = running ? running.id : startJob(OUT, 'prepare', { project: path.basename(dir) });
    return { wait: text(`De beelden van dit project worden eerst voorbereid (job ${id}, 1-4 minuten). Vraag get_job op en probeer het daarna opnieuw.`) };
  }

  async function sheet(frames, { cols, width, labels, rowLabels }) {
    const imgs = await Promise.all(frames.map((f) => sharp(f).resize({ width }).jpeg({ quality: 80 }).toBuffer({ resolveWithObject: true })));
    const h = imgs[0].info.height, lab = 24, rl = rowLabels ? 32 : 0;
    const rows = Math.ceil(imgs.length / cols);
    const W = cols * width + (cols + 1) * 8, H = rows * (h + lab + rl) + 8;
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const comp = [];
    imgs.forEach((im, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      const x = 8 + c * (width + 8), y = 8 + r * (h + lab + rl) + rl;
      comp.push({ input: im.data, left: x, top: y });
      comp.push({ input: Buffer.from(`<svg width="${width}" height="${lab}"><text x="2" y="17" font-family="Helvetica, Arial" font-size="14" fill="#ddd">${esc(labels[i])}</text></svg>`), left: x, top: y + h + 2 });
      if (rowLabels && c === 0) comp.push({ input: Buffer.from(`<svg width="${W - 16}" height="${rl}"><text x="2" y="22" font-family="Helvetica, Arial" font-size="18" font-weight="bold" fill="#ff9a5a">${esc(rowLabels[r])}</text></svg>`), left: 8, top: y - rl });
    });
    return sharp({ create: { width: W, height: H, channels: 3, background: '#111' } }).composite(comp).jpeg({ quality: 78 }).toBuffer();
  }
  const shotAt = (tl, t) => (tl.shots.find((s) => t >= s.start && t <= s.end) || {}).id || '';
  const mids = (tl, per = 1, ids) => { const at = []; tl.shots.filter((s) => !ids || !ids.length || ids.includes(s.id)).forEach((s) => { for (let i = 0; i < per; i++) at.push(+(s.start + (s.end - s.start) * (i + 0.5) / per).toFixed(2)); }); return at; };

  const server = new McpServer({ name: 'website-motion-studio', version: require('./package.json').version }, {
    instructions: `Website Motion Studio: cinematic showcase-video's (standaard 9:16) van echte websites, met sound design. Alles lokaal, geen API.
Werkwijze voor Claude als creative director:
1. capture_website (10-30 min, los proces) en get_job tot status done.
2. get_project: bekijk key features, mogelijke shots en merkkleuren.
3. suggest_edits: drie verschillende edits als beeld + JSON. Kies er een of schrijf zelf een edit (shot-lijst met hoeken) en zet die met set_params.
4. preview voor een snelle blik, daarna review_video als final pass: kijk kritisch naar leeg beeld, rare hoeken, onscherpte, herhaling en ritme. Pas aan en review opnieuw.
5. render_video (los proces) en get_job. Daarna ALTIJD review_render: bekijk de echte MP4 (beelden + bewegingsanalyse), benoem wat niet goed is (hokkerig, te hard heen en weer, focus niet in het midden, te kort om te lezen, onscherp), pas aan met set_params (calm, shotTempo, angle, length) en render opnieuw tot het klopt.
Elke video mag anders zijn: ander openingsshot, andere hoeken, ander apparaat, andere achtergrond; zelfde merk en idee.
describe_options legt alles uit.`,
  });

  server.registerTool('describe_options', { title: 'Uitleg instellingen', description: 'Alle regie-instellingen, shots, hoek-presets, de edit-structuur en geluid.', inputSchema: {} }, async () => {
    const D = TLMOD.DEFAULTS;
    return { content: [text(`EDIT (params.edit): lijst van shots in volgorde. Per shot: { shot, angle?, mirror?, tempo?, clip? }
- shot: ${Object.keys(TLMOD.SHOT_INFO).join(', ')}
- angle: ${Object.keys(TLMOD.ANGLES).join(', ')}
- mirror: true = gespiegelde draairichting
- tempo: 0.7-1.4 per shot (hoger = langzamer)
- clip (alleen phone): 'scroll' of 'menu'
- group (alleen popwall): 0 of 1, welke rij blokken
- media: per plek in het shot de inhoud, bv. { b: { id: 'lib:4' } } voor pagina B van de vlucht, { screen: { id: 'clip:menu' }, phone: { id: 'm:menu' } } bij laptop + telefoon.
  Plekken per shot: ${Object.entries(TLMOD.MEDIA).map(([k, v]) => k + '(' + v.map((x) => x[0]).join('/') + ')').join(', ')}.
  Per plek: id (uit get_project > Inhoud), focus { x: 0-1920, y: 0-1080 } = punt waar de camera op inzoomt, ids = lijst feature-ids in volgorde (alleen features).
  Kies je bij pop-wall, features, kaarten, lagen of float een hele pagina (id lib:...), dan knipt de tool de elementen zelf uit.
- frame: handmatige kadrering van dit shot, bovenop de automatische: { zoom: 0.6-1.6, x: -450..450 (px, + = naar rechts), y: -600..600 (+ = omlaag), tilt: -15..15 graden, auto: false = auto-kadrering uit voor dit shot }
  Gebruik frame in de final pass: te krap of iets valt over de rand -> zoom 0.85-0.9; onderwerp te laag -> y negatief; scheef -> tilt.
Goede opbouw: opener (intro/laptop/phone/devices/features) → wide → close-up (hover/features) → wide → ... → outro. 5-8 shots, 15-25 s. Niet twee keer hetzelfde apparaat achter elkaar.

SHOTS
${Object.entries(TLMOD.SHOT_INFO).map(([k, v]) => `${k}: ${v}`).join('\n')}

LOOK EN BEWEGING (standaard tussen haakjes)
format '9:16'|'4:5'|'1:1' (${D.format}) · tempo 0.6-1.6 (${D.tempo}) · energy 0.2-1.8 (${D.energy}) · tilt 0-1.8 (${D.tilt}) · spin 0-1.8 (${D.spin}) · zoom 0.6-1.5 (${D.zoom})
dof 0-1.6 (${D.dof}) · lift 0-2 (${D.lift}) · hold 0.2-2.2 leestijd (${D.hold}) · ramp 0-1.5 speed ramps + slow-mo op sleutelmomenten (${D.ramp})
bgStyle studio|mesh|aurora|grid|spotlight|solid (${D.bgStyle}) · bg hex (${D.bg}) · bgParallax 0-2.5 (${D.bgParallax}) · reflection spiegeling (${D.reflection}) · watermark logo in achtergrond (${D.watermark}) · cursor (${D.cursor})
motionBlur 0-1.8 (${D.motionBlur}) · grain 0-2.5 (${D.grain}) · grade 0-1.5 filmische kleurcorrectie, alleen render (${D.grade})
AFWERKING (v20): polish 0-1 (${D.polish}) rust voor de cut, geen zigzag in de draai · shadow 0-1.5 grondschaduw (${D.shadow}) · rim 0-1.5 lichte rand langs vlakken (${D.rim}) · sheen 0-1.5 glans/glas (${D.sheen}) · vignette 0-1 (${D.vignette})
AFWERKING EXTRA: drift 0-1.5 levende camera, lichte zweving (${D.drift}) · sweep 0-1.5 lichtstreep per shot (${D.sweep})
TEKST IN BEELD (v20, standaard uit): captions true|false (${D.captions}) · captionStyle clean|bold (${D.captionStyle}). Automatisch: kop van de site (één keer), feature-teksten, 'Navigatie', 'Mobiel', url op het eind. Per shot in de edit: caption: { text, sub?, pos?: 'bl'|'bc'|'tc' } of caption: false.
OVERGANG EN APPARAAT: transition mix|whip|zoom|clean (${D.transition}) · device mix|more (meer laptop, telefoon blijft)|laptop (alles in de laptop) (${D.device})
GELUID: soundEngine samples|synth (${D.soundEngine}) · soundStyle studio|cinematic|minimal (${D.soundStyle}) · niveaus 0-2: sfxWhoosh, sfxClick, sfxAccent, sfxImpact, music
EFFECTEN (aan/uit + sterkte 0-1.5): flash/flashAmt, burn/burnAmt (film burn), leak/leakAmt (light leak), glow/glowAmt, bloom/bloomAmt, chroma/chromaAmt (RGB-split bij snelheid). Ze komen op een deel van de overgangen, afgewisseld.
CAMERA: calm 0-1 camera-rust, minder links/rechts zwaaien (${D.calm}) · autoframe 0-1 zet het focuspunt automatisch in het midden (${D.autoframe})
TIMING: length 0-60 s doelduur (0 = vrij; bij kort eerst minst belangrijke shots eruit, dan vlotter) · shotTempo { hover: 0.7, laptop: 1.2 } duur-factor per shot-type 0.4-1.8
sound 'full' (sfx + muziekbed) | 'fx' (alleen sfx) | 'off' (${D.sound}) · volume 0-1.5 (${D.volume})
Geluid gaat automatisch mee: whooshes op snelle bewegingen, klikjes, tikken, pops, impacts, risers.
variation: getal = automatisch gegenereerde edit (als er geen edit is gezet).`)] };
  });

  server.registerTool('list_projects', { title: 'Projecten', description: 'Vastgelegde websites en hun renders.', inputSchema: {} }, async () => {
    const p = projects();
    if (!p.length) return { content: [text(`Nog geen projecten in ${OUT}. Gebruik capture_website.`)] };
    return { content: [text(`Map: ${OUT}\n` + p.map((x) => `- ${x.project} · ${x.url} · ${x.renders.length} render(s)${x.renders[0] ? ' · laatste: ' + x.renders[0] : ''}`).join('\n'))] };
  });

  server.registerTool('capture_website', {
    title: 'Website vastleggen',
    description: 'Opent de website in een echte browser (desktop + mobiel), test menu, hovers, sliders, scroll, zoekt key features en neemt alles op dubbele resolutie op. Los proces van 10-30 minuten; geeft een job_id. Poll met get_job.',
    inputSchema: { url: z.string(), pages: z.number().int().min(1).max(4).optional().describe("Aantal pagina's (standaard 3)") },
  }, async ({ url, pages }) => {
    if (!/^https?:\/\//.test(url)) url = 'https://' + url;
    const id = startJob(OUT, 'capture', { url, pages: pages || 3 });
    return { content: [text(`Capture gestart voor ${url}. job_id: ${id}. Dit draait los van dit gesprek (10-30 min). Vraag de status op met get_job.`)] };
  });

  server.registerTool('get_job', { title: 'Status job', description: 'Status van een capture-, voorbereid- of render-job.', inputSchema: { job_id: z.string() } }, async ({ job_id }) => {
    const j = readJob(OUT, job_id);
    if (!j) return { content: [text('Onbekende job.')], isError: true };
    const mins = ((Date.now() - j.started) / 60000).toFixed(1);
    let msg = `${j.kind} · ${j.status} · ${j.pct || 0}% · ${mins} min${j.eta ? ` · nog ca. ${Math.ceil(j.eta / 60)} min` : ''}`;
    if (j.project) msg += `\nproject: ${j.project}`;
    if (j.error) msg += `\nfout: ${j.error}`;
    if (j.file) msg += `\nvideo: ${j.file}`;
    msg += '\n\nlog:\n' + (j.log || []).join('\n');
    return { content: [text(msg)] };
  });

  server.registerTool('get_project', {
    title: 'Projectinfo', description: 'Wat er op de site gevonden is: key features, interacties, mogelijke shots, merkkleuren, huidige edit en instellingen.', inputSchema: { project: z.string() },
  }, async ({ project }) => {
    const dir = projectDir(project);
    const pr = needPrepared(dir); if (pr.wait) return { content: [pr.wait] };
    const { A, R } = pr.a;
    const params = loadParams(dir);
    const tl = TLMOD.buildTimeline(A, R, params);
    const ctx = JSON.parse(fs.readFileSync(path.join(dir, 'website-reference-context.json'), 'utf8'));
    const av = TLMOD.available(A, R);
    return { content: [text([
      `Project ${project} · ${ctx.url}`,
      `Merkkleuren: accent ${R.accent}, tweede ${R.accent2}`,
      `Mogelijke shots: ${Object.entries(av).filter(([, v]) => v).map(([k]) => k).join(', ')}`,
      `Niet mogelijk: ${Object.entries(av).filter(([, v]) => !v).map(([k]) => k).join(', ') || '-'}`,
      `Key features: ${(ctx.key_features || []).map((f) => `[${f.kind}] "${f.text.slice(0, 50)}"`).join(' · ') || 'geen'}`,
      `Feature-groepen (pop-wall): ${(ctx.key_feature_groups || []).map((g, i) => `#${i} [${g.kind}] ${g.texts.slice(0, 3).map((t) => '"' + t.slice(0, 30) + '"').join(', ')}`).join(' · ') || 'geen (refind_features)'}`,
      `Clips: ${(ctx.clips || []).map((c) => `${c.type} (${c.duration_s}s)`).join(', ')}`,
      `Inhoud per shot kiezen (edit[i].src / srcs / focus):\n${Object.entries(TLMOD.sources(A, R)).filter(([, l]) => l.length).map(([k, l]) => `  ${k}: ${l.map((x) => x.id + ' = ' + x.label).join(' | ')}`).join('\n')}`,
      `Huidige edit: ${TLMOD.describeEdit(tl.edit)} · ${tl.duration}s`,
      `Huidige params: ${JSON.stringify({ ...params, edit: undefined, order: undefined, shots: undefined })}`,
      (() => { let b = ''; try { b = fs.readFileSync(path.join(dir, 'showcase', 'brief.txt'), 'utf8').trim(); } catch (e) {} return b ? `REGIE-IDEE VAN DE GEBRUIKER (uit de Studio): "${b}"\nVertaal dit naar een edit + instellingen (apply_brief geeft een snelle basis), bekijk met preview en verfijn.` : 'Geen regie-idee in de Studio ingevuld.'; })(),
    ].join('\n'))] };
  });

  server.registerTool('apply_brief', {
    title: 'Regie-idee toepassen',
    description: 'Zet een idee in gewone taal (bv. "rustig, 15 sec, alles in de laptop, crash zoom, geen muziek") om naar instellingen en slaat ze op. Zonder brief: gebruikt het idee uit de Studio. Daarna verfijnen met set_params.',
    inputSchema: { project: z.string(), brief: z.string().optional() },
  }, async ({ project, brief }) => {
    const dir = projectDir(project);
    const pr = needPrepared(dir); if (pr.wait) return { content: [pr.wait] };
    let b = brief; if (!b) { try { b = fs.readFileSync(path.join(dir, 'showcase', 'brief.txt'), 'utf8'); } catch (e) { b = ''; } }
    const r = TLMOD.interpretBrief(b, loadParams(dir), pr.a.A, pr.a.R);
    fs.writeFileSync(path.join(dir, 'showcase', 'params.json'), JSON.stringify(r.params, null, 2));
    const tl = TLMOD.buildTimeline(pr.a.A, pr.a.R, r.params);
    return { content: [text(`Herkend: ${r.notes.join(' · ') || 'niets'}\nEdit: ${TLMOD.describeEdit(tl.edit)} · ${tl.duration}s\nOpgeslagen. Bekijk met preview, verfijn met set_params, render met render_video.`)] };
  });

  server.registerTool('suggest_edits', {
    title: 'Edits voorstellen',
    description: 'Genereert verschillende edits (andere shots, hoeken, apparaat, volgorde en look) en laat ze naast elkaar zien. Elke rij = één edit. Neem de JSON over met set_params, of pas hem aan.',
    inputSchema: { project: z.string(), count: z.number().int().min(1).max(4).optional(), seed: z.number().int().optional().describe('Startgetal; ander getal = andere voorstellen') },
  }, async ({ project, count, seed }) => {
    const dir = projectDir(project);
    const pr = needPrepared(dir); if (pr.wait) return { content: [pr.wait] };
    const { A, R } = pr.a;
    const base = seed || (1 + Math.floor(Math.random() * 900));
    const rows = [], outs = [], per = [];
    let cols = 0;
    for (let i = 0; i < (count || 3); i++) {
      const g = TLMOD.makeEdit(base + i * 37, A, R);
      const params = { ...g.look, edit: g.edit };
      const tl = TLMOD.buildTimeline(A, R, loadParams(dir, params));
      const fr = await PV.frames(dir, tl, mids(tl, 1).slice(0, 8), 70);
      per.push({ fr, tl });
      cols = Math.max(cols, fr.length);
      rows.push(`${i + 1}. ${TLMOD.describeEdit(g.edit)} · ${g.look.bgStyle} · ${tl.duration}s`);
      outs.push({ nr: i + 1, params });
    }
    const blank = await sharp({ create: { width: 540, height: 960, channels: 3, background: '#111' } }).jpeg().toBuffer();
    const files = [], labels = [];
    per.forEach(({ fr, tl }) => { for (let k = 0; k < cols; k++) { files.push(fr[k] ? fr[k].buf : blank); labels.push(fr[k] ? `${shotAt(tl, fr[k].t)} ${fr[k].t.toFixed(1)}s` : ''); } });
    const im = await sheet(files, { cols, width: 150, labels, rowLabels: rows });
    return { content: [text(rows.join('\n') + '\n\nJSON per voorstel (voor set_params):\n' + outs.map((o) => `${o.nr}: ${JSON.stringify(o.params)}`).join('\n')), img(im)] };
  });

  server.registerTool('preview', {
    title: 'Preview', description: 'Snelle stilstaande beelden (contactsheet) van de huidige of tijdelijke instellingen. Slaat niets op.',
    inputSchema: { project: z.string(), params: z.record(z.string(), z.any()).optional(), shots: z.array(z.string()).optional(), per_shot: z.number().int().min(1).max(5).optional() },
  }, async ({ project, params, shots, per_shot }) => {
    const dir = projectDir(project);
    const pr = needPrepared(dir); if (pr.wait) return { content: [pr.wait] };
    const tl = TLMOD.buildTimeline(pr.a.A, pr.a.R, loadParams(dir, params || {}));
    const fr = await PV.frames(dir, tl, mids(tl, per_shot || 2, shots).slice(0, 24), 72);
    const im = await sheet(fr.map((f) => f.buf), { cols: Math.min(6, fr.length), width: 190, labels: fr.map((f) => `${shotAt(tl, f.t)} ${f.t.toFixed(1)}s`) });
    return { content: [text(`Edit: ${TLMOD.describeEdit(tl.edit)} · ${tl.duration}s`), img(im)] };
  });

  server.registerTool('review_video', {
    title: 'Final pass (review)',
    description: 'Kwaliteitscontrole en creatieve review: beelden door de hele video plus automatische checks (leeg beeld, te schuin, te ver ingezoomd). Beoordeel kritisch, pas aan met set_params en review opnieuw voordat je rendert.',
    inputSchema: { project: z.string(), params: z.record(z.string(), z.any()).optional() },
  }, async ({ project, params }) => {
    const dir = projectDir(project);
    const pr = needPrepared(dir); if (pr.wait) return { content: [pr.wait] };
    const tl = TLMOD.buildTimeline(pr.a.A, pr.a.R, loadParams(dir, params || {}));
    const step = Math.max(0.6, tl.duration / 28);
    const times = []; for (let t = 0.3; t < tl.duration; t += step) times.push(+t.toFixed(2));
    const samples = await PV.analyse(dir, tl, 0.1);
    const issues = qaIssues(tl, samples);
    issues.forEach((i) => { const m = +((i.from + i.to) / 2).toFixed(2); if (!times.some((t) => Math.abs(t - m) < 0.2)) times.push(m); });
    times.sort((a, b) => a - b);
    const fr = await PV.frames(dir, tl, times.slice(0, 35), 70);
    const im = await sheet(fr.map((f) => f.buf), { cols: 7, width: 150, labels: fr.map((f) => `${f.t.toFixed(1)}s ${shotAt(tl, f.t)}${issues.some((i) => f.t >= i.from - 0.1 && f.t <= i.to + 0.1) ? ' !' : ''}`) });
    const qa = issues.length ? issues.map((i) => `- ${i.type} in ${i.shot} (${i.from.toFixed(1)}-${i.to.toFixed(1)}s): ${i.detail}`).join('\n') : '- geen automatische problemen gevonden';
    return { content: [text(`Edit: ${TLMOD.describeEdit(tl.edit)} · ${tl.duration}s\nShots: ${tl.shots.map((s) => `${s.id} ${s.start.toFixed(1)}-${s.end.toFixed(1)}s`).join(' · ')}\n\nAutomatische checks:\n${qa}\n\nKijk zelf ook naar: ritme (wide/close-up afwisseling), herhaling van hoeken, leesbaarheid van de key features, kracht van de opener. Tips: te schuin → angle 'default' of 'calm', tilt/spin lager; leeg beeld → zoom hoger of shot korter; onscherp → angle 'wide' of zoom lager.`), img(im)] };
  });

  // Final pass op de echte render: beelden uit de MP4 + bewegingscurve uit de pixels (niet uit de tijdlijn)
  server.registerTool('review_render', {
    title: 'Render bekijken (final clean-up)',
    description: 'Bekijkt een gerenderde MP4: contactsheet met tijden en shotnamen, plus een bewegingsanalyse uit de beelden zelf (hokkerige sprongen, te hard heen en weer, stilstand, flitsen). Gebruik dit na elke render voor de final clean-up.',
    inputSchema: { project: z.string(), file: z.string().optional().describe('Bestandsnaam in showcase/; standaard de nieuwste render'), from: z.number().optional(), to: z.number().optional() },
  }, async ({ project, file, from, to }) => {
    const dir = projectDir(project), sdir = path.join(dir, 'showcase');
    const list = fs.existsSync(sdir) ? fs.readdirSync(sdir).filter((f) => /^SHOWCASE_.*_\d{8}-\d{6}\.mp4$/.test(f)).sort() : [];
    const f = file ? path.basename(file) : list[list.length - 1];
    if (!f || !fs.existsSync(path.join(sdir, f))) return { content: [text('Geen render gevonden. Eerst render_video.')] };
    const src = path.join(sdir, f);
    const { ffmpegPath } = require('./lib/util');
    const grabRaw = (args) => new Promise((res, rej) => { const p = spawn(ffmpegPath(), args); const ch = []; p.stdout.on('data', (d) => ch.push(d)); p.on('close', (c) => (c === 0 ? res(Buffer.concat(ch)) : rej(new Error('ffmpeg ' + c)))); p.on('error', rej); });
    // bewegingscurve: kleine grijze frames, verschil tussen opeenvolgende frames + horizontale verschuiving
    const W = 72, H = 128;
    const raw = await grabRaw(['-v', 'error', '-i', src, '-vf', `fps=30,scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-']);
    const n = Math.floor(raw.length / (W * H));
    const fr = (i) => raw.subarray(i * W * H, (i + 1) * W * H);
    const mot = [], shift = [], lum = [];
    for (let i = 0; i < n; i++) {
      const b = fr(i); let L = 0; for (let k = 0; k < b.length; k++) L += b[k]; lum.push(L / b.length);
      if (!i) { mot.push(0); shift.push(0); continue; }
      const a = fr(i - 1); let d = 0; for (let k = 0; k < b.length; k++) d += Math.abs(b[k] - a[k]); mot.push(d / b.length);
      // horizontale verschuiving: beste match van -8..8 px (op 72 breed)
      let best = 1e9, bx = 0;
      for (let dx = -8; dx <= 8; dx++) { let e = 0; for (let y = 8; y < H - 8; y += 2) for (let x = 10; x < W - 10; x += 2) e += Math.abs(b[y * W + x] - a[y * W + x - dx]); if (e < best) { best = e; bx = dx; } }
      shift.push(bx);
    }
    const tl = (() => { for (const j of [src.replace(/\.mp4$/, '.timeline.json'), path.join(sdir, 'timeline.json')]) { try { return JSON.parse(fs.readFileSync(j, 'utf8')); } catch (e) {} } return null; })();
    const shotName = (t) => (tl ? shotAt(tl, t) : '');
    const notes = [];
    // hokkerig: plotselinge sprong in bewegingshoeveelheid (versnelling) buiten shotwissels
    for (let i = 2; i < n - 2; i++) {
      const acc = mot[i] - (mot[i - 2] + mot[i + 2]) / 2;
      const nearCut = tl && tl.shots.some((sh) => Math.abs(sh.start - i / 30) < 0.2);
      if (!nearCut && acc > 9 && mot[i] > 14 && lum[i] < 200) notes.push({ t: i / 30, type: 'schok/hokkerig', v: acc });
    }
    // heen en weer: horizontale verschuiving die binnen ~1 s van richting wisselt met flinke snelheid
    for (let i = 15; i < n - 15; i++) {
      const s1 = shift.slice(i - 15, i).reduce((a, b) => a + b, 0), s2 = shift.slice(i, i + 15).reduce((a, b) => a + b, 0);
      if (Math.sign(s1) !== Math.sign(s2) && Math.abs(s1) > 25 && Math.abs(s2) > 25) notes.push({ t: i / 30, type: 'heen en weer', v: Math.min(Math.abs(s1), Math.abs(s2)) });
    }
    for (let i = 0; i < n; i++) if (lum[i] > 225) notes.push({ t: i / 30, type: 'bijna wit (flits)', v: lum[i] });
    // samenvoegen per halve seconde
    const merged = [];
    notes.sort((a, b) => a.t - b.t).forEach((x) => { const m = merged.find((y) => y.type === x.type && Math.abs(y.t2 - x.t) < 0.5); if (m) { m.t2 = x.t; m.v = Math.max(m.v, x.v); } else merged.push({ ...x, t1: x.t, t2: x.t }); });
    // contactsheet
    const dur = n / 30, a0 = from ?? 0, a1 = Math.min(dur, to ?? dur);
    const step = Math.max(0.25, (a1 - a0) / 28);
    const times = []; for (let t = a0 + step / 2; t < a1; t += step) times.push(+t.toFixed(2));
    merged.forEach((m) => { const mt = +((m.t1 + m.t2) / 2).toFixed(2); if (mt >= a0 && mt <= a1 && !times.some((t) => Math.abs(t - mt) < step / 3)) times.push(mt); });
    times.sort((x, y) => x - y);
    const shots = await Promise.all(times.slice(0, 35).map((t) => grabRaw(['-v', 'error', '-ss', String(t), '-i', src, '-frames:v', '1', '-vf', 'scale=270:-2', '-f', 'image2', '-c:v', 'mjpeg', '-'])));
    const im = await sheet(shots, { cols: 7, width: 150, labels: times.slice(0, 35).map((t) => `${t.toFixed(1)}s ${shotName(t)}${merged.some((m) => t >= m.t1 - 0.15 && t <= m.t2 + 0.15) ? ' !' : ''}`) });
    // beweging per shot
    const per = tl ? tl.shots.map((sh) => { const i0 = Math.floor(sh.start * 30), i1 = Math.min(n, Math.floor(sh.end * 30)); const m = mot.slice(i0, i1); const avg = m.reduce((a, b) => a + b, 0) / Math.max(1, m.length); const pan = shift.slice(i0, i1).reduce((a, b) => a + Math.abs(b), 0) / Math.max(0.1, sh.end - sh.start); return `${sh.id} ${sh.start.toFixed(1)}-${sh.end.toFixed(1)}s: beweging ${avg.toFixed(1)}, zijwaarts ${pan.toFixed(0)}/s`; }).join('\n') : '';
    const fnd = merged.length ? merged.map((m) => `- ${m.type} ${m.t1.toFixed(1)}-${m.t2.toFixed(1)}s ${shotName(m.t1)}`).join('\n') : '- niets opvallends gevonden';
    return { content: [text(`Render: ${f} · ${dur.toFixed(1)}s\n\nBevindingen uit de pixels:\n${fnd}\n\nBeweging per shot (hoe hoger 'zijwaarts', hoe meer links/rechts; boven ~60/s voelt onrustig):\n${per}\n\nBekijk de beelden kritisch. Oplossingen: kadrering lelijk of te krap in een shot -> edit[i].frame (zoom/x/y/tilt) voor alleen dat shot; onrustig/heen en weer -> calm hoger (0.8-1) of shotTempo voor dat shot hoger (1.2-1.5); hokkerig -> ramp lager of tempo iets hoger; te kort om te lezen -> hold hoger of shotTempo hoger; flits te fel -> flashAmt/burnAmt lager. Zet met set_params en render opnieuw.`), img(im)] };
  });

  server.registerTool('refind_features', {
    title: 'Features opnieuw zoeken',
    description: 'Zoekt de key features en feature-groepen (rijen kaarten/reviews/USPs voor de pop-wall) opnieuw op de site van een bestaand project. Duurt 1-3 minuten, draait los; daarna get_project.',
    inputSchema: { project: z.string() },
  }, async ({ project }) => {
    const dir = projectDir(project);
    const log = fs.openSync(path.join(dir, 'refeatures.log'), 'w');
    spawn(process.execPath, [path.join(__dirname, 'refeatures.js'), dir], { detached: true, stdio: ['ignore', log, log], env: process.env, cwd: __dirname }).unref();
    return { content: [text('Gestart. Over 1-3 minuten get_project; de pop-wall wordt beschikbaar als er groepen gevonden zijn.')] };
  });

  server.registerTool('set_params', {
    title: 'Instellingen opslaan', description: 'Slaat edit en/of instellingen op voor dit project (samengevoegd met de huidige). Gebruikt door render_video en de Studio.',
    inputSchema: { project: z.string(), params: z.record(z.string(), z.any()), reset: z.boolean().optional() },
  }, async ({ project, params, reset }) => {
    const dir = projectDir(project);
    const merged = reset ? TLMOD.merge(params) : loadParams(dir, params);
    fs.mkdirSync(path.join(dir, 'showcase'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'showcase', 'params.json'), JSON.stringify(merged, null, 2));
    const a = prepared(dir);
    const tl = a ? TLMOD.buildTimeline(a.A, a.R, merged) : null;
    return { content: [text(`Opgeslagen.${tl ? ` Edit: ${TLMOD.describeEdit(tl.edit)} · ${tl.duration}s` : ''}`)] };
  });

  server.registerTool('render_video', {
    title: 'Video renderen', description: 'Rendert de MP4 met geluid (beeld voor beeld, motion blur). Los proces; geeft job_id. Met params wordt een eenmalige variant gerenderd zonder de opgeslagen instellingen te wijzigen.',
    inputSchema: { project: z.string(), params: z.record(z.string(), z.any()).optional(), quality: z.enum(['draft', 'final']).optional().describe('draft = snel concept (minder motion blur), final = standaard') },
  }, async ({ project, params, quality }) => {
    const dir = projectDir(project);
    const id = startJob(OUT, 'render', { project: path.basename(dir), params: params || {}, noSave: !!params, quality: quality || 'final' });
    return { content: [text(`Render gestart (job ${id}). Poll met get_job; de MP4 komt in ${path.join(dir, 'showcase')}.`)] };
  });

  server.registerTool('open_folder', { title: 'Map openen', description: 'Opent de showcase-map van een project in Finder.', inputSchema: { project: z.string() } }, async ({ project }) => {
    const dir = path.join(projectDir(project), 'showcase');
    fs.mkdirSync(dir, { recursive: true });
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    spawn(cmd, [dir], { detached: true, stdio: 'ignore' }).unref();
    return { content: [text('Geopend: ' + dir)] };
  });

  server.connect(new StdioServerTransport()).then(() => console.error(`website-motion-studio MCP klaar · captures: ${OUT}`));
  process.on('SIGTERM', async () => { await PV.close(); process.exit(0); });
}
