use super::protocol::{self, ApiFormat};
use serde_json::Value;

// WinHTTP may split an event anywhere, including in the middle of a UTF-8 character.
pub(super) struct Decoder {
    format: ApiFormat,
    json: Option<bool>,
    prefix: Vec<u8>,
    line: Vec<u8>,
    data: String,
    previous_cr: bool,
    finished: bool,
    pub text: String,
}

impl Decoder {
    pub fn new(format: ApiFormat) -> Self {
        Self {
            format,
            json: None,
            prefix: Vec::new(),
            line: Vec::new(),
            data: String::new(),
            previous_cr: false,
            finished: false,
            text: String::new(),
        }
    }

    pub fn push(&mut self, bytes: &[u8]) -> Result<bool, String> {
        match self.json {
            Some(true) => self.prefix.extend_from_slice(bytes),
            Some(false) => self.parse(bytes)?,
            None => {
                self.prefix.extend_from_slice(bytes);
                let buffer = self
                    .prefix
                    .strip_prefix(&[0xef, 0xbb, 0xbf])
                    .unwrap_or(&self.prefix);
                if [0xef, 0xbb, 0xbf].starts_with(buffer) {
                    return Ok(false);
                }
                let Some(offset) = buffer.iter().position(|b| !b.is_ascii_whitespace()) else {
                    self.prefix.clear();
                    return Ok(false);
                };
                let buffer = buffer[offset..].to_owned();
                self.prefix.clear();
                self.json = Some(buffer[0] == b'{');
                if self.json == Some(true) {
                    self.prefix = buffer;
                } else {
                    self.parse(&buffer)?;
                }
            }
        }
        Ok(self.finished)
    }

    fn parse(&mut self, bytes: &[u8]) -> Result<(), String> {
        for &byte in bytes {
            if self.finished {
                break;
            }
            if byte == b'\r' || byte == b'\n' {
                if byte != b'\n' || !self.previous_cr {
                    self.end_line()?;
                }
                self.previous_cr = byte == b'\r';
            } else {
                self.previous_cr = false;
                self.line.push(byte);
            }
        }
        Ok(())
    }

    fn end_line(&mut self) -> Result<(), String> {
        if self.line.is_empty() {
            if !self.data.is_empty() {
                let data = std::mem::take(&mut self.data);
                self.event(data.trim_end_matches('\n'))?;
            }
        } else {
            let line = std::str::from_utf8(&self.line).map_err(|_| "流式响应不是有效的 UTF-8")?;
            if let Some(value) = line.strip_prefix("data:") {
                self.data.push_str(value.strip_prefix(' ').unwrap_or(value));
                self.data.push('\n');
            }
            self.line.clear();
        }
        Ok(())
    }

    fn event(&mut self, data: &str) -> Result<(), String> {
        if data.trim().is_empty() {
            return Ok(());
        }
        if self.format == ApiFormat::Completions && data.trim() == "[DONE]" {
            self.finished = true;
            return Ok(());
        }
        let v: Value =
            serde_json::from_str(data).map_err(|_| "流式事件格式无效 / Invalid stream event")?;
        let kind = v["type"].as_str().unwrap_or_default();
        if v.get("error").is_some_and(|e| !e.is_null())
            || matches!(kind, "error" | "response.failed" | "response.incomplete")
        {
            return Err("模型服务中断了回复 / Provider interrupted the response".into());
        }
        match self.format {
            ApiFormat::Completions => {
                if let Some(choice) = v["choices"]
                    .as_array()
                    .and_then(|items| items.iter().find(|c| c["index"].as_u64().unwrap_or(0) == 0))
                {
                    if matches!(
                        choice["finish_reason"].as_str(),
                        Some("length" | "content_filter" | "tool_calls" | "function_call")
                    ) {
                        return Err(
                            "模型未完成文本回复 / Model did not complete a text response".into(),
                        );
                    }
                    if let Some(text) = choice["delta"]["content"].as_str() {
                        self.text.push_str(text);
                    }
                }
            }
            ApiFormat::Responses => match kind {
                "response.output_text.delta" => {
                    if let Some(text) = v["delta"].as_str() {
                        self.text.push_str(text);
                    }
                }
                "response.completed" => {
                    if let Some(response) = v.get("response") {
                        if response.get("output").is_some() {
                            self.text = protocol::response_text(
                                &serde_json::to_vec(response).map_err(|e| e.to_string())?,
                                self.format,
                            )?;
                        } else if response["status"]
                            .as_str()
                            .is_some_and(|status| status != "completed")
                        {
                            return Err("Responses 回复未完成".into());
                        }
                    }
                    self.finished = true;
                }
                _ => (),
            },
            ApiFormat::Messages => match kind {
                "content_block_start" if v["content_block"]["type"] == "text" => {
                    if let Some(text) = v["content_block"]["text"].as_str() {
                        self.text.push_str(text);
                    }
                }
                "content_block_delta" if v["delta"]["type"] == "text_delta" => {
                    if let Some(text) = v["delta"]["text"].as_str() {
                        self.text.push_str(text);
                    }
                }
                "message_delta"
                    if matches!(
                        v["delta"]["stop_reason"].as_str(),
                        Some(
                            "max_tokens"
                                | "model_context_window_exceeded"
                                | "tool_use"
                                | "pause_turn"
                        )
                    ) =>
                {
                    return Err("Messages 回复未完成 / Messages response is incomplete".into());
                }
                "message_stop" => self.finished = true,
                _ => (),
            },
        }
        Ok(())
    }

    pub fn finish(self) -> Result<String, String> {
        if self.json == Some(true) {
            return protocol::response_text(&self.prefix, self.format);
        }
        if !self.finished {
            return Err("连接在回复结束前中断 / Stream ended before the completion event".into());
        }
        if self.text.trim().is_empty() {
            return Err("模型没有返回正文 / No text in response".into());
        }
        Ok(self.text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn split_utf8_multiline_data_crlf_and_keepalive() {
        let wire = "\u{feff}: keepalive\r\nevent: chunk\r\ndata: {\"choices\":\r\ndata: [{\"delta\":{\"content\":\"测试🌟\"}}]}\r\n\r\ndata: [DONE]\r\r";
        let mut d = Decoder::new(ApiFormat::Completions);
        for byte in wire.as_bytes().chunks(1) {
            d.push(byte).unwrap();
        }
        assert_eq!(d.finish().unwrap(), "测试🌟");
    }
    #[test]
    fn incomplete_streams_and_reasoning_alone_are_not_final_answers() {
        let mut d = Decoder::new(ApiFormat::Responses);
        d.push(b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n")
            .unwrap();
        assert!(d.finish().is_err());
        let mut d = Decoder::new(ApiFormat::Messages);
        d.push(b"data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"private\"}}\n\ndata: {\"type\":\"message_stop\"}\n\n").unwrap();
        assert!(d.text.is_empty() && d.finish().is_err());
        let mut d = Decoder::new(ApiFormat::Messages);
        assert!(d.push(b"data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"max_tokens\"}}\n\n").is_err());
    }
    #[test]
    fn compatibility_response_in_one_json_document() {
        let mut d = Decoder::new(ApiFormat::Completions);
        for part in br#"{"choices":[{"message":{"content":"OK"}}]}"#.chunks(3) {
            d.push(part).unwrap();
        }
        assert_eq!(d.finish().unwrap(), "OK");
    }
}
