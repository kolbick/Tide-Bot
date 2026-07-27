// Public interface for the tide_bot library crate.
//
// Two distinct surface areas:
//
//   * compiled-binary runtime: `run()`, `companion_window()`, `show_main_window`
//     command (the only registered command), `sign_out`/`quit` helpers, and
//     tray/window lifecycle.
//
//   * executable-integration-test surface: helper functions and structs
//     exported for the three Cargo integration tests under `tests/`. They
//     consume compile-time embeds or supplied document bytes for fixture
//     tests. No environment- or filesystem-derived state influences them
//     after the binary is sealed.

pub mod origin;
pub mod placement;

pub use origin::{
    configured_auth_url,
    configured_companion_url,
    configured_remote_urls_json,
    parse_for_fixtures,
    CapabilitiesFixture,
    ProvenanceFixture,
    RemoteUrls,
    UrlFixture,
};

pub use placement::{clamp_to_monitor, load_placement, save_placement, MonitorBounds, Placement};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

const MAIN_LABEL: &str = "main";
const COMPANION_LABEL: &str = "companion";

#[derive(serde::Serialize, serde::Deserialize, Default)]
pub struct SignOutOutcome {
    pub cleared_main: bool,
    pub cleared_companion: bool,
}

/// The single command exposed to the companion window. Surfaces only when the
/// companion capability is granted; the capability is the unprefixed
/// `allow-show-main-window` and the permission is exactly that one entry.
#[tauri::command]
fn show_main_window(app: AppHandle) -> tauri::Result<()> {
    let main = app
        .get_webview_window(MAIN_LABEL)
        .ok_or_else(|| tauri::Error::WebviewNotFound)?;
    if !main.is_visible().unwrap_or(false) {
        main.show()?;
    }
    main.unminimize().ok();
    main.set_focus()?;
    Ok(())
}

fn companion_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<WebviewWindow<R>> {
    let url = origin::configured_companion_url()?;
    WebviewWindowBuilder::new(app, COMPANION_LABEL, WebviewUrl::External(url))
        .decorations(false)
        .always_on_top(true)
        .resizable(false)
        .skip_taskbar(true)
        .inner_size(380.0, 520.0)
        .title("Ted-Bot")
        .build()
}

fn main_window_ref<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<WebviewWindow<R>> {
    app.get_webview_window(MAIN_LABEL).ok_or_else(|| tauri::Error::WebviewNotFound)
}

fn sign_out<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<SignOutOutcome> {
    let auth_url = origin::configured_auth_url()?;
    let mut outcome = SignOutOutcome::default();
    if let Some(window) = app.get_webview_window(MAIN_LABEL) {
        window.clear_all_browsing_data()?;
        window.navigate(auth_url.clone())?;
        outcome.cleared_main = true;
    }
    if let Some(window) = app.get_webview_window(COMPANION_LABEL) {
        window.clear_all_browsing_data()?;
        window.navigate(auth_url)?;
        outcome.cleared_companion = true;
    }
    Ok(outcome)
}

fn build_tray_menu<R: Runtime>(app: &AppHandle<R>, always_on_top: bool) -> tauri::Result<Menu<R>> {
    let show_main =
        MenuItem::with_id(app, "tray:show-main", "Show Tide-Bot", true, None::<&str>)?;
    let toggle_companion = MenuItem::with_id(
        app,
        "tray:toggle-companion",
        "Show or Hide Ted-Bot",
        true,
        None::<&str>,
    )?;
    let always_on_top_item = CheckMenuItem::with_id(
        app,
        "tray:always-on-top",
        "Always on Top",
        true,
        always_on_top,
        None::<&str>,
    )?;
    let sign_out_item =
        MenuItem::with_id(app, "tray:sign-out", "Sign Out", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "tray:quit", "Quit", true, None::<&str>)?;
    Menu::with_items(
        app,
        &[
            &show_main,
            &toggle_companion,
            &always_on_top_item,
            &PredefinedMenuItem::separator(app)?,
            &sign_out_item,
            &PredefinedMenuItem::separator(app)?,
            &quit_item,
        ],
    )
}

fn handle_tray_menu_event<R: Runtime>(app: &AppHandle<R>, event: &MenuEvent) {
    let id = event.id().0.as_str().to_string();
    match id.as_str() {
        "tray:show-main" => {
            if let Ok(main) = main_window_ref(app) {
                let _ = main.show();
                let _ = main.set_focus();
            }
        }
        "tray:toggle-companion" => {
            if let Some(window) = app.get_webview_window(COMPANION_LABEL) {
                if window.is_visible().unwrap_or(false) {
                    let _ = window.hide();
                } else {
                    let _ = window.show();
                }
            }
        }
        "tray:always-on-top" => {
            if let Some(window) = app.get_webview_window(COMPANION_LABEL) {
                let _ = window.set_always_on_top(true);
            }
        }
        "tray:sign-out" => {
            let _ = sign_out(app);
        }
        "tray:quit" => app.exit(0),
        _ => {}
    }
}

fn handle_main_close<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_LABEL) {
        let _ = window.hide();
    }
}

fn handle_companion_close<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(COMPANION_LABEL) {
        let _ = window.hide();
    }
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            let menu = build_tray_menu(&handle, true)?;

            let _icon = tauri::image::Image::from_bytes(&[])
                .ok()
                .or_else(|| {
                    app.path()
                        .resolve("icons/tray.png", tauri::path::BaseDirectory::Resource)
                        .ok()
                        .and_then(|path| tauri::image::Image::from_path(&path).ok())
                });

            TrayIconBuilder::with_id("tide-bot-main-tray")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| handle_tray_menu_event(app, &event))
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let _ = tray.app_handle().emit("tray:show-main", ());
                    }
                })
                .build(app)?;

            let _ = companion_window(&handle)?;

            let bounds = placement::detect_initial_monitor(&handle);
            if let Ok(bounds) = bounds {
                let _ = placement::save_placement(&handle, &bounds, false);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                match window.label() {
                    MAIN_LABEL => handle_main_close(window.app_handle()),
                    COMPANION_LABEL => handle_companion_close(window.app_handle()),
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![show_main_window])
        .run(tauri::generate_context!())
        .expect("error while running tide-bot desktop application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placement_clamp_works() {
        let bounds = MonitorBounds {
            x: 0,
            y: 0,
            width: 1440,
            height: 900,
        };
        assert_eq!(clamp_to_monitor(&bounds, 9000, 9000, (380, 520)), (1060, 380));
    }
}