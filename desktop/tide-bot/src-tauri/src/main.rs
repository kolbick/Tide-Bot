// Windows: hide the release-mode console when launching the desktop shell.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tide_bot::run();
}
