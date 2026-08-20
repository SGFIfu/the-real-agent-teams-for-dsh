# Agent Teams Runtime v2 Target Architecture

## Decision

Extend the existing `AgentTeamsService` and `TeamStore` seams. Do not create a second Task Manager, Message Bus, or state store. Add workspace/Git/review/runtime-event domains behind the same service boundary, and keep Harness-specific Session/Git integration in `src/harness/`.

## Architecture

```text
Human / Lead / Teammates
          │ typed tools + authenticated Web actions
          ▼
     AgentTeamsService
  ┌───────┼────────┬─────────┐
  ▼       ▼        ▼         ▼
Team/  Task DAG  Message   Review/
Member Scheduler Delivery  Completion
  │       │        │         │
  └───────┴────────┴─────────┘
              │
        TeamStore seam
              │
  ┌───────────┼─────────────┐
  ▼           ▼             ▼
DomainStore MemoryStore RuntimeEvent log
              │
              ▼
     Harness adapters
  Session / Git / Events / Auth
              │
              ▼
  Snapshot + public event projection
              │
              ▼
  Team Workspace / Graph / Inspector
```

## Module Boundaries

| Module | Owns | Must not own |
|---|---|---|
| `src/core` | Types, schemas, state transitions, ownership, gates, event payloads | Cordis, HTTP, React, arbitrary shell |
| `src/harness` | Domain adapter, Session adapter, Git adapter, event/auth bridge | Team business rules duplicated outside Service |
| `src/tools` | Input schemas, actor resolution, thin Service calls | Direct storage mutation or native runtime guesses |
| `src/client` | Snapshot/event projection and presentation | Team state mutations, fake fixtures, private reasoning |
| `docs` | Contracts, ownership, architecture, acceptance evidence | Untracked implementation decisions |

## State Model

### Agent

`starting → idle → working → waiting/reviewing → idle`; exceptional `blocked`, `failed`, `stopped`.

### Task

`pending → in_progress → completed|failed`; dependency/plan/review gates may expose `blocked`. Claims must be atomic and retain owner session identity.

### Workspace

`requested → creating → ready → dirty|clean → review → merged|abandoned`; stale leases become `recoverable`, never silently reassigned.

### Review

`requested → in_review → changes_requested|approved|rejected`; findings independently move `open → resolved|accepted`.

### Team

`active ↔ paused → completed|failed`. `completed` is legal only after Service-level required-task, plan, review, QA, and workspace gates pass.

## Recovery Model

1. Read the full Team snapshot from the store.
2. Mark the UI `RECONNECTING` while the event stream is unavailable.
3. Reconcile Agent/session and workspace leases against authoritative state.
4. Re-subscribe from the last known event sequence.
5. Do not replay historical animation events.

## Security Model

- Agent identity comes from Harness execution context; model-supplied identity is never authoritative.
- Web mutations require same-origin CSRF capability and Service authorization.
- Target Session must belong to the selected Team and target Workspace must belong to the Team/member.
- Git adapter exposes fixed operations and argument arrays only; no arbitrary shell endpoint.
- Repository-relative path normalization rejects traversal and workspace escape.
- Public UI receives only explicit public events and typed Session items; reasoning/private blocks are excluded structurally.
