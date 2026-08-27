use crate::error::NativeError;
use std::time::{SystemTime, UNIX_EPOCH};

const SERVICE: &str = "net.dudgy.tarkov-squad-planner-companion";
const MAX_SECRET_BYTES: usize = 64 * 1024;
// Windows Credential Manager limits a generic credential blob to 2,560 bytes.
// keyring encodes passwords as UTF-16, so leave comfortable room for every
// chunk instead of relying on the native limit.
const CHUNK_UTF16_UNITS: usize = 1_000;
const CHUNK_MANIFEST_PREFIX: &str = "tsp-chunks-v1";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ChunkManifest {
    generation: u128,
    count: usize,
}

fn stable_account_id(account: &str) -> u64 {
    account
        .as_bytes()
        .iter()
        .fold(0xcbf29ce484222325_u64, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
        })
}

fn chunk_account(account: &str, generation: u128, index: usize) -> String {
    format!(
        "tsp-chunk-{:016x}-{generation:032x}-{index:04}",
        stable_account_id(account)
    )
}

fn chunk_manifest(manifest: ChunkManifest) -> String {
    format!(
        "{CHUNK_MANIFEST_PREFIX}:{:032x}:{}",
        manifest.generation, manifest.count
    )
}

fn parse_chunk_manifest(value: &str) -> Option<ChunkManifest> {
    let mut parts = value.split(':');
    if parts.next()? != CHUNK_MANIFEST_PREFIX {
        return None;
    }
    let generation = u128::from_str_radix(parts.next()?, 16).ok()?;
    let count = parts.next()?.parse::<usize>().ok()?;
    if parts.next().is_some() || count == 0 || count > 128 {
        return None;
    }
    Some(ChunkManifest { generation, count })
}

fn split_secret(secret: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut chunk = String::new();
    let mut utf16_units = 0;

    for character in secret.chars() {
        let character_units = character.len_utf16();
        if utf16_units + character_units > CHUNK_UTF16_UNITS && !chunk.is_empty() {
            chunks.push(std::mem::take(&mut chunk));
            utf16_units = 0;
        }
        chunk.push(character);
        utf16_units += character_units;
    }
    if !chunk.is_empty() {
        chunks.push(chunk);
    }
    chunks
}

fn read_direct(account: &str) -> Result<Option<String>, NativeError> {
    match entry(account)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(error) if matches!(error, keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(NativeError::Credential(error.to_string())),
    }
}

fn delete_direct(account: &str) -> Result<(), NativeError> {
    match entry(account)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(error) if matches!(error, keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(NativeError::Credential(error.to_string())),
    }
}

fn delete_chunks(account: &str, manifest: ChunkManifest) -> Result<(), NativeError> {
    for index in 0..manifest.count {
        delete_direct(&chunk_account(account, manifest.generation, index))?;
    }
    Ok(())
}

fn entry(account: &str) -> Result<keyring::Entry, NativeError> {
    if account.is_empty()
        || account.len() > 256
        || account.chars().any(|character| character.is_control())
    {
        return Err(NativeError::InvalidInput(
            "The credential account name is invalid.".into(),
        ));
    }
    keyring::Entry::new(SERVICE, account)
        .map_err(|error| NativeError::Credential(error.to_string()))
}

pub fn get(account: &str) -> Result<Option<String>, NativeError> {
    let Some(value) = read_direct(account)? else {
        return Ok(None);
    };
    let Some(manifest) = parse_chunk_manifest(&value) else {
        return Ok(Some(value));
    };

    let mut secret = String::new();
    for index in 0..manifest.count {
        let chunk = read_direct(&chunk_account(account, manifest.generation, index))?
            .ok_or_else(|| NativeError::Credential("Secure credential is incomplete.".into()))?;
        secret.push_str(&chunk);
        if secret.len() > MAX_SECRET_BYTES {
            return Err(NativeError::Credential(
                "Secure credential exceeds the supported size.".into(),
            ));
        }
    }
    Ok(Some(secret))
}

pub fn set(account: &str, secret: &str) -> Result<(), NativeError> {
    if secret.len() > MAX_SECRET_BYTES {
        return Err(NativeError::InvalidInput(
            "The credential is too large.".into(),
        ));
    }

    let previous = read_direct(account)?.and_then(|value| parse_chunk_manifest(&value));
    let chunks = split_secret(secret);
    if chunks.len() <= 1 {
        entry(account)?
            .set_password(secret)
            .map_err(|error| NativeError::Credential(error.to_string()))?;
    } else {
        let generation = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| NativeError::Credential(error.to_string()))?
            .as_nanos();
        let manifest = ChunkManifest {
            generation,
            count: chunks.len(),
        };
        for (index, chunk) in chunks.iter().enumerate() {
            entry(&chunk_account(account, generation, index))?
                .set_password(chunk)
                .map_err(|error| NativeError::Credential(error.to_string()))?;
        }
        // Commit the manifest last so readers never observe a partial new value.
        entry(account)?
            .set_password(&chunk_manifest(manifest))
            .map_err(|error| NativeError::Credential(error.to_string()))?;
    }

    if let Some(previous) = previous {
        delete_chunks(account, previous)?;
    }
    Ok(())
}

pub fn delete(account: &str) -> Result<(), NativeError> {
    if let Some(manifest) = read_direct(account)?.and_then(|value| parse_chunk_manifest(&value)) {
        delete_chunks(account, manifest)?;
    }
    delete_direct(account)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunking_round_trips_unicode_boundaries() {
        let secret = format!("{}😀{}", "a".repeat(999), "b".repeat(1_500));
        let chunks = split_secret(&secret);
        assert_eq!(chunks.concat(), secret);
        assert!(chunks
            .iter()
            .all(|chunk| chunk.encode_utf16().count() <= CHUNK_UTF16_UNITS));
    }

    #[test]
    fn manifest_round_trips() {
        let manifest = ChunkManifest {
            generation: 123_456,
            count: 4,
        };
        assert_eq!(
            parse_chunk_manifest(&chunk_manifest(manifest)),
            Some(manifest)
        );
        assert_eq!(parse_chunk_manifest("ordinary secret"), None);
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "writes and removes a temporary Windows Credential Manager entry"]
    fn windows_keyring_round_trips_pkce_and_large_sessions() {
        let account = format!(
            "auth-storage-self-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time")
                .as_nanos()
        );
        let verifier = "v".repeat(96);
        let session = format!("{{\"access_token\":\"{}\"}}", "t".repeat(6_000));

        set(&account, &verifier).expect("store verifier");
        assert_eq!(get(&account).expect("read verifier"), Some(verifier));
        set(&account, &session).expect("store session");
        assert_eq!(get(&account).expect("read session"), Some(session));
        delete(&account).expect("delete test credential");
        assert_eq!(get(&account).expect("confirm deletion"), None);
    }
}
