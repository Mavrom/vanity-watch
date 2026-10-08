use crate::discord::{InviteResult, WidgetResult};
use crate::model::{Classification, GuildInfo, Status};

/// Guild ID to probe with the widget endpoint, if this check needs one:
/// the code just went free, isn't blocked, and we know which guild had it.
pub fn widget_target<'a>(
    current: Status,
    invite: &InviteResult,
    blocked: bool,
    last_guild: Option<&'a GuildInfo>,
) -> Option<&'a str> {
    if !matches!(invite, InviteResult::NotFound) || blocked || current.is_released() {
        return None;
    }
    last_guild.map(|g| g.id.as_str()).filter(|id| !id.is_empty())
}

pub fn classify(
    current: Status,
    invite: &InviteResult,
    blocked: bool,
    widget: Option<&WidgetResult>,
) -> Classification {
    let to = |status: Status| Classification { status: Some(status), ..Default::default() };
    match invite {
        InviteResult::Found(guild) => Classification {
            status: Some(Status::InUse),
            guild: Some(guild.clone()),
            error: None,
        },
        InviteResult::NotFound if blocked => to(Status::Blocked),
        InviteResult::NotFound => match widget {
            Some(WidgetResult::GuildGone) => to(Status::ReleasedGuildGone),
            Some(WidgetResult::GuildExists) => to(Status::ReleasedGuildExists),
            Some(WidgetResult::Error(e)) => Classification {
                status: Some(Status::ReleasedGuildExists),
                guild: None,
                error: Some(e.clone()),
            },
            None if current.is_released() => Classification::default(),
            None => to(Status::AppearsFree),
        },
        InviteResult::RateLimited(wait) => Classification {
            error: Some(format!("Rate limit, {} sn bekleniyor", wait.as_secs().max(1))),
            ..Default::default()
        },
        InviteResult::Error(e) => Classification { error: Some(e.clone()), ..Default::default() },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn g(id: &str) -> GuildInfo {
        GuildInfo { id: id.into(), name: "G".into(), icon: None, member_count: None }
    }

    fn only(status: Status) -> Classification {
        Classification { status: Some(status), ..Default::default() }
    }

    #[test]
    fn found_is_in_use_and_updates_guild() {
        let c = classify(Status::Unknown, &InviteResult::Found(g("1")), false, None);
        assert_eq!(c, Classification { status: Some(Status::InUse), guild: Some(g("1")), error: None });
    }

    #[test]
    fn found_wins_over_blocked() {
        let c = classify(Status::Blocked, &InviteResult::Found(g("1")), true, None);
        assert_eq!(c.status, Some(Status::InUse));
    }

    #[test]
    fn not_found_blocked_is_blocked() {
        let c = classify(Status::InUse, &InviteResult::NotFound, true, None);
        assert_eq!(c, only(Status::Blocked));
    }

    #[test]
    fn not_found_never_seen_is_appears_free() {
        let c = classify(Status::Unknown, &InviteResult::NotFound, false, None);
        assert_eq!(c, only(Status::AppearsFree));
    }

    #[test]
    fn not_found_with_widget_results() {
        let nf = InviteResult::NotFound;
        assert_eq!(
            classify(Status::InUse, &nf, false, Some(&WidgetResult::GuildGone)),
            only(Status::ReleasedGuildGone)
        );
        assert_eq!(
            classify(Status::InUse, &nf, false, Some(&WidgetResult::GuildExists)),
            only(Status::ReleasedGuildExists)
        );
        assert_eq!(
            classify(Status::InUse, &nf, false, Some(&WidgetResult::Error("x".into()))),
            Classification {
                status: Some(Status::ReleasedGuildExists),
                guild: None,
                error: Some("x".into())
            }
        );
    }

    #[test]
    fn not_found_keeps_released_status() {
        for s in [Status::ReleasedGuildExists, Status::ReleasedGuildGone] {
            assert_eq!(classify(s, &InviteResult::NotFound, false, None), Classification::default());
        }
    }

    #[test]
    fn rate_limited_keeps_status_with_error() {
        let c = classify(Status::InUse, &InviteResult::RateLimited(Duration::from_secs(4)), false, None);
        assert_eq!(c.status, None);
        assert!(c.error.unwrap().contains("Rate limit"));
    }

    #[test]
    fn error_keeps_status() {
        let c = classify(Status::InUse, &InviteResult::Error("Zaman aşımı".into()), false, None);
        assert_eq!(c, Classification { error: Some("Zaman aşımı".into()), ..Default::default() });
    }

    #[test]
    fn widget_target_after_in_use() {
        let guild = g("42");
        assert_eq!(widget_target(Status::InUse, &InviteResult::NotFound, false, Some(&guild)), Some("42"));
        assert_eq!(widget_target(Status::Blocked, &InviteResult::NotFound, false, Some(&guild)), Some("42"));
    }

    #[test]
    fn widget_target_skipped_when_not_needed() {
        let guild = g("42");
        let empty = g("");
        assert_eq!(widget_target(Status::InUse, &InviteResult::Found(g("1")), false, Some(&guild)), None);
        assert_eq!(widget_target(Status::InUse, &InviteResult::NotFound, true, Some(&guild)), None);
        assert_eq!(widget_target(Status::ReleasedGuildGone, &InviteResult::NotFound, false, Some(&guild)), None);
        assert_eq!(widget_target(Status::InUse, &InviteResult::NotFound, false, None), None);
        assert_eq!(widget_target(Status::InUse, &InviteResult::NotFound, false, Some(&empty)), None);
        assert_eq!(
            widget_target(Status::InUse, &InviteResult::Error("x".into()), false, Some(&guild)),
            None
        );
    }
}
