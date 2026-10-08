use crate::model::{GuildInfo, Settings, Status};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotifyKind {
    /// A code we saw in use became free.
    Released,
    /// A free code was taken by a server.
    Taken,
}

pub fn should_notify(from: Status, to: Status, settings: &Settings, muted: bool) -> Option<NotifyKind> {
    if muted {
        return None;
    }
    if from == Status::InUse && to.is_free() && settings.notify_on_release {
        return Some(NotifyKind::Released);
    }
    if from.is_free() && to == Status::InUse && settings.notify_on_taken {
        return Some(NotifyKind::Taken);
    }
    None
}

pub fn message(kind: NotifyKind, code: &str, to: Status, guild: Option<&GuildInfo>) -> (String, String) {
    match kind {
        NotifyKind::Released => {
            let body = match to {
                Status::ReleasedGuildExists => "Sunucu hâlâ var, URL'yi bırakmış. Alınabilir olabilir.",
                Status::ReleasedGuildGone => "Sunucu kapatılmış veya silinmiş. URL bir süre kilitli kalabilir.",
                _ => "URL boşta görünüyor.",
            };
            (format!("discord.gg/{code} boşaldı!"), body.to_string())
        }
        NotifyKind::Taken => {
            let body = match guild {
                Some(g) => format!("Sunucu: {}", g.name),
                None => "Bir sunucu bu URL'yi aldı.".to_string(),
            };
            (format!("discord.gg/{code} alındı"), body)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn defaults() -> Settings {
        Settings::default()
    }

    #[test]
    fn release_notifies_for_every_free_status() {
        for to in [Status::AppearsFree, Status::ReleasedGuildExists, Status::ReleasedGuildGone] {
            assert_eq!(should_notify(Status::InUse, to, &defaults(), false), Some(NotifyKind::Released));
        }
    }

    #[test]
    fn muted_never_notifies() {
        assert_eq!(should_notify(Status::InUse, Status::AppearsFree, &defaults(), true), None);
    }

    #[test]
    fn release_respects_setting() {
        let s = Settings { notify_on_release: false, ..defaults() };
        assert_eq!(should_notify(Status::InUse, Status::AppearsFree, &s, false), None);
    }

    #[test]
    fn taken_is_off_by_default_and_opt_in() {
        assert_eq!(should_notify(Status::AppearsFree, Status::InUse, &defaults(), false), None);
        let s = Settings { notify_on_taken: true, ..defaults() };
        assert_eq!(
            should_notify(Status::ReleasedGuildGone, Status::InUse, &s, false),
            Some(NotifyKind::Taken)
        );
    }

    #[test]
    fn other_transitions_are_silent() {
        let all_on = Settings { notify_on_taken: true, ..defaults() };
        assert_eq!(should_notify(Status::Unknown, Status::InUse, &all_on, false), None);
        assert_eq!(should_notify(Status::Unknown, Status::AppearsFree, &all_on, false), None);
        assert_eq!(should_notify(Status::InUse, Status::Blocked, &all_on, false), None);
        assert_eq!(should_notify(Status::AppearsFree, Status::ReleasedGuildGone, &all_on, false), None);
    }

    #[test]
    fn messages_mention_code_and_context() {
        let (title, body) = message(NotifyKind::Released, "xyz", Status::ReleasedGuildExists, None);
        assert_eq!(title, "discord.gg/xyz boşaldı!");
        assert!(body.contains("hâlâ var"));
        let (_, body) = message(NotifyKind::Released, "xyz", Status::ReleasedGuildGone, None);
        assert!(body.contains("kapatılmış"));
        let guild = GuildInfo { id: "1".into(), name: "Kedi Sever".into(), icon: None, member_count: None };
        let (title, body) = message(NotifyKind::Taken, "xyz", Status::InUse, Some(&guild));
        assert_eq!(title, "discord.gg/xyz alındı");
        assert!(body.contains("Kedi Sever"));
    }
}
