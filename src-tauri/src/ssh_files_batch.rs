//! Preparing a batch only validates and describes files; it never transfers them.
use super::{leaf, remote_path};
use serde::Serialize;
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchFile {
    pub(super) name: String,
    pub(super) local_path: String,
    pub(super) remote: String,
    pub(super) size: Option<u64>,
    pub(super) entry_kind: String,
}

pub(super) fn windows_name(name: &str) -> Result<(), String> {
    leaf(name)?;
    if name.ends_with(['.', ' '])
        || name.contains([':', '*', '?', '"', '<', '>', '|'])
        || !crate::preview::ordinary_path(&Path::new("C:\\").join(name))
    {
        return Err(format!(
            "Windows 无法保存此文件名，请先在远端改名：{name} / Invalid Windows filename"
        ));
    }
    Ok(())
}
fn prepare(
    direction: &str,
    paths: Vec<String>,
    directory: Option<String>,
    remote: &str,
) -> Result<Vec<BatchFile>, String> {
    remote_path(remote)?;
    if !matches!(direction, "upload" | "download") || paths.is_empty() || paths.len() > 200 {
        return Err("每批请选择 1–200 个普通文件 / Select 1–200 regular files per batch".into());
    }
    let destination = if direction == "download" {
        let p = PathBuf::from(directory.ok_or("请选择本地保存目录 / Select a local folder")?);
        if !crate::preview::ordinary_path(&p) || !p.is_dir() {
            return Err("本地目录无效 / Invalid local directory".into());
        }
        Some(p)
    } else {
        None
    };
    let mut names = HashSet::new();
    let mut result = Vec::new();
    for input in paths {
        let (name, local, target, size) = if let Some(dir) = &destination {
            windows_name(&input)?;
            (
                input.clone(),
                dir.join(&input),
                super::join(remote, &input),
                None,
            )
        } else {
            let p = PathBuf::from(&input);
            if !crate::preview::ordinary_path(&p) {
                return Err("上传路径无效 / Invalid upload path".into());
            }
            let name = p
                .file_name()
                .and_then(|n| n.to_str())
                .ok_or("Invalid filename")?
                .to_owned();
            leaf(&name)?;
            let file = crate::preview::open_regular_file(&p).map_err(|e| format!("{name}: {e}"))?;
            let metadata = file.metadata().map_err(|e| e.to_string())?;
            if !metadata.is_file() {
                return Err(
                    "批量传输仅支持普通文件 / Batch transfer supports regular files only".into(),
                );
            }
            (name, p, remote.to_owned(), Some(metadata.len()))
        };
        if !names.insert(name.to_lowercase()) {
            return Err(format!(
                "本批存在同名目标，请分开处理：{name} / Duplicate destination filename"
            ));
        }
        result.push(BatchFile {
            entry_kind: "file".into(),
            name,
            local_path: local.to_string_lossy().into(),
            remote: target,
            size,
        });
    }
    Ok(result)
}
#[tauri::command]
pub async fn ssh_transfer_prepare(
    id: u32,
    direction: String,
    paths: Vec<String>,
    directory: Option<String>,
    remote: String,
    recursive: Option<bool>,
) -> Result<Vec<BatchFile>, String> {
    let _session = super::get(id)?;
    if recursive.unwrap_or(false) { return super::tree::prepare_tree(id, direction, paths, directory, remote).await; }
    tauri::async_runtime::spawn_blocking(move || prepare(&direction, paths, directory, &remote))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn ssh_pick_upload_files() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let paths = rfd::FileDialog::new()
            .set_title("选择上传文件（最多 200 个）/ Upload files")
            .pick_files()
            .unwrap_or_default();
        if paths.len() > 200 {
            return Err("每批最多 200 个文件 / Maximum 200 files per batch".into());
        }
        Ok(paths
            .into_iter()
            .map(|p| p.to_string_lossy().into())
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn ssh_pick_download_directory() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        Ok(rfd::FileDialog::new()
            .set_title("选择批量下载保存目录 / Download folder")
            .pick_folder()
            .map(|p| p.to_string_lossy().into()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remote_names_cannot_escape_or_alias_a_windows_destination() {
        for name in [
            "../a", "a/b", "a\\b", "CON.txt", "lpt1", "COM¹", "a:b", "bad.", "bad ", "bad?", "a\0b",
        ] {
            assert!(windows_name(name).is_err(), "{name}");
        }
        assert!(windows_name("中文 & 'quoted'.txt").is_ok());
    }
    #[test]
    fn preparation_is_bounded_non_mutating_and_rejects_duplicate_destinations() {
        let root =
            std::env::temp_dir().join(format!("dalizi-batch-{}", super::super::nonce().unwrap()));
        std::fs::create_dir(&root).unwrap();
        let dir = root.to_string_lossy().into_owned();
        let files = prepare(
            "download",
            vec!["中文.txt".into()],
            Some(dir.clone()),
            "/folder",
        )
        .unwrap();
        assert_eq!(files[0].remote, "/folder/中文.txt");
        assert!(!root.join("中文.txt").exists());
        assert!(prepare(
            "download",
            vec!["A.txt".into(), "a.TXT".into()],
            Some(dir.clone()),
            "/"
        )
        .is_err());
        assert!(prepare("download", vec!["x".into(); 201], Some(dir.clone()), "/").is_err());
        let file = root.join("source.txt");
        std::fs::write(&file, "hello").unwrap();
        let uploads = prepare(
            "upload",
            vec![file.to_string_lossy().into()],
            None,
            "/upload",
        )
        .unwrap();
        assert_eq!(uploads[0].size, Some(5));
        assert_eq!(std::fs::read_to_string(file).unwrap(), "hello");
        assert!(prepare("upload", vec![dir], None, "/").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
