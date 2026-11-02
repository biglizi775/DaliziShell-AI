// Two concurrent ConPTY shells; no profiles or user files modified.
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

fn check(number: u8) -> Result<(), String> {
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 25,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    let shell = if std::path::Path::new(r"C:\Program Files\PowerShell\7\pwsh.exe").exists() {
        r"C:\Program Files\PowerShell\7\pwsh.exe"
    } else {
        "powershell.exe"
    };
    let mut cmd = CommandBuilder::new(shell);
    cmd.arg("-NoLogo");
    cmd.arg("-NoProfile");
    let portable_pty::PtyPair { master, slave } = pair;
    let mut reader = master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = Arc::new(Mutex::new(master.take_writer().map_err(|e| e.to_string())?));
    let mut child = slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(slave);
    let (tx, rx) = mpsc::channel();
    let input = writer.clone();
    std::thread::spawn(move || {
        let mut tail = String::new();
        let mut buf = [0; 4096];
        loop {
            let n = match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            let text = String::from_utf8_lossy(&buf[..n]);
            tail.push_str(&text);
            while let Some(pos) = tail.find("\x1b[6n") {
                let mut w = input.lock().unwrap();
                let _ = w.write_all(b"\x1b[1;1R");
                let _ = w.flush();
                tail.drain(..pos + 4);
            }
            if tail.len() > 256 {
                tail = tail
                    .chars()
                    .rev()
                    .take(8)
                    .collect::<String>()
                    .chars()
                    .rev()
                    .collect();
            }
            if tx.send(text.into_owned()).is_err() {
                break;
            }
        }
    });
    // The marker only appears in executed output, not in the echoed command.
    let marker = format!("DALIZI-PTY-{number}-OK");
    let result = (|| {
        master
            .resize(PtySize {
                rows: 30,
                cols: 100,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
        let command = format!("[Console]::WriteLine(('DALIZI-' + 'PTY-{number}-OK'))\r");
        writer
            .lock()
            .unwrap()
            .write_all(command.as_bytes())
            .map_err(|e| e.to_string())?;
        writer.lock().unwrap().flush().map_err(|e| e.to_string())?;
        let deadline = Instant::now() + Duration::from_secs(20);
        let mut output = String::new();
        while Instant::now() < deadline {
            if let Ok(chunk) = rx.recv_timeout(Duration::from_millis(250)) {
                output.push_str(&chunk);
                if output.contains(&marker) {
                    return Ok(());
                }
            }
        }
        Err(format!(
            "terminal {number}: timed out waiting for command output"
        ))
    })();
    let _ = child.kill();
    drop(writer);
    drop(master);
    result
}

fn main() {
    let jobs: Vec<_> = (1..=2)
        .map(|n| std::thread::spawn(move || check(n)))
        .collect();
    let mut failed = false;
    for (i, job) in jobs.into_iter().enumerate() {
        match job.join().unwrap() {
            Ok(()) => println!(
                "terminal {}: startup, handshake, resize and command output OK",
                i + 1
            ),
            Err(e) => {
                eprintln!("{e}");
                failed = true;
            }
        }
    }
    if failed {
        std::process::exit(1);
    }
}
