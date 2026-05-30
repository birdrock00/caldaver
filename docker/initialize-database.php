<?php

require __DIR__ . '/../web/vendor/autoload.php';

$required = [
    'CALDAVER_DB_HOST',
    'CALDAVER_DB_PORT',
    'CALDAVER_DB_NAME',
    'CALDAVER_DB_USER',
    'CALDAVER_DB_PASSWORD',
];

foreach ($required as $name) {
    if (getenv($name) === false || getenv($name) === '') {
        fwrite(STDERR, $name . " is required\n");
        exit(1);
    }
}

$dsn = sprintf(
    'pgsql:host=%s;port=%s;dbname=%s',
    getenv('CALDAVER_DB_HOST'),
    getenv('CALDAVER_DB_PORT'),
    getenv('CALDAVER_DB_NAME')
);

$pdo = new PDO($dsn, getenv('CALDAVER_DB_USER'), getenv('CALDAVER_DB_PASSWORD'), [
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
    refresh_interval_seconds INTEGER NOT NULL DEFAULT 60,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE mail_accounts
    ADD COLUMN IF NOT EXISTS refresh_interval_seconds INTEGER NOT NULL DEFAULT 60;

CREATE INDEX IF NOT EXISTS IDX_MAIL_ACCOUNTS_OWNER ON mail_accounts (owner);

CREATE TABLE IF NOT EXISTS mail_message_cache (
    id SERIAL PRIMARY KEY,
    owner VARCHAR(255) NOT NULL,
    account_id INTEGER NOT NULL,
    uid INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    from_header TEXT NOT NULL,
    subject TEXT NOT NULL,
    date_header VARCHAR(255) NOT NULL,
    seen BOOLEAN NOT NULL DEFAULT FALSE,
    attachments TEXT NOT NULL,
    body TEXT,
    html_body TEXT,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT UNIQ_MAIL_MESSAGE_CACHE_ACCOUNT_UID UNIQUE (account_id, uid)
);

ALTER TABLE mail_message_cache
    ADD COLUMN IF NOT EXISTS html_body TEXT;

CREATE INDEX IF NOT EXISTS IDX_MAIL_MESSAGE_CACHE_OWNER_ACCOUNT ON mail_message_cache (owner, account_id);

CREATE TABLE IF NOT EXISTS sessions (
    sess_id VARCHAR(128) NOT NULL PRIMARY KEY,
    sess_data BYTEA NOT NULL,
    sess_lifetime INTEGER NOT NULL,
    sess_time INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS EXPIRY ON sessions (sess_lifetime);
SQL);
