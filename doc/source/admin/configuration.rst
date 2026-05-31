.. _configuration:

Configuration
=============

Caldaver is configured with environment variables.

Required settings
-----------------

.. confval:: CALDAVER_CALDAV_SERVER

   Base CalDAV URL used for calendar discovery and requests.

.. confval:: CALDAVER_CSRF_SECRET

   Persistent secret used for CSRF/session protection. Keep this stable across
   redeployments.

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

.. confval:: CALDAVER_CALDAV_USERNAME

   Optional service DAV username used when local login is enabled.

.. confval:: CALDAVER_CALDAV_PASSWORD

   Optional service DAV password used when local login is enabled.

.. confval:: CALDAVER_CARDDAV_SERVER

   CardDAV base URL. Defaults to ``CALDAVER_CALDAV_SERVER``.

.. confval:: CALDAVER_CALDAV_PUBLIC_URL

   Public CalDAV URL shown to users. Defaults to ``CALDAVER_CALDAV_SERVER``.

.. confval:: CALDAVER_CALDAV_AUTHMETHOD

   DAV authentication method. Defaults to ``basic``.

.. confval:: CALDAVER_CALDAV_CONNECT_TIMEOUT

   Connection timeout in seconds. Defaults to ``10``.

.. confval:: CALDAVER_CALDAV_RESPONSE_TIMEOUT

   Response timeout in seconds. Defaults to ``30``.

.. confval:: CALDAVER_CALDAV_CERTIFICATE_VERIFY

   Whether to verify HTTPS certificates. Defaults to ``true``.

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

Mail settings
-------------

.. confval:: CALDAVER_MAIL_PASSWORD_KEY

   Optional encryption key for stored mail account passwords. If unset, the
   server falls back to the local authentication password when present.
