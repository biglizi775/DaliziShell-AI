//! One queued prompt on one exclusive Harness SDK process. The caller owns
//! launch policy, an overall deadline, process disposal and durable routing.

mod model_failure;
#[cfg(windows)]
pub mod runtime;
#[cfg(windows)]
pub mod snapshot;
pub use model_failure::ModelFailure;

use serde_json::{json, Value};
use std::io::{self, ErrorKind};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWrite, AsyncWriteExt};

const FRAME_LIMIT: usize = 1024 * 1024;
const EARLY_LIMIT: usize = 4 * FRAME_LIMIT;

fn invalid(reason: &'static str) -> io::Error {
    io::Error::new(ErrorKind::InvalidData, reason)
}

struct Wire<R, W> {
    input: R,
    output: W,
}

impl<R: AsyncBufRead + Unpin, W: AsyncWrite + Unpin> Wire<R, W> {
    async fn send(&mut self, id: u64, method: &str, params: Value) -> io::Result<()> {
        let mut frame =
            serde_json::to_vec(&json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))?;
        frame.push(b'\n');
        self.output.write_all(&frame).await?;
        self.output.flush().await
    }

    async fn next(&mut self) -> io::Result<(Value, usize)> {
        let mut bytes = Vec::new();
        loop {
            let segment = self.input.fill_buf().await?;
            if segment.is_empty() {
                return Err(io::Error::new(
                    ErrorKind::UnexpectedEof,
                    "runtime closed its output",
                ));
            }
            let newline = segment.iter().position(|&b| b == b'\n');
            let len = newline.unwrap_or(segment.len());
            if bytes.len() + len > FRAME_LIMIT {
                return Err(invalid("oversized RPC frame"));
            }
            bytes.extend_from_slice(&segment[..len]);
            self.input.consume(len + usize::from(newline.is_some()));
            if newline.is_some() {
                break;
            }
        }
        let frame: Value = serde_json::from_slice(&bytes)?;
        if frame["jsonrpc"] != "2.0" {
            return Err(invalid("invalid JSON-RPC version"));
        }
        Ok((frame, bytes.len()))
    }

    async fn response(
        &mut self,
        id: u64,
        mut observe: impl FnMut(Value, usize) -> io::Result<()>,
    ) -> io::Result<Value> {
        loop {
            let (mut frame, size) = self.next().await?;
            if frame.get("id").is_none() && frame["method"].is_string() {
                observe(frame, size)?;
            } else if frame["id"].as_u64() != Some(id) || frame.get("method").is_some() {
                return Err(invalid("unexpected RPC id or server request"));
            } else if frame.get("error").is_some() || frame.get("result").is_none() {
                return Err(invalid("runtime rejected RPC request"));
            } else {
                return Ok(frame["result"].take());
            }
        }
    }
}

#[derive(Default)]
struct Activity {
    admitted: bool,
    reply: Option<String>,
    completed: bool,
    idle: bool,
}

impl Activity {
    fn observe(&mut self, frame: &Value, session: &str, receipt: &str) -> io::Result<()> {
        let params = &frame["params"];
        if params["sessionId"] != session {
            return Ok(());
        }
        if frame["method"] == "session.status" {
            self.idle = self.admitted && params["status"] == "idle";
            return Ok(());
        }
        if frame["method"] != "session.event" {
            return Ok(());
        }
        let event = &params["event"];
        let data = &event["data"];
        match event["type"].as_str() {
            Some("agent/inbox/spliced") => {
                self.admitted |= data["inserted"]
                    .as_array()
                    .is_some_and(|items| items.iter().any(|m| m["id"] == receipt));
            }
            Some("assistant/message") if self.admitted => {
                let blocks = data["message"]["content"]
                    .as_array()
                    .ok_or_else(|| invalid("missing assistant content"))?;
                let mut text = String::new();
                for block in blocks.iter().filter(|b| b["type"] == "text") {
                    text.push_str(
                        block["text"]
                            .as_str()
                            .ok_or_else(|| invalid("invalid text block"))?,
                    );
                }
                self.reply = Some(text);
            }
            Some("turn/end") if self.admitted => {
                if data["reason"]["kind"] == "error" {
                    return Err(io::Error::other(ModelFailure::from_event(
                        &data["reason"]["error"],
                    )));
                }
                if data["reason"]["kind"] != "completed" {
                    return Err(invalid("turn did not complete"));
                }
                self.completed = true;
            }
            _ => {}
        }
        Ok(())
    }
}

/// Initialize the pinned wire version, admit one prompt and return its committed
/// text only after both the matching turn and the shutdown handshake finish.
pub async fn run_prompt(
    input: impl AsyncBufRead + Unpin,
    output: impl AsyncWrite + Unpin,
    cwd: &str,
    model: &str,
    session: &str,
    prompt: &str,
) -> io::Result<String> {
    let mut wire = Wire { input, output };
    wire.send(
        1,
        "initialize",
        json!({"cwd":cwd,"provider":"deepseek-official","model":model}),
    )
    .await?;
    let info = wire.response(1, |_, _| Ok(())).await?;
    if info["serverInfo"]["name"] != "deepseek-harness-sdk-runtime"
        || info["serverInfo"]["version"] != "0.0.1"
    {
        return Err(invalid("unsupported runtime wire identity"));
    }
    wire.send(
        2,
        "session/prompt",
        json!({"sessionId":session,"contentBlocks":[{"type":"text","text":prompt}]}),
    )
    .await?;
    let mut early = Vec::new();
    let mut total = 0;
    let ack = wire
        .response(2, |frame, size| {
            if frame["params"]["sessionId"] == session {
                total += size;
                if total > EARLY_LIMIT || early.len() >= 1024 {
                    return Err(invalid("too many pre-receipt events"));
                }
                early.push(frame);
            }
            Ok(())
        })
        .await?;
    let receipt = ack["messageId"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| invalid("missing enqueue receipt"))?;
    let mut activity = Activity::default();
    for frame in early {
        activity.observe(&frame, session, receipt)?;
    }
    // wait alone may settle before admission. Observe the actual input and idle transition first.
    while !(activity.completed && activity.idle) {
        let (frame, _) = wire.next().await?;
        if frame.get("id").is_some() {
            return Err(invalid("unexpected RPC during turn"));
        }
        activity.observe(&frame, session, receipt)?;
    }
    wire.send(3, "session/wait", json!({"sessionId":session}))
        .await?;
    wire.response(3, |f, _| activity.observe(&f, session, receipt))
        .await?;
    wire.send(4, "shutdown", json!({})).await?;
    wire.response(4, |_, _| Ok(())).await?;
    activity
        .reply
        .filter(|s| !s.is_empty())
        .ok_or_else(|| invalid("no committed assistant reply"))
}
