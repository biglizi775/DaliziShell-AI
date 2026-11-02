// ConPTY smoke test via the portable-pty crate (reference implementation).
// Run: cargo run --bin ptytest

use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};

fn main() {
    let marker = "PTYPORTABLE-OK";
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 25,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("openpty failed");

    // Test PowerShell 7 first (what the app actually launches), fall back to 5.1.
    let shell = if std::path::Path::new(r"C:\Program Files\PowerShell\7\pwsh.exe").exists() {
        r"C:\Program Files\PowerShell\7\pwsh.exe"
    } else {
        "powershell.exe"
    };
    println!("testing shell: {shell}");
    let mut cmd = CommandBuilder::new(shell);
    cmd.arg("-NoLogo");
    let portable_pty::PtyPair { master, slave } = pair;
    let mut _child = slave.spawn_command(cmd).expect("spawn failed");
    drop(slave);

    let mut reader = master.try_clone_reader().expect("clone reader failed");
    let collected: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    let col2 = collected.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => col2
                    .lock()
                    .unwrap()
                    .push_str(&String::from_utf8_lossy(&buf[..n])),
            }
        }
    });

    std::thread::sleep(std::time::Duration::from_millis(2500));
    println!("boot: {} bytes", collected.lock().unwrap().len());

    let mut writer = master.take_writer().expect("take writer failed");

    // Emulate what a real terminal (xterm.js) does: answer the DSR cursor
    // position request so conhost's startup handshake can complete.
    if collected.lock().unwrap().contains("\x1b[6n") {
        writer.write_all(b"\x1b[1;1R").expect("DSR reply failed");
        writer.flush().ok();
        println!("answered ESC[6n with ESC[1;1R");
        std::thread::sleep(std::time::Duration::from_millis(500));
    }

    writer
        .write_all(format!("echo {marker}\r").as_bytes())
        .expect("write input failed");
    writer.flush().ok();
    println!("wrote command, waiting for echo...");

    for _ in 0..20 {
        std::thread::sleep(std::time::Duration::from_millis(250));
        if collected.lock().unwrap().contains(marker) {
            println!("RESULT: INPUT WORKS");
            let _ = _child.kill();
            return;
        }
    }
    println!("RESULT: INPUT FAILED");
    let s = collected.lock().unwrap().clone();
    println!(
        "tail: {}",
        s.replace('\x1b', "<ESC>")
            .chars()
            .rev()
            .take(400)
            .collect::<String>()
            .chars()
            .rev()
            .collect::<String>()
    );
    let _ = _child.kill();
}
