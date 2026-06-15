# Caldaver

[![CI](https://github.com/caldaver-app/caldaver/actions/workflows/daily-release.yml/badge.svg)](https://github.com/caldaver-app/caldaver/actions/workflows/daily-release.yml)
[![Made with Rust](https://img.shields.io/badge/made_with-rust-orange)](https://www.rust-lang.org/)
[![PostgreSQL](https://img.shields.io/badge/postgres-required-336791)](https://www.postgresql.org/)
[![Capacitor](https://img.shields.io/badge/android-capacitor-1199EE)](https://capacitorjs.com/)
[![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg)](https://spdx.org/licenses/GPL-3.0-or-later.html)

A CalDAV/CardDAV/IMAP web client served by a Rust backend, packaged as a
container image and a Capacitor-based Android APK, with PostgreSQL as the
runtime store for sessions, preferences, share state, account credentials, and
cached mail metadata.

![Caldaver screenshot](./docs/screenshot.png)

The current UI is a clean, mobile-friendly shell: a top app bar with a section
menu, an application sidebar (Calendar / Contacts / Mail), a Shared Calendars
panel with a `+` button to add new shared calendars, a fixed blue **Create
event** floating action button that is reachable on every viewport, and no
page chrome beyond the workspace itself (no Caldaver logo, no navbar
wordmark, no footer).

## Features

### Calendar (CalDAV)

- Multiple calendars per user, with calendar create / edit / delete
- Color picker, display name, and per-calendar timezone
- **Shared Calendars** sidebar with a `+` button to add a new shared calendar
  and a show/hide toggle for the full set
- Calendar sharing UI: invite other users read-only or read-write via
  jQuery-UI autocomplete wired to `/principals`
- Read-only badge for calendars that are shared *to* the current user
- Month, week, day, and list views
- Recurring events (RRULE) with separate handling for *one instance* vs.
  *the whole series* on edit and delete
- Reminders stored with the event (minutes / hours / days / weeks / months
  before start)
- Drag-and-drop and resize on the calendar grid
- All-day and timed events with timezone-aware start/end
- Public CalDAV URL display in calendar settings
- Optional calendar sharing (gated by `CALDAVER_CALENDAR_SHARING`)

### Contacts (CardDAV)

- CardDAV account discovery with home-set detection
- Default addressbook auto-provisioning on first connect
- List view and cards view, with a search field
- Contact create / edit / delete via the in-page dialog
- Editable fields: full name, email, phone, organization, job title
- Avatars with deterministic initial + color
- Server-side CRUD against the configured CardDAV server (Radicale, Baïkal,
  DAViCal, etc.)

### Mail (IMAP)

- Per-user IMAP accounts, managed from **Preferences > Accounts**
- Multi-account sidebar; switch accounts without losing context
- Cached inbox overview for fast reloads, plus an explicit `sync` endpoint
  for a fresh IMAP fetch
- Message reader with plain-text and HTML (sandboxed iframe) bodies
- Attachment download via `/mail/attachment`
- Inline-image proxy via `/mail/image` with an SSRF guard
- Mark unread, navigation to previous/next message
- Compose and reply UI (To, CC/BCC, subject, body)
- Refresh interval per account (1 minute – 24 hours)

### Preferences and Accounts

- **General options**: language, date format (`ymd` / `dmy` / `mdy`), time
  format (`24` / `12`), week start (Sunday / Monday), timezone
- **Calendars**: default calendar, default view, week numbers, now-line
  indicator, list-view window (7 / 14 / 31 days), JavaScript toggle for
  the no-JS fallback
- **Accounts**: a single combined dialog to add or update a CalDAV, CardDAV,
  or email account, with per-row display of the server, identifier, home
  set, and last error
- Per-user preferences persisted in PostgreSQL; preserved across sessions

### Calendar sharing

- The **Shared Calendars** panel is the primary entry point for new shares
  (`+` button)
- Sharing dialog tab exposes the per-calendar share list with read-only and
  read-write roles
- Principal lookup via `/principals` for share-recipient autocomplete
- Calendar payloads expose `is_shared`, `is_owned`, `writable`, and the
  resolved owner display name

### UI and UX

- AJAX interface built on jQuery 3, Bootstrap 5, FullCalendar 3, and Dust.js
  templates compiled to a single JavaScript bundle
- Less-based theming; CSS minified with `cleancss`
- UglifyJS minified production bundle (`caldaver.min.js`)
- Mobile-first layout with a bottom mobile action bar (prev / today / view /
  refresh / next) and a floating **+** for quick create
- Pull-to-refresh on the calendar
- Mobile-aware input hints (`inputmode`, `autocomplete`, `enterkeyhint`,
  `autocapitalize`, `autocorrect`) on account, mail, and contact forms
- Accessible: ARIA roles/labels, `aria-describedby` on form fields, focus
  management on dialogs
- No-JS fallback: setting `CALDAVER_DISABLE_JAVASCRIPT=true` (or
  `?nojs=1`) renders a minimal HTML view

### Security

- CSRF token issued per session and required on every state-changing form
- Session cookies with `HttpOnly`, `SameSite=Lax`, `Max-Age`, and conditional
  `Secure` (controlled by `CALDAVER_COOKIE_SECURE`)
- AES-256-GCM encryption for stored CalDAV, CardDAV, and IMAP account
  credentials, with random nonces
- `CALDAVER_MAIL_PASSWORD_KEY` (&ge; 32 bytes) is the sole source of the
  encryption key; the server fails closed if the key is missing or short
- Optional PBKDF2-SHA256 password hash for local login
  (`CALDAVER_AUTH_PASSWORD_HASH`); constant-time comparison
- SSRF guard for user-supplied DAV server URLs: rejects loopback, link-local,
  RFC1918, multicast, and other blocked ranges by default; homelab hosts can
  be added with `CALDAVER_DAV_HOST_ALLOWLIST`
- SSRF guard for the mail image proxy
- HTML mail rendered in a sandboxed iframe with `referrerpolicy="no-referrer"`
- `x-content-type-options: nosniff` on attachment and image responses
- Database schema is created and migrated automatically at startup

### Mobile / Android

- Capacitor 8 wrapper around `web/public` (no native UI of its own)
- First launch prompts for the Caldaver instance URL; the URL is stored on
  the device and used on subsequent launches
- User menu exposes a **Change instance** action that clears the saved URL
  and returns to the setup screen
- Bottom mobile action bar and floating create button for thumb reach
- Android SDK 36, Java 21, Gradle; APK signed via `KEYSTORE_BASE64`,
  `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` workflow secrets
- Appium-based smoke test (UIAutomator2 driver) verifies the installed APK
  and the WebView against a live backend

### Deployment

- Multi-stage `Dockerfile` (Node 22 &rarr; Rust stable &rarr; debian-slim)
- Published to `ghcr.io/caldaver-app/caldaver`, tagged with the UTC date
  (`YYYY-MM-DD`), a unique release tag (`YYYY-MM-DD-HHMMSS`), and `latest`
- Image listens on `0.0.0.0:8080` and runs as the unprivileged `nobody` user
- Releases also include the Android APK and GitHub-generated source
  archives (see [Releases](#releases))
- Health probe: `GET /__rust/health` returns `{"ok": true, "backend": "rust"}`
- Sessions persist in PostgreSQL and survive server restarts
- Cookie lifetime is aligned with `CALDAVER_SESSION_LIFETIME` (default 30
  days); closing the browser does not invalidate the session

## Quick Start

Pull and run the published image with a local PostgreSQL instance. Caldaver
needs three environment variables at minimum: a database URL, a CSRF secret,
and a 32-byte-or-longer account-credential encryption key.

```sh
docker run -d --name caldaver \
  -p 8080:8080 \
  -e CALDAVER_DATABASE_URL=postgres://caldaver:secret@db.example.test:5432/caldaver \
  -e CALDAVER_CSRF_SECRET=$(openssl rand -hex 32) \
  -e CALDAVER_MAIL_PASSWORD_KEY=$(openssl rand -hex 32) \
  ghcr.io/caldaver-app/caldaver:latest
```

Open <http://localhost:8080/>, sign in, and add your CalDAV, CardDAV, and
IMAP accounts from **Preferences > Accounts**. Account credentials are
encrypted in PostgreSQL &mdash; do not put them in the container environment.

| Variable | Required | Purpose |
| --- | --- | --- |
| `CALDAVER_DATABASE_URL` | yes (or `CALDAVER_DB_*`) | PostgreSQL connection string |
| `CALDAVER_CSRF_SECRET` | yes | Stable secret for CSRF / session protection |
| `CALDAVER_MAIL_PASSWORD_KEY` | yes | &ge; 32 bytes; encrypts stored account credentials |

See [Configuration](#configuration) for the full list and the [Installation
guide](./doc/source/admin/installation.rst) for production guidance.

## Installation

Detailed, versioned installation instructions live in
[`doc/source/admin/installation.rst`](./doc/source/admin/installation.rst). The
short version:

- **Container** (recommended): pull `ghcr.io/caldaver-app/caldaver:latest`,
  set the three required environment variables, and point the image at
  PostgreSQL. The server creates its tables automatically.
- **From source**: requires Rust stable, Node.js 22 + npm, and PostgreSQL.
  `npm install && npm run build` builds the frontend assets, then
  `cargo run --manifest-path rust/Cargo.toml --bin caldaver-server` starts
  the Rust backend.
- **Reverse proxy**: put your TLS terminator in front of the bind address
  (default `0.0.0.0:8080`).

Upgrading between releases is a pull-and-restart; the server applies schema
updates at startup. See
[`doc/source/admin/upgrading.rst`](./doc/source/admin/upgrading.rst).

## Configuration

Caldaver is configured through environment variables. The full reference is
in [`doc/source/admin/configuration.rst`](./doc/source/admin/configuration.rst).
The high-level groups are:

- **Application** &mdash; `CALDAVER_TITLE`, `CALDAVER_FOOTER`, `CALDAVER_BIND`,
  `CALDAVER_STATIC_ROOT`, `CALDAVER_TIMEZONE`, `CALDAVER_LANG`,
  `CALDAVER_WEEKSTART`, `CALDAVER_DEFAULT_VIEW`,
  `CALDAVER_DISABLE_JAVASCRIPT`
- **Auth** &mdash; `CALDAVER_AUTH_USERNAME` / `CALDAVER_AUTH_PASSWORD` (or
  `CALDAVER_AUTH_PASSWORD_HASH` for PBKDF2-SHA256), `CALDAVER_COOKIE_SECURE`,
  `CALDAVER_SESSION_LIFETIME`, `CALDAVER_LOGOUT_REDIRECTION`
- **DAV bootstrap** &mdash; `CALDAVER_CALDAV_SERVER`,
  `CALDAVER_CARDDAV_SERVER`, `CALDAVER_CALDAV_PUBLIC_URL`,
  `CALDAVER_CALDAV_USERNAME` / `CALDAVER_CALDAV_PASSWORD` (bootstrap only;
  see *Account credentials* below), `CALDAVER_CALDAV_AUTHMETHOD`,
  `CALDAVER_CALDAV_CONNECT_TIMEOUT`,
  `CALDAVER_CALDAV_RESPONSE_TIMEOUT`,
  `CALDAVER_CALDAV_CERTIFICATE_VERIFY`, `CALDAVER_DAV_HOST_ALLOWLIST`
- **Sharing** &mdash; `CALDAVER_CALENDAR_SHARING` toggles the share UI
- **Database** &mdash; `CALDAVER_DATABASE_URL` or `CALDAVER_DB_HOST` /
  `CALDAVER_DB_NAME` / `CALDAVER_DB_USER` / `CALDAVER_DB_PASSWORD` /
  `CALDAVER_DB_PORT`

### Account credentials

CalDAV, CardDAV, and email account passwords are **not** read from the
container environment. PostgreSQL stores CalDAV, CardDAV, and email account credentials,
encrypted with AES-256-GCM using the key derived from
`CALDAVER_MAIL_PASSWORD_KEY`. Use at least 32 bytes of random material
and keep it stable across redeployments. The server fails closed when
that key is missing or shorter than 32 bytes. The local login password
must never be used as an encryption-key fallback. Add and maintain those
accounts from **Preferences > Accounts**. Legacy credentials that were
set through environment variables or kept in a login session are migrated
once into PostgreSQL on first run; after that, all runtime access goes
through the stored account rows.

Do not store CalDAV, CardDAV, or email account passwords in Kubernetes secrets or container environment variables.

## Build from Source

Prerequisites: Rust stable (see `rust-toolchain.toml`), Node.js 22, npm, and
PostgreSQL 14+.

```sh
# 1. Frontend
npm install
npm run build           # templates + css + js (minified)

# 2. Backend
cargo build --release --manifest-path rust/Cargo.toml --bin caldaver-server

# 3. Run
CALDAVER_DATABASE_URL=postgres://caldaver:secret@localhost:5432/caldaver \
CALDAVER_CSRF_SECRET=$(openssl rand -hex 32) \
CALDAVER_MAIL_PASSWORD_KEY=$(openssl rand -hex 32) \
  cargo run --release --manifest-path rust/Cargo.toml --bin caldaver-server
```

Frontend tests:

```sh
npm run test                # node:test unit suite
npm run test:live-ui        # Playwright against a running server
```

Backend tests:

```sh
npm run test:rust           # cargo test for the whole workspace
```

## Android

The `android/` directory holds a Capacitor 8 project. The build script
packages `web/public` into a single signed APK that asks for the Caldaver
instance URL on first launch.

```sh
# Build a debug APK
npm run android:apk

# Run the emulator-based Appium smoke test
npm run android:emulator
ANDROID_UDID=emulator-5554 npm run android:adb-smoke
```

The APK does **not** bake in a deployment URL. The first launch shows a
setup screen; the URL is stored on the device and opened on subsequent
launches. The user menu's **Change instance** action (visible on Android
only) clears the saved URL and returns to setup.

CI also produces a release APK. Each dated release attaches
`caldaver-android-<release-tag>.apk` to the matching GitHub release.

## Releases

The [daily release workflow](.github/workflows/daily-release.yml) runs
nightly at `17:10 UTC` and can also be triggered manually. Each run
publishes a coordinated artifact set from the same commit:

| Artifact | Tag / Location |
| --- | --- |
| Git tag | `YYYY-MM-DD-HHMMSS` (unique) and `latest` (force-updated) |
| Docker image | `ghcr.io/caldaver-app/caldaver:YYYY-MM-DD-HHMMSS`, `…:YYYY-MM-DD`, `…:latest` |
| Android APK | `caldaver-android-<release-tag>.apk` attached to the GitHub release |
| Source archives | GitHub-generated `tar.gz` / `zip` for the release tag |
| Release notes | Auto-generated list of commits since the previous dated release |

This means every container release also produces a matching APK release and
a GitHub release entry describing what changed.

## Tech Stack

- **Backend** &mdash; Rust (axum, tokio, sqlx, reqwest, quick-xml, chrono,
  pbkdf2, sha2, base64)
- **Storage** &mdash; PostgreSQL (sessions, preferences, shares, DAV and
  IMAP account rows, encrypted credentials, mail message cache, local
  event/contact fallback)
- **Frontend** &mdash; jQuery 3, jQuery UI, Bootstrap 5, FullCalendar 3,
  Dust.js templates, Less, Font Awesome 4
- **Mobile** &mdash; Capacitor 8 (Android API 36, Java 21, Gradle)
- **Build** &mdash; `dustc`, `lessc`, `cleancss-cli`, `uglify-js`, npm
- **Tests** &mdash; `node --test`, Playwright, Appium (UIAutomator2), ADB

## Upstream Source

Caldaver is forked from AgenDAV: <https://github.com/agendav/agendav>.

## License

GNU General Public License v3.0 or later.
<https://spdx.org/licenses/GPL-3.0-or-later.html>

Older Docker packaging derived from `nagimov/agendav-docker` is covered by
Ruslan Nagimov's MIT license notice in
[`LICENSES/NAGIMOV-CALDAVER-DOCKER-MIT.txt`](./LICENSES/NAGIMOV-CALDAVER-DOCKER-MIT.txt).

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Issues and pull requests are
welcome on the [issue tracker](https://github.com/caldaver-app/caldaver/issues).
