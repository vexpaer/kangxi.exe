use anyhow::Result;
use kangxi_bridge::{BridgeConfig, BridgeRunner};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::watch;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let mut args = std::env::args().skip(1);
    let mut config_path = PathBuf::from("kangxi-bridge.json");

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--config" | "-c" => {
                if let Some(val) = args.next() {
                    config_path = PathBuf::from(val);
                }
            }
            "--probe" => {
                let dummy = BridgeConfig {
                    server_url: String::new(),
                    bridge_token: String::new(),
                    bridge_id: None,
                    bridge_name: "probe".into(),
                    hostname: "localhost".into(),
                    authorized_projects: Default::default(),
                    last_sequence: 0,
                    session_bindings: Default::default(),
                    codex_bin: None,
                    claude_bin: None,
                };
                let runner = BridgeRunner::new(dummy, None);
                let reports = runner.probe_providers().await;
                println!("{}", serde_json::to_string_pretty(&reports)?);
                return Ok(());
            }
            "--help" | "-h" => {
                println!(
                    "kangxi-bridge v{}\n\nUsage:\n  kangxi-bridge --config <path/to/kangxi-bridge.json>\n  kangxi-bridge --probe",
                    env!("CARGO_PKG_VERSION")
                );
                return Ok(());
            }
            _ => {}
        }
    }

    let config = BridgeConfig::load(&config_path)?;
    let runner = Arc::new(BridgeRunner::new(config, Some(config_path)));

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    tokio::spawn(async move {
        let _ = tokio::signal::ctrl_c().await;
        let _ = shutdown_tx.send(true);
    });

    runner.run_until_shutdown(shutdown_rx).await
}
