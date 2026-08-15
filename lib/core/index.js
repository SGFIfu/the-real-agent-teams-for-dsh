/**
 * Core public surface. Everything the harness glue needs, nothing Cordis.
 * @module dsh-agent-teams/core
 */
export * from "./types.js";
export * from "./errors.js";
export * from "./events.js";
export * from "./ids.js";
export * from "./schemas.js";
export * from "./store.js";
export * from "./prompts.js";
export { AgentTeamsService } from "./service.js";
