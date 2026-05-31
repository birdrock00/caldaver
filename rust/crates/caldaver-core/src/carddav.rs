use std::collections::{hash_map::DefaultHasher, BTreeMap};
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub const DISPLAYNAME: &str = "{DAV:}displayname";
pub const DESCRIPTION: &str = "{urn:ietf:params:xml:ns:carddav}addressbook-description";
pub const CTAG: &str = "{http://calendarserver.org/ns/}getctag";
pub const ADDRESS_DATA: &str = "{urn:ietf:params:xml:ns:carddav}address-data";
pub const ETAG: &str = "{DAV:}getetag";

const AVATAR_COLORS: [&str; 8] = [
    "#1a73e8", "#188038", "#9334e6", "#d93025", "#00897b", "#5f6368", "#c5221f", "#7b1fa2",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AddressBook {
    pub url: String,
    pub properties: BTreeMap<String, String>,
}

impl AddressBook {
    pub const DISPLAYNAME: &'static str = "{DAV:}displayname";
    pub const DESCRIPTION: &'static str = "{urn:ietf:params:xml:ns:carddav}addressbook-description";
    pub const CTAG: &'static str = "{http://calendarserver.org/ns/}getctag";

    pub fn new(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            properties: BTreeMap::new(),
        }
    }

    pub fn with_properties<K, V, I>(url: impl Into<String>, properties: I) -> Self
    where
        K: Into<String>,
        V: Into<String>,
        I: IntoIterator<Item = (K, V)>,
    {
        Self {
            url: url.into(),
            properties: properties
                .into_iter()
                .map(|(name, value)| (name.into(), value.into()))
                .collect(),
        }
    }

    pub fn property(&self, property: &str) -> Option<&str> {
        self.properties.get(property).map(String::as_str)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Contact {
    pub url: String,
    pub etag: Option<String>,
    pub uid: String,
    pub full_name: String,
    pub email: String,
    pub phone: String,
    pub organization: String,
    pub job_title: String,
    pub labels: Vec<String>,
}

impl Contact {
    pub const DATA: &'static str = "{urn:ietf:params:xml:ns:carddav}address-data";
    pub const ETAG: &'static str = "{DAV:}getetag";

    #[allow(clippy::too_many_arguments)]
    pub fn new(
        url: impl Into<String>,
        etag: Option<impl Into<String>>,
        uid: impl Into<String>,
        full_name: impl Into<String>,
        email: impl Into<String>,
        phone: impl Into<String>,
        organization: impl Into<String>,
        job_title: impl Into<String>,
        labels: Vec<String>,
    ) -> Self {
        Self {
            url: url.into(),
            etag: etag.map(Into::into),
            uid: uid.into(),
            full_name: full_name.into(),
            email: email.into(),
            phone: phone.into(),
            organization: organization.into(),
            job_title: job_title.into(),
            labels,
        }
    }

    pub fn from_vcard(
        url: impl Into<String>,
        etag: Option<impl Into<String>>,
        raw_vcard: &str,
    ) -> Self {
        let url = url.into();
        let properties = parse_vcard(raw_vcard);
        let full_name = first_value(&properties, "FN")
            .or_else(|| first_value(&properties, "N"))
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "Unnamed contact".to_string());

        Self {
            uid: first_value(&properties, "UID").unwrap_or_else(|| basename_without_vcf(&url)),
            email: first_value(&properties, "EMAIL").unwrap_or_default(),
            phone: first_value(&properties, "TEL").unwrap_or_default(),
            organization: organization(&properties),
            job_title: first_value(&properties, "TITLE").unwrap_or_default(),
            labels: categories(&properties),
            url,
            etag: etag.map(Into::into),
            full_name,
        }
    }

    pub fn view(&self) -> ContactView {
        ContactView {
            url: self.url.clone(),
            etag: self.etag.clone(),
            uid: self.uid.clone(),
            full_name: self.full_name.clone(),
            email: self.email.clone(),
            phone: self.phone.clone(),
            organization: self.organization.clone(),
            job_title: self.job_title.clone(),
            company_line: self.company_line(),
            labels: self.labels.clone(),
            initial: self.initial(),
            avatar_color: self.avatar_color().to_string(),
        }
    }

    pub fn company_line(&self) -> String {
        match (self.job_title.is_empty(), self.organization.is_empty()) {
            (false, false) => format!("{} at {}", self.job_title, self.organization),
            (false, true) => self.job_title.clone(),
            (true, false) => self.organization.clone(),
            (true, true) => String::new(),
        }
    }

    pub fn initial(&self) -> String {
        self.full_name
            .chars()
            .next()
            .map(|character| character.to_uppercase().collect())
            .unwrap_or_default()
    }

    pub fn avatar_color(&self) -> &'static str {
        AVATAR_COLORS[(crc32(self.full_name.as_bytes()) as usize) % AVATAR_COLORS.len()]
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContactView {
    pub url: String,
    pub etag: Option<String>,
    pub uid: String,
    pub full_name: String,
    pub email: String,
    pub phone: String,
    pub organization: String,
    pub job_title: String,
    pub company_line: String,
    pub labels: Vec<String>,
    pub initial: String,
    pub avatar_color: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ContactInput {
    pub uid: Option<String>,
    pub full_name: String,
    pub email: String,
    pub phone: String,
    pub organization: String,
    pub job_title: String,
}

pub fn build_vcard(data: &ContactInput) -> (String, String) {
    let uid = data.uid.clone().unwrap_or_else(generate_uuid_v4);
    let full_name = data.full_name.trim();
    let organization = data.organization.trim();
    let job_title = data.job_title.trim();
    let mut lines = vec![
        "BEGIN:VCARD".to_string(),
        "VERSION:4.0".to_string(),
        format!("UID:{}", escape_text(&uid)),
        format!("FN:{}", escape_text(full_name)),
        format!("N:{}", name_parts(full_name).join(";")),
    ];

    if !data.email.is_empty() {
        lines.push(format!("EMAIL;TYPE=internet:{}", escape_text(data.email.trim())));
    }

    if !data.phone.is_empty() {
        lines.push(format!("TEL;TYPE=cell:{}", escape_text(data.phone.trim())));
    }

    if !organization.is_empty() {
        lines.push(format!("ORG:{}", escape_text(organization)));
    }

    if !job_title.is_empty() {
        lines.push(format!("TITLE:{}", escape_text(job_title)));
    }

    lines.push("END:VCARD".to_string());
    lines.push(String::new());

    (uid, lines.join("\r\n"))
}

pub fn contact_url(address_book: &AddressBook, uid: &str) -> String {
    format!("{}{}.vcf", address_book.url, uid)
}

pub fn sort_contacts_by_full_name(contacts: &mut [Contact]) {
    contacts.sort_by(|left, right| {
        left.full_name
            .to_lowercase()
            .cmp(&right.full_name.to_lowercase())
    });
}

pub fn contacts_from_address_books<I, J>(address_books: I) -> Vec<Contact>
where
    I: IntoIterator<Item = J>,
    J: IntoIterator<Item = Contact>,
{
    let mut contacts: Vec<_> = address_books
        .into_iter()
        .flat_map(IntoIterator::into_iter)
        .collect();
    sort_contacts_by_full_name(&mut contacts);
    contacts
}

fn first_value(properties: &BTreeMap<String, Vec<String>>, name: &str) -> Option<String> {
    properties
        .get(name)
        .and_then(|values| values.first())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn organization(properties: &BTreeMap<String, Vec<String>>) -> String {
    let Some(raw) = properties.get("ORG").and_then(|values| values.first()) else {
        return String::new();
    };

    split_unescaped(raw, ';')
        .into_iter()
        .map(|part| unescape_text(part).trim().to_string())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn categories(properties: &BTreeMap<String, Vec<String>>) -> Vec<String> {
    let Some(raw) = properties.get("CATEGORIES").and_then(|values| values.first()) else {
        return Vec::new();
    };

    split_unescaped(raw, ',')
        .into_iter()
        .map(|part| unescape_text(part).trim().to_string())
        .filter(|part| !part.is_empty())
        .collect()
}

fn basename_without_vcf(url: &str) -> String {
    let basename = url.rsplit('/').next().unwrap_or(url);
    basename
        .strip_suffix(".vcf")
        .unwrap_or(basename)
        .to_string()
}

fn name_parts(full_name: &str) -> [String; 5] {
    let mut parts: Vec<_> = full_name.split_whitespace().collect();
    if parts.len() <= 1 {
        return [
            String::new(),
            escape_text(full_name),
            String::new(),
            String::new(),
            String::new(),
        ];
    }

    let last_name = parts.pop().unwrap_or_default();
    [
        escape_text(last_name),
        escape_text(&parts.join(" ")),
        String::new(),
        String::new(),
        String::new(),
    ]
}

fn parse_vcard(raw_vcard: &str) -> BTreeMap<String, Vec<String>> {
    let mut properties = BTreeMap::<String, Vec<String>>::new();

    for line in unfold_lines(raw_vcard) {
        let Some((name_and_params, value)) = line.split_once(':') else {
            continue;
        };
        let name = property_name(name_and_params);
        if name == "BEGIN" || name == "END" {
            continue;
        }

        let value = if name == "ORG" || name == "CATEGORIES" {
            value.trim().to_string()
        } else {
            unescape_text(value).trim().to_string()
        };
        properties.entry(name).or_default().push(value);
    }

    properties
}

fn unfold_lines(raw_vcard: &str) -> Vec<String> {
    let mut unfolded: Vec<String> = Vec::new();
    for line in raw_vcard.lines() {
        let line = line.trim_end_matches('\r');
        if line.starts_with(' ') || line.starts_with('\t') {
            if let Some(previous) = unfolded.last_mut() {
                previous.push_str(&line[1..]);
            }
        } else {
            unfolded.push(line.to_string());
        }
    }

    unfolded
}

fn property_name(name_and_params: &str) -> String {
    let name = name_and_params
        .split(';')
        .next()
        .unwrap_or(name_and_params)
        .rsplit('.')
        .next()
        .unwrap_or(name_and_params);
    name.to_ascii_uppercase()
}

fn split_unescaped(value: &str, delimiter: char) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0;
    let mut escaped = false;

    for (index, character) in value.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if character == '\\' {
            escaped = true;
            continue;
        }
        if character == delimiter {
            parts.push(&value[start..index]);
            start = index + character.len_utf8();
        }
    }

    parts.push(&value[start..]);
    parts
}

fn escape_text(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\r' => {}
            ',' => escaped.push_str("\\,"),
            ';' => escaped.push_str("\\;"),
            _ => escaped.push(character),
        }
    }

    escaped
}

fn unescape_text(value: &str) -> String {
    let mut unescaped = String::with_capacity(value.len());
    let mut characters = value.chars();

    while let Some(character) = characters.next() {
        if character != '\\' {
            unescaped.push(character);
            continue;
        }

        match characters.next() {
            Some('n' | 'N') => unescaped.push('\n'),
            Some('\\') => unescaped.push('\\'),
            Some(',') => unescaped.push(','),
            Some(';') => unescaped.push(';'),
            Some(other) => unescaped.push(other),
            None => unescaped.push('\\'),
        }
    }

    unescaped
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffff;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            let mask = 0u32.wrapping_sub(crc & 1);
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }

    !crc
}

fn generate_uuid_v4() -> String {
    let mut bytes = [0u8; 16];
    fill_random_bytes(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
        bytes[4],
        bytes[5],
        bytes[6],
        bytes[7],
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15]
    )
}

fn fill_random_bytes(bytes: &mut [u8; 16]) {
    #[cfg(unix)]
    {
        use std::fs::File;
        use std::io::Read;

        if File::open("/dev/urandom")
            .and_then(|mut file| file.read_exact(bytes))
            .is_ok()
        {
            return;
        }
    }

    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let counter = COUNTER.fetch_add(1, Ordering::Relaxed);
    let process_id = std::process::id();

    for chunk in 0..2 {
        let mut hasher = DefaultHasher::new();
        now.hash(&mut hasher);
        counter.hash(&mut hasher);
        process_id.hash(&mut hasher);
        chunk.hash(&mut hasher);

        let hash = hasher.finish().to_le_bytes();
        bytes[chunk * 8..(chunk + 1) * 8].copy_from_slice(&hash);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn address_book_returns_named_properties() {
        let address_book = AddressBook::with_properties(
            "/user/addressbook/",
            [
                (AddressBook::DISPLAYNAME, "Personal"),
                (AddressBook::DESCRIPTION, "Personal contacts"),
                (AddressBook::CTAG, "abc"),
            ],
        );

        assert_eq!(address_book.url, "/user/addressbook/");
        assert_eq!(address_book.property(AddressBook::DISPLAYNAME), Some("Personal"));
        assert_eq!(address_book.property("{DAV:}missing"), None);
        assert_eq!(Contact::DATA, ADDRESS_DATA);
        assert_eq!(Contact::ETAG, ETAG);
    }

    #[test]
    fn parses_contact_from_vcard_with_display_fields() {
        let contact = Contact::from_vcard(
            "/user/imported/alpha.vcf",
            Some("\"alpha\""),
            "BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
UID:alpha\r\n\
FN:Alpha One\r\n\
N:One;Alpha;;;\r\n\
EMAIL;TYPE=internet:alpha@example.test\r\n\
TEL;TYPE=cell:+14155550101\r\n\
ORG:Example;Research\r\n\
TITLE:Director\r\n\
CATEGORIES: Friend, Work ,,\\,Escaped\r\n\
END:VCARD\r\n",
        );

        assert_eq!(contact.uid, "alpha");
        assert_eq!(contact.full_name, "Alpha One");
        assert_eq!(contact.email, "alpha@example.test");
        assert_eq!(contact.phone, "+14155550101");
        assert_eq!(contact.organization, "Example Research");
        assert_eq!(contact.job_title, "Director");
        assert_eq!(contact.labels, ["Friend", "Work", ",Escaped"]);

        let view = contact.view();
        assert_eq!(view.company_line, "Director at Example Research");
        assert_eq!(view.initial, "A");
        assert_eq!(view.avatar_color, contact.avatar_color());
    }

    #[test]
    fn parses_forgiving_vcard_with_fallback_values() {
        let contact = Contact::from_vcard(
            "/user/imported/fallback.vcf",
            None::<String>,
            "BEGIN:VCARD\n\
VERSION:4.0\n\
bad invalid line\n\
N:Fallback Name;;;\n\
END:VCARD\n",
        );

        assert_eq!(contact.uid, "fallback");
        assert_eq!(contact.full_name, "Fallback Name;;;");
        assert_eq!(contact.email, "");
        assert_eq!(contact.labels, Vec::<String>::new());
    }

    #[test]
    fn builds_vcard_from_contact_input() {
        let data = ContactInput {
            uid: Some("contact-1".to_string()),
            full_name: " Ada Lovelace ".to_string(),
            email: " ada@example.test ".to_string(),
            phone: " +14155550123 ".to_string(),
            organization: " Analytical Engines ".to_string(),
            job_title: " Programmer ".to_string(),
        };

        let (uid, vcard) = build_vcard(&data);

        assert_eq!(uid, "contact-1");
        assert_eq!(
            vcard,
            "BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
UID:contact-1\r\n\
FN:Ada Lovelace\r\n\
N:Lovelace;Ada;;;\r\n\
EMAIL;TYPE=internet:ada@example.test\r\n\
TEL;TYPE=cell:+14155550123\r\n\
ORG:Analytical Engines\r\n\
TITLE:Programmer\r\n\
END:VCARD\r\n"
        );
    }

    #[test]
    fn builds_vcard_with_generated_uid_when_missing() {
        let data = ContactInput {
            full_name: "Solo".to_string(),
            ..ContactInput::default()
        };

        let (uid, vcard) = build_vcard(&data);

        assert_eq!(uid.len(), 36);
        assert_eq!(&uid[14..15], "4");
        assert!(matches!(&uid[19..20], "8" | "9" | "a" | "b"));
        assert!(vcard.contains(&format!("UID:{uid}\r\n")));
        assert!(vcard.contains("FN:Solo\r\nN:;Solo;;;\r\n"));
    }

    #[test]
    fn contact_url_matches_create_contact_path() {
        let address_book = AddressBook::new("/user/imported/");

        assert_eq!(contact_url(&address_book, "alpha"), "/user/imported/alpha.vcf");
    }

    #[test]
    fn contacts_from_address_books_keeps_going_after_empty_book_and_sorts() {
        let alpha = Contact::from_vcard(
            "/user/imported/alpha.vcf",
            Some("\"alpha\""),
            "BEGIN:VCARD\nVERSION:4.0\nUID:alpha\nFN:Alpha One\nEND:VCARD\n",
        );
        let beta = Contact::from_vcard(
            "/user/imported/beta.vcf",
            Some("\"beta\""),
            "BEGIN:VCARD\nVERSION:4.0\nUID:beta\nFN:Beta Two\nEND:VCARD\n",
        );

        let contacts = contacts_from_address_books([vec![], vec![beta, alpha]]);

        assert_eq!(contacts.len(), 2);
        assert_eq!(contacts[0].full_name, "Alpha One");
        assert_eq!(contacts[1].full_name, "Beta Two");
    }

    #[test]
    fn sort_contacts_by_full_name_is_case_insensitive() {
        let mut contacts = vec![
            Contact::new("/b.vcf", None::<String>, "b", "beta", "", "", "", "", vec![]),
            Contact::new("/a.vcf", None::<String>, "a", "Alpha", "", "", "", "", vec![]),
        ];

        sort_contacts_by_full_name(&mut contacts);

        assert_eq!(
            contacts
                .into_iter()
                .map(|contact| contact.full_name)
                .collect::<Vec<_>>(),
            ["Alpha", "beta"]
        );
    }
}
