use serde::Deserialize;
use std::collections::HashSet;
use std::sync::OnceLock;

/// Community-maintained list of codes that show as free but cannot be claimed.
const RAW: &str = include_str!("../../known-blocked.json");

#[derive(Deserialize)]
struct BlockedFile {
    codes: Vec<String>,
}

fn parse(raw: &str) -> HashSet<String> {
    serde_json::from_str::<BlockedFile>(raw)
        .map(|f| f.codes.into_iter().collect())
        .unwrap_or_default()
}

pub fn is_known_blocked(code: &str) -> bool {
    static SET: OnceLock<HashSet<String>> = OnceLock::new();
    SET.get_or_init(|| parse(RAW)).contains(code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_file_is_valid() {
        let file: BlockedFile =
            serde_json::from_str(RAW).expect("known-blocked.json must be valid JSON");
        for code in &file.codes {
            assert_eq!(
                crate::parse::normalize(code).as_ref(),
                Ok(code),
                "invalid or non-normalized code in known-blocked.json: {code}"
            );
        }
        assert!(
            file.codes.windows(2).all(|w| w[0] < w[1]),
            "known-blocked.json codes must be sorted and unique"
        );
    }

    #[test]
    fn parse_reads_codes() {
        let set = parse(r#"{"codes":["abc","xyz"]}"#);
        assert!(set.contains("abc"));
        assert!(set.contains("xyz"));
        assert!(!set.contains("nope"));
    }

    #[test]
    fn parse_tolerates_garbage() {
        assert!(parse("not json").is_empty());
    }

    #[test]
    fn unknown_code_is_not_blocked() {
        assert!(!is_known_blocked("zz-surely-not-in-list-123"));
    }
}
