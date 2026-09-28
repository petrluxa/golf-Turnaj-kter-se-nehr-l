/* =====================================================================
   Turnaj, který se nikdy nehrál — vykreslení stránky
   ---------------------------------------------------------------------
   Použití:
     <div id="turnaj-app" class="tkn" data-src="/golf/turnaj.json"></div>
     <script src="/golf/turnaj.js"></script>

   Data se berou (v tomto pořadí) z:
     1) window.TURNAJ_DATA           — objekt vložený rovnou do stránky
     2) <script id="turnaj-data" type="application/json">…</script>
     3) fetch(data-src) resp. "turnaj.json" vedle stránky

   Fotky a videa k ročníkům (nepovinné) se berou z:
     1) window.TURNAJ_GALERIE        — manifest vložený rovnou do stránky
     2) fetch(data-galerie) resp. "media/galerie.json" vedle stránky
   Cesty k souborům jsou relativní k adrese manifestu. Když manifest chybí
   nebo je rozbitý, stránka se vykreslí bez galerie — výsledky vždy.
   ===================================================================== */
(function () {
  'use strict';

  var MOUNT_ID = 'turnaj-app';
  var NAHLEDU_NAJEDNOU = 24;   // víc náhledů ročníku až po „Zobrazit všech“
  var PRAH_TAHU = 50;          // o kolik pixelů se musí prst posunout, aby se listovalo

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function cell(v) { return (v === '' || v == null) ? '—' : esc(v); }
  function isNetto(cat) { return !/brutto/i.test(cat.nazev); }
  function totalOf(row, kol) { return kol === 2 ? row[7] : row[6]; }

  /* Poslední položka řádku je pole ran za jednotlivá kola. Chybí tam, kde hrubý
     výsledek neexistuje — ve stablefordu se po ztrátě bodu míč zvedá a jamka
     se nedohraje, takže ČGF žádný součet neuvádí. */
  function ranyKola(row, kol) { return row[kol === 2 ? 9 : 8] || []; }

  /* Rozdíly vůči paru po jamkách, jedna položka na kolo. "x" = nedohraná jamka. */
  function jamkyKola(row, kol) { return row[kol === 2 ? 10 : 9] || []; }

  /* Každé odehrané kolo jednou — hráč bývá ve dvou kategoriích (netto i brutto),
     ale odehrál je jen jednou. Rekordy po kolech berou jen dohraných osmnáct;
     u nedohrané jamky se neví, kolik ran by stála. */
  function vsechnaKola(editions) {
    var videno = {}, ven = [];
    editions.filter(function (e) { return e.vysledky_publikovany; }).forEach(function (e) {
      var kol = e.pocet_kol === 2 ? 2 : 1;
      e.kategorie.forEach(function (cat) {
        cat.poradi.forEach(function (r) {
          var jamky = jamkyKola(r, e.pocet_kol), rany = ranyKola(r, e.pocet_kol);
          for (var i = 0; i < kol; i++) {
            var zapis = jamky[i];
            if (!zapis) { continue; }
            var klic = e.rok + '|' + r[1] + '|' + (i + 1);
            if (videno[klic]) { continue; }
            videno[klic] = true;
            var d = zapis.split(','), pocty = { eagle: 0, birdie: 0, par: 0, triple: 0 }, uplne = true;
            d.forEach(function (x) {
              if (x === 'x') { uplne = false; return; }
              var v = Number(x);
              if (v <= -2) { pocty.eagle++; } else if (v === -1) { pocty.birdie++; }
              else if (v === 0) { pocty.par++; } else if (v >= 3) { pocty.triple++; }
            });
            /* U ročníku zapsaného jako dva turnaje může mít každý den jiné hřiště —
               v roce 2023 se první kolo hrálo na Cihelnách, druhé v Karlových Varech. */
            var jineKolo = i === 0 ? e.prvni_kolo : e.druhe_kolo;
            var hriste = (jineKolo && jineKolo.hriste) ? jineKolo.hriste : e.hriste;
            ven.push({ jmeno: r[1], rok: e.rok, hriste: hriste, kolo: i + 1,
                       rany: Number(rany[i]) || 0, uplne: uplne, jamky: d,
                       eagle: pocty.eagle, birdie: pocty.birdie, par: pocty.par, triple: pocty.triple });
          }
        });
      });
    });
    return ven;
  }

  /* Nejlepší tři na rány za ročník. Do pořadí se pouští jen hráč, který odehrál
     všechna kola, jež má ročník zveřejněná, a ke každému z nich má známý hrubý
     výsledek. Bez té podmínky by nedohraná jamka nebo vynechané kolo vypadaly
     jako lepší výkon než poctivě dohraných osmnáct. */
  function nejlepsiNaRany(e) {
    /* Bere v úvahu jen kola, ke kterým ročník opravdu má výsledky — kdyby ČGF
       u dvoukolového ročníku zveřejnila jen jedno kolo, počítá se jen to. Do
       pořadí se pouští hráč, který všechna taková kola odehrál a ke každému
       má známý hrubý výsledek; jinak by nedohraná jamka nebo vynechané kolo
       vypadaly lépe než poctivě dohraných osmnáct. */
    var kol = e.pocet_kol === 2 ? 2 : 1;
    var sloupec = function (i) { return i === 0 ? 5 : 6; };
    var indexy = [];
    for (var i = 0; i < kol; i++) {
      var sl = sloupec(i);
      var hralo = e.kategorie.some(function (cat) {
        return cat.poradi.some(function (r) { return r[sl] !== '' && r[sl] != null; });
      });
      if (hralo) { indexy.push(i); }
    }
    var poradi = [];
    e.kategorie.filter(isNetto).forEach(function (cat) {
      cat.poradi.forEach(function (r) {
        var rany = ranyKola(r, e.pocet_kol);
        var odehral = indexy.every(function (i) {
          var sl = sloupec(i);
          return r[sl] !== '' && r[sl] != null;
        });
        if (!odehral) { return; }
        var hodnoty = indexy.map(function (i) { return rany[i]; });
        if (!hodnoty.every(function (x) { return Number(x) > 0; })) { return; }
        poradi.push({
          jmeno: r[1],
          rany: hodnoty.reduce(function (a, x) { return a + Number(x); }, 0),
          kola: hodnoty
        });
      });
    });
    return poradi.sort(function (a, b) { return a.rany - b.rany; });
  }

  /* Dvoudenní ročníky, které ČGF vede jako dva turnaje, mají odkaz na ten druhý den. */
  function odkazNaKolo(kolo, popis) {
    if (!kolo) { return ''; }
    return '<span>' + popis + (kolo.bez_vysledku ? ' bez výsledků' : '') + ': ' +
      '<a href="' + esc(kolo.url) + '" target="_blank" rel="noopener">' +
      esc(kolo.nazev_v_cgf) + ' ↗</a></span>';
  }

  function bunkaKola(row, kol, ci) {
    var body = row[ci === 1 ? 5 : 6];
    if (body === '' || body == null) return '—';
    if (!/\d/.test(body)) return esc(body);
    var r = ranyKola(row, kol)[ci - 1];
    return esc(body) + ' <span class="tkn-rany">(' + (r ? esc(r) : '—') + ')</span>';
  }

  /* Vložené soutěže ročníku — nejbližší k jamce, longest drive, birdie, scramble, souboj.
     ČGF je neeviduje; data pocházejí z aplikace, ve které se hrály, a mají vlastní
     klíč "vlozene_souteze". Ročník bez něj nevykreslí nic. */
  function vlozeneSouteze(e, q) {
    var v = e.vlozene_souteze;
    if (!v) { return ''; }
    function hrac(jmeno) {
      return '<span class="tkn-hrac' + (q && norm(jmeno).indexOf(q) > -1 ? ' is-hit' : '') + '">' + esc(jmeno) + '</span>';
    }
    function radek(jmeno, obsah, cls) {
      var c = (cls || []).slice();
      if (q && norm(jmeno).indexOf(q) > -1) { c.push('is-hit'); }
      return '<tr class="' + c.join(' ') + '">' + obsah + '</tr>';
    }
    var karty = [];

    if (v.jamkove && v.jamkove.length) {
      karty.push('<div class="tkn-card"><h3>Nearest to the Pin a Longest Drive</h3>' +
        '<div class="tkn-scroll"><table><thead><tr><th>Soutěž</th><th>Vítěz</th>' +
        '<th class="tkn-num">Hodnota</th></tr></thead><tbody>' +
        v.jamkove.map(function (s) {
          return radek(s.vitez,
            '<td class="tkn-win">' + esc(s.soutez) +
            '<span class="tkn-cat">jamka ' + esc(s.jamka) + ' · ' + esc(s.kolo) + '. kolo</span></td>' +
            '<td class="tkn-name">' + esc(s.vitez) + '</td>' +
            '<td class="tkn-num">' + cell(s.hodnota) + '</td>');
        }).join('') + '</tbody></table></div></div>');
    }

    if (v.birdie && v.birdie.skupiny) {
      karty.push('<div class="tkn-card"><h3>Soutěž o birdie</h3>' +
        (v.birdie.popis ? '<p class="tkn-card-note">' + esc(v.birdie.popis) + '</p>' : '') +
        '<div class="tkn-scroll"><table><thead><tr><th>#</th><th>Hráč</th><th class="tkn-num">Birdie</th>' +
        '<th class="tkn-num">Eagle</th><th class="tkn-num">Pary</th></tr></thead>' +
        v.birdie.skupiny.map(function (sk) {
          return '<tbody><tr class="tkn-skupina"><th colspan="5" scope="colgroup">' + esc(sk.nazev) + '</th></tr>' +
            sk.poradi.map(function (h, i) {
              return radek(h.jmeno,
                '<td class="tkn-pos">' + (i + 1) + '</td>' +
                '<td class="tkn-name">' + esc(h.jmeno) + (h.vyhra ? ' <span class="tkn-vyhra">výhra</span>' : '') + '</td>' +
                '<td class="tkn-num">' + esc(h.birdie) + '</td>' +
                '<td class="tkn-num">' + esc(h.eagle) + '</td>' +
                '<td class="tkn-num">' + esc(h.pary) + '</td>', h.vyhra ? ['is-first'] : []);
            }).join('') + '</tbody>';
        }).join('') + '</table></div></div>');
    }

    if (v.scramble && v.scramble.tymy) {
      karty.push('<div class="tkn-card"><h3>Texas scramble</h3>' +
        (v.scramble.popis ? '<p class="tkn-card-note">' + esc(v.scramble.popis) + '</p>' : '') +
        '<div class="tkn-scroll"><table><thead><tr><th>Tým</th><th>Hráči</th><th class="tkn-num">Výsledek</th></tr></thead><tbody>' +
        v.scramble.tymy.map(function (t) {
          var hit = q && t.hraci.some(function (j) { return norm(j).indexOf(q) > -1; });
          return '<tr class="' + (t.vitez ? 'is-first' : '') + (hit ? ' is-hit' : '') + '">' +
            '<td class="tkn-name">' + esc(t.nazev) + (t.vitez ? ' <span class="tkn-vyhra">vítěz</span>' : '') + '</td>' +
            '<td class="tkn-hraci">' + t.hraci.map(hrac).join(', ') + '</td>' +
            '<td class="tkn-num tkn-total">' + cell(t.vysledek) + '</td></tr>';
        }).join('') + '</tbody></table></div></div>');
    }

    if (v.souboj && v.souboj.tymy && v.souboj.tymy.length === 2) {
      var s = v.souboj, a = s.tymy[0], b = s.tymy[1];
      karty.push('<div class="tkn-card"><h3>Souboj o večeři</h3>' +
        '<div class="tkn-souboj">' +
        '<span class="tkn-souboj-tym' + (s.vitez === a.nazev ? ' is-vitez' : '') + '">Tým ' + esc(a.nazev) + ' <b>' + esc(a.body) + '</b></span>' +
        '<span class="tkn-souboj-vs">:</span>' +
        '<span class="tkn-souboj-tym' + (s.vitez === b.nazev ? ' is-vitez' : '') + '"><b>' + esc(b.body) + '</b> tým ' + esc(b.nazev) + '</span>' +
        '</div>' +
        (s.popis ? '<p class="tkn-card-note">' + esc(s.popis) + '</p>' : '') +
        (s.dvojice && s.dvojice.length
          ? '<details class="tkn-dvojice"><summary>Dvojice (' + s.dvojice.length + ')</summary>' +
            '<div class="tkn-scroll"><table><tbody>' + s.dvojice.map(function (d) {
              return '<tr>' +
                '<td class="tkn-name">' + hrac(d[0]) + '</td>' +
                '<td class="tkn-num' + (d[1] > d[3] ? ' tkn-total' : '') + '">' + esc(d[1]) + '</td>' +
                '<td class="tkn-num' + (d[3] > d[1] ? ' tkn-total' : '') + '">' + esc(d[3]) + '</td>' +
                '<td class="tkn-name tkn-vpravo">' + hrac(d[2]) + '</td></tr>';
            }).join('') + '</tbody></table></div></details>'
          : '') +
        '</div>');
    }

    if (!karty.length) { return ''; }
    return '<div class="tkn-souteze">' +
      '<div class="tkn-souteze-head"><h3>Vložené soutěže</h3>' +
      (v.zdroj ? '<p>' + esc(v.zdroj) + '</p>' : '') + '</div>' +
      '<div class="tkn-cards tkn-cards-souteze">' + karty.join('') + '</div></div>';
  }

  /* ---------- galerie: načtení a kontrola manifestu ---------- */

  /* Vrací Promise, který se vždy splní — seznamem položek po ročnících, nebo
     prázdným objektem. Galerie tak nikdy nemůže shodit vykreslení výsledků. */
  function nactiGalerii(mount) {
    var zaklad;
    try { zaklad = new URL(mount.dataset.galerie || 'media/galerie.json', document.baseURI); }
    catch (e) { return Promise.resolve({}); }

    if (window.TURNAJ_GALERIE) {
      try { return Promise.resolve(zkontrolujGalerii(window.TURNAJ_GALERIE, zaklad)); }
      catch (e) { return Promise.resolve({}); }
    }
    if (typeof fetch !== 'function') return Promise.resolve({});

    /* Stejně jako u turnaj.json: kopii z cache si nech u serveru ověřit, ať je
       nově nahraná fotka vidět hned. Parametr t (mění se po minutě) obejde
       i proxy hostingu, která si umí pamatovat starou odpověď — třeba 404
       z doby, kdy manifest ještě neexistoval. Cesty k souborům se dál řeší
       proti adrese bez parametru. */
    var adresa = new URL(zaklad.href);
    adresa.searchParams.set('t', String(Math.floor(Date.now() / 60000)));
    return fetch(adresa.href, { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      })
      .then(function (m) { return zkontrolujGalerii(m, zaklad); })
      .catch(function () { return {}; });
  }

  /* Manifest zapisuje jen administrace, ale stránka mu stejně slepě nevěří:
     co nesedí, se tiše vynechá. Do adres se pustí jen relativní cesta uvnitř
     složky s manifestem — žádné "..", zpětná lomítka, cizí domény ani
     schémata typu javascript:. */
  function cestaSouboru(cesta, zaklad) {
    if (typeof cesta !== 'string' || !/^[A-Za-z0-9_-][A-Za-z0-9_.\/-]*$/.test(cesta)) return '';
    if (cesta.split('/').indexOf('..') > -1) return '';
    return new URL(cesta, zaklad).href;
  }

  /* Popisek bez řídicích znaků, nejvýš 300 znaků. Počítá se po celých znacích
     (jako na serveru), ne po polovinách UTF-16 — emoji se nesmí rozseknout. */
  function cistyPopis(s) {
    s = s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
    var znaky = Array.from ? Array.from(s) : s.split('');
    return znaky.length > 300 ? znaky.slice(0, 300).join('').trim() : s;
  }

  function kladneCislo(x, max) {
    var v = Number(x);
    return isFinite(v) && v > 0 && v <= max ? v : 0;
  }

  function zkontrolujGalerii(m, zaklad) {
    var ven = {};
    if (!m || typeof m !== 'object' || !m.rocniky || typeof m.rocniky !== 'object') return ven;
    Object.keys(m.rocniky).forEach(function (rok) {
      var seznam = m.rocniky[rok];
      if (!/^\d{4}$/.test(rok) || !Array.isArray(seznam)) return;
      var fotek = 0, videi = 0, polozky = [];
      seznam.forEach(function (p) {
        if (!p || typeof p !== 'object' || (p.typ !== 'foto' && p.typ !== 'video')) return;
        var soubor = cestaSouboru(p.soubor, zaklad);
        if (!soubor) return;
        var video = p.typ === 'video';
        polozky.push({
          video: video,
          soubor: soubor,
          /* Fotka bez náhledu (nemělo by nastat) ukáže v mřížce rovnou velkou. */
          nahled: cestaSouboru(p.nahled, zaklad) || (video ? '' : soubor),
          w: Math.round(kladneCislo(p.w, 20000)),
          h: Math.round(kladneCislo(p.h, 20000)),
          delka: kladneCislo(p.delka, 86400),
          popis: typeof p.popis === 'string' ? cistyPopis(p.popis) : '',
          cislo: video ? ++videi : ++fotek     // pořadí mezi fotkami resp. videi (pro alt)
        });
      });
      if (polozky.length) ven[rok] = polozky;
    });
    return ven;
  }

  /* Česká množná čísla: 1 fotka, 2–4 fotky, 5 a víc fotek. */
  function pocet(n, jedna, dve, pet) {
    return n + ' ' + (n === 1 ? jedna : (n >= 2 && n <= 4 ? dve : pet));
  }

  function delkaVidea(sekundy) {
    var s = Math.max(1, Math.round(sekundy));
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
    s = s % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function prvek(tag, trida, text) {
    var e = document.createElement(tag);
    if (trida) e.className = trida;
    if (text != null) e.textContent = text;
    return e;
  }

  /* Ikony prohlížeče — pevné řetězce, nic z manifestu. */
  function ikona(cesta) {
    return '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">' +
      '<path d="' + cesta + '" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function boot() {
    var mount = document.getElementById(MOUNT_ID);
    if (!mount) return;

    /* Galerie se načítá souběžně s výsledky a na nich nezávisle. */
    var galerie = nactiGalerii(mount);

    if (window.TURNAJ_DATA) return init(mount, window.TURNAJ_DATA, galerie);

    var inline = document.getElementById('turnaj-data');
    if (inline) {
      try { return init(mount, JSON.parse(inline.textContent), galerie); }
      catch (e) { return fail(mount, 'Data stránky se nepodařilo načíst.'); }
    }

    /* cache: 'no-cache' = kopii z cache použij, ale vždy si ji nech u serveru ověřit.
       Hosting k JSONu neposílá Cache-Control, takže by si ho prohlížeč po nahrání
       nových výsledků jinak klidně pár hodin držel a stránka by ukazovala stará data. */
    fetch(mount.dataset.src || 'turnaj.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      })
      .then(function (d) { init(mount, d, galerie); })
      .catch(function () {
        fail(mount, 'Výsledky se nepodařilo načíst — zkontroluj cestu k souboru turnaj.json.');
      });
  }

  function fail(mount, msg) {
    mount.innerHTML = '<div class="tkn-wrap"><p class="tkn-lede">' + esc(msg) + '</p></div>';
  }

  function init(mount, DATA, galerieSlib) {
    var editions = DATA.rocniky.slice().sort(function (a, b) { return b.rok - a.rok; });
    var played = editions.filter(function (e) { return e.vysledky_publikovany; });
    var upcoming = editions.filter(function (e) { return !e.vysledky_publikovany && e.rok >= new Date().getFullYear(); })[0];
    var nezverejnene = editions.some(function (e) { return !e.vysledky_publikovany; });

    /* ---------- kostra stránky ---------- */
    mount.innerHTML = [
      '<div class="tkn-wrap">',
      '  <header class="tkn-masthead">',
      '    <div class="tkn-eyebrow">' + esc(DATA.poradatel_kratce || 'Golf Club Telč · stableford · pouze pro zvané') + '</div>',
      '    <h1>Turnaj, který se <em>nikdy</em> nehrál</h1>',
      '    <p class="tkn-lede">Archiv všech ročníků turnaje od roku ' + editions[editions.length - 1].rok +
      '    — výsledkové listiny, síň slávy a statistiky stálých účastníků. Data pocházejí z turnajového systému České golfové federace.</p>',
      '    <div class="tkn-facts" id="tkn-facts"></div>',
      upcoming ? [
        '    <div class="tkn-next">',
        '      <span class="tkn-tag">Příští ročník</span>',
        '      <span class="tkn-what">' + esc(upcoming.hriste) + ' — ' + (upcoming.pocet_kol === 2 ? '2 kola' : '1 kolo') + ', stableford</span>',
        '      <span class="tkn-when">' + esc(upcoming.datum) + '</span>',
        '    </div>'
      ].join('') : '',
      '  </header>',

      '  <section class="tkn-section">',
      '    <div class="tkn-sec-head"><h2>Archiv ročníků</h2>',
      '      <p class="tkn-sec-note">Vyber ročník.' +
      (nezverejnene ? ' Čárkovaně jsou ročníky, ke kterým ČGF výsledky nezveřejnila.' : '') + '</p></div>',
      '    <div class="tkn-years" id="tkn-years" role="group" aria-label="Výběr ročníku"></div>',
      '    <div class="tkn-search"><input id="tkn-q" type="search" placeholder="Zvýraznit hráče (např. Luxa)" autocomplete="off" aria-label="Zvýraznit hráče"></div>',
      '    <div class="tkn-edition" id="tkn-edition"></div>',
      '    <div id="tkn-results"></div>',
      '  </section>',

      '  <section class="tkn-section">',
      '    <div class="tkn-sec-head"><h2>Síň slávy</h2>',
      '      <p class="tkn-sec-note">Vítězové jednotlivých kategorií po ročnících. Vpravo tři nejnižší hrubé výsledky ročníku — počítají se jen hráči, kteří odehráli všechna kola.</p></div>',
      '    <div class="tkn-panel tkn-scroll"><table class="tkn-hof-table">',
      '      <thead><tr><th>Rok</th><th>Hřiště</th><th>Vítězové kategorií</th><th>Nejlépe na rány</th></tr></thead>',
      '      <tbody id="tkn-hof"></tbody></table></div>',
      '  </section>',

      '  <section class="tkn-section">',
      '    <div class="tkn-sec-head"><h2>Rekordy</h2>',
      '      <p class="tkn-sec-note">Ze skórkaret hráčů na ČGF. Rekordy za kolo počítají jen dohraných osmnáct jamek.</p></div>',
      '    <div class="tkn-rekordy" id="tkn-rekordy"></div>',
      '  </section>',

      '  <section class="tkn-section">',
      '    <div class="tkn-sec-head"><h2>Statistiky hráčů</h2>',
      '      <p class="tkn-sec-note">Napříč všemi zveřejněnými ročníky. Klikni na záhlaví sloupce pro seřazení.</p></div>',
      '    <div class="tkn-panel">',
      '      <div class="tkn-scroll"><table><thead><tr>',
      '        <th data-sort="name" tabindex="0" scope="col">Hráč <span class="tkn-arrow"></span></th>',
      '        <th class="tkn-num" data-sort="starts" tabindex="0" scope="col">Startů <span class="tkn-arrow"></span></th>',
      '        <th class="tkn-num" data-sort="wins" tabindex="0" scope="col">Vítězství <span class="tkn-arrow"></span></th>',
      '        <th class="tkn-num" data-sort="podium" tabindex="0" scope="col">Pódium <span class="tkn-arrow"></span></th>',
      '        <th class="tkn-num" data-sort="best" tabindex="0" scope="col">Nejlepší <span class="tkn-arrow"></span></th>',
      '        <th class="tkn-num" data-sort="ranyWins" tabindex="0" scope="col">Na rány <span class="tkn-arrow"></span></th>',
      '        <th class="tkn-num" data-sort="nejKolo" tabindex="0" scope="col">Nejlepší kolo <span class="tkn-arrow"></span></th>',
      '        <th class="tkn-num" data-sort="last" tabindex="0" scope="col">Naposledy <span class="tkn-arrow"></span></th>',
      '      </tr></thead><tbody id="tkn-stats"></tbody></table></div>',
      '      <button class="tkn-more" id="tkn-more" type="button"></button>',
      '    </div>',
      '  </section>',

      '  <footer class="tkn-footer">',
      '    <p><strong>Zdroj dat:</strong> turnajový systém České golfové federace (cgf.cz), staženo ' + esc(DATA['staženo'] || DATA.stazeno || '') + '.',
      '    Ročníky bez zveřejněné výsledkové listiny jsou v archivu označené.</p>',
      '    <p class="tkn-colophon">Ředitel soutěže ' + esc(DATA.reditel_souteze || '') + '</p>',
      '  </footer>',
      '</div>'
    ].join('');

    var $ = function (id) { return document.getElementById(id); };
    var query = '';

    /* Odkaz na ročník: #2025 v adrese vybere rovnou ten rok. */
    function rokZAdresy() {
      var m = /^#(\d{4})$/.exec(location.hash || '');
      var rok = m ? Number(m[1]) : 0;
      return editions.some(function (e) { return e.rok === rok; }) ? rok : 0;
    }
    var current = rokZAdresy() || (played[0] || editions[0]).rok;

    /* ---------- souhrnná čísla ---------- */
    var players = {};
    played.forEach(function (e) {
      e.kategorie.filter(isNetto).forEach(function (c) {
        c.poradi.forEach(function (r) { players[r[1]] = true; });
      });
    });
    var courses = {};
    editions.forEach(function (e) { courses[e.hriste] = true; });

    $('tkn-facts').innerHTML = [
      ['Ročníků v kalendáři ČGF', editions.length],
      ['Se zveřejněnými výsledky', played.length],
      ['Hřišť', Object.keys(courses).length],
      ['Hráčů v listinách', Object.keys(players).length]
    ].map(function (p) { return '<span>' + p[0] + ' <b>' + p[1] + '</b></span>'; }).join('');

    /* ---------- přepínač ročníků ---------- */
    var yearsEl = $('tkn-years');
    editions.forEach(function (e) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tkn-year' + (e.vysledky_publikovany ? '' : ' is-empty');
      b.textContent = e.rok;
      b.setAttribute('data-rok', e.rok);
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () { vyberRok(e.rok, true); });
      yearsEl.appendChild(b);
    });

    function vyberRok(rok, doAdresy) {
      current = rok;
      renderEdition();
      if (!doAdresy) return;
      /* Adresa ukazuje vybraný ročník, ať jde odkaz poslat dál. replaceState
         nepřidává záznam do historie — Zpět má vést pryč ze stránky, ne
         proklikávat ročníky. */
      /* Celá cesta, ne jen '#rok' — ten by se u stránky s <base href> vztáhl k jiné adrese. */
      try { history.replaceState(history.state, '', location.pathname + location.search + '#' + rok); }
      catch (err) { /* sandbox apod. */ }
    }
    window.addEventListener('hashchange', function () {
      var rok = rokZAdresy();
      if (rok && rok !== current) vyberRok(rok, false);
    });

    function renderEdition() {
      var e = editions.filter(function (x) { return x.rok === current; })[0];
      Array.prototype.forEach.call(yearsEl.children, function (b) {
        b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-rok')) === current));
      });

      $('tkn-edition').innerHTML =
        '<div class="tkn-edition-title">' + e.rok + ' — ' + esc(e.hriste) + '</div>' +
        '<div class="tkn-edition-meta">' +
        '<span>' + esc(e.datum) + '</span>' +
        '<span>' + (e.pocet_kol === 2 ? '2 kola' : '1 kolo') + '</span>' +
        '<span>' + esc(e.nazev_v_cgf) + '</span>' +
        '<span><a href="' + esc(e.url) + '" target="_blank" rel="noopener">detail na cgf.cz ↗</a></span>' +
        odkazNaKolo(e.prvni_kolo, '1. kolo') +
        odkazNaKolo(e.druhe_kolo, '2. kolo') +
        '</div>' +
        (e.vysledky_publikovany && e.poznamka
          ? '<p class="tkn-edition-note">' + esc(e.poznamka) + '</p>' : '');

      if (!e.vysledky_publikovany) {
        var future = e.rok >= new Date().getFullYear();
        $('tkn-results').innerHTML =
          '<div class="tkn-stamp-box">' +
          '<div class="tkn-stamp">' + (future ? 'JEŠTĚ SE NEHRÁL' : 'VÝSLEDKY NEZVEŘEJNĚNY') + '</div>' +
          '<p>' + esc(e.poznamka || '') + '</p></div>';
        renderGalerie();
        return;
      }

      var q = norm(query);
      $('tkn-results').innerHTML = '<div class="tkn-cards">' + e.kategorie.map(function (cat) {
        var two = e.pocet_kol === 2;
        var head = two
          ? '<tr><th>#</th><th>Hráč</th><th class="tkn-num">HCP</th><th class="tkn-num">1. kolo</th><th class="tkn-num">2. kolo</th><th class="tkn-num">Body</th></tr>'
          : '<tr><th>#</th><th>Hráč</th><th class="tkn-num">HCP</th><th class="tkn-num">Kolo</th><th class="tkn-num">Body</th></tr>';
        var rows = cat.poradi.map(function (r) {
          var cls = [];
          if (r[0] === '1') cls.push('is-first');
          if (q && norm(r[1]).indexOf(q) > -1) cls.push('is-hit');
          return '<tr class="' + cls.join(' ') + '">' +
            '<td class="tkn-pos">' + cell(r[0]) + '</td>' +
            '<td class="tkn-name">' + esc(r[1]) + (r[2] ? ' <span class="tkn-club">' + esc(r[2]) + '</span>' : '') + '</td>' +
            '<td class="tkn-num">' + cell(r[4]) + '</td>' +
            '<td class="tkn-num">' + bunkaKola(r, e.pocet_kol, 1) + '</td>' +
            (two ? '<td class="tkn-num">' + bunkaKola(r, e.pocet_kol, 2) + '</td>' : '') +
            '<td class="tkn-num tkn-total">' + cell(totalOf(r, e.pocet_kol)) + '</td>' +
            '</tr>';
        }).join('');
        return '<div class="tkn-card"><h3>' + esc(cat.nazev) + '</h3>' +
          '<div class="tkn-scroll"><table><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div></div>';
      }).join('') + '</div>' +
      '<p class="tkn-legenda">V závorce je počet ran za kolo. Pomlčka znamená, že hrubý ' +
      'výsledek neexistuje — ve stablefordu se po ztrátě bodu míč zvedá a jamka se nedohraje.</p>' +
      vlozeneSouteze(e, q);
      renderGalerie();
    }

    /* ---------- fotky a video u ročníku ---------- */
    var galerie = {};          // rok → položky; do načtení manifestu prázdná
    var galerieRok = null;     // ročník, jehož galerie je právě vykreslená
    var galerieEl = null;      // blok galerie — v DOM jen u ročníku, který nějaká média má

    /* Volá se z renderEdition(), tedy i při každém písmenu v hledání hráče —
       galerie se ale překreslí, jen když se změnil ročník nebo dorazil manifest. */
    function renderGalerie() {
      if (galerieRok === current) return;
      galerieRok = current;
      try {
        var polozky = galerie[current] || [];
        var novy = polozky.length ? blokGalerie(current, polozky) : null;
        var vysledky = $('tkn-results');
        if (galerieEl && novy) { galerieEl.parentNode.replaceChild(novy, galerieEl); }
        else if (galerieEl) { galerieEl.parentNode.removeChild(galerieEl); }
        else if (novy) { vysledky.parentNode.insertBefore(novy, vysledky.nextSibling); }
        galerieEl = novy;
      } catch (err) {
        if (window.console) console.error(err);
      }
    }

    function blokGalerie(rok, polozky) {
      var fotek = polozky.filter(function (p) { return !p.video; }).length;
      var videi = polozky.length - fotek;
      var blok = prvek('div', 'tkn-galerie');
      blok.id = 'tkn-galerie';
      var hlava = prvek('div', 'tkn-galerie-head');
      hlava.appendChild(prvek('h3', null, 'Fotky a video'));
      hlava.appendChild(prvek('span', 'tkn-galerie-pocet', [
        fotek ? pocet(fotek, 'fotka', 'fotky', 'fotek') : '',
        videi ? pocet(videi, 'video', 'videa', 'videí') : ''
      ].filter(Boolean).join(' · ')));
      blok.appendChild(hlava);

      var mrizka = prvek('ul', 'tkn-galerie-mrizka');
      mrizka.setAttribute('role', 'list');   // Safari jinak seznamu bez odrážek bere význam
      polozky.slice(0, NAHLEDU_NAJEDNOU).forEach(function (p, i) {
        mrizka.appendChild(dlazdice(rok, p, i));
      });
      blok.appendChild(mrizka);

      if (polozky.length > NAHLEDU_NAJEDNOU) {
        var vse = prvek('button', 'tkn-galerie-vse', 'Zobrazit všech ' + polozky.length);
        vse.type = 'button';
        vse.addEventListener('click', function () {
          polozky.slice(NAHLEDU_NAJEDNOU).forEach(function (p, i) {
            mrizka.appendChild(dlazdice(rok, p, NAHLEDU_NAJEDNOU + i));
          });
          blok.removeChild(vse);
          /* Tlačítko zmizelo — focus na první nově ukázaný náhled, ať se neztratí. */
          var dalsi = mrizka.children[NAHLEDU_NAJEDNOU];
          if (dalsi) dalsi.firstChild.focus();
        });
        blok.appendChild(vse);
      }
      return blok;
    }

    function popisPolozky(rok, p) {
      return p.popis || (p.video ? 'Video ' : 'Fotka ') + p.cislo + ' z ročníku ' + rok;
    }

    function dlazdice(rok, p, i) {
      var li = prvek('li');
      /* Video bez plakátu: velké ▶ uprostřed (CSS), ať dlaždice nevypadá jako nenačtený obrázek. */
      var b = prvek('button', 'tkn-nahled' + (p.video ? ' is-video' : '') + (p.video && !p.nahled ? ' is-bez-nahledu' : ''));
      b.type = 'button';
      var popis = popisPolozky(rok, p);
      if (p.nahled) {
        var img = prvek('img');
        img.setAttribute('loading', 'lazy');     // před src, jinak se načte hned
        img.setAttribute('decoding', 'async');
        if (p.w && p.h) {
          /* Náhled má delší stranu nejvýš 640 px, poměr stran jako velká fotka. */
          var k = Math.min(1, 640 / Math.max(p.w, p.h));
          img.width = Math.max(1, Math.round(p.w * k));
          img.height = Math.max(1, Math.round(p.h * k));
        }
        img.alt = popis;
        img.src = p.nahled;
        b.appendChild(img);
      }
      if (p.video) {
        var delka = p.delka ? delkaVidea(p.delka) : '';
        /* „Video 2 z ročníku 2025, 1:23“ resp. „Vyhlášení — video, 1:23“. */
        b.setAttribute('aria-label', popis + (p.popis ? ' — video' : '') + (delka ? ', ' + delka : ''));
        /* \uFE0E za trojúhelníkem: znak, ne barevné emoji (iOS). */
        var znacka = prvek('span', 'tkn-nahled-video', '\u25B6\uFE0E' + (delka ? ' ' + delka : ''));
        znacka.setAttribute('aria-hidden', 'true');
        b.appendChild(znacka);
      }
      b.addEventListener('click', function () { otevriProhlizec(rok, i, b); });
      li.appendChild(b);
      return li;
    }

    /* Značka u tlačítek roků, které mají fotky nebo video. */
    function oznacRoky() {
      Array.prototype.forEach.call(yearsEl.children, function (b) {
        var rok = b.getAttribute('data-rok'), polozky = galerie[rok] || [];
        if (!polozky.length) {
          b.classList.remove('has-media');
          b.removeAttribute('title');
          b.removeAttribute('aria-label');
          return;
        }
        var fotky = polozky.some(function (p) { return !p.video; });
        var videa = polozky.some(function (p) { return p.video; });
        var popis = rok + ' — ' + (fotky && videa ? 'fotky a video' : (fotky ? 'fotky' : 'video'));
        b.classList.add('has-media');
        b.title = popis;
        b.setAttribute('aria-label', popis);
      });
    }

    /* ---------- prohlížeč fotek a videí ---------- */
    var lb = null;                                    // prvky prohlížeče, vznikají při prvním otevření
    var prohlizim = { rok: 0, polozky: [], i: 0, otevrel: null };
    var prednacteno = {};
    var tah = null, tahKonec = 0;

    function sestavProhlizec() {
      var d = prvek('dialog', 'tkn-lightbox');
      d.innerHTML = [
        '<div class="tkn-lb-lista">',
        '  <span class="tkn-lb-pocitadlo" aria-hidden="true"></span>',
        /* Čtečce se při listování ohlásí celá položka, ne jen „4 / 30“. */
        '  <span class="tkn-vh tkn-lb-hlaseni" aria-live="polite" aria-atomic="true"></span>',
        '  <button type="button" class="tkn-lb-btn tkn-lb-zavrit" aria-label="Zavřít">' + ikona('M6 6l12 12M18 6L6 18') + '</button>',
        '</div>',
        '<div class="tkn-lb-scena">',
        '  <div class="tkn-lb-obal"></div>',
        '  <button type="button" class="tkn-lb-btn tkn-lb-predchozi" aria-label="Předchozí">' + ikona('M15 5l-7 7 7 7') + '</button>',
        '  <button type="button" class="tkn-lb-btn tkn-lb-dalsi" aria-label="Další">' + ikona('M9 5l7 7-7 7') + '</button>',
        '</div>',
        '<div class="tkn-lb-dole"><p class="tkn-lb-popis"></p></div>'
      ].join('');
      /* Uvnitř .tkn, aby platily CSS proměnné a písmo komponenty. */
      mount.appendChild(d);
      var q = function (sel) { return d.querySelector(sel); };
      var p = {
        dialog: d, lista: q('.tkn-lb-lista'), pocitadlo: q('.tkn-lb-pocitadlo'), hlaseni: q('.tkn-lb-hlaseni'),
        zavrit: q('.tkn-lb-zavrit'), scena: q('.tkn-lb-scena'), obal: q('.tkn-lb-obal'),
        predchozi: q('.tkn-lb-predchozi'), dalsi: q('.tkn-lb-dalsi'),
        dole: q('.tkn-lb-dole'), popis: q('.tkn-lb-popis'),
        modalni: typeof d.showModal === 'function',
        otevreno: false
      };

      p.zavrit.addEventListener('click', zavriProhlizec);
      p.predchozi.addEventListener('click', function () { ukaz(prohlizim.i - 1); });
      p.dalsi.addEventListener('click', function () { ukaz(prohlizim.i + 1); });

      /* Klik mimo fotku (na tmavé pozadí) zavře. Klik, kterým skončil tah prstem, ne. */
      d.addEventListener('click', function (ev) {
        if (Date.now() - tahKonec < 500) return;
        var t = ev.target;
        if (t === d || t === p.lista || t === p.scena || t === p.obal || t === p.dole) zavriProhlizec();
      });

      /* Esc zavírá přes nás, ať se uklidí hned — WebKit posílá událost close
         se zpožděním a video by mezitím hrálo dál. */
      d.addEventListener('cancel', function (ev) {
        ev.preventDefault();
        zavriProhlizec();
      });
      /* Pojistka pro zavření jinou cestou (např. prohlížeč sám). Opožděná
         událost po rychlém znovuotevření se ignoruje. */
      d.addEventListener('close', function () {
        if (!d.hasAttribute('open')) poZavreni();
      });

      /* Listování tahem prstem. Myš ne — ta má šipky a klávesy. */
      p.scena.addEventListener('pointerdown', function (ev) {
        if (ev.pointerType === 'mouse' || !ev.isPrimary) { tah = null; return; }
        /* Tah po ovládání videa (posuvník dole) je přetáčení, ne listování. */
        if (ev.target.tagName === 'VIDEO' && ev.target.getBoundingClientRect().bottom - ev.clientY < 72) {
          tah = null; return;
        }
        tah = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
      });
      p.scena.addEventListener('pointerup', function (ev) {
        if (!tah || ev.pointerId !== tah.id) return;
        var dx = ev.clientX - tah.x, dy = ev.clientY - tah.y;
        tah = null;
        if (Math.abs(dx) < PRAH_TAHU || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        /* Přiblížená stránka (dva prsty) se tahem posouvá, nelistuje. */
        if (window.visualViewport && window.visualViewport.scale > 1.05) return;
        tahKonec = Date.now();
        ukaz(prohlizim.i + (dx < 0 ? 1 : -1));
      });
      p.scena.addEventListener('pointercancel', function () { tah = null; });
      return p;
    }

    function otevriProhlizec(rok, i, otevrel) {
      if (!lb) lb = sestavProhlizec();
      prohlizim = { rok: rok, polozky: galerie[rok] || [], i: i, otevrel: otevrel };
      if (!prohlizim.polozky.length) return;
      lb.dialog.setAttribute('aria-label', 'Fotky a video z ročníku ' + rok);
      lb.scena.classList.toggle('is-jedna', prohlizim.polozky.length === 1);
      ukaz(i);
      if (!lb.dialog.hasAttribute('open')) {
        if (lb.modalni) { lb.dialog.showModal(); } else { lb.dialog.setAttribute('open', ''); }
        lb.otevreno = true;
        /* Zámek rolování na <html>, ne na <body> — Safari na iPhonu jinak roluje dál. */
        document.documentElement.classList.add('tkn-zamek');
        document.addEventListener('keydown', klavesy);
      }
      lb.zavrit.focus();
    }

    function zavriProhlizec() {
      if (!lb) return;
      if (lb.dialog.hasAttribute('open')) {
        if (lb.modalni) { lb.dialog.close(); } else { lb.dialog.removeAttribute('open'); }
      }
      poZavreni();
    }

    /* Úklid po zavření — jednou, ať se zavře kteroukoli cestou. */
    function poZavreni() {
      if (!lb || !lb.otevreno) return;
      lb.otevreno = false;
      uvolniMedia();
      tah = null;
      document.documentElement.classList.remove('tkn-zamek');
      document.removeEventListener('keydown', klavesy);
      var o = prohlizim.otevrel;
      if (o && document.documentElement.contains(o)) o.focus();
    }

    function klavesy(ev) {
      if (!lb || !lb.otevreno || ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey) return;
      if (ev.key === 'Escape' || ev.key === 'Esc') {
        /* Nativní modální dialog pošle na Esc událost cancel (viz výš). */
        if (!lb.modalni) { ev.preventDefault(); zavriProhlizec(); }
        return;
      }
      /* Šipky na videu s focusem přetáčejí video — to mu nebereme. */
      if (ev.target && ev.target.tagName === 'VIDEO') return;
      var n = prohlizim.polozky.length, cil = -1;
      if (ev.key === 'ArrowLeft' || ev.key === 'Left') cil = prohlizim.i - 1;
      else if (ev.key === 'ArrowRight' || ev.key === 'Right') cil = prohlizim.i + 1;
      else if (ev.key === 'Home') cil = 0;
      else if (ev.key === 'End') cil = n - 1;
      else return;
      ev.preventDefault();
      ukaz(cil);
    }

    /* Rozehrané video se při přepnutí i zavření zastaví a pustí z paměti. */
    function uvolniMedia() {
      if (!lb) return;
      Array.prototype.forEach.call(lb.obal.querySelectorAll('video'), function (v) {
        try { v.pause(); } catch (e) { /* nic */ }
        v.removeAttribute('src');
        try { v.load(); } catch (e) { /* nic */ }
      });
      lb.obal.textContent = '';
      var chyba = lb.dole.querySelector('.tkn-lb-chyba');
      if (chyba) lb.dole.removeChild(chyba);
    }

    function ukaz(i) {
      var polozky = prohlizim.polozky, n = polozky.length;
      if (i < 0 || i >= n) return;
      prohlizim.i = i;
      var p = polozky[i];
      uvolniMedia();

      var m;
      if (p.video) {
        m = prvek('video', 'tkn-lb-media');
        m.controls = true;
        m.setAttribute('playsinline', '');
        m.setAttribute('preload', 'metadata');
        if (p.nahled) m.poster = p.nahled;
        m.addEventListener('error', function () {
          if (!m.parentNode || lb.dole.querySelector('.tkn-lb-chyba')) return;
          var c = prvek('p', 'tkn-lb-chyba', 'Video se v tomto prohlížeči nepodařilo přehrát. ');
          var a = prvek('a', null, 'Stáhnout soubor');
          a.href = p.soubor;
          a.setAttribute('download', '');
          c.appendChild(a);
          lb.dole.appendChild(c);
        });
      } else {
        m = prvek('img', 'tkn-lb-media');
        m.setAttribute('decoding', 'async');
        m.alt = popisPolozky(prohlizim.rok, p);
        /* Dokud se velká fotka stahuje, prosvítá pod ní náhled z mřížky. */
        if (p.nahled && p.nahled !== p.soubor) m.style.backgroundImage = 'url("' + p.nahled + '")';
      }
      if (p.w && p.h) {
        /* Rozměry předem, ať prohlížeč neposkakuje, než se soubor načte. */
        m.width = p.w;
        m.height = p.h;
        m.style.setProperty('--tkn-pomer', String(p.w / p.h));
        m.style.setProperty('--tkn-sirka', p.w + 'px');
      }
      m.src = p.soubor;
      lb.obal.appendChild(m);

      lb.pocitadlo.textContent = (i + 1) + ' / ' + n;
      lb.hlaseni.textContent = (p.video ? 'Video' : 'Fotka') + ' ' + (i + 1) + ' z ' + n + (p.popis ? ': ' + p.popis : '');
      lb.popis.textContent = p.popis;
      lb.popis.hidden = !p.popis;

      var aktivni = document.activeElement;
      lb.predchozi.disabled = i === 0;
      lb.dalsi.disabled = i === n - 1;
      /* Zakázané tlačítko ztratí focus — přesuň ho na to druhé, ať klávesy fungují dál. */
      if (aktivni && aktivni.disabled) {
        var jine = aktivni === lb.predchozi ? lb.dalsi : lb.predchozi;
        (jine.disabled ? lb.zavrit : jine).focus();
      }
      prednacti(i - 1);
      prednacti(i + 1);
    }

    /* Sousední fotky se stáhnou dopředu, ať listování nečeká. */
    function prednacti(i) {
      var p = prohlizim.polozky[i];
      if (!p || p.video || prednacteno[p.soubor]) return;
      var img = new Image();
      img.decoding = 'async';
      img.src = p.soubor;
      prednacteno[p.soubor] = img;
    }

    if (galerieSlib && typeof galerieSlib.then === 'function') {
      galerieSlib.then(function (g) {
        galerie = g || {};
        if (!Object.keys(galerie).length) return;
        try { oznacRoky(); } catch (err) { if (window.console) console.error(err); }
        galerieRok = null;
        renderGalerie();
      });
    }

    /* ---------- síň slávy ---------- */
    $('tkn-hof').innerHTML = editions.map(function (e) {
      if (!e.vysledky_publikovany) {
        var future = e.rok >= new Date().getFullYear();
        return '<tr class="is-blank"><td class="tkn-year-cell">' + e.rok + '</td>' +
          '<td class="tkn-course">' + esc(e.hriste) + '</td>' +
          '<td class="tkn-win" colspan="2">' + (future ? 'zatím se nehrál' : 'výsledky nezveřejněny') + '</td></tr>';
      }
      var wins = e.kategorie.map(function (cat) {
        var w = cat.poradi.filter(function (r) { return r[0] === '1'; })[0];
        if (!w) return '';
        return '<div><strong>' + esc(w[1]) + '</strong> — ' + cell(totalOf(w, e.pocet_kol)) + ' b. ' +
          '<span class="tkn-cat">' + esc(cat.nazev) + '</span></div>';
      }).join('');
      var rany = nejlepsiNaRany(e).slice(0, 3).map(function (h, i) {
        return '<div><span class="tkn-poradi">' + (i + 1) + '.</span> ' + esc(h.jmeno) +
          ' — <strong>' + h.rany + '</strong> ran' +
          (h.kola.length > 1 ? ' <span class="tkn-rany">(' + h.kola.map(esc).join('+') + ')</span>' : '') +
          '</div>';
      }).join('');
      return '<tr><td class="tkn-year-cell">' + e.rok + '</td>' +
        '<td class="tkn-course">' + esc(e.hriste) + '</td>' +
        '<td class="tkn-win" data-popis="Vítězové kategorií">' + wins + '</td>' +
        '<td class="tkn-win tkn-hof-rany" data-popis="Nejlépe na rány">' +
        (rany || '<span class="mala">—</span>') + '</td></tr>';
    }).join('');

    /* ---------- rekordy ---------- */
    var kolaVse = vsechnaKola(editions);
    var dohrana = kolaVse.filter(function (k) { return k.uplne && k.rany > 0; });

    function nejlepsi(zdroj, klic, smer, popis) {
      var serazene = zdroj.slice().sort(function (a, b) {
        var d = smer * (a[klic] - b[klic]);
        return d !== 0 ? d : a.rany - b.rany;
      });
      if (!serazene.length) { return null; }
      var meta = serazene[0][klic];
      return serazene.filter(function (k) { return k[klic] === meta; })
        .slice(0, 3).map(function (k) { return { k: k, hodnota: popis(k) }; });
    }

    /* Součty za ročník: sčítají se jen dohraná kola téhož hráče. */
    var zaRocnik = {};
    dohrana.forEach(function (k) {
      var klic = k.rok + '|' + k.jmeno;
      var z = zaRocnik[klic] || (zaRocnik[klic] = { jmeno: k.jmeno, rok: k.rok, hriste: k.hriste,
                                                   birdie: 0, par: 0, kol: 0, rany: 0 });
      z.birdie += k.birdie; z.par += k.par; z.kol++; z.rany += k.rany;
    });
    var rocniky = Object.keys(zaRocnik).map(function (x) { return zaRocnik[x]; });

    var eagly = [];
    kolaVse.forEach(function (k) {
      k.jamky.forEach(function (x, i) {
        if (x !== 'x' && Number(x) <= -2) { eagly.push({ k: k, jamka: i + 1 }); }
      });
    });
    eagly.sort(function (a, b) { return a.k.rok - b.k.rok || a.k.kolo - b.k.kolo || a.jamka - b.jamka; });

    function kdo(k) { return esc(k.jmeno) + ' <span class="tkn-kdy">' + k.rok +
      (k.kolo ? ', ' + k.kolo + '. kolo' : '') + '</span>'; }

    /* Účast: hráč je v netto i brutto kategorii, započítá se jednou. Ročník
       vystupuje v rekordu na místě hráče — kolo 0 potlačí "X. kolo". */
    var ucast = editions.filter(function (e) { return e.vysledky_publikovany; }).map(function (e) {
      var lide = {};
      e.kategorie.filter(isNetto).forEach(function (cat) {
        cat.poradi.forEach(function (r) { lide[r[1]] = true; });
      });
      return { jmeno: e.hriste, rok: e.rok, kolo: 0, rany: 0, hracu: Object.keys(lide).length };
    });

    var karty = [
      ['Nejvíc hráčů', nejlepsi(ucast, 'hracu', -1, function (u) { return u.hracu + ' hráčů'; })],
      ['Nejnižší kolo', nejlepsi(dohrana, 'rany', 1, function (k) { return k.rany + ' ran'; })],
      ['Nejvyšší kolo', nejlepsi(dohrana, 'rany', -1, function (k) { return k.rany + ' ran'; })],
      ['Nejvíc birdie v kole', nejlepsi(dohrana, 'birdie', -1, function (k) { return k.birdie + '×'; })],
      ['Nejvíc parů v kole', nejlepsi(dohrana, 'par', -1, function (k) { return k.par + '×'; })],
      ['Nejvíc triple bogey a horších', nejlepsi(dohrana, 'triple', -1, function (k) { return k.triple + '×'; })],
      ['Nejvíc birdie za ročník', nejlepsi(rocniky, 'birdie', -1, function (z) { return z.birdie + '×'; })],
      ['Nejvíc parů za ročník', nejlepsi(rocniky, 'par', -1, function (z) { return z.par + '×'; })]
    ];

    $('tkn-rekordy').innerHTML = karty.filter(function (x) { return x[1]; }).map(function (x) {
      return '<div class="tkn-rekord"><h3>' + esc(x[0]) + '</h3>' +
        x[1].map(function (p) {
          return '<div class="tkn-rekord-radek"><span class="tkn-rekord-hodnota">' + esc(p.hodnota) +
            '</span> ' + kdo(p.k) + '</div>';
        }).join('') + '</div>';
    }).join('') +
      '<div class="tkn-rekord tkn-rekord-siroky"><h3>Eagle (' + eagly.length + ')</h3>' +
      (eagly.length
        ? '<div class="tkn-eagly">' + eagly.map(function (e) {
            return '<div class="tkn-rekord-radek"><span class="tkn-rekord-hodnota">' + e.jamka +
              '. jamka</span> ' + esc(e.k.jmeno) +
              ' <span class="tkn-kdy">' + esc(e.k.hriste) + ' ' + e.k.rok +
              ', ' + e.k.kolo + '. kolo</span></div>';
          }).join('') + '</div>'
        : '<div class="tkn-rekord-radek">zatím žádný</div>') + '</div>';

    /* ---------- statistiky hráčů ---------- */
    var stats = {};
    played.forEach(function (e) {
      var seen = {};
      e.kategorie.filter(isNetto).forEach(function (cat) {
        cat.poradi.forEach(function (r) {
          var name = r[1];
          var s = stats[name] || (stats[name] = { name: name, starts: 0, wins: 0, podium: 0, best: 99,
                                                  ranyWins: 0, nejKolo: 999, last: 0, club: r[2] });
          /* Nejlepší odehrané kolo — rány jsou v posledním poli řádku, po jedné na kolo. */
          ranyKola(r, e.pocet_kol).forEach(function (x) {
            var v = Number(x);
            if (v > 0 && v < s.nejKolo) { s.nejKolo = v; }
          });
          var pos = parseInt(r[0], 10);
          if (!seen[name]) { s.starts++; seen[name] = true; }
          if (pos === 1) s.wins++;
          if (pos >= 1 && pos <= 3) s.podium++;
          if (pos && pos < s.best) s.best = pos;
          if (e.rok > s.last) s.last = e.rok;
          /* Klub z nejnovějšího ročníku, kde nějaký je — ročníky jdou od
             nejnovějšího, takže starší zápis už ho nepřepíše. */
          if (r[2] && !s.club) s.club = r[2];
        });
      });
      /* Vítězství na rány = nejnižší součet ročníku. Shodný součet bere vítězství oběma. */
      var naRany = nejlepsiNaRany(e);
      if (naRany.length) {
        var nej = naRany[0].rany;
        naRany.forEach(function (h) {
          if (h.rany === nej && stats[h.jmeno]) { stats[h.jmeno].ranyWins++; }
        });
      }
    });
    var allStats = Object.keys(stats).map(function (k) { return stats[k]; });
    var sortKey = 'starts', sortDir = -1, expanded = false;

    function renderStats() {
      var q = norm(query);
      var rows = allStats.slice().sort(function (a, b) {
        if (sortKey === 'name') return sortDir * a.name.localeCompare(b.name, 'cs');
        var d = sortDir * (a[sortKey] - b[sortKey]);
        return d !== 0 ? d : (b.starts - a.starts) || a.name.localeCompare(b.name, 'cs');
      });
      var shown = expanded ? rows : rows.slice(0, 12);
      $('tkn-stats').innerHTML = shown.map(function (s) {
        return '<tr class="' + (q && norm(s.name).indexOf(q) > -1 ? 'is-hit' : '') + '">' +
          '<td class="tkn-name">' + esc(s.name) + (s.club ? ' <span class="tkn-club">' + esc(s.club) + '</span>' : '') + '</td>' +
          '<td class="tkn-num">' + s.starts + '</td>' +
          '<td class="tkn-num ' + (s.wins ? 'tkn-trophy' : '') + '">' + (s.wins || '—') + '</td>' +
          '<td class="tkn-num">' + (s.podium || '—') + '</td>' +
          '<td class="tkn-num">' + (s.best < 99 ? s.best + '.' : '—') + '</td>' +
          '<td class="tkn-num ' + (s.ranyWins ? 'tkn-trophy' : '') + '">' + (s.ranyWins || '—') + '</td>' +
          '<td class="tkn-num">' + (s.nejKolo < 999 ? s.nejKolo : '—') + '</td>' +
          '<td class="tkn-num">' + s.last + '</td></tr>';
      }).join('');
      $('tkn-more').textContent = expanded
        ? 'Zobrazit jen první dvanáctku'
        : 'Zobrazit všechny hráče (' + allStats.length + ')';
      Array.prototype.forEach.call(mount.querySelectorAll('th[data-sort]'), function (th) {
        var on = th.getAttribute('data-sort') === sortKey;
        th.setAttribute('aria-sort', on ? (sortDir < 0 ? 'descending' : 'ascending') : 'none');
        th.querySelector('.tkn-arrow').textContent = on ? (sortDir < 0 ? '▾' : '▴') : '';
      });
    }

    Array.prototype.forEach.call(mount.querySelectorAll('th[data-sort]'), function (th) {
      var go = function () {
        var k = th.getAttribute('data-sort');
        if (k === sortKey) { sortDir = -sortDir; }
        else { sortKey = k; sortDir = (k === 'name' || k === 'best' || k === 'nejKolo') ? 1 : -1; }
        renderStats();
      };
      th.addEventListener('click', go);
      th.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); }
      });
    });

    $('tkn-more').addEventListener('click', function () { expanded = !expanded; renderStats(); });
    $('tkn-q').addEventListener('input', function (ev) {
      query = ev.target.value.trim();
      renderEdition(); renderStats();
    });

    renderEdition();
    renderStats();

    /* Kdo přišel odkazem na ročník (#2025), vidí rovnou archiv — jako u běžné
       kotvy. Při obnovení stránky a návratu Zpět ne, tam si pozici vrací
       prohlížeč sám. */
    if (rokZAdresy() && prisloOdkazem() && yearsEl.parentNode.scrollIntoView) {
      var archiv = yearsEl.parentNode;
      archiv.scrollIntoView();
      /* Písmo z Google Fonts často dorazí až potom a hlavička nad archivem
         povyroste. Dorovnej to — ale jen když návštěvník mezitím neroloval. */
      var y = window.pageYOffset;
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () {
          if (window.pageYOffset === y) archiv.scrollIntoView();
        });
      }
    }
  }

  function prisloOdkazem() {
    try {
      var nav = performance.getEntriesByType('navigation')[0];
      return !nav || nav.type === 'navigate';
    } catch (e) { return true; }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
