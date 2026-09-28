<?php
/* =====================================================================
   Galerie ročníků — JSON API administrace
   ---------------------------------------------------------------------
   admin/api.php?akce=<název>
   Odpověď je vždy JSON {"ok":true,…} nebo {"ok":false,"kod":…,"chyba":…}
   s odpovídajícím HTTP stavem. Všechny akce kromě `stav` jsou POST; všechny
   POST kromě `prihlasit` chtějí přihlášení a hlavičku X-CSRF-Token.
   Sdílené funkce (session, zámky, manifest, kontroly souborů) jsou v lib.php.
   ===================================================================== */
declare(strict_types=1);

/* Chyby PHP nesmí nikdy skončit v odpovědi (prozradily by cesty). */
ini_set('display_errors', '0');
ini_set('log_errors', '1');

define('GOLF_ADMIN', true);
require __DIR__ . '/lib.php';

/* akce => [metoda, chce přihlášení, potřebuje zapisovat do session] */
const GOLF_AKCE = [
    'stav'          => ['GET', false, false],
    'prihlasit'     => ['POST', false, true],
    'odhlasit'      => ['POST', true, true],
    'zmenit_heslo'  => ['POST', true, true],
    'foto'          => ['POST', true, false],
    'video_zacatek' => ['POST', true, false],
    'video_kus'     => ['POST', true, false],
    'video_konec'   => ['POST', true, false],
    'video_zrusit'  => ['POST', true, false],
    'upravit'       => ['POST', true, false],
    'poradi'        => ['POST', true, false],
    'presunout'     => ['POST', true, false],
    'smazat'        => ['POST', true, false],
];

/* Fatální chyba (paměť, čas) — aspoň obecná odpověď místo prázdné stránky. */
register_shutdown_function(function (): void {
    $e = error_get_last();
    if ($e !== null && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true) && !headers_sent()) {
        golf_odpovez(500, ['ok' => false, 'kod' => 'chyba_serveru',
            'chyba' => 'Na serveru se něco pokazilo. Zkus to prosím znovu.']);
    }
});

$akce = $_GET['akce'] ?? '';
$akce = is_string($akce) ? $akce : '';

try {
    if (!isset(GOLF_AKCE[$akce])) {
        golf_chyba(404, 'neznama_akce', 'Neznámá akce.');
    }
    [$metoda, $chcePrihlaseni, $zapisSession] = GOLF_AKCE[$akce];
    $pozadavek = is_string($_SERVER['REQUEST_METHOD'] ?? null) ? $_SERVER['REQUEST_METHOD'] : 'GET';
    if ($pozadavek !== $metoda && !($metoda === 'GET' && $pozadavek === 'HEAD')) {
        header('Allow: ' . ($metoda === 'GET' ? 'GET, HEAD' : 'POST'));
        golf_chyba(405, 'metoda', $metoda === 'GET' ? 'Tahle akce se volá metodou GET.' : 'Tahle akce se volá metodou POST.');
    }
    if ($metoda === 'POST') {
        /* Rozdělaná práce se dokončí, i kdyby klient spojení zavřel. */
        ignore_user_abort(true);
        golf_kontrola_velikosti();
    }
    if ($chcePrihlaseni) {
        golf_vyzaduj_prihlaseni(!$zapisSession);
    }
    $funkce = 'akce_' . $akce;
    golf_odpovez(200, ['ok' => true] + $funkce());
} catch (GolfChyba $e) {
    golf_odpovez($e->stav, ['ok' => false, 'kod' => $e->kod, 'chyba' => $e->getMessage()] + $e->navic);
} catch (Throwable $e) {
    error_log('Galerie API (' . $akce . '): ' . $e);
    golf_odpovez(500, ['ok' => false, 'kod' => 'chyba_serveru',
        'chyba' => 'Na serveru se něco pokazilo. Zkus to prosím znovu.']);
}

/* ---------------------------------------------------------------------
   Stav a přihlášení
   --------------------------------------------------------------------- */

/** @return array<string, mixed> */
function akce_stav(): array
{
    $prihlasen = golf_otevri_session(true) && golf_je_prihlasen();
    $m = golf_nacti_manifest(false, $poskozeny);
    $ven = ['prihlasen' => $prihlasen];
    $rozpracovano = 0;
    if ($prihlasen) {
        $ven['csrf'] = $_SESSION['csrf'];
        /* Opuštěná nahrávání (zavřená stránka) se uklidí i bez dalšího videa. */
        if (is_dir(GOLF_TMP)) {
            try {
                golf_pod_zamkem(function (): void {
                    golf_uklid_tmp();
                });
            } catch (GolfChyba $e) {
                /* Zámek nejde otevřít — o právech řekne varování ve správě. */
            }
            $rozpracovano = golf_bajtu_tmp();
        }
    }
    return $ven + [
        'heslo_nastaveno'    => golf_hash_hesla() !== null,
        'roky'               => golf_roky(),
        'galerie'            => golf_manifest_pro_json($m),
        'limity'             => golf_limity(),
        'zapis'              => ['media' => is_dir(GOLF_MEDIA) && is_writable(GOLF_MEDIA),
                                 'data'  => is_dir(GOLF_DATA) && is_writable(GOLF_DATA)],
        'media_chybi'        => !is_dir(GOLF_MEDIA),
        'manifest_poskozeny' => $poskozeny,
        'obsazeno_bajtu'     => golf_obsazeno($m),
        'rozpracovano_bajtu' => $rozpracovano,
    ];
}

/** @return array<string, mixed> */
function akce_prihlasit(): array
{
    $vstup = golf_json_vstup();
    $heslo = $vstup['heslo'] ?? null;
    if (!is_string($heslo)) {
        golf_chyba(400, 'spatny_vstup', 'Zadej heslo.');
    }
    $hash = golf_hash_hesla();
    if ($hash === null) {
        golf_chyba(503, 'bez_hesla', 'Heslo zatím není nastavené. Nastaví ho správce webu nástrojem tools/nastav-heslo.php.');
    }
    golf_zapocitej_pokus();
    if (strlen($heslo) > 4096 || !password_verify($heslo, (string) $hash)) {
        sleep(1);
        golf_chyba(401, 'spatne_heslo', 'Špatné heslo.');
    }
    $zarizeni = golf_uspesne_prihlaseni();
    $csrf = golf_prihlas();
    golf_cookie_zarizeni($zarizeni);
    return ['csrf' => $csrf];
}

/** @return array<string, mixed> */
function akce_odhlasit(): array
{
    golf_odhlas();
    return [];
}

/* Špatné současné heslo vrací 401 jako každé špatné heslo (specifikace), ale
   s vlastním kódem spatne_stare_heslo — podle něj klient pozná, že nejde
   o vypršené přihlášení, a neodhlásí. */
/** @return array<string, mixed> */
function akce_zmenit_heslo(): array
{
    $vstup = golf_json_vstup();
    $stare = $vstup['stare'] ?? null;
    $nove = $vstup['nove'] ?? null;
    if (!is_string($stare) || !is_string($nove) || $stare === '') {
        golf_chyba(400, 'spatny_vstup', 'Vyplň současné i nové heslo.');
    }
    if (golf_delka($nove) < 10) {
        golf_chyba(400, 'kratke_heslo', 'Nové heslo musí mít aspoň 10 znaků.');
    }
    if (strlen($nove) > 1024) {
        golf_chyba(400, 'dlouhe_heslo', 'Nové heslo je moc dlouhé.');
    }
    $hash = golf_hash_hesla();
    if ($hash === null) {
        golf_chyba(503, 'bez_hesla', 'Heslo zatím není nastavené. Nastaví ho správce webu nástrojem tools/nastav-heslo.php.');
    }
    /* Kdo by ukradl přihlášenou session, nesmí zkoušet stará hesla donekonečna. */
    golf_zapocitej_pokus();
    if (strlen($stare) > 4096 || !password_verify($stare, (string) $hash)) {
        session_write_close();
        sleep(1);
        golf_chyba(401, 'spatne_stare_heslo', 'Současné heslo nesouhlasí.');
    }
    golf_uloz_hash_hesla(password_hash($nove, PASSWORD_DEFAULT));
    /* Heslo se měnilo — třeba proto, že uniklo. Tohle přihlášení dostane nové
       id, všechna ostatní (i ukradená cookie) přestanou platit a zapomenou se
       i ostatní důvěryhodná zařízení. */
    $zarizeni = golf_uspesne_prihlaseni(true);
    session_regenerate_id(true);
    $_SESSION['od'] = time();
    $csrf = (string) $_SESSION['csrf'];
    golf_zrus_ostatni_session();
    session_write_close();
    golf_cookie_zarizeni($zarizeni);
    return ['csrf' => $csrf];
}

/* ---------------------------------------------------------------------
   Fotky
   --------------------------------------------------------------------- */

/** @return array<string, mixed> */
function akce_foto(): array
{
    $n = golf_nastaveni();
    $limity = golf_limity();
    $rok = golf_rok(golf_post('rok'));
    $popis = golf_popis(golf_post('popis'));
    $velka = golf_nahrany('soubor', $limity['max_foto_bajtu'], true, 'fotka');
    $mala = golf_nahrany('nahled', $limity['max_nahled_bajtu'], true, 'náhled');
    $iv = golf_over_obrazek($velka['tmp'], $n['max_strana_foto'], 'fotka');
    $in = golf_over_obrazek($mala['tmp'], $n['max_strana_nahled'], 'náhled');
    golf_over_misto($velka['velikost'] + $mala['velikost']);

    $slozka = golf_slozka_roku($rok);
    $id = golf_nove_id($rok);
    $jmeno = $id . '.' . $iv['ext'];
    $jmenoN = $id . '_n.' . $in['ext'];
    golf_uloz_nahrany($velka['tmp'], $slozka . '/' . $jmeno);
    try {
        golf_uloz_nahrany($mala['tmp'], $slozka . '/' . $jmenoN);
        $polozka = [
            'id'       => $id,
            'typ'      => 'foto',
            'soubor'   => $rok . '/' . $jmeno,
            'nahled'   => $rok . '/' . $jmenoN,
            'w'        => $iv['w'],
            'h'        => $iv['h'],
            'velikost' => $velka['velikost'],
            'popis'    => $popis,
        ];
        golf_uprav_manifest(function (array &$m) use ($rok, $polozka): void {
            $m['rocniky'][$rok][] = $polozka;
        });
    } catch (Throwable $e) {
        @unlink($slozka . '/' . $jmeno);
        @unlink($slozka . '/' . $jmenoN);
        throw $e;
    }
    return ['polozka' => $polozka];
}

/* ---------------------------------------------------------------------
   Video po kusech
   --------------------------------------------------------------------- */

/** @return array<string, mixed> */
function akce_video_zacatek(): array
{
    $vstup = golf_json_vstup();
    $rok = golf_rok($vstup['rok'] ?? null);
    $nazev = $vstup['nazev'] ?? null;
    $velikost = $vstup['velikost'] ?? null;
    if (!is_string($nazev) || strlen($nazev) > 1000) {
        golf_chyba(400, 'spatny_vstup', 'Chybí název souboru.');
    }
    /* Z názvu se bere jen přípona; jméno souboru určí server. */
    $tecka = strrpos($nazev, '.');
    $ext = $tecka === false ? '' : strtolower(substr($nazev, $tecka + 1));
    if (!in_array($ext, GOLF_PRIPONY_VIDEA, true)) {
        golf_chyba(400, 'spatny_format', 'Video musí být MP4, MOV, WebM nebo M4V.');
    }
    if (is_float($velikost) && is_finite($velikost) && $velikost == floor($velikost) && $velikost > 0) {
        $velikost = $velikost <= PHP_INT_MAX ? (int) $velikost : PHP_INT_MAX;
    }
    if (!is_int($velikost) || $velikost <= 0) {
        golf_chyba(400, 'spatny_vstup', 'Neplatná velikost souboru.');
    }
    $max = golf_nastaveni()['max_video_bajtu'];
    if ($velikost > $max) {
        golf_chyba(413, 'prilis_velke', 'Video je moc velké (nejvýš ' . golf_mb($max) . ').');
    }
    if (!golf_zajisti_slozku(GOLF_DATA, 0755) || !golf_zajisti_slozku(GOLF_TMP, 0755)) {
        golf_chyba(500, 'nelze_zapsat', 'Na serveru nejde zapisovat do složky admin/_data — zkontroluj práva.');
    }
    $nahravani = bin2hex(random_bytes(16));
    golf_pod_zamkem(function () use ($nahravani, $rok, $ext, $velikost, $max): void {
        golf_uklid_tmp();
        /* Rozpracovaných videí nesmí být neomezeně — každé si může zabrat až
           max_video_bajtu. Když je jich moc, zahodí se nejdřív ta, na která
           nikdo nesáhl 20 minut (zavřená stránka; živé nahrávání posílá kus
           nejvýš po pár minutách). */
        $prekroceno = function () use ($velikost, $max): bool {
            $aktivni = golf_rozpracovana();
            return count($aktivni) >= GOLF_MAX_NAHRAVANI || array_sum($aktivni) + $velikost > 3 * $max;
        };
        if ($prekroceno()) {
            golf_uklid_tmp(20 * 60);
            if ($prekroceno()) {
                golf_chyba(429, 'moc_nahravani', 'Rozpracovaných videí je moc najednou — dokonči nebo zruš ta, která se nahrávají, a zkus to znovu.');
            }
        }
        golf_over_misto($velikost);
        if (@file_put_contents(GOLF_TMP . '/' . $nahravani . '.part', '') !== 0) {
            golf_chyba(500, 'nelze_zapsat', 'Na serveru nejde zapisovat do složky admin/_data — zkontroluj práva.');
        }
        golf_zapis_chraneny(GOLF_TMP . '/' . $nahravani . '.php', [
            'rok'       => $rok,
            'ext'       => $ext,
            'velikost'  => $velikost,
            'vytvoreno' => time(),
        ]);
    });
    return ['nahravani' => $nahravani, 'kus_bajtu' => golf_kus_bajtu()];
}

/** @return array<string, mixed> */
function akce_video_kus(): array
{
    $nahravani = golf_nahravani_id(golf_post('nahravani'));
    $offset = golf_post('offset');
    if (!is_string($offset) || !preg_match('/^\d{1,15}\z/', $offset)) {
        golf_chyba(400, 'spatny_vstup', 'Neplatný offset.');
    }
    $offset = (int) $offset;
    $meta = golf_meta_nahravani($nahravani);
    $part = GOLF_TMP . '/' . $nahravani . '.part';
    if ($meta === null || !is_file($part)) {
        golf_chyba(404, 'nahravani_nenalezeno', 'Nahrávání už neexistuje (dokončené, zrušené nebo starší než 24 hodin) — začni znovu.');
    }
    $kus = golf_nahrany('kus', golf_kus_bajtu(), true, 'kus videa');
    /* První kus musí začínat hlavičkou videa (viz golf_zacatek_videa). Jinak
       nemá smysl pokračovat — nahrávání se zahodí stejně jako při špatném
       formátu ve video_konec. */
    if ($offset === 0 && !golf_zacatek_videa($kus['tmp'], $meta['ext'])) {
        golf_pod_zamkem(function () use ($nahravani): void {
            golf_smaz_nahravani($nahravani);
        });
        error_log('Galerie: video odmítnuto už v prvním kusu, přípona ' . $meta['ext']);
        golf_chyba(400, 'spatny_format', 'Soubor není video ve formátu, který odpovídá jeho příponě (MP4, MOV, WebM, M4V).');
    }

    /* 'r+b' místo 'ab': soubor, který mezitím zmizel (dokončení, zrušení),
       se nesmí znovu založit. Pod zámkem se pak zapisuje na konec. */
    $f = @fopen($part, 'r+b');
    if ($f === false) {
        golf_chyba(404, 'nahravani_nenalezeno', 'Nahrávání už neexistuje (dokončené, zrušené nebo starší než 24 hodin) — začni znovu.');
    }
    try {
        /* Dva požadavky na stejné nahrávání (opakovaný pokus) se nesmí proplést. */
        if (!flock($f, LOCK_EX)) {
            throw new RuntimeException('flock selhal na ' . $part);
        }
        if (golf_meta_nahravani($nahravani) === null) {
            golf_chyba(404, 'nahravani_nenalezeno', 'Nahrávání už neexistuje (dokončené, zrušené nebo starší než 24 hodin) — začni znovu.');
        }
        $stat = fstat($f);
        $prijato = is_array($stat) ? (int) $stat['size'] : 0;
        if ($offset !== $prijato) {
            golf_chyba(409, 'offset', 'Server má zatím jinou část videa — pokračuje se od ní.', ['prijato' => $prijato]);
        }
        if ($prijato + $kus['velikost'] > $meta['velikost']) {
            golf_chyba(400, 'preteceni', 'Kus přesahuje ohlášenou velikost videa.', ['prijato' => $prijato]);
        }
        $zdroj = @fopen($kus['tmp'], 'rb');
        if ($zdroj === false) {
            throw new RuntimeException('Nelze číst nahraný kus');
        }
        fseek($f, $prijato);
        $zapsano = stream_copy_to_stream($zdroj, $f);
        fclose($zdroj);
        fflush($f);
        if ($zapsano !== $kus['velikost']) {
            ftruncate($f, $prijato);
            throw new RuntimeException('Kus se nezapsal celý (' . var_export($zapsano, true) . ' z ' . $kus['velikost'] . ')');
        }
        return ['prijato' => $prijato + $zapsano];
    } finally {
        flock($f, LOCK_UN);
        fclose($f);
    }
}

/** @return array<string, mixed> */
function akce_video_konec(): array
{
    $nahravani = golf_nahravani_id(golf_post('nahravani'));
    $popis = golf_popis(golf_post('popis'));
    $delka = golf_cislo(golf_post('delka'), 24 * 3600, false);
    $w = golf_cislo(golf_post('w'), 16384, true);
    $h = golf_cislo(golf_post('h'), 16384, true);
    $plakat = golf_nahrany('nahled', golf_limity()['max_nahled_bajtu'], false, 'plakát');
    $ip = $plakat === null ? null : golf_over_obrazek($plakat['tmp'], golf_nastaveni()['max_strana_plakat'], 'plakát');

    /* Celé dokončení pod zámkem: dvojí video_konec (opakovaný pokus, dvě
       okna) musí projít jen jednou. Na rename jako „kdo dřív přijde“ se
       spolehnout nejde — PHP na Windows vrací true oběma. */
    $polozka = golf_pod_zamkem(function () use ($nahravani, $popis, $delka, $w, $h, $plakat, $ip): array {
        $meta = golf_meta_nahravani($nahravani);
        $part = GOLF_TMP . '/' . $nahravani . '.part';
        if ($meta === null || !is_file($part)) {
            golf_chyba(404, 'nahravani_nenalezeno', 'Nahrávání už neexistuje (dokončené, zrušené nebo starší než 24 hodin).');
        }
        $rok = golf_rok($meta['rok']);
        /* Velikost pod zámkem souboru: rozepsaný video_kus se nejdřív dopíše.
           Další kus už by přetekl ohlášenou velikost, takže nic nepřipíše. */
        $f = @fopen($part, 'rb');
        if ($f === false) {
            throw new RuntimeException('Nelze otevřít ' . $part);
        }
        flock($f, LOCK_EX);
        $stat = fstat($f);
        flock($f, LOCK_UN);
        fclose($f);
        $prijato = is_array($stat) ? (int) $stat['size'] : 0;
        if ($prijato !== $meta['velikost']) {
            golf_chyba(409, 'neuplne', 'Video ještě není celé nahrané.', ['prijato' => $prijato]);
        }
        $mime = golf_mime_videa($part);
        if (!golf_video_sedi($meta['ext'], $mime)) {
            golf_smaz_nahravani($nahravani);
            error_log('Galerie: video odmítnuto, přípona ' . $meta['ext'] . ', MIME ' . $mime);
            golf_chyba(400, 'spatny_format', 'Soubor není video ve formátu, který odpovídá jeho příponě (MP4, MOV, WebM, M4V).');
        }

        $slozka = golf_slozka_roku($rok);
        $id = golf_nove_id($rok);
        $jmeno = $id . '.' . $meta['ext'];
        $jmenoN = $ip === null ? '' : $id . '_n.' . $ip['ext'];
        if ($plakat !== null && $ip !== null) {
            golf_uloz_nahrany($plakat['tmp'], $slozka . '/' . $jmenoN);
        }
        if (!golf_presun($part, $slozka . '/' . $jmeno)) {
            if ($jmenoN !== '') {
                @unlink($slozka . '/' . $jmenoN);
            }
            throw new RuntimeException('Nelze přesunout video do media/');
        }
        @chmod($slozka . '/' . $jmeno, 0644);
        $polozka = [
            'id'       => $id,
            'typ'      => 'video',
            'soubor'   => $rok . '/' . $jmeno,
            'nahled'   => $jmenoN === '' ? '' : $rok . '/' . $jmenoN,
            'w'        => $w,
            'h'        => $h,
            'delka'    => $delka,
            'velikost' => (int) filesize($slozka . '/' . $jmeno),
            'mime'     => $mime,
            'popis'    => $popis,
        ];
        try {
            golf_uprav_manifest(function (array &$m) use ($rok, $polozka): void {
                $m['rocniky'][$rok][] = $polozka;
            });
        } catch (Throwable $e) {
            /* Video vrátit do rozpracovaných — dokončení jde zopakovat,
               nahrané gigabajty se neztratí. */
            golf_presun($slozka . '/' . $jmeno, $part);
            if ($jmenoN !== '') {
                @unlink($slozka . '/' . $jmenoN);
            }
            throw $e;
        }
        golf_smaz_nahravani($nahravani);
        return $polozka;
    });
    return ['polozka' => $polozka];
}

/** @return array<string, mixed> */
function akce_video_zrusit(): array
{
    $vstup = golf_json_vstup();
    $nahravani = golf_nahravani_id($vstup['nahravani'] ?? null);
    golf_pod_zamkem(function () use ($nahravani): void {
        golf_smaz_nahravani($nahravani);
    });
    return [];
}

/* ---------------------------------------------------------------------
   Úpravy položek
   --------------------------------------------------------------------- */

/** @return array<string, mixed> */
function akce_upravit(): array
{
    $vstup = golf_json_vstup();
    $rok = golf_rok($vstup['rok'] ?? null);
    $id = golf_id($vstup['id'] ?? null);
    if (!array_key_exists('popis', $vstup)) {
        golf_chyba(400, 'spatny_vstup', 'Chybí popis.');
    }
    $popis = golf_popis($vstup['popis']);
    $polozka = golf_uprav_manifest(function (array &$m) use ($rok, $id, $popis): array {
        $i = golf_najdi($m, $rok, $id);
        $m['rocniky'][$rok][$i]['popis'] = $popis;
        return $m['rocniky'][$rok][$i];
    });
    return ['polozka' => $polozka];
}

/** @return array<string, mixed> */
function akce_poradi(): array
{
    $vstup = golf_json_vstup();
    $rok = golf_rok($vstup['rok'] ?? null);
    $ids = $vstup['ids'] ?? null;
    $seznam = is_array($ids) && ($ids === [] || array_keys($ids) === range(0, count($ids) - 1));
    if (!$seznam) {
        golf_chyba(400, 'spatne_poradi', 'Pořadí musí být seznam položek.');
    }
    foreach ($ids as $id) {
        golf_id($id);
    }
    $nove = golf_uprav_manifest(function (array &$m) use ($rok, $ids): array {
        $podleId = [];
        foreach ($m['rocniky'][$rok] ?? [] as $p) {
            $podleId[$p['id']] = $p;
        }
        /* Musí to být přesná permutace: stejné položky, každá právě jednou. */
        $jine = count($ids) !== count($podleId) || count(array_unique($ids)) !== count($ids);
        foreach ($ids as $id) {
            $jine = $jine || !isset($podleId[$id]);
        }
        if ($jine) {
            golf_chyba(400, 'spatne_poradi', 'Pořadí nesedí s položkami ročníku — galerie se mezitím možná změnila. Načti ji znovu.');
        }
        $m['rocniky'][$rok] = array_map(function (string $id) use ($podleId): array {
            return $podleId[$id];
        }, $ids);
        return $ids;
    });
    return ['ids' => $nove];
}

/** @return array<string, mixed> */
function akce_presunout(): array
{
    $vstup = golf_json_vstup();
    $rok = golf_rok($vstup['rok'] ?? null);
    $id = golf_id($vstup['id'] ?? null);
    $novy = golf_rok($vstup['novy_rok'] ?? null);
    if ($novy === $rok) {
        golf_chyba(400, 'stejny_rok', 'Položka už v tomhle ročníku je.');
    }
    $cil = golf_slozka_roku($novy);
    /* Soubory se přesouvají pod zámkem a manifest se zapisuje až potom. Když
       zápis manifestu selže (práva, plný disk), soubory se vrátí zpátky —
       jinak by v manifestu zůstala položka bez souborů a v cílovém roce
       osiřelé soubory. */
    $polozka = golf_pod_zamkem(function () use ($rok, $id, $novy, $cil): array {
        $m = golf_nacti_manifest(true);
        $i = golf_najdi($m, $rok, $id);
        $p = $m['rocniky'][$rok][$i];
        $soubory = golf_soubory_polozky($rok, $p);
        if (!isset($soubory['soubor'])) {
            throw new RuntimeException('Položka ' . $id . ' má v manifestu neočekávanou cestu');
        }
        golf_over_media();
        $hotovo = [];
        $vratit = function () use (&$hotovo, $cil): void {
            foreach (array_reverse($hotovo) as $h) {
                if (!golf_presun($cil . '/' . $h['jmeno'], $h['abs'])) {
                    error_log('Galerie: přesun se nepodařilo vrátit: ' . $h['rel']);
                }
            }
        };
        foreach ($soubory as $klic => $s) {
            $p[$klic] = $novy . '/' . $s['jmeno'];
            if (!is_file($s['abs'])) {
                /* Soubor někdo smazal ručně — není co přesouvat, položka jde i tak. */
                error_log('Galerie: při přesunu chybí soubor ' . $s['rel']);
                continue;
            }
            if (is_file($cil . '/' . $s['jmeno']) || !golf_presun($s['abs'], $cil . '/' . $s['jmeno'])) {
                /* Vrátit, co se už přesunulo, ať manifest a disk sedí. */
                $vratit();
                throw new RuntimeException('Nelze přesunout ' . $s['rel'] . ' do roku ' . $novy);
            }
            $hotovo[] = $s;
        }
        if (!isset($soubory['nahled'])) {
            $p['nahled'] = '';
        }
        array_splice($m['rocniky'][$rok], $i, 1);
        $m['rocniky'][$novy][] = $p;
        try {
            golf_uloz_manifest($m);
        } catch (Throwable $e) {
            $vratit();
            throw $e;
        }
        return $p;
    });
    return ['polozka' => $polozka];
}

/** @return array<string, mixed> */
function akce_smazat(): array
{
    $vstup = golf_json_vstup();
    $rok = golf_rok($vstup['rok'] ?? null);
    $id = golf_id($vstup['id'] ?? null);
    $soubory = golf_uprav_manifest(function (array &$m) use ($rok, $id): array {
        $i = golf_najdi($m, $rok, $id);
        $soubory = golf_soubory_polozky($rok, $m['rocniky'][$rok][$i]);
        array_splice($m['rocniky'][$rok], $i, 1);
        return $soubory;
    });
    /* Soubory až po zápisu manifestu — web nikdy neukáže položku bez souboru.
       Co smazat nejde (práva), zůstalo by veřejně na své adrese: správce se
       to musí dozvědět. */
    $zustalo = [];
    foreach ($soubory as $s) {
        if (!@unlink($s['abs'])) {
            clearstatcache(true, $s['abs']);
            if (is_file($s['abs'])) {
                error_log('Galerie: nelze smazat media/' . $s['rel']);
                $zustalo[] = 'media/' . $s['rel'];
            }
        }
    }
    if ($zustalo) {
        return ['varovani' => 'Položka zmizela z webu, ale ' . (count($zustalo) === 1 ? 'soubor' : 'soubory')
            . ' se nepodařilo smazat z disku — smaž ' . (count($zustalo) === 1 ? 'ho' : 'je') . ' ručně přes FTP: '
            . implode(', ', $zustalo) . '.'];
    }
    return [];
}
