use crate::{CalendarEvent, Contact, MailAccount, MailMessage, Preferences, SealedPassword, Session};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use deadpool_postgres::{Manager, ManagerConfig, Pool, RecyclingMethod};
use serde_json::Value;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio_postgres::{Config as PgConfig, NoTls};

#[derive(Clone)]
pub struct Storage {
    pool: Pool,
    secret: String,
}

impl Storage {
    pub async fn connect(database_url: &str, secret: impl Into<String>) -> Result<Self, StorageError> {
        if !database_url.starts_with("postgres://") && !database_url.starts_with("postgresql://") {
            return Err(StorageError::Config(
                "Caldaver Rust backend requires a Postgres database URL".to_string(),
            ));
        }

        let pg_config: PgConfig = database_url.parse()?;
        let manager_config = ManagerConfig {
            recycling_method: RecyclingMethod::Fast,
        };
        let manager = Manager::from_config(pg_config, NoTls, manager_config);
        let pool = Pool::builder(manager).max_size(16).build()?;
        let storage = Self {
            pool,
            secret: secret.into(),
        };
        storage.migrate().await?;
        Ok(storage)
    }

    async fn migrate(&self) -> Result<(), StorageError> {
        let client = self.pool.get().await?;
        client
            .batch_execute(
                r#"
CREATE TABLE IF NOT EXISTS caldaver_preferences (
    username TEXT PRIMARY KEY,
    preferences JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS caldaver_sessions (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    displayname TEXT NOT NULL,
    csrf TEXT NOT NULL,
    preferences JSONB NOT NULL,
    dav_username TEXT NOT NULL DEFAULT '',
    dav_password_secret TEXT NOT NULL DEFAULT '',
    principal_url TEXT NOT NULL DEFAULT '',
    calendar_home_set TEXT NOT NULL DEFAULT '',
    addressbook_home_set TEXT NOT NULL DEFAULT '',
    expires_at BIGINT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mail_accounts (
    owner TEXT NOT NULL,
    id BIGSERIAL,
    label TEXT NOT NULL,
    email_address TEXT NOT NULL,
    imap_host TEXT NOT NULL,
    imap_port INTEGER NOT NULL,
    encryption TEXT NOT NULL,
    username TEXT NOT NULL,
    password_secret TEXT NOT NULL,
    refresh_interval_seconds BIGINT NOT NULL DEFAULT 60,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(owner, id)
);

CREATE TABLE IF NOT EXISTS mail_message_cache (
    owner TEXT NOT NULL,
    account_id BIGINT NOT NULL,
    uid BIGINT NOT NULL,
    message JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(owner, account_id, uid)
);

CREATE TABLE IF NOT EXISTS caldaver_local_events (
    calendar TEXT NOT NULL,
    uid TEXT NOT NULL,
    event JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(calendar, uid)
);

CREATE TABLE IF NOT EXISTS caldaver_local_contacts (
    owner TEXT NOT NULL,
    url TEXT NOT NULL,
    contact JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(owner, url)
);

ALTER TABLE mail_accounts ADD COLUMN IF NOT EXISTS password_secret TEXT NOT NULL DEFAULT '';
ALTER TABLE mail_message_cache ADD COLUMN IF NOT EXISTS message JSONB;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'mail_accounts' AND column_name = 'password_encrypted'
    ) THEN
        EXECUTE 'UPDATE mail_accounts SET password_secret = password_encrypted WHERE password_secret = '''' AND password_encrypted IS NOT NULL';
    END IF;
END $$;
"#,
            )
            .await?;
        Ok(())
    }

    pub async fn insert_session(
        &self,
        id: &str,
        session: &Session,
        lifetime: Duration,
    ) -> Result<(), StorageError> {
        let client = self.pool.get().await?;
        let expires_at = now_secs() + lifetime.as_secs() as i64;
        let preferences = serde_json::to_value(&session.preferences)?;
        let dav_password_secret = self.seal(&session.dav_password);
        client
            .execute(
                r#"
INSERT INTO caldaver_sessions
(id, username, displayname, csrf, preferences, dav_username, dav_password_secret, principal_url, calendar_home_set, addressbook_home_set, expires_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
ON CONFLICT (id) DO UPDATE SET
username = EXCLUDED.username,
displayname = EXCLUDED.displayname,
csrf = EXCLUDED.csrf,
preferences = EXCLUDED.preferences,
dav_username = EXCLUDED.dav_username,
dav_password_secret = EXCLUDED.dav_password_secret,
principal_url = EXCLUDED.principal_url,
calendar_home_set = EXCLUDED.calendar_home_set,
addressbook_home_set = EXCLUDED.addressbook_home_set,
expires_at = EXCLUDED.expires_at,
updated_at = now()
"#,
                &[
                    &id,
                    &session.username,
                    &session.displayname,
                    &session.csrf,
                    &preferences,
                    &session.dav_username,
                    &dav_password_secret,
                    &session.principal_url,
                    &session.calendar_home_set,
                    &session.addressbook_home_set,
                    &expires_at,
                ],
            )
            .await?;
        Ok(())
    }

    pub async fn session(&self, id: &str) -> Result<Option<Session>, StorageError> {
        let client = self.pool.get().await?;
        let Some(row) = client
            .query_opt(
                r#"
SELECT username, displayname, csrf, preferences, dav_username, dav_password_secret, principal_url, calendar_home_set, addressbook_home_set, expires_at
FROM caldaver_sessions
WHERE id = $1
"#,
                &[&id],
            )
            .await?
        else {
            return Ok(None);
        };

        let expires_at: i64 = row.get("expires_at");
        if expires_at <= now_secs() {
            self.delete_session(id).await?;
            return Ok(None);
        }

        let preferences_json: Value = row.get("preferences");
        let preferences = serde_json::from_value(preferences_json)?;
        let dav_password_secret: String = row.get("dav_password_secret");
        Ok(Some(Session {
            username: row.get("username"),
            displayname: row.get("displayname"),
            csrf: row.get("csrf"),
            preferences,
            dav_username: row.get("dav_username"),
            dav_password: self.open(&dav_password_secret),
            principal_url: row.get("principal_url"),
            calendar_home_set: row.get("calendar_home_set"),
            addressbook_home_set: row.get("addressbook_home_set"),
        }))
    }

    pub async fn delete_session(&self, id: &str) -> Result<(), StorageError> {
        self.pool
            .get()
            .await?
            .execute("DELETE FROM caldaver_sessions WHERE id = $1", &[&id])
            .await?;
        Ok(())
    }

    pub async fn save_preferences(&self, username: &str, preferences: &Preferences) -> Result<(), StorageError> {
        let client = self.pool.get().await?;
        let value = serde_json::to_value(preferences)?;
        client
            .execute(
                r#"
INSERT INTO caldaver_preferences (username, preferences)
VALUES ($1, $2)
ON CONFLICT (username) DO UPDATE SET preferences = EXCLUDED.preferences, updated_at = now()
"#,
                &[&username, &value],
            )
            .await?;
        Ok(())
    }

    pub async fn preferences(&self, username: &str) -> Result<Option<Preferences>, StorageError> {
        let client = self.pool.get().await?;
        let row = client
            .query_opt("SELECT preferences FROM caldaver_preferences WHERE username = $1", &[&username])
            .await?;
        row.map(|row| serde_json::from_value(row.get("preferences")))
            .transpose()
            .map_err(Into::into)
    }

    pub async fn events(&self, calendar: &str) -> Result<Vec<CalendarEvent>, StorageError> {
        let rows = self
            .pool
            .get()
            .await?
            .query(
                "SELECT event FROM caldaver_local_events WHERE calendar = $1 ORDER BY updated_at, uid",
                &[&calendar],
            )
            .await?;
        rows.into_iter()
            .map(|row| serde_json::from_value(row.get("event")).map_err(Into::into))
            .collect()
    }

    pub async fn upsert_event(&self, event: &CalendarEvent) -> Result<(), StorageError> {
        let value = serde_json::to_value(event)?;
        self.pool
            .get()
            .await?
            .execute(
                r#"
INSERT INTO caldaver_local_events (calendar, uid, event)
VALUES ($1, $2, $3)
ON CONFLICT (calendar, uid) DO UPDATE SET event = EXCLUDED.event, updated_at = now()
"#,
                &[&event.calendar, &event.uid, &value],
            )
            .await?;
        Ok(())
    }

    pub async fn delete_event(&self, calendar: &str, uid: &str) -> Result<(), StorageError> {
        self.pool
            .get()
            .await?
            .execute(
                "DELETE FROM caldaver_local_events WHERE calendar = $1 AND uid = $2",
                &[&calendar, &uid],
            )
            .await?;
        Ok(())
    }

    pub async fn event(&self, calendar: &str, uid: &str) -> Result<Option<CalendarEvent>, StorageError> {
        self.pool
            .get()
            .await?
            .query_opt(
                "SELECT event FROM caldaver_local_events WHERE calendar = $1 AND uid = $2",
                &[&calendar, &uid],
            )
            .await?
            .map(|row| serde_json::from_value(row.get("event")).map_err(Into::into))
            .transpose()
    }

    pub async fn contacts(&self, owner: &str) -> Result<Vec<Contact>, StorageError> {
        let rows = self
            .pool
            .get()
            .await?
            .query(
                "SELECT contact FROM caldaver_local_contacts WHERE owner = $1 ORDER BY lower(contact->>'full_name')",
                &[&owner],
            )
            .await?;
        rows.into_iter()
            .map(|row| serde_json::from_value(row.get("contact")).map_err(Into::into))
            .collect()
    }

    pub async fn upsert_contact(&self, owner: &str, contact: &Contact) -> Result<(), StorageError> {
        let value = serde_json::to_value(contact)?;
        self.pool
            .get()
            .await?
            .execute(
                r#"
INSERT INTO caldaver_local_contacts (owner, url, contact)
VALUES ($1, $2, $3)
ON CONFLICT (owner, url) DO UPDATE SET contact = EXCLUDED.contact, updated_at = now()
"#,
                &[&owner, &contact.url, &value],
            )
            .await?;
        Ok(())
    }

    pub async fn delete_contact(&self, owner: &str, url: &str) -> Result<(), StorageError> {
        self.pool
            .get()
            .await?
            .execute(
                "DELETE FROM caldaver_local_contacts WHERE owner = $1 AND url = $2",
                &[&owner, &url],
            )
            .await?;
        Ok(())
    }

    pub async fn mail_accounts(&self, owner: &str) -> Result<Vec<MailAccount>, StorageError> {
        let rows = self
            .pool
            .get()
            .await?
            .query(
                "SELECT id, label, email_address, imap_host, imap_port, encryption, username, password_secret, refresh_interval_seconds FROM mail_accounts WHERE owner = $1 ORDER BY id",
                &[&owner],
            )
            .await?;
        Ok(rows
            .into_iter()
            .map(|row| MailAccount {
                id: row.get::<_, i64>("id") as u64,
                label: row.get("label"),
                email_address: row.get("email_address"),
                imap_host: row.get("imap_host"),
                imap_port: row.get::<_, i32>("imap_port") as u16,
                encryption: row.get("encryption"),
                username: row.get("username"),
                password_sealed: self.open_mail_password(&row.get::<_, String>("password_secret")),
                refresh_interval_seconds: row.get::<_, i64>("refresh_interval_seconds") as u64,
            })
            .collect())
    }

    pub async fn mail_account(&self, owner: &str, id: u64) -> Result<Option<MailAccount>, StorageError> {
        let id_i64 = id as i64;
        Ok(self
            .pool
            .get()
            .await?
            .query_opt(
                "SELECT id, label, email_address, imap_host, imap_port, encryption, username, password_secret, refresh_interval_seconds FROM mail_accounts WHERE owner = $1 AND id = $2",
                &[&owner, &id_i64],
            )
            .await?
            .map(|row| MailAccount {
                id: row.get::<_, i64>("id") as u64,
                label: row.get("label"),
                email_address: row.get("email_address"),
                imap_host: row.get("imap_host"),
                imap_port: row.get::<_, i32>("imap_port") as u16,
                encryption: row.get("encryption"),
                username: row.get("username"),
                password_sealed: self.open_mail_password(&row.get::<_, String>("password_secret")),
                refresh_interval_seconds: row.get::<_, i64>("refresh_interval_seconds") as u64,
            }))
    }

    pub async fn save_mail_account(&self, owner: &str, account: &MailAccount) -> Result<MailAccount, StorageError> {
        let client = self.pool.get().await?;
        let password_secret = self.seal_mail_password(&account.password_sealed);
        let refresh = account.refresh_interval_seconds as i64;
        let id = if account.id == 0 {
            client
                .query_opt(
                    r#"
SELECT id FROM mail_accounts
WHERE owner=$1 AND lower(email_address)=lower($2) AND imap_host=$3 AND imap_port=$4 AND encryption=$5
ORDER BY id LIMIT 1
"#,
                    &[
                        &owner,
                        &account.email_address,
                        &account.imap_host,
                        &(account.imap_port as i32),
                        &account.encryption,
                    ],
                )
                .await?
                .map(|row| row.get::<_, i64>("id") as u64)
                .unwrap_or(0)
        } else {
            account.id
        };
        let row = if id == 0 {
            client
                .query_one(
                    r#"
INSERT INTO mail_accounts (owner, label, email_address, imap_host, imap_port, encryption, username, password_secret, refresh_interval_seconds)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
RETURNING id
"#,
                    &[
                        &owner,
                        &account.label,
                        &account.email_address,
                        &account.imap_host,
                        &(account.imap_port as i32),
                        &account.encryption,
                        &account.username,
                        &password_secret,
                        &refresh,
                    ],
                )
                .await?
        } else {
            let id = id as i64;
            client
                .query_opt(
                    r#"
UPDATE mail_accounts SET
label=$3, email_address=$4, imap_host=$5, imap_port=$6, encryption=$7, username=$8,
password_secret = CASE WHEN $9 = '' THEN password_secret ELSE $9 END,
refresh_interval_seconds=$10, updated_at=now()
WHERE owner=$1 AND id=$2
RETURNING id
"#,
                    &[
                        &owner,
                        &id,
                        &account.label,
                        &account.email_address,
                        &account.imap_host,
                        &(account.imap_port as i32),
                        &account.encryption,
                        &account.username,
                        &password_secret,
                        &refresh,
                    ],
                )
                .await?
                .ok_or(StorageError::NotFound)?
        };
        let mut saved = account.clone();
        saved.id = row.get::<_, i64>("id") as u64;
        Ok(saved)
    }

    pub async fn cached_messages(&self, owner: &str, account_id: u64) -> Result<Vec<MailMessage>, StorageError> {
        let account_id = account_id as i64;
        let rows = self
            .pool
            .get()
            .await?
            .query(
                "SELECT message FROM mail_message_cache WHERE owner=$1 AND account_id=$2 ORDER BY (message->>'date') DESC, uid DESC",
                &[&owner, &account_id],
            )
            .await?;
        rows.into_iter()
            .map(|row| serde_json::from_value(row.get("message")).map_err(Into::into))
            .collect()
    }

    pub async fn replace_message_cache(
        &self,
        owner: &str,
        account_id: u64,
        messages: &[MailMessage],
    ) -> Result<(), StorageError> {
        let mut client = self.pool.get().await?;
        let tx = client.transaction().await?;
        let account_id = account_id as i64;
        tx.execute(
            "DELETE FROM mail_message_cache WHERE owner=$1 AND account_id=$2",
            &[&owner, &account_id],
        )
        .await?;
        for message in messages {
            let uid = message.uid as i64;
            let value = serde_json::to_value(message)?;
            tx.execute(
                "INSERT INTO mail_message_cache (owner, account_id, uid, message) VALUES ($1,$2,$3,$4)",
                &[&owner, &account_id, &uid, &value],
            )
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn cache_message(
        &self,
        owner: &str,
        account_id: u64,
        message: &MailMessage,
    ) -> Result<(), StorageError> {
        let account_id = account_id as i64;
        let uid = message.uid as i64;
        let value = serde_json::to_value(message)?;
        self.pool
            .get()
            .await?
            .execute(
                r#"
INSERT INTO mail_message_cache (owner, account_id, uid, message)
VALUES ($1,$2,$3,$4)
ON CONFLICT (owner, account_id, uid) DO UPDATE SET message=EXCLUDED.message, updated_at=now()
"#,
                &[&owner, &account_id, &uid, &value],
            )
            .await?;
        Ok(())
    }

    pub async fn mark_cached_seen(
        &self,
        owner: &str,
        account_id: u64,
        uid: u64,
        seen: bool,
    ) -> Result<(), StorageError> {
        let account_id = account_id as i64;
        let uid = uid as i64;
        self.pool
            .get()
            .await?
            .execute(
                r#"
UPDATE mail_message_cache
SET message = jsonb_set(message, '{seen}', to_jsonb($4::boolean), true), updated_at = now()
WHERE owner=$1 AND account_id=$2 AND uid=$3
"#,
                &[&owner, &account_id, &uid, &seen],
            )
            .await?;
        Ok(())
    }

    fn seal(&self, value: &str) -> String {
        if value.is_empty() {
            return String::new();
        }
        let key = self.secret.as_bytes();
        if key.is_empty() {
            return BASE64.encode(value.as_bytes());
        }
        let sealed: Vec<u8> = value
            .as_bytes()
            .iter()
            .enumerate()
            .map(|(index, byte)| byte ^ key[index % key.len()])
            .collect();
        BASE64.encode(sealed)
    }

    fn open(&self, value: &str) -> String {
        if value.is_empty() {
            return String::new();
        }
        let Ok(decoded) = BASE64.decode(value) else {
            return String::new();
        };
        let key = self.secret.as_bytes();
        if key.is_empty() {
            return String::from_utf8(decoded).unwrap_or_default();
        }
        let opened: Vec<u8> = decoded
            .iter()
            .enumerate()
            .map(|(index, byte)| byte ^ key[index % key.len()])
            .collect();
        String::from_utf8(opened).unwrap_or_default()
    }

    fn seal_mail_password(&self, password: &SealedPassword) -> String {
        if password.is_empty() {
            String::new()
        } else {
            serde_json::to_string(password).unwrap_or_default()
        }
    }

    fn open_mail_password(&self, value: &str) -> SealedPassword {
        if value.trim().is_empty() {
            return SealedPassword::default();
        }

        serde_json::from_str(value).unwrap_or_else(|_| {
            let opened = self.open(value);
            SealedPassword::seal(&opened).unwrap_or_default()
        })
    }
}

#[derive(Debug)]
pub enum StorageError {
    Config(String),
    NotFound,
    Pool(deadpool_postgres::PoolError),
    BuildPool(deadpool_postgres::BuildError),
    Postgres(tokio_postgres::Error),
    Json(serde_json::Error),
}

impl std::fmt::Display for StorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Config(message) => f.write_str(message),
            Self::NotFound => f.write_str("record not found"),
            Self::Pool(error) => write!(f, "Postgres pool error: {error}"),
            Self::BuildPool(error) => write!(f, "Postgres pool build error: {error}"),
            Self::Postgres(error) => write!(f, "Postgres error: {error}"),
            Self::Json(error) => write!(f, "JSON error: {error}"),
        }
    }
}

impl std::error::Error for StorageError {}

impl From<deadpool_postgres::PoolError> for StorageError {
    fn from(error: deadpool_postgres::PoolError) -> Self {
        Self::Pool(error)
    }
}

impl From<deadpool_postgres::BuildError> for StorageError {
    fn from(error: deadpool_postgres::BuildError) -> Self {
        Self::BuildPool(error)
    }
}

impl From<tokio_postgres::Error> for StorageError {
    fn from(error: tokio_postgres::Error) -> Self {
        Self::Postgres(error)
    }
}

impl From<serde_json::Error> for StorageError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    async fn test_storage() -> Option<Storage> {
        let database_url = std::env::var("CALDAVER_TEST_DATABASE_URL").ok()?;
        Storage::connect(&database_url, "storage-test-secret").await.ok()
    }

    fn unique_name(prefix: &str) -> String {
        format!("{prefix}-{}", Uuid::new_v4())
    }

    fn test_session(username: &str) -> Session {
        Session {
            username: username.to_string(),
            displayname: "Test User".to_string(),
            csrf: "csrf-token".to_string(),
            preferences: Preferences::default(),
            dav_username: format!("{username}-dav"),
            dav_password: "dav-password".to_string(),
            principal_url: "/principals/test/".to_string(),
            calendar_home_set: "/calendars/test/".to_string(),
            addressbook_home_set: "/addressbooks/test/".to_string(),
        }
    }

    fn test_event(calendar: &str, uid: &str) -> CalendarEvent {
        CalendarEvent {
            id: uid.to_string(),
            uid: uid.to_string(),
            title: "Storage event".to_string(),
            start: "2026-05-30T10:00:00Z".to_string(),
            end: "2026-05-30T11:00:00Z".to_string(),
            all_day: false,
            calendar: calendar.to_string(),
            href: format!("{calendar}{uid}.ics"),
            etag: "\"event-etag\"".to_string(),
            editable: true,
            color: "#03A9F4".to_string(),
            location: "Office".to_string(),
            description: "Stored in Postgres".to_string(),
        }
    }

    fn test_contact(owner: &str) -> Contact {
        Contact {
            full_name: "Ada Lovelace".to_string(),
            email: format!("{owner}@example.test"),
            phone: "555-0100".to_string(),
            organization: "Analytical Engines".to_string(),
            job_title: "Programmer".to_string(),
            company_line: "Programmer, Analytical Engines".to_string(),
            labels: vec!["work".to_string()],
            url: format!("/addressbooks/default/{owner}.vcf"),
            etag: "\"contact-etag\"".to_string(),
        }
    }

    fn test_account() -> MailAccount {
        MailAccount {
            id: 0,
            label: "Inbox".to_string(),
            email_address: "ada@example.test".to_string(),
            imap_host: "imap.example.test".to_string(),
            imap_port: 993,
            encryption: "ssl".to_string(),
            username: "ada".to_string(),
            password_sealed: SealedPassword::seal("mail-password").unwrap(),
            refresh_interval_seconds: 60,
        }
    }

    fn test_message(uid: u64, seen: bool) -> MailMessage {
        MailMessage {
            uid,
            from_header: "Ada <ada@example.test>".to_string(),
            subject: format!("Message {uid}"),
            date: "Sat, 30 May 2026 10:00:00 +0000".to_string(),
            seen,
            attachments: Vec::new(),
            body: "Body".to_string(),
            html_body: String::new(),
        }
    }

    #[tokio::test]
    async fn rejects_non_postgres_database_urls() {
        match Storage::connect("mysql://user:pass@example.test/caldaver", "secret").await {
            Ok(_) => panic!("non-Postgres database URL should be rejected"),
            Err(error) => assert!(matches!(error, StorageError::Config(_))),
        }
    }

    #[tokio::test]
    async fn postgres_round_trips_backend_state() {
        let Some(storage) = test_storage().await else { return; };
        let owner = unique_name("postgres-state");
        let session_id = unique_name("session");
        let session = test_session(&owner);

        storage
            .insert_session(&session_id, &session, Duration::from_secs(3600))
            .await
            .unwrap();
        let loaded = storage.session(&session_id).await.unwrap().unwrap();
        assert_eq!(loaded.username, owner);
        assert_eq!(loaded.dav_password, "dav-password");
        storage.delete_session(&session_id).await.unwrap();
        assert!(storage.session(&session_id).await.unwrap().is_none());

        let mut preferences = Preferences::default();
        preferences.default_view = "agendaWeek".to_string();
        preferences.weekstart = 1;
        storage.save_preferences(&owner, &preferences).await.unwrap();
        let loaded_preferences = storage.preferences(&owner).await.unwrap().unwrap();
        assert_eq!(loaded_preferences.default_view, "agendaWeek");
        assert_eq!(loaded_preferences.weekstart, 1);

        let calendar = format!("/calendars/{owner}/");
        let event = test_event(&calendar, "event-1");
        storage.upsert_event(&event).await.unwrap();
        assert_eq!(storage.events(&calendar).await.unwrap().len(), 1);
        assert_eq!(storage.event(&calendar, "event-1").await.unwrap().unwrap().title, "Storage event");
        storage.delete_event(&calendar, "event-1").await.unwrap();
        assert!(storage.event(&calendar, "event-1").await.unwrap().is_none());

        let contact = test_contact(&owner);
        storage.upsert_contact(&owner, &contact).await.unwrap();
        assert_eq!(storage.contacts(&owner).await.unwrap()[0].full_name, "Ada Lovelace");
        storage.delete_contact(&owner, &contact.url).await.unwrap();
        assert!(storage.contacts(&owner).await.unwrap().is_empty());

        let saved_account = storage.save_mail_account(&owner, &test_account()).await.unwrap();
        assert!(saved_account.id > 0);
        let loaded_account = storage
            .mail_account(&owner, saved_account.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(loaded_account.password_sealed.reveal().unwrap(), "mail-password");
        assert_eq!(storage.mail_accounts(&owner).await.unwrap().len(), 1);

        storage
            .replace_message_cache(&owner, saved_account.id, &[test_message(10, true), test_message(11, false)])
            .await
            .unwrap();
        assert_eq!(storage.cached_messages(&owner, saved_account.id).await.unwrap().len(), 2);
        let full_message = test_message(11, true);
        storage.cache_message(&owner, saved_account.id, &full_message).await.unwrap();
        storage
            .mark_cached_seen(&owner, saved_account.id, 11, false)
            .await
            .unwrap();
        let message = storage
            .cached_messages(&owner, saved_account.id)
            .await
            .unwrap()
            .into_iter()
            .find(|message| message.uid == 11)
            .unwrap();
        assert!(!message.seen);

        let mut duplicate = test_account();
        duplicate.label = "Renamed Inbox".to_string();
        duplicate.password_sealed = SealedPassword::default();
        let deduped = storage.save_mail_account(&owner, &duplicate).await.unwrap();
        assert_eq!(deduped.id, saved_account.id);
        let loaded_account = storage
            .mail_account(&owner, saved_account.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(loaded_account.label, "Renamed Inbox");
        assert_eq!(loaded_account.password_sealed.reveal().unwrap(), "mail-password");

        let mut missing = test_account();
        missing.id = 9_999_999_999;
        assert!(matches!(
            storage.save_mail_account(&owner, &missing).await,
            Err(StorageError::NotFound)
        ));
    }
}
