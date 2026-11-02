//! User-managed skill snapshots and scoped memory. This module stores text only;
//! importing a skill never executes its scripts or follows referenced files.
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

#[path = "agent_builtin_skills.rs"]
mod builtin;
#[path = "agent_memory_maintenance.rs"]
pub mod maintenance;

const SKILL_FILE_LIMIT: usize = 64 * 1024;
const STORE_LIMIT: usize = 4 * 1024 * 1024;
const SKILL_COUNT: usize = 32;
const ACTIVE_SKILLS: usize = 4;
const SKILL_CONTEXT_LIMIT: usize = 32 * 1024;
const MEMORY_COUNT: usize = 100;
const MEMORY_CHARS: usize = 2000;
const MEMORY_CONTEXT_LIMIT: usize = 8 * 1024;
const MEMORY_FILE_LIMIT: usize = 1024 * 1024;
static STORAGE_PATH: OnceLock<PathBuf> = OnceLock::new();
static STORE: OnceLock<Result<Mutex<Store>, String>> = OnceLock::new();
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static LOCAL_MEMORY_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub path: String,
    pub enabled: bool,
    pub body: String,
}

// Keep persistence separate: legacy user skills contain no catalog metadata.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillView {
    #[serde(flatten)]
    skill: Skill,
    source: &'static str,
    version: &'static str,
    availability: &'static str,
}
impl SkillView {
    fn user(skill: Skill) -> Self {
        Self {
            skill,
            source: "user",
            version: "",
            availability: "advice",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Memory {
    pub id: String,
    pub scope: String,
    pub root: Option<String>,
    pub content: String,
    pub enabled: bool,
    pub updated_at: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryInput {
    #[serde(default)]
    pub id: Option<String>,
    pub scope: String,
    #[serde(default)]
    pub root: Option<String>,
    pub content: String,
    pub enabled: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredProfile {
    version: u32,
    skills: Vec<Skill>,
    memories: Vec<Memory>,
    memory_enabled: bool,
    learning_enabled: bool,
    builtin_enabled: Vec<String>,
}
impl Default for StoredProfile {
    fn default() -> Self {
        Self {
            version: 2,
            skills: Vec::new(),
            memories: Vec::new(),
            memory_enabled: true,
            learning_enabled: false,
            builtin_enabled: Vec::new(),
        }
    }
}

// Deserialize v1 with its original strict schema; do not silently accept v2
// fields or missing fields and overwrite an unrecognized/corrupt profile.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyProfile {
    version: u32,
    skills: Vec<Skill>,
    memories: Vec<Memory>,
    memory_enabled: bool,
    learning_enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileView {
    pub memory_statistics: maintenance::MemoryStatistics,
    pub skills: Vec<SkillView>,
    pub memories: Vec<Memory>,
    pub memory_enabled: bool,
    pub learning_enabled: bool,
    pub storage_path: String,
    pub memory_storage_path: Option<String>,
    pub legacy_memories: Vec<Memory>,
    pub warning: Option<String>,
    pub memory_error: Option<String>,
}

// Local files deliberately contain no absolute root. Moving a folder carries
// its memory with it; scope is always derived from the directory being opened.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LocalMemory {
    id: String,
    content: String,
    enabled: bool,
    updated_at: u64,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LocalMemoryFile {
    version: u32,
    memories: Vec<LocalMemory>,
}
impl Default for LocalMemoryFile {
    fn default() -> Self {
        Self {
            version: 1,
            memories: Vec::new(),
        }
    }
}

struct LocalMemoryStore {
    root: String,
    directory: PathBuf,
    path: PathBuf,
    data: LocalMemoryFile,
    _root_guard: File,
    directory_guard: Option<File>,
}

#[derive(Default, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentContext {
    pub skills: Vec<ContextSkill>,
    pub memories: Vec<Memory>,
    pub memory_enabled: bool,
    pub learning_enabled: bool,
    pub truncated: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSkill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub body: String,
    pub truncated: bool,
}

struct Store {
    path: PathBuf,
    data: StoredProfile,
    legacy_bytes: Option<Vec<u8>>,
}

pub fn init(app: &tauri::AppHandle) {
    if let Ok(directory) = app.path().app_data_dir() {
        let _ = STORAGE_PATH.set(directory.join("agent-profile-v1.json"));
    }
}

fn store() -> Result<&'static Mutex<Store>, String> {
    let path = STORAGE_PATH
        .get()
        .ok_or("智能体存储尚未初始化 / Agent storage is not initialized")?;
    STORE
        .get_or_init(|| Store::open(path.clone()).map(Mutex::new))
        .as_ref()
        .map_err(Clone::clone)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}
fn new_id(kind: &str) -> String {
    format!(
        "{kind}-{}-{}-{}",
        now_ms(),
        std::process::id(),
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    )
}
fn path_key(path: &str) -> String {
    path.replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}
fn conventional_path(path: &Path) -> String {
    let raw = path.to_string_lossy();
    raw.strip_prefix(r"\\?\").unwrap_or(&raw).to_owned()
}
fn text_valid(text: &str) -> bool {
    !text
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
}
fn clip_bytes(text: &str, limit: usize) -> (&str, bool) {
    let mut end = text.len().min(limit);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    (&text[..end], end < text.len())
}

fn validate_local_path(raw: &str) -> Result<PathBuf, String> {
    let normalized = raw.replace('/', "\\");
    let b = normalized.as_bytes();
    if b.len() < 3
        || !b[0].is_ascii_alphabetic()
        || b[1] != b':'
        || b[2] != b'\\'
        || raw.contains('\0')
        || normalized[2..].contains(':')
    {
        return Err("请选择本地磁盘的完整路径 / Use an absolute local-drive path".into());
    }
    let path = PathBuf::from(normalized);
    let mut current = PathBuf::new();
    for component in path.components() {
        if matches!(component, Component::ParentDir) {
            return Err("路径不能包含 .. / Parent traversal is not allowed".into());
        }
        if let Component::Normal(name) = component {
            let text = name.to_string_lossy();
            let stem = text
                .split('.')
                .next()
                .unwrap_or_default()
                .trim_end_matches(' ')
                .to_ascii_uppercase();
            let device_number = stem
                .strip_prefix("COM")
                .or_else(|| stem.strip_prefix("LPT"));
            if matches!(
                stem.as_str(),
                "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
            ) || matches!(
                device_number,
                Some("1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³")
            ) {
                return Err("不支持设备路径 / Device paths are not supported".into());
            }
        }
        current.push(component);
        if matches!(component, Component::Prefix(_)) {
            continue;
        }
        let metadata = fs::symlink_metadata(&current)
            .map_err(|e| format!("路径不可用 / Path unavailable: {e}"))?;
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(
                "不支持符号链接、目录联接或云占位符 / Reparse points are not supported".into(),
            );
        }
    }
    Ok(path)
}

fn canonical_root(root: &str) -> Result<String, String> {
    let path = validate_local_path(root)?;
    if !path.is_dir() {
        return Err("工作范围必须是文件夹 / Scope must be a folder".into());
    }
    let canonical = fs::canonicalize(path).map_err(|e| e.to_string())?;
    Ok(conventional_path(&canonical))
}

fn memory_io_error(action: &str, path: &Path, error: std::io::Error) -> String {
    format!("无法{action}目录记忆，请检查权限、只读属性或文件占用 / Local memory I/O failed: {} · {error}", path.display())
}

fn local_metadata(path: &Path, directory: bool) -> Result<Option<fs::Metadata>, String> {
    use std::os::windows::fs::MetadataExt;
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_attributes() & 0x400 != 0 {
                return Err(format!(
                    "记忆路径不支持符号链接或目录联接 / Memory path cannot be a reparse point: {}",
                    path.display()
                ));
            }
            if metadata.is_dir() != directory || (!directory && !metadata.is_file()) {
                return Err(format!(
                    "记忆路径类型不正确 / Invalid memory path type: {}",
                    path.display()
                ));
            }
            Ok(Some(metadata))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(memory_io_error("读取", path, error)),
    }
}

fn lock_memory_directory(path: &Path) -> Result<File, String> {
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    // Keep directory names stable for the short transaction by denying DELETE
    // sharing. WRITE sharing is needed by Windows when renaming child files.
    let file = OpenOptions::new()
        .read(true)
        .share_mode(3)
        .custom_flags(0x02000000 | 0x00200000)
        .open(path)
        .map_err(|e| memory_io_error("访问", path, e))?;
    let metadata = file
        .metadata()
        .map_err(|e| memory_io_error("读取", path, e))?;
    if !metadata.is_dir() || metadata.file_attributes() & 0x400 != 0 {
        return Err("记忆目录无效或已变化 / Memory directory is invalid or changed".into());
    }
    Ok(file)
}

impl LocalMemoryStore {
    fn open(root: &str) -> Result<Self, String> {
        let root = canonical_root(root)?;
        let root_guard = lock_memory_directory(Path::new(&root))?;
        let directory = Path::new(&root).join(".dalizi");
        let path = directory.join("agent-memory.json");
        let directory_guard = if local_metadata(&directory, true)?.is_some() {
            Some(lock_memory_directory(&directory)?)
        } else {
            None
        };
        let data = if directory_guard.is_some() && local_metadata(&path, false)?.is_some() {
            use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
            let file = OpenOptions::new()
                .read(true)
                .share_mode(1)
                .custom_flags(0x00200000)
                .open(&path)
                .map_err(|e| memory_io_error("读取", &path, e))?;
            let metadata = file
                .metadata()
                .map_err(|e| memory_io_error("读取", &path, e))?;
            if !metadata.is_file()
                || metadata.file_attributes() & 0x400 != 0
                || metadata.len() > MEMORY_FILE_LIMIT as u64
            {
                return Err("目录记忆必须为不超过 1 MiB 的普通文件 / Memory must be a regular file up to 1 MiB".into());
            }
            let mut bytes = Vec::new();
            file.take((MEMORY_FILE_LIMIT + 1) as u64)
                .read_to_end(&mut bytes)
                .map_err(|e| memory_io_error("读取", &path, e))?;
            if bytes.len() > MEMORY_FILE_LIMIT {
                return Err("目录记忆文件过大 / Memory file is too large".into());
            }
            let data: LocalMemoryFile = serde_json::from_slice(&bytes).map_err(|_| {
                format!(
                    "目录记忆格式错误，原文件已保留 / Invalid local memory; original preserved: {}",
                    path.display()
                )
            })?;
            validate_local_memories(&data)?;
            data
        } else {
            LocalMemoryFile::default()
        };
        Ok(Self {
            root,
            directory,
            path,
            data,
            _root_guard: root_guard,
            directory_guard,
        })
    }
    fn memories(&self) -> Vec<Memory> {
        self.data
            .memories
            .iter()
            .map(|m| Memory {
                id: m.id.clone(),
                scope: "folder".into(),
                root: Some(self.root.clone()),
                content: m.content.clone(),
                enabled: m.enabled,
                updated_at: m.updated_at,
            })
            .collect()
    }
    fn publish(&mut self, next: LocalMemoryFile) -> Result<(), String> {
        validate_local_memories(&next)?;
        let bytes = serde_json::to_vec_pretty(&next).map_err(|e| e.to_string())?;
        if bytes.len() > MEMORY_FILE_LIMIT {
            return Err("目录记忆文件过大 / Memory file is too large".into());
        }
        // Validation precedes directory creation: failed/empty mutations do not
        // create hidden folders just because a user opened the memory manager.
        validate_local_path(&self.root)?;
        if self.directory_guard.is_none() {
            match fs::create_dir(&self.directory) {
                Ok(()) => (),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => (),
                Err(error) => return Err(memory_io_error("创建", &self.directory, error)),
            }
            local_metadata(&self.directory, true)?;
            self.directory_guard = Some(lock_memory_directory(&self.directory)?);
        }
        if local_metadata(&self.path, false)?.is_some_and(|m| m.permissions().readonly()) {
            return Err(format!(
                "目录记忆文件为只读，未修改原文件 / Local memory is read-only: {}",
                self.path.display()
            ));
        }
        let temporary = self
            .directory
            .join(format!(".agent-memory-{}.tmp", new_id("save")));
        let result = (|| {
            let mut file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temporary)
                .map_err(|e| memory_io_error("保存", &temporary, e))?;
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|e| memory_io_error("保存", &temporary, e))?;
            drop(file);
            // Recheck the target before atomic replacement; never follow a
            // link that appeared while preparing the new JSON snapshot.
            local_metadata(&self.path, false)?;
            fs::rename(&temporary, &self.path).map_err(|e| memory_io_error("保存", &self.path, e))
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result?;
        self.data = next;
        Ok(())
    }
    fn save(&mut self, input: MemoryInput) -> Result<Memory, String> {
        if input.scope != "folder"
            || input
                .root
                .as_deref()
                .map(canonical_root)
                .transpose()?
                .as_deref()
                .map(path_key)
                != Some(path_key(&self.root))
        {
            return Err("记忆只能保存到当前工作目录 / Memory requires this folder scope".into());
        }
        let content = input.content.trim().to_owned();
        let mut next = self.data.clone();
        let index = if let Some(id) = input.id {
            Some(
                next.memories
                    .iter()
                    .position(|m| m.id == id)
                    .ok_or("此目录中没有该记忆 / Memory does not exist in this folder")?,
            )
        } else {
            next.memories.iter().position(|m| m.content == content)
        };
        let memory = LocalMemory {
            id: index
                .map(|i| next.memories[i].id.clone())
                .unwrap_or_else(|| new_id("memory")),
            content,
            enabled: input.enabled,
            updated_at: now_ms(),
        };
        if let Some(index) = index {
            next.memories[index] = memory.clone();
        } else {
            next.memories.push(memory.clone());
        }
        self.publish(next)?;
        Ok(Memory {
            id: memory.id,
            scope: "folder".into(),
            root: Some(self.root.clone()),
            content: memory.content,
            enabled: memory.enabled,
            updated_at: memory.updated_at,
        })
    }
    fn delete(&mut self, id: &str) -> Result<(), String> {
        let mut next = self.data.clone();
        next.memories.retain(|m| m.id != id);
        if next.memories.len() != self.data.memories.len() {
            self.publish(next)?;
        }
        Ok(())
    }
    fn import_reviewed(&mut self, contents: Vec<String>) -> Result<usize, String> {
        if contents.is_empty() || contents.len() > MEMORY_COUNT {
            return Err("请选择 1 至 100 条记忆 / Select 1 to 100 memories".into());
        }
        let mut next = self.data.clone();
        for content in contents {
            let content = content.trim().to_owned();
            if content.is_empty() || content.chars().count() > MEMORY_CHARS || !text_valid(&content)
            {
                return Err(
                    "导入记忆无效或超过 2000 字符 / Invalid or oversized imported memory".into(),
                );
            }
            if next.memories.iter().any(|memory| memory.content == content) {
                continue;
            }
            next.memories.push(LocalMemory {
                id: new_id("memory"),
                content,
                enabled: false,
                updated_at: now_ms(),
            });
        }
        let imported = next.memories.len() - self.data.memories.len();
        // Validate the whole batch before publishing. Existing enable states and
        // contents are preserved, and an invalid item cannot partially import.
        validate_local_memories(&next)?;
        if imported > 0 {
            self.publish(next)?;
        }
        Ok(imported)
    }
    fn migrate(&mut self, legacy: &[Memory], ids: &[String]) -> Result<(), String> {
        if ids.len() > MEMORY_COUNT {
            return Err("迁移项过多 / Too many migration items".into());
        }
        let mut next = self.data.clone();
        for id in ids {
            let memory = legacy
                .iter()
                .find(|m| {
                    &m.id == id
                        && (m.scope == "global"
                            || (m.scope == "folder"
                                && m.root.as_deref().map(path_key) == Some(path_key(&self.root))))
                })
                .ok_or("无法迁移此范围以外的旧记忆 / Legacy memory is outside this scope")?;
            if next.memories.iter().any(|m| m.content == memory.content) {
                continue;
            }
            next.memories.push(LocalMemory {
                id: new_id("memory"),
                content: memory.content.clone(),
                enabled: memory.enabled,
                updated_at: now_ms(),
            });
        }
        if next.memories.len() != self.data.memories.len() {
            self.publish(next)?;
        }
        Ok(())
    }
}

fn validate_local_memories(data: &LocalMemoryFile) -> Result<(), String> {
    if data.version != 1 {
        return Err("不支持此目录记忆版本 / Unsupported local memory version".into());
    }
    if data.memories.len() > MEMORY_COUNT {
        return Err("每个目录最多保存 100 条记忆 / Up to 100 memories per folder".into());
    }
    let mut ids = std::collections::HashSet::new();
    for memory in &data.memories {
        if memory.id.is_empty()
            || memory.id.len() > 100
            || !ids.insert(&memory.id)
            || memory.content.trim().is_empty()
            || memory.content.chars().count() > MEMORY_CHARS
            || !text_valid(&memory.content)
        {
            return Err("目录记忆内容无效或过长 / Invalid or oversized local memory".into());
        }
    }
    Ok(())
}

fn legacy_memories(data: &StoredProfile, root: Option<&str>) -> Vec<Memory> {
    let key = root.map(path_key);
    data.memories
        .iter()
        .filter(|m| {
            m.scope == "global"
                || key
                    .as_ref()
                    .is_some_and(|k| m.root.as_ref().is_some_and(|r| path_key(r) == *k))
        })
        .cloned()
        .collect()
}

impl Store {
    fn open(path: PathBuf) -> Result<Self, String> {
        let (data, legacy_bytes) = match File::open(&path) {
            Ok(file) => {
                let mut bytes = Vec::new();
                file.take((STORE_LIMIT + 1) as u64)
                    .read_to_end(&mut bytes)
                    .map_err(|e| e.to_string())?;
                if bytes.len() > STORE_LIMIT {
                    return Err("智能体配置超过大小限制 / Agent profile is too large".into());
                }
                let invalid = || {
                    format!("智能体配置损坏，原文件已保留 / Invalid agent profile; original preserved: {}", path.display())
                };
                let value: serde_json::Value =
                    serde_json::from_slice(&bytes).map_err(|_| invalid())?;
                let version = value
                    .get("version")
                    .and_then(serde_json::Value::as_u64)
                    .ok_or_else(invalid)?;
                let data = match version {
                    1 => {
                        let legacy: LegacyProfile = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
                        debug_assert_eq!(legacy.version, 1);
                        StoredProfile {
                            version: 2, skills: legacy.skills, memories: legacy.memories,
                            memory_enabled: legacy.memory_enabled, learning_enabled: legacy.learning_enabled,
                            builtin_enabled: Vec::new(),
                        }
                    }
                    2 => serde_json::from_slice(&bytes).map_err(|_| invalid())?,
                    _ => return Err("不支持此配置版本，原文件已保留 / Unsupported profile version; original preserved".into()),
                };
                validate_profile(&data)?;
                (data, (version == 1).then_some(bytes))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                (StoredProfile::default(), None)
            }
            Err(error) => return Err(error.to_string()),
        };
        Ok(Self {
            path,
            data,
            legacy_bytes,
        })
    }
    fn view(&self, root: Option<&str>) -> Result<ProfileView, String> {
        // An invalid requested scope remains an error. Once that scope is
        // valid, a damaged optional memory file must not hide skill settings.
        let root = root.map(canonical_root).transpose()?;
        let memory_storage_path = root.as_ref().map(|root| {
            Path::new(root)
                .join(".dalizi")
                .join("agent-memory.json")
                .to_string_lossy()
                .into_owned()
        });
        let _lock = LOCAL_MEMORY_LOCK
            .lock()
            .map_err(|_| "Local memory lock failed")?;
        let (memories, memory_error) = match root.as_deref().map(LocalMemoryStore::open) {
            Some(Ok(local)) => (local.memories(), None),
            Some(Err(error)) => (Vec::new(), Some(error)),
            None => (Vec::new(), None),
        };
        Ok(ProfileView {
            memory_statistics: maintenance::statistics(&memories),
            skills: skill_views(&self.data)?,
            memories,
            memory_enabled: self.data.memory_enabled,
            learning_enabled: self.data.learning_enabled,
            storage_path: self.path.to_string_lossy().into_owned(),
            memory_storage_path,
            legacy_memories: legacy_memories(&self.data, root.as_deref()),
            warning: None,
            memory_error,
        })
    }
    fn import(&mut self, mut skill: Skill) -> Result<Skill, String> {
        self.mutate(|data| {
            if let Some(existing) = data
                .skills
                .iter_mut()
                .find(|s| path_key(&s.path) == path_key(&skill.path))
            {
                skill.id = existing.id.clone();
                skill.enabled = existing.enabled;
                *existing = skill.clone();
            } else {
                data.skills.push(skill.clone());
            }
            Ok(skill)
        })
    }
    fn set_skill(&mut self, id: &str, enabled: bool) -> Result<(), String> {
        self.mutate(|data| {
            if builtin::find(id).is_some() {
                data.builtin_enabled.retain(|item| item != id);
                if enabled {
                    data.builtin_enabled.push(id.to_owned());
                }
            } else {
                data.skills
                    .iter_mut()
                    .find(|s| s.id == id)
                    .ok_or("技能已不存在 / Skill no longer exists")?
                    .enabled = enabled;
            }
            Ok(())
        })
    }
    fn remove_skill(&mut self, id: &str) -> Result<(), String> {
        if builtin::find(id).is_some() {
            return Err("内置技能不能删除，可以停用 / Built-in skills cannot be removed; disable them instead".into());
        }
        self.mutate(|data| {
            let index = data
                .skills
                .iter()
                .position(|skill| skill.id == id)
                .ok_or("技能已不存在 / Skill no longer exists")?;
            data.skills.remove(index);
            Ok(())
        })
    }
    fn backup_legacy(&self) -> Result<(), String> {
        let Some(bytes) = &self.legacy_bytes else {
            return Ok(());
        };
        // Migration is lazy. Refuse to replace a v1 file changed since it was
        // loaded, including a migration already completed by another instance.
        let mut current = Vec::new();
        File::open(&self.path)
            .map_err(|e| e.to_string())?
            .take((STORE_LIMIT + 1) as u64)
            .read_to_end(&mut current)
            .map_err(|e| e.to_string())?;
        if current != *bytes {
            return Err("旧版智能体配置已被其他程序修改，请重启后重试 / Legacy profile changed; restart before migration".into());
        }
        let name = self
            .path
            .file_name()
            .ok_or("Invalid storage path")?
            .to_string_lossy();
        let backup = self
            .path
            .with_file_name(format!("{name}.v1-backup-{}.json", new_id("migration")));
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&backup)
            .map_err(|e| {
                format!("无法备份旧版配置，未迁移 / Legacy backup failed; not migrated: {e}")
            })?;
        let result = file.write_all(bytes).and_then(|_| file.sync_all());
        drop(file);
        if let Err(error) = result {
            let _ = fs::remove_file(&backup);
            return Err(format!(
                "无法备份旧版配置，未迁移 / Legacy backup failed; not migrated: {error}"
            ));
        }
        Ok(())
    }
    fn mutate<T>(
        &mut self,
        update: impl FnOnce(&mut StoredProfile) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut next = self.data.clone();
        let value = update(&mut next)?;
        validate_profile(&next)?;
        let bytes = serde_json::to_vec_pretty(&next).map_err(|e| e.to_string())?;
        if bytes.len() > STORE_LIMIT {
            return Err("智能体配置超过大小限制 / Agent profile is too large".into());
        }
        let directory = self.path.parent().ok_or("Invalid storage path")?;
        fs::create_dir_all(directory).map_err(|e| e.to_string())?;
        self.backup_legacy()?;
        let temporary = directory.join(format!(".agent-profile-{}.tmp", new_id("save")));
        let result = (|| -> Result<(), String> {
            let mut file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temporary)
                .map_err(|e| e.to_string())?;
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|e| e.to_string())?;
            drop(file);
            // std::fs::rename uses replacement semantics on Windows, atomically
            // publishing a complete profile instead of overwriting in place.
            fs::rename(&temporary, &self.path).map_err(|e| e.to_string())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result?;
        self.data = next;
        self.legacy_bytes = None;
        Ok(value)
    }
}

fn validate_profile(data: &StoredProfile) -> Result<(), String> {
    if data.version != 2 {
        return Err("不支持此配置版本 / Unsupported profile version".into());
    }
    if data.skills.len() > SKILL_COUNT
        || data.skills.iter().filter(|s| s.enabled).count() + data.builtin_enabled.len()
            > ACTIVE_SKILLS
    {
        return Err(
            "最多保存 32 个自定义技能，同时启用 4 个内置或自定义技能 / Up to 32 user skills and 4 enabled skills in total".into(),
        );
    }
    if data.memories.len() > MEMORY_COUNT {
        return Err("最多保存 100 条记忆 / Up to 100 memories".into());
    }
    let mut ids = std::collections::HashSet::new();
    for id in &data.builtin_enabled {
        if builtin::find(id).is_none() || !ids.insert(id) {
            return Err(
                "内置技能配置包含未知或重复的 ID / Unknown or duplicate built-in skill ID".into(),
            );
        }
    }
    for skill in &data.skills {
        if skill.id.is_empty()
            || skill.id.len() > 100
            || skill.id.to_ascii_lowercase().starts_with("builtin.")
            || !ids.insert(&skill.id)
            || skill.name.trim().is_empty()
            || skill.name.chars().count() > 100
            || skill.description.chars().count() > 600
            || skill.body.trim().is_empty()
            || skill.body.len() > SKILL_FILE_LIMIT
            || skill.path.len() > 32768
            || !text_valid(&skill.name)
            || !text_valid(&skill.description)
            || !text_valid(&skill.body)
        {
            return Err("技能内容无效或过长 / Invalid or oversized skill".into());
        }
    }
    for memory in &data.memories {
        if memory.id.is_empty()
            || memory.id.len() > 100
            || !ids.insert(&memory.id)
            || memory.content.trim().is_empty()
            || memory.content.chars().count() > MEMORY_CHARS
            || !text_valid(&memory.content)
            || !matches!(memory.scope.as_str(), "global" | "folder")
            || (memory.scope == "global" && memory.root.is_some())
            || (memory.scope == "folder"
                && memory.root.as_ref().is_none_or(|r| {
                    r.len() > 32768 || r.len() < 3 || r.as_bytes()[1] != b':' || r.contains('\0')
                }))
        {
            return Err("记忆内容或范围无效 / Invalid memory content or scope".into());
        }
    }
    Ok(())
}

fn builtin_skills() -> Result<&'static Vec<Skill>, String> {
    static SKILLS: OnceLock<Result<Vec<Skill>, String>> = OnceLock::new();
    SKILLS
        .get_or_init(|| {
            builtin::CATALOG
                .iter()
                .map(|entry| {
                    let mut skill = parse_skill(entry.text, entry.path)?;
                    skill.id = entry.id.to_owned();
                    skill.name = entry.name.to_owned();
                    Ok(skill)
                })
                .collect()
        })
        .as_ref()
        .map_err(Clone::clone)
}

fn skill_views(data: &StoredProfile) -> Result<Vec<SkillView>, String> {
    let mut skills = Vec::with_capacity(builtin::CATALOG.len() + data.skills.len());
    for skill in builtin_skills()? {
        let mut skill = skill.clone();
        skill.enabled = data.builtin_enabled.contains(&skill.id);
        let entry = builtin::find(&skill.id).ok_or("Invalid built-in catalog")?;
        skills.push(SkillView {
            skill,
            source: "builtin",
            version: builtin::VERSION,
            availability: entry.availability,
        });
    }
    skills.extend(data.skills.iter().cloned().map(SkillView::user));
    Ok(skills)
}

fn selected_skill(data: &StoredProfile, id: &str) -> Result<Skill, String> {
    let selected = if builtin::find(id).is_some() {
        builtin_skills()?.iter().find(|skill| {
            skill.id == id && data.builtin_enabled.iter().any(|enabled| enabled == id)
        })
    } else {
        data.skills
            .iter()
            .find(|skill| skill.id == id && skill.enabled)
    };
    selected
        .cloned()
        .ok_or_else(|| "选中的技能未启用或已被移除 / Selected skill is disabled or missing".into())
}

fn yaml_scalar(raw: &str) -> Result<String, String> {
    let raw = raw.trim();
    if raw.starts_with('"') {
        return serde_json::from_str::<String>(raw)
            .map_err(|_| "技能元数据的引号未正确闭合 / Invalid quoted skill metadata".into());
    }
    if raw.starts_with('\'') {
        if raw.len() < 2 || !raw.ends_with('\'') {
            return Err("技能元数据的引号未正确闭合 / Invalid quoted skill metadata".into());
        }
        return Ok(raw[1..raw.len() - 1].replace("''", "'"));
    }
    Ok(raw.split(" #").next().unwrap_or_default().trim().to_owned())
}

fn parse_skill(text: &str, path: &str) -> Result<Skill, String> {
    let text = text
        .strip_prefix('\u{feff}')
        .unwrap_or(text)
        .replace("\r\n", "\n");
    if !text_valid(&text) || text.len() > SKILL_FILE_LIMIT {
        return Err(
            "SKILL.md 必须为不超过 64 KiB 的 UTF-8 文本 / Use a UTF-8 SKILL.md up to 64 KiB".into(),
        );
    }
    let mut name = None;
    let mut description = None;
    let body;
    if text.starts_with("---\n") {
        let lines: Vec<&str> = text.lines().collect();
        let end = lines
            .iter()
            .enumerate()
            .skip(1)
            .find(|(_, line)| line.trim() == "---")
            .map(|(i, _)| i)
            .ok_or("SKILL.md 的元数据缺少结束标记 --- / Missing frontmatter end")?;
        let mut i = 1;
        while i < end {
            let line = lines[i];
            i += 1;
            if line.starts_with(char::is_whitespace) || line.trim_start().starts_with('#') {
                continue;
            }
            let Some((key, value)) = line.split_once(':') else {
                continue;
            };
            if !matches!(key.trim(), "name" | "description") {
                continue;
            }
            let slot = if key.trim() == "name" {
                &mut name
            } else {
                &mut description
            };
            if slot.is_some() {
                return Err("技能元数据存在重复字段 / Duplicate skill metadata field".into());
            }
            let value = value.trim();
            let parsed = if matches!(value, ">" | ">-" | ">+" | "|" | "|-" | "|+") {
                let mut block = Vec::new();
                while i < end && (lines[i].starts_with(char::is_whitespace) || lines[i].is_empty())
                {
                    block.push(lines[i].trim());
                    i += 1;
                }
                block
                    .join(if value.starts_with('>') { " " } else { "\n" })
                    .trim()
                    .to_owned()
            } else {
                yaml_scalar(value)?
            };
            *slot = Some(parsed);
        }
        if name.as_ref().is_none_or(|s| s.trim().is_empty())
            || description.as_ref().is_none_or(|s| s.trim().is_empty())
        {
            return Err("技能元数据需要 name 和 description / Skill frontmatter requires name and description".into());
        }
        body = lines[end + 1..].join("\n").trim().to_owned();
    } else {
        // Simple Markdown recipes also work; use the heading/folder as a name.
        name = text
            .lines()
            .find_map(|line| line.strip_prefix("# ").map(str::trim))
            .map(str::to_owned);
        if name.is_none() {
            name = Path::new(path)
                .parent()
                .and_then(Path::file_name)
                .map(|n| n.to_string_lossy().into_owned());
        }
        description = Some(
            text.lines()
                .find(|line| !line.trim().is_empty() && !line.starts_with('#'))
                .unwrap_or("Local skill")
                .chars()
                .take(600)
                .collect(),
        );
        body = text.trim().to_owned();
    }
    let skill = Skill {
        id: new_id("skill"),
        name: name.unwrap_or_else(|| "Local skill".into()),
        description: description.unwrap_or_default(),
        path: path.to_owned(),
        enabled: false,
        body,
    };
    let mut profile = StoredProfile::default();
    profile.skills.push(skill.clone());
    validate_profile(&profile)?;
    Ok(skill)
}

fn import_skill(path: &str) -> Result<Skill, String> {
    let mut path = validate_local_path(path.trim())?;
    if path.is_dir() {
        path.push("SKILL.md");
        path = validate_local_path(&path.to_string_lossy())?;
    }
    if !path
        .file_name()
        .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case("SKILL.md"))
    {
        return Err("请选择 SKILL.md 或包含它的文件夹 / Select SKILL.md or its folder".into());
    }
    let path = fs::canonicalize(path).map_err(|e| e.to_string())?;
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    let file = OpenOptions::new()
        .read(true)
        .share_mode(1)
        .custom_flags(0x00200000)
        .open(&path)
        .map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file()
        || metadata.file_attributes() & 0x400 != 0
        || metadata.len() > SKILL_FILE_LIMIT as u64
    {
        return Err("SKILL.md 必须为不超过 64 KiB 的普通文件 / SKILL.md must be a regular file up to 64 KiB".into());
    }
    let mut bytes = Vec::new();
    file.take((SKILL_FILE_LIMIT + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > SKILL_FILE_LIMIT {
        return Err("技能文件过大 / Skill file is too large".into());
    }
    let text = std::str::from_utf8(&bytes)
        .map_err(|_| "SKILL.md 请使用 UTF-8 编码 / Use UTF-8 encoding")?;
    parse_skill(text, &conventional_path(&path))
}

fn context_for(
    data: &StoredProfile,
    root: &str,
    local_memories: &[Memory],
    skill_ids: &[String],
    use_memory: bool,
) -> Result<AgentContext, String> {
    validate_profile(data)?;
    if skill_ids.len() > ACTIVE_SKILLS {
        return Err("每轮最多使用 4 个技能 / Up to 4 skills per request".into());
    }
    let mut context = AgentContext {
        memory_enabled: data.memory_enabled,
        learning_enabled: data.learning_enabled,
        ..Default::default()
    };
    let mut seen = std::collections::HashSet::new();
    let mut bytes_left = SKILL_CONTEXT_LIMIT;
    for (index, id) in skill_ids.iter().enumerate() {
        if !seen.insert(id) {
            return Err("技能不能重复 / Duplicate skill selection".into());
        }
        let skill = selected_skill(data, id)?;
        // Share the remaining text budget so one long skill does not silently
        // crowd every later selected skill out of the request.
        let metadata_bytes = skill.name.len() + skill.description.len();
        let allowance = (bytes_left / (skill_ids.len() - index)).saturating_sub(metadata_bytes);
        let (body, truncated) = clip_bytes(&skill.body, allowance);
        bytes_left = bytes_left.saturating_sub(body.len() + metadata_bytes);
        context.truncated |= truncated;
        context.skills.push(ContextSkill {
            id: skill.id.clone(),
            name: skill.name.clone(),
            description: skill.description.clone(),
            body: body.to_owned(),
            truncated,
        });
    }
    if use_memory && data.memory_enabled {
        let key = path_key(root);
        let mut matching: Vec<&Memory> = local_memories
            .iter()
            .filter(|m| {
                m.enabled
                    && m.scope == "folder"
                    && m.root.as_ref().is_some_and(|r| path_key(r) == key)
            })
            .collect();
        matching.sort_by_key(|m| std::cmp::Reverse(m.updated_at));
        let mut bytes_left = MEMORY_CONTEXT_LIMIT;
        for memory in matching {
            // Omit whole entries rather than cutting a preference mid-sentence.
            let memory_bytes = serde_json::to_vec(memory).map_err(|e| e.to_string())?.len();
            if memory_bytes > bytes_left {
                context.truncated = true;
                continue;
            }
            bytes_left -= memory_bytes;
            context.memories.push(memory.clone());
        }
    }
    Ok(context)
}

pub fn resolve_context(
    root: &str,
    skill_ids: &[String],
    use_memory: bool,
) -> Result<AgentContext, String> {
    if skill_ids.is_empty() && !use_memory {
        return Ok(AgentContext::default());
    }
    let root = canonical_root(root)?;
    let guard = store()?.lock().map_err(|_| "Agent profile lock failed")?;
    context_from_directory(&guard.data, &root, skill_ids, use_memory)
}
fn context_from_directory(
    data: &StoredProfile,
    root: &str,
    skill_ids: &[String],
    use_memory: bool,
) -> Result<AgentContext, String> {
    let _lock = LOCAL_MEMORY_LOCK
        .lock()
        .map_err(|_| "Local memory lock failed")?;
    let memories = if use_memory && data.memory_enabled {
        LocalMemoryStore::open(root)?.memories()
    } else {
        Vec::new()
    };
    context_for(data, root, &memories, skill_ids, use_memory)
}
pub fn learning_enabled() -> bool {
    store()
        .ok()
        .and_then(|store| store.lock().ok().map(|s| s.data.learning_enabled))
        .unwrap_or(false)
}

async fn blocking<T: Send + 'static>(
    task: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn agent_profile(root: Option<String>) -> Result<ProfileView, String> {
    blocking(move || {
        let root = root
            .as_deref()
            .filter(|r| !r.trim().is_empty())
            .map(canonical_root)
            .transpose()?;
        store()?
            .lock()
            .map_err(|_| "Agent profile lock failed")?
            .view(root.as_deref())
    })
    .await
}
#[tauri::command]
pub async fn agent_skill_import(path: String) -> Result<SkillView, String> {
    blocking(move || {
        let skill = import_skill(&path)?;
        store()?
            .lock()
            .map_err(|_| "Agent profile lock failed")?
            .import(skill)
            .map(SkillView::user)
    })
    .await
}
#[tauri::command]
pub async fn agent_skill_set(id: String, enabled: bool) -> Result<(), String> {
    blocking(move || {
        store()?
            .lock()
            .map_err(|_| "Agent profile lock failed")?
            .set_skill(&id, enabled)
    })
    .await
}
#[tauri::command]
pub async fn agent_skill_remove(id: String) -> Result<(), String> {
    blocking(move || {
        store()?
            .lock()
            .map_err(|_| "Agent profile lock failed")?
            .remove_skill(&id)
    })
    .await
}
#[tauri::command]
pub async fn agent_memory_save(memory: MemoryInput) -> Result<Memory, String> {
    blocking(move || {
        if memory.scope != "folder" {
            return Err("记忆必须保存到当前工作目录 / Memory requires folder scope".into());
        }
        let root = memory
            .root
            .as_deref()
            .ok_or("请选择记忆所属目录 / Choose a memory folder")?;
        let _lock = LOCAL_MEMORY_LOCK
            .lock()
            .map_err(|_| "Local memory lock failed")?;
        let mut local = LocalMemoryStore::open(root)?;
        local.save(memory)
    })
    .await
}
#[tauri::command]
pub async fn agent_memory_delete(id: String, root: String) -> Result<(), String> {
    blocking(move || {
        let _lock = LOCAL_MEMORY_LOCK
            .lock()
            .map_err(|_| "Local memory lock failed")?;
        LocalMemoryStore::open(&root)?.delete(&id)
    })
    .await
}
#[tauri::command]
pub async fn agent_memory_import(root: String, contents: Vec<String>) -> Result<usize, String> {
    blocking(move || {
        if contents.len() > MEMORY_COUNT
            || contents
                .iter()
                .any(|content| content.len() > MEMORY_CHARS * 4)
        {
            return Err("导入记忆超出限制 / Imported memories exceed limits".into());
        }
        let _lock = LOCAL_MEMORY_LOCK
            .lock()
            .map_err(|_| "Local memory lock failed")?;
        LocalMemoryStore::open(&root)?.import_reviewed(contents)
    })
    .await
}
#[tauri::command]
pub async fn agent_memory_migrate(root: String, ids: Vec<String>) -> Result<(), String> {
    blocking(move || {
        let root = canonical_root(&root)?;
        let legacy = {
            let guard = store()?.lock().map_err(|_| "Agent profile lock failed")?;
            legacy_memories(&guard.data, Some(&root))
        };
        let _lock = LOCAL_MEMORY_LOCK
            .lock()
            .map_err(|_| "Local memory lock failed")?;
        LocalMemoryStore::open(&root)?.migrate(&legacy, &ids)
    })
    .await
}
#[tauri::command]
pub async fn agent_preferences_set(
    memory_enabled: bool,
    learning_enabled: bool,
) -> Result<(), String> {
    blocking(move || {
        store()?
            .lock()
            .map_err(|_| "Agent profile lock failed")?
            .mutate(|data| {
                data.memory_enabled = memory_enabled;
                data.learning_enabled = learning_enabled;
                Ok(())
            })
    })
    .await
}

#[tauri::command]
pub async fn agent_pick_skill() -> Result<Option<String>, String> {
    blocking(|| {
        std::thread::spawn(pick_skill)
            .join()
            .map_err(|_| "Skill picker thread failed".to_owned())?
    })
    .await
}
fn pick_skill() -> Result<Option<String>, String> {
    use windows::core::w;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        FileOpenDialog, IFileOpenDialog, FOS_FILEMUSTEXIST, FOS_FORCEFILESYSTEM, FOS_PATHMUSTEXIST,
        SIGDN_FILESYSPATH,
    };
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|e| e.to_string())?;
        struct Com;
        impl Drop for Com {
            fn drop(&mut self) {
                unsafe {
                    CoUninitialize();
                }
            }
        }
        let _com = Com;
        let picker: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)
            .map_err(|e| e.to_string())?;
        picker
            .SetTitle(w!("选择技能文件 / Select SKILL.md"))
            .map_err(|e| e.to_string())?;
        picker
            .SetFileName(w!("SKILL.md"))
            .map_err(|e| e.to_string())?;
        picker
            .SetOptions(FOS_FILEMUSTEXIST | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST)
            .map_err(|e| e.to_string())?;
        match picker.Show(HWND::default()) {
            Ok(()) => (),
            Err(error) if error.code().0 as u32 == 0x800704c7 => return Ok(None),
            Err(error) => return Err(error.to_string()),
        }
        let selected = picker
            .GetResult()
            .and_then(|item| item.GetDisplayName(SIGDN_FILESYSPATH))
            .map_err(|e| e.to_string())?;
        let path = selected.to_string().map_err(|e| e.to_string());
        CoTaskMemFree(Some(selected.0.cast()));
        path.map(Some)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(new_id("dalizi-agent-test"));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
        fn store(&self) -> Store {
            Store::open(self.0.join("data").join("agent-profile-v1.json")).unwrap()
        }
        fn folder(&self, name: &str) -> String {
            let path = self.0.join(name);
            fs::create_dir_all(&path).unwrap();
            // TEMP may use an 8.3 alias on CI; public commands also resolve roots first.
            conventional_path(&fs::canonicalize(&path).unwrap())
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn skill(name: &str) -> Skill {
        parse_skill(&format!("---\nname: {name}\ndescription: Help organize files\n---\nFollow the user's naming convention."), &format!(r"C:\skills\{name}\SKILL.md")).unwrap()
    }
    fn memory(content: &str, root: Option<String>) -> MemoryInput {
        MemoryInput {
            id: None,
            scope: if root.is_some() { "folder" } else { "global" }.into(),
            root,
            content: content.into(),
            enabled: true,
        }
    }

    fn write_legacy(storage: &Store, data: &StoredProfile) -> Vec<u8> {
        let mut json = serde_json::to_value(data).unwrap();
        json["version"] = serde_json::json!(1);
        json.as_object_mut().unwrap().remove("builtinEnabled");
        let bytes = serde_json::to_vec_pretty(&json).unwrap();
        fs::create_dir_all(storage.path.parent().unwrap()).unwrap();
        fs::write(&storage.path, &bytes).unwrap();
        bytes
    }

    #[test]
    fn bundled_catalog_is_offline_disabled_and_separate_from_user_capacity() {
        let fixture = Fixture::new();
        let mut storage = fixture.store();
        let view = storage.view(None).unwrap();
        assert_eq!(view.skills.len(), 9);
        assert!(
            !storage.path.exists(),
            "browsing bundled skills never creates storage"
        );
        for entry in &view.skills {
            assert_eq!(entry.source, "builtin");
            assert_eq!(entry.version, "1.0.0");
            assert!(!entry.skill.enabled);
            assert!(entry.skill.path.starts_with("builtin://"));
            assert!(!entry.skill.body.is_empty());
            assert!(!entry.skill.description.is_empty());
            assert_eq!(
                entry.availability,
                if entry.skill.id == "builtin.file-organize" {
                    "file-actions"
                } else {
                    "advice"
                }
            );
        }
        for i in 0..SKILL_COUNT {
            storage.import(skill(&format!("user-{i}"))).unwrap();
        }
        assert_eq!(storage.view(None).unwrap().skills.len(), SKILL_COUNT + 9);
        let before = fs::read(&storage.path).unwrap();
        assert!(storage.import(skill("overflow")).is_err());
        assert_eq!(fs::read(&storage.path).unwrap(), before);
        let serialized = serde_json::to_value(storage.view(None).unwrap()).unwrap();
        let user = serialized["skills"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["source"] == "user")
            .unwrap();
        assert_eq!(user["version"], "");
        assert!(user.get("name").is_some() && user.get("body").is_some());
        assert!(
            user.get("skill").is_none(),
            "view metadata must preserve the flat IPC contract"
        );
    }

    #[test]
    fn legacy_32_skills_migrate_lazily_with_exact_backup_and_restart_preferences() {
        let fixture = Fixture::new();
        let storage = fixture.store();
        let mut data = StoredProfile::default();
        data.skills = (0..SKILL_COUNT)
            .map(|i| skill(&format!("legacy-{i}")))
            .collect();
        data.skills[0].enabled = true;
        data.learning_enabled = true;
        data.memory_enabled = false;
        let original = write_legacy(&storage, &data);
        let mut migrated = Store::open(storage.path.clone()).unwrap();
        let view = migrated.view(None).unwrap();
        assert_eq!(view.skills.len(), SKILL_COUNT + 9);
        assert_eq!(fs::read(&storage.path).unwrap(), original);
        assert_eq!(
            fs::read_dir(storage.path.parent().unwrap())
                .unwrap()
                .count(),
            1
        );
        assert_eq!(migrated.data.skills[0].id, data.skills[0].id);
        assert!(migrated.data.skills[0].enabled);
        assert!(migrated.data.builtin_enabled.is_empty());
        migrated.set_skill("builtin.file-organize", true).unwrap();
        let backup: Vec<_> = fs::read_dir(storage.path.parent().unwrap())
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| {
                path.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .contains(".v1-backup-")
            })
            .collect();
        assert_eq!(backup.len(), 1);
        assert_eq!(fs::read(&backup[0]).unwrap(), original);
        let serialized: serde_json::Value =
            serde_json::from_slice(&fs::read(&storage.path).unwrap()).unwrap();
        assert_eq!(serialized["version"], 2);
        assert_eq!(serialized["skills"].as_array().unwrap().len(), SKILL_COUNT);
        assert_eq!(
            serialized["builtinEnabled"],
            serde_json::json!(["builtin.file-organize"])
        );
        assert!(!serialized["skills"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item.get("source").is_some()));
        let mut reopened = Store::open(storage.path.clone()).unwrap();
        assert!(reopened.data.learning_enabled);
        assert!(!reopened.data.memory_enabled);
        assert_eq!(reopened.data.builtin_enabled, ["builtin.file-organize"]);
        reopened.set_skill("builtin.file-organize", false).unwrap();
        assert!(Store::open(storage.path.clone())
            .unwrap()
            .data
            .builtin_enabled
            .is_empty());
        assert_eq!(
            fs::read_dir(storage.path.parent().unwrap())
                .unwrap()
                .count(),
            2,
            "v2 writes do not create more migration backups"
        );
    }

    #[test]
    fn combined_enabled_limit_unknown_ids_and_builtin_removal_are_enforced() {
        let fixture = Fixture::new();
        let mut storage = fixture.store();
        let user = storage.import(skill("custom")).unwrap();
        storage.set_skill(&user.id, true).unwrap();
        for id in [
            "builtin.file-organize",
            "builtin.task-planning",
            "builtin.documentation",
        ] {
            storage.set_skill(id, true).unwrap();
        }
        let before = fs::read(&storage.path).unwrap();
        assert!(storage.set_skill("builtin.code-review", true).is_err());
        assert!(storage.set_skill("builtin.missing", true).is_err());
        assert!(storage.set_skill("missing-user", false).is_err());
        assert!(storage.remove_skill("builtin.file-organize").is_err());
        assert!(storage.remove_skill("builtin.missing").is_err());
        assert_eq!(fs::read(&storage.path).unwrap(), before);
        assert_eq!(storage.data.builtin_enabled.len(), 3);
        storage.set_skill(&user.id, false).unwrap();
        storage.set_skill("builtin.code-review", true).unwrap();
        assert!(
            storage.set_skill(&user.id, true).is_err(),
            "limit applies in both directions"
        );
        storage.remove_skill(&user.id).unwrap();
        assert!(storage.data.skills.is_empty());
        assert!(
            storage.remove_skill(&user.id).is_err(),
            "stale IDs are not silently accepted"
        );
    }

    #[test]
    fn selected_builtin_context_uses_compiled_body_and_rejects_disabled_or_spoofed_ids() {
        let fixture = Fixture::new();
        let mut storage = fixture.store();
        let id = "builtin.file-organize".to_owned();
        assert!(context_for(
            &storage.data,
            r"C:\work",
            &[],
            std::slice::from_ref(&id),
            false
        )
        .is_err());
        storage.set_skill(&id, true).unwrap();
        let compiled = builtin_skills()
            .unwrap()
            .iter()
            .find(|skill| skill.id == id)
            .unwrap()
            .body
            .clone();
        let mut view = storage.view(None).unwrap();
        view.skills
            .iter_mut()
            .find(|item| item.skill.id == id)
            .unwrap()
            .skill
            .body = "Injected instructions".into();
        let context = context_for(
            &storage.data,
            r"C:\work",
            &[],
            std::slice::from_ref(&id),
            false,
        )
        .unwrap();
        assert_eq!(context.skills[0].body, compiled);
        assert_eq!(context.skills[0].name, "文件整理");
        assert!(context_for(
            &storage.data,
            r"C:\work",
            &[],
            &[id.clone(), id.clone()],
            false
        )
        .is_err());
        assert!(context_for(
            &storage.data,
            r"C:\work",
            &[],
            &["builtin.removed-version".into()],
            false
        )
        .is_err());
        let mut fake = skill("fake");
        fake.id = id.clone();
        fake.enabled = true;
        fake.body = "Forged built-in".into();
        assert!(storage.import(fake.clone()).is_err());
        let mut poisoned = storage.data.clone();
        poisoned.skills.push(fake);
        assert!(context_for(&poisoned, r"C:\work", &[], std::slice::from_ref(&id), false).is_err());
        storage.set_skill(&id, false).unwrap();
        assert!(
            context_for(&storage.data, r"C:\work", &[], &[id], false).is_err(),
            "previous request IDs cannot bypass a disabled skill"
        );
    }

    #[test]
    fn corrupt_unknown_and_forged_profiles_are_preserved_without_recovery_overwrites() {
        let fixture = Fixture::new();
        let storage = fixture.store();
        fs::create_dir_all(storage.path.parent().unwrap()).unwrap();
        let baseline = serde_json::to_value(StoredProfile::default()).unwrap();
        let mut missing = baseline.clone();
        missing.as_object_mut().unwrap().remove("builtinEnabled");
        let mut unknown = baseline.clone();
        unknown["builtinEnabled"] = serde_json::json!(["builtin.no-such-skill"]);
        let mut duplicate = baseline.clone();
        duplicate["builtinEnabled"] =
            serde_json::json!(["builtin.file-organize", "builtin.file-organize"]);
        let mut unsupported = baseline.clone();
        unsupported["version"] = serde_json::json!(3);
        let mut legacy_extra = baseline.clone();
        legacy_extra["version"] = serde_json::json!(1);
        let mut spoofed = baseline.clone();
        let mut fake = skill("fake");
        fake.id = "BuIlTiN.file-organize".into();
        spoofed["skills"] = serde_json::json!([fake]);
        let mut mutated_view = baseline;
        mutated_view["skills"] = serde_json::json!([{
            "id":"skill-custom", "name":"Fake", "description":"Fake", "path":"C:\\skills\\SKILL.md", "enabled":false, "body":"Text", "source":"builtin"
        }]);
        for value in [
            missing,
            unknown,
            duplicate,
            unsupported,
            legacy_extra,
            spoofed,
            mutated_view,
        ] {
            let bytes = serde_json::to_vec(&value).unwrap();
            fs::write(&storage.path, &bytes).unwrap();
            assert!(Store::open(storage.path.clone()).is_err(), "{value}");
            assert_eq!(fs::read(&storage.path).unwrap(), bytes);
            assert_eq!(
                fs::read_dir(storage.path.parent().unwrap())
                    .unwrap()
                    .count(),
                1
            );
        }
    }

    #[test]
    fn failed_migration_write_keeps_original_and_in_memory_enabled_state() {
        use std::os::windows::fs::OpenOptionsExt;
        let fixture = Fixture::new();
        let storage = fixture.store();
        let original = write_legacy(&storage, &StoredProfile::default());
        let mut migrated = Store::open(storage.path.clone()).unwrap();
        let lock = OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&storage.path)
            .unwrap();
        let result = migrated.set_skill("builtin.file-organize", true);
        drop(lock);
        assert!(
            result.is_err(),
            "deny-delete file handle must prevent atomic replacement"
        );
        assert!(migrated.data.builtin_enabled.is_empty());
        assert!(migrated.legacy_bytes.is_some());
        assert_eq!(fs::read(&storage.path).unwrap(), original);
        assert!(Store::open(storage.path.clone())
            .unwrap()
            .data
            .builtin_enabled
            .is_empty());
        assert!(fs::read_dir(storage.path.parent().unwrap())
            .unwrap()
            .all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".tmp")));
        migrated.set_skill("builtin.file-organize", true).unwrap();
        assert_eq!(
            Store::open(storage.path.clone())
                .unwrap()
                .data
                .builtin_enabled,
            ["builtin.file-organize"]
        );
    }

    #[test]
    fn externally_changed_legacy_file_is_not_overwritten_during_migration() {
        let fixture = Fixture::new();
        let storage = fixture.store();
        write_legacy(&storage, &StoredProfile::default());
        let mut loaded = Store::open(storage.path.clone()).unwrap();
        let mut changed = StoredProfile::default();
        changed.learning_enabled = true;
        let newer = write_legacy(&storage, &changed);
        assert!(loaded.set_skill("builtin.file-organize", true).is_err());
        assert!(loaded.data.builtin_enabled.is_empty());
        assert_eq!(fs::read(&storage.path).unwrap(), newer);
        assert_eq!(
            fs::read_dir(storage.path.parent().unwrap())
                .unwrap()
                .count(),
            1
        );
    }

    #[test]
    fn memory_import_is_atomic_deduplicated_disabled_and_portable() {
        let fixture = Fixture::new();
        let root = fixture.folder("source");
        let other = fixture.folder("destination");
        let mut local = LocalMemoryStore::open(&root).unwrap();
        local
            .save(memory("Keep original names", Some(root.clone())))
            .unwrap();
        let before = fs::read(&local.path).unwrap();
        assert!(local
            .import_reviewed(vec!["Valid new item".into(), "\0".into()])
            .is_err());
        assert_eq!(fs::read(&local.path).unwrap(), before);
        assert_eq!(
            local
                .import_reviewed(vec![
                    " Keep original names ".into(),
                    "Use dated folders".into(),
                    "Use dated folders".into()
                ])
                .unwrap(),
            1
        );
        assert!(local.data.memories[0].enabled);
        assert!(!local.data.memories[1].enabled);
        let json = fs::read_to_string(&local.path).unwrap();
        assert!(!json.contains("root"));
        let target = Path::new(&other).join(".dalizi");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("agent-memory.json"), json).unwrap();
        let moved = LocalMemoryStore::open(&other).unwrap();
        assert_eq!(moved.memories().len(), 2);
        assert!(moved
            .memories()
            .iter()
            .all(|item| item.root.as_deref() == Some(other.as_str())));
        let before = fs::read(&local.path).unwrap();
        assert!(local
            .import_reviewed((0..100).map(|i| format!("Additional {i}")).collect())
            .is_err());
        assert_eq!(fs::read(&local.path).unwrap(), before);
    }

    #[test]
    fn imports_real_skill_utf8_frontmatter_and_preserves_snapshot() {
        let fixture = Fixture::new();
        let folder = fixture.folder("my-skill");
        let path = Path::new(&folder).join("SKILL.md");
        fs::write(&path, "\u{feff}---\nname: '项目整理'\ndescription: >-\n  Organize project files\n  according to the naming rules.\nmetadata:\n  author: demo\n---\n# Instructions\n仅整理选中的文件。\n").unwrap();
        let imported = import_skill(&folder).unwrap();
        assert_eq!(imported.name, "项目整理");
        assert_eq!(
            imported.description,
            "Organize project files according to the naming rules."
        );
        assert!(imported.body.contains("仅整理"));
        assert!(!imported.enabled);
        let mut storage = fixture.store();
        let imported = storage.import(imported).unwrap();
        storage.set_skill(&imported.id, true).unwrap();
        fs::write(&path, "# Updated recipe\nNew instructions").unwrap();
        assert!(
            storage.data.skills[0].body.contains("仅整理"),
            "import is a snapshot"
        );
        let replaced = storage
            .import(import_skill(path.to_str().unwrap()).unwrap())
            .unwrap();
        assert_eq!(replaced.id, imported.id);
        assert!(replaced.enabled);
        assert_eq!(storage.data.skills.len(), 1);
        assert!(replaced.body.contains("New instructions"));
        assert_eq!(
            parse_skill(
                "---\nname: \"quoted name\"\ndescription: |\n  One\n  Two\n---\nBody",
                r"C:\skill\SKILL.md"
            )
            .unwrap()
            .description,
            "One\nTwo"
        );
    }

    #[test]
    fn malformed_oversized_and_device_skill_inputs_are_rejected() {
        for text in [
            "---\nname: x\n---\nBody",
            "---\nname: x\ndescription: one\nname: y\n---\nBody",
            "---\nname: \"unclosed\ndescription: x\n---\nBody",
            "---\nname: x\ndescription: x\n---\n",
            "# Broken\ntext\0",
        ] {
            assert!(parse_skill(text, r"C:\skills\SKILL.md").is_err(), "{text}");
        }
        assert!(parse_skill(&"x".repeat(SKILL_FILE_LIMIT + 1), r"C:\skills\SKILL.md").is_err());
        for path in [
            r"\\.\pipe\test",
            r"C:\NUL",
            r"C:\COM¹",
            r"C:\work\text:stream",
            "relative/SKILL.md",
        ] {
            assert!(validate_local_path(path).is_err());
        }
        let fixture = Fixture::new();
        let wrong = fixture.0.join("other.md");
        fs::write(&wrong, "# Other").unwrap();
        assert!(import_skill(wrong.to_str().unwrap()).is_err());
    }

    #[test]
    fn atomic_profile_roundtrip_preserves_preferences_and_rejects_invalid_mutations() {
        let fixture = Fixture::new();
        let mut storage = fixture.store();
        for i in 0..5 {
            storage.import(skill(&format!("skill-{i}"))).unwrap();
        }
        for i in 0..4 {
            storage
                .set_skill(&storage.data.skills[i].id.clone(), true)
                .unwrap();
        }
        let before = fs::read(&storage.path).unwrap();
        assert!(storage
            .set_skill(&storage.data.skills[4].id.clone(), true)
            .is_err());
        assert!(!storage.data.skills[4].enabled);
        assert_eq!(before, fs::read(&storage.path).unwrap());
        storage
            .mutate(|data| {
                data.learning_enabled = true;
                data.memory_enabled = false;
                Ok(())
            })
            .unwrap();
        let restored = Store::open(storage.path.clone()).unwrap();
        assert!(restored.data.learning_enabled);
        assert!(!restored.data.memory_enabled);
        assert_eq!(restored.data.skills.len(), 5);
        assert_eq!(
            fs::read_dir(storage.path.parent().unwrap())
                .unwrap()
                .count(),
            1,
            "successful saves leave no partial files"
        );
        fs::write(&storage.path, b"{broken").unwrap();
        assert!(Store::open(storage.path.clone()).is_err());
        assert_eq!(fs::read(&storage.path).unwrap(), b"{broken");
    }

    #[test]
    fn local_memories_are_lazy_exact_scoped_and_reload_external_edits() {
        let fixture = Fixture::new();
        let a = fixture.folder("a");
        let child = fixture.folder("a/child");
        let b = fixture.folder("ab");
        let storage = fixture.store();
        let view = storage.view(Some(&a)).unwrap();
        let path = PathBuf::from(view.memory_storage_path.unwrap());
        assert!(view.memories.is_empty());
        assert!(
            !path.parent().unwrap().exists(),
            "reading a folder must not create .dalizi"
        );
        assert!(
            !storage.path.exists(),
            "local memory does not create the global profile"
        );
        let mut local = LocalMemoryStore::open(&a).unwrap();
        assert!(local
            .save(memory("Global is no longer allowed", None))
            .is_err());
        assert!(local.save(memory(" ", Some(a.clone()))).is_err());
        assert!(
            !path.parent().unwrap().exists(),
            "invalid saves do not create a repository"
        );
        let folder_memory = local
            .save(memory("Use dated subfolders", Some(a.clone())))
            .unwrap();
        let duplicate = local
            .save(memory("Use dated subfolders", Some(a.to_uppercase())))
            .unwrap();
        assert_eq!(duplicate.id, folder_memory.id);
        assert_eq!(local.data.memories.len(), 1);
        LocalMemoryStore::open(&b)
            .unwrap()
            .save(memory("Another project's convention", Some(b.clone())))
            .unwrap();
        assert_eq!(storage.view(Some(&a)).unwrap().memories.len(), 1);
        assert!(
            storage.view(Some(&child)).unwrap().memories.is_empty(),
            "no inheritance from parent folders"
        );
        assert!(storage.view(None).unwrap().memories.is_empty());
        assert!(storage.view(None).unwrap().memory_storage_path.is_none());
        assert!(!storage.path.exists());
        assert_eq!(
            context_from_directory(&storage.data, &a.to_uppercase(), &[], true)
                .unwrap()
                .memories[0]
                .content,
            "Use dated subfolders"
        );
        let mut external: LocalMemoryFile =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        external.memories[0].content = "Changed in an external editor".into();
        fs::write(&path, serde_json::to_vec(&external).unwrap()).unwrap();
        assert_eq!(
            storage.view(Some(&a)).unwrap().memories[0].content,
            "Changed in an external editor"
        );
        assert_eq!(
            context_from_directory(&storage.data, &a, &[], true)
                .unwrap()
                .memories[0]
                .content,
            "Changed in an external editor"
        );
        drop(local);
        let mut local = LocalMemoryStore::open(&a).unwrap();
        let mut edit = memory("Updated preference", Some(a.clone()));
        edit.id = Some(folder_memory.id.clone());
        edit.enabled = false;
        local.save(edit).unwrap();
        assert!(context_from_directory(&storage.data, &a, &[], true)
            .unwrap()
            .memories
            .is_empty());
        assert!(context_from_directory(&storage.data, &b, &[], false)
            .unwrap()
            .memories
            .is_empty());
        assert!(local
            .save(memory(&"x".repeat(MEMORY_CHARS + 1), Some(a.clone())))
            .is_err());
        assert!(local.save(memory("Wrong scope", Some(b.clone()))).is_err());
        local.delete(&folder_memory.id).unwrap();
        assert!(LocalMemoryStore::open(&a).unwrap().memories().is_empty());
        assert_eq!(LocalMemoryStore::open(&b).unwrap().memories().len(), 1);
        assert_eq!(
            fs::read_dir(path.parent().unwrap()).unwrap().count(),
            1,
            "atomic writes leave no partial files"
        );
    }

    #[test]
    fn legacy_memories_require_explicit_scoped_migration_and_preserve_source() {
        let fixture = Fixture::new();
        let a = fixture.folder("a");
        let b = fixture.folder("b");
        let mut storage = fixture.store();
        storage
            .mutate(|data| {
                data.memories = vec![
                    Memory {
                        id: "old-global".into(),
                        scope: "global".into(),
                        root: None,
                        content: "Prefer Chinese".into(),
                        enabled: true,
                        updated_at: 1,
                    },
                    Memory {
                        id: "old-a".into(),
                        scope: "folder".into(),
                        root: Some(a.clone()),
                        content: "A convention".into(),
                        enabled: true,
                        updated_at: 2,
                    },
                    Memory {
                        id: "old-b".into(),
                        scope: "folder".into(),
                        root: Some(b.clone()),
                        content: "B convention".into(),
                        enabled: true,
                        updated_at: 3,
                    },
                ];
                Ok(())
            })
            .unwrap();
        let before = fs::read(&storage.path).unwrap();
        let view = storage.view(Some(&a)).unwrap();
        assert_eq!(view.legacy_memories.len(), 2);
        assert!(view.memories.is_empty());
        assert!(
            context_from_directory(&storage.data, &a, &[], true)
                .unwrap()
                .memories
                .is_empty(),
            "old global and folder entries are not silently injected"
        );
        let mut local = LocalMemoryStore::open(&a).unwrap();
        assert!(local
            .migrate(&view.legacy_memories, &["old-b".into()])
            .is_err());
        local.migrate(&view.legacy_memories, &[]).unwrap();
        assert!(
            !local.directory.exists(),
            "no migration means no repository"
        );
        local
            .migrate(
                &view.legacy_memories,
                &["old-global".into(), "old-a".into()],
            )
            .unwrap();
        assert_eq!(local.memories().len(), 2);
        assert!(local
            .memories()
            .iter()
            .all(|m| m.scope == "folder" && m.root.as_deref() == Some(a.as_str())));
        let migrated = fs::read(&local.path).unwrap();
        local
            .migrate(
                &view.legacy_memories,
                &["old-global".into(), "old-a".into()],
            )
            .unwrap();
        assert_eq!(
            fs::read(&local.path).unwrap(),
            migrated,
            "repeat migration is idempotent"
        );
        assert_eq!(
            fs::read(&storage.path).unwrap(),
            before,
            "legacy source is never changed or removed"
        );
        assert_eq!(
            context_from_directory(&storage.data, &a, &[], true)
                .unwrap()
                .memories
                .len(),
            2
        );
        assert!(context_from_directory(&storage.data, &b, &[], true)
            .unwrap()
            .memories
            .is_empty());
    }

    #[test]
    fn local_memory_errors_preserve_readonly_corrupt_and_wrong_path_content() {
        let fixture = Fixture::new();
        let a = fixture.folder("a");
        let mut local = LocalMemoryStore::open(&a).unwrap();
        local
            .save(memory("Existing memory", Some(a.clone())))
            .unwrap();
        let before = fs::read(&local.path).unwrap();
        let mut permissions = fs::metadata(&local.path).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&local.path, permissions).unwrap();
        let error = local
            .save(memory("Should fail", Some(a.clone())))
            .unwrap_err();
        assert!(error.contains("只读"));
        assert_eq!(fs::read(&local.path).unwrap(), before);
        let mut permissions = fs::metadata(&local.path).unwrap().permissions();
        permissions.set_readonly(false);
        fs::set_permissions(&local.path, permissions).unwrap();
        fs::write(&local.path, b"{broken").unwrap();
        assert!(LocalMemoryStore::open(&a).is_err());
        assert_eq!(fs::read(&local.path).unwrap(), b"{broken");
        let mut storage = fixture.store();
        let mut selected_skill = skill("available without memory");
        selected_skill.enabled = true;
        let skill_id = selected_skill.id.clone();
        storage.data.skills.push(selected_skill);
        let view = storage.view(Some(&a)).unwrap();
        assert!(view.memory_error.is_some());
        assert!(view.memories.is_empty());
        assert_eq!(view.skills.len(), 1 + builtin::CATALOG.len());
        assert_eq!(
            view.memory_storage_path,
            Some(local.path.to_string_lossy().into_owned())
        );
        assert!(context_from_directory(&storage.data, &a, &[skill_id.clone()], true).is_err());
        storage.data.memory_enabled = false;
        let without_memory = context_from_directory(&storage.data, &a, &[skill_id], true).unwrap();
        assert_eq!(without_memory.skills.len(), 1);
        assert!(without_memory.memories.is_empty());
        assert!(storage.view(Some(&a)).unwrap().memory_error.is_some());
        assert_eq!(fs::read(&local.path).unwrap(), b"{broken");
        let b = fixture.folder("b");
        fs::write(Path::new(&b).join(".dalizi"), b"user file").unwrap();
        assert!(LocalMemoryStore::open(&b).is_err());
        assert_eq!(
            fs::read(Path::new(&b).join(".dalizi")).unwrap(),
            b"user file"
        );
        assert!(LocalMemoryStore::open(&format!("{a}\\missing")).is_err());
        assert!(!Path::new(&a).join("missing").exists());
        let storage = fixture.store();
        assert!(
            storage.view(Some(&format!("{a}\\missing"))).is_err(),
            "invalid roots never fall back to global memory"
        );
    }

    #[test]
    fn context_enforces_enabled_skills_and_utf8_budgets_with_recent_memories() {
        let mut data = StoredProfile::default();
        let mut first = skill("first");
        first.enabled = true;
        first.body = "中文😀".repeat(5000);
        let first_id = first.id.clone();
        data.skills.push(first);
        let mut second = skill("second");
        second.enabled = true;
        let second_id = second.id.clone();
        data.skills.push(second);
        let mut local_memories = Vec::new();
        for i in 0..6 {
            local_memories.push(Memory {
                id: format!("m-{i}"),
                scope: "folder".into(),
                root: Some(r"C:\work".into()),
                content: "甲".repeat(1900),
                enabled: true,
                updated_at: i,
            });
        }
        let context = context_for(
            &data,
            r"C:\work",
            &local_memories,
            &[first_id.clone(), second_id],
            true,
        )
        .unwrap();
        assert!(context.truncated);
        assert!(context.skills[0].truncated);
        assert!(!context.skills[1].truncated);
        assert!(
            !context.skills[1].body.is_empty(),
            "a long skill cannot erase another selected skill"
        );
        assert!(context.skills.iter().map(|s| s.body.len()).sum::<usize>() <= SKILL_CONTEXT_LIMIT);
        assert_eq!(context.memories.len(), 1);
        assert_eq!(context.memories[0].id, "m-5");
        assert!(context_for(
            &data,
            r"C:\work",
            &local_memories,
            &[first_id.clone(), first_id],
            true
        )
        .is_err());
        assert!(context_for(
            &data,
            r"C:\work",
            &local_memories,
            &["missing".into()],
            false
        )
        .is_err());
        data.skills[0].enabled = false;
        assert!(context_for(
            &data,
            r"C:\work",
            &local_memories,
            &[data.skills[0].id.clone()],
            false
        )
        .is_err());
        data.memory_enabled = false;
        assert!(context_for(&data, r"C:\work", &local_memories, &[], true)
            .unwrap()
            .memories
            .is_empty());
        assert!(
            resolve_context("", &[], false).unwrap().skills.is_empty(),
            "old requests do not need initialized storage"
        );
    }
}
