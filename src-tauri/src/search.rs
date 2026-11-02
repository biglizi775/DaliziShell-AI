//! A file-name index fed by the folder-size scanner; searches never enumerate disk.
use serde::{Deserialize, Serialize};
use crate::search_query::{Query, Record};
use std::collections::{BTreeMap, HashSet};
use std::io::{self, Read, Write};
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
    folded: String,
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
    #[serde(flatten)]
    status: SearchStatus,
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
        SearchStatus {
            indexed: self.indexed.load(Ordering::Relaxed),
            indexing: self.active.load(Ordering::Relaxed),
            cache_restored: self.restored.load(Ordering::Relaxed),
            index_limit_reached: self.limited.load(Ordering::Relaxed),
            last_validated_ms: self.validated_ms.load(Ordering::Relaxed),
            next_validation_ms: self.next_validation_ms.load(Ordering::Relaxed),
        }
    }
    pub fn search(
        &self,
        query: &str,
        scope: Option<&str>,
        limit: usize,
        cancelled: impl Fn() -> bool,
    ) -> Result<SearchResponse, String> {
        let query = Query::parse(query)?;
        let mut response = SearchResponse {
            items: Vec::new(),
            total: 0,
            truncated: false,
            cancelled: false,
            status: self.status(),
        };
        if query.is_empty() {
            return Ok(response);
        }
        let limit = limit.clamp(1, 500);
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
            for (position, entry) in dir.entries.iter().enumerate() {
                if position % 1024 == 0 && cancelled() {
                    response.cancelled = true;
                    response.items.clear();
                    return Ok(response);
                }
                let full = if query.needs_path { super::child_path(&dir_key, &entry.folded) } else { String::new() };
                let size = if entry.is_dir { if query.needs_size { super::idx().get(&super::child_path(&dir.path, &entry.name)) } else { None } } else { Some(entry.size) };
                if !query.matches(&Record { name: &entry.folded, path: &full, parent: &dir_key, is_dir: entry.is_dir, size, mtime: entry.mtime }) {
                    continue;
                }
                response.total += 1;
                if response.items.len() < limit {
                    let path = super::child_path(&dir.path, &entry.name);
                    let size = if entry.is_dir {
                        super::idx().get(&path)
                    } else {
                        Some(entry.size)
                    };
                    response.items.push(SearchItem {
                        name: entry.name.clone(),
                        path,
                        is_dir: entry.is_dir,
                        size,
                        mtime: entry.mtime,
                    });
                }
            }
        }
        response.truncated = response.total > response.items.len();
        Ok(response)
    }
    pub fn save(&self, path: &Path) -> io::Result<()> {
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
        let temp = path.with_extension(format!("{}.tmp", std::process::id()));
        let mut file = std::fs::File::create(&temp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(temp, path)
    }
    pub fn restore(&self, path: &Path) -> io::Result<()> {
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
            for entry in &mut directory.entries {
                entry.folded = entry.name.to_lowercase();
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
        let path =
            std::env::temp_dir().join(format!("dalizi-search-test-{}.json", std::process::id()));
        let index = NameIndex::default();
        index.update(r"C:\folder", vec![file("中文.TXT")]);
        index.mark_verified(r"C:\folder", 12);
        index.limited.store(true, Ordering::Relaxed);
        index.validated_ms.store(now_ms(), Ordering::Relaxed);
        index.save(&path).unwrap();
        let restored = NameIndex::default();
        restored.restore(&path).unwrap();
        std::fs::remove_file(path).unwrap();
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
