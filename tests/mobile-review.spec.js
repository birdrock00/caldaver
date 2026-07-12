/*
 * Caldaver mobile UI review script.
 *
 * Drives the live instance at CALDAVER_BASE_URL (required, no default)
 * with an iPhone-12/13/14-style viewport (390x844, DPR 3, mobile UA), then also
 * a 768x1024 tablet and a dark-mode mobile pass. Takes a Playwright screenshot
 * for every major surface, captures console errors and network failures, and
 * writes a JSON summary of what it found. The script NEVER embeds credentials
 * — it reads them from CALDAVER_USERNAME / CALDAVER_PASSWORD env vars (which
 * the reviewer is expected to set from the local vault).
 *
 * Usage:
 *   CALDAVER_USERNAME=... CALDAVER_PASSWORD=... \
 *     node tests/mobile-review.spec.js
 *
 * Or:
 *   CALDAVER_USERNAME=... CALDAVER_PASSWORD=... \
 *     npx playwright test tests/mobile-review.spec.js
 */

const { chromium, devices, request: pwRequest } = require('@playwright/test');
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

const summary = {
  baseURL: BASE_URL,
  viewports: {},
  pages: {},
  consoleErrors: [],
  pageErrors: [],
  requestFailures: [],
  statusFailures: [],
};

function log(...args) {
  console.log('[mobile-review]', ...args);
}

async function captureConsole(page) {
  page.on('console', msg => {
    if (msg.type() === 'error') {
      summary.consoleErrors.push({
        url: page.url(),
        text: msg.text(),
      });
    }
  });
  page.on('pageerror', err => {
    summary.pageErrors.push({
      url: page.url(),
      message: err.message,
    });
  });
  page.on('requestfailed', req => {
    summary.requestFailures.push({
      url: req.url(),
      method: req.method(),
      failure: req.failure() && req.failure().errorText,
    });
  });
  page.on('response', resp => {
    if (resp.status() >= 500) {
      summary.statusFailures.push({
        url: resp.url(),
        status: resp.status(),
      });
    }
  });
}

async function shot(page, name) {
  const file = path.join(SCREENSHOT_DIR, `${name}.png`);
  try {
    await page.screenshot({ path: file, fullPage: false });
  } catch (e) {
    log(`screenshot ${name} failed:`, e.message);
  }
  return file;
}

async function login(page) {
  log('logging in to', BASE_URL);
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="user"]').fill(USERNAME);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('input[name="login"]').click();
  await page.locator('#calendar_view').waitFor({ state: 'visible', timeout: 30000 });
  // give FullCalendar time to fetch events
  await page.waitForTimeout(2500);
}

async function gotoIfNeeded(page, urlFragment, expectSelector) {
  if (!page.url().includes(urlFragment)) {
    await page.goto(`${BASE_URL}${urlFragment}`, { waitUntil: 'domcontentloaded' });
  }
  if (expectSelector) {
    await page.locator(expectSelector).first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  }
  await page.waitForTimeout(800);
}

async function dumpView(page) {
  return page.evaluate(() => {
    const visibleBox = el => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = window.getComputedStyle(el);
      return {
        x: r.x, y: r.y, w: r.width, h: r.height,
        display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
        overflow: cs.overflow, fontSize: cs.fontSize,
      };
    };
    const pick = sel => {
      const el = document.querySelector(sel);
      return el ? visibleBox(el) : null;
    };
    const pickAll = sel => {
      return Array.from(document.querySelectorAll(sel)).map(el => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          cls: el.className || null,
          text: (el.textContent || '').trim().slice(0, 60),
          x: r.x, y: r.y, w: r.width, h: r.height,
        };
      });
    };
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
      url: location.href,
      title: document.title,
      bodyClass: document.body.className,
      htmlClass: document.documentElement.className,
      boxes: {
        topbar: pick('.caldaver-topbar'),
        sectionMenu: pick('.mobile-section-menu'),
        calendarView: pick('#calendar_view'),
        sidebar: pick('#sidebar'),
        fab: pick('#mobile_fab_add'),
        bottomBar: pick('#mobile_bottom_bar'),
        drawerToggle: pick('#mobile_drawer_toggle'),
      },
      headings: pickAll('h1, h2, h3'),
      buttons: pickAll('button, [role="button"]'),
      overflows: {
        bodyH: document.body.scrollHeight,
        bodyW: document.body.scrollWidth,
        windowH: window.innerHeight,
        windowW: window.innerWidth,
        hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      },
      mediaDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
      mediaNarrow: window.matchMedia('(max-width: 900px)').matches,
    };
  });
}

async function runViewport(name, viewport) {
  log('== viewport', name, JSON.stringify(viewport));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...viewport,
    userAgent: devices['iPhone 13'] && devices['iPhone 13'].userAgent,
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
  });
  const page = await context.newPage();
  await captureConsole(page);

  const results = {};

  // 1. login screen
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  results.login = {
    box: await dumpView(page),
    screenshot: await shot(page, `${name}-01-login`),
  };

  if (!USERNAME || !PASSWORD) {
    log('no credentials — stopping after login screen');
    summary.viewports[name] = { results, stopped: 'no-credentials' };
    await browser.close();
    return;
  }

  // 2. calendar (default)
  await login(page);
  results.calendarList = {
    box: await dumpView(page),
    screenshot: await shot(page, `${name}-02-calendar-list`),
  };

  // 3. month view
  await page.evaluate(() => {
    const view = document.querySelector('.fc-month-button');
    if (view) view.click();
  }).catch(() => {});
  await page.waitForTimeout(1200);
  results.calendarMonth = {
    box: await dumpView(page),
    screenshot: await shot(page, `${name}-03-calendar-month`),
  };

  // 4. day view
  await page.evaluate(() => {
    const view = document.querySelector('.fc-agendaDay-button');
    if (view) view.click();
  }).catch(() => {});
  await page.waitForTimeout(1200);
  results.calendarDay = {
    box: await dumpView(page),
    screenshot: await shot(page, `${name}-04-calendar-day`),
  };

  // 5. week view
  await page.evaluate(() => {
    const view = document.querySelector('.fc-agendaWeek-button');
    if (view) view.click();
  }).catch(() => {});
  await page.waitForTimeout(1200);
  results.calendarWeek = {
    box: await dumpView(page),
    screenshot: await shot(page, `${name}-05-calendar-week`),
  };

  // 6. open event detail
  await page.evaluate(() => {
    const event = document.querySelector('.fc-event');
    if (event) event.click();
  }).catch(() => {});
  await page.waitForTimeout(800);
  results.eventDetail = {
    box: await dumpView(page),
    screenshot: await shot(page, `${name}-06-event-detail`),
  };
  // close
  await page.keyboard.press('Escape').catch(() => {});
  await page.locator('body').click({ position: { x: 10, y: 10 } }).catch(() => {});
  await page.waitForTimeout(400);

  // 7. open event editor (FAB)
  await page.locator('#mobile_fab_add').click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);
  results.eventEditor = {
    box: await dumpView(page),
    screenshot: await shot(page, `${name}-07-event-editor`),
  };
  // close editor
  await page.evaluate(() => {
    const buttons = document.querySelectorAll('.ui-dialog-buttonpane button');
    for (const b of buttons) {
      if (/cancel/i.test(b.textContent)) {
        b.click();
        return;
      }
    }
  });
  await page.waitForTimeout(500);

  // 8. section menu (drawer)
  await page.locator('.mobile-section-menu summary').click().catch(() => {});
  await page.waitForTimeout(400);
  results.sectionMenu = {
    box: await dumpView(page),
    screenshot: await shot(page, `${name}-08-section-menu`),
  };
  // close menu
  await page.locator('body').click({ position: { x: 10, y: 10 } }).catch(() => {});
  await page.waitForTimeout(300);

  // 9. user menu (open it)
  await page.evaluate(() => {
    const sum = document.querySelector('.user-menu-dropdown summary');
    if (sum) sum.click();
  }).catch(() => {});
  await page.waitForTimeout(500);
  results.userMenu = {
    box: await dumpView(page),
    screenshot: await shot(page, `${name}-09-user-menu`),
  };
  await page.locator('body').click({ position: { x: 10, y: 10 } }).catch(() => {});
  await page.waitForTimeout(300);

  // 10. calendar drawer (sidebar with calendars)
  await page.locator('#mobile_drawer_toggle').click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(700);
  results.calendarDrawer = {
    box: await dumpView(page),
    screenshot: await shot(page, `${name}-10-calendar-drawer`),
  };
  await page.locator('body').click({ position: { x: 10, y: 10 } }).catch(() => {});
  await page.waitForTimeout(300);

  // 11. contacts
  await page.goto(`${BASE_URL}/cards`, { waitUntil: 'domcontentloaded' });
  await page.locator('#contacts_list, .contacts-empty').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1500);
  results.contacts = {
    box: await dumpView(page),
    screenshot: await shot(page, `${name}-11-contacts`),
  };

  // 12. contact card view
  await page.locator('.contacts-view-switch button[data-view="cards"]').click().catch(() => {});
  await page.waitForTimeout(800);
  results.contactCards = {
    box: await dumpView(page),
    screenshot: await shot(page, `${name}-12-contact-cards`),
  };

  // 13. contact dialog
  await page.locator('#contact_create, #contacts_empty_create').first().click().catch(() => {});
  await page.waitForTimeout(700);
  results.contactDialog = {
    box: await dumpView(page),
    screenshot: await shot(page, `${name}-13-contact-dialog`),
  };
  await page.locator('#contact_cancel, #contact_cancel_icon').first().click().catch(() => {});
  await page.waitForTimeout(400);

  // 14. mail
  await page.goto(`${BASE_URL}/mail`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  results.mail = {
    box: await dumpView(page),
    screenshot: await shot(page, `${name}-14-mail`),
  };

  // 15. mail compose
  await page.locator('#mail_compose').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);
  results.mailCompose = {
    box: await dumpView(page),
    screenshot: await shot(page, `${name}-15-mail-compose`),
  };
  await page.locator('#mail_compose_back').first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);

  // 16. preferences
  await page.goto(`${BASE_URL}/preferences`, { waitUntil: 'domcontentloaded' });
  await page.locator('#prefs_form').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1000);
  results.preferences = {
    box: await dumpView(page),
    screenshot: await shot(page, `${name}-16-preferences`),
  };

  // 17. account dialog in prefs
  await page.locator('#mail_account_create').click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(700);
  results.accountDialog = {
    box: await dumpView(page),
    screenshot: await shot(page, `${name}-17-account-dialog`),
  };
  await page.locator('#mail_account_cancel, #mail_account_cancel_icon').first().click().catch(() => {});
  await page.waitForTimeout(300);

  summary.viewports[name] = { results };
  await browser.close();
}

(async () => {
  log('starting mobile UI review against', BASE_URL);
  if (!USERNAME || !PASSWORD) {
    log('!! No CALDAVER_USERNAME / CALDAVER_PASSWORD set — will only inspect login screen');
  }

  // Phone
  await runViewport('iphone-13-390x844', {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });

  // Smaller phone
  await runViewport('iphone-se-375x667', {
    viewport: { width: 375, height: 667 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });

  // Tablet
  await runViewport('ipad-768x1024', {
    viewport: { width: 768, height: 1024 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });

  // Dark mode
  await runViewport('iphone-13-dark', {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
  });

  // Save summary
  const out = path.join(SCREENSHOT_DIR, 'mobile-review-summary.json');
  fs.writeFileSync(out, JSON.stringify(summary, null, 2));
  log('summary written to', out);
  log('screenshots in', SCREENSHOT_DIR);
  log('console errors:', summary.consoleErrors.length);
  log('page errors:', summary.pageErrors.length);
  log('request failures:', summary.requestFailures.length);
  log('5xx responses:', summary.statusFailures.length);
})().catch(err => {
  console.error('mobile-review failed:', err);
  process.exit(1);
});
