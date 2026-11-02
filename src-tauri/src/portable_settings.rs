//! Opt-in, executable-relative preferences. Never copy browser profiles or credentials.
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::State;

const LIMIT: usize = 2 * 1024 * 1024;
const COLUMNS: &[&str] = &[
    "name",
    "date",
    "type",
    "size",
    "created",
    "accessed",
    "extension",
    "attributes",
    "path",
];

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Document {
    version: u32,
    enabled: bool,
    updated_at: u64,
    settings: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    path: String,
    enabled: bool,
    updated_at: u64,
    settings: Option<Value>,
    error: Option<String>,
}

#[derive(Default)]
struct Store {
    initialized: bool,
    fingerprint: Option<Vec<u8>>,
    blocked: Option<String>,
}
#[derive(Default)]
pub struct PortableState(Mutex<Store>);

fn location() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(exe
        .parent()
        .ok_or("无法找到软件目录 / Executable directory unavailable")?
        .join("DaliziData")
        .join("preferences.json"))
}

fn ordinary(path: &Path, directory: bool) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes() & 0x400 != 0
                || (directory && !meta.is_dir())
                || (!directory && !meta.is_file())
            {
                return Err("配置路径不能是链接或特殊文件 / Configuration path must be an ordinary file or directory".into());
            }
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn read_bytes(path: &Path) -> Result<Option<Vec<u8>>, String> {
    ordinary(path.parent().ok_or("Invalid configuration path")?, true)?;
    ordinary(path, false)?;
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let mut bytes = Vec::new();
    file.take((LIMIT + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > LIMIT {
        return Err("便携配置超过 2 MB / Portable settings exceed 2 MB".into());
    }
    Ok(Some(bytes))
}

fn fingerprint(bytes: &Option<Vec<u8>>) -> Option<Vec<u8>> {
    bytes.as_ref().map(|b| Sha256::digest(b).to_vec())
}

fn web_url(value: &Value, blank: bool) -> Option<String> {
    let raw = value.as_str()?;
    if blank && raw == "about:blank" {
        return Some(raw.into());
    }
    if raw.len() > 4096 || raw.chars().any(char::is_control) {
        return None;
    }
    let url = url::Url::parse(raw).ok()?;
    (matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none())
    .then(|| url.to_string())
}
fn label(value: &Value, max: usize) -> String {
    value
        .as_str()
        .unwrap_or("")
        .chars()
        .filter(|c| !c.is_control())
        .take(max)
        .collect()
}
fn select_fields(input: &Value, bools: &[&str], strings: &[(&str, &[&str])]) -> Value {
    let mut out = Map::new();
    for key in bools {
        if let Some(v) = input[*key].as_bool() {
            out.insert((*key).into(), json!(v));
        }
    }
    for (key, choices) in strings {
        if let Some(v) = input[*key].as_str() {
            if choices.contains(&v) {
                out.insert((*key).into(), json!(v));
            }
        }
    }
    Value::Object(out)
}
fn model(input: &Value) -> Result<Value, String> {
    let mut out = select_fields(
        input,
        &[],
        &[
            (
                "apiFormat",
                &[
                    "openai-completions",
                    "openai-responses",
                    "anthropic-messages",
                ],
            ),
            ("apiDialect", &["generic", "openai", "deepseek"]),
            (
                "reasoningEffort",
                &[
                    "default", "none", "minimal", "low", "medium", "high", "xhigh", "max",
                ],
            ),
        ],
    );
    let endpoint = input["endpoint"].as_str().unwrap_or("").trim();
    if !endpoint.is_empty() {
        let parsed =
            url::Url::parse(endpoint).map_err(|_| "AI 接口地址无效 / Invalid AI endpoint")?;
        if web_url(&json!(endpoint), false).is_none()
            || parsed.query().is_some()
            || parsed.fragment().is_some()
        {
            return Err("便携 AI 接口地址不能包含账号、密码或查询参数 / Portable AI endpoint cannot contain credentials or query parameters".into());
        }
    }
    out["endpoint"] = json!(endpoint);
    out["model"] = json!(label(&input["model"], 256));
    Ok(out)
}

/// Reconstruct every nested object; unknown fields (including secrets) never survive.
fn sanitize(input: &Value) -> Result<Value, String> {
    let source = input
        .as_object()
        .ok_or("配置内容必须为对象 / Settings must be an object")?;
    let mut out = Map::new();
    for (key, value) in source {
        let next = match key.as_str() {
            "locale" if matches!(value.as_str(), Some("zh" | "en")) => value.clone(),
            "theme" if matches!(value.as_str(), Some("light" | "dark")) => value.clone(),
            "viewMode" if matches!(value.as_str(), Some("details" | "grid")) => value.clone(),
            "sortKey" if value.as_str().is_some_and(|v| COLUMNS.contains(&v)) => value.clone(),
            "sortDir" if matches!(value.as_i64(), Some(-1 | 1)) => value.clone(),
            "showHidden" | "previewOpen" | "aiPanelOpen" | "agentFloating" if value.is_boolean() => value.clone(),
            "aiPanelWidth" if value.as_f64().is_some_and(|v| (280.0..=1600.0).contains(&v)) => value.clone(),
            "workspacePreferences" => select_fields(value, &["favoritesBar", "rememberSession", "restoreOnStartup"], &[]),
            "aiMemoryPreferences" => select_fields(value, &["autoCompact", "autoDeduplicate"], &[]),
            "aiSettings" => model(value)?,
            "aiModelPresets" => Value::Array(value.as_array().ok_or("Invalid model presets")?.iter().take(12).map(model).collect::<Result<_, _>>()?),
            "browserSettings" => {
                let mut settings = select_fields(value, &["recordHistory", "restoreSession", "allowNewWindows", "javascriptEnabled", "contextMenusEnabled", "devToolsEnabled", "autofillEnabled", "passwordAutosaveEnabled"], &[("newTabPage", &["home", "blank"]), ("searchEngine", &["google", "bing", "baidu", "duckduckgo"]), ("colorScheme", &["system", "light", "dark"])]);
                if let Some(url) = web_url(&value["homeUrl"], true) { settings["homeUrl"] = json!(url); }
                if let Some(zoom) = value["zoom"].as_f64().filter(|v| (0.25..=5.0).contains(v)) { settings["zoom"] = json!(zoom); }
                settings
            }
            "columns.v1" => {
                let list = |key: &str| -> Vec<&str> { value[key].as_array().into_iter().flatten().filter_map(Value::as_str).filter(|v| COLUMNS.contains(v)).take(COLUMNS.len()).collect() };
                let mut widths = Map::new();
                for column in COLUMNS { if let Some(width) = value["widths"][*column].as_f64().filter(|v| (50.0..=1600.0).contains(v)) { widths.insert((*column).into(), json!(width)); } }
                json!({"order": list("order"), "visible": list("visible"), "widths": widths})
            }
            "favorites" => {
                let items = value["items"].as_array().ok_or("Invalid favorites")?;
                let mut seen = std::collections::HashSet::new();
                let items: Vec<_> = items.iter().filter(|v| v["kind"] == "browser").filter_map(|v| {
                    let url = web_url(&v["url"], false)?;
                    if !seen.insert(url.clone()) { return None; }
                    let id = label(&v["id"], 100);
                    if id.is_empty() { return None; }
                    Some(json!({"id": id, "kind": "browser", "url": url, "name": label(&v["name"], 160)}))
                }).take(100).collect();
                json!({"version": 1, "items": items})
            }
            "urlHistory" => Value::Array(value.as_array().ok_or("Invalid history")?.iter().filter_map(|v| Some(json!({"url": web_url(&v["url"], false)?, "title": label(&v["title"], 512), "visitedAt": v["visitedAt"].as_u64().unwrap_or(0)}))).take(200).collect()),
            _ => continue,
        };
        out.insert(key.clone(), next);
    }
    Ok(Value::Object(out))
}

fn decode(bytes: &[u8]) -> Result<Document, String> {
    let mut doc: Document = serde_json::from_slice(bytes).map_err(|_| {
        "便携配置损坏，原文件已保留 / Invalid portable settings; original file preserved"
    })?;
    if doc.version != 1 {
        return Err("此便携配置版本暂不支持，请更新软件 / Unsupported portable settings version; update the app".into());
    }
    doc.settings = sanitize(&doc.settings)?;
    Ok(doc)
}

fn load(path: &Path, store: &mut Store) -> Status {
    let result = read_bytes(path).and_then(|bytes| {
        store.fingerprint = fingerprint(&bytes);
        bytes.map(|b| decode(&b)).transpose()
    });
    store.initialized = true;
    store.blocked = result.as_ref().err().cloned();
    match result {
        Ok(doc) => Status {
            path: path.display().to_string(),
            enabled: doc.as_ref().is_some_and(|d| d.enabled),
            updated_at: doc.as_ref().map_or(0, |d| d.updated_at),
            settings: doc.map(|d| d.settings),
            error: None,
        },
        Err(error) => Status {
            path: path.display().to_string(),
            enabled: false,
            updated_at: 0,
            settings: None,
            error: Some(error),
        },
    }
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use windows::{
        core::PCWSTR,
        Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        },
    };
    let temp = path.with_extension(format!("{}.tmp", std::process::id()));
    let mut created = false;
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        created = true;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        drop(file);
        ordinary(path, false)?;
        let wide = |p: &Path| {
            use std::os::windows::ffi::OsStrExt;
            p.as_os_str()
                .encode_wide()
                .chain(Some(0))
                .collect::<Vec<_>>()
        };
        let from = wide(&temp);
        let to = wide(path);
        unsafe {
            MoveFileExW(
                PCWSTR(from.as_ptr()),
                PCWSTR(to.as_ptr()),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        }
        .map_err(|e| e.to_string())
    })();
    // Only remove the uniquely named file created by this writer.
    if created && result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn save(path: &Path, store: &mut Store, enabled: bool, settings: Value) -> Result<Status, String> {
    if !store.initialized {
        return Err("请先读取便携配置 / Load portable settings first".into());
    }
    if let Some(error) = &store.blocked {
        return Err(error.clone());
    }
    let settings = sanitize(&settings)?;
    let parent = path.parent().ok_or("Invalid configuration path")?;
    ordinary(parent, true)?;
    fs::create_dir_all(parent).map_err(|e| format!("软件目录不可写，可将软件移到有写入权限的目录 / Application directory is not writable: {e}"))?;
    let lock_path = parent.join("preferences.lock");
    ordinary(&lock_path, false)?;
    // Windows releases this lock on process exit, including crashes. The file may remain.
    use std::os::windows::fs::OpenOptionsExt;
    let _lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .share_mode(0)
        .open(&lock_path)
        .map_err(|e| {
            format!(
                "配置正在使用或目录不可写，请稍后重试 / Configuration is busy or not writable: {e}"
            )
        })?;
    let before = read_bytes(path)?;
    if fingerprint(&before) != store.fingerprint {
        return Err("配置已被其他窗口或程序修改，请重启后重试 / Settings changed externally; restart before saving".into());
    }
    let doc = Document {
        version: 1,
        enabled,
        settings,
        updated_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
    };
    let bytes = serde_json::to_vec_pretty(&doc).map_err(|e| e.to_string())?;
    if bytes.len() > LIMIT {
        return Err("便携配置超过 2 MB / Portable settings exceed 2 MB".into());
    }
    let backup = parent.join("preferences.previous.json");
    ordinary(&backup, false)?;
    if let Some(previous) = &before {
        atomic_write(&backup, previous)?;
    }
    atomic_write(path, &bytes)?;
    store.fingerprint = Some(Sha256::digest(&bytes).to_vec());
    Ok(Status {
        path: path.display().to_string(),
        enabled,
        updated_at: doc.updated_at,
        settings: None,
        error: None,
    })
}

#[tauri::command]
pub async fn portable_settings_load(state: State<'_, PortableState>) -> Result<Status, String> {
    let path = location()?;
    Ok(load(
        &path,
        &mut *state.0.lock().map_err(|e| e.to_string())?,
    ))
}
#[tauri::command]
pub async fn portable_settings_save(
    state: State<'_, PortableState>,
    enabled: bool,
    settings: Value,
) -> Result<Status, String> {
    let path = location()?;
    save(
        &path,
        &mut *state.0.lock().map_err(|e| e.to_string())?,
        enabled,
        settings,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_portable_fields_survive_including_nested_fields() {
        let clean = sanitize(&json!({"theme":"dark", "pinned":["C:/private"], "lastPath":"C:/private", "apiKey":"secret", "aiSettings":{"endpoint":"https://api.example/v1", "model":"demo", "apiKey":"secret"}, "browserSettings":{"homeUrl":"https://example.com", "downloadDirectory":"C:/private", "cookies":"secret"}, "favorites":{"items":[{"id":"folder","kind":"files","path":"C:/private"},{"id":"web","kind":"browser","url":"https://example.com","name":"Example","secret":"secret"}]}, "urlHistory":[{"url":"file:///C:/private"},{"url":"https://user:secret@example.com"},{"url":"https://example.com","visitedAt":12,"secret":"secret"}]})).unwrap();
        let text = clean.to_string();
        assert!(!text.contains("secret"));
        assert!(!text.contains("private"));
        assert_eq!(clean["favorites"]["items"].as_array().unwrap().len(), 1);
        assert_eq!(clean["urlHistory"].as_array().unwrap().len(), 1);
        assert!(
            sanitize(&json!({"aiSettings":{"endpoint":"https://api.example/v1?key=secret"}}))
                .is_err()
        );
    }
    #[test]
    fn persistence_reload_backup_conflict_and_corruption() {
        let root = std::env::temp_dir().join(format!(
            "dalizi-portable-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let path = root.join("DaliziData/preferences.json");
        let mut store = Store::default();
        assert!(!load(&path, &mut store).enabled);
        assert!(!root.exists(), "reading defaults must not create files");
        save(&path, &mut store, true, json!({"theme":"dark"})).unwrap();
        let mut second = Store::default();
        assert_eq!(load(&path, &mut second).settings.unwrap()["theme"], "dark");
        save(
            &path,
            &mut store,
            true,
            json!({"theme":"light", "urlHistory":[]}),
        )
        .unwrap();
        assert_eq!(
            decode(&fs::read(path.with_file_name("preferences.previous.json")).unwrap())
                .unwrap()
                .settings["theme"],
            "dark"
        );
        assert!(save(&path, &mut second, true, json!({"theme":"dark"})).is_err());
        save(&path, &mut store, false, json!({"theme":"light"})).unwrap();
        assert!(!load(&path, &mut second).enabled);
        fs::write(&path, b"broken").unwrap();
        assert!(load(&path, &mut store).error.is_some());
        assert!(save(&path, &mut store, true, json!({})).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"broken");
        fs::remove_file(path.with_file_name("preferences.previous.json")).unwrap();
        fs::remove_file(&path).unwrap();
        fs::remove_file(path.with_file_name("preferences.lock")).unwrap();
        fs::remove_dir(path.parent().unwrap()).unwrap();
        fs::remove_dir(root).unwrap();
    }
    #[test]
    fn unsupported_versions_are_rejected() {
        assert!(decode(br#"{"version":2,"enabled":true,"updatedAt":0,"settings":{}}"#).is_err());
    }
    #[test]
    fn failed_replace_keeps_old_file_and_retry_works() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = std::env::temp_dir().join(format!(
            "dalizi-portable-lock-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let path = root.join("preferences.json");
        let mut store = Store::default();
        load(&path, &mut store);
        save(&path, &mut store, true, json!({"theme":"light"})).unwrap();
        let held = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&path)
            .unwrap();
        assert!(save(&path, &mut store, true, json!({"theme":"dark"})).is_err());
        assert_eq!(
            decode(&fs::read(&path).unwrap()).unwrap().settings["theme"],
            "light"
        );
        drop(held);
        save(&path, &mut store, true, json!({"theme":"dark"})).unwrap();
        assert_eq!(
            load(&path, &mut Store::default()).settings.unwrap()["theme"],
            "dark"
        );
        for item in fs::read_dir(&root).unwrap() {
            fs::remove_file(item.unwrap().path()).unwrap();
        }
        fs::remove_dir(root).unwrap();
    }
}
