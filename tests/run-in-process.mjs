/**
 * In-process test driver: imports every compiled test module in ONE process
 * (the sandbox forbids child-process spawn, so `node --test`'s per-file
 * workers cannot run here). node:test executes all registered tests and
 * reflects failures in the exit code.
 */
await import('../lib/core/task.test.js');
await import('../lib/core/authorization.test.js');
await import('../lib/core/concurrency.test.js');
await import('../lib/core/dependencies.test.js');
await import('../lib/core/messaging.test.js');
await import('../lib/core/plans.test.js');
await import('../lib/core/file-claims.test.js');
await import('../lib/core/persistence.test.js');
await import('../lib/core/simulation.test.js');
await import('../lib/client/logic/control.test.js');
await import('../lib/client/logic/session.test.js');

// node:test flushes pending tests on exit; give the runner a tick to settle.
await new Promise((resolve) => setTimeout(resolve, 0));
