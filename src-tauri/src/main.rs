// Dalizi Files — a fast, modern Win11-style file explorer
// Backend: Win32 directory enumeration, shell integration, IFileOperation.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agent_profile;
mod ai;
mod browser;
mod index;
mod preview;
mod ssh;
mod ssh_credentials;
mod ssh_managed;
mod term;
mod tray;

use std::path::Path;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_NO_MORE_FILES, FILETIME};
use windows::Win32::Storage::FileSystem::{
    FindClose, FindExInfoBasic, FindExSearchNameMatch, FindFirstFileExW, FindNextFileW,
    GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW,
    FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_REPARSE_POINT,
    FILE_ATTRIBUTE_SYSTEM, FIND_FIRST_EX_LARGE_FETCH, WIN32_FIND_DATAW,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
    COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{
    FOLDERID_Desktop, FOLDERID_Documents, FOLDERID_Downloads, FOLDERID_Music, FOLDERID_Pictures,
    FOLDERID_Videos, FileOperation, IFileOperation, IShellItem, SHCreateItemFromParsingName,
    SHGetKnownFolderPath, ShellExecuteW, FILEOPERATION_FLAGS, FOF_ALLOWUNDO, FOF_NOCONFIRMMKDIR,
    FOF_RENAMEONCOLLISION, KNOWN_FOLDER_FLAG,
};
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn utf16_to_string(buf: &[u16]) -> String {
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..len])
}

fn filetime_to_unix_ms(ft: &FILETIME) -> i64 {
    let v = ((ft.dwHighDateTime as u64) << 32) | ft.dwLowDateTime as u64;
    if v == 0 {
        return 0;
    }
    ((v as i128 - 116_444_736_000_000_000i128) / 10_000) as i64
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    name: String,
    is_dir: bool,
    size: u64,
    mtime: i64,
    ctime: i64,
    atime: i64,
    attributes: u32,
    read_only: bool,
    hidden: bool,
    ext: String,
    dir_size: Option<u64>,
    is_reparse: bool,
}

#[tauri::command]
async fn list_dir(path: String) -> Result<Vec<Entry>, String> {
    tauri::async_runtime::spawn_blocking(move || list_dir_blocking(&path))
        .await
        .map_err(|e| e.to_string())?
}

fn list_dir_blocking(path: &str) -> Result<Vec<Entry>, String> {
    if path.is_empty() {
        return Err("empty path".into());
    }
    unsafe {
        let pattern = if path.ends_with('\\') {
            format!("{}*", path)
        } else {
            format!("{}\\*", path)
        };
        let patw = wide(&pattern);
        let mut fd = WIN32_FIND_DATAW::default();
        let h = match FindFirstFileExW(
            PCWSTR::from_raw(patw.as_ptr()),
            FindExInfoBasic,
            &mut fd as *mut _ as *mut core::ffi::c_void,
            FindExSearchNameMatch,
            None,
            FIND_FIRST_EX_LARGE_FETCH,
        ) {
            Ok(h) => h,
            Err(e)
                if e.code() == windows::core::HRESULT::from_win32(ERROR_FILE_NOT_FOUND.0)
                    && Path::new(path).is_dir() =>
            {
                return Ok(Vec::new())
            }
            Err(e) => return Err(format!("\"{}\": {}", path, e)),
        };

        let mut out: Vec<Entry> = Vec::new();
        loop {
            let name = utf16_to_string(&fd.cFileName);
            if name != "." && name != ".." {
                let attrs = fd.dwFileAttributes;
                let is_dir = attrs & FILE_ATTRIBUTE_DIRECTORY.0 != 0;
                let hidden = attrs & (FILE_ATTRIBUTE_HIDDEN.0 | FILE_ATTRIBUTE_SYSTEM.0) != 0;
                let size = ((fd.nFileSizeHigh as u64) << 32) | fd.nFileSizeLow as u64;
                let ext = if is_dir {
                    String::new()
                } else {
                    match name.rfind('.') {
                        Some(i) if i > 0 && i < name.len() - 1 => name[i + 1..].to_lowercase(),
                        _ => String::new(),
                    }
                };
                out.push(Entry {
                    name,
                    is_dir,
                    size,
                    mtime: filetime_to_unix_ms(&fd.ftLastWriteTime),
                    ctime: filetime_to_unix_ms(&fd.ftCreationTime),
                    atime: filetime_to_unix_ms(&fd.ftLastAccessTime),
                    attributes: attrs,
                    read_only: attrs & 0x1 != 0,
                    hidden,
                    ext,
                    dir_size: None,
                    is_reparse: attrs & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0,
                });
            }
            if let Err(e) = FindNextFileW(h, &mut fd) {
                if e.code() != windows::core::HRESULT::from_win32(ERROR_NO_MORE_FILES.0) {
                    let _ = FindClose(h);
                    return Err(format!("\"{}\": {}", path, e));
                }
                break;
            }
        }
        let _ = FindClose(h);
        // A single memory-only lookup supplies sizes with the initial listing.
        // This path never traverses children or waits for the background scanner.
        let directory_paths: Vec<String> = out
            .iter()
            .filter(|entry| entry.is_dir && !entry.is_reparse)
            .map(|entry| {
                Path::new(path)
                    .join(&entry.name)
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        let sizes = index::cached_sizes(&directory_paths);
        for (entry, size) in out
            .iter_mut()
            .filter(|entry| entry.is_dir && !entry.is_reparse)
            .zip(sizes)
        {
            entry.dir_size = size;
        }
        Ok(out)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QuickPlace {
    key: &'static str,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Drive {
    path: String,
    label: String,
    dtype: &'static str,
    free: u64,
    total: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Roots {
    quick: Vec<QuickPlace>,
    drives: Vec<Drive>,
}

#[tauri::command]
async fn roots() -> Result<Roots, String> {
    tauri::async_runtime::spawn_blocking(roots_blocking)
        .await
        .map_err(|e| e.to_string())?
}

fn roots_blocking() -> Result<Roots, String> {
    unsafe {
        let mut quick = Vec::new();
        let folders: [(&'static str, *const windows::core::GUID); 6] = [
            ("desktop", &FOLDERID_Desktop),
            ("documents", &FOLDERID_Documents),
            ("downloads", &FOLDERID_Downloads),
            ("pictures", &FOLDERID_Pictures),
            ("music", &FOLDERID_Music),
            ("videos", &FOLDERID_Videos),
        ];
        for (key, guid) in folders {
            if let Ok(pw) = SHGetKnownFolderPath(guid, KNOWN_FOLDER_FLAG(0), None) {
                let s = pw.to_string().unwrap_or_default();
                CoTaskMemFree(Some(pw.as_ptr() as *const core::ffi::c_void));
                if !s.is_empty() {
                    quick.push(QuickPlace { key, path: s });
                }
            }
        }
        Ok(Roots {
            quick,
            drives: scan_drives(),
        })
    }
}

pub(crate) fn fixed_drive_roots() -> Vec<String> {
    // Indexing only needs fixed roots; avoid volume-label/free-space queries on
    // disconnected network drives and empty optical drives during startup.
    unsafe {
        let mask = GetLogicalDrives();
        (0..26u32)
            .filter_map(|i| {
                if mask & (1 << i) == 0 {
                    return None;
                }
                let root = format!("{}:\\", (b'A' + i as u8) as char);
                let path = wide(&root);
                (GetDriveTypeW(PCWSTR::from_raw(path.as_ptr())) == 3).then_some(root)
            })
            .collect()
    }
}

fn scan_drives() -> Vec<Drive> {
    let mut drives = Vec::new();
    unsafe {
        let mask = GetLogicalDrives();
        for i in 0..26u32 {
            if mask & (1 << i) == 0 {
                continue;
            }
            let root = format!("{}:\\", (b'A' + i as u8) as char);
            let rw = wide(&root);
            let rpcw = PCWSTR::from_raw(rw.as_ptr());
            let dtype = match GetDriveTypeW(rpcw) {
                2 => "removable",
                3 => "fixed",
                4 => "network",
                5 => "cdrom",
                6 => "ramdisk",
                _ => "unknown",
            };
            let mut label_buf = [0u16; 64];
            let mut label = String::new();
            if GetVolumeInformationW(rpcw, Some(&mut label_buf), None, None, None, None).is_ok() {
                label = utf16_to_string(&label_buf);
            }
            let mut free = 0u64;
            let mut total = 0u64;
            let _ = GetDiskFreeSpaceExW(rpcw, None, Some(&mut total), Some(&mut free));
            drives.push(Drive {
                path: root,
                label,
                dtype,
                free,
                total,
            });
        }
    }
    drives
}

fn shell_execute(verb: &str, file: &str, params: Option<&str>) -> Result<(), String> {
    unsafe {
        let vw = wide(verb);
        let fw = wide(file);
        let pw = params.map(wide);
        let r = ShellExecuteW(
            None,
            PCWSTR::from_raw(vw.as_ptr()),
            PCWSTR::from_raw(fw.as_ptr()),
            pw.as_ref()
                .map(|p| PCWSTR::from_raw(p.as_ptr()))
                .unwrap_or(PCWSTR::null()),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        );
        if r.0 as isize <= 32 {
            Err(format!("shell execute failed ({})", r.0 as isize))
        } else {
            Ok(())
        }
    }
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    shell_execute("open", &path, None)
}

#[tauri::command]
fn open_with(path: String) -> Result<(), String> {
    shell_execute("openas", &path, None)
}

#[tauri::command]
fn reveal(path: String) -> Result<(), String> {
    shell_execute(
        "open",
        "explorer.exe",
        Some(&format!("/select,\"{}\"", path)),
    )
}

const ERROR_CANCELLED_HR: i32 = 0x800704C7u32 as i32;

#[tauri::command]
async fn file_op(kind: String, sources: Vec<String>, dest: Option<String>) -> Result<bool, String> {
    validate_file_op(&kind, &sources, dest.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || file_op_blocking(kind, sources, dest))
        .await
        .map_err(|e| e.to_string())?
}

fn validate_file_op(kind: &str, sources: &[String], dest: Option<&str>) -> Result<(), String> {
    if sources.is_empty() {
        return Err("no sources".into());
    }
    if !matches!(kind, "delete" | "copy" | "move") {
        return Err("invalid operation".into());
    }
    if sources.iter().any(|s| s.is_empty() || s.contains('\0')) {
        return Err("invalid source path".into());
    }
    if kind != "delete" && dest.is_none_or(|d| d.is_empty() || d.contains('\0')) {
        return Err("copy/move requires a valid destination".into());
    }
    Ok(())
}

// A dedicated STA is required by IFileOperation; wait on a blocking worker,
// never on Tauri's UI/command thread. false means cancelled or partly aborted.
fn file_op_blocking(
    kind: String,
    sources: Vec<String>,
    dest: Option<String>,
) -> Result<bool, String> {
    std::thread::spawn(move || -> Result<bool, String> {
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED)
                .ok()
                .map_err(|e| format!("COM init: {:#010x}", e.code().0 as u32))?;
            let result = (|| -> windows::core::Result<bool> {
                let op: IFileOperation = CoCreateInstance(&FileOperation, None, CLSCTX_ALL)?;
                op.SetOperationFlags(FILEOPERATION_FLAGS(
                    FOF_ALLOWUNDO.0 | FOF_RENAMEONCOLLISION.0 | FOF_NOCONFIRMMKDIR.0,
                ))?;
                let dest_item: Option<IShellItem> = match &dest {
                    Some(d) => {
                        let dw = wide(d);
                        Some(SHCreateItemFromParsingName(
                            PCWSTR::from_raw(dw.as_ptr()),
                            None,
                        )?)
                    }
                    None => None,
                };
                for s in &sources {
                    let sw = wide(s);
                    let item: IShellItem =
                        SHCreateItemFromParsingName(PCWSTR::from_raw(sw.as_ptr()), None)?;
                    if kind == "delete" {
                        op.DeleteItem(&item, None)?;
                    } else if kind == "copy" {
                        op.CopyItem(&item, dest_item.as_ref().unwrap(), PCWSTR::null(), None)?;
                    } else {
                        op.MoveItem(&item, dest_item.as_ref().unwrap(), PCWSTR::null(), None)?;
                    }
                }
                op.PerformOperations()?;
                Ok(!op.GetAnyOperationsAborted()?.as_bool())
            })();
            CoUninitialize();
            match result {
                Ok(completed) => Ok(completed),
                Err(e) => {
                    // User closed the native confirm/progress dialog: not an error.
                    if e.code().0 == ERROR_CANCELLED_HR {
                        Ok(false)
                    } else {
                        Err(format!("operation failed: {:#010x}", e.code().0 as u32))
                    }
                }
            }
        }
    })
    .join()
    .map_err(|_| "operation thread panicked".to_string())?
}

#[tauri::command]
fn create_dir(path: String) -> Result<(), String> {
    std::fs::create_dir(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_path(old: String, new: String) -> Result<(), String> {
    std::fs::rename(&old, &new).map_err(|e| e.to_string())
}

struct WatchState(Mutex<Option<notify::RecommendedWatcher>>);

#[tauri::command]
fn watch(path: String, app: AppHandle, state: State<'_, WatchState>) -> Result<(), String> {
    let mut slot = state.0.lock().unwrap();
    if path.is_empty() {
        *slot = None;
        return Ok(());
    }
    // One pending event is enough: a refresh enumerates the whole directory.
    let (tx, rx) = std::sync::mpsc::sync_channel::<()>(1);
    let mut watcher = notify::recommended_watcher(move |_res: notify::Result<notify::Event>| {
        let _ = tx.try_send(());
    })
    .map_err(|e| format!("watcher: {}", e))?;
    notify::Watcher::watch(
        &mut watcher,
        Path::new(&path),
        notify::RecursiveMode::NonRecursive,
    )
    .map_err(|e| format!("watch \"{}\": {}", path, e))?;
    let app2 = app.clone();
    let p = path.clone();
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            std::thread::sleep(std::time::Duration::from_millis(150));
            while rx.try_recv().is_ok() {}
            let _ = app2.emit("fs-changed", p.clone());
        }
    });
    *slot = Some(watcher);
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(WatchState(Mutex::new(None)))
        .manage(browser::BrowserState::default())
        .setup(|app| {
            // If the shell cannot create an icon, keep normal taskbar
            // minimization available instead of hiding an unreachable window.
            if let Err(error) = tray::install(app.handle()) {
                eprintln!("System tray unavailable: {error}");
            }
            agent_profile::init(app.handle());
            let handle = app.handle().clone();
            std::thread::spawn(move || index::startup(&handle));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_dir,
            preview::preview_file,
            roots,
            open_path,
            open_with,
            reveal,
            file_op,
            create_dir,
            rename_path,
            index::dir_sizes,
            index::sizes_lookup,
            index::search_files,
            index::search_status,
            index::search_rebuild,
            ai::ai_plan,
            ai::compaction::ai_compact,
            ai::ai_test_connection,
            ai::ai_cancel,
            ai::ai_discard,
            ai::ai_execute,
            agent_profile::agent_profile,
            agent_profile::agent_skill_import,
            agent_profile::agent_skill_set,
            agent_profile::agent_skill_remove,
            agent_profile::agent_memory_save,
            agent_profile::agent_memory_delete,
            agent_profile::agent_memory_migrate,
            agent_profile::agent_memory_import,
            agent_profile::maintenance::agent_memory_maintain,
            agent_profile::agent_preferences_set,
            agent_profile::agent_pick_skill,
            browser::browser_create,
            browser::browser_set_active,
            browser::browser_navigate,
            browser::browser_action,
            browser::browser_close,
            browser::browser_extensions_list,
            browser::browser_extension_set_enabled,
            browser::browser_extension_remove,
            browser::browser_extension_install,
            browser::browser_settings_apply,
            browser::browser_settings_get,
            browser::browser_clear_data,
            browser::browser_downloads_show,
            watch,
            ssh::ssh_check_client,
            ssh::ssh_start,
            ssh_managed::ssh_probe_host,
            ssh_managed::ssh_trust_host,
            ssh_managed::ssh_forget_credential,
            ssh_managed::ssh_managed_start,
            ssh_managed::ssh_managed_stats,
            ssh_managed::files::ssh_files_list,
            ssh_managed::files::ssh_pick_file,
            ssh_managed::files::ssh_file_transfer,
            ssh_managed::files::ssh_transfer_cancel,
            term::term_start,
            term::term_write,
            term::term_interrupt,
            term::term_resize,
            term::term_kill
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                term::shutdown();
                browser::shutdown(&app.state::<browser::BrowserState>());
                let _ = index::flush_cache();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filetime_handles_dates_before_unix_epoch() {
        let to_ft = |v: u64| FILETIME {
            dwLowDateTime: v as u32,
            dwHighDateTime: (v >> 32) as u32,
        };
        let epoch = 116_444_736_000_000_000u64;
        assert_eq!(filetime_to_unix_ms(&to_ft(0)), 0);
        assert_eq!(filetime_to_unix_ms(&to_ft(epoch)), 0);
        assert_eq!(filetime_to_unix_ms(&to_ft(epoch - 10_000)), -1);
        assert_eq!(filetime_to_unix_ms(&to_ft(epoch + 10_000)), 1);
    }

    #[test]
    fn file_operations_reject_missing_destination_and_invalid_paths() {
        let sources = vec![r"C:\source.txt".to_string()];
        for kind in ["copy", "move"] {
            assert!(validate_file_op(kind, &sources, None).is_err());
            assert!(validate_file_op(kind, &sources, Some("")).is_err());
            assert!(validate_file_op(kind, &sources, Some("C:\\bad\0path")).is_err());
            assert!(validate_file_op(kind, &sources, Some(r"C:\target")).is_ok());
        }
        assert!(validate_file_op("delete", &sources, None).is_ok());
        assert!(validate_file_op("delete", &[], None).is_err());
        assert!(validate_file_op("invalid", &sources, None).is_err());
        assert!(validate_file_op("delete", &["\0".into()], None).is_err());
    }

    #[test]
    fn directory_listing_handles_empty_missing_and_unicode_entries() {
        let path = std::env::temp_dir().join(format!("dalizi-list-test-{}", std::process::id()));
        std::fs::create_dir(&path).unwrap();
        let dir = path.to_str().unwrap();
        assert!(list_dir_blocking(dir).unwrap().is_empty());
        std::fs::write(path.join("中文.txt"), b"abc").unwrap();
        std::fs::create_dir(path.join("folder")).unwrap();
        // The first listing must carry the cached size without traversing the
        // (empty) subtree to replace it. Background work owns revalidation.
        index::seed_for_listing_test(path.join("folder").to_str().unwrap(), 12_345);
        let entries = list_dir_blocking(dir).unwrap();
        assert_eq!(entries.len(), 2);
        let file = entries.iter().find(|e| e.name == "中文.txt").unwrap();
        assert_eq!(file.size, 3);
        assert_eq!(file.ext, "txt");
        assert!(!file.is_dir);
        assert!(file.ctime > 0);
        assert!(file.atime > 0);
        assert_eq!(file.read_only, file.attributes & 0x1 != 0);
        let folder = entries.iter().find(|e| e.name == "folder").unwrap();
        assert!(folder.is_dir);
        assert_eq!(folder.dir_size, Some(12_345));
        assert!(!folder.is_reparse);
        let json = serde_json::to_value(folder).unwrap();
        assert_eq!(json["dirSize"], 12_345);
        assert!(json["ctime"].as_i64().unwrap() > 0);
        assert!(json["atime"].as_i64().unwrap() > 0);
        assert!(json["attributes"].as_u64().unwrap() & FILE_ATTRIBUTE_DIRECTORY.0 as u64 != 0);
        assert!(json["readOnly"].is_boolean());
        std::fs::remove_file(path.join("中文.txt")).unwrap();
        std::fs::remove_dir(path.join("folder")).unwrap();
        std::fs::remove_dir(&path).unwrap();
        assert!(list_dir_blocking(dir).is_err());
    }
}
