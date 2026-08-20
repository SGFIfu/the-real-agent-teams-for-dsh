# Agent Teams Full UI Interaction Audit

Date: 2026-08-17  
Repository: `C:\知识库\dsh-agent-teams`  
Scope: real DeepSeek Harness Web UI, selected persisted Team `team_00000001_cf41a0ed` (`QA Mini Notes`), client bundle, responsive layouts, session Inspector and interaction regressions.

## Executive Result

**Result: PASS WITH FOLLOW-UPS**

The blocking member-click failure is fixed. The UI now routes by an explicit Team id, renders distinct sidebar views, keeps one Inspector drawer per selected member, isolates raw Session/Tool output inside the Inspector, preserves the selected Team through reload, and provides a usable full-screen Inspector on mobile.

No new plugin error was emitted during the final browser reload. The accumulated browser log still contains five historical `SyntaxError: Cannot use import statement outside a module` entries from older hot-reload revisions of `client.js`; the current served bundle returns the classic `__ModuleLoader__.load` wrapper and the final reload added zero new entries. This is recorded as a follow-up rather than silently reported as a clean cumulative console.

This audit did not send a new human message because the browser tool requires a fresh confirmation immediately before a representational Send action. The target selector, message editor and existing real delivery evidence from the prior acceptance run remain valid; this pass verifies the controls without claiming a new delivery.

## Environment

| Item | Observed value |
|---|---|
| Harness | `@deepseek-ai/dsh 0.1.0-rc.6` |
| Harness commit | Not available |
| Plugin | `dsh-agent-teams@0.1.0` |
| Plugin path | `C:\知识库\dsh-agent-teams` |
| Branch | `integration/runtime-reliability-v1` |
| HEAD at audit | `2f681269284b913859fca45fb91e8afdb3bd049a` |
| Node | `v24.16.0` |
| pnpm | `11.19.0` |
| OS | Windows `10.0.26200.9168`, win32 x64 |
| Browser | Codex In-app Browser |
| Web URL | `http://127.0.0.1:3080/` |
| Model/provider | Existing persisted QA Mini Notes Team; this UI audit did not spend additional model tokens |

## Interaction Inventory

The final Overview state exposed 35 plugin-scoped controls: 25 buttons, 2 selects and 1 textarea, with ARIA-role controls included in the total. Opening one member Inspector added 7 controls, including close, follow/scroll, four tabs and session actions. The audit exercised:

- Team picker, Team selection, invalid Team route and explicit hash routing.
- Focus mode and Workspace mode.
- Overview, Activity, Members, Dependencies, Sessions and Settings routes.
- Language toggle and Preferences modal, including long Chinese/emoji input and Escape close.
- Activity filters and recipient options without performing an unconfirmed send.
- Five persisted members: Architect, Backend, Frontend, Tester and Reviewer.
- Backend Inspector tabs: Activity, Messages, Tasks and Files.
- Task Graph node selection and Task Detail close path.
- Session Tool rows: collapsed by default, explicitly expandable in the Inspector.
- Browser reload while the Team remained active.
- Desktop, tablet and mobile viewports.

## Real Runtime Evidence

| Evidence | Observation |
|---|---|
| Team | `team_00000001_cf41a0ed`, `QA Mini Notes` |
| Members | 5 persisted members visible across the Team/Inspector flows; 4 delegation cards are visible in the current snapshot because the lead is shown separately |
| Tasks | 7 graph nodes visible in the current snapshot |
| Live state | Workspace header showed `● LIVE` |
| Snapshot endpoints | `/agent-teams/teams` = HTTP 200; selected Team snapshot = HTTP 200 |
| Client endpoint | `/plugins/dsh-agent-teams/client.js` = HTTP 200 |
| Session privacy | Inspector displayed typed public session projection and `reasoning hidden by typed visibility policy` |
| Session evidence | Existing real acceptance evidence showed Backend Inspector bound to the persisted child session and public tool/message events |

## Audit Matrix

| Area | Result | Evidence |
|---|---|---|
| Correct Team selection | **PASS** | QA Mini Notes selected by `#agent-team=team_00000001_cf41a0ed`; invalid id rendered Team not found and did not mount a workspace |
| Team Workspace | **PASS** | Team name, goal, status, progress, members, current tasks, graph and activity rendered |
| Sidebar routing | **PASS** | Six routes now render distinct content; Settings no longer unexpectedly opens the Preferences modal |
| Agent nodes | **PASS** | Five real member identities were clickable and each opened the requested member |
| Real status | **PASS** | Status labels came from snapshot/runtime state; no fixed `WORKING` fixture was observed |
| Inspector uniqueness | **PASS** | Rapid switching across all five members kept `drawerCount = 1` and matched the requested member each time |
| Inspector tabs | **PASS** | Activity/Messages/Tasks/Files were mutually exclusive; session feed and message editor appeared only in their appropriate tabs |
| Live Session | **PASS** | Inspector bound to the member session identity and displayed public assistant/tool activity; hidden reasoning was excluded |
| Tool Activity | **PASS** | Tool calls/results were readable and collapsed; long raw output appeared only after explicit expansion in Session/Tool Output |
| Activity Feed | **PASS** | Real joined/status/task events were shown; no typing fixture was added |
| Task Graph | **PASS** | Dependencies, owner/status graph and Task Detail rendered; T2 Detail now includes Description and Result |
| Message animation | **PARTIAL** | Real delivery/activity path exists and retained activity was verified; no new send animation was claimed in this pass due browser confirmation policy |
| Human messaging | **PARTIAL** | Recipient options and editor verified; new representational send intentionally not executed; prior real acceptance recorded native delivery |
| Team refresh recovery | **PASS** | Selected Team, members, tasks, active route and no duplicate drawer recovered after reload |
| Focus mode | **PASS** | Compact right-side mode opened and returned to Workspace correctly |
| Language switching | **PASS** | Chinese/English labels switched in the live workspace and back |
| Preferences | **PASS** | 47 inputs rendered; long value remained contained; Escape closed the modal |
| Light theme | **PASS** | Live light surface was readable and had no overflow |
| Dark theme path | **PASS IN CODE** | Dark token overrides exist for workspace and detached Inspector; browser runtime did not expose a safe theme-emulation control in this audit |
| Reduced motion | **PASS IN CODE** | `prefers-reduced-motion` disables pulse, flying particles, edge animation and decorative transitions |
| Tablet | **PASS** | 900×900: no overflow; mode pills remain one line after the fix |
| Mobile | **PASS** | 390×844: no overflow; navigation works; Inspector is opaque full-screen with four tabs |
| Client registration | **PASS** | HTTP 200 and bundle test verifies loader id/factory |
| Network smoke | **PASS** | Teams, snapshot and client endpoints returned 200 |

## Bugs Found and Fixed

### BUG-001 — Member click duplicated Inspector and polluted Workspace Activity

- Severity: P1 before fix
- Root cause: the inline workspace Inspector and full drawer both rendered the selected member; live Session rows also exposed unbounded tool output in the wrong visual layer.
- Fix: added a neutral handoff card, session-aware reset behavior, bounded tool previews, collapsed Tool Result rows and drawer containment.
- Evidence: `audit-15-member-1.png` through `audit-15-member-5.png`, `audit-16-rapid-switch-final.png`, `audit-27-tool-output-expanded.png`.

### BUG-002 — Sidebar routes all rendered Overview content

- Severity: P1 before fix
- Root cause: the active tab changed only the eyebrow while the same Overview grid remained mounted.
- Fix: route-specific content for Activity, Members, Dependencies, Sessions and Settings.
- Evidence: before `audit-03-workspace-overview.png` through `audit-08-workspace-settings.png`; after `audit-09-fixed-overview.png` through `audit-14-fixed-settings.png` and `audit-26-settings-route.png`.

### BUG-003 — Task Detail omitted description and mislabeled result

- Severity: P2 before fix
- Fix: mapped `description` into `UiTask`; Task Detail now renders `Description` and `Result` separately.
- Evidence: `audit-30-task-detail-fixed.png`; live DOM contained both fields for T2 Backend.

### BUG-004 — Preferences Escape did not close the modal

- Severity: P2 before fix
- Fix: added a keydown listener scoped to PreferencesDialog.
- Evidence: before count `1`, after Escape count `0`; 47 inputs remained usable before close.

### BUG-005 — Detached mobile Inspector had a transparent background

- Severity: P1 before fix
- Root cause: the drawer is mounted under a Harness host container rather than under `.agc-surface`, so it did not inherit `--agc-*` variables. Its `background: var(--agc-bg)` declaration became invalid/transparent.
- Fix: added explicit light/dark token fallbacks and `isolation: isolate` to `.agc-drawer`.
- Evidence: before mobile capture showed native Harness/workspace content through the Inspector; after `audit-24-mobile-inspector-fixed.png` has an opaque `rgb(247, 251, 255)` drawer, width `390`, four tabs and zero horizontal overflow.

### BUG-006 — Tablet mode pills wrapped vertically

- Severity: P2 before fix
- Fix: `white-space: nowrap` on mode buttons.
- Evidence: 900×900 final measurement showed both buttons on one row (`56×21.5` and `66×21.5`), `overflow = 0`; `audit-31-tablet-fixed.png`.

### BUG-007 — Settings navigation unexpectedly opened Preferences

- Severity: P2 before fix
- Fix: Settings navigation now selects the Settings route; the header gear remains the explicit Preferences action. Added `aria-current="page"` to the Settings nav button.
- Evidence: `audit-26-settings-route.png`; modal count `0`, Settings card count `1`, Settings route ARIA state present.

## Privacy and Session Safety

The UI uses the typed session projection rather than filtering text for words such as `Think`. Public assistant messages, tool calls, tool results and approved reports remain available. Typed reasoning blocks are removed before rendering. The live Inspector explicitly displayed that reasoning was hidden by the visibility policy. The native Harness conversation may still have host-owned presentation outside this plugin; that is not rendered by the repaired Agent Teams Inspector.

## Console and Network Audit

- Final browser reload: **no new error/warning entries**.
- Cumulative browser log: five historical `SyntaxError: Cannot use import statement outside a module` entries tied to earlier `client.js?rev=...` hot-reload revisions. They were not re-emitted by the final reload.
- Current HTTP fetch of `/plugins/dsh-agent-teams/client.js`: starts with `window.__ModuleLoader__.load`, id `dsh-agent-teams`, no top-level ESM import, HTTP 200.
- `/agent-teams/teams`, selected snapshot and client bundle all returned HTTP 200.

## Automated Regression

Final commands and results:

```text
pnpm run typecheck  PASS
pnpm run build      PASS
pnpm test           PASS — 120 tests, 0 failures
client bundle       PASS — id dsh-agent-teams, factory function, classic loader
```

The final test suite still covers atomic claiming, dependencies/cycles, persistence, messaging, plan hard guards, file conflicts, completion guards, session privacy, simulation and client registration. This audit added regression assertions for route-specific workspace markup, Settings content, task descriptions and Result labeling. There is no lint script in `package.json`.

## Git State

No commit was created by this audit. The worktree was already dirty with user/project changes and generated evidence files; creating a selective release commit would risk bundling unrelated work. Current branch and HEAD are recorded above for reproducibility.

## Remaining Follow-ups

1. Clear or isolate the browser’s historical hot-reload console entries before release screenshots are treated as a clean cumulative console audit.
2. Add a Playwright/browser regression suite for theme switching, reduced-motion emulation, refresh animation replay, Inspector live updates and layout assertions.
3. Re-run a real confirmed peer/human message send and capture the message-flight animation in a controlled acceptance session.
4. Run an independent reviewer pass when a Codex reviewer slot is available; this audit used a self-review because the subagent limit was already occupied.

## Final Acceptance

**UI interaction acceptance: PASS WITH FOLLOW-UPS.** There are no remaining P0/P1 UI layout, routing or Inspector containment failures observed in the current live Team. The product is materially usable as a real Team workspace, but the cumulative console history, lack of browser automation for several visual invariants and unexecuted fresh Send action should remain visible in release notes rather than being overstated as full end-to-end proof.

## Evidence Screenshots

- `audit-02-workspace-overview.png` — baseline full Workspace.
- `audit-10-fixed-activity.png` — route-specific Activity.
- `audit-11-fixed-members.png` — route-specific Members.
- `audit-12-fixed-dependencies.png` — route-specific Dependencies.
- `audit-24-mobile-inspector-fixed.png` — opaque mobile Inspector.
- `audit-25-refresh-recovery.png` — recovered Workspace after reload.
- `audit-26-settings-route.png` — Settings route without surprise modal.
- `audit-27-tool-output-expanded.png` — explicit Tool Output expansion inside Inspector.
- `audit-30-task-detail-fixed.png` — Task Detail Description/Result.
- `audit-31-tablet-fixed.png` — tablet header/layout after nowrap fix.
