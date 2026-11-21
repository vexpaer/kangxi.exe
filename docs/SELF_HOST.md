# Self-Hosting KangXi.exe on Cloudflare Free Tier (`cf` CLI)

KangXi.exe uses a **BYO (Bring Your Own) Cloudflare Backend** running on your own Cloudflare account:
- **Cloudflare Worker** (`services/cloudflare/src/index.ts`): REST API v1, Streamable HTTP MCP (`/mcp`), pairing, auth, and Workers Static Assets status page.
- **Cloudflare D1** (`migrations/0001_init.sql`): Persistent SQLite storage for projects, agents, bridges, sessions, tasks, messages, memorials, decisions, events, and credentials.
- **SQLite-backed Durable Objects** (`SyncHub`): Real-time WebSocket Hibernation fan-out and instant revocation kicks.

> **Security Rule**: Never place your Cloudflare Management API Token inside the Windows or Android client. The clients only communicate with your deployed `https://<worker>.<subdomain>.workers.dev` URL using scoped KangXi Bearer tokens.

---

## Cloudflare Free Plan Limits (Know Before Deploying)

Cloudflare Free plan quotas are resource limits (not a guarantee of unlimited free traffic):
- **Workers Free**: 100,000 requests/day, 10 ms CPU time per invocation.
- **D1 Free**: 5M rows read/day, 100K rows written/day, 5 GB storage.
- **Durable Objects (SQLite-backed)**: Available on the Free plan with WebSocket Hibernation enabled so idle sockets minimize duration billing.

KangXi.exe truncates oversized terminal log chunks written to D1 (max 12 KB/chunk) and uses indexed cursor queries (`events(owner_id, sequence)`) to keep usage compact. You do **not** need a custom domain — `*.workers.dev` works out of the box.

---

## Option A: Deploy Locally (or With Your AI Coding Agent) via `cf`

This project uses the modern **Cloudflare CLI `cf`** and **`services/cloudflare/cloudflare.config.ts`** (not Wrangler). Do not mix Wrangler deployment commands into this project.

### 1. Prerequisites
- Node.js 22+ (LTS 24 recommended) and `pnpm`
- A free Cloudflare account

### 2. Sign In (User Browser Approval)
```bash
pnpm install
cd services/cloudflare
npx cf auth login
```
Complete the browser authorization prompt yourself.

### 3. Create the D1 Database
```bash
npx cf d1 create --name kangxi-db
```
Copy the returned database `uuid` from the JSON output and export it in your shell:
```bash
export CLOUDFLARE_D1_ID="<your-d1-uuid>"
```

### 4. Apply Initial Database Migrations
```bash
npx cf d1 migrations apply "$CLOUDFLARE_D1_ID" --dir ./migrations
```

### 5. Build, Dry-Run, and Deploy
```bash
pnpm --filter @kangxi/protocol build
CF_SEND_TELEMETRY=false npx cf build
CF_SEND_TELEMETRY=false npx cf deploy --prebuilt --mode production --dry-run
CF_SEND_TELEMETRY=false npx cf deploy --prebuilt --mode production
```

After deployment, verify your Worker URL:
```bash
curl https://kangxi-backend.<your-subdomain>.workers.dev/health
```
Expected response:
```json
{"ok":true,"service":"kangxi-backend","version":"0.1.0","bootstrapped":false}
```

### 6. Initialize Owner Account (Bootstrap)
Open the **KangXi.exe Windows** app (or Android app), enter your Worker URL under **初次建阁 (Bootstrap)**, and click **初始化并接入后端**.
- Credentials are stored in Windows Credential Manager (or Android app-private vault), never in browser `localStorage`.
- Pair Android devices from **钦差敕令 (MCP & Pairing) → 生成配对码**. Pairing QR codes expire in 5 minutes, are single-use, and never contain an owner/admin token.

---

## Option B: Deploy via GitHub Actions (Manual Approval Only)

Pushes to `main` **never** touch your Cloudflare account automatically. To deploy from GitHub Actions:
1. Create a scoped Cloudflare API Token (Workers Scripts Edit + D1 Edit + Account Settings Read).
2. Add GitHub Repository Secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_D1_ID`
3. Open **GitHub → Actions → Deploy Cloudflare Backend (Manual Approval Only)** and click **Run workflow**.

---

## Backup, Export, Updates & Revocation

- **Export all data (no Cloudflare lock-in)**: Click **导出全量 JSON** in the app's **MCP & Pairing** tab, or call:
  ```bash
  curl -H "Authorization: Bearer <OWNER_TOKEN>" \
    https://kangxi-backend.<your-subdomain>.workers.dev/api/v1/export > kangxi-backup.json
  ```
- **Revoke a lost phone or MCP agent token**: Click **吊销 (Revoke)** in the app or call `POST /api/v1/credentials/<id>/revoke`. Access is blocked immediately and active WebSockets are disconnected.
- **Upgrade backend**: Pull latest `main`, run `cf d1 migrations apply "$CLOUDFLARE_D1_ID" --dir ./migrations`, then `cf build && cf deploy --prebuilt --mode production`.
- **Optional Android background push (FCM)**: If you want OS-level background notifications while Android is suspended, configure `FCM_PROJECT_ID` and `FCM_ACCESS_TOKEN` as Worker secrets. Push payloads contain metadata only (`event_id`, `sequence`, `type`) and never include sensitive memorial content. Without FCM, opening the app automatically catches up missed events via `GET /api/v1/events?after=<cursor>`.
