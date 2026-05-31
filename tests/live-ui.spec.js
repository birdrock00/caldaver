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

function parsePostedForm(request) {
  const body = request.postData() || '';
  const contentType = request.headers()['content-type'] || '';

  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(body));
  }

  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!boundaryMatch) {
    return {};
  }

  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const values = {};
  body.split('--' + boundary).forEach(part => {
    const nameMatch = part.match(/Content-Disposition:[^\n]*name="([^"]+)"/i);
    const separator = part.indexOf('\r\n\r\n');
    if (!nameMatch || separator === -1) {
      return;
    }

    values[nameMatch[1]] = part.slice(separator + 4).replace(/\r\n$/, '');
  });

  return values;
}

async function mockMailApi(page, options = {}) {
  const accounts = options.accounts || [];
  const messagesByAccount = options.messagesByAccount || {};
  const cachedMessagesByAccount = options.cachedMessagesByAccount || messagesByAccount;
  const syncMessagesByAccount = options.syncMessagesByAccount || messagesByAccount;
  const messageDetails = options.messageDetails || {};
  const accountStatus = options.accountStatus || 200;
  const attachmentBody = options.attachmentBody || 'mock attachment body';
  const attachmentFilename = options.attachmentFilename || 'report.pdf';
  const attachmentBodies = options.attachmentBodies || {};
  const attachmentRequests = options.attachmentRequests || [];
  const messageRequests = options.messageRequests || [];
  const syncRequests = options.syncRequests || [];
  const unreadRequests = options.unreadRequests || [];

  function setSeen(accountId, uid, seen) {
    [messagesByAccount, cachedMessagesByAccount, syncMessagesByAccount].forEach(collection => {
      (collection[accountId] || []).forEach(message => {
        if (String(message.uid) === String(uid)) {
          message.seen = seen;
        }
      });
    });

    if (messageDetails[uid]) {
      messageDetails[uid].seen = seen;
    }
  }

  await page.route('**/mail/accounts', async route => {
    if (accountStatus >= 400) {
      return route.fulfill({
        status: accountStatus,
        contentType: 'application/json',
        body: JSON.stringify({ result: 'ERROR', message: 'Mock account load failed' })
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: accounts })
    });
  });

  if (!options.skipAccountSaveRoute) {
    await page.route('**/mail/accounts/save', async route => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result: 'SUCCESS',
          data: {
            id: 99,
            label: 'Test Inbox',
            email_address: 'test@example.com',
            imap_host: 'imap.example.test',
            imap_port: 993,
            encryption: 'ssl',
            username: 'test@example.com',
            refresh_interval_seconds: 60
          }
        })
      });
    });
  }

  await page.route('**/mail/messages/sync?**', async route => {
    const url = new URL(route.request().url());
    const accountId = url.searchParams.get('account_id');
    syncRequests.push(accountId);

    if (options.delays && options.delays[accountId]) {
      await new Promise(resolve => setTimeout(resolve, options.delays[accountId]));
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result: 'SUCCESS', cached: false, data: syncMessagesByAccount[accountId] || [] })
    });
  });

  await page.route('**/mail/messages?**', async route => {
    const url = new URL(route.request().url());
    const accountId = url.searchParams.get('account_id');

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result: 'SUCCESS', cached: true, data: cachedMessagesByAccount[accountId] || [] })
    });
  });

  await page.route('**/mail/message?**', async route => {
    const url = new URL(route.request().url());
    const accountId = url.searchParams.get('account_id');
    const uid = url.searchParams.get('uid');
    messageRequests.push({ account_id: accountId, uid });
    setSeen(accountId, uid, true);

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result: 'SUCCESS', data: messageDetails[uid] })
    });
  });

  await page.route('**/mail/message/unread', async route => {
    const form = parsePostedForm(route.request());
    unreadRequests.push(form);
    setSeen(form.account_id, form.uid, false);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result: 'SUCCESS', data: { seen: false } })
    });
  });

  await page.route('**/mail/attachment?**', async route => {
    const url = new URL(route.request().url());
    const request = Object.fromEntries(url.searchParams.entries());
    attachmentRequests.push(request);
    const message = messageDetails[request.uid] || {};
    const attachment = (message.attachments || []).find(item => String(item.part) === String(request.part)) || {};
    const filename = attachment.filename || attachmentFilename;
    const body = Object.prototype.hasOwnProperty.call(attachmentBodies, filename)
      ? attachmentBodies[filename]
      : attachmentBody;

    return route.fulfill({
      status: 200,
      contentType: attachment.content_type || 'application/octet-stream',
      headers: {
        'Content-Disposition': `attachment; filename="${filename}"`
      },
      body
    });
  });
}

async function openMailAccountDialog(page) {
  await page.goto(`${baseURL}/preferences`);
  await page.locator('#mail_account_create').click();
}

async function mockCardsApi(page, count = 36) {
  const contacts = Array.from({ length: count }, (_, index) => ({
    full_name: `Mobile Contact ${String(index + 1).padStart(2, '0')}`,
    email: `mobile${index + 1}@example.test`,
    phone: `555-010${index % 10}`,
    organization: 'Example Co',
    job_title: 'Tester',
    company_line: 'Tester, Example Co',
    labels: [],
    url: `/contacts/mobile-${index + 1}.vcf`,
    etag: `"${index + 1}"`
  }));

  await page.route('**/cards/list', async route => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: contacts })
    });
  });
}

function captureConsoleErrors(page) {
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') {
      const text = message.text();
      if (/Failed to load resource: the server responded with a status of (400|401|500)/.test(text)) {
        return;
      }
      consoleErrors.push(text);
    }
  });
  return consoleErrors;
}

async function visibleBox(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  expect(box, `${selector} should have a visible bounding box`).toBeTruthy();
  return box;
}

function overlaps(a, b) {
  return a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y;
}

async function dispatchTouchSwipe(page, selector, startX, endX, y = 220) {
  await page.locator(selector).waitFor({ state: 'visible' });
  await page.evaluate(({ itemSelector, fromX, toX, clientY }) => {
    const element = document.querySelector(itemSelector);
    const touch = clientX => ({
      identifier: 1,
      target: element,
      clientX,
      clientY,
      pageX: clientX,
      pageY: clientY,
      screenX: clientX,
      screenY: clientY
    });
    const start = new Event('touchstart', { bubbles: true, cancelable: true });
    Object.defineProperty(start, 'touches', { value: [touch(fromX)] });
    Object.defineProperty(start, 'changedTouches', { value: [touch(fromX)] });
    element.dispatchEvent(start);

    const end = new Event('touchend', { bubbles: true, cancelable: true });
    Object.defineProperty(end, 'touches', { value: [] });
    Object.defineProperty(end, 'changedTouches', { value: [touch(toX)] });
    element.dispatchEvent(end);
  }, { itemSelector: selector, fromX: startX, toX: endX, clientY: y });
}

async function dispatchDoubleTouchTap(page, selector) {
  await page.locator(selector).waitFor({ state: 'visible' });
  await page.evaluate(itemSelector => {
    const element = document.querySelector(itemSelector);
    const touch = {
      identifier: 1,
      target: element,
      clientX: 24,
      clientY: 24,
      pageX: 24,
      pageY: 24,
      screenX: 24,
      screenY: 24
    };

    function touchEnd() {
      const event = new Event('touchend', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: [] });
      Object.defineProperty(event, 'changedTouches', { value: [touch] });
      element.dispatchEvent(event);
    }

    touchEnd();
    touchEnd();
  }, selector);
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

test('mobile calendar event feed loads without server errors', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
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

  const title = `Caldaver storage smoke ${Date.now()}`;
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

test('contacts section opens from the left tab and supports card view', async ({ page }) => {
  await login(page);
  const listResponsePromise = page.waitForResponse(response => response.url().includes('/cards/list'));

  await page.getByRole('link', { name: /contacts/i }).click();
  await expect(page).toHaveURL(/\/cards$/);
  await expect(page.locator('.contacts-panel')).toBeVisible();
  await expect(page.locator('#contact_create')).toBeVisible();
  await expect(page.locator('#contacts_list')).toBeVisible();

  const listResponse = await listResponsePromise;
  expect(listResponse.status()).toBe(200);

  await page.locator('.contacts-view-switch button[data-view="cards"]').click();
  await expect(page.locator('#contacts_cards')).toBeVisible();
});

test('contact card double tap dialing is disabled in browser contexts', async ({ page }) => {
  await mockCardsApi(page, 1);
  await page.addInitScript(() => {
    window.__contactDialProbe = { confirms: [], opens: [] };
    window.open = (url, target) => {
      window.__contactDialProbe.opens.push({ url, target });
      return null;
    };
  });

  await login(page);
  await page.goto(`${baseURL}/cards`);
  await page.locator('.contacts-view-switch button[data-view="cards"]').click();
  await expect(page.locator('#contacts_cards .contact-card')).toHaveCount(1);
  await dispatchDoubleTouchTap(page, '#contacts_cards .contact-card');
  await page.waitForTimeout(100);
  await expect.poll(() => page.evaluate(() => window.__contactDialProbe)).toEqual({ confirms: [], opens: [] });

  await page.addInitScript(() => {
    window.Capacitor = {
      getPlatform: () => 'web',
      isNativePlatform: () => false,
      Plugins: {
        Dialog: {
          confirm: options => {
            window.__contactDialProbe.confirms.push(options);
            return Promise.resolve({ value: true });
          }
        }
      }
    };
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseURL}/cards`);
  await page.locator('.contacts-view-switch button[data-view="cards"]').click();
  await expect(page.locator('#contacts_cards .contact-card')).toHaveCount(1);
  await dispatchDoubleTouchTap(page, '#contacts_cards .contact-card');
  await page.waitForTimeout(100);
  await expect.poll(() => page.evaluate(() => window.__contactDialProbe)).toEqual({ confirms: [], opens: [] });
});

test('created contacts are persisted through the configured local CardDAV server', async ({ page }) => {
  await login(page);
  await page.goto(`${baseURL}/cards`);
  await expect(page.locator('#contact_form input[name="_token"]')).toHaveCount(1);

  const csrf = await page.locator('#contact_form input[name="_token"]').inputValue();
  const fullName = `Caldaver Contact Smoke ${Date.now()}`;
  let createdContact = null;

  const saveResponse = await page.request.post(`${baseURL}/cards/save`, {
    form: {
      _token: csrf,
      full_name: fullName,
      email: 'caldaver-smoke@example.com',
      phone: '+14155550199',
      organization: 'Caldaver',
      job_title: 'Smoke Test'
    },
    headers: { 'X-Requested-With': 'XMLHttpRequest' }
  });
  expect(saveResponse.status()).toBe(200);

  try {
    const listResponse = await page.request.get(`${baseURL}/cards/list`);
    expect(listResponse.status()).toBe(200);

    const payload = await listResponse.json();
    createdContact = payload.data.find(contact => contact.full_name === fullName);
    expect(createdContact).toBeTruthy();
    expect(createdContact.email).toBe('caldaver-smoke@example.com');
    expect(createdContact.phone).toBe('+14155550199');
  } finally {
    if (createdContact) {
      const deleteResponse = await page.request.post(`${baseURL}/cards/delete`, {
        form: {
          _token: csrf,
          url: createdContact.url,
          etag: createdContact.etag
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
  await expect(page.locator('input[name="disable_javascript"][value="false"]')).toBeChecked();

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

test('preferences topbar actions stay in one horizontal row with user logout menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto(`${baseURL}/preferences`);

  const menu = page.locator('.mobile-section-menu');
  const brand = page.locator('.caldaver-brand-title');
  const prefs = page.locator('#usermenu .prefs');
  const user = page.locator('#usermenu .user-pill');
  const logout = page.locator('#usermenu .user-menu-logout');

  await expect(menu).toBeVisible();
  await expect(brand).toBeVisible();
  await expect(page.locator('.caldaver-brand-icon')).toHaveCount(0);
  await expect(prefs).toBeVisible();
  await expect(user).toBeVisible();
  await expect(page.locator('#usermenu > li > a.logout')).toHaveCount(0);
  await expect(logout).toBeHidden();

  const boxes = await Promise.all([
    menu.boundingBox(),
    brand.boundingBox(),
    prefs.boundingBox(),
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
  expect(centers[2].x).toBeLessThan(centers[3].x);

  await user.click();
  await expect(logout).toBeVisible();
  await expect(logout).toHaveText(/Log out|Logout/i);
});

test('very narrow mobile topbar keeps menu, logo, preferences, and username on one row', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await login(page);
  await page.goto(`${baseURL}/preferences`);

  const selectors = [
    '.mobile-section-menu',
    '.caldaver-brand-title',
    '#usermenu .prefs',
    '#usermenu .user-pill'
  ];
  const boxes = [];

  for (const selector of selectors) {
    await expect(page.locator(selector)).toBeVisible();
    boxes.push(await visibleBox(page, selector));
  }

  await expect(page.locator('.caldaver-brand-icon')).toHaveCount(0);
  const centers = boxes.map(box => ({
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  }));

  expect(Math.max(...centers.map(center => center.y)) - Math.min(...centers.map(center => center.y))).toBeLessThan(8);
  expect(centers[0].x).toBeLessThan(centers[1].x);
  expect(centers[1].x).toBeLessThan(centers[2].x);
  expect(centers[2].x).toBeLessThan(centers[3].x);
  await expect(page.locator('#usermenu > li > a.logout')).toHaveCount(0);
  await page.locator('#usermenu .user-pill').click();
  await expect(page.locator('#usermenu .user-menu-logout')).toBeVisible();
});

test('login form labels do not overlap input fields', async ({ page }) => {
  await page.setViewportSize({ width: 486, height: 240 });
  await page.goto(`${baseURL}/login`);

  await expect(page.locator('.caldaver-sidebrand')).toHaveText('Caldaver');
  const userLabel = await visibleBox(page, 'label[for="user"]');
  const userInput = await visibleBox(page, 'input[name="user"]');
  const passwordLabel = await visibleBox(page, 'label[for="password"]');
  const passwordInput = await visibleBox(page, 'input[name="password"]');

  expect(overlaps(userLabel, userInput)).toBe(false);
  expect(overlaps(passwordLabel, passwordInput)).toBe(false);
  const userLabelIsBeforeInput = userLabel.x + userLabel.width <= userInput.x - 8 ||
    userLabel.y + userLabel.height <= userInput.y - 4;
  const passwordLabelIsBeforeInput = passwordLabel.x + passwordLabel.width <= passwordInput.x - 8 ||
    passwordLabel.y + passwordLabel.height <= passwordInput.y - 4;

  expect(userLabelIsBeforeInput).toBe(true);
  expect(passwordLabelIsBeforeInput).toBe(true);
});

test('mobile layout uses topbar section menu and keeps calendar and contacts scrollable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCardsApi(page, 42);
  await login(page);
  await page.goto(`${baseURL}/`);

  await expect(page.locator('.caldaver-brand-title')).toHaveText('Caldaver');
  await expect(page.locator('.mobile-section-menu')).toBeVisible();
  await expect(page.locator('.caldaver-brand-icon')).toHaveCount(0);
  await expect(page.locator('#usermenu .prefs')).toBeVisible();
  await expect(page.locator('#usermenu .user-pill')).toBeVisible();
  await expect(page.locator('#sidebar .app-nav')).toBeHidden();
  await expect(page.locator('#own_calendar_list')).toBeHidden();

  const menuBox = await visibleBox(page, '.mobile-section-menu');
  const brand = await visibleBox(page, '.caldaver-brand-title');
  const prefs = await visibleBox(page, '#usermenu .prefs');
  const user = await visibleBox(page, '#usermenu .user-pill');
  const centers = [menuBox, brand, prefs, user].map(box => ({
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  }));
  expect(Math.max(...centers.map(center => center.y)) - Math.min(...centers.map(center => center.y))).toBeLessThan(10);
  expect(centers[0].x).toBeLessThan(centers[1].x);
  expect(centers[1].x).toBeLessThan(centers[2].x);
  expect(centers[2].x).toBeLessThan(centers[3].x);

  const menu = page.locator('.mobile-section-menu');
  await menu.locator('summary').click();
  await expect(menu.locator('.mobile-calendar-menu > summary', { hasText: 'Calendar' })).toBeVisible();
  await menu.locator('.mobile-calendar-menu > summary').click();
  await expect(menu.locator('.mobile-calendar-account').first()).toBeVisible();
  await expect(menu.locator('a', { hasText: 'Contacts' })).toBeVisible();
  await expect(menu.locator('a', { hasText: 'Mail' })).toBeVisible();

  const calendarScroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(calendarScroll).toBeGreaterThan(120);
  await page.mouse.wheel(0, 640);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(80);

  await page.goto(`${baseURL}/cards`);
  await expect(page.locator('.mobile-section-menu')).toBeVisible();
  await expect(page.locator('.cards-sidebar .app-nav')).toBeHidden();
  await expect(page.locator('.contacts-nav-item.active')).toBeVisible();
  await expect(page.locator('#contacts_rows .contact-row')).toHaveCount(42);

  const contactsScroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(contactsScroll).toBeGreaterThan(120);
  await page.mouse.wheel(0, 640);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(80);
});

test('desktop layout keeps side navigation after mobile changes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockCardsApi(page, 8);
  await login(page);
  await page.goto(`${baseURL}/`);

  await expect(page.locator('.mobile-section-menu')).toBeHidden();
  await expect(page.locator('#sidebar .app-nav')).toBeVisible();
  await expect(page.locator('#sidebar .caldaver-sidebrand')).toHaveText('Caldaver');

  const sidebar = await visibleBox(page, '#sidebar');
  const content = await visibleBox(page, '#content');
  expect(overlaps(sidebar, content)).toBe(false);

  await page.goto(`${baseURL}/cards`);
  await expect(page.locator('.mobile-section-menu')).toBeHidden();
  await expect(page.locator('.cards-sidebar .app-nav')).toBeVisible();
  await expect(page.locator('.cards-sidebar .caldaver-sidebrand')).toHaveText('Caldaver');
  await expect(page.locator('#contacts_rows .contact-row')).toHaveCount(8);

  const cardsSidebar = await visibleBox(page, '.cards-sidebar');
  const cardsContent = await visibleBox(page, '.cards-content');
  expect(overlaps(cardsSidebar, cardsContent)).toBe(false);
});

test('mail page renders mocked messages, message detail, search, and attachment download', async ({ page }) => {
  const pageErrors = await login(page);
  const consoleErrors = captureConsoleErrors(page);
  const attachmentRequests = [];
  const messageRequests = [];
  const unreadRequests = [];

  await mockMailApi(page, {
    accounts: [
      { id: 1, label: 'Primary Inbox', email_address: 'user@example.test' },
      { id: 2, label: 'Archive Inbox', email_address: 'archive@example.test' }
    ],
    messagesByAccount: {
      1: [
        {
          uid: 101,
          from: 'Ada Lovelace <ada@example.test>',
          subject: 'Quarterly report',
          date: 'Fri, 29 May 2026 10:30:00 -0700',
          seen: false,
          attachments: [{ part: '2', filename: 'report.pdf', content_type: 'application/pdf', size: 12345 }]
        },
        {
          uid: 102,
          from: 'Grace Hopper <grace@example.test>',
          subject: 'Deployment update',
          date: 'Thu, 28 May 2026 16:15:00 -0700',
          seen: true,
          attachments: []
        }
      ],
      2: [
        {
          uid: 201,
          from: 'Katherine Johnson <katherine@example.test>',
          subject: 'Archived flight notes',
          date: 'Wed, 27 May 2026 08:45:00 -0700',
          seen: true,
          attachments: [{ part: '3', filename: 'flight-notes.txt', content_type: 'text/plain', size: 36 }]
        },
        {
          uid: 202,
          from: 'Mary Jackson <mary@example.test>',
          subject: 'Archive without attachments',
          date: 'Tue, 26 May 2026 11:00:00 -0700',
          seen: true,
          attachments: []
        }
      ]
    },
    messageDetails: {
      101: {
        uid: 101,
        from: 'Ada Lovelace <ada@example.test>',
        subject: 'Quarterly report',
        date: 'Fri, 29 May 2026 10:30:00 -0700',
        body: 'Attached is the quarterly report.',
        html_body: '<section><h2>Quarterly report</h2><p>Attached is the <strong>quarterly report</strong>.</p><a href="https://example.test/report">Open report</a></section>',
        attachments: [{ part: '2', filename: 'report.pdf', content_type: 'application/pdf', size: 12345 }]
      },
      201: {
        uid: 201,
        from: 'Katherine Johnson <katherine@example.test>',
        subject: 'Archived flight notes',
        date: 'Wed, 27 May 2026 08:45:00 -0700',
        body: 'Dummy archive notes for account two.',
        attachments: [{ part: '3', filename: 'flight-notes.txt', content_type: 'text/plain', size: 36 }]
      }
    },
    attachmentBodies: {
      'report.pdf': 'dummy primary report contents',
      'flight-notes.txt': 'dummy archive attachment contents'
    },
    attachmentRequests,
    messageRequests,
    unreadRequests
  });

  await page.goto(`${baseURL}/mail`);
  await expect(page.locator('.mail-account-tab[data-account-id="1"]')).toBeVisible();
  await expect(page.locator('.mail-account-tab[data-account-id="2"]')).toBeVisible();
  await expect(page.locator('#mail_account_title')).toHaveText('Primary Inbox');
  await expect(page.locator('#mail_rows .mail-row')).toHaveCount(2);
  await expect(page.locator('#mail_rows .mail-row').first()).toHaveClass(/unread/);
  await expect(page.locator('#mail_rows .mail-row').first().locator('.mail-from')).toContainText('Ada Lovelace');
  await expect(page.locator('[data-testid="mail-attachment-download"][data-filename="report.pdf"]').first()).toBeVisible();

  await page.locator('#mail_search').fill('deployment');
  await expect(page.locator('#mail_rows .mail-row')).toHaveCount(1);
  await expect(page.locator('#mail_rows .mail-row .mail-subject')).toContainText('Deployment update');
  await page.locator('#mail_search').fill('');
  await expect(page.locator('#mail_rows .mail-row')).toHaveCount(2);

  await page.locator('#mail_rows .mail-row').first().click();
  await expect(page).toHaveURL(/\/mail\/read\?account_id=1&uid=101/);
  await expect(page.locator('#mail_reader_message')).toBeVisible();
  await expect(page.locator('#mail_reader_subject')).toHaveText('Quarterly report');
  await expect(page.locator('#mail_reader_body')).toBeHidden();
  await expect(page.locator('#mail_reader_html')).toBeVisible();
  const htmlFrame = page.frameLocator('#mail_reader_html');
  await expect(htmlFrame.locator('h2')).toHaveText('Quarterly report');
  await expect(htmlFrame.locator('strong')).toHaveText('quarterly report');
  await expect(page.locator('#mail_reader_html')).toHaveAttribute('srcdoc', /<base target="_blank">/);
  await expect(page.locator('#mail_reader_unread')).toBeVisible();
  await expect(page.locator('#mail_message_detail')).toHaveCount(0);

  const attachmentHref = await page.locator('#mail_reader_message [data-testid="mail-attachment-download"]').getAttribute('href');
  expect(attachmentHref).toContain('account_id=1');
  expect(attachmentHref).toContain('uid=101');
  expect(attachmentHref).toContain('part=2');

  const downloadPromise = page.waitForEvent('download');
  const primaryAttachmentUrl = await page.locator('#mail_reader_message [data-testid="mail-attachment-download"]').getAttribute('href');
  expect(primaryAttachmentUrl).toContain('account_id=1');
  expect(primaryAttachmentUrl).toContain('uid=101');
  expect(primaryAttachmentUrl).toContain('part=2');

  await page.locator('#mail_reader_message [data-testid="mail-attachment-download"]').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('report.pdf');
  const primaryAttachmentBody = await page.evaluate(async href => {
    return fetch(href, { credentials: 'same-origin' }).then(response => response.text());
  }, primaryAttachmentUrl);
  expect(primaryAttachmentBody).toBe('dummy primary report contents');

  await page.locator('#mail_reader_back').click();
  await expect(page).toHaveURL(/\/mail$/);
  await expect(page.locator('#mail_rows .mail-row').first()).not.toHaveClass(/unread/);

  await page.locator('#mail_rows .mail-row').first().click();
  await expect(page).toHaveURL(/\/mail\/read\?account_id=1&uid=101/);
  await expect(page.locator('#mail_reader_unread')).toBeVisible();
  await expect(page.getByRole('link', { name: /inbox/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /inbox/i })).toHaveCount(0);
  await Promise.all([
    page.waitForURL(/\/mail\?account_id=1&unread_uid=101/),
    page.locator('#mail_reader_unread').click()
  ]);
  await expect(page.locator('#mail_rows .mail-row').first()).toHaveClass(/unread/);
  await expect(page.locator('#mail_rows .mail-row').first()).toHaveClass(/highlighted-unread/);

  await expect(page.locator('.mail-account-tab[data-account-id="2"]')).toBeVisible();
  await page.locator('.mail-account-tab[data-account-id="2"]').click();
  await expect(page.locator('#mail_account_title')).toHaveText('Archive Inbox');
  await expect(page.locator('#mail_rows .mail-row')).toHaveCount(2);
  await expect(page.locator('#mail_rows .mail-row .mail-subject').first()).toContainText('Archived flight notes');
  await expect(page.locator('[data-testid="mail-attachment-download"][data-filename="flight-notes.txt"]').first()).toBeVisible();

  await page.locator('#mail_rows .mail-row').first().click();
  await expect(page).toHaveURL(/\/mail\/read\?account_id=2&uid=201/);
  await expect(page.locator('#mail_reader_message')).toBeVisible();
  await expect(page.locator('#mail_reader_subject')).toHaveText('Archived flight notes');
  await expect(page.locator('#mail_reader_body')).toContainText('Dummy archive notes for account two.');

  const archiveAttachmentHref = await page.locator('#mail_reader_message [data-testid="mail-attachment-download"]').getAttribute('href');
  expect(archiveAttachmentHref).toContain('account_id=2');
  expect(archiveAttachmentHref).toContain('uid=201');
  expect(archiveAttachmentHref).toContain('part=3');

  const archiveDownloadPromise = page.waitForEvent('download');
  await page.locator('#mail_reader_message [data-testid="mail-attachment-download"]').click();
  const archiveDownload = await archiveDownloadPromise;
  expect(archiveDownload.suggestedFilename()).toBe('flight-notes.txt');
  const archiveAttachmentBody = await page.evaluate(async href => {
    return fetch(href, { credentials: 'same-origin' }).then(response => response.text());
  }, archiveAttachmentHref);
  expect(archiveAttachmentBody).toBe('dummy archive attachment contents');

  expect(attachmentRequests).toEqual([
    { account_id: '1', uid: '101', part: '2' },
    { account_id: '2', uid: '201', part: '3' }
  ]);
  expect(messageRequests).toEqual([
    { account_id: '1', uid: '101' },
    { account_id: '1', uid: '101' },
    { account_id: '2', uid: '201' }
  ]);
  expect(unreadRequests).toHaveLength(1);
  expect(unreadRequests[0]).toMatchObject({ account_id: '1', uid: '101' });

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('mail cache renders immediately while IMAP sync runs from nav click and configured interval', async ({ page }) => {
  const pageErrors = await login(page);
  const consoleErrors = captureConsoleErrors(page);
  const syncRequests = [];

  await page.addInitScript(() => {
    const originalSetInterval = window.setInterval.bind(window);
    window.__mailRefreshIntervals = [];
    window.setInterval = function(callback, timeout) {
      window.__mailRefreshIntervals.push(timeout);
      return originalSetInterval(callback, timeout);
    };
  });

  await mockMailApi(page, {
    accounts: [
      {
        id: 1,
        label: 'Cached Inbox',
        email_address: 'cached@example.test',
        refresh_interval_seconds: 120
      },
      {
        id: 2,
        label: 'Empty Inbox',
        email_address: 'empty@example.test',
        refresh_interval_seconds: 60
      }
    ],
    cachedMessagesByAccount: {
      1: [{ uid: 401, from: 'Cached Sender', subject: 'Cached message', date: 'Fri, 29 May 2026 12:00:00 -0700', seen: true }]
    },
    syncMessagesByAccount: {
      1: [{ uid: 402, from: 'Fresh Sender', subject: 'Fresh IMAP message', date: 'Fri, 29 May 2026 12:01:00 -0700', seen: false }],
      2: []
    },
    delays: { 1: 500, 2: 250 },
    syncRequests
  });

  await page.goto(`${baseURL}/mail`);
  await expect(page.locator('#mail_account_title')).toHaveText('Cached Inbox');
  await expect(page.locator('#mail_rows .mail-row .mail-subject')).toContainText('Cached message');
  await expect(page.locator('#mail_nav_item')).toHaveClass(/syncing/);
  await expect(page.locator('#mail_rows .mail-row .mail-subject')).toContainText('Cached message');
  await expect(page.locator('#mail_rows .mail-row .mail-subject')).toContainText('Fresh IMAP message');
  await expect(page.locator('#mail_rows .mail-row').first()).toHaveClass(/unread/);

  const intervals = await page.evaluate(() => window.__mailRefreshIntervals || []);
  expect(intervals).toContain(120000);

  await page.locator('#mail_nav_item').click();
  await expect(page.locator('#mail_nav_item')).toHaveClass(/syncing/);
  await expect.poll(() => syncRequests.length).toBeGreaterThanOrEqual(2);
  await expect(page.locator('#mail_rows .mail-row .mail-subject')).toContainText('Fresh IMAP message');

  await page.locator('.mail-account-tab[data-account-id="2"]').click();
  await expect(page.locator('#mail_account_title')).toHaveText('Empty Inbox');
  await expect(page.locator('#mail_no_messages')).toBeVisible();
  await expect(page.locator('#mail_no_messages')).toContainText('Checking the IMAP server for mail');
  await expect(page.locator('#mail_no_messages')).not.toContainText('No messages');
  await expect(page.locator('#mail_nav_item')).toHaveClass(/syncing/);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('mail auto refresh keeps unchanged message rows stable', async ({ page }) => {
  const pageErrors = await login(page);
  const consoleErrors = captureConsoleErrors(page);
  const syncRequests = [];
  const stableMessage = {
    uid: 451,
    from: 'Stable Sender',
    subject: 'Stable cached message',
    date: 'Fri, 29 May 2026 12:30:00 -0700',
    seen: true
  };

  await page.addInitScript(() => {
    window.__mailRefreshCallbacks = [];
    window.__mailRefreshIntervals = [];
    window.setInterval = function(callback, timeout) {
      window.__mailRefreshCallbacks.push(callback);
      window.__mailRefreshIntervals.push(timeout);
      return window.__mailRefreshCallbacks.length;
    };
    window.clearInterval = function() {};
  });

  await mockMailApi(page, {
    accounts: [
      {
        id: 1,
        label: 'Stable Inbox',
        email_address: 'stable@example.test',
        refresh_interval_seconds: 60
      }
    ],
    cachedMessagesByAccount: { 1: [stableMessage] },
    syncMessagesByAccount: { 1: [stableMessage] },
    syncRequests
  });

  await page.goto(`${baseURL}/mail`);
  await expect(page.locator('#mail_rows .mail-row')).toHaveCount(1);
  await expect(page.locator('#mail_rows .mail-row .mail-subject')).toContainText('Stable cached message');
  await expect.poll(() => syncRequests.length).toBe(1);
  await expect(page.locator('#mail_nav_item')).not.toHaveClass(/syncing/);

  await page.evaluate(() => {
    const rows = document.querySelector('#mail_rows');
    window.__firstMailRow = rows.firstElementChild;
    window.__mailRowsMutationCount = 0;
    new MutationObserver(mutations => {
      window.__mailRowsMutationCount += mutations.length;
    }).observe(rows, { attributes: true, childList: true, characterData: true, subtree: true });
  });

  await page.evaluate(() => {
    window.__mailRefreshCallbacks[window.__mailRefreshCallbacks.length - 1]();
  });
  await expect.poll(() => syncRequests.length).toBe(2);
  await page.waitForTimeout(100);

  const refreshState = await page.evaluate(() => ({
    loadingHidden: document.querySelector('#mail_loading').hidden,
    rowMutations: window.__mailRowsMutationCount,
    sameRow: window.__firstMailRow === document.querySelector('#mail_rows .mail-row'),
    syncing: document.querySelector('#mail_nav_item').classList.contains('syncing')
  }));

  expect(refreshState).toEqual({
    loadingHidden: true,
    rowMutations: 0,
    sameRow: true,
    syncing: false
  });
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('mail reader renders HTML email bodies and blocks message scripts', async ({ page }) => {
  const pageErrors = await login(page);
  const consoleErrors = captureConsoleErrors(page);

  await mockMailApi(page, {
    accounts: [{ id: 1, label: 'HTML Inbox', email_address: 'html@example.test' }],
    messagesByAccount: {
      1: [{ uid: 501, from: 'Designer <designer@example.test>', subject: 'Rich newsletter', date: 'Fri, 29 May 2026 13:00:00 -0700', seen: false }]
    },
    messageDetails: {
      501: {
        uid: 501,
        from: 'Designer <designer@example.test>',
        subject: 'Rich newsletter',
        date: 'Fri, 29 May 2026 13:00:00 -0700',
        body: 'Plain fallback body',
        html_body: '<article><h2>Rich newsletter</h2><p><strong>Styled content</strong></p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="hero"><script>window.top.__messageScriptRan = true;</script></article>'
      }
    }
  });

  await page.goto(`${baseURL}/mail`);
  await page.locator('#mail_rows .mail-row').first().click();
  await expect(page).toHaveURL(/\/mail\/read\?account_id=1&uid=501/);
  await expect(page.locator('#mail_reader_html')).toBeVisible();
  await expect(page.locator('#mail_reader_body')).toBeHidden();

  const htmlFrame = page.frameLocator('#mail_reader_html');
  await expect(htmlFrame.locator('h2')).toHaveText('Rich newsletter');
  await expect(htmlFrame.locator('strong')).toHaveText('Styled content');
  await expect(htmlFrame.locator('img[alt="hero"]')).toBeVisible();
  await expect(htmlFrame.locator('script')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__messageScriptRan || false)).toBe(false);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('mobile mail reader swipe navigates newer and older inbox messages', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const pageErrors = await login(page);
  const consoleErrors = captureConsoleErrors(page);

  const inboxMessages = [
    { uid: 701, from: 'Newest Sender', subject: 'Newer message', date: 'Fri, 29 May 2026 15:00:00 -0700', seen: true },
    { uid: 702, from: 'Current Sender', subject: 'Current message', date: 'Fri, 29 May 2026 14:00:00 -0700', seen: true },
    { uid: 703, from: 'Older Sender', subject: 'Older message', date: 'Fri, 29 May 2026 13:00:00 -0700', seen: true }
  ];

  await mockMailApi(page, {
    accounts: [{ id: 1, label: 'Swipe Inbox', email_address: 'swipe@example.test' }],
    cachedMessagesByAccount: { 1: inboxMessages },
    messagesByAccount: { 1: inboxMessages },
    messageDetails: {
      701: { uid: 701, from: 'Newest Sender', subject: 'Newer message', date: 'Fri, 29 May 2026 15:00:00 -0700', body: 'Newer body' },
      702: { uid: 702, from: 'Current Sender', subject: 'Current message', date: 'Fri, 29 May 2026 14:00:00 -0700', body: 'Current body' },
      703: { uid: 703, from: 'Older Sender', subject: 'Older message', date: 'Fri, 29 May 2026 13:00:00 -0700', body: 'Older body' }
    }
  });

  await page.goto(`${baseURL}/mail/read?account_id=1&uid=702`);
  await expect(page.locator('#mail_reader_subject')).toHaveText('Current message');
  await dispatchTouchSwipe(page, '#mail_reader_message', 60, 320);
  await expect(page).toHaveURL(/\/mail\/read\?account_id=1&uid=701/);
  await expect(page.locator('#mail_reader_subject')).toHaveText('Newer message');

  await page.goto(`${baseURL}/mail/read?account_id=1&uid=702`);
  await expect(page.locator('#mail_reader_subject')).toHaveText('Current message');
  await dispatchTouchSwipe(page, '#mail_reader_message', 320, 60);
  await expect(page).toHaveURL(/\/mail\/read\?account_id=1&uid=703/);
  await expect(page.locator('#mail_reader_subject')).toHaveText('Older message');

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('mark unread keeps the action visible while IMAP update is pending', async ({ page }) => {
  const pageErrors = await login(page);
  const consoleErrors = captureConsoleErrors(page);
  let resolveUnread;

  await mockMailApi(page, {
    accounts: [{ id: 1, label: 'Unread Inbox', email_address: 'unread@example.test' }],
    messagesByAccount: {
      1: [{ uid: 601, from: 'Sender <sender@example.test>', subject: 'Read then unread', date: 'Fri, 29 May 2026 14:00:00 -0700', seen: true }]
    },
    messageDetails: {
      601: {
        uid: 601,
        from: 'Sender <sender@example.test>',
        subject: 'Read then unread',
        date: 'Fri, 29 May 2026 14:00:00 -0700',
        body: 'Mark unread pending body'
      }
    }
  });

  await page.route('**/mail/message/unread', async route => {
    await new Promise(resolve => {
      resolveUnread = resolve;
    });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result: 'SUCCESS', data: { uid: 601, seen: false } })
    });
  });

  await page.goto(`${baseURL}/mail`);
  await page.locator('#mail_rows .mail-row').first().click();
  await expect(page).toHaveURL(/\/mail\/read\?account_id=1&uid=601/);
  await expect(page.locator('#mail_reader_unread')).toBeVisible();
  await page.locator('#mail_reader_unread').click();
  await expect(page.locator('#mail_reader_unread')).toBeVisible();
  await expect.poll(() => Boolean(resolveUnread)).toBe(true);
  resolveUnread();
  await expect(page).toHaveURL(/\/mail\?account_id=1&unread_uid=601/);
  await expect(page.locator('#mail_rows .mail-row').first()).toHaveClass(/unread/);
  await expect(page.locator('#mail_rows .mail-row').first()).toHaveClass(/highlighted-unread/);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('configured live mail accounts are deduplicated and can fetch messages', async ({ page }) => {
  await login(page);

  const accountsResponse = await page.request.get(`${baseURL}/mail/accounts`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest' }
  });
  expect(accountsResponse.status()).toBe(200);

  const accountsPayload = await accountsResponse.json();
  const accounts = accountsPayload.data || [];
  const mailboxKeys = accounts.map(account => [
    account.email_address.toLowerCase(),
    account.imap_host.toLowerCase(),
    account.imap_port,
    account.encryption
  ].join('|'));

  expect(new Set(mailboxKeys).size).toBe(mailboxKeys.length);

  const account = accounts.find(item => item.email_address === 'user@example.test') || accounts[0];
  test.skip(!account, 'No live IMAP account is configured');

  const syncResponse = await page.request.get(`${baseURL}/mail/messages/sync?account_id=${account.id}`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    timeout: 30000
  });
  expect(syncResponse.status()).toBe(200);

  const syncPayload = await syncResponse.json();
  expect(Array.isArray(syncPayload.data)).toBe(true);
  expect(syncPayload.data.length).toBeGreaterThan(0);

  const messagesResponse = await page.request.get(`${baseURL}/mail/messages?account_id=${account.id}`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    timeout: 30000
  });
  expect(messagesResponse.status()).toBe(200);

  const messagesPayload = await messagesResponse.json();
  expect(messagesPayload.cached).toBe(true);
  expect(Array.isArray(messagesPayload.data)).toBe(true);
  expect(messagesPayload.data.length).toBeGreaterThan(0);
  expect(messagesPayload.data[0]).toHaveProperty('seen');
});

test('mail account load failure is visible and does not throw UI errors', async ({ page }) => {
  const pageErrors = await login(page);
  const consoleErrors = captureConsoleErrors(page);
  await mockMailApi(page, { accountStatus: 500 });

  await page.goto(`${baseURL}/mail`);
  await expect(page.locator('#mail_error')).toBeVisible();
  await expect(page.locator('#mail_error')).toContainText('Mock account load failed');
  await expect(page.locator('#mail_rows .mail-row')).toHaveCount(0);
  await expect(page.locator('#mail_empty')).toBeHidden();

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('mail account tab switching ignores stale message responses', async ({ page }) => {
  const pageErrors = await login(page);
  const consoleErrors = captureConsoleErrors(page);
  await mockMailApi(page, {
    accounts: [
      { id: 1, label: 'Slow Inbox', email_address: 'slow@example.test' },
      { id: 2, label: 'Fast Inbox', email_address: 'fast@example.test' }
    ],
    delays: { 1: 350 },
    messagesByAccount: {
      1: [{ uid: 201, from: 'Slow Sender', subject: 'Slow message', date: 'Fri, 29 May 2026 09:00:00 -0700', seen: true }],
      2: [{ uid: 301, from: 'Fast Sender', subject: 'Fast message', date: 'Fri, 29 May 2026 09:01:00 -0700', seen: true }]
    }
  });

  await page.goto(`${baseURL}/mail`);
  await expect(page.locator('.mail-account-tab[data-account-id="1"]')).toBeVisible();
  await page.locator('.mail-account-tab[data-account-id="2"]').click();
  await expect(page.locator('#mail_account_title')).toHaveText('Fast Inbox');
  await expect(page.locator('#mail_rows .mail-row .mail-subject')).toContainText('Fast message');
  await page.waitForTimeout(500);
  await expect(page.locator('#mail_account_title')).toHaveText('Fast Inbox');
  await expect(page.locator('#mail_rows .mail-row .mail-subject')).toContainText('Fast message');
  await expect(page.locator('#mail_rows .mail-row .mail-subject')).not.toContainText('Slow message');
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('mail add-account dialog posts expected fields and supports multiple saved accounts', async ({ page }) => {
  const pageErrors = await login(page);
  const consoleErrors = captureConsoleErrors(page);
  const savedAccounts = [];
  const postedForms = [];
  await mockMailApi(page, { accounts: [], skipAccountSaveRoute: true });
  await page.route('**/mail/accounts/save', async route => {
    postedForms.push(parsePostedForm(route.request()));
    const fixtures = [
      {
        label: 'Test Inbox',
        email_address: 'test@example.com',
        imap_host: 'imap.example.test',
        username: 'test@example.com'
      },
      {
        label: 'Second Inbox',
        email_address: 'second@example.com',
        imap_host: 'imap2.example.test',
        username: 'second@example.com'
      }
    ];
    const fixture = fixtures[savedAccounts.length];
    const account = {
      id: 99 + savedAccounts.length,
      label: fixture.label,
      email_address: fixture.email_address,
      imap_host: fixture.imap_host,
      imap_port: 993,
      encryption: 'ssl',
      username: fixture.username,
      refresh_interval_seconds: 60
    };
    savedAccounts.push(account);

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        result: 'SUCCESS',
        data: account
      })
    });
  });

  await page.goto(`${baseURL}/mail`);
  await expect(page.locator('#mail_empty')).toBeVisible();
  await expect(page.locator('#mail_account_create')).toHaveCount(0);
  await openMailAccountDialog(page);
  await expect(page.locator('#mail_account_dialog')).toBeVisible();
  await expect(page.locator('#mail_account_form input[name="imap_port"]')).toHaveValue('993');
  await expect(page.locator('#mail_account_form select[name="encryption"]')).toHaveValue('ssl');
  await expect(page.locator('#mail_account_form input[name="refresh_interval_minutes"]')).toHaveValue('1');

  await page.locator('#mail_account_form input[name="label"]').fill('Test Inbox');
  await page.locator('#mail_account_form input[name="email_address"]').fill('test@example.com');
  await page.locator('#mail_account_form input[name="imap_host"]').fill('imap.example.test');
  await page.locator('#mail_account_form input[name="username"]').fill('test@example.com');
  await page.locator('#mail_account_form input[name="password"]').fill('secret-password');
  await page.locator('#mail_account_form button[type="submit"]').click();

  await expect(page.locator('#mail_account_dialog')).toBeHidden();
  await openMailAccountDialog(page);
  await page.locator('#mail_account_form input[name="label"]').fill('Second Inbox');
  await page.locator('#mail_account_form input[name="email_address"]').fill('second@example.com');
  await page.locator('#mail_account_form input[name="imap_host"]').fill('imap2.example.test');
  await page.locator('#mail_account_form input[name="username"]').fill('second@example.com');
  await page.locator('#mail_account_form input[name="password"]').fill('second-secret');
  await page.locator('#mail_account_form button[type="submit"]').click();

  await expect(page.locator('#mail_account_dialog')).toBeHidden();
  expect(postedForms).toHaveLength(2);
  expect(postedForms[0]).toMatchObject({
    label: 'Test Inbox',
    email_address: 'test@example.com',
    imap_host: 'imap.example.test',
    imap_port: '993',
    encryption: 'ssl',
    username: 'test@example.com',
    password: 'secret-password',
    refresh_interval_minutes: '1'
  });
  expect(postedForms[1]).toMatchObject({
    label: 'Second Inbox',
    email_address: 'second@example.com',
    imap_host: 'imap2.example.test',
    imap_port: '993',
    encryption: 'ssl',
    username: 'second@example.com',
    password: 'second-secret',
    refresh_interval_minutes: '1'
  });
  expect(savedAccounts.map(account => account.label)).toEqual(['Test Inbox', 'Second Inbox']);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('mail add-account stalled backend response times out visibly', async ({ page }) => {
  const pageErrors = await login(page);
  const consoleErrors = captureConsoleErrors(page);
  await mockMailApi(page, { accounts: [], skipAccountSaveRoute: true });

  await page.goto(`${baseURL}/mail`);
  await openMailAccountDialog(page);
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.CALDAVER_MAIL_REQUEST_TIMEOUT_MS = 250;
    window.fetch = function(url, options) {
      if (String(url).indexOf('/mail/accounts/save') === -1) {
        return originalFetch(url, options);
      }

      return new Promise(function(resolve, reject) {
        if (options && options.signal) {
          options.signal.addEventListener('abort', function() {
            reject(new DOMException('Request aborted', 'AbortError'));
          });
        }
      });
    };
  });
  await page.locator('#mail_account_form input[name="label"]').fill('Slow Inbox');
  await page.locator('#mail_account_form input[name="email_address"]').fill('slow@example.com');
  await page.locator('#mail_account_form input[name="imap_host"]').fill('imap.example.com');
  await page.locator('#mail_account_form input[name="username"]').fill('slow@example.com');
  await page.locator('#mail_account_form input[name="password"]').fill('secret-password');
  await page.locator('#mail_account_form button[type="submit"]').click();

  await expect(page.locator('#mail_account_dialog')).toBeVisible();
  await expect(page.locator('#mail_account_error')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#mail_account_error')).toContainText('server did not respond in time');
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('mail add-account save failure stays visible in the dialog', async ({ page }) => {
  const pageErrors = await login(page);
  const consoleErrors = captureConsoleErrors(page);
  await mockMailApi(page, { accounts: [] });
  await page.route('**/mail/accounts/save', async route => {
    return route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ result: 'ERROR', message: 'Mock save rejected' })
    });
  });

  await page.goto(`${baseURL}/mail`);
  await openMailAccountDialog(page);
  await page.locator('#mail_account_form input[name="label"]').fill('Bad Inbox');
  await page.locator('#mail_account_form input[name="email_address"]').fill('bad@example.com');
  await page.locator('#mail_account_form input[name="imap_host"]').fill('imap.example.com');
  await page.locator('#mail_account_form input[name="username"]').fill('bad@example.com');
  await page.locator('#mail_account_form input[name="password"]').fill('secret-password');
  await page.locator('#mail_account_form button[type="submit"]').click();

  await expect(page.locator('#mail_account_dialog')).toBeVisible();
  await expect(page.locator('#mail_account_error')).toBeVisible();
  await expect(page.locator('#mail_account_error')).toContainText('Mock save rejected');
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('mail add-account non-JSON auth failure shows a useful error', async ({ page }) => {
  const pageErrors = await login(page);
  const consoleErrors = captureConsoleErrors(page);
  let requestedWith = '';
  await mockMailApi(page, { accounts: [] });
  await page.route('**/mail/accounts/save', async route => {
    requestedWith = route.request().headers()['x-requested-with'] || '';
    return route.fulfill({
      status: 401,
      contentType: 'text/html',
      body: '<!doctype html><title>401</title><p>Invalid CSRF token</p>'
    });
  });

  await page.goto(`${baseURL}/mail`);
  await openMailAccountDialog(page);
  await page.locator('#mail_account_form input[name="label"]').fill('Expired Inbox');
  await page.locator('#mail_account_form input[name="email_address"]').fill('expired@example.com');
  await page.locator('#mail_account_form input[name="imap_host"]').fill('imap.example.com');
  await page.locator('#mail_account_form input[name="username"]').fill('expired@example.com');
  await page.locator('#mail_account_form input[name="password"]').fill('secret-password');
  await page.locator('#mail_account_form button[type="submit"]').click();

  await expect(page.locator('#mail_account_dialog')).toBeVisible();
  await expect(page.locator('#mail_account_error')).toBeVisible();
  await expect(page.locator('#mail_account_error')).toContainText('Your session expired');
  await expect(page.locator('#mail_account_error')).not.toContainText('JSON.parse');
  expect(requestedWith).toBe('XMLHttpRequest');
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('mail page can render without loading JavaScript using nojs option', async ({ page }) => {
  await login(page);

  await page.goto(`${baseURL}/mail`);
  const mailHtml = await page.content();
  expect(mailHtml).toContain("document.addEventListener('DOMContentLoaded'");
  expect(mailHtml).toContain('loadAccounts();');
  expect(mailHtml).not.toContain('id="mail_account_create"');

  await page.goto(`${baseURL}/mail?nojs=1`);
  await expect(page.locator('.mail-shell')).toBeVisible();
  await expect(page.locator('#mail_account_create')).toHaveCount(0);
  expect(await page.locator('script[src*="/dist/js"], script[src*="/jssettings"]').count()).toBe(0);
  const noJsHtml = await page.content();
  expect(noJsHtml).not.toContain("document.addEventListener('DOMContentLoaded'");
  expect(noJsHtml).not.toContain('loadAccounts();');
});

test('mail layout keeps critical controls visible across desktop and mobile', async ({ page }) => {
  await login(page);
  await mockMailApi(page, {
    accounts: [
      { id: 1, label: 'Layout Inbox', email_address: 'layout@example.test' }
    ],
    messagesByAccount: {
      1: [
        {
          uid: 501,
          from: 'Long Sender Name <sender@example.test>',
          subject: 'A long subject that should not overlap the date or attachment controls in the mail row',
          date: 'Fri, 29 May 2026 10:30:00 -0700',
          seen: false,
          attachments: [{ part: '2', filename: 'layout-report-with-a-long-name.pdf', content_type: 'application/pdf', size: 12345 }]
        }
      ]
    },
    messageDetails: {
      501: {
        uid: 501,
        from: 'Long Sender Name <sender@example.test>',
        subject: 'A long subject that should not overlap',
        date: 'Fri, 29 May 2026 10:30:00 -0700',
        body: 'Layout smoke body',
        attachments: [{ part: '2', filename: 'layout-report-with-a-long-name.pdf', content_type: 'application/pdf', size: 12345 }]
      }
    }
  });

  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto(`${baseURL}/mail`);
    await expect(page.locator('#mail_rows .mail-row')).toHaveCount(1);

    const accounts = await visibleBox(page, '#mail_accounts');
    const search = await visibleBox(page, '.mail-search');
    const panel = await visibleBox(page, '.mail-panel');
    const toolbar = await visibleBox(page, '.mail-toolbar');
    const row = await visibleBox(page, '.mail-row');

    for (const box of [accounts, search, panel, toolbar, row]) {
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    }

    await expect(page.locator('#mail_account_create')).toHaveCount(0);

    if (viewport.width >= 900) {
      const sidebar = await visibleBox(page, '.mail-sidebar');
      const content = await visibleBox(page, '.mail-content');
      expect(overlaps(sidebar, content)).toBe(false);
      expect(search.y + search.height).toBeLessThanOrEqual(panel.y + 1);
    }

    expect(toolbar.y + toolbar.height).toBeLessThanOrEqual(row.y + 1);

    await page.locator('#mail_rows .mail-row').first().click();
    await expect(page).toHaveURL(/\/mail\/read/);
    await expect(page.locator('#mail_reader_message')).toBeVisible();
    await expect(page.locator('.mail-read-shell .compose-button')).toHaveCount(0);
    const reader = await visibleBox(page, '.mail-reader');
    const subject = await visibleBox(page, '#mail_reader_subject');
    const content = await visibleBox(page, '.mail-content');
    expect(reader.x + reader.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(subject.x + subject.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(reader.width).toBeGreaterThanOrEqual(content.width - 1);
  }
});
