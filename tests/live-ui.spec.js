const { test, expect } = require('@playwright/test');

const baseURL = process.env.CALDAVER_BASE_URL || 'http://localhost:8080';
const username = process.env.CALDAVER_USERNAME;
const password = process.env.CALDAVER_PASSWORD;

test.skip(!username || !password, 'CALDAVER_USERNAME and CALDAVER_PASSWORD are required');

async function login(page) {
  const pageErrors = [];

  page.on('pageerror', error => {
    pageErrors.push(error.message);
  });

  await page.goto(`${baseURL}/login`);
  await page.locator('input[name="user"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="login"]').click();
  await expect(page.locator('#calendar_view')).toBeVisible({ timeout: 30000 });
  await page.waitForFunction(() => {
    if (!window.jQuery || !window.translations || !window.AgenDAVConf || !window.AgenDAVConf.i18n) {
      return false;
    }

    const calendarAdd = document.querySelector('#calendar_add');
    const events = calendarAdd && window.jQuery._data(calendarAdd, 'events');
    return !!(events && events.click && events.click.length > 0);
  });

  return pageErrors;
}

async function eventResponses(page) {
  return page.waitForResponse(
    response => response.url().includes('/events?'),
    { timeout: 15000 }
  ).catch(() => null);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

test('calendar create and event create controls open usable dialogs', async ({ page }) => {
  const pageErrors = await login(page);

  await page.locator('#calendar_add').click();
  await expect(page.locator('#calendar_create_dialog')).toBeVisible();
  await expect(page.locator('#calendar_create_form')).toHaveAttribute('action', /\/calendars\/save$/);
  await page.getByRole('button', { name: /cancel/i }).last().click();
  await expect(page.locator('#calendar_create_dialog')).toHaveCount(0);

  await expect(page.locator('#shortcut_add_event')).toBeEnabled({ timeout: 30000 });
  await page.locator('#shortcut_add_event').click();
  await expect(page.locator('#event_edit_dialog')).toBeVisible();
  await expect(page.locator('#event_edit_dialog input.summary')).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test('calendar event feed loads without server errors', async ({ page }) => {
  const eventResponsePromise = eventResponses(page);
  const pageErrors = await login(page);
  const eventResponse = await eventResponsePromise;

  if (eventResponse) {
    expect(eventResponse.status()).toBeLessThan(500);
  }

  await expect(page.locator('.freeow')).not.toContainText(/error loading events/i);
  expect(pageErrors).toEqual([]);
});

test('created events are persisted through the configured local CalDAV server', async ({ page }) => {
  await login(page);
  await page.waitForFunction(() => document.querySelectorAll('div.calendar_list li.available_calendar').length > 0);

  const title = `CalDAVer storage smoke ${Date.now()}`;
  let createdEvent = null;
  let csrf = null;

  await page.locator('#shortcut_add_event').click();
  await expect(page.locator('#event_edit_dialog')).toBeVisible();
  await page.locator('#event_edit_dialog input.summary').fill(title);

  csrf = await page.locator('#event_edit_form input[name="_token"]').inputValue();
  const calendar = await page.locator('#event_edit_form select[name="calendar"]').inputValue();
  const saveResponsePromise = page.waitForResponse(response => response.url().includes('/events/save'));

  await page.getByRole('button', { name: /^save$/i }).click();
  const saveResponse = await saveResponsePromise;
  expect(saveResponse.status()).toBe(200);
  await expect(page.locator('#event_edit_dialog')).toHaveCount(0);

  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 7);
  const end = new Date();
  end.setUTCDate(end.getUTCDate() + 7);

  try {
    const eventsResponse = await page.request.get(
      `${baseURL}/events?calendar=${encodeURIComponent(calendar)}&start=${isoDate(start)}&end=${isoDate(end)}&timezone=America%2FLos_Angeles`
    );
    expect(eventsResponse.status()).toBe(200);

    const events = await eventsResponse.json();
    createdEvent = events.find(event => event.title === title);
    expect(createdEvent).toBeTruthy();
  } finally {
    if (createdEvent) {
      const deleteResponse = await page.request.post(`${baseURL}/events/delete`, {
        form: {
          _token: csrf,
          calendar: createdEvent.calendar,
          uid: createdEvent.uid,
          href: createdEvent.href,
          etag: createdEvent.etag
        },
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      expect(deleteResponse.status()).toBe(200);
    }
  }
});

test('preferences page remains vertically scrollable', async ({ page }) => {
  await login(page);
  await page.goto(`${baseURL}/preferences`);

  await expect(page.locator('#prefs_form')).toBeVisible();
  await expect(page.locator('#prefs_buttons')).toBeVisible();

  const before = await page.evaluate(() => ({
    overflow: window.getComputedStyle(document.body).overflow,
    scrollHeight: document.scrollingElement.scrollHeight,
    clientHeight: document.scrollingElement.clientHeight,
    scrollY: window.scrollY
  }));

  expect(before.overflow).not.toBe('hidden');
  expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);

  await page.evaluate(() => window.scrollTo({ top: 600, behavior: 'instant' }));
  const afterScrollY = await page.evaluate(() => window.scrollY);
  expect(afterScrollY).toBeGreaterThan(before.scrollY);
});

test('preferences topbar actions stay in one horizontal row', async ({ page }) => {
  await login(page);
  await page.goto(`${baseURL}/preferences`);

  const prefs = page.locator('#usermenu .prefs');
  const logout = page.locator('#usermenu .logout');
  const user = page.locator('#usermenu .user-pill');

  await expect(prefs).toBeVisible();
  await expect(logout).toBeVisible();
  await expect(user).toBeVisible();

  const boxes = await Promise.all([
    prefs.boundingBox(),
    logout.boundingBox(),
    user.boundingBox()
  ]);

  expect(boxes.every(Boolean)).toBe(true);

  const centers = boxes.map(box => ({
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  }));

  expect(Math.max(...centers.map(center => center.y)) - Math.min(...centers.map(center => center.y))).toBeLessThan(8);
  expect(centers[0].x).toBeLessThan(centers[1].x);
  expect(centers[1].x).toBeLessThan(centers[2].x);
});
