// placement.rs: companion window placement persistence.
//
// The companion window is a small translucent overlay (380x520). On launch
// we clamp the persisted (monitor, x, y) into the current work area so it
// never opens off-screen, then persist only non-sensitive fields (monitor id,
// x, y, expanded flag). No chat IDs, message content, tokens, or credentials
// ever flow through this module.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct MonitorBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Placement {
    pub monitor_id: String,
    pub x: i32,
    pub y: i32,
    pub expanded: bool,
}

/// Clamp the persisted (x, y) into the supplied monitor's work area, given
/// the window's interior size (width, height). When the saved position falls
/// outside the monitor we move the window far enough inward so its top-left
/// can be at most `(monitor.x + monitor.width - window.width, monitor.y +
/// monitor.height - window.height)`.
pub fn clamp_to_monitor(monitor: &MonitorBounds, saved_x: i32, saved_y: i32, window_size: (u32, u32)) -> (i32, i32) {
    let (window_w, window_h) = window_size;
    let mut x = saved_x;
    let mut y = saved_y;
    let max_x = monitor.x.saturating_add(monitor.width as i32).saturating_sub(window_w as i32);
    let max_y = monitor.y.saturating_add(monitor.height as i32).saturating_sub(window_h as i32);
    if x > max_x {
        x = max_x.max(monitor.x);
    }
    if x < monitor.x {
        x = monitor.x;
    }
    if y > max_y {
        y = max_y.max(monitor.y);
    }
    if y < monitor.y {
        y = monitor.y;
    }
    (x, y)
}

/// Persist only the monitor ID, x/y position, and expanded state. The caller
/// supplies the monitor identity and current top-left; no chat or credential
/// data is accepted by this boundary.
pub fn save_placement<R: Runtime>(app: &AppHandle<R>, monitor: &MonitorBounds, expanded: bool) -> Result<(), String> {
    let path = placement_path(app).map_err(|error| format!("placement path resolution failed: {error}"))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("placement dir create failed: {error}"))?;
    }
    let placement = Placement {
        monitor_id: describe_monitor(monitor),
        x: monitor.x,
        y: monitor.y,
        expanded,
    };
    let body = serde_json::to_string_pretty(&placement).map_err(|error| format!("placement serialize failed: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, body).map_err(|error| format!("placement write failed: {error}"))?;
    std::fs::rename(&temporary, &path).map_err(|error| format!("placement replace failed: {error}"))?;
    Ok(())
}

pub fn load_placement<R: Runtime>(app: &AppHandle<R>) -> Result<Option<Placement>, String> {
    let path = placement_path(app).map_err(|error| format!("placement path resolution failed: {error}"))?;
    if !path.is_file() {
        return Ok(None);
    }
    let body = std::fs::read_to_string(&path).map_err(|error| format!("placement read failed: {error}"))?;
    let placement: Placement = serde_json::from_str(&body).map_err(|error| format!("placement parse failed: {error}"))?;
    Ok(Some(placement))
}

fn placement_path<R: Runtime>(_app: &AppHandle<R>) -> Result<PathBuf, String> {
    let candidates: [Option<PathBuf>; 3] = [
        dirs::config_local_dir(),
        dirs::config_dir(),
        dirs::home_dir().map(|home| home.join(".config")),
    ];
    for candidate in candidates.into_iter().flatten() {
        return Ok(candidate.join("Tide-Bot").join("companion-placement.json"));
    }
    Err("could not resolve a configuration directory".into())
}

pub fn detect_initial_monitor<R: Runtime>(app: &AppHandle<R>) -> Result<MonitorBounds, String> {
    let monitor = app
        .primary_monitor()
        .map_err(|error| format!("primary monitor lookup failed: {error}"))?
        .ok_or_else(|| "primary monitor is unavailable".to_string())?;
    let position = monitor.position();
    let size = monitor.size();
    Ok(MonitorBounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

fn describe_monitor(monitor: &MonitorBounds) -> String {
    format!("{}x{}+{}+{}", monitor.width, monitor.height, monitor.x, monitor.y)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_off_screen_x_to_inside_work_area() {
        let monitor = MonitorBounds {
            x: 0,
            y: 0,
            width: 1440,
            height: 900,
        };
        // 9000 is way beyond the work area; clamped to 1440 - 380 = 1060 with the same y.
        assert_eq!(clamp_to_monitor(&monitor, 9000, 9000, (380, 520)), (1060, 380));
    }
}
