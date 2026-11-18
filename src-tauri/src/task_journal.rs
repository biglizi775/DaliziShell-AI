//! Durable JSONL records shared by file actions and SFTP transfers.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
use std::os::windows::io::AsRawHandle;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use windows::Win32::Foundation::{BOOLEAN, HANDLE};
use windows::Win32::Storage::FileSystem::{
    FileDispositionInfo, SetFileInformationByHandle, FILE_DISPOSITION_INFO,
    FILE_FLAG_OPEN_REPARSE_POINT,
};
const MAX_BYTES: u64 = 2 * 1024 * 1024;
pub(crate) const INVALID: &str = "操作记录格式异常 / Invalid file operation record";
pub(crate) const BUSY: &str =
    "记录正在使用或无法访问，请刷新后重试 / Record busy or unavailable. Refresh and retry";

pub(crate) fn new_id() -> String {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{ms:020}-{}", uuid::Uuid::new_v4())
}
pub(crate) fn valid_id(id: &str) -> bool {
    let Some((stamp, uuid)) = id.split_once('-') else {
        return false;
    };
    stamp.len() == 20
        && stamp.bytes().all(|b| b.is_ascii_digit())
        && stamp.parse::<u64>().is_ok()
        && uuid.len() == 36
        && uuid::Uuid::parse_str(uuid).is_ok_and(|parsed| parsed.to_string() == uuid)
}
pub(crate) fn line(file: &mut File, value: &impl Serialize) -> Result<(), String> {
    let mut bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())
}
fn read_bytes(file: &File) -> Result<Vec<u8>, String> {
    read_bounded(file, MAX_BYTES)
}
pub(crate) fn read_bounded(file: &File, limit: u64) -> Result<Vec<u8>, String> {
    let meta = file.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.file_attributes() & 0x400 != 0 || meta.len() > limit {
        return Err(INVALID.into());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err(INVALID.into());
    }
    Ok(bytes)
}
pub(crate) fn read_journal(path: &Path) -> Result<(Vec<u8>, bool), String> {
    let open = |share| {
        OpenOptions::new()
            .read(true)
            .share_mode(share)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
            .open(path)
    };
    let (file, live) = match open(1) {
        Ok(f) => (f, false),
        Err(e) if e.raw_os_error() == Some(32) => (open(3).map_err(|e| e.to_string())?, true),
        Err(e) => return Err(e.to_string()),
    };
    Ok((read_bytes(&file)?, live))
}
pub(crate) fn remove_journal(path: &Path, revision: &str) -> Result<(), String> {
    remove_bounded(path, revision, MAX_BYTES)
}
pub(crate) fn remove_bounded(path: &Path, revision: &str, limit: u64) -> Result<(), String> {
    let file = OpenOptions::new()
        .access_mode(0x80000000 | 0x10000)
        .share_mode(0)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(path)
        .map_err(|e| format!("{BUSY}: {e}"))?;
    if format!("{:x}", Sha256::digest(read_bounded(&file, limit)?)) != revision {
        return Err("记录已变化，请刷新 / Record changed. Refresh first.".into());
    }
    let disposition = FILE_DISPOSITION_INFO {
        DeleteFile: BOOLEAN(1),
    };
    // Delete the exact verified handle; a changed path cannot select a different file.
    unsafe {
        SetFileInformationByHandle(
            HANDLE(file.as_raw_handle()),
            FileDispositionInfo,
            (&disposition as *const FILE_DISPOSITION_INFO).cast(),
            std::mem::size_of_val(&disposition) as u32,
        )
    }
    .map_err(|e| e.to_string())
}
