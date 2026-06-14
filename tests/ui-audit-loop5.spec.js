/**
 * Caldaver Loop 5 - Deep UI Audit (NEW angles, not covered by rounds 1-4).
 *
 * Previous rounds already fixed:
 *   R1: i18n strings, mobile 44px touch targets, a11y labels
 *   R2: Calendar grid lines (1px #dadce0), dotted minor time slots
 *   R3: Today button, contact phone links 44px, radio inputs 24px
 *   R4: Keyboard shortcuts, focus trap, qtip role=dialog, 404 page, mobile
 *       bottom bar + FAB, mail reply button 44px
 *
 * This loop audits DIFFERENT, deeper concerns:
 *   L5-01 Calendar event create flow (click time slot -> dialog)
 *   L5-02 Calendar event drag & drop (move an existing event)
 *   L5-03 Settings/Preferences page (sections, timezone dropdown, save)
 *   L5-04 Sidebar calendar list (toggles, create button, styling)
 *   L5-05 Navbar and user menu (dropdown, logout, hamburger, nav links)
 *   L5-06 Print styles (stylesheet link present, @media print rules)
 *   L5-07 Responsive breakpoints (768px tablet, 1024px desktop)
 *   L5-08 Color contrast (WCAG AA for major components)
 *   L5-09 Loading / empty states (no events, no contacts, no mail)
 *   L5-10 Form validation (login empty submit, contact required fields)
 *   L5-11 CSS specificity / inline styles / !important usage
 *   L5-12 Mobile calendar event display + bottom bar + FAB (375px)
 *   L5-13 Summary report
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');

const BASE_URL = process.env.CALDAVER_BASE_URL || 'http://localhost:8080';
const USERNAME = process.env.CALDAVER_USERNAME;
const PASSWORD = process.env.CALDAVER_PASSWORD;
const SCREENSHOT_DIR = '/tmp/caldaver-audit-loop5';
const MIN_TOUCH = 44;

const findings = [];

function addFinding(page, severity, description, screenshotPath, recommendation) {
  findings.push({
    id: `L5-${String(findings.length + 1).padStart(3, '0')}`,
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

async function takeScreenshot(page, name) {
  const path = `${SCREENSHOT_DIR}/${name}.png`;
  await page.screenshot({ path, fullPage: true });
  return path;
}

/**
 * Relative luminance per WCAG 2.1. Accepts a CSS rgb()/rgba()/hex string.
 */
function luminance(color) {
  if (!color) return null;
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
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      break;
    } catch (e) {
      if (attempt === 2) throw e;
      console.log(`  [login retry ${attempt + 1}/3] ${e.message.split('\n')[0]}`);
      await page.waitForTimeout(2000);
    }
  }
  await page.locator('input[name="user"]').fill(USERNAME);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('input[name="login"]').click();
  await expect(page.locator('#calendar_view')).toBeVisible({ timeout: 30000 });
  await page.waitForFunction(() => {
    return !!(window.jQuery && window.translations && window.CaldaverConf && window.CaldaverConf.i18n);
  }, { timeout: 30000 });
  await page.waitForTimeout(1500);
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
  return false;
}

async function gotoToday(page) {
  const todayBtn = page.locator('.fc-today-button, .fc-button:has-text("today"), .fc-button:has-text("Today")').first();
  if (await todayBtn.isVisible().catch(() => false)) {
    const disabled = await todayBtn.isDisabled().catch(() => false);
    if (!disabled) {
      await todayBtn.click().catch(() => {});
      await page.waitForTimeout(800);
    }
  }
}

const SEVERITY_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };

test.describe('Caldaver Loop 5 Deep UI Audit', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  test.setTimeout(300000);

  // ============= 1. CALENDAR EVENT CREATE FLOW =============
  test('L5-01 - Calendar event create flow (click time slot -> dialog)', async ({ page, browser }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await gotoToday(page);
    await switchToWeekView(page);
    const shot0 = await takeScreenshot(page, 'L5-01a-week-before-click');

    // Try clicking an empty time slot (around midday) to trigger event create
    const slotInfo = await page.evaluate(() => {
      const slots = document.querySelectorAll('#calendar_view .fc-time-grid .fc-slats tr, #calendar_view .fc-time-grid .fc-bg td.fc-day');
      // Find a clickable area: the time-grid container
      const grid = document.querySelector('#calendar_view .fc-time-grid');
      if (!grid) return { found: false };
      const r = grid.getBoundingClientRect();
      // Midday slot center
      return { found: true, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
    });
    console.log(`\n[L5-01 GRID] ${JSON.stringify(slotInfo)}`);

    let dialogOpened = false;
    if (slotInfo.found) {
      // Click roughly in the middle of the grid (Wednesday ~ noon)
      const x = slotInfo.rect.x + Math.round(slotInfo.rect.w * 0.5);
      const y = slotInfo.rect.y + Math.round(slotInfo.rect.h * 0.45);
      await page.mouse.click(x, y);
      await page.waitForTimeout(2000);
      const shotClick = await takeScreenshot(page, 'L5-01b-after-slot-click');

      const dialogInfo = await page.evaluate(() => {
        const anyVisible = el => {
          if (!el) return false;
          const s = window.getComputedStyle(el);
          if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        // Detect any visible dialog-like container.
        const candidates = [
          { kind: 'ui-dialog', el: document.querySelector('.ui-dialog') },
          { kind: 'role-dialog', el: document.querySelector('[role="dialog"]') },
          { kind: 'modal', el: document.querySelector('.modal.in, .modal.show') },
          { kind: 'qtip', el: document.querySelector('.qtip') },
          { kind: 'event_edit_dialog', el: document.getElementById('event_edit_dialog') },
        ];
        const found = candidates.find(c => anyVisible(c.el));
        if (!found) return { open: false };
        // For jQuery UI dialogs the buttons live in .ui-dialog-buttonpane and
        // the title in .ui-dialog-title, both inside .ui-dialog (a sibling of
        // #event_edit_dialog). Inspect the wrapper when present so we don't miss them.
        const wrapper = found.el.closest('.ui-dialog') || found.el;
        const el = wrapper;
        const summaryInput = el.querySelector('input.summary, input[name="summary"], #event_summary');
        const allInputs = el.querySelectorAll('input, select, textarea');
        const buttons = el.querySelectorAll('button, input[type="submit"], input[type="button"], .ui-button');
        const titleEl = el.querySelector('h1, h2, h3, .ui-dialog-title, .qtip-title, .modal-title');
        return {
          open: true,
          kind: found.kind,
          role: el.getAttribute('role') || (found.kind === 'role-dialog' ? 'dialog' : null),
          ariaLabel: el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'),
          hasTitle: !!titleEl,
          titleText: titleEl ? titleEl.textContent.trim().slice(0, 80) : '',
          hasSummaryInput: !!summaryInput,
          inputCount: allInputs.length,
          buttonCount: buttons.length,
          buttonLabels: Array.from(buttons).slice(0, 6).map(b => (b.textContent || b.value || '').trim().slice(0, 20)),
        };
      });
      console.log(`[L5-01 DIALOG] ${JSON.stringify(dialogInfo)}`);
      dialogOpened = dialogInfo.open;

      if (!dialogInfo.open) {
        addFinding('Calendar', 'High',
          'Clicking a time slot in week view did not open the event-creation dialog',
          shotClick,
          'Ensure FullCalendar select callback opens #event_edit_dialog (newEvent). Verify the time-grid handles select events.');
      } else {
        if (!dialogInfo.hasSummaryInput) {
          addFinding('Calendar', 'High',
            'Event creation dialog opened but has no summary/title input (input.summary)',
            shotClick,
            'Ensure the event_edit_dialog template renders <input class="summary" name="summary">.');
        }
        if (dialogInfo.buttonCount === 0) {
          addFinding('Calendar', 'High',
            'Event creation dialog has no action buttons (save/cancel)',
            shotClick, 'Render Save and Cancel buttons in event_edit_dialog.');
        }
        if (!dialogInfo.hasTitle && !dialogInfo.ariaLabel) {
          addFinding('Calendar', 'Medium',
            'Event creation dialog has no accessible title or aria-label',
            shotClick, 'Add an <h2>/<h3> or aria-label to the dialog.');
        }
        if (dialogInfo.role !== 'dialog' && dialogInfo.kind !== 'role-dialog') {
          // ui-dialog wrapper should carry role=dialog
          const inner = await page.evaluate(() => {
            const d = document.querySelector('.ui-dialog, #event_edit_dialog');
            return d ? { role: d.getAttribute('role'), ariaModal: d.getAttribute('aria-modal') } : null;
          });
          if (!inner || inner.role !== 'dialog') {
            addFinding('Calendar', 'Medium',
              `Event creation dialog (${dialogInfo.kind}) lacks role="dialog"`,
              shotClick, 'Add role="dialog" and aria-modal="true" to the dialog wrapper.');
          }
        }
      }
    }

    // Also test the explicit "Create event" button (#shortcut_add_event / #calendar_add)
    const addBtn = page.locator('#shortcut_add_event, a:has-text("Create event"), .fc-addEvent-button').first();
    const addBtnVisible = await addBtn.isVisible().catch(() => false);
    console.log(`[L5-01 ADD BUTTON] visible=${addBtnVisible}`);
    if (addBtnVisible) {
      await addBtn.click().catch(() => {});
      await page.waitForTimeout(1500);
      const shotAdd = await takeScreenshot(page, 'L5-01c-create-button');
      const opened = await page.evaluate(() => {
        const el = document.getElementById('event_edit_dialog') || document.querySelector('.ui-dialog, [role="dialog"]');
        if (!el) return false;
        const s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && el.getBoundingClientRect().width > 0;
      });
      console.log(`[L5-01 CREATE BTN] dialogOpened=${opened}`);
      if (!opened && !dialogOpened) {
        addFinding('Calendar', 'High',
          'Neither time-slot click nor "Create event" button opens the event editor',
          shotAdd, 'Verify #shortcut_add_event click handler -> newEvent() and FullCalendar select callback.');
      }
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 2. CALENDAR EVENT DRAG & DROP =============
  test('L5-02 - Calendar event drag & drop (move an existing event)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await gotoToday(page);
    await switchToWeekView(page);
    const shot0 = await takeScreenshot(page, 'L5-02a-before-drag');

    const eventInfo = await page.evaluate(() => {
      const ev = document.querySelector('#calendar_view .fc-time-grid-event, #calendar_view .fc-event');
      if (!ev) return { found: false };
      const r = ev.getBoundingClientRect();
      return {
        found: true,
        text: (ev.textContent || '').trim().slice(0, 50),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        draggable: ev.getAttribute('data-event') !== null || ev.className.includes('fc-draggable') || true,
      };
    });
    console.log(`\n[L5-02 EVENT] ${JSON.stringify(eventInfo)}`);

    if (!eventInfo.found) {
      console.log('[L5-02] No events to drag (data-dependent).');
      addFinding('Calendar', 'Low',
        'No calendar events present to test drag & drop (data-dependent)',
        shot0, null);
    } else {
      // Attempt a drag from the event center downward by ~80px
      const startX = eventInfo.rect.x + Math.round(eventInfo.rect.w / 2);
      const startY = eventInfo.rect.y + Math.round(eventInfo.rect.h / 2);
      const endY = startY + 90;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.waitForTimeout(300);
      // Move in a couple steps so jQuery UI drag registers
      for (let step = 1; step <= 4; step++) {
        await page.mouse.move(startX, startY + Math.round((endY - startY) * (step / 4)));
        await page.waitForTimeout(120);
      }
      await page.mouse.up();
      await page.waitForTimeout(1500);
      const shotDrag = await takeScreenshot(page, 'L5-02b-after-drag');

      // Check for a revert/confirm dialog or that the event moved / an API call fired
      const afterInfo = await page.evaluate(() => {
        const ev = document.querySelector('#calendar_view .fc-time-grid-event, #calendar_view .fc-event');
        if (!ev) return { found: false };
        const r = ev.getBoundingClientRect();
        // Did a confirm/resize dialog appear?
        const dialog = document.querySelector('.ui-dialog:visible, [role="dialog"]');
        return {
          found: true,
          newY: Math.round(r.y),
          text: (ev.textContent || '').trim().slice(0, 50),
          dialogOpen: !!dialog && dialog.getBoundingClientRect().width > 0,
        };
      });
      console.log(`[L5-02 AFTER DRAG] ${JSON.stringify(afterInfo)}`);

      // We can't strictly assert the event moved (data may revert), but we flag
      // whether drag produced an error toast.
      const errorToast = await page.evaluate(() => {
        const t = document.querySelector('.freeow, .alert-danger, .toast-error');
        return t ? t.textContent.trim().slice(0, 100) : null;
      });
      if (errorToast && /error|fail/i.test(errorToast)) {
        addFinding('Calendar', 'High',
          `Dragging an event produced an error toast: "${errorToast}"`,
          shotDrag, 'Verify event drop callback fires /events/save with correct payload.');
      }
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 3. SETTINGS / PREFERENCES PAGE =============
  test('L5-03 - Settings/Preferences page (sections, dropdowns, save)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.goto(`${BASE_URL}/preferences`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    const shot = await takeScreenshot(page, 'L5-03a-preferences');

    const prefsInfo = await page.evaluate(() => {
      const form = document.getElementById('prefs_form');
      const sections = document.querySelectorAll('#prefs_form fieldset, .preferences-section, .panel');
      const tz = document.querySelector('#prefs_form select[name="timezone"], select[name="timezone"]');
      const lang = document.querySelector('#prefs_form select[name="language"], select[name="language"]');
      const saveBtn = document.querySelector('#prefs_form button[type="submit"], #prefs_buttons button, #prefs_buttons a');
      const viewSelect = document.querySelector('#prefs_form select[name="default_view"]');
      const inputs = document.querySelectorAll('#prefs_form input, #prefs_form select, #prefs_form textarea');
      const fieldLabels = Array.from(document.querySelectorAll('#prefs_form label')).map(l => l.textContent.trim().slice(0, 30));
      const tzOptions = tz ? tz.querySelectorAll('option').length : 0;
      const langOptions = lang ? lang.querySelectorAll('option').length : 0;
      return {
        formPresent: !!form,
        formAction: form ? form.getAttribute('action') : null,
        sectionCount: sections.length,
        inputCount: inputs.length,
        fieldLabels,
        tzPresent: !!tz,
        tzOptionCount: tzOptions,
        tzValue: tz ? tz.value : null,
        langPresent: !!lang,
        langOptionCount: langOptions,
        langValue: lang ? lang.value : null,
        viewSelectPresent: !!viewSelect,
        savePresent: !!saveBtn,
        saveText: saveBtn ? (saveBtn.textContent || saveBtn.value || '').trim().slice(0, 30) : null,
        bodyScrollable: window.getComputedStyle(document.body).overflow !== 'hidden',
      };
    });
    console.log(`\n[L5-03 PREFS] ${JSON.stringify(prefsInfo).slice(0, 700)}`);

    if (!prefsInfo.formPresent) {
      addFinding('Preferences', 'High',
        'Preferences page has no #prefs_form element',
        shot, 'Render <form id="prefs_form"> on /preferences.');
    } else {
      if (prefsInfo.inputCount < 5) {
        addFinding('Preferences', 'Medium',
          `Preferences form has only ${prefsInfo.inputCount} inputs (expected ~10+ settings)`,
          shot, 'Ensure all preference fields (timezone, language, weekstart, etc.) render.');
      }
      if (!prefsInfo.tzPresent) {
        addFinding('Preferences', 'High',
          'Timezone dropdown missing on preferences page',
          shot, 'Render <select name="timezone"> populated with moment.tz.names().');
      } else if (prefsInfo.tzOptionCount < 50) {
        addFinding('Preferences', 'Medium',
          `Timezone dropdown has only ${prefsInfo.tzOptionCount} options (expected 100+)`,
          shot, 'render_preferences() hardcodes only 3 timezone <option>s in lib.rs. Iterate over available_timezones() (or moment.tz.names()) to populate the select.');
      }
      if (!prefsInfo.langPresent) {
        addFinding('Preferences', 'Medium',
          'Language selector missing on preferences page',
          shot, 'Render <select name="language"> with available locales.');
      }
      if (!prefsInfo.savePresent) {
        addFinding('Preferences', 'High',
          'Save button missing on preferences page',
          shot, 'Render a submit button inside #prefs_buttons.');
      }
    }

    // Layout: check the page scrolls (regression guard)
    if (!prefsInfo.bodyScrollable) {
      addFinding('Preferences', 'High',
        'Preferences page body has overflow:hidden and cannot scroll',
        shot, 'Ensure body overflow is auto/visible on /preferences.');
    }

    // Test save (submit) returns success
    if (prefsInfo.savePresent && prefsInfo.formPresent) {
      const saveResponsePromise = page.waitForResponse(resp =>
        resp.url().includes('/preferences') && resp.request().method() === 'POST', { timeout: 15000 }
      ).catch(() => null);
      await page.locator('#prefs_form button[type="submit"], #prefs_buttons button').first().click().catch(() => {});
      const saveResp = await saveResponsePromise;
      console.log(`[L5-03 SAVE] status=${saveResp ? saveResp.status() : 'no-response'}`);
      if (saveResp && saveResp.status() >= 400) {
        addFinding('Preferences', 'High',
          `Saving preferences returned HTTP ${saveResp.status()}`,
          await takeScreenshot(page, 'L5-03b-save-error'), 'Check preferences_save handler and CSRF token.');
      }
      await page.waitForTimeout(1000);
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 4. SIDEBAR CALENDAR LIST =============
  test('L5-04 - Sidebar calendar list (toggles, create button, styling)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.waitForFunction(() => document.querySelectorAll('div.calendar_list li.available_calendar').length > 0, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const shot = await takeScreenshot(page, 'L5-04a-sidebar-calendar-list');

    const listInfo = await page.evaluate(() => {
      const listContainer = document.querySelector('.calendar_list, #own_calendar_list');
      const items = document.querySelectorAll('.calendar_list li.available_calendar, .calendar_list li');
      const toggles = document.querySelectorAll('.calendar_list input[type="checkbox"], .calendar_list .calendar-toggle');
      const colorBoxes = document.querySelectorAll('.calendar_list .calendar_color, .calendar_list .calendar-color, .calendar_list .calendar_color_sample');
      const createBtn = document.getElementById('calendar_add');
      const labels = Array.from(items).slice(0, 6).map(li => li.textContent.trim().replace(/\s+/g, ' ').slice(0, 40));
      return {
        listPresent: !!listContainer,
        listVisible: listContainer ? window.getComputedStyle(listContainer).display !== 'none' : false,
        itemCount: items.length,
        toggleCount: toggles.length,
        colorBoxCount: colorBoxes.length,
        createBtnPresent: !!createBtn,
        createBtnVisible: createBtn ? createBtn.getBoundingClientRect().width > 0 : false,
        labels,
      };
    });
    console.log(`\n[L5-04 SIDEBAR] ${JSON.stringify(listInfo)}`);

    if (!listInfo.listPresent) {
      addFinding('Calendar sidebar', 'High',
        'Sidebar calendar list (.calendar_list) is missing on desktop',
        shot, 'Render the calendar_list sidebar in the calendar page layout.');
    } else if (!listInfo.listVisible) {
      addFinding('Calendar sidebar', 'Medium',
        'Sidebar calendar list is present but hidden on desktop (1280px)',
        shot, 'Ensure the sidebar is visible at desktop widths.');
    } else {
      if (listInfo.itemCount === 0) {
        addFinding('Calendar sidebar', 'Medium',
          'Sidebar calendar list is empty (no calendars loaded)',
          shot, 'Verify /calendars endpoint returns calendars and they render into .calendar_list.');
      }
      if (listInfo.itemCount > 0 && listInfo.toggleCount === 0) {
        addFinding('Calendar sidebar', 'High',
          'Calendar list items have no toggle checkbox (cannot show/hide calendars)',
          shot, 'Add a checkbox input to each available_calendar entry.');
      }
      if (listInfo.itemCount > 0 && listInfo.colorBoxCount === 0) {
        addFinding('Calendar sidebar', 'Low',
          'Calendar list items have no color swatch indicator',
          shot, 'Add a .calendar-color swatch reflecting each calendar color.');
      }
      // Check toggle tap target size
      const toggleSizes = await page.evaluate(() => {
        const toggles = document.querySelectorAll('.calendar_list input[type="checkbox"]');
        return Array.from(toggles).slice(0, 5).map(t => {
          const r = t.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height) };
        });
      });
      toggleSizes.forEach((s, i) => {
        if (s.w < 16 || s.h < 16) {
          addFinding('Calendar sidebar', 'Low',
            `Calendar toggle checkbox #${i + 1} is ${s.w}x${s.h}px (small for desktop click)`,
            shot, 'Set checkbox min size 16-24px.');
        }
      });
    }

    // Calendar create button
    if (!listInfo.createBtnPresent) {
      addFinding('Calendar sidebar', 'Medium',
        '"Create calendar" button (#calendar_add) missing in sidebar',
        shot, 'Render #calendar_add in the sidebar header.');
    } else if (!listInfo.createBtnVisible) {
      addFinding('Calendar sidebar', 'Medium',
        '"Create calendar" button is present but not visible',
        shot, 'Ensure #calendar_add is visible at desktop width.');
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 5. NAVBAR AND USER MENU =============
  test('L5-05 - Navbar and user menu (dropdown, logout, hamburger, nav links)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.waitForTimeout(1000);
    const shotDesktop = await takeScreenshot(page, 'L5-05a-navbar-desktop');

    // Desktop: user menu dropdown
    const userPill = page.locator('#usermenu .user-pill').first();
    const userPillVisible = await userPill.isVisible().catch(() => false);
    console.log(`\n[L5-05 USER PILL] visible=${userPillVisible}`);
    if (!userPillVisible) {
      addFinding('Navbar', 'Medium',
        'User menu pill (.user-pill) not visible on desktop navbar',
        shotDesktop, 'Ensure the user-menu-dropdown summary renders at desktop width.');
    } else {
      await userPill.click();
      await page.waitForTimeout(500);
      const shotMenu = await takeScreenshot(page, 'L5-05b-user-menu-open');
      const menuInfo = await page.evaluate(() => {
        const logout = document.querySelector('#usermenu .user-menu-logout');
        const list = document.querySelector('#usermenu .user-menu-list');
        const listVisible = list ? window.getComputedStyle(list).display !== 'none' && list.getBoundingClientRect().width > 0 : false;
        return {
          logoutPresent: !!logout,
          logoutVisible: logout ? logout.getBoundingClientRect().width > 0 : false,
          logoutHref: logout ? logout.getAttribute('href') : null,
          logoutText: logout ? logout.textContent.trim() : null,
          listVisible,
        };
      });
      console.log(`[L5-05 MENU] ${JSON.stringify(menuInfo)}`);
      if (!menuInfo.logoutPresent) {
        addFinding('Navbar', 'High',
          'User menu dropdown has no logout link',
          shotMenu, 'Add <a class="user-menu-logout" href="/logout"> to the user-menu-list.');
      } else if (!menuInfo.listVisible && !menuInfo.logoutVisible) {
        addFinding('Navbar', 'High',
          'Clicking user pill does not reveal the logout option',
          shotMenu, 'Verify the <details> user-menu-dropdown opens its menu on click.');
      } else if (menuInfo.logoutHref !== '/logout') {
        addFinding('Navbar', 'Medium',
          `Logout link href is "${menuInfo.logoutHref}" (expected /logout)`,
          shotMenu, 'Set the logout link href to /logout.');
      }
    }

    // Desktop nav links (sidebar app-nav)
    const navInfo = await page.evaluate(() => {
      const nav = document.querySelector('#sidebar .app-nav, .cards-sidebar .app-nav');
      const links = nav ? Array.from(nav.querySelectorAll('a')).map(a => ({ text: a.textContent.trim().slice(0, 20), href: a.getAttribute('href') })) : [];
      return { navPresent: !!nav, links };
    });
    console.log(`[L5-05 NAV] ${JSON.stringify(navInfo)}`);
    if (!navInfo.navPresent) {
      addFinding('Navbar', 'Medium',
        'Desktop sidebar app-nav is missing',
        shotDesktop, 'Render the #sidebar .app-nav with Calendar/Contacts/Mail links.');
    }

    // Mobile hamburger menu (375px) - separate context
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(800);
    const shotMobile = await takeScreenshot(page, 'L5-05c-navbar-mobile');
    const mobileMenuInfo = await page.evaluate(() => {
      const hamburger = document.querySelector('.mobile-section-menu > summary, .topbar-menu');
      const hamburgerVisible = hamburger ? hamburger.getBoundingClientRect().width > 0 : false;
      const brandVisible = !!document.querySelector('.caldaver-brand-title');
      return { hamburgerPresent: !!hamburger, hamburgerVisible, brandVisible };
    });
    console.log(`[L5-05 MOBILE MENU] ${JSON.stringify(mobileMenuInfo)}`);
    if (!mobileMenuInfo.hamburgerPresent || !mobileMenuInfo.hamburgerVisible) {
      addFinding('Navbar (mobile)', 'High',
        'Mobile hamburger menu (.mobile-section-menu summary) not visible at 375px',
        shotMobile, 'Render the mobile-section-menu <details><summary> at narrow viewports.');
    } else {
      // Open it and verify nav links appear
      await page.locator('.mobile-section-menu > summary').click().catch(() => {});
      await page.waitForTimeout(500);
      const openInfo = await page.evaluate(() => {
        const list = document.querySelector('.mobile-section-menu-list');
        if (!list) return { open: false };
        const links = Array.from(list.querySelectorAll('a')).map(a => ({ text: a.textContent.trim().replace(/\s+/g, ' ').slice(0, 24), href: a.getAttribute('href') }));
        const visible = list.getBoundingClientRect().width > 0 && list.getBoundingClientRect().height > 0;
        return { open: visible, links };
      });
      console.log(`[L5-05 MOBILE MENU OPEN] ${JSON.stringify(openInfo)}`);
      if (!openInfo.open) {
        addFinding('Navbar (mobile)', 'High',
          'Tapping the hamburger does not open the section menu',
          shotMobile, 'Verify <details class="mobile-section-menu"> toggles open.');
      } else if (openInfo.links.length === 0) {
        addFinding('Navbar (mobile)', 'Medium',
          'Mobile section menu opens but contains no navigation links',
          shotMobile, 'Populate mobile-section-menu-list with Calendar/Contacts/Mail links.');
      } else {
        const hasContacts = openInfo.links.some(l => /contact/i.test(l.text));
        const hasMail = openInfo.links.some(l => /mail/i.test(l.text));
        if (!hasContacts) {
          addFinding('Navbar (mobile)', 'Medium',
            'Mobile menu has no Contacts link', shotMobile, 'Add a Contacts link.');
        }
        if (!hasMail) {
          addFinding('Navbar (mobile)', 'Medium',
            'Mobile menu has no Mail link', shotMobile, 'Add a Mail link.');
        }
      }
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 6. PRINT STYLES =============
  test('L5-06 - Print styles (stylesheet link + @media print rules)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.waitForTimeout(800);
    const shot = await takeScreenshot(page, 'L5-06a-print-check');

    const printInfo = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('link[rel="stylesheet"], link[rel~="stylesheet"]'));
      const stylesheetHrefs = links.map(l => l.getAttribute('href'));
      const hasPrintLink = links.some(l => {
        const media = (l.getAttribute('media') || '').toLowerCase();
        return media.includes('print');
      });
      const hasPrintCssHref = links.some(l => /print/i.test(l.getAttribute('href') || ''));
      // Scan loaded CSSRules for @media print
      let mediaPrintRules = 0;
      let totalSheets = 0;
      for (const sheet of document.styleSheets) {
        totalSheets++;
        try {
          const rules = sheet.cssRules || [];
          for (const rule of rules) {
            if (rule instanceof CSSMediaRule && rule.media && rule.media.mediaText.includes('print')) {
              mediaPrintRules += rule.cssRules.length;
            }
          }
        } catch (e) { /* cross-origin */ }
      }
      return {
        stylesheetHrefs,
        hasPrintLink,
        hasPrintCssHref,
        mediaPrintRules,
        totalSheets,
      };
    });
    console.log(`\n[L5-06 PRINT] ${JSON.stringify(printInfo).slice(0, 600)}`);

    if (!printInfo.hasPrintCssHref && !printInfo.hasPrintLink && printInfo.mediaPrintRules === 0) {
      addFinding('Print styles', 'High',
        'No print stylesheet is linked and no @media print rules exist in loaded CSS. A built caldaver.print.css exists but is never referenced.',
        shot,
        'In the layout() function add: <link href="/dist/css/caldaver.print.css" rel="stylesheet" media="print"> or include @media print rules in caldaver.css.');
    } else if (printInfo.mediaPrintRules === 0 && !printInfo.hasPrintCssHref) {
      addFinding('Print styles', 'Medium',
        `Print stylesheet link missing and only ${printInfo.mediaPrintRules} @media print rules found`,
        shot, 'Link the built caldaver.print.css with media="print".');
    }

    // Emulate print media and screenshot
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(500);
    const shotPrint = await takeScreenshot(page, 'L5-06b-print-emulation');
    await page.emulateMedia({ media: 'screen' });

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 7. RESPONSIVE BREAKPOINTS =============
  test('L5-07 - Responsive breakpoints (768px tablet, 1024px desktop)', async ({ page }) => {
    const messages = collectConsoleMessages(page);
    await login(page);

    for (const [name, w, h] of [['tablet-768', 768, 1024], ['desktop-1024', 1024, 768]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(1200);
      const shot = await takeScreenshot(page, `L5-07a-${name}`);

      const bpInfo = await page.evaluate(() => {
        const isHidden = el => {
          if (!el) return true;
          const s = window.getComputedStyle(el);
          return s.display === 'none' || s.visibility === 'hidden' || el.getBoundingClientRect().width === 0;
        };
        const sidebar = document.querySelector('#sidebar');
        const mobileMenu = document.querySelector('.mobile-section-menu');
        const calendar = document.querySelector('#calendar_view');
        const fcToolbar = document.querySelector('#calendar_view .fc-toolbar, .fc-header');
        // Mobile fallback for view controls: bottom bar "view" button / mobile toolbar
        const mobileViewBtn = document.querySelector('#mobile_bottom_bar .mobile-bottom-btn[data-mobile-action="view"]');
        const bodyOverflow = window.getComputedStyle(document.body).overflow;
        const docScroll = document.documentElement.scrollHeight - window.innerHeight;
        // Check for horizontal overflow
        const horizontalOverflow = document.documentElement.scrollWidth - window.innerWidth;
        return {
          sidebarVisible: !isHidden(sidebar),
          mobileMenuVisible: !isHidden(mobileMenu),
          calendarVisible: !isHidden(calendar),
          toolbarVisible: !isHidden(fcToolbar),
          mobileViewVisible: !isHidden(mobileViewBtn),
          bodyOverflow,
          verticalScrollable: docScroll,
          horizontalOverflow,
        };
      });
      console.log(`\n[L5-07 ${name} ${w}px] ${JSON.stringify(bpInfo)}`);

      if (bpInfo.horizontalOverflow > 20) {
        addFinding('Responsive', 'High',
          `${name} (${w}px): page has ${bpInfo.horizontalOverflow}px horizontal overflow (causes horizontal scroll)`,
          shot, 'Constrain wide elements (calendar grid, tables) to viewport width with overflow-x handling.');
      }
      if (!bpInfo.calendarVisible) {
        addFinding('Responsive', 'High',
          `${name} (${w}px): calendar is not visible`,
          shot, 'Ensure #calendar_view remains visible across breakpoints.');
      }
      if (!bpInfo.toolbarVisible && !bpInfo.mobileViewVisible) {
        addFinding('Responsive', 'Medium',
          `${name} (${w}px): calendar toolbar is hidden and no mobile view-control (bottom bar "view" button) is visible either`,
          shot, 'At narrow widths reveal a mobile toolbar or the #mobile_bottom_bar "view" button so users can switch views.');
      }
      if (w >= 1024 && !bpInfo.sidebarVisible) {
        addFinding('Responsive', 'Medium',
          `At desktop ${w}px the sidebar is hidden (should be visible)`,
          shot, 'Keep the sidebar visible at >=1024px.');
      }
      if (w <= 768 && !bpInfo.mobileMenuVisible) {
        addFinding('Responsive', 'Medium',
          `At tablet ${w}px no mobile section menu is visible`,
          shot, 'Reveal the mobile-section-menu at <=768px or below the sidebar breakpoint.');
      }
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 8. COLOR CONTRAST (WCAG AA) =============
  test('L5-08 - Color contrast (WCAG AA for major components)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.waitForTimeout(1000);
    const shotCal = await takeScreenshot(page, 'L5-08a-calendar-contrast');

    const contrastChecks = await page.evaluate(() => {
      const results = [];
      const checks = [
        { name: 'navbar-link', selector: '.navbar, .caldaver-topbar a, .caldaver-topbar .navbar-brand' },
        { name: 'sidebar-link', selector: '#sidebar .app-nav a' },
        { name: 'sidebar-brand', selector: '#sidebar .caldaver-sidebrand' },
        { name: 'user-pill', selector: '.user-pill, .user-pill-label' },
        { name: 'fc-button', selector: '#calendar_view .fc-button' },
        { name: 'fc-toolbar-h2', selector: '#calendar_view .fc-toolbar h2' },
        { name: 'fc-axis-time', selector: '#calendar_view .fc-axis' },
        { name: 'fc-day-header', selector: '#calendar_view .fc-day-header' },
        { name: 'calendar-add-link', selector: '#calendar_add' },
      ];
      for (const c of checks) {
        const el = document.querySelector(c.selector);
        if (!el) { results.push({ name: c.name, found: false }); continue; }
        const s = window.getComputedStyle(el);
        const fg = s.color;
        const bgEl = el;
        // Walk up to find an opaque background
        let bg = null;
        let node = el;
        for (let i = 0; i < 6 && node; i++) {
          const bs = window.getComputedStyle(node);
          if (bs.backgroundColor && bs.backgroundColor !== 'rgba(0, 0, 0, 0)' && bs.backgroundColor !== 'transparent') {
            bg = bs.backgroundColor;
            break;
          }
          node = node.parentElement;
        }
        if (!bg) bg = 'rgb(255, 255, 255)';
        results.push({ name: c.name, found: true, fg, bg, fontSize: s.fontSize, fontWeight: s.fontWeight });
      }
      return results;
    });
    console.log(`\n[L5-08 CONTRAST] ${JSON.stringify(contrastChecks).slice(0, 800)}`);

    contrastChecks.forEach(c => {
      if (!c.found) return;
      const ratio = contrastRatio(c.fg, c.bg);
      if (ratio === null) return;
      const isLarge = parseFloat(c.fontSize) >= 18 || (parseFloat(c.fontSize) >= 14 && parseInt(c.fontWeight) >= 700);
      const threshold = isLarge ? 3.0 : 4.5;
      if (ratio < threshold) {
        addFinding('Contrast', ratio < 3 ? 'High' : 'Medium',
          `${c.name}: text/background contrast is ${ratio.toFixed(2)}:1 (WCAG AA requires ${threshold}:1${isLarge ? ' for large text' : ''}). fg=${c.fg} on bg=${c.bg}`,
          shotCal,
          `Darken the text color for ${c.name} to reach at least ${threshold}:1 contrast.`);
      }
    });

    // Contacts + preferences link contrast
    await page.goto(`${BASE_URL}/preferences`);
    await page.waitForTimeout(1000);
    const shotPrefs = await takeScreenshot(page, 'L5-08b-preferences-contrast');
    const prefContrast = await page.evaluate(() => {
      const results = [];
      const els = document.querySelectorAll('#prefs_form label, #prefs_form select, .preferences-container h1, h2');
      els.forEach((el, i) => {
        if (i > 8) return;
        const s = window.getComputedStyle(el);
        let bg = null;
        let node = el;
        for (let j = 0; j < 6 && node; j++) {
          const bs = window.getComputedStyle(node);
          if (bs.backgroundColor && bs.backgroundColor !== 'rgba(0, 0, 0, 0)' && bs.backgroundColor !== 'transparent') { bg = bs.backgroundColor; break; }
          node = node.parentElement;
        }
        if (!bg) bg = 'rgb(255, 255, 255)';
        results.push({ text: el.textContent.trim().slice(0, 20), fg: s.color, bg, fontSize: s.fontSize });
      });
      return results;
    });
    prefContrast.forEach(c => {
      const ratio = contrastRatio(c.fg, c.bg);
      if (ratio !== null && ratio < 4.5) {
        addFinding('Contrast', ratio < 3 ? 'High' : 'Medium',
          `Preferences "${c.text}": contrast ${ratio.toFixed(2)}:1 (fg=${c.fg} on bg=${c.bg})`,
          shotPrefs, 'Improve text contrast on preferences labels.');
      }
    });

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 9. LOADING / EMPTY STATES =============
  test('L5-09 - Loading and empty states (no events, no contacts, no mail)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);

    // Loading spinner in navbar
    const shotLoading = await takeScreenshot(page, 'L5-09a-loading');
    const loadingInfo = await page.evaluate(() => {
      const loading = document.getElementById('loading');
      const spinner = document.querySelector('.navbar-spinner');
      return {
        loadingPresent: !!loading,
        spinnerPresent: !!spinner,
        spinnerVisible: spinner ? spinner.getBoundingClientRect().width > 0 : false,
      };
    });
    console.log(`\n[L5-09 LOADING] ${JSON.stringify(loadingInfo)}`);
    if (!loadingInfo.loadingPresent) {
      addFinding('Loading states', 'Low',
        'No #loading indicator in the navbar',
        shotLoading, 'Keep <p id="loading"> with a spinner for async operations.');
    }

    // Calendar empty state (navigate to a far-future week with no events)
    await gotoToday(page);
    const nextBtn = page.locator('.fc-next-button, .fc-button:has-text("next")').first();
    for (let i = 0; i < 12; i++) {
      await nextBtn.click().catch(() => {});
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(1000);
    const shotEmptyCal = await takeScreenshot(page, 'L5-09b-empty-calendar');
    const emptyCalInfo = await page.evaluate(() => {
      const events = document.querySelectorAll('#calendar_view .fc-event').length;
      const errorToast = document.querySelector('.freeow');
      return { eventCount: events, hasErrorToast: !!errorToast, errorText: errorToast ? errorToast.textContent.trim().slice(0, 60) : null };
    });
    console.log(`[L5-09 EMPTY CAL] ${JSON.stringify(emptyCalInfo)}`);
    if (emptyCalInfo.hasErrorToast && /error|fail/i.test(emptyCalInfo.errorText || '')) {
      addFinding('Loading states', 'Medium',
        `Calendar shows an error toast in empty state: "${emptyCalInfo.errorText}"`,
        shotEmptyCal, 'Suppress error toasts when no events exist (empty != error).');
    }

    // Contacts empty state - if no contacts, check the empty message
    await page.goto(`${BASE_URL}/cards`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    const shotContacts = await takeScreenshot(page, 'L5-09c-contacts-state');
    const contactsInfo = await page.evaluate(() => {
      const rows = document.querySelectorAll('#contacts_list .contact-row, #contacts_rows .contact-row, #contacts_cards .contact-card').length;
      const emptyMsg = document.querySelector('#contacts_empty, .contacts-empty, .no-contacts');
      return {
        contactCount: rows,
        hasEmptyMsg: !!emptyMsg,
        emptyMsgText: emptyMsg ? emptyMsg.textContent.trim().slice(0, 80) : null,
        emptyMsgVisible: emptyMsg ? emptyMsg.getBoundingClientRect().width > 0 : false,
      };
    });
    console.log(`[L5-09 CONTACTS] ${JSON.stringify(contactsInfo)}`);
    if (contactsInfo.contactCount === 0 && (!contactsInfo.hasEmptyMsg || !contactsInfo.emptyMsgVisible)) {
      addFinding('Empty states', 'Medium',
        'Contacts page shows no contacts and no visible empty-state message',
        shotContacts, 'Add a #contacts_empty message like "No contacts yet. Create one."');
    }

    // Mail empty state
    await page.goto(`${BASE_URL}/mail`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2500);
    const shotMail = await takeScreenshot(page, 'L5-09d-mail-state');
    const mailInfo = await page.evaluate(() => {
      const rows = document.querySelectorAll('#mail_rows .mail-row').length;
      const empty = document.querySelector('#mail_no_messages, #mail_empty, .mail-empty');
      const loading = document.querySelector('#mail_loading');
      return {
        messageCount: rows,
        hasEmptyMsg: !!empty,
        emptyVisible: empty ? empty.getBoundingClientRect().width > 0 : false,
        emptyText: empty ? empty.textContent.trim().slice(0, 80) : null,
        hasLoading: !!loading,
        loadingVisible: loading ? !loading.hidden && loading.getBoundingClientRect().width > 0 : false,
      };
    });
    console.log(`[L5-09 MAIL] ${JSON.stringify(mailInfo)}`);
    if (mailInfo.messageCount === 0 && !mailInfo.hasEmptyMsg && !mailInfo.loadingVisible) {
      addFinding('Empty states', 'Medium',
        'Mail inbox shows no messages and no empty/loading indicator',
        shotMail, 'Show #mail_no_messages or #mail_loading when the inbox is empty.');
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 10. FORM VALIDATION =============
  test('L5-10 - Form validation (login empty submit, contact required fields)', async ({ page, browser }) => {
    const messages = collectConsoleMessages(page);

    // 10a. Login with empty fields (fresh context to avoid session)
    const ctx = await browser.newContext();
    const loginPage = await ctx.newPage();
    await loginPage.setViewportSize({ width: 1280, height: 800 });
    await loginPage.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    const loginShot1 = await loginPage.screenshot({ path: `${SCREENSHOT_DIR}/L5-10a-login-before.png`, fullPage: true });

    // Submit empty
    await loginPage.locator('input[name="login"]').click();
    await loginPage.waitForTimeout(1500);
    const loginShot2 = await loginPage.screenshot({ path: `${SCREENSHOT_DIR}/L5-10b-login-empty-submit.png`, fullPage: true });
    const loginValidation = await loginPage.evaluate(() => {
      const stillOnLogin = /\/login/.test(location.pathname);
      const alert = document.querySelector('.alert, .alert-danger, .flash-error');
      const html5Valid = document.querySelector('input[name="user"]:invalid, input[name="password"]:invalid');
      // Browser native validation popup can't be detected, but :invalid pseudo or alert can
      return {
        stillOnLogin,
        hasAlert: !!alert,
        alertText: alert ? alert.textContent.trim().slice(0, 100) : null,
        hasHtml5Invalid: !!html5Valid,
      };
    });
    console.log(`\n[L5-10 LOGIN EMPTY] ${JSON.stringify(loginValidation)}`);
    if (loginValidation.stillOnLogin && !loginValidation.hasAlert && !loginValidation.hasHtml5Invalid) {
      addFinding('Form validation', 'Medium',
        'Submitting the login form with empty fields shows no visible error or validation message',
        loginShot2,
        'Add required attribute to user/password inputs (HTML5 validation) or a server-side .alert-danger on empty submit.');
    }

    // 10b. Contact form required fields
    await loginPage.locator('input[name="user"]').fill(USERNAME);
    await loginPage.locator('input[name="password"]').fill(PASSWORD);
    await loginPage.locator('input[name="login"]').click();
    await loginPage.waitForFunction(() => !!(window.jQuery && window.translations), { timeout: 20000 }).catch(() => {});
    await loginPage.goto(`${BASE_URL}/cards`);
    await loginPage.waitForTimeout(2000);

    // Try to save a contact with empty name
    const contactSaveBtn = loginPage.locator('#contact_save, button[type="submit"]#contact_save').first();
    const formPresent = await loginPage.locator('#contact_form').count();
    if (formPresent > 0) {
      const contactShot = await loginPage.screenshot({ path: `${SCREENSHOT_DIR}/L5-10c-contact-empty.png`, fullPage: true });
      const reqInfo = await loginPage.evaluate(() => {
        const form = document.getElementById('contact_form');
        const inputs = form ? form.querySelectorAll('input[name="full_name"], input[name="email"], input[name="phone"]') : [];
        return {
          hasRequiredAttr: Array.from(inputs).some(i => i.hasAttribute('required')),
          requiredCount: Array.from(inputs).filter(i => i.hasAttribute('required')).length,
        };
      });
      console.log(`[L5-10 CONTACT] ${JSON.stringify(reqInfo)}`);
      if (!reqInfo.hasRequiredAttr) {
        addFinding('Form validation', 'Low',
          'Contact form has no required attribute on name/email/phone fields',
          contactShot, 'Add the `required` attribute to full_name (at minimum) so the browser enforces it.');
      }
    }
    await ctx.close();

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 11. CSS SPECIFICITY / INLINE STYLES / !IMPORTANT =============
  test('L5-11 - CSS specificity (inline styles, !important usage, overrides)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.waitForTimeout(1000);
    const shot = await takeScreenshot(page, 'L5-11a-css-audit');

    const cssAudit = await page.evaluate(() => {
      // Count inline style attributes on key elements
      const inlineStyleEls = [];
      const containers = document.querySelectorAll('#sidebar, #calendar_view, #content, .navbar, #usermenu, #contacts_list, #mail_rows, #event_edit_dialog');
      containers.forEach(c => {
        c.querySelectorAll('*').forEach(el => {
          if (el.hasAttribute('style') && el.getAttribute('style').trim().length > 0) {
            inlineStyleEls.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 30), style: el.getAttribute('style').slice(0, 60) });
          }
        });
      });
      // Count !important rules in stylesheets
      let importantCount = 0;
      let importantSamples = [];
      let totalRules = 0;
      for (const sheet of document.styleSheets) {
        try {
          const walk = rules => {
            for (const rule of rules) {
              if (rule instanceof CSSMediaRule || rule instanceof CSSStyleRule === false && rule.cssRules) {
                walk(rule.cssRules);
                continue;
              }
              if (rule instanceof CSSStyleRule) {
                totalRules++;
                const css = rule.cssText || '';
                const imps = (css.match(/!important/gi) || []).length;
                if (imps > 0) {
                  importantCount += imps;
                  if (importantSamples.length < 6) importantSamples.push(rule.selectorText.slice(0, 60));
                }
              }
            }
          };
          walk(sheet.cssRules || []);
        } catch (e) { /* cross-origin */ }
      }
      return {
        inlineStyleCount: inlineStyleEls.length,
        inlineStyleSamples: inlineStyleEls.slice(0, 6),
        importantCount,
        importantSamples,
        totalRules,
      };
    });
    console.log(`\n[L5-11 CSS] ${JSON.stringify(cssAudit).slice(0, 700)}`);

    if (cssAudit.inlineStyleCount > 20) {
      addFinding('CSS', 'Medium',
        `${cssAudit.inlineStyleCount} elements use inline style attributes (specificity wars risk). Samples: ${JSON.stringify(cssAudit.inlineStyleSamples.slice(0, 3))}`,
        shot, 'Move inline styles into classes to keep cascade predictable.');
    }
    // !important is common in vendored CSS (bootstrap, fullcalendar) so only
    // flag if extremely high relative to rules.
    if (cssAudit.totalRules > 0 && cssAudit.importantCount / cssAudit.totalRules > 0.15) {
      addFinding('CSS', 'Low',
        `${cssAudit.importantCount} !important declarations across ${cssAudit.totalRules} rules (${Math.round(cssAudit.importantCount / cssAudit.totalRules * 100)}%) suggests specificity conflicts`,
        shot, 'Reduce reliance on !important by using more specific selectors or BEM-style classes.');
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 12. MOBILE CALENDAR EVENT DISPLAY + BOTTOM BAR + FAB =============
  test('L5-12 - Mobile calendar event display + bottom bar + FAB (375px)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.waitForTimeout(2500);
    const shot = await takeScreenshot(page, 'L5-12a-mobile-calendar');

    // Bottom bar (regression check from L4)
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
    console.log(`\n[L5-12 BOTTOM BAR] ${JSON.stringify(barInfo)}`);

    if (!barInfo.found) {
      addFinding('Calendar (mobile)', 'High',
        'Mobile bottom bar (#mobile_bottom_bar) is missing (regression)',
        shot, 'Render #mobile_bottom_bar in the calendar page template.');
    } else if (barInfo.hiddenAttr || barInfo.display === 'none') {
      addFinding('Calendar (mobile)', 'High',
        'Mobile bottom bar is hidden at 375px (regression)',
        shot, 'Ensure mobile.js reveals #mobile_bottom_bar at narrow widths.');
    } else {
      barInfo.buttonSizes.forEach(b => {
        if (b.w < MIN_TOUCH || b.h < MIN_TOUCH) {
          addFinding('Calendar (mobile)', 'Medium',
            `Bottom bar button "${b.action}" is ${b.w}x${b.h}px (below ${MIN_TOUCH}px)`,
            shot, 'Set .mobile-bottom-btn min-width/min-height 44px.');
        }
        if (!b.ariaLabel) {
          addFinding('Calendar (mobile)', 'Medium',
            `Bottom bar button "${b.action}" missing aria-label`,
            shot, `Add aria-label to the ${b.action} button.`);
        }
      });
      // Verify it doesn't overlap content
      const overlapInfo = await page.evaluate(() => {
        const bar = document.getElementById('mobile_bottom_bar');
        const content = document.getElementById('content');
        if (!bar || !content) return null;
        const br = bar.getBoundingClientRect();
        const cr = content.getBoundingClientRect();
        return {
          barTop: Math.round(br.top),
          contentBottom: Math.round(cr.bottom),
          contentPaddingBottom: window.getComputedStyle(content).paddingBottom,
        };
      });
      console.log(`[L5-12 OVERLAP] ${JSON.stringify(overlapInfo)}`);
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
        zIndex: s.zIndex,
      };
    });
    console.log(`[L5-12 FAB] ${JSON.stringify(fabInfo)}`);

    if (!fabInfo.found) {
      addFinding('Calendar (mobile)', 'High',
        'Mobile FAB (#mobile_fab_add) is missing (regression)',
        shot, 'Render #mobile_fab_add in the calendar template.');
    } else if (fabInfo.hiddenAttr || fabInfo.display === 'none') {
      addFinding('Calendar (mobile)', 'High',
        'Mobile FAB is hidden at 375px (regression)',
        shot, 'Ensure wireFab() reveals #mobile_fab_add on mobile.');
    } else {
      if (fabInfo.width < MIN_TOUCH || fabInfo.height < MIN_TOUCH) {
        addFinding('Calendar (mobile)', 'Medium',
          `Mobile FAB is ${fabInfo.width}x${fabInfo.height}px (below ${MIN_TOUCH}px)`,
          shot, 'Set .mobile-fab width/height to >=56px.');
      }
      if (!fabInfo.ariaLabel) {
        addFinding('Calendar (mobile)', 'Medium',
          'Mobile FAB missing aria-label',
          shot, 'Add aria-label="Create event" to #mobile_fab_add.');
      }
    }

    // Event readability on mobile - check event tap target size
    const eventMobileInfo = await page.evaluate(() => {
      const events = document.querySelectorAll('#calendar_view .fc-time-grid-event, #calendar_view .fc-day-grid-event, #calendar_view .fc-event, #mobile_event_list .mobile-event');
      return Array.from(events).slice(0, 5).map(e => {
        const r = e.getBoundingClientRect();
        const s = window.getComputedStyle(e);
        return { text: (e.textContent || '').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height), color: s.color, bg: s.backgroundColor, fontSize: s.fontSize };
      });
    });
    console.log(`[L5-12 EVENTS] ${JSON.stringify(eventMobileInfo)}`);
    eventMobileInfo.forEach((e, i) => {
      if (e.h < 28 || e.w < 28) {
        addFinding('Calendar (mobile)', 'Medium',
          `Mobile event #${i + 1} "${e.text}" is only ${e.w}x${e.h}px (too small to tap/read)`,
          shot, 'Ensure events render at minimum ~44px height or switch to a list view on mobile.');
      }
      const ratio = contrastRatio(e.color, e.bg);
      if (ratio !== null && ratio < 3.0) {
        addFinding('Calendar (mobile)', 'Medium',
          `Mobile event "${e.text}" contrast ${ratio.toFixed(2)}:1 (fg=${e.color} on bg=${e.bg})`,
          shot, 'Improve event text/background contrast.');
      }
    });

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= SUMMARY =============
  test('L5-13 - Summary: write findings report', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    console.log('\n\n========================================================');
    console.log('  CALDAVER LOOP 5 DEEP UI AUDIT - FINDINGS REPORT');
    console.log('========================================================\n');
    console.log(`Total findings: ${findings.length}\n`);

    const sorted = [...findings].sort((a, b) => (SEVERITY_ORDER[a.severity] || 99) - (SEVERITY_ORDER[b.severity] || 99));

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
      bySeverity: {},
    };
    for (const f of findings) {
      summary.byPage[f.page] = (summary.byPage[f.page] || 0) + 1;
      summary.bySeverity[f.severity] = (summary.bySeverity[f.severity] || 0) + 1;
    }

    console.log('--- SUMMARY ---');
    console.log(JSON.stringify(summary, null, 2));

    fs.writeFileSync(`${SCREENSHOT_DIR}/loop5-findings.json`, JSON.stringify({ findings: sorted, summary }, null, 2));
    expect(findings.length).toBeGreaterThanOrEqual(0);
  });
});
