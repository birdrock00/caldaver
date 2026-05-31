use std::time::Duration;

use crate::caldav_backend::CalDavAuth;
use caldaver_core::caldav::filter::TestFilter;
use caldaver_core::carddav::{self, AddressBook, Contact, ContactInput};
use caldaver_core::xml::generator::{empty_properties, properties_from_text};
use caldaver_core::xml::toolkit::{ParsedMultistatus, RequestBody, Toolkit};
use caldaver_core::xml::{XmlError, XmlValue};
use reqwest::header::{
    ACCEPT, AUTHORIZATION, CONTENT_TYPE, ETAG, HeaderMap, HeaderName, HeaderValue, IF_MATCH, IF_NONE_MATCH,
};
use reqwest::{Method, StatusCode, Url};
use uuid::Uuid;

const CURRENT_USER_PRINCIPAL: &str = "{DAV:}current-user-principal";
const ADDRESSBOOK_HOME_SET: &str = "{urn:ietf:params:xml:ns:carddav}addressbook-home-set";
const ADDRESSBOOK_RESOURCE: &str = "{urn:ietf:params:xml:ns:carddav}addressbook";
const DEPTH: HeaderName = HeaderName::from_static("depth");

#[derive(Debug, Clone)]
pub struct CardDavConfig {
    pub base_url: String,
    pub auth: CalDavAuth,
}

#[derive(Debug, Clone)]
pub struct CardDavClient {
    http: reqwest::Client,
    toolkit: Toolkit,
    base_url: Url,
    auth: CalDavAuth,
}

#[derive(Debug)]
pub enum CardDavError {
    InvalidBaseUrl(String),
    InvalidDavHref(String),
    MissingHomeSet,
    Http(reqwest::Error),
    Xml(XmlError),
    UnexpectedStatus {
        method: &'static str,
        url: String,
        status: StatusCode,
    },
}

impl CardDavClient {
    pub fn new(config: CardDavConfig) -> Result<Self, CardDavError> {
        let mut base_url = Url::parse(&config.base_url)
            .map_err(|error| CardDavError::InvalidBaseUrl(error.to_string()))?;
        if !base_url.path().ends_with('/') {
            let path = format!("{}/", base_url.path());
            base_url.set_path(&path);
        }

        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .map_err(CardDavError::Http)?;

        Ok(Self {
            http,
            toolkit: Toolkit::default(),
            base_url,
            auth: config.auth,
        })
    }

    pub async fn discover_addressbook_home_set(&self) -> Result<String, CardDavError> {
        self.discover_addressbook_home_set_from_base().await
    }

    pub async fn ensure_addressbooks(
        &self,
        home_set: Option<&str>,
        displayname: &str,
    ) -> Result<Vec<AddressBook>, CardDavError> {
        let home_set = match home_set.filter(|value| !value.is_empty()) {
            Some(home_set) => home_set.to_string(),
            None => self.discover_addressbook_home_set_from_base().await?,
        };
        let mut addressbooks = self.list_addressbooks_at(&home_set).await?;
        if !addressbooks.is_empty() {
            return Ok(addressbooks);
        }

        let default_href = join_href(&home_set, &format!("{}/", Uuid::new_v4()));
        self.create_default_addressbook(&default_href, displayname).await?;
        addressbooks = self.list_addressbooks_at(&home_set).await?;

        if addressbooks.is_empty() {
            addressbooks.push(AddressBook::with_properties(
                default_href,
                [(AddressBook::DISPLAYNAME, format!("{displayname} addressbook"))],
            ));
        }
        Ok(addressbooks)
    }

    pub async fn list_contacts(
        &self,
        addressbooks: &[AddressBook],
    ) -> Result<Vec<Contact>, CardDavError> {
        let mut contacts = Vec::new();
        for addressbook in addressbooks {
            contacts.extend(self.report_addressbook(addressbook).await?);
        }
        carddav::sort_contacts_by_full_name(&mut contacts);
        Ok(contacts)
    }

    pub async fn create_contact(
        &self,
        input: &ContactInput,
    ) -> Result<Contact, CardDavError> {
        let addressbook = self
            .ensure_addressbooks(None, "Default")
            .await?
            .into_iter()
            .next()
            .ok_or(CardDavError::MissingHomeSet)?;
        let (uid, vcard) = carddav::build_vcard(input);
        let href = carddav::contact_url(&addressbook, &uid);
        let url = self.href_to_url(&href)?;
        let response = self
            .request(method("PUT"), url.clone())
            .header(CONTENT_TYPE, "text/vcard; charset=utf-8")
            .header(IF_NONE_MATCH, "*")
            .body(vcard.clone())
            .send()
            .await
            .map_err(CardDavError::Http)?;
        let status = response.status();
        let etag = response
            .headers()
            .get(ETAG)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);

        if !matches!(
            status,
            StatusCode::CREATED | StatusCode::NO_CONTENT | StatusCode::OK
        ) {
            return Err(CardDavError::UnexpectedStatus {
                method: "PUT",
                url: url.to_string(),
                status,
            });
        }

        Ok(Contact::from_vcard(href, etag, &vcard))
    }

    pub async fn delete_contact(
        &self,
        href: &str,
        etag: Option<&str>,
    ) -> Result<(), CardDavError> {
        let url = self.href_to_url(href)?;
        let mut request = self.request(method("DELETE"), url.clone());
        if let Some(etag) = etag.filter(|value| !value.is_empty()) {
            request = request.header(IF_MATCH, etag);
        }
        let response = request
            .send()
            .await
            .map_err(CardDavError::Http)?;
        let status = response.status();

        if !matches!(
            status,
            StatusCode::NO_CONTENT | StatusCode::OK | StatusCode::ACCEPTED | StatusCode::NOT_FOUND
        ) {
            return Err(CardDavError::UnexpectedStatus {
                method: "DELETE",
                url: url.to_string(),
                status,
            });
        }

        Ok(())
    }

    pub async fn update_contact(
        &self,
        href: &str,
        etag: Option<&str>,
        input: &ContactInput,
    ) -> Result<Contact, CardDavError> {
        let url = self.href_to_url(href)?;
        let (_, vcard) = carddav::build_vcard(input);
        let mut request = self
            .request(method("PUT"), url.clone())
            .header(CONTENT_TYPE, "text/vcard; charset=utf-8");
        if let Some(etag) = etag.filter(|value| !value.is_empty()) {
            request = request.header(IF_MATCH, etag);
        }
        let response = request
            .body(vcard.clone())
            .send()
            .await
            .map_err(CardDavError::Http)?;
        let status = response.status();
        let etag = response
            .headers()
            .get(ETAG)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);

        if !matches!(
            status,
            StatusCode::CREATED | StatusCode::NO_CONTENT | StatusCode::OK
        ) {
            return Err(CardDavError::UnexpectedStatus {
                method: "PUT",
                url: url.to_string(),
                status,
            });
        }

        Ok(Contact::from_vcard(href, etag, &vcard))
    }

    async fn discover_addressbook_home_set_from_base(&self) -> Result<String, CardDavError> {
        let properties = empty_properties([CURRENT_USER_PRINCIPAL, ADDRESSBOOK_HOME_SET]);
        let body = self
            .toolkit
            .generate_request_body::<TestFilter>(RequestBody::Propfind(&properties))
            .map_err(CardDavError::Xml)?;
        let values = self
            .propfind(self.base_url.clone(), "0", body, true)
            .await?;

        if let Some(home_set) = href_property(&values, ADDRESSBOOK_HOME_SET) {
            return Ok(home_set);
        }

        let principal = href_property(&values, CURRENT_USER_PRINCIPAL)
            .ok_or(CardDavError::MissingHomeSet)?;
        let principal_url = self.href_to_url(&principal)?;
        let body = self
            .toolkit
            .generate_request_body::<TestFilter>(RequestBody::Propfind(&empty_properties([
                ADDRESSBOOK_HOME_SET,
            ])))
            .map_err(CardDavError::Xml)?;
        let values = self.propfind(principal_url, "0", body, true).await?;

        Ok(href_property(&values, ADDRESSBOOK_HOME_SET).unwrap_or(principal))
    }

    async fn list_addressbooks_at(
        &self,
        home_set: &str,
    ) -> Result<Vec<AddressBook>, CardDavError> {
        let url = self.href_to_url(home_set)?;
        let properties = empty_properties([
            "{DAV:}resourcetype",
            AddressBook::DISPLAYNAME,
            AddressBook::DESCRIPTION,
            AddressBook::CTAG,
        ]);
        let body = self
            .toolkit
            .generate_request_body::<TestFilter>(RequestBody::Propfind(&properties))
            .map_err(CardDavError::Xml)?;
        let response = self.propfind(url, "1", body, false).await?;

        Ok(response
            .into_iter()
            .filter_map(|(href, properties)| {
                let resource_type = match properties.get("{DAV:}resourcetype") {
                    Some(XmlValue::ResourceType(values)) => values,
                    _ => return None,
                };
                if !resource_type.iter().any(|value| value == ADDRESSBOOK_RESOURCE) {
                    return None;
                }

                let mut addressbook = AddressBook::new(ensure_trailing_slash(href));
                for property in [
                    AddressBook::DISPLAYNAME,
                    AddressBook::DESCRIPTION,
                    AddressBook::CTAG,
                ] {
                    if let Some(value) = text_property(&properties, property) {
                        addressbook
                            .properties
                            .insert(property.to_string(), value);
                    }
                }
                Some(addressbook)
            })
            .collect())
    }

    async fn create_default_addressbook(&self, href: &str, displayname: &str) -> Result<(), CardDavError> {
        let url = self.href_to_url(href)?;
        let name = format!("{displayname} addressbook");
        let properties = properties_from_text([
            (AddressBook::DISPLAYNAME, name.as_str()),
            (AddressBook::DESCRIPTION, name.as_str()),
        ]);
        let body = self
            .toolkit
            .generate_request_body::<TestFilter>(RequestBody::MkAddressBook(&properties))
            .map_err(CardDavError::Xml)?;
        let response = self
            .request(method("MKCOL"), url.clone())
            .header(CONTENT_TYPE, "application/xml; charset=utf-8")
            .body(body)
            .send()
            .await
            .map_err(CardDavError::Http)?;
        let status = response.status();

        if !matches!(
            status,
            StatusCode::CREATED | StatusCode::OK | StatusCode::NO_CONTENT | StatusCode::METHOD_NOT_ALLOWED
        ) {
            return Err(CardDavError::UnexpectedStatus {
                method: "MKCOL",
                url: url.to_string(),
                status,
            });
        }

        Ok(())
    }

    async fn report_addressbook(
        &self,
        addressbook: &AddressBook,
    ) -> Result<Vec<Contact>, CardDavError> {
        let url = self.href_to_url(&addressbook.url)?;
        let body = self
            .toolkit
            .generate_request_body::<TestFilter>(RequestBody::ReportAddressBook)
            .map_err(CardDavError::Xml)?;
        let response = self
            .request(method("REPORT"), url.clone())
            .header(DEPTH, "1")
            .header(CONTENT_TYPE, "application/xml; charset=utf-8")
            .body(body)
            .send()
            .await
            .map_err(CardDavError::Http)?;
        let status = response.status();
        if status != StatusCode::MULTI_STATUS {
            return Err(CardDavError::UnexpectedStatus {
                method: "REPORT",
                url: url.to_string(),
                status,
            });
        }

        let body = response.text().await.map_err(CardDavError::Http)?;
        let ParsedMultistatus::All(values) = self
            .toolkit
            .parse_multistatus(&body, false)
            .map_err(CardDavError::Xml)?
        else {
            unreachable!("parse_multistatus(false) returns All");
        };

        Ok(values
            .into_iter()
            .filter_map(|(href, properties)| {
                let vcard = text_property(&properties, Contact::DATA)?;
                let etag = text_property(&properties, Contact::ETAG);
                Some(Contact::from_vcard(href, etag, &vcard))
            })
            .collect())
    }

    async fn propfind(
        &self,
        url: Url,
        depth: &'static str,
        body: String,
        first_element: bool,
    ) -> Result<caldaver_core::xml::MultistatusProperties, CardDavError> {
        let response = self
            .request(method("PROPFIND"), url.clone())
            .header(DEPTH, depth)
            .header(CONTENT_TYPE, "application/xml; charset=utf-8")
            .body(body)
            .send()
            .await
            .map_err(CardDavError::Http)?;
        let status = response.status();
        if status != StatusCode::MULTI_STATUS {
            return Err(CardDavError::UnexpectedStatus {
                method: "PROPFIND",
                url: url.to_string(),
                status,
            });
        }

        let body = response.text().await.map_err(CardDavError::Http)?;
        match self
            .toolkit
            .parse_multistatus(&body, first_element)
            .map_err(CardDavError::Xml)?
        {
            ParsedMultistatus::All(values) => Ok(values),
            ParsedMultistatus::First(values) => Ok([(String::new(), values)].into_iter().collect()),
        }
    }

    fn request(&self, method: Method, url: Url) -> reqwest::RequestBuilder {
        let mut headers = HeaderMap::new();
        headers.insert(ACCEPT, HeaderValue::from_static("application/xml,text/xml,*/*"));

        let request = self.http.request(method, url).headers(headers);
        match &self.auth {
            CalDavAuth::None => request,
            CalDavAuth::Basic { username, password } if username.is_empty() => request,
            CalDavAuth::Basic { username, password } => request.basic_auth(username, Some(password)),
            CalDavAuth::Bearer(token) => request.header(AUTHORIZATION, format!("Bearer {token}")),
        }
    }

    fn href_to_url(&self, href: &str) -> Result<Url, CardDavError> {
        let url = self
            .base_url
            .join(href)
            .map_err(|error| CardDavError::InvalidDavHref(error.to_string()))?;
        if !same_origin(&self.base_url, &url) {
            return Err(CardDavError::InvalidDavHref(
                "DAV href resolves outside the configured CardDAV origin".to_string(),
            ));
        }
        Ok(url)
    }
}

impl std::fmt::Display for CardDavError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidBaseUrl(message) => write!(f, "invalid CardDAV base URL: {message}"),
            Self::InvalidDavHref(message) => write!(f, "invalid CardDAV href: {message}"),
            Self::MissingHomeSet => write!(f, "CardDAV addressbook-home-set was not found"),
            Self::Http(error) => write!(f, "CardDAV HTTP error: {error}"),
            Self::Xml(error) => write!(f, "CardDAV XML error: {error}"),
            Self::UnexpectedStatus { method, url, status } => {
                write!(f, "CardDAV {method} {url} returned {status}")
            }
        }
    }
}

impl std::error::Error for CardDavError {}

fn method(value: &'static str) -> Method {
    Method::from_bytes(value.as_bytes()).expect("valid DAV method")
}

fn same_origin(left: &Url, right: &Url) -> bool {
    left.scheme() == right.scheme()
        && left.host_str() == right.host_str()
        && left.port_or_known_default() == right.port_or_known_default()
}

fn href_property(
    properties: &caldaver_core::xml::MultistatusProperties,
    property: &str,
) -> Option<String> {
    properties
        .values()
        .find_map(|values| match values.get(property) {
            Some(XmlValue::Href(value) | XmlValue::Text(value)) if !value.is_empty() => {
                Some(value.clone())
            }
            _ => None,
        })
}

fn text_property(
    properties: &caldaver_core::xml::Properties,
    property: &str,
) -> Option<String> {
    match properties.get(property) {
        Some(XmlValue::Text(value) | XmlValue::Href(value)) if !value.is_empty() => {
            Some(value.clone())
        }
        _ => None,
    }
}

fn ensure_trailing_slash(mut href: String) -> String {
    if !href.ends_with('/') {
        href.push('/');
    }
    href
}

fn join_href(base: &str, path: &str) -> String {
    format!("{}{}", ensure_trailing_slash(base.to_string()), path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[derive(Clone, Debug)]
    struct MockResponse {
        status: &'static str,
        headers: Vec<(&'static str, &'static str)>,
        body: String,
    }

    #[derive(Clone, Debug)]
    struct RecordedRequest {
        method: String,
        path: String,
        headers: Vec<(String, String)>,
        body: String,
    }

    #[derive(Debug)]
    struct MockDavServer {
        base_url: String,
        requests: Arc<Mutex<Vec<RecordedRequest>>>,
    }

    impl MockDavServer {
        async fn start(responses: Vec<MockResponse>) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let requests = Arc::new(Mutex::new(Vec::new()));
            let requests_for_task = Arc::clone(&requests);
            let mut responses: VecDeque<_> = responses.into();

            tokio::spawn(async move {
                while let Some(response) = responses.pop_front() {
                    let (mut socket, _) = listener.accept().await.unwrap();
                    let request = read_request(&mut socket).await;
                    requests_for_task.lock().unwrap().push(request);
                    let mut wire = format!(
                        "HTTP/1.1 {}\r\nConnection: close\r\nContent-Length: {}\r\n",
                        response.status,
                        response.body.len()
                    );
                    for (name, value) in response.headers {
                        wire.push_str(name);
                        wire.push_str(": ");
                        wire.push_str(value);
                        wire.push_str("\r\n");
                    }
                    wire.push_str("\r\n");
                    wire.push_str(&response.body);
                    socket.write_all(wire.as_bytes()).await.unwrap();
                }
            });

            Self {
                base_url: format!("http://{addr}/dav/"),
                requests,
            }
        }

        fn requests(&self) -> Vec<RecordedRequest> {
            self.requests.lock().unwrap().clone()
        }
    }

    fn client(server: &MockDavServer) -> CardDavClient {
        CardDavClient::new(CardDavConfig {
            base_url: server.base_url.clone(),
            auth: CalDavAuth::Basic {
                username: "demo".to_string(),
                password: "secret".to_string(),
            },
        })
        .unwrap()
    }

    fn client_with_auth(server: &MockDavServer, auth: CalDavAuth) -> CardDavClient {
        CardDavClient::new(CardDavConfig {
            base_url: server.base_url.clone(),
            auth,
        })
        .unwrap()
    }

    async fn read_request(socket: &mut tokio::net::TcpStream) -> RecordedRequest {
        let mut data = Vec::new();
        let mut buf = [0; 1024];
        let header_end = loop {
            let bytes = socket.read(&mut buf).await.unwrap();
            assert!(bytes > 0);
            data.extend_from_slice(&buf[..bytes]);
            if let Some(position) = find_header_end(&data) {
                break position;
            }
        };

        let headers = String::from_utf8_lossy(&data[..header_end]).to_string();
        let content_length = headers
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().ok())
                    .flatten()
            })
            .unwrap_or(0);
        let total = header_end + 4 + content_length;
        while data.len() < total {
            let bytes = socket.read(&mut buf).await.unwrap();
            assert!(bytes > 0);
            data.extend_from_slice(&buf[..bytes]);
        }

        let mut lines = headers.lines();
        let request_line = lines.next().unwrap();
        let mut parts = request_line.split_whitespace();
        let method = parts.next().unwrap().to_string();
        let path = parts.next().unwrap().to_string();
        let headers = lines
            .filter_map(|line| {
                let (name, value) = line.split_once(':')?;
                Some((name.to_ascii_lowercase(), value.trim().to_string()))
            })
            .collect();
        let body = String::from_utf8_lossy(&data[header_end + 4..total]).to_string();

        RecordedRequest {
            method,
            path,
            headers,
            body,
        }
    }

    fn find_header_end(data: &[u8]) -> Option<usize> {
        data.windows(4).position(|window| window == b"\r\n\r\n")
    }

    fn multistatus(responses: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav" xmlns:cs="http://calendarserver.org/ns/">
{responses}
</d:multistatus>"#
        )
    }

    fn response(body: String) -> MockResponse {
        MockResponse {
            status: "207 Multi-Status",
            headers: vec![("Content-Type", "application/xml; charset=utf-8")],
            body,
        }
    }

    fn header(request: &RecordedRequest, name: &str) -> Option<String> {
        request
            .headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.clone())
    }

    #[tokio::test]
    async fn discovers_lists_and_reports_addressbook_contacts() {
        let server = MockDavServer::start(vec![
            response(multistatus(
                r#"<d:response>
  <d:href>/dav/</d:href>
  <d:propstat><d:prop><card:addressbook-home-set><d:href>/dav/addressbooks/users/demo/</d:href></card:addressbook-home-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
</d:response>"#,
            )),
            response(multistatus(
                r#"<d:response>
  <d:href>/dav/addressbooks/users/demo/contacts/</d:href>
  <d:propstat><d:prop><d:resourcetype><d:collection/><card:addressbook/></d:resourcetype><d:displayname>Contacts</d:displayname></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
</d:response>"#,
            )),
            response(multistatus(
                r#"<d:response>
  <d:href>/dav/addressbooks/users/demo/contacts/ada.vcf</d:href>
  <d:propstat><d:prop><d:getetag>"ada"</d:getetag><card:address-data>BEGIN:VCARD
VERSION:4.0
UID:ada
FN:Ada Lovelace
EMAIL;TYPE=internet:ada@example.test
END:VCARD
</card:address-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
</d:response>"#,
            )),
        ])
        .await;
        let client = client(&server);

        let addressbooks = client.ensure_addressbooks(None, "Demo").await.unwrap();
        let contacts = client.list_contacts(&addressbooks).await.unwrap();

        assert_eq!(addressbooks[0].url, "/dav/addressbooks/users/demo/contacts/");
        assert_eq!(addressbooks[0].property(AddressBook::DISPLAYNAME), Some("Contacts"));
        assert_eq!(contacts.len(), 1);
        assert_eq!(contacts[0].full_name, "Ada Lovelace");
        assert_eq!(contacts[0].email, "ada@example.test");

        let requests = server.requests();
        assert_eq!(requests[0].method, "PROPFIND");
        assert_eq!(requests[0].path, "/dav/");
        assert_eq!(header(&requests[0], "depth").as_deref(), Some("0"));
        assert!(header(&requests[0], "authorization").is_some());
        assert_eq!(requests[1].method, "PROPFIND");
        assert_eq!(requests[1].path, "/dav/addressbooks/users/demo/");
        assert_eq!(header(&requests[1], "depth").as_deref(), Some("1"));
        assert_eq!(requests[2].method, "REPORT");
        assert_eq!(requests[2].path, "/dav/addressbooks/users/demo/contacts/");
        assert!(requests[2].body.contains("addressbook-query"));
    }

    #[tokio::test]
    async fn creates_default_addressbook_when_home_set_has_none() {
        let server = MockDavServer::start(vec![
            response(multistatus(
                r#"<d:response><d:href>/dav/</d:href><d:propstat><d:prop><card:addressbook-home-set><d:href>/dav/addressbooks/users/demo/</d:href></card:addressbook-home-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>"#,
            )),
            response(multistatus(
                r#"<d:response><d:href>/dav/addressbooks/users/demo/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>"#,
            )),
            MockResponse {
                status: "201 Created",
                headers: vec![],
                body: String::new(),
            },
            response(multistatus(
                r#"<d:response><d:href>/dav/addressbooks/users/demo/generated/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><card:addressbook/></d:resourcetype><d:displayname>Demo addressbook</d:displayname></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>"#,
            )),
        ])
        .await;
        let client = client(&server);

        let addressbooks = client.ensure_addressbooks(None, "Demo").await.unwrap();

        assert_eq!(addressbooks.len(), 1);
        assert_eq!(addressbooks[0].url, "/dav/addressbooks/users/demo/generated/");
        let requests = server.requests();
        assert_eq!(requests[2].method, "MKCOL");
        assert!(requests[2].path.starts_with("/dav/addressbooks/users/demo/"));
        assert_ne!(requests[2].path, "/dav/addressbooks/users/demo/default/");
        assert!(requests[2].body.contains("addressbook"));
        assert!(requests[2].body.contains("Demo addressbook"));
    }

    #[tokio::test]
    async fn puts_updates_and_deletes_contacts_with_precondition_headers() {
        let server = MockDavServer::start(vec![
            response(multistatus(
                r#"<d:response><d:href>/dav/</d:href><d:propstat><d:prop><card:addressbook-home-set><d:href>/dav/addressbooks/users/demo/</d:href></card:addressbook-home-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>"#,
            )),
            response(multistatus(
                r#"<d:response><d:href>/dav/addressbooks/users/demo/contacts/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><card:addressbook/></d:resourcetype><d:displayname>Contacts</d:displayname></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>"#,
            )),
            MockResponse {
                status: "201 Created",
                headers: vec![("ETag", r#""new-etag""#)],
                body: String::new(),
            },
            MockResponse {
                status: "200 OK",
                headers: vec![("ETag", r#""updated-etag""#)],
                body: String::new(),
            },
            MockResponse {
                status: "204 No Content",
                headers: vec![],
                body: String::new(),
            },
        ])
        .await;
        let client = client(&server);

        let contact = client
            .create_contact(&ContactInput {
                uid: Some("ada".to_string()),
                full_name: "Ada Lovelace".to_string(),
                email: "ada@example.test".to_string(),
                ..ContactInput::default()
            })
            .await
            .unwrap();
        let contact = client
            .update_contact(
                &contact.url,
                contact.etag.as_deref(),
                &ContactInput {
                    uid: Some("ada".to_string()),
                    full_name: "Ada Byron".to_string(),
                    email: "ada@example.test".to_string(),
                    ..ContactInput::default()
                },
            )
            .await
            .unwrap();
        client
            .delete_contact(&contact.url, contact.etag.as_deref())
            .await
            .unwrap();

        let requests = server.requests();
        assert_eq!(requests[2].method, "PUT");
        assert_eq!(requests[2].path, "/dav/addressbooks/users/demo/contacts/ada.vcf");
        assert_eq!(header(&requests[2], "if-none-match").as_deref(), Some("*"));
        assert!(requests[2].body.contains("BEGIN:VCARD"));
        assert!(requests[2].body.contains("FN:Ada Lovelace"));
        assert_eq!(requests[3].method, "PUT");
        assert_eq!(requests[3].path, "/dav/addressbooks/users/demo/contacts/ada.vcf");
        assert_eq!(header(&requests[3], "if-match").as_deref(), Some(r#""new-etag""#));
        assert!(requests[3].body.contains("FN:Ada Byron"));
        assert_eq!(requests[4].method, "DELETE");
        assert_eq!(requests[4].path, "/dav/addressbooks/users/demo/contacts/ada.vcf");
        assert_eq!(header(&requests[4], "if-match").as_deref(), Some(r#""updated-etag""#));
    }

    #[tokio::test]
    async fn auth_modes_and_delete_without_etag_match_expected_preconditions() {
        let server = MockDavServer::start(vec![
            response(multistatus(
                r#"<d:response><d:href>/dav/</d:href><d:propstat><d:prop><card:addressbook-home-set><d:href>/dav/addressbooks/users/ada/</d:href></card:addressbook-home-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>"#,
            )),
            MockResponse {
                status: "204 No Content",
                headers: vec![],
                body: String::new(),
            },
        ])
        .await;
        let client = client_with_auth(&server, CalDavAuth::None);

        client.discover_addressbook_home_set().await.unwrap();
        client
            .delete_contact("/dav/addressbooks/users/ada/card.vcf", None)
            .await
            .unwrap();

        let requests = server.requests();
        assert!(header(&requests[0], "authorization").is_none());
        assert_eq!(requests[1].method, "DELETE");
        assert!(header(&requests[1], "if-match").is_none());
    }
}
