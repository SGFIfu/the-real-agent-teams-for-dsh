# RUNTIME RELIABILITY DESIGN

Status: implemented contract for P0 reliability hardening; the remaining
end-to-end qualification gate is a funded real-provider dogfood run.

Scope: provider/model separation, persistent worker wake-up, task eligibility,
bounded agent capabilities, pending-session message delivery, and the
authoritative event cursor. This design preserves the existing atomic task
claim, dependency DAG, persistence, review, completion guard, client loader,
and web authorization contracts.

## 1. Root Cause Audit

### REPRO-01 — Provider failure leaves a placeholder

Observed on the current compiled runtime:

- Requested provider: v4-flash.
- Native failure: no subagent provider registered for v4-flash.
- Durable result: one member remained with sessionId __pending_msvxrfym_7jhpuy,
  provider v4-flash, status failed.

Trigger: team_member_spawn.

Code path:

src/tools/index.ts creates a pending member -> src/harness/runtime.ts passes
the provider directly to ctx.subagents.startContinuable() -> the catch path
calls markMemberSpawnFailed() instead of removing the provisional record.

Root cause: provider resolution is deferred until after durable member
creation, and the coordination model has no first-class resolved AgentSpec.

Missing invariant: a provider validation failure must not create a durable
member record.

### REPRO-02 — Dependency completion does not wake the next Worker

Observed on the current compiled service:

- Worker B completed task A.
- Dependent task B remained pending.
- Worker B became idle; the other Worker remained starting.
- No scheduler or runtime wake-up was invoked.

Trigger: completeTask().

Code path: src/core/service.ts finishes the task and emits TASK_COMPLETED;
only the explicit caller of completeTaskAndSchedule() may call claimNextTask()
for the same session. There is no target-worker notification or task-ready
scheduler.

Root cause: task state changes and Worker lifecycle are decoupled. The runtime
only reacts when a model sends a later tool call or the Lead sends a message.

Missing invariant: a ready task with an eligible active Worker must cause a
runtime wake-up or a durable unschedulable reason.

### REPRO-03 — Claim routing ignores explicit role assignment

Observed on the current compiled service:

- A task created for a tester had no assignment field in its record.
- Object.keys(task) contained no assigned member, assigned role, capability,
  or workspace field.
- An implementer session successfully claimed it through claimNextTask().

Trigger: claimNextTask().

Code path: src/core/service.ts filters only status, owner, and dependencies.

Root cause: eligibility is implicit and role-blind; task ownership is treated
as the first atomic claimant rather than a policy decision.

Missing invariant: explicit assignment is a hard claim boundary unless an
authorized reassignment/recovery path is used.

### REPRO-04 — Execution policy is not represented at the team boundary

Observed in the current source:

- SpawnSpec contains provider, prompt, label, parent, and optional native
  toolFilter, but no team capability policy or audit identity.
- The static runtime forwards toolFilter.
- The generated dynamic runtime silently drops maxDepth, toolFilter, persona,
  and model/agentOptions before calling ctx.subagents.startContinuable().
- TeamRuntimeAdapter has no command execution or capability audit seam.

Root cause: the host runtime owns tools and processes, but the plugin did not
provide a bounded team-member policy or a host hook for auditable decisions.

Implemented boundary: `AgentTeamsService.authorizeToolCapability()` classifies
repository/process/Git tool calls, checks the durable member capability and
file-claim state, emits `CAPABILITY_DECISION`, and the host plugin installs it
on `tools/pre-execute`. Shell file mutation and protected Git actions are
denied even when the member has the broad implementation capability. Typed
`team_*` operations retain their own service-level authorization.

### REPRO-05 — Pending target message becomes permanently failed

Observed on the current compiled service:

- A direct message to a target session whose followup rejected was persisted.
- Its final state became failed.
- The durable inbox still contained the record, but no retry queue or
  readiness listener existed.

Trigger: sendMessage().

Code path: src/core/service.ts attempts native followup immediately and marks
the message failed on any error.

Root cause: session readiness is not a delivery state. The message store is
durable, but delivery has no queued/retry/ack state machine.

## 2. Target Runtime Contract

### AgentSpec

The coordination model stores:

- agentId / durable member id
- role
- model — model identity, for example deepseek-v4-flash
- provider — execution transport, for example spawn
- capabilities — named bounded capabilities
- workspace / owned file patterns
- lifecycleState
- eventCursor

The provider resolver runs before member creation:

resolve alias/model -> resolve provider -> list/validate provider ->
validate model/provider compatibility -> start native child -> register the
real child session.

A failed native start must not leave a durable member. If a native child is
created but member registration fails, the child is interrupted through the
parent authority and the failure is returned with no durable placeholder.

The alias v4-flash resolves explicitly to model deepseek-v4-flash. The default
execution provider remains a separate configured value and is validated
against ctx.subagents.list(). The resolved identity is retained in the
returned result and in the member record.

### WorkerLoop

The runtime-provided lifecycle is:

STARTING -> READY -> WAITING_FOR_TASK -> CLAIMING -> WORKING -> REPORTING ->
WAITING_FOR_TASK.

Additional terminal/intermediate states are:

BLOCKED, WAITING_FOR_REVIEW, STOPPED, FAILED, CANCELLED.

The coordination service does not create a second model loop. It drives the
native continuable inbox and sends a typed wake-up only after authoritative
task state changes. The Worker must refresh team_snapshot, drain its inbox,
and claim through the service; a Lead chat message is not required.

### TaskEligibility

canClaim(agent, task) is true only when:

- task is pending and dependencies are completed;
- team is active;
- member is a live, non-stopped/non-failed member;
- explicit member assignment matches, when present;
- explicit role assignment matches, when present;
- required capabilities are a subset of the member capabilities;
- the task workspace matches the member workspace access, when present;
- the member has no incompatible current task.

Atomic storage update remains the final authority. Eligibility only filters
candidates; it never replaces the existing atomic claim invariant.

### CapabilityPolicy

Capabilities are named data, not arbitrary shell access. The first policy
surface contains:

- repo.read
- repo.write.owned
- process.test
- process.build
- git.read
- git.commit.own-branch
- review.verify

Denied by default:

- merge/push to protected branches;
- writes outside the assigned workspace or claimed files;
- arbitrary executable selection;
- secret access;
- force release or cross-team mutation.

Every classified host execution decision carries agent/member/session, team,
command or tool, workspace/path, capability, timestamp, and allow/deny result.
The policy module remains host-independent and testable; the host hook is the
enforcement boundary for the current Harness tool registry.

### MessageDelivery

Message states are:

pending -> queued -> delivering -> delivered -> acknowledged.

Failures before session readiness return to queued with bounded retry
metadata. Terminal failed is reserved for an exhausted retry budget or an
authorization/target-integrity failure. One message id is delivered at most
once per accepted native inbox operation; retry checks the stored delivery
state before attempting again.

### Authoritative Events

The durable store is truth. The live event sink is notification. Runtime
events are appended with a team-scoped monotonic sequence and dedupe key.
Reconnect consumers use:

authoritative snapshot + events after cursor.

Event sequence is included in wake-up and message delivery evidence so a stale
notification cannot overwrite newer task state.

## 3. Invariants

### INV-01 — No invalid member

Provider/model validation failure leaves member count unchanged and no
__pending_* record.

### INV-02 — Assignment boundary

An explicitly assigned task cannot be auto-claimed by another role/member.
Only authorized reassignment or recovery can change the assignment.

### INV-03 — Ready-task liveness

When a task becomes ready and an eligible active Worker exists, the service
must enqueue one wake-up and the Worker must eventually claim it or produce a
typed unschedulable reason.

### INV-04 — Pending message durability

A message sent before the target session is ready is queued and eventually
delivered once the target becomes ready; it is not permanently failed merely
because the first attempt raced startup.

### INV-05 — Capability containment

No Worker execution can exceed its named capability, workspace, owned-file,
branch, and command policy.

### INV-06 — Reviewer independence

The Reviewer has read-only source access plus approved dynamic verification
capabilities, and all verification actions are independently auditable.

### INV-07 — Existing invariants do not regress

Atomic claim, dependency enforcement/cycle protection, persistence, client
registration, plan guard, review gate, file conflict detection, and completion
guard remain green.
