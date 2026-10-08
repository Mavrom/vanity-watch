/// Turns user input like `discord.gg/Xyz` or `https://discord.com/invite/xyz` into a vanity code.
pub fn normalize(input: &str) -> Result<String, String> {
    let mut rest = input.trim().to_lowercase();
    for prefix in ["https://", "http://"] {
        if let Some(r) = rest.strip_prefix(prefix) {
            rest = r.to_string();
        }
    }
    if let Some(r) = rest.strip_prefix("www.") {
        rest = r.to_string();
    }
    for host in ["discord.gg/", "discord.com/invite/", "discordapp.com/invite/"] {
        if let Some(r) = rest.strip_prefix(host) {
            rest = r.to_string();
            break;
        }
    }
    let code = rest
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .trim_end_matches('/')
        .to_string();

    if code.len() < 2 || code.len() > 32 {
        return Err("URL kodu 2-32 karakter olmalı".to_string());
    }
    if !code
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err("URL yalnızca harf, rakam ve tire (-) içerebilir".to_string());
    }
    Ok(code)
}

#[cfg(test)]
mod tests {
    use super::normalize;

    #[test]
    fn accepts_plain_code() {
        assert_eq!(normalize("cool-server"), Ok("cool-server".to_string()));
    }

    #[test]
    fn lowercases_and_trims() {
        assert_eq!(normalize("  CoolServer \n"), Ok("coolserver".to_string()));
    }

    #[test]
    fn strips_known_url_forms() {
        for input in [
            "discord.gg/abc",
            "https://discord.gg/abc",
            "http://discord.gg/abc",
            "https://www.discord.gg/abc",
            "discord.com/invite/abc",
            "https://discord.com/invite/abc",
            "https://discordapp.com/invite/abc",
            "https://discord.gg/abc/",
            "https://discord.gg/abc?event=1",
            "https://discord.gg/abc#x",
        ] {
            assert_eq!(normalize(input), Ok("abc".to_string()), "input: {input}");
        }
    }

    #[test]
    fn rejects_bad_length() {
        assert!(normalize("").is_err());
        assert!(normalize("a").is_err());
        assert!(normalize(&"a".repeat(33)).is_err());
        assert!(normalize(&"a".repeat(32)).is_ok());
        assert!(normalize("ab").is_ok());
    }

    #[test]
    fn rejects_invalid_characters() {
        for input in ["ab cd", "ab_cd", "ab.cd", "çay", "a/b/c"] {
            assert!(normalize(input).is_err(), "input: {input}");
        }
    }
}
