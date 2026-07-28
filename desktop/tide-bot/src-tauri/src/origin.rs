use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::sync::LazyLock;

const COMPILED_NONCE: &str = env!("TIDE_BOT_DESKTOP_GENERATION_NONCE");
const COMPILED_REMOTE_URLS: &str = env!("TIDE_BOT_DESKTOP_REMOTE_URLS");
const CAPABILITY_DOC: &str = include_str!("../capabilities/companion.json");
const PROVENANCE_DOC: &str = include_str!("../generated/desktop-origin-provenance.json");
const RESOLVER_DOC: &str = include_str!("../../scripts/desktop-origins.mjs");
const TEMPLATE_DOC: &str = include_str!("../templates/companion.capability.template.json");
const PROVENANCE_SCHEMA: &str = "tide-bot-desktop-origins/v1";

#[derive(Debug, Deserialize, Clone)]
pub struct ProvenanceFixture {
	#[serde(rename = "schemaVersion")]
	pub schema_version: String,
	#[serde(rename = "resolverSha256")]
	pub resolver_sha256: String,
	#[serde(rename = "templateSha256")]
	pub template_sha256: String,
	#[serde(rename = "capabilitySha256")]
	pub capability_sha256: String,
	#[serde(rename = "normalizedOriginsHash")]
	pub normalized_origins_hash: String,
	#[serde(rename = "generationNonce")]
	pub generation_nonce: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct CapabilitiesFixture {
	pub windows: Vec<String>,
	pub permissions: Vec<String>,
	pub remote: RemoteBlock,
}

#[derive(Debug, Deserialize, Clone)]
pub struct RemoteBlock {
	pub urls: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct UrlFixture {
	pub raw: String,
	pub scheme: String,
	pub host: String,
	pub canonical_origin: String,
}

#[derive(Debug, Clone)]
pub struct RemoteUrls {
	pub urls: Vec<String>,
	pub normalized_hash: String,
}

fn sha256_hex(bytes: &[u8]) -> String {
	let mut hasher = Sha256::new();
	hasher.update(bytes);
	hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect()
}

fn parse_origin_string(raw: &str) -> Result<UrlFixture, String> {
	let parsed = url::Url::parse(raw).map_err(|error| format!("origin '{raw}' is not parseable: {error}"))?;
	if !matches!(parsed.scheme(), "http" | "https") {
		return Err(format!("origin '{raw}' must use http or https"));
	}
	if !parsed.username().is_empty() || parsed.password().is_some() {
		return Err(format!("origin '{raw}' must not contain credentials"));
	}
	if parsed.query().is_some() || parsed.fragment().is_some() || !matches!(parsed.path(), "" | "/") {
		return Err(format!("origin '{raw}' must have no query, fragment, or non-root path"));
	}
	let host = parsed.host_str().ok_or_else(|| format!("origin '{raw}' is missing a host"))?;
	let host = host.to_ascii_lowercase();
	if host.is_empty() || host == "*" || host.starts_with("*.") || host == "0.0.0.0" {
		return Err(format!("origin '{raw}' has a forbidden host"));
	}
	let loopback = matches!(host.as_str(), "127.0.0.1" | "localhost" | "::1");
	if parsed.scheme() == "http" && !loopback {
		return Err(format!("origin '{raw}' http host must be loopback"));
	}
	if parsed.scheme() == "https" && loopback {
		return Err(format!("origin '{raw}' loopback host must use http"));
	}
	let port = parsed.port().map(|port| format!(":{port}")).unwrap_or_default();
	Ok(UrlFixture {
		raw: raw.to_owned(),
		scheme: parsed.scheme().to_owned(),
		host: host.clone(),
		canonical_origin: format!("{}://{host}{port}", parsed.scheme()),
	})
}

pub fn parse_for_fixtures(
	capability_bytes: &str,
	provenance_bytes: &str,
	expected_nonce: &str,
) -> Result<(CapabilitiesFixture, ProvenanceFixture, RemoteUrls), String> {
	if expected_nonce.is_empty() {
		return Err("expected nonce is empty".into());
	}
	let capability: CapabilitiesFixture = serde_json::from_str(capability_bytes)
		.map_err(|error| format!("capability JSON is invalid: {error}"))?;
	// The companion is a borderless, transparent window with no title bar, so
	// the two core:window permissions below are what let the user move it and
	// put it away at all — dragging by its own content and hiding itself.
	// Both are scoped to the companion window by the capability's `windows`
	// list and neither widens the command surface, which is what this check
	// exists to constrain.
	const ALLOWED_PERMISSIONS: [&str; 3] = [
		"allow-show-main-window",
		"core:window:allow-start-dragging",
		"core:window:allow-hide",
	];
	if capability.windows != ["companion"] || capability.permissions != ALLOWED_PERMISSIONS {
		return Err("capability scope is not companion-only".into());
	}
	let provenance: ProvenanceFixture = serde_json::from_str(provenance_bytes)
		.map_err(|error| format!("provenance JSON is invalid: {error}"))?;
	if provenance.schema_version != PROVENANCE_SCHEMA || provenance.generation_nonce != expected_nonce {
		return Err("provenance schema or nonce mismatch".into());
	}
	if provenance.resolver_sha256 != sha256_hex(RESOLVER_DOC.as_bytes()) {
		return Err("resolver digest mismatch".into());
	}
	if provenance.template_sha256 != sha256_hex(TEMPLATE_DOC.as_bytes()) {
		return Err("template digest mismatch".into());
	}
	if provenance.capability_sha256 != sha256_hex(capability_bytes.as_bytes()) {
		return Err("capability digest mismatch".into());
	}
	if capability.remote.urls.is_empty() || capability.remote.urls.len() > 2 {
		return Err("remote.urls must contain one or two origins".into());
	}
	for (index, raw) in capability.remote.urls.iter().enumerate() {
		let parsed = parse_origin_string(raw)?;
		if index == 0 && parsed.scheme != "https" {
			return Err("production origin must be first and https".into());
		}
		if index == 1 && parsed.scheme != "http" {
			return Err("development origin must be loopback http".into());
		}
	}
	let normalized_hash = sha256_hex(serde_json::to_string(&capability.remote.urls).unwrap().as_bytes());
	if provenance.normalized_origins_hash != normalized_hash {
		return Err("normalized origins digest mismatch".into());
	}
	Ok((capability.clone(), provenance, RemoteUrls { urls: capability.remote.urls, normalized_hash }))
}

static COMPILED_REMOTE: LazyLock<Result<RemoteUrls, String>> = LazyLock::new(|| {
	let (_, _, remote) = parse_for_fixtures(CAPABILITY_DOC, PROVENANCE_DOC, COMPILED_NONCE)?;
	let compiled_urls: Vec<String> = COMPILED_REMOTE_URLS.split('|').filter(|value| !value.is_empty()).map(str::to_owned).collect();
	if compiled_urls != remote.urls {
		return Err("compiled remote URL binding diverges from generated capability".into());
	}
	Ok(remote)
});

pub fn configured_companion_url() -> tauri::Result<url::Url> {
	let remote = COMPILED_REMOTE.as_ref().map_err(|error| tauri::Error::AssetNotFound(error.clone()))?;
	let origin = remote.urls.first().ok_or_else(|| tauri::Error::AssetNotFound("production origin missing".into()))?;
	let parsed = parse_origin_string(origin).map_err(tauri::Error::AssetNotFound)?;
	url::Url::parse(&format!("{}/companion", parsed.canonical_origin)).map_err(|error| tauri::Error::AssetNotFound(error.to_string()))
}

pub fn configured_auth_url() -> tauri::Result<url::Url> {
	let remote = COMPILED_REMOTE.as_ref().map_err(|error| tauri::Error::AssetNotFound(error.clone()))?;
	let origin = remote.urls.first().ok_or_else(|| tauri::Error::AssetNotFound("production origin missing".into()))?;
	let parsed = parse_origin_string(origin).map_err(tauri::Error::AssetNotFound)?;
	url::Url::parse(&format!("{}/auth", parsed.canonical_origin)).map_err(|error| tauri::Error::AssetNotFound(error.to_string()))
}

pub fn configured_main_url() -> tauri::Result<url::Url> {
	let remote = COMPILED_REMOTE.as_ref().map_err(|error| tauri::Error::AssetNotFound(error.clone()))?;
	let origin = remote.urls.first().ok_or_else(|| tauri::Error::AssetNotFound("production origin missing".into()))?;
	let parsed = parse_origin_string(origin).map_err(tauri::Error::AssetNotFound)?;
	url::Url::parse(&format!("{}/", parsed.canonical_origin)).map_err(|error| tauri::Error::AssetNotFound(error.to_string()))
}

pub fn configured_remote_urls_json() -> Value {
	match &*COMPILED_REMOTE {
		Ok(remote) => serde_json::json!(remote.urls),
		Err(_) => Value::Array(Vec::new()),
	}
}
