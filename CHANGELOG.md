# Changelog

## [3.4.0] - 2026-07-15

### Android calendar reminder notifications

- **FEATURE** — Rust CalDAV backend now fully round-trips `VALARM` DISPLAY
  reminders through the CalDAV API. New `reminders` field on event responses;
  `reminders_json` form field accepted on create/edit. Unsupported alarm types
  (EMAIL, AUDIO, absolute triggers, `RELATED=END`) are preserved byte-for-byte
  during ordinary edits.
- **FEATURE** — Android app gains calendar notification support: reads visible
  calendars from the Android Calendar Provider, classifies due/expired alerts,
  posts per-calendar high-importance notifications with tap-to-open deep links,
  and shows an expired-events digest. Supports up to 20 concurrent individual
  notifications.
- **FEATURE** — New `CaldaverNotifications` Capacitor plugin exposes
  `getStatus()`, `requestPermissions()`, `openExactAlarmSettings()`,
  `openNotificationSettings()`, and `consumePendingReminder()` bridge methods.
- **PERMISSIONS** — Added `READ_CALENDAR`, `WRITE_CALENDAR`,
  `POST_NOTIFICATIONS`, `SCHEDULE_EXACT_ALARM`, `RECEIVE_BOOT_COMPLETED`, and
  `VIBRATE` declarations.
- **RECEIVER** — `CalendarReminderReceiver` handles `EVENT_REMINDER`,
  `PROVIDER_CHANGED`, time/date/boot/locale changes, and package-replaced
  broadcasts with `goAsync()` and a bounded executor.
- **BACKEND** — 12 new `caldav_event_reminder_*` Rust tests cover parsing,
  serialization, merge with unsupported alarm preservation, CRLF validation,
  and empty-array semantics. 6 new Node tests cover frontend reminder
  round-trip.
- **TOTAL** — Node 124, Rust 125, Android assemble/test PASS.

## [3.3.0] - 2026-06-16

Follow-up to the 3.2.0 mobile pass focused on honest mail actions and
calendar resilience. Mail swipe/reader delete and archive now perform real
IMAP operations (and report real failures), a single bad calendar no longer
blanks the whole calendar view, and two mobile CSS regressions are fixed.

### Mail — real delete/archive (IMAP)

- **FEATURE** — Swipe-left delete and swipe-right archive in the inbox, plus
  the reader Delete/Archive buttons, now call new authenticated backend
  routes (`POST /mail/message/delete`, `POST /mail/message/archive`) instead
  of just animating the row away and pretending it succeeded.
- Delete moves the message to the IMAP `\Trash` special-use mailbox when the
  server advertises one; otherwise it falls back to `\Deleted` + `EXPUNGE`.
- Archive uses IMAP `MOVE` (RFC 6851) into the `\Archive` mailbox, with a
  `COPY` + `\Deleted` + `EXPUNGE` fallback for servers without `MOVE`.
- Special-use mailboxes are discovered via `LIST` (`\Trash` / `\Archive`
  attributes first, then common lowercase name fallbacks).
- On any backend failure the mail row snaps back and a non-blocking error is
  shown — the user is never told an action succeeded when it did not. If no
  Archive folder exists the server returns an honest error instead of
  faking success.
- The cached message row is dropped from Postgres on success so it does not
  reappear on the next sync. The inbox page exposes the CSRF token the new
  POST routes require (`data-csrf-token` on `#mail_rows`).
- Added `imap-proto` dependency for typed `\Trash` / `\Archive` name
  attributes. Bumped `caldaver-server` / `caldaver-core` crates to `0.2.0`.

### Calendar — partial-error resilience

- **FEATURE** — `GET /events` now returns `{"events": [...], "errors": [...]}`.
  A per-calendar upstream failure (HTTP 400/404/5xx, network or XML parsing
  error from the CalDAV server) is softened into an HTTP 200 with an empty
  event list plus an entry in `errors`, so one bad calendar no longer 502s
  the entire calendar view. Auth-related failures (401/403) and
  bad-configuration errors stay hard so the client can react.
- The FullCalendar event source uses a `dataFilter` to unwrap `events` for
  older servers / cached payloads, and surfaces per-calendar `errors` as
  de-duplicated freeow toasts.

### Bug fixes

- **BUGFIX** — Mobile mail rows no longer show a blue/red colour leak: the
  grid wrapper now carries `padding: 0` so the row background fills the
  panel cleanly.
- **BUGFIX** — The Create-contact / Add-account dialog no longer
  auto-opens on mobile. The full-bleed `.contact-dialog[aria-modal="true"]`
  rule is now scoped with `:not([hidden])` so it only applies when the
  dialog is actually visible.

### Tests

- Added `tests/ui-regressions.test.js` coverage for the new mail swipe/reader
  backend wiring, the `{events, errors}` envelope, and the CSRF token
  attribute; fixed two stale assertions (session cookie `Max-Age` and the
  timezone-aware "today" comparison).

## [3.2.0] - 2026-06-15

Major mobile-UI improvement pass. Implements 45 of the 139 concrete
suggestions in `build/MOBILE_UI_REVIEW.md` (M-001 to M-280), with the
top-25 must-do list complete and every high-impact bug called out in the
Executive summary addressed.

### High-impact bug fixes

- **BUGFIX M-200** — Calendar drawer on phones no longer opens with the
  sidebar on the right and the scrim on the left. The body is now
  horizontally locked while the drawer is open (`overflow: hidden` +
  `position: fixed`), the sidebar is unambiguously at `left: 0` with
  `right: auto`, and the scrim covers the entire viewport.
- **BUGFIX M-110 / M-260** — Replaced the AgenDAV logo on the login
  page and the Android first-run setup page with a proper Caldaver SVG
  mark (uses `currentColor` so dark mode recolors cleanly). The
  misleading PNG is no longer served.
- **FEATURE M-130** — Full dark mode added. `prefers-color-scheme:
  dark` now flips every Caldaver surface — login, calendar, contacts,
  mail, preferences, event editor, account dialog, mail message — to a
  high-contrast dark palette anchored on the same brand colours. Tokens
  drive the swap so future colour changes are one-line edits.
- **BUGFIX M-053 / M-203** — The contact dialog wrapper now stretches
  edge-to-edge on phones (no centred modal), with a sticky header and
  sticky Save / Cancel footer.
- **FEATURE M-001** — A persistent bottom tab bar (Calendar / Contacts /
  Mail / Preferences) now appears on every page on phones. The active
  tab is set via a new `body[data-section]` attribute maintained by
  `mobile.js` (M-002).

### Event editor

- **FEATURE M-030** — The event editor opens as a full-height sheet on
  phones (the jQuery-UI modal centring is suppressed below 900 px) with
  sticky header and sticky Save / Cancel footer.
- **FEATURE M-031** — Editor tabs become a horizontal scrollable stepper
  on phones; the "Workgroup" tab is renamed to "Privacy" because that
  is what it actually contains.
- **FEATURE M-033** — A duration pill with `+15 / -15 / +30 / -30 / +60
  / -60` quick adjusters sits between Start and End, with a live `1h
  30m` label.
- **FEATURE M-035** — A row of repeat preset chips (Does not repeat /
  Daily / Weekdays / Weekly / Monthly / Yearly / Custom…) appears at
  the top of the recurrence tab and writes the RRule form in one tap.
- **FEATURE M-036** — The "All day" checkbox is restyled as an iOS-style
  switch. When on, a row of day-range chips (1 day / All week / 2
  weeks) appears.
- **FEATURE M-041** — Inline field validation. The first invalid field
  on the event editor form now gets `aria-invalid="true"` and the
  submit is blocked with focus moved to the offender.

### Calendar grid

- **FEATURE M-010** — Consistent "today" pill across month / week / day
  views, and a subtle weekend-cell shading in month view.
- **FEATURE M-011** — The mobile month view honours the existing
  `CaldaverUserPrefs.show_week_nb` flag and surfaces the week-number
  column.
- **FEATURE M-012** — The "+N more" overflow link in month view is
  restyled as an accent-coloured pill.
- **FEATURE M-013** — The "now" line in week / day view is thicker and
  shows a "Now" label.
- **FEATURE M-014** — The all-day row in week / day view is visually
  distinct (uppercase "all-day" label, soft separator).
- **FEATURE M-015** — Event chips show the calendar colour as a 4 px
  left bar instead of a coloured background (iOS Calendar / modern
  Gmail default). Driven by a CSS custom property that `mobile.js` sets
  from the event source's colour.
- **FEATURE M-016** — Inline icons (`📍` / `📹` / `👥`) appear on the
  event chip when the event has a location, a video URL, or attendees.
- **FEATURE M-018** — Period changes (Prev / Next) slide-and-fade for
  220 ms, with `prefers-reduced-motion` and `html[data-reduce-motion]`
  guards.
- **FEATURE M-019** — When no events are visible, a "Nothing on your
  calendar. Tap + to add an event." overlay appears.
- **FEATURE M-020** — A horizontal chip row (Today / Tomorrow / This
  week / Next week / This month) above the calendar jumps the view and
  switches the FullCalendar view in one tap.

### Mail

- **FEATURE M-070** — Mail rows on phones support swipe gestures:
  swipe-right reveals an "Archive" action, swipe-left reveals a
  "Delete" action. Listeners use `{passive: true}` (M-163).
- **FEATURE M-073** — A 1-line preview snippet is rendered under each
  mail row (driven by the existing `message.snippet` field).
- **FEATURE M-076** — The Format / Attach / More buttons in the
  compose footer are now enabled and styled as round action buttons.
- **FEATURE M-078** — The mail message detail "Reply" button is the
  first of three (Reply / Reply all / Forward) — a small bottom sheet
  picker. The dropdown is mobile-shaped and inherits the same
  `aria-live` status row as compose.

### Account / IMAP

- **FEATURE M-100** — Per-account sync status pills render in the
  account list and the dialog (green = healthy, yellow = syncing,
  red = needs reset).
- **FEATURE M-102** — The "Calendar / Contacts / Email" chooser in the
  account dialog becomes a true iOS-style segmented control; the
  previously-broken oversized radio circle is gone.
- **FEATURE M-103** — The auth-method select has a help line that
  clarifies the three options (basic / bearer / app password / none).
- **FEATURE M-104** — When an account is in `password_needs_reset`
  state, the existing red exclamation icon links directly to the
  account dialog with a "Password needs reset" affordance.

### Contacts

- **FEATURE M-051** — An alphabet index strip on the right edge of the
  mobile contacts list lets the user jump to a letter in one tap.
- **FEATURE M-052** — Tapping a contact opens a bottom-sheet detail
  panel reusing the mobile event-detail chrome.
- **FEATURE M-057** — A "Share" button on the contact detail panel uses
  `navigator.share()` (or the existing Capacitor `Share` plugin) to
  hand off a vCard.

### Onboarding / Setup

- **FEATURE M-116** — "Change server" link in the login footer for
  self-hosted users.
- **FEATURE M-117** — A "What is this?" explainer in the Android setup
  page links the three standards (CalDAV / CardDAV / IMAP) to their
  RFCs.

### Visual polish (theming, typography, motion, layout)

- **FEATURE M-132** — A Reduce motion preference toggle in
  Preferences > Accessibility. The CSS reads `html[data-reduce-motion]`
  and the toggle's state is persisted in `localStorage`. Honours the
  system `prefers-reduced-motion` query automatically.
- **FEATURE M-133** — All Caldaver brand colours are now defined as
  CSS custom properties on `:root` (see the bottom of `caldaver.less`).
  Dark mode and `prefers-contrast: more` override the same variables.
- **FEATURE M-134** — Body font stack switched to the system stack
  (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, …`); the
  Google Fonts link is removed from `layout.html`.
- **FEATURE M-135** — Base font size bumped from 16 px to 17 px on
  phones for legibility (form inputs stay 16 px to avoid the iOS
  auto-zoom).
- **FEATURE M-136** — `font-variant-numeric: tabular-nums` on every
  date, time, and count label so columns align.
- **FEATURE M-151** — A global `:focus-visible` ring (3 px solid
  accent, 2 px offset) is now the default; the rare per-element
  overrides are kept.
- **FEATURE M-153** — `prefers-contrast: more` raises every text colour
  to pure black, every border to 3:1, and forces a 4 px focus ring.
- **FEATURE M-163** — Every `addEventListener` we added uses
  `{passive: true}` for `touchstart` / `touchend` so scroll stays
  smooth. The pre-existing jQuery `.on('touchstart', …)` calls are
  left untouched to avoid changing the touch-swipe math.
- **TASK M-204** — The mobile CSS breakpoint is now defined once as
  `@mobile-max: 900px` and re-used in every media query, eliminating
  the previous mix of 768 px and 900 px queries.

### Empty states

- **FEATURE M-220 / M-221 / M-222 / M-223** — Friendly empty states
  (calendar / mail / contacts / mail accounts) with an icon, a
  one-line title, a short description, and a primary CTA. The
  contacts empty state also gets a soft pulse animation on the icon
  (respects `prefers-reduced-motion`).

### Accessibility

- **FEATURE M-150** — Semantic landmarks on every page: the calendar
  `#sidebar` becomes `<aside>`, the calendar / contacts / mail content
  areas are wrapped in `<main role="main">`, the desktop navbar is
  `role="navigation"`, the topbar is the page banner.
- **FEATURE M-152** — Body text uses `1rem` (with `html { font-size:
  100% }`) so the system font scale (iOS Dynamic Type, Android
  font-scale) is honoured.
- **FEATURE M-154** — "Skip to main content" link verified on every
  page.
- **FEATURE M-156** — `aria-live="polite"` on `#mail_compose_status`,
  the contact form errors, and the storage used pill; existing
  `aria-live="assertive"` regions on error rows preserved.

### Skeleton / performance

- **FEATURE M-138** — Pull-to-refresh generalised. Any container with
  `data-pull-refresh` is now draggable; the existing `*_refresh` button
  on the page is the trigger, so the data load path is unchanged.
- **FEATURE M-161** — Skeleton shimmer placeholders on the contacts
  loading state and the mail loading state.

### Identity

- **FEATURE M-211** — A 24 × 24 Caldaver app icon now sits to the
  left of the brand title in the top app bar.
- **FEATURE M-261** — An "About" item in the user menu opens a small
  modal with the Caldaver version (read from `CaldaverConf.version`)
  and a link to the GitHub repo.

### Misc

- **FEATURE M-091** — Recent searches helper (localStorage, last 5 per
  scope). The picker can be wired up to a global search sheet in a
  follow-up; the helper itself is exposed as `recentSearches` /
  `recordRecentSearch`.
- **FEATURE M-270** — A "Storage used" indicator in Preferences >
  Storage, using `navigator.storage.estimate()` with a graceful
  fallback when the API is missing.

### Build & engineering

- **TASK** — The Dust template compilation now includes a new
  "Privacy" i18n key (`labels.privacyoptions`) and reuses
  `labels.repeat_preset_*` for the chips. No backend changes; the
  i18n catalogue is loaded at runtime.
- **TASK** — All new CSS is concentrated in `caldaver.less` (the
  tokens + dark mode block) and `caldaver-mobile.less` (everything
  behind `@mobile-max: 900px`). The `body.chrome` and `body`
  selectors avoid touching the existing desktop layout.
- **TASK** — No new runtime dependencies. The only added JS files are
  the existing `assets/js/app/{app,mobile}.js` with new helpers, plus
  the new partial `web/templates/parts/bottom_bar.html`.
- **TASK** — Two new Dust files? No — repeat presets are added inline
  in `repeat_rule_form.dust`; the contact dialog remains
  `cards.html`'s `#contact_dialog` block. The event basic form gains
  the all-day range and duration pills.

## [2.6.0] - 2022-11-10

- FEATURE Docs: Replace outdated badge links
- FEATURE Composer: Bump versions & version ranges
- FEATURE Replace deprecated license identifier
- FEATURE !! Drop support for PHP < 7.2

## [2.5.0] - 2022-09-06

- FEATURE Pass username to CalDAV baseurl (#254)
- FEATURE Add minimal GitHub CI workflow to easen compatibility tests
- FEATURE Pin base PHP version in .php-version
- FEATURE Docs: Add docker image hint
- FEATURE Composer: Update all dependency packages
- BUGFIX Send expected Content-Type application/xml in WebDAV ACL (#252)
- BUGFIX Restore vagrant test box

## [2.4.0] - 2021-04-28

- FEATURE Allow login with HTTP Authorization header
- FEATURE Add a lang attribute on the html tag
- FEATURE Stop using bower, use npm instead
- FEATURE️Update Symfony components
- FEATURE Upgrade to jQuery 3.3.1 and Fullcalendar 3.8.0
- FEATURE Docs: Explain maintenance mode

## [2.3.0] - 2021-04-27

- FEATURE Flag session cookies with HttpOnly by default (#215)
- FEATURE Make README more verbose and welcome contributions
- FEATURE Enable estonian calendar translation (#220)
- TASK Upgrade Symfony components to 2.8.28
- BUGFIX Make vagrant test box startable again (#278)

## [2.2.1] - 2021-04-26

### Fixed

- Update display dates timezone table (#272)

## [2.2.0] - 2017-05-23

### Changed

- BC: minimum PHP version supported is now 5.6
- Upgrade Silex to 2.0.4
- Upgrade Symfony components to 2.8.20
- Upgrade Guzzle to 6.2.3
- Upgrade monolog to 1.22.1
- Upgrade ramsey/uuid to 3.6.1
- Upgrade psr/log to 1.0.2
- Upgrade doctrine packages: dbal to 2.5.12, orm to 2.5.6, migrations to 1.5.0
- Upgrade league/fractal to 0.16.0
- Upgrade sabre/http to 4.2.2
- Upgrade to Fullcalendar 3.4.0
- Remove several Symfony components that were not necessary
- CSRF tokens have now a consistent name (`_token`).

### Fixed

- ETags are now updated for all instances on recurrent events when a single instance is removed

### Added

- Document required PHP extensions (#201)
- Add caldav.certificate.verify setting to enable or disable SSL certificate verification
- Add site.favicon setting (#204)

## [2.1.0] - 2017-03-01

### Changed

- Added some missing Fullcalendar translations. Now the calendar UI matches
  user configured language
- Added tests for PHP 7.1
- Upgraded to dustjs 2.7.5 and dustjs-helpers 1.7.3
- Upgraded Symfony components to 2.8.17
- Moved all assets inside the assets/ root directory
- Updated all translations
- Switched to npm scripts to build Caldaver
- Switched to Symfony Asset component to generate URLs for assets
- Configuration is now loaded in last place, allowing further customization through settings.php
- caldaver.min.js is now ~100kB smaller

## Fixed

- Database upgrade failed on PostgreSQL (#188)
- Custom display names and/or colors on shares coming from Caldaver 1.x could not be modified due
  to old names having precedence over namespaced properties
- Do not cache ORM metadata on development mode

### Added

- Added new caldav.connect.timeout and caldav.response.timeout settings
- Added a new preference to show a marker indicating the current time
- Added a new `log.level` setting
- Added a command to clear ORM metadata cache
- Added a 'list' (also called agenda) view. Configurable through preferences
- Users can now choose their default calendar view (#72)
- Day and week numbers link to their specific views (#39)

### Removed

- Removed web profiler for development environment

## [2.0.0] - 2016-11-19

### Changed

- Made iCalendar data parsing more permissive
- Log exception messages when an unexpected HTTP code is received

## [2.0.0-rc2] - 2016-11-05

### Changed

- Updated translations

## [2.0.0-rc1] - 2016-11-05

### Changed

- Upgraded to latest moment.js (2.15.2) and moment-timezone (0.5.9)
- Upgraded to Bootstrap 3.3.7
- Calendar sharing using ACLs works again
- Switched to ParameterBag from plain arrays on controllers (internal change)
- Upgraded to Baïkal 0.4.6 inside the development machine
- Upgraded to FullCalendar 3.0.1
- Upgraded to Symfony 2.8.12 components
- Upgraded to Guzzle 6.2.2 (HTTP_PROXY vulnerability fixed)
- Upgraded to sabre/vobject 4.1.1

### Added

- Added support for showing week numbers in views, with a 
  per-user preference, defaulting to false

### Removed

- IE8 support dropped

### Fixed

- Etags were not being updated after dropping/resizing an event
- Work around ansible bug #12161 when downloading baikal in the development machine
- favico could not be loaded when served from a subdir

## [2.0.0-beta2] - 2016-04-20

### Changed

- Caldaver now requires PHP 5.5.0 or greater
- HTML code is now allowed on the footer message
- Replaced abandoned Keboola/php-encryption with phpseclib/phpseclib
- Moved caldavercli out of the bin/ subdirectory to the root directory
- Upgraded symfony/security and doctrine/* to non-vulnerable versions
- Upgraded to Bootstrap 3.3.6
- Upgraded to latest moment-timezone (0.4.1)
- Upgraded to latest Symfony 2.8.x components
- Upgraded to sabre/dav 3.1.3
- Upgraded to latest UUID generation library
- Upgraded to monolog 1.18.1
- Upgraded to Guzzle 6
- Upgraded to jQuery 1.12.3
- Upgraded to jQuery UI 1.11.4
- Upgraded to Fullcalendar 2.6.1, moment 2.13.0 and moment-timezone 0.5.3
- Improved internal XML generation component
- Error messages from the server are now handled by default, even if an error handler was not
  provided
- Switched to the new PdoSessionHandler from Symfony

### Added

- New translations: Slovak and Portuguese (Portugal)

### Removed

- Sessions are not encrypted anymore by Caldaver

### Fixed

- Build issue with new Bootstrap releases (#152)
- Authorization headers are now hidden on HTTP debug logs
- Some properties were being overwritten by mistake (#159)
- PostgreSQL migrations were not working (#150)
- Recurrent events: first instance not considered "special" anymore (#170)

## [2.0.0-beta1] - 2015-08-26

This is a beta release. Calendar sharing is not available.

### Changed
- New PHP stack based on Silex framework, Doctrine and Sabre/VObject
- Dialogs are now client-side generated. The UI feels faster
- Caldaver now requires PHP 5.4.0 or greater
- Cleaner user interface
- New color palette based on Material

### Added
- Each day height is now under control. Crowded days will show a _+n events_ link
- More database backends supported (including SQLite)
- Support for internal debugging
- New repetition rules editor with support for more complex rules
- New reminders editor
- Support for exceptions on repetitive events
- Users can now set their own language, date and time formats, which day the week starts on and timezone
- New translation: Japanese

### Removed
- Users cannot hide calendars anymore
- The agenda view has been removed from Caldaver

### Fixed
- Exotic timezones are now handled the right way

## [1.2.6.2] - 2012-10-15
- Add missing files

## [1.2.6.1] - 2012-10-15
- Handle timezones with three components (X/Y/Z)

## [1.2.6] - 2012-09-03
- Added Reminders support
- Changed dialog rendering method to use client templates via JavaScript. Much faster!
- Removed load indicator that blocked the whole page. Now it's just an spinning wheel on the top right of the application
- Upgraded:
  - CodeIgniter (to 2.1.2)
  - jQuery UI (to 1.8.23)
  - iCalcreator (to 2.14)
- Added support for IPv6 clients
- Added new option to customize login page image
- Added pt-BR translation (thanks to Fernando Mercês)
- Lots of UI improvements (icons, tooltips)
- Lots of internal fixes and improvements
- Improved print stylesheets

## [1.2.5.1] - 2012-06-11
- Removed bogus DB update scripts that made the dbupdate process fail

## [1.2.5] - 2012-06-07
- Updated jQuery to 1.7.2
- Updated jQuery UI to 1.8.20
- Updated iCalcreator to 2.12
- Added PostgreSQL support
- CalDAV client rewritten to use cURL (HTTP Digest auth now supported)
- Rewritten calendar sharing interface with autocomplete (using principal-property-search)
- Added support for read-only calendar sharing
- Improved memory usage by reusing DateTimeZone objects
- Applied some fullcalendar patches from pull request #48:
- Now a line shows current time in week/day views
- New view: 'agenda'
- Lots of aesthetical changes
- New automated database upgrade process (migrations like)
- Users can now configure their default calendar, hide calendars from list and temporarily hide events from selected calendars
- Added et (Estonian) translation (thanks to Rivo Zängov)

## [1.2.4] - 2012-01-16
- Aesthetical changes: 
- Event box padding
- Changed default blue color
- Current day cell is clearly highlighted
- More vertical and horizontal space
- Weekend days have a different background color
- Changed calendar list style
- Switched to default cursor style instead of pointer
- JavaScript and CSS compression and unification to make Caldaver load faster
- Fixed translations, were not working in IE7
- Now CalDAV URLs for principals and calendars can have different schemas
- Calendar sharing can be disabled for those servers that don't have ACL support
- Upgraded to iCalcreator 2.10.23
- Upgraded to latest git qTip2
- Upgraded to jQuery 1.7.1
- Session cookies are now smaller
- Added script (configtest.php) to check Caldaver installation requisites and basic configuration
- Added fr_FR translation (thanks to Guillaume BF)
- Added nl_NL translation (thanks to Henry Verdonschot)
- More minor bugfixes

## [1.2.3] - 2011-11-08
- Better error logging when in production mode
- Fixed editing of recurring events
- Fixed DAViCal/awl include paths when installed in same machine
- Fixed am/pm indicator under some circumstances
- Fixed fuzzy buttons on dialogs (issue #13)
- Event text color changes depending on background (dark/light)
- New default colors and color selection dialog

## [1.2.2] - 2011-10-25
- Reverted upgrade to iCalcreator. Went back to 2.10.5
- Fixed am/pm indicator
- Fixed edit of recurrent events

## [1.2.1] - 2011-10-24
- Fixed timezone and DST issues
- Fixed untranslated string
- Fixed centering of dialogs, which were top aligned
- Upgraded to latest iCalcreator release (2.10.15)
- Upgraded to latest git qTip2 release
- Modified Fullcalendar to send UTC timestamps to server

## [1.2] - 2011-10-17
- Fixed DB schema to allow full UTF8 strings. Database changes needed
- Added localization support (i18n)
- Removed annoying success messages
- Login page now shows correct logo
- Simplified configuration file
- Fixed error on calendars with special names
- Fixed error on DAViCal installations not on host root
- Upgraded Aristo jQuery UI theme to latest git version
- Better form appearance and alignment
- 'Today' cell shows with a yellow background instead the previous pale blue
- Now you can customize time/date formats and some calendar visualization parameters
- Calendar now keeps its height when changing between months with 5-6 weeks
- Configurable timezone support
- Hide time fields when editing/creating an all day event
- Add a select helper when creating events in week/day view
- Added de_DE translation (thanks to Andreas Stöckel)
- Added it_IT translation (thanks to Lorenzo Novaro)
- Added de_AT translation (thanks to Hermann Schwärzler)

## [1.1.1] - 2011-09-24
- Fix DB schema. Wasn't properlty updated on sql/schema.sql, which caused a problem with sessions
- Remove LDAP dependency. Caldaver now authenticates against CalDAV server

## [1.1] - 2011-09-18
- Caldaver has now a logo!
- Added multiple calendars support. Auto discovered via PROPFIND
- Added read+write calendar sharing, based on WebDAV ACLs
- Changed from jQuery overlay to qTip tooltips
- Restyled whole application using Aristo jQuery UI theme
- Added a _Create event_ button on top of calendar list
- Event creation/modification is now tabbed
- iCalendar parsing times are now benchmarked. They get logged and sent within HTTP header X-Parse-Time
- Upgraded libraries:
  - CodeIgniter 2.0.3
  - iCalcreator 2.10.5
  - jQuery 1.6.4
  - jQuery UI 1.8.16
  - Fullcalendar 1.5.2

## [1.0.1] - 2011-06-14
- Added 'logout_redirect_to' option
- Added 'additional_js' option
- All day events can now last more than a single day
- Upgraded to latest iCalcreator beta (2.9.6rc)
- VTIMEZONEs are now generated using iCalcreator functionality instead of having lots of .ics files on config/vtimezones
- Upgraded to jQuery 1.6.1 and jQuery UI 1.8.13
- Rearranged calendar navigation items, including a new datepicker
- Multiple calendar support
- Automatic and periodic session refresh
- Dialogs have now icons within buttons to make them clearer
- Several bugfixes and optimizations
- Changed to perifer timePicker (resembles Google Calendar timepicker)

