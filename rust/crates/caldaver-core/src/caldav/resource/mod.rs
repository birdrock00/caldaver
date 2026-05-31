use indexmap::IndexMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResourceError {
    UrlCannotBeChanged,
}

impl std::fmt::Display for ResourceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UrlCannotBeChanged => write!(f, "calendar URL cannot be changed"),
        }
    }
}

impl std::error::Error for ResourceError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrincipalRef {
    pub url: String,
    pub display_name: Option<String>,
    pub email: Option<String>,
}

impl PrincipalRef {
    pub const DISPLAYNAME: &'static str = "{DAV:}displayname";

    pub fn new(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            display_name: None,
            email: None,
        }
    }

    pub fn display_name(&self) -> &str {
        self.display_name.as_deref().unwrap_or(&self.url)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CalendarShare {
    pub sid: Option<i64>,
    pub owner: Option<String>,
    pub calendar: Option<String>,
    pub with: Option<String>,
    pub principal: Option<PrincipalRef>,
    pub writable: bool,
    properties: IndexMap<String, String>,
}

impl CalendarShare {
    pub fn property(&self, name: &str) -> Option<&str> {
        self.properties.get(name).map(String::as_str)
    }

    pub fn set_property(&mut self, name: impl Into<String>, value: impl Into<String>) {
        self.properties.insert(name.into(), value.into());
    }

    pub fn properties(&self) -> &IndexMap<String, String> {
        &self.properties
    }

    pub fn apply_custom_properties_to(&self, calendar: &mut Calendar) -> Result<(), ResourceError> {
        for (property, value) in &self.properties {
            calendar.set_property(property, value)?;
        }

        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Calendar {
    url: String,
    properties: IndexMap<String, String>,
    writable: bool,
    owner: Option<PrincipalRef>,
    shares: Vec<CalendarShare>,
}

impl Calendar {
    pub const DISPLAYNAME: &'static str = "{DAV:}displayname";
    pub const CTAG: &'static str = "{http://calendarserver.org/ns/}getctag";
    pub const COLOR: &'static str = "{http://apple.com/ns/ical/}calendar-color";
    pub const ORDER: &'static str = "{http://apple.com/ns/ical/}calendar-order";
    pub const WRITABLE_PROPERTIES: [&'static str; 2] = [Self::DISPLAYNAME, Self::COLOR];

    pub fn new(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            properties: IndexMap::new(),
            writable: true,
            owner: None,
            shares: Vec::new(),
        }
    }

    pub fn with_properties(
        url: impl Into<String>,
        properties: impl IntoIterator<Item = (String, String)>,
    ) -> Result<Self, ResourceError> {
        let mut calendar = Self::new(url);
        for (property, value) in properties {
            calendar.set_property(property, value)?;
        }
        Ok(calendar)
    }

    pub fn url(&self) -> &str {
        &self.url
    }

    pub fn property(&self, property: &str) -> Option<&str> {
        self.properties
            .get(property)
            .filter(|value| !value.is_empty())
            .map(String::as_str)
    }

    pub fn set_property(
        &mut self,
        property: impl Into<String>,
        value: impl Into<String>,
    ) -> Result<(), ResourceError> {
        let property = property.into();
        if property == "url" {
            return Err(ResourceError::UrlCannotBeChanged);
        }

        let mut value = value.into();
        if property == Self::COLOR {
            value = ensure_rgba_color(&value);
        }

        self.properties.insert(property, value);
        Ok(())
    }

    pub fn all_properties(&self) -> &IndexMap<String, String> {
        &self.properties
    }

    pub fn writable_properties(&self) -> IndexMap<String, String> {
        Self::WRITABLE_PROPERTIES
            .iter()
            .filter_map(|property| {
                self.properties
                    .get(*property)
                    .map(|value| ((*property).to_string(), value.clone()))
            })
            .collect()
    }

    pub fn is_writable(&self) -> bool {
        self.writable
    }

    pub fn set_writable(&mut self, writable: bool) {
        self.writable = writable;
    }

    pub fn owner(&self) -> Option<&PrincipalRef> {
        self.owner.as_ref()
    }

    pub fn set_owner(&mut self, owner: PrincipalRef) {
        self.owner = Some(owner);
    }

    pub fn shares(&self) -> &[CalendarShare] {
        &self.shares
    }

    pub fn set_shares(&mut self, shares: Vec<CalendarShare>) {
        self.shares = shares;
    }

    pub fn add_share(&mut self, share: CalendarShare) {
        self.shares.push(share);
    }

    pub fn remove_share(&mut self, share_to_remove: &CalendarShare) -> bool {
        let Some(position) = self
            .shares
            .iter()
            .position(|share| share.sid == share_to_remove.sid)
        else {
            return false;
        };

        self.shares.remove(position);
        true
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CalendarObject {
    url: String,
    calendar: Option<Calendar>,
    etag: Option<String>,
    rendered_event: Option<String>,
}

impl CalendarObject {
    pub const DATA: &'static str = "{urn:ietf:params:xml:ns:caldav}calendar-data";
    pub const ETAG: &'static str = "{DAV:}getetag";

    pub fn new(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            calendar: None,
            etag: None,
            rendered_event: None,
        }
    }

    pub fn url(&self) -> &str {
        &self.url
    }

    pub fn set_url(&mut self, url: impl Into<String>) -> &mut Self {
        self.url = url.into();
        self
    }

    pub fn calendar(&self) -> Option<&Calendar> {
        self.calendar.as_ref()
    }

    pub fn set_calendar(&mut self, calendar: Calendar) -> &mut Self {
        self.calendar = Some(calendar);
        self
    }

    pub fn etag(&self) -> Option<&str> {
        self.etag.as_deref()
    }

    pub fn set_etag(&mut self, etag: Option<String>) -> &mut Self {
        self.etag = etag;
        self
    }

    pub fn rendered_event(&self) -> Option<&str> {
        self.rendered_event.as_deref()
    }

    pub fn set_rendered_event(&mut self, rendered_event: impl Into<String>) -> &mut Self {
        self.rendered_event = Some(rendered_event.into());
        self
    }

    pub fn generate_on_calendar(calendar: &Calendar, uid: &str) -> Self {
        let mut result = Self::new(format!("{}{uid}.ics", calendar.url()));
        result.set_calendar(calendar.clone());
        result
    }
}

fn ensure_rgba_color(color: &str) -> String {
    if color.len() == 7 {
        return format!("{color}ff");
    }

    if color.len() == 4 && color.starts_with('#') {
        let mut chars = color.chars();
        let _hash = chars.next();
        let r = chars.next().unwrap_or_default();
        let g = chars.next().unwrap_or_default();
        let b = chars.next().unwrap_or_default();
        return format!("#{r}{r}{g}{g}{b}{b}ff");
    }

    color.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calendar_stores_properties_and_filters_writable_ones() {
        let calendar = Calendar::with_properties(
            "/path",
            [
                (Calendar::DISPLAYNAME.to_string(), "Test".to_string()),
                (Calendar::CTAG.to_string(), "123".to_string()),
                ("{urn:fake}attr".to_string(), "value".to_string()),
            ],
        )
        .unwrap();

        assert_eq!(calendar.property(Calendar::DISPLAYNAME), Some("Test"));
        assert!(!calendar.writable_properties().contains_key(Calendar::CTAG));
        assert!(calendar.writable_properties().contains_key(Calendar::DISPLAYNAME));
    }

    #[test]
    fn calendar_rejects_url_property_and_normalizes_colors() {
        let mut calendar = Calendar::new("/cal1");

        assert_eq!(
            calendar.set_property("url", "/should_not_change"),
            Err(ResourceError::UrlCannotBeChanged)
        );

        calendar.set_property(Calendar::COLOR, "#000000").unwrap();
        assert_eq!(calendar.property(Calendar::COLOR), Some("#000000ff"));

        calendar.set_property(Calendar::COLOR, "#012").unwrap();
        assert_eq!(calendar.property(Calendar::COLOR), Some("#001122ff"));
    }

    #[test]
    fn calendar_tracks_owner_writability_and_shares() {
        let mut calendar = Calendar::new("/calendar1");
        assert!(calendar.is_writable());

        calendar.set_writable(false);
        assert!(!calendar.is_writable());

        calendar.set_owner(PrincipalRef::new("/jorge"));
        assert_eq!(calendar.owner().unwrap().display_name(), "/jorge");

        let share_1 = CalendarShare {
            sid: Some(1),
            with: Some("demo".to_string()),
            ..CalendarShare::default()
        };
        let share_2 = CalendarShare {
            sid: Some(2),
            with: Some("second".to_string()),
            ..CalendarShare::default()
        };
        calendar.set_shares(vec![share_1.clone(), share_2.clone()]);
        assert!(calendar.remove_share(&share_1));
        assert_eq!(calendar.shares(), &[share_2]);
    }

    #[test]
    fn calendar_object_is_generated_on_calendar_url() {
        let calendar = Calendar::new("/calendar1/");
        let object = CalendarObject::generate_on_calendar(&calendar, "123456");

        assert_eq!(object.url(), "/calendar1/123456.ics");
        assert_eq!(object.calendar().unwrap(), &calendar);
    }
}
