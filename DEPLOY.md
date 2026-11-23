# KangXi.exe 后端部署指南（人 & AI Agent 通用）

> **提示**：如果你只在**单台 Windows 电脑**上使用 KangXi.exe，**完全不需要部署后端**（桌面端开箱即本机直连并自动导入 Codex / Claude）。
> 只有在你需要 **Android 手机远程批阅** 或 **跨多台电脑协作** 时，才需要部署此后端。

本仓库提供**同一套后端代码**（`@kangxi/server-core`），支持部署到 **任意服务器（Docker / Node.js）** 或 **Cloudflare 免费版**。部署完成后，电脑端和手机端都只需要填 **3 项**：
1. **服务器地址**（URL）
2. **用户名**
3. **密码**

---

## 给 AI Agent（Codex / Claude Code）的快捷指令

如果你懒得看命令，直接把本仓库地址交给你的 AI Agent，然后说：

- **部署到自己的服务器（VPS / NAS / 云主机）**：
  > 请阅读仓库里的 `DEPLOY.md`，用 Docker（或 Node 24）在这台服务器上部署 KangXi.exe 后端，用户名设为 `admin`，密码设为 `你的强密码`，部署完验证 `/health` 并把登录地址发给我。
- **部署到 Cloudflare 免费版（无需买服务器，自带 HTTPS）**：
  > 请阅读仓库里的 `DEPLOY.md`，把 KangXi.exe 后端部署到我的 Cloudflare 账号，部署完把 `.workers.dev` 地址发给我。

---

## 方式一：任意服务器一键部署（Docker 推荐）

适用于任何安装了 Docker 的 Linux VPS / 云服务器 / 群晖 NAS / 家庭主机。数据保存在持久化卷 `/data/kangxi.db` 中。

```bash
git clone https://github.com/vexpaer/kangxi.exe.git
cd kangxi.exe

# 一键构建、启动并自动验证 /health（不传密码会自动生成强密码并打印）
KANGXI_USERNAME=admin KANGXI_PASSWORD='YourStrongPassword!' ./scripts/deploy-server.sh
```

如果你有自己的域名并希望自动申请 HTTPS 证书（使用 Caddy）：

```bash
KANGXI_DOMAIN=kangxi.example.com \
KANGXI_USERNAME=admin \
KANGXI_PASSWORD='YourStrongPassword!' \
./scripts/deploy-server.sh
```

或者手动使用 Docker Compose：

```bash
cp .env.example .env
# 编辑 .env 修改 KANGXI_USERNAME 和 KANGXI_PASSWORD
docker compose up -d --build
curl http://127.0.0.1:8787/health
```

---

## 方式二：任意服务器直接跑 Node.js（无需 Docker）

适用于已安装 **Node.js >= 22.5（推荐 Node 24）** 的 Linux / macOS / Windows 服务器（零 C++ 原生编译依赖，内置 SQLite）：

```bash
git clone https://github.com/vexpaer/kangxi.exe.git
cd kangxi.exe

KANGXI_MODE=node \
KANGXI_USERNAME=admin \
KANGXI_PASSWORD='YourStrongPassword!' \
./scripts/deploy-server.sh
```

或者前台直接运行（适合接入 `systemd` / `pm2`）：

```bash
pnpm install --filter @kangxi/protocol --filter @kangxi/server-core --filter @kangxi/server
pnpm --filter @kangxi/protocol build
pnpm --filter @kangxi/server-core build
pnpm --filter @kangxi/server build

PORT=8787 KANGXI_USERNAME=admin KANGXI_PASSWORD='YourStrongPassword!' \
  node services/server/dist/cli.js
```

---

## 方式三：Cloudflare 免费版部署（免服务器 + 自带全球 HTTPS）

无需购买服务器，无需公网 IP，自动获得 `https://*.workers.dev` 加密地址：

```bash
git clone https://github.com/vexpaer/kangxi.exe.git
cd kangxi.exe

# 确保已登录 Cloudflare（或设置 CLOUDFLARE_API_TOKEN 与 CLOUDFLARE_ACCOUNT_ID）
./scripts/deploy-cloudflare.sh
```

部署完成后无需手动跑数据库迁移（后端首次请求会自动建表）：
- 直接打开 Windows / Android 客户端，填入 `https://kangxi-backend.<你的子域>.workers.dev`；
- 首次登录时直接输入你想设置的 **用户名 + 密码**，点击 **创建管理员账号并登录** 即可完成初始化。

---

## 环境变量速查

| 变量名 | 默认值 | 说明 |
|---|---|---|
| `PORT` / `KANGXI_PORT` | `8787` | 服务监听端口（仅自建服务器） |
| `KANGXI_DATA_DIR` | `./data` | SQLite 数据目录（Docker 内为 `/data`） |
| `KANGXI_USERNAME` | `admin` | 预设管理员用户名（可选；不设也可在客户端首次登录时创建） |
| `KANGXI_PASSWORD` | 空 | 预设管理员密码（至少 6 位，自动 PBKDF2-SHA256 哈希入库） |
| `KANGXI_RESET_PASSWORD` | `0` | 忘记密码时临时设为 `1` 并重启，可用 `KANGXI_PASSWORD` 重置密码 |
| `KANGXI_DOMAIN` | 空 | 配置域名后配合 `docker-compose.caddy.yml` 自动签发 HTTPS 证书 |

## 部署验收检查（Agent 必查）

部署完成后执行：

```bash
curl -s <你的服务地址>/health
```

返回类似如下 JSON 即表示成功：

```json
{
  "ok": true,
  "service": "kangxi-backend",
  "version": "0.1.2",
  "runtime": "node",
  "bootstrapped": true,
  "password_auth": true
}
```

随后只需将 **服务器地址、用户名、密码** 交给用户，在电脑/手机客户端输入即可直接登录使用。
