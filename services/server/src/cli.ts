#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { ensureInitialized } from "@kangxi/server-core";
import { startKangXiServer } from "./server.js";

/**
 * Lightweight zero-dependency .env loader (never overrides already-set env vars).
 */
function loadDotEnv(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env"),
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = val;
      }
    }
    break;
  }
}

async function main(): Promise<void> {
  loadDotEnv();

  const host = process.env.HOST || "0.0.0.0";
  const port = Number(process.env.PORT || "8787");
  const dataDir = process.env.KANGXI_DATA_DIR || "./data";
  const dbPath =
    process.env.KANGXI_DB_PATH || path.join(dataDir, "kangxi.db");

  const running = await startKangXiServer({
    host,
    port,
    dbPath,
    appVersion: process.env.APP_VERSION || "0.1.2",
    username: process.env.KANGXI_USERNAME,
    password: process.env.KANGXI_PASSWORD,
    ownerName: process.env.KANGXI_OWNER_NAME,
    resetPassword: process.env.KANGXI_RESET_PASSWORD,
    bootstrapSecret: process.env.BOOTSTRAP_SECRET,
    fcmProjectId: process.env.FCM_PROJECT_ID,
    fcmAccessToken: process.env.FCM_ACCESS_TOKEN,
  });

  const init = await ensureInitialized(running.env);

  console.log("");
  console.log("  KangXi.exe Backend Server Online (v0.1.2)");
  console.log("  -----------------------------------------");
  console.log(`  Listen   : http://${host}:${running.port}`);
  console.log(`  Health   : http://127.0.0.1:${running.port}/health`);
  console.log(`  Database : ${path.resolve(running.dbPath)}`);
  if (init.bootstrapped) {
    console.log(
      `  Account  : ready (username: ${init.username || "admin"}, password auth: ${init.passwordAuth ? "enabled" : "token-only"})`
    );
  } else {
    console.log(
      "  Account  : not initialized yet — set KANGXI_USERNAME & KANGXI_PASSWORD or create admin on first login in client."
    );
  }
  console.log("");

  const shutdown = async (signal: string) => {
    console.log(`[kangxi-server] Received ${signal}, shutting down...`);
    await running.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[kangxi-server] Fatal startup error:", err);
  process.exit(1);
});
