# Agent Teams Runtime v2 — Agent Assignment and File Ownership

The current thread has one executable Lead and no delegated subagent tool. These manifests are still authoritative: each implementation lane has one branch and one worktree, and the Lead works one lane at a time. No parallel Agent execution is claimed.

## Assignment Manifest

| Agent ID | Role | Feature IDs | Branch | Worktree | Status |
|---|---|---|---|---|---|
| `lead-v2` | architecture/integration | all | `integration/agent-teams-v2` | `C:\知识库\dsh-agent-teams` | active |
| `core-contract-agent` | shared domain contracts | AT2-002, AT2-003 | `feature/runtime-v2-contracts` | `C:\知识库\worktrees\dsh-runtime-v2-contracts` | planned |
| `workspace-agent` | workspace/Git domain and adapter | AT2-001, AT2-004, AT2-005 | `feature/workspace-manager` | `C:\知识库\worktrees\dsh-workspace-manager` | planned |
| `review-agent` | review/QA/completion integration | AT2-006, AT2-007, AT2-012 | `feature/review-gates-v2` | `C:\知识库\worktrees\dsh-review-gates-v2` | planned |
| `events-agent` | runtime events/recovery | AT2-003, AT2-011 | `feature/runtime-events-v2` | `C:\知识库\worktrees\dsh-runtime-events-v2` | planned |
| `security-agent` | authorization/path safety | AT2-009 | `feature/security-boundaries` | `C:\知识库\worktrees\dsh-security-boundaries` | planned |
| `ui-agent` | observability/workspace UI | AT2-010 | `feature/ui-observability-v2` | `C:\知识库\worktrees\dsh-ui-observability-v2` | planned |
| `reviewer-fresh` | independent reviewer | all merged changes | `review/agent-teams-v2` | fresh review worktree | planned |
| `qa-fresh` | independent QA | end-to-end scenarios | `qa/agent-teams-v2` | fresh QA worktree | planned |

## File Ownership Map

| Path | Owner | Other agents |
|---|---|---|
| `src/core/types.ts` | `core-contract-agent` | read-only after interface freeze |
| `src/core/schemas.ts` | `core-contract-agent` | read-only after interface freeze |
| `src/core/store.ts` | `core-contract-agent` | read-only after interface freeze |
| `src/core/service.ts` | `lead-v2` / owning feature agent by approved change request | no direct edits without ownership approval |
| `src/core/events.ts` | `events-agent` | read-only |
| `src/core/runtime-events.ts` | `events-agent` | events lane only |
| `src/core/workspace.ts` | `workspace-agent` | workspace lane only |
| `src/core/review.ts` | `review-agent` | review lane only |
| `src/harness/domain.ts` | `core-contract-agent` | contract change request required |
| `src/harness/domain-store.ts` | `core-contract-agent` | contract change request required |
| `src/harness/git-workspace.ts` | `workspace-agent` | workspace lane only |
| `src/harness/events-bridge.ts` | `events-agent` | events lane only |
| `src/harness/command-route.ts` | `security-agent` | security change request required |
| `src/tools/index.ts` | `lead-v2` | thin integration only |
| `src/client.ts` | `ui-agent` | no core state logic |
| `src/client/logic/**` | `ui-agent` | privacy contract is read-only |
| `src/**/*.test.ts`, `tests/**` | owning feature agent | shared regression changes coordinated by Lead |
| `docs/**` | `lead-v2` | each feature agent supplies completion evidence |

## Worktree Rules

- No feature agent edits `integration/agent-teams-v2` directly.
- No feature agent merges or pushes `main`/`integration`.
- Every feature completion report lists branch, worktree, owned files, tests, and commit hashes.
- A cross-ownership edit requires the change-request template from `docs/INTERFACE_CONTRACT_V1.md`.
- Reviewer and QA worktrees must be fresh and must not reuse an implementation agent's context.
