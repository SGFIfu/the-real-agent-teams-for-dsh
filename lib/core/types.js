/**
 * Core data model for the Agent Teams runtime.
 *
 * Deliberately free of any `@deepseek-ai/*` runtime import so the core stays
 * testable with plain Node and only `zod` as a dependency. The harness glue in
 * `src/harness/` maps these types onto the real DeepSeek Harness interfaces.
 * @module dsh-agent-teams/core
 */
export {};
