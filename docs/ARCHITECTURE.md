# ARCHITECTURE.md

## 定位

dsh-agent-teams 把 DeepSeek Harness 从「一个能调 subagent 的 Agent」升级为「能组织多个长期协作 Agent 的团队运行时」。它是**纯协调层**：

- ❌ 不自建 LLM loop / 不调模型 API / 不建第二套 session / 不写自己的 MCP 运行时
- ✅ Agent 运行时 = Harness `ctx.subagents`（continuable 子代理）
- ✅ 状态 = Harness `ctx.storageDomain`（`agent_teams` domain，zod 校验）
- ✅ 工具 = Harness `ctx.tools`（薄壳，全部委托 Service）
- ✅ 身份 = 真实 harness `SessionId`（`exec.agent.id`）

```
                    USER
                      │
                      ▼
              ┌────────────────┐
              │   TEAM LEAD    │  当前会话 Agent（leadSessionId）
              └───────┬────────┘
                      │ team_* tools / system-prompt section / /team 命令
               ┌──────▼───────┐
               │ AgentTeams   │  ctx.agentTeams（host 平面 Cordis Service）
               │ Service      │  业务逻辑唯一所在
               └──┬───────┬───┘
        ┌─────────┘       └────────────┐
        ▼                              ▼
┌────────────────┐            ┌────────────────────┐
│ TeamStore seam │            │ TeamRuntimeAdapter │
│ DomainStore /  │            │ (ctx.subagents)    │
│ MemoryStore    │            │ startContinuable   │
└───────┬────────┘            │ followup/report/   │
        │                     │ interrupt          │
┌───────▼────────┐            └─────────┬──────────┘
│ storageDomain  │                      │ 原生 continuable
│ agent-teams    │                      ▼ 子代理（真实 Session）
│ (json/sqlite)  │               Harness Agent Runtime
└────────────────┘
```

## 分层

| 层 | 位置 | 职责 |
|---|---|---|
| **core**（无 Cordis 依赖，仅 zod） | `src/core/` | 数据模型、typed errors、DAG 与原子认领、完成守卫、事件名、协议提示词、`TeamStore` seam + `MemoryStore`。可纯 Node 测试。 |
| **harness 适配器** | `src/harness/` | `DomainStore`、`HarnessRuntimeAdapter`、事件桥（原生→语义）、Cordis 声明合并。Harness 升级时只改这层。 |
| **模型工具** | `src/tools/` | 34 个 `team_*` 工具 = 校验 + 身份解析 + `ctx.agentTeams` 调用。 |
| **插件入口** | `src/index.ts` | 打开 domain、装配 service、注册工具/提示词/命令/路由/事件监听。 |
| **Web 面板** | `src/client.ts` | 侧栏 "Teams" 按钮 + 浮动快照面板（轮询 `/agent-teams/*`）。 |

## 关键机制

### 原子认领
`claimTask/claimNextTask` 通过 `TeamStore.update(key, fn)` 实现 read-modify-write：
- `DomainStore` → domain 写链（`KvTable.update`），并发安全由 Harness 保证；
- `MemoryStore` → 单线程同步变换，等价原子。
- `claimNextTask` 扫描候选（pending、无主、依赖已满足）按优先级排序，逐个尝试原子认领；被抢走就继续下一条。**一个任务永远只有一个 owner。**

### 依赖 DAG
- `addDependency` 用 DFS 检测环（A→B→C→A 拒绝，typed `DEPENDENCY_CYCLE`）。
- 认领时实时校验依赖（依赖任务必须 completed）；依赖完成后 dependent 自动可认领。

### 计划审批
`requiresPlan` 任务：`submitPlan` 把任务置 `blocked` → lead `approve/reject` → 任务回 `pending`。完成守卫要求每个 requiresPlan 任务有 approved 计划。

### 完成守卫（`team_complete`）
全部成立才允许完成：required 任务全部 completed；无 critical blocked 任务；requiresPlan 任务均有 approved 计划；critical/high findings 无 open。违反 → `TEAM_NOT_COMPLETABLE` + 具体原因列表。

### 消息
- 持久 inbox（`toSessionId` 或广播）永远落库。
- 原生投递：lead → 直系子代（`followup`，权限模型要求）；成员 → lead（`reportFrom`）。
- 成员→成员：V1 落库 + lead 中转（文档化）。

### 文件认领
`file / directory / glob` 三种 pattern；冲突判定 = 相同模式或前缀包含（glob 取其静态前缀）。批量认领先全量检查后写入（无部分成功）。

### 状态语义
native 状态（`agent/status` 的 idle/running）= 运行时真相；team 状态（working/blocked/reviewing/…）= 编排元数据。桥接器只做映射，不复制生命周期。心跳不做 daemon：`lastActiveAt` 由工具调用与原生事件驱动。

## 安全
- 身份全部来自 `exec.agent.id` / `CommandInvocation.agent.id`，模型传入的 sessionId 不作为身份凭据（只作为目标地址并被成员校验）。
- 插件不新增 shell/fs/network/eval 工具；文件/命令仍由 Harness 原有工具与沙箱管理。
- `/agent-teams` 仅 loopback 绑定（webserver 默认 127.0.0.1）。
- 无启动期自动删除任何数据（无 archive/delete 的 V1 只增不改）。
