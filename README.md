# AgenDAV - CalDAV web client

[![Maintenance mode](https://img.shields.io/badge/maintenance_mode-%F0%9F%9A%A7-grey.svg?labelColor=orange)](https://github.com/agendav/agendav/#maintenance-mode)
[![Build Status](https://img.shields.io/github/workflow/status/agendav/agendav/CI/main)](https://github.com/agendav/agendav/actions)
[![Docs](https://readthedocs.org/projects/agendav/badge/?version=latest)](https://agendav.readthedocs.io/)
[![Made With](https://img.shields.io/badge/made_with-php-blue)](https://github.com/agendav/agendav#requirements)
[![License](https://img.shields.io/badge/license-gpl--3.0--or--later-blue.svg)](https://spdx.org/licenses/GPL-3.0-or-later.html)
[![Contribution](https://img.shields.io/badge/contributions_welcome-%F0%9F%94%B0-brightgreen.svg?labelColor=brightgreen)](https://github.com/agendav/agendav/blob/development/CONTRIBUTING.md)

AgenDAV is a CalDAV web client which features an AJAX interface to allow
users to manage their own calendars and shared ones.

![Screenshot](./docs/screenshot.png)

## Requirements

AgenDAV requires:

- A CalDAV server like [Baïkal](http://baikal-server.com/),
  [DAViCal](http://www.davical.org/),
  [Radicale](https://radicale.org/tutorial/), etc
- A web server
- PHP >= 7.2.0
- PHP ctype extension
- PHP mbstring extension
- PHP mcrypt extension
- PHP cURL extension
- A database supported by
  [Doctrine DBAL](https://www.doctrine-project.org/projects/doctrine-dbal/en/2.12/reference/configuration.html#configuration)
  like MySQL, PostgreSQL, SQLite
- Optional: nodejs & npm to build assets (releases include a build)

## Documentation

https://agendav.readthedocs.io/

## Installation

See [installation guide](https://agendav.readthedocs.io/en/latest/admin/installation/)

### Docker Image

This fork includes a Docker image published to GitHub Container Registry as
`ghcr.io/caldaver-app/caldaver`. Daily builds are tagged with the UTC date in
`YYYY-MM-DD` format and the newest build is also tagged as `latest`.

The Docker packaging is based on
[nagimov/agendav-docker](https://github.com/nagimov/agendav-docker). Thank you
to Ruslan Nagimov for making that work available as a basis for this image.

Required runtime configuration:

- `AGENDAV_CALDAV_SERVER`, for example `https://baikal.example.com/cal.php`
- `AGENDAV_CSRF_SECRET`, set to a unique secret value

Common optional runtime configuration:

- `AGENDAV_SERVER_NAME`, defaults to `localhost`
- `AGENDAV_TITLE`, defaults to `AgenDAV`
- `AGENDAV_FOOTER`, defaults to `AgenDAV`
- `AGENDAV_CALDAV_PUBLIC_URL`, defaults to `AGENDAV_CALDAV_SERVER`
- `AGENDAV_CARDDAV_SERVER`, defaults to `AGENDAV_CALDAV_SERVER`
- `AGENDAV_TIMEZONE`, defaults to `UTC`
- `AGENDAV_LANG`, defaults to `en`
- `AGENDAV_WEEKSTART`, defaults to `0`
- `AGENDAV_CALENDAR_SHARING`, defaults to `false`

Example:

```sh
docker run -d --name caldaver \
  -p 8080:8080 \
  -e AGENDAV_CALDAV_SERVER=https://baikal.example.com/cal.php \
  -e AGENDAV_CSRF_SECRET="$(openssl rand -hex 32)" \
  ghcr.io/caldaver-app/caldaver:latest
```

## Source

https://github.com/agendav/agendav

## License

GNU General Public License v3.0 or later
https://spdx.org/licenses/GPL-3.0-or-later.html

Docker packaging derived from `nagimov/agendav-docker` is additionally covered
by Ruslan Nagimov's MIT license notice in
[`LICENSES/NAGIMOV-AGENDAV-DOCKER-MIT.txt`](./LICENSES/NAGIMOV-AGENDAV-DOCKER-MIT.txt).

## Changelog

See [CHANGELOG.md](./CHANGELOG.md)

## Maintenance Mode

AgenDAV is in maintenance mode currently. This means that the maintainers
choose to prioritize stability and compatibility over new features for now.

- There is no active development & new major features are not planned
- New features may be added by PRs however
  - New features may be proposed in issues tickets, send as Pull Requests,
    and the maintainers will review and presumably merge them
- *PRs for bugfixes are welcome* and will be reviewed & merged
- PRs to keep the software compatible with new PHP versions or the like
  are welcome and will be reviewed & merged
- Critical security concerns will be addressed

## Contribution

[Contributions](./CONTRIBUTING.md) are welcome!
