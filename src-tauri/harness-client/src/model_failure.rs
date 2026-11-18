use serde_json::Value;
use std::{error::Error, fmt};

/// Only these categories may cross from a provider failure into history or diagnostics.
#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum ModelFailure {
    Authentication,
    Balance,
    Forbidden,
    ModelOrRoute,
    InvalidRequest,
    RateLimit,
    Unavailable,
    Timeout,
    Connection,
    EmptyReply,
    Unknown,
}

impl ModelFailure {
    pub(crate) fn from_event(error: &Value) -> Self {
        // A provider message can contain the request, endpoint or credential. Never
        // display it or try to infer a diagnosis by searching free-form text.
        match error.get("status").and_then(Value::as_u64) {
            Some(401) => Self::Authentication,
            Some(402) => Self::Balance,
            Some(403) => Self::Forbidden,
            Some(404) => Self::ModelOrRoute,
            Some(400 | 413 | 422) => Self::InvalidRequest,
            Some(429) => Self::RateLimit,
            Some(408 | 504) => Self::Timeout,
            Some(500..=599) => Self::Unavailable,
            Some(_) => Self::Unknown,
            None => match error["code"].as_str() {
                Some("AUTH") => Self::Authentication,
                Some("QUOTA") => Self::Balance,
                Some("RATE_LIMIT") => Self::RateLimit,
                Some("SERVER") => Self::Unavailable,
                Some("TIMEOUT") => Self::Timeout,
                Some("TRANSPORT") => Self::Connection,
                Some("EMPTY_RESPONSE") => Self::EmptyReply,
                _ => Self::Unknown,
            },
        }
    }

    pub fn diagnostic_code(self) -> &'static str {
        match self {
            Self::Authentication => "auth",
            Self::Balance => "quota",
            Self::Forbidden => "forbidden",
            Self::ModelOrRoute => "not-found",
            Self::InvalidRequest => "request",
            Self::RateLimit => "rate-limit",
            Self::Unavailable => "service",
            Self::Timeout => "timeout",
            Self::Connection => "connection",
            Self::EmptyReply => "empty-reply",
            Self::Unknown => "unknown",
        }
    }
}

impl fmt::Display for ModelFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Authentication => "模型服务未接受密钥，请在模型设置中核对 API Key",
            Self::Balance => "模型账户余额或额度不足，请检查该密钥所属账户",
            Self::Forbidden => "当前账户没有访问权限，请核对模型和密钥的授权",
            Self::ModelOrRoute => "模型服务找不到请求的资源，请核对端点和模型名称",
            Self::InvalidRequest => "模型服务拒绝了请求参数，请核对模型设置或缩小输入范围",
            Self::RateLimit => "模型服务已限流，请稍后再手动提交",
            Self::Unavailable => "模型服务暂时不可用，请稍后再手动提交",
            Self::Timeout => "模型服务未及时回应，请检查连接；已发出的请求可能仍计费",
            Self::Connection => {
                "无法完成与模型服务的连接，请检查网络和端点；已发出的请求可能仍计费"
            }
            Self::EmptyReply => "模型没有返回可用回答，请检查模型设置后再手动提交",
            Self::Unknown => "模型请求失败，服务未提供可识别的错误类别；请检查模型设置",
        })
    }
}

impl Error for ModelFailure {}
