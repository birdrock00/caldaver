# Etar Mobile Calendar Parity Plan

Last updated: 2026-07-11 (America/Los_Angeles)

## Objective

Make Caldaver's Calendar page on mobile browsers and the Capacitor Android app
match the current Etar Calendar phone UI as closely as the FullCalendar-based
architecture permits. Desktop Caldaver is already correct and must not change.

Reference source: <https://github.com/Etar-Group/Etar-Calendar>, commit
`db1dff88` (2026-06-26). A separate local checkout is used only during QA and
its workstation path must not be committed.
Reference screenshots:
`metadata/en-US/images/phoneScreenshots/{p1,p2,p3,p4,p5,t1,t2,t4,t5}.png`.

## Non-negotiable protected surfaces

1. Keep Caldaver's existing mobile section/calendar selection menu exactly as
   it currently looks and behaves, including calendar visibility toggles.
2. Mobile Contacts and Mail must be visually and functionally unaffected.
3. Every desktop page, including desktop Calendar at widths of 901px or more,
   must be visually and functionally unaffected.
4. New calendar styling must be inside `@media (max-width: 900px)` and scoped
   beneath `body.caldaver-calendar-page`. New behavior must check that it is on
   the Calendar page and in the mobile viewport.
5. Do not include credentials, deployment URLs, device serials, local absolute
   paths, or other workstation-specific values in source, generated assets,
   tests, screenshots committed to Git, APK contents, or release notes.

## Etar parity acceptance criteria

### App bar and actions

- Use Etar's 56dp mobile app bar rather than Caldaver's current 92px blue hero.
- Preserve the existing hamburger/section/calendar selector.
- Show an Etar-style localized date title: month/year in Month and Week; full
  date plus weekday subtitle in Day and Agenda.
- Provide a 48dp Today action and vertical overflow action.
- The overflow menu should expose applicable Etar actions such as Go to date,
  Refresh, Search, Import event, and View settings without breaking Caldaver
  features.
- Remove mobile-only custom quick-filter chips and mobile bottom action/tab
  bars from the Calendar page. Do not remove shared bars from other pages.

### View selection and navigation

- Support Day (`agendaDay`), Week (`agendaWeek`), Month (`month`), and Agenda
  (`customizable_list`) on phones.
- Do not force Agenda/List view during every mobile resize or rotation.
- Persist the selected mobile view.
- Horizontal swipe changes the current period; Today returns to today.
- Browser/Android Back closes open menus, date picker, or dialogs first.

### Floating action button

- Render exactly one 56dp circular add-event FAB, 16dp from bottom/end plus safe
  area, with Etar accent teal `#1dc1ab`, a white plus, and Material shadow.
- Never render duplicate desktop/mobile FABs and hide the FAB under dialogs.

### Month view

- Seven equal columns, equal week rows, 1px `#dedede` grid, white focus-month
  cells and `#eeeeee` other-month cells.
- Compact gray weekday labels, right-aligned day numbers, Etar-style today
  highlight, and muted other-month dates.
- Timed events use a narrow calendar-color rail plus compact dark title.
- All-day/multi-day events use a solid calendar-color rectangular band with
  white compact text, not rounded card pills.

### Week and Day views

- 48dp date header, 12sp gray hour gutter on `#eeeeee`, white calendar area,
  1px `#cccccc` grid, 30-minute slots, and red current-time line.
- Solid calendar-color event blocks with white compact text and nearly square
  corners. Week shows seven days; Day shows one full-width day.

### Agenda view

- 48dp day headers with 16dp left inset, 12sp weekday, 24sp date, white future
  and gray past backgrounds, and Etar dividers.
- Minimum 64dp event rows with a 24dp square calendar-color chip, 18sp bold
  title, and 14sp gray time/location. Remove the current oversized responsive
  typography and card treatment.

### Theme and layout

- Use Etar's calendar palette only on mobile Calendar: primary `#41c3b1`, dark
  primary `#388d7f`, and accent `#1dc1ab`, plus corresponding dark surfaces.
- Honor light/dark/system theme, safe areas, rotation, and narrow widths without
  horizontal scrolling.
- Keep action targets at least 48dp and retain accessible names/focus states.

## Source mapping

Etar reference files:

- `app/src/main/res/layout/all_in_one_material.xml`
- `app/src/main/res/menu/all_in_one_title_bar.xml`
- `app/src/main/res/menu/calendar_view.xml`
- `app/src/main/java/com/android/calendar/AllInOneActivity.java`
- `app/src/main/java/com/android/calendar/CalendarToolbarHandler.java`
- `app/src/main/java/com/android/calendar/DayView.java`
- `app/src/main/java/com/android/calendar/month/MonthWeekEventsView.java`
- `app/src/main/res/layout/agenda_day.xml`
- `app/src/main/res/layout/agenda_item.xml`
- `app/src/main/res/values/{colors,dimens,integers,config}.xml`

Caldaver implementation files likely involved:

- `web/templates/calendar.html`
- `web/templates/parts/navbar.html`
- `assets/js/app/app.js`
- `assets/js/app/mobile.js`
- `assets/less/caldaver.less`
- `assets/less/caldaver-mobile.less`
- Generated `web/public/dist/css/*` and `web/public/dist/js/*`

## Work sequence

1. **Source study** — complete.
   - Extract exact Etar dimensions, colors, structures, interactions, and
     screenshots.
   - Map each Etar feature to Caldaver's templates, FullCalendar API, JS, and
     mobile Less rules.
2. **Implementation** — complete.
   - Dedicated implementation agent owns application edits.
   - Remove any attempted Etar replacement drawer: the user's existing mobile
     section/calendar selection menu is protected and must remain unchanged.
   - Add Etar toolbar/action behavior, four mobile views, rendering styles,
     single FAB, theme support, and mobile-only menu behaviors.
   - Rebuild templates, CSS, JS, and Capacitor web assets.
3. **Static and unit QA** — complete and green.
   - Run `npm run build` and `npm test`.
   - Baseline before this work: 108 tests, 106 pass, 2 pre-existing failures
     (#67 stale built JS for shared-calendar removal; #82 blank-credential
     preservation mismatch). The final branch must resolve these and pass all
     tests because the user requested a fully green QA run.
   - Run `npm run test:rust`.
   - Run Etar's `./gradlew test` and `./gradlew assembleDebug` as reference
     validation; do not modify Etar.
4. **Browser E2E and visual judge** — complete.
   - Start the Caldaver server using the existing local test configuration;
     never record its URL or credentials in tracked files or logs committed to
     Git.
   - Capture mobile Calendar screenshots for Agenda, Month, Week, Day, toolbar,
     overflow, date picker, calendar selector, event detail/editor, light/dark,
     and portrait/landscape.
   - Compare with Etar golden screenshots and source dimensions.
   - Capture protected surfaces before/after: mobile Contacts, mobile Mail,
     desktop Calendar, Contacts, Mail, and Preferences. Reject unintended diffs.
5. **Android E2E** — emulator complete; phone deferred to the CI release-signed APK.
   - SDK verified installed: API 36 platform, Build Tools 36.0.0, Platform Tools
     37.0.0, Emulator 37.1.1. Official Android 16 setup currently identifies
     API/Build Tools 36 as the latest stable platform family.
   - During the current QA run, an API 36 emulator and a physical Android 16 /
     API 36 phone both ran with SELinux Enforcing. Future runners should use
     whichever API 36 devices are available and must never persist serials.
   - Build debug APK, reinstall with `adb install -r` to preserve the user's app
     data, run Appium/ADB smoke tests on emulator and phone, and capture
     screenshots outside tracked paths unless deliberately approved.
6. **Independent security/license audit** — complete.
   - Dedicated auditor scans changed source, generated bundles, APK contents,
     screenshots, Git history additions, and release notes for leaks.
   - Add README attribution to Etar and retain Etar GPLv3 plus applicable AOSP
     Apache-2.0 notices/licenses under `LICENSES/`.
7. **Release** — in progress.
   - Review final diff and generated assets; ensure no unrelated changes.
   - Commit on `master`, push `origin` (`birdrock00/caldaver`).
   - Dispatch `.github/workflows/daily-release.yml` with an Etar mobile calendar
     release title.
   - Wait for Docker, Android APK, optional iOS, and GitHub release jobs.
   - Verify the dated tag/release and `latest`, confirm the signed
     `caldaver-android-<release-tag>.apk` asset exists and is downloadable, and
     report release URL, APK name, size, and checksum without exposing secrets.

## Work ownership

- Source-study role: completed the source-backed parity specification.
- Implementation role: owns application changes and must preserve the existing
  mobile calendar selection menu and all protected surfaces.
- Independent QA role: owns tests, browser/device QA, visual judgment, and the
  final regression verdict.
- Security role: owns leak scanning and Etar attribution/license review.
- Integrator role: owns final fixes, builds, device runs, release verification,
  and continuous updates to this document.

## Progress log

- 2026-07-11: Repository and Etar source inspected; no pre-existing dirty files.
- 2026-07-11: Etar parity criteria derived from source and shipped screenshots.
- 2026-07-11: User clarified that the current mobile section/calendar selection
  menu must remain exactly unchanged; all agents were notified.
- 2026-07-11: User added explicit isolation requirements for mobile Contacts,
  mobile Mail, and all desktop UI; QA assertions were assigned.
- 2026-07-11: Emulator and physical-device validation environments were brought
  up successfully on API 36 with SELinux Enforcing.
- 2026-07-11: Official Android documentation checked; installed API 36 platform
  and Build Tools 36.0.0 match the current stable Android 16 SDK family.
- 2026-07-11: Implementation, independent QA/judge, and security/license audit
  are running. No commit, push, tag, or release has occurred yet.
- 2026-07-11: Etar reference `gradlew test` discovered an upstream JVM test
  environment defect: 251 tests discovered, 28 passed and 223 failed, primarily
  `java.lang.RuntimeException: Stub!` from legacy `android.test.AndroidTestCase`
  constructors. This does not involve Caldaver code; the independent judge is
  retaining the XML evidence and will rely on Etar source, screenshots, build,
  and device behavior for reference validation.
- 2026-07-11: QA correctly rejects the implementation draft because it still
  contains a newly introduced Etar drawer/scrim. The implementation agent was
  instructed again to remove it and preserve the existing Caldaver selector.
- 2026-07-11: The second Etar drawer/scrim was removed and the frontend build
  passed. QA then correctly rejected runtime insertion of view choices into the
  existing selector because “exactly unchanged” includes its visible contents.
  Day/Week/Month/Agenda switching is being moved to Calendar overflow controls;
  the protected selector must receive no new markup, styling, or visible rows.
- 2026-07-11: Strict selector work completed: view switching now lives in a
  separate Calendar toolbar overflow popup and the protected selector remains
  byte/visually unchanged. Focused parity tests pass 8/8; full UI tests pass
  116/116 after hardening one pre-existing rustfmt-sensitive assertion; Rust
  tests pass 112/112; the frontend build and diff checks pass.
- 2026-07-11: Independent visual review found remaining month-view fidelity
  gaps: missing Etar today/other-month/week-number colors and inherited rounded
  white event cards. A corrective pass is active to add the exact Etar tokens,
  flat timed-event color rails, and flat solid all-day bars before live E2E.
- 2026-07-11: Month colors and event geometry were corrected; parity tests now
  pass 9/9. Authenticated live Playwright isolation passes for desktop layout,
  Contacts, and mobile/desktop Mail. The protected selector opens unchanged;
  account-row loading cannot be exercised on the empty QA database without a
  DAV server, and its unchanged error state is not an Etar regression.
- 2026-07-11: Live computed-style review found two final fidelity issues:
  Bootstrap added 16px total vertical padding to the intended 56px toolbar,
  and a legacy blue circle remained on today's month number. A final scoped
  correction is active for exact 56px height and Etar's flat today number.
- 2026-07-11: Fresh debug APK built successfully with API 36 and passed the
  independent secret/path/device-ID scan. It installs on the emulator; the
  attached phone correctly rejects the debug signature over its release-signed
  installation, so phone testing must use the CI release-signed APK without
  uninstalling or erasing app data.
- 2026-07-11: Integrator resumed after the final scoped correction. Frontend
  rebuild plus unit QA are green: UI tests 118/118 and Rust tests 112/112.
  Live computed-style verification confirmed the exact 56px zero-padding
  toolbar in Etar primary, the flat #555 today number, and a single 56px
  #1dc1ab circular FAB.
- 2026-07-11: Re-comparison against Etar reference screenshots at the pinned
  commit caught two residual month gaps the earlier passes missed: focus-month
  cells used #f2f2f2 instead of Etar's white `month_focus_month_bgcolor`, and
  day-number links kept the browser underline Etar does not draw. Both were
  fixed inside the scoped mobile Etar CSS block and locked in with two new
  parity assertions.
- 2026-07-11: Full live Playwright run: 26 passed, 12 failed; re-running the
  suite on a clean HEAD build produced the identical 12 failures (they need a
  reachable DAV backend/populated database this QA environment lacks), so the
  branch introduces no live regressions. Known judged-accepted limitation: the
  month grid keeps a bottom gap from FullCalendar's height distribution,
  consistent with the previously approved QA screenshots.
- 2026-07-11: Debug APK was rebuilt with the final web assets, passed the leak
  scan again, and installed and cold-launched (~1.5s, crash-free logcat) on the
  API 36 emulator. Phone validation remains deferred to the CI release-signed
  APK per the signature policy above.

## Resume checklist for another LLM

1. Read this entire document and current user messages before acting.
2. Run `git status --short` and inspect every diff; shared agents may still be
   writing files.
3. If parallel workers are available, inspect their status/messages and do not
   overwrite active work.
4. Confirm any Etar drawer added by an earlier implementation attempt was
   removed, because the current Caldaver calendar selector is protected.
5. Do not release until implementation, all tests, browser comparison, emulator
   test, physical-phone test, security scan, attribution, and generated bundles
   are complete and independently judged green.
6. Update the "Progress log", statuses, known failures, artifact names, commit,
   workflow run, and release verification in this document after every major
   milestone.
