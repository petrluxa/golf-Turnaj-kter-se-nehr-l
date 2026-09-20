<?php

/*
|--------------------------------------------------------------------------
| Turnaj, který se nikdy nehrál — routa podstránky
|--------------------------------------------------------------------------
| Zkopíruj do routes/web.php. Nejjednodušší varianta bez controlleru:
*/

Route::view('/golf/turnaj-ktery-se-nikdy-nehral', 'golf.turnaj')
    ->name('golf.turnaj');


/*
| Varianta s daty ze serveru (když nechceš, aby JSON tahal prohlížeč
| zvlášť — data se vloží rovnou do stránky). Ve viewu pak nahraď
| <div id="turnaj-app" ... data-src="..."></div> tímto:
|
|   <script>window.TURNAJ_DATA = @json($turnaj);</script>
|   <div id="turnaj-app" class="tkn"></div>
*/

// Route::get('/golf/turnaj-ktery-se-nikdy-nehral', function () {
//     $turnaj = json_decode(
//         file_get_contents(public_path('golf/turnaj.json')),
//         true
//     );
//
//     return view('golf.turnaj', compact('turnaj'));
// })->name('golf.turnaj');
