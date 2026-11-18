//! Review and remove one owner's local history. No project or network operations.
use super::*;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashSet;

#[derive(Serialize, Deserialize, PartialEq)]
struct Owner {
    workspace: Workspace,
    remote: bool,
}

impl Owner {
    fn resolve(root: Option<String>, remote_workspace: Option<Workspace>) -> Result<Self, String> {
        match (root, remote_workspace) {
            (Some(path), None) => Ok(Self {
                workspace: identify(Path::new(&path)).map_err(io_err)?,
                remote: false,
            }),
            (None, Some(workspace))
                if !workspace.identity.is_empty() && !workspace.path.is_empty() =>
            {
                Ok(Self {
                    workspace,
                    remote: true,
                })
            }
            _ => Err("清理记录必须指定一个目录，不能清理所有目录。".into()),
        }
    }
    fn matches(&self, workspace: &Workspace, remote: bool) -> bool {
        self.remote == remote && self.workspace == *workspace
    }
}

#[derive(Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CleanupPlan {
    owner: Owner,
    records: usize,
    previews: usize,
    legacy_rows: usize,
    retained: usize,
    undo_entries: usize,
    fingerprint: String,
}

struct Prepared {
    plan: CleanupPlan,
    // Scratch directories are keyed by task UUID across all index versions.
    scratch_ids: HashSet<String>,
    current_ids: HashSet<String>,
    drafts: HashSet<String>,
    archives: Vec<(String, Value)>,
    current: Value,
}

fn in_progress(status: Status) -> bool {
    matches!(
        status,
        Status::Running | Status::AwaitingReview | Status::Applying | Status::Undoing
    )
}

#[derive(Deserialize)]
struct ArchivedRow {
    id: String,
    workspace: Workspace,
    status: Status,
}

fn inspect(inner: &Inner, owner: Owner) -> Result<Prepared, String> {
    let folder = inner.folder.as_deref().ok_or("缺少任务目录")?;
    let mismatch = "本机任务索引已在应用外变化，未开始清理。请重开应用后核对。";
    let current = read_json(folder, &format!("tasks-v{LEDGER_VERSION}.json"))?.ok_or(mismatch)?;
    let disk = current["tasks"].as_array().ok_or(mismatch)?;
    if current["version"] != LEDGER_VERSION || disk.len() != inner.tasks.len() {
        return Err(mismatch.into());
    }
    for (raw, cached) in disk.iter().zip(&inner.tasks) {
        let saved = Task::deserialize(raw).map_err(|_| mismatch)?;
        if serde_json::to_value(saved).map_err(|_| mismatch)?
            != serde_json::to_value(cached).map_err(|_| mismatch)?
        {
            return Err(mismatch.into());
        }
    }
    let mut current_ids = HashSet::new();
    let mut keep = HashSet::new();
    let mut foreign = HashSet::new();
    let mut retained = 0;
    let mut undo_entries = 0;
    let mut hash = Sha256::new();
    let mut fingerprint = |v: Value| -> Result<(), String> {
        hash.update(serde_json::to_vec(&v).map_err(|e| e.to_string())?);
        Ok(())
    };
    for t in &inner.tasks {
        if !owner.matches(&t.workspace, t.remote_source.is_some()) {
            foreign.insert(t.id.clone());
        } else if in_progress(t.status) || inner.active.as_ref().is_some_and(|(id, _)| id == &t.id)
        {
            keep.insert(t.id.clone());
            retained += 1;
        } else {
            if !current_ids.insert(t.id.clone()) {
                return Err("任务编号重复，未开始清理。".into());
            }
            undo_entries += usize::from(t.status == Status::Applied);
            fingerprint(serde_json::json!([
                "task",
                &t.id,
                t.status,
                t.result_revision
            ]))?;
        }
    }
    let mut drafts = HashSet::new();
    for (_, d) in &inner.drafts {
        if owner.matches(&d.snapshot.workspace, d.remote_source.is_some()) {
            drafts.insert(d.id.clone());
            fingerprint(serde_json::json!(["preview", &d.id]))?;
        }
    }
    let mut scratch_ids = current_ids.clone();
    let mut archives = Vec::new();
    let mut legacy_rows = 0;
    // The newest index that knows an ID determines whether its older copies can be removed.
    for version in (1..LEDGER_VERSION).rev() {
        let name = format!("tasks-v{version}.json");
        let Some(mut ledger) = read_json(folder, &name)? else {
            continue;
        };
        if ledger["version"] != version {
            return Err("旧索引版本不符，未开始清理。".into());
        }
        let rows = ledger["tasks"]
            .as_array_mut()
            .ok_or("旧索引无法核对，未开始清理。")?;
        if rows.len() > LIMIT {
            return Err("旧索引记录数量超限，未开始清理。".into());
        }
        let mut remaining = Vec::with_capacity(rows.len());
        let original = rows.len();
        for raw in std::mem::take(rows) {
            let r = ArchivedRow::deserialize(&raw).map_err(|_| "旧索引无法核对，未开始清理。")?;
            if !owner.matches(&r.workspace, !raw["remoteSource"].is_null()) {
                foreign.insert(r.id);
            } else if keep.contains(&r.id)
                || (!scratch_ids.contains(&r.id) && in_progress(r.status))
            {
                keep.insert(r.id);
                retained += 1;
            } else {
                undo_entries +=
                    usize::from(r.status == Status::Applied && !scratch_ids.contains(&r.id));
                scratch_ids.insert(r.id);
                fingerprint(serde_json::json!([version, raw]))?;
                legacy_rows += 1;
                continue;
            }
            remaining.push(raw);
        }
        if remaining.len() != original {
            *rows = remaining;
            archives.push((name, ledger));
        }
    }
    if !scratch_ids.is_disjoint(&foreign)
        || !scratch_ids.is_disjoint(&keep)
        || scratch_ids.iter().any(|id| {
            Uuid::parse_str(id).map_or(true, |u| {
                !u.hyphenated().to_string().eq_ignore_ascii_case(id)
            })
        })
    {
        return Err("任务编号无法确认归属，未开始清理。".into());
    }
    Ok(Prepared {
        plan: CleanupPlan {
            owner,
            records: current_ids.len(),
            previews: drafts.len(),
            legacy_rows,
            retained,
            undo_entries,
            fingerprint: format!("{:x}", hash.finalize()),
        },
        current_ids,
        scratch_ids,
        drafts,
        archives,
        current,
    })
}

fn clear(inner: &mut Inner, owner: Owner, expected: CleanupPlan) -> Result<Vec<String>, String> {
    let mut prepared = inspect(inner, owner)?;
    if prepared.plan != expected {
        return Err("目录或清理清单已变化，请重新核对。".into());
    }
    let folder = inner.folder.as_deref().ok_or("缺少任务目录")?;
    // Leave current rows available for retry if scratch or an older index is locked.
    // Each index replacement is atomic; only a fully successful pass clears in-memory previews.
    let incomplete = |e: String| {
        format!("清理尚未完成：{e}。已清除的临时数据或旧索引不会恢复，请重新核对后再试。")
    };
    for id in &prepared.scratch_ids {
        cleanup_task_scratch(folder, id)
            .map_err(io_err)
            .map_err(incomplete)?
    }
    for (name, ledger) in &prepared.archives {
        atomic_json(folder, name, ledger).map_err(incomplete)?
    }
    if !prepared.current_ids.is_empty() {
        // Keep unrecognized fields in unrelated rows and in the index header.
        prepared.current["tasks"]
            .as_array_mut()
            .ok_or("任务索引无法读取")?
            .retain(|v| {
                !v["id"]
                    .as_str()
                    .is_some_and(|id| prepared.current_ids.contains(id))
            });
        atomic_json(
            folder,
            &format!("tasks-v{LEDGER_VERSION}.json"),
            &prepared.current,
        )
        .map_err(incomplete)?;
        inner
            .tasks
            .retain(|t| !prepared.current_ids.contains(&t.id));
    }
    let mut quotes = Vec::new();
    inner.drafts.retain(|(_, d)| {
        if !prepared.drafts.contains(&d.id) {
            return true;
        }
        if let Some(id) = &d.quote_id {
            quotes.push(id.clone())
        }
        false
    });
    Ok(quotes)
}

#[tauri::command]
pub async fn harness_plan_cleanup(
    view: Webview,
    app: AppHandle,
    root: Option<String>,
    remote_workspace: Option<Workspace>,
) -> Result<CleanupPlan, String> {
    local(&view)?;
    tauri::async_runtime::spawn_blocking(move || {
        let owner = Owner::resolve(root, remote_workspace)?;
        let state = app.state::<Tasks>();
        let inner = state.open(&app)?;
        Ok(inspect(&inner, owner)?.plan)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn harness_clear_workspace(
    view: Webview,
    app: AppHandle,
    root: Option<String>,
    remote_workspace: Option<Workspace>,
    expected: CleanupPlan,
) -> Result<(), String> {
    local(&view)?;
    tauri::async_runtime::spawn_blocking(move || {
        let owner = Owner::resolve(root, remote_workspace)?;
        let state = app.state::<Tasks>();
        let mut inner = state.open(&app)?;
        let quotes = clear(&mut inner, owner, expected)?;
        // Retargeting takes this same task lock. Release only browser captures that
        // still belonged to the reviewed drafts, before a new binding can be made.
        let browser = app.state::<BrowserState>();
        for quote in quotes {
            browser.4.discard(&quote);
        }
        drop(inner);
        notify_results(&app);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn owner(name: &str) -> Owner {
        Owner {
            workspace: Workspace {
                path: name.into(),
                identity: name.into(),
            },
            remote: false,
        }
    }
    fn row(n: u128, name: &str, status: Status) -> Task {
        serde_json::from_value(serde_json::json!({"id":Uuid::from_u128(n).to_string(),
            "workspace":{"path":name,"identity":name},"files":["same.md"],"question":"fixture",
            "endpoint":"loopback","model":"fixture","created":1,"status":status,"result":"fixture"})).unwrap()
    }
    fn archive(dir: &Path, v: u32, rows: &[&Task]) {
        atomic_json(
            dir,
            &format!("tasks-v{v}.json"),
            &serde_json::json!({"version":v,"tasks":rows}),
        )
        .unwrap();
    }
    #[test]
    fn full_index_releases_only_finished_owned_slots_and_scratch_across_versions() {
        let dir = tempfile::tempdir().unwrap();
        let done = row(1, "A", Status::Applied);
        let awaiting = row(2, "A", Status::AwaitingReview);
        let other = row(3, "B", Status::Succeeded);
        let old = row(4, "A", Status::Succeeded);
        let stale_copy = row(1, "A", Status::Running);
        let older_running = row(4, "A", Status::Running);
        let pending_old = row(5, "A", Status::Running);
        let obsolete = row(5, "A", Status::Succeeded);
        let mut rows = vec![done.clone(), awaiting.clone(), other.clone()];
        for i in 0..LIMIT - 3 {
            rows.push(row(100 + i as u128, "B", Status::Succeeded))
        }
        save(dir.path(), &rows).unwrap();
        archive(
            dir.path(),
            2,
            &[&done, &old, &other, &awaiting, &pending_old],
        );
        archive(dir.path(), 1, &[&stale_copy, &older_running, &obsolete]);
        for t in [&done, &other, &old, &awaiting, &pending_old] {
            fs::create_dir(dir.path().join(format!("turn-{}", t.id))).unwrap()
        }
        let mut inner = Inner {
            folder: Some(dir.path().into()),
            tasks: rows,
            ..Default::default()
        };
        let plan = inspect(&inner, owner("A")).unwrap().plan;
        assert_eq!(
            (plan.records, plan.legacy_rows, plan.undo_entries),
            (1, 4, 1)
        );
        clear(&mut inner, owner("A"), plan).unwrap();
        let (persisted, _) = load_rows(dir.path()).unwrap();
        assert_eq!(persisted.len(), LIMIT - 1);
        assert!(persisted.iter().any(|t| t.id == awaiting.id));
        for t in [&awaiting, &other, &pending_old] {
            assert!(dir.path().join(format!("turn-{}", t.id)).is_dir())
        }
        for t in [&done, &old] {
            assert!(!dir.path().join(format!("turn-{}", t.id)).exists())
        }
        let v2 = read_json(dir.path(), "tasks-v2.json").unwrap().unwrap();
        assert_eq!(
            v2["tasks"],
            serde_json::json!([other, awaiting, pending_old])
        );
        let v1 = read_json(dir.path(), "tasks-v1.json").unwrap().unwrap();
        assert_eq!(v1["tasks"], serde_json::json!([obsolete]));
    }
    #[test]
    fn refuse_before_deleting_if_an_archive_conflicts_or_a_folder_is_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("A");
        fs::create_dir(&project).unwrap();
        let resolve = || Owner::resolve(Some(project.to_str().unwrap().to_owned()), None).unwrap();
        let mut task = row(7, "A", Status::Succeeded);
        task.workspace = resolve().workspace;
        save(dir.path(), std::slice::from_ref(&task)).unwrap();
        let scratch = dir.path().join(format!("turn-{}", task.id));
        fs::create_dir(&scratch).unwrap();
        let mut inner = Inner {
            folder: Some(dir.path().into()),
            tasks: vec![task.clone()],
            ..Default::default()
        };
        let expected = inspect(&inner, resolve()).unwrap().plan;
        let conflicting = row(7, "B", Status::Succeeded);
        archive(dir.path(), 2, &[&conflicting]);
        assert!(clear(&mut inner, resolve(), expected).is_err());
        assert!(scratch.is_dir());
        assert_eq!(load_rows(dir.path()).unwrap().0.len(), 1);
        archive(dir.path(), 2, &[&task]);
        let expected = inspect(&inner, resolve()).unwrap().plan;
        fs::rename(&project, dir.path().join("moved")).unwrap();
        fs::create_dir(&project).unwrap();
        assert!(clear(&mut inner, resolve(), expected).is_err());
        let expected = inspect(&inner, resolve()).unwrap().plan;
        assert_eq!(expected.records, 0);
        assert!(scratch.is_dir());
        assert_eq!(inner.tasks.len(), 1);
    }

    #[test]
    fn locked_current_index_keeps_rows_retryable_and_preserves_unknown_fields() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = tempfile::tempdir().unwrap();
        let a = row(1, "A", Status::Succeeded);
        let b = row(2, "B", Status::Succeeded);
        let mut data = serde_json::json!({"version":4,"extra":"header","tasks":[a,b]});
        data["tasks"][1]["futureMetadata"] = serde_json::json!({"keep":true});
        atomic_json(dir.path(), "tasks-v4.json", &data).unwrap();
        archive(dir.path(), 1, &[&a, &b]);
        let mut inner = Inner {
            folder: Some(dir.path().into()),
            tasks: vec![a, b],
            ..Default::default()
        };
        let expected = inspect(&inner, owner("A")).unwrap().plan;
        let held = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(dir.path().join("tasks-v4.json"))
            .unwrap();
        assert!(clear(&mut inner, owner("A"), expected)
            .unwrap_err()
            .contains("清理尚未完成"));
        drop(held);
        assert_eq!(inner.tasks.len(), 2);
        assert_eq!(
            read_json(dir.path(), "tasks-v4.json").unwrap().unwrap(),
            data
        );
        let next = inspect(&inner, owner("A")).unwrap().plan;
        assert_eq!((next.records, next.legacy_rows), (1, 0));
        clear(&mut inner, owner("A"), next).unwrap();
        data["tasks"].as_array_mut().unwrap().remove(0);
        assert_eq!(
            read_json(dir.path(), "tasks-v4.json").unwrap().unwrap(),
            data
        );
    }
    #[test]
    fn external_index_update_between_review_and_confirm_leaves_every_workspace_intact() {
        let dir = tempfile::tempdir().unwrap();
        let a = row(1, "A", Status::Succeeded);
        let b = row(2, "B", Status::Succeeded);
        save(dir.path(), std::slice::from_ref(&a)).unwrap();
        archive(dir.path(), 1, &[&a]);
        let mut inner = Inner {
            folder: Some(dir.path().into()),
            tasks: vec![a.clone()],
            ..Default::default()
        };
        let expected = inspect(&inner, owner("A")).unwrap().plan;
        save(dir.path(), &[a, b]).unwrap();
        assert!(clear(&mut inner, owner("A"), expected)
            .unwrap_err()
            .contains("应用外变化"));
        assert_eq!(load_rows(dir.path()).unwrap().0.len(), 2);
        assert_eq!(
            read_json(dir.path(), "tasks-v1.json").unwrap().unwrap()["tasks"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }
}
