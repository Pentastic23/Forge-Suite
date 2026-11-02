//! Optional AI coloring through a ComfyUI server the person runs themselves (usually on this PC).
//!
//! Nothing leaves the machine unless the person points it at another one, and there is no key.
//! The flow is ComfyUI's own HTTP API: upload the sketch, queue a workflow, wait for its history
//! to show the finished image, then download it.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::{Duration, Instant};

use crate::ai::ColorResult;

pub const DEFAULT_URL: &str = "http://127.0.0.1:8188";
/// Slow cards (DirectML on AMD) can take minutes for one image.
const WAIT: Duration = Duration::from_secs(15 * 60);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComfyRequest {
    #[serde(default)]
    pub url: String,
    /// The sketch, base64 PNG, already sized for the model.
    pub png: String,
    pub prompt: String,
    #[serde(default)]
    pub negative: String,
    #[serde(default)]
    pub checkpoint: String,
    #[serde(default)]
    pub steps: u32,
    #[serde(default)]
    pub cfg: f64,
    #[serde(default)]
    pub denoise: f64,
    #[serde(default)]
    pub seed: u64,
    /// The person's own workflow (ComfyUI "Save (API format)"), with %SKETCH% where the image goes.
    #[serde(default)]
    pub workflow: Option<Value>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComfyInfo {
    pub url: String,
    pub checkpoints: Vec<String>,
}

/// The server's address without a trailing slash; only http(s) is accepted.
pub fn base_url(url: &str) -> Result<String, String> {
    let url = url.trim();
    let url = if url.is_empty() { DEFAULT_URL } else { url };
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

fn client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(timeout).build().map_err(|e| e.to_string())
}

fn unreachable(base: &str, e: reqwest::Error) -> String {
    if e.is_connect() || e.is_timeout() {
        format!("ComfyUI isn't answering at {base}. Start it first, and check the address")
    } else {
        format!("Couldn't reach ComfyUI at {base}: {e}")
    }
}

/// Checkpoint names from ComfyUI's /object_info/CheckpointLoaderSimple answer.
pub fn read_checkpoints(info: &Value) -> Vec<String> {
    info["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"][0]
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_default()
}

pub async fn info(url: &str) -> Result<ComfyInfo, String> {
    let base = base_url(url)?;
    let res = client(Duration::from_secs(8))?
        .get(format!("{base}/object_info/CheckpointLoaderSimple"))
        .send()
        .await
        .map_err(|e| unreachable(&base, e))?;
    if !res.status().is_success() {
        return Err(format!("{base} answered {}, so it may not be ComfyUI", res.status().as_u16()));
    }
    let body: Value = res.json().await.map_err(|_| format!("{base} didn't answer like ComfyUI"))?;
    Ok(ComfyInfo { url: base, checkpoints: read_checkpoints(&body) })
}

/// Stops whatever ComfyUI is running now.
pub async fn interrupt(url: &str) -> Result<(), String> {
    let base = base_url(url)?;
    client(Duration::from_secs(8))?.post(format!("{base}/interrupt")).send().await.map_err(|e| unreachable(&base, e))?;
    Ok(())
}

/// The built-in workflow: image to image with one checkpoint, so the drawing keeps its shape.
pub fn builtin_workflow(req: &ComfyRequest, image: &str) -> Value {
    let steps = req.steps.clamp(4, 80);
    let cfg = if req.cfg > 0.0 { req.cfg.clamp(1.0, 20.0) } else { 7.0 };
    let denoise = if req.denoise > 0.0 { req.denoise.clamp(0.1, 1.0) } else { 0.55 };
    json!({
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": req.checkpoint}},
        "2": {"class_type": "LoadImage", "inputs": {"image": image}},
        "3": {"class_type": "VAEEncode", "inputs": {"pixels": ["2", 0], "vae": ["1", 2]}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": req.prompt, "clip": ["1", 1]}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"text": req.negative, "clip": ["1", 1]}},
        "6": {"class_type": "KSampler", "inputs": {
            "seed": req.seed, "steps": steps, "cfg": cfg, "sampler_name": "euler_ancestral", "scheduler": "normal", "denoise": denoise,
            "model": ["1", 0], "positive": ["4", 0], "negative": ["5", 0], "latent_image": ["3", 0]}},
        "7": {"class_type": "VAEDecode", "inputs": {"samples": ["6", 0], "vae": ["1", 2]}},
        "8": {"class_type": "SaveImage", "inputs": {"filename_prefix": "PixelForge", "images": ["7", 0]}}
    })
}

/// Fills the person's workflow: %SKETCH%, %PROMPT%, %NEGATIVE% and %CHECKPOINT% inside text,
/// and %SEED%, %STEPS%, %CFG% and %DENOISE% as numbers when they are a whole value.
pub fn fill_workflow(wf: &Value, req: &ComfyRequest, image: &str) -> Result<Value, String> {
    if !wf.is_object() || wf.as_object().is_some_and(|o| o.is_empty()) {
        return Err("That workflow is empty. In ComfyUI use \"Save (API format)\"".into());
    }
    if wf.get("nodes").is_some() {
        return Err("That's the editor format. In ComfyUI use \"Save (API format)\" instead".into());
    }
    let mut found = false;
    let out = fill(wf, req, image, &mut found);
    if !found {
        return Err("Your workflow needs %SKETCH% where the image goes (the LoadImage node's image)".into());
    }
    Ok(out)
}

fn fill(v: &Value, req: &ComfyRequest, image: &str, found: &mut bool) -> Value {
    match v {
        Value::String(s) => match s.as_str() {
            "%SEED%" => json!(req.seed),
            "%STEPS%" => json!(req.steps.clamp(4, 80)),
            "%CFG%" => json!(if req.cfg > 0.0 { req.cfg } else { 7.0 }),
            "%DENOISE%" => json!(if req.denoise > 0.0 { req.denoise.clamp(0.1, 1.0) } else { 0.55 }),
            _ => {
                if s.contains("%SKETCH%") {
                    *found = true;
                }
                Value::String(
                    s.replace("%SKETCH%", image).replace("%PROMPT%", &req.prompt).replace("%NEGATIVE%", &req.negative).replace("%CHECKPOINT%", &req.checkpoint),
                )
            }
        },
        Value::Array(a) => Value::Array(a.iter().map(|x| fill(x, req, image, found)).collect()),
        Value::Object(o) => Value::Object(o.iter().map(|(k, x)| (k.clone(), fill(x, req, image, found))).collect()),
        other => other.clone(),
    }
}

/// What a /history/{id} answer says: still running, failed (with ComfyUI's message), or the first image.
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
    let outputs = entry["outputs"].as_object();
    // keep the node order ComfyUI reports, but prefer saved images over previews
    let mut images: Vec<&Value> = outputs.into_iter().flat_map(|o| o.values()).filter_map(|n| n["images"].as_array()).flatten().collect();
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

/// The reason ComfyUI refused a workflow, from its /prompt error answer.
pub fn read_refusal(body: &Value) -> String {
    let mut msg = body["error"]["message"].as_str().unwrap_or("ComfyUI refused the workflow").trim_end_matches('.').to_string();
    if let Some(nodes) = body["node_errors"].as_object() {
        if let Some((_, n)) = nodes.iter().next() {
            let class = n["class_type"].as_str().unwrap_or("a node");
            if let Some(e) = n["errors"][0].as_object() {
                let detail = e.get("details").and_then(|d| d.as_str()).filter(|d| !d.is_empty()).or_else(|| e.get("message").and_then(|d| d.as_str())).unwrap_or("");
                msg = format!("{msg}: {class} {detail}");
            }
        }
    }
    msg
}

pub async fn color_sketch(req: ComfyRequest) -> Result<ColorResult, String> {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD;
    let png = b64.decode(&req.png).map_err(|_| "The sketch couldn't be read".to_string())?;
    if cfg!(debug_assertions) && std::env::var("PIXELFORGE_AI_MOCK").as_deref() == Ok("1") {
        let _ = tauri::async_runtime::spawn_blocking(|| std::thread::sleep(Duration::from_millis(300))).await;
        return Ok(ColorResult { png: req.png, mock: true });
    }
    if req.workflow.is_none() && req.checkpoint.trim().is_empty() {
        return Err("Pick a checkpoint first (Connect lists the ones ComfyUI has)".into());
    }
    let base = base_url(&req.url)?;
    let http = client(Duration::from_secs(60))?;

    // 1. upload the sketch into ComfyUI's input folder
    let name = format!("pixelforge_{}.png", uuid::Uuid::new_v4().simple());
    let part = reqwest::multipart::Part::bytes(png).file_name(name).mime_str("image/png").map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new().part("image", part).text("type", "input").text("overwrite", "true");
    let res = http.post(format!("{base}/upload/image")).multipart(form).send().await.map_err(|e| unreachable(&base, e))?;
    if !res.status().is_success() {
        return Err(format!("ComfyUI didn't take the sketch ({})", res.status().as_u16()));
    }
    let up: Value = res.json().await.map_err(|_| "ComfyUI's answer couldn't be read".to_string())?;
    let file = up["name"].as_str().ok_or("ComfyUI didn't say where it put the sketch")?;
    let image = match up["subfolder"].as_str() {
        Some(sub) if !sub.is_empty() => format!("{sub}/{file}"),
        _ => file.to_string(),
    };

    // 2. queue the workflow
    let workflow = match &req.workflow {
        Some(wf) => fill_workflow(wf, &req, &image)?,
        None => builtin_workflow(&req, &image),
    };
    let res = http
        .post(format!("{base}/prompt"))
        .json(&json!({"prompt": workflow, "client_id": "pixel-forge"}))
        .send()
        .await
        .map_err(|e| unreachable(&base, e))?;
    let ok = res.status().is_success();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if !ok {
        return Err(read_refusal(&body));
    }
    let id = body["prompt_id"].as_str().ok_or("ComfyUI didn't queue the workflow")?.to_string();

    // 3. wait for it to finish
    let start = Instant::now();
    let (filename, subfolder, kind) = loop {
        if start.elapsed() > WAIT {
            return Err("ComfyUI is still working after 15 minutes. The image may still appear in its output folder".into());
        }
        let _ = tauri::async_runtime::spawn_blocking(|| std::thread::sleep(Duration::from_millis(900))).await;
        let res = http.get(format!("{base}/history/{id}")).send().await.map_err(|e| unreachable(&base, e))?;
        let body: Value = res.json().await.unwrap_or(Value::Null);
        match read_history(&id, &body) {
            Progress::Waiting => continue,
            Progress::Failed(m) => return Err(m),
            Progress::Done { filename, subfolder, kind } => break (filename, subfolder, kind),
        }
    };

    // 4. download the image
    let res = http
        .get(format!("{base}/view"))
        .query(&[("filename", filename.as_str()), ("subfolder", subfolder.as_str()), ("type", kind.as_str())])
        .send()
        .await
        .map_err(|e| unreachable(&base, e))?;
    if !res.status().is_success() {
        return Err(format!("ComfyUI made the image but didn't send it ({})", res.status().as_u16()));
    }
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    if !bytes.starts_with(b"\x89PNG") {
        return Err("ComfyUI sent something that isn't a PNG. Save the image as PNG in your workflow".into());
    }
    Ok(ColorResult { png: b64.encode(&bytes), mock: false })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    fn req() -> ComfyRequest {
        ComfyRequest {
            url: String::new(),
            png: String::new(),
            prompt: "red cloak".into(),
            negative: "blurry".into(),
            checkpoint: "dreamshaper_8.safetensors".into(),
            steps: 200,
            cfg: 0.0,
            denoise: 0.0,
            seed: 42,
            workflow: None,
        }
    }

    #[test]
    fn checks_addresses() {
        assert_eq!(base_url(""), Ok(DEFAULT_URL.to_string()));
        assert_eq!(base_url("127.0.0.1:8188/"), Ok("http://127.0.0.1:8188".to_string()));
        assert_eq!(base_url(" https://gpu-box.local:8188 "), Ok("https://gpu-box.local:8188".to_string()));
        assert!(base_url("file:///C:/x").is_err());
        assert!(base_url("http://127.0.0.1:8188/?x=1").is_err());
    }

    #[test]
    fn builds_the_builtin_workflow() {
        let wf = builtin_workflow(&req(), "sub/sketch.png");
        assert_eq!(wf["2"]["inputs"]["image"], "sub/sketch.png");
        assert_eq!(wf["1"]["inputs"]["ckpt_name"], "dreamshaper_8.safetensors");
        let k = &wf["6"]["inputs"];
        assert_eq!((k["steps"].as_u64(), k["cfg"].as_f64(), k["denoise"].as_f64(), k["seed"].as_u64()), (Some(80), Some(7.0), Some(0.55), Some(42)));
        assert_eq!(wf["4"]["inputs"]["text"], "red cloak");
        assert_eq!(wf["5"]["inputs"]["text"], "blurry");
    }

    #[test]
    fn fills_the_persons_workflow() {
        let wf = json!({
            "10": {"class_type": "LoadImage", "inputs": {"image": "%SKETCH%"}},
            "11": {"class_type": "CLIPTextEncode", "inputs": {"text": "pixel art, %PROMPT%"}},
            "12": {"class_type": "KSampler", "inputs": {"seed": "%SEED%", "denoise": "%DENOISE%", "steps": 30}}
        });
        let out = fill_workflow(&wf, &req(), "s.png").unwrap();
        assert_eq!(out["10"]["inputs"]["image"], "s.png");
        assert_eq!(out["11"]["inputs"]["text"], "pixel art, red cloak");
        assert_eq!(out["12"]["inputs"]["seed"], 42);
        assert_eq!(out["12"]["inputs"]["denoise"], 0.55);
        assert!(fill_workflow(&json!({"1": {"inputs": {"text": "%PROMPT%"}}}), &req(), "s.png").unwrap_err().contains("%SKETCH%"));
        assert!(fill_workflow(&json!({"nodes": [], "links": []}), &req(), "s.png").unwrap_err().contains("API format"));
    }

    #[test]
    fn reads_history_and_errors() {
        assert_eq!(read_history("a", &json!({})), Progress::Waiting);
        let done = json!({"a": {"status": {"status_str": "success", "completed": true}, "outputs": {
            "9": {"images": [{"filename": "p.png", "subfolder": "", "type": "temp"}]},
            "8": {"images": [{"filename": "PixelForge_00001_.png", "subfolder": "", "type": "output"}]}}}});
        assert_eq!(read_history("a", &done), Progress::Done { filename: "PixelForge_00001_.png".into(), subfolder: String::new(), kind: "output".into() });
        let failed = json!({"a": {"status": {"status_str": "error", "messages": [["execution_start", {}], ["execution_error", {"node_type": "KSampler", "exception_message": "Out of memory "}]]}, "outputs": {}}});
        assert_eq!(read_history("a", &failed), Progress::Failed("ComfyUI stopped at KSampler: Out of memory".into()));
        let empty = json!({"a": {"status": {"status_str": "success", "completed": true}, "outputs": {}}});
        assert!(matches!(read_history("a", &empty), Progress::Failed(_)));
        let refused = json!({"error": {"message": "Prompt outputs failed validation."}, "node_errors": {"1": {"class_type": "CheckpointLoaderSimple", "errors": [{"message": "Value not in list", "details": "ckpt_name: 'x' not in []"}]}}});
        assert_eq!(read_refusal(&refused), "Prompt outputs failed validation: CheckpointLoaderSimple ckpt_name: 'x' not in []");
        assert_eq!(read_checkpoints(&json!({"CheckpointLoaderSimple": {"input": {"required": {"ckpt_name": [["a.safetensors", "b.ckpt"], {}]}}}})), vec!["a.safetensors", "b.ckpt"]);
    }

    /// A stand-in ComfyUI that answers the five calls Pixel Forge makes.
    fn fake_comfy() -> (String, std::thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            let mut seen = Vec::new();
            let mut polls = 0;
            for stream in listener.incoming() {
                let mut s = stream.unwrap();
                let mut buf = Vec::new();
                let mut chunk = [0u8; 65536];
                // read the head, then as much body as Content-Length says
                loop {
                    let n = s.read(&mut chunk).unwrap();
                    buf.extend_from_slice(&chunk[..n]);
                    if let Some(end) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                        let head = String::from_utf8_lossy(&buf[..end]).to_lowercase();
                        let len = head.lines().find_map(|l| l.strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap())).unwrap_or(0);
                        if buf.len() >= end + 4 + len {
                            break;
                        }
                    }
                    if n == 0 {
                        break;
                    }
                }
                let text = String::from_utf8_lossy(&buf).to_string();
                let line = text.lines().next().unwrap_or_default().to_string();
                let (ctype, body): (&str, Vec<u8>) = if line.starts_with("POST /upload/image") {
                    ("application/json", br#"{"name":"pixelforge_x.png","subfolder":"","type":"input"}"#.to_vec())
                } else if line.starts_with("POST /prompt") {
                    assert!(text.contains(r#""image":"pixelforge_x.png""#), "the workflow should load the uploaded sketch");
                    ("application/json", br#"{"prompt_id":"p1","number":0,"node_errors":{}}"#.to_vec())
                } else if line.starts_with("GET /history/p1") {
                    polls += 1;
                    let b = if polls < 2 { "{}".to_string() } else { r#"{"p1":{"status":{"status_str":"success","completed":true},"outputs":{"8":{"images":[{"filename":"PixelForge_00001_.png","subfolder":"","type":"output"}]}}}}"#.to_string() };
                    ("application/json", b.into_bytes())
                } else if line.starts_with("GET /view?filename=PixelForge_00001_.png") {
                    ("image/png", b"\x89PNG\r\n\x1a\nfake".to_vec())
                } else {
                    ("text/plain", b"not found".to_vec())
                };
                let status = if ctype == "text/plain" { "404 Not Found" } else { "200 OK" };
                let head = format!("HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                s.write_all(head.as_bytes()).unwrap();
                s.write_all(&body).unwrap();
                seen.push(line.split(' ').take(2).collect::<Vec<_>>().join(" ").split('?').next().unwrap().to_string());
                if line.starts_with("GET /view") {
                    break;
                }
            }
            seen
        });
        (url, handle)
    }

    #[test]
    fn colors_a_sketch_through_comfyui() {
        use base64::Engine;
        let (url, server) = fake_comfy();
        let mut r = req();
        r.url = url;
        r.png = base64::engine::general_purpose::STANDARD.encode(b"\x89PNG\r\n\x1a\nsketch");
        let out = tauri::async_runtime::block_on(color_sketch(r)).unwrap();
        assert_eq!(base64::engine::general_purpose::STANDARD.decode(out.png).unwrap(), b"\x89PNG\r\n\x1a\nfake");
        assert!(!out.mock);
        assert_eq!(server.join().unwrap(), vec!["POST /upload/image", "POST /prompt", "GET /history/p1", "GET /history/p1", "GET /view"]);
    }

    #[test]
    fn says_when_comfyui_is_not_running() {
        // a port nothing listens on: bind, note it, close it
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let err = tauri::async_runtime::block_on(info(&format!("127.0.0.1:{port}"))).unwrap_err();
        assert!(err.starts_with("ComfyUI isn't answering"), "{err}");
    }
}
