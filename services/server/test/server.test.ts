import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startKangXiServer, type RunningKangXiServer } from "../src/server.js";

describe("Standalone Node/SQLite KangXi server E2E", () => {
  let srv: RunningKangXiServer | null = null;

  afterEach(async () => {
    if (srv) {
      await srv.close();
      srv = null;
    }
  });

  it("auto-seeds admin from env, logs in with username+password, enforces rate limit, streams WS events, and changes password with device revocation", async () => {
    srv = await startKangXiServer({
      host: "127.0.0.1",
      port: 0,
      dbPath: ":memory:",
      username: "emperor",
      password: "StrongPassword123!",
      ownerName: "康熙",
    });

    // 1. Health reports bootstrapped + password_auth + node runtime
    const healthRes = await fetch(`${srv.url}/health`);
    expect(healthRes.status).toBe(200);
    const health = (await healthRes.json()) as {
      ok: boolean;
      runtime: string;
      bootstrapped: boolean;
      password_auth: boolean;
    };
    expect(health.ok).toBe(true);
    expect(health.runtime).toBe("node");
    expect(health.bootstrapped).toBe(true);
    expect(health.password_auth).toBe(true);

    // 2. Wrong password fails and triggers rate limit after 5 attempts
    for (let i = 0; i < 5; i++) {
      const bad = await fetch(`${srv.url}/api/v1/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": "203.0.113.10",
        },
        body: JSON.stringify({
          username: "emperor",
          password: "wrong-password",
          device_label: "Attacker",
          platform: "web",
        }),
      });
      expect(bad.status).toBe(401);
    }
    const locked = await fetch(`${srv.url}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "203.0.113.10",
      },
      body: JSON.stringify({
        username: "emperor",
        password: "StrongPassword123!",
        device_label: "Attacker",
        platform: "web",
      }),
    });
    expect(locked.status).toBe(429);

    // 3. Legitimate desktop + mobile logins succeed and issue distinct revocable tokens
    const desktopLoginRes = await fetch(`${srv.url}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "198.51.100.2",
      },
      body: JSON.stringify({
        username: "EMPEROR", // case-insensitive
        password: "StrongPassword123!",
        device_label: "Windows Desktop",
        platform: "windows",
      }),
    });
    expect(desktopLoginRes.status).toBe(200);
    const desktopLogin = (await desktopLoginRes.json()) as {
      token: string;
      owner: { id: string; name: string; username: string };
      credential: { id: string; scope: string };
    };
    expect(desktopLogin.token.startsWith("kx_own_")).toBe(true);
    expect(desktopLogin.credential.scope).toBe("owner");

    const mobileLoginRes = await fetch(`${srv.url}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "198.51.100.3",
      },
      body: JSON.stringify({
        username: "emperor",
        password: "StrongPassword123!",
        device_label: "Android Phone",
        platform: "android",
      }),
    });
    expect(mobileLoginRes.status).toBe(200);
    const mobileLogin = (await mobileLoginRes.json()) as { token: string };

    // 4. Snapshot works and returns seeded default project
    const snapRes = await fetch(`${srv.url}/api/v1/snapshot`, {
      headers: { Authorization: `Bearer ${desktopLogin.token}` },
    });
    expect(snapRes.status).toBe(200);
    const snap = (await snapRes.json()) as {
      projects: Array<{ id: string }>;
    };
    expect(snap.projects.length).toBeGreaterThan(0);
    const projectId = snap.projects[0]!.id;

    // 5. Connect real WebSocket on mobile and verify live broadcast from MCP submit_memorial
    const wsUrl = srv.url.replace(/^http/, "ws") + `/api/v1/ws?token=${encodeURIComponent(mobileLogin.token)}`;
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });

    const eventPromise = new Promise<{ kind: string; event: { type: string } }>((resolve) => {
      ws.once("message", (data) => {
        resolve(JSON.parse(data.toString("utf8")));
      });
    });

    const mcpRes = await fetch(`${srv.url}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${desktopLogin.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "submit_memorial",
          arguments: {
            project_id: projectId,
            title: "Deploy verification",
            content: "Ready to ship v0.1.2?",
            risk_level: "low",
          },
        },
      }),
    });
    expect(mcpRes.status).toBe(200);

    const liveEvent = await eventPromise;
    expect(liveEvent.kind).toBe("event");
    expect(liveEvent.event.type).toBe("memorial.created");

    // 6. Change password with revoke_other_devices -> kicks mobile WS and invalidates mobile token
    const closedPromise = new Promise<number>((resolve) => {
      ws.once("close", (code) => resolve(code));
    });

    const pwRes = await fetch(`${srv.url}/api/v1/auth/password`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${desktopLogin.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        current_password: "StrongPassword123!",
        new_password: "NewPassword456!",
        revoke_other_devices: true,
      }),
    });
    expect(pwRes.status).toBe(200);
    const pwJson = (await pwRes.json()) as { ok: boolean; revoked_devices: number };
    expect(pwJson.ok).toBe(true);
    expect(pwJson.revoked_devices).toBe(1);

    const closeCode = await closedPromise;
    expect(closeCode).toBe(4001);

    // Mobile token is now rejected
    const revokedSnap = await fetch(`${srv.url}/api/v1/snapshot`, {
      headers: { Authorization: `Bearer ${mobileLogin.token}` },
    });
    expect(revokedSnap.status).toBe(401);

    // New password works for fresh login
    const relogin = await fetch(`${srv.url}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "198.51.100.4",
      },
      body: JSON.stringify({
        username: "emperor",
        password: "NewPassword456!",
        device_label: "Android Phone Re-login",
        platform: "android",
      }),
    });
    expect(relogin.status).toBe(200);
  });
});
