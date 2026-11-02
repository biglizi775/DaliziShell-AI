//! Bounded SFTP browsing and streamed, cancellable single-file transfers.
use super::{get, nonce, Session};
use std::{path::{Path, PathBuf}, sync::{Arc, Mutex}, time::{Duration, Instant}};
use russh_sftp::{client::{SftpSession, RawSftpSession, error::Error}, protocol::{OpenFlags, StatusCode}};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, sync::watch};

fn remote_path(path: &str) -> Result<(), String> {
    if path.is_empty() || path.len() > 4096 || path.contains('\0') { return Err("远程路径无效 / Invalid remote path".into()); }
    Ok(())
}
fn leaf(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 255 || name == "." || name == ".." || name.contains(['/', '\\']) || name.chars().any(char::is_control) { return Err("文件名无效 / Invalid file name".into()); }
    Ok(())
}
fn join(parent: &str, name: &str) -> String { format!("{}/{}", parent.trim_end_matches('/'), name) }
async fn stream(session: &Session) -> Result<russh::ChannelStream<russh::client::Msg>, String> {
    let mut channel = session.handle.channel_open_session().await.map_err(|e| e.to_string())?;
    channel.request_subsystem(true, "sftp").await.map_err(|e| e.to_string())?;
    match tokio::time::timeout(Duration::from_secs(10), channel.wait()).await {
        Ok(Some(russh::ChannelMsg::Success)) => Ok(channel.into_stream()),
        _ => Err("服务器未启用 SFTP 子系统 / Server does not provide SFTP".into()),
    }
}
async fn sftp(session: &Session) -> Result<Arc<SftpSession>, String> {
    session.sftp.get_or_try_init(|| async {
        SftpSession::new(stream(session).await?).await.map(Arc::new).map_err(|e| e.to_string())
    }).await.cloned()
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEntry { name: String, is_dir: bool, is_link: bool, size: Option<u64>, modified: Option<u32>, permissions: Option<u32> }
#[derive(Serialize)]
pub struct RemoteDirectory { path: String, entries: Vec<RemoteEntry>, truncated: bool }
#[tauri::command]
pub async fn ssh_files_list(id: u32, path: String) -> Result<RemoteDirectory, String> {
    remote_path(&path)?;
    let session = get(id)?;
    let task = async {
        // Raw directory batches let us stop without materializing a huge folder.
        let raw = RawSftpSession::new(stream(&session).await?);
        raw.init().await.map_err(|e| e.to_string())?;
        let operation = async {
            let resolved = raw.realpath(path).await.map_err(|e| e.to_string())?.files.into_iter().next().ok_or("服务器没有返回目录路径")?.filename;
            remote_path(&resolved)?;
            let handle = raw.opendir(&resolved).await.map_err(|e| e.to_string())?.handle;
            let mut entries = Vec::new(); let mut bytes = 0; let mut truncated = false;
            let listing = async {
                loop {
                    let batch = match raw.readdir(&handle).await {
                        Ok(name) => name.files,
                        Err(Error::Status(status)) if status.status_code == StatusCode::Eof => break,
                        Err(e) => return Err(e.to_string()),
                    };
                    if batch.is_empty() { break; }
                    for item in batch {
                        if item.filename == "." || item.filename == ".." { continue; }
                        bytes += item.filename.len();
                        if entries.len() >= 5000 || bytes > 2 * 1024 * 1024 { truncated = true; break; }
                        entries.push(RemoteEntry { name: item.filename, is_dir: item.attrs.is_dir(), is_link: item.attrs.is_symlink(), size: item.attrs.size, modified: item.attrs.mtime, permissions: item.attrs.permissions });
                    }
                    if truncated { break; }
                }
                Ok(())
            }.await;
            let _ = raw.close(handle).await;
            listing?;
            entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
            Ok(RemoteDirectory { path: resolved, entries, truncated })
        }.await;
        let _ = raw.close_session();
        operation
    };
    tokio::time::timeout(Duration::from_secs(20), task).await.map_err(|_| "读取远程目录超时 / SFTP directory timeout".to_owned())?
}
#[tauri::command]
pub async fn ssh_pick_file(save: bool, name: Option<String>) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = rfd::FileDialog::new();
        if save { if let Some(name) = name.filter(|n| leaf(n).is_ok() && !n.contains([':', '*', '?', '"', '<', '>', '|'])) { dialog = dialog.set_file_name(name); } }
        let path = if save { dialog.save_file() } else { dialog.pick_file() };
        Ok(path.map(|p| p.to_string_lossy().into_owned()))
    }).await.map_err(|e| e.to_string())?
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress { id: u32, key: String, transfer_id: String, direction: String, name: String, bytes: u64, total: u64, status: String, error: Option<String> }
enum PartialFile { Local(PathBuf), Remote(String) }
enum Commit { Local(PathBuf, PathBuf), Remote(Arc<SftpSession>, String, String) }
#[tauri::command]
pub async fn ssh_file_transfer(id: u32, direction: String, local_path: String, remote: String, app: AppHandle) -> Result<String, String> {
    if !matches!(direction.as_str(), "upload" | "download") { return Err("Invalid transfer direction".into()); }
    remote_path(&remote)?;
    let local = PathBuf::from(local_path);
    if !crate::preview::ordinary_path(&local) { return Err("请选择普通本地文件路径 / Choose an ordinary local file path".into()); }
    let session = get(id)?;
    let transfer_id = nonce()?;
    let (cancel, mut cancelled) = watch::channel(false);
    {
        let mut active = session.transfers.lock().unwrap();
        if !active.is_empty() { return Err("当前连接已有传输任务，请等待或取消 / A transfer is already running".into()); }
        active.insert(transfer_id.clone(), cancel);
    }
    let token = transfer_id.clone();
    tauri::async_runtime::spawn(async move {
        let mut progress = Progress { id, key: session.key.clone(), transfer_id, direction: direction.clone(), name: if direction == "upload" { local.file_name().unwrap_or_default().to_string_lossy().into_owned() } else { remote.rsplit('/').next().unwrap_or("download").into() }, bytes: 0, total: 0, status: "running".into(), error: None };
        let partial = Arc::new(Mutex::new(None));
        let mut disconnected = session.stop.subscribe();
        let _ = app.emit("ssh-transfer", &progress);
        let copied = if *cancelled.borrow() || *disconnected.borrow() { Err("已取消 / Cancelled".into()) } else {
            tokio::select! {
                result = transfer(&session, &direction, &local, &remote, &mut progress, &partial, &app) => result,
                _ = cancelled.changed() => Err("已取消 / Cancelled".into()),
                _ = disconnected.changed() => Err("连接已断开，传输取消 / Disconnected; transfer cancelled".into()),
            }
        };
        // Cancellation stops copying. Once publication starts, await its result
        // instead of abandoning a rename that may already have reached a server.
        let result = match copied {
            Ok(_) if *cancelled.borrow() || *disconnected.borrow() => Err("已取消 / Cancelled".into()),
            Ok(commit) => {
                progress.status = "finalizing".into(); let _ = app.emit("ssh-transfer", &progress);
                let result = match commit {
                    Commit::Local(temp, target) => tauri::async_runtime::spawn_blocking(move || finalize_download(&temp, &target)).await.map_err(|e| e.to_string()).and_then(|r| r),
                    Commit::Remote(sftp, temp, target) => sftp.rename(&temp, &target).await.map_err(|e| format!("完成上传失败，请刷新目录核对结果 / Finalizing upload failed; refresh to verify: {e}")),
                };
                if result.is_ok() { *partial.lock().unwrap() = None; }
                result
            }
            Err(error) => Err(error),
        };
        let partial_file = partial.lock().unwrap().take();
        let cleanup = match partial_file {
            Some(PartialFile::Local(path)) => tokio::fs::remove_file(&path).await.map_err(|_| format!("临时文件保留在 {}", path.display())),
            Some(PartialFile::Remote(path)) => match sftp(&session).await {
                Ok(sftp) => sftp.remove_file(&path).await.map_err(|_| format!("远端临时文件保留在 {path}")),
                Err(_) => Err(format!("远端临时文件保留在 {path}")),
            },
            None => Ok(()),
        };
        progress.status = if result.is_ok() { "complete" } else if *cancelled.borrow() || *disconnected.borrow() { "cancelled" } else { "failed" }.into();
        progress.error = result.err();
        if let Err(warning) = cleanup { progress.error = Some(format!("{}; {warning}", progress.error.unwrap_or_default())); }
        session.transfers.lock().unwrap().remove(&progress.transfer_id);
        let _ = app.emit("ssh-transfer", progress);
    });
    Ok(token)
}
async fn transfer(session: &Session, direction: &str, local: &Path, remote: &str, progress: &mut Progress, partial: &Arc<Mutex<Option<PartialFile>>>, app: &AppHandle) -> Result<Commit, String> {
    let sftp = sftp(session).await?;
    let mut buffer = vec![0u8; 128 * 1024];
    let mut last = Instant::now();
    if direction == "upload" {
        let local_name = local.file_name().and_then(|n| n.to_str()).ok_or("Invalid filename")?;
        leaf(local_name)?;
        let path = local.to_owned();
        let source = tauri::async_runtime::spawn_blocking(move || crate::preview::open_regular_file(&path)).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
        let metadata = source.metadata().map_err(|e| e.to_string())?;
        if !metadata.is_file() { return Err("只能上传普通文件 / Upload regular files only".into()); }
        progress.total = metadata.len();
        let mut source = tokio::fs::File::from_std(source);
        let parent = sftp.canonicalize(remote).await.map_err(|e| e.to_string())?;
        let destination = join(&parent, local_name);
        if sftp.try_exists(&destination).await.map_err(|e| e.to_string())? { return Err("远程同名文件已存在，不会覆盖 / Remote file already exists".into()); }
        let temp = join(&parent, &format!(".dalizi-{}.part", progress.transfer_id));
        let mut file = sftp.open_with_flags(&temp, OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::EXCLUDE).await.map_err(|e| e.to_string())?;
        *partial.lock().unwrap() = Some(PartialFile::Remote(temp.clone()));
        loop {
            let size = source.read(&mut buffer).await.map_err(|e| e.to_string())?;
            if size == 0 { break; }
            if progress.bytes + size as u64 > progress.total { return Err("上传期间本地文件变大，请重试 / Local file grew during upload".into()); }
            file.write_all(&buffer[..size]).await.map_err(|e| e.to_string())?;
            progress.bytes += size as u64;
            if last.elapsed() > Duration::from_millis(100) { let _ = app.emit("ssh-transfer", &*progress); last = Instant::now(); }
        }
        if progress.bytes != progress.total { return Err("上传期间文件大小改变 / Local file size changed".into()); }
        file.flush().await.map_err(|e| e.to_string())?;
        file.close().await.map_err(|e| e.to_string())?;
        // SFTP v3 RENAME (not posix-rename) must fail if the destination exists.
        Ok(Commit::Remote(sftp, temp, destination))
    } else {
        if local.exists() { return Err("本地目标已存在，请选择新的文件名 / Local target exists; choose a new name".into()); }
        let metadata = sftp.symlink_metadata(remote).await.map_err(|e| e.to_string())?;
        if !metadata.is_regular() || metadata.is_symlink() { return Err("请选择普通远程文件 / Select a regular remote file".into()); }
        progress.total = metadata.size.ok_or("服务器未返回文件大小 / Server did not report file size")?;
        let parent = local.parent().filter(|p| p.is_dir()).ok_or("本地保存目录不存在 / Local directory does not exist")?;
        let temporary = parent.join(format!(".dalizi-{}.part", progress.transfer_id));
        let mut destination = tokio::fs::OpenOptions::new().write(true).create_new(true).open(&temporary).await.map_err(|e| e.to_string())?;
        *partial.lock().unwrap() = Some(PartialFile::Local(temporary.clone()));
        let mut source = sftp.open(remote).await.map_err(|e| e.to_string())?;
        loop {
            let size = source.read(&mut buffer).await.map_err(|e| e.to_string())?;
            if size == 0 { break; }
            if progress.bytes + size as u64 > progress.total { return Err("下载期间远程文件变大，请重试 / Remote file grew during download".into()); }
            destination.write_all(&buffer[..size]).await.map_err(|e| e.to_string())?;
            progress.bytes += size as u64;
            if last.elapsed() > Duration::from_millis(100) { let _ = app.emit("ssh-transfer", &*progress); last = Instant::now(); }
        }
        if progress.bytes != progress.total { return Err("下载期间文件大小改变 / Remote file size changed".into()); }
        destination.flush().await.map_err(|e| e.to_string())?;
        destination.sync_all().await.map_err(|e| e.to_string())?;
        drop(destination);
        Ok(Commit::Local(temporary, local.to_owned()))
    }
}
fn finalize_download(temp: &Path, target: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{core::PCWSTR, Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH}};
    let from: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    // No MOVEFILE_REPLACE_EXISTING: a concurrent creator's file stays intact.
    unsafe { MoveFileExW(PCWSTR(from.as_ptr()), PCWSTR(to.as_ptr()), MOVEFILE_WRITE_THROUGH) }.map_err(|e| format!("保存失败，目标可能已存在 / Could not finalize download: {e}"))
}
#[tauri::command]
pub fn ssh_transfer_cancel(id: u32, transfer_id: String) -> Result<(), String> {
    let session = get(id)?;
    if let Some(stop) = session.transfers.lock().unwrap().get(&transfer_id) { let _ = stop.send(true); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remote_names_and_paths_are_protocol_data_not_shell_commands() {
        assert!(remote_path("/目录/'quoted'; $HOME").is_ok());
        assert!(remote_path("bad\0path").is_err());
        for name in ["", ".", "..", "a/b", "a\\b", "bad\nname"] { assert!(leaf(name).is_err()); }
        assert_eq!(join("/", "中文.txt"), "/中文.txt");
    }
    #[test]
    fn download_publication_does_not_overwrite_existing_target() {
        let root = std::env::temp_dir().join(format!("dalizi-transfer-{}", nonce().unwrap()));
        std::fs::create_dir(&root).unwrap();
        let temp = root.join("new.part"); let target = root.join("existing.txt");
        std::fs::write(&temp, "new").unwrap(); std::fs::write(&target, "original").unwrap();
        assert!(finalize_download(&temp, &target).is_err());
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "original");
        finalize_download(&temp, &root.join("new.txt")).unwrap();
        std::fs::remove_file(target).unwrap(); std::fs::remove_file(root.join("new.txt")).unwrap(); std::fs::remove_dir(root).unwrap();
    }
}
