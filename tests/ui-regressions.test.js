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

test('calendar creation posts to the backend save route', () => {
  const app = read('assets/js/app/app.js');

  assert.match(
    app,
    /var form_url = AgenDAVConf\.base_app_url \+ 'calendars\/save';/,
    'calendar_create_dialog must submit to the registered POST /calendars/save route'
  );

  assert.doesNotMatch(
    app,
    /var form_url = AgenDAVConf\.base_app_url \+ 'calendars';/,
    'calendar_create_dialog must not submit to the unrouted /calendars path'
  );
});

test('create event shortcut supplies a valid one-hour event range', () => {
  const app = read('assets/js/app/app.js');

  assert.match(
    app,
    /#shortcut_add_event[\s\S]*start: start,[\s\S]*end: moment\(start\)\.add\(1, 'hours'\),[\s\S]*open_event_edit_dialog\(data\);/,
    'the Create Event button should open the event dialog with both start and end moments'
  );
});

test('calendar-only overflow locking does not break preferences scrolling', () => {
  const layout = read('web/templates/layout.html');
  const calendar = read('web/templates/calendar.html');
  const preferences = read('web/templates/preferences.html');
  const less = read('assets/less/agendav.less');

  assert.match(
    layout,
    /<body class="\{% block body_class %\}\{% endblock %\}">/,
    'layout must expose a page-specific body class hook'
  );

  assert.match(
    calendar,
    /\{% block body_class %\}agendav-calendar-page\{% endblock %\}/,
    'only the calendar screen should opt into fixed-height overflow handling'
  );

  assert.doesNotMatch(
    preferences,
    /agendav-calendar-page/,
    'preferences must not opt into the calendar overflow lock'
  );

  assert.match(
    cssBlock(less, 'body.agendav-calendar-page'),
    /overflow:\s*hidden;/,
    'overflow hidden should be scoped to the calendar screen'
  );

  assert.doesNotMatch(
    cssBlock(less, 'body'),
    /overflow:\s*hidden;/,
    'plain body must remain scrollable for preferences and other long pages'
  );
});

test('calendar page emits a concrete translation catalogue for frontend startup', () => {
  const agendavJs = read('web/templates/parts/agendavjs.html');

  assert.match(
    agendavJs,
    /var translations = \{\{ app\.translator\.getCatalogue\(app\.request\.locale\)\.all\('messages'\)\|json_encode\|raw \}\};/,
    'frontend translations must come from the active translator catalogue, not a nullable internal messages property'
  );

  assert.doesNotMatch(
    agendavJs,
    /getMessages\(\)\.messages/,
    'the old expression can emit null and break all calendar click handlers'
  );
});
