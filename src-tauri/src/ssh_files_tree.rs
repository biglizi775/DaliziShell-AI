//! Bounded read-only traversal. Symlinks/junctions are never followed.
use super::{
    batch::{windows_name, BatchFile},
    *,
};
use std::{collections::HashSet, os::windows::fs::MetadataExt};
const LIMIT: usize = 2000;
pub(super) fn local_chain(path: &Path) -> Result<(), String> {
    if !crate::preview::ordinary_path(path) || !path.is_absolute() {
        return Err("请选择绝对普通路径 / Absolute ordinary path required".into());
    }
    for parent in path.ancestors() {
        match std::fs::symlink_metadata(parent) {
            Ok(m) if m.file_attributes() & 0x400 != 0 => {
                return Err(format!(
                    "不跟随链接或目录联接 / Link or junction: {}",
                    parent.display()
                ))
            }
            Ok(_) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}
pub(super) async fn remote_chain(sftp: &SftpSession, path: &str) -> Result<(), String> {
    remote_path(path)?;
    // realpath returns the absolute root during preparation; recheck each existing component at execution.
    let mut current = if path.starts_with('/') {
        "/".to_owned()
    } else {
        String::new()
    };
    for name in path.split('/').filter(|x| !x.is_empty()) {
        if name == "." || name == ".." {
            return Err("远端路径包含相对分量 / Relative remote component".into());
        }
        current = if current.is_empty() {
            name.into()
        } else {
            join(&current, name)
        };
        let m = sftp
            .symlink_metadata(&current)
            .await
            .map_err(|e| e.to_string())?;
        if m.is_symlink() {
            return Err(format!("不跟随远端链接 / Remote symlink: {current}"));
        }
    }
    Ok(())
}
fn bound(count: usize, depth: usize) -> Result<(), String> {
    if count >= LIMIT || depth > 32 {
        Err(
            "目录任务最多 2000 项、32 层；请缩小选择范围 / Tree limit: 2000 entries, 32 levels"
                .into(),
        )
    } else {
        Ok(())
    }
}
fn upload_tree(paths: Vec<String>, remote: String) -> Result<Vec<BatchFile>, String> {
    let mut pending: Vec<_> = paths
        .into_iter()
        .rev()
        .map(|p| (PathBuf::from(p), remote.clone(), String::new(), 0))
        .collect();
    let mut result = Vec::new();
    let mut targets = HashSet::new();
    while let Some((path, parent, prefix, depth)) = pending.pop() {
        bound(result.len(), depth)?;
        local_chain(&path)?;
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or("Invalid file name")?
            .to_owned();
        windows_name(&name)?;
        let target = join(&parent, &name);
        if !targets.insert(target.to_lowercase()) {
            return Err("目标目录重叠或同名 / Overlapping destinations".into());
        }
        let m = std::fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if !m.is_file() && !m.is_dir() {
            return Err("仅支持普通文件与目录 / Regular files and folders only".into());
        }
        let label = if prefix.is_empty() {
            name
        } else {
            join(&prefix, &name)
        };
        result.push(BatchFile {
            name: label.clone(),
            local_path: path.to_string_lossy().into(),
            remote: parent,
            size: Some(if m.is_dir() { 0 } else { m.len() }),
            entry_kind: if m.is_dir() { "directory" } else { "file" }.into(),
        });
        if m.is_dir() {
            let mut children = Vec::new();
            for child in std::fs::read_dir(&path).map_err(|e| e.to_string())? {
                bound(result.len() + pending.len() + children.len(), depth + 1)?;
                children.push(child.map_err(|e| e.to_string())?.path());
            }
            children.sort();
            for child in children.into_iter().rev() {
                pending.push((child, target.clone(), label.clone(), depth + 1));
            }
        }
    }
    Ok(result)
}
pub(super) async fn prepare_tree(
    id: u32,
    direction: String,
    paths: Vec<String>,
    directory: Option<String>,
    remote: String,
) -> Result<Vec<BatchFile>, String> {
    if paths.is_empty() || paths.len() > 200 {
        return Err("每次选择 1–200 个项目 / Select 1–200 items".into());
    }
    let session = get(id)?;
    let sftp = sftp(&session).await?;
    let remote = sftp
        .canonicalize(&remote)
        .await
        .map_err(|e| e.to_string())?;
    remote_chain(&sftp, &remote).await?;
    if direction == "upload" {
        return tauri::async_runtime::spawn_blocking(move || upload_tree(paths, remote))
            .await
            .map_err(|e| e.to_string())?;
    }
    if direction != "download" {
        return Err("Invalid direction".into());
    }
    let directory = PathBuf::from(directory.ok_or("请选择本地目录")?);
    local_chain(&directory)?;
    if !directory.is_dir() {
        return Err("本地目录不存在".into());
    }
    let task = async {
        let mut pending = Vec::new();
        for name in paths.into_iter().rev() {
            windows_name(&name)?;
            pending.push((join(&remote, &name), directory.join(&name), name, 0));
        }
        let mut result = Vec::new();
        let mut targets = HashSet::new();
        while let Some((path, local, label, depth)) = pending.pop() {
            bound(result.len(), depth)?;
            local_chain(&local)?;
            if !targets.insert(local.to_string_lossy().to_lowercase()) {
                return Err("Windows 同名或目录重叠 / Conflicting Windows destinations".into());
            }
            let m = sftp
                .symlink_metadata(&path)
                .await
                .map_err(|e| e.to_string())?;
            if m.is_symlink() || (!m.is_dir() && !m.is_regular()) {
                return Err(format!("不支持链接或特殊文件 / Unsupported entry: {path}"));
            }
            result.push(BatchFile {
                name: label.clone(),
                local_path: local.to_string_lossy().into(),
                remote: path.clone(),
                size: if m.is_dir() { Some(0) } else { m.size },
                entry_kind: if m.is_dir() { "directory" } else { "file" }.into(),
            });
            if m.is_dir() {
                let listing = ssh_files_list(id, path.clone()).await?;
                if listing.truncated {
                    return Err("目录过大，请缩小范围 / Directory truncated".into());
                }
                for item in listing.entries.into_iter().rev() {
                    windows_name(&item.name)?;
                    bound(result.len() + pending.len(), depth + 1)?;
                    pending.push((
                        join(&path, &item.name),
                        local.join(&item.name),
                        join(&label, &item.name),
                        depth + 1,
                    ));
                }
            }
        }
        Ok(result)
    };
    tokio::time::timeout(Duration::from_secs(60), task)
        .await
        .map_err(|_| "目录扫描超时，请缩小范围 / Tree scan timed out")?
}
pub(super) async fn create_directory(
    session: &Session,
    direction: &str,
    local: &Path,
    remote: &str,
) -> Result<(), String> {
    local_chain(local)?;
    let sftp = sftp(session).await?;
    let target = if direction == "upload" {
        if !local.is_dir() {
            return Err("源目录已变化 / Source folder changed".into());
        }
        remote_chain(&sftp, remote).await?;
        join(
            remote,
            local
                .file_name()
                .and_then(|s| s.to_str())
                .ok_or("Invalid directory")?,
        )
    } else {
        remote_chain(&sftp, remote).await?;
        if !sftp
            .symlink_metadata(remote)
            .await
            .map_err(|e| e.to_string())?
            .is_dir()
        {
            return Err("远端目录已变化 / Remote folder changed".into());
        }
        if local.is_dir() {
            return Ok(());
        }
        return std::fs::create_dir(local).map_err(|e| e.to_string());
    };
    if sftp.try_exists(&target).await.map_err(|e| e.to_string())? {
        let m = sftp
            .symlink_metadata(&target)
            .await
            .map_err(|e| e.to_string())?;
        if m.is_dir() && !m.is_symlink() {
            return Ok(());
        }
        return Err("目标存在非普通目录 / Destination is not a regular directory".into());
    }
    sftp.create_dir(&target).await.map_err(|e| e.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tree_is_preorder_bounded_and_keeps_empty_directories() {
        let root = std::env::temp_dir().join(format!("dalizi-tree-{}", nonce().unwrap()));
        std::fs::create_dir(&root).unwrap();
        std::fs::create_dir(root.join("empty")).unwrap();
        std::fs::write(root.join("a.txt"), "abc").unwrap();
        let items = upload_tree(vec![root.to_string_lossy().into()], "/".into()).unwrap();
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].entry_kind, "directory");
        assert_eq!(items[1].size, Some(3));
        assert_eq!(items[2].entry_kind, "directory");
        assert!(bound(2000, 0).is_err());
        assert!(bound(0, 33).is_err());
        assert!(upload_tree(
            vec![root.to_string_lossy().into(), root.to_string_lossy().into()],
            "/".into()
        )
        .is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
