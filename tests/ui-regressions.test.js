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
    /var form_url = CaldaverConf\.base_app_url \+ 'calendars\/save';/,
    'calendar_create_dialog must submit to the registered POST /calendars/save route'
  );

  assert.doesNotMatch(
    app,
    /var form_url = CaldaverConf\.base_app_url \+ 'calendars';/,
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
  const less = read('assets/less/caldaver.less');

  assert.match(
    layout,
    /<body class="\{% block body_class %\}\{% endblock %\}">/,
    'layout must expose a page-specific body class hook'
  );

  assert.match(
    calendar,
    /\{% block body_class %\}caldaver-calendar-page\{% endblock %\}/,
    'only the calendar screen should opt into fixed-height overflow handling'
  );

  assert.doesNotMatch(
    preferences,
    /caldaver-calendar-page/,
    'preferences must not opt into the calendar overflow lock'
  );

  assert.match(
    cssBlock(less, 'body.caldaver-calendar-page'),
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
  const caldaverJs = read('web/templates/parts/caldaverjs.html');

  assert.match(
    caldaverJs,
    /var translations = \{\{ app\.translator\.getCatalogue\(app\.request\.locale\)\.all\('messages'\)\|json_encode\|raw \}\};/,
    'frontend translations must come from the active translator catalogue, not a nullable internal messages property'
  );

  assert.doesNotMatch(
    caldaverJs,
    /getMessages\(\)\.messages/,
    'the old expression can emit null and break all calendar click handlers'
  );
});

test('topbar user actions stay in a horizontal row under Bootstrap 5', () => {
  const navbar = read('web/templates/parts/navbar.html');
  const less = read('assets/less/caldaver.less');

  assert.match(
    navbar,
    /<ul class="nav navbar-nav navbar-right topbar-actions" id="usermenu">/,
    'user menu should have an explicit topbar action class instead of relying only on Bootstrap navbar classes'
  );

  assert.match(
    less,
    /\.navbar-nav\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*row;[\s\S]*align-items:\s*center;/,
    'Bootstrap 5 makes navbar-nav a column by default, so the topbar must force the user actions back into a row'
  );
  assert.match(
    cssBlock(less, '#usermenu .user-pill'),
    /text-decoration:\s*none;/,
    'the username pill should not show browser link underlines'
  );
});

test('Caldaver branding does not render the legacy image logo', () => {
  const sidebrand = read('web/templates/parts/sidebrand.html');
  const templates = [
    'web/templates/parts/sidebar.html',
    'web/templates/cards.html',
    'web/templates/mail.html',
    'web/templates/mail_message.html',
    'web/templates/login.html'
  ].map(read).join('\n');

  assert.match(sidebrand, />\s*Caldaver\s*</);
  assert.doesNotMatch(templates, /asset\(logo,\s*'img'\)/);
  assert.doesNotMatch(templates, /<img[^>]+Logo/);
  assert.match(templates, /parts\/sidebrand\.html/);
});

test('mobile navigation moves app sections into the topbar without removing desktop side nav', () => {
  const navbar = read('web/templates/parts/navbar.html');
  const calendar = read('web/templates/calendar.html');
  const cards = read('web/templates/cards.html');
  const mail = read('web/templates/mail.html');
  const less = read('assets/less/caldaver.less');

  assert.match(navbar, /class="mobile-section-menu"/);
  assert.match(navbar, /app\.url_generator\.generate\('calendar'\)/);
  assert.match(navbar, /app\.url_generator\.generate\('cards'\)/);
  assert.match(navbar, /app\.url_generator\.generate\('mail'\)/);
  assert.match(calendar, /\{% set active_section = 'calendar' %\}/);
  assert.match(cards, /\{% set active_section = 'cards' %\}/);
  assert.match(mail, /\{% set active_section = 'mail' %\}/);
  assert.match(less, /\.mobile-section-menu\s*\{[\s\S]*display:\s*none;/);
  assert.match(less, /@media \(max-width:\s*900px\)[\s\S]*\.mobile-section-menu\s*\{[\s\S]*display:\s*block;/);
  assert.match(less, /@media \(max-width:\s*900px\)[\s\S]*#sidebar \.app-nav,[\s\S]*\.cards-sidebar \.app-nav,[\s\S]*\.mail-sidebar \.app-nav[\s\S]*display:\s*none;/);
});

test('mobile calendar and contacts layouts are allowed to scroll', () => {
  const less = read('assets/less/caldaver.less');

  assert.match(less, /@media \(max-width:\s*900px\)[\s\S]*body\.caldaver-calendar-page\s*\{[\s\S]*overflow:\s*auto;/);
  assert.match(less, /@media \(max-width:\s*900px\)[\s\S]*#wrapper\.calendar-layout\s*\{[\s\S]*height:\s*auto;/);
  assert.match(less, /@media \(max-width:\s*900px\)[\s\S]*#calendar_view\s*\{[\s\S]*min-height:\s*720px;/);
  assert.match(less, /@media \(max-width:\s*900px\)[\s\S]*\.contacts-panel\s*\{[\s\S]*overflow:\s*visible;/);
});

test('calendar, contacts, and mail startup states show loading instead of zero counts', () => {
  const sidebar = read('web/templates/parts/sidebar.html');
  const calendarApp = read('assets/js/app/app.js');
  const cards = read('web/templates/cards.html');
  const cardsJs = read('web/templates/parts/cardsjs.html');
  const mailJs = read('web/templates/parts/mailjs.html');

  assert.match(sidebar, /class="calendar-list-loading"[\s\S]*Loading calendars/);
  assert.match(sidebar, /class="calendar-list-loading"[\s\S]*Loading shared calendars/);
  assert.match(calendarApp, /\.calendar-list-loading'\)\.remove\(\)/);
  assert.match(calendarApp, /\.calendar-list-loading'\)\.text\('Unable to load calendars'\)/);

  assert.match(cards, /id="contact_count_nav" class="contacts-nav-count">\.\.\.<\/span>/);
  assert.match(cards, /id="contact_count">Loading\.\.\.<\/span>/);
  assert.match(cards, /id="contacts_loading"/);
  assert.doesNotMatch(cards, /id="contact_count_nav" class="contacts-nav-count">0<\/span>/);
  assert.doesNotMatch(cards, /id="contact_count">\(0\)<\/span>/);
  assert.match(cardsJs, /var contactsLoading = true;/);
  assert.match(cardsJs, /contactsLoading \? 'Loading\.\.\.' : \(data\.length > 0 \? '\(' \+ data\.length \+ '\)' : ''\)/);
  assert.match(cardsJs, /contactsLoading \? '\.\.\.' : \(contacts\.length > 0 \? contacts\.length : ''\)/);

  assert.match(mailJs, /var mailStatus = 'loading';/);
  assert.match(mailJs, /setMailStatus\('loading', 'Loading cached mail\.\.\.'\);/);
});

test('login form labels cannot overlap input fields under Bootstrap 5', () => {
  const login = read('web/templates/login.html');
  const less = read('assets/less/caldaver.less');

  assert.match(login, /<input id="user" name="user"[\s\S]*autocomplete="username"[\s\S]*enterkeyhint="next"/);
  assert.match(login, /<input id="password" name="password"[\s\S]*autocomplete="current-password"[\s\S]*enterkeyhint="go"/);
  assert.match(less, /\.loginform\s*\{[\s\S]*grid-template-columns:\s*96px minmax\(0, 1fr\)/);
  assert.match(less, /\.loginform\s*\{[\s\S]*white-space:\s*nowrap/);
  assert.match(less, /\.form-horizontal \.col-sm-3,\n  \.form-horizontal \.col-sm-9/);
  assert.match(less, /@media \(max-width:\s*600px\)[\s\S]*\.loginform \.form-horizontal \.form-group\s*\{[\s\S]*grid-template-columns:\s*1fr;/);
  assert.match(less, /@media \(max-width:\s*600px\)[\s\S]*\.loginform \.form-horizontal \.control-label\s*\{[\s\S]*white-space:\s*normal;/);
});

test('preferences form is grouped for responsive scanning without changing posted field names', () => {
  const preferences = read('web/templates/preferences.html');
  const less = read('assets/less/caldaver.less');

  assert.match(preferences, /<fieldset class="prefs-section">/);
  assert.match(preferences, /<legend>\{% trans %\}labels\.generaloptions\{% endtrans %\}<\/legend>/);
  assert.match(preferences, /<legend>\{% trans %\}labels\.calendars\{% endtrans %\}<\/legend>/);

  for (const name of [
    'language',
    'date_format',
    'time_format',
    'weekstart',
    'timezone',
    'default_calendar',
    'default_view',
    'show_week_nb',
    'show_now_indicator',
    'disable_javascript',
    'list_days'
  ]) {
    assert.match(preferences, new RegExp(`name="${name}"`), `${name} must remain in the submitted form`);
  }

  assert.match(preferences, /role="radiogroup" aria-labelledby="date_format_label"/);
  assert.match(preferences, /id="disable_javascript_yes" type="radio" name="disable_javascript"/);
  assert.match(less, /\.prefs-section\s*\{/);
  assert.match(less, /\.prefs-radio-group \.radio-inline\s*\{[\s\S]*min-height:\s*36px;/);
  assert.match(less, /@media \(max-width:\s*600px\)[\s\S]*#prefs_buttons\s*\{[\s\S]*flex-direction:\s*column;/);
});

test('mobile shell CSS preserves tap targets, dialogs, safe areas, and focus rings', () => {
  const less = read('assets/less/caldaver.less');

  assert.match(less, /:focus-visible[\s\S]*outline:\s*3px solid #1a73e8;/);
  assert.match(less, /\.calendar-shell\s*\{[\s\S]*height:\s*~"calc\(100dvh - 64px\)";[\s\S]*env\(safe-area-inset-bottom\)/);
  assert.match(less, /\.cards-shell\s*\{[\s\S]*height:\s*~"calc\(100dvh - 64px\)";/);
  assert.match(less, /\.mail-shell\s*\{[\s\S]*height:\s*~"calc\(100dvh - 64px\)";/);
  assert.match(less, /@media \(max-width:\s*900px\)[\s\S]*\.ui-dialog\s*\{[\s\S]*max-width:\s*~"calc\(100vw - 24px\)" !important;/);
  assert.match(less, /@media \(max-width:\s*900px\)[\s\S]*\.ui-dialog \.ui-dialog-content\s*\{[\s\S]*max-height:\s*~"calc\(100dvh - 140px\)" !important;/);
  assert.match(less, /@media \(max-width:\s*900px\)[\s\S]*\.mail-accounts\s*\{[\s\S]*display:\s*flex;[\s\S]*overflow-x:\s*auto;/);
  assert.match(less, /@media \(max-width:\s*900px\)[\s\S]*\.contacts-view-switch\s*\{[\s\S]*min-height:\s*44px;/);
  assert.match(less, /@media \(max-width:\s*900px\)[\s\S]*\.mail-reader-html\s*\{[\s\S]*width:\s*100%;/);
});

test('mail reader content uses the full available read pane width', () => {
  const less = read('assets/less/caldaver.less');
  const reader = cssBlock(less, '.mail-reader');
  const message = cssBlock(less, '.mail-reader-message');
  const body = cssBlock(less, '.mail-reader-message pre');
  const html = cssBlock(less, '.mail-reader-html');
  const attachments = cssBlock(less, '.mail-reader-message .mail-attachments');

  assert.match(reader, /width:\s*100%;/);
  assert.match(reader, /min-width:\s*0;/);
  assert.match(message, /width:\s*100%;/);
  assert.match(message, /max-width:\s*none;/);
  assert.match(message, /box-sizing:\s*border-box;/);
  assert.match(message, /margin:\s*0;/);
  assert.match(less, /\.mail-read-shell \.mail-content\s*\{[\s\S]*padding-right:\s*0;/);
  assert.match(less, /@media \(max-width:\s*900px\)[\s\S]*\.mail-read-shell \.mail-content\s*\{[\s\S]*padding:\s*0;/);
  assert.match(body, /width:\s*100%;/);
  assert.match(body, /margin:\s*0 0 24px;/);
  assert.match(html, /width:\s*100%;/);
  assert.match(html, /margin:\s*0 0 24px;/);
  assert.match(attachments, /margin-left:\s*0;/);
  assert.doesNotMatch(message, /max-width:\s*1120px;/);
  assert.doesNotMatch(body, /margin:\s*0 0 24px 56px;/);
  assert.doesNotMatch(html, /calc\(100% - 56px\)/);
});

test('plain Fractal serializer keeps PHP 8 compatible method signatures', () => {
  const serializer = read('web/src/Data/Serializer/PlainSerializer.php');

  assert.match(
    serializer,
    /public function collection\(\?string \$resourceKey, array \$data\): array/,
    'PlainSerializer::collection must match League Fractal ArraySerializer on PHP 8+'
  );

  assert.doesNotMatch(
    serializer,
    /public function collection\(\$resourceKey, array \$data\)/,
    'old untyped PlainSerializer::collection signature causes a fatal when loading events'
  );
});

test('cards section exposes CardDAV routes and a left navigation tab', () => {
  const controllers = read('web/app/controllers.php');
  const services = read('web/app/services.php');
  const appNav = read('web/templates/parts/appnav.html');
  const sidebar = read('web/templates/parts/sidebar.html');

  assert.match(controllers, /->get\('\/cards', '\\Caldaver\\Controller\\Cards::indexAction'\)->bind\('cards'\)/);
  assert.match(controllers, /->get\('\/cards\/list', '\\Caldaver\\Controller\\Cards::listAction'\)->bind\('cards\.list'\)/);
  assert.match(controllers, /->post\('\/cards\/save', '\\Caldaver\\Controller\\Cards::saveAction'\)->bind\('cards\.save'\)/);
  assert.match(controllers, /->post\('\/cards\/delete', '\\Caldaver\\Controller\\Cards::deleteAction'\)->bind\('cards\.delete'\)/);
  assert.match(services, /\$app\['carddav\.client'\]/);
  assert.match(appNav, /app\.url_generator\.generate\('cards'\)/);
  assert.match(sidebar, /include 'parts\/appnav\.html'/);
});

test('cards page renders list and card views without loading the calendar bundle', () => {
  const cards = read('web/templates/cards.html');
  const cardsJs = read('web/templates/parts/cardsjs.html');
  const less = read('assets/less/caldaver.less');

  assert.match(cards, /id="contacts_list"/);
  assert.match(cards, /id="contacts_cards"/);
  assert.match(cards, /data-view="cards"/);
  assert.doesNotMatch(cards, /class="active" data-view="list"/);
  assert.match(cards, /id="contact_form"/);
  assert.match(cardsJs, /fetch\('\{\{ app\.url_generator\.generate\('cards\.list'\) \}\}'/);
  assert.match(cardsJs, /fetch\(event\.target\.action/);
  assert.match(cardsJs, /app\.url_generator\.generate\('cards\.delete'\)/);
  assert.match(cardsJs, /class="contact-delete/);
  assert.match(cardsJs, /window\.matchMedia\('\(max-width: 900px\)'\)/);
  assert.match(cardsJs, /function defaultContactView\(\)/);
  assert.match(cardsJs, /setContactView\(defaultContactView\(\)\)/);
  assert.match(cardsJs, /window\.confirm\('Delete '/);
  assert.match(cardsJs, /button\.disabled = true/);
  assert.match(cardsJs, /button\.disabled = false/);
  assert.doesNotMatch(cards, /parts\/bottom\.html/, 'cards page must not initialize FullCalendar app.js');
  assert.match(less, /\.contacts-card-grid/);
  assert.match(less, /\.contact-row/);
  assert.match(less, /\.contact-delete/);
});

test('CardDAV support can discover, create, query, and write local addressbooks', () => {
  const auth = read('web/src/Controller/Authentication.php');
  const client = read('web/src/CardDAV/Client.php');
  const services = read('web/app/services.php');
  const settings = read('docker/settings.php');
  const run = read('docker/run.sh');
  const contact = read('web/src/CardDAV/Contact.php');
  const generator = read('web/src/XML/Generator.php');
  const parser = read('web/src/XML/Parser.php');
  const http = read('web/src/Http/Client.php');

  assert.match(auth, /addressbook_home_set/);
  assert.match(auth, /carddav\.http\.client/);
  assert.match(services, /\$app\['carddav\.baseurl'\]/);
  assert.match(services, /\$app\['carddav\.http\.client'\]/);
  assert.match(settings, /\$app\['carddav\.baseurl'\] = 'CALDAVER_CARDDAV_SERVER';/);
  assert.match(run, /CALDAVER_CARDDAV_SERVER:=\$CALDAVER_CALDAV_SERVER/);
  assert.match(client, /getAddressBookHomeSet/);
  assert.match(client, /getOrCreateDefaultAddressBook/);
  assert.match(client, /fetchContactsFromAddressBooks/);
  assert.match(client, /REPORT-ADDRESSBOOK/);
  assert.match(client, /setContentTypeVCard/);
  assert.match(client, /deleteContact/);
  assert.match(contact, /Sabre\\VObject\\Component\\VCard/);
  assert.match(generator, /mkAddressBookBody/);
  assert.match(generator, /addressBookQueryBody/);
  assert.match(parser, /\{urn:ietf:params:xml:ns:carddav\}addressbook-home-set/);
  assert.match(http, /function setContentTypeVCard\(\)/);
});

test('Radicale principal paths are not shown as the topbar display name', () => {
  const auth = read('web/src/Controller/Authentication.php');

  assert.match(auth, /displayNameForSession/);
  assert.match(auth, /preg_match\('#\^\/\.\+\/\$#', \$displayName\)/);
  assert.match(auth, /trim\(\(string\)\$user, '\/'\)/);
  assert.doesNotMatch(
    auth,
    /\$app\['session'\]->set\('displayname', \$principal->getDisplayName\(\)\);/,
    'the raw principal display name can be /user/ from Radicale'
  );
});

test('Caldaver login credentials are separate from DAV service credentials', () => {
  const auth = read('web/src/Controller/Authentication.php');
  const clientFactory = read('web/src/Http/ClientFactory.php');
  const services = read('web/app/services.php');
  const settings = read('docker/settings.php');
  const defaults = read('web/config/default.settings.php');
  const run = read('docker/run.sh');

  assert.match(auth, /validLocalCredentials/);
  assert.match(auth, /\$app\['auth\.local\.username'\]/);
  assert.match(auth, /\$app\['auth\.local\.password'\]/);
  assert.match(auth, /\$app\['caldav\.username'\]/);
  assert.match(auth, /\$app\['caldav\.password'\]/);
  assert.match(auth, /set\('dav_username', \$davUser\)/);
  assert.match(auth, /set\('dav_password', \$davPassword\)/);
  assert.match(clientFactory, /has\('dav_username'\) && \$session->has\('dav_password'\)/);
  assert.match(services, /get\('dav_username', \$app\['session'\]->get\('username'\)\)/);
  assert.match(settings, /\$app\['auth\.local\.username'\] = 'CALDAVER_AUTH_USERNAME';/);
  assert.match(settings, /\$app\['auth\.local\.password'\] = 'CALDAVER_AUTH_PASSWORD';/);
  assert.match(settings, /\$app\['caldav\.username'\] = 'CALDAVER_CALDAV_USERNAME';/);
  assert.match(settings, /\$app\['caldav\.password'\] = 'CALDAVER_CALDAV_PASSWORD';/);
  assert.match(defaults, /\$app\['auth\.local\.username'\] = '';/);
  assert.match(defaults, /\$app\['caldav\.username'\] = '';/);
  assert.match(run, /CALDAVER_AUTH_USERNAME:=/);
  assert.match(run, /CALDAVER_CALDAV_PASSWORD:=/);
});

test('Caldaver Docker image and runtime use Postgres instead of SQLite', () => {
  const dockerfile = read('Dockerfile');
  const settings = read('docker/settings.php');
  const run = read('docker/run.sh');
  const init = read('docker/initialize-database.php');

  assert.match(dockerfile, /pdo_pgsql/);
  assert.match(dockerfile, /imap/);
  assert.doesNotMatch(dockerfile, /pdo_sqlite/);
  assert.doesNotMatch(dockerfile, /db\.sqlite/);
  assert.match(settings, /'driver' => 'CALDAVER_DB_DRIVER'/);
  assert.match(settings, /'host' => 'CALDAVER_DB_HOST'/);
  assert.match(run, /CALDAVER_DB_PASSWORD:\?CALDAVER_DB_PASSWORD is required/);
  assert.match(run, /initialize-database\.php/);
  assert.match(init, /pgsql:host=/);
  assert.match(init, /CREATE TABLE IF NOT EXISTS mail_accounts/);
  assert.match(init, /refresh_interval_seconds INTEGER NOT NULL DEFAULT 60/);
  assert.match(init, /CREATE TABLE IF NOT EXISTS mail_message_cache/);
});

test('mail section exposes IMAP account routes and a Gmail-like left tab', () => {
  const controllers = read('web/app/controllers.php');
  const services = read('web/app/services.php');
  const appNav = read('web/templates/parts/appnav.html');
  const mail = read('web/templates/mail.html');
  const mailMessage = read('web/templates/mail_message.html');
  const mailJs = read('web/templates/parts/mailjs.html');
  const mailMessageJs = read('web/templates/parts/mailmessagejs.html');
  const repository = read('web/src/Mail/MailAccountRepository.php');
  const imap = read('web/src/Mail/ImapClient.php');
  const validator = read('web/src/Mail/AccountValidator.php');
  const less = read('assets/less/caldaver.less');

  assert.match(controllers, /->get\('\/mail', '\\Caldaver\\Controller\\Mail::indexAction'\)->bind\('mail'\)/);
  assert.match(controllers, /->get\('\/mail\/accounts', '\\Caldaver\\Controller\\Mail::accountsAction'\)->bind\('mail\.accounts'\)/);
  assert.match(controllers, /->post\('\/mail\/accounts\/save', '\\Caldaver\\Controller\\Mail::saveAccountAction'\)->bind\('mail\.accounts\.save'\)/);
  assert.match(controllers, /->get\('\/mail\/read', '\\Caldaver\\Controller\\Mail::readAction'\)->bind\('mail\.read'\)/);
  assert.match(controllers, /->get\('\/mail\/messages', '\\Caldaver\\Controller\\Mail::messagesAction'\)->bind\('mail\.messages'\)/);
  assert.match(controllers, /->get\('\/mail\/messages\/sync', '\\Caldaver\\Controller\\Mail::syncMessagesAction'\)->bind\('mail\.messages\.sync'\)/);
  assert.match(controllers, /->get\('\/mail\/message', '\\Caldaver\\Controller\\Mail::messageAction'\)->bind\('mail\.message'\)/);
  assert.match(controllers, /->post\('\/mail\/message\/unread', '\\Caldaver\\Controller\\Mail::markUnreadAction'\)->bind\('mail\.message\.unread'\)/);
  assert.match(controllers, /->get\('\/mail\/attachment', '\\Caldaver\\Controller\\Mail::attachmentAction'\)->bind\('mail\.attachment'\)/);
  assert.match(services, /\$app\['mail\.accounts'\]/);
  assert.match(services, /\$app\['mail\.imap\.client'\]/);
  assert.match(appNav, /app\.url_generator\.generate\('mail'\)/);
  assert.match(mail, /id="mail_accounts"/);
  assert.match(mail, /class="mail-actions-menu"/);
  assert.match(mail, /id="mail_account_create"[\s\S]*labels\.addaccount/);
  assert.doesNotMatch(mail, /id="mail_account_create" class="btn btn-default compose-button"/);
  assert.match(mail, /id="mail_account_form"/);
  assert.match(mail, /name="refresh_interval_minutes"/);
  assert.match(mail, /id="mail_account_error"/);
  assert.match(mail, /id="mail_loading"/);
  assert.match(mail, /id="mail_no_messages"/);
  assert.match(mail, /id="mail_no_messages"[\s\S]*labels\.nomessages/);
  assert.doesNotMatch(mail, /id="mail_message_detail"/);
  assert.match(mailMessage, /id="mail_reader"/);
  assert.match(mailMessage, /data-message-url/);
  assert.match(mailMessage, /data-unread-url/);
  assert.match(mailMessage, /id="mail_reader_unread"/);
  assert.match(mailMessage, /id="mail_reader_html"/);
  assert.match(mailMessage, /sandbox="allow-popups allow-popups-to-escape-sandbox"/);
  assert.match(mailMessage, /mailmessagejs\.html/);
  assert.match(appNav, /id="mail_nav_item"/);
  assert.match(appNav, /mail-nav-spinner/);
  assert.match(mailJs, /mail\.accounts/);
  assert.match(mailJs, /mail\.messages/);
  assert.match(mailJs, /mail\.messages\.sync/);
  assert.match(mailJs, /mail\.read/);
  assert.match(mailJs, /mail\.attachment/);
  assert.match(mailJs, /setInterval/);
  assert.match(mailJs, /refresh_interval_seconds/);
  assert.match(mailJs, /setMailSyncing/);
  assert.match(mailJs, /function setMailStatus\(status, message\)/);
  assert.match(mailJs, /setMailStatus\(account \? 'loading' : 'ready', account \? 'Checking the IMAP server for mail\.\.\.' : ''\)/);
  assert.match(mailJs, /setMailStatus\('syncing', 'Syncing with the IMAP server\.\.\.'\)/);
  assert.match(mailJs, /scrollIntoView\(\{ block: 'start', behavior: 'smooth' \}\)/);
  assert.match(mailJs, /window\.matchMedia\('\(max-width: 900px\)'\)/);
  assert.match(mailJs, /window\.location\.href/);
  assert.doesNotMatch(mailJs, /function loadMessage\(/);
  assert.match(mailMessage, /app\.url_generator\.generate\('mail\.message'\)/);
  assert.match(mailMessage, /app\.url_generator\.generate\('mail\.message\.unread'\)/);
  assert.match(mailMessage, /app\.url_generator\.generate\('mail\.attachment'\)/);
  assert.match(mailMessageJs, /dataset\.messageUrl/);
  assert.match(mailMessageJs, /dataset\.unreadUrl/);
  assert.match(mailMessageJs, /mail_reader_unread/);
  assert.match(mailMessageJs, /srcdoc/);
  assert.match(mailMessageJs, /html_body/);
  assert.match(mailMessageJs, /function sanitizeHtml\(html\)/);
  assert.match(mailMessageJs, /blockedTags/);
  assert.match(mailMessageJs, /dataset\.attachmentUrl/);
  assert.match(mailJs, /jsonFetch/);
  assert.match(mailJs, /X-Requested-With/);
  assert.match(mailJs, /Your session expired/);
  assert.match(mailJs, /AbortController/);
  assert.match(mailJs, /server did not respond in time/);
  assert.match(mailJs, /data-testid="mail-attachments"/);
  assert.match(mailJs, /mail-attachment-download/);
  assert.match(mailJs, /messageRequestId/);
  assert.match(mailJs, /setMailStatus\('error', error\.message\)/);
  assert.match(repository, /mail_accounts/);
  assert.match(repository, /mail_message_cache/);
  assert.match(repository, /html_body/);
  assert.match(repository, /refresh_interval_seconds/);
  assert.match(repository, /cachedMessages/);
  assert.match(repository, /replaceMessageCache/);
  assert.match(repository, /markCachedSeen/);
  assert.match(repository, /openssl_encrypt/);
  assert.match(repository, /aes-256-gcm/);
  assert.match(repository, /matchingAccountId/);
  assert.match(repository, /lower\(email_address\) = lower\(\?\)/);
  assert.match(imap, /imap_open/);
  assert.match(imap, /imap_timeout/);
  assert.match(imap, /IMAP_OPENTIMEOUT/);
  assert.match(imap, /TIMEOUT_SECONDS = 10/);
  assert.match(imap, /candidateUsernames/);
  assert.match(imap, /email_address/);
  assert.match(imap, /downloadAttachment/);
  assert.match(imap, /attachmentsForMessage/);
  assert.match(imap, /fetchMessage/);
  assert.match(imap, /htmlMessageBody/);
  assert.match(imap, /sanitizeHtml/);
  assert.match(imap, /preg_replace_callback/);
  assert.doesNotMatch(imap, /preg_replace\('[^']*style[\s\S]*function\(\$match\)/);
  assert.match(imap, /markSeen/);
  assert.match(imap, /imap_setflag_full/);
  assert.match(imap, /imap_clearflag_full/);
  assert.match(imap, /AccountValidator::assertValid/);
  assert.doesNotMatch(imap, /novalidate-cert/);
  assert.match(validator, /dns_get_record/);
  assert.match(validator, /FILTER_FLAG_NO_PRIV_RANGE \| FILTER_FLAG_NO_RES_RANGE/);
  assert.match(less, /\.mail-account-tab/);
  assert.match(less, /\.mail-actions-menu/);
  assert.match(less, /\.mail-actions-menu-list/);
  assert.match(less, /\.mail-row/);
  assert.match(less, /\.mail-nav-spinner/);
  assert.match(less, /\.mail-attachment/);
  assert.match(less, /\.mail-reader/);
  assert.match(less, /\.mail-reader-message/);
  assert.match(less, /\.mail-reader-html/);
});

test('pages can be rendered without loading JavaScript via nojs query option and user preference', () => {
  const layout = read('web/templates/layout.html');
  const services = read('web/app/services.php');
  const settings = read('web/config/default.settings.php');
  const preferences = read('web/templates/preferences.html');
  const controller = read('web/src/Controller/Preferences.php');
  const mailController = read('web/src/Controller/Mail.php');
  const mail = read('web/templates/mail.html');
  const mailMessage = read('web/templates/mail_message.html');
  const preferencesData = read('web/src/Data/Preferences.php');

  assert.match(layout, /app\.request\.query\.get\('nojs'\)/);
  assert.match(layout, /nojs_query != '1'/);
  assert.match(layout, /nojs_query != 'true'/);
  assert.match(layout, /nojs_query != 'yes'/);
  assert.match(layout, /app\.offsetExists\('user\.preferences'\)/);
  assert.match(layout, /disable_javascript/);
  assert.match(layout, /\{% block bottom %\}/);
  assert.match(services, /'disable_javascript' => \$app\['defaults\.disable_javascript'\]/);
  assert.match(settings, /\$app\['defaults\.disable_javascript'\] = false/);
  assert.match(preferences, /name="disable_javascript"/);
  assert.match(controller, /'disable_javascript' => \$input->get\('disable_javascript'\) == 'true'/);
  assert.match(preferencesData, /@Column\(type="json"\)/);
  assert.doesNotMatch(preferencesData, /json_array/);
  assert.match(mailController, /javascriptEnabled\(Request \$request, Application \$app\)/);
  assert.match(mailController, /in_array\(\$nojs, \['1', 'true', 'yes'\], true\)/);
  assert.match(mailController, /mail_javascript_enabled/);
  assert.match(mail, /mail_javascript_enabled/);
  assert.match(mailMessage, /mail_javascript_enabled/);
});

test('CSRF failures return JSON for Ajax mail requests', () => {
  const csrf = read('web/src/Csrf.php');

  assert.match(csrf, /use Symfony\\Component\\HttpFoundation\\JsonResponse;/);
  assert.match(csrf, /isXmlHttpRequest\(\)/);
  assert.match(csrf, /CSRF token not present/);
  assert.match(csrf, /Invalid CSRF token/);
});

test('mail account schema is available to non-Docker migrations', () => {
  const migration = read('web/src/DB/Migrations/Version20260529000000.php');

  assert.match(migration, /createTable\('mail_accounts'\)/);
  assert.match(migration, /addColumn\('password_encrypted', 'text'\)/);
  assert.match(migration, /addIndex\(\['owner'\]\)/);
});
