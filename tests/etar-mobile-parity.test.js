const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function between(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing protected start marker: ${start}`);
  const to = source.indexOf(end, from);
  assert.notEqual(to, -1, `missing protected end marker: ${end}`);
  return source.slice(from, to);
}

// These fingerprints were captured from ce467340, immediately before the Etar
// mobile Calendar work. They intentionally protect only the user-named surfaces,
// not the Calendar page area being redesigned.
const protectedTemplates = {
  'web/templates/cards.html': '8a206fc5b578642fee9b79e048feff6611ed9c2b4de2dc65e64e2498aecfb9d0',
  'web/templates/mail.html': '7ad459eb7ca3cef351430d92a34d6d3976f7049048a87222c6e81ecd01a7b3e3',
  'web/templates/mail_message.html': '72fabefe880ae7b518fdcd598818b782d1461c8fae12d944b1a311a23c644356',
  'web/templates/parts/mailjs.html': 'a0a49b99830bc9c3522dbbc6195565fa60cd6b055213fcac709c6453ad266c17',
  'web/templates/parts/mailmessagejs.html': 'e8357758f1fdbad90b9325979abb3dc0b17201e380cddaf8f4a7a01e18170749',
  'web/templates/preferences.html': 'f4df3b124b9f3aacd6c8e03a081d7cdbc8efb1147fb1eacca377c5a4d6302a6d',
  'web/templates/parts/bottom_bar.html': '6c05c2d8a199772002b043cecf5def9d1a8d770df7ac27a7c4d7ace892e0d954'
};

test('Etar Calendar work leaves Contacts, Mail, Preferences, and shared mobile tabs unchanged', () => {
  for (const [file, expected] of Object.entries(protectedTemplates)) {
    assert.equal(sha256(read(file)), expected, `${file} changed from the pre-Etar baseline`);
  }
});

test('existing mobile section and calendar-selection menu stays byte-for-byte unchanged', () => {
  const navbar = read('web/templates/parts/navbar.html');
  const menu = between(
    navbar,
    '   <details class="mobile-section-menu">',
    '     <div class="navbar-header">'
  );
  const behavior = between(
    navbar,
    '  function mobileCalendarMenu()',
    "  document.addEventListener('DOMContentLoaded', function() {\n    var resetButton"
  );

  assert.equal(sha256(menu), 'e8215e17eb78103479e57f812cfe3a4f7f864ba395a4525dc87d795547c47af1');
  assert.equal(sha256(behavior), 'dcff6c478c25c97882fb0994a899e3104b725d5465e4c37dd8e4d07bea115e59');
  assert.match(menu, /mobile-calendar-menu-calendars/);
  assert.match(behavior, /aria-pressed/);
  assert.match(behavior, /loadMobileCalendarMenu/);
});

test('Etar view support is calendar-only and does not add a second drawer', () => {
  const calendar = read('web/templates/calendar.html');
  const navbar = read('web/templates/parts/navbar.html');
  const cards = read('web/templates/cards.html');
  const mail = read('web/templates/mail.html');
  const mobile = read('assets/js/app/mobile.js');

  for (const view of ['agendaDay', 'agendaWeek', 'month', 'customizable_list']) {
    assert.match(mobile, new RegExp(`["']${view}["']`));
  }
  assert.doesNotMatch(calendar, /id="etar_calendar_(drawer|scrim)"/);
  assert.doesNotMatch(calendar, /class="etar-calendar-(drawer|scrim)/);
  assert.doesNotMatch(navbar, /etar[_-]calendar/);
  assert.doesNotMatch(cards, /etar[_-]calendar/);
  assert.doesNotMatch(mail, /etar[_-]calendar/);
});

test('Etar view controls never inject into the protected section/calendar selection menu', () => {
  const mobile = read('assets/js/app/mobile.js');

  assert.doesNotMatch(
    mobile,
    /\$\('\.mobile-section-menu-list'\)[\s\S]{0,2500}(append|prepend|appendTo|prependTo)\(/,
    'view controls must use Calendar overflow controls, not mutate .mobile-section-menu-list'
  );
  assert.doesNotMatch(
    mobile,
    /\.mobile-section-menu-list[\s\S]{0,2500}etar-calendar-view-list/,
    'Etar view list must not be coupled to the protected section menu'
  );
});

test('Etar behavior is gated behind both Calendar presence and a mobile viewport', () => {
  const mobile = read('assets/js/app/mobile.js');
  const init = between(mobile, '  function init() {', '\n  $(function() {');

  assert.match(mobile, /matchMedia\('\(max-width: 900px\)'\)\.matches/);
  assert.match(init, /if \(\$\('#calendar_view'\)\.length === 0\)[\s\S]*return;/);
  assert.match(init, /if \(!mobileEnhancementsActive\(\)\)[\s\S]*return;/);
  assert.ok(
    init.indexOf("if ($('#calendar_view').length === 0)") < init.indexOf('wireSidebarDrawer()'),
    'calendar-page guard must run before Etar drawer wiring'
  );
  assert.ok(
    init.indexOf('if (!mobileEnhancementsActive())') < init.indexOf('wireSidebarDrawer()'),
    'mobile viewport guard must run before Etar drawer wiring'
  );
});

test('Etar view switching reuses FullCalendar and preserves calendar data operations', () => {
  const mobile = read('assets/js/app/mobile.js');

  assert.match(mobile, /var MOBILE_VIEWS = \['agendaDay', 'agendaWeek', 'month', 'customizable_list'\]/);
  assert.doesNotMatch(mobile, /etar_calendar_(drawer|scrim)/);
  assert.match(mobile, /fc\('changeView', name\)/);
  assert.match(mobile, /fc\('getDate'\)/);
});

test('Etar visual rules are isolated to mobile Calendar and cannot style desktop, Contacts, or Mail', () => {
  const less = read('assets/less/caldaver-mobile.less');
  const marker = '// Etar calendar surface.';
  const start = less.indexOf(marker);
  assert.notEqual(start, -1, 'missing Etar calendar CSS marker');
  const etar = less.slice(start);

  assert.match(etar, /@media \(max-width: 900px\)\s*\{\s*body\.caldaver-calendar-page\s*\{/);
  assert.doesNotMatch(etar, /caldaver-(cards|mail|preferences)-page/);
  assert.doesNotMatch(etar, /#contacts|\.contacts-|#mail|\.mail-/);
  assert.equal(
    (less.slice(0, start).match(/\.etar-calendar-/g) || []).length,
    0,
    'Etar selectors must not exist outside the isolated mobile Calendar block'
  );
});

test('mobile Calendar contains Etar Material palette, grid, agenda rows, and FAB contracts', () => {
  const less = read('assets/less/caldaver-mobile.less');
  const etar = less.slice(less.indexOf('// Etar calendar surface.'));

  assert.match(etar, /\.caldaver-topbar\.navbar\s*\{[\s\S]*background:\s*#41c3b1/);
  assert.match(etar, /#shortcut_add_event\.create-event-button\s*\{[\s\S]*width:\s*56px[\s\S]*height:\s*56px[\s\S]*background:\s*#1dc1ab/);
  assert.match(etar, /#calendar_view \.fc-list-heading td\s*\{[\s\S]*min-height:\s*48px/);
  assert.match(etar, /#calendar_view \.fc-list-item\s*\{[\s\S]*min-height:\s*64px/);
  assert.match(etar, /#calendar_view \.fc-list-item-marker[\s\S]*\.fc-event-dot\s*\{[\s\S]*width:\s*24px[\s\S]*height:\s*24px/);
  assert.match(etar, /#calendar_view \.fc-month-view \.fc-day-header\s*\{[\s\S]*height:\s*26px/);
  assert.match(etar, /#calendar_view \.fc-agenda-view \.fc-axis\s*\{[\s\S]*background:\s*#eee/);
  assert.doesNotMatch(etar, /\.etar-calendar-(drawer|scrim)/);
  assert.match(etar, /#mobile_bottom_bar,[\s\S]*\.caldaver-bottom-tabs,[\s\S]*display:\s*none !important/);
});

test('Etar month parity includes today, adjacent-month, week-number, and flat event geometry', () => {
  const less = read('assets/less/caldaver-mobile.less');
  const etar = less.slice(less.indexOf('// Etar calendar surface.'));

  // Source: Etar app/src/main/res/values/colors.xml. Accept the literal ARGB
  // token or an equivalent rgba() representation for the translucent today fill.
  assert.match(etar, /#calendar_view \.fc-month-view[\s\S]*\.fc-today[\s\S]*background:\s*(#25a2ff00|rgba\(162,\s*255,\s*0,\s*0?\.14[0-9]*\))/i);
  assert.match(etar, /#calendar_view \.fc-month-view[\s\S]*\.fc-other-month[\s\S]*background:\s*#eee(?:eee)?/i);
  assert.match(etar, /#calendar_view \.fc-month-view[\s\S]*\.fc-other-month[\s\S]*\.fc-day-number[\s\S]*color:\s*#939497/i);
  assert.match(etar, /#calendar_view \.fc-month-view[\s\S]*\.fc-week-number[\s\S]*color:\s*#41c3b1/i);
  assert.match(etar, /#calendar_view \.fc-month-view[\s\S]*\.fc-day-grid-event[\s\S]*border-radius:\s*0/);
  assert.match(etar, /#calendar_view \.fc-month-view[\s\S]*\.fc-day-grid-event[\s\S]*box-shadow:\s*none/);

  // Etar month_focus_month_bgcolor: focused-month cells are white, and day
  // numbers render as plain text without a link underline.
  assert.match(
    etar,
    /#calendar_view \.fc-month-view \.fc-day,\s*#calendar_view \.fc-month-view \.fc-day-top\s*\{[\s\S]*?background:\s*#fff/i,
    'Etar focus-month cells are white'
  );
  assert.match(
    etar,
    /#calendar_view \.fc-month-view \.fc-day-number\s*\{[\s\S]*?text-decoration:\s*none/i,
    'Etar month day numbers have no link underline'
  );
});

test('live-visual regressions: Etar toolbar is 56dp and today date has no Caldaver blue pill', () => {
  const less = read('assets/less/caldaver-mobile.less');
  const etar = less.slice(less.indexOf('// Etar calendar surface.'));

  assert.match(
    etar,
    /\.caldaver-topbar\.navbar\s*\{[\s\S]*?padding:\s*0(?:;|\s)/,
    'Bootstrap adds 8px vertical navbar padding unless Etar explicitly resets it'
  );
  assert.match(
    etar,
    /td\.fc-day-top\.fc-today\s*>\s*\.fc-day-number[\s\S]*?background:\s*(?:transparent|none)[\s\S]*?color:\s*#555/i,
    'Etar today is a flat #555 date over the green cell, not Caldaver blue circle'
  );
});
