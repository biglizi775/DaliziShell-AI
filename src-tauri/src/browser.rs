//! Embedded Chromium/WebView2 browser tabs.
//!
//! Each tab is a child WebView of the main Tauri window. Its profile directory
//! is kept under the app-local data directory so cookies, cache and site data
//! survive restarts without sharing the file-manager webview's storage.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use serde::{Deserialize, Serialize};
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, WebviewUrl, Wry};

#[path = "browser_downloads.rs"]
pub(crate) mod downloads;
#[path = "browser_extensions.rs"]
mod extensions;
#[path = "browser_settings.rs"]
mod settings;
pub use settings::BrowserSettings;

#[derive(Default)]
pub struct BrowserState(
    pub Mutex<HashMap<String, tauri::Webview<Wry>>>,
    pub tokio::sync::Mutex<()>,
    pub Mutex<Option<BrowserSettings>>,
    pub AtomicBool,
);

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrowserBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPageEvent {
    pub key: String,
    pub url: String,
    pub title: Option<String>,
    pub phase: String,
}

fn valid_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 120
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn valid_url(value: &str) -> Result<url::Url, String> {
    let url = value
        .trim()
        .parse::<url::Url>()
        .map_err(|_| "浏览器地址无效 / Invalid browser URL".to_string())?;
    if !matches!(url.scheme(), "http" | "https" | "about") {
        return Err(
            "浏览器只允许 http、https 或 about 地址 / Unsupported browser URL scheme".into(),
        );
    }
    if url.scheme() != "about" && url.host_str().is_none() {
        return Err("浏览器地址缺少主机名 / Browser URL has no host".into());
    }
    Ok(url)
}

fn valid_bounds(bounds: &BrowserBounds) -> Result<(), String> {
    if !bounds.x.is_finite()
        || !bounds.y.is_finite()
        || !bounds.width.is_finite()
        || !bounds.height.is_finite()
        || bounds.width < 1.0
        || bounds.height < 1.0
        || bounds.width > 10000.0
        || bounds.height > 10000.0
    {
        return Err("浏览器区域尺寸无效 / Invalid browser bounds".into());
    }
    Ok(())
}

fn extension_dir(value: Option<String>) -> Result<Option<PathBuf>, String> {
    let Some(raw) = value.filter(|s| !s.trim().is_empty()) else {
        return Ok(None);
    };
    if raw.len() > 1024 || raw.chars().any(char::is_control) {
        return Err("扩展目录路径无效 / Invalid extension directory".into());
    }
    let path = PathBuf::from(raw);
    if !path.is_absolute() || !path.is_dir() {
        return Err("扩展目录必须是存在的绝对路径 / Extension directory must exist".into());
    }
    let metadata = std::fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("扩展目录不能是符号链接 / Extension directory cannot be a symlink".into());
    }
    Ok(Some(path))
}

fn profile_dir(app: &AppHandle, _key: &str) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("browser-profiles");
    let path = root.join("default");
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

fn emit_page(app: &AppHandle, key: &str, url: &url::Url, phase: &str, title: Option<String>) {
    let _ = app.emit(
        "browser-page",
        BrowserPageEvent {
            key: key.to_string(),
            url: url.to_string(),
            title,
            phase: phase.to_string(),
        },
    );
}

#[tauri::command]
pub async fn browser_create(
    app: AppHandle,
    state: State<'_, BrowserState>,
    key: String,
    url: String,
    bounds: BrowserBounds,
    extension_path: Option<String>,
    settings: Option<BrowserSettings>,
) -> Result<(), String> {
    if !valid_key(&key) {
        return Err("Invalid browser tab key".into());
    }
    let url = valid_url(&url)?;
    valid_bounds(&bounds)?;
    let _settings_guard = state.1.lock().await;
    // Committed settings win over a stale create payload queued while the
    // settings dialog was saving. Profile preferences are shared by all tabs.
    let requested = state
        .2
        .lock()
        .ok()
        .and_then(|value| value.clone())
        .or(settings)
        .unwrap_or_default();
    let settings = requested
        .clone()
        .resolved(&app.path().download_dir().map_err(|e| e.to_string())?)?;
    let existing: Vec<_> = state
        .0
        .lock()
        .map_err(|_| "Browser state unavailable")?
        .values()
        .cloned()
        .collect();
    let mut snapshots = Vec::with_capacity(existing.len());
    for view in &existing {
        snapshots.push(settings::get(view.clone()).await?);
    }
    // Extensions are installed explicitly, once, through the manager. Re-adding
    // on every new tab would resurrect removed extensions and reset enablement.
    let _ = extension_path;
    let profile = profile_dir(&app, &key)?;
    let window = app
        .get_window("main")
        .ok_or_else(|| "主窗口不可用 / Main window unavailable".to_string())?;
    if !state.3.swap(true, Ordering::AcqRel) {
        let event_app = app.clone();
        window.on_window_event(move |event| {
            if !matches!(event, tauri::WindowEvent::ThemeChanged(_)) { return; }
            let app = event_app.clone();
            // Tauri writes the window theme into every webview AFTER emitting
            // this event. Dispatch later so the browser preference wins while
            // the main application's theme remains under Tauri's control.
            tauri::async_runtime::spawn(async move {
                let state = app.state::<BrowserState>();
                // Read the committed value only after acquiring the gate, so
                // an older theme event cannot overwrite a concurrent save.
                let _settings_guard = state.1.lock().await;
                let requested = state.2.lock().ok().and_then(|value| value.clone());
                if let Some(requested) = requested {
                    let views: Vec<_> = state.0.lock().unwrap().values().cloned().collect();
                    for view in views {
                        if let Err(error) = settings::restore_color_scheme(view, requested.color_scheme.clone()).await {
                            let _ = app.emit("browser-settings-error", &error);
                            eprintln!("Could not restore browser preference after window theme change: {error}");
                        }
                    }
                }
            });
        });
    }
    let label = format!("browser-{key}");
    let event_app = app.clone();
    let event_key = key.clone();
    // Delay the first website navigation until script permissions, profile
    // preferences and zoom have all reached the real native WebView2 object.
    let ready = Arc::new(AtomicBool::new(false));
    let builder = WebviewBuilder::new(label, WebviewUrl::External("about:blank".parse().unwrap()))
        .data_directory(profile)
        .browser_extensions_enabled(true)
        // Wry writes its autofill default while creating the controller. Match
        // the committed profile preference so a new tab cannot briefly reset it.
        .general_autofill_enabled(settings.autofill_enabled)
        .on_navigation({
            let app = app.clone();
            let key = key.clone();
            let ready = ready.clone();
            move |next| {
                if valid_url(next.as_str()).is_err() {
                    return false;
                }
                if ready.load(Ordering::Acquire) {
                    emit_page(&app, &key, next, "navigating", None);
                }
                true
            }
        })
        .on_page_load({
            let ready = ready.clone();
            move |_webview, payload| {
                let phase = match payload.event() {
                    PageLoadEvent::Started => "started",
                    PageLoadEvent::Finished => "finished",
                };
                if ready.load(Ordering::Acquire) {
                    emit_page(&event_app, &event_key, payload.url(), phase, None);
                }
            }
        })
        .on_document_title_changed({
            let app = app.clone();
            let key = key.clone();
            let ready = ready.clone();
            move |webview, title| {
                if !ready.load(Ordering::Acquire) {
                    return;
                }
                if let Ok(url) = webview.url() {
                    emit_page(&app, &key, &url, "title", Some(title));
                }
            }
        })
        .on_new_window({
            let app = app.clone();
            let key = key.clone();
            move |next, _features| {
                emit_page(&app, &key, &next, "new-window", None);
                NewWindowResponse::Deny
            }
        });
    let child = window
        .add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )
        .map_err(|e| e.to_string())?;
    let mut result = settings::apply(child.clone(), settings.clone()).await;
    // Tauri initializes every child with its parent window's theme, which
    // writes a shared profile preference. Restore every existing native view
    // as well; WebView2's separate environment objects cache profile values.
    if result.is_ok() {
        for (view, before) in existing.iter().zip(&snapshots) {
            // Profile preferences must be restored after Tauri's constructor,
            // but each view keeps its current zoom and page-level settings.
            // Opening a tab must not reset a user's Ctrl+wheel zoom elsewhere.
            let synchronized = BrowserSettings {
                autofill_enabled: settings.autofill_enabled,
                password_autosave_enabled: settings.password_autosave_enabled,
                color_scheme: settings.color_scheme.clone(),
                download_directory: settings.download_directory.clone(),
                ..before.clone()
            };
            if let Err(error) = settings::apply(view.clone(), synchronized).await {
                result = Err(error);
                break;
            }
        }
    }
    if let Err(error) = result {
        let _ = child.close();
        let mut failures = Vec::new();
        for (view, before) in existing.into_iter().zip(snapshots) {
            if let Err(rollback) = settings::apply(view, before).await {
                failures.push(rollback);
            }
        }
        return Err(if failures.is_empty() {
            error
        } else {
            format!(
                "{error}; existing-tab rollback failed: {}",
                failures.join("; ")
            )
        });
    }
    ready.store(true, Ordering::Release);
    if let Err(error) = child.navigate(url) {
        let _ = child.close();
        return Err(format!(
            "浏览器设置已应用，但导航失败 / Settings applied but navigation failed: {error}"
        ));
    }
    if let Some(previous) = state.0.lock().unwrap().insert(key, child) {
        let _ = previous.close();
    }
    *state
        .2
        .lock()
        .map_err(|_| "Browser settings state unavailable")? = Some(requested);
    Ok(())
}

#[tauri::command]
pub fn browser_set_active(
    state: State<'_, BrowserState>,
    key: String,
    active: bool,
    bounds: BrowserBounds,
) -> Result<(), String> {
    if !valid_key(&key) {
        return Err("Invalid browser tab key".into());
    }
    valid_bounds(&bounds)?;
    let webview = state
        .0
        .lock()
        .unwrap()
        .get(&key)
        .cloned()
        .ok_or_else(|| "browser tab not found".to_string())?;
    webview
        .set_position(LogicalPosition::new(bounds.x, bounds.y))
        .map_err(|e| e.to_string())?;
    webview
        .set_size(LogicalSize::new(bounds.width, bounds.height))
        .map_err(|e| e.to_string())?;
    let result = if active {
        webview.show()
    } else {
        webview.hide()
    };
    result.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_navigate(
    state: State<'_, BrowserState>,
    key: String,
    url: String,
) -> Result<(), String> {
    let url = valid_url(&url)?;
    let webview = state
        .0
        .lock()
        .unwrap()
        .get(&key)
        .cloned()
        .ok_or_else(|| "browser tab not found".to_string())?;
    webview.navigate(url).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_action(
    state: State<'_, BrowserState>,
    key: String,
    action: String,
) -> Result<(), String> {
    settings::action(extension_webview(&state, &key)?, action).await
}

#[tauri::command]
pub async fn browser_settings_apply(
    app: AppHandle,
    state: State<'_, BrowserState>,
    settings: BrowserSettings,
) -> Result<(), String> {
    let requested = settings;
    let settings = requested
        .clone()
        .resolved(&app.path().download_dir().map_err(|e| e.to_string())?)?;
    let _settings_guard = state.1.lock().await;
    let views: Vec<_> = state
        .0
        .lock()
        .map_err(|_| "Browser state unavailable")?
        .iter()
        .map(|(key, view)| (key.clone(), view.clone()))
        .collect();
    // Capture all snapshots first: profile settings are shared across tabs.
    let mut snapshots = Vec::with_capacity(views.len());
    for (key, view) in &views {
        snapshots.push(
            settings::get(view.clone())
                .await
                .map_err(|error| format!("标签页 {key}: {error}"))?,
        );
    }
    for (index, (key, view)) in views.iter().enumerate() {
        if let Err(error) = settings::apply(view.clone(), settings.clone()).await {
            let mut rollback_errors = Vec::new();
            for restore in (0..=index).rev() {
                if let Err(error) =
                    settings::apply(views[restore].1.clone(), snapshots[restore].clone()).await
                {
                    rollback_errors.push(format!("{}: {error}", views[restore].0));
                }
            }
            return Err(if rollback_errors.is_empty() {
                format!("标签页 {key} 设置失败，已还原已更改标签页 / Settings failed; changed tabs restored: {error}")
            } else {
                format!("标签页 {key} 设置失败，部分还原失败，请重新读取实际设置 / Partial settings rollback failure: {error}; {}", rollback_errors.join("; "))
            });
        }
    }
    *state
        .2
        .lock()
        .map_err(|_| "Browser settings state unavailable")? = Some(requested);
    Ok(())
}

#[tauri::command]
pub async fn browser_settings_get(
    state: State<'_, BrowserState>,
    key: String,
) -> Result<BrowserSettings, String> {
    let _settings_guard = state.1.lock().await;
    settings::get(extension_webview(&state, &key)?).await
}

#[tauri::command]
pub async fn browser_clear_data(
    state: State<'_, BrowserState>,
    key: String,
    kinds: Vec<String>,
) -> Result<(), String> {
    settings::clear(extension_webview(&state, &key)?, kinds).await
}

#[tauri::command]
pub async fn browser_downloads_show(
    state: State<'_, BrowserState>,
    key: String,
) -> Result<(), String> {
    downloads::set_open(extension_webview(&state, &key)?, true).await
}

#[tauri::command]
pub fn browser_close(state: State<'_, BrowserState>, key: String) -> Result<(), String> {
    if let Some(webview) = state.0.lock().unwrap().remove(&key) {
        webview.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn shutdown(state: &BrowserState) {
    let views = std::mem::take(&mut *state.0.lock().unwrap());
    for (_, webview) in views {
        let _ = webview.close();
    }
}

fn extension_webview(state: &BrowserState, key: &str) -> Result<tauri::Webview<Wry>, String> {
    if !valid_key(key) {
        return Err("Invalid browser tab key".into());
    }
    state
        .0
        .lock()
        .map_err(|_| "Browser state unavailable".to_string())?
        .get(key)
        .cloned()
        .ok_or_else(|| "请先打开一个浏览器标签页 / Open a browser tab first".into())
}

#[tauri::command]
pub async fn browser_extensions_list(
    state: State<'_, BrowserState>,
    key: String,
) -> Result<Vec<extensions::BrowserExtension>, String> {
    extensions::list(extension_webview(&state, &key)?).await
}

#[tauri::command]
pub async fn browser_extension_set_enabled(
    state: State<'_, BrowserState>,
    key: String,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    extensions::set_enabled(extension_webview(&state, &key)?, id, enabled).await
}

#[tauri::command]
pub async fn browser_extension_remove(
    state: State<'_, BrowserState>,
    key: String,
    id: String,
) -> Result<(), String> {
    extensions::remove(extension_webview(&state, &key)?, id).await
}

#[tauri::command]
pub async fn browser_extension_install(
    state: State<'_, BrowserState>,
    key: String,
    path: String,
) -> Result<extensions::BrowserExtension, String> {
    let path = extension_dir(Some(path))?
        .ok_or("请选择解压扩展目录 / Choose an unpacked extension folder")?;
    extensions::install(extension_webview(&state, &key)?, path).await
}
