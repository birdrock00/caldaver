<?php

require __DIR__ . '/../web/vendor/autoload.php';

$required = [
    'AGENDAV_DB_HOST',
    'AGENDAV_DB_PORT',
    'AGENDAV_DB_NAME',
    'AGENDAV_DB_USER',
    'AGENDAV_DB_PASSWORD',
];

foreach ($required as $name) {
    if (getenv($name) === false || getenv($name) === '') {
        fwrite(STDERR, $name . " is required\n");
        exit(1);
    }
}

$dsn = sprintf(
    'pgsql:host=%s;port=%s;dbname=%s',
    getenv('AGENDAV_DB_HOST'),
    getenv('AGENDAV_DB_PORT'),
    getenv('AGENDAV_DB_NAME')
);

$pdo = new PDO($dsn, getenv('AGENDAV_DB_USER'), getenv('AGENDAV_DB_PASSWORD'), [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
]);

$pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS prefs (
    username VARCHAR(255) PRIMARY KEY,
    options TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shares (
    sid SERIAL PRIMARY KEY,
    owner VARCHAR(255) NOT NULL,
    calendar VARCHAR(255) NOT NULL,
    "with" VARCHAR(255) NOT NULL,
    options TEXT NOT NULL,
    rw BOOLEAN NOT NULL
);

CREATE INDEX IF NOT EXISTS IDX_SHARES_OWNER_CALENDAR ON shares (owner, calendar);
CREATE INDEX IF NOT EXISTS IDX_SHARES_WITH ON shares ("with");

CREATE TABLE IF NOT EXISTS principals (
    url VARCHAR(255) PRIMARY KEY,
    displayname VARCHAR(255),
    email VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS mail_accounts (
    id SERIAL PRIMARY KEY,
    owner VARCHAR(255) NOT NULL,
    label VARCHAR(255) NOT NULL,
    email_address VARCHAR(255) NOT NULL,
    imap_host VARCHAR(255) NOT NULL,
    imap_port INTEGER NOT NULL DEFAULT 993,
    encryption VARCHAR(20) NOT NULL DEFAULT 'ssl',
    username VARCHAR(255) NOT NULL,
    password_encrypted TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS IDX_MAIL_ACCOUNTS_OWNER ON mail_accounts (owner);

CREATE TABLE IF NOT EXISTS sessions (
    sess_id VARCHAR(128) NOT NULL PRIMARY KEY,
    sess_data BYTEA NOT NULL,
    sess_lifetime INTEGER NOT NULL,
    sess_time INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS EXPIRY ON sessions (sess_lifetime);
SQL);
