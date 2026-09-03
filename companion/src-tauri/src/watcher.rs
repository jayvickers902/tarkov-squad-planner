use crate::{
    error::NativeError,
    filesystem::{canonical_root, confined_path},
};
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::mpsc::{self, RecvTimeoutError},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

pub const DEBOUNCE: Duration = Duration::from_millis(100);
pub const FALLBACK_INTERVAL: Duration = Duration::from_secs(15);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEvent {
    pub kind: String,
    pub paths: Vec<String>,
    pub fallback: bool,
}

pub struct WatchSession {
    stop: mpsc::Sender<()>,
    _thread: Option<thread::JoinHandle<()>>,
}

impl WatchSession {
    pub fn stop(mut self) {
        let _ = self.stop.send(());
        if let Some(thread) = self._thread.take() {
            let _ = thread.join();
        }
    }
}

pub fn start(
    app: AppHandle,
    logs_root: Option<PathBuf>,
    screenshots_root: Option<PathBuf>,
) -> Result<WatchSession, NativeError> {
    let logs_root = logs_root.map(canonical_root).transpose()?;
    let screenshots_root = screenshots_root.map(canonical_root).transpose()?;
    if logs_root.is_none() && screenshots_root.is_none() {
        return Err(NativeError::NotConfigured);
    }
    let (stop, stop_rx) = mpsc::channel();
    let (event_tx, event_rx) = mpsc::channel();
    let watch_roots = [logs_root.clone(), screenshots_root.clone()]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    let thread = thread::Builder::new()
        .name("eft-filesystem-watcher".into())
        .spawn(move || {
            let callback_tx = event_tx.clone();
            let mut watcher = match RecommendedWatcher::new(
                move |event| {
                    let _ = callback_tx.send(event);
                },
                Config::default(),
            ) {
                Ok(watcher) => watcher,
                Err(_error) => {
                    let _ = app.emit(
                        "native-fs-event",
                        FsEvent {
                            kind: "error".into(),
                            paths: Vec::new(),
                            fallback: false,
                        },
                    );
                    return;
                }
            };
            for root in &watch_roots {
                if let Err(_error) = watcher.watch(root, RecursiveMode::Recursive) {
                    let _ = app.emit(
                        "native-fs-event",
                        FsEvent {
                            kind: "error".into(),
                            paths: Vec::new(),
                            fallback: false,
                        },
                    );
                }
            }
            let mut last_fallback = Instant::now();
            loop {
                match stop_rx.try_recv() {
                    Ok(()) | Err(mpsc::TryRecvError::Disconnected) => break,
                    Err(mpsc::TryRecvError::Empty) => {}
                }
                let mut events = Vec::new();
                match event_rx.recv_timeout(DEBOUNCE) {
                    Ok(event) => {
                        events.push(event);
                        while let Ok(event) = event_rx.recv_timeout(DEBOUNCE) {
                            events.push(event);
                        }
                    }
                    Err(RecvTimeoutError::Disconnected) => break,
                    Err(RecvTimeoutError::Timeout) => {}
                }
                if last_fallback.elapsed() >= FALLBACK_INTERVAL {
                    let _ = app.emit(
                        "native-fs-event",
                        FsEvent {
                            kind: "fallback".into(),
                            paths: Vec::new(),
                            fallback: true,
                        },
                    );
                    last_fallback = Instant::now();
                }
                if events.is_empty() {
                    continue;
                }
                let mut paths = Vec::new();
                let mut kinds = Vec::new();
                for result in events {
                    match result {
                        Ok(Event {
                            kind,
                            paths: event_paths,
                            ..
                        }) => {
                            kinds.push(format!("{kind:?}"));
                            for path in event_paths {
                                if path_allowed(&path, logs_root.as_deref())
                                    || path_allowed(&path, screenshots_root.as_deref())
                                {
                                    if let Some(value) = event_key(
                                        &path,
                                        logs_root.as_deref(),
                                        screenshots_root.as_deref(),
                                    ) {
                                        if !paths.contains(&value) {
                                            paths.push(value);
                                        }
                                    }
                                }
                            }
                        }
                        Err(_error) => kinds.push("error".into()),
                    }
                }
                if !paths.is_empty() {
                    let _ = app.emit(
                        "native-fs-event",
                        FsEvent {
                            kind: kinds.join(","),
                            paths,
                            fallback: false,
                        },
                    );
                }
            }
        })
        .map_err(|error| NativeError::Watch(error.to_string()))?;
    Ok(WatchSession {
        stop,
        _thread: Some(thread),
    })
}

fn path_allowed(path: &std::path::Path, root: Option<&std::path::Path>) -> bool {
    let Some(root) = root else { return false };
    if !path.starts_with(root) {
        return false;
    }
    // Existing paths are canonicalized to detect symlink/reparse escapes. A removed
    // file is allowed through by lexical containment so the JS layer can reconcile.
    if path.exists() {
        return confined_path(root, path).is_ok();
    }
    path.parent()
        .map(|parent| parent.starts_with(root) && confined_path(root, parent).is_ok())
        .unwrap_or(false)
}

fn event_key(
    path: &std::path::Path,
    logs_root: Option<&std::path::Path>,
    screenshots_root: Option<&std::path::Path>,
) -> Option<String> {
    if let Some(root) = logs_root.filter(|root| path.starts_with(root)) {
        return Some(format!(
            "logs/{}",
            path.strip_prefix(root)
                .ok()?
                .to_string_lossy()
                .replace('\\', "/")
        ));
    }
    if let Some(root) = screenshots_root.filter(|root| path.starts_with(root)) {
        return Some(format!(
            "screenshots/{}",
            path.strip_prefix(root)
                .ok()?
                .to_string_lossy()
                .replace('\\', "/")
        ));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_coalescing_window_is_short() {
        assert_eq!(DEBOUNCE, Duration::from_millis(100));
    }
}
