use crate::{Child, ChildKiller, ExitStatus};
use anyhow::Context as _;
use std::io::{Error as IoError, Result as IoResult};
use std::os::windows::io::{AsRawHandle, RawHandle};
use std::pin::Pin;
use std::sync::Mutex;
use std::task::{Context, Poll};
use winapi::shared::minwindef::DWORD;
use winapi::shared::winerror::WAIT_TIMEOUT;
use winapi::um::processthreadsapi::*;
use winapi::um::synchapi::WaitForSingleObject;
use winapi::um::winbase::{INFINITE, WAIT_OBJECT_0};

pub mod conpty;
mod procthreadattr;
mod psuedocon;
mod winpty;

use filedescriptor::OwnedHandle;

#[derive(Debug)]
pub struct WinChild {
    proc: Mutex<OwnedHandle>,
}

impl WinChild {
    fn wait_status(&mut self, timeout: DWORD) -> IoResult<Option<ExitStatus>> {
        let proc = self.proc.get_mut().unwrap().as_raw_handle() as _;
        // A process that exited with code 259 has the same exit code as a
        // running process. Only the process handle tells us which one it is.
        match unsafe { WaitForSingleObject(proc, timeout) } {
            WAIT_TIMEOUT => return Ok(None),
            WAIT_OBJECT_0 => (),
            _ => return Err(IoError::last_os_error()),
        }
        let mut status: DWORD = 0;
        if unsafe { GetExitCodeProcess(proc, &mut status) } == 0 {
            return Err(IoError::last_os_error());
        }
        Ok(Some(ExitStatus::with_exit_code(status)))
    }
}

fn terminate(proc: &OwnedHandle) -> IoResult<()> {
    if unsafe { TerminateProcess(proc.as_raw_handle() as _, 1) } == 0 {
        return Err(IoError::last_os_error());
    }
    Ok(())
}

impl ChildKiller for WinChild {
    fn kill(&mut self) -> IoResult<()> {
        terminate(self.proc.get_mut().unwrap())
    }

    fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
        let proc = self.proc.lock().unwrap().try_clone().unwrap();
        Box::new(WinChildKiller { proc })
    }
}

#[derive(Debug)]
pub struct WinChildKiller {
    proc: OwnedHandle,
}

impl ChildKiller for WinChildKiller {
    fn kill(&mut self) -> IoResult<()> {
        terminate(&self.proc)
    }

    fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
        let proc = self.proc.try_clone().unwrap();
        Box::new(WinChildKiller { proc })
    }
}

impl Child for WinChild {
    fn try_wait(&mut self) -> IoResult<Option<ExitStatus>> {
        self.wait_status(0)
    }

    fn wait(&mut self) -> IoResult<ExitStatus> {
        self.wait_status(INFINITE)?
            .ok_or_else(|| IoError::new(std::io::ErrorKind::TimedOut, "process wait timed out"))
    }

    fn process_id(&self) -> Option<u32> {
        let res = unsafe { GetProcessId(self.proc.lock().unwrap().as_raw_handle() as _) };
        if res == 0 {
            None
        } else {
            Some(res)
        }
    }

    fn as_raw_handle(&self) -> Option<RawHandle> {
        let proc = self.proc.lock().unwrap();
        Some(proc.as_raw_handle())
    }
}

impl std::future::Future for WinChild {
    type Output = anyhow::Result<ExitStatus>;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context) -> Poll<anyhow::Result<ExitStatus>> {
        match self.wait_status(0) {
            Ok(Some(status)) => Poll::Ready(Ok(status)),
            Err(err) => Poll::Ready(Err(err).context("Failed to retrieve process exit status")),
            Ok(None) => {
                let proc = self.proc.lock().unwrap().try_clone()?;

                let waker = cx.waker().clone();
                std::thread::spawn(move || {
                    unsafe {
                        WaitForSingleObject(proc.as_raw_handle() as _, INFINITE);
                    }
                    waker.wake();
                });
                Poll::Pending
            }
        }
    }
}
