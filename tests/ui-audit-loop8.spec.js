/**
 * Caldaver Loop 8 - Final Polish & Cross-Page Consistency Audit.
 *
 * Previous rounds already fixed:
 *   R1: i18n strings, mobile 44px touch targets, a11y labels
 *   R2: Calendar grid lines (1px #dadce0), dotted minor time slots
 *   R3: Today button, contact phone links 44px, radio inputs 24px
 *   R4: Keyboard shortcuts, focus trap, qtip ARIA, 404 page, mobile
 *       bottom bar + FAB, mail reply button 44px
 *   R5: Timezone dropdown, pseudobutton contrast, event create flow
 *   R6: Contact dialog a11y, search input heights, print CSS, skip link
 *   R7: Calendar title centering, sidebar borders, card a11y, card hover,
 *       toolbar alignment, login toggle/contrast, skip-link tab order, etc.
 *
 * This loop audits the remaining deep-polish areas:
 *   L8-01 Calendar week view (title center, grid lines, now indicator)
 *   L8-02 Calendar month view (title center, cell heights, today, weekend)
 *   L8-03 Preferences page layout (fieldset, spacing, radios, save/return)
 *   L8-04 Mail page empty state (message, compose, account list)
 *   L8-05 Contacts list view (table headers, row hover, count)
 *   L8-06 Mobile calendar list view @ 375px (events, title, bottom bar)
 *   L8-07 Mobile contacts @ 375px (layout, search, readability)
 *   L8-08 Cross-page consistency (navbar, headings, buttons)
 *   L8-09 Accessibility deep check (headings, landmarks, contrast, labels)
 *   L8-10 Error handling (404, loading spinners, network states)
 *   L8-11 Summary report
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');

const BASE_URL = process.env.CALDAVER_BASE_URL || 'http://localhost:8080';
const USERNAME = process.env.CALDAVER_USERNAME;
const PASSWORD = process.env.CALDAVER_PASSWORD;
const SCREENSHOT_DIR = '/tmp/caldaver-audit-loop8';
const MIN_TOUCH = 44;

const findings = [];
const SEVERITY_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };

function addFinding(page, severity, description, screenshotPath, recommendation) {
  findings.push({
    id: `L8-${String(findings.length + 1).padStart(3, '0')}`,
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

async function takeClipScreenshot(page, name, clip) {
  const path = `${SCREENSHOT_DIR}/${name}.png`;
  await page.screenshot({ path, clip });
  return path;
}

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
      await page.waitForTimeout(2000);
    }
  }
  await page.locator('input[name="user"]').fill(USERNAME);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('input[name="login"]').click();
  await expect(page.locator('#calendar_view')).toBeVisible({ timeout: 30000 });
  await page.waitForFunction(() => {
    return !!(window.jQuery && window.translations && window.CaldaverConf && window.CaldaverConf.i18n);
  }, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

async function gotoToday(page) {
  const todayBtn = page.locator('.fc-today-button, .fc-button:has-text("today"), .fc-button:has-text("Today")').first();
  if (await todayBtn.isVisible().catch(() => false)) {
    if (!(await todayBtn.isDisabled().catch(() => false))) {
      await todayBtn.click().catch(() => {});
      await page.waitForTimeout(800);
    }
  }
}

async function switchToView(page, viewName) {
  // FullCalendar v3 uses ui-button (not fc-button) and the view classes are
  // agendaWeek / agendaDay / month / customizable_list. Map friendly names.
  const clsMap = { week: 'agendaWeek', day: 'agendaDay', month: 'month', list: 'customizable_list' };
  const viewCls = clsMap[viewName] || viewName;
  const btn = page.locator(
    `.fc-${viewCls}-button, .fc-${viewName}-button, .ui-button:has-text("${viewName}"), .ui-button:has-text("${viewName.charAt(0).toUpperCase() + viewName.slice(1)}")`
  ).first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(1500);
    return true;
  }
  return false;
}

test.describe('Caldaver Loop 8 Final Polish & Cross-Page Consistency Audit', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  test.setTimeout(300000);

  // ============= 1. CALENDAR WEEK VIEW VISUAL =============
  test('L8-01 - Calendar week view (title center, grid lines, now indicator)', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await gotoToday(page);
    await switchToView(page, 'week');
    await page.waitForTimeout(1500);
    const shot = await takeScreenshot(page, 'L8-01a-week-view');

    const weekInfo = await page.evaluate(() => {
      const toolbar = document.querySelector('.fc-toolbar');
      const titleEl = toolbar ? toolbar.querySelector('h2, .fc-center h2') : null;
      const timeGrid = document.querySelector('.fc-time-grid');
      const slats = document.querySelectorAll('.fc-slats .fc-minor td, .fc-slats td');
      const nowLine = document.querySelector('.fc-now-indicator-line, .fc-now-indicator');
      const nowArrow = document.querySelector('.fc-now-indicator-arrow');
      const allDayRow = document.querySelector('.fc-day-grid');

      const cs = el => el ? window.getComputedStyle(el) : null;

      // Title centering
      let titleOffset = null;
      if (titleEl && toolbar) {
        const tr = titleEl.getBoundingClientRect();
        const tbr = toolbar.getBoundingClientRect();
        const titleCenter = tr.x + tr.width / 2;
        const refCenter = tbr.x + tbr.width / 2;
        titleOffset = Math.round(titleCenter - refCenter);
      }

      // Grid line visibility: check that time-grid cells have a visible top border
      let gridLineSample = null;
      if (slats.length > 1) {
        const s = window.getComputedStyle(slats[1]);
        gridLineSample = { borderTop: s.borderTop, borderTopColor: s.borderTopColor, borderTopStyle: s.borderTopStyle };
      }

      // Now indicator: color and presence
      let nowInfo = null;
      const nowEl = nowLine || nowArrow;
      if (nowEl) {
        const s = window.getComputedStyle(nowEl);
        const r = nowEl.getBoundingClientRect();
        nowInfo = {
          present: true,
          borderColor: s.borderColor || s.borderTopColor,
          borderTopColor: s.borderTopColor,
          width: Math.round(r.width),
          height: Math.round(r.height),
          display: s.display,
          visibility: s.visibility,
        };
      } else {
        nowInfo = { present: false };
      }

      // Check the view name is actually agendaWeek
      const weekActive = !!document.querySelector('.fc-agendaWeek-view');

      // Time slot count (rows)
      const timeLabels = document.querySelectorAll('.fc-slats .fc-axis');
      const hourCount = Array.from(timeLabels).filter(l => /\d/.test(l.textContent)).length;

      return {
        toolbarPresent: !!toolbar,
        titleText: titleEl ? titleEl.textContent.trim().slice(0, 40) : null,
        titleOffset,
        timeGridPresent: !!timeGrid,
        slatCount: slats.length,
        gridLineSample,
        weekActive,
        hourCount,
        nowInfo,
        allDayRowPresent: !!allDayRow,
      };
    });
    console.log(`\n[L8-01 WEEK] ${JSON.stringify(weekInfo).slice(0, 1200)}`);

    // View switched
    if (!weekInfo.weekActive) {
      addFinding('Calendar week view', 'High',
        'Week view (agendaWeek) is not active after clicking the week view button', shot,
        'Ensure the FullCalendar view switch wires to agendaWeek.');
    }

    // Title centering
    if (weekInfo.titleOffset !== null && Math.abs(weekInfo.titleOffset) > 20) {
      addFinding('Calendar week view', 'Medium',
        `Week view title is off-center by ${weekInfo.titleOffset}px`, shot,
        'Centre the .fc-center h2 in the week-view toolbar.');
    }

    // Grid lines
    if (!weekInfo.timeGridPresent) {
      addFinding('Calendar week view', 'High',
        'Time grid (.fc-time-grid) is not present in week view', shot,
        'Ensure FullCalendar renders the agenda time grid.');
    } else if (weekInfo.gridLineSample && weekInfo.gridLineSample.borderTopStyle === 'none') {
      addFinding('Calendar week view', 'Medium',
        'Week-view time-grid horizontal lines are hidden (border-top: none)', shot,
        'Restore border-top on .fc-slats td so time slots have visible separators.');
    } else if (weekInfo.slatCount < 10) {
      addFinding('Calendar week view', 'Low',
        `Week view has only ${weekInfo.slatCount} time-slot rows (expected ~48 half-hour slots)`, shot,
        'Verify the minTime/maxTime/slotDuration config.');
    }

    // Now indicator (only check if today is within the current week range - it should be after "Today" click)
    if (!weekInfo.nowInfo.present) {
      // The now-indicator requires the show_now_indicator pref to be true
      addFinding('Calendar week view', 'Low',
        'Now indicator line not visible in week view (may be disabled in preferences or current week out of range)', shot,
        'If show_now_indicator pref is true, ensure the week is scrolled to the current time and the now-indicator renders.');
    } else if (weekInfo.nowInfo.borderTopColor === 'rgb(255, 0, 0)' || /255,\s*0,\s*0/.test(weekInfo.nowInfo.borderColor || '')) {
      // Default red is fine but let's note it
      console.log('[L8-01] Now indicator is default red (acceptable).');
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
    await ctx.close();
  });

  // ============= 2. CALENDAR MONTH VIEW VISUAL =============
  test('L8-02 - Calendar month view (title center, cell heights, today, weekend)', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await gotoToday(page);
    await switchToView(page, 'month');
    await page.waitForTimeout(1500);
    const shot = await takeScreenshot(page, 'L8-02a-month-view');

    const monthInfo = await page.evaluate(() => {
      const today = new Date();
      const y = today.getFullYear();
      const m = today.getMonth();
      const d = today.getDate();
      const isoToday = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

      const toolbar = document.querySelector('.fc-toolbar');
      const titleEl = toolbar ? toolbar.querySelector('h2, .fc-center h2') : null;
      const monthView = document.querySelector('.fc-month-view');
      const dayCells = document.querySelectorAll('.fc-day-grid .fc-day, .fc-day-top');
      const todayCell = document.querySelector(`.fc-day-top[data-date="${isoToday}"], td.fc-today`);
      const weekendCells = document.querySelectorAll('.fc-sun, .fc-sat');

      let titleOffset = null;
      if (titleEl && toolbar) {
        const tr = titleEl.getBoundingClientRect();
        const tbr = toolbar.getBoundingClientRect();
        titleOffset = Math.round((tr.x + tr.width / 2) - (tbr.x + tbr.width / 2));
      }

      // Today highlight
      const todayEl = document.querySelector('.fc-today, .fc-state-highlight');
      let todayInfo = null;
      if (todayEl) {
        const s = window.getComputedStyle(todayEl);
        todayInfo = { bg: s.backgroundColor, hasTodayClass: todayEl.classList.contains('fc-today') };
      }

      // Weekend shading
      let weekendInfo = null;
      if (weekendCells.length > 0) {
        const s = window.getComputedStyle(weekendCells[0]);
        weekendInfo = { bg: s.backgroundColor, count: weekendCells.length };
      }

      // Day cell heights - measure a week row
      const weekRows = document.querySelectorAll('.fc-day-grid .fc-week');
      let rowHeight = null;
      if (weekRows.length > 0) {
        rowHeight = Math.round(weekRows[0].getBoundingClientRect().height);
      }

      // Number of date cells
      const dateNumbers = document.querySelectorAll('.fc-day-number, .fc-day-top');

      return {
        toolbarPresent: !!toolbar,
        titleText: titleEl ? titleEl.textContent.trim().slice(0, 40) : null,
        titleOffset,
        monthViewPresent: !!monthView,
        weekRowCount: weekRows.length,
        rowHeight,
        dateCellCount: dateNumbers.length,
        todayInfo,
        weekendInfo,
        dayCellCount: dayCells.length,
      };
    });
    console.log(`\n[L8-02 MONTH] ${JSON.stringify(monthInfo).slice(0, 1200)}`);

    if (!monthInfo.monthViewPresent) {
      addFinding('Calendar month view', 'High',
        'Month view (.fc-month-view) is not active after selecting month', shot,
        'Ensure the month view button switches FullCalendar to basicWeek/month.');
    }

    // Title centering
    if (monthInfo.titleOffset !== null && Math.abs(monthInfo.titleOffset) > 20) {
      addFinding('Calendar month view', 'Medium',
        `Month view title is off-center by ${monthInfo.titleOffset}px`, shot,
        'Centre the .fc-center h2 in the month-view toolbar.');
    }

    // Today highlight
    if (!monthInfo.todayInfo) {
      addFinding('Calendar month view', 'Medium',
        'Today\'s date cell has no .fc-today highlight class', shot,
        'Ensure FullCalendar highlights today with .fc-today / background colour.');
    }

    // Weekend shading
    if (monthInfo.weekendInfo) {
      const ratio = contrastRatio('rgb(32, 33, 36)', monthInfo.weekendInfo.bg);
      // Weekend shading should differ from weekday - check against a weekday cell
      const weekdayCheck = await page.evaluate(() => {
        const weekday = document.querySelector('.fc-mon, .fc-tue, .fc-wed, .fc-thu, .fc-fri');
        const weekend = document.querySelector('.fc-sun, .fc-sat');
        if (!weekday || !weekend) return null;
        return {
          weekdayBg: window.getComputedStyle(weekday).backgroundColor,
          weekendBg: window.getComputedStyle(weekend).backgroundColor,
        };
      });
      if (weekdayCheck && weekdayCheck.weekdayBg === weekdayCheck.weekendBg) {
        addFinding('Calendar month view', 'Low',
          'Weekend cells have the same background as weekday cells (no weekend shading)', shot,
          'Add a subtle background tint to .fc-sun/.fc-sat in month view.');
      }
    }

    // Row height (cells too short)
    if (monthInfo.rowHeight !== null && monthInfo.rowHeight < 80) {
      addFinding('Calendar month view', 'Medium',
        `Month-view week rows are only ${monthInfo.rowHeight}px tall (too short for events)`, shot,
        'Increase the month-view row min-height (e.g. aspectRatio or contentHeight).');
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
    await ctx.close();
  });

  // ============= 3. PREFERENCES PAGE LAYOUT =============
  test('L8-03 - Preferences page layout (fieldset, spacing, radios, save, return)', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.goto(`${BASE_URL}/preferences`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const shot = await takeScreenshot(page, 'L8-03a-preferences');

    const prefsInfo = await page.evaluate(() => {
      const form = document.getElementById('prefs_form');
      const container = document.querySelector('.preferences-container');
      const fieldsets = document.querySelectorAll('.prefs-section');
      const legends = document.querySelectorAll('.prefs-section legend');
      const radioGroups = document.querySelectorAll('.prefs-radio-group');
      const helpBlocks = document.querySelectorAll('.help-block');
      const saveBtn = document.querySelector('#prefs_buttons .btn-success, #prefs_buttons button[type="submit"]');
      const returnLink = document.getElementById('return_button');
      const accountsSection = document.querySelector('.prefs-accounts-section');
      const addAccountBtn = document.getElementById('mail_account_create');
      const connectedList = document.getElementById('connected_accounts');
      const connectedEmpty = document.getElementById('connected_accounts_empty');
      const timezoneSelect = document.getElementById('timezone');

      const cs = el => el ? (() => {
        const s = window.getComputedStyle(el);
        return {
          border: s.border, borderTop: s.borderTop, margin: s.margin, marginBottom: s.marginBottom,
          padding: s.padding, bg: s.backgroundColor, radius: s.borderRadius,
        };
      })() : null;

      // Fieldset border consistency
      const fsBorders = Array.from(fieldsets).map(f => {
        const s = window.getComputedStyle(f);
        return { borderTop: s.borderTopWidth + ' ' + s.borderTopStyle, radius: s.borderRadius };
      });
      const allSameTopBorder = fsBorders.length > 0 ? fsBorders.every(b => b.borderTop === fsBorders[0].borderTop) : true;

      // Gaps between fieldsets
      const fsGaps = [];
      for (let i = 0; i < fieldsets.length - 1; i++) {
        const a = fieldsets[i].getBoundingClientRect();
        const b = fieldsets[i + 1].getBoundingClientRect();
        fsGaps.push(Math.round(b.top - a.bottom));
      }
      const gapSpread = fsGaps.length ? Math.max(...fsGaps) - Math.min(...fsGaps) : 0;

      // Form-group vertical spacing consistency within first fieldset
      const firstFs = fieldsets[0];
      const groups = firstFs ? firstFs.querySelectorAll(':scope > .form-group') : [];
      const groupGaps = [];
      for (let i = 0; i < groups.length - 1; i++) {
        const a = groups[i].getBoundingClientRect();
        const b = groups[i + 1].getBoundingClientRect();
        groupGaps.push(Math.round(b.top - a.bottom));
      }
      const groupGapSpread = groupGaps.length ? Math.max(...groupGaps) - Math.min(...groupGaps) : 0;

      // Radio group: label association + input size
      let radioSample = null;
      if (radioGroups.length > 0) {
        const rg = radioGroups[0];
        const labelledBy = rg.getAttribute('aria-labelledby');
        const labelEl = labelledBy ? document.getElementById(labelledBy) : null;
        const input = rg.querySelector('input[type="radio"]');
        const inputS = input ? window.getComputedStyle(input) : null;
        const inputR = input ? input.getBoundingClientRect() : null;
        radioSample = {
          hasRadiogroupRole: rg.getAttribute('role') === 'radiogroup',
          hasLabelledby: !!labelledBy,
          labelPresent: !!labelEl,
          labelText: labelEl ? labelEl.textContent.trim().slice(0, 30) : null,
          inputW: inputR ? Math.round(inputR.width) : null,
          inputH: inputR ? Math.round(inputR.height) : null,
        };
      }

      // Label-input association: check a sample <label for=...>
      const labels = Array.from(document.querySelectorAll('.prefs-section label[for]'));
      const orphanLabels = labels.filter(l => {
        const target = document.getElementById(l.getAttribute('for'));
        return !target;
      });

      // Save button + return link
      const saveR = saveBtn ? saveBtn.getBoundingClientRect() : null;
      const returnR = returnLink ? returnLink.getBoundingClientRect() : null;

      return {
        formPresent: !!form,
        containerPresent: !!container,
        fieldsetCount: fieldsets.length,
        legendCount: legends.length,
        legendTexts: Array.from(legends).map(l => l.textContent.trim().slice(0, 25)),
        fsBorders,
        allSameTopBorder,
        fsGaps,
        gapSpread,
        groupGapSpread,
        radioGroupCount: radioGroups.length,
        radioSample,
        helpBlockCount: helpBlocks.length,
        savePresent: !!saveBtn,
        saveW: saveR ? Math.round(saveR.width) : null,
        saveH: saveR ? Math.round(saveR.height) : null,
        returnPresent: !!returnLink,
        returnW: returnR ? Math.round(returnR.width) : null,
        accountsSectionPresent: !!accountsSection,
        addAccountBtnPresent: !!addAccountBtn,
        connectedListPresent: !!connectedList,
        connectedEmptyPresent: !!connectedEmpty,
        timezonePresent: !!timezoneSelect,
        orphanLabelCount: orphanLabels.length,
      };
    });
    console.log(`\n[L8-03 PREFERENCES] ${JSON.stringify(prefsInfo).slice(0, 1400)}`);

    if (!prefsInfo.formPresent) {
      addFinding('Preferences', 'High', 'Preferences form (#prefs_form) is missing', shot, 'Render the preferences form.');
    }

    // Fieldset count (expect general + calendars + accounts = 3)
    if (prefsInfo.fieldsetCount < 2) {
      addFinding('Preferences', 'Medium',
        `Only ${prefsInfo.fieldsetCount} fieldset section(s) rendered (expected at least General + Calendars)`, shot,
        'Ensure both .prefs-section fieldsets render in preferences.html.');
    }

    // Fieldset border consistency
    if (prefsInfo.fieldsetCount > 1 && !prefsInfo.allSameTopBorder) {
      addFinding('Preferences', 'Low',
        'Preferences fieldsets have inconsistent top borders', shot,
        'Apply a uniform border-top to all .prefs-section.');
    }

    // Gap consistency
    if (prefsInfo.fsGaps.length >= 2 && prefsInfo.gapSpread > 8) {
      addFinding('Preferences', 'Medium',
        `Gaps between preferences fieldsets are inconsistent: [${prefsInfo.fsGaps.join(', ')}]px`, shot,
        'Standardise margin between .prefs-section elements.');
    }

    // Form-group spacing
    if (prefsInfo.groupGapSpread > 12) {
      addFinding('Preferences', 'Low',
        `Vertical spacing between form-groups varies by ${prefsInfo.groupGapSpread}px`, shot,
        'Standardise .form-group margin-bottom in preferences.');
    }

    // Radio groups a11y
    if (prefsInfo.radioSample) {
      if (!prefsInfo.radioSample.hasRadiogroupRole) {
        addFinding('Preferences', 'Medium',
          'Radio group missing role="radiogroup"', shot, 'Add role="radiogroup" to .prefs-radio-group.');
      }
      if (!prefsInfo.radioSample.hasLabelledby || !prefsInfo.radioSample.labelPresent) {
        addFinding('Preferences', 'Medium',
          'Radio group has no accessible name (aria-labelledby resolves to nothing)', shot,
          'Link aria-labelledby to a visible label element.');
      }
      if (prefsInfo.radioSample.inputH !== null && prefsInfo.radioSample.inputH < 16) {
        addFinding('Preferences', 'Low',
          `Radio input is only ${prefsInfo.radioSample.inputH}px tall`, shot, 'Increase radio input size to >=20px.');
      }
    }

    // Orphan labels
    if (prefsInfo.orphanLabelCount > 0) {
      addFinding('Preferences', 'Medium',
        `${prefsInfo.orphanLabelCount} <label for="..."> reference(s) a non-existent input id`, shot,
        'Fix or remove labels whose for= does not match any input id.');
    }

    // Save + return
    if (!prefsInfo.savePresent) {
      addFinding('Preferences', 'High', 'Preferences Save button is missing', shot, 'Render the submit button in #prefs_buttons.');
    } else if (prefsInfo.saveH < 40) {
      addFinding('Preferences', 'Medium',
        `Preferences Save button is only ${prefsInfo.saveH}px tall`, shot, 'Make the Save button a large touch target (btn-lg).');
    }
    if (!prefsInfo.returnPresent) {
      addFinding('Preferences', 'Medium', 'Preferences "Return" link/button is missing', shot, 'Render #return_button.');
    }

    // Accounts section
    if (!prefsInfo.accountsSectionPresent) {
      addFinding('Preferences', 'Low', 'Accounts section (.prefs-accounts-section) is missing', shot, 'Render the accounts fieldset.');
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
    await ctx.close();
  });

  // ============= 4. MAIL PAGE EMPTY STATE =============
  test('L8-04 - Mail page empty state (message, compose, account list)', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.goto(`${BASE_URL}/mail`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const shot = await takeScreenshot(page, 'L8-04a-mail');

    const mailInfo = await page.evaluate(() => {
      const empty = document.getElementById('mail_empty');
      const loading = document.getElementById('mail_loading');
      const noMessages = document.getElementById('mail_no_messages');
      const errorEl = document.getElementById('mail_error');
      const rows = document.getElementById('mail_rows');
      const composeBtn = document.getElementById('mail_compose');
      const accounts = document.getElementById('mail_accounts');
      const search = document.getElementById('mail_search');
      const title = document.getElementById('mail_account_title');
      const refresh = document.getElementById('mail_refresh');

      const isHidden = el => {
        if (!el) return true;
        if (el.hidden) return true;
        const s = window.getComputedStyle(el);
        return s.display === 'none' || s.visibility === 'hidden' || el.getBoundingClientRect().width === 0;
      };

      const cs = el => el ? (() => {
        const s = window.getComputedStyle(el);
        return { bg: s.backgroundColor, color: s.color, padding: s.padding, textAlign: s.textAlign };
      })() : null;

      const emptyAddLink = empty ? empty.querySelector('.mail-empty-add-account, a.btn') : null;

      return {
        emptyPresent: !!empty,
        emptyVisible: empty ? !isHidden(empty) : false,
        emptyText: empty ? empty.textContent.trim().slice(0, 80) : null,
        emptyHasAddLink: !!emptyAddLink,
        emptyAddLinkHref: emptyAddLink ? emptyAddLink.getAttribute('href') : null,
        emptyCS: cs(empty),
        loadingPresent: !!loading,
        loadingVisible: loading ? !isHidden(loading) : false,
        loadingHasSpinner: loading ? !!loading.querySelector('.fa-spinner, .fa-spin') : false,
        noMessagesPresent: !!noMessages,
        errorPresent: !!errorEl,
        rowsPresent: !!rows,
        rowsChildCount: rows ? rows.children.length : 0,
        composePresent: !!composeBtn,
        composeVisible: composeBtn ? !isHidden(composeBtn) : false,
        composeHasLabel: composeBtn ? composeBtn.getAttribute('aria-label') : null,
        accountsPresent: !!accounts,
        accountsChildCount: accounts ? accounts.children.length : 0,
        searchPresent: !!search,
        searchHasLabel: search ? search.getAttribute('aria-label') : null,
        titlePresent: !!title,
        titleText: title ? title.textContent.trim().slice(0, 30) : null,
        refreshPresent: !!refresh,
        refreshHasLabel: refresh ? refresh.getAttribute('aria-label') || refresh.getAttribute('title') : null,
      };
    });
    console.log(`\n[L8-04 MAIL] ${JSON.stringify(mailInfo).slice(0, 1200)}`);

    // Empty state when no accounts
    if (!mailInfo.emptyPresent) {
      addFinding('Mail', 'Medium', 'Mail empty-state (#mail_empty) element is missing', shot,
        'Render #mail_empty in mail.html for users with no mail accounts.');
    } else if (mailInfo.accountsPresent && mailInfo.accountsChildCount === 0 && !mailInfo.emptyVisible) {
      addFinding('Mail', 'Medium', 'No mail accounts but empty-state is not visible', shot,
        'Show #mail_empty when the mail accounts list is empty.');
    }

    if (mailInfo.emptyVisible && !mailInfo.emptyHasAddLink) {
      addFinding('Mail', 'Medium', 'Mail empty-state has no "add account" call-to-action link', shot,
        'Add a link to /preferences inside #mail_empty.');
    }

    // Compose button
    if (!mailInfo.composePresent) {
      addFinding('Mail', 'Medium', 'Mail compose button (#mail_compose) is missing', shot, 'Render #mail_compose.');
    }
    if (mailInfo.composePresent && !mailInfo.composeHasLabel) {
      addFinding('Mail', 'Medium', 'Mail compose button has no aria-label', shot, 'Add aria-label to #mail_compose.');
    }

    // Search aria-label
    if (mailInfo.searchPresent && !mailInfo.searchHasLabel) {
      addFinding('Mail', 'Medium', 'Mail search input has no aria-label', shot, 'Add aria-label to #mail_search.');
    }

    // Title
    if (!mailInfo.titlePresent) {
      addFinding('Mail', 'Low', 'Mail page has no h1 title (#mail_account_title)', shot, 'Render the mail page heading.');
    }

    // Refresh button accessibility
    if (mailInfo.refreshPresent && !mailInfo.refreshHasLabel) {
      addFinding('Mail', 'Medium', 'Mail refresh button (icon-only) has no aria-label/title', shot,
        'Add aria-label or title to #mail_refresh.');
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
    await ctx.close();
  });

  // ============= 5. CONTACTS LIST VIEW =============
  test('L8-05 - Contacts list view (table headers, row hover, count)', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.goto(`${BASE_URL}/cards`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const shot = await takeScreenshot(page, 'L8-05a-contacts-list');

    const contactsInfo = await page.evaluate(() => {
      const list = document.getElementById('contacts_list');
      const rows = document.querySelectorAll('#contacts_rows .contact-row');
      const header = document.querySelector('.contacts-table-header');
      const search = document.getElementById('contacts_search');
      const countEl = document.getElementById('contact_count');
      const navCountEl = document.getElementById('contact_count_nav');
      const refresh = document.getElementById('contacts_refresh');
      const empty = document.getElementById('contacts_empty');
      const heading = document.querySelector('.contacts-heading h1');

      const isHidden = el => {
        if (!el) return true;
        if (el.hidden) return true;
        const s = window.getComputedStyle(el);
        return s.display === 'none' || el.getBoundingClientRect().width === 0;
      };

      // Header columns
      const headerCols = header ? header.children : [];
      const headerColTexts = Array.from(headerCols).map(c => c.textContent.trim());

      // First row columns + alignment
      let rowSample = null;
      if (rows.length > 0) {
        const r = rows[0].getBoundingClientRect();
        const s = window.getComputedStyle(rows[0]);
        const cols = rows[0].children;
        rowSample = {
          h: Math.round(r.height),
          bg: s.backgroundColor,
          borderBottom: s.borderBottom,
          colCount: cols.length,
          colTags: Array.from(cols).map(c => c.tagName.toLowerCase() + (c.className ? '.' + c.className.split(' ')[0] : '')),
        };
      }

      // Count display
      const countText = countEl ? countEl.textContent.trim() : null;

      return {
        listPresent: !!list,
        listVisible: list ? !isHidden(list) : false,
        rowCount: rows.length,
        headerPresent: !!header,
        headerVisible: header ? !isHidden(header) : false,
        headerColCount: headerCols.length,
        headerColTexts,
        rowSample,
        searchPresent: !!search,
        countElPresent: !!countEl,
        countText,
        navCountPresent: !!navCountEl,
        refreshPresent: !!refresh,
        refreshHasLabel: refresh ? (refresh.getAttribute('aria-label') || refresh.getAttribute('title')) : null,
        emptyPresent: !!empty,
        headingText: heading ? heading.textContent.trim().slice(0, 40) : null,
      };
    });
    console.log(`\n[L8-05 CONTACTS LIST] ${JSON.stringify(contactsInfo).slice(0, 1200)}`);

    // Header alignment with rows
    if (contactsInfo.headerPresent && contactsInfo.rowSample) {
      if (contactsInfo.headerColCount !== contactsInfo.rowSample.colCount) {
        addFinding('Contacts list', 'Medium',
          `Table header has ${contactsInfo.headerColCount} columns but rows have ${contactsInfo.rowSample.colCount} (misaligned)`, shot,
          'Match the number of header columns to the row columns.');
      }
    }

    // Contact count
    if (!contactsInfo.countElPresent) {
      addFinding('Contacts list', 'Low', 'No contact count element (#contact_count) displayed', shot,
        'Show the total contact count in the heading.');
    } else if (contactsInfo.countText && /loading/i.test(contactsInfo.countText)) {
      addFinding('Contacts list', 'Medium',
        `Contact count still shows "${contactsInfo.countText}" after load (never updated)`, shot,
        'Update #contact_count with the real total after contacts load.');
    }

    // Refresh button label
    if (contactsInfo.refreshPresent && !contactsInfo.refreshHasLabel) {
      addFinding('Contacts list', 'Medium',
        'Contacts refresh button (icon-only) has no aria-label/title', shot,
        'Add aria-label to #contacts_refresh.');
    }

    // Row hover effect
    if (contactsInfo.rowCount > 0) {
      const firstRow = page.locator('#contacts_rows .contact-row').first();
      await firstRow.hover();
      await page.waitForTimeout(400);
      const hoverInfo = await page.evaluate(() => {
        const row = document.querySelector('#contacts_rows .contact-row');
        if (!row) return null;
        const s = window.getComputedStyle(row);
        return { bg: s.backgroundColor, boxShadow: s.boxShadow, cursor: s.cursor };
      });
      const shotHover = await takeScreenshot(page, 'L8-05b-row-hover');
      if (hoverInfo) {
        // Compare to non-hover bg
        if (hoverInfo.cursor !== 'pointer') {
          addFinding('Contacts list', 'Low',
            'Contact row does not show pointer cursor on hover', shotHover,
            'Set cursor:pointer on .contact-row.');
        }
      }
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
    await ctx.close();
  });

  // ============= 6. MOBILE CALENDAR LIST VIEW @ 375px =============
  test('L8-06 - Mobile calendar list view @ 375px (events, title, bottom bar)', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.waitForTimeout(3000);
    const shot = await takeScreenshot(page, 'L8-06a-mobile-calendar-list');

    const mobileInfo = await page.evaluate(() => {
      const bar = document.getElementById('mobile_bottom_bar');
      const fab = document.getElementById('mobile_fab_add');
      const cal = document.getElementById('calendar_view');
      const listItems = document.querySelectorAll('.fc-list-item');
      const navTitle = document.querySelector('.mobile-calendar-toolbar-title');
      const brandTitle = document.querySelector('.caldaver-brand-title');
      const listHeading = document.querySelector('.fc-list-heading, .fc-list-table th');

      const isHidden = el => {
        if (!el) return true;
        if (el.hidden) return true;
        const s = window.getComputedStyle(el);
        return s.display === 'none' || s.visibility === 'hidden' || el.getBoundingClientRect().width === 0;
      };

      const rect = el => el ? (() => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) };
      })() : null;

      const barBtns = bar ? bar.querySelectorAll('.mobile-bottom-btn') : [];
      const vw = window.innerWidth;

      // Detect active view
      const listView = !!document.querySelector('.fc-list-view');
      const monthView = !!document.querySelector('.fc-month-view');

      return {
        vw,
        barPresent: !!bar,
        barVisible: bar ? !isHidden(bar) : false,
        barRect: rect(bar),
        barBtnCount: barBtns.length,
        barBtnSizes: Array.from(barBtns).map(b => ({
          w: Math.round(b.getBoundingClientRect().width),
          h: Math.round(b.getBoundingClientRect().height),
        })),
        fabPresent: !!fab,
        fabVisible: fab ? !isHidden(fab) : false,
        fabRect: rect(fab),
        fabOverlapsBar: (bar && fab) ? (() => {
          const br = bar.getBoundingClientRect();
          const fr = fab.getBoundingClientRect();
          return fr.bottom > br.top && fr.top < br.bottom;
        })() : null,
        calVisible: cal ? !isHidden(cal) : false,
        listItemCount: listItems.length,
        listViewActive: listView,
        monthViewActive: monthView,
        navTitlePresent: !!navTitle,
        navTitleText: navTitle ? navTitle.textContent.trim().slice(0, 40) : null,
        navTitleVisible: navTitle ? !isHidden(navTitle) : false,
        brandTitleText: brandTitle ? brandTitle.textContent.trim().slice(0, 20) : null,
        barAtBottom: bar ? (bar.getBoundingClientRect().bottom >= vw ? false : true) : null,
      };
    });
    console.log(`\n[L8-06 MOBILE CAL LIST] ${JSON.stringify(mobileInfo).slice(0, 1300)}`);

    // Bottom bar
    if (mobileInfo.barPresent && !mobileInfo.barVisible) {
      addFinding('Mobile calendar', 'High', 'Mobile bottom bar is not visible at 375px', shot,
        'Ensure mobile.js reveals #mobile_bottom_bar on narrow viewports.');
    } else if (mobileInfo.barVisible) {
      const smallBtns = mobileInfo.barBtnSizes.filter(b => b.h < MIN_TOUCH);
      if (smallBtns.length > 0) {
        addFinding('Mobile calendar', 'Medium',
          `${smallBtns.length} bottom bar button(s) under ${MIN_TOUCH}px tall`, shot,
          `Set min-height: 48px on .mobile-bottom-btn.`);
      }
      // Bar should be full width
      if (mobileInfo.barRect && (mobileInfo.barRect.x > 2 || mobileInfo.barRect.right < mobileInfo.vw - 2)) {
        addFinding('Mobile calendar', 'Low', 'Mobile bottom bar does not span full viewport width', shot,
          'Set left:0;right:0 on .mobile-bottom-bar.');
      }
    }

    // FAB
    if (mobileInfo.fabPresent && mobileInfo.fabVisible && mobileInfo.fabOverlapsBar) {
      addFinding('Mobile calendar', 'High', 'FAB overlaps the bottom navigation bar', shot,
        'Position the FAB above the bottom bar.');
    }
    if (mobileInfo.fabPresent && mobileInfo.fabVisible && mobileInfo.fabRect && mobileInfo.fabRect.w < 48) {
      addFinding('Mobile calendar', 'Medium',
        `FAB is only ${mobileInfo.fabRect.w}px (should be >=56px)`, shot, 'Set width/height: 56px on .mobile-fab.');
    }

    // Title visibility on mobile
    if (!mobileInfo.navTitlePresent || !mobileInfo.navTitleVisible) {
      addFinding('Mobile calendar', 'Low',
        'No calendar month/date title visible in the mobile navbar', shot,
        'Show the current month/date in .mobile-calendar-toolbar-title.');
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
    await ctx.close();
  });

  // ============= 7. MOBILE CONTACTS @ 375px =============
  test('L8-07 - Mobile contacts @ 375px (layout, search, readability)', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.goto(`${BASE_URL}/cards`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const shot = await takeScreenshot(page, 'L8-07a-mobile-contacts');

    const mobileInfo = await page.evaluate(() => {
      const search = document.getElementById('contacts_search');
      const searchRow = document.querySelector('.contacts-search-row');
      const viewSwitch = document.querySelector('.contacts-view-switch');
      const rows = document.querySelectorAll('#contacts_rows .contact-row');
      const cards = document.querySelectorAll('#contacts_cards .contact-card');
      const header = document.querySelector('.contacts-table-header');
      const heading = document.querySelector('.contacts-heading h1');
      const createBtn = document.getElementById('contact_create');
      const empty = document.getElementById('contacts_empty');
      const refresh = document.getElementById('contacts_refresh');

      const isHidden = el => {
        if (!el) return true;
        if (el.hidden) return true;
        const s = window.getComputedStyle(el);
        return s.display === 'none' || el.getBoundingClientRect().width === 0;
      };
      const rect = el => el ? (() => {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) };
      })() : null;
      const vw = window.innerWidth;

      // Check if list view hides table header on mobile or keeps it
      const headerCS = header ? window.getComputedStyle(header) : null;

      return {
        vw,
        searchPresent: !!search,
        searchRect: rect(search),
        searchOverflows: search ? search.getBoundingClientRect().right > vw : false,
        searchRowRect: rect(searchRow),
        viewSwitchPresent: !!viewSwitch,
        viewSwitchRect: rect(viewSwitch),
        viewSwitchOverflows: viewSwitch ? viewSwitch.getBoundingClientRect().right > vw : false,
        rowCount: rows.length,
        cardCount: cards.length,
        headerPresent: !!header,
        headerHiddenOnMobile: header ? isHidden(header) : null,
        headingText: heading ? heading.textContent.trim().slice(0, 40) : null,
        headingRect: rect(heading),
        createBtnPresent: !!createBtn,
        createBtnVisible: createBtn ? !isHidden(createBtn) : false,
        emptyVisible: empty ? !isHidden(empty) : false,
        refreshRect: rect(refresh),
      };
    });
    console.log(`\n[L8-07 MOBILE CONTACTS] ${JSON.stringify(mobileInfo).slice(0, 1100)}`);

    // Search overflow
    if (mobileInfo.searchOverflows) {
      addFinding('Mobile contacts', 'Medium', 'Contact search input overflows viewport at 375px', shot,
        'Constrain #contacts_search width.');
    }
    if (mobileInfo.searchRect && mobileInfo.searchRect.h < MIN_TOUCH) {
      addFinding('Mobile contacts', 'Medium',
        `Contact search input is only ${mobileInfo.searchRect.h}px tall (touch target)`, shot,
        `Set min-height: ${MIN_TOUCH}px on #contacts_search.`);
    }

    // View switch overflow
    if (mobileInfo.viewSwitchOverflows) {
      addFinding('Mobile contacts', 'Medium', 'View-switch control overflows viewport at 375px', shot,
        'Allow the search-row to wrap or shrink the view-switch.');
    }

    // Create button reachable
    if (mobileInfo.createBtnPresent && !mobileInfo.createBtnVisible && !mobileInfo.emptyVisible) {
      addFinding('Mobile contacts', 'Medium',
        'Create-contact button not visible on mobile and no empty-state fallback', shot,
        'Reveal #contact_create or show #contacts_empty with a create action.');
    }

    // Table header on mobile (often should be hidden or reflowed)
    if (mobileInfo.headerPresent && !mobileInfo.headerHiddenOnMobile && mobileInfo.rowCount > 0) {
      // Header is visible - check it fits
      addFinding('Mobile contacts', 'Low',
        'Contacts table header is visible at 375px (may cause horizontal overflow with 6 columns)', shot,
        'Consider hiding .contacts-table-header on mobile or switching to card layout.');
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
    await ctx.close();
  });

  // ============= 8. CROSS-PAGE CONSISTENCY =============
  test('L8-08 - Cross-page consistency (navbar, headings, buttons)', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);

    const pages = [
      { name: 'calendar', url: `${BASE_URL}/` },
      { name: 'cards', url: `${BASE_URL}/cards` },
      { name: 'mail', url: `${BASE_URL}/mail` },
      { name: 'preferences', url: `${BASE_URL}/preferences` },
    ];
    const shot = await takeScreenshot(page, 'L8-08a-consistency-calendar');

    const results = [];
    for (const p of pages) {
      await page.goto(p.url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      const info = await page.evaluate(() => {
        const navbar = document.querySelector('.caldaver-topbar, .navbar');
        const brand = document.querySelector('.caldaver-brand-title, .navbar-brand');
        const navItems = document.querySelectorAll('.navbar-nav > li, .caldaver-topbar a, .caldaver-topbar button');
        const h1 = document.querySelector('h1');
        const prefLink = document.querySelector('a[href*="preferences"]');
        const logoutLink = document.querySelector('a[href*="logout"]');
        const vw = window.innerWidth;

        const navbarCS = navbar ? window.getComputedStyle(navbar) : null;
        const h1CS = h1 ? window.getComputedStyle(h1) : null;

        // Check for active-section indication
        const activeItem = document.querySelector('.mobile-section-menu a.active, .navbar a.active');

        return {
          path: location.pathname,
          navbarPresent: !!navbar,
          navbarBg: navbarCS ? navbarCS.backgroundColor : null,
          navbarH: navbar ? Math.round(navbar.getBoundingClientRect().height) : null,
          brandText: brand ? brand.textContent.trim().slice(0, 30) : null,
          navItemCount: navItems.length,
          h1Present: !!h1,
          h1Text: h1 ? h1.textContent.trim().slice(0, 40) : null,
          h1FontSize: h1CS ? h1CS.fontSize : null,
          h1Color: h1CS ? h1CS.color : null,
          prefLinkPresent: !!prefLink,
          logoutLinkPresent: !!logoutLink,
          activeSectionShown: !!activeItem,
          vw,
        };
      });
      results.push({ page: p.name, ...info });
      await takeScreenshot(page, `L8-08b-${p.name}`);
    }
    console.log(`\n[L8-08 CROSS-PAGE] ${JSON.stringify(results).slice(0, 1800)}`);

    // Navbar consistency: background colour should be the same across pages
    const navBgs = [...new Set(results.map(r => r.navbarBg))];
    if (navBgs.length > 1) {
      addFinding('Cross-page', 'Medium',
        `Navbar background colour differs across pages: ${navBgs.join(', ')}`, shot,
        'Use one consistent navbar background on all pages.');
    }
    const navHeights = results.map(r => r.navbarH).filter(h => h !== null);
    if (navHeights.length > 1 && Math.max(...navHeights) - Math.min(...navHeights) > 6) {
      addFinding('Cross-page', 'Low',
        `Navbar height varies across pages (${Math.min(...navHeights)}-${Math.max(...navHeights)}px)`, shot,
        'Standardise navbar height.');
    }

    // H1 heading consistency
    const missingH1 = results.filter(r => !r.h1Present);
    if (missingH1.length > 0) {
      addFinding('Cross-page', 'Medium',
        `${missingH1.length} page(s) missing an <h1> heading: ${missingH1.map(r => r.page).join(', ')}`, shot,
        'Every page should have a single <h1> for screen-reader navigation.');
    }
    const h1FontSizes = [...new Set(results.filter(r => r.h1FontSize).map(r => r.h1FontSize))];
    if (h1FontSizes.length > 2) {
      addFinding('Cross-page', 'Low',
        `Page <h1> font-size varies across pages: ${h1FontSizes.join(', ')}`, shot,
        'Standardise h1 font-size.');
    }

    // Pref/logout link present on all pages
    const missingPref = results.filter(r => !r.prefLinkPresent);
    if (missingPref.length > 0) {
      addFinding('Cross-page', 'Medium',
        `Preferences link missing from navbar on: ${missingPref.map(r => r.page).join(', ')}`, shot,
        'Include the preferences link in the navbar on every page.');
    }
    const missingLogout = results.filter(r => !r.logoutLinkPresent);
    if (missingLogout.length > 0) {
      addFinding('Cross-page', 'Medium',
        `Logout link missing from navbar on: ${missingLogout.map(r => r.page).join(', ')}`, shot,
        'Include the logout link in the navbar on every page.');
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
    await ctx.close();
  });

  // ============= 9. ACCESSIBILITY DEEP CHECK =============
  test('L8-09 - Accessibility deep check (headings, landmarks, contrast, labels)', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.waitForTimeout(1500);
    const shot = await takeScreenshot(page, 'L8-09a-a11y-calendar');

    const a11yInfo = await page.evaluate(() => {
      // Heading hierarchy
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
      const headingLevels = headings.map(h => ({
        level: parseInt(h.tagName[1], 10),
        text: h.textContent.trim().slice(0, 40),
        visible: h.getBoundingClientRect().width > 0,
      }));
      // Check for skipped levels (h1 -> h3 without h2)
      let skippedLevel = false;
      let minLevel = 7;
      for (const h of headingLevels) {
        if (h.visible) {
          if (h.level > minLevel + 1) skippedLevel = true;
          if (h.level < minLevel) minLevel = h.level;
        }
      }
      const h1Count = headingLevels.filter(h => h.level === 1 && h.visible).length;

      // Landmarks
      const landmarks = {
        nav: document.querySelectorAll('nav, [role="navigation"]').length,
        main: document.querySelectorAll('main, [role="main"]').length,
        header: document.querySelectorAll('header, [role="banner"]').length,
        footer: document.querySelectorAll('footer, [role="contentinfo"]').length,
        aside: document.querySelectorAll('aside, [role="complementary"]').length,
      };

      // Form labels: inputs without associated label
      const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea'));
      const unlabeled = inputs.filter(inp => {
        const id = inp.id;
        const ariaLabel = inp.getAttribute('aria-label');
        const ariaLabelledby = inp.getAttribute('aria-labelledby');
        const wrappedLabel = inp.closest('label');
        if (wrappedLabel) return false;
        if (ariaLabel && ariaLabel.trim()) return false;
        if (ariaLabelledby && document.getElementById(ariaLabelledby)) return false;
        if (id && document.querySelector(`label[for="${id}"]`)) return false;
        return true;
      }).map(inp => inp.id || inp.name || inp.tagName.toLowerCase());

      // Buttons without accessible name
      const buttons = Array.from(document.querySelectorAll('button'));
      const namelessButtons = buttons.filter(b => {
        const text = (b.textContent || '').trim();
        const ariaLabel = b.getAttribute('aria-label');
        const title = b.getAttribute('title');
        const hasImgAlt = b.querySelector('img[alt]:not([alt=""])');
        if (text) return false;
        if (ariaLabel && ariaLabel.trim()) return false;
        if (title && title.trim()) return false;
        if (hasImgAlt) return false;
        return true;
      }).map(b => b.id || b.className.toString().slice(0, 30) || 'button');

      // Links without accessible name
      const links = Array.from(document.querySelectorAll('a'));
      const namelessLinks = links.filter(a => {
        const text = (a.textContent || '').trim();
        const ariaLabel = a.getAttribute('aria-label');
        const title = a.getAttribute('title');
        if (text) return false;
        if (ariaLabel && ariaLabel.trim()) return false;
        if (title && title.trim()) return false;
        if (a.querySelector('img[alt]:not([alt=""])')) return false;
        return true;
      }).map(a => a.getAttribute('href') || a.className || 'a');

      // Images without alt
      const imgs = Array.from(document.querySelectorAll('img'));
      const noAltImgs = imgs.filter(i => !i.hasAttribute('alt')).map(i => i.src.slice(-40));

      return {
        headingLevels,
        skippedLevel,
        h1Count,
        landmarks,
        unlabeledInputCount: unlabeled.length,
        unlabeledInputs: unlabeled.slice(0, 8),
        namelessButtonCount: namelessButtons.length,
        namelessButtons: namelessButtons.slice(0, 8),
        namelessLinkCount: namelessLinks.length,
        namelessLinks: namelessLinks.slice(0, 8),
        imgWithoutAltCount: noAltImgs.length,
        imgWithoutAlt: noAltImgs.slice(0, 5),
      };
    });
    console.log(`\n[L8-09 A11Y CALENDAR] ${JSON.stringify(a11yInfo).slice(0, 1500)}`);

    // Heading hierarchy
    if (a11yInfo.h1Count === 0) {
      addFinding('Accessibility', 'Medium', 'Calendar page has no visible <h1>', shot,
        'Add a visually-hidden or visible <h1> for the calendar page.');
    } else if (a11yInfo.h1Count > 1) {
      addFinding('Accessibility', 'Low',
        `Calendar page has ${a11yInfo.h1Count} <h1> elements (should be one)`, shot,
        'Use a single <h1> per page.');
    }
    if (a11yInfo.skippedLevel) {
      addFinding('Accessibility', 'Medium',
        'Heading levels are skipped (e.g. h1 -> h3 without an h2) on the calendar page', shot,
        'Ensure heading levels increment by one.');
    }

    // Landmarks
    if (a11yInfo.landmarks.nav === 0) {
      addFinding('Accessibility', 'Medium', 'No navigation landmark on the calendar page', shot,
        'Wrap nav in a <nav> or role="navigation".');
    }
    if (a11yInfo.landmarks.main === 0) {
      addFinding('Accessibility', 'Medium', 'No main landmark on the calendar page', shot,
        'Wrap primary content in <main> or role="main".');
    }

    // Unlabeled inputs
    if (a11yInfo.unlabeledInputCount > 0) {
      addFinding('Accessibility', a11yInfo.unlabeledInputCount > 2 ? 'High' : 'Medium',
        `${a11yInfo.unlabeledInputCount} form control(s) lack an accessible label: ${a11yInfo.unlabeledInputs.join(', ')}`,
        shot, 'Associate every input with a <label for> or aria-label.');
    }

    // Nameless buttons
    if (a11yInfo.namelessButtonCount > 0) {
      addFinding('Accessibility', a11yInfo.namelessButtonCount > 2 ? 'High' : 'Medium',
        `${a11yInfo.namelessButtonCount} button(s) have no accessible name: ${a11yInfo.namelessButtons.join(', ')}`,
        shot, 'Add text, aria-label, or title to every button.');
    }

    // Nameless links
    if (a11yInfo.namelessLinkCount > 0) {
      addFinding('Accessibility', 'Medium',
        `${a11yInfo.namelessLinkCount} link(s) have no accessible name: ${a11yInfo.namelessLinks.join(', ')}`,
        shot, 'Add text or aria-label to every link.');
    }

    // Images without alt
    if (a11yInfo.imgWithoutAltCount > 0) {
      addFinding('Accessibility', 'Low',
        `${a11yInfo.imgWithoutAltCount} <img> without alt attribute`, shot,
        'Add alt="" for decorative images or descriptive alt otherwise.');
    }

    // Contrast check on contacts page too
    await page.goto(`${BASE_URL}/cards`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const contrastIssues = await page.evaluate(() => {
      const issues = [];
      // Check muted / secondary text elements
      const candidates = document.querySelectorAll('.contacts-nav-item.muted span, .help-block, .navbar-text, .text-muted, .muted');
      for (const el of candidates) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        const s = window.getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') continue;
        // Find effective background by walking up
        let bg = s.backgroundColor;
        let parent = el.parentElement;
        while (bg === 'rgba(0, 0, 0, 0)' && parent) {
          bg = window.getComputedStyle(parent).backgroundColor;
          parent = parent.parentElement;
        }
        if (bg === 'rgba(0, 0, 0, 0)') bg = 'rgb(255, 255, 255)';
        const ratio = null; // computed below via luminance in node? No - do it here
        const text = s.color;
        // We can't call luminance here easily; record pairs
        issues.push({ selector: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className ? '.' + el.className.toString().split(' ')[0] : ''), text, bg });
      }
      return issues.slice(0, 10);
    });
    console.log(`[L8-09 CONTRAST CANDIDATES] ${JSON.stringify(contrastIssues).slice(0, 800)}`);
    let lowContrastCount = 0;
    for (const c of contrastIssues) {
      const ratio = contrastRatio(c.text, c.bg);
      if (ratio !== null && ratio < 4.5) {
        lowContrastCount++;
        if (lowContrastCount <= 3) {
          addFinding('Accessibility', 'Medium',
            `Low text contrast ${ratio.toFixed(2)}:1 on "${c.selector}" (text=${c.text} bg=${c.bg})`, shot,
            'Increase contrast to >=4.5:1 for normal text.');
        }
      }
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
    await ctx.close();
  });

  // ============= 10. ERROR HANDLING =============
  test('L8-10 - Error handling (404, loading spinners, network states)', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.waitForTimeout(1000);

    // --- 404 page ---
    const resp404 = await page.goto(`${BASE_URL}/this-page-does-not-exist-xyz`, { waitUntil: 'domcontentloaded' }).catch(() => null);
    await page.waitForTimeout(1500);
    const shot404 = await takeScreenshot(page, 'L8-10a-404');
    const notFoundInfo = await page.evaluate(() => {
      const alert = document.querySelector('.alert-danger, .alert, [role="alert"]');
      const h1 = document.querySelector('h1');
      const bodyText = document.body ? document.body.textContent.trim().slice(0, 200) : '';
      const hasNavbar = !!document.querySelector('.caldaver-topbar, .navbar');
      return {
        statusCode: 'n/a',
        alertPresent: !!alert,
        alertText: alert ? alert.textContent.trim().slice(0, 100) : null,
        alertRole: alert ? alert.getAttribute('role') : null,
        h1Present: !!h1,
        h1Text: h1 ? h1.textContent.trim().slice(0, 40) : null,
        bodyTextSnippet: bodyText,
        hasNavbar,
        bodyHasContent: bodyText.length > 10,
      };
    });
    console.log(`\n[L8-10 404] response=${resp404 ? resp404.status() : 'null'} info=${JSON.stringify(notFoundInfo).slice(0, 600)}`);

    if (resp404 && resp404.status() === 404) {
      if (!notFoundInfo.alertPresent && !notFoundInfo.h1Present) {
        addFinding('Error handling', 'Medium', '404 page has no error message or heading', shot404,
          'Render a friendly 404 message with a link back to the calendar.');
      }
      if (!notFoundInfo.hasNavbar) {
        addFinding('Error handling', 'Low', '404 page lacks the main navbar (user is stranded)', shot404,
          'Include the navbar on the 404 page so users can navigate back.');
      }
      if (notFoundInfo.alertPresent && notFoundInfo.alertRole !== 'alert') {
        addFinding('Error handling', 'Low', '404 error message lacks role="alert"', shot404,
          'Add role="alert" to the 404 error message.');
      }
    }

    // --- Loading spinner on mail ---
    await page.goto(`${BASE_URL}/mail`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const shotLoading = await takeScreenshot(page, 'L8-10b-mail-loading');
    const loadingInfo = await page.evaluate(() => {
      const loading = document.getElementById('mail_loading');
      const spinner = loading ? loading.querySelector('.fa-spinner, .fa-spin, .spinner') : null;
      return {
        loadingPresent: !!loading,
        spinnerPresent: !!spinner,
      };
    });
    console.log(`[L8-10 LOADING] ${JSON.stringify(loadingInfo)}`);

    // --- Contacts loading state ---
    await page.goto(`${BASE_URL}/cards`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const contactsLoadingInfo = await page.evaluate(() => {
      const loading = document.getElementById('contacts_loading');
      const spinner = loading ? loading.querySelector('.fa-spinner, .fa-spin, .spinner') : null;
      const heading = loading ? loading.querySelector('h2') : null;
      return {
        loadingPresent: !!loading,
        spinnerPresent: !!spinner,
        headingText: heading ? heading.textContent.trim().slice(0, 40) : null,
      };
    });
    console.log(`[L8-10 CONTACTS LOADING] ${JSON.stringify(contactsLoadingInfo)}`);

    if (contactsLoadingInfo.loadingPresent && !contactsLoadingInfo.spinnerPresent) {
      addFinding('Error handling', 'Low',
        'Contacts loading state has no spinner animation', shotLoading,
        'Add a fa-spinner / fa-spin icon to #contacts_loading.');
    }

    // --- Network error simulation: block the calendars API ---
    await page.route('**/calendars', route => route.abort());
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const shotError = await takeScreenshot(page, 'L8-10c-network-error');
    const errorInfo = await page.evaluate(() => {
      const alert = document.querySelector('.alert-danger, .alert, [role="alert"]');
      const errText = document.body.textContent;
      const sidebarItems = document.querySelectorAll('#own_calendar_list li, #shared_calendar_list li');
      return {
        alertPresent: !!alert,
        sidebarItemCount: sidebarItems.length,
      };
    });
    console.log(`[L8-10 NETWORK ERROR] ${JSON.stringify(errorInfo)}`);
    await page.unroute('**/calendars');

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
    await ctx.close();
  });

  // ============= SUMMARY =============
  test('L8-11 - Summary: write findings report', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    console.log('\n\n========================================================');
    console.log('  CALDAVER LOOP 8 FINAL POLISH AUDIT - FINDINGS');
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

    fs.writeFileSync(`${SCREENSHOT_DIR}/loop8-findings.json`, JSON.stringify({ findings: sorted, summary }, null, 2));
    expect(findings.length).toBeGreaterThanOrEqual(0);
  });
});
