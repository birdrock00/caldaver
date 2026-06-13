/**
 * Caldaver Loop 7 - Deep Visual Polish & Edge-Case UI Audit.
 *
 * Previous rounds already fixed:
 *   R1: i18n strings, mobile 44px touch targets, a11y labels
 *   R2: Calendar grid lines (1px #dadce0), dotted minor time slots
 *   R3: Today button, contact phone links 44px, radio inputs 24px
 *   R4: Keyboard shortcuts, focus trap, qtip role=dialog, 404 page, mobile
 *       bottom bar + FAB, mail reply button 44px
 *   R5: Timezone dropdown, pseudobutton contrast, event create flow, settings,
 *       responsive breakpoints, CSS audit, mobile calendar event display
 *   R6: Contact dialog a11y (role/aria-modal/Escape), search input heights,
 *       print CSS, skip link, login page, calendar sidebar list, month/day
 *       views, contacts list, mail inbox, navbar, footer, scroll behavior,
 *       tooltip positioning, focus indicators, dark mode
 *
 * This loop audits NEW, deep-polish & edge-case concerns:
 *   L7-01 Calendar header toolbar alignment (prev/next/today/left/center/right)
 *   L7-02 Calendar sidebar styling (borders, spacing, list items, toggle, FAB)
 *   L7-03 Event tooltip / popup (qtip2 details + positioning on hover)
 *   L7-04 Contacts card view (grid, avatar circles, hover, contact info)
 *   L7-05 Mobile calendar at 375px (bottom bar 5 btns, FAB, list view, title)
 *   L7-06 Mobile contacts at 375px (list layout, search, create button)
 *   L7-07 Login page visual (logo load, field spacing, error, pw toggle)
 *   L7-08 Tab order (skip link -> navbar -> sidebar -> toolbar + focus rings)
 *   L7-09 Button consistency (primary/default/icon-only + aria-labels)
 *   L7-10 Spacing / rhythm (section margins, panel padding, double/missing gaps)
 *   L7-11 Summary report
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');

const BASE_URL = 'https://caldaver.example.invalid';
const USERNAME = 'REDACTED';
const PASSWORD = 'REDACTED';
const SCREENSHOT_DIR = '/tmp/caldaver-audit-loop7';
const MIN_TOUCH = 44;

const findings = [];
const SEVERITY_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };

function addFinding(page, severity, description, screenshotPath, recommendation) {
  findings.push({
    id: `L7-${String(findings.length + 1).padStart(3, '0')}`,
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

test.describe('Caldaver Loop 7 Deep Visual Polish & Edge-Case UI Audit', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  test.setTimeout(300000);

  // ============= 1. CALENDAR HEADER TOOLBAR ALIGNMENT =============
  test('L7-01 - Calendar header toolbar alignment (prev/next/today, title, view buttons)', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await gotoToday(page);
    await switchToView(page, 'month');
    await page.waitForTimeout(1000);

    // Clip screenshot of just the toolbar area (top ~120px)
    const toolbarClip = await page.evaluate(() => {
      const tb = document.querySelector('.fc-toolbar');
      if (!tb) return null;
      const r = tb.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    });
    let shot;
    if (toolbarClip) {
      shot = await takeClipScreenshot(page, 'L7-01a-toolbar', {
        x: toolbarClip.x,
        y: Math.max(0, toolbarClip.y - 5),
        width: toolbarClip.width,
        height: toolbarClip.height + 10,
      });
    } else {
      shot = await takeScreenshot(page, 'L7-01a-toolbar-fallback');
    }

    const toolbarInfo = await page.evaluate(() => {
      const toolbar = document.querySelector('.fc-toolbar');
      if (!toolbar) return { present: false };

      const left = toolbar.querySelector('.fc-left, .fc-toolbar-chunk:first-child');
      const center = toolbar.querySelector('.fc-center, .fc-toolbar-chunk:nth-child(2)');
      const right = toolbar.querySelector('.fc-right, .fc-toolbar-chunk:last-child');

      const rect = el => el ? (() => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) };
      })() : null;

      // Helper: find a button by class OR by (case-insensitive) text content.
      const findBtn = (selector, textMatch) => {
        let el = selector ? toolbar.querySelector(selector) : null;
        if (!el && textMatch) {
          const btns = toolbar.querySelectorAll('button');
          for (const b of btns) {
            if ((b.textContent || '').trim().toLowerCase() === textMatch) { el = b; break; }
          }
        }
        return el;
      };

      // Individual buttons
      const prevBtn = findBtn('.fc-prev-button', null) || toolbar.querySelector('.fc-icon-chevron-left');
      const nextBtn = findBtn('.fc-next-button', null) || toolbar.querySelector('.fc-icon-chevron-right');
      const todayBtn = findBtn('.fc-today-button', 'today');
      const monthBtn = findBtn('.fc-month-button', 'month');
      const weekBtn = findBtn('.fc-week-button, .fc-agendaWeek-button', null);
      const dayBtn = findBtn('.fc-day-button, .fc-agendaDay-button', null);

      const titleEl = toolbar.querySelector('h2, .fc-center h2');

      // Vertical center comparison: do all chunks share roughly the same top/baseline?
      const leftR = rect(left);
      const centerR = rect(center);
      const rightR = rect(right);

      // Check button heights are uniform within left group & right group
      const leftBtns = left ? Array.from(left.querySelectorAll('button')) : [];
      const rightBtns = right ? Array.from(right.querySelectorAll('button')) : [];
      const leftHeights = leftBtns.map(b => Math.round(b.getBoundingClientRect().height));
      const rightHeights = rightBtns.map(b => Math.round(b.getBoundingClientRect().height));

      // Title centering: title center vs toolbar center
      const titleR = rect(titleEl);
      const tbR = rect(toolbar);
      const viewportW = window.innerWidth;
      let titleCenterOffset = null;
      if (titleR && tbR) {
        const titleCenter = titleR.x + titleR.w / 2;
        const refCenter = tbR.x + tbR.w / 2;
        titleCenterOffset = Math.round(titleCenter - refCenter);
      }

      // Button group: are prev/next/today in one contiguous button group?
      const leftGroup = left ? left.querySelector('.fc-button-group') : null;
      const rightGroup = right ? right.querySelector('.fc-button-group') : null;

      // Check that toolbar doesn't wrap (height too large => wrapped)
      const wrapped = tbR ? tbR.h > 90 : false;

      return {
        present: true,
        toolbarRect: tbR,
        leftRect: leftR,
        centerRect: centerR,
        rightRect: rightR,
        leftHasButtons: leftBtns.length,
        rightHasButtons: rightBtns.length,
        leftHeights,
        rightHeights,
        leftHeightsUniform: leftHeights.length > 0 ? Math.max(...leftHeights) - Math.min(...leftHeights) <= 2 : true,
        rightHeightsUniform: rightHeights.length > 0 ? Math.max(...rightHeights) - Math.min(...rightHeights) <= 2 : true,
        prevPresent: !!prevBtn,
        nextPresent: !!nextBtn,
        todayPresent: !!todayBtn,
        monthBtnPresent: !!monthBtn,
        weekBtnPresent: !!weekBtn,
        dayBtnPresent: !!dayBtn,
        titleText: titleEl ? titleEl.textContent.trim().slice(0, 40) : null,
        titleRect: titleR,
        titleCenterOffset,
        leftGroupPresent: !!leftGroup,
        rightGroupPresent: !!rightGroup,
        leftTopBottom: leftR ? [leftR.top, leftR.bottom] : null,
        centerTopBottom: centerR ? [centerR.top, centerR.bottom] : null,
        rightTopBottom: rightR ? [rightR.top, rightR.bottom] : null,
        wrapped,
        viewportW,
      };
    });
    console.log(`\n[L7-01 TOOLBAR] ${JSON.stringify(toolbarInfo).slice(0, 1100)}`);

    if (!toolbarInfo.present) {
      addFinding('Calendar toolbar', 'High',
        'FullCalendar toolbar (.fc-toolbar) is not present on the calendar page',
        shot, 'Ensure the FullCalendar header config renders prev/next/today + title + view buttons.');
    } else {
      // Missing nav buttons
      if (!toolbarInfo.prevPresent) {
        addFinding('Calendar toolbar', 'High', 'Prev navigation button missing from toolbar', shot, 'Add left: "prev" to FullCalendar header config.');
      }
      if (!toolbarInfo.nextPresent) {
        addFinding('Calendar toolbar', 'High', 'Next navigation button missing from toolbar', shot, 'Add left: "next" to FullCalendar header config.');
      }
      if (!toolbarInfo.todayPresent) {
        addFinding('Calendar toolbar', 'High', 'Today button missing from toolbar', shot, 'Add left: "today" to FullCalendar header config.');
      }

      // Missing view buttons
      if (!toolbarInfo.monthBtnPresent || !toolbarInfo.weekBtnPresent || !toolbarInfo.dayBtnPresent) {
        const missing = [];
        if (!toolbarInfo.monthBtnPresent) missing.push('month');
        if (!toolbarInfo.weekBtnPresent) missing.push('week');
        if (!toolbarInfo.dayBtnPresent) missing.push('day');
        addFinding('Calendar toolbar', 'Medium',
          `View switch buttons missing: ${missing.join(', ')}`, shot, `Add right: "month,agendaWeek,agendaDay" to FullCalendar header config.`);
      }

      // Vertical alignment of left/center/right chunks
      if (toolbarInfo.leftTopBottom && toolbarInfo.centerTopBottom && toolbarInfo.rightTopBottom) {
        const tops = [toolbarInfo.leftTopBottom[0], toolbarInfo.centerTopBottom[0], toolbarInfo.rightTopBottom[0]];
        const topSpread = Math.max(...tops) - Math.min(...tops);
        if (topSpread > 6) {
          addFinding('Calendar toolbar', 'Medium',
            `Toolbar chunks are not vertically aligned (top spread ${topSpread}px between left/center/right)`,
            shot, 'Set align-items: center on .fc-toolbar so left/center/right chunks share a baseline.');
        }
        const heights = [
          toolbarInfo.leftTopBottom[1] - toolbarInfo.leftTopBottom[0],
          toolbarInfo.centerTopBottom[1] - toolbarInfo.centerTopBottom[0],
          toolbarInfo.rightTopBottom[1] - toolbarInfo.rightTopBottom[0],
        ];
        const heightSpread = Math.max(...heights) - Math.min(...heights);
        if (heightSpread > 8) {
          addFinding('Calendar toolbar', 'Low',
            `Toolbar chunks have inconsistent heights (spread ${heightSpread}px)`,
            shot, 'Give .fc-left/.fc-center/.fc-right the same min-height.');
        }
      }

      // Title centering
      if (toolbarInfo.titleCenterOffset !== null && Math.abs(toolbarInfo.titleCenterOffset) > 25) {
        addFinding('Calendar toolbar', 'Medium',
          `Calendar title is off-center by ${toolbarInfo.titleCenterOffset}px (left/center/right balance broken)`,
            shot, 'Ensure .fc-toolbar uses display:flex with justify-content:space-between and .fc-center is truly centered.');
      }

      // Title empty
      if (toolbarInfo.titleText !== null && toolbarInfo.titleText.length === 0) {
        addFinding('Calendar toolbar', 'Medium', 'Calendar toolbar title (h2) is empty', shot, 'Set FullCalendar titleFormat so the month/year title renders.');
      }

      // Button height uniformity within groups
      if (!toolbarInfo.leftHeightsUniform) {
        addFinding('Calendar toolbar', 'Low',
          `Left toolbar buttons have non-uniform heights: [${toolbarInfo.leftHeights.join(', ')}]px`,
          shot, 'Give .fc-left button group a fixed height.');
      }
      if (!toolbarInfo.rightHeightsUniform) {
        addFinding('Calendar toolbar', 'Low',
          `Right view buttons have non-uniform heights: [${toolbarInfo.rightHeights.join(', ')}]px`,
          shot, 'Give .fc-right button group a fixed height.');
      }

      // Toolbar wrapping at desktop width
      if (toolbarInfo.wrapped) {
        addFinding('Calendar toolbar', 'High',
          'Calendar toolbar is wrapping onto multiple rows at 1280px desktop width',
          shot, 'Add flex-wrap: nowrap or reduce button text so the toolbar stays on one row.');
      }
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
    await ctx.close();
  });

  // ============= 2. CALENDAR SIDEBAR STYLING =============
  test('L7-02 - Calendar sidebar styling (borders, spacing, list items, toggle, create button)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.waitForTimeout(1500);

    // Clip the sidebar
    const sidebarClip = await page.evaluate(() => {
      const sb = document.getElementById('sidebar');
      if (!sb) return null;
      const r = sb.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    });
    let shot;
    if (sidebarClip) {
      shot = await takeClipScreenshot(page, 'L7-02a-sidebar', sidebarClip);
    } else {
      shot = await takeScreenshot(page, 'L7-02a-sidebar-fallback');
    }

    const sidebarInfo = await page.evaluate(() => {
      const sb = document.getElementById('sidebar');
      if (!sb) return { present: false };

      const panels = sb.querySelectorAll('.panel');
      const createBtn = document.getElementById('shortcut_add_event');
      const toggleBtn = document.getElementById('toggle_all_calendars') || sb.querySelector('.sidebar-toggle, .panel-heading a[data-toggle]');
      const ownList = document.getElementById('own_calendar_list');
      const listItems = ownList ? ownList.querySelectorAll('li.available_calendar, li') : [];
      const shortcuts = document.getElementById('shortcuts');

      const cs = el => el ? (() => {
        const s = window.getComputedStyle(el);
        return {
          border: s.border, borderTop: s.borderTop, borderBottom: s.borderBottom,
          borderRight: s.borderRight, borderLeft: s.borderLeft,
          padding: s.padding, margin: s.margin,
          bg: s.backgroundColor, radius: s.borderRadius,
        };
      })() : null;
      const rect = el => el ? (() => {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      })() : null;

      // Panel border consistency
      const panelBorders = Array.from(panels).slice(0, 4).map(p => {
        const s = window.getComputedStyle(p);
        return { borderTop: s.borderTopWidth + ' ' + s.borderTopStyle, borderRadius: s.borderRadius };
      });
      const allPanelsHaveBorder = panelBorders.length > 0 && panelBorders.every(b => b.borderTop !== '0px none');
      const allPanelsSameRadius = panelBorders.length > 0 ? panelBorders.every(b => b.borderRadius === panelBorders[0].borderRadius) : true;

      // Create button width (should be full-width inside sidebar)
      const createR = rect(createBtn);
      const createCS = createBtn ? window.getComputedStyle(createBtn) : null;
      const sbWidth = sb.getBoundingClientRect().width;
      const createWidthPct = (createR && sbWidth) ? Math.round((createR.w / sbWidth) * 100) : null;

      // Panel vertical gaps
      const panelGaps = [];
      if (panels.length >= 2) {
        for (let i = 0; i < panels.length - 1 && i < 4; i++) {
          const a = panels[i].getBoundingClientRect();
          const b = panels[i + 1].getBoundingClientRect();
          panelGaps.push(Math.round(b.top - a.bottom));
        }
      }
      const gapSpread = panelGaps.length ? Math.max(...panelGaps) - Math.min(...panelGaps) : 0;

      // List item alignment
      const firstItem = listItems[0];
      const itemInfo = firstItem ? (() => {
        const r = firstItem.getBoundingClientRect();
        const s = window.getComputedStyle(firstItem);
        const checkbox = firstItem.querySelector('input[type="checkbox"]');
        const label = firstItem.querySelector('label, .calendar_name, span');
        const cbR = checkbox ? checkbox.getBoundingClientRect() : null;
        const lblR = label ? label.getBoundingClientRect() : null;
        return {
          h: Math.round(r.height),
          paddingTop: s.paddingTop, paddingBottom: s.paddingBottom,
          lineHeight: s.lineHeight,
          // vertical center of checkbox vs vertical center of label
          cbCenter: cbR ? Math.round(cbR.top + cbR.height / 2) : null,
          lblCenter: lblR ? Math.round(lblR.top + lblR.height / 2) : null,
        };
      })() : null;

      return {
        present: true,
        sidebarWidth: Math.round(sbWidth),
        panelCount: panels.length,
        panelBorders,
        allPanelsHaveBorder,
        allPanelsSameRadius,
        panelGaps,
        gapSpread,
        createBtnPresent: !!createBtn,
        createBtnRect: createR,
        createBtnDisplay: createCS ? createCS.display : null,
        createBtnWidth: createWidthPct,
        createBtnText: createBtn ? createBtn.textContent.trim().replace(/\s+/g, ' ').slice(0, 30) : null,
        togglePresent: !!toggleBtn,
        toggleRect: rect(toggleBtn),
        ownListPresent: !!ownList,
        itemCount: listItems.length,
        itemInfo,
        shortcutsPresent: !!shortcuts,
      };
    });
    console.log(`\n[L7-02 SIDEBAR] ${JSON.stringify(sidebarInfo).slice(0, 1200)}`);

    if (!sidebarInfo.present) {
      addFinding('Calendar sidebar', 'High', '#sidebar element is missing', shot, 'Render the sidebar container.');
    } else {
      // Panel borders
      if (sidebarInfo.panelCount > 0 && !sidebarInfo.allPanelsHaveBorder) {
        addFinding('Calendar sidebar', 'Medium',
          'Some sidebar panels lack a visible border (visual inconsistency between panels)',
          shot, 'Apply a consistent 1px border to all .panel elements in the sidebar.');
      }
      if (sidebarInfo.panelCount > 1 && !sidebarInfo.allPanelsSameRadius) {
        addFinding('Calendar sidebar', 'Low',
          'Sidebar panels have inconsistent border-radius values',
          shot, 'Standardise .panel border-radius (e.g. 4px).');
      }

      // Panel gap consistency
      if (sidebarInfo.panelGaps.length >= 2 && sidebarInfo.gapSpread > 8) {
        addFinding('Calendar sidebar', 'Medium',
          `Vertical gaps between sidebar panels are inconsistent: [${sidebarInfo.panelGaps.join(', ')}]px`,
          shot, 'Standardise margin-bottom on sidebar .panel (e.g. a single 12px gap).');
      }

      // Create button full width
      if (sidebarInfo.createBtnPresent) {
        if (sidebarInfo.createBtnWidth !== null && sidebarInfo.createBtnWidth < 80) {
          addFinding('Calendar sidebar', 'Medium',
            `"Create event" button is only ${sidebarInfo.createBtnWidth}% of sidebar width (should be full-width)`,
            shot, 'Set width:100% / display:block on #shortcut_add_event.');
        }
      } else {
        addFinding('Calendar sidebar', 'High', '"Create event" button (#shortcut_add_event) is missing', shot, 'Render the create-event shortcut in the sidebar.');
      }

      // Toggle button present + touch size
      if (sidebarInfo.togglePresent && sidebarInfo.toggleRect) {
        if (sidebarInfo.toggleRect.h < 32) {
          addFinding('Calendar sidebar', 'Low',
            `Calendar toggle button is only ${sidebarInfo.toggleRect.h}px tall`, shot, 'Increase the toggle button height.');
        }
      }

      // List item checkbox/label vertical alignment
      if (sidebarInfo.itemInfo) {
        if (sidebarInfo.itemInfo.h < 30) {
          addFinding('Calendar sidebar', 'Medium',
            `Calendar list item is only ${sidebarInfo.itemInfo.h}px tall (cramped, hard to tap)`, shot, 'Add padding to calendar list items (min-height ~36px).');
        }
        if (sidebarInfo.itemInfo.cbCenter !== null && sidebarInfo.itemInfo.lblCenter !== null) {
          const offset = Math.abs(sidebarInfo.itemInfo.cbCenter - sidebarInfo.itemInfo.lblCenter);
          if (offset > 4) {
            addFinding('Calendar sidebar', 'Low',
              `Calendar list checkbox and label are not vertically aligned (off by ${offset}px)`, shot, 'Vertically center the checkbox and label text in each calendar list item.');
          }
        }
      }
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 3. EVENT TOOLTIP / POPUP =============
  test('L7-03 - Event tooltip/popup (qtip2 details + positioning)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await gotoToday(page);
    // Day view tends to show the most event detail blocks to hover
    await switchToView(page, 'month');
    await page.waitForTimeout(1200);

    const eventTargets = await page.evaluate(() => {
      const events = document.querySelectorAll('#calendar_view .fc-event');
      return Array.from(events).slice(0, 8).map(e => {
        const r = e.getBoundingClientRect();
        return { text: (e.textContent || '').trim().slice(0, 30), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
      });
    });
    console.log(`\n[L7-03 EVENTS] ${JSON.stringify(eventTargets).slice(0, 500)}`);

    const shotBefore = await takeScreenshot(page, 'L7-03a-before-hover');

    // Verify qtip2 is loaded
    const qtipInfo = await page.evaluate(() => ({
      qtipDefined: typeof window.jQuery !== 'undefined' && typeof window.jQuery.fn.qtip === 'function',
      qtipElements: document.querySelectorAll('.qtip').length,
    }));
    console.log(`[L7-03 QTIP LOADED] ${JSON.stringify(qtipInfo)}`);
    if (!qtipInfo.qtipDefined) {
      addFinding('Event tooltips', 'Medium',
        'qTip2 jQuery plugin is not loaded (no event hover popups will appear)',
        shotBefore, 'Ensure jquery.qtip.js is bundled and loaded on the calendar page.');
    }

    let tooltipShown = false;
    let tooltipInfo = null;
    if (eventTargets.length > 0) {
      // Try up to 3 events to find one that opens a tooltip
      for (const ev of eventTargets.slice(0, 3)) {
        await page.mouse.move(ev.x, ev.y);
        await page.waitForTimeout(1200);
        tooltipInfo = await page.evaluate(() => {
          const tooltips = document.querySelectorAll('.qtip, .tooltip, .popover, [role="tooltip"], [role="dialog"]');
          const visible = Array.from(tooltips).filter(t => {
            const s = window.getComputedStyle(t);
            if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
            return t.getBoundingClientRect().width > 0;
          });
          if (visible.length === 0) return { found: false };
          const tip = visible[0];
          const r = tip.getBoundingClientRect();
          // Look for expected detail fields
          const text = tip.textContent || '';
          return {
            found: true,
            role: tip.getAttribute('role'),
            text: text.trim().slice(0, 160),
            rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
            overflowsLeft: r.x < 0,
            overflowsRight: r.right > window.innerWidth,
            overflowsTop: r.y < 0,
            overflowsBottom: r.bottom > window.innerHeight,
            hasTime: /(\d{1,2}:\d{2})|AM|PM/i.test(text),
            hasLocation: /location|where|@/i.test(text),
            hasTitle: text.trim().length > 0,
          };
        });
        console.log(`[L7-03 TOOLTIP TRY] ${JSON.stringify(tooltipInfo).slice(0, 400)}`);
        if (tooltipInfo.found) {
          tooltipShown = true;
          break;
        }
      }
    }

    const shotAfter = await takeScreenshot(page, 'L7-03b-after-hover');

    if (eventTargets.length === 0) {
      console.log('[L7-03] No events present on calendar to test hover; skipping tooltip checks.');
    } else if (!tooltipShown) {
      addFinding('Event tooltips', 'Medium',
        'Hovering over a calendar event does not show a tooltip/popover with details',
        shotAfter, 'Wire FullCalendar eventMouseover to a qTip2 tooltip showing title/time/location.');
    } else {
      if (!tooltipInfo.hasTitle) {
        addFinding('Event tooltips', 'Medium', 'Event tooltip appears but shows no event title', shotAfter, 'Render the event title in the qTip2 content.');
      }
      if (!tooltipInfo.hasTime && tooltipInfo.hasTitle) {
        // Only flag if there's a title (allday events legitimately have no time)
        addFinding('Event tooltips', 'Low', 'Event tooltip does not appear to show the event time', shotAfter, 'Include the event time range in the qTip2 content.');
      }
      if (tooltipInfo.overflowsLeft || tooltipInfo.overflowsRight || tooltipInfo.overflowsTop || tooltipInfo.overflowsBottom) {
        addFinding('Event tooltips', 'High',
          `Event tooltip overflows the viewport (L:${tooltipInfo.overflowsLeft} R:${tooltipInfo.overflowsRight} T:${tooltipInfo.overflowsTop} B:${tooltipInfo.overflowsBottom})`,
          shotAfter, 'Set qTip2 viewport: $(window) so tooltips auto-flip to stay on-screen.');
      }
      if (tooltipInfo.role && tooltipInfo.role !== 'tooltip' && tooltipInfo.role !== 'dialog') {
        addFinding('Event tooltips', 'Low',
          `Event tooltip has role="${tooltipInfo.role}" (expected tooltip/dialog)`, shotAfter, 'Set role="tooltip" on the qTip2 container.');
      }
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 4. CONTACTS CARD VIEW =============
  test('L7-04 - Contacts card view (grid, avatars, hover, contact info)', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.goto(`${BASE_URL}/cards`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2500);

    // Switch to Cards view (desktop default may be list)
    const cardsBtn = page.locator('.contacts-view-switch button[data-view="cards"]').first();
    if (await cardsBtn.isVisible().catch(() => false)) {
      await cardsBtn.click();
      await page.waitForTimeout(800);
    }
    const shot = await takeScreenshot(page, 'L7-04a-contacts-cards');

    const cardsInfo = await page.evaluate(() => {
      const grid = document.getElementById('contacts_cards');
      const list = document.getElementById('contacts_list');
      const cards = grid ? grid.querySelectorAll('.contact-card') : [];
      const empty = document.getElementById('contacts_empty');
      const search = document.getElementById('contacts_search');
      const switchBtns = document.querySelectorAll('.contacts-view-switch button');

      const isHidden = el => {
        if (!el) return true;
        if (el.hidden) return true;
        const s = window.getComputedStyle(el);
        return s.display === 'none' || el.getBoundingClientRect().width === 0;
      };

      // Grid layout inspection
      const gridCS = grid ? window.getComputedStyle(grid) : null;
      const gridRect = grid ? grid.getBoundingClientRect() : null;

      // First card detail
      const first = cards[0];
      const cardInfo = first ? (() => {
        const r = first.getBoundingClientRect();
        const s = window.getComputedStyle(first);
        const avatar = first.querySelector('.contact-avatar');
        const avR = avatar ? avatar.getBoundingClientRect() : null;
        const avS = avatar ? window.getComputedStyle(avatar) : null;
        const h2 = first.querySelector('h2');
        const dl = first.querySelector('dl');
        const editBtn = first.querySelector('.contact-edit');
        const delBtn = first.querySelector('.contact-delete');
        return {
          w: Math.round(r.width), h: Math.round(r.height),
          bg: s.backgroundColor, border: s.border, radius: s.borderRadius,
          boxShadow: s.boxShadow,
          avatarPresent: !!avatar,
          avatarW: avR ? Math.round(avR.width) : null,
          avatarH: avR ? Math.round(avR.height) : null,
          avatarIsCircle: avS ? (avS.borderRadius === '50%' || avS.borderRadius === '9999px') : null,
          avatarBg: avS ? avS.backgroundColor : null,
          avatarColor: avS ? avS.color : null,
          avatarText: avatar ? avatar.textContent.trim() : null,
          hasName: !!h2,
          nameText: h2 ? h2.textContent.trim().slice(0, 30) : null,
          hasDetailList: !!dl,
          detailRows: dl ? dl.querySelectorAll('dt').length : 0,
          editBtnPresent: !!editBtn,
          editBtnAriaLabel: editBtn ? editBtn.getAttribute('aria-label') : null,
          deleteBtnPresent: !!delBtn,
          deleteBtnAriaLabel: delBtn ? delBtn.getAttribute('aria-label') : null,
        };
      })() : null;

      // Count of cards per row (estimate via card width vs grid width)
      let cardsPerRow = null;
      if (first && gridRect) {
        cardsPerRow = Math.max(1, Math.round(gridRect.width / first.getBoundingClientRect().width));
      }

      return {
        gridPresent: !!grid,
        gridHidden: isHidden(grid),
        gridDisplay: gridCS ? gridCS.display : null,
        gridCols: gridCS ? gridCS.gridTemplateColumns : null,
        gridGap: gridCS ? gridCS.gap : null,
        cardCount: cards.length,
        listStillVisible: list ? !isHidden(list) : false,
        emptyVisible: empty ? !isHidden(empty) : false,
        cardInfo,
        cardsPerRow,
        switchCount: switchBtns.length,
        searchPresent: !!search,
      };
    });
    console.log(`\n[L7-04 CARDS] ${JSON.stringify(cardsInfo).slice(0, 1200)}`);

    // Grid hidden or no cards
    if (!cardsInfo.gridPresent) {
      addFinding('Contacts cards', 'High', 'Contacts card grid (#contacts_cards) is missing', shot, 'Render #contacts_cards in cards.html.');
    } else if (cardsInfo.gridHidden && !cardsInfo.emptyVisible) {
      addFinding('Contacts cards', 'Medium', 'Card grid is hidden after selecting Cards view', shot, 'Ensure clicking the "cards" view-switch button unhides #contacts_cards.');
    }

    if (cardsInfo.cardCount === 0 && !cardsInfo.emptyVisible) {
      addFinding('Contacts cards', 'Medium',
        'No contact cards rendered and no empty-state visible in cards view', shot, 'Render #contacts_empty when no contacts exist.');
    }

    if (cardsInfo.cardInfo) {
      const c = cardsInfo.cardInfo;
      // Avatar circle
      if (!c.avatarPresent) {
        addFinding('Contacts cards', 'Medium', 'Contact cards have no avatar element', shot, 'Render a .contact-avatar with initials.');
      } else {
        if (c.avatarW !== null && c.avatarW < 32) {
          addFinding('Contacts cards', 'Low',
            `Contact avatar is only ${c.avatarW}px (too small for initials)`, shot, 'Set .contact-avatar to at least 40x40px.');
        }
        if (c.avatarIsCircle === false) {
          addFinding('Contacts cards', 'Medium',
            'Contact avatars are not circular (border-radius should be 50%)', shot, 'Set border-radius: 50% on .contact-avatar.');
        }
        if (c.avatarBg && c.avatarColor) {
          const ratio = contrastRatio(c.avatarColor, c.avatarBg);
          if (ratio !== null && ratio < 3) {
            addFinding('Contacts cards', 'Medium',
              `Avatar initial contrast is ${ratio.toFixed(2)}:1 (white text on light bg)`, shot, 'Use white initials on the colored avatar background.');
          }
        }
      }
      // Card has name
      if (!c.hasName) {
        addFinding('Contacts cards', 'Medium', 'Contact card has no <h2> name heading', shot, 'Render the contact full_name in an <h2> in each card.');
      }
      // Detail list
      if (c.detailRows < 2) {
        addFinding('Contacts cards', 'Low',
          `Contact card detail list has only ${c.detailRows} labelled fields (expected email/phone/company)`, shot, 'Render Email/Phone/Company <dl> rows in each card.');
      }
      // Icon-only buttons need aria-labels
      if (c.editBtnPresent && !c.editBtnAriaLabel) {
        addFinding('Contacts cards', 'Medium',
          'Card edit button (icon-only) has no aria-label', shot, 'Add aria-label="Edit" to .contact-edit buttons.');
      }
      if (c.deleteBtnPresent && !c.deleteBtnAriaLabel) {
        addFinding('Contacts cards', 'Medium',
          'Card delete button (icon-only) has no aria-label', shot, 'Add aria-label="Delete" to .contact-delete buttons.');
      }
    }

    // Hover effect
    if (cardsInfo.cardCount > 0) {
      const firstCard = page.locator('.contact-card').first();
      await firstCard.hover();
      await page.waitForTimeout(400);
      const hoverInfo = await page.evaluate(() => {
        const card = document.querySelector('.contact-card');
        if (!card) return null;
        const s = window.getComputedStyle(card);
        return {
          boxShadow: s.boxShadow,
          transform: s.transform,
          borderColor: s.borderTopColor,
        };
      });
      console.log(`[L7-04 HOVER] ${JSON.stringify(hoverInfo)}`);
      const shotHover = await takeScreenshot(page, 'L7-04b-card-hover');
      if (hoverInfo && (hoverInfo.boxShadow === 'none' || hoverInfo.transform === 'none') ) {
        addFinding('Contacts cards', 'Low',
          'Contact card has no visible hover effect (no shadow/transform change)', shotHover, 'Add :hover { box-shadow / transform } to .contact-card for affordance.');
      }
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
    await ctx.close();
  });

  // ============= 5. MOBILE CALENDAR @ 375px =============
  test('L7-05 - Mobile calendar at 375px (bottom bar, FAB, list view, title)', async ({ browser }) => {
    // Start directly in mobile viewport so mobile.js inits in mobile mode
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.waitForTimeout(2500);
    const shot = await takeScreenshot(page, 'L7-05a-mobile-calendar');

    const mobileInfo = await page.evaluate(() => {
      const bar = document.getElementById('mobile_bottom_bar');
      const fab = document.getElementById('mobile_fab_add');
      const cal = document.getElementById('calendar_view');
      const title = document.querySelector('.fc-center h2, .fc-toolbar h2');
      const bodyMobile = document.body.classList.contains('mobile-chrome-active');

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
      const vh = window.innerHeight;

      // Detect which calendar view is active
      const monthActive = !!document.querySelector('.fc-month-view, .fc-month-button.fc-state-active');
      const weekActive = !!document.querySelector('.fc-agendaWeek-view, .fc-agendaWeek-button.fc-state-active');
      const dayActive = !!document.querySelector('.fc-agendaDay-view, .fc-agendaDay-button.fc-state-active');
      const listActive = !!document.querySelector('.fc-list-view, .fc-listMonth-button.fc-state-active');

      return {
        vw, vh,
        bodyMobileActive: bodyMobile,
        barPresent: !!bar,
        barVisible: bar ? !isHidden(bar) : false,
        barRect: rect(bar),
        barBtnCount: barBtns.length,
        barBtns: Array.from(barBtns).map(b => ({
          label: (b.getAttribute('aria-label') || b.textContent.trim()).slice(0, 12),
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
        titlePresent: !!title,
        titleText: title ? title.textContent.trim().slice(0, 40) : null,
        titleRect: rect(title),
        titleOverflows: title ? (title.getBoundingClientRect().right > vw) : false,
        viewActive: { month: monthActive, week: weekActive, day: dayActive, list: listActive },
      };
    });
    console.log(`\n[L7-05 MOBILE CAL] ${JSON.stringify(mobileInfo).slice(0, 1200)}`);

    // Bottom bar
    if (!mobileInfo.barPresent) {
      addFinding('Mobile calendar', 'High', 'Mobile bottom bar (#mobile_bottom_bar) is missing', shot, 'Render the bottom nav bar markup on the calendar page.');
    } else if (!mobileInfo.barVisible) {
      addFinding('Mobile calendar', 'High',
        'Mobile bottom bar is not visible at 375px (mobile.js did not activate)', shot, 'Ensure mobileEnhancementsActive() returns true on narrow viewports and wireBottomBar removes [hidden].');
    } else {
      if (mobileInfo.barBtnCount !== 5) {
        addFinding('Mobile calendar', 'Medium',
          `Mobile bottom bar has ${mobileInfo.barBtnCount} buttons (expected 5: prev/today/view/refresh/next)`, shot, 'Render exactly 5 .mobile-bottom-btn entries.');
      }
      // Button touch targets
      const small = mobileInfo.barBtns.filter(b => b.h < MIN_TOUCH);
      if (small.length > 0) {
        addFinding('Mobile calendar', 'Medium',
          `${small.length} bottom bar button(s) are under ${MIN_TOUCH}px tall (touch target too small)`, shot, 'Set min-height: 48px on .mobile-bottom-btn.');
      }
      // Bar spans full width
      if (mobileInfo.barRect && (mobileInfo.barRect.x > 2 || mobileInfo.barRect.right < mobileInfo.vw - 2)) {
        addFinding('Mobile calendar', 'Low',
          'Mobile bottom bar does not span the full viewport width', shot, 'Set left:0;right:0;width:100% on .mobile-bottom-bar.');
      }
    }

    // FAB
    if (!mobileInfo.fabPresent) {
      addFinding('Mobile calendar', 'High', 'Mobile FAB (#mobile_fab_add) is missing', shot, 'Render the FAB markup on the calendar page.');
    } else if (!mobileInfo.fabVisible) {
      addFinding('Mobile calendar', 'High', 'Mobile FAB is not visible at 375px', shot, 'Ensure wireFab() removes [hidden] on narrow viewports.');
    } else {
      if (mobileInfo.fabRect && mobileInfo.fabRect.w < 48) {
        addFinding('Mobile calendar', 'Medium',
          `FAB is only ${mobileInfo.fabRect.w}px (should be >=56px)`, shot, 'Set width/height: 56px on .mobile-fab.');
      }
      if (mobileInfo.fabOverlapsBar) {
        addFinding('Mobile calendar', 'High',
          'FAB overlaps the bottom navigation bar', shot, 'Position the FAB above the bottom bar (bottom offset >= bar height + margin).');
      }
    }

    // List view on mobile (app.js defaults to list on narrow)
    const anyViewActive = mobileInfo.viewActive.month || mobileInfo.viewActive.week || mobileInfo.viewActive.day || mobileInfo.viewActive.list;
    if (!anyViewActive) {
      addFinding('Mobile calendar', 'Low',
        'Could not detect an active calendar view at 375px', shot, 'Verify FullCalendar renders a view on mobile.');
    }

    // Title readability
    if (mobileInfo.titlePresent && mobileInfo.titleOverflows) {
      addFinding('Mobile calendar', 'Medium',
        'Calendar toolbar title overflows the viewport at 375px', shot, 'Truncate or reduce the title font-size on mobile.');
    }
    if (!mobileInfo.titlePresent) {
      addFinding('Mobile calendar', 'Low', 'No calendar title visible at 375px', shot, 'Ensure the month/year title is readable on mobile.');
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
    await ctx.close();
  });

  // ============= 6. MOBILE CONTACTS @ 375px =============
  test('L7-06 - Mobile contacts at 375px (list, search, create button)', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.goto(`${BASE_URL}/cards`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2500);
    const shot = await takeScreenshot(page, 'L7-06a-mobile-contacts');

    const mobileContactsInfo = await page.evaluate(() => {
      const search = document.getElementById('contacts_search');
      const createBtn = document.getElementById('contact_create');
      const rows = document.querySelectorAll('#contacts_rows .contact-row');
      const cards = document.querySelectorAll('#contacts_cards .contact-card');
      const cardsGrid = document.getElementById('contacts_cards');
      const list = document.getElementById('contacts_list');
      const empty = document.getElementById('contacts_empty');
      const heading = document.querySelector('.contacts-heading h1');
      const switchBtns = document.querySelectorAll('.contacts-view-switch button');

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

      // Search row wrap?
      const searchRow = document.querySelector('.contacts-search-row');
      const searchRowH = searchRow ? Math.round(searchRow.getBoundingClientRect().height) : null;

      // First row / card
      const firstRow = rows[0];
      const rowInfo = firstRow ? (() => {
        const r = firstRow.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      })() : null;

      return {
        vw,
        searchPresent: !!search,
        searchRect: rect(search),
        searchOverflows: search ? search.getBoundingClientRect().right > vw : false,
        searchRowH,
        createBtnPresent: !!createBtn,
        createBtnVisible: createBtn ? !isHidden(createBtn) : false,
        rowCount: rows.length,
        cardCount: cards.length,
        cardsVisible: cardsGrid ? !isHidden(cardsGrid) : false,
        listVisible: list ? !isHidden(list) : false,
        emptyVisible: empty ? !isHidden(empty) : false,
        rowInfo,
        headingText: heading ? heading.textContent.trim().slice(0, 30) : null,
        switchBtnCount: switchBtns.length,
        switchBtnHeights: Array.from(switchBtns).map(b => Math.round(b.getBoundingClientRect().height)),
      };
    });
    console.log(`\n[L7-06 MOBILE CONTACTS] ${JSON.stringify(mobileContactsInfo).slice(0, 900)}`);

    // Search input
    if (!mobileContactsInfo.searchPresent) {
      addFinding('Mobile contacts', 'High', 'Contact search input missing on mobile', shot, 'Render #contacts_search.');
    } else {
      if (mobileContactsInfo.searchOverflows) {
        addFinding('Mobile contacts', 'Medium', 'Contact search input overflows viewport at 375px', shot, 'Constrain .contacts-search width and allow the view-switch to wrap below.');
      }
      if (mobileContactsInfo.searchRect && mobileContactsInfo.searchRect.h < MIN_TOUCH) {
        addFinding('Mobile contacts', 'Medium',
          `Contact search input is only ${mobileContactsInfo.searchRect.h}px tall (touch target)`, shot, `Set min-height: ${MIN_TOUCH}px on #contacts_search.`);
      }
    }

    // Create button reachable on mobile
    if (mobileContactsInfo.createBtnPresent && !mobileContactsInfo.createBtnVisible) {
      // Sidebar may be off-canvas on mobile; the empty-state create button should cover it
      if (!mobileContactsInfo.emptyVisible) {
        addFinding('Mobile contacts', 'Medium',
          '"Create contact" sidebar button is not visible on mobile and no mobile-reachable create affordance exists', shot, 'Reveal #contact_create in a mobile drawer or surface #contacts_empty_create.');
      }
    }

    // Default view on mobile should be cards (per defaultContactView)
    if (!mobileContactsInfo.cardsVisible && mobileContactsInfo.cardCount === 0 && mobileContactsInfo.rowCount === 0 && !mobileContactsInfo.emptyVisible) {
      addFinding('Mobile contacts', 'Medium',
        'No contacts visible on mobile and no empty-state shown', shot, 'Show #contacts_empty on mobile when no contacts exist.');
    }

    // View switch touch targets
    mobileContactsInfo.switchBtnHeights.forEach((h, i) => {
      if (h > 0 && h < 36) {
        addFinding('Mobile contacts', 'Low',
          `View switch button #${i + 1} is only ${h}px tall on mobile`, shot, 'Set min-height: 40px on .contacts-view-switch button.');
      }
    });

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
    await ctx.close();
  });

  // ============= 7. LOGIN PAGE VISUAL =============
  test('L7-07 - Login page visual (logo load, spacing, error, password toggle)', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const shot1 = await takeScreenshot(page, 'L7-07a-login-default');

    const loginInfo = await page.evaluate(() => {
      const form = document.querySelector('.loginform');
      const logo = document.querySelector('.loginform img');
      const userInp = document.getElementById('user');
      const passInp = document.getElementById('password');
      const submit = document.querySelector('input[name="login"]');
      const toggle = document.getElementById('login_pw_toggle');
      const errEl = document.querySelector('.login-error');

      const rect = el => el ? (() => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), naturalH: el.naturalHeight };
      })() : null;

      const cs = el => el ? (() => {
        const s = window.getComputedStyle(el);
        return { margin: s.margin, marginBottom: s.marginBottom, padding: s.padding };
      })() : null;

      // Vertical gaps between form rows
      const groups = form ? form.querySelectorAll('.form-group') : [];
      const gaps = [];
      for (let i = 0; i < groups.length - 1; i++) {
        const a = groups[i].getBoundingClientRect();
        const b = groups[i + 1].getBoundingClientRect();
        gaps.push(Math.round(b.top - a.bottom));
      }

      return {
        formPresent: !!form,
        logoPresent: !!logo,
        logoRect: rect(logo),
        logoComplete: logo ? (logo.complete && logo.naturalWidth > 0) : false,
        logoBroken: logo ? (logo.complete && logo.naturalWidth === 0) : false,
        userRect: rect(userInp),
        passRect: rect(passInp),
        submitRect: rect(submit),
        userMB: cs(userInp),
        togglePresent: !!toggle,
        toggleRect: rect(toggle),
        toggleAriaLabel: toggle ? toggle.getAttribute('aria-label') : null,
        errPresent: !!errEl,
      };
    });
    console.log(`\n[L7-07 LOGIN] ${JSON.stringify(loginInfo).slice(0, 900)}`);

    // Logo
    if (!loginInfo.logoPresent) {
      addFinding('Login', 'Low', 'Login page has no logo image', shot1, 'Add the caldaver logo <img> to .loginform.');
    } else if (loginInfo.logoBroken) {
      addFinding('Login', 'Medium',
        `Login logo image failed to load (broken/0 natural width): ${loginInfo.logoRect ? loginInfo.logoRect.w + 'px' : '?'}`, shot1, 'Check the logo asset path and that it is served correctly.');
    }

    // Password toggle
    if (!loginInfo.togglePresent) {
      addFinding('Login', 'Medium', 'Login page has no password show/hide toggle', shot1, 'Add #login_pw_toggle button inside the password wrap.');
    } else {
      if (loginInfo.toggleRect && loginInfo.toggleRect.h < 36) {
        addFinding('Login', 'Medium',
          `Password toggle button is only ${loginInfo.toggleRect.h}px tall (hard to tap)`, shot1, 'Set min-height: 44px on #login_pw_toggle.');
      }
      if (!loginInfo.toggleAriaLabel) {
        addFinding('Login', 'Medium', 'Password toggle button has no aria-label', shot1, 'Add aria-label="Show password" to #login_pw_toggle.');
      }
    }

    // Now test wrong password error
    await page.locator('#user').fill(USERNAME);
    await page.locator('#password').fill('DEFINITELY_WRONG_98765');
    await page.locator('input[name="login"]').click();
    await page.waitForTimeout(2500);
    const shot2 = await takeScreenshot(page, 'L7-07b-login-error');

    const errInfo = await page.evaluate(() => {
      const errEl = document.querySelector('.login-error, .alert, [role="alert"]');
      const stillOnLogin = /\/login/.test(location.pathname);
      const isHidden = el => {
        if (!el) return true;
        const s = window.getComputedStyle(el);
        return s.display === 'none' || el.getBoundingClientRect().width === 0;
      };
      const cs = errEl ? window.getComputedStyle(errEl) : null;
      return {
        stillOnLogin,
        errPresent: !!errEl,
        errVisible: errEl ? !isHidden(errEl) : false,
        errText: errEl ? errEl.textContent.trim().slice(0, 100) : null,
        errRole: errEl ? errEl.getAttribute('role') : null,
        errBg: cs ? cs.backgroundColor : null,
        errColor: cs ? cs.color : null,
        // Re-fetch field values to ensure they reset appropriately
        userValue: document.getElementById('user') ? document.getElementById('user').value : null,
        passValue: document.getElementById('password') ? document.getElementById('password').value : null,
      };
    });
    console.log(`[L7-07 WRONG PASS] ${JSON.stringify(errInfo)}`);

    if (errInfo.stillOnLogin) {
      if (!errInfo.errPresent) {
        addFinding('Login', 'High', 'Wrong password shows no error message at all', shot2, 'Render .login-error[role=alert] when auth fails.');
      } else if (!errInfo.errVisible) {
        addFinding('Login', 'High', 'Login error element present but not visible after wrong password', shot2, 'Ensure .login-error is display:block on error.');
      } else {
        if (errInfo.errRole !== 'alert') {
          addFinding('Login', 'Medium', 'Login error lacks role="alert" (not announced to screen readers)', shot2, 'Add role="alert" to .login-error.');
        }
        if (errInfo.errColor && errInfo.errBg) {
          const ratio = contrastRatio(errInfo.errColor, errInfo.errBg);
          if (ratio !== null && ratio < 4.5) {
            addFinding('Login', 'Medium',
              `Login error text contrast is ${ratio.toFixed(2)}:1 (fg=${errInfo.errColor} bg=${errInfo.errBg})`, shot2, 'Darken the error text or lighten its background for >=4.5:1 contrast.');
          }
        }
        // Password field should be cleared on failed login (not retain the wrong value)
        if (errInfo.passValue && errInfo.passValue.length > 0) {
          addFinding('Login', 'Low',
            'Password field retains the wrong value after a failed login attempt', shot2, 'Clear the password field server-side on auth failure.');
        }
      }
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
    await ctx.close();
  });

  // ============= 8. TAB ORDER =============
  test('L7-08 - Tab order (skip link -> navbar -> sidebar -> toolbar + focus rings)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.waitForTimeout(1500);

    // Click a neutral spot, then tab through
    await page.mouse.click(10, 200);
    await page.waitForTimeout(200);

    const focusSequence = [];
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(150);
      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const s = window.getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const hasOutline = s.outlineStyle !== 'none' && s.outlineWidth !== '0px';
        const hasBoxShadow = s.boxShadow && !s.boxShadow.includes('none');
        return {
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          cls: (el.className || '').toString().slice(0, 50),
          text: (el.textContent || '').trim().slice(0, 25),
          top: Math.round(r.top),
          rect: { w: Math.round(r.width), h: Math.round(r.height) },
          outlineStyle: s.outlineStyle,
          outlineWidth: s.outlineWidth,
          outlineColor: s.outlineColor,
          hasVisibleFocus: hasOutline || hasBoxShadow,
          visible: r.width > 0 && r.height > 0,
          inNavbar: !!el.closest('.navbar, .caldaver-topbar'),
          inSidebar: !!el.closest('#sidebar'),
          inToolbar: !!el.closest('.fc-toolbar'),
        };
      });
      if (focused) {
        focusSequence.push({ step: i + 1, ...focused });
      }
    }
    const shot = await takeScreenshot(page, 'L7-08a-tab-order');
    console.log(`\n[L7-08 TAB ORDER] ${JSON.stringify(focusSequence).slice(0, 1500)}`);

    // Skip link first?
    const firstFocused = focusSequence[0];
    const skipFirst = firstFocused && (firstFocused.cls.includes('skip') || firstFocused.id === 'skip-link' || (firstFocused.text && firstFocused.text.toLowerCase().includes('skip')));
    if (!skipFirst) {
      addFinding('Tab order', 'Medium',
        'First Tab does not focus the skip link (skip link is not first in tab order)', shot, 'Place .skip-link as the very first focusable element in the DOM.');
    }

    // Logical region order: navbar before sidebar before toolbar
    const regionOrder = focusSequence.map(f => f.inNavbar ? 'N' : f.inSidebar ? 'S' : f.inToolbar ? 'T' : '').join('');
    const hasNBeforeS = /N.*S/.test(regionOrder);
    const hasSBeforeT = /S.*T/.test(regionOrder);
    if (focusSequence.length >= 5 && !hasNBeforeS) {
      addFinding('Tab order', 'Low',
        'Tab order does not visit navbar before sidebar (focus flow may be illogical)', shot, 'Ensure DOM order places navbar before sidebar before calendar toolbar.');
    }

    // Visible focus indicators
    const noFocusRing = focusSequence.filter(f => f.visible && !f.hasVisibleFocus);
    if (noFocusRing.length > 0) {
      const examples = noFocusRing.slice(0, 3).map(f => `<${f.tag}${f.id ? ' #' + f.id : ''}>`);
      addFinding('Tab order', noFocusRing.length > 3 ? 'High' : 'Medium',
        `${noFocusRing.length} focusable element(s) lack a visible focus indicator: ${examples.join(', ')}`,
        shot, 'Add :focus-visible { outline: 2px solid #1a73e8 } to all interactive elements.');
    }

    // Focus progress (avoid focus traps)
    if (focusSequence.length < 4) {
      addFinding('Tab order', 'Medium',
        `Tab only advanced focus ${focusSequence.length} times in 20 presses (possible focus trap)`, shot, 'Check for misconfigured tabindex or a focus trap without an exit.');
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 9. BUTTON CONSISTENCY =============
  test('L7-09 - Button consistency (primary/default/icon-only + aria-labels)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.waitForTimeout(1500);

    const shot = await takeScreenshot(page, 'L7-09a-buttons');

    const buttonInfo = await page.evaluate(() => {
      const allBtns = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], .btn'));
      const visible = allBtns.filter(b => {
        const r = b.getBoundingClientRect();
        const s = window.getComputedStyle(b);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0;
      });

      const summarise = b => {
        const s = window.getComputedStyle(b);
        const r = b.getBoundingClientRect();
        const isPrimary = /(^|\s)btn-primary(\s|$)/.test(b.className) || s.backgroundColor === 'rgb(51, 122, 183)';
        const isIconOnly = (b.textContent || '').trim().length === 0 && b.querySelector('i, svg, img');
        return {
          tag: b.tagName.toLowerCase(),
          id: b.id || null,
          cls: (b.className || '').toString().slice(0, 40),
          text: (b.textContent || b.value || '').trim().slice(0, 20),
          isPrimary,
          isIconOnly,
          ariaLabel: b.getAttribute('aria-label'),
          bg: s.backgroundColor,
          color: s.color,
          h: Math.round(r.height),
          fontSize: s.fontSize,
          radius: s.borderRadius,
        };
      };

      const primaries = visible.map(summarise).filter(b => b.isPrimary);
      const defaults = visible.map(summarise).filter(b => !b.isPrimary && !b.isIconOnly);
      const iconOnly = visible.map(summarise).filter(b => b.isIconOnly);

      // Primary button bg uniformity
      const primaryBgs = [...new Set(primaries.map(b => b.bg))];
      const defaultBgs = [...new Set(defaults.map(b => b.bg))];
      const primaryHeights = primaries.map(b => b.h);

      // Icon-only without aria-label
      const iconOnlyNoLabel = iconOnly.filter(b => !b.ariaLabel);

      return {
        totalVisible: visible.length,
        primaryCount: primaries.length,
        primaryBgs,
        primaryHeights: primaryHeights.length ? { min: Math.min(...primaryHeights), max: Math.max(...primaryHeights) } : null,
        defaultCount: defaults.length,
        defaultBgs,
        iconOnlyCount: iconOnly.length,
        iconOnlyNoLabelCount: iconOnlyNoLabel.length,
        iconOnlyNoLabelSamples: iconOnlyNoLabel.slice(0, 5).map(b => b.id || b.cls || b.tag),
      };
    });
    console.log(`\n[L7-09 BUTTONS] ${JSON.stringify(buttonInfo).slice(0, 1000)}`);

    // Primary button colour consistency
    if (buttonInfo.primaryBgs.length > 1) {
      addFinding('Buttons', 'Medium',
        `Primary buttons use ${buttonInfo.primaryBgs.length} different background colours: ${buttonInfo.primaryBgs.join(', ')}`,
        shot, 'Standardise .btn-primary to a single background colour.');
    }
    // Primary button height consistency
    if (buttonInfo.primaryHeights && (buttonInfo.primaryHeights.max - buttonInfo.primaryHeights.min) > 6) {
      addFinding('Buttons', 'Low',
        `Primary buttons have inconsistent heights (${buttonInfo.primaryHeights.min}-${buttonInfo.primaryHeights.max}px)`, shot, 'Give .btn-primary a fixed min-height.');
    }
    // Default button colour consistency
    if (buttonInfo.defaultBgs.length > 2) {
      addFinding('Buttons', 'Low',
        `Default/secondary buttons use ${buttonInfo.defaultBgs.length} different backgrounds`, shot, 'Standardise .btn-default background.');
    }
    // Icon-only buttons missing aria-labels
    if (buttonInfo.iconOnlyNoLabelCount > 0) {
      addFinding('Buttons', buttonInfo.iconOnlyNoLabelCount > 2 ? 'High' : 'Medium',
        `${buttonInfo.iconOnlyNoLabelCount} icon-only button(s) lack an aria-label: ${buttonInfo.iconOnlyNoLabelSamples.join(', ')}`,
        shot, 'Add aria-label to every icon-only button (e.g. refresh, close, edit, delete).');
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= 10. SPACING / RHYTHM =============
  test('L7-10 - Spacing/rhythm (section margins, panel padding, double/missing gaps)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const messages = collectConsoleMessages(page);
    await login(page);
    await page.waitForTimeout(1500);

    const shot = await takeScreenshot(page, 'L7-10a-spacing');

    const spacingInfo = await page.evaluate(() => {
      const sb = document.getElementById('sidebar');
      const panels = sb ? Array.from(sb.querySelectorAll('.panel')) : [];
      const content = document.getElementById('content');

      // Panel margins (margin-bottom) and the actual rendered gap between consecutive panels
      const panelData = panels.slice(0, 6).map((p, i) => {
        const s = window.getComputedStyle(p);
        const r = p.getBoundingClientRect();
        return {
          i,
          marginBottom: parseInt(s.marginBottom, 10) || 0,
          marginTop: parseInt(s.marginTop, 10) || 0,
          paddingTop: parseInt(s.paddingTop, 10) || 0,
          paddingBottom: parseInt(s.paddingBottom, 10) || 0,
          actualBottom: Math.round(r.bottom),
        };
      });

      // Actual gaps between consecutive panels
      const actualGaps = [];
      for (let i = 0; i < panelData.length - 1; i++) {
        const next = panels[i + 1].getBoundingClientRect();
        actualGaps.push(Math.round(next.top - panelData[i].actualBottom));
      }

      // Look for double-spacing: margin-bottom on one + margin-top on next that don't collapse
      const doubleMargins = [];
      for (let i = 0; i < panelData.length - 1; i++) {
        const a = panelData[i];
        const b = panelData[i + 1];
        if (a.marginBottom > 0 && b.marginTop > 0) {
          doubleMargins.push({ after: a.i, mb: a.marginBottom, mt: b.marginTop });
        }
      }

      // Missing gaps: two panels with 0 gap between them
      const missingGaps = actualGaps.filter(g => g <= 0).length;

      // Padding inside panel bodies
      const bodies = panels.slice(0, 4).map(p => p.querySelector('.panel-body')).filter(Boolean);
      const bodyPaddings = bodies.map(b => {
        const s = window.getComputedStyle(b);
        return { top: parseInt(s.paddingTop, 10) || 0, bottom: parseInt(s.paddingBottom, 10) || 0, left: parseInt(s.paddingLeft, 10) || 0 };
      });
      const paddingSpread = bodyPaddings.length ? Math.max(...bodyPaddings.map(p => p.top)) - Math.min(...bodyPaddings.map(p => p.top)) : 0;

      // Check calendar content top margin vs sidebar
      const sbRect = sb ? sb.getBoundingClientRect() : null;
      const contentRect = content ? content.getBoundingClientRect() : null;

      return {
        panelCount: panels.length,
        panelData,
        actualGaps,
        gapSpread: actualGaps.length ? Math.max(...actualGaps) - Math.min(...actualGaps) : 0,
        doubleMarginCount: doubleMargins.length,
        doubleMargins,
        missingGapCount: missingGaps,
        bodyPaddings,
        paddingSpread,
        sidebarTop: sbRect ? Math.round(sbRect.top) : null,
        contentTop: contentRect ? Math.round(contentRect.top) : null,
        topAlignmentDiff: (sbRect && contentRect) ? Math.abs(Math.round(sbRect.top - contentRect.top)) : null,
      };
    });
    console.log(`\n[L7-10 SPACING] ${JSON.stringify(spacingInfo).slice(0, 1200)}`);

    // Inconsistent gaps between panels
    if (spacingInfo.gapSpread > 8 && spacingInfo.actualGaps.length >= 2) {
      addFinding('Spacing', 'Medium',
        `Vertical gaps between sidebar panels are inconsistent (spread ${spacingInfo.gapSpread}px): [${spacingInfo.actualGaps.join(', ')}]px`,
        shot, 'Use a single margin-bottom value on all sidebar .panel elements.');
    }

    // Double margins (adjacent margin-bottom + margin-top that don't collapse)
    if (spacingInfo.doubleMarginCount > 0) {
      addFinding('Spacing', 'Low',
        `${spacingInfo.doubleMarginCount} pair(s) of adjacent panels have both margin-bottom and margin-top (double-spacing risk): ${JSON.stringify(spacingInfo.doubleMargins)}`,
        shot, 'Use only margin-bottom on panels (or a gap on a flex/grid container) to avoid double margins.');
    }

    // Missing gaps (panels touching)
    if (spacingInfo.missingGapCount > 0) {
      addFinding('Spacing', 'Medium',
        `${spacingInfo.missingGapCount} pair(s) of adjacent sidebar panels have no gap between them`,
        shot, 'Add margin-bottom to sidebar .panel elements.');
    }

    // Inconsistent panel body padding
    if (spacingInfo.paddingSpread > 6) {
      addFinding('Spacing', 'Low',
        `Panel body top-padding varies by ${spacingInfo.paddingSpread}px between panels`, shot, 'Standardise .panel-body padding.');
    }

    // Sidebar vs content top alignment
    if (spacingInfo.topAlignmentDiff !== null && spacingInfo.topAlignmentDiff > 8) {
      addFinding('Spacing', 'Low',
        `Sidebar top (${spacingInfo.sidebarTop}px) and calendar content top (${spacingInfo.contentTop}px) are not aligned`, shot, 'Align #sidebar and #content to the same top edge.');
    }

    messages.errors.forEach(e => console.log(`  CONSOLE ERROR: ${e.text}`));
  });

  // ============= SUMMARY =============
  test('L7-11 - Summary: write findings report', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    console.log('\n\n========================================================');
    console.log('  CALDAVER LOOP 7 DEEP VISUAL POLISH AUDIT - FINDINGS');
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

    fs.writeFileSync(`${SCREENSHOT_DIR}/loop7-findings.json`, JSON.stringify({ findings: sorted, summary }, null, 2));
    expect(findings.length).toBeGreaterThanOrEqual(0);
  });
});
