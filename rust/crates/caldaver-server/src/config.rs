use std::env;
use std::time::Duration;

#[derive(Clone, Debug)]
pub struct Config {
    pub title: String,
    pub footer: String,
    pub auth_username: String,
    pub auth_password: String,
    pub caldav_server: String,
    pub carddav_server: String,
    pub caldav_public_url: String,
    pub caldav_username: String,
    pub caldav_password: String,
    pub caldav_auth_method: String,
    pub caldav_connect_timeout: Duration,
    pub caldav_response_timeout: Duration,
    pub caldav_certificate_verify: bool,
    pub database_url: String,
    pub csrf_secret: String,
    pub session_lifetime: Duration,
    pub cookie_secure: bool,
    pub logout_redirection: Option<String>,
    pub static_root: String,
    pub timezone: String,
    pub language: String,
    pub weekstart: u8,
    pub default_view: String,
    pub disable_javascript: bool,
    pub calendar_sharing: bool,
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        let caldav_server = required_env("CALDAVER_CALDAV_SERVER")?;
        let database_url = database_url()?;
        let csrf_secret = required_env("CALDAVER_CSRF_SECRET")?;
        Ok(Self {
            title: env_value("CALDAVER_TITLE", "Caldaver"),
            footer: env_value("CALDAVER_FOOTER", "Caldaver"),
            auth_username: env::var("CALDAVER_AUTH_USERNAME").unwrap_or_default(),
            auth_password: env::var("CALDAVER_AUTH_PASSWORD").unwrap_or_default(),
            carddav_server: env::var("CALDAVER_CARDDAV_SERVER").unwrap_or_else(|_| caldav_server.clone()),
            caldav_public_url: env::var("CALDAVER_CALDAV_PUBLIC_URL").unwrap_or_else(|_| caldav_server.clone()),
            caldav_username: env::var("CALDAVER_CALDAV_USERNAME").unwrap_or_default(),
            caldav_password: env::var("CALDAVER_CALDAV_PASSWORD").unwrap_or_default(),
            caldav_auth_method: env_value("CALDAVER_CALDAV_AUTHMETHOD", "basic"),
            caldav_connect_timeout: Duration::from_secs(env_u64("CALDAVER_CALDAV_CONNECT_TIMEOUT", 10)),
            caldav_response_timeout: Duration::from_secs(env_u64("CALDAVER_CALDAV_RESPONSE_TIMEOUT", 30)),
            caldav_certificate_verify: env_bool("CALDAVER_CALDAV_CERTIFICATE_VERIFY", true),
            database_url,
            csrf_secret,
            session_lifetime: Duration::from_secs(env_u64("CALDAVER_SESSION_LIFETIME", 2_592_000)),
            cookie_secure: env_bool("CALDAVER_COOKIE_SECURE", true),
            logout_redirection: env::var("CALDAVER_LOGOUT_REDIRECTION")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            static_root: env_value("CALDAVER_STATIC_ROOT", "web/public"),
            timezone: env_value("CALDAVER_TIMEZONE", "UTC"),
            language: env_value("CALDAVER_LANG", "en"),
            weekstart: env_u64("CALDAVER_WEEKSTART", 0).min(6) as u8,
            default_view: env_value("CALDAVER_DEFAULT_VIEW", "month"),
            disable_javascript: env_bool("CALDAVER_DISABLE_JAVASCRIPT", false),
            calendar_sharing: env_bool("CALDAVER_CALENDAR_SHARING", false),
            caldav_server,
        })
    }

    #[cfg(test)]
    pub fn for_tests(database_url: String) -> Self {
        Self {
            title: "Caldaver".to_string(),
            footer: "Caldaver".to_string(),
            auth_username: String::new(),
            auth_password: String::new(),
            caldav_server: "https://example.test/dav/".to_string(),
            carddav_server: "https://example.test/dav/".to_string(),
            caldav_public_url: "https://example.test/dav/".to_string(),
            caldav_username: String::new(),
            caldav_password: String::new(),
            caldav_auth_method: "basic".to_string(),
            caldav_connect_timeout: Duration::from_secs(1),
            caldav_response_timeout: Duration::from_secs(1),
            caldav_certificate_verify: true,
            database_url,
            csrf_secret: "test-secret".to_string(),
            session_lifetime: Duration::from_secs(3600),
            cookie_secure: false,
            logout_redirection: None,
            static_root: "web/public".to_string(),
            timezone: "UTC".to_string(),
            language: "en".to_string(),
            weekstart: 0,
            default_view: "month".to_string(),
            disable_javascript: false,
            calendar_sharing: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigError {
    message: String,
}

impl ConfigError {
    fn new(message: impl Into<String>) -> Self {
        Self { message: message.into() }
    }
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ConfigError {}

fn required_env(name: &str) -> Result<String, ConfigError> {
    env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ConfigError::new(format!("{name} is required")))
}

fn database_url() -> Result<String, ConfigError> {
    if let Ok(url) = env::var("CALDAVER_DATABASE_URL") {
        if !url.trim().is_empty() {
            return Ok(url);
        }
    }

    let host = required_env("CALDAVER_DB_HOST")?;
    let name = required_env("CALDAVER_DB_NAME")?;
    let user = required_env("CALDAVER_DB_USER")?;
    let password = required_env("CALDAVER_DB_PASSWORD")?;
    let port = env_value("CALDAVER_DB_PORT", "5432");
    Ok(format!(
        "postgres://{}:{}@{}:{}/{}",
        user,
        percent_encode(&password),
        host,
        port,
        name
    ))
}

fn env_value(name: &str, default: &str) -> String {
    env::var(name).unwrap_or_else(|_| default.to_string())
}

fn env_u64(name: &str, default: u64) -> u64 {
    env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn env_bool(name: &str, default: bool) -> bool {
    env::var(name)
        .ok()
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(default)
}

fn percent_encode(input: &str) -> String {
    urlencoding::encode(input).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_uses_postgres_database_url() {
        let config = Config::for_tests("postgres://user:pass@example.test/caldaver".to_string());

        assert!(config.database_url.starts_with("postgres://"));
        assert_eq!(config.database_url, "postgres://user:pass@example.test/caldaver");
    }
}
