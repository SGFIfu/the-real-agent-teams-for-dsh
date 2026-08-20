# Agent Teams Runtime v2 — Interface Contract v1

Status: **FROZEN FOR FEATURE IMPLEMENTATION**

Any change requires an `INTERFACE CHANGE REQUEST` in the integration branch and approval by the Lead. Feature work may add private helpers but may not change these shared shapes independently.

## Durable Tables

Existing tables remain stable:

```text
teams, members, tasks, messages, plans, file_claims, findings
```

New tables:

```text
workspaces, git_workspaces, commits, review_requests, review_results, runtime_events
```

All records carry a stable string id and `teamId` where applicable. Records are validated by zod at the DomainStore boundary.

## Workspace Contract

```ts
interface TeamWorkspace {
  id: WorkspaceId;
  teamId: TeamId;
  memberId?: TeamMemberId;
  taskId?: TaskId;
  repositoryRoot: string;
  branch: string;
  worktreePath: string;
  status: 'requested' | 'creating' | 'ready' | 'dirty' | 'clean' | 'review' | 'merged' | 'abandoned' | 'recoverable';
  leaseId: string;
  createdAt: number;
  updatedAt: number;
  lastHeartbeatAt: number;
}
```

`repositoryRoot` and `worktreePath` are normalized absolute paths stored only by the host adapter. Web callers cannot choose arbitrary roots.

## Git Workspace Contract

```ts
interface GitWorkspace {
  id: GitWorkspaceId;
  workspaceId: WorkspaceId;
  repositoryRoot: string;
  branch: string;
  baseRef: string;
  worktreePath: string;
  head?: string;
  changedFiles: string[];
  status: 'creating' | 'ready' | 'dirty' | 'clean' | 'merged' | 'abandoned' | 'recoverable';
  createdAt: number;
  updatedAt: number;
}
```

## Commit Contract

```ts
interface WorkspaceCommit {
  id: CommitId;
  teamId: TeamId;
  workspaceId: WorkspaceId;
  memberId: TeamMemberId;
  taskId?: TaskId;
  hash: string;
  subject: string;
  files: string[];
  createdAt: number;
}
```

## Review Contract

```ts
interface ReviewRequest {
  id: ReviewRequestId;
  teamId: TeamId;
  taskId: TaskId;
  workspaceId: WorkspaceId;
  requestedBy: SessionId;
  reviewerMemberId: TeamMemberId;
  baseRef: string;
  headRef: string;
  status: 'requested' | 'in_review' | 'changes_requested' | 'approved' | 'rejected';
  createdAt: number;
  updatedAt: number;
}

interface ReviewResult {
  id: ReviewResultId;
  requestId: ReviewRequestId;
  reviewerMemberId: TeamMemberId;
  verdict: 'approved' | 'changes_requested' | 'rejected';
  evidence: string[];
  findingIds: string[];
  createdAt: number;
}
```

## Runtime Event Contract

```ts
interface RuntimeEvent {
  id: RuntimeEventId;
  teamId: TeamId;
  sequence: number;
  name: string;
  actorSessionId?: SessionId;
  targetSessionId?: SessionId;
  visibility: 'public' | 'internal';
  payloadVersion: 1;
  dedupeKey?: string;
  payload: Record<string, unknown>;
  createdAt: number;
}
```

Public event families include `member_*`, `task_*`, `message_*`, `plan_*`, `file_*`, `workspace_*`, `git_*`, `review_*`, `qa_*`, and `team_*`. Internal events never enter the browser projection.

## Adapter Contracts

```ts
interface GitWorkspaceAdapter {
  createBranch(input: { repositoryRoot: string; baseRef: string; branch: string }): Promise<{ head?: string }>;
  addWorktree(input: { repositoryRoot: string; branch: string; worktreePath: string }): Promise<void>;
  status(input: { repositoryRoot: string; worktreePath: string }): Promise<{ clean: boolean; head?: string; changedFiles: string[] }>;
  recordCommit(input: { repositoryRoot: string; worktreePath: string; memberId: TeamMemberId; taskId?: TaskId }): Promise<WorkspaceCommit>;
  removeWorktree(input: { repositoryRoot: string; worktreePath: string }): Promise<void>;
}
```

The adapter implementation must use fixed `git` subcommands and validated paths. The core service must remain testable with a deterministic fake adapter.

## Error Contract

New typed errors use existing `TeamError` serialization:

```text
WORKSPACE_NOT_FOUND
WORKSPACE_OWNERSHIP_CONFLICT
WORKSPACE_PATH_ESCAPE
WORKTREE_CREATE_FAILED
WORKTREE_DIRTY
BRANCH_ALREADY_EXISTS
COMMIT_NOT_RECORDED
REVIEW_NOT_APPROVED
QA_EVIDENCE_MISSING
RUNTIME_EVENT_CONFLICT
```

## Change Protocol

```text
INTERFACE CHANGE REQUEST
Feature:
Current Contract:
Requested Change:
Reason:
Affected Agents:
Migration Impact:
```
