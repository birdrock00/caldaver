<?php

$app['site.title'] = 'AGENDAV_TITLE';
$app['site.logo'] = 'agendav_100transp.png';
$app['site.favicon'] = 'favicon.ico';
$app['site.footer'] = 'AGENDAV_FOOTER';
$app['proxies'] = [];

$app['db.options'] = [
    'dbname' => 'AGENDAV_DB_NAME',
    'user' => 'AGENDAV_DB_USER',
    'password' => 'AGENDAV_DB_PASSWORD',
    'host' => 'AGENDAV_DB_HOST',
    'port' => AGENDAV_DB_PORT,
    'driver' => 'AGENDAV_DB_DRIVER',
    'charset' => 'utf8',
];

$app['csrf.secret'] = 'AGENDAV_CSRF_SECRET';
$app['log.path'] = 'AGENDAV_LOG_DIR';
$app['log.level'] = 'INFO';

$app['auth.local.username'] = 'AGENDAV_AUTH_USERNAME';
$app['auth.local.password'] = 'AGENDAV_AUTH_PASSWORD';
$app['caldav.baseurl'] = 'AGENDAV_CALDAV_SERVER';
$app['carddav.baseurl'] = 'AGENDAV_CARDDAV_SERVER';
$app['caldav.authmethod'] = 'AGENDAV_CALDAV_AUTHMETHOD';
$app['caldav.username'] = 'AGENDAV_CALDAV_USERNAME';
$app['caldav.password'] = 'AGENDAV_CALDAV_PASSWORD';
$app['caldav.publicurls'] = true;
$app['caldav.baseurl.public'] = 'AGENDAV_CALDAV_PUBLIC_URL';
$app['caldav.certificate.verify'] = AGENDAV_CALDAV_CERTIFICATE_VERIFY;

$app['calendar.sharing'] = AGENDAV_CALENDAR_SHARING;

$app['defaults.timezone'] = 'AGENDAV_TIMEZONE';
$app['defaults.language'] = 'AGENDAV_LANG';
$app['defaults.time_format'] = '24';
$app['defaults.date_format'] = 'ymd';
$app['defaults.weekstart'] = AGENDAV_WEEKSTART;
$app['defaults.show_week_nb'] = false;
$app['defaults.show_now_indicator'] = true;
$app['defaults.list_days'] = 7;
$app['defaults.default_view'] = 'month';

$app['logout.redirection'] = '';
