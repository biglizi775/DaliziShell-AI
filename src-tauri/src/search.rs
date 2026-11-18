//! A file-name index fed by the folder-size scanner; searches never enumerate disk.
use crate::search_query::{Query, Record};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_ITEMS: usize = 1_000_000;
const MAX_DIRECTORIES: usize = 500_000;
const MAX_BYTES: u64 = 256 * 1024 * 1024;
pub(super) const REVALIDATE_AFTER_MS: u64 = 10 * 60 * 1000;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct Entry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub mtime: i64,
    pub is_reparse: bool,
    #[serde(skip)]
    pub(super) folded: String,
}
impl Entry {
    pub fn new(name: String, is_dir: bool, size: u64, mtime: i64, is_reparse: bool) -> Self {
        let folded = name.to_lowercase();
        Self {
            name,
            is_dir,
            size,
            mtime,
            is_reparse,
            folded,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct Directory {
    path: String,
    entries: Vec<Entry>,
}

#[derive(Default)]
pub(super) struct NameIndex {
    directories: RwLock<BTreeMap<String, Arc<Directory>>>,
    pages: RwLock<Option<Arc<ResultPages>>>,
    verified: RwLock<BTreeMap<String, u64>>,
    indexed: AtomicUsize,
    pub revision: AtomicU64,
    pub active: AtomicBool,
    restored: AtomicBool,
    limited: AtomicBool,
    pub validated_ms: AtomicU64,
    pub next_validation_ms: AtomicU64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchItem {
    name: String,
    path: String,
    is_dir: bool,
    size: Option<u64>,
    mtime: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchStatus {
    selected_locations: Option<usize>,
    excluded_locations: usize,
    unwatched_locations: usize,
    revision: u64,
    indexed: usize,
    indexing: bool,
    cache_restored: bool,
    index_limit_reached: bool,
    last_validated_ms: u64,
    next_validation_ms: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    items: Vec<SearchItem>,
    total: usize,
    truncated: bool,
    cancelled: bool,
    page: usize,
    page_size: usize,
    snapshot_id: Option<u64>,
    snapshot_revision: u64,
    #[serde(flatten)]
    status: SearchStatus,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SearchKind {
    File,
    Dir,
}

#[derive(Default)]
pub(super) struct SearchOptions {
    pub snapshot_id: Option<u64>,
    pub kind: Option<SearchKind>,
}

// Store coordinates into immutable index directories. Full paths and names
// are materialized only for the page the WebView asks to display.
struct Hit {
    directory: u32,
    entry: u32,
    size: Option<u64>,
}
struct ResultPages {
    id: u64,
    revision: u64,
    page_size: usize,
    directories: Vec<Arc<Directory>>,
    hits: Vec<Hit>,
}
impl ResultPages {
    fn items(&self, page: usize) -> Result<Vec<SearchItem>, String> {
        let offset = page
            .checked_sub(1)
            .and_then(|p| p.checked_mul(self.page_size))
            .filter(|&offset| offset < self.hits.len())
            .ok_or("页码超出范围 / Page out of range")?;
        Ok(self.hits[offset..]
            .iter()
            .take(self.page_size)
            .map(|hit| {
                let dir = &self.directories[hit.directory as usize];
                SearchItem::from_entry(dir, &dir.entries[hit.entry as usize], hit.size)
            })
            .collect())
    }
}
impl SearchItem {
    fn from_entry(dir: &Directory, entry: &Entry, size: Option<u64>) -> Self {
        Self {
            name: entry.name.clone(),
            path: super::child_path(&dir.path, &entry.name),
            is_dir: entry.is_dir,
            size,
            mtime: entry.mtime,
        }
    }
}

static NAMES: OnceLock<NameIndex> = OnceLock::new();
static QUERY_GEN: AtomicU64 = AtomicU64::new(0);
pub(super) fn names() -> &'static NameIndex {
    NAMES.get_or_init(NameIndex::default)
}
pub(super) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

impl NameIndex {
    /// Returns whether direct children are unchanged and which old subtrees vanished.
    pub fn update(&self, path: &str, mut entries: Vec<Entry>) -> (bool, Vec<String>) {
        entries.sort_unstable_by(|a, b| a.name.cmp(&b.name));
        let key = super::path_key(path);
        let mut map = self.directories.write().unwrap();
        let old = map.get(&key);
        if old.is_some_and(|old| old.entries == entries) {
            return (true, Vec::new());
        }
        // A directory's timestamp can settle after the first enumeration, and
        // file content edits may preserve length. Refresh searchable metadata,
        // but only invalidate totals when their actual size inputs changed.
        let same_sizes = old.is_some_and(|old| {
            old.entries.len() == entries.len()
                && old.entries.iter().zip(&entries).all(|(old, new)| {
                    old.name == new.name
                        && old.is_dir == new.is_dir
                        && old.is_reparse == new.is_reparse
                        && (old.is_dir || old.size == new.size)
                })
        });
        if !same_sizes {
            self.invalidate_ancestors(path);
        }
        let live_dirs: HashSet<_> = entries
            .iter()
            .filter(|entry| entry.is_dir && !entry.is_reparse)
            .map(|entry| entry.name.as_str())
            .collect();
        let removed = old
            .map(|old| {
                old.entries
                    .iter()
                    .filter(|entry| {
                        entry.is_dir
                            && !entry.is_reparse
                            && !live_dirs.contains(entry.name.as_str())
                    })
                    .map(|entry| super::child_path(&old.path, &entry.name))
                    .collect()
            })
            .unwrap_or_default();
        let count = self.indexed.load(Ordering::Relaxed);
        let old_len = old.map_or(0, |old| old.entries.len());
        if count.saturating_sub(old_len).saturating_add(entries.len()) > MAX_ITEMS
            || (old.is_none() && map.len() >= MAX_DIRECTORIES)
        {
            self.limited.store(true, Ordering::Relaxed);
            if map.remove(&key).is_some() {
                self.indexed.fetch_sub(old_len, Ordering::Relaxed);
                self.revision.fetch_add(1, Ordering::Relaxed);
            }
            return (false, removed);
        }
        self.indexed
            .store(count - old_len + entries.len(), Ordering::Relaxed);
        map.insert(
            key,
            Arc::new(Directory {
                path: path.into(),
                entries,
            }),
        );
        self.revision.fetch_add(1, Ordering::Relaxed);
        (same_sizes, removed)
    }
    pub fn contains(&self, path: &str) -> bool {
        self.directories
            .read()
            .unwrap()
            .contains_key(&super::path_key(path))
    }
    fn invalidate_ancestors(&self, path: &str) {
        let mut verified = self.verified.write().unwrap();
        for ancestor in Path::new(path).ancestors() {
            verified.remove(&super::path_key(&ancestor.to_string_lossy()));
        }
    }
    pub fn verified_size(&self, path: &str) -> Option<u64> {
        self.verified
            .read()
            .unwrap()
            .get(&super::path_key(path))
            .copied()
    }
    pub fn mark_verified(&self, path: &str, size: u64) {
        let key = super::path_key(path);
        let directories = self.directories.read().unwrap();
        if directories.contains_key(&key) {
            self.verified.write().unwrap().insert(key, size);
        }
    }
    pub fn remove_tree(&self, path: &str) {
        let key = super::path_key(path);
        let prefix = format!("{}\\", key.trim_end_matches('\\'));
        let mut map = self.directories.write().unwrap();
        self.invalidate_ancestors(path);
        let keys: Vec<_> = map
            .range(prefix.clone()..)
            .take_while(|(key, _)| key.starts_with(&prefix))
            .map(|(key, _)| key.clone())
            .collect();
        let old = map.remove(&key);
        let mut changed = old.is_some() || !keys.is_empty();
        let mut removed = old.map_or(0, |dir| dir.entries.len());
        let mut verified = self.verified.write().unwrap();
        for key in keys {
            verified.remove(&key);
            if let Some(dir) = map.remove(&key) {
                removed += dir.entries.len();
                changed = true;
            }
        }
        if changed {
            self.indexed.fetch_sub(removed, Ordering::Relaxed);
            self.revision.fetch_add(1, Ordering::Relaxed);
        }
    }
    pub fn status(&self) -> SearchStatus {
        let (selected_locations, excluded_locations) = super::locations::with_policy(|p| {
            (
                p.and_then(|p| p.selected_count()),
                p.map_or(0, |p| p.exclusions.len()),
            )
        });
        SearchStatus {
            selected_locations,
            excluded_locations,
            unwatched_locations: super::UNWATCHED.load(Ordering::Relaxed),
            revision: self.revision.load(Ordering::Relaxed),
            indexed: self.indexed.load(Ordering::Relaxed),
            indexing: self.active.load(Ordering::Relaxed),
            cache_restored: self.restored.load(Ordering::Relaxed),
            index_limit_reached: self.limited.load(Ordering::Relaxed),
            last_validated_ms: self.validated_ms.load(Ordering::Relaxed),
            next_validation_ms: self.next_validation_ms.load(Ordering::Relaxed),
        }
    }
    pub fn retain_locations(&self, policy: &super::locations::Policy) {
        let mut dirs = self.directories.write().unwrap();
        dirs.retain(|key, dir| {
            if !policy.includes(key) {
                return false;
            }
            if let Some(hidden) = policy.hidden_children(key) {
                Arc::make_mut(dir)
                    .entries
                    .retain(|e| !hidden.contains(&e.folded));
            }
            true
        });
        self.verified.write().unwrap().retain(|key, _| {
            dirs.contains_key(key) && policy.coverage(key) == super::locations::Coverage::Full
        });
        self.indexed.store(
            dirs.values().map(|d| d.entries.len()).sum(),
            Ordering::Relaxed,
        );
        self.limited.store(false, Ordering::Relaxed);
        self.validated_ms.store(0, Ordering::Relaxed);
        self.next_validation_ms.store(0, Ordering::Relaxed);
        self.revision.fetch_add(1, Ordering::Relaxed);
        query_generation();
        *self.pages.write().unwrap() = None;
    }
    #[cfg(test)]
    fn search(
        &self,
        query: &str,
        scope: Option<&str>,
        limit: usize,
        cancelled: impl Fn() -> bool,
    ) -> Result<SearchResponse, String> {
        self.find(query, scope, limit, SearchOptions::default(), cancelled)
    }
    pub fn find(
        &self,
        query: &str,
        scope: Option<&str>,
        limit: usize,
        options: SearchOptions,
        cancelled: impl Fn() -> bool,
    ) -> Result<SearchResponse, String> {
        let query = Query::parse(query)?;
        let limit = limit.clamp(1, 500);
        let status = self.status();
        let mut response = SearchResponse {
            items: Vec::new(),
            total: 0,
            truncated: false,
            cancelled: false,
            page: 1,
            page_size: limit,
            snapshot_id: None,
            snapshot_revision: status.revision,
            status,
        };
        if query.is_empty() {
            return Ok(response);
        }
        let mut pages = options.snapshot_id.map(|id| ResultPages {
            id,
            revision: response.snapshot_revision,
            page_size: limit,
            directories: Vec::new(),
            hits: Vec::new(),
        });
        let scope = scope.filter(|scope| !scope.is_empty()).map(super::path_key);
        // Only copy Arc handles under the read lock; matching cannot stall updates.
        let directories: Vec<_> = self.directories.read().unwrap().values().cloned().collect();
        for dir in directories {
            if cancelled() {
                response.cancelled = true;
                response.items.clear();
                return Ok(response);
            }
            let dir_key = if scope.is_some() || query.needs_path {
                super::path_key(&dir.path)
            } else {
                String::new()
            };
            if scope.as_ref().is_some_and(|scope| {
                dir_key != *scope
                    && !dir_key.starts_with(&format!("{}\\", scope.trim_end_matches('\\')))
            }) {
                continue;
            }
            let mut slot = None;
            for (position, entry) in dir.entries.iter().enumerate() {
                if position % 1024 == 0 && cancelled() {
                    response.cancelled = true;
                    response.items.clear();
                    return Ok(response);
                }
                if options
                    .kind
                    .is_some_and(|kind| matches!(kind, SearchKind::Dir) != entry.is_dir)
                {
                    continue;
                }
                let full = if query.needs_path {
                    super::child_path(&dir_key, &entry.folded)
                } else {
                    String::new()
                };
                let size = if entry.is_dir {
                    if query.needs_size {
                        super::idx().get(&super::child_path(&dir.path, &entry.name))
                    } else {
                        None
                    }
                } else {
                    Some(entry.size)
                };
                if !query.matches(&Record {
                    name: &entry.folded,
                    path: &full,
                    parent: &dir_key,
                    is_dir: entry.is_dir,
                    size,
                    mtime: entry.mtime,
                }) {
                    continue;
                }
                response.total += 1;
                if response.total <= limit || pages.is_some() {
                    let display_size = if entry.is_dir && !query.needs_size {
                        super::idx().get(&super::child_path(&dir.path, &entry.name))
                    } else {
                        size
                    };
                    if response.total <= limit {
                        response
                            .items
                            .push(SearchItem::from_entry(&dir, entry, display_size));
                    }
                    if let Some(pages) = &mut pages {
                        let directory = *slot.get_or_insert_with(|| {
                            let index = pages.directories.len() as u32;
                            pages.directories.push(Arc::clone(&dir));
                            index
                        });
                        pages.hits.push(Hit {
                            directory,
                            entry: position as u32,
                            size: display_size,
                        });
                    }
                }
            }
        }
        response.truncated = response.total > response.items.len();
        if let Some(pages) = pages {
            let mut current = self.pages.write().unwrap();
            if cancelled() {
                response.cancelled = true;
                response.items.clear();
            } else if response.truncated {
                response.snapshot_id = Some(pages.id);
                *current = Some(Arc::new(pages));
            } else {
                *current = None;
            }
        }
        Ok(response)
    }
    pub fn page(&self, id: u64, number: usize) -> Result<SearchResponse, String> {
        let pages = self
            .pages
            .read()
            .unwrap()
            .as_ref()
            .filter(|p| p.id == id)
            .cloned()
            .ok_or("这组结果已关闭，请更新结果 / Result set closed. Refresh results.")?;
        Ok(SearchResponse {
            items: pages.items(number)?,
            total: pages.hits.len(),
            truncated: true,
            cancelled: false,
            page: number,
            page_size: pages.page_size,
            snapshot_id: Some(id),
            snapshot_revision: pages.revision,
            status: self.status(),
        })
    }
    pub fn release_pages(&self, id: u64) {
        let mut pages = self.pages.write().unwrap();
        if pages.as_ref().is_some_and(|p| p.id == id) {
            *pages = None;
        }
    }
    pub fn save(&self, path: &Path) -> io::Result<()> {
        super::locations::with_policy(|policy| {
            self.save_for(
                path,
                policy.map(|p| p.keys.as_slice()),
                policy.map_or(&[], |p| p.exclusions.as_slice()),
            )
        })
    }
    fn save_for(
        &self,
        path: &Path,
        coverage: Option<&[String]>,
        exclusions: &[String],
    ) -> io::Result<()> {
        let validated_ms = self.validated_ms.load(Ordering::Relaxed);
        let (dirs, verified) = {
            let map = self.directories.read().unwrap();
            (
                map.values().cloned().collect::<Vec<_>>(),
                self.verified.read().unwrap().clone(),
            )
        };
        let snapshot = SnapshotRef {
            version: 1,
            coverage,
            exclusions,
            validated_ms,
            directories: &dirs,
            verified,
            limited: self.limited.load(Ordering::Relaxed),
        };
        let bytes = serde_json::to_vec(&snapshot)?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "search cache too large",
            ));
        }
        super::persist_cache(path, &bytes)
    }
    pub fn restore(&self, path: &Path) -> io::Result<()> {
        super::locations::with_policy(|policy| self.restore_for(path, policy))
    }
    fn restore_for(
        &self,
        path: &Path,
        policy: Option<&super::locations::Policy>,
    ) -> io::Result<()> {
        let file = std::fs::File::open(path)?;
        if file.metadata()?.len() > MAX_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "search cache too large",
            ));
        }
        let mut bytes = Vec::new();
        file.take(MAX_BYTES + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "search cache too large",
            ));
        }
        let snapshot: Snapshot = serde_json::from_slice(&bytes)?;
        if let Some(p) = policy {
            let matched = match &snapshot.coverage {
                Some(keys) => *keys == p.keys,
                None => p.accepts_legacy(),
            };
            if !matched || p.exclusions != snapshot.exclusions {
                return Ok(());
            }
        }
        if snapshot.version != 1
            || snapshot.directories.len() > MAX_DIRECTORIES
            || snapshot.verified.len() > MAX_DIRECTORIES
            || snapshot
                .directories
                .iter()
                .map(|dir| dir.entries.len())
                .sum::<usize>()
                > MAX_ITEMS
            || snapshot.directories.iter().any(|dir| !valid_directory(dir))
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid search cache",
            ));
        }
        let before = self.revision.load(Ordering::Relaxed);
        let initially_empty = self.directories.read().unwrap().is_empty();
        for mut directory in snapshot.directories {
            if policy.is_some_and(|p| !p.includes(&directory.path)) {
                continue;
            }
            for entry in &mut directory.entries {
                entry.folded = entry.name.to_lowercase();
            }
            if let Some(hidden) = policy.and_then(|p| p.hidden_children(&directory.path)) {
                directory.entries.retain(|e| !hidden.contains(&e.folded));
            }
            // Startup on-demand scans may already have fresher records.
            let key = super::path_key(&directory.path);
            let mut map = self.directories.write().unwrap();
            if !map.contains_key(&key)
                && (map.len() >= MAX_DIRECTORIES
                    || self
                        .indexed
                        .load(Ordering::Relaxed)
                        .saturating_add(directory.entries.len())
                        > MAX_ITEMS)
            {
                self.limited.store(true, Ordering::Relaxed);
                continue;
            }
            if let std::collections::btree_map::Entry::Vacant(slot) = map.entry(key) {
                self.indexed
                    .fetch_add(directory.entries.len(), Ordering::Relaxed);
                slot.insert(Arc::new(directory));
            }
        }
        {
            let directories = self.directories.write().unwrap();
            if initially_empty && self.revision.load(Ordering::Relaxed) == before {
                *self.verified.write().unwrap() = snapshot
                    .verified
                    .into_iter()
                    .filter(|(path, _)| directories.contains_key(path))
                    .collect();
            }
        }
        self.validated_ms
            .store(snapshot.validated_ms.min(now_ms()), Ordering::Relaxed);
        self.restored.store(true, Ordering::Relaxed);
        if snapshot.limited {
            self.limited.store(true, Ordering::Relaxed);
        }
        self.revision.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }
}

// Arc serialization is intentionally avoided: no extra serde features are required.
#[derive(Serialize)]
struct SnapshotRef<'a> {
    #[serde(skip_serializing_if = "<[String]>::is_empty")]
    exclusions: &'a [String],
    #[serde(skip_serializing_if = "Option::is_none")]
    coverage: Option<&'a [String]>,
    version: u32,
    validated_ms: u64,
    #[serde(serialize_with = "serialize_directories")]
    directories: &'a [Arc<Directory>],
    verified: BTreeMap<String, u64>,
    limited: bool,
}
fn serialize_directories<S: serde::Serializer>(
    directories: &[Arc<Directory>],
    serializer: S,
) -> Result<S::Ok, S::Error> {
    use serde::ser::SerializeSeq;
    let mut seq = serializer.serialize_seq(Some(directories.len()))?;
    for dir in directories {
        seq.serialize_element(dir.as_ref())?;
    }
    seq.end()
}
#[derive(Deserialize)]
struct Snapshot {
    #[serde(default)]
    exclusions: Vec<String>,
    #[serde(default)]
    coverage: Option<Vec<String>>,
    version: u32,
    validated_ms: u64,
    directories: Vec<Directory>,
    #[serde(default)]
    verified: BTreeMap<String, u64>,
    #[serde(default)]
    limited: bool,
}
fn valid_directory(dir: &Directory) -> bool {
    Path::new(&dir.path).is_absolute()
        && !dir.path.starts_with("\\\\")
        && !dir.path.contains('\0')
        && dir.entries.iter().all(|entry| {
            !entry.name.is_empty()
                && ![".", ".."].contains(&entry.name.as_str())
                && !entry.name.contains(['\\', '/', ':', '\0'])
        })
}

pub(super) fn query_generation() -> u64 {
    QUERY_GEN.fetch_add(1, Ordering::Relaxed) + 1
}
pub(super) fn query_current(generation: u64) -> bool {
    QUERY_GEN.load(Ordering::Relaxed) == generation
}
pub(super) fn cache_path(directory: &Path) -> PathBuf {
    directory.join("file-names-v1.json")
}

#[cfg(test)]
mod tests {
    use super::*;
    fn file(name: &str) -> Entry {
        Entry::new(name.into(), false, 12, 100, false)
    }
    #[test]
    fn queries_match_names_phrases_types_extensions_and_paths() {
        let index = NameIndex::default();
        index.update(
            r"C:\Projects",
            vec![
                file("Hello World.RS"),
                file("hello.js"),
                file("else.txt"),
                Entry::new("Hello docs".into(), true, 0, 100, false),
            ],
        );
        let search = |query| index.search(query, None, 200, || false).unwrap();
        assert_eq!(search("hello world ext:rs;js").total, 1);
        assert_eq!(search("\"hello world\"").total, 1);
        assert_eq!(search("type:dir hello").total, 1);
        assert_eq!(search("type:file path:projects").total, 3);
        assert_eq!(search("ext:js;rs").total, 2);
        assert_eq!(search("").total, 0);
        assert!(index.search(&"x".repeat(1025), None, 10, || false).is_err());
    }
    #[test]
    fn searches_are_bounded_scoped_and_cancellable() {
        let index = NameIndex::default();
        index.update(
            r"C:\work",
            (0..600).map(|n| file(&format!("file{n}.txt"))).collect(),
        );
        index.update(r"C:\work-other", vec![file("file.txt")]);
        let response = index
            .search("file", Some("c:/work/"), 999, || false)
            .unwrap();
        assert_eq!(response.total, 600);
        assert_eq!(response.items.len(), 500);
        assert!(response.truncated);
        assert!(index.search("file", None, 200, || true).unwrap().cancelled);
    }

    #[test]
    fn pages_keep_order_and_metadata_across_reindex_and_release_only_their_own_set() {
        let index = NameIndex::default();
        index.update(
            r"C:\one",
            (0..401).map(|n| file(&format!("n{n:03}.txt"))).collect(),
        );
        index.update(r"C:\one\sub", vec![file("z.txt")]);
        index.update(r"C:\one-more", vec![file("outside.txt")]);
        let find = |id| {
            index
                .find(
                    "ext:txt",
                    Some(r"C:\one"),
                    200,
                    SearchOptions {
                        snapshot_id: Some(id),
                        kind: None,
                    },
                    || false,
                )
                .unwrap()
        };
        let first = find(1);
        assert_eq!(
            (first.total, first.items.len(), first.snapshot_id),
            (402, 200, Some(1))
        );
        index.remove_tree(r"C:\one\sub");
        index.update(
            r"C:\one",
            (1..401).map(|n| file(&format!("n{n:03}.txt"))).collect(),
        );
        let second = index.page(1, 2).unwrap();
        assert_eq!(
            (second.total, second.items[0].name.as_str()),
            (402, "n200.txt")
        );
        assert_eq!(index.page(1, 3).unwrap().items[1].path, r"C:\one\sub\z.txt");
        assert_eq!(index.page(1, 1).unwrap().items[0].name, "n000.txt");
        assert!(
            index.page(1, 0).is_err()
                && index.page(1, usize::MAX).is_err()
                && index.page(1, 4).is_err()
        );
        let next = find(2);
        assert_eq!((next.total, next.items[0].name.as_str()), (400, "n001.txt"));
        index.release_pages(1);
        assert!(index.page(1, 1).is_err() && index.page(2, 2).is_ok());
        index.release_pages(2);
        assert!(index.page(2, 1).is_err());
    }

    #[test]
    fn kind_filter_applies_to_every_or_branch() {
        let index = NameIndex::default();
        index.update(
            r"C:\test",
            vec![
                file("apple"),
                file("banana"),
                Entry::new("banana folder".into(), true, 0, 0, false),
            ],
        );
        for (kind, expected) in [(SearchKind::File, 2), (SearchKind::Dir, 1)] {
            let result = index
                .find(
                    "apple|banana",
                    None,
                    5,
                    SearchOptions {
                        snapshot_id: Some(7),
                        kind: Some(kind),
                    },
                    || false,
                )
                .unwrap();
            assert_eq!(result.total, expected);
            assert!(result.snapshot_id.is_none());
        }
    }

    #[test]
    fn location_change_prunes_counts_and_expires_immutable_pages() {
        let index = NameIndex::default();
        index.update(r"C:\Docs", vec![file("a.txt"), file("b.txt")]);
        index.update(r"C:\Docs-old", vec![file("c.txt")]);
        let old = index
            .find(
                "ext:txt",
                None,
                1,
                SearchOptions {
                    snapshot_id: Some(10),
                    kind: None,
                },
                || false,
            )
            .unwrap();
        assert_eq!(old.total, 3);
        index.mark_verified(r"C:\Docs-old", 1);
        use super::super::locations::{Mode, Policy, Settings};
        let policy = |folders| {
            Policy::new(
                Settings {
                    mode: Mode::Selected,
                    folders,
                    excluded: vec![],
                },
                &[],
                None,
            )
        };
        index.retain_locations(&policy(vec![r"C:\Docs".into()]));
        assert_eq!(index.status().indexed, 2);
        assert_eq!(index.search("ext:txt", None, 8, || false).unwrap().total, 2);
        assert!(index.verified_size(r"C:\Docs-old").is_none());
        assert!(index.page(10, 1).is_err());
        index.retain_locations(&policy(vec![]));
        assert_eq!(index.status().indexed, 0);
    }

    #[test]
    fn restoration_never_imports_an_old_scope_after_an_interrupted_settings_change() {
        use super::super::locations::{Mode, Policy, Settings};
        let roots = vec![r"C:\".to_string()];
        let selected = Policy::new(
            Settings {
                mode: Mode::Selected,
                folders: vec![r"C:\Docs".into()],
                excluded: vec![],
            },
            &roots,
            None,
        );
        let fixed = Policy::new(
            Settings {
                mode: Mode::Fixed,
                folders: vec![],
                excluded: vec![],
            },
            &roots,
            None,
        );
        let temp = tempfile::tempdir().unwrap();
        let path = cache_path(temp.path());
        let old = NameIndex::default();
        old.update(r"C:\Docs", vec![file("keep.txt")]);
        old.update(r"C:\Docs-old", vec![file("hidden.txt")]);
        old.validated_ms.store(100, Ordering::Relaxed);
        for coverage in [None, Some(fixed.keys.as_slice())] {
            old.save_for(&path, coverage, &[]).unwrap();
            let restored = NameIndex::default();
            restored.restore_for(&path, Some(&selected)).unwrap();
            assert_eq!(restored.status().indexed, 0);
            assert_eq!(restored.status().last_validated_ms, 0);
        }
        old.save_for(&path, Some(&selected.keys), &[r"c:\docs\build".into()])
            .unwrap();
        let mismatch = NameIndex::default();
        mismatch.restore_for(&path, Some(&selected)).unwrap();
        assert_eq!(mismatch.status().indexed, 0);
        old.save_for(&path, Some(&selected.keys), &[]).unwrap();
        let restored = NameIndex::default();
        restored.restore_for(&path, Some(&selected)).unwrap();
        assert!(restored.contains(r"C:\Docs"));
        assert!(!restored.contains(r"C:\Docs-old"));
        assert_eq!(restored.status().last_validated_ms, 100);
    }
    #[test]
    fn unchanged_direct_children_reuse_signature_and_subtree_delete_has_boundaries() {
        let index = NameIndex::default();
        assert!(!index.update(r"C:\folder", vec![file("a.txt")]).0);
        assert!(index.update(r"C:\folder", vec![file("a.txt")]).0);
        index.update(r"C:\folder\sub", vec![file("b.txt")]);
        index.update(r"C:\folder-other", vec![file("c.txt")]);
        index.remove_tree(r"C:\folder");
        assert_eq!(
            index
                .search("type:file", None, 200, || false)
                .unwrap()
                .total,
            1
        );
    }
    #[test]
    fn serialized_records_restore_searchable_names_and_validation_time() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file-names-v1.json");
        let index = NameIndex::default();
        index.update(r"C:\folder", vec![file("中文.TXT")]);
        index.mark_verified(r"C:\folder", 12);
        index.limited.store(true, Ordering::Relaxed);
        index.validated_ms.store(now_ms(), Ordering::Relaxed);
        index.save(&path).unwrap();
        let restored = NameIndex::default();
        restored.restore(&path).unwrap();
        assert_eq!(
            restored
                .search("中文 ext:txt", None, 200, || false)
                .unwrap()
                .total,
            1
        );
        assert!(restored.status().cache_restored);
        assert!(restored.status().last_validated_ms > 0);
        assert_eq!(restored.verified_size(r"C:\folder"), Some(12));
        assert!(restored.status().index_limit_reached);
    }

    #[test]
    fn changed_child_invalidates_reusable_ancestor_totals_before_publication() {
        let index = NameIndex::default();
        index.update(
            r"C:\parent",
            vec![Entry::new("child".into(), true, 0, 0, false)],
        );
        index.update(r"C:\parent\child", vec![file("one.txt")]);
        index.mark_verified(r"C:\parent", 12);
        index.mark_verified(r"C:\parent\child", 12);
        index.update(r"C:\parent\child", vec![file("one.txt"), file("two.txt")]);
        assert_eq!(index.verified_size(r"C:\parent"), None);
        assert_eq!(index.verified_size(r"C:\parent\child"), None);
        index.mark_verified(r"C:\parent\child", 24);
        assert_eq!(index.verified_size(r"C:\parent"), None);
    }

    #[test]
    fn metadata_only_updates_keep_size_validity_and_refresh_search_details() {
        let index = NameIndex::default();
        index.update(r"C:\folder", vec![file("a.txt")]);
        index.mark_verified(r"C:\folder", 12);
        let mut entry = file("a.txt");
        entry.mtime = 999;
        assert!(index.update(r"C:\folder", vec![entry]).0);
        assert_eq!(index.verified_size(r"C:\folder"), Some(12));
        assert_eq!(
            index.search("a.txt", None, 10, || false).unwrap().items[0].mtime,
            999
        );
    }
}
