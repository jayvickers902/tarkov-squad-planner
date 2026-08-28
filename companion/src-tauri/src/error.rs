use std::fmt::{Display, Formatter};

/// Errors returned by native commands are deliberately stable and descriptive.
/// They are safe to show in the UI and never include file contents.
#[derive(Debug)]
pub enum NativeError {
    InvalidInput(String),
    OutsideRoot,
    Io(std::io::Error),
    Json(serde_json::Error),
    Credential(String),
    NotConfigured,
    Watch(String),
}

impl Display for NativeError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidInput(message) => write!(f, "{message}"),
            Self::OutsideRoot => {
                write!(f, "The selected path is outside its configured EFT folder.")
            }
            Self::Io(error) => write!(f, "Native filesystem error: {error}"),
            Self::Json(error) => write!(f, "Local state could not be decoded: {error}"),
            Self::Credential(message) => write!(f, "Credential store error: {message}"),
            Self::NotConfigured => write!(f, "Choose an EFT Logs or Screenshots folder first."),
            Self::Watch(message) => write!(f, "Filesystem watcher error: {message}"),
        }
    }
}

impl std::error::Error for NativeError {}

impl From<std::io::Error> for NativeError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for NativeError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

impl From<NativeError> for String {
    fn from(error: NativeError) -> Self {
        error.to_string()
    }
}
