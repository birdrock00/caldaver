const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const baseURL = process.env.CALDAVER_BASE_URL || 'https://caldaver.example.test';
const username = process.env.CALDAVER_USERNAME;
const password = process.env.CALDAVER_PASSWORD;
const repoRoot = path.resolve(__dirname, '../../..');

function absoluteURL(path) {
  return new URL(path, baseURL).toString();
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function contextName(context) {
  return typeof context === 'string' ? context : context.id || context.title || String(context);
}

async function switchToWebView() {
  await browser.waitUntil(async () => {
    const contexts = await browser.getContexts();
    const webView = contexts.find(context => contextName(context).includes('WEBVIEW'));
    if (!webView) {
      return false;
    }

    await browser.switchContext(contextName(webView));
    return true;
  }, {
    timeout: Number(process.env.CALDAVER_ANDROID_WEBVIEW_TIMEOUT_MS || 30000),
    timeoutMsg: 'Timed out waiting for the Caldaver WebView context'
  });
}

async function waitForDocument() {
  await browser.waitUntil(async () => {
    return browser.execute(() => ['interactive', 'complete'].includes(document.readyState));
  }, {
    timeoutMsg: 'Timed out waiting for WebView document readiness'
  });
}

async function openPath(path) {
  await switchToWebView();
  const target = absoluteURL(path);
  await browser.execute(url => {
    window.location.href = url;
  }, target);
  await waitForDocument();
}

async function exists(selector) {
  return $(selector).isExisting();
}

async function waitForSelector(selector) {
  const element = await $(selector);
  await element.waitForExist();
  await element.waitForDisplayed();
  return element;
}

async function waitForExistingSelector(selector) {
  const element = await $(selector);
  await element.waitForExist();
  return element;
}

async function clickText(selector, textPattern) {
  const clicked = await browser.execute((itemSelector, patternSource, patternFlags) => {
    const pattern = new RegExp(patternSource, patternFlags);
    const element = Array.from(document.querySelectorAll(itemSelector))
      .find(item => pattern.test((item.textContent || item.value || '').trim()));
    if (!element) {
      return false;
    }

    element.click();
    return true;
  }, selector, textPattern.source, textPattern.flags);

  assert.equal(clicked, true, `Expected to click ${selector} matching ${textPattern}`);
}

async function clickSelector(selector) {
  const clicked = await browser.execute(itemSelector => {
    const element = document.querySelector(itemSelector);
    if (!element) {
      return false;
    }

    element.scrollIntoView({ block: 'center', inline: 'center' });
    element.click();
    return true;
  }, selector);

  assert.equal(clicked, true, `Expected to click ${selector}`);
}

async function fetchInApp(path, options = {}) {
  return browser.executeAsync((url, requestOptions, done) => {
    fetch(url, {
      credentials: 'same-origin',
      ...requestOptions
    })
      .then(async response => {
        done({
          status: response.status,
          text: await response.text()
        });
      })
      .catch(error => done({ error: error.message }));
  }, absoluteURL(path), options);
}

async function fetchJson(path, options = {}) {
  const response = await fetchInApp(path, options);
  assert.equal(response.error, undefined, response.error);
  assert.equal(response.status, 200, `${path} returned ${response.status}: ${response.text}`);
  return JSON.parse(response.text);
}

async function login() {
  await openPath('/login');

  if (await exists('#calendar_view')) {
    await waitForSelector('#calendar_view');
    return;
  }

  await waitForSelector('input[name="user"]');
  await $('input[name="user"]').setValue(username);
  await $('input[name="password"]').setValue(password);
  await $('input[name="login"]').click();
  await waitForSelector('#calendar_view');

  await browser.waitUntil(async () => {
    return browser.execute(() => {
      if (!window.jQuery || !window.translations || !window.CaldaverConf || !window.CaldaverConf.i18n) {
        return false;
      }

      const calendarAdd = document.querySelector('#calendar_add');
      const events = calendarAdd && window.jQuery._data(calendarAdd, 'events');
      return !!(events && events.click && events.click.length > 0);
    });
  }, {
    timeoutMsg: 'Caldaver did not finish binding calendar controls'
  });
}

async function getBox(selector) {
  const box = await browser.execute(itemSelector => {
    const element = document.querySelector(itemSelector);
    if (!element) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    };
  }, selector);

  assert.ok(box, `${selector} should have a bounding box`);
  return box;
}

async function visibleLinkTextIn(selector, linkText) {
  return browser.execute((containerSelector, expectedText) => {
    const container = document.querySelector(containerSelector);
    if (!container) {
      return false;
    }

    return Array.from(container.querySelectorAll('a')).some(link => {
      const style = window.getComputedStyle(link);
      return link.textContent.trim() === expectedText &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        link.getClientRects().length > 0;
    });
  }, selector, linkText);
}

function mailMessageScriptSource() {
  return fs.readFileSync(path.join(repoRoot, 'web/templates/parts/mailmessagejs.html'), 'utf8')
    .replace(/^\s*<script>\s*/, '')
    .replace(/\s*<\/script>\s*$/, '');
}

describe('Caldaver installed Android WebView', function () {
  before(function () {
    if (!username || !password) {
      this.skip();
    }
  });

  beforeEach(async function () {
    await switchToWebView();
    await waitForDocument();
  });

  it('opens calendar and event creation dialogs', async function () {
    await login();

    await $('#calendar_add').click();
    await waitForSelector('#calendar_create_dialog');
    const action = await $('#calendar_create_form').getAttribute('action');
    assert.match(action, /\/calendars\/save$/);

    await clickText('.ui-dialog-buttonset button', /cancel/i);
    await browser.waitUntil(async () => !(await exists('#calendar_create_dialog')));

    const shortcut = await waitForSelector('#shortcut_add_event');
    await shortcut.click();
    await waitForSelector('#event_edit_dialog input.summary');
  });

  it('creates and deletes an event through the live CalDAV-backed app session', async function () {
    await login();

    await browser.waitUntil(async () => {
      return browser.execute(() => document.querySelectorAll('div.calendar_list li.available_calendar').length > 0);
    }, {
      timeoutMsg: 'No writable calendars were visible'
    });

    const title = `Caldaver Android smoke ${Date.now()}`;
    let createdEvent = null;

    await $('#shortcut_add_event').click();
    await waitForSelector('#event_edit_dialog input.summary');
    await $('#event_edit_dialog input.summary').setValue(title);

    const formData = await browser.execute(() => {
      const form = document.querySelector('#event_edit_form');
      const token = form.querySelector('input[name="_token"]').value;
      const select = form.querySelector('select[name="calendar"]');
      const calendar = select.value ||
        (Array.from(select.options).find(option => option.value) || {}).value ||
        (document.querySelector('div.calendar_list li.available_calendar') || {}).dataset.calendarUrl;

      if (calendar && select.value !== calendar) {
        select.value = calendar;
        window.jQuery(select).trigger('change');
      }

      return { token, calendar };
    });

    assert.ok(formData.calendar, 'Expected a writable calendar in the event form');
    await clickText('.ui-dialog-buttonset button', /^save$/i);
    await browser.waitUntil(async () => !(await exists('#event_edit_dialog')));

    const start = new Date();
    start.setUTCDate(start.getUTCDate() - 7);
    const end = new Date();
    end.setUTCDate(end.getUTCDate() + 7);

    try {
      const events = await fetchJson(`/events?calendar=${encodeURIComponent(formData.calendar)}&start=${isoDate(start)}&end=${isoDate(end)}&timezone=America%2FLos_Angeles`);
      createdEvent = events.find(event => event.title === title);
      assert.ok(createdEvent, 'Created event should be returned by the event feed');
    } finally {
      if (createdEvent) {
        const body = new URLSearchParams({
          _token: formData.token,
          calendar: createdEvent.calendar,
          uid: createdEvent.uid,
          href: createdEvent.href,
          etag: createdEvent.etag
        }).toString();

        const deleteResponse = await fetchInApp('/events/delete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body
        });
        assert.equal(deleteResponse.error, undefined, deleteResponse.error);
        assert.equal(deleteResponse.status, 200, deleteResponse.text);
      }
    }
  });

  it('opens contacts and supports the card view control', async function () {
    await login();
    await openPath('/cards');

    await waitForSelector('.contacts-panel');
    await waitForSelector('#contact_create');
    await browser.waitUntil(async () => {
      return browser.execute(() => {
        const list = document.querySelector('#contacts_list');
        const cards = document.querySelector('#contacts_cards');
        const empty = document.querySelector('#contacts_empty');
        return !!(list && !list.hidden) || !!(cards && !cards.hidden) || !!(empty && !empty.hidden);
      });
    }, {
      timeoutMsg: 'Contacts page did not render a list, card grid, or empty state'
    });

    await browser.execute(() => {
      const cardsButton = document.querySelector('.contacts-view-switch button[data-view="cards"]');
      if (cardsButton) {
        cardsButton.click();
      }
    });
    await browser.waitUntil(async () => {
      return browser.execute(() => {
        const cards = document.querySelector('#contacts_cards');
        return !!(cards && !cards.hidden && cards.getClientRects().length > 0);
      });
    }, {
      timeoutMsg: 'Contacts card view did not become visible'
    });
  });

  it('creates and deletes a contact through the live CardDAV-backed app session', async function () {
    await login();
    await openPath('/cards');
    await waitForExistingSelector('#contact_form input[name="_token"]');

    const csrf = await $('#contact_form input[name="_token"]').getValue();
    const fullName = `Caldaver Android Contact ${Date.now()}`;
    let createdContact = null;

    const saveBody = new URLSearchParams({
      _token: csrf,
      full_name: fullName,
      email: 'caldaver-android-smoke@example.com',
      phone: '+14155550288',
      organization: 'Caldaver',
      job_title: 'Android Smoke Test'
    }).toString();

    const saveResponse = await fetchInApp('/cards/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: saveBody
    });
    assert.equal(saveResponse.error, undefined, saveResponse.error);
    assert.equal(saveResponse.status, 200, saveResponse.text);

    try {
      const payload = await fetchJson('/cards/list');
      createdContact = payload.data.find(contact => contact.full_name === fullName);
      assert.ok(createdContact, 'Created contact should be returned by the contact list');
      assert.equal(createdContact.email, 'caldaver-android-smoke@example.com');
    } finally {
      if (createdContact) {
        const deleteBody = new URLSearchParams({
          _token: csrf,
          url: createdContact.url,
          etag: createdContact.etag
        }).toString();

        const deleteResponse = await fetchInApp('/cards/delete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: deleteBody
        });
        assert.equal(deleteResponse.error, undefined, deleteResponse.error);
        assert.equal(deleteResponse.status, 200, deleteResponse.text);
      }
    }
  });

  it('keeps preferences scrollable with topbar actions in one row', async function () {
    await login();
    await openPath('/preferences');

    await waitForSelector('#prefs_form');
    await waitForSelector('#prefs_buttons');
    assert.equal(await $('input[name="disable_javascript"][value="false"]').isSelected(), true);

    const before = await browser.execute(() => ({
      overflow: window.getComputedStyle(document.body).overflow,
      scrollHeight: document.scrollingElement.scrollHeight,
      clientHeight: document.scrollingElement.clientHeight,
      scrollY: window.scrollY
    }));

    assert.notEqual(before.overflow, 'hidden');
    assert.ok(before.scrollHeight > before.clientHeight, 'Preferences page should be vertically scrollable');

    await browser.execute(() => window.scrollTo({ top: 600, behavior: 'instant' }));
    await browser.pause(150);
    const afterScrollY = await browser.execute(() => window.scrollY);
    assert.ok(afterScrollY > before.scrollY, 'Preferences page should scroll');

    await browser.execute(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    const menu = await getBox('.mobile-section-menu');
    const brand = await getBox('.caldaver-brand-title');
    const prefs = await getBox('#usermenu .prefs');
    const user = await getBox('#usermenu .user-pill');
    const centers = [menu, brand, prefs, user].map(box => ({
      x: box.x + box.width / 2,
      y: box.y + box.height / 2
    }));
    const dateIconRemoved = await browser.execute(() => document.querySelector('.caldaver-brand-icon') === null);
    const standaloneLogoutRemoved = await browser.execute(() => document.querySelector('#usermenu > li > a.logout') === null);

    assert.ok(Math.max(...centers.map(center => center.y)) - Math.min(...centers.map(center => center.y)) < 10);
    assert.ok(centers[0].x < centers[1].x);
    assert.ok(centers[1].x < centers[2].x);
    assert.ok(centers[2].x < centers[3].x);
    assert.equal(dateIconRemoved, true, 'Mobile topbar should not render the date icon');
    assert.equal(standaloneLogoutRemoved, true, 'Mobile topbar should not render a standalone logout icon');

    await $('#usermenu .user-pill').click();
    await waitForSelector('#usermenu .user-menu-logout');
    await $('#usermenu .user-pill').click();
    await waitForSelector('#mail_account_create');
    await $('#mail_account_create').click();
    await waitForSelector('#mail_account_dialog');
    await $('#mail_account_cancel').click();
  });

  it('opens mail and can navigate a configured mailbox or empty mail state', async function () {
    await login();
    await openPath('/mail');

    await waitForSelector('.mail-content');
    assert.equal(await exists('#mail_account_create'), false, 'Add account should live in preferences, not the mail screen');
    await browser.waitUntil(async () => {
      return browser.execute(() => {
        const visible = selector => {
          const element = document.querySelector(selector);
          return !!(element && !element.hidden && element.getClientRects().length > 0);
        };

        return visible('#mail_empty') ||
          visible('#mail_error') ||
          !!document.querySelector('.mail-account-tab');
      });
    }, {
      timeoutMsg: 'Mail page did not render accounts, empty state, or error state'
    });

    const mailErrorVisible = await browser.execute(() => {
      const element = document.querySelector('#mail_error');
      return !!(element && !element.hidden && element.getClientRects().length > 0);
    });
    if (mailErrorVisible) {
      const errorText = await $('#mail_error').getText();
      assert.equal(errorText.trim(), '', `Mail page rendered an error: ${errorText}`);
    }

    if (await exists('.mail-account-tab')) {
      await waitForSelector('#mail_account_title');
      const title = await $('#mail_account_title').getText();
      assert.ok(title.trim().length > 0, 'Mail account title should be visible');

      await browser.waitUntil(async () => {
        return browser.execute(() => {
          return !!document.querySelector('#mail_no_messages') ||
            document.querySelectorAll('#mail_rows .mail-row').length > 0;
        });
      }, {
        timeoutMsg: 'Mail account did not render messages or an empty mailbox state'
      });

      if (await exists('#mail_rows .mail-row')) {
        await clickSelector('#mail_rows .mail-row');
        await waitForSelector('#mail_reader_message');
        await waitForSelector('#mail_reader_subject');
        assert.equal(await exists('.mail-read-shell .compose-button'), false, 'Mail reader should rely on the toolbar back button');
        const inboxControlVisible = await browser.execute(() => {
          return Array.from(document.querySelectorAll('a, button')).some(element => {
            const text = (element.textContent || element.getAttribute('aria-label') || element.getAttribute('title') || '').trim();
            const style = window.getComputedStyle(element);
            return /^Inbox$/i.test(text) &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              element.getClientRects().length > 0;
          });
        });
        assert.equal(inboxControlVisible, false, 'Mail reader should not show an Inbox button on mobile');

        if (await exists('#mail_reader_unread')) {
          await waitForSelector('#mail_reader_unread');
          await clickSelector('#mail_reader_unread');
          await waitForSelector('#mail_rows');
          await waitForSelector('.mail-row.highlighted-unread');
        } else {
          await clickSelector('#mail_reader_back');
        }
        await waitForSelector('#mail_rows');
      }
    } else {
      await waitForSelector('#mail_empty');
    }
  });

  it('exposes the mobile topbar section menu in the installed app WebView', async function () {
    await login();
    await openPath('/');

    await waitForSelector('.caldaver-brand-title');
    assert.equal(await $('.caldaver-brand-title').getText(), 'Caldaver');
    await waitForSelector('.mobile-section-menu');
    const dateIconRemoved = await browser.execute(() => document.querySelector('.caldaver-brand-icon') === null);
    assert.equal(dateIconRemoved, true, 'Mobile topbar should not render the date icon');
    await waitForSelector('#own_calendar_list');

    await $('.mobile-section-menu summary').click();
    assert.equal(await visibleLinkTextIn('.mobile-section-menu', 'Calendar'), true);
    assert.equal(await visibleLinkTextIn('.mobile-section-menu', 'Contacts'), true);
    assert.equal(await visibleLinkTextIn('.mobile-section-menu', 'Mail'), true);

    const calendarScroll = await browser.execute(() => document.documentElement.scrollHeight - window.innerHeight);
    assert.ok(calendarScroll > 80, 'Calendar page should have vertical scroll room on mobile');
  });

  it('does not show a mobile calendar event loading error in the installed app WebView', async function () {
    await login();
    await openPath('/');
    await waitForSelector('#calendar_view');
    await browser.pause(3000);

    const state = await browser.execute(() => ({
      errors: Array.from(document.querySelectorAll('.freeow')).map(item => item.textContent || ''),
      eventSources: window.jQuery && window.jQuery('#calendar_view').data('fullCalendar')
        ? window.jQuery('#calendar_view').fullCalendar('getEventSources').length
        : 0
    }));

    assert.ok(state.eventSources > 0, 'Calendar should have at least one event source');
    assert.equal(/error loading events/i.test(state.errors.join(' ')), false, state.errors.join(' '));
  });
});

describe('Caldaver Android WebView mail reader gestures', function () {
  beforeEach(async function () {
    await switchToWebView();
    await waitForDocument();
  });

  it('navigates newer and older messages with horizontal swipes', async function () {
    const scriptSource = mailMessageScriptSource();

    await browser.execute(source => {
      document.open();
      document.write(`<!doctype html>
        <html>
          <head>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
              #mail_reader_message { display: block; min-height: 420px; padding: 24px; }
              [hidden] { display: none !important; }
            </style>
          </head>
          <body>
            <section
              id="mail_reader"
              data-account-id="1"
              data-uid="802"
              data-message-url="/mail/message"
              data-messages-url="/mail/messages"
              data-read-url="#mail-read"
              data-unread-url="/mail/message/unread"
              data-inbox-url="/mail"
              data-attachment-url="/mail/attachment"
              data-csrf-token="token">
              <button type="button" id="mail_reader_refresh"></button>
              <button type="button" id="mail_reader_unread" hidden></button>
              <div id="mail_reader_error" hidden></div>
              <article id="mail_reader_message" hidden>
                <h1 id="mail_reader_subject"></h1>
                <strong id="mail_reader_from"></strong>
                <span id="mail_reader_date"></span>
                <div class="mail-reader-avatar"></div>
                <pre id="mail_reader_body"></pre>
                <iframe id="mail_reader_html" hidden></iframe>
                <div id="mail_reader_attachments"></div>
              </article>
              <div id="mail_reader_loading"></div>
            </section>
          </body>
        </html>`);
      document.close();

      const inbox = [
        { uid: 801, from: 'Newest', subject: 'Newer message', date: 'now' },
        { uid: 802, from: 'Current', subject: 'Current message', date: 'earlier' },
        { uid: 803, from: 'Older', subject: 'Older message', date: 'oldest' }
      ];
      const details = {
        801: { uid: 801, from: 'Newest', subject: 'Newer message', date: 'now', body: 'Newer body' },
        802: { uid: 802, from: 'Current', subject: 'Current message', date: 'earlier', body: 'Current body' },
        803: { uid: 803, from: 'Older', subject: 'Older message', date: 'oldest', body: 'Older body' }
      };
      window.fetch = url => {
        const requestUrl = String(url);
        const payload = requestUrl.indexOf('/mail/messages') !== -1
          ? { data: inbox }
          : { data: details[new URL(requestUrl, window.location.href).searchParams.get('uid')] };
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(payload))
        });
      };
      window.matchMedia = () => ({ matches: true });
      window.CALDAVER_MAIL_NAVIGATE = url => {
        window.__mailNavigationTarget = url;
      };

      const script = document.createElement('script');
      script.textContent = source;
      document.body.appendChild(script);
      document.dispatchEvent(new Event('DOMContentLoaded'));
    }, scriptSource);

    await waitForSelector('#mail_reader_message');

    async function swipe(fromX, toX) {
      await browser.execute((startX, endX) => {
        const element = document.querySelector('#mail_reader_message');
        const mouseOptions = clientX => ({
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 1,
          clientX,
          clientY: 220
        });
        element.dispatchEvent(new MouseEvent('mousedown', mouseOptions(startX)));
        element.dispatchEvent(new MouseEvent('mouseup', mouseOptions(endX)));
      }, fromX, toX);
    }

    await swipe(60, 320);
    await browser.waitUntil(async () => {
      return browser.execute(() => (window.__mailNavigationTarget || '').indexOf('uid=801') !== -1);
    }, { timeoutMsg: 'Right swipe did not navigate to the newer message' });

    await browser.execute(source => {
      document.querySelector('#mail_reader').dataset.uid = '802';
      window.__mailNavigationTarget = '';
      const script = document.createElement('script');
      script.textContent = source;
      document.body.appendChild(script);
      document.dispatchEvent(new Event('DOMContentLoaded'));
    }, scriptSource);
    await waitForSelector('#mail_reader_message');
    await swipe(320, 60);
    await browser.waitUntil(async () => {
      return browser.execute(() => (window.__mailNavigationTarget || '').indexOf('uid=803') !== -1);
    }, { timeoutMsg: 'Left swipe did not navigate to the older message' });
  });
});
