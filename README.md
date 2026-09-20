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
  vysledky.csv            výsledky jako tabulka, 223 řádků
```

## Kde to běží

Nasazeno 20. 9. 2026 na **https://www.matchpulse.cz/golf/**. Na serveru leží
v `/matchpulse.cz/www/golf/` obsah složky `web/` a `.htaccess` s `Options -Indexes`,
`DirectoryIndex index.html` a typem pro `.json`.

> **Původní verze tohohle README tvrdila, že MatchPulse je Laravel. Není.**
> Je to vlastní PHP aplikace s front controllerem `app.php` — žádný `artisan`,
> `routes/` ani `vendor/` tam nejsou. Návod pro Laravel je níž a platí pro jiné
> weby, ne pro matchpulse.cz. Kdo se jím řídil, zasekl se hned na prvním kroku.

### Jak se to nasazuje

Nahraj obsah složky `web/` do složky na webu. Nic víc. Odkazy uvnitř jsou
relativní a data si stránka načte z `turnaj.json` vedle sebe, takže funguje
v libovolné podsložce.

**Do složky nedávej vlastní `RewriteEngine On`.** Apache tím v podsložce přestane
dědit pravidla z nadřazeného `.htaccess` — a s nimi i sjednocení na `www`, které
MatchPulse dělá v kořeni. Není to potřeba: pravidla v kořeni mají `RewriteCond !-f`
a `!-d`, takže skutečné soubory na front controller neposílají.

> Po nahrání může proxy Forpsi ještě chvíli vracet 404, kterou si zapamatovala
> z doby, kdy soubory neexistovaly. Ověřuj s parametrem navíc v adrese (`?x=1`),
> jinak budeš hledat chybu, která tam není. Totéž platí pro opcache u PHP —
> změna se projeví až za minutu či dvě.

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
          //          kolo1, kolo2, skóre, HCP po]
          // u jednokolových ročníků řádek nemá kolo2:
          //          [pořadí, jméno, klub, členské číslo, HCP,
          //           kolo, skóre, HCP po]
          "poradi": [["1", "VACULÍK Ondřej", "GCLIB", "05300549", "8,4",
                      "38 / 38", "41 / 41", "79", "8,1"]]
        }
      ]
    }
  ]
}
```

Ročník bez výsledků má `"vysledky_publikovany": false` a nepovinnou
`"poznamka"` — stránka mu sama vykreslí razítko. Ročník v budoucnosti
dostane razítko „JEŠTĚ SE NEHRÁL“.

### Doplnění dalšího ročníku

Přidej do `rocniky` nový objekt a nahraď `public/golf/turnaj.json`.
Nic jiného měnit nemusíš — přepínač let, síň slávy i statistiky se
dopočítají samy.

## Stav dat

Staženo z turnajového systému ČGF 20. 9. 2026.

| Rok | Hřiště | Výsledky |
|-----|--------|----------|
| 2015 | Malevil | ✅ |
| 2016 | Malevil | ✅ |
| 2017 | Malevil | ❌ ČGF nezveřejnila |
| 2018 | Malevil | ✅ |
| 2019 | Mariánské Lázně | ✅ |
| 2020 | Kunětická Hora | ⚠️ jen 1. kolo |
| 2021 | Kunětická Hora | ❌ ČGF nezveřejnila |
| 2022 | Malevil | ❌ ČGF nezveřejnila |
| 2023 | Karlovy Vary | ✅ netto i brutto |
| 2024 | Telč | ✅ |
| 2025 | Telč | ✅ |
| 2026 | Telč | zatím se nehrál (26. 9. 2026) |
