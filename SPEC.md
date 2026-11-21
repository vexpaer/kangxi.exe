# KangXi.exe — Unified Product & Engineering Spec

> **版本：1.0 · 2026-11-21**  
> **交付形式：单一 GitHub Monorepo / Windows + Android / Cloudflare BYO Backend / GitHub Actions CI/CD**  
> **文档用途：将本文件保存为仓库根目录 `SPEC.md`，直接交给 Codex / Claude Code 等编程 Agent 实现。**

## 0. 给开发 Agent 的执行要求

你负责在**同一个 GitHub 仓库**中实现 KangXi.exe 的完整首版。先检查仓库已有代码并复用可用成果；若是空仓库，按下文建立项目。自主完成架构细化、UI 设计、实现、CI/CD 配置、版本发布和必要文档，避免停留在概念演示。

- 以**真实可用**为目标：Windows/Android 同步接收奏折、人工朱批、MCP 接入、Windows 受管 Agent 会话、远程任务发送和可靠的消息投递闭环。
- **所有平台代码、共享协议、Bridge、Cloudflare 后端、部署脚本、GitHub Actions 均在一个仓库。** 不依赖额外仓库、子模块、独立构建项目或另一个私有后端项目。
- Windows 与 Android 尽量共享代码和设计系统；平台能力以适配器隔离。不要复制两套前端。
- UI 仅给出**设计目标**，不限制配色、字体、固定布局、特效、页面结构、组件库。请将双视觉模式设计到优秀产品水准。
- 编译、基础检查、打包和发布**由 GitHub Actions 云端完成**，不要求用户在本机安装 Android Studio、Rust、Java 等完整构建环境；本地可用于开发调试，但不是交付前提。
- 验证从简，仅保留关键自动化检查、可安装构建产物及一条真实业务闭环；不建立复杂的测试矩阵、冗长测试文档或模拟器测试任务。
- 以 Cloudflare Free 自部署为默认远程后端。部署必须使用用户自身 Cloudflare 账号，遵守当前官方免费额度。**不要求用户把 Cloudflare 管理 Token 放进客户端**。
- 首版只做**人类手动控制多个独立 Agent**，暂不实现 Coordinator / Worker 自动编排。
- 技术上优先成熟、可维护、低依赖。当前已有架构如更合适，可合理调整并在 README 中说明。

## 1. 产品定位与首版边界

KangXi.exe 是一个“皇帝批奏折”概念的开源、多设备 Agent 工作台。用户能从 Windows 或 Android 给 Agent 下达任务；Agent 通过 MCP 递交决策请求、进度与结果；用户在统一收件箱批阅并回复；支持受管会话的 Windows Bridge 自动恢复执行，也支持普通 MCP Agent 主动查询批复。

### 核心使用方式

1. **原生工作流**：用户照常在 Windows Terminal / Codex / Claude Code 工作，Agent 通过 KangXi MCP 递奏，用户在任意设备朱批，Agent 自主查询或继续接收批复。
2. **内置任务模式**：用户在 KangXi Windows 应用里选项目、选 Agent、发送自然语言任务，查看运行结果、继续对话和审批。
3. **远程控制模式**：用户在 Android 创建任务或批奏折，消息通过自部署后端发送到 Windows Bridge；如果执行主机离线，服务端保留队列，上线后按授权恢复。

### 首版不实现

多 Agent 自动编排 / Coordinator / Worker、自建云端 Agent 算力、多人团队权限、商业订阅、任意外部 CLI 会话强行唤醒、Android 本地运行 Codex/Claude Code CLI、应用市场分发全套流程。

## 2. Windows 与 Android 职责

| 功能 | Windows 10/11 x64 | Android 10+ |
|---|---|---|
| 奏折收件、搜索、查看、朱批 | 完整 | 完整 |
| 任务列表、会话、Agent 汇报 | 完整 | 完整（移动端适配） |
| 下达新任务、继续受管会话 | 本地执行 | 远程派发到在线/待上线 Windows Bridge |
| MCP-only Agent 递奏/查询 | 支持配置与显示 | 可收阅相同后端上的消息 |
| 真实 Codex/Claude Code 执行 | 本机 Provider Adapter | 不在本机执行 |
| Bridge 会话恢复与主动唤醒 | 本地出站服务 | 发送批复/命令给服务端，由 Windows Bridge 执行 |
| 系统能力 | 托盘、系统通知、可选开机启动、窗口与快捷键 | 原生通知、后台恢复、分享/深链（按需） |
| 两套 UI / 两套汇报风格 | 均支持 | 均支持 |

Windows 退出主窗口后，**只有用户主动允许时** Bridge 才在后台继续运行；托盘必须清楚展示状态和停止方式。Android 不应依赖应用进程常驻保活。

## 3. UI/UX 设计自由度与体验目标

### 3.1 两套完整的全局 UI

**A. `imperial` — 仿真皇帝模式**

营造真正坐在御案前批阅奏折的感觉。可以大胆使用桌案、堆叠卷宗/奏折、打开奏折、御笔朱批、落印、场景深度、质感材质、光影、动态交互、音效、反馈等方法，形成有趣且高完成度的沉浸式操作环境。**不是在普通管理后台加古风贴图。** 要能方便地处理大量真实任务，避免特效拖慢交互。手机端根据触摸屏重新设计沉浸体验。

**B. `modern` — 现代极简高端模式**

成熟、克制、精致、效率优先的专业 Agent 管理软件。强调排版、层级、留白、动效节奏、可读性、信息密度与操作效率。无需模仿皇帝模式的导航和布局。

开发 Agent **自主决定**视觉语言、导航、字体、组件、交互动效和技术实现；不要把本 Spec 变成像素级施工说明。两套模式是完整体验，不是只有不同 CSS 配色。

### 3.2 两种独立的 Agent 汇报风格

- `memorial`：以奏折、请示、回奏等历史语境组织汇报表现。
- `standard`：以现代任务报告、Agent 消息和技术说明呈现。

**全局主题和汇报风格独立切换**，共四种组合；任意切换不影响任务、消息及操作。**原始文本只存一份**，仿古文字可以做展示包装，但不能擅改技术事实、代码、错误日志或决定内容；随时能一键查看原文。

### 3.3 共同质量要求

- 重要信息清楚：哪个 Agent、哪个项目、是否待批、批复是否被领取、任务是否真的完成。
- 可快速搜索、批阅、继续任务，提供清晰的错误/离线反馈。
- 支持触摸、键盘、缩放与基本无障碍。沉浸式动效、声音可关闭/降低；低性能设备可退化。
- 设计可大胆发挥，但不允许任何关键功能仅在其中一个主题存在。

## 4. 核心产品模块

### 4.1 统一奏折中心

- 同一后端收集所有 Agent 递交的奏折；区分待批、已批、驳回、要求补充以及后续执行状态。
- 每条奏折包含来源 Agent、项目、会话、时间、标题、原始内容、请求类型、可选方案、风险说明。
- 支持搜索筛选，查看历史朱批、关联上下文。
- 朱批提供：准奏 / 驳回 / 再议或补充信息 / 自由文本回复；可以带修改指令。
- “服务端保存成功”“Bridge 已领取”“Agent 已恢复”分别展示，不能混为一谈。

### 4.2 任务、项目与对话

- 项目绑定 Windows 的本地工作目录（实际目录授权只在执行主机保存）、默认 Agent 及可用执行主机。
- 可创建任务、选择 Agent、发送自然语言、查看流式执行信息、继续对话、停止或取消尚未开始的任务。
- 支持在 Windows 上同时管理多个**独立** Agent 会话；不要求互相协作。
- Android 可对受管 Agent 下旨、追加消息、查看摘要和关键日志；离线主机则排队，界面明确标识。
- Agent 的普通汇报、需要批准的奏折、任务结果在数据模型中区分；都在统一任务时间线中可访问。

### 4.3 Agent 接入

- 首版优先真实支持 **Codex**、**Claude Code**；Provider Adapter 封装启动、继续、停止、状态、输出等能力。根据官方当前可用 API/CLI 实现，缺失能力要在 UI 中明确说明。
- **MCP-only**：任何兼容 MCP 的 Agent 通过远程/本地 MCP 工具递奏并查询；不保证 KangXi 能向原生会话主动注入消息。
- **Bridge-managed**：KangXi 自己启动或正式绑定、且适配器确实支持恢复的会话，才允许主动唤醒。
- 为外部 Agent 提供一页式 MCP 接入向导、可复制配置、项目级权限和吊销凭证。

### 4.4 本地 Windows Bridge

- Bridge 是独立于 UI 的逻辑组件（可实现为 Rust sidecar/后台进程），与后端采用**出站** HTTPS/WebSocket 连接；无需用户开路由器入站端口。
- 维护执行主机、已授权目录、Provider 会话 ID、任务 ID、奏折 ID 的关联。
- 收到 `task.create` 或 `decision.created` 后，核对权限、去重，再调用对应 Provider Adapter 发送任务或继续原会话。
- 记录投递回执、恢复成功/失败、执行输出与任务结束；断线重连后从事件游标补偿。
- 本地 Agent 的权限提示和执行沙箱仍然有效，远程指令不允许直接绕过危险操作审批。

## 5. MCP / 消息语义

### 5.1 基础 MCP 工具

| Tool | 含义 |
|---|---|
| `submit_memorial` | 提交待人工批阅的请求；返回 `memorial_id`、状态 |
| `check_memorial` | 查询状态，可用于轮询与后续恢复 |
| `get_memorial_reply` | 获取结构化决定及朱批内容 |
| `submit_report`（推荐） | 提交普通进度/完成汇报，不创建待批请求 |

为兼容不同 MCP 客户端，以工具提交+查询为最低保证；实时推送仅作增强。MCP 服务端公开 Streamable HTTP 入口和必要鉴权；客户端是否支持其他通知/异步机制不能被假设为统一。

### 5.2 统一业务状态

- `Task`: `queued | running | waiting_for_user | paused | completed | failed | cancelled`
- `Memorial`: `pending | approved | rejected | needs_info | superseded`
- `Delivery`: `queued | delivered | acknowledged | failed`
- `Resume`: `not_supported | waiting_for_bridge | resuming | resumed | resume_failed`

每个对象使用唯一 ID、时间戳、版本号、来源与权限标识。业务操作使用幂等键；朱批通过版本条件更新避免两台设备重复批准。所有状态更新先持久化，再发通知。

### 5.3 事件/同步约定

提供版本化 REST API + WebSocket 事件。事件包含 `event_id`, `sequence`, `type`, `entity_id`, `occurred_at`, `schema_version`。重连时通过 `GET /events?after=cursor` 补齐离线期间事件。通知包含尽量少的元信息，详情通过鉴权 API 获取。大块终端日志不应无上限写入 D1；使用分页、裁剪/本地缓存及用户可选导出。

## 6. 用户自部署 Cloudflare 后端

### 6.1 默认基础设施

- **Cloudflare Worker**：REST API、远程 MCP、认证、配对、权限与投递入口。
- **D1**：Owner、Device、Project、Agent、Bridge、Session、Task、Message、Memorial、Decision、Event、Delivery、Cursor 等持久数据及迁移。
- **SQLite-backed Durable Objects**：在线客户端/Bridge 的 WebSocket 连接与实时通知协调；减少频繁轮询。
- **Workers Static Assets**：如需要 Web 部署助手/落地页，可与 Worker 同仓托管；V1 不强制独立 Web 产品。
- **R2**：只有出现真实附件/大型产物需求时再引入，不作为首版必备。

优先实现单 Owner + 多设备 + 多 Agent。免费计划额度是资源限制，不是对任何负载“永久免费”的承诺；必须按当前 Cloudflare 文档评估并在超限时明确反馈，不自动启用付费功能。可使用 `*.workers.dev`，用户不需要购买域名。

### 6.2 自部署流程

项目内提供 `docs/SELF_HOST.md`：用户创建 Cloudflare 免费账户，在自己电脑或受控开发环境登录 **Cloudflare CLI `cf`**，开发 Agent 读取文档后完成资源创建、数据库迁移、初次部署、Owner 初始化、生成服务器 URL；用户进行必要的浏览器授权。

**新 Cloudflare 项目采用 `cf` + `cloudflare.config.ts`；如果仓库已使用 `wrangler.*` 且没有上述配置，保持 Wrangler，禁止混用不兼容部署命令。** CI 使用环境 Secret 注入短期/最小权限 Cloudflare API Token，普通客户端绝不持有该 Token。开发 Agent 可检索当前 CLI 命令，不要臆写已变化的参数。

用户在 Windows App 中输入服务器 URL 连接；Android 通过安全设备配对或登录连接同一实例。二维码不得携带长期管理员 Token。

后端必须有迁移、备份/导出、恢复、设备撤销与最基本的更新说明。后续支持 Docker/自托管服务器时，继续遵守同一业务 API；**首版优先真正可用的 Cloudflare 方案**。

### 6.3 手机后台通知

前台使用 WebSocket。Android 后台被系统挂起时不能依赖常驻 WebSocket；如需系统级后台推送，使用**可选 FCM**（用户自行配置）；未配置时仍要能在打开应用后补齐消息、显示状态。不要把完整敏感奏折写入第三方推送内容。

## 7. 单仓库架构与技术选型

推荐 **Tauri 2 + React + TypeScript + Rust + 少量 Kotlin 原生插件**，使用**一个共享 Tauri 客户端项目**分别构建 Windows 和 Android，而不是复制两个前端；Bridge 使用 Rust 独立模块；Worker 采用 TypeScript。具体 UI 组件库/动效/3D 渲染库由 Agent 根据效果、体积和维护性选定。

```text
kangxi-exe/                        # 一个 GitHub 仓库
├── SPEC.md                        # 本文，唯一主产品规格
├── README.md
├── package.json                   # Monorepo 根脚本
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── apps/
│   └── client/                    # 同一个 Tauri 2 项目构建双端
│       ├── src/                   # React UI + 两套视觉体验
│       ├── src-tauri/             # Rust、Tauri 配置、Android 工程
│       └── package.json
├── crates/
│   └── bridge/                    # Windows Agent Bridge / Provider 运行适配
├── packages/
│   ├── protocol/                  # DTO、Schema、OpenAPI、事件契约
│   ├── app-core/                  # 任务、奏折、同步与状态逻辑
│   └── ui/                        # 共享视图组件和可选主题基础
├── services/
│   └── cloudflare/                # Worker、D1 迁移、Durable Objects
├── docs/
│   ├── SELF_HOST.md               # Cloudflare 自部署与 AI 部署指引
│   ├── CONNECT_AGENTS.md          # MCP/Bridge 接入
│   └── RELEASE.md                 # CI/CD、签名、发布方式
└── .github/workflows/
    ├── ci.yml                     # PR/Push 最小检查
    ├── build.yml                  # 云端 Windows + Android 构建
    ├── release.yml                # GitHub Release
    └── deploy-cloudflare.yml      # 手动授权后端部署
```

可根据实现实际需要合并 packages 或调整文件名；保留**单仓库、一份主 Spec、单一共享前端、明确的后端/Bridge 边界**。

## 8. GitHub Actions 云端 CI/CD（重点）

**用户主要从 GitHub Actions Artifacts 或 GitHub Releases 下载 Windows 安装包和 Android APK。** 编译发布不依赖用户电脑，不要求 Android 模拟器或本机繁琐安装验证。

### 8.1 工作流与触发

| Workflow | 触发方式 | 目标 | 产物 |
|---|---|---|---|
| `ci.yml` | Pull Request、push `main` | 安装依赖、类型检查、Rust check、少量关键单测 | CI 状态 |
| `build.yml` | push `main`、`workflow_dispatch` | 并行在 GitHub Hosted Runner 构建双端 | Windows NSIS `.exe`、Android 可安装 APK（开发构建） |
| `release.yml` | 推送 `v*` tag、手动触发 | 发布对应版本、签名、校验、自动上传 GitHub Release | Windows 安装包、正式签名 Android APK、SHA-256 摘要 |
| `deploy-cloudflare.yml` | **仅 `workflow_dispatch`** | 用户明确授权后运行迁移/部署 Cloudflare | 后端 URL、部署摘要（不暴露 Token） |

技术要求：

- `windows-latest` 构建 Windows x64；`ubuntu-latest`（或官方当前支持的 runner）配置 JDK、Android SDK/NDK、Rust Android targets 等构建 Android APK。依照当期 Tauri 2 文档执行 CLI build；Windows `.exe` 可使用 NSIS。
- 首版 Android 重点提供 **arm64 APK**；可在不显著增加复杂度时加入其他 ABI。正式 Release APK 必须用持久化签名密钥签名，否则升级会失败；签名材料保存在 GitHub Actions Secrets，不写入仓库。无签名密钥时 CI 仅产出标明 `debug` 的 APK，不伪装成稳定版。
- Windows 代码签名在用户具备证书时启用；未签名时明确标记，不能默称 Windows SmartScreen 不会警告。
- 使用锁文件、官方稳定工具链版本、依赖缓存；每个平台失败应显示独立错误；CI 不允许 `continue-on-error` 掩盖失败。
- Release 以单一版本号同时管理 Windows 与 Android，Git tag 例如 `v0.1.0`，上传清晰命名的安装包及校验值；不需要手工下载产物后二次上传。
- GitHub Actions `permissions` 最小化：普通构建仅 `contents: read`，Release 发布才授予 `contents: write`；第三方 Actions 固定可信版本，敏感部署任务不在不可信 PR 上运行。
- Cloudflare 部署独立于 App Release：**push `main` 不自动操作用户 Cloudflare 账户**。需要迁移/部署时在 GitHub Actions 手动触发并由有权限者授权。
- 初期可以不做应用内 OTA 更新；以后在 GitHub Releases 基础上增加 Tauri Updater 时必须实现签名/公钥校验。Android 通过 GitHub Release APK 更新时必须确保包名和签名一致。

### 8.2 一次发布的预期体验

1. 开发 Agent 在单仓库提交代码，推送到 GitHub。
2. GitHub Actions 自动检查并构建；Windows、Android 产物在同一仓库的 Actions 页面可下载。
3. 推送 `v0.1.0` 标签后自动生成 GitHub Release，附两个平台的安装包。
4. 用户下载 Windows `.exe` 和 Android `.apk`，配置自己的后端，设备配对即可使用。

### 8.3 云端构建的最少 Secret

| Secret | 使用范围 | 何时需要 |
|---|---|---|
| `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD` | Android 正式签名 | 发布 Release |
| `CLOUDFLARE_API_TOKEN` | Cloudflare 部署工作流 | 用户主动启用远程部署 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 部署工作流（非秘密时可用 Variable） | 依部署工具需要 |
| Windows 签名相关 Secrets（可选） | Windows 代码签名 | 用户持有证书时 |

**不在 GitHub 仓库提交私钥、keystore、Provider Token、Cloudflare Token、真实用户数据或本机路径。** 无 CI 部署权限时，用户仍可在自己的电脑通过 Agent 引导完成 Cloudflare 资源部署。

## 9. 安全、离线与数据所有权

- Owner、Android Device、Windows Bridge、MCP Agent 使用不同权限与可撤销凭证；项目与会话做作用域校验。
- Android 凭证通过平台安全存储/Keystore 保护；Windows 使用系统凭证库或安全持久化机制；不能存入纯文本日志或 WebView 明文 LocalStorage。
- HTTPS + WebSocket over TLS；Pairing 使用短期一次性 Token；访问日志不包含敏感正文或凭证。
- 数据操作使用幂等键与数据库条件更新。离线草稿只在服务端确认后标记已朱批；冲突时保留草稿并展示服务器现有决定。
- 设备与 Agent 凭证可以撤销；导出消息、奏折、任务历史与必要元数据，不绑死 Cloudflare。
- Bridge 仅执行用户授权项目目录内的受管任务；不提供任意远程 Shell API，不绕过 Provider 的本地执行审批。

## 10. 最小验证与交付条件（刻意精简）

不要建立大型测试体系。至少做到：

1. **云端 CI 通过**：前端类型检查、Rust 编译检查、协议的基础测试；Windows/Android 均能生成可下载的安装产物。
2. **一个真实闭环**：Agent 通过 MCP 提奏 → Windows/Android 可见 → Android 朱批 → 后端保存 → Windows Bridge 在受管会话支持时领取并恢复（MCP-only 则查询领取）。
3. **基本稳定性**：断线重连不丢批复，同一奏折不会因重复提交被二次批准；凭证撤销后不可访问。

不强制模拟器自动化、截图回归、性能基准、大量单测或多平台矩阵。不要在未实际验证时把某能力标记为已完成。若某 Provider 的恢复 API 不支持某操作，应如实降级并记录。

## 11. 最终交付清单

- 一个公开或可开源的 GitHub Monorepo，根目录只有这一份主规格 `SPEC.md`。
- Windows 10/11 x64 正式安装包；Android 10+ 可安装 APK，均从 GitHub Actions 或 Releases 下载。
- 共享的双视觉 UI（仿真皇帝 / 现代极简高端）及独立双汇报风格（奏折 / 标准）。
- Windows Bridge、Codex/Claude Code 适配、远程 MCP Server、人工朱批与可靠消息同步。
- Cloudflare Free 自部署实现、迁移脚本和给 AI Agent 使用的部署说明。
- `.github/workflows/` 下完整可用的云端 CI、双端构建、Release、手动后端部署工作流。
- 简洁 README：产品简介、截图、部署指引、Agent 接入、安装包下载位置、已实现功能与已知限制。

## 12. 开发优先顺序

1. **Monorepo + Tauri 共享客户端 + GitHub Actions 双端云构建**，尽早得到真实安装包。
2. **Cloudflare 后端 + 认证 + MCP 奏折/朱批闭环**，实现 Windows/Android 实时同步。
3. **Windows Bridge + Provider Adapters + 应用内任务对话**，打通主动下任务与受管会话恢复。
4. **双完整 UI + 双汇报表现 + 移动端细节**，作为正式产品的设计重点。
5. **GitHub Release + 自部署文档 + 少量验收**，发布首个可安装版本。

允许增量提交，但最终必须是可运行软件，不是 HTML 原型和假数据演示。不要为了未来多 Agent 编排引入复杂架构；保留可扩展的 Agent/Task/Session 类型即可。

## 13. 官方技术参考（实施时按最新文档复核）

- [Tauri 2 — GitHub Actions](https://v2.tauri.app/distribute/pipelines/github/)
- [Tauri 2 — Build & Distribute](https://v2.tauri.app/distribute/)
- [Tauri 2 — Android/Windows CLI](https://v2.tauri.app/reference/cli/)
- [Cloudflare CLI `cf` — Agent 指南](https://developers.cloudflare.com/cf/agents/)
- [Cloudflare CLI `cf` — 项目部署](https://developers.cloudflare.com/cf/projects/)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Cloudflare Workers Free 限制](https://developers.cloudflare.com/workers/platform/limits/)
- [GitHub Actions — Artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data)

---

**给开发 Agent 的启动指令：**

> 读取根目录 `SPEC.md`，在当前**唯一 GitHub 仓库**中实现 KangXi.exe。优先建立共享 Tauri 项目和 GitHub Actions，让 Windows 安装包与 Android APK 由云端自动产出。随后完成 Cloudflare 免费自部署、MCP 奏折、跨设备朱批、Windows Bridge 和 Codex/Claude 真实会话适配。UI 设计请自由发挥到高品质：一个真正沉浸的皇帝模式，一个现代极简高端模式，外加独立的奏折/标准报告风格。不要做多 Agent 编排，不要堆砌验证和测试。所有操作保持最小权限，Cloudflare 部署需用户授权，最终提交可安装 Release 和清晰的使用说明。
