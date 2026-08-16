# Harness Runtime Reliability Improvement Report

Date: 2026-08-16  
Baseline: HAT-FLASH-20260816-01, 63/100, NOT QUALIFIED  
Final judgment: **PARTIALLY IMPROVED**

## Executive result

The reliability work produced material improvement in the coordination layer and passed the complete local regression suite. The second real Harness dogfood run also proved several previously failed invariants with real DeepSeek V4 Flash child sessions: real provider/model separation, real persistent session reuse, self-claiming, plan rejection/revision/approval, native peer delivery, explicit assignment, and real file-claim conflict/handoff.

The run did not reach independent Reviewer, fix/re-review, Tester completion, or final `team_complete`. The Lead's next control turn was rejected by the real provider with `402 Insufficient Balance` / `QUOTA`; four Harness messages remained queued. Those stages are intentionally recorded as unverified, not PASS. The product is improved, but this evidence is not sufficient to call the release Qualified.

## Environment

| Item | Observed value |
|---|---|
| Harness | `@deepseek-ai/dsh 0.1.0-rc.6` |
| Harness commit | Not available in the installed profile |
| Agent Teams | `dsh-agent-teams@0.1.0` |
| Plugin path | `C:\知识库\dsh-agent-teams` |
| Node | `v24.16.0` |
| pnpm | `11.19.0` |
| OS | Windows 11 Home, build `10.0.26200.0` |
| Browser | Codex In-app Browser, `http://127.0.0.1:3080/` |
| Real worker model | DeepSeek V4 Flash, native runtime provider `spawn` |
| Working branch | `integration/runtime-reliability-v1` |
| Baseline source | `3a65756 acceptance-report-103-test-regression` |
| Change-set commit | `fix(agent-teams): harden runtime reliability` on the feature branch |

## Root cause and fix summary

### P0-1 — Provider/model separation

Root cause: the previous runtime treated `v4-flash` as a native subagent provider and created durable pending members before a real child existed.

Fix: `src/harness/provider-resolution.ts` resolves the model alias to `deepseek-v4-flash` while keeping native runtime provider `spawn` separate. `team_member_spawn` now starts the real continuable child first, then registers its returned real session id. Unknown runtime providers fail with a typed error and do not create a durable placeholder.

Validation: provider-resolution tests PASS. The real dogfood Team recorded four members with real session ids, `provider: spawn`, and `model: deepseek-v4-flash`; no `__pending_*` session was created.

### P0-2 — Persistent lifecycle and wake-up

Root cause: completion cleared the current task but did not reliably continue the same native child or wake an eligible worker.

Fix: lifecycle states, same-session `completeTaskAndSchedule`, `wakeWorker`/`followup`, readiness refresh, failure release, and task-state synchronization were added. Runtime failure releases owned in-flight work and clears terminal member task state.

Validation: service regressions PASS. In the real run, Frontend completed T3 and immediately self-claimed T5 on the same session `7be65a14-7829-48c3-a13a-b622b9e3616a`. Tester wake-up was requested while T4 was ready, but the following Lead turn hit provider quota before the Tester claimed it. End-to-end wake completion remains PARTIAL.

### P0-3 — Eligibility and explicit assignment

Root cause: claim routing was role-blind and allowed a worker with an active task to claim unrelated work.

Fix: task assignment fields, required capabilities, `TASK_NOT_ELIGIBLE`, readiness state, current-task checks, and role/member matching were added. Claims now distinguish unresolved dependencies from ineligible ownership.

Validation: reliability and atomic-claim tests PASS. The real run assigned T1/T2/T3/T4 to Architect/Backend/Frontend/Tester respectively; Backend and Frontend claimed only their assigned lanes, with no duplicate ownership.

### P0-4 — Bounded capability policy

Root cause: the previous runtime did not carry an auditable capability policy into members or enforce file-writing authority.

Fix: role-based bounded capability sets and `CAPABILITY_DECISION` events were added. File claims require `repo.write.owned`; the policy is bound to the durable member identity rather than model-supplied identity.

Validation: the real Architect received only `repo.read` and `review.verify`; its attempt to claim `docs/architecture.md` returned `CAPABILITY_DENIED`. The Lead correctly delegated persistence to Backend. Dynamic Reviewer execution was not reached because of quota.

### P0-5 — Pending-session message delivery

Root cause: message persistence was treated as delivery, and a pending child failure was terminal.

Fix: messages now record per-target delivery state, attempts, queue/retry transitions, and delivery events. `retryPendingMessages` retries queued targets after runtime status changes.

Validation: the queued-session regression passes with delivery on attempt 2. In the real Team, broadcast `msg_0000000w_39ccf3e5`, Frontend→Backend `msg_00000011_9e8decd1`, Backend→Frontend `msg_0000001f_bc3e14e1`, and subsequent Lead/worker messages were delivered through `native-followup` with real target session ids.

### P1 — Authoritative state and UI resilience

Fix: snapshots remain authoritative, event updates are incremental, and the client now rejects malformed Team-list responses instead of crashing on `teams.some`. A fresh Harness restart was followed by snapshot recovery and UI reload without a new Agent Teams exception.

## Automated validation

| Check | Result | Evidence |
|---|---|---|
| Typecheck | PASS | `rtk npm run typecheck` |
| Build | PASS | `rtk npm run build` |
| Tests | PASS | `109/109`, `20` suites, `0` failures |
| Client bundle | PASS | `client module bundle OK` |
| Dynamic host preflight | PASS | `47 tools`, routes, SSE and actions |
| Atomic claim regression | PASS | 50-way single-task, 50-way `claimNext`, 4-agent/20-task runs; zero duplicates |
| Dependency/cycle regression | PASS | unresolved dependency and cycle tests |
| Persistence regression | PASS | durable record round-trip and service recovery tests |
| Message retry regression | PASS | pending child → queued → delivered on retry |
| Provider/model regression | PASS | runtime `spawn` kept separate from `deepseek-v4-flash` |
| Privacy projection regression | PASS | public assistant/tool events retained; typed reasoning blocks removed |
| Security regression | PASS | auth/CSRF, cross-Team, traversal and impersonation probes |

## Real dogfood evidence

Team: `team_00000001_45752fca` — **P0 Reliability Dogfood**  
Lead session: `session-2294edb9-cfb9-4b53-8c8b-8adca8528942`

| Role | Member | Real session | Model/provider | Result |
|---|---|---|---|---|
| Architect | `member_0000000h_fdbaa0dc` | `ab9910a2-4483-4a08-87d2-6c8dcf6fc501` | V4 Flash / spawn | T1 completed |
| Backend | `member_0000000k_44d1b7f5` | `e0af835b-6f14-4ecc-a526-ee5add102cc9` | V4 Flash / spawn | T2 completed, then idle on same session |
| Frontend | `member_0000000n_3547d5f2` | `7be65a14-7829-48c3-a13a-b622b9e3616a` | V4 Flash / spawn | T3 completed; T5 self-claimed on same session |
| Tester | `member_0000000q_6a466b7a` | `32371bb1-9973-4679-81b4-c4cbf069e5cd` | V4 Flash / spawn | T4 ready but not claimed before quota stop |

Key task/plan evidence:

- T1 `task_00000003_71637f18`: plan `plan_00000013_baa6d706` rejected, same Architect resubmitted `plan_0000001o_8a97d926`, then Lead approved it and T1 completed.
- T2 `task_00000005_d9fede89`: Backend completed the real API and released/handoff-managed its claims.
- T3 `task_00000007_ba689d40`: Frontend completed the real demo.
- T5 `task_0000000b_a99a0c25`: Frontend self-claimed README work with the same session id as T3.
- T4 `task_00000009_9b3ae5fc`, Reviewer T6 `task_0000000d_ac4e25ad`, and final T7 `task_0000000f_2387b5ab` remained incomplete at quota stop.
- Shared-file conflict was real: Frontend received `FILE_CLAIM_CONFLICT` against Backend claim `claim_00000017_287a9cbf`; the subsequent release/handoff path completed.

## UI and session observations

After restarting Harness, the Team list contained five persisted Teams and selecting P0 Reliability Dogfood displayed the correct Team—not `teams[0]`. The workspace showed `ACTIVE`, `43% · 3 / 7 tasks`, real Agent Nodes, task graph, activity feed, and the correct current Frontend task.

The Frontend Inspector opened the persisted member session and showed `141 public events · open · reasoning hidden by typed visibility policy`, including public assistant output, typed tool calls, and tool results. No hidden Think/planning text appeared in the Agent Teams Inspector. The main Harness conversation still owns a separate host-level Think renderer; that is not emitted by this plugin Inspector.

## Restart/persistence evidence

After a real Harness process restart, `/agent-teams/teams` returned five Teams, including `team_00000001_45752fca`. Its snapshot retained the four members and their session ids, seven tasks, rejected and approved plans, 29 messages, two file claims, owners, and `43%` progress. The browser then rendered the selected Team and Inspector again without a new plugin exception.

## Remaining issues

1. **P0 release gate — real provider budget:** `402 Insufficient Balance`, `code: QUOTA` stopped the Lead before Tester, Reviewer, fix/re-review, final validation, and final `team_complete`. These paths remain unverified in this run.
2. **P0 wake-up evidence gap:** the service issued a real ready/wake path for Tester, but the Tester remained idle before the provider quota failure. A funded retry must specifically verify ready → claim → work without Lead copying the task.
3. **P1 dynamic bundle persistence boundary:** the static profile uses the durable Harness storage domain and passed restart recovery; the standalone dynamic preflight host still uses its isolated in-memory fallback. It must not be used as a production persistence path without a storage-domain injection.
4. **Dogfood Git workflow:** the real worker output left `server.js`, `lib/`, `shared/`, `public/`, and `docs/` as uncommitted changes in the dogfood repository; no worker branch or focused worker commit was observed before the quota stop. This is a real workflow finding, not a plugin invariant failure.

## Release judgment

**PARTIALLY IMPROVED.** The implementation is no longer the 63-point coordination shell: the local invariants are stronger and the real run demonstrated genuine child sessions, native delivery, plan governance, file conflict handling, persistent session reuse, and self-claiming. It is still not a Qualified release because the real Tester/Reviewer/fix/re-review/final-completion chain was stopped by provider quota, and the wake-up path needs one funded end-to-end confirmation.

## Capability Enforcement Addendum — 2026-08-17

The capability policy is now enforced at the Harness `tools/pre-execute`
boundary, not only stored as member metadata. `AgentTeamsService` classifies
repository, process, and Git tool calls, checks the calling real member's
durable capability set and owned file claims, emits auditable
`CAPABILITY_DECISION` events, and denies unapproved shell commands, shell file
mutation, protected Git actions, unclaimed writes, and Reviewer writes.

The focused feature branch `feature/runtime-capability-guard` was merged into
`integration/runtime-reliability-v1` as `28bac54`. New automated coverage
raises the local suite to **112/112 tests across 21 suites**, including owned
write allowed/unclaimed write denied, Reviewer verification allowed/mutation
denied, and shell/Git boundary denials.

The rebuilt live Harness was restarted on 2026-08-17; the Teams UI loaded with
no new plugin/module errors and the persisted P0 Team remained available. This
restart did not create a new funded child turn. The existing real Team still
has T4 pending, T5 in progress, Reviewer T6 pending, and final T7 pending; the
Lead continuation again returned `402 Insufficient Balance` / `QUOTA`. The
real Reviewer and final-completion gates therefore remain **NOT VERIFIED**.

Updated local gates after the merge: typecheck PASS, build PASS, 112/112 tests
PASS, client bundle PASS, dynamic host preflight PASS with 47 tools, and clean
worktree.

## Ready-worker reconciliation addendum — 2026-08-17

Root cause confirmed: scheduling was triggered only by a newly emitted
`task.ready` transition. A task that was already READY while a teammate
entered `idle`, or while the plugin was reloaded, could remain silently
available because no second event was guaranteed.

Fix: `AgentTeamsService` now reconciles ready work when a real member becomes
idle, after native child binding, after task creation/explicit assignment, and
at service startup. Wake requests keep a bounded attempt record, retry only
when the member is idle, and clear their timer/attempt state atomically when a
claim or delivery failure is observed. This preserves snapshot authority and
does not create a second member/session.

Validation: local ready-worker creation, idle retry, persisted-ready reload,
role routing, and atomic claim tests pass. The compiled suite is now **115/115
tests across 21 suites**. The rebuilt Harness restarted successfully and the
persisted P0 Team re-rendered without plugin errors. The real Tester remains
idle with T4 READY because the next provider turn is still blocked by the
recorded `402 Insufficient Balance` / `QUOTA`; end-to-end Tester claim remains
unverified rather than being reported as PASS.
