//! Explicit read-only text preview for a selected file in either transfer pane.
use super::{get, join, leaf, sftp, tree};
use crate::preview::{open_regular_file, text_sample, Preview, TEXT_LIMIT};
use std::{io::Read, path::Path, time::Duration};
use tokio::io::AsyncReadExt;

#[tauri::command]
pub async fn ssh_pane_preview(
    view: tauri::Webview,
    id: u32,
    side: String,
    directory: String,
    name: String,
) -> Result<Preview, String> {
    crate::workspace_identity::local(&view)?;
    leaf(&name)?;
    let session = get(id)?;
    let limit = TEXT_LIMIT as u64 + 1;
    if side == "local" {
        super::batch::windows_name(&name)?;
        return tauri::async_runtime::spawn_blocking(move || {
            let path = Path::new(&directory).join(name);
            tree::local_chain(&path)?;
            let file = open_regular_file(&path).map_err(|e| e.to_string())?;
            let mut bytes = Vec::new();
            file.take(limit)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            Ok(text_sample(&bytes))
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    if side != "remote" || !directory.starts_with('/') {
        return Err("Invalid SFTP preview path".into());
    }
    let path = join(&directory, &name);
    let mut stop = session.stop.subscribe();
    let read = async {
        let s = sftp(&session).await?;
        tree::remote_chain(&s, &path).await?;
        let metadata = s.symlink_metadata(&path).await.map_err(|e| e.to_string())?;
        if !metadata.is_regular() || metadata.is_symlink() {
            return Err("请选择普通文件 / Select a regular file".into());
        }
        let matches = |m: &russh_sftp::protocol::FileAttributes| {
            m.is_regular() && m.size == metadata.size && m.mtime == metadata.mtime
        };
        let mut handle = s.open(&path).await.map_err(|e| e.to_string())?;
        let changed = "远程文件已变化，请重新预览 / Remote file changed. Preview again";
        if !matches(&handle.metadata().await.map_err(|e| e.to_string())?) {
            return Err(changed.into());
        }
        let mut bytes = Vec::new();
        (&mut handle)
            .take(limit)
            .read_to_end(&mut bytes)
            .await
            .map_err(|e| e.to_string())?;
        if metadata
            .size
            .is_some_and(|n| bytes.len() as u64 != n.min(limit))
            || !matches(&handle.metadata().await.map_err(|e| e.to_string())?)
            || !matches(&s.symlink_metadata(&path).await.map_err(|e| e.to_string())?)
        {
            return Err(changed.into());
        }
        Ok(text_sample(&bytes))
    };
    tokio::select! {
        result=tokio::time::timeout(Duration::from_secs(12),read)=>result.map_err(|_|"预览超时 / Preview timed out")?,
        _=stop.changed()=>Err("连接已关闭 / Connection closed".into()),
    }
}
