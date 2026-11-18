//! Local file-plan receipts. A flushed start precedes each effect; only a flushed
//! outcome proves that it returned. Reading a journal never resumes a plan.
use super::{display_path, relative_path, validate_root, PermissionMode, StoredPlan, ACTION_LIMIT};
use crate::agent_profile::lock_memory_directory;
use crate::task_journal::{line, new_id, read_journal, remove_journal, valid_id, BUSY, INVALID};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::os::windows::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use windows::Win32::Storage::FileSystem::FILE_FLAG_DELETE_ON_CLOSE;

const CAPACITY: usize = 128;
const PAGE: usize = 16;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Step {
    kind: String,
    source: Option<String>,
    target: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Header {
    version: u8,
    id: String,
    role: String,
    mode: PermissionMode,
    approved: bool,
    steps: Vec<Step>,
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "camelCase", deny_unknown_fields)]
enum Event {
    Start {
        index: usize,
    },
    Outcome {
        index: usize,
        success: bool,
        ms: u64,
        detail: String,
    },
    Stop {
        reason: StopReason,
    },
}
#[derive(Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub(super) enum StopReason {
    Cancelled,
    Expired,
}

struct Directory {
    path: PathBuf,
    _guards: Vec<File>,
}
impl Directory {
    fn open(root: &Path, create: bool) -> Result<Option<Self>, String> {
        let mut path = root.to_owned();
        let mut guards = vec![lock_memory_directory(root)?];
        for part in [".dalizi", "tasks"] {
            path.push(part);
            if create {
                match fs::create_dir(&path) {
                    Ok(()) => (),
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
                    Err(e) => return Err(e.to_string()),
                }
            } else if let Err(e) = fs::symlink_metadata(&path) {
                if e.kind() == std::io::ErrorKind::NotFound {
                    return Ok(None);
                }
                return Err(e.to_string());
            }
            guards.push(lock_memory_directory(&path)?);
        }
        Ok(Some(Self {
            path,
            _guards: guards,
        }))
    }
    fn ids(&self) -> Result<Vec<String>, String> {
        let mut ids = Vec::new();
        for entry in fs::read_dir(&self.path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name();
            if let Some(id) = name
                .to_str()
                .and_then(|n| n.strip_prefix("local-"))
                .and_then(|n| n.strip_suffix(".jsonl"))
                .filter(|id| valid_id(id))
            {
                ids.push(id.to_owned());
            }
        }
        ids.sort_unstable_by(|a, b| b.cmp(a));
        Ok(ids)
    }
    fn lock_creation(&self) -> Result<File, String> {
        let path = self.path.join(".local-create.lock");
        let start = Instant::now();
        loop {
            match OpenOptions::new()
                .write(true)
                .create_new(true)
                .share_mode(0)
                .custom_flags(FILE_FLAG_DELETE_ON_CLOSE.0)
                .open(&path)
            {
                Ok(file) => return Ok(file),
                Err(e)
                    if (e.kind() == std::io::ErrorKind::AlreadyExists
                        || e.raw_os_error() == Some(32))
                        && start.elapsed() < Duration::from_secs(2) =>
                {
                    std::thread::sleep(Duration::from_millis(15));
                }
                Err(e) => return Err(format!("{BUSY}: {e}")),
            }
        }
    }
    fn file(&self, id: &str) -> Result<PathBuf, String> {
        if !valid_id(id) {
            return Err(INVALID.into());
        }
        Ok(self.path.join(format!("local-{id}.jsonl")))
    }
}
pub(super) struct Writer {
    file: File,
    pub id: String,
    _dir: Directory,
}
impl Writer {
    pub fn begin(plan: &StoredPlan, mode: PermissionMode, approved: bool) -> Result<Self, String> {
        let relative = |p: &Path| {
            p.strip_prefix(&plan.root)
                .map(|v| v.to_string_lossy().into_owned())
                .map_err(|_| INVALID.to_owned())
        };
        let steps = plan
            .actions
            .iter()
            .map(|a| {
                Ok(Step {
                    kind: a.display.kind.clone(),
                    source: a.source.as_deref().map(relative).transpose()?,
                    target: relative(&a.target)?,
                })
            })
            .collect::<Result<_, String>>()?;
        Self::create(&plan.root, 1, &plan.role_id, mode, approved, steps)
    }
    fn create(
        root: &Path,
        version: u8,
        role: &str,
        mode: PermissionMode,
        approved: bool,
        steps: Vec<Step>,
    ) -> Result<Self, String> {
        let dir = Directory::open(root, true)?.ok_or(INVALID)?;
        let _lock = dir.lock_creation()?;
        if dir.ids()?.len() >= CAPACITY {
            return Err("已有 128 条文件操作记录。请先在「文件操作记录」中清理已核对的记录 / File history is full. Remove reviewed records first.".into());
        }
        let id = new_id();
        let header = Header {
            version,
            id: id.clone(),
            role: role.into(),
            mode,
            approved,
            steps,
        };
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .share_mode(1)
            .open(dir.file(&id)?)
            .map_err(|e| e.to_string())?;
        line(&mut file, &header)?;
        Ok(Self {
            file,
            id,
            _dir: dir,
        })
    }
    pub fn start(&mut self, index: usize) -> Result<(), String> {
        line(&mut self.file, &Event::Start { index })
    }
    pub fn outcome(
        &mut self,
        index: usize,
        result: &Result<(), String>,
        ms: u64,
        root: &Path,
    ) -> Result<(), String> {
        let detail = result
            .as_ref()
            .err()
            .map(|s| {
                s.replace(&display_path(root), ".")
                    .chars()
                    .filter(|c| !c.is_control())
                    .take(600)
                    .collect()
            })
            .unwrap_or_default();
        line(
            &mut self.file,
            &Event::Outcome {
                index,
                success: result.is_ok(),
                ms,
                detail,
            },
        )
    }
    pub fn stop(&mut self, reason: StopReason) -> Result<(), String> {
        line(&mut self.file, &Event::Stop { reason })
    }
}

pub(super) enum DocumentAction {
    SaveReply,
    UndoEdit,
}
impl DocumentAction {
    fn kind(&self) -> &'static str {
        match self {
            Self::SaveReply => "save_reply",
            Self::UndoEdit => "undo_edit",
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentReceipt {
    target: String,
    journal_id: String,
    error: Option<String>,
    journal_warning: Option<String>,
}

// The original commands returned a filename or unit and rejected file errors.
// Only callers requesting a receipt get both the effect and the journal outcome.
#[derive(Serialize)]
#[serde(untagged)]
pub enum DocumentReply<T> {
    Receipt(DocumentReceipt),
    Legacy(T),
}
impl DocumentReceipt {
    pub(super) fn reply<T>(
        self,
        with_receipt: Option<bool>,
        legacy: impl FnOnce(String) -> T,
    ) -> Result<DocumentReply<T>, String> {
        if with_receipt == Some(true) {
            return Ok(DocumentReply::Receipt(self));
        }
        if let Some(error) = self.error {
            return Err(error);
        }
        Ok(DocumentReply::Legacy(legacy(self.target)))
    }
}

pub(super) fn record_document(
    root: &str,
    target: &str,
    mode: PermissionMode,
    action: DocumentAction,
    effect: impl FnOnce(&Path, &Path) -> Result<(), String>,
) -> Result<DocumentReceipt, String> {
    mode.authorize(true)?;
    let root = validate_root(root)?;
    let relative = relative_path(target)?;
    if !relative
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("txt"))
    {
        return Err("请选择 .md 或 .txt 文件名 / Choose a .md or .txt filename".into());
    }
    let step = Step {
        kind: action.kind().into(),
        source: None,
        target: relative.to_string_lossy().into_owned(),
    };
    let mut journal = Writer::create(&root, 2, "", mode, true, vec![step])?;
    journal.start(0)?;
    let start = Instant::now();
    let result = effect(&root, &relative);
    let journal_warning = journal
        .outcome(0, &result, start.elapsed().as_millis() as u64, &root)
        .err();
    Ok(DocumentReceipt {
        target: display_path(&root.join(relative)),
        journal_id: journal.id,
        error: result.err(),
        journal_warning,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    id: String,
    status: &'static str,
    first_target: String,
    first_kind: String,
    role: String,
    mode: Option<PermissionMode>,
    approved: bool,
    count: usize,
    succeeded: usize,
    partial_tail: bool,
    revision: String,
}
#[derive(Serialize)]
struct StepView {
    #[serde(flatten)]
    step: Step,
    status: &'static str,
    ms: Option<u64>,
    detail: String,
}
#[derive(Serialize)]
pub struct Record {
    row: Row,
    steps: Vec<StepView>,
}

fn parse(id: &str, bytes: &[u8], live: bool) -> Record {
    let mut row = Row {
        id: id.into(),
        status: "damaged",
        first_target: String::new(),
        first_kind: String::new(),
        role: String::new(),
        mode: None,
        approved: false,
        count: 0,
        succeeded: 0,
        partial_tail: !bytes.ends_with(b"\n"),
        revision: format!("{:x}", Sha256::digest(bytes)),
    };
    let mut lines = bytes.split_inclusive(|b| *b == b'\n');
    let header = lines
        .next()
        .and_then(|l| l.strip_suffix(b"\n"))
        .and_then(|l| serde_json::from_slice::<Header>(l).ok());
    let Some(header) = header.filter(|h| {
        h.id == id
            && !h.steps.is_empty()
            && h.steps.len() <= ACTION_LIMIT
            && h.mode != PermissionMode::ReadOnly
            && (h.approved || h.mode == PermissionMode::Auto)
            && h.role.len() <= 80
            && match h.version {
                1 => h.steps.iter().all(|s| {
                    matches!(
                        s.kind.as_str(),
                        "mkdir" | "rename" | "move" | "copy" | "create_text" | "edit_text"
                    )
                }),
                2 => {
                    h.approved
                        && h.role.is_empty()
                        && h.steps.len() == 1
                        && h.steps[0].source.is_none()
                        && matches!(h.steps[0].kind.as_str(), "save_reply" | "undo_edit")
                }
                _ => false,
            }
            && h.steps.iter().all(|s| {
                relative_path(&s.target).is_ok()
                    && s.source.as_ref().is_none_or(|p| relative_path(p).is_ok())
            })
    }) else {
        if live && !bytes.contains(&b'\n') {
            row.status = "running";
        }
        return Record { row, steps: vec![] };
    };
    row.count = header.steps.len();
    row.first_target = header.steps[0].target.clone();
    row.first_kind = header.steps[0].kind.clone();
    row.role = header.role;
    row.mode = Some(header.mode);
    row.approved = header.approved;
    let mut steps: Vec<_> = header
        .steps
        .into_iter()
        .map(|step| StepView {
            step,
            status: "notStarted",
            ms: None,
            detail: String::new(),
        })
        .collect();
    let mut next = 0;
    let mut active = false;
    let mut terminal = None;
    for raw in lines {
        let Some(line) = raw.strip_suffix(b"\n") else {
            break;
        };
        if terminal.is_some() {
            terminal = Some("damaged");
            break;
        }
        match serde_json::from_slice::<Event>(line) {
            Ok(Event::Start { index }) if index == next && next < steps.len() && !active => {
                steps[next].status = if live { "running" } else { "unconfirmed" };
                active = true;
            }
            Ok(Event::Outcome {
                index,
                success,
                ms,
                detail,
            }) if index == next && active && detail.chars().count() <= 600 => {
                steps[index].status = if success { "success" } else { "failed" };
                steps[index].ms = Some(ms);
                steps[index].detail = detail;
                active = false;
                next += 1;
                if !success {
                    terminal = Some("failed");
                } else {
                    row.succeeded += 1;
                    if next == steps.len() {
                        terminal = Some("completed");
                    }
                }
            }
            Ok(Event::Stop { reason }) if !active => {
                terminal = Some(match reason {
                    StopReason::Cancelled => "cancelled",
                    StopReason::Expired => "expired",
                });
            }
            _ => {
                terminal = Some("damaged");
                break;
            }
        }
    }
    row.status = if row.partial_tail && terminal.is_some() {
        "damaged"
    } else {
        terminal.unwrap_or(if live { "running" } else { "interrupted" })
    };
    if matches!(row.status, "failed" | "expired" | "cancelled") {
        for step in &mut steps[next..] {
            step.status = "skipped";
        }
    }
    Record { row, steps }
}

fn read(dir: &Directory, id: &str) -> Result<Record, String> {
    let (bytes, live) = read_journal(&dir.file(id)?)?;
    let mut record = parse(id, &bytes, live);
    if live {
        record.row.revision.clear();
    }
    Ok(record)
}
#[derive(Serialize)]
pub struct Page {
    rows: Vec<Row>,
    total: usize,
    next: Option<String>,
}
fn list(root: &str, before: Option<&str>) -> Result<Page, String> {
    let mut page = Page {
        rows: Vec::new(),
        total: 0,
        next: None,
    };
    let Some(dir) = Directory::open(&validate_root(root)?, false)? else {
        return Ok(page);
    };
    let ids = dir.ids()?;
    page.total = ids.len();
    let mut ids = ids
        .into_iter()
        .filter(|id| before.is_none_or(|cursor| id.as_str() < cursor));
    for id in ids.by_ref().take(PAGE) {
        let row = match read(&dir, &id) {
            Ok(record) => record.row,
            Err(_) => {
                let mut row = parse(&id, &[], false).row;
                row.status = "unavailable";
                row.revision.clear();
                row
            }
        };
        page.rows.push(row);
    }
    if ids.next().is_some() {
        page.next = page.rows.last().map(|r| r.id.clone());
    }
    Ok(page)
}
fn directory(root: &str) -> Result<Directory, String> {
    Directory::open(&validate_root(root)?, false)?
        .ok_or_else(|| "没有文件操作记录 / No file operation records".into())
}
#[tauri::command]
pub async fn ai_file_history_list(root: String, before: Option<String>) -> Result<Page, String> {
    tauri::async_runtime::spawn_blocking(move || list(&root, before.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn ai_file_history_read(root: String, id: String) -> Result<Record, String> {
    tauri::async_runtime::spawn_blocking(move || read(&directory(&root)?, &id))
        .await
        .map_err(|e| e.to_string())?
}
fn remove(root: &str, id: &str, revision: &str) -> Result<(), String> {
    let dir = directory(root)?;
    remove_journal(&dir.file(id)?, revision)
}
#[tauri::command]
pub async fn ai_file_history_remove(
    root: String,
    id: String,
    revision: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || remove(&root, &id, &revision))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::{execute_one, execute_plan, validate_plan, Action};
    use std::io::Write;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Instant;

    const PRIVATE_TEXT: &str = "private text in the new document";

    fn plan(root: &Path) -> StoredPlan {
        let root = validate_root(&display_path(root)).unwrap();
        let actions = ["first.md", "目录", "last"]
            .into_iter()
            .enumerate()
            .map(|(i, target)| Action {
                kind: if i == 0 { "create_text" } else { "mkdir" }.into(),
                source: None,
                target: target.into(),
                original: None,
                content: (i == 0).then(|| PRIVATE_TEXT.to_owned()),
            })
            .collect();
        StoredPlan {
            actions: validate_plan(&root, actions).unwrap(),
            root,
            created: Instant::now(),
            permission_mode: PermissionMode::Confirm,
            role_id: "organizer".into(),
        }
    }
    fn statuses(record: &Record) -> Vec<&'static str> {
        record.steps.iter().map(|step| step.status).collect()
    }

    #[test]
    fn direct_actions_preserve_the_original_commands_and_keep_document_bodies_private() {
        let folder = tempfile::tempdir().unwrap();
        let root = display_path(folder.path());
        let target = "reply.md".to_owned();
        let save = |mode, with_receipt| {
            tauri::async_runtime::block_on(crate::ai::ai_save_reply(
                root.clone(),
                target.clone(),
                PRIVATE_TEXT.into(),
                mode,
                with_receipt,
            ))
        };
        assert!(save(PermissionMode::ReadOnly, Some(true)).is_err());
        assert!(!folder.path().join(".dalizi").exists());
        let saved = serde_json::to_value(save(PermissionMode::Confirm, None).unwrap()).unwrap();
        assert_eq!(
            saved.as_str(),
            Some(display_path(&folder.path().join(&target)).as_str())
        );
        assert!(save(PermissionMode::Confirm, None).is_err());
        let DocumentReply::Receipt(collision) = save(PermissionMode::Auto, Some(true)).unwrap()
        else {
            panic!("missing receipt")
        };
        assert!(collision
            .error
            .as_deref()
            .unwrap()
            .contains("Target already exists"));
        let dir = directory(&root).unwrap();
        let record = read(&dir, &collision.journal_id).unwrap();
        assert!(record.row.approved && record.row.role.is_empty());
        assert_eq!(record.row.mode, Some(PermissionMode::Auto));
        assert_eq!(record.row.first_kind, "save_reply");
        assert_eq!(statuses(&record), ["failed"]);
        assert!(!record.steps[0].detail.contains(&root));
        let canonical = folder.path().canonicalize().unwrap();
        crate::ai::document_edit::apply(
            &canonical,
            &canonical.join(&target),
            PRIVATE_TEXT,
            "replacement",
        )
        .unwrap();
        let undo = |version, with_receipt| {
            tauri::async_runtime::block_on(crate::ai::document_edit::ai_undo_document(
                root.clone(),
                target.clone(),
                PermissionMode::Confirm,
                version,
                with_receipt,
            ))
        };
        let DocumentReply::Receipt(stale) = undo(Some("old revision".into()), Some(true)).unwrap()
        else {
            panic!("missing receipt")
        };
        assert!(stale.error.is_some() && stale.journal_warning.is_none());
        assert_eq!(
            read(&dir, &stale.journal_id).unwrap().row.first_kind,
            "undo_edit"
        );
        assert_eq!(
            fs::read_to_string(folder.path().join(&target)).unwrap(),
            "replacement"
        );
        assert!(serde_json::to_value(undo(None, None).unwrap())
            .unwrap()
            .is_null());
        assert_eq!(
            fs::read_to_string(folder.path().join(&target)).unwrap(),
            PRIVATE_TEXT
        );
        let page = list(&root, None).unwrap();
        assert_eq!(page.total, 5);
        assert!(page
            .rows
            .iter()
            .any(|r| r.first_kind == "undo_edit" && r.status == "completed"));
        for row in page.rows {
            let raw = fs::read_to_string(dir.file(&row.id).unwrap()).unwrap();
            assert!(!raw.contains(PRIVATE_TEXT) && !raw.contains("replacement"));
        }
    }

    #[test]
    fn direct_actions_require_a_scoped_target_and_a_writable_journal() {
        let folder = tempfile::tempdir().unwrap();
        let root = display_path(folder.path());
        for target in ["../notes.md", ".dalizi/notes.md", "notes.exe"] {
            assert!(record_document(
                &root,
                target,
                PermissionMode::Confirm,
                DocumentAction::SaveReply,
                |_, _| panic!("invalid target executed")
            )
            .is_err());
        }
        assert!(!folder.path().join(".dalizi").exists());
        fs::write(folder.path().join(".dalizi"), b"keep").unwrap();
        assert!(record_document(
            &root,
            "notes.md",
            PermissionMode::Auto,
            DocumentAction::UndoEdit,
            |_, _| panic!("action executed without a journal")
        )
        .is_err());
        assert_eq!(fs::read(folder.path().join(".dalizi")).unwrap(), b"keep");
    }

    #[test]
    fn failures_keep_the_completed_prefix_and_only_remove_the_reviewed_record() {
        let folder = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let root = display_path(folder.path());
        assert_eq!(list(&root, None).unwrap().total, 0);
        assert!(!folder.path().join(".dalizi").exists());
        let work = plan(folder.path());
        fs::create_dir(folder.path().join("目录")).unwrap();
        let result = execute_plan(
            work,
            PermissionMode::Confirm,
            true,
            &AtomicBool::new(false),
            |_, _| {},
        )
        .unwrap();
        assert!(!result.completed);
        let dir = directory(&root).unwrap();
        let path = dir.file(&result.journal_id).unwrap();
        let record = read(&dir, &result.journal_id).unwrap();
        assert_eq!(record.row.status, "failed");
        assert_eq!(statuses(&record), ["success", "failed", "skipped"]);
        assert_eq!(record.row.role, "organizer");
        assert!(record.row.approved);
        let raw = fs::read_to_string(&path).unwrap();
        assert!(!raw.contains(PRIVATE_TEXT));
        assert_eq!(record.steps[1].step.target, "目录");
        assert_eq!(list(&display_path(other.path()), None).unwrap().total, 0);
        fs::write(&path, format!("{raw}broken\n")).unwrap();
        assert!(remove(&root, &result.journal_id, &record.row.revision).is_err());
        let damaged = read(&dir, &result.journal_id).unwrap();
        assert_eq!(damaged.row.status, "damaged");
        remove(&root, &result.journal_id, &damaged.row.revision).unwrap();
        assert!(!path.exists());
        assert_eq!(
            fs::read_to_string(folder.path().join("first.md")).unwrap(),
            PRIVATE_TEXT
        );
        assert!(!folder.path().join("last").exists());
    }

    #[test]
    fn stop_during_a_step_takes_effect_before_the_next_step() {
        let folder = tempfile::tempdir().unwrap();
        let cancel = AtomicBool::new(false);
        let result = execute_plan(
            plan(folder.path()),
            PermissionMode::Auto,
            false,
            &cancel,
            |index, status| {
                if index == 0 && status == "running" {
                    cancel.store(true, Ordering::Release);
                }
            },
        )
        .unwrap();
        assert!(result.stopped && !result.completed);
        let record = read(
            &directory(&display_path(folder.path())).unwrap(),
            &result.journal_id,
        )
        .unwrap();
        assert_eq!(record.row.status, "cancelled");
        assert_eq!(record.row.mode, Some(PermissionMode::Auto));
        assert!(!record.row.approved);
        assert_eq!(statuses(&record), ["success", "skipped", "skipped"]);
        assert!(!folder.path().join("目录").exists());
    }

    // This child process exits without running destructors, between the file effect
    // and its durable outcome. The parent supplies a fresh fixture and marker.
    #[test]
    fn crash_worker() {
        let Some(root) = std::env::var_os("DALIZI_TEST_JOURNAL_CHILD") else {
            return;
        };
        let root = PathBuf::from(root);
        assert!(root.starts_with(std::env::temp_dir()));
        assert!(root.join("fixture-marker").is_file());
        if root.join("undo-fixture").exists() {
            let canonical = root.canonicalize().unwrap();
            let target = canonical.join("note.md");
            fs::write(&target, PRIVATE_TEXT).unwrap();
            crate::ai::document_edit::apply(&canonical, &target, PRIVATE_TEXT, "changed").unwrap();
            let _ = record_document(
                &display_path(&root),
                "note.md",
                PermissionMode::Confirm,
                DocumentAction::UndoEdit,
                |root, relative| {
                    crate::ai::document_edit::undo_bound(
                        root,
                        &relative.to_string_lossy(),
                        None,
                        None,
                    )
                    .unwrap();
                    std::process::exit(50);
                },
            );
            panic!("undo fixture did not exit at the requested point");
        }
        let plan = plan(&root);
        let mut journal = Writer::begin(&plan, PermissionMode::Confirm, true).unwrap();
        journal.start(0).unwrap();
        let outcome = execute_one(&plan.root, &plan.actions[0]);
        assert!(outcome.is_ok());
        journal.outcome(0, &outcome, 1, &plan.root).unwrap();
        journal.start(1).unwrap();
        execute_one(&plan.root, &plan.actions[1]).unwrap();
        std::process::exit(49);
    }
    #[test]
    fn process_exit_after_direct_undo_keeps_real_bytes_and_an_unconfirmed_result() {
        let folder = tempfile::tempdir().unwrap();
        for marker in ["fixture-marker", "undo-fixture"] {
            fs::write(folder.path().join(marker), b"").unwrap();
        }
        let exit = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "ai::file_history::tests::crash_worker"])
            .env("DALIZI_TEST_JOURNAL_CHILD", folder.path())
            .output()
            .unwrap();
        assert_eq!(exit.status.code(), Some(50));
        let root = display_path(folder.path());
        let page = list(&root, None).unwrap();
        assert_eq!(page.total, 1);
        let record = read(&directory(&root).unwrap(), &page.rows[0].id).unwrap();
        assert_eq!(record.row.first_kind, "undo_edit");
        assert_eq!(record.row.status, "interrupted");
        assert_eq!(statuses(&record), ["unconfirmed"]);
        assert_eq!(
            fs::read_to_string(folder.path().join("note.md")).unwrap(),
            PRIVATE_TEXT
        );
    }

    #[test]
    fn two_saves_wait_for_the_short_creation_lock_and_never_replace_one_another() {
        use std::sync::{Arc, Barrier};
        let folder = tempfile::tempdir().unwrap();
        let root = display_path(folder.path());
        let dir = Directory::open(&validate_root(&root).unwrap(), true)
            .unwrap()
            .unwrap();
        let lock = OpenOptions::new()
            .write(true)
            .create_new(true)
            .share_mode(0)
            .custom_flags(FILE_FLAG_DELETE_ON_CLOSE.0)
            .open(dir.path.join(".local-create.lock"))
            .unwrap();
        let ready = Arc::new(Barrier::new(3));
        let handles: Vec<_> = ["one", "two"]
            .into_iter()
            .map(|body| {
                let (root, ready) = (root.clone(), ready.clone());
                std::thread::spawn(move || {
                    ready.wait();
                    let reply = tauri::async_runtime::block_on(crate::ai::ai_save_reply(
                        root,
                        "common.md".into(),
                        body.into(),
                        PermissionMode::Confirm,
                        Some(true),
                    ))
                    .unwrap();
                    let DocumentReply::Receipt(r) = reply else {
                        panic!("missing receipt")
                    };
                    (body, r.error)
                })
            })
            .collect();
        ready.wait();
        std::thread::sleep(std::time::Duration::from_millis(120));
        drop(lock);
        let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        assert_eq!(results.iter().filter(|(_, e)| e.is_none()).count(), 1);
        let winner = results.iter().find(|(_, e)| e.is_none()).unwrap().0;
        assert_eq!(
            fs::read_to_string(folder.path().join("common.md")).unwrap(),
            winner
        );
        let page = list(&root, None).unwrap();
        assert_eq!(page.total, 2);
        assert_eq!(page.rows.iter().filter(|r| r.status == "failed").count(), 1);
    }

    #[test]
    fn process_exit_after_effect_preserves_uncertainty_without_replaying() {
        let folder = tempfile::tempdir().unwrap();
        fs::write(folder.path().join("fixture-marker"), b"").unwrap();
        let exit = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "ai::file_history::tests::crash_worker"])
            .env("DALIZI_TEST_JOURNAL_CHILD", folder.path())
            .output()
            .unwrap();
        assert_eq!(exit.status.code(), Some(49));
        let root = display_path(folder.path());
        let page = list(&root, None).unwrap();
        assert_eq!(page.total, 1);
        let id = &page.rows[0].id;
        let dir = directory(&root).unwrap();
        let record = read(&dir, id).unwrap();
        assert_eq!(record.row.status, "interrupted");
        assert_eq!(statuses(&record), ["success", "unconfirmed", "notStarted"]);
        let mut file = OpenOptions::new()
            .append(true)
            .open(dir.file(id).unwrap())
            .unwrap();
        file.write_all(b"{\"event\":\"out").unwrap();
        drop(file);
        let torn = read(&dir, id).unwrap();
        assert!(torn.row.partial_tail);
        assert_eq!(statuses(&torn), statuses(&record));
        assert!(folder.path().join("目录").is_dir());
        assert!(!folder.path().join("last").exists());
    }

    #[test]
    fn live_record_refuses_removal_and_blocked_history_prevents_file_effects() {
        let folder = tempfile::tempdir().unwrap();
        let root = display_path(folder.path());
        let work = plan(folder.path());
        let mut journal = Writer::begin(&work, PermissionMode::Confirm, true).unwrap();
        journal.start(0).unwrap();
        let record = read(&directory(&root).unwrap(), &journal.id).unwrap();
        assert_eq!(record.row.status, "running");
        assert!(record.row.revision.is_empty());
        assert!(remove(&root, &journal.id, "").is_err());
        let alt = tempfile::tempdir().unwrap();
        fs::write(alt.path().join(".dalizi"), b"keep").unwrap();
        assert!(execute_plan(
            plan(alt.path()),
            PermissionMode::Confirm,
            true,
            &AtomicBool::new(false),
            |_, _| {}
        )
        .is_err());
        assert!(!alt.path().join("first.md").exists());
    }

    #[test]
    fn capacity_requires_review_and_paging_preserves_all_ids() {
        let folder = tempfile::tempdir().unwrap();
        let work = plan(folder.path());
        let root = display_path(folder.path());
        let dir = Directory::open(&work.root, true).unwrap().unwrap();
        for index in 0..CAPACITY {
            let id = format!("{index:020}-{}", uuid::Uuid::new_v4());
            fs::write(dir.file(&id).unwrap(), b"bad header\n").unwrap();
        }
        assert!(Writer::begin(&work, PermissionMode::Confirm, true).is_err());
        let mut cursor = None;
        let mut ids = Vec::new();
        loop {
            let page = list(&root, cursor.as_deref()).unwrap();
            assert_eq!(page.rows.len(), PAGE);
            assert_eq!(page.total, CAPACITY);
            ids.extend(page.rows.into_iter().map(|r| r.id));
            cursor = page.next;
            if cursor.is_none() {
                break;
            }
        }
        assert_eq!(ids.len(), CAPACITY);
        assert!(ids.windows(2).all(|w| w[0] > w[1]));
        let row = read(&dir, &ids[0]).unwrap().row;
        remove(&root, &row.id, &row.revision).unwrap();
        assert!(Writer::begin(&work, PermissionMode::Confirm, true).is_ok());
    }
}
