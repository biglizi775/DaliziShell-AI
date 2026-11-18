//! Keyless diagnostic; never reads the desktop application's settings or keys.
use dalizi_harness_client::run_prompt;
use std::{env, error::Error, path::Path, process::Stdio, time::Duration};
use tokio::{io::BufReader, process::Command, time::timeout};

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = env::args().skip(1).collect();
    let [node, dsh, overlay, root, port] = args.as_slice() else {
        return Err(
            "expected node, dsh entry, profile overlay, temporary directory, loopback port".into(),
        );
    };
    let port: u16 = port.parse()?;
    let dir = Path::new(root);
    let workspace = dir.join("workspace");
    let mut command = Command::new(node);
    command.env_clear();
    for key in ["SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"] {
        if let Some(val) = env::var_os(key) {
            command.env(key, val);
        }
    }
    command
        .args([dsh, "--profile", "sdk-minimal", "--patch", overlay])
        .current_dir(dir.join("launch"))
        .env(
            "PATH",
            Path::new(node).parent().ok_or("missing node directory")?,
        )
        .env("USERPROFILE", dir)
        .env("HOME", dir)
        .env("APPDATA", dir.join("roaming"))
        .env("LOCALAPPDATA", dir.join("local"))
        .env("TEMP", dir.join("temp"))
        .env("TMP", dir.join("temp"))
        .env("DSH_HOME", dir.join("home"))
        .env("DSH_AGENTS_HOME", dir.join("agents"))
        .env("DSH_TELEMETRY_DISABLED", "1")
        .env("DEEPSEEK_BASE_URL", format!("http://127.0.0.1:{port}"))
        .env("DEEPSEEK_API_KEY", "local-test-only")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let mut child = command.spawn()?;
    let input = BufReader::new(child.stdout.take().ok_or("missing stdout")?);
    let output = child.stdin.take().ok_or("missing stdin")?;
    let result = timeout(
        Duration::from_secs(45),
        run_prompt(
            input,
            output,
            workspace.to_str().ok_or("invalid workspace path")?,
            "deepseek-v4-pro",
            "dalizi-m0",
            "Analyze the selected snapshot: DALIZI_SELECTED_A",
        ),
    )
    .await;
    match result {
        Ok(Ok(reply)) => {
            let status = timeout(Duration::from_secs(10), child.wait()).await??;
            if !status.success() {
                return Err("runtime did not exit cleanly".into());
            }
            println!("{reply}");
            Ok(())
        }
        other => {
            if child.try_wait()?.is_none() {
                child.kill().await?;
            }
            Err(match other {
                Ok(Err(error)) => error.into(),
                _ => "SDK turn timed out".into(),
            })
        }
    }
}
