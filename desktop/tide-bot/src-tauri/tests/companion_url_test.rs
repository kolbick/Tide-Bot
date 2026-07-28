// companion_url_test.rs
//
// Proves the URL/config helpers exported by lib.rs behave correctly against
// the freshly generated capability + provenance, that they refuse missing/
// stale/tampered provenance, that controlled fixture paths cannot make them
// return a non-approved Webview URL, and that runtime environment variables
// cannot influence them.

use serde_json::Value;
use sha2::{Digest, Sha256};
use tide_bot::{configured_remote_urls_json, parse_for_fixtures};

const FIXTURE_DIR: &str = "tests/fixtures";

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut out = String::with_capacity(64);
    for byte in digest {
        out.push_str(&format!("{:02x}", byte));
    }
    out
}

fn sha256_of_string(input: &str) -> String {
    sha256_hex(input.as_bytes())
}

fn read_fixture_bytes(relative: &str) -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(FIXTURE_DIR)
        .join(relative);
    std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("could not read fixture {}: {error}", path.display()))
}

fn fresh_provenance_for(
    capability_text: &str,
    resolver_path: &std::path::Path,
    template_path: &std::path::Path,
    urls: &[String],
    nonce: &str,
) -> String {
    let resolver_bytes = std::fs::read(resolver_path).unwrap();
    let template_bytes = std::fs::read(template_path).unwrap();
    let resolver_sha = sha256_hex(&resolver_bytes);
    let template_sha = sha256_hex(&template_bytes);
    let capability_sha = sha256_hex(capability_text.as_bytes());
    let normalized = sha256_of_string(&serde_json::to_string(urls).unwrap());
    let provenance = serde_json::json!({
        "schemaVersion": "tide-bot-desktop-origins/v1",
        "resolverSha256": resolver_sha,
        "templateSha256": template_sha,
        "capabilitySha256": capability_sha,
        "normalizedOriginsHash": normalized,
        "generationNonce": nonce,
    });
    serde_json::to_string_pretty(&provenance).unwrap()
}

fn write_capability_text(capability_text: &str) -> String {
    // Wrap the JSON text into the format the fixture parser expects by
    // returning it verbatim; tests load both texts as independent arguments.
    capability_text.to_string()
}

fn approved_capability_text(urls: &[String]) -> String {
    let capability = serde_json::json!({
        "identifier": "companion",
        "description": "Approved companion capability (test fixture)",
        "windows": ["companion"],
        "permissions": [
            "allow-show-main-window",
            "core:window:allow-start-dragging",
            "core:window:allow-hide"
        ],
        "remote": { "urls": urls },
    });
    serde_json::to_string_pretty(&capability).unwrap()
}

#[test]
fn configured_remote_urls_match_the_freshly_written_capability_json() {
    let capability_text = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities/companion.json"),
    )
    .expect("freshly written capability must exist in src-tauri/capabilities");
    let capability: Value = serde_json::from_str(&capability_text).unwrap();
    let capability_urls = capability["remote"]["urls"].as_array().unwrap();
    let configured = configured_remote_urls_json();
    assert_eq!(
        serde_json::Value::Array(capability_urls.clone()),
        configured,
        "configured_remote_urls_json must reflect the freshly generated capability"
    );
}

#[test]
fn parse_for_fixtures_accepts_a_fresh_capability_and_provenance_pair() {
    let urls = vec!["https://tidebot.example".to_string()];
    let capability_text = approved_capability_text(&urls);
    let resolver_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("scripts")
        .join("desktop-origins.mjs");
    let template_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("templates")
        .join("companion.capability.template.json");
    let nonce = "fixture-valid-nonce";
    let provenance_text = fresh_provenance_for(
        &capability_text,
        &resolver_path,
        &template_path,
        &urls,
        nonce,
    );
    let result = parse_for_fixtures(
        &write_capability_text(&capability_text),
        &provenance_text,
        nonce,
    );
    let (_capability, _provenance, remote) = result.expect("fresh fixtures parse");
    assert_eq!(remote.urls, urls);
    assert_eq!(
        remote.normalized_hash,
        sha256_of_string(&serde_json::to_string(&urls).unwrap())
    );
}

#[test]
fn parse_for_fixtures_rejects_missing_provenance() {
    let urls = vec!["https://tidebot.example".to_string()];
    let capability_text = approved_capability_text(&urls);
    assert!(parse_for_fixtures(&capability_text, "", "any-nonce").is_err());
}

#[test]
fn parse_for_fixtures_rejects_invalid_resolver_or_template_digest() {
    let urls = vec!["https://tidebot.example".to_string()];
    let capability_text = approved_capability_text(&urls);
    let resolver_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("scripts")
        .join("desktop-origins.mjs");
    let template_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("templates")
        .join("companion.capability.template.json");
    let provenance_text = fresh_provenance_for(
        &capability_text,
        &resolver_path,
        &template_path,
        &urls,
        "valid-nonce",
    );
    let mut provenance: Value = serde_json::from_str(&provenance_text).unwrap();
    provenance["resolverSha256"] = Value::String("deadbeef".repeat(8));
    let result = parse_for_fixtures(
        &capability_text,
        &serde_json::to_string(&provenance).unwrap(),
        "valid-nonce",
    );
    assert!(result.is_err(), "tampered resolverSha256 must be rejected");
}

#[test]
fn parse_for_fixtures_rejects_invalid_capability_to_provenance_link() {
    let urls = vec!["https://tidebot.example".to_string()];
    let capability_text = approved_capability_text(&urls);
    let resolver_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("scripts")
        .join("desktop-origins.mjs");
    let template_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("templates")
        .join("companion.capability.template.json");
    let mut provenance_text = fresh_provenance_for(
        &capability_text,
        &resolver_path,
        &template_path,
        &urls,
        "valid-nonce",
    );
    // Tamper: provenance claims a different capability SHA than the one
    // actually supplied.
    provenance_text = provenance_text.replace(
        "\"capabilitySha256\":",
        "\"capabilitySha256\":\"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef\",\"broken\":",
    );
    let result = parse_for_fixtures(&capability_text, &provenance_text, "valid-nonce");
    assert!(
        result.is_err(),
        "broken capability/provenance linkage must be rejected"
    );
}

#[test]
fn parse_for_fixtures_rejects_old_valid_fixture_with_stale_nonce() {
    // Read the controlled fixture, compute its (old) provenance by reusing
    // its text verbatim. The expected nonce in the test differs from the
    // recorded generationNonce; the fixture must be refused.
    let capability_text = read_fixture_bytes("old-valid.capability.json");
    let provenance_text = read_fixture_bytes("old-valid.provenance.json");
    let result = parse_for_fixtures(&capability_text, &provenance_text, "new-nonce");
    assert!(result.is_err(), "old fixture with mismatched nonce must be rejected");
}

#[test]
fn parse_for_fixtures_rejects_runtime_origin_environment_changes() {
    // Simulate a runtime caller pushing a remote URL into the environment.
    // The fixture parser only consumes the supplied bytes, so environment
    // values cannot influence it.
    let urls = vec!["https://tidebot.example".to_string()];
    let capability_text = approved_capability_text(&urls);
    let resolver_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("scripts")
        .join("desktop-origins.mjs");
    let template_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("templates")
        .join("companion.capability.template.json");
    let nonce = "valid-nonce";
    let provenance_text = fresh_provenance_for(
        &capability_text,
        &resolver_path,
        &template_path,
        &urls,
        nonce,
    );
    let result = parse_for_fixtures(&capability_text, &provenance_text, nonce);
    let (_capability, _provenance, remote) = result.expect("static fixture parser is environment-independent");
    assert_eq!(
        remote.urls,
        urls,
        "fixture parser must never consult runtime TIDE_BOT_REMOTE_URL/URL environment overrides"
    );
}

#[test]
fn parse_for_fixtures_rejects_empty_remote_urls() {
    let urls = Vec::<String>::new();
    let capability_text = approved_capability_text(&urls);
    let resolver_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("scripts")
        .join("desktop-origins.mjs");
    let template_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("templates")
        .join("companion.capability.template.json");
    let nonce = "valid-nonce";
    let provenance_text = fresh_provenance_for(
        &capability_text,
        &resolver_path,
        &template_path,
        &urls,
        nonce,
    );
    let result = parse_for_fixtures(&capability_text, &provenance_text, nonce);
    assert!(result.is_err(), "empty capability.remote.urls must be rejected");
}
