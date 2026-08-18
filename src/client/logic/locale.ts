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

const ZH_CN: UiLabels = {
  productName:'DSH 真正的 Agent Teams',
  agentTeams:'Agent Teams',
  focusMode:'专注模式',
  workspaceMode:'团队工作台',
  overview:'总览',
  sessions:'会话',
  settings:'设置',
  teamActivity:'团队活动',
  teamSummary:'团队概览',
  membersDelegation:'成员 / 分工',
  livePreview:'实时会话预览',
  captain:'队长',
  started:'开始于',
  elapsed:'已运行',
  openInInspector:'在 Inspector 中打开',
  teamRoster:'团队成员',
  status:'状态',
  priority:'优先级',
  result:'结果',
  noEvents:'暂无可观察事件',
  noCurrentTask:'暂无当前任务',
  overallProgress:'总进度',
  members:'成员',
  activity:'活动',
  dependencies:'任务依赖',
  customizeLabels:'自定义文案',
  expandWorkspace:'展开工作台',
  collapsePanel:'收起面板',
  openInspector:'打开 Inspector',
  messageTeam:'给团队发消息',
  liveSession:'实时 Session',
  currentTask:'当前任务',
  files:'文件',
  send:'发送',
  interrupt:'中断 Agent',
  cancel:'取消',
  allActivity:'全部',
  tasks:'任务',
  messages:'消息',
  agents:'成员',
  reviews:'审查',
  noTasks:'暂无任务',
  reconnecting:'正在重连…',
  waitingDependencies:'等待依赖',
  working:'工作中',
  waiting:'等待中',
  reviewing:'审查中',
  completed:'已完成',
  noTeams:'暂无团队活动',
  teamNotFound:'找不到这个 Team',
  errorBoundaryTitle:'UI 错误',
  errorBoundaryMessage:'组件渲染时发生错误。错误已记录到控制台。',
  errorBoundaryRetry:'重试',
  errorBoundaryDetails:'错误详情',
};

const EN_US: UiLabels = {
  productName:'The Real Agent Teams for DSH',
  agentTeams:'Agent Teams',
  focusMode:'Focus',
  workspaceMode:'Workspace',
  overview:'Overview',
  sessions:'Sessions',
  settings:'Settings',
  teamActivity:'Team Activity',
  teamSummary:'Team Summary',
  membersDelegation:'Members & Delegation',
  livePreview:'Live Session Preview',
  captain:'Captain',
  started:'Started',
  elapsed:'Elapsed',
  openInInspector:'Open in Inspector',
  teamRoster:'Team roster',
  status:'Status',
  priority:'Priority',
  result:'Result',
  noEvents:'No observable events yet',
  noCurrentTask:'No current task',
  overallProgress:'Overall Progress',
  members:'Members',
  activity:'Activity',
  dependencies:'Dependencies',
  customizeLabels:'Customize labels',
  expandWorkspace:'Expand workspace',
  collapsePanel:'Collapse panel',
  openInspector:'Open inspector',
  messageTeam:'Message team',
  liveSession:'Live session',
  currentTask:'Current task',
  files:'Files',
  send:'Send',
  interrupt:'Interrupt agent',
  cancel:'Cancel',
  allActivity:'All',
  tasks:'Tasks',
  messages:'Messages',
  agents:'Agents',
  reviews:'Reviews',
  noTasks:'No tasks yet',
  reconnecting:'Reconnecting…',
  waitingDependencies:'Waiting for dependencies',
  working:'Working',
  waiting:'Waiting',
  reviewing:'Reviewing',
  completed:'Completed',
  noTeams:'No team activity yet',
  teamNotFound:'Team not found',
  errorBoundaryTitle:'UI Error Detected',
  errorBoundaryMessage:'An error occurred while rendering this component. The error has been logged to the console.',
  errorBoundaryRetry:'Retry',
  errorBoundaryDetails:'Error Details',
};

export function defaultLabels(language: UiLanguage): UiLabels {
  return language === 'zh-CN' ? ZH_CN : EN_US;
}

/** Apply only non-empty custom labels so an accidental blank cannot erase UI. */
export function resolveLabels(language: UiLanguage, overrides: UiLabelOverrides = {}): UiLabels {
  const base = defaultLabels(language);
  const result = { ...base } as Record<keyof UiLabels, string>;
  for (const key of Object.keys(base) as Array<keyof UiLabels>) {
    const value = overrides[key];
    if (typeof value === 'string' && value.trim() !== '') result[key] = value.trim();
  }
  return result;
}

export function parseLanguage(value: unknown): UiLanguage {
  return value === 'en-US' ? 'en-US' :'zh-CN';
}

export function parseOverrides(value: unknown): UiLabelOverrides {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: UiLabelOverrides = {};
  for (const key of Object.keys(ZH_CN) as Array<keyof UiLabels>) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === 'string' && candidate.length <= 80) result[key] = candidate;
  }
  return result;
}

/** Parse persisted per-language overrides while accepting the original flat format. */
export function parseOverridesByLanguage(value: unknown): UiLabelOverridesByLanguage {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const hasLanguageBuckets = Object.prototype.hasOwnProperty.call(source, 'zh-CN') || Object.prototype.hasOwnProperty.call(source, 'en-US');
  if (!hasLanguageBuckets) {
    const legacy = parseOverrides(value);
    return Object.keys(legacy).length === 0 ? {} : { 'zh-CN': legacy, 'en-US': legacy };
  }
  return {
    'zh-CN': parseOverrides(source['zh-CN']),
    'en-US': parseOverrides(source['en-US']),
  };
}
