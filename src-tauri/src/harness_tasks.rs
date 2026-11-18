//! Desktop owner of reviewed file snapshots and durable, directory-bound task results.
use super::{credential_target, endpoint_for_format, ApiFormat, PermissionMode};
use crate::browser::{
    reference::{Origin, Quote},
    BrowserState,
};
use crate::ssh_managed::files::tasks as remote;
#[path = "harness_engine.rs"]
pub mod engine;
#[path = "harness_review.rs"]
pub mod review;
#[path = "harness_history.rs"]
pub mod history;
use dalizi_harness_client::{
    runtime::{cleanup_task_scratch, execute, Outcome, Turn},
    snapshot::{capture, identify, Snapshot, Workspace},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State, Webview};
use tokio::sync::oneshot;
use uuid::Uuid;
use zeroize::Zeroizing;

const LIMIT: usize = 64;
const PREVIEW_LIMIT: usize = 8;
const PREVIEW_TTL: Duration = Duration::from_secs(300);
const MAX_ANSWER: usize = 65536;
const LEDGER_VERSION: u32 = 4;
#[derive(Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskKind {
    #[default]
    Question,
    Edit,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    id: String,
    workspace: Workspace,
    files: Vec<String>,
    question: String,
    endpoint: String,
    model: String,
    created: u64,
    status: Status,
    result: String,
    #[serde(default)]
    unread: bool,
    #[serde(default)]
    result_revision: u64,
    #[serde(default)]
    kind: TaskKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    receipt: Option<review::Receipt>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    web_source: Option<Origin>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    remote_source: Option<remote::Source>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    snapshot_offline: Option<bool>,
}
impl Task {
    fn publish_result(&mut self, status: Status, result: String) {
        self.status = status;
        self.result = result;
        self.result_revision = self.result_revision.saturating_add(1);
        self.unread = true;
    }
}

fn notify_results(app: &AppHandle) {
    // Only the trusted main view needs to re-read its own scope; no task payload is broadcast.
    let _ = app.emit_to(
        tauri::EventTarget::webview("main"),
        "harness-results-changed",
        (),
    );
}
#[derive(Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum Status {
    Running,
    Succeeded,
    Failed,
    Cancelled,
    Interrupted,
    AwaitingReview,
    Applying,
    Applied,
    Rejected,
    NotApplied,
    Undoing,
    Undone,
}
#[derive(Serialize, Deserialize)]
struct Ledger {
    version: u32,
    tasks: Vec<Task>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    id: String,
    snapshot: Snapshot,
    endpoint: String,
    model: String,
    kind: TaskKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    web: Option<Quote>,
    #[serde(skip)]
    quote_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    remote_source: Option<remote::Source>,
    #[serde(skip)]
    remote_grant: Option<remote::Grant>,
}
#[derive(Default)]
struct Inner {
    folder: Option<PathBuf>,
    tasks: Vec<Task>,
    drafts: Vec<(Instant, Draft)>,
    active: Option<(String, Option<oneshot::Sender<()>>)>,
    save_error: bool,
    proposals: HashMap<String, review::Proposal>,
    edit_policy: HashMap<String, review::Policy>,
}
#[derive(Default)]
pub struct Tasks(Mutex<Inner>);

impl Inner {
    fn remember_preview(&mut self, draft: Draft) -> Result<Draft, String> {
        // One captured web quote can be retargeted, but must have only one live destination.
        self.drafts.retain(|(when, old)| {
            when.elapsed() < PREVIEW_TTL
                && !(draft.quote_id.is_some() && old.quote_id == draft.quote_id)
        });
        if self.drafts.len() >= PREVIEW_LIMIT {
            return Err("待提交的预览已满，请先关闭不再使用的预览。".into());
        }
        self.drafts.push((Instant::now(), draft.clone()));
        Ok(draft)
    }

    fn discard_preview(&mut self, id: &str) {
        self.drafts.retain(|(_, d)| d.id != id);
    }
}

pub(crate) fn local(view: &Webview) -> Result<(), String> {
    let url = view.url().map_err(|_| "无法核实窗口来源")?;
    if view.label() != "main"
        || url.host_str() != Some("tauri.localhost")
        || !matches!(url.scheme(), "http" | "https")
    {
        return Err("仅允许本地主窗口操作文件任务".into());
    }
    Ok(())
}
fn io_err(e: std::io::Error) -> String {
    e.to_string()
}
fn recheck_engine(app: &AppHandle, before: u64) -> Result<(), String> {
    if engine::revision(app)? != before {
        return Err("引擎开关已变化，请重新预览。".into());
    }
    Ok(())
}
fn save(dir: &Path, tasks: &[Task]) -> Result<(), String> {
    atomic_json(
        dir,
        &format!("tasks-v{LEDGER_VERSION}.json"),
        &serde_json::json!({"version":LEDGER_VERSION,"tasks":tasks}),
    )
}

fn atomic_json(dir: &Path, name: &str, data: &serde_json::Value) -> Result<(), String> {
    use std::io::Write;
    let mut tmp = tempfile::NamedTempFile::new_in(dir).map_err(io_err)?;
    serde_json::to_writer(tmp.as_file_mut(), data).map_err(|e| e.to_string())?;
    tmp.flush()
        .and_then(|_| tmp.as_file().sync_all())
        .map_err(io_err)?;
    tmp.persist(dir.join(name)).map_err(|e| e.to_string())?;
    Ok(())
}
fn read_json(dir: &Path, name: &str) -> Result<Option<serde_json::Value>, String> {
    let file = match fs::File::open(dir.join(name)) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(io_err(e)),
    };
    if file.metadata().map_err(io_err)?.len() > 32 * 1024 * 1024 {
        return Err("任务记录超限，原文件已保留".into());
    }
    serde_json::from_reader(file)
        .map(Some)
        .map_err(|_| "任务记录无法读取，原文件已保留".into())
}

fn load_rows(dir: &Path) -> Result<(Vec<Task>, bool), String> {
    for version in (1..=LEDGER_VERSION).rev() {
        if let Some(data) = read_json(dir, &format!("tasks-v{version}.json"))? {
            let ledger: Ledger =
                serde_json::from_value(data).map_err(|_| "任务记录不兼容，原文件已保留")?;
            if ledger.version != version || ledger.tasks.len() > LIMIT {
                return Err("任务记录版本或大小不兼容".into());
            }
            return Ok((ledger.tasks, version < LEDGER_VERSION));
        }
    }
    Ok((vec![], true))
}

// Preserve the old format for rollback, but don't retain a deleted question in its legacy copy.
fn forget_legacy(dir: &Path, id: &str) -> Result<(), String> {
    for version in 1..LEDGER_VERSION {
        let name = format!("tasks-v{version}.json");
        let Some(mut ledger) = read_json(dir, &name)? else {
            continue;
        };
        if ledger["version"] != version {
            return Err("旧任务记录版本不兼容，无法确认移除".into());
        }
        let rows = ledger["tasks"]
            .as_array_mut()
            .ok_or("旧任务记录格式不兼容")?;
        let count = rows.len();
        rows.retain(|row| row["id"] != id);
        if rows.len() != count {
            atomic_json(dir, &name, &ledger)?;
        }
    }
    Ok(())
}
impl Tasks {
    fn open(&self, app: &AppHandle) -> Result<MutexGuard<'_, Inner>, String> {
        let mut inner = self.0.lock().map_err(|_| "任务记录不可用")?;
        if inner.folder.is_none() {
            let folder = app
                .path()
                .app_local_data_dir()
                .map_err(|e| e.to_string())?
                .join("HarnessTasks");
            fs::create_dir_all(&folder).map_err(io_err)?;
            let (mut rows, mut changed) = load_rows(&folder)?;
            for task in &mut rows {
                if matches!(
                    task.status,
                    Status::Running | Status::AwaitingReview | Status::Applying | Status::Undoing
                ) {
                    let reason = match task.status {
                        Status::AwaitingReview => "应用已退出，旧提案已失效，未写入文件。",
                        Status::Applying | Status::Undoing => "应用在文件操作期间退出。请核对目标文件和 .dalizi/edits 中的原文备份；不会重放操作。",
                        _ => "应用上次退出前未确认结果，未重发请求。",
                    };
                    task.publish_result(Status::Interrupted, reason.into());
                    changed = true;
                }
                if task.status == Status::Interrupted {
                    // The Windows job is closed with the previous host. If a file is still
                    // locked, deleting the record will retry cleanup and surface any failure.
                    let _ = cleanup_task_scratch(&folder, &task.id);
                }
            }
            if changed {
                save(&folder, &rows)?;
            }
            inner.folder = Some(folder);
            inner.tasks = rows;
        }
        let expired: Vec<_> = inner
            .proposals
            .iter()
            .filter(|(_, p)| p.expired())
            .map(|(id, _)| id.clone())
            .collect();
        for id in expired {
            inner.proposals.remove(&id);
            review::finish(
                app,
                &mut inner,
                &id,
                Status::Rejected,
                "审阅已过期，原文件未修改。".into(),
            )?;
        }
        if inner.save_error {
            save(inner.folder.as_deref().ok_or("缺少任务目录")?, &inner.tasks)?;
            inner.save_error = false;
        }
        Ok(inner)
    }
}

fn route(endpoint: &str, format: ApiFormat) -> Result<url::Url, String> {
    if format != ApiFormat::Messages {
        return Err("文件任务需要 Messages 接口；请在模型设置中显式选择。".into());
    }
    let url = endpoint_for_format(endpoint, format)?;
    let official = url.as_str() == "https://api.deepseek.com/anthropic/v1/messages";
    let loopback = url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port().is_some()
        && url.path() == "/v1/messages";
    if !official && !loopback {
        return Err("此开发版本支持 DeepSeek 官方 Messages 地址或本机 127.0.0.1:端口/v1/messages。不会改用其他接口。".into());
    }
    Ok(url)
}

fn model_name(value: &str) -> Result<&str, String> {
    let model = value.trim();
    if model.is_empty() || model.len() > 128 || model.chars().any(char::is_control) {
        return Err("请配置有效的模型名称".into());
    }
    Ok(model)
}

#[tauri::command]
pub fn harness_quote_preview(
    view: Webview,
    browser: State<'_, BrowserState>,
    id: String,
) -> Result<Quote, String> {
    local(&view)?;
    browser.4.get(&id)
}
#[tauri::command]
pub fn harness_quote_discard(
    view: Webview,
    app: AppHandle,
    state: State<'_, Tasks>,
    browser: State<'_, BrowserState>,
    id: String,
) -> Result<(), String> {
    local(&view)?;
    let mut inner = state.open(&app)?;
    browser.4.discard(&id);
    inner
        .drafts
        .retain(|(_, d)| d.quote_id.as_ref() != Some(&id));
    Ok(())
}
#[tauri::command]
pub async fn harness_prepare_web(
    view: Webview,
    app: AppHandle,
    state: State<'_, Tasks>,
    browser: State<'_, BrowserState>,
    id: String,
    root: String,
    endpoint: String,
    api_format: ApiFormat,
    model: String,
) -> Result<Draft, String> {
    local(&view)?;
    let generation = engine::revision(&app)?;
    let endpoint = route(&endpoint, api_format)?.to_string();
    let model = model_name(&model)?.to_owned();
    let workspace = tauri::async_runtime::spawn_blocking(move || identify(Path::new(&root)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(io_err)?;
    let mut inner = state.open(&app)?;
    recheck_engine(&app, generation)?;
    let web = Some(browser.4.get(&id)?);
    let draft = Draft {
        id: Uuid::new_v4().to_string(),
        snapshot: Snapshot {
            workspace,
            files: Vec::new(),
        },
        endpoint,
        model,
        kind: TaskKind::Question,
        web,
        quote_id: Some(id),
        remote_source: None,
        remote_grant: None,
    };
    inner.remember_preview(draft)
}

#[tauri::command]
pub async fn harness_prepare(
    view: Webview,
    app: AppHandle,
    state: State<'_, Tasks>,
    root: String,
    source_root: String,
    files: Vec<String>,
    endpoint: String,
    api_format: ApiFormat,
    model: String,
    kind: Option<TaskKind>,
    permission_mode: Option<PermissionMode>,
) -> Result<Draft, String> {
    local(&view)?;
    let generation = engine::revision(&app)?;
    let url = route(&endpoint, api_format)?;
    let kind = kind.unwrap_or_default();
    if kind == TaskKind::Edit {
        review::require_confirm(permission_mode)?;
        if files.len() != 1 {
            return Err("修改提案一次只接受一个已选文件".into());
        }
    }
    let model = model_name(&model)?;
    let prepare_app = app.clone();
    let (snapshot, epoch) = tauri::async_runtime::spawn_blocking(move || {
        if files.iter().any(|s| s.contains(['/', '\\'])) {
            return Err("只接受当前文件面板中的选择".to_string());
        }
        let source = identify(Path::new(&source_root)).map_err(io_err)?;
        if identify(Path::new(&root)).map_err(io_err)? != source {
            return Err("当前文件选择不属于此任务目录".into());
        }
        let epoch = if kind == TaskKind::Edit {
            let state = prepare_app.state::<Tasks>();
            let inner = state.open(&prepare_app)?;
            Some(review::check_policy(&inner, &source)?)
        } else {
            None
        };
        let snapshot = capture(Path::new(&root), &files).map_err(io_err)?;
        if snapshot.workspace != source {
            return Err("当前文件选择不属于此任务目录".into());
        }
        Ok((snapshot, epoch))
    })
    .await
    .map_err(|e| e.to_string())??;
    let draft = Draft {
        id: Uuid::new_v4().to_string(),
        snapshot,
        endpoint: url.to_string(),
        model: model.to_owned(),
        kind,
        web: None,
        quote_id: None,
        remote_source: None,
        remote_grant: None,
    };
    let mut inner = state.open(&app)?;
    recheck_engine(&app, generation)?;
    if let Some(epoch) = epoch {
        if review::check_policy(&inner, &draft.snapshot.workspace)? != epoch {
            return Err("权限已改变，请重新预览".into());
        }
    }
    inner.remember_preview(draft)
}

#[tauri::command]
pub async fn harness_prepare_remote(
    view: Webview,
    app: AppHandle,
    state: State<'_, Tasks>,
    session_id: u32,
    token: String,
    files: Vec<String>,
    endpoint: String,
    api_format: ApiFormat,
    model: String,
) -> Result<Draft, String> {
    local(&view)?;
    let generation = engine::revision(&app)?;
    let endpoint = route(&endpoint, api_format)?.to_string();
    let model = model_name(&model)?.to_owned();
    let (grant, source, snapshot) = remote::capture(session_id, token, files).await?;
    let mut inner = state.open(&app)?;
    recheck_engine(&app, generation)?;
    grant.check()?;
    let draft = Draft {
        id: Uuid::new_v4().to_string(),
        snapshot,
        endpoint,
        model,
        kind: TaskKind::Question,
        web: None,
        quote_id: None,
        remote_source: Some(source),
        remote_grant: Some(grant),
    };
    inner.remember_preview(draft)
}
#[tauri::command]
pub fn harness_discard_preview(
    view: Webview,
    app: AppHandle,
    state: State<'_, Tasks>,
    id: String,
) -> Result<(), String> {
    local(&view)?;
    let mut inner = state.open(&app)?;
    inner.discard_preview(&id);
    Ok(())
}
#[tauri::command]
pub fn harness_submit(
    view: Webview,
    app: AppHandle,
    state: State<'_, Tasks>,
    id: String,
    question: String,
    api_key: String,
) -> Result<Task, String> {
    local(&view)?;
    let mut inner = state.open(&app)?;
    if let Some(task) = inner.tasks.iter().find(|t| t.id == id) {
        // The preview ID fixes the source, destination and model. Only the question
        // is supplied again on replay; credentials are never part of the receipt.
        if task.question != question {
            return Err("这份预览已经提交过其他问题。请重新预览后再发送。".into());
        }
        return Ok(task.clone());
    }
    if inner.active.is_some() {
        return Err("另一个文件任务正在运行，请等待或先停止。".into());
    }
    let (when, draft) = inner
        .drafts
        .iter()
        .find(|(_, d)| d.id == id)
        .ok_or("预览已失效，请重新选择")?;
    if when.elapsed() >= PREVIEW_TTL {
        inner.discard_preview(&id);
        return Err("预览已过期，请重新选择".into());
    }
    if let Some(quoted) = &draft.quote_id {
        if !app.state::<BrowserState>().4.is_live(quoted) {
            inner.discard_preview(&id);
            return Err("引用已过期或已关闭，请重新选择。".into());
        }
    }
    if question.trim().is_empty() || question.chars().count() > 4000 {
        return Err("请输入 1–4000 字的问题".into());
    }
    if inner.tasks.len() >= LIMIT {
        return Err("任务记录已满，请移除不再需要的记录".into());
    }
    if let Some(grant) = &draft.remote_grant {
        grant.check()?;
    } else if identify(Path::new(&draft.snapshot.workspace.path)).map_err(io_err)?
        != draft.snapshot.workspace
    {
        return Err("目录身份已改变，请重新预览".into());
    }
    let generation = engine::revision(&app)?;
    let rt = engine::acquire(&app)?;
    let url = route(&draft.endpoint, ApiFormat::Messages)?;
    let base = url
        .as_str()
        .strip_suffix("/v1/messages")
        .ok_or("模型地址不匹配")?
        .to_owned();
    let mut key = Zeroizing::new(api_key);
    if key.is_empty() {
        if let Some(stored) = crate::ssh_credentials::read(&credential_target(&url))? {
            key.push_str(std::str::from_utf8(&stored).map_err(|_| "无效的模型密钥")?);
        }
    }
    if key.is_empty() && url.scheme() == "http" {
        key.push_str("local-test-only");
    }
    if key.is_empty() || key.len() > 2560 || key.chars().any(char::is_control) {
        return Err("模型密钥缺失或无效".into());
    }
    let mut request =
        serde_json::json!({"question":question,"selectedFileSnapshots":draft.snapshot.files});
    if let Some(web) = &draft.web {
        request = serde_json::json!({"question":question,"selectedWebQuote":web});
    }
    if let Some(source) = &draft.remote_source {
        // The verified host, account and fingerprint are shown and stored locally, but are not model input.
        request = serde_json::json!({"question":question,"selectedRemoteSnapshots":{"directory":source.directory,"capturedAt":source.captured_at,"files":draft.snapshot.files}});
    }
    let quote_id = draft.quote_id.clone();
    let edit_source = if draft.kind == TaskKind::Edit {
        request["outputContract"] = serde_json::json!({"instruction":"Return ONLY a JSON object containing target (exact selected filename) and replacement (complete revised file text). Do not use Markdown fences, extra fields or tools. The host will show a diff and only the user can approve a write."});
        Some(draft.snapshot.files.first().ok_or("缺少审阅文件")?.clone())
    } else {
        None
    };
    let prompt = serde_json::to_string(&request).map_err(|e| e.to_string())?;
    let task = Task {
        id: id.clone(),
        workspace: draft.snapshot.workspace.clone(),
        files: draft
            .snapshot
            .files
            .iter()
            .map(|f| f.name.clone())
            .collect(),
        question,
        endpoint: draft.endpoint.clone(),
        model: draft.model.clone(),
        created: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
        status: Status::Running,
        result: String::new(),
        unread: false,
        result_revision: 0,
        kind: draft.kind,
        receipt: None,
        web_source: draft.web.as_ref().map(|q| q.source.clone()),
        remote_source: draft.remote_source.clone(),
        snapshot_offline: None,
    };
    let scratch = inner.folder.clone().ok_or("缺少任务目录")?;
    inner.tasks.push(task.clone());
    if let Err(error) = save(&scratch, &inner.tasks) {
        inner.tasks.pop();
        return Err(error);
    }
    let (tx, rx) = oneshot::channel();
    inner.active = Some((id.clone(), Some(tx)));
    inner.discard_preview(&id);
    if let Some(quoted) = quote_id {
        app.state::<BrowserState>().4.discard(&quoted);
    }
    let model = task.model.clone();
    drop(inner);
    tauri::async_runtime::spawn(async move {
        let start = Instant::now();
        let probe = app.clone();
        let outcome = execute(
            move |scratch| {
                let t = Instant::now();
                let r = rt.provision(scratch);
                engine::record(
                    &probe,
                    "prepare-runtime",
                    if r.is_ok() { "ok" } else { "failed" },
                    t,
                );
                r
            },
            &scratch,
            Turn {
                id: &id,
                model: &model,
                base_url: &base,
                key: &key,
                prompt: &prompt,
            },
            rx,
        )
        .await;
        if let Err(error) = &outcome {
            if let Some(failure) = error
                .get_ref()
                .and_then(|e| e.downcast_ref::<dalizi_harness_client::ModelFailure>())
            {
                engine::record(&app, "model", failure.diagnostic_code(), start);
            }
        }
        engine::record(
            &app,
            "task",
            match &outcome {
                Ok(Outcome::Answer(_)) => "answered",
                Ok(Outcome::Cancelled) => "cancelled",
                Err(_) => "failed",
            },
            start,
        );
        let mut proposal = None;
        let (status, result) = match (outcome, edit_source) {
            (Ok(Outcome::Answer(text)), Some(source)) if text.len() <= MAX_ANSWER => {
                match review::Proposal::parse(source, &text) {
                    Ok(p) => {
                        proposal = Some(p);
                        (
                            Status::AwaitingReview,
                            "建议稿已生成，原文件未修改。".into(),
                        )
                    }
                    Err(e) => (Status::Failed, e),
                }
            }
            (Ok(Outcome::Answer(text)), None) if text.len() <= MAX_ANSWER => {
                (Status::Succeeded, text)
            }
            (Ok(Outcome::Answer(_)), _) => (
                Status::Failed,
                "模型回复超过 64 KiB，未保存；可缩小问题范围。".into(),
            ),
            (Ok(Outcome::Cancelled), _) => (
                Status::Cancelled,
                "已停止本机运行时；已发出的模型请求可能仍计费。".into(),
            ),
            (Err(e), _) => (Status::Failed, format!("文件任务未完成：{e}；未自动重试。")),
        };
        let state = app.state::<Tasks>();
        let Ok(mut inner) = state.0.lock() else {
            return;
        };
        let stopped = matches!(&inner.active, Some((key,None)) if key == &id);
        let (status, result) = if stopped {
            (
                Status::Cancelled,
                "任务已停止；已发出的模型请求可能仍计费。".into(),
            )
        } else if proposal.is_some() && recheck_engine(&app, generation).is_err() {
            (
                Status::Rejected,
                "引擎已停用或切换，未批准的提案已失效。".into(),
            )
        } else {
            if let Some(p) = proposal {
                inner.proposals.insert(id.clone(), p);
            }
            (status, result)
        };
        if let Some(row) = inner.tasks.iter_mut().find(|r| r.id == id) {
            row.publish_result(status, result);
        }
        inner.active = None;
        inner.save_error = save(&scratch, &inner.tasks).is_err();
        drop(inner);
        notify_results(&app);
    });
    Ok(task)
}

enum TaskScope {
    All,
    Local(Workspace),
    Remote(String),
}
impl TaskScope {
    fn resolve(root: Option<String>, remote: Option<String>) -> Result<Self, String> {
        match (root, remote) {
            (Some(path), None) => identify(Path::new(&path)).map(Self::Local).map_err(io_err),
            (None, Some(id)) => Ok(Self::Remote(id)),
            (None, None) => Ok(Self::All),
            _ => Err("请选择一个任务目标。".into()),
        }
    }
    fn matches(&self, t: &Task) -> bool {
        match self {
            Self::All => true,
            Self::Local(w) => t.remote_source.is_none() && w == &t.workspace,
            Self::Remote(id) => t.remote_source.is_some() && id == &t.workspace.identity,
        }
    }
}
#[tauri::command]
pub fn harness_list(
    view: Webview,
    app: AppHandle,
    state: State<'_, Tasks>,
    root: Option<String>,
    remote_workspace: Option<String>,
) -> Result<Vec<Task>, String> {
    local(&view)?;
    let scope = TaskScope::resolve(root, remote_workspace)?;
    Ok(state
        .open(&app)?
        .tasks
        .iter()
        .rev()
        .filter(|t| scope.matches(t))
        .cloned()
        .map(|mut t| {
            t.snapshot_offline = t.remote_source.as_ref().map(|s| !s.connected());
            t
        })
        .collect())
}

#[tauri::command]
pub async fn harness_unread_count(
    view: Webview,
    app: AppHandle,
    root: Option<String>,
    remote_workspace: Option<String>,
) -> Result<usize, String> {
    local(&view)?;
    tauri::async_runtime::spawn_blocking(move || {
        let scope = TaskScope::resolve(root, remote_workspace)?;
        if matches!(scope, TaskScope::All) {
            return Err("请先选择任务目录。".into());
        }
        let state = app.state::<Tasks>();
        let inner = state.open(&app)?;
        Ok(inner
            .tasks
            .iter()
            .filter(|t| t.unread && scope.matches(t))
            .count())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn harness_mark_read(
    view: Webview,
    app: AppHandle,
    state: State<'_, Tasks>,
    id: String,
    workspace: Workspace,
    result_revision: u64,
) -> Result<bool, String> {
    local(&view)?;
    let mut inner = state.open(&app)?;
    let Some(i) = inner.tasks.iter().position(|t| {
        t.id == id && t.workspace == workspace && t.result_revision == result_revision && t.unread
    }) else {
        return Ok(false);
    };
    let folder = inner.folder.clone().ok_or("缺少任务目录")?;
    inner.tasks[i].unread = false;
    if let Err(e) = save(&folder, &inner.tasks) {
        inner.tasks[i].unread = true;
        return Err(e);
    }
    drop(inner);
    notify_results(&app);
    Ok(true)
}
#[tauri::command]
pub fn harness_stop(
    view: Webview,
    app: AppHandle,
    state: State<'_, Tasks>,
    id: String,
) -> Result<(), String> {
    local(&view)?;
    let mut inner = state.open(&app)?;
    if inner.proposals.remove(&id).is_some() {
        review::finish(
            &app,
            &mut inner,
            &id,
            Status::Rejected,
            "已放弃建议，原文件未修改。".into(),
        )?;
    }
    if let Some((_, slot)) = inner.active.as_mut().filter(|(key, _)| key == &id) {
        if let Some(tx) = slot.take() {
            let _ = tx.send(());
        }
    }
    Ok(())
}
#[tauri::command]
pub fn harness_forget(
    view: Webview,
    app: AppHandle,
    state: State<'_, Tasks>,
    id: String,
) -> Result<(), String> {
    local(&view)?;
    let mut inner = state.open(&app)?;
    if inner.active.as_ref().is_some_and(|(key, _)| key == &id) {
        return Err("请先停止运行中的任务".into());
    }
    if !inner.tasks.iter().any(|t| t.id == id) {
        return Ok(());
    }
    if inner.tasks.iter().any(|t| {
        t.id == id
            && matches!(
                t.status,
                Status::AwaitingReview | Status::Applying | Status::Undoing
            )
    }) {
        return Err("请先结束此任务的审阅或文件操作".into());
    }
    let folder = inner.folder.as_deref().ok_or("缺少任务目录")?;
    cleanup_task_scratch(folder, &id).map_err(io_err)?;
    forget_legacy(folder, &id)?;
    let rows: Vec<_> = inner.tasks.iter().filter(|t| t.id != id).cloned().collect();
    save(folder, &rows)?;
    inner.tasks = rows;
    notify_results(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn full_preview_queue_preserves_other_destinations_and_reclaims_expired_slots() {
        let mut inner = Inner::default();
        let preview = |id: usize, quote: Option<&str>| Draft {
            id: id.to_string(),
            snapshot: Snapshot {
                workspace: Workspace {
                    path: format!("folder-{id}"),
                    identity: id.to_string(),
                },
                files: vec![],
            },
            kind: TaskKind::Question,
            endpoint: "fixture".into(),
            model: "fixture".into(),
            web: None,
            quote_id: quote.map(str::to_owned),
            remote_source: None,
            remote_grant: None,
        };
        inner.remember_preview(preview(0, Some("X"))).unwrap();
        for id in 1..PREVIEW_LIMIT {
            inner.remember_preview(preview(id, None)).unwrap();
        }
        assert!(inner.remember_preview(preview(30, None)).is_err());
        // Changing X's destination frees only its own slot, even at capacity.
        inner.remember_preview(preview(40, Some("X"))).unwrap();
        let ids = |i: &Inner| {
            i.drafts
                .iter()
                .map(|(_, d)| d.id.clone())
                .collect::<Vec<_>>()
        };
        let mut expected: Vec<_> = (1..PREVIEW_LIMIT).map(|id| id.to_string()).collect();
        expected.push("40".into());
        assert_eq!(ids(&inner), expected);
        inner.drafts[0].0 = Instant::now() - PREVIEW_TTL;
        inner.remember_preview(preview(50, None)).unwrap();
        expected.remove(0);
        expected.push("50".into());
        assert_eq!(ids(&inner), expected);
    }
    #[test]
    fn migrate_without_rewriting_v1_and_forget_both_copies() {
        let dir = tempfile::tempdir().unwrap();
        let row = serde_json::json!({"id":"legacy","workspace":{"path":"X","identity":"Y"},"files":["a.md"],"question":"private","endpoint":"local","model":"fixture","created":0,"status":"succeeded","result":"answer"});
        let old =
            serde_json::to_vec_pretty(&serde_json::json!({"version":1,"tasks":[row]})).unwrap();
        let legacy = dir.path().join("tasks-v1.json");
        fs::write(&legacy, &old).unwrap();
        let (rows, migrate) = load_rows(dir.path()).unwrap();
        assert!(migrate && rows[0].kind == TaskKind::Question);
        assert!(
            !rows[0].unread && rows[0].result_revision == 0,
            "Old history must not turn into new notifications"
        );
        save(dir.path(), &rows).unwrap();
        assert_eq!(fs::read(&legacy).unwrap(), old);
        assert!(!load_rows(dir.path()).unwrap().1);
        forget_legacy(dir.path(), "legacy").unwrap();
        save(dir.path(), &[]).unwrap();
        assert!(load_rows(dir.path()).unwrap().0.is_empty());
        assert_eq!(
            read_json(dir.path(), "tasks-v1.json").unwrap().unwrap()["tasks"],
            serde_json::json!([])
        );
    }
    #[test]
    fn migrate_v2_before_v1_preserves_source_and_removes_legacy_duplicates() {
        let dir = tempfile::tempdir().unwrap();
        let row = serde_json::json!({"id":"same","workspace":{"path":"X","identity":"Y"},"files":[],"question":"private","endpoint":"local","model":"fixture","created":0,"status":"succeeded","result":"v1"});
        for version in [1, 2] {
            let mut one = row.clone();
            if version == 2 {
                one["result"] = serde_json::json!("v2");
            }
            atomic_json(
                dir.path(),
                &format!("tasks-v{version}.json"),
                &serde_json::json!({"version":version,"tasks":[one]}),
            )
            .unwrap();
        }
        let prior = fs::read(dir.path().join("tasks-v2.json")).unwrap();
        let (mut rows, migrate) = load_rows(dir.path()).unwrap();
        assert!(migrate);
        assert_eq!(rows[0].result, "v2");
        let mut web = rows[0].clone();
        web.id = "new-web".into();
        web.web_source = Some(Origin {
            url: "https://example.org/article".into(),
            captured_at: 42,
        });
        rows.push(web);
        save(dir.path(), &rows).unwrap();
        assert_eq!(fs::read(dir.path().join("tasks-v2.json")).unwrap(), prior);
        let (rows, migrate) = load_rows(dir.path()).unwrap();
        assert!(!migrate);
        let source = rows[1].web_source.as_ref().unwrap();
        assert_eq!(
            (source.url.as_str(), source.captured_at),
            ("https://example.org/article", 42)
        );
        forget_legacy(dir.path(), "same").unwrap();
        for version in [1, 2] {
            assert_eq!(
                read_json(dir.path(), &format!("tasks-v{version}.json"))
                    .unwrap()
                    .unwrap()["tasks"],
                serde_json::json!([])
            );
        }
    }
    #[test]
    fn imports_v3_web_history_into_v4_without_losing_the_source_or_editing_the_old_file() {
        let dir = tempfile::tempdir().unwrap();
        let old = serde_json::json!({"version":3,"tasks":[{"id":"old-web","workspace":{"path":"X","identity":"Y"},"files":[],"question":"why","endpoint":"local","model":"fixture","created":1,"status":"succeeded","result":"answer","webSource":{"url":"https://example.org/","capturedAt":7}}]});
        atomic_json(dir.path(), "tasks-v3.json", &old).unwrap();
        let (rows, changed) = load_rows(dir.path()).unwrap();
        assert!(changed);
        assert!(rows[0].remote_source.is_none());
        assert_eq!(rows[0].web_source.as_ref().unwrap().captured_at, 7);
        save(dir.path(), &rows).unwrap();
        assert_eq!(
            read_json(dir.path(), "tasks-v3.json").unwrap().unwrap(),
            old
        );
        let (rows, changed) = load_rows(dir.path()).unwrap();
        assert!(!changed);
        assert_eq!(rows[0].id, "old-web");
    }
    #[test]
    fn corrupt_current_history_does_not_fall_back_or_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        atomic_json(
            dir.path(),
            "tasks-v1.json",
            &serde_json::json!({"version":1,"tasks":[]}),
        )
        .unwrap();
        let current = dir.path().join(format!("tasks-v{LEDGER_VERSION}.json"));
        fs::write(&current, b"truncated").unwrap();
        assert!(load_rows(dir.path()).is_err());
        assert_eq!(fs::read(current).unwrap(), b"truncated");
    }
}
