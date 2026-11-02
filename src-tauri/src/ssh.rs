//! OpenSSH runs directly in ConPTY. Credentials remain in its terminal stream;
//! no password, host fingerprint, or private key contents are stored here.
use portable_pty::CommandBuilder;
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::AppHandle;

const FRAME_LIMIT: usize = 16 * 1024;
const FIELD_LIMIT: usize = 1024;

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum InfoMode {
    #[default]
    Posix,
    Windows,
    Shell,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub identity_file: Option<String>,
    #[serde(default)]
    pub info_mode: InfoMode,
}
#[derive(Serialize)]
pub struct ClientInfo {
    pub available: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub hostname: String,
    pub os: String,
    pub kernel: String,
    pub arch: String,
    pub user: String,
    pub uptime: String,
    pub server_ip: String,
}
#[derive(Serialize, Clone)]
pub struct InfoEvent {
    pub id: u32,
    pub key: String,
    pub info: ServerInfo,
}

fn find_client() -> Option<PathBuf> {
    let windows = std::env::var_os("SystemRoot").unwrap_or_else(|| r"C:\Windows".into());
    let windows = Path::new(&windows);
    for folder in ["System32", "Sysnative"] {
        let path = windows.join(folder).join("OpenSSH").join("ssh.exe");
        if path.is_file() {
            return Some(path);
        }
    }
    std::env::var_os("PATH").and_then(|path| {
        std::env::split_paths(&path)
            .filter(|dir| dir.is_absolute())
            .map(|dir| dir.join("ssh.exe"))
            .find(|path| path.is_file())
    })
}

fn check_client() -> ClientInfo {
    use std::os::windows::process::CommandExt;
    let Some(path) = find_client() else {
        return ClientInfo {
            available: false,
            path: None,
            version: None,
        };
    };
    let mut result = ClientInfo {
        available: false,
        path: Some(path.to_string_lossy().into_owned()),
        version: None,
    };
    let Ok(mut child) = Command::new(&path)
        .arg("-V")
        .creation_flags(0x08000000)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    else {
        return result;
    };
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut bytes = Vec::new();
                if let Some(stderr) = child.stderr.take() {
                    let _ = stderr.take(2048).read_to_end(&mut bytes);
                }
                if let Some(stdout) = child.stdout.take() {
                    let _ = stdout.take(2048).read_to_end(&mut bytes);
                }
                let version = safe_text(&bytes);
                result.available = status.success() && version.contains("OpenSSH");
                if !version.is_empty() {
                    result.version = Some(version);
                }
                return result;
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(40)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return result;
            }
        }
    }
}

#[tauri::command]
pub async fn ssh_check_client() -> Result<ClientInfo, String> {
    tauri::async_runtime::spawn_blocking(check_client)
        .await
        .map_err(|e| e.to_string())
}

pub(crate) fn validate_config(config: &SshConfig) -> Result<(String, Option<PathBuf>), String> {
    if config.host.chars().any(char::is_control) {
        return Err("主机地址不能包含控制字符 / Invalid SSH host".into());
    }
    let raw = config.host.trim();
    let host = if raw.starts_with('[') && raw.ends_with(']') {
        &raw[1..raw.len() - 1]
    } else {
        raw
    };
    let ip = host.parse::<std::net::IpAddr>().is_ok();
    let domain = !host.is_empty()
        && host.len() <= 253
        && host.trim_end_matches('.').split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && label
                    .as_bytes()
                    .first()
                    .is_some_and(u8::is_ascii_alphanumeric)
                && label
                    .as_bytes()
                    .last()
                    .is_some_and(u8::is_ascii_alphanumeric)
                && label
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-')
        });
    if (!ip && !domain) || raw.starts_with('[') && host.parse::<std::net::Ipv6Addr>().is_err() {
        return Err("请输入域名、IPv4 或 IPv6 地址 / Invalid SSH host".into());
    }
    if config.port == 0 {
        return Err("SSH 端口必须在 1–65535 之间 / Invalid SSH port".into());
    }
    let user = config.user.as_bytes();
    if user.is_empty()
        || user.len() > 64
        || !user[0].is_ascii_alphanumeric() && user[0] != b'_'
        || !user
            .iter()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-' | b'.'))
    {
        return Err("用户名只能包含字母、数字、点、短横线或下划线 / Invalid SSH login name".into());
    }
    let identity = match config
        .identity_file
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        None => None,
        Some(raw) => {
            let bytes = raw.as_bytes();
            if raw.chars().any(char::is_control)
                || raw.contains('%')
                || raw.contains('"')
                || bytes.len() < 3
                || !bytes[0].is_ascii_alphabetic()
                || bytes[1] != b':'
                || !matches!(bytes[2], b'\\' | b'/')
                || raw[2..].contains(':')
            {
                return Err("密钥文件路径包含不支持的字符 / Invalid identity path".into());
            }
            let path = PathBuf::from(raw);
            if !path.is_absolute() || !path.is_file() {
                return Err(
                    "请选择存在的密钥文件完整路径 / Identity must be an existing file".into(),
                );
            }
            let metadata = std::fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
            use std::os::windows::fs::MetadataExt;
            if !metadata.is_file() || metadata.file_attributes() & 0x400 != 0 {
                return Err("密钥必须是普通文件 / Identity must be a regular file".into());
            }
            Some(path)
        }
    };
    Ok((host.into(), identity))
}

fn bootstrap_script(nonce: &str) -> String {
    // Information commands are fixed and read-only; only temporary TTY flags
    // change for the bounded acknowledgement. /etc/os-release is read as text,
    // never sourced. Only our generated hex nonce is substituted.
    r#"dlz_tty=$(stty -g 2>/dev/null)
if [ -z "$dlz_tty" ] || ! stty -echo -icanon min 0 time 100 2>/dev/null; then
  printf '\r\nDalizi: remote information requires a POSIX terminal; retry in compatible shell mode.\r\n'
  exit 1
fi
trap 'stty "$dlz_tty" 2>/dev/null' 0
trap 'exit 130' 1 2 15
dlz_hex() { LC_ALL=C head -c 1024 | od -An -v -tx1 | tr -d ' \n\r'; }
printf '\033]2;DLZ-@NONCE@-BEGIN'
(hostname 2>/dev/null || uname -n 2>/dev/null) | dlz_hex; printf ';'
(if [ -r /etc/os-release ]; then sed -n 's/^PRETTY_NAME=//p' /etc/os-release; elif command -v sw_vers >/dev/null 2>&1; then sw_vers -productName; sw_vers -productVersion; else uname -s; fi) 2>/dev/null | dlz_hex; printf ';'
uname -r 2>/dev/null | dlz_hex; printf ';'
uname -m 2>/dev/null | dlz_hex; printf ';'
id -un 2>/dev/null | dlz_hex; printf ';'
uptime 2>/dev/null | dlz_hex; printf ';'
printf '%s\n' "$SSH_CONNECTION" | awk '{print $3}' | dlz_hex
printf 'DLZ-@NONCE@-END\007'
dlz_ok=0
while IFS= read -r dlz_ack; do
  if [ "$dlz_ack" = 'DLZ-@NONCE@-ACK' ]; then dlz_ok=1; break; fi
done
stty "$dlz_tty" 2>/dev/null
trap - 0 1 2 15
if [ "$dlz_ok" != 1 ]; then
  printf '\r\nDalizi: remote information handshake timed out; retry in compatible shell mode.\r\n'
  exit 1
fi
unset dlz_tty dlz_ack dlz_ok
exec "${SHELL:-/bin/sh}" -l"#.replace("@NONCE@", nonce)
}
fn bootstrap(nonce: &str) -> String {
    format!("sh -c '{}'", bootstrap_script(nonce).replace('\'', "'\\''"))
}

fn build_command(path: &Path, config: &SshConfig, nonce: &str) -> Result<CommandBuilder, String> {
    if nonce.len() != 32 || !nonce.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err("Invalid SSH session nonce".into());
    }
    let (host, identity) = validate_config(config)?;
    let mut command = CommandBuilder::new(path);
    // Explicit config only: avoid inherited ProxyCommand/LocalCommand/Match
    // exec and other hidden local processes. Native known_hosts still applies.
    command.args([
        "-F",
        "none",
        "-tt",
        "-o",
        "StrictHostKeyChecking=ask",
        "-o",
        "PermitLocalCommand=no",
        "-o",
        "ClearAllForwardings=yes",
        "-o",
        "ForwardAgent=no",
        "-o",
        "ForwardX11=no",
        "-o",
        "ConnectTimeout=15",
        "-o",
        "ServerAliveInterval=30",
        "-o",
        "ServerAliveCountMax=3",
    ]);
    command.args(["-p", &config.port.to_string(), "-l", &config.user]);
    if let Some(identity) = identity {
        command.arg("-i");
        command.arg(identity);
        command.args(["-o", "IdentitiesOnly=yes"]);
    }
    command.arg("--");
    command.arg(host);
    if config.info_mode == InfoMode::Posix {
        command.arg(bootstrap(nonce));
    }
    command.env("TERM", "xterm-256color");
    // Keep password/passphrase prompts attached to the existing terminal.
    command.env("SSH_ASKPASS_REQUIRE", "never");
    command.env_remove("SSH_ASKPASS");
    Ok(command)
}

#[tauri::command]
pub async fn ssh_start(
    key: String,
    config: SshConfig,
    cols: u16,
    rows: u16,
    app: AppHandle,
) -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if key.is_empty() || key.len() > 200 || key.chars().any(char::is_control) {
            return Err("Invalid SSH session key".into());
        }
        let path = find_client().ok_or(
            "未找到 OpenSSH，请在 Windows 可选功能中安装 OpenSSH 客户端 / OpenSSH client not found",
        )?;
        let guid =
            unsafe { windows::Win32::System::Com::CoCreateGuid() }.map_err(|e| e.to_string())?;
        let nonce = format!("{guid:?}")
            .replace('-', "")
            .replace(['{', '}'], "")
            .to_lowercase();
        let command = build_command(&path, &config, &nonce)?;
        let parser = (config.info_mode == InfoMode::Posix).then(|| InfoParser::new(&nonce));
        crate::term::start_command(key, cols, rows, command, app, parser)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// OSC title framing avoids ConPTY's screen buffer and survives tiny windows.
/// ConPTY normalizes OSC 2 to OSC 0, so both are accepted. Ordinary terminal
/// output remains intact, and buffers are bounded. Legacy printable framing
/// is also recognized, including a repeated frame in a ConPTY screen repaint.
pub struct InfoParser {
    begin: Vec<u8>,
    end: Vec<u8>,
    candidate: Vec<u8>,
    matched: usize,
    frame: Option<Vec<u8>>,
    frame_tail: Vec<u8>,
    oversized: bool,
    control: Vec<u8>,
    complete: bool,
    acknowledgement: Vec<u8>,
    discard_control: bool,
}
impl InfoParser {
    pub fn new(nonce: &str) -> Self {
        Self {
            begin: format!("DLZ-{nonce}-BEGIN").into_bytes(),
            end: format!("DLZ-{nonce}-END").into_bytes(),
            candidate: Vec::new(),
            matched: 0,
            frame: None,
            frame_tail: Vec::new(),
            oversized: false,
            control: Vec::new(),
            complete: false,
            acknowledgement: format!("DLZ-{nonce}-ACK\r").into_bytes(),
            discard_control: false,
        }
    }
    pub fn acknowledgement(&self) -> &[u8] {
        &self.acknowledgement
    }
    fn is_protocol_title(&self) -> bool {
        title_content(&self.control).is_some_and(|title| {
            title.starts_with(&self.begin) || title.len() >= 4 && self.begin.starts_with(title)
        })
    }
    pub fn feed(&mut self, bytes: &[u8]) -> (Vec<u8>, Option<ServerInfo>) {
        let mut output = Vec::new();
        let mut info = None;
        for &byte in bytes {
            if !self.control.is_empty() || byte == 0x1b {
                self.control.push(byte);
                if self.discard_control {
                    if byte == 7 || self.control.ends_with(b"\x1b\\") {
                        self.control.clear();
                        self.discard_control = false;
                    } else if self.control.len() > 2 {
                        self.control.drain(..self.control.len() - 2);
                    }
                    continue;
                }
                if control_complete(&self.control) || self.control.len() > FRAME_LIMIT + 128 {
                    if self.is_protocol_title() {
                        if self.control.len() > FRAME_LIMIT + 128 {
                            self.discard_control = !control_complete(&self.control);
                            self.control = if self.discard_control {
                                b"\x1b]".to_vec()
                            } else {
                                Vec::new()
                            };
                            continue;
                        }
                        if !self.complete {
                            if let Some(body) = title_content(&self.control)
                                .and_then(|title| title.strip_prefix(self.begin.as_slice()))
                                .and_then(|body| body.strip_suffix(self.end.as_slice()))
                            {
                                info = parse_info(body);
                                if info.is_some() {
                                    self.complete = true;
                                }
                            }
                        }
                    } else if self.frame.is_some() { /* terminal rendering within the hidden frame */
                    } else if self.matched > 0 {
                        self.candidate.extend_from_slice(&self.control);
                        if self.candidate.len() > FRAME_LIMIT {
                            output.append(&mut self.candidate);
                            self.matched = 0;
                        }
                    } else {
                        output.extend_from_slice(&self.control);
                    }
                    self.control.clear();
                }
                continue;
            }
            if let Some(frame) = self.frame.as_mut() {
                if byte.is_ascii_whitespace() || byte.is_ascii_control() {
                    continue;
                }
                if frame.len() < FRAME_LIMIT {
                    frame.push(byte);
                } else {
                    self.oversized = true;
                }
                self.frame_tail.push(byte);
                if self.frame_tail.len() > self.end.len() {
                    self.frame_tail.remove(0);
                }
                if self.frame_tail == self.end {
                    if !self.oversized && !self.complete {
                        frame.truncate(frame.len().saturating_sub(self.end.len()));
                        info = parse_info(frame);
                    }
                    self.frame = None;
                    self.frame_tail.clear();
                    self.oversized = false;
                    if info.is_some() {
                        self.complete = true;
                    }
                }
                continue;
            }
            if self.matched > 0 && byte.is_ascii_whitespace() {
                self.candidate.push(byte);
            } else if byte == self.begin[self.matched] {
                self.candidate.push(byte);
                self.matched += 1;
                if self.matched == self.begin.len() {
                    self.candidate.clear();
                    self.matched = 0;
                    self.frame = Some(Vec::new());
                }
            } else {
                output.append(&mut self.candidate);
                self.matched = 0;
                if byte == self.begin[0] {
                    self.candidate.push(byte);
                    self.matched = 1;
                } else {
                    output.push(byte);
                }
            }
            if self.candidate.len() > FRAME_LIMIT {
                output.append(&mut self.candidate);
                self.matched = 0;
            }
        }
        (output, info)
    }
    pub fn finish(&mut self) -> Vec<u8> {
        if self.frame.is_some()
            || self.matched >= 4
            || self.is_protocol_title()
            || self.discard_control
        {
            self.candidate.clear();
            self.control.clear();
            return Vec::new();
        }
        let mut out = std::mem::take(&mut self.candidate);
        out.append(&mut self.control);
        out
    }
}

fn title_content(control: &[u8]) -> Option<&[u8]> {
    let title = control
        .strip_prefix(b"\x1b]0;")
        .or_else(|| control.strip_prefix(b"\x1b]2;"))?;
    Some(
        title
            .strip_suffix(b"\x07")
            .or_else(|| title.strip_suffix(b"\x1b\\"))
            .unwrap_or(title),
    )
}

fn control_complete(bytes: &[u8]) -> bool {
    if bytes.len() < 2 {
        return false;
    }
    match bytes[1] {
        b'[' => bytes.len() >= 3 && (0x40..=0x7e).contains(bytes.last().unwrap()),
        b']' | b'P' | b'^' | b'_' => bytes.last() == Some(&7) || bytes.ends_with(b"\x1b\\"),
        _ => true,
    }
}
fn safe_text(bytes: &[u8]) -> String {
    let mut clean = Vec::new();
    let mut control = Vec::new();
    for &byte in bytes {
        if !control.is_empty() || byte == 0x1b {
            control.push(byte);
            if control_complete(&control) || control.len() >= 4096 {
                control.clear();
            }
        } else if byte == b'\r' || byte == b'\n' || byte == b'\t' {
            clean.push(b' ');
        } else if !byte.is_ascii_control() {
            clean.push(byte);
        }
    }
    String::from_utf8_lossy(&clean)
        .chars()
        .filter(|c| {
            !c.is_control() && !matches!(*c, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(512)
        .collect()
}
fn parse_info(bytes: &[u8]) -> Option<ServerInfo> {
    let parts: Vec<_> = bytes.split(|c| *c == b';').collect();
    if parts.len() != 7 {
        return None;
    }
    let mut values = Vec::new();
    for part in parts {
        if part.len() % 2 != 0 || part.len() > FIELD_LIMIT * 2 {
            return None;
        }
        let mut decoded = Vec::new();
        for pair in part.chunks_exact(2) {
            let high = (pair[0] as char).to_digit(16)?;
            let low = (pair[1] as char).to_digit(16)?;
            decoded.push((high * 16 + low) as u8);
        }
        values.push(safe_text(&decoded));
    }
    Some(ServerInfo {
        hostname: values[0].clone(),
        os: values[1].trim_matches('"').to_owned(),
        kernel: values[2].clone(),
        arch: values[3].clone(),
        user: values[4].clone(),
        uptime: values[5].clone(),
        server_ip: values[6].clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    const NONCE: &str = "0123456789abcdef0123456789abcdef";
    fn config() -> SshConfig {
        SshConfig {
            host: "server.example".into(),
            port: 2222,
            user: "fixture_user".into(),
            identity_file: None,
            info_mode: InfoMode::Posix,
        }
    }
    fn frame(fields: &[&str]) -> Vec<u8> {
        let encoded = fields
            .iter()
            .map(|v| {
                v.as_bytes()
                    .iter()
                    .map(|b| format!("{b:02x}"))
                    .collect::<String>()
            })
            .collect::<Vec<_>>()
            .join(";");
        format!("DLZ-{NONCE}-BEGIN{encoded}DLZ-{NONCE}-END").into_bytes()
    }
    #[test]
    fn ssh_arguments_are_separate_explicit_and_reject_injection() {
        let base = config();
        let command = build_command(
            Path::new(r"C:\Windows\System32\OpenSSH\ssh.exe"),
            &base,
            NONCE,
        )
        .unwrap();
        let argv: Vec<_> = command
            .get_argv()
            .iter()
            .map(|s| s.to_string_lossy().into_owned())
            .collect();
        assert!(argv.windows(2).any(|a| a == ["-F", "none"]));
        assert!(argv
            .windows(2)
            .any(|a| a == ["-o", "StrictHostKeyChecking=ask"]));
        assert!(argv.windows(2).any(|a| a == ["-p", "2222"]));
        assert!(argv.windows(2).any(|a| a == ["-l", "fixture_user"]));
        assert_eq!(argv[argv.len() - 2], "server.example");
        assert_eq!(argv.last().unwrap(), &bootstrap(NONCE));
        assert!(!bootstrap(NONCE).contains("server.example"));
        for host in [
            "-oProxyCommand=calc.exe",
            "host;whoami",
            "a b",
            "user@host",
            "host\n",
            "ssh://host",
            "[example.com]",
            "a..b",
            "-host",
        ] {
            let mut bad = base.clone();
            bad.host = host.into();
            assert!(validate_config(&bad).is_err(), "accepted {host:?}");
        }
        for host in [
            "localhost",
            "example.com",
            "127.0.0.1",
            "::1",
            "[2001:db8::1]",
        ] {
            let mut good = base.clone();
            good.host = host.into();
            assert!(validate_config(&good).is_ok(), "rejected {host:?}");
        }
        for user in ["-root", "root;id", "root\n", "a b", "a@b", "$(id)", ""] {
            let mut bad = base.clone();
            bad.user = user.into();
            assert!(validate_config(&bad).is_err());
        }
        let mut shell = base.clone();
        shell.info_mode = InfoMode::Shell;
        assert_eq!(
            build_command(Path::new("ssh.exe"), &shell, NONCE)
                .unwrap()
                .get_argv()
                .last()
                .unwrap(),
            "server.example"
        );
        shell.port = 0;
        assert!(validate_config(&shell).is_err());
        assert!(build_command(Path::new("ssh.exe"), &base, "nonce';id").is_err());
        let guid = unsafe { windows::Win32::System::Com::CoCreateGuid() }.unwrap();
        let nonce = format!("{guid:?}")
            .replace('-', "")
            .replace(['{', '}'], "")
            .to_lowercase();
        assert!(build_command(Path::new("ssh.exe"), &base, &nonce).is_ok());
    }
    #[test]
    fn identity_is_validated_without_reading_key_contents() {
        let dir = std::env::temp_dir().join(format!("dalizi-ssh-key-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("key with spaces");
        std::fs::write(&path, b"fixture, not a private key").unwrap();
        let mut cfg = config();
        cfg.identity_file = Some(path.to_string_lossy().into_owned());
        let command = build_command(Path::new("ssh.exe"), &cfg, NONCE).unwrap();
        assert!(command
            .get_argv()
            .windows(2)
            .any(|a| a[0] == "-i" && a[1] == path.as_os_str()));
        assert_eq!(std::fs::read(&path).unwrap(), b"fixture, not a private key");
        for invalid in [
            dir.to_string_lossy().into_owned(),
            "relative-key".into(),
            r"C:\key%h".into(),
            r"C:\key:stream".into(),
        ] {
            cfg.identity_file = Some(invalid);
            assert!(validate_config(&cfg).is_err());
        }
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn fragmented_and_vt_wrapped_info_is_hidden_and_sanitized() {
        let values = [
            "fixture-host",
            "\"Linux\"",
            "6.1",
            "x86_64",
            "tester",
            "up 2 days",
            "127.0.0.1",
        ];
        let protocol = frame(&values);
        for split in 0..=protocol.len() {
            let mut parser = InfoParser::new(NONCE);
            let (first, info1) = parser.feed(&protocol[..split]);
            let (second, info2) = parser.feed(&protocol[split..]);
            assert!(first.is_empty() && second.is_empty());
            assert_eq!(info1.or(info2).unwrap().hostname, "fixture-host");
            assert!(parser.finish().is_empty());
            let (repainted, duplicate_info) = parser.feed(&protocol);
            assert!(
                repainted.is_empty() && duplicate_info.is_none(),
                "ConPTY repaint must not reveal a previous frame"
            );
        }
        let mut wrapped = b"banner\r\n\x1b[32m".to_vec();
        for (i, byte) in protocol.iter().enumerate() {
            wrapped.push(*byte);
            if i % 13 == 0 {
                wrapped.extend_from_slice(b"\r\n\x1b[1G");
            }
        }
        wrapped.extend_from_slice(b"\r\nuser$ ");
        let mut parser = InfoParser::new(NONCE);
        let mut visible = Vec::new();
        let mut info = None;
        for byte in wrapped {
            let (out, parsed) = parser.feed(&[byte]);
            visible.extend(out);
            info = info.or(parsed);
        }
        assert_eq!(info.unwrap().os, "Linux");
        let visible = String::from_utf8(visible).unwrap();
        assert!(visible.starts_with("banner\r\n\x1b[32m"));
        assert!(visible.ends_with("user$ "));
        assert!(!visible.contains("DLZ-") && !visible.contains("666978"));
        let mut parser = InfoParser::new(NONCE);
        let (_, info) = parser.feed(&frame(&[
            "hi\x1b[31mred\x1b[0m\n\u{202e}ok",
            "",
            "",
            "",
            "",
            "",
            "",
        ]));
        assert_eq!(info.unwrap().hostname, "hired ok");
    }
    #[test]
    fn malformed_and_oversized_frames_are_bounded_without_false_connection() {
        let start = format!("DLZ-{NONCE}-BEGIN");
        let end = format!("DLZ-{NONCE}-END");
        let mut parser = InfoParser::new(NONCE);
        let malformed = format!("before{start}not-hex{end}after");
        let (out, info) = parser.feed(malformed.as_bytes());
        assert_eq!(out, b"beforeafter");
        assert!(info.is_none());
        let oversized = format!("{start}{}{end}prompt$ ", "a".repeat(FRAME_LIMIT * 3));
        let (out, info) = parser.feed(oversized.as_bytes());
        assert_eq!(out, b"prompt$ ");
        assert!(info.is_none());
        parser.feed(start.as_bytes());
        parser.feed(b"partial-hidden");
        assert!(parser.finish().is_empty());
        let mut parser = InfoParser::new(NONCE);
        parser.feed(format!("DLZ-{}", &NONCE[..12]).as_bytes());
        assert!(parser.finish().is_empty());
        let mut parser = InfoParser::new(NONCE);
        let ordinary = b"Download\r\n\x1b[6nPassword: ";
        let (mut visible, info) = parser.feed(ordinary);
        visible.extend(parser.finish());
        assert_eq!(visible, ordinary);
        assert!(info.is_none());
        assert!(parse_info(&vec![b'a'; FIELD_LIMIT * 2 + 2]).is_none());
    }

    #[test]
    fn osc_titles_survive_fragments_and_do_not_leak_protocol_or_terminal_controls() {
        let protocol = frame(&[
            "fixture",
            "Linux",
            "6.1",
            "x64",
            "fixture",
            "up",
            "127.0.0.1",
        ]);
        for code in [b'0', b'2'] {
            for terminator in [b"\x07".as_slice(), b"\x1b\\".as_slice()] {
                let mut encoded = vec![0x1b, b']', code, b';'];
                encoded.extend_from_slice(&protocol);
                encoded.extend_from_slice(terminator);
                for split in 0..=encoded.len() {
                    let mut parser = InfoParser::new(NONCE);
                    let (first, one) = parser.feed(&encoded[..split]);
                    let (second, two) = parser.feed(&encoded[split..]);
                    assert!(first.is_empty() && second.is_empty());
                    assert_eq!(one.or(two).unwrap().hostname, "fixture");
                    assert_eq!(
                        parser.acknowledgement(),
                        format!("DLZ-{NONCE}-ACK\r").as_bytes()
                    );
                    let normal_title = b"\x1b]0;normal login shell\x07prompt$ ";
                    assert_eq!(parser.feed(normal_title).0, normal_title);
                    assert!(parser.feed(&encoded).1.is_none());
                }
            }
        }
        let header = format!("\x1b]0;DLZ-{NONCE}-BEGIN");
        let mut parser = InfoParser::new(NONCE);
        parser.feed(header.as_bytes());
        for _ in 0..20 {
            assert!(parser.feed(&vec![b'a'; FRAME_LIMIT]).0.is_empty());
            assert!(parser.control.len() <= FRAME_LIMIT + 129);
        }
        let (visible, info) = parser.feed(b"\x07prompt$ ");
        assert_eq!(visible, b"prompt$ ");
        assert!(info.is_none());
        let mut parser = InfoParser::new(NONCE);
        parser.feed(header.as_bytes());
        assert!(parser.finish().is_empty());
    }

    #[test]
    #[ignore = "requires Windows OpenSSH, Git Bash, and local Python paramiko; connects only to its generated loopback fixture"]
    fn real_openssh_conpty_loopback_auth_info_resize_and_exit() {
        use std::io::{BufRead, BufReader};
        use std::os::windows::process::CommandExt;
        use std::sync::mpsc;
        let client = check_client();
        assert!(client.available, "Windows OpenSSH must be installed");
        let bash = Path::new(r"C:\Program Files\Git\bin\bash.exe");
        assert!(
            bash.is_file(),
            "Git Bash is required for bootstrap syntax verification"
        );
        assert!(Command::new(bash)
            .args([
                "--noprofile",
                "--norc",
                "-n",
                "-c",
                &bootstrap_script(NONCE)
            ])
            .env_remove("BASH_ENV")
            .creation_flags(0x08000000)
            .status()
            .unwrap()
            .success());
        let project = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let fixture = Command::new("python")
            .arg(project.join("tools/ssh_fixture.py"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .creation_flags(0x08000000)
            .spawn()
            .unwrap();
        struct Fixture(std::process::Child);
        impl Drop for Fixture {
            fn drop(&mut self) {
                self.0.stdin.take();
                for _ in 0..50 {
                    if self.0.try_wait().ok().flatten().is_some() {
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(40));
                }
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
        let mut fixture = Fixture(fixture);
        let stdout = fixture.0.stdout.take().unwrap();
        let (description_tx, description_rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut line = String::new();
            let result = BufReader::new(stdout).read_line(&mut line).map(|_| line);
            let _ = description_tx.send(result);
        });
        let line = description_rx
            .recv_timeout(Duration::from_secs(25))
            .expect("SSH fixture startup timed out")
            .expect("SSH fixture output");
        let description: serde_json::Value = serde_json::from_str(&line).unwrap();
        let known_hosts = description["knownHosts"].as_str().unwrap();
        let config = SshConfig {
            host: "127.0.0.1".into(),
            port: description["port"].as_u64().unwrap() as u16,
            user: description["user"].as_str().unwrap().into(),
            identity_file: Some(description["identityFile"].as_str().unwrap().into()),
            info_mode: InfoMode::Posix,
        };
        struct Connection {
            id: u32,
            rx: mpsc::Receiver<(Vec<u8>, Option<ServerInfo>)>,
            visible: Vec<u8>,
            info: Option<ServerInfo>,
        }
        impl Connection {
            fn collect_until(
                &mut self,
                predicate: impl Fn(&[u8], &Option<ServerInfo>) -> bool,
            ) -> Result<(), String> {
                let deadline = Instant::now() + Duration::from_secs(15);
                while Instant::now() < deadline {
                    if predicate(&self.visible, &self.info) {
                        return Ok(());
                    }
                    match self.rx.recv_timeout(Duration::from_millis(100)) {
                        Ok((bytes, info)) => {
                            self.visible.extend(bytes);
                            self.info = self.info.take().or(info);
                        }
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                    }
                }
                Err(format!(
                    "SSH fixture timed out or closed; output: {}",
                    safe_text(&self.visible)
                ))
            }
            fn ready(&mut self) -> Result<(), String> {
                self.collect_until(|out, info| {
                    info.is_some() && safe_text(out).contains("FIXTURE READY")
                })
            }
            fn send(&self, input: &str) -> Result<(), String> {
                tauri::async_runtime::block_on(crate::term::term_write(self.id, input.into()))
            }
            fn wait_exit(&self) -> Result<u32, String> {
                let deadline = Instant::now() + Duration::from_secs(10);
                while Instant::now() < deadline {
                    if let Some(code) = crate::term::fixture_session_exit(self.id)? {
                        return Ok(code);
                    }
                    std::thread::sleep(Duration::from_millis(40));
                }
                Err("SSH fixture process did not exit".into())
            }
            fn interrupt(&self) -> Result<(), String> {
                tauri::async_runtime::block_on(crate::term::term_interrupt(self.id))
            }
            fn disconnect(&self) -> Result<(), String> {
                tauri::async_runtime::block_on(crate::term::term_kill(self.id))
            }
        }
        impl Drop for Connection {
            fn drop(&mut self) {
                let _ = self.disconnect();
            }
        }
        let connect = |config: &SshConfig, nonce: &str| -> Connection {
            let mut command =
                build_command(Path::new(client.path.as_ref().unwrap()), config, nonce).unwrap();
            // First value wins. Pin only generated fixture files, disable
            // password fallback and leave the user's real known_hosts alone.
            let overrides = [
                "-o".into(),
                "StrictHostKeyChecking=yes".into(),
                "-o".into(),
                format!("UserKnownHostsFile=\"{}\"", known_hosts.replace('\\', "/")).into(),
                "-o".into(),
                "GlobalKnownHostsFile=none".into(),
                "-o".into(),
                "BatchMode=yes".into(),
                "-o".into(),
                "PreferredAuthentications=publickey".into(),
            ];
            command.get_argv_mut().splice(1..1, overrides);
            let pair = portable_pty::native_pty_system()
                .openpty(portable_pty::PtySize {
                    rows: 3,
                    cols: 20,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .unwrap();
            let portable_pty::PtyPair { master, slave } = pair;
            let mut reader = master.try_clone_reader().unwrap();
            let writer = master.take_writer().unwrap();
            let child = slave.spawn_command(command).unwrap();
            drop(slave);
            let id = crate::term::register_fixture_session(master, writer, child);
            let (tx, rx) = mpsc::channel();
            let nonce = nonce.to_string();
            std::thread::spawn(move || {
                let mut parser = InfoParser::new(&nonce);
                let mut buf = [0; 4096];
                let mut handshake = Vec::new();
                while let Ok(n) = reader.read(&mut buf) {
                    if n == 0 {
                        break;
                    }
                    handshake.extend_from_slice(&buf[..n]);
                    while let Some(index) = handshake.windows(4).position(|s| s == b"\x1b[6n") {
                        let _ = tauri::async_runtime::block_on(crate::term::term_write(
                            id,
                            "\x1b[1;1R".into(),
                        ));
                        handshake.drain(..index + 4);
                    }
                    if handshake.len() > 32 {
                        handshake.drain(..handshake.len() - 3);
                    }
                    let parsed = parser.feed(&buf[..n]);
                    if parsed.1.is_some() {
                        let acknowledgement =
                            String::from_utf8(parser.acknowledgement().to_vec()).unwrap();
                        let _ = tauri::async_runtime::block_on(crate::term::term_write(
                            id,
                            acknowledgement,
                        ));
                    }
                    if tx.send(parsed).is_err() {
                        return;
                    }
                }
                let _ = tx.send((parser.finish(), None));
            });
            Connection {
                id,
                rx,
                visible: Vec::new(),
                info: None,
            }
        };

        // A real OpenSSH authentication failure must not prevent a new login.
        let mut rejected_config = config.clone();
        rejected_config.user = "rejected".into();
        let rejected = connect(&rejected_config, "11111111111111111111111111111111");
        assert_eq!(rejected.wait_exit().unwrap(), 255);
        rejected.disconnect().unwrap();
        rejected.disconnect().unwrap();
        assert!(
            rejected.interrupt().is_err(),
            "closed IDs must reject later input"
        );

        let mut first = connect(&config, NONCE);
        first.ready().unwrap();
        tauri::async_runtime::block_on(crate::term::term_resize(first.id, 110, 40)).unwrap();
        first
            .collect_until(|out, _| safe_text(out).contains("FIXTURE RESIZE 110x40"))
            .unwrap();
        first.send("wait\r").unwrap();
        first
            .collect_until(|out, _| safe_text(out).contains("FIXTURE RUNNING"))
            .unwrap();
        first.interrupt().unwrap();
        first
            .collect_until(|out, _| safe_text(out).contains("FIXTURE INTERRUPTED"))
            .unwrap();
        assert!(
            crate::term::fixture_session_exit(first.id)
                .unwrap()
                .is_none(),
            "Ctrl+C must keep SSH alive"
        );
        first.send("status\r").unwrap();
        first
            .collect_until(|out, _| safe_text(out).contains("FIXTURE STATUS READY"))
            .unwrap();
        first.send("exit\r").unwrap();
        assert_eq!(first.wait_exit().unwrap(), 7);
        assert_eq!(first.info.as_ref().unwrap().hostname, "fixture-host");
        assert!(
            !String::from_utf8_lossy(&first.visible).contains(NONCE),
            "SSH protocol leaked into output"
        );
        first.disconnect().unwrap();

        // Fresh PTYs also recover from a remote transport drop.
        let mut dropped = connect(&config, "22222222222222222222222222222222");
        dropped.ready().unwrap();
        dropped.send("drop\r").unwrap();
        assert_ne!(dropped.wait_exit().unwrap(), 0);
        dropped.disconnect().unwrap();
        let mut reconnected = connect(&config, "33333333333333333333333333333333");
        reconnected.ready().unwrap();
        assert!(reconnected.id > dropped.id && dropped.id > first.id && first.id > rejected.id);
        for old in [&rejected, &first, &dropped] {
            assert!(old.interrupt().is_err());
            old.disconnect().unwrap();
        }
        assert!(
            crate::term::fixture_session_exit(reconnected.id)
                .unwrap()
                .is_none(),
            "old-session actions affected the new connection"
        );
        reconnected.send("wait\r").unwrap();
        reconnected
            .collect_until(|out, _| safe_text(out).contains("FIXTURE RUNNING"))
            .unwrap();
        reconnected.disconnect().unwrap();
        assert!(
            crate::term::fixture_session_exit(reconnected.id).is_err(),
            "successful force disconnect must unregister the session"
        );
        reconnected.disconnect().unwrap();
        let mut after_kill = connect(&config, "44444444444444444444444444444444");
        after_kill.ready().unwrap();
        after_kill.send("exit\r").unwrap();
        assert_eq!(after_kill.wait_exit().unwrap(), 7);
        after_kill.disconnect().unwrap();
        println!("Real loopback SSH passed: auth failure/relogin, metadata/resize, Ctrl+C running command/session survives, remote drop/reconnect, force disconnect/reconnect, old/new session isolation.");
    }
}
