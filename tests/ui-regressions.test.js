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

test('daily release workflow creates dated releases and refreshes latest release date', () => {
  const workflow = read('.github/workflows/daily-release.yml');

  assert.match(workflow, /schedule:[\s\S]*cron: "17 10 \* \* \*"/);
  assert.match(workflow, /release_tag="\$\(date -u \+'\%Y-\%m-\%d-\%H\%M\%S'\)"/);
  assert.match(workflow, /gh release create "\$\{\{ needs\.prepare\.outputs\.release_tag \}\}"/);
  assert.match(workflow, /gh release delete latest --yes/);
  assert.match(workflow, /gh release create latest[\s\S]*--latest/);
  assert.doesNotMatch(workflow, /gh release edit latest/);
});

test('Rust login supports hashed Caldaver auth secrets', () => {
  const config = read('rust/crates/caldaver-server/src/config.rs');
  const server = read('rust/crates/caldaver-server/src/lib.rs');

  assert.match(config, /auth_password_hash: String/);
  assert.match(config, /CALDAVER_AUTH_PASSWORD_HASH/);
  assert.match(server, /verify_local_auth_password\(&state\.config, password\)/);
  assert.match(server, /fn verify_password_hash\(encoded: &str, password: &str\) -> bool/);
  assert.match(server, /pbkdf2-sha256/);
  assert.match(server, /constant_time_eq\(config\.auth_password\.as_bytes\(\), password\.as_bytes\(\)\)/);
});

test('Rust server exposes the web route surface', () => {
  const server = read('rust/crates/caldaver-server/src/lib.rs');

  for (const route of [
    'route("/", get(calendar_page))',
    'route("/login", get(login_page).post(login_post))',
    'route("/logout", get(logout))',
    'route("/cards", get(cards_page))',
    'route("/cards/list", get(cards_list))',
    'route("/cards/save", post(cards_save))',
    'route("/cards/update", post(cards_update))',
    'route("/cards/delete", post(cards_delete))',
    'route("/mail", get(mail_page))',
    'route("/mail/read", get(mail_read_page))',
    'route("/accounts", get(accounts))',
    'route("/accounts/save", post(account_save))',
    'route("/mail/accounts", get(mail_accounts))',
    'route("/mail/accounts/save", post(mail_account_save))',
    'route("/mail/messages", get(mail_messages))',
    'route("/mail/messages/sync", get(mail_messages_sync))',
    'route("/mail/message", get(mail_message))',
    'route("/mail/message/navigation", get(mail_message_navigation))',
    'route("/mail/message/unread", post(mail_mark_unread))',
    'route("/mail/message/delete", post(mail_message_delete))',
    'route("/mail/message/archive", post(mail_message_archive))',
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

test('Docker image runs the standalone Rust backend', () => {
  const dockerfile = read('Dockerfile');

  assert.match(dockerfile, /FROM docker\.io\/library\/rust:1-bookworm AS rust-builder/);
  assert.match(dockerfile, /cargo build --release --manifest-path rust\/Cargo\.toml --bin caldaver-server/);
  assert.match(dockerfile, /COPY --from=rust-builder .*caldaver-server \/usr\/local\/bin\/caldaver-server/);
  assert.match(dockerfile, /ENTRYPOINT \["\/usr\/local\/bin\/caldaver-server"\]/);
  assert.match(dockerfile, /CALDAVER_STATIC_ROOT=\/var\/www\/caldaver\/web\/public/);
  assert.match(dockerfile, /USER nobody/);
  assert.doesNotMatch(dockerfile, /apache2/);

  const config = read('rust/crates/caldaver-server/src/config.rs');
  const storage = read('rust/crates/caldaver-server/src/storage.rs');
  assert.match(config, /CALDAVER_DATABASE_URL/);
  assert.match(config, /CALDAVER_DB_HOST/);
  assert.match(storage, /Caldaver Rust backend requires a Postgres database URL/);
  assert.match(storage, /CREATE TABLE IF NOT EXISTS caldaver_sessions/);
  assert.match(storage, /CREATE TABLE IF NOT EXISTS mail_accounts/);
  assert.match(storage, /CREATE TABLE IF NOT EXISTS dav_accounts/);
  assert.match(storage, /credential_secret TEXT NOT NULL DEFAULT ''/);
  assert.match(storage, /ALTER TABLE mail_accounts ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE/);
  assert.match(storage, /CREATE UNIQUE INDEX IF NOT EXISTS uniq_dav_accounts_owner_type_server_user/);
  assert.match(storage, /ALTER TABLE mail_accounts ALTER COLUMN id TYPE BIGINT/);
  assert.match(storage, /ALTER TABLE mail_message_cache ALTER COLUMN message TYPE JSONB USING message::jsonb/);
  assert.match(storage, /uniq_mail_message_cache_owner_account_uid/);
  assert.match(storage, /DROP NOT NULL/);
  assert.match(storage, /DELETE FROM mail_message_cache WHERE message IS NULL/);
  assert.match(storage, /SELECT id::BIGINT AS id/);
  assert.match(storage, /SELECT message::JSONB AS message[\s\S]*message IS NOT NULL/);
});

test('frontend templates preserve mobile navigation and mail behavior', () => {
  const navbar = read('web/templates/parts/navbar.html');
  const appNav = read('web/templates/parts/appnav.html');
  const mail = read('web/templates/mail.html');
  const mailMessage = read('web/templates/mail_message.html');
  const preferences = read('web/templates/preferences.html');
  const eventBasicForm = read('assets/templates/event_basic_form_part.dust');
  const appJs = read('assets/js/app/app.js');
  const mailJs = read('web/templates/parts/mailjs.html');
  const mailMessageJs = read('web/templates/parts/mailmessagejs.html');
  const less = read('assets/less/caldaver.less');
  const server = read('rust/crates/caldaver-server/src/lib.rs');

  assert.match(navbar, /class="mobile-section-menu"/);
  assert.ok(navbar.indexOf('class="mobile-section-menu"') < navbar.indexOf('class="navbar-header"'));
  assert.match(navbar, /class="mobile-calendar-menu"/);
  assert.match(navbar, /data-calendar-href="\{\{ app\.url_generator\.generate\('calendar'\) \}\}"/);
  assert.match(navbar, /class="mobile-calendar-menu-calendars"/);
  assert.match(navbar, /data-calendars-url="\{\{ app\.url_generator\.generate\('calendar'\) \}\}calendars"/);
  assert.match(navbar, /function loadMobileCalendarMenu\(\)/);
  assert.match(navbar, /fetch\(calendarsUrl/);
  assert.doesNotMatch(navbar, /class="mobile-calendar-open"/);
  assert.match(server, /class="mobile-calendar-menu"/);
  assert.match(server, /data-calendar-href="\/"/);
  assert.match(server, /class="mobile-calendar-menu-calendars"/);
  assert.match(server, /data-calendars-url="\/calendars"/);
  assert.match(server, /fn mobile_calendar_menu_script\(\)/);
  assert.match(server, /function loadMobileCalendarMenu\(\)/);
  assert.match(server, /fetch\(calendarsUrl/);
  assert.doesNotMatch(server, /class="mobile-calendar-open"/);
  assert.match(eventBasicForm, /select name="timezone" id="event_timezone"/);
  assert.match(eventBasicForm, /\{#available_timezones current_timezone=timezone\}/);
  assert.match(appJs, /var default_calendar_timezone = 'America\/Los_Angeles';/);
  assert.match(appJs, /event_fields\.timezone = event_fields\.timezone \|\| calendar_timezone\(\);/);
  assert.match(appJs, /form_timezone\(element\)/);
  assert.match(server, /DEFAULT_TIMEZONE: &str = "America\/Los_Angeles"/);
  assert.match(server, /DTSTART;TZID=\{property_timezone\}/);
  assert.doesNotMatch(navbar, /caldaver-brand-icon/);
  assert.doesNotMatch(navbar, /<a class="logout"/);
  assert.match(navbar, /<details class="user-menu-dropdown">[\s\S]*user-menu-logout/);
  assert.match(appNav, /id="mail_nav_item"/);
  assert.match(appNav, /mail-nav-spinner/);
  assert.match(mail, /id="mail_accounts"/);
  assert.match(mail, /id="mail_compose"/);
  assert.match(mail, /id="mail_compose_screen"/);
  assert.match(server, /id="mail_compose"/);
  assert.match(server, /id="mail_compose_screen"/);
  assert.doesNotMatch(mail, /id="mail_account_create"/);
  assert.match(preferences, /class="prefs-section prefs-accounts-section"[\s\S]*id="mail_account_create"/);
  assert.match(preferences, /id="connected_accounts"/);
  assert.match(preferences, /id="mail_account_form" action="\/accounts\/save"/);
  assert.match(mailMessage, /id="mail_reader"/);
  assert.match(mailMessage, /data-navigation-url/);
  assert.match(mailMessage, /data-unread-url/);
  assert.match(mailMessage, /id="mail_reader_unread"/);
  assert.match(mailMessage, /id="mail_reader_previous"/);
  assert.match(mailMessage, /id="mail_reader_next"/);
  assert.match(mailMessage, /class="mail-reader-toolbar-nav"/);
  assert.match(mailMessage, /sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"/);
  assert.match(server, /sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"/);
  assert.match(server, /id="mail_reader_previous"/);
  assert.match(server, /id="mail_reader_next"/);
  assert.match(server, /data-navigation-url="\/mail\/message\/navigation"/);
  assert.doesNotMatch(mailMessage, /compose-button[\s\S]*labels\.inbox/);
  assert.match(mailMessageJs, /function setupSwipeNavigation\(\)/);
  assert.match(mailMessageJs, /function setupHtmlFrameSwipeNavigation\(htmlFrame\)/);
  assert.match(mailMessageJs, /bindSwipeNavigationTarget\(htmlFrame\.contentWindow\.document, htmlFrame\)/);
  assert.match(mailMessageJs, /setupHtmlFrameSwipeNavigation\(htmlFrame\)/);
  assert.match(mailMessageJs, /function messageNavigationState\(messages, uid\)/);
  assert.match(mailMessageJs, /function loadMessageNavigation\(reader\)/);
  assert.match(mailMessageJs, /function updateMessageNavButtons\(\)/);
  assert.match(mailMessageJs, /function resizeHtmlFrame\(htmlFrame\)/);
  assert.match(mailMessageJs, /function hideBrokenHtmlImage\(image\)/);
  assert.match(mailMessageJs, /function proxyMailImages\(html, accountId, uid, csrfToken\)/);
  assert.match(mailMessageJs, /\/mail\/image\?account_id=/);
  assert.match(mailMessageJs, /caldaver-mail-image-failed/);
  assert.match(mailMessageJs, /document\.images/);
  assert.match(mailMessageJs, /function handleSwipeProgress\(clientX, clientY, event\)/);
  assert.match(mailMessageJs, /target\.addEventListener\('touchmove'[\s\S]*passive:\s*false/);
  assert.match(mailMessageJs, /target\.addEventListener\('touchend'[\s\S]*passive:\s*false/);
  assert.match(mailMessageJs, /preventNativeHorizontalScroll\(event\)/);
  assert.match(mailMessageJs, /bindSwipeNavigationTarget\(reader, reader\)/);
  assert.match(mailMessageJs, /previous: currentIndex > 0 \? messages\[currentIndex - 1\] : null/);
  assert.match(mailMessageJs, /next: currentIndex !== -1 && currentIndex < messages\.length - 1 \? messages\[currentIndex \+ 1\] : null/);
  assert.match(mailMessageJs, /#mail_reader_previous/);
  assert.match(mailMessageJs, /#mail_reader_next/);
  assert.match(mailMessageJs, /function sanitizeHtml\(html\)/);
  assert.match(mailJs, /function messagesSignature\(data\)/);
  assert.match(mailJs, /function replaceMessages\(nextMessages\)/);
  assert.match(mailJs, /syncMessages\(\+\+messageRequestId, \{ quiet: true \}\);/);
  assert.match(mailJs, /if \(changed\) \{\s*renderMessages\(\);/);
  assert.match(mailJs, /function openComposeScreen\(\)/);
  assert.match(mailJs, /Sending is not configured for this account yet/);
  assert.match(appJs, /insert_mobile_previous_events_row/);
  assert.match(appJs, /show_mobile_previous_events/);
  assert.match(appJs, /set_mobile_calendar_menu_status\('Unable to load calendars'\)/);
  assert.match(appJs, /set_mobile_calendar_menu_status\('No calendars found'\)/);
  assert.match(appJs, /function mobile_previous_events_step_days\(\)/);
  assert.match(appJs, /visibleRange:\s*calendar_list_visible_range/);
  assert.match(appJs, /mobile_calendar_previous_event_days \+= mobile_previous_events_step_days\(\)/);
  assert.match(appJs, /fullCalendar\('gotoDate', current_date\)/);
  assert.doesNotMatch(appJs, /fullCalendar\('prev'\)/);
  assert.match(appJs, /text:\s*'Previous events'/);
  assert.match(less, /@media \(max-width:\s*900px\)[\s\S]*\.mobile-section-menu\s*\{[\s\S]*display:\s*block;/);
  assert.match(less, /@media \(max-width:\s*900px\)[\s\S]*\.mail-mobile-compose-button[\s\S]*background:\s*#d93025;/);
  assert.match(less, /@media \(max-width:\s*900px\)[\s\S]*\.mail-compose-screen/);
  assert.match(less, /@media \(max-width:\s*900px\)[\s\S]*\.mobile-calendar-previous-events/);
  assert.match(less, /@media \(max-width:\s*900px\)[\s\S]*#sidebar \.calendar-sidebar-section,[\s\S]*#sidebar #footer[\s\S]*display:\s*none;/);
  assert.match(less, /@media \(max-width:\s*900px\)[\s\S]*#sidebar \.app-nav,[\s\S]*\.cards-sidebar \.app-nav,[\s\S]*\.mail-sidebar \.app-nav[\s\S]*display:\s*none;/);
  assert.match(less, /\.highlighted-unread/);
});

test('mobile calendar account menu settles after calendar load success empty or error states', () => {
  const appJs = read('assets/js/app/app.js');
  const updateBlock = sourceBetween(
    appJs,
    /var update_calendar_list = function update_calendar_list/,
    /var sync_mobile_calendar_menu = function sync_mobile_calendar_menu/
  );
  const syncBlock = sourceBetween(
    appJs,
    /var sync_mobile_calendar_menu = function sync_mobile_calendar_menu/,
    /\/\*\*\s*\n\s*\* Function used to query the server for events/
  );
  const failBlock = sourceBetween(
    updateBlock,
    /updcalendar_ajax_req\.fail/,
    /updcalendar_ajax_req\.done/
  );
  const emptyBlock = sourceBetween(
    updateBlock,
    /Calendar list received empty twice/,
    /return;\s*\n\s*}/
  );

  assert.match(updateBlock, /updcalendar_ajax_req\.done[\s\S]*sync_mobile_calendar_menu\(\)/);
  assert.match(failBlock, /set_mobile_calendar_menu_status\('Unable to load calendars'\)/);
  assert.match(emptyBlock, /set_mobile_calendar_menu_status\('No calendars found'\)/);
  assert.match(syncBlock, /#own_calendar_list li\.available_calendar, #shared_calendar_list li\.available_calendar/);
  assert.match(syncBlock, /set_mobile_calendar_menu_status/);
  assert.match(syncBlock, /set_mobile_calendar_menu_status\('Loading calendars\.\.\.'\)/);
});

test('preferences account section exposes calendar contacts and email account management', () => {
  const preferences = read('web/templates/preferences.html');
  const server = read('rust/crates/caldaver-server/src/lib.rs');

  assert.match(preferences, /<legend>\{% trans %\}labels\.accounts\{% endtrans %\}<\/legend>/);
  assert.match(preferences, /id="prefs_accounts_intro">\{%\s*trans\s*%\}labels\.accounts_intro/);
  assert.match(preferences, /id="connected_accounts" class="prefs-account-list" aria-live="polite"/);
  assert.match(preferences, /id="connected_accounts_empty"[\s\S]*\{% trans %\}labels\.no_accounts_configured/);
  assert.match(server, /fn preferences_accounts_section\(accounts: &\[ConnectedAccountPublic\]\)/);
  assert.match(server, /accounts\.iter\(\)[\s\S]*\.map\(account_row_html\)/);
});

test('unified account dialog supports the three account types', () => {
  const preferences = read('web/templates/preferences.html');
  const server = read('rust/crates/caldaver-server/src/lib.rs');

  for (const type of ['calendar', 'carddav', 'email']) {
    assert.match(preferences, new RegExp(`name="account_type" value="${type}"`));
    assert.match(server, new RegExp(`name="account_type" value="${type}"`));
  }
  assert.match(preferences, /data-account-field="dav"[\s\S]*\{% trans %\}labels\.dav_server_url/);
  assert.match(preferences, /data-account-field="email"[\s\S]*labels\.imaphost/);
  assert.match(server, /<span>Password or token<\/span>/);
});

test('account dialog has accessibility and mobile-safe contracts', () => {
  const preferences = read('web/templates/preferences.html');
  const mailAccountJs = read('web/templates/parts/mailaccountjs.html');
  const less = read('assets/less/caldaver.less');

  assert.match(preferences, /role="dialog" aria-modal="true" aria-labelledby="mail_account_dialog_title"/);
  assert.match(preferences, /id="mail_account_error" class="mail-error" aria-live="assertive"/);
  assert.match(mailAccountJs, /function trapFocus\(event\)/);
  assert.match(mailAccountJs, /event\.key === 'Escape'/);
  assert.match(mailAccountJs, /lastFocused\.focus\(\)/);
  assert.match(less, /\.account-dialog[\s\S]*\.contact-dialog-footer[\s\S]*position:\s*sticky;/);
  assert.match(less, /@media \(max-width:\s*900px\)[\s\S]*\.account-dialog[\s\S]*width:\s*100vw;[\s\S]*height:\s*100dvh;[\s\S]*\.contact-dialog-header[\s\S]*position:\s*sticky;/);
});

test('account JavaScript loads and saves through unified accounts endpoints', () => {
  const mailAccountJs = read('web/templates/parts/mailaccountjs.html');
  const server = read('rust/crates/caldaver-server/src/lib.rs');

  assert.match(mailAccountJs, /var accountsUrl = '\/accounts';/);
  assert.match(mailAccountJs, /var accountSaveUrl = '\/accounts\/save';/);
  assert.match(mailAccountJs, /function loadAccounts\(\)[\s\S]*jsonFetch\(accountsUrl/);
  assert.match(mailAccountJs, /event\.target\.action/);
  assert.match(read('web/templates/preferences.html'), /action="\/accounts\/save"/);
  assert.match(mailAccountJs, /new FormData\(event\.target\)/);
  assert.match(server, /async fn accounts\(State\(state\): State<AppState>, headers: HeaderMap\) -> Response/);
  assert.match(server, /async fn account_save\(/);
});

test('account JavaScript reuses the account dialog for editing', () => {
  const mailAccountJs = read('web/templates/parts/mailaccountjs.html');

  assert.match(mailAccountJs, /function openDialog\(event, account\)/);
  assert.match(mailAccountJs, /mail_account_dialog_title'\)\.textContent = account \? 'Edit account'/);
  assert.match(mailAccountJs, /function accountStoredId\(account\)/);
  assert.match(mailAccountJs, /account\.source !== 'session'/);
  assert.match(mailAccountJs, /setInputValue\('password', ''\)/);
  assert.match(mailAccountJs, /row\.querySelector\('\.prefs-account-edit'\)\.addEventListener\('click'/);
});

test('account edit rows expose a focused edit button', () => {
  const mailAccountJs = read('web/templates/parts/mailaccountjs.html');
  const less = read('assets/less/caldaver.less');

  assert.match(mailAccountJs, /class="prefs-account-edit btn btn-default" aria-label="Edit account"/);
  assert.match(mailAccountJs, /fa fa-pencil/);
  assert.match(less, /\.prefs-account-actions\s*\{[\s\S]*justify-items:\s*end;/);
  assert.match(less, /\.prefs-account-edit\s*\{[\s\S]*display:\s*inline-flex;/);
  assert.match(less, /@media \(max-width:\s*900px\)[\s\S]*\.prefs-account-actions\s*\{[\s\S]*justify-content:\s*flex-start;/);
});

test('account edit payloads include only non-secret public fields', () => {
  const server = read('rust/crates/caldaver-server/src/lib.rs');

  const publicStruct = server.match(/struct ConnectedAccountPublic \{[\s\S]*?\n\}/)[0];
  for (const field of ['auth_method', 'username', 'email_address', 'imap_host', 'imap_port', 'encryption', 'refresh_interval_seconds']) {
    assert.match(publicStruct, new RegExp(`${field}:`));
  }
  assert.doesNotMatch(publicStruct, /password_secret/);
  assert.doesNotMatch(publicStruct, /password_sealed/);
  assert.doesNotMatch(publicStruct, /credential/);
  assert.match(server, /auth_method: account\.auth_method\.clone\(\)/);
  assert.match(server, /imap_host: account\.imap_host\.clone\(\)/);
  assert.match(server, /refresh_interval_seconds: account\.refresh_interval_seconds/);
});

test('blank credentials preserve stored secrets during account edits', () => {
  const server = read('rust/crates/caldaver-server/src/lib.rs');
  const storage = read('rust/crates/caldaver-server/src/storage.rs');
  const mailAccountJs = read('web/templates/parts/mailaccountjs.html');

  assert.match(server, /id != 0 && form\.get\("password"\)\.is_none_or\(\|value\| value\.trim\(\)\.is_empty\(\)\)/);
  assert.match(server, /state\.storage\.mail_account\(owner, id\)\.await/);
  assert.match(server, /state\.storage\.dav_account_by_id\(owner, id\)\.await/);
  assert.match(server, /Ok\(Some\(_\)\) => return Err\(json_error\(StatusCode::BAD_REQUEST, "Account type cannot be changed"\)\)/);
  assert.match(storage, /pub async fn dav_account_by_id/);
  assert.match(mailAccountJs, /password\.required = !editingStoredAccount/);
});

test('account JavaScript switches required fields by account type', () => {
  const mailAccountJs = read('web/templates/parts/mailaccountjs.html');

  assert.match(mailAccountJs, /function updateFields\(\)/);
  assert.match(mailAccountJs, /var visible = scope === 'dav' \? !isEmail : isEmail;/);
  assert.match(mailAccountJs, /input\.disabled = !visible;/);
  assert.match(mailAccountJs, /setRequired\(\$\(.*server_url.*\), !isEmail\)/);
  assert.match(mailAccountJs, /setRequired\(\$\(.*email_address.*\), isEmail\)/);
});

test('account API aggregates only stored accounts without secrets', () => {
  const server = read('rust/crates/caldaver-server/src/lib.rs');

  assert.match(server, /struct ConnectedAccountPublic/);
  const publicStruct = server.match(/struct ConnectedAccountPublic \{[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(publicStruct, /credential_secret/);
  assert.doesNotMatch(publicStruct, /credential_sealed/);
  assert.doesNotMatch(publicStruct, /password_secret/);
  assert.doesNotMatch(publicStruct, /dav_password/);
  assert.doesNotMatch(publicStruct, /token/);
  assert.doesNotMatch(server, /session_fallback_accounts/);
  assert.doesNotMatch(server, /source: "session"\.to_string\(\)/);
  assert.match(server, /connected_account_from_dav/);
  assert.match(server, /connected_account_from_mail/);
  assert.match(server, /state\.storage\.dav_account\(&session\.username, "calendar"\)\.await/);
  assert.match(server, /state\.storage\.dav_account\(&session\.username, "carddav"\)\.await/);
  assert.match(server, /caldav_client_for_request\(&state, &session\)\.await/);
  assert.match(server, /carddav_client_for_request\(&state, &session\)\.await/);
});

test('Postgres-only credential migration bootstraps DAV accounts from session credentials once', () => {
  const server = read('rust/crates/caldaver-server/src/lib.rs');
  const storage = read('rust/crates/caldaver-server/src/storage.rs');

  assert.match(server, /bootstrap_postgres_accounts\(&config, &storage\)\.await/);
  assert.match(server, /bootstrap_env_dav_accounts\(config, storage\)\.await/);
  assert.match(server, /bootstrap_session_dav_accounts\(config, storage\)\.await/);
  assert.match(server, /storage[\s\S]*\.dav_account\(owner, account_type\)[\s\S]*\.is_some\(\)[\s\S]*return Ok\(false\)/);
  assert.match(server, /storage[\s\S]*\.save_dav_account\(owner, &account\)/);
  assert.match(storage, /pub async fn session_dav_credentials\(&self\)/);
  assert.match(storage, /SELECT DISTINCT ON \(username\)[\s\S]*FROM caldaver_sessions[\s\S]*WHERE expires_at > \$1/);
  assert.match(storage, /credential_secret = CASE WHEN \$8 = '' THEN credential_secret ELSE \$8 END/);
});

test('runtime DAV clients use Postgres account credentials after migration with no session fallback', () => {
  const server = read('rust/crates/caldaver-server/src/lib.rs');
  const caldavRequest = sourceBetween(server, /async fn caldav_client_for_request\(/, /async fn carddav_client_for_request\(/);
  const carddavRequest = sourceBetween(server, /async fn carddav_client_for_request\(/, /fn dav_auth_for_account\(/);

  assert.match(caldavRequest, /state\.storage\.dav_account\(&session\.username, "calendar"\)\.await/);
  assert.match(caldavRequest, /dav_auth_for_account\(&account\)/);
  assert.doesNotMatch(caldavRequest, /caldav_client_for_session/);
  assert.doesNotMatch(caldavRequest, /falling back to session credentials/);
  assert.match(carddavRequest, /state\.storage\.dav_account\(&session\.username, "carddav"\)\.await/);
  assert.match(carddavRequest, /dav_auth_for_account\(&account\)/);
  assert.doesNotMatch(carddavRequest, /carddav_client_for_session/);
  assert.doesNotMatch(carddavRequest, /falling back to session credentials/);
});

test('mail credentials are Postgres-only and are not sourced from runtime environment variables', () => {
  const config = read('rust/crates/caldaver-server/src/config.rs');
  const server = read('rust/crates/caldaver-server/src/lib.rs');
  const storage = read('rust/crates/caldaver-server/src/storage.rs');

  assert.doesNotMatch(config, /MAIL_[A-Z_]*(PASSWORD|SECRET|TOKEN)|EMAIL_[A-Z_]*(PASSWORD|SECRET|TOKEN)|IMAP_[A-Z_]*(PASSWORD|SECRET|TOKEN)/);
  assert.match(server, /mail_account_for\(&state, &session\.username, account_id\)\.await/);
  assert.match(storage, /SELECT id::BIGINT AS id, label, email_address, imap_host, imap_port::INTEGER AS imap_port, encryption, username, password_secret/);
  assert.match(storage, /self\.open_mail_password\(&row\.get::<_, String>\("password_secret"\)\)/);
});

test('credential encryption requires dedicated strong mail password key only', () => {
  const imap = read('rust/crates/caldaver-server/src/imap_backend.rs');
  const server = read('rust/crates/caldaver-server/src/lib.rs');
  const storage = read('rust/crates/caldaver-server/src/storage.rs');

  assert.match(imap, /const MAIL_PASSWORD_KEY_ENV: &str = "CALDAVER_MAIL_PASSWORD_KEY"/);
  assert.match(imap, /const MIN_MAIL_PASSWORD_KEY_BYTES: usize = 32/);
  assert.match(imap, /fn derive_password_key\(secret: Option<&str>\)/);
  assert.match(imap, /Sha256::digest\(secret\.as_bytes\(\)\)/);
  assert.match(imap, /pub\(crate\) fn validate_password_key_config\(\)/);
  assert.doesNotMatch(sourceBetween(imap, /fn password_key\(\)/, /pub\(crate\) fn validate_password_key_config/), /CALDAVER_AUTH_PASSWORD|caldaver-test-mail-password-key/);
  assert.match(server, /imap_backend::validate_password_key_config\(\)\?/);
  assert.match(storage, /storage\.reseal_legacy_account_credentials\(\)\.await\?/);
  assert.match(storage, /async fn reseal_legacy_account_credentials\(&self\)/);
  assert.match(storage, /if password\.reveal\(\)\.is_ok\(\)/);
  assert.match(storage, /return \(SealedPassword::default\(\), true\)/);
});

test('credential storage docs describe Postgres-only DAV CardDAV and email account credentials', () => {
  const readme = read('README.md');
  const configuration = read('doc/source/admin/configuration.rst');
  const installation = read('doc/source/admin/installation.rst');

  for (const doc of [readme, configuration, installation]) {
    assert.match(doc, /(PostgreSQL|Postgres) stores\s+CalDAV,\s+CardDAV,\s+and email account credentials/i);
    assert.match(doc, /Do not store CalDAV,\s+CardDAV,\s+or\s+email account passwords in Kubernetes secrets\s+or\s+container\s+environment\s+variables/i);
    assert.match(doc, /Preferences > Accounts/i);
    assert.match(doc, /CALDAVER_MAIL_PASSWORD_KEY/i);
    assert.match(doc, /at least 32 bytes/i);
    assert.match(doc, /AES-256-GCM/i);
    assert.match(doc, /local\s+login\s+password[\s\S]*must\s+never\s+be\s+used\s+as\s+an\s+encryption-key\s+fallback/i);
  }
});

test('local Ansible playbook sources account encryption key from encrypted Caldaver secrets into Kubernetes Secret', () => {
  const playbookPath = path.resolve(root, '..', '..', '127-install-caldaver.yaml');
  if (!fs.existsSync(playbookPath)) {
    return;
  }
  const playbook = fs.readFileSync(playbookPath, 'utf8');

  assert.match(playbook, /vars_files:\s*\n(?:.*\n)*\s+- secrets\/caldaver\.enc/);
  assert.match(playbook, /caldaverMailPasswordKey/);
  assert.match(playbook, /CALDAVER_MAIL_PASSWORD_KEY/);
  assert.match(playbook, /kind:\s+Secret/);
  assert.match(playbook, /stringData:\s*\n(?:.*\n)*\s+CALDAVER_MAIL_PASSWORD_KEY:/);
  assert.match(playbook, /no_log:\s+true/);
});

test('DAV accounts are stored in Postgres with sealed credentials', () => {
  const storage = read('rust/crates/caldaver-server/src/storage.rs');
  const server = read('rust/crates/caldaver-server/src/lib.rs');

  assert.match(storage, /pub\(crate\) struct DavAccount/);
  assert.match(storage, /credential_sealed: SealedPassword/);
  assert.match(storage, /self\.seal_mail_password\(&account\.credential_sealed\)/);
  assert.match(storage, /self\.open_mail_password\(&row\.get::<_, String>\("credential_secret"\)\)/);
  assert.match(server, /SealedPassword::seal\(&form\.get\("password"\)\.cloned\(\)\.unwrap_or_default\(\)\)/);
});

test('DAV account save validates account type auth method and URLs', () => {
  const server = read('rust/crates/caldaver-server/src/lib.rs');

  assert.match(server, /account_type != "calendar" && account_type != "carddav"/);
  assert.match(server, /matches!\(auth_method\.as_str\(\), "basic" \| "bearer" \| "none"\)/);
  assert.match(server, /fn validated_dav_server_url\(value: &str, allowed_hosts: &\[String\]\) -> Result<String, Response>/);
  assert.match(server, /url\.username\(\)\.is_empty\(\) \|\| url\.password\(\)\.is_some\(\)/);
  assert.match(server, /host\.eq_ignore_ascii_case\("localhost"\)/);
  assert.match(server, /\.to_socket_addrs\(\)/);
  assert.match(server, /blocked_ipv4\(ip\)/);
  assert.match(server, /blocked_ipv6\(ip\)/);
});

test('email account creation remains backwards compatible through old and new routes', () => {
  const server = read('rust/crates/caldaver-server/src/lib.rs');
  const mailAccountJs = read('web/templates/parts/mailaccountjs.html');

  assert.match(server, /route\("\/mail\/accounts\/save", post\(mail_account_save\)\)/);
  assert.match(server, /Some\("email"\) => match persist_mail_account_from_form/);
  assert.match(server, /mail_account_save[\s\S]*persist_mail_account_from_form\(&state, &session\.username, &form\)/);
  assert.match(mailAccountJs, /name="account_type"/);
  assert.doesNotMatch(mailAccountJs, /\/mail\/accounts\/save/);
});

test('account list styling is responsive and avoids nested cards', () => {
  const less = read('assets/less/caldaver.less');

  assert.match(less, /\.prefs-account-list\s*\{[\s\S]*display:\s*grid;/);
  assert.match(less, /\.prefs-account-row\s*\{[\s\S]*grid-template-columns:\s*40px minmax\(0, 1fr\) auto;/);
  assert.match(less, /@media \(max-width:\s*900px\)[\s\S]*\.prefs-account-row\s*\{[\s\S]*grid-template-columns:\s*36px minmax\(0, 1fr\);/);
  assert.match(less, /@media \(max-width:\s*900px\)[\s\S]*\.prefs-mail-account-create\s*\{[\s\S]*width:\s*100%;/);
  assert.doesNotMatch(less, /\.prefs-accounts-section[\s\S]*\.prefs-account-row[\s\S]*box-shadow/);
});

test('account public rows include status and source metadata', () => {
  const server = read('rust/crates/caldaver-server/src/lib.rs');
  const mailAccountJs = read('web/templates/parts/mailaccountjs.html');

  assert.doesNotMatch(server, /source: "session"\.to_string\(\)/);
  assert.match(server, /source: "postgres"\.to_string\(\)/);
  assert.match(server, /password_needs_reset: account\.credential_needs_reset/);
  assert.match(server, /last_error: account\.last_error\.clone\(\)/);
  assert.match(mailAccountJs, /Postgres/);
  assert.match(mailAccountJs, /account\.password_needs_reset/);
});

test('preferences account edit keeps credentials private and preserves blank-password updates', () => {
  const preferences = read('web/templates/preferences.html');
  const server = read('rust/crates/caldaver-server/src/lib.rs');
  const storage = read('rust/crates/caldaver-server/src/storage.rs');
  const mailAccountJs = read('web/templates/parts/mailaccountjs.html');
  const mail = read('web/templates/mail.html');

  assert.match(preferences, /id="mail_account_dialog_title"[\s\S]*labels\.addaccount/);
  assert.match(mailAccountJs, /function openDialog\(event, account\)/);
  assert.match(mailAccountJs, /class="prefs-account-edit/);
  assert.match(mailAccountJs, /mail_account_dialog_title[\s\S]*Edit account/);
  assert.match(mailAccountJs, /input\[name="id"\]'\)\.value = accountStoredId\(account\)/);
  assert.match(mailAccountJs, /setInputValue\('label', account\.label/);
  assert.match(mailAccountJs, /setInputValue\('server_url', account\.server/);
  assert.match(mailAccountJs, /setInputValue\('email_address', account\.email_address \|\| account\.identifier/);
  assert.match(mailAccountJs, /setInputValue\('password', ''\)/);
  assert.doesNotMatch(server.match(/struct ConnectedAccountPublic \{[\s\S]*?\n\}/)[0], /password_secret|credential|token/i);
  assert.match(storage, /password_secret = CASE WHEN \$9 = '' THEN password_secret ELSE \$9 END/);
  assert.match(storage, /credential_secret = CASE WHEN \$8 = '' THEN credential_secret ELSE \$8 END/);
  assert.doesNotMatch(mail, /prefs-account-edit/);
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
  assert.match(less, /\.mail-reader\s*\{[\s\S]*touch-action:\s*pan-y;/);
  assert.match(less, /\.mail-reader-message\s*\{[\s\S]*touch-action:\s*pan-y;/);
  assert.match(less, /\.mail-reader-html\s*\{[\s\S]*touch-action:\s*pan-y;/);
});

test('mobile previous-events control preserves future calendar scrolling', () => {
  const appJs = read('assets/js/app/app.js');
  const handler = sourceBetween(
    appJs,
    /var bind_mobile_previous_events_control = function bind_mobile_previous_events_control/,
    /var show_calendar_datepicker = function show_calendar_datepicker/
  );

  assert.doesNotMatch(
    handler,
    /fullCalendar\('prev'\)/,
    'Previous events must not replace the current upcoming list window with an older FullCalendar page'
  );
  assert.doesNotMatch(
    handler,
    /mobile_previous_events_target_date|subtract\(mobile_previous_events_step_days\(\)/,
    'Previous events must not move the calendar anchor backward and drop future events from the rendered range'
  );
  assert.match(handler, /mobile_calendar_previous_event_days \+= mobile_previous_events_step_days\(\)/);
  assert.match(handler, /fullCalendar\('gotoDate', current_date\)/);
  assert.match(appJs, /var calendar_list_visible_range = function calendar_list_visible_range/);
  assert.match(appJs, /end:\s*start\.clone\(\)\.add\(duration_days \+ mobile_calendar_previous_event_days, 'days'\)/);
  assert.match(appJs, /mobile_calendar_previous_event_days = 0;\s*\n\s*\$\(('#calendar_view'|"#calendar_view")\)\.fullCalendar\('gotoDate', d\)/);
});

test('mail compose preserves device draft, unavailable send, and accessibility contracts', () => {
  const mail = read('web/templates/mail.html');
  const mailJs = read('web/templates/parts/mailjs.html');
  const less = read('assets/less/caldaver.less');
  const server = read('rust/crates/caldaver-server/src/lib.rs');

  assert.match(mail, /id="mail_compose"[\s\S]*aria-label="Compose mail"[\s\S]*hidden/);
  assert.match(server, /id="mail_compose"[\s\S]*aria-label="Compose mail"[\s\S]*hidden/);
  assert.match(mail, /id="mail_compose_screen"[\s\S]*aria-label="Compose email"/);
  assert.match(mail, /id="mail_compose_ccbcc"[\s\S]*aria-expanded="false"[\s\S]*aria-controls="mail_compose_cc mail_compose_bcc"/);
  assert.match(mail, /id="mail_compose_send"[\s\S]*aria-label="Send"[\s\S]*aria-disabled="true"/);
  assert.match(mail, /id="mail_compose_status"[\s\S]*aria-live="polite"[\s\S]*id="mail_compose_error"[\s\S]*aria-live="assertive"/);
  assert.match(mailJs, /button\.hidden = !activeAccount\(\) \|\| composeScreenOpen\(\);/);
  assert.match(mailJs, /return 'caldaver\.mail\.compose\.' \+ accountId;/);
  assert.match(mailJs, /storage\.setItem\(composeDraftKey\(account\.id\), JSON\.stringify\(draft\)\);/);
  assert.match(mailJs, /setComposeStatus\('Saved on this device'\);/);
  assert.match(mailJs, /setComposeError\('Sending is not configured for this account yet\. Your draft is only saved on this device\.'\);/);
  assert.match(mailJs, /event\.key === 'Escape'[\s\S]*closeComposeScreen\(\);/);
  assert.match(mailJs, /event\.key === 'Enter' && \(event\.ctrlKey \|\| event\.metaKey\)[\s\S]*showComposeSendUnavailable\(\);/);
  assert.match(mailJs, /window\.confirm\('Discard this draft\?'\)[\s\S]*clearComposeDraft\(account\);/);
  assert.match(less, /@media \(max-width:\s*900px\)[\s\S]*\.mail-mobile-compose-button\s*\{[\s\S]*position:\s*fixed;[\s\S]*color:\s*#fff;[\s\S]*background:\s*#d93025;/);
});

test('mail reply preserves thread buttons, per-message drafts, and target sizing contracts', () => {
  const mailMessage = read('web/templates/mail_message.html');
  const mailMessageJs = read('web/templates/parts/mailmessagejs.html');
  const less = read('assets/less/caldaver.less');
  const server = read('rust/crates/caldaver-server/src/lib.rs');

  assert.match(mailMessage, /class="mail-reader-reply-button"[\s\S]*data-uid="\{\{ uid \}\}"[\s\S]*aria-label="Reply to this message"/);
  assert.match(server, /class="mail-reader-reply-button"[\s\S]*data-uid="\{uid\}"[\s\S]*aria-label="Reply to this message"/);
  assert.match(mailMessageJs, /payload\.thread[\s\S]*payload\.messages[\s\S]*data\.thread[\s\S]*data\.messages/);
  assert.match(mailMessageJs, /reply\.className = 'mail-reader-reply-button';[\s\S]*reply\.dataset\.uid = message\.uid;/);
  assert.match(mailMessageJs, /reply\.id = 'mail_reader_reply';/);
  assert.match(mailMessageJs, /openReplyComposer\(message\);/);
  assert.match(mailMessageJs, /return 'caldaver\.mail\.reply\.' \+ accountId \+ '\.' \+ uid;/);
  assert.match(mailMessageJs, /storage\.setItem\(replyDraftKey\(reader\.dataset\.accountId, currentReplyUid\), JSON\.stringify\(draft\)\);/);
  assert.match(mailMessageJs, /return value \? 'Re: ' \+ value : 'Re:';/);
  assert.match(mailMessageJs, /return '\\n\\n' \+ intro \+ '\\n' \+ quoted;/);
  assert.match(mailMessageJs, /setReplyError\('Sending is not configured for this account yet\. Your reply draft is only saved on this device\.'\);/);
  assert.match(mailMessageJs, /\(event\.ctrlKey \|\| event\.metaKey\) && event\.key === 'Enter'[\s\S]*showReplySendUnavailable\(\);/);
  assert.match(mailMessageJs, /event\.key === 'Escape' && !\$\('#mail_reply_composer'\)\.hidden[\s\S]*closeReplyComposer\(\);/);
  assert.match(less, /\.mail-reader-reply-button\s*\{[\s\S]*height:\s*40px;/);
  assert.match(less, /@media \(max-width:\s*900px\)[\s\S]*\.mail-reader-reply-button\s*\{[\s\S]*min-width:\s*44px;[\s\S]*min-height:\s*44px;/);
});

test('contacts card dialing is native Android app only', () => {
  const packageJson = JSON.parse(read('package.json'));
  const cardsJs = read('web/templates/parts/cardsjs.html');

  assert.equal(packageJson.devDependencies['@capacitor/dialog'], '^8.0.1');
  assert.match(cardsJs, /function isInstalledAndroidApp\(\)/);
  assert.match(cardsJs, /window\.Capacitor\.isNativePlatform\(\)/);
  assert.match(cardsJs, /capacitorPlatform\(\) === 'android'/);
  assert.match(cardsJs, /capacitorPlugin\('Dialog'\)/);
  assert.match(cardsJs, /okButtonTitle:\s*'Dial'/);
  assert.match(cardsJs, /cancelButtonTitle:\s*'Cancel'/);
  assert.match(cardsJs, /window\.open\(telHref\(contact\.phone\), '_self'\)/);
  assert.match(cardsJs, /card\.addEventListener\('touchend'/);
  assert.match(cardsJs, /card\.addEventListener\('dblclick'/);
  assert.match(cardsJs, /view !== 'cards'/);
  assert.doesNotMatch(cardsJs, /window\.confirm\('Dial/);
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

  assert.match(server, /caldaver_sess=\{id\}; Path=\/; Max-Age=\{\}; HttpOnly; SameSite=Lax/);
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

test('today highlight targets FullCalendar 3 DOM and compares calendar dates, not instants', () => {
  const less = read('assets/less/caldaver.less');
  const appJs = read('assets/js/app/app.js');

  // Month view: FC3 puts fc-today on the cell (td.fc-day-top.fc-today) with the
  // number in a nested <a class="fc-day-number">, so the old selector
  // `.fc-day-number.fc-today` on the anchor never matched.
  assert.doesNotMatch(less, /#calendar_view \.fc-day-number\.fc-today/);
  const badge = cssBlock(
    less,
    '#calendar_view td.fc-day-number.fc-today,\n#calendar_view td.fc-day-top.fc-today > .fc-day-number'
  );
  assert.match(badge, /width:\s*28px;/);
  assert.match(badge, /height:\s*28px;/);
  assert.match(badge, /color:\s*#fff;/);
  assert.match(badge, /background:\s*#1a73e8;/);
  assert.match(badge, /border-radius:\s*50%;/);

  // Week view header: FullCalendar 3 hands over ambiguously-zoned (UTC-mode)
  // moments, so deciding "today" with isSame() against a local moment puts the
  // circle on the wrong day near UTC midnight. Compare date strings instead,
  // and only week view headers get the circle (not day or list views).
  // The "now" reference must be timezone-aware (moment.tz(calendar_timezone()))
  // so the comparison matches the user's calendar day, not the browser's local day.
  const header = sourceBetween(appJs, /columnHeaderHtml: function\(date\)/, /defaultView:/);
  assert.doesNotMatch(header, /date\.isSame\(/);
  assert.match(header, /var now = moment\.tz\(calendar_timezone\(\)\);/);
  assert.match(header, /viewName === 'agendaWeek' && date\.format\('YYYY-MM-DD'\) === now\.format\('YYYY-MM-DD'\)/);
  assert.match(header, /fc-header-today-circle/);
});

test('week view time grid has transparent slats background so vertical day separators show through', () => {
  const less = read('assets/less/caldaver.less');

  // The slats layer sits above the .fc-bg layer. Without an explicit
  // transparent background the opaque white default paints over the bg
  // layer's vertical day separators (border-left on .fc-bg td.fc-day).
  const slatsBlock = cssBlock(less, '#calendar_view .fc-time-grid .fc-slats td');
  assert.match(slatsBlock, /background:\s*transparent/);

  // The bg layer is what actually draws the vertical separators, so confirm
  // it carries the separator border color.
  assert.match(less, /#calendar_view \.fc-bg td\.fc-day,[\s\S]*?border-color:\s*#dadce0/);
});

test('mail swipe handler wires archive and delete to authenticated backend endpoints', () => {
  const mailJs = read('web/templates/parts/mailjs.html');
  const rustServer = read('rust/crates/caldaver-server/src/lib.rs');

  // The placeholder "removeChild" only path is gone — the swipe now POSTs.
  assert.doesNotMatch(mailJs, /placeholder[^)]*archive/);
  assert.doesNotMatch(mailJs, /placeholder[^)]*delete/);
  assert.match(mailJs, /runMailRowSwipe\(row, 'archive'/);
  assert.match(mailJs, /runMailRowSwipe\(row, 'delete'/);
  assert.match(mailJs, /\/mail\/message\/' \+ action/);
  assert.match(mailJs, /postMailSwipeAction\(action, accountId, mailbox, uid\)/);

  // Rows carry the data the swipe needs to call the backend.
  assert.match(mailJs, /row\.dataset\.accountId = activeAccountId/);
  assert.match(mailJs, /row\.dataset\.uid = message\.uid/);
  assert.match(mailJs, /row\.dataset\.mailbox/);

  // Failure path must restore the row (no silent data loss / no fake success).
  assert.match(mailJs, /restoreRow/);
  assert.match(mailJs, /showTransientMailError/);

  // Inbox page exposes the CSRF token the POST routes require.
  const mailHtml = read('web/templates/mail.html');
  assert.match(mailHtml, /id="mail_rows"[^>]*data-csrf-token=/);
  assert.match(rustServer, /id="mail_rows"[^>]*data-csrf-token="\{csrf\}"/);

  // Backend routes exist and follow the same conventions as /mail/message/unread.
  assert.match(rustServer, /route\("\/mail\/message\/delete", post\(mail_message_delete\)\)/);
  assert.match(rustServer, /route\("\/mail\/message\/archive", post\(mail_message_archive\)\)/);
  assert.match(rustServer, /async fn mail_message_delete\(/);
  assert.match(rustServer, /async fn mail_message_archive\(/);
});

test('mail reader archive and delete buttons call the backend instead of just navigating', () => {
  const mailMessageJs = read('web/templates/parts/mailmessagejs.html');

  // performMailAction is the shared helper invoked by both buttons.
  assert.match(mailMessageJs, /function performMailAction\(action, confirmMessage, fallbackMessage\)/);
  assert.match(mailMessageJs, /formFetch\('\/mail\/message\/' \+ action/);
  // Delete still confirms; archive does not (matches prior UX).
  assert.match(mailMessageJs, /performMailAction\('delete', 'Delete this message\?'/);
  assert.match(mailMessageJs, /performMailAction\('archive', null,/);
  // Failure surfaces an error rather than silently navigating away.
  assert.match(mailMessageJs, /\$\('#mail_reader_error'\)\.textContent = error\.message/);
});

test('events route returns {events, errors} so a per-calendar 400 does not 502 the whole request', () => {
  const rustServer = read('rust/crates/caldaver-server/src/lib.rs');
  const appJs = read('assets/js/app/app.js');

  // Backend wraps the events list and includes an errors array; both success
  // and the radicale-400 path return HTTP 200.
  assert.match(rustServer, /json!\(\{"events": events, "errors": \[\]\}\)/);
  assert.match(rustServer, /"events": \[\],\s*"errors":\s*\[\{[\s\S]*?"calendar": calendar[\s\S]*?"status": status\.as_u16\(\)/);
  // Auth-related failures stay hard.
  assert.match(rustServer, /fn soft_calendar_failure_status\(error: &CalDavError\) -> Option<StatusCode>/);

  // Frontend event source unwraps `events` for FullCalendar and surfaces errors.
  assert.match(appJs, /dataFilter: function\(data\)/);
  assert.match(appJs, /Array\.isArray\(parsed\.events\)/);
  assert.match(appJs, /show_calendar_partial_errors\(calendar, parsed\.errors\)/);
});
