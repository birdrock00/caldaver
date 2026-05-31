.. _upgrading:

Upgrading
=========

Before upgrading, back up your PostgreSQL database and any deployment-specific
environment configuration.

Container deployments
---------------------

Pull the desired image tag and restart the container with the same environment
variables. The server applies database schema updates at startup.

Example::

  $ docker pull ghcr.io/caldaver-app/caldaver:latest
  $ docker stop caldaver
  $ docker rm caldaver

Then start the replacement container using the same configuration described in
the :doc:`installation` section.

Source deployments
------------------

Fetch the desired revision, rebuild assets, and rebuild the Rust server::

  $ git pull
  $ npm install
  $ npm run build
  $ cargo build --release --manifest-path rust/Cargo.toml --bin caldaver-server

Restart the service with the same environment variables. Database schema
updates run automatically on startup.

Android application
-------------------

Each published release includes a matching Android APK. Install the APK that
matches your server release when you want the packaged WebView assets to track
the same commit.
