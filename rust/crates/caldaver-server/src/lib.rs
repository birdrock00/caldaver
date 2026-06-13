mod carddav_backend;
pub mod caldav_backend;
mod config;
mod imap_backend;
mod storage;

use crate::caldav_backend::{CalDavAuth, CalDavClient, CalDavConfig, CalDavError};
use crate::config::Config;
use crate::storage::{DavAccount, SessionDavCredentials, Storage};
use axum::extract::{Form, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{Html, IntoResponse, Json, Redirect, Response};
use axum::routing::{get, post};
use axum::Router;
use caldaver_core::caldav::resource::{Calendar as CoreCalendar, CalendarObject};
use caldaver_core::carddav::{ContactInput, Contact as CardDavContact};
use caldaver_core::xml::XmlProperty;
use carddav_backend::{CardDavClient, CardDavConfig};
use imap_backend::{
    ImapMailBackend, MailAccount, MailAccountPublic, MailBackend, MailBackendError, MailMessage,
    SealedPassword,
};
use base64::Engine;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::env;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs};
use std::sync::Arc;
use std::time::Duration;
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;
use uuid::Uuid;

const DEFAULT_CALENDAR: &str = "/calendars/default/";
const DEFAULT_TIMEZONE: &str = "America/Los_Angeles";

#[derive(Clone)]
pub struct AppState {
    config: Config,
    storage: Storage,
    mail_backend: Arc<dyn MailBackend>,
}

#[derive(Clone, Debug)]
pub(crate) struct Session {
    username: String,
    displayname: String,
    csrf: String,
    preferences: Preferences,
    dav_username: String,
    dav_password: String,
    principal_url: String,
    calendar_home_set: String,
    addressbook_home_set: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct Preferences {
    language: String,
    default_calendar: String,
    hidden_calendars: HashMap<String, bool>,
    time_format: String,
    date_format: String,
    weekstart: u8,
    #[serde(default = "default_timezone")]
    timezone: String,
    show_week_nb: bool,
    show_now_indicator: bool,
    list_days: u8,
    default_view: String,
    disable_javascript: bool,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            language: "en".to_string(),
            default_calendar: DEFAULT_CALENDAR.to_string(),
            hidden_calendars: HashMap::new(),
            time_format: "24".to_string(),
            date_format: "ymd".to_string(),
            weekstart: 0,
            timezone: env::var("CALDAVER_TIMEZONE").unwrap_or_else(|_| DEFAULT_TIMEZONE.to_string()),
            show_week_nb: false,
            show_now_indicator: true,
            list_days: 7,
            default_view: "month".to_string(),
            disable_javascript: false,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct CalendarEvent {
    id: String,
    uid: String,
    title: String,
    start: String,
    end: String,
    #[serde(rename = "allDay")]
    all_day: bool,
    calendar: String,
    href: String,
    etag: String,
    editable: bool,
    color: String,
    location: String,
    description: String,
    #[serde(default = "default_timezone")]
    timezone: String,
}

fn default_timezone() -> String {
    DEFAULT_TIMEZONE.to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct Contact {
    full_name: String,
    email: String,
    phone: String,
    organization: String,
    job_title: String,
    company_line: String,
    labels: Vec<String>,
    url: String,
    etag: String,
}

#[derive(Clone, Debug, Serialize)]
struct ConnectedAccountPublic {
    #[serde(rename = "type")]
    account_type: String,
    id: String,
    label: String,
    identifier: String,
    server: String,
    auth_method: String,
    username: String,
    email_address: String,
    imap_host: String,
    imap_port: u16,
    encryption: String,
    refresh_interval_seconds: u64,
    home_set: String,
    enabled: bool,
    source: String,
    password_needs_reset: bool,
    last_error: String,
}

pub async fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let app = build_router(
        AppState::from_env()
            .await
            .expect("Caldaver Rust backend configuration must be valid"),
    );
    let addr: SocketAddr = env::var("CALDAVER_BIND")
        .unwrap_or_else(|_| "0.0.0.0:8080".to_string())
        .parse()
        .expect("CALDAVER_BIND must be a socket address");

    tracing::info!(%addr, "starting Rust Caldaver backend");
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .expect("server");
}

impl AppState {
    async fn from_env() -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let config = Config::from_env()?;
        imap_backend::validate_password_key_config()?;
        let storage = Storage::connect(&config.database_url, config.csrf_secret.clone()).await?;
        if let Err(error) = bootstrap_postgres_accounts(&config, &storage).await {
            tracing::warn!(%error, "Postgres account bootstrap did not complete cleanly");
        }
        Ok(Self {
            config,
            storage,
            mail_backend: Arc::new(ImapMailBackend),
        })
    }
}

async fn bootstrap_postgres_accounts(config: &Config, storage: &Storage) -> Result<(), String> {
    let mut migrated = 0usize;
    let mut errors = Vec::new();

    match bootstrap_env_dav_accounts(config, storage).await {
        Ok(count) => migrated += count,
        Err(error) => errors.push(error),
    }
    match bootstrap_session_dav_accounts(config, storage).await {
        Ok(count) => migrated += count,
        Err(error) => errors.push(error),
    }

    if migrated > 0 {
        tracing::info!(migrated, "bootstrapped DAV account credentials into Postgres");
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

async fn bootstrap_env_dav_accounts(config: &Config, storage: &Storage) -> Result<usize, String> {
    if config.caldav_server.trim().is_empty()
        || config.caldav_username.trim().is_empty()
        || config.caldav_password.trim().is_empty()
    {
        return Ok(0);
    }
    let owner = config
        .auth_username
        .trim()
        .strip_prefix('/')
        .unwrap_or(config.auth_username.trim())
        .trim_matches('/')
        .to_string();
    let owner = if owner.is_empty() {
        config.caldav_username.trim().trim_matches('/').to_string()
    } else {
        owner
    };
    if owner.is_empty() {
        return Ok(0);
    }

    let dav_username = config.caldav_username.trim().to_string();
    let dav_password = config.caldav_password.clone();
    bootstrap_dav_accounts(
        storage,
        &owner,
        &dav_username,
        &dav_password,
        BootstrapDavHomes::default(),
        config,
        "Migrated calendar account",
        "Migrated contacts account",
    )
    .await
}

async fn bootstrap_session_dav_accounts(config: &Config, storage: &Storage) -> Result<usize, String> {
    let credentials = storage
        .session_dav_credentials()
        .await
        .map_err(|error| format!("failed to load session DAV credentials from Postgres: {error}"))?;
    let mut migrated = 0usize;
    let mut errors = Vec::new();
    for credential in credentials {
        match bootstrap_dav_accounts_from_session(config, storage, &credential).await {
            Ok(count) => migrated += count,
            Err(error) => errors.push(error),
        }
    }
    if errors.is_empty() {
        Ok(migrated)
    } else {
        Err(errors.join("; "))
    }
}

async fn bootstrap_dav_accounts_from_session(
    config: &Config,
    storage: &Storage,
    credentials: &SessionDavCredentials,
) -> Result<usize, String> {
    bootstrap_dav_accounts(
        storage,
        &credentials.owner,
        &credentials.dav_username,
        &credentials.dav_password,
        BootstrapDavHomes {
            principal_url: credentials.principal_url.clone(),
            calendar_home_set: credentials.calendar_home_set.clone(),
            addressbook_home_set: credentials.addressbook_home_set.clone(),
        },
        config,
        "Migrated calendar login",
        "Migrated contacts login",
    )
    .await
}

#[derive(Default)]
struct BootstrapDavHomes {
    principal_url: String,
    calendar_home_set: String,
    addressbook_home_set: String,
}

async fn bootstrap_dav_accounts(
    storage: &Storage,
    owner: &str,
    dav_username: &str,
    dav_password: &str,
    homes: BootstrapDavHomes,
    config: &Config,
    calendar_label: &str,
    carddav_label: &str,
) -> Result<usize, String> {
    let auth_method = normalized_dav_auth_method(&config.caldav_auth_method);
    if auth_method != "none" && dav_password.is_empty() {
        return Ok(0);
    }
    let mut migrated = 0usize;
    migrated += save_missing_bootstrap_dav_account(
        storage,
        owner,
        "calendar",
        calendar_label,
        &substitute_dav_username(&config.caldav_server, dav_username),
        &auth_method,
        dav_username,
        dav_password,
        &homes.principal_url,
        &homes.calendar_home_set,
    )
    .await? as usize;
    migrated += save_missing_bootstrap_dav_account(
        storage,
        owner,
        "carddav",
        carddav_label,
        &substitute_dav_username(&config.carddav_server, dav_username),
        &auth_method,
        dav_username,
        dav_password,
        &homes.principal_url,
        &homes.addressbook_home_set,
    )
    .await? as usize;
    Ok(migrated)
}

async fn save_missing_bootstrap_dav_account(
    storage: &Storage,
    owner: &str,
    account_type: &str,
    label: &str,
    server_url: &str,
    auth_method: &str,
    username: &str,
    password: &str,
    principal_url: &str,
    home_set: &str,
) -> Result<bool, String> {
    if storage
        .dav_account(owner, account_type)
        .await
        .map_err(|error| format!("failed to check stored {account_type} account for {owner}: {error}"))?
        .is_some()
    {
        return Ok(false);
    }
    let credential_sealed = SealedPassword::seal(password)
        .map_err(|error| format!("failed to seal {account_type} credential for {owner}: {error}"))?;
    let account = DavAccount {
        id: 0,
        account_type: account_type.to_string(),
        label: label.to_string(),
        server_url: server_url.to_string(),
        auth_method: auth_method.to_string(),
        username: username.to_string(),
        credential_sealed,
        credential_needs_reset: false,
        principal_url: principal_url.to_string(),
        home_set: home_set.to_string(),
        enabled: true,
        last_error: String::new(),
    };
    storage
        .save_dav_account(owner, &account)
        .await
        .map_err(|error| format!("failed to bootstrap stored {account_type} account for {owner}: {error}"))?;
    Ok(true)
}

fn normalized_dav_auth_method(value: &str) -> String {
    match value.to_ascii_lowercase().as_str() {
        "none" => "none".to_string(),
        "bearer" => "bearer".to_string(),
        _ => "basic".to_string(),
    }
}

pub fn build_router(state: AppState) -> Router {
    let static_root = state.config.static_root.clone();
    Router::new()
        .route("/", get(calendar_page))
        .route("/login", get(login_page).post(login_post))
        .route("/logout", get(logout))
        .route("/cards", get(cards_page))
        .route("/cards/list", get(cards_list))
        .route("/cards/save", post(cards_save))
        .route("/cards/update", post(cards_update))
        .route("/cards/delete", post(cards_delete))
        .route("/mail", get(mail_page))
        .route("/mail/read", get(mail_read_page))
        .route("/accounts", get(accounts))
        .route("/accounts/save", post(account_save))
        .route("/mail/accounts", get(mail_accounts))
        .route("/mail/accounts/save", post(mail_account_save))
        .route("/mail/messages", get(mail_messages))
        .route("/mail/messages/sync", get(mail_messages_sync))
        .route("/mail/message", get(mail_message))
        .route("/mail/message/navigation", get(mail_message_navigation))
        .route("/mail/message/unread", post(mail_mark_unread))
        .route("/mail/attachment", get(mail_attachment))
        .route("/mail/image", get(mail_image))
        .route("/preferences", get(preferences_page).post(preferences_save))
        .route("/calendars", get(calendars_list).post(calendar_save))
        .route("/calendars/save", post(calendar_save))
        .route("/calendars/delete", post(calendar_delete))
        .route("/events", get(events_list))
        .route("/eventbase", get(event_base))
        .route("/events/save", post(event_save))
        .route("/events/delete", post(event_delete))
        .route("/events/drop", post(event_drop))
        .route("/events/resize", post(event_resize))
        .route("/principals", get(principals))
        .route("/jssettings", get(jssettings))
        .route("/keepalive", get(|| async { "" }))
        .route("/__rust/health", get(|| async { Json(json!({"ok": true, "backend": "rust"})) }))
        .fallback_service(
            ServeDir::new(static_root).fallback(get(not_found_page).with_state(state.clone()))
        )
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    let cookie = headers.get(header::COOKIE)?.to_str().ok()?;
    cookie.split(';').find_map(|part| {
        let (key, value) = part.trim().split_once('=')?;
        (key == name).then(|| value.to_string())
    })
}

fn secure_cookie_attr(config: &Config) -> &'static str {
    if config.cookie_secure { "; Secure" } else { "" }
}

async fn session_from(headers: &HeaderMap, state: &AppState) -> Result<(String, Session), Response> {
    let Some(id) = cookie_value(headers, "caldaver_sess") else {
        return Err(Redirect::to("/login").into_response());
    };
    let Some(session) = state
        .storage
        .session(&id)
        .await
        .map_err(|error| {
            tracing::error!(%error, "failed to load session from Postgres");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        })?
    else {
        return Err(Redirect::to("/login").into_response());
    };
    Ok((id, session.clone()))
}

async fn ajax_session_from(headers: &HeaderMap, state: &AppState) -> Result<(String, Session), Response> {
    session_from(headers, state)
        .await
        .map_err(|_| (StatusCode::UNAUTHORIZED, Json(json!({}))).into_response())
}

fn valid_csrf(session: &Session, form: &HashMap<String, String>) -> bool {
    form.get("_token").is_some_and(|token| token == &session.csrf)
}

fn html_response(body: String) -> Html<String> {
    Html(body)
}

async fn not_found_page(State(state): State<AppState>) -> Response {
    let html = layout(
        &state,
        "caldaver-error-page",
        r#"<div id="content" class="container"><div class="page-header"><h1>Page not found</h1></div><div class="alert alert-danger" role="alert"><p>The page you requested could not be found.</p></div><p style="margin-top: 20px;"><a href="/" style="color: #1a73e8; font-weight: 500;">Return to Calendar</a></p></div>"#,
        "",
    );
    (StatusCode::NOT_FOUND, html_response(html)).into_response()
}

async fn login_page(State(state): State<AppState>) -> Html<String> {
    html_response(render_login(&state, None))
}

async fn login_post(State(state): State<AppState>, Form(form): Form<HashMap<String, String>>) -> Response {
    let user = form.get("user").map(String::as_str).unwrap_or("").trim();
    let password = form.get("password").map(String::as_str).unwrap_or("");
    if user.is_empty() || password.is_empty() {
        return Html(render_login(&state, Some("Required fields are missing"))).into_response();
    }
    let local_auth_enforced = !state.config.auth_username.is_empty();
    if local_auth_enforced && (state.config.auth_username != user || !verify_local_auth_password(&state.config, password)) {
        return Html(render_login(&state, Some("Invalid username or password"))).into_response();
    }

    let id = Uuid::new_v4().to_string();
    let displayname = user.trim_matches('/').to_string();
    let preferences = state
        .storage
        .preferences(user)
        .await
        .unwrap_or(None)
        .unwrap_or_else(Preferences::default);
    let mut session = Session {
        username: user.to_string(),
        displayname,
        csrf: Uuid::new_v4().to_string(),
        preferences,
        dav_username: if state.config.caldav_username.is_empty() {
            user.to_string()
        } else {
            state.config.caldav_username.clone()
        },
        dav_password: if state.config.caldav_password.is_empty() {
            password.to_string()
        } else {
            state.config.caldav_password.clone()
        },
        principal_url: String::new(),
        calendar_home_set: String::new(),
        addressbook_home_set: String::new(),
    };
    if !local_auth_enforced {
        session.dav_username = user.to_string();
        session.dav_password = password.to_string();
    }

    let has_stored_calendar = state
        .storage
        .dav_account(&session.username, "calendar")
        .await
        .ok()
        .flatten()
        .is_some();
    let should_validate_dav_login = !local_auth_enforced;
    let should_bootstrap_dav_login =
        !has_stored_calendar && !state.config.caldav_server.trim().is_empty() && !session.dav_password.trim().is_empty();
    if should_validate_dav_login || should_bootstrap_dav_login {
        if state.config.caldav_server.trim().is_empty() {
            return Html(render_login(&state, Some("Invalid username or password"))).into_response();
        }
        match discover_login_dav_homes(&state.config, &session).await {
            Ok(homes) => {
                if !has_stored_calendar {
                    let session_credentials = SessionDavCredentials {
                        owner: session.username.clone(),
                        dav_username: session.dav_username.clone(),
                        dav_password: session.dav_password.clone(),
                        principal_url: homes.principal_url.clone(),
                        calendar_home_set: homes.calendar_home_set.clone(),
                        addressbook_home_set: homes.addressbook_home_set.clone(),
                    };
                    if let Err(error) =
                        bootstrap_dav_accounts_from_session(&state.config, &state.storage, &session_credentials).await
                    {
                        tracing::warn!(%error, user = %session.username, "failed to bootstrap DAV login credentials into Postgres");
                    }
                }
            }
            Err(error) => {
                tracing::warn!(%error, user = %session.username, "legacy DAV login bootstrap failed");
                if should_validate_dav_login {
                    return Html(render_login(&state, Some("Invalid username or password"))).into_response();
                }
            }
        }
    }
    if let Ok(Some(account)) = state.storage.dav_account(&session.username, "calendar").await {
        session.dav_username = account.username;
        session.principal_url = account.principal_url;
        session.calendar_home_set = account.home_set;
    }
    if let Ok(Some(account)) = state.storage.dav_account(&session.username, "carddav").await {
        session.addressbook_home_set = account.home_set;
    }
    session.dav_password.clear();
    if let Err(error) = state
        .storage
        .insert_session(&id, &session, state.config.session_lifetime)
        .await
    {
        tracing::error!(%error, "failed to persist login session to Postgres");
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }

    let mut response = Redirect::to("/").into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&format!(
            "caldaver_sess={id}; Path=/; Max-Age={}; HttpOnly; SameSite=Lax{}",
            state.config.session_lifetime.as_secs(),
            secure_cookie_attr(&state.config)
        ))
        .unwrap(),
    );
    response
}

async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Some(id) = cookie_value(&headers, "caldaver_sess") {
        if let Err(error) = state.storage.delete_session(&id).await {
            tracing::error!(%error, "failed to delete session from Postgres");
        }
    }
    let location = state.config.logout_redirection.as_deref().unwrap_or("/login");
    let mut response = Redirect::to(location).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&format!(
            "caldaver_sess=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax{}",
            secure_cookie_attr(&state.config)
        ))
        .unwrap(),
    );
    response
}

async fn calendar_page(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Ok((_, session)) = session_from(&headers, &state).await else {
        return Redirect::to("/login").into_response();
    };
    html_response(render_calendar(&state, &session)).into_response()
}

async fn cards_page(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Ok((_, session)) = session_from(&headers, &state).await else {
        return Redirect::to("/login").into_response();
    };
    html_response(render_cards(&state, &session)).into_response()
}

async fn mail_page(State(state): State<AppState>, headers: HeaderMap, Query(query): Query<HashMap<String, String>>) -> Response {
    let Ok((_, session)) = session_from(&headers, &state).await else {
        return Redirect::to("/login").into_response();
    };
    html_response(render_mail(&state, &session, mail_javascript_disabled(&session, &query))).into_response()
}

async fn mail_read_page(State(state): State<AppState>, headers: HeaderMap, Query(query): Query<HashMap<String, String>>) -> Response {
    let Ok((_, session)) = session_from(&headers, &state).await else {
        return Redirect::to("/login").into_response();
    };
    let account_id = query.get("account_id").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
    let uid = query.get("uid").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
    html_response(render_mail_read(&state, &session, account_id, uid)).into_response()
}

async fn preferences_page(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Ok((_, session)) = session_from(&headers, &state).await else {
        return Redirect::to("/login").into_response();
    };
    let accounts = match connected_accounts(&state, &session).await {
        Ok(accounts) => accounts,
        Err(error) => {
            tracing::error!(%error, "failed to load connected accounts for preferences render");
            Vec::new()
        }
    };
    let calendars = match caldav_client_for_request(&state, &session).await {
        Ok((client, calendar_home_set)) => client
            .list_calendars(&calendar_home_set)
            .await
            .map(|cals| cals.iter().map(|c| (c.url().to_string(), c.property(CoreCalendar::DISPLAYNAME).unwrap_or("Calendar").to_string())).collect::<Vec<_>>())
            .unwrap_or_default(),
        Err(_) => Vec::new(),
    };
    html_response(render_preferences(&state, &session, &accounts, &calendars)).into_response()
}

async fn preferences_save(State(state): State<AppState>, headers: HeaderMap, Form(form): Form<HashMap<String, String>>) -> Response {
    let Ok((id, mut session)) = session_from(&headers, &state).await else {
        return Redirect::to("/login").into_response();
    };
    if !valid_csrf(&session, &form) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    session.preferences.language = form.get("language").cloned().unwrap_or_else(|| "en".to_string());
    session.preferences.timezone = form
        .get("timezone")
        .cloned()
        .unwrap_or_else(|| DEFAULT_TIMEZONE.to_string());
    session.preferences.default_calendar = form
        .get("default_calendar")
        .cloned()
        .unwrap_or_else(|| DEFAULT_CALENDAR.to_string());
    session.preferences.date_format = form.get("date_format").cloned().unwrap_or_else(|| "ymd".to_string());
    session.preferences.time_format = form.get("time_format").cloned().unwrap_or_else(|| "24".to_string());
    session.preferences.weekstart = form.get("weekstart").and_then(|v| v.parse().ok()).unwrap_or(0);
    session.preferences.show_week_nb = form.get("show_week_nb").is_some_and(|v| v == "true");
    session.preferences.show_now_indicator = form.get("show_now_indicator").is_none_or(|v| v == "true");
    session.preferences.list_days = form.get("list_days").and_then(|v| v.parse().ok()).unwrap_or(7);
    session.preferences.default_view = form.get("default_view").cloned().unwrap_or_else(|| "month".to_string());
    session.preferences.disable_javascript = form.get("disable_javascript").is_some_and(|v| v == "true");
    if let Err(error) = state.storage.save_preferences(&session.username, &session.preferences).await {
        tracing::error!(%error, "failed to save preferences to Postgres");
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    if let Err(error) = state
        .storage
        .insert_session(&id, &session, state.config.session_lifetime)
        .await
    {
        tracing::error!(%error, "failed to refresh session preferences in Postgres");
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    Redirect::to("/").into_response()
}

fn verify_local_auth_password(config: &Config, password: &str) -> bool {
    if !config.auth_password_hash.trim().is_empty() {
        return verify_password_hash(&config.auth_password_hash, password);
    }

    constant_time_eq(config.auth_password.as_bytes(), password.as_bytes())
}

fn verify_password_hash(encoded: &str, password: &str) -> bool {
    let parts = encoded.split('$').collect::<Vec<_>>();

    if parts.len() != 4 || parts[0] != "pbkdf2-sha256" {
        return false;
    }

    let Ok(iterations) = parts[1].parse::<u32>() else {
        return false;
    };

    if iterations == 0 || iterations > 2_000_000 {
        return false;
    }

    let Ok(salt) = base64::engine::general_purpose::STANDARD.decode(parts[2]) else {
        return false;
    };
    let Ok(expected) = base64::engine::general_purpose::STANDARD.decode(parts[3]) else {
        return false;
    };

    if salt.len() < 16 || expected.len() < 32 {
        return false;
    }

    let actual = pbkdf2_sha256(password.as_bytes(), &salt, iterations, expected.len());
    constant_time_eq(&actual, &expected)
}

fn pbkdf2_sha256(password: &[u8], salt: &[u8], iterations: u32, output_len: usize) -> Vec<u8> {
    let mut output = Vec::with_capacity(output_len);
    let mut block_index = 1u32;

    while output.len() < output_len {
        let mut block_input = Vec::with_capacity(salt.len() + 4);
        block_input.extend_from_slice(salt);
        block_input.extend_from_slice(&block_index.to_be_bytes());

        let mut u = hmac_sha256(password, &block_input);
        let mut block = u;

        for _ in 1..iterations {
            u = hmac_sha256(password, &u);
            for (left, right) in block.iter_mut().zip(u.iter()) {
                *left ^= *right;
            }
        }

        output.extend_from_slice(&block);
        block_index = block_index.saturating_add(1);
    }

    output.truncate(output_len);
    output
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> [u8; 32] {
    let mut normalized_key = [0u8; 64];

    if key.len() > normalized_key.len() {
        let digest = Sha256::digest(key);
        normalized_key[..digest.len()].copy_from_slice(&digest);
    } else {
        normalized_key[..key.len()].copy_from_slice(key);
    }

    let mut inner_pad = [0x36u8; 64];
    let mut outer_pad = [0x5cu8; 64];
    for index in 0..normalized_key.len() {
        inner_pad[index] ^= normalized_key[index];
        outer_pad[index] ^= normalized_key[index];
    }

    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(data);
    let inner_digest = inner.finalize();

    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner_digest);
    outer.finalize().into()
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    let mut diff = left.len() ^ right.len();
    let max_len = left.len().max(right.len());

    for index in 0..max_len {
        let left_byte = left.get(index).copied().unwrap_or(0);
        let right_byte = right.get(index).copied().unwrap_or(0);
        diff |= usize::from(left_byte ^ right_byte);
    }

    diff == 0
}

async fn calendars_list(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Ok((_, session)) = ajax_session_from(&headers, &state).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({}))).into_response();
    };
    let (client, calendar_home_set) = match caldav_client_for_request(&state, &session).await {
        Ok(client) => client,
        Err(error) => return caldav_response(error),
    };
    match client.list_calendars(&calendar_home_set).await {
        Ok(calendars) => Json(json!({
            "data": calendars.iter().map(calendar_payload).collect::<Vec<_>>()
        }))
        .into_response(),
        Err(error) => caldav_response(error),
    }
}

async fn calendar_save(State(state): State<AppState>, headers: HeaderMap, Form(form): Form<HashMap<String, String>>) -> Response {
    let Ok((_, session)) = ajax_session_from(&headers, &state).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({}))).into_response();
    };
    if !valid_csrf(&session, &form) {
        return json_error(StatusCode::UNAUTHORIZED, "CSRF token not present");
    }
    let (client, calendar_home_set) = match caldav_client_for_request(&state, &session).await {
        Ok(client) => client,
        Err(error) => return caldav_response(error),
    };
    let displayname = form
        .get("displayname")
        .map(String::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("New calendar");
    let color = form
        .get("calendar_color")
        .map(String::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("#03A9F4");
    let properties = calendar_properties(displayname, color);
    let calendar_url = form
        .get("calendar")
        .cloned()
        .unwrap_or_else(|| new_calendar_url(&calendar_home_set, displayname));
    if !dav_href_in_scope(&calendar_url, &calendar_home_set) {
        return json_error(StatusCode::BAD_REQUEST, "Calendar href is outside the CalDAV home set");
    }
    let result = if form.get("calendar").is_some() {
        client.update_calendar(&calendar_url, &properties).await
    } else {
        client.create_calendar(&calendar_url, &properties).await
    };
    match result {
        Ok(result) => Json(json!({"result": "SUCCESS", "message": result.href})).into_response(),
        Err(error) => caldav_response(error),
    }
}

async fn calendar_delete(State(state): State<AppState>, headers: HeaderMap, Form(form): Form<HashMap<String, String>>) -> Response {
    let Ok((_, session)) = ajax_session_from(&headers, &state).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({}))).into_response();
    };
    if !valid_csrf(&session, &form) {
        return json_error(StatusCode::UNAUTHORIZED, "CSRF token not present");
    }
    let Some(calendar) = form.get("calendar").filter(|value| !value.is_empty()) else {
        return json_error(StatusCode::BAD_REQUEST, "Calendar is required");
    };
    let (client, calendar_home_set) = match caldav_client_for_request(&state, &session).await {
        Ok(client) => client,
        Err(error) => return caldav_response(error),
    };
    if !dav_href_in_scope(calendar, &calendar_home_set) {
        return json_error(StatusCode::BAD_REQUEST, "Calendar href is outside the CalDAV home set");
    }
    match client.delete_calendar(calendar, form.get("etag").map(String::as_str)).await {
        Ok(()) => Json(json!({"result": "SUCCESS", "message": calendar})).into_response(),
        Err(error) => caldav_response(error),
    }
}

async fn events_list(State(state): State<AppState>, headers: HeaderMap, Query(query): Query<HashMap<String, String>>) -> Response {
    let Ok((_, session)) = ajax_session_from(&headers, &state).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({}))).into_response();
    };
    let calendar = query.get("calendar").cloned().unwrap_or_else(|| DEFAULT_CALENDAR.to_string());
    if let Ok((client, calendar_home_set)) = caldav_client_for_request(&state, &session).await {
        if !dav_href_in_scope(&calendar, &calendar_home_set) {
            return json_error(StatusCode::BAD_REQUEST, "Calendar href is outside the CalDAV home set");
        }
        let start = query
            .get("start")
            .map(|value| caldav_datetime(value))
            .unwrap_or_else(|| "19700101T000000Z".to_string());
        let end = query
            .get("end")
            .map(|value| caldav_datetime(value))
            .unwrap_or_else(|| "29991231T235959Z".to_string());
        return match client.list_events_by_time_range(&calendar, start, end).await {
            Ok(objects) => Json(
                objects
                    .iter()
                    .filter_map(|object| event_payload_from_object(object, &calendar))
                    .collect::<Vec<_>>(),
            )
            .into_response(),
            Err(error) => caldav_response(error),
        };
    }
    match state.storage.events(&calendar).await {
        Ok(events) => Json(events).into_response(),
        Err(error) => {
            tracing::error!(%error, "failed to load events from Postgres");
            json_error(StatusCode::INTERNAL_SERVER_ERROR, "Unable to load events")
        }
    }
}

async fn event_save(State(state): State<AppState>, headers: HeaderMap, Form(form): Form<HashMap<String, String>>) -> Response {
    let Ok((_, session)) = ajax_session_from(&headers, &state).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({}))).into_response();
    };
    if !valid_csrf(&session, &form) {
        return json_error(StatusCode::UNAUTHORIZED, "CSRF token not present");
    }
    let calendar = form.get("calendar").cloned().unwrap_or_else(|| DEFAULT_CALENDAR.to_string());
    let uid = form.get("uid").cloned().unwrap_or_else(|| Uuid::new_v4().to_string());
    let event = CalendarEvent {
        id: uid.clone(),
        uid: uid.clone(),
        title: form.get("summary").cloned().unwrap_or_else(|| "Untitled".to_string()),
        start: form.get("start").cloned().unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
        end: form.get("end").cloned().unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
        all_day: form.get("allday").is_some_and(|v| v == "true"),
        calendar: calendar.clone(),
        href: format!("{calendar}{uid}.ics"),
        etag: format!("\"{}\"", Uuid::new_v4()),
        editable: true,
        color: "#03A9F4".to_string(),
        location: form.get("location").cloned().unwrap_or_default(),
        description: form.get("description").cloned().unwrap_or_default(),
        timezone: form
            .get("timezone")
            .cloned()
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| session.preferences.timezone.clone()),
    };
    if let Ok((client, calendar_home_set)) = caldav_client_for_request(&state, &session).await {
        if !dav_href_in_scope(&calendar, &calendar_home_set) {
            return json_error(StatusCode::BAD_REQUEST, "Calendar href is outside the CalDAV home set");
        }
        let original_calendar = form.get("original_calendar").filter(|value| !value.is_empty());
        if let Some(original_calendar) = original_calendar {
            if !dav_href_in_scope(original_calendar, &calendar_home_set) {
                return json_error(StatusCode::BAD_REQUEST, "Original calendar href is outside the CalDAV home set");
            }
        }
        let href = form
            .get("href")
            .cloned()
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| format!("{}{}.ics", ensure_slash(&calendar), uid));
        let href_scope = original_calendar.unwrap_or(&calendar);
        if !dav_href_in_scope(&href, href_scope) {
            return json_error(StatusCode::BAD_REQUEST, "Event href is outside the selected calendar");
        }
        let etag = form.get("etag").map(String::as_str).filter(|value| !value.is_empty());
        let existing = if etag.is_some() || original_calendar.is_some_and(|source| source != &calendar) {
            match client.list_events_by_uid(original_calendar.unwrap_or(&calendar), &uid).await {
                Ok(objects) => objects
                    .into_iter()
                    .find(|object| object.url() == href || object.rendered_event().is_some()),
                Err(error) => return caldav_response(error),
            }
        } else {
            None
        };
        let icalendar = existing
            .as_ref()
            .and_then(|object| object.rendered_event())
            .map(|raw| merge_icalendar_from_event(raw, &event))
            .unwrap_or_else(|| icalendar_from_event(&event));
        let destination_href = if original_calendar.is_some_and(|source| source != &calendar) {
            format!("{}{}.ics", ensure_slash(&calendar), uid)
        } else {
            href.clone()
        };
        if !dav_href_in_scope(&destination_href, &calendar) {
            return json_error(StatusCode::BAD_REQUEST, "Destination href is outside the selected calendar");
        }
        let result = match client.put_event(&destination_href, icalendar, etag).await {
            Ok(result) => result,
            Err(error) => return caldav_response(error),
        };
        if original_calendar.is_some_and(|source| source != &calendar) {
            let Some(etag) = etag else {
                return json_error(StatusCode::BAD_REQUEST, "Event ETag is required");
            };
            if let Err(error) = client.delete_event(&href, Some(etag)).await {
                return caldav_response(error);
            }
            return Json(json!({"result": "SUCCESS", "message": [original_calendar.unwrap(), calendar], "href": result.href, "etag": result.etag})).into_response();
        }
        return Json(json!({"result": "SUCCESS", "message": [calendar], "href": result.href, "etag": result.etag})).into_response();
    }
    if let Err(error) = state.storage.upsert_event(&event).await {
        tracing::error!(%error, "failed to persist event to Postgres");
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "Unable to save event");
    }
    Json(json!({"result": "SUCCESS", "message": [calendar]})).into_response()
}

async fn event_delete(State(state): State<AppState>, headers: HeaderMap, Form(form): Form<HashMap<String, String>>) -> Response {
    let Ok((_, session)) = ajax_session_from(&headers, &state).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({}))).into_response();
    };
    if !valid_csrf(&session, &form) {
        return json_error(StatusCode::UNAUTHORIZED, "CSRF token not present");
    }
    let calendar = form.get("calendar").cloned().unwrap_or_else(|| DEFAULT_CALENDAR.to_string());
    if let Ok((client, calendar_home_set)) = caldav_client_for_request(&state, &session).await {
        if !dav_href_in_scope(&calendar, &calendar_home_set) {
            return json_error(StatusCode::BAD_REQUEST, "Calendar href is outside the CalDAV home set");
        }
        let Some(etag) = form.get("etag").map(String::as_str).filter(|value| !value.is_empty()) else {
            return json_error(StatusCode::BAD_REQUEST, "Event ETag is required");
        };
        let href = form
            .get("href")
            .cloned()
            .filter(|value| !value.is_empty())
            .or_else(|| form.get("uid").map(|uid| format!("{}{}.ics", ensure_slash(&calendar), uid)));
        let Some(href) = href else {
            return json_error(StatusCode::BAD_REQUEST, "Event href or uid is required");
        };
        if !dav_href_in_scope(&href, &calendar) {
            return json_error(StatusCode::BAD_REQUEST, "Event href is outside the selected calendar");
        }
        if let Some(recurrence_id) = form.get("recurrence_id").filter(|value| !value.is_empty()) {
            let uid = form.get("uid").cloned().unwrap_or_default();
            let objects = match client.list_events_by_uid(&calendar, &uid).await {
                Ok(objects) => objects,
                Err(error) => return caldav_response(error),
            };
            let Some(object) = objects.into_iter().find(|object| object.url() == href || object.rendered_event().is_some()) else {
                return json_error(StatusCode::NOT_FOUND, "Event not found");
            };
            let Some(data) = object.rendered_event() else {
                return json_error(StatusCode::BAD_GATEWAY, "Event data not returned");
            };
            let updated = add_recurrence_exdate(data, recurrence_id);
            return match client.put_event(&href, updated, Some(etag)).await {
                Ok(result) => Json(json!({"result": "SUCCESS", "message": [calendar], "href": result.href, "etag": result.etag})).into_response(),
                Err(error) => caldav_response(error),
            };
        }
        return match client.delete_event(&href, Some(etag)).await {
            Ok(()) => Json(json!({"result": "SUCCESS", "message": [calendar]})).into_response(),
            Err(error) => caldav_response(error),
        };
    }
    if let Some(uid) = form.get("uid") {
        if let Err(error) = state.storage.delete_event(&calendar, uid).await {
            tracing::error!(%error, "failed to delete event from Postgres");
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, "Unable to delete event");
        }
    }
    Json(json!({"result": "SUCCESS", "message": [calendar]})).into_response()
}

async fn event_drop(State(state): State<AppState>, headers: HeaderMap, Form(form): Form<HashMap<String, String>>) -> Response {
    event_alter(state, headers, form, false).await
}

async fn event_resize(State(state): State<AppState>, headers: HeaderMap, Form(form): Form<HashMap<String, String>>) -> Response {
    event_alter(state, headers, form, true).await
}

async fn event_alter(state: AppState, headers: HeaderMap, form: HashMap<String, String>, resize: bool) -> Response {
    let Ok((_, session)) = ajax_session_from(&headers, &state).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({}))).into_response();
    };
    if !valid_csrf(&session, &form) {
        return json_error(StatusCode::UNAUTHORIZED, "CSRF token not present");
    }
    if let Ok((client, calendar_home_set)) = caldav_client_for_request(&state, &session).await {
        let calendar = form.get("calendar").cloned().unwrap_or_else(|| DEFAULT_CALENDAR.to_string());
        if !dav_href_in_scope(&calendar, &calendar_home_set) {
            return json_error(StatusCode::BAD_REQUEST, "Calendar href is outside the CalDAV home set");
        }
        let uid = form.get("uid").cloned().unwrap_or_default();
        if !uid.is_empty() {
            match client.list_events_by_uid(&calendar, &uid).await {
                Ok(mut objects) => {
                    if let Some(object) = objects.pop() {
                        if let Some(mut event) = event_payload_from_object(&object, &calendar) {
                            apply_event_time_delta(&mut event, &form, resize);
                            let href = event.href.clone();
                            let etag = event.etag.clone();
                            if etag.is_empty() {
                                return json_error(StatusCode::BAD_REQUEST, "Event ETag is required");
                            }
                            let icalendar = object
                                .rendered_event()
                                .map(|raw| merge_icalendar_from_event(raw, &event))
                                .unwrap_or_else(|| icalendar_from_event(&event));
                            return match client.put_event(&href, icalendar, Some(&etag)).await {
                                Ok(_) => Json(json!({"result": "SUCCESS", "message": [calendar]})).into_response(),
                                Err(error) => caldav_response(error),
                            };
                        }
                    }
                }
                Err(error) => return caldav_response(error),
            }
        }
    }
    Json(json!({"result": "SUCCESS", "message": [form.get("calendar").cloned().unwrap_or_else(|| DEFAULT_CALENDAR.to_string())]})).into_response()
}

async fn event_base(State(state): State<AppState>, headers: HeaderMap, Query(query): Query<HashMap<String, String>>) -> Response {
    let Ok((_, session)) = ajax_session_from(&headers, &state).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({}))).into_response();
    };
    let calendar = query.get("calendar").cloned().unwrap_or_else(|| DEFAULT_CALENDAR.to_string());
    let uid = query.get("uid").cloned().unwrap_or_default();
    if let Ok((client, calendar_home_set)) = caldav_client_for_request(&state, &session).await {
        if !dav_href_in_scope(&calendar, &calendar_home_set) {
            return json_error(StatusCode::BAD_REQUEST, "Calendar href is outside the CalDAV home set");
        }
        match client.list_events_by_uid(&calendar, &uid).await {
            Ok(objects) => {
                if let Some(event) = objects.iter().find_map(|object| event_payload_from_object(object, &calendar)) {
                    return Json(event).into_response();
                }
                return json_error(StatusCode::NOT_FOUND, "Event not found");
            }
            Err(error) => return caldav_response(error),
        }
    }
    match state.storage.event(&calendar, &uid).await {
        Ok(Some(event)) => Json(event).into_response(),
        Ok(None) => json_error(StatusCode::NOT_FOUND, "Event not found"),
        Err(error) => {
            tracing::error!(%error, "failed to load event from Postgres");
            json_error(StatusCode::INTERNAL_SERVER_ERROR, "Unable to load event")
        }
    }
}

async fn cards_list(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Ok((_, session)) = ajax_session_from(&headers, &state).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({}))).into_response();
    };
    if let Ok((carddav, addressbook_home_set)) = carddav_client_for_request(&state, &session).await {
        let addressbooks = match carddav
            .ensure_addressbooks(Some(&addressbook_home_set), &session.displayname)
            .await
        {
            Ok(addressbooks) => addressbooks,
            Err(error) => return json_error(StatusCode::BAD_GATEWAY, &error.to_string()),
        };
        let contacts = match carddav.list_contacts(&addressbooks).await {
            Ok(contacts) => contacts,
            Err(error) => return json_error(StatusCode::BAD_GATEWAY, &error.to_string()),
        };
        let addressbook_payload = addressbooks
            .iter()
            .map(|addressbook| {
                json!({
                    "url": addressbook.url,
                    "displayname": addressbook.property(caldaver_core::carddav::AddressBook::DISPLAYNAME).unwrap_or("Default")
                })
            })
            .collect::<Vec<_>>();
        let selected_addressbook = addressbook_payload
            .first()
            .cloned()
            .unwrap_or_else(|| json!({"url": "/addressbooks/default/", "displayname": "Default"}));

        return Json(json!({
            "data": contacts.iter().map(contact_payload).collect::<Vec<_>>(),
            "addressbooks": addressbook_payload,
            "addressbook": selected_addressbook
        }))
        .into_response();
    }

    match state.storage.contacts(&session.username).await {
        Ok(contacts) => Json(json!({
            "data": contacts,
            "addressbooks": [{"url": "/addressbooks/default/", "displayname": "Default"}],
            "addressbook": {"url": "/addressbooks/default/", "displayname": "Default"}
        }))
        .into_response(),
        Err(error) => {
            tracing::error!(%error, "failed to load contacts from Postgres");
            json_error(StatusCode::INTERNAL_SERVER_ERROR, "Unable to load contacts")
        }
    }
}

async fn cards_save(State(state): State<AppState>, headers: HeaderMap, Form(form): Form<HashMap<String, String>>) -> Response {
    let Ok((_, session)) = ajax_session_from(&headers, &state).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({}))).into_response();
    };
    if !valid_csrf(&session, &form) {
        return json_error(StatusCode::UNAUTHORIZED, "CSRF token not present");
    }
    let input = contact_input_from_form(&form, None);
    if input.full_name.is_empty() {
        return json_error(StatusCode::BAD_REQUEST, "Full name is required");
    }
    if let Ok((carddav, _)) = carddav_client_for_request(&state, &session).await {
        return match carddav.create_contact(&input).await {
            Ok(contact) => Json(json!({"result": "SUCCESS", "data": contact_payload(&contact)})).into_response(),
            Err(error) => json_error(StatusCode::BAD_GATEWAY, &error.to_string()),
        };
    }

    let contact = local_contact_from_input(input, format!("/addressbooks/default/{}.vcf", Uuid::new_v4()));
    if let Err(error) = state.storage.upsert_contact(&session.username, &contact).await {
        tracing::error!(%error, "failed to save contact to Postgres");
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "Unable to save contact");
    }
    Json(json!({"result": "SUCCESS", "data": contact})).into_response()
}

async fn cards_update(State(state): State<AppState>, headers: HeaderMap, Form(form): Form<HashMap<String, String>>) -> Response {
    let Ok((_, session)) = ajax_session_from(&headers, &state).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({}))).into_response();
    };
    if !valid_csrf(&session, &form) {
        return json_error(StatusCode::UNAUTHORIZED, "CSRF token not present");
    }
    let Some(url) = form.get("url").map(|value| value.trim()).filter(|value| !value.is_empty()) else {
        return json_error(StatusCode::BAD_REQUEST, "Contact URL is required");
    };
    let input = contact_input_from_form(&form, Some(url));
    if input.full_name.is_empty() {
        return json_error(StatusCode::BAD_REQUEST, "Full name is required");
    }
    if let Ok((carddav, addressbook_home_set)) = carddav_client_for_request(&state, &session).await {
        if !dav_href_in_scope(url, &addressbook_home_set) {
            return json_error(StatusCode::BAD_REQUEST, "Contact href is outside the CardDAV home set");
        }
        return match carddav
            .update_contact(url, form.get("etag").map(String::as_str), &input)
            .await
        {
            Ok(contact) => Json(json!({"result": "SUCCESS", "data": contact_payload(&contact)})).into_response(),
            Err(error) => json_error(StatusCode::BAD_GATEWAY, &error.to_string()),
        };
    }

    let contact = local_contact_from_input(input, url.to_string());
    if let Err(error) = state.storage.upsert_contact(&session.username, &contact).await {
        tracing::error!(%error, "failed to update contact in Postgres");
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "Unable to update contact");
    }
    Json(json!({"result": "SUCCESS", "data": contact})).into_response()
}

async fn cards_delete(State(state): State<AppState>, headers: HeaderMap, Form(form): Form<HashMap<String, String>>) -> Response {
    let Ok((_, session)) = ajax_session_from(&headers, &state).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({}))).into_response();
    };
    if !valid_csrf(&session, &form) {
        return json_error(StatusCode::UNAUTHORIZED, "CSRF token not present");
    }
    if let Ok((carddav, addressbook_home_set)) = carddav_client_for_request(&state, &session).await {
        let Some(url) = form.get("url").filter(|value| !value.is_empty()) else {
            return json_error(StatusCode::BAD_REQUEST, "Contact URL is required");
        };
        if !dav_href_in_scope(url, &addressbook_home_set) {
            return json_error(StatusCode::BAD_REQUEST, "Contact href is outside the CardDAV home set");
        }
        return match carddav
            .delete_contact(url, form.get("etag").map(String::as_str))
            .await
        {
            Ok(()) => Json(json!({"result": "SUCCESS", "message": ""})).into_response(),
            Err(error) => json_error(StatusCode::BAD_GATEWAY, &error.to_string()),
        };
    }

    if let Some(url) = form.get("url") {
        if let Err(error) = state.storage.delete_contact(&session.username, url).await {
            tracing::error!(%error, "failed to delete contact from Postgres");
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, "Unable to delete contact");
        }
    }
    Json(json!({"result": "SUCCESS", "message": ""})).into_response()
}

fn contact_payload(contact: &CardDavContact) -> Value {
    let view = contact.view();
    json!({
        "full_name": view.full_name,
        "email": view.email,
        "phone": view.phone,
        "organization": view.organization,
        "job_title": view.job_title,
        "company_line": view.company_line,
        "labels": view.labels,
        "url": view.url,
        "etag": view.etag.unwrap_or_default(),
        "uid": view.uid,
        "initial": view.initial,
        "avatar_color": view.avatar_color
    })
}

fn contact_input_from_form(form: &HashMap<String, String>, url: Option<&str>) -> ContactInput {
    ContactInput {
        uid: form
            .get("uid")
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| url.and_then(uid_from_contact_url)),
        full_name: form
            .get("full_name")
            .map(|value| value.trim().to_string())
            .unwrap_or_default(),
        email: form
            .get("email")
            .map(|value| value.trim().to_string())
            .unwrap_or_default(),
        phone: form
            .get("phone")
            .map(|value| value.trim().to_string())
            .unwrap_or_default(),
        organization: form
            .get("organization")
            .map(|value| value.trim().to_string())
            .unwrap_or_default(),
        job_title: form
            .get("job_title")
            .map(|value| value.trim().to_string())
            .unwrap_or_default(),
    }
}

fn local_contact_from_input(input: ContactInput, url: String) -> Contact {
    Contact {
        full_name: input.full_name,
        email: input.email,
        phone: input.phone,
        organization: input.organization.clone(),
        job_title: input.job_title.clone(),
        company_line: [input.job_title, input.organization]
            .into_iter()
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
            .join(", "),
        labels: Vec::new(),
        url,
        etag: format!("\"{}\"", Uuid::new_v4()),
    }
}

fn uid_from_contact_url(url: &str) -> Option<String> {
    let file_name = url.rsplit('/').next().unwrap_or(url);
    file_name
        .strip_suffix(".vcf")
        .or(Some(file_name))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

async fn accounts(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Ok((_, session)) = ajax_session_from(&headers, &state).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({}))).into_response();
    };
    match connected_accounts(&state, &session).await {
        Ok(accounts) => Json(json!({"data": accounts})).into_response(),
        Err(error) => {
            tracing::error!(%error, "failed to load connected accounts from Postgres");
            json_error(StatusCode::INTERNAL_SERVER_ERROR, "Unable to load accounts")
        }
    }
}

async fn account_save(
    State(state): State<AppState>,
    headers: HeaderMap,
    Form(form): Form<HashMap<String, String>>,
) -> Response {
    let Ok((_, session)) = ajax_session_from(&headers, &state).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({}))).into_response();
    };
    if !valid_csrf(&session, &form) {
        return json_error(StatusCode::UNAUTHORIZED, "CSRF token not present");
    }
    match form.get("account_type").map(|value| value.trim()) {
        Some("email") => match persist_mail_account_from_form(&state, &session.username, &form).await {
            Ok(account) => Json(json!({"result": "SUCCESS", "data": connected_account_from_mail(&account)})).into_response(),
            Err(response) => response,
        },
        Some("calendar" | "carddav") => match persist_dav_account_from_form(&state, &session.username, &form).await {
            Ok(account) => Json(json!({"result": "SUCCESS", "data": connected_account_from_dav(&account)})).into_response(),
            Err(response) => response,
        },
        _ => json_error(StatusCode::BAD_REQUEST, "Choose Calendar, Contacts, or Email"),
    }
}

async fn connected_accounts(
    state: &AppState,
    session: &Session,
) -> Result<Vec<ConnectedAccountPublic>, crate::storage::StorageError> {
    let dav_accounts = state.storage.dav_accounts(&session.username).await?;
    let mail_accounts = state.storage.mail_accounts(&session.username).await?;

    let mut accounts = Vec::new();
    accounts.extend(dav_accounts.iter().map(connected_account_from_dav));
    accounts.extend(mail_accounts.iter().map(connected_account_from_mail));
    Ok(accounts)
}

fn connected_account_from_dav(account: &DavAccount) -> ConnectedAccountPublic {
    ConnectedAccountPublic {
        account_type: account.account_type.clone(),
        id: account.id.to_string(),
        label: account.label.clone(),
        identifier: account.username.clone(),
        server: account.server_url.clone(),
        auth_method: account.auth_method.clone(),
        username: account.username.clone(),
        email_address: String::new(),
        imap_host: String::new(),
        imap_port: 993,
        encryption: "ssl".to_string(),
        refresh_interval_seconds: 60,
        home_set: account.home_set.clone(),
        enabled: account.enabled,
        source: "postgres".to_string(),
        password_needs_reset: account.credential_needs_reset,
        last_error: account.last_error.clone(),
    }
}

fn connected_account_from_mail(account: &MailAccount) -> ConnectedAccountPublic {
    ConnectedAccountPublic {
        account_type: "email".to_string(),
        id: account.id.to_string(),
        label: account.label.clone(),
        identifier: account.email_address.clone(),
        server: format!("{}:{}", account.imap_host, account.imap_port),
        auth_method: String::new(),
        username: account.username.clone(),
        email_address: account.email_address.clone(),
        imap_host: account.imap_host.clone(),
        imap_port: account.imap_port,
        encryption: account.encryption.clone(),
        refresh_interval_seconds: account.refresh_interval_seconds,
        home_set: "IMAP".to_string(),
        enabled: true,
        source: "postgres".to_string(),
        password_needs_reset: account.password_needs_reset,
        last_error: String::new(),
    }
}

async fn persist_mail_account_from_form(
    state: &AppState,
    owner: &str,
    form: &HashMap<String, String>,
) -> Result<MailAccount, Response> {
    for field in ["label", "email_address", "imap_host", "username"] {
        if form.get(field).is_none_or(|value| value.trim().is_empty()) {
            return Err(json_error(StatusCode::BAD_REQUEST, "Required mail account fields are missing"));
        }
    }
    let id = form.get("id").and_then(|v| v.parse().ok()).unwrap_or(0);
    if id == 0 && form.get("password").is_none_or(|value| value.trim().is_empty()) {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            "A password is required for new mail accounts",
        ));
    }
    let password_sealed = if id != 0 && form.get("password").is_none_or(|value| value.trim().is_empty()) {
        match state.storage.mail_account(owner, id).await {
            Ok(Some(existing)) => existing.password_sealed,
            Ok(None) => return Err(json_error(StatusCode::NOT_FOUND, "Mail account not found")),
            Err(error) => {
                tracing::error!(%error, "failed to load existing mail account from Postgres");
                return Err(json_error(StatusCode::INTERNAL_SERVER_ERROR, "Unable to save mail account"));
            }
        }
    } else {
        match SealedPassword::seal(&form.get("password").cloned().unwrap_or_default()) {
            Ok(password) => password,
            Err(error) => return Err(mail_backend_response(error)),
        }
    };
    let account = MailAccount {
        id,
        label: limited_field(form, "label", 120),
        email_address: limited_field(form, "email_address", 254),
        imap_host: limited_field(form, "imap_host", 253),
        imap_port: form.get("imap_port").and_then(|v| v.parse().ok()).unwrap_or(993),
        encryption: limited_field_default(form, "encryption", 16, "ssl"),
        username: limited_field(form, "username", 254),
        password_sealed,
        password_needs_reset: false,
        refresh_interval_seconds: form
            .get("refresh_interval_minutes")
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(1)
            .clamp(1, 1440)
            * 60,
    };
    if let Err(error) = imap_backend::validate_account(&account) {
        return Err(mail_backend_response(error));
    }
    state.storage.save_mail_account(owner, &account).await.map_err(|error| match error {
        crate::storage::StorageError::NotFound => json_error(StatusCode::NOT_FOUND, "Mail account not found"),
        error => {
            tracing::error!(%error, "failed to save mail account to Postgres");
            json_error(StatusCode::INTERNAL_SERVER_ERROR, "Unable to save mail account")
        }
    })
}

async fn persist_dav_account_from_form(
    state: &AppState,
    owner: &str,
    form: &HashMap<String, String>,
) -> Result<DavAccount, Response> {
    let account_type = limited_field(form, "account_type", 16);
    if account_type != "calendar" && account_type != "carddav" {
        return Err(json_error(StatusCode::BAD_REQUEST, "Choose Calendar or Contacts"));
    }
    for field in ["label", "server_url", "username"] {
        if form.get(field).is_none_or(|value| value.trim().is_empty()) {
            return Err(json_error(StatusCode::BAD_REQUEST, "Required account fields are missing"));
        }
    }
    let id = form.get("id").and_then(|v| v.parse().ok()).unwrap_or(0);
    let auth_method = limited_field_default(form, "auth_method", 16, "basic");
    if !matches!(auth_method.as_str(), "basic" | "bearer" | "none") {
        return Err(json_error(StatusCode::BAD_REQUEST, "Unsupported authentication method"));
    }
    if id == 0 && auth_method != "none" && form.get("password").is_none_or(|value| value.trim().is_empty()) {
        return Err(json_error(StatusCode::BAD_REQUEST, "A password or token is required"));
    }
    let server_url = validated_dav_server_url(
        &limited_field(form, "server_url", 2048),
        &allowed_dav_hosts(&state.config),
    )?;
    let home_set = limited_field(form, "home_set", 512);
    if !home_set.is_empty() && !home_set.starts_with('/') {
        return Err(json_error(StatusCode::BAD_REQUEST, "Home set must start with /"));
    }
    let credential_sealed = if id != 0 && form.get("password").is_none_or(|value| value.trim().is_empty()) {
        match state.storage.dav_account_by_id(owner, id).await {
            Ok(Some(existing)) if existing.account_type == account_type => existing.credential_sealed,
            Ok(Some(_)) => return Err(json_error(StatusCode::BAD_REQUEST, "Account type cannot be changed")),
            Ok(None) => return Err(json_error(StatusCode::NOT_FOUND, "Account not found")),
            Err(error) => {
                tracing::error!(%error, "failed to load existing DAV account from Postgres");
                return Err(json_error(StatusCode::INTERNAL_SERVER_ERROR, "Unable to save account"));
            }
        }
    } else {
        match SealedPassword::seal(&form.get("password").cloned().unwrap_or_default()) {
            Ok(password) => password,
            Err(error) => return Err(mail_backend_response(error)),
        }
    };
    let account = DavAccount {
        id,
        account_type,
        label: limited_field(form, "label", 120),
        server_url,
        auth_method,
        username: limited_field(form, "username", 254),
        credential_sealed,
        credential_needs_reset: false,
        principal_url: String::new(),
        home_set,
        enabled: true,
        last_error: String::new(),
    };
    state.storage.save_dav_account(owner, &account).await.map_err(|error| match error {
        crate::storage::StorageError::NotFound => json_error(StatusCode::NOT_FOUND, "Account not found"),
        error => {
            tracing::error!(%error, "failed to save DAV account to Postgres");
            json_error(StatusCode::INTERNAL_SERVER_ERROR, "Unable to save account")
        }
    })
}

/// Hosts that bypass the IP-block check in [`validated_dav_server_url`]: the hosts of the
/// admin-configured CalDAV/CardDAV servers plus any extra hosts from
/// `CALDAVER_DAV_HOST_ALLOWLIST`. In homelab deployments the configured DAV server often
/// resolves to a private address that the SSRF guard would otherwise reject.
fn allowed_dav_hosts(config: &Config) -> Vec<String> {
    let mut hosts: Vec<String> = config
        .dav_host_allowlist
        .iter()
        .map(|host| host.to_ascii_lowercase())
        .collect();
    for server in [&config.caldav_server, &config.carddav_server] {
        // The configured value may contain a `%u` username placeholder (normally in the
        // path, not the host); if it does not parse as a URL, just skip it.
        if let Some(host) = Url::parse(server)
            .ok()
            .and_then(|url| url.host_str().map(|host| host.to_ascii_lowercase()))
        {
            hosts.push(host);
        }
    }
    hosts
}

fn validated_dav_server_url(value: &str, allowed_hosts: &[String]) -> Result<String, Response> {
    let url = Url::parse(value).map_err(|_| json_error(StatusCode::BAD_REQUEST, "Server URL is invalid"))?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return Err(json_error(StatusCode::BAD_REQUEST, "Server URL must use http or https"));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(json_error(StatusCode::BAD_REQUEST, "Server URL must not include credentials"));
    }
    let Some(host) = url.host_str() else {
        return Err(json_error(StatusCode::BAD_REQUEST, "Server URL must include a host"));
    };
    if allowed_hosts.iter().any(|allowed| host.eq_ignore_ascii_case(allowed)) {
        return Ok(url.to_string());
    }
    if host.eq_ignore_ascii_case("localhost") || host.ends_with(".localhost") {
        return Err(json_error(StatusCode::BAD_REQUEST, "Server URL host is not allowed"));
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        let blocked = match ip {
            IpAddr::V4(ip) => blocked_ipv4(ip),
            IpAddr::V6(ip) => blocked_ipv6(ip),
        };
        if blocked {
            return Err(json_error(StatusCode::BAD_REQUEST, "Server URL host is not allowed"));
        }
    } else {
        let port = url.port_or_known_default().unwrap_or(443);
        let addresses = (host, port)
            .to_socket_addrs()
            .map_err(|_| json_error(StatusCode::BAD_REQUEST, "Server URL host did not resolve"))?;
        for address in addresses {
            let blocked = match address.ip() {
                IpAddr::V4(ip) => blocked_ipv4(ip),
                IpAddr::V6(ip) => blocked_ipv6(ip),
            };
            if blocked {
                return Err(json_error(StatusCode::BAD_REQUEST, "Server URL host is not allowed"));
            }
        }
    }
    Ok(url.to_string())
}

fn limited_field(form: &HashMap<String, String>, name: &str, max_chars: usize) -> String {
    form.get(name)
        .map(|value| value.trim().chars().take(max_chars).collect())
        .unwrap_or_default()
}

fn limited_field_default(
    form: &HashMap<String, String>,
    name: &str,
    max_chars: usize,
    default: &str,
) -> String {
    let value = limited_field(form, name, max_chars);
    if value.is_empty() {
        default.to_string()
    } else {
        value
    }
}

async fn mail_accounts(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Ok((_, session)) = ajax_session_from(&headers, &state).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({}))).into_response();
    };
    match state.storage.mail_accounts(&session.username).await {
        Ok(accounts) => {
            let accounts = accounts
                .iter()
                .map(MailAccountPublic::from)
                .collect::<Vec<_>>();
            Json(json!({"data": accounts})).into_response()
        }
        Err(error) => {
            tracing::error!(%error, "failed to load mail accounts from Postgres");
            json_error(StatusCode::INTERNAL_SERVER_ERROR, "Unable to load mail accounts")
        }
    }
}

async fn mail_account_save(State(state): State<AppState>, headers: HeaderMap, Form(form): Form<HashMap<String, String>>) -> Response {
    let Ok((_, session)) = ajax_session_from(&headers, &state).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({}))).into_response();
    };
    if !valid_csrf(&session, &form) {
        return json_error(StatusCode::UNAUTHORIZED, "CSRF token not present");
    }
    match persist_mail_account_from_form(&state, &session.username, &form).await {
        Ok(account) => Json(json!({"result": "SUCCESS", "data": MailAccountPublic::from(&account)})).into_response(),
        Err(response) => response,
    }
}

async fn mail_messages(State(state): State<AppState>, headers: HeaderMap, Query(query): Query<HashMap<String, String>>) -> Response {
    mail_messages_payload(state, headers, query, true).await
}

async fn mail_messages_sync(State(state): State<AppState>, headers: HeaderMap, Query(query): Query<HashMap<String, String>>) -> Response {
    mail_messages_payload(state, headers, query, false).await
}

async fn mail_messages_payload(state: AppState, headers: HeaderMap, query: HashMap<String, String>, cached: bool) -> Response {
    let Ok((_, session)) = ajax_session_from(&headers, &state).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({}))).into_response();
    };
    let account_id = query.get("account_id").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
    let account = match mail_account_for(&state, &session.username, account_id).await {
        Ok(account) => account,
        Err(response) => return response,
    };
    if cached {
        return match state.storage.cached_messages(&session.username, account_id).await {
            Ok(messages) => Json(json!({"result": "SUCCESS", "data": messages, "cached": true})).into_response(),
            Err(error) => {
                tracing::error!(%error, "failed to load mail cache from Postgres");
                json_error(StatusCode::INTERNAL_SERVER_ERROR, "Unable to load messages")
            }
        };
    }

    let messages = match run_mail_backend(state.mail_backend.clone(), account, |backend, account| {
        backend.fetch_inbox_overview(account)
    })
    .await
    {
        Ok(messages) => messages,
        Err(error) => return mail_backend_response(error),
    };
    if let Err(error) = state
        .storage
        .replace_message_cache(&session.username, account_id, &messages)
        .await
    {
        tracing::error!(%error, "failed to cache synced mail in Postgres");
    }
    Json(json!({"result": "SUCCESS", "data": messages, "cached": false})).into_response()
}

async fn mail_message(State(state): State<AppState>, headers: HeaderMap, Query(query): Query<HashMap<String, String>>) -> Response {
    let Ok((_, session)) = ajax_session_from(&headers, &state).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({}))).into_response();
    };
    let account_id = query.get("account_id").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
    let uid = query.get("uid").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
    let account = match mail_account_for(&state, &session.username, account_id).await {
        Ok(account) => account,
        Err(response) => return response,
    };
    let mut message = match run_mail_backend(state.mail_backend.clone(), account, move |backend, account| {
        let message = backend.fetch_message(account, uid)?;
        backend.mark_seen(account, uid, true)?;
        Ok(message)
    })
    .await
    {
        Ok(message) => message,
        Err(error) => return mail_backend_response(error),
    };
    message.seen = true;
    if let Err(error) = state.storage.cache_message(&session.username, account_id, &message).await {
        tracing::error!(%error, "failed to cache fetched mail message in Postgres");
    }
    Json(json!({"result": "SUCCESS", "data": message})).into_response()
}

async fn mail_message_navigation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let Ok((_, session)) = ajax_session_from(&headers, &state).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({}))).into_response();
    };
    let account_id = query.get("account_id").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
    let uid = query.get("uid").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
    let account = match mail_account_for(&state, &session.username, account_id).await {
        Ok(account) => account,
        Err(response) => return response,
    };
    match run_mail_backend(state.mail_backend.clone(), account, move |backend, account| {
        backend.fetch_message_navigation(account, uid)
    })
    .await
    {
        Ok(navigation) => Json(json!({"result": "SUCCESS", "data": navigation})).into_response(),
        Err(error) => mail_backend_response(error),
    }
}

async fn mail_mark_unread(State(state): State<AppState>, headers: HeaderMap, Form(form): Form<HashMap<String, String>>) -> Response {
    let Ok((_, session)) = ajax_session_from(&headers, &state).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({}))).into_response();
    };
    if !valid_csrf(&session, &form) {
        return json_error(StatusCode::UNAUTHORIZED, "CSRF token not present");
    }
    let account_id = form.get("account_id").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
    let uid = form.get("uid").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
    let account = match mail_account_for(&state, &session.username, account_id).await {
        Ok(account) => account,
        Err(response) => return response,
    };
    if let Err(error) = run_mail_backend(state.mail_backend.clone(), account, move |backend, account| {
        backend.mark_seen(account, uid, false)
    })
    .await
    {
        return mail_backend_response(error);
    }
    if let Err(error) = state
        .storage
        .mark_cached_seen(&session.username, account_id, uid, false)
        .await
    {
        tracing::error!(%error, "failed to mark cached message unread in Postgres");
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "Unable to update message");
    }
    Json(json!({"result": "SUCCESS", "data": {"uid": uid, "seen": false}})).into_response()
}

async fn mail_attachment(State(state): State<AppState>, headers: HeaderMap, Query(query): Query<HashMap<String, String>>) -> Response {
    let Ok((_, session)) = ajax_session_from(&headers, &state).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({}))).into_response();
    };
    let account_id = query.get("account_id").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
    let uid = query.get("uid").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
    let part = query.get("part").cloned().unwrap_or_default();
    let account = match mail_account_for(&state, &session.username, account_id).await {
        Ok(account) => account,
        Err(response) => return response,
    };
    let download = match run_mail_backend(state.mail_backend.clone(), account, move |backend, account| {
        backend.download_attachment(account, uid, &part)
    })
    .await
    {
        Ok(download) => download,
        Err(error) => return mail_backend_response(error),
    };
    let content_length = download.bytes.len().to_string();
    let mut response = (StatusCode::OK, download.bytes).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&download.content_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename=\"{}\"", download.filename))
            .unwrap_or_else(|_| HeaderValue::from_static("attachment")),
    );
    headers.insert(
        header::CONTENT_LENGTH,
        HeaderValue::from_str(&content_length).unwrap_or_else(|_| HeaderValue::from_static("0")),
    );
    headers.insert("x-content-type-options", HeaderValue::from_static("nosniff"));
    response
}

async fn mail_image(State(state): State<AppState>, headers: HeaderMap, Query(query): Query<HashMap<String, String>>) -> Response {
    let Ok((_, session)) = ajax_session_from(&headers, &state).await else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let account_id = query.get("account_id").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
    let image_url = query.get("url").cloned().unwrap_or_default();
    if query.get("_token").is_none_or(|token| token != &session.csrf) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Ok(url) = reqwest::Url::parse(&image_url) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if !mail_image_url_allowed(&url) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    if mail_account_for(&state, &session.username, account_id).await.is_err() {
        return StatusCode::NOT_FOUND.into_response();
    }

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::none())
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            tracing::error!(%error, "failed to build mail image proxy client");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    let remote = match client
        .get(url)
        .header("accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8")
        .header("user-agent", "Caldaver mail image proxy")
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!(%error, "failed to fetch proxied mail image");
            return StatusCode::BAD_GATEWAY.into_response();
        }
    };
    if !remote.status().is_success() {
        return StatusCode::BAD_GATEWAY.into_response();
    }
    let content_type = remote
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    if !content_type.to_ascii_lowercase().starts_with("image/") {
        return StatusCode::BAD_GATEWAY.into_response();
    }
    if remote.content_length().is_some_and(|length| length > 15 * 1024 * 1024) {
        return StatusCode::PAYLOAD_TOO_LARGE.into_response();
    }
    let bytes = match remote.bytes().await {
        Ok(bytes) if bytes.len() <= 15 * 1024 * 1024 => bytes,
        Ok(_) => return StatusCode::PAYLOAD_TOO_LARGE.into_response(),
        Err(error) => {
            tracing::warn!(%error, "failed to read proxied mail image body");
            return StatusCode::BAD_GATEWAY.into_response();
        }
    };

    let mut response = (StatusCode::OK, bytes.to_vec()).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&content_type).unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("private, max-age=86400"));
    headers.insert("x-content-type-options", HeaderValue::from_static("nosniff"));
    response
}

fn mail_image_url_allowed(url: &reqwest::Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".localhost") {
        return false;
    }
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => !blocked_ipv4(ip),
        Ok(IpAddr::V6(ip)) => !blocked_ipv6(ip),
        Err(_) => true,
    }
}

fn blocked_ipv4(ip: Ipv4Addr) -> bool {
    ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_unspecified()
        || ip.is_multicast()
}

fn blocked_ipv6(ip: Ipv6Addr) -> bool {
    ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_unique_local()
        || ip.is_unicast_link_local()
        || ip.is_multicast()
}

async fn principals(Query(query): Query<HashMap<String, String>>) -> Json<Value> {
    let term = query.get("term").cloned().unwrap_or_default();
    if term.trim().is_empty() {
        return Json(json!([]));
    }
    Json(json!([{"label": term, "value": term, "url": term}]))
}

async fn jssettings(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Ok((_, session)) = ajax_session_from(&headers, &state).await else {
        return (StatusCode::UNAUTHORIZED, "").into_response();
    };
    let body = format!(
        "var CaldaverConf = {};\n\nvar CaldaverUserPrefs = {};\n\nfunction set_default_colorpicker_options() {{ $.fn.colorPicker.defaultColors = CaldaverConf.calendar_colors; }}\n",
        site_config_json(&state),
        serde_json::to_string(&session.preferences).unwrap()
    );
    (
        [(header::CONTENT_TYPE, "application/javascript; charset=utf-8")],
        body,
    )
        .into_response()
}

fn site_config_json(state: &AppState) -> String {
    json!({
        "title": state.config.title,
        "base_url": "/",
        "base_app_url": "/",
        "show_public_caldav_url": true,
        "caldav_public_base_url": state.config.caldav_public_url,
        "enable_calendar_sharing": state.config.calendar_sharing,
        "default_calendar_color": "#03A9F4",
        "calendar_colors": ["03A9F4","3F51B5","F44336","4CAF50","FFC107","9E9E9E"],
        "available_timezones": available_timezones()
    })
    .to_string()
}

fn available_timezones() -> Vec<&'static str> {
    vec![
        DEFAULT_TIMEZONE,
        "UTC",
        "America/New_York",
        "America/Chicago",
        "America/Denver",
        "America/Phoenix",
        "America/Anchorage",
        "Pacific/Honolulu",
        "Europe/London",
        "Europe/Paris",
        "Asia/Tokyo",
        "Australia/Sydney",
    ]
}

fn json_error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"result": "ERROR", "message": message}))).into_response()
}

fn caldav_response(error: CalDavError) -> Response {
    let status = match error {
        CalDavError::MissingCapability(_) => StatusCode::UNAUTHORIZED,
        CalDavError::MissingProperty(_) => StatusCode::BAD_GATEWAY,
        CalDavError::InvalidBaseUrl(_)
        | CalDavError::InvalidDavHref(_)
        | CalDavError::InvalidCalendarProperty(_)
        | CalDavError::Header(_) => StatusCode::BAD_REQUEST,
        CalDavError::UnexpectedStatus { status, .. } if status == StatusCode::UNAUTHORIZED => {
            StatusCode::UNAUTHORIZED
        }
        CalDavError::UnexpectedStatus { status, .. } if status == StatusCode::FORBIDDEN => {
            StatusCode::FORBIDDEN
        }
        CalDavError::UnexpectedStatus { .. } | CalDavError::Http(_) | CalDavError::Xml(_) => {
            StatusCode::BAD_GATEWAY
        }
    };
    json_error(status, &error.to_string())
}

async fn caldav_client_for_request(
    state: &AppState,
    session: &Session,
) -> Result<(CalDavClient, String), CalDavError> {
    match state.storage.dav_account(&session.username, "calendar").await {
        Ok(Some(account)) => {
            let mut dav_config = CalDavConfig::from_app_config(&state.config);
            dav_config.base_url = account.server_url.clone();
            dav_config.auth = dav_auth_for_account(&account).map_err(CalDavError::InvalidBaseUrl)?;
            let client = CalDavClient::new(dav_config)?;
            let home_set = if account.home_set.is_empty() {
                client.login().await?.calendar_home_set
            } else {
                account.home_set.clone()
            };
            return Ok((client, home_set));
        }
        Ok(None) => {
            return Err(CalDavError::InvalidBaseUrl(
                "No CalDAV account is saved in Postgres".to_string(),
            ));
        }
        Err(error) => {
            tracing::warn!(%error, user = %session.username, "failed to load stored CalDAV account");
            return Err(CalDavError::InvalidBaseUrl(
                "Unable to load saved CalDAV account from Postgres".to_string(),
            ));
        }
    }
}

async fn carddav_client_for_request(
    state: &AppState,
    session: &Session,
) -> Result<(CardDavClient, String), carddav_backend::CardDavError> {
    match state.storage.dav_account(&session.username, "carddav").await {
        Ok(Some(account)) => {
            let client = CardDavClient::new(CardDavConfig {
                base_url: account.server_url.clone(),
                auth: dav_auth_for_account(&account).map_err(carddav_backend::CardDavError::InvalidBaseUrl)?,
            })?;
            let home_set = if account.home_set.is_empty() {
                client.discover_addressbook_home_set().await?
            } else {
                account.home_set.clone()
            };
            return Ok((client, home_set));
        }
        Ok(None) => {
            return Err(carddav_backend::CardDavError::InvalidBaseUrl(
                "No CardDAV account is saved in Postgres".to_string(),
            ));
        }
        Err(error) => {
            tracing::warn!(%error, user = %session.username, "failed to load stored CardDAV account");
            return Err(carddav_backend::CardDavError::InvalidBaseUrl(
                "Unable to load saved CardDAV account from Postgres".to_string(),
            ));
        }
    }
}

fn dav_auth_for_account(account: &DavAccount) -> Result<CalDavAuth, String> {
    let credential = account
        .credential_sealed
        .reveal()
        .map_err(|error| format!("Unable to open stored DAV credential: {error}"))?;
    Ok(match account.auth_method.to_ascii_lowercase().as_str() {
        "none" => CalDavAuth::None,
        "bearer" => CalDavAuth::Bearer(credential),
        _ => CalDavAuth::Basic {
            username: account.username.clone(),
            password: credential,
        },
    })
}

async fn discover_login_dav_homes(config: &Config, session: &Session) -> Result<BootstrapDavHomes, CalDavError> {
    let client = caldav_client_for_session(config, session)?;
    let dav_session = client.login().await?;
    let addressbook_home_set = match carddav_client_for_session(config, session) {
        Ok(carddav) => carddav.discover_addressbook_home_set().await.unwrap_or_default(),
        Err(_) => String::new(),
    };
    Ok(BootstrapDavHomes {
        principal_url: dav_session.principal_url,
        calendar_home_set: dav_session.calendar_home_set,
        addressbook_home_set,
    })
}

fn caldav_client_for_session(config: &Config, session: &Session) -> Result<CalDavClient, CalDavError> {
    let mut dav_config = CalDavConfig::from_app_config(config);
    dav_config.base_url = substitute_dav_username(&config.caldav_server, &session.dav_username);
    dav_config.auth = match config.caldav_auth_method.to_ascii_lowercase().as_str() {
        "none" => CalDavAuth::None,
        "bearer" => CalDavAuth::Bearer(session.dav_password.clone()),
        _ => CalDavAuth::Basic {
            username: session.dav_username.clone(),
            password: session.dav_password.clone(),
        },
    };
    CalDavClient::new(dav_config)
}

fn carddav_client_for_session(
    config: &Config,
    session: &Session,
) -> Result<CardDavClient, carddav_backend::CardDavError> {
    let auth = match config.caldav_auth_method.to_ascii_lowercase().as_str() {
        "none" => CalDavAuth::None,
        "bearer" => CalDavAuth::Bearer(session.dav_password.clone()),
        _ => CalDavAuth::Basic {
            username: session.dav_username.clone(),
            password: session.dav_password.clone(),
        },
    };
    CardDavClient::new(CardDavConfig {
        base_url: substitute_dav_username(&config.carddav_server, &session.dav_username),
        auth,
    })
}

fn substitute_dav_username(url: &str, username: &str) -> String {
    url.replace("%u", &urlencoding::encode(username))
}

fn mail_javascript_disabled(session: &Session, query: &HashMap<String, String>) -> bool {
    session.preferences.disable_javascript
        || query
            .get("nojs")
            .is_some_and(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
}

fn calendar_payload(calendar: &CoreCalendar) -> Value {
    let owner = calendar
        .owner()
        .map(|owner| owner.display_name().to_string())
        .unwrap_or_default();
    json!({
        "calendar": calendar.url(),
        "url": calendar.url(),
        "displayname": calendar.property(CoreCalendar::DISPLAYNAME).unwrap_or("Calendar"),
        "color": calendar.property(CoreCalendar::COLOR).unwrap_or("#03A9F4ff"),
        "fg": "#000000",
        "is_owned": calendar.owner().is_none(),
        "is_shared": calendar.owner().is_some(),
        "writable": calendar.is_writable(),
        "owner": owner,
        "shares": []
    })
}

fn calendar_properties(displayname: &str, color: &str) -> Vec<XmlProperty> {
    vec![
        XmlProperty::text(CoreCalendar::DISPLAYNAME, displayname),
        XmlProperty::text(CoreCalendar::COLOR, color),
    ]
}

fn new_calendar_url(home_set: &str, _displayname: &str) -> String {
    format!("{}{}/", ensure_slash(home_set), Uuid::new_v4())
}

fn event_payload_from_object(object: &CalendarObject, calendar: &str) -> Option<CalendarEvent> {
    let data = object.rendered_event()?;
    let uid = ical_property(data, "UID").unwrap_or_else(|| {
        object
            .url()
            .rsplit('/')
            .next()
            .unwrap_or(object.url())
            .trim_end_matches(".ics")
            .to_string()
    });
    Some(CalendarEvent {
        id: uid.clone(),
        uid,
        title: ical_property(data, "SUMMARY").unwrap_or_else(|| "(No title)".to_string()),
        start: ical_property(data, "DTSTART")
            .map(|value| ical_datetime_to_iso(&value))
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
        end: ical_property(data, "DTEND")
            .map(|value| ical_datetime_to_iso(&value))
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
        all_day: ical_property(data, "DTSTART").is_some_and(|value| value.len() == 8),
        calendar: calendar.to_string(),
        href: object.url().to_string(),
        etag: object.etag().unwrap_or_default().to_string(),
        editable: true,
        color: "#03A9F4".to_string(),
        location: ical_property(data, "LOCATION").unwrap_or_default(),
        description: ical_property(data, "DESCRIPTION").unwrap_or_default(),
        timezone: ical_property_parameter(data, "DTSTART", "TZID")
            .filter(|value| !value.is_empty())
            .unwrap_or_else(default_timezone),
    })
}

fn ical_property(data: &str, name: &str) -> Option<String> {
    let unfolded = data
        .replace("\r\n ", "")
        .replace("\r\n\t", "")
        .replace("\n ", "")
        .replace("\n\t", "");
    let has_vevent = unfolded
        .lines()
        .any(|line| line.trim().eq_ignore_ascii_case("BEGIN:VEVENT"));
    let mut in_vevent = false;
    unfolded.lines().find_map(|line| {
        let trimmed = line.trim();
        if trimmed.eq_ignore_ascii_case("BEGIN:VEVENT") {
            in_vevent = true;
            return None;
        }
        if trimmed.eq_ignore_ascii_case("END:VEVENT") && in_vevent {
            in_vevent = false;
            return None;
        }
        if has_vevent && !in_vevent {
            return None;
        }

        let (key, value) = line.split_once(':')?;
        let key = key.split(';').next().unwrap_or(key);
        (key.eq_ignore_ascii_case(name)).then(|| unescape_ical(value))
    })
}

fn ical_property_parameter(data: &str, name: &str, parameter: &str) -> Option<String> {
    let unfolded = data
        .replace("\r\n ", "")
        .replace("\r\n\t", "")
        .replace("\n ", "")
        .replace("\n\t", "");
    let has_vevent = unfolded
        .lines()
        .any(|line| line.trim().eq_ignore_ascii_case("BEGIN:VEVENT"));
    let mut in_vevent = false;
    unfolded.lines().find_map(|line| {
        let trimmed = line.trim();
        if trimmed.eq_ignore_ascii_case("BEGIN:VEVENT") {
            in_vevent = true;
            return None;
        }
        if trimmed.eq_ignore_ascii_case("END:VEVENT") && in_vevent {
            in_vevent = false;
            return None;
        }
        if has_vevent && !in_vevent {
            return None;
        }

        let (key, _) = line.split_once(':')?;
        let mut parts = key.split(';');
        let property = parts.next().unwrap_or(key);
        if !property.eq_ignore_ascii_case(name) {
            return None;
        }

        parts.find_map(|part| {
            let (param_name, param_value) = part.split_once('=')?;
            param_name
                .eq_ignore_ascii_case(parameter)
                .then(|| param_value.trim_matches('"').to_string())
        })
    })
}

fn ical_datetime_to_iso(value: &str) -> String {
    let value = value.trim();
    if value.len() == 8 {
        return format!("{}-{}-{}", &value[0..4], &value[4..6], &value[6..8]);
    }
    if value.len() >= 15 {
        return format!(
            "{}-{}-{}T{}:{}:{}Z",
            &value[0..4],
            &value[4..6],
            &value[6..8],
            &value[9..11],
            &value[11..13],
            &value[13..15]
        );
    }
    value.to_string()
}

fn icalendar_from_event(event: &CalendarEvent) -> String {
    let (dtstart_name, dtstart, dtend_name, dtend) = event_datetime_properties(event);
    format!(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Caldaver//Rust//EN\r\nBEGIN:VEVENT\r\nUID:{}\r\nSUMMARY:{}\r\n{}:{}\r\n{}:{}\r\nLOCATION:{}\r\nDESCRIPTION:{}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
        escape_ical(&event.uid),
        escape_ical(&event.title),
        dtstart_name,
        dtstart,
        dtend_name,
        dtend,
        escape_ical(&event.location),
        escape_ical(&event.description)
    )
}

fn merge_icalendar_from_event(existing: &str, event: &CalendarEvent) -> String {
    let (dtstart_name, dtstart, dtend_name, dtend) = event_datetime_properties(event);
    let replacements = [
        ("UID", "UID".to_string(), escape_ical(&event.uid)),
        ("SUMMARY", "SUMMARY".to_string(), escape_ical(&event.title)),
        ("DTSTART", dtstart_name, dtstart),
        ("DTEND", dtend_name, dtend),
        ("LOCATION", "LOCATION".to_string(), escape_ical(&event.location)),
        ("DESCRIPTION", "DESCRIPTION".to_string(), escape_ical(&event.description)),
    ];
    replace_vevent_properties(existing, &replacements)
}

fn add_recurrence_exdate(existing: &str, recurrence_id: &str) -> String {
    let value = if recurrence_id.len() == 10 && recurrence_id.as_bytes().get(4) == Some(&b'-') {
        caldav_date(recurrence_id)
    } else {
        caldav_datetime(recurrence_id)
    };
    insert_vevent_line(existing, &format!("EXDATE:{value}"))
}

fn replace_vevent_properties(existing: &str, replacements: &[(&str, String, String)]) -> String {
    let mut seen = vec![false; replacements.len()];
    let mut output = Vec::new();
    let mut in_vevent = false;
    let mut vevent_depth = 0usize;
    for line in existing.replace("\r\n", "\n").lines() {
        if line.eq_ignore_ascii_case("BEGIN:VEVENT") {
            seen.fill(false);
            in_vevent = true;
            vevent_depth = 1;
            output.push(line.to_string());
            continue;
        }

        if in_vevent && line.to_ascii_uppercase().starts_with("BEGIN:") {
            vevent_depth += 1;
            output.push(line.to_string());
            continue;
        }

        if in_vevent && line.eq_ignore_ascii_case("END:VEVENT") && vevent_depth == 1 {
            for (index, (_, replacement_name, value)) in replacements.iter().enumerate() {
                if !seen[index] {
                    output.push(format!("{replacement_name}:{value}"));
                }
            }
            output.push(line.to_string());
            in_vevent = false;
            vevent_depth = 0;
            continue;
        }

        if in_vevent && line.to_ascii_uppercase().starts_with("END:") && vevent_depth > 1 {
            vevent_depth -= 1;
            output.push(line.to_string());
            continue;
        }

        let property = line
            .split_once(':')
            .map(|(name, _)| name.split(';').next().unwrap_or(name))
            .unwrap_or(line);
        let replacement_index = if in_vevent && vevent_depth == 1 {
            replacements
                .iter()
                .position(|(name, _, _)| property.eq_ignore_ascii_case(name))
        } else {
            None
        };
        if let Some(index) = replacement_index {
            let (_, replacement_name, value) = &replacements[index];
            output.push(format!("{replacement_name}:{value}"));
            seen[index] = true;
        } else {
            output.push(line.to_string());
        }
    }
    format!("{}\r\n", output.join("\r\n"))
}

fn insert_vevent_line(existing: &str, line_to_insert: &str) -> String {
    let mut output = Vec::new();
    for line in existing.replace("\r\n", "\n").lines() {
        if line.eq_ignore_ascii_case("END:VEVENT") {
            output.push(line_to_insert.to_string());
        }
        output.push(line.to_string());
    }
    format!("{}\r\n", output.join("\r\n"))
}

fn event_datetime_properties(event: &CalendarEvent) -> (String, String, String, String) {
    if event.all_day {
        let start = caldav_date(&event.start);
        let end = exclusive_all_day_end(&event.end);
        (
            "DTSTART;VALUE=DATE".to_string(),
            start,
            "DTEND;VALUE=DATE".to_string(),
            end,
        )
    } else if let Some((property_timezone, start, end)) = timezone_event_datetimes(event) {
        (
            format!("DTSTART;TZID={property_timezone}"),
            start,
            format!("DTEND;TZID={property_timezone}"),
            end,
        )
    } else {
        (
            "DTSTART".to_string(),
            caldav_datetime(&event.start),
            "DTEND".to_string(),
            caldav_datetime(&event.end),
        )
    }
}

fn timezone_event_datetimes(event: &CalendarEvent) -> Option<(String, String, String)> {
    let timezone = event.timezone.trim();
    if timezone.is_empty() || timezone.eq_ignore_ascii_case("UTC") || timezone.eq_ignore_ascii_case("Etc/UTC") {
        return None;
    }

    let timezone: chrono_tz::Tz = timezone.parse().ok()?;
    let start = caldav_datetime_in_timezone(&event.start, timezone)?;
    let end = caldav_datetime_in_timezone(&event.end, timezone)?;
    Some((timezone.name().to_string(), start, end))
}

fn caldav_datetime_in_timezone(value: &str, timezone: chrono_tz::Tz) -> Option<String> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|datetime| {
            datetime
                .with_timezone(&timezone)
                .format("%Y%m%dT%H%M%S")
                .to_string()
        })
}

fn exclusive_all_day_end(value: &str) -> String {
    let date = value.get(0..10).unwrap_or(value);
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map(|date| (date + chrono::Duration::days(1)).format("%Y%m%d").to_string())
        .unwrap_or_else(|_| caldav_date(value))
}

fn caldav_date(value: &str) -> String {
    if value.len() >= 10 && value.as_bytes().get(4) == Some(&b'-') {
        format!("{}{}{}", &value[0..4], &value[5..7], &value[8..10])
    } else {
        value.to_string()
    }
}

fn caldav_datetime(value: &str) -> String {
    if let Ok(datetime) = chrono::DateTime::parse_from_rfc3339(value) {
        return datetime
            .with_timezone(&chrono::Utc)
            .format("%Y%m%dT%H%M%SZ")
            .to_string();
    }
    if value.len() == 10 && value.as_bytes().get(4) == Some(&b'-') {
        return format!("{}T000000Z", caldav_date(value));
    }
    value.replace(['-', ':'], "").replace(".000", "")
}

fn apply_event_time_delta(event: &mut CalendarEvent, form: &HashMap<String, String>, resize: bool) {
    let delta = form
        .get("delta")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0);
    if delta == 0 {
        return;
    }
    if !resize {
        event.start = shift_iso_minutes(&event.start, delta);
    }
    event.end = shift_iso_minutes(&event.end, delta);
}

fn shift_iso_minutes(value: &str, minutes: i64) -> String {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|datetime| {
            (datetime.with_timezone(&chrono::Utc) + chrono::Duration::minutes(minutes))
                .to_rfc3339()
        })
        .unwrap_or_else(|_| value.to_string())
}

fn escape_ical(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace(';', "\\;")
        .replace(',', "\\,")
        .replace('\n', "\\n")
        .replace('\r', "")
}

fn unescape_ical(value: &str) -> String {
    value
        .replace("\\n", "\n")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
}

fn ensure_slash(value: &str) -> String {
    if value.ends_with('/') {
        value.to_string()
    } else {
        format!("{value}/")
    }
}

fn dav_href_in_scope(href: &str, scope: &str) -> bool {
    let href = href.trim();
    if href.is_empty()
        || !href.starts_with('/')
        || href.starts_with("//")
        || href.contains("://")
        || href.contains('\\')
    {
        return false;
    }
    if scope.trim().is_empty() {
        return true;
    }
    href.starts_with(&ensure_slash(scope.trim()))
}

fn mail_backend_response(error: MailBackendError) -> Response {
    let status = match error {
        MailBackendError::InvalidAccount(_) => StatusCode::BAD_REQUEST,
        MailBackendError::Credentials(_) => StatusCode::BAD_GATEWAY,
        MailBackendError::NotFound(_) => StatusCode::NOT_FOUND,
        MailBackendError::Backend(_) | MailBackendError::Parse(_) | MailBackendError::Crypto(_) => {
            StatusCode::BAD_GATEWAY
        }
    };
    json_error(status, &error.to_string())
}

async fn mail_account_for(
    state: &AppState,
    username: &str,
    account_id: u64,
) -> Result<MailAccount, Response> {
    match state.storage.mail_account(username, account_id).await {
        Ok(Some(account)) => Ok(account),
        Ok(None) => Err(json_error(StatusCode::NOT_FOUND, "Mail account not found")),
        Err(error) => {
            tracing::error!(%error, "failed to load mail account from Postgres");
            Err(json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Unable to load mail account",
            ))
        }
    }
}

async fn run_mail_backend<T>(
    backend: Arc<dyn MailBackend>,
    account: MailAccount,
    operation: impl FnOnce(&dyn MailBackend, &MailAccount) -> Result<T, MailBackendError> + Send + 'static,
) -> Result<T, MailBackendError>
where
    T: Send + 'static,
{
    tokio::task::spawn_blocking(move || operation(backend.as_ref(), &account))
        .await
        .map_err(|error| MailBackendError::Backend(error.to_string()))?
}

fn render_login(state: &AppState, error: Option<&str>) -> String {
    let error_html = error
        .map(|message| format!(r#"<div class="ui-widget loginerrors" role="alert" aria-live="assertive"><div class="ui-state-error ui-corner-all"><p>{}</p></div></div>"#, escape(message)))
        .unwrap_or_default();
    // Small, self-contained show/hide password toggle. The login page loads no JS
    // bundle, so this inline script keeps the feature dependency-free.
    let password_toggle_script = r#"<script>(function(){var b=document.getElementById('toggle_password'),p=document.getElementById('password');if(!b||!p){return;}b.addEventListener('click',function(){var hidden=p.getAttribute('type')==='password';p.setAttribute('type',hidden?'text':'password');b.setAttribute('aria-pressed',hidden?'true':'false');b.setAttribute('aria-label',hidden?'Hide password':'Show password');var i=b.querySelector('i');if(i){i.className=hidden?'fa fa-eye-slash':'fa fa-eye';}p.focus();});})();</script>"#;
    layout(
        state,
        "",
        &format!(
            r##"<a href="#user" class="sr-only sr-only-focusable skip-link">Skip to login form</a><div class="container">{error}
<div class="loginform ui-corner-all"><img src="/img/caldaver_300transp.png" alt="Caldaver" style="max-width: 200px; margin-bottom: 16px;"><form method="post" action="/login" class="form-horizontal">
<div class="form-group"><label class="col-sm-3 control-label" for="user">User name</label><div class="col-sm-9"><input id="user" name="user" class="form-control" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" inputmode="text" enterkeyhint="next" autofocus required></div></div>
<div class="form-group"><label class="col-sm-3 control-label" for="password">Password</label><div class="col-sm-9" style="position:relative"><input id="password" name="password" class="form-control" type="password" autocomplete="current-password" autocapitalize="none" spellcheck="false" enterkeyhint="go" required style="padding-right:46px"><button type="button" id="toggle_password" aria-label="Show password" aria-pressed="false" aria-controls="password" style="position:absolute;top:0;right:15px;height:100%;min-width:44px;background:none;border:0;color:#555;cursor:pointer"><i class="fa fa-eye" aria-hidden="true"></i></button></div></div>
<input name="login" value="Log in" type="submit" class="btn btn-primary btn-lg btn-block"></form></div></div>"##,
            error = error_html
        ),
        password_toggle_script,
    )
}

fn render_calendar(state: &AppState, session: &Session) -> String {
    let content = format!(
        r#"{navbar}<main class="container-fluid calendar-shell"><h1 class="sr-only">Calendar</h1><div id="wrapper" class="calendar-layout"><div id="sidebar">{sidebar}<div id="footer"><p>{footer}</p></div></div><div id="content"><div id="calendar_view"></div></div></div></main><nav id="mobile_bottom_bar" class="mobile-bottom-bar" aria-label="Calendar quick actions" hidden><button type="button" class="mobile-bottom-btn" data-mobile-action="prev" aria-label="Previous" title="Previous"><i class="fa fa-chevron-left" aria-hidden="true"></i><span class="mobile-bottom-btn-label"><i class="fa fa-chevron-left" aria-hidden="true"></i></span></button><button type="button" class="mobile-bottom-btn" data-mobile-action="today" aria-label="Today" title="Today"><i class="fa fa-dot-circle-o" aria-hidden="true"></i><span class="mobile-bottom-btn-label">Today</span></button><button type="button" class="mobile-bottom-btn" data-mobile-action="view" aria-label="Change view" title="Change view"><i class="fa fa-th-list" aria-hidden="true"></i><span class="mobile-bottom-btn-label">View</span></button><button type="button" class="mobile-bottom-btn" data-mobile-action="refresh" aria-label="Refresh" title="Refresh"><i class="fa fa-refresh" aria-hidden="true"></i><span class="mobile-bottom-btn-label">Refresh</span></button><button type="button" class="mobile-bottom-btn" data-mobile-action="next" aria-label="Next" title="Next"><i class="fa fa-chevron-right" aria-hidden="true"></i><span class="mobile-bottom-btn-label"><i class="fa fa-chevron-right" aria-hidden="true"></i></span></button></nav><button type="button" id="mobile_fab_add" class="mobile-fab" aria-label="Create event" title="Create event" hidden><i class="fa fa-plus" aria-hidden="true"></i></button><div id="mobile_ptr" class="mobile-ptr" aria-hidden="true" hidden><i class="fa fa-refresh" aria-hidden="true"></i></div>"#,
        navbar = navbar(state, session, "calendar"),
        sidebar = calendar_sidebar(),
        footer = escape(&state.config.footer)
    );
    layout(state, "caldaver-calendar-page", &content, &calendar_bottom(session))
}

fn render_cards(state: &AppState, session: &Session) -> String {
    let content = format!(
        r#"{navbar}<div class="container-fluid cards-shell"><aside class="cards-sidebar">{sidebrand}{appnav}<button id="contact_create" class="btn btn-default create-contact-button"><i class="fa fa-plus"></i> Create contact</button><nav class="contacts-nav" aria-label="Contact lists"><a class="contacts-nav-item active" href="/cards"><i class="fa fa-user"></i><span>Contacts</span><span id="contact_count_nav" class="contacts-nav-count">...</span></a><span class="contacts-nav-item muted"><i class="fa fa-history"></i><span>Frequent</span></span><span class="contacts-nav-item muted"><i class="fa fa-tags"></i><span>Labels</span></span></nav></aside>
<main class="cards-content"><div class="contacts-search-row"><div class="contacts-search"><i class="fa fa-search"></i><input id="contacts_search" type="search" placeholder="Search"></div><div class="contacts-view-switch" role="group" aria-label="Contact view"><button type="button" data-view="list">List</button><button type="button" data-view="cards">Cards</button></div></div><section class="contacts-panel"><div class="contacts-heading"><h1>Contacts <span id="contact_count">Loading...</span></h1><div class="contacts-actions"><button type="button" id="contacts_refresh" title="Refresh"><i class="fa fa-refresh"></i></button></div></div><div id="contacts_loading" class="contacts-empty"><h2>Loading contacts...</h2></div><div id="contacts_empty" class="contacts-empty" hidden><h2>No contacts</h2></div><div id="contacts_list" class="contacts-list-view"><div class="contacts-table-header"><span>Name</span><span>Email</span><span>Phone number</span><span>Job title & company</span><span>Labels</span><span></span></div><div id="contacts_rows"></div></div><div id="contacts_cards" class="contacts-card-grid" hidden></div></section></main></div>{dialog}"#,
        navbar = navbar(state, session, "cards"),
        sidebrand = sidebrand(),
        appnav = appnav("cards"),
        dialog = contact_dialog(&session.csrf)
    );
    layout(state, "caldaver-cards-page", &content, &part_js("cardsjs"))
}

fn render_mail(state: &AppState, session: &Session, no_js: bool) -> String {
    let content = format!(
        r#"{navbar}<div class="container-fluid mail-shell"><aside class="mail-sidebar">{sidebrand}{appnav}<button type="button" id="mail_compose" class="mail-mobile-compose-button" aria-label="Compose mail" hidden><i class="fa fa-pencil" aria-hidden="true"></i><span>Compose</span></button><nav id="mail_accounts" class="mail-accounts" aria-label="Mail accounts"></nav></aside><main class="mail-content"><div class="mail-search-row"><div class="mail-search"><i class="fa fa-search"></i><input id="mail_search" type="search" placeholder="Search mail" aria-label="Search mail"></div></div><section class="mail-panel"><div class="mail-toolbar"><h1 id="mail_account_title">Mail</h1><button type="button" id="mail_refresh" title="Refresh"><i class="fa fa-refresh"></i></button></div><div id="mail_empty" class="mail-empty" hidden>Add an IMAP account to download mail.</div><div id="mail_loading" class="mail-empty" hidden>Checking the IMAP server for mail...</div><div id="mail_no_messages" class="mail-empty" hidden>Checking the IMAP server for mail...</div><div id="mail_error" class="mail-error" hidden></div><div id="mail_rows" class="mail-rows"></div></section><section id="mail_compose_screen" class="mail-compose-screen" hidden aria-label="Compose email"><div class="mail-compose-toolbar"><button type="button" id="mail_compose_back" aria-label="Back"><i class="fa fa-arrow-left" aria-hidden="true"></i></button><h1>New message</h1><button type="button" id="mail_compose_send" aria-label="Send" aria-disabled="true"><i class="fa fa-send" aria-hidden="true"></i></button></div><form id="mail_compose_form" class="mail-compose-form"><div class="mail-compose-fields"><label class="mail-compose-from"><span>From</span><input id="mail_compose_from" type="email" readonly aria-label="From"></label><label><span>To</span><input id="mail_compose_to" type="email" autocomplete="email"><button type="button" id="mail_compose_ccbcc" class="mail-compose-ccbcc" aria-expanded="false" aria-controls="mail_compose_cc mail_compose_bcc">Cc/Bcc</button></label><label id="mail_compose_cc_row" hidden><span>Cc</span><input id="mail_compose_cc" type="email" autocomplete="email" multiple></label><label id="mail_compose_bcc_row" hidden><span>Bcc</span><input id="mail_compose_bcc" type="email" autocomplete="email" multiple></label><label><span>Subject</span><input id="mail_compose_subject" type="text" autocomplete="off"></label></div><label class="mail-compose-body-label"><span>Message</span><textarea id="mail_compose_body" rows="12" aria-label="Message"></textarea></label><div class="mail-compose-footer"><button type="button" class="mail-compose-unavailable-action" aria-label="Formatting options unavailable" aria-disabled="true" disabled><i class="fa fa-font" aria-hidden="true"></i></button><button type="button" class="mail-compose-unavailable-action" aria-label="Attach file unavailable" aria-disabled="true" disabled><i class="fa fa-paperclip" aria-hidden="true"></i></button><button type="button" class="mail-compose-unavailable-action" aria-label="More compose actions unavailable" aria-disabled="true" disabled><i class="fa fa-ellipsis-v" aria-hidden="true"></i></button><button type="button" id="mail_compose_discard" class="mail-compose-discard" aria-label="Discard draft"><i class="fa fa-trash" aria-hidden="true"></i></button></div><div id="mail_compose_status" class="mail-compose-status" aria-live="polite"></div><div id="mail_compose_error" class="mail-error mail-compose-error" aria-live="assertive" hidden></div></form></section></main></div>"#,
        navbar = navbar(state, session, "mail"),
        sidebrand = sidebrand(),
        appnav = appnav("mail")
    );
    let bottom = if no_js { String::new() } else { part_js("mailjs") };
    layout(state, "caldaver-mail-page", &content, &bottom)
}

fn render_mail_read(state: &AppState, session: &Session, account_id: u64, uid: u64) -> String {
    let content = format!(
        r#"{navbar}<div class="container-fluid mail-shell mail-read-shell"><aside class="mail-sidebar">{sidebrand}{appnav}</aside><main class="mail-content"><section id="mail_reader" class="mail-reader" data-account-id="{account_id}" data-uid="{uid}" data-message-url="/mail/message" data-navigation-url="/mail/message/navigation" data-messages-url="/mail/messages" data-read-url="/mail/read" data-unread-url="/mail/message/unread" data-inbox-url="/mail" data-attachment-url="/mail/attachment" data-csrf-token="{csrf}"><div class="mail-reader-toolbar"><a href="/mail" id="mail_reader_back" title="Return"><i class="fa fa-arrow-left"></i></a><button type="button" id="mail_reader_refresh" title="Refresh"><i class="fa fa-refresh"></i></button><button type="button" id="mail_reader_unread" title="Mark unread" hidden><i class="fa fa-envelope"></i></button><div class="mail-reader-toolbar-nav" aria-label="Mail"><button type="button" id="mail_reader_previous" title="Previous message" aria-label="Previous message" disabled><i class="fa fa-chevron-left"></i></button><button type="button" id="mail_reader_next" title="Next message" aria-label="Next message" disabled><i class="fa fa-chevron-right"></i></button></div></div><div id="mail_reader_error" class="mail-error" hidden></div><article id="mail_reader_message" class="mail-reader-message" hidden><h1 id="mail_reader_subject"></h1><div id="mail_reader_thread" class="mail-reader-thread"><section class="mail-thread-message" data-uid="{uid}"><div class="mail-reader-message-header"><div class="mail-reader-meta"><div class="mail-reader-avatar" aria-hidden="true"></div><div><strong id="mail_reader_from"></strong><span id="mail_reader_date"></span></div></div><button type="button" id="mail_reader_reply" class="mail-reader-reply-button" data-uid="{uid}" aria-label="Reply to this message"><i class="fa fa-reply" aria-hidden="true"></i><span>Reply</span></button></div><pre id="mail_reader_body"></pre><iframe id="mail_reader_html" class="mail-reader-html" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" title="Mail" hidden></iframe><div id="mail_reader_attachments" class="mail-attachments" data-testid="mail-attachments"></div></section></div><section id="mail_reply_composer" class="mail-reply-composer" hidden aria-label="Reply draft"><div class="mail-reply-composer-header"><h2>Reply</h2><button type="button" id="mail_reply_close" aria-label="Close reply draft"><i class="fa fa-times" aria-hidden="true"></i></button></div><form id="mail_reply_form" class="mail-reply-form"><label><span>To</span><input id="mail_reply_to" type="email" autocomplete="email"></label><label><span>Subject</span><input id="mail_reply_subject" type="text" autocomplete="off"></label><label class="mail-reply-body-label"><span>Message</span><textarea id="mail_reply_body" rows="12" aria-label="Reply message"></textarea></label><div class="mail-reply-actions"><button type="button" id="mail_reply_send" class="mail-reply-send" aria-disabled="true"><i class="fa fa-send" aria-hidden="true"></i><span>Send</span></button><button type="button" id="mail_reply_discard" class="mail-reply-discard"><i class="fa fa-trash" aria-hidden="true"></i><span>Discard</span></button></div><div id="mail_reply_status" class="mail-reply-status" aria-live="polite"></div><div id="mail_reply_error" class="mail-error mail-reply-error" aria-live="assertive" hidden></div></form></section></article><div id="mail_reader_loading" class="mail-empty">Loading message</div></section></main></div>"#,
        navbar = navbar(state, session, "mail"),
        sidebrand = sidebrand(),
        appnav = appnav("mail"),
        csrf = session.csrf
    );
    layout(state, "caldaver-mail-page", &content, &part_js("mailmessagejs"))
}

fn render_preferences(state: &AppState, session: &Session, accounts: &[ConnectedAccountPublic], calendars: &[(String, String)]) -> String {
    let prefs = &session.preferences;
    let calendar_options = if calendars.is_empty() {
        format!(r#"<option value="{calendar}" selected>Default</option>"#, calendar = DEFAULT_CALENDAR)
    } else {
        calendars
            .iter()
            .map(|(url, name)| {
                let selected = if url == &prefs.default_calendar { r#" selected"# } else { "" };
                format!(r#"<option value="{url}"{selected}>{name}</option>"#)
            })
            .collect::<Vec<_>>()
            .join("")
    };
    let timezone_options = {
        let tzs = available_timezones();
        let mut opts: Vec<String> = tzs
            .iter()
            .map(|tz| {
                let selected = if *tz == prefs.timezone { r#" selected"# } else { "" };
                format!(r#"<option value="{tz}"{selected}>{tz}</option>"#)
            })
            .collect();
        if !tzs.contains(&prefs.timezone.as_str()) {
            opts.insert(0, format!(r#"<option value="{tz}" selected>{tz}</option>"#, tz = escape(&prefs.timezone)));
        }
        opts.join("")
    };
    let content = format!(
        r#"{navbar}<div class="container"><h1>Preferences</h1><div class="preferences-container"><form method="post" id="prefs_form"><input type="hidden" name="_token" value="{csrf}">
<fieldset class="prefs-section"><legend>General options</legend><div class="form-group"><label for="language">Language</label><select class="form-control" id="language" name="language"><option value="en" selected>English</option></select></div>{radio_date}{radio_time}{radio_week}<div class="form-group"><label for="timezone">Timezone</label><select class="form-control" id="timezone" name="timezone">{timezone_options}</select></div></fieldset>
<fieldset class="prefs-section"><legend>Calendars</legend><div class="form-group"><label for="default_calendar">Default calendar</label><select class="form-control" id="default_calendar" name="default_calendar">{calendar_options}</select></div><div class="form-group"><label for="default_view">Default view</label><select class="form-control" id="default_view" name="default_view"><option value="month" selected>Month</option><option value="week">Week</option><option value="day">Day</option><option value="list">List</option></select></div>{radio_week_nb}{radio_now}<div class="form-group prefs-radio-group" role="radiogroup" aria-labelledby="disable_javascript_label"><div class="prefs-control-label" id="disable_javascript_label">Disable JavaScript</div><label class="radio-inline" for="disable_javascript_yes"><input id="disable_javascript_yes" type="radio" name="disable_javascript" value="true"> Yes</label><label class="radio-inline" for="disable_javascript_no"><input id="disable_javascript_no" type="radio" name="disable_javascript" value="false" checked="checked"> No</label></div><div class="form-group"><label for="list_days">List view days</label><select class="form-control" id="list_days" name="list_days"><option value="7" selected>7 days</option><option value="14">14 days</option><option value="31">31 days</option></select></div></fieldset>
{accounts_section}<div id="prefs_buttons"><input type="submit" class="btn btn-success" value="Save"><a href="/" id="return_button" class="btn btn-default"><i class="fa fa-calendar"></i> Return</a></div></form></div></div>{account_dialog}"#,
        navbar = navbar(state, session, "calendar"),
        csrf = session.csrf,
        timezone_options = timezone_options,
        calendar_options = calendar_options,
        radio_date = pref_radios("date_format", "Date format", &[("ymd", "2026-05-30"), ("dmy", "30/05/2026"), ("mdy", "05/30/2026")], &prefs.date_format),
        radio_time = pref_radios("time_format", "Time format", &[("24", "13:00"), ("12", "01:00 pm")], &prefs.time_format),
        radio_week = pref_radios("weekstart", "Week starts on", &[("0", "Sunday"), ("1", "Monday")], &prefs.weekstart.to_string()),
        radio_week_nb = pref_radios("show_week_nb", "Show week numbers", &[("true", "Yes"), ("false", "No")], if prefs.show_week_nb {"true"} else {"false"}),
        radio_now = pref_radios("show_now_indicator", "Show a marker indicating the current time", &[("true", "Yes"), ("false", "No")], if prefs.show_now_indicator {"true"} else {"false"}),
        accounts_section = preferences_accounts_section(accounts),
        account_dialog = account_dialog(&session.csrf)
    );
    layout(state, "", &content, &part_js("mailaccountjs"))
}

fn preferences_accounts_section(accounts: &[ConnectedAccountPublic]) -> String {
    let rows = accounts
        .iter()
        .map(account_row_html)
        .collect::<Vec<_>>()
        .join("");
    format!(
        r#"<fieldset class="prefs-section prefs-accounts-section"><legend>Accounts</legend><div class="prefs-accounts-header"><p>Calendar, contacts, and email accounts available to Caldaver.</p><button type="button" id="mail_account_create" class="btn btn-default prefs-mail-account-create"><i class="fa fa-plus"></i> Add account</button></div><div id="connected_accounts" class="prefs-account-list" aria-live="polite">{rows}</div><div id="connected_accounts_empty" class="prefs-account-empty" hidden>No accounts are configured.</div></fieldset>"#
    )
}

fn account_row_html(account: &ConnectedAccountPublic) -> String {
    let type_label = match account.account_type.as_str() {
        "calendar" => "Calendar",
        "carddav" => "Contacts",
        "email" => "Email",
        _ => "Account",
    };
    let source = if account.source == "session" { "Session" } else { "Postgres" };
    let warning = if account.password_needs_reset {
        r#"<span class="prefs-account-warning">Password needs reset</span>"#
    } else {
        ""
    };
    let last_error = if account.last_error.is_empty() {
        String::new()
    } else {
        format!(
            r#"<span class="prefs-account-warning prefs-account-last-error">{}</span>"#,
            escape(&account.last_error)
        )
    };
    format!(
        r#"<article class="prefs-account-row" data-account-type="{kind}"><div class="prefs-account-icon"><i class="fa {icon}" aria-hidden="true"></i></div><div class="prefs-account-main"><div class="prefs-account-title"><strong>{label}</strong><span>{type_label}</span></div><div class="prefs-account-detail">{identifier}</div><div class="prefs-account-detail">{server}</div><div class="prefs-account-home">{home}</div>{warning}{last_error}</div><div class="prefs-account-source">{source}</div></article>"#,
        kind = escape(&account.account_type),
        icon = match account.account_type.as_str() {
            "calendar" => "fa-calendar",
            "carddav" => "fa-book",
            "email" => "fa-envelope",
            _ => "fa-plug",
        },
        label = escape(&account.label),
        type_label = type_label,
        identifier = escape(&account.identifier),
        server = escape(&account.server),
        home = escape(&account.home_set),
        warning = warning,
        last_error = last_error,
        source = source
    )
}

fn layout(state: &AppState, body_class: &str, content: &str, bottom: &str) -> String {
    format!(
        r#"<!DOCTYPE html><html lang="en"><head><title>{title}</title><link rel="shortcut icon" href="/img/favicon.ico"><meta http-equiv="content-type" content="text/html; charset=utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link href="/dist/css/caldaver.css" rel="stylesheet" type="text/css"><link href="/dist/css/caldaver.print.css" rel="stylesheet" type="text/css" media="print"></head><body class="{body_class}">{content}{bottom}</body></html>"#,
        title = escape(&state.config.title),
        body_class = body_class,
        content = content,
        bottom = bottom
    )
}

fn navbar(state: &AppState, session: &Session, active: &str) -> String {
    format!(
        r#"<div class="navbar navbar-default caldaver-topbar" role="navigation"><div class="container-fluid"><details class="mobile-section-menu"><summary aria-label="Sections"><i class="fa fa-bars"></i></summary><nav class="mobile-section-menu-list" aria-label="Application sections">{mobile_links}</nav></details><div class="navbar-header"><button class="topbar-menu" type="button" aria-label="Menu"><i class="fa fa-bars"></i></button><span class="navbar-brand"><span class="caldaver-brand-title">{title}</span><span class="mobile-calendar-toolbar-title" aria-hidden="true"><span id="mobile_calendar_toolbar_date"></span><span id="mobile_calendar_toolbar_day"></span></span></span></div><p class="navbar-text navbar-right" id="loading"><span class="navbar-spinner" aria-hidden="true"></span></p><ul class="nav navbar-nav navbar-right topbar-actions" id="usermenu"><li class="mobile-calendar-toolbar-action"><button type="button" id="mobile_calendar_date_action" title="Choose date" aria-label="Choose date"><i class="fa fa-calendar"></i></button></li><li class="mobile-calendar-toolbar-action"><button type="button" id="mobile_calendar_more_action" title="More" aria-label="More"><i class="fa fa-ellipsis-v"></i></button></li><li><a class="prefs" href="/preferences"><i title="Preferences" class="fa fa-lg fa-wrench"></i></a></li><li class="user-menu"><details class="user-menu-dropdown"><summary class="user-pill" aria-label="User menu"><span class="user-pill-label">{displayname}</span><i class="fa fa-caret-down" aria-hidden="true"></i></summary><nav class="user-menu-list" aria-label="User menu"><a class="user-menu-item user-menu-logout" href="/logout"><i class="fa fa-power-off" aria-hidden="true"></i><span>Log out</span></a></nav></details></li></ul></div></div>{mobile_calendar_script}"#,
        title = escape(&state.config.title),
        displayname = escape(&session.displayname),
        mobile_links = mobile_links(active),
        mobile_calendar_script = mobile_calendar_menu_script()
    )
}

fn mobile_links(active: &str) -> String {
    let calendar = format!(
        r#"<details class="mobile-calendar-menu" data-calendar-href="/"><summary class="{active}"><i class="fa fa-calendar"></i><span>Calendar</span><i class="fa fa-caret-right mobile-calendar-menu-caret" aria-hidden="true"></i></summary><div class="mobile-calendar-menu-calendars" aria-label="Calendars" data-calendars-url="/calendars"><span class="mobile-calendar-menu-empty">Loading calendars...</span></div></details>"#,
        active = if active == "calendar" { "active" } else { "" }
    );
    let section_links = [
        ("cards", "/cards", "fa-book", "Contacts"),
        ("mail", "/mail", "fa-envelope", "Mail"),
    ]
    .into_iter()
    .map(|(name, href, icon, label)| {
        format!(
            r#"<a class="{active}" href="{href}"><i class="fa {icon}"></i><span>{label}</span></a>"#,
            active = if active == name { "active" } else { "" }
        )
    })
    .collect::<String>();
    format!("{calendar}{section_links}")
}

fn mobile_calendar_menu_script() -> &'static str {
    r#"<script>
(function() {
  function mobileCalendarMenu() {
    return document.querySelector('.mobile-calendar-menu');
  }

  function mobileCalendarList() {
    return document.querySelector('.mobile-calendar-menu-calendars');
  }

  function setMobileCalendarMenuMessage(message) {
    var list = mobileCalendarList();
    if (!list) {
      return;
    }

    list.innerHTML = '';
    var empty = document.createElement('span');
    empty.className = 'mobile-calendar-menu-empty';
    empty.textContent = message;
    list.appendChild(empty);
  }

  function renderMobileCalendarMenu(calendars) {
    var list = mobileCalendarList();
    if (!list) {
      return;
    }

    list.innerHTML = '';
    if (!calendars || calendars.length === 0) {
      setMobileCalendarMenuMessage('No calendars found');
      return;
    }

    calendars.forEach(function(calendar) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'mobile-calendar-account';
      button.dataset.calendarUrl = calendar.calendar || '';
      button.setAttribute('aria-pressed', 'true');

      var color = document.createElement('span');
      color.className = 'mobile-calendar-account-color';
      color.style.backgroundColor = calendar.color || '#3367d6';
      button.appendChild(color);

      var name = document.createElement('span');
      name.className = 'mobile-calendar-account-name';
      name.textContent = calendar.displayname || calendar.calendar || 'Calendar';
      button.appendChild(name);

      if (calendar.is_shared === true) {
        var shared = document.createElement('i');
        shared.className = 'fa fa-share mobile-calendar-account-shared';
        shared.setAttribute('aria-hidden', 'true');
        button.appendChild(shared);
      }

      list.appendChild(button);
    });
  }

  function loadMobileCalendarMenu() {
    var list = mobileCalendarList();
    if (!list || list.dataset.loaded === 'true' || document.querySelector('#own_calendar_list, #shared_calendar_list')) {
      return;
    }

    var calendarsUrl = list.dataset.calendarsUrl;
    if (!calendarsUrl) {
      return;
    }

    list.dataset.loaded = 'true';
    fetch(calendarsUrl, {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    })
      .then(function(response) {
        if (!response.ok) {
          throw new Error('Unable to load calendars');
        }
        return response.json();
      })
      .then(function(payload) {
        renderMobileCalendarMenu(payload.data || []);
      })
      .catch(function() {
        list.dataset.loaded = 'false';
        setMobileCalendarMenuMessage('Unable to load calendars');
      });
  }

  document.addEventListener('DOMContentLoaded', function() {
    var menu = mobileCalendarMenu();
    if (!menu) {
      return;
    }

    menu.addEventListener('toggle', function() {
      if (menu.open) {
        loadMobileCalendarMenu();
      }
    });

    var sectionMenu = document.querySelector('.mobile-section-menu');
    if (sectionMenu) {
      sectionMenu.addEventListener('click', function(event) {
        var account = event.target.closest && event.target.closest('.mobile-calendar-account');
        if (!account || document.querySelector('#own_calendar_list, #shared_calendar_list')) {
          return;
        }

        event.preventDefault();
        window.location.href = menu.dataset.calendarHref || '/';
      });
    }
  });
})();
</script>"#
}

fn appnav(active: &str) -> String {
    let items = [
        ("calendar", "/", "fa-calendar", "Calendar", ""),
        ("cards", "/cards", "fa-book", "Contacts", ""),
        ("mail", "/mail", "fa-envelope", "Mail", r#"<i class="fa fa-refresh fa-spin mail-nav-spinner" aria-hidden="true"></i>"#),
    ]
    .into_iter()
    .map(|(name, href, icon, label, extra)| {
        format!(
            r#"<a id="{id}" class="app-nav-item{active}" href="{href}"><i class="fa {icon}"></i><span>{label}</span>{extra}</a>"#,
            id = if name == "mail" { "mail_nav_item" } else { "" },
            active = if active == name { " active" } else { "" }
        )
    })
    .collect::<Vec<_>>()
    .join("");
    format!(r#"<nav class="app-nav" aria-label="Application sections">{items}</nav>"#)
}

fn sidebrand() -> &'static str {
    r#"<div id="logo" class="block caldaver-sidebrand" aria-label="Caldaver">Caldaver</div>"#
}

fn calendar_sidebar() -> String {
    format!(
        r#"{sidebrand}{appnav}<div id="shortcuts" class="block"><button id="shortcut_add_event" class="btn btn-default btn-block create-event-button"><i class="fa fa-plus"></i> Create event</button></div><div class="block calendar_list panel panel-default calendar-sidebar-section" id="own_calendar_list"><div class="panel-heading"><h3 class="panel-title">Calendars</h3></div><div class="panel-body"><ul class="fa-ul"><li class="calendar-list-loading">Loading calendars...</li></ul><div class="buttons"><button type="button" title="Create" aria-label="Create" id="calendar_add" class="pseudobutton"><i class="fa fa-plus" aria-hidden="true"></i></button></div></div></div><div class="block calendar_list panel panel-default shared_calendars calendar-sidebar-section" id="shared_calendar_list"><div class="panel-heading"><h3 class="panel-title">Shared calendars</h3></div><div class="panel-body"><ul class="fa-ul"><li class="calendar-list-loading">Loading shared calendars...</li></ul><div class="buttons"><button type="button" id="toggle_all_shared_calendars" class="pseudobutton hide_all" title="Show/hide all" aria-label="Show/hide all"><i class="fa fa-eye-slash fa-lg" aria-hidden="true"></i></button></div></div></div>"#,
        sidebrand = sidebrand(),
        appnav = appnav("calendar")
    )
}

fn calendar_bottom(session: &Session) -> String {
    format!(
        r#"<script src="/jssettings"></script><script>var translations = {translations}; var csrf_id = '_token'; var csrf_value = "{csrf}";</script><script src="/dist/js/caldaver.min.js"></script><div id="event_details"></div><div id="popup" class="freeow freeow-top-right"></div>"#,
        translations = translations_json(),
        csrf = session.csrf
    )
}

fn translations_json() -> String {
    let mut map = serde_json::Map::new();
    for (key, value) in [
        ("labels.create", "Create"), ("labels.save", "Save"), ("labels.cancel", "Cancel"),
        ("labels.refresh", "Refresh"), ("labels.createevent", "Create event"),
        ("labels.editevent", "Edit event"), ("labels.newcalendar", "New calendar"),
        ("labels.modifycalendar", "Modify calendar"), ("labels.deletecalendar", "Delete calendar"),
        ("labels.calendar", "Calendar"), ("labels.contacts", "Contacts"), ("labels.mail", "Mail"),
        ("labels.generaloptions", "General options"), ("labels.repeatoptions", "Repeat"),
        ("labels.remindersoptions", "Reminders"), ("labels.workgroupoptions", "Workgroup"),
        ("labels.summary", "Summary"), ("labels.location", "Location"), ("labels.description", "Description"),
        ("labels.timezone", "Timezone"),
        ("labels.startdate", "Start date"), ("labels.enddate", "End date"), ("labels.alldayform", "All day"),
        ("labels.displayname", "Display name"), ("labels.color", "Color"), ("labels.privacy", "Privacy"),
        ("labels.public", "Public"), ("labels.private", "Private"), ("labels.confidential", "Confidential"),
        ("labels.transp", "Show this time as"), ("labels.opaque", "Busy"), ("labels.transparent", "Free"),
        ("labels.repeatno", "No repetitions"), ("labels.repeatdaily", "Daily"), ("labels.repeatweekly", "Weekly"),
        ("labels.repeatmonthly", "Monthly"), ("labels.repeatyearly", "Yearly"), ("labels.every", "Every"),
        ("labels.ends", "Ends:"), ("labels.never", "Never"), ("labels.after", "After"),
        ("labels.choose_date", "Choose a date"), ("labels.occurrences", "occurrences"),
        ("labels.minutes", "minutes"), ("labels.hours", "hours"), ("labels.days", "days"),
        ("labels.weeks", "weeks"), ("labels.months", "months"), ("labels.before_start", "before start"),
        ("labels.add_reminder", "Add reminder"), ("labels.add_share", "Add share"),
        ("labels.readonly", "Read only"), ("labels.readandwrite", "Read and write"),
        ("labels.currentlysharing", "Currently sharing this calendar"), ("labels.modify", "Modify"),
        ("labels.delete", "Delete"), ("messages.error_loading_calendar_list", "Unable to load calendars"),
        ("messages.error_interfacefailure", "Interface failure"), ("messages.error_loadevents", "Error loading events for %cal"),
        ("messages.notice_no_calendars", "No calendars found"), ("messages.error_empty_fields", "Required fields are missing"),
        ("messages.error_oops", "Something went wrong"), ("messages.internal_server_error", "Internal server error"),
        ("messages.error_invalidinput", "Invalid input"), ("messages.info_noreminders", "No reminders"),
        ("messages.info_reminders_caldaver_support", "Reminders are stored with the event"),
        ("messages.info_rrule_not_reproducible", "This repeat rule cannot be represented"),
        ("messages.info_rrule_protected", "Repeat rule is protected"), ("messages.info_sharedby", "Shared by %user"),
    ] {
        map.insert(key.to_string(), Value::String(value.to_string()));
    }
    Value::Object(map).to_string()
}

fn contact_dialog(csrf: &str) -> String {
    format!(
        r#"<div id="contact_dialog" class="contact-dialog" role="dialog" aria-modal="true" aria-labelledby="contact_dialog_title" hidden><form id="contact_form" action="/cards/save" method="post"><input type="hidden" name="_token" value="{csrf}"><input type="hidden" name="url" value=""><input type="hidden" name="etag" value=""><input type="hidden" name="uid" value=""><div class="contact-dialog-panel"><div class="contact-dialog-header"><h2 id="contact_dialog_title">Create contact</h2><button type="button" id="contact_cancel_icon" aria-label="Cancel"><i class="fa fa-times"></i></button></div><label><span>Name</span><input required name="full_name" type="text" autocomplete="name"></label><label><span>Email</span><input name="email" type="email" autocomplete="email"></label><label><span>Phone number</span><input name="phone" type="tel" autocomplete="tel"></label><label><span>Company</span><input name="organization" type="text" autocomplete="organization"></label><label><span>Job title</span><input name="job_title" type="text" autocomplete="organization-title"></label><div class="contact-dialog-footer"><button type="button" id="contact_cancel" class="btn btn-default">Cancel</button><button type="submit" class="btn btn-primary">Save</button></div></div></form></div>"#
    )
}

fn account_dialog(csrf: &str) -> String {
    format!(
        r#"<div id="mail_account_dialog" class="contact-dialog account-dialog" role="dialog" aria-modal="true" aria-labelledby="mail_account_dialog_title" hidden><form id="mail_account_form" action="/accounts/save" method="post"><input type="hidden" name="_token" value="{csrf}"><input type="hidden" name="id" value=""><div class="contact-dialog-panel"><div class="contact-dialog-header"><h2 id="mail_account_dialog_title">Add account</h2><button type="button" id="mail_account_cancel_icon" aria-label="Cancel"><i class="fa fa-times"></i></button></div><fieldset class="account-type-chooser" aria-label="Account type"><label><input type="radio" name="account_type" value="calendar" checked> <span>Calendar</span></label><label><input type="radio" name="account_type" value="carddav"> <span>Contacts</span></label><label><input type="radio" name="account_type" value="email"> <span>Email</span></label></fieldset><div class="account-common-fields"><label><span>Account name</span><input required name="label" type="text" autocomplete="organization"></label><label data-account-field="dav"><span>DAV server URL</span><input name="server_url" type="url" inputmode="url" autocomplete="url" placeholder="https://dav.example.com/"></label><label data-account-field="dav"><span>Auth method</span><select name="auth_method"><option value="basic">Basic password</option><option value="bearer">Bearer token</option><option value="none">None</option></select></label><label data-account-field="email"><span>Email address</span><input name="email_address" type="email" autocomplete="email"></label><label data-account-field="email"><span>IMAP host</span><input name="imap_host" type="text" autocomplete="off"></label><label data-account-field="email"><span>IMAP port</span><input name="imap_port" type="number" min="1" max="65535" value="993"></label><label data-account-field="email"><span>Encryption</span><select name="encryption"><option value="ssl">SSL</option><option value="tls">STARTTLS</option><option value="none">None</option></select></label><label><span>User name</span><input required name="username" type="text" autocomplete="username"></label><label><span>Password or token</span><input name="password" type="password" autocomplete="current-password"><small class="account-credential-help">Saved credentials are never shown. Leave this blank when editing to keep the current credential.</small></label><label data-account-field="dav"><span>Home set</span><input name="home_set" type="text" autocomplete="off" placeholder="/calendars/user/"></label><label data-account-field="email"><span>Auto refresh minutes</span><input name="refresh_interval_minutes" type="number" min="1" max="1440" value="1"></label></div><div id="mail_account_error" class="mail-error" aria-live="assertive" hidden></div><div class="contact-dialog-footer"><button type="button" id="mail_account_cancel" class="btn btn-default">Cancel</button><button type="submit" class="btn btn-primary">Save</button></div></div></form></div>"#
    )
}

fn pref_radios(name: &str, label: &str, options: &[(&str, &str)], selected: &str) -> String {
    let controls = options
        .iter()
        .map(|(value, text)| {
            format!(
                r#"<label class="radio-inline" for="{name}_{value}"><input id="{name}_{value}" type="radio" name="{name}" value="{value}" {checked}> {text}</label>"#,
                checked = if *value == selected { r#"checked="checked""# } else { "" }
            )
        })
        .collect::<Vec<_>>()
        .join("");
    format!(r#"<div class="form-group prefs-radio-group" role="radiogroup"><div class="prefs-control-label">{label}</div>{controls}</div>"#)
}

fn part_js(name: &str) -> String {
    let raw = match name {
        "cardsjs" => include_str!("../../../../web/templates/parts/cardsjs.html"),
        "mailjs" => include_str!("../../../../web/templates/parts/mailjs.html"),
        "mailmessagejs" => include_str!("../../../../web/templates/parts/mailmessagejs.html"),
        "mailaccountjs" => include_str!("../../../../web/templates/parts/mailaccountjs.html"),
        _ => "",
    };
    raw.replace("{{ app.url_generator.generate('cards.list') }}", "/cards/list")
        .replace("{{ app.url_generator.generate('cards.delete') }}", "/cards/delete")
        .replace("{{ app.url_generator.generate('cards.save') }}", "/cards/save")
        .replace("{{ app.url_generator.generate('cards.update') }}", "/cards/update")
        .replace("{{ app.url_generator.generate('mail.read') }}", "/mail/read")
        .replace("{{ app.url_generator.generate('mail.attachment') }}", "/mail/attachment")
        .replace("{{ app.url_generator.generate('mail.accounts') }}", "/mail/accounts")
        .replace("{{ app.url_generator.generate('mail.messages') }}", "/mail/messages")
        .replace("{{ app.url_generator.generate('mail.messages.sync') }}", "/mail/messages/sync")
        .replace("{{ app.url_generator.generate('mail.message.navigation') }}", "/mail/message/navigation")
        .replace("{{ app.url_generator.generate('preferences') }}", "/preferences")
        .replace("{{ 'labels.delete'|trans }}", "Delete")
        .replace("{{ 'labels.mail'|trans }}", "Mail")
        .replace("{% trans %}labels.cancel{% endtrans %}", "Cancel")
        .replace("{% trans %}labels.save{% endtrans %}", "Save")
        .replace("{{ app.url_generator.generate('mail.accounts.save') }}", "/mail/accounts/save")
}

fn escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use axum::http::Method;
    use base64::Engine;
    use std::sync::Mutex;
    use tower::ServiceExt;

    struct FakeMailBackend {
        messages: Mutex<Vec<MailMessage>>,
        seen_updates: Mutex<Vec<(u64, bool)>>,
    }

    impl FakeMailBackend {
        fn new(messages: Vec<MailMessage>) -> Self {
            Self {
                messages: Mutex::new(messages),
                seen_updates: Mutex::new(Vec::new()),
            }
        }

        fn seen_updates(&self) -> Vec<(u64, bool)> {
            self.seen_updates.lock().unwrap().clone()
        }
    }

    impl MailBackend for FakeMailBackend {
        fn fetch_inbox_overview(&self, _account: &MailAccount) -> Result<Vec<MailMessage>, MailBackendError> {
            let mut messages = self.messages.lock().unwrap().clone();
            messages.sort_by(|a, b| b.uid.cmp(&a.uid));
            Ok(messages)
        }

        fn fetch_message(&self, _account: &MailAccount, uid: u64) -> Result<MailMessage, MailBackendError> {
            self.messages
                .lock()
                .unwrap()
                .iter()
                .find(|message| message.uid == uid)
                .cloned()
                .ok_or_else(|| MailBackendError::NotFound("Message not found".to_string()))
        }

        fn download_attachment(
            &self,
            _account: &MailAccount,
            uid: u64,
            part: &str,
        ) -> Result<imap_backend::AttachmentDownload, MailBackendError> {
            if uid == 9 && part == "2" {
                return Ok(imap_backend::AttachmentDownload {
                    filename: "report.txt".to_string(),
                    content_type: "text/plain".to_string(),
                    bytes: b"report".to_vec(),
                });
            }
            Err(MailBackendError::NotFound("Attachment not found".to_string()))
        }

        fn mark_seen(&self, _account: &MailAccount, uid: u64, seen: bool) -> Result<(), MailBackendError> {
            self.seen_updates.lock().unwrap().push((uid, seen));
            Ok(())
        }
    }

    fn test_auth_config(password: &str, password_hash: &str) -> Config {
        let mut config = Config::for_tests("postgres://localhost/caldaver_test".to_string());
        config.auth_username = "local-user".to_string();
        config.auth_password = password.to_string();
        config.auth_password_hash = password_hash.to_string();
        config
    }

    fn encoded_test_hash(password: &str) -> String {
        let salt = b"0123456789abcdef";
        let iterations = 2;
        let digest = pbkdf2_sha256(password.as_bytes(), salt, iterations, 32);
        format!(
            "pbkdf2-sha256${iterations}${}${}",
            base64::engine::general_purpose::STANDARD.encode(salt),
            base64::engine::general_purpose::STANDARD.encode(digest)
        )
    }

    #[test]
    fn local_auth_accepts_pbkdf2_sha256_password_hash() {
        let config = test_auth_config("", &encoded_test_hash("correct horse battery staple"));

        assert!(verify_local_auth_password(&config, "correct horse battery staple"));
        assert!(!verify_local_auth_password(&config, "wrong password"));
    }

    #[test]
    fn local_auth_hash_takes_precedence_over_legacy_plaintext_password() {
        let config = test_auth_config("legacy-plaintext", &encoded_test_hash("hash-password"));

        assert!(verify_local_auth_password(&config, "hash-password"));
        assert!(!verify_local_auth_password(&config, "legacy-plaintext"));
    }

    #[test]
    fn local_auth_plaintext_password_still_works_without_hash() {
        let config = test_auth_config("legacy-plaintext", "");

        assert!(verify_local_auth_password(&config, "legacy-plaintext"));
        assert!(!verify_local_auth_password(&config, "wrong-password"));
    }

    #[test]
    fn local_auth_rejects_malformed_password_hashes() {
        for encoded in [
            "",
            "sha256$2$MDEyMzQ1Njc4OWFiY2RlZg==$bad",
            "pbkdf2-sha256$0$MDEyMzQ1Njc4OWFiY2RlZg==$bad",
            "pbkdf2-sha256$2000001$MDEyMzQ1Njc4OWFiY2RlZg==$bad",
            "pbkdf2-sha256$2$short$bad",
        ] {
            let config = test_auth_config("", encoded);
            assert!(!verify_local_auth_password(&config, "anything"));
        }
    }

    fn no_allowed_hosts() -> Vec<String> {
        Vec::new()
    }

    #[test]
    fn dav_server_url_rejects_private_and_loopback_hosts_by_default() {
        for url in [
            "https://10.20.30.40/",
            "https://192.168.1.10/dav/",
            "http://127.0.0.1/",
            "https://localhost/dav/",
            "https://foo.localhost/",
            "https://[::1]/",
        ] {
            assert!(validated_dav_server_url(url, &no_allowed_hosts()).is_err(), "{url} should be rejected");
        }
    }

    #[test]
    fn dav_server_url_allows_allowlisted_private_ip() {
        let allowed = vec!["10.20.30.40".to_string()];
        assert_eq!(
            validated_dav_server_url("https://10.20.30.40/dav/", &allowed).unwrap(),
            "https://10.20.30.40/dav/"
        );
        // Other private addresses stay blocked.
        assert!(validated_dav_server_url("https://10.20.30.41/dav/", &allowed).is_err());
    }

    #[test]
    fn dav_server_url_allowlisted_host_skips_dns_resolution() {
        // `.invalid` never resolves, so success proves DNS resolution was skipped.
        let allowed = vec!["radicale.homelab.invalid".to_string()];
        assert_eq!(
            validated_dav_server_url("https://Radicale.HomeLab.invalid/radicale/", &allowed).unwrap(),
            "https://radicale.homelab.invalid/radicale/"
        );
        assert!(validated_dav_server_url("https://radicale.homelab.invalid/", &no_allowed_hosts()).is_err());
    }

    #[test]
    fn dav_server_url_allowlist_match_is_case_insensitive() {
        let allowed = vec!["LocalHost".to_string()];
        assert!(validated_dav_server_url("https://localhost/dav/", &allowed).is_ok());
    }

    #[test]
    fn dav_server_url_allowlisted_host_still_requires_scheme_and_no_credentials() {
        let allowed = vec!["radicale.homelab.invalid".to_string()];
        assert!(validated_dav_server_url("ftp://radicale.homelab.invalid/", &allowed).is_err());
        assert!(validated_dav_server_url("https://user:pass@radicale.homelab.invalid/", &allowed).is_err());
        assert!(validated_dav_server_url("https://user@radicale.homelab.invalid/", &allowed).is_err());
    }

    #[test]
    fn allowed_dav_hosts_includes_configured_dav_servers_and_allowlist() {
        let mut config = Config::for_tests("postgres://localhost/caldaver_test".to_string());
        config.caldav_server = "https://Radicale.example.invalid/radicale/%u/".to_string();
        config.carddav_server = "https://cards.example.org/dav/".to_string();
        config.dav_host_allowlist = vec!["Extra.Example.NET".to_string()];

        let hosts = allowed_dav_hosts(&config);
        assert!(hosts.contains(&"radicale.example.invalid".to_string()));
        assert!(hosts.contains(&"cards.example.org".to_string()));
        assert!(hosts.contains(&"extra.example.net".to_string()));

        assert!(validated_dav_server_url("https://radicale.example.invalid/radicale/", &hosts).is_ok());
    }

    #[test]
    fn allowed_dav_hosts_skips_unparseable_configured_servers() {
        let mut config = Config::for_tests("postgres://localhost/caldaver_test".to_string());
        config.caldav_server = "not a url at all".to_string();
        config.carddav_server = String::new();
        config.dav_host_allowlist = vec!["dav.example.org".to_string()];

        assert_eq!(allowed_dav_hosts(&config), vec!["dav.example.org".to_string()]);
    }

    fn fake_account() -> MailAccount {
        imap_backend::install_test_password_key();
        MailAccount {
            id: 1,
            label: "Inbox".to_string(),
            email_address: "ada@example.test".to_string(),
            imap_host: "8.8.8.8".to_string(),
            imap_port: 993,
            encryption: "ssl".to_string(),
            username: "ada".to_string(),
            password_sealed: SealedPassword::seal("secret").unwrap(),
            password_needs_reset: false,
            refresh_interval_seconds: 60,
        }
    }

    fn fake_message(uid: u64, seen: bool) -> MailMessage {
        MailMessage {
            uid,
            from_header: "Ada <ada@example.test>".to_string(),
            subject: format!("Message {uid}"),
            date: "Mon, 01 Jan 2024 00:00:00 +0000".to_string(),
            seen,
            attachments: Vec::new(),
            body: "Body".to_string(),
            html_body: String::new(),
        }
    }

    fn fake_event(all_day: bool) -> CalendarEvent {
        CalendarEvent {
            id: "event-1".to_string(),
            uid: "event-1".to_string(),
            title: "Updated".to_string(),
            start: "2026-06-01".to_string(),
            end: "2026-06-01".to_string(),
            all_day,
            calendar: "/calendars/test/".to_string(),
            href: "/calendars/test/event-1.ics".to_string(),
            etag: "\"etag\"".to_string(),
            editable: true,
            color: "#03A9F4".to_string(),
            location: "Room".to_string(),
            description: "Description".to_string(),
            timezone: DEFAULT_TIMEZONE.to_string(),
        }
    }

    async fn test_state() -> Option<AppState> {
        imap_backend::install_test_password_key();
        let database_url = std::env::var("CALDAVER_TEST_DATABASE_URL").ok()?;
        let config = Config::for_tests(database_url);
        let storage = Storage::connect(&config.database_url, config.csrf_secret.clone())
            .await
            .ok()?;
        Some(AppState {
            config,
            storage,
            mail_backend: Arc::new(ImapMailBackend),
        })
    }

    async fn logged_in_cookie(app: &Router) -> String {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/login")
                    .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
                    .body(Body::from("user=demo&password=secret"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SEE_OTHER);
        response.headers()[header::SET_COOKIE]
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_string()
    }

    #[tokio::test]
    async fn serves_health_from_rust_backend() {
        let Some(state) = test_state().await else { return; };
        let app = build_router(state);
        let response = app
            .oneshot(Request::builder().uri("/__rust/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn login_sets_stable_session_cookie() {
        let Some(state) = test_state().await else { return; };
        let app = build_router(state);
        let cookie = logged_in_cookie(&app).await;
        assert!(cookie.starts_with("caldaver_sess="));
    }

    #[tokio::test]
    async fn authenticated_calendar_list_matches_legacy_shape() {
        let Some(state) = test_state().await else { return; };
        let app = build_router(state);
        let cookie = logged_in_cookie(&app).await;
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/calendars")
                    .header(header::COOKIE, cookie)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn protected_json_routes_return_unauthorized_without_session() {
        let Some(state) = test_state().await else { return; };
        let app = build_router(state);
        let response = app
            .oneshot(Request::builder().uri("/calendars").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn fake_mail_backend_exercises_sync_read_attachment_and_flags_without_credentials() {
        let fake = Arc::new(FakeMailBackend::new(vec![
            fake_message(2, true),
            fake_message(9, false),
        ]));
        let backend: Arc<dyn MailBackend> = fake.clone();
        let account = fake_account();

        let overview = run_mail_backend(backend.clone(), account.clone(), |backend, account| {
            backend.fetch_inbox_overview(account)
        })
        .await
        .unwrap();
        assert_eq!(overview.iter().map(|message| message.uid).collect::<Vec<_>>(), vec![9, 2]);

        let message = run_mail_backend(backend.clone(), account.clone(), |backend, account| {
            backend.fetch_message(account, 9)
        })
        .await
        .unwrap();
        assert_eq!(message.subject, "Message 9");

        let attachment = run_mail_backend(backend.clone(), account.clone(), |backend, account| {
            backend.download_attachment(account, 9, "2")
        })
        .await
        .unwrap();
        assert_eq!(attachment.bytes, b"report");

        run_mail_backend(backend, account, |backend, account| {
            backend.mark_seen(account, 9, false)
        })
        .await
        .unwrap();
        assert_eq!(fake.seen_updates(), vec![(9, false)]);
    }

    #[test]
    fn caldav_event_serialization_preserves_properties_and_all_day_dates() {
        let event = fake_event(true);
        let icalendar = icalendar_from_event(&event);
        assert!(icalendar.contains("DTSTART;VALUE=DATE:20260601"));
        assert!(icalendar.contains("DTEND;VALUE=DATE:20260602"));
        assert!(!icalendar.contains("T000000Z"));

        let original = concat!(
            "BEGIN:VCALENDAR\r\n",
            "VERSION:2.0\r\n",
            "BEGIN:VEVENT\r\n",
            "UID:event-1\r\n",
            "SUMMARY:Original\r\n",
            "RRULE:FREQ=DAILY;COUNT=3\r\n",
            "CLASS:PRIVATE\r\n",
            "BEGIN:VALARM\r\n",
            "TRIGGER:-PT15M\r\n",
            "END:VALARM\r\n",
            "END:VEVENT\r\n",
            "END:VCALENDAR\r\n"
        );
        let merged = merge_icalendar_from_event(original, &event);
        assert!(merged.contains("SUMMARY:Updated"));
        assert!(merged.contains("RRULE:FREQ=DAILY;COUNT=3"));
        assert!(merged.contains("CLASS:PRIVATE"));
        assert!(merged.contains("BEGIN:VALARM"));
    }

    #[test]
    fn caldav_event_merge_does_not_rewrite_vtimezone_dates() {
        let event = fake_event(true);
        let original = concat!(
            "BEGIN:VCALENDAR\r\n",
            "VERSION:2.0\r\n",
            "BEGIN:VTIMEZONE\r\n",
            "TZID:America/Los_Angeles\r\n",
            "BEGIN:STANDARD\r\n",
            "DTSTART:20071104T020000\r\n",
            "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU\r\n",
            "TZNAME:PST\r\n",
            "TZOFFSETFROM:-0700\r\n",
            "TZOFFSETTO:-0800\r\n",
            "END:STANDARD\r\n",
            "BEGIN:DAYLIGHT\r\n",
            "DTSTART:20070311T020000\r\n",
            "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU\r\n",
            "TZNAME:PDT\r\n",
            "TZOFFSETFROM:-0800\r\n",
            "TZOFFSETTO:-0700\r\n",
            "END:DAYLIGHT\r\n",
            "END:VTIMEZONE\r\n",
            "BEGIN:VEVENT\r\n",
            "UID:event-1\r\n",
            "SUMMARY:Original\r\n",
            "DTSTART;TZID=America/Los_Angeles:20260601T090000\r\n",
            "DTEND;TZID=America/Los_Angeles:20260601T100000\r\n",
            "BEGIN:VALARM\r\n",
            "DESCRIPTION:Reminder\r\n",
            "END:VALARM\r\n",
            "END:VEVENT\r\n",
            "END:VCALENDAR\r\n"
        );

        let merged = merge_icalendar_from_event(original, &event);

        assert!(merged.contains("BEGIN:VTIMEZONE"));
        assert!(merged.contains("DTSTART:20071104T020000"));
        assert!(merged.contains("DTSTART:20070311T020000"));
        assert!(!merged.contains("BEGIN:STANDARD\r\nDTSTART;VALUE=DATE"));
        assert!(!merged.contains("BEGIN:DAYLIGHT\r\nDTSTART;VALUE=DATE"));
        assert!(merged.contains("DTSTART;VALUE=DATE:20260601"));
        assert!(merged.contains("DTEND;VALUE=DATE:20260602"));
        assert!(merged.contains("BEGIN:VALARM"));
        assert!(merged.contains("DESCRIPTION:Reminder"));
    }

    #[test]
    fn caldav_event_serialization_preserves_selected_timezone() {
        let mut event = fake_event(false);
        event.start = "2026-01-15T17:00:00Z".to_string();
        event.end = "2026-01-15T18:00:00Z".to_string();
        event.timezone = "America/Los_Angeles".to_string();

        let icalendar = icalendar_from_event(&event);

        assert!(icalendar.contains("DTSTART;TZID=America/Los_Angeles:20260115T090000"));
        assert!(icalendar.contains("DTEND;TZID=America/Los_Angeles:20260115T100000"));
        assert!(!icalendar.contains("DTSTART:20260115T170000Z"));
    }

    #[test]
    fn caldav_event_parsing_ignores_vtimezone_dates() {
        let mut object = CalendarObject::new("/user/calendar/event.ics");
        object.set_etag(Some("\"etag\"".to_string()));
        object.set_rendered_event(
            concat!(
                "BEGIN:VCALENDAR\r\n",
                "BEGIN:VTIMEZONE\r\n",
                "TZID:America/Los_Angeles\r\n",
                "BEGIN:STANDARD\r\n",
                "DTSTART:20071104T020000\r\n",
                "END:STANDARD\r\n",
                "END:VTIMEZONE\r\n",
                "BEGIN:VEVENT\r\n",
                "UID:event-1\r\n",
                "SUMMARY:One hour event\r\n",
                "DTSTART;TZID=America/Los_Angeles:20260528T190000\r\n",
                "DTEND;TZID=America/Los_Angeles:20260528T200000\r\n",
                "END:VEVENT\r\n",
                "END:VCALENDAR\r\n"
            )
            .to_string(),
        );

        let event = event_payload_from_object(&object, "/user/calendar/").unwrap();
        assert_eq!(event.start, "2026-05-28T19:00:00Z");
        assert_eq!(event.end, "2026-05-28T20:00:00Z");
        assert!(!event.all_day);
    }

    #[test]
    fn caldav_resize_only_changes_end_and_recurrence_delete_adds_exdate() {
        let mut event = CalendarEvent {
            start: "2026-06-01T10:00:00Z".to_string(),
            end: "2026-06-01T11:00:00Z".to_string(),
            all_day: false,
            ..fake_event(false)
        };
        apply_event_time_delta(&mut event, &HashMap::from([("delta".to_string(), "30".to_string())]), true);
        assert_eq!(event.start, "2026-06-01T10:00:00Z");
        assert_eq!(event.end, "2026-06-01T11:30:00+00:00");

        let updated = add_recurrence_exdate(
            "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:event-1\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
            "2026-06-02",
        );
        assert!(updated.contains("EXDATE:20260602"));
    }

    #[test]
    fn calendar_urls_are_uuid_based_and_nojs_parses_truthy_values() {
        let first = new_calendar_url("/calendars/user/", "Work");
        let second = new_calendar_url("/calendars/user/", "Work");
        assert_ne!(first, second);
        assert!(first.starts_with("/calendars/user/"));

        let mut session = test_session_without_storage();
        assert!(!mail_javascript_disabled(&session, &HashMap::from([("nojs".to_string(), "0".to_string())])));
        assert!(mail_javascript_disabled(&session, &HashMap::from([("nojs".to_string(), "true".to_string())])));
        session.preferences.disable_javascript = true;
        assert!(mail_javascript_disabled(&session, &HashMap::new()));
    }

    #[test]
    fn rust_rendered_mail_javascript_has_concrete_route_urls() {
        let mail_js = part_js("mailjs");
        assert!(mail_js.contains(r#"var preferencesUrl = '/preferences';"#));
        assert!(!mail_js.contains("app.url_generator.generate"));
        assert!(!mail_js.contains("{{"));
    }

    #[test]
    fn mail_image_proxy_allows_only_public_http_images() {
        assert!(mail_image_url_allowed(&reqwest::Url::parse("https://example.test/image.png").unwrap()));
        assert!(!mail_image_url_allowed(&reqwest::Url::parse("javascript:alert(1)").unwrap()));
        assert!(!mail_image_url_allowed(&reqwest::Url::parse("http://127.0.0.1/image.png").unwrap()));
        assert!(!mail_image_url_allowed(&reqwest::Url::parse("http://localhost/image.png").unwrap()));
    }

    #[tokio::test]
    async fn rendered_mail_reader_keeps_back_and_unread_controls() {
        let Some(state) = test_state().await else { return; };
        let session = test_session_without_storage();
        let html = render_mail_read(&state, &session, 1, 2);
        assert!(html.contains(r#"id="mail_reader_back""#));
        assert!(html.contains(r#"id="mail_reader_unread""#));
        assert!(!html.contains("compose-button"));
    }

    fn test_session_without_storage() -> Session {
        Session {
            username: "demo".to_string(),
            displayname: "demo".to_string(),
            csrf: "token".to_string(),
            preferences: Preferences::default(),
            dav_username: "demo".to_string(),
            dav_password: "secret".to_string(),
            principal_url: String::new(),
            calendar_home_set: String::new(),
            addressbook_home_set: String::new(),
        }
    }
}
