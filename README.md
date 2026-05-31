# Caldaver - CalDAV web client

[![Build Status](https://github.com/caldaver-app/caldaver/actions/workflows/ci.yml/badge.svg)](https://github.com/caldaver-app/caldaver/actions)
[![Made With](https://img.shields.io/badge/made_with-rust-orange)](https://github.com/caldaver-app/caldaver#requirements)
[![License](https://img.shields.io/badge/license-gpl--3.0--or--later-blue.svg)](https://spdx.org/licenses/GPL-3.0-or-later.html)

Caldaver is a CalDAV web client served by a Rust backend with an AJAX interface
for calendars, contacts, preferences, and mail.

![Screenshot](./docs/screenshot.png)

## What Changed In This Fork

This fork has moved beyond the original PHP-only AgenDAV codebase:

- The backend has been migrated to Rust. The `caldaver-server` crate now serves
  the web app, static assets, sessions, CalDAV/CardDAV proxy behavior,
  preferences, calendar sharing, contact lookup, and mail account/message APIs.
- Shared domain logic lives in `caldaver-core`, including CalDAV filtering and
  resources, CardDAV parsing, XML generation/parsing, preferences, reminders,
  shares, and IMAP account validation.
- PostgreSQL is now the runtime store for sessions, preferences, shares, mail
  accounts, and cached mail metadata.
- The legacy PHP application, Composer runtime, bundled Ansible example, and
  Apache/PHP Docker runtime have been removed from the active application path.
- The Docker image now builds frontend assets, compiles the Rust server, and
  runs `caldaver-server` directly on port `8080`.
- Capacitor Android support builds a Caldaver APK from the same web assets and
  can point at a configured remote Caldaver server at build time.
- Android Appium and ADB smoke tests validate the installed APK and WebView
  behavior against a live backend.
- GitHub releases are produced when release artifacts are published. Each dated
  release includes source archives, the built Android APK, Docker image tags,
  and release notes listing the commits since the previous dated release.

## Requirements

Caldaver requires:

- A CalDAV server like [Baïkal](http://baikal-server.com/),
  [DAViCal](http://www.davical.org/),
  [Radicale](https://radicale.org/tutorial/), etc
- PostgreSQL for sessions, preferences, mail accounts, and cached mail metadata
- Rust stable for source builds
- Optional: nodejs & npm to build assets (releases include a build)
- Optional: Android SDK, Java 21, and Node.js when building the Android APK

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

When the release workflow publishes a Docker image, it also builds the Android
APK and updates GitHub Releases. The dated release is the durable release record;
`latest` is updated to point at the newest artifact set.

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

### Android APK

The Android app is a Capacitor wrapper around the Caldaver web UI. Build-time
configuration controls the remote server URL; do not commit deployment-specific
URLs or credentials to this repository.

Useful commands:

```sh
npm install
CALDAVER_BASE_URL=https://caldaver.example.test npm run android:apk
ANDROID_UDID=emulator-5554 npm run android:adb-smoke
```

`CALDAVER_ANDROID_SERVER_URL` overrides `CALDAVER_BASE_URL` for the generated
Capacitor Android config. `CALDAVER_ANDROID_ALLOW_NAVIGATION` can be set to a
comma-separated list of additional hosts that should remain inside the WebView.

### Releases

The release workflow publishes a complete artifact set from the same commit:

- Git tags: `YYYY-MM-DD` and `latest`
- Docker images: `ghcr.io/caldaver-app/caldaver:YYYY-MM-DD` and
  `ghcr.io/caldaver-app/caldaver:latest`
- Android APK: attached to the dated GitHub release and the `latest` release
- Source code: GitHub-generated source archives for the release tag
- Release notes: generated from commits since the previous dated release

This means every new container release also produces a matching APK release and
a GitHub release entry describing what changed.

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
