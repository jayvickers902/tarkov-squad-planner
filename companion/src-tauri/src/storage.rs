use crate::error::NativeError;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

pub const STATE_VERSION: u32 = 1;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompanionConfig {
    pub version: u32,
    pub logs_root: Option<String>,
    pub screenshots_root: Option<String>,
}

impl CompanionConfig {
    #[allow(dead_code)]
    pub fn empty() -> Self {
        Self {
            version: STATE_VERSION,
            ..Self::default()
        }
    }
}

pub const MAX_CHECKPOINT_BYTES: usize = 4 * 1024 * 1024;

pub struct Storage {
    root: PathBuf,
}

impl Storage {
    pub fn new(root: PathBuf) -> Result<Self, NativeError> {
        fs::create_dir_all(&root)?;
        Ok(Self { root })
    }

    fn path(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }

    fn read<T: for<'a> Deserialize<'a> + Default>(&self, name: &str) -> Result<T, NativeError> {
        let path = self.path(name);
        match fs::read_to_string(path) {
            Ok(value) => Ok(serde_json::from_str(&value)?),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
            Err(error) => Err(error.into()),
        }
    }

    fn write<T: Serialize>(&self, name: &str, value: &T) -> Result<(), NativeError> {
        let path = self.path(name);
        let temporary = path.with_extension("json.tmp");
        let encoded = serde_json::to_vec_pretty(value)?;
        fs::write(&temporary, encoded)?;
        replace_file(&temporary, &path)?;
        Ok(())
    }

    pub fn load_config(&self) -> Result<CompanionConfig, NativeError> {
        let config: CompanionConfig = self.read("config-v1.json")?;
        if config.version != 0 && config.version != STATE_VERSION {
            return Err(NativeError::InvalidInput(
                "The saved companion configuration version is unsupported.".into(),
            ));
        }
        Ok(CompanionConfig {
            version: STATE_VERSION,
            ..config
        })
    }

    pub fn save_config(&self, mut config: CompanionConfig) -> Result<(), NativeError> {
        config.version = STATE_VERSION;
        self.write("config-v1.json", &config)
    }

    /// Checkpoints are opaque JSON owned by the sync engine, allowing new
    /// controller keys to survive a native app upgrade unchanged.
    pub fn load_checkpoints(&self) -> Result<serde_json::Value, NativeError> {
        let path = self.path("checkpoints-v1.json");
        match fs::metadata(&path) {
            Ok(metadata) if metadata.len() > MAX_CHECKPOINT_BYTES as u64 => {
                return Err(NativeError::InvalidInput(
                    "Sync checkpoints exceed the 4 MiB safety limit.".into(),
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(serde_json::json!({}));
            }
            Err(error) => return Err(error.into()),
        }
        match fs::read_to_string(path) {
            Ok(value) => Ok(serde_json::from_str(&value)?),
            Err(error) => Err(error.into()),
        }
    }

    pub fn save_checkpoints(&self, checkpoints: serde_json::Value) -> Result<(), NativeError> {
        let encoded = serde_json::to_vec(&checkpoints)?;
        if encoded.len() > MAX_CHECKPOINT_BYTES {
            return Err(NativeError::InvalidInput(
                "Sync checkpoints exceed the 4 MiB safety limit.".into(),
            ));
        }
        if json_depth(&checkpoints, 0) > 32 {
            return Err(NativeError::InvalidInput(
                "Sync checkpoints are nested too deeply.".into(),
            ));
        }
        self.write("checkpoints-v1.json", &checkpoints)
    }

    pub fn clear(&self) -> Result<(), NativeError> {
        for name in ["config-v1.json", "checkpoints-v1.json"] {
            match fs::remove_file(self.path(name)) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.into()),
            }
        }
        Ok(())
    }

    #[allow(dead_code)]
    pub fn root(&self) -> &Path {
        &self.root
    }
}

fn json_depth(value: &serde_json::Value, depth: usize) -> usize {
    match value {
        serde_json::Value::Array(values) => values
            .iter()
            .map(|value| json_depth(value, depth + 1))
            .max()
            .unwrap_or(depth),
        serde_json::Value::Object(values) => values
            .values()
            .map(|value| json_depth(value, depth + 1))
            .max()
            .unwrap_or(depth),
        _ => depth,
    }
}

#[cfg(not(windows))]
fn replace_file(temporary: &Path, destination: &Path) -> Result<(), NativeError> {
    fs::rename(temporary, destination)?;
    Ok(())
}

#[cfg(windows)]
fn replace_file(temporary: &Path, destination: &Path) -> Result<(), NativeError> {
    use std::os::windows::ffi::OsStrExt;
    let source: Vec<u16> = temporary
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let target: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    // MoveFileExW replaces the destination in one filesystem operation, unlike
    // std::fs::rename on Windows, and WRITE_THROUGH keeps the handoff durable.
    let flags = windows_sys::Win32::Storage::FileSystem::MOVEFILE_REPLACE_EXISTING
        | windows_sys::Win32::Storage::FileSystem::MOVEFILE_WRITE_THROUGH;
    let result = unsafe {
        windows_sys::Win32::Storage::FileSystem::MoveFileExW(
            source.as_ptr(),
            target.as_ptr(),
            flags,
        )
    };
    if result == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_is_versioned_and_atomic() {
        let directory = tempfile::tempdir().unwrap();
        let storage = Storage::new(directory.path().join("state")).unwrap();
        let config = CompanionConfig {
            version: 99,
            logs_root: Some("x".into()),
            screenshots_root: None,
        };
        storage.save_config(config).unwrap();
        storage
            .save_config(CompanionConfig {
                version: 1,
                logs_root: Some("y".into()),
                screenshots_root: None,
            })
            .unwrap();
        let loaded = storage.load_config().unwrap();
        assert_eq!(loaded.version, STATE_VERSION);
        assert_eq!(loaded.logs_root.as_deref(), Some("y"));
        assert!(!storage.path("config-v1.json.json.tmp").exists());
        let first = serde_json::json!({"logs":{"profileKey":"p","offsets":{"a":4}},"context":{"partyId":null}});
        let second = serde_json::json!({"logs":{"offsets":{"a":5}},"context":{"map":"Customs"}});
        storage.save_checkpoints(first).unwrap();
        storage.save_checkpoints(second.clone()).unwrap();
        assert_eq!(storage.load_checkpoints().unwrap(), second);
    }
}
