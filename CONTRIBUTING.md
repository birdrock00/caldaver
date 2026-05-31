# Contributing guidelines for Caldaver

Great to have you here. Here are a few ways you can help make this project better.

## Issues

### Bugs

When reporting a bug make sure you specify the following data:

* Your Caldaver version
* What CalDAV server you are using
* A brief description of the issue
* Step by step guide of what you did, screenshots are welcome
* *What you were expecting to happen and what actualy happened*
* Any logs that could help to identify the cause

**You are encouraged to send fixes for bug reports as pull requests.**

### Features

Please explain how this feature could help the project and what is required to
implement it.

## Translation

Caldaver keeps user-facing strings in the web assets. When adding or changing
labels, update the relevant templates and JavaScript together.

## Documentation

Documentation is automatically generated and placed on https://caldaver.readthedocs.io/.
Updating the documentation requires some [Sphinx](http://sphinx-doc.org/) knowledge.

Have a look at the `doc/` directory.

## Contributing code

There are some facts that will help you when contributing code to Caldaver:

* The backend lives under `rust/` and is tested with `npm run test:rust`.
* UI regression coverage is run with `npm run test:ui`.
* Frontend assets are built with `npm run build`.
* Android packaging and smoke tests are available through the `android:*`
  npm scripts.

### Pull requests

* Please open an issue on GitHub first and describe your desired change before
  starting to work on a PR
* The target branch for Pull Requests is the `development` branch
* Make your pull requests as small as possible, one topic per branch
* Make sure to add tests for your feature, and update the documentation if
  needed
* Please explain your changes in a short, readable commit message

## Coding Guidelines

Follow the style already present in the file you are editing. Keep Rust changes
formatted with `cargo fmt`, JavaScript changes compatible with the existing
asset pipeline, and documentation concise.

## Release cycle

This project has adopted [SemVer 2 Versioning](https://semver.org/).

New commits are composed in branch `development` until a new version is
released.

The `main` branch always refers to the latest version available.

All notable changes made between each release are documented in the
[Changelog](./CHANGELOG.md).

### New Releases

Manual release steps done by project maintainers.

- Checkout latest »development« branch and rebase against »main«
- Create a test build running `npm install && npm run build`
- Run code quality tools
- Compare the »development« branch to »main«
  - Add a list of noteworthy features and bugfixes to CHANGELOG.md
  - Describe breaking changes in CHANGELOG.md
  - Describe changes in `doc/source/releasenotes.rst` as well
- Change the version, using semantic versioning, in these files:
  - `doc/source/conf.py`
  - `package.json`
- Run focused manual tests against the Rust server
- Create a release commit
  ([example commit](https://github.com/caldaver-app/caldaver/commit/7d2f1bba00deb090943f14bf9c47c4a6ac4d1387))
- Merge »development« branch to »main«
- Tag the »main« branch with the new version
- Push branch and tag
- Update the documentation & website
- Add release download file to release page ([example file](https://github.com/caldaver-app/caldaver/releases/tag/2.2.0))
  - Clone the git repository using
    `git clone -b <version> https://github.com/caldaver-app/caldaver.git caldaver-<version>`
  - Run `npm install && npm run-script dist`
    - Creates build files in `web/public/dist/css/` and `web/public/dist/js/`
    - Removes `.git`, `ansible`, and `node_modules`
  - Zip directory `tar -czf ../caldaver-<version>.tar.gz ../caldaver-<version>`
- Sip a tea
