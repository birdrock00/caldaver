use std::collections::{BTreeSet, HashMap};

use crate::caldav::filter::ComponentFilter;
use crate::caldav::filter::PrincipalPropertySearch;
use crate::caldav::share::Acl;
use crate::xml::{
    APPLE_ICAL_NS, CALDAV_NS, CARDDAV_NS, DAV_NS, XmlElement, XmlError, XmlProperty, XmlValue,
    clark, parse_clark, property_elements,
};

#[derive(Debug, Clone)]
pub struct Generator {
    formatted: bool,
}

impl Default for Generator {
    fn default() -> Self {
        Self { formatted: true }
    }
}

impl Generator {
    pub fn new(formatted: bool) -> Self {
        Self { formatted }
    }

    pub fn propfind_body(&self, properties: &[XmlProperty]) -> Result<String, XmlError> {
        self.render_document_with_namespaces(
            XmlElement::children(
                clark(DAV_NS, "propfind"),
                vec![XmlElement::children(
                    clark(DAV_NS, "prop"),
                    property_elements(properties, false),
                )],
            ),
            &[(CARDDAV_NS, "CARD")],
        )
    }

    pub fn mkcalendar_body(&self, properties: &[XmlProperty]) -> Result<String, XmlError> {
        let children = if properties.is_empty() {
            Vec::new()
        } else {
            vec![XmlElement::children(
                clark(DAV_NS, "set"),
                vec![XmlElement::children(
                    clark(DAV_NS, "prop"),
                    property_elements(properties, true),
                )],
            )]
        };

        self.render_document_with_namespaces(
            XmlElement::children(clark(CALDAV_NS, "mkcalendar"), children),
            &[(CARDDAV_NS, "CARD")],
        )
    }

    pub fn mkaddressbook_body(&self, properties: &[XmlProperty]) -> Result<String, XmlError> {
        let mut prop_children = vec![XmlElement::children(
            clark(DAV_NS, "resourcetype"),
            vec![
                XmlElement::empty(clark(DAV_NS, "collection")),
                XmlElement::empty(clark(CARDDAV_NS, "addressbook")),
            ],
        )];
        prop_children.extend(property_elements(properties, true));

        self.render_document(XmlElement::children(
            clark(DAV_NS, "mkcol"),
            vec![XmlElement::children(
                clark(DAV_NS, "set"),
                vec![XmlElement::children(clark(DAV_NS, "prop"), prop_children)],
            )],
        ))
    }

    pub fn proppatch_body(&self, properties: &[XmlProperty]) -> Result<String, XmlError> {
        self.render_document(XmlElement::children(
            clark(DAV_NS, "propertyupdate"),
            vec![XmlElement::children(
                clark(DAV_NS, "set"),
                vec![XmlElement::children(
                    clark(DAV_NS, "prop"),
                    property_elements(properties, true),
                )],
            )],
        ))
    }

    pub fn calendar_query_body(
        &self,
        component_filter: &impl ComponentFilter,
    ) -> Result<String, XmlError> {
        self.render_document(XmlElement::children(
            clark(CALDAV_NS, "calendar-query"),
            vec![
                XmlElement::children(
                    clark(DAV_NS, "prop"),
                    vec![
                        XmlElement::empty(clark(DAV_NS, "getetag")),
                        XmlElement::empty(clark(CALDAV_NS, "calendar-data")),
                    ],
                ),
                XmlElement::children(
                    clark(CALDAV_NS, "filter"),
                    vec![XmlElement::children(
                        clark(CALDAV_NS, "comp-filter"),
                        vec![XmlElement::children(
                            clark(CALDAV_NS, "comp-filter"),
                            vec![component_filter.to_xml_element()],
                        )
                        .with_attribute("name", "VEVENT")],
                    )
                    .with_attribute("name", "VCALENDAR")],
                ),
            ],
        ))
    }

    pub fn addressbook_query_body(&self) -> Result<String, XmlError> {
        self.render_document(XmlElement::children(
            clark(CARDDAV_NS, "addressbook-query"),
            vec![XmlElement::children(
                clark(DAV_NS, "prop"),
                vec![
                    XmlElement::empty(clark(DAV_NS, "getetag")),
                    XmlElement::empty(clark(CARDDAV_NS, "address-data")),
                ],
            )],
        ))
    }

    pub fn acl_body(&self, acl: &Acl) -> Result<String, XmlError> {
        let mut children = vec![
            ace_element("owner", acl.owner_privileges()?, None),
            ace_element("default", acl.default_privileges()?, None),
        ];

        for (principal, privileges) in acl.grants_privileges()? {
            children.push(ace_element("grant", &privileges, Some(&principal)));
        }

        self.render_document(XmlElement::children(clark(DAV_NS, "acl"), children))
    }

    pub fn principal_property_search_body(
        &self,
        filter: &PrincipalPropertySearch,
    ) -> Result<String, XmlError> {
        self.render_document(filter.to_xml_element())
    }

    pub fn render_document(&self, root: XmlElement) -> Result<String, XmlError> {
        self.render_document_with_namespaces(root, &[])
    }

    fn render_document_with_namespaces(
        &self,
        root: XmlElement,
        extra_namespaces: &[(&str, &str)],
    ) -> Result<String, XmlError> {
        let registry = NamespaceRegistry::for_document(&root, extra_namespaces)?;
        let mut output = String::from(r#"<?xml version="1.0" encoding="UTF-8"?>"#);
        if self.formatted {
            output.push('\n');
        }
        render_element(&root, &registry, self.formatted, 0, &mut output)?;
        Ok(output)
    }
}

fn ace_element(kind: &str, privileges: &[String], principal: Option<&str>) -> XmlElement {
    XmlElement::children(
        clark(DAV_NS, "ace"),
        vec![
            principal_element(kind, principal),
            XmlElement::children(
                clark(DAV_NS, "grant"),
                privileges
                    .iter()
                    .map(|privilege| {
                        XmlElement::children(
                            clark(DAV_NS, "privilege"),
                            vec![XmlElement::empty(privilege.clone())],
                        )
                    })
                    .collect(),
            ),
        ],
    )
}

fn principal_element(kind: &str, principal: Option<&str>) -> XmlElement {
    let child = match kind {
        "owner" => XmlElement::children(
            clark(DAV_NS, "property"),
            vec![XmlElement::empty(clark(DAV_NS, "owner"))],
        ),
        "default" => XmlElement::empty(clark(DAV_NS, "authenticated")),
        "grant" => XmlElement::text(clark(DAV_NS, "href"), principal.unwrap_or_default()),
        _ => XmlElement::empty(kind),
    };

    XmlElement::children(clark(DAV_NS, "principal"), vec![child])
}

#[derive(Debug)]
struct NamespaceRegistry {
    prefixes: HashMap<String, String>,
    ordered: Vec<(String, String)>,
}

impl NamespaceRegistry {
    fn for_document(
        root: &XmlElement,
        extra_namespaces: &[(&str, &str)],
    ) -> Result<Self, XmlError> {
        let mut registry = Self {
            prefixes: HashMap::new(),
            ordered: Vec::new(),
        };

        for (namespace, prefix) in [(DAV_NS, "d"), (CALDAV_NS, "C"), (APPLE_ICAL_NS, "A")] {
            registry.insert(namespace, prefix);
        }

        for (namespace, prefix) in extra_namespaces {
            registry.insert(namespace, prefix);
        }

        let mut namespaces = BTreeSet::new();
        collect_namespaces(root, &mut namespaces)?;
        let mut generated_prefix = 1;
        for namespace in namespaces {
            if namespace.is_empty() || registry.prefixes.contains_key(&namespace) {
                continue;
            }

            let prefix = format!("x{generated_prefix}");
            generated_prefix += 1;
            registry.insert(&namespace, &prefix);
        }

        Ok(registry)
    }

    fn insert(&mut self, namespace: &str, prefix: &str) {
        if self.prefixes.contains_key(namespace) {
            return;
        }

        self.prefixes
            .insert(namespace.to_string(), prefix.to_string());
        self.ordered
            .push((namespace.to_string(), prefix.to_string()));
    }

    fn qname(&self, name: &str) -> Result<String, XmlError> {
        let Some((namespace, local)) = parse_clark(name) else {
            return Ok(name.to_string());
        };

        let Some(prefix) = self.prefixes.get(namespace) else {
            return Err(XmlError::InvalidClarkName(name.to_string()));
        };

        Ok(format!("{prefix}:{local}"))
    }
}

fn collect_namespaces(element: &XmlElement, namespaces: &mut BTreeSet<String>) -> Result<(), XmlError> {
    if let Some((namespace, _)) = parse_clark(&element.name) {
        namespaces.insert(namespace.to_string());
    }

    if let XmlValue::Elements(children) = &element.value {
        for child in children {
            collect_namespaces(child, namespaces)?;
        }
    }

    Ok(())
}

fn render_element(
    element: &XmlElement,
    registry: &NamespaceRegistry,
    formatted: bool,
    depth: usize,
    output: &mut String,
) -> Result<(), XmlError> {
    if formatted {
        output.push_str(&"  ".repeat(depth));
    }

    output.push('<');
    output.push_str(&registry.qname(&element.name)?);

    if depth == 0 {
        for (namespace, prefix) in &registry.ordered {
            output.push(' ');
            output.push_str("xmlns:");
            output.push_str(prefix);
            output.push_str("=\"");
            output.push_str(&escape_attr(namespace));
            output.push('"');
        }
    }

    for (name, value) in &element.attributes {
        output.push(' ');
        output.push_str(name);
        output.push_str("=\"");
        output.push_str(&escape_attr(value));
        output.push('"');
    }

    match &element.value {
        XmlValue::Empty => output.push_str("/>"),
        XmlValue::Text(value) | XmlValue::Href(value) => {
            output.push('>');
            output.push_str(&escape_text(value));
            output.push_str("</");
            output.push_str(&registry.qname(&element.name)?);
            output.push('>');
        }
        XmlValue::ResourceType(types) => {
            output.push('>');
            if formatted {
                output.push('\n');
            }
            for name in types {
                render_element(
                    &XmlElement::empty(name.clone()),
                    registry,
                    formatted,
                    depth + 1,
                    output,
                )?;
                if formatted {
                    output.push('\n');
                }
            }
            if formatted {
                output.push_str(&"  ".repeat(depth));
            }
            output.push_str("</");
            output.push_str(&registry.qname(&element.name)?);
            output.push('>');
        }
        XmlValue::Elements(children) if children.is_empty() => output.push_str("/>"),
        XmlValue::Elements(children) => {
            output.push('>');
            if formatted {
                output.push('\n');
            }
            for child in children {
                render_element(child, registry, formatted, depth + 1, output)?;
                if formatted {
                    output.push('\n');
                }
            }
            if formatted {
                output.push_str(&"  ".repeat(depth));
            }
            output.push_str("</");
            output.push_str(&registry.qname(&element.name)?);
            output.push('>');
        }
    }

    Ok(())
}

fn escape_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn escape_attr(value: &str) -> String {
    escape_text(value).replace('"', "&quot;")
}

pub fn properties_from_text<'a>(
    properties: impl IntoIterator<Item = (&'a str, &'a str)>,
) -> Vec<XmlProperty> {
    properties
        .into_iter()
        .map(|(name, value)| XmlProperty::text(name, value))
        .collect()
}

pub fn empty_properties<'a>(properties: impl IntoIterator<Item = &'a str>) -> Vec<XmlProperty> {
    properties.into_iter().map(XmlProperty::empty).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::caldav::filter::{PrincipalPropertySearch, TestFilter};
    use crate::caldav::share::{Acl, Permissions};

    fn parse(body: &str) -> roxmltree::Document<'_> {
        roxmltree::Document::parse(body).unwrap()
    }

    #[test]
    fn propfind_body_emits_empty_requested_properties_in_order() {
        let body = Generator::new(false)
            .propfind_body(&empty_properties([
                "{DAV:}resourcetype",
                "{urn:ietf:params:xml:ns:caldav}calendar-home-set",
                "{http://apple.com/ns/ical/}calendar-color",
            ]))
            .unwrap();
        let document = parse(&body);
        let root = document.root_element();

        assert_eq!(root.tag_name().namespace(), Some(DAV_NS));
        assert_eq!(root.tag_name().name(), "propfind");
        let prop = root.children().find(|node| node.is_element()).unwrap();
        let names: Vec<_> = prop
            .children()
            .filter(|node| node.is_element())
            .map(|node| node.tag_name().name())
            .collect();
        assert_eq!(names, ["resourcetype", "calendar-home-set", "calendar-color"]);
    }

    #[test]
    fn mkcalendar_omits_set_group_when_no_properties_are_given() {
        let body = Generator::new(false).mkcalendar_body(&[]).unwrap();
        let document = parse(&body);

        assert_eq!(document.root_element().tag_name().name(), "mkcalendar");
        assert_eq!(
            document
                .root_element()
                .children()
                .filter(|node| node.is_element())
                .count(),
            0
        );
    }

    #[test]
    fn calendar_query_wraps_component_filter_under_vcalendar_vevent() {
        let body = Generator::new(true)
            .calendar_query_body(&TestFilter::new("{http://fake.com/}test"))
            .unwrap();
        let document = parse(&body);

        assert_eq!(document.root_element().tag_name().name(), "calendar-query");
        assert!(document.descendants().any(|node| {
            node.is_element()
                && node.tag_name().namespace() == Some("http://fake.com/")
                && node.tag_name().name() == "test"
        }));
        assert!(body.contains("name=\"VCALENDAR\""));
        assert!(body.contains("name=\"VEVENT\""));
    }

    #[test]
    fn acl_body_generates_owner_default_and_grant_aces() {
        let permissions = Permissions::new([
            (
                "owner".to_string(),
                vec!["{DAV:}all".to_string(), "{urn:he:man}master-of-universe".to_string()],
            ),
            (
                "default".to_string(),
                vec!["{urn:ietf:params:xml:ns:caldav}read-free-busy".to_string()],
            ),
            ("read-write".to_string(), vec!["{DAV:}write".to_string()]),
            ("read-only".to_string(), vec!["{DAV:}read".to_string()]),
        ]);
        let mut acl = Acl::new(permissions);
        acl.add_grant("/jorge", "read-write").unwrap();
        acl.add_grant("/rigodon", "read-only").unwrap();

        let body = Generator::new(true).acl_body(&acl).unwrap();
        let document = parse(&body);
        let ace_count = document
            .descendants()
            .filter(|node| node.is_element() && node.tag_name().name() == "ace")
            .count();

        assert_eq!(ace_count, 4);
        assert!(body.contains("/jorge"));
        assert!(body.contains("master-of-universe"));
    }

    #[test]
    fn principal_property_search_body_matches_requested_properties() {
        let body = Generator::new(true)
            .principal_property_search_body(&PrincipalPropertySearch::new("example"))
            .unwrap();
        let document = parse(&body);

        assert_eq!(
            document.root_element().tag_name().name(),
            "principal-property-search"
        );
        assert_eq!(document.root_element().attribute("test"), Some("anyof"));
        assert!(body.contains("calendar-user-address-set"));
        assert!(body.contains("<d:email/>"));
    }
}
