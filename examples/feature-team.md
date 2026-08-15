# 场景：功能开发团队（feature-team）

```text
Use Agent Teams.

Analyze this repository and select one small, low-risk testable improvement.

Create:
- one implementation teammate
- one testing teammate
- one reviewer teammate

Build a dependency-aware shared task graph on the shared board.
Let teammates communicate through Agent Teams (contract changes, schema changes).
Use file claims so no two agents edit the same file.
Have the implementation teammate self-claim follow-up work when idle.
Run tests after implementation.
The reviewer records findings with severity; critical/high findings must be
resolved or explicitly accepted before the team can complete.
Only mark the team complete when integration validation passes.
```

期望流程：lead 建队 → `team_task_create_many`（实现→测试→评审的 DAG）→ `team_member_spawn` 三个角色 → 并行执行 → 消息协调 → 评审发现 → 修复 → `team_complete`（守卫通过）。
