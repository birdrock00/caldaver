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

test('topbar user actions stay in a horizontal row under Bootstrap 5', () => {
  const navbar = read('web/templates/parts/navbar.html');
  const less = read('assets/less/agendav.less');

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

  assert.match(controllers, /->get\('\/cards', '\\AgenDAV\\Controller\\Cards::indexAction'\)->bind\('cards'\)/);
  assert.match(controllers, /->get\('\/cards\/list', '\\AgenDAV\\Controller\\Cards::listAction'\)->bind\('cards\.list'\)/);
  assert.match(controllers, /->post\('\/cards\/save', '\\AgenDAV\\Controller\\Cards::saveAction'\)->bind\('cards\.save'\)/);
  assert.match(controllers, /->post\('\/cards\/delete', '\\AgenDAV\\Controller\\Cards::deleteAction'\)->bind\('cards\.delete'\)/);
  assert.match(services, /\$app\['carddav\.client'\]/);
  assert.match(appNav, /app\.url_generator\.generate\('cards'\)/);
  assert.match(sidebar, /include 'parts\/appnav\.html'/);
});

test('cards page renders list and card views without loading the calendar bundle', () => {
  const cards = read('web/templates/cards.html');
  const cardsJs = read('web/templates/parts/cardsjs.html');
  const less = read('assets/less/agendav.less');

  assert.match(cards, /id="contacts_list"/);
  assert.match(cards, /id="contacts_cards"/);
  assert.match(cards, /data-view="cards"/);
  assert.match(cards, /id="contact_form"/);
  assert.match(cardsJs, /fetch\('\{\{ app\.url_generator\.generate\('cards\.list'\) \}\}'/);
  assert.match(cardsJs, /fetch\(event\.target\.action/);
  assert.match(cardsJs, /app\.url_generator\.generate\('cards\.delete'\)/);
  assert.match(cardsJs, /class="contact-delete/);
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
  assert.match(settings, /\$app\['carddav\.baseurl'\] = 'AGENDAV_CARDDAV_SERVER';/);
  assert.match(run, /AGENDAV_CARDDAV_SERVER:=\$AGENDAV_CALDAV_SERVER/);
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

test('CalDAVer Docker image and runtime use Postgres instead of SQLite', () => {
  const dockerfile = read('Dockerfile');
  const settings = read('docker/settings.php');
  const run = read('docker/run.sh');
  const init = read('docker/initialize-database.php');

  assert.match(dockerfile, /pdo_pgsql/);
  assert.match(dockerfile, /imap/);
  assert.doesNotMatch(dockerfile, /pdo_sqlite/);
  assert.doesNotMatch(dockerfile, /db\.sqlite/);
  assert.match(settings, /'driver' => 'AGENDAV_DB_DRIVER'/);
  assert.match(settings, /'host' => 'AGENDAV_DB_HOST'/);
  assert.match(run, /AGENDAV_DB_PASSWORD:\?AGENDAV_DB_PASSWORD is required/);
  assert.match(run, /initialize-database\.php/);
  assert.match(init, /pgsql:host=/);
  assert.match(init, /CREATE TABLE IF NOT EXISTS mail_accounts/);
});

test('mail section exposes IMAP account routes and a Gmail-like left tab', () => {
  const controllers = read('web/app/controllers.php');
  const services = read('web/app/services.php');
  const appNav = read('web/templates/parts/appnav.html');
  const mail = read('web/templates/mail.html');
  const mailJs = read('web/templates/parts/mailjs.html');
  const repository = read('web/src/Mail/MailAccountRepository.php');
  const imap = read('web/src/Mail/ImapClient.php');
  const validator = read('web/src/Mail/AccountValidator.php');
  const less = read('assets/less/agendav.less');

  assert.match(controllers, /->get\('\/mail', '\\AgenDAV\\Controller\\Mail::indexAction'\)->bind\('mail'\)/);
  assert.match(controllers, /->get\('\/mail\/accounts', '\\AgenDAV\\Controller\\Mail::accountsAction'\)->bind\('mail\.accounts'\)/);
  assert.match(controllers, /->post\('\/mail\/accounts\/save', '\\AgenDAV\\Controller\\Mail::saveAccountAction'\)->bind\('mail\.accounts\.save'\)/);
  assert.match(controllers, /->get\('\/mail\/messages', '\\AgenDAV\\Controller\\Mail::messagesAction'\)->bind\('mail\.messages'\)/);
  assert.match(controllers, /->get\('\/mail\/message', '\\AgenDAV\\Controller\\Mail::messageAction'\)->bind\('mail\.message'\)/);
  assert.match(controllers, /->get\('\/mail\/attachment', '\\AgenDAV\\Controller\\Mail::attachmentAction'\)->bind\('mail\.attachment'\)/);
  assert.match(services, /\$app\['mail\.accounts'\]/);
  assert.match(services, /\$app\['mail\.imap\.client'\]/);
  assert.match(appNav, /app\.url_generator\.generate\('mail'\)/);
  assert.match(mail, /id="mail_accounts"/);
  assert.match(mail, /id="mail_account_form"/);
  assert.match(mail, /id="mail_account_error"/);
  assert.match(mail, /id="mail_no_messages"/);
  assert.match(mailJs, /mail\.accounts/);
  assert.match(mailJs, /mail\.messages/);
  assert.match(mailJs, /mail\.message/);
  assert.match(mailJs, /mail\.attachment/);
  assert.match(mailJs, /data-testid="mail-attachments"/);
  assert.match(mailJs, /mail-attachment-download/);
  assert.match(mailJs, /messageRequestId/);
  assert.match(mailJs, /loadMessage/);
  assert.match(mailJs, /mail_error'\)\.hidden = false/);
  assert.match(repository, /mail_accounts/);
  assert.match(repository, /openssl_encrypt/);
  assert.match(repository, /aes-256-gcm/);
  assert.match(imap, /imap_open/);
  assert.match(imap, /downloadAttachment/);
  assert.match(imap, /attachmentsForMessage/);
  assert.match(imap, /fetchMessage/);
  assert.match(imap, /AccountValidator::assertValid/);
  assert.doesNotMatch(imap, /novalidate-cert/);
  assert.match(validator, /dns_get_record/);
  assert.match(validator, /FILTER_FLAG_NO_PRIV_RANGE \| FILTER_FLAG_NO_RES_RANGE/);
  assert.match(less, /\.mail-account-tab/);
  assert.match(less, /\.mail-row/);
  assert.match(less, /\.mail-attachment/);
  assert.match(less, /\.mail-message-detail/);
});

test('mail account schema is available to non-Docker migrations', () => {
  const migration = read('web/src/DB/Migrations/Version20260529000000.php');

  assert.match(migration, /createTable\('mail_accounts'\)/);
  assert.match(migration, /addColumn\('password_encrypted', 'text'\)/);
  assert.match(migration, /addIndex\(\['owner'\]\)/);
});
