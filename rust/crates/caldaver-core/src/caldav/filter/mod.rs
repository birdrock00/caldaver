use indexmap::IndexMap;

use crate::xml::{CALDAV_NS, DAV_NS, XmlElement, XmlValue, clark};

pub trait ComponentFilter {
    fn to_xml_element(&self) -> XmlElement;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TimeRange {
    pub start: String,
    pub end: String,
}

impl TimeRange {
    pub fn new(start: impl Into<String>, end: impl Into<String>) -> Self {
        Self {
            start: start.into(),
            end: end.into(),
        }
    }
}

impl ComponentFilter for TimeRange {
    fn to_xml_element(&self) -> XmlElement {
        XmlElement::empty(clark(CALDAV_NS, "time-range"))
            .with_attribute("start", &self.start)
            .with_attribute("end", &self.end)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Uid {
    pub uid: String,
}

impl Uid {
    pub fn new(uid: impl Into<String>) -> Self {
        Self { uid: uid.into() }
    }
}

impl ComponentFilter for Uid {
    fn to_xml_element(&self) -> XmlElement {
        XmlElement::children(
            clark(CALDAV_NS, "prop-filter"),
            vec![
                XmlElement::text(clark(CALDAV_NS, "text-match"), &self.uid)
                    .with_attribute("collation", "i;octet"),
            ],
        )
        .with_attribute("name", "UID")
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrincipalPropertySearch {
    pub input: String,
}

impl PrincipalPropertySearch {
    pub fn new(input: impl Into<String>) -> Self {
        Self {
            input: input.into(),
        }
    }
}

impl ComponentFilter for PrincipalPropertySearch {
    fn to_xml_element(&self) -> XmlElement {
        let search_properties = [
            clark(CALDAV_NS, "calendar-user-address-set"),
            clark(DAV_NS, "displayname"),
        ];

        let mut children = Vec::new();
        for property in search_properties {
            children.push(XmlElement::children(
                clark(DAV_NS, "property-search"),
                vec![
                    XmlElement::children(
                        clark(DAV_NS, "prop"),
                        vec![XmlElement::empty(property)],
                    ),
                    XmlElement::text(clark(DAV_NS, "match"), &self.input),
                ],
            ));
        }

        children.push(XmlElement::children(
            clark(DAV_NS, "prop"),
            vec![
                XmlElement::empty(clark(DAV_NS, "displayname")),
                XmlElement::empty(clark(DAV_NS, "email")),
            ],
        ));

        XmlElement {
            name: clark(DAV_NS, "principal-property-search"),
            attributes: IndexMap::from([("test".to_string(), "anyof".to_string())]),
            value: XmlValue::Elements(children),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TestFilter {
    pub tag: String,
}

impl TestFilter {
    pub fn new(tag: impl Into<String>) -> Self {
        Self { tag: tag.into() }
    }
}

impl ComponentFilter for TestFilter {
    fn to_xml_element(&self) -> XmlElement {
        XmlElement::empty(self.tag.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn time_range_builds_caldav_element_with_range_attributes() {
        let element = TimeRange::new("20141114T000000Z", "20141115T000000Z").to_xml_element();

        assert_eq!(element.name, "{urn:ietf:params:xml:ns:caldav}time-range");
        assert_eq!(element.attributes["start"], "20141114T000000Z");
        assert_eq!(element.attributes["end"], "20141115T000000Z");
    }

    #[test]
    fn uid_filter_matches_legacy_prop_filter_shape() {
        let element = Uid::new("1234567890").to_xml_element();

        assert_eq!(element.name, "{urn:ietf:params:xml:ns:caldav}prop-filter");
        assert_eq!(element.attributes["name"], "UID");
        let XmlValue::Elements(children) = element.value else {
            panic!("uid filter should contain a text-match child");
        };
        assert_eq!(children[0].name, "{urn:ietf:params:xml:ns:caldav}text-match");
        assert_eq!(children[0].attributes["collation"], "i;octet");
        assert_eq!(children[0].value, XmlValue::Text("1234567890".to_string()));
    }

    #[test]
    fn principal_property_search_searches_address_and_display_name() {
        let element = PrincipalPropertySearch::new("abcdefg").to_xml_element();

        assert_eq!(element.name, "{DAV:}principal-property-search");
        assert_eq!(element.attributes["test"], "anyof");
        let XmlValue::Elements(children) = element.value else {
            panic!("principal search should have children");
        };

        assert_eq!(children.len(), 3);
        assert_eq!(children[0].name, "{DAV:}property-search");
        assert_eq!(children[1].name, "{DAV:}property-search");
        assert_eq!(children[2].name, "{DAV:}prop");
    }
}
