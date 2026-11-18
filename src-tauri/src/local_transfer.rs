//! Shell receipts for individually dispatched roots in a local transfer batch.
use crate::external_drop::prepare;
use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
use std::sync::{Arc, Mutex};
use windows::Win32::{
    Foundation::HANDLE,
    Storage::FileSystem::{
        FileIdInfo, GetFileInformationByHandle, GetFileInformationByHandleEx,
        BY_HANDLE_FILE_INFORMATION, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
        FILE_ID_INFO, FILE_READ_ATTRIBUTES,
    },
};
use windows_core::{implement, Ref, HRESULT, HSTRING, PCWSTR};
use windows_shell::Win32::{
    System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
        COINIT_APARTMENTTHREADED,
    },
    UI::Shell::{
        FileOperation, IFileOperation, IFileOperationProgressSink, IFileOperationProgressSink_Impl,
        IShellItem, SHCreateItemFromParsingName, COPYENGINE_S_DONT_PROCESS_CHILDREN, FOF_ALLOWUNDO,
        FOF_NOCONFIRMMKDIR, FOF_RENAMEONCOLLISION, SIGDN_FILESYSPATH,
    },
};

#[tauri::command]
pub async fn local_transfer_plan(
    kind: String,
    sources: Vec<String>,
    dest: String,
) -> Result<Vec<usize>, String> {
    tauri::async_runtime::spawn_blocking(move || ready_indexes(&kind, &sources, &dest))
        .await
        .map_err(|e| e.to_string())?
}

fn ready_indexes(kind: &str, sources: &[String], dest: &str) -> Result<Vec<usize>, String> {
    let (kept, _) = prepare(kind, sources, dest)?;
    let mut kept = kept.iter().peekable();
    Ok(sources
        .iter()
        .enumerate()
        .filter_map(|(i, path)| kept.next_if(|next| *next == path).map(|_| i))
        .collect())
}

// A directory can gain children during a batch. Match its identity, while a
// regular source file also has to retain its recorded size and write time.
pub(crate) fn identity(path: &str, destination: bool) -> Option<String> {
    let flags = FILE_FLAG_BACKUP_SEMANTICS.0
        | if destination {
            0
        } else {
            FILE_FLAG_OPEN_REPARSE_POINT.0
        };
    let file = OpenOptions::new()
        .access_mode(FILE_READ_ATTRIBUTES.0)
        .share_mode(7)
        .custom_flags(flags)
        .open(path)
        .ok()?;
    let handle = HANDLE(file.as_raw_handle());
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    unsafe { GetFileInformationByHandle(handle, &mut info) }.ok()?;
    let mut full = FILE_ID_INFO::default();
    let identity = if unsafe {
        GetFileInformationByHandleEx(
            handle,
            FileIdInfo,
            (&mut full as *mut FILE_ID_INFO).cast(),
            std::mem::size_of::<FILE_ID_INFO>() as u32,
        )
    }
    .is_ok()
        && full.FileId.Identifier.iter().any(|b| *b != 0)
    {
        format!(
            "{:016x}-{:032x}",
            full.VolumeSerialNumber,
            u128::from_le_bytes(full.FileId.Identifier)
        )
    } else if info.nFileIndexHigh != 0 || info.nFileIndexLow != 0 {
        format!(
            "{:08x}-{:08x}{:08x}",
            info.dwVolumeSerialNumber, info.nFileIndexHigh, info.nFileIndexLow
        )
    } else {
        return None;
    };
    let mut key = format!(
        "{}-{:08x}{:08x}",
        identity, info.ftCreationTime.dwHighDateTime, info.ftCreationTime.dwLowDateTime
    );
    if !destination && !file.metadata().ok()?.is_dir() {
        key.push_str(&format!(
            "-{:08x}{:08x}-{:08x}{:08x}",
            info.nFileSizeHigh,
            info.nFileSizeLow,
            info.ftLastWriteTime.dwHighDateTime,
            info.ftLastWriteTime.dwLowDateTime
        ));
    }
    Some(key)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inspection {
    ready: Vec<usize>,
    destination_key: Option<String>,
    source_keys: Vec<Option<String>>,
}
#[tauri::command]
pub async fn local_transfer_inspect(
    view: tauri::Webview,
    kind: String,
    sources: Vec<String>,
    dest: String,
) -> Result<Inspection, String> {
    crate::workspace_identity::local(&view)?;
    tauri::async_runtime::spawn_blocking(move || {
        let ready = ready_indexes(&kind, &sources, &dest)?;
        let destination_key = identity(&dest, true);
        let mut source_keys = vec![None; sources.len()];
        for &index in &ready {
            source_keys[index] = identity(&sources[index], false);
        }
        Ok(Inspection {
            ready,
            destination_key,
            source_keys,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Expected {
    source_key: Option<String>,
    destination_key: Option<String>,
}
fn matches_expected(source: &str, dest: &str, expected: &Expected) -> bool {
    expected
        .destination_key
        .as_ref()
        .is_none_or(|key| identity(dest, true).as_ref() == Some(key))
        && expected
            .source_key
            .as_ref()
            .is_none_or(|key| identity(source, false).as_ref() == Some(key))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    status: &'static str,
    target: Option<String>,
    message: String,
}
impl Receipt {
    fn new(status: &'static str, message: String) -> Self {
        Self {
            status,
            message,
            target: None,
        }
    }
}
fn shell_path(item: &IShellItem) -> Option<String> {
    unsafe {
        let wide = item.GetDisplayName(SIGDN_FILESYSPATH).ok()?;
        let path = wide.to_string().ok();
        CoTaskMemFree(Some(wide.as_ptr().cast()));
        path
    }
}
#[derive(Default)]
struct Report {
    target: Option<String>,
    issue: Option<HRESULT>,
}
#[implement(IFileOperationProgressSink)]
struct Observer {
    root: String,
    report: Arc<Mutex<Report>>,
}
impl Observer_Impl {
    fn record(&self, source: Ref<IShellItem>, result: HRESULT, created: Ref<IShellItem>) {
        let mut report = self.report.lock().unwrap_or_else(|e| e.into_inner());
        if result.0 != 0 && (report.issue.is_none() || result != COPYENGINE_S_DONT_PROCESS_CHILDREN)
        {
            report.issue = Some(result);
        }
        if source.as_ref().and_then(shell_path).as_deref() == Some(self.root.as_str()) {
            report.target = created.as_ref().and_then(shell_path);
        }
    }
}
#[allow(non_snake_case)]
impl IFileOperationProgressSink_Impl for Observer_Impl {
    fn PostCopyItem(
        &self,
        _: u32,
        source: Ref<IShellItem>,
        _: Ref<IShellItem>,
        _: &PCWSTR,
        result: HRESULT,
        created: Ref<IShellItem>,
    ) -> windows_core::Result<()> {
        self.record(source, result, created);
        Ok(())
    }
    fn PostMoveItem(
        &self,
        _: u32,
        source: Ref<IShellItem>,
        _: Ref<IShellItem>,
        _: &PCWSTR,
        result: HRESULT,
        created: Ref<IShellItem>,
    ) -> windows_core::Result<()> {
        self.record(source, result, created);
        Ok(())
    }
    fn StartOperations(&self) -> windows_core::Result<()> {
        Ok(())
    }
    fn FinishOperations(&self, result: HRESULT) -> windows_core::Result<()> {
        if result.is_err() {
            self.report.lock().unwrap_or_else(|e| e.into_inner()).issue = Some(result);
        }
        Ok(())
    }
    fn PreRenameItem(&self, _: u32, _: Ref<IShellItem>, _: &PCWSTR) -> windows_core::Result<()> {
        Ok(())
    }
    fn PostRenameItem(
        &self,
        _: u32,
        _: Ref<IShellItem>,
        _: &PCWSTR,
        _: HRESULT,
        _: Ref<IShellItem>,
    ) -> windows_core::Result<()> {
        Ok(())
    }
    fn PreMoveItem(
        &self,
        _: u32,
        _: Ref<IShellItem>,
        _: Ref<IShellItem>,
        _: &PCWSTR,
    ) -> windows_core::Result<()> {
        Ok(())
    }
    fn PreCopyItem(
        &self,
        _: u32,
        _: Ref<IShellItem>,
        _: Ref<IShellItem>,
        _: &PCWSTR,
    ) -> windows_core::Result<()> {
        Ok(())
    }
    fn PreDeleteItem(&self, _: u32, _: Ref<IShellItem>) -> windows_core::Result<()> {
        Ok(())
    }
    fn PostDeleteItem(
        &self,
        _: u32,
        _: Ref<IShellItem>,
        _: HRESULT,
        _: Ref<IShellItem>,
    ) -> windows_core::Result<()> {
        Ok(())
    }
    fn PreNewItem(&self, _: u32, _: Ref<IShellItem>, _: &PCWSTR) -> windows_core::Result<()> {
        Ok(())
    }
    fn PostNewItem(
        &self,
        _: u32,
        _: Ref<IShellItem>,
        _: &PCWSTR,
        _: &PCWSTR,
        _: u32,
        _: HRESULT,
        _: Ref<IShellItem>,
    ) -> windows_core::Result<()> {
        Ok(())
    }
    fn UpdateProgress(&self, _: u32, _: u32) -> windows_core::Result<()> {
        Ok(())
    }
    fn ResetTimer(&self) -> windows_core::Result<()> {
        Ok(())
    }
    fn PauseTimer(&self) -> windows_core::Result<()> {
        Ok(())
    }
    fn ResumeTimer(&self) -> windows_core::Result<()> {
        Ok(())
    }
}
unsafe fn transfer(kind: &str, source: &str, dest: &str) -> windows_core::Result<Receipt> {
    let moved_type = if kind == "move" {
        std::fs::symlink_metadata(source)
            .ok()
            .map(|m| m.file_type())
    } else {
        None
    };
    let op: IFileOperation = CoCreateInstance(&FileOperation, None, CLSCTX_ALL)?;
    op.SetOperationFlags(FOF_ALLOWUNDO | FOF_RENAMEONCOLLISION | FOF_NOCONFIRMMKDIR)?;
    let from: IShellItem = SHCreateItemFromParsingName(&HSTRING::from(source), None)?;
    let to: IShellItem = SHCreateItemFromParsingName(&HSTRING::from(dest), None)?;
    let report = Arc::new(Mutex::new(Report::default()));
    let observer: IFileOperationProgressSink = Observer {
        root: shell_path(&from)
            .ok_or_else(|| windows_core::Error::from_hresult(HRESULT(0x80070057_u32 as i32)))?,
        report: report.clone(),
    }
    .into();
    if kind == "move" {
        op.MoveItem(&from, &to, PCWSTR::null(), None)?;
    } else {
        op.CopyItem(&from, &to, PCWSTR::null(), None)?;
    }
    // Subscribe to child operations as well as the selected directory.
    let cookie = op.Advise(&observer)?;
    // From this point on an error can mean a partly written directory.
    let performed = op.PerformOperations();
    let aborted = op.GetAnyOperationsAborted();
    let _ = op.Unadvise(cookie);
    let report = report.lock().unwrap_or_else(|e| e.into_inner());
    let code = performed
        .err()
        .or_else(|| aborted.as_ref().err().cloned())
        .map(|e| e.code())
        .or_else(|| {
            report.issue.filter(|code| {
                // Explorer also returns DONT_PROCESS_CHILDREN when a single file
                // is moved as one unit. Require the Shell-reported target and
                // the original item's disappearance for this success code.
                !(*code == COPYENGINE_S_DONT_PROCESS_CHILDREN
                    && moved_type.is_some()
                    && matches!(std::fs::symlink_metadata(source), Err(e) if e.kind() == std::io::ErrorKind::NotFound)
                    && report
                        .target
                        .as_ref()
                        .and_then(|p| std::fs::symlink_metadata(p).ok())
                        .map(|m| m.file_type())
                        == moved_type)
            })
        });
    let complete = code.is_none() && aborted.is_ok_and(|v| !v.as_bool()) && report.target.is_some();
    Ok(Receipt {
        status: if complete { "complete" } else { "verify" },
        target: report.target.clone(),
        message: code
            .map(|hr| format!("Windows 0x{:08X}", hr.0 as u32))
            .unwrap_or_default(),
    })
}
fn dispatch(kind: &str, source: String, dest: &str) -> Receipt {
    match prepare(kind, std::slice::from_ref(&source), dest) {
        Ok((items, _)) if items.is_empty() => return Receipt::new("skipped", String::new()),
        Err(error) => return Receipt::new("failed", error),
        _ => {}
    }
    unsafe {
        if let Err(e) = CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok() {
            return Receipt::new("failed", e.to_string());
        }
        let result = transfer(kind, &source, dest);
        CoUninitialize();
        result.unwrap_or_else(|e| Receipt::new("failed", e.to_string()))
    }
}
#[tauri::command]
pub async fn local_transfer_item(
    view: tauri::Webview,
    kind: String,
    source: String,
    dest: String,
    expected: Option<Expected>,
) -> Result<Receipt, String> {
    crate::workspace_identity::local(&view)?;
    // A fresh STA keeps Explorer UI off the runtime and avoids an existing MTA.
    tauri::async_runtime::spawn_blocking(move || {
        std::thread::spawn(move || {
            if expected.is_some_and(|stamp| !matches_expected(&source, &dest, &stamp)) {
                return Receipt::new(
                    "failed",
                    "源或目标已变化，请重新核对 / Source or destination changed".into(),
                );
            }
            dispatch(&kind, source, &dest)
        })
        .join()
        .map_err(|_| "Shell worker interrupted".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn recovery_detects_replaced_sources_and_targets_but_allows_destination_children() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("file.txt");
        let dest = root.path().join("dest");
        fs::write(&source, b"before").unwrap();
        fs::create_dir(&dest).unwrap();
        let (s, d) = (source.to_str().unwrap(), dest.to_str().unwrap());
        let expected = Expected {
            source_key: Some(identity(s, false).unwrap()),
            destination_key: Some(identity(d, true).unwrap()),
        };
        fs::write(dest.join("sibling"), b"between jobs").unwrap();
        assert!(matches_expected(s, d, &expected));
        fs::rename(&dest, root.path().join("saved-dir")).unwrap();
        fs::create_dir(&dest).unwrap();
        assert!(!matches_expected(s, d, &expected));
        fs::remove_dir(&dest).unwrap();
        fs::rename(root.path().join("saved-dir"), &dest).unwrap();
        fs::rename(&source, root.path().join("original")).unwrap();
        fs::write(&source, b"before").unwrap();
        assert!(!matches_expected(s, d, &expected));
        fs::remove_file(&source).unwrap();
        fs::rename(root.path().join("original"), &source).unwrap();
        fs::write(&source, b"new content").unwrap();
        assert!(!matches_expected(s, d, &expected));
    }

    #[test]
    fn shell_receipts_identify_collision_names_and_moved_directories() {
        let root = tempfile::tempdir().unwrap();
        let dest = root.path().join("target");
        fs::create_dir(&dest).unwrap();
        let file = root.path().join("样本.txt");
        fs::write(&file, b"new").unwrap();
        fs::write(dest.join("样本.txt"), b"keep").unwrap();
        let copy = dispatch("copy", file.display().to_string(), dest.to_str().unwrap());
        assert_eq!(
            copy.status, "complete",
            "{:?} {}",
            copy.target, copy.message
        );
        let actual = copy.target.unwrap();
        assert_eq!(fs::read(actual).unwrap(), b"new");
        assert_eq!(fs::read(dest.join("样本.txt")).unwrap(), b"keep");
        let moved_file = dispatch("move", file.display().to_string(), dest.to_str().unwrap());
        assert_eq!(
            moved_file.status, "complete",
            "{:?} {}",
            moved_file.target, moved_file.message
        );
        assert_eq!(fs::read(moved_file.target.unwrap()).unwrap(), b"new");
        assert!(!file.exists());
        let folder = root.path().join("folder");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("nested.txt"), b"nested").unwrap();
        let copied_dir = dispatch("copy", folder.display().to_string(), dest.to_str().unwrap());
        assert_eq!(
            copied_dir.status, "complete",
            "{:?} {}",
            copied_dir.target, copied_dir.message
        );
        let moved = dispatch("move", folder.display().to_string(), dest.to_str().unwrap());
        assert_eq!(
            moved.status, "complete",
            "{:?} {}",
            moved.target, moved.message
        );
        assert!(!folder.exists());
        assert_eq!(
            fs::read(std::path::Path::new(&moved.target.unwrap()).join("nested.txt")).unwrap(),
            b"nested"
        );
        let missing = dispatch("copy", folder.display().to_string(), dest.to_str().unwrap());
        assert_eq!(missing.status, "failed");
    }
}
