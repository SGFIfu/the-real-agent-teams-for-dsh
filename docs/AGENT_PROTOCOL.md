# AGENT_PROTOCOL.md

teammate 之间、teammate 与 lead 之间的协作契约。全部通过 `team_*` 工具执行；每次 spawn 的 teammate 系统提示都携带此协议（`src/core/prompts.ts`）。

## 生命周期

```
spawn (team_member_spawn)
  │  注册成员 + startContinuable(teammate prompt)
  ▼
工作循环（每个任务）
  team_task_claim / team_task_claim_next   ← 原子认领
  team_file_claim                          ← 涉及文件前认领区域
  实现 + 校验（测试/类型检查）
  team_task_complete(taskId, 简明结果)
  │
  ▼
继续：team_task_claim_next 直到
  - 团队 completed
  - lead 发 shutdown 消息 / interrupt
  - 无可用工作
  - 被替换
```

## 开始任务前（顺序固定）

1. `team_task_get` — 检查任务与依赖
2. 检查未完成依赖（认领会强制校验，`TASK_DEPENDENCIES_UNRESOLVED` 是诚实失败）
3. `team_messages` — 读团队消息
4. `team_file_claims` — 检查现有认领
5. `team_file_claim` — 重大修改前认领区域

## 工作中

- **即时沟通**：API 契约变更、schema 变更、函数改名、测试假设失效、共享类型变更 —— 立刻 `team_message_send`，不要攒到完成。
- 被阻塞：`team_task_block` + 通知 lead（具体原因）。
- 不要动别人认领的文件；冲突 → 给 owner 发消息协调。
- `requiresPlan` 任务：先 `team_plan_submit`，**approved 前不实现**。

## 任务结束后

1. 跑校验（测试/typecheck/lint）
2. `team_task_complete` + 简明结果（改了什么、关键接口、测试、阻塞、决策——不要贴全量日志）
3. 重要发现发给 lead
4. 看任务板，`team_task_claim_next`，继续

## 消息类型

| type | 用途 |
|---|---|
| message | 一般协调 |
| question | 提问 |
| result | 阶段性结果 |
| warning | 影响他人的变更（契约/schema） |
| handoff | 交接 |
| review | 评审发现 |
| plan | 计划相关 |
| shutdown | lead 通知停摆 |

## Reviewer 协议

1. 读 diff / 变更文件；跑验证
2. 检查：正确性、架构、安全、回归、测试、边界、性能、可维护性、需求
3. `team_finding_add`（severity: critical/high/medium/low）
4. 发现报告 lead；**默认不批量改他人代码**
5. critical/high 未处理时 lead 无法 `team_complete`

## Lead 协议

1. 建任务 DAG（`team_task_create_many` + `team_task_add_dependency`）
2. 团队规模：小=1，中=2-3，大=3-5（上限 5）
3. `team_member_spawn`（角色：architect/backend/frontend/tester/reviewer/debugger/researcher/devops/…，可动态）
4. `team_snapshot` 是主要状态接口（不要连环调用 10 个工具）
5. 高风险任务 `requiresPlan: true`；lead 决策 `team_plan_approve/reject`
6. 阻塞/冲突/评审循环处理；stale 任务 `team_task_release`/`reassign`
7. 完成守卫全部满足才 `team_complete`
