//! The assistant's chat: one request to the chosen provider, with the answer
//! streamed back piece by piece as it is written.
//!
//! - Anthropic (Claude), with the person's own key, through the Messages API.
//! - OpenAI, with the person's own key, through Chat Completions.
//! - A local model server the person runs (Ollama, LM Studio, llama.cpp and
//!   others), through the OpenAI-compatible API they all offer. No key, and
//!   nothing leaves the machine unless the address points elsewhere.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use crate::keys;

pub const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1/messages";
pub const OPENAI_URL: &str = "https://api.openai.com/v1/chat/completions";
pub const DEFAULT_LOCAL_URL: &str = "http://127.0.0.1:11434";
pub const DEFAULT_CLAUDE: &str = "claude-opus-5-5";
pub const DEFAULT_OPENAI: &str = "gpt-5";
/// Claude models that can hand a declined request to another model (server-side fallbacks).
const FALLBACK_MODELS: [&str; 4] = ["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    /// "anthropic", "openai" or "local".
    pub provider: String,
    #[serde(default)]
    pub model: String,
    /// The local server's address (local only).
    #[serde(default)]
    pub url: String,
    /// The mode's instructions plus the project brief, written by the window.
    #[serde(default)]
    pub system: String,
    /// "low", "medium" or "high" (Claude only); empty leaves the model's default.
    #[serde(default)]
    pub effort: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Turn {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    pub text: String,
    pub model: String,
    /// Said under the answer: it was stopped, cut off, or declined.
    pub note: Option<String>,
    pub mock: bool,
}

/// What one streamed event says.
#[derive(Debug, PartialEq)]
pub enum Piece {
    Text(String),
    /// Why the answer ended, when it wasn't simply finished.
    End(Option<String>),
    Error(String),
    Nothing,
}

/// Splits a server-sent event stream into each event's data, however the bytes arrive.
#[derive(Default)]
pub struct Sse {
    buf: String,
}

impl Sse {
    pub fn push(&mut self, chunk: &str) -> Vec<String> {
        self.buf.push_str(&chunk.replace("\r\n", "\n"));
        let mut out = Vec::new();
        while let Some(end) = self.buf.find("\n\n") {
            let event: String = self.buf.drain(..end + 2).collect();
            let data: Vec<&str> = event.lines().filter_map(|l| l.strip_prefix("data:")).map(|d| d.strip_prefix(' ').unwrap_or(d)).collect();
            if !data.is_empty() {
                out.push(data.join("\n"));
            }
        }
        out
    }
}

pub fn model_or_default(req: &ChatRequest) -> String {
    let m = req.model.trim();
    if !m.is_empty() && m.len() <= 100 {
        return m.to_string();
    }
    match req.provider.as_str() {
        "anthropic" => DEFAULT_CLAUDE.into(),
        "openai" => DEFAULT_OPENAI.into(),
        _ => String::new(),
    }
}

/// Only user and assistant turns, starting with the person, with empty ones dropped.
pub fn clean_turns(turns: &[Turn]) -> Vec<Turn> {
    let mut out: Vec<Turn> = turns.iter().filter(|t| (t.role == "user" || t.role == "assistant") && !t.content.trim().is_empty()).cloned().collect();
    while out.first().is_some_and(|t| t.role != "user") {
        out.remove(0);
    }
    out
}

pub fn anthropic_body(req: &ChatRequest, turns: &[Turn]) -> Value {
    let model = model_or_default(req);
    let mut body = json!({
        "model": model,
        "max_tokens": 64000,
        "stream": true,
        "messages": turns.iter().map(|t| json!({"role": t.role, "content": t.content})).collect::<Vec<_>>(),
    });
    if !req.system.trim().is_empty() {
        body["system"] = json!(req.system);
    }
    if matches!(req.effort.as_str(), "low" | "medium" | "high") {
        body["output_config"] = json!({"effort": req.effort});
    }
    if FALLBACK_MODELS.contains(&model.as_str()) {
        body["fallbacks"] = json!("default");
    }
    body
}

pub fn openai_body(req: &ChatRequest, turns: &[Turn]) -> Value {
    let mut messages = Vec::new();
    if !req.system.trim().is_empty() {
        messages.push(json!({"role": "system", "content": req.system}));
    }
    messages.extend(turns.iter().map(|t| json!({"role": t.role, "content": t.content})));
    let mut body = json!({"messages": messages, "stream": true});
    let model = model_or_default(req);
    if !model.is_empty() {
        body["model"] = json!(model);
    }
    body
}

pub fn read_anthropic(data: &str) -> Piece {
    let Ok(v) = serde_json::from_str::<Value>(data) else { return Piece::Nothing };
    match v["type"].as_str() {
        Some("content_block_delta") if v["delta"]["type"] == "text_delta" => Piece::Text(v["delta"]["text"].as_str().unwrap_or_default().to_string()),
        Some("message_delta") => match v["delta"]["stop_reason"].as_str() {
            Some("max_tokens") => Piece::End(Some("The answer hit its length limit. Ask it to continue".into())),
            Some("refusal") => Piece::End(Some("Claude declined to answer this. Try rewording the request".into())),
            _ => Piece::Nothing,
        },
        Some("error") => Piece::Error(v["error"]["message"].as_str().unwrap_or("Claude stopped with an error").to_string()),
        _ => Piece::Nothing,
    }
}

pub fn read_openai(data: &str) -> Piece {
    if data.trim() == "[DONE]" {
        return Piece::End(None);
    }
    let Ok(v) = serde_json::from_str::<Value>(data) else { return Piece::Nothing };
    if let Some(msg) = v["error"]["message"].as_str() {
        return Piece::Error(msg.to_string());
    }
    let choice = &v["choices"][0];
    if let Some(t) = choice["delta"]["content"].as_str() {
        if !t.is_empty() {
            return Piece::Text(t.to_string());
        }
    }
    match choice["finish_reason"].as_str() {
        Some("length") => Piece::End(Some("The answer hit its length limit. Ask it to continue".into())),
        Some("content_filter") => Piece::End(Some("The model's filter stopped this answer".into())),
        _ => Piece::Nothing,
    }
}

/// The error message in a non-streamed error answer from any of the three.
pub fn read_error(status: u16, body: &str, who: &str) -> String {
    let v: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let msg = v["error"]["message"].as_str().or_else(|| v["error"].as_str()).or_else(|| v["message"].as_str()).map(str::to_string);
    match (status, msg) {
        (401, _) => format!("{who} didn't accept the API key. Check it in Settings"),
        (_, Some(m)) => m,
        (429, None) => format!("{who} says too many requests. Wait a moment and try again"),
        _ => format!("{who} answered {status}"),
    }
}

/// A local server's address without a trailing slash or `/v1`; only http(s) is accepted.
pub fn local_base(url: &str) -> Result<String, String> {
    let url = url.trim();
    let url = if url.is_empty() { DEFAULT_LOCAL_URL } else { url };
    let url = if url.contains("://") { url.to_string() } else { format!("http://{url}") };
    let parsed = reqwest::Url::parse(&url).map_err(|_| format!("\"{url}\" isn't a web address"))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(format!("\"{url}\" isn't a web address"));
    }
    let s = parsed.as_str().trim_end_matches('/');
    Ok(s.strip_suffix("/v1").unwrap_or(s).to_string())
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())
}

fn mock_on() -> bool {
    cfg!(debug_assertions) && std::env::var("AIFORGE_AI_MOCK").as_deref() == Ok("1")
}

/// The model names a local server offers (its /v1/models list).
pub async fn local_models(url: &str) -> Result<Vec<String>, String> {
    let base = local_base(url)?;
    let res = reqwest::Client::builder().timeout(Duration::from_secs(8)).build().map_err(|e| e.to_string())?.get(format!("{base}/v1/models")).send().await.map_err(|e| {
        if e.is_connect() || e.is_timeout() {
            format!("Nothing is answering at {base}. Start your local model server first (Ollama or LM Studio), and check the address")
        } else {
            format!("Couldn't reach {base}: {e}")
        }
    })?;
    if !res.status().is_success() {
        return Err(format!("{base} answered {}, so it may not be an OpenAI-compatible server", res.status().as_u16()));
    }
    let v: Value = res.json().await.map_err(|_| format!("{base} didn't answer with a model list"))?;
    let mut names: Vec<String> = v["data"].as_array().into_iter().flatten().filter_map(|m| m["id"].as_str().map(str::to_string)).collect();
    names.sort();
    Ok(names)
}

/// Sends the chat and calls `on_text` with each piece of the answer as it arrives.
pub async fn send(req: &ChatRequest, turns: &[Turn], stop: &AtomicBool, mut on_text: impl FnMut(&str)) -> Result<Reply, String> {
    let turns = clean_turns(turns);
    if turns.last().is_none_or(|t| t.role != "user") {
        return Err("Nothing to send".into());
    }
    if mock_on() {
        return mock(req, &turns, stop, on_text).await;
    }
    let (who, request, anthropic) = match req.provider.as_str() {
        "anthropic" => {
            let key = keys::read("anthropic").ok_or("Add your Anthropic API key in Settings first")?;
            let mut r = client()?.post(ANTHROPIC_URL).header("x-api-key", key).header("anthropic-version", "2023-06-01").json(&anthropic_body(req, &turns));
            if FALLBACK_MODELS.contains(&model_or_default(req).as_str()) {
                r = r.header("anthropic-beta", "server-side-fallback-2026-07-01");
            }
            ("Anthropic", r, true)
        }
        "openai" => {
            let key = keys::read("openai").ok_or("Add your OpenAI API key in Settings first")?;
            ("OpenAI", client()?.post(OPENAI_URL).bearer_auth(key).json(&openai_body(req, &turns)), false)
        }
        "local" => {
            if req.model.trim().is_empty() {
                return Err("Pick a local model first (Settings, Connect lists them)".into());
            }
            let base = local_base(&req.url)?;
            ("The local model server", client()?.post(format!("{base}/v1/chat/completions")).json(&openai_body(req, &turns)), false)
        }
        other => return Err(format!("Unknown AI provider {other}")),
    };
    let mut res = request.send().await.map_err(|e| {
        if e.is_connect() || e.is_timeout() {
            format!("{who} isn't answering. Check your connection{}", if req.provider == "local" { " and that the server is running" } else { "" })
        } else {
            format!("Couldn't reach {who}: {e}")
        }
    })?;
    let status = res.status().as_u16();
    if !(200..300).contains(&status) {
        let body = res.text().await.unwrap_or_default();
        return Err(read_error(status, &body, who));
    }
    let mut sse = Sse::default();
    let mut text = String::new();
    let mut note = None;
    let mut pending: Vec<u8> = Vec::new();
    'read: loop {
        if stop.load(Ordering::Relaxed) {
            note = Some("Stopped".to_string());
            break;
        }
        let chunk = match res.chunk().await {
            Ok(Some(c)) => c,
            Ok(None) => break,
            Err(e) if text.is_empty() => return Err(format!("{who} stopped answering: {e}")),
            Err(_) => {
                note = Some("The connection dropped before the answer finished".into());
                break;
            }
        };
        // keep any half-received UTF-8 character for the next chunk
        pending.extend_from_slice(&chunk);
        let valid = match std::str::from_utf8(&pending) {
            Ok(_) => pending.len(),
            Err(e) => e.valid_up_to(),
        };
        let s = String::from_utf8_lossy(&pending[..valid]).to_string();
        pending.drain(..valid);
        for data in sse.push(&s) {
            match if anthropic { read_anthropic(&data) } else { read_openai(&data) } {
                Piece::Text(t) => {
                    text.push_str(&t);
                    on_text(&t);
                }
                Piece::End(why) => {
                    if why.is_some() {
                        note = why;
                    }
                    if !anthropic {
                        break 'read;
                    }
                }
                Piece::Error(m) if text.is_empty() => return Err(m),
                Piece::Error(m) => {
                    note = Some(m);
                    break 'read;
                }
                Piece::Nothing => {}
            }
        }
    }
    if text.is_empty() && note.is_none() {
        return Err(format!("{who} sent an empty answer"));
    }
    Ok(Reply { text, model: model_or_default(req), note, mock: false })
}

/// Development builds with AIFORGE_AI_MOCK=1: a made-up answer, typed out slowly, nothing sent.
async fn mock(req: &ChatRequest, turns: &[Turn], stop: &AtomicBool, mut on_text: impl FnMut(&str)) -> Result<Reply, String> {
    let asked = turns.last().map(|t| t.content.as_str()).unwrap_or_default();
    let asked: String = asked.chars().take(80).collect();
    let text = format!(
        "**Test mode**: nothing was sent to {}.\n\nYou asked: _{asked}_\n\nHere is what an answer with code looks like:\n\n```gdscript\nextends CharacterBody2D\n\nconst SPEED := 120.0\nconst JUMP := -320.0\n\nfunc _physics_process(delta: float) -> void:\n\tvelocity.y += 980.0 * delta\n\tif is_on_floor() and Input.is_action_just_pressed(\"jump\"):\n\t\tvelocity.y = JUMP\n\tvelocity.x = Input.get_axis(\"left\", \"right\") * SPEED\n\tmove_and_slide()\n```\n\n- Gravity pulls every frame\n- Jumping only works on the floor\n",
        req.provider
    );
    let mut sent = String::new();
    for word in text.split_inclusive(' ') {
        if stop.load(Ordering::Relaxed) {
            return Ok(Reply { text: sent, model: "test".into(), note: Some("Stopped".into()), mock: true });
        }
        let _ = tauri::async_runtime::spawn_blocking(|| std::thread::sleep(Duration::from_millis(12))).await;
        sent.push_str(word);
        on_text(word);
    }
    Ok(Reply { text: sent, model: "test".into(), note: None, mock: true })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(provider: &str) -> ChatRequest {
        ChatRequest { provider: provider.into(), model: String::new(), url: String::new(), system: "Be brief.".into(), effort: String::new() }
    }

    fn turns() -> Vec<Turn> {
        vec![
            Turn { role: "assistant".into(), content: "Hi!".into() },
            Turn { role: "user".into(), content: "Make a jump".into() },
            Turn { role: "assistant".into(), content: " ".into() },
            Turn { role: "user".into(), content: "In Godot".into() },
        ]
    }

    #[test]
    fn splits_server_sent_events() {
        let mut s = Sse::default();
        assert!(s.push("event: content_block_delta\r\ndata: {\"a\"").is_empty());
        assert_eq!(s.push(":1}\r\n\r\ndata: [DONE]\n\n"), vec!["{\"a\":1}", "[DONE]"]);
        assert_eq!(s.push(": ping\n\n"), Vec::<String>::new());
    }

    #[test]
    fn cleans_turns() {
        let t = clean_turns(&turns());
        assert_eq!(t.iter().map(|t| t.content.as_str()).collect::<Vec<_>>(), ["Make a jump", "In Godot"]);
    }

    #[test]
    fn builds_anthropic_requests() {
        let mut r = req("anthropic");
        let b = anthropic_body(&r, &clean_turns(&turns()));
        assert_eq!(b["model"], DEFAULT_CLAUDE);
        assert_eq!(b["system"], "Be brief.");
        assert_eq!(b["stream"], true);
        assert_eq!(b["fallbacks"], "default");
        assert!(b.get("temperature").is_none() && b.get("thinking").is_none());
        assert_eq!(b["messages"][0]["role"], "user");
        r.model = "claude-haiku-5-5".into();
        r.effort = "low".into();
        let b = anthropic_body(&r, &clean_turns(&turns()));
        assert!(b.get("fallbacks").is_none(), "Haiku has no server-side fallback");
        assert_eq!(b["output_config"]["effort"], "low");
    }

    #[test]
    fn builds_openai_requests() {
        let b = openai_body(&req("openai"), &clean_turns(&turns()));
        assert_eq!(b["model"], DEFAULT_OPENAI);
        assert_eq!(b["messages"][0], json!({"role": "system", "content": "Be brief."}));
        assert_eq!(b["messages"].as_array().unwrap().len(), 3);
        let mut local = req("local");
        local.model = "qwen3:8b".into();
        assert_eq!(openai_body(&local, &[])["model"], "qwen3:8b");
    }

    #[test]
    fn reads_stream_events() {
        assert_eq!(read_anthropic(r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}"#), Piece::Text("Hi".into()));
        assert_eq!(read_anthropic(r#"{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":""}}"#), Piece::Nothing);
        assert!(matches!(read_anthropic(r#"{"type":"message_delta","delta":{"stop_reason":"refusal"}}"#), Piece::End(Some(_))));
        assert_eq!(read_anthropic(r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"}}"#), Piece::Nothing);
        assert_eq!(read_anthropic(r#"{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#), Piece::Error("Overloaded".into()));
        assert_eq!(read_openai(r#"{"choices":[{"delta":{"content":"Yo"}}]}"#), Piece::Text("Yo".into()));
        assert_eq!(read_openai("[DONE]"), Piece::End(None));
        assert!(matches!(read_openai(r#"{"choices":[{"delta":{},"finish_reason":"length"}]}"#), Piece::End(Some(_))));
    }

    #[test]
    fn reads_errors_and_addresses() {
        assert!(read_error(401, "{}", "OpenAI").contains("API key"));
        assert_eq!(read_error(400, r#"{"type":"error","error":{"type":"invalid_request_error","message":"bad model"}}"#, "Anthropic"), "bad model");
        assert_eq!(read_error(500, "oops", "Anthropic"), "Anthropic answered 500");
        assert_eq!(local_base(""), Ok(DEFAULT_LOCAL_URL.to_string()));
        assert_eq!(local_base("localhost:1234/v1/"), Ok("http://localhost:1234".to_string()));
        assert!(local_base("file:///x").is_err());
    }

    /// A stand-in OpenAI-compatible server that streams two pieces in awkward chunks.
    #[test]
    fn streams_from_a_local_server() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut buf = [0u8; 65536];
            let n = s.read(&mut buf).unwrap();
            let head = String::from_utf8_lossy(&buf[..n]).to_string();
            s.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n").unwrap();
            for part in ["data: {\"choices\":[{\"delta\":{\"content\":\"Hé\"}}]}\n", "\ndata: {\"choices\":[{\"delta\":{\"content\":\"llo\"}}]}\n\n", "data: [DONE]\n\n"] {
                s.write_all(part.as_bytes()).unwrap();
                s.flush().unwrap();
                std::thread::sleep(Duration::from_millis(20));
            }
            head
        });
        let mut r = req("local");
        r.url = url;
        r.model = "tiny".into();
        let mut seen = Vec::new();
        let stop = AtomicBool::new(false);
        let reply = tauri::async_runtime::block_on(send(&r, &turns(), &stop, |t| seen.push(t.to_string()))).unwrap();
        assert_eq!(reply.text, "Héllo");
        assert_eq!(seen, ["Hé", "llo"]);
        let head = server.join().unwrap();
        assert!(head.starts_with("POST /v1/chat/completions"));
        assert!(head.contains("\"model\":\"tiny\""));
    }
}
