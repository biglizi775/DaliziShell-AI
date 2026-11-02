//! Browser-only WebView2 settings. COM objects remain on the UI apartment.
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{Webview, Wry};
use tokio::sync::oneshot;
use webview2_com::{
    take_pwstr, ClearBrowsingDataCompletedHandler, Microsoft::Web::WebView2::Win32::*,
};
use windows_core::{Interface, BOOL, HSTRING, PWSTR};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct BrowserSettings {
    pub zoom: f64,
    pub javascript_enabled: bool,
    pub context_menus_enabled: bool,
    pub dev_tools_enabled: bool,
    pub autofill_enabled: bool,
    pub password_autosave_enabled: bool,
    pub color_scheme: String,
    pub download_directory: String,
}

impl Default for BrowserSettings {
    fn default() -> Self {
        Self {
            zoom: 1.0,
            javascript_enabled: true,
            context_menus_enabled: true,
            dev_tools_enabled: true,
            autofill_enabled: true,
            password_autosave_enabled: false,
            color_scheme: "system".into(),
            download_directory: String::new(),
        }
    }
}

impl BrowserSettings {
    /// Resolve the empty directory to the OS download folder, not a previously
    /// persisted WebView2 override. Validate before changing any native state.
    pub fn resolved(mut self, default_download: &Path) -> Result<Self, String> {
        if !self.zoom.is_finite() || !(0.5..=2.0).contains(&self.zoom) {
            return Err("页面缩放必须在 50% 到 200% 之间 / Invalid browser zoom".into());
        }
        if !matches!(self.color_scheme.as_str(), "system" | "light" | "dark") {
            return Err(
                "浏览器主题必须是 system、light 或 dark / Invalid browser color scheme".into(),
            );
        }
        let system_default = self.download_directory.is_empty();
        if system_default {
            self.download_directory = default_download
                .to_str()
                .ok_or("系统下载目录不是有效 Unicode 路径 / Invalid system download directory")?
                .into();
        }
        let path = Path::new(&self.download_directory);
        if self.download_directory.len() > 32767
            || self.download_directory.chars().any(char::is_control)
            || !path.is_absolute()
            || (!system_default && !path.is_dir())
        {
            return Err("下载目录必须是存在的绝对目录 / Download directory must be an existing absolute directory".into());
        }
        Ok(self)
    }
}

type Reply<T> = Arc<Mutex<Option<oneshot::Sender<Result<T, String>>>>>;
fn finish<T>(reply: &Reply<T>, result: Result<T, String>) {
    if let Ok(mut sender) = reply.lock() {
        if let Some(sender) = sender.take() {
            let _ = sender.send(result);
        }
    }
}
fn native_error(error: windows_core::Error) -> String {
    format!("WebView2 浏览器操作失败 / Browser operation failed: {error}")
}

async fn with_controller<T, F>(webview: Webview<Wry>, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(ICoreWebView2Controller, Reply<T>) -> Result<(), String> + Send + 'static,
{
    let (sender, receiver) = oneshot::channel();
    let reply = Arc::new(Mutex::new(Some(sender)));
    webview
        .with_webview(move |native| {
            // A queued synchronous operation must not start after its caller timed
            // out or was cancelled. Async clear operations can finish later.
            if !reply
                .lock()
                .map(|sender| sender.as_ref().is_some_and(|sender| !sender.is_closed()))
                .unwrap_or(false)
            {
                return;
            }
            if let Err(error) = operation(native.controller().clone(), reply.clone()) {
                finish(&reply, Err(error));
            }
        })
        .map_err(|e| e.to_string())?;
    tokio::time::timeout(Duration::from_secs(30), receiver).await
        .map_err(|_| "浏览器操作超时，状态可能尚未完成；请重新读取后确认 / Browser operation timed out; verify current state".to_string())?
        .map_err(|_| "浏览器已关闭或操作中断 / Browser closed or operation interrupted".to_string())?
}

struct NativeSettings {
    controller: ICoreWebView2Controller,
    settings: ICoreWebView2Settings,
    profile: ICoreWebView2Profile6,
}

impl NativeSettings {
    unsafe fn new(controller: ICoreWebView2Controller) -> Result<Self, String> {
        let view = controller.CoreWebView2().map_err(native_error)?;
        let settings = view.Settings().map_err(native_error)?;
        let profile = view.cast::<ICoreWebView2_13>().and_then(|view| view.Profile())
            .and_then(|profile| profile.cast::<ICoreWebView2Profile6>())
            .map_err(|error| format!("当前 WebView2 不支持所需浏览器设置，请更新运行时 / Browser settings APIs unavailable: {error}"))?;
        Ok(Self {
            controller,
            settings,
            profile,
        })
    }

    unsafe fn read(&self) -> Result<BrowserSettings, String> {
        let mut value = BrowserSettings::default();
        self.controller
            .ZoomFactor(&mut value.zoom)
            .map_err(native_error)?;
        let mut flag = BOOL::default();
        self.settings
            .IsScriptEnabled(&mut flag)
            .map_err(native_error)?;
        value.javascript_enabled = flag.as_bool();
        self.settings
            .AreDefaultContextMenusEnabled(&mut flag)
            .map_err(native_error)?;
        value.context_menus_enabled = flag.as_bool();
        self.settings
            .AreDevToolsEnabled(&mut flag)
            .map_err(native_error)?;
        value.dev_tools_enabled = flag.as_bool();
        self.profile
            .IsGeneralAutofillEnabled(&mut flag)
            .map_err(native_error)?;
        value.autofill_enabled = flag.as_bool();
        self.profile
            .IsPasswordAutosaveEnabled(&mut flag)
            .map_err(native_error)?;
        value.password_autosave_enabled = flag.as_bool();
        let mut scheme = COREWEBVIEW2_PREFERRED_COLOR_SCHEME_AUTO;
        self.profile
            .PreferredColorScheme(&mut scheme)
            .map_err(native_error)?;
        value.color_scheme = match scheme {
            COREWEBVIEW2_PREFERRED_COLOR_SCHEME_AUTO => "system",
            COREWEBVIEW2_PREFERRED_COLOR_SCHEME_LIGHT => "light",
            COREWEBVIEW2_PREFERRED_COLOR_SCHEME_DARK => "dark",
            _ => return Err("WebView2 returned an unknown color scheme".into()),
        }
        .into();
        let mut path = PWSTR::null();
        let result = self.profile.DefaultDownloadFolderPath(&mut path);
        value.download_directory = take_pwstr(path);
        result.map_err(native_error)?;
        Ok(value)
    }

    unsafe fn write(&self, value: &BrowserSettings) -> Result<(), String> {
        // Collect every setter result so a rollback attempts every field even
        // if one setter fails. All interfaces were checked before mutation.
        let scheme = match value.color_scheme.as_str() {
            "light" => COREWEBVIEW2_PREFERRED_COLOR_SCHEME_LIGHT,
            "dark" => COREWEBVIEW2_PREFERRED_COLOR_SCHEME_DARK,
            _ => COREWEBVIEW2_PREFERRED_COLOR_SCHEME_AUTO,
        };
        let results = [
            ("zoom", self.controller.SetZoomFactor(value.zoom)),
            (
                "javascript",
                self.settings.SetIsScriptEnabled(value.javascript_enabled),
            ),
            (
                "context menus",
                self.settings
                    .SetAreDefaultContextMenusEnabled(value.context_menus_enabled),
            ),
            (
                "developer tools",
                self.settings.SetAreDevToolsEnabled(value.dev_tools_enabled),
            ),
            (
                "autofill",
                self.profile
                    .SetIsGeneralAutofillEnabled(value.autofill_enabled),
            ),
            (
                "password autosave",
                self.profile
                    .SetIsPasswordAutosaveEnabled(value.password_autosave_enabled),
            ),
            ("color scheme", self.profile.SetPreferredColorScheme(scheme)),
            (
                "download directory",
                self.profile
                    .SetDefaultDownloadFolderPath(&HSTRING::from(&value.download_directory)),
            ),
        ];
        let errors: Vec<_> = results
            .into_iter()
            .filter_map(|(name, result)| result.err().map(|error| format!("{name}: {error}")))
            .collect();
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("; "))
        }
    }
}

pub async fn get(webview: Webview<Wry>) -> Result<BrowserSettings, String> {
    with_controller(webview, |controller, reply| {
        let result = unsafe { NativeSettings::new(controller)?.read() };
        finish(&reply, result);
        Ok(())
    })
    .await
}

pub async fn apply(webview: Webview<Wry>, value: BrowserSettings) -> Result<(), String> {
    with_controller(webview, move |controller, reply| {
        let result = unsafe {
            let native = NativeSettings::new(controller)?;
            let before = native.read()?;
            match native.write(&value) {
                Ok(()) => Ok(()),
                Err(error) => match native.write(&before) {
                    Ok(()) => Err(format!("浏览器设置失败，已还原 / Browser settings failed and were restored: {error}")),
                    Err(rollback) => Err(format!("浏览器设置部分失败，还原也失败，请重新读取实际设置 / Browser settings and rollback failed: {error}; rollback: {rollback}")),
                },
            }
        };
        finish(&reply, result);
        Ok(())
    }).await
}

fn data_kinds(kinds: &[String]) -> Result<COREWEBVIEW2_BROWSING_DATA_KINDS, String> {
    if kinds.is_empty() || kinds.len() > 2 {
        return Err("请选择缓存或 Cookie/网站数据 / Select cache or cookies/site data".into());
    }
    let mut flags = COREWEBVIEW2_BROWSING_DATA_KINDS(0);
    for (index, kind) in kinds.iter().enumerate() {
        if kinds[..index].contains(kind) {
            return Err("Duplicate browser data kind".into());
        }
        flags |= match kind.as_str() {
            "cache" => COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE,
            "cookies" => {
                COREWEBVIEW2_BROWSING_DATA_KINDS_COOKIES
                    | COREWEBVIEW2_BROWSING_DATA_KINDS_ALL_DOM_STORAGE
            }
            _ => {
                return Err(
                    "只允许清理缓存或 Cookie/网站数据 / Unsupported browser data kind".into(),
                )
            }
        };
    }
    Ok(flags)
}

pub async fn clear(webview: Webview<Wry>, kinds: Vec<String>) -> Result<(), String> {
    let flags = data_kinds(&kinds)?;
    with_controller(webview, move |controller, reply| unsafe {
        let profile = controller.CoreWebView2().and_then(|view| view.cast::<ICoreWebView2_13>())
            .and_then(|view| view.Profile()).and_then(|profile| profile.cast::<ICoreWebView2Profile2>())
            .map_err(|error| format!("当前 WebView2 不支持清理浏览数据，请更新运行时 / Clear browsing data APIs unavailable: {error}"))?;
        let callback = ClearBrowsingDataCompletedHandler::create(Box::new(move |result| {
            finish(&reply, result.map_err(native_error));
            Ok(())
        }));
        profile.ClearBrowsingData(flags, &callback).map_err(native_error)
    }).await
}

pub async fn action(webview: Webview<Wry>, action: String) -> Result<(), String> {
    if !matches!(action.as_str(), "back" | "forward" | "reload") {
        return Err("Unsupported browser action".into());
    }
    with_controller(webview, move |controller, reply| unsafe {
        let view = controller.CoreWebView2().map_err(native_error)?;
        let result = match action.as_str() {
            "back" => view.GoBack(),
            "forward" => view.GoForward(),
            _ => view.Reload(),
        };
        finish(&reply, result.map_err(native_error));
        Ok(())
    })
    .await
}

pub async fn restore_color_scheme(
    webview: Webview<Wry>,
    color_scheme: String,
) -> Result<(), String> {
    let scheme = match color_scheme.as_str() {
        "system" => COREWEBVIEW2_PREFERRED_COLOR_SCHEME_AUTO,
        "light" => COREWEBVIEW2_PREFERRED_COLOR_SCHEME_LIGHT,
        "dark" => COREWEBVIEW2_PREFERRED_COLOR_SCHEME_DARK,
        _ => return Err("Invalid browser color scheme".into()),
    };
    with_controller(webview, move |controller, reply| unsafe {
        let profile = controller
            .CoreWebView2()
            .and_then(|view| view.cast::<ICoreWebView2_13>())
            .and_then(|view| view.Profile())
            .map_err(native_error)?;
        finish(
            &reply,
            profile
                .SetPreferredColorScheme(scheme)
                .map_err(native_error),
        );
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_invalid_settings_are_validated_before_native_mutation() {
        let root = std::env::temp_dir();
        let default = BrowserSettings::default().resolved(&root).unwrap();
        assert_eq!(default.zoom, 1.0);
        assert!(!default.password_autosave_enabled);
        assert_eq!(default.download_directory, root.to_str().unwrap());
        for zoom in [f64::NAN, f64::INFINITY, 0.49, 2.01] {
            assert!(BrowserSettings {
                zoom,
                ..Default::default()
            }
            .resolved(&root)
            .is_err());
        }
        for scheme in ["", "auto", "DARK"] {
            assert!(BrowserSettings {
                color_scheme: scheme.into(),
                ..Default::default()
            }
            .resolved(&root)
            .is_err());
        }
        for path in [
            "relative",
            "C:\\missing-dalizi-test-path-641823\\",
            "C:\\bad\npath",
        ] {
            assert!(BrowserSettings {
                download_directory: path.into(),
                ..Default::default()
            }
            .resolved(&root)
            .is_err());
        }
    }

    #[test]
    fn data_clear_is_scoped_and_does_not_include_passwords_or_profile_settings() {
        let cache = data_kinds(&["cache".into()]).unwrap();
        assert_eq!(cache, COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE);
        let sites = data_kinds(&["cookies".into()]).unwrap();
        assert_eq!(
            sites,
            COREWEBVIEW2_BROWSING_DATA_KINDS_COOKIES
                | COREWEBVIEW2_BROWSING_DATA_KINDS_ALL_DOM_STORAGE
        );
        let all = data_kinds(&["cache".into(), "cookies".into()]).unwrap();
        assert_eq!(all, cache | sites);
        for forbidden in [
            COREWEBVIEW2_BROWSING_DATA_KINDS_PASSWORD_AUTOSAVE,
            COREWEBVIEW2_BROWSING_DATA_KINDS_SETTINGS,
            COREWEBVIEW2_BROWSING_DATA_KINDS_GENERAL_AUTOFILL,
            COREWEBVIEW2_BROWSING_DATA_KINDS_BROWSING_HISTORY,
        ] {
            assert_eq!((all & forbidden).0, 0);
        }
        assert!(data_kinds(&[]).is_err());
        assert!(data_kinds(&["all".into()]).is_err());
        assert!(data_kinds(&["cache".into(), "cache".into()]).is_err());
    }
}
