import type { AuthContext, ServerEnv } from "./types.js";

export function newId(prefix: string): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}

export function generateSecretToken(prefix: string): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `kx_${prefix}_${b64}`;
}

export function generatePairingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

export function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    return token || null;
  }
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");
  return queryToken ? queryToken.trim() : null;
}

export async function authenticateRequest(
  request: Request,
  env: ServerEnv
): Promise<AuthContext | null> {
  const token = extractBearerToken(request);
  if (!token) return null;

  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT id, owner_id, label, scope, device_platform, agent_id, bridge_id, allowed_project_ids_json, revoked_at
     FROM credentials WHERE token_hash = ?`
  )
    .bind(hash)
    .first<{
      id: string;
      owner_id: string;
      label: string;
      scope: AuthContext["scope"];
      device_platform: string | null;
      agent_id: string | null;
      bridge_id: string | null;
      allowed_project_ids_json: string | null;
      revoked_at: string | null;
    }>();

  if (!row || row.revoked_at !== null) {
    return null;
  }

  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE credentials SET last_used_at = ? WHERE id = ?`)
    .bind(now, row.id)
    .run();

  let allowedProjects: string[] | null = null;
  if (row.allowed_project_ids_json) {
    try {
      const parsed = JSON.parse(row.allowed_project_ids_json);
      if (Array.isArray(parsed)) {
        allowedProjects = parsed.map(String);
      }
    } catch {
      allowedProjects = null;
    }
  }

  return {
    credential_id: row.id,
    owner_id: row.owner_id,
    label: row.label,
    scope: row.scope,
    device_platform: row.device_platform,
    agent_id: row.agent_id,
    bridge_id: row.bridge_id,
    allowed_project_ids: allowedProjects,
  };
}

export function canAccessProject(auth: AuthContext, projectId: string): boolean {
  if (auth.scope === "owner" || auth.scope === "device" || auth.scope === "bridge") {
    return true;
  }
  if (!auth.allowed_project_ids || auth.allowed_project_ids.length === 0) {
    return true;
  }
  return auth.allowed_project_ids.includes(projectId);
}
