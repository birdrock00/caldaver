<?php

require __DIR__ . '/../web/vendor/autoload.php';

$database = '/var/agendav/db.sqlite';
$pdo = new PDO('sqlite:' . $database);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

$pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS prefs (
    username VARCHAR(255) NOT NULL PRIMARY KEY,
    options CLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS shares (
    sid INTEGER PRIMARY KEY AUTOINCREMENT,
    owner VARCHAR(255) NOT NULL,
    calendar VARCHAR(255) NOT NULL,
    "with" VARCHAR(255) NOT NULL,
    options CLOB NOT NULL,
    rw BOOLEAN NOT NULL
);

CREATE INDEX IF NOT EXISTS IDX_SHARES_OWNER_CALENDAR ON shares (owner, calendar);
CREATE INDEX IF NOT EXISTS IDX_SHARES_WITH ON shares ("with");

CREATE TABLE IF NOT EXISTS principals (
    url VARCHAR(255) NOT NULL PRIMARY KEY,
    displayname VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL
);
SQL);

$handler = new Symfony\Component\HttpFoundation\Session\Storage\Handler\PdoSessionHandler($pdo);
$handler->createTable();
