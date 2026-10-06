const fs = require('fs');
const path = require('path');
const { pad, rel, mkdir, run, log } = require('./util');
const { trimForSeedance, clipPublic } = require('./clips');

const CURSOR_TYPES = ['hero-cta', 'menu-open', 'overlay-open', 'dropdown', 'hover-dropdown', 'card-hover-sweep', 'hover-card', 'hover-cta', 'slider', 'tab', 'accordion', 'search', 'panel', 'menu'];
const SCROLL_TYPES = ['parallax-scroll', 'scroll-reveal', 'scroll-tour'];

function pickVideos(clips, cfg) {
  const sorted = clips.slice().sort((a, b) => b.score - a.score);
  const picks = [];
  const take = (pred) => { const c = sorted.find((x) => !picks.includes(x) && pred(x)); if (c) picks.push(c); };
  take((c) => CURSOR_TYPES.includes(c.type));
  take((c) => SCROLL_TYPES.includes(c.type) && c.type !== 'scroll-tour');
  while (picks.length < cfg.uploadVideos) {
    const before = picks.length;
    take((c) => c.type !== 'scroll-tour' && !picks.some((p) => p.type === c.type));
    if (picks.length === before) take((c) => true);
    if (picks.length === before) break;
  }
  return picks.slice(0, cfg.uploadVideos);
}

async function buildUploadSet(out, cfg, stills, clips) {
  const dir = path.join(out, 'higgsfield-upload');
  mkdir(dir);
  const images = [];
  let fileNo = 0;
  const maxStills = cfg.uploadTagged ? Math.floor(cfg.maxImages / 2) : cfg.maxImages;
  for (const s of stills.slice(0, Math.min(cfg.uploadStills, maxStills))) {
    fileNo++;
    const f1 = path.join(dir, `${pad(fileNo)}_image${pad(s.no)}.png`);
    fs.copyFileSync(s.clean, f1);
    images.push({ at: `@Image ${images.length + 1}`, file: path.basename(f1), still: s.no, kind: 'clean', desc: `still ${s.no} clean · pagina ${s.page} ${s.path} · ${s.kind}${s.heading ? ' "' + s.heading.slice(0, 50) + '"' : ''}` });
    if (cfg.uploadTagged) {
      fileNo++;
      const f2 = path.join(dir, `${pad(fileNo)}_image${pad(s.no)}-tagged.png`);
      fs.copyFileSync(s.tagged, f2);
      images.push({ at: `@Image ${images.length + 1}`, file: path.basename(f2), still: s.no, kind: 'tagged', desc: `tagmap voor ${images[images.length - 1].at} (tags ${s.no}.1 t/m ${s.no}.${s.tags.length})` });
    }
  }
  const videos = [];
  const picks = pickVideos(clips, cfg);
  let budget = cfg.maxVideoTotal;
  for (const c of picks) {
    const maxDur = Math.min(cfg.seedanceClipMax, budget);
    if (maxDur < 2) break;
    const f = path.join(dir, `V${videos.length + 1}_clip${pad(c.no)}_${c.type}.mp4`);
    const t = await trimForSeedance(c, maxDur, f);
    budget -= t.duration;
    videos.push({ at: `@Video ${videos.length + 1}`, file: path.basename(f), clip: c.no, type: c.type, desc: c.note, trimmed_from: t.start, duration: t.duration, cursor: !!c.cursor });
  }
  return { images, videos };
}

function fmtMotion(m) {
  if (!m) return '';
  const p = [];
  if (m.transition) p.push(`transition ${m.transition.property} ${m.transition.duration_ms}ms ${m.transition.easing}`);
  if (m.animation) p.push(`animation ${m.animation.name} ${m.animation.duration} ${m.animation.easing} x${m.animation.iteration}`);
  if (m.web_animations) p.push(`web-animations: ${m.web_animations.map((w) => `${w.type}${w.name ? ' ' + w.name : ''} ${Math.round(w.duration) || w.duration}ms`).join(', ')}`);
  return p.join('; ');
}
const short = (v) => { const s = String(v); return s.length > 70 ? s.slice(0, 67) + '...' : s; };

function writeUploadOrder(out, upload, cfg) {
  const L = [];
  L.push('# UPLOAD-ORDER · Higgsfield / Seedance', '');
  L.push('Upload de bestanden uit `higgsfield-upload/` in exact deze volgorde.');
  L.push('Afbeeldingen en video\'s worden per type genummerd in uploadvolgorde: eerste afbeelding = @Image 1, eerste video = @Video 1.', '');
  L.push(`Limieten waarop deze set is gebouwd: max ${cfg.maxImages} afbeeldingen, max ${cfg.uploadVideos} video's, video's samen max ${cfg.maxVideoTotal}s, per video max ${cfg.seedanceClipMax}s. Controleer de actuele limieten in Higgsfield; pas ze aan in settings.json als ze veranderd zijn.`, '');
  L.push('## Afbeeldingen', '', '| Higgsfield | Bestand | Wat |', '|---|---|---|');
  upload.images.forEach((i) => L.push(`| ${i.at} | ${i.file} | ${i.desc} |`));
  L.push('', '## Video\'s', '', '| Higgsfield | Bestand | Duur | Wat |', '|---|---|---|---|');
  upload.videos.forEach((v) => L.push(`| ${v.at} | ${v.file} | ${v.duration}s | ${v.desc}${v.cursor ? ' (met cursor)' : ''} |`));
  L.push('', 'Wil je andere stills of clips gebruiken? Alle kandidaten staan in `stills/` en `clips/`. Laat ChatGPT dan een nieuwe uploadvolgorde opschrijven en upload in die volgorde.');
  fs.writeFileSync(path.join(out, 'UPLOAD-ORDER.md'), L.join('\n') + '\n');
}

function writeReport(out, cfg, meta, analyses, stills, clips, upload) {
  const L = [];
  L.push(`# CAPTURE-REPORT · ${meta.site}`, '');
  L.push(`Start-URL: ${meta.url}  `, `Gemaakt: ${meta.date} · viewport ${cfg.width}x${cfg.height} · tool v${meta.version}`, '');
  L.push('Dit rapport is de "taal" tussen de capture-tool en de AI die de Seedance-prompt schrijft. Alles hieronder is door de tool GEMETEN in een echte browser, tenzij er "gedeclareerd" staat (dan komt het uit de CSS/JS van de site maar is het niet los nagemeten).', '');

  L.push('## Pagina\'s', '');
  analyses.forEach((a) => {
    const libs = Object.entries(a.libraries).filter(([, v]) => v).map(([k]) => k).join(', ') || 'geen bekende';
    L.push(`- **Pagina ${a.pageNo}** ${a.path} · "${a.title}" · hoogte ${a.docHeight}px · motion-libraries: ${libs} · overzicht: \`${rel(out, a.overview)}\``);
  });

  L.push('', '## Stills (clean + tagged)', '');
  stills.forEach((s) => {
    const up = upload.images.filter((i) => i.still === s.no).map((i) => i.at).join(' / ');
    L.push(`### Still ${s.no} · pagina ${s.page} ${s.path} · ${s.kind}${up ? ' · in uploadset als ' + up : ''}`);
    L.push(`Bestanden: \`${rel(out, s.clean)}\` en \`${rel(out, s.tagged)}\` · scrollpositie ${s.scrollY}px${s.heading ? ' · kop: "' + s.heading + '"' : ''}`, '');
    L.push('| Tag | Rol | Tekst | Positie (x,y,b,h) | Motion-bewijs |', '|---|---|---|---|---|');
    s.tags.forEach((t) => {
      const ev = [fmtMotion(t.motion), ...(t.links || [])].filter(Boolean).join('; ');
      L.push(`| ${t.tag} | ${t.role} | ${(t.text || '').replace(/\|/g, '/').slice(0, 45)} | ${t.rect.x},${t.rect.y},${t.rect.w},${t.rect.h} | ${ev.replace(/\|/g, '/') || '-'} |`);
    });
    L.push('');
  });

  L.push('## Video-clips (echte opnames van de site)', '');
  L.push('Elke clip heeft een `_frames.png` contactsheet (6 frames + tijdlijn). Bekijk die als je de video zelf niet kunt afspelen.', '');
  clips.forEach((c) => {
    const up = upload.videos.find((v) => v.clip === c.no);
    L.push(`### Clip ${c.no} · ${c.type} · pagina ${c.page} ${c.path}${up ? ' · in uploadset als ' + up.at + ` (${up.duration}s, vanaf ${up.trimmed_from}s)` : ''}`);
    L.push(`Bestand: \`${rel(out, c.file)}\` · ${c.duration}s · cursor ${c.cursor ? 'zichtbaar' : 'niet zichtbaar'} · contactsheet \`${rel(out, c.sheet)}\``, '');
    L.push(`Wat gebeurt er: ${c.note}`, '');
    L.push('Tijdlijn: ' + c.timeline.map((e) => `${e.t.toFixed(2)}s ${e.event}`).join(' → '));
    if (c.measured && c.measured.length) {
      L.push('', 'Gemeten resultaat van de klik:');
      c.measured.slice(0, 3).forEach((m) => L.push(`- \`${m.tag}.${(m.cls || '').split(' ')[0]}\` zichtbaar ${m.visible[0]}→${m.visible[1]}, opacity ${m.opacity[0]}→${m.opacity[1]}, verschuiving x ${m.dx}px / y ${m.dy}px, transform ${short(m.transform[0])} → ${short(m.transform[1])}, gemeten duur ${m.measured_duration_ms ?? '?'}ms${m.declared ? ' · gedeclareerd: ' + fmtMotion(m.declared) : ''}`));
    }
    if (c.effects) L.push('', 'Effecten: ' + c.effects.join(', '));
    L.push('');
  });

  L.push('## Interacties per pagina (gemeten)', '');
  analyses.forEach((a) => {
    L.push(`### Pagina ${a.pageNo} ${a.path}`, '');
    if (a.hovers.length) {
      L.push('**Hover**');
      a.hovers.forEach((h) => L.push(`- ${h.id} · ${h.kind} · "${h.target.text}" · wijzigingen: ${h.changes.slice(0, 4).map((c) => `${c.node} ${c.prop} ${short(c.from)} → ${short(c.to)}`).join('; ') || '-'}${h.revealed.length ? ' · opent: ' + h.revealed.map((r) => r.cls || r.selector).join(', ') : ''}${h.declared ? ' · ' + fmtMotion(h.declared) : ''} · states: ${h.stills.map((s) => '`' + rel(out, s) + '`').join(', ')}`));
      L.push('');
    }
    if (a.clicks.length) {
      L.push('**Klik**');
      a.clicks.forEach((k) => L.push(`- ${k.id} · ${k.kind} · "${k.target.text}" · beeldverandering ${Math.round(k.visual_change * 100)}% · ${k.result_motion.slice(0, 2).map((m) => `${m.tag}.${(m.cls || '').split(' ')[0]} opacity ${m.opacity.join('→')}, dx ${m.dx}px, dy ${m.dy}px, ${m.measured_duration_ms ?? '?'}ms`).join('; ')} · states: ${k.stills.map((s) => '`' + rel(out, s) + '`').join(', ')}`));
      L.push('');
    }
    if (a.reveals.length) {
      L.push(`**Scroll-reveals** (${a.reveals.length})`);
      a.reveals.slice(0, 15).forEach((r) => L.push(`- ${r.role} "${r.text}" op y=${r.rect.y}: ${r.changes.map((c) => `${c.prop} ${short(c.from)} → ${short(c.to)}`).join('; ')}${r.lib ? ' · ' + r.lib : ''}${r.classes_added.length ? ' · class toegevoegd: ' + r.classes_added.join(' ') : ''}${r.declared ? ' · ' + fmtMotion(r.declared) : ''}`));
      L.push('');
    }
    if (a.parallax.length) {
      L.push('**Parallax / sticky / scroll-gekoppeld**');
      a.parallax.forEach((p) => p.elements.forEach((e) => L.push(`- sectie ${p.section} · ${e.role} ${e.tag}.${(e.cls || '').split(' ')[0]} · ${e.effects.map((x) => x.note || x.type).join('; ')}`)));
      L.push('');
    }
    if (a.sliders.length) {
      L.push('**Sliders**');
      a.sliders.forEach((s) => L.push(`- ${s.selector} · ${s.slides} slides · autoplay ${s.autoplay ? 'ja' : 'nee'}${s.next ? ' · heeft volgende-pijl' : ''}${s.declared ? ' · ' + fmtMotion(s.declared) : ''}`));
      L.push('');
    }
    if (a.running_animations.length) {
      L.push('**Lopende animaties bij laden** (document.getAnimations)');
      a.running_animations.slice(0, 10).forEach((r) => L.push(`- ${r.name} · ${Math.round(r.duration) || r.duration}ms · x${r.iterations} · ${r.easing}`));
      L.push('');
    }
  });
  fs.writeFileSync(path.join(out, 'CAPTURE-REPORT.md'), L.join('\n') + '\n');
}

function writeContext(out, cfg, meta, analyses, stills, clips, upload) {
  const strip = (a) => ({
    page: a.pageNo, url: a.url, title: a.title, doc_height: a.docHeight, header_height: a.header_height, libraries: a.libraries,
    overview: rel(out, a.overview),
    sections: a.sections.map((s) => ({ index: s.index, kind: s.kind, heading: s.heading, rect: s.rect, score: s.score })),
    hovers: a.hovers.map((h) => ({ ...h, stills: h.stills.map((s) => rel(out, s)) })),
    clicks: a.clicks.map((k) => ({ ...k, stills: k.stills.map((s) => rel(out, s)) })),
    scroll_reveals: a.reveals, parallax: a.parallax, sliders: a.sliders,
    css_keyframes: a.keyframes, running_animations: a.running_animations,
    elements: a.elements.sort((x, y) => y.importance - x.importance).slice(0, 80),
  });
  const data = {
    tool: 'Website Motion Capture', version: meta.version, created: meta.date, url: meta.url, viewport: { width: cfg.width, height: cfg.height, scale: cfg.scale },
    principle: 'Stills en clips zijn de visuele waarheid. Metadata is context. verified=true betekent: in een echte browser nagemeten.',
    higgsfield_upload: upload,
    stills: stills.map((s) => ({ ...s, clean: rel(out, s.clean), tagged: rel(out, s.tagged) })),
    clips: clips.map((c) => ({ ...clipPublic(c), file: rel(out, c.file), sheet: rel(out, c.sheet) })),
    pages: analyses.map(strip),
  };
  fs.writeFileSync(path.join(out, 'website-reference-context.json'), JSON.stringify(data, null, 1));
}

function writeReadme(out, meta, upload, stills, clips) {
  const L = [
    `# ${meta.site} · capture ${meta.date}`, '',
    'Zo gebruik je deze map:', '',
    '1. Open een nieuwe ChatGPT/Claude-chat.',
    '2. Upload deze hele ZIP (of de map) en plak de inhoud van `CHATGPT-MASTER-INSTRUCTIONS.md`, plus de URL van de site.',
    '3. De AI kiest de momenten, schrijft de uploadvolgorde en de Seedance-prompt.',
    '4. Upload in Higgsfield de bestanden uit `higgsfield-upload/` in de volgorde van `UPLOAD-ORDER.md`.', '',
    `Inhoud: ${stills.length} stills (clean + tagged), ${clips.length} video-clips van echte interacties, state-foto's (voor/hover/na klik), pagina-overzichten.`,
    `Uploadset: ${upload.images.length} afbeeldingen, ${upload.videos.length} video's.`, '',
    '| Map / bestand | Wat |', '|---|---|',
    '| higgsfield-upload/ | kant-en-klare set, genummerd op uploadvolgorde |',
    '| clips/ | alle clips (MP4 1080p, 30 fps) + `_frames.png` contactsheet + `.json` tijdlijn |',
    '| stills/ | alle stills, clean en tagged |',
    '| states/ | voor / hover / na-klik foto\'s van iedere bevestigde interactie |',
    '| pages/ | overzichtsfoto van iedere geanalyseerde pagina |',
    '| CAPTURE-REPORT.md | alles wat gemeten is, leesbaar |',
    '| website-reference-context.json | dezelfde data, machineleesbaar |',
  ];
  fs.writeFileSync(path.join(out, 'README-EERST.md'), L.join('\n') + '\n');
}

async function zipDir(out) {
  const zipFile = out + '.zip';
  await run('zip', ['-r', '-q', '-X', zipFile, path.basename(out)], { cwd: path.dirname(out) });
  return zipFile;
}

module.exports = { buildUploadSet, writeUploadOrder, writeReport, writeContext, writeReadme, zipDir };
