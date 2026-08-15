# STORAGE.md

## 总原则

插件**不绑定**存储后端。它只面向两个抽象：

1. `TeamStore`（`src/core/store.ts`）—— 七张表的 CRUD + 原子 `update` seam
2. Harness `ctx.storageDomain` —— 打开 `agent_teams` domain，路由到 profile 当前 backend

## Domain 声明（`src/harness/domain.ts`）

- name: `agent_teams`，version: 1
- 表（zod 校验，`src/core/schemas.ts`）：

| 表 | 记录 | 说明 |
|---|---|---|
| teams | `AgentTeam` | 团队 |
| members | `TeamMember` | 成员（真实 harness SessionId） |
| tasks | `TeamTask` | 任务 + DAG 依赖 + owner |
| messages | `TeamMessage` | 团队消息（持久 inbox） |
| plans | `TeamPlan` | 计划审批 |
| file_claims | `FileClaim` | 文件认领 |
| findings | `ReviewFinding` | 评审发现 |

- 打开失败（`already-open` 等）会让插件行激活失败 —— fail loud，不静默换后端。

## 原子性契约

`TeamStore.update(table, id, fn)`：`fn` 在当前值上同步变换；并发 update 不可交错。
- `DomainStore` → `KvTable.update`（domain 写链，durability 先于内存与事件）
- `MemoryStore` → 单线程同步变换

任务认领（claim）完全建立在该原语上：`status==='pending' && 无主 && 依赖满足` 的条件在 `fn` 内部重检，任何竞态都表现为「保持原值 → 继续下一条候选」。

## backend 路由

web profile 已挂载：

```yaml
- id: storage        name: '@deepseek-ai/dsh-storage'
- id: storage-json   name: '@deepseek-ai/dsh-storage-json'  (root: $DSH_HOME/storages)
- id: storage-domain name: '@deepseek-ai/dsh-storage-domain' (backend: json)
```

- 简单开发：json（默认，web profile 现状）
- 大量 task/event：把 `storage-domain` 行 `backend` 改为 sqlite（profile 自己的 cordis.patch.yml 覆盖），`agent_teams` domain 自动跟随

## 回退

`storageDomain` 未挂载（如极简 headless 组合）时插件自动使用 `MemoryStore` 并在日志标注 `[agent-teams] storage: in-memory fallback`；`config.storageMode: memory` 可显式强制。回退是**可见**的（日志 + `storageMode` 配置），协调语义不变，仅持久性丧失。
