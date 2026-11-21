# Connecting Agents (MCP-Only & Windows Bridge Managed)

KangXi.exe supports two honest, distinct agent execution models:

| Mode | How It Works | Active Wake-Up on Decision? |
|---|---|---|
| **MCP-only** | Any MCP-compatible agent (Codex, Claude Code, Cursor, custom scripts) calls KangXi's remote Streamable HTTP MCP tools. | No forced injection. Agent polls `check_memorial` / `get_memorial_reply` autonomously. |
| **Bridge-managed** | Started by the local **Windows Bridge** inside a user-authorized project folder. | **Yes** — when supported by the provider adapter (`codex exec resume` / `claude -p --resume`), Bridge claims the decision and resumes the exact session. |

---

## 1. Streamable HTTP MCP Server (`/mcp`)

Open KangXi.exe → **钦差敕令 (MCP & Pairing)** → **签发 MCP 凭证** (optionally restricted to specific `project_id`s).

### Exposed MCP Tools
| Tool | Purpose |
|---|---|
| `submit_memorial` | Submits a blocking human approval/decision request (`title`, `content`, `request_type`, `options`, `risk_level`, `risk_notes`). Returns `memorial_id` and `status`. |
| `check_memorial` | Returns current `status`, `has_reply`, `version`, `delivery_status`, and `resume_status`. |
| `get_memorial_reply` | Retrieves the structured human decision (`action`, `selected_option_id`, `comment`, `instructions`). |
| `submit_report` | Sends a non-blocking progress or completion report without creating a pending memorial. |

### Claude Code CLI
```bash
claude mcp add --transport http kangxi \
  https://<your-worker>.workers.dev/mcp \
  --header "Authorization: Bearer <YOUR_MCP_TOKEN>"
```

### Codex CLI (`~/.codex/config.toml`)
```toml
[mcp_servers.kangxi]
url = "https://<your-worker>.workers.dev/mcp"
bearer_token_env_var = "KANGXI_MCP_TOKEN"
```
Then set `KANGXI_MCP_TOKEN=<YOUR_MCP_TOKEN>` in your shell environment.

---

## 2. Windows Bridge (Managed Codex & Claude Code Execution)

The local Windows Bridge connects **outbound** via HTTPS + WebSocket to your Cloudflare backend — no router port forwarding required.

### Built-In Desktop Bridge (Recommended)
1. Open **KangXi.exe** on Windows 10/11.
2. Go to **本机驿站 (Projects & Bridge)**.
3. Click **探测本机 CLI** to verify `codex` and `claude` detection.
4. For each project you want managed remotely, click **授权目录 (Authorize Folder)** and pick the local Windows directory.
   - Directory authorizations live **only** on your Windows machine. Remote clients cannot pass arbitrary filesystem paths.
5. Click **启动本地 Bridge**.
6. Optional: Check **关闭主窗口时允许 Bridge 在系统托盘继续运行** if you want background execution after closing the window (disabled by default; tray menu always provides **停止本地 Bridge** and **完全退出**).

### Standalone Bridge CLI (`kangxi-bridge.exe`)
Download `kangxi-bridge-<version>-windows-x64.exe` from GitHub Releases and create `kangxi-bridge.json`:
```json
{
  "server_url": "https://<your-worker>.workers.dev",
  "bridge_token": "kx_brg_...",
  "bridge_name": "Workstation-01",
  "hostname": "DESKTOP-WIN11",
  "authorized_projects": {
    "prj_xxxxxxxxxxxx": "C:\\Users\\you\\code\\my-project"
  }
}
```
Run:
```powershell
.\kangxi-bridge.exe --config .\kangxi-bridge.json
```

### Provider Adapter Details & Safety
- **Codex Adapter**: Runs `codex exec --json --sandbox workspace-write "<prompt>"` and resumes via `codex exec resume <thread_id> --json "<reply>"`. Never remotely elevates to `danger-full-access`.
- **Claude Code Adapter**: Runs `claude -p --output-format stream-json --verbose "<prompt>"` and resumes via `claude -p --resume <session_id> --output-format stream-json --verbose "<reply>"`. Never remotely injects `--dangerously-skip-permissions`.
- If a CLI binary is missing or a session has no `provider_session_id`, Bridge reports `resume_status: "not_supported"` or `"resume_failed"` honestly in the UI.
