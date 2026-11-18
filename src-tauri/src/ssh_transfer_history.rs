//! Per-transfer receipts on the local machine. Both workspace indexes address
//! the same file. A pending receipt is never an instruction to retry a transfer.
use super::peer::{workspace, Host};
use crate::workspace_identity::lock_directory;
use crate::task_journal::{line, new_id, read_journal, remove_journal, valid_id};
use crate::workspace_identity::{identify, pin_workspace, Workspace};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs::{self, File, OpenOptions},
    io::ErrorKind,
    os::windows::fs::OpenOptionsExt,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, Webview};

const PAGE: usize = 20;
const INVALID: &str = "传输记录无效 / Invalid transfer record";
fn stamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Start {
    version: u8,
    id: String,
    local_path: String,
    remote_path: String,
    peer: Host,
    local_workspace: Option<Workspace>,
    remote_workspace: Option<Workspace>,
    direction: String,
    directory: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    status: String,
    bytes: u64,
    total: u64,
    ended: u64,
    verify: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    id: String,
    bucket: String,
    status: String,
    revision: String,
    start: Option<Start>,
    outcome: Option<Outcome>,
}
#[derive(Serialize)]
pub struct Page {
    rows: Vec<Row>,
    next: Option<String>,
}

fn local_key(w: &Workspace) -> String {
    format!(
        "{:x}",
        Sha256::digest(format!("{}\0{}", w.identity, w.path.to_lowercase()).as_bytes())
    )
}
fn remote_key(id: &str) -> Option<&str> {
    id.strip_prefix("sftp:").filter(|k| {
        k.len() == 64
            && k.bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    })
}
fn bucket(s: &Start) -> String {
    let local = s
        .local_workspace
        .as_ref()
        .map(local_key)
        .unwrap_or_else(|| "none".into());
    let remote = s
        .remote_workspace
        .as_ref()
        .and_then(|w| remote_key(&w.identity))
        .unwrap_or("none");
    format!("{local}_{remote}")
}
struct Scope {
    key: String,
    local: bool,
}
impl Scope {
    fn new(root: Option<String>, remote: Option<String>) -> Result<Self, String> {
        match (root, remote) {
            (Some(r), None) => Ok(Self {
                key: local_key(&identify(Path::new(&r)).map_err(|e| e.to_string())?),
                local: true,
            }),
            (None, Some(r)) => Ok(Self {
                key: remote_key(&r).ok_or(INVALID)?.into(),
                local: false,
            }),
            _ => Err("请选择本地或远程目录 / Choose a workspace".into()),
        }
    }
    fn matches(&self, name: &str) -> bool {
        let valid =
            |k: &str| k == "none" || (k.len() == 64 && k.bytes().all(|b| b.is_ascii_hexdigit()));
        name.split_once('_').is_some_and(|(l, r)| {
            valid(l) && valid(r) && self.key == if self.local { l } else { r }
        })
    }
}
fn storage(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|p| p.join("sftp-history"))
        .map_err(|e| e.to_string())
}
fn open_dir(path: &Path, create: bool) -> Result<Option<File>, String> {
    if create {
        if let Err(e) = fs::create_dir(path) {
            if e.kind() != ErrorKind::AlreadyExists {
                return Err(e.to_string());
            }
        }
    } else if let Err(e) = fs::symlink_metadata(path) {
        return if e.kind() == ErrorKind::NotFound {
            Ok(None)
        } else {
            Err(e.to_string())
        };
    }
    lock_directory(path).map(Some)
}
impl Start {
    pub(super) fn new(
        host: &Host,
        local: &Path,
        remote: &str,
        dir: &str,
        directory: bool,
        relative: Option<&str>,
    ) -> Self {
        let filename = local.file_name().unwrap_or_default().to_string_lossy();
        let remote_path = if dir == "upload" {
            super::join(remote, &filename)
        } else {
            remote.to_owned()
        };
        // The queue's reviewed tree label can associate nested entries with the
        // reviewed root only when it is an actual suffix of both endpoints.
        let label =
            relative.filter(|s| !s.is_empty() && s.split('/').all(|p| super::leaf(p).is_ok()));
        let nested = label.filter(|s| {
            local.ends_with(Path::new(s))
                && remote_path
                    .strip_suffix(*s)
                    .is_some_and(|p| p.ends_with('/'))
        });
        let depth = nested.map_or(1, |s| s.split('/').count());
        let local_workspace = local.ancestors().nth(depth).and_then(|p| identify(p).ok());
        let mut parent = remote_path.as_str();
        let absolute =
            parent.starts_with('/') && parent[1..].split('/').all(|p| super::leaf(p).is_ok());
        for _ in 0..depth {
            parent = parent.rsplit_once('/').map_or("", |(p, _)| p);
        }
        let remote_workspace =
            absolute.then(|| workspace(host, if parent.is_empty() { "/" } else { parent }));
        Self {
            version: 1,
            id: new_id(),
            local_path: local.to_string_lossy().into_owned(),
            remote_path,
            peer: host.clone(),
            local_workspace,
            remote_workspace,
            direction: dir.into(),
            directory,
        }
    }
}
pub(super) struct Journal {
    file: File,
    _guards: Vec<File>,
}
impl Journal {
    pub(super) fn begin(base: &Path, start: &Start) -> Result<Self, String> {
        let parent = base.parent().ok_or(INVALID)?;
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let mut guards = vec![
            lock_directory(parent)?,
            open_dir(base, true)?.ok_or(INVALID)?,
        ];
        if let Some(workspace) = &start.local_workspace {
            guards.extend(pin_workspace(workspace).map_err(|e| e.to_string())?);
        }
        let dir = base.join(bucket(start));
        guards.push(open_dir(&dir, true)?.ok_or(INVALID)?);
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .share_mode(1)
            .open(dir.join(format!("{}.jsonl", start.id)))
            .map_err(|e| e.to_string())?;
        line(&mut file, start)?;
        Ok(Self {
            file,
            _guards: guards,
        })
    }
    pub(super) fn finish(
        mut self,
        status: String,
        bytes: u64,
        total: u64,
        verify: bool,
        reason: Option<String>,
    ) -> Result<(), String> {
        line(
            &mut self.file,
            &Outcome {
                status,
                bytes,
                total,
                ended: stamp(),
                verify,
                reason,
            },
        )
    }
}
fn parse(id: String, group: String, bytes: &[u8], live: bool) -> Row {
    let revision = if live {
        String::new()
    } else {
        format!("{:x}", Sha256::digest(bytes))
    };
    let mut row = Row {
        id,
        bucket: group,
        revision,
        status: "damaged".into(),
        start: None,
        outcome: None,
    };
    let mut lines = bytes.split_inclusive(|b| *b == b'\n');
    let Some(start) = lines
        .next()
        .and_then(|l| l.strip_suffix(b"\n"))
        .and_then(|l| serde_json::from_slice::<Start>(l).ok())
    else {
        return row;
    };
    if start.version != 1 || start.id != row.id || bucket(&start) != row.bucket {
        return row;
    }
    row.start = Some(start);
    let Some(raw) = lines.next() else {
        row.status = if live { "running" } else { "unconfirmed" }.into();
        return row;
    };
    let Some(raw) = raw.strip_suffix(b"\n") else {
        row.status = "unconfirmed".into();
        return row;
    };
    if let Ok(outcome) = serde_json::from_slice::<Outcome>(raw) {
        if lines.next().is_none()
            && matches!(outcome.status.as_str(), "complete" | "cancelled" | "failed")
        {
            row.status = if outcome.verify {
                "unconfirmed".into()
            } else {
                outcome.status.clone()
            };
            row.outcome = Some(outcome);
        }
    }
    row
}
fn list(base: &Path, scope: &Scope, before: Option<&str>) -> Result<Page, String> {
    let mut page = Page {
        rows: Vec::new(),
        next: None,
    };
    let Some(_base) = open_dir(base, false)? else {
        return Ok(page);
    };
    let mut selected = BTreeSet::new();
    for item in fs::read_dir(base).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let group = item.file_name().to_string_lossy().into_owned();
        if !scope.matches(&group) {
            continue;
        }
        let Some(_guard) = open_dir(&item.path(), false)? else {
            continue;
        };
        for entry in fs::read_dir(item.path()).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name();
            let Some(id) = name.to_str().and_then(|n| n.strip_suffix(".jsonl")) else {
                continue;
            };
            if !valid_id(id) || before.is_some_and(|c| id >= c) {
                continue;
            }
            selected.insert((id.to_owned(), group.clone()));
            if selected.len() > PAGE + 1 {
                selected.pop_first();
            }
        }
    }
    let more = selected.len() > PAGE;
    for (id, group) in selected.into_iter().rev().take(PAGE) {
        let dir = base.join(&group);
        let Some(_guard) = open_dir(&dir, false)? else {
            continue;
        };
        let path = dir.join(format!("{id}.jsonl"));
        let row = match read_journal(&path) {
            Ok((b, live)) => parse(id, group, &b, live),
            Err(_) => Row {
                id,
                bucket: group,
                status: "unavailable".into(),
                revision: String::new(),
                start: None,
                outcome: None,
            },
        };
        page.rows.push(row);
    }
    if more {
        page.next = page.rows.last().map(|r| r.id.clone());
    }
    Ok(page)
}
#[tauri::command]
pub async fn ssh_history_list(
    view: Webview,
    app: AppHandle,
    root: Option<String>,
    remote_workspace: Option<String>,
    before: Option<String>,
) -> Result<Page, String> {
    crate::workspace_identity::local(&view)?;
    let base = storage(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        list(
            &base,
            &Scope::new(root, remote_workspace)?,
            before.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn ssh_history_remove(
    view: Webview,
    app: AppHandle,
    root: Option<String>,
    remote_workspace: Option<String>,
    bucket: String,
    id: String,
    revision: String,
) -> Result<(), String> {
    crate::workspace_identity::local(&view)?;
    let base = storage(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let scope = Scope::new(root, remote_workspace)?;
        if !scope.matches(&bucket) || !valid_id(&id) {
            return Err(INVALID.into());
        }
        let _base = open_dir(&base, false)?.ok_or(INVALID)?;
        let dir = base.join(bucket);
        let _dir = open_dir(&dir, false)?.ok_or(INVALID)?;
        remove_journal(&dir.join(format!("{id}.jsonl")), &revision)
    })
    .await
    .map_err(|e| e.to_string())?
}
pub(super) fn begin(
    app: &AppHandle,
    host: &Host,
    local: &Path,
    remote: &str,
    direction: &str,
    directory: bool,
    relative: Option<&str>,
) -> Result<Journal, String> {
    Journal::begin(
        &storage(app)?,
        &Start::new(host, local, remote, direction, directory, relative),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn host(fp: &str) -> Host {
        Host {
            host: "example.test".into(),
            port: 22,
            user: "owner".into(),
            fingerprint: fp.into(),
            system: "posix".into(),
        }
    }
    fn local(p: &Path) -> Scope {
        Scope::new(Some(p.to_string_lossy().into()), None).unwrap()
    }
    fn remote(h: &Host, p: &str) -> Scope {
        Scope::new(None, Some(workspace(h, p).identity)).unwrap()
    }
    #[test]
    fn receipts_bind_both_reviewed_roots_and_isolate_replaced_folders_and_keys() {
        let temp = tempfile::tempdir().unwrap();
        let base = temp.path().join("history");
        let a = temp.path().join("A");
        let b = temp.path().join("B");
        fs::create_dir_all(a.join("tree")).unwrap();
        fs::create_dir(&b).unwrap();
        let peer = host("one");
        assert!(list(&base, &local(&a), None).unwrap().rows.is_empty());
        assert!(!base.exists());
        let start = Start::new(
            &peer,
            &a.join("tree").join("文档.txt"),
            "/remote/tree",
            "upload",
            false,
            Some("tree/文档.txt"),
        );
        let journal = Journal::begin(&base, &start).unwrap();
        let live = list(&base, &local(&a), None).unwrap().rows.pop().unwrap();
        assert_eq!(live.status, "running");
        assert!(live.revision.is_empty());
        assert!(fs::rename(&a, temp.path().join("replaced-while-running")).is_err());
        let source = a.join("pending.part");
        let published = a.join("published.txt");
        fs::write(&source, b"content").unwrap();
        super::super::finalize_download(&source, &published).unwrap();
        assert_eq!(fs::read(&published).unwrap(), b"content");
        journal
            .finish("complete".into(), 12, 12, false, None)
            .unwrap();
        let original = list(&base, &remote(&peer, "/remote"), None)
            .unwrap()
            .rows
            .pop()
            .unwrap();
        assert_eq!(original.id, live.id);
        assert_eq!(original.status, "complete");
        for scope in [
            local(&b),
            remote(&host("two"), "/remote"),
            remote(&peer, "/elsewhere"),
        ] {
            assert!(list(&base, &scope, None).unwrap().rows.is_empty());
        }
        fs::rename(&a, temp.path().join("moved")).unwrap();
        fs::create_dir(&a).unwrap();
        assert!(list(&base, &local(&a), None).unwrap().rows.is_empty());
        let path = base
            .join(&original.bucket)
            .join(format!("{}.jsonl", original.id));
        assert!(remove_journal(&path, "stale").is_err());
        remove_journal(&path, &original.revision).unwrap();
        assert!(list(&base, &remote(&peer, "/remote"), None)
            .unwrap()
            .rows
            .is_empty());
    }
    #[test]
    fn unfinished_and_torn_receipts_are_uncertain_and_later_pages_are_disjoint() {
        let temp = tempfile::tempdir().unwrap();
        let base = temp.path().join("history");
        let scope = local(temp.path());
        for _ in 0..PAGE + 2 {
            let start = Start::new(
                &host("one"),
                &temp.path().join("download.txt"),
                "/source.txt",
                "download",
                false,
                None,
            );
            let journal = Journal::begin(&base, &start).unwrap();
            drop(journal);
            use std::io::Write;
            OpenOptions::new()
                .append(true)
                .open(
                    base.join(bucket(&start))
                        .join(format!("{}.jsonl", start.id)),
                )
                .unwrap()
                .write_all(b"{")
                .unwrap();
        }
        let page = list(&base, &scope, None).unwrap();
        assert_eq!(page.rows.len(), PAGE);
        assert!(page.rows.iter().all(|r| r.status == "unconfirmed"));
        let rest = list(&base, &scope, page.next.as_deref()).unwrap();
        assert_eq!(rest.rows.len(), 2);
        assert!(rest.next.is_none());
        assert!(rest
            .rows
            .iter()
            .all(|r| r.id < page.rows.last().unwrap().id));
    }
}
