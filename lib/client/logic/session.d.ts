/**
 * Privacy-safe projection of the Harness ConversationSnapshot.
 *
 * The Harness client runtime exposes typed ConversationNode/AssistantBlock
 * kinds. We intentionally project only public text/tool/result arms and never
 * pass the snapshot to the native trajectory viewer, whose product surface
 * includes reasoning details. The structural types here keep this plugin's
 * client bundle compatible with the host's injected runtime package.
 */
export type SafeSessionItemKind = 'user' | 'assistant' | 'tool-call' | 'tool-result' | 'report';
export interface SafeSessionItem {
    id: string;
    kind: SafeSessionItemKind;
    time?: number;
    text: string;
    name?: string;
    args?: string;
    error?: boolean;
}
export interface SafeSessionSnapshot {
    sessionId: string;
    running: boolean;
    openState?: string;
    items: SafeSessionItem[];
}
export interface SafeSubagentAddress {
    parentSessionId: string;
    childSessionId: string;
    mode: 'one-shot' | 'continuable';
}
/** Resolve the official direct-parent address from a loaded Harness catalog. */
export declare function subagentAddressFromCatalog(parentSessionId: string | undefined, childSessionId: string, entries: readonly unknown[] | undefined): SafeSubagentAddress | undefined;
/** Convert one official Harness ConversationSnapshot shape into public rows. */
export declare function projectVisibleSession(input: unknown): SafeSessionSnapshot;
