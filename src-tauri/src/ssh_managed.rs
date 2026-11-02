//! Native SSH sessions: verified host identities, terminal and SFTP channels.
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock, atomic::{AtomicU32, Ordering}};
use std::time::{Duration, Instant};
use russh::{client, ChannelMsg, Disconnect, keys::{HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate}};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::{watch, OnceCell};
use zeroize::Zeroizing;
use crate::{ssh::{SshConfig, InfoMode}, ssh_credentials as credentials};

#[path = "ssh_files.rs"]
pub mod files;

pub const FIRST_ID: u32 = 0x8000_0000;
static NEXT_ID: AtomicU32 = AtomicU32::new(FIRST_ID);
static SESSIONS: OnceLock<Mutex<HashMap<u32, Arc<Session>>>> = OnceLock::new();
static PROBES: OnceLock<Mutex<HashMap<String, Probe>>> = OnceLock::new();
fn sessions() -> &'static Mutex<HashMap<u32, Arc<Session>>> { SESSIONS.get_or_init(Default::default) }
fn probes() -> &'static Mutex<HashMap<String, Probe>> { PROBES.get_or_init(Default::default) }
pub fn nonce() -> Result<String, String> {
    Ok(format!("{:?}", unsafe { windows::Win32::System::Com::CoCreateGuid() }.map_err(|e| e.to_string())?).replace(['-', '{', '}'], ""))
}
fn host_id(config: &SshConfig) -> Result<String, String> {
    let (host, _) = crate::ssh::validate_config(config)?;
    let host = host.parse::<std::net::IpAddr>().map(|ip| ip.to_string()).unwrap_or_else(|_| host.trim_end_matches('.').to_ascii_lowercase());
    Ok(credentials::target("host", &[&host, &config.port.to_string()]))
}
fn saved_host(config: &SshConfig) -> Result<Option<String>, String> {
    credentials::read(&host_id(config)?)?.map(|b| String::from_utf8(b.to_vec()).map_err(|_| "主机身份存储损坏 / Invalid stored host identity".into())).transpose()
}
fn secret_id(config: &SshConfig, fingerprint: &str) -> Result<String, String> {
    Ok(credentials::target("auth", &[&host_id(config)?, &config.user, fingerprint, config.identity_file.as_deref().unwrap_or("")]))
}
#[derive(Clone)]
struct Probe { host_id: String, fingerprint: String, previous: Option<String>, created: Instant }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostProbe { token: String, fingerprint: String, previous: Option<String>, trusted: bool, has_credential: bool }
pub struct Verifier { expected: Option<String>, observed: Arc<Mutex<Option<String>>> }
impl client::Handler for Verifier {
    type Error = russh::Error;
    async fn check_server_key(&mut self, key: &PublicKeyOrCertificate) -> Result<bool, Self::Error> {
        let fingerprint = key.public_key().fingerprint(HashAlg::Sha256).to_string();
        *self.observed.lock().unwrap() = Some(fingerprint.clone());
        Ok(self.expected.as_ref() == Some(&fingerprint))
    }
}
fn client_config() -> Arc<client::Config> {
    Arc::new(client::Config { keepalive_interval: Some(Duration::from_secs(20)), keepalive_max: 3, ..Default::default() })
}
#[tauri::command]
pub async fn ssh_probe_host(config: SshConfig) -> Result<HostProbe, String> {
    let (host, _) = crate::ssh::validate_config(&config)?;
    let previous = saved_host(&config)?;
    let observed = Arc::new(Mutex::new(None));
    // Discovery deliberately rejects the key and sends no authentication data.
    let result = tokio::time::timeout(Duration::from_secs(15), client::connect(client_config(), (host.as_str(), config.port), Verifier { expected: None, observed: observed.clone() })).await;
    let fingerprint = observed.lock().unwrap().clone().ok_or_else(|| match result {
        Err(_) => "SSH 连接超时 / SSH connection timed out".to_owned(),
        Ok(Err(e)) => format!("无法获取主机指纹 / Cannot obtain host identity: {e}"),
        _ => "服务器未提供主机指纹 / No host identity".into(),
    })?;
    let token = nonce()?;
    let trusted = previous.as_ref() == Some(&fingerprint);
    let has_credential = trusted && credentials::read(&secret_id(&config, &fingerprint)?)?.is_some();
    let mut pending = probes().lock().unwrap();
    pending.retain(|_, probe| probe.created.elapsed() < Duration::from_secs(120));
    if pending.len() >= 64 { return Err("待确认连接过多 / Too many pending connections".into()); }
    pending.insert(token.clone(), Probe { host_id: host_id(&config)?, fingerprint: fingerprint.clone(), previous: previous.clone(), created: Instant::now() });
    Ok(HostProbe { token, fingerprint, previous, trusted, has_credential })
}
#[tauri::command]
pub fn ssh_trust_host(token: String) -> Result<(), String> {
    let probe = probes().lock().unwrap().remove(&token).ok_or("主机确认已失效，请重试 / Host confirmation expired")?;
    if probe.created.elapsed() > Duration::from_secs(120) { return Err("主机确认已超时 / Host confirmation expired".into()); }
    let current = credentials::read(&probe.host_id)?.map(|b| String::from_utf8_lossy(&b).into_owned());
    if current != probe.previous { return Err("主机身份已被其他连接修改，请重试 / Host identity changed locally".into()); }
    credentials::write(&probe.host_id, "SSH host key", probe.fingerprint.as_bytes())
}
#[tauri::command]
pub fn ssh_forget_credential(config: SshConfig) -> Result<(), String> {
    if let Some(fingerprint) = saved_host(&config)? { credentials::delete(&secret_id(&config, &fingerprint)?)?; }
    Ok(())
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthInput { pub secret: Option<String>, #[serde(default)] pub remember: bool, #[serde(default)] pub use_saved: bool }
pub(super) struct Session {
    pub resume_identity: String,
    pub id: u32, pub key: String, pub handle: client::Handle<Verifier>,
    writer: russh::ChannelWriteHalf<client::Msg>,
    pub stop: watch::Sender<bool>, pub sftp: OnceCell<Arc<russh_sftp::client::SftpSession>>,
    pub transfers: Mutex<HashMap<String, watch::Sender<bool>>>,
    mode: InfoMode,
}
pub(super) fn get(id: u32) -> Result<Arc<Session>, String> {
    sessions().lock().unwrap().get(&id).cloned().filter(|s| !*s.stop.borrow() && !s.handle.is_closed()).ok_or_else(|| "SSH 会话已结束，请重新登录 / SSH session is closed".into())
}
fn emit_state(app: &AppHandle, session: &Session, saved: bool, warning: Option<String>) {
    let _ = app.emit("ssh-managed-state", serde_json::json!({"id":session.id,"key":session.key,"authenticated":true,"credentialSaved":saved,"warning":warning}));
}
#[tauri::command]
pub async fn ssh_managed_start(key: String, config: SshConfig, auth: AuthInput, cols: u16, rows: u16, app: AppHandle) -> Result<u32, String> {
    if key.is_empty() || key.len() > 200 || key.chars().any(char::is_control) || cols == 0 || rows == 0 || cols > 32767 || rows > 32767 { return Err("Invalid SSH session parameters".into()); }
    let (host, identity) = crate::ssh::validate_config(&config)?;
    let expected = saved_host(&config)?.ok_or("请先核对并信任主机指纹 / Verify the host fingerprint first")?;
    let credential_id = secret_id(&config, &expected)?;
    let secret = match auth.secret {
        Some(s) if !s.is_empty() => Zeroizing::new(s),
        _ if auth.use_saved => Zeroizing::new(credentials::read(&credential_id)?.map(|b| String::from_utf8(b.to_vec())).transpose().map_err(|_| "Invalid credential encoding")?.unwrap_or_default()),
        _ => Zeroizing::new(String::new()),
    };
    if secret.len() > 2048 || secret.contains('\0') { return Err("密码或口令过长 / Invalid password or passphrase".into()); }
    let task = async {
        let mut handle = client::connect(client_config(), (host.as_str(), config.port), Verifier { expected: Some(expected), observed: Arc::new(Mutex::new(None)) }).await.map_err(|e| format!("SSH 握手失败，请检查主机指纹或网络 / SSH handshake failed: {e}"))?;
        let authenticated = if let Some(path) = identity {
            let pass = Zeroizing::new(secret.to_string());
            let key = tauri::async_runtime::spawn_blocking(move || russh::keys::load_secret_key(path, (!pass.is_empty()).then_some(pass.as_str()))).await.map_err(|e| e.to_string())?.map_err(|_| "无法读取私钥，请检查口令；加密私钥请使用 OpenSSH 格式，其他格式可尝试 OpenSSH 兼容模式 / Cannot read private key; check the passphrase or use an OpenSSH-format key or compatibility mode")?;
            let hash = handle.best_supported_rsa_hash().await.map_err(|e| e.to_string())?.flatten();
            handle.authenticate_publickey(&config.user, PrivateKeyWithHashAlg::new(Arc::new(key), hash)).await
        } else {
            if secret.is_empty() { return Err("请输入密码，或选择私钥 / Enter a password or select a private key".into()); }
            handle.authenticate_password(&config.user, secret.as_str()).await
        }.map_err(|_| "SSH 认证失败 / SSH authentication failed")?.success();
        if !authenticated { let _ = handle.disconnect(Disconnect::ByApplication, "Authentication failed", "").await; return Err("认证失败；未保存此次密码，请检查密码或认证方式 / Authentication failed; password was not saved".into()); }
        let mut channel = handle.channel_open_session().await.map_err(|e| e.to_string())?;
        channel.request_pty(true, "xterm-256color", cols as u32, rows as u32, 0, 0, &[]).await.map_err(|e| e.to_string())?;
        let mut initial = wait_ready(&mut channel).await?;
        channel.request_shell(true).await.map_err(|e| e.to_string())?;
        initial.extend(wait_ready(&mut channel).await?);
        let (reader, writer) = channel.split();
        let (stop, _) = watch::channel(false);
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        if id < FIRST_ID { return Err("SSH session limit reached; restart the app".into()); }
        let session = Arc::new(Session { id, key, handle, writer, stop, sftp: OnceCell::new(), transfers: Mutex::new(HashMap::new()), mode: config.info_mode, resume_identity: credential_id.clone() });
        sessions().lock().unwrap().insert(id, session.clone());
        let mut saved = false; let mut warning = None;
        if auth.remember && !secret.is_empty() {
            match credentials::write(&credential_id, &config.user, secret.as_bytes()) { Ok(()) => saved = true, Err(e) => warning = Some(e) }
        }
        emit_state(&app, &session, saved, warning);
        spawn_reader(app.clone(), session.clone(), reader, initial);
        if session.mode != InfoMode::Shell {
            tauri::async_runtime::spawn(async move { if let Ok(info) = stats(&session).await { let _ = app.emit("ssh-managed-stats", serde_json::json!({"id":id,"key":session.key,"info":info})); } });
        }
        Ok(id)
    };
    tokio::time::timeout(Duration::from_secs(30), task).await.map_err(|_| "SSH 连接或认证超时 / SSH connect/authentication timeout".to_owned())?
}
async fn wait_ready(channel: &mut russh::Channel<client::Msg>) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    loop { match channel.wait().await {
        Some(ChannelMsg::Success) => return Ok(output),
        Some(ChannelMsg::Data { data }) | Some(ChannelMsg::ExtendedData { data, .. }) if output.len() + data.len() <= 65536 => output.extend_from_slice(&data),
        _ => return Err("服务器拒绝了交互终端 / Server refused the interactive terminal".into()),
    } }
}
fn spawn_reader(app: AppHandle, session: Arc<Session>, mut reader: russh::ChannelReadHalf, mut pending: Vec<u8>) {
    tauri::async_runtime::spawn(async move {
        let mut stopped = session.stop.subscribe(); let mut code = None;
        loop {
            let data = crate::term::decode_output(&mut pending);
            if !data.is_empty() { let _ = app.emit("term-out", serde_json::json!({"id":session.id,"key":session.key,"data":data})); }
            tokio::select! {
                _ = stopped.changed() => break,
                message = reader.wait() => match message {
                    Some(ChannelMsg::Data { data }) | Some(ChannelMsg::ExtendedData { data, .. }) => pending.extend_from_slice(&data),
                    Some(ChannelMsg::ExitStatus { exit_status }) => code = Some(exit_status),
                    None | Some(ChannelMsg::Close) => break,
                    _ => (),
                }
            }
        }
        if !pending.is_empty() { let _ = app.emit("term-out", serde_json::json!({"id":session.id,"key":session.key,"data":String::from_utf8_lossy(&pending)})); }
        let _ = session.stop.send(true);
        for stop in session.transfers.lock().unwrap().values() { let _ = stop.send(true); }
        let _ = tokio::time::timeout(Duration::from_secs(2), session.handle.disconnect(Disconnect::ByApplication, "Session closed", "")).await;
        sessions().lock().unwrap().remove(&session.id);
        let _ = app.emit("term-closed", serde_json::json!({"id":session.id,"key":session.key,"exitCode":code}));
    });
}
pub async fn write(id: u32, data: String) -> Result<(), String> {
    if data.len() > 1024 * 1024 { return Err("Terminal input too large".into()); }
    let session = get(id)?;
    tokio::time::timeout(Duration::from_secs(3), session.writer.data(data.as_bytes())).await.map_err(|_| "SSH 写入超时 / SSH write timeout")?.map_err(|e| e.to_string())
}
pub async fn resize(id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let session = get(id)?;
    session.writer.window_change(cols as u32, rows as u32, 0, 0).await.map_err(|e| e.to_string())
}
pub async fn kill(id: u32) -> Result<(), String> {
    let session = sessions().lock().unwrap().get(&id).cloned();
    if let Some(session) = session { let _ = session.stop.send(true); }
    Ok(())
}
pub fn shutdown() { for session in sessions().lock().unwrap().values() { let _ = session.stop.send(true); } }

const STATS_COMMAND: &str = r#"LC_ALL=C; export LC_ALL
printf 'hostname\t'; hostname 2>/dev/null
printf 'os\t'; if [ -r /etc/os-release ]; then sed -n 's/^PRETTY_NAME=//p' /etc/os-release; else uname -s; fi
printf 'kernel\t'; uname -r
printf 'arch\t'; uname -m
printf 'user\t'; id -un
printf 'uptime\t'; uptime
printf 'serverIp\t'; printf '%s\n' "$SSH_CONNECTION" | awk '{print $3}'
if [ -r /proc/meminfo ]; then awk '/^MemTotal:/ {print "memoryTotalKiB\t" $2} /^MemAvailable:/ {print "memoryAvailableKiB\t" $2}' /proc/meminfo; else sysctl -n hw.memsize 2>/dev/null | awk '{print "memoryTotalKiB\t" $1/1024}'; fi
df -Pk / 2>/dev/null | awk 'NR==2 {print "diskTotalKiB\t" $2; print "diskUsedKiB\t" $3; print "diskAvailableKiB\t" $4}'
if [ -r /proc/loadavg ]; then awk '{print "loadAverage\t" $1 " " $2 " " $3}' /proc/loadavg; fi
"#;
fn parse_stats(data: &[u8]) -> HashMap<String, String> {
    let mut result = HashMap::new();
    for line in String::from_utf8_lossy(data).lines() {
        let Some((key, value)) = line.split_once('\t') else { continue };
        if ["hostname", "os", "kernel", "arch", "user", "uptime", "serverIp", "memoryTotalKiB", "memoryAvailableKiB", "diskTotalKiB", "diskUsedKiB", "diskAvailableKiB", "loadAverage"].contains(&key) {
            let value: String = value.chars().filter(|c| !c.is_control()).take(512).collect();
            if !key.ends_with("KiB") || value.parse::<u64>().is_ok() { result.insert(key.into(), value.trim_matches('"').into()); }
        }
    }
    result
}
const WINDOWS_STATS: &str = r#"[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$o = Get-CimInstance Win32_OperatingSystem
$d = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $env:SystemDrive + "'")
$values = [ordered]@{hostname=$env:COMPUTERNAME;os=$o.Caption;kernel=$o.Version;arch=$env:PROCESSOR_ARCHITECTURE;user=$env:USERNAME;uptime=((Get-Date)-$o.LastBootUpTime).ToString();serverIp=($env:SSH_CONNECTION -split ' ')[2];memoryTotalKiB=$o.TotalVisibleMemorySize;memoryAvailableKiB=$o.FreePhysicalMemory;diskTotalKiB=[math]::Floor($d.Size/1024);diskUsedKiB=[math]::Floor(($d.Size-$d.FreeSpace)/1024);diskAvailableKiB=[math]::Floor($d.FreeSpace/1024)}
foreach($entry in $values.GetEnumerator()){[Console]::WriteLine($entry.Key + "`t" + $entry.Value)}"#;
async fn stats(session: &Session) -> Result<HashMap<String, String>, String> {
    if session.mode == InfoMode::Shell { return Err("普通终端模式不执行资源查询 / Resource collection disabled for plain terminals".into()); }
    let operation = async {
        let mut channel = session.handle.channel_open_session().await.map_err(|e| e.to_string())?;
        let command = if session.mode == InfoMode::Windows {
            let bytes: Vec<u8> = WINDOWS_STATS.encode_utf16().flat_map(u16::to_le_bytes).collect();
            format!("powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand {}", crate::preview::base64(&bytes))
        } else { STATS_COMMAND.into() };
        channel.exec(true, command).await.map_err(|e| e.to_string())?;
        let mut data = Vec::new();
        while let Some(msg) = channel.wait().await { match msg {
            ChannelMsg::Data { data: bytes } => { if data.len() + bytes.len() > 16384 { let _ = channel.close().await; return Err("Resource response too large".into()); } data.extend_from_slice(&bytes); }
            ChannelMsg::Failure => return Err("服务器不允许资源查询 / Server refused resource query".into()),
            ChannelMsg::Close | ChannelMsg::Eof => break,
            _ => (),
        } }
        Ok(parse_stats(&data))
    };
    tokio::time::timeout(Duration::from_secs(10), operation).await.map_err(|_| "资源查询超时 / Resource query timed out".to_owned())?
}
#[tauri::command]
pub async fn ssh_managed_stats(id: u32) -> Result<HashMap<String, String>, String> { let session = get(id)?; stats(&session).await }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resource_parser_bounds_untrusted_output_and_rejects_invalid_sizes() {
        let input = format!("hostname\tserver\u{1b}\nunknown\tignored\nmemoryTotalKiB\t8388608\ndiskTotalKiB\t-1\nmemoryAvailableKiB\tNaN\nos\t\"Linux\"\nuser\t{}", "x".repeat(700));
        let info = parse_stats(input.as_bytes());
        assert_eq!(info["hostname"], "server");
        assert_eq!(info["os"], "Linux");
        assert_eq!(info["memoryTotalKiB"], "8388608");
        assert_eq!(info["user"].len(), 512);
        assert!(!info.contains_key("unknown"));
        assert!(!info.contains_key("diskTotalKiB"));
        assert!(!info.contains_key("memoryAvailableKiB"));
    }
}
