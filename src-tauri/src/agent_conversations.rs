//! Explicit, folder-local conversation archives. Stored text carries no tool
//! handles, credentials, permissions or executable plans.
use super::{canonical_root, local_metadata, lock_memory_directory, new_id, validate_local_path};
use serde::{Deserialize, Serialize};
use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

const LIMIT: usize = 8 * 1024 * 1024;
const RECORD_LIMIT: usize = 1024 * 1024;
const COUNT: usize = 30;
static TRANSACTION: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Message {
    pub id: String,
    pub role: String,
    pub text: String,
    pub omit_history: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub id: String,
    pub title: String,
    pub messages: Vec<Message>,
    pub summary: String,
    pub summarized_ids: Vec<String>,
    pub compacted_messages: u32,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Conversation {
    pub snapshot: Snapshot,
    pub revision: u64,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub id: String,
    pub title: String,
    pub revision: u64,
    pub created_at: u64,
    pub updated_at: u64,
    pub message_count: usize,
}
impl From<&Conversation> for Summary {
    fn from(value: &Conversation) -> Self {
        Self {
            id: value.snapshot.id.clone(),
            title: value.snapshot.title.clone(),
            revision: value.revision,
            created_at: value.created_at,
            updated_at: value.updated_at,
            message_count: value.snapshot.messages.len(),
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct History {
    version: u32,
    conversations: Vec<Conversation>,
}
impl Default for History {
    fn default() -> Self {
        Self {
            version: 1,
            conversations: Vec::new(),
        }
    }
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}
fn validate(snapshot: &Snapshot) -> Result<(), String> {
    validate_bounded(snapshot, RECORD_LIMIT)
}
fn validate_bounded(snapshot: &Snapshot, byte_limit: usize) -> Result<(), String> {
    if !valid_id(&snapshot.id)
        || snapshot.title.trim().is_empty()
        || snapshot.title.chars().count() > 120
        || snapshot.title.chars().any(char::is_control)
    {
        return Err("对话标识或标题无效 / Invalid conversation identity or title".into());
    }
    if snapshot.messages.is_empty()
        || snapshot.messages.len() > 60
        || snapshot.summary.chars().count() > 6000
        || snapshot.compacted_messages > 100000
    {
        return Err(
            "对话超出保存范围（最多 60 条消息）/ Conversation exceeds storage limits".into(),
        );
    }
    let mut ids = HashSet::new();
    for message in &snapshot.messages {
        if !valid_id(&message.id)
            || !ids.insert(&message.id)
            || !matches!(message.role.as_str(), "user" | "assistant" | "notice")
            || message.text.chars().count() > 32000
            || message.text.contains('\0')
        {
            return Err("对话消息无效或过长 / Invalid or oversized conversation message".into());
        }
    }
    let mut summarized = HashSet::new();
    if snapshot
        .summarized_ids
        .iter()
        .any(|id| !ids.contains(id) || !summarized.insert(id))
        || (!snapshot.summarized_ids.is_empty() && snapshot.summary.is_empty())
    {
        return Err("对话摘要索引无效 / Invalid summary references".into());
    }
    if serde_json::to_vec(snapshot)
        .map_err(|e| e.to_string())?
        .len()
        > byte_limit
    {
        if byte_limit != RECORD_LIMIT {
            return Err("导出内容超过 8 MiB / Export exceeds 8 MiB".into());
        }
        return Err("单条对话超过 1 MiB，请导出后新建对话 / Conversation exceeds 1 MiB; export and start a new chat".into());
    }
    Ok(())
}

struct Storage {
    root: String,
    directory: PathBuf,
    path: PathBuf,
    _root: File,
    directory_guard: Option<File>,
}
impl Storage {
    fn open(root: &str) -> Result<Self, String> {
        let root = canonical_root(root)?;
        let guard = lock_memory_directory(Path::new(&root))?;
        let directory = Path::new(&root).join(".dalizi");
        let directory_guard = if local_metadata(&directory, true)?.is_some() {
            Some(lock_memory_directory(&directory)?)
        } else {
            None
        };
        Ok(Self {
            path: directory.join("chat-history.json"),
            root,
            directory,
            _root: guard,
            directory_guard,
        })
    }
    fn lock_write(&mut self) -> Result<File, String> {
        validate_local_path(&self.root)?;
        if self.directory_guard.is_none() {
            match fs::create_dir(&self.directory) {
                Ok(()) => (),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
                Err(e) => return Err(e.to_string()),
            }
            self.directory_guard = Some(lock_memory_directory(&self.directory)?);
        }
        let lock = self.directory.join(".chat-history.lock");
        local_metadata(&lock, false)?;
        // The OS lock also serializes separate running application instances.
        let file = OpenOptions::new().read(true).write(true).create(true).truncate(false).share_mode(0).custom_flags(0x00200000).open(lock)
            .map_err(|e| format!("对话库正在使用或无法写入，请重试 / Conversation storage busy or unavailable: {e}"))?;
        if file
            .metadata()
            .map_err(|e| e.to_string())?
            .file_attributes()
            & 0x400
            != 0
        {
            return Err("对话锁路径无效 / Invalid storage lock".into());
        }
        Ok(file)
    }
    fn read(&self) -> Result<History, String> {
        if self.directory_guard.is_none() || local_metadata(&self.path, false)?.is_none() {
            return Ok(History::default());
        }
        let file = OpenOptions::new()
            .read(true)
            .share_mode(1)
            .custom_flags(0x00200000)
            .open(&self.path)
            .map_err(|e| e.to_string())?;
        let metadata = file.metadata().map_err(|e| e.to_string())?;
        if !metadata.is_file()
            || metadata.file_attributes() & 0x400 != 0
            || metadata.len() > LIMIT as u64
        {
            return Err(
                "对话库必须为不超过 8 MiB 的普通文件 / Invalid or oversized chat archive".into(),
            );
        }
        let mut bytes = Vec::new();
        file.take((LIMIT + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > LIMIT {
            return Err("对话库过大 / Chat archive too large".into());
        }
        let value: History = serde_json::from_slice(&bytes).map_err(|_| {
            "对话库格式错误，原文件已保留 / Invalid chat archive; original preserved"
        })?;
        if value.version != 1 || value.conversations.len() > COUNT {
            return Err("不支持的对话库版本或数量 / Unsupported chat archive".into());
        }
        let mut ids = HashSet::new();
        for chat in &value.conversations {
            validate(&chat.snapshot)?;
            if chat.revision == 0 || !ids.insert(&chat.snapshot.id) {
                return Err("重复或无效的对话记录 / Invalid conversation records".into());
            }
        }
        Ok(value)
    }
    fn publish(&self, value: &History) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
        if bytes.len() > LIMIT {
            return Err("本目录对话库已达 8 MiB，请先导出并删除旧对话 / Archive full; export and remove older chats".into());
        }
        validate_local_path(&self.root)?;
        if local_metadata(&self.path, false)?.is_some_and(|m| m.permissions().readonly()) {
            return Err("对话库为只读，原文件未修改 / Read-only chat archive".into());
        }
        let temp = self
            .directory
            .join(format!(".chat-history-{}.tmp", new_id("save")));
        // Only clean up a temporary file that this transaction actually created.
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        let written = file
            .write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string());
        drop(file);
        let result = written.and_then(|_| {
            local_metadata(&self.path, false)?;
            fs::rename(&temp, &self.path).map_err(|e| e.to_string())
        });
        if result.is_err() {
            let _ = fs::remove_file(&temp);
        }
        result
    }
}

fn save(root: &str, snapshot: Snapshot, expected_revision: u64) -> Result<Summary, String> {
    validate(&snapshot)?;
    let _guard = TRANSACTION.lock().map_err(|_| "Chat archive unavailable")?;
    let mut storage = Storage::open(root)?;
    let _lock = storage.lock_write()?;
    let mut history = storage.read()?;
    let existing = history
        .conversations
        .iter()
        .position(|chat| chat.snapshot.id == snapshot.id);
    let actual = existing
        .map(|i| history.conversations[i].revision)
        .unwrap_or(0);
    if actual != expected_revision {
        return Err("对话已被其他窗口修改或删除，未覆盖原文件；请另存为新对话 / Conversation changed or deleted; save as a new chat".into());
    }
    if existing.is_none() && history.conversations.len() >= COUNT {
        return Err(
            "本目录最多保存 30 条对话，请先导出或删除旧对话 / Maximum 30 saved chats per folder"
                .into(),
        );
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let chat = Conversation {
        snapshot,
        revision: actual.checked_add(1).ok_or("Revision exhausted")?,
        created_at: existing
            .map(|i| history.conversations[i].created_at)
            .unwrap_or(now),
        updated_at: now,
    };
    let summary = Summary::from(&chat);
    if let Some(i) = existing {
        history.conversations[i] = chat;
    } else {
        history.conversations.push(chat);
    }
    storage.publish(&history)?;
    Ok(summary)
}

#[tauri::command]
pub async fn agent_chat_list(root: String) -> Result<Vec<Summary>, String> {
    super::blocking(move || {
        let _guard = TRANSACTION.lock().map_err(|_| "Chat archive unavailable")?;
        let history = Storage::open(&root)?.read()?;
        let mut items: Vec<_> = history.conversations.iter().map(Summary::from).collect();
        items.sort_by_key(|chat| std::cmp::Reverse(chat.updated_at));
        Ok(items)
    })
    .await
}
#[tauri::command]
pub async fn agent_chat_read(root: String, id: String) -> Result<Conversation, String> {
    super::blocking(move || {
        if !valid_id(&id) {
            return Err("Invalid conversation ID".into());
        }
        let _guard = TRANSACTION.lock().map_err(|_| "Chat archive unavailable")?;
        Storage::open(&root)?
            .read()?
            .conversations
            .into_iter()
            .find(|chat| chat.snapshot.id == id)
            .ok_or_else(|| "对话已不存在 / Conversation not found".into())
    })
    .await
}
#[tauri::command]
pub async fn agent_chat_save(
    root: String,
    snapshot: Snapshot,
    expected_revision: u64,
) -> Result<Summary, String> {
    super::blocking(move || save(&root, snapshot, expected_revision)).await
}
#[tauri::command]
pub async fn agent_chat_export(snapshot: Snapshot) -> Result<Option<String>, String> {
    super::blocking(move || {
        // Export is the escape hatch when a valid transcript no longer fits one saved record.
        validate_bounded(&snapshot, LIMIT)?;
        let picked = rfd::FileDialog::new()
            .set_title("导出对话 / Export conversation")
            .add_filter("Markdown", &["md"])
            .set_file_name("dalizi-conversation.md")
            .save_file();
        let Some(path) = picked else {
            return Ok(None);
        };
        validate_local_path(&path.to_string_lossy())?;
        let parent = path.parent().ok_or("Invalid destination")?;
        let _guard = lock_memory_directory(parent)?;
        if local_metadata(&path, false)?.is_some_and(|m| m.permissions().readonly()) {
            return Err("目标文件为只读 / Read-only destination".into());
        }
        let mut text = format!("# {}\n\n", snapshot.title);
        if !snapshot.summary.is_empty() {
            text.push_str(&format!("## 摘要 / Summary\n\n{}\n\n", snapshot.summary));
        }
        for message in snapshot.messages {
            text.push_str(&format!("## {}\n\n{}\n\n", message.role, message.text));
        }
        let temp = parent.join(format!(".dalizi-export-{}.tmp", new_id("chat")));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        let result = file
            .write_all(text.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string());
        drop(file);
        let result = result.and_then(|_| {
            local_metadata(&path, false)?;
            fs::rename(&temp, &path).map_err(|e| e.to_string())
        });
        if result.is_err() {
            let _ = fs::remove_file(&temp);
        }
        result?;
        Ok(Some(path.to_string_lossy().into()))
    })
    .await
}
#[tauri::command]
pub async fn agent_chat_delete(
    root: String,
    id: String,
    expected_revision: u64,
) -> Result<(), String> {
    super::blocking(move || {
        if !valid_id(&id) || expected_revision == 0 {
            return Err("Invalid conversation identity".into());
        }
        let _guard = TRANSACTION.lock().map_err(|_| "Chat archive unavailable")?;
        let mut storage = Storage::open(&root)?;
        if storage.directory_guard.is_none() {
            return Err("对话已不存在 / Conversation not found".into());
        }
        let _lock = storage.lock_write()?;
        let mut history = storage.read()?;
        let i = history
            .conversations
            .iter()
            .position(|chat| chat.snapshot.id == id && chat.revision == expected_revision)
            .ok_or("对话已变化，请刷新后重试 / Conversation changed; refresh and retry")?;
        history.conversations.remove(i);
        storage.publish(&history)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (String, PathBuf) {
        let dir = std::env::temp_dir().join(new_id("chat-test"));
        fs::create_dir(&dir).unwrap();
        (dir.to_string_lossy().into(), dir)
    }
    fn snapshot(id: &str) -> Snapshot {
        Snapshot {
            id: id.into(),
            title: "中文对话 🌟".into(),
            messages: vec![Message {
                id: "m1".into(),
                role: "user".into(),
                text: "测试正文".into(),
                omit_history: false,
            }],
            summary: String::new(),
            summarized_ids: vec![],
            compacted_messages: 0,
        }
    }
    #[test]
    fn read_is_non_mutating_and_save_is_scoped_versioned_and_conflict_safe() {
        let (root, dir) = fixture();
        let (other, other_dir) = fixture();
        assert!(Storage::open(&root)
            .unwrap()
            .read()
            .unwrap()
            .conversations
            .is_empty());
        assert!(!dir.join(".dalizi").exists());
        assert_eq!(save(&root, snapshot("a"), 0).unwrap().revision, 1);
        assert_eq!(save(&root, snapshot("b"), 0).unwrap().revision, 1);
        assert!(Storage::open(&other)
            .unwrap()
            .read()
            .unwrap()
            .conversations
            .is_empty());
        assert!(save(&root, snapshot("a"), 0).is_err());
        assert_eq!(save(&root, snapshot("a"), 1).unwrap().revision, 2);
        assert_eq!(
            Storage::open(&root)
                .unwrap()
                .read()
                .unwrap()
                .conversations
                .len(),
            2
        );
        fs::remove_dir_all(dir).unwrap();
        fs::remove_dir_all(other_dir).unwrap();
    }
    #[test]
    fn corruption_unknown_fields_and_invalid_snapshots_are_never_overwritten() {
        let (root, dir) = fixture();
        let mut bad = snapshot("../outside");
        assert!(save(&root, bad.clone(), 0).is_err());
        assert!(!dir.join(".dalizi").exists());
        bad.id = "valid".into();
        bad.messages[0].role = "system".into();
        assert!(save(&root, bad, 0).is_err());
        let mut data = serde_json::to_value(snapshot("valid")).unwrap();
        data["apiKey"] = "secret".into();
        assert!(serde_json::from_value::<Snapshot>(data).is_err());
        save(&root, snapshot("a"), 0).unwrap();
        let target = dir.join(".dalizi/chat-history.json");
        fs::write(&target, b"corrupt original").unwrap();
        assert!(save(&root, snapshot("a"), 1).is_err());
        assert_eq!(fs::read(&target).unwrap(), b"corrupt original");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn oversized_record_can_still_be_exported_but_invalid_content_cannot() {
        let mut chat = snapshot("large");
        chat.messages = (0..40)
            .map(|i| Message {
                id: format!("m{i}"),
                role: "user".into(),
                text: "a".repeat(32000),
                omit_history: false,
            })
            .collect();
        assert!(validate(&chat).is_err());
        assert!(validate_bounded(&chat, LIMIT).is_ok());
        chat.messages[0].role = "system".into();
        assert!(validate_bounded(&chat, LIMIT).is_err());
    }
    #[test]
    fn deletion_is_version_checked_and_stale_writes_cannot_resurrect_it() {
        let (root, dir) = fixture();
        let mut chat = snapshot("a");
        chat.summary = "保留摘要".into();
        chat.summarized_ids = vec!["m1".into()];
        save(&root, chat.clone(), 0).unwrap();
        let mut invalid = chat.clone();
        invalid.summarized_ids.push("missing".into());
        assert!(save(&root, invalid, 1).is_err());
        assert!(
            tauri::async_runtime::block_on(agent_chat_delete(root.clone(), "a".into(), 2)).is_err()
        );
        tauri::async_runtime::block_on(agent_chat_delete(root.clone(), "a".into(), 1)).unwrap();
        assert!(save(&root, chat.clone(), 1).is_err());
        chat.id = "new-copy".into();
        save(&root, chat, 0).unwrap();
        assert_eq!(
            Storage::open(&root)
                .unwrap()
                .read()
                .unwrap()
                .conversations
                .len(),
            1
        );
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn read_only_files_and_directory_aliases_are_preserved() {
        let (root, dir) = fixture();
        save(&root, snapshot("a"), 0).unwrap();
        let target = dir.join(".dalizi/chat-history.json");
        let before = fs::read(&target).unwrap();
        let original = fs::metadata(&target).unwrap().permissions();
        let mut readonly = original.clone();
        readonly.set_readonly(true);
        fs::set_permissions(&target, readonly).unwrap();
        assert!(save(&root, snapshot("a"), 1).is_err());
        assert_eq!(fs::read(&target).unwrap(), before);
        fs::set_permissions(&target, original).unwrap();
        fs::remove_file(&target).unwrap();
        fs::create_dir(&target).unwrap();
        assert!(save(&root, snapshot("b"), 0).is_err());
        assert!(target.is_dir());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn storage_rejects_aliases_file_locks_and_full_archives_without_partial_writes() {
        let (root, dir) = fixture();
        save(&root, snapshot("a"), 0).unwrap();
        let target = dir.join(".dalizi/chat-history.json");
        let before = fs::read(&target).unwrap();
        let held = OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&target)
            .unwrap();
        assert!(save(&root, snapshot("a"), 1).is_err());
        drop(held);
        assert_eq!(fs::read(&target).unwrap(), before);
        assert_eq!(fs::read_dir(dir.join(".dalizi")).unwrap().count(), 2);
        let mut storage = Storage::open(&root).unwrap();
        let lock = storage.lock_write().unwrap();
        assert!(save(&root, snapshot("a"), 1).is_err());
        drop(lock);
        drop(storage);
        for i in 1..COUNT {
            save(&root, snapshot(&format!("chat-{i}")), 0).unwrap();
        }
        assert!(save(&root, snapshot("overflow"), 0).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
