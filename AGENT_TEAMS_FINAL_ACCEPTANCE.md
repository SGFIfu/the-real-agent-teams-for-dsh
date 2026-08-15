# DeepSeek Harness Agent Teams — Final Acceptance

Date: 2026-08-15
Scope: remediation build, real Harness Web run, real Tiny Notes Team, service tests, UI inspection, security probes

## Executive Result

| Item | Result |
|---|---|
| Score | **84 / 100** |
| Rating | **PARTIALLY QUALIFIED** |
| UI Grade | **B** |
| Plugin-scope critical failures | **None observed** |
| C12 | **Fixed in the Agent Teams Inspector**; the host Harness conversation still renders host-owned Think blocks and remains a system-level caveat |

The remediation converted the previous first-Team/static-session problems into a real selected-Team workspace with typed service guards, native peer delivery, hard plan/file/completion controls, reconnect reconciliation, and privacy-safe Inspector projection. It is still not a Qualified release: the funded real provider run stopped on repeated `Insufficient Balance` / `QUOTA` failures before an independent Reviewer could run a finding/fix/re-review loop and before final validation could complete. The Inspector now binds the official child catalog address and displays real public assistant/tool events; the remaining release gates are persistent task closure, Reviewer, and final completion success.

## Environment Audit

| Item | Observed value |
|---|---|
| Harness version | `@deepseek-ai/dsh 0.1.0-rc.6` |
| Harness git commit | Not available; profile and project are not Git repositories |
| Plugin | `dsh-agent-teams@0.1.0` |
| Plugin path | `C:\知识库\dsh-agent-teams` |
| Node | `v24.16.0` |
| pnpm | `11.19.0` |
| OS | Windows 11 Home Chinese, NT `10.0.26200.0` |
| Model/provider | DeepSeek-V4-Pro / Max; V4-Flash retry also returned `Insufficient Balance` / `QUOTA` |
| Browser | Codex In-app Browser, `http://127.0.0.1:3080/` |

## Build Qualification

| Check | Result | Evidence |
|---|---|---|
| Install | **PASS** | `pnpm install --no-frozen-lockfile`; generated `pnpm-lock.yaml` |
| Typecheck | **PASS** | `rtk npm run typecheck`, exit 0 |
| Tests | **PASS** | `rtk npm test`: 73 passed, 0 failed, 10 suites |
| Build | **PASS** | `rtk npm run build`; `lib/client.js` 80,225 bytes |
| Client build/registration | **PASS** | `rtk node tests/client-module-bundle.mjs`: classic registration bundle OK |
| Lint | **NOT PRESENT** | no lint script in `package.json` |

## Harness Boot and Client Module

**HARNESS BOOT: PASS.** The live Web loaded the plugin, the Teams sidebar action rendered, and the Command Center mounted. The final browser reload showed no new plugin loader error; cumulative logs still contain historical pre-remediation ESM/connection errors and are not counted as current failures.

**CLIENT MODULE REGISTRATION: PASS.** The bundle test asserts `window.__ModuleLoader__.load`, id `dsh-agent-teams`, a function factory, and no top-level ESM import/export. The real page rendered the Teams entry and workspace.

## Real Team Evidence

Team: `team_00000001_7831f216` — `Tiny Notes 验收团队`
Snapshot at final probe: `members=4`, `tasks=6`, `messages=47`, `plans=4`, `fileClaims=5`, `findings=0`, status `active`.

| Role | Member ID | Session ID | Final observed status |
|---|---|---|---|
| Architect | `member_00000008_dfe2058c` | `dc406b4b-aeef-40de-b61f-b011b2733eed` | stopped; T1 completed |
| Backend | `member_00000009_d50b5c7b` | `5d61e650-559d-44e1-a0e2-a8decafb34af` | idle; T2 in progress |
| Frontend | `member_0000000a_7328eea8` | `027c59e7-b539-4b55-a066-ba7b257906ba` | idle; T3 completed |
| Tester | `member_0000000b_0e702742` | `5344ed61-32f5-4682-96a5-8bc31a3b8963` | stopped; T4 completed, T5 in progress |
| Reviewer | not created | not available | member cap/provider quota prevented activation |

Real artifacts include `C:\知识库\tiny-notes\docs\architecture.md`, `frontend/*`, `shared/types.ts`, and `tests/plan.md`. The real Team did not produce the backend server, full test report, or reviewer finding before quota exhaustion.

## Core Tests

| Invariant | Result | Evidence |
|---|---|---|
| Team formation | **PARTIAL** | 4 independent real teammate sessions; required Reviewer session was not created |
| Persistent teammates | **FAIL** | same-session T1→T2 self-claim was observed, but no same-session completed Task A→Task B was completed |
| Shared task board | **PASS** | real snapshot and 72-test suite agree on tasks, owners, dependencies and progress |
| Dependency enforcement | **PASS** | dependency and cycle tests; live blocked claims returned typed errors |
| Atomic claiming | **PASS** | 50-way one-task, 50-way claimNext, and 4-agent/20-task runs produced zero duplicate owners |
| Self claiming | **PARTIAL** | real Architect/Tester self-claim transitions plus simulation; live second-task closure stopped on quota |
| Parallel execution | **PASS** | real T2/T3 overlapping `in_progress` interval was recorded before later state changes |
| Peer messaging | **PASS** | native member→member, member→Lead, Lead→member and broadcast delivery; see message evidence below |
| File ownership | **PASS** | real `FILE_CLAIM_CONFLICT` on `tiny-notes/shared/types.ts`; release/handoff path exists and unit-tested |
| Plan lifecycle and hard guard | **PASS** | real reject→revise→approve; pre-approval `PLAN_NOT_APPROVED` returned by Service; implementation file claims are also gated |
| Block / unblock | **PARTIAL** | typed blocked event and service tests pass; full live Backend-completes→Tester-unblocks transition not finished |
| Reviewer workflow | **FAIL** | no real Reviewer finding, responsible fix, tests, and recheck |
| Completion guard | **PARTIAL** | real authenticated completion attempt returned HTTP 400 `TEAM_NOT_COMPLETABLE` with exact blocking task IDs; success after final validation was not reached |
| Persistence | **PASS** | Web restart and browser reload recovered Team, members, tasks, messages, plans, claims and progress |

### Core score: 49 / 60

## Peer Message Evidence

| Field | Evidence |
|---|---|
| Sender | Backend member `member_00000009_d50b5c7b`, session `5d61e650-559d-44e1-a0e2-a8decafb34af` |
| Recipient | Frontend member `member_0000000a_7328eea8`, session `027c59e7-b539-4b55-a066-ba7b257906ba` |
| Message | `msg_0000001k_a9fb8f80` |
| Delivery | `deliveryState=delivered`, `deliveryTransport=native-followup` |
| Reply | Frontend reply `msg_00000017_706564ea` was recorded; Frontend also reported the inbox evidence to Lead |

The UI human message `msg_0000001v_ea6c2b1c` (`Please verify the update endpoint edge case before finishing.`) also delivered to the real Backend session.

## UI Tests

| UI area | Result | Observation |
|---|---|---|
| Correct Team selection | **PASS** | hash `#agent-team=team_00000001_7831f216`; no first-Team fallback; invalid IDs show Team not found |
| Team Workspace | **PASS** | real name/status/progress/members/current tasks/blocked counters/graph/feed rendered |
| Agent nodes and real status | **PASS** | real Architect/Backend/Frontend/Tester nodes showed STOPPED/IDLE and current tasks from snapshot |
| Animated status | **PARTIAL** | transitions are event/diff driven; live child animation sequence was not observed to completion |
| Task Graph | **PASS** | real T1–T6 status/owner/dependency graph updated from selected snapshot |
| Message animation | **PARTIAL** | real delivery and retained activity event exist; flying animation was not observed in a reliable child run |
| Activity Feed | **PASS** | real joined/task-completed/message/plan/file-conflict activity was visible; no typing fixtures |
| Agent Inspector | **PASS** | real Backend member opens Activity/Messages/Tasks/Files and binds by member session identity |
| Live Session | **PASS** | catalog-derived official address plus `openSubagent()` produced `97 public events` with `open` state |
| Tool Activity | **PASS** | real Inspector showed paired typed calls/results for `team_task_get`, `team_message_send`, `read`, `glob`, and `pwsh` |
| Human Steering | **PASS** | UI message reached Backend with native delivery state |
| Refresh recovery | **PASS** | selected Team hash and durable state recovered; old transient animations did not replay |
| Light theme | **PASS** | real light Harness body produced readable surface/text variables (`#f6f8fa` / `#1f2328`) |
| Reduced motion | **PASS in code** | `prefers-reduced-motion` disables pulse/flying/decorative transitions; browser emulation was not separately automated |
| Mobile | **PARTIAL** | 390×844 showed Team header/list/graph/Inspector fullscreen; full DAG is intentionally compact and some density remains |
| Visual quality | **B** | clear, modern, cute direction; live-session observability and polish gaps prevent A |

### UI score: 27 / 30

## Privacy and Session Safety

The plugin no longer renders session data by searching for words such as `Think`. `projectVisibleSession` uses typed Harness block kinds and explicit public report context. The real Inspector showed `reasoning hidden by typed visibility policy`; hidden reasoning is not included in the projected activity/messages.

The host Harness conversation itself still displays host-owned Think blocks. The plugin does not modify Harness core and the repaired Agent Teams Inspector no longer delegates to that viewer. This distinction is recorded because the original C12 observation was system-level.

## Engineering Quality

| Area | Result | Notes |
|---|---|---|
| Persistence | **PASS** | durable store round-trip and real reload/restart recovery |
| Client module reliability | **PASS** | classic loader bundle and live registration |
| Automated tests | **PASS for core / PARTIAL for E2E coverage** | 73 tests; no full browser E2E or funded real-provider regression suite |
| Architecture | **GOOD** | Service, storage, runtime, tools, route and client logic boundaries are explicit |
| Security/error handling | **PARTIAL** | unauthenticated/CSRF/cross-Team/traversal/impersonation probes rejected; no full Harness caller-principal/role service |

### Engineering score: 8 / 10

## Automated Test Audit

Passing coverage includes atomic claim, dependency/cycle, direct messaging and broadcast, plan hard guard, file conflicts, persistence, completion guard, no-model simulation, UI state/DAG/SSE buffer logic, privacy projection, and client registration. The positive client regression test asserts the loader call/id/factory and would fail when those are absent.

Not covered sufficiently: browser E2E for the complete UI, funded real-provider Task A→B, live Backend↔Frontend work completion, live Reviewer fix loop, and final successful completion. Typed public child tool trajectory is now covered by the real Inspector run. Test quality is **PARTIAL** for the acceptance objective even though the command result is PASS.

## Security Sanity

Actual HTTP probes against the live Web rejected:

- unauthenticated mutation: `401 authenticated Harness browser session required`;
- missing/wrong CSRF: `401`;
- invalid Team: `400`;
- cross-Team target session: `400`;
- encoded traversal: `400`.

Model tools derive execution identity from Harness context, file claims bind Team/member/session, and no arbitrary shell endpoint was found. The remaining limitation is that the host Web API provides no user-principal/role service; the plugin’s same-origin cookie is a request capability, not an enterprise identity provider.

## Bugs

### P0 Critical

None observed in the repaired plugin invariants. C12 is fixed in the Agent Teams Inspector; the host-level Think rendering caveat is explicitly disclosed above.

### P1 High

1. A funded real-provider run is required: external `QUOTA` failures prevented Reviewer activation, persistent Task B completion, and final validation success.
2. Web capability authentication does not identify a Harness user principal or enforce role-based permissions.
3. The real Team remains active with T2/T5 in progress and T6 pending; final acceptance cannot be inferred from the successful rejection guard.

### P2 Medium

1. Real-time flying message/status animation could not be observed reliably during a completed peer-work transition.
2. No browser-level automated tests cover theme, mobile, reduced motion, refresh animation replay, or Inspector live updates.

### P3 Low

1. Browser console history retains errors from pre-remediation bundle revisions (`import` loader errors, old `teams.some` shape error, and intentional restart warnings). The final reload rendered the repaired workspace; these historical entries were not cleared by the Browser surface.

## Recommended Next Steps

1. Run the same Tiny Notes Team with funded provider balance and retain the Reviewer slot; complete persistent Task A→B, reviewer finding/fix/recheck, and final completion guard evidence.
2. Add a real browser E2E suite for selected Team routing, Inspector, reconnect, message animation, theme, mobile, reduced motion, and refresh semantics.
3. Integrate the plugin with an actual Harness caller principal/role authorization context instead of only a same-origin browser capability.
4. Keep the host-level Think redaction boundary explicit; if system-wide privacy is required, the change must be made in the Harness session renderer, outside this plugin.
5. Add a funded real-provider regression run to CI or a release checklist for Task A→B, Reviewer recheck, and completion success.

## Score

| Section | Score |
|---|---:|
| Core Agent Teams | 49 / 60 |
| UI / Observability | 27 / 30 |
| Engineering Quality | 8 / 10 |
| **Total** | **84 / 100** |

## Final Verdict

dsh-agent-teams is now a genuine coordination implementation with real Team state, independent sessions, atomic claims, dependency enforcement, native peer delivery, file conflicts, plan guards, persistence, and a selected-Team UI. The real Inspector now exposes the selected child’s typed public assistant/tool trajectory without hidden reasoning. It is still not a Qualified release because the real provider stopped before persistent work closure, Reviewer/fix/re-review, and final completion success; it remains **PARTIALLY QUALIFIED**, not a decorative multi-subagent shell.
