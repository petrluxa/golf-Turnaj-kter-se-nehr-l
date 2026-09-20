{{--
    Turnaj, který se nikdy nehrál — podstránka
    Umístění: resources/views/golf/turnaj.blade.php

    Předpoklad: statické soubory (turnaj.css, turnaj.js, turnaj.json)
    jsou nakopírované do public/golf/.

    Uprav @extends / @section / @push podle svého layoutu — pokud tvůj
    layout nepoužívá stacky, vlož <link> a <script> rovnou do obsahu,
    funguje to i tak.
--}}

@extends('layouts.app')

@section('title', 'Turnaj, který se nikdy nehrál')

@push('styles')
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,600;1,6..72,400;1,6..72,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
    <link rel="stylesheet" href="{{ asset('golf/turnaj.css') }}">
@endpush

@section('content')
    <div id="turnaj-app" class="tkn" data-src="{{ asset('golf/turnaj.json') }}"></div>
@endsection

@push('scripts')
    <script src="{{ asset('golf/turnaj.js') }}" defer></script>
@endpush
