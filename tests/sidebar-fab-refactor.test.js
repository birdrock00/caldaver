const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function cssBlock(source, selector) {
  const start = source.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing CSS block for ${selector}`);
  const blockStart = source.indexOf('{', start);
  const blockEnd = source.indexOf('\n}', blockStart);
  assert.notEqual(blockEnd, -1, `missing CSS block end for ${selector}`);
  return source.slice(blockStart + 1, blockEnd);
}

function sourceBetween(source, startPattern, endPattern) {
  const start = source.search(startPattern);
  assert.notEqual(start, -1, `missing source start ${startPattern}`);
  const tail = source.slice(start);
  const end = tail.search(endPattern);
  assert.notEqual(end, -1, `missing source end ${endPattern}`);
  return tail.slice(0, end);
}

// Extract the body of a top-level `@media (...) { ... }` block using balanced
// brace matching, so assertions can target only what is inside a media query.
function mediaBlock(source, mediaQuery) {
  const header = `@media ${mediaQuery} {`;
  const start = source.indexOf(header);
  assert.notEqual(start, -1, `missing media query ${mediaQuery}`);
  let i = source.indexOf('{', start);
  assert.notEqual(i, -1, `missing opening brace for ${mediaQuery}`);
  let depth = 0;
  const n = source.length;
  for (; i < n; i++) {
    const ch = source[i];
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  assert.fail(`unterminated media query ${mediaQuery}`);
}

// Strip Twig comments ({# ... #}) so assertions check rendered output only.
function stripTwigComments(source) {
  return source.replace(/{#[\s\S]*?#}/g, '');
}

test('sidebar Caldaver logo is removed from both renderers', () => {
  const sidebrandHtml = stripTwigComments(read('web/templates/parts/sidebrand.html'));
  const server = read('rust/crates/caldaver-server/src/lib.rs');

  assert.doesNotMatch(sidebrandHtml, /Caldaver/, 'sidebrand.html must not render a Caldaver logo');
  assert.doesNotMatch(sidebrandHtml, /id="logo"/);

  const sidebrandFn = sourceBetween(
    server,
    /fn sidebrand\(\) -> &'static str \{/,
    /\nfn calendar_sidebar/
  );
  assert.match(sidebrandFn, /""/, 'lib.rs sidebrand() must return an empty string');
  assert.doesNotMatch(sidebrandFn, /<[a-zA-Z]/, 'lib.rs sidebrand() must not emit markup');
});

test('navbar brand wordmark is removed from both renderers', () => {
  const navbar = read('web/templates/parts/navbar.html');
  const server = read('rust/crates/caldaver-server/src/lib.rs');

  assert.doesNotMatch(navbar, /caldaver-brand-title/);
  assert.doesNotMatch(server, /caldaver-brand-title/);
});

test('#own_calendar_list panel is removed from the sidebar in both renderers', () => {
  const sidebar = read('web/templates/parts/sidebar.html');
  const server = read('rust/crates/caldaver-server/src/lib.rs');

  assert.doesNotMatch(sidebar, /own_calendar_list/);

  const calendarSidebar = sourceBetween(
    server,
    /fn calendar_sidebar\(\) -> String \{/,
    /\nfn calendar_bottom/
  );
  assert.doesNotMatch(
    calendarSidebar,
    /id="own_calendar_list"/,
    'the Rust calendar sidebar markup must not include #own_calendar_list'
  );
});

test('#shortcuts block is removed from the sidebar in both renderers', () => {
  const sidebar = read('web/templates/parts/sidebar.html');
  const server = read('rust/crates/caldaver-server/src/lib.rs');

  assert.doesNotMatch(sidebar, /id="shortcuts"/);

  const calendarSidebar = sourceBetween(
    server,
    /fn calendar_sidebar\(\) -> String \{/,
    /\nfn calendar_bottom/
  );
  assert.doesNotMatch(calendarSidebar, /id="shortcuts"/);
});

test('#footer is removed from the sidebar in both renderers', () => {
  const sidebar = read('web/templates/parts/sidebar.html');
  const server = read('rust/crates/caldaver-server/src/lib.rs');

  assert.doesNotMatch(sidebar, /id="footer"/);

  const renderCalendar = sourceBetween(
    server,
    /fn render_calendar\(state: &AppState, session: &Session\) -> String \{/,
    /\nfn render_cards/
  );
  assert.doesNotMatch(renderCalendar, /<div id="footer">/);
});

test('sr-only Calendar heading is removed from the Rust renderer', () => {
  const server = read('rust/crates/caldaver-server/src/lib.rs');
  assert.doesNotMatch(server, /class="sr-only">Calendar/);
});

test('#shared_calendar_add button is present inside #shared_calendar_list in both renderers', () => {
  const sidebar = read('web/templates/parts/sidebar.html');
  const server = read('rust/crates/caldaver-server/src/lib.rs');

  assert.match(sidebar, /id="shared_calendar_add"/);
  assert.match(sidebar, /id="shared_calendar_add"[\s\S]*fa-plus/);

  const calendarSidebar = sourceBetween(
    server,
    /fn calendar_sidebar\(\) -> String \{/,
    /\nfn calendar_bottom/
  );
  assert.match(calendarSidebar, /id="shared_calendar_add"/);
});

test('the floating create-event FAB is present on the calendar page in both renderers', () => {
  const calendar = read('web/templates/calendar.html');
  const server = read('rust/crates/caldaver-server/src/lib.rs');

  assert.match(calendar, /<button id="shortcut_add_event"/);
  assert.match(calendar, /create-event-button/);

  const renderCalendar = sourceBetween(
    server,
    /fn render_calendar\(state: &AppState, session: &Session\) -> String \{/,
    /\nfn render_cards/
  );
  assert.match(renderCalendar, /id="shortcut_add_event"/);
  assert.match(renderCalendar, /create-event-button/);
});

test('the desktop create-event FAB is an unconditional fixed round blue button', () => {
  const less = read('assets/less/caldaver.less');

  const block = cssBlock(less, '#shortcut_add_event.create-event-button');
  assert.match(block, /position:\s*fixed/);
  assert.match(block, /border-radius:\s*50%/);
  assert.match(block, /background:\s*#1a73e8/);
  assert.match(block, /bottom:/);
  assert.match(block, /right:/);

  const blockStart = less.indexOf('#shortcut_add_event.create-event-button {');
  const mediaStart = less.indexOf('@media (max-width: 900px)');
  assert.ok(
    blockStart < mediaStart,
    'the primary FAB rule must be defined outside of any @media block'
  );
});

test('the mobile @media FAB rule is recolored blue and not purple', () => {
  const less = read('assets/less/caldaver.less');
  const mobile = mediaBlock(less, '(max-width: 900px)');

  const fabRule = sourceBetween(
    mobile,
    /#shortcut_add_event\.create-event-button \{/,
    /\n  \}/
  );
  assert.match(fabRule, /#1a73e8/);
  assert.doesNotMatch(fabRule, /#7e7aa7/);
});

test('the legacy .mobile-fab is suppressed', () => {
  const less = read('assets/less/caldaver.less');
  assert.match(less, /\.mobile-fab\s*\{[\s\S]*display:\s*none/);
});

test('app.js binds calendar create to #shared_calendar_add and not #calendar_add', () => {
  const appJs = read('assets/js/app/app.js');

  assert.match(appJs, /\$\('#shared_calendar_add'\)/);
  assert.match(
    appJs,
    /\$\('#shared_calendar_add'\)[\s\S]*?\.on\('click',\s*calendar_create_dialog\)/
  );

  assert.doesNotMatch(appJs, /\$\('#calendar_add'\)\.on\('click', calendar_create_dialog\)/);
});

test('app.js guards the removed #own_calendar_list append', () => {
  const appJs = read('assets/js/app/app.js');

  assert.match(appJs, /var \$ownUl = \$\('#own_calendar_list ul'\)/);
  assert.match(appJs, /if \(\$ownUl\[0\]\)/);
  assert.doesNotMatch(
    appJs,
    /\$\('#own_calendar_list ul'\)\[0\]\.appendChild/,
    'the bare unguarded own-calendar append must be gone'
  );
});

test('app.js preserves the compound available_calendar selector', () => {
  const appJs = read('assets/js/app/app.js');
  assert.match(
    appJs,
    /#own_calendar_list li\.available_calendar, #shared_calendar_list li\.available_calendar/
  );
});

test('rebuilt dist assets include the FAB and add-button markers', () => {
  const distCss = read('web/public/dist/css/caldaver.css');
  const distJs = read('web/public/dist/js/caldaver.js');

  assert.match(distCss, /#1a73e8/);
  assert.match(distJs, /shared_calendar_add/);
  assert.match(distJs, /shortcut_add_event/);
});

test('shared-calendar remove UI is wired in source and dist', () => {
  const entry = read('assets/templates/calendar_list_entry.dust');
  const dialog = read('assets/templates/shared_calendar_remove_dialog.dust');
  const appJs = read('assets/js/app/app.js');
  const distJs = read('web/public/dist/js/caldaver.js');
  const distMin = read('web/public/dist/js/caldaver.min.js');
  const distCss = read('web/public/dist/css/caldaver.css');

  // Trash button only on shared rows in the per-row template.
  assert.match(entry, /\{?is_shared\}[\s\S]*?delete_shared_calendar[\s\S]*?\{?\/is_shared\}/);
  assert.match(entry, /class="delete_shared_calendar pseudobutton"/);
  assert.match(entry, /fa fa-trash/);
  // The existing .cfg cog button must be untouched.
  assert.match(entry, /class="cfg pseudobutton"/);

  // Dialog template references the new i18n key and a hidden calendar input.
  assert.match(dialog, /id="shared_calendar_remove_dialog"/);
  assert.match(dialog, /confirm_remove_shared_calendar/);
  assert.match(dialog, /name="calendar"/);

  // app.js binds the click, defines the dialog function, and POSTs to the new endpoint.
  assert.match(
    appJs,
    /div\.calendar_list[\s\S]*?'\.delete_shared_calendar'[\s\S]*?shared_calendar_remove_dialog/
  );
  assert.match(appJs, /var shared_calendar_remove_dialog = function/);
  // The function body references the new endpoint. The URL is concatenated with
  // CaldaverConf.base_app_url, so we only assert the path component appears in
  // the source.
  assert.match(appJs, /['"]calendars\/shared\/remove['"]/);

  // Rebuilt dist artifacts contain the new pieces.
  assert.match(distJs, /delete_shared_calendar/);
  assert.match(distJs, /shared_calendar_remove_dialog/);
  assert.match(distJs, /calendars\/shared\/remove/);
  assert.match(distMin, /delete_shared_calendar/);
  assert.match(distCss, /\.delete_shared_calendar/);
});
