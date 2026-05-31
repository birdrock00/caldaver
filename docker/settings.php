<?php

$app['site.title'] = 'CALDAVER_TITLE';
$app['site.logo'] = 'caldaver_100transp.png';
$app['site.favicon'] = 'favicon.ico';
$app['site.footer'] = 'CALDAVER_FOOTER';
$app['proxies'] = [];

$app['db.options'] = [
    'dbname' => 'CALDAVER_DB_NAME',
    'user' => 'CALDAVER_DB_USER',
    'password' => 'CALDAVER_DB_PASSWORD',
    'host' => 'CALDAVER_DB_HOST',
    'port' => CALDAVER_DB_PORT,
    'driver' => 'CALDAVER_DB_DRIVER',
    'charset' => 'utf8',
];

$app['csrf.secret'] = 'CALDAVER_CSRF_SECRET';
$app['log.path'] = 'CALDAVER_LOG_DIR';
$app['log.level'] = 'INFO';

$app['session.storage.options'] = array_replace($app['session.storage.options'], [
    'cookie_lifetime' => CALDAVER_SESSION_LIFETIME,
    'gc_maxlifetime' => CALDAVER_SESSION_LIFETIME,
]);

$app['auth.local.username'] = 'CALDAVER_AUTH_USERNAME';
$app['auth.local.password'] = 'CALDAVER_AUTH_PASSWORD';
$app['caldav.baseurl'] = 'CALDAVER_CALDAV_SERVER';
$app['carddav.baseurl'] = 'CALDAVER_CARDDAV_SERVER';
$app['caldav.authmethod'] = 'CALDAVER_CALDAV_AUTHMETHOD';
$app['caldav.username'] = 'CALDAVER_CALDAV_USERNAME';
$app['caldav.password'] = 'CALDAVER_CALDAV_PASSWORD';
$app['caldav.publicurls'] = true;
$app['caldav.baseurl.public'] = 'CALDAVER_CALDAV_PUBLIC_URL';
$app['caldav.certificate.verify'] = CALDAVER_CALDAV_CERTIFICATE_VERIFY;

$app['calendar.sharing'] = CALDAVER_CALENDAR_SHARING;

$app['defaults.timezone'] = 'CALDAVER_TIMEZONE';
$app['defaults.language'] = 'CALDAVER_LANG';
$app['defaults.time_format'] = '24';
$app['defaults.date_format'] = 'ymd';
$app['defaults.weekstart'] = CALDAVER_WEEKSTART;
$app['defaults.show_week_nb'] = false;
$app['defaults.show_now_indicator'] = true;
$app['defaults.list_days'] = 7;
$app['defaults.default_view'] = 'month';

$app['logout.redirection'] = '';
