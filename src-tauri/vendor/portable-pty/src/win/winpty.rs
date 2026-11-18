//! Bindings for the optional WinPTY 0.4.3 console agent.
use super::WinChild;
use crate::{CommandBuilder, PtySize};
use anyhow::{anyhow, Context, Result};
use filedescriptor::{FileDescriptor, OwnedHandle};
use shared_library::shared_library;
use std::ffi::{c_void, OsString};
use std::fs::{File, OpenOptions};
use std::os::windows::ffi::OsStringExt;
use std::os::windows::io::FromRawHandle;
use std::path::Path;
use std::ptr::{self, NonNull};
use std::sync::Mutex;
use winapi::um::winbase::lstrlenW;
use winapi::um::wincon::COORD;

type Object = *mut c_void;
type Wide = *const u16;

// The WinPTY C API uses cdecl on x86. Its error, config and session
// objects must be freed by the DLL that allocated them.
shared_library!(Api,
    pub fn winpty_config_new(flags: u64, error: *mut Object) -> Object,
    pub fn winpty_config_free(config: Object),
    pub fn winpty_config_set_initial_size(config: Object, cols: i32, rows: i32),
    pub fn winpty_open(config: Object, error: *mut Object) -> Object,
    pub fn winpty_free(agent: Object),
    pub fn winpty_conin_name(agent: Object) -> Wide,
    pub fn winpty_conout_name(agent: Object) -> Wide,
    pub fn winpty_set_size(agent: Object, cols: i32, rows: i32, error: *mut Object) -> i32,
    pub fn winpty_spawn_config_new(flags: u64, exe: Wide, args: Wide, cwd: Wide, env: Wide, error: *mut Object) -> Object,
    pub fn winpty_spawn_config_free(config: Object),
    pub fn winpty_spawn(agent: Object, config: Object, process: *mut Object, thread: *mut Object, code: *mut u32, error: *mut Object) -> i32,
    pub fn winpty_error_msg(error: Object) -> Wide,
    pub fn winpty_error_free(error: Object),
);

// The API guarantees a NUL-terminated name or message that lives until the
// owning object is freed. Copy it while that object and DLL are alive.
unsafe fn copy_wide(value: Wide) -> Option<OsString> {
    if value.is_null() {
        return None;
    }
    Some(OsString::from_wide(std::slice::from_raw_parts(
        value,
        lstrlenW(value) as usize,
    )))
}

impl Api {
    fn error(&self, object: Object) -> anyhow::Error {
        if object.is_null() {
            return anyhow!("WinPTY returned no error description");
        }
        unsafe {
            let message = copy_wide((self.winpty_error_msg)(object)).unwrap_or_default();
            (self.winpty_error_free)(object);
            anyhow!("WinPTY: {}", message.to_string_lossy())
        }
    }
}

pub(super) struct WinPty {
    api: Api,
    agent: NonNull<c_void>,
}

// The owning PTY pair serializes agent calls using the same mutex as ConPTY.
unsafe impl Send for WinPty {}

impl Drop for WinPty {
    fn drop(&mut self) {
        unsafe { (self.api.winpty_free)(self.agent.as_ptr()) }
    }
}

impl WinPty {
    pub(super) fn open(
        path: &Path,
        size: PtySize,
    ) -> Result<(Self, FileDescriptor, FileDescriptor)> {
        anyhow::ensure!(
            path.is_absolute(),
            "WinPTY requires an absolute library path"
        );
        let api =
            Api::open(path).map_err(|e| anyhow!("Could not load {}: {:?}", path.display(), e))?;
        let mut error = ptr::null_mut();
        unsafe {
            let config = NonNull::new((api.winpty_config_new)(0, &mut error))
                .ok_or_else(|| api.error(error))?;
            (api.winpty_config_set_initial_size)(
                config.as_ptr(),
                size.cols.into(),
                size.rows.into(),
            );
            let agent = (api.winpty_open)(config.as_ptr(), &mut error);
            (api.winpty_config_free)(config.as_ptr());
            let agent = NonNull::new(agent).ok_or_else(|| api.error(error))?;
            let session = Self { api, agent };
            let output = copy_wide((session.api.winpty_conout_name)(agent.as_ptr()))
                .context("missing WinPTY output pipe")?;
            let input = copy_wide((session.api.winpty_conin_name)(agent.as_ptr()))
                .context("missing WinPTY input pipe")?;
            let reader = File::open(output).context("open WinPTY output pipe")?;
            let writer = OpenOptions::new()
                .write(true)
                .open(input)
                .context("open WinPTY input pipe")?;
            Ok((
                session,
                FileDescriptor::new(reader),
                FileDescriptor::new(writer),
            ))
        }
    }

    pub(super) fn resize(&self, size: COORD) -> Result<()> {
        let mut error = ptr::null_mut();
        let ok = unsafe {
            (self.api.winpty_set_size)(
                self.agent.as_ptr(),
                size.X.into(),
                size.Y.into(),
                &mut error,
            )
        };
        if ok == 0 {
            return Err(self.api.error(error));
        }
        Ok(())
    }

    pub(super) fn spawn_command(&self, cmd: CommandBuilder) -> Result<WinChild> {
        let (exe, args) = cmd.cmdline()?;
        let cwd = cmd.current_directory();
        let env = cmd.environment_block();
        let mut error = ptr::null_mut();
        let mut process = ptr::null_mut();
        let mut code = 0;
        unsafe {
            // AUTO_SHUTDOWN drains the last screen update and closes the output
            // pipe after child exit, allowing the desktop reader to see EOF.
            let config = (self.api.winpty_spawn_config_new)(
                1,
                exe.as_ptr(),
                args.as_ptr(),
                cwd.as_ref().map_or(ptr::null(), |d| d.as_ptr()),
                env.as_ptr(),
                &mut error,
            );
            let config = NonNull::new(config).ok_or_else(|| self.api.error(error))?;
            let ok = (self.api.winpty_spawn)(
                self.agent.as_ptr(),
                config.as_ptr(),
                &mut process,
                ptr::null_mut(),
                &mut code,
                &mut error,
            );
            (self.api.winpty_spawn_config_free)(config.as_ptr());
            if ok == 0 {
                return Err(self
                    .api
                    .error(error)
                    .context(format!("WinPTY spawn (Windows error {code})")));
            }
            let handle = NonNull::new(process).context("missing WinPTY child process handle")?;
            Ok(WinChild {
                proc: Mutex::new(OwnedHandle::from_raw_handle(handle.as_ptr())),
            })
        }
    }
}
