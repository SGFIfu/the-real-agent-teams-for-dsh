/**
 * User-facing Agent Teams copy. Runtime identifiers and event payloads stay
 * untouched; only presentation text is localized or customized here.
 */
export type UiLanguage = 'zh-CN' | 'en-US';
export interface UiLabels {
    readonly productName: string;
    readonly agentTeams: string;
    readonly focusMode: string;
    readonly workspaceMode: string;
    readonly overview: string;
    readonly sessions: string;
    readonly settings: string;
    readonly teamActivity: string;
    readonly teamSummary: string;
    readonly membersDelegation: string;
    readonly livePreview: string;
    readonly captain: string;
    readonly started: string;
    readonly elapsed: string;
    readonly openInInspector: string;
    readonly teamRoster: string;
    readonly status: string;
    readonly priority: string;
    readonly result: string;
    readonly noEvents: string;
    readonly noCurrentTask: string;
    readonly overallProgress: string;
    readonly members: string;
    readonly activity: string;
    readonly dependencies: string;
    readonly customizeLabels: string;
    readonly expandWorkspace: string;
    readonly collapsePanel: string;
    readonly openInspector: string;
    readonly messageTeam: string;
    readonly liveSession: string;
    readonly currentTask: string;
    readonly files: string;
    readonly send: string;
    readonly interrupt: string;
    readonly cancel: string;
    readonly allActivity: string;
    readonly tasks: string;
    readonly messages: string;
    readonly agents: string;
    readonly reviews: string;
    readonly noTasks: string;
    readonly reconnecting: string;
    readonly waitingDependencies: string;
    readonly working: string;
    readonly waiting: string;
    readonly reviewing: string;
    readonly completed: string;
    readonly noTeams: string;
    readonly teamNotFound: string;
    readonly errorBoundaryTitle: string;
    readonly errorBoundaryMessage: string;
    readonly errorBoundaryRetry: string;
    readonly errorBoundaryDetails: string;
}
export type UiLabelOverrides = Partial<Record<keyof UiLabels, string>>;
export type UiLabelOverridesByLanguage = Partial<Record<UiLanguage, UiLabelOverrides>>;
export declare function defaultLabels(language: UiLanguage): UiLabels;
/** Apply only non-empty custom labels so an accidental blank cannot erase UI. */
export declare function resolveLabels(language: UiLanguage, overrides?: UiLabelOverrides): UiLabels;
export declare function parseLanguage(value: unknown): UiLanguage;
export declare function parseOverrides(value: unknown): UiLabelOverrides;
/** Parse persisted per-language overrides while accepting the original flat format. */
export declare function parseOverridesByLanguage(value: unknown): UiLabelOverridesByLanguage;
