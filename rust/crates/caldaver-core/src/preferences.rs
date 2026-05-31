#[derive(Debug, Clone, PartialEq)]
pub enum PreferenceValue {
    Null,
    Bool(bool),
    Integer(i64),
    String(String),
    Array(Vec<PreferenceValue>),
    Object(Vec<(String, PreferenceValue)>),
}

impl PreferenceValue {
    fn to_json(&self) -> String {
        match self {
            Self::Null => "null".to_string(),
            Self::Bool(value) => value.to_string(),
            Self::Integer(value) => value.to_string(),
            Self::String(value) => json_string(value),
            Self::Array(values) => {
                let values = values
                    .iter()
                    .map(Self::to_json)
                    .collect::<Vec<_>>()
                    .join(",");
                format!("[{values}]")
            }
            Self::Object(values) => json_object(values),
        }
    }
}

impl From<&str> for PreferenceValue {
    fn from(value: &str) -> Self {
        Self::String(value.to_string())
    }
}

impl From<String> for PreferenceValue {
    fn from(value: String) -> Self {
        Self::String(value)
    }
}

impl From<bool> for PreferenceValue {
    fn from(value: bool) -> Self {
        Self::Bool(value)
    }
}

impl From<i64> for PreferenceValue {
    fn from(value: i64) -> Self {
        Self::Integer(value)
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Preferences {
    username: Option<String>,
    options: Vec<(String, PreferenceValue)>,
}

impl Preferences {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_options(options: impl IntoIterator<Item = (String, PreferenceValue)>) -> Self {
        let mut preferences = Self::new();
        preferences.set_all(options);
        preferences
    }

    pub fn username(&self) -> Option<&str> {
        self.username.as_deref()
    }

    pub fn set_username(&mut self, username: impl Into<String>) {
        self.username = Some(username.into());
    }

    pub fn get(&self, name: &str) -> Option<&PreferenceValue> {
        self.options
            .iter()
            .find_map(|(key, value)| (key == name).then_some(value))
    }

    pub fn get_or<'a>(
        &'a self,
        name: &str,
        default_value: &'a PreferenceValue,
    ) -> &'a PreferenceValue {
        self.get(name).unwrap_or(default_value)
    }

    pub fn contains(&self, name: &str) -> bool {
        self.get(name).is_some()
    }

    pub fn set(&mut self, name: impl Into<String>, value: impl Into<PreferenceValue>) {
        let name = name.into();
        let value = value.into();

        if let Some((_, existing_value)) = self.options.iter_mut().find(|(key, _)| key == &name) {
            *existing_value = value;
            return;
        }

        self.options.push((name, value));
    }

    pub fn all(&self) -> &[(String, PreferenceValue)] {
        &self.options
    }

    pub fn set_all(&mut self, options: impl IntoIterator<Item = (String, PreferenceValue)>) {
        self.options.clear();
        for (name, value) in options {
            self.set(name, value);
        }
    }

    pub fn add_defaults(&mut self, defaults: impl IntoIterator<Item = (String, PreferenceValue)>) {
        for (name, default_value) in defaults {
            match self
                .options
                .iter_mut()
                .find(|(existing_name, _)| existing_name == &name)
            {
                Some((_, value @ PreferenceValue::Null)) => *value = default_value,
                Some(_) => {}
                None => self.options.push((name, default_value)),
            }
        }
    }

    pub fn to_json(&self) -> String {
        json_object(&self.options)
    }
}

fn json_object(values: &[(String, PreferenceValue)]) -> String {
    let values = values
        .iter()
        .map(|(key, value)| format!("{}:{}", json_string(key), value.to_json()))
        .collect::<Vec<_>>()
        .join(",");
    format!("{{{values}}}")
}

fn json_string(value: &str) -> String {
    let mut result = String::with_capacity(value.len() + 2);
    result.push('"');

    for character in value.chars() {
        match character {
            '"' => result.push_str("\\\""),
            '\\' => result.push_str("\\\\"),
            '\u{08}' => result.push_str("\\b"),
            '\u{0c}' => result.push_str("\\f"),
            '\n' => result.push_str("\\n"),
            '\r' => result.push_str("\\r"),
            '\t' => result.push_str("\\t"),
            character if character <= '\u{1f}' => {
                result.push_str(&format!("\\u{:04x}", character as u32));
            }
            character => result.push(character),
        }
    }

    result.push('"');
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn string(value: &str) -> PreferenceValue {
        PreferenceValue::String(value.to_string())
    }

    #[test]
    fn stores_username() {
        let mut preferences = Preferences::new();
        preferences.set_username("user");

        assert_eq!(preferences.username(), Some("user"));
    }

    #[test]
    fn creates_from_options_and_gets_values() {
        let preferences = Preferences::from_options([
            ("id1".to_string(), string("value1")),
            ("id2".to_string(), string("value2")),
        ]);

        assert_eq!(preferences.get("id1"), Some(&string("value1")));
        assert_eq!(preferences.get("id2"), Some(&string("value2")));
        assert_eq!(preferences.get("missing"), None);
    }

    #[test]
    fn replaces_all_options() {
        let mut preferences =
            Preferences::from_options([("old".to_string(), string("old value"))]);

        preferences.set_all([
            ("i1".to_string(), string("v1")),
            ("i2".to_string(), string("v2")),
        ]);

        assert_eq!(preferences.get("old"), None);
        assert_eq!(preferences.get("i1"), Some(&string("v1")));
        assert_eq!(preferences.get("i2"), Some(&string("v2")));
    }

    #[test]
    fn returns_default_for_missing_values() {
        let mut preferences = Preferences::new();
        preferences.set("exists", "This one exists");

        let default = string("default");

        assert_eq!(
            preferences.get_or("exists", &default),
            &string("This one exists")
        );
        assert_eq!(preferences.get_or("does_not_exist", &default), &default);
    }

    #[test]
    fn defaults_do_not_overwrite_existing_non_null_values() {
        let mut preferences = Preferences::from_options([
            ("existing".to_string(), string("custom")),
            ("null_value".to_string(), PreferenceValue::Null),
        ]);

        preferences.add_defaults([
            ("existing".to_string(), string("default")),
            ("null_value".to_string(), string("filled")),
            ("new".to_string(), string("new default")),
        ]);

        assert_eq!(preferences.get("existing"), Some(&string("custom")));
        assert_eq!(preferences.get("null_value"), Some(&string("filled")));
        assert_eq!(preferences.get("new"), Some(&string("new default")));
    }

    #[test]
    fn serializes_options_as_json() {
        let preferences = Preferences::from_options([
            ("id1".to_string(), string("value\n1")),
            ("enabled".to_string(), PreferenceValue::Bool(true)),
            (
                "nested".to_string(),
                PreferenceValue::Object(vec![("count".to_string(), PreferenceValue::Integer(3))]),
            ),
        ]);

        assert_eq!(
            preferences.to_json(),
            "{\"id1\":\"value\\n1\",\"enabled\":true,\"nested\":{\"count\":3}}"
        );
    }
}
