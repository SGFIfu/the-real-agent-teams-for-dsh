# Animated AI Team Command Center — Deliverables & Verification

Upgrade of the `dsh-agent-teams` plugin UI into a live Command Center. Two
delivery planes, one implementation:

- **Static bundle** (`dsh-agent-teams` repo, junctioned into the real web
  profile) — the durable deliverable: `agent_teams` storage domain, 36
  `team_*` tools, `/agent-teams` HTTP surface, the animated client.
- **Dynamic session plugin** `agtms-1` (pkg-8) — the same code, generated
  from the compiled static `lib/` (imports/exports stripped, dual-dialect
  tool schemas), so the Command Center is LIVE in this session right now.

## 1. UI architecture

- Pure, DOM-free event adapter: `src/client/logic/control.ts`
  (`statusMeta`, `taskStatusMeta`, `roleAvatar`, `layeredGraph`,
  `diffSnapshots`, `rawEventToUiEvent`, `pushBuffer`, `filterActivity`,
  `statusCounts`, `normalizeSnapshot`, `prefersReducedMotion`) — 14 unit
  tests in `src/client/logic/control.test.ts`.
- React render layer `src/client.ts`: `CommandCenter` → `AgentGraph`
  (lead row + member nodes), `MessageLayer` (particles), `TaskGraphPanel`
  (topological rows), `ActivityFeed` (channels + timeline), `Inspector`
  (drawer), `OverlayEntry` (sidebar toggle). Registered into the Harness
  slot `sidebar.footer.action`.
- Bridge = `fetch('/agent-teams/*')` + `EventSource('/agent-teams/stream')`;
  2s polling is only a fallback for missed frames.

## 2. Real-time data (no fake activity)

- Host route `/agent-teams/stream` (SSE) pushes every typed event as
  `data: {"type":"agent-teams/…",…payload}`; the client maps frames to UI
  events via `rawEventToUiEvent` and dedupes against polling diffs
  (`pushBuffer` id-scheme match). No animation fires without a real event
  or a real snapshot diff; first observation seeds the feed without
  invented "live" entries.

## 3. Agent Inspector (real sessions)

- Agent nodes → inspector drawer: current task, file claims, activity /
  messages / tasks / files tabs, send-message (Enter or button),
  interrupt with confirm. "Open full session in Harness viewer" reuses
  `ctx.get('sessions').open(sessionId)` — no reimplemented viewer.

## 4. Animations ← events

- Status pulse (thinking/working), message/finding/plan particles travel
  between real node positions (`--dx/--dy` CSS vars), dependency-release
  flash on pending tasks, progress fill transitions. All disabled under
  `prefers-reduced-motion`; Escape closes the inspector; nodes are
  focusable buttons with aria labels.

## 5. Human controls

- Plan review banner (Approve / Reject-with-feedback), blocker banner,
  open review findings banner, team-completed banner; POST actions:
  message, plan approve/reject, interrupt, member remove, pause/resume
  (actor = team lead via the route).

## 6. Tests

- `node tests/run-in-process.mjs` → **61/61 pass** (47 core + 14 UI logic).
- `scripts/preflight-host.mjs` runs the generated dynamic host body against
  stubs AND compiles all 36 tools through the real `@deepseek-ai/dsh-tools`
  `defineTool` (the exact sandbox compile) — ALL CHECKS PASSED.
- Static boot verification (`dsh --profile web --port 3299`): storage
  domain, 36 tools registered (raw-schema dialect), routes + SSE live
  (`GET /agent-teams/teams` → `[]`); the boot manifest includes the client
  entry `/plugins/dsh-agent-teams/client.js`.
- Live session (this GUI, port 3080): pkg-8 running, `/agent-teams/teams`
  → 200, `/agent-teams/stream` opens, error/404 routes behave.

## 7. Tool-schema dual dialect (a real harness constraint found here)

- The static registry validates `parameters`/`output.schema` as **raw JSON
  schema** (`required` arrays), while the dynamic sandbox's
  `harness.defineTool` compiles them through the **ParameterSchemaSpec DSL
  + value-schema DSL** (per-property `required: true`, open implicit root,
  no `required` arrays in `oneOf` branches). `ToolsDeps.rawSchemas` selects
  the dialect; both paths are compile-verified.

## 8. Limitations (honest)

- The **dynamic session instance uses an in-memory store** — teams reset
  when the package updates or the process restarts. The durable `agent_teams`
  storage domain lives in the static bundle and activates when the web app
  restarts (its host half crashed at this process's boot on a missing
  `schemastery` dependency, since fixed in `package.json` + installed).
- The dynamic sandbox cannot `ctx.emit`; its events go straight to the SSE
  broadcaster, so other plugins in this process do not observe
  `agent-teams/*` events from the dynamic instance. The static bundle emits
  through the real Cordis `ctx.emit`.
- The Command Center opens the first team (`teams[0]`); multi-team selection
  in the UI is a future refinement.
