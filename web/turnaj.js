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

  function bunkaKola(row, kol, ci) {
    var body = row[ci === 1 ? 5 : 6];
    if (body === '' || body == null) return '—';
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
      '      <p class="tkn-sec-note">Vítězové jednotlivých kategorií po ročnících.</p></div>',
      '    <div class="tkn-panel tkn-scroll"><table>',
      '      <thead><tr><th>Rok</th><th>Hřiště</th><th>Vítězové kategorií</th></tr></thead>',
      '      <tbody id="tkn-hof"></tbody></table></div>',
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
          '<td class="tkn-win">' + (future ? 'zatím se nehrál' : 'výsledky nezveřejněny') + '</td></tr>';
      }
      var wins = e.kategorie.map(function (cat) {
        var w = cat.poradi.filter(function (r) { return r[0] === '1'; })[0];
        if (!w) return '';
        return '<div><strong>' + esc(w[1]) + '</strong> — ' + cell(totalOf(w, e.pocet_kol)) + ' b. ' +
          '<span class="tkn-cat">' + esc(cat.nazev) + '</span></div>';
      }).join('');
      return '<tr><td class="tkn-year-cell">' + e.rok + '</td>' +
        '<td class="tkn-course">' + esc(e.hriste) + '</td>' +
        '<td class="tkn-win">' + wins + '</td></tr>';
    }).join('');

    /* ---------- statistiky hráčů ---------- */
    var stats = {};
    played.forEach(function (e) {
      var seen = {};
      e.kategorie.filter(isNetto).forEach(function (cat) {
        cat.poradi.forEach(function (r) {
          var name = r[1];
          var s = stats[name] || (stats[name] = { name: name, starts: 0, wins: 0, podium: 0, best: 99, last: 0, club: r[2] });
          var pos = parseInt(r[0], 10);
          if (!seen[name]) { s.starts++; seen[name] = true; }
          if (pos === 1) s.wins++;
          if (pos >= 1 && pos <= 3) s.podium++;
          if (pos && pos < s.best) s.best = pos;
          if (e.rok > s.last) s.last = e.rok;
          if (r[2]) s.club = r[2];
        });
      });
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
        else { sortKey = k; sortDir = (k === 'name' || k === 'best') ? 1 : -1; }
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
