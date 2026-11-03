//! 3D models from a prompt or a picture, through Meshy's API with the person's
//! own key (each model is billed to their Meshy account).
//!
//! Meshy works in tasks: start one, ask how far it is until it succeeds, then
//! download the model (GLB) and its preview picture. Text to 3D is two steps:
//! a quick untextured "preview" mesh, then an optional "refine" that paints it.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

use crate::keys;

const API: &str = "https://api.meshy.ai/openapi";
pub const ART_STYLES: [&str; 2] = ["realistic", "sculpture"];
pub const TOPOLOGIES: [&str; 2] = ["triangle", "quad"];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshRequest {
    /// "text" (a preview mesh), "refine" (texture a preview) or "image".
    pub kind: String,
    #[serde(default)]
    pub prompt: String,
    /// The preview task to texture (refine only).
    #[serde(default)]
    pub preview_id: String,
    /// The picture, base64 PNG or JPEG (image only).
    #[serde(default)]
    pub image: String,
    #[serde(default)]
    pub art_style: String,
    #[serde(default)]
    pub topology: String,
    /// Roughly how many faces; 0 leaves it to Meshy.
    #[serde(default)]
    pub polycount: u32,
    /// Physically based textures (metal, roughness, normal maps).
    #[serde(default)]
    pub pbr: bool,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MeshStatus {
    /// PENDING, IN_PROGRESS, SUCCEEDED, FAILED, CANCELED or EXPIRED.
    pub status: String,
    pub progress: u32,
    pub error: Option<String>,
}

pub struct MeshFiles {
    pub glb: Vec<u8>,
    pub thumb: Option<Vec<u8>>,
}

fn mock_on() -> bool {
    cfg!(debug_assertions) && std::env::var("AIFORGE_AI_MOCK").as_deref() == Ok("1")
}

/// Where each kind of task lives in Meshy's API.
pub fn endpoint(kind: &str) -> Result<&'static str, String> {
    match kind {
        "text" | "refine" => Ok("v2/text-to-3d"),
        "image" => Ok("v1/image-to-3d"),
        other => Err(format!("Unknown kind of 3D task {other}")),
    }
}

/// A task id from Meshy is letters, digits and dashes; anything else is refused before it goes into a URL.
pub fn check_id(id: &str) -> Result<(), String> {
    if !id.is_empty() && id.len() <= 80 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        Ok(())
    } else {
        Err("That isn't a Meshy task id".into())
    }
}

pub fn start_body(req: &MeshRequest) -> Result<Value, String> {
    let topology = TOPOLOGIES.iter().find(|t| **t == req.topology).copied().unwrap_or("triangle");
    let mut body = match req.kind.as_str() {
        "text" => {
            let prompt: String = req.prompt.trim().chars().take(600).collect();
            if prompt.is_empty() {
                return Err("Describe the model first".into());
            }
            let style = ART_STYLES.iter().find(|s| **s == req.art_style).copied().unwrap_or("realistic");
            json!({"mode": "preview", "prompt": prompt, "art_style": style, "should_remesh": true, "topology": topology})
        }
        "refine" => {
            check_id(&req.preview_id)?;
            let mut b = json!({"mode": "refine", "preview_task_id": req.preview_id, "enable_pbr": req.pbr});
            let tp: String = req.prompt.trim().chars().take(600).collect();
            if !tp.is_empty() {
                b["texture_prompt"] = json!(tp);
            }
            return Ok(b);
        }
        "image" => {
            if req.image.is_empty() {
                return Err("Pick a picture first".into());
            }
            let mime = if req.image.starts_with("/9j/") { "image/jpeg" } else { "image/png" };
            json!({"image_url": format!("data:{mime};base64,{}", req.image), "should_texture": true, "enable_pbr": req.pbr, "should_remesh": true, "topology": topology})
        }
        other => return Err(format!("Unknown kind of 3D task {other}")),
    };
    if req.polycount > 0 {
        body["target_polycount"] = json!(req.polycount.clamp(100, 300_000));
    }
    Ok(body)
}

pub fn read_status(task: &Value) -> MeshStatus {
    let status = task["status"].as_str().unwrap_or("PENDING").to_string();
    let error = task["task_error"]["message"].as_str().filter(|m| !m.is_empty()).map(str::to_string).or_else(|| {
        matches!(status.as_str(), "FAILED" | "CANCELED" | "EXPIRED").then(|| format!("Meshy says the task {}", status.to_lowercase()))
    });
    MeshStatus { progress: task["progress"].as_u64().unwrap_or(0).min(100) as u32, status, error }
}

fn read_error(status: u16, body: &Value) -> String {
    match status {
        401 => "Meshy didn't accept the API key. Check it in Settings".into(),
        402 => "Your Meshy account is out of credits".into(),
        429 => "Meshy says too many requests. Wait a moment and try again".into(),
        _ => body["message"].as_str().map(str::to_string).unwrap_or_else(|| format!("Meshy answered {status}")),
    }
}

fn client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(timeout).build().map_err(|e| e.to_string())
}

fn key() -> Result<String, String> {
    keys::read("meshy").ok_or_else(|| "Add your Meshy API key in Settings first".to_string())
}

async fn call(req: reqwest::RequestBuilder) -> Result<Value, String> {
    let res = req.send().await.map_err(|e| if e.is_timeout() { "Meshy took too long to answer".to_string() } else { format!("Couldn't reach Meshy: {e}") })?;
    let status = res.status().as_u16();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if !(200..300).contains(&status) {
        return Err(read_error(status, &body));
    }
    Ok(body)
}

/// Starts a task and returns its id.
pub async fn start(req: &MeshRequest) -> Result<String, String> {
    let body = start_body(req)?;
    if mock_on() {
        return Ok(format!("mock-{}", uuid::Uuid::new_v4().simple()));
    }
    let url = format!("{API}/{}", endpoint(&req.kind)?);
    let v = call(client(Duration::from_secs(60))?.post(url).bearer_auth(key()?).json(&body)).await?;
    let id = v["result"].as_str().ok_or("Meshy didn't start the task")?.to_string();
    check_id(&id)?;
    Ok(id)
}

pub async fn status(kind: &str, id: &str) -> Result<MeshStatus, String> {
    check_id(id)?;
    if mock_on() && id.starts_with("mock-") {
        return Ok(MeshStatus { status: "SUCCEEDED".into(), progress: 100, error: None });
    }
    let v = call(client(Duration::from_secs(30))?.get(format!("{API}/{}/{id}", endpoint(kind)?)).bearer_auth(key()?)).await?;
    Ok(read_status(&v))
}

/// Downloads a finished task's model and preview picture.
pub async fn download(kind: &str, id: &str) -> Result<MeshFiles, String> {
    check_id(id)?;
    if mock_on() && id.starts_with("mock-") {
        return Ok(MeshFiles { glb: cube_glb([0.65, 0.55, 0.98, 1.0]), thumb: Some(crate::images::test_png(id)) });
    }
    let http = client(Duration::from_secs(300))?;
    let v = call(http.get(format!("{API}/{}/{id}", endpoint(kind)?)).bearer_auth(key()?)).await?;
    let st = read_status(&v);
    if st.status != "SUCCEEDED" {
        return Err(st.error.unwrap_or_else(|| "That model isn't finished yet".into()));
    }
    let glb_url = v["model_urls"]["glb"].as_str().ok_or("Meshy didn't give a GLB file for this model")?;
    let glb = fetch(&http, glb_url).await?;
    if !glb.starts_with(b"glTF") {
        return Err("Meshy sent something that isn't a GLB model".into());
    }
    let thumb = match v["thumbnail_url"].as_str() {
        Some(u) => fetch(&http, u).await.ok(),
        None => None,
    };
    Ok(MeshFiles { glb, thumb })
}

async fn fetch(http: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "Meshy gave a bad download address".to_string())?;
    if parsed.scheme() != "https" {
        return Err("Meshy gave a download address that isn't https".into());
    }
    let res = http.get(parsed).send().await.map_err(|e| format!("Couldn't download the model: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("The model download answered {}", res.status().as_u16()));
    }
    Ok(res.bytes().await.map_err(|e| e.to_string())?.to_vec())
}

/// A one-color cube as a GLB file, for test mode and for checking the viewer.
pub fn cube_glb(color: [f32; 4]) -> Vec<u8> {
    let faces: [([f32; 3], [f32; 3], [f32; 3]); 6] = [
        ([1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]),
        ([-1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, -1.0]),
        ([0.0, 1.0, 0.0], [0.0, 0.0, 1.0], [1.0, 0.0, 0.0]),
        ([0.0, -1.0, 0.0], [0.0, 0.0, -1.0], [1.0, 0.0, 0.0]),
        ([0.0, 0.0, 1.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]),
        ([0.0, 0.0, -1.0], [-1.0, 0.0, 0.0], [0.0, 1.0, 0.0]),
    ];
    let mut pos: Vec<f32> = Vec::new();
    let mut nrm: Vec<f32> = Vec::new();
    let mut idx: Vec<u16> = Vec::new();
    for (f, (n, u, v)) in faces.iter().enumerate() {
        // corners in counter-clockwise order seen from outside: u x v = n
        let corner = |a: f32, b: f32| [0.5 * n[0] + 0.5 * (a * u[0] + b * v[0]), 0.5 * n[1] + 0.5 * (a * u[1] + b * v[1]), 0.5 * n[2] + 0.5 * (a * u[2] + b * v[2])];
        for (a, b) in [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)] {
            pos.extend(corner(a, b));
            nrm.extend(n);
        }
        let o = (f * 4) as u16;
        // u x v points along n for every face above, so (0,1,2) is counter-clockwise from outside
        idx.extend([o, o + 1, o + 2, o, o + 2, o + 3]);
    }
    let mut bin: Vec<u8> = Vec::new();
    for x in pos.iter().chain(nrm.iter()) {
        bin.extend_from_slice(&x.to_le_bytes());
    }
    let idx_offset = bin.len();
    for i in &idx {
        bin.extend_from_slice(&i.to_le_bytes());
    }
    while bin.len() % 4 != 0 {
        bin.push(0);
    }
    let gltf = json!({
        "asset": {"version": "2.0", "generator": "AI Forge test mode"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0, "name": "Cube"}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1}, "indices": 2, "material": 0}]}],
        "materials": [{"pbrMetallicRoughness": {"baseColorFactor": color, "metallicFactor": 0.0, "roughnessFactor": 0.7}}],
        "buffers": [{"byteLength": bin.len()}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": 24 * 12, "target": 34962},
            {"buffer": 0, "byteOffset": 24 * 12, "byteLength": 24 * 12, "target": 34962},
            {"buffer": 0, "byteOffset": idx_offset, "byteLength": idx.len() * 2, "target": 34963}
        ],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": 24, "type": "VEC3", "min": [-0.5, -0.5, -0.5], "max": [0.5, 0.5, 0.5]},
            {"bufferView": 1, "componentType": 5126, "count": 24, "type": "VEC3"},
            {"bufferView": 2, "componentType": 5123, "count": idx.len(), "type": "SCALAR"}
        ]
    });
    let mut json_bytes = gltf.to_string().into_bytes();
    while json_bytes.len() % 4 != 0 {
        json_bytes.push(b' ');
    }
    let total = 12 + 8 + json_bytes.len() + 8 + bin.len();
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(b"glTF");
    out.extend_from_slice(&2u32.to_le_bytes());
    out.extend_from_slice(&(total as u32).to_le_bytes());
    out.extend_from_slice(&(json_bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(b"JSON");
    out.extend_from_slice(&json_bytes);
    out.extend_from_slice(&(bin.len() as u32).to_le_bytes());
    out.extend_from_slice(b"BIN\0");
    out.extend_from_slice(&bin);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(kind: &str) -> MeshRequest {
        MeshRequest { kind: kind.into(), prompt: "a wooden treasure chest".into(), preview_id: String::new(), image: String::new(), art_style: "cartoon".into(), topology: "quad".into(), polycount: 50, pbr: true }
    }

    #[test]
    fn builds_task_requests() {
        let b = start_body(&req("text")).unwrap();
        assert_eq!((b["mode"].as_str(), b["art_style"].as_str(), b["topology"].as_str()), (Some("preview"), Some("realistic"), Some("quad")));
        assert_eq!(b["target_polycount"], 100);
        assert!(start_body(&MeshRequest { prompt: " ".into(), ..req("text") }).is_err());
        assert!(start_body(&req("refine")).is_err(), "refine needs a preview id");
        let b = start_body(&MeshRequest { preview_id: "0193bfc5-ee4f".into(), ..req("refine") }).unwrap();
        assert_eq!((b["mode"].as_str(), b["preview_task_id"].as_str(), b["enable_pbr"].as_bool()), (Some("refine"), Some("0193bfc5-ee4f"), Some(true)));
        let b = start_body(&MeshRequest { image: "/9j/4AAQ".into(), ..req("image") }).unwrap();
        assert!(b["image_url"].as_str().unwrap().starts_with("data:image/jpeg;base64,"));
        assert!(start_body(&req("sound")).is_err());
        assert!(check_id("../v1/balance").is_err());
        assert_eq!(endpoint("refine"), Ok("v2/text-to-3d"));
    }

    #[test]
    fn reads_task_status() {
        assert_eq!(read_status(&json!({"status": "IN_PROGRESS", "progress": 42})), MeshStatus { status: "IN_PROGRESS".into(), progress: 42, error: None });
        assert_eq!(read_status(&json!({"status": "FAILED", "task_error": {"message": "Prompt not allowed"}})).error.as_deref(), Some("Prompt not allowed"));
        assert!(read_status(&json!({"status": "CANCELED", "task_error": {"message": ""}})).error.is_some());
        assert!(read_error(402, &Value::Null).contains("credits"));
    }

    #[test]
    fn makes_a_valid_glb() {
        let glb = cube_glb([1.0, 0.0, 0.0, 1.0]);
        assert_eq!(&glb[0..4], b"glTF");
        assert_eq!(u32::from_le_bytes(glb[8..12].try_into().unwrap()) as usize, glb.len());
        let json_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        assert_eq!(&glb[16..20], b"JSON");
        let doc: Value = serde_json::from_slice(&glb[20..20 + json_len]).unwrap();
        assert_eq!(doc["accessors"][2]["count"], 36);
        assert_eq!(&glb[24 + json_len..28 + json_len], b"BIN\0");
    }
}
