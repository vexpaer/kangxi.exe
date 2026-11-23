import type { SyncEvent } from "@kangxi/protocol";
import type { ServerEnv } from "./types.js";

/**
 * Optional metadata-only FCM push notification for Android background wake.
 * Strictly avoids placing sensitive memorial contents into third-party push payloads.
 */
export async function sendOptionalFcmWake(
  env: ServerEnv,
  ownerId: string,
  event: SyncEvent
): Promise<void> {
  if (!env.FCM_PROJECT_ID || !env.FCM_ACCESS_TOKEN) {
    return;
  }
  if (event.type !== "memorial.created" && event.type !== "task.updated") {
    return;
  }

  const rows = await env.DB.prepare(
    `SELECT fcm_token FROM credentials
     WHERE owner_id = ? AND scope IN ('device', 'owner')
       AND device_platform = 'android'
       AND revoked_at IS NULL
       AND fcm_token IS NOT NULL AND fcm_token != ''`
  )
    .bind(ownerId)
    .all<{ fcm_token: string }>();

  const tokens = (rows.results ?? []).map((r) => r.fcm_token);
  if (tokens.length === 0) return;

  const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(env.FCM_PROJECT_ID)}/messages:send`;

  await Promise.allSettled(
    tokens.map((token) =>
      fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.FCM_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token,
            notification: {
              title: "KangXi.exe",
              body:
                event.type === "memorial.created"
                  ? "新奏折呈递，请移步御览"
                  : "任务状态已更新",
            },
            data: {
              event_id: event.event_id,
              sequence: String(event.sequence),
              type: event.type,
              entity_id: event.entity_id,
            },
          },
        }),
      })
    )
  );
}
