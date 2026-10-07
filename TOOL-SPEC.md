# TOOL-SPEC · Website Motion Studio v16

Doel van dit document: een developer of coding agent laten begrijpen wat deze tool is, waarom hij bestaat en hoe hij werkt, zodat hij hem kan nakijken, verbeteren of uitbreiden zonder het doel te verliezen.

## 1. Waarom de tool bestaat

Een taalmodel (ChatGPT/Claude) kan geen website live bekijken, er niet over hoveren en niet zien hoe een menu openschuift. Seedance/Higgsfield genereert alleen goede motion-video's als het de echte site als referentie krijgt.

Rolverdeling:

| Rol | Wie |
|---|---|
| De website | de bron, de waarheid |
| Deze tool | de ogen en handen: bekijkt, meet, bedient en neemt op |
| ChatGPT/Claude | creative director: kiest momenten, bedenkt de film, schrijft de prompt |
| Seedance/Higgsfield | renderer |

Ontwerpregel: CAPTURE THE REAL WEBSITE ACCURATELY. CAPTURE HOW IT REACTS AND MOVES. CAPTURE THE BEST STATES. LET THE AI DESIGN THE FILM.

De tool schrijft dus nooit zelf een shotlist of prompt. Hij levert bewijs.

## 2. Nieuw in v11

v10 leverde stills + tagged stills + CSS-motioncontext. v11 voegt toe:

1. Echte interactie-tests in de browser (hover, klik, scroll) met metingen vóór/na.
2. Video-clips van de beste momenten met een gesimuleerde cursor, bruikbaar als @Video-referentie in Seedance.
3. Contactsheets per clip (6 frames + tijdlijn), zodat een AI die geen video kan afspelen toch ziet wat er gebeurt.
4. Een uploadset die rekening houdt met Seedance-limieten (standaard 9 afbeeldingen, 3 video's, samen max 15 s).

## 2b. Nieuw in v12

1. `lib/director.js`: shot-plan en `DIRECTOR-BRIEF.md` (secties, best moments, hero/macro/transition opportunities, focal elements, sequence flow).
2. `lib/preview.js`: lokale cinematic preview. Clips en stills worden 3D-vlakken in een donkere studio; camera met speed ramps, whip pans, macro focus op het echte klikpunt, fly-through, logo-resolve. Frame-exact gerenderd (virtuele tijd), motion blur via subframes.
3. Adaptieve timewarp: haalt een clip minder dan `minClipFps`, dan wordt hij opnieuw opgenomen met een sterkere vertraging.
4. Master-instructies met twee modi: HYPERREAL (standaard, site als referentie) en SOURCE-LOCKED.

Shot-plan van de preview: establish (hero-clip, dolly-in, focus op CTA) → interaction (macro op menu-knop, klik, pull-back, duik in menuvlak) → detail-sweep (lateral fly-by langs kaarten met echte hover) → depth (orbit rond parallax/scroll-clip) → fly-through (stills als lagen) → brand-resolve (logo-crop uit een still).

## 2g. Nieuw in v20

- Timeline: `polish()` na het bouwen van de shots. Dempt het laatste rustige segment voor de uitvlucht (35%, alleen bij gelijk draaipunt) en streelt richtingswisselingen in ry/rz tussen tussen-keyframes glad. De in- en uitvluchtafstanden blijven zoals per shot gekozen. Objecten intro/outro/dev-/travel/stack/fan en `crazy` blijven buiten de rotatie-smoothing.
- Timeline: `captions` (lijst `{t0, t1, text, sub, pos}`) en `look` (`shadow`, `rim`, `sheen`, `vignette`) in de timeline-uitvoer. Caption-bronnen: `A.headline` (hero-headline of paginatitel), `R.host`, feature-teksten, groep-kind. Per edit-regel `caption: { text, sub, pos } | false`.
- Engine: `#ground`-laag met grondschaduwen (geprojecteerde bbox van page/lid/phone/crop), rim-overlay per surface (opacity uit de normaal), glasgradient in `lid.extra`/`body.extra`, `#cap`-laag met captions (Inter uit `_assets/fonts`, maskeer-reveal, scrim), achtergrond `mesh`, instelbaar vignet.
- Render: `grade` (curves + eq) vóór de korrel; `supersample` 1-2 via deviceScaleFactor, terug naar doelresolutie met Lanczos (sharp).
- Studio: presets pro/clean/hype/insane, tekst-in-beeld (standaard uit), look-sliders, caption per shot, kwaliteit ultra.
- v21.0: objecttype `curved` (K stroken op een cilinder met straal (W/2)/sin(bend/2), crop per strook, één grondschaduw per kaart); shots `ring` en `phonering` (arc-posities x = R·sin, z = R·(cos−1), ry = hoek; ringrotatie met smoothstep; `R.ringSrcs`/`R.fan` als plek-overrides; uitgezonderd van auto-kadrering); `cfg.range` in de render met `-ss` op de audio; Studio solo-lus en deelrender; bgStyle `pastel`.
- v20.3: `captureLongPages()` in `lib/extra.js` (segmenten van `height - header_height` px, sticky header één keer, `long_pages` in de context); shots `pullback` en `longscroll` (hoog `plane`-object met `h = paginahoogte`); live preview met dubbele `<img>`-buffers per laag in `setImage`.
- v20.1: `drift` (zweving op `#world` en `#ground`, sinussen met periodes 10-33 s), `sweep` (sheen-positie loopt per object van links naar rechts over de looptijd van zijn keyframes), `W.features` neemt het item (niet de rij) als groep en de itemtekst als feature-tekst.

## 2f. Nieuw in v16

- Capture: key features (`lib/extra.js` + `W.features()`): tekstelementen gescoord op aanbod, vertrouwen/reviews, service, cijfers en prijzen, met lettergrootte, positie en groepering naar het omliggende blok (USP-item, stat, reviewkaart). Elk krijgt een eigen screenshot in `features/`. `refeatures.js` doet dit opnieuw voor een bestaande capture.
- Capture: mobiele versie (390x844 @3x, iPhone-UA, touch): scroll-clip, menu-clip met tik (tap-positie en -tijd), hero-still.
- Timeline: edits. `params.edit` is een lijst `{shot, angle, mirror, tempo, clip}`; `makeEdit(seed)` maakt een logische maar unieke edit (opener, afwisseling wide/close-up, max. twee apparaat-shots, outro) plus look (achtergrond, energie, spin). Hoek-presets: low, high, top, dutch-l/r, profile, close, wide, calm, wild. Hoeken zijn begrensd (rx ≤ 66°, rz ≤ 38°, ry ≤ 52°).
- Nieuwe shots: `phone` (3D-telefoon, met zijkanten en achterkant), `devices` (laptop + telefoon, camera-segment met focus op de telefoon), `features` (close-ups die uitpoppen).
- Camera-segmenten: meerdere camerabewegingen per video (`camera.segments`).
- Speed ramps: eerste en laatste keyframe van een shot krijgen een "fly"-tangent (shot begint en eindigt op snelheid, rustig midden, geen stilstand bij overgangen). Clip-tijd kan slow-motion ramps hebben (analytisch geïntegreerd met erf), bijv. terwijl het menu opent.
- Sound (`lib/sound.js`): events uit de timeline (klik, tik, pop, tap, impact, riser, shimmer) + whooshes uit de bewegingsanalyse (`SC.motion`: pieken in schermsnelheid, richting bepaalt de panning). Synthese: gefilterde ruis met sweep (whoosh), gedempte sinussen (klik/tik/pop), sub-sweep + ruisburst (impact), Schroeder-reverb, zachte limiter, piek -1 dBFS. WAV wordt in de MP4 gemuxt (AAC 256k) en apart bewaard.
- QA (`SC.qa`): gevulde beeldfractie (polygoon-clipping), hoek van het hoofdvlak, zoom t.o.v. bronresolutie. `qaIssues` meldt leeg beeld, te schuin en te ver ingezoomd buiten overgangen.
- MCP: jobs als losse processen (`jobrun.js`, status in `<out>/.jobs`), warme preview-browser (`lib/previewer.js`), tools `suggest_edits` en `review_video` (final pass), selftest (`node mcp.js --selftest`).
- Studio: edit-chips, "Nieuwe edit", geluidskeuze, volume, speed-ramp-slider, preview met geluid (WAV gesynchroniseerd met de player).

## 2e. v15

- `mcp.js`: MCP-server (stdio) voor Claude Desktop. Tools: describe_options, list_projects, capture_website, get_job, get_project, preview (contactsheet als beeld), try_variations (rij per variant), set_params, render_video, open_folder. Logging gaat naar stderr. Installer: `Koppel aan Claude Desktop.command` (schrijft `claude_desktop_config.json`).
- Opname op deviceScaleFactor 2 (stills en clips 3840x2160); showcase gebruikt de volle resolutie, preview een 960px proxy.
- Cursorpad wordt tijdens clips gelogd (`cursor_path` in de clip-JSON). Gebruikt voor muis-tracking: het menu-shot drijft mee met de muis, het `hover`-shot volgt de cursor als close-up.
- Globale camera (`timeline.camera`): voor het `travel`-shot, waarin twee pagina's als vaste objecten in de ruimte staan en de camera ertussen vliegt. Met camera actief geldt één gezamenlijk focusvlak.
- `explode`-shot: tags van de hero-still (kop, CTA's, badge, logo, menuknop) worden losse vlakken op verschillende diepte, met een wazige "afdruk" en schaduw op de pagina. Pop met back-easing.
- Achtergronden (studio, aurora, grid, spotlight, solid) in een eigen laag die parallaxt: deterministisch pad uit de integratie van de beweging van het hoofdobject en de camera, met terugvering.
- Reflecties via `-webkit-box-reflect` op pagina- en crop-vlakken.
- Variatie-seed: schudt de middenshots en varieert per shot hoeken, draairichtingen en whip-richting.
- Anti-flikker: `<img>`-lagen in plaats van background-image (render wacht op decode van precies dat element), vloeiende DOF-overgang tussen schuin en frontaal, opgetilde lagen verborgen zolang ze niet opgetild zijn (geen z-fighting).
- Framing: kadrering op groepen (kop + CTA in het laptop-shot, CTA + menuknop in het menu-shot), kaarten en koppen gevuld op een vaste fractie van de beeldbreedte.

## 2d. Studio (v14)

- `studio.js`: lokale server (poort 4747, geen extra dependencies). Endpoints: `/api/capture` (start capture.js als child process, voortgang uit de log), `/api/project/<naam>` (assets voorbereiden en teruggeven), `/api/params` (instellingen bewaren), `/api/render` (frame-exacte render met voortgang en ETA), `/api/jobs/<id>`, `/api/stop/<id>`, statische bestanden onder `/p/<project>/` met range-support voor video.
- `studio/index.html`: UI. Bouwt de timeline in de browser met hetzelfde `lib/showcase-timeline.js` als de render, en stuurt die naar een iframe met de engine (`studio/player.js`) voor realtime preview met proxy-frames.
- `lib/showcase-timeline.js`: shot-plan als pure functie `buildTimeline(A, R, params)`, bruikbaar in Node en browser. Parameters: format, tempo, energy, tilt, spin, zoom, dof, lift, hold, motionBlur, grain, watermark, cursor, bg, shots.
- Easing: keyframes met ease `flow` worden verbonden met monotone Hermite-splines (Fritsch-Butland), zodat de camera doorbeweegt door keyframes zonder overshoot. Whips en crash zooms houden eigen bezier-curves.
- Framing: subjecten op derden (verticale offset schaalt mee met het formaat), leesmomenten via `hold`.
- Assets worden per project gecached in `showcase/_assets/` (scherp, proxy 960px, voorgeblurd).

## 2c. Showcase 9:16 (v13)

`lib/showcase.js` + `lib/showcase-engine.browser.js`. Echte 3D-scene in Chromium: elk vlak is een element met een eigen matrix3d binnen één preserve-3d context, dus diepte en sortering zijn echt. Objecten: website-vlakken (clip of still), een 3D-laptop (toetsenbord-canvas, deksel met scherm), crops (logo, CTA), kleurvlakken, cursor.

- Depth of field: per vlak een scherpe en een voorgeblurde laag; de wazige laag krijgt een lineair masker dat berekend wordt uit de echte diepte (m13/m23 van de matrix). Scherpte ligt op het pivot-punt, dus als de camera naar een ander element gaat, trekt de focus mee (focus pull). `fz` verschuift de focus (bijvoorbeeld naar opgetilde kaarten).
- Opgetilde elementen: kaarten uit een still worden losse vlakken boven de pagina, met een lege plek en een zachte schaduw eronder.
- Motion blur: per frame wordt de schermsnelheid berekend; bij snelle bewegingen worden tot 14 subframes gerenderd en gemiddeld (sharp), bij stilstand 1. Sluitertijd 0,55 frame.
- Geen overlappende vlakken tussen shots: overgangen via whips, crash zooms en kleurvlakken.
- Shots: intro (logo, klik, crash zoom) → laptop swoop (toetsenbord → scherm → CTA) → menu (macro, klik, orbit, duik in het menu) → kaarten (pagina plat, kaarten los, focus pull) → orbit rond scroll/parallax → tweede interactie (slider/hover) → outro (logo + CTA, cursor klikt).

## 3. Pijplijn

```
URL
 └ analyse per pagina (homepage + max 3 gekozen pagina's)
     ├ laden, cookies accepteren, chat-widgets verbergen, lazy images forceren
     ├ scroll-pass: lazy-load + scroll-reveals meten (opacity/transform voor vs na binnenkomen, toegevoegde classes)
     ├ secties vinden en scoren (beeldaandeel, H1, CTA's, kaarten, slider, video, reviews; footer/formulier negatief)
     ├ elementen + rollen (logo, menu-toggle, headline, cta, card, image, slider, review, badge, price, nav...)
     ├ parallax/sticky: per sectie 5 scrollposities, per element snelheid t.o.v. scroll
     ├ sliders: autoplay detectie (track-state 3.5 s volgen)
     ├ hover-probe: stijl-snapshot element + kinderen vóór/na hover, verschenen dropdowns, A/B-screenshots
     └ klik-probe: per kandidaat verse pagina, motion-tracking van ~200 relevante elementen elke 40 ms, pixel-diff, A/C-screenshots
 └ stills: beste secties over alle pagina's, clean + tagged (N.M labels)
 └ clip-plan: kandidaten scoren, eerst 1 per type (variatie), dan aanvullen
 └ clips opnemen: verse pagina per clip, choreografie, CDP-screencast, H.264
 └ output: uploadset, UPLOAD-ORDER.md, CAPTURE-REPORT.md, JSON, README, ZIP
```

## 4. Bestanden

| Bestand | Verantwoordelijkheid |
|---|---|
| `capture.js` | CLI, instellingen, volgorde van de pijplijn |
| `lib/inpage.js` | alles wat in de pagina draait (`window.__wmc`): rollen, secties, snapshots, reveal/parallax/slider-metingen, klik-tracking, tag-overlay, cursor-overlay |
| `lib/browser.js` | Chromium starten, pagina voorbereiden, cookie-consent, widgets verbergen |
| `lib/analyze.js` | analyse per pagina, hover/klik-probes, parallax, sliders, extra pagina's kiezen |
| `lib/stills.js` | stills kiezen en maken (clean + tagged + elementkoppeling) |
| `lib/clips.js` | clip-plan, choreografieën, timewarp, contactsheets, trimmen voor Seedance |
| `lib/record.js` | screencast-recorder, cursor met boogbeweging en klik-ring, vloeiend scrollen |
| `lib/output.js` | uploadset, rapporten, JSON, ZIP |
| `CHATGPT-MASTER-INSTRUCTIONS.md` | de instructie voor de AI die de prompt schrijft (gaat mee in iedere capture) |

## 5. Clip-types

| Type | Wat er gebeurt | Bron |
|---|---|---|
| menu-open / overlay-open / dropdown | cursor glijdt naar toggle, hover, klik, menu schuift open, hold | klik-probe |
| hover-dropdown | cursor hovert navigatie-item, megamenu verschijnt, cursor gaat erin | hover-probe |
| card-hover-sweep | cursor glijdt langs 2-3 kaarten, ieder echt hover-effect | hover-probe |
| hero-cta | hero in rust, cursor naar hoofd-CTA, hover | elementen + hover |
| slider | cursor klikt twee keer op volgende-pijl | klik-probe |
| slider-autoplay | stilstaand shot op een slider die zelf loopt | slider-probe |
| parallax-scroll | vloeiende scroll door een sectie met gemeten parallax/sticky | parallax-meting |
| scroll-reveal | sectie net onder beeld, scroll erin, reveals spelen af | reveal-meting |
| scroll-tour | vloeiende scroll vanaf de top (ritme-referentie) | altijd |
| accordion / tab / search / panel | cursor klikt, paneel opent | klik-probe |

Naamgeving: `clips/clipNN_p<pagina>_<label>.mp4` + `_frames.png` + `.json`. In de uploadset: `V1_clipNN_<type>.mp4` = @Video 1.

## 6. Opnametechniek

- Chrome DevTools `Page.startScreencast` (JPEG q95) met echte frame-tijdstempels; ffmpeg zet dat om naar constante 30 fps H.264 (CRF 15).
- Timewarp: via een init-script lopen `performance.now`, `Date`, `requestAnimationFrame`, `setTimeout/setInterval` en video's K keer langzamer; CSS/Web Animations via `Animation.setPlaybackRate(1/K)`. De choreografie draait K keer langzamer, daarna wordt de video K keer versneld. Resultaat: K keer zoveel echte frames, zelfde tempo als de echte site.
- Cursor: DOM-overlay (zwarte pijl, witte rand, klik-ring). Echte `mouse.move` events gaan mee, zodat hover-states echt triggeren. Beweging langs een kwadratische boog met ease-in-out.
- Scrollen: standaard exacte `scrollTo` per frame (vuurt normale scroll-events voor ScrollTrigger/IntersectionObserver). Bij Lenis/Locomotive: echte wheel-events.

## 7. Veiligheid

- Klik alleen op: menu-toggles, `aria-expanded`/`aria-controls`/`aria-haspopup`, tabs, `summary`, slider-pijlen, zoek-toggles.
- Nooit: formulieren, submit, winkelwagen, bestellen, login, account, verwijderen, tel/mailto, externe of interne navigatie. Navigeert een klik toch weg, dan wordt het resultaat weggegooid.
- Nieuwe tabs/popups worden direct gesloten.

## 8. Wat de AI ontvangt

- `CAPTURE-REPORT.md`: per still een tag-tabel (tag, rol, tekst, positie, motion-bewijs, gekoppelde interacties), per clip wat er gebeurt + tijdlijn + gemeten resultaat, per pagina alle hover/klik/reveal/parallax/slider-metingen.
- `website-reference-context.json`: dezelfde data, volledig.
- Stills, state-foto's, contactsheets, clips.
- `UPLOAD-ORDER.md`: exacte mapping naar @Image n / @Video n.

## 9. Controlepunten voor een reviewer

1. Kloppen de rollen (logo, CTA, menu-toggle) op 5 echte sites?
2. Vindt de klik-probe het hamburger- of hoofdmenu en meet hij de juiste beweging?
3. Worden reveals en parallax gevonden bij GSAP/ScrollTrigger-, Webflow-, Framer- en Elementor-sites?
4. Zijn clips vloeiend (log meldt effectieve fps)? Anders timewarp verhogen.
5. Klopt de @-nummering in `UPLOAD-ORDER.md` met de bestandsvolgorde in `higgsfield-upload/`?
6. Worden cookiebanners en chat-widgets netjes weggehaald?

## 10. Mogelijke volgende stappen

- Seedance/Higgsfield API: uploadset + prompt automatisch versturen, resultaat naast `preview/PREVIEW.mp4` zetten. De preview blijft als controle zonder API.

- Knop "Analyseer met AI": map automatisch naar een API sturen met de master-instructies. De map blijft altijd zelfstandig bruikbaar.
- 9:16 modus (mobiele viewport, tik-indicator in plaats van cursor) voor Reels/TikTok.
- Handmatige modus: tool opent zichtbaar, gebruiker klikt zelf wat mooi is, tool neemt die interactie op en meet hem.
- Frame-exacte opname via virtuele tijd voor zeer zware WebGL-sites.
