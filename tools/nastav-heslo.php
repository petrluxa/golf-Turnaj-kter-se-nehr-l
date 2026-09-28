<?php
/* =====================================================================
   Nastavení hesla k administraci galerie
   ---------------------------------------------------------------------
   php tools/nastav-heslo.php [cesta/k/web]

   Vytvoří <web>/admin/_data/heslo.php s hashem hesla (password_hash).
   Heslo vezme z proměnné prostředí GOLF_HESLO, jinak se na něj zeptá
   (bez vypisování znaků, když to terminál umí). Aspoň 10 znaků.
   Výchozí web/ je složka vedle tools/. Heslo.php pak nahraj na hosting
   do /golf/admin/_data/ — do gitu nepatří.

   Jen pro příkazovou řádku; tools/ se na web nenahrává.
   ===================================================================== */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

function chyba(string $zprava): void
{
    fwrite(STDERR, $zprava . "\n");
    exit(1);
}

/* Přečte řádek z terminálu bez echa. Na Windows přes PowerShell, jinde přes stty.
   $tty se zjišťuje jen jednou před prvním čtením — stream_isatty() po fgets()
   by v PHP 8.0 zahodil načtená data ze vstupu. */
function precti_skryte(string $vyzva, bool $tty): string
{
    fwrite(STDERR, $vyzva);
    if ($tty && DIRECTORY_SEPARATOR === '\\' && function_exists('shell_exec')) {
        $prikaz = 'powershell -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8;'
            . ' $s=Read-Host -AsSecureString;'
            . ' $b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);'
            . ' [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)"';
        $vystup = shell_exec($prikaz);
        if (is_string($vystup) && rtrim($vystup, "\r\n") !== '') {
            fwrite(STDERR, "\n");
            return rtrim($vystup, "\r\n");
        }
        fwrite(STDERR, "\n(Skryté zadání nevyšlo, heslo bude při psaní vidět.)\n" . $vyzva);
    }
    if ($tty && DIRECTORY_SEPARATOR === '/' && function_exists('shell_exec')) {
        shell_exec('stty -echo 2>/dev/null');
        $radek = fgets(STDIN);
        shell_exec('stty echo 2>/dev/null');
        fwrite(STDERR, "\n");
        return $radek === false ? '' : rtrim($radek, "\r\n");
    }
    $radek = fgets(STDIN);
    return $radek === false ? '' : rtrim($radek, "\r\n");
}

$web = $argv[1] ?? (dirname(__DIR__) . DIRECTORY_SEPARATOR . 'web');
$web = rtrim($web, "/\\");
if (!is_dir($web . '/admin')) {
    chyba('Ve složce "' . $web . '" není admin/ — zadej cestu ke složce web.');
}

$heslo = getenv('GOLF_HESLO');
if ($heslo === false || $heslo === '') {
    $tty = function_exists('stream_isatty') && stream_isatty(STDIN);
    $heslo = precti_skryte('Nové heslo ke galerii: ', $tty);
    $znovu = precti_skryte('Zopakuj heslo: ', $tty);
    if ($heslo !== $znovu) {
        chyba('Hesla se neshodují, nic se nezměnilo.');
    }
}
if (!preg_match('//u', $heslo)) {
    chyba('Heslo není platný text v UTF-8.');
}
if (preg_match_all('/./su', $heslo) < 10) {
    chyba('Heslo musí mít aspoň 10 znaků.');
}

$hash = password_hash($heslo, PASSWORD_DEFAULT);
if (!preg_match('/^[^\'\\\\]{20,}\z/', $hash)) {
    chyba('Neočekávaný tvar hashe, nic se nezměnilo.');
}

$data = $web . '/admin/_data';
if (!is_dir($data) && !mkdir($data, 0755, true)) {
    chyba('Nejde vytvořit složku ' . $data);
}
$cil = $data . '/heslo.php';
$tmp = $cil . '.' . bin2hex(random_bytes(6)) . '.tmp';
$obsah = "<?php return '" . $hash . "';\n";
if (file_put_contents($tmp, $obsah) !== strlen($obsah) || !rename($tmp, $cil)) {
    @unlink($tmp);
    chyba('Nejde zapsat ' . $cil);
}
echo 'Heslo je uložené v ' . $cil . "\n";
echo "Nahraj ho na hosting do /golf/admin/_data/heslo.php (do gitu nepatří).\n";
/* Past při nasazení: kdo pak nahrává celou složku web/, nahraje i tenhle soubor
   a přepíše heslo, které si mezitím někdo změnil ve správě (třeba proto, že
   uniklo). Stejně tak by přepsal media/galerie.json a fotky na serveru. */
fwrite(STDERR, "\nPOZOR: Tenhle soubor nahraj jen teď, při nastavení hesla. Při dalších nasazeních\n"
    . "nenahrávej admin/_data/ ani media/ (kromě .htaccess a index.html) — přepsal bys heslo\n"
    . "změněné ve správě a galerii na serveru. Po nahrání ho klidně smaž z " . $data . ".\n");
