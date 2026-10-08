use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

pub const HISTORY_LIMIT: usize = 50;
pub const ALLOWED_INTERVALS: [u32; 5] = [10, 15, 20, 30, 60];
const DEFAULT_INTERVAL: u32 = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    #[default]
    Unknown,
    InUse,
    AppearsFree,
    ReleasedGuildExists,
    ReleasedGuildGone,
    Blocked,
}

impl Status {
    /// Not used by any server (whatever we know about why).
    pub fn is_free(self) -> bool {
        matches!(
            self,
            Status::AppearsFree | Status::ReleasedGuildExists | Status::ReleasedGuildGone
        )
    }

    /// Freed after we had seen it in use.
    pub fn is_released(self) -> bool {
        matches!(self, Status::ReleasedGuildExists | Status::ReleasedGuildGone)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuildInfo {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    pub member_count: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub at: DateTime<Utc>,
    pub from: Status,
    pub to: Status,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TrackedUrl {
    pub code: String,
    pub added_at: DateTime<Utc>,
    pub status: Status,
    pub last_checked: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    /// Last guild seen using this code; kept after the code is released.
    pub guild: Option<GuildInfo>,
    pub note: String,
    pub user_blocked: bool,
    pub muted: bool,
    pub history: Vec<HistoryEntry>,
}

/// Outcome of one check. `None` fields leave the stored value unchanged.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Classification {
    pub status: Option<Status>,
    pub guild: Option<GuildInfo>,
    pub error: Option<String>,
}

impl TrackedUrl {
    pub fn new(code: String, now: DateTime<Utc>) -> Self {
        Self { code, added_at: now, ..Default::default() }
    }

    /// Applies a check result. Returns `(from, to)` when the status changed.
    pub fn apply(&mut self, c: Classification, now: DateTime<Utc>) -> Option<(Status, Status)> {
        self.last_checked = Some(now);
        self.last_error = c.error;
        if let Some(guild) = c.guild {
            self.guild = Some(guild);
        }
        let to = c.status?;
        if to == self.status {
            return None;
        }
        let from = std::mem::replace(&mut self.status, to);
        self.history.push(HistoryEntry { at: now, from, to });
        if self.history.len() > HISTORY_LIMIT {
            let excess = self.history.len() - HISTORY_LIMIT;
            self.history.drain(..excess);
        }
        Some((from, to))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub auto_check: bool,
    pub interval_secs: u32,
    pub notify_on_release: bool,
    pub notify_on_taken: bool,
    pub autostart: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            auto_check: true,
            interval_secs: DEFAULT_INTERVAL,
            notify_on_release: true,
            notify_on_taken: false,
            autostart: false,
        }
    }
}

impl Settings {
    /// Replaces out-of-range values (e.g. a hand-edited interval) with defaults.
    pub fn sanitized(mut self) -> Self {
        if !ALLOWED_INTERVALS.contains(&self.interval_secs) {
            self.interval_secs = DEFAULT_INTERVAL;
        }
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn t(secs: i64) -> DateTime<Utc> {
        Utc.timestamp_opt(1_700_000_000 + secs, 0).unwrap()
    }

    fn guild() -> GuildInfo {
        GuildInfo { id: "1".into(), name: "G".into(), icon: None, member_count: Some(5) }
    }

    fn status(s: Status) -> Classification {
        Classification { status: Some(s), ..Default::default() }
    }

    #[test]
    fn new_url_starts_unknown() {
        let u = TrackedUrl::new("abc".into(), t(0));
        assert_eq!(u.code, "abc");
        assert_eq!(u.added_at, t(0));
        assert_eq!(u.status, Status::Unknown);
        assert!(u.history.is_empty());
        assert!(u.last_checked.is_none());
    }

    #[test]
    fn apply_records_transition() {
        let mut u = TrackedUrl::new("abc".into(), t(0));
        let tr = u.apply(
            Classification { status: Some(Status::InUse), guild: Some(guild()), error: None },
            t(1),
        );
        assert_eq!(tr, Some((Status::Unknown, Status::InUse)));
        assert_eq!(u.status, Status::InUse);
        assert_eq!(u.guild, Some(guild()));
        assert_eq!(u.last_checked, Some(t(1)));
        assert_eq!(
            u.history,
            vec![HistoryEntry { at: t(1), from: Status::Unknown, to: Status::InUse }]
        );
    }

    #[test]
    fn apply_same_status_is_not_a_transition() {
        let mut u = TrackedUrl::new("abc".into(), t(0));
        u.apply(status(Status::InUse), t(1));
        assert_eq!(u.apply(status(Status::InUse), t(2)), None);
        assert_eq!(u.history.len(), 1);
        assert_eq!(u.last_checked, Some(t(2)));
    }

    #[test]
    fn apply_error_keeps_status_and_guild() {
        let mut u = TrackedUrl::new("abc".into(), t(0));
        u.apply(
            Classification { status: Some(Status::InUse), guild: Some(guild()), error: None },
            t(1),
        );
        let tr = u.apply(Classification { error: Some("boom".into()), ..Default::default() }, t(2));
        assert_eq!(tr, None);
        assert_eq!(u.status, Status::InUse);
        assert_eq!(u.guild, Some(guild()));
        assert_eq!(u.last_error.as_deref(), Some("boom"));
    }

    #[test]
    fn apply_clears_previous_error() {
        let mut u = TrackedUrl::new("abc".into(), t(0));
        u.apply(Classification { error: Some("boom".into()), ..Default::default() }, t(1));
        u.apply(status(Status::AppearsFree), t(2));
        assert_eq!(u.last_error, None);
    }

    #[test]
    fn history_is_capped() {
        let mut u = TrackedUrl::new("abc".into(), t(0));
        for i in 0..60 {
            let s = if i % 2 == 0 { Status::InUse } else { Status::AppearsFree };
            u.apply(status(s), t(i + 1));
        }
        assert_eq!(u.history.len(), HISTORY_LIMIT);
        assert_eq!(u.history.last().unwrap().at, t(60));
    }

    #[test]
    fn status_helpers() {
        assert!(Status::AppearsFree.is_free());
        assert!(Status::ReleasedGuildGone.is_free());
        assert!(!Status::Blocked.is_free());
        assert!(!Status::InUse.is_free());
        assert!(Status::ReleasedGuildExists.is_released());
        assert!(!Status::AppearsFree.is_released());
    }

    #[test]
    fn settings_defaults() {
        let s = Settings::default();
        assert!(s.auto_check);
        assert_eq!(s.interval_secs, 20);
        assert!(s.notify_on_release);
        assert!(!s.notify_on_taken);
        assert!(!s.autostart);
    }

    #[test]
    fn sanitized_resets_invalid_interval() {
        let s = Settings { interval_secs: 3, ..Settings::default() }.sanitized();
        assert_eq!(s.interval_secs, 20);
        let s = Settings { interval_secs: 60, ..Settings::default() }.sanitized();
        assert_eq!(s.interval_secs, 60);
    }

    #[test]
    fn serializes_for_frontend() {
        assert_eq!(
            serde_json::to_string(&Status::ReleasedGuildGone).unwrap(),
            "\"released_guild_gone\""
        );
        let json = serde_json::to_string(&TrackedUrl::new("abc".into(), t(0))).unwrap();
        assert!(json.contains("\"lastChecked\""));
        assert!(json.contains("\"userBlocked\""));
        let s: Settings = serde_json::from_str("{\"intervalSecs\":30}").unwrap();
        assert_eq!(s.interval_secs, 30);
        assert!(s.auto_check);
    }
}
