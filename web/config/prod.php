<?php

$app['twig.path'] = array(__DIR__.'/../templates');
$app['twig.options'] = array('cache' => __DIR__.'/../var/cache/twig');

// Assets
$app['stylesheets'] = [
    'caldaver.css',
];

$app['print.stylesheets'] = [
    'caldaver.print.css',
];

$app['scripts'] = [
    'caldaver.min.js',
];

// Session parameters
$app['session.storage.options'] = [
    'name' => 'caldaver_sess',
    'cookie_lifetime' => 30 * 24 * 60 * 60,
    'gc_maxlifetime' => 30 * 24 * 60 * 60,
    'cookie_httponly' => true,
    'cookie_samesite' => 'Lax',
];

// Languages
$app['languages'] = require __DIR__ . '/languages.php';

// Fullcalendar language packs
$app['fullcalendar.languages'] = [
    //'br'  => 'en', // Missing
    'ca'    => 'ca',
    'de_DE' => 'de',
    //'en'  => 'en',
    'es_ES' => 'es',
    'et'    => 'et',
    'fi'    => 'fi',
    'fr_FR' => 'fr',
    'hr_HR' => 'hr',
    'it_IT' => 'it',
    'ja_JP' => 'ja',
    'nb_NO' => 'nb',
    'nl_NL' => 'nl',
    'pl'    => 'pl',
    'pt_BR' => 'pt-br',
    'pt_PT' => 'pt',
    'ru_RU' => 'ru',
    'sk'    => 'sk',
    'sv_SE' => 'sv',
    'tr'    => 'tr',
];

// Load configuration settings
if (!file_exists(__DIR__ . '/settings.php')) {
    echo 'settings.php file not found';
    exit(255);
}

require __DIR__ . '/default.settings.php';
require __DIR__ . '/settings.php';
