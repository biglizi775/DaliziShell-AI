use portable_pty::{native_pty_system, PtyPair, PtySize};
use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::path::PathBuf;
use windows::core::GUID;
use windows::core::{s, w, PCSTR};
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
use windows::Win32::UI::Shell::{
    FOLDERID_ProgramFiles, FOLDERID_System, SHGetKnownFolderPath, KNOWN_FOLDER_FLAG,
};

pub fn known_folder(id: &GUID) -> Option<PathBuf> {
    unsafe {
        let ptr = SHGetKnownFolderPath(id, KNOWN_FOLDER_FLAG(0), None).ok()?;
        let path = OsString::from_wide(ptr.as_wide());
        CoTaskMemFree(Some(ptr.0.cast()));
        Some(PathBuf::from(path))
    }
}

fn select_shell(
    programs: Option<PathBuf>,
    system: Option<PathBuf>,
    path: &[PathBuf],
) -> Option<PathBuf> {
    let installed = programs.map(|p| p.join(r"PowerShell\7\pwsh.exe"));
    let built_in = system.map(|p| p.join(r"WindowsPowerShell\v1.0\powershell.exe"));
    let on_path = |name: &'static str| {
        path.iter()
            .filter(|d| d.is_absolute())
            .map(move |d| d.join(name))
    };
    installed
        .into_iter()
        .chain(on_path("pwsh.exe"))
        .chain(built_in)
        .chain(on_path("powershell.exe"))
        .find(|p| p.is_file())
}

pub fn powershell() -> Result<PathBuf, String> {
    let path: Vec<_> = std::env::var_os("PATH")
        .as_deref()
        .map(std::env::split_paths)
        .into_iter()
        .flatten()
        .collect();
    select_shell(known_folder(&FOLDERID_ProgramFiles), known_folder(&FOLDERID_System), &path)
        .ok_or_else(|| "找不到 PowerShell。请检查 Windows PowerShell 或 PowerShell 7 是否已安装。 / No PowerShell executable found.".into())
}

fn check_pty_exports(exported: impl Fn(PCSTR) -> bool) -> Result<(), String> {
    if [
        s!("CreatePseudoConsole"),
        s!("ResizePseudoConsole"),
        s!("ClosePseudoConsole"),
    ]
    .into_iter()
    .all(exported)
    {
        return Ok(());
    }
    Err("当前系统缺少 ConPTY 接口。 / The Windows pseudo console APIs are unavailable.".into())
}

pub fn check_conpty() -> Result<(), String> {
    // portable-pty initializes these exports with expect(). Probe before its
    // first use so older kernels can select the bundled WinPTY backend.
    let kernel = unsafe { GetModuleHandleW(w!("kernel32.dll")) }.map_err(|e| e.to_string())?;
    check_pty_exports(|name| unsafe { GetProcAddress(kernel, name).is_some() })
}

pub fn open_pty(size: PtySize) -> Result<PtyPair, String> {
    let prefer_winpty =
        std::env::var_os("DALIZI_USE_WINPTY").as_deref() == Some(std::ffi::OsStr::new("1"));
    if !prefer_winpty && check_conpty().is_ok() {
        return native_pty_system()
            .openpty(size)
            .map_err(|e| format!("ConPTY: {e}"));
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let terminal = exe.parent().ok_or("找不到程序目录")?.join("terminal");
    let dll = terminal.join("winpty.dll");
    if !dll.is_file() || !terminal.join("winpty-agent.exe").is_file() {
        return Err("兼容终端缺少 WinPTY 文件。请完整解压本版本的 ZIP，保留 DaliziFiles.exe 同级的 terminal 目录。 / Extract the matching terminal directory from the desktop ZIP.".into());
    }
    portable_pty::win::conpty::open_winpty(&dll, size).map_err(|e| format!("WinPTY: {e:#}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    #[test]
    fn missing_any_pseudo_console_entry_point_is_a_recoverable_error() {
        for missing in [
            "CreatePseudoConsole",
            "ResizePseudoConsole",
            "ClosePseudoConsole",
        ] {
            let result = check_pty_exports(|name| unsafe { name.to_string().unwrap() } != missing);
            assert!(result.unwrap_err().contains("ConPTY"));
        }
        check_pty_exports(|_| true).unwrap();
    }
    #[test]
    fn shell_follows_the_installation_and_path_before_the_builtin_fallback() {
        let temp = tempfile::tempdir().unwrap();
        let programs = temp.path().join("安装位置");
        let system = temp.path().join("系统");
        let custom = temp.path().join("custom");
        let setup = |p: &Path| {
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, []).unwrap();
        };
        let builtin = system.join(r"WindowsPowerShell\v1.0\powershell.exe");
        let installed = programs.join(r"PowerShell\7\pwsh.exe");
        let from_path = custom.join("pwsh.exe");
        let find = || {
            select_shell(
                Some(programs.clone()),
                Some(system.clone()),
                std::slice::from_ref(&custom),
            )
        };
        assert!(find().is_none());
        setup(&builtin);
        assert_eq!(find(), Some(builtin));
        setup(&from_path);
        assert_eq!(find(), Some(from_path));
        setup(&installed);
        assert_eq!(find(), Some(installed));
    }
}
