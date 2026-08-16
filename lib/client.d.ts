export interface Bridge {
    listTeams(): Promise<Array<{
        id: string;
        name?: string;
        goal?: string;
        status?: string;
    }>>;
    snapshot(teamId: string): Promise<any>;
    subscribe(cb: (event: any) => void, state?: (state: 'connected' | 'reconnecting') => void): () => void;
    sendMessage(teamId: string, toSessionId: string | undefined, body: string): Promise<any>;
    approvePlan(teamId: string, planId: string): Promise<any>;
    rejectPlan(teamId: string, planId: string, feedback: string): Promise<any>;
    interrupt(teamId: string, sessionId: string): Promise<any>;
    removeMember(teamId: string, memberId: string): Promise<any>;
}
type SessionBindingLike = {
    session: {
        getSnapshot(): unknown;
        subscribe(listener: () => void): () => void;
    };
};
/**
 * The web session service has had two catalog shapes across Harness builds:
 * a reactive `list.getSnapshot()` facade and a direct `listChildren()` method.
 * Keep the compatibility code here, at the client boundary, and never fall
 * back to the host trajectory viewer (`sessions.open()`), which is not a
 * privacy-safe surface for Agent Teams.
 */
export declare function resolvePublicSubagentAddress(sessions: unknown, parentSessionId: string | undefined, childSessionId: string): Promise<unknown>;
/** Open only the explicit public child-session surface, never the host viewer. */
export declare function openPublicSubagent(sessions: unknown, address: unknown): Promise<boolean>;
/** Resolve a retained real binding by the persisted Harness session id. */
export declare function sessionBindingFor(sessions: unknown, sessionId: string): SessionBindingLike | undefined;
/** A successful delivery is the only message event allowed to fly. */
export declare function messageDeliverySucceeded(message: {
    deliveryState?: string;
} | undefined): boolean;
export declare function isFailedMessageFrame(frame: unknown): boolean;
export declare function shouldAnimateMessage(eventId: string, messages: readonly {
    id: string;
    deliveryState?: string;
}[], frame?: unknown): boolean;
export declare const inject: readonly ["slots"];
export declare function apply(ctx: any): void;
export {};
