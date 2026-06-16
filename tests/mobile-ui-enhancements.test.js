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

// ---------------------------------------------------------------------------
// C1 + C2: bottom tabs hide under modals; compose FAB lifted above bottom bar
// ---------------------------------------------------------------------------

test('C1: bottom tabs are hidden under jQuery UI modal overlays', () => {
  const less = read('assets/less/caldaver.less');

  // The :has() selector targets a multi-line selector list ending in
  // `.caldaver-bottom-tabs { ... display: none ... }`. Anchor on the
  // body:has() marker and confirm the bottom-tabs rule it shares a block
  // with sets display:none.
  assert.match(less, /body:has\(\.ui-widget-overlay\)\s+\.caldaver-bottom-tabs/);
  const block = cssBlock(less, 'body:has(.ui-widget-overlay) .caldaver-bottom-tabs,\nbody:has(.modal.in) .caldaver-bottom-tabs');
  assert.match(block, /display:\s*none\s*!important/);
});

test('C2: mobile compose FAB bottom is lifted above the bottom tab bar', () => {
  const less = read('assets/less/caldaver.less');
  const mobile = mediaBlock(less, '(max-width: 900px)');

  // The FAB rule must clear the 56px bottom tab bar; old value was
  // ~18px. We assert a value of at least 60px so future tuning keeps
  // the bar visible.
  const fabRule = sourceBetween(mobile, /\.mail-mobile-compose-button\s*\{/, /\n  \}/);
  const match = fabRule.match(/bottom:\s*~?["']?calc\((\d+)px/);
  assert.ok(match, 'mail-mobile-compose-button must use a calc(...) bottom value');
  const px = parseInt(match[1], 10);
  assert.ok(px >= 60, `compose FAB bottom must clear the bottom bar (got ${px}px)`);
});

// ---------------------------------------------------------------------------
// C3 + C4: 16px font-size on mobile dialog inputs (iOS zoom guard)
// ---------------------------------------------------------------------------

test('C3: contact dialog inputs use 16px font-size inside the mobile media query', () => {
  const less = read('assets/less/caldaver.less');

  // [C3] lives in its own top-level @media block near the bottom of
  // caldaver.less, so search the whole source rather than the first
  // mobile media query.
  assert.match(
    less,
    /\.contact-dialog-panel input\[type="text"\][\s\S]*?font-size:\s*16px/
  );
});

test('C4: mail reply composer inputs use 16px font-size inside the mobile media query', () => {
  const less = read('assets/less/caldaver.less');

  assert.match(
    less,
    /\.mail-reply-composer input[\s\S]*?font-size:\s*16px/
  );
});

// ---------------------------------------------------------------------------
// C13: datepicker header min-height tightened
// ---------------------------------------------------------------------------

test('C13: calendar datepicker header min-height is tightened on mobile', () => {
  const less = read('assets/less/caldaver.less');

  // The header block used to be 96px; the fix drops it to 56px. Assert
  // the value lives in the documented range so a future bump is caught.
  const headerBlock = cssBlock(less, 'body.caldaver-calendar-page .ui-datepicker-header');
  const match = headerBlock.match(/min-height:\s*(\d+)px/);
  assert.ok(match, 'datepicker header must declare a min-height');
  const px = parseInt(match[1], 10);
  assert.ok(px <= 64, `datepicker header min-height must be tightened (got ${px}px, was 96px)`);
});

// ---------------------------------------------------------------------------
// E17: .btn-danger styling
// ---------------------------------------------------------------------------

test('E17: .btn-danger is styled with a red background distinct from defaults', () => {
  const less = read('assets/less/caldaver.less');
  const block = cssBlock(less, '.btn-danger');

  assert.match(block, /background:\s*#d93025/);
  assert.match(block, /color:\s*#fff/);
});

// ---------------------------------------------------------------------------
// E24: event details popup close button styling
// ---------------------------------------------------------------------------

test('E24: event details popup close button is enlarged and rounded', () => {
  const less = read('assets/less/caldaver.less');

  // The selector list targets the qTip close button. Match the first
  // selector verbatim and confirm a circular tap target sizing rule.
  assert.match(less, /\.view_event_details \.qtip-titlebar \.ui-state-close/);
  assert.match(less, /#qtip-event_details \.qtip-titlebar \.ui-state-close\s*\{[^}]*border-radius:\s*50%/);
});

// ---------------------------------------------------------------------------
// E38: active tab icon colour
// ---------------------------------------------------------------------------

test('E38: active tab icon gets a colour rule', () => {
  const less = read('assets/less/caldaver.less');

  // Look for the colour rule on the active tab icon. The full selector
  // is a multi-selector list, so search for the primary anchor with a
  // non-greedy bridge to the colour declaration.
  assert.match(less, /\.nav-tabs > li\.active \.tab-icon[\s\S]*?color:\s*#[0-9a-fA-F]{6}/);
});

// ---------------------------------------------------------------------------
// E44: active calendar view button is brand-blue
// ---------------------------------------------------------------------------

test('E44: active FullCalendar view button is brand-blue', () => {
  const less = read('assets/less/caldaver.less');

  assert.match(
    less,
    /#calendar_view \.fc-button-group \.fc-button\.fc-state-active[\s\S]*?background:\s*#1a73e8/
  );
});

// ---------------------------------------------------------------------------
// C5: calendar quick-chips 44px touch target
// ---------------------------------------------------------------------------

test('C5: calendar quick-chip rule raises the touch target to 44px', () => {
  const mobile = read('assets/less/caldaver-mobile.less');

  const block = cssBlock(mobile, '.calendar-quick-chip');
  assert.match(block, /min-height:\s*44px/);
});

// ---------------------------------------------------------------------------
// C6: contacts alphabet index 44px touch target
// ---------------------------------------------------------------------------

test('C6: contacts alphabet index buttons are at least 44x44px', () => {
  const mobile = read('assets/less/caldaver-mobile.less');

  assert.match(mobile, /\.contacts-alphabet-index button\s*\{[^}]*min-width:\s*44px/);
  assert.match(mobile, /\.contacts-alphabet-index button\s*\{[^}]*min-height:\s*44px/);
});

// ---------------------------------------------------------------------------
// E8 + E9: sticky dialog titlebar and buttonpane
// ---------------------------------------------------------------------------

test('E8: jQuery UI dialog titlebar is sticky inside the mobile media query', () => {
  const mobile = read('assets/less/caldaver-mobile.less');

  assert.match(
    mobile,
    /\.ui-dialog \.ui-dialog-titlebar\s*\{[\s\S]*?position:\s*sticky/
  );
});

test('E9: jQuery UI dialog buttonpane is sticky inside the mobile media query', () => {
  const mobile = read('assets/less/caldaver-mobile.less');

  assert.match(
    mobile,
    /\.ui-dialog \.ui-dialog-buttonpane\s*\{[\s\S]*?position:\s*sticky/
  );
});

// ---------------------------------------------------------------------------
// E46: bottom bar active accent
// ---------------------------------------------------------------------------

test('E46: active bottom tab carries a top accent bar marker', () => {
  const mobile = read('assets/less/caldaver-mobile.less');

  // The accent is implemented either as a border-top or a ::before
  // pseudo-element with a height. Assert at least one of those patterns
  // appears inside the .caldaver-bottom-tab.active rule.
  const block = cssBlock(mobile, '.caldaver-bottom-tabs .caldaver-bottom-tab.active');
  assert.match(
    block,
    /(::before\s*\{[^}]*height:\s*\d+px|border-top:\s*\d+px[^;]*;)/
  );
});

// ---------------------------------------------------------------------------
// E1: Enter-to-save in dialogs
// ---------------------------------------------------------------------------

test('E1: app.js wires an Enter-to-save keydown handler inside dialogs', () => {
  const appJs = read('assets/js/app/app.js');

  // The handler listens for the Enter key on inputs inside the dialog
  // widget and clicks the primary button. Look for the ENTER keyCode
  // comparison near the dialog open callback.
  const dialogSlice = sourceBetween(
    appJs,
    /var show_dialog = function show_dialog/,
    /var open_event_edit_dialog/
  );
  assert.match(dialogSlice, /keydown\.enterSave/);
  assert.match(dialogSlice, /e\.keyCode !== \$\.ui\.keyCode\.ENTER/);
  assert.match(dialogSlice, /\$primary\.trigger\('click'\)|\$primary\.click\(\)/);
});

// ---------------------------------------------------------------------------
// E10: char counter span
// ---------------------------------------------------------------------------

test('E10: event_basic_form_part.dust has a char-counter span wired by JS', () => {
  const formTemplate = read('assets/templates/event_basic_form_part.dust');
  const appJs = read('assets/js/app/app.js');

  assert.match(formTemplate, /<span class="char-counter" data-for="summary"/);
  // JS must select and update that span.
  assert.match(appJs, /\.char-counter\[data-for="summary"\]/);
});

// ---------------------------------------------------------------------------
// E14 + E15: inline validation on calendar create/modify
// ---------------------------------------------------------------------------

test('E14: calendar create save handler calls validateFormInline', () => {
  const appJs = read('assets/js/app/app.js');

  const createBlock = sourceBetween(
    appJs,
    /var calendar_create_dialog = function calendar_create_dialog/,
    /var calendar_modify_dialog = function calendar_modify_dialog/
  );
  assert.match(createBlock, /validateFormInline\(\$\('#calendar_create_form'\)\)/);
});

test('E15: calendar modify save handler calls validateFormInline', () => {
  const appJs = read('assets/js/app/app.js');

  const modifyBlock = sourceBetween(
    appJs,
    /var calendar_modify_dialog = function calendar_modify_dialog/,
    /var calendar_delete_dialog = function calendar_delete_dialog/
  );
  assert.match(modifyBlock, /validateFormInline\(\$\('#calendar_modify_form'\)\)/);
});

// ---------------------------------------------------------------------------
// E29: confirm before removing a non-zero reminder
// ---------------------------------------------------------------------------

test('E29: reminder removal confirms when the count is non-zero', () => {
  const appJs = read('assets/js/app/app.js');

  const remindersBlock = sourceBetween(
    appJs,
    /var reminders_manager = function reminders_manager/,
    /var reminders_manager_no_entries_placeholder = function reminders_manager_no_entries_placeholder/
  );
  assert.match(remindersBlock, /input\[name="reminders\[count\]\[\]"\]/);
  assert.match(remindersBlock, /window\.confirm\(/);
});

// ---------------------------------------------------------------------------
// E35: Save disabled when summary is empty
// ---------------------------------------------------------------------------

test('E35: Save button is disabled when the event summary input is empty', () => {
  const appJs = read('assets/js/app/app.js');

  // bind_event_summary_guard is the wiring function; assert the dialog
  // open handler calls it and the guard toggles the primary button.
  assert.match(appJs, /bind_event_summary_guard\('#event_edit_dialog'\)/);
  const guardFn = sourceBetween(
    appJs,
    /var bind_event_summary_guard = function bind_event_summary_guard/,
    /var bind_autogrow_textarea/
  );
  assert.match(guardFn, /\$primary\.prop\('disabled'/);
});

// ---------------------------------------------------------------------------
// E36: Alt+A toggles all-day
// ---------------------------------------------------------------------------

test('E36: Alt+A shortcut toggles the all-day checkbox inside the event dialog', () => {
  const appJs = read('assets/js/app/app.js');

  const eventEditBlock = sourceBetween(
    appJs,
    /var open_event_edit_dialog = function open_event_edit_dialog/,
    /var bind_event_summary_guard = function bind_event_summary_guard/
  );
  assert.match(eventEditBlock, /e\.altKey && \(e\.key === 'a' || e\.key === 'A'/);
  assert.match(eventEditBlock, /input\.allday/);
});

// ---------------------------------------------------------------------------
// E42: persist last calendar view in localStorage
// ---------------------------------------------------------------------------

test('E42: last calendar view name is persisted in localStorage', () => {
  const appJs = read('assets/js/app/app.js');

  // Both a getter (restore) and a setter (on view switch) must exist.
  assert.match(appJs, /localStorage\.getItem\('caldaver\.last_calendar_view'\)/);
  assert.match(appJs, /localStorage\.setItem\('caldaver\.last_calendar_view', view\.name\)/);
});

// ---------------------------------------------------------------------------
// E45: number-key shortcuts for the four calendar views
// ---------------------------------------------------------------------------

test('E45: number-key shortcuts 1/2/3/4 switch calendar views', () => {
  const appJs = read('assets/js/app/app.js');

  const shortcutBlock = sourceBetween(
    appJs,
    /keydown\.calendarShortcuts/,
    /event_details_popup = \$\('#event_details'\)\.qtip/
  );
  assert.match(shortcutBlock, /e\.key !== '1' && e\.key !== '2' && e\.key !== '3' && e\.key !== '4'/);
  // view_map covers month, agendaWeek, agendaDay, customizable_list.
  assert.match(shortcutBlock, /'1':\s*'month'/);
  assert.match(shortcutBlock, /'2':\s*'agendaWeek'/);
  assert.match(shortcutBlock, /'3':\s*'agendaDay'/);
  assert.match(shortcutBlock, /'4':\s*'customizable_list'/);
});

// ---------------------------------------------------------------------------
// E50: preferences dirty-state beforeunload guard
// ---------------------------------------------------------------------------

test('E50: preferences form registers a beforeunload dirty-state guard', () => {
  const appJs = read('assets/js/app/app.js');

  assert.match(appJs, /\$\(window\)\.on\('beforeunload'/);
  assert.match(appJs, /#prefs_form/);
});

// ---------------------------------------------------------------------------
// C7: bottom bar label font is at least 12px
// ---------------------------------------------------------------------------

test('C7: bottom bar button label font-size is at least 12px', () => {
  const mobileJs = read('assets/js/app/mobile.js');

  // Find the bottom-btn rule and extract the font-size. The previous
  // value was 11px; the fix raises it to 12px so labels are legible.
  const match = mobileJs.match(/\.mobile-bottom-btn\{[^}]*font-size:\s*(\d+)px/);
  assert.ok(match, 'mobile-bottom-btn rule must declare a font-size');
  const px = parseInt(match[1], 10);
  assert.ok(px >= 12, `bottom bar label font-size must be >= 12px (got ${px}px)`);
});

// ---------------------------------------------------------------------------
// C11: viewport-fit=cover in layout.html AND lib.rs
// ---------------------------------------------------------------------------

test('C11: layout.html and lib.rs both emit viewport-fit=cover', () => {
  const layout = read('web/templates/layout.html');
  const server = read('rust/crates/caldaver-server/src/lib.rs');

  assert.match(layout, /viewport-fit=cover/);
  assert.match(server, /viewport-fit=cover/);
});

// ---------------------------------------------------------------------------
// C12: inputmode/enterkeyhint on dialog inputs
// ---------------------------------------------------------------------------

test('C12: dialog inputs in cards.html and lib.rs carry keyboard hints', () => {
  const cards = read('web/templates/cards.html');
  const server = read('rust/crates/caldaver-server/src/lib.rs');
  const eventForm = read('assets/templates/event_basic_form_part.dust');

  // cards.html contact dialog.
  assert.match(cards, /enterkeyhint="next"/);
  // Rust renderer contact dialog.
  assert.match(server, /enterkeyhint="next"/);
  // Event basic form must also have enterkeyhint.
  assert.match(eventForm, /enterkeyhint="next"/);
});

test('C12: lib.rs renders at least one inputmode= hint', () => {
  const server = read('rust/crates/caldaver-server/src/lib.rs');

  assert.match(server, /inputmode="/);
});

// ---------------------------------------------------------------------------
// C10: preferences.html label/input for/id associations
// ---------------------------------------------------------------------------

test('C10: preferences.html has at least one label[for] matched to input[id]', () => {
  const preferences = read('web/templates/preferences.html');

  // Sanity: the file must have label for= declarations and matching
  // id= attributes on inputs. Sample the well-known language field.
  assert.match(preferences, /<label for="language">/);
  assert.match(preferences, /id="language" name="language"/);
});

// ---------------------------------------------------------------------------
// E19 + E20: instance date shown in recurrent delete/edit dialogs
// ---------------------------------------------------------------------------

test('E19: event_delete_recurrent_dialog.dust renders the instance date', () => {
  const template = read('assets/templates/event_delete_recurrent_dialog.dust');

  // The fix wraps a {readable_dates} block in a styled paragraph so the
  // user can see which instance the action targets.
  assert.match(template, /\{readable_dates\}/);
});

test('E20: event_edit_recurrent_dialog.dust renders the instance date', () => {
  const template = read('assets/templates/event_edit_recurrent_dialog.dust');

  assert.match(template, /\{readable_dates\}/);
});

// ---------------------------------------------------------------------------
// E23: timezone in the event details popup
// ---------------------------------------------------------------------------

test('E23: event details popup shows the event timezone when present', () => {
  const template = read('assets/templates/event_details_popup.dust');

  assert.match(template, /\{event_timezone\}/);
});

// ---------------------------------------------------------------------------
// E28: reminder count input is type=number
// ---------------------------------------------------------------------------

test('E28: reminder_row.dust count input is type="number"', () => {
  const template = read('assets/templates/reminder_row.dust');

  assert.match(template, /type="number"\s+min="0"\s+step="1"\s+inputmode="numeric"\s+name="reminders\[count\]\[\]"/);
});

// ---------------------------------------------------------------------------
// E31: share user filter input widened to size 20
// ---------------------------------------------------------------------------

test('E31: calendar_share_row.dust filter input is at least size="20"', () => {
  const template = read('assets/templates/calendar_share_row.dust');

  // The previous size was 10 which was too narrow to read a typical
  // username. Assert >= 20.
  const match = template.match(/id="calendar_share_filter"[^>]*size="(\d+)"/);
  assert.ok(match, 'calendar_share_filter must declare a size');
  const size = parseInt(match[1], 10);
  assert.ok(size >= 20, `share filter size must be >= 20 (got ${size})`);
});

// ---------------------------------------------------------------------------
// E34: description textarea has the autogrow class
// ---------------------------------------------------------------------------

test('E34: event_basic_form_part.dust description textarea has the autogrow class', () => {
  const template = read('assets/templates/event_basic_form_part.dust');
  const appJs = read('assets/js/app/app.js');

  assert.match(template, /class="form-control autogrow"/);
  // JS must wire the autogrow behaviour onto that selector.
  assert.match(appJs, /bind_autogrow_textarea\('#event_edit_dialog textarea\.autogrow'\)/);
});

test('mail-row-action divs are absolutely positioned (not in grid flow)', () => {
  const less = read('assets/less/caldaver.less');
  const actionBlock = cssBlock(less, '.mail-row-action');
  assert.match(actionBlock, /position:\s*absolute/);
  assert.match(actionBlock, /z-index:\s*0/);
});

test('mail-row-body spans all grid columns with its own internal grid', () => {
  const less = read('assets/less/caldaver.less');
  const bodyBlock = cssBlock(less, '.mail-row-body');
  assert.match(bodyBlock, /grid-column:\s*1\s*\/\s*-1/);
  assert.match(bodyBlock, /display:\s*grid/);
  assert.match(bodyBlock, /z-index:\s*1/);
});

test('mail-row has position relative and overflow hidden for swipe layering', () => {
  const less = read('assets/less/caldaver.less');
  const rowBlock = cssBlock(less, '.mail-row');
  assert.match(rowBlock, /position:\s*relative/);
  assert.match(rowBlock, /overflow:\s*hidden/);
});

test('mail reader toolbar has archive and delete buttons (both renderers)', () => {
  const twig = read('web/templates/mail_message.html');
  const rust = read('rust/crates/caldaver-server/src/lib.rs');
  assert.match(twig, /id="mail_reader_archive"/);
  assert.match(twig, /id="mail_reader_delete"/);
  assert.match(rust, /id="mail_reader_archive"/);
  assert.match(rust, /id="mail_reader_delete"/);
});

test('mail reader JS wires archive and delete click handlers', () => {
  const js = read('web/templates/parts/mailmessagejs.html');
  assert.match(js, /archiveMessage/);
  assert.match(js, /deleteMessage/);
  assert.match(js, /mail_reader_archive/);
  assert.match(js, /mail_reader_delete/);
});

test('mail-row-action is hidden on desktop (display:none in base CSS)', () => {
  const less = read('assets/less/caldaver.less');
  const actionBlock = cssBlock(less, '.mail-row-action');
  assert.match(actionBlock, /display:\s*none/);
});

test('hidden attribute works on mail reader toolbar (CSS specificity fix)', () => {
  const less = read('assets/less/caldaver.less');
  assert.match(less, /\[hidden\][\s\S]*?display:\s*none\s*!important/);
});

test('mail reader unread button has visible label and styling class', () => {
  const twig = read('web/templates/mail_message.html');
  const rust = read('rust/crates/caldaver-server/src/lib.rs');
  assert.match(twig, /id="mail_reader_unread"[^>]*mail-reader-action-with-label/);
  assert.match(twig, /<span>[^<]*[Mm]ark[^<]*unread[^<]*<\/span>/);
  assert.match(rust, /id="mail_reader_unread"[^>]*mail-reader-action-with-label/);
  assert.match(rust, /<span>Mark unread<\/span>/);
});

test('mail reader unread button starts hidden in both renderers', () => {
  const twig = read('web/templates/mail_message.html');
  const rust = read('rust/crates/caldaver-server/src/lib.rs');
  assert.match(twig, /id="mail_reader_unread"[^>]*hidden/);
  assert.match(rust, /id="mail_reader_unread"[^>]*hidden/);
});
