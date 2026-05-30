# Contributing guidelines for Caldaver

Great to have you here. Here are a few ways you can help make this project better!

**Please note that this project was put into [maintenance mode](./README.md#maintenance-mode)**

## Issues

### Bugs

When reporting a bug make sure you specify the following data:

* Your Caldaver version
* What CalDAV server you are using
* A brief description of the issue
* Step by step guide of what you did, screenshots are welcome
* *What you were expecting to happen and what actualy happened*
* Any logs that could help to identify the cause

**You are encouraged to send fixes for bug reports as Pull Request**

### Features

Please explain how this feature could help the project and what is required to
implement it.

## Translation

Caldaver uses [Transifex](https://www.transifex.com/birdrock00/caldaver/) for translations.

Have a look at [Transifex documentation](http://docs.transifex.com/) for more information about
adding a new language or upadting an existing translation.

## Documentation

Documentation is automatically generated and placed on https://caldaver.readthedocs.io/.
Updating the documentation requires some [Sphinx](http://sphinx-doc.org/) knowledge.

Have a look at the `doc/` directory.

## Contributing code

There are some facts that will help you when contributing code to Caldaver:

* Caldaver ships with a [Vagrant environment](https://caldaver.readthedocs.io/en/latest/development/#virtual-machine)
  that is absolutely recommended when developing
* Caldaver includes unit tests as well, run via `./web/vendor/bin/phpunit tests`
* Caldaver repository uses [nvie's git flow](http://nvie.com/posts/a-successful-git-branching-model/)

### Pull requests

* Please open an issue on GitHub first and describe your desired change before
  starting to work on a PR
* The target branch for Pull Requests is the `development` branch
* Make your pull requests as small as possible, one topic per branch
* Make sure to add tests for your feature, and update the documentation if
  needed
* Please explain your changes in a short, readable commit message

## Coding Guidelines

This project has adopted the
[PSR-2 Coding Style Guide](https://www.php-fig.org/psr/psr-2/) for PHP Code.

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
- Use the projects base PHP version, stored in the
  [.php-version](https://packagist.org/packages/webit-de/php-version-pickup)
  file (or run `php-version-pickup use`)
- Create test build runing `npm install && npm run-script build`
- Run code quality tools
- Compare the »development« branch to »main«
  - Add a list of noteworthy features and bugfixes to CHANGELOG.md
  - Describe breaking changes in CHANGELOG.md
  - Describe changes in `doc/source/releasenotes.rst` as well
- Change the version, using semantic versioning, in these files:
  - `doc/source/conf.py`
  - `package.json`
  - `web/src/Version.php`
- Run some manual test in the Vagrant box
- Create a release commit
  ([example commit](https://github.com/birdrock00/caldaver/commit/7d2f1bba00deb090943f14bf9c47c4a6ac4d1387))
- Merge »development« branch to »main«
- Tag the »main« branch with the new version
- Push branch and tag
- Update the documentation & website
- Add release download file to release page ([example file](https://github.com/birdrock00/caldaver/releases/tag/2.2.0))
  - Clone the git repository using
    `git clone -b <version> https://github.com/birdrock00/caldaver.git caldaver-<version>`
  - Run `npm install && npm run-script dist`
    - Creates build files in `web/public/dist/css/`, `web/public/dist/js/`
      and `web/vendor/`
    - Removes `.git`, `ansible`, `node_modules`
  - Zip directory `tar -czf ../caldaver-<version>.tar.gz ../caldaver-<version>`
- Sip a tea
