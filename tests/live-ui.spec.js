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
