//! The download dialog belongs to the selected WebView2 instance. Its
//! contents/history and download controls are provided by the runtime.
use std::time::Duration;
use tauri::{Webview, Wry};
use tokio::sync::oneshot;
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_9;
use windows_core::{Interface, BOOL};

async fn dialog(webview: Webview<Wry>, requested: Option<bool>) -> Result<bool, String> {
    let (sender, receiver) = oneshot::channel();
    webview.with_webview(move |native| {
        // A queued operation must not open a dialog after the caller timed out.
        if sender.is_closed() { return; }
        // All COM calls run on WebView2's UI apartment. Only the boolean
        // result crosses back to the asynchronous command.
        let result = (|| unsafe {
            let view = native.controller().CoreWebView2()
                .map_err(|error| format!("浏览器已关闭或不可用 / Browser unavailable: {error}"))?
                .cast::<ICoreWebView2_9>()
                .map_err(|error| format!("当前 WebView2 不支持下载面板，请更新 Microsoft Edge WebView2 Runtime（需要 1.0.1072.54 或更新版本）/ Native download dialog unavailable: {error}"))?;
            if let Some(open) = requested {
                let result = if open { view.OpenDefaultDownloadDialog() } else { view.CloseDefaultDownloadDialog() };
                result.map_err(|error| format!("下载面板操作失败 / Download dialog operation failed: {error}"))?;
            }
            let mut open = BOOL::default();
            view.IsDefaultDownloadDialogOpen(&mut open)
                .map_err(|error| format!("无法读取下载面板状态 / Download dialog state unavailable: {error}"))?;
            Ok(open.as_bool())
        })();
        let _ = sender.send(result);
    }).map_err(|error| error.to_string())?;
    tokio::time::timeout(Duration::from_secs(10), receiver)
        .await
        .map_err(|_| "下载面板操作超时，请重试 / Download dialog operation timed out".to_string())?
        .map_err(|_| {
            "浏览器已关闭或下载面板操作中断 / Browser closed or download dialog interrupted"
                .to_string()
        })?
}

pub async fn set_open(webview: Webview<Wry>, open: bool) -> Result<(), String> {
    let mut actual = dialog(webview.clone(), Some(open)).await?;
    // WebView2 accepts the request synchronously but updates its dialog state
    // on later UI messages. Await that transition without blocking the UI.
    for _ in 0..100 {
        if actual == open {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
        actual = dialog(webview.clone(), None).await?;
    }
    Err(format!(
        "下载面板状态尚未生效，请重试 / Native download dialog did not reach requested open={open}"
    ))
}

/// Used by the isolated native smoke test; not registered as an IPC command.
#[allow(dead_code)]
pub async fn is_open(webview: Webview<Wry>) -> Result<bool, String> {
    dialog(webview, None).await
}
