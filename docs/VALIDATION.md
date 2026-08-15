# VALIDATION.md

dsh-agent-teams 验证记录（全部实测，未声称任何未运行项）。

## 环境

| 项 | 值 |
|---|---|
| DeepSeek Harness | `@deepseek-ai/dsh` 0.1.0-rc.6 |
| Cordis | `@deepseek-ai/cordis` 4.0.1 |
| Node | v24.16.0 |
| OS | Windows 11（pwsh） |
| 构建工具 | typescript 5.9.x（tsc），无 pnpm（profile 用手工布局） |
| 验证 DSH_HOME | `C:\知识库\.dsh-test`（隔离，不污染真实 home） |

## Build

```
npm run build   → tsc 零错误（strict 全开）
```

**PASS** — 输出 `lib/`（index.js、core/*.js、harness/*.js、tools/index.js、client.js + 全部 .d.ts）。

## Unit / concurrency / persistence / simulation tests

```
node tests/run-in-process.mjs && node tests/client-module-bundle.mjs
ℹ tests 61  ℹ suites 9  ℹ pass 61  ℹ fail 0
```

**PASS** — 61/61。覆盖：团队创建/持久化、成员注册与上限、任务生命周期、**原子认领（1 任务 50 并发 → 恰好 1 个 owner；4 agents 自调度 20 任务无重复 owner；50 路并行 claimNext 恰好 20 胜出）**、依赖阻塞/释放/菱形 DAG、环检测（A→B→C→A 与 2-环拒绝）、消息直发/广播/收件箱、计划提交→阻塞→批准/拒绝、文件认领冲突（exact/目录/glob/批量原子性）、重启重建持久化、完成守卫全部闸门、**20 任务 6 角色无模型全队仿真**，以及 client snapshot/event/bundle registration/CSS contract 测试。

> 注：`node --test` 的按文件子进程模式被本机沙箱禁止（spawn EPERM），测试通过单进程驱动 `tests/run-in-process.mjs` 运行 —— 同一 node:test 运行器、同一断言，仅隔离模式不同。

## Concurrency

**PASS** — 见上：50 并发单任务认领、50 路并行 claimNext、4 agents 并发自调度。无 sleep 伪装并发；原子性建立在 `KvTable.update`（domain 写链）契约与单线程同步变换之上，并有源码级注释。

## Storage persistence

**PASS** —
1. 单测：dump 全部记录 → zod 往返校验 → 新 MemoryStore 重建 → 依赖状态/收件箱/完成守卫在"重启"后保持（`persistence.test.ts`）。
2. 实机：`dsh --profile agent-teams` 启动日志 `[agent-teams] storage: harness domain "agent_teams" (durable)` —— 真实 `ctx.storageDomain` 打开成功（json backend，`$DSH_HOME/storages`）。

## Subagent integration

**PASS（API 契约级）** — `HarnessRuntimeAdapter` 直接调用 `ctx.subagents.startContinuable` / `followup` / `reportFrom` / `interrupt` / `listChildren`，类型经真实 `ContinuableStartSpec` 编译校验。本验证环境未配置模型 API 凭据，未跑真实模型 spawn；无模型仿真与协议提示词已覆盖协调逻辑。真机 spawn 冒烟列入 Known limitations。

## Bundle install

**PASS** —
1. `dsh --profile agent-teams --dump-config`（`DSH_HOME=C:\知识库\.dsh-test`）→ 组合树含 `# == dsh-agent-teams` 层、`- id: agent-teams, name: dsh-agent-teams, inject: [storageDomain, subagents, tools, systemPrompt, webServer]`，无 warning/error。
2. profile 布局：`profiles/agent-teams/{package.json(dsh.profile.bundles 含 dsh-agent-teams), cordis.patch.yml, node_modules/dsh-agent-teams(junction)}` —— 与 `dsh plugin add` 生成的布局等价（本机无 pnpm，手工布局并已记录）。

## Web UI

**PASS** —
1. `dsh --profile agent-teams --port 3199` 启动：`dsh web: http://127.0.0.1:3199`，根页 HTTP 200。
2. 启动日志完整激活链：storage(durable) → service provided → **tools registered** → event bridge → prompt section → command → **web route registered at /agent-teams**。
3. `GET /agent-teams/teams` → HTTP 200 `[]`（真实 JSON）。
4. 客户端模块进入浏览器引导图：`window.__DSH_BOOT__` 含 `{"id":"dsh-agent-teams","url":"/plugins/dsh-agent-teams/client.js?rev=…"}`。

### Current 3080 regression (2026-08-14)

针对用户提供的 `http://127.0.0.1:3080/` 实机回归：

1. `Teams` 侧栏入口加载成功，点击后打开 `Agent Teams Command Center`。
2. 面板读取真实持久化 Team `Mini Notes Team`，显示 6 个任务的 DAG、空成员态、Activity Feed 和 Observe Mode 筛选器；`Timeline`/`TASKS` 交互已验证。
3. CSS marker `style[data-plugin-css="dsh-agent-teams/command-center"]` 存在一次；`.agc-surface` 为 `position: fixed`、四边 `0px`，不再挤在侧栏窄栏中。
4. `GET /agent-teams/teams` → HTTP 200，返回 `team_00000001_2c9da37d`；`GET /agent-teams/team/team_00000001_2c9da37d/snapshot` → HTTP 200，返回 `team,members,tasks,messages,plans,fileClaims,findings,progress`，其中 `tasks=6`、`members=0`。
5. 期间修复了 classic client bundle registration、React loader dependency、`slots.register` 的 receiver 绑定、Cordis timer 可选读取，以及静态 CSS fallback；修复后 `npm run typecheck`、`npm run build`、`npm test` 均 PASS。

## 实测过程中发现并修复的 Harness 约束（已回写 docs/HARNESS_COMPATIBILITY.md）

1. Storage domain 名必须匹配 `/^[a-z][a-z0-9_]*$/`（不允许连字符）→ domain 名 `agent_teams`。
2. 工具 `output.schema` 走强制 JSON Schema 子集校验：`const` 必须带 `type`。
3. 插件行的 `inject` 决定激活时序：webServer 不在 inject 列表时路由静默未注册（先于 webserver 激活）→ inject 补 `webServer`。
4. `/api` 前缀被 API 网关占用（先注册先匹配）→ 面板路由用独立前缀 `/agent-teams`。
5. 出树 bundle 的运行时依赖需从其自身树可解析（profile 内 junction + 工作区级 junction 演示）。
6. 客户端 `dsh.client.inject` 只应引用 wire 图内存在的模块 id（`@deepseek-ai/dsh-client-runtime`）。

## Known limitations

- 未跑真实模型 spawn 冒烟（本环境无模型凭据）；subagent 集成为 API 契约级 + 无模型仿真级验证。
- 静态 Web 面板经 4s 轮询 loopback 路由获取数据（V1 通道；typert `@Remote` 为升级路径）。
- 成员→成员原生消息投递受 `followup` 直系父权限限制：V1 落 inbox + lead 中转。
- `dsh plugin add` 需 pnpm（本机未装）；已用手工 profile 布局验证等价路径。

## 动态插件（本会话 cordis 运行时）—— 已实机运行验证

`agtms-1`（dsh-agent-teams dynamic live instance）经历三次包迭代后运行成功：

| 版本 | 结果 | 修复内容 |
|---|---|---|
| pkg-1 | ❌ host-half-failed | 动态工具必须经 `harness.defineTool()` 创建（DYNAMIC_TOOL 标记断言） |
| pkg-2 | ✅ 宿主运行 / ❌ 客户端渲染崩溃 | 参数改用 ParameterSchemaSpec DSL、`inject: ['agents','subagents']` 声明服务读取、返回值 JSON 净化；客户端仍用了浏览器全局 `setInterval` |
| pkg-3 | ✅ **运行中（current）** | 客户端 `inject: ['timer']` + `ctx.timer.interval`（回调式清理） |

**运行证据（cordis_inspect_self + Tool.listTools）**：
- 插件状态 `running`，currentPackageId `pkg-3`，activeRun `run-3`
- Host 半区：`provides: ["agentTeams"]`，RPC handlers `teams`/`snapshot`，无 waiting
- Client 半区：`running`，无 waiting（侧栏 Teams 按钮 + 浮动面板，`ctx.timer` 4s 轮询）
- **34 个 `team_*` 工具全部注册并对当前模型可见**（Tool.listTools 实测：team_create/status/snapshot/pause/resume/complete、member_register/spawn/members、task_create/create_many/list/get/claim/claim_next/complete/fail/release/reassign/block/add_dependency、message_send/broadcast/messages、plan_submit/approve/reject/list、file_claim/release/claims、finding_add/resolve/accept/findings）

动态实例为会话内进程局部（in-memory 存储，符合动态插件语义）；持久化路径由静态 bundle 的 `agent_teams` domain 承担（实机验证见上）。

> 后续更新：pkg-4 命名为 "The real agent teams"，新增 `/real-agent-teams` 命令（status/tasks/agents/messages），run-4 成功并保持运行。

## 重启后自动加载（真实 web profile）—— 已配置并验证

用户真实 DSH_HOME（`C:\Users\荣耀\.dsh`）的 `web` profile 已注册本 bundle：

- `profiles\node_modules\dsh-agent-teams` → junction 到 `C:\知识库\dsh-agent-teams`（仓库重建即自动生效）
- `profiles\web\package.json` 的 `dsh.profile.bundles` 追加 `"dsh-agent-teams"`（真实 pnpm 提升布局，依赖 zod/schemastery/dsh-storage-domain 等均在 `profiles\node_modules` 解析）

**验证**：`dsh web --dump-config`（默认 DSH_HOME）→ 组合树含 `# == dsh-agent-teams` 层，零警告；`dsh --profile web --port 3299` 实机启动 → 完整激活链（durable `agent_teams` domain / 34 工具 / 提示词 / `/real-agent-teams`+`/team` 命令 / 路由 `GET /agent-teams/teams → 200 []`）。

从此用户正常启动（`dsh web` / 3080）即自动加载 The real agent teams。
# Historical Validation Note

The current remediation and final re-qualification results supersede this historical validation record. See the repository-root [VALIDATION.md](../VALIDATION.md), [REMEDIATION_REPORT.md](../REMEDIATION_REPORT.md), and [AGENT_TEAMS_FINAL_ACCEPTANCE.md](../AGENT_TEAMS_FINAL_ACCEPTANCE.md). The original contents below are retained as baseline evidence.
