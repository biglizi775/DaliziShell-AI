//! Freeze explicitly selected local text files while their directory names are locked.
use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::io::{self, Read};
use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
use std::os::windows::io::AsRawHandle;
use std::path::{Component, Path, PathBuf, Prefix};
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
#[derive(Clone, Debug, Serialize)]
pub struct Reference {
    pub name: String,
    pub text: String,
    // The physical identity is host-only; never put it into a model prompt.
    #[serde(skip)]
    pub identity: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct Snapshot {
    pub workspace: Workspace,
    pub files: Vec<Reference>,
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

pub fn file_identity(file: &File) -> io::Result<String> {
    Ok(identity(&info(file)?))
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

/// Keep the reviewed workspace and every ancestor in place through a write or undo.
pub fn lock_workspace(expected: &Workspace) -> io::Result<Vec<File>> {
    lock_expected(expected, 1)
}

/// Keep directory identities stable while allowing child files to be published.
/// Windows rename needs WRITE sharing on the parent. DELETE sharing stays off.
pub fn pin_workspace(expected: &Workspace) -> io::Result<Vec<File>> {
    lock_expected(expected, 3)
}
fn lock_expected(expected: &Workspace, share_mode: u32) -> io::Result<Vec<File>> {
    let (actual, guards) = root_handles(Path::new(&expected.path), share_mode)?;
    if &actual != expected {
        return Err(invalid("目录身份已改变，请重新预览"));
    }
    Ok(guards)
}

/// Capture one to three regular UTF-8 .txt/.md files, at most 64 KiB total.
pub fn capture(root: &Path, selection: &[String]) -> io::Result<Snapshot> {
    if !(1..=3).contains(&selection.len()) {
        return Err(invalid("请选择 1 到 3 个 Markdown 或 TXT 文件"));
    }
    let (workspace, _root_guards) = root_handles(root, 1)?;
    let mut files = Vec::new();
    let mut total = 0;
    let mut ids = std::collections::HashSet::new();
    for name in selection {
        if name.len() > 16000 || !name.split(['/', '\\']).all(valid_part) {
            return Err(invalid("无效的目录内相对路径"));
        }
        let rel = PathBuf::from(name);
        if !rel
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("txt"))
        {
            return Err(invalid("仅支持 TXT 和 Markdown"));
        }
        let mut at = root.to_owned();
        let mut guards = Vec::new();
        for part in rel.parent().into_iter().flat_map(Path::components) {
            at.push(part);
            guards.push(open_dir(&at, 1)?);
        }
        let file = OpenOptions::new()
            .read(true)
            .share_mode(1)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(root.join(&rel))?;
        let meta = file.metadata()?;
        let ident = info(&file)?;
        if !meta.is_file()
            || meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || ident.nNumberOfLinks != 1
            || meta.len() > 32768
        {
            return Err(invalid("仅支持不超过 32 KiB 的普通单链接文件"));
        }
        if !ids.insert((
            ident.dwVolumeSerialNumber,
            ident.nFileIndexHigh,
            ident.nFileIndexLow,
        )) {
            return Err(invalid("重复的文件"));
        }
        let mut text = String::new();
        file.take(32769).read_to_string(&mut text)?;
        total += text.len();
        if text.len() > 32768 || total > 65536 || text.contains('\0') {
            return Err(invalid("不是有效文本，或快照超过大小限制"));
        }
        files.push(Reference {
            name: name.clone(),
            text,
            identity: identity(&ident),
        });
    }
    Ok(Snapshot { workspace, files })
}
