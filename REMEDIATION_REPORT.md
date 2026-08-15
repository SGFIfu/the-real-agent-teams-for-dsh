# Agent Teams Remediation Report

Previous Score

63 / 100 — NOT QUALIFIED

New Score

84 / 100 — PARTIALLY QUALIFIED

The remediation repaired the coordination invariants, Team Workspace routing, and real child-session Inspector binding. The live provider run was stopped by repeated `Insufficient Balance` / `QUOTA` failures before the Reviewer and final-validation stages. The score therefore does not claim a qualified release.

## C12 Privacy

Root Cause:

The Inspector previously opened the Harness host trajectory viewer, which rendered internal Think/planning content. The client adapter also did not have a typed public-event boundary.

Fix:

Added `src/client/logic/session.ts` with structural projection of typed Harness session nodes. It retains user-visible user/assistant text, tool calls, tool results, and explicitly public reports; typed reasoning/private/unknown blocks are discarded. The Inspector now uses the privacy-safe projection and binds to the selected member session instead of opening the host viewer.

Validation:

`npm test` passed the two privacy tests: visible assistant/tool data is retained and typed reasoning/private blocks are removed. The real Inspector displayed `LIVE SESSION · PRIVACY-SAFE VIEW` and `reasoning hidden by typed visibility policy`. The host Harness conversation still visibly contains host-owned Think blocks; that residual is outside this plugin’s renderer and is recorded as a system-level caveat, not hidden.

## Team Selection

Root Cause:

The production overlay implicitly selected `teams[0]`, so the real QA/Tiny Notes Team could be hidden behind an older persisted Team.

Fix:

Added explicit Team routing through `#agent-team=<teamId>`, a Team List, invalid-team `Team not found` handling, and selected-Team propagation through snapshots, tasks, messages, plans, claims, findings, graph, feed, and Inspector.

Validation:

The real Team `team_00000001_7831f216` was opened after another persisted Team existed. The URL retained `#agent-team=team_00000001_7831f216` across reload; the workspace showed `TINY NOTES 验收团队`, 4 real members, 6 real tasks, 47 messages, 4 plans, and 5 file claims. A clean-browser navigation to `#agent-team=team_missing` showed `Team not found: team_missing` without retaining Tiny Notes, then returned to the correct Team through the Team List. No production `teams[0]` fallback remains.

## Realtime Listener

Root Cause:

The previous client treated the event stream as the only source of truth and had no authoritative snapshot reconciliation after disconnect.

Fix:

The Workspace now fetches a snapshot first, subscribes to events from a stable Workspace owner, tracks connection state, retries after disconnect, and re-fetches/reconciles the complete Team snapshot before resubscribing. Historical events are not replayed as new animations.

Validation:

During a controlled Harness restart the UI showed `RECONNECTING…`, then `LIVE`; the selected Team, task graph, members, messages, plans, claims, and progress returned from the snapshot. This passes state recovery. Repeated provider-run listener loss remains a P1 runtime-stability observation, because the external Harness process also became unavailable while the real Lead was running.

## Persistent Teammates

Root Cause:

Task completion cleared the member’s current task without scheduling a same-session check-in/self-claim loop. The prior live run did not prove Task A→Task B on one child session.

Fix:

Added `completeTaskAndSchedule`, persistent teammate protocol text, and same-session self-claim scheduling. The runtime keeps the native continuable child identity until explicit stop, replacement, or fatal failure.

Validation:

The service test passed same-session completion plus next-task self-claim. In the real Tiny Notes run, Architect session `dc406b4b-aeef-40de-b61f-b011b2733eed` completed T1 `task_00000002_e25e1a8e` and a same-session T2 self-claim was observed during orchestration. T2 was later reassigned to Backend and was not completed on the Architect session before the provider quota failure. End-to-end persistent Task A→completed→Task B is therefore **PARTIAL**, not claimed as PASS. A new `TASK_REOPEN_NOT_ALLOWED` guard prevents completed dependencies from being reopened behind downstream work.

## Self Claim

Root Cause:

The prompt protocol did not reliably instruct a persistent worker to check its inbox and claim the next available task after reporting completion.

Fix:

The service now completes and schedules the next available task atomically for the same member/session; prompts explicitly require report → inbox check → `claimNextTask()` → continue or idle.

Validation:

The compiled suite passed the 4-agent/20-task self-scheduling test with zero duplicate owners. Real Architect and Tester self-claim transitions were observed in the Tiny Notes message log, but the real provider stopped before a full two-agent completed Task A→Task B chain. Core implementation is PASS; live acceptance evidence is PARTIAL.

## Peer Messaging

Root Cause:

Member-to-member records were previously persisted without a native delivery attempt; followup attribution was hard-coded to the Lead.

Fix:

`AgentTeamsService.sendMessage` now validates the Team/member/session relationship, calls the native Harness delivery path, records `deliveryState`, `deliveryTransport`, `deliveredAt`, and emits delivery failure events. `runtime.followup` preserves the actual sender session metadata while using the authorized parent capability.

Validation:

The messaging suite passed member→member, lead→member, member→lead, broadcast, isolation, and sender-attribution tests. Real evidence includes Backend session `5d61e650-559d-44e1-a0e2-a8decafb34af` → Frontend session `027c59e7-b539-4b55-a066-ba7b257906ba`, `msg_0000001k_a9fb8f80`, `deliveryState=delivered`, `deliveryTransport=native-followup`, followed by a Frontend reply; the UI human message `msg_0000001v_ea6c2b1c` also delivered through native followup. Peer delivery is PASS.

## File Ownership

Root Cause:

File claims did not persist owning member identity strongly enough and live conflict behavior had not been proven.

Fix:

Claims now include `ownerMemberId`, bind ownership to Team/member/session, and use exact path, directory, and glob overlap checks atomically.

Validation:

Real Architect claim `claim_0000000y_271b377c` held `tiny-notes/shared/types.ts`. Backend’s real claim attempt returned `FILE_CLAIM_CONFLICT` naming the conflicting claim and Architect session `dc406b4b-aeef-40de-b61f-b011b2733eed`. The file-claim suite passed exact, directory, glob, and atomic-batch tests.

## Plan Approval

Root Cause:

`requiresPlan` was previously a prompt convention; completion could proceed before an approved plan.

Fix:

`finishTask` now enforces `PLAN_NOT_APPROVED` at the Service layer. Plan submission, rejection, revision, and approval remain durable and unblock only after approval.

Validation:

Real T3 plan `plan_0000000e_b8d63238` was rejected; Architect resubmitted `plan_0000000t_7d67c765`, which was approved. Real pre-approval completion returned `PLAN_NOT_APPROVED` with `approvedPlan:false`. T2 repeated the same hard-guard evidence with `plan_0000000v_64da1680`.

## Reviewer

Root Cause:

The live Team reached the implementation/integration boundary without a completed independent Reviewer/finding/fix/recheck loop.

Fix:

Finding records now carry severity, title, description, evidence, task ID, responsible member, and status; critical/high open findings block completion. The service and simulation exercise finding resolution.

Validation:

The no-model 20-task simulation and reviewer-related service guards pass, but the real Tiny Notes Team has `findings=0`, Reviewer was not activated because the provider/member-cap/quota path failed, and T6 remains pending. Reviewer Loop is **FAIL for live acceptance**.

## Completion Guard

Root Cause:

Team completion did not comprehensively reject required pending/in-progress/blocked/failed tasks, unapproved plans, and open high-severity findings.

Fix:

`AgentTeamsService.completeTeam()` now returns typed `TEAM_NOT_COMPLETABLE` details for every blocking category and only emits completion after all required validation gates pass.

Validation:

Completion-guard unit tests and the full no-model simulation pass. The new authenticated route `/agent-teams/team/:teamId/complete` was invoked against the real Tiny Notes Team and returned HTTP 400 with `code=TEAM_NOT_COMPLETABLE`, including incomplete/in-progress/pending task IDs. The final successful completion after T6 remains unexecuted because the external model quota failure stopped the Team. Service invariant and real rejection are PASS; live workflow evidence remains PARTIAL.

## Security

Root Cause:

Web mutations previously lacked a caller capability and relied on persisted Lead identity. Route IDs were also not uniformly path-safe.

Fix:

Added same-origin browser session plus CSRF capability checks for POST/SSE control routes, strict decoded-ID/path validation, Team membership checks, target-session ownership checks, and service-level actor/session validation. Model tools derive execution identity from Harness context rather than trusting model-supplied IDs.

Validation:

Real HTTP probes rejected unauthenticated writes (401), missing/wrong CSRF (401), invalid Team (400), cross-Team target (400), and encoded traversal (400). Service tests cover non-member access, impersonation, cross-Team mutation, and file-claim ownership. This is request-level authentication and resource authorization; a full Harness user-principal/role service is not exposed by the current host Web API, so Security is scored PARTIAL at product level.

## Agent Inspector

Root Cause:

Inspector routing used the wrong Team and host trajectory surface instead of the selected member’s real session binding.

Fix:

Inspector now resolves the selected member by `member.sessionId`, refreshes the Lead’s subagent binding when needed, projects typed public events, and provides Activity/Messages/Tasks/Files tabs, human messaging, interrupt confirmation, follow/latest behavior, and reconnect-aware state.

Validation:

Clicking real Backend member `member_00000009_d50b5c7b` opened the Backend inspector with T2, dependencies, messages, tasks, and files from the Tiny Notes Team. The catalog contained the real child row but no retained address; the client now derives the official `{parentSessionId, childSessionId, mode}` address and calls `openSubagent()`. The Inspector then showed `97 public events · open`, including assistant rows and paired tool calls/results, while typed reasoning remained absent. The Human message was sent to the real Backend session and persisted as delivered.

## UI

Root Cause:

The UI had first-Team selection, no authoritative reconnect path, hard-coded dark colors, a fixed desktop rail, and event/Inspector surfaces that were not bound to real selected members.

Fix:

Implemented selected-Team Workspace routing, real status/task graph/activity/message updates, event-driven message/status animations, privacy-safe Inspector, Light/Dark token branches, mobile drawer/fullscreen Inspector layout, and reduced-motion CSS behavior.

Validation:

Desktop and mobile viewport checks showed the real Tiny Notes Team, four live member nodes, task graph, activity feed, and fullscreen Inspector. Light computed surface variables were readable (`#f6f8fa` / `#1f2328`). Reduced-motion CSS disables decorative pulse/flying transitions. Message delivery and feed records are real; the flying animation was not observed in a reliable real-time child run. UI grade is B.

## Final compiled regression

Root Cause:

The first remediation report was written before the latest service guards were compiled into `lib/`.

Fix:

Rebuilt the package after adding staged member activation, plan-state synchronization, and the implementation file-claim guard.

Validation:

`rtk npm run build` passed and `rtk npm test` passed with **73/73 tests** across 10 suites. The current classic client bundle is 80,225 bytes. A clean browser tab loaded it with no new plugin errors; `#agent-team=team_missing` rendered `Team not found` without retaining Tiny Notes, and returning to the Team List selected the real Tiny Notes Team at `#agent-team=team_00000001_7831f216`. After a real Harness restart, the Backend Inspector still showed `97 public events · open`, typed tool calls/results, and no reasoning rows. The live completion route still rejected the incomplete Team with HTTP 400 `TEAM_NOT_COMPLETABLE` and typed task details. The latest compiled regression also proves native idle events do not erase an owned task's working/blocked semantic status.

## Release Decision

The repaired code is materially stronger than the 63/100 baseline and all protected core regression tests pass. It is not yet a Qualified release because real provider quota prevented Reviewer/fix/re-review and final completion success evidence. Live public child-session events and tool activity are now proven; no PASS is awarded for the remaining missing Reviewer/persistent-closure gates.
