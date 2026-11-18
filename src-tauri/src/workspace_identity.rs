//! Local directory identity and short directory locks shared by transfer history and recovery.
use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::io;
use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
use std::os::windows::io::AsRawHandle;
use std::path::{Component, Path, Prefix};
use tauri::Webview;
use windows_sys::Win32::Storage::FileSystem::{
    GetDriveTypeW, GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
};

fn invalid(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Workspace {
    pub path: String,
    pub identity: String,
}

/// Commands that touch local files accept calls only from the bundled main window.
pub(crate) fn local(view: &Webview) -> Result<(), String> {
    let url = view.url().map_err(|_| "无法核实窗口来源")?;
    if view.label() != "main"
        || url.host_str() != Some("tauri.localhost")
        || !matches!(url.scheme(), "http" | "https")
    {
        return Err("仅允许本地主窗口操作文件任务".into());
    }
    Ok(())
}

/// Keep directory names stable for a short transaction by denying DELETE sharing.
/// WRITE sharing stays on because Windows needs it to rename child files.
pub(crate) fn lock_directory(path: &Path) -> Result<File, String> {
    let io_error = |error: io::Error| format!("无法访问目录，请检查权限、只读属性或文件占用 / Directory I/O failed: {} · {error}", path.display());
    let file = OpenOptions::new()
        .read(true)
        .share_mode(3)
        .custom_flags(0x02000000 | 0x00200000)
        .open(path)
        .map_err(io_error)?;
    let metadata = file.metadata().map_err(io_error)?;
    if !metadata.is_dir() || metadata.file_attributes() & 0x400 != 0 {
        return Err("目录无效或已变化 / Directory is invalid or changed".into());
    }
    Ok(file)
}

fn info(file: &File) -> io::Result<BY_HANDLE_FILE_INFORMATION> {
    let mut result = BY_HANDLE_FILE_INFORMATION::default();
    // The live file owns its handle throughout this non-retaining Win32 call.
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut result) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(result)
}

fn identity(meta: &BY_HANDLE_FILE_INFORMATION) -> String {
    format!(
        "{:08x}:{:08x}{:08x}",
        meta.dwVolumeSerialNumber, meta.nFileIndexHigh, meta.nFileIndexLow
    )
}

fn open_dir(path: &Path, share_mode: u32) -> io::Result<File> {
    let file = OpenOptions::new()
        .read(true)
        .share_mode(share_mode)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)?;
    let meta = file.metadata()?;
    if !meta.is_dir() || meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(invalid("不能使用链接目录"));
    }
    Ok(file)
}

fn valid_part(part: &str) -> bool {
    let stem = part
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end()
        .to_ascii_uppercase();
    !part.is_empty()
        && part != "."
        && part != ".."
        && !part.ends_with([' ', '.'])
        && !part.eq_ignore_ascii_case(".dalizi")
        && !part
            .chars()
            .any(|c| c.is_control() || "<>:\"|?*".contains(c))
        && !matches!(
            stem.as_str(),
            "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
        )
        && !["COM", "LPT"].iter().any(|p| {
            stem.strip_prefix(p).is_some_and(|s| {
                s.len() == 1 && s.as_bytes()[0].is_ascii_digit() || matches!(s, "¹" | "²" | "³")
            })
        })
}

fn root_handles(root: &Path, share_mode: u32) -> io::Result<(Workspace, Vec<File>)> {
    let raw = root
        .to_str()
        .ok_or_else(|| invalid("目录名称不是 Unicode 文本"))?;
    let mut parts = root.components();
    if !matches!(parts.next(), Some(Component::Prefix(p)) if matches!(p.kind(), Prefix::Disk(_)))
        || parts.next() != Some(Component::RootDir)
        || raw.get(3..).is_none_or(|s| {
            s.trim_end_matches(['/', '\\'])
                .split(['/', '\\'])
                .filter(|s| !s.is_empty())
                .any(|s| !valid_part(s))
        })
    {
        return Err(invalid("请选择普通本地盘符目录"));
    }
    let drive = [u16::from(raw.as_bytes()[0]), 58, 92, 0];
    // DRIVE_FIXED or DRIVE_REMOVABLE: a mapped network share likewise has a drive letter.
    if !matches!(unsafe { GetDriveTypeW(drive.as_ptr()) }, 2 | 3) {
        return Err(invalid("仅支持本机磁盘上的普通目录"));
    }
    let mut guards = Vec::new();
    for dir in root.ancestors().collect::<Vec<_>>().into_iter().rev() {
        guards.push(open_dir(dir, share_mode)?);
    }
    let meta = info(guards.last().ok_or_else(|| invalid("缺少目录"))?)?;
    let canonical = root.canonicalize()?;
    let spelled = canonical.to_str().ok_or_else(|| invalid("目录名称无效"))?;
    let path = spelled.strip_prefix(r"\\?\").unwrap_or(spelled).to_string();
    Ok((
        Workspace {
            path,
            identity: identity(&meta),
        },
        guards,
    ))
}

/// Identify a directory by its actual volume and file ID, not by the tab label.
pub fn identify(root: &Path) -> io::Result<Workspace> {
    Ok(root_handles(root, 3)?.0)
}

/// Keep directory identities stable while allowing child files to be published.
/// Windows rename needs WRITE sharing on the parent. DELETE sharing stays off.
pub fn pin_workspace(expected: &Workspace) -> io::Result<Vec<File>> {
    let (actual, guards) = root_handles(Path::new(&expected.path), 3)?;
    if &actual != expected {
        return Err(invalid("目录身份已改变，请重新预览"));
    }
    Ok(guards)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn replacement_directory_does_not_inherit_the_same_identity() {
        let parent = tempfile::tempdir().unwrap();
        let root = parent.path().join("project");
        fs::create_dir(&root).unwrap();
        let first = identify(&root).unwrap();
        assert!(pin_workspace(&first).is_ok());
        fs::rename(&root, parent.path().join("original")).unwrap();
        fs::create_dir(&root).unwrap();
        let next = identify(&root).unwrap();
        assert_eq!(first.path, next.path);
        assert_ne!(first.identity, next.identity);
        assert!(pin_workspace(&first).is_err());
    }

    #[test]
    fn reserved_names_and_locked_files_are_rejected() {
        let parent = tempfile::tempdir().unwrap();
        let reserved = parent.path().join(".dalizi");
        fs::create_dir(&reserved).unwrap();
        assert!(identify(&reserved).is_err());
        let file = parent.path().join("plain.txt");
        fs::write(&file, "x").unwrap();
        assert!(lock_directory(&file).is_err());
        assert!(lock_directory(parent.path()).is_ok());
    }
}
