# Website Motion Studio v20

Plak een link, krijg een cinematic showcase-video van de website. Daarna stel je alles bij met sliders en schakelaars en render je opnieuw.

## Starten (Mac)

1. Installeer eenmalig Node.js LTS via nodejs.org.
2. Pak deze map uit, bijvoorbeeld in Documenten.
3. Rechtermuisknop op `Website Motion Studio.command` > Open (alleen de eerste keer, vanwege Gatekeeper). De eerste start installeert de onderdelen (paar minuten).
4. De Studio opent in je browser op http://localhost:4747.
5. Na die eerste keer staat er een snelkoppeling **Website Motion Studio** op je bureaublad. Die start de Studio direct, zonder Terminal-venster en zonder opnieuw goedkeuren. Draait hij al, dan opent hij alleen de browser.

Werkt de dubbelklik niet, open Terminal in deze map en typ:

```
xattr -dr com.apple.quarantine .
npm install && npx playwright install chromium
node studio.js
```

## Nieuwe versie installeren

Pak de nieuwe versie uit (mag naast de oude staan) en start één keer `Website Motion Studio.command` uit de nieuwe map. Die stopt een oude Studio die nog draait, zet de bureaublad-snelkoppeling op de nieuwe versie en je projecten blijven gewoon staan (die staan in de map Website Captures). Start daarna ook `Koppel aan Claude Desktop.command` uit de nieuwe map en herstart Claude Desktop. Het versienummer staat linksboven in de Studio.

## Samen met Claude (Claude Desktop)

Dubbelklik eenmalig `Koppel aan Claude Desktop.command`, sluit Claude Desktop af (Cmd+Q) en open hem opnieuw. Daarna kun je in een gesprek vragen:

> Maak een showcase van floorcity.nl. Probeer een paar creatieve varianten en render de beste.

Claude kan dan zelf:
- de site vastleggen (desktop + mobiel + key features),
- drie verschillende edits voorstellen en naast elkaar laten zien (andere shots, hoeken, apparaat, volgorde, achtergrond),
- zelf een edit schrijven: elke video anders, zelfde merk en idee,
- je regie-idee uit de Studio oppakken (knop *Naar Claude*) en omzetten in een edit,
- een final pass doen vóór het renderen: beelden door de hele video plus automatische checks op leeg beeld, te schuine hoeken, te ver inzoomen, een camera die te hard heen en weer zwaait en een focuspunt dat niet in het midden staat,
- na het renderen de echte MP4 bekijken (review_render): contactsheet plus bewegingsanalyse uit de beelden zelf (hokkerige sprongen, heen en weer, zijwaartse beweging per shot), en dan bijsturen en opnieuw renderen tot het klopt,
- renderen, met geluid.

Geen API-key nodig. Capture en render draaien als losse processen, dus ze lopen door als het gesprek even stilstaat. Werkt het niet? Open Terminal in deze map en typ `node mcp.js --selftest`. De log van Claude Desktop staat in `~/Library/Logs/Claude/mcp-server-website-motion-studio.log`.

## Nieuw in v20: strakker, cleaner, premium

De hele look en beweging zijn opnieuw afgewerkt. Standaard staat alles nu op **Pro**: rustig, strak en premium. De oude presets *Clean / Hype / Insane* zijn er nog.

- **Afwerking van de beweging** (slider *Afwerking* bij Camera): elke cut heeft dezelfde snelheid (geen harde en zachte cuts door elkaar), elk shot landt even voordat hij vertrekt, en een draai die heen en weer ging is gladgestreken. Standaard aan.
- **Tekst in beeld** (Look > Tekst in beeld): strakke titels in Inter, met een kleine kicker in de merkkleur en een zachte waas eronder. Automatisch: de kop van de site (één keer), de feature-teksten, *Navigatie*, *Mobiel* en de url als endcard. In het shotpaneel vul je per shot je eigen tekst in, of zet je hem uit. *Bold* = groter.
- **Grondschaduw**: laptop, telefoon en pagina's krijgen een zachte schaduw onder zich, zodat ze echt in de ruimte staan.
- **Rim light en glas**: een dunne lichte rand langs elk vlak en een vaste lichtval over de schermen. Alles onder Look te regelen (schaduw, rim light, glans, vignet).
- **Mesh-achtergrond**: drie grote zachte kleurvlekken in de merkkleuren die heel langzaam drijven. Subtieler dan Aurora.
- **Kleurcorrectie** (render): zachte S-curve en een tikje meer verzadiging. Slider *Kleurcorrectie* bij Look.
- **Ultra-render**: Final plus supersampling (1,5x getekend, teruggeschaald): de strakste randen en tekst, ongeveer twee keer zo lang. `"supersample": 2` in settings.json voor 2x.
- Effecten staan standaard zachter: film burn en light leaks uit, flitsen, gloed en RGB-split op de helft. Filmkorrel lichter.
- Regie-idee kent nu ook: *pro / premium / apple*, *zonder tekst*, *grote tekst*, *mesh*, *zonder schaduw*.

## Werken met de Studio

### Zelf de edit bepalen (v18)
De Studio zet automatisch een goede edit klaar. Alles daarin kun je daarna zelf aanpassen, direct in de tijdlijn:
- **Dubbelklik op een shot** (of de knop *Kies uit de hele website*): de viewer opent met alle vastgelegde beelden: de volledige pagina's van boven tot onder, de losse schermen en de beelden na een klik of hover. Kies links een beeld, en sleep een kader of klik op een gevonden blok (de stippellijntjes). Bij close-up, tracking, laptop, orbit, crane, pagina-spin en vlucht is dat kader wat de camera laat zien. Bij pop-wall, features, kaarten, lagen en float kies je de blokken die loskomen, in volgorde. *Gebruik deze keuze* maakt er direct een schoon uitgesneden shot van; *Automatisch* zet het terug.
- **De tool knipt zelf uit**: bij pop-wall, features, kaarten, lagen en float hoef je niet elk blok aan te wijzen. Sleep een kader om een gebied (of kies een scherm, of klik *Uitknippen wat in beeld is*) en de tool zoekt zelf de losse elementen: kaarten, koppen, knoppen, badges. Klik een blok om het weg te halen of toe te voegen. Met *Zelf aanwijzen* kies je ze toch met de hand. In *Snel kiezen* kan elk scherm nu ook een lagen- of float-shot worden; de elementen zijn vooraf uitgeknipt.
- **Eigen beelden en video's**: in de viewer bovenaan *+ Eigen beeld of video* (png, jpg, webp, mp4, mov, webm). Een beeld gebruik je als elke andere pagina, inclusief uitknippen. Een video (max 12 s, wordt 16:9 gemaakt) komt in het laptopscherm of als bewegend vlak in een close-up, orbit of crane. De bestanden staan in de map *custom* van het project.
- **Ongedaan maken**: Cmd+Z en Shift+Cmd+Z, of de pijltjes boven de tijdlijn. Spatiebalk = afspelen/pauze.
- **Meerdere media in één shot**: heeft een shot meer plekken (vlucht: pagina A en B; laptop + telefoon: twee schermen; waaier: drie telefoons; galerij: vier pagina's), dan staan die als knopjes in het shotpaneel. Klik een plek en kies daarvoor de inhoud, in de snelle keuze of in de viewer. Een bolletje achter de naam betekent: eigen keuze.
- **Gewoon toepassen**: in de viewer mag je altijd direct op *Gebruik* klikken. Niets aangewezen? Dan neemt hij wat je in beeld hebt, en bij blok-shots zoekt hij zelf de elementen.
- **Klik op een shot**: rechts opent het shotpaneel. Daar kies je de soort shot, en in de carrousel *wat erin komt*: een andere pagina of sectie, een bewegende clip in de laptop, welke features (in volgorde, max 4), welke rij blokken of welke mobiele opname. 'Automatisch' zet het terug.
- **Focus**: klik op de grote pagina-afbeelding op het punt waar de camera op moet inzoomen (bijvoorbeeld een close-up van een productkaart).
- **Sleep een shot** in de tijdlijn naar links of rechts om de volgorde te veranderen. Het witte streepje laat zien waar hij landt.
- **Sleep een streepje** tussen twee shots om een shot langer of korter te maken.
- **+ Shot** voegt een shot toe (na het geselecteerde shot, anders voor de outro). Nieuw: *Close-up*, een rustige push-in op elke pagina en elk punt dat je kiest.
- **Verwijder** haalt het geselecteerde shot eruit.
Een lopende render blijft altijd zichtbaar: dunne balk bovenin, een balkje linksboven en het percentage in de tabtitel. Ook na herladen of als je het venster even wegklikt.


1. **Link plakken** en op *Maak video* klikken. De tool opent de site, test menu's, hovers, sliders en scroll-effecten, en neemt clips en screenshots op (5 tot 15 minuten).
2. **Live preview**: de showcase speelt direct af. Klik op een shot in de balk om erheen te springen.
3. **Bijstellen** (preview past zich direct aan):
   - **Regie-idee**: typ wat je wilt ("rustig en premium, 15 sec, alles in de laptop, crash zoom, meer close-ups, geen muziek") en klik *Toepassen*. Werkt lokaal, zonder API. *Naar Claude* bewaart je idee bij het project en kopieert een opdracht die je in Claude Desktop plakt; Claude pakt het idee dan op en doet een creatieve pass
   - *Clean / Hype / Insane*: snelle presets
   - **Totale lengte**: zet bv. 15 s. Eerst vallen de minst belangrijke shots weg, daarna gaat alles iets vlotter. Menu's blijven lang genoeg om echt open te gaan
   - **Kadrering per shot**: klik op een shot in de tijdlijn. Er verschijnt een paneel met zoom, links/rechts, omhoog/omlaag en draai, en je kunt in de preview slepen (verschuiven) en scrollen (zoomen). Auto-kadrering kan per shot uit. Standaard houdt de tool een veilige marge aan (7% zijkanten, 10% boven, 12% onder) zodat het belangrijke deel nooit tegen de rand zit
   - **Tijdlijn**: sleep het randje aan het einde van een shot in de balk onder de preview om dat shot langer of korter te maken
   - **Timing per shot**: per shot een schuif (korter/langer), met de lengte in seconden erachter. Dubbelklik = reset. Een shot eruit: klik op het kruisje in de edit-chip
   - **Overgangen**: Mix, Whip, Zoom (crash zoom) of Clean (zachte dip, geen harde draai)
   - **Apparaat**: Mix, *Meer laptop* (pagina-shots in het laptopscherm, telefoon-shots blijven) of *Alles in laptop*
   - **Auto-kadrering**: zet het focuspunt van elk moment automatisch in het midden, met perspectief en camera meegerekend. Overgangen landen zonder door te schieten
   - **Effecten** (elk aan/uit met eigen sterkte): flitsen, film burn en light leaks (uit jouw FX-clip), gloed in de merkkleur, glans, RGB-split bij snelle bewegingen en lens chromatic aberration (subtiele kleurranden naar de hoeken). Ze vallen op een deel van de overgangen en wisselen elkaar af, passend bij de gekozen overgangsstijl. Glans en RGB-split zie je alleen in de render
   - **Camera-rust**: hoe minder de camera links/rechts zwaait (hoger = strakker gecentreerd)
   - **Geluid**: *Echte geluiden* (opnames: whooshes in laag en hoog gelaagd, muisklik met indrukken en loslaten, zachte landingen, nooit twee keer hetzelfde bestand achter elkaar) of *Synth*. Muziek staat standaard uit. Stijl Studio (strak met diepte), Cinematic (meer sub en galm) of Minimal, plus aparte niveaus voor whooshes, muisklikken, accenten, impacts en muziek
   - Formaat 9:16, 4:5 of 1:1
   - Tempo, energie, kanteling, schuinstand, zoom, depth of field, kaarten loskomen, leestijd
   - Achtergrond: Studio, Aurora (bewegende merkkleur), Grid (3D-vloer), Spot, Vlak, plus hoe sterk hij meebeweegt (parallax)
   - **Nieuwe edit 🎬**: stelt een unieke shot-lijst samen (ander openingsshot, andere hoeken, ander apparaat, ritme wide/close-up). De chips laten de edit zien. "Vast" = terug naar de vaste volgorde
   - Speed ramps + slow-mo op sleutelmomenten (menu dat opent, tik op de telefoon)
   - Geluid: SFX + muziek, alleen SFX of uit, met volume. "Preview met geluid" speelt het mee af
   - Shots aan/uit: intro, laptop, menu, muis-close-up, hero-lagen, kaarten, vlucht door 3D-ruimte, scroll/parallax, slider, outro
   - Cursor, reflectie, logo in de achtergrond, achtergrondkleur, motion blur, filmkorrel
4. **Render MP4**: beeld voor beeld, met motion blur en korrel. Motion blur werkt als een echte sluiter: zoveel tussenbeelden als de beweging vraagt (geen losse 'kopieën' meer), met zachte randen. Scherptediepte krijgt in de render een echte lensblur erbij. Rendert parallel op meerdere kernen (op een M4 Pro 6 tegelijk) en codeert op de Mac met de hardware-encoder (VideoToolbox). *Snel (concept)* = minder motion blur, voor een snelle check; *Final* voor de echte versie. Aantal parallelle renders aanpassen: `"workers": 4` in settings.json. Elke render krijgt een eigen bestandsnaam met datum en tijd, in `<capture-map>/showcase/`.

Instellingen worden per project bewaard (`showcase/params.json`).

## Wat er in de video zit

- Intro: logo zweeft in, cursor klikt, riser + impact, crash zoom
- Telefoon: 3D-iPhone met de mobiele site (scroll, of menu met tik), draait rond
- Laptop + telefoon: beide in de ruimte, camera draait eromheen, focus op de telefoon
- Key features: carrousel van close-ups (het volgende item schuift in terwijl het vorige wegschuift, nooit twee pagina's door elkaar), ingezoomd op het element zelf: van aanbod, USP's, cijfers, reviews en prijzen, die uit de pagina poppen. De tool kijkt naast de tekst ook naar hoe opvallend een blok is (eigen achtergrond, icoon, rij van gelijke blokken)
- Pop-wall (Apple-stijl): een rij kaarten, reviews of USP's; de cursor klikt ze een voor een aan, elk blok komt los, en de camera eindigt op het geheel
- Uitknippen: is de ondergrond egaal, dan blijft er een schoon effen 'gat' achter. Is het een foto of verloop, dan maakt de tool een clean plate: de plek wordt opgevuld met de omringende ondergrond (horizon en verlopen lopen door), dus nooit dubbele tekst of een vlek. Tekst op een foto komt los als losse letters, zonder rechthoek eromheen
- Laptop: camera laag over het toetsenbord naar het scherm, focus pull, push naar de CTA
- Menu: macro op CTA en menuknop, klik, orbit terwijl het menu opent, vloeiend weg
- Muis-close-up: camera volgt de cursor over de productkaarten, met de echte hover-effecten
- Hero-lagen: kop, knoppen, badge en logo komen in lagen los uit de pagina, camera draait eromheen
- Kaarten: pagina plat als een tafel, productkaarten poppen los met schaduw, focus springt mee
- Vlucht: de pagina's hangen als een galerijwand naast elkaar; de camera trekt terug, zwenkt op afstand en vliegt recht van voren op de volgende pagina in. Nooit door een vlak heen
- Scroll/parallax: grote orbit rond de echte scroll
- Slider/hover: tweede interactie van onderaf
- Pagina-spin: de pagina, nu een plaat met dikte en achterkant, draait om zijn as naar voren
- Waaier: drie telefoons op een boog met verschillende schermen, de hele waaier draait langzaam (Apple-keynote)
- Tracking close-up: macro die langs de kop glijdt, met ondiepe scherptediepte
- Kraan (crane): de pagina ligt als vloer, de camera komt omhoog tot hij er recht voor staat
- Rack focus (aan te zetten): feature komt los, de focus trekt van de pagina naar het element
- Dolly (aan te zetten): zijwaartse rijder langs de laptop
- Zweven (aan te zetten): hero met losse lagen die rustig zweven
- Galerij (aan te zetten bij Shots): pagina's links en rechts in de diepte, de camera vliegt er tussendoor, nooit erdoorheen
- Crazy (aan te zetten): *Orbit* om de laptop en *Spin* van de telefoon, beide eindigen in een schone whip in plaats van een duik
- Outro: logo + CTA, cursor klikt

Sound design: whooshes met sub-laag en brede lucht op snelle camerabewegingen (automatisch uit de beweging berekend), echte muisklikken (indrukken + loslaten), tikken op glas, pops als lagen loskomen, risers en impacts, plus een schone muziekbed met akkoordwissels. Alles gesynthetiseerd en gemixt. De losse audio staat ook als WAV naast de video.

Motion blur: echte sluiter met tot 40 subframes per beeld, plus een kleine richtingsblur als de beweging nog sneller is, zodat er nooit losse kopieen van tekst zichtbaar zijn. Opname op dubbele resolutie (retina), dus scherp bij inzoomen. Camerabewegingen lopen door keyframes heen (spline), met rustmomenten om te lezen. Kadrering op groepen (kop + knop, CTA + menuknop). De achtergrond parallaxt mee. Shots overlappen nooit. Standaard overgang is 'glide': de camera vliegt vloeiend van shot naar shot, zonder harde rukken en zonder ooit in de site te duiken. Whip, zoom, mix en clean zijn nog te kiezen bij Camera.

## Losse commando's

```
node capture.js https://www.site.nl         # alleen vastleggen (+ showcase)
node showcase.js "<capture-map>"            # showcase opnieuw renderen met opgeslagen instellingen
node refeatures.js "<capture-map>"          # key features en feature-groepen opnieuw zoeken (ook voor oude captures)
node mcp.js --selftest                      # controle voor de Claude-koppeling
node studio.js --out "<map>" --port 4747    # Studio met andere map/poort
```

## Voor ChatGPT / Seedance

Elke capture bevat ook `CHATGPT-MASTER-INSTRUCTIONS.md`, `DIRECTOR-BRIEF.md`, `UPLOAD-ORDER.md` en `higgsfield-upload/`. Daarmee kan een AI de Seedance-prompt schrijven. De API-koppeling kan later als extra knop in de Studio.

## Bekende beperkingen

- Klikken gebeurt alleen op veilige elementen (menu, tabs, accordions, slider-pijlen, dropdowns). Winkelwagen, formulieren, login en links naar andere pagina's worden overgeslagen.
- Sites met zware bot-bescherming kunnen blokkeren.
- De live preview is lichter dan de render (lagere resolutie frames, geen motion blur en korrel).
- De showcase verwacht een hero, een menu, productkaarten en een logo. Ontbreekt iets, dan valt dat shot weg.

`TOOL-SPEC.md` beschrijft de werking voor wie de code wil nakijken.

## Eigen geluiden gebruiken

Leg een map `_sfx` in je captures-map (of zet `"sfxDir": "/pad/naar/map"` in settings.json) met submappen per soort, met .wav-bestanden erin:

`whoosh_short` (snelle whip) · `whoosh_mid` · `whoosh_big` (grote camerabeweging) · `transition` (lange aanloop die op de klap piekt) · `click` (muisklik, indrukken + loslaten in één bestand) · `tick` · `tap` (tik op telefoon) · `pop` (laag komt los) · `thud` / `boom` (landing) · `glitch` (accent)

Wat je niet vult, komt uit het meegeleverde pakket. De tool zoekt zelf het piekmoment in elk bestand en legt dat op de beweging. Het meegeleverde pakket is gesampled uit jouw eigen SFX-track, aangevuld met een paar CC0-geluiden (pops, tikken).
