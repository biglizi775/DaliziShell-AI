//! Reviewed queues survive process exit. The synced cursor advances before each dispatch.
use super::{batch::BatchFile, tasks::Host, Session};
use crate::agent_profile::lock_memory_directory;
use crate::task_journal::{line, new_id, read_bounded, remove_bounded, valid_id};
use dalizi_harness_client::snapshot::{identify, pin_workspace, Workspace};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs::{self, File, OpenOptions},
    io::ErrorKind,
    os::windows::fs::OpenOptionsExt,
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
};
use tauri::{AppHandle, Manager, Webview};
use windows::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;

const LIMIT: u64 = 128 * 1024 * 1024;
const INVALID: &str = "传输批次记录无效 / Invalid batch record";
const CHANGED: &str = "批次或连接已变化，请重新核对 / Batch or connection changed. Review again";
const PAGE: usize = 20;

#[derive(Serialize, Deserialize)]
struct Manifest {
    version: u8,
    #[serde(default)]
    stop_on_error: bool,
    #[serde(default)]
    resumable: bool,
    peer: Host,
    direction: String,
    destination: String,
    files: Vec<BatchFile>,
    roots: BTreeMap<PathBuf, Workspace>,
}

fn local_root(file: &BatchFile) -> Result<&Path, String> {
    let path = Path::new(&file.local_path);
    if !crate::preview::ordinary_path(path)
        || !matches!(file.entry_kind.as_str(), "directory" | "file")
    {
        return Err(INVALID.into());
    }
    for name in file.name.split('/') {
        super::batch::windows_name(name)?;
    }
    if !path.ends_with(&file.name) {
        return Err(INVALID.into());
    }
    path.ancestors()
        .nth(file.name.split('/').count())
        .ok_or_else(|| INVALID.into())
}
impl Manifest {
    fn anchor<'a>(direction: &str, file: &'a BatchFile) -> Result<&'a Path, String> {
        if direction == "upload" {
            let path = Path::new(&file.local_path);
            if file.entry_kind == "directory" {
                return Ok(path);
            }
            return path.parent().ok_or_else(|| INVALID.into());
        }
        local_root(file)
    }
    fn new(
        peer: Host,
        direction: String,
        destination: String,
        files: Vec<BatchFile>,
    ) -> Result<Self, String> {
        if files.is_empty() || files.len() > 2000 {
            return Err(INVALID.into());
        }
        let mut roots = BTreeMap::new();
        for f in &files {
            let root = local_root(f)?;
            super::remote_path(&f.remote)?;
            let fits = match direction.as_str() {
                "upload" => {
                    let target = super::join(&f.remote, f.name.rsplit('/').next().ok_or(INVALID)?);
                    target == super::join(&destination, &f.name)
                }
                "download" => {
                    root == Path::new(&destination)
                        && f.remote
                            .strip_suffix(&f.name)
                            .is_some_and(|s| s.ends_with('/'))
                }
                _ => false,
            };
            if !fits {
                return Err(INVALID.into());
            }
            let anchor = Self::anchor(&direction, f)?;
            if !roots.contains_key(anchor) {
                roots.insert(
                    anchor.to_owned(),
                    identify(anchor).map_err(|e| e.to_string())?,
                );
            }
        }
        Ok(Self {
            version: 1,
            stop_on_error: false,
            resumable: false,
            peer,
            direction,
            destination,
            files,
            roots,
        })
    }
    fn pin(&self, file: &BatchFile) -> Result<Vec<File>, String> {
        let root = self
            .roots
            .get(Self::anchor(&self.direction, file)?)
            .ok_or(INVALID)?;
        pin_workspace(root).map_err(|e| {
            format!(
                "原本地目录已变化或不可访问 / Reviewed local folder changed or is unavailable: {e}"
            )
        })
    }
}

struct Lease {
    _storage: Vec<File>,
    path: PathBuf,
    writer: File,
    manifest: Manifest,
    next: usize,
    owner: u32,
    key: String,
}
static LEASES: LazyLock<Mutex<HashMap<String, Lease>>> = LazyLock::new(Default::default);

fn storage(app: &AppHandle, create: bool) -> Result<Option<(PathBuf, Vec<File>)>, String> {
    let parent = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let dir = parent.join("sftp-batches");
    if create {
        fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    } else if !parent.try_exists().map_err(|e| e.to_string())? {
        return Ok(None);
    }
    let p = lock_memory_directory(&parent)?;
    if create {
        if let Err(e) = fs::create_dir(&dir) {
            if e.kind() != ErrorKind::AlreadyExists {
                return Err(e.to_string());
            }
        }
    } else if !dir.try_exists().map_err(|e| e.to_string())? {
        return Ok(None);
    }
    let d = lock_memory_directory(&dir)?;
    Ok(Some((dir, vec![p, d])))
}
fn path_for(dir: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err(INVALID.into());
    }
    Ok(dir.join(format!("{id}.jsonl")))
}
fn open(path: &Path, create: bool, write: bool) -> std::io::Result<File> {
    OpenOptions::new()
        .read(true)
        .append(write)
        .create_new(create)
        .share_mode(1)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(path)
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Settings {
    stop_on_error: bool,
    resumable: bool,
}
#[derive(Deserialize)]
#[serde(untagged)]
enum Record {
    Cursor(Option<usize>),
    Settings(Settings),
}
fn parse(bytes: &[u8]) -> Result<(Manifest, usize), String> {
    // A torn last line cannot establish whether a dispatch was recorded.
    let mut lines = bytes
        .strip_suffix(b"\n")
        .ok_or(INVALID)?
        .split(|b| *b == b'\n');
    let mut header: Manifest =
        serde_json::from_slice(lines.next().ok_or(INVALID)?).map_err(|_| INVALID)?;
    if header.version != 1 || header.files.is_empty() || header.files.len() > 2000 {
        return Err(INVALID.into());
    }
    let mut next = 0;
    for record in lines {
        if next >= header.files.len() {
            return Err(INVALID.into());
        }
        match serde_json::from_slice(record).map_err(|_| INVALID)? {
            Record::Cursor(Some(i)) if i == next => next += 1,
            Record::Cursor(None) => next = header.files.len(),
            Record::Settings(settings) => {
                header.stop_on_error = settings.stop_on_error;
                header.resumable = settings.resumable;
            }
            _ => return Err(INVALID.into()),
        }
    }
    Ok((header, next))
}
fn revision(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn retire(lease: Lease) {
    let Lease {
        writer,
        path,
        _storage,
        ..
    } = lease;
    drop(writer);
    // The last synced cursor already excludes every item even if cleanup fails.
    let _ = fs::remove_file(path);
    drop(_storage);
}
pub(super) fn dispatch(
    app: &AppHandle,
    session: &Session,
    id: &str,
    index: usize,
    direction: &str,
    local: &Path,
    remote: &str,
    kind: &str,
    name: Option<&str>,
) -> Result<(super::history::Journal, Vec<File>), String> {
    let mut leases = LEASES.lock().map_err(|_| INVALID)?;
    let lease = leases.get_mut(id).ok_or(CHANGED)?;
    if lease.owner != session.id
        || lease.key != session.key
        || lease.next != index
        || lease.manifest.direction != direction
    {
        return Err(CHANGED.into());
    }
    let file = lease.manifest.files.get(index).ok_or(INVALID)?;
    if Path::new(&file.local_path) != local
        || file.remote != remote
        || file.entry_kind != kind
        || Some(file.name.as_str()) != name
    {
        return Err(CHANGED.into());
    }
    let pins = lease.manifest.pin(file)?;
    // The receipt owns its own directory pins. A cursor can never advance past
    // a file without leaving the user a durable receipt for that attempt.
    let receipt = super::history::begin(
        app,
        &session.task_host.host,
        local,
        remote,
        direction,
        kind == "directory",
        name,
    )?;
    line(&mut lease.writer, &index)?;
    lease.next += 1;
    if lease.next == lease.manifest.files.len() {
        retire(leases.remove(id).ok_or(CHANGED)?);
    }
    Ok((receipt, pins))
}
#[tauri::command]
pub async fn ssh_batch_create(
    view: Webview,
    app: AppHandle,
    id: u32,
    direction: String,
    destination: String,
    files: Vec<BatchFile>,
    stop_on_error: Option<bool>,
    resumable: Option<bool>,
) -> Result<String, String> {
    crate::ai::harness_tasks::local(&view)?;
    let session = super::get(id)?;
    session.task_host.trusted()?;
    let mut manifest = Manifest::new(
        session.task_host.host.clone(),
        direction,
        destination,
        files,
    )?;
    manifest.stop_on_error = stop_on_error.unwrap_or(false);
    manifest.resumable = resumable.unwrap_or(false);
    let bytes = serde_json::to_vec(&manifest).map_err(|e| e.to_string())?;
    if bytes.len() as u64 + 16384 > LIMIT {
        return Err("批次路径清单过大 / Batch path manifest is too large".into());
    }
    let (dir, guards) = storage(&app, true)?.ok_or(INVALID)?;
    let batch = new_id();
    let path = path_for(&dir, &batch)?;
    let mut writer = open(&path, true, true).map_err(|e| e.to_string())?;
    line(&mut writer, &manifest)?;
    LEASES.lock().map_err(|_| INVALID)?.insert(
        batch.clone(),
        Lease {
            _storage: guards,
            path,
            writer,
            manifest,
            next: 0,
            owner: id,
            key: session.key.clone(),
        },
    );
    Ok(batch)
}
#[derive(Serialize)]
pub struct Row {
    id: String,
    revision: String,
    peer: Option<Host>,
    direction: String,
    destination: String,
    started: usize,
    pending: usize,
    #[serde(rename = "stopOnError")]
    stop_on_error: bool,
    resumable: bool,
}
impl Row {
    fn unreadable(id: String, revision: String) -> Self {
        Self {
            id,
            revision,
            peer: None,
            direction: String::new(),
            destination: String::new(),
            started: 0,
            pending: 0,
            stop_on_error: false,
            resumable: false,
        }
    }
}
#[derive(Serialize)]
pub struct Page {
    rows: Vec<Row>,
    next: Option<String>,
}
#[tauri::command]
pub async fn ssh_batch_list(
    view: Webview,
    app: AppHandle,
    before: Option<String>,
) -> Result<Page, String> {
    crate::ai::harness_tasks::local(&view)?;
    let mut page = Page {
        rows: vec![],
        next: None,
    };
    let Some((dir, _guards)) = storage(&app, false)? else {
        return Ok(page);
    };
    let mut ids = BTreeSet::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let name = entry.map_err(|e| e.to_string())?.file_name();
        let Some(id) = name.to_str().and_then(|s| s.strip_suffix(".jsonl")) else {
            continue;
        };
        if valid_id(id) && before.as_deref().is_none_or(|s| id < s) {
            ids.insert(id.to_owned());
            if ids.len() > PAGE + 1 {
                ids.pop_first();
            }
        }
    }
    let more = ids.len() > PAGE;
    for id in ids.into_iter().rev().take(PAGE) {
        if more {
            page.next = Some(id.clone());
        }
        let file = match open(&path_for(&dir, &id)?, false, false) {
            Ok(f) => f,
            Err(e) if e.raw_os_error() == Some(32) || e.kind() == ErrorKind::NotFound => continue,
            Err(_) => {
                page.rows.push(Row::unreadable(id, String::new()));
                continue;
            }
        };
        let Ok(bytes) = read_bounded(&file, LIMIT) else {
            page.rows.push(Row::unreadable(id, String::new()));
            continue;
        };
        let revision = revision(&bytes);
        match parse(&bytes) {
            Ok((h, started)) if started < h.files.len() => page.rows.push(Row {
                id,
                revision,
                peer: Some(h.peer),
                direction: h.direction,
                destination: h.destination,
                started,
                pending: h.files.len() - started,
                stop_on_error: h.stop_on_error,
                resumable: h.resumable,
            }),
            Err(_) => page.rows.push(Row::unreadable(id, revision)),
            _ => {}
        }
    }
    Ok(page)
}
#[derive(Serialize)]
pub struct Review {
    files: Vec<BatchFile>,
    start: usize,
}
#[tauri::command]
pub async fn ssh_batch_review(
    view: Webview,
    app: AppHandle,
    batch_id: String,
    revision: String,
) -> Result<Review, String> {
    crate::ai::harness_tasks::local(&view)?;
    let (dir, _guards) = storage(&app, false)?.ok_or(CHANGED)?;
    let file = open(&path_for(&dir, &batch_id)?, false, false).map_err(|e| e.to_string())?;
    let (h, start) = reviewed(&file, &revision)?;
    Ok(Review {
        files: h.files.into_iter().skip(start).collect(),
        start,
    })
}
fn reviewed(file: &File, expected: &str) -> Result<(Manifest, usize), String> {
    let bytes = read_bounded(file, LIMIT)?;
    if revision(&bytes) != expected {
        return Err(CHANGED.into());
    }
    let (h, start) = parse(&bytes)?;
    if start >= h.files.len() {
        return Err(CHANGED.into());
    }
    Ok((h, start))
}
#[tauri::command]
pub async fn ssh_batch_claim(
    view: Webview,
    app: AppHandle,
    id: u32,
    batch_id: String,
    revision: String,
    stop_on_error: Option<bool>,
    resumable: Option<bool>,
) -> Result<(), String> {
    crate::ai::harness_tasks::local(&view)?;
    let session = super::get(id)?;
    session.task_host.trusted()?;
    let (dir, guards) = storage(&app, false)?.ok_or(CHANGED)?;
    let path = path_for(&dir, &batch_id)?;
    let mut writer = open(&path, false, true).map_err(|e| format!("{CHANGED}: {e}"))?;
    let (mut manifest, next) = reviewed(&writer, &revision)?;
    if manifest.peer != session.task_host.host {
        return Err(CHANGED.into());
    }
    let mut roots = BTreeSet::new();
    for f in &manifest.files[next..] {
        if roots.insert(Manifest::anchor(&manifest.direction, f)?) {
            manifest.pin(f)?;
        }
    }
    let settings = Settings {
        stop_on_error: stop_on_error.unwrap_or(manifest.stop_on_error),
        resumable: resumable.unwrap_or(manifest.resumable),
    };
    if settings.stop_on_error != manifest.stop_on_error || settings.resumable != manifest.resumable
    {
        line(&mut writer, &settings)?;
        manifest.stop_on_error = settings.stop_on_error;
        manifest.resumable = settings.resumable;
    }
    LEASES.lock().map_err(|_| INVALID)?.insert(
        batch_id,
        Lease {
            _storage: guards,
            path,
            writer,
            manifest,
            next,
            owner: id,
            key: session.key.clone(),
        },
    );
    Ok(())
}
#[tauri::command]
pub async fn ssh_batch_end(
    view: Webview,
    id: u32,
    batch_id: String,
    discard: bool,
) -> Result<(), String> {
    crate::ai::harness_tasks::local(&view)?;
    let mut leases = LEASES.lock().map_err(|_| INVALID)?;
    let Some(lease) = leases.get_mut(&batch_id) else {
        return Ok(());
    };
    if lease.owner != id {
        return Err(CHANGED.into());
    }
    if discard {
        line(&mut lease.writer, &Option::<usize>::None)?;
    }
    if let Some(lease) = leases.remove(&batch_id) {
        if discard {
            retire(lease);
        }
    }
    Ok(())
}
#[tauri::command]
pub async fn ssh_batch_forget(
    view: Webview,
    app: AppHandle,
    batch_id: String,
    revision: String,
) -> Result<(), String> {
    crate::ai::harness_tasks::local(&view)?;
    let (dir, _guards) = storage(&app, false)?.ok_or(CHANGED)?;
    remove_bounded(&path_for(&dir, &batch_id)?, &revision, LIMIT)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn manifest(root: &Path) -> Manifest {
        let peer = Host {
            host: "host.test".into(),
            port: 22,
            user: "owner".into(),
            fingerprint: "fingerprint".into(),
            system: "posix".into(),
        };
        let files = ["tree", "tree/文档.txt"]
            .into_iter()
            .map(|name| BatchFile {
                name: name.into(),
                local_path: root.join(name).to_string_lossy().into(),
                remote: format!("/data/{name}"),
                size: None,
                entry_kind: if name == "tree" { "directory" } else { "file" }.into(),
            })
            .collect();
        Manifest::new(
            peer,
            "download".into(),
            root.to_string_lossy().into(),
            files,
        )
        .unwrap()
    }
    #[test]
    fn torn_duplicate_skipped_and_post_cancel_cursors_cannot_replay() {
        let temp = tempfile::tempdir().unwrap();
        let mut header = serde_json::to_vec(&manifest(temp.path())).unwrap();
        assert!(parse(&header).is_err());
        header.push(b'\n');
        let cursor = |tail: &[u8]| parse(&[header.as_slice(), tail].concat()).map(|(_, n)| n);
        assert_eq!(cursor(b"").unwrap(), 0);
        assert_eq!(cursor(b"0\n").unwrap(), 1);
        assert_eq!(cursor(b"0\n1\n").unwrap(), 2);
        assert_eq!(cursor(b"null\n").unwrap(), 2);
        for tail in [
            b"0".as_slice(),
            b"1\n",
            b"0\n0\n",
            b"null\n0\n",
            b"0\n1\n2\n",
        ] {
            assert!(cursor(tail).is_err());
        }
    }
    #[test]
    fn active_writer_excludes_other_owners_and_revision_binds_pending_entries() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("journal.jsonl");
        let header = manifest(temp.path());
        let mut f = open(&path, true, true).unwrap();
        line(&mut f, &header).unwrap();
        assert!(open(&path, false, true).is_err());
        assert!(open(&path, false, false).is_err());
        drop(f);
        let bytes = fs::read(&path).unwrap();
        let rev = revision(&bytes);
        let mut f = open(&path, false, true).unwrap();
        assert_eq!(reviewed(&f, &rev).unwrap().1, 0);
        line(&mut f, &0usize).unwrap();
        drop(f);
        assert!(reviewed(&open(&path, false, false).unwrap(), &rev).is_err());
        assert!(remove_bounded(&path, &rev, LIMIT).is_err());
        let current = revision(&fs::read(&path).unwrap());
        assert_eq!(
            reviewed(&open(&path, false, false).unwrap(), &current)
                .unwrap()
                .1,
            1
        );
        remove_bounded(&path, &current, LIMIT).unwrap();
        assert!(!path.exists());
    }
}
