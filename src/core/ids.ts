/**
 * Stable id minting for team-owned records. Uses the platform UUID source
 * when available; falls back to a monotonic, random-salted counter so
 * no-model tests stay deterministic and collision-free per process.
 * @module dsh-agent-teams/core
 */
let counter = 0;

export function newId(prefix: string): string {
  counter += 1;
  const randomPart =
    typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : `${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  // Monotonic sequence keeps ids sortable as a tie-breaker for same-millisecond
  // timestamps (message timelines, task boards).
  return `${prefix}_${counter.toString(36).padStart(8, '0')}_${randomPart}`;
}
