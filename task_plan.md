# dsh-agent-teams Web 验收与修复计划

## 目标

在现有 `dsh-agent-teams` 实现基础上，使用本地 DeepSeek Harness Web (`http://127.0.0.1:3080`) 做真实验证，修复发现的阻塞问题，并以实际命令和浏览器证据更新验收状态。保留已有实现，避免无依据重写。

## 阶段

- [completed] 1. 基线盘点：读取现有文档、源码结构、依赖和验证记录
- [completed] 2. 运行基线：typecheck、build、unit/in-process、client bundle 测试
- [completed] 3. Harness 适配：确认插件加载、服务/API、client module 注册
- [completed] 4. Web 验收：打开 `http://127.0.0.1:3080`，检查 Console、页面、交互和截图
- [completed] 5. 修复与回归：针对真实失败做最小改动并重跑相关验证
- [completed] 6. 收尾：更新 `docs/VALIDATION.md` 与进度记录，明确 PASS/PARTIAL/FAIL 边界

## 交付物

- 通过或明确记录失败原因的构建、类型检查和测试结果
- 本地 Web UI 的真实加载/交互证据
- 必要的源码修复与回归测试
- 更新后的验证文档和可复现运行方式

## 约束与风险

- 只使用当前 Harness 真实 API，不凭 Prompt 猜测接口。
- UI 必须读取真实 team/session/event 数据，不能用生产假数据。
- 不修改 Harness 核心，除非证据表明插件无法绕开真实核心缺陷。
- Client bundle 的 module registration 是硬门槛。
- `dsh` CLI 不在 PATH，需通过现有 Harness Web、项目脚本或本地安装路径验证。

## 错误记录

| 错误 | 尝试 | 处理 |
|---|---:|---|
| `rtk ls` 在 Windows 找不到 `ls` | 1 | 改用 `rtk proxy powershell` 执行 PowerShell 查询 |
| `dsh --version` / `dsh --help` 找不到命令 | 1 | 记录为环境事实，继续使用 Web 与项目脚本定位 Harness |
| `dsh-agent-teams` 子目录不是 Git 仓库 | 1 | 暂不假设 Git 根位置，先按文件与脚本验证 |

## 决策日志

- 采用现有实现优先：仓库已有 `src/`、`tests/`、`lib/`、`dist/`、`docs/VALIDATION.md`。
- 浏览器验证使用可用的本地 Browser surface，先读取其完整操作说明再连接目标 URL。
- 当前结果：核心、bundle、API 和 Web UI 验收 PASS；真实模型 spawn 仍按已有环境限制记录为未执行（无模型凭据）。

## Independent QA acceptance (2026-08-14)

- [completed] A. Environment and build qualification
- [completed] B. Harness boot and client loader qualification
- [completed] C. Real Runtime/team/task/message/persistence evidence (with partial/failed invariants recorded)
- [completed] D. UI/observability/theme/responsive evidence (with partial/failed UI items recorded)
- [completed] E. Security, architecture, automated-test audit
- [completed] F. Write `AGENT_TEAMS_FINAL_ACCEPTANCE.md` and final verdict

### QA constraints

- Do not modify plugin source code during this acceptance.
- Do not convert fixtures, simulations, or API-contract tests into real-agent evidence.
- Record unavailable provider/session evidence as PARTIAL or BLOCKED; never infer PASS.

### A evidence

- `npm run typecheck`: PASS.
- `npm run build`: PASS; generated `lib/client.js` (59,723 bytes).
- `npm test`: PASS; 61/61 tests, 9 suites.
- Package scripts contain no lint command; lint is NOT RUN (not silently treated as PASS).
- Browser setup probe used the valid navigation path but called a non-existent `tab.playwright.title()` helper; no page state was changed beyond navigation. Subsequent checks use `tab.playwright.evaluate(() => document.title)`.
- First real-run send probe filled the prompt but called an unsupported `Locator.isDisabled()` helper before clicking; it did not send the message. The send state is rechecked through DOM evaluation.
- Browser `evaluate` does not expose `fetch` in this Browser surface; API verification uses the previously successful PowerShell `Invoke-WebRequest` path instead.
- Follow-up attempt on the selected QA conversation could not find the initial empty-session textbox label; no follow-up was sent. The selected conversation likely uses a different input accessible name, so the next probe inspects the current DOM before retrying.
- A 120-second Browser poll timed out while the real Lead run remained active; the node-repl kernel reset. This is a test-harness timeout, not evidence that the Harness run failed. Reconnect with a fresh browser handle and use bounded status snapshots instead of another long poll.
- During the active real run, a fresh PowerShell request to `/agent-teams/.../snapshot` failed with connection refused, so the Web server was temporarily unavailable. This is recorded as a runtime/restart observation; root reachability is checked once through a different read-only probe.
- First diagnostic restart command used `New-TemporaryFile`, which is unavailable in this PowerShell environment; no process was started and no project file changed. The retry uses explicit paths under the OS temp directory.
- Workspace interaction retry found the underlying Harness Session log layer on top of the Command Center (`elementFromPoint` at Timeline returned the Session log span). Clicking the underlying `关闭详情` control then failed because its hit point was outside the current viewport; this confirms a layering/coordinate blocker rather than silently claiming the interaction passed.

### QA errors

- First environment command batch had PowerShell variable expansion from the outer shell, turning `$p` into `.name`; no project state changed. Re-ran the probes with single-quoted `-Command` bodies.

## Remediation and re-qualification (2026-08-15)

- [completed] R1. Read the prior 63/100 acceptance, pasted attachment, available skills/agents, and current Harness APIs.
- [completed] R2. Repair typed session privacy projection before UI polish; add regression tests for visible assistant/tool data versus reasoning/private blocks.
- [completed] R3. Remove implicit first-Team routing; implement selected-Team hash routing, Team List, invalid-Team state, and selected snapshot propagation.
- [completed] R4. Make snapshot authoritative over the event stream; add reconnect/re-fetch/reconcile behavior and stable Workspace subscription ownership.
- [completed] R5. Add same-session task completion/self-claim scheduling and persistent teammate protocol.
- [completed] R6. Add native member-to-member/broadcast delivery, sender attribution, delivery state, file conflict identity, plan hard guard, completion guard, and Web request protections.
- [completed] R7. Repair Inspector privacy/session routing, responsive layout, theme variables, activity/task/message rendering, human steering, and interrupt confirmation.
- [completed] R8. Run final sequential typecheck, 73-test suite, build, and client-loader regression.
- [completed] R9. Run real Harness Web and real Tiny Notes Team re-acceptance with actual member/session/message/plan/file evidence.
- [completed] R10. Write `REMEDIATION_REPORT.md`, `AGENT_TEAMS_FINAL_ACCEPTANCE.md`, and root `VALIDATION.md`.

### Remediation decision

The repaired plugin scores 84/100, UI Grade B, PARTIALLY QUALIFIED. Core service invariants and real peer/file/plan evidence are materially improved, and the selected child Inspector now exposes 97 typed public events with real tool calls/results. The real provider returned repeated `Insufficient Balance` / `QUOTA` errors before persistent Task B closure, Reviewer/fix/re-review, and final completion. These are recorded as FAIL/PARTIAL; no qualification is inferred from simulation or unit tests.

### Latest compiled regression (2026-08-15)

- Rebuilt `lib/` after the staged-member-cap, plan-state synchronization, and implementation file-claim guard changes.
- `rtk npm test`: **73/73 passed**, 10 suites; atomic claim, dependencies, persistence, simulation, privacy, and client loader remain green.
- Restarted the real Harness on port 3080; a clean browser tab loaded the current Client Module with no new plugin errors.
- Selected `team_00000001_7831f216` from the real Team List; hash routing and Tiny Notes Workspace/graph/feed rendered after reload.
- Real Backend Inspector remained `97 public events · open`, with typed assistant/tool-call/tool-result rows and no reasoning rows.
- Completion endpoint continued to reject incomplete live Team with `TEAM_NOT_COMPLETABLE` and task IDs.
- Native idle-event regression keeps an owned member `working/blocked` until its task is released/completed; reassign/block paths also emit synchronized member status events.
- Hash-change regression clears stale Team state: invalid `team_missing` displays `Team not found`, and selecting Tiny Notes afterward restores the correct hash/workspace.
