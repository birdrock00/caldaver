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

* ``CALDAVER_CALDAV_SERVER``
* ``CALDAVER_CSRF_SECRET``
* ``CALDAVER_DATABASE_URL`` or all of ``CALDAVER_DB_HOST``,
  ``CALDAVER_DB_NAME``, ``CALDAVER_DB_USER``, and ``CALDAVER_DB_PASSWORD``

Example::

  $ docker run -d --name caldaver \
      -p 8080:8080 \
      -e CALDAVER_CALDAV_SERVER=https://dav.example.com/dav/ \
      -e CALDAVER_DATABASE_URL=postgres://caldaver:change-this@postgres.example.com:5432/caldaver \
      -e CALDAVER_CSRF_SECRET=change-this-persistent-secret \
      ghcr.io/caldaver-app/caldaver:latest

Source installation
-------------------

Install frontend dependencies and build the assets::

  $ npm install
  $ npm run build

Run the Rust server with the required environment variables set::

  $ CALDAVER_CALDAV_SERVER=https://dav.example.com/dav/ \
    CALDAVER_DATABASE_URL=postgres://caldaver:change-this@localhost:5432/caldaver \
    CALDAVER_CSRF_SECRET=change-this-persistent-secret \
    cargo run --manifest-path rust/Cargo.toml --bin caldaver-server

Database setup
--------------

Caldaver stores sessions, preferences, shares, mail account metadata, and local
calendar/contact cache data in PostgreSQL. The server creates and updates its
tables automatically when it starts.

.. _webserver:

Reverse proxy configuration
---------------------------

The Rust server listens on ``CALDAVER_BIND``, which defaults to
``0.0.0.0:8080`` in the container. Put your usual TLS terminator or reverse
proxy in front of that port when exposing Caldaver publicly.
