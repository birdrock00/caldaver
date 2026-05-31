use indexmap::IndexMap;

use crate::xml::{
    DAV_NS, MultistatusProperties, Properties, XmlElement, XmlError, XmlValue, clark,
    clark_from_node, status_code,
};

#[derive(Debug, Default, Clone)]
pub struct Parser;

impl Parser {
    pub fn new() -> Self {
        Self
    }

    pub fn extract_properties_from_multistatus(
        &self,
        body: &str,
    ) -> Result<MultistatusProperties, XmlError> {
        let parsed = self.parse_multistatus(body)?;

        Ok(parsed
            .into_iter()
            .map(|(href, status_list)| {
                let properties = status_list.get(&200).cloned().unwrap_or_default();
                (href, properties)
            })
            .collect())
    }

    pub fn extract_first_properties_from_multistatus(
        &self,
        body: &str,
    ) -> Result<Properties, XmlError> {
        let parsed = self.parse_multistatus(body)?;
        Ok(parsed
            .into_iter()
            .next()
            .and_then(|(_, status_list)| status_list.get(&200).cloned())
            .unwrap_or_default())
    }

    pub fn parse_multistatus(
        &self,
        body: &str,
    ) -> Result<IndexMap<String, IndexMap<u16, Properties>>, XmlError> {
        let document = roxmltree::Document::parse(body)
            .map_err(|error| XmlError::Parse(error.to_string()))?;
        let root = document.root_element();
        if clark_from_node(root) != clark(DAV_NS, "multistatus") {
            return Err(XmlError::MissingMultistatusRoot);
        }

        let mut result = IndexMap::new();
        for response in element_children(root).filter(|node| clark_from_node(*node) == clark(DAV_NS, "response")) {
            let href = child_text(response, &clark(DAV_NS, "href")).unwrap_or_default();
            let mut statuses = IndexMap::new();

            for propstat in element_children(response)
                .filter(|node| clark_from_node(*node) == clark(DAV_NS, "propstat"))
            {
                let Some(status) = child_text(propstat, &clark(DAV_NS, "status")) else {
                    continue;
                };
                let Some(code) = status_code(&status) else {
                    continue;
                };
                let Some(prop) = element_children(propstat)
                    .find(|node| clark_from_node(*node) == clark(DAV_NS, "prop"))
                else {
                    continue;
                };

                let mut properties = IndexMap::new();
                for property in element_children(prop) {
                    properties.insert(clark_from_node(property), parse_property_value(property));
                }
                statuses.insert(code, properties);
            }

            result.insert(href, statuses);
        }

        Ok(result)
    }
}

fn parse_property_value(node: roxmltree::Node<'_, '_>) -> XmlValue {
    let name = clark_from_node(node);
    if matches!(
        name.as_str(),
        "{DAV:}current-user-principal"
            | "{urn:ietf:params:xml:ns:caldav}calendar-home-set"
            | "{urn:ietf:params:xml:ns:carddav}addressbook-home-set"
    ) {
        return XmlValue::Href(child_text(node, &clark(DAV_NS, "href")).unwrap_or_default());
    }

    if name == clark(DAV_NS, "resourcetype") {
        return XmlValue::ResourceType(element_children(node).map(clark_from_node).collect());
    }

    let children: Vec<_> = element_children(node).collect();
    if !children.is_empty() {
        return XmlValue::Elements(children.into_iter().map(parse_element).collect());
    }

    match node.text().map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => XmlValue::Text(value.to_string()),
        None => XmlValue::Empty,
    }
}

fn parse_element(node: roxmltree::Node<'_, '_>) -> XmlElement {
    let attributes = node
        .attributes()
        .map(|attribute| (attribute.name().to_string(), attribute.value().to_string()))
        .collect();

    XmlElement {
        name: clark_from_node(node),
        attributes,
        value: parse_property_value(node),
    }
}

fn child_text(node: roxmltree::Node<'_, '_>, name: &str) -> Option<String> {
    element_children(node)
        .find(|child| clark_from_node(*child) == name)
        .and_then(|child| child.text())
        .map(str::trim)
        .map(str::to_string)
}

fn element_children<'a, 'input>(
    node: roxmltree::Node<'a, 'input>,
) -> impl Iterator<Item = roxmltree::Node<'a, 'input>> {
    node.children().filter(|child| child.is_element())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_only_ok_properties_from_multistatus() {
        let body = r#"<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/dav/</d:href>
    <d:propstat>
      <d:prop>
        <d:current-user-principal>
          <d:href>/dav/principals/demo/</d:href>
        </d:current-user-principal>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
    <d:propstat>
      <d:prop>
        <d:notfound/>
      </d:prop>
      <d:status>HTTP/1.1 404 Not Found</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>"#;

        let parser = Parser::new();
        let result = parser.extract_properties_from_multistatus(body).unwrap();

        assert_eq!(
            result["/dav/"]["{DAV:}current-user-principal"],
            XmlValue::Href("/dav/principals/demo/".to_string())
        );
        assert!(!result["/dav/"].contains_key("{DAV:}notfound"));

        let first = parser.extract_first_properties_from_multistatus(body).unwrap();
        assert_eq!(
            first["{DAV:}current-user-principal"],
            XmlValue::Href("/dav/principals/demo/".to_string())
        );
    }

    #[test]
    fn parses_resource_type_as_named_children() {
        let body = r#"<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/dav/calendars/demo/default/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype>
          <d:collection/>
          <cal:calendar/>
        </d:resourcetype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>"#;

        let result = Parser::new()
            .extract_properties_from_multistatus(body)
            .unwrap();

        assert_eq!(
            result["/dav/calendars/demo/default/"]["{DAV:}resourcetype"],
            XmlValue::ResourceType(vec![
                "{DAV:}collection".to_string(),
                "{urn:ietf:params:xml:ns:caldav}calendar".to_string(),
            ])
        );
    }
}
