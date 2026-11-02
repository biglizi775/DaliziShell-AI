//! Native Windows notification area. Hiding never destroys the webview/session.
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};

pub const TRAY_ID: &str = "dalizi-main-tray";
const SHOW_ID: &str = "dalizi-tray-show";
const HIDE_ID: &str = "dalizi-tray-hide";
const EXIT_ID: &str = "dalizi-tray-exit";

pub fn show_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        // Unminimize first so the subsequent resize event does not hide it
        // again. Windows also restores the pre-minimize maximized state.
        window.unminimize()?;
        window.show()?;
        window.set_focus()?;
    }
    Ok(())
}

pub fn hide_window(app: &AppHandle) -> tauri::Result<()> {
    // Do not hide if there is no recovery entry in the notification area.
    if app.tray_by_id(TRAY_ID).is_some() {
        if let Some(window) = app.get_webview_window("main") {
            window.hide()?;
        }
    }
    Ok(())
}

pub fn install(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let icon = app
        .default_window_icon()
        .ok_or("Missing application icon")?;
    let show = MenuItem::with_id(app, SHOW_ID, "显示窗口", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, HIDE_ID, "最小化到托盘", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let exit = MenuItem::with_id(app, EXIT_ID, "退出程序", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &separator, &exit])?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon.clone())
        .tooltip("呆梨文件 · Dalizi Files\n单击显示窗口 · 右键打开菜单")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let result = match event.id().as_ref() {
                SHOW_ID => show_window(app),
                HIDE_ID => hide_window(app),
                EXIT_ID => {
                    // Go through Tauri's RunEvent::Exit cleanup (terminals,
                    // browser sessions and index cache), never process::exit.
                    app.exit(0);
                    Ok(())
                }
                _ => Ok(()),
            };
            if let Err(error) = result {
                eprintln!("System tray action failed: {error}");
            }
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                if let Err(error) = show_window(tray.app_handle()) {
                    eprintln!("Cannot restore main window: {error}");
                }
            }
        })
        .build(app)?;

    // Register only after successful icon creation. The AppHandle retains the
    // icon resource for the lifetime of the application.
    if let Some(window) = app.get_webview_window("main") {
        let handle = app.clone();
        window.on_window_event(move |event| {
            if matches!(event, WindowEvent::Resized(_)) {
                if let Some(window) = handle.get_webview_window("main") {
                    if window.is_minimized().unwrap_or(false) {
                        if let Err(error) = hide_window(&handle) {
                            eprintln!("Cannot minimize to system tray: {error}");
                        }
                    }
                }
            }
        });
    }
    Ok(())
}
