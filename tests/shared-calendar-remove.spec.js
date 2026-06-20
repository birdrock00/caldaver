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
    if (!window.jQuery || !window.translations || !window.CaldaverConf || !window.CaldaverConf.i18n) {
      return false;
    }

    const calendarAdd = document.querySelector('#shared_calendar_add');
    const events = calendarAdd && window.jQuery._data(calendarAdd, 'events');
    return !!(events && events.click && events.click.length > 0);
  });

  return pageErrors;
}

async function mockCalendarsApi(page, options = {}) {
  const calendars = options.calendars === undefined ? [
    {
      displayname: 'Work Calendar',
      calendar: '/calendars/example/work/',
      color: '#2f80ed',
      is_shared: false,
      calendar_timezone: 'America/Los_Angeles'
    },
    {
      displayname: 'Shared Calendar',
      calendar: '/calendars/example/shared/',
      color: '#27ae60',
      is_shared: true,
      calendar_timezone: 'America/Los_Angeles'
    }
  ] : options.calendars;

  await page.route('**/calendars', async route => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/calendars' || route.request().method() !== 'GET') {
      return route.fallback();
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: calendars })
    });
  });

  await page.route('**/events?**', async route => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([])
    });
  });
}

async function waitForSharedCalendarRow(page, calendarUrl) {
  await page.waitForFunction((url) => {
    const $row = window.jQuery(`#shared_calendar_list li.available_calendar[data-calendar-url="${url}"]`);
    return $row.length > 0;
  }, calendarUrl, { timeout: 10000 });
}

test.describe('Shared calendar remove (sidebar)', () => {
  test('trash button renders only on shared rows', async ({ page }) => {
    await login(page);
    await mockCalendarsApi(page);

    await page.waitForFunction(() => {
      return window.jQuery('#shared_calendar_list li.available_calendar').length > 0;
    });

    await waitForSharedCalendarRow(page, '/calendars/example/shared/');

    const sharedTrash = await page.locator(
      '#shared_calendar_list li.available_calendar[data-calendar-url="/calendars/example/shared/"] .delete_shared_calendar'
    ).count();
    expect(sharedTrash).toBe(1);

    // Owned calendars must NOT have a trash button.
    const ownedTrash = await page.locator(
      '#shared_calendar_list li.available_calendar[data-calendar-url="/calendars/example/work/"] .delete_shared_calendar'
    ).count();
    expect(ownedTrash).toBe(0);
  });

  test('confirming the dialog POSTs and removes the row, hiding the panel when empty', async ({ page }) => {
    await login(page);
    await mockCalendarsApi(page);

    await page.waitForFunction(() => {
      return window.jQuery('#shared_calendar_list li.available_calendar').length > 0;
    });

    await waitForSharedCalendarRow(page, '/calendars/example/shared/');

    const sharedUrl = '/calendars/example/shared/';

    let postedBody = null;
    await page.route('**/calendars/shared/remove', async route => {
      const req = route.request();
      if (req.method() !== 'POST') {
        return route.fallback();
      }
      postedBody = req.postData();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ result: 'SUCCESS', message: 'removed' })
      });
    });

    await page.locator(
      `#shared_calendar_list li.available_calendar[data-calendar-url="${sharedUrl}"] .delete_shared_calendar`
    ).first().click();

    const dialog = page.locator('#shared_calendar_remove_dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Shared Calendar');

    // jQuery UI renders buttons as <button> elements; pick the leftmost one
    // (the "Delete" button, which is the first action we defined).
    const buttons = page.locator('#shared_calendar_remove_dialog').locator('xpath=ancestor::div[contains(@class,"ui-dialog")]').locator('.ui-dialog-buttonset button');
    await buttons.first().click();

    await expect(dialog).toBeHidden({ timeout: 5000 });

    expect(postedBody).toBeTruthy();
    expect(postedBody).toContain(`calendar=${encodeURIComponent(sharedUrl)}`);
    expect(postedBody).toMatch(/csrf=/);

    // Row is gone.
    await page.waitForFunction((url) => {
      return window.jQuery(`#shared_calendar_list li.available_calendar[data-calendar-url="${url}"]`).length === 0;
    }, sharedUrl);

    // Panel hides when empty (single shared row was the only one).
    await page.waitForFunction(() => {
      return window.jQuery('#shared_calendar_list li.available_calendar').length === 0
        && window.jQuery('#shared_calendar_list').is(':hidden');
    }, null, { timeout: 5000 });
  });

  test('clicking cancel does NOT call the endpoint and does NOT remove the row', async ({ page }) => {
    await login(page);
    await mockCalendarsApi(page);

    await page.waitForFunction(() => {
      return window.jQuery('#shared_calendar_list li.available_calendar').length > 0;
    });

    await waitForSharedCalendarRow(page, '/calendars/example/shared/');

    const sharedUrl = '/calendars/example/shared/';

    let postCalled = false;
    await page.route('**/calendars/shared/remove', async route => {
      const req = route.request();
      if (req.method() === 'POST') {
        postCalled = true;
      }
      return route.fallback();
    });

    await page.locator(
      `#shared_calendar_list li.available_calendar[data-calendar-url="${sharedUrl}"] .delete_shared_calendar`
    ).first().click();

    const dialog = page.locator('#shared_calendar_remove_dialog');
    await expect(dialog).toBeVisible();

    // Cancel is the second button.
    const buttons = page.locator('#shared_calendar_remove_dialog').locator('xpath=ancestor::div[contains(@class,"ui-dialog")]').locator('.ui-dialog-buttonset button');
    await buttons.nth(1).click();

    await expect(dialog).toBeHidden({ timeout: 5000 });

    expect(postCalled).toBe(false);

    // Row is still there.
    await page.waitForFunction((url) => {
      return window.jQuery(`#shared_calendar_list li.available_calendar[data-calendar-url="${url}"]`).length === 1;
    }, sharedUrl);
  });
});
