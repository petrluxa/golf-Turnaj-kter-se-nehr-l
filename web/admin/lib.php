<?php
/* =====================================================================
   Galerie ročníků — sdílené funkce API
   ---------------------------------------------------------------------
   Session a CSRF, zámky, manifest media/galerie.json, chráněné soubory
   v _data/ a kontrola nahraných souborů. Soubor se jen načítá z api.php;
   při přímém HTTP požadavku nic nevypíše (vrátí 404).

   Kód musí běžet na PHP 8.0 — žádné enumy, readonly, typ `never` ani
   array_is_list().
   ===================================================================== */
declare(strict_types=1);

if (!defined('GOLF_ADMIN')) {
    http_response_code(404);
    exit;
}

date_default_timezone_set('Europe/Prague');

define('GOLF_WEB', dirname(__DIR__));
define('GOLF_MEDIA', GOLF_WEB . '/media');
define('GOLF_DATA', __DIR__ . '/_data');
define('GOLF_TMP', GOLF_DATA . '/tmp');
define('GOLF_MANIFEST', GOLF_MEDIA . '/galerie.json');
define('GOLF_HESLO', GOLF_DATA . '/heslo.php');
define('GOLF_STAV', GOLF_DATA . '/stav.php');
define('GOLF_ZAMEK', GOLF_DATA . '/galerie.lock');

/* První řádek chráněného souboru. Kdo by soubor otevřel přes HTTP, dostane
   prázdnou 404 — JSON za ním se nikdy nevypíše. */
define('GOLF_HLAVICKA', '<?php http_response_code(404); exit; ?>');

/* Prázdná stránka proti výpisu složky (media/, složky roků, _data/tmp …). */
define('GOLF_PRAZDNA_STRANKA', "<!DOCTYPE html>\n<html lang=\"cs\"><head><meta charset=\"utf-8\"><meta name=\"robots\" content=\"noindex\"><title></title></head><body></body></html>\n");

const GOLF_SESSION = 'golf_admin';
const GOLF_ZARIZENI = 'golf_zarizeni';
const GOLF_MAX_ZARIZENI = 10;              /* kolik důvěryhodných zařízení si pamatujeme */
const GOLF_MAX_NAHRAVANI = 4;              /* souběžně rozpracovaná videa */
const GOLF_PRIPONY_VIDEA = ['mp4', 'mov', 'webm', 'm4v'];
const GOLF_MIME_OBRAZKU = ['image/jpeg' => 'jpg', 'image/webp' => 'webp'];

/* Chyba, kterou API vrátí klientovi: HTTP stav, strojový kód a česká věta. */
final class GolfChyba extends Exception
{
    public int $stav;
    public string $kod;
    /** @var array<string, mixed> */
    public array $navic;

    /** @param array<string, mixed> $navic */
    public function __construct(int $stav, string $kod, string $zprava, array $navic = [])
    {
        parent::__construct($zprava);
        $this->stav = $stav;
        $this->kod = $kod;
        $this->navic = $navic;
    }
}

/** @param array<string, mixed> $navic */
function golf_chyba(int $stav, string $kod, string $zprava, array $navic = []): void
{
    throw new GolfChyba($stav, $kod, $zprava, $navic);
}

/* ---------------------------------------------------------------------
   Nastavení: výchozí hodnoty, config.php je může přepsat
   --------------------------------------------------------------------- */

/** @return array<string, int> */
function golf_nastaveni(): array
{
    static $n = null;
    if ($n !== null) {
        return $n;
    }
    $n = [
        'max_foto_bajtu'    => 8 * 1024 * 1024,
        'max_nahled_bajtu'  => 1024 * 1024,
        'max_video_bajtu'   => 1024 * 1024 * 1024,
        'max_celkem_bajtu'  => 20 * 1024 * 1024 * 1024,   /* celá galerie včetně rozpracovaných videí */
        'max_strana_foto'   => 4096,
        'max_strana_nahled' => 1024,
        'max_strana_plakat' => 1280,
        'prihlaseni_pokusu' => 10,
        'prihlaseni_okno_s' => 15 * 60,
        'session_dni'       => 30,
    ];
    $soubor = __DIR__ . '/config.php';
    if (is_file($soubor)) {
        $vlastni = require $soubor;
        if (is_array($vlastni)) {
            foreach ($vlastni as $klic => $hodnota) {
                if (!array_key_exists($klic, $n)) {
                    continue;
                }
                if (is_float($hodnota) && is_finite($hodnota) && $hodnota == floor($hodnota)) {
                    $hodnota = (int) $hodnota;
                }
                if (is_int($hodnota) && $hodnota > 0) {
                    $n[$klic] = $hodnota;
                }
            }
        }
    }
    return $n;
}

/* "2M", "512K", "1G" → bajty. 0 = bez omezení. */
function golf_ini_bajty(string $hodnota): int
{
    if (!preg_match('/^\s*(\d+)\s*([kmg]?)/i', $hodnota, $m)) {
        return 0;
    }
    $n = (int) $m[1];
    switch (strtolower($m[2])) {
        case 'g':
            $n *= 1024;
            // propadne dál
        case 'm':
            $n *= 1024;
            // propadne dál
        case 'k':
            $n *= 1024;
    }
    return $n;
}

function golf_upload_max(): int
{
    $n = golf_ini_bajty((string) ini_get('upload_max_filesize'));
    return $n > 0 ? $n : PHP_INT_MAX;
}

function golf_post_max(): int
{
    $n = golf_ini_bajty((string) ini_get('post_max_size'));
    return $n > 0 ? $n : PHP_INT_MAX;
}

/* Velikost kusu videa: vejde se do upload_max_filesize i do post_max_size
   (s rezervou 256 KiB na zbytek formuláře), nejvýš 8 MiB, aspoň 256 KiB. */
function golf_kus_bajtu(): int
{
    $post = golf_post_max();
    $post = $post === PHP_INT_MAX ? $post : $post - 256 * 1024;
    return max(256 * 1024, min(golf_upload_max(), $post, 8 * 1024 * 1024));
}

/* Limity, které opravdu platí: nastavení, ale nejvýš upload_max_filesize
   (větší soubor by PHP stejně nepřijalo) a fotka s náhledem se musí vejít
   do jednoho požadavku (post_max_size, rezerva 256 KiB). */
/** @return array<string, int> */
function golf_limity(): array
{
    $n = golf_nastaveni();
    $post = golf_post_max();
    $nahled = min($n['max_nahled_bajtu'], golf_upload_max());
    $foto = min($n['max_foto_bajtu'], golf_upload_max());
    if ($post !== PHP_INT_MAX) {
        $nahled = max(64 * 1024, min($nahled, intdiv($post, 4)));
        $foto = max(256 * 1024, min($foto, $post - 256 * 1024 - $nahled));
    }
    return [
        'kus_bajtu'        => golf_kus_bajtu(),
        'max_foto_bajtu'   => $foto,
        'max_nahled_bajtu' => $nahled,
        'max_video_bajtu'  => $n['max_video_bajtu'],
    ];
}

/* ---------------------------------------------------------------------
   Soubory: atomický zápis, chráněné soubory, složky
   --------------------------------------------------------------------- */

/* Složka webu, jak ji zná správce z FTP (do hlášek pro člověka — bez
   absolutních cest serveru). */
function golf_nazev_slozky(string $cesta): string
{
    $cesta = str_replace('\\', '/', $cesta);
    foreach ([GOLF_TMP => 'admin/_data/tmp', GOLF_DATA => 'admin/_data', GOLF_MEDIA => 'media'] as $abs => $nazev) {
        $abs = str_replace('\\', '/', $abs);
        if ($cesta === $abs || strncmp($cesta, $abs . '/', strlen($abs) + 1) === 0) {
            return $nazev;
        }
    }
    return 'golf';
}

/* Zápis selhal (práva, plný disk, kvóta): srozumitelná hláška pro správce,
   podrobnosti jen do error_log. */
function golf_chyba_zapisu(string $cesta, string $detail): GolfChyba
{
    error_log('Galerie: ' . $detail);
    return new GolfChyba(500, 'nelze_zapsat', 'Na serveru nejde zapisovat do složky ' . golf_nazev_slozky(dirname($cesta))
        . ' — zkontroluj práva nebo volné místo na hostingu.');
}

/* Zapíše obsah do dočasného souboru ve stejné složce a přejmenuje ho na
   cíl. Čtenář tak nikdy neuvidí napůl zapsaný soubor. */
function golf_zapis_atomicky(string $cesta, string $obsah): void
{
    $tmp = $cesta . '.' . bin2hex(random_bytes(6)) . '.tmp';
    if (@file_put_contents($tmp, $obsah) !== strlen($obsah)) {
        @unlink($tmp);
        throw golf_chyba_zapisu($cesta, 'nelze zapsat dočasný soubor ' . $tmp);
    }
    /* Na Windows může rename chvíli selhávat, když soubor zrovna někdo čte. */
    for ($i = 0; $i < 8; $i++) {
        if (@rename($tmp, $cesta)) {
            return;
        }
        usleep(25000 * ($i + 1));
    }
    @unlink($tmp);
    throw golf_chyba_zapisu($cesta, 'nelze přejmenovat ' . $tmp . ' na ' . $cesta);
}

/** @return array<mixed>|null */
function golf_cti_chraneny(string $cesta): ?array
{
    $obsah = @file_get_contents($cesta);
    if ($obsah === false) {
        return null;
    }
    $konec = strpos($obsah, "\n");
    if ($konec === false) {
        return null;
    }
    $data = json_decode(substr($obsah, $konec + 1), true);
    return is_array($data) ? $data : null;
}

/* JSON_HEX_TAG: v souboru se nikdy neobjeví "<", takže ani "<?php" —
   zbytek souboru za hlavičkou PHP nemůže nic spustit ani rozbít. */
/** @param array<mixed> $data */
function golf_zapis_chraneny(string $cesta, array $data): void
{
    $json = json_encode($data, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    golf_zapis_atomicky($cesta, GOLF_HLAVICKA . "\n" . $json);
}

/* Vytvoří složku (i s prázdným index.html proti výpisu). Vrací, jestli jde
   do složky zapisovat. */
function golf_zajisti_slozku(string $cesta, int $prava = 0755): bool
{
    if (!is_dir($cesta)) {
        if (!@mkdir($cesta, $prava, true) && !is_dir($cesta)) {
            return false;
        }
    }
    $index = $cesta . '/index.html';
    if (!is_file($index)) {
        @file_put_contents($index, GOLF_PRAZDNA_STRANKA);
    }
    return is_writable($cesta);
}

/* Jeden zámek (_data/galerie.lock) pro všechno, co mění sdílený stav:
   manifest, počítadlo přihlášení a dokončení/zrušení nahrávání videa.
   Je re-entrantní — kdo ho drží, smí volat funkce, které zamykají znovu
   (druhý flock na tentýž soubor ve stejném procesu by se zablokoval). */
final class GolfZamek
{
    /** @var resource|null */
    private static $soubor = null;
    private static int $hloubka = 0;

    public static function zamkni(): void
    {
        if (self::$hloubka > 0) {
            self::$hloubka++;
            return;
        }
        $f = @fopen(GOLF_ZAMEK, 'c');
        if ($f === false) {
            throw new GolfChyba(500, 'nelze_zapsat', 'Na serveru nejde zapisovat do složky admin/_data — zkontroluj práva.');
        }
        if (!flock($f, LOCK_EX)) {
            fclose($f);
            throw new RuntimeException('flock selhal na ' . GOLF_ZAMEK);
        }
        self::$soubor = $f;
        self::$hloubka = 1;
    }

    public static function odemkni(): void
    {
        if (self::$hloubka <= 0) {
            return;
        }
        self::$hloubka--;
        if (self::$hloubka === 0 && self::$soubor !== null) {
            flock(self::$soubor, LOCK_UN);
            fclose(self::$soubor);
            self::$soubor = null;
        }
    }
}

/* Spustí $prace pod zámkem a vrátí, co vrátila. */
/** @return mixed */
function golf_pod_zamkem(callable $prace)
{
    GolfZamek::zamkni();
    try {
        return $prace();
    } finally {
        GolfZamek::odemkni();
    }
}

/* Přesun souboru v rámci webu (media/ i _data/ jsou na stejném disku).
   Rename je atomický — když se o totéž pokusí dva požadavky, projde jen
   jeden. Kopie se schválně nedělá, ta by atomická nebyla. Opakuje se jen
   kvůli Windows, kde rename selže, dokud soubor drží otevřený jiný proces. */
function golf_presun(string $z, string $do): bool
{
    for ($i = 0; $i < 8; $i++) {
        if (@rename($z, $do)) {
            return true;
        }
        clearstatcache(true, $z);
        if (!is_file($z) || is_file($do)) {
            return false;
        }
        usleep(25000 * ($i + 1));
    }
    return false;
}

/* ---------------------------------------------------------------------
   Ročníky z turnaj.json
   --------------------------------------------------------------------- */

/** @return int[] roky sestupně */
function golf_roky(): array
{
    static $roky = null;
    if ($roky !== null) {
        return $roky;
    }
    $roky = [];
    $json = @file_get_contents(GOLF_WEB . '/turnaj.json');
    $data = $json === false ? null : json_decode($json, true);
    if (!is_array($data) || !isset($data['rocniky']) || !is_array($data['rocniky'])) {
        error_log('Galerie: nelze přečíst ročníky z turnaj.json');
        return $roky;
    }
    foreach ($data['rocniky'] as $r) {
        $rok = is_array($r) ? ($r['rok'] ?? null) : null;
        if (is_string($rok) && preg_match('/^\d{4}\z/', $rok)) {
            $rok = (int) $rok;
        }
        if (is_int($rok) && $rok >= 1900 && $rok <= 2999) {
            $roky[] = $rok;
        }
    }
    $roky = array_values(array_unique($roky));
    rsort($roky);
    return $roky;
}

/* Rok ze vstupu → celé číslo z roky, jinak 400. Nic jiného se do cest nedostane. */
/** @param mixed $v */
function golf_rok($v): int
{
    $rok = null;
    if (is_int($v)) {
        $rok = $v;
    } elseif (is_string($v) && preg_match('/^\d{4}\z/', $v)) {
        $rok = (int) $v;
    }
    if ($rok === null || !in_array($rok, golf_roky(), true)) {
        golf_chyba(400, 'spatny_rok', 'Takový ročník v archivu není.');
    }
    return (int) $rok;
}

/** @param mixed $v */
function golf_id($v): string
{
    if (!is_string($v) || !preg_match('/^[0-9a-f]{16}\z/', $v)) {
        golf_chyba(400, 'spatne_id', 'Neplatný identifikátor položky.');
    }
    return $v;
}

/** @param mixed $v */
function golf_nahravani_id($v): string
{
    if (!is_string($v) || !preg_match('/^[0-9a-f]{32}\z/', $v)) {
        golf_chyba(400, 'spatne_nahravani', 'Neplatný identifikátor nahrávání.');
    }
    return $v;
}

/* Popis: prostý text, max. 300 znaků, bez řídicích znaků. */
/** @param mixed $v */
function golf_popis($v): string
{
    if ($v === null) {
        return '';
    }
    if (!is_string($v) || strlen($v) > 4000 || !preg_match('//u', $v)) {
        golf_chyba(400, 'spatny_popis', 'Popis musí být obyčejný text.');
    }
    $v = (string) preg_replace('/[\r\n\t\x{2028}\x{2029}]+/u', ' ', $v);
    /* Řídicí znaky a neviditelné přepínače směru textu (dají se jimi maskovat texty). */
    $v = (string) preg_replace('/[\p{Cc}\x{200E}\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}]/u', '', $v);
    $v = trim($v);
    if (preg_match_all('/./su', $v) > 300) {
        golf_chyba(400, 'popis_dlouhy', 'Popis může mít nejvýš 300 znaků.');
    }
    return $v;
}

/* Číslo od klienta (délka, rozměry videa): když nedává smysl, je z něj 0. */
/** @param mixed $v */
function golf_cislo($v, float $max, bool $cele)
{
    if (is_string($v)) {
        $v = trim($v);
        $v = is_numeric($v) ? (float) $v : 0.0;
    } elseif (is_int($v)) {
        $v = (float) $v;
    } elseif (!is_float($v)) {
        $v = 0.0;
    }
    if (!is_finite($v) || $v < 0 || $v > $max) {
        $v = 0.0;
    }
    return $cele ? (int) round($v) : round($v, 1);
}

/* ---------------------------------------------------------------------
   Manifest media/galerie.json
   --------------------------------------------------------------------- */

/* Načte manifest. Když neexistuje, je galerie prázdná. Poškozený manifest
   se při $prisne nesmí přepsat prázdným — to by smazalo celou galerii.
   Totéž platí pro jednotlivé neplatné položky (ruční úprava souboru): při
   zápisu by z manifestu tiše zmizely a jejich soubory by v media/ osiřely,
   proto se zápis odmítne. Bez $prisne se neplatné části jen vynechají
   a $poskozeny řekne, že soubor není v pořádku (správa ukáže varování). */
/** @return array{verze:int, upraveno:?string, rocniky:array<int, array<int, array<string, mixed>>>} */
function golf_nacti_manifest(bool $prisne = false, ?bool &$poskozeny = null): array
{
    $poskozeny = false;
    $prazdny = ['verze' => 1, 'upraveno' => null, 'rocniky' => []];
    clearstatcache(true, GOLF_MANIFEST);
    if (!is_file(GOLF_MANIFEST)) {
        return $prazdny;
    }
    $json = @file_get_contents(GOLF_MANIFEST);
    $data = $json === false ? null : json_decode($json, true);
    if (!is_array($data) || !isset($data['rocniky']) || !is_array($data['rocniky'])) {
        error_log('Galerie: manifest galerie.json je poškozený');
        if ($prisne) {
            throw new GolfChyba(500, 'poskozeny_manifest', 'Soubor galerie.json je poškozený — oprav ho nebo ho obnov ze zálohy.');
        }
        $poskozeny = true;
        return $prazdny;
    }
    $rocniky = [];
    foreach ($data['rocniky'] as $rok => $polozky) {
        if (!preg_match('/^\d{4}\z/', (string) $rok) || !is_array($polozky)) {
            $poskozeny = true;
            continue;
        }
        $seznam = [];
        foreach ($polozky as $p) {
            if (is_array($p) && is_string($p['id'] ?? null) && preg_match('/^[0-9a-f]{16}\z/', $p['id'])) {
                $seznam[] = $p;
            } else {
                $poskozeny = true;
            }
        }
        if ($seznam) {
            $rocniky[(int) $rok] = $seznam;
        }
    }
    if ($poskozeny) {
        error_log('Galerie: manifest galerie.json obsahuje neplatné ročníky nebo položky');
        if ($prisne) {
            throw new GolfChyba(500, 'poskozeny_manifest',
                'Soubor galerie.json obsahuje neplatné položky — oprav ho nebo ho obnov ze zálohy. Dokud to nepůjde, nic se neuloží.');
        }
    }
    krsort($rocniky);
    return [
        'verze'    => 1,
        'upraveno' => is_string($data['upraveno'] ?? null) ? $data['upraveno'] : null,
        'rocniky'  => $rocniky,
    ];
}

/* Manifest pro JSON: rocniky je vždy objekt, i prázdný. */
/** @param array<string, mixed> $m @return array<string, mixed> */
function golf_manifest_pro_json(array $m): array
{
    $m['rocniky'] = (object) $m['rocniky'];
    return $m;
}

/** @param array<string, mixed> $m */
function golf_uloz_manifest(array $m): void
{
    $rocniky = [];
    foreach ($m['rocniky'] as $rok => $polozky) {
        if ($polozky) {
            $rocniky[(int) $rok] = array_values($polozky);
        }
    }
    krsort($rocniky);
    $m = ['verze' => 1, 'upraveno' => date('c'), 'rocniky' => $rocniky];
    $json = json_encode(golf_manifest_pro_json($m),
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR);
    golf_over_media();
    golf_zapis_atomicky(GOLF_MANIFEST, $json . "\n");
}

/* Složka media/ musí existovat (nahraná i s .htaccess, který v ní zakazuje
   skripty) a musí do ní jít zapisovat. Sama se schválně nezakládá — bez
   .htaccess by v ní nebyla obrana do hloubky. */
function golf_over_media(): void
{
    clearstatcache(true, GOLF_MEDIA);
    if (!is_dir(GOLF_MEDIA)) {
        throw new GolfChyba(500, 'chybi_media', 'Na serveru chybí složka golf/media — nahraj ji z web/media i s .htaccess a index.html.');
    }
    if (!is_writable(GOLF_MEDIA)) {
        throw new GolfChyba(500, 'nelze_zapsat', 'Na serveru nejde zapisovat do složky media — zkontroluj práva.');
    }
}

/* Čtení-úprava-zápis manifestu pod zámkem. $uprava dostane manifest
   referencí; když vyhodí výjimku, nic se nezapíše. */
/** @return mixed co vrátila $uprava */
function golf_uprav_manifest(callable $uprava)
{
    return golf_pod_zamkem(function () use ($uprava) {
        $m = golf_nacti_manifest(true);
        $vysledek = $uprava($m);
        golf_uloz_manifest($m);
        return $vysledek;
    });
}

/* Index položky v roce, nebo 404. */
/** @param array<string, mixed> $m */
function golf_najdi(array $m, int $rok, string $id): int
{
    foreach ($m['rocniky'][$rok] ?? [] as $i => $p) {
        if (($p['id'] ?? null) === $id) {
            return (int) $i;
        }
    }
    throw new GolfChyba(404, 'nenalezeno', 'Položka nebyla nalezena — možná ji mezitím někdo smazal nebo přesunul.');
}

/* Soubory položky na disku. Cesta se skládá jen z ověřeného roku, id a
   přípony; co v manifestu neodpovídá přesně vzoru, se nepoužije. */
/** @param array<string, mixed> $p @return array<string, array{rel:string, abs:string, jmeno:string}> */
function golf_soubory_polozky(int $rok, array $p): array
{
    $ven = [];
    foreach (['soubor' => '', 'nahled' => '_n'] as $klic => $pripona) {
        $rel = $p[$klic] ?? '';
        if (!is_string($rel) || $rel === '') {
            continue;
        }
        if (!preg_match('/^(\d{4})\/([0-9a-f]{16})(_n)?\.(jpg|webp|mp4|mov|webm|m4v)\z/', $rel, $m)) {
            continue;
        }
        if ((int) $m[1] !== $rok || $m[2] !== $p['id'] || ($m[3] ?? '') !== $pripona) {
            continue;
        }
        $jmeno = $m[2] . $m[3] . '.' . $m[4];
        $ven[$klic] = ['rel' => $rok . '/' . $jmeno, 'abs' => GOLF_MEDIA . '/' . $rok . '/' . $jmeno, 'jmeno' => $jmeno];
    }
    return $ven;
}

/* Složka roku v media/ (vytvoří se na požádání; media/ sama ne). */
function golf_slozka_roku(int $rok): string
{
    golf_over_media();
    $slozka = GOLF_MEDIA . '/' . $rok;
    if (!golf_zajisti_slozku($slozka, 0755)) {
        throw new GolfChyba(500, 'nelze_zapsat', 'Na serveru nejde zapisovat do složky media — zkontroluj práva.');
    }
    return $slozka;
}

/* Nové id, které na disku ještě nic nezabírá. */
function golf_nove_id(int $rok): string
{
    for ($i = 0; $i < 10; $i++) {
        $id = bin2hex(random_bytes(8));
        if (!glob(GOLF_MEDIA . '/' . $rok . '/' . $id . '*')) {
            return $id;
        }
    }
    throw new RuntimeException('Nelze vygenerovat volné id');
}

/* ---------------------------------------------------------------------
   Nahrané soubory
   --------------------------------------------------------------------- */

/* Nahraný soubor z $_FILES[$pole] → [tmp, velikost], nebo null (nepovinný
   chybí). Pole souborů (soubor[]) ani cizí jména se nepřijímají. */
/** @return array{tmp:string, velikost:int}|null */
function golf_nahrany(string $pole, int $max, bool $povinny, string $co): ?array
{
    $f = $_FILES[$pole] ?? null;
    if ($f === null) {
        if ($povinny) {
            golf_chyba(400, 'chybi_soubor', 'Chybí soubor: ' . $co . '.');
        }
        return null;
    }
    if (!is_array($f) || !is_int($f['error'] ?? null) || !is_string($f['tmp_name'] ?? null)) {
        golf_chyba(400, 'spatny_vstup', 'Neplatný požadavek.');
    }
    switch ($f['error']) {
        case UPLOAD_ERR_OK:
            break;
        case UPLOAD_ERR_NO_FILE:
            if ($povinny) {
                golf_chyba(400, 'chybi_soubor', 'Chybí soubor: ' . $co . '.');
            }
            return null;
        case UPLOAD_ERR_INI_SIZE:
        case UPLOAD_ERR_FORM_SIZE:
            golf_chyba(413, 'prilis_velke', ucfirst($co) . ' je moc ' . golf_rod($co, 'velký', 'velká')
                . ' — server ' . golf_rod($co, 'ho', 'ji') . ' nepřijme.');
            break;
        case UPLOAD_ERR_PARTIAL:
            golf_chyba(400, 'prenos_prerusen', ucfirst($co) . ' ' . golf_rod($co, 'nedorazil celý', 'nedorazila celá')
                . ' — zkus to znovu.');
            break;
        default:
            throw new RuntimeException('Chyba nahrávání ' . $pole . ': ' . $f['error']);
    }
    if (!is_uploaded_file($f['tmp_name'])) {
        golf_chyba(400, 'spatny_vstup', 'Neplatný požadavek.');
    }
    $velikost = (int) filesize($f['tmp_name']);
    if ($velikost <= 0) {
        golf_chyba(400, 'prazdny_soubor', ucfirst($co) . ' je ' . golf_rod($co, 'prázdný', 'prázdná') . '.');
    }
    if ($velikost > $max) {
        golf_chyba(413, 'prilis_velke', ucfirst($co) . ' je moc ' . golf_rod($co, 'velký', 'velká')
            . ' (nejvýš ' . golf_mb($max) . ').');
    }
    return ['tmp' => $f['tmp_name'], 'velikost' => $velikost];
}

/* Hlášky se skládají z názvu souboru („fotka“, „náhled“, „plakát“, „kus
   videa“) — přídavná jména musí sedět s jeho rodem. */
function golf_rod(string $co, string $muzsky, string $zensky): string
{
    return $co === 'fotka' ? $zensky : $muzsky;
}

function golf_mb(int $bajty): string
{
    if ($bajty >= 1024 * 1024 * 1024) {
        return str_replace('.', ',', (string) round($bajty / (1024 * 1024 * 1024), 1)) . ' GB';
    }
    return str_replace('.', ',', (string) round($bajty / (1024 * 1024), 1)) . ' MB';
}

/* Obsahuje soubor "<?php"? Obrázky z prohlížeče ho nemají nikdy. Je to jen
   hrubé síto proti nejběžnějšímu vložení PHP do metadat obrázku — krátké
   značky "<?=" a "<?" nezachytí (v datech JPEGu se ty dva až tři bajty
   vyskytují náhodně, hledání by odmítalo i poctivé fotky). Skutečná ochrana
   je jinde: soubory mají vždy příponu .jpg/.webp podle obsahu, jméno určuje
   server a media/.htaccess v ní skripty nespustí. */
function golf_obsahuje_php(string $cesta): bool
{
    $f = @fopen($cesta, 'rb');
    if ($f === false) {
        return true;
    }
    $zbytek = '';
    while (!feof($f)) {
        $blok = fread($f, 1024 * 1024);
        if ($blok === false) {
            break;
        }
        if (stripos($zbytek . $blok, '<?php') !== false) {
            fclose($f);
            return true;
        }
        $zbytek = substr($blok, -4);
    }
    fclose($f);
    return false;
}

/* Obrázek přes getimagesize (GD na hostingu být nemusí): jen JPEG a WebP,
   delší strana do $maxStrana. Vrací rozměry, MIME a příponu. */
/** @return array{w:int, h:int, mime:string, ext:string} */
function golf_over_obrazek(string $cesta, int $maxStrana, string $co): array
{
    $info = @getimagesize($cesta);
    if (!is_array($info) || empty($info[0]) || empty($info[1])) {
        golf_chyba(400, 'neni_obrazek', ucfirst($co) . ' není obrázek JPG ani WebP.');
    }
    $mime = is_string($info['mime'] ?? null) ? $info['mime'] : '';
    if (!isset(GOLF_MIME_OBRAZKU[$mime])) {
        golf_chyba(400, 'spatny_format', ucfirst($co) . ' musí být JPG nebo WebP.');
    }
    $w = (int) $info[0];
    $h = (int) $info[1];
    if (max($w, $h) > $maxStrana) {
        golf_chyba(400, 'prilis_velky_rozmer', ucfirst($co) . ' je moc ' . golf_rod($co, 'velký', 'velká')
            . ': delší strana může mít nejvýš ' . $maxStrana . ' px.');
    }
    if (golf_obsahuje_php($cesta)) {
        golf_chyba(400, 'neni_obrazek', ucfirst($co) . ' není obrázek JPG ani WebP.');
    }
    return ['w' => $w, 'h' => $h, 'mime' => $mime, 'ext' => GOLF_MIME_OBRAZKU[$mime]];
}

/* Nahraný soubor na místo v media/. */
function golf_uloz_nahrany(string $tmp, string $cil): void
{
    if (!@move_uploaded_file($tmp, $cil)) {
        throw new GolfChyba(500, 'nelze_zapsat', 'Soubor se nepodařilo uložit — zkontroluj práva ke složce media.');
    }
    @chmod($cil, 0644);
}

/* MIME videa podle obsahu. Primárně finfo; kdyby na hostingu chybělo,
   stačí hlavička kontejneru (ftyp / EBML). */
function golf_mime_videa(string $cesta): string
{
    if (class_exists('finfo')) {
        $fi = new finfo(FILEINFO_MIME_TYPE);
        $mime = @$fi->file($cesta);
        return is_string($mime) ? $mime : '';
    }
    $f = @fopen($cesta, 'rb');
    $hlava = $f === false ? '' : (string) fread($f, 64);
    if ($f !== false) {
        fclose($f);
    }
    if (strlen($hlava) >= 12 && substr($hlava, 4, 4) === 'ftyp') {
        $znacka = substr($hlava, 8, 4);
        if ($znacka === 'qt  ') {
            return 'video/quicktime';
        }
        return strncmp($znacka, 'M4V', 3) === 0 ? 'video/x-m4v' : 'video/mp4';
    }
    if (strlen($hlava) >= 8 && in_array(substr($hlava, 4, 4), ['moov', 'mdat', 'wide', 'free'], true)) {
        return 'video/quicktime';
    }
    if (strncmp($hlava, "\x1A\x45\xDF\xA3", 4) === 0 && strpos($hlava, 'webm') !== false) {
        return 'video/webm';
    }
    return 'application/octet-stream';
}

/* Sedí MIME obsahu s příponou? mp4/m4v smí být video/mp4 i video/x-m4v. */
function golf_video_sedi(string $ext, string $mime): bool
{
    $povolene = [
        'mp4'  => ['video/mp4', 'video/x-m4v'],
        'm4v'  => ['video/mp4', 'video/x-m4v'],
        'mov'  => ['video/quicktime'],
        'webm' => ['video/webm'],
    ];
    return in_array($mime, $povolene[$ext] ?? [], true);
}

/* Začíná soubor hlavičkou videokontejneru, který sedí s příponou? Kontroluje
   se už první kus videa: rozpracovaný _data/tmp/<nahravani>.part pak nikdy
   nezačíná jako HTML, takže ho prohlížeč neočichá jako stránku, ani kdyby
   _data/.htaccess na hostingu nefungoval. (Celý soubor ověří finfo až při
   dokončení.) */
function golf_zacatek_videa(string $cesta, string $ext): bool
{
    $f = @fopen($cesta, 'rb');
    $hlava = $f === false ? '' : (string) fread($f, 12);
    if ($f !== false) {
        fclose($f);
    }
    if ($ext === 'webm') {
        return strncmp($hlava, "\x1A\x45\xDF\xA3", 4) === 0;          /* EBML */
    }
    /* MP4/MOV/M4V: první atom má na bajtech 4–7 svůj typ. */
    return strlen($hlava) >= 8
        && in_array(substr($hlava, 4, 4), ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot'], true);
}

/* Metadata rozpracovaného nahrávání videa (_data/tmp/<nahravani>.php). */
/** @return array{rok:int, ext:string, velikost:int, vytvoreno:int}|null */
function golf_meta_nahravani(string $nahravani): ?array
{
    $meta = golf_cti_chraneny(GOLF_TMP . '/' . $nahravani . '.php');
    if ($meta === null
        || !is_int($meta['rok'] ?? null)
        || !in_array($meta['ext'] ?? null, GOLF_PRIPONY_VIDEA, true)
        || !is_int($meta['velikost'] ?? null) || $meta['velikost'] <= 0) {
        return null;
    }
    return [
        'rok'       => $meta['rok'],
        'ext'       => $meta['ext'],
        'velikost'  => $meta['velikost'],
        'vytvoreno' => is_int($meta['vytvoreno'] ?? null) ? $meta['vytvoreno'] : 0,
    ];
}

/* Smaže rozpracovaná nahrávání, na která nikdo nesáhl $stari sekund
   (výchozí 24 hodin — zavřená stránka, výpadek). */
function golf_uklid_tmp(int $stari = 24 * 3600): void
{
    $hranice = time() - $stari;
    $skupiny = [];
    foreach (glob(GOLF_TMP . '/*') ?: [] as $soubor) {
        $jmeno = basename($soubor);
        if ($jmeno === 'index.html' || !is_file($soubor)) {
            continue;
        }
        $klic = preg_match('/^([0-9a-f]{32})\./', $jmeno, $m) ? $m[1] : $jmeno;
        $skupiny[$klic][] = $soubor;
    }
    foreach ($skupiny as $soubory) {
        $nejnovejsi = 0;
        foreach ($soubory as $s) {
            $nejnovejsi = max($nejnovejsi, (int) @filemtime($s));
        }
        if ($nejnovejsi < $hranice) {
            foreach ($soubory as $s) {
                @unlink($s);
            }
        }
    }
}

/* Smaže soubory jednoho nahrávání. */
function golf_smaz_nahravani(string $nahravani): void
{
    @unlink(GOLF_TMP . '/' . $nahravani . '.part');
    @unlink(GOLF_TMP . '/' . $nahravani . '.php');
}

/* Rozpracovaná nahrávání: nahravani => ohlášená velikost. */
/** @return array<string, int> */
function golf_rozpracovana(): array
{
    $ven = [];
    foreach (glob(GOLF_TMP . '/*.php') ?: [] as $soubor) {
        $nahravani = basename($soubor, '.php');
        if (preg_match('/^[0-9a-f]{32}\z/', $nahravani)) {
            $meta = golf_meta_nahravani($nahravani);
            $ven[$nahravani] = $meta === null ? 0 : $meta['velikost'];
        }
    }
    return $ven;
}

/* Kolik bajtů zabírá _data/tmp (rozpracovaná videa). */
function golf_bajtu_tmp(): int
{
    $soucet = 0;
    foreach (glob(GOLF_TMP . '/*') ?: [] as $soubor) {
        if (is_file($soubor) && basename($soubor) !== 'index.html') {
            $soucet += (int) @filesize($soubor);
        }
    }
    return $soucet;
}

/* Součet velikostí souborů v manifestu. */
/** @param array<string, mixed> $m */
function golf_obsazeno(array $m): int
{
    $soucet = 0;
    foreach ($m['rocniky'] as $polozky) {
        foreach ($polozky as $p) {
            $soucet += is_int($p['velikost'] ?? null) && $p['velikost'] > 0 ? $p['velikost'] : 0;
        }
    }
    return $soucet;
}

/* Celkový limit galerie (max_celkem_bajtu): disk hostingu sdílí i MatchPulse,
   galerie ho nesmí zaplnit — ani s ukradeným přihlášením, ani chybou klienta. */
function golf_over_misto(int $navic): void
{
    $max = golf_nastaveni()['max_celkem_bajtu'];
    /* Rozpracovaná videa se počítají ohlášenou velikostí — ještě dorostou. */
    $celkem = golf_obsazeno(golf_nacti_manifest()) + max(golf_bajtu_tmp(), array_sum(golf_rozpracovana()));
    if ($celkem + $navic > $max) {
        golf_chyba(413, 'plno', 'Galerie je plná (limit ' . golf_mb($max) . ', obsazeno ' . golf_mb($celkem)
            . ') — smaž, co už není potřeba, nebo limit zvyš v admin/config.php (max_celkem_bajtu).');
    }
}

/* ---------------------------------------------------------------------
   Heslo a počítadlo neúspěšných přihlášení
   --------------------------------------------------------------------- */

/* Hash hesla z _data/heslo.php. Čte se jako text, ne přes require —
   OPcache by po změně hesla mohla chvíli vracet starý hash. */
function golf_hash_hesla(): ?string
{
    $obsah = @file_get_contents(GOLF_HESLO);
    if ($obsah === false || !preg_match("/return\\s*'([^'\\\\]{20,})'\\s*;/", $obsah, $m)) {
        return null;
    }
    return $m[1];
}

function golf_uloz_hash_hesla(string $hash): void
{
    if (!preg_match('/^[^\'\\\\]{20,}\z/', $hash)) {
        throw new RuntimeException('Neočekávaný tvar hashe hesla');
    }
    if (!golf_zajisti_slozku(GOLF_DATA, 0755)) {
        throw new GolfChyba(500, 'nelze_zapsat', 'Na serveru nejde zapisovat do složky admin/_data — zkontroluj práva.');
    }
    golf_zapis_atomicky(GOLF_HESLO, "<?php return '" . $hash . "';\n");
    if (function_exists('opcache_invalidate')) {
        @opcache_invalidate(GOLF_HESLO, true);
    }
}

/* Délka textu ve znacích (bez mbstring). */
function golf_delka(string $s): int
{
    $n = preg_match_all('/./su', $s);
    return $n === false ? strlen($s) : $n;
}

/* Throttling je globální — hosting je za proxy, IP adresy nejsou spolehlivé.
   Pokus se počítá jako neúspěch už předem (pod zámkem), aby souběžné pokusy
   nemohly limit obejít; úspěch počítadlo vynuluje.

   Výjimka: důvěryhodné zařízení. Po úspěšném přihlášení dostane prohlížeč
   dlouhodobou cookie golf_zarizeni s náhodným tokenem (na serveru je v
   _data/stav.php jen jeho sha256). Pokusy z takového prohlížeče se počítají
   zvlášť — kdo schválně vyčerpá globální limit, nezablokuje majitele na jeho
   telefonu ani počítači. Cookie sama nic nepřihlásí, dává jen vlastní
   počítadlo se stejným limitem. */

/* sha256 tokenu zařízení z cookie, nebo null. */
function golf_klic_zarizeni(): ?string
{
    $c = $_COOKIE[GOLF_ZARIZENI] ?? null;
    return is_string($c) && preg_match('/^[0-9a-f]{32}\z/', $c) ? hash('sha256', $c) : null;
}

/* Neúspěšné pokusy v okně (starší ani „z budoucnosti“ se nepočítají), vzestupně. */
/** @param mixed $seznam @return int[] */
function golf_pokusy_v_okne($seznam, int $ted, int $okno): array
{
    $ven = [];
    foreach (is_array($seznam) ? $seznam : [] as $t) {
        if (is_int($t) && $t > $ted - $okno && $t <= $ted + 60) {
            $ven[] = $t;
        }
    }
    sort($ven);
    return $ven;
}

/* Stav throttlingu z _data/stav.php: globální pokusy a známá zařízení. */
/** @return array{neuspechy:int[], zarizeni:array<string, array{neuspechy:int[], posledni:int}>} */
function golf_cti_stav_prihlaseni(int $ted, int $okno): array
{
    $stav = golf_cti_chraneny(GOLF_STAV) ?? [];
    $zarizeni = [];
    foreach (is_array($stav['zarizeni'] ?? null) ? $stav['zarizeni'] : [] as $klic => $z) {
        if (is_string($klic) && preg_match('/^[0-9a-f]{64}\z/', $klic) && is_array($z)) {
            $zarizeni[$klic] = [
                'neuspechy' => golf_pokusy_v_okne($z['neuspechy'] ?? null, $ted, $okno),
                'posledni'  => is_int($z['posledni'] ?? null) ? $z['posledni'] : 0,
            ];
        }
    }
    return ['neuspechy' => golf_pokusy_v_okne($stav['neuspechy'] ?? null, $ted, $okno), 'zarizeni' => $zarizeni];
}

/** @param array{neuspechy:int[], zarizeni:array<string, array{neuspechy:int[], posledni:int}>} $stav */
function golf_uloz_stav_prihlaseni(array $stav): void
{
    /* Nejvýš GOLF_MAX_ZARIZENI zařízení — nejdéle nepoužitá se zapomenou. */
    uasort($stav['zarizeni'], function (array $a, array $b): int {
        return $b['posledni'] <=> $a['posledni'];
    });
    $stav['zarizeni'] = (object) array_slice($stav['zarizeni'], 0, GOLF_MAX_ZARIZENI, true);
    golf_zapis_chraneny(GOLF_STAV, $stav);
}

function golf_zapocitej_pokus(): void
{
    $n = golf_nastaveni();
    $okno = $n['prihlaseni_okno_s'];
    $max = $n['prihlaseni_pokusu'];
    $klic = golf_klic_zarizeni();
    golf_pod_zamkem(function () use ($okno, $max, $klic): void {
        $ted = time();
        $stav = golf_cti_stav_prihlaseni($ted, $okno);
        $zname = $klic !== null && isset($stav['zarizeni'][$klic]);
        $neuspechy = $zname ? $stav['zarizeni'][$klic]['neuspechy'] : $stav['neuspechy'];
        if (count($neuspechy) >= $max) {
            $cekat = $neuspechy[count($neuspechy) - $max] + $okno - $ted;
            $minut = max(1, (int) ceil($cekat / 60));
            header('Retry-After: ' . max(1, $cekat));
            throw new GolfChyba(429, 'prilis_pokusu',
                'Příliš mnoho neúspěšných pokusů o přihlášení. Zkus to znovu za ' . $minut . ' ' . golf_minut($minut) . '.',
                ['minut' => $minut]);
        }
        $neuspechy[] = $ted;
        $neuspechy = array_slice($neuspechy, -$max);
        if ($zname) {
            $stav['zarizeni'][$klic]['neuspechy'] = $neuspechy;
        } else {
            $stav['neuspechy'] = $neuspechy;
        }
        golf_uloz_stav_prihlaseni($stav);
    });
}

/* Heslo sedí: vynuluje počítadlo, kterým pokus šel (zařízení, nebo globální),
   zapamatuje si zařízení a pošle (obnoví) mu cookie. Úspěch ze známého
   zařízení globální počítadlo nenuluje — jinak by útočník po každém přihlášení
   majitele dostal dalších deset pokusů. $zapomenOstatni: po změně hesla
   zůstane jen tohle zařízení. */
function golf_uspesne_prihlaseni(bool $zapomenOstatni = false): string
{
    $n = golf_nastaveni();
    $okno = $n['prihlaseni_okno_s'];
    $klic = golf_klic_zarizeni();
    $token = $klic === null ? null : (string) $_COOKIE[GOLF_ZARIZENI];
    golf_pod_zamkem(function () use ($okno, $zapomenOstatni, &$klic, &$token): void {
        $stav = golf_cti_stav_prihlaseni(time(), $okno);
        if ($klic === null || !isset($stav['zarizeni'][$klic])) {
            $stav['neuspechy'] = [];
            $token = bin2hex(random_bytes(16));
            $klic = hash('sha256', $token);
        }
        if ($zapomenOstatni) {
            $stav['zarizeni'] = [];
        }
        $stav['zarizeni'][$klic] = ['neuspechy' => [], 'posledni' => time()];
        golf_uloz_stav_prihlaseni($stav);
    });
    return (string) $token;
}

/* Cookie důvěryhodného zařízení (rok; posílá se až za cookie session). */
function golf_cookie_zarizeni(string $token): void
{
    setcookie(GOLF_ZARIZENI, $token, [
        'expires'  => time() + 365 * 86400,
        'path'     => golf_cesta_cookie(),
        'domain'   => '',
        'secure'   => golf_secure(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

function golf_minut(int $n): string
{
    if ($n === 1) {
        return 'minutu';
    }
    return ($n >= 2 && $n <= 4) ? 'minuty' : 'minut';
}

/* ---------------------------------------------------------------------
   Session a CSRF
   --------------------------------------------------------------------- */

function golf_https(): bool
{
    $https = $_SERVER['HTTPS'] ?? '';
    if (is_string($https) && $https !== '' && strtolower($https) !== 'off') {
        return true;
    }
    $proto = $_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '';
    if (is_string($proto) && strtolower(trim(explode(',', $proto)[0])) === 'https') {
        return true;
    }
    return (string) ($_SERVER['SERVER_PORT'] ?? '') === '443';
}

/* Běží stránka na tomhle počítači (php -S, vývoj)? */
function golf_lokalni(): bool
{
    foreach (['HTTP_HOST', 'SERVER_NAME'] as $klic) {
        $host = $_SERVER[$klic] ?? '';
        if (!is_string($host) || $host === '') {
            continue;
        }
        $host = strtolower(trim((string) preg_replace('/:\d+\z/', '', $host), '[]'));
        return in_array($host, ['localhost', '127.0.0.1', '::1'], true);
    }
    return false;
}

/* Příznak Secure u cookie. Hosting je za proxy, která HTTPS nemusí hlásit
   (HTTPS, X-Forwarded-Proto, port 443) — mimo vlastní počítač proto cookie
   jde vždy jako Secure. Kdyby někdo správu otevřel přes http://, prohlížeč
   cookie neuloží a přihlášení se nepovede: chyba zůstane na bezpečné straně
   (session nikdy nepojede nešifrovaně). admin.js navíc http:// sám
   přesměruje na https://. */
function golf_secure(): bool
{
    return golf_https() || !golf_lokalni();
}

/* Cookie platí jen pro složku administrace (/golf/admin/). */
function golf_cesta_cookie(): string
{
    $skript = is_string($_SERVER['SCRIPT_NAME'] ?? null) ? $_SERVER['SCRIPT_NAME'] : '/';
    $slozka = str_replace('\\', '/', dirname($skript));
    return rtrim($slozka, '/') . '/';
}

/* Vlastní složka session (_data/sessions), nebo null, když ji nejde založit
   — pak zůstane výchozí úložiště hostingu. */
function golf_slozka_session(): ?string
{
    static $slozka = false;
    if ($slozka === false) {
        $d = GOLF_DATA . '/sessions';
        $slozka = golf_zajisti_slozku($d, 0700) ? $d : null;
    }
    return $slozka;
}

/* Session se ukládá do vlastní složky _data/sessions: sdílenou složku
   hostingu uklízí i MatchPulse se svou (kratší) životností session, takže
   by přihlášení na 30 dní nevydrželo. Obsluha je pak vždy "files" — kdyby
   hosting měl výchozí redis nebo memcached, cesta ke složce by pro ně
   nedávala smysl. */
function golf_nastav_session(): void
{
    static $hotovo = false;
    if ($hotovo) {
        return;
    }
    $hotovo = true;
    $zivot = golf_nastaveni()['session_dni'] * 86400;
    $slozka = golf_slozka_session();
    if ($slozka !== null) {
        ini_set('session.save_handler', 'files');
        session_save_path($slozka);
        ini_set('session.gc_probability', '1');
        ini_set('session.gc_divisor', '100');
    }
    ini_set('session.gc_maxlifetime', (string) $zivot);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_cookies', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.use_trans_sid', '0');
    session_cache_limiter('');
    session_name(GOLF_SESSION);
    session_set_cookie_params([
        'lifetime' => $zivot,
        'path'     => golf_cesta_cookie(),
        'domain'   => '',
        'secure'   => golf_secure(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

function golf_ma_cookie(): bool
{
    $c = $_COOKIE[GOLF_SESSION] ?? null;
    return is_string($c) && preg_match('/^[A-Za-z0-9,-]{22,256}\z/', $c) === 1;
}

/* Existuje session z cookie na serveru? session_start() s neznámým id by
   (kvůli use_strict_mode) založilo nový prázdný soubor — kdokoli bez hesla
   by tak mohl náhodnými cookie plnit _data/sessions. Ve vlastní složce se
   proto nejdřív podíváme, jestli soubor je; ve sdílené to nejde, tam
   rozhodne session_start. */
function golf_session_existuje(): bool
{
    $slozka = golf_slozka_session();
    if ($slozka === null) {
        return true;
    }
    $soubor = $slozka . '/sess_' . (string) $_COOKIE[GOLF_SESSION];
    clearstatcache(true, $soubor);
    return is_file($soubor);
}

/* Otevře existující session (jen když klient cookie poslal a session je). */
function golf_otevri_session(bool $jenCist): bool
{
    if (!golf_ma_cookie()) {
        return false;
    }
    golf_nastav_session();
    if (!golf_session_existuje()) {
        return false;
    }
    return $jenCist ? @session_start(['read_and_close' => true]) : @session_start();
}

/* Přihlášená session: příznak, CSRF token a čas přihlášení. Stáří se hlídá
   tady — PHP soubor session při čtení nekontroluje a GC ho maže jen občas,
   takže bez toho by session mohla platit déle než session_dni. */
function golf_je_prihlasen(): bool
{
    if (session_status() === PHP_SESSION_DISABLED
        || ($_SESSION['prihlasen'] ?? false) !== true
        || !is_string($_SESSION['csrf'] ?? null)
        || strlen($_SESSION['csrf']) !== 64) {
        return false;
    }
    $od = $_SESSION['od'] ?? null;
    $ted = time();
    return is_int($od) && $od > $ted - golf_nastaveni()['session_dni'] * 86400 && $od <= $ted + 300;
}

/* Přihlášení + CSRF hlavička. Při $jenCist se session hned zavře, aby
   souběžné požadavky (3 fotky naráz) nečekaly na zámek session. */
function golf_vyzaduj_prihlaseni(bool $jenCist): void
{
    if (!golf_otevri_session($jenCist) || !golf_je_prihlasen()) {
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }
        golf_chyba(401, 'neprihlasen', 'Nejsi přihlášený — přihlas se prosím znovu.');
    }
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!is_string($token) || $token === '' || !hash_equals((string) $_SESSION['csrf'], $token)) {
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }
        golf_chyba(403, 'csrf', 'Platnost stránky vypršela — načti ji prosím znovu.');
    }
}

/* Po úspěšném přihlášení: nové id session, příznak, CSRF token a čas. */
function golf_prihlas(): string
{
    golf_nastav_session();
    /* Neplatnou nebo neexistující session z cookie nepřebírat — vznikne nová. */
    if (!golf_ma_cookie() || !golf_session_existuje()) {
        unset($_COOKIE[GOLF_SESSION]);
    }
    if (!@session_start()) {
        throw new RuntimeException('session_start selhal');
    }
    session_regenerate_id(true);
    $csrf = bin2hex(random_bytes(32));
    $_SESSION = ['prihlasen' => true, 'csrf' => $csrf, 'od' => time()];
    session_write_close();
    return $csrf;
}

/* Po změně hesla: všechna ostatní přihlášení (jiná zařízení, ukradená
   cookie) přestanou platit. Jen ve vlastní složce _data/sessions — ve
   sdílené složce hostingu jsou session MatchPulse, tam se nesmí nic mazat. */
function golf_zrus_ostatni_session(): void
{
    $slozka = golf_slozka_session();
    if ($slozka === null || session_id() === '') {
        return;
    }
    $moje = 'sess_' . session_id();
    foreach (glob($slozka . '/sess_*') ?: [] as $soubor) {
        if (basename($soubor) !== $moje) {
            @unlink($soubor);
        }
    }
}

function golf_odhlas(): void
{
    $_SESSION = [];
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_destroy();
    }
    setcookie(GOLF_SESSION, '', [
        'expires'  => 1,
        'path'     => golf_cesta_cookie(),
        'domain'   => '',
        'secure'   => golf_secure(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

/* ---------------------------------------------------------------------
   Vstup a odpověď
   --------------------------------------------------------------------- */

/* JSON tělo požadavku → pole, jinak 400. */
/** @return array<string, mixed> */
function golf_json_vstup(): array
{
    /* Jen application/json: text/plain z cizí stránky (<form enctype>) se sem
       nedostane ani u přihlášení, které CSRF token nechce. */
    $typ = $_SERVER['CONTENT_TYPE'] ?? ($_SERVER['HTTP_CONTENT_TYPE'] ?? '');
    if (!is_string($typ) || stripos(ltrim($typ), 'application/json') !== 0) {
        golf_chyba(400, 'spatny_vstup', 'Neplatný požadavek.');
    }
    $telo = file_get_contents('php://input', false, null, 0, 1024 * 1024 + 1);
    if (!is_string($telo) || strlen($telo) > 1024 * 1024) {
        golf_chyba(400, 'spatny_vstup', 'Neplatný požadavek.');
    }
    $data = json_decode($telo, true);
    if (!is_array($data) || ($data !== [] && array_keys($data) === range(0, count($data) - 1))) {
        golf_chyba(400, 'spatny_vstup', 'Neplatný požadavek.');
    }
    return $data;
}

/* Textové pole z multipart formuláře (nebo null). Pole polí se nepřijímá. */
/** @return mixed */
function golf_post(string $klic)
{
    $v = $_POST[$klic] ?? null;
    if ($v !== null && !is_string($v)) {
        golf_chyba(400, 'spatny_vstup', 'Neplatný požadavek.');
    }
    return $v;
}

/* Tělo větší než post_max_size PHP zahodí celé — $_POST i $_FILES jsou
   pak prázdné. Místo matoucí „chybí soubor“ řekneme pravdu. */
function golf_kontrola_velikosti(): void
{
    $delka = $_SERVER['CONTENT_LENGTH'] ?? '';
    if (is_string($delka) && ctype_digit($delka) && (int) $delka > golf_post_max()) {
        golf_chyba(413, 'prilis_velke', 'Požadavek je moc velký — server ho nepřijme.');
    }
}

/** @param array<string, mixed> $data */
function golf_odpovez(int $stav, array $data): void
{
    if (!headers_sent()) {
        http_response_code($stav);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        header('X-Robots-Tag: noindex');
    }
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
}
