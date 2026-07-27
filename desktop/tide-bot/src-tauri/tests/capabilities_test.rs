// capabilities_test.rs
//
// Executable Cargo integration test that parses the freshly generated
// `capabilities/companion.json` plus the tracked `permissions/companion.toml`
// into typed values and asserts the exact shape required by the brief:
//   * windows == ["companion"]
//   * the sole capability permission reference is the unprefixed
//     "allow-show-main-window"
//   * remote.urls equals the compiled/resolved production origin plus the
//     optional development loopback origin
//   * [[permission]] has exactly one entry whose identifier is
//     "allow-show-main-window" and commands.allow is exactly
//     ["show_main_window"]
//   * the parsed permission grant excludes filesystem, shell, process,
//     credential bridge, arbitrary navigation, eval, and `core:default`
//   * the build/AppManifest contract registers only `show_main_window`

use serde_json::Value;
use tide_bot::configured_remote_urls_json;

const FORBIDDEN_CAPABILITY_KEYS: &[&str] = &[
    "core:default",
    "core:event:allow-listen",
    "core:event:allow-unlisten",
    "core:event:allow-emit",
    "core:event:allow-emit-to",
    "core:path:default",
    "core:app:default",
    "fs:default",
    "fs:allow-read-text-file",
    "fs:allow-write-text-file",
    "shell:allow-open",
    "shell:allow-execute",
    "process:allow-execute",
    "process:allow-spawn",
    "process:allow-kill",
    "http:default",
    "notification:default",
    "os:default",
    "dialog:default",
    "store:default",
    "updater:default",
    "clipboard-manager:allow-write-text",
    "autostart:default",
    "deep-link:default",
];

const FORBIDDEN_CAPABILITY_FRAGMENTS: &[&str] = &[
    "fs:",
    "shell:",
    "process:",
    "credential",
    "nav",
    "://navigation",
    "://eval",
];

fn fail(capability: &Value, message: &str) {
    panic!(
        "{}\nGenerated capability:\n{}",
        message,
        serde_json::to_string_pretty(capability).unwrap_or_else(|_| "<unprintable>".to_string())
    );
}

/// The brief's helper: scan the parsed capability JSON for any granted
/// permission that would expose filesystem, shell, process, credential,
/// arbitrary navigation, eval, or `core:default` to the companion webview.
fn assert_no_forbidden_capabilities(capability: &Value, _permission_entry: &toml::Value) {
    let permissions = capability
        .get("permissions")
        .and_then(Value::as_array)
        .expect("permissions array");
    for entry in permissions {
        let value = entry
            .as_str()
            .unwrap_or_else(|| panic!("permission entry must be a string: {entry}"));
        if value.starts_with("core:default") {
            fail(capability, &format!("forbidden capability permission: {value}"));
        }
        if FORBIDDEN_CAPABILITY_KEYS.contains(&value) {
            fail(capability, &format!("forbidden capability permission: {value}"));
        }
        for fragment in FORBIDDEN_CAPABILITY_FRAGMENTS {
            if value.contains(fragment) {
                fail(
                    capability,
                    &format!("forbidden capability permission fragment '{fragment}' present in '{value}'"),
                );
            }
        }
    }
}

/// The brief's helper: confirm the build/AppManifest contract registers
/// exactly one command (`show_main_window`) for the companion permission.
/// We inspect the tracked sources:
///   * `src/lib.rs` invokes `tauri::generate_handler![show_main_window]`
///     with exactly one `#[tauri::command]` declaration
///   * `permissions/companion.toml` only references `show_main_window` in its
///     `commands.allow` array
fn assert_build_rs_registers_only_show_main_window() {
    let lib_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src").join("lib.rs");
    let lib_text = std::fs::read_to_string(&lib_path)
        .unwrap_or_else(|error| panic!("could not read {}: {error}", lib_path.display()));
    let command_count = lib_text.matches("#[tauri::command]").count();
    assert_eq!(
        command_count, 1,
        "src/lib.rs must register exactly one #[tauri::command] function (got {command_count})"
    );
    assert!(
        lib_text.contains("#[tauri::command]\nfn show_main_window"),
        "src/lib.rs must declare #[tauri::command]\nfn show_main_window"
    );
    let handler_segment = lib_text
        .split_once("generate_handler!")
        .map(|(_, tail)| tail)
        .expect("src/lib.rs must call generate_handler!");
    let invocation = handler_segment
        .split_once(']')
        .map(|(head, _)| head)
        .unwrap_or(handler_segment);
    let trimmed = invocation.trim_start_matches('[').trim_start();
    assert_eq!(
        trimmed, "show_main_window",
        "generate_handler! must register exactly one command identifier; got '{trimmed}'"
    );
    let permission_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("permissions")
        .join("companion.toml");
    let permission_text = std::fs::read_to_string(&permission_path)
        .unwrap_or_else(|error| panic!("could not read {}: {error}", permission_path.display()));
    let permission: toml::Value = toml::from_str(&permission_text)
        .unwrap_or_else(|error| panic!("companion.toml is not parseable: {error}"));
    let entry = &permission["permission"]
        .as_array()
        .expect("[[permission]] array")[0];
    let allowed = entry["commands"]["allow"]
        .as_array()
        .expect("commands.allow");
    let allowed_strs: Vec<&str> = allowed.iter().filter_map(toml::Value::as_str).collect();
    assert_eq!(
        allowed_strs,
        vec!["show_main_window"],
        "permissions/companion.toml commands.allow must be exactly ['show_main_window']"
    );
}

fn assert_remote_urls_match_compiled(capability: &Value) {
    let capability_urls = capability
        .get("remote")
        .and_then(|remote| remote.get("urls"))
        .and_then(Value::as_array)
        .expect("remote.urls array");
    let expected = configured_remote_urls_json();
    assert_eq!(
        serde_json::Value::Array(capability_urls.clone()),
        expected,
        "capability.remote.urls must equal the compiled resolver output"
    );
}

#[test]
fn companion_capability_has_exact_remote_scope_and_one_custom_command() {
    let capability: Value = serde_json::from_str(include_str!("../capabilities/companion.json"))
        .expect("valid capability JSON");
    let permission: toml::Value =
        toml::from_str(include_str!("../permissions/companion.toml"))
            .expect("valid companion permission TOML");
    assert_eq!(
        capability["windows"],
        serde_json::json!(["companion"]),
        "capability.windows must be exactly [\"companion\"]"
    );
    assert_eq!(
        capability["permissions"],
        serde_json::json!(["allow-show-main-window"]),
        "capability.permissions must be exactly [\"allow-show-main-window\"]"
    );
    assert_remote_urls_match_compiled(&capability);

    let entries = permission["permission"]
        .as_array()
        .expect("[[permission]] array");
    assert_eq!(entries.len(), 1, "permissions/companion.toml must declare exactly one [[permission]] entry");
    let entry = &entries[0];
    assert_eq!(
        entry["identifier"].as_str(),
        Some("allow-show-main-window"),
        "permission.identifier must be exactly allow-show-main-window"
    );
    let allowed = entry["commands"]["allow"]
        .as_array()
        .expect("command allow-list");
    assert_eq!(
        allowed
            .iter()
            .map(toml::Value::as_str)
            .collect::<Vec<_>>(),
        vec![Some("show_main_window")],
        "permission.commands.allow must be exactly [\"show_main_window\"]"
    );

    assert_no_forbidden_capabilities(&capability, entry);
    assert_build_rs_registers_only_show_main_window();
}

#[test]
fn permission_is_not_a_path_or_shell_or_eval_token() {
    let permission: toml::Value = toml::from_str(include_str!("../permissions/companion.toml")).unwrap();
    let entry = &permission["permission"].as_array().unwrap()[0];
    let identifier = entry["identifier"].as_str().unwrap();
    assert!(!identifier.contains("path"));
    assert!(!identifier.contains("shell"));
    assert!(!identifier.contains("fs:"));
    assert!(!identifier.contains("eval"));
}

#[test]
fn remote_urls_are_canonical_https_or_loopback_http() {
    let capability: Value = serde_json::from_str(include_str!("../capabilities/companion.json")).unwrap();
    let urls = capability["remote"]["urls"].as_array().unwrap();
    let mut scheme_seen: Vec<&str> = Vec::new();
    let loopback_hosts = ["127.0.0.1", "localhost", "::1"];
    for url in urls {
        let text = url.as_str().unwrap();
        let parsed = url::Url::parse(text).expect("remote URL must parse");
        assert!(
            parsed.username().is_empty() && parsed.password().is_none(),
            "remote URL must have no credentials: {text}"
        );
        match parsed.scheme() {
            "https" => {
                let host_lower = parsed.host_str().unwrap_or("").to_ascii_lowercase();
                assert!(
                    !loopback_hosts.iter().any(|h| *h == host_lower),
                    "loopback hosts must not use https: {text}"
                );
                scheme_seen.push("https");
            }
            "http" => {
                let host_lower = parsed.host_str().unwrap_or("").to_ascii_lowercase();
                assert!(
                    loopback_hosts.iter().any(|h| *h == host_lower),
                    "http remote URLs must be loopback: {text}"
                );
                scheme_seen.push("http");
            }
            other => panic!("remote URL must be http or https; got {other} for {text}"),
        }
    }
    assert!(
        !scheme_seen.is_empty(),
        "remote.urls must contain at least the production origin"
    );
}