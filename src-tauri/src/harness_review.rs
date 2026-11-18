//! A model can suggest text. Only a fresh desktop review can authorize the host to write it.
use super::{io_err, local, save, Inner, Status, Task, TaskKind, Tasks};
use crate::ai::{document_edit, PermissionMode};
use dalizi_harness_client::snapshot::{identify, lock_workspace, Reference, Workspace};
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, State, Webview};
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Receipt {
    identity: String,
    version: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ModelEdit {
    target: String,
    replacement: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Proposal {
    token: String,
    target: String,
    original: String,
    replacement: String,
    #[serde(skip)]
    identity: String,
    #[serde(skip)]
    issued: Instant,
}
impl Proposal {
    pub(super) fn parse(source: Reference, answer: &str) -> Result<Self, String> {
        let edit: ModelEdit = serde_json::from_str(answer)
            .map_err(|_| "模型未返回约定的单文件 JSON 提案；未修改文件。")?;
        if edit.target != source.name {
            return Err("模型建议的目标与预览文件不一致；未修改文件。".into());
        }
        let replacement = document_edit::normalize_replacement(&source.text, &edit.replacement)?;
        Ok(Self {
            token: Uuid::new_v4().to_string(),
            target: source.name,
            original: source.text,
            replacement,
            identity: source.identity,
            issued: Instant::now(),
        })
    }
    pub(super) fn expired(&self) -> bool {
        self.issued.elapsed() > Duration::from_secs(600)
    }
    fn receipt(&self) -> Receipt {
        Receipt {
            identity: self.identity.clone(),
            version: format!(
                "{}-{}",
                document_edit::hash(self.original.as_bytes()),
                document_edit::hash(self.replacement.as_bytes())
            ),
        }
    }
}

pub(super) fn require_confirm(mode: Option<PermissionMode>) -> Result<(), String> {
    if mode != Some(PermissionMode::Confirm) {
        return Err("修改提案仅支持「确认后执行」，不支持只读或自动执行。".into());
    }
    Ok(())
}

fn spelling(s: &str) -> String {
    s.replace('/', "\\").trim_end_matches('\\').to_lowercase()
}
#[derive(Clone, Copy, Default)]
pub(super) struct Policy {
    mode: PermissionMode,
    epoch: u64,
}
pub(super) fn check_policy(inner: &Inner, owner: &Workspace) -> Result<u64, String> {
    let policy = inner
        .edit_policy
        .get(&spelling(&owner.path))
        .copied()
        .unwrap_or_default();
    if policy.mode != PermissionMode::Confirm {
        return Err("此目录的修改权限已关闭，请先切回「确认后执行」。".into());
    }
    Ok(policy.epoch)
}
fn scoped<'a>(inner: &'a Inner, id: &str, owner: &Workspace) -> Result<&'a Task, String> {
    check_policy(inner, owner)?;
    inner
        .tasks
        .iter()
        .find(|t| t.id == id && &t.workspace == owner && t.kind == TaskKind::Edit)
        .ok_or_else(|| "当前目录没有此修改任务".into())
}

pub(super) fn finish(
    app: &AppHandle,
    inner: &mut Inner,
    id: &str,
    status: Status,
    result: String,
) -> Result<(), String> {
    let task = inner
        .tasks
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or("找不到任务")?;
    task.publish_result(status, result);
    inner.save_error = true;
    save(inner.folder.as_deref().ok_or("缺少任务目录")?, &inner.tasks)?;
    inner.save_error = false;
    super::notify_results(app);
    Ok(())
}

// No filesystem effect is permitted until its intent has reached the durable ledger.
fn stage(app: &AppHandle, inner: &mut Inner, id: &str, status: Status) -> Result<(), String> {
    let index = inner
        .tasks
        .iter()
        .position(|t| t.id == id)
        .ok_or("找不到任务")?;
    let prior = (inner.tasks[index].status, inner.tasks[index].unread);
    inner.tasks[index].status = status;
    inner.tasks[index].unread = false;
    if let Err(e) = save(inner.folder.as_deref().ok_or("缺少任务目录")?, &inner.tasks) {
        inner.tasks[index].status = prior.0;
        inner.tasks[index].unread = prior.1;
        return Err(e);
    }
    super::notify_results(app);
    Ok(())
}

#[tauri::command]
pub fn harness_get_review(
    view: Webview,
    app: AppHandle,
    state: State<'_, Tasks>,
    id: String,
    root: String,
    permission_mode: PermissionMode,
) -> Result<Proposal, String> {
    local(&view)?;
    require_confirm(Some(permission_mode))?;
    let owner = identify(Path::new(&root)).map_err(io_err)?;
    let inner = state.open(&app)?;
    if scoped(&inner, &id, &owner)?.status != Status::AwaitingReview {
        return Err("此提案已失效或已处理".into());
    }
    inner
        .proposals
        .get(&id)
        .cloned()
        .ok_or_else(|| "此提案已失效".into())
}

#[tauri::command]
pub async fn harness_apply_review(
    view: Webview,
    app: AppHandle,
    id: String,
    root: String,
    token: String,
    permission_mode: PermissionMode,
) -> Result<(), String> {
    local(&view)?;
    require_confirm(Some(permission_mode))?;
    tauri::async_runtime::spawn_blocking(move || {
        let owner = identify(Path::new(&root)).map_err(io_err)?;
        let state = app.state::<Tasks>();
        let proposal = {
            let mut inner = state.open(&app)?;
            if scoped(&inner, &id, &owner)?.status != Status::AwaitingReview {
                return Err("提案已处理或失效，未重复执行。".into());
            }
            if !inner.proposals.get(&id).is_some_and(|p| p.token == token) {
                return Err("无效的审阅凭证".into());
            }
            stage(&app, &mut inner, &id, Status::Applying)?;
            inner.proposals.remove(&id).ok_or("缺少提案")?
        };
        let result = (|| {
            let _guards = lock_workspace(&owner).map_err(io_err)?;
            let root = Path::new(&owner.path);
            document_edit::apply_bound(
                root,
                &root.join(&proposal.target),
                &proposal.original,
                &proposal.replacement,
                Some((&proposal.identity, &id)),
            )
        })();
        let mut inner = state.open(&app)?;
        match result {
            Ok(()) => {
                let task = inner
                    .tasks
                    .iter_mut()
                    .find(|t| t.id == id)
                    .ok_or("找不到任务")?;
                task.receipt = Some(proposal.receipt());
                finish(
                    &app,
                    &mut inner,
                    &id,
                    Status::Applied,
                    "已写入审阅的版本，原文已备份。".into(),
                )
            }
            Err(e) => {
                finish(&app, &mut inner, &id, Status::NotApplied, e.clone())?;
                Err(e)
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn harness_undo_review(
    view: Webview,
    app: AppHandle,
    id: String,
    root: String,
    permission_mode: PermissionMode,
) -> Result<(), String> {
    local(&view)?;
    require_confirm(Some(permission_mode))?;
    tauri::async_runtime::spawn_blocking(move || {
        let owner = identify(Path::new(&root)).map_err(io_err)?;
        let state = app.state::<Tasks>();
        let (name, receipt) = {
            let mut inner = state.open(&app)?;
            let task = scoped(&inner, &id, &owner)?;
            if task.status != Status::Applied {
                return Err("此任务没有可撤销的写入".into());
            }
            let data = (
                task.files.first().ok_or("缺少目标")?.clone(),
                task.receipt.clone().ok_or("缺少写入凭据")?,
            );
            stage(&app, &mut inner, &id, Status::Undoing)?;
            data
        };
        let result = (|| {
            let _guards = lock_workspace(&owner).map_err(io_err)?;
            document_edit::undo_bound(
                Path::new(&owner.path),
                &name,
                Some(&receipt.version),
                Some((&receipt.identity, &id)),
            )
        })();
        let mut inner = state.open(&app)?;
        match result {
            Ok(()) => finish(
                &app,
                &mut inner,
                &id,
                Status::Undone,
                "已恢复此次修改前的原文。".into(),
            ),
            Err(e) => {
                finish(
                    &app,
                    &mut inner,
                    &id,
                    Status::Applied,
                    format!("撤销未完成：{e}"),
                )?;
                Err(e)
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn harness_set_edit_mode(
    view: Webview,
    app: AppHandle,
    state: State<'_, Tasks>,
    root: String,
    permission_mode: PermissionMode,
) -> Result<(), String> {
    local(&view)?;
    let mut inner = state.open(&app)?;
    let owner = identify(Path::new(&root)).ok();
    let key = spelling(owner.as_ref().map_or(root.as_str(), |o| o.path.as_str()));
    let policy = inner.edit_policy.entry(key).or_default();
    if policy.mode != permission_mode {
        policy.epoch = policy.epoch.wrapping_add(1);
        policy.mode = permission_mode;
    }
    if permission_mode == PermissionMode::Confirm {
        return Ok(());
    }
    let same = |workspace: &Workspace| {
        owner.as_ref() == Some(workspace) || spelling(&workspace.path) == spelling(&root)
    };
    inner
        .drafts
        .retain(|(_, d)| d.kind != TaskKind::Edit || !same(&d.snapshot.workspace));
    let ids: Vec<String> = inner
        .tasks
        .iter()
        .filter(|t| {
            t.kind == TaskKind::Edit
                && same(&t.workspace)
                && matches!(t.status, Status::Running | Status::AwaitingReview)
        })
        .map(|t| t.id.clone())
        .collect();
    let mut changed = false;
    for id in ids {
        if inner.proposals.remove(&id).is_some() {
            if let Some(row) = inner.tasks.iter_mut().find(|t| t.id == id) {
                row.publish_result(Status::Rejected, "项目权限已更改，旧提案已撤销。".into());
                changed = true;
            }
        }
        if let Some((_, slot)) = inner.active.as_mut().filter(|(key, _)| key == &id) {
            if let Some(sender) = slot.take() {
                let _ = sender.send(());
            }
        }
    }
    if changed {
        inner.save_error = true;
        save(inner.folder.as_deref().ok_or("缺少任务目录")?, &inner.tasks)?;
        inner.save_error = false;
        super::notify_results(&app);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn source() -> Reference {
        Reference {
            name: "notes.md".into(),
            text: "one\ntwo\n".into(),
            identity: "fixture".into(),
        }
    }
    #[test]
    fn only_the_reviewed_target_and_complete_text_can_be_proposed() {
        for invalid in [
            r#"{"target":"other.md","replacement":"edit"}"#,
            r#"{"target":"notes.md","replacement":"edit","command":"extra"}"#,
            r#"{"target":"notes.md","replacement":"one\ntwo\n"}"#,
            r#"{"target":"notes.md","replacement":"\u0000"}"#,
            "not JSON",
        ] {
            assert!(Proposal::parse(source(), invalid).is_err(), "{invalid}");
        }
        let p = Proposal::parse(
            source(),
            r#"{"target":"notes.md","replacement":"one\r\nthree\r\n"}"#,
        )
        .unwrap();
        assert_eq!(p.replacement, "one\nthree\n");
    }

    #[test]
    fn same_bytes_on_a_replacement_file_do_not_authorize_apply_or_undo() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let file = root.join("notes.md");
        std::fs::write(&file, "old").unwrap();
        let identity =
            dalizi_harness_client::snapshot::file_identity(&std::fs::File::open(&file).unwrap())
                .unwrap();
        std::fs::rename(&file, root.join("original")).unwrap();
        std::fs::write(&file, "old").unwrap();
        assert!(
            document_edit::apply_bound(root, &file, "old", "new", Some((&identity, "a"))).is_err()
        );
        assert_eq!(std::fs::read(&file).unwrap(), b"old");
        assert!(!root.join(".dalizi").exists());
        let current =
            dalizi_harness_client::snapshot::file_identity(&std::fs::File::open(&file).unwrap())
                .unwrap();
        document_edit::apply_bound(root, &file, "old", "new", Some((&current, "a"))).unwrap();
        assert!(document_edit::undo_bound(root, "notes.md", None, Some((&current, "b"))).is_err());
        std::fs::rename(&file, root.join("edited")).unwrap();
        std::fs::write(&file, "new").unwrap();
        assert!(document_edit::undo_bound(root, "notes.md", None, None).is_err());
        assert_eq!(std::fs::read(&file).unwrap(), b"new");
    }
}
