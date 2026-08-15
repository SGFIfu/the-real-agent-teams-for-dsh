# TROUBLESHOOTING.md

## 启动与加载

| 症状 | 原因/处理 |
|---|---|
| `patch insert: entry %C not found` | bundle patch 试图插入到不存在的组；本 bundle 只做顶层 insert，出现此警告说明 profile 组合异常，检查 `dsh --dump-config` |
| 行一直 waiting（不激活） | 该行 `inject` 的 service 未挂载（storageDomain/subagents/tools/systemPrompt 必须存在） |
| `[agent-teams] storage: in-memory fallback` | storageDomain 未挂载；团队状态不持久。检查 profile 是否含 `@deepseek-ai/dsh-web-app`（或自备 storage-domain 行） |
| `SUBAGENT_UNAVAILABLE: the harness subagent runtime is not mounted` | subagents 服务缺失；teammate spawn 不可用（协调功能仍可用） |
| `SUBAGENT_CAPABILITY_UNSUPPORTED` | provider 不支持 `toolFilter`/`persona`/`maxDepth`；换 provider 或去掉该参数 —— 插件不会静默忽略 |

## 运行时行为

| 症状 | 原因/处理 |
|---|---|
| `TASK_ALREADY_CLAIMED` | 正常并发结果：另一个 agent 抢先认领。`claim_next` 会自动找下一条；显式 claim 应换任务 |
| `TASK_DEPENDENCIES_UNRESOLVED` | 依赖未完成；等依赖 completed（认领时实时校验） |
| `TEAM_NOT_COMPLETABLE`（带 reasons） | 完成守卫拒绝：required 任务未完成 / critical blocked / 缺 approved 计划 / critical-high findings 未处理。按 reasons 逐项处理 |
| `FILE_CLAIM_CONFLICT` | 与其他 owner 的模式重叠；`team_message_send` 与对方协调后由其释放再认领 |
| `UNAUTHORIZED_TEAM_ACCESS` | 该会话不是团队成员；成员经 `team_member_spawn`/`team_member_register` 加入 |
| teammate 完成第一个任务就「消失」 | 检查 spawn prompt 是否包含 TEAM PROTOCOL（`team_member_spawn` 自动注入）；确认模型遵循 `team_task_claim_next` 继续循环 |

## 消息投递

- lead → 成员：原生 `followup`（仅直系子代可投递；投递失败消息仍持久在 inbox，事件 `agent-teams/message-delivery-failed` 记录）
- 成员 → 成员：V1 只落 inbox，由 lead 在下一轮快照/消息中中转
- 成员 → lead：`reportFrom`（成员会话必须 live）

## 持久化与恢复

- 团队数据在 `agent_teams` domain（`$DSH_HOME/storages` 下 json backend）；重启后 `open()` 会校验并加载全部记录
- continuable teammate 由 Harness 原生 cold-resume 恢复：优先 `followup` 同一 childId（保留 session 身份与任务历史），不要为每个新任务 spawn 新成员
- stale 任务（owner 已不存在）：lead `team_task_release` / `team_task_reassign`；插件不会自动删任务

## 客户端面板

- 面板空白/无按钮：确认浏览器同源访问 `/agent-teams/teams`（JSON）；确认 webserver 行存在
- 静态模块 React 缺失：控制台 `[agent-teams] React runtime unavailable`，面板禁用（动态插件路径不受影响）
- 数据刷新频率 4s 轮询；面板只读（人工 steering 走 `/team` 命令或对话）

## 升级 Harness 后的适配

所有 Harness API 交互集中在 `src/harness/`：subagent 规格、domain 打开、事件桥、工具注册。接口变更时优先只改这四个文件；core 与工具层不直接触碰不稳定内部实现。
