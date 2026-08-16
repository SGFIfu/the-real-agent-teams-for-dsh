export interface AgentSpecInput {
    model?: string;
    modelProvider?: string;
    provider?: string;
}
export interface ResolvedAgentSpec {
    requestedModel?: string;
    requestedModelProvider?: string;
    resolvedModelProvider?: string;
    resolvedModel?: string;
    requestedProvider?: string;
    resolvedProvider: string;
    alias?: string;
    availableProviders: string[];
}
/**
 * Resolve a user-facing AgentSpec before any durable member is created.
 * A provider alias supplied in the provider field is accepted only as an
 * explicit compatibility path and is reported through alias.
 */
export declare function resolveAgentSpec(input: AgentSpecInput, options: {
    availableProviders: readonly string[];
    defaultProvider: string;
    defaultModel?: string;
}): ResolvedAgentSpec;
export declare const providerResolutionInternals: {
    aliases: Record<string, {
        model: string;
        provider: string;
    }>;
};
