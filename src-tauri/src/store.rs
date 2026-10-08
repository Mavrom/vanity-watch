use crate::model::{Settings, TrackedUrl};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::PathBuf;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Data {
    pub settings: Settings,
    pub urls: Vec<TrackedUrl>,
}

pub struct Store {
    path: PathBuf,
    pub data: Data,
}

impl Store {
    /// Loads `path`. A corrupt file is moved to `*.json.bak` and an empty store is
    /// returned with `true` so the UI can tell the user once.
    pub fn load(path: PathBuf) -> (Store, bool) {
        let raw = match fs::read_to_string(&path) {
            Ok(raw) => raw,
            Err(_) => return (Store { path, data: Data::default() }, false),
        };
        match serde_json::from_str::<Data>(&raw) {
            Ok(mut data) => {
                data.settings = data.settings.sanitized();
                (Store { path, data }, false)
            }
            Err(_) => {
                let _ = fs::rename(&path, path.with_extension("json.bak"));
                (Store { path, data: Data::default() }, true)
            }
        }
    }

    /// Writes atomically: temp file, then rename over the old one.
    pub fn save(&self) -> io::Result<()> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(&self.data)?)?;
        fs::rename(&tmp, &self.path)
    }

    pub fn get(&self, code: &str) -> Option<&TrackedUrl> {
        self.data.urls.iter().find(|u| u.code == code)
    }

    pub fn get_mut(&mut self, code: &str) -> Option<&mut TrackedUrl> {
        self.data.urls.iter_mut().find(|u| u.code == code)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn missing_file_gives_empty_store() {
        let dir = tempfile::tempdir().unwrap();
        let (store, recovered) = Store::load(dir.path().join("data.json"));
        assert!(!recovered);
        assert_eq!(store.data, Data::default());
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("data.json");
        let (mut store, _) = Store::load(path.clone());
        store.data.urls.push(TrackedUrl::new("abc".into(), Utc::now()));
        store.data.settings.interval_secs = 30;
        store.save().unwrap();

        let (loaded, recovered) = Store::load(path);
        assert!(!recovered);
        assert_eq!(loaded.data, store.data);
        assert!(loaded.get("abc").is_some());
    }

    #[test]
    fn corrupt_file_is_backed_up() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.json");
        fs::write(&path, "{ not json").unwrap();
        let (store, recovered) = Store::load(path.clone());
        assert!(recovered);
        assert_eq!(store.data, Data::default());
        assert!(dir.path().join("data.json.bak").exists());
        assert!(!path.exists());
    }

    #[test]
    fn invalid_interval_is_sanitized_on_load() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.json");
        fs::write(&path, r#"{"settings":{"intervalSecs":1},"urls":[]}"#).unwrap();
        let (store, _) = Store::load(path);
        assert_eq!(store.data.settings.interval_secs, 20);
    }

    #[test]
    fn get_mut_edits_in_place() {
        let dir = tempfile::tempdir().unwrap();
        let (mut store, _) = Store::load(dir.path().join("data.json"));
        store.data.urls.push(TrackedUrl::new("abc".into(), Utc::now()));
        store.get_mut("abc").unwrap().note = "hi".into();
        assert_eq!(store.get("abc").unwrap().note, "hi");
        assert!(store.get_mut("nope").is_none());
    }
}
