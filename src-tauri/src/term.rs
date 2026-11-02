// Embedded PowerShell terminal backend on portable-pty (wezterm's ConPTY
// wrapper — battle-tested across Windows builds).
//
// Note for future debugging: on recent Windows builds ConPTY performs a
// startup handshake (e.g. emits `ESC[6n` cursor-position request and waits
// for the reply). xterm.js answers those automatically on the input path, so
// the frontend must keep forwarding keystrokes unconditionally; a raw pipe
// client that never replies will see the shell "hang" — that is expected,
// see src/bin/ptytest.rs.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock, TryLockError};
use std::time::Duration;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
struct TermOutEvent {
    id: u32,
    key: String,
    data: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TermClosedEvent {
    id: u32,
    key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    exit_code: Option<u32>,
}

struct TermSession {
    master: Mutex<Box<dyn MasterPty + Send>>, // dropping it tears the PTY down
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn Child + Send>>,
}

static NEXT_ID: AtomicU32 = AtomicU32::new(1);
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);
static SESSIONS: OnceLock<Mutex<HashMap<u32, Arc<TermSession>>>> = OnceLock::new();

fn sessions() -> &'static Mutex<HashMap<u32, Arc<TermSession>>> {
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Prefer PowerShell 7 (fixed location or anywhere on PATH); fall back to
/// built-in Windows PowerShell.
fn find_shell() -> String {
    const PW7: &str = r"C:\Program Files\PowerShell\7\pwsh.exe";
    if Path::new(PW7).exists() {
        return PW7.to_string();
    }
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join("pwsh.exe");
            if candidate.is_file() {
                return candidate.to_string_lossy().into_owned();
            }
        }
    }
    r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe".to_string()
}

/// Reader thread: forwards output as `term-out` events (carrying incomplete
/// UTF-8 sequences across chunk boundaries), then emits `term-closed` once.
fn spawn_reader(
    app: AppHandle,
    id: u32,
    key: String,
    mut reader: Box<dyn Read + Send>,
    mut ssh: Option<crate::ssh::InfoParser>,
) {
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut pending: Vec<u8> = Vec::new();
        loop {
            let n = match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            let bytes = if let Some(parser) = ssh.as_mut() {
                let (bytes, info) = parser.feed(&buf[..n]);
                if let Some(info) = info {
                    // The remote bootstrap waits with terminal echo disabled
                    // until this nonce acknowledgement is observed. Only then
                    // can the login shell replace its temporary OSC title.
                    if let Ok(session) = get_session(id) {
                        let sent = session.writer.lock().ok().is_some_and(|mut writer| {
                            writer
                                .write_all(parser.acknowledgement())
                                .and_then(|_| writer.flush())
                                .is_ok()
                        });
                        if sent {
                            let _ = app.emit(
                                "ssh-info",
                                crate::ssh::InfoEvent {
                                    id,
                                    key: key.clone(),
                                    info,
                                },
                            );
                        }
                    }
                }
                bytes
            } else {
                buf[..n].to_vec()
            };
            pending.extend_from_slice(&bytes);
            let data = decode_output(&mut pending);
            if !data.is_empty() {
                let _ = app.emit(
                    "term-out",
                    TermOutEvent {
                        id,
                        key: key.clone(),
                        data,
                    },
                );
            }
        }
        if let Some(parser) = ssh.as_mut() {
            pending.extend_from_slice(&parser.finish());
        }
        if !pending.is_empty() {
            let _ = app.emit(
                "term-out",
                TermOutEvent {
                    id,
                    key: key.clone(),
                    data: String::from_utf8_lossy(&pending).into_owned(),
                },
            );
        }
        let session = sessions().lock().unwrap().get(&id).cloned();
        // EOF and process termination can arrive a few milliseconds apart.
        // Bounded polling keeps close notifications responsive even if a
        // terminal driver closes unexpectedly while its child is still alive.
        let cleanup = session
            .as_ref()
            .map(|session| -> Result<Option<u32>, String> {
                let mut child = session
                    .child
                    .lock()
                    .map_err(|_| "Terminal process lock unavailable")?;
                for _ in 0..20 {
                    match child.try_wait() {
                        Ok(Some(status)) => return Ok(Some(status.exit_code())),
                        Ok(None) => std::thread::sleep(std::time::Duration::from_millis(10)),
                        Err(_) => break,
                    }
                }
                // An output driver failure can close the stream while ssh.exe is
                // still alive. Terminate that child before discarding its handle;
                // on failure retain the session so force-disconnect can be retried.
                terminate_child(id, child.as_mut())?;
                Ok(child
                    .try_wait()
                    .ok()
                    .flatten()
                    .map(|status| status.exit_code()))
            })
            .unwrap_or(Ok(None));
        let exit_code = match cleanup {
            Ok(code) => code,
            Err(error) => {
                let _ = app.emit("term-out", TermOutEvent {
                    id, key, data: format!("\r\n[终端输出已关闭，子进程退出未确认；请重试强制断开 / Terminal output closed; child exit unconfirmed. Retry force disconnect: {error}]\r\n"),
                });
                return;
            }
        };
        if let Some(session) = &session {
            let mut active = sessions().lock().unwrap();
            if active
                .get(&id)
                .is_some_and(|current| Arc::ptr_eq(current, session))
            {
                active.remove(&id);
            }
        }
        drop(session); // never drop a PTY while holding the session registry lock
        let _ = app.emit("term-closed", TermClosedEvent { id, key, exit_code });
    });
}

#[tauri::command]
pub async fn term_start(
    key: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    app: AppHandle,
) -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(move || start_session(key, cwd, cols, rows, app))
        .await
        .map_err(|e| e.to_string())?
}

fn start_session(
    key: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    app: AppHandle,
) -> Result<u32, String> {
    validate_size(cols, rows)?;
    if let Some(c) = cwd.as_ref().filter(|c| !c.is_empty()) {
        if !Path::new(c).is_dir() {
            return Err(format!("terminal directory does not exist: {c}"));
        }
    }
    let mut cmd = CommandBuilder::new(find_shell());
    cmd.arg("-NoLogo");
    if let Some(c) = cwd.as_ref().filter(|c| !c.is_empty()) {
        cmd.cwd(c);
    }
    start_command(key, cols, rows, cmd, app, None)
}

pub(crate) fn start_command(
    key: String,
    cols: u16,
    rows: u16,
    cmd: CommandBuilder,
    app: AppHandle,
    ssh: Option<crate::ssh::InfoParser>,
) -> Result<u32, String> {
    validate_size(cols, rows)?;
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let size = PtySize {
        rows: rows.into(),
        cols: cols.into(),
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = native_pty_system()
        .openpty(size)
        .map_err(|e| format!("openpty: {}", e))?;
    let portable_pty::PtyPair { master, slave } = pair;
    // Acquire fallible I/O handles before spawning, so failures cannot orphan a shell.
    let reader = master
        .try_clone_reader()
        .map_err(|e| format!("pty reader: {}", e))?;
    let writer = master
        .take_writer()
        .map_err(|e| format!("pty writer: {}", e))?;
    let child = slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn terminal: {}", e))?;
    drop(slave); // recommended: the slave is not needed after spawning

    let session = Arc::new(TermSession {
        master: Mutex::new(master),
        writer: Mutex::new(writer),
        child: Mutex::new(child),
    });
    {
        let mut active = sessions().lock().unwrap();
        if SHUTTING_DOWN.load(Ordering::SeqCst) {
            drop(active);
            let _ = session.child.lock().unwrap().kill();
            return Err("application is shutting down".into());
        }
        active.insert(id, session);
    }
    spawn_reader(app, id, key, reader, ssh);
    Ok(id)
}

#[tauri::command]
pub async fn term_write(id: u32, data: String) -> Result<(), String> {
    if id >= crate::ssh_managed::FIRST_ID { return crate::ssh_managed::write(id, data).await; }
    tauri::async_runtime::spawn_blocking(move || {
        let s = get_session(id)?;
        let mut w = s
            .writer
            .lock()
            .map_err(|_| format!("terminal {id} input lock unavailable"))?;
        w.write_all(data.as_bytes())
            .and_then(|_| w.flush())
            .map_err(|e| format!("terminal {} write: {}", id, e))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn interrupt_writer(id: u32, writer: &Mutex<Box<dyn Write + Send>>) -> Result<(), String> {
    let mut writer = writer.try_lock().map_err(|error| match error {
        TryLockError::WouldBlock => format!("终端 {id} 输入通道正忙，中断未发送；请重试或强制断开 / Terminal input busy; interrupt not sent. Retry or force disconnect"),
        TryLockError::Poisoned(_) => format!("终端 {id} 输入通道不可用，中断未发送 / Terminal input unavailable; interrupt not sent"),
    })?;
    // Send ETX to this PTY only. The local/remote foreground application
    // decides how to handle Ctrl+C; never signal the whole Windows console.
    writer.write_all(b"\x03").and_then(|_| writer.flush())
        .map_err(|error| format!("终端 {id} 中断发送失败，会话未被标记为退出 / Interrupt write failed; session status unchanged: {error}"))
}

#[tauri::command]
pub async fn term_interrupt(id: u32) -> Result<(), String> {
    if id >= crate::ssh_managed::FIRST_ID { return crate::ssh_managed::write(id, "\u{3}".into()).await; }
    // Capture the old session before dispatch. A delayed write can never be
    // redirected into a replacement connection's newly allocated session ID.
    let session = get_session(id)?;
    let worker =
        tauri::async_runtime::spawn_blocking(move || interrupt_writer(id, &session.writer));
    // try_lock avoids the ordinary input queue, but the OS pipe write itself
    // can still block. A timeout bounds the UI response, not the native write.
    tokio::time::timeout(Duration::from_secs(3), worker).await
        .map_err(|_| format!("终端 {id} 中断发送尚未确认；后台写入可能仍在等待，可强制断开 / Interrupt delivery unconfirmed; the background write may still be pending. Force disconnect is available"))?
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn term_resize(id: u32, cols: u16, rows: u16) -> Result<(), String> {
    validate_size(cols, rows)?;
    if id >= crate::ssh_managed::FIRST_ID { return crate::ssh_managed::resize(id, cols, rows).await; }
    tauri::async_runtime::spawn_blocking(move || {
        let s = get_session(id)?;
        let m = s.master.lock().unwrap();
        m.resize(PtySize {
            rows: rows.into(),
            cols: cols.into(),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("terminal {} resize: {}", id, e))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn term_kill(id: u32) -> Result<(), String> {
    if id >= crate::ssh_managed::FIRST_ID { return crate::ssh_managed::kill(id).await; }
    tauri::async_runtime::spawn_blocking(move || {
        let session = sessions()
            .lock()
            .map_err(|_| "Terminal registry unavailable")?
            .get(&id)
            .cloned();
        let Some(session) = session else {
            return Ok(());
        };
        {
            let mut child = session
                .child
                .lock()
                .map_err(|_| format!("terminal {id} process lock unavailable; session retained"))?;
            terminate_child(id, child.as_mut())?;
        }
        // Preserve the registry and I/O on failure so the user can retry.
        // Do not hold the registry lock while killing or dropping a PTY.
        let removed = {
            let mut active = sessions()
                .lock()
                .map_err(|_| "Terminal registry unavailable")?;
            if active
                .get(&id)
                .is_some_and(|current| Arc::ptr_eq(current, &session))
            {
                active.remove(&id)
            } else {
                None
            }
        };
        drop(removed);
        drop(session);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn terminate_child(id: u32, child: &mut dyn Child) -> Result<(), String> {
    if matches!(child.try_wait(), Ok(Some(_))) {
        return Ok(());
    }
    match child.kill() {
        Ok(()) => Ok(()),
        // The child may have exited between try_wait and kill. That is an
        // idempotent disconnect; every other failure leaves it registered.
        Err(_) if matches!(child.try_wait(), Ok(Some(_))) => Ok(()),
        Err(error) => Err(format!("终端 {id} 强制断开失败，会话仍保留，可重试 / Could not terminate terminal; session retained for retry: {error}")),
    }
}

// The real OpenSSH/ConPTY integration test uses the production registry and
// commands, while owning its own reader instead of starting a GUI event loop.
#[cfg(test)]
pub(crate) fn register_fixture_session(
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send>,
) -> u32 {
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    sessions().lock().unwrap().insert(
        id,
        Arc::new(TermSession {
            master: Mutex::new(master),
            writer: Mutex::new(writer),
            child: Mutex::new(child),
        }),
    );
    id
}

#[cfg(test)]
pub(crate) fn fixture_session_exit(id: u32) -> Result<Option<u32>, String> {
    get_session(id)?
        .child
        .lock()
        .map_err(|_| "Fixture child lock unavailable")?
        .try_wait()
        .map(|status| status.map(|status| status.exit_code()))
        .map_err(|error| error.to_string())
}

fn get_session(id: u32) -> Result<Arc<TermSession>, String> {
    sessions()
        .lock()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("terminal {} not found", id))
}

fn validate_size(cols: u16, rows: u16) -> Result<(), String> {
    if cols == 0 || rows == 0 || cols > 32767 || rows > 32767 {
        Err("invalid terminal dimensions".into())
    } else {
        Ok(())
    }
}

// Consume all complete UTF-8, retaining only a truncated final code point.
pub(crate) fn decode_output(pending: &mut Vec<u8>) -> String {
    let mut out = String::new();
    let mut used = 0;
    while used < pending.len() {
        match std::str::from_utf8(&pending[used..]) {
            Ok(s) => {
                out.push_str(s);
                used = pending.len();
            }
            Err(e) => {
                let end = used + e.valid_up_to();
                out.push_str(std::str::from_utf8(&pending[used..end]).unwrap());
                used = end;
                if let Some(n) = e.error_len() {
                    out.push('\u{fffd}');
                    used += n;
                } else {
                    break;
                }
            }
        }
    }
    pending.drain(..used);
    out
}

pub fn shutdown() {
    crate::ssh_managed::shutdown();
    SHUTTING_DOWN.store(true, Ordering::SeqCst);
    let active = std::mem::take(&mut *sessions().lock().unwrap());
    for session in active.into_values() {
        if let Ok(mut child) = session.child.lock() {
            let _ = child.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use portable_pty::{ChildKiller, ExitStatus};

    #[derive(Clone, Debug)]
    struct TerminationFixture {
        running: bool,
        refuse_kill: bool,
        exit_during_kill: bool,
        kill_calls: usize,
    }
    impl ChildKiller for TerminationFixture {
        fn kill(&mut self) -> std::io::Result<()> {
            self.kill_calls += 1;
            if self.exit_during_kill {
                self.running = false;
            }
            if self.refuse_kill {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "fixture kill refused",
                ));
            }
            self.running = false;
            Ok(())
        }
        fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
            Box::new(self.clone())
        }
    }
    impl Child for TerminationFixture {
        fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>> {
            Ok((!self.running).then(|| ExitStatus::with_exit_code(7)))
        }
        fn wait(&mut self) -> std::io::Result<ExitStatus> {
            self.try_wait()?
                .ok_or_else(|| std::io::Error::other("fixture still running"))
        }
        fn process_id(&self) -> Option<u32> {
            None
        }
        fn as_raw_handle(&self) -> Option<std::os::windows::io::RawHandle> {
            None
        }
    }

    #[test]
    fn failed_kill_remains_retryable_and_exit_races_are_idempotent() {
        let mut child = TerminationFixture {
            running: true,
            refuse_kill: true,
            exit_during_kill: false,
            kill_calls: 0,
        };
        assert!(terminate_child(7, &mut child)
            .unwrap_err()
            .contains("retained for retry"));
        assert!(child.running);
        child.refuse_kill = false;
        assert!(terminate_child(7, &mut child).is_ok());
        assert!(!child.running);
        assert!(terminate_child(7, &mut child).is_ok());
        assert_eq!(
            child.kill_calls, 2,
            "already-exited child must not be killed again"
        );
        let mut racing = TerminationFixture {
            running: true,
            refuse_kill: true,
            exit_during_kill: true,
            kill_calls: 0,
        };
        assert!(terminate_child(8, &mut racing).is_ok());
    }

    #[test]
    fn failed_kill_keeps_registered_session_and_successful_retry_removes_it() {
        // Allocate only a PTY handle, not a process. Fault-inject the child
        // handle so the production async endpoint sees a deterministic kill
        // refusal, then a successful retry, against the real session registry.
        let pair = native_pty_system().openpty(PtySize::default()).unwrap();
        let portable_pty::PtyPair { master, slave } = pair;
        drop(slave);
        let id = register_fixture_session(
            master,
            Box::new(std::io::sink()),
            Box::new(TerminationFixture {
                running: true,
                refuse_kill: true,
                exit_during_kill: false,
                kill_calls: 0,
            }),
        );
        let error = tauri::async_runtime::block_on(term_kill(id)).unwrap_err();
        assert!(error.contains("retained for retry"));
        let session = get_session(id).expect("failed kill removed a live session");
        session
            .child
            .lock()
            .unwrap()
            .as_mut()
            .as_any_mut()
            .downcast_mut::<TerminationFixture>()
            .unwrap()
            .refuse_kill = false;
        tauri::async_runtime::block_on(term_kill(id)).unwrap();
        assert!(get_session(id).is_err());
        tauri::async_runtime::block_on(term_kill(id)).unwrap();
    }

    #[test]
    fn interrupt_does_not_queue_behind_busy_input_or_hide_write_errors() {
        let writer: Mutex<Box<dyn Write + Send>> = Mutex::new(Box::new(std::io::sink()));
        let guard = writer.lock().unwrap();
        let started = std::time::Instant::now();
        assert!(interrupt_writer(4, &writer)
            .unwrap_err()
            .contains("input busy"));
        assert!(started.elapsed() < Duration::from_millis(100));
        drop(guard);
        assert!(interrupt_writer(4, &writer).is_ok());
        struct FailedWriter;
        impl Write for FailedWriter {
            fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
                Err(std::io::ErrorKind::BrokenPipe.into())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let writer: Mutex<Box<dyn Write + Send>> = Mutex::new(Box::new(FailedWriter));
        assert!(interrupt_writer(4, &writer)
            .unwrap_err()
            .contains("session status unchanged"));
    }

    #[test]
    fn blocked_interrupt_times_out_and_delayed_write_stays_with_old_session() {
        struct RecordingWriter {
            unblock: Option<std::sync::mpsc::Receiver<()>>,
            bytes: Arc<Mutex<Vec<u8>>>,
        }
        impl Write for RecordingWriter {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                if let Some(unblock) = self.unblock.take() {
                    unblock.recv().map_err(|_| std::io::ErrorKind::BrokenPipe)?;
                }
                self.bytes.lock().unwrap().extend_from_slice(bytes);
                Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let attach = |writer: RecordingWriter| {
            let pair = native_pty_system().openpty(PtySize::default()).unwrap();
            let portable_pty::PtyPair { master, slave } = pair;
            drop(slave);
            register_fixture_session(
                master,
                Box::new(writer),
                Box::new(TerminationFixture {
                    running: false,
                    refuse_kill: false,
                    exit_during_kill: false,
                    kill_calls: 0,
                }),
            )
        };
        let (release, blocked) = std::sync::mpsc::channel();
        let old_bytes = Arc::new(Mutex::new(Vec::new()));
        let old = attach(RecordingWriter {
            unblock: Some(blocked),
            bytes: old_bytes.clone(),
        });
        let started = std::time::Instant::now();
        let error = tauri::async_runtime::block_on(term_interrupt(old)).unwrap_err();
        assert!(error.contains("background write may still be pending"));
        assert!(started.elapsed() < Duration::from_secs(5));
        assert!(
            get_session(old).is_ok(),
            "an input timeout must not mark the session closed"
        );
        tauri::async_runtime::block_on(term_kill(old)).unwrap();
        let new_bytes = Arc::new(Mutex::new(Vec::new()));
        let new = attach(RecordingWriter {
            unblock: None,
            bytes: new_bytes.clone(),
        });
        assert_ne!(old, new);
        release.send(()).unwrap();
        for _ in 0..100 {
            if !old_bytes.lock().unwrap().is_empty() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(&*old_bytes.lock().unwrap(), b"\x03");
        assert!(
            new_bytes.lock().unwrap().is_empty(),
            "delayed interrupt reached replacement session"
        );
        tauri::async_runtime::block_on(term_interrupt(new)).unwrap();
        assert_eq!(&*new_bytes.lock().unwrap(), b"\x03");
        tauri::async_runtime::block_on(term_kill(new)).unwrap();
    }

    #[test]
    fn split_unicode_and_invalid_bytes_do_not_delay_trailing_output() {
        let bytes = "中文😀\x1b[6n".as_bytes();
        for split in 0..=bytes.len() {
            let mut pending = bytes[..split].to_vec();
            let mut result = decode_output(&mut pending);
            pending.extend_from_slice(&bytes[split..]);
            result.push_str(&decode_output(&mut pending));
            assert_eq!(result, "中文😀\x1b[6n");
            assert!(pending.is_empty());
        }
        let mut pending = b"a\xffb\x1b[6n".to_vec();
        assert_eq!(decode_output(&mut pending), "a\u{fffd}b\x1b[6n");
        assert!(pending.is_empty());
    }
    #[test]
    fn terminal_dimensions_fit_windows_coord() {
        assert!(validate_size(120, 30).is_ok());
        for (cols, rows) in [(0, 30), (80, 0), (u16::MAX, 30)] {
            assert!(validate_size(cols, rows).is_err());
        }
    }
}
