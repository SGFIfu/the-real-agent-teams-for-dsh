# dsh-agent-teams Production Fixes Roadmap

**Generated**: 2026-08-18  
**Source**: PRODUCTION_AUDIT_REPORT.md  
**Target**: Production-ready release

---

## 📋 Complete Fix Inventory (35 Issues)

### 🔴 P0 - BLOCKER (Must Fix Before Any Production Use)

| ID | Issue | File(s) | Estimated Effort | Owner | Status |
|---|---|---|---|---|---|
| BLOCKER-001 | RuntimeEventLog sequence not atomic across processes | `src/core/runtime-events.ts` | 8h | TBD | PENDING |
| BLOCKER-002 | Silent error suppression in interrupt/wakeup paths | `src/core/service.ts:832-859, 706-715` | 4h | TBD | PENDING |
| BLOCKER-003 | Message retry has no expiration or circuit breaker | `src/core/service.ts:716-737` | 6h | TBD | PENDING |

**P0 Subtotal**: 18 hours (2.25 engineering days)

---

### 🟠 P1 - CRITICAL (High Priority - Production Incident Risk)

| ID | Issue | File(s) | Estimated Effort | Owner | Status |
|---|---|---|---|---|---|
| CRITICAL-001 | Competing status writers create inconsistent member state | `src/core/service.ts` (multiple locations) | 8h | TBD | PENDING |
| CRITICAL-002 | Wake retry timers leak memory on team deletion | `src/core/service.ts:wakeRetryTimers` | 4h | TBD | PENDING |
| CRITICAL-003 | Plan approval race: task owner released before status commit | `src/core/service.ts:approvePlan` | 6h | TBD | PENDING |
| CRITICAL-004 | Client bundle 179KB vs documented 80KB | `scripts/build-client-module.mjs`, `src/client.ts` | ~~12h~~ **RESOLVED** | Frontend Engineer | **DONE** |
| CRITICAL-005 | Web command routes have no real authentication boundary | `src/harness/command-route.ts` | 16h | TBD | PENDING |
| CRITICAL-006 | SSE reconnection loses events | `src/client.ts` (SSE handling) | 10h | TBD | PENDING |
| CRITICAL-007 | Frontend has no error boundaries | `src/client.ts` (React components) | 6h | TBD | PENDING |

**P1 Subtotal**: 62 hours (7.75 engineering days)

---

### 🟡 P2 - HIGH (Significant Reliability/UX Issues)

| ID | Issue | File(s) | Estimated Effort | Owner | Status |
|---|---|---|---|---|---|
| HIGH-001 | Service ready() recovery insufficient | `src/core/service.ts:177-187` | 6h | TBD | PENDING |
| HIGH-002 | No explicit state machine for member lifecycle | `src/core/service.ts` | 10h | TBD | PENDING |
| HIGH-003 | claimNext ignores blocked tasks | `src/core/service.ts:claimNext` | 4h | TBD | PENDING |
| HIGH-004 | Session termination doesn't clean up resources | `src/core/service.ts` | 6h | TBD | PENDING |
| HIGH-005 | Message ordering guarantees unclear | `src/core/service.ts` (messaging) | 8h | TBD | PENDING |
| HIGH-006 | Git workspace argv construction has injection risk | `src/harness/git-workspace.ts` | 6h | TBD | PENDING |
| HIGH-007 | Mobile responsive design fails | `src/client.ts` (CSS/layout) | 8h | TBD | PENDING |
| HIGH-008 | No loading/skeleton states | `src/client.ts` (UI components) | 6h | TBD | PENDING |
| HIGH-009 | Race: workspace recovery vs new lease requests | `src/core/workspace.ts` | 6h | TBD | PENDING |
| HIGH-010 | Incomplete error context in TeamError instances | `src/core/errors.ts` | 4h | TBD | PENDING |
| HIGH-011 | Member registration has no idempotency guard | `src/core/service.ts:registerMember` | 4h | TBD | PENDING |
| HIGH-012 | Snapshot projection can show stale task owners | `src/core/service.ts:snapshot` | 4h | TBD | PENDING |

**P2 Subtotal**: 72 hours (9 engineering days)

---

### 🔵 P3 - MEDIUM (Edge Cases, Workarounds Available)

| ID | Issue | File(s) | Estimated Effort | Owner | Status |
|---|---|---|---|---|---|
| MEDIUM-001 | Event sink abstraction incomplete | `src/core/service.ts` | 4h | TBD | PENDING |
| MEDIUM-002 | Multiple sources of truth for team state | Architecture-level | 8h | TBD | PENDING |
| MEDIUM-003 | Tight coupling between service and store | `src/core/service.ts` | 10h | TBD | PENDING |
| MEDIUM-004 | Duplicate message detection is best-effort | `src/core/service.ts` | 4h | TBD | PENDING |
| MEDIUM-005 | Test suite has no real multi-agent dogfood | `tests/` | 12h | TBD | PENDING |
| MEDIUM-006 | No chaos/fault injection testing | `tests/` | 8h | TBD | PENDING |
| MEDIUM-007 | Harness session privacy leak (Think blocks) | Host-level issue | 4h | TBD | PENDING |
| MEDIUM-008 | No automated frontend testing | `tests/` | 12h | TBD | PENDING |

**P3 Subtotal**: 62 hours (7.75 engineering days)

---

### ⚪ P4 - LOW (Quality of Life, Non-Critical)

| ID | Issue | File(s) | Estimated Effort | Owner | Status |
|---|---|---|---|---|---|
| LOW-001 | Service-Store tight coupling limits testability | Architecture | 8h | TBD | PENDING |
| LOW-002 | No explicit event vs state store separation | Architecture | 6h | TBD | PENDING |
| LOW-003 | Boundary condition test coverage gaps | `tests/` | 8h | TBD | PENDING |
| LOW-004 | Documentation inconsistencies | `docs/`, `README.md` | 4h | TBD | PENDING |
| LOW-005 | TypeScript strict mode not fully enabled | `tsconfig.json` | 4h | TBD | PENDING |

**P4 Subtotal**: 30 hours (3.75 engineering days)

---

## 📊 Summary Statistics

| Priority | Count | Est. Hours | Est. Days | % of Total |
|---|---|---|---|---|
| P0 (BLOCKER) | 3 | 18 | 2.25 | 7.4% |
| P1 (CRITICAL) | 7 | 62 | 7.75 | 25.5% |
| P2 (HIGH) | 12 | 72 | 9.00 | 29.6% |
| P3 (MEDIUM) | 8 | 62 | 7.75 | 25.5% |
| P4 (LOW) | 5 | 30 | 3.75 | 12.3% |
| **TOTAL** | **35** | **244** | **30.5** | **100%** |

---

## 🎯 Phased Execution Plan

### Phase 1: Critical Path (P0) - Week 1
**Goal**: Eliminate BLOCKER issues, make system testable

- ✅ BLOCKER-001: RuntimeEventLog atomic sequence
- ✅ BLOCKER-002: Error handling in wakeup paths
- ✅ BLOCKER-003: Message retry with TTL

**Deliverable**: System can run end-to-end without silent failures

---

### Phase 2: Reliability Hardening (P1) - Week 2-3
**Goal**: Resolve production incident risks

- ✅ CRITICAL-001-003: State consistency fixes
- ✅ CRITICAL-004: Bundle optimization
- ✅ CRITICAL-005-007: Frontend reliability

**Deliverable**: System stable under normal production load

---

### Phase 3: Quality & Resilience (P2) - Week 4-5
**Goal**: Handle edge cases and failure scenarios

- ✅ HIGH-001-012: All HIGH priority issues
- ✅ Enhanced recovery logic
- ✅ Resource cleanup

**Deliverable**: System handles failures gracefully

---

### Phase 4: Polish & Testing (P3-P4) - Week 6
**Goal**: Production-grade quality

- ✅ MEDIUM issues
- ✅ Chaos testing
- ✅ Documentation updates
- ✅ LOW priority improvements

**Deliverable**: Production-ready release candidate

---

## 🔧 Technical Approach by Issue Type

### Concurrency Issues (BLOCKER-001, CRITICAL-001, CRITICAL-003)
**Approach**: 
1. Introduce distributed locking or atomic operations
2. Use optimistic concurrency with version checks
3. Serialize critical sections explicitly

### Resource Leaks (BLOCKER-002, CRITICAL-002, HIGH-004)
**Approach**:
1. Implement comprehensive cleanup in stop/delete paths
2. Add resource tracking and automatic disposal
3. Use WeakMap where appropriate

### Frontend Issues (CRITICAL-004, 006, 007, HIGH-007, 008)
**Approach**:
1. Code splitting and lazy loading for bundle size
2. Implement React Error Boundaries
3. Add reconnection logic with event replay
4. Responsive CSS with proper breakpoints

### Security Issues (CRITICAL-005, HIGH-006, MEDIUM-007)
**Approach**:
1. Add proper authentication middleware
2. Sanitize all Git command arguments
3. Enhanced privacy filtering

### Testing Gaps (MEDIUM-005, 006, 008, LOW-003)
**Approach**:
1. Add end-to-end dogfood test
2. Implement chaos testing framework
3. Add Playwright for frontend
4. Expand boundary condition coverage

---

## 🎬 Team Structure Recommendation

### Roles Needed

1. **Lead Engineer** - Overall coordination, architecture decisions
2. **Backend Specialist** - Service layer, concurrency, state management
3. **Frontend Specialist** - Client bundle, React, SSE handling
4. **Security Specialist** - Authentication, injection prevention
5. **QA Engineer** - Test expansion, chaos testing, validation
6. **Reviewer** - Code review, regression prevention

---

## 📈 Success Criteria

### Phase 1 Complete (P0)
- [ ] All BLOCKER issues resolved
- [ ] No silent error suppression
- [ ] End-to-end test completes without crashes

### Phase 2 Complete (P1)
- [ ] All CRITICAL issues resolved
- [ ] Client bundle < 100KB
- [ ] Authentication boundary implemented
- [ ] Frontend error boundaries working

### Phase 3 Complete (P2)
- [ ] All HIGH issues resolved
- [ ] State machine explicitly defined
- [ ] Resource cleanup verified
- [ ] Recovery logic tested

### Final Production Readiness
- [ ] All P0-P2 issues resolved
- [ ] P3 issues at least 50% resolved
- [ ] Chaos testing passes
- [ ] Real multi-agent dogfood succeeds
- [ ] Documentation updated
- [ ] Monitoring ready

---

## 📝 Notes

- Estimates are conservative; actual effort may vary ±30%
- Some issues may have overlapping fixes
- Architectural refactors (MEDIUM-002, 003) may touch multiple issues
- Frontend work may benefit from parallel execution
- Security review should be ongoing throughout

---

**Next Step**: Create Agent Team with assigned roles and task dependencies
