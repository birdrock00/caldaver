/**
 * Caldaver Loop 4 - Deep UI Audit (NEW angles, not covered by rounds 1-3).
 *
 * Round 1-3 already fixed: i18n strings, mobile 44px touch targets, a11y labels,
 * calendar grid lines (1px #dadce0), dotted minor slots, today button, contact
 * phone links 44px, radio inputs 24px.
 *
 * This loop audits DIFFERENT, deeper concerns:
 *   L4-01 Calendar event colors & readability (contrast ratio, text-shadow)  [week view]
 *   L4-02 Calendar week view grid lines (vertical separators + horizontal slots)
 *   L4-03 Keyboard shortcuts (arrow keys / 't' / '?')
 *   L4-04 Dialog / modal behaviour (event click -> Escape closes, focus trap)
 *   L4-05 Contact card view on desktop (avatars, initials, alignment)
 *   L4-06 Mail message reading (body render, reply button, attachment sizing)
 *   L4-07 Error pages (404 styling + back navigation)
 *   L4-08 Performance (per-page load time, slow API calls > 3s)
 *   L4-09 Visual polish (overlaps, spacing, clipping, color consistency)
 *   L4-10 Mobile bottom bar + FAB (375px)
 *   L4-11 Summary report
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');

const BASE_URL = process.env.CALDAVER_BASE_URL || 'http://localhost:8080';
const USERNAME = process.env.CALDAVER_USERNAME;
const PASSWORD = process.env.CALDAVER_PASSWORD;
const SCREENSHOT_DIR = '/tmp/caldaver-audit-loop4';
const MIN_TOUCH = 44;
const SLOW_API_MS = 3000;

const findings = [];

function addFinding(page, severity, description, screenshotPath, recommendation) {
  findings.push({
    id: `L4-${String(findings.length + 1).padStart(3, '0')}`,
    severity,
    page,
    description,
    screenshotPath: screenshotPath || null,
    recommendation: recommendation || null,
  });
}

function collectConsoleMessages(page) {
  const messages = { errors: [], warnings: [], all: [] };
  page.on('console', msg => {
    const entry = { type: msg.type(), text: msg.text() };
    messages.all.push(entry);
    if (msg.type() === 'error') messages.errors.push(entry);
    if (msg.type() === 'warning') messages.warnings.push(entry);
  });
  page.on('pageerror', error => {
    messages.errors.push({ type: 'pageerror', text: error.message });
  });
  return messages;
}

function collectNetworkTimings(page) {
  const entries = [];
  page.on('requestfinished', async req => {
    try {
      const t = req.timing();
      if (t && (t.responseStart > SLOW_API_MS || t.responseEnd > SLOW_API_MS)) {
        entries.push({ url: req.url(), responseStart: Math.round(t.responseStart), responseEnd: Math.round(t.responseEnd) });
      }
    } catch (e) { /* ignore */ }
  });
  return entries;
}

async function takeScreenshot(page, name) {
  const path = `${SCREENSHOT_DIR}/${name}.png`;
  await page.screenshot({ path, fullPage: true });
  return path;
}

/**
 * Relative luminance per WCAG 2.1. Accepts a CSS rgb()/rgba()/hex string.
 */
function luminance(color) {
  const m = color.match(/(\d+(\.\d+)?)/g);
  if (!m) return null;
  const [r, g, b] = m.map(Number);
  const channel = c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  if (l1 === null || l2 === null) return null;
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

async function login(page) {
  const start = Date.now();
  // Retry navigation for transient network errors (ERR_ADDRESS_UNREACHABLE etc.)
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      console.log(`  [login retry ${attempt + 1}/3] ${e.message.split('\n')[0]}`);
      await page.waitForTimeout(2000);
    }
  }
  if (lastErr) throw lastErr;
  await page.locator('input[name="user"]').fill(USERNAME);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('input[name="login"]').click();
  await expect(page.locator('#calendar_view')).toBeVisible({ timeout: 30000 });
  await page.waitForFunction(() => {
    return !!(window.jQuery && window.translations && window.CaldaverConf && window.CaldaverConf.i18n);
  }, { timeout: 30000 });
  await page.waitForTimeout(1500);
  return Date.now() - start;
}

async function switchToWeekView(page) {
  const weekBtn = page.locator(
    '.fc-button:has-text("week"), .fc-button:has-text("Week"), .fc-timeGridWeek-button, .fc-agendaWeek-button'
  ).first();
  if (await weekBtn.isVisible().catch(() => false)) {
    await weekBtn.click();
    await page.waitForTimeout(1500);
    return true;
  }
  // FullCalendar uses a select-based view switcher in some themes
  const viewSelect = page.locator('.fc-header select, select.fc-view-switch').first();
  if (await viewSelect.isVisible().catch(() => false)) {
    await viewSelect.selectOption(/week/i).catch(() => {});
    await page.waitForTimeout(1500);
    return true;
  }
  return false;
}

async function gotoToday(page) {
  const todayBtn = page.locator('.fc-today-button, .fc-button:has-text("today"), .fc-button:has-text("Today")').first();
  if (await todayBtn.isVisible().catch(() => false)) {
    // Skip if the button is disabled (we're already on today in some FC themes).
    const disabled = await todayBtn.isDisabled().catch(() => false);
    if (disabled) {
      // try the mobile bottom bar today button as a fallback
      const mbToday = page.locator('.mobile-bottom-btn[data-mobile-action="today"]').first();
      if (await mbToday.isVisible().catch(() => false)) {
        await mbToday.click().catch(() => {});
        await page.waitForTimeout(800);
      }
      return;
    }
    await todayBtn.click().catch(() => {});
    await page.waitForTimeout(800);
  }
}

test.describe('Caldaver Loop 4 Deep UI Audit', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  test.setTimeout(300000);

  // ============= 1. CALENDAR EVENT COLORS & READABILITY (week view) =============
  test('L4-01 - Calendar event colors & readability (contrast + text-shadow)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await gotoToday(page);
    const switched = await switchToWeekView(page);
    const shot = await takeScreenshot(page, 'L4-01-week-events');

    if (!switched) {
      addFinding('Calendar', 'High',
        'Could not switch to week view to inspect event readability',
        shot, 'Ensure the FullCalendar header exposes a week/agendaWeek button at desktop width.');
    }

    const events = await page.evaluate(() => {
      const els = document.querySelectorAll(
        '#calendar_view .fc-time-grid-event, #calendar_view .fc-day-grid-event, #calendar_view .fc-event'
      );
      const out = [];
      els.forEach(el => {
        const s = window.getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const titleEl = el.querySelector('.fc-title, .fc-time');
        const ts = titleEl ? window.getComputedStyle(titleEl) : s;
        out.push({
          text: (el.textContent || '').trim().slice(0, 60),
          color: s.color,
          backgroundColor: s.backgroundColor,
          textShadow: s.textShadow,
          titleColor: titleEl ? ts.color : null,
          fontSize: s.fontSize,
          rect: { w: Math.round(r.width), h: Math.round(r.height) },
        });
      });
      return out;
    });

    console.log(`\n[L4-01 EVENTS] count=${events.length}`);
    events.slice(0, 6).forEach((e, i) => console.log(`  event[${i}] ${JSON.stringify(e)}`));

    if (events.length === 0) {
      console.log('  (no events visible this week - cannot verify contrast dynamically)');
    } else {
      let noTextShadow = 0;
      let lowContrast = 0;
      events.forEach((e, i) => {
        if (!e.textShadow || e.textShadow === 'none') {
          noTextShadow++;
          addFinding('Calendar', 'Medium',
            `Week-view event "${e.text}" has no text-shadow (readability on light bg)`,
            shot,
            'Ensure `#calendar_view .fc-time-grid-event, #calendar_view .fc-day-grid-event { text-shadow: 0 0 2px rgba(255,255,255,.55), 0 1px 2px rgba(0,0,0,.18); }` is compiled into the served CSS.');
        }
        const ratio = contrastRatio(e.color, e.backgroundColor);
        if (ratio !== null && ratio < 3.0) {
          lowContrast++;
          addFinding('Calendar', 'High',
            `Week-view event "${e.text}" has low contrast ${ratio.toFixed(2)}:1 (color=${e.color} on bg=${e.backgroundColor}). WCAG AA large text requires 3:1.`,
            shot,
            'Either darken the event text color (e.g. #1a3a4a) or lighten/adjust calendar source colors so every event color clears 3:1 contrast against its background.');
        }
      });
      console.log(`  [L4-01 SUMMARY] noTextShadow=${noTextShadow}/${events.length} lowContrast=${lowContrast}/${events.length}`);
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 2. CALENDAR WEEK VIEW GRID LINES =============
  test('L4-02 - Calendar week view grid lines (vertical + horizontal)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await gotoToday(page);
    await switchToWeekView(page);
    await page.waitForTimeout(800);
    const shot = await takeScreenshot(page, 'L4-02-week-gridlines');

    const gridInfo = await page.evaluate(() => {
      const pick = sel => {
        const el = document.querySelector(sel);
        if (!el) return { found: false };
        const s = window.getComputedStyle(el);
        return { found: true, border: s.border, borderTop: s.borderTop, borderLeft: s.borderLeft, borderColor: s.borderColor };
      };
      // vertical column separators = .fc-day / .fc-bg td in week view
      const dayCols = document.querySelectorAll('#calendar_view .fc-bg td.fc-day, #calendar_view .fc-time-grid .fc-day');
      const colBorders = [];
      dayCols.forEach((td, i) => {
        if (i >= 3) return;
        const s = window.getComputedStyle(td);
        colBorders.push({ borderLeft: s.borderLeft, borderRight: s.borderRight });
      });
      // horizontal slot lines = .fc-slats td
      const slat = document.querySelectorAll('#calendar_view .fc-time-grid .fc-slats td');
      const slatBorders = [];
      slat.forEach((td, i) => {
        if (i >= 3) return;
        const s = window.getComputedStyle(td);
        slatBorders.push({ borderTop: s.borderTop, borderStyle: s.borderTopStyle });
      });
      // widget content border (general)
      const widget = pick('#calendar_view .fc-widget-content');
      const header = pick('#calendar_view .fc-widget-header');
      const headTd = pick('#calendar_view .fc-head td');
      return {
        dayColCount: dayCols.length,
        colBorders,
        slatCount: slat.length,
        slatBorders,
        widget,
        header,
        headTd,
      };
    });

    console.log(`\n[L4-02 GRID] ${JSON.stringify(gridInfo)}`);

    // Vertical column separators
    const hasVerticalBorders = gridInfo.colBorders.some(b =>
      /solid|dotted|dashed/.test(b.borderLeft || '') || /solid|dotted|dashed/.test(b.borderRight || '')
    );
    if (gridInfo.dayColCount > 0 && !hasVerticalBorders) {
      addFinding('Calendar', 'High',
        `Week view has ${gridInfo.dayColCount} day columns but none show a left/right border (vertical separators missing)`,
        shot,
        'Add `#calendar_view .fc-time-grid .fc-day, #calendar_view .fc-bg td.fc-day { border-left: 1px solid #dadce0; }`.');
    }

    // Horizontal slot lines
    const hasHorizontalBorders = gridInfo.slatBorders.some(b =>
      /solid|dotted|dashed/.test(b.borderTop || '') || /solid|dotted|dashed/.test(b.borderStyle || '')
    );
    if (gridInfo.slatCount > 0 && !hasHorizontalBorders) {
      addFinding('Calendar', 'High',
        `Week view time slots (${gridInfo.slatCount}) show no horizontal borders`,
        shot,
        'Add `#calendar_view .fc-time-grid .fc-slats td { border-top: 1px solid #dadce0; }`.');
    }

    // General widget border present?
    if (gridInfo.widget.found && /0px|none|^$/.test(gridInfo.widget.border || '')) {
      addFinding('Calendar', 'Medium',
        `Week view widget content has no border (${gridInfo.widget.border})`,
        shot,
        'Keep `#calendar_view .fc-widget-content { border: 1px solid #dadce0; }`.');
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 3. KEYBOARD SHORTCUTS =============
  test('L4-03 - Keyboard shortcuts (arrows for prev/next, t for today)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.waitForTimeout(1500);

    const initialTitle = await page.evaluate(() =>
      (document.querySelector('#calendar_view .fc-center h2, .fc-toolbar h2, .fc-left h2') || {}).textContent?.trim() || ''
    );
    const shot0 = await takeScreenshot(page, 'L4-03a-keyboard-before');
    console.log(`\n[L4-03 INITIAL TITLE] "${initialTitle}"`);

    // Test Right Arrow -> should go to next period if shortcuts are wired
    await page.locator('body').focus().catch(() => {});
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(900);
    const afterRight = await page.evaluate(() =>
      (document.querySelector('#calendar_view .fc-center h2, .fc-toolbar h2, .fc-left h2') || {}).textContent?.trim() || ''
    );
    console.log(`[L4-03 ARROWRIGHT] "${afterRight}" (changed=${afterRight !== initialTitle})`);

    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(900);
    const afterLeft = await page.evaluate(() =>
      (document.querySelector('#calendar_view .fc-center h2, .fc-toolbar h2, .fc-left h2') || {}).textContent?.trim() || ''
    );
    console.log(`[L4-03 ARROWLEFT] "${afterLeft}"`);

    await page.keyboard.press('t');
    await page.waitForTimeout(900);
    const afterT = await page.evaluate(() =>
      (document.querySelector('#calendar_view .fc-center h2, .fc-toolbar h2, .fc-left h2') || {}).textContent?.trim() || ''
    );
    console.log(`[L4-03 't' KEY] "${afterT}"`);
    const shotT = await takeScreenshot(page, 'L4-03b-keyboard-after-t');

    // Determine whether ANY keyboard shortcut worked
    const arrowWorked = afterRight !== initialTitle || afterLeft !== afterRight;
    const tWorked = afterT !== afterLeft;

    if (!arrowWorked && !tWorked) {
      addFinding('Calendar', 'High',
        'No keyboard shortcuts work on the calendar (ArrowLeft/ArrowRight for prev/next, "t" for today all inactive)',
        shot0,
        'Add a global keydown handler, e.g. document.addEventListener("keydown", ...) that calls fullCalendar("prev")/"next"/"today" but ignores keys when focus is in an input/textarea/dialog.');
    } else if (arrowWorked && !tWorked) {
      addFinding('Calendar', 'Medium',
        'Arrow keys navigate the calendar but "t" does not jump to today',
        shotT,
        'Add a "t" / "T" case to the keydown handler that calls fullCalendar("today").');
    } else if (!arrowWorked) {
      addFinding('Calendar', 'Medium', 'Arrow keys do not move between calendar periods', shot0, null);
    }

    // Also check for a help/cheatsheet affordance for shortcuts
    const hasShortcutHelp = await page.evaluate(() => {
      const txt = document.body.innerText;
      return /shortcut|keyboard|hotkey/i.test(txt);
    });
    if (!hasShortcutHelp && (!arrowWorked && !tWorked)) {
      addFinding('Calendar', 'Low',
        'Calendar has no keyboard shortcuts and no visible help/cheatsheet for them',
        shot0,
        'When adding shortcuts, also expose a "?" help overlay or a hint in the toolbar/title attribute.');
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 4. DIALOG / MODAL BEHAVIOUR (event click) =============
  test('L4-04 - Dialog/modal behavior (event click, Escape, focus trap)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await gotoToday(page);
    await page.waitForTimeout(1000);

    // Find any clickable event
    const firstEvent = page.locator('#calendar_view .fc-time-grid-event, #calendar_view .fc-day-grid-event, #calendar_view .fc-event').first();
    const eventVisible = await firstEvent.isVisible().catch(() => false);
    const shot = await takeScreenshot(page, 'L4-04a-event-preclick');

    if (!eventVisible) {
      console.log('\n[L4-04] No events on calendar to click for dialog test.');
      addFinding('Calendar', 'Low',
        'No calendar events present to test event-click dialog behaviour (data-dependent)',
        shot, null);
    } else {
      await firstEvent.scrollIntoViewIfNeeded().catch(() => {});
      await firstEvent.click({ position: { x: 5, y: 5 } }).catch(() => {});
      await page.waitForTimeout(1500);
      const shotDialog = await takeScreenshot(page, 'L4-04b-event-dialog');

      const dialogInfo = await page.evaluate(() => {
        const anyVisible = el => {
          if (!el) return false;
          const s = window.getComputedStyle(el);
          if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const candidates = [
          { kind: 'qtip', el: document.querySelector('.qtip') },
          { kind: 'ui-dialog', el: document.querySelector('.ui-dialog') },
          { kind: 'role-dialog', el: document.querySelector('[role="dialog"]') },
          { kind: 'mobile_event_details_view', el: document.getElementById('mobile_event_details_view') },
        ];
        const found = candidates.find(c => anyVisible(c.el));
        if (!found) return { open: false };
        const el = found.el;
        const s = window.getComputedStyle(el);
        return {
          open: true,
          kind: found.kind,
          role: el.getAttribute('role'),
          ariaModal: el.getAttribute('aria-modal'),
          ariaLabel: el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'),
          hasTitle: !!el.querySelector('h1, h2, h3, .ui-dialog-title, .qtip-title'),
          titleText: (el.querySelector('h1, h2, h3, .ui-dialog-title, .qtip-title') || {}).textContent?.trim().slice(0, 80) || '',
          zIndex: s.zIndex,
        };
      });
      console.log(`\n[L4-04 DIALOG] ${JSON.stringify(dialogInfo)}`);

      if (!dialogInfo.open) {
        addFinding('Calendar', 'High',
          'Clicking an event did not open any dialog/popup (no visible [role=dialog], .qtip, or .ui-dialog)',
          shotDialog,
          'Verify event_click_callback renders the qtip event_details_popup and that it is shown on click.');
      } else {
        if (dialogInfo.kind !== 'role-dialog' && dialogInfo.role !== 'dialog') {
          addFinding('Calendar', 'High',
            `Event details popup (kind=${dialogInfo.kind}) does not use role="dialog"`,
            shotDialog,
            'Add role="dialog" and aria-modal="true" to the event details container so screen readers announce it as a dialog.');
        }
        if (!dialogInfo.ariaModal && dialogInfo.kind === 'role-dialog') {
          addFinding('Calendar', 'Medium',
            'Event dialog missing aria-modal="true"',
            shotDialog, 'Add aria-modal="true" to the dialog element.');
        }
        if (!dialogInfo.hasTitle || !dialogInfo.titleText) {
          addFinding('Calendar', 'Medium',
            'Event dialog has no accessible title (no heading element / aria-label)',
            shotDialog,
            'Ensure the dialog has an <h2>/<h3> title or aria-label/aria-labelledby pointing to the event title.');
        }

        // Escape closes
        const beforeEscape = dialogInfo.open;
        await page.keyboard.press('Escape');
        await page.waitForTimeout(700);
        const afterEscape = await page.evaluate(() => {
          const cands = ['.qtip', '.ui-dialog', '[role="dialog"]', '#mobile_event_details_view'];
          return cands.some(sel => {
            const el = document.querySelector(sel);
            if (!el) return false;
            const s = window.getComputedStyle(el);
            return s.display !== 'none' && s.visibility !== 'hidden' && el.getAttribute('aria-hidden') !== 'true';
          });
        });
        console.log(`[L4-04 ESCAPE] openBefore=${beforeEscape} openAfter=${afterEscape}`);
        if (beforeEscape && afterEscape) {
          addFinding('Calendar', 'High',
            'Event dialog does not close on Escape key',
            shotDialog,
            'Wire a keydown(Escape) listener on the dialog (and document while open) that hides/removes it and restores focus.');
        }
      }

      // Focus trap test (re-open if possible)
      if (dialogInfo.open) {
        try {
          await firstEvent.click({ position: { x: 5, y: 5 } }).catch(() => {});
          await page.waitForTimeout(800);
        } catch (e) { /* dialog may already be open */ }
        const focusBefore = await page.evaluate(() => document.activeElement?.tagName + '#' + (document.activeElement?.id || ''));
        // Press Tab several times and see if focus leaves the dialog
        let escaped = false;
        for (let i = 0; i < 12; i++) {
          await page.keyboard.press('Tab');
          await page.waitForTimeout(40);
          const info = await page.evaluate(() => {
            const dlg = document.querySelector('[role="dialog"], .ui-dialog, .qtip, #mobile_event_details_view');
            const a = document.activeElement;
            if (!dlg) return { inDialog: false, tag: a?.tagName, id: a?.id };
            return { inDialog: !!dlg.contains(a), tag: a?.tagName, id: a?.id };
          });
          if (!info.inDialog && /INPUT|BUTTON|A|TEXTAREA|SELECT/.test(info.tag || '')) {
            escaped = true;
            console.log(`  [L4-04 FOCUS] focus escaped to ${info.tag}#${info.id} after ${i + 1} tabs`);
            break;
          }
        }
        if (escaped) {
          addFinding('Calendar', 'Medium',
            'Event dialog has no focus trap (Tab escapes to background controls)',
            await takeScreenshot(page, 'L4-04c-focus-trap'),
            'Implement a focus trap: on Tab/Shift+Tab inside the dialog, cycle focus between first and last focusable descendants. Restore focus to the triggering element on close.');
        } else {
          console.log('  [L4-04 FOCUS] focus stayed within dialog (or no escape observed)');
        }
        // close it
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(400);
      }
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 5. CONTACT CARD VIEW ON DESKTOP =============
  test('L4-05 - Contact card view on desktop (avatars, initials, alignment)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.goto(`${BASE_URL}/cards`);
    await expect(page.locator('.contacts-panel')).toBeVisible({ timeout: 15000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2500);

    const listShot = await takeScreenshot(page, 'L4-05a-contacts-list');

    // Switch to cards view
    const cardBtn = page.locator('.contacts-view-switch button[data-view="cards"]').first();
    const cardBtnVisible = await cardBtn.isVisible().catch(() => false);
    if (cardBtnVisible) {
      await cardBtn.click();
      await page.waitForTimeout(1000);
    }
    const cardsVisible = await page.locator('#contacts_cards').isVisible().catch(() => false);
    const shot = await takeScreenshot(page, 'L4-05b-contacts-cards');

    if (!cardsVisible) {
      addFinding('Contacts', 'High',
        'Cards view is not visible after clicking the "Cards" toggle (or toggle missing)',
        listShot,
        'Verify cardsjs.html wires the cards button to remove [hidden] from #contacts_cards and populate it.');
    } else {
      const cardInfo = await page.evaluate(() => {
        const cards = document.querySelectorAll('#contacts_cards .contact-card');
        const avatars = document.querySelectorAll('#contacts_cards .contact-card .contact-avatar');
        const sampleAvatar = avatars[0];
        const s = sampleAvatar ? window.getComputedStyle(sampleAvatar) : null;
        const sampleCard = cards[0];
        const cs = sampleCard ? window.getComputedStyle(sampleCard) : null;
        return {
          cardCount: cards.length,
          avatarCount: avatars.length,
          avatarBgColors: Array.from(avatars).slice(0, 5).map(a => window.getComputedStyle(a).backgroundColor),
          sampleInitials: sampleAvatar ? sampleAvatar.textContent.trim().slice(0, 6) : null,
          avatarSize: s ? { w: Math.round(sampleAvatar.getBoundingClientRect().width), h: Math.round(sampleAvatar.getBoundingClientRect().height) } : null,
          avatarColor: s ? s.color : null,
          cardBorder: cs ? cs.border : null,
          cardAlign: cs ? cs.textAlign : null,
          gridCols: (document.querySelector('.contacts-card-grid') || {}).childElementCount,
        };
      });
      console.log(`\n[L4-05 CARDS] ${JSON.stringify(cardInfo)}`);

      if (cardInfo.cardCount === 0) {
        addFinding('Contacts', 'Medium',
          'Cards view is visible but contains no contact cards (empty)',
          shot, 'Ensure contacts are loaded and rendered into #contacts_cards on view switch.');
      }
      if (cardInfo.avatarCount > 0 && cardInfo.avatarCount < cardInfo.cardCount) {
        addFinding('Contacts', 'Medium',
          `Some cards are missing avatars (${cardInfo.avatarCount}/${cardInfo.cardCount})`,
          shot, 'Verify createAvatar() runs for every card in renderCard().');
      }
      if (cardInfo.sampleInitials !== null && cardInfo.sampleInitials === '') {
        addFinding('Contacts', 'Medium',
          'Contact avatar renders no initials (initials() helper returned empty)',
          shot, 'Improve initials() to fall back to "?" when name is empty.');
      }
      if (cardInfo.avatarSize && (cardInfo.avatarSize.w < 32 || cardInfo.avatarSize.h < 32)) {
        addFinding('Contacts', 'Medium',
          `Card avatar is only ${cardInfo.avatarSize.w}x${cardInfo.avatarSize.h}px`,
          shot, 'Keep `.contact-card .contact-avatar { width: 48px; height: 48px; }`.');
      }

      // Alignment check: cards in the SAME row should share a top (compare only
      // cards whose tops are within one row height of the first card's top).
      const alignInfo = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('#contacts_cards .contact-card'));
        if (cards.length < 2) return { ok: true };
        const firstTop = Math.round(cards[0].getBoundingClientRect().top);
        const rowCards = cards.slice(0, 8).filter(c => Math.round(c.getBoundingClientRect().top) === firstTop);
        if (rowCards.length < 2) return { ok: true };
        const tops = rowCards.map(c => Math.round(c.getBoundingClientRect().top));
        const aligned = Math.max(...tops) - Math.min(...tops) <= 2;
        return { tops, aligned };
      });
      if (!alignInfo.ok && !alignInfo.aligned) {
        addFinding('Contacts', 'Low',
          `Cards in the first row are not top-aligned (tops=${JSON.stringify(alignInfo.tops)})`,
          shot, 'Add `align-items: start;` to .contacts-card-grid if cards have varying heights.');
      }
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 6. MAIL MESSAGE READING =============
  test('L4-06 - Mail message reading (body, reply button, attachments)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.goto(`${BASE_URL}/mail`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    const inboxShot = await takeScreenshot(page, 'L4-06a-mail-inbox');

    // Click the first message row
    const firstRow = page.locator('#mail_rows .mail-row, #mail_rows tr, #mail_rows [data-uid], .mail-list-item').first();
    const rowVisible = await firstRow.isVisible().catch(() => false);
    if (!rowVisible) {
      console.log('\n[L4-06] No mail rows found to open.');
      addFinding('Mail', 'Low',
        'No mail messages present to test message reading view (data-dependent)',
        inboxShot, null);
    } else {
      await firstRow.click().catch(() => {});
      await page.waitForTimeout(2000);
      const shot = await takeScreenshot(page, 'L4-06b-mail-message');

      const msgInfo = await page.evaluate(() => {
        const reader = document.querySelector('#mail_reader, .mail-reader, [data-testid="mail-reader"]');
        const replyBtn = document.querySelector('#mail_reader_reply, .mail-reader-reply-button');
        const replyVisible = replyBtn ? (function () {
          const s = window.getComputedStyle(replyBtn);
          if (s.display === 'none' || s.visibility === 'hidden') return false;
          const r = replyBtn.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }()) : false;
        const body = document.querySelector('#mail_reader_body, .mail-reader-body, [data-testid="mail-reader-body"]');
        const attachments = document.querySelectorAll('.mail-attachment, [data-testid="mail-attachment-download"]');
        return {
          readerPresent: !!reader,
          replyPresent: !!replyBtn,
          replyVisible,
          replyAriaLabel: replyBtn ? replyBtn.getAttribute('aria-label') : null,
          replySize: replyBtn ? { w: Math.round(replyBtn.getBoundingClientRect().width), h: Math.round(replyBtn.getBoundingClientRect().height) } : null,
          bodyPresent: !!body,
          bodyHasContent: body ? body.textContent.trim().length > 0 : false,
          bodyInnerTextLen: body ? body.innerText.length : 0,
          attachmentCount: attachments.length,
          attachmentSizes: Array.from(attachments).slice(0, 4).map(a => {
            const r = a.getBoundingClientRect();
            return { w: Math.round(r.width), h: Math.round(r.height) };
          }),
        };
      });
      console.log(`\n[L4-06 MESSAGE] ${JSON.stringify(msgInfo)}`);

      if (!msgInfo.readerPresent) {
        addFinding('Mail', 'High',
          'Clicking a mail row did not reveal a message reader (#mail_reader / .mail-reader missing)',
          shot, 'Verify mailmessagejs.html renders the reader when a row is selected.');
      }
      if (msgInfo.bodyPresent && !msgInfo.bodyHasContent) {
        addFinding('Mail', 'High',
          'Mail reader is open but message body is empty',
          shot, 'Verify the message fetch returns and injects body HTML/text into the reader.');
      }
      if (!msgInfo.replyPresent) {
        addFinding('Mail', 'High',
          'Reply button (#mail_reader_reply) is missing on the message view',
          shot, 'Render the reply button in the mail message template.');
      } else if (!msgInfo.replyVisible) {
        addFinding('Mail', 'High', 'Reply button is present but not visible', shot, null);
      } else {
        if (!msgInfo.replyAriaLabel) {
          addFinding('Mail', 'Medium',
            'Reply button missing aria-label',
            shot, 'Add aria-label="Reply to this message" to the reply button.');
        }
        if (msgInfo.replySize && (msgInfo.replySize.w < MIN_TOUCH || msgInfo.replySize.h < MIN_TOUCH)) {
          addFinding('Mail', 'Medium',
            `Reply button is ${msgInfo.replySize.w}x${msgInfo.replySize.h}px (below ${MIN_TOUCH}px)`,
            shot, 'Add min-height/min-width 44px to .mail-reader-reply-button.');
        }
      }
      msgInfo.attachmentSizes.forEach((s, i) => {
        if (s.h < MIN_TOUCH) {
          addFinding('Mail', 'Medium',
            `Attachment link #${i + 1} is ${s.w}x${s.h}px (below ${MIN_TOUCH}px height)`,
            shot, 'Add `.mail-attachment { display: inline-flex; align-items: center; min-height: 44px; padding: 8px 12px; }`.');
        }
      });
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 7. ERROR PAGES (404) =============
  test('L4-07 - Error pages (404 styling + back navigation)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    const response = await page.goto(`${BASE_URL}/nonexistent-page-${Date.now()}`);
    await page.waitForLoadState('networkidle');
    const status = response ? response.status() : 0;
    const shot = await takeScreenshot(page, 'L4-07-404-page');
    console.log(`\n[L4-07 404] HTTP status=${status}`);

    const errInfo = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      const alert = document.querySelector('.alert, .alert-danger');
      const backLink = document.querySelector('#content a[href="/"], .page-header + p a, a[href="/"]');
      const layout = document.querySelector('#content.container, .container');
      return {
        h1Text: h1 ? h1.textContent.trim().slice(0, 80) : null,
        hasAlert: !!alert,
        alertText: alert ? alert.textContent.trim().slice(0, 120) : null,
        alertRole: alert ? alert.getAttribute('role') : null,
        hasBackLink: !!backLink,
        backLinkText: backLink ? backLink.textContent.trim() : null,
        backLinkHref: backLink ? backLink.getAttribute('href') : null,
        hasLayout: !!layout,
        title: document.title,
        rawKey: /messages\.page_not_found|labels\.|messages\./.test(document.body.innerText),
      };
    });
    console.log(`[L4-07 404 INFO] ${JSON.stringify(errInfo)}`);

    if (status >= 400 && status < 500 && status !== 404) {
      addFinding('Error pages', 'Medium',
        `Unknown route returned HTTP ${status} instead of 404`,
        shot, 'Ensure the router returns a proper 404 for unmatched routes.');
    }
    if (!errInfo.hasLayout) {
      addFinding('Error pages', 'High',
        '404 page does not use the standard layout container',
        shot, 'Render the 404 through error_layout.html / layout.html so the navbar + styles appear.');
    }
    if (errInfo.rawKey) {
      addFinding('Error pages', 'High',
        '404 page is showing a raw translation key like "messages.page_not_found" (translation missing)',
        shot, 'Add the `messages.page_not_found` entry to the translation catalog.');
    }
    if (!errInfo.hasAlert) {
      addFinding('Error pages', 'Medium',
        '404 page has no alert/status banner explaining the error',
        shot, 'Keep the `.alert.alert-danger` block in 404.html.');
    } else if (!errInfo.alertRole) {
      addFinding('Error pages', 'Low',
        '404 alert banner missing role="alert"',
        shot, 'Add role="alert" to the .alert on error pages.');
    }
    if (!errInfo.hasBackLink) {
      addFinding('Error pages', 'High',
        '404 page has no link to navigate back to the app',
        shot, 'Add `<a href="/">Return to Calendar</a>` to error_layout.html.');
    }

    // Verify the back link actually works
    if (errInfo.hasBackLink) {
      await page.click('#content a[href="/"], a[href="/"]').catch(() => {});
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1500);
      const backOnCalendar = await page.locator('#calendar_view').isVisible().catch(() => false);
      if (!backOnCalendar) {
        addFinding('Error pages', 'Medium',
          'Clicking the "back" link from the 404 did not return to the calendar',
          shot, 'Ensure the back link href resolves to the calendar route "/" when logged in.');
      }
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 8. PERFORMANCE =============
  test('L4-08 - Performance (per-page load time + slow API calls)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    const slow = collectNetworkTimings(page);

    const pages = [
      { name: 'Login', url: `${BASE_URL}/login`, ready: 'input[name="user"]' },
      { name: 'Calendar', url: `${BASE_URL}/`, ready: '#calendar_view' },
      { name: 'Contacts', url: `${BASE_URL}/cards`, ready: '.contacts-panel' },
      { name: 'Mail', url: `${BASE_URL}/mail`, ready: '#mail_rows, #mail_empty, #mail_loading' },
      { name: 'Preferences', url: `${BASE_URL}/preferences`, ready: '#prefs_form' },
    ];

    await login(page); // auth first; login perf is measured by the login() call itself

    const timings = [];
    for (const p of pages.slice(1)) { // skip login (already done)
      const start = Date.now();
      const resp = await page.goto(p.url, { waitUntil: 'domcontentloaded' });
      try { await page.waitForSelector(p.ready, { timeout: 15000 }); } catch (e) { /* */ }
      const ms = Date.now() - start;
      const status = resp ? resp.status() : 0;
      timings.push({ name: p.name, ms, status });
      console.log(`[L4-08 PERF] ${p.name}: ${ms}ms status=${status}`);
    }
    await takeScreenshot(page, 'L4-08-performance-final');

    timings.forEach(t => {
      if (t.ms > 5000) {
        addFinding('Performance', 'High',
          `Page "${t.name}" took ${t.ms}ms to reach ready state (>5s)`,
          null, 'Profile network/waterfall for this route; cache static assets and reduce backend work.');
      } else if (t.ms > 3000) {
        addFinding('Performance', 'Medium',
          `Page "${t.name}" took ${t.ms}ms to reach ready state (>3s)`,
          null, null);
      }
    });

    if (slow.length > 0) {
      slow.slice(0, 10).forEach(s => {
        addFinding('Performance', 'Medium',
          `Slow API call (${s.responseEnd}ms): ${s.url.slice(0, 90)}`,
          null, 'Optimize this endpoint or add caching/pagination.');
      });
    } else {
      console.log('[L4-08] No API calls exceeded the 3s threshold.');
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 9. VISUAL POLISH =============
  test('L4-09 - Visual polish (overlaps, spacing, clipping, color consistency)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.waitForTimeout(2000);
    const shot = await takeScreenshot(page, 'L4-09a-calendar-visual');

    const polish = await page.evaluate(() => {
      const out = { overlaps: [], clipped: [], fontSizes: new Set(), textColors: new Set() };
      const isHidden = el => {
        const s = window.getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return true;
        const r = el.getBoundingClientRect();
        return r.width === 0 || r.height === 0;
      };

      // 1. Overlapping text blocks in the toolbar / header area (exclude nested parent/child)
      const headerRegion = document.querySelector('#calendar_view .fc-toolbar, .fc-header, .topbar');
      if (headerRegion) {
        const els = Array.from(headerRegion.querySelectorAll('h2, .fc-button, a, button, span')).filter(el => !isHidden(el));
        for (let i = 0; i < els.length; i++) {
          for (let j = i + 1; j < els.length; j++) {
            // skip nested parent/child pairs (e.g. <button><span class=icon></span></button>)
            if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
            const a = els[i].getBoundingClientRect();
            const b = els[j].getBoundingClientRect();
            const overlap = !(a.right < b.left + 2 || b.right < a.left + 2 || a.bottom < b.top + 2 || b.bottom < a.top + 2);
            if (overlap && (a.width > 6 && b.width > 6)) {
              out.overlaps.push({
                a: els[i].textContent.trim().slice(0, 30) || els[i].tagName,
                b: els[j].textContent.trim().slice(0, 30) || els[j].tagName,
              });
            }
          }
        }
      }

      // 2. Clipped text: elements whose scrollWidth > clientWidth (overflow:hidden clipping text)
      document.querySelectorAll('#calendar_view .fc-event, .fc-day-header, .fc-axis, h1, h2, .navbar-brand').forEach(el => {
        if (isHidden(el)) return;
        if (el.scrollWidth - el.clientWidth > 4 && window.getComputedStyle(el).overflowX === 'hidden') {
          out.clipped.push({
            tag: el.tagName,
            cls: (el.className || '').toString().slice(0, 40),
            scrollW: el.scrollWidth,
            clientW: el.clientWidth,
            text: el.textContent.trim().slice(0, 40),
          });
        }
      });

      // 3. Collect distinct font sizes / text colors in toolbar for consistency
      document.querySelectorAll('#calendar_view .fc-toolbar *').forEach(el => {
        if (isHidden(el)) return;
        const s = window.getComputedStyle(el);
        if (el.textContent.trim().length > 0) {
          out.fontSizes.add(s.fontSize);
          out.textColors.add(s.color);
        }
      });
      out.fontSizes = Array.from(out.fontSizes);
      out.textColors = Array.from(out.textColors);
      return out;
    });

    console.log(`\n[L4-09 POLISH] ${JSON.stringify(polish).slice(0, 800)}`);
    if (polish.overlaps.length > 0) {
      addFinding('Calendar', 'High',
        `Toolbar has overlapping elements: ${JSON.stringify(polish.overlaps.slice(0, 3))}`,
        shot, 'Check flex/float layout in the FullCalendar toolbar; add spacing or wrap.');
    }
    if (polish.clipped.length > 0) {
      polish.clipped.slice(0, 3).forEach(c => {
        addFinding('Calendar', 'Medium',
          `Clipped text in ${c.tag}.${c.cls}: "${c.text}" (scrollWidth ${c.scrollW} > clientWidth ${c.clientW})`,
          shot, 'Allow wrapping (white-space: normal) or increase the container width.');
      });
    }
    if (polish.fontSizes.length > 4) {
      addFinding('Calendar', 'Low',
        `Toolbar uses ${polish.fontSizes.length} different font sizes (${polish.fontSizes.join(', ')}); consider a type scale`,
        shot, 'Limit header text to 2-3 font sizes.');
    }

    // Now visit contacts and mail for a color-consistency check
    await page.goto(`${BASE_URL}/cards`);
    await page.waitForTimeout(2000);
    await takeScreenshot(page, 'L4-09b-contacts-visual');
    await page.goto(`${BASE_URL}/mail`);
    await page.waitForTimeout(2500);
    await takeScreenshot(page, 'L4-09c-mail-visual');

    // Check for unstyled bare H1/H2 raw translation keys across pages
    const rawKeyCount = await page.evaluate(() => {
      const txt = document.body.innerText;
      const m = txt.match(/\b(labels|messages)\.[a-z0-9_.]+\b/gi) || [];
      return m.slice(0, 10);
    });
    if (rawKeyCount.length > 0) {
      addFinding('Mail', 'High',
        `Page shows raw translation keys: ${JSON.stringify(rawKeyCount)}`,
        null, 'Add the missing keys to the translation catalog.');
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 10. MOBILE BOTTOM BAR + FAB =============
  test('L4-10 - Mobile bottom bar + FAB (375px)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.waitForTimeout(2500);
    const shot = await takeScreenshot(page, 'L4-10a-mobile-calendar');

    // Bottom bar
    const barInfo = await page.evaluate(() => {
      const bar = document.getElementById('mobile_bottom_bar');
      if (!bar) return { found: false };
      const s = window.getComputedStyle(bar);
      const r = bar.getBoundingClientRect();
      const btns = bar.querySelectorAll('.mobile-bottom-btn');
      return {
        found: true,
        hiddenAttr: bar.hasAttribute('hidden'),
        display: s.display,
        position: s.position,
        bottom: s.bottom,
        rectTop: Math.round(r.top),
        rectBottom: Math.round(r.bottom),
        buttonCount: btns.length,
        actions: Array.from(btns).map(b => b.getAttribute('data-mobile-action')),
        buttonSizes: Array.from(btns).map(b => {
          const rr = b.getBoundingClientRect();
          return { action: b.getAttribute('data-mobile-action'), w: Math.round(rr.width), h: Math.round(rr.height), ariaLabel: b.getAttribute('aria-label') };
        }),
      };
    });
    console.log(`\n[L4-10 BOTTOM BAR] ${JSON.stringify(barInfo)}`);

    if (!barInfo.found) {
      addFinding('Calendar (mobile)', 'High',
        'Mobile bottom bar (#mobile_bottom_bar) is missing',
        shot, 'Render #mobile_bottom_bar in calendar.html and reveal it via mobile.js at narrow widths.');
    } else if (barInfo.hiddenAttr || barInfo.display === 'none') {
      addFinding('Calendar (mobile)', 'High',
        'Mobile bottom bar is hidden on a 375px viewport',
        shot, 'Ensure mobile.js removes [hidden] from #mobile_bottom_bar on narrow viewports.');
    } else {
      const expected = ['prev', 'today', 'view', 'refresh', 'next'];
      const missing = expected.filter(a => !barInfo.actions.includes(a));
      if (missing.length > 0) {
        addFinding('Calendar (mobile)', 'High',
          `Mobile bottom bar missing buttons: ${missing.join(', ')}`,
          shot, `Add ${missing.map(a => `data-mobile-action="${a}"`).join(', ')} buttons.`);
      }
      barInfo.buttonSizes.forEach(b => {
        if (b.w < MIN_TOUCH || b.h < MIN_TOUCH) {
          addFinding('Calendar (mobile)', 'Medium',
            `Bottom bar button "${b.action}" is ${b.w}x${b.h}px (below ${MIN_TOUCH}px)`,
            shot, 'Set `.mobile-bottom-btn { min-width: 44px; min-height: 44px; }`.');
        }
        if (!b.ariaLabel) {
          addFinding('Calendar (mobile)', 'Medium',
            `Bottom bar button "${b.action}" missing aria-label`,
            shot, `Add aria-label to the ${b.action} button.`);
        }
      });
    }

    // FAB
    const fabInfo = await page.evaluate(() => {
      const fab = document.getElementById('mobile_fab_add');
      if (!fab) return { found: false };
      const s = window.getComputedStyle(fab);
      const r = fab.getBoundingClientRect();
      return {
        found: true,
        hiddenAttr: fab.hasAttribute('hidden'),
        display: s.display,
        width: Math.round(r.width),
        height: Math.round(r.height),
        ariaLabel: fab.getAttribute('aria-label'),
        bottom: s.bottom,
        right: s.right,
      };
    });
    console.log(`[L4-10 FAB] ${JSON.stringify(fabInfo)}`);

    if (!fabInfo.found) {
      addFinding('Calendar (mobile)', 'High',
        'Mobile FAB create-event button (#mobile_fab_add) is missing',
        shot, 'Render #mobile_fab_add in calendar.html.');
    } else if (fabInfo.hiddenAttr || fabInfo.display === 'none') {
      addFinding('Calendar (mobile)', 'High',
        'Mobile FAB is hidden on a 375px viewport',
        shot, 'Ensure wireFab() in mobile.js removes [hidden] from #mobile_fab_add.');
    } else {
      if (fabInfo.width < MIN_TOUCH || fabInfo.height < MIN_TOUCH) {
        addFinding('Calendar (mobile)', 'Medium',
          `Mobile FAB is ${fabInfo.width}x${fabInfo.height}px (below ${MIN_TOUCH}px)`,
          shot, 'Set `.mobile-fab { width: 56px; height: 56px; }` minimum.');
      }
      if (!fabInfo.ariaLabel) {
        addFinding('Calendar (mobile)', 'Medium',
          'Mobile FAB missing aria-label',
          shot, 'Add aria-label="Create event" to #mobile_fab_add.');
      }

      // FAB opens event creation
      await page.locator('#mobile_fab_add').click().catch(() => {});
      await page.waitForTimeout(1500);
      const fabShot = await takeScreenshot(page, 'L4-10b-mobile-fab-clicked');
      const dialogOpened = await page.evaluate(() => {
        const cands = ['.ui-dialog:visible', '[role="dialog"]', '.modal.in', '#event_edit_dialog', '.ui-draggable'];
        return cands.some(sel => {
          const el = document.querySelector(sel);
          if (!el) return false;
          const s = window.getComputedStyle(el);
          return s.display !== 'none' && s.visibility !== 'hidden';
        });
      });
      console.log(`[L4-10 FAB CLICK] dialogOpened=${dialogOpened}`);
      if (!dialogOpened) {
        addFinding('Calendar (mobile)', 'High',
          'Clicking the mobile FAB did not open the event creation dialog',
          fabShot, 'Verify wireFab() calls newEvent()/open_event_edit_dialog and that the dialog renders.');
      }
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= SUMMARY =============
  test('L4-11 - Summary: write findings report', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    console.log('\n\n========================================================');
    console.log('  CALDAVER LOOP 4 DEEP UI AUDIT - FINDINGS REPORT');
    console.log('========================================================\n');
    console.log(`Total findings: ${findings.length}\n`);

    const severityOrder = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    const sorted = [...findings].sort((a, b) => (severityOrder[a.severity] || 99) - (severityOrder[b.severity] || 99));

    for (const f of sorted) {
      console.log(`[${f.id}] Severity: ${f.severity}`);
      console.log(`    Page: ${f.page}`);
      console.log(`    Description: ${f.description}`);
      if (f.recommendation) console.log(`    Fix: ${f.recommendation}`);
      if (f.screenshotPath) console.log(`    Screenshot: ${f.screenshotPath}`);
      console.log('');
    }

    const summary = {
      total: findings.length,
      critical: findings.filter(f => f.severity === 'Critical').length,
      high: findings.filter(f => f.severity === 'High').length,
      medium: findings.filter(f => f.severity === 'Medium').length,
      low: findings.filter(f => f.severity === 'Low').length,
      byPage: {},
    };
    for (const f of findings) {
      summary.byPage[f.page] = (summary.byPage[f.page] || 0) + 1;
    }

    console.log('--- SUMMARY ---');
    console.log(JSON.stringify(summary, null, 2));

    fs.writeFileSync(`${SCREENSHOT_DIR}/loop4-findings.json`, JSON.stringify({ findings: sorted, summary }, null, 2));
    expect(findings.length).toBeGreaterThanOrEqual(0);
  });
});
