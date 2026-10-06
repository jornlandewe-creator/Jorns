#!/usr/bin/env node
// Website Motion Capture v11
// Website → stills (clean + tagged) + echte video-clips van interacties → map/ZIP voor ChatGPT + Higgsfield/Seedance
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib/browser');
const { analyzePage } = require('./lib/analyze');
const { chooseStills, captureStills } = require('./lib/stills');
const { planClips, recordClips } = require('./lib/clips');
const { buildUploadSet, writeUploadOrder, writeReport, writeContext, writeReadme, zipDir } = require('./lib/output');
const { log, mkdir, slug } = require('./lib/util');
const { renderPreview } = require('./lib/preview');
const { renderShowcase } = require('./lib/showcase');
const { captureFeatures, recordMobile } = require('./lib/extra');
const { contactSheet, clipPublic } = require('./lib/clips');
const { planShots, writeDirectorBrief } = require('./lib/director');

const VERSION = '16.0';

const DEFAULTS = {
  width: 1920, height: 1080, scale: 2,   // scale 2 = retina-opname: scherp bij inzoomen
  pages: 4,               // homepage + max 3 extra pagina's
  stills: 6,              // aantal stills (clean + tagged) in stills/
  clips: 8,               // aantal video-clips in clips/
  cursor: true,           // cursor zichtbaar in interactie-clips
  timewarp: 2,            // opname K x vertraagd, daarna K x versneld: vloeiender clips (1 = uit)
  timewarpScroll: 4,      // idem voor scroll-clips (zwaarder om te renderen)
  hideWidgets: true,      // chat-widgets en cookiebanners verbergen
  headed: false,          // true = browservenster zichtbaar
  uploadStills: 4,        // stills in de Higgsfield-uploadset
  uploadTagged: true,     // tagged versie meeuploaden
  uploadVideos: 3,        // video's in de uploadset
  maxImages: 9,           // limiet afbeeldingen Seedance/Higgsfield
  maxVideoTotal: 15,      // limiet totale videoduur (s)
  seedanceClipMax: 5,     // max lengte per video in de uploadset (s)
  maxHoverProbes: 28, maxClickProbes: 8, maxParallaxSections: 8, maxTags: 12, autoplayWatchMs: 3500,
  out: path.join(require('os').homedir(), 'Desktop', 'Website Captures'),
  noZip: false,
  mobile: true,            // mobiele versie opnemen (voor telefoon-shots)
  features: 6,             // aantal key features voor close-ups
  showcase: true,          // 9:16 cinematic showcase (SHOWCASE_9x16.mp4)
  preview: false,          // extra 16:9 preview (oude stijl)
  maxSubframes: 14,        // max subframes voor motion blur bij snelle bewegingen
  previewFps: 30, previewSubframes: 4,
};

function parseArgs() {
  const settingsFile = path.join(__dirname, 'settings.json');
  let cfg = { ...DEFAULTS };
  if (fs.existsSync(settingsFile)) {
    try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) }; } catch (e) { log('! settings.json niet leesbaar, gebruik standaardwaarden'); }
  }
  const a = process.argv.slice(2);
  let url = null;
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (!k.startsWith('--')) { url = k; continue; }
    const key = k.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (key === 'size') { const [w, h] = a[++i].split('x').map(Number); cfg.width = w; cfg.height = h; continue; }
    if (key.startsWith('no') && key.length > 2 && !(key in cfg)) { const kk = key[2].toLowerCase() + key.slice(3); cfg[kk] = false; continue; }
    const nxt = a[i + 1];
    if (nxt === undefined || nxt.startsWith('--')) { cfg[key] = true; continue; }
    i++;
    cfg[key] = /^\d+(\.\d+)?$/.test(nxt) ? Number(nxt) : nxt === 'true' ? true : nxt === 'false' ? false : nxt;
  }
  if (!url) {
    console.log('Gebruik: node capture.js https://www.voorbeeld.nl [--pages 4] [--clips 8] [--stills 6] [--headed] [--no-cursor] [--size 1920x1080] [--out map]');
    process.exit(1);
  }
  if (!/^https?:\/\//.test(url)) url = 'https://' + url;
  return { url, cfg };
}

(async () => {
  const { url, cfg } = parseArgs();
  const host = new URL(url).hostname.replace(/^www\./, '');
  const now = new Date();
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');
  const out = path.join(cfg.out, `${slug(host, 40)}_${stamp}`);
  const dirs = { out, stills: path.join(out, 'stills'), clips: path.join(out, 'clips'), states: path.join(out, 'states'), pages: path.join(out, 'pages') };
  Object.values(dirs).forEach(mkdir);
  log(`Website Motion Capture v${VERSION}\n${url}\n→ ${out}`);

  const { browser, context } = await launch(cfg);
  const page = await context.newPage();
  const t0 = Date.now();
  try {
    // 1. Analyse
    const analyses = [];
    const first = await analyzePage(page, cfg, url, 1, dirs);
    analyses.push(first);
    const extra = first.links.slice(0, cfg.pages - 1);
    if (extra.length) log(`\nExtra pagina's gekozen: ${extra.map((l) => l.path).join(', ')}`);
    for (let i = 0; i < extra.length; i++) {
      try { analyses.push(await analyzePage(page, cfg, extra[i].url, i + 2, dirs)); } catch (e) { log(`  ! pagina overgeslagen: ${e.message.split('\n')[0]}`); }
    }

    // 2. Stills
    log('\n[stills] beste secties vastleggen (clean + tagged)...');
    const stills = await captureStills(page, cfg, chooseStills(analyses, cfg), analyses, dirs);

    // 2b. Key features (close-ups)
    let features = [];
    if (cfg.features !== 0) {
      log('\n[features] key features zoeken (aanbod, USP, cijfers, reviews, prijzen)...');
      features = await captureFeatures(page, cfg, analyses, dirs).catch((e) => { log('  ! features: ' + e.message.split('\n')[0]); return []; });
    }

    // 3. Clips
    const plan = planClips(analyses, cfg);
    log(`\n[clips] ${plan.length} momenten opnemen: ${plan.map((p) => p.type).join(', ')}`);
    const clips = await recordClips(context, cfg, plan, dirs);

    // 3b. Mobiele versie
    let mobileStills = [];
    if (cfg.mobile) {
      log('\n[mobiel] mobiele versie opnemen (iPhone-formaat)...');
      const mob = await recordMobile(browser, cfg, url, dirs, clips.length).catch((e) => { log('  ! mobiel: ' + e.message.split('\n')[0]); return { clips: [], stills: [] }; });
      for (const c of mob.clips) {
        const sheet = path.join(dirs.clips, c.fileBase + '_frames.png');
        await contactSheet(page, cfg, c.file, c, { duration: c.duration }, sheet).catch(() => {});
        c.sheet = sheet;
        clips.push(c);
      }
      mobileStills = mob.stills;
    }

    // 4. Output
    log('\n[output] uploadset, rapport en ZIP maken...');
    const meta = { site: host, url, date: now.toLocaleString('nl-NL'), version: VERSION };
    const upload = await buildUploadSet(out, cfg, stills, clips);
    writeUploadOrder(out, upload, cfg);
    writeReport(out, cfg, meta, analyses, stills, clips, upload);
    writeContext(out, cfg, meta, analyses, stills, clips, upload);
    try {
      const cf = path.join(out, 'website-reference-context.json');
      const cj = JSON.parse(fs.readFileSync(cf, 'utf8'));
      cj.key_features = features; cj.key_feature_groups = (features && features.groups) || []; cj.mobile_stills = mobileStills;
      fs.writeFileSync(cf, JSON.stringify(cj, null, 1));
      if (features.length) fs.appendFileSync(path.join(out, 'CAPTURE-REPORT.md'), '\n## Key features (close-ups)\n\n' + features.map((f) => `- ${f.no}. [${f.kind}] "${f.text}" · pagina ${f.page} · \`${f.file}\``).join('\n') + '\n');
    } catch (e) { log('! context aanvullen: ' + e.message); }
    writeReadme(out, meta, upload, stills, clips);
    fs.copyFileSync(path.join(__dirname, 'CHATGPT-MASTER-INSTRUCTIONS.md'), path.join(out, 'CHATGPT-MASTER-INSTRUCTIONS.md'));
    await browser.close().catch(() => {});
    try { const ctxJ = JSON.parse(fs.readFileSync(path.join(out, 'website-reference-context.json'), 'utf8')); writeDirectorBrief(out, ctxJ, planShots(ctxJ)); } catch (e) { log('! director-brief: ' + e.message); }
    let preview = null, showcase = null;
    if (cfg.showcase) {
      log('\n[showcase] 9:16 cinematic showcase renderen (lokaal, geen API)...');
      showcase = await renderShowcase(out, cfg).catch((e) => { log('! showcase mislukt: ' + e.message.split('\n')[0]); return null; });
    }
    if (cfg.preview) {
      log('\n[preview] 16:9 preview renderen...');
      preview = await renderPreview(out, cfg).catch((e) => { log('! preview mislukt: ' + e.message.split('\n')[0]); return null; });
    }
    let zip = null;
    if (!cfg.noZip) zip = await zipDir(out).catch((e) => { log('! ZIP mislukt: ' + e.message); return null; });

    const sec = Math.round((Date.now() - t0) / 1000);
    log(`\nKlaar in ${Math.floor(sec / 60)}m${sec % 60}s`);
    log(`  ${analyses.length} pagina's · ${stills.length} stills · ${clips.length} clips · ${analyses.reduce((n, a) => n + a.hovers.length + a.clicks.length, 0)} interacties`);
    log(`  uploadset: ${upload.images.length} afbeeldingen, ${upload.videos.length} video's`);
    log(`  map: ${out}`);
    if (showcase) log(`  showcase: ${showcase.file} (${showcase.duration}s, 9:16)`);
    if (preview) log(`  preview: ${preview.file} (${preview.duration}s · ${preview.shots.join(' → ')})`);
    if (zip) log(`  zip: ${zip}`);
  } catch (e) {
    log('\nFOUT: ' + (e.stack || e.message));
    process.exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
  }
})();
