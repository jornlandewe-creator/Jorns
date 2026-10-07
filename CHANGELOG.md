# Changelog

## v21.2 · de drum zoals op de referentie

- **Card-drum** (standaard aan, vervangt de ring als standaardshot): een echte cilinder van kaarten, tien per rij, twee rijen, van boven en van dichtbij bekeken met een wijde lens (ca. 61 graden), zoals op de referentie: de voorste kaart groot, de achterste klein, de bovenste boog altijd in beeld. De camera draait eromheen (72 graden), stijgt licht en duwt iets naar binnen. De kaarten zijn tweezijdig: de achterkant toont dezelfde inhoud leesbaar (duplicaten), dus de hele cilinder is gevuld. Bronnen die op zijn herhalen zich. Zelfde plekken als de ring (s0..s5 in de voorste rij). `rows: 1` voor één rij.
- **Drum-reveal** (aan te vinken): begint vlak op de voorste kaart (vult het beeld), de camera trekt terug en stijgt tot de hele drum draait.
- **Telefoon-drum** (aan te vinken): twaalf telefoons om een cilinder, zelfde camera; achteraan zie je de achterkanten van de telefoons.
- **Card-ring (band)** blijft als extra effect (standaard uit).
- Lens per shot: de drum-shots gebruiken een wijdere lens (`timeline.lens`); de rest van de film houdt de normale lens. De wissel valt altijd op een cut.
- Gebogen kaarten zonder naadlijntjes: buurstroken liggen om en om een halve pixel naar buiten/binnen zodat ze elkaar nooit snijden (Chromium tekende op snijlijnen een lichte naad), en de overlap is groter.
- Regie-idee kent: drum, cilinder, drum-reveal, telefoon-drum.


## v21.0 · ring-shots, alleen-dit-shot, pastel

- **Card-drum** (standaard aan): twee rijen van zes echt gebogen schermen dicht op elkaar om een cilinder, van iets boven bekeken; de drum draait rustig door en zweeft licht, de voorste kaart is iets groter. Elke kaart is opgebouwd uit tien stroken op de cilinder, dus de buiging is echt en de belichting volgt de ronding. Zes plekken in de voorste rij die je per plek vult met een pagina, de clip van de site of een eigen schermopname (upload via *+ Eigen beeld of video*); de achterste rij vult zich met de overige bronnen. `rows: 1` in de edit voor één rij.
- **Lila-achtergrond**: vaste lichte lila zoals in motion-graphics-referenties (naast *Pastel*, dat uit de merkkleur komt).
- **Telefoon-ring**: dezelfde ring met vijf telefoons; plekken vul je met mobiele opnames, mobiele schermen of eigen telefoonvideo's.
- **Alleen dit shot afspelen**: vinkje in het shotpaneel; de preview loopt dan in een lus over alleen dat shot.
- **Render alleen dit shot**: knop in het shotpaneel; rendert dat ene shot naar een losse MP4 (`..._shot.mp4`) met het geluid op de juiste plek.
- **Pastel-achtergrond**: licht en zacht, uit de merkkleur. Het vignet is daarbij automatisch zwakker.
- Regie-idee kent: ring, carrousel, telefoon-ring, pastel.
- Over Remotion: de engine rendert al frame-exact in Chromium (hetzelfde principe als Remotion); de ring-shots zijn daarom in de engine zelf gebouwd, zonder extra framework.


## v20.3

- Live preview zonder flikkering: elke beeldlaag heeft twee buffers. Het volgende frame laadt onzichtbaar en wordt pas getoond als het er is, dus nooit een leeg of half geladen frame.
- Schoner standaardbeeld: watermerk-logo in de achtergrond uit, spiegeling onder vlakken uit, gloed uit, rim light uit, RGB-split en lens-CA uit, flits zachter. Alles blijft aan te zetten onder Look en Effecten.
- Grondschaduw alleen onder pagina's, laptop en telefoon (niet onder logo of knop) en nooit als een close-up het beeld vult.
- Twee nieuwe shots, standaard aan: **Pull-back** (begint stil in macro op het logo of de knop, trekt terug tot de hele hero in beeld staat) en **Lange scroll** (de volledige pagina van boven tot onder als hoog vlak, de camera rijdt er rustig langs). Pagina-spin staat standaard uit.
- Volledige pagina's worden nu betrouwbaar vastgelegd: schermvullende screenshots per scrollstap, na de reveals, aan elkaar geplakt met de sticky header maar één keer (`pages/paginaN_lang.jpg`, `long_pages` in de context). Een full-page screenshot van de browser ging bij sites met scroll-effecten vaak mis. *Features opnieuw zoeken* in de Studio maakt ze ook voor bestaande projecten.
- In het shotpaneel kies je bij de lange scroll welke pagina (Snel kiezen).


## v20.2

- Fix: bij de feature-carrousel schoof de volgende pagina al in beeld terwijl de vorige er nog stond (pagina's over elkaar). De glide-overgang verkortte de wisselafstand tot 60%; de wissel-keyframes zijn daar nu van uitgezonderd en de afstand wordt uit de echte schermranden berekend. Dit zat ook al in v19.1.
- Fix: de polish-pass verkortte korte invluchten tot een vaste afstand, waardoor grote pagina's bij de shotstart in beeld konden poppen. Afstanden blijven nu zoals per shot gekozen.
- Levende camera zit nu in de projectie-wiskunde in plaats van als CSS-transform op de wereld: cursor, klik-ringen en grondschaduwen bewegen exact mee.
- Grondschaduw zonder blur-filter (vaste zachte gradient): geen her-rastering per frame, dus een vloeiende live preview.

## v20.1

- Tekst in beeld staat standaard **uit** (`captions: false`). Aanzetten kan onder Look > Tekst in beeld.
- Levende camera (`drift`, standaard 0.6): heel lichte, trage zweving van het hele beeld, dus nooit een stilstaand frame. Ook de grondschaduwen bewegen mee.
- Lichtstreep (`sweep`, standaard 0.8): per shot trekt één keer een zachte glans over de pagina, het laptopscherm of de telefoon.
- Lagen en kaarten komen iets verder los (`lift` 1.1).
- Detectie key features: een cijfer-USP is nu het hele item (getal plus label: "37 jaar vakmanschap") in plaats van alleen het getal, en nooit meer de hele rij. Een rij gelijke blokken telt als groep (pop-wall), niet als losse feature. Dubbele stukken uit lopende teksten (draaiende badge, marquee) worden samengevoegd; een los getal zonder label wordt overgeslagen.

## v20.0 · strakker, cleaner, premium

Beweging
- Polish-pass na het bouwen van de shots (`polish`, standaard 1): het laatste rustige stuk voor de cut beweegt minder (het shot landt, alleen als de kadrering gelijk blijft), en draaiingen die van richting wisselen tussen tussen-keyframes worden gladgestreken.
- Standaardwaarden rustiger: energy 0.7, tilt 0.85, spin 0.55, calm 0.55, hold 1.25, dof 0.9, ramp 0.5.
- Effecten standaard zachter: burn en leak uit, flash 0.45, glow 0.4, chroma 0.35, lens 0.35, grain 0.35.

Beeld (engine)
- Grondschaduw onder pagina, laptopdeksel, telefoon en crops (`shadow`): zachte ovaal uit de geprojecteerde hoekpunten, kleiner en zachter op afstand.
- Rim light (`rim`): dunne lichte rand langs elk vlak, sterker naarmate het vlak schuiner staat.
- Glas (`sheen`): vaste lichtval over laptop- en telefoonscherm, en een subtielere schuivende glans.
- Captions (`captions`, `captionStyle` clean|bold): Inter 600/700, kicker met accentstreep, maskeer-reveal, scrim onderin. Automatisch: kop van de site (één keer), feature-teksten met kicker (Reviews, Cijfers, Aanbod, Prijzen, Service), Navigatie, Mobiel, Desktop en mobiel, url als endcard. Per shot: `caption: { text, sub, pos }` of `caption: false`.
- Achtergrond `mesh`: drie zachte kleurvlekken in de merkkleuren.
- Vignet instelbaar (`vignette`).
- Fonts (Inter, OFL) meegeleverd in `lib/fonts`, gekopieerd naar `showcase/_assets/fonts`.

Render
- Filmische grade (`grade`): zachte S-curve (curves) plus verzadiging en contrast (eq), vóór de korrel.
- Supersampling (`supersample` 1-2): scene op hogere deviceScaleFactor, Lanczos terug naar 1080 breed. Studio: kwaliteit *Ultra* = 1,5x (instelbaar via `settings.json`).

Studio
- Presets Pro (standaard), Clean, Hype, Insane, inclusief de nieuwe afwerking.
- Look: Mesh-achtergrond, Tekst in beeld (uit/clean/bold), sliders voor grondschaduw, rim light, glans, vignet en kleurcorrectie.
- Camera: slider Afwerking.
- Shotpaneel: eigen tekst (regel plus kicker) of geen tekst per shot.
- Render: Concept / Final / Ultra.

MCP en regie-idee
- `describe_options` beschrijft de nieuwe opties. Regie-idee kent: pro/premium/apple, zonder tekst, met tekst, grote tekst, mesh, zonder schaduw.

Assets
- `A.headline` (kop uit de hero-still, anders paginatitel) en `R.host` worden bij bestaande captures automatisch bijgevuld.

Fixes
- Vlucht en galerij: het scherptevlak (`fz`) reist nu mee met de camera, dus de pagina's zijn scherp terwijl de camera achteruit of opzij vliegt (eerder bleef het scherptevlak op z=0 staan en werd alles wazig).
- Auto-kadrering houdt rekening met een tekstregel onderin: onderwerp iets hoger, grotere ondermarge, dus nooit een CTA onder de tekst.
- Caption-teksten: dubbele stukken uit lopende teksten (marquee) weg, losse restjes weg, SCHREEUWTEKST naar zinsopmaak, geen regels van alleen een getal.
