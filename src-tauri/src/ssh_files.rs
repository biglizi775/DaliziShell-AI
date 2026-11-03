//! Bounded SFTP browsing and streamed, cancellable single-file transfers.
#[path = "ssh_files_batch.rs"]
pub mod batch;
#[path = "ssh_files_tree.rs"]
pub mod tree;
#[path = "ssh_files_resume.rs"]
pub mod resume;
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
    let accepted = tokio::time::timeout(Duration::from_secs(10), async {
        loop { match channel.wait().await {
            Some(russh::ChannelMsg::Success) => return true,
            Some(russh::ChannelMsg::WindowAdjusted { .. }) => (),
            _ => return false,
        } }
    }).await.unwrap_or(false);
    if accepted { Ok(channel.into_stream()) } else {
        let _ = tokio::time::timeout(Duration::from_secs(1), channel.close()).await;
        Err("服务器未启用 SFTP 子系统 / Server does not provide SFTP".into())
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
pub struct Progress { resume_id: Option<String>, resumed_bytes: u64, id: u32, key: String, transfer_id: String, direction: String, name: String, bytes: u64, total: u64, status: String, error: Option<String> }

static TRANSFER_HISTORY: Mutex<Vec<Progress>> = Mutex::new(Vec::new());
fn transfer_finished(status: &str) -> bool { matches!(status, "complete" | "cancelled" | "failed") }
fn retain_transfer(progress: &Progress, insert: bool) -> Result<(), String> {
    let mut history = TRANSFER_HISTORY.lock().map_err(|_| "Transfer history unavailable")?;
    if let Some(previous) = history.iter_mut().find(|p| p.transfer_id == progress.transfer_id) {
        if insert { return Err("传输标识已使用 / Transfer ID already used".into()); }
        *previous = progress.clone();
    } else if insert {
        if history.len() >= 256 {
            let index = history.iter().position(|p| transfer_finished(&p.status)).ok_or("传输任务过多 / Too many transfers")?;
            history.remove(index);
        }
        history.push(progress.clone());
    }
    Ok(())
}
fn publish_transfer(app: &AppHandle, progress: &Progress) {
    let _ = retain_transfer(progress, false);
    let _ = app.emit("ssh-transfer", progress);
}
#[tauri::command]
pub fn ssh_transfer_status(id: u32, transfer_id: String) -> Result<Option<Progress>, String> {
    // Finished records remain queryable after a disconnect, so a missed event is recoverable.
    let history = TRANSFER_HISTORY.lock().map_err(|_| "Transfer history unavailable")?;
    Ok(history.iter().find(|p| p.id == id && p.transfer_id == transfer_id).cloned())
}
enum PartialFile { Local(PathBuf), Remote(String) }
enum Commit { Directory, Local(PathBuf, PathBuf), Remote(Arc<SftpSession>, String, String) }
#[tauri::command]
pub async fn ssh_file_transfer(id: u32, direction: String, local_path: String, remote: String, request_id: Option<String>, entry_kind: Option<String>, resumable: Option<bool>, resume_id: Option<String>, app: AppHandle) -> Result<String, String> {
    if !matches!(direction.as_str(), "upload" | "download") { return Err("Invalid transfer direction".into()); }
    remote_path(&remote)?;
    let local = PathBuf::from(local_path);
    if !crate::preview::ordinary_path(&local) { return Err("请选择普通本地文件路径 / Choose an ordinary local file path".into()); }
    let session = get(id)?;
    let transfer_id = match request_id {
        Some(value) if (16..=80).contains(&value.len()) && value.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_') => value,
        Some(_) => return Err("Invalid transfer ID".into()),
        None => nonce()?,
    };
    let directory = entry_kind.as_deref() == Some("directory");
    if entry_kind.as_deref().is_some_and(|k| !matches!(k, "file" | "directory")) { return Err("Invalid entry kind".into()); }
    if directory && resume_id.is_some() { return Err("Directories cannot resume bytes".into()); }
    let initial = Progress { resume_id: None, resumed_bytes: 0, id, key: session.key.clone(), transfer_id: transfer_id.clone(), direction: direction.clone(), name: if direction == "upload" { local.file_name().unwrap_or_default().to_string_lossy().into_owned() } else { remote.rsplit('/').next().unwrap_or("download").into() }, bytes: 0, total: 0, status: "running".into(), error: None };
    let (cancel, mut cancelled) = watch::channel(false);
    {
        let mut active = session.transfers.lock().unwrap();
        if !active.is_empty() { return Err("当前连接已有传输任务，请等待或取消 / A transfer is already running".into()); }
        retain_transfer(&initial, true)?;
        active.insert(transfer_id.clone(), cancel);
    }
    let token = transfer_id.clone();
    tauri::async_runtime::spawn(async move {
        let mut progress = initial;
        let checkpoint = Arc::new(Mutex::new(None));
        if let Some(ref resume_id) = resume_id {
            match resume::take(resume_id, &session, &direction, &local, &remote) {
                Ok(c) => *checkpoint.lock().unwrap() = Some(c),
                Err(e) => { progress.status="failed".into(); progress.error=Some(e); session.transfers.lock().unwrap().remove(&progress.transfer_id); publish_transfer(&app,&progress); return; }
            }
        }
        // Own a resumed partial before observing cancellation, including a cancel
        // that arrived between the command acknowledgement and task scheduling.
        let resumed_partial = checkpoint.lock().unwrap().as_ref().map(|c| if direction == "upload" { PartialFile::Remote(c.temp.clone()) } else { PartialFile::Local(PathBuf::from(&c.temp)) });
        let partial = Arc::new(Mutex::new(resumed_partial));
        let mut disconnected = session.stop.subscribe();
        publish_transfer(&app, &progress);
        let copied = if *cancelled.borrow() || *disconnected.borrow() { Err("已取消 / Cancelled".into()) } else {
            tokio::select! {
                result = transfer(&session, &direction, &local, &remote, &mut progress, &partial, &app, directory, resumable.unwrap_or(false) || resume_id.is_some(), &checkpoint) => result,
                _ = cancelled.changed() => Err("已取消 / Cancelled".into()),
                _ = disconnected.changed() => Err("连接已断开，传输取消 / Disconnected; transfer cancelled".into()),
            }
        };
        // Cancellation stops copying. Once publication starts, await its result
        // instead of abandoning a rename that may already have reached a server.
        let result = match copied {
            Ok(_) if *cancelled.borrow() || *disconnected.borrow() => Err("已取消 / Cancelled".into()),
            Ok(commit) => {
                progress.status = "finalizing".into(); publish_transfer(&app, &progress);
                let result = match commit {
                    Commit::Directory => Ok(()),
                    Commit::Local(temp, target) => tauri::async_runtime::spawn_blocking(move || finalize_download(&temp, &target)).await.map_err(|e| e.to_string()).and_then(|r| r),
                    Commit::Remote(sftp, temp, target) => sftp.rename(&temp, &target).await.map_err(|e| format!("完成上传失败，请刷新目录核对结果 / Finalizing upload failed; refresh to verify: {e}")),
                };
                if result.is_ok() { *partial.lock().unwrap() = None; }
                result
            }
            Err(error) => Err(error),
        };
        let mut partial_file = partial.lock().unwrap().take();
        let c = checkpoint.lock().unwrap().take();
        // Explicit cancellation discards data. Disconnect/error retains an opt-in checkpoint.
        if result.is_err() && (!*cancelled.borrow() || *disconnected.borrow()) {
            if let (Some(c), Some(_)) = (c, partial_file.as_ref()) {
                let token=c.token.clone(); let path=c.temp.clone();
                if resume::save(c).is_ok() { partial_file=None; progress.resume_id=Some(token); progress.error=Some(format!("续传临时文件 / Resume partial: {path}")); }
            }
        }
        let cleanup = match partial_file {
            Some(PartialFile::Local(path)) => tokio::fs::remove_file(&path).await.map_err(|_| format!("临时文件保留在 {}", path.display())),
            Some(PartialFile::Remote(path)) => match sftp(&session).await {
                Ok(sftp) => sftp.remove_file(&path).await.map_err(|_| format!("远端临时文件保留在 {path}")),
                Err(_) => Err(format!("远端临时文件保留在 {path}")),
            },
            None => Ok(()),
        };
        progress.status = if result.is_ok() { "complete" } else if *cancelled.borrow() || *disconnected.borrow() { "cancelled" } else { "failed" }.into();
        progress.error = match (result.err(), progress.error.take()) { (Some(e),Some(note)) => Some(format!("{e}; {note}")), (e,_) => e };
        if let Err(warning) = cleanup { progress.error = Some(format!("{}; {warning}", progress.error.unwrap_or_default())); }
        session.transfers.lock().unwrap().remove(&progress.transfer_id);
        publish_transfer(&app, &progress);
    });
    Ok(token)
}
async fn transfer(session: &Session, direction: &str, local: &Path, remote: &str, progress: &mut Progress, partial: &Arc<Mutex<Option<PartialFile>>>, app: &AppHandle, directory: bool, resumable: bool, checkpoint: &Arc<Mutex<Option<resume::Checkpoint>>>) -> Result<Commit, String> {
    if directory { tree::create_directory(session,direction,local,remote).await?; return Ok(Commit::Directory); }
    let previous=checkpoint.lock().unwrap().clone();
    // Keep ownership of a consumed checkpoint even when the new connection fails early.
    if let Some(c)=&previous { *partial.lock().unwrap()=Some(if direction=="upload" {PartialFile::Remote(c.temp.clone())}else{PartialFile::Local(PathBuf::from(&c.temp))}); }
    tree::local_chain(local)?;
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
        tree::remote_chain(&sftp,&parent).await?;
        let destination = join(&parent, local_name);
        if sftp.try_exists(&destination).await.map_err(|e| e.to_string())? { return Err("远程同名文件已存在，不会覆盖 / Remote file already exists".into()); }
        let temp = previous.as_ref().map(|c| c.temp.clone()).unwrap_or_else(||join(&parent, &format!(".dalizi-{}.part", progress.transfer_id)));
        let mut file = if let Some(c)=&previous {
            resume::validate(c,metadata.len(),resume::local_modified(&metadata))?;
            let m=sftp.symlink_metadata(&temp).await.map_err(|e|e.to_string())?;
            if !m.is_regular() || m.is_symlink(){return Err("Invalid resume partial".into());}
            let offset=m.size.ok_or("Missing partial size")?;
            let mut file=sftp.open_with_flags(&temp,OpenFlags::READ|OpenFlags::WRITE).await.map_err(|e|e.to_string())?;
            resume::verify_prefix(&mut source,&mut file,offset,progress.total).await?;
            progress.bytes=offset;progress.resumed_bytes=offset;publish_transfer(app,progress);file
        }else{sftp.open_with_flags(&temp, OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::EXCLUDE).await.map_err(|e| e.to_string())?};
        *partial.lock().unwrap() = Some(PartialFile::Remote(temp.clone()));
        if resumable { *checkpoint.lock().unwrap()=Some(resume::Checkpoint{token:previous.as_ref().map(|c|c.token.clone()).unwrap_or_else(||progress.transfer_id.clone()),identity:session.resume_identity.clone(),direction:direction.into(),local:local.into(),remote:remote.into(),temp:temp.clone(),size:metadata.len(),modified:resume::local_modified(&metadata)}); }
        loop {
            let size = source.read(&mut buffer).await.map_err(|e| e.to_string())?;
            if size == 0 { break; }
            if progress.bytes + size as u64 > progress.total { return Err("上传期间本地文件变大，请重试 / Local file grew during upload".into()); }
            file.write_all(&buffer[..size]).await.map_err(|e| e.to_string())?;
            progress.bytes += size as u64;
            if last.elapsed() > Duration::from_millis(100) { publish_transfer(app, progress); last = Instant::now(); }
        }
        if progress.bytes != progress.total { return Err("上传期间文件大小改变 / Local file size changed".into()); }
        resume::validate(&resume::Checkpoint{token:String::new(),identity:String::new(),direction:String::new(),local:local.into(),remote:String::new(),temp:String::new(),size:metadata.len(),modified:resume::local_modified(&metadata)},source.metadata().await.map_err(|e|e.to_string())?.len(),resume::local_modified(&source.metadata().await.map_err(|e|e.to_string())?))?;
        file.flush().await.map_err(|e| e.to_string())?;
        file.close().await.map_err(|e| e.to_string())?;
        // SFTP v3 RENAME (not posix-rename) must fail if the destination exists.
        Ok(Commit::Remote(sftp, temp, destination))
    } else {
        if local.exists() { return Err("本地目标已存在，请选择新的文件名 / Local target exists; choose a new name".into()); }
        tree::remote_chain(&sftp,remote).await?;
        let metadata = sftp.symlink_metadata(remote).await.map_err(|e| e.to_string())?;
        if !metadata.is_regular() || metadata.is_symlink() { return Err("请选择普通远程文件 / Select a regular remote file".into()); }
        progress.total = metadata.size.ok_or("服务器未返回文件大小 / Server did not report file size")?;
        let parent = local.parent().filter(|p| p.is_dir()).ok_or("本地保存目录不存在 / Local directory does not exist")?;
        let temporary = previous.as_ref().map(|c|PathBuf::from(&c.temp)).unwrap_or_else(||parent.join(format!(".dalizi-{}.part", progress.transfer_id)));
        tree::local_chain(&temporary)?;
        let mut source = sftp.open(remote).await.map_err(|e| e.to_string())?;
        let mut destination = if let Some(c)=&previous {
            resume::validate(c,progress.total,metadata.mtime.map(u64::from))?;
            let mut file=tokio::fs::OpenOptions::new().read(true).write(true).open(&temporary).await.map_err(|e|e.to_string())?;
            let m=file.metadata().await.map_err(|e|e.to_string())?;if !m.is_file(){return Err("Invalid resume partial".into());}
            let offset=m.len();resume::verify_prefix(&mut source,&mut file,offset,progress.total).await?;
            progress.bytes=offset;progress.resumed_bytes=offset;publish_transfer(app,progress);file
        }else{tokio::fs::OpenOptions::new().write(true).create_new(true).open(&temporary).await.map_err(|e| e.to_string())?};
        *partial.lock().unwrap() = Some(PartialFile::Local(temporary.clone()));
        if resumable { *checkpoint.lock().unwrap()=Some(resume::Checkpoint{token:previous.as_ref().map(|c|c.token.clone()).unwrap_or_else(||progress.transfer_id.clone()),identity:session.resume_identity.clone(),direction:direction.into(),local:local.into(),remote:remote.into(),temp:temporary.to_string_lossy().into(),size:progress.total,modified:metadata.mtime.map(u64::from)}); }
        loop {
            let size = source.read(&mut buffer).await.map_err(|e| e.to_string())?;
            if size == 0 { break; }
            if progress.bytes + size as u64 > progress.total { return Err("下载期间远程文件变大，请重试 / Remote file grew during download".into()); }
            destination.write_all(&buffer[..size]).await.map_err(|e| e.to_string())?;
            progress.bytes += size as u64;
            if last.elapsed() > Duration::from_millis(100) { publish_transfer(app, progress); last = Instant::now(); }
        }
        if progress.bytes != progress.total { return Err("下载期间文件大小改变 / Remote file size changed".into()); }
        let after=sftp.symlink_metadata(remote).await.map_err(|e|e.to_string())?;
        if after.size!=metadata.size || after.mtime!=metadata.mtime {return Err("下载期间远端文件已变化 / Remote source changed".into());}
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
    fn status_history_is_bounded_scoped_and_never_evicts_running_transfers() {
        let token = nonce().unwrap();
        let mut active = Progress { resume_id: None, resumed_bytes: 0, id: 123, key: "fixture".into(), transfer_id: token.clone(), direction: "download".into(), name: "file.txt".into(), bytes: 0, total: 10, status: "running".into(), error: None };
        retain_transfer(&active, true).unwrap(); assert!(retain_transfer(&active, true).is_err());
        assert!(ssh_transfer_status(999, token.clone()).unwrap().is_none());
        for _ in 0..300 {
            let completed = Progress { transfer_id: nonce().unwrap(), status: "complete".into(), ..active.clone() };
            retain_transfer(&completed, true).unwrap();
        }
        assert_eq!(TRANSFER_HISTORY.lock().unwrap().len(), 256);
        assert_eq!(ssh_transfer_status(123, token.clone()).unwrap().unwrap().status, "running");
        active.status = "cancelled".into(); retain_transfer(&active, false).unwrap();
        assert_eq!(ssh_transfer_status(123, token).unwrap().unwrap().status, "cancelled");
    }
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
