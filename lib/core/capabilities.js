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
const READ_TOOLS = new Set(['read', 'glob', 'grep', 'find', 'ls', 'job_list']);
const WRITE_TOOLS = new Set(['write', 'edit', 'apply_patch']);
const COMMAND_TOOLS = new Set(['pwsh', 'shell', 'exec', 'run_command', 'terminal']);
function stringField(args, keys) {
    if (typeof args === 'string')
        return args;
    if (args === null || typeof args !== 'object')
        return undefined;
    const record = args;
    for (const key of keys)
        if (typeof record[key] === 'string' && record[key].trim() !== '')
            return record[key];
    return undefined;
}
function commandFrom(args) {
    return stringField(args, ['command', 'cmd', 'script', 'commandLine', 'input', 'text']);
}
function pathFrom(args) {
    return stringField(args, ['path', 'file', 'filename', 'target', 'filePath']);
}
function classifyCommand(command) {
    const normalized = command.trim().replaceAll('\\\\', '/');
    const workspace = undefined;
    if (/\bgit\s+(merge|push|reset|checkout|switch|rebase|branch\s+(-d|-D|--delete))/i.test(normalized)) {
        return { capability: 'git.commit.own-branch', command: normalized, workspace, protectedGitAction: normalized.match(/\bgit\s+([^\s]+)/i)?.[1] ?? 'mutation' };
    }
    if (/\bgit\s+(status|diff|log|show|rev-parse|branch)\b/i.test(normalized))
        return { capability: 'git.read', command: normalized, workspace };
    if (/\bgit\s+(add|commit)\b/i.test(normalized))
        return { capability: 'git.commit.own-branch', command: normalized, workspace };
    // File mutation through a shell is intentionally not an approved capability:
    // it cannot prove file-claim ownership. Workers must use the typed write/edit
    // tools, whose path is checked against the durable claim table.
    if (/(?:^|\s)(?:set-content|add-content|out-file|new-item|remove-item|move-item|copy-item|mkdir|md|del|rm|mv|cp)\b/i.test(normalized) || /(?:>|>>)/.test(normalized)) {
        return { capability: 'repo.write.owned', command: normalized, workspace, protectedGitAction: 'shell-file-mutation' };
    }
    if (/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|compile|typecheck|lint)\b|\b(?:tsc|cargo\s+build|go\s+build)\b/i.test(normalized))
        return { capability: 'process.build', command: normalized, workspace };
    if (/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|smoke)\b|\b(?:node|deno|bun)\s+[^\s]+(?:test|spec)\b|\b(?:vitest|jest|pytest|cargo\s+test|go\s+test|dotnet\s+test)\b|\b(?:invoke-restmethod|curl|wget)\b/i.test(normalized))
        return { capability: 'process.test', command: normalized, workspace };
    if (/\b(?:node|deno|bun)\s+[^\s]+\.(?:m?js|cjs|ts)\b/i.test(normalized))
        return { capability: 'process.test', command: normalized, workspace };
    // Read-only shell inspection remains auditable but does not grant write or
    // execution privileges.
    if (/\b(?:get-childitem|gci|ls|dir|cat|type|get-content|select-string|rg|grep|findstr|pwd|whoami)\b/i.test(normalized))
        return { capability: 'repo.read', command: normalized, workspace };
    return { capability: 'process.test', command: normalized, workspace, protectedGitAction: 'unapproved-command' };
}
/** Classify only host tools that can cross the repository/process boundary. */
export function classifyToolCapability(name, args) {
    if (READ_TOOLS.has(name))
        return { capability: 'repo.read', path: pathFrom(args), workspace: stringField(args, ['cwd', 'workdir', 'workspace']) };
    if (WRITE_TOOLS.has(name))
        return { capability: 'repo.write.owned', path: pathFrom(args), workspace: stringField(args, ['cwd', 'workdir', 'workspace']) };
    if (COMMAND_TOOLS.has(name))
        return classifyCommand(commandFrom(args) ?? '');
    return undefined;
}
export function capabilityAudit(input) {
    return { ...input, timestamp: input.timestamp ?? Date.now() };
}
export const capabilityInternals = {
    roleCapabilities: ROLE_CAPABILITIES,
    readTools: READ_TOOLS,
    writeTools: WRITE_TOOLS,
    commandTools: COMMAND_TOOLS,
    classifyCommand,
};
