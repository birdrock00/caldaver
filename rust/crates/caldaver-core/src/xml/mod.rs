pub mod generator;
pub mod parser;
pub mod toolkit;

use indexmap::IndexMap;

pub const DAV_NS: &str = "DAV:";
pub const CALDAV_NS: &str = "urn:ietf:params:xml:ns:caldav";
pub const CARDDAV_NS: &str = "urn:ietf:params:xml:ns:carddav";
pub const APPLE_ICAL_NS: &str = "http://apple.com/ns/ical/";

pub type Properties = IndexMap<String, XmlValue>;
pub type MultistatusProperties = IndexMap<String, Properties>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum XmlValue {
    Empty,
    Text(String),
    Href(String),
    ResourceType(Vec<String>),
    Elements(Vec<XmlElement>),
}

impl XmlValue {
    pub fn text(value: impl Into<String>) -> Self {
        Self::Text(value.into())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct XmlElement {
    pub name: String,
    pub attributes: IndexMap<String, String>,
    pub value: XmlValue,
}

impl XmlElement {
    pub fn empty(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            attributes: IndexMap::new(),
            value: XmlValue::Empty,
        }
    }

    pub fn text(name: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            attributes: IndexMap::new(),
            value: XmlValue::Text(value.into()),
        }
    }

    pub fn children(name: impl Into<String>, children: Vec<Self>) -> Self {
        Self {
            name: name.into(),
            attributes: IndexMap::new(),
            value: XmlValue::Elements(children),
        }
    }

    pub fn with_attribute(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.attributes.insert(name.into(), value.into());
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct XmlProperty {
    pub name: String,
    pub value: XmlValue,
}

impl XmlProperty {
    pub fn empty(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            value: XmlValue::Empty,
        }
    }

    pub fn text(name: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            value: XmlValue::Text(value.into()),
        }
    }

    pub fn elements(name: impl Into<String>, elements: Vec<XmlElement>) -> Self {
        Self {
            name: name.into(),
            value: XmlValue::Elements(elements),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum XmlError {
    InvalidClarkName(String),
    Parse(String),
    MissingMultistatusRoot,
    UnsupportedRequest(String),
    MissingRequestParameters(&'static str),
}

impl std::fmt::Display for XmlError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidClarkName(name) => write!(f, "invalid Clark notation name: {name}"),
            Self::Parse(message) => write!(f, "XML parse error: {message}"),
            Self::MissingMultistatusRoot => write!(f, "expected {{DAV:}}multistatus root"),
            Self::UnsupportedRequest(request) => write!(f, "unsupported request type: {request}"),
            Self::MissingRequestParameters(expected) => {
                write!(f, "missing or invalid request parameters: {expected}")
            }
        }
    }
}

impl std::error::Error for XmlError {}

pub fn clark(namespace: &str, local: &str) -> String {
    format!("{{{namespace}}}{local}")
}

pub fn parse_clark(name: &str) -> Option<(&str, &str)> {
    let rest = name.strip_prefix('{')?;
    let end = rest.find('}')?;
    Some((&rest[..end], &rest[end + 1..]))
}

fn clark_from_node(node: roxmltree::Node<'_, '_>) -> String {
    let tag = node.tag_name();
    match tag.namespace() {
        Some(namespace) => clark(namespace, tag.name()),
        None => tag.name().to_string(),
    }
}

pub(crate) fn property_elements(properties: &[XmlProperty], include_values: bool) -> Vec<XmlElement> {
    properties
        .iter()
        .map(|property| XmlElement {
            name: property.name.clone(),
            attributes: IndexMap::new(),
            value: if include_values {
                property.value.clone()
            } else {
                XmlValue::Empty
            },
        })
        .collect()
}

pub(crate) fn status_code(status: &str) -> Option<u16> {
    status.split_whitespace().nth(1)?.parse().ok()
}
