import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  authenticateRequest,
  ensureInitialized,
  handleFetch,
  type ServerEnv,
} from "@kangxi/server-core";
import { WebSocketServer } from "ws";
import { NodeRealtimeHub } from "./realtime.js";
import { openNodeSqlite, type NodeSqliteHandle } from "./sqlite.js";

export interface KangXiServerOptions {
  host?: string;
  port?: number;
  dbPath?: string;
  appVersion?: string;
  username?: string;
  password?: string;
  ownerName?: string;
  resetPassword?: string;
  bootstrapSecret?: string;
  fcmProjectId?: string;
  fcmAccessToken?: string;
}

export interface RunningKangXiServer {
  host: string;
  port: number;
  url: string;
  dbPath: string;
  env: ServerEnv;
  hub: NodeRealtimeHub;
  sqlite: NodeSqliteHandle;
  close: () => Promise<void>;
}

function buildWebRequest(req: IncomingMessage, body?: Buffer): Request {
  const host = req.headers.host || "localhost";
  const proto =
    (typeof req.headers["x-forwarded-proto"] === "string"
      ? req.headers["x-forwarded-proto"].split(",")[0]?.trim()
      : undefined) || "http";
  const url = `${proto}://${host}${req.url || "/"}`;

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const item of v) headers.append(k, item);
    } else {
      headers.set(k, v);
    }
  }
  if (!headers.has("x-forwarded-for") && req.socket.remoteAddress) {
    headers.set("x-forwarded-for", req.socket.remoteAddress);
  }

  const method = (req.method || "GET").toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD" && body && body.length > 0;
  return new Request(url, {
    method,
    headers,
    body: hasBody ? new Uint8Array(body) : undefined,
  });
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  const maxBytes = 4 * 1024 * 1024; // 4 MB safety cap
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw new Error("REQUEST_TOO_LARGE");
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

async function writeWebResponse(res: ServerResponse, webRes: Response): Promise<void> {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  const arrayBuf = await webRes.arrayBuffer();
  res.end(Buffer.from(arrayBuf));
}

export async function startKangXiServer(
  options: KangXiServerOptions = {}
): Promise<RunningKangXiServer> {
  const host = options.host ?? "0.0.0.0";
  const port = options.port ?? 8787;
  const dbPath = options.dbPath ?? "./data/kangxi.db";

  const sqlite = openNodeSqlite(dbPath);
  const hub = new NodeRealtimeHub();

  const env: ServerEnv = {
    DB: sqlite.db,
    REALTIME: hub,
    RUNTIME: "node",
    APP_VERSION: options.appVersion ?? "0.1.2",
    KANGXI_USERNAME: options.username,
    KANGXI_PASSWORD: options.password,
    KANGXI_OWNER_NAME: options.ownerName,
    KANGXI_RESET_PASSWORD: options.resetPassword,
    BOOTSTRAP_SECRET: options.bootstrapSecret,
    FCM_PROJECT_ID: options.fcmProjectId,
    FCM_ACCESS_TOKEN: options.fcmAccessToken,
  };

  await ensureInitialized(env);

  const wss = new WebSocketServer({ noServer: true });

  const server = http.createServer(async (req, res) => {
    try {
      const method = (req.method || "GET").toUpperCase();
      const body =
        method === "GET" || method === "HEAD" || method === "OPTIONS"
          ? undefined
          : await readBody(req);
      const webReq = buildWebRequest(req, body);
      const webRes = await handleFetch(webReq, env);
      await writeWebResponse(res, webRes);
    } catch (err) {
      if (err instanceof Error && err.message === "REQUEST_TOO_LARGE") {
        res.statusCode = 413;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ code: "PAYLOAD_TOO_LARGE", error: "Request body exceeds 4MB limit" }));
        return;
      }
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          code: "INTERNAL_ERROR",
          error: err instanceof Error ? err.message : "Internal server error",
        })
      );
    }
  });

  server.on("upgrade", async (req, socket, head) => {
    try {
      const webReq = buildWebRequest(req);
      const url = new URL(webReq.url);
      if (url.pathname.replace(/\/+$/, "") !== "/api/v1/ws") {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }

      const auth = await authenticateRequest(webReq, env);
      if (!auth) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        hub.register(ws, auth);
      });
    } catch {
      socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
      socket.destroy();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const addr = server.address() as AddressInfo;
  const boundPort = addr.port;
  const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;

  return {
    host,
    port: boundPort,
    url: `http://${displayHost}:${boundPort}`,
    dbPath,
    env,
    hub,
    sqlite,
    close: async () => {
      hub.closeAll();
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
      sqlite.close();
    },
  };
}
