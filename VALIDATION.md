# dsh-agent-teams Validation

## Environment

| Item | Actual value |
|---|---|
| Harness | `@deepseek-ai/dsh 0.1.0-rc.6` (`D:\node.exe C:\Users\荣耀\.dsh\profiles\node_modules\@deepseek-ai\dsh\lib\bin.js --version`) |
| Harness git commit | Not available; profile and plugin directory are not Git repositories |
| Agent Teams version | `0.1.0` |
| Plugin path | `C:\知识库\dsh-agent-teams` |
| Current source commit | `b951e26 workspace-service-integration` |
| Node | `v24.16.0` |
| pnpm | `11.19.0` |
| OS | Windows 11 Home Chinese, NT `10.0.26200.0` |
| Model/provider | DeepSeek-V4-Pro / Max in the real run; a V4-Flash retry also failed with `Insufficient Balance` / `QUOTA` |
| Browser | Codex In-app Browser, `http://127.0.0.1:3080/` |

## Build and package commands

| Check | Result | Evidence |
|---|---|---|
| Install | PASS | `pnpm install --no-frozen-lockfile` completed and generated `pnpm-lock.yaml`; the initial frozen attempt correctly failed because no lockfile existed yet |
| Typecheck | PASS | `rtk npm run typecheck`; `tsc -p tsconfig.json --noEmit`, exit 0 |
| Build | PASS | `rtk npm run build`; generated `lib/client.js` (86,550 bytes) |
| Tests | PASS | `rtk npm test`; 103 passed, 0 failed, 17 suites |
| Client bundle | PASS | `rtk node tests/client-module-bundle.mjs`; `client module bundle OK` |
| Lint | NOT PRESENT | `package.json` has no lint script |

## Required validation matrix

| Area | Result | Evidence |
|---|---|---|
| Atomic concurrency | PASS | 50-way single-task claim, 50-way `claimNext`, and 4-agent/20-task self-scheduling all passed with zero duplicate owners |
| Shared task board | PASS | real Team snapshot has one durable task/dependency/owner view; simulation and UI logic tests pass |
| Dependency enforcement | PASS | dependency/cycle suite; real blocked claims return typed dependency errors |
| Persistence | PASS | storage round-trip tests plus real Web restart/reload recovery of Team, members, tasks, messages, plans and claims |
| Client Registration | PASS | bundle asserts `__ModuleLoader__.load`, id `dsh-agent-teams`, factory function, classic script; live Teams button rendered |
| Session Privacy | PASS in plugin Inspector | typed `projectVisibleSession` tests retain public assistant/tool data and remove typed reasoning/private blocks; Inspector shows privacy-safe view. Host conversation Think blocks remain a host-level caveat |
| Persistent Teammates | FAIL for live end-to-end acceptance | same-session self-claim and service tests pass, but no same-session completed Task A→Task B was completed before quota failure |
| Peer Messaging | PASS | real Backend→Frontend `msg_0000001k_a9fb8f80` delivered via `native-followup`; Frontend reply and UI human message `msg_0000001v_ea6c2b1c` delivered |
| Self Claim | PASS for mechanism / PARTIAL live closure | Architect and Tester real self-claim transitions observed; provider stopped before a full completed second-task chain |
| Plan Guard | PASS | real T3/T2 reject→revise→approve; preapproval `PLAN_NOT_APPROVED` returned by Service; unapproved implementation file claims are rejected too |
| File Claims | PASS | real `claim_0000000y_271b377c` conflict on `tiny-notes/shared/types.ts` returned `FILE_CLAIM_CONFLICT` |
| Workspace/Git production path | PASS for code/test integration | `WorkspaceManager` is now mounted by the production Service; `team_file_claim` can bind claims to a workspace lease; workspace lease and fixed-argv Git suites pass |
| Reviewer | FAIL | real Team `findings=0`, Reviewer not activated, T6 pending; no finding/fix/re-review loop |
| Completion Guard | PASS for rejection / PARTIAL for final success | authenticated real POST to `/agent-teams/team/team_00000001_7831f216/complete` returned HTTP 400, `code=TEAM_NOT_COMPLETABLE`, with incomplete/in-progress/pending task IDs; success after final validation remains unexecuted |
| Security | PARTIAL | unauthenticated/CSRF/cross-Team/traversal/impersonation probes rejected; no host user-principal/role auth service exists |
| Simulation | PASS | no-model 20-task Team simulation completed with dependency, self-claim, messaging, plan, conflict, review and completion invariants |
| Real Tiny Notes Team | PARTIAL | Team `team_00000001_7831f216`, 4 real members, 6 tasks, 47 messages, 4 plans, 5 claims; T2/T5 in progress, T6 pending when quota stopped further work |
| Team Workspace | PASS | selected Tiny Notes Team survived reload; header, progress, real member nodes, graph, feed and filters rendered |
| Agent Inspector | PASS | real Backend member/session opens Inspector with Activity/Messages/Tasks/Files, human send and interrupt confirmation |
| Live Session | PASS | official catalog address derivation plus `openSubagent()` produced `97 public events`, `open` state, real assistant rows, and live updates |
| Tool Activity | PASS | Inspector showed paired typed tool-call and tool-result rows such as `team_task_get`, `team_message_send`, `read`, `glob`, and `pwsh` |
| Human Steering | PASS | UI message `Please verify the update endpoint edge case before finishing.` delivered to Backend session and persisted with `deliveryState=delivered` |
| Realtime Reconnect | PASS for snapshot recovery / PARTIAL provider stability | controlled restart showed `RECONNECTING…` → `LIVE` and state reconciliation; real model run also exposed repeated host listener loss |

## Real Team identity evidence

Team: `team_00000001_7831f216` — `Tiny Notes 验收团队`

| Role | Member | Session | Observed final state |
|---|---|---|---|
| Architect | `member_00000008_dfe2058c` | `dc406b4b-aeef-40de-b61f-b011b2733eed` | stopped; T1 completed; same-session self-claim observed |
| Backend | `member_00000009_d50b5c7b` | `5d61e650-559d-44e1-a0e2-a8decafb34af` | idle; T2 in progress |
| Frontend | `member_0000000a_7328eea8` | `027c59e7-b539-4b55-a066-ba7b257906ba` | idle; T3 completed |
| Tester | `member_0000000b_0e702742` | `5344ed61-32f5-4682-96a5-8bc31a3b8963` | stopped; T4 completed; T5 in progress |
| Reviewer | not created | not available | provider/member cap and quota prevented activation |

Tasks observed: T1 `task_00000002_e25e1a8e` completed; T2 `task_00000003_782e4712` in progress; T3 `task_00000004_8ad8c5a9` completed; T4 `task_00000005_aff46527` completed; T5 `task_00000006_4d7fc620` in progress; T6 `task_00000007_de15fd81` pending.

## Security probes

Actual HTTP probes against `http://127.0.0.1:3080` produced:

- unauthenticated POST: `401 authenticated Harness browser session required`;
- missing/wrong CSRF: `401`;
- invalid Team: `400 team team_missing not found`;
- cross-Team target session: `400 target ... is not in team ...`;
- encoded traversal: `400`;
- valid authenticated snapshot: `200`.

## Performance sanity

Adapter benchmark normalized 6 agents, 50 tasks and 200 activity/message events over 500 iterations in `36.86ms`. This is a deterministic UI-adapter sanity test, not a claim that a full 50-task real LLM Team was run.

## Additional Service guards

- `TASK_REOPEN_NOT_ALLOWED` now rejects Lead reassignment of a completed dependency, preventing a completed prerequisite from being reopened behind active downstream work.
- Completion route errors include typed `code` and `details`, so UI/API consumers can distinguish `TEAM_NOT_COMPLETABLE` from transport or input failures.
- `maxActiveMembers` counts only live/active member states; stopped or failed teammates free a staged slot for a later Reviewer, covered by a compiled regression test.
- Plan submission/approval synchronizes the owning teammate's blocked/idle status, preventing stale member status while a plan is awaiting review.
- Native `idle` lifecycle events no longer overwrite a member's `working/blocked` semantic state while that member still owns a task; reassign/block paths now synchronize member state and emit status events.
- Hash routing listens for browser hash/popstate changes; invalid `#agent-team=team_missing` now renders `Team not found` instead of retaining the previous Team, covered by a compiled logic test and clean-browser verification.

## Acceptance decision

The implementation has reliable tested coordination primitives, a functional selected-Team UI, and real public child-session/tool evidence from the prior funded run. Live Persistent Teammates, Reviewer Loop, and final completion success remain unproven because that provider run returned repeated quota failures. Runtime event append is explicitly process-local/non-atomic across processes, and Harness caller-principal/RBAC is not exposed by the current WebServer API. New score: **84 / 100, PARTIALLY QUALIFIED**. It must not be labeled Qualified or published as production-ready without a funded real-provider run and those production-boundary decisions being closed.
