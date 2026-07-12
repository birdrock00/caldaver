/*
 * Caldaver mobile UI review script - v2.
 * Targeted: actually exercise state changes (open menus, change views, etc.)
 */
const { chromium, devices } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.CALDAVER_BASE_URL;
if (!BASE_URL) {
  throw new Error('CALDAVER_BASE_URL is required for this live-instance review script.');
}
const USERNAME = process.env.CALDAVER_USERNAME;
const PASSWORD = process.env.CALDAVER_PASSWORD;
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ||
  path.join(__dirname, '..', 'build', 'screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function shot(page, name) {
  const file = path.join(SCREENSHOT_DIR, `${name}.png`);
  try { await page.screenshot({ path: file, fullPage: false }); } catch (e) {}
  return file;
}

async function captureConsole(page) {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  return errors;
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: devices['iPhone 13'] && devices['iPhone 13'].userAgent,
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
  });
  const page = await context.newPage();
  const errors = await captureConsole(page);

  // login
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="user"]').fill(USERNAME);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('input[name="login"]').click();
  await page.locator('#calendar_view').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(3000);

  // --- Calendar views ---
  // Force month view via FC API
  await page.evaluate(() => $('#calendar_view').fullCalendar('changeView', 'month'));
  await page.waitForTimeout(1500);
  await shot(page, 'v2-01-calendar-month');

  await page.evaluate(() => $('#calendar_view').fullCalendar('changeView', 'agendaWeek'));
  await page.waitForTimeout(1500);
  await shot(page, 'v2-02-calendar-week');

  await page.evaluate(() => $('#calendar_view').fullCalendar('changeView', 'agendaDay'));
  await page.waitForTimeout(1500);
  await shot(page, 'v2-03-calendar-day');

  // back to list for the rest
  await page.evaluate(() => $('#calendar_view').fullCalendar('changeView', 'customizable_list'));
  await page.waitForTimeout(1500);

  // open first event (mobile detail view)
  await page.evaluate(() => {
    const ev = document.querySelector('.fc-list-item, .fc-event');
    if (ev) ev.click();
  });
  await page.waitForTimeout(1200);
  await shot(page, 'v2-04-event-detail-mobile');

  // close
  await page.locator('.mobile-event-detail-back').click().catch(() => {});
  await page.waitForTimeout(500);

  // open event editor via FAB
  await page.locator('#mobile_fab_add').click({ force: true }).catch(async () => {
    // Fallback: click the existing #shortcut_add_event
    await page.locator('#shortcut_add_event').click({ force: true });
  });
  await page.waitForTimeout(1500);
  await shot(page, 'v2-05-event-editor');

  // click each tab in the event editor
  for (const tab of ['tabs-general', 'tabs-recurrence', 'tabs-reminders', 'tabs-workgroup']) {
    await page.locator(`#event_edit_dialog a[href="#${tab}"]`).click().catch(() => {});
    await page.waitForTimeout(500);
    await shot(page, `v2-06-editor-${tab}`);
  }

  // close editor
  await page.locator('.ui-dialog-buttonpane button').filter({ hasText: /Cancel/i }).first().click().catch(() => {});
  await page.waitForTimeout(700);

  // Open section menu (topbar hamburger)
  await page.evaluate(() => {
    const sum = document.querySelector('.mobile-section-menu summary');
    if (sum) sum.click();
  });
  await page.waitForTimeout(700);
  await shot(page, 'v2-07-section-menu');

  // Click into the calendar submenu
  await page.evaluate(() => {
    const sum = document.querySelector('.mobile-calendar-menu > summary');
    if (sum) sum.click();
  });
  await page.waitForTimeout(1200);
  await shot(page, 'v2-08-section-menu-calendars');

  // close
  await page.locator('body').click({ position: { x: 200, y: 30 } }).catch(() => {});
  await page.waitForTimeout(400);

  // Open user menu
  await page.evaluate(() => {
    const sum = document.querySelector('.user-menu-dropdown summary');
    if (sum) sum.click();
  });
  await page.waitForTimeout(700);
  await shot(page, 'v2-09-user-menu');

  await page.locator('body').click({ position: { x: 200, y: 30 } }).catch(() => {});
  await page.waitForTimeout(400);

  // open date picker
  await page.locator('#mobile_calendar_date_action').click().catch(() => {});
  await page.waitForTimeout(1500);
  await shot(page, 'v2-10-datepicker');

  // close picker
  await page.keyboard.press('Escape').catch(() => {});
  await page.locator('body').click({ position: { x: 200, y: 600 } }).catch(() => {});
  await page.waitForTimeout(500);

  // open drawer
  await page.locator('#mobile_drawer_toggle').click().catch(() => {});
  await page.waitForTimeout(900);
  await shot(page, 'v2-11-drawer');

  await page.locator('body').click({ position: { x: 100, y: 400 } }).catch(() => {});
  await page.waitForTimeout(500);

  // --- Contacts: switch to card view ---
  await page.goto(`${BASE_URL}/cards`, { waitUntil: 'domcontentloaded' });
  await page.locator('#contacts_list, .contacts-empty').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(2000);

  // click "Cards" view
  await page.evaluate(() => {
    const btn = document.querySelector('.contacts-view-switch button[data-view="cards"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(1200);
  await shot(page, 'v2-12-contact-cards');

  // contact detail / dialog
  await page.locator('.contact-card, .contact-row').first().click().catch(() => {});
  await page.waitForTimeout(700);
  await shot(page, 'v2-13-contact-detail-or-card');

  // close, then try create dialog
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);

  // create-contact
  await page.locator('#contact_create, #contacts_empty_create').first().click().catch(() => {});
  await page.waitForTimeout(800);
  await shot(page, 'v2-14-contact-create');

  await page.locator('#contact_cancel, #contact_cancel_icon').first().click().catch(() => {});
  await page.waitForTimeout(400);

  // search
  await page.locator('#contacts_search').fill('22mariah');
  await page.waitForTimeout(800);
  await shot(page, 'v2-15-contact-search');
  await page.locator('#contacts_search').fill('');

  // --- Mail ---
  await page.goto(`${BASE_URL}/mail`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await shot(page, 'v2-16-mail');

  // open first message
  await page.locator('.mail-row').first().click().catch(() => {});
  await page.waitForTimeout(1200);
  await shot(page, 'v2-17-mail-message');
  await page.locator('#mail_reader_back, .back-button').first().click().catch(() => {});
  await page.waitForTimeout(500);

  // compose
  await page.locator('#mail_compose').first().click().catch(() => {});
  await page.waitForTimeout(800);
  await shot(page, 'v2-18-mail-compose');

  // fill in a recipient
  await page.locator('#mail_compose_to').fill('test@example.com');
  await page.locator('#mail_compose_subject').fill('Mobile UI test');
  await page.locator('#mail_compose_body').fill('Hello from mobile UI review!');
  await page.waitForTimeout(400);
  await shot(page, 'v2-19-mail-compose-filled');

  // back
  await page.locator('#mail_compose_back').first().click().catch(() => {});
  await page.waitForTimeout(500);

  // open account list / add account
  await page.locator('.mail-account-tab').last().click().catch(() => {});
  await page.waitForTimeout(800);
  await shot(page, 'v2-20-mail-second-account');

  // --- Preferences ---
  await page.goto(`${BASE_URL}/preferences`, { waitUntil: 'domcontentloaded' });
  await page.locator('#prefs_form').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1000);

  // scroll to see all sections
  await page.evaluate(() => window.scrollTo(0, 1000));
  await page.waitForTimeout(400);
  await shot(page, 'v2-21-preferences-scrolled');
  await page.evaluate(() => window.scrollTo(0, 0));

  // open account dialog from prefs
  await page.locator('#mail_account_create').click().catch(() => {});
  await page.waitForTimeout(900);
  await shot(page, 'v2-22-account-dialog');

  // switch to email
  await page.locator('#mail_account_form input[value="email"]').check().catch(() => {});
  await page.waitForTimeout(500);
  await shot(page, 'v2-23-account-dialog-email');

  await page.locator('#mail_account_cancel').first().click().catch(() => {});
  await page.waitForTimeout(400);

  // --- Dark mode: full pass ---
  await context.close();
  const dark = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
    userAgent: devices['iPhone 13'] && devices['iPhone 13'].userAgent,
  });
  const pageD = await dark.newPage();
  await captureConsole(pageD);
  await pageD.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await pageD.waitForTimeout(800);
  await shot(pageD, 'v2-24-dark-login');

  await pageD.locator('input[name="user"]').fill(USERNAME);
  await pageD.locator('input[name="password"]').fill(PASSWORD);
  await pageD.locator('input[name="login"]').click();
  await pageD.locator('#calendar_view').waitFor({ state: 'visible', timeout: 30000 });
  await pageD.waitForTimeout(3000);
  await shot(pageD, 'v2-25-dark-calendar');

  await pageD.goto(`${BASE_URL}/cards`, { waitUntil: 'domcontentloaded' });
  await pageD.waitForTimeout(2000);
  await shot(pageD, 'v2-26-dark-contacts');

  await pageD.goto(`${BASE_URL}/mail`, { waitUntil: 'domcontentloaded' });
  await pageD.waitForTimeout(2000);
  await shot(pageD, 'v2-27-dark-mail');

  await pageD.goto(`${BASE_URL}/preferences`, { waitUntil: 'domcontentloaded' });
  await pageD.waitForTimeout(1500);
  await shot(pageD, 'v2-28-dark-preferences');

  // Open first mail message in dark
  await pageD.goto(`${BASE_URL}/mail`, { waitUntil: 'domcontentloaded' });
  await pageD.waitForTimeout(2000);
  await pageD.locator('.mail-row').first().click().catch(() => {});
  await pageD.waitForTimeout(1200);
  await shot(pageD, 'v2-29-dark-mail-message');

  console.log('console/page errors:', errors.length);
  console.log('done; screenshots in', SCREENSHOT_DIR);
  await browser.close();
}

run().catch(err => {
  console.error('failed:', err);
  process.exit(1);
});
