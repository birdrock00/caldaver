Installation
============

In this section you will find instructions on how to install Caldaver.

.. _requirements:

Requirements
------------

Caldaver |release| requires:

* A CalDAV server
* PostgreSQL
* Rust stable for source builds
* Node.js and npm when rebuilding frontend assets

The published container image already includes the built frontend assets and
the Rust server binary.

Download Caldaver
-----------------

Caldaver |release| can be obtained at the
`Caldaver GitHub Project <https://github.com/caldaver-app/caldaver/releases>`_.

Container installation
----------------------

The container image is published to GitHub Container Registry as
``ghcr.io/caldaver-app/caldaver``. It listens on port ``8080`` by default.

Required runtime configuration:

* ``CALDAVER_CSRF_SECRET``
* ``CALDAVER_MAIL_PASSWORD_KEY`` from a Kubernetes Secret or equivalent
  runtime secret. Use at least 32 bytes of random material and keep it stable
  across redeployments.
* ``CALDAVER_DATABASE_URL`` or all of ``CALDAVER_DB_HOST``,
  ``CALDAVER_DB_NAME``, ``CALDAVER_DB_USER``, and ``CALDAVER_DB_PASSWORD``

PostgreSQL stores CalDAV, CardDAV, and email account credentials. Add and
maintain those accounts from **Preferences > Accounts**. Do not store CalDAV, CardDAV, or email account passwords in Kubernetes secrets or container environment variables.
Existing DAV credentials found in a login session or legacy runtime configuration
are migrated once into Postgres, and runtime DAV/mail access uses the stored
account rows after that migration. Credential rows are sealed with
``CALDAVER_MAIL_PASSWORD_KEY`` before being saved. Stored account credentials
are encrypted with AES-256-GCM using random nonces. The server fails closed when
the key is missing or shorter than 32 bytes, and the local login password must
never be used as an encryption-key fallback.

Example::

  $ docker run -d --name caldaver \
      -p 8080:8080 \
      -e CALDAVER_DATABASE_URL=postgres://example.test/caldaver \
      -e CALDAVER_CSRF_SECRET=<SET_ME> \
      -e CALDAVER_MAIL_PASSWORD_KEY=change-this-32-byte-minimum-secret \
      ghcr.io/caldaver-app/caldaver:latest

Source installation
-------------------

Install frontend dependencies and build the assets::

  $ npm install
  $ npm run build

Run the Rust server with the required environment variables set::

  $ CALDAVER_DATABASE_URL=postgres://example.test/caldaver \
    CALDAVER_CSRF_SECRET=<SET_ME> \
    CALDAVER_MAIL_PASSWORD_KEY=change-this-32-byte-minimum-secret \
    cargo run --manifest-path rust/Cargo.toml --bin caldaver-server

Database setup
--------------

Caldaver stores sessions, preferences, shares, CalDAV/CardDAV account
credentials, mail account metadata and credentials, and local calendar/contact
cache data in PostgreSQL. The server creates and updates its tables
automatically when it starts.

.. _webserver:

Reverse proxy configuration
---------------------------

The Rust server listens on ``CALDAVER_BIND``, which defaults to
``0.0.0.0:8080`` in the container. Put your usual TLS terminator or reverse
proxy in front of that port when exposing Caldaver publicly.
