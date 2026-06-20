use crate::{
    CalendarEvent, Contact, MailAccount, MailMessage, Preferences, SealedPassword, Session,
};
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

#[derive(Clone, Debug)]
pub(crate) struct DavAccount {
    pub id: u64,
    pub account_type: String,
    pub label: String,
    pub server_url: String,
    pub auth_method: String,
    pub username: String,
    pub credential_sealed: SealedPassword,
    pub credential_needs_reset: bool,
    pub principal_url: String,
    pub home_set: String,
    pub enabled: bool,
    pub last_error: String,
}

#[derive(Clone, Debug)]
pub(crate) struct SessionDavCredentials {
    pub owner: String,
    pub dav_username: String,
    pub dav_password: String,
    pub principal_url: String,
    pub calendar_home_set: String,
    pub addressbook_home_set: String,
}

impl Storage {
    pub async fn connect(
        database_url: &str,
        secret: impl Into<String>,
    ) -> Result<Self, StorageError> {
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
        storage.reseal_legacy_account_credentials().await?;
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

CREATE TABLE IF NOT EXISTS dav_accounts (
    owner TEXT NOT NULL,
    id BIGSERIAL,
    account_type TEXT NOT NULL CHECK (account_type IN ('calendar', 'carddav')),
    label TEXT NOT NULL,
    server_url TEXT NOT NULL,
    auth_method TEXT NOT NULL DEFAULT 'basic',
    username TEXT NOT NULL DEFAULT '',
    credential_secret TEXT NOT NULL DEFAULT '',
    principal_url TEXT NOT NULL DEFAULT '',
    home_set TEXT NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_error TEXT NOT NULL DEFAULT '',
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
	ALTER TABLE mail_accounts ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;
	ALTER TABLE mail_accounts ADD COLUMN IF NOT EXISTS last_error TEXT NOT NULL DEFAULT '';
	ALTER TABLE mail_message_cache ADD COLUMN IF NOT EXISTS message JSONB;
	ALTER TABLE mail_accounts ALTER COLUMN id TYPE BIGINT;
	ALTER TABLE mail_accounts ALTER COLUMN imap_port TYPE INTEGER;
	ALTER TABLE mail_accounts ALTER COLUMN refresh_interval_seconds TYPE BIGINT;
	ALTER TABLE mail_message_cache ALTER COLUMN account_id TYPE BIGINT;
	ALTER TABLE mail_message_cache ALTER COLUMN uid TYPE BIGINT;
	DO $$
	DECLARE
	    legacy_column TEXT;
	BEGIN
	    FOREACH legacy_column IN ARRAY ARRAY['from_header', 'subject', 'date_header', 'attachments']
	    LOOP
	        IF EXISTS (
	            SELECT 1 FROM information_schema.columns
	            WHERE table_name = 'mail_message_cache'
	              AND column_name = legacy_column
	        ) THEN
	            EXECUTE format('ALTER TABLE mail_message_cache ALTER COLUMN %I DROP NOT NULL', legacy_column);
	        END IF;
	    END LOOP;
	END $$;

	DO $$
	BEGIN
	    IF NOT EXISTS (
	        SELECT 1 FROM pg_constraint
	        WHERE conrelid = 'mail_message_cache'::regclass
	          AND conname = 'uniq_mail_message_cache_owner_account_uid'
	    ) THEN
	        EXECUTE 'ALTER TABLE mail_message_cache ADD CONSTRAINT uniq_mail_message_cache_owner_account_uid UNIQUE (owner, account_id, uid)';
	    END IF;
	END $$;

	DO $$
	BEGIN
	    IF EXISTS (
	        SELECT 1 FROM information_schema.columns
	        WHERE table_name = 'mail_message_cache'
	          AND column_name = 'message'
	          AND data_type <> 'jsonb'
	    ) THEN
	        BEGIN
	            EXECUTE 'ALTER TABLE mail_message_cache ALTER COLUMN message TYPE JSONB USING message::jsonb';
	        EXCEPTION WHEN others THEN
	            EXECUTE 'DELETE FROM mail_message_cache';
	            EXECUTE 'ALTER TABLE mail_message_cache ALTER COLUMN message TYPE JSONB USING message::jsonb';
	        END;
	    END IF;
	END $$;

	DELETE FROM mail_message_cache WHERE message IS NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'mail_accounts' AND column_name = 'password_encrypted'
    ) THEN
        EXECUTE 'UPDATE mail_accounts SET password_secret = password_encrypted WHERE password_secret = '''' AND password_encrypted IS NOT NULL';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_dav_accounts_owner_type_server_user
ON dav_accounts (owner, account_type, lower(server_url), lower(username));
"#,
            )
            .await?;
        Ok(())
    }

    async fn reseal_legacy_account_credentials(&self) -> Result<(), StorageError> {
        let client = self.pool.get().await?;

        for row in client
            .query(
                "SELECT owner, id::BIGINT AS id, password_secret FROM mail_accounts WHERE password_secret <> ''",
                &[],
            )
            .await?
        {
            let owner: String = row.get("owner");
            let id: i64 = row.get("id");
            let raw_secret: String = row.get("password_secret");
            let (password, needs_reset) = self.open_mail_password(&raw_secret);
            if needs_reset && !password.is_empty() {
                let resealed = self.seal_mail_password(&password);
                if !resealed.is_empty() {
                    client
                        .execute(
                            "UPDATE mail_accounts SET password_secret = $1, updated_at = now() WHERE owner = $2 AND id = $3 AND password_secret = $4",
                            &[&resealed, &owner, &id, &raw_secret],
                        )
                        .await?;
                }
            }
        }

        for row in client
            .query(
                "SELECT owner, id::BIGINT AS id, credential_secret FROM dav_accounts WHERE credential_secret <> ''",
                &[],
            )
            .await?
        {
            let owner: String = row.get("owner");
            let id: i64 = row.get("id");
            let raw_secret: String = row.get("credential_secret");
            let (credential, needs_reset) = self.open_mail_password(&raw_secret);
            if needs_reset && !credential.is_empty() {
                let resealed = self.seal_mail_password(&credential);
                if !resealed.is_empty() {
                    client
                        .execute(
                            "UPDATE dav_accounts SET credential_secret = $1, updated_at = now() WHERE owner = $2 AND id = $3 AND credential_secret = $4",
                            &[&resealed, &owner, &id, &raw_secret],
                        )
                        .await?;
                }
            }
        }

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
        let dav_password_secret = String::new();
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

    pub async fn session_dav_credentials(
        &self,
    ) -> Result<Vec<SessionDavCredentials>, StorageError> {
        let rows = self
            .pool
            .get()
            .await?
            .query(
                r#"
SELECT DISTINCT ON (username)
       username, dav_username, dav_password_secret, principal_url, calendar_home_set, addressbook_home_set
FROM caldaver_sessions
WHERE expires_at > $1 AND dav_username <> '' AND dav_password_secret <> ''
ORDER BY username, updated_at DESC
"#,
                &[&now_secs()],
            )
            .await?;
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let dav_password = self.open(&row.get::<_, String>("dav_password_secret"));
                if dav_password.is_empty() {
                    return None;
                }
                Some(SessionDavCredentials {
                    owner: row.get("username"),
                    dav_username: row.get("dav_username"),
                    dav_password,
                    principal_url: row.get("principal_url"),
                    calendar_home_set: row.get("calendar_home_set"),
                    addressbook_home_set: row.get("addressbook_home_set"),
                })
            })
            .collect())
    }

    pub async fn save_preferences(
        &self,
        username: &str,
        preferences: &Preferences,
    ) -> Result<(), StorageError> {
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
            .query_opt(
                "SELECT preferences FROM caldaver_preferences WHERE username = $1",
                &[&username],
            )
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

    pub async fn event(
        &self,
        calendar: &str,
        uid: &str,
    ) -> Result<Option<CalendarEvent>, StorageError> {
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
	                "SELECT id::BIGINT AS id, label, email_address, imap_host, imap_port::INTEGER AS imap_port, encryption, username, password_secret, refresh_interval_seconds::BIGINT AS refresh_interval_seconds FROM mail_accounts WHERE owner = $1 AND enabled = TRUE ORDER BY id",
                &[&owner],
            )
            .await?;
        Ok(rows
            .into_iter()
            .map(|row| {
                let (password_sealed, password_needs_reset) =
                    self.open_mail_password(&row.get::<_, String>("password_secret"));
                MailAccount {
                    id: row.get::<_, i64>("id") as u64,
                    label: row.get("label"),
                    email_address: row.get("email_address"),
                    imap_host: row.get("imap_host"),
                    imap_port: row.get::<_, i32>("imap_port") as u16,
                    encryption: row.get("encryption"),
                    username: row.get("username"),
                    password_sealed,
                    password_needs_reset,
                    refresh_interval_seconds: row.get::<_, i64>("refresh_interval_seconds") as u64,
                }
            })
            .collect())
    }

    pub async fn mail_account(
        &self,
        owner: &str,
        id: u64,
    ) -> Result<Option<MailAccount>, StorageError> {
        let id_i64 = id as i64;
        Ok(self
            .pool
            .get()
            .await?
            .query_opt(
	                "SELECT id::BIGINT AS id, label, email_address, imap_host, imap_port::INTEGER AS imap_port, encryption, username, password_secret, refresh_interval_seconds::BIGINT AS refresh_interval_seconds FROM mail_accounts WHERE owner = $1 AND id = $2 AND enabled = TRUE",
                &[&owner, &id_i64],
            )
            .await?
            .map(|row| {
                let (password_sealed, password_needs_reset) =
                    self.open_mail_password(&row.get::<_, String>("password_secret"));
                MailAccount {
                    id: row.get::<_, i64>("id") as u64,
                    label: row.get("label"),
                    email_address: row.get("email_address"),
                    imap_host: row.get("imap_host"),
                    imap_port: row.get::<_, i32>("imap_port") as u16,
                    encryption: row.get("encryption"),
                    username: row.get("username"),
                    password_sealed,
                    password_needs_reset,
                    refresh_interval_seconds: row.get::<_, i64>("refresh_interval_seconds") as u64,
                }
            }))
    }

    pub async fn save_mail_account(
        &self,
        owner: &str,
        account: &MailAccount,
    ) -> Result<MailAccount, StorageError> {
        let client = self.pool.get().await?;
        let password_secret = self.seal_mail_password(&account.password_sealed);
        let refresh = account.refresh_interval_seconds as i64;
        let id = if account.id == 0 {
            client
                .query_opt(
                    r#"
	SELECT id::BIGINT AS id FROM mail_accounts
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
	RETURNING id::BIGINT AS id
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
	RETURNING id::BIGINT AS id
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
        saved.password_needs_reset = false;
        Ok(saved)
    }

    pub async fn dav_accounts(&self, owner: &str) -> Result<Vec<DavAccount>, StorageError> {
        let rows = self
            .pool
            .get()
            .await?
            .query(
                r#"
SELECT id::BIGINT AS id, account_type, label, server_url, auth_method, username,
       credential_secret, principal_url, home_set, enabled, last_error
FROM dav_accounts
WHERE owner = $1 AND enabled = TRUE
ORDER BY account_type, id
"#,
                &[&owner],
            )
            .await?;
        Ok(rows
            .into_iter()
            .map(|row| self.dav_account_from_row(row))
            .collect())
    }

    pub async fn dav_account(
        &self,
        owner: &str,
        account_type: &str,
    ) -> Result<Option<DavAccount>, StorageError> {
        Ok(self
            .pool
            .get()
            .await?
            .query_opt(
                r#"
SELECT id::BIGINT AS id, account_type, label, server_url, auth_method, username,
       credential_secret, principal_url, home_set, enabled, last_error
FROM dav_accounts
WHERE owner = $1 AND account_type = $2 AND enabled = TRUE
ORDER BY id
LIMIT 1
"#,
                &[&owner, &account_type],
            )
            .await?
            .map(|row| self.dav_account_from_row(row)))
    }

    pub async fn dav_account_by_id(
        &self,
        owner: &str,
        id: u64,
    ) -> Result<Option<DavAccount>, StorageError> {
        let id = id as i64;
        Ok(self
            .pool
            .get()
            .await?
            .query_opt(
                r#"
SELECT id::BIGINT AS id, account_type, label, server_url, auth_method, username,
       credential_secret, principal_url, home_set, enabled, last_error
FROM dav_accounts
WHERE owner = $1 AND id = $2 AND enabled = TRUE
"#,
                &[&owner, &id],
            )
            .await?
            .map(|row| self.dav_account_from_row(row)))
    }

    pub async fn save_dav_account(
        &self,
        owner: &str,
        account: &DavAccount,
    ) -> Result<DavAccount, StorageError> {
        let client = self.pool.get().await?;
        let credential_secret = self.seal_mail_password(&account.credential_sealed);
        let id = if account.id == 0 {
            client
                .query_opt(
                    r#"
SELECT id::BIGINT AS id
FROM dav_accounts
WHERE owner = $1 AND account_type = $2 AND lower(server_url) = lower($3) AND username = $4
ORDER BY id
LIMIT 1
"#,
                    &[
                        &owner,
                        &account.account_type,
                        &account.server_url,
                        &account.username,
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
INSERT INTO dav_accounts
(owner, account_type, label, server_url, auth_method, username, credential_secret, principal_url, home_set, enabled, last_error)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
RETURNING id::BIGINT AS id
"#,
                    &[
                        &owner,
                        &account.account_type,
                        &account.label,
                        &account.server_url,
                        &account.auth_method,
                        &account.username,
                        &credential_secret,
                        &account.principal_url,
                        &account.home_set,
                        &account.enabled,
                        &account.last_error,
                    ],
                )
                .await?
        } else {
            let id = id as i64;
            client
                .query_opt(
                    r#"
UPDATE dav_accounts SET
account_type=$3, label=$4, server_url=$5, auth_method=$6, username=$7,
credential_secret = CASE WHEN $8 = '' THEN credential_secret ELSE $8 END,
principal_url=$9, home_set=$10, enabled=$11, last_error=$12, updated_at=now()
WHERE owner=$1 AND id=$2
RETURNING id::BIGINT AS id
"#,
                    &[
                        &owner,
                        &id,
                        &account.account_type,
                        &account.label,
                        &account.server_url,
                        &account.auth_method,
                        &account.username,
                        &credential_secret,
                        &account.principal_url,
                        &account.home_set,
                        &account.enabled,
                        &account.last_error,
                    ],
                )
                .await?
                .ok_or(StorageError::NotFound)?
        };
        let mut saved = account.clone();
        saved.id = row.get::<_, i64>("id") as u64;
        saved.credential_needs_reset = false;
        Ok(saved)
    }

    fn dav_account_from_row(&self, row: tokio_postgres::Row) -> DavAccount {
        let (credential_sealed, credential_needs_reset) =
            self.open_mail_password(&row.get::<_, String>("credential_secret"));
        DavAccount {
            id: row.get::<_, i64>("id") as u64,
            account_type: row.get("account_type"),
            label: row.get("label"),
            server_url: row.get("server_url"),
            auth_method: row.get("auth_method"),
            username: row.get("username"),
            credential_sealed,
            credential_needs_reset,
            principal_url: row.get("principal_url"),
            home_set: row.get("home_set"),
            enabled: row.get("enabled"),
            last_error: row.get("last_error"),
        }
    }

    pub async fn cached_messages(
        &self,
        owner: &str,
        account_id: u64,
    ) -> Result<Vec<MailMessage>, StorageError> {
        let account_id = account_id as i64;
        let rows = self
            .pool
            .get()
            .await?
            .query(
                "SELECT message::JSONB AS message FROM mail_message_cache WHERE owner=$1 AND account_id=$2 AND message IS NOT NULL ORDER BY uid DESC",
                &[&owner, &account_id],
            )
            .await?;
        rows.into_iter()
            .map(|row| {
                let message: Value = row.try_get("message")?;
                serde_json::from_value(message).map_err(Into::into)
            })
            .collect()
    }

    pub async fn cached_message(
        &self,
        owner: &str,
        account_id: u64,
        uid: u64,
    ) -> Result<Option<MailMessage>, StorageError> {
        let account_id = account_id as i64;
        let uid = uid as i64;
        let rows = self
            .pool
            .get()
            .await?
            .query(
                "SELECT message::JSONB AS message FROM mail_message_cache WHERE owner=$1 AND account_id=$2 AND uid=$3",
                &[&owner, &account_id, &uid],
            )
            .await?;
        rows.into_iter()
            .next()
            .map(|row| {
                let message: Value = row.try_get("message")?;
                serde_json::from_value(message).map_err(Into::into)
            })
            .transpose()
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
        let mut incoming_uids: Vec<i64> = Vec::with_capacity(messages.len());
        for message in messages {
            let uid = message.uid as i64;
            incoming_uids.push(uid);
            let value = serde_json::to_value(message)?;
            tx.execute(
                r#"
INSERT INTO mail_message_cache (owner, account_id, uid, message)
VALUES ($1, $2, $3, $4)
ON CONFLICT (owner, account_id, uid) DO UPDATE SET
  message =
    EXCLUDED.message
    || jsonb_build_object(
      'body',
      CASE
        WHEN COALESCE(EXCLUDED.message->>'body', '') = ''
          THEN COALESCE(mail_message_cache.message->>'body', '')
        ELSE EXCLUDED.message->>'body'
      END,
      'html_body',
      CASE
        WHEN COALESCE(EXCLUDED.message->>'html_body', '') = ''
          THEN COALESCE(mail_message_cache.message->>'html_body', '')
        ELSE EXCLUDED.message->>'html_body'
      END,
      'attachments',
      CASE
        WHEN COALESCE(jsonb_array_length(EXCLUDED.message->'attachments'), 0) = 0
          THEN COALESCE(mail_message_cache.message->'attachments', '[]'::jsonb)
        ELSE EXCLUDED.message->'attachments'
      END
    ),
  updated_at = now()
"#,
                &[&owner, &account_id, &uid, &value],
            )
            .await?;
        }
        tx.execute(
            r#"
DELETE FROM mail_message_cache
WHERE owner=$1 AND account_id=$2
  AND NOT (uid = ANY($3::bigint[]))
"#,
            &[&owner, &account_id, &incoming_uids],
        )
        .await?;
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

    // Drops a single cached message after the backend confirms it has been
    // deleted or archived on the IMAP server. Best-effort: callers surface the
    // backend result to the user, so a cache-miss here is logged and ignored.
    pub async fn delete_cached_message(
        &self,
        owner: &str,
        account_id: u64,
        uid: u64,
    ) -> Result<(), StorageError> {
        let account_id = account_id as i64;
        let uid = uid as i64;
        self.pool
            .get()
            .await?
            .execute(
                "DELETE FROM mail_message_cache WHERE owner=$1 AND account_id=$2 AND uid=$3",
                &[&owner, &account_id, &uid],
            )
            .await?;
        Ok(())
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

    fn open_mail_password(&self, value: &str) -> (SealedPassword, bool) {
        if value.trim().is_empty() {
            return (SealedPassword::default(), true);
        }

        if let Ok(password) = serde_json::from_str::<SealedPassword>(value) {
            if password.is_empty() {
                return (SealedPassword::default(), true);
            }
            if password.reveal().is_ok() {
                return (password, false);
            }
            return (SealedPassword::default(), true);
        }

        let password = {
            let opened = self.open(value);
            if opened.trim().is_empty() {
                return (SealedPassword::default(), true);
            }
            SealedPassword::seal(&opened).unwrap_or_default()
        };
        (password, true)
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
        crate::imap_backend::install_test_password_key();
        let database_url = std::env::var("CALDAVER_TEST_DATABASE_URL").ok()?;
        Storage::connect(&database_url, "storage-test-secret")
            .await
            .ok()
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
            timezone: crate::DEFAULT_TIMEZONE.to_string(),
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
        crate::imap_backend::install_test_password_key();
        MailAccount {
            id: 0,
            label: "Inbox".to_string(),
            email_address: "ada@example.test".to_string(),
            imap_host: "imap.example.test".to_string(),
            imap_port: 993,
            encryption: "ssl".to_string(),
            username: "ada".to_string(),
            password_sealed: SealedPassword::seal("mail-password").unwrap(),
            password_needs_reset: false,
            refresh_interval_seconds: 60,
        }
    }

    fn test_dav_account(account_type: &str, owner: &str, password: &str) -> DavAccount {
        crate::imap_backend::install_test_password_key();
        DavAccount {
            id: 0,
            account_type: account_type.to_string(),
            label: format!("{account_type} account"),
            server_url: format!("https://dav.example.test/{owner}/{account_type}/"),
            auth_method: "basic".to_string(),
            username: format!("{owner}@example.test"),
            credential_sealed: SealedPassword::seal(password).unwrap(),
            credential_needs_reset: false,
            principal_url: format!("/principals/{owner}/"),
            home_set: format!("/{account_type}/{owner}/"),
            enabled: true,
            last_error: String::new(),
        }
    }

    fn legacy_secret(storage_secret: &str, plaintext: &str) -> String {
        let key = storage_secret.as_bytes();
        let sealed: Vec<u8> = if key.is_empty() {
            plaintext.as_bytes().to_vec()
        } else {
            plaintext
                .as_bytes()
                .iter()
                .enumerate()
                .map(|(index, byte)| byte ^ key[index % key.len()])
                .collect()
        };
        BASE64.encode(sealed)
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

    fn overview_message(uid: u64, seen: bool) -> MailMessage {
        MailMessage {
            uid,
            from_header: "Ada <ada@example.test>".to_string(),
            subject: format!("Overview {uid}"),
            date: "Sat, 30 May 2026 10:00:00 +0000".to_string(),
            seen,
            attachments: Vec::new(),
            body: String::new(),
            html_body: String::new(),
        }
    }

    #[tokio::test]
    async fn rejects_non_postgres_database_urls() {
        match Storage::connect("mysql://example.test/caldaver", "secret").await {
            Ok(_) => panic!("non-Postgres database URL should be rejected"),
            Err(error) => assert!(matches!(error, StorageError::Config(_))),
        }
    }

    #[tokio::test]
    async fn postgres_round_trips_backend_state() {
        let Some(storage) = test_storage().await else {
            return;
        };
        let owner = unique_name("postgres-state");
        let session_id = unique_name("session");
        let session = test_session(&owner);

        storage
            .insert_session(&session_id, &session, Duration::from_secs(3600))
            .await
            .unwrap();
        let loaded = storage.session(&session_id).await.unwrap().unwrap();
        assert_eq!(loaded.username, owner);
        assert_eq!(loaded.dav_password, "");
        storage.delete_session(&session_id).await.unwrap();
        assert!(storage.session(&session_id).await.unwrap().is_none());

        let mut preferences = Preferences::default();
        preferences.default_view = "agendaWeek".to_string();
        preferences.weekstart = 1;
        storage
            .save_preferences(&owner, &preferences)
            .await
            .unwrap();
        let loaded_preferences = storage.preferences(&owner).await.unwrap().unwrap();
        assert_eq!(loaded_preferences.default_view, "agendaWeek");
        assert_eq!(loaded_preferences.weekstart, 1);

        let calendar = format!("/calendars/{owner}/");
        let event = test_event(&calendar, "event-1");
        storage.upsert_event(&event).await.unwrap();
        assert_eq!(storage.events(&calendar).await.unwrap().len(), 1);
        assert_eq!(
            storage
                .event(&calendar, "event-1")
                .await
                .unwrap()
                .unwrap()
                .title,
            "Storage event"
        );
        storage.delete_event(&calendar, "event-1").await.unwrap();
        assert!(storage.event(&calendar, "event-1").await.unwrap().is_none());

        let contact = test_contact(&owner);
        storage.upsert_contact(&owner, &contact).await.unwrap();
        assert_eq!(
            storage.contacts(&owner).await.unwrap()[0].full_name,
            "Ada Lovelace"
        );
        storage.delete_contact(&owner, &contact.url).await.unwrap();
        assert!(storage.contacts(&owner).await.unwrap().is_empty());

        let saved_account = storage
            .save_mail_account(&owner, &test_account())
            .await
            .unwrap();
        assert!(saved_account.id > 0);
        let loaded_account = storage
            .mail_account(&owner, saved_account.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            loaded_account.password_sealed.reveal().unwrap(),
            "mail-password"
        );
        assert_eq!(storage.mail_accounts(&owner).await.unwrap().len(), 1);

        storage
            .replace_message_cache(
                &owner,
                saved_account.id,
                &[test_message(10, true), test_message(11, false)],
            )
            .await
            .unwrap();
        assert_eq!(
            storage
                .cached_messages(&owner, saved_account.id)
                .await
                .unwrap()
                .len(),
            2
        );
        let full_message = test_message(11, true);
        storage
            .cache_message(&owner, saved_account.id, &full_message)
            .await
            .unwrap();
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
        assert_eq!(
            loaded_account.password_sealed.reveal().unwrap(),
            "mail-password"
        );

        let mut missing = test_account();
        missing.id = 9_999_999_999;
        assert!(matches!(
            storage.save_mail_account(&owner, &missing).await,
            Err(StorageError::NotFound)
        ));
    }

    #[tokio::test]
    async fn postgres_preserves_cached_bodies_and_drops_stale_uids_during_overview_sync() {
        let Some(storage) = test_storage().await else { return; };
        let owner = unique_name("cache-merge");
        let saved = storage.save_mail_account(&owner, &test_account()).await.unwrap();

        storage.cache_message(&owner, saved.id, &overview_message(20, true)).await.unwrap();
        storage.cache_message(&owner, saved.id, &test_message(21, false)).await.unwrap();

        storage
            .replace_message_cache(&owner, saved.id, &[overview_message(21, false), overview_message(22, false)])
            .await
            .unwrap();

        let cached = storage.cached_messages(&owner, saved.id).await.unwrap();
        assert!(cached.iter().all(|m| m.uid != 20), "stale uid absent from overview must be removed");
        let m21 = cached.iter().find(|m| m.uid == 21).unwrap();
        assert_eq!(m21.body, "Body", "previously-cached full body must survive overview sync");
        assert!(cached.iter().any(|m| m.uid == 22));

        let lookup = storage.cached_message(&owner, saved.id, 21).await.unwrap().unwrap();
        assert_eq!(lookup.body, "Body");
        assert!(storage.cached_message(&owner, saved.id, 999).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn postgres_returns_cached_messages_in_uid_desc_order() {
        let Some(storage) = test_storage().await else {
            return;
        };
        let owner = unique_name("cache-order");
        let saved = storage.save_mail_account(&owner, &test_account()).await.unwrap();
        let mut lower_uid_newer_date = overview_message(30, false);
        lower_uid_newer_date.date = "Tue, 02 Jan 2024 00:00:00 +0000".to_string();
        let mut higher_uid_older_date = overview_message(31, false);
        higher_uid_older_date.date = "Mon, 01 Jan 2024 00:00:00 +0000".to_string();

        storage
            .replace_message_cache(&owner, saved.id, &[lower_uid_newer_date, higher_uid_older_date])
            .await
            .unwrap();

        let uids = storage
            .cached_messages(&owner, saved.id)
            .await
            .unwrap()
            .into_iter()
            .map(|message| message.uid)
            .collect::<Vec<_>>();
        assert_eq!(uids, vec![31, 30]);
    }

    #[tokio::test]
    async fn postgres_round_trips_dav_accounts_with_sealed_credentials() {
        let Some(storage) = test_storage().await else {
            return;
        };
        let owner = unique_name("dav-account");
        let saved = storage
            .save_dav_account(&owner, &test_dav_account("calendar", &owner, "dav-token"))
            .await
            .unwrap();
        assert!(saved.id > 0);

        let client = storage.pool.get().await.unwrap();
        let raw_secret: String = client
            .query_one(
                "SELECT credential_secret FROM dav_accounts WHERE owner = $1 AND id = $2",
                &[&owner, &(saved.id as i64)],
            )
            .await
            .unwrap()
            .get("credential_secret");
        assert!(!raw_secret.contains("dav-token"));
        assert!(serde_json::from_str::<SealedPassword>(&raw_secret).is_ok());

        let loaded = storage
            .dav_account(&owner, "calendar")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(loaded.credential_sealed.reveal().unwrap(), "dav-token");
        assert_eq!(loaded.home_set, format!("/calendar/{owner}/"));

        let mut renamed = loaded.clone();
        renamed.label = "Renamed calendar".to_string();
        renamed.credential_sealed = SealedPassword::default();
        let renamed = storage.save_dav_account(&owner, &renamed).await.unwrap();
        assert_eq!(renamed.id, saved.id);
        let loaded = storage
            .dav_account(&owner, "calendar")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(loaded.label, "Renamed calendar");
        assert_eq!(loaded.credential_sealed.reveal().unwrap(), "dav-token");

        let mut disabled = test_dav_account("carddav", &owner, "card-token");
        disabled.enabled = false;
        storage.save_dav_account(&owner, &disabled).await.unwrap();
        assert!(
            storage
                .dav_account(&owner, "carddav")
                .await
                .unwrap()
                .is_none()
        );
        assert_eq!(storage.dav_accounts(&owner).await.unwrap().len(), 1);
        assert!(
            storage
                .dav_accounts(&unique_name("other-owner"))
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn postgres_reseals_legacy_account_credentials_with_mail_password_key() {
        let Some(storage) = test_storage().await else {
            return;
        };
        let owner = unique_name("legacy-reseal");
        let mail = storage
            .save_mail_account(&owner, &test_account())
            .await
            .unwrap();
        let dav = storage
            .save_dav_account(
                &owner,
                &test_dav_account("calendar", &owner, "new-dav-secret"),
            )
            .await
            .unwrap();

        let legacy_mail = legacy_secret("storage-test-secret", "legacy-mail-secret");
        let legacy_dav = legacy_secret("storage-test-secret", "legacy-dav-secret");
        let client = storage.pool.get().await.unwrap();
        client
            .execute(
                "UPDATE mail_accounts SET password_secret = $1 WHERE owner = $2 AND id = $3",
                &[&legacy_mail, &owner, &(mail.id as i64)],
            )
            .await
            .unwrap();
        client
            .execute(
                "UPDATE dav_accounts SET credential_secret = $1 WHERE owner = $2 AND id = $3",
                &[&legacy_dav, &owner, &(dav.id as i64)],
            )
            .await
            .unwrap();

        storage.reseal_legacy_account_credentials().await.unwrap();

        let raw_mail: String = client
            .query_one(
                "SELECT password_secret FROM mail_accounts WHERE owner = $1 AND id = $2",
                &[&owner, &(mail.id as i64)],
            )
            .await
            .unwrap()
            .get("password_secret");
        let raw_dav: String = client
            .query_one(
                "SELECT credential_secret FROM dav_accounts WHERE owner = $1 AND id = $2",
                &[&owner, &(dav.id as i64)],
            )
            .await
            .unwrap()
            .get("credential_secret");

        assert!(!raw_mail.contains("legacy-mail-secret"));
        assert!(!raw_dav.contains("legacy-dav-secret"));
        assert_eq!(
            serde_json::from_str::<SealedPassword>(&raw_mail)
                .unwrap()
                .reveal()
                .unwrap(),
            "legacy-mail-secret"
        );
        assert_eq!(
            serde_json::from_str::<SealedPassword>(&raw_dav)
                .unwrap()
                .reveal()
                .unwrap(),
            "legacy-dav-secret"
        );
    }
}
