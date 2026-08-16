# Agent Teams Runtime v2 — Independent Architecture Review

Date: 2026-08-16  
Reviewed base: `integration/agent-teams-v2` at `c998e9b` (`docs(process): mark v2 design frozen`)  
Reviewer branch: `review/architecture-agent-teams-v2`  
Reviewer worktree: `C:\知识库\worktrees\architecture-review-v2`  
Scope: read-only review of the v2 target design and the current integration seams in `src/core/service.ts`, `src/harness/runtime.ts`, `src/harness/events-bridge.ts`, and `src/tools/index.ts`, with supporting review of the store, domain, route, and architecture/contract documents.  
Change policy: no source code changes, no merge, no push. This worktree contains only this memo.

## Executive Verdict

**CONCERNS — do not begin feature merges yet.**

The target direction is sound: extend the existing `AgentTeamsService` and `TeamStore` rather than introducing a second task manager, message bus, or runtime. The current implementation already has valuable invariants for task dependencies, atomic task claims, persistence, typed errors, and actor-derived model-tool identity.

The integration is not yet safe to parallelize because the frozen design does not fully define the write/event boundary, and the current seams contain several state-authority conflicts. The most important blockers are:

1. The feature backlog contains a dependency cycle: `AT2-004` (Git adapter) depends on `AT2-009` (security), while `AT2-009` also depends on `AT2-004`. This must be split into a pre-Git security policy and a post-Git adapter hardening pass.
2. `AgentTeamsService` emits ephemeral Cordis events after mutating durable state, while the proposed `runtime_events` table is also intended to be an audit log. Without one idempotent event-writer/outbox boundary, a single mutation can produce duplicate events, missing audit records, or divergent UI and snapshot state.
3. Native runtime status and task/member semantic status are already written by multiple paths. `agent/status`, `subagent/end`, `syncMemberTask`, `updateMember`, and `updateMemberFromRuntime` can race or overwrite one another. The v2 bridge must be idempotent and must not reinterpret a continuable child run ending as permanent teammate disposal.
4. `team_member_spawn` in `src/tools/index.ts` directly writes `s.store` after the service has registered a placeholder member. That violates the documented thin-tool boundary and bypasses service-level event/invariant handling. It must be resolved before workspace, runtime-event, or review records bind to member identity.
5. Current member-to-member delivery is performed through the lead authority in `HarnessRuntimeAdapter.followup`; it is not evidence of a native direct peer channel. The contract must explicitly preserve relay semantics or add a verified native peer-delivery capability; it must not silently rename relay to direct delivery.

The recommended gate is **CONCERNS / implementation hold** until the contract is revised to resolve these issues. The existing task/DAG/claim/persistence behavior should be treated as a protected regression baseline.

## Reviewed Architecture Baseline

### Existing ownership seams

| Area | Current authority | Evidence | Review implication |
|---|---|---|---|
| Team/task/member/plan/file/finding state | `AgentTeamsService` over `TeamStore` | `src/core/service.ts:49`, `src/core/store.ts` | Preserve one coordination core; new domains must be service operations, not parallel managers. |
| Durable storage | `DomainStore` over the Harness `agent_teams` domain | `src/harness/domain-store.ts`, `src/harness/domain.ts` | Adding tables requires one coordinated contract/schema/domain migration. |
| Native child runtime | Harness `ctx.subagents` through `HarnessRuntimeAdapter` | `src/harness/runtime.ts:40-125` | Core must remain provider-agnostic; runtime handles must never become model-supplied identities. |
| Live notification | `TeamEventSink` → `CordisEventSink` → `ctx.emit` | `src/core/service.ts:72-77`, `src/harness/events-bridge.ts:13-22` | Live events are currently best effort, not an audit source. |
| Native lifecycle observation | `bridgeNativeEvents` | `src/harness/events-bridge.ts:43-77` | Bridge maps host observations into service state; it must not become a second state machine. |
| Model-facing API | `registerTeamTools` and `defineTool` | `src/tools/index.ts:123-156` | Tools should resolve actor identity and delegate; direct store writes are an existing exception that must be removed or formally authorized. |
| Web control plane | `commandRoute` plus service authorization | `src/harness/command-route.ts`, `src/core/service.ts` | Human actions need request identity plus team/member/session authorization; CSRF alone is not a domain authorization model. |
| UI | snapshot plus SSE projection | `src/client.ts`, `src/index.ts` | Snapshot must remain authoritative; event stream is an incremental hint and must be replay-safe. |

### What is already protected

The following behavior should not be redesigned by feature agents:

- `TeamStore.update` is the atomic per-record read-modify-write seam used by `claimTask` and `claimNextTask` (`src/core/service.ts:450-517`).
- Dependency checks and cycle detection are service-owned (`src/core/service.ts:392-448`).
- Completion is a service gate, not a prompt-only convention (`src/core/service.ts:165-207`).
- Actor resolution comes from `exec.agent.id` or the Harness initiator (`src/tools/index.ts:123-132`).
- Typed error serialization is centralized in `defineTool` (`src/tools/index.ts:134-153`).
- The existing `TeamStore` and domain schema are shared contracts, not feature-local implementation details.

## Current Integration Risks

### R-001 — Event authority and duplicate event risk (P0)

`AgentTeamsService.emit` calls the injected sink after the durable write and suppresses every sink exception (`src/core/service.ts:72-77`). `CordisEventSink.emit` forwards to `ctx.emit` (`src/harness/events-bridge.ts:13-22`). The plugin entrypoint then registers one `ctx.on` listener per event name and forwards each event to all SSE clients (`src/index.ts`).

The proposed `runtime_events` table adds a second event destination. If a feature agent simply appends a runtime event and keeps the existing `emit` call, there will be two event streams with no common event id, sequence, or dedupe rule. If the new bridge also converts the same native event into a semantic event, the same state transition can appear twice in the Activity Feed. If the store write succeeds but the sink fails, the live UI misses an event; if the sink succeeds before an audit append, the UI can show an event that is absent from the durable audit trail.

Required design decision:

- one service-owned mutation/event wrapper performs the durable state mutation and creates exactly one public runtime-event record with `id`, `teamId`, monotonic `sequence`, `payloadVersion`, `visibility`, and optional `dedupeKey`;
- the Cordis sink and SSE are downstream best-effort projections of that committed record;
- native observations have a separate ingress path and dedupe key, and must not be re-emitted as if they were service-originated commands;
- event append must have an atomic per-team sequence or compare-and-set primitive. `list` followed by `max(sequence)+1` followed by `put` is not safe under concurrent agents;
- sink failures must be observable. They may not invalidate committed state, but they must not be silently discarded by `catch {}`.

### R-002 — Competing status writers (P0)

There are at least four semantic status writers:

| Writer | Code path | Risk |
|---|---|---|
| Task claim/finish | `syncMemberTask` in `service.ts:292-308` | Sets member `working`, `blocked`, or `idle` and emits `MEMBER_STATUS`. |
| Explicit service update | `updateMember` in `service.ts:274-289` | Can change semantic status independently of task state. |
| Native lifecycle bridge | `bridgeNativeEvents` in `events-bridge.ts:56-65` | Maps native running/idle to semantic working/idle asynchronously. |
| Native child end | `bridgeNativeEvents` in `events-bridge.ts:68-76` | Marks a member `stopped`. |

`updateMemberFromRuntime` has a guard for an `idle` native event while a member still has a task (`src/core/service.ts:310-318`), but this is a local patch over competing writers rather than a complete transition protocol. The bridge uses fire-and-forget async callbacks with no ordering token or catch handler. Out-of-order events can apply stale state after a newer task transition.

The `subagent/end` mapping is especially dangerous for continuable workers: if Harness emits an end event for one completed turn/run rather than permanent child disposal, marking the durable teammate `stopped` breaks the persistent worker lifecycle. This semantic must be confirmed against the current Harness API before integration.

Required design decision:

- native status is authoritative only for native execution activity;
- task ownership and semantic team status are authoritative in the service;
- the bridge submits typed observations with event identity/time and the service applies an idempotent transition policy;
- only a verified permanent child-disposed signal can move a member to `stopped`;
- every bridge callback catches and records rejection rather than creating an unhandled promise rejection;
- stale/out-of-order observations must be ignored using a monotonic native event/run sequence or equivalent identity.

### R-003 — Member spawn bypasses the service boundary (P0)

`team_member_spawn` first calls `registerMember` with a fabricated placeholder session id, starts the native child, and then directly mutates the store with `s.store.put('members', ...)` (`src/tools/index.ts:214-254`). The success write does not go through a service transition or emit a member/session binding event. The failure write similarly bypasses status transition logic and timestamps.

This creates a race window in which the member is visible with an invalid session id, and it makes it possible for future workspace/review/runtime-event records to bind to a placeholder or to miss the real child identity. It also contradicts `docs/AGENT_TEAMS_V2_ARCHITECTURE.md`, which says tools do not directly mutate state.

Required fix before any new feature binds to member identity:

- add a service-owned spawn finalization operation, or make spawn registration a service transaction with an explicit `starting` record and verified child identity;
- validate that the returned child is a real direct child of the lead/parent;
- emit one member-joined/binding transition only after the real session id is known;
- keep failure cleanup in the service;
- do not let feature agents add another member registry or another spawn state machine.

### R-004 — Peer delivery is lead-authority relay, not proven direct peer delivery (P1)

`AgentTeamsService.sendMessage` persists the message, then for member targets calls `runtime.followup(this.leadHandleFor(team), target, body, sender)` (`src/core/service.ts:636-709`). `HarnessRuntimeAdapter.followup` resolves the live lead and invokes `subagents.followup(lead, childId, ..., source: { kind: 'coordinator', form: 'relay', senderSessionId })` (`src/harness/runtime.ts:73-89`).

There is also a false-success edge case: when `this.runtime` is absent, `deliveryErrors` remains empty and the current code calculates `delivered = true` with `deliveryTransport = 'durable-inbox'`. Durable persistence is not native delivery and must not be reported as recipient receipt. The v2 contract should distinguish at least `persisted`, `accepted`, `delivered`, `acknowledged`, and `failed`, or explicitly document that only `persisted` is known when no runtime is mounted.

This can be a valid authorization-preserving relay, but it is not the same as a native sender-session-to-recipient-session channel. The current message record can claim `native-followup` and `delivered` even though the transport authority is the lead. A v2 direct messaging requirement must choose one of these contracts explicitly:

1. **Relay contract:** keep the lead as the native authority, name the transport `coordinator-relay`, and expose sender attribution as metadata only; or
2. **Direct contract:** add a verified Harness capability that sends from the actual sender session to the target child, with native receipt/failure semantics.

Do not add a second message bus or have feature agents call `ctx.subagents` directly. Preserve `TeamRuntimeAdapter` as the only core-facing seam, and require an interface change request for any new runtime capability.

Broadcast also has a state-model problem: one `TeamMessage` is stored for multiple targets, but any target failure marks the whole message `failed` (`service.ts:653-709`). A runtime event audit must not present that as one binary delivery. Either add per-recipient delivery records or define broadcast delivery state as an aggregate with target-level outcomes.

### R-005 — File claims are not multi-record atomic (P1)

`claimFiles` lists existing claims, checks overlap, then writes one claim per pattern (`src/core/service.ts:878-916`). The batch is checked before the writes, but two concurrent callers can both read the same old claim set, both pass conflict detection, and then create overlapping claims. The existing task claim uses `TeamStore.update` on one task and has a stronger atomicity contract; file claims do not have the same protection.

Workspace leases and file ownership must use a service/store primitive that atomically checks the current ownership and commits the new lease. Do not treat the current list/check/put sequence as sufficient for workspace isolation. The existing exact/directory/glob overlap algorithm is a useful baseline and should be preserved behind an atomic claim operation.

### R-006 — TeamStore/domain expansion is a migration, not a type-only change (P1)

The current store table union has exactly seven tables (`src/core/store.ts`), and the Harness domain and table-name list repeat that set (`src/harness/domain.ts`, `src/harness/domain-store.ts`). `docs/INTERFACE_CONTRACT_V1.md` proposes six new tables: `workspaces`, `git_workspaces`, `commits`, `review_requests`, `review_results`, and `runtime_events`.

Adding types without a coordinated schema/domain version migration will compile in MemoryStore tests but fail or silently omit records in the real Harness domain. Adding tables independently in feature branches will create schema drift and merge conflicts.

The contract agent must own one migration commit covering types, zod schemas, `TableName`, `RecordOf`, `DomainStore`, domain version/table registration, seed/round-trip behavior, and backward compatibility. Feature agents must consume that contract read-only.

### R-007 — Public Web reads and human mutations need a caller-context contract (P1)

The current route authenticates POST mutations with an in-memory cookie/CSRF capability, but GET team list and snapshot paths are not tied to a caller identity. `publicSnapshot` intentionally calls `getSnapshot` as the team lead (`src/core/service.ts:1060-1067`), and the route uses it for Web reads. This is acceptable only under a tightly scoped loopback trust model; it is not a general Harness user-principal authorization model.

Before workspace paths, Git operations, human steering, or session inspection are exposed:

- define a typed authenticated caller context supplied by the Harness Web layer;
- authorize the caller against the selected team and operation in the service;
- validate every target member/session/workspace belongs to that team;
- keep CSRF as request integrity, not as the authorization decision;
- never allow the Web body to choose an arbitrary lead session as the acting identity;
- make public session projection and hidden-reasoning filtering structural and independent of route trust.

There are service/tool authorization gaps that should be treated as P0 for any new control-plane feature:

- `team_status` calls `getTeam(teamId)` without an actor (`src/tools/index.ts` status tool; `src/core/service.ts:126`), so a model can read a Team it does not belong to;
- `pauseTeam`, `resumeTeam`, and `failTeam` call `assertActor` but do not require `team.leadSessionId === actor` (`src/core/service.ts:137-147`), despite their tool descriptions being lead-only;
- `team_member_spawn` relies on the same incomplete lead check;
- the Web route derives the mutation actor from `team.leadSessionId` instead of the authenticated caller (`src/harness/command-route.ts` mutation branches).

These must be resolved in the shared authorization seam, not by ad-hoc filtering in individual feature tools.

### R-008 — Plan and review state transitions need explicit state guards (P1)

The current plan methods write approved/rejected status without checking the previous plan state (`src/core/service.ts:768-816`). A late reject can overwrite an approved plan, or a duplicate approval can emit a second approval event. The current completion guard checks for some approved plan (`src/core/service.ts:181-201`), so a history of contradictory plan events could still satisfy the gate if the final record is approved.

V2 review/approval records need compare-and-set transitions with legal predecessor states, idempotency keys, and reviewer/author separation. The reviewer must not directly mutate task state; the Service should derive task/release/gate changes from an approved or changes-requested review command.

The current finding path also needs same-Team validation: `addFinding` resolves a related task by id but must explicitly verify `task.teamId === input.teamId` before linking it. The same invariant must apply to `workspaceId`, reviewer member, responsible member, and review request. A finding or review record must never become a cross-Team foreign-key shortcut.

### R-009 — Completion guard expansion must remain one service invariant (P1)

The current `completeTeam` guard checks required task completion, failed/in-progress/blocked/pending tasks, unapproved plans, and critical/high open findings (`src/core/service.ts:165-207`). V2 adds workspace cleanliness, review result, QA evidence, and possibly commit/merge state.

Those checks must be added to the same service-level completion operation. A Web route, tool, reviewer prompt, or UI button must not implement a second approximation. New gate reasons must be typed and returned in `TEAM_NOT_COMPLETABLE` details. The guard must also be race-safe: check and transition to completed under the same team-level compare-and-set/lock so a task cannot become incomplete between validation and completion.

### R-010 — Snapshot/event recovery needs a sequence and cursor contract (P1)

The current SSE path forwards `ctx.emit` frames to all connected clients; it has no persisted event sequence, replay cursor, or team-specific server-side subscription (`src/index.ts`). The client already treats refresh/snapshot as the recovery path, which is the correct direction, but the proposed runtime-event log must define:

- snapshot as authoritative state;
- stream as an incremental projection;
- monotonic per-team sequence and last-seen cursor;
- reconnect from cursor when possible, otherwise refetch and reconcile;
- no replay of one-shot animation events after a refresh;
- event filtering and authorization before browser projection;
- idempotent application of the same event more than once.

Do not make the UI depend on the event stream as the only state source.

Native event routing also needs a stable Team binding. `memberOf` in `src/harness/events-bridge.ts:46-53` scans every Team and returns the first matching session. If a session is present in more than one Team, or if a stale session survives reconnect, an event can be applied to the wrong Team. Runtime observations must carry or resolve a stable `teamId`/`memberId`/`sessionId` binding rather than relying on first-match global scanning.

### R-011 — Event and sink errors are currently invisible (P2)

Both `AgentTeamsService.emit` and `CordisEventSink.emit` swallow exceptions. This protects business mutations from a broken UI sink, but it also hides the exact failures the runtime-event audit is meant to diagnose. V2 should separate committed domain state from notification delivery and record notification failure as an operational/runtime event or metric. It must not turn an event sink failure into a second state mutation.

### R-012 — Tool boundary and target identity are inconsistent (P1)

`resolveActor` correctly derives the caller from the execution context (`src/tools/index.ts:123-132`), but several target ids remain model-supplied addresses: `toSessionId`, `toSessionId` for reassignment, `responsibleSessionId`, and member/session registration. Service membership checks are necessary but not sufficient for native identity validation.

`updateMemberFromRuntime` is intentionally called by the native bridge, but its signature has no trusted runtime-origin context (`src/core/service.ts:310`). It must not become a normal model-facing mutation. Either keep it behind the Harness adapter or require a trusted runtime observation capability; a model-provided member id/session id must never be accepted as proof of a native lifecycle event.

Likewise, `HarnessRuntimeAdapter.interrupt` can silently no-op when the live lead cannot be resolved (`src/harness/runtime.ts:109-117`), and `listChildrenOf` converts every runtime error into an empty list (`src/harness/runtime.ts:119-127`). New recovery code must not interpret these fallbacks as successful interrupt or authoritative “no children” state.

`team_member_register` accepts an arbitrary string as an existing Harness session (`src/tools/index.ts:297` area in the current file). It must either be limited to a verified session catalog/child relationship or be removed from model-facing use. A model must not be able to make an arbitrary Harness session appear to be a teammate by submitting its id.

## Existing Methods That Must Not Gain Duplicate State/Event Semantics

The following table is the required event ownership map for integration. It is not permission for feature agents to edit these methods; it is a merge review checklist.

| Existing method/path | Current durable mutation | Current semantic event | Integration rule |
|---|---|---|---|
| `createTeam` (`service.ts:103-123`) | puts `teams` | `TEAM_CREATED` | Runtime-event append belongs to the same service mutation boundary; do not emit a second `team-created` from the adapter. |
| `registerMember` (`service.ts:211-252`) | puts `members` | `MEMBER_JOINED` | Spawn finalization must use a service method; no direct `store.put` from tools. |
| `team_member_spawn` (`tools/index.ts:214-254`) | directly rewrites member record after runtime start | no corresponding service transition for the real child id | Must be replaced by a service-owned finalization operation before workspace binding. |
| `updateMember`, `syncMemberTask`, `updateMemberFromRuntime` (`service.ts:274-318`) | update member status/task | `MEMBER_STATUS` | Define one semantic transition authority; native bridge must be idempotent and must not echo its own semantic event back as another mutation. |
| `agent/status` bridge (`events-bridge.ts:56-65`) | none directly; calls service | indirectly `MEMBER_STATUS` | Treat as observation. Do not append both native and semantic status events to the public feed unless they have separate typed event names and dedupe ids. |
| `subagent/end` bridge (`events-bridge.ts:68-76`) | sets member `stopped` | `MEMBER_STATUS` | Confirm child-run vs child-disposal semantics; never stop a persistent member on a normal turn boundary. |
| `claimTask`/`claimNextTask` (`service.ts:450-517`) | atomic task claim + member sync | `TASK_CLAIMED` plus possibly `MEMBER_STATUS` | One claim event per successful owner; no scheduler-side duplicate claim event. |
| `finishTask`/`completeTaskAndSchedule` (`service.ts:522-566`) | completes task, clears member, optionally self-claims next | `TASK_COMPLETED`/`TASK_FAILED` plus member status | Self-claim is one service command sequence; do not add a second worker/scheduler that claims the same task. |
| `sendMessage`/`broadcastMessage` (`service.ts:636-716`) | stores message and delivery outcome | `MESSAGE_SENT` or `MESSAGE_DELIVERY_FAILED` | Native inbound/outbound events need origin/dedupe metadata; broadcast needs per-target outcome semantics. |
| `submitPlan`, `approvePlan`, `rejectPlan` (`service.ts:734-816`) | stores plan and changes task state | plan events | Add legal predecessor/CAS guards; do not have review tools write plans directly. |
| `claimFiles`/`releaseFiles` (`service.ts:878-937`) | puts/removes claims | file claim/conflict/release events | Make conflict check and lease acquisition atomic before binding to a worktree. |
| `addFinding`/`finishFinding` (`service.ts:940-1019`) | stores finding state | finding events | Review request/result owns review lifecycle; finding records remain evidence, not a substitute for a review verdict. |
| `completeTeam` (`service.ts:165-207`) | changes Team to completed | `TEAM_COMPLETED` | All new review/workspace/QA gates must enter this one invariant and be checked atomically. |

## Minimum Safe Integration Order

The order below is the minimum sequence that preserves the current invariants and avoids feature agents inventing competing state models.

### Gate 0 — Freeze baseline and split the dependency cycle

Before implementation:

- retain the current `integration/agent-teams-v2` baseline and its passing task/DAG/claim/persistence/client tests;
- split `AT2-009` into `AT2-009a` (caller/team/member/path policy, no Git dependency) and `AT2-009b` (Git adapter hardening and adapter-specific authorization);
- update the DAG so `AT2-009a → AT2-004 → AT2-009b`, removing the current `AT2-004 ↔ AT2-009` cycle;
- record the change as an interface/design change before feature agents start.

### Merge 1 — Shared contract and migration only (`AT2-002`)

Own and review together:

- `src/core/types.ts`, `src/core/schemas.ts`, `src/core/store.ts`;
- `src/harness/domain.ts`, `src/harness/domain-store.ts`;
- new table names and version/migration behavior for workspaces, Git workspaces, commits, review requests/results, and runtime events;
- new typed errors and event payload contracts.

No runtime behavior, Git process, Web route, or UI changes in this merge.

Gate: legacy seven-table state round-trip, new-record round-trip, old data migration, schema rejection, MemoryStore/DomainStore parity, typecheck, existing tests, build, client bundle.

### Merge 2 — Runtime event writer and audit contract (`AT2-003`)

Add a service-owned append/dedupe/sequence mechanism. Keep `TeamEventSink` as a best-effort downstream projection. Do not add a second event bus.

Gate: one committed mutation produces one durable public event; retry with the same dedupe key produces no duplicate; per-team sequence is monotonic under concurrency; internal events never enter the browser projection; a sink failure leaves durable state correct and is diagnosable; recovery/re-fetch reconstructs state from snapshot plus events.

### Merge 3 — Logical workspace and lease state (`AT2-001`, `AT2-005`)

Add service-owned workspace records, member/task/workspace bindings, lease ownership, heartbeat, recoverable state, and atomic file/workspace claim/handoff. Preserve the existing path-pattern overlap algorithm but move acquisition behind a compare-and-set/transactional boundary.

Gate: same workspace/file cannot have two owners under concurrent requests; team/member/session binding is enforced; stale leases become `recoverable` rather than silently reassigned; handoff is explicit; traversal and workspace escape are rejected; existing task/file claim tests remain green.

### Merge 4 — Security preflight (`AT2-009a`)

Introduce a typed caller context and centralized authorization policy before exposing Git or new human controls. The policy must distinguish lead, member, reviewer, authenticated human, and internal runtime observation.

Gate: unauthenticated mutations rejected; authenticated caller cannot cross teams; arbitrary session impersonation rejected; target workspace/member/session belongs to the team; model-supplied identity is never used as caller identity; Web reads and writes have explicit privacy scope; path normalization tests pass.

### Merge 5 — Physical Git/worktree adapter (`AT2-004`)

Implement only the frozen `GitWorkspaceAdapter` operations in `src/harness/`. Core receives a narrow adapter; it does not import Cordis or execute shell. Use fixed subcommands and argument arrays, validate repository/worktree paths against an approved root, and record branch/head/changed-files/commit metadata through the service.

Gate: branch/worktree isolation, wrong repository rejection, path escape rejection, stale worktree recovery, dirty workspace gate, commit record identity, cleanup behavior, no arbitrary Web shell endpoint, fake adapter tests, then real Harness adapter smoke test.

### Merge 6 — Git adapter hardening (`AT2-009b`)

Complete security checks that require a real adapter: command allowlist, repository root binding, worktree ownership, branch name validation, symlink/escape checks, and caller authorization for cleanup/commit/status.

Gate: malicious branch/path inputs, cross-team workspace ids, cleanup of another member's worktree, command injection strings, symlink escape, and unauthorized commit/merge operations all fail with typed errors.

### Merge 7 — Review, QA, and completion gate (`AT2-006`, `AT2-007`)

Add ReviewRequest/ReviewResult lifecycle and connect findings to an independent reviewer/member. Extend `completeTeam` in the Service only. Reviewer commands record evidence; they do not directly mutate task state or bypass workspace/plan gates.

Gate: independent reviewer identity; review request links task/workspace/base/head; approve/changes-requested/reject transitions are legal and idempotent; medium/high finding fix/re-review is persisted; required review/QA/clean workspace/approved plan are required; premature completion returns `TEAM_NOT_COMPLETABLE`; final completion is atomic.

### Merge 8 — Native runtime delivery and recovery (`AT2-008`, `AT2-011`)

After the service contracts exist, repair the Harness adapter and event bridge: stable child session binding, verified parent/child identity, explicit direct-vs-relay message transport, idempotent lifecycle observations, run/disposal distinction, reconnect snapshot reconciliation, and stale lease repair.

Gate: same session completes Task A and self-claims Task B; direct/relay delivery is proven with target Session evidence; duplicate/out-of-order native events do not corrupt status; a normal child turn end does not stop a persistent teammate; disconnect/reconnect recovers latest snapshot; delivery failure is not reported as success.

### Merge 9 — Tools, Web, and public observability (`AT2-009`, `AT2-010`, `AT2-012`)

Only after service/runtime behavior is stable should tools and Web/UI expose new operations. Tools remain thin, actor-derived delegators. UI reads selected Team snapshot and privacy-safe public session/runtime projections.

Gate: tool schemas match frozen contracts; no direct storage mutation; Web caller authorization; invalid Team/session/workspace handling; snapshot-authoritative reconnect; no hidden reasoning; real tool/message/Git/review activity appears once; refresh does not replay transient animation.

### Merge 10 — Full integration and independent QA

Use a fresh reviewer worktree and a fresh QA worktree. Run no-model simulation, concurrent claim tests, persistence/recovery, Git isolation, security probes, and a funded real Tiny Notes Team. Do not convert simulation or unit evidence into real provider acceptance.

## Feature Dependency DAG

```text
AT2-002 Shared contracts + migration
  └── AT2-003 Runtime event audit
        ├── AT2-001 Logical workspace state
        │     ├── AT2-005 Workspace/file leases
        │     ├── AT2-004 Physical Git adapter
        │     │     └── AT2-009b Git-specific hardening
        │     └── AT2-006 Review request/result
        │           └── AT2-007 Completion/QA gate
        ├── AT2-008 Persistent runtime/delivery
        │     └── AT2-011 Recovery/stale lease repair
        └── AT2-010 Public observability

AT2-009a Caller/team/member/path security preflight
  ├── AT2-004 Physical Git adapter
  ├── AT2-012 Human steering
  └── AT2-009b Git-specific hardening
```

The split between `AT2-009a` and `AT2-009b` is mandatory. The current backlog's direct cycle `AT2-004 → AT2-009 → AT2-004` has no valid topological order.

## Interfaces That Feature Agents Must Not Change Without Approval

The following are shared contracts or state-authority seams. A feature agent may add private helpers within its owned module, but any shape, status, error, event, identity, or persistence change requires an `INTERFACE CHANGE REQUEST` in the integration branch and Lead approval.

| Interface/file | Owning lane | Why protected |
|---|---|---|
| `src/core/types.ts` | `core-contract-agent` | All durable identities, statuses, ownership and adapter types depend on it. |
| `src/core/schemas.ts` | `core-contract-agent` | Durable validation boundary; must migrate atomically with tables. |
| `src/core/store.ts` | `core-contract-agent` | Atomicity and table union contract; task/file/runtime events depend on its semantics. |
| `src/core/errors.ts` | Lead + contract owner | Typed error codes are part of tool/Web/API compatibility. |
| `src/core/events.ts` | `events-agent` | Public event names and payload ownership; adding a duplicate event family is prohibited. |
| `src/core/service.ts` | Lead / approved owning feature | Sole business-state and completion-gate authority. |
| `src/harness/domain.ts` | `core-contract-agent` | Real Harness durable schema/version. |
| `src/harness/domain-store.ts` | `core-contract-agent` | Real atomic storage mapping; must match `TeamStore`. |
| `src/harness/runtime.ts` | Runtime lane / Lead-approved adapter change | Only place core-facing native runtime capability is defined. |
| `src/harness/events-bridge.ts` | `events-agent` | Native observation mapping and lifecycle ownership. |
| `src/tools/index.ts` | Lead / thin integration lane | Public model tool names, schemas, actor derivation, and delegation boundary. |
| `src/harness/command-route.ts` | Security lane | Human caller/auth/target authorization and path/resource safety. |
| `src/client/logic/session.ts` | Privacy contract owner | Public Session projection; hidden reasoning must never enter UI data. |
| `docs/INTERFACE_CONTRACT_V1.md` | Lead | Frozen cross-feature contract and change protocol. |

Specific prohibitions:

- Do not modify `TeamStore.update` semantics to make a workspace/Git feature easier; add a narrowly specified atomic primitive if required and regression-test existing claims.
- Do not add a second state store, Task Manager, Message Bus, runtime loop, or event bus.
- Do not import Cordis, HTTP, React, or shell execution into `src/core`.
- Do not call `s.store.put` from a feature tool to patch a member/task/workspace record.
- Do not let a model-provided `sessionId`, `memberId`, or `ownerSessionId` become caller identity.
- Do not change `followup` semantics or claim direct peer delivery without a verified Harness capability and an interface change request.
- Do not add a Web endpoint that accepts arbitrary command strings, repository roots, worktree paths, or Git subcommands.
- Do not expose raw Harness session items to the browser without the privacy projection.

## Merge-by-Merge Regression Matrix

Every row is a merge gate. A feature branch is not mergeable when its row fails, even if unrelated tests pass.

| Merge | Mandatory regression | Failure that blocks merge |
|---|---|---|
| M0 baseline | typecheck; unit/integration suite; atomic claim; dependency/cycle; persistence; client registration/bundle; privacy projection | Any existing PASS invariant regresses or baseline command result is unrecorded. |
| M1 contracts/migration | MemoryStore and DomainStore round-trip; old seven-table data; new six-table data; version migration; schema rejection; `TeamStore` compile compatibility | New tables absent from real domain, old records unreadable, or atomic update semantics changed. |
| M2 runtime events | one mutation/one event; monotonic per-team sequence under 50 writers; dedupe/retry; public/internal filtering; sink failure; restart/replay | Duplicate event, sequence collision, missing audit record, private event in browser, or event-only state recovery. |
| M3 workspace/leases | concurrent same-workspace claim; file exact/dir/glob overlap; release/handoff; stale lease; team/member/session binding; traversal | Two owners, silent reassignment, stale ownership, cross-team binding, or non-atomic check-then-put. |
| M4 security preflight | unauthenticated; invalid CSRF; cross-team; arbitrary session; invalid member/workspace; path escape; role matrix | Any mutation succeeds with wrong caller, wrong team, arbitrary target, or unsafe path. |
| M5 Git adapter | branch/worktree isolation; fixed argv; repo-root binding; dirty/clean; commit metadata; cleanup/recovery; fake + real adapter smoke | Worktree escape, command injection, wrong branch/member, missing commit record, or destructive cleanup. |
| M6 review/gates | independent reviewer; request/result transitions; medium/high finding; fix/re-review; plan rejection/reapproval; premature completion; final atomic completion | Reviewer can self-approve, finding is bypassed, invalid transition succeeds, or incomplete Team completes. |
| M7 runtime/bridge | same-session A→B; direct-vs-relay evidence; duplicate/out-of-order status; child turn end; crash/reconnect; delivery failure | New session impersonates old worker, stopped state is wrong, target never receives, or stale state survives recovery. |
| M8 tools/Web/UI | no direct store writes; schema/identity; selected team; snapshot + stream reconnect; privacy; live public items; human control | Tool mutates outside Service, UI relies on event-only state, wrong Team/session shown, or hidden reasoning exposed. |
| M9 full integration | 20–50 concurrent claims; shared-state race tests; simulation; Git isolation; security; persistence/reload; client/build | Any duplicate ownership, lost update, unrecoverable workspace, or regression in existing client/build gates. |
| M10 fresh review/QA | fresh reviewer worktree; fresh QA worktree; real Tiny Notes Team with independent Reviewer and final validation | Implementer reviews own code, evidence is simulation-only, or real provider/session closure is unproven. |

### Required command set after every relevant merge

At minimum, run the repository's actual typecheck, tests, build, and client bundle/registration checks. For state or runtime changes, also run the focused concurrency, persistence, recovery, and privacy suites. A report must include command output/result; no PASS may be inferred from an unrun test.

## Review Acceptance Scenarios

The following scenarios should be executed against the integrated branch, with stable ids recorded in the final report:

1. Create a team and two real members; verify member session ids are real native children and remain stable across Task A completion, idle, message receipt, and Task B self-claim.
2. Send Lead→Agent, Agent→Lead, Agent→Agent, and broadcast messages. Record sender, target, target session, transport, delivery outcome, and the native receipt evidence. If the transport is a lead relay, report it as relay.
3. Race 20–50 agents against one or more exclusive tasks and assert zero duplicate owners, including file/workspace claims.
4. Disconnect the stream after a claim, complete the task during disconnect, reconnect, refetch snapshot, and confirm the UI converges to completed without replaying old animations.
5. Create a plan-required task, reject once with feedback, resubmit from the same author, approve, and prove implementation/completion is rejected before approval.
6. Create a workspace and Git worktree for a member, attempt traversal/cross-team access, make a commit, inspect changed files, and verify the persisted member/task/workspace/commit chain.
7. Run an independent Reviewer against a real diff, create a medium/high finding, route it to the responsible member, fix and test it, re-review, and resolve it.
8. Call `team_complete` with required pending, blocked, in-progress, unapproved-plan, dirty-workspace, missing-QA, and open-high-finding conditions individually. Every attempt must fail with typed `TEAM_NOT_COMPLETABLE` details. Complete all gates and call again successfully.
9. Open the real member Inspector while it produces a public assistant message and tool call/result. Verify the UI receives only public session data, never hidden reasoning or private blocks.

## Required Revisions Before Feature Work

1. Split the security/Git dependency cycle into `AT2-009a` and `AT2-009b`.
2. Add the runtime-event atomic append/dedupe/sequence contract and define whether the event record is the source for Activity Feed or only an audit projection.
3. Replace `team_member_spawn` direct store writes with a service-owned spawn/finalization transition.
4. Decide and document direct peer delivery versus lead relay; update `TeamRuntimeAdapter` only through an approved interface change.
5. Define native run-end versus child-disposal semantics and idempotent status observation before enabling persistent worker recovery.
6. Make workspace/file ownership acquisition atomic and bind every claim to team, member, session, and workspace.
7. Add caller-context authorization before expanding Web human controls or exposing workspace/Git/session data.

## Final Review Status

**CONCERNS — not ready for feature merge.**

The v2 design should proceed only after the seven revisions above are reflected in the frozen contract and the M1/M2 gates are implemented. Once those gates are green, the remaining feature branches can be merged in the sequence defined here without creating duplicate coordination systems or allowing the UI/event stream to become a false source of truth.

## Evidence and Files Reviewed

- `src/core/service.ts`
- `src/core/types.ts`
- `src/core/store.ts`
- `src/core/events.ts`
- `src/harness/runtime.ts`
- `src/harness/events-bridge.ts`
- `src/harness/domain.ts`
- `src/harness/domain-store.ts`
- `src/harness/command-route.ts`
- `src/tools/index.ts`
- `src/index.ts`
- `docs/ARCHITECTURE.md`
- `docs/AGENT_TEAMS_V2_ARCHITECTURE.md`
- `docs/AGENT_TEAMS_V2_BACKLOG.md`
- `docs/AGENT_TEAMS_V2_ASSIGNMENTS.md`
- `docs/INTERFACE_CONTRACT_V1.md`
- `docs/AGENT_PROTOCOL.md`

This memo is an architecture review, not an implementation acceptance. No source code was changed in the review worktree.
