# Caldaver - CalDAV web client

[![Build Status](https://github.com/caldaver-app/caldaver/actions/workflows/ci.yml/badge.svg)](https://github.com/caldaver-app/caldaver/actions)
[![Made With](https://img.shields.io/badge/made_with-rust-orange)](https://github.com/caldaver-app/caldaver#requirements)
[![License](https://img.shields.io/badge/license-gpl--3.0--or--later-blue.svg)](https://spdx.org/licenses/GPL-3.0-or-later.html)

Caldaver is a CalDAV web client served by a Rust backend with an AJAX interface
for calendars, contacts, preferences, and mail.

![Screenshot](./docs/screenshot.png)

## Requirements

Caldaver requires:

- A CalDAV server like [Baïkal](http://baikal-server.com/),
  [DAViCal](http://www.davical.org/),
  [Radicale](https://radicale.org/tutorial/), etc
- PostgreSQL for sessions, preferences, mail accounts, and cached mail metadata
- Rust stable for source builds
- Optional: nodejs & npm to build assets (releases include a build)

## Documentation

The original upstream documentation is available at:
https://agendav.readthedocs.io/

## Installation

See the original upstream [installation guide](https://agendav.readthedocs.io/en/latest/admin/installation/)

### Docker Image

This fork includes a Docker image published to GitHub Container Registry as
`ghcr.io/caldaver-app/caldaver`. Daily builds are tagged with the UTC date in
`YYYY-MM-DD` format and the newest build is also tagged as `latest`.

The Docker image builds the frontend assets, compiles `caldaver-server`, and
runs the Rust backend directly on port `8080`.

Required runtime configuration:

- `CALDAVER_CALDAV_SERVER`, for example `https://dav.example.com/dav/`
- Postgres configuration, either `CALDAVER_DATABASE_URL` or all of `CALDAVER_DB_HOST`, `CALDAVER_DB_NAME`, `CALDAVER_DB_USER`, and `CALDAVER_DB_PASSWORD`
- `CALDAVER_CSRF_SECRET`, set to a persistent secret value and keep it stable across redeployments

Common optional runtime configuration:

- `CALDAVER_AUTH_USERNAME` and `CALDAVER_AUTH_PASSWORD`, when local login should be restricted to one account
- `CALDAVER_CALDAV_USERNAME` and `CALDAVER_CALDAV_PASSWORD`, service DAV credentials used when local login is enabled
- `CALDAVER_CARDDAV_SERVER`, defaults to `CALDAVER_CALDAV_SERVER`
- `CALDAVER_CALDAV_PUBLIC_URL`, defaults to `CALDAVER_CALDAV_SERVER`
- `CALDAVER_SESSION_LIFETIME`, defaults to 30 days
- `CALDAVER_TITLE`, defaults to `Caldaver`
- `CALDAVER_FOOTER`, defaults to `Caldaver`
- `CALDAVER_BIND`, defaults to `0.0.0.0:8080`
- `CALDAVER_STATIC_ROOT`, defaults to `/var/www/caldaver/web/public` in the image
- `CALDAVER_TIMEZONE`, defaults to `UTC`

Example:

```sh
docker run -d --name caldaver \
  -p 8080:8080 \
  -e CALDAVER_CALDAV_SERVER=https://dav.example.com/dav/ \
  -e CALDAVER_DATABASE_URL=postgres://caldaver:change-this@postgres.example.com:5432/caldaver \
  -e CALDAVER_CSRF_SECRET=change-this-persistent-secret \
  -e CALDAVER_TITLE=Caldaver \
  -e CALDAVER_AUTH_USERNAME=local-user \
  -e CALDAVER_AUTH_PASSWORD=change-this \
  ghcr.io/caldaver-app/caldaver:latest
```

## Upstream Source

https://github.com/agendav/agendav

## License

GNU General Public License v3.0 or later
https://spdx.org/licenses/GPL-3.0-or-later.html

Older Docker packaging derived from `nagimov/agendav-docker` is covered by
Ruslan Nagimov's MIT license notice in
[`LICENSES/NAGIMOV-CALDAVER-DOCKER-MIT.txt`](./LICENSES/NAGIMOV-CALDAVER-DOCKER-MIT.txt).

## Changelog

See [CHANGELOG.md](./CHANGELOG.md)

## Contribution

[Contributions](./CONTRIBUTING.md) are welcome!
