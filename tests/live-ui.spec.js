const { test, expect } = require('@playwright/test');

const baseURL = process.env.CALDAVER_BASE_URL || 'http://localhost:8080';
const username = process.env.CALDAVER_USERNAME;
const password = process.env.CALDAVER_PASSWORD;

test.skip(!username || !password, 'CALDAVER_USERNAME and CALDAVER_PASSWORD are required');

async function login(page) {
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  page.on('pageerror', error => {
    consoleErrors.push(error.message);
  });

  await page.goto(`${baseURL}/login`);
  await page.locator('input[name="user"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="login"]').click();
  await expect(page.locator('#calendar_view')).toBeVisible({ timeout: 30000 });

  return consoleErrors;
}

test('calendar create and event create controls open usable dialogs', async ({ page }) => {
  const consoleErrors = await login(page);

  await page.locator('#calendar_add').click();
  await expect(page.locator('#calendar_create_dialog')).toBeVisible();
  await expect(page.locator('#calendar_create_form')).toHaveAttribute(/action/, /\/calendars\/save$/);
  await page.getByRole('button', { name: /cancel/i }).last().click();
  await expect(page.locator('#calendar_create_dialog')).toHaveCount(0);

  await expect(page.locator('#shortcut_add_event')).toBeEnabled({ timeout: 30000 });
  await page.locator('#shortcut_add_event').click();
  await expect(page.locator('#event_edit_dialog')).toBeVisible();
  await expect(page.locator('#event_edit_dialog input.summary')).toBeVisible();

  expect(consoleErrors).toEqual([]);
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
    scrollTop: document.scrollingElement.scrollTop
  }));

  expect(before.overflow).not.toBe('hidden');
  expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);

  await page.evaluate(() => document.scrollingElement.scrollTo(0, document.scrollingElement.scrollHeight));
  const afterScrollTop = await page.evaluate(() => document.scrollingElement.scrollTop);
  expect(afterScrollTop).toBeGreaterThan(before.scrollTop);
});
