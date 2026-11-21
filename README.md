# KangXi.exe — 御批 Agent 工作台

> **Single-Repo Monorepo · Windows 10/11 + Android 10+ (Tauri 2) · Cloudflare Free BYO Backend (`cf`) · Streamable HTTP MCP · Rust Windows Bridge**

KangXi.exe 是一个以“皇帝批奏折”为灵感、同时提供**现代极简高端模式**的开源跨设备 Agent 工作台。你可以从 Windows 或 Android 给 Agent 下达任务；Codex、Claude Code 及任何 MCP 兼容 Agent 通过标准 MCP 工具递交奏折与汇报；你在任意设备批阅并回复，本地 Windows Bridge 负责受管会话的可靠领取与恢复。

---

## 核心特性

- **双完整全局视觉模式（独立切换，功能 100% 对等）**
  - **仿真皇帝模式 (`imperial`)**：御案桌面、堆叠丝绸奏折、宣纸朱丝栏展开卷宗、御笔朱批与落印动效/合成音效（支持减弱动效与静音）。Android 端针对触控屏重排为掌上御案。
  - **现代极简高端模式 (`modern`)**：专业三栏工作台、高密度队列、右侧投递遥测检查器、`J/K` 快捷浏览与 `Ctrl+K` 命令面板。
- **独立双 Agent 汇报风格（4 种自由组合）**
  - `memorial`（奏折体）与 `standard`（标准技术报告）独立于全局主题切换；**原始内容只存一份**，绝不篡改代码、报错日志或技术事实，每条奏折与消息均支持一键查看原文。
- **清晰隔离的三段投递状态**
  - 严格区分 **服务端保存成功**、**Bridge 已领取**、**Agent 已恢复（或 MCP 自主查批）**；基于乐观锁 (`expected_version`) 与幂等键防止多端重复批准，冲突时完整保留本地离线草稿。
- **真实 MCP + Windows Bridge 闭环**
  - Cloudflare Worker 暴露 Streamable HTTP `/mcp`：`submit_memorial`、`check_memorial`、`get_memorial_reply`、`submit_report`。
  - Rust Windows Bridge (`crates/bridge`) 采用出站 HTTPS/WebSocket + `/events?after=cursor` 断线补偿，原生适配 `codex exec --json` / `codex exec resume` 与 `claude -p --output-format stream-json --resume`。
  - 本地目录授权仅保存于执行主机；Windows 关闭主窗口后仅在用户明确开启托盘选项时后台保持 Bridge 运行。
- **安全与数据所有权**
  - 区分 `owner`、`device`、`bridge`、`mcp_agent` 作用域凭证，支持项目级限制与即时吊销（同步断开 WebSocket）；Android 配对采用 5 分钟一次性短码（二维码绝不含管理员 Token）；支持全量 JSON 导出。

---

## 安装包下载

Windows 安装包与 Android APK 均由本仓库 GitHub Actions 云端自动构建：
- **开发构建产物**：进入本仓库 **Actions → Build Windows & Android** 下载 `kangxi-windows-x64` 与 `kangxi-android-arm64-debug`。
- **正式版本**：进入本仓库 **Releases** 下载 `KangXi.exe-<version>-windows-x64-setup-unsigned.exe`、`kangxi-bridge-<version>-windows-x64.exe`、`KangXi-<version>-android-arm64-*.apk` 及 `SHA256SUMS.txt`。

---

## 仓库结构

```text
kangxi.exe/
├── SPEC.md                     # 唯一主产品规格
├── packages/
│   ├── protocol/               # 共享 Zod Schema、状态枚举、REST/WS/MCP 契约
│   └── app-core/               # API 客户端、离线草稿/冲突管理、奏折/标准文风呈现器
├── services/
│   └── cloudflare/             # Cloudflare Worker + D1 迁移 + SQLite Durable Object (cf CLI)
├── crates/
│   └── bridge/                 # Rust Windows Bridge + Codex / Claude Code Provider Adapters
├── apps/
│   └── client/                 # 单一共享 Tauri 2 + React 客户端（同时构建 Windows & Android）
├── docs/
│   ├── SELF_HOST.md            # Cloudflare Free 自部署与 AI Agent 部署指引
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
