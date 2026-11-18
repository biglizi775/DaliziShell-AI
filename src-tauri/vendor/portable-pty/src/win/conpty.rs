use crate::cmdbuilder::CommandBuilder;
use crate::win::psuedocon::PsuedoCon;
use crate::win::winpty::WinPty;
use crate::{Child, MasterPty, PtyPair, PtySize, PtySystem, SlavePty};
use anyhow::Error;
use filedescriptor::{FileDescriptor, Pipe};
use std::path::Path;
use std::sync::{Arc, Mutex};
use winapi::um::wincon::COORD;

#[derive(Default)]
pub struct ConPtySystem {}

impl PtySystem for ConPtySystem {
    fn openpty(&self, size: PtySize) -> anyhow::Result<PtyPair> {
        let stdin = Pipe::new()?;
        let stdout = Pipe::new()?;

        let con = PsuedoCon::new(
            COORD {
                X: size.cols as i16,
                Y: size.rows as i16,
            },
            stdin.read,
            stdout.write,
        )?;

        Ok(pair(Console::Native(con), stdout.read, stdin.write, size))
    }
}

/// Start a legacy Windows console using the supplied WinPTY distribution.
pub fn open_winpty(path: &Path, size: PtySize) -> anyhow::Result<PtyPair> {
    let (con, reader, writer) = WinPty::open(path, size)?;
    Ok(pair(Console::Legacy(con), reader, writer, size))
}

enum Console {
    Native(PsuedoCon),
    Legacy(WinPty),
}

fn pair(
    con: Console,
    readable: FileDescriptor,
    writable: FileDescriptor,
    size: PtySize,
) -> PtyPair {
    let master = ConPtyMasterPty {
        inner: Arc::new(Mutex::new(Inner {
            con,
            readable,
            writable: Some(writable),
            size,
        })),
    };

    let slave = ConPtySlavePty {
        inner: master.inner.clone(),
    };

    PtyPair {
        master: Box::new(master),
        slave: Box::new(slave),
    }
}

struct Inner {
    con: Console,
    readable: FileDescriptor,
    writable: Option<FileDescriptor>,
    size: PtySize,
}

impl Inner {
    pub fn resize(
        &mut self,
        num_rows: u16,
        num_cols: u16,
        pixel_width: u16,
        pixel_height: u16,
    ) -> Result<(), Error> {
        let dimensions = COORD {
            X: num_cols as i16,
            Y: num_rows as i16,
        };
        match &self.con {
            Console::Native(con) => con.resize(dimensions)?,
            Console::Legacy(con) => con.resize(dimensions)?,
        }
        self.size = PtySize {
            rows: num_rows,
            cols: num_cols,
            pixel_width,
            pixel_height,
        };
        Ok(())
    }
}

#[derive(Clone)]
pub struct ConPtyMasterPty {
    inner: Arc<Mutex<Inner>>,
}

pub struct ConPtySlavePty {
    inner: Arc<Mutex<Inner>>,
}

impl MasterPty for ConPtyMasterPty {
    fn resize(&self, size: PtySize) -> anyhow::Result<()> {
        let mut inner = self.inner.lock().unwrap();
        inner.resize(size.rows, size.cols, size.pixel_width, size.pixel_height)
    }

    fn get_size(&self) -> Result<PtySize, Error> {
        let inner = self.inner.lock().unwrap();
        Ok(inner.size.clone())
    }

    fn try_clone_reader(&self) -> anyhow::Result<Box<dyn std::io::Read + Send>> {
        Ok(Box::new(self.inner.lock().unwrap().readable.try_clone()?))
    }

    fn take_writer(&self) -> anyhow::Result<Box<dyn std::io::Write + Send>> {
        Ok(Box::new(
            self.inner
                .lock()
                .unwrap()
                .writable
                .take()
                .ok_or_else(|| anyhow::anyhow!("writer already taken"))?,
        ))
    }
}

impl SlavePty for ConPtySlavePty {
    fn spawn_command(&self, cmd: CommandBuilder) -> anyhow::Result<Box<dyn Child + Send + Sync>> {
        let inner = self.inner.lock().unwrap();
        let child = match &inner.con {
            Console::Native(con) => con.spawn_command(cmd)?,
            Console::Legacy(con) => con.spawn_command(cmd)?,
        };
        Ok(Box::new(child))
    }
}
