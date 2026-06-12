# Caldaver - CalDAV web client

[![Build Status](https://github.com/caldaver-app/caldaver/actions/workflows/ci.yml/badge.svg)](https://github.com/caldaver-app/caldaver/actions)
[![Made With](https://img.shields.io/badge/made_with-rust-orange)](https://github.com/caldaver-app/caldaver#requirements)
[![License](https://img.shields.io/badge/license-gpl--3.0--or--later-blue.svg)](https://spdx.org/licenses/GPL-3.0-or-later.html)

Caldaver is a CalDAV web client served by a Rust backend with an AJAX interface
for calendars, contacts, preferences, and mail.

![Screenshot](./docs/screenshot.png)

## What Changed In This Fork

This fork has moved beyond the original AgenDAV codebase:

- The backend has been migrated to Rust. The `caldaver-server` crate now serves
  the web app, static assets, sessions, CalDAV/CardDAV proxy behavior,
  preferences, calendar sharing, contact lookup, and mail account/message APIs.
- Shared domain logic lives in `caldaver-core`, including CalDAV filtering and
  resources, CardDAV parsing, XML generation/parsing, preferences, reminders,
  shares, and IMAP account validation.
- PostgreSQL is now the runtime store for sessions, preferences, shares,
  CalDAV/CardDAV account credentials, mail accounts, and cached mail metadata.
- The legacy backend, dependency runtime, bundled Ansible example, and old
  web-server Docker runtime have been removed from the active application path.
- The Docker image now builds frontend assets, compiles the Rust server, and
  runs `caldaver-server` directly on port `8080`.
- Capacitor Android support builds a Caldaver APK from the same web assets and
  asks for the Caldaver instance URL on first launch.
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
- PostgreSQL for sessions, preferences, CalDAV/CardDAV account credentials,
  mail accounts, and cached mail metadata
- Rust stable for source builds
- Optional: nodejs & npm to build assets (releases include a build)
- Optional: Android SDK, Java 21, and Node.js when building the Android APK

## Documentation

Current installation and configuration notes are in `doc/source/admin/`.

## Installation

See [doc/source/admin/installation.rst](./doc/source/admin/installation.rst).

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

- Postgres configuration, either `CALDAVER_DATABASE_URL` or all of `CALDAVER_DB_HOST`, `CALDAVER_DB_NAME`, `CALDAVER_DB_USER`, and `CALDAVER_DB_PASSWORD`
- `CALDAVER_CSRF_SECRET`, set to a persistent secret value and keep it stable across redeployments
- `CALDAVER_MAIL_PASSWORD_KEY`, set from a Kubernetes Secret or equivalent
  runtime secret. Use at least 32 bytes of random material and keep it stable
  across redeployments.

PostgreSQL stores CalDAV, CardDAV, and email account credentials. Configure
those accounts from **Preferences > Accounts**. Do not store CalDAV, CardDAV, or email account passwords in Kubernetes secrets or container environment variables.
Existing DAV credentials found in a login session or legacy runtime configuration
are migrated once into Postgres and runtime DAV/mail access uses the stored
account rows after that migration.
Stored account credentials are encrypted with AES-256-GCM using random nonces.
The encryption key is derived from `CALDAVER_MAIL_PASSWORD_KEY`; the server
fails closed when that key is missing or shorter than 32 bytes. The local login
password must never be used as an encryption-key fallback.

Common optional runtime configuration:

- `CALDAVER_AUTH_USERNAME` and `CALDAVER_AUTH_PASSWORD`, when local login should be restricted to one account
- `CALDAVER_CALDAV_SERVER`, optional DAV base URL used only as a bootstrap/default server URL before an account has been saved in Postgres
- `CALDAVER_CARDDAV_SERVER`, optional CardDAV bootstrap/default server URL that defaults to `CALDAVER_CALDAV_SERVER`
- `CALDAVER_CALDAV_PUBLIC_URL`, optional public CalDAV URL shown to users
- `CALDAVER_SESSION_LIFETIME`, defaults to 30 days. Login sessions are persisted in PostgreSQL and survive server restarts. Session cookies include a `Max-Age` matching the configured lifetime, so closing the browser does not require re-authentication.
- `CALDAVER_TITLE`, defaults to `Caldaver`
- `CALDAVER_FOOTER`, defaults to `Caldaver`
- `CALDAVER_BIND`, defaults to `0.0.0.0:8080`
- `CALDAVER_STATIC_ROOT`, defaults to `/var/www/caldaver/web/public` in the image
- `CALDAVER_TIMEZONE`, defaults to `UTC`

Example:

```sh
docker run -d --name caldaver \
  -p 8080:8080 \
  -e CALDAVER_DATABASE_URL=postgres://example.test/caldaver \
  -e CALDAVER_CSRF_SECRET=<SET_ME> \
  -e CALDAVER_MAIL_PASSWORD_KEY=change-this-32-byte-minimum-secret \
  -e CALDAVER_TITLE=Caldaver \
  -e CALDAVER_AUTH_USERNAME=local-user \
  -e CALDAVER_AUTH_PASSWORD=change-this \
  ghcr.io/caldaver-app/caldaver:latest
```

### Android APK

The Android app is a Capacitor wrapper around the Caldaver web UI. The APK does
not bake in a deployment URL. On first launch, enter the Caldaver instance URL;
the app saves it on the device and opens that instance on later launches.

Useful commands:

```sh
npm install
npm run android:apk
ANDROID_UDID=emulator-5554 npm run android:adb-smoke
```

Use the Android user menu's "Change instance" action to clear the saved URL and
return to setup.

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
