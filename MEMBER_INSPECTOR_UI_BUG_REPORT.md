# Member Inspector UI Bug Report

## Root Cause

Selecting a teammate activated two independent presentation paths at once: the workspace rendered the selected member in the bottom-right `AgentInspectorCard`, while the command center also rendered the full `Inspector` drawer. At the same time, public Harness `tool-result` text was rendered as an ordinary session row, so long stdout such as directory listings could visually dominate a bounded workspace card.

## Affected Components

- `src/client.ts` — `AgentInspectorCard`, `WorkspaceLayout`, `Inspector`, `LiveSessionCard`
- `src/client/logic/session.ts` — privacy-safe session projection is the source of public tool-result text
- `tests/client-module-bundle.mjs` — client regression assertions

## State Bug

The selected session state was shared by the workspace preview and the drawer, but the workspace card did not know that the drawer was already authoritative. Switching members could also preserve local Inspector tab, follow, draft, and interrupt-confirmation state because the same React instance remained mounted.

## Data Routing Bug

The session projection correctly filtered reasoning/private blocks, but the UI treated a full public tool result as a normal activity row. This made raw command output look like team Activity and allowed large output to compete with the workspace layout.

## CSS/Layout Bug

The drawer and session feed had insufficient width containment for long public output. The workspace grid also lacked an explicit child max-width/min-width boundary, so an unbounded content row could visually pressure neighboring cards.

## Changes

- Added a dedicated `SessionItemRow` renderer.
- Kept assistant/report rows readable while rendering tool calls/results as collapsed `<details>` blocks.
- Added a one-line/line-count preview and bounded expandable `<pre>` for raw tool output.
- Changed `LiveSessionCard` to show the same bounded summary instead of full tool output.
- Made the workspace member card a neutral handoff card while the full Inspector is open, preventing duplicate member details.
- Removed the incorrect inline close action that reopened the Inspector.
- Reset Inspector tab, follow mode, draft, interrupt confirmation, and delivery feedback when `sessionId` changes.
- Added drawer, session-feed, session-row, tool-output, and workspace-grid containment rules.
- Added client-bundle regression assertions for the session renderer, tool-output containment, and single-Inspector handoff path.

## Tests

- `pnpm run typecheck` — PASS
- `pnpm run build` — PASS
- `pnpm test` — PASS, 120 tests
- Existing atomic claim, dependency, persistence, privacy, security, and client registration tests remained green.
- Client bundle registration still asserts one `dsh-agent-teams` module with a callable factory.

## Before Behavior

The supplied reproduction showed raw session/file listing text (`Mode Length Name`, `data`, `dist`, and similar output) entering the workspace Activity area, neighboring cards being visually overlapped, and a second selected-member Inspector summary appearing at the bottom right.

## After Behavior

The main Activity feed remains event-only. Tool output is visible only as a compact session summary and is expanded intentionally inside the Inspector. The workspace keeps one authoritative selected-member Inspector; the bottom-right slot becomes a handoff placeholder while that drawer is open. The stable live workspace capture is `workspace-after-route-fix.png`.

## Git Commits

No isolated commit was created because this worktree already contains the user's earlier Agent Teams UI/runtime changes. The fix is present in the working tree and generated client bundle; commit it together with the intended release scope after review.

## Reviewer Result

Automated review: PASS. Visual review: stable workspace layout PASS; the supplied before screenshot is the reproduction reference. A headless capture of the open drawer itself was not treated as acceptance evidence because the current Harness page intermittently remains on its asynchronous skeleton during screenshot startup.
