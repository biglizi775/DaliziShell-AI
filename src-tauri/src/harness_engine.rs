//! Machine-local opt-in. Neither component state nor diagnostics carry task contents.
use super::{atomic_json, local, read_json, Status, Tasks};
#[path = "harness_component.rs"]
mod component;
use dalizi_harness_client::runtime::Runtime;
use serde::Serialize;
use std::{
    collections::VecDeque,
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Instant,
};
use tauri::{AppHandle, Manager, Webview};
const OFF: &str =
    "Harness 未启用。请打开「设置 → Agent 引擎」检查并启用；原有聊天和任务历史仍可使用。";
const MISSING: &str = "未找到匹配组件。请把对应版本的组件 ZIP 原样放在程序同级 components 文件夹。";
const COMPONENT_SUPPORTED: bool = cfg!(target_arch = "x86_64");
const UNSUPPORTED: &str = "独立 Harness 任务需要 x64 版桌面和配套组件。当前版本可使用原有聊天引擎。";
fn folder(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|_| "无法打开应用数据目录")?
        .join("HarnessEngine"))
}
fn exe_dir() -> io::Result<PathBuf> {
    std::env::current_exe()?
        .parent()
        .map(Path::to_owned)
        .ok_or_else(|| io::Error::other("无法定位程序目录"))
}
pub(super) enum Source {
    Pack(component::Image),
    #[cfg(debug_assertions)]
    Development(Runtime),
}
impl Source {
    pub(super) fn provision(self, root: &Path) -> io::Result<Runtime> {
        match self {
            Self::Pack(i) => i.provision(root),
            #[cfg(debug_assertions)]
            Self::Development(rt) => Ok(rt),
        }
    }
    fn kind(&self) -> &'static str {
        match self {
            Self::Pack(_) => "component",
            #[cfg(debug_assertions)]
            Self::Development(_) => "development",
        }
    }
    fn verify(self) -> Result<(), String> {
        match self {
            Self::Pack(i) => i
                .verify_or_extract(None)
                .map_err(|_| "组件完整性校验失败；未启动运行时。".into()),
            #[cfg(debug_assertions)]
            Self::Development(_) => Ok(()),
        }
    }
}
fn source(_app: &AppHandle) -> Result<Source, String> {
    if !COMPONENT_SUPPORTED {
        return Err(UNSUPPORTED.into());
    }
    let dir = exe_dir().map_err(|_| "无法定位程序目录")?;
    match component::Image::open(&dir) {
        Ok(image) => return Ok(Source::Pack(image)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => (),
        Err(_) => return Err("组件清单或文件无效。请重新复制匹配版本的完整组件。".into()),
    }
    // A release never searches a developer installation or PATH, including on error.
    #[cfg(debug_assertions)]
    {
        let dev = _app
            .path()
            .local_data_dir()
            .map_err(|_| "无法定位开发工具")?
            .join("DaliziDev");
        return Runtime::development(&dev)
            .map(Source::Development)
            .map_err(|_| MISSING.into());
    }
    #[cfg(not(debug_assertions))]
    {
        Err(MISSING.into())
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Event {
    id: u64,
    stage: &'static str,
    outcome: &'static str,
    elapsed_ms: u64,
}
#[derive(Default)]
struct Data {
    enabled: Option<bool>,
    revision: u64,
    next: u64,
    events: VecDeque<Event>,
    export: Option<(String, String)>,
}
#[derive(Default)]
pub struct Engine(Mutex<Data>);
fn enabled(app: &AppHandle, d: &mut Data) -> Result<bool, String> {
    if !COMPONENT_SUPPORTED {
        return Ok(false);
    }
    if let Some(v) = d.enabled {
        return Ok(v);
    }
    let data = read_json(&folder(app)?, "engine-v1.json")?;
    let value = match data {
        None => false,
        Some(v) if v["version"] == 1 && v["enabled"].is_boolean() => {
            v["component"] == component::ID && v["enabled"] == true
        }
        _ => return Err("引擎设置无效，未启用。请在引擎设置中重新选择。".into()),
    };
    d.enabled = Some(value);
    Ok(value)
}
pub fn revision(app: &AppHandle) -> Result<u64, String> {
    if !COMPONENT_SUPPORTED {
        return Err(UNSUPPORTED.into());
    }
    let state = app.state::<Engine>();
    let mut data = state.0.lock().map_err(|_| "引擎不可用")?;
    if enabled(app, &mut data)? {
        Ok(data.revision)
    } else {
        Err(OFF.into())
    }
}
pub(super) fn acquire(app: &AppHandle) -> Result<Source, String> {
    revision(app)?;
    source(app)
}
pub fn record(app: &AppHandle, stage: &'static str, outcome: &'static str, start: Instant) {
    if let Ok(mut d) = app.state::<Engine>().0.lock() {
        d.next = d.next.wrapping_add(1);
        let id = d.next;
        if d.events.len() >= 20 {
            d.events.pop_front();
        }
        d.events.push_back(Event {
            id,
            stage,
            outcome,
            elapsed_ms: start.elapsed().as_millis() as u64,
        });
    };
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    version: &'static str,
    component: &'static str,
    manifest_sha256: &'static str,
    profile: &'static str,
    protocol: &'static str,
    tools: u8,
    enabled: bool,
    source: &'static str,
    message: String,
    events: Vec<Event>,
}
fn report(app: &AppHandle) -> Result<Report, String> {
    let src = source(app);
    let state = app.state::<Engine>();
    let mut d = state.0.lock().map_err(|_| "引擎不可用")?;
    let on = enabled(app, &mut d);
    let (kind, msg) = match src {
        Ok(s) => (
            s.kind(),
            if matches!(s, Source::Pack(_)) {
                "已识别组件清单；启用和每次运行时会校验内容。".into()
            } else {
                "开发运行时；未经发行组件完整性校验。".into()
            },
        ),
        Err(e) if !COMPONENT_SUPPORTED => ("unsupported-architecture", e),
        Err(e) => ("unavailable", e),
    };
    Ok(Report {
        version: env!("CARGO_PKG_VERSION"),
        component: if COMPONENT_SUPPORTED { component::ID } else { "" },
        manifest_sha256: if COMPONENT_SUPPORTED { component::PIN.trim() } else { "" },
        profile: "sdk-minimal / snapshot-only",
        protocol: "deepseek-harness-sdk-runtime/0.0.1",
        tools: 0,
        enabled: on.clone().unwrap_or(false),
        source: kind,
        message: on.err().unwrap_or(msg),
        events: d.events.iter().cloned().collect(),
    })
}
#[tauri::command]
pub fn harness_engine_status(view: Webview, app: AppHandle) -> Result<Report, String> {
    local(&view)?;
    report(&app)
}
#[tauri::command]
pub async fn harness_engine_check(view: Webview, app: AppHandle) -> Result<Report, String> {
    local(&view)?;
    check(&app).await?;
    report(&app)
}
async fn check(app: &AppHandle) -> Result<(), String> {
    let start = Instant::now();
    let a = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || source(&a)?.verify())
        .await
        .map_err(|_| "组件检查被中断")?;
    record(
        app,
        "component-check",
        if result.is_ok() { "ok" } else { "failed" },
        start,
    );
    result
}
#[tauri::command]
pub async fn harness_engine_set(
    view: Webview,
    app: AppHandle,
    enabled: bool,
) -> Result<Report, String> {
    local(&view)?;
    if !COMPONENT_SUPPORTED {
        return Err(UNSUPPORTED.into());
    }
    let before = app
        .state::<Engine>()
        .0
        .lock()
        .map_err(|_| "引擎不可用")?
        .revision;
    if enabled {
        check(&app).await?;
    }
    {
        // A new preview or submission takes this same task lock before binding its revision.
        let tasks = app.state::<Tasks>();
        let mut inner = tasks.0.lock().map_err(|_| "任务不可用")?;
        let state = app.state::<Engine>();
        let mut d = state.0.lock().map_err(|_| "引擎不可用")?;
        if d.revision != before {
            return Err("引擎设置已改变，请重新检查。".into());
        }
        let dest = folder(&app)?;
        fs::create_dir_all(&dest).map_err(|_| "无法保存引擎开关")?;
        atomic_json(
            &dest,
            "engine-v1.json",
            &serde_json::json!({"version":1,"component":component::ID,"enabled":enabled}),
        )?;
        if d.enabled != Some(enabled) {
            d.revision = d.revision.wrapping_add(1);
            inner.drafts.clear();
        }
        d.enabled = Some(enabled);
        if !enabled {
            inner.proposals.clear();
            for t in &mut inner.tasks {
                if t.status == Status::AwaitingReview {
                    t.publish_result(Status::Rejected, "引擎已停用，未批准的提案已失效。".into());
                }
            }
            if let Some(dir) = &inner.folder {
                super::save(dir, &inner.tasks)?;
            }
        }
    }
    super::notify_results(&app);
    report(&app)
}
#[derive(Serialize)]
pub struct Preview {
    pub id: String,
    pub text: String,
}
#[tauri::command]
pub fn harness_diag_preview(view: Webview, app: AppHandle) -> Result<Preview, String> {
    local(&view)?;
    let text = serde_json::to_string_pretty(&report(&app)?).map_err(|_| "诊断不可用")?;
    let id = uuid::Uuid::new_v4().to_string();
    app.state::<Engine>()
        .0
        .lock()
        .map_err(|_| "引擎不可用")?
        .export = Some((id.clone(), text.clone()));
    Ok(Preview { id, text })
}
#[tauri::command]
pub async fn harness_diag_save(view: Webview, app: AppHandle, id: String) -> Result<bool, String> {
    local(&view)?;
    let text = {
        let state = app.state::<Engine>();
        let mut d = state.0.lock().map_err(|_| "引擎不可用")?;
        if !d.export.as_ref().is_some_and(|(key, _)| *key == id) {
            return Err("诊断预览已过期，请重新预览。".into());
        }
        d.export.take().ok_or("没有诊断预览")?.1
    };
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_file_name("dalizi-harness-diagnostics.json")
        .add_filter("JSON", &["json"])
        .save_file()
        .await
    else {
        return Ok(false);
    };
    let path = file.path().to_owned();
    tauri::async_runtime::spawn_blocking(move || write_preview(&path, &text))
        .await
        .map_err(|_| "诊断导出被中断")?
}
fn write_preview(path: &Path, text: &str) -> Result<bool, String> {
    use std::io::Write;
    let mut tmp = tempfile::NamedTempFile::new_in(path.parent().ok_or("目标无效")?)
        .map_err(|_| "无法导出诊断")?;
    tmp.write_all(text.as_bytes())
        .and_then(|_| tmp.as_file().sync_all())
        .map_err(|_| "无法写入诊断")?;
    tmp.persist_noclobber(path)
        .map_err(|_| "无法保存；请选择未使用的新文件名。")?;
    Ok(true)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn export_preserves_preview_and_never_overwrites_existing_report() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("引擎诊断.json");
        let text = "{\"tools\":0}";
        assert!(write_preview(&out, text).unwrap());
        assert!(write_preview(&out, "other").is_err());
        assert_eq!(fs::read_to_string(out).unwrap(), text);
    }
}
