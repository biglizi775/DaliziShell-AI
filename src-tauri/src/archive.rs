//! In-process archive creation. Never invoke a shell or persist a password.
use chrono::{Datelike, Local, Timelike};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs::{self, File, Metadata, OpenOptions},
    io::{self, BufWriter, Read, Seek, SeekFrom, Write},
    os::windows::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Instant, SystemTime},
};
use zeroize::Zeroize;

const MAX_ENTRIES: usize = 100_000;
const REPARSE: u32 = 0x400;
static NEXT: AtomicU64 = AtomicU64::new(1);
static JOB: OnceLock<Mutex<Option<Arc<Job>>>> = OnceLock::new();

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateRequest {
    sources: Vec<String>,
    directory: String,
    name: String,
    format: String,
    level: u32,
    #[serde(default)]
    password: String,
    #[serde(default)]
    encrypt_names: bool,
}
impl Drop for CreateRequest {
    fn drop(&mut self) {
        self.password.zeroize();
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    id: String,
    phase: String,
    entries: usize,
    completed_entries: usize,
    bytes: u64,
    total_bytes: u64,
    current: String,
    output: Option<String>,
    archive_bytes: u64,
    error: Option<String>,
}
impl Progress {
    fn active(&self) -> bool {
        matches!(
            self.phase.as_str(),
            "scanning" | "compressing" | "finalizing" | "cancelling"
        )
    }
}
struct Job {
    cancelled: AtomicBool,
    progress: Mutex<Progress>,
}
impl Job {
    fn new(id: String) -> Self {
        Self {
            cancelled: AtomicBool::new(false),
            progress: Mutex::new(Progress {
                id,
                phase: "scanning".into(),
                entries: 0,
                completed_entries: 0,
                bytes: 0,
                total_bytes: 0,
                current: String::new(),
                output: None,
                archive_bytes: 0,
                error: None,
            }),
        }
    }
    fn check(&self) -> io::Result<()> {
        if self.cancelled.load(Ordering::Relaxed) {
            Err(io::Error::other("压缩已取消 / Compression cancelled"))
        } else {
            Ok(())
        }
    }
    fn fail(&self, message: String) {
        let mut p = self.progress.lock().unwrap();
        if p.phase == "done" {
            return;
        }
        p.phase = if self.cancelled.load(Ordering::Relaxed) {
            "cancelled"
        } else {
            "error"
        }
        .into();
        p.current.clear();
        p.error = Some(message);
    }
}
fn valid_name(name: &str) -> bool {
    if name.is_empty()
        || name.len() > 240
        || name.ends_with(['.', ' '])
        || name
            .chars()
            .any(|c| c.is_control() || "\\/:*?\"<>|".contains(c))
    {
        return false;
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    !matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) && !((stem.starts_with("COM") || stem.starts_with("LPT"))
        && stem.len() == 4
        && stem.as_bytes()[3].is_ascii_digit())
}
fn validate(request: &CreateRequest) -> Result<(), String> {
    if request.sources.is_empty() || request.sources.len() > 1000 {
        return Err("请选择 1–1000 个文件或文件夹 / Select 1–1000 items".into());
    }
    if !matches!(request.format.as_str(), "7z" | "zip") || !matches!(request.level, 0 | 1 | 5 | 9) {
        return Err("压缩格式或级别无效 / Invalid format or compression level".into());
    }
    if !valid_name(&request.name)
        || !request
            .name
            .to_lowercase()
            .ends_with(&format!(".{}", request.format))
    {
        return Err("请输入有效的压缩包名称，扩展名须与格式一致 / Enter a valid archive name with the selected extension".into());
    }
    if request.password.chars().count() > 256 || request.password.chars().any(char::is_control) {
        return Err("密码最多 256 个字符，不能包含控制字符 / Password: at most 256 characters without control characters".into());
    }
    if request.format == "zip" && (!request.password.is_ascii() || request.password.len() > 99) {
        return Err("ZIP 密码最多 99 个英文字母、数字、半角符号或空格；中文密码请选择 7z / ZIP passwords: up to 99 ASCII characters; choose 7z for Unicode passwords".into());
    }
    if request.encrypt_names && (request.format != "7z" || request.password.is_empty()) {
        return Err(
            "隐藏文件名需要 7z 格式和密码 / Filename encryption requires 7z and a password".into(),
        );
    }
    Ok(())
}
fn ordinary(value: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(value);
    if !p.is_absolute()
        || value.chars().any(char::is_control)
        || value.starts_with(r"\\.")
        || value.starts_with(r"\\?")
        || value.get(2..).is_some_and(|s| s.contains(':'))
    {
        return Err(
            "请选择普通本地或共享目录中的完整路径 / Choose an ordinary absolute filesystem path"
                .into(),
        );
    }
    Ok(p)
}
fn key(p: &Path) -> String {
    p.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}
fn within(child: &str, parent: &str) -> bool {
    child == parent || child.starts_with(&(parent.to_owned() + "\\"))
}
fn err_path(p: &Path, error: impl std::fmt::Display) -> String {
    format!("{}: {error}", p.display())
}
struct Source {
    path: PathBuf,
    name: String,
    meta: Metadata,
}
fn gather(request: &CreateRequest, job: &Job) -> Result<(PathBuf, Vec<Source>), String> {
    validate(request)?;
    let parent = fs::canonicalize(ordinary(&request.directory)?).map_err(|e| e.to_string())?;
    if !parent.is_dir() {
        return Err("输出位置不是文件夹 / Output location is not a directory".into());
    }
    let output = parent.join(&request.name);
    if output.try_exists().map_err(|e| e.to_string())? {
        return Err(
            "同名文件已存在，请修改名称 / Destination already exists; choose another name".into(),
        );
    }
    let mut roots: Vec<(PathBuf, String, bool)> = Vec::new();
    for value in &request.sources {
        job.check().map_err(|e| e.to_string())?;
        let original = ordinary(value)?;
        let meta = fs::symlink_metadata(&original).map_err(|e| err_path(&original, e))?;
        if meta.file_attributes() & REPARSE != 0 {
            return Err(format!("不支持压缩符号链接、联接点或云占位项，请选择实际文件 / Reparse points are not supported: {value}"));
        }
        let path = fs::canonicalize(&original).map_err(|e| err_path(&original, e))?;
        if path.file_name().is_none() {
            return Err("请选中具体文件或文件夹，不能压缩磁盘根目录 / Select files or folders, not a drive root".into());
        }
        let k = key(&path);
        if (meta.is_dir() && within(&key(&parent), &k)) || key(&output) == k {
            return Err("压缩包不能保存在选中的源文件夹内 / Save the archive outside the selected source folders".into());
        }
        if roots
            .iter()
            .any(|(_, other, dir)| *other == k || (*dir && within(&k, other)))
        {
            continue;
        }
        if meta.is_dir() {
            roots.retain(|(_, other, _)| !within(other, &k));
        }
        roots.push((path, k, meta.is_dir()));
    }
    let mut stack = Vec::new();
    let mut names = HashSet::new();
    for (path, _, _) in roots {
        let name = path
            .file_name()
            .and_then(|v| v.to_str())
            .ok_or("文件名不是有效 Unicode / Invalid Unicode filename")?
            .to_owned();
        if !names.insert(name.to_lowercase()) {
            return Err("不同来源存在相同的顶层名称，请分别压缩 / Duplicate top-level names; compress them separately".into());
        }
        stack.push((path, name, 0usize));
    }
    let mut entries = Vec::new();
    let mut bytes = 0u64;
    let mut name_bytes = 0usize;
    let mut last = Instant::now();
    while let Some((path, name, depth)) = stack.pop() {
        job.check().map_err(|e| e.to_string())?;
        if entries.len() >= MAX_ENTRIES || depth > 128 || name.len() > 4096 {
            return Err("文件数或目录深度超限，请分批压缩 / Too many entries or excessive directory depth; split the selection".into());
        }
        name_bytes += name.len();
        if name_bytes > 16 * 1024 * 1024 {
            return Err("文件列表过大，请分批压缩 / Archive entry list is too large".into());
        }
        let meta = fs::symlink_metadata(&path).map_err(|e| err_path(&path, e))?;
        if meta.file_attributes() & REPARSE != 0 || (!meta.is_dir() && !meta.is_file()) {
            return Err(format!(
                "不支持的链接或特殊项目 / Unsupported link or special item: {}",
                path.display()
            ));
        }
        if meta.is_dir() {
            for child in fs::read_dir(&path).map_err(|e| err_path(&path, e))? {
                job.check().map_err(|e| e.to_string())?;
                let child = child.map_err(|e| err_path(&path, e))?;
                let leaf = child
                    .file_name()
                    .into_string()
                    .map_err(|_| "Invalid Unicode filename")?;
                if stack.len() + entries.len() >= MAX_ENTRIES {
                    return Err("项目超过 100000 个，请分批压缩 / More than 100000 entries; split the selection".into());
                }
                stack.push((child.path(), format!("{name}/{leaf}"), depth + 1));
            }
        } else {
            bytes = bytes.checked_add(meta.len()).ok_or("Total size overflow")?;
        }
        entries.push(Source { path, name, meta });
        if last.elapsed().as_millis() >= 100 {
            let mut p = job.progress.lock().unwrap();
            p.entries = entries.len();
            p.total_bytes = bytes;
            last = Instant::now();
        }
    }
    let mut p = job.progress.lock().unwrap();
    p.entries = entries.len();
    p.total_bytes = bytes;
    p.phase = "compressing".into();
    Ok((output, entries))
}
struct Input<'a> {
    file: File,
    job: &'a Job,
    remaining: u64,
    consumed: u64,
}
impl Read for Input<'_> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.job.check()?;
        if self.remaining == 0 {
            return Ok(0);
        }
        let max = buf.len().min(self.remaining.min(64 * 1024) as usize);
        let n = self.file.read(&mut buf[..max])?;
        if n == 0 && max > 0 {
            return Err(io::Error::other(
                "源文件在压缩期间变更 / Source changed during compression",
            ));
        }
        self.remaining -= n as u64;
        self.consumed += n as u64;
        self.job.progress.lock().unwrap().bytes += n as u64;
        Ok(n)
    }
}
struct Output<'a> {
    file: File,
    job: &'a Job,
}
impl Write for Output<'_> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.job.check()?;
        self.file.write(bytes)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.job.check()?;
        self.file.flush()
    }
}
impl Seek for Output<'_> {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        self.job.check()?;
        self.file.seek(pos)
    }
}
struct Partial(PathBuf);
impl Drop for Partial {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
fn input<'a>(entry: &Source, job: &'a Job) -> Result<Input<'a>, String> {
    let file = OpenOptions::new()
        .read(true)
        .share_mode(1)
        .custom_flags(0x00200000)
        .open(&entry.path)
        .map_err(|e| err_path(&entry.path, e))?;
    let meta = file.metadata().map_err(|e| err_path(&entry.path, e))?;
    if meta.file_attributes() & REPARSE != 0
        || meta.len() != entry.meta.len()
        || meta.last_write_time() != entry.meta.last_write_time()
    {
        return Err(err_path(
            &entry.path,
            "源文件已变更，请重试 / Source changed; retry",
        ));
    }
    Ok(Input {
        file,
        job,
        remaining: meta.len(),
        consumed: 0,
    })
}
fn methods(request: &CreateRequest) -> Vec<sevenz_rust2::EncoderConfiguration> {
    let mut methods = Vec::new();
    if !request.password.is_empty() {
        let mut aes =
            sevenz_rust2::encoder_options::AesEncoderOptions::new(request.password.as_str().into());
        aes.num_cycles_power = 19;
        methods.push(aes.into());
    }
    if request.level == 0 {
        methods.push(sevenz_rust2::EncoderMethod::COPY.into());
    } else {
        let mut lzma = sevenz_rust2::encoder_options::Lzma2Options::from_level(request.level);
        lzma.set_dictionary_size(match request.level {
            1 => 1024 * 1024,
            5 => 8 * 1024 * 1024,
            _ => 16 * 1024 * 1024,
        });
        methods.push(lzma.into());
    }
    methods
}
fn zip_time(meta: &Metadata) -> zip::DateTime {
    let local: chrono::DateTime<Local> = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH).into();
    zip::DateTime::from_date_and_time(
        local.year().clamp(1980, 2107) as u16,
        local.month() as u8,
        local.day() as u8,
        local.hour() as u8,
        local.minute() as u8,
        local.second().min(59) as u8,
    )
    .unwrap_or_default()
}
fn publish(from: &Path, to: &Path) -> Result<(), String> {
    use windows::{
        core::PCWSTR,
        Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH},
    };
    let from: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe { MoveFileExW(PCWSTR(from.as_ptr()), PCWSTR(to.as_ptr()), MOVEFILE_WRITE_THROUGH) }.map_err(|e| format!("保存失败，目标可能已存在 / Could not publish archive; destination may already exist: {e}"))
}
use std::os::windows::ffi::OsStrExt;
fn run(request: &CreateRequest, job: &Job) -> Result<(), String> {
    let (output, entries) = gather(request, job)?;
    job.check().map_err(|e| e.to_string())?;
    let stamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let partial_path = output.with_file_name(format!(
        ".dalizi-compress-{}-{stamp}.partial",
        std::process::id()
    ));
    let file = OpenOptions::new()
        .write(true)
        .read(true)
        .create_new(true)
        .open(&partial_path)
        .map_err(|e| err_path(&partial_path, e))?;
    let partial = Partial(partial_path);
    let buffer = BufWriter::with_capacity(128 * 1024, Output { file, job });
    let mut finished = if request.format == "7z" {
        let mut writer = sevenz_rust2::ArchiveWriter::new(buffer).map_err(|e| e.to_string())?;
        writer.set_encrypt_header(request.encrypt_names);
        for entry in &entries {
            job.check().map_err(|e| e.to_string())?;
            job.progress.lock().unwrap().current = entry.name.clone();
            // Fresh salt/IV per stream, and again for the header below.
            writer.set_content_methods(methods(request));
            let archive_entry =
                sevenz_rust2::ArchiveEntry::from_path(&entry.path, entry.name.clone());
            let reader = if entry.meta.is_file() {
                Some(input(entry, job)?)
            } else {
                None
            };
            writer
                .push_archive_entry(archive_entry, reader)
                .map_err(|e| err_path(&entry.path, e))?;
            job.progress.lock().unwrap().completed_entries += 1;
        }
        writer.set_content_methods(methods(request));
        job.progress.lock().unwrap().phase = "finalizing".into();
        writer.finish().map_err(|e| e.to_string())?
    } else {
        let mut writer = zip::ZipWriter::new(buffer);
        for entry in &entries {
            job.check().map_err(|e| e.to_string())?;
            job.progress.lock().unwrap().current = entry.name.clone();
            let mut options = zip::write::SimpleFileOptions::default()
                .last_modified_time(zip_time(&entry.meta))
                .large_file(entry.meta.len() >= u32::MAX as u64);
            if entry.meta.is_dir() {
                writer
                    .add_directory(&entry.name, options)
                    .map_err(|e| e.to_string())?;
            } else {
                options = if request.level == 0 {
                    options.compression_method(zip::CompressionMethod::Stored)
                } else {
                    options
                        .compression_method(zip::CompressionMethod::Deflated)
                        .compression_level(Some(request.level as i64))
                };
                if !request.password.is_empty() {
                    options = options.with_aes_encryption(zip::AesMode::Aes256, &request.password);
                }
                writer
                    .start_file(&entry.name, options)
                    .map_err(|e| e.to_string())?;
                io::copy(&mut input(entry, job)?, &mut writer)
                    .map_err(|e| err_path(&entry.path, e))?;
            }
            job.progress.lock().unwrap().completed_entries += 1;
        }
        job.progress.lock().unwrap().phase = "finalizing".into();
        writer.finish().map_err(|e| e.to_string())?
    };
    finished.flush().map_err(|e| e.to_string())?;
    finished
        .get_ref()
        .file
        .sync_all()
        .map_err(|e| e.to_string())?;
    let size = finished
        .get_ref()
        .file
        .metadata()
        .map_err(|e| e.to_string())?
        .len();
    drop(finished);
    // Serialize cancel with publication. No success is reported until the atomic no-replace move.
    let mut p = job.progress.lock().unwrap();
    job.check().map_err(|e| e.to_string())?;
    publish(&partial.0, &output)?;
    p.phase = "done".into();
    p.current.clear();
    p.archive_bytes = size;
    p.output =
        Some(request.directory.trim_end_matches(['\\', '/']).to_owned() + "\\" + &request.name);
    Ok(())
}
#[tauri::command]
pub async fn archive_start(request: CreateRequest) -> Result<String, String> {
    validate(&request)?;
    let id = NEXT.fetch_add(1, Ordering::Relaxed).to_string();
    let job = Arc::new(Job::new(id.clone()));
    {
        let mut slot = JOB.get_or_init(|| Mutex::new(None)).lock().unwrap();
        if slot
            .as_ref()
            .is_some_and(|j| j.progress.lock().unwrap().active())
        {
            return Err("已有压缩任务正在运行 / An archive task is already running".into());
        }
        *slot = Some(job.clone());
    }
    tauri::async_runtime::spawn(async move {
        let worker_job = job.clone();
        let outcome =
            tauri::async_runtime::spawn_blocking(move || run(&request, &worker_job)).await;
        match outcome {
            Ok(Ok(())) => {}
            Ok(Err(message)) => job.fail(message),
            Err(_) => {
                job.fail("压缩任务意外结束，请重试 / Archive task ended unexpectedly; retry".into())
            }
        }
    });
    Ok(id)
}
fn find(id: &str) -> Result<Arc<Job>, String> {
    JOB.get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap()
        .as_ref()
        .filter(|j| j.progress.lock().unwrap().id == id)
        .cloned()
        .ok_or_else(|| "压缩任务不存在 / Archive task not found".into())
}
#[tauri::command]
pub fn archive_progress(id: String) -> Result<Progress, String> {
    Ok(find(&id)?.progress.lock().unwrap().clone())
}
#[tauri::command]
pub fn archive_cancel(id: String) -> Result<bool, String> {
    let job = find(&id)?;
    let mut p = job.progress.lock().unwrap();
    if !p.active() {
        return Ok(false);
    }
    job.cancelled.store(true, Ordering::Relaxed);
    p.phase = "cancelling".into();
    Ok(true)
}
#[tauri::command]
pub async fn archive_pick_directory(directory: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog =
            rfd::FileDialog::new().set_title("选择压缩包保存目录 / Archive destination");
        if let Ok(path) = ordinary(&directory) {
            if path.is_dir() {
                dialog = dialog.set_directory(path);
            }
        }
        dialog
            .pick_folder()
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (PathBuf, CreateRequest) {
        let root = std::env::temp_dir().join(format!(
            "dalizi-archive-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(root.join("资料/空目录")).unwrap();
        fs::write(root.join("资料/你好.txt"), "测试内容\n".repeat(100)).unwrap();
        fs::write(root.join("资料/empty.txt"), b"").unwrap();
        let request = CreateRequest {
            sources: vec![root.join("资料").display().to_string()],
            directory: root.display().to_string(),
            name: "测试.7z".into(),
            format: "7z".into(),
            level: 1,
            password: String::new(),
            encrypt_names: false,
        };
        (root, request)
    }
    fn cleanup(root: &Path) {
        // Delete only this fixture's known regular files and empty directories.
        for dir in [
            root.join("资料/空目录"),
            root.join("资料"),
            root.to_path_buf(),
        ] {
            for entry in fs::read_dir(&dir).unwrap() {
                let p = entry.unwrap().path();
                if p.is_file() {
                    fs::remove_file(p).unwrap();
                }
            }
            fs::remove_dir(dir).unwrap();
        }
    }
    #[test]
    fn archives_round_trip_unicode_empty_entries_and_passwords() {
        let (root, mut request) = fixture();
        request.password = "测试 password 🔒".into();
        request.encrypt_names = true;
        let job = Job::new("test".into());
        run(&request, &job).unwrap();
        let path = root.join(&request.name);
        assert!(sevenz_rust2::ArchiveReader::open(&path, "wrong".into()).is_err());
        let mut archive =
            sevenz_rust2::ArchiveReader::open(&path, request.password.as_str().into()).unwrap();
        let mut names = Vec::new();
        archive
            .for_each_entries(|entry, reader| {
                let mut data = Vec::new();
                reader.read_to_end(&mut data).unwrap();
                names.push(entry.name.clone());
                if entry.name.ends_with("你好.txt") {
                    assert_eq!(String::from_utf8(data).unwrap(), "测试内容\n".repeat(100));
                }
                Ok(true)
            })
            .unwrap();
        assert!(names.contains(&"资料/空目录".into()));
        assert!(names.contains(&"资料/empty.txt".into()));
        drop(archive);
        request.format = "zip".into();
        request.name = "测试.zip".into();
        request.encrypt_names = false;
        assert!(
            validate(&request).is_err(),
            "ZIP rejects nonportable Unicode passwords"
        );
        request.password = "ASCII long password !92".into();
        run(&request, &Job::new("zip".into())).unwrap();
        let mut archive =
            zip::ZipArchive::new(File::open(root.join(&request.name)).unwrap()).unwrap();
        assert!(archive.by_name_decrypt("资料/你好.txt", b"wrong").is_err());
        let mut contents = String::new();
        archive
            .by_name_decrypt("资料/你好.txt", request.password.as_bytes())
            .unwrap()
            .read_to_string(&mut contents)
            .unwrap();
        assert_eq!(contents, "测试内容\n".repeat(100));
        assert!(archive.by_name("资料/空目录/").unwrap().is_dir());
        drop(archive);
        cleanup(&root);
    }
    #[test]
    fn validation_rejects_unsafe_destinations_and_preserves_existing_files() {
        let (root, mut request) = fixture();
        for name in ["../bad.7z", "NUL.7z", "a:stream.7z", "bad.zip", "bad.7z."] {
            request.name = name.into();
            assert!(validate(&request).is_err());
        }
        request.name = "测试.7z".into();
        let job = Job::new("test".into());
        request.directory = root.join("资料/空目录").display().to_string();
        assert!(gather(&request, &job).is_err());
        request.directory = root.display().to_string();
        request
            .sources
            .push(root.join("资料/你好.txt").display().to_string());
        assert_eq!(
            gather(&request, &job).unwrap().1.len(),
            4,
            "a selected parent subsumes its selected child"
        );
        fs::write(root.join(&request.name), b"existing archive").unwrap();
        assert!(run(&request, &job).is_err());
        assert_eq!(
            fs::read(root.join(&request.name)).unwrap(),
            b"existing archive"
        );
        let late = root.join("late.partial");
        fs::write(&late, b"new archive").unwrap();
        assert!(publish(&late, &root.join(&request.name)).is_err());
        assert_eq!(
            fs::read(root.join(&request.name)).unwrap(),
            b"existing archive",
            "publication cannot overwrite a file created after validation"
        );
        cleanup(&root);
    }
    #[test]
    fn cancellation_interrupts_streams_and_does_not_publish_partial_archives() {
        let (root, mut request) = fixture();
        let big = root.join("资料/large.bin");
        File::create(&big)
            .unwrap()
            .set_len(16 * 1024 * 1024)
            .unwrap();
        request.level = 1;
        let job = Arc::new(Job::new("cancel".into()));
        let worker_job = job.clone();
        let thread = std::thread::spawn(move || run(&request, &worker_job));
        let start = Instant::now();
        loop {
            if job.progress.lock().unwrap().bytes > 0 {
                job.cancelled.store(true, Ordering::Relaxed);
                break;
            }
            assert!(start.elapsed().as_secs() < 15);
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        assert!(thread.join().unwrap().is_err());
        assert!(!root.join("测试.7z").exists());
        assert!(!fs::read_dir(&root).unwrap().any(|e| e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".partial")));
        assert!(big.exists());
        cleanup(&root);
    }
}
