//! In-memory checkpoints scoped to the verified host key and account.
use super::*;
use std::collections::HashMap;
use std::sync::OnceLock;
use tokio::io::{AsyncRead, AsyncSeek, AsyncSeekExt};
#[derive(Clone)]
pub(super) struct Checkpoint {
    pub token: String,
    pub identity: String,
    pub direction: String,
    pub local: PathBuf,
    pub remote: String,
    pub temp: String,
    pub size: u64,
    pub modified: Option<u64>,
}
static CHECKPOINTS: OnceLock<Mutex<HashMap<String, Checkpoint>>> = OnceLock::new();
fn records() -> &'static Mutex<HashMap<String, Checkpoint>> {
    CHECKPOINTS.get_or_init(Default::default)
}
pub(super) fn take(
    token: &str,
    session: &Session,
    direction: &str,
    local: &Path,
    remote: &str,
) -> Result<Checkpoint, String> {
    let mut records = records().lock().unwrap();
    let c = records
        .get(token)
        .ok_or("续传记录不存在或已被使用 / Resume checkpoint unavailable")?;
    if c.identity != session.resume_identity
        || c.direction != direction
        || c.local != local
        || c.remote != remote
    {
        return Err("续传主机身份、账户或路径不匹配 / Resume identity or path mismatch".into());
    }
    Ok(records.remove(token).unwrap())
}
pub(super) fn save(c: Checkpoint) -> Result<(), String> {
    let mut records = records().lock().unwrap();
    if records.len() >= 128 {
        return Err("续传记录已达 128 条，请清理任务 / Resume checkpoint limit reached".into());
    }
    records.insert(c.token.clone(), c);
    Ok(())
}
pub(super) fn validate(c: &Checkpoint, size: u64, modified: Option<u64>) -> Result<(), String> {
    if c.size != size || c.modified != modified {
        return Err(
            "源文件已变化，拒绝拼接；请重新添加传输 / Source changed; add a new transfer".into(),
        );
    }
    Ok(())
}
pub(super) async fn verify_prefix<A, B>(
    source: &mut A,
    partial: &mut B,
    length: u64,
    total: u64,
) -> Result<(), String>
where
    A: AsyncRead + AsyncSeek + Unpin,
    B: AsyncRead + AsyncSeek + Unpin,
{
    if length > total {
        return Err("临时文件大于源文件 / Partial file exceeds source".into());
    }
    source
        .seek(std::io::SeekFrom::Start(0))
        .await
        .map_err(|e| e.to_string())?;
    partial
        .seek(std::io::SeekFrom::Start(0))
        .await
        .map_err(|e| e.to_string())?;
    let mut a = vec![0u8; 128 * 1024];
    let mut b = vec![0u8; 128 * 1024];
    let mut left = length;
    while left > 0 {
        let n = left.min(a.len() as u64) as usize;
        source
            .read_exact(&mut a[..n])
            .await
            .map_err(|e| e.to_string())?;
        partial
            .read_exact(&mut b[..n])
            .await
            .map_err(|e| e.to_string())?;
        if a[..n] != b[..n] {
            return Err("已有临时数据与源文件不一致，拒绝续传 / Partial content mismatch".into());
        }
        left -= n as u64;
    }
    Ok(())
}
pub(super) fn local_modified(m: &std::fs::Metadata) -> Option<u64> {
    m.modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|t| t.as_nanos().min(u64::MAX as u128) as u64)
}
#[tauri::command]
pub async fn ssh_resume_discard(id: u32, resume_id: String) -> Result<(), String> {
    let session = get(id)?;
    let c = {
        let mut records = records().lock().unwrap();
        match records.get(&resume_id) {
            None => return Ok(()),
            Some(c) if c.identity != session.resume_identity => return Err("续传身份不匹配".into()),
            _ => (),
        }
        records.remove(&resume_id).unwrap()
    };
    let result = if c.direction == "upload" {
        match sftp(&session).await {
            Ok(s) => s.remove_file(&c.temp).await.map_err(|e| e.to_string()),
            Err(e) => Err(e),
        }
    } else {
        tokio::fs::remove_file(&c.temp)
            .await
            .map_err(|e| e.to_string())
    };
    if result.is_err() {
        let _ = save(c);
    }
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn resume_checks_every_prefix_byte_and_size() {
        let mut source = std::io::Cursor::new(b"abcdefgh".to_vec());
        let mut part = std::io::Cursor::new(b"abcd".to_vec());
        verify_prefix(&mut source, &mut part, 4, 8).await.unwrap();
        assert_eq!(source.position(), 4);
        assert_eq!(part.position(), 4);
        let mut wrong = std::io::Cursor::new(b"abXd".to_vec());
        assert!(verify_prefix(&mut source, &mut wrong, 4, 8).await.is_err());
        assert!(verify_prefix(&mut source, &mut part, 9, 8).await.is_err());
    }
}
