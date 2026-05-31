use crate::caldav::filter::{ComponentFilter, PrincipalPropertySearch};
use crate::caldav::share::Acl;
use crate::xml::generator::Generator;
use crate::xml::parser::Parser;
use crate::xml::{MultistatusProperties, Properties, XmlError, XmlProperty};

#[derive(Debug, Clone)]
pub struct Toolkit {
    parser: Parser,
    generator: Generator,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParsedMultistatus {
    All(MultistatusProperties),
    First(Properties),
}

#[derive(Debug, Clone)]
pub enum RequestBody<'a, F: ComponentFilter> {
    MkCalendar(&'a [XmlProperty]),
    MkAddressBook(&'a [XmlProperty]),
    Propfind(&'a [XmlProperty]),
    Proppatch(&'a [XmlProperty]),
    ReportCalendar(&'a F),
    ReportAddressBook,
    ReportPrincipalSearch(&'a PrincipalPropertySearch),
    Acl(&'a Acl),
}

impl Default for Toolkit {
    fn default() -> Self {
        Self::new(Parser::new(), Generator::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::caldav::filter::TestFilter;
    use crate::xml::generator::empty_properties;

    #[test]
    fn toolkit_dispatches_generation_requests() {
        let toolkit = Toolkit::default();
        let properties = empty_properties(["{DAV:}displayname"]);

        let body = toolkit
            .generate_request_body::<TestFilter>(RequestBody::Propfind(&properties))
            .unwrap();

        assert!(body.contains("propfind"));
        assert!(body.contains("displayname"));
    }

    #[test]
    fn toolkit_returns_single_or_all_multistatus_properties() {
        let body = r#"<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/one</d:href>
    <d:propstat>
      <d:prop><d:displayname>One</d:displayname></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>"#;
        let toolkit = Toolkit::default();

        match toolkit.parse_multistatus(body, false).unwrap() {
            ParsedMultistatus::All(values) => assert!(values.contains_key("/one")),
            ParsedMultistatus::First(_) => panic!("expected all values"),
        }

        match toolkit.parse_multistatus(body, true).unwrap() {
            ParsedMultistatus::First(values) => assert!(values.contains_key("{DAV:}displayname")),
            ParsedMultistatus::All(_) => panic!("expected first values"),
        }
    }
}

impl Toolkit {
    pub fn new(parser: Parser, generator: Generator) -> Self {
        Self { parser, generator }
    }

    pub fn parse_multistatus(
        &self,
        body: &str,
        first_element: bool,
    ) -> Result<ParsedMultistatus, XmlError> {
        if first_element {
            return self
                .parser
                .extract_first_properties_from_multistatus(body)
                .map(ParsedMultistatus::First);
        }

        self.parser
            .extract_properties_from_multistatus(body)
            .map(ParsedMultistatus::All)
    }

    pub fn generate_request_body<F: ComponentFilter>(
        &self,
        request: RequestBody<'_, F>,
    ) -> Result<String, XmlError> {
        match request {
            RequestBody::MkCalendar(properties) => self.generator.mkcalendar_body(properties),
            RequestBody::MkAddressBook(properties) => self.generator.mkaddressbook_body(properties),
            RequestBody::Propfind(properties) => self.generator.propfind_body(properties),
            RequestBody::Proppatch(properties) => self.generator.proppatch_body(properties),
            RequestBody::ReportCalendar(filter) => self.generator.calendar_query_body(filter),
            RequestBody::ReportAddressBook => self.generator.addressbook_query_body(),
            RequestBody::ReportPrincipalSearch(filter) => {
                self.generator.principal_property_search_body(filter)
            }
            RequestBody::Acl(acl) => self.generator.acl_body(acl),
        }
    }
}
