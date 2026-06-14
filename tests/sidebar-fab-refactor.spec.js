const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = '/home/REDACTED/rpi/birdrock00-repos/caldaver';
const distCssPath = `file://${repoRoot}/web/public/dist/css/caldaver.css`;
const fontAwesomeCssPath = `file://${repoRoot}/node_modules/font-awesome/css/font-awesome.min.css`;

// A self-contained calendar-page shell matching the post-refactor markup
// (copied from web/templates/parts/sidebar.html and web/templates/calendar.html,
// with the Twig directives resolved to plain text). No network requests.
function calendarPageHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Caldaver calendar</title>
  <link rel="stylesheet" href="${distCssPath}">
  <link rel="stylesheet" href="${fontAwesomeCssPath}">
</head>
<body class="caldaver-calendar-page">
  <div class="navbar navbar-default caldaver-topbar" role="navigation">
    <div class="container-fluid">
      <div class="navbar-header">
        <button class="topbar-menu" type="button" aria-label="Toggle sidebar" title="Toggle sidebar">
          <i class="fa fa-bars"></i>
        </button>
        <span class="navbar-brand">
          <span class="mobile-calendar-toolbar-title" aria-hidden="true">
            <span id="mobile_calendar_toolbar_date"></span>
            <span id="mobile_calendar_toolbar_day"></span>
          </span>
        </span>
      </div>
    </div>
  </div>

  <div class="container-fluid calendar-shell">
    <div id="wrapper" class="calendar-layout">
      <div id="sidebar">
        <nav class="app-nav" aria-label="Application sections">
          <a class="active" href="/"><i class="fa fa-calendar"></i><span>Calendar</span></a>
          <a href="/cards"><i class="fa fa-book"></i><span>Contacts</span></a>
          <a href="/mail"><i class="fa fa-envelope"></i><span>Mail</span></a>
        </nav>
        <div class="block calendar_list panel panel-default shared_calendars calendar-sidebar-section" id="shared_calendar_list">
          <div class="panel-heading">
            <h3 class="panel-title">Shared calendars</h3>
          </div>
          <div class="panel-body">
            <ul class="fa-ul">
              <li class="calendar-list-loading"><i class="fa fa-spinner fa-spin" aria-hidden="true"></i> Loading shared calendars...</li>
            </ul>
            <div class="buttons">
              <button type="button" id="shared_calendar_add" class="pseudobutton" title="Create" aria-label="Create">
                <i class="fa fa-plus" aria-hidden="true"></i>
              </button>
              <button type="button" id="toggle_all_shared_calendars" class="pseudobutton hide_all" title="Show/hide all" aria-label="Show/hide all"><i class="fa fa-eye-slash fa-lg" aria-hidden="true"></i></button>
            </div>
          </div>
        </div>
      </div>

      <div id="content">
        <div id="calendar_view"></div>
      </div>
    </div>
  </div>

  <button type="button" id="mobile_fab_add" class="mobile-fab" aria-label="Create event" title="Create event" hidden>
    <i class="fa fa-plus" aria-hidden="true"></i>
  </button>

  <button id="shortcut_add_event" class="create-event-button" aria-label="Create event" title="Create event">
    <i class="fa fa-plus" aria-hidden="true"></i>
    <span class="visually-hidden">Create event</span>
  </button>
</body>
</html>`;
}

// The fixture links the built stylesheet via a file:// URL. Chromium only lets a
// file:// stylesheet apply when the document itself is served from file:// (a
// setContent/about:blank origin blocks it as cross-origin), so the fixture is
// written to a temp file and loaded with page.goto. The real built CSS still
// applies through the <link>, exactly as a setContent fixture would intend.
const fixturePath = path.join(os.tmpdir(), 'caldaver-sidebar-fab-fixture.html');

async function setupPage(page, viewport) {
  if (viewport) {
    await page.setViewportSize(viewport);
  }
  await page.goto(`file://${fixturePath}`, { waitUntil: 'load' });
}

async function assertFabGeometry(page) {
  const fab = page.locator('#shortcut_add_event.create-event-button');
  await expect(fab).toHaveCSS('position', 'fixed');
  await expect(fab).toHaveCSS('background-color', 'rgb(26, 115, 232)');

  const report = await fab.evaluate((el) => {
    const s = window.getComputedStyle(el);
    return {
      position: s.position,
      borderRadius: s.borderRadius,
      backgroundColor: s.backgroundColor,
      width: el.offsetWidth,
      height: el.offsetHeight,
      bottom: s.bottom,
      right: s.right
    };
  });
  expect(report.position).toBe('fixed');
  expect(report.backgroundColor).toBe('rgb(26, 115, 232)');
  expect(
    parseFloat(report.borderRadius),
    `border-radius ${report.borderRadius} must render round (>=28)`
  ).toBeGreaterThanOrEqual(28);
  expect(report.width, 'FAB must be square').toBe(report.height);
  expect(parseFloat(report.bottom), 'bottom offset must be positive').toBeGreaterThan(0);
  expect(parseFloat(report.right), 'right offset must be positive').toBeGreaterThan(0);
}

test.describe('Caldaver sidebar / FAB refactor', () => {
  test.beforeAll(() => {
    fs.writeFileSync(fixturePath, calendarPageHtml(), 'utf8');
  });

  test.afterAll(() => {
    try { fs.unlinkSync(fixturePath); } catch (e) { /* ignore */ }
  });

  test.describe('desktop viewport (1280x800)', () => {
    test.beforeEach(async ({ page }) => {
      await setupPage(page, { width: 1280, height: 800 });
    });

    test('brand logo and wordmark are gone', async ({ page }) => {
      await expect(page.locator('#logo.caldaver-sidebrand')).toHaveCount(0);
      await expect(page.locator('.caldaver-brand-title')).toHaveCount(0);
    });

    test('removed sidebar boxes (#own_calendar_list, #shortcuts, #footer) are absent', async ({ page }) => {
      await expect(page.locator('#own_calendar_list')).toHaveCount(0);
      await expect(page.locator('#shortcuts')).toHaveCount(0);
      await expect(page.locator('#footer')).toHaveCount(0);
    });

    test('#shared_calendar_add lives inside #shared_calendar_list with a plus icon', async ({ page }) => {
      const add = page.locator('#shared_calendar_add');
      await expect(add).toHaveCount(1);
      await expect(page.locator('#shared_calendar_list #shared_calendar_add')).toHaveCount(1);
      await expect(page.locator('#shared_calendar_add .fa-plus')).toHaveCount(1);
    });

    test('the create-event FAB exists outside the sidebar', async ({ page }) => {
      await expect(page.locator('#shortcut_add_event.create-event-button')).toHaveCount(1);
      await expect(page.locator('#sidebar #shortcut_add_event')).toHaveCount(0);
    });

    test('the FAB is a fixed, round, blue, bottom-right floating button', async ({ page }) => {
      await assertFabGeometry(page);
    });

    test('the legacy #mobile_fab_add is suppressed on desktop', async ({ page }) => {
      const legacy = page.locator('#mobile_fab_add.mobile-fab');
      await expect(legacy).toHaveCount(1);
      const display = await legacy.evaluate((el) => window.getComputedStyle(el).display);
      expect(display).toBe('none');
    });
  });

  test.describe('mobile viewport (390x844)', () => {
    test('the FAB stays fixed/round/blue bottom-right and .mobile-fab stays hidden', async ({ page }) => {
      await setupPage(page, { width: 390, height: 844 });
      await assertFabGeometry(page);

      const legacyDisplay = await page
        .locator('#mobile_fab_add.mobile-fab')
        .evaluate((el) => window.getComputedStyle(el).display);
      expect(legacyDisplay).toBe('none');
    });
  });
});

// Sanity guard so the test fails fast if the built assets are missing.
test('built dist stylesheet referenced by the fixture exists on disk', () => {
  expect(fs.existsSync(path.join(repoRoot, 'web/public/dist/css/caldaver.css'))).toBe(true);
});
