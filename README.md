# Turnaj, který se nikdy nehrál — webová podstránka

Kompletní, samostatně funkční podstránka s archivem turnaje: výsledkové listiny
všech ročníků, síň slávy a statistiky hráčů. Bez build kroku, bez závislostí —
jeden CSS soubor, jeden JS soubor a JSON s daty.

## Co je v balíčku

```
web/
  index.html              samostatná stránka (nahraj celou složku kamkoliv)
  turnaj.css              styly, vše scopované pod .tkn
  turnaj.js               vykreslení stránky
  turnaj.json             data všech ročníků
laravel/
  routes.snippet.php      routa do routes/web.php
  resources/views/golf/turnaj.blade.php
data/
  vysledky.json           stejná data (zdrojová kopie)
  vysledky.csv            výsledky jako tabulka, 291 řádků
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

Nahraj obsah složky `web/` do složky na webu. Nic víc. Odkazy uvnitř jsou
relativní a data si stránka načte z `turnaj.json` vedle sebe, takže to funguje
v libovolné podsložce.

**Do složky nedávej vlastní `RewriteEngine On`.** Apache tím v podsložce přestane
dědit pravidla mod_rewrite z nadřazeného `.htaccess` — a s nimi i sjednocení na
`www`. Není to potřeba: pravidla v kořeni skutečné soubory na front controller
neposílají.

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
Týká se to 43 z 289 řádků. Stránka na takovém místě ukáže pomlčku — nesčítej
zbylé jamky, vyšlo by číslo nižší, než co se odehrálo.

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

### Doplnění dalšího ročníku

Přidej do `rocniky` nový objekt a nahraď `public/golf/turnaj.json`.
Nic jiného měnit nemusíš — přepínač let, síň slávy i statistiky se
dopočítají samy.

## Stav dat

Staženo z turnajového systému ČGF 21. 9. 2026.

| Rok | Hřiště | Výsledky |
|-----|--------|----------|
| 2014 | Cínovec | ✅ nultý ročník, jiný název |
| 2015 | Malevil | ✅ |
| 2016 | Malevil | ✅ |
| 2017 | Malevil | ✅ |
| 2018 | Malevil | ✅ |
| 2019 | Mariánské Lázně | ✅ |
| 2020 | Kunětická Hora | ⚠️ jen 1. kolo |
| 2021 | Kunětická Hora | ❌ ČGF nezveřejnila |
| 2022 | Malevil | ✅ |
| 2023 | Karlovy Vary | ✅ netto i brutto |
| 2024 | Telč | ✅ |
| 2025 | Telč | ✅ |
| 2026 | Telč | zatím se nehrál (26. 9. 2026) |
