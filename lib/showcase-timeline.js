// Shot-plan van de showcase. Werkt in Node (render) en in de browser (live preview in de Studio).
// buildTimeline(A, R, params): A = gekozen momenten uit de capture, R = voorbereide assets, params = sliders/toggles.
// Een video bestaat uit een "edit": een lijst shots met per shot een hoek, tempo en eventueel apparaat.
// De edit komt van params.edit (Claude of Studio), van de variatie-generator (params.variation) of van de standaardvolgorde.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShowcaseTimeline = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const LAPTOP = { W: 1500, D: 1000, LH: 960, bezel: 30, open: 20 };
  const FORMATS = { '9:16': [1080, 1920], '4:5': [1080, 1350], '1:1': [1080, 1080] };

  const DEFAULTS = {
    format: '9:16',
    tempo: 1,        // >1 = langzamer, <1 = sneller
    length: 0,       // doelduur in seconden (0 = vrij); tempo wordt automatisch aangepast
    shotTempo: {},   // per shot-type een duur-factor, bv. { hover: 0.7, laptop: 1.2 }
    energy: 0.7,     // hoe hard draaiingen en whips zijn
    tilt: 0.85,      // kanteling (rotateX)
    spin: 0.55,      // schuinstand in beeld (rotateZ)
    zoom: 1,         // hoe dicht de camera op de elementen zit
    dof: 0.9,        // depth of field (0 = uit)
    lift: 1.1,       // hoe ver lagen/kaarten loskomen
    hold: 1.25,      // leestijd op rustmomenten
    ramp: 0.5,       // speed ramps: snel in, rustig midden, snel uit + slow-mo op sleutelmomenten
    polish: 1,       // afwerking van de beweging (0-1): rust voor de cut, geen heen-en-weer in de draai
    drift: 0.5,      // levende camera: heel lichte, langzame zweving van het hele beeld (0 = uit), nooit stilstaand
    sweep: 0.6,      // lichtstreep die per shot één keer over de pagina/het scherm trekt (0 = uit)
    captions: false, // tekstregels in beeld (kop van de site, features, menu, mobiel, url op het eind). Standaard uit.
    captionStyle: 'clean', // clean | bold
    shadow: 0.6,     // grondschaduw onder laptop, telefoon en pagina's (0 = uit)
    rim: 0,          // rim light: dunne lichte rand langs pagina's en schermen (standaard uit: geen randlijnen)
    sheen: 0.8,      // glans/glas op schermen en vlakken (0 = uit)
    vignette: 0.5,   // donkere hoeken (0 = uit)
    grade: 0.5,      // filmische kleurcorrectie: zachte S-curve en iets meer verzadiging (alleen in de render)
    motionBlur: 1,   // sluitertijd (alleen in de render)
    grain: 0.3,      // filmkorrel (alleen in de render)
    sound: 'full',   // full | fx | off   (fx = zonder muziekbed)
    volume: 1,
    soundStyle: 'studio', // studio | cinematic | minimal
    sfxWhoosh: 1, sfxClick: 1, sfxAccent: 1, sfxImpact: 1, music: 0,
    soundEngine: 'samples', // samples (echte opnames) | synth   // niveaus per soort geluid (0 = uit)
    // effectlagen (aan/uit + sterkte)
    flash: true, flashAmt: 0.3,    // witte/warme flits op overgangen en klappen
    burn: false, burnAmt: 0.6,     // film burn (warm, uit je FX-clip)
    leak: false, leakAmt: 0.6,     // light leak (rood/oranje bokeh, uit je FX-clip)
    glow: false, glowAmt: 0.3,     // zachte gloed in de merkkleur die door beeld schuift (standaard uit: geen waas over het beeld)
    bloom: true, bloomAmt: 0.25,   // lichte glans op heldere delen (alleen in de render)
    chroma: false, chromaAmt: 0.35, // RGB-verschuiving bij snelle bewegingen (alleen in de render; standaard uit)
    lens: false, lensAmt: 0.3,     // lens-CA: subtiele kleurranden naar de hoeken (alleen in de render; standaard uit)
    autoframe: 0.85,     // automatische kadrering: focuspunt terug naar het midden (0 = uit)
    calm: 0.55,          // camera-rust: minder zijwaarts slingeren, strakker gecentreerd (0-1)
    transition: 'glide',  // glide (vloeiend doorvliegen, standaard) | mix | whip | zoom | clean (rustige dips)
    device: 'mix',        // mix | more (meer laptop: pagina-shots in de laptop, telefoon blijft) | laptop (alles in de laptop)
    watermark: false,   // logo van de site groot en vaag in de achtergrond (standaard uit: schoner beeld)
    cursor: true,
    bg: '#1d1d1f',
    bgStyle: 'studio',  // studio | mesh | aurora | grid | spotlight | solid
    reflection: false,  // spiegeling onder vlakken (standaard uit: schoner beeld)
    bgParallax: 1,
    variation: 0,       // 0 = standaard; ander getal = eigen, unieke edit (andere shots, hoeken, apparaat, volgorde)
    edit: null,         // eigen edit: [{ shot: 'laptop', angle: 'low', tempo: 1 }, ...]
    order: ['intro', 'laptop', 'pullback', 'tracking', 'longscroll', 'menu', 'hover', 'features', 'rack', 'popwall', 'float', 'explode', 'crane', 'dolly', 'cards', 'phone', 'spin', 'phonefan', 'pagespin', 'travel', 'orbit', 'stack', 'devices', 'depth', 'slide', 'closeup', 'outro'],
    shots: { intro: true, laptop: true, pullback: true, longscroll: true, menu: true, hover: false, features: true, popwall: true, tracking: true, rack: false, float: false, crane: true, dolly: false, explode: true, cards: false, phone: false, spin: false, orbit: false, stack: false, pagespin: false, phonefan: false, travel: true, devices: false, depth: false, slide: false, closeup: false, outro: true },
  };

  // Hoek-presets per shot (gecombineerd met de sliders)
  const ANGLES = {
    default: {},
    low: { rxAdd: -16, zoom: 1.0 },
    high: { rxAdd: 14 },
    top: { rxAdd: 26, rzAdd: -8 },
    'dutch-l': { rzAdd: -12 },
    'dutch-r': { rzAdd: 12 },
    profile: { ryAdd: -24 },
    close: { zoom: 1.22 },
    wide: { zoom: 0.84 },
    calm: { k: 0.6 },
    wild: { k: 1.35 },
  };
  const SHOT_INFO = {
    intro: 'logo zweeft in, cursor klikt, crash zoom (opener)',
    laptop: '3D-laptop: camera laag over het toetsenbord naar het scherm, push naar kop + CTA',
    phone: '3D-telefoon met de mobiele site (scroll of menu met tik), draait rond',
    devices: 'laptop en telefoon samen in de ruimte, camera draait eromheen, focus op de telefoon',
    menu: 'macro op CTA + menuknop, camera volgt de muis, klik, orbit terwijl het menu opent (slow-mo), duik erin',
    hover: 'close-up die de muis volgt over de kaarten met de echte hover-effecten',
    features: 'snelle close-ups van de key features (aanbod, USP, cijfers, reviews, prijzen) die uit de pagina poppen',
    explode: 'hero-pagina waarvan kop, knoppen, badge en logo in lagen loskomen, orbit',
    cards: 'pagina plat als tafel, productkaarten poppen los, focus springt mee',
    travel: 'camera vliegt door de 3D-ruimte van pagina A naar pagina B met rol',
    depth: 'orbit rond de echte scroll/parallax-clip',
    slide: 'tweede interactie (slider) van onderaf',
    outro: 'logo + CTA, cursor klikt (afsluiter)',
    popwall: 'Apple-achtig: rij kaarten/reviews/USPs, camera glijdt van blok naar blok terwijl ze een voor een loskomen, eindigt op het geheel',
    tracking: 'tracking close-up: macro langs de kop met ondiepe scherpte, constante glijbeweging',
    rack: 'rack focus: element staat los, de scherpte trekt van de pagina naar het element',
    crane: 'crane: pagina ligt als vloer, camera zakt van hoog naar ooghoogte terwijl hij naar voren vliegt',
    dolly: 'dolly: lage zijwaartse rijbeweging langs de laptop tot het scherm recht in beeld staat',
    float: 'float: hero zweeft en draait langzaam, lagen staan iets los (parallax)',
    pagespin: 'pagina als plaat draait om zijn as naar voren, zweeft, whip uit',
    phonefan: 'drie telefoons op een boog, de hele waaier draait langzaam (Apple-keynote)',
    spin: 'crazy: telefoon zwiept in 3D rond naar voren, zweeft, en de camera duikt het scherm in',
    orbit: 'crazy: kraanbeweging om de laptop (scherm blijft in beeld), terug naar de kop, duik het scherm in',
    stack: 'galerij: paginas om en om in de diepte, de camera vliegt er in een vloeiende lijn langs en landt op de laatste',
    closeup: 'close-up: elke gekozen pagina, langzame push-in op het punt dat je aanklikt, met ondiepe scherpte',
    pullback: 'pull-back: begint stil in macro op het logo (of de knop), de camera trekt terug tot de hele hero in beeld staat',
    longscroll: 'lange scroll: de volledige pagina van boven tot onder, de camera rijdt er in een rustige lijn langs'
  };

  // ---- inhoud per shot: media-plekken ----
  // Een shot heeft een of meer plekken waar inhoud in komt (vlucht = pagina A en B, laptop + telefoon = twee schermen).
  // Per plek kies je in de Studio een bron (id uit sources()), een eigen uitsnede (grab) en eventueel een focuspunt.
  // In de edit-regel: e.media = { <plek>: { id?, grab?, focus?, ids? } }. Oude velden (src, grab, focus, srcs) gelden voor de eerste plek.
  const ONE = (k, l, kind) => [[k, l, kind]];
  const MEDIA = {
    laptop: ONE('screen', 'Laptopscherm', 'screen'), orbit: ONE('screen', 'Laptopscherm', 'screen'), dolly: ONE('screen', 'Laptopscherm', 'screen'),
    devices: [['screen', 'Laptopscherm', 'screen'], ['phone', 'Telefoonscherm', 'mobile']],
    phone: ONE('phone', 'Telefoonscherm', 'mobile'), spin: ONE('phone', 'Telefoonscherm', 'mobile'),
    phonefan: [['m0', 'Telefoon links', 'mobile'], ['m1', 'Telefoon midden', 'mobile'], ['m2', 'Telefoon rechts', 'mobile']],
    travel: [['a', 'Pagina A (vertrek)', 'page'], ['b', 'Pagina B (aankomst)', 'page']],
    stack: [['p0', 'Pagina 1', 'page'], ['p1', 'Pagina 2', 'page'], ['p2', 'Pagina 3', 'page'], ['p3', 'Pagina 4', 'page']],
    pagespin: ONE('page', 'Pagina', 'page'), crane: ONE('page', 'Pagina', 'page'), tracking: ONE('page', 'Pagina', 'page'), closeup: ONE('page', 'Pagina', 'page'), pullback: ONE('page', 'Pagina', 'page'),
    longscroll: ONE('tall', 'Volledige pagina', 'tall'),
    explode: ONE('blocks', 'Pagina en lagen', 'blocks'), float: ONE('blocks', 'Pagina en lagen', 'blocks'),
    popwall: ONE('blocks', 'Blokken', 'blocks'), features: ONE('blocks', 'Features', 'blocks'), cards: ONE('blocks', 'Kaarten', 'blocks'), rack: ONE('blocks', 'Blok', 'blocks'),
  };
  const SLOTS = {}; Object.keys(MEDIA).forEach((k) => { SLOTS[k] = MEDIA[k][0][2]; });
  // hoeveel blokken per shot, en wat ze betekenen
  const GRAB = { features: { max: 4, what: 'blokken die los komen, in volgorde', purpose: 'row' }, popwall: { max: 6, what: 'blokken die een voor een loskomen', purpose: 'row' }, explode: { max: 7, what: 'lagen die uit de pagina komen', purpose: 'layers' }, float: { max: 7, what: 'lagen die gaan zweven', purpose: 'layers' }, cards: { max: 4, what: 'kaarten die loskomen', purpose: 'row' }, rack: { max: 1, what: 'het blok waar de scherpte naartoe trekt', purpose: 'row' } };
  function sources(A, R) {
    const out = { page: [], screen: [], feature: [], group: [], mobile: [], tall: [] };
    if (!R) return out;
    const th = (src) => (src && src.kind === 'clip' ? src.dir + '/' + String(Math.max(1, Math.round((src.count || 1) * 0.62))).padStart(5, '0') + '.jpg' : src && src.url);
    const lib = R.library || [];
    if (lib.length) lib.forEach((l) => out.page.push({ id: l.id, label: l.label, thumb: th(l.src), src: l.src, page: l.page, layers: l.layers || [] }));
    else {
      if (R.heroStill) out.page.push({ id: 'heroStill', label: 'Home: hero', thumb: th(R.heroStill), src: R.heroStill });
      (R.travel || []).forEach((t, i) => out.page.push({ id: 'travel' + i, label: 'Pagina ' + (i + 1), thumb: th(t), src: t }));
      if (R.cards) out.page.push({ id: 'cards', label: 'Kaarten', thumb: th(R.cards), src: R.cards });
    }
    (R.customLib || []).forEach((l) => out.page.push({ id: l.id, label: l.label, thumb: th(l.src), src: l.src, layers: l.layers || [] }));
    (R.customClips || []).forEach((c) => { out.screen.push({ id: c.id, label: c.label, thumb: th(c.src), src: c.src }); out.page.push({ id: c.id, label: c.label, thumb: th(c.src), src: c.src }); });
    const CL = { hero: 'Home, cursor naar de knop', menu: 'Menu openen', depth: 'Scrollen (parallax)', hover: 'Muis over kaarten', slide: 'Slider' };
    Object.keys(CL).forEach((k) => { if (R[k] && R[k].kind === 'clip' && !out.screen.some((x) => x.src.dir === R[k].dir)) out.screen.push({ id: 'clip:' + k, label: CL[k] + ' (beweegt)', thumb: th(R[k]), src: R[k] }); });
    out.page.forEach((p) => { if (!out.screen.some((x) => x.id === p.id)) out.screen.push(p); });
    (R.features || []).forEach((f, i) => out.feature.push({ id: 'f:' + i, label: (f.text || f.kind || 'feature').slice(0, 40), thumb: th(f.src), crop: f.rect, src: f.src }));
    (R.groups || []).forEach((g, i) => out.group.push({ id: 'g:' + i, label: (g.kind || 'groep') + ' (' + (g.items || []).length + ' blokken)', thumb: th(g.src), crop: g.rect, src: g.src }));
    if (R.mobileScroll) out.mobile.push({ id: 'm:scroll', label: 'Mobiel scrollen (beweegt)', thumb: th(R.mobileScroll), src: R.mobileScroll, portrait: true });
    if (R.mobileMenu) out.mobile.push({ id: 'm:menu', label: 'Mobiel menu (beweegt)', thumb: th(R.mobileMenu), src: R.mobileMenu, portrait: true, menu: true });
    (R.mobileStills || []).forEach((m) => out.mobile.push({ id: m.id, label: m.label, thumb: th(m.src), src: m.src, portrait: true }));
    (R.customPhone || []).forEach((m) => out.mobile.push({ id: m.id, label: m.label, thumb: th(m.src), src: m.src, portrait: true }));
    (R.pages || []).forEach((p) => out.tall.push({ id: p.id, label: p.label, thumb: th(p.src), src: p.src, h: p.h, tall: true }));
    return out;
  }
  // welke keuzes horen bij een plek
  function mediaChoices(shot, kind, A, R) {
    const S = sources(A, R);
    if (kind === 'blocks') return [...(shot === 'features' || shot === 'rack' ? S.feature : []), ...(shot === 'popwall' ? S.group : []), ...S.page.filter((p) => p.src && p.src.kind !== 'clip')];
    return S[kind] || [];
  }
  function normalizeMedia(e) {
    const m = Object.assign({}, e.media || {});
    const k0 = MEDIA[e.shot] && MEDIA[e.shot][0][0];
    if (k0 && !m[k0] && (e.src || e.grab || e.focus || (e.srcs && e.srcs.length))) m[k0] = { id: e.src, grab: e.grab, focus: e.focus, ids: e.srcs };
    return m;
  }
  const RING0 = { color: '#ffffff', std: 99 };
  const unionOf = (rs) => { const U = rs.reduce((a, r) => ({ x: Math.min(a.x, r.x), y: Math.min(a.y, r.y), x1: Math.max(a.x1, r.x + r.w), y1: Math.max(a.y1, r.y + r.h) }), { x: 1e9, y: 1e9, x1: -1e9, y1: -1e9 }); return { x: U.x, y: U.y, w: U.x1 - U.x, h: U.y1 - U.y }; };
  const eqSrc = (a, b) => !!(a && b && (a === b || (a.url && a.url === b.url) || (a.dir && a.dir === b.dir)));
  // blokken (rechthoeken + ringen) op een bron toepassen voor het shot
  function blocksOverride(shot, src, rs, rings, A, R) {
    if (!src || !rs.length) return null;
    const ring = (i) => (rings && rings[i]) || RING0;
    const union = unionOf(rs);
    if (shot === 'features' || shot === 'rack') return { A, R: { ...R, features: rs.map((r, i) => ({ src, rect: r, kind: 'eigen', text: '', ring: ring(i) })) } };
    if (shot === 'popwall') return { A, R: { ...R, groups: [{ src, rect: union, items: rs, kind: 'eigen', texts: [], rings: rs.map((_, i) => ring(i)) }] } };
    if (shot === 'cards') return { A: { ...A, cards: rs.map((r) => ({ rect: r })) }, R: { ...R, cards: src, cardRings: rs.map((_, i) => ring(i)) } };
    // lagen: het grootste blok wordt de kop (krijgt de focus), de rest losse lagen
    let big = 0; rs.forEach((r, i) => { if (r.w * r.h > rs[big].w * rs[big].h) big = i; });
    const layers = rs.map((r, i) => ({ rect: r, role: i === big ? 'headline' : (ring(i).plate && ring(i).plate.matte ? 'text' : 'card') }));
    return { A: { ...A, heroLayers: layers, heroGroup: union }, R: { ...R, heroStill: src, heroRings: rs.map((_, i) => ring(i)) } };
  }
  function applySlot(e, key, kind, v, A, R) {
    if (!v) return null;
    const list = mediaChoices(e.shot, kind, A, R);
    const it = v.id ? list.find((x) => x.id === v.id) : null;
    const g = v.grab && v.grab.src ? v.grab : null;
    const src = g ? g.src : it ? it.src : null;
    const f = v.focus;
    const fr = f ? { x: clampN(f.x - 330, 0, 1920 - 660), y: clampN(f.y - 190, 0, 1080 - 380), w: 660, h: 380 } : g && (g.rects || []).length ? unionOf(g.rects) : null;
    if (kind === 'screen') {
      const s = src || R.hero; if (!s) return null;
      const same = eqSrc(s, R.hero);
      if (same && !fr) return null;
      return { A: { ...A, heroGroup: fr || (same ? A.heroGroup : null), heroFocus: fr ? { x: fr.x + fr.w / 2, y: fr.y + fr.h / 2 } : (same ? A.heroFocus : { x: 960, y: 540 }), heroKey: same ? A.heroKey : 0.4 }, R: { ...R, hero: s } };
    }
    if (kind === 'tall') { if (!it) return null; return { A, R: { ...R, longPage: it } }; }
    if (kind === 'mobile') {
      if (!it) return null;
      if (key === 'phone') return { A, R: { ...R, mobileScroll: it.menu ? null : it.src, mobileMenu: it.menu ? it.src : (e.shot === 'phone' ? null : R.mobileMenu) } };
      const i = +key.slice(1); const fan = (R.fan || [null, null, null]).slice(); fan[i] = it.src;
      return { A, R: { ...R, fan } };
    }
    if (kind === 'page') {
      if (!src && !fr) return null;
      if (e.shot === 'travel') {
        const i = key === 'a' ? 0 : 1; const tr = (R.travel || []).slice(); if (src) tr[i] = src; if (!tr[0] || !tr[1]) return null;
        const tf = (A.travelFocus || []).slice(); if (fr) tf[i] = fr; else if (src) tf[i] = null;
        return { A: { ...A, travelFocus: tf }, R: { ...R, travel: tr } };
      }
      if (e.shot === 'stack') {
        const i = +key.slice(1); const pages = (R.stackPages || [R.heroStill, ...(R.travel || []), R.cards].filter(Boolean)).slice(0, 4);
        while (pages.length <= i) pages.push(pages[pages.length - 1]);
        if (src) pages[i] = src; return { A, R: { ...R, stackPages: pages } };
      }
      const s = src || R.heroStill || (R.travel || [])[0] || R.cards;
      const keep = eqSrc(s, R.heroStill);
      if (keep && !fr) return null;
      return { A: { ...A, heroGroup: fr || (keep ? A.heroGroup : { x: 260, y: 200, w: 1400, h: 680 }), heroLayers: keep ? A.heroLayers : [], travelFocus: [fr, fr], cards: keep ? A.cards : [] }, R: { ...R, heroStill: s, heroRings: keep ? R.heroRings : [], cards: null, travel: [s, ...((R.travel || []).slice(1))] } };
    }
    if (kind === 'blocks') {
      if (g && (g.rects || []).length) return blocksOverride(e.shot, g.src, g.rects, g.rings, A, R);
      // meerdere features uit de gevonden lijst
      const ids = (v.ids && v.ids.length ? v.ids : v.id ? [v.id] : []);
      const fs = ids.filter((x) => /^f:/.test(x)).map((x) => (R.features || [])[+x.slice(2)]).filter(Boolean);
      if (fs.length) return { A, R: { ...R, features: fs } };
      if (it && /^g:/.test(it.id)) { const G = (R.groups || [])[+it.id.slice(2)]; if (!G) return null; if (e.shot === 'popwall') return { A, R: { ...R, groups: [G] } }; return blocksOverride(e.shot, G.src, G.items, G.rings, A, R); }
      // een hele pagina gekozen: de vooraf uitgeknipte elementen van dat scherm worden de blokken
      if (it && it.src) {
        if (['explode', 'float'].includes(e.shot) && eqSrc(it.src, R.heroStill)) return null;
        let ly = (it.layers || []).filter((l) => l.rect.y > 90 || l.rect.h > 120); // geen kleine headerknopjes
        if (GRAB[e.shot] && GRAB[e.shot].purpose === 'row') ly = rowOf(ly);
        ly = ly.slice(0, (GRAB[e.shot] || {}).max || 6);
        if (!ly.length) return null;
        return blocksOverride(e.shot, it.src, ly.map((l) => l.rect), ly.map((l) => l.ring), A, R);
      }
      return null;
    }
    return null;
  }
  // voor pop-wall/features: de grootste reeks gelijksoortige blokken (een rij kaarten, reviews, USP's)
  function rowOf(ly) {
    const sim = (a, b) => Math.abs(a.rect.w - b.rect.w) / Math.max(a.rect.w, b.rect.w) < 0.22 && Math.abs(a.rect.h - b.rect.h) / Math.max(a.rect.h, b.rect.h) < 0.3;
    let best = [];
    ly.forEach((a) => { const c = ly.filter((b) => sim(a, b)); if (c.length > best.length || (c.length === best.length && c.length && c[0].rect.w * c[0].rect.h > best[0].rect.w * best[0].rect.h)) best = c; });
    return best.length >= 2 ? best.sort((a, b) => (Math.abs(a.rect.y - b.rect.y) < 40 ? a.rect.x - b.rect.x : a.rect.y - b.rect.y)) : ly;
  }
  function overrideFor(e, A, R) {
    const slots = MEDIA[e.shot]; if (!slots) return null;
    const m = normalizeMedia(e);
    let cur = { A, R }, changed = false;
    for (const [key, , kind] of slots) {
      if (!m[key]) continue;
      const r = applySlot(e, key, kind, m[key], cur.A, cur.R);
      if (r) { cur = r; changed = true; }
    }
    return changed ? cur : null;
  }
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

  const lidPoint = (u, v) => { const k = (LAPTOP.W - LAPTOP.bezel * 2) / 1920; const lu = LAPTOP.bezel + u * k, lv = LAPTOP.bezel + v * k; const y = lv - LAPTOP.LH; const a = LAPTOP.open * Math.PI / 180; return { px: lu - LAPTOP.W / 2, py: y * Math.cos(a), pz: y * Math.sin(a) }; };
  const kbPoint = (u, v) => ({ px: u - LAPTOP.W / 2, py: 0, pz: v });

  function merge(p) {
    const o = Object.assign({}, DEFAULTS, p || {});
    o.shots = Object.assign({}, DEFAULTS.shots, (p && p.shots) || {});
    o.shotTempo = Object.assign({}, (p && p.shotTempo) || {});
    if (!Array.isArray(o.order)) o.order = DEFAULTS.order.slice();
    DEFAULTS.order.forEach((id) => { if (!o.order.includes(id)) o.order.splice(o.order.length - 1, 0, id); });
    return o;
  }

  const rng = (seed) => { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

  // Welke shots zijn met deze capture mogelijk?
  function available(A, R) {
    return {
      intro: !!R.logo, outro: !!R.logo, laptop: !!R.hero, menu: !!R.menu,
      hover: !!(R.hover && A.hoverPath && A.hoverPath.length >= 2),
      features: !!(R.features && R.features.length), explode: !!(R.heroStill && A.heroLayers && A.heroLayers.length),
      cards: !!(R.cards && A.cards && A.cards.length >= 2), travel: !!(R.travel && R.travel.length >= 2),
      phone: !!(R.mobileScroll || R.mobileMenu), devices: !!(R.hero && (R.mobileScroll || R.mobileMenu)),
      depth: !!R.depth, slide: !!R.slide,
      tracking: !!(R.heroStill || (R.travel || [])[0]), rack: !!(R.features && R.features.length), crane: !!(R.cards || R.heroStill), dolly: !!R.hero, float: !!(R.heroStill && A.heroLayers && A.heroLayers.length),
      pagespin: !!(R.heroStill || (R.travel || [])[0] || R.cards), phonefan: !!(R.mobileScroll || R.mobileMenu), popwall: !!(R.groups && R.groups.length), spin: !!(R.mobileScroll || R.mobileMenu), orbit: !!R.hero, stack: [R.heroStill, ...(R.travel || []), R.cards].filter(Boolean).length >= 3,
      closeup: !!(R.heroStill || (R.travel || [])[0] || R.cards || (R.library || []).length),
      pullback: !!(R.heroStill || (R.travel || [])[0]), longscroll: !!(R.pages && R.pages.length),
    };
  }

  // Generator: een unieke maar logische edit. Ritme: opener (wide) → interactie → close-up → wide → close-up → ... → afsluiter.
  function makeEdit(seed, A, R, opts = {}) {
    const r = rng(seed * 7919 + 13);
    const pick = (arr) => arr[Math.floor(r() * arr.length)];
    const av = available(A, R);
    const has = (s) => av[s];
    const openers = ['laptop', 'phone', 'devices', 'intro', 'features', 'explode', 'orbit', 'spin', 'pagespin', 'phonefan', 'pullback'].filter(has);
    const wides = ['laptop', 'phone', 'devices', 'explode', 'cards', 'travel', 'depth', 'spin', 'orbit', 'longscroll'].filter(has);
    const inter = ['menu', 'slide'].filter(has);
    const closes = ['features', 'popwall', 'tracking', 'rack'].filter(has);
    const used = new Set();
    const take = (pool) => { const DEV = ['laptop', 'phone', 'devices', 'spin', 'orbit', 'phonefan', 'dolly']; const p = pool.filter((s) => !used.has(s) && !(DEV.includes(s) && [...used].filter((u) => DEV.includes(u)).length >= 2)); if (!p.length) return null; const s = pick(p); used.add(s); return s; };
    const seq = [];
    const push = (s) => { if (s) seq.push(s); };
    if (has('intro') && r() < 0.45) { push('intro'); used.add('intro'); }
    push(take(openers.filter((s) => s !== 'intro')));
    const len = opts.length || (5 + Math.floor(r() * 2));
    let wantClose = r() < 0.5;
    while (seq.length < len) {
      let s = null;
      if (wantClose) s = take(closes);
      else s = r() < 0.4 ? take(inter) || take(wides) : take(wides) || take(inter);
      if (!s) s = take([...wides, ...inter, ...closes]);
      if (!s) break;
      push(s);
      wantClose = !wantClose;
    }
    if (has('outro')) push('outro');
    const angleKeys = ['default', 'default', 'low', 'high', 'top', 'dutch-l', 'dutch-r', 'profile', 'close', 'wide'];
    const edit = seq.map((s) => ({ shot: s, angle: s === 'intro' || s === 'outro' ? 'default' : pick(angleKeys), mirror: r() < 0.5, tempo: +(0.92 + r() * 0.16).toFixed(2) }));
    edit.forEach((e) => { if (e.shot === 'phone') e.clip = R.mobileMenu && r() < 0.5 ? 'menu' : 'scroll'; });
    const look = { bgStyle: pick(['studio', 'aurora', 'grid', 'spotlight', 'studio']), energy: +(0.65 + r() * 0.4).toFixed(2), spin: +(0.6 + r() * 0.5).toFixed(2) };
    return { edit, look };
  }

  function describeEdit(edit) {
    return edit.map((e) => `${e.shot}${e.clip ? '(' + e.clip + ')' : ''}${e.angle && e.angle !== 'default' ? '/' + e.angle : ''}${e.mirror ? '/gespiegeld' : ''}`).join(' → ');
  }

  // doelduur: tempo bijsturen tot de totale lengte klopt (paar iteraties, want niet alles schaalt lineair)
  function buildTimeline(A, R, params) {
    const P0 = merge(params);
    const want = +P0.length || 0;
    if (!(want > 2)) return buildOnce(A, R, P0);
    let tempo = P0.tempo, tl = buildOnce(A, R, P0), dropped = [];
    // te kort voor alle shots? eerst minst belangrijke shots laten vallen, dan pas versnellen
    const DROP = ['depth', 'slide', 'intro', 'travel', 'pullback', 'longscroll', 'explode', 'devices', 'cards', 'hover', 'menu', 'phone', 'features'];
    let edit = tl.edit.slice();
    while (want / tl.duration * tempo < 0.72 * P0.tempo && edit.length > 3) {
      const keep0 = edit.findIndex((e) => e.shot !== 'intro');
      const idx = DROP.map((d) => edit.findIndex((e, j) => e.shot === d && j !== keep0)).find((j) => j >= 0);
      if (idx == null) break;
      dropped.push(edit[idx].shot); edit.splice(idx, 1);
      tl = buildOnce(A, R, Object.assign({}, P0, { edit, variation: 0 }));
    }
    const P1 = dropped.length ? Object.assign({}, P0, { edit, variation: 0 }) : P0;
    for (let i = 0; i < 4; i++) {
      if (i) tl = buildOnce(A, R, Object.assign({}, P1, { tempo }));
      const f = want / tl.duration;
      if (Math.abs(f - 1) < 0.015) break;
      const nt = Math.max(0.4, Math.min(2.2, tempo * f));
      if (Math.abs(nt - tempo) < 0.002) break;
      tempo = nt;
      if (i === 3) tl = buildOnce(A, R, Object.assign({}, P1, { tempo }));
    }
    tl.params = Object.assign({}, P0);
    tl.effectiveTempo = +tempo.toFixed(3);
    tl.dropped = dropped;
    return tl;
  }

  function buildOnce(A, R, params) {
    let P = merge(params);
    // edit bepalen
    let edit = Array.isArray(P.edit) && P.edit.length ? P.edit : null;
    if (!edit && P.variation > 0) edit = makeEdit(P.variation, A, R).edit;
    if (!edit) edit = P.order.filter((id) => P.shots[id]).map((id) => ({ shot: id }));
    // 'meer laptop' / 'alles laptop' voegt alleen een laptop-shot toe als je die niet zelf hebt uitgezet en er al iets in de edit staat
    const ownEdit = Array.isArray(P.edit) && P.edit.length;
    const mayAddLaptop = R.hero && P.shots.laptop !== false && !ownEdit && edit.some((e) => !['intro', 'outro'].includes(e.shot));
    if (P.device === 'more' && mayAddLaptop && !edit.some((e) => e.shot === 'laptop')) edit.splice(edit[0] && edit[0].shot === 'intro' ? 1 : 0, 0, { shot: 'laptop' });
    if (P.device === 'laptop') {
      edit = edit.filter((e) => !['phone', 'devices'].includes(e.shot));
      if (mayAddLaptop && !edit.some((e) => e.shot === 'laptop')) edit.splice(edit[0] && edit[0].shot === 'intro' ? 1 : 0, 0, { shot: 'laptop' });
    }

    const [VW, VH] = FORMATS[P.format] || FORMATS['9:16'];
    const tall = VH / VW;
    let tp = P.tempo;
    const en = P.energy;
    let V = { k: 1, fy: 1, fz: 1, fw: 1, rxAdd: 0, ryAdd: 0, rzAdd: 0, zoom: 1 };
    const cl = (v, m) => Math.max(-m, Math.min(m, v));
    // hoeken begrensd: nooit (bijna) op de kant, zodat het beeld leesbaar blijft
    const TX = (v) => cl(v * P.tilt * (0.6 + 0.4 * en) * V.k + (v === 0 ? 0 : V.rxAdd), 66);
    const SZ = (v) => cl(v * P.spin * (0.6 + 0.4 * en) * V.k * V.fz + (v === 0 ? 0 : V.rzAdd * V.fz), 38);
    const SY = (v) => cl(v * (0.5 + 0.5 * en) * V.k * V.fy + (v === 0 ? 0 : V.ryAdd * V.fy), 52);
    const ZM = (v) => v * P.zoom * V.zoom;
    const WH = (v) => v * (0.7 + 0.3 * en) * V.fw;
    const H = (v) => v * P.hold;
    const up = (v) => v * Math.min(1.15, 0.72 + 0.28 * tall);
    const db = Math.min(1.4, P.dof), dwf = P.dof > 0 ? 1.35 / Math.max(0.35, P.dof) : 1; // ruimere scherpte rond het focuspunt
    const fly = 1 + 0.6 * Math.max(0, P.ramp);
    const slow = (w = 0.45) => (P.ramp > 0 ? { w, min: Math.max(0.3, 1 - 0.55 * P.ramp) } : null);

    const objects = [];
    const sfx = [];
    let curShot = null;
    const add = (o) => { if ((P.device === 'laptop' || P.device === 'more') && o.type === 'plane' && o.src && !o.lifts && ['menu', 'hover', 'depth', 'slide'].includes(curShot)) o._toLaptop = true; objects.push(o); return o; };
    const kf = (o, t, p, ease = 'flow') => { o.kfs.push({ t: +t.toFixed(3), ease, ...p }); return o; };
    // fin: defaults invullen + speed ramps (shot begint en eindigt op snelheid, rustig midden)
    const fin = (o, opts = {}) => {
      o.kfs.sort((a, b) => a.t - b.t);
      let prev = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, s: 1, o: 1, px: 0, py: 0, pz: 0, fz: 0, dw: 90, db: 1, lift: 0, mx: 0, my: 0, ms: 1 };
      o.kfs = o.kfs.map((k) => (prev = { ...prev, ...k }));
      o.kfs.forEach((k) => { k.db = k.db * db; k.dw = k.dw * dwf; });
      // kadrering op het element dat loskomt: draaipunt beweegt mee met de lift (anders schuift het opgetilde element uit het midden bij draaien)
      if (opts.pivotLift) o.kfs.forEach((k) => { k.pz = (k.lift || 0) * opts.pivotLift; k.fz = 0; });
      // kadrering: paginavlakken nooit extreem dichtbij (onscherp en onrustig)
      if (o.type === 'plane' && o.w === 1920) { const cap = 1.9 * P.zoom; o.kfs.forEach((k, i) => { if (i > 0 && i < o.kfs.length - 1 && k.s > cap) k.s = cap; }); }
      // camera-rust: tussen-keyframes dichter bij het midden en geen grote zwaaien links/rechts
      if (!o.crazy && o.type !== 'fill' && o.type !== 'cursor' && o.kfs.length > 2 && P.calm > 0) {
        const c = Math.max(0, Math.min(1, P.calm)), lim = 26 * (1 - c) + 7;
        for (let i = 1; i < o.kfs.length - 1; i++) {
          const k = o.kfs[i], pv = o.kfs[i - 1];
          k.x *= 1 - 0.6 * c;
          if (i > 1) { k.ry = pv.ry + clamp(k.ry - pv.ry, -lim, lim); k.rz = pv.rz + clamp(k.rz - pv.rz, -lim * 0.5, lim * 0.5); }
        }
      }
      if (o._toLaptop) toLaptop(o);
      if (!o.crazy && o.type !== 'fill' && o.type !== 'cursor' && o.kfs.length > 2 && P.transition !== 'mix' && P.transition !== 'whip') shapeTransition(o);
      if (opts.ramp !== false && o.kfs.length > 2) {
        const n = o.kfs.length;
        if (o.kfs[1].ease === 'flow' && opts.flyIn !== false) o.kfs[0].fly = fly;
        if (['whipIn', 'in'].includes(o.kfs[n - 1].ease)) { o.kfs[n - 1].ease = 'flow'; o.kfs[n - 1].fly = fly; }
      }
    };
    // alles-in-de-laptop: een los paginavlak wordt het scherm van een laptop (zelfde kadrering, omgerekend naar het scherm)
    const toLaptop = (o) => {
      const k = 1920 / (LAPTOP.W - LAPTOP.bezel * 2);
      o.type = 'laptop'; o.screen = o.src; delete o.src; delete o.w; delete o.h; delete o.radius; delete o._toLaptop;
      o.kfs.forEach((f) => { const lp = lidPoint(f.px, f.py); f.px = lp.px; f.py = lp.py; f.pz = lp.pz; f.s = f.s * k * 0.92; f.rx = clamp(f.rx * 0.55 - 22, -42, 4); });
    };
    // overgangen: 'clean' = zachte dip met kleine drift, 'zoom' = crash zoom in/uit; 'mix'/'whip' = whips zoals gemaakt
    const shapeTransition = (o) => {
      const n = o.kfs.length, a = o.kfs[0], b = o.kfs[1], y = o.kfs[n - 2], z = o.kfs[n - 1];
      const far = (k, ref) => Math.hypot(k.x - ref.x, k.y - ref.y) > 350 || Math.abs(k.s / (ref.s || 1) - 1) > 0.8 || Math.abs(k.z - ref.z) > 250;
      const soft = (k, ref, mul) => {
        k.x = ref.x + (k.x - ref.x) * mul; k.y = ref.y + (k.y - ref.y) * mul; k.z = ref.z + clamp(k.z - ref.z, -60, 60);
        k.rz = ref.rz + clamp(k.rz - ref.rz, -3, 3); k.ry = ref.ry + clamp(k.ry - ref.ry, -8, 8); k.rx = ref.rx + clamp(k.rx - ref.rx, -6, 6);
      };
      if (P.transition === 'glide') {
        // vliegende overgang: zelfde richting houden, minder ver en zonder harde draai/rol; camera blijft doorbewegen
        const g = (k, ref) => { k.x = ref.x + (k.x - ref.x) * 0.6; k.y = ref.y + (k.y - ref.y) * 0.6; k.rz = ref.rz + clamp(k.rz - ref.rz, -7, 7); k.ry = ref.ry + clamp(k.ry - ref.ry, -14, 14); k.rx = ref.rx + clamp(k.rx - ref.rx, -10, 10); k.s = ref.s * clamp(k.s / (ref.s || 1), 0.85, 1.25); };
        if (far(a, b) && !a.noGlide) g(a, b);
        if (far(z, y) && !z.noGlide) g(z, y);
        return;
      }
      if (far(a, b) && !a.noGlide) {
        if (P.transition === 'zoom') { soft(a, b, 0.05); a.s = b.s * 0.55; a.o = 0; }
        else { soft(a, b, 0.1); a.s = b.s * 0.95; a.o = 0; }
      }
      if (far(z, y) && !z.noGlide) {
        if (P.transition === 'zoom') { soft(z, y, 0.05); z.s = y.s * 1.9; z.o = 0; }
        else { soft(z, y, 0.1); z.s = y.s * 1.04; z.o = 0; }
      }
    };
    const cursor = { id: 'cursor', type: 'cursor', kfs: [], clicks: [] };
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const cen = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
    const pathAt = (path, t) => {
      if (!path || !path.length) return null;
      if (t <= path[0].t) return path[0];
      for (let i = 1; i < path.length; i++) if (t <= path[i].t) { const a = path[i - 1], b = path[i], u = (t - a.t) / Math.max(1e-6, b.t - a.t); return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }; }
      return path[path.length - 1];
    };
    // hoe knippen we een element schoon uit? egale ondergrond = effen gat; foto/verloop = geen gat, element dekt zichzelf af
    const cut = (ring, extra = {}, th = 16) => {
      // egaal: effen gat; anders een clean plate (opgevulde ondergrond); alleen zonder plate valt hij terug op 'cover'
      if (ring && ring.plate && (ring.std >= 5 || ring.std >= th)) return { patchMode: 'plate', plate: ring.plate, ...extra };
      if (ring && ring.std < th) return { patchMode: 'solid', patch: ring.color, ...extra };
      return { patchMode: 'none', cover: true, ...extra, max: Math.min(extra.max || 60, 50) };
    };
    const ev = (t, type, o = {}) => sfx.push({ t: +t.toFixed(3), type, gain: 1, pan: 0, ...o });
    // captions: korte tekstregel in beeld (kicker + regel). Per shot uit te zetten of te vervangen via e.caption.
    const captions = [];
    const host = (R.host || '').replace(/^www\./, '');
    // tekst opschonen: dubbele stukken uit een lopende tekst (marquee) eruit, losse restjes weg, SCHREEUWTEKST naar zinsopmaak, inkorten op een woordgrens
    const clean = (s, n = 56) => {
      s = String(s || '').replace(/\s+/g, ' ').trim();
      const parts = s.split(/\s*[·|•]\s*/).map((p) => p.trim()).filter((p) => p.length >= 3);
      const seen = new Set(); const uniq = parts.filter((p) => { const k = p.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
      if (uniq.length) s = uniq.join(' · ');
      const letters = s.replace(/[^\p{L}]/gu, ''); const caps = letters.replace(/[^\p{Lu}]/gu, '');
      if (letters.length >= 6 && caps.length / letters.length > 0.8) s = s.toLowerCase().replace(/(^|[.!?·]\s*)(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
      if (s.length > n) { s = s.slice(0, n); s = s.replace(/\s+\S*$/, '') + '…'; }
      return s;
    };
    const KICK = { trust: 'Reviews', stat: 'Cijfers', offer: 'Aanbod', price: 'Prijzen', service: 'Service', cards: 'Collectie', reviews: 'Reviews', usps: 'Waarom', usp: 'Waarom', stats: 'Cijfers', eigen: '' };
    let headlineUsed = false, hostUsed = false;
    const capDone = new Set();
    const cap = (t0, t1, text, sub, pos) => {
      if (!P.captions || !text) return;
      if (cur.caption === false) return;
      if (cur.caption && cur.caption.text !== undefined) { if (capDone.has(cur)) return; capDone.add(cur); text = cur.caption.text; sub = cur.caption.sub; pos = cur.caption.pos || pos; }
      if (t1 - t0 < 0.8) return;
      text = clean(text); if (text.replace(/[^\p{L}\p{N}]/gu, '').length < 3) return; // '37' of '…' is geen tekstregel
      captions.push({ t0: +t0.toFixed(3), t1: +t1.toFixed(3), text, sub: clean(sub || '', 28), pos: pos || 'bl' });
    };
    const headlineOnce = () => { if (headlineUsed || !A.headline) return null; headlineUsed = true; return A.headline; };
    const shotsOut = []; const swaps = []; // bewuste snelle wissels binnen een shot (carrousel), QA telt die als overgang
    const camSegs = [];
    // bewegingsrichting doorzetten tussen shots: wat links het beeld uit gaat, komt rechts het volgende binnen
    let lastExit = { x: -1, y: 0 };
    const IN = (dist) => ({ x: -lastExit.x * dist, y: -lastExit.y * dist });
    const OUT = (dir, dist) => { const l = Math.hypot(dir.x, dir.y) || 1; lastExit = { x: dir.x / l, y: dir.y / l }; return { x: lastExit.x * dist, y: lastExit.y * dist }; };
    const OUTZ = () => { lastExit = { x: 0, y: 0.0001 }; };
    let T = 0;
    const SHOT = {};
    let cur = {};

    // ---- intro: logo, klik, crash zoom ----
    SHOT.intro = () => {
      if (!R.logo) return;
      const at = (x) => T + x * tp;
      const L = add({ id: 'intro-logo', type: 'crop', src: R.logoSrc, crop: R.logo.crop, w: R.logo.w, h: R.logo.h, radius: 26, kfs: [] });
      const base = { px: R.logo.w / 2, py: R.logo.h / 2, db: 0 };
      kf(L, at(0), { ...base, z: -900, rx: TX(26), ry: SY(-38), rz: SZ(-6), s: 1, o: 0 }, 'out');
      kf(L, at(0.6), { z: 0, rx: TX(8), ry: SY(-12), rz: SZ(-3), o: 1 }, 'silk');
      kf(L, at(0.9), { rx: TX(5), ry: SY(-7), rz: SZ(-2), s: 1.01 }, 'flow');
      kf(L, at(0.97), { s: 0.93 }, 'out');
      kf(L, at(1.05), { s: 1.0 }, 'out');
      kf(L, at(1.4), { s: 16, z: 200, rx: 0, ry: 0, rz: 0 }, 'in');
      fin(L, { flyIn: false });
      ev(at(0.05), 'whoosh', { dur: 0.7, gain: 0.55, pan: 0.2, bright: 0.5 });
      if (P.cursor) {
        kf(cursor, at(0.15), { x: VW + 60, y: VH * 0.8, o: 1 }, 'flow');
        kf(cursor, at(0.88), { obj: 'intro-logo', u: R.logo.w * 0.62, v: R.logo.h * 0.58 }, 'silk');
        kf(cursor, at(1.07), { obj: 'intro-logo', u: R.logo.w * 0.62, v: R.logo.h * 0.58, o: 1 }, 'linear');
        kf(cursor, at(1.2), { obj: 'intro-logo', u: R.logo.w * 0.62, v: R.logo.h * 0.58, o: 0 }, 'linear');
        cursor.clicks.push(at(0.95));
      }
      ev(at(0.95), 'click');
      ev(at(0.98), 'riser', { dur: 0.42 * tp, gain: 0.6 });
      ev(at(1.4), 'impact', { gain: 0.8 });
      const F = add({ id: 'fill-cream', type: 'fill', color: R.logoBg || '#f5f0e8', kfs: [] });
      kf(F, at(1.2), { o: 0 }, 'linear'); kf(F, at(1.38), { o: 1 }, 'in'); kf(F, at(1.38) + 0.32, { o: 0 }, 'out'); fin(F, { ramp: false });
      shotsOut.push({ id: 'intro', start: T, end: at(1.38) });
      T = at(1.38);
    };

    // ---- laptop swoop ----
    SHOT.laptop = () => {
      if (!R.hero) return;
      const at = (x) => T + x * tp;
      const keyLocal = 2.55 + (H(0.35) - 0.35);
      const d = keyLocal + 0.8 + H(0.2);
      const keyAbs = at(keyLocal);
      const sl = slow(0.5);
      const Lp = add({ id: 'laptop' + T.toFixed(2), type: 'laptop', screen: { ...R.hero, map: { t0: T, c0: Math.max(0, A.heroKey - keyLocal * tp), rate: 1, ramp: sl ? [{ t: keyAbs + 0.15, ...sl }] : [] } }, kfs: [] });
      const scr = lidPoint(960, 470);
      const g = A.heroGroup;
      const gc = g ? cen(g) : (A.heroFocus || { x: 960, y: 540 });
      const gp = lidPoint(gc.x, gc.y);
      const gs = g ? clamp(VW * 0.88 / (g.w * 0.75), 1.0, 2.4) : 1.6;
      kf(Lp, at(0), { ...kbPoint(750, 360), rx: TX(-74), rz: SZ(-34), s: ZM(1.4), z: 160, y: up(80), dw: 70 }, 'flow');
      kf(Lp, at(0.65), { ...kbPoint(760, 170), rx: TX(-64), rz: SZ(-29), s: ZM(1.2), z: 0, y: up(20) }, 'flow');
      kf(Lp, at(1.75), { ...scr, rx: TX(-27), rz: SZ(-11), s: ZM(1.0), y: up(-50) }, 'flow');
      kf(Lp, at(keyLocal + 0.2), { ...gp, rx: TX(-24), rz: SZ(-5), s: ZM(gs), y: 0, x: 0, dw: 70 }, 'flow');
      kf(Lp, at(d - 0.2), { ...gp, rx: TX(-25), rz: SZ(-6), s: ZM(gs * 1.04) }, 'flow');
      kf(Lp, at(d), { ...gp, ...OUT({ x: -V.fw, y: 0 }, 1900), rz: SZ(-22), s: ZM(gs * 1.15) }, 'whipIn');
      fin(Lp);
      ev(at(0.1), 'whoosh', { dur: 1.2 * tp, gain: 0.5, pan: -0.3, bright: 0.35 });
      ev(keyAbs, 'tick', { gain: 0.55 });
      shotsOut.push({ id: 'laptop', start: T, end: at(d) });
      T = at(d);
    };

    // ---- telefoon met mobiele site ----
    SHOT.phone = () => {
      const useMenu = cur.clip === 'menu' ? !!R.mobileMenu : !R.mobileScroll;
      const src = useMenu ? R.mobileMenu : R.mobileScroll;
      if (!src) return;
      const at = (x) => T + x * tp;
      const d = 2.9 + H(0.3);
      const tapT = useMenu && A.mobileMenuTap ? A.mobileMenuTap.t : 1.0;
      const keyLocal = 1.1;
      const c0 = useMenu ? Math.max(0, tapT - keyLocal * tp) : 0.3;
      const sl = slow(0.5);
      const rate = useMenu ? 1 : Math.min(1.4, Math.max(0.8, ((A.mobileScrollDur || 5) - 0.6) / (d * tp)));
      const Ph = add({ id: 'phone' + T.toFixed(2), type: 'phone', screen: { ...src, map: { t0: T, c0, rate, ramp: useMenu && sl ? [{ t: at(keyLocal) + 0.25, ...sl }] : [] } }, kfs: [] });
      const s0 = ZM(clamp(VH * 0.62 / 884, 0.8, 1.6));
      const pin = IN(1300);
      kf(Ph, at(0), { px: 0, py: 0, x: pin.x, y: up(40) + pin.y, s: s0 * 1.05, rx: TX(10), ry: SY(-40), rz: SZ(-8), dw: 90 }, 'flow');
      kf(Ph, at(0.45), { x: pin.x * 0.04, y: up(40), ry: SY(-30), rz: SZ(-7) }, 'flow');
      kf(Ph, at(1.5), { x: 0, ry: SY(-6), rx: TX(6), rz: SZ(-3), s: s0 }, 'flow');
      kf(Ph, at(d - 0.35), { ry: SY(22), rx: TX(4), rz: SZ(3), s: s0 * 1.08, y: up(-20) }, 'flow');
      kf(Ph, at(d), { ...OUT({ x: -V.fw, y: 0.15 }, 1600), ry: SY(40), rz: SZ(14) }, 'whipIn');
      fin(Ph);
      ev(at(0.05), 'whoosh', { dur: 0.6, gain: 0.55, pan: 0.5, bright: 0.55 });
      if (useMenu && A.mobileMenuTap) {
        const tt = at(keyLocal);
        kf(cursor, tt - 0.3, { obj: Ph.id, u: A.mobileMenuTap.x, v: A.mobileMenuTap.y, o: 0 }, 'linear');
        kf(cursor, tt + 0.5, { obj: Ph.id, u: A.mobileMenuTap.x, v: A.mobileMenuTap.y, o: 0 }, 'linear');
        cursor.clicks.push(tt);
        ev(tt, 'tap');
        ev(tt + 0.08, 'whoosh', { dur: 0.5, gain: 0.3, pan: 0.2, bright: 0.7 });
      }
      shotsOut.push({ id: 'phone', start: T, end: at(d) });
      T = at(d);
    };

    // ---- laptop + telefoon samen, camera draait eromheen ----
    SHOT.devices = () => {
      const src = R.mobileScroll || R.mobileMenu;
      if (!R.hero || !src) return;
      const at = (x) => T + x * tp;
      const d = 3.1 + H(0.3);
      const f = V.fy;
      const lapPose = { x: -300 * f, y: 120, z: -1000, rx: -20, ry: 26 * f, rz: 0 };
      const phPose = { x: 250 * f, y: 170, z: 120, rx: 4, ry: -20 * f, rz: -3 * f };
      const Lp = add({ id: 'dev-laptop' + T.toFixed(2), type: 'laptop', camFocus: true, screen: { ...R.hero, map: { t0: T, c0: 0.4, rate: 1 } }, kfs: [] });
      const Ph = add({ id: 'dev-phone' + T.toFixed(2), type: 'phone', camFocus: true, screen: { ...src, map: { t0: T, c0: 0.3, rate: 1 } }, kfs: [] });
      const lpv = lidPoint(960, 540);
      kf(Lp, at(0), { ...lpv, s: 0.95, dw: 120, ...lapPose }, 'linear'); kf(Lp, at(d), {}, 'linear'); fin(Lp, { ramp: false });
      kf(Ph, at(0), { px: 0, py: 0, s: 1.0, dw: 110, ...phPose }, 'linear'); kf(Ph, at(d), {}, 'linear'); fin(Ph, { ramp: false });
      const seg = { kfs: [] };
      const ck = (x, pose, ease = 'flow') => seg.kfs.push({ t: +at(x).toFixed(3), ease, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, fz: 0, ...pose });
      const e = 0.6 + 0.4 * en;
      ck(0, { x: 280 * f + lastExit.x * 1500, y: 140 + lastExit.y * 1500, z: 520, ry: -14 * f * e, rz: -6 * f * e, fz: 120 - 520 });
      ck(0.4, { x: 280 * f, y: 140, z: 480, ry: -10 * f * e, rz: -4 * f * e, fz: 120 - 480 });
      ck(1.6, { x: 60 * f, y: 60, z: 1150, ry: 4 * f * e, rz: 1 * f * e, fz: 120 - 1150 });
      ck(d - 0.35, { x: -140 * f, y: 30, z: 1300, ry: 14 * f * e, rz: 3 * f * e, fz: 120 - 1300 });
      ck(d, { x: -140 * f - 1700 * f, y: 30, z: 1300, ry: 22 * f * e, rz: 10 * f * e, fz: 120 - 1300 });
      lastExit = { x: f, y: 0 };
      seg.kfs[0].fly = fly; seg.kfs[seg.kfs.length - 1].fly = fly;
      camSegs.push(seg);
      ev(at(0.02), 'whoosh', { dur: 0.7, gain: 0.55, pan: 0.5 * f, bright: 0.5 });
      shotsOut.push({ id: 'devices', start: T, end: at(d) });
      T = at(d);
    };

    // ---- menu: macro, muis volgen, klik, slow-mo terwijl menu opent, duik erin ----
    SHOT.menu = () => {
      if (!R.menu) return;
      const at = (x) => T + x * tp;
      const keyLocal = 0.95;
      const d = 3.1 + H(0.3);
      const f = A.menuFocus;
      // menu moet echt open staan voor de duik: trage menu's iets versneld afspelen, snelle krijgen slow-mo
      const span = Math.max(0.3, (A.menuOpen || A.menuKey + 1.1) - A.menuKey);
      const mrate = clamp(span / (1.2 * tp), 1, 2.2);
      const c0 = Math.max(0, A.menuKey - keyLocal * tp * mrate);
      const sl = mrate < 1.15 ? slow(0.55) : null;
      const M = add({ id: 'menu' + T.toFixed(2), type: 'plane', w: 1920, h: 1080, radius: 18, src: { ...R.menu, map: { t0: T, c0, rate: mrate, ramp: sl ? [{ t: at(keyLocal) + 0.45, ...sl }] : [] } }, kfs: [] });
      const g = A.menuGroup || { x: f.x - 40, y: f.y - 40, w: 80, h: 80 };
      const gc = cen(g);
      const ms = clamp(VW * 0.7 / g.w, 1.3, 2.1);
      const track = (lt) => { const cp = pathAt(A.menuPath, c0 + lt * tp * mrate); return cp ? { px: gc.x * 0.72 + cp.x * 0.28, py: gc.y * 0.72 + Math.min(1000, cp.y) * 0.28 } : { px: gc.x, py: gc.y }; };
      const min_ = IN(1700);
      kf(M, at(0), { ...track(0), x: min_.x, y: up(-80) + min_.y, s: ZM(ms), rx: TX(20), ry: SY(-26), rz: SZ(-10), dw: 110 }, 'flow');
      kf(M, at(0.34), { ...track(0.34), x: 0, y: up(-80), ry: SY(-22), rz: SZ(-9) }, 'flow');
      kf(M, at(0.66), { ...track(0.66), ry: SY(-20), rx: TX(19) }, 'flow');
      kf(M, at(keyLocal), { px: f.x * 0.6 + gc.x * 0.4, py: f.y * 0.6 + gc.y * 0.4, s: ZM(ms * 1.12), ry: SY(-18), rx: TX(18), y: up(-70) }, 'flow');
      kf(M, at(keyLocal + 0.5), { s: ZM(ms * 0.8), ry: SY(-8), rx: TX(16), y: up(-60) }, 'flow');
      // na het openen: kadreren op het geopende menu (links die pas na de klik zichtbaar werden)
      const mr = A.menuRect && A.menuRect.w * A.menuRect.h < 1920 * 1080 * 0.75 ? A.menuRect : null;
      const mc = mr ? { x: mr.x + mr.w * 0.44, y: mr.y + mr.h / 2 } : { x: 1160, y: 520 };
      const mfit = mr ? clamp(Math.min(VW * 0.86 / mr.w, VH * 0.6 / mr.h), 0.75, 1.9) : 0.98;
      kf(M, at(2.15), { ...(mr ? { fr: mr } : {}), px: mc.x, py: mc.y, s: ZM(mfit), rx: TX(14), ry: SY(mr ? 18 : 24), rz: SZ(-5), y: up(-40), dw: 110 }, 'flow');
      kf(M, at(d - 0.35), { s: ZM(mfit * 1.08), ry: SY(mr ? 10 : 16), rx: TX(10), y: up(-30) }, 'flow');
      // geen duik door de pagina: vloeiend zijwaarts uitvliegen
      kf(M, at(d), { ...OUT({ x: -V.fw, y: 0.12 }, 1500), s: ZM(mfit * 1.14), ry: SY(-6), rz: SZ(-6) }, 'whipIn');
      fin(M);
      ev(at(keyLocal), 'click');
      ev(at(keyLocal) + 0.1, 'whoosh', { dur: 0.9, gain: 0.35, pan: -0.4, bright: 0.3 });
      ev(at(d) - 0.2, 'whoosh', { dur: 0.6, gain: 0.5, pan: -0.5 * V.fw, bright: 0.5 });
      shotsOut.push({ id: 'menu', start: T, end: at(d) });
      T = at(d);
    };

    // ---- pop-wall (Apple-achtig): strak, bijna frontaal, blok voor blok los, eindigt op het geheel ----
    SHOT.popwall = () => {
      const G = (R.groups || [])[cur.group || 0] || (R.groups || [])[0];
      if (!G || !G.items || G.items.length < 3) return;
      const items = G.items.slice(0, 5), n = items.length;
      const at = (x) => T + x * tp;
      const per = 0.72 * P.hold, d = 0.45 + n * per + 1.1;
      const lm = 70 * P.lift;
      const lifts = items.map((r, i) => ({ rect: r, radius: 16, stagger: i / n, win: 1.1 / n, ...cut((G.rings || [])[i], { max: lm }) }));
      const O = add({ id: 'popwall' + T.toFixed(2), type: 'plane', w: 1920, h: 1080, radius: 18, src: G.src, lifts, kfs: [] });
      const wItem = items.reduce((a, r) => a + r.w, 0) / n;
      const sItem = ZM(clamp(VW * 0.74 / wItem, 0.6, 1.7));
      const g = G.rect, sAll = ZM(clamp(VW * 0.94 / g.w, 0.45, 1.2));
      const pin = IN(900);
      const c0 = cen(items[0]);
      // lift loopt van 0 naar 1 over de blokken; per blok komt de camera ernaar toe
      const lAt = (i) => Math.min(1, (i + 0.95) / n);
      kf(O, at(0), { px: c0.x, py: c0.y, x: pin.x, y: up(-20) + pin.y, s: sItem * 0.94, rx: TX(8), ry: SY(-10), rz: SZ(-2), lift: 0, dw: 160, db: 0.6 }, 'flow');
      items.forEach((r, i) => {
        const c = cen(r);
        kf(O, at(0.45 + i * per), { fr: r, px: c.x, py: c.y, x: 0, y: up(-20), s: sItem, rx: TX(13), ry: SY(-20 + 40 * i / Math.max(1, n - 1)), rz: SZ(-3 + 6 * i / Math.max(1, n - 1)), lift: lAt(i) }, 'flow');
        ev(at(0.45 + i * per) - 0.05, 'pop', { gain: 0.45, pan: (i / Math.max(1, n - 1) - 0.5) * 0.8 });
        // de cursor klikt door de blokken heen: klik = blok komt los
        if (P.cursor) {
          const tc = at(0.45 + i * per) - 0.12;
          kf(cursor, Math.max(T + 0.02, tc - 0.32), { obj: O.id, u: c.x + r.w * 0.18, v: c.y + r.h * 0.22, o: i ? 1 : 0 }, 'silk');
          kf(cursor, tc, { obj: O.id, u: c.x + r.w * 0.06, v: c.y + r.h * 0.08, o: 1 }, 'silk');
          cursor.clicks.push(tc);
          ev(tc, 'click', { gain: 0.8 });
        }
        if (i) ev(at(0.45 + i * per) - 0.3, 'whoosh', { dur: 0.5, gain: 0.18, pan: 0.3, bright: 0.4 });
      });
      if (P.cursor) kf(cursor, at(d - 0.4), { obj: O.id, u: g.x + g.w * 0.8, v: g.y + g.h * 1.1, o: 0 }, 'silk');
      kf(O, at(d - 0.55), { fr: g, px: g.x + g.w / 2, py: g.y + g.h / 2, s: sAll, rx: TX(22), ry: SY(-14), rz: SZ(-4), lift: 1, y: up(-10) }, 'flow');
      kf(O, at(d), { ...OUT({ x: -V.fw, y: 0.1 }, 1300), s: sAll * 1.05 }, 'whipIn');
      fin(O, { flyIn: true });
      shotsOut.push({ id: 'popwall', start: T, end: at(d) });
      T = at(d);
    };

    // ---- tracking close-up: macro langs de kop, camera glijdt met constante snelheid, ondiepe scherpte ----
    SHOT.tracking = () => {
      const src = R.heroStill || (R.travel || [])[0]; if (!src) return;
      const hlr = (R.heroStill && ((A.heroLayers || []).find((t) => /head/.test(t.role)) || {}).rect) || (A.travelFocus || [])[0];
      const r = hlr || { x: 200, y: 300, w: 1000, h: 250 };
      const at = (x) => T + x * tp;
      const d = 2.9 + H(0.3);
      const f = V.fw;
      const sM = ZM(clamp(VW * 1.35 / r.w, 1.1, 1.85));
      const y0 = r.y + r.h * 0.5;
      const xa = r.x + r.w * (f > 0 ? 0.12 : 0.88), xb = r.x + r.w * (f > 0 ? 0.88 : 0.12);
      const O = add({ id: 'tracking' + T.toFixed(2), type: 'plane', w: 1920, h: 1080, radius: 18, src, kfs: [] });
      kf(O, at(0), { px: xa, py: y0, x: IN(900).x, y: 0, s: sM * 0.94, rx: TX(26), ry: SY(-16 * f), rz: SZ(-3 * f), dw: 55, db: 1.25 }, 'flow');
      kf(O, at(0.4), { px: xa + (xb - xa) * 0.1, x: 0, s: sM }, 'flow');
      kf(O, at(d * 0.55), { px: xa + (xb - xa) * 0.55, ry: SY(-4 * f), rx: TX(22) }, 'flow');
      kf(O, at(d - 0.3), { px: xb, ry: SY(10 * f), rx: TX(20), s: sM * 1.04 }, 'flow');
      kf(O, at(d), { ...OUT({ x: -f, y: 0 }, 1300) }, 'whipIn');
      fin(O, { flyIn: true });
      ev(at(0.05), 'whoosh', { dur: 0.8, gain: 0.35, pan: -0.4 * f, bright: 0.4 });
      shotsOut.push({ id: 'tracking', start: T, end: at(d) });
      T = at(d);
    };
    // ---- rack focus: element staat los boven de pagina, scherpte trekt van de pagina naar het element ----
    SHOT.rack = () => {
      const fe = (R.features || [])[0]; if (!fe) return;
      const at = (x) => T + x * tp;
      const d = 2.8 + H(0.3);
      const r = fe.rect, c = cen(r), lm = 120 * P.lift;
      const O = add({ id: 'rack' + T.toFixed(2), type: 'plane', w: 1920, h: 1080, radius: 18, src: fe.src, lifts: [{ rect: r, radius: Math.abs(r.w - r.h) < 14 ? r.w / 2 : 12, stagger: 0, ...cut(fe.ring, { max: lm }) }], kfs: [] });
      const sF = ZM(clamp(VW * 0.62 / r.w, 0.8, 1.7));
      const f = V.fw;
      // focus eerst op de pagina erachter (element wazig), dan rack naar het element
      kf(O, at(0), { px: c.x, py: c.y + 60, x: IN(900).x, s: sF * 0.92, rx: TX(24), ry: SY(-20 * f), rz: SZ(-4 * f), lift: 1, fz: -60, dw: 26, db: 1.4 }, 'flow');
      kf(O, at(0.4), { x: 0, s: sF * 0.96, lift: 1, fz: -60 }, 'flow');
      kf(O, at(1.2), { fz: -40, ry: SY(-12 * f), fr: r }, 'flow');
      kf(O, at(1.7), { fz: lm + 6, ry: SY(-8 * f), s: sF, fr: r }, 'flow');
      kf(O, at(d - 0.3), { fz: lm + 6, ry: SY(4 * f), s: sF * 1.06, rx: TX(18), fr: r }, 'flow');
      kf(O, at(d), { ...OUT({ x: -f, y: 0.1 }, 1300) }, 'whipIn');
      fin(O, { flyIn: true });
      ev(at(1.45), 'tick', { gain: 0.4 });
      shotsOut.push({ id: 'rack', start: T, end: at(d) });
      T = at(d);
    };
    // ---- crane: pagina ligt als vloer, camera zakt van hoog naar ooghoogte terwijl hij naar voren vliegt ----
    SHOT.crane = () => {
      const src = R.cards || R.heroStill || (R.travel || [])[0]; if (!src) return;
      const at = (x) => T + x * tp;
      const d = 3.0 + H(0.3);
      const f = V.fw;
      const fr = R.cards && A.cards && A.cards.length ? { x: Math.min(...A.cards.map((c) => c.rect.x)), y: Math.min(...A.cards.map((c) => c.rect.y)), w: Math.max(...A.cards.map((c) => c.rect.x + c.rect.w)) - Math.min(...A.cards.map((c) => c.rect.x)), h: Math.max(...A.cards.map((c) => c.rect.y + c.rect.h)) - Math.min(...A.cards.map((c) => c.rect.y)) } : { x: 200, y: 150, w: 1520, h: 780 };
      const c = cen(fr);
      const O = add({ id: 'crane' + T.toFixed(2), crazy: true, type: 'plane', w: 1920, h: 1080, radius: 18, src, kfs: [] });
      const s1 = ZM(clamp(VW * 0.92 / fr.w, 0.5, 1.2));
      kf(O, at(0), { px: c.x, py: c.y, x: 0, y: up(120), z: -500, s: s1 * 0.8, rx: 68, ry: 34 * f, rz: 22 * f, dw: 160 }, 'flow');
      kf(O, at(1.1), { z: -150, s: s1 * 0.9, rx: 42, ry: 16 * f, rz: 8 * f, y: up(40) }, 'flow');
      kf(O, at(2.0), { z: 0, s: s1, rx: 16, ry: 4 * f, rz: 1 * f, y: 0, fr }, 'flow');
      kf(O, at(d - 0.3), { s: s1 * 1.05, rx: 12, ry: -4 * f, rz: 0, fr }, 'flow');
      kf(O, at(d), { ...OUT({ x: -f, y: 0.1 }, 1400), rx: 10, ry: -18 * f }, 'whipIn');
      fin(O, { flyIn: true });
      ev(at(0.05), 'whoosh', { dur: 1.4, gain: 0.5, pan: 0.3 * f, bright: 0.35 });
      shotsOut.push({ id: 'crane', start: T, end: at(d) });
      T = at(d);
    };
    // ---- dolly: lage, constante zijwaartse rijbeweging langs de laptop, scherm komt in beeld ----
    SHOT.dolly = () => {
      if (!R.hero) return;
      const at = (x) => T + x * tp;
      const d = 3.0 + H(0.3);
      const f = V.fw;
      const g = A.heroGroup ? cen(A.heroGroup) : { x: 960, y: 540 }, gp = lidPoint(g.x, g.y), c = lidPoint(960, 600);
      const Lp = add({ id: 'dolly' + T.toFixed(2), crazy: true, type: 'laptop', screen: { ...R.hero, map: { t0: T, c0: 0.2, rate: 1 } }, kfs: [] });
      kf(Lp, at(0), { ...c, x: 900 * f, y: up(70), z: -100, s: ZM(0.62), rx: -6, ry: -62 * f, rz: 0, dw: 140 }, 'flow');
      kf(Lp, at(1.0), { x: 300 * f, s: ZM(0.68), rx: -8, ry: -42 * f }, 'flow');
      kf(Lp, at(2.0), { ...gp, x: 0, y: up(20), s: ZM(0.86), rx: -14, ry: -18 * f }, 'flow');
      kf(Lp, at(d - 0.3), { ...gp, s: ZM(0.95), rx: -16, ry: -8 * f }, 'flow');
      kf(Lp, at(d), { ...gp, ...OUT({ x: -f, y: 0 }, 1300), ry: 6 * f }, 'whipIn');
      fin(Lp, { flyIn: true });
      ev(at(0.05), 'whoosh', { dur: 1.3, gain: 0.45, pan: 0.5 * f, bright: 0.35 });
      shotsOut.push({ id: 'dolly', start: T, end: at(d) });
      T = at(d);
    };
    // ---- float: de hero-pagina zweeft en draait langzaam, de lagen staan iets los (parallax), alles in beweging ----
    SHOT.float = () => {
      if (!(R.heroStill && A.heroLayers && A.heroLayers.length)) return;
      const at = (x) => T + x * tp;
      const d = 3.0 + H(0.3);
      const f = V.fw;
      const lifts = A.heroLayers.map((t, i) => ({ rect: t.rect, soft: /head|logo|nav|text/.test(t.role || ''), radius: t.role === 'cta' || t.role === 'badge' ? Math.min(t.rect.h, t.rect.w) / 2 : 6, stagger: 0, ...cut((R.heroRings || [])[i], { max: 70 * P.lift }, 9) }));
      const hl = A.heroLayers.find((t) => /head/.test(t.role)) || A.heroLayers[0];
      const O = add({ id: 'float' + T.toFixed(2), type: 'plane', w: 1920, h: 1080, radius: 18, src: R.heroStill, lifts, kfs: [] });
      const g = A.heroGroup || hl.rect, c = cen(g);
      const s1 = ZM(clamp(VW * 0.86 / g.w, 0.55, 1.2));
      kf(O, at(0), { px: c.x, py: c.y, x: IN(1000).x, y: up(-20), s: s1 * 0.95, rx: TX(14), ry: SY(-22 * f), rz: SZ(-4 * f), lift: 0, dw: 120 }, 'flow');
      kf(O, at(0.6), { x: 0, lift: 0.6, ry: SY(-14 * f) }, 'flow');
      kf(O, at(1.6), { lift: 1, ry: SY(0), rx: TX(10), rz: SZ(-1 * f), fr: g }, 'flow');
      kf(O, at(d - 0.3), { lift: 1, ry: SY(14 * f), rx: TX(8), rz: SZ(2 * f), s: s1 * 1.04, fr: g }, 'flow');
      kf(O, at(d), { ...OUT({ x: -f, y: 0.1 }, 1300) }, 'whipIn');
      fin(O, { flyIn: true });
      ev(at(0.6), 'pop', { gain: 0.3 });
      shotsOut.push({ id: 'float', start: T, end: at(d) });
      T = at(d);
    };

    // ---- pagina-spin: de pagina (als plaat met dikte) draait om zijn as naar voren, zweeft, whip uit ----
    SHOT.pagespin = () => {
      const src = R.heroStill || (R.travel || [])[0] || R.cards; if (!src) return;
      const at = (x) => T + x * tp;
      const d = 2.7 + H(0.3);
      const f = V.fw;
      const fr = A.heroGroup || { x: 200, y: 200, w: 1500, h: 700 };
      const c = cen(fr);
      const O = add({ id: 'pagespin' + T.toFixed(2), crazy: true, type: 'plane', w: 1920, h: 1080, radius: 18, src, kfs: [] });
      const s0 = ZM(clamp(VW * 0.8 / fr.w, 0.5, 1.1));
      kf(O, at(0), { px: c.x, py: c.y, x: 0, y: up(30), z: -350, s: s0 * 0.8, rx: 16, ry: 250 * f, rz: -14 * f, dw: 140 }, 'flow');
      kf(O, at(0.6), { z: -60, s: s0 * 0.95, rx: 14, ry: -22 * f, rz: -5 * f }, 'flow');
      kf(O, at(1.4), { z: 0, s: s0, rx: 12, ry: 10 * f, rz: -2 * f, fr }, 'flow');
      kf(O, at(d - 0.35), { s: s0 * 1.06, rx: 10, ry: -8 * f, rz: 0, fr }, 'flow');
      kf(O, at(d), { ...OUT({ x: -f, y: 0.1 }, 1500), ry: -40 * f, rz: -18 * f }, 'whipIn');
      fin(O, { flyIn: true });
      ev(at(0.02), 'whoosh', { dur: 0.7, gain: 0.6, pan: 0.4 * f, bright: 0.55 });
      shotsOut.push({ id: 'pagespin', start: T, end: at(d) });
      T = at(d);
    };
    // ---- pull-back: stil in macro op logo of knop, dan trekt de camera terug tot de hele hero in beeld staat ----
    SHOT.pullback = () => {
      const src = R.heroStill || (R.travel || [])[0]; if (!src) return;
      const at = (x) => T + x * tp;
      const d = 3.0 + H(0.3);
      const f = V.fw;
      const L = (R.heroStill ? (A.heroLayers || []) : []);
      const pick = L.find((t) => t.role === 'logo') || L.find((t) => t.role === 'cta') || L.find((t) => /head/.test(t.role || ''));
      const r0 = pick ? pick.rect : { x: 660, y: 390, w: 600, h: 300 };
      const c0 = cen(r0), g = A.heroGroup || { x: 160, y: 120, w: 1600, h: 840 }, c1 = cen(g);
      const sMacro = ZM(clamp(VW * 0.9 / Math.max(r0.w, 320), 1.3, 2.4));
      const sWide = ZM(clamp(Math.min(VW * 0.92 / g.w, VH * 0.5 / g.h), 0.5, 1.0));
      const O = add({ id: 'pullback' + T.toFixed(2), type: 'plane', w: 1920, h: 1080, radius: 18, src, kfs: [] });
      kf(O, at(0), { px: c0.x, py: c0.y, x: 0, y: up(-20), s: sMacro * 1.05, rx: TX(6), ry: SY(-8 * f), rz: SZ(-2 * f), dw: 40, db: 1.3 }, 'flow');
      kf(O, at(0.7), { s: sMacro, rx: TX(8), ry: SY(-6 * f) }, 'flow');
      kf(O, at(2.1), { px: c1.x, py: c1.y, s: sWide * 1.04, rx: TX(12), ry: SY(10 * f), rz: SZ(2 * f), dw: 120, db: 0.8, fr: g, y: 0 }, 'flow');
      kf(O, at(d - 0.3), { s: sWide, rx: TX(10), ry: SY(6 * f), fr: g }, 'flow');
      kf(O, at(d), { ...OUT({ x: -f, y: 0.1 }, 1400), s: sWide * 0.96 }, 'whipIn');
      fin(O, { flyIn: false }); // begint stil in macro: de vorige cut landt op een rustig beeld
      ev(at(0.75), 'whoosh', { dur: 1.3, gain: 0.42, pan: -0.3 * f, bright: 0.35 });
      shotsOut.push({ id: 'pullback', start: T, end: at(d) });
      T = at(d);
    };
    // ---- lange scroll: de volledige pagina (van boven tot onder) als hoog vlak, de camera rijdt er in een rustige lijn langs ----
    SHOT.longscroll = () => {
      const pg = R.longPage || (R.pages || [])[0]; if (!pg || !pg.src || !pg.h) return;
      const at = (x) => T + x * tp;
      const PH = pg.h;
      const d = clamp(2.4 + PH / 1600, 3.2, 5.2) + H(0.3);
      const f = V.fw;
      const O = add({ id: 'longscroll' + T.toFixed(2), type: 'plane', w: 1920, h: PH, radius: 18, src: pg.src, kfs: [] });
      const s0 = ZM(clamp(VW * 0.86 / 1920 * 1.35, 0.5, 0.9));
      const y0 = Math.min(480, PH / 2), y1 = Math.max(y0 + 200, PH - 620);
      const pin = IN(1300);
      kf(O, at(0), { px: 960, py: y0, x: pin.x, y: pin.y, s: s0 * 0.96, rx: TX(14), ry: SY(-14 * f), rz: SZ(-3 * f), dw: 260, db: 0.5 }, 'flow');
      kf(O, at(0.45), { x: 0, y: 0, s: s0, ry: SY(-10 * f) }, 'flow');
      kf(O, at(d - 0.4), { py: y1, rx: TX(10), ry: SY(8 * f), rz: SZ(1 * f), s: s0 * 1.03 }, 'flow');
      kf(O, at(d), { ...OUT({ x: -f, y: 0.15 }, 1400), py: y1 + 150 }, 'whipIn');
      fin(O, { flyIn: true });
      ev(at(0.05), 'whoosh', { dur: 1.0, gain: 0.4, pan: 0.3 * f, bright: 0.4 });
      shotsOut.push({ id: 'longscroll', start: T, end: at(d) });
      T = at(d);
    };
    // ---- close-up: gekozen pagina, langzame push-in op het aangeklikte punt ----
    SHOT.closeup = () => {
      const src = R.heroStill || (R.travel || [])[0] || R.cards || ((R.library || [])[0] || {}).src; if (!src) return;
      const at = (x) => T + x * tp;
      const d = 2.6 + H(0.35);
      const f = V.fw;
      const fr = (A.travelFocus || [])[0] || A.heroGroup || { x: 610, y: 350, w: 700, h: 380 };
      const c = cen(fr);
      const s0 = ZM(clamp(Math.min(VW * 0.82 / fr.w, VH * 0.36 / fr.h), 0.9, 2.0));
      const O = add({ id: 'closeup' + T.toFixed(2), type: 'plane', w: 1920, h: 1080, radius: 18, src, kfs: [] });
      const ci = IN(1000);
      kf(O, at(0), { px: c.x, py: c.y, x: ci.x, y: ci.y, s: s0 * 0.86, rx: TX(18), ry: SY(-20 * f), rz: SZ(-4 * f), dw: 70, db: 1.15 }, 'flow');
      kf(O, at(0.45), { x: 0, y: 0, s: s0 * 0.94, rx: TX(14), ry: SY(-14 * f), rz: SZ(-3 * f), fr }, 'flow');
      kf(O, at(d - 0.35), { s: s0 * 1.08, rx: TX(9), ry: SY(-6 * f), rz: SZ(-1 * f), fr }, 'flow');
      kf(O, at(d), { ...OUT({ x: -f, y: 0.1 }, 1300), s: s0 * 1.12 }, 'whipIn');
      fin(O, { flyIn: true });
      ev(at(0.03), 'whoosh', { dur: 0.7, gain: 0.4, pan: -0.3 * f, bright: 0.45 });
      shotsOut.push({ id: 'closeup', start: T, end: at(d) });
      T = at(d);
    };
    // ---- telefoon-waaier: drie telefoons op een boog, de hele waaier draait langzaam (Apple-keynote) ----
    SHOT.phonefan = () => {
      const src = R.mobileScroll || R.mobileMenu; if (!src) return;
      const at = (x) => T + x * tp;
      const d = 3.0 + H(0.3);
      const f = V.fw;
      const s0 = ZM(clamp(VH * 0.46 / 884, 0.6, 1.2));
      const Rr = 1100, phis = [-26, 0, 26];
      const th = [[0, 46], [0.7, 12], [1.6, -4], [d - 0.4, -14], [d, -60]];
      phis.forEach((phi, i) => {
        const scr = (R.fan && R.fan[i]) || (i === 1 ? src : (i === 0 ? (R.mobileMenu || src) : src));
        const Ph = add({ id: 'fan' + i + '-' + T.toFixed(2), crazy: true, type: 'phone', screen: { ...scr, map: { t0: T, c0: 0.3 + i * 1.3, rate: 1 } }, kfs: [] });
        th.forEach(([lt, deg], j) => {
          const a = ((deg * f + phi) * Math.PI) / 180;
          const last = j === th.length - 1;
          kf(Ph, at(lt), { px: 0, py: 0, x: Rr * Math.sin(a) + (last ? -1400 * f : 0), y: up(40) + (i === 1 ? 0 : 50), z: -Rr + Rr * Math.cos(a) + (j === 0 ? -300 : 0), ry: deg * f + phi, rx: 8, rz: 0, s: s0, dw: 400 }, last ? 'whipIn' : 'flow');
        });
        fin(Ph, { flyIn: true });
      });
      lastExit = { x: -f, y: 0 };
      ev(at(0.02), 'whoosh', { dur: 1.0, gain: 0.55, pan: 0.3 * f, bright: 0.45 });
      ev(at(d) - 0.3, 'whoosh', { dur: 0.5, gain: 0.45, pan: -0.5 * f, bright: 0.6 });
      shotsOut.push({ id: 'phonefan', start: T, end: at(d) });
      T = at(d);
    };

    // ---- crazy: telefoon komt rond gezwiept, zweeft, en duikt met een barrel roll het scherm in ----
    SHOT.spin = () => {
      const src = R.mobileScroll || R.mobileMenu; if (!src) return;
      const at = (x) => T + x * tp;
      const d = 2.8 + H(0.3);
      const f = V.fw;
      const Ph = add({ id: 'spin' + T.toFixed(2), crazy: true, type: 'phone', screen: { ...src, map: { t0: T, c0: 0.3, rate: 1 } }, kfs: [] });
      const s0 = ZM(clamp(VH * 0.6 / 884, 0.8, 1.5));
      kf(Ph, at(0), { px: 0, py: 0, x: 0, y: up(40), z: -250, s: s0 * 1.15, rx: 12, ry: 230 * f, rz: -18 * f, dw: 110 }, 'flow');
      kf(Ph, at(0.62), { z: 0, s: s0 * 0.96, rx: 8, ry: -14 * f, rz: -5 * f }, 'flow');
      kf(Ph, at(1.35), { s: s0, rx: 5, ry: 8 * f, rz: -2 * f, y: up(20) }, 'flow');
      kf(Ph, at(d - 0.85), { s: s0 * 1.04, rx: 3, ry: -4 * f, rz: 0, y: up(10) }, 'flow');
      kf(Ph, at(d), { ...OUT({ x: -f, y: 0.1 }, 1400), s: s0 * 1.15, rx: 4, ry: -28 * f, rz: -6 * f }, 'whipIn');
      fin(Ph, { flyIn: true });
      ev(at(0.02), 'whoosh', { dur: 0.7, gain: 0.6, pan: 0.5 * f, bright: 0.6 });
      ev(at(d) - 0.2, 'whoosh', { dur: 0.6, gain: 0.45, pan: -0.5 * f, bright: 0.5 });
      shotsOut.push({ id: 'spin', start: T, end: at(d) });
      T = at(d);
    };
    // ---- crazy: kraanbeweging om de laptop (scherm steeds in beeld), terug naar de kop, duik erin ----
    SHOT.orbit = () => {
      if (!R.hero) return;
      const at = (x) => T + x * tp;
      const d = 3.0 + H(0.3);
      const f = V.fw;
      const Lp = add({ id: 'orbit' + T.toFixed(2), crazy: true, type: 'laptop', screen: { ...R.hero, map: { t0: T, c0: 0.2, rate: 1 } }, kfs: [] });
      const c = lidPoint(960, 560), g = A.heroGroup ? cen(A.heroGroup) : { x: 960, y: 540 }, gp = lidPoint(g.x, g.y);
      kf(Lp, at(0), { ...c, x: 0, y: up(60), z: -150, s: ZM(0.82), rx: -4, ry: 62 * f, rz: -10 * f, dw: 130 }, 'flow');
      kf(Lp, at(0.85), { z: -60, s: ZM(0.6), rx: -30, ry: -58 * f, rz: 8 * f, y: up(30) }, 'flow');
      kf(Lp, at(1.7), { ...gp, z: 0, s: ZM(0.85), rx: -24, ry: -12 * f, rz: 2 * f, y: up(-10) }, 'flow');
      kf(Lp, at(d - 0.55), { ...gp, s: ZM(1.05), rx: -22, ry: 3 * f, rz: 0, y: up(-20) }, 'flow');
      kf(Lp, at(d), { ...gp, ...OUT({ x: -f, y: 0.1 }, 1500), s: ZM(1.2), rx: -20, ry: -20 * f, rz: -4 * f }, 'whipIn');
      fin(Lp, { flyIn: true });
      ev(at(0.05), 'whoosh', { dur: 1.1, gain: 0.6, pan: -0.5 * f, bright: 0.45 });
      ev(at(d) - 0.2, 'whoosh', { dur: 0.6, gain: 0.45, pan: -0.5 * f, bright: 0.5 });
      shotsOut.push({ id: 'orbit', start: T, end: at(d) });
      T = at(d);
    };
    // ---- crazy: pagina's achter elkaar in de diepte, camera vliegt er dwars doorheen en landt op de laatste ----
    SHOT.stack = () => {
      const pages = (R.stackPages || [R.heroStill, ...(R.travel || []), R.cards]).filter(Boolean).slice(0, 4);
      if (pages.length < 3) return;
      const at = (x) => T + x * tp;
      const n = pages.length, gap = 1900, hold = 0.7, mv = 0.6;
      const d = 0.35 + n * hold + (n - 1) * mv + 0.25;
      const f = V.fw;
      const sc = ZM(0.8);
      const tf = A.travelFocus || [];
      const seg = { kfs: [] };
      const ck = (t, pose, ease = 'flow') => seg.kfs.push({ t: +t.toFixed(3), ease, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, fz: 0, ...pose });
      // galerij: pagina's om en om links/rechts, schuin naar het pad gedraaid; de camera vliegt er langs, nooit doorheen
      const poses = pages.map((_, i) => ({ x: (i % 2 ? 1 : -1) * 1350 * f * (i ? 1 : 0), y: (i % 2 ? 40 : -30) * (i ? 1 : 0), z: -i * gap, ry: (i % 2 ? -30 : 30) * f * (i ? 1 : 0), rz: (i % 2 ? 2 : -2) * f * (i ? 1 : 0) }));
      pages.forEach((src, i) => {
        const o = add({ id: 'stack' + i + '-' + T.toFixed(2), crazy: true, type: 'plane', w: 1920, h: 1080, radius: 18, src, camFocus: true, noReflect: true, kfs: [] });
        const fr = i === 1 ? tf[0] : i === 2 ? tf[1] : null;
        const base = { px: fr ? fr.x + fr.w / 2 : 960, py: fr ? fr.y + fr.h / 2 : 540, s: sc, dw: 120, ...poses[i] };
        // pagina verdwijnt vlak voordat de camera erdoorheen gaat (geen knip door het vlak)
        const tHoldEnd = 0.35 + (i + 1) * hold + i * mv;
        kf(o, at(0), { ...base, o: 1 }, 'linear');
        if (i < n - 1) { kf(o, at(tHoldEnd + mv * 0.15), { o: 1 }, 'linear'); kf(o, at(tHoldEnd + mv * 0.55), { o: 0 }, 'linear'); }
        kf(o, at(d), {}, 'linear');
        fin(o, { ramp: false });
      });
      ck(at(0), { x: lastExit.x * 1600, y: lastExit.y * 1600, z: 900, fz: -900 });
      ck(at(0.35), { ...poses[0], fz: 0 });
      const backP = (pose, dist) => { const r = (pose.ry || 0) * Math.PI / 180; return { ...pose, x: pose.x + Math.sin(r) * dist, z: pose.z + Math.cos(r) * dist, fz: -dist }; };
      pages.forEach((_, i) => {
        const t1 = 0.35 + (i + 1) * hold + i * mv;
        ck(at(t1 - hold * 0.35), { ...poses[i], z: poses[i].z - 50, fz: 50 });
        if (i < n - 1) {
          const mid = { x: (poses[i].x + poses[i + 1].x) / 2, y: (poses[i].y + poses[i + 1].y) / 2, z: (poses[i].z + poses[i + 1].z) / 2 + 700, ry: (poses[i].ry + poses[i + 1].ry) / 2, rz: 0, fz: -900 };
          ck(at(t1 + mv * 0.5), mid);
          ck(at(t1 + mv), backP(poses[i + 1], 120));
        }
      });
      ck(at(d), { ...poses[n - 1], z: poses[n - 1].z - 160, x: poses[n - 1].x - 1500 * f, rz: -14 * f });
      seg.kfs[0].fly = fly; seg.kfs[seg.kfs.length - 1].fly = fly;
      seg.kfs.sort((a, b) => a.t - b.t);
      camSegs.push(seg);
      lastExit = { x: -f, y: 0 };
      pages.forEach((_, i) => { if (i < n - 1) ev(at(0.35 + (i + 1) * hold + i * mv + mv * 0.35), 'whoosh', { dur: 0.55, gain: 0.5, pan: (i % 2 ? 0.4 : -0.4) * f, bright: 0.55 }); });
      shotsOut.push({ id: 'stack', start: T, end: at(d) });
      T = at(d);
    };

    // ---- hover: close-up die de muis volgt ----
    SHOT.hover = () => {
      if (!(R.hover && A.hoverPath && A.hoverPath.length >= 2)) return;
      const at = (x) => T + x * tp;
      const path = A.hoverPath;
      const tStart = Math.max(0, path[0].t - 0.2), tEnd = path[path.length - 1].t + 0.6;
      const d = clamp((tEnd - tStart) / tp, 2.2, 3.6);
      const c0 = tStart;
      const Hh = add({ id: 'hover' + T.toFixed(2), type: 'plane', w: 1920, h: 1080, radius: 18, src: { ...R.hover, map: { t0: T, c0, rate: 1 } }, kfs: [] });
      const zs = clamp(ZM(1.3), 0.9, 1.55);
      // cursorpad gladgestreken (gemiddelde over ~0.5 s), minder keyframes: rustige volgbeweging
      // alleen het deel van het pad vanaf vlak voor de eerste hover volgen (niet de cursor die van buiten beeld binnenkomt)
      const k0 = (A.hoverKeys && A.hoverKeys[0]) || path[Math.min(2, path.length - 1)].t;
      const p0 = pathAt(path, k0) || path[0];
      let pk = (lt) => { let sx = 0, sy = 0, n2 = 0; for (let k = -6; k <= 6; k++) { const ct = c0 + (lt + k * 0.08) * tp; const cp = ct < k0 - 0.1 ? p0 : pathAt(path, ct); if (cp) { sx += cp.x; sy += cp.y; n2++; } } return n2 ? { px: sx / n2, py: Math.min(1000, sy / n2 + 40) } : { px: 960, py: 540 }; };
      const pkRaw = pk, mid = pkRaw(d * 0.5);
      pk = (lt) => { const a = pkRaw(lt); return { px: mid.px + (a.px - mid.px) * 0.55, py: mid.py + (a.py - mid.py) * 0.55 }; };
      const n = Math.max(2, Math.round(d / 0.95));
      const hin = IN(2400);
      kf(Hh, at(0), { ...pk(0), x: hin.x, y: up(-40) + hin.y, s: zs, rx: TX(14), ry: SY(-10), rz: SZ(-6), dw: 70 }, 'flow');
      kf(Hh, at(0.34), { ...pk(0.34), x: 0, y: up(-40) }, 'flow');
      for (let i = 1; i < n; i++) {
        const lt = 0.34 + ((d - 0.62) * i) / n;
        kf(Hh, at(lt), { ...pk(lt), s: zs * (1 + 0.06 * Math.sin((i / n) * Math.PI)), rx: TX(12 - 4 * i / n), ry: SY(-6 + 10 * i / n), rz: SZ(-5 + 3 * i / n), y: up(-40) }, 'flow');
      }
      kf(Hh, at(d - 0.28), { ...pk(d - 0.28), ry: SY(5), rz: SZ(-2) }, 'flow');
      kf(Hh, at(d), { ...OUT({ x: -V.fw, y: 0 }, 2000), rz: SZ(-26) }, 'whipIn');
      fin(Hh);
      (A.hoverKeys || []).forEach((k) => { const tt = T + (k - c0) / 1; if (tt > T + 0.2 && tt < at(d) - 0.2) ev(tt, 'tick', { gain: 0.35 }); });
      shotsOut.push({ id: 'hover', start: T, end: at(d) });
      T = at(d);
    };

    // ---- features: snelle close-ups van de key features ----
    SHOT.features = () => {
      if (!(R.features && R.features.length)) return;
      const list = R.features.slice(0, 3);
      // rustig en leesbaar: korte zachte drift in, element komt los, blijft even staan, crossfade naar het volgende
      const each = 1.6 * P.hold, ov = 0.6;
      // rustige hoeken, telkens dezelfde kant op zodat het als één beweging voelt
      const angles = [{ rx: 12, ry: -18, rz: -4 }, { rx: 10, ry: -12, rz: -3 }, { rx: 14, ry: -16, rz: -4 }];
      const start = T;
      const fitOf = (r) => { const wide = r.w / Math.max(1, r.h) > 4; return ZM(clamp(Math.min(VW * (wide ? 0.84 : 0.62) / r.w, VH * 0.24 / r.h), 0.85, 2.2)); };
      // afstand per wissel: groot genoeg dat de twee pagina's elkaar nooit raken (rechterrand vorige < linkerrand volgende)
      const SWS = 0.8; // tijdens de wissel zoomen beide pagina's iets uit: kortere, rustigere zwiep
      // de volgende pagina mag de vorige nooit raken: aan het begin van de wissel staat de vorige nog op volle schaal (x = 0)
      // en komt de volgende op SWS-schaal binnen; aan het eind is het andersom. Beide gevallen plus een marge voor de auto-kadrering.
      const edgeR = (rect, s) => (1920 - (rect.x + rect.w / 2)) * s, edgeL = (rect, s) => (rect.x + rect.w / 2) * s;
      const swapD = list.map((fe, i) => { if (i === 0) return 0; const p = list[i - 1].rect, r = fe.rect, fp = fitOf(p), fr_ = fitOf(r); return Math.max(edgeR(p, fp * 1.04) + edgeL(r, fr_ * SWS), edgeR(p, fp * SWS) + edgeL(r, fr_ * 1.04)) + 520; });
      list.forEach((fe, i) => {
        const at = (x) => T + x * tp;
        const a = angles[i % angles.length];
        const r = fe.rect;
        const c = cen(r);
        // kadrering op het element zelf: brede rijen vullen de breedte, kleine blokken worden groot genoeg om te lezen
        const sfit = fitOf(r);
        const lm = 90 * P.lift;
        const Fp = add({ id: 'feature' + i + '-' + T.toFixed(2), type: 'plane', w: 1920, h: 1080, radius: 18, src: fe.src, lifts: [{ rect: r, radius: Math.abs(r.w - r.h) < 14 ? r.w / 2 : 12, stagger: 0, ...cut(fe.ring, { max: lm }) }], kfs: [] });
        const first = i === 0, last = i === list.length - 1;
        // carrousel: het volgende item schuift van rechts in terwijl het vorige naar links gaat (nooit twee vlakken door elkaar)
        const fin_ = first ? IN(1100) : { x: swapD[i], y: 0 };
        kf(Fp, at(0), { px: c.x, py: c.y, x: fin_.x, y: fin_.y, s: sfit * (first ? 0.9 : SWS), rx: TX(a.rx + 3), ry: SY(a.ry * 1.25), rz: SZ(a.rz), lift: 0, dw: 110, db: 0.7, o: 1, noGlide: !first }, 'flow');
        kf(Fp, at(first ? 0.34 : ov), { x: 0, y: 0, s: sfit, ry: SY(a.ry), lift: 0.6, o: 1, fr: r, noGlide: false }, 'flow');
        kf(Fp, at(each - ov), { fr: r, s: sfit * 1.04, rx: TX(a.rx * 0.75), ry: SY(a.ry * 0.6), rz: SZ(a.rz * 0.6), lift: 1, o: 1 }, 'flow');
        if (last) kf(Fp, at(each), { ...OUT({ x: -1, y: 0.15 }, 1400), s: sfit * 1.1 }, 'whipIn');
        else { kf(Fp, at(each), { x: -swapD[i + 1], s: sfit * SWS, ry: SY(a.ry * 0.45), lift: 1, o: 1, noGlide: true }, 'flow'); swaps.push([at(each - ov), at(each)]); }
        fin(Fp, { pivotLift: lm, flyIn: first });
        if (first) ev(at(0.02), 'whoosh', { dur: 0.5, gain: 0.45, pan: 0.4, bright: 0.6 });
        else ev(at(0.05), 'whoosh', { dur: 0.8, gain: 0.22, pan: i % 2 ? -0.3 : 0.3, bright: 0.4 });
        ev(at(0.32), 'pop', { gain: 0.5 });
        if (fe.text && !(cur.caption && cur.caption.text !== undefined)) cap(at(first ? 0.4 : ov + 0.1), at(each - 0.25), fe.text, KICK[fe.kind] ?? fe.kind, 'bl');
        T = last ? at(each) : at(each - ov);
      });
      shotsOut.push({ id: 'features', start, end: T });
    };

    // ---- kaarten: pagina plat, kaarten poppen los ----
    SHOT.cards = () => {
      if (!(R.cards && A.cards && A.cards.length >= 2)) return;
      const at = (x) => T + x * tp;
      const d = 2.55 + H(0.45);
      const cs = A.cards.map((c) => ({ x: c.rect.x + c.rect.w / 2, y: c.rect.y + c.rect.h * 0.45 }));
      const lifts = A.cards.map((c, i) => ({ rect: c.rect, radius: 20, stagger: i * 0.22, ...cut((R.cardRings || [])[i] || { color: R.pageBg, std: 0 }, { max: 190 * P.lift }) }));
      const C = add({ id: 'cards' + T.toFixed(2), type: 'plane', w: 1920, h: 1080, radius: 18, src: R.cards, lifts, kfs: [] });
      const lf = Math.min(1.4, P.lift);
      const last = cs.length - 1;
      const cin = IN(1400);
      kf(C, at(0), { px: cs[0].x, py: cs[0].y, s: ZM(clamp(VW * 0.62 / A.cards[0].rect.w, 0.9, 1.6)), rx: TX(54), rz: SZ(-28), z: -260, x: cin.x, y: up(-60) + cin.y, lift: 0, dw: 80, fz: 0 }, 'flow');
      kf(C, at(0.55), { z: 0, x: 0, y: up(-60), lift: 0.3, fz: 70 * lf }, 'flow');
      kf(C, at(1.2), { px: cs[1].x, py: cs[1].y, lift: 0.72, rz: SZ(-24), fz: 150 * lf }, 'flow');
      kf(C, at(1.85), { px: cs[last].x, py: cs[last].y, lift: 1, rz: SZ(-20), fz: 190 * lf }, 'flow');
      kf(C, at(d - 0.3), { px: 960, py: cs[0].y, s: ZM(0.64), rx: TX(40), rz: SZ(-16), y: up(-20), dw: 140, fz: 110 * lf }, 'flow');
      kf(C, at(d), { ...OUT({ x: 0, y: -1 }, 2700), rx: TX(30) }, 'whipIn');
      fin(C);
      // pops: moment waarop elke kaart loskomt (lift passeert stagger)
      const liftAt = [[0, 0], [0.55, 0.3], [1.2, 0.72], [1.85, 1]];
      A.cards.forEach((c, i) => { const st = i * 0.22 + 0.04; for (let j = 1; j < liftAt.length; j++) { if (st <= liftAt[j][1]) { const [t0, l0] = liftAt[j - 1], [t1, l1] = liftAt[j]; ev(at(t0 + ((st - l0) / (l1 - l0)) * (t1 - t0)), 'pop', { gain: 0.5, pan: (i - 1) * 0.4 }); break; } } });
      shotsOut.push({ id: 'cards', start: T, end: at(d) });
      T = at(d);
    };

    // ---- explode: hero-lagen poppen los ----
    SHOT.explode = () => {
      if (!(R.heroStill && A.heroLayers && A.heroLayers.length)) return;
      const at = (x) => T + x * tp;
      const d = 2.8 + H(0.3);
      const DEPTH = { headline: 250, cta: 360, badge: 430, logo: 170, nav: 120, 'menu-toggle': 300, heading: 220, price: 300, image: 200 };
      const lifts = A.heroLayers.map((t, i) => ({ rect: t.rect, soft: /head|logo|nav|text/.test(t.role || ''), ring: (R.heroRings || [])[i], patchMode: 'blur', patch: 'transparent', radius: t.role === 'cta' || t.role === 'badge' ? Math.min(t.rect.h, t.rect.w) / 2 : 6, stagger: Math.min(0.6, i * 0.09), max: (DEPTH[t.role] || 200) * P.lift }));
      for (let i = 0; i < lifts.length; i++) { const L = lifts[i]; const clean = L.ring && (L.ring.std < 9 || L.ring.plate); lifts[i] = { ...L, ...cut(L.ring, { max: clean ? L.max : Math.min(L.max, 70) }, 9) }; if (!clean) lifts[i].max = Math.min(L.max, 70); }
      const hl = A.heroLayers.find((t) => t.role === 'headline') || A.heroLayers[0];
      const hc = cen(hl.rect);
      const X = add({ id: 'explode' + T.toFixed(2), type: 'plane', w: 1920, h: 1080, radius: 18, src: R.heroStill, lifts, kfs: [] });
      const lf = Math.min(1.5, P.lift);
      const xin = IN(1700);
      kf(X, at(0), { px: 960, py: 540, x: xin.x, y: xin.y, s: ZM(0.6), rx: TX(10), ry: SY(-10), rz: SZ(-5), lift: 0, dw: 120 }, 'flow');
      kf(X, at(0.34), { x: 0, y: 0, ry: SY(-14) }, 'flow');
      kf(X, at(0.95), { lift: 0.45, ry: SY(-34), rx: TX(24), rz: SZ(-10), s: ZM(0.58), fz: 80 * lf }, 'flow');
      kf(X, at(1.9), { lift: 1, ry: SY(32), rx: TX(18), rz: SZ(7), s: ZM(0.62), fz: 150 * lf }, 'flow');
      kf(X, at(d - 0.3), { fr: hl.rect, frz: (DEPTH[hl.role] || 200) * P.lift, px: hc.x, py: hc.y, ry: SY(16), rx: TX(10), rz: SZ(3), s: ZM(clamp(VW * 0.72 / hl.rect.w, 0.6, 1.4)), y: up(-40), fz: 230 * lf, dw: 90 }, 'flow');
      kf(X, at(d), { ...OUT({ x: 0, y: -1 }, 2700), rx: TX(28) }, 'whipIn');
      fin(X);
      lifts.slice(0, 3).forEach((l, i) => { const st = l.stagger + 0.03; const tt = st <= 0.45 ? 0.34 + (st / 0.45) * 0.61 : 0.95 + ((st - 0.45) / 0.55) * 0.95; ev(at(tt), 'pop', { gain: 0.42, pan: ((i % 3) - 1) * 0.5 }); });
      shotsOut.push({ id: 'explode', start: T, end: at(d) });
      T = at(d);
    };

    // ---- travel: camera vliegt van pagina A naar pagina B ----
    SHOT.travel = () => {
      if (!(R.travel && R.travel.length >= 2)) return;
      const at = (x) => T + x * tp;
      const d = 3.0 + H(0.3);
      const sc = ZM(0.62);
      const flip = V.fz;
      // pagina B hangt naast A als een galerijwand; de camera blijft altijd ruim voor beide vlakken (nooit erdoor)
      const Bp = { x: 3200 * flip, y: -140, z: -600, rx: 5, ry: -35 * flip, rz: 3 * flip };
      const Aobj = add({ id: 'travel-a' + T.toFixed(2), type: 'plane', w: 1920, h: 1080, radius: 18, src: R.travel[0], camFocus: true, kfs: [] });
      const Bobj = add({ id: 'travel-b' + T.toFixed(2), type: 'plane', w: 1920, h: 1080, radius: 18, src: R.travel[1], camFocus: true, kfs: [] });
      const tf = A.travelFocus || [];
      const fit = (r) => (r ? { px: r.x + r.w / 2, py: r.y + r.h / 2, s: clamp(Math.min(VW * 0.86 / r.w, VH * 0.5 / r.h), sc, ZM(1.25)) } : { px: 960, py: 540, s: sc });
      [[Aobj, { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }, fit(tf[0])], [Bobj, Bp, fit(tf[1])]].forEach(([o, pose, f]) => { kf(o, at(0), { ...f, dw: 140, ...pose }, 'linear'); kf(o, at(d), {}, 'linear'); fin(o, { ramp: false }); });
      // A verdwijnt zacht zodra de camera bij B is (staat dan naast de camera, nooit zichtbaar door het beeld)
      Aobj.kfs.splice(1, 0, { ...Aobj.kfs[0], t: +at(1.8).toFixed(3) }, { ...Aobj.kfs[0], t: +at(2.15).toFixed(3), o: 0 }); Aobj.kfs[Aobj.kfs.length - 1].o = 0;
      const seg = { kfs: [] };
      const ck = (x, pose, ease = 'flow') => seg.kfs.push({ t: +at(x).toFixed(3), ease, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, fz: 0, ...pose });
      const lerp = (a, b, f) => { const o = {}; for (const k of ['x', 'y', 'z', 'rx', 'ry', 'rz']) o[k] = (a[k] || 0) + ((b[k] || 0) - (a[k] || 0)) * f; return o; };
      const back = (pose, dist) => {
        const r = Math.PI / 180, ry = pose.ry * r, rx = pose.rx * r, rz = pose.rz * r;
        let x = Math.sin(ry), y = 0, z = Math.cos(ry);
        [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
        [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
        return { ...pose, x: pose.x + x * dist, y: pose.y + y * dist, z: pose.z + z * dist };
      };
      const A0 = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
      // fz = scherptevlak in camera-ruimte: de pagina recht voor de camera op afstand 'dist' ligt op z = -dist
      ck(0, { x: lastExit.x * 1500, y: lastExit.y * 1500, z: 200, fz: -200 });
      ck(0.4, { ...A0, fz: 0 });
      // eerst recht naar achter, dan op grote afstand opzij draaien, dan recht van voren op B in
      ck(1.0, { ...back({ ...A0, ry: -6 * flip, rz: -1 * flip }, 1500), fz: -1500 });
      ck(1.75, { ...back({ ...Bp, rz: Bp.rz + 2 * flip }, 1600), fz: -1600 });
      ck(2.5, { ...Bp, fz: 0 });
      ck(d - 0.25, { ...Bp, z: Bp.z - 60, fz: 60 });
      const exRad = Bp.ry * Math.PI / 180;
      ck(d, { ...Bp, z: Bp.z - 60 - 1400 * Math.sin(exRad), x: Bp.x + 1400 * Math.cos(exRad), rz: Bp.rz - 5 * flip });
      seg.kfs[0].fly = fly; seg.kfs[seg.kfs.length - 1].fly = fly;
      camSegs.push(seg); swaps.push([at(0.4), at(2.5)]);
      lastExit = { x: -Math.sign(Math.cos(exRad)) || -1, y: 0 };
      ev(at(0.95), 'whoosh', { dur: 1.2, gain: 0.6, pan: -0.5 * flip, bright: 0.4 });
      ev(at(d) - 0.2, 'whoosh', { dur: 0.6, gain: 0.45, pan: 0.5 * flip, bright: 0.5 });
      shotsOut.push({ id: 'travel', start: T, end: at(d) });
      T = at(d);
    };

    // ---- depth: orbit rond scroll/parallax ----
    SHOT.depth = () => {
      if (!R.depth) return;
      const at = (x) => T + x * tp;
      const d = 2.4 + H(0.25);
      const rate = Math.min(1.5, Math.max(0.9, ((A.depth.duration_s || 4) - 0.5) / (d * tp - 0.4)));
      const D = add({ id: 'depth' + T.toFixed(2), type: 'plane', w: 1920, h: 1080, radius: 18, src: { ...R.depth, map: { t0: T, c0: 0.25, rate } }, kfs: [] });
      const din = IN(2600);
      kf(D, at(0), { px: 960, py: 540, x: din.x, y: din.y, s: ZM(0.86), rx: TX(16), ry: SY(-30), rz: SZ(-7), dw: 90 }, 'flow');
      kf(D, at(0.36), { x: 0, y: 0, ry: SY(-24) }, 'flow');
      kf(D, at(d - 0.35), { ry: SY(22), rx: TX(9), rz: SZ(-3), s: ZM(0.92) }, 'flow');
      kf(D, at(d), { z: 1500, ry: SY(30), o: 0 }, 'in');
      OUTZ();
      fin(D);
      shotsOut.push({ id: 'depth', start: T, end: at(d) });
      T = at(d);
    };

    // ---- slide: tweede interactie ----
    SHOT.slide = () => {
      if (!R.slide) return;
      const at = (x) => T + x * tp;
      const keyLocal = 0.85;
      const d = 2.5 + H(0.3);
      const f = A.slideFocus || { x: 1100, y: 640 };
      const S = add({ id: 'slide' + T.toFixed(2), type: 'plane', w: 1920, h: 1080, radius: 18, src: { ...R.slide, map: { t0: T, c0: Math.max(0, A.slideKey - keyLocal * tp), rate: 1 } }, kfs: [] });
      kf(S, at(0), { px: f.x, py: f.y, z: -2600, s: ZM(1.3), rx: TX(-26), ry: SY(16), rz: SZ(8), y: up(-80), dw: 80 }, 'flow');
      kf(S, at(0.44), { z: 0 }, 'flow');
      kf(S, at(1.3), { px: f.x - 240, py: f.y - 30, s: ZM(1.12), ry: SY(8), y: up(-60) }, 'flow');
      kf(S, at(d - 0.3), { px: 960, py: 600, s: ZM(0.72), rx: TX(-18), ry: SY(-8), rz: SZ(5), y: up(-20), dw: 140 }, 'flow');
      kf(S, at(d), { ...OUT({ x: -V.fw, y: 0 }, 2000), rz: SZ(34) }, 'whipIn');
      fin(S);
      ev(at(keyLocal), 'click', { gain: 0.8 });
      shotsOut.push({ id: 'slide', start: T, end: at(d) });
      T = at(d);
    };

    // ---- outro: logo + CTA, klik ----
    SHOT.outro = () => {
      if (!R.logo) return;
      const at = (x) => T + x * tp;
      const d = 2.35 + H(0.3);
      const L = add({ id: 'outro-logo', type: 'crop', src: R.logoSrc, crop: R.logo.crop, w: R.logo.w, h: R.logo.h, radius: 26, kfs: [] });
      const oin = IN(1500);
      kf(L, at(0), { px: R.logo.w / 2, py: R.logo.h / 2, x: oin.x, y: up(-150) + oin.y, rz: SZ(20), ry: SY(-30), rx: TX(10), s: 1.1, db: 0 }, 'flow');
      kf(L, at(0.5), { x: 0, y: up(-150), rz: SZ(-2), ry: SY(-8), rx: TX(6), s: 1 }, 'flow');
      kf(L, at(d), { rz: SZ(1), ry: SY(6), rx: TX(3), s: 1.03 }, 'flow');
      fin(L);
      L.kfs[L.kfs.length - 1].fly = undefined;
      ev(at(0), 'whoosh', { dur: 0.6, gain: 0.55, pan: 0.5, bright: 0.5 });
      ev(at(0.48), 'impact', { gain: 0.35 });
      if (R.cta) {
        const C = add({ id: 'outro-cta', type: 'crop', src: R.ctaSrc, crop: R.cta.crop, w: R.cta.w, h: R.cta.h, radius: R.cta.h / 2, kfs: [] });
        kf(C, at(0.3), { px: R.cta.w / 2, py: R.cta.h / 2, y: up(200), z: -1400, rx: TX(40), s: 1, o: 0, db: 0 }, 'out');
        kf(C, at(0.88), { z: 0, rx: TX(8), o: 1 }, 'silk');
        kf(C, at(1.52), { s: 1, rx: TX(6) }, 'flow');
        kf(C, at(1.6), { s: 0.92 }, 'out');
        kf(C, at(1.76), { s: 1.0 }, 'out');
        kf(C, at(d), { rx: TX(3), s: 1.02 }, 'flow');
        fin(C, { ramp: false });
        ev(at(0.55), 'pop', { gain: 0.4 });
        if (P.cursor) {
          kf(cursor, at(0.8), { x: VW + 60, y: VH * 0.86, o: 1 }, 'flow');
          kf(cursor, at(1.48), { obj: 'outro-cta', u: R.cta.w * 0.7, v: R.cta.h * 0.62 }, 'silk');
          kf(cursor, at(d), { obj: 'outro-cta', u: R.cta.w * 0.7 + 30, v: R.cta.h * 0.62 + 40 }, 'linear');
          cursor.clicks.push(at(1.58));
        }
        ev(at(1.58), 'click');
        ev(at(1.62), 'shimmer', { gain: 0.5 });
      }
      const F = add({ id: 'fill-end', type: 'fill', color: '#000', kfs: [] });
      kf(F, at(d) - 0.35, { o: 0 }, 'linear'); kf(F, at(d), { o: 1 }, 'inout'); fin(F, { ramp: false });
      shotsOut.push({ id: 'outro', start: T, end: at(d) });
      T = at(d);
    };

    // ---- edit uitvoeren ----
    edit.forEach((e) => {
      if (!SHOT[e.shot]) return;
      const a = ANGLES[e.angle] || {};
      V = { k: a.k || 1, fy: e.mirror ? -1 : 1, fz: e.mirror ? -1 : 1, fw: e.mirror ? -1 : 1, rxAdd: a.rxAdd || 0, ryAdd: a.ryAdd || 0, rzAdd: a.rzAdd || 0, zoom: a.zoom || 1 };
      tp = P.tempo * (e.tempo || 1) * (+P.shotTempo[e.shot] || 1);
      // shots met een echte interactie (menu dat opent) niet te veel samenpersen, anders is het menu nog dicht als de shot eindigt
      const FLOOR = { menu: 0.85, phone: e.clip === 'menu' ? 0.9 : 0 };
      tp = Math.max(tp, FLOOR[e.shot] || 0);
      cur = e; curShot = e.shot;
      const nObj = objects.length;
      // gekozen inhoud voor dit shot (andere pagina, clip, feature, focuspunt)
      const ov = overrideFor(e, A, R), keep = [A, R];
      if (ov) { A = ov.A; R = ov.R; }
      const nShot = shotsOut.length;
      try { SHOT[e.shot](); } finally { [A, R] = keep; }
      // caption voor dit shot (features en outro regelen het zelf): kop van de site één keer, verder korte kickers
      if (shotsOut.length > nShot) {
        const sh = shotsOut[shotsOut.length - 1], AA = ov ? ov.A : A, t0 = sh.start + 0.45 * tp, t1 = sh.end - 0.4 * tp;
        const own = e.caption && e.caption.text !== undefined;
        if (own) cap(t0, t1, e.caption.text, e.caption.sub, e.caption.pos);
        // laptop-shots laten de hero zelf leesbaar zien: dan is de sitenaam de titel. Macro's en wijde shots krijgen de kop (één keer).
        else if (['laptop', 'dolly', 'orbit'].includes(e.shot)) { if (!hostUsed && host) { hostUsed = true; cap(t0, t1, host, A.headline ? 'Website' : '', 'bl'); } }
        else if (['closeup', 'tracking', 'pagespin', 'crane', 'float', 'explode', 'travel', 'stack', 'depth'].includes(e.shot)) { const h = headlineOnce(); if (h) cap(t0, t1, h, host, 'bl'); }
        else if (e.shot === 'phone' || e.shot === 'spin' || e.shot === 'phonefan') cap(t0, t1, host, 'Mobiel', 'bl');
        else if (e.shot === 'devices') cap(t0, t1, host, 'Desktop en mobiel', 'bl');
        else if (e.shot === 'menu') cap(t0, t1, 'Navigatie', host, 'bl');
        else if (e.shot === 'popwall') { const G = (ov ? ov.R : R).groups; const g = G && G[e.group || 0] || (G && G[0]); if (g && g.kind && g.kind !== 'eigen') cap(t0, t1, KICK[g.kind] || g.kind, host, 'bl'); }
        else if (e.shot === 'outro') cap(sh.start + 0.9 * tp, sh.end - 0.3, host, '', 'bc');
      }
      // handmatige kadrering voor dit shot (Studio of Claude): zoom, verschuiving, draai; optioneel auto-kadrering uit
      const fr = e.frame, ei = edit.indexOf(e);
      objects.slice(nObj).forEach((o) => {
        if (o.type === 'cursor') return;
        o.shotIdx = ei;
        if (fr && o.type !== 'fill') o.frame = { zoom: fr.zoom || 1, x: fr.x || 0, y: fr.y || 0, tilt: fr.tilt || 0, auto: fr.auto !== false };
      });
    });
    tp = P.tempo;
    // effecten op de overgangen: niet op elke overgang, afgewisseld, passend bij de overgangsstijl
    const fx = [];
    {
      const r = rng((P.variation || 0) * 131 + edit.length * 7 + 3);
      const base = { mix: ['burn', 'flash', 'glow', 'leak'], whip: ['flash', 'burn', 'flash'], zoom: ['flash', 'burn'], clean: ['glow', 'leak'] }[P.transition] || ['burn', 'flash', 'glow', 'leak'];
      const on = base.filter((k) => P[k] && (P[k + 'Amt'] ?? 1) > 0.01);
      const DUR = { flash: 0.32, burn: 0.36, leak: 0.7, glow: 1.0 };
      let k = Math.floor(r() * 4), lastT = -9;
      if (on.length) shotsOut.forEach((sh, i) => {
        if (i === 0) return;
        if (r() < (P.transition === 'clean' ? 0.45 : 0.3)) return;
        const type = on[k++ % on.length];
        fx.push({ t: +sh.start.toFixed(3), type, dur: DUR[type], amt: +(P[type + 'Amt'] ?? 1).toFixed(2), rot: [0, 90, 180, 270][Math.floor(r() * 4)] + (r() - 0.5) * 20, flip: r() < 0.5 });
        lastT = sh.start;
      });
      if (P.flash && P.flashAmt > 0.01) sfx.filter((e) => e.type === 'impact').forEach((e) => { if (!fx.some((f) => Math.abs(f.t - e.t) < 0.3)) fx.push({ t: e.t, type: 'flash', dur: 0.28, amt: +(P.flashAmt * 0.6).toFixed(2) }); });
      fx.sort((a, b) => a.t - b.t);
      // film burn krijgt een camera-sluiter
      fx.filter((f) => f.type === 'burn').forEach((f) => ev(Math.max(0, f.t - 0.07), 'shutter', { gain: 0.8 }));
      sfx.sort((a, b) => a.t - b.t);
    }
    // afwerking van de beweging: gelijke cut-snelheid, rust voor de cut, geen zigzag in de draai
    if (P.polish > 0) polish(objects, P, en);
    cursor.kfs.sort((a, b) => a.t - b.t);
    // cursor nooit langzaam over andere shots heen laten invaden: vlak voor zijn volgende optreden pas zichtbaar
    for (let i = cursor.kfs.length - 1; i > 0; i--) {
      const a = cursor.kfs[i - 1], b = cursor.kfs[i];
      if ((a.o ?? 1) < 0.05 && (b.o ?? 1) > 0.05 && b.t - a.t > 0.5) cursor.kfs.splice(i, 0, { ...b, t: +(b.t - 0.25).toFixed(3), o: 0, ease: 'linear' });
    }
    if (cursor.kfs.length) objects.push(cursor);
    sfx.sort((a, b) => a.t - b.t);
    return {
      width: VW, height: VH, perspective: 2300, laptop: LAPTOP, objects, duration: +Math.max(0.5, T).toFixed(2), shots: shotsOut, swaps, edit, sfx,
      bg: P.bg, bgStyle: P.bgStyle, reflection: !!P.reflection, bgParallax: P.bgParallax, accent: R.accent || '#ff7a2f', accent2: R.accent2 || '#f5f0e8', pop: true,
      autoframe: P.autoframe > 0 ? P.autoframe : false,
      fx, fxAssets: { burn: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `fx/burn/0${i}.jpg`), leak: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `fx/leak/0${i}.jpg`) },
      camera: camSegs.length ? { segments: camSegs } : null, watermark: P.watermark ? R.wm || null : null,
      captions: P.captions ? captions : [], captionStyle: P.captionStyle,
      look: { shadow: P.shadow, rim: P.rim, sheen: P.sheen, vignette: P.vignette, drift: P.drift, sweep: P.sweep },
      render: { bloom: P.bloom ? P.bloomAmt : 0, chroma: P.chroma ? P.chromaAmt : 0, lens: P.lens ? P.lensAmt : 0, grade: P.grade, motionBlur: P.motionBlur, grain: P.grain, sound: P.sound, volume: P.volume, soundStyle: P.soundStyle, sfxWhoosh: P.sfxWhoosh, sfxClick: P.sfxClick, sfxAccent: P.sfxAccent, sfxImpact: P.sfxImpact, music: P.music, soundEngine: P.soundEngine }, params: P,
    };
  }

  // Afwerking van de beweging (na het bouwen van alle shots), sterkte P.polish 0..1:
  // 1) het laatste rustige stuk voor de uitvlucht beweegt minder: het shot 'landt' voor hij vertrekt
  // 2) een draai die van richting wisselt tussen tussen-keyframes wordt gladgestreken (geen heen-en-weer)
  function polish(objects, P, en) {
    const k = Math.max(0, Math.min(1, +P.polish || 0));
    if (!k) return;
    // de in- en uitvluchtafstanden blijven zoals per shot gekozen (en door de overgangsvorming bepaald): verkorten liet grote vlakken
    // bij de shotstart in beeld poppen, verlengen maakt de cuts harder dan bedoeld
    for (const o of objects) {
      if (!o.kfs || o.kfs.length < 3 || o.type === 'fill' || o.type === 'cursor' || /^(intro|outro|dev-|travel|stack|fan)/.test(o.id)) continue;
      const kfs = o.kfs, n = kfs.length;
      // landen: alleen als het laatste rustige stuk dezelfde kadrering houdt (zelfde draaipunt); een bewuste eindcompositie (hele groep in beeld) blijft intact
      if (n >= 4 && kfs[n - 1].fly) { const y = kfs[n - 2], x = kfs[n - 3]; if (Math.abs((y.px || 0) - (x.px || 0)) < 1 && Math.abs((y.py || 0) - (x.py || 0)) < 1 && !y.fr === !x.fr) for (const p of ['s', 'rx', 'ry', 'rz', 'x', 'y']) if (y[p] !== undefined && x[p] !== undefined) y[p] = x[p] + (y[p] - x[p]) * (1 - 0.35 * k); }
      if (!o.crazy && n >= 5) for (const p of ['ry', 'rz']) for (let i = 2; i <= n - 3; i++) { const a = kfs[i - 1][p], b = kfs[i][p], c = kfs[i + 1][p]; if (a === undefined || b === undefined || c === undefined) continue; if ((b - a) * (c - b) < 0) kfs[i][p] = b + ((a + c) / 2 - b) * 0.5 * k; }
    }
  }

  // Regie-idee in gewone taal (NL/EN) omzetten naar instellingen. Lokaal, zonder API. Geeft { params, notes }.
  function interpretBrief(text, params, A, R) {
    const P = merge(params);
    const t = ' ' + String(text || '').toLowerCase() + ' ';
    const has = (re) => re.test(t);
    const notes = [];
    const set = (k, v, why) => { P[k] = v; notes.push(why); };
    const PRE = {
      clean: { burn: false, leak: false, flashAmt: 0.4, chromaAmt: 0.3, ramp: 0.6, tempo: 1.15, energy: 0.6, tilt: 0.7, spin: 0.5, hold: 1.4, calm: 0.85, transition: 'clean', soundStyle: 'studio' },
      hype: { ramp: 1, tempo: 1, energy: 0.9, tilt: 1, spin: 0.9, hold: 1.1, transition: 'mix', soundStyle: 'studio' },
      insane: { ramp: 1.4, tempo: 0.85, energy: 1.5, tilt: 1.4, spin: 1.4, hold: 0.7, calm: 0.3, transition: 'whip', soundStyle: 'cinematic' },
    };
    if (has(/\b(rustig|clean|kalm|chill|strak|minimalistisch|premium|luxe|subtiel|elegant)/)) { Object.assign(P, PRE.clean); notes.push('rustige, cleane stijl'); }
    if (has(/\b(hype|energiek|dynamisch|vlot|pakkend)/)) { Object.assign(P, PRE.hype); notes.push('energieke stijl'); }
    if (has(/\b(insane|wild|extreem|lijp)\b/)) { Object.assign(P, PRE.insane); notes.push('wilde stijl'); }
    const m = /(\d{1,2})\s*(s\b|sec|seconde)/.exec(t);
    if (m) set('length', +m[1], `lengte ${m[1]} s`);
    else if (has(/\b(kort|korter|short)\b/)) set('length', 15, 'kort: 15 s');
    else if (has(/\b(lang|langer)\b/)) set('length', 30, 'lang: 30 s');
    if (has(/(alleen|alles|enkel|only|volledig).{0,20}laptop|laptop.{0,12}(alleen|only)/)) set('device', 'laptop', 'alles in de laptop');
    else if (has(/meer laptop|laptop.{0,10}(meer|vaker)/)) set('device', 'more', 'meer laptop-shots');
    if (has(/\b(telefoon|mobiel|phone|iphone)/) && !has(/(geen|zonder|no) (telefoon|mobiel|phone)/)) { P.shots = { ...P.shots, phone: true }; notes.push('telefoon erbij'); }
    if (has(/crash ?zoom|zoom.?overgang|inzoom/)) set('transition', 'zoom', 'crash-zoom overgangen');
    else if (has(/\bwhip|swipe|snelle overgang/)) set('transition', 'whip', 'whip-overgangen');
    else if (has(/\b(fade|dip|zachte overgang|rustige overgang)/)) set('transition', 'clean', 'zachte overgangen');
    [['aurora', /aurora|kleurrijk|gloed|glow/], ['grid', /\bgrid|raster|vloer|tech/], ['spotlight', /spot(light)?|podium/], ['solid', /\b(vlak|effen|plain)/], ['studio', /\bstudio\b/]]
      .forEach(([k, re]) => { if (re.test(t)) set('bgStyle', k, 'achtergrond ' + k); });
    if (has(/\b(donker|dark|zwart)/)) set('bg', '#121214', 'donkere achtergrond');
    if (has(/\b(licht|light|wit)e? achtergrond/)) set('bg', '#e9e6e1', 'lichte achtergrond');
    if (has(/(geen|zonder|no) (effecten|fx|flitsen)/)) { ['flash', 'burn', 'leak', 'glow', 'chroma'].forEach((k) => (P[k] = false)); notes.push('geen effecten'); }
    else {
      if (has(/(flits|flash)/)) set('flash', true, 'flitsen');
      if (has(/(film ?burn|burn)/)) set('burn', true, 'film burn');
      if (has(/(light ?leak|leaks?|lichtlek)/)) set('leak', true, 'light leaks');
      if (has(/(glitch|rgb|chroma)/)) { P.chroma = true; P.chromaAmt = 1; notes.push('RGB-split'); }
      if (has(/(effecten|fx)\b/) && !has(/(geen|zonder)/)) { ['flash', 'burn', 'leak', 'glow'].forEach((k) => (P[k] = true)); notes.push('alle effecten aan'); }
    }
    if (has(/(geen|zonder|no) (tekst|teksten|captions?|titels?|ondertitel)/)) set('captions', false, 'geen tekst in beeld');
    else if (has(/\b(met|plus|ook) (tekst|captions?|titels?)/)) set('captions', true, 'tekst in beeld');
    if (has(/\b(grote|dikke|bold|vette) (tekst|titels?|letters)/)) { P.captions = true; P.captionStyle = 'bold'; notes.push('grote tekst'); }
    if (has(/\b(mesh|zachte kleuren|pastel)/)) set('bgStyle', 'mesh', 'achtergrond mesh');
    if (has(/(geen|zonder|no) (schaduw|shadow)/)) set('shadow', 0, 'geen grondschaduw');
    if (has(/\b(pro|premium|apple|keynote)\b/)) { Object.assign(P, { polish: 1, calm: 0.6, energy: 0.7, spin: 0.5, tilt: 0.8, burn: false, leak: false, flashAmt: 0.4, captions: true, captionStyle: 'clean', shadow: 0.8, grade: 0.6 }); notes.push('pro-afwerking'); }
    if (has(/(geen|zonder|no) (muziek|music)/)) set('music', 0, 'geen muziek');
    else if (has(/\b(met|plus|ook) (muziek|music)/)) set('music', 1, 'met muziek');
    if (has(/(geen|zonder|no) (geluid|sound|audio)/)) set('sound', 'off', 'geen geluid');
    if (has(/\b(cinematic|filmisch|episch|epic|diep|bass)/)) set('soundStyle', 'cinematic', 'filmisch geluid');
    if (has(/\b(minimal|minimaal)\b/)) set('soundStyle', 'minimal', 'minimaal geluid');
    if (has(/(meer|extra|harder) (draai|3d|rotatie|beweging)/)) { P.spin = Math.min(1.8, P.spin * 1.35); P.tilt = Math.min(1.8, P.tilt * 1.25); P.energy = Math.min(1.8, P.energy * 1.2); notes.push('meer 3D-beweging'); }
    if (has(/(minder|geen) (draai|scheef|3d|rotatie)|\brecht\b/)) { P.spin = 0.35; P.tilt = 0.55; notes.push('rechter beeld, minder draai'); }
    if (has(/(close.?ups?|details?|dichtbij|inzoomen op)/)) { P.zoom = Math.min(1.3, P.zoom * 1.1); P.shots = { ...P.shots, hover: true, features: true }; notes.push('meer close-ups'); }
    if (has(/(sneller|vlotter|korter per shot)/)) { P.tempo = Math.max(0.6, P.tempo * 0.85); notes.push('vlotter tempo'); }
    if (has(/\b(langzamer|trager|meer rust|leestijd)/)) { P.tempo = Math.min(1.6, P.tempo * 1.15); P.hold = Math.min(2.2, P.hold * 1.2); notes.push('meer rust'); }
    if (has(/(crazy|gekke? shots?|spin|orbit|rondje)/)) {
      P.shots = { ...P.shots, spin: true, orbit: true, stack: true };
      if (Array.isArray(P.edit)) { if (!P.edit.some((e) => e.shot === 'orbit')) P.edit.splice(Math.min(1, P.edit.length), 0, { shot: 'orbit' }); if (!P.edit.some((e) => e.shot === 'spin')) P.edit.splice(Math.max(1, P.edit.length - 1), 0, { shot: 'spin' }); }
      notes.push('crazy shots: laptop-orbit en telefoon-spin');
    }
    const SN = { longscroll: /(lange scroll|hele pagina|scroll-?through)/, pullback: /(pull.?back|uitzoom)/, menu: /menu/, hover: /(muis|hover|cursor)/, features: /(features?|usp|reviews?)/, explode: /(lagen|layers|explode)/, cards: /(kaarten|cards|producten)/, travel: /(vlucht|travel|fly)/, intro: /intro/, outro: /outro/, depth: /(scroll|parallax)/, slide: /(slider|carousel)/ };
    Object.entries(SN).forEach(([k, re]) => {
      const src = re.source;
      if (new RegExp('(geen|zonder|niet|skip|no) (de |het )?' + src).test(t)) { P.shots = { ...P.shots, [k]: false }; if (Array.isArray(P.edit)) P.edit = P.edit.filter((e) => e.shot !== k); notes.push('zonder ' + k); }
      else if (new RegExp('(met|plus|ook|extra|meer) (de |het )?' + src).test(t)) { P.shots = { ...P.shots, [k]: true }; notes.push('met ' + k); }
    });
    if (has(/\b(nieuw|anders|verras|variatie|creatief|random)/) && A && R) {
      const g = makeEdit(1 + Math.floor(Math.random() * 5000), A, R);
      P.edit = g.edit.filter((e) => P.shots[e.shot] !== false || e.shot === 'outro'); P.variation = 0;
      if (!notes.some((n) => /achtergrond/.test(n))) P.bgStyle = g.look.bgStyle;
      notes.push('nieuwe edit: ' + describeEdit(P.edit));
    }
    return { params: P, notes };
  }

  return { interpretBrief, buildTimeline, makeEdit, describeEdit, available, sources, overrideFor, SLOTS, GRAB, MEDIA, mediaChoices, normalizeMedia, DEFAULTS, FORMATS, LAPTOP, ANGLES, SHOT_INFO, merge };
});
