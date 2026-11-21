pub mod client;
pub mod config;
pub mod discovery;
pub mod providers;
pub mod runner;

pub use config::{BridgeConfig, SessionBinding};
pub use discovery::{
    configure_codex_local_mcp, discover_local_environment, DiscoveredProject, DiscoveredSession,
    ImportedMessage, LocalDiscoveryReport,
};
pub use providers::ProviderCapabilityReport;
pub use runner::BridgeRunner;
