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
   ===================================================================== */
(function () {
  'use strict';

  var MOUNT_ID = 'turnaj-app';

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
            ven.push({ jmeno: r[1], rok: e.rok, hriste: e.hriste, kolo: i + 1,
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
    /* Bere v úvahu jen kola, ke kterým ročník opravdu má výsledky — u roku 2020
       ČGF zveřejnila jen první, byť turnaj byl dvoukolový. Do pořadí se pouští
       hráč, který všechna taková kola odehrál a ke každému má známý hrubý
       výsledek; jinak by nedohraná jamka nebo vynechané kolo vypadaly lépe než
       poctivě dohraných osmnáct. */
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

  function boot() {
    var mount = document.getElementById(MOUNT_ID);
    if (!mount) return;

    if (window.TURNAJ_DATA) return init(mount, window.TURNAJ_DATA);

    var inline = document.getElementById('turnaj-data');
    if (inline) {
      try { return init(mount, JSON.parse(inline.textContent)); }
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
      .then(function (d) { init(mount, d); })
      .catch(function () {
        fail(mount, 'Výsledky se nepodařilo načíst — zkontroluj cestu k souboru turnaj.json.');
      });
  }

  function fail(mount, msg) {
    mount.innerHTML = '<div class="tkn-wrap"><p class="tkn-lede">' + esc(msg) + '</p></div>';
  }

  function init(mount, DATA) {
    var editions = DATA.rocniky.slice().sort(function (a, b) { return b.rok - a.rok; });
    var played = editions.filter(function (e) { return e.vysledky_publikovany; });
    var upcoming = editions.filter(function (e) { return !e.vysledky_publikovany && e.rok >= new Date().getFullYear(); })[0];

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
      '      <p class="tkn-sec-note">Vyber ročník. Čárkovaně jsou ročníky, ke kterým ČGF výsledky nezveřejnila.</p></div>',
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
      '    Ročníky bez zveřejněné výsledkové listiny jsou v archivu označené; u roku 2020 je publikováno pouze první kolo.</p>',
      '    <p class="tkn-colophon">Ředitel soutěže ' + esc(DATA.reditel_souteze || '') + '</p>',
      '  </footer>',
      '</div>'
    ].join('');

    var $ = function (id) { return document.getElementById(id); };
    var query = '';
    var current = (played[0] || editions[0]).rok;

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
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () { current = e.rok; renderEdition(); });
      yearsEl.appendChild(b);
    });

    function renderEdition() {
      var e = editions.filter(function (x) { return x.rok === current; })[0];
      Array.prototype.forEach.call(yearsEl.children, function (b) {
        b.setAttribute('aria-pressed', String(Number(b.textContent) === current));
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
      'výsledek neexistuje — ve stablefordu se po ztrátě bodu míč zvedá a jamka se nedohraje.</p>';
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
              '. jamka</span> ' + kdo(e.k) + '</div>';
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
          if (r[2]) s.club = r[2];
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
