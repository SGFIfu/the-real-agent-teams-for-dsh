# Agent Teams Runtime Upgrade v2 — Feature Backlog

Status: design baseline for `integration/agent-teams-v2`.

This backlog is derived from the local Agent Teams acceptance records and the source-grounded GitHub landscape report in `C:\知识库\github-multi-agent-landscape\GITHUB_MULTI_AGENT_LANDSCAPE_REPORT.md`.

## Feature Records

### AT2-001 — Durable Workspace/Git Responsibility Chain

- Feature Name: Agent → Task → Branch → Worktree → Files → Commits → Review → Merge traceability
- Source Project: OpenCode worktree runtime; Claude Code worktree guidance; dsh existing task/member identity
- Problem Solved: Current Team state records tasks and sessions but cannot answer which branch/worktree/files/commits belong to a member or review.
- Design Idea: Add a typed workspace record and explicit bindings for member, task, branch, worktree, owned file patterns, and commit metadata. Keep physical Git execution behind an injected adapter; never expose arbitrary shell through Web routes.
- Current Status: MISSING
- Recommendation: ADAPT
- Priority: P0
- Complexity: HIGH
- Risk: HIGH
- Dependencies: AT2-002, AT2-003
- Likely Modules: `src/core/types.ts`, `schemas.ts`, `store.ts`, new `workspace.ts`, Harness domain adapter
- Expected User Value: Users can trace every change to a responsible Agent and isolated workspace.
- Expected Engineering Value: Enables safe review, merge, rollback, and stale-worktree recovery.

### AT2-002 — Shared Domain Contract Expansion

- Feature Name: Workspace, GitWorkspace, Commit, ReviewRequest, ReviewResult, RuntimeEvent records
- Source Project: OMA durable scheduler; Codex Thread/Turn/Item; Zeroshot proof records
- Problem Solved: Cross-feature changes currently have no shared typed contract for Git/review/audit state.
- Design Idea: Extend the existing `TeamStore` table union and zod domain schema once, before feature work starts.
- Current Status: PARTIAL
- Recommendation: COPY
- Priority: P0
- Complexity: MEDIUM
- Risk: MEDIUM
- Dependencies: None
- Likely Modules: `src/core/types.ts`, `src/core/schemas.ts`, `src/core/store.ts`, `src/core/testing.ts`, `src/harness/domain.ts`
- Expected User Value: Consistent status and ownership across UI, tools, storage, and reports.
- Expected Engineering Value: Prevents duplicate Task/Review/Event models.

### AT2-003 — Runtime Event Audit Log

- Feature Name: Durable, typed, public-visibility RuntimeEvent stream
- Source Project: Codex app-server events; AutoGen typed message runtime; Zeroshot ledger bus
- Problem Solved: Existing semantic events are useful for UI but do not provide a durable audit trail for branch/worktree/commit/review/QA actions.
- Design Idea: Persist append-only runtime events with sequence, actor, visibility, payload version, and dedupe key. Keep event sink best-effort for live UI, but make store snapshot authoritative.
- Current Status: PARTIAL
- Recommendation: ADAPT
- Priority: P0
- Complexity: HIGH
- Risk: HIGH
- Dependencies: AT2-002
- Likely Modules: `src/core/events.ts`, new `src/core/runtime-events.ts`, `store.ts`, `service.ts`, `harness/events-bridge.ts`
- Expected User Value: Reliable Activity Feed and post-mortem trace.
- Expected Engineering Value: Recovery, dedupe, QA evidence, and security auditability.

### AT2-004 — Physical Worktree Adapter

- Feature Name: Safe Git branch/worktree lifecycle
- Source Project: OpenCode `worktree/index.ts`; Zeroshot worktree tooling
- Problem Solved: File claims alone do not isolate simultaneous edits.
- Design Idea: Inject a narrow `GitWorkspaceAdapter` with fixed operations (`createBranch`, `addWorktree`, `status`, `listChangedFiles`, `recordCommit`, `removeWorktree`). Validate repository/worktree paths and use argument-array execution; never accept arbitrary command strings.
- Current Status: MISSING
- Recommendation: ADAPT
- Priority: P1
- Complexity: VERY HIGH
- Risk: HIGH
- Dependencies: AT2-001, AT2-002, AT2-009a
- Likely Modules: new `src/core/workspace.ts`, new `src/harness/git-workspace.ts`, tests
- Expected User Value: Parallel Agents can work without overwriting each other.
- Expected Engineering Value: Branch correctness and cleanup become testable.

### AT2-005 — Workspace File Lease and Cross-Ownership Requests

- Feature Name: File ownership bound to team/member/session/workspace
- Source Project: Claude Code file-lock task claims; Ruflo claims/handoff tools
- Problem Solved: Existing file claims detect conflicts but do not bind to a workspace/branch or create a formal cross-ownership request.
- Design Idea: Preserve current exact/directory/glob conflict algorithm; add `workspaceId`, `ownerMemberId`, lease state, handoff request, and explicit release events.
- Current Status: PARTIAL
- Recommendation: ADAPT
- Priority: P1
- Complexity: MEDIUM
- Risk: HIGH
- Dependencies: AT2-001, AT2-002
- Likely Modules: `src/core/service.ts`, `types.ts`, `schemas.ts`, new workspace tests
- Expected User Value: Conflict is clear and recoverable rather than silently overlapping.
- Expected Engineering Value: Prevents stale ownership and makes handoff reviewable.

### AT2-006 — Review Request / Result / Merge Gate

- Feature Name: Independent Reviewer and structured QA result
- Source Project: Zeroshot verifier/quality gates; Claude Code completion hooks
- Problem Solved: Current findings exist, but there is no first-class request/result linking diff, evidence, reviewer, and merge decision.
- Design Idea: Add review request/result records and require a review result for tasks marked `reviewRequired`; findings remain the detailed issue model.
- Current Status: PARTIAL
- Recommendation: ADAPT
- Priority: P0
- Complexity: HIGH
- Risk: HIGH
- Dependencies: AT2-002, AT2-003, AT2-001
- Likely Modules: new `src/core/review.ts`, `service.ts`, `types.ts`, tests
- Expected User Value: Reviewer decisions and fix loops are visible.
- Expected Engineering Value: Completion guard can rely on evidence, not prose.

### AT2-007 — Completion Guard Expansion

- Feature Name: Required task/review/workspace/QA completion invariant
- Source Project: OMA task completion/replay; Zeroshot quality gates
- Problem Solved: V1 guard covers core tasks/plans/findings but not workspace cleanliness, required review result, or QA evidence.
- Design Idea: Keep existing `TEAM_NOT_COMPLETABLE`; add typed reasons for required failed/in-progress/blocked/review tasks, unclean required workspaces, unresolved findings, and missing QA evidence.
- Current Status: PARTIAL
- Recommendation: ADAPT
- Priority: P0
- Complexity: MEDIUM
- Risk: HIGH
- Dependencies: AT2-003, AT2-006, AT2-001
- Likely Modules: `src/core/service.ts`, `errors.ts`, tests
- Expected User Value: Team cannot be declared complete while required work is unfinished.
- Expected Engineering Value: One central release gate.

### AT2-008 — Persistent Worker and Native Delivery Contract

- Feature Name: Same-session worker loop and direct recipient delivery
- Source Project: Claude Code Agent Teams; AutoGen typed envelopes; dsh existing runtime adapter
- Problem Solved: Existing tests model self-claim, but live provider runs were quota-blocked and V1 docs still describe lead relay for member-to-member delivery.
- Design Idea: Keep `member.sessionId` stable; expose lifecycle callbacks for complete/report/check-in/claim-next; persist delivery state and native transport outcome separately.
- Current Status: PARTIAL
- Recommendation: ADAPT
- Priority: P0
- Complexity: HIGH
- Risk: HIGH
- Dependencies: AT2-002, AT2-003
- Likely Modules: `src/core/service.ts`, `src/harness/runtime.ts`, `src/harness/events-bridge.ts`, tools
- Expected User Value: Teammates continue work and message each other directly.
- Expected Engineering Value: Removes lead relay as a hidden bottleneck.

### AT2-009a — Security and Caller Context Preflight

- Feature Name: Authenticated, scoped Web mutations and safe Git operations
- Source Project: OpenCode permission inheritance; Codex approval boundaries; existing dsh actor checks
- Problem Solved: Web mutations previously relied on loopback/CSRF assumptions; arbitrary session/team targeting must be rejected.
- Design Idea: Keep same-origin + CSRF capability, bind every mutation to authenticated request context, then validate team/member/session/workspace ownership. Git adapter accepts only validated repository-relative paths and fixed operations.
- Current Status: PARTIAL
- Recommendation: ADAPT
- Priority: P0
- Complexity: HIGH
- Risk: HIGH
- Dependencies: AT2-002
- Likely Modules: `src/harness/command-route.ts`, `src/core/service.ts`, tests
- Expected User Value: Human controls cannot affect another Team or arbitrary Session.
- Expected Engineering Value: Prevents impersonation and unsafe resource access before Git operations are exposed.

### AT2-009b — Git Adapter Hardening

- Feature Name: Adapter-specific authorization and command/path hardening
- Source Project: OpenCode worktree permissions; existing Harness runtime boundaries
- Problem: Git/worktree operations require checks that only exist after the physical adapter is present.
- Design: Validate fixed Git argv, repository-root binding, worktree ownership, branch names, symlink/escape behavior, and cleanup permissions in the adapter boundary.
- Current Status: Backlog item split from AT2-009 to remove the AT2-004 ↔ AT2-009 dependency cycle.
- COPY/ADAPT: Adapt OpenCode's scoped worktree model to the frozen `GitWorkspaceAdapter` interface.
- Priority: P0
- Complexity: HIGH
- Risk: HIGH
- Dependencies: AT2-004, AT2-009a
- Likely Modules: `src/harness/git-workspace.ts`, security tests
- Expected User Value: Physical worktrees cannot escape their Team or repository scope.
- Expected Engineering Value: Git-specific attack paths are tested at the actual execution boundary.

### AT2-010 — Public Observability Projection

- Feature Name: Runtime/Session/Tool/Git activity with privacy-safe visibility
- Source Project: Codex app-server Items; dsh existing typed privacy projection
- Problem Solved: Agent Inspector must never surface hidden reasoning, and Activity Feed must distinguish real runtime events from summaries.
- Design Idea: Reuse typed public session projection; add runtime event families for Git/workspace/review/QA. UI reads selected Team snapshot + public events only.
- Current Status: PARTIAL
- Recommendation: ADAPT
- Priority: P1
- Complexity: HIGH
- Risk: HIGH
- Dependencies: AT2-003, AT2-004
- Likely Modules: `src/client/logic/session.ts`, `src/client.ts`, `src/core/runtime-events.ts`
- Expected User Value: Users can observe real work without private reasoning leakage.
- Expected Engineering Value: Stable UI contract independent of Harness renderer internals.

### AT2-011 — Reconnect, Recovery, and Stale Lease Repair

- Feature Name: Snapshot-authoritative recovery for Team and workspace state
- Source Project: OMA checkpoint/restore; Ruflo stale lock/orphan reconciliation; existing dsh reconnect path
- Problem Solved: A listener outage or Agent crash can leave stale in-progress/claimed/worktree state.
- Design Idea: Snapshot is authoritative; event stream is incremental. Add workspace heartbeat/lease expiry and explicit recoverable state, never silently reassign a live lease.
- Current Status: PARTIAL
- Recommendation: ADAPT
- Priority: P1
- Complexity: HIGH
- Risk: HIGH
- Dependencies: AT2-003, AT2-004
- Likely Modules: `src/core/service.ts`, `src/harness/events-bridge.ts`, new recovery tests
- Expected User Value: Teams resume after disconnect/crash.
- Expected Engineering Value: Prevents stuck tasks and orphaned worktrees.

### AT2-012 — Human Steering and QA Scenarios

- Feature Name: Pause/resume/cancel/reassign/approve/reject with end-to-end evidence
- Source Project: Claude Code plan approval and hooks; ChatDev human workflow node
- Problem Solved: Human controls must change runtime state safely and be covered by real usage scenarios.
- Design Idea: Treat all human mutations as typed Service commands, audit them, and test both accepted and rejected transitions.
- Current Status: PARTIAL
- Recommendation: ADAPT
- Priority: P1
- Complexity: MEDIUM
- Risk: MEDIUM
- Dependencies: AT2-003, AT2-009
- Likely Modules: `service.ts`, `command-route.ts`, client Inspector, QA tests
- Expected User Value: Human can steer a running Team without corrupting state.
- Expected Engineering Value: Explicit control-plane semantics.

## Consolidated Priority View

| Priority | Features |
|---|---|
| P0 | AT2-001, AT2-002, AT2-003, AT2-006, AT2-007, AT2-008, AT2-009a, AT2-009b |
| P1 | AT2-004, AT2-005, AT2-010, AT2-011, AT2-012 |
| P2 | UI Git graph/commit browser, mobile workspace inspector, reduced-motion activity polish |
| P3 | Multi-provider cost routing, remote worker federation, reusable Team templates |
