# The Real Agent Teams for DSH

DeepSeek Harness 原生 **Agent Teams** 插件：把 Harness 从一个能调用 Subagent 的 Agent，升级成能组织**多个长期协作 Agent** 的软件团队运行时。内部 package/plugin ID 保持为 `dsh-agent-teams`，显示名为 **The Real Agent Teams for DSH**，斜杠命令 `/real-agent-teams`（别名 `/team`）。

> Release: `v0.1.0` · The first formal public release of **The Real Agent Teams for DSH**
>
> Qualification note: this is a formal public release, but it is not yet production-qualified. The latest independent acceptance result is **84/100 · PARTIALLY QUALIFIED**. Core service tests, build, persistence, atomic claiming, dependency enforcement, client registration, privacy-safe plugin Inspector projection, and real peer-message delivery passed. The real provider run was stopped by `Insufficient Balance / QUOTA` before persistent Task B closure, an independent Reviewer fix/re-review loop, and final completion could be proven.

```
Team Lead + Persistent Teammates + Shared Task Board + Task Dependencies
+ Atomic Task Claiming + Agent-to-Agent Messaging + Plan Approval
+ File Ownership + Reviewer Agents + Team Monitoring + Human Steering
```

## 不是

- ❌ 不是 LLM loop / 不调模型 API
- ❌ 不是第二套 Agent/Session 运行时
- ❌ 不是外部 MCP 协调器 / Python 编排脚本

是：**一个 Native Cordis 插件**，向 Harness 提供 `ctx.agentTeams` Service，其余全部复用 Harness 原生能力（`ctx.subagents` continuable 子代理、`ctx.storageDomain`、`ctx.tools`、`ctx.systemPrompt`、`ctx.commands`、Web UI Slots）。

## 安装

```bash
# 方式 A：dsh plugin（需要 pnpm）
dsh plugin --profile web add dsh-agent-teams
# 或本地 checkout
dsh plugin --profile web add ./dsh-agent-teams

# 方式 B：手工 profile 布局（无 pnpm，见 VALIDATION.md）
# 把 dsh-agent-teams 放入 $DSH_HOME/profiles/<name>/node_modules/，
# 在 profile 的 package.json 的 dsh.profile.bundles 中追加 "dsh-agent-teams"
```

> Git 安装注意：若包带 `prepare` 构建脚本，pnpm 默认拦截 —— 按提示把 key 加入 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds`。本仓库用 `build` 脚本而非 `prepare`（发布物含预构建 `lib/`）。

## 验证

```bash
dsh --profile web --dump-config     # 应看到 agent-teams 行
dsh --profile web web               # 启动后无加载错误，侧栏出现 Teams 按钮
```

当前发布验证记录：

- `npm run typecheck`：PASS
- `npm run build`：PASS（生成 `lib/client.js`）
- `npm test`：PASS（120/120）
- Client module registration：PASS
- Independent acceptance：84/100，`PARTIALLY QUALIFIED`

## 使用

打开 DeepSeek Harness，直接说：

```text
Use Agent Teams.

Analyze this project and create a development team.
Choose the necessary roles yourself.
Break the goal into a dependency-aware shared task graph.
Run independent work in parallel.
Let teammates communicate with each other.
Prevent file ownership conflicts.
Allow idle teammates to self-claim available work.
Use plan approval for high-risk architectural changes.
Run tests after implementation.
Create a separate reviewer.
Resolve important review findings.
Only declare the team complete after integration validation.
```

之后 Harness 自动：理解目标 → 创建 Team → 建 Task DAG → spawn continuable teammates → 并行工作 → Agent↔Agent 通信 → 任务自认领 → 测试 → 评审 → 修复 → 集成 → `team_complete`。

### 双视图团队工作台

插件不会替换原生 Harness 主界面，而是提供两种可切换的观察方式：

- **专注模式**：右侧轻量活动栏，保留原生 Harness 的主要工作区，同时查看当前 Team 的进度、成员状态和最近活动。
- **团队工作台**：展开完整视图，查看真实 Agent 节点、任务依赖图、活动流、消息和 Inspector。

首次打开时不会自动选择第一支 Team。点击侧栏的 **Agent Teams** 后选择目标 Team；选择结果、视图模式和语言会在浏览器本地保存，刷新后恢复到同一支 Team。

面板右上角可以在中文 / English 之间切换，也可以打开设置分别自定义两种语言的常用文案。自定义只影响显示文本，不会改变 Team ID、Task ID、Session ID 或其他 Runtime 标识。

其他触发方式：`组一个 agent team`、`多个智能体一起做`、`团队开发`、`multi-agent team`、`/real-agent-teams status|tasks|agents|messages`（别名 `/team`）。

## 用法

### 1. 安装并启动

```bash
# 从 GitHub 安装当前正式版
dsh plugin --profile web add https://github.com/SGFIfu/the-real-agent-teams-for-dsh.git#v0.1.0

# 启动 Harness Web
dsh --profile web web
```

如果你已经在本地 checkout 了仓库，也可以直接安装本地目录：

```bash
dsh plugin --profile web add ./dsh-agent-teams
```

打开 `http://127.0.0.1:3080/` 后，在 Harness 侧栏点击 **Agent Teams**。插件不会自动选择第一支 Team；请选择要观察的 Team，再按需要切换 **专注模式** 或 **团队工作台**。

### 2. 创建团队

在 Harness 中直接描述目标，例如：

```text
Use Agent Teams to build a tiny notes app.
Create a Lead, Architect, Backend, Frontend, Tester and Reviewer.
Use a dependency-aware task graph, let independent work run in parallel,
require a plan for architecture, review the integration, and only complete
the Team after final validation passes.
```

Lead 会创建 Team 和任务 DAG；Teammates 通过 Harness 原生 Session 持续工作。对高风险任务，可以要求 `requiresPlan = true`，让 Architect 先提交方案，经 Lead 拒绝/修改/批准后再实现。

### 3. 观察和干预

- **专注模式**：保留原生 Harness 主界面，只在右侧查看 Team 进度、成员状态和最近活动。
- **团队工作台**：查看成员节点、共享任务图、Activity Feed、消息、文件 claims 和 Agent Inspector。
- 点击成员可查看真实 Session 的公开消息、Tool Call、Tool Result、任务和文件；隐藏 reasoning 不会进入 Inspector。
- 在 Inspector 或 Message 卡片中可以选择目标 Agent；需要发送消息时，先确认收件人和内容，再发送。
- 使用 `/real-agent-teams status`、`tasks`、`agents`、`messages` 查看 Team 状态（`/team` 是别名）。

### 4. 推荐协作节奏

```text
Lead 建图
  → Architect 提交并获批 Plan
  → Backend / Frontend 并行实现
  → Tester 集成验证
  → Reviewer 提交 Finding
  → Responsible Agent 修复并测试
  → Reviewer Re-check
  → Final Validation
  → team_complete
```

Team 不应依赖 Lead 手工复制每条消息，也不应在 required task、Plan 或高优先级 Finding 未完成时强行完成。服务层会对依赖、原子认领、文件冲突、Plan 和完成条件进行约束。

## 与相似工具的定位和优势

Agent 工具的“多 Agent”并不都解决同一个问题：有些重点是并行委派，有些重点是可配置的子 Agent，有些重点是终端内的单 Agent 配对。下面只比较公开文档明确描述的能力，不把未验证的 beta 功能当成承诺。

| 工具 | 官方公开的协作模型 | 更适合 | The Real Agent Teams for DSH 的差异 |
|---|---|---|---|
| **The Real Agent Teams for DSH** | DeepSeek Harness 原生插件；持久 Teammate、共享 Durable Task Board、依赖 DAG、原子 claim、Peer Message、File Claim、Plan/Review/Completion Guard 和实时 Workspace | 需要多个独立 Agent 长时间围绕同一任务图协作、可恢复、可观察的项目 | 优势在“协调不只靠 Prompt”：关键不变量在 Service 层、状态可持久化、成员直接通信，并且能在原生 Harness 与完整 Team Workspace 之间切换 |
| **OpenAI Codex** | 官方产品页强调多个 Agent 并行、独立 worktree / cloud environment，以及异步委派 | 并行处理多个相对独立的工程任务，分别 review/合并结果 | DSH 的重点不是多个隔离任务，而是同一 Team 内共享 DAG、任务依赖、原子认领、文件所有权和 Agent↔Agent 协作；它更适合同一项目内的协调闭环 |
| **Claude Code** | 官方 CLI 文档强调交互式编码 Session、`--continue` / `--resume`、权限控制、MCP 和本地项目工作流 | 终端内的高质量单 Agent 配对、可恢复会话和工具权限管理 | DSH 提供的是 Team 级共享协调层：谁拥有任务、谁占用文件、谁等待依赖、谁负责 Review，都成为可查询的运行时状态，而不只是同一会话里的提示词约定 |
| **OpenCode Agents** | 官方文档定义 primary/subagent、`@` 调用、子 Session 导航、模型与权限配置 | 可配置的专家 Agent、计划/构建/审查等角色切换和终端工作流 | DSH 把角色进一步放进持久 Team 生命周期：共享任务板、依赖解锁、直接消息、文件冲突保护和完成门禁由 Team Runtime 统一管理 |

### 本项目真正有价值的优势

1. **共享状态是真实状态**：所有成员读取同一 Team snapshot，而不是依靠 Lead 在多个上下文之间复制进度。
2. **并行工作有边界**：独立任务可以同时 claim；同一 exclusive task 或冲突文件不能被两个成员同时占有。
3. **成员可以自我调度**：Teammate 完成当前任务后，可以用同一个 Harness Session 检查消息、认领下一个可用任务，而不必每次由 Lead 重新 spawn。
4. **质量门禁在运行时**：Plan approval、Reviewer finding、测试结果和 Final Validation 会影响任务或 Team 是否可完成。
5. **可观察性属于工作流本身**：用户可以在原生 Harness 与 Team Workspace 之间切换，同时查看真实成员状态、任务图、消息、文件、公开 Session 事件和 Tool Activity。
6. **保持 Harness 原生边界**：插件复用 `ctx.subagents`、Storage、Tools、Commands 和 Web Slots，不另起一套模型 API 或 Session 运行时。

### 什么时候不该选它

如果只是让一个 Agent 快速修改一个文件，或者把几个完全独立的任务分别丢给并行工作区，Codex、Claude Code 或 OpenCode 的轻量工作流可能更简单。这个插件的价值只有在你需要“多个持久 Agent 围绕共享任务图长期协作，并且每一步都可观察、可恢复、可约束”时才会充分体现。

### 对比资料

- [OpenAI Codex：多 Agent、worktree 与 cloud environments](https://openai.com/codex/)
- [Claude Code CLI reference：Session、resume/continue、权限与工具](https://docs.anthropic.com/en/docs/claude-code/cli-usage)
- [Claude Code setup：本地项目与运行方式](https://docs.anthropic.com/en/docs/claude-code/getting-started)
- [OpenCode Agents：primary/subagent、子 Session 与权限](https://opencode.ai/docs/agents)
- [OpenCode Intro：Plan mode、项目初始化与使用方式](https://opencode.ai/docs/)

## 结构

```
src/core/         协调核心（无 Cordis 依赖，纯 Node 可测）：Service/Store/类型/错误/协议
src/harness/      Harness 适配器：DomainStore、subagent 运行时、事件桥、声明合并
src/tools/        34 个 team_* 模型工具（薄壳 → Service）
src/index.ts      插件入口（host 平面行）
src/client.ts     Web 面板（侧栏 Teams 按钮 + 快照浮层）
tests/            依赖/并发(50路)/消息/计划/文件/持久化/无模型仿真
docs/             ARCHITECTURE / HARNESS_COMPATIBILITY / AGENT_PROTOCOL / STORAGE / TROUBLESHOOTING
examples/         团队场景提示词（feature/debugging/review）
presets/          Agent Teams Development preset（可选 persona 注入）
```

## 开发

```bash
npm install          # 仅 typescript + zod（harness 类型经 tsconfig paths 指向已安装的 dsh）
npm run build        # tsc → lib/
npm test             # node --test lib/core/**/*.test.js
```

## 团队规模（默认上限 5）

| 任务规模 | teammates |
|---|---|
| small | 1 |
| medium | 2–3 |
| large | 3–5 |

## 完成守卫

`team_complete` 仅在全部成立时允许：required 任务完成、无 critical blocked、requiresPlan 任务有 approved 计划、校验已跑、critical/high findings 已解决或显式接受。

## 已知边界（V1）

- 成员→成员消息通过 Harness 原生 `followup` 能力由授权的 parent session 投递，并持久化 sender、recipient、transport、delivery state；若运行时失败，会记录为失败/可恢复 inbox，不会伪报送达
- Web 面板采用 snapshot-first 状态恢复，并通过 SSE/轮询重连补齐事件；不是动画或事件流作为唯一真相来源
- 无 archive/delete（不自动删数据）；git 策略默认共享 workspace + 文件认领减冲突
- 当前 Web 控制接口使用 same-origin browser cookie + CSRF 防护；宿主 Harness 没有向插件暴露通用 caller principal/RBAC，因此暂不宣称多用户权限隔离
- 插件 Inspector 使用 typed public-session projection，隐藏 Harness session 中的 reasoning/private block；宿主 Harness 主会话仍可能由宿主自己的 viewer 显示 Think 内容，这是宿主层限制
- 不做：云协调、多机分布式、远程 DB、完整多用户 RBAC、agent 市场（见 ARCHITECTURE.md）

License: MIT
