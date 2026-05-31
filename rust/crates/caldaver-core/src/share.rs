use std::collections::BTreeMap;

pub const DISPLAYNAME_PROPERTY: &str = "{DAV:}displayname";
pub const COLOR_PROPERTY: &str = "{http://apple.com/ns/ical/}calendar-color";

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Share {
    sid: Option<i64>,
    owner: Option<String>,
    calendar: Option<String>,
    with: Option<String>,
    principal: Option<String>,
    options: Option<BTreeMap<String, String>>,
    writable: bool,
}

impl Share {
    pub fn new() -> Self {
        Self {
            options: Some(BTreeMap::new()),
            ..Self::default()
        }
    }

    pub fn sid(&self) -> Option<i64> {
        self.sid
    }

    pub fn set_sid(&mut self, sid: i64) {
        self.sid = Some(sid);
    }

    pub fn owner(&self) -> Option<&str> {
        self.owner.as_deref()
    }

    pub fn set_owner(&mut self, owner: impl Into<String>) -> &mut Self {
        self.owner = Some(owner.into());
        self
    }

    pub fn calendar(&self) -> Option<&str> {
        self.calendar.as_deref()
    }

    pub fn set_calendar(&mut self, calendar: impl Into<String>) -> &mut Self {
        self.calendar = Some(calendar.into());
        self
    }

    pub fn shared_with(&self) -> Option<&str> {
        self.with.as_deref()
    }

    pub fn set_with(&mut self, with: impl Into<String>) -> &mut Self {
        self.with = Some(with.into());
        self
    }

    pub fn principal(&self) -> Option<&str> {
        self.principal.as_deref()
    }

    pub fn set_principal(&mut self, principal: impl Into<String>) -> &mut Self {
        self.principal = Some(principal.into());
        self
    }

    pub fn is_writable(&self) -> bool {
        self.writable
    }

    pub fn set_write_permission(&mut self, writable: bool) {
        self.writable = writable;
    }

    pub fn properties(&self) -> BTreeMap<String, String> {
        self.options.clone().unwrap_or_default()
    }

    pub fn property(&self, name: &str) -> Option<&str> {
        self.options
            .as_ref()
            .and_then(|options| options.get(name))
            .map(String::as_str)
    }

    pub fn set_property(&mut self, name: impl Into<String>, value: impl Into<String>) {
        self.options
            .get_or_insert_with(BTreeMap::new)
            .insert(name.into(), value.into());
    }

    pub fn apply_custom_properties_to(&self, calendar_properties: &mut BTreeMap<String, String>) {
        for (property, value) in self.properties() {
            calendar_properties.insert(property, value);
        }
    }

    pub fn replace_old_properties(&mut self) {
        let Some(options) = self.options.as_mut() else {
            return;
        };

        for (old_name, new_name) in [
            ("displayname", DISPLAYNAME_PROPERTY),
            ("color", COLOR_PROPERTY),
        ] {
            let old_value = options.get(old_name).cloned();
            let new_value = options.get(new_name);

            if let (Some(old_value), None) = (old_value, new_value) {
                options.insert(new_name.to_string(), old_value);
            }

            options.remove(old_name);
        }
    }

    pub fn set_options_for_legacy_row(&mut self, options: Option<BTreeMap<String, String>>) {
        self.options = options;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handles_null_options_from_legacy_rows() {
        let mut share = Share::new();
        share.set_options_for_legacy_row(None);

        assert_eq!(share.properties(), BTreeMap::new());
        assert_eq!(share.property("xx"), None);

        share.set_property("abc", "def");

        assert_eq!(share.property("abc"), Some("def"));
    }

    #[test]
    fn applies_custom_properties_to_calendar_properties() {
        let mut calendar = BTreeMap::from([(
            DISPLAYNAME_PROPERTY.to_string(),
            "Original displayname".to_string(),
        )]);

        let mut share = Share::new();
        share.set_property(DISPLAYNAME_PROPERTY, "New displayname");
        share.set_property("{urn:test}invented", "Test value");

        share.apply_custom_properties_to(&mut calendar);

        assert_eq!(
            calendar.get(DISPLAYNAME_PROPERTY).map(String::as_str),
            Some("New displayname")
        );
        assert_eq!(
            calendar.get("{urn:test}invented").map(String::as_str),
            Some("Test value")
        );
    }

    #[test]
    fn replacing_old_properties_on_empty_share_is_a_noop() {
        let mut share = Share::new();

        share.replace_old_properties();

        assert_eq!(share.properties(), BTreeMap::new());
    }

    #[test]
    fn replaces_old_property_names_with_namespaced_property_names() {
        let mut share = Share::new();
        share.set_property("displayname", "Old style displayname");
        share.set_property("color", "#ffaa00ff");

        share.replace_old_properties();

        assert_eq!(
            share.property(DISPLAYNAME_PROPERTY),
            Some("Old style displayname")
        );
        assert_eq!(share.property("displayname"), None);
        assert_eq!(share.property(COLOR_PROPERTY), Some("#ffaa00ff"));
        assert_eq!(share.property("color"), None);
    }

    #[test]
    fn old_property_names_do_not_override_new_property_names() {
        let mut share = Share::new();
        share.set_property(DISPLAYNAME_PROPERTY, "New style displayname");
        share.set_property("displayname", "Old style displayname");

        share.replace_old_properties();

        assert_eq!(
            share.property(DISPLAYNAME_PROPERTY),
            Some("New style displayname")
        );
        assert_eq!(share.property("displayname"), None);
    }

    #[test]
    fn stores_share_fields() {
        let mut share = Share::new();
        share
            .set_owner("/me")
            .set_calendar("/calendar")
            .set_with("/with-1")
            .set_principal("/principals/with-1");
        share.set_sid(123);
        share.set_write_permission(true);

        assert_eq!(share.sid(), Some(123));
        assert_eq!(share.owner(), Some("/me"));
        assert_eq!(share.calendar(), Some("/calendar"));
        assert_eq!(share.shared_with(), Some("/with-1"));
        assert_eq!(share.principal(), Some("/principals/with-1"));
        assert!(share.is_writable());
    }
}
