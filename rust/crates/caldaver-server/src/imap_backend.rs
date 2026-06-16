use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use caldaver_core::mail_account as core_mail_account;
use imap::ConnectionMode;
use mailparse::{DispositionType, MailHeaderMap, ParsedMail};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::env;
use std::fmt;

const INBOX_LIMIT: usize = 100;
const MAIL_PASSWORD_KEY_ENV: &str = "CALDAVER_MAIL_PASSWORD_KEY";
const MIN_MAIL_PASSWORD_KEY_BYTES: usize = 32;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct MailAccount {
    pub id: u64,
    pub label: String,
    pub email_address: String,
    pub imap_host: String,
    pub imap_port: u16,
    pub encryption: String,
    pub username: String,
    pub password_sealed: SealedPassword,
    #[serde(default)]
    pub password_needs_reset: bool,
    pub refresh_interval_seconds: u64,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct MailAccountPublic {
    pub id: u64,
    pub label: String,
    pub email_address: String,
    pub imap_host: String,
    pub imap_port: u16,
    pub encryption: String,
    pub username: String,
    pub password_needs_reset: bool,
    pub refresh_interval_seconds: u64,
}

impl From<&MailAccount> for MailAccountPublic {
    fn from(account: &MailAccount) -> Self {
        Self {
            id: account.id,
            label: account.label.clone(),
            email_address: account.email_address.clone(),
            imap_host: account.imap_host.clone(),
            imap_port: account.imap_port,
            encryption: account.encryption.clone(),
            username: account.username.clone(),
            password_needs_reset: account.password_needs_reset,
            refresh_interval_seconds: account.refresh_interval_seconds,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct MailMessage {
    pub uid: u64,
    #[serde(rename = "from")]
    pub from_header: String,
    pub subject: String,
    pub date: String,
    pub seen: bool,
    pub attachments: Vec<MailAttachment>,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub html_body: String,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct MailMessageNavigation {
    pub previous: Option<u64>,
    pub next: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct MailAttachment {
    pub part: String,
    pub filename: String,
    pub content_type: String,
    pub size: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AttachmentDownload {
    pub filename: String,
    pub content_type: String,
    pub bytes: Vec<u8>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct SealedPassword {
    pub version: u8,
    pub nonce: String,
    pub ciphertext: String,
}

impl Default for SealedPassword {
    fn default() -> Self {
        Self {
            version: 1,
            nonce: String::new(),
            ciphertext: String::new(),
        }
    }
}

impl SealedPassword {
    pub fn is_empty(&self) -> bool {
        self.ciphertext.is_empty()
    }

    pub fn seal(plaintext: &str) -> Result<Self, MailBackendError> {
        if plaintext.is_empty() {
            return Ok(Self::default());
        }

        let nonce_bytes: [u8; 12] = rand::random();
        let cipher = Aes256Gcm::new_from_slice(&password_key()?)
            .map_err(|_| MailBackendError::Crypto("Unable to initialize password seal".to_string()))?;
        let ciphertext = cipher
            .encrypt(Nonce::from_slice(&nonce_bytes), plaintext.as_bytes())
            .map_err(|_| MailBackendError::Crypto("Unable to seal mail password".to_string()))?;

        Ok(Self {
            version: 1,
            nonce: BASE64.encode(nonce_bytes),
            ciphertext: BASE64.encode(ciphertext),
        })
    }

    pub fn reveal(&self) -> Result<String, MailBackendError> {
        if self.is_empty() {
            return Ok(String::new());
        }

        if self.version != 1 {
            return Err(MailBackendError::Crypto("Unsupported sealed password version".to_string()));
        }

        let nonce = BASE64
            .decode(&self.nonce)
            .map_err(|_| MailBackendError::Crypto("Invalid sealed password nonce".to_string()))?;
        let ciphertext = BASE64
            .decode(&self.ciphertext)
            .map_err(|_| MailBackendError::Crypto("Invalid sealed password ciphertext".to_string()))?;
        let cipher = Aes256Gcm::new_from_slice(&password_key()?)
            .map_err(|_| MailBackendError::Crypto("Unable to initialize password seal".to_string()))?;
        let plaintext = cipher
            .decrypt(Nonce::from_slice(&nonce), ciphertext.as_ref())
            .map_err(|_| MailBackendError::Crypto("Unable to reveal sealed mail password".to_string()))?;

        String::from_utf8(plaintext)
            .map_err(|_| MailBackendError::Crypto("Sealed mail password is not UTF-8".to_string()))
    }
}

fn password_key() -> Result<[u8; 32], MailBackendError> {
    let secret = env::var(MAIL_PASSWORD_KEY_ENV).ok();
    derive_password_key(secret.as_deref())
}

fn derive_password_key(secret: Option<&str>) -> Result<[u8; 32], MailBackendError> {
    let secret = secret.map(str::trim).filter(|value| !value.is_empty()).ok_or_else(|| {
        MailBackendError::Crypto(
            "CALDAVER_MAIL_PASSWORD_KEY is required to encrypt stored account credentials".to_string(),
        )
    })?;
    if secret.as_bytes().len() < MIN_MAIL_PASSWORD_KEY_BYTES {
        return Err(MailBackendError::Crypto(format!(
            "CALDAVER_MAIL_PASSWORD_KEY must be at least {MIN_MAIL_PASSWORD_KEY_BYTES} bytes"
        )));
    }
    Ok(Sha256::digest(secret.as_bytes()).into())
}

pub(crate) fn validate_password_key_config() -> Result<(), MailBackendError> {
    password_key().map(|_| ())
}

#[cfg(test)]
pub(crate) fn install_test_password_key() {
    use std::sync::Once;

    static INIT: Once = Once::new();
    INIT.call_once(|| unsafe {
        env::set_var(
            MAIL_PASSWORD_KEY_ENV,
            "caldaver-test-mail-password-key-000000000000",
        );
    });
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum MailBackendError {
    InvalidAccount(String),
    Credentials(String),
    NotFound(String),
    Backend(String),
    Parse(String),
    Crypto(String),
}

impl fmt::Display for MailBackendError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidAccount(message)
            | Self::Credentials(message)
            | Self::NotFound(message)
            | Self::Backend(message)
            | Self::Parse(message)
            | Self::Crypto(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for MailBackendError {}

impl From<imap::Error> for MailBackendError {
    fn from(error: imap::Error) -> Self {
        Self::Backend(error.to_string())
    }
}

impl From<mailparse::MailParseError> for MailBackendError {
    fn from(error: mailparse::MailParseError) -> Self {
        Self::Parse(error.to_string())
    }
}

pub(crate) trait MailBackend: Send + Sync {
    fn fetch_inbox_overview(&self, account: &MailAccount) -> Result<Vec<MailMessage>, MailBackendError>;
    fn fetch_message(&self, account: &MailAccount, uid: u64) -> Result<MailMessage, MailBackendError>;
    fn fetch_message_navigation(
        &self,
        account: &MailAccount,
        uid: u64,
    ) -> Result<MailMessageNavigation, MailBackendError> {
        let messages = self.fetch_inbox_overview(account)?;
        Ok(message_navigation_from_uids(
            messages.into_iter().map(|message| message.uid),
            uid,
        ))
    }
    fn download_attachment(
        &self,
        account: &MailAccount,
        uid: u64,
        part: &str,
    ) -> Result<AttachmentDownload, MailBackendError>;
    fn mark_seen(&self, account: &MailAccount, uid: u64, seen: bool) -> Result<(), MailBackendError>;
    // Moves or permanently deletes the message identified by (`mailbox`, `uid`).
    // When the IMAP account exposes a `\Trash` special-use mailbox the message is
    // moved there; otherwise it is flagged `\Deleted` and expunged from the source
    // mailbox. `mailbox` is currently expected to be `INBOX` because that is the
    // only mailbox Caldaver fetches, but the parameter is accepted for future use.
    fn delete_message(
        &self,
        account: &MailAccount,
        mailbox: &str,
        uid: u64,
    ) -> Result<(), MailBackendError>;
    // Moves the message identified by (`mailbox`, `uid`) into the account's
    // `\Archive` special-use mailbox when one is configured. Returns
    // `MailBackendError::NotFound` when no archive folder can be located so the
    // caller can surface an honest error instead of pretending the action
    // succeeded.
    fn archive_message(
        &self,
        account: &MailAccount,
        mailbox: &str,
        uid: u64,
    ) -> Result<(), MailBackendError>;
}

#[derive(Default)]
pub(crate) struct ImapMailBackend;

fn reset_mail_password_message() -> String {
    "Saved IMAP password needs to be reset after Caldaver credential rotation. Re-save the mail account password in Preferences.".to_string()
}

impl MailBackend for ImapMailBackend {
    fn fetch_inbox_overview(&self, account: &MailAccount) -> Result<Vec<MailMessage>, MailBackendError> {
        self.with_session(account, |session| {
            let mut uids = session.uid_search("ALL")?.into_iter().collect::<Vec<_>>();
            uids.sort_unstable_by(|a, b| b.cmp(a));
            uids.truncate(INBOX_LIMIT);

            let mut messages = Vec::with_capacity(uids.len());
            for uid in uids {
                messages.push(fetch_message_by_uid(session, uid, false)?);
            }
            messages.sort_by(|a, b| b.uid.cmp(&a.uid));
            Ok(messages)
        })
    }

    fn fetch_message(&self, account: &MailAccount, uid: u64) -> Result<MailMessage, MailBackendError> {
        let uid = uid32(uid)?;
        self.with_session(account, |session| fetch_message_by_uid(session, uid, true))
    }

    fn fetch_message_navigation(
        &self,
        account: &MailAccount,
        uid: u64,
    ) -> Result<MailMessageNavigation, MailBackendError> {
        let uid = uid32(uid)?;
        self.with_session(account, |session| {
            Ok(message_navigation_from_uids(
                session.uid_search("ALL")?.into_iter().map(u64::from),
                u64::from(uid),
            ))
        })
    }

    fn download_attachment(
        &self,
        account: &MailAccount,
        uid: u64,
        part: &str,
    ) -> Result<AttachmentDownload, MailBackendError> {
        let uid = uid32(uid)?;
        self.with_session(account, |session| {
            let raw = fetch_raw_message(session, uid)?;
            let parsed = mailparse::parse_mail(&raw)?;
            find_attachment(&parsed, "", part)
                .ok_or_else(|| MailBackendError::NotFound("Attachment not found".to_string()))?
        })
    }

    fn mark_seen(&self, account: &MailAccount, uid: u64, seen: bool) -> Result<(), MailBackendError> {
        let uid = uid32(uid)?;
        self.with_session(account, |session| {
            let flags = if seen { "+FLAGS.SILENT (\\Seen)" } else { "-FLAGS.SILENT (\\Seen)" };
            session.uid_store(uid.to_string(), flags)?;
            Ok(())
        })
    }

    fn delete_message(
        &self,
        account: &MailAccount,
        mailbox: &str,
        uid: u64,
    ) -> Result<(), MailBackendError> {
        let uid = uid32(uid)?;
        let mailbox = if mailbox.trim().is_empty() { "INBOX" } else { mailbox };
        self.with_session_on_mailbox(account, mailbox, move |session| {
            if let Some(trash) = lookup_special_use_mailbox(session, SpecialUse::Trash)? {
                move_or_fallback(session, uid, &trash)?;
            } else {
                // No \Trash folder advertised by the server: fall back to the
                // universal IMAP delete semantics (\Deleted + EXPUNGE).
                session.uid_store(uid.to_string(), "+FLAGS.SILENT (\\Deleted)")?;
                session.expunge()?;
            }
            Ok(())
        })
    }

    fn archive_message(
        &self,
        account: &MailAccount,
        mailbox: &str,
        uid: u64,
    ) -> Result<(), MailBackendError> {
        let uid = uid32(uid)?;
        let mailbox = if mailbox.trim().is_empty() { "INBOX" } else { mailbox };
        self.with_session_on_mailbox(account, mailbox, move |session| {
            let archive = lookup_special_use_mailbox(session, SpecialUse::Archive)?
                .ok_or_else(|| {
                    MailBackendError::NotFound(
                        "No Archive folder is configured on this IMAP account".to_string(),
                    )
                })?;
            move_or_fallback(session, uid, &archive)?;
            Ok(())
        })
    }
}

pub(crate) fn message_navigation_from_uids<I>(uids: I, current_uid: u64) -> MailMessageNavigation
where
    I: IntoIterator<Item = u64>,
{
    let mut ordered_uids = uids.into_iter().collect::<Vec<_>>();
    ordered_uids.sort_unstable_by(|a, b| b.cmp(a));
    ordered_uids.dedup();
    let current_index = ordered_uids.iter().position(|uid| *uid == current_uid);
    MailMessageNavigation {
        previous: current_index.and_then(|index| {
            index
                .checked_sub(1)
                .map(|previous| ordered_uids[previous])
        }),
        next: current_index.and_then(|index| ordered_uids.get(index + 1).copied()),
    }
}

impl ImapMailBackend {
    fn with_session<T>(
        &self,
        account: &MailAccount,
        op: impl FnOnce(&mut imap::Session<imap::Connection>) -> Result<T, MailBackendError>,
    ) -> Result<T, MailBackendError> {
        self.with_session_on_mailbox(account, "INBOX", op)
    }

    fn with_session_on_mailbox<T>(
        &self,
        account: &MailAccount,
        mailbox: &str,
        op: impl FnOnce(&mut imap::Session<imap::Connection>) -> Result<T, MailBackendError>,
    ) -> Result<T, MailBackendError> {
        validate_account(account)?;
        let password = account.password_sealed.reveal()?;
        let mode = match account.encryption.as_str() {
            "none" => ConnectionMode::Plaintext,
            "tls" => ConnectionMode::StartTls,
            _ => ConnectionMode::Tls,
        };
        let client = imap::ClientBuilder::new(account.imap_host.trim(), account.imap_port)
            .mode(mode)
            .connect()?;
        let primary_username = account.username.trim();
        let fallback_username = account.email_address.trim();
        let mut session = match client.login(primary_username, password.as_str()) {
            Ok(session) => session,
            Err((error, client))
                if !primary_username.contains('@')
                    && !fallback_username.is_empty()
                    && fallback_username != primary_username =>
            {
                client
                    .login(fallback_username, password.as_str())
                    .map_err(|(fallback_error, _)| {
                        if account.password_needs_reset {
                            return MailBackendError::Credentials(reset_mail_password_message());
                        }
                        MailBackendError::Credentials(format!("{error}; fallback login failed: {fallback_error}"))
                    })?
            }
            Err((error, _)) => {
                if account.password_needs_reset {
                    return Err(MailBackendError::Credentials(reset_mail_password_message()));
                }
                return Err(MailBackendError::Credentials(error.to_string()));
            }
        };
        session.select(mailbox)?;

        let result = op(&mut session);
        let logout = session.logout().map_err(MailBackendError::from);
        match (result, logout) {
            (Ok(value), Ok(())) => Ok(value),
            (Err(error), _) => Err(error),
            (Ok(_), Err(error)) => Err(error),
        }
    }
}

pub(crate) fn validate_account(account: &MailAccount) -> Result<(), MailBackendError> {
    core_mail_account::validate(&core_mail_account::MailAccount {
        imap_host: account.imap_host.clone(),
        imap_port: account.imap_port,
    })
    .map_err(|error| MailBackendError::InvalidAccount(error.legacy_message().to_string()))
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SpecialUse {
    Trash,
    Archive,
}

impl SpecialUse {
    fn matches_attribute(self, attr: &imap_proto::NameAttribute<'_>) -> bool {
        match self {
            SpecialUse::Trash => matches!(attr, imap_proto::NameAttribute::Trash),
            SpecialUse::Archive => matches!(attr, imap_proto::NameAttribute::Archive),
        }
    }

    fn matches_name_lower(self, name_lower: &str) -> bool {
        match self {
            SpecialUse::Trash => name_lower == "trash" || name_lower.ends_with("/trash"),
            SpecialUse::Archive => name_lower == "archive" || name_lower.ends_with("/archive"),
        }
    }
}

// Locates a special-use mailbox (RFC 6154) by LIST-ing every mailbox the
// server exposes and matching first on the typed `\Trash` / `\Archive`
// attribute, then on common lowercase names as a fallback for servers that
// do not advertise special-use attributes.
fn lookup_special_use_mailbox(
    session: &mut imap::Session<imap::Connection>,
    special_use: SpecialUse,
) -> Result<Option<String>, MailBackendError> {
    let names = session.list(None, Some("*"))?;
    let mut fallback: Option<String> = None;
    for name in names.iter() {
        if name.attributes().iter().any(|attr| special_use.matches_attribute(attr)) {
            return Ok(Some(name.name().to_string()));
        }
        if fallback.is_none() && special_use.matches_name_lower(&name.name().to_lowercase()) {
            fallback = Some(name.name().to_string());
        }
    }
    Ok(fallback)
}

// Moves a message by UID into `target_mailbox`, preferring the IMAP `MOVE`
// extension (RFC 6851) and falling back to COPY + \Deleted + EXPUNGE when the
// server does not advertise MOVE. The fallback preserves the no-data-loss
// invariant: COPY succeeds before \Deleted is applied.
fn move_or_fallback(
    session: &mut imap::Session<imap::Connection>,
    uid: u32,
    target_mailbox: &str,
) -> Result<(), MailBackendError> {
    match session.uid_mv(uid.to_string(), target_mailbox) {
        Ok(()) => Ok(()),
        Err(move_err) => {
            tracing::warn!(%move_err, uid, target_mailbox, "UID MOVE failed; falling back to COPY + STORE + EXPUNGE");
            session.uid_copy(uid.to_string(), target_mailbox)?;
            session.uid_store(uid.to_string(), "+FLAGS.SILENT (\\Deleted)")?;
            session.expunge()?;
            Ok(())
        }
    }
}

fn uid32(uid: u64) -> Result<u32, MailBackendError> {
    uid.try_into()
        .map_err(|_| MailBackendError::NotFound("Message not found".to_string()))
}

fn fetch_message_by_uid(
    session: &mut imap::Session<imap::Connection>,
    uid: u32,
    include_body: bool,
) -> Result<MailMessage, MailBackendError> {
    let fetches = session.uid_fetch(
        uid.to_string(),
        "(UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[])",
    )?;
    let fetch = fetches
        .iter()
        .next()
        .ok_or_else(|| MailBackendError::NotFound("Message not found".to_string()))?;
    let seen = fetch.flags().iter().any(|flag| matches!(flag, imap::types::Flag::Seen));
    let date = fetch.internal_date().map(|date| date.to_rfc2822());
    let raw = fetch
        .body()
        .ok_or_else(|| MailBackendError::Parse("IMAP server did not return message body".to_string()))?;

    parse_mail_message(fetch.uid.unwrap_or(uid) as u64, seen, date, raw, include_body)
}

fn fetch_raw_message(
    session: &mut imap::Session<imap::Connection>,
    uid: u32,
) -> Result<Vec<u8>, MailBackendError> {
    let fetches = session.uid_fetch(uid.to_string(), "BODY.PEEK[]")?;
    let fetch = fetches
        .iter()
        .next()
        .ok_or_else(|| MailBackendError::NotFound("Message not found".to_string()))?;
    fetch
        .body()
        .map(Vec::from)
        .ok_or_else(|| MailBackendError::Parse("IMAP server did not return message body".to_string()))
}

pub(crate) fn parse_mail_message(
    uid: u64,
    seen: bool,
    internal_date: Option<String>,
    raw: &[u8],
    include_body: bool,
) -> Result<MailMessage, MailBackendError> {
    let parsed = mailparse::parse_mail(raw)?;
    let mut body = String::new();
    let mut html_body = String::new();
    let mut attachments = Vec::new();
    collect_parts(
        &parsed,
        "",
        include_body,
        &mut body,
        &mut html_body,
        &mut attachments,
    );

    if body.is_empty() && !html_body.is_empty() {
        body = strip_html_text(&html_body);
    }

    Ok(MailMessage {
        uid,
        from_header: parsed.headers.get_first_value("From").unwrap_or_default(),
        subject: parsed
            .headers
            .get_first_value("Subject")
            .filter(|subject| !subject.trim().is_empty())
            .unwrap_or_else(|| "(No subject)".to_string()),
        date: parsed
            .headers
            .get_first_value("Date")
            .or(internal_date)
            .unwrap_or_default(),
        seen,
        attachments,
        body,
        html_body,
    })
}

fn collect_parts(
    part: &ParsedMail<'_>,
    path: &str,
    include_body: bool,
    plain_body: &mut String,
    html_body: &mut String,
    attachments: &mut Vec<MailAttachment>,
) {
    let current_path = if path.is_empty() { "1" } else { path };
    let attachment_filename = attachment_filename(part);

    if part.subparts.is_empty() {
        if let Some(filename) = attachment_filename {
            attachments.push(MailAttachment {
                part: current_path.to_string(),
                filename,
                content_type: content_type(part),
                size: part.get_body_raw().map(|body| body.len()).unwrap_or(0),
            });
            return;
        }

        if include_body && part.ctype.mimetype.eq_ignore_ascii_case("text/plain") && plain_body.is_empty() {
            *plain_body = part.get_body().unwrap_or_default();
        } else if include_body && part.ctype.mimetype.eq_ignore_ascii_case("text/html") && html_body.is_empty() {
            *html_body = part.get_body().unwrap_or_default();
        }
        return;
    }

    for (index, subpart) in part.subparts.iter().enumerate() {
        let child_path = if path.is_empty() {
            (index + 1).to_string()
        } else {
            format!("{path}.{}", index + 1)
        };
        collect_parts(subpart, &child_path, include_body, plain_body, html_body, attachments);
    }
}

fn find_attachment(
    part: &ParsedMail<'_>,
    path: &str,
    requested_part: &str,
) -> Option<Result<AttachmentDownload, MailBackendError>> {
    let current_path = if path.is_empty() { "1" } else { path };
    if part.subparts.is_empty() && current_path == requested_part {
        let filename = attachment_filename(part)?;
        let bytes = match part.get_body_raw() {
            Ok(bytes) => bytes,
            Err(error) => return Some(Err(MailBackendError::from(error))),
        };
        return Some(Ok(AttachmentDownload {
            filename,
            content_type: content_type(part),
            bytes,
        }));
    }

    for (index, subpart) in part.subparts.iter().enumerate() {
        let child_path = if path.is_empty() {
            (index + 1).to_string()
        } else {
            format!("{path}.{}", index + 1)
        };
        if let Some(download) = find_attachment(subpart, &child_path, requested_part) {
            return Some(download);
        }
    }

    None
}

fn attachment_filename(part: &ParsedMail<'_>) -> Option<String> {
    let disposition = part.get_content_disposition();
    let filename = disposition
        .params
        .get("filename")
        .or_else(|| part.ctype.params.get("name"));
    let inline_attachment = disposition.disposition == DispositionType::Inline
        && !part.ctype.mimetype.eq_ignore_ascii_case("text/plain")
        && !part.ctype.mimetype.eq_ignore_ascii_case("text/html");
    if disposition.disposition != DispositionType::Attachment && filename.is_none() && !inline_attachment {
        return None;
    }
    Some(sanitize_filename(filename.map(String::as_str).unwrap_or("attachment")))
}

fn strip_html_text(html: &str) -> String {
    let mut text = String::new();
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                text.push(' ');
            }
            _ if !in_tag => text.push(ch),
            _ => {}
        }
    }
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn sanitize_filename(filename: &str) -> String {
    let mut cleaned = filename
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | '"' | '\'' | '<' | '>' | ':' | '|' | '?' | '*' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect::<String>();
    cleaned.truncate(180);
    if cleaned.trim().is_empty() {
        "attachment".to_string()
    } else {
        cleaned
    }
}

fn content_type(part: &ParsedMail<'_>) -> String {
    if part.ctype.mimetype.is_empty() {
        "application/octet-stream".to_string()
    } else {
        part.ctype.mimetype.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sealed_password_round_trips_without_serializing_plaintext() {
        install_test_password_key();
        let sealed = SealedPassword::seal("mail-secret").unwrap();
        let json = serde_json::to_string(&sealed).unwrap();

        assert_eq!(sealed.reveal().unwrap(), "mail-secret");
        assert!(!json.contains("mail-secret"));
    }

    #[test]
    fn password_key_requires_dedicated_strong_secret() {
        let missing = derive_password_key(None).unwrap_err();
        assert!(missing.to_string().contains("CALDAVER_MAIL_PASSWORD_KEY is required"));

        let weak = derive_password_key(Some("short-secret")).unwrap_err();
        assert!(weak.to_string().contains("at least 32 bytes"));

        assert!(derive_password_key(Some("0123456789abcdef0123456789abcdef")).is_ok());
    }

    #[test]
    fn parse_message_preserves_html_and_collects_attachments() {
        let raw = concat!(
            "From: Ada <ada@example.test>\r\n",
            "Subject: Report\r\n",
            "Date: Mon, 01 Jan 2024 00:00:00 +0000\r\n",
            "Content-Type: multipart/mixed; boundary=mix\r\n",
            "\r\n",
            "--mix\r\n",
            "Content-Type: text/html; charset=utf-8\r\n",
            "\r\n",
            "<p onclick=\"bad()\">Hello</p><script>alert(1)</script>\r\n",
            "--mix\r\n",
            "Content-Type: text/plain\r\n",
            "Content-Disposition: attachment; filename=\"../report.txt\"\r\n",
            "\r\n",
            "attached\r\n",
            "--mix--\r\n"
        );

        let message = parse_mail_message(42, false, None, raw.as_bytes(), true).unwrap();

        assert_eq!(message.uid, 42);
        assert_eq!(message.subject, "Report");
        assert!(message.html_body.contains("onclick"));
        assert!(message.html_body.contains("script"));
        assert_eq!(
            message.attachments,
            vec![MailAttachment {
                part: "2".to_string(),
                filename: ".._report.txt".to_string(),
                content_type: "text/plain".to_string(),
                size: 8,
            }]
        );
    }

    #[test]
    fn downloads_attachment_by_stable_part_path() {
        let raw = concat!(
            "Content-Type: multipart/mixed; boundary=mix\r\n",
            "\r\n",
            "--mix\r\n",
            "Content-Type: text/plain\r\n\r\nbody\r\n",
            "--mix\r\n",
            "Content-Type: application/octet-stream; name=\"file.bin\"\r\n",
            "Content-Disposition: attachment; filename=\"file.bin\"\r\n",
            "\r\n",
            "bytes\r\n",
            "--mix--\r\n"
        );
        let parsed = mailparse::parse_mail(raw.as_bytes()).unwrap();
        let download = find_attachment(&parsed, "", "2").unwrap().unwrap();

        assert_eq!(download.filename, "file.bin");
        assert_eq!(download.content_type, "application/octet-stream");
        assert_eq!(download.bytes, b"bytes");
    }

    #[test]
    fn message_navigation_uses_sorted_uid_neighbors_with_gaps() {
        let navigation = message_navigation_from_uids(vec![101, 740, 742, 900, 743], 742);

        assert_eq!(navigation.previous, Some(743));
        assert_eq!(navigation.next, Some(740));
    }

    #[test]
    fn parse_message_handles_subject_body_and_inline_attachment_fallbacks() {
        let raw = concat!(
            "From: Ada <ada@example.test>\r\n",
            "Date: Mon, 01 Jan 2024 00:00:00 +0000\r\n",
            "Content-Type: multipart/related; boundary=rel\r\n",
            "\r\n",
            "--rel\r\n",
            "Content-Type: text/html; charset=utf-8\r\n",
            "\r\n",
            "<p>Hello <strong>world</strong></p>\r\n",
            "--rel\r\n",
            "Content-Type: image/png\r\n",
            "Content-Disposition: inline\r\n",
            "\r\n",
            "png-bytes\r\n",
            "--rel--\r\n"
        );

        let message = parse_mail_message(7, false, None, raw.as_bytes(), true).unwrap();

        assert_eq!(message.subject, "(No subject)");
        assert_eq!(message.body, "Hello world");
        assert_eq!(
            message.attachments,
            vec![MailAttachment {
                part: "2".to_string(),
                filename: "attachment".to_string(),
                content_type: "image/png".to_string(),
                size: 9,
            }]
        );
    }

    #[test]
    fn special_use_matches_rfc6154_attributes_and_common_names() {
        assert!(SpecialUse::Trash.matches_attribute(&imap_proto::NameAttribute::Trash));
        assert!(!SpecialUse::Trash.matches_attribute(&imap_proto::NameAttribute::Archive));
        assert!(SpecialUse::Archive.matches_attribute(&imap_proto::NameAttribute::Archive));
        assert!(!SpecialUse::Archive.matches_attribute(&imap_proto::NameAttribute::Sent));

        assert!(SpecialUse::Trash.matches_name_lower("trash"));
        assert!(SpecialUse::Trash.matches_name_lower("inbox/trash"));
        assert!(!SpecialUse::Trash.matches_name_lower("drafts"));
        assert!(SpecialUse::Archive.matches_name_lower("archive"));
        assert!(SpecialUse::Archive.matches_name_lower("personal/archive"));
        assert!(!SpecialUse::Archive.matches_name_lower("archives"));
    }
}
