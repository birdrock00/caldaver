const { test, expect } = require('@playwright/test');

const baseURL = process.env.CALDAVER_BASE_URL || 'https://caldaver.ky87.club';
const username = process.env.CALDAVER_USERNAME;
const password = process.env.CALDAVER_PASSWORD;

test.skip(!username || !password, 'CALDAVER_USERNAME and CALDAVER_PASSWORD required');

function attachMailNetworkRecorder(page) {
  const log = [];
  page.on('response', async (response) => {
    try {
      const url = response.url();
      if (!/\/mail\/(messages|messages\/sync|message|message\/navigation|read|attachment)/.test(url)) {
        return;
      }
      const method = response.request().method();
      let cached = null;
      let uid = null;
      try {
        const body = await response.json();
        if (body && typeof body === 'object' && 'cached' in body) {
          cached = body.cached;
        }
      } catch (_) {}
      const u = new URL(url);
      uid = u.searchParams.get('uid');
      log.push({
        ts: new Date().toISOString(),
        method,
        path: u.pathname + u.search,
        status: response.status(),
        cached,
        uid,
        size: (await response.headerValue('content-length')) || null
      });
    } catch (_) {}
  });
  return log;
}

async function login(page) {
  await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="user"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await Promise.all([
    page.waitForLoadState('networkidle'),
    page.locator('input[name="login"]').click()
  ]);
  await expect(page.locator('#calendar_view')).toBeVisible({ timeout: 30000 });
}

async function clickMail(page) {
  const candidates = [
    page.locator('#mail_nav_item a'),
    page.locator('#mail_nav_item'),
    page.locator('a[href="/mail"]').first(),
    page.locator('.mobile-section-menu a', { hasText: /^Mail$/ })
  ];
  for (const c of candidates) {
    if (await c.count()) {
      await c.first().click();
      break;
    }
  }
  await page.waitForURL(/\/mail(\?|$|\/)/, { timeout: 15000 }).catch(() => {});
}

async function clickCalendar(page) {
  const candidates = [
    page.locator('a[href="/"]').first(),
    page.locator('a[href="/calendar"]').first(),
    page.locator('.mobile-section-menu a', { hasText: /Calendar/i }).first()
  ];
  for (const c of candidates) {
    if (await c.count()) {
      await c.first().click();
      break;
    }
  }
  await page.waitForURL(/(\/|\/calendar)/, { timeout: 15000 }).catch(() => {});
}

async function waitForInbox(page) {
  await expect(page.locator('#mail_account_title')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#mail_rows')).toBeVisible({ timeout: 20000 });
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll('#mail_rows .mail-row');
    return rows.length > 0;
  }, { timeout: 20000 }).catch(() => {});
}

test('user flow: click mail, click calendar, click back on mail — inbox served from cache, no re-download of opened message body', async ({ page }) => {
  const network = attachMailNetworkRecorder(page);
  await login(page);

  // --- First click on Mail ---
  await clickMail(page);
  await waitForInbox(page);
  const firstClickNetwork = [...network];
  const firstClickMessages = firstClickNetwork.filter(r => /\/mail\/messages(\?|$|\/)/.test(r.path) && !/\/sync/.test(r.path));
  const firstClickSyncs = firstClickNetwork.filter(r => /\/mail\/messages\/sync/.test(r.path));
  console.log('[AgentReport] after first click on mail');
  console.log(JSON.stringify({ messages: firstClickMessages, syncs: firstClickSyncs }, null, 2));

  // Open the first message
  const firstRow = page.locator('#mail_rows .mail-row').first();
  await expect(firstRow).toBeVisible({ timeout: 15000 });
  const subjectText = await firstRow.locator('.mail-subject').textContent();
  console.log('[AgentReport] opening first message subject=' + subjectText);
  await firstRow.click();
  await expect(page.locator('#mail_reader_message')).toBeVisible({ timeout: 20000 });
  const openNetwork = [...network];
  const firstOpens = openNetwork.filter(r => /\/mail\/message\?/.test(r.path));
  console.log('[AgentReport] after first open of message');
  console.log(JSON.stringify({ opens: firstOpens }, null, 2));

  // Go back to inbox
  await page.locator('#mail_reader_back').click();
  await page.waitForURL(/\/mail(\?|$)/, { timeout: 15000 });

  // --- Click Calendar ---
  await clickCalendar(page);
  await expect(page.locator('#calendar_view')).toBeVisible({ timeout: 15000 });

  // --- Click back on Mail ---
  const networkBeforeReturn = network.length;
  await clickMail(page);
  await waitForInbox(page);
  const returnNetwork = network.slice(networkBeforeReturn);
  const returnMessages = returnNetwork.filter(r => /\/mail\/messages(\?|$|\/)/.test(r.path) && !/\/sync/.test(r.path));
  const returnSyncs = returnNetwork.filter(r => /\/mail\/messages\/sync/.test(r.path));
  console.log('[AgentReport] after clicking back on mail');
  console.log(JSON.stringify({ messages: returnMessages, syncs: returnSyncs }, null, 2));

  // Assertions
  expect(firstClickMessages.length, 'first click on mail must call /mail/messages').toBeGreaterThan(0);
  const firstInboxResponse = firstClickMessages[0];
  console.log('[AgentReport] first /mail/messages response cached=' + firstInboxResponse.cached);

  expect(returnMessages.length, 'return click on mail must call /mail/messages').toBeGreaterThan(0);
  const returnInboxResponse = returnMessages[0];
  console.log('[AgentReport] return /mail/messages response cached=' + returnInboxResponse.cached);
  expect(returnInboxResponse.cached, 'second visit to /mail/messages must be served from cache (cached:true)').toBe(true);

  // Open the same first message again — should be cache HIT (cached:true), no IMAP body re-download
  const sameRow = page.locator('#mail_rows .mail-row').first();
  await expect(sameRow).toBeVisible();
  await sameRow.click();
  await expect(page.locator('#mail_reader_message')).toBeVisible({ timeout: 20000 });
  const secondOpens = network.filter(r => /\/mail\/message\?/.test(r.path)).slice(1);
  console.log('[AgentReport] second open of same message');
  console.log(JSON.stringify({ secondOpens }, null, 2));
  expect(secondOpens.length, 'second open must call /mail/message').toBeGreaterThan(0);
  const secondOpen = secondOpens[0];
  console.log('[AgentReport] second /mail/message response cached=' + secondOpen.cached);
  expect(secondOpen.cached, 'second open of same message must be served from cache (cached:true)').toBe(true);

  // Summary
  const summary = {
    baseURL,
    firstClick: {
      messagesCalls: firstClickMessages.length,
      syncCalls: firstClickSyncs.length,
      firstInboxCached: firstInboxResponse.cached
    },
    returnClick: {
      messagesCalls: returnMessages.length,
      syncCalls: returnSyncs.length,
      returnInboxCached: returnInboxResponse.cached
    },
    messageOpen: {
      firstOpenCached: firstOpens[0] ? firstOpens[0].cached : null,
      secondOpenCached: secondOpen.cached,
      totalMessageEndpointCalls: network.filter(r => /\/mail\/message\?/.test(r.path)).length
    }
  };
  console.log('[AgentReport] SUMMARY:');
  console.log(JSON.stringify(summary, null, 2));
});
