# Changelog

## v20.1

- Tekst in beeld staat standaard **uit** (`captions: false`). Aanzetten kan onder Look > Tekst in beeld.
- Levende camera (`drift`, standaard 0.6): heel lichte, trage zweving van het hele beeld, dus nooit een stilstaand frame. Ook de grondschaduwen bewegen mee.
- Lichtstreep (`sweep`, standaard 0.8): per shot trekt één keer een zachte glans over de pagina, het laptopscherm of de telefoon.
- Lagen en kaarten komen iets verder los (`lift` 1.1).
- Detectie key features: een cijfer-USP is nu het hele item (getal plus label: "37 jaar vakmanschap") in plaats van alleen het getal, en nooit meer de hele rij. Een rij gelijke blokken telt als groep (pop-wall), niet als losse feature. Dubbele stukken uit lopende teksten (draaiende badge, marquee) worden samengevoegd; een los getal zonder label wordt overgeslagen.

## v20.0 · strakker, cleaner, premium

Beweging
- Polish-pass na het bouwen van de shots (`polish`, standaard 1): elke in- en uitvlucht legt dezelfde afstand af in dezelfde tijd, het laatste rustige stuk voor de cut beweegt 45% minder (het shot landt), en draaiingen die van richting wisselen tussen tussen-keyframes worden gladgestreken.
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
