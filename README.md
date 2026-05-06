# iDEAL Bescherming

Een Tampermonkey/Greasemonkey userscript dat een iDEAL betaalpagina blokkeert
met een tussenscherm en een push-notificatie naar een vertrouwd persoon
(bijvoorbeeld een familielid). De betaling kan pas doorgaan als die persoon
op zijn telefoon op **Goedkeuren** tikt; bij **Afkeuren** blijft een grote
fraudewaarschuwing op het scherm staan en wordt er niet teruggeleid naar de
webwinkel.

## Demo

https://github.com/rweijnen/ideal-guard/raw/main/assets/Ideal-Flow.mp4

Korte schermopname van de volledige flow: openen iDEAL-pagina →
tussenscherm met countdown → push op telefoon → tap op Goedkeuren of
Afkeuren → betaling gaat door of wordt geblokkeerd met een
fraudewaarschuwing.

## Het probleem

Oudere familieleden zijn een geliefd doelwit van scams die eindigen met een
iDEAL-betaling: een vermeende "abonnementsverlenging" van McAfee, een
"openstaande factuur" van PostNL, een "bevestiging" van de bank. Het
slachtoffer komt op een echte iDEAL-pagina terecht (technisch gezien klopt
alles), kiest zijn eigen bank en autoriseert het bedrag in zijn vertrouwde
bank-app. Op dat moment is het geld weg en is er geen weg terug.

Een wachttijd alleen helpt nauwelijks: een vastberaden gebruiker wacht hem
gewoon uit. Wat wél helpt is een **tweede paar ogen** — iemand die niet onder
sociale druk staat, even rustig naar het bedrag en de begunstigde kijkt, en
dan beslist of de betaling door mag gaan.

Dit script doet precies dat. Zodra een iDEAL-betaalpagina wordt geopend:

1. Verschijnt er meteen een fullscreen tussenscherm in iDEAL-stijl met
   merchant en bedrag.
2. Krijgt de aangewezen persoon (jij, hun zoon/dochter) een push op zijn of
   haar telefoon met die informatie en twee knoppen: **Goedkeuren** en
   **Afkeuren**.
3. Pas na een tap op Goedkeuren verdwijnt het tussenscherm en kan de betaling
   doorgaan.


## Hoe het werkt

- Het script is een userscript (`ideal.js`) dat draait via Tampermonkey op de
  computer van het familielid.
- Bij iedere iDEAL-pagina bouwt het script een overlay op die de hele
  betaalpagina afdekt.
- Tegelijk stuurt het via [ntfy](https://ntfy.sh) een push-bericht met
  merchant, bedrag, datum/tijd, IP-adres en — indien bekend — de website van
  herkomst.
- Het bericht bevat twee actie-knoppen die naar een apart response-topic
  publiceren. Het script polt dat topic en reageert op het antwoord.
- Een uniek aanvraag-ID per pagina-load voorkomt dat goedkeuringen voor de
  ene betaling per ongeluk een andere ontgrendelen.
- Bij afkeuren wordt iDEAL's eigen "Cancel"-knop **niet** ingedrukt: dan zou
  het slachtoffer terugbelanden op de scampagina en alsnog op een andere
  manier kunnen betalen. In plaats daarvan blijft de fraudewaarschuwing
  staan totdat het tabblad bewust gesloten wordt.

## Installatie

### 1. Tampermonkey

[Tampermonkey](https://www.tampermonkey.net/) is een gratis browser-extensie
(beschikbaar voor Chrome, Edge, Firefox, Safari en Opera) waarmee je kleine
JavaScript-scripts — zogenaamde *userscripts* — kunt installeren die op
specifieke websites automatisch meedraaien. Een userscript heeft een header
met `@match`-regels die bepalen op welke URL's hij actief wordt; bij iedere
bezoek aan zo'n pagina injecteert Tampermonkey het script en kan het de
inhoud aanpassen, knoppen toevoegen, of zoals hier een hele overlay
plaatsen.

Installeer de extensie in de browser van het familielid via de officiële
site: <https://www.tampermonkey.net/>.

### 2. ntfy-server kiezen

Het script gebruikt [ntfy](https://ntfy.sh) om de push naar de smartphone te
versturen. Er zijn twee scenario's.

#### Optie A — publieke ntfy.sh

De simpelste setup. Je hebt geen server nodig.

1. Bedenk een lange willekeurige topic-naam (bijvoorbeeld
   `ideal-alerts-x7k2pq3qf8`). Iedereen die de naam kent kan meelezen, dus
   maak hem onraadbaar.
2. Installeer de [ntfy-app](https://ntfy.sh/app) op je iPhone of Android
   (de bewaker, niet het slachtoffer).
3. Abonneer je in de app op je topic op `https://ntfy.sh`.
4. In het script: zet `NTFY_HOST` op `https://ntfy.sh`, vul je topic in als
   `NTFY_TOPIC` en haal de `Authorization`-headers weg (publieke ntfy
   gebruikt geen auth voor open topics). Zie [Configuratie](#configuratie).

iOS-pushes werken meteen want ntfy.sh heeft Apple Push (APNs) ingericht.

#### Optie B — self-hosted ntfy

Privater. Vereist een eigen server.

1. Installeer ntfy op je server volgens de
   [officiële installatiehandleiding](https://docs.ntfy.sh/install/).
2. Maak een gebruiker en een access token aan, bijvoorbeeld:
   ```
   sudo ntfy user add publisher
   sudo ntfy token add publisher
   sudo ntfy access publisher 'ideal-alerts*' rw
   ```
   De wildcard dekt zowel `ideal-alerts` als `ideal-alerts-resp` (het
   response-topic dat het script gebruikt voor approve/deny callbacks).
3. **Belangrijk voor iOS**: self-hosted ntfy kan niet zelf via Apple Push
   leveren. Zet in `server.yml`:
   ```yaml
   upstream-base-url: https://ntfy.sh
   ```
   en herstart. Daarmee laat je server een lege ping via ntfy.sh lopen
   waardoor iOS de notificatie alsnog binnenkrijgt; de inhoud blijft op je
   eigen server. Zie de
   [iOS-documentatie](https://docs.ntfy.sh/config/#ios-instant-notifications).
4. In de iPhone-app: voeg onder **Settings → Manage users** je server toe
   met de publisher-token. Abonneer dan op je topic op die server.
5. In het script: zet `NTFY_HOST` op je eigen URL en `NTFY_TOKEN` op het
   publisher-token. Zie [Configuratie](#configuratie).

### 3. Script installeren

Open `ideal.js` in de Tampermonkey-dashboard editor (kopieer-plak), of sleep
het bestand op een Chrome-venster en bevestig de installatie. Tampermonkey
zal vragen om de permissies `GM_xmlhttpRequest`, `@connect ntfy.<jouw-host>`
en `@connect api.ipify.org`; accepteer ze allemaal — zonder die kan het
script geen push versturen of het IP-adres bepalen.

## Configuratie

Bovenaan `ideal.js` staat een instellingenblok:

```javascript
const TIMER_SECONDEN = 600;        // 10 minuten countdown

const NTFY_TOPIC = '<jouw-topic>';
const NTFY_RESP_TOPIC = NTFY_TOPIC + '-resp';
const NTFY_HOST = '<https://ntfy.example.com of https://ntfy.sh>';
const NTFY_TOKEN = '<jouw-publisher-token, of leeg voor publieke ntfy.sh>';
const NTFY_AUTH = 'Bearer ' + NTFY_TOKEN;
```

Voor publieke ntfy.sh op een open topic: laat `NTFY_TOKEN` leeg en haal de
`Authorization`-headers (zowel uit de outgoing publish als uit de
action-objecten) weg.

Bij het ook nog niet aanpassen van het `@connect`-statement in de
userscript-header zal Tampermonkey weigeren te connecten:

```
// @connect      ntfy.example.com
```

## Gebruik

Zodra het script is geïnstalleerd hoef je niets meer te doen op de PC van
het familielid. Bij iedere iDEAL-betaling:

1. Verschijnt het iDEAL-stijl tussenscherm met merchant, bedrag en een
   countdown van 10 minuten.
2. Krijg jij op je telefoon een notificatie met dezelfde informatie plus
   datum/tijd, IP en herkomst.
3. Tap op **Goedkeuren** als de betaling legitiem is — het tussenscherm
   verdwijnt onmiddellijk.
4. Tap op **Afkeuren** bij twijfel — er verschijnt een grote rode
   waarschuwing op het scherm van het familielid en het tabblad moet
   bewust gesloten worden om verder te gaan.

De timer is puur informatief: hij draait wel af, maar opent zelf niet de
betaling. Alleen jouw goedkeuring kan dat.

## Beveiligingsoverwegingen

- **Een token in een userscript is niet geheim.** Wie toegang heeft tot de
  PC van het familielid kan het lezen. Gebruik een **publisher-token met
  alleen schrijfrechten** op `ideal-alerts*`, geen admin-token.
- **Publiek ntfy.sh** met een open topic betekent: iedereen die de
  topic-naam kent kan meelezen en ook valse approve/deny-berichten sturen.
  Een lange willekeurige naam is in de praktijk afdoende, maar voor extra
  zekerheid kun je het topic reserveren onder je ntfy.sh-account en alleen
  voor jezelf read-write maken.
- **Self-hosted ntfy** geeft je volledige controle, maar onthoud dat het
  upstream-forwarding-model voor iOS-pushes nog steeds een ping (zonder
  inhoud) via ntfy.sh stuurt.
- Voor publicatie op GitHub: **verwijder eerst** het echte
  `NTFY_HOST` en `NTFY_TOKEN` uit het script; gebruik placeholders zoals
  hierboven. Zet die ook niet in de git-history.

## Beperkingen

- Werkt alleen op pagina's die door de `@match`-patronen in het script
  worden gedekt. Naast `pay.ideal.nl` zijn dat enkele PSP-domeinen voor
  iDEAL-flows; voeg er gerust meer toe.
- Op andere PSP-pagina's leest het script bedrag en merchant op
  basis van een generieke regex; dat kan minder precies zijn dan op
  `pay.ideal.nl` zelf, waar `data-testid`-attributen direct beschikbaar
  zijn.
- Als de iPhone-app gesloten is en je geen `upstream-base-url` hebt
  ingericht, kan de notificatie pas binnenkomen wanneer de app weer geopend
  wordt.
- Het script vertrouwt op `api.ipify.org` voor het publieke IP-adres.
  Mocht die offline zijn, dan staat er "onbekend" in de melding.

## Licentie

Dit project staat onder de [Mozilla Public License 2.0](LICENSE) — je mag
het gebruiken, aanpassen en verspreiden, mits aangepaste *bronbestanden*
onder dezelfde licentie beschikbaar blijven. Combineren met code onder een
andere licentie mag, zolang de MPL-bestanden zelf herkenbaar blijven.
