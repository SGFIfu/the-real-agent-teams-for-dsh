/**
 * Core public surface. Everything the harness glue needs, nothing Cordis.
 * @module dsh-agent-teams/core
 */
export * from './types.ts';
export * from './errors.ts';
export * from './events.ts';
export * from './ids.ts';
export * from './schemas.ts';
export * from './store.ts';
export * from './prompts.ts';
export * from './review.ts';
export * from './runtime-events.ts';
export { AgentTeamsService } from './service.ts';
export type { ServiceDeps } from './service.ts';
