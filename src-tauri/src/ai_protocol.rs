//! Wire formats are independent of provider-specific reasoning parameters.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
pub enum ApiFormat {
    #[default]
    #[serde(rename = "openai-completions")]
    Completions,
    #[serde(rename = "openai-responses")]
    Responses,
    #[serde(rename = "anthropic-messages")]
    Messages,
}
impl ApiFormat {
    pub fn path(self, base: &str) -> Result<String, String> {
        let base = base.trim_end_matches('/');
        let suffix = match self { Self::Completions => "/chat/completions", Self::Responses => "/responses", Self::Messages => "/messages" };
        for known in ["/chat/completions", "/responses", "/messages"] {
            if base.ends_with(known) {
                return if known == suffix { Ok(base.into()) } else { Err("完整接口地址与 API 格式不匹配，请修改地址或格式 / Endpoint does not match API format".into()) };
            }
        }
        let prefix = if base.is_empty() { "/v1".to_string() }
            else if self == Self::Messages && !base.ends_with("/v1") { format!("{base}/v1") }
            else { base.into() };
        Ok(format!("{prefix}{suffix}"))
    }
}
pub fn convert_body(format: ApiFormat, mut body: Value) -> Value {
    match format {
        ApiFormat::Completions => body,
        ApiFormat::Responses => {
            let messages = body.as_object_mut().unwrap().remove("messages").unwrap();
            body["input"] = messages;
            body["store"] = json!(false);
            if let Some(effort) = body.as_object_mut().unwrap().remove("reasoning_effort") { body["reasoning"] = json!({"effort": effort}); }
            body
        }
        ApiFormat::Messages => {
            let messages = body.as_object_mut().unwrap().remove("messages").unwrap();
            let (system, conversation): (Vec<_>, Vec<_>) = messages.as_array().unwrap().iter().cloned().partition(|m| m["role"] == "system");
            body["system"] = json!(system.iter().filter_map(|m| m["content"].as_str()).collect::<Vec<_>>().join("\n\n"));
            body["messages"] = json!(conversation);
            body["max_tokens"] = json!(4096);
            body
        }
    }
}
pub fn headers(format: ApiFormat, key: &str) -> String {
    let mut headers = "Content-Type: application/json\r\nAccept: application/json\r\n".to_owned();
    if format == ApiFormat::Messages {
        headers.push_str("anthropic-version: 2023-06-01\r\n");
        if !key.is_empty() { headers.push_str(&format!("x-api-key: {key}\r\n")); }
    } else if !key.is_empty() { headers.push_str(&format!("Authorization: Bearer {key}\r\n")); }
    headers
}
pub fn response_text(bytes: &[u8], format: ApiFormat) -> Result<String, String> {
    let value: Value = serde_json::from_slice(bytes).map_err(|_| "接口未返回 JSON，请检查地址与 API 格式 / API did not return JSON; check endpoint and format")?;
    if value.get("error").is_some_and(|v| !v.is_null()) || value["type"] == "error" { return Err("接口返回错误对象 / API returned an error object".into()); }
    let blocks = |content: &Value, kind: &str| -> String {
        content.as_array().into_iter().flatten().filter(|b| b["type"] == kind).filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join("")
    };
    let text = match format {
        ApiFormat::Completions => {
            let message = &value["choices"][0];
            if message["finish_reason"] == "length" { return Err("模型输出被截断，请提高服务端输出上限 / Model output was truncated".into()); }
            let content = &message["message"]["content"];
            content.as_str().map(str::to_owned).unwrap_or_else(|| blocks(content, "text"))
        }
        ApiFormat::Responses => {
            if value.get("status").is_some_and(|s| s != "completed") { return Err("Responses 请求未完成或输出被截断 / Response is incomplete or failed".into()); }
            value["output"].as_array().into_iter().flatten().filter(|item| item["type"] == "message" && item["role"] == "assistant").map(|item| blocks(&item["content"], "output_text")).collect::<Vec<_>>().join("\n")
        }
        ApiFormat::Messages => {
            if value["stop_reason"] == "max_tokens" { return Err("模型输出达到 max_tokens 上限 / Model output was truncated at max_tokens".into()); }
            if value["role"] != "assistant" { return Err("Messages 响应缺少 assistant 角色 / Invalid Messages response".into()); }
            blocks(&value["content"], "text")
        }
    };
    if text.trim().is_empty() { return Err("接口响应没有可用文本，请检查 API 格式或模型（仅推理/工具调用不算对话回复） / No text response; check API format or model".into()); }
    Ok(text)
}
pub fn status_error(status: u32) -> String {
    let hint = match status {
        301..=399 => "接口发生重定向，已阻止转发密钥，请填写最终地址 / Redirect blocked; use the final endpoint",
        400 | 422 => "请求格式、模型或推理参数不支持 / Check format, model and reasoning parameters",
        401 => "API Key 无效或缺失 / API key invalid or missing",
        403 => "接口权限不足或访问被拒绝 / Access denied",
        404 | 405 => "接口路径、API 格式或模型不存在 / Check endpoint path, format and model",
        408 | 504 => "服务端处理超时 / Provider timeout",
        429 => "请求限流或额度不足 / Rate limit or quota exceeded",
        500..=599 => "模型服务暂时不可用 / Provider unavailable",
        _ => "请求失败，请检查服务配置 / Request failed; check service configuration",
    };
    format!("HTTP {status} · {hint}")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn base_urls_full_urls_and_mismatched_formats() {
        for (format, base, expected) in [
            (ApiFormat::Completions, "", "/v1/chat/completions"),
            (ApiFormat::Completions, "/v1/", "/v1/chat/completions"),
            (ApiFormat::Responses, "/gateway/v1", "/gateway/v1/responses"),
            (ApiFormat::Responses, "/v1/responses/", "/v1/responses"),
            (ApiFormat::Messages, "/anthropic", "/anthropic/v1/messages"),
            (ApiFormat::Messages, "/anthropic/messages", "/anthropic/messages"),
            (ApiFormat::Messages, "/v1", "/v1/messages"),
        ] { assert_eq!(format.path(base).unwrap(), expected); }
        assert!(ApiFormat::Messages.path("/v1/chat/completions").is_err());
        assert!(ApiFormat::Responses.path("/v1/messages").is_err());
    }
    #[test]
    fn wire_formats_preserve_system_and_conversation_without_foreign_fields() {
        let body = json!({"model":"test", "stream":false, "messages":[{"role":"system","content":"rules"},{"role":"user","content":"one"},{"role":"assistant","content":"two"},{"role":"user","content":"three"}]});
        let messages = convert_body(ApiFormat::Messages, body.clone());
        assert_eq!(messages["system"], "rules"); assert_eq!(messages["messages"].as_array().unwrap().len(), 3);
        assert_eq!(messages["max_tokens"], 4096); assert!(messages.get("input").is_none());
        let mut openai = body.clone(); openai["reasoning_effort"] = json!("high");
        let responses = convert_body(ApiFormat::Responses, openai);
        assert_eq!(responses["input"], body["messages"]); assert_eq!(responses["reasoning"]["effort"], "high");
        assert_eq!(responses["store"], false); assert!(responses.get("messages").is_none()); assert!(responses.get("reasoning_effort").is_none());
        assert_eq!(convert_body(ApiFormat::Completions, body.clone()), body);
    }
    #[test]
    fn reads_only_final_text_and_rejects_wrong_empty_or_incomplete_envelopes() {
        let parse = |format, value: Value| response_text(&serde_json::to_vec(&value).unwrap(), format);
        assert_eq!(parse(ApiFormat::Completions, json!({"choices":[{"message":{"content":[{"type":"text","text":"OK"}]}}]})).unwrap(), "OK");
        assert_eq!(parse(ApiFormat::Responses, json!({"status":"completed","output":[{"type":"reasoning","summary":[{"text":"private"}]},{"type":"message","role":"assistant","content":[{"type":"output_text","text":"OK"}]}]})).unwrap(), "OK");
        assert_eq!(parse(ApiFormat::Messages, json!({"role":"assistant","content":[{"type":"thinking","thinking":"private"},{"type":"text","text":"OK"}]})).unwrap(), "OK");
        for value in [json!({}), json!({"error":{"message":"secret"}}), json!({"status":"incomplete","output":[]})] { assert!(parse(ApiFormat::Responses, value).is_err()); }
        assert!(parse(ApiFormat::Messages, json!({"role":"assistant","stop_reason":"max_tokens","content":[{"type":"text","text":"partial"}]})).is_err());
        assert!(response_text(b"<html>login</html>", ApiFormat::Completions).is_err());
    }
    #[test]
    fn authentication_headers_match_format() {
        let headers = headers(ApiFormat::Messages, "test-only");
        assert!(headers.contains("x-api-key: test-only\r\n")); assert!(headers.contains("anthropic-version: 2023-06-01"));
        assert!(!headers.contains("Authorization"));
        assert!(super::headers(ApiFormat::Responses, "test-only").contains("Authorization: Bearer test-only"));
        assert!(!super::headers(ApiFormat::Completions, "").contains("Authorization"));
    }
}
