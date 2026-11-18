//! Only a selection in the native context menu can mint a web quote. A page never supplies IPC data.
use super::{valid_url, BrowserState};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, EventTarget, Manager, Webview};
use uuid::Uuid;
use webview2_com::{
    CoTaskMemPWSTR, ContextMenuRequestedEventHandler, CustomItemSelectedEventHandler,
    FrameCreatedEventHandler, FrameDestroyedEventHandler, Microsoft::Web::WebView2::Win32::*,
    SourceChangedEventHandler,
};
use windows_core::{Interface, BOOL, HSTRING, PWSTR};

pub const MENU_LABEL: &str = "引用到项目 / Quote to project";
const STALE: &str = "网页或标签已变化，请重新选择文字。";
const TTL: Duration = Duration::from_secs(300);

// The allocator belongs to WebView2. Bound the conversion before making a second copy
// of a potentially very large selection; never truncate text shown for consent.
unsafe fn bounded_native_string(raw: PWSTR, max: usize) -> Result<String, String> {
    let _owner = CoTaskMemPWSTR::from(raw);
    if raw.is_null() {
        return Err("网页未提供有效的选区或地址。".into());
    }
    // WebView2 returns a NUL-terminated UTF-16 string. Stop at the terminator even
    // when the allocation is shorter than max; do not form a max-length slice.
    for n in 0..=max {
        if unsafe { *raw.0.add(n) } == 0 {
            return String::from_utf16(unsafe { std::slice::from_raw_parts(raw.0, n) })
                .map_err(|_| "网页选区不是有效 Unicode 文本。".into());
        }
    }
    Err("网页选区或地址过长，请缩小范围后重选。".into())
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Origin {
    pub url: String,
    pub captured_at: u64,
}
#[derive(Clone, Debug, Serialize)]
pub struct Quote {
    pub source: Origin,
    pub text: String,
}

#[derive(Clone, Copy, PartialEq)]
struct Document {
    instance: Uuid,
    epoch: u64,
}
#[derive(Default)]
struct Store {
    docs: HashMap<String, Document>,
    active: Option<String>,
    quotes: HashMap<String, (Instant, Quote)>,
}
#[derive(Default)]
pub struct References(Mutex<Store>);
impl References {
    pub(super) fn opened(&self, key: &str, instance: Uuid) {
        if let Ok(mut s) = self.0.lock() {
            s.docs
                .insert(key.to_owned(), Document { instance, epoch: 0 });
        }
    }
    pub(super) fn navigated(&self, key: &str, instance: Uuid) {
        if let Ok(mut s) = self.0.lock() {
            if let Some(d) = s.docs.get_mut(key).filter(|d| d.instance == instance) {
                d.epoch = d.epoch.wrapping_add(1);
            }
        }
    }
    pub(super) fn active(&self, key: &str, visible: bool) {
        if let Ok(mut s) = self.0.lock() {
            if visible && s.active.as_deref() != Some(key)
                || !visible && s.active.as_deref() == Some(key)
            {
                if let Some(old) = s.active.take() {
                    if let Some(d) = s.docs.get_mut(&old) {
                        d.epoch = d.epoch.wrapping_add(1);
                    }
                }
                if visible {
                    s.active = Some(key.to_owned());
                }
            }
        }
    }
    pub(super) fn leave_document(&self, key: &str) {
        if let Ok(mut s) = self.0.lock() {
            if let Some(d) = s.docs.get_mut(key) {
                d.epoch = d.epoch.wrapping_add(1);
            }
        }
    }
    pub(super) fn closed(&self, key: &str) {
        if let Ok(mut s) = self.0.lock() {
            s.docs.remove(key);
            if s.active.as_deref() == Some(key) {
                s.active = None;
            }
        }
    }
    fn ticket(&self, key: &str, instance: Uuid) -> Option<Document> {
        let s = self.0.lock().ok()?;
        (s.active.as_deref() == Some(key)).then_some(())?;
        s.docs.get(key).filter(|d| d.instance == instance).copied()
    }
    fn freeze(
        &self,
        key: &str,
        expected: Document,
        raw: &str,
        text: String,
    ) -> Result<String, String> {
        let mut s = self.0.lock().map_err(|_| "网页选区不可用")?;
        if s.active.as_deref() != Some(key) || s.docs.get(key) != Some(&expected) {
            return Err(STALE.into());
        }
        let mut url = valid_url(raw)?;
        if !matches!(url.scheme(), "https" | "http") {
            return Err("仅支持 HTTP(S) 网页正文。".into());
        }
        url.set_query(None);
        url.set_fragment(None);
        if url.as_str().len() > 4096
            || text.trim().is_empty()
            || text.len() > 32768
            || text.contains('\0')
        {
            return Err("网页选区为空或超过限制（正文最多 32 KiB），请缩小范围后重选。".into());
        }
        s.quotes.retain(|_, (when, _)| when.elapsed() < TTL);
        if s.quotes.len() >= 8 {
            return Err("未处理的网页引用已满，请先关闭已有预览。".into());
        }
        let id = Uuid::new_v4().to_string();
        let captured_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        s.quotes.insert(
            id.clone(),
            (
                Instant::now(),
                Quote {
                    source: Origin {
                        url: url.into(),
                        captured_at,
                    },
                    text,
                },
            ),
        );
        Ok(id)
    }
    pub fn get(&self, id: &str) -> Result<Quote, String> {
        let mut s = self.0.lock().map_err(|_| "引用不可用")?;
        s.quotes.retain(|_, (when, _)| when.elapsed() < TTL);
        s.quotes
            .get(id)
            .map(|(_, q)| q.clone())
            .ok_or_else(|| "引用已过期或已关闭，请重新选择。".into())
    }
    pub fn discard(&self, id: &str) {
        if let Ok(mut s) = self.0.lock() {
            s.quotes.remove(id);
        }
    }
    pub fn is_live(&self, id: &str) -> bool {
        self.0.lock().ok().is_some_and(|s| {
            s.quotes
                .get(id)
                .is_some_and(|(when, _)| when.elapsed() < TTL)
        })
    }
}

pub struct EngineRevision(pub fn(&AppHandle) -> Result<u64, String>);

pub(super) async fn install(
    app: AppHandle,
    child: &Webview,
    key: String,
    instance: Uuid,
    revision: fn(&AppHandle) -> Result<u64, String>,
) -> Result<(), String> {
    let (send, recv) = tokio::sync::oneshot::channel();
    child
        .with_webview(move |native| {
            // Both event handlers and all native objects stay on the WebView2 UI apartment.
            let result = (|| unsafe {
                let core = native.controller().CoreWebView2()?;
                let menus = core.cast::<ICoreWebView2_11>()?;
                let environment = native.environment().cast::<ICoreWebView2Environment9>()?;
                let mut token = 0;
                // Installed on the empty child before its first website navigation. If a
                // runtime cannot identify a frame, never infer "main" just from equal URLs:
                // an embedded document can intentionally use the same URL as its parent.
                let children=std::rc::Rc::new(std::cell::Cell::new(0u32));
                let created=children.clone();
                core.cast::<ICoreWebView2_4>()?.add_FrameCreated(&FrameCreatedEventHandler::create(Box::new(move|_,args|{
                    created.set(created.get().saturating_add(1));
                    if let Some(args)=args {
                        let destroyed=created.clone();
                        args.Frame()?.add_Destroyed(&FrameDestroyedEventHandler::create(Box::new(move|_,_|{
                            destroyed.set(destroyed.get().saturating_sub(1));Ok(())
                        })),&mut 0)?;
                    }
                    Ok(())
                })),&mut token)?;
                let handle = app.clone();
                let tab = key.clone();
                core.add_SourceChanged(
                    &SourceChangedEventHandler::create(Box::new(move |_, _| {
                        handle.state::<BrowserState>().4.navigated(&tab, instance);
                        Ok(())
                    })),
                    &mut token,
                )?;
                menus.add_ContextMenuRequested(
                    &ContextMenuRequestedEventHandler::create(Box::new(move |sender, args| {
                        let Some(args) = args else { return Ok(()) };
                        let Ok(generation)=revision(&app) else{return Ok(())};
                        let Some(ticket) = app.state::<BrowserState>().4.ticket(&key, instance)
                        else {
                            return Ok(());
                        };
                        let target = args.ContextMenuTarget()?;
                        let (mut main, mut editable, mut selected) =
                            (BOOL::default(), BOOL::default(), BOOL::default());
                        let mut kind = COREWEBVIEW2_CONTEXT_MENU_TARGET_KIND::default();
                        target.Kind(&mut kind)?;
                        target.IsRequestedForMainFrame(&mut main)?;
                        target.IsEditable(&mut editable)?;
                        target.HasSelection(&mut selected)?;
                        if (!main.as_bool() && children.get()!=0) || editable.as_bool()
                            || !selected.as_bool()
                            || kind != COREWEBVIEW2_CONTEXT_MENU_TARGET_KIND_SELECTED_TEXT
                        {
                            return Ok(());
                        }
                        let Some(sender)=sender else {return Ok(())};
                        let read_uri=|op: &dyn Fn(*mut PWSTR)->windows_core::Result<()>|->Option<String>{
                            let mut ptr=PWSTR::null();op(&mut ptr).ok()?;bounded_native_string(ptr,32768).ok()
                        };
                        let Some(page)=read_uri(&|out|target.PageUri(out)) else{return Ok(())};
                        if read_uri(&|out|target.FrameUri(out)).as_deref()!=Some(&page) ||
                            read_uri(&|out|sender.Source(out)).as_deref()!=Some(&page) {return Ok(());}
                        let item = environment.CreateContextMenuItem(
                            &HSTRING::from(MENU_LABEL),
                            None,
                            COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND,
                        )?;
                        let (handle, tab) = (app.clone(), key.clone());
                        // Each menu item owns that menu's exact native target, even if another menu opens.
                        item.add_CustomItemSelected(
                            &CustomItemSelectedEventHandler::create(Box::new(move |_, _| {
                                let refs = handle.state::<BrowserState>();
                                let result = if refs.4.ticket(&tab, instance) != Some(ticket) || revision(&handle).ok()!=Some(generation) {
                                    Err(STALE.to_owned())
                                } else {
                                    (|| {
                                        let mut ptr = PWSTR::null();
                                        target
                                            .SelectionText(&mut ptr)
                                            .map_err(|e| e.to_string())?;
                                        refs.4.freeze(&tab, ticket, &page, bounded_native_string(ptr,32768)?)
                                    })()
                                };
                                match result {
                                    Ok(id) => {
                                        let _ = handle.emit_to(
                                            EventTarget::webview("main"),
                                            "browser-quote",
                                            &id,
                                        );
                                    }
                                    Err(error) => {
                                        let _ = handle.emit_to(
                                            EventTarget::webview("main"),
                                            "browser-quote-error",
                                            &error,
                                        );
                                    }
                                }
                                Ok(())
                            })),
                            &mut 0,
                        )?;
                        args.MenuItems()?.InsertValueAtIndex(0, &item)?;
                        Ok(())
                    })),
                    &mut token,
                )
            })();
            let _ = send.send(result.map_err(|e| e.to_string()));
        })
        .map_err(|e| e.to_string())?;
    recv.await.map_err(|_| "网页已关闭")?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_bounded_plain_web_quotes_can_be_submitted_before_expiry() {
        let refs = References::default();
        let instance = Uuid::new_v4();
        refs.opened("A", instance);
        refs.active("A", true);
        let menu = refs.ticket("A", instance).unwrap();
        for url in [
            "file:///C:/private",
            "https://user:pass@example.org/",
            "http://tauri.localhost/",
            "about:blank",
        ] {
            assert!(refs.freeze("A", menu, url, "正文".into()).is_err());
        }
        for content in ["  ".into(), "x\0y".into(), "梨".repeat(10923)] {
            assert!(refs
                .freeze("A", menu, "https://example.org/", content)
                .is_err());
        }
        let id = refs
            .freeze("A", menu, "https://example.org/", "x".repeat(32768))
            .unwrap();
        assert!(refs.is_live(&id));
        refs.0.lock().unwrap().quotes.get_mut(&id).unwrap().0 = Instant::now() - TTL;
        assert!(!refs.is_live(&id));
        assert!(refs.get(&id).is_err());
    }
    #[test]
    fn navigation_close_and_tab_reuse_invalidate_menu_but_not_frozen_quote() {
        let refs = References::default();
        let first = Uuid::new_v4();
        refs.opened("A", first);
        refs.active("A", true);
        let menu = refs.ticket("A", first).unwrap();
        let id = refs
            .freeze(
                "A",
                menu,
                "https://example.org/article?token=private#secret",
                "first".into(),
            )
            .unwrap();
        refs.navigated("A", first);
        assert!(refs
            .freeze("A", menu, "https://example.org/article", "late".into())
            .is_err());
        let menu = refs.ticket("A", first).unwrap();
        refs.active("B", true);
        refs.active("A", true);
        assert!(refs
            .freeze("A", menu, "https://example.org/article", "inactive".into())
            .is_err());
        refs.closed("A");
        refs.opened("A", Uuid::new_v4());
        refs.active("A", true);
        assert!(refs.ticket("A", first).is_none());
        let q = refs.get(&id).unwrap();
        assert_eq!(q.text, "first");
        assert_eq!(q.source.url, "https://example.org/article");
        refs.discard(&id);
        assert!(refs.get(&id).is_err());
    }
}
