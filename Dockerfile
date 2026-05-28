# syntax=docker/dockerfile:1
#
# Docker packaging based on https://github.com/nagimov/agendav-docker.
# Original Docker packaging copyright (c) 2018 Ruslan Nagimov, MIT licensed.

ARG PHP_VERSION=apache

FROM docker.io/library/node:20-bullseye-slim AS assets
WORKDIR /src

COPY package.json ./
RUN npm install

COPY assets ./assets
COPY web/public ./web/public
RUN npm run build:templates \
    && npm run build:css \
    && npm run build:js

FROM docker.io/library/composer:2 AS composer-bin

FROM docker.io/library/php:${PHP_VERSION}

LABEL org.opencontainers.image.title="caldaver" \
      org.opencontainers.image.description="AgenDAV CalDAV web client Docker image" \
      org.opencontainers.image.source="https://github.com/caldaver-app/caldaver" \
      org.opencontainers.image.licenses="GPL-3.0-or-later AND MIT"

ENV APACHE_RUN_USER=www-data \
    APACHE_RUN_GROUP=www-data \
    APACHE_LOG_DIR=/var/log/apache2 \
    APACHE_LOCK_DIR=/var/lock/apache2 \
    APACHE_PID_FILE=/var/run/apache2/apache2.pid \
    TERM=xterm \
    PHP_INI_DIR=/usr/local/etc/php \
    AGENDAV_SERVER_NAME=localhost \
    AGENDAV_TITLE="AgenDAV" \
    AGENDAV_FOOTER="AgenDAV" \
    AGENDAV_CALDAV_SERVER="http://localhost:5232/" \
    AGENDAV_CARDDAV_SERVER="" \
    AGENDAV_CALDAV_PUBLIC_URL="" \
    AGENDAV_CALDAV_AUTHMETHOD=basic \
    AGENDAV_CALDAV_CERTIFICATE_VERIFY=true \
    AGENDAV_TIMEZONE=UTC \
    AGENDAV_WEEKSTART=0 \
    AGENDAV_LANG=en \
    AGENDAV_LOG_DIR=/tmp/ \
    AGENDAV_CALENDAR_SHARING=false \
    AGENDAV_CSRF_SECRET=change-me

ADD https://github.com/mlocati/docker-php-extension-installer/releases/latest/download/install-php-extensions /usr/local/bin/
ADD https://curl.se/ca/cacert.pem /etc/ssl/certs/cacert.pem

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git unzip \
    && chmod +x /usr/local/bin/install-php-extensions \
    && install-php-extensions mbstring xml pdo_sqlite curl \
    && rm /usr/local/bin/install-php-extensions \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

COPY --from=composer-bin /usr/bin/composer /usr/local/bin/composer

WORKDIR /var/www/agendav
COPY --chown=www-data:www-data . /var/www/agendav
COPY --from=assets --chown=www-data:www-data /src/web/public/dist /var/www/agendav/web/public/dist
COPY docker/agendav.conf /etc/apache2/sites-available/agendav.conf
COPY docker/settings.php /var/www/agendav/web/config/settings.php.template
COPY docker/initialize-sqlite.php /var/www/agendav/docker/initialize-sqlite.php
COPY docker/run.sh /usr/local/bin/run.sh

RUN set -eux; \
    chmod 644 /etc/ssl/certs/cacert.pem; \
    chmod +x /usr/local/bin/run.sh; \
    chown -R www-data:www-data "$PHP_INI_DIR" /var/run/apache2 "$APACHE_LOG_DIR" /var/www/agendav; \
    chmod 755 "$APACHE_LOG_DIR"; \
    cp "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini"; \
    echo 'date.timezone = "UTC"' >> "$PHP_INI_DIR/php.ini"; \
    echo 'openssl.cafile = "/etc/ssl/certs/cacert.pem"' >> "$PHP_INI_DIR/php.ini"; \
    echo 'curl.cainfo = "/etc/ssl/certs/cacert.pem"' >> "$PHP_INI_DIR/php.ini"; \
    COMPOSER_ALLOW_SUPERUSER=1 composer install --no-dev --prefer-dist --no-progress --no-interaction --optimize-autoloader --working-dir=/var/www/agendav/web; \
    mkdir -p /var/agendav /var/www/agendav/web/var/cache/twig; \
    touch /var/agendav/db.sqlite; \
    chown -R www-data:www-data /var/agendav /var/www/agendav/web/var; \
    chmod 640 /var/agendav/db.sqlite; \
    php /var/www/agendav/docker/initialize-sqlite.php; \
    a2ensite agendav.conf; \
    a2dissite 000-default; \
    a2enmod rewrite; \
    echo "Listen 127.0.0.1:8080" > /etc/apache2/ports.conf; \
    service apache2 restart; \
    service apache2 stop; \
    echo "Listen 8080" > /etc/apache2/ports.conf; \
    ln -sf /dev/stdout "$APACHE_LOG_DIR/access.log"; \
    ln -sf /dev/stderr "$APACHE_LOG_DIR/error.log"; \
    ln -sf /dev/stderr "$APACHE_LOG_DIR/davi-error.log"

EXPOSE 8080
USER www-data
ENTRYPOINT ["/usr/local/bin/run.sh"]
CMD ["apache2"]
