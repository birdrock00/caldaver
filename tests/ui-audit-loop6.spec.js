/**
 * Caldaver Loop 6 - Edge-Case & Polish UI Audit.
 *
 * Previous rounds already fixed:
 *   R1: i18n strings, mobile 44px touch targets, a11y labels
 *   R2: Calendar grid lines (1px #dadce0), dotted minor time slots
 *   R3: Today button, contact phone links 44px, radio inputs 24px
 *   R4: Keyboard shortcuts, focus trap, qtip role=dialog, 404 page, mobile
 *       bottom bar + FAB, mail reply button 44px
 *   R5: Timezone dropdown (now 100+ zones), pseudobutton contrast, event
 *       create flow, settings page, responsive breakpoints, CSS audit,
 *       mobile calendar event display
 *
 * This loop audits DIFFERENT, polish-focused concerns:
 *   L6-01 Login page design (layout, spacing, field widths, submit button,
 *        error message display, wrong password flow)
 *   L6-02 Calendar sidebar list (load state, create button contrast, list
 *        items, shared calendars section)
 *   L6-03 Calendar month view (event rendering, day numbers, weekend
 *        distinction, +more link)
 *   L6-04 Calendar day view (time labels, event blocks)
 *   L6-05 Contact list view (table layout, column headers, rows, search,
 *        view switch buttons)
 *   L6-06 Contact detail dialog (layout, form field spacing/labels,
 *        escape-to-close)
 *   L6-07 Mail inbox layout (list, empty state, compose button)
 *   L6-08 Navbar brand/title (text, styling, height, responsive)
 *   L6-09 Footer (text, positioning, visibility)
 *   L6-10 Scroll behavior (independent calendar/sidebar scroll, long lists,
 *        sticky headers)
 *   L6-11 Tooltip/popover positioning (hover events, viewport overflow)
 *   L6-12 Focus indicators (tab through calendar, visible focus rings,
 *        logical order)
 *   L6-13 Dark mode / print styles (prefers-color-scheme, print stylesheet)
 *   L6-14 Summary report
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');

const BASE_URL = 'https://caldaver.example.invalid';
const USERNAME = 'REDACTED';
const PASSWORD = 'REDACTED';
const SCREENSHOT_DIR = '/tmp/caldaver-audit-loop6';
const MIN_TOUCH = 44;

const findings = [];
const SEVERITY_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };

function addFinding(page, severity, description, screenshotPath, recommendation) {
  findings.push({
    id: `L6-${String(findings.length + 1).padStart(3, '0')}`,
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
 * Relative luminance per WCAG 2.1.
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
  const btn = page.locator(
    `.fc-${viewName}-button, .fc-button:has-text("${viewName}"), .fc-button:has-text("${viewName.charAt(0).toUpperCase() + viewName.slice(1)}")`
  ).first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(1500);
    return true;
  }
  return false;
}

test.describe('Caldaver Loop 6 Edge-Case & Polish UI Audit', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  test.setTimeout(300000);

  // ============= 1. LOGIN PAGE DESIGN =============
  test('L6-01 - Login page design (layout, spacing, field widths, error)', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);

    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    const shot1 = await takeScreenshot(page, 'L6-01a-login-default');

    const loginInfo = await page.evaluate(() => {
      const form = document.querySelector('.loginform');
      const userInp = document.getElementById('user');
      const passInp = document.getElementById('password');
      const submitBtn = document.querySelector('input[name="login"]');
      const logo = document.querySelector('.loginform img');
      const toggle = document.getElementById('login_pw_toggle');
      const skipLink = document.querySelector('.skip-link');

      const rect = el => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      };
      const cs = el => {
        if (!el) return null;
        const s = window.getComputedStyle(el);
        return { width: s.width, padding: s.padding, margin: s.margin, borderRadius: s.borderRadius, fontSize: s.fontSize, display: s.display };
      };

      // Check if the form is centered / constrained
      const formRect = rect(form);
      const bodyRect = { w: window.innerWidth, h: window.innerHeight };

      return {
        formPresent: !!form,
        formRect,
        bodyRect,
        formMaxWidth: form ? window.getComputedStyle(form).maxWidth : null,
        formWidthPct: formRect ? Math.round((formRect.w / bodyRect.w) * 100) : null,
        userRect: rect(userInp),
        passRect: rect(passInp),
        submitRect: rect(submitBtn),
        userCS: cs(userInp),
        passCS: cs(passInp),
        submitCS: cs(submitBtn),
        submitHeight: submitBtn ? rect(submitBtn).h : null,
        submitType: submitBtn ? submitBtn.getAttribute('type') : null,
        logoPresent: !!logo,
        logoRect: rect(logo),
        togglePresent: !!toggle,
        toggleRect: rect(toggle),
        toggleSize: toggle ? rect(toggle).w : null,
        skipLinkPresent: !!skipLink,
        skipLinkVisible: skipLink ? window.getComputedStyle(skipLink).display !== 'none' : false,
        labelsPresent: {
          user: !!document.querySelector('label[for="user"]'),
          pass: !!document.querySelector('label[for="password"]'),
        },
        required: {
          user: userInp ? userInp.hasAttribute('required') : false,
          pass: passInp ? passInp.hasAttribute('required') : false,
        },
      };
    });
    console.log(`\n[L6-01 LOGIN] ${JSON.stringify(loginInfo).slice(0, 900)}`);

    // Check form width — too wide means it stretches edge-to-edge on desktop
    if (loginInfo.formPresent) {
      if (loginInfo.formWidthPct > 60) {
        addFinding('Login', 'Medium',
          `Login form is ${loginInfo.formWidthPct}% of viewport width (stretches too wide on desktop; should be constrained to ~320-400px)`,
          shot1, 'Set .loginform max-width: 360px and center with margin: auto.');
      }
      if (loginInfo.formWidthPct < 15) {
        addFinding('Login', 'Low',
          `Login form is only ${loginInfo.formWidthPct}% of viewport width (too narrow, may cut off labels)`,
          shot1, 'Ensure the login form is at least 280px wide.');
      }
    }

    // Submit button height (touch target)
    if (loginInfo.submitHeight !== null && loginInfo.submitHeight < 40) {
      addFinding('Login', 'Medium',
        `Login submit button is only ${loginInfo.submitHeight}px tall (should be >=44px for touch)`,
        shot1, 'Add min-height: 44px to .btn-lg on the login submit button.');
    }

    // Logo image present
    if (!loginInfo.logoPresent) {
      addFinding('Login', 'Low',
        'Login page has no logo image (brand identity missing)',
        shot1, 'Add the caldaver logo <img> to .loginform.');
    }

    // Password toggle button size
    if (loginInfo.togglePresent && loginInfo.toggleSize < 36) {
      addFinding('Login', 'Medium',
        `Password show/hide toggle is only ${loginInfo.toggleSize}px wide (hard to tap on touch)`,
        shot1, 'Set min-width: 44px and min-height: 44px on #login_pw_toggle.');
    }

    // Skip link present?
    if (!loginInfo.skipLinkPresent) {
      addFinding('Login', 'Medium',
        'Login page missing skip-to-content link',
        shot1, 'Add <a href="#content" class="skip-link">Skip to main content</a>.');
    }

    // Now test wrong password error display
    await page.locator('#user').fill(USERNAME);
    await page.locator('#password').fill('WRONG_PASSWORD_TEST_123');
    const loginNavPromise = page.waitForURL(url => !url.toString().includes('/login'), { timeout: 10000 }).catch(() => null);
    await page.locator('input[name="login"]').click();
    await page.waitForTimeout(2000);

    // We should still be on /login with an error
    const shot2 = await takeScreenshot(page, 'L6-01b-login-wrong-password');
    const errorInfo = await page.evaluate(() => {
      const errorEl = document.querySelector('.login-error, .alert, .alert-danger, .flash-error, [role="alert"]');
      const stillOnLogin = /\/login/.test(location.pathname);
      return {
        stillOnLogin,
        errorPresent: !!errorEl,
        errorVisible: errorEl ? errorEl.getBoundingClientRect().width > 0 : false,
        errorText: errorEl ? errorEl.textContent.trim().slice(0, 120) : null,
        errorRole: errorEl ? errorEl.getAttribute('role') : null,
        errorClass: errorEl ? errorEl.className.slice(0, 60) : null,
      };
    });
    console.log(`[L6-01 WRONG PASS] ${JSON.stringify(errorInfo)}`);

    if (errorInfo.stillOnLogin) {
      if (!errorInfo.errorPresent) {
        addFinding('Login', 'High',
          'Wrong password login attempt shows no error message at all',
          shot2, 'Render .login-error with role="alert" when authentication fails.');
      } else if (!errorInfo.errorVisible) {
        addFinding('Login', 'High',
          'Login error element is present but not visible after wrong password',
          shot2, 'Ensure .login-error is visible (display: block) when error is set.');
      } else {
        // Error is visible — check it has role=alert for a11y
        if (errorInfo.errorRole !== 'alert' && !errorInfo.errorClass.includes('alert')) {
          addFinding('Login', 'Medium',
            'Login error message lacks role="alert" (not announced to screen readers)',
            shot2, 'Add role="alert" or aria-live="assertive" to the error container.');
        }
        // Check error text is not a raw stack trace
        if (errorInfo.errorText && /exception|stack|trace|panic|unwrap/i.test(errorInfo.errorText)) {
          addFinding('Login', 'High',
            `Login error message contains a stack trace / internal error: "${errorInfo.errorText}"`,
            shot2, 'Catch auth errors and show a user-friendly message, not internal error text.');
        }
      }
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
    await ctx.close();
  });

  // ============= 2. CALENDAR SIDEBAR CALENDAR LIST =============
  test('L6-02 - Calendar sidebar list (load, create button, shared section)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);

    // Wait for calendar list to populate (replaces "Loading calendars...")
    await page.waitForFunction(() => {
      const items = document.querySelectorAll('.calendar_list li.available_calendar, .calendar_list li');
      return items.length > 0 && !document.querySelector('.calendar-list-loading');
    }, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const shot = await takeScreenshot(page, 'L6-02a-sidebar-calendar-list');

    const sidebarInfo = await page.evaluate(() => {
      const isHidden = el => {
        if (!el) return true;
        const s = window.getComputedStyle(el);
        return s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0;
      };
      const ownList = document.getElementById('own_calendar_list');
      const sharedList = document.getElementById('shared_calendar_list');
      const ownItems = ownList ? ownList.querySelectorAll('li.available_calendar, li') : [];
      const sharedItems = sharedList ? sharedList.querySelectorAll('li.available_calendar, li') : [];
      const loadingLIs = document.querySelectorAll('.calendar-list-loading');
      const createBtn = document.getElementById('shortcut_add_event');
      const calendarAddBtn = document.getElementById('calendar_add');
      const toggleSharedBtn = document.getElementById('toggle_all_shared_calendars');
      const footer = document.getElementById('footer');

      // Create button contrast check
      const createCS = createBtn ? window.getComputedStyle(createBtn) : null;
      const createRect = createBtn ? createBtn.getBoundingClientRect() : null;

      // Calendar list item appearance
      const firstItem = ownItems[0];
      const itemInfo = firstItem ? (() => {
        const r = firstItem.getBoundingClientRect();
        const s = window.getComputedStyle(firstItem);
        const checkbox = firstItem.querySelector('input[type="checkbox"]');
        const colorSwatch = firstItem.querySelector('.calendar_color, .calendar-color, .calendar_color_sample');
        return {
          text: firstItem.textContent.trim().replace(/\s+/g, ' ').slice(0, 50),
          w: Math.round(r.width), h: Math.round(r.height),
          paddingTop: s.paddingTop, paddingBottom: s.paddingBottom,
          hasCheckbox: !!checkbox,
          hasColorSwatch: !!colorSwatch,
        };
      })() : null;

      // Shared calendars section visibility
      const sharedHeading = sharedList ? sharedList.querySelector('.panel-title') : null;
      const sharedBody = sharedList ? sharedList.querySelector('.panel-body') : null;

      return {
        ownListPresent: !!ownList,
        ownListVisible: ownList ? !isHidden(ownList) : false,
        ownItemCount: ownItems.length,
        stillLoading: loadingLIs.length > 0,
        sharedListPresent: !!sharedList,
        sharedListVisible: sharedList ? !isHidden(sharedList) : false,
        sharedItemCount: sharedItems.length,
        sharedHeadingText: sharedHeading ? sharedHeading.textContent.trim() : null,
        sharedBodyVisible: sharedBody ? !isHidden(sharedBody) : false,
        createBtnPresent: !!createBtn,
        createBtnVisible: createBtn ? !isHidden(createBtn) : false,
        createBtnRect: createRect ? { w: Math.round(createRect.width), h: Math.round(createRect.height) } : null,
        createBtnText: createBtn ? createBtn.textContent.trim().replace(/\s+/g, ' ').slice(0, 40) : null,
        createBtnColor: createCS ? createCS.color : null,
        createBtnBg: createCS ? createCS.backgroundColor : null,
        calendarAddPresent: !!calendarAddBtn,
        calendarAddVisible: calendarAddBtn ? !isHidden(calendarAddBtn) : false,
        toggleSharedPresent: !!toggleSharedBtn,
        footerPresent: !!footer,
        footerText: footer ? footer.textContent.trim().slice(0, 80) : null,
        footerVisible: footer ? !isHidden(footer) : false,
        itemInfo,
      };
    });
    console.log(`\n[L6-02 SIDEBAR] ${JSON.stringify(sidebarInfo).slice(0, 1000)}`);

    if (sidebarInfo.stillLoading) {
      addFinding('Calendar sidebar', 'High',
        'Calendar list still shows "Loading calendars..." after 15s',
        shot, 'Verify /calendars endpoint returns data and JS populates .calendar_list.');
    }
    if (sidebarInfo.ownItemCount === 0 && !sidebarInfo.stillLoading) {
      addFinding('Calendar sidebar', 'Medium',
        'Own calendar list has 0 items after loading completed',
        shot, 'Ensure at least the user default calendar renders in the list.');
    }

    // Create event button (#shortcut_add_event)
    if (!sidebarInfo.createBtnPresent) {
      addFinding('Calendar sidebar', 'High',
        'Sidebar "Create event" button (#shortcut_add_event) is missing',
        shot, 'Render <button id="shortcut_add_event"> in the sidebar #shortcuts block.');
    } else {
      if (!sidebarInfo.createBtnVisible) {
        addFinding('Calendar sidebar', 'Medium',
          'Sidebar "Create event" button is present but not visible',
          shot, 'Ensure #shortcut_add_event is visible at desktop width.');
      }
      if (sidebarInfo.createBtnRect && (sidebarInfo.createBtnRect.h < 36)) {
        addFinding('Calendar sidebar', 'Medium',
          `"Create event" button is only ${sidebarInfo.createBtnRect.h}px tall (should be >=40px)`,
          shot, 'Set min-height on .create-event-button.');
      }
      // Contrast check
      if (sidebarInfo.createBtnColor && sidebarInfo.createBtnBg) {
        const ratio = contrastRatio(sidebarInfo.createBtnColor, sidebarInfo.createBtnBg);
        if (ratio !== null && ratio < 4.5) {
          addFinding('Calendar sidebar', ratio < 3 ? 'High' : 'Medium',
            `"Create event" button contrast is ${ratio.toFixed(2)}:1 (fg=${sidebarInfo.createBtnColor} on bg=${sidebarInfo.createBtnBg})`,
            shot, 'Increase contrast between button text and background.');
        }
      }
    }

    // Shared calendars section
    if (sidebarInfo.sharedListPresent) {
      if (!sidebarInfo.sharedListVisible) {
        addFinding('Calendar sidebar', 'Low',
          'Shared calendars section is present but not visible on desktop',
          shot, 'Keep #shared_calendar_list visible at desktop width even if empty.');
      }
    } else {
      addFinding('Calendar sidebar', 'Low',
        'Shared calendars section (#shared_calendar_list) is missing from sidebar',
        shot, 'Render the shared_calendars panel for discoverability.');
    }

    // Calendar list item appearance
    if (sidebarInfo.itemInfo) {
      if (sidebarInfo.itemInfo.h < 28) {
        addFinding('Calendar sidebar', 'Medium',
          `Calendar list item "${sidebarInfo.itemInfo.text}" is only ${sidebarInfo.itemInfo.h}px tall (cramped)`,
          shot, 'Add padding to .calendar_list li (min-height ~36px).');
      }
      if (!sidebarInfo.itemInfo.hasCheckbox && sidebarInfo.ownItemCount > 0) {
        addFinding('Calendar sidebar', 'Medium',
          'Calendar list items have no toggle checkbox (cannot show/hide calendars)',
          shot, 'Add a checkbox input to each calendar item for visibility toggle.');
      }
      if (!sidebarInfo.itemInfo.hasColorSwatch && sidebarInfo.ownItemCount > 0) {
        addFinding('Calendar sidebar', 'Low',
          'Calendar list items have no color swatch indicator',
          shot, 'Add a color swatch reflecting each calendar color.');
      }
    }

    // Footer
    if (!sidebarInfo.footerPresent) {
      addFinding('Calendar sidebar', 'Low',
        'Sidebar #footer element is missing',
        shot, 'Include the #footer div in the sidebar template.');
    } else if (!sidebarInfo.footerVisible) {
      addFinding('Calendar sidebar', 'Low',
        'Sidebar footer is present but not visible',
        shot, 'Ensure #footer is not hidden by CSS.');
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 3. CALENDAR MONTH VIEW =============
  test('L6-03 - Calendar month view (events, day numbers, weekends, +more)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await gotoToday(page);
    await switchToView(page, 'month');
    const shot = await takeScreenshot(page, 'L6-03a-month-view');

    const monthInfo = await page.evaluate(() => {
      const cal = document.getElementById('calendar_view');
      const dayHeaders = cal ? cal.querySelectorAll('.fc-day-header, .fc-widget-header') : [];
      const dayCells = cal ? cal.querySelectorAll('.fc-day-top, .fc-day') : [];
      const dayNumbers = cal ? cal.querySelectorAll('.fc-day-number') : [];
      const events = cal ? cal.querySelectorAll('.fc-event') : [];
      const moreLinks = cal ? cal.querySelectorAll('.fc-more, a.fc-more') : [];
      const weekEndCells = cal ? cal.querySelectorAll('.fc-week-end .fc-day-top, .fc-week-end .fc-day') : [];

      // Check weekend distinction
      const sampleWeekend = weekEndCells[0];
      const sampleWeekday = cal ? cal.querySelector('.fc-week .fc-day-top:not(.fc-week-end .fc-day-top), .fc-day-top:not(.fc-sun):not(.fc-sat)') : null;
      const weekendStyle = sampleWeekend ? window.getComputedStyle(sampleWeekend) : null;
      const weekdayStyle = sampleWeekday ? window.getComputedStyle(sampleWeekday) : null;

      // Check day number styling
      const sampleDayNumber = dayNumbers[0];
      const dayNumStyle = sampleDayNumber ? window.getComputedStyle(sampleDayNumber) : null;

      // Check +more link
      const sampleMore = moreLinks[0];

      // Check event rendering
      const sampleEvent = events[0];
      const eventInfo = sampleEvent ? (() => {
        const r = sampleEvent.getBoundingClientRect();
        const s = window.getComputedStyle(sampleEvent);
        return { text: sampleEvent.textContent.trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height), color: s.color, bg: s.backgroundColor, fontSize: s.fontSize };
      })() : null;

      return {
        dayHeaderCount: dayHeaders.length,
        dayCellCount: dayCells.length,
        dayNumberCount: dayNumbers.length,
        eventCount: events.length,
        moreLinkCount: moreLinks.length,
        moreLinkText: sampleMore ? sampleMore.textContent.trim() : null,
        weekendBg: weekendStyle ? weekendStyle.backgroundColor : null,
        weekdayBg: weekdayStyle ? weekdayStyle.backgroundColor : null,
        weekendDiffers: weekendStyle && weekdayStyle ? weekendStyle.backgroundColor !== weekdayStyle.backgroundColor : null,
        dayNumFontSize: dayNumStyle ? dayNumStyle.fontSize : null,
        dayNumColor: dayNumStyle ? dayNumStyle.color : null,
        dayNumFontWeight: dayNumStyle ? dayNumStyle.fontWeight : null,
        eventInfo,
        // Check for today highlighting
        todayCell: cal ? cal.querySelector('.fc-today, .fc-state-highlight') : null,
      };
    });
    console.log(`\n[L6-03 MONTH] ${JSON.stringify(monthInfo).slice(0, 800)}`);

    // Day numbers present
    if (monthInfo.dayNumberCount === 0) {
      addFinding('Month view', 'High',
        'Month view has no visible day numbers',
        shot, 'Ensure FullCalendar dayNumbers option is enabled.');
    }

    // Weekend distinction
    if (monthInfo.weekendDiffers === false) {
      addFinding('Month view', 'Medium',
        'Weekend cells have the same background as weekday cells (no visual distinction)',
        shot, 'Add a subtle background to .fc-week-end cells (e.g. #f8f9fa) to distinguish weekends.');
    }

    // Today cell highlight
    if (!monthInfo.todayCell) {
      addFinding('Month view', 'Medium',
        'No "today" cell highlight found in month view (.fc-today)',
        shot, 'Ensure FullCalendar marks the current day with .fc-today / .fc-state-highlight class.');
    } else {
      const todayStyle = await page.evaluate(() => {
        const t = document.querySelector('.fc-today, .fc-state-highlight');
        if (!t) return null;
        const s = window.getComputedStyle(t);
        return { bg: s.backgroundColor, border: s.border };
      });
      if (todayStyle && todayStyle.bg === 'rgba(0, 0, 0, 0)') {
        addFinding('Month view', 'Low',
          'Today cell has no background highlight in month view',
          shot, 'Add a subtle background (e.g. #e8f0fe) to .fc-today.');
      }
    }

    // +more link
    if (monthInfo.moreLinkCount > 0) {
      const moreLinkInfo = await page.evaluate(() => {
        const link = document.querySelector('.fc-more, a.fc-more');
        if (!link) return null;
        const r = link.getBoundingClientRect();
        const s = window.getComputedStyle(link);
        return { w: Math.round(r.width), h: Math.round(r.height), color: s.color, cursor: s.cursor };
      });
      if (moreLinkInfo && moreLinkInfo.h < 20) {
        addFinding('Month view', 'Low',
          `"+more" link is only ${moreLinkInfo.h}px tall (hard to click)`,
          shot, 'Increase the tap target for .fc-more links.');
      }
    }

    // Event readability
    if (monthInfo.eventInfo) {
      if (monthInfo.eventInfo.h < 18) {
        addFinding('Month view', 'Medium',
          `Events in month view are only ${monthInfo.eventInfo.h}px tall (text may be clipped)`,
          shot, 'Set FullCalendar agendaDayMinHeight or ensure event min-height ~20px in month view.');
      }
      const evRatio = contrastRatio(monthInfo.eventInfo.color, monthInfo.eventInfo.bg);
      if (evRatio !== null && evRatio < 3.0) {
        addFinding('Month view', 'Medium',
          `Month event "${monthInfo.eventInfo.text}" contrast ${evRatio.toFixed(2)}:1`,
          shot, 'Improve event text/background contrast.');
      }
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 4. CALENDAR DAY VIEW =============
  test('L6-04 - Calendar day view (time labels, event blocks)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await gotoToday(page);
    await switchToView(page, 'day');
    const shot = await takeScreenshot(page, 'L6-04a-day-view');

    const dayInfo = await page.evaluate(() => {
      const cal = document.getElementById('calendar_view');
      const timeLabels = cal ? cal.querySelectorAll('.fc-axis .fc-time, .fc-axis span') : [];
      const events = cal ? cal.querySelectorAll('.fc-time-grid-event, .fc-event') : [];
      const allDaySlot = cal ? cal.querySelector('.fc-day-grid-event, .fc-all-day') : null;
      const nowIndicator = cal ? cal.querySelector('.fc-now-indicator, .fc-now-indicator-line') : null;
      const timeGrid = cal ? cal.querySelector('.fc-time-grid') : null;

      // Check first time label
      const firstLabel = timeLabels[0];
      const labelStyle = firstLabel ? window.getComputedStyle(firstLabel) : null;
      const labelRect = firstLabel ? firstLabel.getBoundingClientRect() : null;

      // Check event block
      const sampleEvent = events[0];
      const eventInfo = sampleEvent ? (() => {
        const r = sampleEvent.getBoundingClientRect();
        const s = window.getComputedStyle(sampleEvent);
        const titleEl = sampleEvent.querySelector('.fc-title, .fc-time');
        return {
          text: sampleEvent.textContent.trim().slice(0, 50),
          w: Math.round(r.width), h: Math.round(r.height),
          color: s.color, bg: s.backgroundColor, fontSize: s.fontSize,
          hasTitle: !!titleEl, titleText: titleEl ? titleEl.textContent.trim() : null,
        };
      })() : null;

      // Check if the grid has scroll
      const scrollInfo = timeGrid ? (() => {
        const r = timeGrid.getBoundingClientRect();
        return { gridH: Math.round(r.height), scrollable: timeGrid.scrollHeight > timeGrid.clientHeight };
      })() : null;

      return {
        timeLabelCount: timeLabels.length,
        firstLabelText: firstLabel ? firstLabel.textContent.trim() : null,
        labelColor: labelStyle ? labelStyle.color : null,
        labelFontSize: labelStyle ? labelStyle.fontSize : null,
        labelWidth: labelRect ? Math.round(labelRect.width) : null,
        eventCount: events.length,
        eventInfo,
        allDayPresent: !!allDaySlot,
        nowIndicatorPresent: !!nowIndicator,
        scrollInfo,
      };
    });
    console.log(`\n[L6-04 DAY] ${JSON.stringify(dayInfo).slice(0, 800)}`);

    if (dayInfo.timeLabelCount === 0) {
      addFinding('Day view', 'High',
        'Day view has no time labels on the left axis',
        shot, 'Ensure FullCalendar axisFormat / slotLabelFormat is set and .fc-axis renders time labels.');
    } else {
      if (dayInfo.labelWidth < 35) {
        addFinding('Day view', 'Low',
          `Time label column is only ${dayInfo.labelWidth}px wide (labels may be truncated)`,
          shot, 'Set min-width: 50px on .fc-axis or slotLabelWidth.');
      }
      // Check time label contrast
      if (dayInfo.labelColor) {
        const ratio = contrastRatio(dayInfo.labelColor, 'rgb(255, 255, 255)');
        if (ratio !== null && ratio < 4.5) {
          addFinding('Day view', 'Medium',
            `Time labels have contrast ${ratio.toFixed(2)}:1 against white background`,
            shot, 'Darken .fc-axis .fc-time color to at least #5f6368.');
        }
      }
    }

    if (dayInfo.eventInfo && dayInfo.eventInfo.h < 22) {
      addFinding('Day view', 'Medium',
        `Day view event "${dayInfo.eventInfo.text}" is only ${dayInfo.eventInfo.h}px tall (may clip time/title)`,
        shot, 'Set FullCalendar slotDuration appropriately or event min-height.');
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 5. CONTACT LIST VIEW =============
  test('L6-05 - Contact list view (table, headers, rows, search, view switch)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.goto(`${BASE_URL}/cards`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2500);
    const shot = await takeScreenshot(page, 'L6-05a-contacts-list');

    const contactsInfo = await page.evaluate(() => {
      const search = document.getElementById('contacts_search');
      const searchWrap = document.querySelector('.contacts-search');
      const viewSwitch = document.querySelector('.contacts-view-switch');
      const switchBtns = viewSwitch ? viewSwitch.querySelectorAll('button') : [];
      const tableHeader = document.querySelector('.contacts-table-header');
      const headerSpans = tableHeader ? tableHeader.querySelectorAll('span') : [];
      const listContainer = document.getElementById('contacts_list');
      const rows = document.querySelectorAll('#contacts_rows .contact-row, #contacts_rows > div');
      const empty = document.getElementById('contacts_empty');
      const loading = document.getElementById('contacts_loading');
      const createBtn = document.getElementById('contact_create');
      const heading = document.querySelector('.contacts-heading h1');
      const countSpan = document.getElementById('contact_count');

      // Table header columns
      const headerLabels = Array.from(headerSpans).map(s => s.textContent.trim().slice(0, 20));

      // First row detail
      const firstRow = rows[0];
      const rowInfo = firstRow ? (() => {
        const r = firstRow.getBoundingClientRect();
        const s = window.getComputedStyle(firstRow);
        return { w: Math.round(r.width), h: Math.round(r.height), bg: s.backgroundColor, borderBottom: s.borderBottom };
      })() : null;

      // Search input detail
      const searchInfo = search ? (() => {
        const r = search.getBoundingClientRect();
        const s = window.getComputedStyle(search);
        return { w: Math.round(r.width), h: Math.round(r.height), placeholder: search.placeholder, type: search.type, fontSize: s.fontSize };
      })() : null;

      // View switch button detail
      const switchInfo = viewSwitch ? (() => {
        const r = viewSwitch.getBoundingClientRect();
        const btnInfos = Array.from(switchBtns).map(b => {
          const br = b.getBoundingClientRect();
          return { label: b.textContent.trim().slice(0, 10), w: Math.round(br.width), h: Math.round(br.height), pressed: b.getAttribute('aria-pressed') };
        });
        return { w: Math.round(r.width), h: Math.round(r.height), visible: r.width > 0, buttons: btnInfos };
      })() : null;

      return {
        searchPresent: !!search,
        searchInfo,
        viewSwitchPresent: !!viewSwitch,
        viewSwitchInfo: switchInfo,
        tableHeaderPresent: !!tableHeader,
        headerLabels,
        headerVisible: tableHeader ? tableHeader.getBoundingClientRect().width > 0 : false,
        listPresent: !!listContainer,
        listVisible: listContainer ? listContainer.getBoundingClientRect().width > 0 : false,
        rowCount: rows.length,
        rowInfo,
        emptyPresent: !!empty,
        emptyVisible: empty ? !empty.hidden && empty.getBoundingClientRect().width > 0 : false,
        loadingPresent: !!loading,
        loadingVisible: loading ? !loading.hidden && loading.getBoundingClientRect().width > 0 : false,
        createBtnPresent: !!createBtn,
        createBtnVisible: createBtn ? createBtn.getBoundingClientRect().width > 0 : false,
        headingText: heading ? heading.textContent.trim().slice(0, 40) : null,
        countText: countSpan ? countSpan.textContent.trim().slice(0, 20) : null,
      };
    });
    console.log(`\n[L6-05 CONTACTS] ${JSON.stringify(contactsInfo).slice(0, 1000)}`);

    // Search input
    if (!contactsInfo.searchPresent) {
      addFinding('Contacts', 'High',
        'Contact search input (#contacts_search) is missing',
        shot, 'Render the search input in .contacts-search-row.');
    } else if (contactsInfo.searchInfo.h < 36) {
      addFinding('Contacts', 'Medium',
        `Contact search input is only ${contactsInfo.searchInfo.h}px tall (too small)`,
        shot, 'Set min-height: 40px on #contacts_search.');
    }

    // View switch
    if (!contactsInfo.viewSwitchPresent) {
      addFinding('Contacts', 'Medium',
        'Contact view switch buttons (.contacts-view-switch) are missing',
        shot, 'Render the List/Cards view toggle.');
    } else if (contactsInfo.viewSwitchInfo) {
      contactsInfo.viewSwitchInfo.buttons.forEach(b => {
        if (b.h < 32) {
          addFinding('Contacts', 'Low',
            `View switch button "${b.label}" is only ${b.h}px tall`,
            shot, 'Set min-height: 36px on .contacts-view-switch button.');
        }
      });
    }

    // Table header
    if (!contactsInfo.tableHeaderPresent) {
      addFinding('Contacts', 'Medium',
        'Contact table header (.contacts-table-header) is missing',
        shot, 'Render the column header row with Name/Email/Phone/etc.');
    } else if (!contactsInfo.headerVisible) {
      addFinding('Contacts', 'Medium',
        'Contact table header is present but not visible',
        shot, 'Ensure .contacts-table-header is displayed.');
    }

    // Loading state still visible after 2.5s
    if (contactsInfo.loadingVisible) {
      addFinding('Contacts', 'Medium',
        'Contacts "Loading..." state is still visible after 2.5s (fetch may be stuck)',
        shot, 'Verify /cards/contacts API responds and hides #contacts_loading.');
    }

    // Empty state vs rows
    if (contactsInfo.rowCount === 0 && !contactsInfo.emptyVisible && !contactsInfo.loadingVisible) {
      addFinding('Contacts', 'Medium',
        'No contacts shown, no loading indicator, and no empty-state message visible',
        shot, 'Show #contacts_empty when no contacts exist.');
    }

    // Create button
    if (!contactsInfo.createBtnPresent) {
      addFinding('Contacts', 'High',
        '"Create contact" button (#contact_create) is missing from sidebar',
        shot, 'Render #contact_create in .cards-sidebar.');
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 6. CONTACT DETAIL DIALOG =============
  test('L6-06 - Contact detail dialog (layout, fields, escape-to-close)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.goto(`${BASE_URL}/cards`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Click create contact
    const createBtn = page.locator('#contact_create').first();
    await createBtn.click().catch(() => {});
    await page.waitForTimeout(1000);
    const shot = await takeScreenshot(page, 'L6-06a-contact-dialog');

    const dialogInfo = await page.evaluate(() => {
      const dialog = document.getElementById('contact_dialog');
      if (!dialog) return { present: false };
      const s = window.getComputedStyle(dialog);
      const r = dialog.getBoundingClientRect();
      const form = document.getElementById('contact_form');
      const title = document.getElementById('contact_dialog_title');
      const inputs = dialog.querySelectorAll('input, select, textarea');
      const labels = dialog.querySelectorAll('label');
      const cancelBtn = document.getElementById('contact_cancel');
      const cancelIcon = document.getElementById('contact_cancel_icon');
      const submitBtn = dialog.querySelector('button[type="submit"]');

      // First field spacing
      const firstLabel = labels[0];
      const firstInput = inputs[0];
      const labelMarginBottom = firstLabel ? window.getComputedStyle(firstLabel).marginBottom : null;
      const inputSpacing = firstInput ? (() => {
        const ir = firstInput.getBoundingClientRect();
        return { w: Math.round(ir.width), h: Math.round(ir.height) };
      })() : null;

      // Dialog position and sizing
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      const overflowRight = r.right > viewportW;
      const overflowBottom = r.bottom > viewportH;

      return {
        present: true,
        visible: !dialog.hidden && r.width > 0,
        role: dialog.getAttribute('role'),
        ariaModal: dialog.getAttribute('aria-modal'),
        ariaLabelledby: dialog.getAttribute('aria-labelledby'),
        rect: { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left) },
        overflowRight,
        overflowBottom,
        formPresent: !!form,
        titlePresent: !!title,
        titleText: title ? title.textContent.trim() : null,
        inputCount: inputs.length,
        labelCount: labels.length,
        labelMarginBottom,
        inputSpacing,
        cancelPresent: !!cancelBtn,
        cancelIconPresent: !!cancelIcon,
        submitPresent: !!submitBtn,
        submitText: submitBtn ? submitBtn.textContent.trim() : null,
        // Check that inputs have associated labels
        unlabeledInputs: Array.from(inputs).filter(inp => {
          const id = inp.id;
          return id && !dialog.querySelector(`label[for="${id}"]`);
        }).length,
      };
    });
    console.log(`\n[L6-06 DIALOG] ${JSON.stringify(dialogInfo).slice(0, 900)}`);

    if (!dialogInfo.present) {
      addFinding('Contact dialog', 'High',
        'Contact dialog (#contact_dialog) is missing from the DOM',
        shot, 'Render #contact_dialog in cards.html.');
    } else {
      if (!dialogInfo.visible) {
        addFinding('Contact dialog', 'High',
          'Clicking "Create contact" does not make #contact_dialog visible',
          shot, 'Ensure #contact_create click handler removes [hidden] from #contact_dialog.');
      } else {
        if (dialogInfo.role !== 'dialog') {
          addFinding('Contact dialog', 'Medium',
            `Contact dialog role is "${dialogInfo.role}" (expected "dialog")`,
            shot, 'Set role="dialog" on #contact_dialog.');
        }
        if (dialogInfo.ariaModal !== 'true') {
          addFinding('Contact dialog', 'Medium',
            'Contact dialog missing aria-modal="true"',
            shot, 'Add aria-modal="true" to #contact_dialog.');
        }
        if (!dialogInfo.titlePresent) {
          addFinding('Contact dialog', 'Medium',
            'Contact dialog has no title element (#contact_dialog_title)',
            shot, 'Add <h2 id="contact_dialog_title">.');
        }
        if (!dialogInfo.ariaLabelledby && !dialogInfo.titlePresent) {
          addFinding('Contact dialog', 'Medium',
            'Contact dialog has no aria-labelledby or accessible title',
            shot, 'Add aria-labelledby="contact_dialog_title".');
        }
        if (dialogInfo.overflowRight || dialogInfo.overflowBottom) {
          addFinding('Contact dialog', 'High',
            `Contact dialog overflows viewport (right: ${dialogInfo.overflowRight}, bottom: ${dialogInfo.overflowBottom})`,
            shot, 'Constrain dialog max-width and max-height to viewport with overflow auto.');
        }
        if (dialogInfo.inputCount < 3) {
          addFinding('Contact dialog', 'Medium',
            `Contact dialog has only ${dialogInfo.inputCount} inputs (expected name/email/phone/company/jobtitle)`,
            shot, 'Ensure all form fields render in the contact dialog.');
        }
        if (dialogInfo.unlabeledInputs > 0) {
          addFinding('Contact dialog', 'Medium',
            `${dialogInfo.unlabeledInputs} inputs in contact dialog lack an associated <label for>`,
            shot, 'Add label[for] for each input in the contact dialog.');
        }
        if (dialogInfo.inputSpacing && dialogInfo.inputSpacing.w < 200) {
          addFinding('Contact dialog', 'Low',
            `Contact dialog input is only ${dialogInfo.inputSpacing.w}px wide (too narrow for comfortable typing)`,
            shot, 'Set min-width: 240px on contact dialog inputs.');
        }
      }

      // Test Escape key closes the dialog
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      const stillVisible = await page.evaluate(() => {
        const d = document.getElementById('contact_dialog');
        return d ? (!d.hidden && d.getBoundingClientRect().width > 0) : false;
      });
      if (stillVisible) {
        addFinding('Contact dialog', 'Medium',
          'Pressing Escape does not close the contact dialog',
          await takeScreenshot(page, 'L6-06b-dialog-escape-fail'),
          'Add a keydown listener for Escape that hides #contact_dialog.');
      }
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 7. MAIL INBOX LAYOUT =============
  test('L6-07 - Mail inbox layout (list, empty state, compose)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.goto(`${BASE_URL}/mail`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    const shot = await takeScreenshot(page, 'L6-07a-mail-inbox');

    const mailInfo = await page.evaluate(() => {
      const composeBtn = document.getElementById('mail_compose');
      const mailRows = document.querySelectorAll('#mail_rows .mail-row, #mail_rows > div');
      const empty = document.getElementById('mail_empty');
      const noMessages = document.getElementById('mail_no_messages');
      const loading = document.getElementById('mail_loading');
      const errorEl = document.getElementById('mail_error');
      const search = document.getElementById('mail_search');
      const title = document.getElementById('mail_account_title');
      const refresh = document.getElementById('mail_refresh');
      const accounts = document.getElementById('mail_accounts');

      const isHidden = el => {
        if (!el) return true;
        if (el.hidden) return true;
        const s = window.getComputedStyle(el);
        return s.display === 'none' || s.visibility === 'hidden' || el.getBoundingClientRect().width === 0;
      };

      // First row detail
      const firstRow = mailRows[0];
      const rowInfo = firstRow ? (() => {
        const r = firstRow.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), text: firstRow.textContent.trim().replace(/\s+/g, ' ').slice(0, 60) };
      })() : null;

      return {
        composePresent: !!composeBtn,
        composeVisible: composeBtn ? !isHidden(composeBtn) : false,
        rowCount: mailRows.length,
        rowInfo,
        emptyPresent: !!empty,
        emptyVisible: empty ? !isHidden(empty) : false,
        emptyHasAddAccount: empty ? !!empty.querySelector('a, .btn') : false,
        noMessagesPresent: !!noMessages,
        noMessagesVisible: noMessages ? !isHidden(noMessages) : false,
        loadingPresent: !!loading,
        loadingVisible: loading ? !isHidden(loading) : false,
        errorPresent: !!errorEl,
        errorVisible: errorEl ? !isHidden(errorEl) : false,
        errorText: errorEl && !errorEl.hidden ? errorEl.textContent.trim().slice(0, 80) : null,
        searchPresent: !!search,
        titleText: title ? title.textContent.trim() : null,
        refreshPresent: !!refresh,
        refreshVisible: refresh ? refresh.getBoundingClientRect().width > 0 : false,
        accountsPresent: !!accounts,
        accountsChildCount: accounts ? accounts.children.length : 0,
      };
    });
    console.log(`\n[L6-07 MAIL] ${JSON.stringify(mailInfo).slice(0, 900)}`);

    if (!mailInfo.composePresent) {
      addFinding('Mail', 'High',
        'Mail compose button (#mail_compose) is missing',
        shot, 'Render #mail_compose in the mail sidebar.');
    }

    if (!mailInfo.searchPresent) {
      addFinding('Mail', 'Medium',
        'Mail search input (#mail_search) is missing',
        shot, 'Render the search field in .mail-search-row.');
    }

    // Check empty / loading / error states
    if (mailInfo.rowCount === 0) {
      if (!mailInfo.emptyVisible && !mailInfo.noMessagesVisible && !mailInfo.loadingVisible) {
        addFinding('Mail', 'Medium',
          'Mail inbox has no messages and no visible empty/loading/error state',
          shot, 'Show #mail_empty, #mail_no_messages, or #mail_loading.');
      }
      if (mailInfo.emptyVisible && !mailInfo.emptyHasAddAccount) {
        addFinding('Mail', 'Low',
          'Mail empty state is visible but has no "Add account" action link',
          shot, 'Include a link to preferences in the empty state.');
      }
    }

    if (mailInfo.errorVisible && mailInfo.errorText) {
      // Error visible is not necessarily a UI bug — but if it's a raw error, flag it
      if (/exception|stack|trace|panic|unwrap/i.test(mailInfo.errorText)) {
        addFinding('Mail', 'High',
          `Mail shows a raw internal error: "${mailInfo.errorText}"`,
          shot, 'Catch mail fetch errors and show user-friendly message.');
      }
    }

    if (!mailInfo.refreshPresent) {
      addFinding('Mail', 'Low',
        'Mail refresh button (#mail_refresh) is missing',
        shot, 'Add a refresh button to the mail toolbar.');
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 8. NAVBAR BRAND/TITLE =============
  test('L6-08 - Navbar brand/title (text, styling, height, responsive)', async ({ page }) => {
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(800);
    const shotDesktop = await takeScreenshot(page, 'L6-08a-navbar-desktop');

    const navbarInfo = await page.evaluate(() => {
      const navbar = document.querySelector('.navbar, .caldaver-topbar');
      const brand = document.querySelector('.navbar-brand');
      const brandTitle = document.querySelector('.caldaver-brand-title');
      const sidebrand = document.querySelector('.caldaver-sidebrand');

      const r = el => el ? (() => {
        const rect = el.getBoundingClientRect();
        return { w: Math.round(rect.width), h: Math.round(rect.height), top: Math.round(rect.top) };
      })() : null;
      const s = el => el ? (() => {
        const cs = window.getComputedStyle(el);
        return { height: cs.height, minHeight: cs.minHeight, bg: cs.backgroundColor, color: cs.color, fontSize: cs.fontSize, fontWeight: cs.fontWeight, display: cs.display, alignItems: cs.alignItems };
      })() : null;

      return {
        navbarPresent: !!navbar,
        navbarRect: r(navbar),
        navbarStyle: s(navbar),
        brandPresent: !!brand,
        brandRect: r(brand),
        brandStyle: s(brand),
        brandText: brandTitle ? brandTitle.textContent.trim() : null,
        sidebrandPresent: !!sidebrand,
        sidebrandText: sidebrand ? sidebrand.textContent.trim() : null,
        sidebrandStyle: s(sidebrand),
      };
    });
    console.log(`\n[L6-08 NAVBAR] ${JSON.stringify(navbarInfo).slice(0, 900)}`);

    if (!navbarInfo.navbarPresent) {
      addFinding('Navbar', 'High',
        'Navbar (.caldaver-topbar) is missing from the page',
        shotDesktop, 'Render the navbar in the page template.');
    } else {
      // Navbar height
      if (navbarInfo.navbarRect && navbarInfo.navbarRect.h > 70) {
        addFinding('Navbar', 'Low',
          `Navbar is ${navbarInfo.navbarRect.h}px tall (Google Calendar uses ~56-64px; taller wastes space)`,
          shotDesktop, 'Consider reducing navbar min-height to ~56-60px.');
      }
      if (navbarInfo.navbarRect && navbarInfo.navbarRect.h < 40) {
        addFinding('Navbar', 'Medium',
          `Navbar is only ${navbarInfo.navbarRect.h}px tall (too cramped for touch targets)`,
          shotDesktop, 'Set navbar min-height to at least 48px.');
      }
    }

    // Brand title
    if (!navbarInfo.brandPresent) {
      addFinding('Navbar', 'Medium',
        'Navbar brand element (.navbar-brand) is missing',
        shotDesktop, 'Add the brand span in the navbar header.');
    }
    if (navbarInfo.brandText !== null && navbarInfo.brandText.length === 0) {
      addFinding('Navbar', 'Medium',
        'Navbar brand title text is empty',
        shotDesktop, 'Set the page title so .caldaver-brand-title renders text.');
    }

    // Check responsive at narrow width
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(800);
    const shotMobile = await takeScreenshot(page, 'L6-08b-navbar-mobile');
    const mobileNavbar = await page.evaluate(() => {
      const navbar = document.querySelector('.navbar, .caldaver-topbar');
      const brand = document.querySelector('.navbar-brand');
      const hamburger = document.querySelector('.mobile-section-menu > summary, .topbar-menu');
      const r = el => el ? el.getBoundingClientRect() : null;
      return {
        navbarW: navbar ? Math.round(r(navbar).width) : 0,
        navbarH: navbar ? Math.round(r(navbar).height) : 0,
        brandW: brand ? Math.round(r(brand).width) : 0,
        brandOverflow: brand ? (r(brand).right > window.innerWidth) : false,
        hamburgerPresent: !!hamburger,
        hamburgerVisible: hamburger ? r(hamburger).width > 0 : false,
      };
    });
    console.log(`[L6-08 MOBILE NAVBAR] ${JSON.stringify(mobileNavbar)}`);

    if (mobileNavbar.brandOverflow) {
      addFinding('Navbar', 'High',
        'Navbar brand overflows viewport on mobile (375px) causing horizontal scroll',
        shotMobile, 'Constrain .navbar-brand width or truncate long titles.');
    }
    if (!mobileNavbar.hamburgerPresent || !mobileNavbar.hamburgerVisible) {
      addFinding('Navbar', 'Medium',
        'No visible hamburger/section menu on mobile navbar',
        shotMobile, 'Reveal .mobile-section-menu summary at narrow widths.');
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 9. FOOTER =============
  test('L6-09 - Footer (text, positioning, visibility)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.waitForTimeout(1500);
    const shot = await takeScreenshot(page, 'L6-09a-footer');

    const footerInfo = await page.evaluate(() => {
      const footer = document.getElementById('footer');
      const footerInSidebar = footer && footer.closest('#sidebar');
      const bodyFooter = document.querySelector('body > footer, #content > footer');

      const isHidden = el => {
        if (!el) return true;
        if (el.hidden) return true;
        const s = window.getComputedStyle(el);
        return s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0;
      };

      const detail = el => el ? (() => {
        const r = el.getBoundingClientRect();
        const s = window.getComputedStyle(el);
        return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom), position: s.position, fontSize: s.fontSize, color: s.color, bg: s.backgroundColor };
      })() : null;

      return {
        sidebarFooterPresent: !!footer,
        sidebarFooterVisible: footer ? !isHidden(footer) : false,
        sidebarFooterText: footer ? footer.textContent.trim().slice(0, 100) : null,
        sidebarFooterDetail: detail(footer),
        footerInSidebar: !!footerInSidebar,
        bodyFooterPresent: !!bodyFooter,
      };
    });
    console.log(`\n[L6-09 FOOTER] ${JSON.stringify(footerInfo).slice(0, 700)}`);

    if (!footerInfo.sidebarFooterPresent) {
      addFinding('Footer', 'Low',
        'No #footer element found on the calendar page',
        shot, 'Include <div id="footer"> in the sidebar template.');
    } else if (!footerInfo.sidebarFooterVisible) {
      addFinding('Footer', 'Low',
        '#footer is present but not visible',
        shot, 'Ensure footer is not hidden by overflow or CSS.');
    } else {
      // Footer height — should be small
      if (footerInfo.sidebarFooterDetail && footerInfo.sidebarFooterDetail.h > 100) {
        addFinding('Footer', 'Low',
          `Footer is ${footerInfo.sidebarFooterDetail.h}px tall (unusually large for a sidebar footer)`,
          shot, 'Keep footer content compact.');
      }
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 10. SCROLL BEHAVIOR =============
  test('L6-10 - Scroll behavior (independent calendar/sidebar, sticky headers)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.waitForTimeout(2000);
    const shot = await takeScreenshot(page, 'L6-10a-scroll-check');

    const scrollInfo = await page.evaluate(() => {
      const sidebar = document.getElementById('sidebar');
      const content = document.getElementById('content');
      const calendar = document.getElementById('calendar_view');
      const body = document.body;
      const html = document.documentElement;

      const detail = el => el ? (() => {
        const s = window.getComputedStyle(el);
        return {
          overflow: s.overflow,
          overflowY: s.overflowY,
          overflowX: s.overflowX,
          scrollH: el.scrollHeight,
          clientH: el.clientHeight,
          canScroll: el.scrollHeight > el.clientHeight + 2,
          position: s.position,
          height: s.height,
        };
      })() : null;

      return {
        bodyOverflow: window.getComputedStyle(body).overflow,
        htmlOverflow: window.getComputedStyle(html).overflow,
        bodyScrollH: body.scrollHeight,
        bodyClientH: body.clientHeight,
        bodyCanScroll: body.scrollHeight > body.clientHeight + 2,
        sidebarDetail: detail(sidebar),
        contentDetail: detail(content),
        calendarDetail: detail(calendar),
        stickyHeader: (() => {
          // Check for sticky positioned headers
          const sticky = document.querySelectorAll('*');
          for (const el of sticky) {
            const s = window.getComputedStyle(el);
            if (s.position === 'sticky' && el.getBoundingClientRect().height > 0) {
              return { tag: el.tagName, class: (el.className || '').toString().slice(0, 40) };
            }
          }
          return null;
        })(),
      };
    });
    console.log(`\n[L6-10 SCROLL] ${JSON.stringify(scrollInfo).slice(0, 900)}`);

    // Calendar should scroll independently (overflow auto/scroll on content or calendar)
    if (scrollInfo.calendarDetail && scrollInfo.calendarDetail.overflow === 'visible' && scrollInfo.calendarDetail.overflowY === 'visible') {
      addFinding('Scroll', 'Medium',
        'Calendar view container has no overflow handling (scrolls with the whole page instead of independently)',
        shot, 'Set overflow: auto on #content or #calendar_view so the calendar scrolls independently.');
    }

    // Body-level scroll — calendar page should NOT cause body to scroll
    if (scrollInfo.bodyCanScroll) {
      addFinding('Scroll', 'Low',
        `Entire body scrolls (${scrollInfo.bodyScrollH - scrollInfo.bodyClientH}px overflow) — calendar should scroll internally, not the body`,
        shot, 'Set body overflow: hidden on the calendar page and enable overflow on the inner containers.');
    }

    // Sidebar scroll
    if (scrollInfo.sidebarDetail && scrollInfo.sidebarDetail.canScroll && scrollInfo.sidebarDetail.overflowY !== 'auto' && scrollInfo.sidebarDetail.overflowY !== 'scroll') {
      addFinding('Scroll', 'Low',
        'Sidebar content overflows but has no scroll handling (content may be cut off)',
        shot, 'Set overflow-y: auto on #sidebar.');
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 11. TOOLTIP / POPOVER POSITIONING =============
  test('L6-11 - Tooltip/popover positioning (hover events, viewport overflow)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await gotoToday(page);
    await page.waitForTimeout(1500);

    // Find events to hover
    const eventInfo = await page.evaluate(() => {
      const events = document.querySelectorAll('#calendar_view .fc-time-grid-event, #calendar_view .fc-event');
      return Array.from(events).slice(0, 5).map(e => {
        const r = e.getBoundingClientRect();
        return { text: (e.textContent || '').trim().slice(0, 30), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
      });
    });
    console.log(`\n[L6-11 EVENTS FOR HOVER] ${JSON.stringify(eventInfo)}`);

    const shot = await takeScreenshot(page, 'L6-11a-before-hover');

    if (eventInfo.length === 0) {
      // No events to hover — check qtip setup exists in the page
      const qtipInfo = await page.evaluate(() => {
        return {
          qtipDefined: typeof $.fn !== 'undefined' && typeof $.fn.qtip === 'function',
          qtipElements: document.querySelectorAll('.qtip').length,
        };
      });
      console.log(`[L6-11 QTIP] ${JSON.stringify(qtipInfo)}`);
      if (!qtipInfo.qtipDefined) {
        addFinding('Tooltips', 'Low',
          'qTip2 plugin is not loaded (no event hover tooltips will appear)',
          shot, 'Ensure jQuery qTip2 is included for event hover popovers.');
      }
    } else {
      // Hover over the first event
      const ev = eventInfo[0];
      await page.mouse.move(ev.x, ev.y);
      await page.waitForTimeout(1500);
      const shotHover = await takeScreenshot(page, 'L6-11b-after-hover');

      const tooltipInfo = await page.evaluate(() => {
        const tooltips = document.querySelectorAll('.qtip, .tooltip, .popover, [role="tooltip"]');
        const visibleTooltips = Array.from(tooltips).filter(t => {
          const s = window.getComputedStyle(t);
          if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
          return t.getBoundingClientRect().width > 0;
        });
        if (visibleTooltips.length === 0) return { found: false, count: tooltips.length };

        const tip = visibleTooltips[0];
        const r = tip.getBoundingClientRect();
        return {
          found: true,
          role: tip.getAttribute('role'),
          text: tip.textContent.trim().slice(0, 100),
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          overflowsLeft: r.x < 0,
          overflowsRight: r.right > window.innerWidth,
          overflowsTop: r.y < 0,
          overflowsBottom: r.bottom > window.innerHeight,
          viewport: { w: window.innerWidth, h: window.innerHeight },
        };
      });
      console.log(`[L6-11 TOOLTIP] ${JSON.stringify(tooltipInfo)}`);

      if (!tooltipInfo.found) {
        addFinding('Tooltips', 'Medium',
          'Hovering over a calendar event does not show any tooltip/popover',
          shotHover, 'Wire event mouseover to show a qTip2 tooltip with event details.');
      } else {
        if (tooltipInfo.role !== 'tooltip' && tooltipInfo.role !== 'dialog') {
          addFinding('Tooltips', 'Low',
            `Event tooltip has role="${tooltipInfo.role}" (expected "tooltip" or "dialog")`,
            shotHover, 'Set role="tooltip" on the qtip container.');
        }
        if (tooltipInfo.overflowsLeft || tooltipInfo.overflowsRight || tooltipInfo.overflowsTop || tooltipInfo.overflowsBottom) {
          addFinding('Tooltips', 'High',
            `Event tooltip overflows viewport (L:${tooltipInfo.overflowsLeft} R:${tooltipInfo.overflowsRight} T:${tooltipInfo.overflowsTop} B:${tooltipInfo.overflowsBottom})`,
            shotHover, 'Set qTip viewport: $(window) so tooltips auto-flip within the viewport.');
        }
      }
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 12. FOCUS INDICATORS =============
  test('L6-12 - Focus indicators (tab through calendar, visible focus rings)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.waitForTimeout(1500);

    // Tab through the page and check focus visibility
    const focusResults = [];
    const skipLink = page.locator('.skip-link').first();

    // First, click somewhere neutral then tab
    await page.mouse.click(10, 200);
    await page.waitForTimeout(200);

    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(150);
      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const s = window.getComputedStyle(el);
        const r = el.getBoundingClientRect();
        // Check if focus ring is visible
        const hasOutline = s.outlineStyle !== 'none' && s.outlineWidth !== '0px';
        const hasBoxShadow = s.boxShadow && !s.boxShadow.includes('none');
        const hasBorder = s.borderColor !== 'rgba(0, 0, 0, 0)' && s.borderColor !== 'transparent';
        return {
          tag: el.tagName,
          id: el.id || null,
          class: (el.className || '').toString().slice(0, 40),
          text: (el.textContent || '').trim().slice(0, 30),
          rect: { w: Math.round(r.width), h: Math.round(r.height) },
          outlineStyle: s.outlineStyle,
          outlineWidth: s.outlineWidth,
          outlineColor: s.outlineColor,
          hasVisibleFocus: hasOutline || hasBoxShadow,
          visible: r.width > 0 && r.height > 0,
        };
      });
      if (focused) {
        focusResults.push(focused);
      }
    }

    const shot = await takeScreenshot(page, 'L6-12a-focus-tabbing');
    console.log(`\n[L6-12 FOCUS] ${JSON.stringify(focusResults).slice(0, 1200)}`);

    // Check: are there elements with no visible focus indicator?
    const noFocus = focusResults.filter(f => f.visible && !f.hasVisibleFocus);
    if (noFocus.length > 0) {
      addFinding('Focus indicators', noFocus.length > 3 ? 'High' : 'Medium',
        `${noFocus.length} focusable element(s) lack a visible focus indicator (outline/box-shadow). Examples: ${noFocus.slice(0, 3).map(f => `<${f.tag}${f.id ? ' #' + f.id : ''}>`).join(', ')}`,
        shot, 'Ensure :focus-visible has a visible outline (e.g. outline: 2px solid #1a73e8) on all interactive elements.');
    }

    // Check skip link is reachable first
    const skipReachable = focusResults.some(f => f.class && f.class.includes('skip-link') || f.class && f.class.includes('skip'));
    if (!skipReachable) {
      addFinding('Focus indicators', 'Low',
        'Skip link was not reached via Tab in the first 15 presses (may not be first in tab order)',
        shot, 'Ensure .skip-link is the very first focusable element.');
    }

    // Check focus order is logical (no skipping from navbar to footer to sidebar randomly)
    // We check that we don't see body as activeElement with no tab progress (focus trap broken)
    const focusProgress = focusResults.length;
    if (focusProgress < 3) {
      addFinding('Focus indicators', 'Medium',
        `Tab key only advanced focus ${focusProgress} times in 15 presses (focus may be trapped or broken)`,
        shot, 'Verify tabbable elements exist and tabindex is not misconfigured.');
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 13. DARK MODE / PRINT STYLES =============
  test('L6-13 - Dark mode and print styles', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.waitForTimeout(1000);

    // Check for print stylesheet link
    const printInfo = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('link[rel="stylesheet"], link[rel~="stylesheet"]'));
      const printLinks = links.filter(l => {
        const media = (l.getAttribute('media') || '').toLowerCase();
        return media.includes('print');
      });
      const printHref = printLinks.length > 0 ? printLinks[0].getAttribute('href') : null;

      // Scan for @media print rules
      let mediaPrintRules = 0;
      let mediaPrefersColorScheme = 0;
      let totalRules = 0;
      for (const sheet of document.styleSheets) {
        try {
          const walk = rules => {
            for (const rule of rules) {
              if (rule instanceof CSSMediaRule) {
                const mediaText = (rule.media && rule.media.mediaText) || '';
                if (mediaText.includes('print')) {
                  mediaPrintRules += rule.cssRules.length;
                }
                if (mediaText.includes('prefers-color-scheme')) {
                  mediaPrefersColorScheme += rule.cssRules.length;
                }
              }
              if (rule instanceof CSSStyleRule) totalRules++;
              if (rule.cssRules && !(rule instanceof CSSMediaRule)) walk(rule.cssRules);
            }
          };
          walk(sheet.cssRules || []);
        } catch (e) { /* cross-origin */ }
      }

      // Check for meta color-scheme
      const colorSchemeMeta = document.querySelector('meta[name="color-scheme"]');
      const themeColorMeta = document.querySelector('meta[name="theme-color"]');

      return {
        printLinkPresent: printLinks.length > 0,
        printLinkHref: printHref,
        printLinkCount: printLinks.length,
        mediaPrintRules,
        mediaPrefersColorSchemeRules: mediaPrefersColorScheme,
        totalRules,
        colorSchemeMeta: colorSchemeMeta ? colorSchemeMeta.getAttribute('content') : null,
        themeColorMeta: themeColorMeta ? themeColorMeta.getAttribute('content') : null,
        totalStylesheets: document.styleSheets.length,
      };
    });
    console.log(`\n[L6-13 PRINT/DARK] ${JSON.stringify(printInfo)}`);

    const shot = await takeScreenshot(page, 'L6-13a-screen-mode');

    // Print styles
    if (!printInfo.printLinkPresent && printInfo.mediaPrintRules === 0) {
      addFinding('Print/Dark', 'High',
        'No print stylesheet linked and no @media print rules in CSS (calndar cannot be printed cleanly)',
        shot, 'Add <link href="/dist/css/caldaver.print.css" media="print"> or @media print rules.');
    } else if (printInfo.printLinkPresent && printInfo.mediaPrintRules === 0 && printInfo.printLinkCount === 0) {
      addFinding('Print/Dark', 'Medium',
        'Print stylesheet link present but no @media print rules found (print CSS may be empty)',
        shot, 'Ensure caldaver.print.css has actual print rules.');
    }

    // Dark mode support
    if (printInfo.mediaPrefersColorSchemeRules === 0) {
      addFinding('Print/Dark', 'Low',
        'No prefers-color-scheme dark mode CSS rules found (no dark mode support)',
        shot, 'Add @media (prefers-color-scheme: dark) rules for dark mode support.');
    }

    // Meta color-scheme
    if (!printInfo.colorSchemeMeta) {
      addFinding('Print/Dark', 'Low',
        'No <meta name="color-scheme"> tag (browser cannot inform the page of user preference)',
        shot, 'Add <meta name="color-scheme" content="light dark"> to support system color preference.');
    }

    // Emulate print and check
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(500);
    const shotPrint = await takeScreenshot(page, 'L6-13b-print-emulation');

    const printLayoutInfo = await page.evaluate(() => {
      const sidebar = document.getElementById('sidebar');
      const calendar = document.getElementById('calendar_view');
      const navbar = document.querySelector('.navbar, .caldaver-topbar');
      const isHidden = el => {
        if (!el) return true;
        const s = window.getComputedStyle(el);
        return s.display === 'none' || s.visibility === 'hidden' || el.getBoundingClientRect().width === 0;
      };
      return {
        sidebarHiddenInPrint: isHidden(sidebar),
        navbarHiddenInPrint: isHidden(navbar),
        calendarVisibleInPrint: !isHidden(calendar),
      };
    });
    console.log(`[L6-13 PRINT LAYOUT] ${JSON.stringify(printLayoutInfo)}`);

    // In print mode, sidebar and navbar should be hidden, calendar should be visible
    if (!printLayoutInfo.sidebarHiddenInPrint) {
      addFinding('Print/Dark', 'Medium',
        'Sidebar is still visible in print emulation mode (wastes paper)',
        shotPrint, 'Add @media print { #sidebar { display: none; } } to hide sidebar when printing.');
    }
    if (!printLayoutInfo.navbarHiddenInPrint) {
      addFinding('Print/Dark', 'Medium',
        'Navbar is still visible in print emulation mode',
        shotPrint, 'Add @media print { .navbar { display: none; } } to hide navbar when printing.');
    }
    if (!printLayoutInfo.calendarVisibleInPrint) {
      addFinding('Print/Dark', 'High',
        'Calendar disappears in print emulation mode (nothing useful to print)',
        shotPrint, 'Ensure #calendar_view remains visible in @media print.');
    }

    await page.emulateMedia({ media: 'screen' });

    // Test dark mode emulation
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(500);
    const shotDark = await takeScreenshot(page, 'L6-13c-dark-mode-emulation');

    const darkModeInfo = await page.evaluate(() => {
      const body = document.body;
      const s = window.getComputedStyle(body);
      return {
        bodyBg: s.backgroundColor,
        bodyColor: s.color,
        // Check if there's any dark mode adaptation
        isDarkBg: /rgb\((1[0-9]|[2-4]\d|0), ?(1[0-9]|[2-4]\d|0), ?(1[0-9]|[2-4]\d|0)\)/.test(s.backgroundColor) ||
          s.backgroundColor === 'rgb(0, 0, 0)' ||
          /rgb\([0-4]\d, ?[0-4]\d, ?[0-4]\d\)/.test(s.backgroundColor),
      };
    });
    console.log(`[L6-13 DARK MODE] ${JSON.stringify(darkModeInfo)}`);

    await page.emulateMedia({ colorScheme: 'light' });

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= SUMMARY =============
  test('L6-14 - Summary: write findings report', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    console.log('\n\n========================================================');
    console.log('  CALDAVER LOOP 6 EDGE-CASE & POLISH AUDIT - FINDINGS');
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

    fs.writeFileSync(`${SCREENSHOT_DIR}/loop6-findings.json`, JSON.stringify({ findings: sorted, summary }, null, 2));
    expect(findings.length).toBeGreaterThanOrEqual(0);
  });
});
