//! User-selected Windows HTTP(S) association and cold/warm URL activation.
use std::{path::Path, sync::Mutex};
use tauri::{AppHandle, Emitter, Manager, State, Webview};
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

const CLIENT: &str = r"Software\Clients\StartMenuInternet\DaliziFiles";
const PROGID: &str = "DaliziFiles.URL";
const DISPLAY: &str = "Dalizi Files";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkDiagnostics {
    registration: &'static str,
    http: Option<String>,
    https: Option<String>,
    runtime: Option<String>,
}

fn read_registration(root: &RegKey, exe: &Path) -> std::io::Result<&'static str> {
    let value = |path: &str, name: &str| -> std::io::Result<Option<String>> {
        match root.open_subkey(path).and_then(|key| key.get_value(name)) {
            Ok(s) => Ok(Some(s)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    };
    let caps = format!(r"{CLIENT}\Capabilities");
    let mapping = value(r"Software\RegisteredApplications", DISPLAY)?;
    let command = value(
        &format!(r"Software\Classes\{PROGID}\shell\open\command"),
        "",
    )?;
    let associations = format!(r"{caps}\URLAssociations");
    let http = value(&associations, "http")?;
    let https = value(&associations, "https")?;
    if [&mapping, &command, &http, &https]
        .iter()
        .all(|v| v.is_none())
    {
        return Ok("missing");
    }
    let expected = format!(r#""{}" --open-url "%1""#, exe.display());
    let matches = |value: Option<String>, expected: &str| {
        value.is_some_and(|v| v.eq_ignore_ascii_case(expected))
    };
    Ok(
        if matches(mapping, &caps)
            && matches(command, &expected)
            && matches(http, PROGID)
            && matches(https, PROGID)
        {
            "current"
        } else {
            "repair"
        },
    )
}

#[tauri::command]
pub async fn browser_link_diagnostics(webview: Webview) -> Result<LinkDiagnostics, String> {
    use windows::core::{w, PCWSTR};
    use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_INPROC_SERVER};
    use windows::Win32::UI::Shell::{
        ApplicationAssociationRegistration, IApplicationAssociationRegistration, AL_EFFECTIVE,
        AT_URLPROTOCOL,
    };
    if webview.label() != "main" {
        return Err("Main workbench required".into());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let registration =
        read_registration(&RegKey::predef(HKEY_CURRENT_USER), &exe).unwrap_or("unknown");
    let (tx, rx) = tokio::sync::oneshot::channel();
    webview
        .with_webview(move |view| unsafe {
            let association: Option<IApplicationAssociationRegistration> = CoCreateInstance(
                &ApplicationAssociationRegistration,
                None,
                CLSCTX_INPROC_SERVER,
            )
            .ok();
            let handler = |scheme: PCWSTR| -> Option<String> {
                let id = association
                    .as_ref()?
                    .QueryCurrentDefault(scheme, AT_URLPROTOCOL, AL_EFFECTIVE)
                    .ok()?;
                let name = id.to_string().ok();
                CoTaskMemFree(Some(id.0.cast()));
                name
            };
            let mut version = windows_core::PWSTR::null();
            let runtime = view
                .environment()
                .BrowserVersionString(&mut version)
                .ok()
                .map(|_| webview2_com::take_pwstr(version));
            let _ = tx.send(LinkDiagnostics {
                registration,
                http: handler(w!("http")),
                https: handler(w!("https")),
                runtime,
            });
        })
        .map_err(|e| e.to_string())?;
    rx.await.map_err(|e| e.to_string())
}

#[derive(Default)]
pub struct BrowserLinks(Mutex<Vec<String>>);

fn activation(args: &[String]) -> Option<String> {
    let [_, flag, value] = args else { return None };
    if flag != "--open-url"
        || value.len() > 32700
        || value
            .chars()
            .any(|c| c.is_control() || matches!(c, '"' | '\\'))
    {
        return None;
    }
    let url = crate::browser::valid_url(value).ok()?;
    matches!(url.scheme(), "https" | "http").then(|| url.to_string())
}

pub fn receive(app: &AppHandle, args: &[String]) {
    if let Some(url) = activation(args) {
        let links = app.state::<BrowserLinks>();
        if let Ok(mut pending) = links.0.lock() {
            if pending.len() < 64 {
                pending.push(url);
            }
        }
        // Only signal availability. Login URLs can contain one-time codes.
        let _ = app.emit_to("main", "browser-links-ready", ());
    }
}

#[tauri::command]
pub fn browser_take_links(
    webview: Webview,
    state: State<'_, BrowserLinks>,
) -> Result<Vec<String>, String> {
    if webview.label() != "main" {
        return Err("Main workbench required".into());
    }
    let mut links = state.0.lock().map_err(|_| "URL queue unavailable")?;
    Ok(std::mem::take(&mut *links))
}

fn register(root: &RegKey, exe: &Path) -> std::io::Result<()> {
    let exe = exe
        .to_str()
        .ok_or_else(|| std::io::Error::other("Invalid executable path"))?;
    let command = format!(r#""{exe}" --open-url "%1""#);
    let icon = format!(r#""{exe}",0"#);
    let (client, _) = root.create_subkey(CLIENT)?;
    client.set_value("", &DISPLAY)?;
    client
        .create_subkey("DefaultIcon")?
        .0
        .set_value("", &icon)?;
    client
        .create_subkey(r"shell\open\command")?
        .0
        .set_value("", &format!(r#""{exe}""#))?;
    let (caps, _) = client.create_subkey("Capabilities")?;
    caps.set_value("ApplicationName", &DISPLAY)?;
    caps.set_value("ApplicationDescription", &"Dalizi Files 内置浏览器")?;
    caps.set_value("ApplicationIcon", &icon)?;
    let (associations, _) = caps.create_subkey("URLAssociations")?;
    let (prog, _) = root.create_subkey(format!(r"Software\Classes\{PROGID}"))?;
    prog.set_value("", &"Dalizi Files Web Link")?;
    prog.set_value("URL Protocol", &"")?;
    prog.create_subkey("DefaultIcon")?.0.set_value("", &icon)?;
    prog.create_subkey(r"shell\open\command")?
        .0
        .set_value("", &command)?;
    for scheme in ["http", "https"] {
        associations.set_value(scheme, &PROGID)?;
    }
    root.create_subkey(r"Software\RegisteredApplications")?
        .0
        .set_value(DISPLAY, &format!(r"{CLIENT}\Capabilities"))
}

#[tauri::command]
pub fn browser_register_windows(webview: Webview) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("Main workbench required".into());
    }
    register(
        &RegKey::predef(HKEY_CURRENT_USER),
        &std::env::current_exe().map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    use windows::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
    unsafe {
        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None);
    }
    crate::shell_execute(
        "open",
        "ms-settings:defaultapps?registeredAppUser=Dalizi%20Files",
        None,
    )
    .or_else(|_| crate::shell_execute("open", "ms-settings:defaultapps", None))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_accepts_an_explicit_web_url() {
        let parse = |value: &str| activation(&["app".into(), "--open-url".into(), value.into()]);
        assert_eq!(
            parse("http://127.0.0.1:3456/callback?code=a%26b").as_deref(),
            Some("http://127.0.0.1:3456/callback?code=a%26b")
        );
        for raw in [
            "file:///C:/windows",
            "about:blank",
            "myapp://callback",
            "https://tauri.localhost/",
            "https://u:p@host/",
            "https://example.com/\" --flag",
            "javascript:alert(1)",
        ] {
            assert!(parse(raw).is_none(), "{raw}");
        }
        assert!(activation(&[
            "app".into(),
            "--open-url".into(),
            "https://example.com/".into(),
            "--flag".into()
        ])
        .is_none());
    }
    #[test]
    fn registers_only_web_capabilities_and_quotes_the_executable() {
        let (fixture, _) = RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey(format!(
                r"Software\DaliziBrowserTest-{}",
                std::process::id()
            ))
            .unwrap();
        let registry = RegKey::predef(HKEY_CURRENT_USER);
        let exe = Path::new(r"C:\软件 目录\Dalizi Files.exe");
        assert_eq!(read_registration(&fixture, exe).unwrap(), "missing");
        register(&fixture, exe).unwrap();
        assert_eq!(read_registration(&fixture, exe).unwrap(), "current");
        assert_eq!(
            read_registration(&fixture, Path::new(r"D:\Dalizi.exe")).unwrap(),
            "repair"
        );
        let mapping: String = fixture
            .open_subkey(r"Software\RegisteredApplications")
            .unwrap()
            .get_value(DISPLAY)
            .unwrap();
        let schemes = fixture
            .open_subkey(mapping)
            .unwrap()
            .open_subkey("URLAssociations")
            .unwrap();
        assert_eq!(schemes.enum_values().count(), 2);
        assert_eq!(schemes.get_value::<String, _>("https").unwrap(), PROGID);
        let command: String = fixture
            .open_subkey(r"Software\Classes\DaliziFiles.URL\shell\open\command")
            .unwrap()
            .get_value("")
            .unwrap();
        assert_eq!(
            command,
            r#""C:\软件 目录\Dalizi Files.exe" --open-url "%1""#
        );
        assert!(fixture
            .open_subkey(r"Software\Microsoft\Windows\Shell\Associations")
            .is_err());
        registry
            .delete_subkey_all(format!(
                r"Software\DaliziBrowserTest-{}",
                std::process::id()
            ))
            .unwrap();
    }
}
