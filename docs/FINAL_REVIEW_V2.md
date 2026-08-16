# Final Integration Audit — Agent Teams V2

审计对象：`C:\知识库\dsh-agent-teams` 的 `integration/agent-teams-v2` 分支，HEAD `6d01bb3`。

审计角色：最终集成审计代理。审计期间未修改源码；只新增本报告并提交。未把未执行的真实 Harness、模型或浏览器结果写成 PASS。

## Executive verdict

**NOT QUALIFIED — CHANGES REQUIRED**

当前代码已经具备较可靠的内存/单进程协调底座，且核心单元测试真实通过；但仍不能称为可 Qualified 发布的长期 Agent Teams 实现。阻断原因不是动画或测试数量，而是生产边界上的真实性与一致性：运行时事件默认不具备跨进程原子性，成员间消息是 Lead-authority relay 而不是已证明的直接 peer channel，生产 Web route 没有接入真实 caller principal/RBAC，Workspace/Git V2 域没有接入生产 Service/tools，而且本次没有运行真实 Harness Agent/浏览器 UI/provider Session。

## Verification environment and commands

| 项目 | 实际结果 |
|---|---|
| OS | Windows NT 10.0.26200.0；系统名称查询被权限拒绝，但 OS version 已返回 |
| Node | `v24.16.0` |
| pnpm | `11.19.0` |
| Harness packages | `@deepseek-ai/*@0.1.0-rc.6`；`cordis@4.0.1` |
| Git branch | `integration/agent-teams-v2` |
| Git HEAD | `6d01bb3 feat: complete review and observability integration` |
| `rtk npm run typecheck` | **PASS**；退出码 0 |
| `rtk npm run build` | **PASS**；生成 `lib/client.js`，86550 bytes |
| `rtk npm test` | **PASS**；88 tests、13 suites，88 pass、0 fail；包含 client bundle 检查 |
| `rtk node --test lib/core/review.test.js lib/core/workspace.test.js lib/harness/git-workspace.test.js` | **PASS**；11/11 |
| `rtk node tests/client-module-bundle.mjs` | **PASS**；`client module bundle OK` |
| `rtk git diff --check` | **PASS** |

本次没有执行：真实 `http://127.0.0.1:3080` Harness boot、真实模型 spawn、真实 child Session A/B、真实 browser Inspector/UI、真实 provider delivery、真实 Tiny Notes Team。因此下文涉及这些项目均明确标为 PARTIAL 或 UNVERIFIED，不冒充真实运行 PASS。

## Required focus audit

### 1. `requiresPlan` Service hard guard — PARTIAL

已证明的部分：

- `src/core/service.ts:639-657` 的 `finishTask()` 在 `requiresPlan` task 没有 approved plan 时返回 `PLAN_NOT_APPROVED`。
- `src/core/service.ts:983-997` 的 `assertImplementationReady()` 被 `src/core/service.ts:1019-1028` 的 `claimFiles()` 调用，文件实现边界会阻止未批准计划。
- `src/core/plans.test.ts` 实际覆盖了 completion hard guard 和 file ownership hard guard；`npm test` 通过。

未达到完整 V2 invariant 的部分：没有一个统一的 Service-level implementation/write API 覆盖所有工作区写入路径；新增的 `WorkspaceManager` 也未接入生产 Service/tools（见第 4、7 节）。因此目前是“已暴露入口被硬拦截”，不是“所有实现路径都被统一硬拦截”。

### 2. `completeTeam` guard — PARTIAL

已证明的部分：`src/core/service.ts:233-278` 检查 required pending/in-progress/blocked/failed、未批准 plan、critical/high findings，并返回 `TEAM_NOT_COMPLETABLE`；`src/core/completion.test.ts` 和 `src/core/simulation.test.ts` 覆盖了提前完成拒绝，实际测试通过。`src/core/service.ts:145-156` 对同一进程内的 Team completion 使用队列。

阻断项：

- guard 的多记录检查与状态变更只由进程内队列保护，未形成跨进程 transaction/compare-and-swap invariant。
- Review/QA gate 只对已经存在的 required-task workspace 运行（`src/core/service.ts:261-275`）；required task 没有 workspace 记录时，不会因为缺少该 review workspace 而被阻止。

### 3. ReviewDomain → Service/tools 接线 — PASS（代码/专门测试）

- `src/index.ts:132-136` 实例化 `ReviewDomain` 并注入 `AgentTeamsService`。
- `src/core/service.ts:940-967` 提供 request/start/finding/resolve/submit/gate wrapper。
- `src/tools/index.ts:467-521` 注册 review request/start/finding/resolve/submit tools。
- `src/core/review.ts:209-521` 实现独立 reviewer、finding、fix/re-review、QA evidence 和 completion gate。
- 专门测试真实通过：review domain 5/5；连同 workspace/Git 专门测试合计 11/11。

限定：该 PASS 是 Service/Domain/tool 接线和状态机测试 PASS，不是 Reviewer 真实 Harness Session 的运行验收 PASS。

### 4. Persistent child lifecycle / `subagent/end` — PARTIAL

代码方向正确：

- `src/tools/index.ts:215-259` 使用 native `startContinuable`，并在 spawn 后以真实 `spawn.childId` 调用 `bindMemberSession()`。
- `src/harness/runtime.ts:40-70` 直接调用 `ctx.subagents.startContinuable()`。
- `src/harness/events-bridge.ts:72-82` 将普通 `subagent/end` 映射为 idle，不会把一个 continuable turn 自动当作永久 teammate disposal；error/aborted 才映射为 failed。
- `src/core/task.test.ts` 覆盖了自调度时 session identity 不变的 Service 级行为。

不能升级为 PASS 的原因：本次没有启动真实 Harness、没有记录真实 child `sessionId` 的 Task A → idle → Task B 证据，也没有验证当前 provider 的 continuable child 在真实事件流中的 `subagent/end` 语义。`docs/VALIDATION.md:47` 也明确写着真机 spawn 尚未执行。

### 5. Peer message delivery — PARTIAL

代码和测试证明了“调用 native followup/reportFrom，并保留 sender metadata”：

- `src/core/service.ts:740-800` 将消息持久化并记录 delivered/failed。
- `src/harness/runtime.ts:73-105` 使用 native `followup` / `reportFrom`。
- `src/core/messaging.test.ts` 的 member-to-member 测试实际验证了 `childId` 和 `senderSessionId`，npm test 通过。

关键限制：`src/core/service.ts:778-786` 和 `src/harness/runtime.ts:81-83` 明确是 Lead authority 调用 `subagents.followup(lead, childId, ..., source.form='relay')`。这不是已证明的 sender Session → recipient Session 原生直接 channel；也没有真实 Frontend Session 收到 Backend 消息的 Harness 证据。它不是 Lead 模型手工复制，但仍是 coordinator relay，因此 peer messaging 只能 PARTIAL。

### 6. File claim conflict — PARTIAL

Service 级冲突保护已通过：

- `src/core/service.ts:1019-1080` 对 exact file、directory、glob overlap 做检查，并通过 `withTeamMutation()` 串行化同一进程内 claim。
- `src/core/file-claims.test.ts` 的 exact、directory/file、glob、atomic batch conflict 测试通过。
- `src/core/workspace.ts:440-510` 另有带 team/member/session 绑定的 workspace lease 与 `FILE_CLAIM_CONFLICT`，专门测试通过。

生产集成缺口：

- `src/index.ts:132-138` 没有实例化或注入 `WorkspaceManager`。
- `src/tools/index.ts:526-539` 的生产 `team_file_claim` 仍调用 `AgentTeamsService.claimFiles()`，没有调用 `WorkspaceManager`。
- workspace lease 的 mutex 和 Service claim queue 都是 process-local；跨进程 writer 的全局冲突原子性未证明。

所以“当前 legacy Service 入口有真实冲突检测”是 PASS，但 V2 workspace/file ownership 生产 invariant 只能 PARTIAL。

### 7. Runtime event atomicity — FAIL for the V2 production invariant

`src/core/runtime-events.ts:1-12, 139-170` 明确声明默认 `TeamStore` 没有 atomic counter-plus-insert；实现只使用 process-local `teamLocks`。`RuntimeEventLog.capabilities` 在默认存储下是 `atomicAppend: false`、`crossProcessSafe: false`（`src/core/runtime-events.ts:143-151`），对应测试也明确断言该边界（`src/core/runtime-events.test.ts:82-95`）。

此外，`src/core/service.ts:90-116` 的 `emit()` 之后以 `void this.runtimeEvents.append(...)` 异步追加 audit event；它不是 mutation + durable event 的同一事务/outbox。单进程 fallback 测试通过，但多进程下可能 sequence/dedupe/写入顺序不一致，无法支撑“snapshot + event stream 长期恢复”的生产级 invariant。

### 8. Web caller auth / cross-Team authorization — PARTIAL

已证明的边界：

- `src/harness/command-route.ts:179-191` 要求 same-origin loopback、server-minted cookie 和 CSRF。
- `src/harness/command-route.ts:263-292` 支持可注入 `authorizeCaller` 和 team allowlist，并有 one-Team fallback binding。
- `src/harness/command-route.ts:386-393` 校验 interrupt target 属于 Team；`safeId()` 防止不安全资源 id。
- `src/harness/command-route.security.test.ts` 实际通过 5/5，包括无认证、跨 origin、跨 Team、body identity spoof、traversal/target 检查。

阻断项：`src/index.ts:189-198` 调用 `commandRoute()` 时只传入 interrupt，没有传入 `authorizeCaller`。因此实际生产路径使用的是插件自签发的 loopback browser cookie/CSRF capability，而不是 Harness 提供的 authenticated caller principal/RBAC。代码有 hook，但生产入口没有接线；这不能称为完整 Web caller authentication。

### 9. Inspector / session privacy — PASS（静态 projection contract）；真实 UI UNVERIFIED

- `src/client/logic/session.ts:82-147` 以结构化 node/block kind 投影 public session，只保留 user、assistant text、tool call/result 和显式 public report/context；reasoning/unknown/private blocks 被丢弃。
- 没有使用 `text.includes('Think')` 这种字符串 hack。
- `src/client.ts:523-658` Inspector 以成员真实 `member.sessionId` 绑定，并通过 `projectVisibleSession()` 展示内容；不再调用 host trajectory viewer。
- `src/client/logic/session.test.ts` 实际验证 visible assistant/tool 数据保留、typed reasoning/private context 丢弃；npm test 通过。

因此 C12 在 projection 单测中未复现，Client privacy contract 为 PASS。由于本次没有真实 Harness Session/UI browser 验证，不能声称集成 UI 已通过 C12。

### 10. Client registration — PASS（bundle contract）

- `lib/client.js:1-5` 以 `window.__ModuleLoader__.load({ id: "dsh-agent-teams", factory: ... })` 注册。
- `tests/client-module-bundle.mjs:10-39` 检查 loader call、id 和 factory 类型。
- 实际 `rtk node tests/client-module-bundle.mjs` 输出 `client module bundle OK`；`npm test` 也通过。

## Areas not claimed as verified

以下项目本次没有真实证据，必须保持未验证：

- Harness boot、插件 host/client 在 `127.0.0.1:3080` 的真实加载。
- 真实 Lead、Architect、Backend、Frontend、Tester、Reviewer Session。
- 真实 persistent Session ID 在两个连续任务之间保持不变。
- 真实 target Agent 收到 peer message、Human → Agent message、broadcast。
- 真实 parallel WORKING overlap、reviewer fix/re-review loop、Tiny Notes Team。
- 浏览器中的 Team Workspace、Task Graph、Activity Feed、动画、Inspector、tool result、auto-follow、refresh recovery、theme、mobile、reduced motion。
- provider interrupt 的实际支持/Unsupported UI。

## Critical-failure review

在已执行的代码/测试范围内，没有观察到 C1 duplicate exclusive ownership、C2 dependency-only prompt、C4 approval-before-completion、C5 legacy file conflict absent、C6 legacy completion guard bypass、C8 loader registration failure 或 C12 projection leak 的已证实复现。

但以下问题足以阻止 `QUALIFIED`：

1. Runtime event durable append 默认 `crossProcessSafe: false`，且不是 mutation-atomic outbox。
2. Agent-to-agent delivery 是 Lead-authority relay，未证明真实直接 peer Session delivery。
3. 实际 Web route 没有接入 authenticated caller principal/RBAC，只使用兼容 fallback capability。
4. Workspace/Git V2 ownership/review path 没有接入生产 Service/tools；仅 legacy file claim 入口可达。
5. 真实 Harness/provider/browser/UI 验收没有执行，不能把 source-level tests 当成集成验收。

## Final assessment by requested area

| 审计项 | 结论 |
|---|---|
| `requiresPlan` hard guard | **PARTIAL** |
| `completeTeam` guard | **PARTIAL** |
| ReviewDomain → Service/tools | **PASS**（代码/单测） |
| Persistent child lifecycle | **PARTIAL** |
| `subagent/end` continuable semantics | **PARTIAL** |
| Peer message delivery | **PARTIAL** |
| File claim conflict | **PARTIAL** |
| Runtime event atomicity | **FAIL**（V2 production invariant） |
| Web caller authentication | **PARTIAL** |
| Cross-Team authorization | **PASS**（route tests；production principal wiring incomplete） |
| Inspector session binding | **PASS**（source/unit；live UI unverified） |
| Session privacy projection | **PASS**（source/unit；live UI unverified） |
| Client registration | **PASS** |
| Typecheck/build/npm test | **PASS** |

## Required actions before a Qualified re-audit

1. 为 runtime events 提供真实 storage-level atomic append/outbox，并让 mutation/event/replay 使用同一 durable authority。
2. 明确并真实验证 peer delivery contract：若只能 relay，应把 relay 作为正式语义并证明 recipient Session receipt；若要求 direct peer，则接入 Harness 原生 direct capability。
3. 从当前 Harness Web/RPC caller context 接入 authenticated principal、Team authorization 和 target-session authorization，并在生产 `src/index.ts` 路径传入 hook。
4. 将 `WorkspaceManager`、Git workspace、file leases 和 review gate 接入实际 Service/tools；required task 缺少 workspace/review evidence 时必须阻止 completion。
5. 在 `http://127.0.0.1:3080` 运行真实低 token Team，保存 Team/member/task/session/message/review evidence，再进行 browser UI 和 reconnect/privacy re-audit。

## Commit scope

本次只允许的文件变更：`docs/FINAL_REVIEW_V2.md`。源码、测试和生成 bundle 均未在审计期间修改。
