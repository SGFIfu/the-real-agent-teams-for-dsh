/**
 * Bounded, host-independent Agent capability policy.
 *
 * The policy is deliberately data-first: the host may enforce it at the tool
 * boundary, while the core can validate task eligibility and record decisions
 * without importing a shell, filesystem, or provider implementation.
 */
import type { AgentCapability, TeamMember } from './types.ts';

const ROLE_CAPABILITIES: Record<string, readonly AgentCapability[]> = {
  architect: ['repo.read', 'review.verify'],
  researcher: ['repo.read'],
  backend: ['repo.read', 'repo.write.owned', 'process.test', 'process.build', 'git.read', 'git.commit.own-branch'],
  frontend: ['repo.read', 'repo.write.owned', 'process.test', 'process.build', 'git.read', 'git.commit.own-branch'],
  implementer: ['repo.read', 'repo.write.owned', 'process.test', 'process.build', 'git.read', 'git.commit.own-branch'],
  tester: ['repo.read', 'repo.write.owned', 'process.test', 'process.build', 'git.read', 'git.commit.own-branch'],
  reviewer: ['repo.read', 'process.test', 'process.build', 'git.read', 'review.verify'],
  devops: ['repo.read', 'repo.write.owned', 'process.test', 'process.build', 'git.read', 'git.commit.own-branch'],
};

export function capabilitiesForRole(role: string): AgentCapability[] {
  return [...(ROLE_CAPABILITIES[role.toLowerCase()] ?? ROLE_CAPABILITIES.implementer)];
}

export function normalizeCapabilities(values: readonly string[] | undefined, role: string): AgentCapability[] {
  const defaults = capabilitiesForRole(role);
  const requested = values?.filter((value): value is AgentCapability => (
    ['repo.read', 'repo.write.owned', 'process.test', 'process.build', 'git.read', 'git.commit.own-branch', 'review.verify'].includes(value)
  )) ?? [];
  return requested.length === 0 ? defaults : [...new Set(requested)];
}

export function hasCapabilities(member: Pick<TeamMember, 'capabilities'>, required: readonly string[] | undefined): boolean {
  if (required === undefined || required.length === 0) return true;
  const available = new Set(member.capabilities ?? []);
  return required.every((capability) => available.has(capability));
}

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

export function capabilityAudit(input: CapabilityAuditInput): CapabilityAuditInput & { timestamp: number } {
  return { ...input, timestamp: input.timestamp ?? Date.now() };
}

export const capabilityInternals = {
  roleCapabilities: ROLE_CAPABILITIES,
};
