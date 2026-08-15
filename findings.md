# dsh-agent-teams 研究发现

## 初始环境

- 工作区：`C:\知识库`
- 项目：`C:\知识库\dsh-agent-teams`
- Node：`v24.16.0`
- pnpm：`11.19.0`
- `dsh` CLI：当前 PATH 不可用

## 项目现状

- 包名：`dsh-agent-teams`
- 版本：`0.1.0`
- 构建：`tsc -p tsconfig.json && node scripts/build-client-module.mjs`
- 测试：`node tests/run-in-process.mjs && node tests/client-module-bundle.mjs`
- 包含 Cordis patch、Host/Storage/Tool 相关源码、client bundle 构建脚本、测试和文档。
- `package.json` 声明了 web client 注入依赖 `@deepseek-ai/dsh-client-runtime` 与 `@deepseek-ai/dsh-client-ui-sidebar`。

## 已读取的指导

- `browser-use`：可用于本地 Web 测试，但本轮优先按可用 Browser surface 的指引操作。
- `control-in-app-browser`：目标 URL 明确时使用目标 URL 选择浏览器，首次连接前必须读取完整 browser documentation。
- `planning-with-files`：多步任务使用项目目录中的 `task_plan.md`、`findings.md`、`progress.md`，每两次查看/搜索后保存关键发现。
- `e2e-testing`：使用稳定选择器、等待具体条件、保留截图/失败证据。
- `frontend-design`：UI 修复保持 Cute AI Engineering Studio 方向，同时尊重现有 Harness 设计 token。

## 待确认

- 当前 Harness Web 是否已启动并加载此插件。
- 现有 client bundle 是否在浏览器中完成 `dsh-agent-teams` 注册。
- UI 实际显示的是空态、错误态还是完整 Team Workspace。
- 现有 docs/VALIDATION.md 的记录是否与当前运行结果一致。

## 3080 Web 首次实测

- 目标 `http://127.0.0.1:3080/` 可访问，页面标题为 `DeepSeek Harness`。
- 页面先显示 `Loading plugins…`，约 2.5 秒后进入 `Failed to load plugins`。
- 真实错误：`client-modules: bundle /plugins/dsh-agent-teams/client.js?... loaded without registering "dsh-agent-teams" via __ModuleLoader__.load`。
- 浏览器 Console 同时报告：`SyntaxError: Cannot use import statement outside a module`，来源为 `/plugins/dsh-agent-teams/client.js`。
- 这直接命中硬验收门槛：当前 Web client bundle 不是可被 Harness loader 执行的 classic registration bundle，后续先定位 bundle 产物/构建链，不先改 UI。

## 基线命令（2026-08-14）

- `npm run typecheck`：PASS。
- `npm run build`：PASS，重新生成 `lib/client.js`（包含 `window.__ModuleLoader__.load({ id: "dsh-agent-teams", ... })` 的 classic bundle）。
- `npm test`：PASS，61 tests / 61 pass / 0 fail；包含 50 路并发认领、依赖 DAG、消息、计划、文件认领、持久化、20 任务无模型仿真、client logic 与 bundle registration。
- 首次 Web 失败由陈旧构建产物触发，当前尚未重新加载浏览器确认服务器已使用新产物。

## 3080 Web 回归 1

- 重新加载后 Harness 已正常进入主界面，不再显示 `Failed to load plugins`。
- 插件 bundle 已执行，但 Console 出现真实警告：`[agent-teams] React runtime unavailable; Command Center disabled`。
- 因此当前侧栏没有 `Agent Teams` 入口，UI 仍不可用。
- `src/client.ts` 的 `apply()` 依赖裸全局 `React`：若不存在则直接 return；`package.json` 当前 `dsh.client.inject` 只有 `@deepseek-ai/dsh-client-runtime` 与 `@deepseek-ai/dsh-client-ui-sidebar`，而 bundle 自身只声明 `inject = ['slots']`。
- 下一步必须检查 Harness 官方 client runtime 的注入/require 约定，确认 React 应从 `ctx`、`require` 还是显式 client module 注入，不能凭空把 React 挂到全局。

## React client bridge 修复

- 官方 `@deepseek-ai/dsh-client-ui-sidebar` bundle 明确使用 `require("react")`，并通过 `inject = ["slots", ...]` 获取服务；因此插件采用同一 loader factory 依赖方式。
- `scripts/build-client-module.mjs` 现在在 factory 内注入 `var React = require("react");`，使现有 client 组件引用解析到 Harness 提供的 React，而不是浏览器全局。
- `package.json` 增加 `react` peer dependency，声明该运行时契约。
- `tests/client-module-bundle.mjs` 现在断言 factory 精确请求 `react`，并仍验证 `dsh-agent-teams` 注册、无 ESM import/export 和 `apply/inject` 导出。
- 修复后 `npm run typecheck`、`npm run build`、`npm test` 全部 PASS（61/61）。

## 3080 Web 回归 2

- React 依赖桥接已生效：页面错误从“bundle 未注册/React unavailable”变为插件已注册但 apply 失败，说明 loader factory 已执行并拿到了 `react`。
- 新错误：`failed to apply loader entry ...: Cannot read properties of undefined (reading 'effect')`。
- 当前生成 bundle 的 `apply(ctx)` 在 `ctx.effect(...)` 处失败；需要继续对照 `dsh-client-modules` 的 apply/inject 调用契约，确认 client module 是否应导出 `apply` 的不同签名，或是否缺少官方要求的 client dependency inject。

## Harness loader contract

- 当前 Web shell 的 Cordis loader 代码实际执行 `ctx.registry.plugin(moduleExports, config)`，正常对象模块会由 Fiber 以 `runtime.callback(this.ctx, this.config)` 调用 `apply(ctx)`。
- 官方 sidebar bundle 也使用 `apply(ctx)` 与 `ctx.effect`，所以错误不是官方签名差异。
- 浏览器 evaluate 显示页面 realm 没有 `window.React`，但这不是问题本身，官方同样不依赖全局 React。
- 目前需要确认：当前自定义 bundle 的 `apply` 是否确实收到参数，以及是否有某个包装/导出形状导致参数丢失。下一步将做一次短期诊断日志，随后移除日志并修复根因。

## 根因定位：未绑定的 slots.register

- 临时诊断确认 `apply` 收到有效 context：`defined=true effect=function get=function slots=object slotInject=function`。
- 错误实际来自 callback 内部：代码把 `slots.register` 提取到 `const register` 后裸调用，丢失了 `this`；官方 SlotRegistry 的 `register()` 内部访问 `this.ctx.effect`，因此报 `Cannot read properties of undefined (reading 'effect')`。
- 修复方向：保持官方调用方式，直接以 `slots.register(...)` 方法调用，避免丢失服务实例上下文；同时移除临时诊断日志。

## 3080 Web 回归 3

- `slots.register` 上下文修复生效：不再出现 apply 阶段 `reading 'effect'`，插件已完成 apply 并进入侧栏渲染。
- 新的真实渲染错误：`cannot get property "timer" without inject`，来自 `timerOf(ctx)` 直接读取未声明的 `ctx.timer`；slot entry 随后崩溃，所以侧栏仍没有可用 Teams 按钮。
- 需要遵循 Cordis 依赖门控，声明 `timer` client inject，或使用 `ctx.get('timer')` 做可选读取；先确认当前 profile 是否已装载官方 timer service。

## 3080 Web 回归 4

- `timerOf(ctx)` 已改为 `ctx.get('timer')` 的可选读取，避免 Cordis 依赖门控报错；无 timer service 时才走本地 fallback。
- 重新 build/typecheck/test 后，3080 页面无新的当前错误，侧栏出现真实 `Teams` 按钮。
- 点击 `Teams` 成功打开 `Agent Teams Command Center`。
- 面板读取到真实持久化 team：`MINI NOTES TEAM`，状态 `ACTIVE`，`0% · 0 / 6 tasks`；展示真实任务图 `Architecture → Backend API / Frontend UI → Integration Test → Code Review → Final Fix`，不是静态假数据。
- 面板的 Timeline、过滤器、空成员态和 Activity Feed 均已渲染；当前没有成员，因此本轮还不能通过已有状态验证 Agent Inspector 的具体成员详情。

## Web 视觉检查

- 点击 `Timeline` 后按钮变为 `Feed`，说明切换状态正常。
- 点击 `TASKS` 后过滤按钮变为 active，说明 Activity Feed 筛选状态正常。
- 截图显示 Command Center DOM 已出现，但插件 CSS 没有生效：面板以未样式化的窄栏内容显示在左侧，而不是预期的全屏 Command Center。
- 可能原因：`src/client.ts` 只尝试 `styles.insert(CSS)`，但 static client factory 未提供 `styles` 全局，`ctx.get('styles')` 也未声明/未命中；需要对照 Harness 官方 CSS 注入方式，修复为正式 client module 可用的样式路径。

## 文档基线（2026-08-14）

- `docs/VALIDATION.md` 记录了先前在隔离 profile 上的完整验证：47/47 单测、并发认领、持久化、bundle install、Web route 和 client boot graph 均曾通过。
- 文档明确的 V1 边界：静态 UI 使用 4 秒 loopback 轮询；成员间原生 followup 受父权限限制，消息先落 inbox 再由 lead 中转；真实模型 spawn 因无凭据未实测。
- `README.md` 说明生产入口为 `src/index.ts`、`src/client.ts`，核心在 `src/core/`，Harness 适配在 `src/harness/`，测试主要由 `tests/run-in-process.mjs` 与 `tests/client-module-bundle.mjs` 驱动。
- 当前项目没有 `pnpm-workspace.yaml`，包内使用 `npm` 脚本；`package-lock.json` 存在。
- `src/` 下有大量核心单测与 client logic 单测；客户端构建由 `scripts/build-client-module.mjs` 负责。

## CSS fallback verification

- Added an official-style static `<style data-plugin-css="dsh-agent-teams/command-center">` fallback for the classic client bundle, with cleanup on disposal.
- After rebuilding and reloading `http://127.0.0.1:3080/`, the marker exists exactly once and `.agc-surface` computes as `position: fixed` with `top/right/bottom/left: 0` and width `1280px`.
- The screenshot now shows the full-screen Command Center surface with the header, graph, observe rail, filters, and task graph. The underlying Harness composer remains visible above it as a separate shell layer.
- The browser log query still includes errors from earlier reloads (the old timer-injection and stale ESM bundle failures); no new error was observed in the post-CSS state query.

## Independent QA Web recheck (2026-08-14)

- Fresh navigation to `http://127.0.0.1:3080/` reached `DeepSeek Harness`; body showed normal shell content and a real `Teams` sidebar button.
- The filtered browser console contained no current `dsh-agent-teams`, plugin-loader, or syntax errors.
- Opening Teams produced one `Agent Teams Command Center` region. It displayed the persisted `MINI NOTES TEAM`, `ACTIVE`, `0% · 0 / 6 tasks`, real task graph labels, observe filters, and the empty-member state.
- Computed surface state was `position: fixed`, four insets `0px`, width `1280px`; the CSS marker was present.
- This proves Harness boot/client/UI/route wiring, not real teammate/session formation: the current persisted team still has zero members.

### Real Lead attempt

- Submitted a real prompt through the Harness UI input, not a fixture or direct store mutation.
- The current Harness conversation became `QA Mini Notes Team Setup`; the model produced a real `team_create` tool call and reported Team ID `team_00000001_cf41a0ed`.
- The conversation showed `1 轮 · 1 步`, `LLM 10.3s`, and no browser errors. At this point only team creation is evidenced; no member/session/task-tool evidence is yet present.

### Real spawn evidence (while the same Lead run continued)

- The real Lead conversation later showed tool calls for all seven requested tasks, including dependency creation, followed by `team_member_spawn` calls.
- Confirmed in the real session trajectory: Architect `member_00000009_1f6cffb9`, session `7fdc7b7d-e7c3-4737-b869-82f791edc401`; Backend `member_0000000a_9b2f3e7a`, session `b6a7a705-bd44-4984-9899-f46e180142d3`; Frontend spawn call was visible. Tester and Reviewer spawn calls had started, but the Lead was still running when captured, so final member count/status awaits completion.
- The UI showed a live `停止生成` control and `1 轮 · 9 步`, proving this was an active real model/session trajectory rather than a static fixture.

### Team formation snapshot evidence

- After the Lead run completed, `GET /agent-teams/team/team_00000001_cf41a0ed/snapshot` returned HTTP 200 with `members=5`, `tasks=7`, `messages=2`, `fileClaims=1`, `plans=0`, `findings=0`.
- Real members and session IDs: architect `member_00000009_1f6cffb9` / `7fdc7b7d-e7c3-4737-b869-82f791edc401`; backend `member_0000000a_9b2f3e7a` / `b6a7a705-bd44-4984-9899-f46e180142d3`; frontend `member_0000000b_acc68c37` / `db79bcff-9dd7-49c8-97cc-5706587be159`; tester `member_0000000c_4ac214d9` / `1c6ac2a2-d9c0-4a29-9318-5f05d922d4a5`; reviewer `member_0000000d_abd911a0` / `60b93c94-73fb-42fa-8b32-1a4336279e9c`.
- Task snapshot showed T1 `in_progress`, T2/T3 pending on T1, T4 pending on T2+T3, T5 pending on T2+T3+T4, T6 pending on T5, T7 pending on T6. All five member records currently reported `idle`; only architect was associated with T1. This is formation evidence, not yet proof of autonomous task execution.

### Lead trajectory continued

- Reconnected to the same Harness conversation after a browser-kernel reset. The trajectory showed a real `subagent-report` context injection and the Lead was still actively processing the human QA steering prompt at `1 轮 · 14 步`; the visible reasoning noted that the reviewer teammate had already run and reported a claim failure for its blocked T6 task.
- This is direct evidence that at least one spawned child session produced a native report back into the Lead trajectory. Final task/status outcomes still require a completed run and REST snapshot.

### Architect execution evidence

- After restarting the Web server and refreshing the browser, REST returned Team `team_00000001_cf41a0ed` with 5 members, 7 tasks, 7 messages, and T1 `completed`; T2–T7 remained pending. All members were `idle` at that instant.
- The real teammate created `C:\知识库\mininotes\ARCHITECTURE.md` (5,444 bytes, timestamp 22:10:32). The document contains the Mini Notes stack, API contract, file layout, storage and frontend plan, confirming real work occurred in the assigned workspace rather than a simulated task result.

### Native message delivery evidence

- The persisted message log contains real cross-session messages, not only lead-created records: Frontend session `db79bcff-9dd7-49c8-97cc-5706587be159` sent a contract question directly to Architect session `7fdc7b7d-e7c3-4737-b869-82f791edc401`; Architect replied with the finalized API contract; Backend session `b6a7a705-bd44-4984-9899-f46e180142d3` sent its proposal to Architect; the Lead then sent a handoff to Backend.
- This establishes actual Agent→Agent delivery through member sessions/inboxes for at least Frontend→Architect and Architect→Lead-visible history. It does not yet establish Backend→Frontend specifically, nor a complete implementation/review cycle.

### Runtime interruption evidence

- During the human-steering continuation, the Harness trajectory recorded the Lead's T2 handoff call but displayed `失败`: “The tool call was interrupted after it was recorded, but no result was durably recorded. Its outcome is unknown.” Subsequent direct calls were also interrupted before start.
- The UI then reported “仅可从已完成轮次的最后一条消息分支”. This is a real session/turn continuity failure during active coordination; it prevented a clean, uninterrupted backend/frontend run and must lower live-session/persistence confidence.

## Code/security audit findings

- `src/core/service.ts` has clear service/store/runtime boundaries and typed guards for dependencies, claims, plans, completion, and actor identity.
- `src/harness/command-route.ts` exposes the entire public snapshot without actor authentication and implements all POST controls by taking the persisted team lead as the actor. Any caller that can reach the loopback server can send messages, approve/reject plans, interrupt/remove members, and pause/resume arbitrary teams. The loopback-only deployment assumption reduces exposure but is not an authentication boundary; Security is therefore PARTIAL.
- `src/tools/index.ts` does resolve tool identity from the executing Harness agent rather than model-provided session IDs; model-facing access control is materially stronger than the web control route.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `src/client.ts` selects `teams[0].id` and has no team selector. With both the old `Mini Notes Team` and real `QA Mini Notes` present, the workspace continued to show the old empty team, so the real five-member QA team could not be inspected in the plugin UI.
- The client CSS hardcodes black/white colors and has no light-theme branch; dark mode is observable, light-theme acceptance is not met by code evidence.
- The Harness conversation visibly rendered `Think` blocks containing internal planning text. This is in the host session viewer rather than the plugin's own feed, but the plugin's inspector opens that viewer; session privacy therefore remains unqualified and requires explicit review.

## UI responsive evidence

- At 1280×720 and 768×900, the surface remained fixed and the task graph text was present; at 390×844 there was no document-level horizontal overflow, but the fixed 341px observe rail left only ~49px for the main column.
- The mobile screenshot showed the Command Center and underlying Harness conversation/composer overlapping and the task graph/observe rail compressed into an unusable narrow layout. Responsive acceptance is therefore PARTIAL/FAIL, not PASS.
- The desktop UI has a clear dark visual language and readable graph/observe sections in the empty-team state; no light-theme mode was demonstrated.

## 当前不影响实现的命令差异

- `rtk` 的 `ls` 在 Windows PATH 下找不到 Unix `ls`，已改用 PowerShell 查询。
- PowerShell `Select-String -CaseSensitive:False` 写法报参数类型错误；后续使用默认大小写行为或显式 `-CaseSensitive:$false`。

### Final runtime continuation attempt

- A bounded second real Harness continuation was sent through the selected `QA Mini Notes Team Setup` conversation. The Lead used the real `team_snapshot` and `team_messages` tools first and correctly identified that the Lead→Backend handoff was already persisted, while the Frontend handoff was missing.
- The Lead then sent exactly one missing Frontend handoff. The UI remained in a live generation state, while a concurrent REST probe again received connection refused from `127.0.0.1:3080`. The run was stopped after the stall; this is a repeated active-runtime interruption, not a claimed success.
- After restarting the real Web process, the durable snapshot returned HTTP 200 with `members=5`, `tasks=7`, `messages=9`, `fileClaims=1`; T1 remained `completed`, T2–T7 remained `pending`. The newly persisted message `msg_00000001_0ed4364f` targets Frontend session `db79bcff-9dd7-49c8-97cc-5706587be159`, but the Frontend task was still not claimed or executed. This separates message persistence from successful child-session delivery/execution.
- Final REST snapshot evidence: `QA Mini Notes`, Team ID `team_00000001_cf41a0ed`; T1 `task_00000002_b6d31df3` completed by Architect session `7fdc7b7d-e7c3-4737-b869-82f791edc401`; T2 `task_00000003_90fc1c29`, T3 `task_00000004_a117d32b`, T4 `task_00000005_fa758cb2`, T5 `task_00000006_ae26aca1`, T6 `task_00000007_75b4f89b`, and T7 `task_00000008_db73e8b3` all pending.

### Final QA interpretation

- The implementation is not a fake fixture: real independent sessions were spawned, a real Architect session authored `mininotes/ARCHITECTURE.md`, the DAG and actor/session IDs are durable, and cross-session messages exist.
- The acceptance run did not reach persistent teammate Task B, real Backend/Frontend parallel implementation, real reviewer/fix/recheck, completion guard through a real `team_complete` attempt, or plugin Inspector/Live Session UI verification. Those items remain PARTIAL/FAIL rather than inferred from unit tests.
- The 3080 process was restarted for the final snapshot and left listening; startup output again showed storage, service, tools, event bridge, command, and web-route registration. The repeated mid-run disappearance of the listener remains an observed stability defect with root cause not isolated to plugin code versus host lifecycle.

## Remediation baseline inspection (2026-08-14)

- The core service already contains an atomic per-key `store.update` claim path and dependency/cycle checks. These paths are protected work: remediation must add guards around them without replacing their storage semantics.
- The current completion guard checks incomplete required tasks, critical blocked tasks, unapproved plans, and open critical/high findings, but its reason model is not yet explicit for every required failed/in-progress/blocked state. It also emits `TEAM_COMPLETED` in both `setTeamStatus` and `completeTeam`, which can duplicate the completion event.
- `TeamRuntimeAdapter.followup` only accepts a parent and child and the current Harness adapter hard-codes the relay source to the lead. `AgentTeamsService.sendMessage` only calls native followup when the persisted sender is the lead; member-to-member messages are therefore durable records without guaranteed native delivery.
- Durable schemas/types currently have no message delivery state, no file-claim member identity, and no finding responsible-member/evidence fields. File-claim ownership is represented only by a caller-supplied session string and requires a stronger service-level identity check.
- `requiresPlan` is not enforced at task claim/implementation completion: `claimTask` and `claimNextTask` can claim a plan-required task, while the hard completion check is only present in `completeTeam`. A service-level implementation/completion guard is required.
- The client still needs a privacy-safe session projection. Harness `isSurfaceEvent` alone does not remove reasoning blocks nested inside assistant messages; the adapter must filter typed reasoning/private blocks, not search visible text for words such as `Think`.

## Remediation source inspection — orchestration and UI

- `team_member_spawn` already calls native `startContinuable` and persists the returned child id, but the team protocol/tool path does not guarantee a post-completion self-claim loop. The service currently completes a task and immediately clears member task metadata; it does not schedule the next task.
- `sendMessage` persists every message before attempting delivery and only invokes native `followup` for lead-to-member sends. Member-to-member and member-to-lead sends therefore have no native delivery attempt; broadcast is also persistence-only.
- `claimFiles` checks string overlap but accepts `ownerSessionId` as the only identity field. The service calls `assertActor`, but durable claims cannot prove the owning member identity and the web route can invoke mutations as the persisted lead.
- `completeTask` has no `requiresPlan` approval check. `submitPlan` blocks a current task and approval/rejection releases it, but a claimed plan-required task can still be completed before approval.
- The client `CommandCenter` subscribes to one global SSE and polls, but has no reconnect/resnapshot path or connection state. `OverlayEntry` calls `teams[0].id`; there is no selected-team state or invalid-team route.
- `Inspector` calls the Harness native `sessions.open(sessionId)`, which is the host viewer that exposed Think/planning content in the previous acceptance. It is not a privacy-safe plugin session projection.

## Remediation source inspection — Harness client and web surface

- The official client runtime `ConversationSnapshot` exposes finalized `nodes`, `partial`, `runningCalls`, and `queue`; assistant blocks are typed as `text`, `reasoning`, and `tool-call`, while tool results are separate typed nodes. The new plugin adapter projects only public text/tool/result/report arms and drops reasoning by type.
- The official `ISessions.binding(id).session.getSnapshot()`/`subscribe()` surface is available to the client plugin, so the Inspector can stay bound to the actual `member.sessionId` without opening the host trajectory viewer.
- `@deepseek-ai/dsh-host-webserver` exposes only raw `node:http` request/response handlers and no built-in caller/auth service. The plugin therefore needs an explicit same-origin browser session plus CSRF capability for mutations, while resource ownership remains enforced in the service/route.

## Remediation results (2026-08-15)

- Typed privacy projection is implemented in `src/client/logic/session.ts`; it keeps public user/assistant text, tool calls/results, and explicit public reports, while dropping typed reasoning/private/unknown blocks. The corresponding tests pass. The host Harness conversation still renders host-owned Think blocks; the Agent Teams Inspector no longer delegates to that renderer.
- Selected Team routing is now hash-based (`#agent-team=<teamId>`); a real Tiny Notes Team remained selected after reload and no `teams[0]` fallback remains.
- Snapshot-first reconnect/reconciliation works in a controlled Web restart: the UI moved through `RECONNECTING…` and recovered `LIVE` state, selected Team, tasks, members, plans, messages, claims, and progress.
- Service/runtime changes preserve native child session identity, schedule same-session next-task claims, deliver member-to-member/broadcast messages with sender attribution and delivery state, enforce file conflicts, enforce `PLAN_NOT_APPROVED`, and reject incomplete Team completion.
- Real Tiny Notes evidence: Team `team_00000001_7831f216`; Architect session `dc406b4b-aeef-40de-b61f-b011b2733eed` completed T1 and self-claimed T2 during orchestration; Backend `5d61e650-559d-44e1-a0e2-a8decafb34af` delivered `msg_0000001k_a9fb8f80` to Frontend `027c59e7-b539-4b55-a066-ba7b257906ba`; real file claim `claim_0000000y_271b377c` produced `FILE_CLAIM_CONFLICT`; real T3 plan was rejected, revised, and approved; the UI human message `msg_0000001v_ea6c2b1c` delivered to Backend.
- The real Team ended with T2/T5 in progress, T6 pending, `findings=0`, and no Reviewer session. Repeated DeepSeek `Insufficient Balance` / `QUOTA` failures blocked further real Agent turns. Reviewer, live completion pair, and child public transcript/tool evidence remain unproven.
- Final sequential commands: `rtk npm run typecheck` PASS; `rtk npm test` PASS (73/73, 10 suites); `rtk npm run build` PASS (`lib/client.js` 80,225 bytes); `rtk node tests/client-module-bundle.mjs` PASS.

## Latest remediation regression (2026-08-15)

- Rebuilt the current source after adding the staged activation cap fix, plan-blocked member status synchronization, the implementation file-claim guard, and hash-change routing. `rtk npm run build` passed and generated `lib/client.js` at 80,225 bytes.
- `rtk npm test` then passed **73/73** across 10 suites; the new compiled tests cover staged member activation, `PLAN_NOT_APPROVED` before implementation file claims, native idle-state preservation, and hash-based Team routing.
- Restarted the real Harness on port 3080 (latest observed PID 68832). A clean browser tab had no new plugin logs; the real Team List contained three persisted teams, and selecting Tiny Notes routed to `#agent-team=team_00000001_7831f216` with the correct header, graph and member nodes.
- The real Backend Inspector after restart showed `97 public events · open`, paired typed tool-call/tool-result rows, and no reasoning row inside the scoped Inspector. The host conversation still shows host-owned Think blocks and remains a system-level caveat.
- Real completion POST after restart returned HTTP 400 with `code=TEAM_NOT_COMPLETABLE` and the persisted incomplete/in-progress/pending task IDs. Unauthenticated POST returned 401; a bogus stream cookie also returned 401.
- No further real Agent continuation was fabricated: the remaining Task B/Reviewer/final-completion gates are still blocked by the external DeepSeek `Insufficient Balance` / `QUOTA` condition.
