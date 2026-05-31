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

test('Rust workspace owns backend crates and scripts', () => {
  const toolchain = read('rust-toolchain.toml');
  const workspace = read('rust/Cargo.toml');
  const packageJson = JSON.parse(read('package.json'));
  const coreManifest = read('rust/crates/caldaver-core/Cargo.toml');
  const serverManifest = read('rust/crates/caldaver-server/Cargo.toml');
  const coreLib = read('rust/crates/caldaver-core/src/lib.rs');

  assert.match(toolchain, /channel = "stable"/);
  assert.match(workspace, /resolver = "3"/);
  assert.match(workspace, /edition = "2024"/);
  assert.match(workspace, /"crates\/caldaver-core"/);
  assert.match(workspace, /"crates\/caldaver-server"/);
  assert.match(coreManifest, /name = "caldaver-core"/);
  assert.match(serverManifest, /name = "caldaver-server"/);
  assert.match(serverManifest, /axum =/);
  assert.equal(packageJson.scripts['test:rust'], 'cargo test --manifest-path rust/Cargo.toml');
  assert.equal(packageJson.scripts['start:rust'], 'cargo run --manifest-path rust/Cargo.toml --bin caldaver-server');

  for (const moduleName of ['carddav', 'caldav', 'mail_account', 'xml', 'preferences', 'reminder', 'share', 'shares_diff']) {
    assert.match(coreLib, new RegExp(`pub mod ${moduleName};`));
  }
});

test('Rust server exposes the former PHP route surface', () => {
  const server = read('rust/crates/caldaver-server/src/lib.rs');

  for (const route of [
    'route("/", get(calendar_page))',
    'route("/login", get(login_page).post(login_post))',
    'route("/logout", get(logout))',
    'route("/cards", get(cards_page))',
    'route("/cards/list", get(cards_list))',
    'route("/cards/save", post(cards_save))',
    'route("/cards/delete", post(cards_delete))',
    'route("/mail", get(mail_page))',
    'route("/mail/read", get(mail_read_page))',
    'route("/mail/accounts", get(mail_accounts))',
    'route("/mail/accounts/save", post(mail_account_save))',
    'route("/mail/messages", get(mail_messages))',
    'route("/mail/messages/sync", get(mail_messages_sync))',
    'route("/mail/message", get(mail_message))',
    'route("/mail/message/unread", post(mail_mark_unread))',
    'route("/mail/attachment", get(mail_attachment))',
    'route("/preferences", get(preferences_page).post(preferences_save))',
    'route("/calendars", get(calendars_list).post(calendar_save))',
    'route("/calendars/save", post(calendar_save))',
    'route("/calendars/delete", post(calendar_delete))',
    'route("/events", get(events_list))',
    'route("/eventbase", get(event_base))',
    'route("/events/save", post(event_save))',
    'route("/events/delete", post(event_delete))',
    'route("/events/drop", post(event_drop))',
    'route("/events/resize", post(event_resize))',
    'route("/principals", get(principals))',
    'route("/jssettings", get(jssettings))',
    'route("/keepalive", get(|| async { "" }))',
    'route("/__rust/health", get(|| async { Json(json!({"ok": true, "backend": "rust"})) }))'
  ]) {
    assert.match(server, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('Docker image runs the Rust backend without PHP or Apache', () => {
  const dockerfile = read('Dockerfile');

  assert.match(dockerfile, /FROM docker\.io\/library\/rust:1-bookworm AS rust-builder/);
  assert.match(dockerfile, /cargo build --release --manifest-path rust\/Cargo\.toml --bin caldaver-server/);
  assert.match(dockerfile, /COPY --from=rust-builder .*caldaver-server \/usr\/local\/bin\/caldaver-server/);
  assert.match(dockerfile, /ENTRYPOINT \["\/usr\/local\/bin\/caldaver-server"\]/);
  assert.match(dockerfile, /CALDAVER_STATIC_ROOT=\/var\/www\/caldaver\/web\/public/);
  assert.match(dockerfile, /USER nobody/);
  assert.doesNotMatch(dockerfile, /docker\.io\/library\/php/);
  assert.doesNotMatch(dockerfile, /apache2/);
  assert.doesNotMatch(dockerfile, /composer/);
  assert.doesNotMatch(dockerfile, /pdo_pgsql|imap/);

  const config = read('rust/crates/caldaver-server/src/config.rs');
  const storage = read('rust/crates/caldaver-server/src/storage.rs');
  assert.match(config, /CALDAVER_DATABASE_URL/);
  assert.match(config, /CALDAVER_DB_HOST/);
  assert.match(storage, /Caldaver Rust backend requires a Postgres database URL/);
  assert.match(storage, /CREATE TABLE IF NOT EXISTS caldaver_sessions/);
  assert.match(storage, /CREATE TABLE IF NOT EXISTS mail_accounts/);
});

test('frontend templates preserve mobile navigation and mail behavior', () => {
  const navbar = read('web/templates/parts/navbar.html');
  const appNav = read('web/templates/parts/appnav.html');
  const mail = read('web/templates/mail.html');
  const mailMessage = read('web/templates/mail_message.html');
  const preferences = read('web/templates/preferences.html');
  const mailJs = read('web/templates/parts/mailjs.html');
  const mailMessageJs = read('web/templates/parts/mailmessagejs.html');
  const less = read('assets/less/caldaver.less');

  assert.match(navbar, /class="mobile-section-menu"/);
  assert.ok(navbar.indexOf('class="mobile-section-menu"') < navbar.indexOf('class="navbar-header"'));
  assert.match(navbar, /class="mobile-calendar-menu"/);
  assert.match(navbar, /class="mobile-calendar-menu-calendars"/);
  assert.doesNotMatch(navbar, /caldaver-brand-icon/);
  assert.doesNotMatch(navbar, /<a class="logout"/);
  assert.match(navbar, /<details class="user-menu-dropdown">[\s\S]*user-menu-logout/);
  assert.match(appNav, /id="mail_nav_item"/);
  assert.match(appNav, /mail-nav-spinner/);
  assert.match(mail, /id="mail_accounts"/);
  assert.doesNotMatch(mail, /id="mail_account_create"/);
  assert.match(preferences, /class="prefs-section prefs-mail-section"[\s\S]*id="mail_account_create"/);
  assert.match(mailMessage, /id="mail_reader"/);
  assert.match(mailMessage, /data-unread-url/);
  assert.match(mailMessage, /id="mail_reader_unread"/);
  assert.doesNotMatch(mailMessage, /compose-button[\s\S]*labels\.inbox/);
  assert.match(mailMessageJs, /function setupSwipeNavigation\(\)/);
  assert.match(mailMessageJs, /navigateBySwipe\(deltaX > 0 \? 'newer' : 'older'\)/);
  assert.match(mailMessageJs, /targetIndex = direction === 'newer' \? currentIndex - 1 : currentIndex \+ 1/);
  assert.match(mailMessageJs, /function sanitizeHtml\(html\)/);
  assert.match(mailJs, /function messagesSignature\(data\)/);
  assert.match(mailJs, /function replaceMessages\(nextMessages\)/);
  assert.match(mailJs, /syncMessages\(\+\+messageRequestId, \{ quiet: true \}\);/);
  assert.match(mailJs, /if \(changed\) \{\s*renderMessages\(\);/);
  assert.match(less, /@media \(max-width:\s*900px\)[\s\S]*\.mobile-section-menu\s*\{[\s\S]*display:\s*block;/);
  assert.match(less, /@media \(max-width:\s*900px\)[\s\S]*#sidebar \.calendar-sidebar-section,[\s\S]*#sidebar #footer[\s\S]*display:\s*none;/);
  assert.match(less, /@media \(max-width:\s*900px\)[\s\S]*#sidebar \.app-nav,[\s\S]*\.cards-sidebar \.app-nav,[\s\S]*\.mail-sidebar \.app-nav[\s\S]*display:\s*none;/);
  assert.match(less, /\.highlighted-unread/);
});

test('layout CSS keeps mobile pages scrollable and controls visible', () => {
  const less = read('assets/less/caldaver.less');

  assert.match(cssBlock(less, 'body.caldaver-calendar-page'), /overflow:\s*hidden;/);
  assert.doesNotMatch(cssBlock(less, 'body'), /overflow:\s*hidden;/);
  assert.match(less, /@media \(max-width:\s*900px\)[\s\S]*body\.caldaver-calendar-page\s*\{[\s\S]*overflow:\s*auto;/);
  assert.match(less, /@media \(max-width:\s*900px\)[\s\S]*#calendar_view\s*\{[\s\S]*min-height:\s*720px;/);
  assert.match(less, /\.calendar-shell\s*\{[\s\S]*height:\s*~"calc\(100dvh - 64px\)";[\s\S]*env\(safe-area-inset-bottom\)/);
  assert.match(less, /\.cards-shell\s*\{[\s\S]*height:\s*~"calc\(100dvh - 64px\)";/);
  assert.match(less, /\.mail-shell\s*\{[\s\S]*height:\s*~"calc\(100dvh - 64px\)";/);
  assert.match(less, /\.mail-reader-message\s*\{[\s\S]*max-width:\s*none;/);
  assert.match(less, /\.mail-reader-html\s*\{[\s\S]*width:\s*100%;/);
});

test('Rust core contains translated backend domain coverage', () => {
  const mailAccount = read('rust/crates/caldaver-core/src/mail_account.rs');
  const carddav = read('rust/crates/caldaver-core/src/carddav.rs');
  const generator = read('rust/crates/caldaver-core/src/xml/generator.rs');
  const parser = read('rust/crates/caldaver-core/src/xml/parser.rs');
  const caldavResource = read('rust/crates/caldaver-core/src/caldav/resource/mod.rs');
  const caldavShare = read('rust/crates/caldaver-core/src/caldav/share/mod.rs');
  const caldavFilter = read('rust/crates/caldaver-core/src/caldav/filter/mod.rs');
  const preferences = read('rust/crates/caldaver-core/src/preferences.rs');
  const reminder = read('rust/crates/caldaver-core/src/reminder.rs');
  const sharesDiff = read('rust/crates/caldaver-core/src/shares_diff.rs');

  assert.match(mailAccount, /pub struct MailAccount/);
  assert.match(mailAccount, /pub enum ValidationError/);
  assert.match(mailAccount, /pub trait HostResolver/);
  assert.match(mailAccount, /fn public_ip\(address: IpAddr\)/);
  assert.match(mailAccount, /rejects_hostnames_that_resolve_to_private_addresses/);
  assert.match(carddav, /pub struct AddressBook/);
  assert.match(carddav, /pub struct Contact/);
  assert.match(carddav, /builds_vcard_from_contact_input/);
  assert.match(generator, /mkaddressbook_body/);
  assert.match(generator, /calendar_query_body/);
  assert.match(parser, /extract_properties_from_multistatus/);
  assert.match(caldavResource, /pub struct Calendar/);
  assert.match(caldavResource, /pub struct CalendarObject/);
  assert.match(caldavShare, /pub struct Permissions/);
  assert.match(caldavShare, /pub struct Acl/);
  assert.match(caldavFilter, /pub struct TimeRange/);
  assert.match(caldavFilter, /pub struct Uid/);
  assert.match(preferences, /pub struct Preferences/);
  assert.match(reminder, /pub struct Reminder/);
  assert.match(sharesDiff, /pub struct SharesDiff/);
});

test('Rust server handles sessions, CSRF, no-JS mail, and unread updates', () => {
  const server = read('rust/crates/caldaver-server/src/lib.rs');
  const storage = read('rust/crates/caldaver-server/src/storage.rs');
  const mailMessageJs = read('web/templates/parts/mailmessagejs.html');

  assert.match(server, /caldaver_sess=\{id\}; Path=\/; HttpOnly; SameSite=Lax/);
  assert.match(server, /caldaver_sess=; Path=\/; Max-Age=0; HttpOnly; SameSite=Lax/);
  assert.match(server, /cookie_value\(&headers, "caldaver_sess"\)/);
  assert.match(server, /storage:\s*Storage/);
  assert.match(server, /mail_backend:\s*Arc<dyn MailBackend>/);
  assert.match(storage, /CREATE TABLE IF NOT EXISTS caldaver_sessions/);
  assert.match(storage, /INSERT INTO caldaver_sessions/);
  assert.match(storage, /DELETE FROM caldaver_sessions WHERE id = \$1/);
  assert.match(storage, /mail_message_cache/);
  assert.match(server, /fn valid_csrf\(session: &Session, form: &HashMap<String, String>\) -> bool/);
  assert.match(server, /json_error\(StatusCode::UNAUTHORIZED, "CSRF token not present"\)/);
  assert.match(server, /render_mail\(&state, &session, mail_javascript_disabled\(&session, &query\)\)/);
  assert.match(server, /fn mail_javascript_disabled\(session: &Session, query: &HashMap<String, String>\) -> bool/);
  assert.match(server, /let bottom = if no_js \{ String::new\(\) \} else \{ part_js\("mailjs"\) \};/);
  assert.match(server, /backend\.mark_seen\(account, uid, false\)/);
  assert.match(server, /mark_cached_seen\(&session\.username, account_id, uid, false\)/);
  assert.match(storage, /jsonb_set\(message, '\{seen\}', to_jsonb\(\$4::boolean\), true\)/);
  assert.match(mailMessageJs, /unread_uid/);
});
