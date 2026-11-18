//! Read only files from a directory listing issued by this authenticated SFTP session.
use super::{get, join, leaf, sftp, RemoteEntry, Session};
use crate::{
    ssh::{InfoMode, SshConfig},
    ssh_credentials,
};
use dalizi_harness_client::snapshot::{Reference, Snapshot, Workspace};
use russh_sftp::{client::SftpSession, protocol::FileAttributes};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    net::IpAddr,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::io::AsyncReadExt;
use uuid::Uuid;

const STALE: &str = "连接或远程目录已变化，请刷新 SFTP 列表并重新预览。";
const CHANGED: &str = "无法核实远程文件或目录，或文件已变化；未创建快照。";
const SHARED: &str = "无法核实目录所有者或目录允许其他用户写入，请使用账户私有的远程目录。";
const MAX: usize = 32 * 1024;
#[derive(Clone, Serialize, Deserialize, PartialEq)]
pub struct Host {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub fingerprint: String,
    pub system: String,
}
pub struct Peer {
    pub host: Host,
    trust_key: String,
}
impl Peer {
    pub fn new(host: &str, config: &SshConfig, fingerprint: &str, trust_key: String) -> Self {
        let host = host
            .parse::<IpAddr>()
            .map(|a| a.to_string())
            .unwrap_or_else(|_| host.trim_end_matches('.').to_ascii_lowercase());
        let system = match config.info_mode {
            InfoMode::Windows => "windows",
            InfoMode::Posix => "posix",
            InfoMode::Shell => "unspecified",
        };
        Self {
            host: Host {
                host,
                port: config.port,
                user: config.user.clone(),
                fingerprint: fingerprint.into(),
                system: system.into(),
            },
            trust_key,
        }
    }
    pub(super) fn trusted(&self) -> Result<(), String> {
        if ssh_credentials::read(&self.trust_key)?
            .as_deref()
            .map(|b| b.as_slice())
            == Some(self.host.fingerprint.as_bytes())
        {
            Ok(())
        } else {
            Err("主机信任已改变，请重新核对指纹并登录。".into())
        }
    }
}
pub(super) fn workspace(h: &Host, root: &str) -> Workspace {
    let mut hash = Sha256::new();
    for s in [
        &h.host,
        &h.port.to_string(),
        &h.user,
        &h.fingerprint,
        &h.system,
        root,
    ] {
        hash.update((s.len() as u64).to_be_bytes());
        hash.update(s.as_bytes());
    }
    let host = if h.host.contains(':') {
        format!("[{}]", h.host)
    } else {
        h.host.clone()
    };
    Workspace {
        path: format!("ssh://{}@{}:{}{}", h.user, host, h.port, root),
        identity: format!("sftp:{:x}", hash.finalize()),
    }
}
fn valid_root(root: &str) -> bool {
    root == "/"
        || root.starts_with('/')
            && root.len() <= 4096
            && root[1..].split('/').count() <= 32
            && root[1..]
                .split('/')
                .all(|s| leaf(s).is_ok() && !protected(s))
}
fn protected(s: &str) -> bool {
    [".ssh", ".dalizi", ".git"]
        .iter()
        .any(|v| s.eq_ignore_ascii_case(v))
        || s.chars()
            .any(|c| matches!(c,'\u{202a}'..='\u{202e}'|'\u{2066}'..='\u{2069}'))
}
fn text_name(s: &str) -> bool {
    leaf(s).is_ok()
        && !protected(s)
        && s.rsplit_once('.')
            .is_some_and(|(_, e)| e.eq_ignore_ascii_case("txt") || e.eq_ignore_ascii_case("md"))
}
#[derive(Clone, Serialize)]
pub struct Binding {
    pub token: String,
    pub workspace: Workspace,
    pub fingerprint: String,
    pub system: String,
}
#[derive(Clone)]
struct Listed {
    root: String,
    binding: Binding,
    files: HashMap<String, (u32, u64, u32)>,
}
#[derive(Default)]
pub struct ListingState {
    revision: u64,
    current: Option<Listed>,
}
pub(super) fn begin(session: &Session) -> u64 {
    let mut l = session.task_listing.lock().unwrap();
    l.current = None;
    l.revision = l.revision.wrapping_add(1);
    l.revision
}
pub(super) fn publish(
    session: &Session,
    revision: u64,
    root: &str,
    entries: &[RemoteEntry],
) -> Option<Binding> {
    let mut l = session.task_listing.lock().ok()?;
    if l.revision != revision || !valid_root(root) {
        return None;
    }
    let binding = Binding {
        token: Uuid::new_v4().to_string(),
        workspace: workspace(&session.task_host.host, root),
        fingerprint: session.task_host.host.fingerprint.clone(),
        system: session.task_host.host.system.clone(),
    };
    let mut files = HashMap::new();
    let mut names = HashSet::new();
    for e in entries {
        if text_name(&e.name) {
            if !names.insert(&e.name) {
                return None;
            }
            if let (Some(mode), Some(size), Some(time)) = (e.permissions, e.size, e.modified) {
                if mode & 0o170000 == 0o100000 && size <= MAX as u64 {
                    files.insert(e.name.clone(), (mode, size, time));
                }
            }
        }
    }
    l.current = Some(Listed {
        root: root.into(),
        files,
        binding: binding.clone(),
    });
    Some(binding)
}
#[derive(Clone)]
pub struct Grant {
    pub id: u32,
    token: String,
}
impl Grant {
    pub fn check(&self) -> Result<(), String> {
        let session = get(self.id)?;
        session.task_host.trusted()?;
        let lock = session.task_listing.lock().map_err(|_| STALE)?;
        if lock
            .current
            .as_ref()
            .is_some_and(|l| l.binding.token == self.token)
        {
            Ok(())
        } else {
            Err(STALE.into())
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub peer: Host,
    pub directory: String,
    pub captured_at: u64,
    #[serde(default)]
    pub hashes: std::collections::BTreeMap<String, String>,
    // No live authorization is persisted. A restarted app cannot reuse the old session id.
    #[serde(skip)]
    pub session: Option<u32>,
}
impl Source {
    pub fn connected(&self) -> bool {
        self.session
            .and_then(|id| get(id).ok())
            .is_some_and(|s| s.task_host.host.fingerprint == self.peer.fingerprint)
    }
}

type Stamp = (u32, u64, u32, u32, u32);
fn stamp(a: &FileAttributes) -> Result<Stamp, String> {
    let st = (
        a.permissions.ok_or(CHANGED)?,
        a.size.ok_or(CHANGED)?,
        a.mtime.ok_or(CHANGED)?,
        a.uid.ok_or(CHANGED)?,
        a.gid.ok_or(CHANGED)?,
    );
    if st.0 & 0o170000 != 0o100000 || st.1 > MAX as u64 {
        return Err(CHANGED.into());
    }
    Ok(st)
}
async fn safe_dir(s: &SftpSession, root: &str, uid: u32) -> Result<(), String> {
    // SFTP v3 lacks descriptor-relative OPEN. Do not cross a directory in which
    // another account can replace a component between LSTAT and OPEN.
    let mut path = "/".to_owned();
    for part in std::iter::once("").chain(root.split('/').filter(|p| !p.is_empty())) {
        if !part.is_empty() {
            path = join(&path, part);
        }
        let a = s.symlink_metadata(&path).await.map_err(|_| CHANGED)?;
        let mode = a.permissions.ok_or(SHARED)?;
        if mode & 0o170000 != 0o040000
            || mode & 0o022 != 0
            || !a.uid.is_some_and(|u| u == 0 || u == uid)
        {
            return Err(SHARED.into());
        }
    }
    if s.canonicalize(root).await.map_err(|_| CHANGED)? != root {
        return Err(CHANGED.into());
    }
    Ok(())
}
async fn checked_file(
    s: &SftpSession,
    file: &str,
    listed: (u32, u64, u32),
    uid: u32,
) -> Result<Vec<u8>, String> {
    let at_path = || async { stamp(&s.symlink_metadata(file).await.map_err(|_| CHANGED)?) };
    let before = at_path().await?;
    if (before.0, before.1, before.2) != listed
        || (before.3 != 0 && before.3 != uid)
        || before.0 & 0o022 != 0
        || s.canonicalize(file).await.map_err(|_| CHANGED)? != file
    {
        return Err(CHANGED.into());
    }
    let handle = s.open(file).await.map_err(|_| CHANGED)?;
    if stamp(&handle.metadata().await.map_err(|_| CHANGED)?)? != before {
        return Err(CHANGED.into());
    }
    let mut bytes = Vec::new();
    // Keep the open handle alive and restat it after the bounded read.
    let mut handle = handle;
    (&mut handle)
        .take(MAX as u64 + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| CHANGED)?;
    if bytes.len() as u64 != before.1
        || stamp(&handle.metadata().await.map_err(|_| CHANGED)?)? != before
        || at_path().await? != before
        || s.canonicalize(file).await.map_err(|_| CHANGED)? != file
    {
        return Err(CHANGED.into());
    }
    Ok(bytes)
}
pub async fn capture(
    id: u32,
    token: String,
    names: Vec<String>,
) -> Result<(Grant, Source, Snapshot), String> {
    let session = get(id)?;
    let grant = Grant { id, token };
    grant.check()?;
    if names.is_empty()
        || names.len() > 3
        || names.iter().collect::<HashSet<_>>().len() != names.len()
    {
        return Err("请选择 1–3 个不同的 TXT 或 Markdown 文件。".into());
    }
    let (root, workspace, selection) = {
        let lock = session.task_listing.lock().map_err(|_| STALE)?;
        let l = lock
            .current
            .as_ref()
            .filter(|l| l.binding.token == grant.token)
            .ok_or(STALE)?;
        let selected = names
            .into_iter()
            .map(|n| {
                let stamp = *l.files.get(&n).ok_or(
                    "只能读取这次目录列表中的普通 TXT 或 Markdown 文件（每个最多 32 KiB）。",
                )?;
                Ok::<_, String>((n, stamp))
            })
            .collect::<Result<Vec<_>, _>>()?;
        (l.root.clone(), l.binding.workspace.clone(), selected)
    };
    let mut stopped = session.stop.subscribe();
    let read = async {
        let s: Arc<SftpSession> = sftp(&session).await?;
        let home = s.canonicalize(".").await.map_err(|_| SHARED)?;
        if !valid_root(&home) {
            return Err(SHARED.into());
        }
        let home_attr = s.symlink_metadata(&home).await.map_err(|_| SHARED)?;
        let uid = home_attr.uid.ok_or(SHARED)?;
        if root != home {
            safe_dir(&s, &home, uid).await?;
        }
        safe_dir(&s, &root, uid).await?;
        let mut total = 0;
        let mut files = Vec::new();
        for (name, expected) in selection {
            total += expected.1;
            if total > 65536 {
                return Err("快照合计超过 64 KiB。".into());
            }
            let bytes = checked_file(&s, &join(&root, &name), expected, uid).await?;
            if bytes.contains(&0) {
                return Err("文件不是 UTF-8 文本。".into());
            }
            let identity = format!("{:x}", Sha256::digest(&bytes));
            let text = String::from_utf8(bytes).map_err(|_| "文件不是 UTF-8 文本。")?;
            files.push(Reference {
                name,
                text,
                identity,
            });
        }
        safe_dir(&s, &root, uid).await?;
        grant.check()?;
        let source = Source {
            peer: session.task_host.host.clone(),
            directory: root,
            hashes: files
                .iter()
                .map(|f| (f.name.clone(), f.identity.clone()))
                .collect(),
            captured_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            session: Some(id),
        };
        Ok((grant, source, Snapshot { workspace, files }))
    };
    tokio::select! {
        _=stopped.changed()=>Err(STALE.into()),
        r=tokio::time::timeout(Duration::from_secs(20), read)=>r.map_err(|_|"SFTP 快照读取超时，请刷新后重试。")?,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remote_scope_keeps_account_port_host_key_system_and_path_case() {
        let base = Host {
            host: "example.org".into(),
            user: "alice".into(),
            port: 22,
            fingerprint: "key-a".into(),
            system: "posix".into(),
        };
        let id = workspace(&base, "/A").identity;
        assert_eq!(workspace(&base, "/A").identity, id);
        for change in [
            Host {
                user: "Alice".into(),
                ..base.clone()
            },
            Host {
                port: 222,
                ..base.clone()
            },
            Host {
                host: "other.example".into(),
                ..base.clone()
            },
            Host {
                fingerprint: "key-b".into(),
                ..base.clone()
            },
            Host {
                system: "windows".into(),
                ..base.clone()
            },
        ] {
            assert_ne!(workspace(&change, "/A").identity, id);
        }
        assert_ne!(workspace(&base, "/a").identity, id);
    }
    #[test]
    fn require_unambiguous_absolute_directory_and_leaf() {
        for p in ["/", "/工作/项目"] {
            assert!(valid_root(p))
        }
        for p in [
            ".",
            "C:/项目",
            "/a//b",
            "/a/../b",
            "/home/user/.ssh",
            "/A\\B",
            "/bad\u{202e}name",
        ] {
            assert!(!valid_root(p));
        }
        assert!(text_name("工作.MD"));
        for n in ["file.js", "a/b.md", "a\\b.md", "dir\u{2066}.txt"] {
            assert!(!text_name(n));
        }
    }
}
