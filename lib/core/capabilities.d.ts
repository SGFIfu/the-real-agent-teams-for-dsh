/**
 * Bounded, host-independent Agent capability policy.
 *
 * The policy is deliberately data-first: the host may enforce it at the tool
 * boundary, while the core can validate task eligibility and record decisions
 * without importing a shell, filesystem, or provider implementation.
 */
import type { AgentCapability, TeamMember } from './types.ts';
export declare function capabilitiesForRole(role: string): AgentCapability[];
export declare function normalizeCapabilities(values: readonly string[] | undefined, role: string): AgentCapability[];
export declare function hasCapabilities(member: Pick<TeamMember, 'capabilities'>, required: readonly string[] | undefined): boolean;
export interface ToolCapabilityAction {
    capability: AgentCapability;
    command?: string;
    path?: string;
    workspace?: string;
    /** A git mutation that must never be delegated to a worker. */
    protectedGitAction?: string;
}
export interface ToolCapabilityDecision {
    allowed: boolean;
    capability?: AgentCapability;
    command?: string;
    path?: string;
    workspace?: string;
    reason?: string;
}
declare function classifyCommand(command: string): ToolCapabilityAction;
/** Classify only host tools that can cross the repository/process boundary. */
export declare function classifyToolCapability(name: string, args: unknown): ToolCapabilityAction | undefined;
export interface CapabilityAuditInput {
    teamId: string;
    memberId?: string;
    sessionId: string;
    capability: string;
    allowed: boolean;
    command?: string;
    workspace?: string;
    timestamp?: number;
}
export declare function capabilityAudit(input: CapabilityAuditInput): CapabilityAuditInput & {
    timestamp: number;
};
export declare const capabilityInternals: {
    roleCapabilities: Record<string, readonly AgentCapability[]>;
    readTools: Set<string>;
    writeTools: Set<string>;
    commandTools: Set<string>;
    classifyCommand: typeof classifyCommand;
};
export {};
