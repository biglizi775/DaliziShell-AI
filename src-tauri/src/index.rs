// Everything-style preloaded folder-size index.
//
// One low-priority traversal feeds both directory totals and the file-name index.
// Recently validated persistent caches are reused immediately; recursive watchers
// maintain running-session changes and one delayed startup pass checks offline edits.

#[path = "index_locations.rs"]
pub(crate) mod locations;
#[path = "search.rs"]
mod search;
pub use search::{SearchKind, SearchResponse, SearchStatus};

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

const SNAPSHOT_VERSION: u32 = 2;
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
    map: RwLock<BTreeMap<String, SizeReading>>,
    revision: AtomicU64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum SizeBasis {
    Measured,
    Aggregate,
    Incomplete,
    Unknown,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SizeReading {
    pub(crate) size: u64,
    verified_at: Option<u64>,
    basis: SizeBasis,
    restored: bool,
    serial: u64,
}

// Version one stored plain byte counts. Never give a migrated count the
// timestamp of the migration, the cache file, or the global drive scan.
#[derive(Serialize, Deserialize)]
#[serde(untagged)]
enum StoredSize {
    Stamped((u64, Option<u64>, SizeBasis)),
    Legacy(u64),
}
impl StoredSize {
    fn restored(self) -> SizeReading {
        let (size, verified_at, basis) = match self {
            Self::Stamped(tuple) => tuple,
            Self::Legacy(size) => (size, None, SizeBasis::Unknown),
        };
        SizeReading {
            size,
            verified_at,
            basis,
            restored: true,
            serial: 0,
        }
    }
}
impl SizeIndex {
    fn get(&self, key: &str) -> Option<u64> {
        self.reading(key).map(|r| r.size)
    }
    fn reading(&self, key: &str) -> Option<SizeReading> {
        self.map.read().unwrap().get(&path_key(key)).copied()
    }
    #[cfg(test)]
    fn put(&self, key: &str, value: u64) {
        self.record(key, value, SizeBasis::Measured, search::now_ms());
    }
    fn record(&self, key: &str, size: u64, basis: SizeBasis, now: u64) {
        let mut map = self.map.write().unwrap();
        let key = path_key(key);
        let old = map.get(&key);
        let verified_at = if basis == SizeBasis::Measured {
            Some(now)
        } else {
            old.and_then(|r| r.verified_at)
        };
        if old.is_some_and(|r| {
            r.size == size && r.basis == basis && r.verified_at == verified_at && !r.restored
        }) {
            return;
        }
        let serial = self.revision.fetch_add(1, Ordering::Relaxed) + 1;
        map.insert(
            key,
            SizeReading {
                size,
                verified_at,
                basis,
                restored: false,
                serial,
            },
        );
    }
    fn incomplete(&self, path: &str) {
        if let Some(reading) = self.map.write().unwrap().get_mut(&path_key(path)) {
            if reading.basis != SizeBasis::Incomplete {
                reading.basis = SizeBasis::Incomplete;
                reading.serial = self.revision.fetch_add(1, Ordering::Relaxed) + 1;
            }
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
        old.map(|r| r.size)
    }
    fn lookup_many(&self, paths: &[String]) -> Vec<Option<u64>> {
        let map = self.map.read().unwrap();
        paths
            .iter()
            .map(|p| map.get(&path_key(p)).map(|r| r.size))
            .collect()
    }
    fn readings(&self, paths: &[String]) -> Vec<Option<SizeReading>> {
        let map = self.map.read().unwrap();
        paths
            .iter()
            .map(|p| map.get(&path_key(p)).copied())
            .collect()
    }
    fn restore(&self, entries: HashMap<String, StoredSize>) {
        let mut entries = entries.into_iter();
        loop {
            let batch: Vec<_> = entries
                .by_ref()
                .take(1024)
                .map(|(path, size)| (path_key(&path), size.restored()))
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
                .map(|(path, r)| {
                    (
                        path.clone(),
                        StoredSize::Stamped((r.size, r.verified_at, r.basis)),
                    )
                })
                .collect(),
        }
    }
}

#[derive(Serialize, Deserialize)]
struct Snapshot {
    version: u32,
    entries: HashMap<String, StoredSize>,
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
    if !matches!(snapshot.version, 1 | SNAPSHOT_VERSION)
        || snapshot.entries.len() > MAX_SNAPSHOT_ENTRIES
        || snapshot.entries.values().any(|value| {
            !matches!(
                (snapshot.version, value),
                (1, StoredSize::Legacy(_))
                    | (
                        SNAPSHOT_VERSION,
                        StoredSize::Stamped((_, Some(_), SizeBasis::Measured))
                    )
                    | (
                        SNAPSHOT_VERSION,
                        StoredSize::Stamped((
                            _,
                            _,
                            SizeBasis::Aggregate | SizeBasis::Incomplete | SizeBasis::Unknown
                        ))
                    )
            )
        })
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
    persist_cache(path, &bytes)
}

fn persist_cache(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path.parent().ok_or(io::ErrorKind::InvalidInput)?;
    std::fs::create_dir_all(parent)?;
    let mut staged = tempfile::NamedTempFile::new_in(parent)?;
    staged.write_all(bytes)?;
    staged.as_file().sync_all()?;
    let mut temp = staged.into_temp_path();
    // Windows can report ACCESS_DENIED as well as sharing/lock violations while
    // another handle prevents replacement. Retry only the rename, never the scan.
    let mut delays = [10, 25, 50, 100].into_iter();
    loop {
        match temp.persist(path) {
            Ok(()) => return Ok(()),
            Err(failure) => {
                if matches!(failure.error.raw_os_error(), Some(5 | 32 | 33)) {
                    if let Some(ms) = delays.next() {
                        temp = failure.path;
                        std::thread::sleep(Duration::from_millis(ms));
                        continue;
                    }
                }
                return Err(failure.error);
            }
        }
    }
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
fn publish_scan(path: &str, version: u64, size: u64, basis: SizeBasis) -> Option<u64> {
    let mut changes = changes().lock().unwrap();
    if changes.version(path) == version {
        idx().record(path, size, basis, search::now_ms());
        if basis == SizeBasis::Measured {
            search::names().mark_verified(path, size);
        }
        Some(size)
    } else {
        changes.retry(path);
        None
    }
}
fn incomplete_scan(path: &str, version: u64) {
    let mut changes = changes().lock().unwrap();
    if changes.version(path) == version {
        idx().incomplete(path);
    } else {
        changes.retry(path);
    }
}

fn idx() -> &'static SizeIndex {
    INDEX.get_or_init(SizeIndex::default)
}

pub(crate) fn cached_sizes(paths: &[String]) -> Vec<Option<u64>> {
    idx().lookup_many(paths)
}
pub(crate) fn cached_size_readings(paths: &[String]) -> Vec<Option<SizeReading>> {
    idx().readings(paths)
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
static BUSY_WALKS: AtomicUsize = AtomicUsize::new(0);
static UNWATCHED: AtomicUsize = AtomicUsize::new(0);

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
    // An explicit size request outside the search locations still measures bytes.
    // Hold the policy read guard through publication, so removing a location
    // cannot race an old traversal inserting its names back into the search index.
    let unchanged = locations::with_policy(|policy| {
        if policy.is_some_and(|p| !p.includes(dir)) {
            return false;
        }
        let mut changes = changes().lock().unwrap();
        if changes.version(dir) == version {
            let mut entries = std::mem::take(&mut scan.entries);
            let physical_entries = entries.len();
            if let Some(hidden) = policy.and_then(|p| p.hidden_children(dir)) {
                entries.retain(|e| !hidden.contains(&e.folded));
            }
            let all_visible = entries.len() == physical_entries;
            let (same, removed) = search::names().update(dir, entries);
            for path in removed {
                idx().remove_tree(&path);
                search::names().remove_tree(&path);
            }
            same && all_visible
        } else {
            changes.retry(dir);
            false
        }
    });
    Some((scan, unchanged))
}

fn scan_allowed(path: &str) -> io::Result<bool> {
    let Ok(path) = locations::folder_path(path) else {
        return Ok(false);
    };
    use std::os::windows::fs::MetadataExt;
    let ancestors: Vec<_> = Path::new(&path).ancestors().collect();
    for parent in ancestors.into_iter().rev() {
        let m = std::fs::symlink_metadata(parent)?;
        if !m.is_dir() || m.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 {
            return Ok(false);
        }
    }
    Ok(true)
}

// Validate direct children at every level; a parent timestamp alone cannot prove
// that a descendant file is unchanged.
fn walk_validated(dir: &str, my_gen: u64, slot: &AtomicU64) -> (Option<u64>, bool) {
    if slot.load(Ordering::Relaxed) != my_gen {
        return (None, false);
    }
    let version = changes().lock().unwrap().version(dir);
    let Some((scan, mut unchanged)) = scan_and_index(dir, version) else {
        incomplete_scan(dir, version);
        return (None, false);
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
    if !complete {
        incomplete_scan(dir, version);
        return (None, false);
    }
    if unchanged {
        let mut changes = changes().lock().unwrap();
        if changes.version(dir) != version {
            changes.retry(dir);
            return (None, false);
        }
        if let Some(reading) = idx().reading(dir).filter(|r| {
            r.basis == SizeBasis::Measured && search::names().verified_size(dir) == Some(r.size)
        }) {
            idx().record(dir, reading.size, SizeBasis::Measured, search::now_ms());
            return (Some(reading.size), true);
        }
    }
    let total = children.into_iter().fold(scan.files, u64::saturating_add);
    (
        publish_scan(dir, version, total, SizeBasis::Measured),
        false,
    )
}

fn background_coverage(path: &str) -> locations::Coverage {
    locations::with_policy(|p| p.map_or(locations::Coverage::Full, |p| p.coverage(path)))
}

// Traverse visible branches of a partially covered directory for names. Only a
// completely measured subtree may replace the folder size shown in the file list.
fn walk_background(dir: &str, gen: u64, slot: &AtomicU64) {
    if slot.load(Ordering::Relaxed) != gen {
        return;
    }
    match background_coverage(dir) {
        locations::Coverage::Excluded => {}
        locations::Coverage::Full => {
            walk_validated(dir, gen, slot);
        }
        locations::Coverage::Partial => {
            let version = changes().lock().unwrap().version(dir);
            if let Some((scan, _)) = scan_and_index(dir, version) {
                for child in scan.subdirs {
                    if slot.load(Ordering::Relaxed) != gen {
                        break;
                    }
                    walk_background(&child, gen, slot);
                }
            }
        }
    }
}

fn smart_recompute(dir: &str, my_gen: u64, slot: &AtomicU64) -> Option<u64> {
    if slot.load(Ordering::Relaxed) != my_gen {
        return None;
    }
    let version = changes().lock().unwrap().version(dir);
    let Some((scan, _)) = scan_and_index(dir, version) else {
        incomplete_scan(dir, version);
        return idx().get(dir);
    };
    let mut total = scan.files;
    let mut complete = true;
    let mut basis = SizeBasis::Measured;
    for sd in scan.subdirs {
        if slot.load(Ordering::Relaxed) != my_gen {
            return None;
        }
        let value = match idx().reading(&sd) {
            Some(r) if r.basis == SizeBasis::Incomplete => None,
            Some(r) => {
                basis = SizeBasis::Aggregate;
                Some(r.size)
            }
            None => walk_validated(&sd, my_gen, slot).0,
        };
        match value {
            Some(value) => total = total.saturating_add(value),
            None => complete = false,
        }
    }
    if slot.load(Ordering::Relaxed) != my_gen {
        return None;
    }
    if complete {
        publish_scan(dir, version, total, basis)
    } else {
        incomplete_scan(dir, version);
        idx().get(dir)
    }
}

#[tauri::command]
pub async fn folder_size_details(
    view: tauri::Webview,
    paths: Vec<String>,
) -> Result<Vec<Option<SizeReading>>, String> {
    crate::ai::harness_tasks::local(&view)?;
    tauri::async_runtime::spawn_blocking(move || cached_size_readings(&paths))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sizes_lookup(paths: Vec<String>) -> Result<Vec<Option<u64>>, String> {
    tauri::async_runtime::spawn_blocking(move || cached_sizes(&paths))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn search_files(
    view: tauri::Webview,
    query: String,
    limit: Option<usize>,
    scope: Option<String>,
    paginate: Option<bool>,
    kind: Option<SearchKind>,
) -> Result<SearchResponse, String> {
    crate::ai::harness_tasks::local(&view)?;
    let generation = search::query_generation();
    tauri::async_runtime::spawn_blocking(move || {
        let options = search::SearchOptions {
            snapshot_id: paginate.unwrap_or(false).then_some(generation),
            kind,
        };
        search::names().find(
            &query,
            scope.as_deref(),
            limit.unwrap_or(200),
            options,
            || !search::query_current(generation),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn search_page(
    view: tauri::Webview,
    snapshot_id: u64,
    page: usize,
) -> Result<SearchResponse, String> {
    crate::ai::harness_tasks::local(&view)?;
    tauri::async_runtime::spawn_blocking(move || search::names().page(snapshot_id, page))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn search_release(view: tauri::Webview, snapshot_id: u64) -> Result<(), String> {
    crate::ai::harness_tasks::local(&view)?;
    tauri::async_runtime::spawn_blocking(move || search::names().release_pages(snapshot_id))
        .await
        .map_err(|e| e.to_string())
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
    let mut pending = signal.pending.lock().unwrap();
    *pending = true;
    locations::EPOCH.fetch_add(1, Ordering::SeqCst);
    PRELOAD_GEN.fetch_add(1, Ordering::SeqCst);
    drop(pending);
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
            let version = changes().lock().unwrap().version(&path);
            let info = match scan_allowed(&path) {
                Ok(true) => {
                    if request.force
                        || (idx().reading(&path).is_none()
                            && background_coverage(&path) == locations::Coverage::Full)
                    {
                        walk_validated(&path, request.slot_gen, &ONDEMAND_GEN);
                    }
                    idx().reading(&path)
                }
                Err(error) if error.kind() != io::ErrorKind::NotFound => {
                    incomplete_scan(&path, version);
                    idx().reading(&path)
                }
                _ => None,
            };
            if ONDEMAND_GEN.load(Ordering::Relaxed) != request.slot_gen {
                break;
            }
            let _ = request.app.emit(
                "dir-size",
                serde_json::json!({ "gen": request.gen, "path": path, "size": info.map(|r| r.size), "info": info }),
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
    locations::start_monitor();
    let _ = app.emit("index-updated", ());
    let signal = rebuild_signal();
    let mut watchers = Vec::new();
    let mut watching = 0;
    let mut first = true;
    loop {
        let (roots, epoch, gen, requested, selected) = locations::with_policy(|p| {
            let p = p.unwrap();
            let mut pending = signal.pending.lock().unwrap();
            let requested = std::mem::take(&mut *pending);
            let gen = PRELOAD_GEN.fetch_add(1, Ordering::SeqCst) + 1;
            (
                p.roots.clone(),
                locations::EPOCH.load(Ordering::SeqCst),
                gen,
                requested,
                p.selected_count().is_some(),
            )
        });
        let fixed = crate::fixed_drive_roots();
        let configured = roots.len();
        if watching != epoch || requested {
            locations::monitor_roots(epoch, &roots, selected);
        }
        let (roots, unavailable): (Vec<_>, Vec<_>) = roots.into_iter().partition(|root| {
            fixed
                .iter()
                .any(|drive| root.get(..3).is_some_and(|p| p.eq_ignore_ascii_case(drive)))
                && locations::ordinary_folder(root)
        });
        locations::with_policy(|_| {
            if locations::EPOCH.load(Ordering::SeqCst) == epoch {
                for root in &unavailable {
                    search::names().remove_tree(root);
                }
            }
        });
        if watching != epoch || requested {
            watchers.clear();
            watchers = start_index_watchers(app, roots.clone(), epoch);
            UNWATCHED.store(configured - watchers.len(), Ordering::Relaxed);
            watching = epoch;
        }
        if std::mem::take(&mut first) && !requested && !roots.is_empty() {
            let due = search::names()
                .validated_ms
                .load(Ordering::Relaxed)
                .saturating_add(search::REVALIDATE_AFTER_MS);
            let now = search::now_ms();
            if due > now {
                search::names()
                    .next_validation_ms
                    .store(due, Ordering::Relaxed);
                let pending = signal.pending.lock().unwrap();
                let _wait = signal.ready.wait_timeout_while(
                    pending,
                    Duration::from_millis(due - now),
                    |p| !*p,
                );
                continue;
            }
        }
        search::names().active.store(true, Ordering::Relaxed);
        search::names()
            .next_validation_ms
            .store(0, Ordering::Relaxed);
        let _ = app.emit("index-updated", ());
        busy_enter(app);
        for root in &roots {
            if PRELOAD_GEN.load(Ordering::Relaxed) != gen {
                break;
            }
            walk_background(root, gen, &PRELOAD_GEN);
        }
        busy_exit(app);
        locations::with_policy(|_| {
            if !roots.is_empty()
                && unavailable.is_empty()
                && PRELOAD_GEN.load(Ordering::Relaxed) == gen
                && locations::EPOCH.load(Ordering::SeqCst) == epoch
            {
                search::names()
                    .validated_ms
                    .store(search::now_ms(), Ordering::Relaxed);
                search::names().revision.fetch_add(1, Ordering::Relaxed);
            }
        });
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

fn start_index_watchers(
    app: &AppHandle,
    roots: Vec<String>,
    epoch: u64,
) -> Vec<notify::RecommendedWatcher> {
    let (tx, rx) = mpsc::sync_channel::<WatchMsg>(1024);
    let mut guards = Vec::new();
    for root in roots.iter() {
        let tx2 = tx.clone();
        let root_key = path_key(root);
        let Ok(mut w) = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if locations::EPOCH.load(Ordering::SeqCst) != epoch {
                return;
            }
            let msg = match res {
                Ok(mut ev) => {
                    if ev.need_rescan() {
                        changes().lock().unwrap().record(&[], true, false);
                        WatchMsg::Dead
                    } else {
                        locations::with_policy(|policy| {
                            ev.paths.retain(|p| {
                                let path = p.to_string_lossy();
                                !is_cache_path(p)
                                    && locations::within(&path_key(&path), &root_key)
                                    && policy.is_none_or(|policy| policy.includes(&path))
                            })
                        });
                        if ev.paths.is_empty() {
                            return;
                        }
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
    if guards.is_empty() {
        return guards;
    }

    let app = app.clone();
    std::thread::spawn(move || {
        run_lowest_priority();
        loop {
            if locations::EPOCH.load(Ordering::SeqCst) != epoch {
                break;
            }
            // Collect a batch and wait for it to go quiet before recomputing.
            let mut affected = std::mem::take(&mut changes().lock().unwrap().retry);
            let mut dead = WATCH_OVERFLOW.swap(false, Ordering::SeqCst);
            let collect_current = |affected: &mut HashSet<String>, dead: &mut bool, msg| {
                locations::with_policy(|_| {
                    if locations::EPOCH.load(Ordering::SeqCst) == epoch {
                        collect(affected, dead, msg);
                    }
                })
            };
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(msg) => collect_current(&mut affected, &mut dead, msg),
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(mpsc::RecvTimeoutError::Timeout) if affected.is_empty() && !dead => continue,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            let deadline = Instant::now() + Duration::from_secs(2);
            while Instant::now() < deadline {
                match rx.recv_timeout(std::time::Duration::from_millis(700)) {
                    Ok(m) => collect_current(&mut affected, &mut dead, m),
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                }
            }
            let mut affected: Vec<_> = affected.into_iter().collect();
            affected.sort_by_key(|path| std::cmp::Reverse(path.len()));
            for a in affected {
                if locations::EPOCH.load(Ordering::SeqCst) != epoch {
                    return;
                }
                if locations::with_policy(|p| p.is_some_and(|p| p.includes(&a))) {
                    maintain_one(&app, &a, epoch);
                }
            }
            if dead {
                // a watcher overflowed: rebuild the indexes of all drives
                for root in roots.iter() {
                    if locations::EPOCH.load(Ordering::SeqCst) != epoch {
                        return;
                    }
                    if !locations::ordinary_folder(root) {
                        continue;
                    }
                    busy_enter(&app);
                    walk_background(root, epoch, &locations::EPOCH);
                    busy_exit(&app);
                }
            }
        }
    });
    guards
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
                if invalidate || (cached && matches!(p.try_exists(), Ok(false))) {
                    idx().remove_tree(&path);
                    search::names().remove_tree(&path);
                }
                if cached || (invalidate && p.is_dir()) {
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

fn maintain_one(app: &AppHandle, dir: &str, epoch: u64) {
    let version = changes().lock().unwrap().version(dir);
    match scan_allowed(dir) {
        Ok(true) => {}
        Err(error) if error.kind() != io::ErrorKind::NotFound => {
            incomplete_scan(dir, version);
            return;
        }
        _ => {
            idx().remove_tree(dir);
            search::names().remove_tree(dir);
            return;
        }
    }
    busy_enter(app);
    match background_coverage(dir) {
        locations::Coverage::Excluded => {}
        locations::Coverage::Partial => {
            scan_and_index(dir, version);
        }
        locations::Coverage::Full => {
            smart_recompute(dir, epoch, &locations::EPOCH);
        }
    }
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
        let mut entries: HashMap<_, _> = (0..2500)
            .map(|n| (format!(r"C:\cached\{n}"), StoredSize::Legacy(n)))
            .collect();
        entries.insert("c:/LIVE/".into(), StoredSize::Legacy(100));
        index.restore(entries);
        assert_eq!(index.get(r"C:\live"), Some(200));
        assert_eq!(index.get(r"C:\cached\2499"), Some(2499));
        assert!(!index.reading(r"C:\live").unwrap().restored);
        let legacy = index.reading(r"C:\cached\2499").unwrap();
        assert!(legacy.restored);
        assert_eq!(legacy.verified_at, None);
        assert_eq!(legacy.basis, SizeBasis::Unknown);
    }

    #[test]
    fn snapshot_roundtrip_replaces_existing_file() {
        let temp = TempCache::new();
        let index = SizeIndex::default();
        index.put(r"C:\test", 123);
        write_snapshot(&temp.file(), &index.snapshot()).unwrap();
        index.record(r"C:\test", 456, SizeBasis::Measured, 1700000000000);
        write_snapshot(&temp.file(), &index.snapshot()).unwrap();
        let restored = SizeIndex::default();
        restored.restore(read_snapshot(&temp.file()).unwrap().entries);
        assert_eq!(restored.get(r"C:\test"), Some(456));
        let reading = restored.reading(r"C:\test").unwrap();
        assert!(reading.restored);
        assert_eq!(reading.verified_at, Some(1700000000000));
        assert_eq!(reading.basis, SizeBasis::Measured);
        assert_eq!(temp.0.read_dir().unwrap().count(), 1);
    }

    #[test]
    fn legacy_snapshot_preserves_zero_and_has_no_verification_time() {
        let temp = TempCache::new();
        std::fs::write(temp.file(), br#"{"version":1,"entries":{"C:\\old":0}}"#).unwrap();
        let index = SizeIndex::default();
        index.restore(read_snapshot(&temp.file()).unwrap().entries);
        let old = index.reading(r"C:\old").unwrap();
        assert_eq!(
            (old.size, old.verified_at, old.basis, old.restored),
            (0, None, SizeBasis::Unknown, true)
        );
        index.incomplete(r"C:\missing");
        assert!(index.reading(r"C:\missing").is_none());
        write_snapshot(&temp.file(), &index.snapshot()).unwrap();
        let migrated = read_snapshot(&temp.file()).unwrap();
        assert_eq!(migrated.version, SNAPSHOT_VERSION);
        assert!(matches!(
            migrated.entries[&path_key(r"C:\old")],
            StoredSize::Stamped((0, None, SizeBasis::Unknown))
        ));
    }

    #[test]
    fn cached_children_and_incomplete_reads_preserve_last_full_verification() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().to_string_lossy();
        let child = temp.path().join("child");
        std::fs::create_dir(&child).unwrap();
        let slot = AtomicU64::new(1);
        assert_eq!(walk_validated(&root, 1, &slot).0, Some(0));
        let full = idx().reading(&root).unwrap();
        std::fs::write(temp.path().join("new"), b"12").unwrap();
        assert_eq!(smart_recompute(&root, 1, &slot), Some(2));
        let aggregate = idx().reading(&root).unwrap();
        assert_eq!(
            (aggregate.basis, aggregate.verified_at),
            (SizeBasis::Aggregate, full.verified_at)
        );
        assert!(aggregate.serial > full.serial);
        idx().incomplete(&child.to_string_lossy());
        std::fs::write(temp.path().join("new"), b"123").unwrap();
        assert_eq!(smart_recompute(&root, 1, &slot), Some(2));
        let partial = idx().reading(&root).unwrap();
        assert_eq!(
            (partial.basis, partial.verified_at),
            (SizeBasis::Incomplete, full.verified_at)
        );
        assert_eq!(walk_validated(&root, 1, &slot).0, Some(3));
        assert_eq!(idx().reading(&root).unwrap().basis, SizeBasis::Measured);
        idx().remove_tree(&root);
        search::names().remove_tree(&root);
    }

    #[test]
    fn first_scan_after_migration_recounts_even_if_old_name_index_agrees_with_stale_bytes() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().to_string_lossy();
        std::fs::write(temp.path().join("file"), b"123").unwrap();
        let version = changes().lock().unwrap().version(&dir);
        scan_and_index(&dir, version).unwrap();
        idx().restore(HashMap::from([(dir.to_string(), StoredSize::Legacy(90))]));
        search::names().mark_verified(&dir, 90);
        let slot = AtomicU64::new(1);
        assert_eq!(walk_validated(&dir, 1, &slot), (Some(3), false));
        assert_eq!(walk_validated(&dir, 1, &slot), (Some(3), true));
        idx().remove_tree(&dir);
        search::names().remove_tree(&dir);
    }

    #[test]
    fn snapshot_recovers_after_a_brief_windows_sharing_violation() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("folder-sizes-v1.json");
        let index = SizeIndex::default();
        index.put(r"C:\test", 123);
        write_snapshot(&path, &index.snapshot()).unwrap();
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&path)
            .unwrap();
        index.put(r"C:\test", 456);
        std::thread::scope(|scope| {
            scope.spawn(move || {
                std::thread::sleep(Duration::from_millis(40));
                drop(lock);
            });
            write_snapshot(&path, &index.snapshot()).unwrap();
        });
        assert!(matches!(
            read_snapshot(&path).unwrap().entries[&path_key(r"C:\test")],
            StoredSize::Stamped((456, Some(_), SizeBasis::Measured))
        ));
    }

    #[test]
    fn locked_search_cache_preserves_previous_bytes_and_cleans_its_staging_file() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file-names-v1.json");
        let index = search::NameIndex::default();
        index.save(&path).unwrap();
        let previous = std::fs::read(&path).unwrap();
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&path)
            .unwrap();
        index.update(
            r"C:\test",
            vec![search::Entry::new("new.txt".into(), false, 9, 0, false)],
        );
        assert!(matches!(
            index.save(&path).unwrap_err().raw_os_error(),
            Some(5 | 32 | 33)
        ));
        assert_eq!(std::fs::read(&path).unwrap(), previous);
        assert_eq!(dir.path().read_dir().unwrap().count(), 1);
        drop(lock);
        index.save(&path).unwrap();
        assert_ne!(std::fs::read(&path).unwrap(), previous);
    }

    #[test]
    fn snapshot_rejects_corrupt_unsupported_and_oversized_data() {
        let temp = TempCache::new();
        for bytes in [
            br#"{"broken":"#.as_slice(),
            br#"{"version":3,"entries":{}}"#.as_slice(),
            br#"{"version":2,"entries":{"C:\\folder":[3,null,"measured"]}}"#.as_slice(),
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
        let before = idx().reading(&path).unwrap();
        assert_eq!(publish_scan(&path, version, 100, SizeBasis::Measured), None);
        assert_eq!(idx().reading(&path).unwrap().serial, before.serial);
        assert_eq!(idx().get(&path), Some(200));
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
