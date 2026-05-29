#!/bin/bash
set -euo pipefail

CONFIG_FILE="/var/www/agendav/web/config/settings.php"
CONFIG_TEMPLATE="/var/www/agendav/web/config/settings.php.template"
PHP_CONFIG_FILE="${PHP_INI_DIR}/php.ini"

: "${AGENDAV_SERVER_NAME:=localhost}"
: "${AGENDAV_TITLE:=AgenDAV}"
: "${AGENDAV_FOOTER:=AgenDAV}"
: "${AGENDAV_CALDAV_SERVER:?AGENDAV_CALDAV_SERVER is required}"
: "${AGENDAV_CALDAV_PUBLIC_URL:=$AGENDAV_CALDAV_SERVER}"
: "${AGENDAV_CARDDAV_SERVER:=$AGENDAV_CALDAV_SERVER}"
: "${AGENDAV_CALDAV_AUTHMETHOD:=basic}"
: "${AGENDAV_CALDAV_CERTIFICATE_VERIFY:=true}"
: "${AGENDAV_TIMEZONE:=UTC}"
: "${AGENDAV_WEEKSTART:=0}"
: "${AGENDAV_LANG:=en}"
: "${AGENDAV_LOG_DIR:=/tmp/}"
: "${AGENDAV_CALENDAR_SHARING:=false}"
: "${AGENDAV_CSRF_SECRET:?AGENDAV_CSRF_SECRET is required}"
: "${AGENDAV_AUTH_USERNAME:=}"
: "${AGENDAV_AUTH_PASSWORD:=}"
: "${AGENDAV_CALDAV_USERNAME:=}"
: "${AGENDAV_CALDAV_PASSWORD:=}"
: "${AGENDAV_DB_DRIVER:=pdo_pgsql}"
: "${AGENDAV_DB_HOST:?AGENDAV_DB_HOST is required}"
: "${AGENDAV_DB_PORT:=5432}"
: "${AGENDAV_DB_NAME:?AGENDAV_DB_NAME is required}"
: "${AGENDAV_DB_USER:?AGENDAV_DB_USER is required}"
: "${AGENDAV_DB_PASSWORD:?AGENDAV_DB_PASSWORD is required}"

escape_sed() {
    printf '%s' "$1" | sed -e 's/[\/&]/\\&/g'
}

replace_config() {
    local token="$1"
    local value="$2"
    sed -i -e "s/${token}/$(escape_sed "$value")/g" "$CONFIG_FILE"
}

cp "$CONFIG_TEMPLATE" "$CONFIG_FILE"

replace_config "AGENDAV_TITLE" "$AGENDAV_TITLE"
replace_config "AGENDAV_FOOTER" "$AGENDAV_FOOTER"
replace_config "AGENDAV_CALDAV_SERVER" "$AGENDAV_CALDAV_SERVER"
replace_config "AGENDAV_CARDDAV_SERVER" "$AGENDAV_CARDDAV_SERVER"
replace_config "AGENDAV_CALDAV_PUBLIC_URL" "$AGENDAV_CALDAV_PUBLIC_URL"
replace_config "AGENDAV_CALDAV_AUTHMETHOD" "$AGENDAV_CALDAV_AUTHMETHOD"
replace_config "AGENDAV_CALDAV_CERTIFICATE_VERIFY" "$AGENDAV_CALDAV_CERTIFICATE_VERIFY"
replace_config "AGENDAV_CALENDAR_SHARING" "$AGENDAV_CALENDAR_SHARING"
replace_config "AGENDAV_CSRF_SECRET" "$AGENDAV_CSRF_SECRET"
replace_config "AGENDAV_TIMEZONE" "$AGENDAV_TIMEZONE"
replace_config "AGENDAV_LANG" "$AGENDAV_LANG"
replace_config "AGENDAV_LOG_DIR" "$AGENDAV_LOG_DIR"
replace_config "AGENDAV_WEEKSTART" "$AGENDAV_WEEKSTART"
replace_config "AGENDAV_AUTH_USERNAME" "$AGENDAV_AUTH_USERNAME"
replace_config "AGENDAV_AUTH_PASSWORD" "$AGENDAV_AUTH_PASSWORD"
replace_config "AGENDAV_CALDAV_USERNAME" "$AGENDAV_CALDAV_USERNAME"
replace_config "AGENDAV_CALDAV_PASSWORD" "$AGENDAV_CALDAV_PASSWORD"
replace_config "AGENDAV_DB_DRIVER" "$AGENDAV_DB_DRIVER"
replace_config "AGENDAV_DB_HOST" "$AGENDAV_DB_HOST"
replace_config "AGENDAV_DB_PORT" "$AGENDAV_DB_PORT"
replace_config "AGENDAV_DB_NAME" "$AGENDAV_DB_NAME"
replace_config "AGENDAV_DB_USER" "$AGENDAV_DB_USER"
replace_config "AGENDAV_DB_PASSWORD" "$AGENDAV_DB_PASSWORD"

sed -i -e "s/AGENDAV_TIMEZONE/$(escape_sed "$AGENDAV_TIMEZONE")/g" "$PHP_CONFIG_FILE"

php /var/www/agendav/docker/initialize-database.php

if [ "${1:-}" = "apache2" ]; then
    exec /usr/sbin/apache2ctl -D FOREGROUND
fi

exec "$@"
