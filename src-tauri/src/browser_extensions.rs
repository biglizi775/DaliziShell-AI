//! WebView2 objects never leave their UI thread; only owned data crosses IPC.
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{Webview, Wry};
use tokio::sync::oneshot;
use webview2_com::{
    take_pwstr, BrowserExtensionEnableCompletedHandler, BrowserExtensionRemoveCompletedHandler,
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2BrowserExtension, ICoreWebView2BrowserExtensionList, ICoreWebView2Profile7,
        ICoreWebView2_13,
    },
    ProfileAddBrowserExtensionCompletedHandler, ProfileGetBrowserExtensionsCompletedHandler,
};
use windows_core::{Interface, BOOL, HSTRING, PWSTR};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserExtension {
    pub id: String,
    pub name: String,
    pub enabled: bool,
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
    format!("WebView2 扩展操作失败 / Extension operation failed: {error}")
}

async fn with_profile<T, F>(webview: Webview<Wry>, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(ICoreWebView2Profile7, Reply<T>) -> Result<(), String> + Send + 'static,
{
    let (sender, receiver) = oneshot::channel();
    let reply = Arc::new(Mutex::new(Some(sender)));
    webview.with_webview(move |native| {
        // SAFETY: with_webview dispatches to the WebView2 UI apartment. The
        // callback interface and all COM reads remain in that same apartment.
        let profile = unsafe {
            native.controller().CoreWebView2().and_then(|view| view.cast::<ICoreWebView2_13>())
                .and_then(|view| view.Profile()).and_then(|profile| profile.cast::<ICoreWebView2Profile7>())
        };
        match profile {
            Ok(profile) => { if let Err(error) = operation(profile, reply.clone()) { finish(&reply, Err(error)); } },
            Err(error) => finish(&reply, Err(format!("当前 WebView2 运行时无法管理扩展，请更新 Microsoft Edge WebView2 Runtime 后重试 / Extension APIs unavailable: {error}"))),
        }
    }).map_err(|e| e.to_string())?;
    // Never block the UI while waiting for COM completion. A timeout does not
    // imply rollback: callers should refresh the actual runtime state.
    tokio::time::timeout(Duration::from_secs(30), receiver)
        .await
        .map_err(|_| {
            "扩展操作超时，请刷新列表确认当前状态 / Extension operation timed out; refresh the list"
                .to_string()
        })?
        .map_err(|_| {
            "浏览器已关闭或扩展操作中断 / Browser closed or extension operation interrupted"
                .to_string()
        })?
}

unsafe fn info(extension: &ICoreWebView2BrowserExtension) -> Result<BrowserExtension, String> {
    let mut id = PWSTR::null();
    let id_result = extension.Id(&mut id);
    let id = take_pwstr(id);
    id_result.map_err(native_error)?;
    let mut name = PWSTR::null();
    let name_result = extension.Name(&mut name);
    let name = take_pwstr(name);
    name_result.map_err(native_error)?;
    let mut enabled = BOOL::default();
    extension.IsEnabled(&mut enabled).map_err(native_error)?;
    Ok(BrowserExtension {
        id,
        name,
        enabled: enabled.as_bool(),
    })
}

fn get_extensions(
    profile: &ICoreWebView2Profile7,
    completed: impl FnOnce(Result<ICoreWebView2BrowserExtensionList, String>) + 'static,
) -> Result<(), String> {
    let callback =
        ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(move |result, list| {
            completed(
                result
                    .map_err(native_error)
                    .and_then(|_| list.ok_or_else(|| "WebView2 returned no extension list".into())),
            );
            Ok(())
        }));
    unsafe {
        profile
            .GetBrowserExtensions(&callback)
            .map_err(native_error)
    }
}

pub async fn list(webview: Webview<Wry>) -> Result<Vec<BrowserExtension>, String> {
    with_profile(webview, |profile, reply| {
        get_extensions(&profile, move |result| {
            let result = result.and_then(|list| unsafe {
                let mut count = 0;
                list.Count(&mut count).map_err(native_error)?;
                let mut items = Vec::new();
                for index in 0..count {
                    items.push(info(&list.GetValueAtIndex(index).map_err(native_error)?)?);
                }
                items.sort_by(|a, b| {
                    a.name
                        .to_lowercase()
                        .cmp(&b.name.to_lowercase())
                        .then(a.id.cmp(&b.id))
                });
                Ok(items)
            });
            finish(&reply, result);
        })
    })
    .await
}

fn valid_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| (b'a'..=b'p').contains(&b))
}

async fn modify(webview: Webview<Wry>, id: String, enabled: Option<bool>) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("扩展 ID 无效 / Invalid extension ID".into());
    }
    with_profile(webview, move |profile, reply| {
        get_extensions(&profile, move |result| {
            let result = result.and_then(|list| unsafe {
                let mut count = 0;
                list.Count(&mut count).map_err(native_error)?;
                for index in 0..count {
                    let extension = list.GetValueAtIndex(index).map_err(native_error)?;
                    if info(&extension)?.id != id {
                        continue;
                    }
                    let completion_reply = reply.clone();
                    return match enabled {
                        Some(enabled) => {
                            let callback = BrowserExtensionEnableCompletedHandler::create(
                                Box::new(move |result| {
                                    finish(&completion_reply, result.map_err(native_error));
                                    Ok(())
                                }),
                            );
                            extension.Enable(enabled, &callback).map_err(native_error)
                        }
                        None => {
                            let callback = BrowserExtensionRemoveCompletedHandler::create(
                                Box::new(move |result| {
                                    finish(&completion_reply, result.map_err(native_error));
                                    Ok(())
                                }),
                            );
                            extension.Remove(&callback).map_err(native_error)
                        }
                    };
                }
                Err(
                    "扩展已被移除，请刷新列表 / Extension no longer exists; refresh the list"
                        .into(),
                )
            });
            if let Err(error) = result {
                finish(&reply, Err(error));
            }
        })
    })
    .await
}

pub async fn set_enabled(webview: Webview<Wry>, id: String, enabled: bool) -> Result<(), String> {
    modify(webview, id, Some(enabled)).await
}
pub async fn remove(webview: Webview<Wry>, id: String) -> Result<(), String> {
    modify(webview, id, None).await
}

fn validate_manifest(path: &std::path::Path) -> Result<(), String> {
    let manifest = path.join("manifest.json");
    let metadata = std::fs::symlink_metadata(&manifest).map_err(|_| {
        "目录需要包含 manifest.json / Folder must contain manifest.json".to_string()
    })?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 1024 * 1024 {
        return Err("manifest.json 必须是小于 1 MB 的普通文件 / Invalid extension manifest".into());
    }
    let data = std::fs::read(&manifest).map_err(|e| e.to_string())?;
    let manifest: serde_json::Value = serde_json::from_slice(&data)
        .map_err(|_| "manifest.json 不是有效 JSON / Invalid manifest JSON".to_string())?;
    if !matches!(manifest["manifest_version"].as_u64(), Some(2 | 3))
        || manifest["name"]
            .as_str()
            .map_or(true, |v| v.trim().is_empty())
        || manifest["version"]
            .as_str()
            .map_or(true, |v| v.trim().is_empty())
    {
        return Err(
            "扩展清单需要 manifest_version、name 和 version / Missing extension manifest fields"
                .into(),
        );
    }
    Ok(())
}

pub async fn install(webview: Webview<Wry>, path: PathBuf) -> Result<BrowserExtension, String> {
    validate_manifest(&path)?;
    let path = path.to_string_lossy().into_owned();
    with_profile(webview, move |profile, reply| {
        let callback = ProfileAddBrowserExtensionCompletedHandler::create(Box::new(
            move |result, extension| {
                let result = result
                    .map_err(native_error)
                    .and_then(|_| {
                        extension.ok_or_else(|| "WebView2 returned no installed extension".into())
                    })
                    .and_then(|extension| unsafe { info(&extension) });
                finish(&reply, result);
                Ok(())
            },
        ));
        unsafe {
            profile
                .AddBrowserExtension(&HSTRING::from(path), &callback)
                .map_err(native_error)
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mutation_requires_real_chromium_extension_id() {
        assert!(valid_id("abcdefghijklmnopabcdefghijklmnop"));
        for id in [
            "",
            "abc",
            "../test",
            "ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP",
            "abcdefghijklmnopabcdefghijklmnoq",
        ] {
            assert!(!valid_id(id));
        }
    }
    #[test]
    fn install_requires_manifest_and_well_formed_fields() {
        let dir = std::env::temp_dir().join(format!(
            "dalizi-extension-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&dir).unwrap();
        assert!(validate_manifest(&dir).is_err());
        for invalid in ["not json", "{}", r#"{"manifest_version":3,"name":"demo"}"#] {
            std::fs::write(dir.join("manifest.json"), invalid).unwrap();
            assert!(validate_manifest(&dir).is_err());
        }
        std::fs::write(
            dir.join("manifest.json"),
            r#"{"manifest_version":3,"name":"demo","version":"1.0"}"#,
        )
        .unwrap();
        assert!(validate_manifest(&dir).is_ok());
        std::fs::remove_file(dir.join("manifest.json")).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
}
