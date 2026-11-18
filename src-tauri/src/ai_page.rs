//! One confirmed step on the browser tab the user is already looking at.
//! The model receives title, address and bounded visible text, never a WebView.
use super::{Action, CheckedAction, PermissionMode};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const REMEMBERED_FOR: Duration = Duration::from_secs(15 * 60);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PageClaim {
    pub key: String,
    pub url: String,
    pub title: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PageBinding {
    pub key: String,
    pub url: String,
    pub title: String,
}

struct RememberedPage {
    url: String,
    summary: String,
    at: Instant,
}

fn remembered() -> &'static Mutex<HashMap<String, RememberedPage>> {
    static PAGES: OnceLock<Mutex<HashMap<String, RememberedPage>>> = OnceLock::new();
    PAGES.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn page_label(raw: &str) -> String {
    raw.chars()
        .filter(|c| !c.is_control())
        .take(200)
        .collect()
}

pub fn remember_page(key: &str, url: &str, summary: &str) {
    let Ok(mut pages) = remembered().lock() else { return };
    let now = Instant::now();
    pages.retain(|_, page| page.at.elapsed() <= REMEMBERED_FOR);
    pages.insert(key.to_owned(), RememberedPage { url: url.to_owned(), summary: summary.to_owned(), at: now });
}

pub fn remembered_page(key: &str, url: &str) -> Option<String> {
    let Ok(mut pages) = remembered().lock() else { return None };
    pages.retain(|_, page| page.at.elapsed() <= REMEMBERED_FOR);
    pages.get(key).filter(|page| page.url == url).map(|page| page.summary.clone())
}

pub fn forget_page(key: &str) {
    if let Ok(mut pages) = remembered().lock() {
        pages.remove(key);
    }
}

pub fn is_navigation(kind: &str) -> bool {
    matches!(kind, "browser_open" | "browser_back" | "browser_forward" | "browser_reload")
}

pub fn validate_page_actions(
    actions: Vec<Action>,
    mode: PermissionMode,
    binding: &PageBinding,
    already_read: bool,
) -> Result<Vec<CheckedAction>, String> {
    if actions.is_empty() {
        return Ok(Vec::new());
    }
    if actions.len() != 1 {
        return Err("网页助手每次只提出一步 / The web assistant proposes one step at a time".into());
    }
    let action = actions.into_iter().next().unwrap();
    if action.source.is_some() || action.content.is_some() || action.original.is_some() {
        return Err("网页动作不能附带脚本、表单或文件路径 / A page action cannot include a script, form or file path".into());
    }
    let open_url = match action.kind.as_str() {
        "browser_read" => None,
        "browser_open" => Some(crate::browser::http_page_url(&action.target)?),
        "browser_back" | "browser_forward" | "browser_reload" => None,
        _ => return Err("网页助手只能读取当前页，或在确认后打开地址、后退、前进、刷新 / The web assistant can only read this tab or, after confirmation, open an address, go back, go forward or reload".into()),
    };
    if is_navigation(&action.kind) {
        if mode == PermissionMode::ReadOnly {
            return Err("只读模式只能读取当前页，不能打开地址、后退、前进或刷新 / Read-only mode can read the current page but cannot navigate".into());
        }
        if !already_read {
            return Err("请先确认读取当前页的标题、地址和可见正文，再提出这一步 / Read this tab's title, address and visible text before proposing another step".into());
        }
    }
    let target = open_url.unwrap_or_else(|| binding.url.clone());
    Ok(vec![CheckedAction {
        display: Action {
            kind: action.kind,
            source: Some(binding.title.clone()),
            target,
            content: None,
            original: None,
        },
        source: None,
        target: std::path::PathBuf::new(),
        identity: None,
        page: Some(binding.clone()),
    }])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn binding() -> PageBinding {
        PageBinding { key: "tab-1".into(), url: "https://example.com/now".into(), title: "Now".into() }
    }
    fn step(kind: &str, target: &str) -> Action {
        Action { kind: kind.into(), source: None, target: target.into(), content: None, original: None }
    }

    #[test]
    fn page_actions_read_before_navigation_and_reject_anything_else() {
        let page = binding();
        let read = validate_page_actions(vec![step("browser_read", "")], PermissionMode::ReadOnly, &page, false).unwrap();
        assert_eq!(read[0].display.kind, "browser_read");
        assert_eq!(read[0].display.source.as_deref(), Some("Now"));
        assert_eq!(read[0].display.target, page.url);
        assert!(read[0].page.is_some());
        for kind in ["browser_open", "browser_back", "browser_forward", "browser_reload"] {
            let target = if kind == "browser_open" { "https://example.com/next" } else { "" };
            match validate_page_actions(vec![step(kind, target)], PermissionMode::ReadOnly, &page, true) { Err(err) => assert!(err.contains("只读"), "{err}"), Ok(_) => panic!("read-only navigation was accepted") }
            match validate_page_actions(vec![step(kind, target)], PermissionMode::Auto, &page, false) { Err(err) => assert!(err.contains("先确认读取"), "{err}"), Ok(_) => panic!("navigation before a read was accepted") }
        }
        let open = validate_page_actions(vec![step("browser_open", "https://example.com/next")], PermissionMode::Auto, &page, true).unwrap();
        assert_eq!(open[0].display.target, "https://example.com/next");
        let back = validate_page_actions(vec![step("browser_back", "https://evil.example/")], PermissionMode::Confirm, &page, true).unwrap();
        assert_eq!(back[0].display.target, page.url);
        for (kind, target) in [("click", "1,2"), ("eval", "alert(1)"), ("fill", "name"), ("browser_open", "javascript:alert(1)"), ("browser_open", "file:///C:/secret"), ("browser_open", "about:blank"), ("browser_open", "https://user:secret@example.com/")] {
            assert!(validate_page_actions(vec![step(kind, target)], PermissionMode::Confirm, &page, true).is_err(), "{kind} {target}");
        }
        let mut script = step("browser_read", "");
        script.content = Some("document.body.innerHTML".into());
        assert!(validate_page_actions(vec![script], PermissionMode::ReadOnly, &page, false).is_err());
        assert!(validate_page_actions(vec![step("browser_read", ""), step("browser_open", "https://example.com/")], PermissionMode::Confirm, &page, true).is_err());
        assert!(validate_page_actions(vec![step("mkdir", "notes")], PermissionMode::Confirm, &page, true).is_err());
    }

    #[test]
    fn a_confirmed_read_is_remembered_only_for_that_tab_and_address() {
        let key = format!("remember-{}", std::process::id());
        assert!(remembered_page(&key, "https://example.com/a").is_none());
        remember_page(&key, "https://example.com/a", "visible");
        assert_eq!(remembered_page(&key, "https://example.com/a").as_deref(), Some("visible"));
        assert!(remembered_page(&key, "https://example.com/b").is_none());
        assert!(remembered_page("other-tab", "https://example.com/a").is_none());
        forget_page(&key);
        assert!(remembered_page(&key, "https://example.com/a").is_none());
    }
}
