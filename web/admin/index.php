<?php
/* =====================================================================
   Galerie ročníků — administrace
   ---------------------------------------------------------------------
   Pošle bezpečnostní hlavičky a vypíše app.html. Stránka nemá žádné
   inline skripty ani styly, takže přísná CSP nic nerozbije.
   ===================================================================== */
declare(strict_types=1);

ini_set('display_errors', '0');

header("Content-Security-Policy: default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; "
    . "style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; "
    . "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
header('X-Frame-Options: DENY');
header('Referrer-Policy: same-origin');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow');

$app = __DIR__ . '/app.html';
if (!is_file($app)) {
    http_response_code(503);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Administrace galerie není celá nahraná — chybí soubor app.html.\n";
    exit;
}

/* admin.js a admin.css dostanou do adresy otisk obsahu (?v=…). Kostra jde
   s no-store, skript a styly ne — bez otisku by si prohlížeč po nahrání nové
   verze mohl ještě pár dní držet starý admin.js k nové kostře. */
$html = @file_get_contents($app);
if ($html === false) {
    http_response_code(503);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Administraci galerie se nepodařilo načíst.\n";
    exit;
}
$sOtiskem = preg_replace_callback('/\b(src|href)="(admin\.(?:js|css))"/', function (array $m): string {
    $otisk = @hash_file('crc32b', __DIR__ . '/' . $m[2]);
    return $m[1] . '="' . $m[2] . (is_string($otisk) ? '?v=' . $otisk : '') . '"';
}, $html);

header('Content-Type: text/html; charset=utf-8');
echo is_string($sOtiskem) ? $sOtiskem : $html;
