//! Art from a prompt: OpenAI's image API with the person's own key, or a
//! ComfyUI server they run themselves (usually on this PC, no key, nothing billed).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::{Duration, Instant};

use crate::keys;

const OPENAI_IMAGES: &str = "https://api.openai.com/v1/images/generations";
pub const SIZES: [&str; 4] = ["1024x1024", "1024x1536", "1536x1024", "auto"];
pub const QUALITIES: [&str; 4] = ["low", "medium", "high", "auto"];
pub const DEFAULT_MODEL: &str = "gpt-image-1";
pub const DEFAULT_COMFY: &str = "http://127.0.0.1:8188";
/// Slow cards (DirectML on AMD) can take minutes for one image.
const COMFY_WAIT: Duration = Duration::from_secs(15 * 60);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAIImageRequest {
    pub prompt: String,
    #[serde(default)]
    pub size: String,
    #[serde(default)]
    pub quality: String,
    #[serde(default)]
    pub model: String,
    /// A see-through background, for sprites and icons.
    #[serde(default)]
    pub transparent: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComfyImageRequest {
    #[serde(default)]
    pub url: String,
    pub prompt: String,
    #[serde(default)]
    pub negative: String,
    #[serde(default)]
    pub checkpoint: String,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    #[serde(default)]
    pub steps: u32,
    #[serde(default)]
    pub cfg: f64,
    #[serde(default)]
    pub seed: u64,
    /// The person's own workflow (ComfyUI "Save (API format)"), with %PROMPT% in it.
    #[serde(default)]
    pub workflow: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComfyInfo {
    pub url: String,
    pub checkpoints: Vec<String>,
}

/// A made image: PNG bytes and a note of where it came from.
pub struct Made {
    pub png: Vec<u8>,
    pub source: String,
}

fn mock_on() -> bool {
    cfg!(debug_assertions) && std::env::var("AIFORGE_AI_MOCK").as_deref() == Ok("1")
}

async fn pause(d: Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(d)).await;
}

// ---------------------------------------------------------------- OpenAI

pub fn openai_body(req: &OpenAIImageRequest) -> Value {
    let size = SIZES.iter().find(|s| **s == req.size).copied().unwrap_or(SIZES[0]);
    let quality = QUALITIES.iter().find(|q| **q == req.quality).copied().unwrap_or("medium");
    let model = req.model.trim();
    let model = if model.is_empty() || model.len() > 64 { DEFAULT_MODEL } else { model };
    let prompt: String = req.prompt.trim().chars().take(4000).collect();
    json!({
        "model": model, "prompt": prompt, "size": size, "quality": quality, "n": 1,
        "background": if req.transparent { "transparent" } else { "opaque" },
        "output_format": "png",
    })
}

/// Pulls the image (or OpenAI's own error message) out of a response body.
pub fn read_openai(status: u16, body: &Value) -> Result<String, String> {
    if !(200..300).contains(&status) {
        if status == 401 {
            return Err("OpenAI didn't accept the API key. Check it in Settings".into());
        }
        return Err(body["error"]["message"].as_str().map(str::to_string).unwrap_or_else(|| format!("OpenAI returned {status}")));
    }
    body["data"][0]["b64_json"].as_str().map(str::to_string).ok_or_else(|| "OpenAI didn't return an image".to_string())
}

pub async fn openai(req: OpenAIImageRequest) -> Result<Made, String> {
    use base64::Engine;
    if req.prompt.trim().is_empty() {
        return Err("Describe the image first".into());
    }
    if mock_on() {
        pause(Duration::from_millis(400)).await;
        return Ok(Made { png: test_png(&req.prompt), source: "test mode, nothing sent".into() });
    }
    let key = keys::read("openai").ok_or("Add your OpenAI API key in Settings first")?;
    let body = openai_body(&req);
    let client = reqwest::Client::builder().timeout(Duration::from_secs(240)).build().map_err(|e| e.to_string())?;
    let res = client.post(OPENAI_IMAGES).bearer_auth(key).json(&body).send().await.map_err(|e| {
        if e.is_timeout() {
            "OpenAI took too long to answer. Try again, or use a lower quality".to_string()
        } else {
            format!("Couldn't reach OpenAI: {e}")
        }
    })?;
    let status = res.status().as_u16();
    let v: Value = res.json().await.unwrap_or(Value::Null);
    let png = base64::engine::general_purpose::STANDARD.decode(read_openai(status, &v)?).map_err(|_| "OpenAI's image couldn't be read".to_string())?;
    Ok(Made { png, source: format!("OpenAI {}, {} quality", body["model"].as_str().unwrap_or(DEFAULT_MODEL), body["quality"].as_str().unwrap_or("medium")) })
}

// ---------------------------------------------------------------- ComfyUI

/// The server's address without a trailing slash; only http(s) is accepted.
pub fn comfy_base(url: &str) -> Result<String, String> {
    let url = url.trim();
    let url = if url.is_empty() { DEFAULT_COMFY } else { url };
    let url = if url.contains("://") { url.to_string() } else { format!("http://{url}") };
    let parsed = reqwest::Url::parse(&url).map_err(|_| format!("\"{url}\" isn't a web address"))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(format!("\"{url}\" isn't a web address"));
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("Give just ComfyUI's address, like http://127.0.0.1:8188".into());
    }
    Ok(parsed.as_str().trim_end_matches('/').to_string())
}

fn http(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(timeout).build().map_err(|e| e.to_string())
}

fn unreachable(base: &str, e: reqwest::Error) -> String {
    if e.is_connect() || e.is_timeout() {
        format!("ComfyUI isn't answering at {base}. Start it first, and check the address")
    } else {
        format!("Couldn't reach ComfyUI at {base}: {e}")
    }
}

pub fn read_checkpoints(info: &Value) -> Vec<String> {
    info["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"][0]
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_default()
}

pub async fn comfy_info(url: &str) -> Result<ComfyInfo, String> {
    let base = comfy_base(url)?;
    let res = http(Duration::from_secs(8))?.get(format!("{base}/object_info/CheckpointLoaderSimple")).send().await.map_err(|e| unreachable(&base, e))?;
    if !res.status().is_success() {
        return Err(format!("{base} answered {}, so it may not be ComfyUI", res.status().as_u16()));
    }
    let body: Value = res.json().await.map_err(|_| format!("{base} didn't answer like ComfyUI"))?;
    Ok(ComfyInfo { url: base, checkpoints: read_checkpoints(&body) })
}

pub async fn comfy_interrupt(url: &str) -> Result<(), String> {
    let base = comfy_base(url)?;
    http(Duration::from_secs(8))?.post(format!("{base}/interrupt")).send().await.map_err(|e| unreachable(&base, e))?;
    Ok(())
}

/// Sides that suit Stable Diffusion: a multiple of 64 between 256 and 2048.
fn side(v: u32) -> u32 {
    let v = if v == 0 { 512 } else { v.clamp(256, 2048) };
    (v + 32) / 64 * 64
}

/// The built-in workflow: text to image with one checkpoint.
pub fn builtin_workflow(req: &ComfyImageRequest) -> Value {
    let steps = if req.steps == 0 { 24 } else { req.steps.clamp(4, 80) };
    let cfg = if req.cfg > 0.0 { req.cfg.clamp(1.0, 20.0) } else { 7.0 };
    json!({
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": req.checkpoint}},
        "2": {"class_type": "EmptyLatentImage", "inputs": {"width": side(req.width), "height": side(req.height), "batch_size": 1}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": req.prompt, "clip": ["1", 1]}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"text": req.negative, "clip": ["1", 1]}},
        "6": {"class_type": "KSampler", "inputs": {
            "seed": req.seed, "steps": steps, "cfg": cfg, "sampler_name": "euler_ancestral", "scheduler": "normal", "denoise": 1.0,
            "model": ["1", 0], "positive": ["4", 0], "negative": ["5", 0], "latent_image": ["2", 0]}},
        "7": {"class_type": "VAEDecode", "inputs": {"samples": ["6", 0], "vae": ["1", 2]}},
        "8": {"class_type": "SaveImage", "inputs": {"filename_prefix": "AIForge", "images": ["7", 0]}}
    })
}

/// Fills the person's workflow: %PROMPT%, %NEGATIVE% and %CHECKPOINT% inside text, and
/// %SEED%, %STEPS%, %CFG%, %WIDTH% and %HEIGHT% as numbers when they are a whole value.
pub fn fill_workflow(wf: &Value, req: &ComfyImageRequest) -> Result<Value, String> {
    if !wf.is_object() || wf.as_object().is_some_and(|o| o.is_empty()) {
        return Err("That workflow is empty. In ComfyUI use \"Save (API format)\"".into());
    }
    if wf.get("nodes").is_some() {
        return Err("That's the editor format. In ComfyUI use \"Save (API format)\" instead".into());
    }
    let mut found = false;
    let out = fill(wf, req, &mut found);
    if !found {
        return Err("Your workflow needs %PROMPT% where the prompt goes (a CLIPTextEncode node's text)".into());
    }
    Ok(out)
}

fn fill(v: &Value, req: &ComfyImageRequest, found: &mut bool) -> Value {
    match v {
        Value::String(s) => match s.as_str() {
            "%SEED%" => json!(req.seed),
            "%STEPS%" => json!(if req.steps == 0 { 24 } else { req.steps.clamp(4, 80) }),
            "%CFG%" => json!(if req.cfg > 0.0 { req.cfg } else { 7.0 }),
            "%WIDTH%" => json!(side(req.width)),
            "%HEIGHT%" => json!(side(req.height)),
            _ => {
                if s.contains("%PROMPT%") {
                    *found = true;
                }
                Value::String(s.replace("%PROMPT%", &req.prompt).replace("%NEGATIVE%", &req.negative).replace("%CHECKPOINT%", &req.checkpoint))
            }
        },
        Value::Array(a) => Value::Array(a.iter().map(|x| fill(x, req, found)).collect()),
        Value::Object(o) => Value::Object(o.iter().map(|(k, x)| (k.clone(), fill(x, req, found))).collect()),
        other => other.clone(),
    }
}

#[derive(Debug, PartialEq)]
pub enum Progress {
    Waiting,
    Failed(String),
    Done { filename: String, subfolder: String, kind: String },
}

pub fn read_history(id: &str, body: &Value) -> Progress {
    let Some(entry) = body.get(id) else { return Progress::Waiting };
    let status = &entry["status"];
    if status["status_str"] == "error" {
        let msgs = status["messages"].as_array().cloned().unwrap_or_default();
        let detail = msgs.iter().find_map(|m| match m[0].as_str() {
            Some("execution_interrupted") => Some("Stopped".to_string()),
            Some("execution_error") => {
                let node = m[1]["node_type"].as_str().unwrap_or("a node");
                let text = m[1]["exception_message"].as_str().unwrap_or("it failed").trim();
                Some(format!("ComfyUI stopped at {node}: {text}"))
            }
            _ => None,
        });
        return Progress::Failed(detail.unwrap_or_else(|| "ComfyUI couldn't finish the image".into()));
    }
    let mut images: Vec<&Value> = entry["outputs"].as_object().into_iter().flat_map(|o| o.values()).filter_map(|n| n["images"].as_array()).flatten().collect();
    images.sort_by_key(|i| i["type"] != "output");
    if let Some(img) = images.first() {
        return Progress::Done {
            filename: img["filename"].as_str().unwrap_or_default().to_string(),
            subfolder: img["subfolder"].as_str().unwrap_or_default().to_string(),
            kind: img["type"].as_str().unwrap_or("output").to_string(),
        };
    }
    if status["completed"] == true {
        return Progress::Failed("The workflow finished without an image. It needs a Save Image or Preview Image node".into());
    }
    Progress::Waiting
}

pub fn read_refusal(body: &Value) -> String {
    let mut msg = body["error"]["message"].as_str().unwrap_or("ComfyUI refused the workflow").trim_end_matches('.').to_string();
    if let Some((_, n)) = body["node_errors"].as_object().and_then(|o| o.iter().next()) {
        let class = n["class_type"].as_str().unwrap_or("a node");
        if let Some(e) = n["errors"][0].as_object() {
            let detail = e.get("details").and_then(|d| d.as_str()).filter(|d| !d.is_empty()).or_else(|| e.get("message").and_then(|d| d.as_str())).unwrap_or("");
            msg = format!("{msg}: {class} {detail}");
        }
    }
    msg
}

pub async fn comfy(req: ComfyImageRequest) -> Result<Made, String> {
    if req.prompt.trim().is_empty() {
        return Err("Describe the image first".into());
    }
    if mock_on() {
        pause(Duration::from_millis(400)).await;
        return Ok(Made { png: test_png(&req.prompt), source: "test mode, nothing sent".into() });
    }
    if req.workflow.is_none() && req.checkpoint.trim().is_empty() {
        return Err("Pick a checkpoint first (Connect lists the ones ComfyUI has)".into());
    }
    let base = comfy_base(&req.url)?;
    let client = http(Duration::from_secs(60))?;
    let workflow = match &req.workflow {
        Some(wf) => fill_workflow(wf, &req)?,
        None => builtin_workflow(&req),
    };
    let res = client.post(format!("{base}/prompt")).json(&json!({"prompt": workflow, "client_id": "ai-forge"})).send().await.map_err(|e| unreachable(&base, e))?;
    let ok = res.status().is_success();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if !ok {
        return Err(read_refusal(&body));
    }
    let id = body["prompt_id"].as_str().ok_or("ComfyUI didn't queue the workflow")?.to_string();
    let start = Instant::now();
    let (filename, subfolder, kind) = loop {
        if start.elapsed() > COMFY_WAIT {
            return Err("ComfyUI is still working after 15 minutes. The image may still appear in its output folder".into());
        }
        pause(Duration::from_millis(900)).await;
        let res = client.get(format!("{base}/history/{id}")).send().await.map_err(|e| unreachable(&base, e))?;
        let body: Value = res.json().await.unwrap_or(Value::Null);
        match read_history(&id, &body) {
            Progress::Waiting => continue,
            Progress::Failed(m) => return Err(m),
            Progress::Done { filename, subfolder, kind } => break (filename, subfolder, kind),
        }
    };
    let res = client
        .get(format!("{base}/view"))
        .query(&[("filename", filename.as_str()), ("subfolder", subfolder.as_str()), ("type", kind.as_str())])
        .send()
        .await
        .map_err(|e| unreachable(&base, e))?;
    if !res.status().is_success() {
        return Err(format!("ComfyUI made the image but didn't send it ({})", res.status().as_u16()));
    }
    let bytes = res.bytes().await.map_err(|e| e.to_string())?.to_vec();
    if !bytes.starts_with(b"\x89PNG") {
        return Err("ComfyUI sent something that isn't a PNG. Save the image as PNG in your workflow".into());
    }
    let source = if req.workflow.is_some() { "ComfyUI, own workflow".to_string() } else { format!("ComfyUI, {}", req.checkpoint) };
    Ok(Made { png: bytes, source })
}

// ---------------------------------------------------------------- test images

/// A 128 px picture for test mode: a gradient whose colors come from the prompt.
pub fn test_png(prompt: &str) -> Vec<u8> {
    let h = prompt.bytes().fold(2166136261u32, |a, b| (a ^ b as u32).wrapping_mul(16777619));
    let (r0, g0, b0) = ((h & 0xff) as f32, ((h >> 8) & 0xff) as f32, ((h >> 16) & 0xff) as f32);
    let n = 128usize;
    let mut rgba = Vec::with_capacity(n * n * 4);
    for y in 0..n {
        for x in 0..n {
            let t = (x + y) as f32 / (2 * n) as f32;
            let dx = x as f32 - 64.0;
            let dy = y as f32 - 64.0;
            let inside = dx * dx + dy * dy < 40.0 * 40.0;
            let k = if inside { 1.0 } else { 0.35 };
            let c = |v: f32| v.clamp(0.0, 255.0) as u8;
            rgba.extend_from_slice(&[c(r0 * (1.0 - t) * k + 40.0), c(g0 * k * (0.5 + t) + 20.0), c(b0 * k + 30.0), 255]);
        }
    }
    encode_png(n as u32, n as u32, &rgba)
}

/// A PNG with no compression (stored deflate blocks): small code, no image library needed.
pub fn encode_png(w: u32, h: u32, rgba: &[u8]) -> Vec<u8> {
    fn crc32(data: &[u8]) -> u32 {
        let mut c = 0xffff_ffffu32;
        for &b in data {
            c ^= b as u32;
            for _ in 0..8 {
                c = if c & 1 != 0 { 0xedb8_8320 ^ (c >> 1) } else { c >> 1 };
            }
        }
        !c
    }
    fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        let mut body = kind.to_vec();
        body.extend_from_slice(data);
        out.extend_from_slice(&body);
        out.extend_from_slice(&crc32(&body).to_be_bytes());
    }
    let mut raw = Vec::with_capacity((w as usize * 4 + 1) * h as usize);
    for row in rgba.chunks(w as usize * 4) {
        raw.push(0);
        raw.extend_from_slice(row);
    }
    let mut z = vec![0x78, 0x01];
    let blocks: Vec<&[u8]> = raw.chunks(65535).collect();
    for (i, b) in blocks.iter().enumerate() {
        z.push(if i + 1 == blocks.len() { 1 } else { 0 });
        z.extend_from_slice(&(b.len() as u16).to_le_bytes());
        z.extend_from_slice(&(!(b.len() as u16)).to_le_bytes());
        z.extend_from_slice(b);
    }
    let (mut a, mut b) = (1u32, 0u32);
    for &x in &raw {
        a = (a + x as u32) % 65521;
        b = (b + a) % 65521;
    }
    z.extend_from_slice(&((b << 16) | a).to_be_bytes());
    let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&w.to_be_bytes());
    ihdr.extend_from_slice(&h.to_be_bytes());
    ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);
    chunk(&mut out, b"IHDR", &ihdr);
    chunk(&mut out, b"IDAT", &z);
    chunk(&mut out, b"IEND", &[]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn creq() -> ComfyImageRequest {
        ComfyImageRequest { url: String::new(), prompt: "a red potion".into(), negative: "blurry".into(), checkpoint: "sd15.safetensors".into(), width: 500, height: 3000, steps: 0, cfg: 0.0, seed: 7, workflow: None }
    }

    #[test]
    fn builds_openai_requests() {
        let r = OpenAIImageRequest { prompt: format!("  {}", "x".repeat(5000)), size: "4096x4096".into(), quality: "ultra".into(), model: " ".into(), transparent: true };
        let b = openai_body(&r);
        assert_eq!((b["size"].as_str(), b["quality"].as_str(), b["model"].as_str(), b["background"].as_str()), (Some("1024x1024"), Some("medium"), Some(DEFAULT_MODEL), Some("transparent")));
        assert_eq!(b["prompt"].as_str().unwrap().len(), 4000);
        assert_eq!(read_openai(200, &json!({"data": [{"b64_json": "QUJD"}]})), Ok("QUJD".into()));
        assert!(read_openai(401, &json!({})).unwrap_err().contains("API key"));
        assert_eq!(read_openai(400, &json!({"error": {"message": "Your prompt was rejected"}})), Err("Your prompt was rejected".into()));
    }

    #[test]
    fn builds_comfy_workflows() {
        let wf = builtin_workflow(&creq());
        assert_eq!((wf["2"]["inputs"]["width"].as_u64(), wf["2"]["inputs"]["height"].as_u64()), (Some(512), Some(2048)));
        assert_eq!(wf["6"]["inputs"]["steps"], 24);
        assert_eq!(wf["4"]["inputs"]["text"], "a red potion");
        let own = json!({"3": {"inputs": {"text": "pixel art, %PROMPT%", "seed": "%SEED%", "width": "%WIDTH%"}}});
        let out = fill_workflow(&own, &creq()).unwrap();
        assert_eq!(out["3"]["inputs"]["text"], "pixel art, a red potion");
        assert_eq!((out["3"]["inputs"]["seed"].as_u64(), out["3"]["inputs"]["width"].as_u64()), (Some(7), Some(512)));
        assert!(fill_workflow(&json!({"1": {"inputs": {"text": "x"}}}), &creq()).unwrap_err().contains("%PROMPT%"));
        assert!(fill_workflow(&json!({"nodes": []}), &creq()).unwrap_err().contains("API format"));
        assert_eq!(comfy_base("127.0.0.1:8188/"), Ok("http://127.0.0.1:8188".into()));
    }

    #[test]
    fn reads_comfy_answers() {
        assert_eq!(read_history("a", &json!({})), Progress::Waiting);
        let done = json!({"a": {"status": {"status_str": "success", "completed": true}, "outputs": {"8": {"images": [{"filename": "AIForge_1.png", "subfolder": "", "type": "output"}]}}}});
        assert!(matches!(read_history("a", &done), Progress::Done { .. }));
        let failed = json!({"a": {"status": {"status_str": "error", "messages": [["execution_error", {"node_type": "KSampler", "exception_message": "Out of memory"}]]}}});
        assert_eq!(read_history("a", &failed), Progress::Failed("ComfyUI stopped at KSampler: Out of memory".into()));
        assert_eq!(read_checkpoints(&json!({"CheckpointLoaderSimple": {"input": {"required": {"ckpt_name": [["a.safetensors"], {}]}}}})), vec!["a.safetensors"]);
    }

    #[test]
    fn makes_valid_test_pngs() {
        let png = test_png("slime");
        assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert_eq!(&png[12..16], b"IHDR");
        assert_eq!(u32::from_be_bytes(png[16..20].try_into().unwrap()), 128);
        assert!(png.ends_with(&[0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]), "IEND with its fixed CRC");
    }
}
