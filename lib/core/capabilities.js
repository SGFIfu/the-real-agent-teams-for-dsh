const ROLE_CAPABILITIES = {
    architect: ['repo.read', 'review.verify'],
    researcher: ['repo.read'],
    backend: ['repo.read', 'repo.write.owned', 'process.test', 'process.build', 'git.read', 'git.commit.own-branch'],
    frontend: ['repo.read', 'repo.write.owned', 'process.test', 'process.build', 'git.read', 'git.commit.own-branch'],
    implementer: ['repo.read', 'repo.write.owned', 'process.test', 'process.build', 'git.read', 'git.commit.own-branch'],
    tester: ['repo.read', 'repo.write.owned', 'process.test', 'process.build', 'git.read', 'git.commit.own-branch'],
    reviewer: ['repo.read', 'process.test', 'process.build', 'git.read', 'review.verify'],
    devops: ['repo.read', 'repo.write.owned', 'process.test', 'process.build', 'git.read', 'git.commit.own-branch'],
};
export function capabilitiesForRole(role) {
    return [...(ROLE_CAPABILITIES[role.toLowerCase()] ?? ROLE_CAPABILITIES.implementer)];
}
export function normalizeCapabilities(values, role) {
    const defaults = capabilitiesForRole(role);
    const requested = values?.filter((value) => (['repo.read', 'repo.write.owned', 'process.test', 'process.build', 'git.read', 'git.commit.own-branch', 'review.verify'].includes(value))) ?? [];
    return requested.length === 0 ? defaults : [...new Set(requested)];
}
export function hasCapabilities(member, required) {
    if (required === undefined || required.length === 0)
        return true;
    const available = new Set(member.capabilities ?? []);
    return required.every((capability) => available.has(capability));
}
export function capabilityAudit(input) {
    return { ...input, timestamp: input.timestamp ?? Date.now() };
}
export const capabilityInternals = {
    roleCapabilities: ROLE_CAPABILITIES,
};
