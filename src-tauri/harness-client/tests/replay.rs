use dalizi_harness_client::run_prompt;
use std::io::ErrorKind;

// Minimal synthetic wire trace; the durable admission can precede the RPC receipt.
const TRACE: &str = include_str!("snapshot-only.jsonl");

async fn replay(trace: &[u8]) -> std::io::Result<String> {
    run_prompt(
        trace,
        tokio::io::sink(),
        "C:/sample",
        "mock",
        "session-A",
        "snapshot",
    )
    .await
}

#[tokio::test]
async fn late_enqueue_ack_still_routes_only_the_owning_sessions_reply() {
    assert_eq!(replay(TRACE.as_bytes()).await.unwrap(), "answer A");
}

#[tokio::test]
async fn idle_without_a_matching_inbox_receipt_is_not_a_success() {
    let trace = TRACE.replace(r#""messageId":"message-A""#, r#""messageId":"other""#);
    assert!(replay(trace.as_bytes()).await.is_err());
}

#[tokio::test]
async fn abort_after_partial_assistant_text_does_not_publish_success() {
    let trace = TRACE.replace(r#""kind":"completed""#, r#""kind":"aborted""#);
    assert_eq!(
        replay(trace.as_bytes()).await.unwrap_err().kind(),
        ErrorKind::InvalidData
    );
}

#[tokio::test]
async fn incompatible_handshake_cannot_submit_a_prompt() {
    let trace = TRACE.replace("0.0.1", "unknown-version");
    let mut sent = Vec::new();
    let result = run_prompt(
        trace.as_bytes(),
        &mut sent,
        "C:/sample",
        "mock",
        "session-A",
        "snapshot",
    )
    .await;
    assert_eq!(result.unwrap_err().kind(), ErrorKind::InvalidData);
    assert!(!String::from_utf8(sent).unwrap().contains("session/prompt"));
}

#[tokio::test]
async fn a_truncated_turn_is_not_retried() {
    let incomplete = TRACE.lines().take(5).collect::<Vec<_>>().join("\n") + "\n";
    assert_eq!(
        replay(incomplete.as_bytes()).await.unwrap_err().kind(),
        ErrorKind::UnexpectedEof
    );
}

#[tokio::test]
async fn unterminated_oversized_input_fails_without_reading_an_unbounded_line() {
    assert_eq!(
        replay(&vec![b'x'; 1024 * 1024 + 1])
            .await
            .unwrap_err()
            .kind(),
        ErrorKind::InvalidData
    );
}

#[tokio::test]
async fn failed_turn_uses_only_the_admitted_sessions_typed_error() {
    let trace = TRACE.replace(
        r#""kind":"completed""#,
        r#""kind":"error","error":{"code":"SERVER","status":401,"message":"PRIVATE_KEY_OR_PROVIDER_BODY"}"#,
    );
    let other = r#"{"jsonrpc":"2.0","method":"session.event","params":{"sessionId":"session-B","event":{"type":"turn/end","data":{"reason":{"kind":"error","error":{"status":402}}}}}}"#;
    let trace = trace.replace(
        r#"{"jsonrpc":"2.0","id":2"#,
        &format!("{other}\n{}", r#"{"jsonrpc":"2.0","id":2"#),
    );
    let error = replay(trace.as_bytes()).await.unwrap_err();
    let cause = error
        .get_ref()
        .unwrap()
        .downcast_ref::<dalizi_harness_client::ModelFailure>()
        .unwrap();
    assert_eq!(cause.diagnostic_code(), "auth");
    assert!(!format!("{error:?}").contains("PRIVATE_KEY_OR_PROVIDER_BODY"));
}

#[tokio::test]
async fn unknown_provider_failure_never_treats_freeform_body_as_a_diagnosis_or_answer() {
    let trace = TRACE.replace(
        r#""kind":"completed""#,
        r#""kind":"error","error":{"code":"PRIVATE_401","message":"401 invalid key: PRIVATE"}"#,
    );
    let error = replay(trace.as_bytes()).await.unwrap_err();
    let cause = error
        .get_ref()
        .unwrap()
        .downcast_ref::<dalizi_harness_client::ModelFailure>()
        .unwrap();
    assert_eq!(cause.diagnostic_code(), "unknown");
    assert!(!format!("{error:?}").contains("PRIVATE"));
}
