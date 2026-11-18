//! Exclusive Windows process for one snapshot task. No project directory or parent environment is inherited.
use crate::run_prompt;
use std::{
    fs, io,
    os::windows::fs::MetadataExt,
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{io::BufReader, process::Command, sync::oneshot};
use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

const OVERLAY: &[u8] = include_bytes!("../../../resources/harness/snapshot-only.yml");
pub struct Runtime {
    pub node: PathBuf,
    pub entry: PathBuf,
}
pub struct Turn<'a> {
    pub id: &'a str,
    pub model: &'a str,
    pub base_url: &'a str,
    pub key: &'a str,
    pub prompt: &'a str,
}
pub enum Outcome {
    Answer(String),
    Cancelled,
}

impl Runtime {
    /// Locate the pinned developer installation. Production distribution is separate.
    pub fn development(base: &Path) -> io::Result<Self> {
        let node = base.join("node-v24.22.1-win-x64/node.exe");
        let pkg = base.join("runtime-0.2.2-rc.3/node_modules/@deepseek-ai/dsh");
        let meta: serde_json::Value = serde_json::from_slice(&fs::read(pkg.join("package.json"))?)?;
        let entry = pkg.join("lib/bin.js");
        if !base.is_absolute()
            || !node.is_file()
            || !entry.is_file()
            || meta["version"] != "0.2.2-rc.3"
            || meta["name"] != "@deepseek-ai/dsh"
        {
            return Err(io::Error::other("缺少固定版本 Harness 开发运行时"));
        }
        Ok(Self { node, entry })
    }
}

fn job() -> io::Result<OwnedHandle> {
    let ptr = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
    if ptr.is_null() {
        return Err(io::Error::last_os_error());
    }
    // This handle is private to the parent; dropping it terminates remaining job processes.
    let owned = unsafe { OwnedHandle::from_raw_handle(ptr) };
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if unsafe {
        SetInformationJobObject(
            ptr,
            JobObjectExtendedLimitInformation,
            (&raw const limits).cast(),
            std::mem::size_of_val(&limits) as u32,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(owned)
}

fn scratch_name(id: &str) -> io::Result<String> {
    if id.len() != 36
        || !id.bytes().enumerate().all(|(i, b)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
    {
        return Err(io::Error::other("无效的任务编号"));
    }
    Ok(format!("turn-{id}"))
}

/// Reclaim only this ledger entry's private runtime directory after a desktop crash.
pub fn cleanup_task_scratch(parent: &Path, id: &str) -> io::Result<()> {
    let name = scratch_name(id)?;
    if fs::symlink_metadata(parent)?.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(io::Error::other("任务数据目录不能是链接"));
    }
    let parent = parent.canonicalize()?;
    let target = parent.join(name);
    let meta = match fs::symlink_metadata(&target) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        other => other?,
    };
    if !meta.is_dir()
        || meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
        || target.canonicalize()?.parent() != Some(parent.as_path())
    {
        return Err(io::Error::other("无法确认此任务的临时目录"));
    }
    fs::remove_dir_all(target)
}

/// Start in a fresh private home and terminate the process tree on stop or timeout.
pub async fn execute(
    provision: impl FnOnce(&Path) -> io::Result<Runtime> + Send + 'static,
    scratch: &Path,
    turn: Turn<'_>,
    mut stop: oneshot::Receiver<()>,
) -> io::Result<Outcome> {
    let name = scratch_name(turn.id)?;
    let home = tempfile::Builder::new()
        .prefix(&name)
        .rand_bytes(0)
        .tempdir_in(scratch)?;
    let root = home.path();
    // Materialize a verified sidecar off the async worker. Nothing is spawned, and
    // no credential is sent, until every payload member has passed verification.
    let owned_root = root.to_owned();
    let rt = tokio::task::spawn_blocking(move || provision(&owned_root))
        .await
        .map_err(io::Error::other)??;
    if !matches!(stop.try_recv(), Err(oneshot::error::TryRecvError::Empty)) {
        return Ok(Outcome::Cancelled);
    }
    for sub in [
        "workspace",
        "launch",
        "roaming",
        "local",
        "temp",
        "dsh",
        "agents",
    ] {
        fs::create_dir(root.join(sub))?;
    }
    let patch = root.join("snapshot.yml");
    fs::write(&patch, OVERLAY)?;
    let mut cmd = Command::new(&rt.node);
    cmd.env_clear();
    for k in ["SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"] {
        if let Some(v) = std::env::var_os(k) {
            cmd.env(k, v);
        }
    }
    cmd.arg("--no-global-search-paths")
        .arg(&rt.entry)
        .args(["--profile", "sdk-minimal", "--patch"])
        .arg(patch)
        .current_dir(root.join("launch"))
        .env(
            "PATH",
            rt.node
                .parent()
                .ok_or_else(|| io::Error::other("invalid Node path"))?,
        )
        .env("HOME", root)
        .env("USERPROFILE", root)
        .env("APPDATA", root.join("roaming"))
        .env("LOCALAPPDATA", root.join("local"))
        .env("TEMP", root.join("temp"))
        .env("TMP", root.join("temp"))
        .env("DSH_HOME", root.join("dsh"))
        .env("DSH_AGENTS_HOME", root.join("agents"))
        .env("DSH_TELEMETRY_DISABLED", "1")
        .env("DEEPSEEK_BASE_URL", turn.base_url)
        .env("DEEPSEEK_API_KEY", turn.key)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(0x08000000)
        .kill_on_drop(true);
    let owned = job()?;
    let mut child = cmd.spawn()?;
    drop(cmd);
    let raw = child
        .raw_handle()
        .ok_or_else(|| io::Error::other("missing process handle"))?;
    // No SDK handshake or user prompt is sent before the child belongs to the job.
    if unsafe { AssignProcessToJobObject(owned.as_raw_handle(), raw) } == 0 {
        let error = io::Error::last_os_error();
        child.kill().await?;
        return Err(error);
    }
    let input = BufReader::new(
        child
            .stdout
            .take()
            .ok_or_else(|| io::Error::other("missing stdout"))?,
    );
    let output = child
        .stdin
        .take()
        .ok_or_else(|| io::Error::other("missing stdin"))?;
    let work = root.join("workspace");
    let run = async {
        let reply = run_prompt(
            input,
            output,
            work.to_str()
                .ok_or_else(|| io::Error::other("invalid scratch path"))?,
            turn.model,
            turn.id,
            turn.prompt,
        )
        .await?;
        if !child.wait().await?.success() {
            return Err(io::Error::other("运行时未正常退出"));
        }
        Ok(Outcome::Answer(reply))
    };
    let result = tokio::select! {
        biased;
        _ = &mut stop => Ok(Outcome::Cancelled),
        res = tokio::time::timeout(Duration::from_secs(180),run) => res.map_err(|_| io::Error::new(io::ErrorKind::TimedOut,"模型请求超时")).and_then(|v|v)
    };
    drop(owned);
    tokio::time::timeout(Duration::from_secs(10), child.wait())
        .await
        .map_err(|_| io::Error::other("无法确认运行时已退出"))??;
    result
}
