.. _configuration:

Configuration
=============

Caldaver is configured with environment variables for application, database,
and login settings. Account credentials are different: PostgreSQL stores
CalDAV, CardDAV, and email account credentials. Manage those accounts from
**Preferences > Accounts**.

Do not store CalDAV, CardDAV, or email account passwords in Kubernetes secrets
or container environment variables. Existing DAV credentials found in a login
session or legacy runtime configuration are migrated once into Postgres, and
runtime DAV/mail access uses the stored account rows after that migration.
Stored account credentials are encrypted with AES-256-GCM using random nonces.
The encryption key is derived from ``CALDAVER_MAIL_PASSWORD_KEY``; the server
fails closed when that key is missing or shorter than 32 bytes. The local login
password must never be used as an encryption-key fallback.

Required settings
-----------------

.. confval:: CALDAVER_CSRF_SECRET

   Persistent secret used for CSRF/session protection. Keep this stable across
   redeployments.

.. confval:: CALDAVER_MAIL_PASSWORD_KEY

   Dedicated encryption key for stored CalDAV, CardDAV, and email account
   credentials. Provide this from a Kubernetes Secret or equivalent runtime
   secret sourced from the Ansible secrets file. Use at least 32 bytes of
   random material and keep it stable across redeployments. Do not reuse
   ``CALDAVER_AUTH_PASSWORD`` or any DAV, database, or CSRF secret for this
   value.

.. confval:: CALDAVER_DATABASE_URL

   PostgreSQL connection URL. Instead of this single URL, you may provide
   ``CALDAVER_DB_HOST``, ``CALDAVER_DB_NAME``, ``CALDAVER_DB_USER``,
   ``CALDAVER_DB_PASSWORD``, and optionally ``CALDAVER_DB_PORT``.

Authentication and DAV settings
-------------------------------

.. confval:: CALDAVER_AUTH_USERNAME

   Optional local username. When set, login is restricted to this account.

.. confval:: CALDAVER_AUTH_PASSWORD

   Optional local password for ``CALDAVER_AUTH_USERNAME``.

.. confval:: CALDAVER_AUTH_PASSWORD_HASH

   Optional PBKDF2-SHA256 encoded password hash for
   ``CALDAVER_AUTH_USERNAME``. When set, it takes precedence over
   ``CALDAVER_AUTH_PASSWORD``. Format:
   ``pbkdf2-sha256$<iterations>$<base64-salt>$<base64-digest>`` with
   ``iterations`` between ``1`` and ``2000000``, ``salt`` of at least 16
   bytes, and ``digest`` of at least 32 bytes.

.. confval:: CALDAVER_COOKIE_SECURE

   When truthy, the session cookie is set with the ``Secure`` attribute.
   Defaults to ``true``. Set this to ``false`` only when serving Caldaver
   over plain HTTP (for example, behind a TLS-terminating reverse proxy that
   is not on the same host).

.. confval:: CALDAVER_CALDAV_SERVER

   Optional CalDAV bootstrap/default server URL used before an account has
   been saved in Postgres. Do not pair this with DAV credentials in
   environment variables or Kubernetes secrets.

.. confval:: CALDAVER_CALDAV_USERNAME

   Optional bootstrap CalDAV username. Migrated to Postgres on first run
   when ``CALDAVER_CALDAV_PASSWORD`` is also set. Do not use as a long-term
   credential.

.. confval:: CALDAVER_CALDAV_PASSWORD

   Optional bootstrap CalDAV password. Migrated to Postgres (encrypted) on
   first run. Do not keep CalDAV passwords in environment variables or
   Kubernetes secrets; rotate to per-user accounts under
   **Preferences > Accounts** as soon as the first migration completes.

.. confval:: CALDAVER_CARDDAV_SERVER

   Optional CardDAV bootstrap/default server URL. Defaults to
   ``CALDAVER_CALDAV_SERVER``.

.. confval:: CALDAVER_CALDAV_PUBLIC_URL

   Optional public CalDAV URL shown to users. Defaults to
   ``CALDAVER_CALDAV_SERVER``.

.. confval:: CALDAVER_CALDAV_AUTHMETHOD

   DAV authentication method. One of ``basic``, ``bearer``, or ``none``.
   Defaults to ``basic``.

.. confval:: CALDAVER_CALDAV_CONNECT_TIMEOUT

   DAV connection timeout in seconds. Defaults to ``10``.

.. confval:: CALDAVER_CALDAV_RESPONSE_TIMEOUT

   DAV response timeout in seconds. Defaults to ``30``.

.. confval:: CALDAVER_CALDAV_CERTIFICATE_VERIFY

   Whether to verify HTTPS certificates for DAV connections. Defaults to
   ``true``.

.. confval:: CALDAVER_DAV_HOST_ALLOWLIST

   Comma-separated list of hostnames or IPs that bypass the SSRF guard
   applied to user-supplied DAV server URLs. The configured CalDAV and
   CardDAV server hosts are always allowed automatically. Use this for
   homelab deployments where the DAV server resolves to a private address.
   Matching is case-insensitive.

Application settings
--------------------

.. confval:: CALDAVER_TITLE

   Page title. Defaults to ``Caldaver``.

.. confval:: CALDAVER_FOOTER

   Footer text. Defaults to ``Caldaver``.

.. confval:: CALDAVER_BIND

   Socket address for the server. Defaults to ``0.0.0.0:8080`` in the
   container and ``127.0.0.1:3000`` when omitted by local runs.

.. confval:: CALDAVER_STATIC_ROOT

   Directory containing static frontend assets. Defaults to ``web/public`` for
   source runs and is set by the container image.

.. confval:: CALDAVER_SESSION_LIFETIME

   Session lifetime in seconds. Defaults to ``2592000``.

.. confval:: CALDAVER_LOGOUT_REDIRECTION

   Optional URL to redirect users to after logout.

.. confval:: CALDAVER_TIMEZONE

   Default time zone. Defaults to ``UTC``.

.. confval:: CALDAVER_LANG

   Default interface language. Defaults to ``en``.

.. confval:: CALDAVER_WEEKSTART

   First day of week. ``0`` means Sunday and ``1`` means Monday.

.. confval:: CALDAVER_DEFAULT_VIEW

   Default calendar view. Defaults to ``month``.

.. confval:: CALDAVER_DISABLE_JAVASCRIPT

   Disables the JavaScript-heavy interface when set to a truthy value.

.. confval:: CALDAVER_CALENDAR_SHARING

   Enables calendar sharing when set to a truthy value.
