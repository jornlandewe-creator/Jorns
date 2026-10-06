// Director-laag: maakt uit de capture een "best moments" overzicht, cinematic opportunities
// en een shot-plan. Het shot-plan stuurt de lokale preview-render en gaat als voorstel mee naar ChatGPT.
const fs = require('fs');
const path = require('path');

const CLICK_T = (c, re) => { const e = (c.timeline || []).find((x) => re.test(x.event)); return e ? e.t : null; };

function findInteraction(ctx, id) {
  for (const p of ctx.pages) {
    const h = (p.hovers || []).find((x) => x.id === id);
    if (h) return h;
    const k = (p.clicks || []).find((x) => x.id === id);
    if (k) return k;
  }
  return null;
}
function findElement(ctx, pageNo, sel) {
  const p = ctx.pages.find((x) => x.page === pageNo);
  return p ? (p.elements || []).find((e) => e.selector === sel) : null;
}

function planShots(ctx) {
  const clips = ctx.clips || [];
  const by = (types) => types.map((t) => clips.find((c) => c.type === t)).find(Boolean);
  const shots = [];

  const hero = by(['hero-cta', 'scroll-tour']);
  if (hero) {
    let focus = null;
    if (hero.type === 'hero-cta' && hero.evidence && hero.evidence[0]) {
      const h = findInteraction(ctx, hero.evidence[0]);
      if (h) focus = h.target.rect_view;
    }
    if (!focus) {
      const e = findElement(ctx, hero.page, (hero.targets || [])[0]);
      if (e) focus = e.rect;
    }
    shots.push({ kind: 'establish', clip: hero, key: CLICK_T(hero, /hover/) ?? 1.6, focus, why: 'Hero als openingsbeeld: grootste beeld, merk en hoofd-CTA in één frame.' });
  } else if (ctx.stills[0]) {
    shots.push({ kind: 'establish', still: ctx.stills[0], why: 'Hero-still als openingsbeeld.' });
  }

  const menu = by(['menu-open', 'overlay-open', 'hover-dropdown', 'dropdown']);
  if (menu) {
    const it = findInteraction(ctx, (menu.evidence || [])[0]);
    shots.push({ kind: 'interaction', clip: menu, key: CLICK_T(menu, /klik|hover/) ?? 1.5, focus: it ? it.target.rect_view : null, why: 'Echte interactie: cursor, klik en een groot bewegend vlak. Sterkste "dit is de echte site" moment.' });
  }

  const cards = by(['card-hover-sweep', 'hover-card']);
  if (cards) {
    const pts = (cards.evidence || []).map((id) => findInteraction(ctx, id)).filter(Boolean).map((h) => h.target.rect_view);
    const keys = (cards.timeline || []).filter((e) => /hover/.test(e.event)).map((e) => e.t);
    shots.push({ kind: 'detail-sweep', clip: cards, keys, points: pts, why: 'Productkaarten met echte hover-zoom: macro detail en lateral fly-by.' });
  }

  const motion = by(['parallax-scroll', 'slider', 'slider-autoplay', 'scroll-reveal']);
  if (motion) shots.push({ kind: 'depth', clip: motion, why: `Gemeten site-beweging (${motion.type}): basis voor een orbit met echte diepte.` });

  const used = new Set(shots.filter((s) => s.still).map((s) => s.still.no));
  let stack = ctx.stills.filter((s) => !used.has(s.no) && s.kind !== 'hero').slice(0, 3);
  // eindlaag = productsectie als die er is (de depth-clip laat vaak al andere secties zien)
  const fin = stack.findIndex((s) => /cards|producten/.test(s.kind));
  if (fin >= 0) stack = [...stack.filter((_, i) => i !== fin), stack[fin]];
  if (stack.length >= 2) shots.push({ kind: 'fly-through', stills: stack, why: 'Meerdere sterke secties als lagen in de ruimte: camera vliegt erdoorheen.' });

  // logo voor het eindbeeld: liefst uit een still met gescrollde (lichte) header
  let logo = null;
  const cands = [];
  ctx.stills.forEach((s) => (s.tags || []).forEach((t) => { if (t.role === 'logo') cands.push({ still: s, tag: t }); }));
  cands.sort((a, b) => (b.still.scrollY > 60) - (a.still.scrollY > 60));
  if (cands[0]) logo = cands[0];
  shots.push({ kind: 'brand-resolve', logo, why: 'Eindigen op het echte logo, rustig en groot.' });
  return shots;
}

function opportunities(ctx) {
  const out = { hero: [], macro: [], transitions: [], focal: [] };
  const s1 = ctx.stills[0];
  if (s1) out.hero.push(`Still ${s1.no} (${s1.kind}${s1.heading ? ', "' + s1.heading + '"' : ''}): breed openingsbeeld, dolly-in naar de headline.`);
  (ctx.clips || []).filter((c) => /hero|scroll-tour/.test(c.type)).forEach((c) => out.hero.push(`Clip ${c.clip} ${c.type}: ${c.what_happens}.`));
  ctx.stills.forEach((s) => (s.tags || []).forEach((t) => {
    const area = t.rect.w * t.rect.h;
    if (['cta', 'badge', 'logo', 'price', 'menu-toggle'].includes(t.role) && area < 120000) out.macro.push(`Still ${s.no} / tag ${t.tag} ${t.role}${t.text ? ' "' + t.text.slice(0, 40) + '"' : ''}${t.motion ? ' (heeft eigen transition/animatie)' : ''}`);
    if (['cta', 'headline', 'logo', 'card', 'image'].includes(t.role) && t.importance >= 80) out.focal.push(`Still ${s.no} / tag ${t.tag} ${t.role}${t.text ? ' "' + t.text.slice(0, 40) + '"' : ''}`);
  }));
  (ctx.clips || []).forEach((c) => {
    if (/menu-open|overlay-open/.test(c.type)) out.transitions.push(`Clip ${c.clip}: het geopende menu vult het beeld. Camera duikt het menuvlak in, die kleur wordt de opening van het volgende shot.`);
    if (/card/.test(c.type)) out.transitions.push(`Clip ${c.clip}: de rand van een productkaart passeert rakelings de lens als geometrische wipe.`);
    if (/parallax/.test(c.type)) out.transitions.push(`Clip ${c.clip}: gemeten parallax-lagen (${(c.effects || []).join(', ')}) scheiden in diepte, camera gaat tussen de lagen door.`);
    if (/slider/.test(c.type)) out.transitions.push(`Clip ${c.clip}: slider schuift; volg de beweging met een lateral whip naar het volgende shot.`);
  });
  const cta = ctx.stills.flatMap((s) => (s.tags || []).filter((t) => t.role === 'cta').map((t) => ({ s, t })))[0];
  if (cta) out.transitions.push(`Still ${cta.s.no} / tag ${cta.t.tag}: CTA-knop vult het beeld, zelfde merkkleur opent het volgende shot.`);
  return out;
}

function writeDirectorBrief(out, ctx, shots) {
  const o = opportunities(ctx);
  const L = [];
  L.push(`# DIRECTOR-BRIEF · ${ctx.url}`, '');
  L.push('Voorstel van de tool. ChatGPT beslist uiteindelijk zelf, maar dit is een goed startpunt. De lokale preview (`preview/PREVIEW.mp4`) volgt precies dit shot-plan.', '');
  L.push('## Secties (gescoord)', '');
  ctx.pages.forEach((p) => p.sections.filter((s) => s.kind !== 'footer').forEach((s) => L.push(`- pagina ${p.page} · sectie ${s.index} · ${s.kind}${s.heading ? ' "' + s.heading.slice(0, 50) + '"' : ''} · score ${s.score}`)));
  L.push('', '## Best moments', '');
  shots.forEach((s, i) => {
    const src = s.clip ? `clip ${s.clip.clip} (${s.clip.type}, ${s.clip.duration_s}s)` : s.stills ? `stills ${s.stills.map((x) => x.no).join(', ')}` : s.still ? `still ${s.still.no}` : s.logo ? `logo uit still ${s.logo.still.no} / tag ${s.logo.tag.tag}` : '-';
    L.push(`${i + 1}. **${s.kind}** · ${src} · ${s.why}`);
  });
  L.push('', '## Hero moments', '', ...(o.hero.length ? o.hero.map((x) => '- ' + x) : ['- geen']));
  L.push('', '## Macro detail moments', '', ...(o.macro.length ? [...new Set(o.macro)].slice(0, 10).map((x) => '- ' + x) : ['- geen']));
  L.push('', '## Transition opportunities', '', ...(o.transitions.length ? o.transitions.map((x) => '- ' + x) : ['- geen']));
  L.push('', '## Aanbevolen focal elements', '', ...(o.focal.length ? [...new Set(o.focal)].slice(0, 10).map((x) => '- ' + x) : ['- geen']));
  L.push('', '## Aanbevolen sequence flow', '');
  const flow = { establish: 'establish: breed, snelle dolly-in met speed ramp', interaction: 'interactie: macro op het bedieningselement, klik, pull-back terwijl het vlak opent, duik erin', 'detail-sweep': 'detail: lateral fly-by langs de kaarten, cursor als ritme', depth: 'diepte: orbit rond de gemeten parallax/scroll-beweging', 'fly-through': 'fly-through: sterke secties als lagen, camera vliegt erdoorheen', 'brand-resolve': 'resolve: echt logo, rustig, groot' };
  shots.forEach((s, i) => L.push(`${i + 1}. ${flow[s.kind] || s.kind}`));
  fs.writeFileSync(path.join(out, 'DIRECTOR-BRIEF.md'), L.join('\n') + '\n');
}

module.exports = { planShots, writeDirectorBrief };
