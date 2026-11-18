use super::{path_key, persist_cache, search};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock, RwLock};
use std::time::Duration;
use tauri::{Emitter, Manager};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Fixed,
    Selected,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    pub mode: Mode,
    pub folders: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub excluded: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Coverage {
    Full,
    Partial,
    Excluded,
}

#[derive(Clone, Serialize)]
pub struct Policy {
    settings: Settings,
    pub(super) roots: Vec<String>,
    #[serde(skip)]
    pub(super) keys: Vec<String>,
    #[serde(skip)]
    pub(super) exclusions: Vec<String>,
    #[serde(skip)]
    children: HashMap<String, HashSet<String>>,
    warning: Option<String>,
}

impl Policy {
    pub(super) fn new(settings: Settings, fixed: &[String], warning: Option<String>) -> Self {
        let mut roots = match settings.mode {
            Mode::Fixed => fixed.to_vec(),
            Mode::Selected => settings.folders.clone(),
        };
        let exclusions: Vec<_> = settings.excluded.iter().map(|p| path_key(p)).collect();
        roots.retain(|p| !exclusions.iter().any(|x| within(&path_key(p), x)));
        let keys = roots.iter().map(|p| path_key(p)).collect();
        let mut children: HashMap<String, HashSet<String>> = HashMap::new();
        for path in &exclusions {
            let path = Path::new(path);
            if let (Some(parent), Some(name)) = (path.parent(), path.file_name()) {
                children
                    .entry(parent.to_string_lossy().into_owned())
                    .or_default()
                    .insert(name.to_string_lossy().into_owned());
            }
        }
        Self {
            settings,
            roots,
            keys,
            exclusions,
            children,
            warning,
        }
    }
    pub(super) fn includes(&self, path: &str) -> bool {
        let key = path_key(path);
        self.keys.iter().any(|root| within(&key, root))
            && !self.exclusions.iter().any(|x| within(&key, x))
    }
    pub(super) fn coverage(&self, path: &str) -> Coverage {
        if self.exclusions.is_empty() {
            return Coverage::Full;
        }
        let key = path_key(path);
        if self.exclusions.iter().any(|x| within(&key, x)) {
            Coverage::Excluded
        } else if self.exclusions.iter().any(|x| within(x, &key)) {
            Coverage::Partial
        } else {
            Coverage::Full
        }
    }
    pub(super) fn hidden_children(&self, path: &str) -> Option<&HashSet<String>> {
        if self.children.is_empty() {
            return None;
        }
        self.children.get(&path_key(path))
    }
    pub(crate) fn manual_size(&self, path: &str) -> bool {
        self.coverage(path) != Coverage::Full
    }
    pub(super) fn accepts_legacy(&self) -> bool {
        self.settings.mode == Mode::Fixed && self.exclusions.is_empty()
    }
    pub(super) fn selected_count(&self) -> Option<usize> {
        (self.settings.mode == Mode::Selected).then_some(self.roots.len())
    }
}

pub(super) fn within(path: &str, root: &str) -> bool {
    path == root
        || path
            .strip_prefix(root)
            .is_some_and(|tail| root.ends_with('\\') || tail.starts_with('\\'))
}

pub(super) fn folder_path(input: &str) -> Result<String, String> {
    let path = input.trim().replace('/', "\\");
    let b = path.as_bytes();
    if b.len() < 3 || !b[0].is_ascii_alphabetic() || &b[1..3] != b":\\" {
        return Err(format!(
            "需要本地绝对路径 / Expected a local absolute path: {input}"
        ));
    }
    let mut out = format!("{}:\\", (b[0] as char).to_ascii_uppercase());
    for part in path[3..].split('\\').filter(|s| !s.is_empty()) {
        if part.ends_with(['.', ' '])
            || part.contains([':', '*', '?', '"', '<', '>', '|'])
            || part.chars().any(char::is_control)
        {
            return Err(format!("目录路径无效 / Invalid folder path: {input}"));
        }
        if !out.ends_with('\\') {
            out.push('\\');
        }
        out.push_str(part);
    }
    Ok(out)
}

// Inspect each component, including the chosen root itself. A junction can also
// be introduced while the app is closed, so scan setup checks again on every pass.
pub(super) fn ordinary_folder(path: &str) -> bool {
    super::scan_allowed(path).unwrap_or(false)
}

// A recursive Windows watch follows the opened directory handle. If a root
// moves or is replaced, reattach to the configured path and rescan its contents.
#[derive(Clone)]
struct RootCheck {
    epoch: u64,
    paths: Vec<String>,
    identities: Vec<Option<String>>,
}
static ROOT_CHECK: Mutex<Option<RootCheck>> = Mutex::new(None);

fn identities(paths: &[String]) -> Vec<Option<String>> {
    let fixed = crate::fixed_drive_roots();
    paths
        .iter()
        .map(|p| {
            let local = fixed
                .iter()
                .any(|drive| p.get(..3).is_some_and(|s| s.eq_ignore_ascii_case(drive)));
            (local && ordinary_folder(p))
                .then(|| crate::local_transfer::identity(p, false).unwrap_or_default())
        })
        .collect()
}

pub(super) fn monitor_roots(epoch: u64, paths: &[String], selected: bool) {
    let next = (selected && !paths.is_empty()).then(|| RootCheck {
        epoch,
        paths: paths.to_vec(),
        identities: identities(paths),
    });
    *ROOT_CHECK.lock().unwrap() = next;
}

pub(super) fn start_monitor() {
    std::thread::spawn(|| {
        super::run_lowest_priority();
        loop {
            std::thread::sleep(Duration::from_secs(4));
            let Some(before) = ROOT_CHECK.lock().unwrap().clone() else {
                continue;
            };
            if EPOCH.load(Ordering::SeqCst) != before.epoch {
                continue;
            }
            let current = identities(&before.paths);
            if current == before.identities {
                continue;
            }
            let mut slot = ROOT_CHECK.lock().unwrap();
            if let Some(check) = slot.as_mut() {
                if check.epoch == before.epoch
                    && check.identities == before.identities
                    && EPOCH.load(Ordering::SeqCst) == before.epoch
                {
                    check.identities = current;
                    super::search_rebuild();
                }
            }
        }
    });
}

impl Settings {
    fn normalize(self, check: impl Fn(&str) -> Result<(), String>) -> Result<Self, String> {
        let excluded = normalize_paths(&self.excluded, |_| Ok(()))?;
        let folders = if self.mode == Mode::Fixed {
            vec![]
        } else {
            normalize_paths(&self.folders, check)?
        };
        Ok(Self {
            mode: self.mode,
            folders,
            excluded,
        })
    }
}

fn normalize_paths(
    input: &[String],
    check: impl Fn(&str) -> Result<(), String>,
) -> Result<Vec<String>, String> {
    let mut paths = input
        .iter()
        .map(|p| folder_path(p))
        .collect::<Result<Vec<_>, _>>()?;
    paths.sort_by_cached_key(|p| path_key(p));
    let mut folders: Vec<String> = Vec::new();
    for path in paths {
        let key = path_key(&path);
        if folders.iter().any(|p| within(&key, &path_key(p))) {
            continue;
        }
        check(&path)?;
        folders.push(path);
    }
    Ok(folders)
}

struct Store {
    path: PathBuf,
    current: RwLock<Policy>,
}
static STORE: OnceLock<Store> = OnceLock::new();
pub(super) static EPOCH: AtomicU64 = AtomicU64::new(1);
const MAX_CONFIG_BYTES: usize = 1024 * 1024;

fn load(path: &Path, fixed: &[String]) -> Policy {
    let read = || -> Result<Settings, String> {
        let file = match fs::File::open(path) {
            Ok(f) => f,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                return Ok(Settings {
                    mode: Mode::Fixed,
                    folders: vec![],
                    excluded: vec![],
                })
            }
            Err(e) => return Err(e.to_string()),
        };
        let mut bytes = Vec::new();
        file.take(MAX_CONFIG_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > MAX_CONFIG_BYTES {
            return Err("Index location settings exceed 1 MiB".into());
        }
        serde_json::from_slice::<Settings>(&bytes)
            .map_err(|e| e.to_string())?
            .normalize(|_| Ok(()))
    };
    match read() {
        Ok(settings) => Policy::new(settings, fixed, None),
        Err(e) => Policy::new(
            Settings {
                mode: Mode::Selected,
                folders: vec![],
                excluded: vec![],
            },
            fixed,
            Some(e),
        ),
    }
}

pub(crate) fn init(app: &tauri::AppHandle) -> Result<(), tauri::Error> {
    let path = app.path().app_config_dir()?.join("index-locations.json");
    let current = RwLock::new(load(&path, &crate::fixed_drive_roots()));
    let _ = STORE.set(Store { path, current });
    Ok(())
}

pub(crate) fn with_policy<T>(f: impl FnOnce(Option<&Policy>) -> T) -> T {
    let policy = STORE.get().map(|s| s.current.read().unwrap());
    f(policy.as_deref())
}

#[tauri::command]
pub async fn index_locations_get(view: tauri::Webview) -> Result<Policy, String> {
    crate::ai::harness_tasks::local(&view)?;
    tauri::async_runtime::spawn_blocking(|| {
        with_policy(|p| p.cloned()).ok_or_else(|| "Index settings unavailable".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn index_locations_pick(view: tauri::Webview) -> Result<Option<String>, String> {
    crate::ai::harness_tasks::local(&view)?;
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("选择索引目录 / Select index folder")
            .pick_folder()
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn index_locations_save(
    view: tauri::Webview,
    app: tauri::AppHandle,
    settings: Settings,
) -> Result<Policy, String> {
    crate::ai::harness_tasks::local(&view)?;
    tauri::async_runtime::spawn_blocking(move || {
        let store = STORE.get().ok_or("Index settings unavailable")?;
        let fixed = crate::fixed_drive_roots();
        let mut current = store.current.write().unwrap();
        let settings = settings.normalize(|folder| {
            let existing = current.settings.folders.iter().any(|p| path_key(p) == path_key(folder));
            if existing || (fixed.iter().any(|p| within(&path_key(folder), &path_key(p))) && ordinary_folder(folder)) { Ok(()) }
            else { Err(format!("请选择固定磁盘上的普通目录 / Choose an existing folder on a fixed drive: {folder}")) }
        })?;
        let next = Policy::new(settings, &fixed, None);
        if current.settings == next.settings && current.keys == next.keys && current.warning.is_none() { return Ok(current.clone()); }
        let bytes = serde_json::to_vec_pretty(&next.settings).map_err(|e| e.to_string())?;
        if bytes.len() > MAX_CONFIG_BYTES { return Err("索引位置设置超过 1 MiB / Index location settings exceed 1 MiB".into()); }
        persist_cache(&store.path, &bytes).map_err(|e| e.to_string())?;
        *current = next.clone();
        super::search_rebuild();
        super::ONDEMAND_GEN.fetch_add(1, Ordering::SeqCst);
        search::names().retain_locations(&next);
        drop(current);
        let _ = app.emit("index-locations-changed", ());
        Ok(next)
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn selected(paths: &[&str]) -> Settings {
        Settings {
            mode: Mode::Selected,
            folders: paths.iter().map(|p| p.to_string()).collect(),
            excluded: vec![],
        }
    }

    #[test]
    fn normalizes_roots_and_collapses_only_true_descendants() {
        let s = selected(&["c:/Docs/sub", r"C:\Docs\", r"c:\Docs-other", r"C:\DOCS"])
            .normalize(|_| Ok(()))
            .unwrap();
        assert_eq!(s.folders.len(), 2);
        let p = Policy::new(s, &[], None);
        assert!(p.includes("c:/dOCS/file"));
        assert!(p.includes(r"C:\DOCS-other"));
        assert!(!p.includes(r"C:\docs2"));
        assert!(!p.includes(r"C:\"));
        assert!(Policy::new(selected(&[r"C:\"]), &[], None).includes(r"C:\folder"));
        for bad in [
            r"\\server\share",
            r"\\?\C:\docs",
            r"C:docs",
            r"C:\..\docs",
            r"C:\doc:stream",
        ] {
            assert!(selected(&[bad]).normalize(|_| Ok(())).is_err(), "{bad}");
        }
    }

    #[test]
    fn missing_and_damaged_preferences_have_different_defaults_and_can_be_repaired() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("locations.json");
        let fixed = vec![r"C:\".into()];
        assert!(load(&path, &fixed).accepts_legacy());
        fs::write(&path, b"broken").unwrap();
        let damaged = load(&path, &fixed);
        assert!(damaged.warning.is_some() && damaged.roots.is_empty() && !damaged.accepts_legacy());
        persist_cache(
            &path,
            &serde_json::to_vec(&selected(&[r"D:\offline"])).unwrap(),
        )
        .unwrap();
        let repaired = load(&path, &fixed);
        assert_eq!(repaired.settings.folders, vec![r"D:\offline"]);
        assert!(repaired.warning.is_none());
    }

    #[test]
    fn exclusions_apply_to_fixed_and_selected_roots_and_keep_sibling_boundaries() {
        for mode in [Mode::Fixed, Mode::Selected] {
            let settings = Settings {
                mode,
                folders: vec![r"D:\work".into()],
                excluded: vec![r"d:/work/cache/tmp".into(), r"D:\WORK\cache".into()],
            };
            let settings = settings.normalize(|_| Ok(())).unwrap();
            assert_eq!(settings.excluded.len(), 1);
            let policy = Policy::new(settings, &[r"D:\".into()], None);
            assert!(policy.includes(r"D:\work\cache-old"));
            assert!(!policy.includes(r"D:\work\cache\new.txt"));
            assert_eq!(policy.coverage(r"D:\work"), Coverage::Partial);
            assert_eq!(policy.coverage(r"D:\work\cache"), Coverage::Excluded);
            assert_eq!(policy.coverage(r"D:\work\cache-x"), Coverage::Full);
            assert!(policy
                .hidden_children(r"D:\work")
                .unwrap()
                .contains("cache"));
            assert!(!policy.accepts_legacy());
        }
    }
}
