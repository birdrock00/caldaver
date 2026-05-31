#!/bin/bash
set -euo pipefail

CONFIG_FILE="/var/www/caldaver/web/config/settings.php"
CONFIG_TEMPLATE="/var/www/caldaver/web/config/settings.php.template"
PHP_CONFIG_FILE="${PHP_INI_DIR}/php.ini"

: "${CALDAVER_SERVER_NAME:=localhost}"
: "${CALDAVER_TITLE:=Caldaver}"
: "${CALDAVER_FOOTER:=Caldaver}"
: "${CALDAVER_CALDAV_SERVER:?CALDAVER_CALDAV_SERVER is required}"
: "${CALDAVER_CALDAV_PUBLIC_URL:=$CALDAVER_CALDAV_SERVER}"
: "${CALDAVER_CARDDAV_SERVER:=$CALDAVER_CALDAV_SERVER}"
: "${CALDAVER_CALDAV_AUTHMETHOD:=basic}"
: "${CALDAVER_CALDAV_CERTIFICATE_VERIFY:=true}"
: "${CALDAVER_TIMEZONE:=UTC}"
: "${CALDAVER_WEEKSTART:=0}"
: "${CALDAVER_LANG:=en}"
: "${CALDAVER_LOG_DIR:=/tmp/}"
: "${CALDAVER_CALENDAR_SHARING:=false}"
: "${CALDAVER_CSRF_SECRET:?CALDAVER_CSRF_SECRET is required}"
: "${CALDAVER_SESSION_LIFETIME:=2592000}"
: "${CALDAVER_AUTH_USERNAME:=}"
: "${CALDAVER_AUTH_PASSWORD:=}"
: "${CALDAVER_CALDAV_USERNAME:=}"
: "${CALDAVER_CALDAV_PASSWORD:=}"
: "${CALDAVER_DB_DRIVER:=pdo_pgsql}"
: "${CALDAVER_DB_HOST:?CALDAVER_DB_HOST is required}"
: "${CALDAVER_DB_PORT:=5432}"
: "${CALDAVER_DB_NAME:?CALDAVER_DB_NAME is required}"
: "${CALDAVER_DB_USER:?CALDAVER_DB_USER is required}"
: "${CALDAVER_DB_PASSWORD:?CALDAVER_DB_PASSWORD is required}"

if ! [[ "$CALDAVER_SESSION_LIFETIME" =~ ^[0-9]+$ ]]; then
    echo "CALDAVER_SESSION_LIFETIME must be a non-negative integer number of seconds" >&2
    exit 1
fi

escape_sed() {
    printf '%s' "$1" | sed -e 's/[\/&]/\\&/g'
}

replace_config() {
    local token="$1"
    local value="$2"
    sed -i -e "s/${token}/$(escape_sed "$value")/g" "$CONFIG_FILE"
}

cp "$CONFIG_TEMPLATE" "$CONFIG_FILE"

replace_config "CALDAVER_TITLE" "$CALDAVER_TITLE"
replace_config "CALDAVER_FOOTER" "$CALDAVER_FOOTER"
replace_config "CALDAVER_CALDAV_SERVER" "$CALDAVER_CALDAV_SERVER"
replace_config "CALDAVER_CARDDAV_SERVER" "$CALDAVER_CARDDAV_SERVER"
replace_config "CALDAVER_CALDAV_PUBLIC_URL" "$CALDAVER_CALDAV_PUBLIC_URL"
replace_config "CALDAVER_CALDAV_AUTHMETHOD" "$CALDAVER_CALDAV_AUTHMETHOD"
replace_config "CALDAVER_CALDAV_CERTIFICATE_VERIFY" "$CALDAVER_CALDAV_CERTIFICATE_VERIFY"
replace_config "CALDAVER_CALENDAR_SHARING" "$CALDAVER_CALENDAR_SHARING"
replace_config "CALDAVER_CSRF_SECRET" "$CALDAVER_CSRF_SECRET"
replace_config "CALDAVER_SESSION_LIFETIME" "$CALDAVER_SESSION_LIFETIME"
replace_config "CALDAVER_TIMEZONE" "$CALDAVER_TIMEZONE"
replace_config "CALDAVER_LANG" "$CALDAVER_LANG"
replace_config "CALDAVER_LOG_DIR" "$CALDAVER_LOG_DIR"
replace_config "CALDAVER_WEEKSTART" "$CALDAVER_WEEKSTART"
replace_config "CALDAVER_AUTH_USERNAME" "$CALDAVER_AUTH_USERNAME"
replace_config "CALDAVER_AUTH_PASSWORD" "$CALDAVER_AUTH_PASSWORD"
replace_config "CALDAVER_CALDAV_USERNAME" "$CALDAVER_CALDAV_USERNAME"
replace_config "CALDAVER_CALDAV_PASSWORD" "$CALDAVER_CALDAV_PASSWORD"
replace_config "CALDAVER_DB_DRIVER" "$CALDAVER_DB_DRIVER"
replace_config "CALDAVER_DB_HOST" "$CALDAVER_DB_HOST"
replace_config "CALDAVER_DB_PORT" "$CALDAVER_DB_PORT"
replace_config "CALDAVER_DB_NAME" "$CALDAVER_DB_NAME"
replace_config "CALDAVER_DB_USER" "$CALDAVER_DB_USER"
replace_config "CALDAVER_DB_PASSWORD" "$CALDAVER_DB_PASSWORD"

sed -i -e "s/CALDAVER_TIMEZONE/$(escape_sed "$CALDAVER_TIMEZONE")/g" "$PHP_CONFIG_FILE"

php /var/www/caldaver/docker/initialize-database.php

if [ "${1:-}" = "apache2" ]; then
    exec /usr/sbin/apache2ctl -D FOREGROUND
fi

exec "$@"
