//! Explicit native check; needs an unlocked Windows desktop + WebView2.
//! Does not load application settings, index disks or start user sessions.
#[path = "../tray.rs"]
mod tray;

use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, WebviewUrl, WebviewWindow};

async fn wait_for(name: &str, mut predicate: impl FnMut() -> bool) -> Result<(), String> {
    for _ in 0..100 {
        if predicate() {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Err(format!("Timed out: {name}"))
}

fn restored(window: &WebviewWindow) -> bool {
    window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(true)
}

async fn check(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("Missing window")?;
    let original_handle = window.hwnd().map_err(|e| e.to_string())?.0 as usize;
    if app.tray_by_id(tray::TRAY_ID).is_none() {
        return Err("Tray resource not retained".into());
    }
    wait_for("Windows notification icon registered", || {
        app.tray_by_id(tray::TRAY_ID)
            .and_then(|icon| icon.rect().ok().flatten())
            .is_some_and(|rect| {
                let size = rect.size.to_physical::<u32>(1.0);
                size.width > 0 && size.height > 0
            })
    })
    .await?;
    // Native minimize events must hide the window without closing the process.
    for cycle in 0..3 {
        tray::show_window(app).map_err(|e| e.to_string())?;
        wait_for("restored", || restored(&window)).await?;
        if cycle == 1 {
            window.maximize().map_err(|e| e.to_string())?;
            wait_for("maximized", || window.is_maximized().unwrap_or(false)).await?;
        }
        window.minimize().map_err(|e| e.to_string())?;
        wait_for("minimize hides to tray", || {
            !window.is_visible().unwrap_or(true)
        })
        .await?;
        if app.get_webview_window("main").is_none() {
            return Err("Minimize destroyed main window".into());
        }
        tray::show_window(app).map_err(|e| e.to_string())?;
        wait_for("restore after minimize", || restored(&window)).await?;
        if cycle == 1 {
            wait_for("restored maximized state", || {
                window.is_maximized().unwrap_or(false)
            })
            .await?;
            window.unmaximize().map_err(|e| e.to_string())?;
            wait_for("unmaximized", || !window.is_maximized().unwrap_or(true)).await?;
        }
        if window.hwnd().map_err(|e| e.to_string())?.0 as usize != original_handle {
            return Err("Main window was recreated".into());
        }
    }
    tray::hide_window(app).map_err(|e| e.to_string())?;
    wait_for("menu hides window", || !window.is_visible().unwrap_or(true)).await?;
    tray::show_window(app).map_err(|e| e.to_string())?;
    wait_for("menu restores window", || restored(&window)).await?;

    // A missing tray must never hide the only recovery surface.
    drop(app.remove_tray_by_id(tray::TRAY_ID));
    tray::hide_window(app).map_err(|e| e.to_string())?;
    if !restored(&window) {
        return Err("Window hidden without a tray".into());
    }
    window.minimize().map_err(|e| e.to_string())?;
    wait_for("ordinary minimize without tray", || {
        window.is_minimized().unwrap_or(false)
    })
    .await?;
    if !window.is_visible().unwrap_or(false) {
        return Err("Minimize event hid window after tray removal".into());
    }
    tray::show_window(app).map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = format!("com.dalizi.tray-smoke-{nonce}");
    for window in &mut context.config_mut().app.windows {
        window.title = "Dalizi Tray Smoke".into();
        window.url = WebviewUrl::External("about:blank".parse().unwrap());
    }
    let app = tauri::Builder::default()
        .setup(|app| {
            tray::install(app.handle())?;
            let app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match tokio::time::timeout(Duration::from_secs(45), check(&app)).await {
                    Ok(Ok(())) => {
                        println!("Tray smoke passed: native notification icon rectangle, retained icon, minimize/hide/restore, maximized restore, window identity, menu action functions and missing-tray fallback.");
                        app.exit(0);
                    }
                    result => {
                        eprintln!("Tray smoke FAILED: {result:?}");
                        app.exit(1);
                    }
                }
            });
            Ok(())
        })
        .build(context)
        .expect("tray smoke application");
    let exited = Arc::new(AtomicBool::new(false));
    let exit_flag = exited.clone();
    let code = app.run_return(move |_, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            exit_flag.store(true, Ordering::SeqCst);
        }
    });
    assert!(
        exited.load(Ordering::SeqCst),
        "Missing normal application exit event"
    );
    std::process::exit(code);
}
