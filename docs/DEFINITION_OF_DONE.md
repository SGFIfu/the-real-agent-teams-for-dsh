# DEFINITION_OF_DONE.md

对照任务书 §87 的逐项验收清单。每一项的实据见 `docs/VALIDATION.md` 与本仓库测试。

| # | 要求 | 状态 | 实据 |
|---|---|---|---|
| 1 | Native Cordis plugin | ✅ | `src/index.ts` 导出 `apply`，bundle 行 `dsh-agent-teams` 经 loader 实机加载 |
| 2 | AgentTeams Service（`ctx.agentTeams`） | ✅ | `src/core/service.ts` + `ctx.provide`；动态实例同接口 |
| 3 | Harness Storage Domain | ✅ | `agent_teams` domain（7 表 zod 校验）；实机日志 `durable`；重启重建测试 |
| 4 | Native Subagent integration | ✅ | `src/harness/runtime.ts` 直接调用 `startContinuable/followup/reportFrom/interrupt/listChildren`（真实类型编译校验） |
| 5 | Continuable teammates | ✅ | `team_member_spawn`：注册占位 → `startContinuable` → 回填真实 `childId`（保留 session 身份） |
| 6 | Shared Task Board | ✅ | tasks 表 + `team_task_*` 工具 + 面板渲染 |
| 7 | Atomic task claiming | ✅ | `TeamStore.update` 原子 RMW；50 并发单任务恰好 1 owner；50 路并行 claimNext 恰好 20 胜出 |
| 8 | Task Dependencies | ✅ | DFS 环检测（`DEPENDENCY_CYCLE`）、菱形 DAG、依赖阻塞/释放测试 |
| 9 | Messaging | ✅ | 直发/广播/收件箱 + 类型化消息 + lead 原生 followup 通道 |
| 10 | Plan approval | ✅ | submit→blocked→approve/reject→pending；完成守卫校验 approved 计划 |
| 11 | File claims | ✅ | file/directory/glob 冲突判定、批量原子性、owner/lead 释放 |
| 12 | Reviewer protocol | ✅ | `REVIEWER_APPENDIX` 提示词 + findings（severity/state）+ 完成守卫拦截 open critical/high |
| 13 | Team completion guard | ✅ | `TEAM_NOT_COMPLETABLE` + 逐项 reasons（required/blocked/plans/findings） |
| 14 | Typed events | ✅ | 17 个 `agent-teams/*`（`src/harness/declare.ts` 声明合并）+ 原生 `agent/status`、`subagent/end` 桥接 |
| 15 | Model tools | ✅ | 34 个 `team_*` 工具（静态 bundle + 动态实例同套） |
| 16 | Tests | ✅ | 47/47（task/concurrency/dependencies/messaging/plans/file-claims/persistence/simulation） |
| 17 | Concurrency simulation | ✅ | 50 路竞态 + 4 agents 自调度 + 20 任务 6 角色无模型全队仿真 |
| 18 | Bundle | ✅ | `cordis.patch.yml`（单宿主行增量层）+ `dsh.bundle.patch` + `dsh.client` manifest |
| 19 | Profile installation | ✅ | `--dump-config` 组合正确；实机 `--port 3199` 启动全链路验证 |
| 20 | README | ✅ | 安装/使用/结构/守卫/边界 + examples + presets |
| 21 | Validation | ✅ | `docs/VALIDATION.md`（Build/Unit/Concurrency/Storage/Subagent/Bundle/Web UI 逐项 PASS 记录 + 已知限制） |

## 验收残留（透明披露）

| 项 | 状态 | 说明 |
|---|---|---|
| 真实模型 spawn 冒烟 | 未跑 | 验证环境无模型凭据；adapter 为真实 API 类型编译级验证 + 仿真逻辑级验证（见 VALIDATION.md） |
| 动态插件（本会话） | 定义完成，待用户审批 | `agtms-1/pkg-1` 在 Web UI 等待批准；批准后提供 `ctx.agentTeams` + 34 工具 + Teams 面板 |
| lint 脚本 | 无 | 仓库无 linter 配置；以 tsc strict（`npm run typecheck`）作为静态门禁 |
