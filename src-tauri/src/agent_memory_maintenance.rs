//! Lossless maintenance only. No model may silently rewrite approved memories.
use super::*;
use std::collections::HashSet;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryStatistics {
    total: usize,
    enabled: usize,
    characters: usize,
    content_bytes: usize,
    estimated_tokens: usize,
    duplicates: usize,
}
pub fn statistics(memories: &[Memory]) -> MemoryStatistics {
    let mut seen = HashSet::new();
    let characters = memories.iter().map(|m| m.content.chars().count()).sum();
    let content_bytes = memories.iter().map(|m| m.content.len()).sum();
    // An estimate, not provider usage: ASCII ~4 characters/token; other Unicode
    // ~1/token. Count per entry so small preferences are not rounded to zero.
    let estimated_tokens = memories
        .iter()
        .map(|m| {
            let ascii = m.content.chars().filter(char::is_ascii).count();
            ascii.div_ceil(4) + m.content.chars().count() - ascii
        })
        .sum();
    MemoryStatistics {
        total: memories.len(),
        enabled: memories.iter().filter(|m| m.enabled).count(),
        characters,
        content_bytes,
        estimated_tokens,
        duplicates: memories
            .iter()
            .filter(|m| !seen.insert((m.content.as_str(), m.enabled)))
            .count(),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaintenanceResult {
    removed: usize,
    backup_path: Option<String>,
    statistics: MemoryStatistics,
}
fn compact(local: &mut LocalMemoryStore) -> Result<MaintenanceResult, String> {
    let mut newest: Vec<usize> = (0..local.data.memories.len()).collect();
    newest.sort_by_key(|i| {
        (
            std::cmp::Reverse(local.data.memories[*i].updated_at),
            std::cmp::Reverse(*i),
        )
    });
    let mut seen = HashSet::new();
    let keep: HashSet<usize> = newest
        .into_iter()
        .filter(|i| {
            let memory = &local.data.memories[*i];
            seen.insert((memory.content.as_str(), memory.enabled))
        })
        .collect();
    let removed = local.data.memories.len() - keep.len();
    let mut backup_path = None;
    if removed > 0 {
        if local_metadata(&local.path, false)?.is_some_and(|m| m.permissions().readonly()) {
            return Err("目录记忆为只读，未整理 / Local memory is read-only".into());
        }
        let fresh = LocalMemoryStore::open(&local.root)?;
        if serde_json::to_value(&fresh.data).ok() != serde_json::to_value(&local.data).ok() {
            return Err(
                "记忆已被其他程序修改，请刷新后重试 / Memory changed; refresh and retry".into(),
            );
        }
        let backup = local
            .directory
            .join(format!("agent-memory-backup-{}.json", new_id("compact")));
        let bytes = serde_json::to_vec_pretty(&local.data).map_err(|e| e.to_string())?;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&backup)
            .map_err(|e| memory_io_error("备份", &backup, e))?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| memory_io_error("备份", &backup, e))?;
        drop(file);
        let mut next = local.data.clone();
        next.memories = next
            .memories
            .into_iter()
            .enumerate()
            .filter_map(|(i, m)| keep.contains(&i).then_some(m))
            .collect();
        local.publish(next)?;
        backup_path = Some(backup.to_string_lossy().into_owned());
    }
    Ok(MaintenanceResult {
        removed,
        backup_path,
        statistics: statistics(&local.memories()),
    })
}

#[tauri::command]
pub async fn agent_memory_maintain(root: String) -> Result<MaintenanceResult, String> {
    blocking(move || {
        let _guard = LOCAL_MEMORY_LOCK
            .lock()
            .map_err(|_| "Local memory lock failed")?;
        compact(&mut LocalMemoryStore::open(&root)?)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maintenance_preserves_meaning_enable_state_and_newest_id_with_portable_backup() {
        let root = std::env::temp_dir().join(new_id("memory-maintenance"));
        fs::create_dir(&root).unwrap();
        let mut local = LocalMemoryStore::open(root.to_str().unwrap()).unwrap();
        assert_eq!(compact(&mut local).unwrap().removed, 0);
        assert!(!root.join(".dalizi").exists());
        let entries = [
            ("old", "保留中文  与空格", true, 1),
            ("new", "保留中文  与空格", true, 5),
            ("off", "保留中文  与空格", false, 8),
            ("different", "保留中文 与空格", true, 7),
            ("indented", "  保留中文 与空格", true, 9),
        ]
        .into_iter()
        .map(|(id, content, enabled, updated_at)| LocalMemory {
            id: id.into(),
            content: content.into(),
            enabled,
            updated_at,
        })
        .collect();
        local
            .publish(LocalMemoryFile {
                version: 1,
                memories: entries,
            })
            .unwrap();
        assert_eq!(statistics(&local.memories()).duplicates, 1);
        let result = compact(&mut local).unwrap();
        assert_eq!(result.removed, 1);
        assert_eq!(result.statistics.total, 4);
        assert!(local.data.memories.iter().any(|m| m.id == "new"));
        assert!(local
            .data
            .memories
            .iter()
            .any(|m| m.id == "off" && !m.enabled));
        let backup: LocalMemoryFile =
            serde_json::from_slice(&fs::read(result.backup_path.unwrap()).unwrap()).unwrap();
        assert_eq!(backup.memories.len(), 5);
        assert_eq!(compact(&mut local).unwrap().removed, 0);
        assert_eq!(
            LocalMemoryStore::open(root.to_str().unwrap())
                .unwrap()
                .data
                .memories
                .len(),
            4
        );
        // Small fixture retained under the OS temporary directory for inspection.
    }
    #[test]
    fn readonly_memory_is_untouched_and_creates_no_backup() {
        let root = std::env::temp_dir().join(new_id("memory-maintenance-readonly"));
        fs::create_dir(&root).unwrap();
        let mut local = LocalMemoryStore::open(root.to_str().unwrap()).unwrap();
        local.publish(LocalMemoryFile { version: 1, memories: (0..2).map(|i| LocalMemory {
            id: format!("duplicate-{i}"), content: "Keep literal content".into(), enabled: true, updated_at: i,
        }).collect() }).unwrap();
        let before = fs::read(&local.path).unwrap();
        let mut permissions = fs::metadata(&local.path).unwrap().permissions();
        permissions.set_readonly(true); fs::set_permissions(&local.path, permissions.clone()).unwrap();
        assert!(compact(&mut local).is_err());
        assert_eq!(fs::read(&local.path).unwrap(), before);
        assert_eq!(fs::read_dir(&local.directory).unwrap().count(), 1);
        permissions.set_readonly(false); fs::set_permissions(&local.path, permissions).unwrap();
    }
}
