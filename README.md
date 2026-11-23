# KangXi.exe — 御批 Agent 工作台

> **Single-Repo Monorepo · Windows 10/11 + Android 10+ (Tauri 2) · Local-First Zero-Backend Desktop · Universal Self-Hosted Backend (Docker / Node 24 / Cloudflare Free) · Streamable HTTP MCP · Rust Windows Bridge**

KangXi.exe 是一个以“皇帝批奏折”为灵感、同时提供**苹果极简光感/深色模式**的开源跨设备 Agent 工作台。Windows 桌面端默认零后端开箱即用并自动导入本机 Codex / Claude；需要手机远程批阅或跨多台电脑协作时，可将现成后端一键部署到**任意服务器（Docker / Node 24）或 Cloudflare 免费版**，电脑与手机端只需输入 **地址 + 用户名 + 密码** 即可联机。

---

## 核心特性

- **Windows 本机直连（零后端开箱即用 · 类 T3 Code 自动导入）**
  - 电脑端启动即进入**本机直连模式**，**完全不需要部署或配置任何云端后端**。
  - 自动探测本机已安装的 **Codex CLI** 与 **Claude Code CLI**，自动扫描并导入 `~/.codex/sessions` 与 `~/.claude/projects` 中的本机项目与历史会话，点开即可浏览记录并直接恢复原会话继续执行（`codex exec resume` / `claude -p --resume`）。
  - 内置本机回环 MCP 服务（`127.0.0.1`），支持一键写入本机 Codex / Claude Code MCP 配置；仅当需要**用 Android 手机远程批阅或跨多台电脑控制**时，再按需连接远程后端。
- **一套通用后端，任意部署 + 账密直连（见 [`DEPLOY.md`](./DEPLOY.md)）**
  - 同一套 `@kangxi/server-core` 代码同时支持 **任意服务器（Docker Compose / Node 24 内置 SQLite，零编译依赖）** 与 **Cloudflare 免费版**，附带 `scripts/deploy-server.sh`、`scripts/deploy-cloudflare.sh` 与 AI Agent 一键部署指引。
  - 客户端只需输入 **服务器地址 + 用户名 + 密码**；服务端采用 PBKDF2-SHA256 哈希与防爆破限流，登录成功后签发每台设备独立可吊销的 Bearer Token 存入系统凭证库。
- **双完整全局视觉模式（独立切换，功能 100% 对等）**
  - **现代极简模式 (`modern`)**：参考 Apple HIG / macOS Sequoia，内置浅色通透（Light）与深空石墨（Dark）双外观、半透明侧边栏、`J/K` 快捷浏览与 `Ctrl+K` 命令面板。
  - **仿真皇帝模式 (`imperial`)**：御案桌面、堆叠丝绸奏折、宣纸朱丝栏展开卷宗、御笔朱批与落印动效/合成音效（支持减弱动效与静音）。Android 端针对触控屏重排为掌上御案。
- **独立双 Agent 汇报风格（4 种自由组合）**
  - `memorial`（奏折体）与 `standard`（标准技术报告）独立于全局主题切换；**原始内容只存一份**，绝不篡改代码、报错日志或技术事实，每条奏折与消息均支持一键查看原文。
- **清晰隔离的三段投递状态**
  - 严格区分 **服务端保存成功**、**Bridge 已领取**、**Agent 已恢复（或 MCP 自主查批）**；基于乐观锁 (`expected_version`) 与幂等键防止多端重复批准，冲突时完整保留本地离线草稿。
- **真实 MCP + Windows Bridge 闭环**
  - 后端暴露 Streamable HTTP `/mcp`：`submit_memorial`、`check_memorial`、`get_memorial_reply`、`submit_report`。
  - Rust Windows Bridge (`crates/bridge`) 采用出站 HTTPS/WebSocket + `/events?after=cursor` 断线补偿，原生适配 `codex exec --json` / `codex exec resume` 与 `claude -p --output-format stream-json --resume`。

---

## 安装包下载

Windows 安装包与 Android APK 均由本仓库 GitHub Actions 云端自动构建：
- **开发构建产物**：进入本仓库 **Actions → Build Windows & Android** 下载 `kangxi-windows-x64` 与 `kangxi-android-arm64-debug`。
- **正式版本**：进入本仓库 **Releases** 下载 `KangXi.exe-<version>-windows-x64-setup-unsigned.exe`、`kangxi-bridge-<version>-windows-x64.exe`、`KangXi-<version>-android-arm64-*.apk` 及 `SHA256SUMS.txt`。

---

## 仓库结构

```text
kangxi.exe/
├── DEPLOY.md                   # 人 & AI Agent 通用一键部署手册（Docker / Node 24 / Cloudflare）
├── docker-compose.yml          # 任意服务器一键 Docker 部署（含可选 Caddy 自动 HTTPS）
├── scripts/                    # deploy-server.sh & deploy-cloudflare.sh 一键部署脚本
├── SPEC.md                     # 唯一主产品规格
├── packages/
│   ├── protocol/               # 共享 Zod Schema、状态枚举、REST/WS/MCP 契约
│   ├── app-core/               # API 客户端、离线草稿/冲突管理、奏折/标准文风呈现器
│   └── server-core/            # 跨运行时通用后端核心（账密鉴权、SQLite、MCP、同步事件）
├── services/
│   ├── server/                 # 独立服务器（Node 24 内置 SQLite + WebSocket + Dockerfile）
│   └── cloudflare/             # Cloudflare Worker + D1 + SQLite Durable Object (cf CLI)
├── crates/
│   └── bridge/                 # Rust Windows Bridge + Codex / Claude Code Provider Adapters
├── apps/
│   └── client/                 # 单一共享 Tauri 2 + React 客户端（同时构建 Windows & Android）
├── docs/
│   ├── SELF_HOST.md            # Cloudflare Free 细节指引
│   ├── CONNECT_AGENTS.md       # MCP 与 Windows Bridge 接入指南
│   └── RELEASE.md              # GitHub Actions 云构建、签名与发版说明
└── .github/workflows/          # ci.yml, build.yml, release.yml, deploy-cloudflare.yml
```

---

## 快速开始

1. **部署自己的 Cloudflare 免费后端**：阅读 [`docs/SELF_HOST.md`](docs/SELF_HOST.md)（使用 `cf` CLI + `cloudflare.config.ts`，无须购买域名）。
2. **安装客户端**：从 GitHub Actions / Releases 下载 Windows `.exe` 或 Android `.apk`（也可先点击“进入本地演示沙盒”体验完整双模式 UI）。
3. **接入 Agent**：阅读 [`docs/CONNECT_AGENTS.md`](docs/CONNECT_AGENTS.md)，复制内置向导中的 MCP 配置或启动本地 Windows Bridge。

### 本地开发检查
```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
cargo test --workspace
```

---

## 已知首版边界与限制

- 首版专注人类控制多个独立 Agent，不做多 Agent 自动编排（Coordinator / Worker）。
- 未配置 Windows 代码签名证书前，NSIS 安装包标注为 `unsigned`，Windows SmartScreen 可能会弹出提示；未配置 `ANDROID_KEYSTORE_*` Secrets 时，APK 明确标注为 `debug`。
- 外部原生终端里的 MCP-only 会话不强行向终端注入按键，依赖 Agent 主动调用 `check_memorial` / `get_memorial_reply` 获取批复。
- Android 后台挂起时不依赖常驻 WebSocket；若需系统级后台唤醒，可按 `docs/SELF_HOST.md` 配置可选 FCM（仅传递无敏感正文元信息），未配置时打开应用自动通过事件游标补齐。
