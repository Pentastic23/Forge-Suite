//! Optional AI coloring through OpenAI's image API, as in Sprite Foundry.
//!
//! It is off until the person adds their own API key. The key is kept in the
//! Windows Credential Manager (encrypted for this Windows user), is never sent
//! back to the window, and only ever goes to api.openai.com.

use serde::{Deserialize, Serialize};
use std::time::Duration;

const SERVICE: &str = "ForgeSuite.PixelForge";
const ACCOUNT: &str = "openai-api-key";
const ENDPOINT: &str = "https://api.openai.com/v1/images/edits";
pub const SIZES: [&str; 3] = ["1024x1024", "1024x1536", "1536x1024"];
pub const QUALITIES: [&str; 3] = ["low", "medium", "high"];
pub const DEFAULT_MODEL: &str = "gpt-image-1";

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("Windows couldn't open its credential store: {e}"))
}

/// OpenAI keys start with "sk-" and are long; this catches pasting the wrong thing.
pub fn looks_like_key(key: &str) -> bool {
    key.len() >= 23 && key.starts_with("sk-") && key[3..].chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn has_key() -> bool {
    read_key().is_some()
}

fn read_key() -> Option<String> {
    entry().ok()?.get_password().ok().filter(|k| !k.is_empty())
}

pub fn set_key(key: &str) -> Result<(), String> {
    let key = key.trim();
    if !looks_like_key(key) {
        return Err("That doesn't look like an OpenAI API key (they start with \"sk-\")".into());
    }
    entry()?.set_password(key).map_err(|e| format!("Windows couldn't save the key: {e}"))
}

pub fn clear_key() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Windows couldn't remove the key: {e}")),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorRequest {
    /// The sketch, base64 PNG.
    pub png: String,
    pub prompt: String,
    #[serde(default)]
    pub size: String,
    #[serde(default)]
    pub quality: String,
    #[serde(default)]
    pub model: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorResult {
    /// The colored image, base64 PNG.
    pub png: String,
    /// True when no request was made (test mode in development builds).
    pub mock: bool,
}

pub fn clean_quality(q: &str) -> &'static str {
    QUALITIES.iter().find(|x| **x == q).copied().unwrap_or("medium")
}

/// The values actually sent: anything unknown falls back to a safe default.
pub fn clean(req: &ColorRequest) -> (String, &'static str, &'static str, String) {
    let size = SIZES.iter().find(|s| **s == req.size).copied().unwrap_or(SIZES[0]);
    let quality = clean_quality(&req.quality);
    let model = req.model.trim();
    let model = if model.is_empty() || model.len() > 64 { DEFAULT_MODEL.to_string() } else { model.to_string() };
    let prompt: String = req.prompt.chars().take(4000).collect();
    (prompt, size, quality, model)
}

/// Pulls the image (or OpenAI's own error message) out of a response body.
pub fn read_response(status: u16, body: &serde_json::Value) -> Result<String, String> {
    if !(200..300).contains(&status) {
        let msg = body["error"]["message"].as_str().map(str::to_string).unwrap_or_else(|| format!("OpenAI returned {status}"));
        return Err(msg);
    }
    body["data"][0]["b64_json"].as_str().map(str::to_string).ok_or_else(|| "OpenAI didn't return an image".to_string())
}

pub async fn color_sketch(req: ColorRequest) -> Result<ColorResult, String> {
    use base64::Engine;
    let png = base64::engine::general_purpose::STANDARD.decode(&req.png).map_err(|_| "The sketch couldn't be read".to_string())?;
    if req.prompt.trim().is_empty() {
        return Err("Nothing to send".into());
    }
    // PIXELFORGE_AI_MOCK=1 in a development build answers with the sketch itself, so the app can be tried without paying.
    if cfg!(debug_assertions) && std::env::var("PIXELFORGE_AI_MOCK").as_deref() == Ok("1") {
        tokio_sleep(Duration::from_millis(300)).await;
        return Ok(ColorResult { png: req.png, mock: true });
    }
    let key = read_key().ok_or("Add your OpenAI API key first")?;
    let (prompt, size, quality, model) = clean(&req);
    let image = reqwest::multipart::Part::bytes(png).file_name("sketch.png").mime_str("image/png").map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .text("model", model)
        .part("image", image)
        .text("prompt", prompt)
        .text("size", size)
        .text("quality", quality)
        .text("background", "transparent")
        .text("n", "1");
    let client = reqwest::Client::builder().timeout(Duration::from_secs(180)).build().map_err(|e| e.to_string())?;
    let res = client.post(ENDPOINT).bearer_auth(key).multipart(form).send().await.map_err(|e| {
        if e.is_timeout() {
            "OpenAI took too long to answer. Try again, or use a lower quality".to_string()
        } else {
            format!("Couldn't reach OpenAI: {e}")
        }
    })?;
    let status = res.status().as_u16();
    let body: serde_json::Value = res.json().await.unwrap_or(serde_json::Value::Null);
    Ok(ColorResult { png: read_response(status, &body)?, mock: false })
}

async fn tokio_sleep(d: Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(d)).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_keys() {
        assert!(looks_like_key("sk-proj-abcdefghijklmnopqrstuvwxyz_0123"));
        assert!(!looks_like_key("sk-short"));
        assert!(!looks_like_key("pk-abcdefghijklmnopqrstuvwxyz"));
        assert!(!looks_like_key("sk-abcdefghijklmnop qrstuvwxyz"));
    }

    #[test]
    fn cleans_requests() {
        let req = ColorRequest { png: String::new(), prompt: "x".repeat(5000), size: "4096x4096".into(), quality: "ultra".into(), model: " ".into() };
        let (prompt, size, quality, model) = clean(&req);
        assert_eq!((prompt.len(), size, quality, model.as_str()), (4000, "1024x1024", "medium", DEFAULT_MODEL));
        let req = ColorRequest { png: String::new(), prompt: "hi".into(), size: "1024x1536".into(), quality: "high".into(), model: "gpt-image-1.5".into() };
        let (_, size, quality, model) = clean(&req);
        assert_eq!((size, quality, model.as_str()), ("1024x1536", "high", "gpt-image-1.5"));
    }

    #[test]
    fn reads_responses() {
        assert_eq!(read_response(200, &serde_json::json!({"data": [{"b64_json": "QUJD"}]})), Ok("QUJD".to_string()));
        assert_eq!(read_response(401, &serde_json::json!({"error": {"message": "Incorrect API key provided"}})), Err("Incorrect API key provided".to_string()));
        assert_eq!(read_response(500, &serde_json::Value::Null), Err("OpenAI returned 500".to_string()));
        assert!(read_response(200, &serde_json::json!({"data": []})).is_err());
    }
}
