// Everything-style preloaded folder-size index.
//
// One low-priority traversal feeds both directory totals and the file-name index.
// Recently validated persistent caches are reused immediately; recursive watchers
// maintain running-session changes and one delayed startup pass checks offline edits.

#[path = "search.rs"]
mod search;
pub use search::{SearchResponse, SearchStatus};

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{mpsc, Condvar, Mutex, OnceLock, RwLock};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_NO_MORE_FILES};
use windows::Win32::Storage::FileSystem::{
    FindClose, FindExInfoBasic, FindExSearchNameMatch, FindFirstFileExW, FindNextFileW,
    FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT, FIND_FIRST_EX_LARGE_FETCH,
    WIN32_FIND_DATAW,
};
use windows::Win32::System::Threading::{
    GetCurrentThread, SetThreadPriority, THREAD_MODE_BACKGROUND_BEGIN, THREAD_PRIORITY_LOWEST,
};

use crate::{utf16_to_string, wide};

const SNAPSHOT_VERSION: u32 = 1;
const MAX_SNAPSHOT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_SNAPSHOT_ENTRIES: usize = 500_000;

fn path_key(path: &str) -> String {
    let mut key = path.replace('/', "\\").to_lowercase();
    while key.ends_with('\\') && key.len() > 3 {
        key.pop();
    }
    key
}

#[derive(Default)]
struct SizeIndex {
    map: RwLock<BTreeMap<String, u64>>,
    revision: AtomicU64,
}

impl SizeIndex {
    fn get(&self, key: &str) -> Option<u64> {
        self.map.read().unwrap().get(&path_key(key)).copied()
    }
    fn put(&self, key: &str, value: u64) {
        let mut map = self.map.write().unwrap();
        if map.insert(path_key(key), value) != Some(value) {
            self.revision.fetch_add(1, Ordering::Relaxed);
        }
    }
    fn remove_tree(&self, path: &str) -> Option<u64> {
        let key = path_key(path);
        let prefix = format!("{}\\", key.trim_end_matches('\\'));
        let mut map = self.map.write().unwrap();
        // Prefix range avoids scanning the entire index for ordinary file events.
        let descendants: Vec<_> = map
            .range(prefix.clone()..)
            .take_while(|(path, _)| path.starts_with(&prefix))
            .map(|(path, _)| path.clone())
            .collect();
        let old = map.remove(&key);
        if old.is_some() || !descendants.is_empty() {
            for path in descendants {
                map.remove(&path);
            }
            self.revision.fetch_add(1, Ordering::Relaxed);
        }
        old
    }
    fn lookup_many(&self, paths: &[String]) -> Vec<Option<u64>> {
        let map = self.map.read().unwrap();
        paths
            .iter()
            .map(|p| map.get(&path_key(p)).copied())
            .collect()
    }
    fn restore(&self, entries: HashMap<String, u64>) {
        let mut entries = entries.into_iter();
        loop {
            let batch: Vec<_> = entries
                .by_ref()
                .take(1024)
                .map(|(path, size)| (path_key(&path), size))
                .collect();
            if batch.is_empty() {
                break;
            }
            {
                let mut map = self.map.write().unwrap();
                for (path, size) in batch {
                    map.entry(path).or_insert(size);
                }
            }
            std::thread::yield_now();
        }
        self.revision.fetch_add(1, Ordering::Relaxed);
    }
    fn snapshot(&self) -> Snapshot {
        Snapshot {
            version: SNAPSHOT_VERSION,
            entries: self
                .map
                .read()
                .unwrap()
                .iter()
                .map(|(path, size)| (path.clone(), *size))
                .collect(),
        }
    }
}

#[derive(Serialize, Deserialize)]
struct Snapshot {
    version: u32,
    entries: HashMap<String, u64>,
}

fn read_snapshot(path: &Path) -> io::Result<Snapshot> {
    let file = std::fs::File::open(path)?;
    if file.metadata()?.len() > MAX_SNAPSHOT_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "size cache is too large",
        ));
    }
    let mut bytes = Vec::new();
    file.take(MAX_SNAPSHOT_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_SNAPSHOT_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "size cache is too large",
        ));
    }
    let snapshot: Snapshot = serde_json::from_slice(&bytes)?;
    if snapshot.version != SNAPSHOT_VERSION
        || snapshot.entries.len() > MAX_SNAPSHOT_ENTRIES
        || snapshot
            .entries
            .keys()
            .any(|p| !Path::new(p).is_absolute() || p.starts_with("\\\\") || p.contains('\0'))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "unsupported size cache",
        ));
    }
    Ok(snapshot)
}

fn write_snapshot(path: &Path, snapshot: &Snapshot) -> io::Result<()> {
    // Serialize outside all index locks; a failed write leaves the previous cache intact.
    let bytes = serde_json::to_vec(snapshot)?;
    if bytes.len() as u64 > MAX_SNAPSHOT_BYTES || snapshot.entries.len() > MAX_SNAPSHOT_ENTRIES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "size cache is too large",
        ));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temp = path.with_extension(format!("{}.tmp", std::process::id()));
    let mut file = std::fs::File::create(&temp)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    drop(file);
    // std::fs::rename uses replace-existing semantics on Windows too.
    std::fs::rename(temp, path)
}

static INDEX: OnceLock<SizeIndex> = OnceLock::new();
static CACHE_PATH: OnceLock<PathBuf> = OnceLock::new();
static SCAN_IO: Mutex<()> = Mutex::new(());
static SNAPSHOT_WRITE: Mutex<()> = Mutex::new(());
static WATCH_OVERFLOW: AtomicBool = AtomicBool::new(false);

#[derive(Default)]
struct Changes {
    sequence: u64,
    fallback: u64,
    versions: HashMap<String, u64>,
    structures: HashMap<String, u64>,
    retry: HashSet<String>,
}
static CHANGES: OnceLock<Mutex<Changes>> = OnceLock::new();
fn changes() -> &'static Mutex<Changes> {
    CHANGES.get_or_init(|| Mutex::new(Changes::default()))
}
impl Changes {
    fn version(&self, path: &str) -> u64 {
        let own = self
            .versions
            .get(&path_key(path))
            .copied()
            .unwrap_or(self.fallback);
        Path::new(path)
            .ancestors()
            .filter_map(|ancestor| {
                self.structures
                    .get(&path_key(&ancestor.to_string_lossy()))
                    .copied()
            })
            .fold(own, u64::max)
    }
    fn record(&mut self, paths: &[PathBuf], overflow: bool, structural: bool) {
        self.sequence += 1;
        if overflow || self.versions.len() + self.structures.len() > 100_000 {
            self.versions.clear();
            self.structures.clear();
            self.fallback = self.sequence;
        }
        for path in paths {
            if structural {
                self.structures
                    .insert(path_key(&path.to_string_lossy()), self.sequence);
            }
            for ancestor in path.ancestors() {
                self.versions
                    .insert(path_key(&ancestor.to_string_lossy()), self.sequence);
            }
        }
    }
    fn retry(&mut self, path: &str) {
        for ancestor in Path::new(path).ancestors() {
            self.retry.insert(ancestor.to_string_lossy().into_owned());
        }
        if self.retry.len() > 8192 {
            self.retry.clear();
            WATCH_OVERFLOW.store(true, Ordering::SeqCst);
        }
    }
}

// Commit against the version of this subtree, so unrelated disk writes cannot
// starve a scan. Holding this small lock closes the version-check/publish race.
fn publish_scan(path: &str, version: u64, size: u64) -> Option<u64> {
    let mut changes = changes().lock().unwrap();
    if changes.version(path) == version {
        idx().put(path, size);
        search::names().mark_verified(path, size);
        Some(size)
    } else {
        changes.retry(path);
        idx().get(path)
    }
}

fn idx() -> &'static SizeIndex {
    INDEX.get_or_init(SizeIndex::default)
}

pub(crate) fn cached_sizes(paths: &[String]) -> Vec<Option<u64>> {
    idx().lookup_many(paths)
}

pub(crate) fn flush_cache() -> io::Result<()> {
    let _writer = SNAPSHOT_WRITE.lock().unwrap();
    if let Some(path) = CACHE_PATH.get() {
        write_snapshot(path, &idx().snapshot())?;
        if let Some(parent) = path.parent() {
            search::names().save(&search::cache_path(parent))?;
        }
    }
    Ok(())
}

#[cfg(test)]
pub(crate) fn seed_for_listing_test(path: &str, size: u64) {
    idx().put(path, size);
}

fn start_cache_maintenance(app: AppHandle) {
    std::thread::spawn(move || {
        run_lowest_priority();
        let mut emitted = (0, 0);
        let mut persisted = (0, 0);
        let mut last_save = Instant::now();
        loop {
            std::thread::sleep(Duration::from_millis(500));
            let revision = (
                idx().revision.load(Ordering::Relaxed),
                search::names().revision.load(Ordering::Relaxed),
            );
            if revision != emitted {
                let _ = app.emit("index-updated", ());
                emitted = revision;
            }
            // A name index may contain a million records. Batch snapshots so
            // active log files do not cause large JSON writes every few seconds.
            if revision != persisted && last_save.elapsed() >= Duration::from_secs(60) {
                last_save = Instant::now();
                if flush_cache().is_ok() {
                    persisted = revision;
                }
            }
        }
    });
}

// A walk aborts when its slot no longer holds its gen. On-demand batches and
// the preload/event-maintenance walks cancel only their own kind.
static ONDEMAND_GEN: AtomicU64 = AtomicU64::new(0);
static PRELOAD_GEN: AtomicU64 = AtomicU64::new(0);
static MAINTENANCE_GEN: AtomicU64 = AtomicU64::new(0);
static BUSY_WALKS: AtomicUsize = AtomicUsize::new(0);

fn busy_enter(app: &AppHandle) {
    if BUSY_WALKS.fetch_add(1, Ordering::SeqCst) == 0 {
        let _ = app.emit("index-busy", true);
    }
}
fn busy_exit(app: &AppHandle) {
    if BUSY_WALKS.fetch_sub(1, Ordering::SeqCst) == 1 {
        let _ = app.emit("index-busy", false);
    }
}

fn child_path(dir: &str, name: &str) -> String {
    if dir.ends_with('\\') {
        format!("{}{}", dir, name)
    } else {
        format!("{}\\{}", dir, name)
    }
}

struct DirScan {
    files: u64,
    subdirs: Vec<String>,
    entries: Vec<search::Entry>,
}

fn scan_dir(dir: &str) -> Option<DirScan> {
    // Background scans serialize directory I/O, never UI enumeration or index reads.
    let _io = SCAN_IO.lock().unwrap();
    unsafe {
        let pattern = child_path(dir, "*");
        let patw = wide(&pattern);
        let mut fd = WIN32_FIND_DATAW::default();
        let h = match FindFirstFileExW(
            PCWSTR::from_raw(patw.as_ptr()),
            FindExInfoBasic,
            &mut fd as *mut _ as *mut core::ffi::c_void,
            FindExSearchNameMatch,
            None,
            FIND_FIRST_EX_LARGE_FETCH,
        ) {
            Ok(h) => h,
            Err(e)
                if e.code() == windows::core::HRESULT::from_win32(ERROR_FILE_NOT_FOUND.0)
                    && Path::new(dir).is_dir() =>
            {
                return Some(DirScan {
                    files: 0,
                    subdirs: Vec::new(),
                    entries: Vec::new(),
                })
            }
            Err(_) => return None,
        };
        let mut files: u64 = 0;
        let mut subdirs: Vec<String> = Vec::new();
        let mut entries = Vec::new();
        loop {
            let name = utf16_to_string(&fd.cFileName);
            if name != "." && name != ".." {
                let attrs = fd.dwFileAttributes;
                let is_dir = attrs & FILE_ATTRIBUTE_DIRECTORY.0 != 0;
                let size = ((fd.nFileSizeHigh as u64) << 32) | fd.nFileSizeLow as u64;
                entries.push(search::Entry::new(
                    name.clone(),
                    is_dir,
                    size,
                    crate::filetime_to_unix_ms(&fd.ftLastWriteTime),
                    attrs & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0,
                ));
                if attrs & FILE_ATTRIBUTE_REPARSE_POINT.0 == 0 {
                    if is_dir {
                        subdirs.push(child_path(dir, &name));
                    } else {
                        files = files.saturating_add(size);
                    }
                }
            }
            if let Err(e) = FindNextFileW(h, &mut fd) {
                let _ = FindClose(h);
                if e.code() != windows::core::HRESULT::from_win32(ERROR_NO_MORE_FILES.0) {
                    return None;
                }
                return Some(DirScan {
                    files,
                    subdirs,
                    entries,
                });
            }
        }
    }
}

fn scan_and_index(dir: &str, version: u64) -> Option<(DirScan, bool)> {
    let mut scan = scan_dir(dir)?;
    let mut changes = changes().lock().unwrap();
    let unchanged = if changes.version(dir) == version {
        let (same, removed) = search::names().update(dir, std::mem::take(&mut scan.entries));
        for path in removed {
            idx().remove_tree(&path);
            search::names().remove_tree(&path);
        }
        same
    } else {
        changes.retry(dir);
        false
    };
    Some((scan, unchanged))
}

fn scan_allowed(path: &str) -> bool {
    if path.starts_with("\\\\") || !Path::new(path).is_absolute() {
        return false;
    }
    use std::os::windows::fs::MetadataExt;
    std::fs::symlink_metadata(path)
        .is_ok_and(|m| m.is_dir() && m.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 == 0)
}

/// A failed/incomplete scan never overwrites a known value with zero.
/// Continue other branches so protected system directories cannot halt a drive preload.
fn walk_dir(dir: &str, my_gen: u64, slot: &AtomicU64) -> Option<u64> {
    walk_validated(dir, my_gen, slot).0
}

// Validate direct children at every level; a parent timestamp alone cannot prove
// that a descendant file is unchanged. Identical branches reuse their old totals.
fn walk_validated(dir: &str, my_gen: u64, slot: &AtomicU64) -> (Option<u64>, bool) {
    if slot.load(Ordering::Relaxed) != my_gen {
        return (None, false);
    }
    let version = changes().lock().unwrap().version(dir);
    let Some((scan, mut unchanged)) = scan_and_index(dir, version) else {
        return (idx().get(dir), false);
    };
    let mut complete = true;
    let mut children = Vec::with_capacity(scan.subdirs.len());
    for sd in scan.subdirs {
        if slot.load(Ordering::Relaxed) != my_gen {
            return (None, false);
        }
        let (value, same) = walk_validated(&sd, my_gen, slot);
        unchanged &= same;
        match value {
            Some(value) => children.push(value),
            None => complete = false,
        }
        std::thread::yield_now();
    }
    if slot.load(Ordering::Relaxed) != my_gen {
        return (None, false);
    }
    if complete && unchanged {
        let mut changes = changes().lock().unwrap();
        if changes.version(dir) == version {
            if let Some(value) = idx()
                .get(dir)
                .filter(|value| search::names().verified_size(dir) == Some(*value))
            {
                return (Some(value), true);
            }
        } else {
            changes.retry(dir);
        }
    }
    if complete {
        let total = children.into_iter().fold(scan.files, u64::saturating_add);
        (publish_scan(dir, version, total), false)
    } else {
        if changes().lock().unwrap().version(dir) != version {
            changes().lock().unwrap().retry(dir);
        }
        (idx().get(dir), false)
    }
}

fn smart_recompute(dir: &str, my_gen: u64, slot: &AtomicU64) -> Option<u64> {
    if slot.load(Ordering::Relaxed) != my_gen {
        return None;
    }
    let version = changes().lock().unwrap().version(dir);
    let Some((scan, _)) = scan_and_index(dir, version) else {
        return idx().get(dir);
    };
    let mut total = scan.files;
    let mut complete = true;
    for sd in scan.subdirs {
        if slot.load(Ordering::Relaxed) != my_gen {
            return None;
        }
        match idx().get(&sd).or_else(|| walk_dir(&sd, my_gen, slot)) {
            Some(value) => total = total.saturating_add(value),
            None => complete = false,
        }
    }
    if complete {
        publish_scan(dir, version, total)
    } else {
        if changes().lock().unwrap().version(dir) != version {
            changes().lock().unwrap().retry(dir);
        }
        idx().get(dir)
    }
}

#[tauri::command]
pub async fn sizes_lookup(paths: Vec<String>) -> Result<Vec<Option<u64>>, String> {
    tauri::async_runtime::spawn_blocking(move || cached_sizes(&paths))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn search_files(
    query: String,
    limit: Option<usize>,
    scope: Option<String>,
) -> Result<SearchResponse, String> {
    let generation = search::query_generation();
    tauri::async_runtime::spawn_blocking(move || {
        search::names().search(&query, scope.as_deref(), limit.unwrap_or(200), || {
            !search::query_current(generation)
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn search_status() -> SearchStatus {
    search::names().status()
}

#[derive(Default)]
struct RebuildSignal {
    pending: Mutex<bool>,
    ready: Condvar,
}
static REBUILD: OnceLock<RebuildSignal> = OnceLock::new();
fn rebuild_signal() -> &'static RebuildSignal {
    REBUILD.get_or_init(RebuildSignal::default)
}

#[tauri::command]
pub fn search_rebuild() {
    let signal = rebuild_signal();
    *signal.pending.lock().unwrap() = true;
    PRELOAD_GEN.fetch_add(1, Ordering::SeqCst);
    signal.ready.notify_one();
}

struct SizeRequest {
    gen: u64,
    slot_gen: u64,
    paths: Vec<String>,
    force: bool,
    app: AppHandle,
}
#[derive(Default)]
struct DemandQueue {
    pending: Mutex<Option<SizeRequest>>,
    ready: Condvar,
}
static DEMAND: OnceLock<DemandQueue> = OnceLock::new();

/// One worker and one replaceable pending batch bound work across rapid navigation.
#[tauri::command]
pub fn dir_sizes(gen: u64, paths: Vec<String>, force: Option<bool>, app: AppHandle) {
    let queue = DEMAND.get_or_init(|| {
        std::thread::spawn(demand_worker);
        DemandQueue::default()
    });
    let mut pending = queue.pending.lock().unwrap();
    let slot_gen = ONDEMAND_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    *pending = if paths.is_empty() {
        None
    } else {
        Some(SizeRequest {
            gen,
            slot_gen,
            paths,
            force: force.unwrap_or(false),
            app,
        })
    };
    drop(pending);
    queue.ready.notify_one();
}

fn demand_worker() {
    run_lowest_priority();
    // The spawned thread may run before get_or_init has published its result.
    let queue = loop {
        if let Some(queue) = DEMAND.get() {
            break queue;
        }
        std::thread::yield_now();
    };
    loop {
        let request = {
            let mut pending = queue.pending.lock().unwrap();
            while pending.is_none() {
                pending = queue.ready.wait(pending).unwrap();
            }
            pending.take().unwrap()
        };
        busy_enter(&request.app);
        let mut seen = HashSet::new();
        for path in request.paths {
            if ONDEMAND_GEN.load(Ordering::Relaxed) != request.slot_gen {
                break;
            }
            if !seen.insert(path_key(&path)) {
                continue;
            }
            let value = if !scan_allowed(&path) {
                None
            } else {
                (if request.force {
                    None
                } else {
                    idx().get(&path)
                })
                .or_else(|| walk_dir(&path, request.slot_gen, &ONDEMAND_GEN))
            };
            if ONDEMAND_GEN.load(Ordering::Relaxed) != request.slot_gen {
                break;
            }
            let _ = request.app.emit(
                "dir-size",
                serde_json::json!({ "gen": request.gen, "path": path, "size": value }),
            );
        }
        busy_exit(&request.app);
    }
}

fn run_lowest_priority() {
    unsafe {
        if SetThreadPriority(GetCurrentThread(), THREAD_MODE_BACKGROUND_BEGIN).is_err() {
            let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_LOWEST);
        }
    }
}

/// Restore first, watch immediately, and perform only one automatic startup check.
pub fn startup(app: &AppHandle) {
    run_lowest_priority();
    if let Ok(directory) = app.path().app_cache_dir() {
        let path = directory.join("folder-sizes-v1.json");
        let _ = CACHE_PATH.set(path.clone());
        if let Ok(snapshot) = read_snapshot(&path) {
            idx().restore(snapshot.entries);
        }
        let _ = search::names().restore(&search::cache_path(&directory));
    }
    start_cache_maintenance(app.clone());
    let _ = app.emit("index-updated", ());
    let roots = crate::fixed_drive_roots();
    start_index_watchers(app, roots.clone());
    let signal = rebuild_signal();
    let validated = search::names().validated_ms.load(Ordering::Relaxed);
    let now = search::now_ms();
    let due = if validated > 0 {
        validated.saturating_add(search::REVALIDATE_AFTER_MS)
    } else {
        now
    };
    search::names()
        .next_validation_ms
        .store(due.max(now), Ordering::Relaxed);
    if due > now {
        let pending = signal.pending.lock().unwrap();
        let _ =
            signal
                .ready
                .wait_timeout_while(pending, Duration::from_millis(due - now), |pending| {
                    !*pending
                });
    }
    loop {
        *signal.pending.lock().unwrap() = false;
        search::names().active.store(true, Ordering::Relaxed);
        search::names()
            .next_validation_ms
            .store(0, Ordering::Relaxed);
        let _ = app.emit("index-updated", ());
        let gen = PRELOAD_GEN.fetch_add(1, Ordering::SeqCst) + 1;
        busy_enter(app);
        for root in &roots {
            if PRELOAD_GEN.load(Ordering::Relaxed) != gen {
                break;
            }
            walk_dir(root, gen, &PRELOAD_GEN);
        }
        busy_exit(app);
        if PRELOAD_GEN.load(Ordering::Relaxed) == gen {
            search::names()
                .validated_ms
                .store(search::now_ms(), Ordering::Relaxed);
            search::names().revision.fetch_add(1, Ordering::Relaxed);
        }
        search::names().active.store(false, Ordering::Relaxed);
        let _ = app.emit("index-updated", ());
        let _ = flush_cache();
        let mut pending = signal.pending.lock().unwrap();
        while !*pending {
            pending = signal.ready.wait(pending).unwrap();
        }
    }
}

enum WatchMsg {
    Change {
        paths: Vec<PathBuf>,
        invalidate: bool,
    },
    Dead,
}

fn start_index_watchers(app: &AppHandle, roots: Vec<String>) {
    static KEEP: OnceLock<Mutex<Vec<notify::RecommendedWatcher>>> = OnceLock::new();
    let keep = KEEP.get_or_init(|| Mutex::new(Vec::new()));

    let (tx, rx) = mpsc::sync_channel::<WatchMsg>(1024);
    let mut guards = keep.lock().unwrap();
    for root in roots.iter() {
        let tx2 = tx.clone();
        let Ok(mut w) = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            let msg = match res {
                Ok(ev) => {
                    if !ev.need_rescan()
                        && !ev.paths.is_empty()
                        && ev.paths.iter().all(|p| is_cache_path(p))
                    {
                        return;
                    }
                    if ev.need_rescan() {
                        changes().lock().unwrap().record(&[], true, false);
                        WatchMsg::Dead
                    } else {
                        let invalidate = matches!(
                            ev.kind,
                            notify::EventKind::Create(_)
                                | notify::EventKind::Remove(_)
                                | notify::EventKind::Modify(notify::event::ModifyKind::Name(_))
                        );
                        changes()
                            .lock()
                            .unwrap()
                            .record(&ev.paths, false, invalidate);
                        WatchMsg::Change {
                            paths: ev.paths,
                            invalidate,
                        }
                    }
                }
                Err(_) => {
                    changes().lock().unwrap().record(&[], true, false);
                    WatchMsg::Dead
                }
            };
            if tx2.try_send(msg).is_err() {
                WATCH_OVERFLOW.store(true, Ordering::SeqCst);
            }
        }) else {
            continue;
        };
        if notify::Watcher::watch(&mut w, Path::new(root), notify::RecursiveMode::Recursive)
            .is_err()
        {
            continue;
        }
        guards.push(w);
    }
    drop(guards);
    if keep.lock().unwrap().is_empty() {
        return;
    }

    let app = app.clone();
    std::thread::spawn(move || {
        run_lowest_priority();
        loop {
            // Collect a batch and wait for it to go quiet before recomputing.
            let mut affected = std::mem::take(&mut changes().lock().unwrap().retry);
            let mut dead = WATCH_OVERFLOW.swap(false, Ordering::SeqCst);
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(msg) => collect(&mut affected, &mut dead, msg),
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(mpsc::RecvTimeoutError::Timeout) if affected.is_empty() && !dead => continue,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            let deadline = Instant::now() + Duration::from_secs(2);
            while Instant::now() < deadline {
                match rx.recv_timeout(std::time::Duration::from_millis(700)) {
                    Ok(m) => collect(&mut affected, &mut dead, m),
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                }
            }
            let mut affected: Vec<_> = affected.into_iter().collect();
            affected.sort_by_key(|path| std::cmp::Reverse(path.len()));
            for a in affected {
                maintain_one(&app, &a);
            }
            if dead {
                // a watcher overflowed: rebuild the indexes of all drives
                for root in roots.iter() {
                    let gen = MAINTENANCE_GEN.fetch_add(1, Ordering::SeqCst) + 1;
                    busy_enter(&app);
                    walk_dir(root, gen, &MAINTENANCE_GEN);
                    busy_exit(&app);
                }
            }
        }
    });
}

fn is_cache_path(path: &Path) -> bool {
    CACHE_PATH.get().is_some_and(|cache| {
        cache.parent().is_some_and(|parent| {
            let key = path_key(&path.to_string_lossy());
            let parent = path_key(&parent.to_string_lossy());
            key == parent || key.starts_with(&(parent + "\\"))
        })
    })
}

fn collect(affected: &mut HashSet<String>, dead: &mut bool, msg: WatchMsg) {
    match msg {
        WatchMsg::Change { paths, invalidate } => {
            for p in paths {
                if is_cache_path(&p) {
                    continue;
                }
                let path = p.to_string_lossy();
                let cached = idx().get(&path).is_some();
                if invalidate || (cached && !p.exists()) {
                    idx().remove_tree(&path);
                    search::names().remove_tree(&path);
                }
                if (invalidate || cached) && p.is_dir() {
                    affected.insert(path.to_string());
                }
                // Recompute ancestors bottom-up instead of adding deltas: a concurrent
                // preload can also publish new values, making a delta double-count.
                let mut parent = p.parent();
                while let Some(dir) = parent {
                    let key = dir.to_string_lossy();
                    if idx().get(&key).is_some() || search::names().contains(&key) {
                        affected.insert(key.to_string());
                    }
                    parent = dir.parent();
                }
            }
        }
        WatchMsg::Dead => *dead = true,
    }
}

fn maintain_one(app: &AppHandle, dir: &str) {
    if !Path::new(dir).is_dir() {
        idx().remove_tree(dir);
        search::names().remove_tree(dir);
        return;
    }
    if !scan_allowed(dir) {
        return;
    }
    let gen = MAINTENANCE_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    busy_enter(app);
    smart_recompute(dir, gen, &MAINTENANCE_GEN);
    busy_exit(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempCache(PathBuf);
    impl TempCache {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "dalizi-size-cache-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn file(&self) -> PathBuf {
            self.0.join("folder-sizes-v1.json")
        }
    }
    impl Drop for TempCache {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(self.file());
            let _ = std::fs::remove_file(
                self.file()
                    .with_extension(format!("{}.tmp", std::process::id())),
            );
            let _ = std::fs::remove_dir(&self.0);
        }
    }

    #[test]
    fn lookup_normalizes_case_separators_and_trailing_slash() {
        let index = SizeIndex::default();
        index.put(r"C:\Projects\Example", 42);
        assert_eq!(
            index.lookup_many(&["c:/projects/example/".into(), r"C:\missing".into()]),
            vec![Some(42), None]
        );
        index.put(r"C:\", 7);
        assert_eq!(index.get("c:/"), Some(7));
    }

    #[test]
    fn subtree_invalidation_preserves_similarly_named_siblings() {
        let index = SizeIndex::default();
        index.put(r"C:\folder", 10);
        index.put(r"C:\folder\child", 8);
        index.put(r"C:\folder-other", 99);
        assert_eq!(index.remove_tree("c:/folder/"), Some(10));
        assert_eq!(index.get(r"C:\folder\child"), None);
        assert_eq!(index.get(r"C:\folder-other"), Some(99));
    }

    #[test]
    fn restore_merges_batches_without_replacing_live_results() {
        let index = SizeIndex::default();
        index.put(r"C:\live", 200);
        let mut entries: HashMap<_, _> =
            (0..2500).map(|n| (format!(r"C:\cached\{n}"), n)).collect();
        entries.insert("c:/LIVE/".into(), 100);
        index.restore(entries);
        assert_eq!(index.get(r"C:\live"), Some(200));
        assert_eq!(index.get(r"C:\cached\2499"), Some(2499));
    }

    #[test]
    fn snapshot_roundtrip_replaces_existing_file() {
        let temp = TempCache::new();
        let index = SizeIndex::default();
        index.put(r"C:\test", 123);
        write_snapshot(&temp.file(), &index.snapshot()).unwrap();
        index.put(r"C:\test", 456);
        write_snapshot(&temp.file(), &index.snapshot()).unwrap();
        let restored = SizeIndex::default();
        restored.restore(read_snapshot(&temp.file()).unwrap().entries);
        assert_eq!(restored.get(r"C:\test"), Some(456));
        assert!(!temp
            .file()
            .with_extension(format!("{}.tmp", std::process::id()))
            .exists());
    }

    #[test]
    fn snapshot_rejects_corrupt_unsupported_and_oversized_data() {
        let temp = TempCache::new();
        for bytes in [
            br#"{"broken":"#.as_slice(),
            br#"{"version":2,"entries":{}}"#.as_slice(),
            br#"{"version":1,"entries":{"relative":12}}"#.as_slice(),
        ] {
            std::fs::write(temp.file(), bytes).unwrap();
            assert!(read_snapshot(&temp.file()).is_err());
        }
        std::fs::File::create(temp.file())
            .unwrap()
            .set_len(MAX_SNAPSHOT_BYTES + 1)
            .unwrap();
        assert_eq!(
            read_snapshot(&temp.file()).err().unwrap().kind(),
            io::ErrorKind::InvalidData
        );
    }

    #[test]
    fn changes_invalidate_only_the_changed_subtree_and_its_ancestors() {
        let mut changes = Changes::default();
        let unrelated = changes.version(r"D:\other");
        changes.record(&[PathBuf::from(r"C:\folder\file.txt")], false, false);
        assert_ne!(changes.version(r"C:\folder"), 0);
        assert_ne!(changes.version(r"C:\"), 0);
        assert_eq!(changes.version(r"C:\sibling"), 0);
        assert_eq!(changes.version(r"D:\other"), unrelated);
        changes.retry(r"C:\folder\child");
        assert!(changes.retry.contains(r"C:\folder"));
        assert!(changes.retry.contains(r"C:\"));
    }

    #[test]
    fn structural_event_discards_cached_descendants_even_if_directory_still_exists() {
        let temp = TempCache::new();
        let path = temp.0.to_string_lossy().into_owned();
        idx().put(&path, 900);
        let child = temp.0.join("old-child").to_string_lossy().into_owned();
        idx().put(&child, 900);
        let mut affected = HashSet::new();
        collect(
            &mut affected,
            &mut false,
            WatchMsg::Change {
                paths: vec![temp.0.clone()],
                invalidate: true,
            },
        );
        assert_eq!(idx().get(&path), None);
        assert_eq!(idx().get(&child), None);
        assert!(affected.contains(&path));
    }

    #[test]
    fn structural_event_invalidates_partial_subtree_without_parent_total() {
        let temp = TempCache::new();
        let child = temp.0.join("old-child").to_string_lossy().into_owned();
        idx().put(&child, 900);
        let mut affected = HashSet::new();
        collect(
            &mut affected,
            &mut false,
            WatchMsg::Change {
                paths: vec![temp.0.clone()],
                invalidate: true,
            },
        );
        assert_eq!(idx().get(&child), None);
        assert!(affected.contains(&temp.0.to_string_lossy().into_owned()));
    }

    #[test]
    fn structural_change_invalidates_active_descendant_scans() {
        let mut changes = Changes::default();
        let before = changes.version(r"C:\folder\child");
        changes.record(&[PathBuf::from(r"C:\folder")], false, true);
        assert_ne!(changes.version(r"C:\folder\child"), before);
        assert_eq!(changes.version(r"C:\folder-other\child"), before);
        // A newly created file does not invalidate scans of its sibling folder.
        let sibling = changes.version(r"C:\folder\other");
        changes.record(&[PathBuf::from(r"C:\folder\file.txt")], false, true);
        assert_eq!(changes.version(r"C:\folder\other"), sibling);
    }

    #[test]
    fn interrupted_publish_preserves_live_value_and_retries_ancestors() {
        let temp = TempCache::new();
        let path = temp.0.to_string_lossy().into_owned();
        let version = changes().lock().unwrap().version(&path);
        idx().put(&path, 200);
        changes()
            .lock()
            .unwrap()
            .record(&[temp.0.join("new-file")], false, false);
        assert_eq!(publish_scan(&path, version, 100), Some(200));
        assert!(changes().lock().unwrap().retry.contains(&path));
        idx().remove_tree(&path);
    }

    #[test]
    fn revalidation_reuses_unchanged_totals_but_detects_nested_and_interrupted_edits() {
        let temp = TempCache::new();
        let root = temp.0.to_string_lossy().into_owned();
        let child = temp.0.join("child");
        std::fs::create_dir(&child).unwrap();
        let file = child.join("file.txt");
        std::fs::write(&file, b"one").unwrap();
        let slot = AtomicU64::new(1);
        assert_eq!(walk_validated(&root, 1, &slot), (Some(3), false));
        assert_eq!(walk_validated(&root, 1, &slot), (Some(3), true));
        std::fs::write(&file, b"longer content").unwrap();
        // Simulate cancellation after directory metadata was indexed but before
        // the revised child size and its ancestor totals were published.
        let child_name = child.to_string_lossy();
        let version = changes().lock().unwrap().version(&child_name);
        assert!(!scan_and_index(&child_name, version).unwrap().1);
        assert_eq!(walk_validated(&root, 1, &slot), (Some(14), false));
        assert_eq!(walk_validated(&root, 1, &slot), (Some(14), true));
        std::fs::remove_file(file).unwrap();
        std::fs::remove_dir(child).unwrap();
        idx().remove_tree(&root);
        search::names().remove_tree(&root);
    }
}
