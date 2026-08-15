# The Real Agent Teams for DSH

DeepSeek Harness 原生 **Agent Teams** 插件：把 Harness 从一个能调用 Subagent 的 Agent，升级成能组织**多个长期协作 Agent** 的软件团队运行时。内部 package/plugin ID 保持为 `dsh-agent-teams`，显示名为 **The Real Agent Teams for DSH**，斜杠命令 `/real-agent-teams`（别名 `/team`）。

> Release status: `v0.1.0-experimental`
>
> This is an experimental public release, not a production-qualified release. The latest independent acceptance result is **84/100 · PARTIALLY QUALIFIED**. Core service tests, build, persistence, atomic claiming, dependency enforcement, client registration, privacy-safe plugin Inspector projection, and real peer-message delivery passed. The real provider run was stopped by `Insufficient Balance / QUOTA` before persistent Task B closure, an independent Reviewer fix/re-review loop, and final completion could be proven.

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
- `npm test`：PASS（73/73）
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

其他触发方式：`组一个 agent team`、`多个智能体一起做`、`团队开发`、`multi-agent team`、`/real-agent-teams status|tasks|agents|messages`（别名 `/team`）。

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
