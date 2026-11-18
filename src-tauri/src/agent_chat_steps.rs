//! Receipt files supplement the public 0.5.1 chat format. Never attach receipts
//! to a different transcript, even if an older program reuses an ID or revision.
use super::{
    local_metadata, validate, Conversation, File, History, MetadataExt, OpenOptions,
    OpenOptionsExt, Path, Read, Storage, ToolStep, Write, RECORD_LIMIT,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
};

const PREFIX: &str = "chat-steps-v1-";
const MAX: usize = RECORD_LIMIT + 4096;
const INVALID: &str =
    "操作步骤附件无效，聊天正文仍在主档案中 / Invalid receipt attachment; transcript preserved";
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Receipts {
    version: u8,
    transcript: String,
    messages: BTreeMap<String, Vec<ToolStep>>,
}
fn digest(chat: &Conversation) -> Result<String, String> {
    let mut hash = Sha256::new();
    serde_json::to_writer(&mut hash, chat).map_err(|e| e.to_string())?;
    Ok(format!("{:x}", hash.finalize()))
}
fn filename(digest: &str) -> String {
    format!("{PREFIX}{digest}.json")
}

pub(super) fn separate(history: &mut History) -> Result<Vec<(String, Vec<u8>)>, String> {
    let mut out = Vec::new();
    for chat in &mut history.conversations {
        let messages: BTreeMap<_, _> = chat
            .snapshot
            .messages
            .iter_mut()
            .filter(|m| !m.steps.is_empty())
            .map(|m| (m.id.clone(), std::mem::take(&mut m.steps)))
            .collect();
        if messages.is_empty() {
            continue;
        }
        let transcript = digest(chat)?;
        let name = filename(&transcript);
        let data = serde_json::to_vec(&Receipts {
            version: 1,
            transcript,
            messages,
        })
        .map_err(|e| e.to_string())?;
        if data.len() > MAX {
            return Err(INVALID.into());
        }
        out.push((name, data));
    }
    Ok(out)
}

fn read_file(path: &Path) -> Result<Option<Vec<u8>>, String> {
    if local_metadata(path, false)?.is_none() {
        return Ok(None);
    }
    let file = OpenOptions::new()
        .read(true)
        .share_mode(1)
        .custom_flags(0x0020_0000)
        .open(path)
        .map_err(|e| e.to_string())?;
    let meta = file.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.file_attributes() & 0x400 != 0 || meta.len() > MAX as u64 {
        return Err(INVALID.into());
    }
    let mut data = Vec::new();
    file.take((MAX + 1) as u64)
        .read_to_end(&mut data)
        .map_err(|e| e.to_string())?;
    if data.len() > MAX {
        return Err(INVALID.into());
    }
    Ok(Some(data))
}
pub(super) fn read_lock(storage: &Storage) -> Result<Option<File>, String> {
    let path = storage.directory.join(".chat-history.lock");
    if storage.directory_guard.is_none() || local_metadata(&path, false)?.is_none() {
        return Ok(None);
    }
    let f = OpenOptions::new()
        .read(true)
        .share_mode(1)
        .custom_flags(0x0020_0000)
        .open(path)
        .map_err(|_| "对话正在保存，请刷新后重试 / Chat storage busy; refresh and retry")?;
    if f.metadata().map_err(|e| e.to_string())?.file_attributes() & 0x400 != 0 {
        return Err(INVALID.into());
    }
    Ok(Some(f))
}
pub(super) fn attach(storage: &Storage, chat: &mut Conversation) -> Result<(), String> {
    if chat.snapshot.messages.iter().any(|m| !m.steps.is_empty()) {
        return Ok(());
    } // early candidate
    let key = digest(chat)?;
    let Some(data) = read_file(&storage.directory.join(filename(&key)))? else {
        return Ok(());
    };
    let mut notes: Receipts = serde_json::from_slice(&data).map_err(|_| INVALID)?;
    if notes.version != 1 || notes.transcript != key || notes.messages.is_empty() {
        return Err(INVALID.into());
    }
    for m in &mut chat.snapshot.messages {
        if let Some(steps) = notes.messages.remove(&m.id) {
            if steps.is_empty() {
                return Err(INVALID.into());
            }
            m.steps = steps;
        }
    }
    if !notes.messages.is_empty() {
        return Err(INVALID.into());
    }
    validate(&chat.snapshot)
}
pub(super) fn publish_new(storage: &Storage, path: &Path, data: &[u8]) -> Result<bool, String> {
    if let Some(existing) = read_file(path)? {
        if existing == data {
            return Ok(false);
        }
        return Err("同一版对话已有不同步骤，原文件已保留 / Conflicting receipts preserved".into());
    }
    // Same volume, flush before rename, no replacing existing files.
    let mut tmp = tempfile::NamedTempFile::new_in(&storage.directory).map_err(|e| e.to_string())?;
    tmp.write_all(data)
        .and_then(|_| tmp.as_file().sync_all())
        .map_err(|e| e.to_string())?;
    tmp.persist_noclobber(path).map_err(|e| e.to_string())?;
    Ok(true)
}
pub(super) fn prune(storage: &Storage, history: &History) {
    // Only collect recognisable, previously owned files after the v1 commit.
    // A file locked by another program is retried on the next successful save.
    let Ok(live) = history
        .conversations
        .iter()
        .map(|c| digest(c).map(|s| filename(&s)))
        .collect::<Result<HashSet<_>, _>>()
    else {
        return;
    };
    let Ok(entries) = fs::read_dir(&storage.directory) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        let Some(key) = name
            .strip_prefix(PREFIX)
            .and_then(|s| s.strip_suffix(".json"))
        else {
            continue;
        };
        if live.contains(name)
            || key.len() != 64
            || !key
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            continue;
        }
        let path = entry.path();
        if let Ok(Some(bytes)) = read_file(&path) {
            if serde_json::from_slice::<Receipts>(&bytes)
                .is_ok_and(|n| n.version == 1 && n.transcript == key)
            {
                let _ = fs::remove_file(path);
            }
        }
    }
}
