/**
 * Model/provider separation at the native subagent boundary.
 *
 * The Harness subagent registry owns transport providers (spawn, fork, ...).
 * Agent model identity is a separate child AgentOptions field. Aliases are
 * explicit and returned in the resolution evidence.
 */
import { teamError } from "../core/errors.js";
const MODEL_ALIASES = {
    'v4-flash': { model: 'deepseek-v4-flash', provider: 'spawn' },
};
function nonEmpty(value) {
    return value === undefined || value.trim() === '' ? undefined : value.trim();
}
/**
 * Resolve a user-facing AgentSpec before any durable member is created.
 * A provider alias supplied in the provider field is accepted only as an
 * explicit compatibility path and is reported through alias.
 */
export function resolveAgentSpec(input, options) {
    const requestedModel = nonEmpty(input.model);
    const requestedModelProvider = nonEmpty(input.modelProvider);
    const requestedProvider = nonEmpty(input.provider);
    const providerAlias = requestedModel === undefined && requestedProvider !== undefined
        ? MODEL_ALIASES[requestedProvider]
        : undefined;
    const modelAlias = requestedModel === undefined ? undefined : MODEL_ALIASES[requestedModel];
    const aliasEntry = modelAlias ?? providerAlias;
    const alias = aliasEntry === undefined ? undefined : (modelAlias !== undefined ? requestedModel : requestedProvider);
    const resolvedModel = aliasEntry?.model ?? requestedModel ?? nonEmpty(options.defaultModel);
    const resolvedProvider = aliasEntry?.provider ?? requestedProvider ?? options.defaultProvider;
    const availableProviders = [...options.availableProviders];
    if (!availableProviders.includes(resolvedProvider)) {
        throw teamError('SUBAGENT_PROVIDER_NOT_FOUND', 'subagent provider ' + resolvedProvider + ' is not registered', {
            requestedModel,
            requestedModelProvider,
            resolvedModel,
            requestedProvider,
            resolvedProvider,
            availableProviders,
            alias,
        });
    }
    if (aliasEntry !== undefined && requestedProvider !== undefined && modelAlias !== undefined && requestedProvider !== aliasEntry.provider) {
        throw teamError('SUBAGENT_MODEL_PROVIDER_INCOMPATIBLE', 'model alias ' + alias + ' requires provider ' + aliasEntry.provider + ', not ' + requestedProvider, {
            requestedModel,
            requestedModelProvider,
            resolvedModel,
            requestedProvider,
            resolvedProvider,
            availableProviders,
            alias,
        });
    }
    return {
        requestedModel,
        requestedModelProvider,
        ...(requestedModelProvider === undefined ? {} : { resolvedModelProvider: requestedModelProvider }),
        resolvedModel,
        requestedProvider,
        resolvedProvider,
        ...(alias === undefined ? {} : { alias }),
        availableProviders,
    };
}
export const providerResolutionInternals = {
    aliases: MODEL_ALIASES,
};
