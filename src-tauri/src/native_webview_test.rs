use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use webview2_com::{CallDevToolsProtocolMethodCompletedHandler, ExecuteScriptCompletedHandler};
use windows_core::HSTRING;
pub async fn script(view: tauri::Webview, source: &str) -> Result<serde_json::Value, String> {
    let source = source.to_string();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let reply = Arc::new(Mutex::new(Some(sender)));
    view.with_webview(move |native| unsafe {
        let done = reply.clone();
        let callback = ExecuteScriptCompletedHandler::create(Box::new(move |result, json| {
            let result = result
                .map_err(|error| error.to_string())
                .and_then(|_| serde_json::from_str(&json).map_err(|error| error.to_string()));
            if let Some(sender) = done.lock().unwrap().take() {
                let _ = sender.send(result);
            }
            Ok(())
        }));
        let result = native
            .controller()
            .CoreWebView2()
            .and_then(|view| view.ExecuteScript(&HSTRING::from(source), &callback));
        if let Err(error) = result {
            if let Some(sender) = reply.lock().unwrap().take() {
                let _ = sender.send(Err(error.to_string()));
            }
        }
    })
    .map_err(|error| error.to_string())?;
    tokio::time::timeout(Duration::from_secs(10), receiver)
        .await
        .map_err(|_| "fixture script timed out")?
        .map_err(|_| "fixture script interrupted")?
}

pub async fn wait_script(
    view: &tauri::Webview,
    source: &str,
    expected: serde_json::Value,
) -> Result<(), String> {
    for _ in 0..100 {
        if script(view.clone(), source).await? == expected {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Err(format!(
        "Fixture assertion timed out: {source}; expected {expected}; actual {}",
        script(view.clone(), source).await?
    ))
}

pub async fn mouse(view: &tauri::Webview, kind: &str, button: &str, x: f64, y: f64) -> Result<(), String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mask = if button == "right" { 2 } else { 1 };
    let data=serde_json::json!({"type":kind,"x":x,"y":y,"button":button,"buttons":if kind=="mousePressed"{mask}else{0},"clickCount":1}).to_string();
    view.with_webview(move |native| unsafe {
        let callback =
            CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |hr, _| {
                let _ = tx.send(hr.map_err(|e| e.to_string()));
                Ok(())
            }));
        let _ = native.controller().CoreWebView2().and_then(|core| {
            core.CallDevToolsProtocolMethod(
                &HSTRING::from("Input.dispatchMouseEvent"),
                &HSTRING::from(data),
                &callback,
            )
        });
    })
    .map_err(|e| e.to_string())?;
    tokio::time::timeout(Duration::from_secs(5), rx)
        .await
        .map_err(|_| "pointer callback timed out")?
        .map_err(|e| e.to_string())?
}
