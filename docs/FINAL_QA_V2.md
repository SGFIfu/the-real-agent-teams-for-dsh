# Final QA V2

Date: 2026-08-16

Scope: read-only final verification of the current `dsh-agent-teams` fork. No source code, tests, package files, generated artifacts, or runtime state were modified by this QA pass. The only file written by this agent is this report.

## Executive conclusion

Automated verification is green on the tested commit: typecheck passed, build passed, `npm test` passed all 99 tests in 16 suites, and the client bundle registration test passed. A later integration rerun on `b951e26` passed 103 tests in 17 suites after adding the shared contract suite and mounting production Workspace/Git ownership. The local Harness web process and the plugin asset endpoint also responded successfully.

This is not sufficient evidence for a full release qualification. No real Agent Team was created or mutated, no model-backed teammate sessions were exercised, and no browser interaction or browser-console inspection was performed. The result is therefore **AUTOMATED GREEN / RELEASE READINESS NOT ESTABLISHED** rather than a Qualified release.

## Repository and environment

- Repository: `C:\知识库\dsh-agent-teams`
- Branch under test: `integration/agent-teams-v2`
- Code commit under test: `293f961` (`test: execute review and workspace regression suites`)
- Current integration commit: `b951e26` (`workspace-service-integration`)
- Package: `dsh-agent-teams@0.1.0`
- Node: `v24.16.0`
- npm: `11.13.0`
- pnpm: `11.19.0` (not used for the required commands)
- OS: `Microsoft Windows NT 10.0.26200.0`
- Harness packages: `@deepseek-ai/dsh-agent`, `dsh-commands`, `dsh-host-webserver`, `dsh-session`, `dsh-subagent`, `dsh-system-prompt`, and `dsh-tools`, all `0.1.0-rc.6`
- Harness Cordis: `@deepseek-ai/cordis@4.0.1`
- Working tree before this report: clean

## Required command results

| Check | Command | Result | Actual evidence |
|---|---|---|---|
| Typecheck | `npm run typecheck` | PASS | `tsc -p tsconfig.json --noEmit`, exit code 0 |
| Build | `npm run build` | PASS | `tsc -p tsconfig.json && node scripts/build-client-module.mjs`; emitted `lib/client.js` at 86550 bytes; exit code 0 |
| Tests | `npm test` | PASS | 99 tests, 16 suites, 99 passed, 0 failed, exit code 0 |
| Client bundle | included in `npm test` | PASS | `client module bundle OK (C:\知识库\dsh-agent-teams\)` |
| Lint | inspected package scripts | NOT CONFIGURED | `package.json` has no `lint` script |

The build command temporarily rewrote the tracked generated client file as part of its normal operation. It was restored immediately; the worktree remained clean after validation.

## Client module registration

### Static and bundle evidence

`tests/client-module-bundle.mjs` asserts all of the following and passed:

- bundle starts with `window.__ModuleLoader__.load(`
- registration id is `dsh-agent-teams`
- registration factory is a function
- no top-level `import` or `export` remains
- exported `apply` is a function
- injected slot is `slots`

### Live read-only Harness smoke check

The running local Harness at `http://127.0.0.1:3080` was accessed only with GET requests:

- `GET /` returned HTTP 200 and the boot manifest listed `dsh-agent-teams` at `/plugins/dsh-agent-teams/client.js`.
- `GET /plugins/dsh-agent-teams/client.js` returned HTTP 200, `text/javascript`.
- A read-only marker check on that response returned: `status: 200`, `hasLoader: true`, `hasId: true`, `hasFactory: true`, `bytes: 86719`.

This proves delivery of the plugin entry and registration shape. It does not prove that a browser executed the module successfully or that the rendered UI is correct.

## Regression coverage

The current standard `npm test` driver imports the following suites and all passed:

| Area | Tests | Evidence |
|---|---:|---|
| Task lifecycle and authority | 19 | task lifecycle, service authority, member/session access, lead-only controls |
| Runtime event recovery | 5 | dedupe, public/internal projection, cursor pages, gap detection, serialization boundary |
| Atomic claiming | 4 | 50-way single-task race, 4 agents over 20 tasks, 50-way `claimNext`, dependency-aware concurrency |
| Dependencies and cycles | 6 | unresolved dependencies, DAG/diamond, self-cycle, 2-cycle, 3-cycle, cross-team dependency |
| Messaging | 7 | member-to-member, lead-to-member, broadcast, sender attribution, isolation, unknown target, ordering |
| Plans and hard guards | 7 | submit/approve, reject, requires-plan validation, non-lead approval, completion and file-claim guards |
| File claims | 7 | exact, directory, glob, disjoint glob, atomic batch, release authorization |
| Persistence | 2 | schema round-trip and restart continuation |
| Completion guard and snapshot | 5 | incomplete/blocked tasks, critical findings, optional tasks, snapshot, lead-only completion |
| Review lifecycle | 5 | independent reviewer, state transitions, same-team/author separation, findings, QA evidence |
| Workspace leases | 3 | path normalization, session binding, stale recovery, handoff, lease conflict |
| Git workspace adapter | 3 | fixed argv, traversal rejection, symlink escape rejection |
| No-model simulation | 1 | 20-task development team invariant simulation |
| UI control helpers | 17 | explicit team selection, DAG layout, status mapping, diffs, SSE mapping, buffering, activity, failed-delivery animation |
| Session privacy projection | 3 | visible assistant/tool data retained; typed reasoning blocks removed; public report filtering |
| Web command security boundary | 5 | missing capability, origin/loopback, team scoping, host caller hook, traversal/target/body validation |
| **Total** | **99** | **99 passed, 0 failed** |

### Contract-suite gate gap

`src/core/contracts.test.ts` exists and was independently executed from the compiled output:

- 4 tests
- 1 suite
- 4 passed, 0 failed

However, this suite is not imported by `tests/run-in-process.mjs`, so it is not part of the standard `npm test` gate. This is a test-gate coverage gap even though the currently observed standalone result is green.

## What was not executed

The following acceptance items were deliberately not run because this agent was restricted to read-only verification and must not fabricate live evidence:

- creating or mutating a real Tiny/Mini Notes Team
- real Lead, Architect, Backend, Frontend, Tester, and Reviewer Harness sessions
- persistent teammate identity across real continuable activations
- real self-claiming after a teammate completes work
- model-backed peer message delivery and receipt in target sessions
- real plan reject/revise/approve implementation flow
- real file conflict and handoff between live agents
- real reviewer finding → fix → re-review loop
- real completion guard calls against a live team
- browser rendering, browser console, visual UI inspection, responsive layouts, theme, reduced-motion, auto-follow, and live Inspector updates
- authenticated browser mutation checks, interrupt behavior, and cross-team authorization against a live Host instance
- real provider/model/token-efficiency qualification

The local tests use service-level stores, injected runtimes, pure UI adapters, and a no-model simulation. They are useful regression evidence, but they are not substitutes for the live Agent Team and browser acceptance protocol.

## Findings

### P1 — Full release qualification evidence is incomplete

The web process and client asset are healthy, but this QA run did not perform any live Agent Team mutation or browser session. The core runtime/UI acceptance invariants therefore remain unproven in the running Harness, despite green unit/in-process tests.

### P2 — Contract regression suite is outside the standard test gate

`contracts.test.ts` passes independently (4/4) but is omitted from `tests/run-in-process.mjs`. A future `npm test` could pass while schema/domain table registration regressions in that suite go undetected.

### P2 — No lint command is defined

There is no `lint` script in `package.json`, so lint qualification was not possible through the project’s declared scripts.

## Release readiness

**Conservative result: NOT READY FOR RELEASE QUALIFICATION.** The later 103/103 regression does not change this because this QA pass did not perform a funded live Agent Team or browser acceptance run.

The implementation is automated-test green and the live plugin entry is reachable and correctly shaped. A release claim still requires a separate authorized run of the real Agent Team and browser acceptance protocol; this report intentionally does not convert static/service-level evidence into a live PASS.
