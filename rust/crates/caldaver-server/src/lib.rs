mod carddav_backend;
pub mod caldav_backend;
mod config;
mod imap_backend;
mod storage;

use crate::caldav_backend::{CalDavAuth, CalDavClient, CalDavConfig, CalDavError};
use crate::config::Config;
use crate::storage::Storage;
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
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::env;
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;
use uuid::Uuid;

const DEFAULT_CALENDAR: &str = "/calendars/default/";

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
            timezone: env::var("CALDAVER_TIMEZONE").unwrap_or_else(|_| "UTC".to_string()),
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
        let storage = Storage::connect(&config.database_url, config.csrf_secret.clone()).await?;
        Ok(Self {
            config,
            storage,
            mail_backend: Arc::new(ImapMailBackend),
        })
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
        .route("/cards/delete", post(cards_delete))
        .route("/mail", get(mail_page))
        .route("/mail/read", get(mail_read_page))
        .route("/mail/accounts", get(mail_accounts))
        .route("/mail/accounts/save", post(mail_account_save))
        .route("/mail/messages", get(mail_messages))
        .route("/mail/messages/sync", get(mail_messages_sync))
        .route("/mail/message", get(mail_message))
        .route("/mail/message/unread", post(mail_mark_unread))
        .route("/mail/attachment", get(mail_attachment))
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
        .fallback_service(ServeDir::new(static_root))
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

async fn login_page(State(state): State<AppState>) -> Html<String> {
    html_response(render_login(&state, None))
}

async fn login_post(State(state): State<AppState>, Form(form): Form<HashMap<String, String>>) -> Response {
    let user = form.get("user").map(String::as_str).unwrap_or("").trim();
    let password = form.get("password").map(String::as_str).unwrap_or("");
    if user.is_empty() || password.is_empty() {
        return Html(render_login(&state, Some("Required fields are missing"))).into_response();
    }
    if !state.config.auth_username.is_empty()
        && (state.config.auth_username != user || state.config.auth_password != password)
    {
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

    match caldav_client_for_session(&state.config, &session) {
        Ok(client) => match client.login().await {
            Ok(dav_session) => {
                session.principal_url = dav_session.principal_url;
                session.calendar_home_set = dav_session.calendar_home_set;
                if let Ok(carddav) = carddav_client_for_session(&state.config, &session) {
                    if let Ok(addressbook_home_set) = carddav.discover_addressbook_home_set().await {
                        session.addressbook_home_set = addressbook_home_set;
                    }
                }
            }
            Err(error) => {
                tracing::warn!(%error, user = %session.username, "CalDAV login failed");
                return Html(render_login(&state, Some("Invalid username or password"))).into_response();
            }
        },
        Err(error) => {
            tracing::error!(%error, "failed to initialize CalDAV client");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    }
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
        HeaderValue::from_str(&format!("caldaver_sess={id}; Path=/; HttpOnly; SameSite=Lax")).unwrap(),
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
        HeaderValue::from_static("caldaver_sess=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"),
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
    html_response(render_preferences(&state, &session)).into_response()
}

async fn preferences_save(State(state): State<AppState>, headers: HeaderMap, Form(form): Form<HashMap<String, String>>) -> Response {
    let Ok((id, mut session)) = session_from(&headers, &state).await else {
        return Redirect::to("/login").into_response();
    };
    if !valid_csrf(&session, &form) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    session.preferences.language = form.get("language").cloned().unwrap_or_else(|| "en".to_string());
    session.preferences.timezone = form.get("timezone").cloned().unwrap_or_else(|| "UTC".to_string());
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

async fn calendars_list(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Ok((_, session)) = ajax_session_from(&headers, &state).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({}))).into_response();
    };
    let client = match caldav_client_for_session(&state.config, &session) {
        Ok(client) => client,
        Err(error) => return caldav_response(error),
    };
    match client.list_calendars(&session.calendar_home_set).await {
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
    let client = match caldav_client_for_session(&state.config, &session) {
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
        .unwrap_or_else(|| new_calendar_url(&session.calendar_home_set, displayname));
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
    let client = match caldav_client_for_session(&state.config, &session) {
        Ok(client) => client,
        Err(error) => return caldav_response(error),
    };
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
    if let Ok(client) = caldav_client_for_session(&state.config, &session) {
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
    };
    if let Ok(client) = caldav_client_for_session(&state.config, &session) {
        let original_calendar = form.get("original_calendar").filter(|value| !value.is_empty());
        let href = form
            .get("href")
            .cloned()
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| format!("{}{}.ics", ensure_slash(&calendar), uid));
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
    if let Ok(client) = caldav_client_for_session(&state.config, &session) {
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
    if let Ok(client) = caldav_client_for_session(&state.config, &session) {
        let calendar = form.get("calendar").cloned().unwrap_or_else(|| DEFAULT_CALENDAR.to_string());
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
    if let Ok(client) = caldav_client_for_session(&state.config, &session) {
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
    if let Ok(carddav) = carddav_client_for_session(&state.config, &session) {
        let addressbooks = match carddav
            .ensure_addressbooks(Some(&session.addressbook_home_set), &session.displayname)
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
    let full_name = form
        .get("full_name")
        .map(|value| value.trim().to_string())
        .unwrap_or_default();
    if full_name.trim().is_empty() {
        return json_error(StatusCode::BAD_REQUEST, "Full name is required");
    }
    if let Ok(carddav) = carddav_client_for_session(&state.config, &session) {
        let input = ContactInput {
            uid: None,
            full_name,
            email: form.get("email").cloned().unwrap_or_default(),
            phone: form.get("phone").cloned().unwrap_or_default(),
            organization: form.get("organization").cloned().unwrap_or_default(),
            job_title: form.get("job_title").cloned().unwrap_or_default(),
        };
        return match carddav.create_contact(&input).await {
            Ok(contact) => Json(json!({"result": "SUCCESS", "data": contact_payload(&contact)})).into_response(),
            Err(error) => json_error(StatusCode::BAD_GATEWAY, &error.to_string()),
        };
    }

    let organization = form.get("organization").cloned().unwrap_or_default();
    let job_title = form.get("job_title").cloned().unwrap_or_default();
    let contact = Contact {
        full_name: full_name.clone(),
        email: form.get("email").cloned().unwrap_or_default(),
        phone: form.get("phone").cloned().unwrap_or_default(),
        organization: organization.clone(),
        job_title: job_title.clone(),
        company_line: [job_title, organization]
            .into_iter()
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
            .join(", "),
        labels: Vec::new(),
        url: format!("/addressbooks/default/{}.vcf", Uuid::new_v4()),
        etag: format!("\"{}\"", Uuid::new_v4()),
    };
    if let Err(error) = state.storage.upsert_contact(&session.username, &contact).await {
        tracing::error!(%error, "failed to save contact to Postgres");
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "Unable to save contact");
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
    if let Ok(carddav) = carddav_client_for_session(&state.config, &session) {
        let Some(url) = form.get("url").filter(|value| !value.is_empty()) else {
            return json_error(StatusCode::BAD_REQUEST, "Contact URL is required");
        };
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
    for field in ["label", "email_address", "imap_host", "username"] {
        if form.get(field).is_none_or(|value| value.trim().is_empty()) {
            return json_error(StatusCode::BAD_REQUEST, "Required mail account fields are missing");
        }
    }
    let id = form.get("id").and_then(|v| v.parse().ok()).unwrap_or(0);
    if id == 0 && form.get("password").is_none_or(|value| value.trim().is_empty()) {
        return json_error(StatusCode::BAD_REQUEST, "A password is required for new mail accounts");
    }
    let account = MailAccount {
        id,
        label: form.get("label").cloned().unwrap_or_default(),
        email_address: form.get("email_address").cloned().unwrap_or_default(),
        imap_host: form.get("imap_host").cloned().unwrap_or_default(),
        imap_port: form.get("imap_port").and_then(|v| v.parse().ok()).unwrap_or(993),
        encryption: form.get("encryption").cloned().unwrap_or_else(|| "ssl".to_string()),
        username: form.get("username").cloned().unwrap_or_default(),
        password_sealed: match SealedPassword::seal(&form.get("password").cloned().unwrap_or_default()) {
            Ok(password) => password,
            Err(error) => return mail_backend_response(error),
        },
        refresh_interval_seconds: form
            .get("refresh_interval_minutes")
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(1)
            .clamp(1, 1440)
            * 60,
    };
    if let Err(error) = imap_backend::validate_account(&account) {
        return mail_backend_response(error);
    }
    match state.storage.save_mail_account(&session.username, &account).await {
        Ok(account) => Json(json!({"result": "SUCCESS", "data": MailAccountPublic::from(&account)})).into_response(),
        Err(crate::storage::StorageError::NotFound) => {
            json_error(StatusCode::NOT_FOUND, "Mail account not found")
        }
        Err(error) => {
            tracing::error!(%error, "failed to save mail account to Postgres");
            json_error(StatusCode::INTERNAL_SERVER_ERROR, "Unable to save mail account")
        }
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

async fn principals(Query(query): Query<HashMap<String, String>>) -> Json<Value> {
    let term = query.get("term").cloned().unwrap_or_default();
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
        "calendar_colors": ["03A9F4","3F51B5","F44336","4CAF50","FFC107","9E9E9E"]
    })
    .to_string()
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
    for line in existing.replace("\r\n", "\n").lines() {
        let property = line
            .split_once(':')
            .map(|(name, _)| name.split(';').next().unwrap_or(name))
            .unwrap_or(line);
        if let Some(index) = replacements
            .iter()
            .position(|(name, _, _)| property.eq_ignore_ascii_case(name))
        {
            let (_, replacement_name, value) = &replacements[index];
            output.push(format!("{replacement_name}:{value}"));
            seen[index] = true;
        } else if line.eq_ignore_ascii_case("END:VEVENT") {
            for (index, (_, replacement_name, value)) in replacements.iter().enumerate() {
                if !seen[index] {
                    output.push(format!("{replacement_name}:{value}"));
                }
            }
            output.push(line.to_string());
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
    } else {
        (
            "DTSTART".to_string(),
            caldav_datetime(&event.start),
            "DTEND".to_string(),
            caldav_datetime(&event.end),
        )
    }
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
        .map(|message| format!(r#"<div class="ui-widget loginerrors"><div class="ui-state-error ui-corner-all"><p>{}</p></div></div>"#, escape(message)))
        .unwrap_or_default();
    layout(
        state,
        "",
        &format!(
            r#"<div class="container"><div class="page-header"><h1>{title}</h1></div>{sidebrand}{error}
<div class="loginform ui-corner-all"><form method="post" action="/login" class="form-horizontal">
<input type="hidden" name="_token" value="">
<div class="form-group"><label class="col-sm-3 control-label" for="user">User name</label><div class="col-sm-9"><input id="user" name="user" class="form-control" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" inputmode="text" enterkeyhint="next" autofocus required></div></div>
<div class="form-group"><label class="col-sm-3 control-label" for="password">Password</label><div class="col-sm-9"><input id="password" name="password" class="form-control" type="password" autocomplete="current-password" enterkeyhint="go" required></div></div>
<input name="login" value="Log in" type="submit" class="btn btn-success"></form></div></div>"#,
            title = escape(&state.config.title),
            sidebrand = sidebrand(),
            error = error_html
        ),
        "",
    )
}

fn render_calendar(state: &AppState, session: &Session) -> String {
    let content = format!(
        r#"{navbar}<div class="container-fluid calendar-shell"><div id="wrapper" class="calendar-layout"><div id="sidebar">{sidebar}<div id="footer"><p>{footer}</p></div></div><div id="content"><div id="calendar_view"></div></div></div></div>"#,
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
        r#"{navbar}<div class="container-fluid mail-shell"><aside class="mail-sidebar">{sidebrand}{appnav}<nav id="mail_accounts" class="mail-accounts" aria-label="Mail accounts"></nav></aside><main class="mail-content"><div class="mail-search-row"><div class="mail-search"><i class="fa fa-search"></i><input id="mail_search" type="search" placeholder="Search mail"></div></div><section class="mail-panel"><div class="mail-toolbar"><h1 id="mail_account_title">Mail</h1><button type="button" id="mail_refresh" title="Refresh"><i class="fa fa-refresh"></i></button></div><div id="mail_empty" class="mail-empty" hidden>Add an IMAP account to download mail.</div><div id="mail_loading" class="mail-empty" hidden>Checking the IMAP server for mail...</div><div id="mail_no_messages" class="mail-empty" hidden>Checking the IMAP server for mail...</div><div id="mail_error" class="mail-error" hidden></div><div id="mail_rows" class="mail-rows"></div></section></main></div>"#,
        navbar = navbar(state, session, "mail"),
        sidebrand = sidebrand(),
        appnav = appnav("mail")
    );
    let bottom = if no_js { String::new() } else { part_js("mailjs") };
    layout(state, "caldaver-mail-page", &content, &bottom)
}

fn render_mail_read(state: &AppState, session: &Session, account_id: u64, uid: u64) -> String {
    let content = format!(
        r#"{navbar}<div class="container-fluid mail-shell mail-read-shell"><aside class="mail-sidebar">{sidebrand}{appnav}</aside><main class="mail-content"><section id="mail_reader" class="mail-reader" data-account-id="{account_id}" data-uid="{uid}" data-message-url="/mail/message" data-messages-url="/mail/messages" data-read-url="/mail/read" data-unread-url="/mail/message/unread" data-inbox-url="/mail" data-attachment-url="/mail/attachment" data-csrf-token="{csrf}"><div class="mail-reader-toolbar"><a href="/mail" id="mail_reader_back" title="Return"><i class="fa fa-arrow-left"></i></a><button type="button" id="mail_reader_refresh" title="Refresh"><i class="fa fa-refresh"></i></button><button type="button" id="mail_reader_unread" title="Mark unread" hidden><i class="fa fa-envelope"></i></button></div><div id="mail_reader_error" class="mail-error" hidden></div><article id="mail_reader_message" class="mail-reader-message" hidden><h1 id="mail_reader_subject"></h1><div class="mail-reader-meta"><div class="mail-reader-avatar" aria-hidden="true"></div><div><strong id="mail_reader_from"></strong><span id="mail_reader_date"></span></div></div><pre id="mail_reader_body"></pre><iframe id="mail_reader_html" class="mail-reader-html" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" title="Mail" hidden></iframe><div id="mail_reader_attachments" class="mail-attachments" data-testid="mail-attachments"></div></article><div id="mail_reader_loading" class="mail-empty">Loading message</div></section></main></div>"#,
        navbar = navbar(state, session, "mail"),
        sidebrand = sidebrand(),
        appnav = appnav("mail"),
        csrf = session.csrf
    );
    layout(state, "caldaver-mail-page", &content, &part_js("mailmessagejs"))
}

fn render_preferences(state: &AppState, session: &Session) -> String {
    let prefs = &session.preferences;
    let content = format!(
        r#"{navbar}<div class="container"><h1>Preferences</h1><div class="preferences-container"><form method="post" id="prefs_form"><input type="hidden" name="_token" value="{csrf}">
<fieldset class="prefs-section"><legend>General options</legend><div class="form-group"><label for="language">Language</label><select class="form-control" id="language" name="language"><option value="en" selected>English</option></select></div>{radio_date}{radio_time}{radio_week}<div class="form-group"><label for="timezone">Timezone</label><select class="form-control" id="timezone" name="timezone"><option value="{timezone}" selected>{timezone}</option><option value="UTC">UTC</option><option value="America/Los_Angeles">America/Los_Angeles</option></select></div></fieldset>
<fieldset class="prefs-section"><legend>Calendars</legend><div class="form-group"><label for="default_calendar">Default calendar</label><select class="form-control" id="default_calendar" name="default_calendar"><option value="{calendar}" selected>Default</option></select></div><div class="form-group"><label for="default_view">Default view</label><select class="form-control" id="default_view" name="default_view"><option value="month" selected>Month</option><option value="week">Week</option><option value="day">Day</option><option value="list">List</option></select></div>{radio_week_nb}{radio_now}<div class="form-group prefs-radio-group" role="radiogroup" aria-labelledby="disable_javascript_label"><div class="prefs-control-label" id="disable_javascript_label">Disable JavaScript</div><label class="radio-inline" for="disable_javascript_yes"><input id="disable_javascript_yes" type="radio" name="disable_javascript" value="true"> Yes</label><label class="radio-inline" for="disable_javascript_no"><input id="disable_javascript_no" type="radio" name="disable_javascript" value="false" checked="checked"> No</label></div><div class="form-group"><label for="list_days">List view days</label><select class="form-control" id="list_days" name="list_days"><option value="7" selected>7 days</option><option value="14">14 days</option><option value="31">31 days</option></select></div></fieldset>
<fieldset class="prefs-section prefs-mail-section"><legend>Mail</legend><div class="form-group"><button type="button" id="mail_account_create" class="btn btn-default prefs-mail-account-create"><i class="fa fa-plus"></i> Add account</button></div></fieldset><div id="prefs_buttons"><input type="submit" class="btn btn-success" value="Save"><a href="/" id="return_button" class="btn btn-default"><i class="fa fa-calendar"></i> Return</a></div></form></div></div>{mail_dialog}"#,
        navbar = navbar(state, session, "calendar"),
        csrf = session.csrf,
        timezone = escape(&prefs.timezone),
        calendar = DEFAULT_CALENDAR,
        radio_date = pref_radios("date_format", "Date format", &[("ymd", "2026-05-30"), ("dmy", "30/05/2026"), ("mdy", "05/30/2026")], &prefs.date_format),
        radio_time = pref_radios("time_format", "Time format", &[("24", "13:00"), ("12", "01:00 pm")], &prefs.time_format),
        radio_week = pref_radios("weekstart", "Week starts on", &[("0", "Sunday"), ("1", "Monday")], &prefs.weekstart.to_string()),
        radio_week_nb = pref_radios("show_week_nb", "Show week numbers", &[("true", "Yes"), ("false", "No")], if prefs.show_week_nb {"true"} else {"false"}),
        radio_now = pref_radios("show_now_indicator", "Show a marker indicating the current time", &[("true", "Yes"), ("false", "No")], if prefs.show_now_indicator {"true"} else {"false"}),
        mail_dialog = mail_account_dialog(&session.csrf)
    );
    layout(state, "", &content, &part_js("mailaccountjs"))
}

fn layout(state: &AppState, body_class: &str, content: &str, bottom: &str) -> String {
    format!(
        r#"<!DOCTYPE html><html lang="en"><head><title>{title}</title><link rel="shortcut icon" href="/img/favicon.ico"><meta http-equiv="content-type" content="text/html; charset=utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link href="/dist/css/caldaver.css" rel="stylesheet" type="text/css"></head><body class="{body_class}">{content}{bottom}</body></html>"#,
        title = escape(&state.config.title),
        body_class = body_class,
        content = content,
        bottom = bottom
    )
}

fn navbar(state: &AppState, session: &Session, active: &str) -> String {
    format!(
        r#"<div class="navbar navbar-default caldaver-topbar" role="navigation"><div class="container-fluid"><details class="mobile-section-menu"><summary aria-label="Sections"><i class="fa fa-bars"></i></summary><nav class="mobile-section-menu-list" aria-label="Application sections">{mobile_links}</nav></details><div class="navbar-header"><button class="topbar-menu" type="button" aria-label="Menu"><i class="fa fa-bars"></i></button><span class="navbar-brand"><span class="caldaver-brand-title">{title}</span></span></div><p class="navbar-text navbar-right" id="loading"><img src="/img/loading.gif" alt=""></p><ul class="nav navbar-nav navbar-right topbar-actions" id="usermenu"><li><a class="prefs" href="/preferences"><i title="Preferences" class="fa fa-lg fa-wrench"></i></a></li><li class="user-menu"><details class="user-menu-dropdown"><summary class="user-pill" aria-label="User menu"><span class="user-pill-label">{displayname}</span><i class="fa fa-caret-down" aria-hidden="true"></i></summary><nav class="user-menu-list" aria-label="User menu"><a class="user-menu-item user-menu-logout" href="/logout"><i class="fa fa-power-off" aria-hidden="true"></i><span>Log out</span></a></nav></details></li></ul></div></div>"#,
        title = escape(&state.config.title),
        displayname = escape(&session.displayname),
        mobile_links = mobile_links(active)
    )
}

fn mobile_links(active: &str) -> String {
    let calendar = format!(
        r#"<details class="mobile-calendar-menu"><summary class="{active}"><i class="fa fa-calendar"></i><span>Calendar</span><i class="fa fa-caret-right mobile-calendar-menu-caret" aria-hidden="true"></i></summary><div class="mobile-calendar-menu-calendars" aria-label="Calendars"><span class="mobile-calendar-menu-empty">Loading calendars...</span></div></details>"#,
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
        r#"<div id="contact_dialog" class="contact-dialog" hidden><form id="contact_form" action="/cards/save" method="post"><input type="hidden" name="_token" value="{csrf}"><div class="contact-dialog-panel"><div class="contact-dialog-header"><h2>Create contact</h2><button type="button" id="contact_cancel_icon" aria-label="Cancel"><i class="fa fa-times"></i></button></div><label><span>Name</span><input required name="full_name" type="text" autocomplete="name"></label><label><span>Email</span><input name="email" type="email" autocomplete="email"></label><label><span>Phone number</span><input name="phone" type="tel" autocomplete="tel"></label><label><span>Company</span><input name="organization" type="text" autocomplete="organization"></label><label><span>Job title</span><input name="job_title" type="text" autocomplete="organization-title"></label><div class="contact-dialog-footer"><button type="button" id="contact_cancel" class="btn btn-default">Cancel</button><button type="submit" class="btn btn-primary">Save</button></div></div></form></div>"#
    )
}

fn mail_account_dialog(csrf: &str) -> String {
    format!(
        r#"<div id="mail_account_dialog" class="contact-dialog" hidden><form id="mail_account_form" action="/mail/accounts/save" method="post"><input type="hidden" name="_token" value="{csrf}"><input type="hidden" name="id" value=""><div class="contact-dialog-panel"><div class="contact-dialog-header"><h2>Add account</h2><button type="button" id="mail_account_cancel_icon" aria-label="Cancel"><i class="fa fa-times"></i></button></div><label><span>Account name</span><input required name="label" type="text" autocomplete="organization"></label><label><span>Email address</span><input required name="email_address" type="email" autocomplete="email"></label><label><span>IMAP host</span><input required name="imap_host" type="text" autocomplete="off"></label><label><span>IMAP port</span><input required name="imap_port" type="number" min="1" max="65535" value="993"></label><label><span>Encryption</span><select name="encryption"><option value="ssl">SSL</option><option value="tls">STARTTLS</option><option value="none">None</option></select></label><label><span>User name</span><input required name="username" type="text" autocomplete="username"></label><label><span>Password</span><input required name="password" type="password" autocomplete="current-password"></label><label><span>Auto refresh minutes</span><input required name="refresh_interval_minutes" type="number" min="1" max="1440" value="1"></label><div id="mail_account_error" class="mail-error" hidden></div><div class="contact-dialog-footer"><button type="button" id="mail_account_cancel" class="btn btn-default">Cancel</button><button type="submit" class="btn btn-primary">Save</button></div></div></form></div>"#
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
        .replace("{{ app.url_generator.generate('mail.read') }}", "/mail/read")
        .replace("{{ app.url_generator.generate('mail.attachment') }}", "/mail/attachment")
        .replace("{{ app.url_generator.generate('mail.accounts') }}", "/mail/accounts")
        .replace("{{ app.url_generator.generate('mail.messages') }}", "/mail/messages")
        .replace("{{ app.url_generator.generate('mail.messages.sync') }}", "/mail/messages/sync")
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

    fn fake_account() -> MailAccount {
        MailAccount {
            id: 1,
            label: "Inbox".to_string(),
            email_address: "ada@example.test".to_string(),
            imap_host: "8.8.8.8".to_string(),
            imap_port: 993,
            encryption: "ssl".to_string(),
            username: "ada".to_string(),
            password_sealed: SealedPassword::seal("secret").unwrap(),
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
        }
    }

    async fn test_state() -> Option<AppState> {
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
                    .body(Body::from("user=bruce&password=secret"))
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
            username: "bruce".to_string(),
            displayname: "bruce".to_string(),
            csrf: "token".to_string(),
            preferences: Preferences::default(),
            dav_username: "bruce".to_string(),
            dav_password: "secret".to_string(),
            principal_url: String::new(),
            calendar_home_set: String::new(),
            addressbook_home_set: String::new(),
        }
    }
}
