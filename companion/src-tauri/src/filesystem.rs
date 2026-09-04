use crate::error::NativeError;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    fs::{self, OpenOptions},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

pub const MAX_LOG_FILE_BYTES: u64 = 32 * 1024 * 1024;
pub const MAX_LOG_SCAN_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_SCREENSHOT_FILE_BYTES: u64 = MAX_LOG_FILE_BYTES;
pub const MAX_SCREENSHOT_METADATA: usize = 4096;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    pub path: String,
    pub relative_path: String,
    pub relative_filename: String,
    pub filename: String,
    pub name: String,
    pub size: u64,
    pub last_modified: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogRead {
    pub path: String,
    pub offset: u64,
    pub next_offset: u64,
    pub bytes_read: u64,
    pub text: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub files: Vec<FileMetadata>,
    pub total_bytes: u64,
}

#[cfg(windows)]
fn is_reparse(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x400 != 0 // FILE_ATTRIBUTE_REPARSE_POINT
}

#[cfg(not(windows))]
fn is_reparse(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

fn reject_link(_path: &Path, metadata: &fs::Metadata) -> Result<(), NativeError> {
    if metadata.file_type().is_symlink() || is_reparse(metadata) {
        return Err(NativeError::InvalidInput(
            "Links and reparse points are not allowed in EFT folders.".into(),
        ));
    }
    Ok(())
}

/// Canonicalize a user-selected folder and reject links/reparse points at the root.
pub fn canonical_root(input: impl AsRef<Path>) -> Result<PathBuf, NativeError> {
    let input = input.as_ref();
    let metadata = fs::symlink_metadata(input)
        .map_err(|_| NativeError::InvalidInput("The selected EFT folder does not exist.".into()))?;
    reject_link(input, &metadata)?;
    if !metadata.is_dir() {
        return Err(NativeError::InvalidInput(
            "The selected EFT path is not a folder.".into(),
        ));
    }
    let canonical = fs::canonicalize(input)?;
    let canonical_metadata = fs::metadata(&canonical)?;
    reject_link(&canonical, &canonical_metadata)?;
    Ok(canonical)
}

/// Resolve a child and enforce that its canonical path remains below `root`.
pub fn confined_path(root: &Path, child: impl AsRef<Path>) -> Result<PathBuf, NativeError> {
    // The JS boundary receives only the relative identifiers returned by an
    // enumeration. Accepting absolute input would unnecessarily widen a
    // compromised webview's filesystem oracle, even with the containment check.
    if child.as_ref().is_absolute() {
        return Err(NativeError::OutsideRoot);
    }
    let candidate_owned = root.join(child.as_ref());
    let candidate = &candidate_owned;
    let canonical = fs::canonicalize(candidate).map_err(|_| NativeError::OutsideRoot)?;
    let root = fs::canonicalize(root).map_err(|_| NativeError::NotConfigured)?;
    if !canonical.starts_with(&root) {
        return Err(NativeError::OutsideRoot);
    }
    let metadata = fs::symlink_metadata(candidate).map_err(|_| NativeError::OutsideRoot)?;
    reject_link(candidate, &metadata).map_err(|_| NativeError::OutsideRoot)?;
    let canonical_metadata = fs::metadata(&canonical).map_err(|_| NativeError::OutsideRoot)?;
    reject_link(&canonical, &canonical_metadata).map_err(|_| NativeError::OutsideRoot)?;
    Ok(canonical)
}

fn modified_ms(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0)
}

fn metadata(root: &Path, path: &Path, file_metadata: &fs::Metadata) -> FileMetadata {
    let relative_path = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");
    FileMetadata {
        // Child paths are intentionally relative; absolute local paths must not
        // cross the JS boundary or be persisted in sync checkpoints.
        path: relative_path.clone(),
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        relative_filename: relative_path,
        filename: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        last_modified: modified_ms(file_metadata),
        relative_path: path
            .strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/"),
        size: file_metadata.len(),
    }
}

fn relevant_log_name(name: &str) -> bool {
    let candidate = name
        .rsplit_once(' ')
        .map(|(_, suffix)| suffix)
        .unwrap_or(name);
    let lower = candidate.to_ascii_lowercase();
    if [
        "notifications.log",
        "push-notifications.log",
        "backend.log",
        "application.log",
    ]
    .iter()
    .any(|exact| lower == *exact)
    {
        return true;
    }
    [
        "notifications",
        "push-notifications",
        "backend",
        "application",
    ]
    .iter()
    .any(|prefix| {
        lower
            .strip_prefix(prefix)
            .and_then(|tail| tail.strip_suffix(".log"))
            .map(|tail| {
                !tail.is_empty()
                    && tail
                        .chars()
                        .all(|c| c.is_ascii_digit() || c == '_' || c == '-')
            })
            .unwrap_or(false)
    })
}

fn walk_logs(
    root: &Path,
    current: &Path,
    result: &mut Vec<FileMetadata>,
) -> Result<(), NativeError> {
    let entries = fs::read_dir(current)?;
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        let link_metadata = fs::symlink_metadata(&path)?;
        if link_metadata.file_type().is_symlink() || is_reparse(&link_metadata) {
            continue;
        }
        if link_metadata.is_dir() {
            walk_logs(root, &path, result)?;
        } else if link_metadata.is_file() && relevant_log_name(&entry.file_name().to_string_lossy())
        {
            // `confined_path` deliberately rejects absolute input received at
            // the command boundary. `read_dir` yields absolute paths here, so
            // translate the trusted walker result back to a relative child
            // before applying the same containment and reparse checks.
            let relative = match path.strip_prefix(root) {
                Ok(relative) => relative,
                Err(_) => continue,
            };
            let canonical = match confined_path(root, relative) {
                Ok(path) => path,
                Err(_) => continue,
            };
            let file_metadata = fs::metadata(&canonical)?;
            if file_metadata.len() > MAX_LOG_FILE_BYTES {
                return Err(NativeError::InvalidInput(format!(
                    "An EFT log exceeds the 32 MiB per-file safety limit in '{}'.",
                    root.display()
                )));
            }
            result.push(metadata(root, &canonical, &file_metadata));
        }
    }
    Ok(())
}

pub fn enumerate_logs(root: impl AsRef<Path>) -> Result<ScanResult, NativeError> {
    let root = canonical_root(root)?;
    let mut files = Vec::new();
    walk_logs(&root, &root, &mut files)?;
    // EFT puts each session in a timestamped top-level folder. Keep complete
    // newest sessions, dropping whole oldest sessions until the bounded scan
    // fits. Folder names sort chronologically for EFT's log_YYYY.MM.DD... form.
    let mut sessions: BTreeMap<String, Vec<FileMetadata>> = BTreeMap::new();
    for file in files {
        let session = file.path.split('/').next().unwrap_or(&file.path).to_owned();
        sessions.entry(session).or_default().push(file);
    }
    let mut kept = Vec::new();
    let mut total_bytes = 0;
    for (_session, mut session_files) in sessions.into_iter().rev() {
        let session_bytes: u64 = session_files.iter().map(|file| file.size).sum();
        let remaining = MAX_LOG_SCAN_BYTES.saturating_sub(total_bytes);
        if session_bytes <= remaining {
            total_bytes += session_bytes;
            kept.extend(session_files);
            continue;
        }
        if session_bytes <= MAX_LOG_SCAN_BYTES {
            continue;
        }

        // A single session can exceed the whole scan cap when EFT rotates many
        // component logs. Keeping none of it and filling the budget with older
        // sessions reverses the newest-first contract. This is the one case
        // where a partial session is preferable: retain its newest individual
        // files until the remaining budget is exhausted.
        session_files.sort_by(|left, right| {
            right
                .last_modified
                .cmp(&left.last_modified)
                .then_with(|| right.path.cmp(&left.path))
        });
        for file in session_files {
            if file.size <= MAX_LOG_SCAN_BYTES.saturating_sub(total_bytes) {
                total_bytes += file.size;
                kept.push(file);
            }
            if total_bytes == MAX_LOG_SCAN_BYTES {
                break;
            }
        }
    }
    kept.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(ScanResult {
        files: kept,
        total_bytes,
    })
}

fn is_number(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty() && value.parse::<f64>().is_ok() && value.contains('.')
}

/// A bounded filename-only validation matching EFT's timestamp/position shape.
pub fn valid_screenshot_filename(name: &str) -> bool {
    if name.is_empty()
        || name.len() > 512
        || !name.is_ascii()
        || name
            .chars()
            .any(|character| matches!(character, '/' | '\\' | '\0'))
        || !name.to_ascii_lowercase().ends_with(".png")
    {
        return false;
    }
    let stem = &name[..name.len() - 4];
    let bytes = stem.as_bytes();
    if bytes.len() < 17
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'['
        || bytes[13] != b'-'
    {
        return false;
    }
    if !stem[0..4].chars().all(|c| c.is_ascii_digit())
        || !stem[5..7].chars().all(|c| c.is_ascii_digit())
        || !stem[8..10].chars().all(|c| c.is_ascii_digit())
    {
        return false;
    }
    let month = stem[5..7].parse::<u32>().unwrap_or(0);
    let day = stem[8..10].parse::<u32>().unwrap_or(0);
    let hour = stem[11..13].parse::<u32>().unwrap_or(99);
    let minute = stem[14..16].parse::<u32>().unwrap_or(99);
    let (timestamp_end, second) = match bytes[16] {
        b']' => (17, 0),
        b'-' if bytes.len() >= 20
            && bytes[19] == b']'
            && stem[17..19].chars().all(|c| c.is_ascii_digit()) =>
        {
            (20, stem[17..19].parse::<u32>().unwrap_or(99))
        }
        _ => return false,
    };
    let year = stem[0..4].parse::<i32>().unwrap_or(0);
    let days_in_month = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        _ => 0,
    };
    if year < 1 || day == 0 || day > days_in_month || hour > 23 || minute > 59 || second > 59 {
        return false;
    }
    let payload = stem[timestamp_end..].trim_start_matches(['_', ' ']);
    let payload = payload
        .split_once([' ', '_'])
        .filter(|(prefix, _rest)| {
            let version = prefix.strip_prefix('v').unwrap_or(prefix);
            version.contains('.') && version.parse::<f64>().is_ok()
        })
        .map(|(_, rest)| rest)
        .unwrap_or(payload);
    let numeric = payload.replace('_', ",");
    let values: Vec<&str> = numeric
        .split([',', ' '])
        .filter(|value| !value.is_empty())
        .collect();
    values.len() >= 7 && values.iter().take(7).all(|value| is_number(value))
}

fn walk_screenshots(root: &Path, result: &mut Vec<FileMetadata>) -> Result<(), NativeError> {
    // Deliberately top-level only: subfolders and links are never inspected.
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        let link_metadata = fs::symlink_metadata(&path)?;
        if link_metadata.file_type().is_symlink()
            || is_reparse(&link_metadata)
            || !link_metadata.is_file()
        {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if !valid_screenshot_filename(&name) || link_metadata.len() > MAX_SCREENSHOT_FILE_BYTES {
            continue;
        }
        let relative = match path.strip_prefix(root) {
            Ok(relative) => relative,
            Err(_) => continue,
        };
        let canonical = match confined_path(root, relative) {
            Ok(path) => path,
            Err(_) => continue,
        };
        result.push(metadata(root, &canonical, &link_metadata));
        if result.len() >= MAX_SCREENSHOT_METADATA {
            break;
        }
    }
    Ok(())
}

pub fn enumerate_screenshots(root: impl AsRef<Path>) -> Result<Vec<FileMetadata>, NativeError> {
    let root = canonical_root(root)?;
    let mut result = Vec::new();
    walk_screenshots(&root, &mut result)?;
    result.sort_by(|a, b| {
        a.name
            .cmp(&b.name)
            .then(a.last_modified.cmp(&b.last_modified))
    });
    Ok(result)
}

pub fn read_log_at_offset(
    root: impl AsRef<Path>,
    path: impl AsRef<Path>,
    offset: u64,
) -> Result<LogRead, NativeError> {
    let root = canonical_root(root)?;
    let path = confined_path(&root, path)?;
    let metadata = fs::metadata(&path)?;
    if !metadata.is_file()
        || metadata.len() > MAX_LOG_FILE_BYTES
        || !relevant_log_name(&path.file_name().unwrap_or_default().to_string_lossy())
    {
        return Err(NativeError::InvalidInput(
            "The requested file is not a bounded EFT log.".into(),
        ));
    }
    if offset > metadata.len() {
        return Err(NativeError::InvalidInput(
            "The log checkpoint is beyond the end of the file.".into(),
        ));
    }
    let mut file = OpenOptions::new().read(true).open(&path)?;
    file.seek(SeekFrom::Start(offset))?;
    let mut bytes = Vec::with_capacity((metadata.len() - offset) as usize);
    file.read_to_end(&mut bytes)?;
    let next_offset = offset + bytes.len() as u64;
    let relative_path = path
        .strip_prefix(&root)
        .unwrap_or(&path)
        .to_string_lossy()
        .replace('\\', "/");
    Ok(LogRead {
        path: relative_path,
        offset,
        next_offset,
        bytes_read: bytes.len() as u64,
        text: String::from_utf8_lossy(&bytes).into_owned(),
    })
}

pub fn read_logs_at_offsets(
    root: impl AsRef<Path>,
    offsets: &HashMap<String, u64>,
) -> Result<Vec<LogRead>, NativeError> {
    let root = canonical_root(root)?;
    let scan = enumerate_logs(&root)?;
    let mut total: u64 = 0;
    let mut reads = Vec::new();
    for file in scan.files {
        let offset = offsets.get(&file.path).copied().unwrap_or(0);
        let remaining = file.size.saturating_sub(offset);
        total = total.checked_add(remaining).ok_or_else(|| {
            NativeError::InvalidInput(format!(
                "The EFT log scan size overflowed while reading '{}'.",
                root.display()
            ))
        })?;
        if total > MAX_LOG_SCAN_BYTES {
            return Err(NativeError::InvalidInput(format!(
                "The remaining EFT log data in '{}' exceeds the 256 MiB scan safety limit.",
                root.display()
            )));
        }
        reads.push(read_log_at_offset(&root, &file.path, offset)?);
    }
    Ok(reads)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn enumeration_keeps_confined_files_found_by_the_native_walker() {
        let directory = tempfile::tempdir().unwrap();
        let session = directory
            .path()
            .join("log_2026.08.28_12-32-39_1.1.0.1.46911");
        std::fs::create_dir(&session).unwrap();
        std::fs::write(
            session.join("2026.08.28_12-32-39_1.1.0.1.46911 push-notifications_000.log"),
            b"notification",
        )
        .unwrap();
        std::fs::write(
            session.join("2026.08.28_12-32-39_1.1.0.1.46911 backend_000.log"),
            b"context",
        )
        .unwrap();
        std::fs::write(session.join("output_000.log"), b"ignored").unwrap();

        let scan = enumerate_logs(directory.path()).unwrap();

        assert_eq!(scan.files.len(), 2);
        assert_eq!(scan.total_bytes, 19);
        assert!(scan
            .files
            .iter()
            .all(|file| !Path::new(&file.path).is_absolute()));
        assert!(scan.files.iter().all(|file| file
            .path
            .starts_with("log_2026.08.28_12-32-39_1.1.0.1.46911/")));
    }

    #[test]
    fn enumeration_drops_oldest_sessions_to_fit_the_scan_cap() {
        let directory = tempfile::tempdir().unwrap();
        let sessions = [
            "log_2026.08.28_12-32-39_1.1.0.1.46911",
            "log_2026.08.29_12-32-39_1.1.0.1.46911",
            "log_2026.08.30_12-32-39_1.1.0.1.46911",
        ];
        for session in sessions {
            let path = directory.path().join(session);
            std::fs::create_dir(&path).unwrap();
            for name in [
                "notifications.log",
                "backend.log",
                "application.log",
                "push-notifications.log",
            ] {
                let file = std::fs::File::create(path.join(name)).unwrap();
                file.set_len(25 * 1024 * 1024).unwrap();
            }
        }

        let scan = enumerate_logs(directory.path()).unwrap();

        assert_eq!(scan.total_bytes, 200 * 1024 * 1024);
        assert!(scan
            .files
            .iter()
            .all(|file| !file.path.starts_with(sessions[0])));
        assert!(scan
            .files
            .iter()
            .any(|file| file.path.starts_with(sessions[1])));
        assert!(scan
            .files
            .iter()
            .any(|file| file.path.starts_with(sessions[2])));
    }

    #[test]
    fn enumeration_keeps_newest_files_when_one_session_exceeds_the_scan_cap() {
        let directory = tempfile::tempdir().unwrap();
        let older = "log_2026.08.29_12-32-39_1.1.0.1.46911";
        let newest = "log_2026.08.30_12-32-39_1.1.0.1.46911";
        for (session, count, bytes) in [
            (older, 4, 25 * 1024 * 1024),
            (newest, 9, MAX_LOG_FILE_BYTES),
        ] {
            let path = directory.path().join(session);
            std::fs::create_dir(&path).unwrap();
            for index in 0..count {
                let file =
                    std::fs::File::create(path.join(format!("notifications_{index}.log"))).unwrap();
                file.set_len(bytes).unwrap();
            }
        }

        let scan = enumerate_logs(directory.path()).unwrap();

        assert_eq!(scan.total_bytes, MAX_LOG_SCAN_BYTES);
        assert_eq!(scan.files.len(), 8);
        assert!(scan.files.iter().all(|file| file.path.starts_with(newest)));
    }

    #[test]
    fn oversized_log_error_names_the_folder_and_real_limit() {
        let directory = tempfile::tempdir().unwrap();
        let session = directory
            .path()
            .join("log_2026.08.30_12-32-39_1.1.0.1.46911");
        std::fs::create_dir(&session).unwrap();
        let file = std::fs::File::create(session.join("notifications.log")).unwrap();
        file.set_len(MAX_LOG_FILE_BYTES + 1).unwrap();

        let error = enumerate_logs(directory.path()).unwrap_err().to_string();

        assert!(error.contains("32 MiB per-file safety limit"));
        assert!(error.contains(directory.path().to_string_lossy().as_ref()));
    }

    #[test]
    fn screenshot_enumeration_keeps_a_confined_top_level_image() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(
            directory
                .path()
                .join("2026-08-27[12-34-56]1.2,3.4,5.6_0.1,0.2,0.3,0.4.png"),
            b"png",
        )
        .unwrap();

        let scan = enumerate_screenshots(directory.path()).unwrap();

        assert_eq!(scan.len(), 1);
        assert!(!Path::new(&scan[0].path).is_absolute());
    }

    #[test]
    fn screenshot_validation_never_needs_image_bytes() {
        assert!(valid_screenshot_filename(
            "2026-08-27[12-34]1.2, 3.4, 5.6_0.1, 0.2, 0.3, 0.4.png"
        ));
        assert!(valid_screenshot_filename(
            "2026-08-27[12-34-56]1.2, 3.4, 5.6_0.1, 0.2, 0.3, 0.4.png"
        ));
    }

    #[test]
    fn reads_only_from_checkpoint_and_rejects_oversized_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("backend.log");
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(b"prefixsuffix").unwrap();
        let read = read_log_at_offset(directory.path(), "backend.log", 6).unwrap();
        assert_eq!(read.text, "suffix");
        assert_eq!(read.next_offset, 12);
        assert!(read_log_at_offset(directory.path(), &path, 0).is_err());
    }

    #[test]
    fn malformed_unicode_screenshot_name_is_rejected_without_panicking() {
        assert!(!valid_screenshot_filename(
            "202💥-08-27[12-34]1.2,3.4,5.6_0.1,0.2,0.3,0.4.png"
        ));
    }
}
