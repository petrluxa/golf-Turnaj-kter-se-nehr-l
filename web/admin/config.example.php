<?php
/* =====================================================================
   Galerie ročníků — vzor nastavení
   ---------------------------------------------------------------------
   Nic se nastavovat nemusí — bez config.php platí hodnoty níž. Kdo chce
   něco změnit, zkopíruje tenhle soubor jako config.php (ten do gitu
   nepatří) a nechá v něm jen řádky, které mění. Hodnoty jsou kladná
   celá čísla; nesmyslné se ignorují.

   Velikosti fotek a náhledů navíc omezuje upload_max_filesize na
   hostingu — větší soubor PHP nepřijme, ať je tu napsáno cokoli.
   ===================================================================== */

if (!defined('GOLF_ADMIN')) {
    http_response_code(404);
    exit;
}

return [
    // Největší video v bajtech (nahrává se po kusech, limity PHP ho neomezují).
    'max_video_bajtu'   => 1024 * 1024 * 1024,

    // Kolik smí zabrat celá galerie v bajtech, včetně rozpracovaných videí.
    // Disk hostingu sdílí i MatchPulse — galerie ho nesmí zaplnit.
    'max_celkem_bajtu'  => 20 * 1024 * 1024 * 1024,

    // Největší fotka a náhled v bajtech (prohlížeč je před nahráním zmenší).
    'max_foto_bajtu'    => 8 * 1024 * 1024,
    'max_nahled_bajtu'  => 1024 * 1024,

    // Nejdelší strana v pixelech: fotka, náhled fotky, plakát videa.
    'max_strana_foto'   => 4096,
    'max_strana_nahled' => 1024,
    'max_strana_plakat' => 1280,

    // Po tolika neúspěšných přihlášeních v okně (sekundy) se přihlašování zastaví.
    // Počítá se globálně; prohlížeč, ve kterém už přihlášení jednou prošlo
    // (cookie golf_zarizeni), má vlastní počítadlo se stejným limitem.
    'prihlaseni_pokusu' => 10,
    'prihlaseni_okno_s' => 15 * 60,

    // Jak dlouho platí přihlášení (dny).
    'session_dni'       => 30,
];
