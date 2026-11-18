//! Keep WebView2's original navigation (including POST data and window.opener)
//! attached to the workbench tab. COM objects stay on the WebView2 UI thread.
use std::{
    cell::RefCell,
    collections::HashMap,
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};
use tauri::{webview::WebviewBuilder, AppHandle, Emitter, Webview, Wry};
use tokio::sync::oneshot;
use webview2_com::{
    take_pwstr, LaunchingExternalUriSchemeEventHandler, Microsoft::Web::WebView2::Win32::*,
    NewWindowRequestedEventHandler, WindowCloseRequestedEventHandler,
};
use windows_core::{Interface, PWSTR};

struct Pending {
    opener: String,
    environment: ICoreWebView2Environment,
    args: ICoreWebView2NewWindowRequestedEventArgs,
    deferral: ICoreWebView2Deferral,
}

impl Drop for Pending {
    fn drop(&mut self) {
        // Already marked handled, even when creation fails or the opener closes.
        let _ = unsafe { self.deferral.Complete() };
    }
}

thread_local! { static PENDING: RefCell<HashMap<String, Pending>> = RefCell::default(); }
static NEXT: AtomicU64 = AtomicU64::new(1);

pub fn dismiss(key: &str) {
    let request = PENDING.with(|items| items.borrow_mut().remove(key));
    drop(request);
}

pub fn close_opener(key: &str) {
    let children: Vec<_> = PENDING.with(|items| {
        items
            .borrow()
            .iter()
            .filter(|(_, request)| request.opener == key)
            .map(|(id, _)| id.clone())
            .collect()
    });
    for child in children {
        dismiss(&child);
    }
}

pub async fn builder(
    app: &AppHandle,
    key: String,
    builder: WebviewBuilder<Wry>,
) -> Result<WebviewBuilder<Wry>, String> {
    let (send, receive) = oneshot::channel();
    app.run_on_main_thread(move || {
        let result = PENDING
            .with(|items| {
                items
                    .borrow()
                    .get(&key)
                    .map(|request| builder.with_environment(request.environment.clone()))
            })
            .ok_or_else(|| "弹窗请求已结束 / Popup request expired".to_string());
        let _ = send.send(result);
    })
    .map_err(|error| error.to_string())?;
    receive.await.map_err(|error| error.to_string())?
}

pub async fn connect(child: &Webview, key: String) -> Result<(), String> {
    let (send, receive) = oneshot::channel();
    child
        .with_webview(move |native| {
            let request = PENDING.with(|items| items.borrow_mut().remove(&key));
            let result = match request {
                Some(request) => unsafe {
                    native
                        .controller()
                        .CoreWebView2()
                        .and_then(|view| request.args.SetNewWindow(&view))
                        .map_err(|error| error.to_string())
                },
                None => Err("弹窗请求已结束 / Popup request expired".into()),
            };
            let _ = send.send(result);
        })
        .map_err(|error| error.to_string())?;
    receive.await.map_err(|error| error.to_string())?
}

// Some sites explicitly request Edge using its Windows application protocol.
// Only unwrap a web destination; never invoke an arbitrary protocol handler.
pub fn edge_destination(raw: &str) -> Option<url::Url> {
    let (scheme, destination) = raw.split_once(':')?;
    if !scheme.eq_ignore_ascii_case("microsoft-edge") {
        return None;
    }
    super::valid_url(destination)
        .ok()
        .filter(|url| matches!(url.scheme(), "http" | "https"))
}

// WebView2 109 reports `window.open('')` as about:blank#blocked; newer
// runtimes report about:blank. Both open an empty window the opener can steer.
fn popup_target(raw: &str) -> Option<url::Url> {
    let raw = match raw {
        "" | "about:blank#blocked" => "about:blank",
        other => other,
    };
    super::valid_url(raw).ok()
}

/// Permit a native-client callback only when it matches the redirect URI
/// declared by this tab's authorization request. Windows/WebView2 performs
/// the protocol handoff and presents its normal open-application prompt.
#[derive(Default)]
pub struct LoginRedirect(Option<url::Url>);

impl LoginRedirect {
    pub fn observe(&mut self, url: &url::Url) {
        if url.scheme() != "https"
            && !matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
        {
            return;
        }
        if let Some((_, value)) = url.query_pairs().find(|(key, _)| key == "redirect_uri") {
            self.0 = url::Url::parse(&value).ok().filter(|target| {
                let scheme = target.scheme();
                let reverse_domain = scheme.split('.').count() >= 2
                    && scheme.split('.').all(|part| {
                        !part.is_empty()
                            && part.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
                    });
                (reverse_domain
                    || matches!(
                        scheme,
                        "vscode" | "vscode-insiders" | "cursor" | "github-desktop"
                    ))
                    && target.username().is_empty()
                    && target.password().is_none()
                    && !target.cannot_be_a_base()
                    && target.fragment().is_none()
            });
        }
    }

    pub fn matches(&self, next: &url::Url) -> bool {
        let Some(target) = &self.0 else { return false };
        if next.scheme() != target.scheme()
            || next.host() != target.host()
            || next.port() != target.port()
            || next.path() != target.path()
            || !next.username().is_empty()
            || next.password().is_some()
        {
            return false;
        }
        let mut pairs = next.query_pairs();
        pairs
            .clone()
            .any(|(key, _)| key == "code" || key == "error")
            && target
                .query_pairs()
                .all(|pair| next.query_pairs().any(|actual| actual == pair))
            && pairs.all(|(key, value)| {
                matches!(
                    key.as_ref(),
                    "code"
                        | "error"
                        | "state"
                        | "error_description"
                        | "error_uri"
                        | "iss"
                        | "session_state"
                        | "scope"
                ) || target
                    .query_pairs()
                    .any(|pair| pair == (key.clone(), value.clone()))
            })
    }
}

pub async fn install(app: AppHandle, child: &Webview, key: String) -> Result<(), String> {
    let (send, receive) = oneshot::channel();
    child
        .with_webview(move |native| {
            let result = (|| unsafe {
                let view = native.controller().CoreWebView2()?;
                let environment = native.environment();
                let mut token = 0;
                let opener = key.clone();
                let handle = app.clone();
                view.add_NewWindowRequested(
                    &NewWindowRequestedEventHandler::create(Box::new(move |_, args| {
                        let Some(args) = args else { return Ok(()) };
                        args.SetHandled(true)?;
                        let mut uri = PWSTR::null();
                        args.Uri(&mut uri)?;
                        let raw = take_pwstr(uri);
                        if let Some(destination) = edge_destination(&raw) {
                            super::emit_page(&handle, &opener, &destination, "new-window", None);
                            return Ok(());
                        }
                        let Some(url) = popup_target(&raw) else {
                            return Ok(());
                        };
                        if PENDING.with(|items| items.borrow().len() >= 32) {
                            return Ok(());
                        }
                        let id = format!("popup-{}", NEXT.fetch_add(1, Ordering::Relaxed));
                        let request = Pending {
                            opener: opener.clone(),
                            environment: environment.clone(),
                            deferral: args.GetDeferral()?,
                            args,
                        };
                        PENDING.with(|items| items.borrow_mut().insert(id.clone(), request));
                        if handle
                            .emit_to(
                                "main",
                                "browser-page",
                                super::BrowserPageEvent {
                                    key: opener.clone(),
                                    url: url.to_string(),
                                    title: None,
                                    phase: "new-window".into(),
                                    popup_key: Some(id.clone()),
                                },
                            )
                            .is_err()
                        {
                            dismiss(&id);
                            return Ok(());
                        }
                        // Also release a request if the UI reloads or misses the event.
                        let app = handle.clone();
                        tauri::async_runtime::spawn(async move {
                            tokio::time::sleep(Duration::from_secs(30)).await;
                            let _ = app.run_on_main_thread(move || dismiss(&id));
                        });
                        Ok(())
                    })),
                    &mut token,
                )?;
                if key.starts_with("popup-") {
                    let handle = app.clone();
                    let popup = key.clone();
                    view.add_WindowCloseRequested(
                        &WindowCloseRequestedEventHandler::create(Box::new(move |_, _| {
                            let _ = handle.emit_to("main", "browser-popup-close", &popup);
                            Ok(())
                        })),
                        &mut token,
                    )?;
                }
                if let Ok(external) = view.cast::<ICoreWebView2_18>() {
                    external.add_LaunchingExternalUriScheme(
                        &LaunchingExternalUriSchemeEventHandler::create(Box::new(
                            move |_, args| {
                                if let Some(args) = args {
                                    let mut uri = PWSTR::null();
                                    args.Uri(&mut uri)?;
                                    let raw = take_pwstr(uri);
                                    if raw.split_once(':').is_some_and(|(scheme, _)| {
                                        scheme.eq_ignore_ascii_case("microsoft-edge")
                                    }) {
                                        args.SetCancel(true)?;
                                        if let Some(destination) = edge_destination(&raw) {
                                            super::emit_page(
                                                &app,
                                                &key,
                                                &destination,
                                                "new-window",
                                                None,
                                            );
                                        }
                                    }
                                }
                                Ok(())
                            },
                        )),
                        &mut token,
                    )?;
                }
                Ok::<_, windows_core::Error>(())
            })();
            let _ = send.send(result.map_err(|error| error.to_string()));
        })
        .map_err(|error| error.to_string())?;
    receive.await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_explicit_edge_web_links_only() {
        assert_eq!(
            edge_destination("MICROSOFT-EDGE:https://example.test/")
                .unwrap()
                .as_str(),
            "https://example.test/"
        );
        for raw in [
            "microsoft-edge:file:///C:/test",
            "microsoft-edge:about:blank",
            "https://example.test/",
            "microsoft-edge:https://ipc.localhost/",
        ] {
            assert!(edge_destination(raw).is_none());
        }
    }

    #[test]
    fn blank_popup_targets_open_as_about_blank() {
        for raw in ["", "about:blank", "about:blank#blocked"] {
            assert_eq!(popup_target(raw).unwrap().as_str(), "about:blank");
        }
        assert_eq!(
            popup_target("https://example.test/login").unwrap().as_str(),
            "https://example.test/login"
        );
        for raw in ["about:srcdoc", "file:///C:/test", "javascript:alert(1)"] {
            assert!(popup_target(raw).is_none());
        }
    }

    #[test]
    fn client_callback_requires_the_declared_target_and_oauth_response() {
        let mut redirect = LoginRedirect::default();
        let callback = url::Url::parse("com.example.client:/login?code=ok&state=one").unwrap();
        assert!(!redirect.matches(&callback));
        let mut auth = url::Url::parse("https://login.example/authorize").unwrap();
        auth.query_pairs_mut()
            .append_pair("redirect_uri", "com.example.client:/login");
        redirect.observe(&auth);
        assert!(redirect.matches(&callback));
        for raw in [
            "com.example.client:/other?code=ok",
            "com.example.client:/login",
            "com.example.client:/login?code=ok&command=run",
            "file:///login?code=ok",
        ] {
            assert!(!redirect.matches(&url::Url::parse(raw).unwrap()));
        }
        for raw in [
            "ms-settings://test/login",
            "file:///login",
            "javascript:alert(1)",
        ] {
            auth.query_pairs_mut()
                .clear()
                .append_pair("redirect_uri", raw);
            redirect.observe(&auth);
            assert!(redirect.0.is_none());
        }
    }
}
