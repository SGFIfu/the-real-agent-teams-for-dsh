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
export declare const inject: readonly ["slots"];
export declare function apply(ctx: any): void;
