# Turnaj, který se nikdy nehrál — webová podstránka

Kompletní, samostatně funkční podstránka s archivem turnaje: výsledkové listiny
všech ročníků, vložené soutěže, síň slávy, statistiky hráčů a fotogalerie s videi
ke každému ročníku. Bez build kroku, bez závislostí — jeden CSS soubor, jeden JS
soubor a JSON s daty; galerii plní malá PHP administrace.

## Co je v balíčku

```
web/
  index.html              samostatná stránka
  turnaj.css              styly, vše scopované pod .tkn
  turnaj.js               vykreslení stránky (výsledky, soutěže, galerie)
  turnaj.json             data všech ročníků
  .htaccess               Cache-Control, DirectoryIndex, bez RewriteEngine
  admin/                  správa galerie s heslem (PHP 8.0+)
    index.php, app.html, admin.js, admin.css, api.php, lib.php
    config.example.php    vzor nastavení; config.php se do gitu nedává
    _data/                SOUKROMÉ: hash hesla, zámky, session, rozpracovaná videa
  media/                  fotky, videa a manifest galerie.json — vznikají až na serveru
tools/
  nastav-heslo.php        CLI: vyrobí admin/_data/heslo.php (nenasazuje se)
laravel/
  routes.snippet.php      routa do routes/web.php
  resources/views/golf/turnaj.blade.php
data/
  vysledky.json           stejná data (zdrojová kopie)
  vysledky.csv            výsledky jako tabulka, 357 řádků
```

## Kde to běží

Nasazeno na **https://www.matchpulse.cz/golf/** jako statické soubory.

Stránka je jedna ze tří věcí, které na téhle doméně běží vedle sebe a sdílejí
hosting. Zbylé dvě jsou v soukromých repozitářích:

| Co | Kde |
|---|---|
| MatchPulse — tenisové live scoring, hostitelská aplikace | `matchpulse.cz` |
| Caddiee — golfová turnajová aplikace | `matchpulse.cz/caddiee/` |
| **tenhle archiv turnaje** | `matchpulse.cz/golf/` |

Kdo sáhne do jedné z nich, může rozbít ostatní. Podrobnosti o hostingu, databázi
a nasazení jsou **schválně jen v těch soukromých repozitářích** — sem nepatří.

> **Původní verze tohohle README tvrdila, že MatchPulse je Laravel. Není.**
> Je to vlastní PHP aplikace s front controllerem — žádný `artisan`, `routes/`
> ani `vendor/` tam nejsou. Návod pro Laravel je níž a platí pro jiné weby.
> Kdo se jím řídil, zasekl se hned na prvním kroku.

### Jak se to nasazuje

Nahrávají se **jen změněné soubory** ze složky `web/`. Odkazy uvnitř jsou
relativní, takže to funguje v libovolné podsložce.

**Nikdy nenahrávej `web/media/*` ani `web/admin/_data/*`** (kromě jejich
`.htaccess` a `index.html`) a ani `admin/config.php`. Galerie a hash hesla žijí
**jen na serveru** — lokální kopie je prázdná, takže by nahrání celé složky nebo
synchronizace s mazáním smazaly fotky a přepsaly heslo změněné ve správě.
Ze stejného důvodu je dobré `media/` občas stáhnout jako zálohu: jinde není.

Po změně `turnaj.js` nebo `turnaj.css` zvyš `?v=` u odkazů v `index.html`.
`.htaccess` sice posílá `Cache-Control: no-cache`, ale prohlížeče, které mají
v cache verzi z doby před ním, by jinak ještě chvíli jely se starým skriptem.

**Do složky nedávej vlastní `RewriteEngine On`.** Apache tím v podsložce přestane
dědit pravidla mod_rewrite z nadřazeného `.htaccess` — a s nimi i sjednocení na
`www`. Není to potřeba: pravidla v kořeni skutečné soubory na front controller
neposílají. `DirectoryIndex index.html` z `/golf/.htaccess` se dědí do podsložek,
proto ho `admin/.htaccess` přepisuje na `index.php` — bez toho `/golf/admin/` vrací 403.

> Po nahrání může proxy hostingu ještě chvíli vracet 404, kterou si zapamatovala
> z doby, kdy soubory neexistovaly. Ověřuj s parametrem navíc v adrese (`?x=1`),
> jinak budeš hledat chybu, která tam není.

## Nasazení na Laravel (jiný web, ne MatchPulse)

1. Zkopíruj `web/turnaj.css`, `web/turnaj.js` a `web/turnaj.json` do `public/golf/`.
2. Zkopíruj `laravel/resources/views/golf/turnaj.blade.php`
   do `resources/views/golf/turnaj.blade.php`.
3. V blade souboru uprav `@extends('layouts.app')` na svůj layout. Pokud tvůj
   layout nemá stacky `styles` / `scripts`, vlož `<link>` a `<script>` rovnou
   do sekce s obsahem — funguje to stejně.
4. Přidej routu z `laravel/routes.snippet.php` do `routes/web.php`.

## Integrace do vlastní stránky

Stačí tyhle tři řádky kdekoliv ve tvém HTML:

```html
<link rel="stylesheet" href="/golf/turnaj.css">
<div id="turnaj-app" class="tkn" data-src="/golf/turnaj.json"></div>
<script src="/golf/turnaj.js" defer></script>
```

Plus fonty (Newsreader + IBM Plex Sans/Mono) z Google Fonts — pokud je
vynecháš, stránka spadne na systémové písmo a funguje dál.

Data můžeš místo `data-src` předat i přímo:

```html
<script>window.TURNAJ_DATA = { /* obsah turnaj.json */ };</script>
<div id="turnaj-app" class="tkn"></div>
```

Galerie se načítá z `media/galerie.json` vedle stránky; jinde vložená stránka ji
najde přes `data-galerie="/golf/media/galerie.json"` (nebo `window.TURNAJ_GALERIE`).
Když manifest chybí, stránka vypadá přesně jako bez galerie. `#2025` v adrese
otevře rovnou daný ročník.

## Barvy

Všechny barvy jsou CSS proměnné na `.tkn` v hlavičce `turnaj.css`
(`--tkn-green`, `--tkn-ink`, `--tkn-paper`, …). Přebarvení na paletu
MatchPulse je otázka přepsání těch proměnných, do zbytku šablony nemusíš
sahat. Světlý i tmavý režim jsou hotové; tmavý se aktivuje podle
`prefers-color-scheme`, nebo když je na stránce `data-theme="dark"`.

Třídy jsou prefixované `tkn-` a celá komponenta je uvnitř `.tkn`, takže
se styly nepraly se zbytkem webu.

## Data

`turnaj.json` je jediný zdroj pravdy. Struktura:

```jsonc
{
  "rocniky": [
    {
      "rok": 2025,
      "nazev_v_cgf": "Turnaj, který se nikdy nehrál",
      "hriste": "Telč",
      "datum": "27. – 28. 09. 2025",
      "pocet_kol": 2,
      "cgf_id": "1300145300",
      "url": "https://www.cgf.cz/...",
      "vysledky_publikovany": true,
      "kategorie": [
        {
          "nazev": "HCP 0-12 stableford",
          // řádek = [pořadí, jméno, klub, členské číslo, HCP,
          //          kolo1, kolo2, skóre, HCP po, rány]
          // u jednokolových ročníků řádek nemá kolo2:
          //          [pořadí, jméno, klub, členské číslo, HCP,
          //           kolo, skóre, HCP po, rány]
          "poradi": [["1", "VACULÍK Ondřej", "GCLIB", "05300549", "8,4",
                      "38 / 38", "41 / 41", "79", "8,1", ["81", "79"]]]
        }
      ]
    }
  ]
}
```

Ročník bez výsledků má `"vysledky_publikovany": false` a nepovinnou
`"poznamka"` — stránka mu sama vykreslí razítko. Ročník v budoucnosti
dostane razítko „JEŠTĚ SE NEHRÁL“. U odehraného ročníku se
`"poznamka"` vypíše pod hlavičkou ročníku — tak je odlišený nultý ročník
2014, který se hrál pod jiným názvem a na jiném hřišti.

### Rány

Poslední položka řádku je pole ran za jednotlivá kola, vytažené ze skórkarty
hráče na ČGF (`vysledkova-listina-hrace`). Ve výsledkové listině rány nejsou —
ta zná jen stablefordové body.

Pole má **jednu položku na kolo** — prázdný řetězec tam, kde rány nejsou.
Bez toho se u hráče, který některé kolo neodehrál, rány posunuly o jedno místo
a vypsaly se u špatného kola.

Prázdné je tam, kde hrubý výsledek neexistuje: ve stablefordu se po
ztrátě bodu míč zvedá, jamka se nedohraje a ČGF pak žádný součet neuvádí.
Týká se to 73 z 622 odehraných kol. Stránka na takovém místě ukáže pomlčku — nesčítej
zbylé jamky, vyšlo by číslo nižší, než co se odehrálo.

Ve statistikách hráčů jsou z ran dopočítané dva sloupce: **Na rány** (kolikrát
měl hráč v ročníku nejnižší součet — shodný součet bere vítězství oběma) a
**Nejlepší kolo** (jeho nejnižší odehrané kolo vůbec).

V síni slávy je z ran dopočítaná trojice nejnižších hrubých výsledků ročníku.
Do pořadí se pouští jen hráč, který odehrál všechna zveřejněná kola a ke každému
má známý součet — jinak by nedohraná jamka nebo vynechané kolo vypadaly jako
lepší výkon. Ze stejného důvodu se zahazuje nula: na kartě znamená odstoupení,
ne nula ran.

Protože řádek na konci povyrostl, **počet kol se pozná z `pocet_kol`, ne z délky
řádku**. Kdo sáhne do `web/turnaj.js`, ať to nevrací zpátky.

### Dvoudenní ročníky zapsané jako dva turnaje

Hraje se vždy sobota + neděle, jenže u ročníků **2016, 2017, 2018 a 2023** vede
ČGF každý den jako **samostatný turnaj s vlastním `id`** — a to pod úplně jiným
názvem, takže se ta sobotní půlka nedá najít podle jména. Pozná se podle dne
v týdnu: když je datum ročníku neděle, chybí k němu sobota.

| Ročník | Sobota v ČGF | Hřiště |
|---|---|---|
| 2016 | `1300083013` „HAPPY GOLF tour“ — hráči vedení jako **nezařazení, bez výsledků** | Malevil |
| 2020 | `1300113504` nedělní kolo pod vlastním záznamem (klíč `"druhe_kolo"`) | Kunětická Hora |
| 2017 | `1300089002` „Turnaje s luxusními výhrami…“ | Malevil |
| 2018 | `1300098420` totéž | Malevil |
| 2023 | `1300132156` „Luxa tour“ | Cihelny |

Ročník na to má nepovinný klíč `"prvni_kolo"` s `cgf_id`, názvem, hřištěm, datem
a odkazem; `"bez_vysledku": true` znamená, že se hrálo, ale ČGF k tomu nic
nezveřejnila. Obdobně `"druhe_kolo"` u roku 2020.

U 2017, 2018 a 2023 jsou sobotní výsledky sloučené do ročníku jako 1. kolo.
**Pořadí a celkové skóre jsou dopočítané součtem obou kol** — ČGF společnou
listinu nikdy nevydala, takže to není oficiální výsledek a stránka to říká
v poznámce u ročníku.

Z cizích turnajů (2017, 2018) se berou **jen hráči, kteří jsou i v nedělní
listině**; zbylých 53 resp. 46 účastníků do archivu nepatří. V sobotní listině
je v buňce `X / Y` u brutto kategorií jiné číslo než netto — bere se vždy
**druhé**, tedy netto.

### Rekordy a data po jamkách

Poslední položka řádku je pole `"jamky"` — rozdíly vůči paru po jamkách, jedna
položka na kolo, hodnoty oddělené čárkou. `x` znamená nedohranou jamku. Data
pocházejí ze skórkaret hráčů na ČGF (`vysledkova-listina-hrace`), ve výsledkové
listině nejsou.

Sekce **Rekordy** se z toho počítá celá na stránce: nejvíc hráčů na ročníku,
nejnižší a nejvyšší kolo, nejvíc birdie, parů a triple bogey v kole i za ročník,
a seznam všech eaglů i s číslem jamky. Rekordy za kolo berou jen dohraných osmnáct jamek — u nedohrané
se neví, kolik ran by stála.

Každé odehrané kolo se počítá jednou, i když je hráč ve dvou kategoriích
(netto i brutto mají vlastní kartu na tentýž den).

### Odchylky od ČGF

Archiv jinak reprodukuje ČGF věrně. Výjimky jsou dvě. První je **Hana Krejčí v roce 2025**,
kterou pořadatel podle dohody vede na HCP 36 místo 54; body jsou proto přepočítané
z její skórkarty (47 a 38 místo 68 a 58, celkem 85 místo 126). Rány zůstávají, jak
je zahrála. Původní hodnoty z ČGF jsou uložené v ročníku pod klíčem `"upravy"`,
takže se nic neztratilo, a stránka to říká v poznámce u ročníku.

Přepočet je ověřený tím, že stejný výpočet z její karty pro skutečný HCP 54 dá
přesně to, co uvádí ČGF. Hrací handicap = `round(index × SR/113 + (CR − par))`, rány se rozdělují
po jamkách podle indexu obtížnosti.

Druhá je **Alice Riklová v roce 2026**. ČGF ji tam vede pod jiným, duplicitním
záznamem bez klubu a členského čísla, jméno bez čárky: „RIKLOVA Alice“. Statistiky páruje
stránka podle přesného jména, takže by vyšla jako jiná hráčka než „RIKLOVÁ Alice“
ze sedmi předchozích ročníků. Jméno je proto sjednocené na RIKLOVÁ, výsledek se nemění.
Zápis z ČGF je v ročníku pod klíčem `"upravy"`.

### Vložené soutěže

Nearest to the pin, longest drive, soutěž o birdie, texas scramble nebo souboj
o večeři ČGF neeviduje — hrají se v aplikaci Caddiee. Ročník je může mít pod
nepovinným klíčem `"vlozene_souteze"` a stránka je vykreslí pod výsledky; ročník
bez něj nic navíc neukáže. Jména se převádějí na zápis z ČGF („PŘÍJMENÍ Jméno“),
aby fungovalo hledání hráče.

```jsonc
"vlozene_souteze": {
  "zdroj": "…",                                     // věta pod nadpisem bloku
  "jamkove":  [{"soutez": "Nearest to the Pin", "druh": "ntp|ld", "jamka": 5,
                "kolo": 1, "vitez": "DVOŘÁK Petr", "hodnota": "440"}],
  "birdie":   {"popis": "…", "skupiny": [{"nazev": "Skupina 1", "poradi": [
                {"jmeno": "…", "birdie": 3, "eagle": 0, "pary": 17, "vyhra": true}]}]},
  "scramble": {"popis": "…", "tymy": [{"nazev": "Edloš", "hraci": ["…"],
                "vysledek": "−7", "vitez": true}]},
  "souboj":   {"popis": "…", "kolo": 1, "vitez": "Háva",
               "tymy": [{"nazev": "Luxa", "body": 540}, {"nazev": "Háva", "body": 558}],
               "dvojice": [["ŽABA Adam", 25, "BŘEZINA Lukáš", 34]]}
}
```

Ročník 2026 je převzatý z veřejné stránky soutěží Caddiee a ze závěrečného exportu
`vysledky-2026.txt` v repozitáři Caddiee. Hodnoty NTP/LD jsou bez jednotek, jak je
aplikace zapsala. Výsledek scramblu (Edloš −7, první devítka) v aplikaci zapsaný
není — sdělil ho pořadatel. Body v souboji jsou z aplikace a u několika hráčů se
o bod dva liší od oficiální listiny ČGF.

### Doplnění dalšího ročníku

Přidej do `rocniky` nový objekt (a stejný do `data/vysledky.json`, řádky do
`data/vysledky.csv`) a nahraj `turnaj.json`. Přepínač let, síň slávy, rekordy
i statistiky se dopočítají samy. Výsledky z ČGF: listiny kategorií
(`vysledkova-listina-kategorie`) a skórkarty hráčů (`vysledkova-listina-hrace`).

## Fotogalerie a videa

Každý ročník může mít fotky a videa; stránka je ukáže pod výsledky jako mřížku
náhledů s prohlížečem přes celou obrazovku (šipky, Esc, swipe na mobilu). Ročník
s médii má u tlačítka v přepínači tečku.

Plní se přes **správu na `/golf/admin/`** (jedno heslo, jde i z mobilu):

- **Fotky** se zmenší už v prohlížeči — delší strana 2048 px, náhled 640 px, JPEG.
  Nahrávání je proto rychlé a z fotek zmizí EXIF i GPS. HEIC umí dekódovat jen
  Safari; jinde správa poradí uložit fotku jako JPG.
- **Videa** jdou na server beze změny, po kusech (velká videa projdou i přes limit
  PHP na upload). Nejjistější je MP4 (H.264); iPhone: Nastavení → Fotoaparát →
  Formáty → Nejkompatibilnější. Plakát se vezme ze snímku videa v prohlížeči.
- Popisky, pořadí, přesun do jiného ročníku a mazání jsou ve správě u každé položky.

Heslo: `php tools/nastav-heslo.php <složka>` vyrobí `admin/_data/heslo.php`
(heslo z proměnné `GOLF_HESLO` nebo z klávesnice, min. 10 znaků). Ten soubor se
nahraje **jednou**; pak se heslo mění ve správě („Změnit heslo“ odhlásí ostatní
zařízení). Nástroj pouštěj do složky mimo `web/`, ať se heslo.php omylem nenahraje
při dalším nasazení.

Přihlášení má limit 10 špatných pokusů za 15 minut. Prohlížeč, ve kterém se už
jednou povedlo přihlásit, má vlastní počítadlo (cookie na rok), takže ho cizí
pokusy nezablokují. Kdyby se správa přesto zamkla, stačí přes FTP smazat
`admin/_data/stav.php`.

Server musí smět zapisovat do `media/` a `admin/_data/`; správa jinak ukáže
varování. Limity (1 GiB na video, 20 GiB celkem) jdou přepsat v `admin/config.php`
podle `config.example.php`; rozpracovaná videa smějí být nejvýš čtyři najednou. `media/.htaccess` zakazuje
spouštět skripty, `admin/_data/.htaccess` nepustí nic; obojí je jen pojistka —
server jména i přípony nahraných souborů určuje sám a do `media/` nikdy nezapíše PHP.

Formát `media/galerie.json`: `{"verze":1,"rocniky":{"2026":[{"id","typ":"foto|video",
"soubor","nahled","w","h","delka","velikost","popis"}]}}`, cesty relativně k manifestu,
pořadí v poli = pořadí na webu.

## Stav dat

Staženo z turnajového systému ČGF 28. 9. 2026.

| Rok | Hřiště | Výsledky |
|-----|--------|----------|
| 2014 | Cínovec | ✅ nultý ročník, jiný název |
| 2015 | Malevil | ✅ |
| 2016 | Malevil | ✅ |
| 2017 | Malevil | ✅ |
| 2018 | Malevil | ✅ |
| 2019 | Mariánské Lázně | ✅ |
| 2020 | Kunětická Hora | ✅ obě kola, každé pod vlastním id |
| 2021 | Kunětická Hora | ✅ |
| 2022 | Malevil | ✅ |
| 2023 | Karlovy Vary | ✅ netto i brutto |
| 2024 | Telč | ✅ |
| 2025 | Telč | ✅ |
| 2026 | Telč | ✅ |
