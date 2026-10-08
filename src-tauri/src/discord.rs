use crate::model::GuildInfo;
use reqwest::{Client, Response, StatusCode};
use serde::Deserialize;
use std::time::Duration;

pub const API_BASE: &str = "https://discord.com/api/v10";

const USER_AGENT: &str = concat!(
    "VanityWatch/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/Mavrom/vanity-watch)"
);
const DEFAULT_RETRY_SECS: f64 = 5.0;
const MAX_RETRY_SECS: f64 = 60.0;

#[derive(Debug, Clone, PartialEq)]
pub enum InviteResult {
    Found(GuildInfo),
    NotFound,
    RateLimited(Duration),
    Error(String),
}

#[derive(Debug, Clone, PartialEq)]
pub enum WidgetResult {
    GuildExists,
    GuildGone,
    Error(String),
}

#[derive(Deserialize)]
struct InviteBody {
    guild: Option<InviteGuild>,
    approximate_member_count: Option<u64>,
}

#[derive(Deserialize)]
struct InviteGuild {
    id: String,
    name: String,
    icon: Option<String>,
}

#[derive(Deserialize)]
struct RateLimitBody {
    retry_after: Option<f64>,
}

/// Unauthenticated client for Discord's public invite and widget endpoints.
#[derive(Clone)]
pub struct DiscordClient {
    http: Client,
    base: String,
}

impl DiscordClient {
    pub fn new(base: impl Into<String>) -> Self {
        let http = Client::builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(10))
            .build()
            .expect("failed to build HTTP client");
        Self { http, base: base.into() }
    }

    pub async fn check_invite(&self, code: &str) -> InviteResult {
        let url = format!("{}/invites/{}?with_counts=true", self.base, code);
        let resp = match self.http.get(&url).send().await {
            Ok(r) => r,
            Err(e) => return InviteResult::Error(describe(&e)),
        };
        match resp.status() {
            StatusCode::TOO_MANY_REQUESTS => InviteResult::RateLimited(retry_after(resp).await),
            StatusCode::NOT_FOUND => InviteResult::NotFound,
            s if s.is_success() => match resp.json::<InviteBody>().await {
                Ok(body) => InviteResult::Found(to_guild(body)),
                Err(_) => InviteResult::Error("Beklenmeyen yanıt".into()),
            },
            s => InviteResult::Error(format!("HTTP {}", s.as_u16())),
        }
    }

    pub async fn check_guild_widget(&self, guild_id: &str) -> WidgetResult {
        let url = format!("{}/guilds/{}/widget.json", self.base, guild_id);
        let resp = match self.http.get(&url).send().await {
            Ok(r) => r,
            Err(e) => return WidgetResult::Error(describe(&e)),
        };
        match resp.status() {
            // 403 = guild exists but its widget is disabled (code 50004).
            s if s.is_success() || s == StatusCode::FORBIDDEN => WidgetResult::GuildExists,
            // 404 = Unknown Guild (code 10004): deleted or terminated.
            StatusCode::NOT_FOUND => WidgetResult::GuildGone,
            StatusCode::TOO_MANY_REQUESTS => WidgetResult::Error("Rate limit".into()),
            s => WidgetResult::Error(format!("HTTP {}", s.as_u16())),
        }
    }
}

fn to_guild(body: InviteBody) -> GuildInfo {
    match body.guild {
        Some(g) => GuildInfo {
            id: g.id,
            name: g.name,
            icon: g.icon,
            member_count: body.approximate_member_count,
        },
        None => GuildInfo {
            id: String::new(),
            name: "Sunucu dışı davet".into(),
            icon: None,
            member_count: body.approximate_member_count,
        },
    }
}

async fn retry_after(resp: Response) -> Duration {
    let header = resp
        .headers()
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<f64>().ok());
    let secs = match header {
        Some(s) => s,
        None => resp
            .json::<RateLimitBody>()
            .await
            .ok()
            .and_then(|b| b.retry_after)
            .unwrap_or(DEFAULT_RETRY_SECS),
    };
    let secs = if secs.is_finite() { secs } else { DEFAULT_RETRY_SECS };
    Duration::from_secs_f64(secs.clamp(1.0, MAX_RETRY_SECS))
}

fn describe(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "Zaman aşımı".into()
    } else if e.is_connect() {
        "Bağlantı kurulamadı".into()
    } else {
        "Ağ hatası".into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    async fn mock(server: &MockServer, p: &str, response: ResponseTemplate) {
        Mock::given(method("GET")).and(path(p)).respond_with(response).mount(server).await;
    }

    #[tokio::test]
    async fn invite_found_maps_guild() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/invites/cool"))
            .and(query_param("with_counts", "true"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "code": "cool",
                "guild": { "id": "123", "name": "Cool Server", "icon": "abc" },
                "approximate_member_count": 42
            })))
            .mount(&server)
            .await;
        let client = DiscordClient::new(server.uri());
        assert_eq!(
            client.check_invite("cool").await,
            InviteResult::Found(GuildInfo {
                id: "123".into(),
                name: "Cool Server".into(),
                icon: Some("abc".into()),
                member_count: Some(42),
            })
        );
    }

    #[tokio::test]
    async fn invite_without_guild_is_found_with_empty_id() {
        let server = MockServer::start().await;
        mock(&server, "/invites/dm", ResponseTemplate::new(200).set_body_json(json!({ "code": "dm" }))).await;
        let client = DiscordClient::new(server.uri());
        match client.check_invite("dm").await {
            InviteResult::Found(g) => assert!(g.id.is_empty()),
            other => panic!("unexpected {other:?}"),
        }
    }

    #[tokio::test]
    async fn invite_404_is_not_found() {
        let server = MockServer::start().await;
        mock(
            &server,
            "/invites/free",
            ResponseTemplate::new(404).set_body_json(json!({ "message": "Unknown Invite", "code": 10006 })),
        )
        .await;
        let client = DiscordClient::new(server.uri());
        assert_eq!(client.check_invite("free").await, InviteResult::NotFound);
    }

    #[tokio::test]
    async fn invite_429_reads_retry_after_header() {
        let server = MockServer::start().await;
        mock(&server, "/invites/x", ResponseTemplate::new(429).insert_header("Retry-After", "2.5")).await;
        let client = DiscordClient::new(server.uri());
        assert_eq!(
            client.check_invite("x").await,
            InviteResult::RateLimited(Duration::from_millis(2500))
        );
    }

    #[tokio::test]
    async fn invite_429_falls_back_to_body() {
        let server = MockServer::start().await;
        mock(&server, "/invites/x", ResponseTemplate::new(429).set_body_json(json!({ "retry_after": 3.0 }))).await;
        let client = DiscordClient::new(server.uri());
        assert_eq!(client.check_invite("x").await, InviteResult::RateLimited(Duration::from_secs(3)));
    }

    #[tokio::test]
    async fn invite_429_clamps_huge_wait() {
        let server = MockServer::start().await;
        mock(&server, "/invites/x", ResponseTemplate::new(429).insert_header("Retry-After", "9999")).await;
        let client = DiscordClient::new(server.uri());
        assert_eq!(client.check_invite("x").await, InviteResult::RateLimited(Duration::from_secs(60)));
    }

    #[tokio::test]
    async fn invite_500_is_error() {
        let server = MockServer::start().await;
        mock(&server, "/invites/x", ResponseTemplate::new(500)).await;
        let client = DiscordClient::new(server.uri());
        assert_eq!(client.check_invite("x").await, InviteResult::Error("HTTP 500".into()));
    }

    #[tokio::test]
    async fn network_failure_is_error() {
        let client = DiscordClient::new("http://127.0.0.1:1");
        assert!(matches!(client.check_invite("x").await, InviteResult::Error(_)));
        assert!(matches!(client.check_guild_widget("1").await, WidgetResult::Error(_)));
    }

    #[tokio::test]
    async fn widget_statuses() {
        let server = MockServer::start().await;
        mock(&server, "/guilds/1/widget.json", ResponseTemplate::new(200).set_body_json(json!({ "id": "1" }))).await;
        mock(
            &server,
            "/guilds/2/widget.json",
            ResponseTemplate::new(403).set_body_json(json!({ "message": "Widget Disabled", "code": 50004 })),
        )
        .await;
        mock(
            &server,
            "/guilds/3/widget.json",
            ResponseTemplate::new(404).set_body_json(json!({ "message": "Unknown Guild", "code": 10004 })),
        )
        .await;
        mock(&server, "/guilds/4/widget.json", ResponseTemplate::new(429)).await;
        mock(&server, "/guilds/5/widget.json", ResponseTemplate::new(502)).await;
        let client = DiscordClient::new(server.uri());
        assert_eq!(client.check_guild_widget("1").await, WidgetResult::GuildExists);
        assert_eq!(client.check_guild_widget("2").await, WidgetResult::GuildExists);
        assert_eq!(client.check_guild_widget("3").await, WidgetResult::GuildGone);
        assert!(matches!(client.check_guild_widget("4").await, WidgetResult::Error(_)));
        assert_eq!(client.check_guild_widget("5").await, WidgetResult::Error("HTTP 502".into()));
    }
}
