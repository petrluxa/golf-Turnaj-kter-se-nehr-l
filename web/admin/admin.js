/* =====================================================================
   Galerie — správa fotek a videí k ročníkům turnaje
   ---------------------------------------------------------------------
   Kostru stránky posílá admin/index.php (app.html) s přísnou CSP, takže
   tady se nesmí nic vkládat jako HTML s atributy style/on… — všechno se
   staví přes createElement a texty přes textContent (popisky z manifestu
   jsou cizí data, nikdy se nevkládají jako HTML).

   S API (api.php?akce=…) se mluví přes XMLHttpRequest — kvůli průběhu
   nahrávání. Odpověď je vždy JSON {ok:true,…} nebo {ok:false,kod,chyba}.

   Fotky se zmenšují už tady v prohlížeči: velká = delší strana nejvýš
   2048 px (JPEG 0,85), náhled 640 px (JPEG 0,8). Tím se zahodí i EXIF
   s GPS. Fotka, která se ani tak nevejde do limitu serveru (max_foto_bajtu),
   dostane nižší kvalitu, případně menší rozměr (jpegDoLimitu). Videa jdou na server beze změny, po kusech (kus_bajtu z API),
   s plakátem z prvních vteřin.
   ===================================================================== */
(function () {
  'use strict';

  var API = 'api.php';
  var MEDIA = '../media/';                 /* cesty v manifestu jsou relativní ke složce media/ */

  var MAX_VELKA = 2048, KVALITA_VELKA = 0.85;
  var MAX_NAHLED = 640, KVALITA_NAHLED = 0.8;
  var MAX_PLAKAT = 1280, KVALITA_PLAKAT = 0.82;
  var MAX_PLOCHA = 16000000;               /* víc pixelů na jedno plátno iPhone nedovolí */
  var SOUBEZNE_FOTKY = 3;
  var ZASOBA_FOTEK = 2;                    /* kolik zpracovaných fotek smí čekat na nahrání (paměť telefonu) */
  var LIMIT_CTENI_VIDEA = 8000;            /* ms — pak se video nahraje bez plakátu */
  var POKUSY = 3;                          /* pokusů na jeden kus videa */
  var PAUZY = [1000, 3000, 7000];          /* rostoucí pauza mezi pokusy */
  var PRIPONY_VIDEA = ['mp4', 'mov', 'webm', 'm4v'];
  var PRIPONY_FOTEK = /^(jpe?g|jfif|png|gif|webp|avif|bmp|heic|heif|tiff?)$/;
  var BEZNE_FOTKY = /^(jpe?g|jfif|png|gif|webp|bmp)$/;   /* ty umí každý prohlížeč — když nejdou, je soubor vadný */
  var VYCHOZI_LIMITY = {
    kus_bajtu: 1024 * 1024,
    max_foto_bajtu: 8 * 1024 * 1024,
    max_nahled_bajtu: 1024 * 1024,
    max_video_bajtu: 1024 * 1024 * 1024
  };
  var RE_ID = /^[0-9a-f]{16}$/;
  var RE_NAHRAVANI = /^[0-9a-f]{32}$/;
  var RE_CESTA = /^\d{4}\/[0-9a-f]{16}(_n)?\.[a-z0-9]{2,5}$/;
  var HLASKA_VIDEO = 'Tento prohlížeč video neumí přehrát — na webu se nemusí přehrát všude. ' +
    'Nejjistější je MP4 (H.264); na iPhonu Nastavení → Fotoaparát → Formáty → Nejkompatibilnější.';
  var HLASKA_FORMAT = 'Tenhle formát prohlížeč neumí — ulož fotku jako JPG.';

  /* 16×8 JPEG (vlevo bílý, vpravo černý) s EXIF orientací 6. Prohlížeč, který
     orientaci sám použije, z něj udělá 8×16 s bílou nahoře. */
  var TEST_ORIENTACE = '/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/wAALCAAIABABAREA/8QAFQABAQAAAAAAAAAAAAAAAAAACQr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAA/AFTSrv/Z';

  var stav = {
    prihlasen: false,
    csrf: '',
    hesloNastaveno: true,
    roky: [],
    galerie: { rocniky: {} },
    limity: normalizujLimity(null),
    zapis: { media: true, data: true },
    mediaChybi: false,
    manifestPoskozeny: false,
    obsazeno: 0,
    rozpracovano: 0
  };
  var vybranyRok = null;
  var fronta = [];          /* položky nahrávání */
  var karty = {};           /* id → karta v mřížce (DOM + data) */
  var cisloPolozky = 0;
  var zpracovavaSe = 0;     /* kolik fotek se právě dekóduje a zmenšuje (nejvýš 1) */
  var frontaBezela = false;

  /* =================================================================
     Drobné pomůcky
     ================================================================= */
  function $(id) { return document.getElementById(id); }

  /* Prvek s atributy a dětmi. Klíč "text" = textContent, nikdy HTML. */
  function el(tag, vlastnosti, deti) {
    var e = document.createElement(tag);
    if (vlastnosti) {
      Object.keys(vlastnosti).forEach(function (k) {
        var v = vlastnosti[k];
        if (v == null || v === false) { return; }
        if (k === 'text') { e.textContent = v; }
        else if (k === 'class') { e.className = v; }
        else { e.setAttribute(k, v === true ? '' : String(v)); }
      });
    }
    (deti || []).forEach(function (d) {
      if (d == null) { return; }
      e.appendChild(typeof d === 'string' ? document.createTextNode(d) : d);
    });
    return e;
  }

  function mnozne(n, jedna, dve, pet) { return n === 1 ? jedna : (n >= 2 && n <= 4 ? dve : pet); }
  function pocet(n, jedna, dve, pet) { return n + ' ' + mnozne(n, jedna, dve, pet); }
  /* Desetinné číslo s čárkou, bez nul na konci („1 GB“, ne „1,00 GB“). */
  function desetinne(x, mista) {
    var t = x.toFixed(mista);
    if (t.indexOf('.') >= 0) { t = t.replace(/0+$/, '').replace(/\.$/, ''); }
    return t.replace('.', ',');
  }

  function velikost(b) {
    b = Number(b) || 0;
    if (b < 1024) { return b + ' B'; }
    if (b < 1024 * 1024) { return Math.max(1, Math.round(b / 1024)) + ' kB'; }
    if (b < 1024 * 1024 * 1024) { var m = b / 1048576; return desetinne(m, m < 100 ? 1 : 0) + ' MB'; }
    var g = b / 1073741824;
    return desetinne(g, g < 10 ? 2 : 1) + ' GB';
  }

  /* Údaj, který se nesmí zalomit uprostřed („181 kB“, „2048 × 1365“). */
  function neZalomit(t) { return String(t).replace(/ /g, '\u00a0'); }

  function delkaVidea(s) {
    s = Math.round(Number(s) || 0);
    var m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  function pripona(jmeno) {
    var m = /\.([A-Za-z0-9]{1,6})$/.exec(String(jmeno || ''));
    return m ? m[1].toLowerCase() : '';
  }

  function pauza(ms) { return new Promise(function (hotovo) { setTimeout(hotovo, ms); }); }

  /* Časový limit požadavku podle velikosti — počítá i s pomalým mobilním
     připojením (~16 kB/s), ať se velký kus neutne uprostřed. */
  function limitPozadavku(bajty) { return 60000 + Math.ceil((bajty || 0) / 16); }

  function chyba(text, trvala) { return { chyba: text, trvala: !!trvala, status: -1, odp: {} }; }

  var oznameniCasovac = null;
  /* Hláška pro čtečku obrazovky (aria-live). */
  function oznam(text) {
    var o = $('oznameni');
    o.textContent = '';
    clearTimeout(oznameniCasovac);
    oznameniCasovac = setTimeout(function () { o.textContent = text; }, 80);
  }

  function nastavHlasku(prvek, text, jeChyba) {
    prvek.textContent = text || '';
    prvek.hidden = !text;
    prvek.classList.toggle('is-chyba', !!jeChyba);
  }

  /* Popisek: bez řídicích znaků, oříznutý, nejvýš 300 znaků. */
  function cistyPopis(s) {
    s = String(s == null ? '' : s).replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').trim();
    if (typeof s.toWellFormed === 'function') { s = s.toWellFormed(); }
    var znaky = Array.from ? Array.from(s) : s.split('');
    return znaky.length > 300 ? znaky.slice(0, 300).join('').trim() : s;
  }

  /* =================================================================
     Volání API
     ================================================================= */
  function chybaApi(status, odp, odeslano) {
    var zprava = odp && typeof odp.chyba === 'string' && odp.chyba ? odp.chyba : '';
    if (!zprava) {
      if (status === 0) { zprava = 'Spojení se serverem se přerušilo. Zkontroluj připojení k internetu.'; }
      else if (status === 401) { zprava = 'Nejsi přihlášený.'; }
      else if (status === 403) { zprava = 'Platnost stránky vypršela — načti ji znovu.'; }
      else if (status === 404) { zprava = 'Položka už na serveru není.'; }
      else if (status === 413) { zprava = 'Soubor je na server příliš velký.'; }
      else if (status === 429) { zprava = 'Příliš mnoho pokusů. Zkus to za chvíli.'; }
      else if (status >= 500) { zprava = 'Chyba serveru (HTTP ' + status + '). Zkus to za chvíli znovu.'; }
      else { zprava = 'Server odpověděl nečekaně (HTTP ' + status + ').'; }
    }
    return {
      status: status,
      kod: odp && typeof odp.kod === 'string' ? odp.kod : '',
      chyba: zprava,
      odp: (odp && typeof odp === 'object') ? odp : {},
      odeslano: !!odeslano
    };
  }

  /* Jeden požadavek. telo: undefined = GET, objekt = JSON, FormData = multipart.
     volby: {prubeh(odeslano, celkem), xhr(x) — kvůli zrušení, timeout}. */
  function volej(akce, telo, volby) {
    volby = volby || {};
    return new Promise(function (splnit, odmitnout) {
      var xhr = new XMLHttpRequest();
      var post = telo !== undefined;
      var odeslano = false, data = null;
      xhr.open(post ? 'POST' : 'GET', API + '?akce=' + encodeURIComponent(akce), true);
      xhr.setRequestHeader('Accept', 'application/json');
      if (post) {
        if (stav.csrf) { xhr.setRequestHeader('X-CSRF-Token', stav.csrf); }
        if (telo instanceof FormData) { data = telo; }
        else {
          xhr.setRequestHeader('Content-Type', 'application/json');
          data = JSON.stringify(telo);
        }
        /* Posluchače na upload musí být před send(), jinak se průběh nehlásí. */
        xhr.upload.addEventListener('progress', function (e) {
          if (volby.prubeh && e.lengthComputable && e.total > 0) { volby.prubeh(e.loaded, e.total); }
        });
        xhr.upload.addEventListener('load', function () {
          odeslano = true;
          if (volby.odeslano) { volby.odeslano(); }
        });
      }
      xhr.timeout = volby.timeout || 30000;
      xhr.addEventListener('load', function () {
        var odp = null;
        try { odp = JSON.parse(xhr.responseText); } catch (e) { odp = null; }
        if (xhr.status >= 200 && xhr.status < 300 && odp && odp.ok === true) {
          /* Nový token vrací přihlášení a změna hesla (nová session) — vzít si ho vždy. */
          if (typeof odp.csrf === 'string' && odp.csrf) { stav.csrf = odp.csrf; }
          splnit(odp);
        }
        else { odmitnout(chybaApi(xhr.status, odp, true)); }
      });
      xhr.addEventListener('error', function () { odmitnout(chybaApi(0, null, odeslano)); });
      xhr.addEventListener('timeout', function () {
        odmitnout(chybaApi(0, { chyba: 'Server neodpověděl včas. Zkontroluj připojení a zkus to znovu.' }, odeslano));
      });
      xhr.addEventListener('abort', function () {
        var ch = chybaApi(0, { chyba: 'Zrušeno.' }, odeslano);
        ch.zruseno = true;
        odmitnout(ch);
      });
      if (volby.xhr) { volby.xhr(xhr); }
      xhr.send(data);
    });
  }

  /* Volání s obsluhou přihlášení: 403 (CSRF nesedí — třeba přihlášení v jiném
     okně) → načti čerstvý stav a zkus to jednou znovu; 401 → přihlašovací obrazovka. */
  function api(akce, telo, volby) {
    return volej(akce, telo, volby).catch(function (ch) {
      if (ch.status === 403 && !ch.zruseno) {
        return nactiStav().then(function () {
          if (!stav.prihlasen) { throw chybaApi(401, null, false); }
          return volej(akce, telo, volby);
        }).catch(function (ch2) { return po401(akce, ch2); });
      }
      return po401(akce, ch);
    });
  }
  function po401(akce, ch) {
    if (ch && ch.status === 401 && akce !== 'prihlasit' && akce !== 'zmenit_heslo') { odhlasenZvenku(); }
    throw ch;
  }

  /* =================================================================
     Stav ze serveru
     ================================================================= */
  function normalizujLimity(l) {
    var ven = {};
    Object.keys(VYCHOZI_LIMITY).forEach(function (k) {
      var v = l ? Number(l[k]) : NaN;
      ven[k] = (isFinite(v) && v > 0) ? Math.floor(v) : VYCHOZI_LIMITY[k];
    });
    return ven;
  }

  function normalizujRoky(pole) {
    var videno = {}, ven = [];
    (Array.isArray(pole) ? pole : []).forEach(function (r) {
      r = Number(r);
      if (Math.floor(r) === r && r >= 1900 && r <= 2200 && !videno[r]) { videno[r] = true; ven.push(r); }
    });
    return ven.sort(function (a, b) { return b - a; });
  }

  function cislo(x) { x = Number(x); return isFinite(x) && x > 0 ? x : 0; }

  /* Manifest píše jen API, ale do stránky se z něj bere jen to, co sedí na
     očekávaný tvar — cesty jen "rok/id(_n).přípona". */
  function normalizujPolozku(p) {
    if (!p || typeof p !== 'object') { return null; }
    if (typeof p.id !== 'string' || !RE_ID.test(p.id)) { return null; }
    if (p.typ !== 'foto' && p.typ !== 'video') { return null; }
    if (typeof p.soubor !== 'string' || !RE_CESTA.test(p.soubor)) { return null; }
    return {
      id: p.id,
      typ: p.typ,
      soubor: p.soubor,
      nahled: (typeof p.nahled === 'string' && RE_CESTA.test(p.nahled)) ? p.nahled : '',
      w: Math.round(cislo(p.w)),
      h: Math.round(cislo(p.h)),
      delka: cislo(p.delka),
      velikost: Math.round(cislo(p.velikost)),
      mime: typeof p.mime === 'string' ? p.mime : '',
      popis: typeof p.popis === 'string' ? p.popis : ''
    };
  }

  function normalizujGalerii(g) {
    var ven = { rocniky: {} };
    if (!g || typeof g !== 'object' || !g.rocniky || typeof g.rocniky !== 'object' || Array.isArray(g.rocniky)) {
      return ven;
    }
    Object.keys(g.rocniky).forEach(function (rok) {
      if (!/^\d{4}$/.test(rok) || !Array.isArray(g.rocniky[rok])) { return; }
      var pole = g.rocniky[rok].map(normalizujPolozku).filter(Boolean);
      if (pole.length) { ven.rocniky[rok] = pole; }
    });
    return ven;
  }

  function prevezmiStav(odp) {
    stav.prihlasen = odp.prihlasen === true;
    stav.csrf = stav.prihlasen && typeof odp.csrf === 'string' ? odp.csrf : (stav.prihlasen ? stav.csrf : '');
    stav.hesloNastaveno = odp.heslo_nastaveno !== false;
    stav.roky = normalizujRoky(odp.roky);
    stav.galerie = normalizujGalerii(odp.galerie);
    stav.limity = normalizujLimity(odp.limity);
    stav.zapis = {
      media: !(odp.zapis && odp.zapis.media === false),
      data: !(odp.zapis && odp.zapis.data === false)
    };
    stav.mediaChybi = odp.media_chybi === true;
    stav.manifestPoskozeny = odp.manifest_poskozeny === true;
    stav.obsazeno = isFinite(Number(odp.obsazeno_bajtu)) ? Number(odp.obsazeno_bajtu) : soucetVelikosti();
    stav.rozpracovano = cislo(odp.rozpracovano_bajtu);
  }

  function soucetVelikosti() {
    var s = 0;
    Object.keys(stav.galerie.rocniky).forEach(function (r) {
      stav.galerie.rocniky[r].forEach(function (p) { s += p.velikost || 0; });
    });
    return s;
  }

  function polozkyRoku(rok) { return stav.galerie.rocniky[String(rok)] || []; }

  function indexPolozky(pole, id) {
    for (var i = 0; i < pole.length; i++) { if (pole[i].id === id) { return i; } }
    return -1;
  }

  /* Roky z turnaj.json plus případné roky, které jsou jen v manifestu. */
  function vsechnyRoky() {
    var videno = {}, ven = [];
    stav.roky.concat(Object.keys(stav.galerie.rocniky).map(Number)).forEach(function (r) {
      if (!videno[r]) { videno[r] = true; ven.push(r); }
    });
    return ven.sort(function (a, b) { return b - a; });
  }

  function rokZAdresy() {
    var m = /^#(\d{4})$/.exec(location.hash || '');
    var r = m ? Number(m[1]) : 0;
    return vsechnyRoky().indexOf(r) >= 0 ? r : 0;
  }

  /* GET stav a podle něj přihlášení, nebo správa. */
  function nactiStav() {
    return volej('stav').then(function (odp) {
      var bylaSprava = !$('obr-sprava').hidden;
      prevezmiStav(odp);
      if (!stav.prihlasen) {
        zobrazPrihlaseni(bylaSprava ? hlaskaPoOdhlaseni() : '');
        return;
      }
      zobrazSpravu();
      pumpa();
    });
  }

  function hlaskaPoOdhlaseni() {
    return 'Přihlášení vypršelo — přihlas se znovu.' +
      (probihaNahravani() ? ' Rozpracované nahrávání pak bude pokračovat.' : '');
  }

  /* =================================================================
     Obrazovky
     ================================================================= */
  function zobraz(ktera) {
    $('adm-nacitam').hidden = true;
    ['obr-chyba', 'obr-prihlaseni', 'obr-sprava'].forEach(function (id) { $(id).hidden = id !== ktera; });
  }

  function zobrazPrihlaseni(hlaska, jeOk) {
    zobraz('obr-prihlaseni');
    document.title = 'Přihlášení · Galerie — správa';
    $('bez-hesla').hidden = stav.hesloNastaveno;
    $('prihlaseni-heslo').disabled = !stav.hesloNastaveno;
    $('prihlaseni-tlacitko').disabled = !stav.hesloNastaveno;
    nastavHlasku($('prihlaseni-chyba'), hlaska || '', !jeOk);
    if (stav.hesloNastaveno) { $('prihlaseni-heslo').focus(); }
  }

  function odhlasenZvenku() {
    if (!stav.prihlasen) { return; }
    stav.prihlasen = false;
    stav.csrf = '';
    zobrazPrihlaseni(hlaskaPoOdhlaseni());
  }

  function zobrazSpravu() {
    zobraz('obr-sprava');
    document.title = 'Galerie — správa · Turnaj, který se nikdy nehrál';
    var roky = vsechnyRoky();
    if (roky.indexOf(vybranyRok) < 0) { vybranyRok = rokZAdresy() || roky[0] || null; }
    vykresliVse();
  }

  function vykresliVse() {
    vykresliHlavicku();
    vykresliRoky();
    vykresliNahravani();
    vykresliMrizku();
    vykresliSouhrnFronty();
  }

  /* ---------- hlavička ---------- */
  function vykresliHlavicku() {
    var n = 0;
    Object.keys(stav.galerie.rocniky).forEach(function (r) { n += stav.galerie.rocniky[r].length; });
    var o = $('obsazeno');
    o.textContent = '';
    o.appendChild(document.createTextNode('Obsazeno '));
    o.appendChild(el('b', { text: velikost(stav.obsazeno) }));
    o.appendChild(document.createTextNode(' · ' + pocet(n, 'položka', 'položky', 'položek') + ' v galerii'));
    /* Rozpracovaná videa (i opuštěná) zabírají místo taky — ať je to vidět. */
    if (stav.rozpracovano > 0) {
      o.appendChild(document.createTextNode(' · rozpracovaná videa ' + velikost(stav.rozpracovano)));
    }

    $('odkaz-web').setAttribute('href', '../' + (vybranyRok ? '#' + vybranyRok : ''));

    var v = $('varovani-zapis');
    v.textContent = '';
    if (stav.manifestPoskozeny) {
      v.appendChild(el('div', { class: 'adm-varovani' }, [
        el('p', {}, [el('strong', { text: 'Soubor media/galerie.json je poškozený.' }),
          ' Obnov ho ze zálohy nebo oprav přes FTP. Dokud to nepůjde, nic se neuloží a web ukazuje jen to, co ze souboru jde přečíst.'])
      ]));
    }
    if (stav.mediaChybi) {
      v.appendChild(el('div', { class: 'adm-varovani' }, [
        el('p', {}, [el('strong', { text: 'Na serveru chybí složka media/.' }),
          ' Nahraj na hosting složku golf/media z web/media i se souborem .htaccess (zakazuje v ní skripty) a index.html.'])
      ]));
    } else if (!stav.zapis.media) {
      v.appendChild(el('div', { class: 'adm-varovani' }, [
        el('p', {}, [el('strong', { text: 'Do složky media/ nejde zapisovat.' }),
          ' Nahrávání, přesuny ani mazání nebudou fungovat. Na hostingu nastav složce golf/media práva pro zápis.'])
      ]));
    }
    if (!stav.zapis.data) {
      v.appendChild(el('div', { class: 'adm-varovani' }, [
        el('p', {}, [el('strong', { text: 'Do složky admin/_data/ nejde zapisovat.' }),
          ' Galerie se v ní zamyká při každé změně, takže nepůjde nic uložit, nahrát video ani změnit heslo. ' +
          'Na hostingu nastav složce golf/admin/_data práva pro zápis.'])
      ]));
    }
  }

  /* ---------- výběr roku ---------- */
  function vykresliRoky() {
    var box = $('roky'), roky = vsechnyRoky();
    var stejne = box.children.length === roky.length && roky.every(function (r, i) {
      return box.children[i].getAttribute('data-rok') === String(r);
    });
    if (!stejne) {
      /* Sada roků se změnila — postav tlačítka znovu, fokus zůstane na stejném roce. */
      var fokus = document.activeElement && box.contains(document.activeElement)
        ? document.activeElement.getAttribute('data-rok') : null;
      box.textContent = '';
      roky.forEach(function (rok) {
        var b = el('button', { type: 'button', class: 'adm-rok', 'data-rok': rok }, [
          el('span', { class: 'adm-rok-cislo', text: String(rok) }),
          el('span', { class: 'adm-rok-pocet', 'aria-hidden': 'true' })
        ]);
        b.addEventListener('click', function () { vyberRok(rok); });
        box.appendChild(b);
        if (fokus === String(rok)) { b.focus(); }
      });
    }
    Array.prototype.forEach.call(box.children, function (b) {
      var rok = Number(b.getAttribute('data-rok')), n = polozkyRoku(rok).length;
      b.setAttribute('aria-pressed', String(rok === vybranyRok));
      b.setAttribute('aria-label', rok + ' — ' + pocet(n, 'položka', 'položky', 'položek'));
      b.classList.toggle('is-prazdny', !n);
      b.lastChild.textContent = String(n);
    });
  }

  function vyberRok(rok) {
    if (rok === vybranyRok) { return; }
    vybranyRok = rok;
    try { history.replaceState(null, '', '#' + rok); } catch (e) { /* file:// apod. */ }
    vykresliRoky();
    vykresliHlavicku();
    vykresliNahravani();
    vykresliMrizku();
  }

  /* ---------- nahrávací zóna ---------- */
  function vykresliNahravani() {
    $('nahravani-rok').textContent = vybranyRok || '';
    var lzeNahrat = stav.roky.indexOf(vybranyRok) >= 0;
    $('vybrat').disabled = !lzeNahrat;
    $('zona').classList.toggle('is-vypnuto', !lzeNahrat);
    $('zona-pozn').textContent = lzeNahrat
      ? 'Fotky se před nahráním zmenší (delší strana 2048 px). Videa MP4, MOV, WEBM nebo M4V do ' +
        velikost(stav.limity.max_video_bajtu) + ' — nejjistější je MP4 (H.264).'
      : (vybranyRok
        ? 'Ročník ' + vybranyRok + ' není v turnaj.json, do něj nahrávat nejde. Položky můžeš jen přesunout nebo smazat.'
        : 'V turnaj.json nejsou žádné ročníky, není kam nahrávat.');
  }

  /* =================================================================
     Mřížka položek vybraného roku
     ================================================================= */
  function vykresliMrizku() {
    var rok = vybranyRok, pole = polozkyRoku(rok), ul = $('mrizka');
    $('mrizka-rok').textContent = rok || '';
    var fotek = pole.filter(function (p) { return p.typ === 'foto'; }).length;
    var videi = pole.length - fotek;
    var casti = [];
    if (fotek) { casti.push(pocet(fotek, 'fotka', 'fotky', 'fotek')); }
    if (videi) { casti.push(pocet(videi, 'video', 'videa', 'videí')); }
    $('mrizka-souhrn').textContent = casti.join(' · ');
    var prazdno = $('mrizka-prazdno');
    prazdno.hidden = pole.length > 0;
    prazdno.textContent = stav.manifestPoskozeny
      ? 'V ročníku ' + rok + ' se ze souboru galerie.json nic nepodařilo přečíst — viz varování nahoře.'
      : 'V ročníku ' + rok + ' zatím nejsou žádné fotky ani videa.';

    /* Karty se znovu nestaví, jen se srovná pořadí: přesunutý prvek by
       ztratil fokus i rozepsaný popisek. */
    var roky = vsechnyRoky();
    var chci = pole.map(function (p, i) {
      var k = karta(p);
      aktualizujKartu(k, p, i, pole.length, rok, roky);
      return k.li;
    });
    for (var i = 0; i < chci.length; i++) {
      if (ul.children[i] !== chci[i]) { ul.insertBefore(chci[i], ul.children[i] || null); }
    }
    while (ul.children.length > chci.length) { ul.removeChild(ul.lastChild); }
  }

  function karta(p) {
    if (karty[p.id]) { return karty[p.id]; }
    var k = { id: p.id, rok: null, polozka: p, ulozeny: p.popis, retez: Promise.resolve(), prace: false };
    var idPopisu = 'popis-' + p.id, idStavu = 'popis-stav-' + p.id;

    k.odkaz = el('a', { class: 'adm-nahled', target: '_blank', rel: 'noopener', title: 'Otevřít v plné velikosti' });
    k.znacka = el('span', { class: 'adm-znacka', hidden: true });
    k.poradi = el('span', { class: 'adm-poradi', 'aria-hidden': 'true' });
    k.odkaz.appendChild(k.znacka);
    k.odkaz.appendChild(k.poradi);

    /* Která položka to je („Fotka 3 z 30: popisek“) — ovládací prvky na ni
       odkazují přes aria-describedby, ať čtečka u třicátého „Smazat“ řekne,
       čeho se týká. Skryté jen pro oči. */
    var idKdo = 'kdo-' + p.id;
    k.kdo = el('span', { class: 'adm-vh', id: idKdo });

    k.input = el('input', {
      class: 'adm-input', id: idPopisu, type: 'text', maxlength: 300,
      placeholder: 'Popisek (nepovinný)', autocomplete: 'off', enterkeyhint: 'done',
      'aria-describedby': idKdo + ' ' + idStavu
    });
    k.input.value = p.popis;
    k.stavPopisu = el('span', { class: 'adm-popis-stav', id: idStavu });
    k.meta = el('span', { class: 'adm-meta' });

    k.vlevo = el('button', { type: 'button', class: 'adm-btn adm-sipka', 'aria-label': 'Posunout dřív', title: 'Posunout dřív', text: '◀\uFE0E', 'aria-describedby': idKdo });
    k.vpravo = el('button', { type: 'button', class: 'adm-btn adm-sipka', 'aria-label': 'Posunout později', title: 'Posunout později', text: '▶\uFE0E', 'aria-describedby': idKdo });
    k.presun = el('select', { class: 'adm-select', id: 'presun-' + p.id, 'aria-label': 'Přesunout do jiného ročníku', 'aria-describedby': idKdo });
    k.smazat = el('button', { type: 'button', class: 'adm-btn adm-btn-nebezpeci adm-btn-smazat', text: 'Smazat', 'aria-describedby': idKdo });
    k.akce = el('div', { class: 'adm-akce' }, [k.vlevo, k.vpravo, k.presun]);

    /* Přesun až po potvrzení: šipky na zavřeném <select> (Chrome na Windows)
       mění hodnotu hned, klávesnicí by se tak položka přesunula omylem. */
    k.presunText = el('p', { class: 'adm-potvrzeni-text' });
    k.presunAno = el('button', { type: 'button', class: 'adm-btn adm-btn-plny', text: 'Přesunout' });
    k.presunNe = el('button', { type: 'button', class: 'adm-btn', text: 'Nechat' });
    k.presunPotvrzeni = el('div', { class: 'adm-potvrzeni adm-potvrzeni-presun', role: 'group', 'aria-label': 'Potvrzení přesunu', hidden: true }, [
      k.presunText, k.presunAno, k.presunNe
    ]);

    k.ano = el('button', { type: 'button', class: 'adm-btn adm-btn-nebezpeci-plny', text: 'Ano, smazat' });
    k.ne = el('button', { type: 'button', class: 'adm-btn', text: 'Ne, nechat' });
    k.potvrzeni = el('div', { class: 'adm-potvrzeni adm-potvrzeni-smazani', role: 'group', 'aria-label': 'Potvrzení smazání', hidden: true }, [
      el('p', { class: 'adm-potvrzeni-text', text: 'Smazat natrvalo? Zmizí i z webu.' }), k.ano, k.ne
    ]);

    k.li = el('li', { class: 'adm-karta' }, [
      k.odkaz,
      el('div', { class: 'adm-karta-telo' }, [
        el('div', { class: 'adm-popis-obal' }, [
          el('label', { class: 'adm-vh', for: idPopisu, text: 'Popisek' }),
          k.kdo,
          k.input,
          k.stavPopisu
        ]),
        k.akce,
        k.presunPotvrzeni,
        el('div', { class: 'adm-karta-pata' }, [k.meta, k.smazat]),
        k.potvrzeni
      ])
    ]);

    /* Popisek: Enter a opuštění pole uloží. Bez <form>, takže Enter nic jiného nespustí. */
    k.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        ulozPopis(k);
      } else if (e.key === 'Escape' && k.input.value !== k.ulozeny) {
        e.preventDefault();
        k.input.value = k.ulozeny;
        stavPopisu(k, 'Úprava vrácena.', '');
      }
    });
    k.input.addEventListener('blur', function () { ulozPopis(k); });
    k.input.addEventListener('input', function () {
      stavPopisu(k, cistyPopis(k.input.value) !== k.ulozeny ? 'Neuloženo — Enter uloží' : '', '');
    });

    k.vlevo.addEventListener('click', function () { posun(k, -1); });
    k.vpravo.addEventListener('click', function () { posun(k, 1); });
    k.presun.addEventListener('change', function () {
      var novy = Number(k.presun.value);
      k.presunPotvrzeni.hidden = !novy;
      if (novy) {
        k.presunText.textContent = 'Přesunout do ročníku ' + novy + '? Na webu bude na konci.';
        /* Potvrzení se objeví pod výběrem, fokus zůstává na něm — čtečce to říct. */
        oznam('Přesunout do ročníku ' + novy + '? Potvrď tlačítkem Přesunout pod výběrem, Esc to zruší.');
      }
    });
    /* Esc na výběru zavře rozpracovaný přesun (šipky na zavřeném <select> ho
       v Chromu a Firefoxu otevřou hned a fokus zůstane tady). */
    k.presun.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.key === 'Esc') && !k.presunPotvrzeni.hidden) {
        e.preventDefault();
        zavriPresun(k, true);
        oznam('Přesun zrušen.');
      }
    });
    k.presunAno.addEventListener('click', function () {
      var novy = Number(k.presun.value);
      if (novy) { presun(k, novy); }
    });
    k.presunNe.addEventListener('click', function () { zavriPresun(k, true); });
    k.presunPotvrzeni.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); zavriPresun(k, true); }
    });
    k.smazat.addEventListener('click', function () {
      if (k.prace) { return; }
      k.potvrzeni.hidden = false;
      k.ne.focus();
    });
    k.ne.addEventListener('click', function () { zavriPotvrzeni(k, true); });
    k.potvrzeni.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); zavriPotvrzeni(k, true); }
    });
    k.ano.addEventListener('click', function () { smaz(k); });

    karty[p.id] = k;
    return k;
  }

  function aktualizujKartu(k, p, i, celkem, rok, roky) {
    k.polozka = p;
    k.rok = rok;
    k.li.setAttribute('data-id', p.id);

    var src = p.nahled ? MEDIA + p.nahled : '';
    if (k.src !== src || !k.obsahNahledu) {
      k.src = src;
      if (k.obsahNahledu) { k.odkaz.removeChild(k.obsahNahledu); }
      if (src) {
        k.img = el('img', { src: src, alt: '', loading: 'lazy', decoding: 'async' });
        if (p.w && p.h) { k.img.width = p.w; k.img.height = p.h; }
        k.obsahNahledu = k.img;
      } else {
        k.img = null;
        k.obsahNahledu = el('span', { class: 'adm-nahled-bez', text: p.typ === 'video' ? 'Video bez náhledu' : 'Bez náhledu' });
      }
      k.odkaz.insertBefore(k.obsahNahledu, k.odkaz.firstChild);
    }
    k.odkaz.setAttribute('href', MEDIA + p.soubor);
    popisNahledu(k, i);
    k.poradi.textContent = String(i + 1);

    if (p.typ === 'video') {
      k.znacka.hidden = false;
      k.znacka.textContent = '▶\uFE0E ' + (p.delka > 0 ? delkaVidea(p.delka) : 'video');
    } else {
      k.znacka.hidden = true;
    }
    var meta = [p.typ === 'video' ? 'Video' : 'Fotka'];
    if (p.w && p.h) { meta.push(p.w + ' × ' + p.h); }
    if (p.velikost) { meta.push(velikost(p.velikost)); }
    /* Uvnitř údaje nezalamovat („3,3 MB“ ne „3,3 / MB“), jen mezi údaji. */
    k.meta.textContent = meta.map(neZalomit).join(' · ');

    /* Rozepsaný popisek (fokus nebo neuložená změna) se nepřepisuje. */
    var rozepsano = document.activeElement === k.input || cistyPopis(k.input.value) !== k.ulozeny;
    k.ulozeny = p.popis;
    if (!rozepsano) { k.input.value = p.popis; }

    k.vlevo.disabled = i === 0;
    k.vpravo.disabled = i === celkem - 1;

    var klic = rok + '|' + roky.join(',');
    if (k.klicVyberu !== klic) {
      k.klicVyberu = klic;
      k.presun.textContent = '';
      /* Krátce — v kartě vedle šipek se delší text useknul. */
      k.presun.appendChild(el('option', { value: '', text: 'Přesunout…' }));
      roky.forEach(function (r) {
        if (r !== rok && stav.roky.indexOf(r) >= 0) { k.presun.appendChild(el('option', { value: r, text: 'Ročník ' + r })); }
      });
      k.presunPotvrzeni.hidden = true;
    }
    /* Rozpracovaný přesun (otevřené potvrzení) nechat být. */
    if (k.presunPotvrzeni.hidden) { k.presun.value = ''; }
    k.presun.disabled = k.presun.options.length < 2;
  }

  function popisNahledu(k, i) {
    var p = k.polozka;
    var druh = p.typ === 'video' ? 'Video ' : 'Fotka ';
    var text = p.popis || (druh + (i + 1));
    if (k.img) { k.img.alt = text; }
    k.odkaz.setAttribute('aria-label', 'Otevřít v plné velikosti: ' + text);
    var celkem = polozkyRoku(k.rok).length;
    k.kdo.textContent = druh + (i + 1) + (celkem ? ' z ' + celkem : '') + (p.popis ? ': ' + p.popis : '');
  }

  function stavPopisu(k, text, druh) {
    k.stavPopisu.textContent = text || '';
    k.stavPopisu.classList.toggle('is-ok', druh === 'ok');
    k.stavPopisu.classList.toggle('is-chyba', druh === 'chyba');
    clearTimeout(k.stavCasovac);
    if (druh === 'ok') {
      k.stavCasovac = setTimeout(function () {
        if (k.stavPopisu.textContent === text) { stavPopisu(k, '', ''); }
      }, 3000);
    }
  }

  function prace(k, zapnout) {
    k.prace = zapnout;
    k.li.classList.toggle('is-prace', zapnout);
    if (zapnout) { k.li.setAttribute('aria-busy', 'true'); } else { k.li.removeAttribute('aria-busy'); }
  }

  function zavriPotvrzeni(k, fokus) {
    k.potvrzeni.hidden = true;
    if (fokus) { k.smazat.focus(); }
  }

  function zavriPresun(k, fokus) {
    k.presun.value = '';
    k.presunPotvrzeni.hidden = true;
    if (fokus) { k.presun.focus(); }
  }

  /* Úpravy manifestu jdou po jedné — pořadí posílá celý seznam id a souběžné
     smazání by ho rozbilo. */
  var retezUprav = Promise.resolve();
  function postupne(fn) {
    var p = retezUprav.then(fn);
    retezUprav = p.catch(function () {});
    return p;
  }

  /* Nepovedená úprava: hláška u karty a srovnání se serverem (galerie se
     mohla mezitím změnit jinde). */
  function chybaUpravy(k, ch, co) {
    if (ch.status === 401) { return; }
    stavPopisu(k, co + ': ' + ch.chyba, 'chyba');
    oznam(co + ': ' + ch.chyba);
    if (ch.status === 400 || ch.status === 404 || ch.status === 409) {
      nactiStav().catch(function () {});
    }
  }

  function ulozPopis(k) {
    k.retez = k.retez.then(function () {
      if (!karty[k.id] || !stav.prihlasen) { return; }
      var hodnota = cistyPopis(k.input.value);
      if (hodnota === k.ulozeny) {
        if (document.activeElement !== k.input) { k.input.value = hodnota; }
        if (k.stavPopisu.classList.contains('is-chyba') || /^Neuloženo/.test(k.stavPopisu.textContent)) { stavPopisu(k, '', ''); }
        return;
      }
      stavPopisu(k, 'Ukládám…', '');
      return api('upravit', { rok: k.rok, id: k.id, popis: hodnota }).then(function (odp) {
        var pol = odp.polozka && typeof odp.polozka.popis === 'string' ? odp.polozka.popis : hodnota;
        k.ulozeny = pol;
        k.polozka.popis = pol;
        if (cistyPopis(k.input.value) === hodnota) { k.input.value = pol; }
        popisNahledu(k, indexPolozky(polozkyRoku(k.rok), k.id));
        stavPopisu(k, 'Uloženo ✓', 'ok');
        oznam('Popisek uložen.');
      }, function (ch) {
        if (ch.status === 401) { stavPopisu(k, 'Neuloženo — po přihlášení zmáčkni Enter.', 'chyba'); return; }
        stavPopisu(k, 'Neuloženo: ' + ch.chyba, 'chyba');
        oznam('Popisek se nepodařilo uložit: ' + ch.chyba);
      });
    });
    return k.retez;
  }

  function posun(k, smer) {
    if (k.prace) { return; }
    prace(k, true);
    postupne(function () {
      var rok = k.rok, pole = polozkyRoku(rok), i = indexPolozky(pole, k.id), j = i + smer;
      if (i < 0 || j < 0 || j >= pole.length) { return; }
      var ids = pole.map(function (p) { return p.id; });
      ids.splice(i, 1);
      ids.splice(j, 0, k.id);
      return api('poradi', { rok: rok, ids: ids }).then(function () {
        var podleId = {};
        polozkyRoku(rok).forEach(function (p) { podleId[p.id] = p; });
        stav.galerie.rocniky[String(rok)] = ids.map(function (id) { return podleId[id]; }).filter(Boolean);
        if (rok === vybranyRok) { vykresliMrizku(); }
        var tl = smer < 0 ? k.vlevo : k.vpravo;
        if (tl.disabled) { tl = smer < 0 ? k.vpravo : k.vlevo; }
        if (!tl.disabled) { tl.focus(); }
        oznam('Posunuto na ' + (j + 1) + '. místo z ' + pole.length + '.');
      }, function (ch) { chybaUpravy(k, ch, 'Pořadí se nepodařilo změnit'); });
    }).then(function () { prace(k, false); });
  }

  function presun(k, novyRok) {
    if (k.prace) { return; }
    prace(k, true);
    postupne(function () {
      var rok = k.rok;
      return api('presunout', { rok: rok, id: k.id, novy_rok: novyRok }).then(function (odp) {
        var stare = polozkyRoku(rok), i = indexPolozky(stare, k.id);
        var puvodni = i >= 0 ? stare.splice(i, 1)[0] : k.polozka;
        if (!stare.length) { delete stav.galerie.rocniky[String(rok)]; }
        var nova = normalizujPolozku(odp.polozka);
        if (!nova) {
          /* API polozku nevrátilo — cesty jsou vždy "rok/id…", stačí vyměnit rok. */
          nova = JSON.parse(JSON.stringify(puvodni));
          nova.soubor = novyRok + nova.soubor.slice(4);
          if (nova.nahled) { nova.nahled = novyRok + nova.nahled.slice(4); }
        }
        var cil = stav.galerie.rocniky[String(novyRok)] || (stav.galerie.rocniky[String(novyRok)] = []);
        if (indexPolozky(cil, nova.id) < 0) { cil.push(nova); }
        k.polozka = nova;
        zavriPresun(k, false);
        var dalsi = stare[i] || stare[i - 1];
        vykresliRoky();
        vykresliHlavicku();
        vykresliMrizku();
        fokusPoOdebrani(dalsi);
        oznam('Přesunuto do ročníku ' + novyRok + '.');
      }, function (ch) {
        zavriPresun(k, false);
        chybaUpravy(k, ch, 'Přesun se nepovedl');
      });
    }).then(function () { prace(k, false); });
  }

  function smaz(k) {
    if (k.prace) { return; }
    prace(k, true);
    postupne(function () {
      var rok = k.rok;
      return api('smazat', { rok: rok, id: k.id }).then(function (odp) {
        /* Z webu zmizela, ale soubor na disku zůstal (práva) — správce to musí vědět. */
        nastavHlasku($('mrizka-varovani'), typeof odp.varovani === 'string' ? odp.varovani : '', true);
        var pole = polozkyRoku(rok), i = indexPolozky(pole, k.id);
        if (i >= 0) {
          stav.obsazeno = Math.max(0, stav.obsazeno - (pole[i].velikost || 0));
          pole.splice(i, 1);
        }
        if (!pole.length) { delete stav.galerie.rocniky[String(rok)]; }
        delete karty[k.id];
        var dalsi = pole[i] || pole[i - 1];
        vykresliRoky();
        vykresliHlavicku();
        vykresliMrizku();
        fokusPoOdebrani(dalsi);
        oznam(typeof odp.varovani === 'string' ? 'Smazáno. ' + odp.varovani : 'Smazáno.');
      }, function (ch) {
        zavriPotvrzeni(k, false);
        chybaUpravy(k, ch, 'Smazání se nepovedlo');
      });
    }).then(function () { prace(k, false); });
  }

  function fokusPoOdebrani(dalsi) {
    if (dalsi && karty[dalsi.id] && karty[dalsi.id].li.parentNode) { karty[dalsi.id].odkaz.focus(); }
    else { $('mrizka-nadpis').focus(); }
  }

  function pridejDoGalerie(rok, pol) {
    var pole = stav.galerie.rocniky[String(rok)] || (stav.galerie.rocniky[String(rok)] = []);
    if (indexPolozky(pole, pol.id) < 0) {
      pole.push(pol);
      stav.obsazeno += pol.velikost || 0;
    }
    vykresliRoky();
    vykresliHlavicku();
    if (rok === vybranyRok) { vykresliMrizku(); }
  }

  /* =================================================================
     Fronta nahrávání
     ================================================================= */
  var BEZI = { ceka: 1, zpracovavam: 1, pripraveno: 1, ctu: 1, nahravam: 1, dokoncuji: 1 };

  function probihaNahravani() {
    return fronta.some(function (p) { return !p.zruseno && BEZI[p.stav]; });
  }

  function druhSouboru(f) {
    var ext = pripona(f.name), typ = String(f.type || '').toLowerCase();
    if (PRIPONY_VIDEA.indexOf(ext) >= 0 || typ.indexOf('video/') === 0) { return 'video'; }
    if (typ.indexOf('image/') === 0 || PRIPONY_FOTEK.test(ext)) { return 'foto'; }
    return '';
  }

  function pridejSoubory(seznam) {
    if (!stav.prihlasen || !seznam || !seznam.length) { return; }
    var rok = vybranyRok;
    if (stav.roky.indexOf(rok) < 0) {
      oznam('Do ročníku ' + rok + ' nahrávat nejde.');
      return;
    }
    Array.prototype.forEach.call(seznam, function (f) {
      var p = { cislo: ++cisloPolozky, soubor: f, typ: druhSouboru(f), rok: rok, stav: 'ceka', procenta: 0 };
      vyrobRadek(p);
      fronta.push(p);
      $('fronta').appendChild(p.li);
      var ext = pripona(f.name);
      if (!p.typ) {
        nastavChybu(p, 'Tohle není fotka ani video.', true);
      } else if (p.typ === 'video' && PRIPONY_VIDEA.indexOf(ext) < 0) {
        nastavChybu(p, 'Tenhle formát videa nejde nahrát — použij MP4, MOV, WEBM nebo M4V.', true);
      } else if (!f.size) {
        nastavChybu(p, 'Soubor je prázdný.', true);
      } else if (p.typ === 'video' && f.size > stav.limity.max_video_bajtu) {
        nastavChybu(p, 'Video je moc velké (' + velikost(f.size) + '), limit je ' + velikost(stav.limity.max_video_bajtu) + '.', true);
      } else {
        nastavStav(p, 'ceka');
      }
    });
    $('fronta-obal').hidden = false;
    oznam('Přidáno do fronty: ' + pocet(seznam.length, 'soubor', 'soubory', 'souborů') + '.');
    pumpa();
  }

  function vyrobRadek(p) {
    p.nahledEl = el('div', { class: 'adm-fronta-nahled', 'aria-hidden': 'true', text: p.typ === 'video' ? '▶\uFE0E' : '▢' });
    p.detailEl = el('span', { class: 'adm-fronta-detail', text: neZalomit(velikost(p.soubor.size)) + ' → ' + p.rok });
    p.stavEl = el('span', { class: 'adm-fronta-stav' });
    p.znovuEl = el('button', { type: 'button', class: 'adm-btn adm-btn-maly', text: 'Zkusit znovu', hidden: true });
    p.zrusitEl = el('button', { type: 'button', class: 'adm-btn adm-btn-maly', text: 'Zrušit' });
    p.pruhHodnota = el('div', { class: 'adm-pruh-hodnota' });
    p.pruh = el('div', { class: 'adm-pruh', 'aria-hidden': 'true', hidden: true }, [p.pruhHodnota]);
    p.upozorneniEl = el('p', { class: 'adm-fronta-upozorneni', hidden: true });
    p.li = el('li', { class: 'adm-polozka-fronty' }, [
      p.nahledEl,
      el('div', { class: 'adm-fronta-info' }, [
        el('span', { class: 'adm-fronta-jmeno', text: p.soubor.name || 'bez názvu' }),
        p.detailEl
      ]),
      el('div', { class: 'adm-fronta-stav-radek' }, [
        p.stavEl,
        el('div', { class: 'adm-fronta-akce' }, [p.znovuEl, p.zrusitEl])
      ]),
      p.pruh,
      p.upozorneniEl
    ]);
    p.znovuEl.addEventListener('click', function () { zkusZnovu(p); });
    p.zrusitEl.addEventListener('click', function () { zrusPolozku(p); });
  }

  var TEXT_STAVU = {
    ceka: 'Čeká', zpracovavam: 'Zpracovávám', pripraveno: 'Připraveno k nahrání', ctu: 'Čtu video',
    nahravam: 'Nahrávám', dokoncuji: 'Dokončuji', hotovo: 'Hotovo', chyba: 'Chyba'
  };

  function nastavStav(p, s, poznamka) {
    p.stav = s;
    if (s !== 'chyba') { p.chyba = ''; }
    p.poznamka = poznamka || '';
    vykresliRadek(p);
    vykresliSouhrnFronty();
  }

  function nastavChybu(p, text, trvala) {
    p.stav = 'chyba';
    p.chyba = text || 'Neznámá chyba.';
    p.trvala = !!trvala;
    vykresliRadek(p);
    vykresliSouhrnFronty();
    oznam('Chyba — ' + (p.soubor.name || 'soubor') + ': ' + p.chyba);
  }

  function nastavProcenta(p, pct) {
    p.procenta = Math.max(0, Math.min(100, pct));
    if (p.stav === 'nahravam') { vykresliRadek(p); }
  }

  function vykresliRadek(p) {
    var t = TEXT_STAVU[p.stav] || p.stav;
    /* 100 % až po potvrzení serverem — prohlížeč hlásí odeslání do vyrovnávací
       paměti, server může data ještě chvíli přijímat. */
    if (p.stav === 'nahravam') { t += ' ' + Math.min(99, Math.floor(p.procenta)) + '\u00a0%'; }
    else if (p.stav === 'chyba') { t += ': ' + p.chyba; }
    if (p.poznamka) { t = p.poznamka; }
    p.stavEl.textContent = t;
    p.li.classList.toggle('is-hotovo', p.stav === 'hotovo');
    p.li.classList.toggle('is-chyba', p.stav === 'chyba');
    p.znovuEl.hidden = !(p.stav === 'chyba' && !p.trvala);
    p.zrusitEl.hidden = p.stav === 'hotovo';
    p.zrusitEl.textContent = p.stav === 'chyba' ? 'Odebrat' : 'Zrušit';
    var pruh = p.stav === 'nahravam' || p.stav === 'dokoncuji';
    p.pruh.hidden = !pruh;
    if (pruh) { p.pruhHodnota.style.width = (p.stav === 'dokoncuji' ? 100 : p.procenta) + '%'; }
  }

  function upozorni(p, text) {
    p.upozorneniEl.textContent = text;
    p.upozorneniEl.hidden = !text;
  }

  function nahledRadku(p, blob) {
    if (!blob) { return; }
    if (p.nahledUrl) { URL.revokeObjectURL(p.nahledUrl); }
    p.nahledUrl = URL.createObjectURL(blob);
    p.nahledEl.textContent = '';
    p.nahledEl.appendChild(el('img', { src: p.nahledUrl, alt: '' }));
  }

  function vykresliSouhrnFronty() {
    var zive = fronta.filter(function (p) { return !p.zruseno; });
    var hotovo = zive.filter(function (p) { return p.stav === 'hotovo'; }).length;
    var chyb = zive.filter(function (p) { return p.stav === 'chyba'; }).length;
    $('fronta-obal').hidden = !zive.length;
    var t = 'Hotovo ' + hotovo + ' z ' + zive.length;
    if (chyb) { t += ' · ' + pocet(chyb, 'chyba', 'chyby', 'chyb'); }
    $('fronta-souhrn').textContent = t;
    $('fronta-vycistit').hidden = !hotovo;

    var bezi = probihaNahravani();
    if (frontaBezela && !bezi) {
      oznam('Nahrávání skončilo: ' + pocet(hotovo, 'soubor hotový', 'soubory hotové', 'souborů hotových') +
        (chyb ? ', ' + pocet(chyb, 'chyba', 'chyby', 'chyb') : '') + '.');
    }
    frontaBezela = bezi;
  }

  function odeberRadek(p) {
    p.zruseno = true;
    if (p.nahledUrl) { URL.revokeObjectURL(p.nahledUrl); p.nahledUrl = null; }
    p.velka = p.nahled = null;
    if (p.li.parentNode) { p.li.parentNode.removeChild(p.li); }
    fronta = fronta.filter(function (x) { return x !== p; });
  }

  function zrusPolozku(p) {
    var nahravani = p.nahravani;
    /* Požadavek, který už celý odešel (fotka, dokončení videa), server dokončí
       i bez nás — ten se nechá doběhnout a uložená položka se pak smaže
       (uklidZrusene). Utržený požadavek server zahodí sám. */
    var dobehne = !!p.xhr && (p.stav === 'dokoncuji' || (p.typ === 'foto' && p.stav === 'nahravam' && p.odeslanoVse));
    odeberRadek(p);
    if (p.xhr && !dobehne) { try { p.xhr.abort(); } catch (e) { /* nic */ } }
    if (nahravani && !dobehne && stav.prihlasen) { api('video_zrusit', { nahravani: nahravani }).catch(function () {}); }
    vykresliSouhrnFronty();
    $('vybrat').focus();
    pumpa();
  }

  /* Zrušená položka, kterou server i tak uložil: smazat ji, ať zrušení platí.
     Když smazání nevyjde, ukázat ji v mřížce — stránka nesmí mít jiný obsah než server. */
  function uklidZrusene(rok, pol) {
    if (!pol) { nactiStav().catch(function () {}); return; }
    api('smazat', { rok: rok, id: pol.id }).then(function () {
      oznam('Zrušeno.');
    }, function () {
      pridejDoGalerie(rok, pol);
    });
  }

  function zkusZnovu(p) {
    if (p.stav !== 'chyba') { return; }
    nastavStav(p, p.typ === 'foto' && p.velka ? 'pripraveno' : 'ceka');
    p.zrusitEl.focus();     /* „Zkusit znovu“ právě zmizelo — fokus na „Zrušit“ ve stejném řádku */
    pumpa();
  }

  /* Plánovač: fotky se zpracovávají po jedné (dekódování velké fotky zabere
     hodně paměti), nahrávají se po třech; video jde vždy jen jedno. */
  function pumpa() {
    if (!stav.prihlasen) { return; }
    var pripraveno = 0, nahrava = 0, videa = 0;
    fronta.forEach(function (p) {
      if (p.zruseno) { return; }
      if (p.typ === 'foto') {
        if (p.stav === 'pripraveno') { pripraveno++; }
        else if (p.stav === 'nahravam') { nahrava++; }
      } else if (p.stav === 'ctu' || p.stav === 'nahravam' || p.stav === 'dokoncuji') { videa++; }
    });
    fronta.slice().forEach(function (p) {
      if (p.zruseno || p.typ !== 'foto' || p.stav !== 'pripraveno') { return; }
      if (nahrava < SOUBEZNE_FOTKY) { nahrava++; pripraveno--; nahrajFotku(p); }
    });
    /* Počítadlo, ne stav řádků: zrušená fotka se může ještě chvíli dekódovat. */
    if (!zpracovavaSe && pripraveno < ZASOBA_FOTEK) {
      var dalsi = fronta.filter(function (p) { return !p.zruseno && p.typ === 'foto' && p.stav === 'ceka'; })[0];
      if (dalsi) { zpracuj(dalsi); }
    }
    if (!videa) {
      var video = fronta.filter(function (p) { return !p.zruseno && p.typ === 'video' && p.stav === 'ceka'; })[0];
      if (video) { nahrajVideo(video); }
    }
    vykresliSouhrnFronty();
  }

  /* ---------- fotky ---------- */
  function zpracuj(p) {
    nastavStav(p, 'zpracovavam');
    zpracovavaSe++;
    /* Přes then: i chyba vyhozená hned (nestandardní createImageBitmap, polyfill)
       skončí v catch níž — jinak by počítadlo zůstalo viset a fronta stála. */
    Promise.resolve().then(function () {
      return zpracujFotku(p.soubor, stav.limity);
    }).then(function (v) {
      if (p.zruseno) { return; }
      nahledRadku(p, v.nahled);
      p.detailEl.textContent = neZalomit(velikost(p.soubor.size)) + ' → ' + neZalomit(v.w + ' × ' + v.h) + ', ' +
        neZalomit(velikost(v.velka.size)) + ' → ' + p.rok;
      if (v.velka.size > stav.limity.max_foto_bajtu) {
        throw chyba('Fotka je i po zmenšení moc velká (' + velikost(v.velka.size) + ').', true);
      }
      if (v.nahled.size > stav.limity.max_nahled_bajtu) {
        throw chyba('Náhled fotky vyšel moc velký (' + velikost(v.nahled.size) + ').', true);
      }
      p.velka = v.velka;
      p.nahled = v.nahled;
      nastavStav(p, 'pripraveno');
    }).catch(function (ch) {
      if (p.zruseno) { return; }
      nastavChybu(p, (ch && ch.chyba) || 'Fotku se nepodařilo zpracovat.', ch && ch.trvala);
    }).then(function () {
      zpracovavaSe--;
      pumpa();
    });
  }

  function nahrajFotku(p) {
    nastavStav(p, 'nahravam');
    nastavProcenta(p, 0);
    var fd = new FormData();
    fd.append('rok', String(p.rok));
    fd.append('soubor', p.velka, 'foto.jpg');
    fd.append('nahled', p.nahled, 'nahled.jpg');
    var pokus = 0;
    var volby = {
      timeout: limitPozadavku(p.velka.size + p.nahled.size),
      xhr: function (x) { p.xhr = x; p.odeslanoVse = false; },
      odeslano: function () { p.odeslanoVse = true; },
      prubeh: function (a, b) { nastavProcenta(p, a / b * 100); }
    };
    function jednou() {
      pokus++;
      return api('foto', fd, volby).catch(function (ch) {
        /* Když se tělo požadavku neodeslalo celé, server fotku uložit nemohl —
           opakování nehrozí zdvojením. */
        if (!ch.zruseno && !p.zruseno && ch.status === 0 && !ch.odeslano && pokus < POKUSY && stav.prihlasen) {
          return pauza(PAUZY[pokus - 1]).then(jednou);
        }
        throw ch;
      });
    }
    jednou().then(function (odp) {
      p.xhr = null;
      var pol = normalizujPolozku(odp.polozka);
      if (p.zruseno) { uklidZrusene(p.rok, pol); return; }
      p.velka = p.nahled = null;
      nastavStav(p, 'hotovo');
      if (pol) { pridejDoGalerie(p.rok, pol); } else { nactiStav().catch(function () {}); }
    }, function (ch) {
      p.xhr = null;
      if (p.zruseno) { return; }
      if (ch.status === 401) { nastavStav(p, 'pripraveno', 'Čeká na přihlášení'); return; }
      nastavChybu(p, ch.chyba, ch.status === 413);
    }).then(pumpa);
  }

  /* ---------- videa ---------- */
  function nahrajVideo(p) {
    if (p.bezi) { return; }
    p.bezi = true;
    var pripraveno;
    if (p.meta) {
      /* Stav hned (ne až po video_zacatek): pumpa, kterou mezitím spustí třeba
         přidaná fotka, jinak řádek vidí jako čekající a pustí druhé nahrávání. */
      nastavStav(p, 'nahravam');
      nastavProcenta(p, p.offset && p.soubor.size ? p.offset / p.soubor.size * 100 : 0);
      pripraveno = Promise.resolve(p.meta);
    } else {
      nastavStav(p, 'ctu');
      pripraveno = ctiVideo(p.soubor);
    }
    pripraveno.then(function (meta) {
      if (p.zruseno) { throw { zruseno: true }; }
      if (!p.meta) {
        p.meta = meta;
        nahledRadku(p, meta.plakat);
        if (!meta.precteno) { upozorni(p, HLASKA_VIDEO); }
        else if (!meta.plakat) { upozorni(p, 'Náhled videa se nepodařilo vytvořit — na webu bude bez obrázku.'); }
        if (meta.w && meta.h) {
          p.detailEl.textContent = neZalomit(velikost(p.soubor.size)) + ' · ' + neZalomit(meta.w + ' × ' + meta.h) +
            (meta.delka ? ' · ' + delkaVidea(meta.delka) : '') + ' → ' + p.rok;
        }
      }
      return zahajVideo(p);
    }).then(function () {
      return kusyADokonceni(p, 0);
    }).then(function (odp) {
      p.xhr = null;
      var pol = normalizujPolozku(odp.polozka);
      if (p.zruseno) { uklidZrusene(p.rok, pol); return; }
      p.nahravani = '';
      nastavStav(p, 'hotovo');
      if (pol) { pridejDoGalerie(p.rok, pol); } else { nactiStav().catch(function () {}); }
    }).catch(function (ch) {
      p.xhr = null;
      if (p.zruseno || (ch && ch.zruseno)) { return; }
      ch = ch && ch.chyba ? ch : chyba('Video se nepodařilo nahrát.');
      if (ch.status === 401) { nastavStav(p, 'ceka', 'Čeká na přihlášení'); return; }
      if ((ch.faze === 'kus' || ch.faze === 'konec') && ch.status === 404) {
        /* Rozpracované nahrávání server zahodil (po 24 h) a v galerii video
           není — „Zkusit znovu“ začne od začátku. */
        p.nahravani = '';
        p.offset = 0;
        ch.chyba += ' Zkusit znovu začne od začátku.';
      }
      /* Špatný formát server nahrávání rovnou zahodí — opakovat nemá smysl. */
      nastavChybu(p, ch.chyba, ch.trvala || ch.status === 413 || ch.kod === 'spatny_format');
    }).then(function () {
      p.bezi = false;
      pumpa();
    });
  }

  /* Kusy a dokončení. Když server při dokončení řekne 409 (video není celé,
     „prijato“ je menší než velikost), pošlou se chybějící kusy a dokončí se znovu. */
  function kusyADokonceni(p, kolikrat) {
    return posilejKusy(p).then(function () {
      return dokonciVideo(p);
    }).catch(function (ch) {
      var prijato = Number(ch && ch.odp && ch.odp.prijato);
      if (ch && ch.faze === 'konec' && ch.status === 409 && isFinite(prijato) && prijato >= 0 &&
          prijato < p.soubor.size && Math.floor(prijato) === prijato && kolikrat < 2 && !p.zruseno) {
        p.offset = prijato;
        return kusyADokonceni(p, kolikrat + 1);
      }
      throw ch;
    });
  }

  function zahajVideo(p) {
    if (p.nahravani) { return Promise.resolve(); }
    return api('video_zacatek', {
      rok: p.rok, nazev: p.soubor.name, velikost: p.soubor.size, typ: p.soubor.type || ''
    }).then(function (odp) {
      if (typeof odp.nahravani !== 'string' || !RE_NAHRAVANI.test(odp.nahravani)) {
        throw chyba('Server nevrátil číslo nahrávání.');
      }
      /* Zrušeno, zatímco server nahrávání zakládal — ať po něm nic nezůstane. */
      if (p.zruseno) {
        if (stav.prihlasen) { api('video_zrusit', { nahravani: odp.nahravani }).catch(function () {}); }
        throw { zruseno: true };
      }
      p.nahravani = odp.nahravani;
      p.kus = Number(odp.kus_bajtu) > 0 ? Math.floor(Number(odp.kus_bajtu)) : stav.limity.kus_bajtu;
      p.offset = 0;
    });
  }

  /* Kusy jdou za sebou. Každý až třikrát s rostoucí pauzou. Na 409 server
     říká, kolik už má (třeba když se ztratila odpověď na předchozí kus) —
     pokračuje se od toho místa. */
  function posilejKusy(p) {
    var celkem = p.soubor.size, pokus = 0, konflikty = 0;
    nastavStav(p, 'nahravam');
    nastavProcenta(p, p.offset / celkem * 100);
    function platny(x) { return typeof x === 'number' && isFinite(x) && x >= 0 && x <= celkem && Math.floor(x) === x; }
    function dalsi() {
      if (p.zruseno) { return Promise.reject({ zruseno: true }); }
      if (p.offset >= celkem) { return Promise.resolve(); }
      var od = p.offset, konec = Math.min(od + p.kus, celkem);
      /* Kus se nejdřív načte do paměti (nejvýš kus_bajtu). Výřez souboru
         (File.slice) přímo ve FormData umí prohlížeč poslat chybně — WebKit na
         Windows posílá bajty z jiného místa — a soubor, který mezitím přestal
         být čitelný (smazaný, na iPhonu zneplatněný výběr z Fotek), se tak
         pozná hned, ne až jako vadné video na serveru. */
      return precti(p.soubor.slice(od, konec)).then(function (data) {
        if (!data || data.byteLength !== konec - od) { throw new Error('krátké čtení'); }
        return data;
      }).then(null, function () {
        throw chyba('Soubor s videem už nejde přečíst — vyber ho prosím znovu.', true);
      }).then(function (data) {
        if (p.zruseno) { throw { zruseno: true }; }
        return posliKus(od, new Blob([data], { type: 'application/octet-stream' }));
      });
    }
    function posliKus(od, kus) {
      var fd = new FormData();
      fd.append('nahravani', p.nahravani);
      fd.append('offset', String(od));
      fd.append('kus', kus, 'kus.bin');
      pokus++;
      return api('video_kus', fd, {
        timeout: limitPozadavku(kus.size),
        xhr: function (x) { p.xhr = x; },
        prubeh: function (a, b) { nastavProcenta(p, (od + kus.size * a / b) / celkem * 100); }
      }).then(function (odp) {
        pokus = 0;
        konflikty = 0;
        var prijato = Number(odp.prijato);
        p.offset = platny(prijato) ? prijato : od + kus.size;
        nastavProcenta(p, p.offset / celkem * 100);
        return dalsi();
      }, function (ch) {
        if (ch.zruseno || p.zruseno) { throw ch; }
        var prijato = Number(ch.odp.prijato);
        if (ch.status === 409 && platny(prijato) && konflikty < 5) {
          konflikty++;
          pokus = 0;
          p.offset = prijato;
          return dalsi();
        }
        var docasna = ch.status === 0 || ch.status === 408 || ch.status >= 500 || ch.status === 409;
        if (docasna && pokus < POKUSY && stav.prihlasen) {
          return pauza(PAUZY[pokus - 1]).then(dalsi);
        }
        ch.faze = 'kus';
        throw ch;
      });
    }
    return dalsi();
  }

  function dokonciVideo(p) {
    nastavStav(p, 'dokoncuji');
    var m = p.meta || {};
    var fd = new FormData();
    fd.append('nahravani', p.nahravani);
    if (m.delka > 0) { fd.append('delka', String(Math.round(m.delka * 10) / 10)); }
    if (m.w > 0 && m.h > 0) { fd.append('w', String(m.w)); fd.append('h', String(m.h)); }
    if (m.plakat) { fd.append('nahled', m.plakat, 'plakat.jpg'); }
    var pokus = 0;
    var predtim = {};
    polozkyRoku(p.rok).forEach(function (x) { predtim[x.id] = true; });
    function jednou() {
      pokus++;
      return api('video_konec', fd, { timeout: limitPozadavku(m.plakat ? m.plakat.size : 0) + 120000, xhr: function (x) { p.xhr = x; } })
        .catch(function (ch) {
          if (!ch.zruseno && !p.zruseno && (ch.status === 0 || ch.status >= 500) && pokus < POKUSY && stav.prihlasen) {
            return pauza(PAUZY[pokus - 1]).then(jednou);
          }
          /* Opakované dokončení selhalo (nahrávání už na serveru není) — první
             pokus mohl projít, jen se ztratila odpověď. Podívat se do galerie:
             nové video stejné velikosti v tomhle roce = hotovo. */
          if (pokus > 1 && ch.status >= 400 && ch.status !== 401 && ch.status !== 403) {
            return nactiStav().then(function () {
              var nove = polozkyRoku(p.rok).filter(function (x) {
                return !predtim[x.id] && x.typ === 'video' && x.velikost === p.soubor.size;
              })[0];
              if (nove) { return { ok: true, polozka: nove }; }
              throw ch;
            }, function () { throw ch; });
          }
          throw ch;
        });
    }
    return jednou().catch(function (ch) {
      if (ch && typeof ch === 'object' && !ch.faze) { ch.faze = 'konec'; }
      throw ch;
    });
  }

  /* =================================================================
     Zpracování fotek v prohlížeči
     ================================================================= */
  function base64Blob(b64, typ) {
    var bin = atob(b64), pole = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) { pole[i] = bin.charCodeAt(i); }
    return new Blob([pole], { type: typ });
  }

  function platno(w, h) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  /* Safari drží paměť plátna, dokud má rozměry — po použití je vynulovat. */
  function uvolniPlatno(c) { if (c) { c.width = 0; c.height = 0; } }

  function dekodujBitmapou(blob) {
    if (typeof window.createImageBitmap !== 'function') { return Promise.reject(new Error('createImageBitmap chybí')); }
    /* Nestandardní implementace (polyfill) může vyhodit hned, ne přes Promise —
       pak se jde dál na <img>, jako by createImageBitmap nebyl. */
    var slib;
    try { slib = window.createImageBitmap(blob, { imageOrientation: 'from-image' }); }
    catch (e) { return Promise.reject(e); }
    return Promise.resolve(slib).then(function (b) {
      return { zdroj: b, sirka: b.width, vyska: b.height, uvolni: function () { if (b.close) { b.close(); } } };
    });
  }

  function dekodujObrazkem(blob) {
    return new Promise(function (splnit, odmitnout) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.addEventListener('load', function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) { URL.revokeObjectURL(url); odmitnout(new Error('nulové rozměry')); return; }
        splnit({ zdroj: img, sirka: w, vyska: h, uvolni: function () { URL.revokeObjectURL(url); img.removeAttribute('src'); } });
      });
      img.addEventListener('error', function () { URL.revokeObjectURL(url); odmitnout(new Error('obrázek nejde dekódovat')); });
      img.src = url;
    });
  }

  /* Použije daný způsob dekódování orientaci z EXIF sám? true = ano,
     false = ne (natočí se ručně), null = způsob v prohlížeči nefunguje. */
  function otestujZpusob(dekoder) {
    return dekoder(base64Blob(TEST_ORIENTACE, 'image/jpeg')).then(function (d) {
      var c = null;
      try {
        c = platno(d.sirka, d.vyska);
        var ctx = c.getContext('2d');
        ctx.drawImage(d.zdroj, 0, 0, d.sirka, d.vyska);
        var jas = function (x, y) { return ctx.getImageData(x, y, 1, 1).data[0]; };
        if (d.sirka === 8 && d.vyska === 16 && jas(4, 3) > 160 && jas(4, 12) < 96) { return true; }
        if (d.sirka === 16 && d.vyska === 8 && jas(3, 4) > 160 && jas(12, 4) < 96) { return false; }
        return null;
      } catch (e) {
        return null;
      } finally {
        uvolniPlatno(c);
        d.uvolni();
      }
    }, function () { return null; });
  }

  var podporaOrientace = null;
  function zjistiOrientaci() {
    if (!podporaOrientace) {
      podporaOrientace = Promise.all([otestujZpusob(dekodujBitmapou), otestujZpusob(dekodujObrazkem)])
        .then(function (v) { return { bitmapa: v[0], obrazek: v[1] }; });
    }
    return podporaOrientace;
  }

  function precti(blob) {
    if (blob.arrayBuffer) { return blob.arrayBuffer(); }
    return new Promise(function (splnit, odmitnout) {
      var r = new FileReader();
      r.addEventListener('load', function () { splnit(r.result); });
      r.addEventListener('error', function () { odmitnout(r.error); });
      r.readAsArrayBuffer(blob);
    });
  }

  /* Orientace z EXIF (tag 0x0112 v IFD0). Stačí začátek souboru. */
  function ctiOrientaci(soubor) {
    return precti(soubor.slice(0, 256 * 1024)).then(function (buf) {
      return orientaceZJpegu(new DataView(buf));
    }).catch(function () { return 1; });
  }

  function orientaceZJpegu(dv) {
    if (dv.byteLength < 4 || dv.getUint16(0) !== 0xFFD8) { return 1; }
    var pos = 2;
    while (pos + 4 <= dv.byteLength) {
      var znacka = dv.getUint16(pos);
      if ((znacka & 0xFF00) !== 0xFF00 || znacka === 0xFFDA || znacka === 0xFFD9) { return 1; }
      var delka = dv.getUint16(pos + 2);
      if (znacka === 0xFFE1 && pos + 10 <= dv.byteLength &&
          dv.getUint32(pos + 4) === 0x45786966 && dv.getUint16(pos + 8) === 0) {
        return orientaceZTiffu(dv, pos + 10, Math.min(dv.byteLength, pos + 2 + delka));
      }
      pos += 2 + delka;
    }
    return 1;
  }

  function orientaceZTiffu(dv, zacatek, konec) {
    if (zacatek + 8 > konec) { return 1; }
    var bo = dv.getUint16(zacatek), le;
    if (bo === 0x4949) { le = true; } else if (bo === 0x4D4D) { le = false; } else { return 1; }
    if (dv.getUint16(zacatek + 2, le) !== 42) { return 1; }
    var ifd = zacatek + dv.getUint32(zacatek + 4, le);
    if (ifd + 2 > konec) { return 1; }
    var n = dv.getUint16(ifd, le);
    for (var i = 0; i < n; i++) {
      var z = ifd + 2 + i * 12;
      if (z + 12 > konec) { return 1; }
      if (dv.getUint16(z, le) === 0x0112) {
        var o = dv.getUint16(z + 8, le);
        return o >= 1 && o <= 8 ? o : 1;
      }
    }
    return 1;
  }

  /* Dekóduje fotku. Výsledek: {zdroj, sirka, vyska, orientace, uvolni} —
     orientace > 1 znamená, že prohlížeč EXIF nepoužil a natočit ji musíme sami. */
  function dekodujFotku(soubor) {
    return zjistiOrientaci().then(function (podpora) {
      var zpusoby = [];
      if (podpora.bitmapa !== null) { zpusoby.push({ dekoder: dekodujBitmapou, otaci: podpora.bitmapa }); }
      if (podpora.obrazek !== null) { zpusoby.push({ dekoder: dekodujObrazkem, otaci: podpora.obrazek }); }
      /* Test nevyšel ani jedním způsobem (divný prohlížeč) — dnešní prohlížeče orientaci používají. */
      if (!zpusoby.length) { zpusoby.push({ dekoder: dekodujObrazkem, otaci: true }); }
      var jpeg = /jpe?g/i.test(soubor.type || '') || /^(jpe?g|jfif)$/.test(pripona(soubor.name));
      var orientace = jpeg && zpusoby.some(function (z) { return !z.otaci; }) ? ctiOrientaci(soubor) : Promise.resolve(1);
      return orientace.then(function (o) {
        function zkus(i) {
          return zpusoby[i].dekoder(soubor).then(function (d) {
            d.orientace = zpusoby[i].otaci ? 1 : o;
            return d;
          }, function (e) {
            if (i + 1 < zpusoby.length) { return zkus(i + 1); }
            throw e;
          });
        }
        return zkus(0);
      });
    });
  }

  /* Natočení podle EXIF (w, h = rozměry kreslení před natočením). */
  function natoc(ctx, o, w, h) {
    switch (o) {
      case 2: ctx.transform(-1, 0, 0, 1, w, 0); break;
      case 3: ctx.transform(-1, 0, 0, -1, w, h); break;
      case 4: ctx.transform(1, 0, 0, -1, 0, h); break;
      case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
      case 6: ctx.transform(0, 1, -1, 0, h, 0); break;
      case 7: ctx.transform(0, -1, -1, 0, h, w); break;
      case 8: ctx.transform(0, -1, 1, 0, 0, w); break;
      default: break;
    }
  }

  /* Vykreslí zdroj na plátno s delší stranou nejvýš maxStrana (nezvětšuje),
     průhlednost podloží bílou. Velké zmenšení jde po krocích nejvýš 2× —
     jedním skokem by fotka zrnila (hlavně ve Firefoxu). */
  function vykresli(zdroj, sirka, vyska, orientace, maxStrana) {
    var otoceno = orientace >= 5 && orientace <= 8;
    var ow = otoceno ? vyska : sirka, oh = otoceno ? sirka : vyska;
    var mer = Math.min(1, maxStrana / Math.max(ow, oh));
    var cw = Math.max(1, Math.round(ow * mer)), ch = Math.max(1, Math.round(oh * mer));
    var kw = cw, kh = ch;
    while (kw * 2 <= ow && kh * 2 <= oh && kw * kh * 4 <= MAX_PLOCHA) { kw *= 2; kh *= 2; }

    var c = platno(kw, kh), ctx = c.getContext('2d');
    if (!ctx) { throw chyba('Prohlížeč nemá dost paměti na zmenšení fotky.'); }
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, kw, kh);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    var dw = otoceno ? kh : kw, dh = otoceno ? kw : kh;
    natoc(ctx, orientace, dw, dh);
    ctx.drawImage(zdroj, 0, 0, dw, dh);

    while (kw > cw || kh > ch) {
      var nw = Math.max(cw, Math.round(kw / 2)), nh = Math.max(ch, Math.round(kh / 2));
      var d = platno(nw, nh), dctx = d.getContext('2d');
      dctx.imageSmoothingEnabled = true;
      dctx.imageSmoothingQuality = 'high';
      dctx.drawImage(c, 0, 0, nw, nh);
      uvolniPlatno(c);
      c = d; kw = nw; kh = nh;
    }
    return c;
  }

  function naJpeg(c, kvalita) {
    return new Promise(function (splnit, odmitnout) {
      c.toBlob(function (b) {
        if (b && b.size) { splnit(b); } else { odmitnout(chyba('Obrázek se nepodařilo uložit jako JPEG.')); }
      }, 'image/jpeg', kvalita);
    });
  }

  /* JPEG, který se vejde do limitu serveru. Hosting s upload_max_filesize 2 MB
     pustí jen fotky do 2 MB — a fotka plná drobných detailů (tráva, listí, šum
     z mobilu) je v kvalitě 0,85 i po zmenšení na 2048 px větší. Pak se zkusí
     nižší kvalita a nakonec menší rozměr. Vrací {blob, w, h}; když se ani tak
     nevejde, vrátí poslední pokus a chybu ohlásí volající. */
  function jpegDoLimitu(c, kvalita, limit) {
    var kvality = [kvalita, 0.75, 0.65].filter(function (q, i) { return i === 0 || q < kvalita; });
    var vlastni = [];          /* plátna vyrobená tady — po skončení se uvolní */
    function uklid(ven) { vlastni.forEach(uvolniPlatno); return ven; }
    function zkus(platno, i) {
      return naJpeg(platno, kvality[i]).then(function (b) {
        if (b.size <= limit) { return { blob: b, w: platno.width, h: platno.height }; }
        if (i + 1 < kvality.length) { return zkus(platno, i + 1); }
        var delsi = Math.max(platno.width, platno.height);
        if (delsi <= 1024) { return { blob: b, w: platno.width, h: platno.height }; }
        /* Plocha (a s ní velikost souboru) klesá s druhou mocninou strany. */
        var nova = Math.max(1024, Math.floor(delsi * Math.min(0.9, Math.sqrt(limit / b.size) * 0.95)));
        var mensi = vykresli(platno, platno.width, platno.height, 1, nova);
        vlastni.push(mensi);
        return zkus(mensi, kvality.length - 1);
      });
    }
    return zkus(c, 0).then(uklid, function (e) { uklid(); throw e; });
  }

  function zpracujFotku(soubor, limity) {
    return dekodujFotku(soubor).then(null, function () {
      throw chyba(BEZNE_FOTKY.test(pripona(soubor.name)) || /^image\/(jpeg|png|gif|webp|bmp)$/i.test(soubor.type || '')
        ? 'Fotku se nepodařilo přečíst — soubor je nejspíš poškozený.'
        : HLASKA_FORMAT, true);
    }).then(function (d) {
      var velka, nahled;
      try {
        velka = vykresli(d.zdroj, d.sirka, d.vyska, d.orientace, MAX_VELKA);
      } finally {
        d.uvolni();
      }
      nahled = vykresli(velka, velka.width, velka.height, 1, MAX_NAHLED);
      return Promise.all([
        jpegDoLimitu(velka, KVALITA_VELKA, limity.max_foto_bajtu),
        jpegDoLimitu(nahled, KVALITA_NAHLED, limity.max_nahled_bajtu)
      ]).then(function (b) {
        uvolniPlatno(velka);
        uvolniPlatno(nahled);
        return { velka: b[0].blob, nahled: b[1].blob, w: b[0].w, h: b[0].h };
      }, function (e) {
        uvolniPlatno(velka);
        uvolniPlatno(nahled);
        throw e;
      });
    });
  }

  /* =================================================================
     Videa: délka, rozměry a plakát (snímek v čase min(1 s, 10 % délky))
     ================================================================= */
  function ctiVideo(soubor) {
    return new Promise(function (splnit) {
      var url = URL.createObjectURL(soubor);
      var v = document.createElement('video');
      var meta = { delka: 0, w: 0, h: 0, plakat: null, precteno: false };
      var konec = false, fotim = false, cil = 0, dohledano = false, prehrava = false, pojistka = null;

      function hotovo() {
        if (konec) { return; }
        konec = true;
        clearTimeout(casovac);
        clearTimeout(pojistka);
        try { v.pause(); } catch (e) { /* nic */ }
        v.removeAttribute('src');
        try { v.load(); } catch (e) { /* nic */ }
        if (v.parentNode) { v.parentNode.removeChild(v); }
        URL.revokeObjectURL(url);
        splnit(meta);
      }
      function snimek() {
        if (konec || fotim || v.readyState < 2 || !v.videoWidth || !v.videoHeight) { return; }
        if (cil > 0 && !dohledano && !prehrava) { return; }
        fotim = true;
        var c;
        try {
          c = vykresli(v, v.videoWidth, v.videoHeight, 1, MAX_PLAKAT);
        } catch (e) {
          hotovo();
          return;
        }
        naJpeg(c, KVALITA_PLAKAT).then(function (b) { meta.plakat = b; }, function () {})
          .then(function () { uvolniPlatno(c); hotovo(); });
      }
      var casovac = setTimeout(hotovo, LIMIT_CTENI_VIDEA);

      v.muted = true;
      v.defaultMuted = true;
      v.playsInline = true;
      v.setAttribute('muted', '');
      v.setAttribute('playsinline', '');
      v.preload = 'auto';
      v.className = 'adm-video-cteni';
      v.addEventListener('error', function () { meta.precteno = false; hotovo(); });
      v.addEventListener('loadedmetadata', function () {
        meta.delka = isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
        meta.w = v.videoWidth || 0;
        meta.h = v.videoHeight || 0;
        if (!meta.w || !meta.h) { hotovo(); return; }   /* obraz prohlížeč nepřečte (neznámý kodek) */
        meta.precteno = true;
        cil = meta.delka > 0 ? Math.min(1, meta.delka * 0.1) : 0;
        if (cil > 0) { v.currentTime = cil; } else { snimek(); }
        /* iPhone někdy bez přehrání nenačte ani snímek — zkusit krátce přehrát (bez zvuku). */
        pojistka = setTimeout(function () {
          if (konec || fotim) { return; }
          prehrava = true;
          var pr = v.play();
          if (pr && pr.then) { pr.then(function () {}, function () {}); }
        }, 2500);
      });
      v.addEventListener('seeked', function () { dohledano = true; snimek(); });
      v.addEventListener('loadeddata', snimek);
      v.addEventListener('canplay', snimek);
      v.addEventListener('timeupdate', function () {
        if (prehrava && v.currentTime > 0) { try { v.pause(); } catch (e) { /* nic */ } snimek(); }
      });
      document.body.appendChild(v);
      v.src = url;
    });
  }

  /* =================================================================
     Přihlášení, heslo, odhlášení
     ================================================================= */
  function navazPrihlaseni() {
    $('form-prihlaseni').addEventListener('submit', function (e) {
      e.preventDefault();
      var pole = $('prihlaseni-heslo'), tl = $('prihlaseni-tlacitko'), hl = $('prihlaseni-chyba');
      if (tl.disabled) { return; }
      if (!pole.value) {
        nastavHlasku(hl, 'Zadej heslo.', true);
        pole.focus();
        return;
      }
      tl.disabled = true;
      tl.textContent = 'Přihlašuji…';
      nastavHlasku(hl, '');
      volej('prihlasit', { heslo: pole.value }).then(function (odp) {
        stav.csrf = typeof odp.csrf === 'string' ? odp.csrf : '';
        pole.value = '';
        return nactiStav().then(function () {
          if (!stav.prihlasen) {
            nastavHlasku(hl, 'Přihlášení se neudrželo — povol v prohlížeči cookies pro tento web.', true);
            return;
          }
          oznam('Přihlášeno.');
          if (!$('vybrat').disabled) { $('vybrat').focus(); } else { $('mrizka-nadpis').focus(); }
        });
      }).catch(function (ch) {
        if (ch.kod === 'bez_hesla' || ch.status === 503) {
          stav.hesloNastaveno = false;
          zobrazPrihlaseni();
          return;
        }
        nastavHlasku(hl, ch.chyba || 'Přihlášení se nepovedlo.', true);
        pole.focus();
        pole.select();
      }).then(function () {
        tl.disabled = !stav.hesloNastaveno;
        tl.textContent = 'Přihlásit';
      });
    });
  }

  function panelHesla(otevrit, vratitFokus) {
    var panel = $('panel-heslo'), tl = $('heslo-prepinac');
    panel.hidden = !otevrit;
    tl.setAttribute('aria-expanded', String(otevrit));
    ['heslo-stare', 'heslo-nove', 'heslo-znovu'].forEach(function (id) { $(id).value = ''; });
    nastavHlasku($('heslo-hlaska'), '');
    if (otevrit) { $('heslo-stare').focus(); } else if (vratitFokus) { tl.focus(); }
  }

  function navazHeslo() {
    $('heslo-prepinac').addEventListener('click', function () { panelHesla($('panel-heslo').hidden, true); });
    $('heslo-zrusit').addEventListener('click', function () { panelHesla(false, true); });
    $('panel-heslo').addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); panelHesla(false, true); }
    });
    $('form-heslo').addEventListener('submit', function (e) {
      e.preventDefault();
      var stare = $('heslo-stare'), nove = $('heslo-nove'), znovu = $('heslo-znovu');
      var hl = $('heslo-hlaska'), tl = $('heslo-ulozit');
      if (tl.disabled) { return; }
      if (!stare.value) { nastavHlasku(hl, 'Vyplň současné heslo.', true); stare.focus(); return; }
      if (nove.value.length < 10) { nastavHlasku(hl, 'Nové heslo musí mít aspoň 10 znaků.', true); nove.focus(); return; }
      if (nove.value !== znovu.value) { nastavHlasku(hl, 'Nová hesla se neshodují.', true); znovu.focus(); return; }
      tl.disabled = true;
      nastavHlasku(hl, 'Ukládám…');
      api('zmenit_heslo', { stare: stare.value, nove: nove.value }).then(function () {
        stare.value = nove.value = znovu.value = '';
        nastavHlasku(hl, 'Heslo je změněné. Příště se přihlas novým heslem. Ostatní zařízení, kde jsi byl přihlášený, jsou odhlášená.');
        oznam('Heslo je změněné.');
      }, function (ch) {
        nastavHlasku(hl, ch.chyba, true);
        if (ch.status === 401 && ch.kod !== 'spatne_stare_heslo') {
          /* 401 bez kódu špatného současného hesla — třeba vypršelé přihlášení. Ověřit. */
          volej('stav').then(function (odp) { if (odp.prihlasen !== true) { odhlasenZvenku(); } }, function () {});
        }
        if (ch.status === 400 || ch.status === 401) {
          /* Špatné současné heslo (API vrací 401 spatne_stare_heslo), nebo nevyhovující nové. */
          var pole = /kratke|dlouhe/.test(ch.kod) ? nove : stare;
          pole.focus();
          pole.select();
        }
      }).then(function () { tl.disabled = false; });
    });
  }

  function navazOdhlaseni() {
    $('odhlasit').addEventListener('click', function () {
      var tl = this;
      if (probihaNahravani() && !window.confirm('Právě se nahrává. Opravdu se odhlásit? Nahrávání se přeruší.')) { return; }
      tl.disabled = true;
      /* Rozpracovaná videa uklidit, dokud je ještě session. */
      var uklid = fronta.filter(function (p) { return p.nahravani && p.stav !== 'hotovo'; }).map(function (p) {
        return volej('video_zrusit', { nahravani: p.nahravani }).catch(function () {});
      });
      fronta.slice().forEach(function (p) {
        odeberRadek(p);
        if (p.xhr) { try { p.xhr.abort(); } catch (e) { /* nic */ } }
      });
      Promise.all(uklid).then(function () {
        return volej('odhlasit', {}).catch(function () {});
      }).then(function () {
        tl.disabled = false;
        stav.prihlasen = false;
        stav.csrf = '';
        karty = {};
        $('mrizka').textContent = '';
        panelHesla(false, false);
        vykresliSouhrnFronty();
        zobrazPrihlaseni('Odhlášeno.', true);
      });
    });
  }

  /* =================================================================
     Soubory: tlačítko, přetažení, varování při odchodu
     ================================================================= */
  function navazSoubory() {
    var vstup = $('soubory'), zona = $('zona');
    $('vybrat').addEventListener('click', function () { vstup.click(); });
    vstup.addEventListener('change', function () {
      var soubory = Array.prototype.slice.call(vstup.files || []);
      vstup.value = '';
      pridejSoubory(soubory);
    });

    function nesouSoubory(e) {
      var t = e.dataTransfer && e.dataTransfer.types;
      if (!t) { return false; }
      for (var i = 0; i < t.length; i++) { if (t[i] === 'Files') { return true; } }
      return false;
    }
    function smiNahrat() { return stav.prihlasen && !$('obr-sprava').hidden && !$('vybrat').disabled; }
    var hloubka = 0;
    /* Soubor puštěný mimo zónu by prohlížeč otevřel místo stránky (a zahodil
       rozpracované nahrávání) — proto se přetažení chytá na celém dokumentu. */
    document.addEventListener('dragenter', function (e) {
      if (!nesouSoubory(e)) { return; }
      e.preventDefault();
      hloubka++;
      if (smiNahrat()) { zona.classList.add('is-nad'); }
    });
    document.addEventListener('dragover', function (e) {
      if (!nesouSoubory(e)) { return; }
      e.preventDefault();
      e.dataTransfer.dropEffect = smiNahrat() ? 'copy' : 'none';
    });
    document.addEventListener('dragleave', function (e) {
      if (!nesouSoubory(e)) { return; }
      hloubka = Math.max(0, hloubka - 1);
      if (!hloubka) { zona.classList.remove('is-nad'); }
    });
    document.addEventListener('drop', function (e) {
      if (!nesouSoubory(e)) { return; }
      e.preventDefault();
      hloubka = 0;
      zona.classList.remove('is-nad');
      if (smiNahrat()) { pridejSoubory(Array.prototype.slice.call(e.dataTransfer.files || [])); }
    });

    $('fronta-vycistit').addEventListener('click', function () {
      fronta.filter(function (p) { return p.stav === 'hotovo'; }).forEach(odeberRadek);
      vykresliSouhrnFronty();
      $('vybrat').focus();
    });

    window.addEventListener('beforeunload', function (e) {
      var neulozeno = Object.keys(karty).some(function (id) {
        var k = karty[id];
        return k.li.parentNode && cistyPopis(k.input.value) !== k.ulozeny;
      });
      if (!probihaNahravani() && !neulozeno) { return; }
      e.preventDefault();
      e.returnValue = 'Nahrávání ještě neskončilo.';
      return e.returnValue;
    });

    window.addEventListener('hashchange', function () {
      var r = rokZAdresy();
      if (r && stav.prihlasen) { vyberRok(r); }
    });
  }

  /* =================================================================
     Start
     ================================================================= */
  function nacti() {
    $('adm-nacitam').hidden = false;
    nactiStav().catch(function (ch) {
      zobraz('obr-chyba');
      $('chyba-nacteni-text').textContent = 'Správu galerie se nepodařilo načíst: ' +
        ((ch && ch.chyba) || 'neznámá chyba.');
      $('chyba-nacteni-znovu').focus();
    });
  }

  function start() {
    /* Správa jen přes HTTPS: cookie přihlášení je Secure a přes http:// by
       se neuložila (a heslo by jelo nešifrovaně). Adresu zná jen prohlížeč —
       server za proxy HTTPS spolehlivě nepozná, přesměrování tedy tady. */
    if (location.protocol === 'http:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
      location.replace('https://' + location.host + location.pathname + location.search + location.hash);
      return;
    }
    navazPrihlaseni();
    navazHeslo();
    navazOdhlaseni();
    navazSoubory();
    $('chyba-nacteni-znovu').addEventListener('click', function () {
      $('obr-chyba').hidden = true;
      nacti();
    });
    nacti();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
