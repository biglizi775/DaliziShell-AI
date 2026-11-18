use super::*;
use sha2::{Digest, Sha256};
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
use std::os::windows::io::AsRawHandle;
use windows::Win32::Foundation::HANDLE;
use windows::Win32::Storage::FileSystem::{GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION};

const MAX_BYTES: usize = 32 * 1024;
#[derive(Serialize, Deserialize)]
struct Backup {
    relative: String,
    before: String,
    after_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    transaction: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    identity: Option<String>,
}

pub(super) fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub(super) fn review(
    root: &Path,
    target: &Path,
    original: &str,
    proposed: &str,
) -> Result<String, String> {
    let extension = target
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default();
    if !["txt", "md"]
        .iter()
        .any(|s| extension.eq_ignore_ascii_case(s))
    {
        return Err("仅支持修改 Markdown 和 TXT 文档".into());
    }
    let relative = target.strip_prefix(root).map_err(|_| "目标不在工作区")?;
    if inspect_project(root, "read", &relative.to_string_lossy())? != original {
        return Err("文件在读取后发生变化，请重新生成建议".into());
    }
    normalize_replacement(original, proposed)
}

pub(super) fn normalize_replacement(original: &str, proposed: &str) -> Result<String, String> {
    if proposed.trim().is_empty() || proposed.contains('\0') {
        return Err("建议稿为空或不是文本".into());
    }
    let mut text = proposed.trim_start_matches('\u{feff}').to_owned();
    if original.contains("\r\n") && !original.replace("\r\n", "").contains('\n') {
        text = text.replace("\r\n", "\n").replace('\n', "\r\n");
    } else if original.contains('\n') && !original.contains('\r') {
        text = text.replace("\r\n", "\n");
    } else if original.contains('\r') && !original.contains('\n') {
        text = text.replace("\r\n", "\n").replace('\n', "\r");
    }
    if original.starts_with('\u{feff}') {
        text.insert(0, '\u{feff}');
    }
    if text.len() > MAX_BYTES {
        return Err("建议稿超过 32 KiB".into());
    }
    if text == original {
        return Err("建议稿与原文相同，没有需要保存的修改".into());
    }
    Ok(text)
}

fn guard_parents(root: &Path, parent: &Path) -> Result<Vec<File>, String> {
    let mut at = root.to_owned();
    let mut guards = vec![crate::agent_profile::lock_memory_directory(&at)?];
    for part in parent
        .strip_prefix(root)
        .map_err(|_| "目录不在工作区")?
        .components()
    {
        at.push(part);
        guards.push(crate::agent_profile::lock_memory_directory(&at)?);
    }
    Ok(guards)
}
fn open_document(path: &Path) -> Result<File, String> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .share_mode(0)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(path)
        .map_err(|e| e.to_string())?;
    let meta = file.metadata().map_err(|e| e.to_string())?;
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    unsafe { GetFileInformationByHandle(HANDLE(file.as_raw_handle()), &mut info) }
        .map_err(|e| e.to_string())?;
    if !meta.is_file()
        || meta.len() > MAX_BYTES as u64
        || meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0
        || info.nNumberOfLinks != 1
    {
        return Err("目标已变化，或不是普通的单链接文本文件".into());
    }
    Ok(file)
}
fn read_text(file: &mut File) -> Result<String, String> {
    let mut text = String::new();
    file.read_to_string(&mut text).map_err(|e| e.to_string())?;
    Ok(text)
}
fn overwrite(file: &mut File, bytes: &[u8]) -> std::io::Result<()> {
    file.seek(SeekFrom::Start(0))?;
    file.write_all(bytes)?;
    file.set_len(bytes.len() as u64)?;
    file.sync_all()
}
fn replace(file: &mut File, before: &str, after: &str) -> Result<(), String> {
    if let Err(err) = overwrite(file, after.as_bytes()) {
        overwrite(file, before.as_bytes()).map_err(|recovery| {
            format!("写入和恢复失败。请检查 .dalizi/edits 下的原文备份。{err} / {recovery}")
        })?;
        return Err(format!("写入失败，已恢复原内容。{err}"));
    }
    Ok(())
}
fn backup_path(root: &Path, relative: &str, create: bool) -> Result<(PathBuf, Vec<File>), String> {
    let mut dir = root.to_owned();
    let mut guards = Vec::new();
    for part in [".dalizi", "edits"] {
        dir.push(part);
        if create {
            match std::fs::create_dir(&dir) {
                Err(e) if e.kind() != std::io::ErrorKind::AlreadyExists => {
                    return Err(e.to_string())
                }
                _ => {}
            }
        }
        guards.push(
            crate::agent_profile::lock_memory_directory(&dir)
                .map_err(|_| "无法访问修改备份，或此文件尚未由 Agent 修改")?,
        );
    }
    Ok((
        dir.join(format!("{}.json", hash(relative.as_bytes()))),
        guards,
    ))
}

pub(super) fn apply(root: &Path, target: &Path, before: &str, after: &str) -> Result<(), String> {
    apply_bound(root, target, before, after, None)
}

pub(super) fn apply_bound(
    root: &Path,
    target: &Path,
    before: &str,
    after: &str,
    binding: Option<(&str, &str)>,
) -> Result<(), String> {
    let _guards = guard_parents(root, target.parent().ok_or("缺少父目录")?)?;
    let mut file = open_document(target)?;
    if let Some((identity, _)) = binding {
        verify_identity(&file, identity)?;
    }
    if read_text(&mut file)? != before {
        return Err("文件在审阅后发生变化，已保留当前内容。请重新生成建议。".into());
    }
    let relative = normalized(target.strip_prefix(root).map_err(|_| "目标不在工作区")?);
    let (backup, _backup_guards) = backup_path(root, &relative, true)?;
    let record = Backup {
        relative,
        before: before.to_owned(),
        after_hash: hash(after.as_bytes()),
        transaction: binding.map(|(_, id)| id.to_owned()),
        identity: Some(
            dalizi_harness_client::snapshot::file_identity(&file).map_err(|e| e.to_string())?,
        ),
    };
    let bytes = serde_json::to_vec(&record).map_err(|e| e.to_string())?;
    let temp = backup.with_extension(format!(
        "{}-{}.tmp",
        std::process::id(),
        NEXT_PLAN.fetch_add(1, Ordering::Relaxed)
    ));
    let mut out = OpenOptions::new()
        .write(true)
        .create_new(true)
        .share_mode(0)
        .open(&temp)
        .map_err(|e| e.to_string())?;
    let saved = out.write_all(&bytes).and_then(|_| out.sync_all());
    drop(out);
    if let Err(e) = saved.and_then(|_| std::fs::rename(&temp, &backup)) {
        let _ = std::fs::remove_file(temp);
        return Err(format!("备份失败，原文件未修改。{e}"));
    }
    replace(&mut file, before, after)
}

fn undo(root: &Path, relative: &str, expected_version: Option<&str>) -> Result<(), String> {
    undo_bound(root, relative, expected_version, None)
}

fn verify_identity(file: &File, expected: &str) -> Result<(), String> {
    if dalizi_harness_client::snapshot::file_identity(file).map_err(|e| e.to_string())? != expected
    {
        return Err("文件身份已改变，即使同名同内容也不会写入。".into());
    }
    Ok(())
}

pub(super) fn undo_bound(
    root: &Path,
    relative: &str,
    expected_version: Option<&str>,
    binding: Option<(&str, &str)>,
) -> Result<(), String> {
    let target = root.join(relative_path(relative)?);
    if !target
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| ["md", "txt"].iter().any(|x| e.eq_ignore_ascii_case(x)))
    {
        return Err("仅可撤销文本文档修改".into());
    }
    let _guards = guard_parents(root, target.parent().ok_or("缺少父目录")?)?;
    let mut file = open_document(&target)?;
    if let Some((identity, _)) = binding {
        verify_identity(&file, identity)?;
    }
    let relative = normalized(target.strip_prefix(root).map_err(|_| "文档路径无效")?);
    let (backup, _backup_guards) = backup_path(root, &relative, false)?;
    let input = OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(&backup)
        .map_err(|_| "没有可撤销的修改")?;
    let meta = input.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file()
        || meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0
        || meta.len() > 256 * 1024
    {
        return Err("修改备份无效".into());
    }
    let record: Backup =
        serde_json::from_reader(input.take(256 * 1024)).map_err(|_| "修改备份无效")?;
    if let Some(identity) = &record.identity {
        verify_identity(&file, identity)?;
    }
    let current = read_text(&mut file)?;
    if let Some((_, transaction)) = binding {
        if record.transaction.as_deref() != Some(transaction) {
            return Err("最新备份不属于此任务，未撤销其他修改。".into());
        }
    }
    if expected_version
        .is_some_and(|v| v != format!("{}-{}", hash(record.before.as_bytes()), record.after_hash))
    {
        return Err("该操作之后已有其他修改，请先核对最新版本。".into());
    }
    if record.relative != relative
        || record.before.len() > MAX_BYTES
        || record.before.contains('\0')
        || record.after_hash != hash(current.as_bytes())
    {
        return Err("内容已变化，无法撤销。已保留当前文件。".into());
    }
    replace(&mut file, &current, &record.before)?;
    let _ = std::fs::remove_file(backup);
    Ok(())
}
#[tauri::command]
pub async fn ai_undo_document(
    root: String,
    target: String,
    permission_mode: PermissionMode,
    expected_version: Option<String>,
    with_receipt: Option<bool>,
) -> Result<file_history::DocumentReply<()>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let receipt = file_history::record_document(&root, &target, permission_mode, file_history::DocumentAction::UndoEdit, |root, path| {
            undo(root, &path.to_string_lossy(), expected_version.as_deref())
        })?;
        receipt.reply(with_receipt, |_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn review_keeps_encoding_and_conflicts_preserve_disk_bytes() {
        let dir = std::env::temp_dir().join(format!(
            "df-edit-{}-{}",
            std::process::id(),
            NEXT_PLAN.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&dir).unwrap();
        let root = dir.canonicalize().unwrap();
        let path = root.join("plan.md");
        let original = "\u{feff}first\r\nsecond\r\n";
        std::fs::write(&path, original).unwrap();
        let after = review(&root, &path, original, "first\nchanged\n").unwrap();
        assert_eq!(after, "\u{feff}first\r\nchanged\r\n");
        std::fs::write(&path, "manual edit").unwrap();
        assert!(apply(&root, &path, original, &after).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "manual edit");
        std::fs::write(&path, original).unwrap();
        apply(&root, &path, original, &after).unwrap();
        assert!(undo(&root, "plan.md", Some("earlier revision")).is_err());
        std::fs::write(&path, "newer").unwrap();
        assert!(undo(&root, "plan.md", None).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "newer");
        std::fs::write(&path, &after).unwrap();
        undo(&root, "plan.md", None).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
        assert!(undo(&root, "plan.md", None).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
