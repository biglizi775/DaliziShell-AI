//! Dropped paths are checked again immediately before the shell transfer.
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferResult {
    completed: bool,
    processed: usize,
    skipped: usize,
}
fn key(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}
fn inside(child: &str, parent: &str) -> bool {
    child == parent || child.starts_with(&(parent.to_string() + "\\"))
}
fn absolute(value: &str) -> Result<PathBuf, String> {
    if value.is_empty()
        || value.chars().any(char::is_control)
        || !Path::new(value).is_absolute()
        || value.starts_with(r"\\.")
        || value.starts_with(r"\\?")
    {
        return Err(
            "拖入的项目必须是本地或网络共享的完整文件路径 / Drop ordinary absolute file paths"
                .into(),
        );
    }
    std::fs::canonicalize(value)
        .map_err(|e| format!("无法访问拖入的项目 / Cannot access dropped item: {value}: {e}"))
}
fn prepare(kind: &str, sources: &[String], dest: &str) -> Result<(Vec<String>, usize), String> {
    if !matches!(kind, "move" | "copy") || sources.is_empty() || sources.len() > 1000 {
        return Err(
            "每次拖入 1–1000 个项目，支持移动或复制 / Drop 1–1000 items to move or copy".into(),
        );
    }
    let destination = absolute(dest)?;
    if !destination.is_dir() {
        return Err("目标必须是文件夹 / Destination must be a folder".into());
    }
    let dest_key = key(&destination);
    let mut kept: Vec<(String, String, bool)> = Vec::new();
    for source in sources {
        let resolved = absolute(source)?;
        if resolved.file_name().is_none() {
            return Err("不能拖动磁盘或共享根目录 / Cannot transfer a drive or share root".into());
        }
        let source_key = key(&resolved);
        let directory = resolved.is_dir();
        if source_key == dest_key || (directory && inside(&dest_key, &source_key)) {
            return Err("不能将文件夹移入或复制到自身或子目录 / Cannot transfer a folder into itself or a descendant".into());
        }
        if kind == "move" && resolved.parent().is_some_and(|p| key(p) == dest_key) {
            continue;
        }
        if kept
            .iter()
            .any(|(_, k, is_dir)| k == &source_key || (*is_dir && inside(&source_key, k)))
        {
            continue;
        }
        if directory {
            kept.retain(|(_, k, _)| !inside(k, &source_key));
        }
        kept.push((source.clone(), source_key, directory));
    }
    let skipped = sources.len() - kept.len();
    Ok((kept.into_iter().map(|v| v.0).collect(), skipped))
}
#[tauri::command]
pub async fn external_drop_transfer(
    kind: String,
    sources: Vec<String>,
    dest: String,
) -> Result<TransferResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (sources, skipped) = prepare(&kind, &sources, &dest)?;
        let processed = sources.len();
        let completed = sources.is_empty() || crate::file_op_blocking(kind, sources, Some(dest))?;
        Ok(TransferResult {
            completed,
            processed,
            skipped,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_destination_deduplicates_and_prevents_self_transfer() {
        let root = std::env::temp_dir().join(format!(
            "dalizi-drop-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(root.join("source/sub")).unwrap();
        std::fs::create_dir(root.join("dest")).unwrap();
        std::fs::write(root.join("source/sub/样本.txt"), b"fixture").unwrap();
        let s = |p: &str| root.join(p).display().to_string();
        let folder = s("source");
        let file = s("source/sub/样本.txt");
        let dest = s("dest");
        let (items, skipped) =
            prepare("move", &[file.clone(), folder.clone(), file.clone()], &dest).unwrap();
        assert_eq!(items, vec![folder.clone()]);
        assert_eq!(skipped, 2);
        assert!(prepare("move", &[folder.clone()], &s("source/sub")).is_err());
        assert!(prepare("copy", &[folder.clone()], &folder).is_err());
        assert!(prepare("move", &[s("missing")], &dest).is_err());
        assert!(prepare("copy", &[file.clone()], &file).is_err());
        assert!(prepare("move", &[file.clone()], &s("source/sub"))
            .unwrap()
            .0
            .is_empty());
        assert_eq!(
            prepare("copy", &[file.clone()], &s("source/sub"))
                .unwrap()
                .0,
            vec![file]
        );
        for path in [root.join("source/sub/样本.txt")] {
            std::fs::remove_file(path).unwrap();
        }
        for path in [
            root.join("source/sub"),
            root.join("source"),
            root.join("dest"),
            root,
        ] {
            std::fs::remove_dir(path).unwrap();
        }
    }
}
