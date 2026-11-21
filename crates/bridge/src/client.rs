use crate::providers::ProviderCapabilityReport;
use anyhow::{Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize)]
pub struct SyncEvent {
    pub event_id: String,
    pub sequence: u64,
    #[serde(rename = "type")]
    pub event_type: String,
    pub entity_id: String,
    pub project_id: Option<String>,
    pub bridge_id: Option<String>,
    pub occurred_at: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EventsResponse {
    pub events: Vec<SyncEvent>,
    pub latest_sequence: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct BridgeRegisterBody {
    pub bridge_id: Option<String>,
    pub name: String,
    pub hostname: String,
    pub platform: String,
    pub bridge_version: String,
    pub providers: Vec<ProviderCapabilityReport>,
    pub authorized_project_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BridgeRegisterResponse {
    pub bridge: BridgeRecord,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BridgeRecord {
    pub id: String,
    pub name: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeliveryAckBody {
    pub entity_type: String,
    pub entity_id: String,
    pub delivery_status: String,
    pub resume_status: Option<String>,
    pub provider_session_id: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct BridgeTaskUpdateBody {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivery_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resume_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub log_chunk: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_kind: Option<String>,
}

#[derive(Clone)]
pub struct BackendClient {
    base_url: String,
    token: String,
    http: Client,
}

impl BackendClient {
    pub fn new(base_url: String, token: String) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            token,
            http: Client::new(),
        }
    }

    pub fn ws_url(&self) -> String {
        let ws = if self.base_url.starts_with("https://") {
            self.base_url.replacen("https://", "wss://", 1)
        } else if self.base_url.starts_with("http://") {
            self.base_url.replacen("http://", "ws://", 1)
        } else {
            format!("wss://{}", self.base_url)
        };
        format!("{}/api/v1/ws?token={}", ws, self.token)
    }

    pub async fn register(&self, body: &BridgeRegisterBody) -> Result<BridgeRecord> {
        let res = self
            .http
            .post(format!("{}/api/v1/bridges/register", self.base_url))
            .bearer_auth(&self.token)
            .json(body)
            .send()
            .await
            .context("Failed to register bridge")?
            .error_for_status()?;
        let parsed: BridgeRegisterResponse = res.json().await?;
        Ok(parsed.bridge)
    }

    pub async fn heartbeat(&self, bridge_id: &str) -> Result<()> {
        self.http
            .post(format!(
                "{}/api/v1/bridges/{}/heartbeat",
                self.base_url, bridge_id
            ))
            .bearer_auth(&self.token)
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    pub async fn fetch_events(&self, after: u64) -> Result<EventsResponse> {
        let res = self
            .http
            .get(format!("{}/api/v1/events?after={}&limit=200", self.base_url, after))
            .bearer_auth(&self.token)
            .send()
            .await?
            .error_for_status()?;
        Ok(res.json().await?)
    }

    pub async fn ack_delivery(&self, body: &DeliveryAckBody) -> Result<()> {
        self.http
            .post(format!("{}/api/v1/bridges/deliveries/ack", self.base_url))
            .bearer_auth(&self.token)
            .json(body)
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    pub async fn update_task(&self, task_id: &str, body: &BridgeTaskUpdateBody) -> Result<()> {
        self.http
            .post(format!(
                "{}/api/v1/bridges/tasks/{}/update",
                self.base_url, task_id
            ))
            .bearer_auth(&self.token)
            .json(body)
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }
}
