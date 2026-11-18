//! Native WebView2 integration check. Uses a new isolated profile, a hidden
//! window and an ephemeral loopback HTTP fixture; no external websites.
#![allow(dead_code)]
#[path = "../browser.rs"]
mod browser;

use std::{
    io::{Read, Write},
    net::TcpListener,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Listener, Manager, WebviewUrl};

const DOWNLOAD_NAME: &str = "dalizi-native-download.txt";
const DOWNLOAD_BODY: &str = "Dalizi isolated native WebView2 download fixture.\n";

struct FixtureServer {
    url: String,
    cache_hits: Arc<AtomicUsize>,
    stop: Arc<AtomicBool>,
}
impl FixtureServer {
    fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("loopback fixture server");
        let url = format!("http://{}/", listener.local_addr().unwrap());
        listener.set_nonblocking(true).unwrap();
        let cache_hits = Arc::new(AtomicUsize::new(0));
        let stop = Arc::new(AtomicBool::new(false));
        let hits = cache_hits.clone();
        let done = stop.clone();
        std::thread::spawn(move || {
            while !done.load(Ordering::Relaxed) {
                let Ok((mut stream, _)) = listener.accept() else {
                    std::thread::sleep(Duration::from_millis(10));
                    continue;
                };
                let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                let mut buffer = [0; 8192];
                let Ok(length) = stream.read(&mut buffer) else {
                    continue;
                };
                let request = String::from_utf8_lossy(&buffer[..length]);
                if request.starts_with("GET /download.txt ") {
                    let response = format!("HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=\"{DOWNLOAD_NAME}\"\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{DOWNLOAD_BODY}", DOWNLOAD_BODY.len());
                    let _ = stream.write_all(response.as_bytes());
                    continue;
                }
                let cached = request.starts_with("GET /cached ");
                let (body, cache) = if request.starts_with("POST /authorize ") {
                    ("<title>posted-login</title><script>opener.postMessage('signed-in', location.origin)</script>", "no-store")
                } else if cached {
                    hits.fetch_add(1, Ordering::SeqCst);
                    ("cached native smoke response", "public, max-age=3600")
                } else {
                    ("<!doctype html><title>fixture-initial</title><body><script>document.title='script-ran';</script></body>", "no-store")
                };
                let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nCache-Control: {cache}\r\nConnection: close\r\n\r\n{body}", body.len());
                let _ = stream.write_all(response.as_bytes());
            }
        });
        Self {
            url,
            cache_hits,
            stop,
        }
    }
}
impl Drop for FixtureServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

#[path="../native_webview_test.rs"]
mod native_webview_test;
use native_webview_test::{script,wait_script};

fn browser_view(app: &tauri::AppHandle, key: &str) -> tauri::Webview {
    app.state::<browser::BrowserState>()
        .0
        .lock()
        .unwrap()
        .get(key)
        .unwrap()
        .clone()
}

async fn set_native_zoom(view: tauri::Webview, zoom: f64) -> Result<(), String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    view.with_webview(move |native| {
        let result =
            unsafe { native.controller().SetZoomFactor(zoom) }.map_err(|error| error.to_string());
        let _ = sender.send(result);
    })
    .map_err(|error| error.to_string())?;
    tokio::time::timeout(Duration::from_secs(10), receiver)
        .await
        .map_err(|_| "Native zoom fixture timed out")?
        .map_err(|_| "Native zoom fixture interrupted")?
}

async fn tab(
    app: &tauri::AppHandle,
    key: &str,
    url: &str,
    settings: Option<browser::BrowserSettings>,
) -> Result<(), String> {
    browser::browser_create(
        app.clone(),
        app.state(),
        key.into(),
        url.into(),
        browser::BrowserBounds {
            x: 0.0,
            y: 0.0,
            width: 640.0,
            height: 480.0,
        },
        None,
        settings,
    )
    .await
}

async fn native_visible(view: tauri::Webview) -> Result<bool, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    view.with_webview(move |native| {
        let mut visible = windows_core::BOOL(0);
        let result = unsafe { native.controller().IsVisible(&mut visible) }
            .map(|_| visible.0 != 0)
            .map_err(|error| error.to_string());
        let _ = sender.send(result);
    })
    .map_err(|error| error.to_string())?;
    tokio::time::timeout(Duration::from_secs(10), receiver)
        .await
        .map_err(|_| "Visibility check timed out")?
        .map_err(|_| "Visibility check interrupted")?
}

async fn layout_check(app: &tauri::AppHandle, server: &FixtureServer) -> Result<(), String> {
    tab(app, "layout-one", &server.url, None).await?;
    let one = browser_view(app, "layout-one");
    if native_visible(one.clone()).await? {
        return Err("Unactivated tab was visible".into());
    }
    let bounds = || browser::BrowserBounds {
        x: 40.0,
        y: 60.0,
        width: 720.0,
        height: 480.0,
    };
    browser::browser_set_active(app.state(), "layout-one".into(), true, bounds())?;
    if !native_visible(one.clone()).await? {
        return Err("Active tab was hidden".into());
    }
    let size = one.size().map_err(|error| error.to_string())?;
    let position = one.position().map_err(|error| error.to_string())?;
    let scale = app
        .get_window("main")
        .ok_or("Missing main window")?
        .scale_factor()
        .map_err(|error| error.to_string())?;
    let logical = size.to_logical::<f64>(scale);
    let origin = position.to_logical::<f64>(scale);
    if (logical.width - 720.0).abs() > 1.0
        || (logical.height - 480.0).abs() > 1.0
        || (origin.x - 40.0).abs() > 1.0
        || (origin.y - 60.0).abs() > 1.0
    {
        return Err(format!("Native bounds mismatch: {logical:?} {origin:?}"));
    }
    tab(app, "layout-two", &server.url, None).await?;
    let two = browser_view(app, "layout-two");
    if native_visible(two.clone()).await? || !native_visible(one.clone()).await? {
        return Err("A newly created tab disturbed the active surface".into());
    }
    wait_script(&one, "document.readyState", serde_json::json!("complete")).await?;
    script(one.clone(), "window.layoutMarker = 'retained'").await?;
    browser::browser_set_active(
        app.state(),
        "layout-one".into(),
        false,
        browser::BrowserBounds {
            x: 0.0,
            y: 0.0,
            width: 1.0,
            height: 1.0,
        },
    )?;
    if one.size().map_err(|error| error.to_string())? != size {
        return Err("Hiding a tab changed its viewport".into());
    }
    for _ in 0..12 {
        browser::browser_set_active(app.state(), "layout-two".into(), true, bounds())?;
        browser::browser_set_active(app.state(), "layout-two".into(), false, bounds())?;
        browser::browser_set_active(app.state(), "layout-one".into(), true, bounds())?;
        browser::browser_set_active(app.state(), "layout-one".into(), false, bounds())?;
    }
    browser::browser_set_active(app.state(), "layout-one".into(), true, bounds())?;
    if !native_visible(one.clone()).await? || native_visible(two.clone()).await? {
        return Err("Final tab visibility mismatch".into());
    }
    if script(one, "window.layoutMarker").await? != serde_json::json!("retained") {
        return Err("Visibility changes reloaded the page".into());
    }
    browser::browser_close(app.state(), "layout-one".into())?;
    browser::browser_close(app.state(), "layout-two".into())?;
    println!("Native browser layout passed: hidden creation, atomic geometry, inactive viewport preservation, 12 switch cycles, page identity retained.");
    Ok(())
}

async fn settings_check(
    app: &tauri::AppHandle,
    fixture: &std::path::Path,
    server: &FixtureServer,
) -> Result<(), String> {
    let initial = browser::BrowserSettings {
        zoom: 1.25,
        javascript_enabled: false,
        context_menus_enabled: false,
        dev_tools_enabled: false,
        autofill_enabled: false,
        password_autosave_enabled: false,
        color_scheme: "dark".into(),
        download_directory: fixture.to_string_lossy().into(),
    };
    // Applying while there are no tabs validates and caches settings.
    browser::browser_settings_apply(app.clone(), app.state(), initial.clone()).await?;
    tab(app, "settings-first", &server.url, None).await?;
    tab(app, "settings-second", &server.url, Some(initial.clone())).await?;
    for key in ["settings-first", "settings-second"] {
        let actual = browser::browser_settings_get(app.state(), key.into()).await?;
        if actual != initial {
            return Err(format!(
                "Initial native settings mismatch on {key}: {actual:?}"
            ));
        }
        let view = browser_view(app, key);
        wait_script(&view, "document.readyState", serde_json::json!("complete")).await?;
        wait_script(
            &view,
            "document.title",
            serde_json::json!("fixture-initial"),
        )
        .await?;
    }
    // Invalid settings must leave existing native values untouched.
    let invalid = browser::BrowserSettings {
        zoom: 3.0,
        ..initial.clone()
    };
    if browser::browser_settings_apply(app.clone(), app.state(), invalid)
        .await
        .is_ok()
    {
        return Err("Invalid settings unexpectedly accepted".into());
    }
    if browser::browser_settings_get(app.state(), "settings-first".into()).await? != initial {
        return Err("Invalid settings changed native state".into());
    }
    let updated = browser::BrowserSettings {
        zoom: 0.9,
        javascript_enabled: true,
        context_menus_enabled: true,
        dev_tools_enabled: true,
        autofill_enabled: true,
        password_autosave_enabled: true,
        color_scheme: "light".into(),
        download_directory: fixture.to_string_lossy().into(),
    };
    browser::browser_settings_apply(app.clone(), app.state(), updated.clone()).await?;
    tab(app, "settings-new", &server.url, None).await?;
    tab(app, "settings-stale", &server.url, Some(initial.clone())).await?;
    for key in [
        "settings-first",
        "settings-second",
        "settings-new",
        "settings-stale",
    ] {
        let actual = browser::browser_settings_get(app.state(), key.into()).await?;
        if actual != updated {
            return Err(format!(
                "Updated native settings mismatch on {key}: {actual:?}"
            ));
        }
    }
    // Tauri normally pushes its window theme into every child profile. The
    // browser's explicit preference must survive a later window theme event.
    let window = app.get_window("main").ok_or("Main window missing")?;
    window
        .set_theme(Some(tauri::Theme::Light))
        .map_err(|error| error.to_string())?;
    tokio::time::sleep(Duration::from_millis(150)).await;
    window
        .set_theme(Some(tauri::Theme::Dark))
        .map_err(|error| error.to_string())?;
    tokio::time::sleep(Duration::from_millis(150)).await;
    for key in ["settings-first", "settings-new"] {
        // Theme events restore several native environments asynchronously.
        // Wait for convergence instead of assuming a 150 ms scheduler budget.
        for attempt in 0..60 {
            let actual = browser::browser_settings_get(app.state(), key.into()).await?;
            if actual == updated {
                break;
            }
            if attempt == 59 {
                return Err(format!(
                    "Window theme replaced browser settings on {key}: {actual:?}"
                ));
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
    set_native_zoom(browser_view(app, "settings-first"), 1.6).await?;
    tab(app, "settings-zoom-new", &server.url, None).await?;
    let preserved = browser::browser_settings_get(app.state(), "settings-first".into()).await?;
    if preserved
        != (browser::BrowserSettings {
            zoom: 1.6,
            ..updated.clone()
        })
    {
        return Err(format!(
            "New tab changed an existing tab's manual zoom: {preserved:?}"
        ));
    }
    if browser::browser_settings_get(app.state(), "settings-zoom-new".into()).await? != updated {
        return Err("New tab did not use the configured default zoom".into());
    }
    let view = browser_view(app, "settings-new");
    wait_script(&view, "document.title", serde_json::json!("script-ran")).await?;
    // Native navigation controls still operate with website JavaScript disabled.
    browser::browser_settings_apply(app.clone(), app.state(), initial.clone()).await?;
    browser::browser_action(app.state(), "settings-new".into(), "reload".into()).await?;
    wait_script(
        &view,
        "document.title",
        serde_json::json!("fixture-initial"),
    )
    .await?;
    browser::browser_settings_apply(app.clone(), app.state(), updated).await?;

    let main = app.get_webview("main").ok_or("Main view missing")?;
    main.navigate(server.url.parse().unwrap())
        .map_err(|error| error.to_string())?;
    wait_script(&main, "document.title", serde_json::json!("script-ran")).await?;
    script(
        main.clone(),
        "localStorage.setItem('mainOnly','preserved');document.cookie='mainSmoke=1;path=/';true",
    )
    .await?;
    script(view.clone(), "localStorage.setItem('browserOnly','present');document.cookie='browserSmoke=1;path=/';true").await?;
    if script(view.clone(), "localStorage.getItem('mainOnly')").await? != serde_json::Value::Null {
        return Err("Browser shared the main application's profile".into());
    }
    async fn fetch_cached(view: &tauri::Webview) -> Result<(), String> {
        script(view.clone(), "document.body.dataset.fetched='';fetch('/cached',{cache:'force-cache'}).then(r=>r.text()).then(t=>document.body.dataset.fetched=t)").await?;
        wait_script(
            view,
            "document.body.dataset.fetched",
            serde_json::json!("cached native smoke response"),
        )
        .await
    }
    fetch_cached(&view).await?;
    fetch_cached(&view).await?;
    if server.cache_hits.load(Ordering::SeqCst) != 1 {
        return Err("Fixture response was not cached".into());
    }
    let runtime = browser::browser_runtime_info(app.state(), "settings-first".into()).await?;
    let clears_cache = !runtime.version.starts_with("109.");
    let cache_clear =
        browser::browser_clear_data(app.state(), "settings-first".into(), vec!["cache".into()]).await;
    if clears_cache {
        cache_clear.map_err(|error| format!("Clear disk cache: {error}"))?;
        fetch_cached(&view).await?;
        if server.cache_hits.load(Ordering::SeqCst) != 2 {
            return Err("Native disk cache was not cleared".into());
        }
    } else if !cache_clear.is_err_and(|error| error.contains(&runtime.version)) {
        return Err("Old WebView2 accepted a disk cache clear that stalls".into());
    }
    if script(view.clone(), "document.cookie.includes('browserSmoke=1') && localStorage.getItem('browserOnly')==='present'").await? != serde_json::json!(true) {
        return Err("Cache-only clear removed cookies or localStorage".into());
    }
    browser::browser_clear_data(
        app.state(),
        "settings-second".into(),
        vec!["cookies".into()],
    )
    .await.map_err(|error| format!("Clear site data: {error}"))?;
    if script(
        view.clone(),
        "document.cookie==='' && localStorage.getItem('browserOnly')===null",
    )
    .await?
        != serde_json::json!(true)
    {
        return Err("Cookie/site-data clear did not affect shared browser profile".into());
    }
    if script(
        main,
        "document.cookie.includes('mainSmoke=1') && localStorage.getItem('mainOnly')==='preserved'",
    )
    .await?
        != serde_json::json!(true)
    {
        return Err("Browser clear changed main application storage".into());
    }
    if browser::browser_clear_data(app.state(), "settings-new".into(), vec!["passwords".into()])
        .await
        .is_ok()
    {
        return Err("Unsupported data clear kind accepted".into());
    }
    let mut kinds = vec!["cookies".to_string()];
    if clears_cache {
        kinds.insert(0, "cache".into());
    }
    browser::browser_clear_data(app.state(), "settings-new".into(), kinds)
        .await.map_err(|error| format!("Clear cache and site data: {error}"))?;
    // Default download path and automatic theme must also reach native state.
    browser::browser_settings_apply(
        app.clone(),
        app.state(),
        browser::BrowserSettings::default(),
    )
    .await?;
    let defaults = browser::browser_settings_get(app.state(), "settings-first".into()).await?;
    if defaults.color_scheme != "system"
        || defaults.download_directory
            != app
                .path()
                .download_dir()
                .map_err(|e| e.to_string())?
                .to_string_lossy()
    {
        return Err(format!("Default path/theme did not reset: {defaults:?}"));
    }
    Ok(())
}

async fn downloads_check(
    app: &tauri::AppHandle,
    fixture: &std::path::Path,
    server: &FixtureServer,
) -> Result<(), String> {
    // Override the directory before any download navigation. This path belongs
    // exclusively to the generated fixture, never the user's Downloads folder.
    browser::browser_settings_apply(
        app.clone(),
        app.state(),
        browser::BrowserSettings {
            download_directory: fixture.to_string_lossy().into(),
            ..Default::default()
        },
    )
    .await?;
    tab(app, "download-first", &server.url, None).await?;
    tab(app, "download-second", "about:blank", None).await?;
    let first = browser_view(app, "download-first");
    let second = browser_view(app, "download-second");
    browser::downloads::set_open(first.clone(), false).await?;
    browser::downloads::set_open(second.clone(), false).await?;
    browser::browser_downloads_show(app.state(), "download-first".into()).await?;
    if !browser::downloads::is_open(first.clone()).await?
        || browser::downloads::is_open(second.clone()).await?
    {
        return Err("Opening a download panel did not target only the requested tab".into());
    }
    browser::downloads::set_open(first.clone(), false).await?;
    if browser::downloads::is_open(first.clone()).await? {
        return Err("Native download panel did not close".into());
    }
    browser::browser_navigate(
        app.state(),
        "download-first".into(),
        format!("{}download.txt", server.url),
    )?;
    let target = fixture.join(DOWNLOAD_NAME);
    let mut downloaded = false;
    for _ in 0..300 {
        if std::fs::read(&target).ok().as_deref() == Some(DOWNLOAD_BODY.as_bytes()) {
            downloaded = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    if !downloaded {
        return Err(format!(
            "Native download was not written to the configured fixture directory: {}",
            target.display()
        ));
    }
    browser::downloads::set_open(first.clone(), false).await?;
    browser::browser_downloads_show(app.state(), "download-first".into()).await?;
    if !browser::downloads::is_open(first.clone()).await? {
        return Err("Native panel did not open after a completed download".into());
    }
    browser::downloads::set_open(first.clone(), false).await?;
    if browser::downloads::is_open(first).await? {
        return Err("Native panel did not close after download".into());
    }
    if browser::browser_downloads_show(app.state(), "../invalid".into())
        .await
        .is_ok()
        || browser::browser_downloads_show(app.state(), "missing-tab".into())
            .await
            .is_ok()
    {
        return Err("Download panel accepted an invalid or missing tab".into());
    }
    Ok(())
}

async fn popup_check(app: &tauri::AppHandle, server: &FixtureServer) -> Result<(), String> {
    tab(app, "login", &server.url, None).await?;
    let parent = browser_view(app, "login");
    wait_script(&parent, "document.title", serde_json::json!("script-ran")).await?;
    let main = app.get_webview("main").unwrap();
    let (tx, mut requests) = tokio::sync::mpsc::unbounded_channel();
    let listener = main.listen("browser-page", move |event| {
        let payload: serde_json::Value = serde_json::from_str(event.payload()).unwrap();
        if payload["phase"] == "new-window" {
            let _ = tx.send(payload);
        }
    });
    let (closed, mut closes) = tokio::sync::mpsc::unbounded_channel();
    let close_listener = main.listen("browser-popup-close", move |event| {
        let _ = closed.send(serde_json::from_str::<String>(event.payload()).unwrap());
    });
    for (scenario, source, title) in [
        ("link", "let a=document.createElement('a');a.href='/linked';a.target='_blank';a.click()", "script-ran"),
        ("delayed URL", "window.loginPopup=window.open('','device-test');setTimeout(()=>loginPopup.location.href='/device',50)", "script-ran"),
        ("form POST", "onmessage=e=>document.title=e.data;let f=document.createElement('form');f.method='POST';f.target='_blank';f.rel='opener';f.action='/authorize';document.body.append(f);f.submit()", "posted-login"),
    ] {
        parent.eval(source).map_err(|error| error.to_string())?;
        let request = tokio::time::timeout(Duration::from_secs(8), requests.recv()).await
            .map_err(|_| format!("No native popup request for {scenario}"))?.ok_or("Popup listener closed")?;
        let key = request["popupKey"].as_str().ok_or("Popup has no native target")?;
        tab(app, key, request["url"].as_str().unwrap(), None).await?;
        let popup = browser_view(app, key);
        wait_script(&popup, "document.title", serde_json::json!(title)).await?;
        if source.contains("device-test") {
            wait_script(&popup, "location.pathname", serde_json::json!("/device")).await?;
        }
        if title == "posted-login" {
            wait_script(&parent, "document.title", serde_json::json!("signed-in")).await?;
            popup.eval("window.close()").map_err(|error| error.to_string())?;
            let closed = tokio::time::timeout(Duration::from_secs(5), closes.recv()).await.map_err(|_| "No popup close event")?;
            if closed.as_deref() != Some(key) { return Err("Wrong popup closed".into()); }
        }
        browser::browser_close(app.state(), key.into())?;
    }
    parent
        .eval("window.open('/blocked','_blank')")
        .map_err(|error| error.to_string())?;
    let blocked = tokio::time::timeout(Duration::from_secs(5), requests.recv())
        .await
        .map_err(|_| "Missing popup to dismiss")?
        .ok_or("Popup listener closed")?;
    let blocked_key = blocked["popupKey"]
        .as_str()
        .ok_or("Missing key to dismiss")?;
    browser::browser_popup_dismiss(app.clone(), blocked_key.into())?;
    if tab(app, blocked_key, &server.url, None).await.is_ok() {
        return Err("Dismissed popup could still be opened".into());
    }
    parent
        .eval("location.href='microsoft-edge:'+location.origin+'/wrapped'")
        .map_err(|error| error.to_string())?;
    let wrapped = tokio::time::timeout(Duration::from_secs(5), requests.recv())
        .await
        .map_err(|_| "Explicit Edge link was not routed back")?
        .ok_or("Popup listener closed")?;
    if wrapped["url"] != format!("{}wrapped", server.url) || !wrapped["popupKey"].is_null() {
        return Err("Explicit Edge link lost its web destination".into());
    }
    main.unlisten(listener);
    main.unlisten(close_listener);
    browser::browser_close(app.state(), "login".into())?;
    println!("Native popup tests passed: target=_blank, delayed blank-window navigation, POST, postMessage, window.close.");
    Ok(())
}

async fn check(app: &tauri::AppHandle, fixture: &std::path::Path) -> Result<(), String> {
    let server = FixtureServer::start();
    if std::env::args().any(|arg| arg == "--popups-only") {
        return popup_check(app, &server).await;
    }
    layout_check(app, &server).await?;
    settings_check(app, fixture, &server).await.map_err(|error| format!("Settings check: {error}"))?;
    downloads_check(app, fixture, &server).await.map_err(|error| format!("Downloads check: {error}"))?;
    println!("Native settings, data clearing and downloads passed.");
    popup_check(app, &server).await?;
    tab(app, "first", "about:blank", None).await?;
    let info = browser::browser_runtime_info(app.state(), "first".into()).await?;
    println!("WebView2 {}, extension support: {}", info.version, info.extensions_supported);
    if let Ok(expected) = std::env::var("DALIZI_EXPECT_WEBVIEW2") {
        if info.version != expected { return Err(format!("Expected WebView2 {expected}, got {}",info.version)); }
    }
    if std::env::args().any(|arg| arg == "--without-extensions") {
        if info.extensions_supported { return Err("Expected a runtime without extension management".into()); }
        let error = browser::browser_extensions_list(app.state(), "first".into()).await.unwrap_err();
        if !error.contains("Extension APIs unavailable") { return Err(error); }
        browser::browser_navigate(app.state(), "first".into(), server.url.clone())?;
        wait_script(&browser_view(app, "first"), "document.title", serde_json::json!("script-ran")).await?;
        println!("Extension management unavailable; navigation in the same tab passed.");
        return Ok(());
    }
    if !info.extensions_supported { return Err("Expected a runtime with extension support".into()); }
    // WebView2 supplies built-in PDF/clipboard extensions even in a new profile.
    let baseline = browser::browser_extensions_list(app.state(), "first".into()).await?;
    let installed = browser::browser_extension_install(
        app.state(),
        "first".into(),
        fixture.to_string_lossy().into(),
    )
    .await?;
    if installed.name != "Dalizi isolated extension fixture" || !installed.enabled {
        return Err("Fixture not installed/enabled".into());
    }
    tab(app, "second", "about:blank", None).await?;
    let second = browser::browser_extensions_list(app.state(), "second".into()).await?;
    if second.len() != baseline.len() + 1 || !second.iter().any(|item| item.id == installed.id) {
        return Err("Browser tabs did not share extension profile".into());
    }
    browser::browser_extension_set_enabled(
        app.state(),
        "first".into(),
        installed.id.clone(),
        false,
    )
    .await?;
    let disabled = browser::browser_extensions_list(app.state(), "second".into()).await?;
    if !disabled
        .iter()
        .any(|item| item.id == installed.id && !item.enabled)
    {
        return Err("Disabling extension did not affect shared profile".into());
    }
    browser::browser_close(app.state(), "first".into())?;
    tab(app, "third", "about:blank", None).await?;
    let reopened = browser::browser_extensions_list(app.state(), "third".into()).await?;
    if !reopened
        .iter()
        .any(|item| item.id == installed.id && !item.enabled)
    {
        return Err("New tab reset disabled extension".into());
    }
    browser::browser_extension_set_enabled(app.state(), "third".into(), installed.id.clone(), true)
        .await?;
    let enabled = browser::browser_extensions_list(app.state(), "second".into()).await?;
    if !enabled
        .iter()
        .any(|item| item.id == installed.id && item.enabled)
    {
        return Err("Enabling extension did not affect shared profile".into());
    }
    browser::browser_extension_remove(app.state(), "third".into(), installed.id.clone()).await?;
    if browser::browser_extensions_list(app.state(), "second".into())
        .await?
        .iter()
        .any(|item| item.id == installed.id)
    {
        return Err("Extension removal did not complete".into());
    }
    tab(app, "fourth", "about:blank", None).await?;
    if browser::browser_extensions_list(app.state(), "fourth".into())
        .await?
        .iter()
        .any(|item| item.id == installed.id)
    {
        return Err("New tab reinstalled removed extension".into());
    }
    Ok(())
}

fn main() {
    let nonce = format!(
        "{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    let fixture = std::env::temp_dir().join(format!("dalizi-browser-smoke-{nonce}"));
    std::fs::create_dir(&fixture).expect("fixture directory");
    std::fs::write(fixture.join("manifest.json"), r#"{"manifest_version":3,"name":"Dalizi isolated extension fixture","version":"1.0.0","description":"Offline native integration fixture; no permissions or scripts"}"#).expect("fixture manifest");
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = format!("com.dalizi.browser-smoke-{nonce}");
    for window in &mut context.config_mut().app.windows {
        window.visible = false;
        window.url = WebviewUrl::External("about:blank".parse().unwrap());
    }
    let profile_path: Arc<Mutex<Option<PathBuf>>> = Arc::new(Mutex::new(None));
    let setup_profile = profile_path.clone();
    let setup_fixture = fixture.clone();
    let app = tauri::Builder::default().manage(browser::BrowserState::default()).setup(move |app| {
        *setup_profile.lock().unwrap() = Some(app.path().app_local_data_dir()?);
        let app = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            let result = tokio::time::timeout(Duration::from_secs(180), check(&app, &setup_fixture)).await
                .unwrap_or_else(|_| Err("Native browser smoke timed out".into()));
            browser::shutdown(&app.state());
            match result {
                Ok(()) => { println!("Native browser smoke passed."); app.exit(0); },
                Err(error) => { eprintln!("Native browser smoke FAILED: {error}"); app.exit(1); }
            }
        });
        Ok(())
    }).build(context).expect("test Tauri application");
    let code = app.run_return(|_, _| {});
    // Keep this isolated test run available for inspection. WebView2 can hold
    // profile files after exit; no recursive cleanup or user profile is touched.
    println!(
        "Native browser smoke fixture retained: {}",
        fixture.display()
    );
    if let Some(path) = profile_path.lock().unwrap().take() {
        println!("Native browser smoke profile retained: {}", path.display());
    }
    std::process::exit(code);
}
