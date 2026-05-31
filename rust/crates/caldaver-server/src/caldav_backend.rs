use std::time::Duration;

use caldaver_core::caldav::filter::{ComponentFilter, TimeRange, Uid};
use caldaver_core::caldav::resource::{Calendar, CalendarObject, PrincipalRef};
use caldaver_core::xml::generator::{Generator, empty_properties};
use caldaver_core::xml::parser::Parser;
use caldaver_core::xml::{
    DAV_NS, Properties, XmlElement, XmlError, XmlProperty, XmlValue, clark,
};
use reqwest::header::{ACCEPT, ETAG, HeaderMap, HeaderName, HeaderValue};
use reqwest::{Method, StatusCode, Url};

const CURRENT_USER_PRINCIPAL: &str = "{DAV:}current-user-principal";
const CALENDAR_HOME_SET: &str = "{urn:ietf:params:xml:ns:caldav}calendar-home-set";
const CALENDAR_RESOURCE: &str = "{urn:ietf:params:xml:ns:caldav}calendar";
const RESOURCE_TYPE: &str = "{DAV:}resourcetype";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CalDavAuth {
    None,
    Basic { username: String, password: String },
    Bearer(String),
}

#[derive(Debug, Clone)]
pub struct CalDavConfig {
    pub base_url: String,
    pub auth: CalDavAuth,
    pub connect_timeout: Duration,
    pub response_timeout: Duration,
    pub certificate_verify: bool,
}

impl CalDavConfig {
    pub fn from_app_config(config: &crate::config::Config) -> Self {
        let username = if config.caldav_username.is_empty() {
            config.auth_username.clone()
        } else {
            config.caldav_username.clone()
        };
        let password = if config.caldav_password.is_empty() {
            config.auth_password.clone()
        } else {
            config.caldav_password.clone()
        };
        let auth = match config.caldav_auth_method.to_ascii_lowercase().as_str() {
            "none" => CalDavAuth::None,
            "bearer" => CalDavAuth::Bearer(password),
            _ if username.is_empty() && password.is_empty() => CalDavAuth::None,
            _ => CalDavAuth::Basic { username, password },
        };

        Self {
            base_url: config.caldav_server.clone(),
            auth,
            connect_timeout: config.caldav_connect_timeout,
            response_timeout: config.caldav_response_timeout,
            certificate_verify: config.caldav_certificate_verify,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CalDavSession {
    pub principal_url: String,
    pub calendar_home_set: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CalDavWriteResult {
    pub href: String,
    pub etag: Option<String>,
}

#[derive(Debug)]
pub enum CalDavError {
    InvalidBaseUrl(String),
    InvalidDavHref(String),
    Http(reqwest::Error),
    Xml(XmlError),
    Header(reqwest::header::InvalidHeaderValue),
    MissingCapability(&'static str),
    MissingProperty(&'static str),
    InvalidCalendarProperty(String),
    UnexpectedStatus {
        method: Method,
        url: String,
        status: StatusCode,
        body: String,
    },
}

impl std::fmt::Display for CalDavError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidBaseUrl(message) => write!(f, "invalid CalDAV base URL: {message}"),
            Self::InvalidDavHref(message) => write!(f, "invalid CalDAV href: {message}"),
            Self::Http(error) => write!(f, "CalDAV HTTP error: {error}"),
            Self::Xml(error) => write!(f, "CalDAV XML error: {error}"),
            Self::Header(error) => write!(f, "invalid CalDAV header: {error}"),
            Self::MissingCapability(capability) => {
                write!(f, "CalDAV server did not advertise {capability}")
            }
            Self::MissingProperty(property) => {
                write!(f, "CalDAV response did not include {property}")
            }
            Self::InvalidCalendarProperty(message) => {
                write!(f, "invalid CalDAV calendar property: {message}")
            }
            Self::UnexpectedStatus {
                method,
                url,
                status,
                body,
            } => write!(f, "CalDAV {method} {url} returned {status}: {body}"),
        }
    }
}

impl std::error::Error for CalDavError {}

#[derive(Debug, Clone)]
pub struct CalDavClient {
    http: reqwest::Client,
    base_url: Url,
    auth: CalDavAuth,
    generator: Generator,
    parser: Parser,
}

impl CalDavClient {
    pub fn new(config: CalDavConfig) -> Result<Self, CalDavError> {
        let mut base_url = Url::parse(&config.base_url)
            .map_err(|error| CalDavError::InvalidBaseUrl(error.to_string()))?;
        if !base_url.path().ends_with('/') {
            let path = format!("{}/", base_url.path());
            base_url.set_path(&path);
        }

        let http = reqwest::Client::builder()
            .connect_timeout(config.connect_timeout)
            .timeout(config.response_timeout)
            .danger_accept_invalid_certs(!config.certificate_verify)
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .map_err(CalDavError::Http)?;

        Ok(Self {
            http,
            base_url,
            auth: config.auth,
            generator: Generator::default(),
            parser: Parser::new(),
        })
    }

    pub async fn login(&self) -> Result<CalDavSession, CalDavError> {
        self.require_calendar_access().await?;
        let principal_url = self.current_user_principal().await?;
        let calendar_home_set = self.calendar_home_set(&principal_url).await?;

        Ok(CalDavSession {
            principal_url,
            calendar_home_set,
        })
    }

    pub async fn list_calendars(
        &self,
        calendar_home_set: &str,
    ) -> Result<Vec<Calendar>, CalDavError> {
        let property_names = [
            RESOURCE_TYPE.to_string(),
            Calendar::DISPLAYNAME.to_string(),
            Calendar::CTAG.to_string(),
            Calendar::COLOR.to_string(),
            Calendar::ORDER.to_string(),
            clark(DAV_NS, "owner"),
        ];
        let body = self.generator.propfind_body(&empty_properties(
            property_names.iter().map(String::as_str),
        ))?;
        let response = self
            .xml_request(
                method("PROPFIND"),
                calendar_home_set,
                [("Depth", "1")],
                Some(body),
                &[StatusCode::MULTI_STATUS],
            )
            .await?;
        let multistatus = self
            .parser
            .extract_properties_from_multistatus(&response.body)?;

        multistatus
            .into_iter()
            .filter(|(_, properties)| is_calendar_resource(properties))
            .map(|(href, properties)| calendar_from_properties(href, properties))
            .collect()
    }

    pub async fn list_events_by_time_range(
        &self,
        calendar_url: &str,
        start: impl Into<String>,
        end: impl Into<String>,
    ) -> Result<Vec<CalendarObject>, CalDavError> {
        self.report_events(calendar_url, &TimeRange::new(start, end)).await
    }

    pub async fn list_events_by_uid(
        &self,
        calendar_url: &str,
        uid: impl Into<String>,
    ) -> Result<Vec<CalendarObject>, CalDavError> {
        self.report_events(calendar_url, &Uid::new(uid)).await
    }

    pub async fn create_calendar(
        &self,
        calendar_url: &str,
        properties: &[XmlProperty],
    ) -> Result<CalDavWriteResult, CalDavError> {
        let body = self.generator.mkcalendar_body(properties)?;
        let response = self
            .xml_request(
                method("MKCALENDAR"),
                calendar_url,
                [],
                Some(body),
                &[
                    StatusCode::CREATED,
                    StatusCode::OK,
                    StatusCode::NO_CONTENT,
                    StatusCode::MULTI_STATUS,
                ],
            )
            .await?;
        Ok(write_result(calendar_url, &response.headers))
    }

    pub async fn update_calendar(
        &self,
        calendar_url: &str,
        properties: &[XmlProperty],
    ) -> Result<CalDavWriteResult, CalDavError> {
        let body = self.generator.proppatch_body(properties)?;
        let response = self
            .xml_request(
                method("PROPPATCH"),
                calendar_url,
                [],
                Some(body),
                &[StatusCode::MULTI_STATUS, StatusCode::OK, StatusCode::NO_CONTENT],
            )
            .await?;
        Ok(write_result(calendar_url, &response.headers))
    }

    pub async fn delete_calendar(
        &self,
        calendar_url: &str,
        etag: Option<&str>,
    ) -> Result<(), CalDavError> {
        self.delete_with_etag(calendar_url, etag).await
    }

    pub async fn put_event(
        &self,
        event_url: &str,
        icalendar: impl Into<String>,
        etag: Option<&str>,
    ) -> Result<CalDavWriteResult, CalDavError> {
        let mut headers = vec![("Content-Type", "text/calendar; charset=utf-8")];
        if let Some(etag) = etag.filter(|value| !value.is_empty()) {
            headers.push(("If-Match", etag));
        } else {
            headers.push(("If-None-Match", "*"));
        }

        let response = self
            .request_with_body(
                Method::PUT,
                event_url,
                headers,
                Some(icalendar.into()),
                &[StatusCode::CREATED, StatusCode::OK, StatusCode::NO_CONTENT],
            )
            .await?;
        Ok(write_result(event_url, &response.headers))
    }

    pub async fn delete_event(
        &self,
        event_url: &str,
        etag: Option<&str>,
    ) -> Result<(), CalDavError> {
        if etag.is_none_or(|value| value.is_empty()) {
            return Err(CalDavError::InvalidCalendarProperty(
                "event ETag is required for delete".to_string(),
            ));
        }
        self.delete_with_etag(event_url, etag).await
    }

    async fn require_calendar_access(&self) -> Result<(), CalDavError> {
        let response = self
            .request_with_body(
                Method::OPTIONS,
                self.base_url.as_str(),
                [],
                None,
                &[StatusCode::OK, StatusCode::NO_CONTENT],
            )
            .await?;
        let supported = response
            .headers
            .get_all("DAV")
            .iter()
            .filter_map(|value| value.to_str().ok())
            .any(|value| {
                value
                    .split(',')
                    .any(|capability| capability.trim().eq_ignore_ascii_case("calendar-access"))
            });

        if supported {
            Ok(())
        } else {
            Err(CalDavError::MissingCapability("calendar-access"))
        }
    }

    async fn current_user_principal(&self) -> Result<String, CalDavError> {
        let body = self
            .generator
            .propfind_body(&empty_properties([CURRENT_USER_PRINCIPAL]))?;
        let response = self
            .xml_request(
                method("PROPFIND"),
                self.base_url.as_str(),
                [("Depth", "0")],
                Some(body),
                &[StatusCode::MULTI_STATUS],
            )
            .await?;
        let properties = self
            .parser
            .extract_first_properties_from_multistatus(&response.body)?;
        href_property(&properties, CURRENT_USER_PRINCIPAL)
            .ok_or(CalDavError::MissingProperty("current-user-principal"))
    }

    async fn calendar_home_set(&self, principal_url: &str) -> Result<String, CalDavError> {
        let body = self
            .generator
            .propfind_body(&empty_properties([CALENDAR_HOME_SET]))?;
        let response = self
            .xml_request(
                method("PROPFIND"),
                principal_url,
                [("Depth", "0")],
                Some(body),
                &[StatusCode::MULTI_STATUS],
            )
            .await?;
        let properties = self
            .parser
            .extract_first_properties_from_multistatus(&response.body)?;
        href_property(&properties, CALENDAR_HOME_SET)
            .ok_or(CalDavError::MissingProperty("calendar-home-set"))
    }

    async fn report_events(
        &self,
        calendar_url: &str,
        filter: &impl ComponentFilter,
    ) -> Result<Vec<CalendarObject>, CalDavError> {
        let body = self.generator.calendar_query_body(filter)?;
        let response = self
            .xml_request(
                method("REPORT"),
                calendar_url,
                [("Depth", "1")],
                Some(body),
                &[StatusCode::MULTI_STATUS],
            )
            .await?;
        let multistatus = self
            .parser
            .extract_properties_from_multistatus(&response.body)?;

        Ok(multistatus
            .into_iter()
            .map(|(href, properties)| object_from_properties(href, properties))
            .collect())
    }

    async fn delete_with_etag(&self, url: &str, etag: Option<&str>) -> Result<(), CalDavError> {
        let headers = vec![("If-Match", etag.filter(|value| !value.is_empty()).unwrap_or("*"))];
        self.request_with_body(
            Method::DELETE,
            url,
            headers,
            None,
            &[StatusCode::NO_CONTENT, StatusCode::OK, StatusCode::ACCEPTED],
        )
        .await?;
        Ok(())
    }

    async fn xml_request<const N: usize>(
        &self,
        method: Method,
        url: &str,
        headers: [(&str, &str); N],
        body: Option<String>,
        expected_statuses: &[StatusCode],
    ) -> Result<CalDavResponse, CalDavError> {
        let mut headers = headers.to_vec();
        if body.is_some() {
            headers.push(("Content-Type", "application/xml; charset=utf-8"));
        }
        self.request_with_body(method, url, headers, body, expected_statuses)
            .await
    }

    async fn request_with_body(
        &self,
        method: Method,
        href: &str,
        headers: impl IntoIterator<Item = (&str, &str)>,
        body: Option<String>,
        expected_statuses: &[StatusCode],
    ) -> Result<CalDavResponse, CalDavError> {
        let url = self.href_to_url(href)?;
        let mut defaults = HeaderMap::new();
        defaults.insert(
            ACCEPT,
            HeaderValue::from_static("application/xml,text/xml,text/calendar,*/*"),
        );

        let mut request = self.http.request(method.clone(), url.clone()).headers(defaults);
        request = match &self.auth {
            CalDavAuth::None => request,
            CalDavAuth::Basic { username, password } => {
                request.basic_auth(username, Some(password))
            }
            CalDavAuth::Bearer(token) => request.bearer_auth(token),
        };

        for (name, value) in headers {
            request = request.header(
                name,
                HeaderValue::from_str(value).map_err(CalDavError::Header)?,
            );
        }
        if let Some(body) = body {
            request = request.body(body);
        }

        let response = request.send().await.map_err(CalDavError::Http)?;
        let status = response.status();
        let headers = response.headers().clone();
        let body = response.text().await.map_err(CalDavError::Http)?;

        if !expected_statuses.contains(&status) {
            return Err(CalDavError::UnexpectedStatus {
                method,
                url: url.to_string(),
                status,
                body,
            });
        }

        Ok(CalDavResponse { headers, body })
    }

    fn href_to_url(&self, href: &str) -> Result<Url, CalDavError> {
        let url = match Url::parse(href) {
            Ok(url) => url,
            Err(_) => self
                .base_url
                .join(href)
                .map_err(|error| CalDavError::InvalidDavHref(error.to_string()))?,
        };
        if !same_origin(&self.base_url, &url) {
            return Err(CalDavError::InvalidDavHref(
                "DAV href resolves outside the configured CalDAV origin".to_string(),
            ));
        }
        Ok(url)
    }
}

#[derive(Debug)]
struct CalDavResponse {
    headers: HeaderMap,
    body: String,
}

impl From<XmlError> for CalDavError {
    fn from(error: XmlError) -> Self {
        Self::Xml(error)
    }
}

fn method(value: &'static str) -> Method {
    Method::from_bytes(value.as_bytes()).expect("valid DAV method")
}

fn same_origin(left: &Url, right: &Url) -> bool {
    left.scheme() == right.scheme()
        && left.host_str() == right.host_str()
        && left.port_or_known_default() == right.port_or_known_default()
}

fn is_calendar_resource(properties: &Properties) -> bool {
    matches!(
        properties.get(RESOURCE_TYPE),
        Some(XmlValue::ResourceType(values)) if values.iter().any(|value| value == CALENDAR_RESOURCE)
    )
}

fn calendar_from_properties(href: String, properties: Properties) -> Result<Calendar, CalDavError> {
    let mut calendar = Calendar::new(ensure_trailing_slash(href));
    for property in [
        Calendar::DISPLAYNAME,
        Calendar::CTAG,
        Calendar::COLOR,
        Calendar::ORDER,
    ] {
        if let Some(value) = text_property(&properties, property) {
            calendar
                .set_property(property, value)
                .map_err(|error| CalDavError::InvalidCalendarProperty(error.to_string()))?;
        }
    }

    if let Some(owner) = href_property(&properties, &clark(DAV_NS, "owner")) {
        calendar.set_owner(PrincipalRef::new(owner));
    }

    Ok(calendar)
}

fn object_from_properties(href: String, properties: Properties) -> CalendarObject {
    let mut object = CalendarObject::new(href);
    object.set_etag(text_property(&properties, CalendarObject::ETAG));
    if let Some(data) = text_property(&properties, CalendarObject::DATA) {
        object.set_rendered_event(data);
    }
    object
}

fn write_result(href: &str, headers: &HeaderMap) -> CalDavWriteResult {
    CalDavWriteResult {
        href: href.to_string(),
        etag: header_text(headers, ETAG),
    }
}

fn header_text(headers: &HeaderMap, name: HeaderName) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn href_property(properties: &Properties, property: &str) -> Option<String> {
    match properties.get(property) {
        Some(XmlValue::Href(value) | XmlValue::Text(value)) if !value.is_empty() => {
            Some(value.clone())
        }
        Some(XmlValue::Elements(children)) => children.iter().find_map(element_href),
        _ => None,
    }
}

fn element_href(element: &XmlElement) -> Option<String> {
    if element.name == clark(DAV_NS, "href") {
        return match &element.value {
            XmlValue::Text(value) | XmlValue::Href(value) if !value.is_empty() => {
                Some(value.clone())
            }
            _ => None,
        };
    }

    match &element.value {
        XmlValue::Elements(children) => children.iter().find_map(element_href),
        _ => None,
    }
}

fn text_property(properties: &Properties, property: &str) -> Option<String> {
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

    fn client(server: &MockDavServer) -> CalDavClient {
        CalDavClient::new(CalDavConfig {
            base_url: server.base_url.clone(),
            auth: CalDavAuth::Basic {
                username: "demo".to_string(),
                password: "secret".to_string(),
            },
            connect_timeout: Duration::from_secs(5),
            response_timeout: Duration::from_secs(5),
            certificate_verify: true,
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
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">
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
    async fn login_uses_options_and_discovers_calendar_home_set() {
        let server = MockDavServer::start(vec![
            MockResponse {
                status: "200 OK",
                headers: vec![("DAV", "1, 3, calendar-access")],
                body: String::new(),
            },
            response(multistatus(
                r#"<d:response>
  <d:href>/dav/</d:href>
  <d:propstat><d:prop><d:current-user-principal><d:href>/dav/principals/demo/</d:href></d:current-user-principal></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
</d:response>"#,
            )),
            response(multistatus(
                r#"<d:response>
  <d:href>/dav/principals/demo/</d:href>
  <d:propstat><d:prop><cal:calendar-home-set><d:href>/dav/calendars/demo/</d:href></cal:calendar-home-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
</d:response>"#,
            )),
        ])
        .await;
        let client = client(&server);

        let session = client.login().await.unwrap();

        assert_eq!(session.principal_url, "/dav/principals/demo/");
        assert_eq!(session.calendar_home_set, "/dav/calendars/demo/");
        let requests = server.requests();
        assert_eq!(requests[0].method, "OPTIONS");
        assert_eq!(requests[0].path, "/dav/");
        assert_eq!(requests[1].method, "PROPFIND");
        assert_eq!(header(&requests[1], "depth").as_deref(), Some("0"));
        assert!(requests[1].body.contains("current-user-principal"));
        assert_eq!(requests[2].path, "/dav/principals/demo/");
        assert!(requests[2].body.contains("calendar-home-set"));
        assert!(header(&requests[0], "authorization").is_some());
    }

    #[tokio::test]
    async fn lists_calendar_collections_from_calendar_home_set() {
        let server = MockDavServer::start(vec![response(multistatus(
            r##"<d:response>
  <d:href>/dav/calendars/demo/</d:href>
  <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
</d:response>
<d:response>
  <d:href>/dav/calendars/demo/work</d:href>
  <d:propstat><d:prop>
    <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
    <d:displayname>Work</d:displayname>
    <a:calendar-color>#123456</a:calendar-color>
    <d:owner><d:href>/dav/principals/demo/</d:href></d:owner>
  </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
</d:response>"##,
        ))])
        .await;
        let client = client(&server);

        let calendars = client.list_calendars("/dav/calendars/demo/").await.unwrap();

        assert_eq!(calendars.len(), 1);
        assert_eq!(calendars[0].url(), "/dav/calendars/demo/work/");
        assert_eq!(calendars[0].property(Calendar::DISPLAYNAME), Some("Work"));
        assert_eq!(calendars[0].property(Calendar::COLOR), Some("#123456ff"));
        assert_eq!(
            calendars[0].owner().map(PrincipalRef::display_name),
            Some("/dav/principals/demo/")
        );
        let requests = server.requests();
        assert_eq!(requests[0].method, "PROPFIND");
        assert_eq!(header(&requests[0], "depth").as_deref(), Some("1"));
        assert!(requests[0].body.contains("calendar-color"));
    }

    #[tokio::test]
    async fn reports_events_by_time_range_and_uid() {
        let calendar_data = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:item-1\nEND:VEVENT\nEND:VCALENDAR";
        let server = MockDavServer::start(vec![
            response(event_multistatus(calendar_data)),
            response(event_multistatus(calendar_data)),
        ])
        .await;
        let client = client(&server);

        let by_range = client
            .list_events_by_time_range(
                "/dav/calendars/demo/work/",
                "20260501T000000Z",
                "20260601T000000Z",
            )
            .await
            .unwrap();
        let by_uid = client
            .list_events_by_uid("/dav/calendars/demo/work/", "item-1")
            .await
            .unwrap();

        assert_eq!(by_range[0].url(), "/dav/calendars/demo/work/item-1.ics");
        assert_eq!(by_range[0].etag(), Some("\"abc\""));
        assert_eq!(by_range[0].rendered_event(), Some(calendar_data));
        assert_eq!(by_uid[0].etag(), Some("\"abc\""));
        let requests = server.requests();
        assert_eq!(requests[0].method, "REPORT");
        assert_eq!(requests[0].path, "/dav/calendars/demo/work/");
        assert!(requests[0].body.contains("time-range"));
        assert_eq!(header(&requests[0], "depth").as_deref(), Some("1"));
        assert_eq!(requests[1].method, "REPORT");
        assert!(requests[1].body.contains("text-match"));
        assert!(requests[1].body.contains("item-1"));
    }

    #[tokio::test]
    async fn calendar_and_event_writes_send_dav_methods_and_etag_headers() {
        let server = MockDavServer::start(vec![
            MockResponse {
                status: "201 Created",
                headers: vec![("ETag", "\"cal-new\"")],
                body: String::new(),
            },
            MockResponse {
                status: "207 Multi-Status",
                headers: vec![],
                body: multistatus(""),
            },
            MockResponse {
                status: "201 Created",
                headers: vec![("ETag", "\"event-new\"")],
                body: String::new(),
            },
            MockResponse {
                status: "204 No Content",
                headers: vec![],
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

        let created = client
            .create_calendar(
                "/dav/calendars/demo/personal/",
                &[XmlProperty::text(Calendar::DISPLAYNAME, "Personal")],
            )
            .await
            .unwrap();
        let updated = client
            .update_calendar(
                "/dav/calendars/demo/personal/",
                &[XmlProperty::text(Calendar::COLOR, "#abcdef")],
            )
            .await
            .unwrap();
        let event = client
            .put_event(
                "/dav/calendars/demo/personal/item-1.ics",
                "BEGIN:VCALENDAR\nEND:VCALENDAR",
                None,
            )
            .await
            .unwrap();
        client
            .delete_event("/dav/calendars/demo/personal/item-1.ics", Some("\"event-new\""))
            .await
            .unwrap();
        client
            .delete_calendar("/dav/calendars/demo/personal/", Some("\"cal-new\""))
            .await
            .unwrap();

        assert_eq!(created.etag, Some("\"cal-new\"".to_string()));
        assert_eq!(updated.etag, None);
        assert_eq!(event.etag, Some("\"event-new\"".to_string()));

        let requests = server.requests();
        assert_eq!(requests[0].method, "MKCALENDAR");
        assert!(requests[0].body.contains("mkcalendar"));
        assert!(requests[0].body.contains("Personal"));
        assert_eq!(requests[1].method, "PROPPATCH");
        assert!(requests[1].body.contains("propertyupdate"));
        assert!(requests[1].body.contains("#abcdef"));
        assert_eq!(requests[2].method, "PUT");
        assert_eq!(header(&requests[2], "if-none-match").as_deref(), Some("*"));
        assert!(requests[2].body.contains("BEGIN:VCALENDAR"));
        assert_eq!(requests[3].method, "DELETE");
        assert_eq!(header(&requests[3], "if-match").as_deref(), Some("\"event-new\""));
        assert_eq!(requests[4].method, "DELETE");
        assert_eq!(header(&requests[4], "if-match").as_deref(), Some("\"cal-new\""));
    }

    fn event_multistatus(calendar_data: &str) -> String {
        multistatus(&format!(
            r#"<d:response>
  <d:href>/dav/calendars/demo/work/item-1.ics</d:href>
  <d:propstat><d:prop><d:getetag>"abc"</d:getetag><cal:calendar-data>{}</cal:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
</d:response>"#,
            calendar_data
        ))
    }
}
