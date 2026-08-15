# HARNESS_COMPATIBILITY.md

dsh-agent-teams 兼容性检查报告（实现时实测，非记忆推测）。

## 版本与提交

| 项 | 值 |
|---|---|
| Harness version | `@deepseek-ai/dsh` **0.1.0-rc.6**（`dsh --version`） |
| 安装形态 | npx 缓存 checkout（无 .git，无 commit 可读）：`C:\Users\荣耀\AppData\Local\npm-cache\_npx\1e7f6d9597241db0` |
| Cordis | `@deepseek-ai/cordis` ^4.0.1 |
| Node | v24.16.0 |
| pnpm | 未安装（`dsh plugin` 依赖 pnpm；安装 profile 时需自备或手工布局） |
| OS | Windows（pwsh 会话） |

## 核对过的真实 API（以源码 `lib/types/*.d.ts` 为准）

### Subagent Runtime（`ctx.subagents`，`@deepseek-ai/dsh-subagent`）

- `startContinuable(spec: ContinuableStartSpec): Promise<ContinuableStart>`
  - `spec = { provider, label, request: { prompt: ContentBlock[], parent: Agent, agentOptions?, maxDepth?, toolFilter?, persona? }, signal }`
  - 返回 `{ childId: SessionId, messageId: MessageId }`
- `followup(parent: Agent, childId, content, { source, signal })` — `source: { kind: 'coordinator', form: 'relay', senderSessionId }`（仅 lead 直系父代理可投递）
- `reportFrom(child: Agent, content, { delivery: 'quiet' | 'wakeup', signal })`
- `interrupt(targetSessionId, authority: { kind: 'user', parentSessionId } | { kind: 'ancestor', agent })`
- `listChildren(parentSessionId)` / `listDescendants(rootSessionId)`
- Provider capability：`SubagentCapabilities { outputSchema, depthLimit, toolFilter, persona }` — 缺失 capability 时服务端直接拒绝（fail loud），插件不静默降级。

**插件用法**：teammate 一律 `startContinuable`（持久、可多轮）；对 teammate 的后续消息由 lead 经 `followup` 投递到原生 inbox；teammate 回传经 `reportFrom`。插件不创建任何第二套 agent/session 身份 —— `TeamMember.sessionId` 就是真实的 harness `SessionId`。

### Storage Domain（`ctx.storageDomain`，`@deepseek-ai/dsh-storage-domain`）

- `open(spec: DomainSpec): Promise<Domain<S>>`；`defineDomain({ name, version, tables, global? })`、`domainTable(zodSchema)`
- `Domain.table(name)` → `KvTable { get, entries, keys, put, delete, update }`
- **原子性**：`update(key, fn)` 在 domain 写链上执行同步 read-modify-write —— 原子认领任务直接建立在此原语上，无 get-then-put 竞态。
- web profile 已挂载 `storage` + `storage-json`（`root: dshHomePath('storages')`）+ `storage-domain`（`backend: json`）。插件打开 `agent_teams` domain，自动路由当前 backend（json/sqlite 均可）。

### Tools（`ctx.tools`，`@deepseek-ai/dsh-tools`）

- `register(definition: ToolDefinition): () => void`
- `ToolDefinition = { name, description, parameters: JSON Schema object, output: { schema, render(args, value) → ContentBlock[] }, execute(args, exec), timeoutMs?, isConcurrencySafe?, presentCall?, presentResult? }`
- `exec: ToolRunContext` 带 `exec.agent`（**身份来源**；模型传入的 sessionId 一律不可信，工具身份全部取自 `exec.agent.id`，缺失时回退 `ctx.agents.requireInitiator().id`）。

### System Prompt（`ctx.systemPrompt`，`@deepseek-ai/dsh-system-prompt`）

- `section({ name, order, text })`；order 约定：100–199 为工具引导（本插件用 150）。

### Commands（`ctx.commands`，`@deepseek-ai/dsh-commands`）

- `register({ name, description, recordInput?, handler(invocation) })`
- `CommandInvocation.agent` 是精确真实代理（`/team` 命令用真实身份，不经模型）。

### Web server（`ctx.webServer`，`@deepseek-ai/dsh-host-webserver`）

- `register({ kind: 'exact' | 'prefix', path, handler(req, res) })` — 插件注册 `/agent-teams`（前缀），供浏览器面板拉取快照。

### Events（宿主 Cordis 事件）

- 监听：`agent/status`（`{ agent, status: 'idle'|'running' }`）、`subagent/end`（settled child 信息）→ 映射 teammate 语义状态。
- 发布：`agent-teams/*`（17 个类型化事件，见 `src/harness/declare.ts`）。

### Client（浏览器端）

- `dsh.client` manifest：`{ "platform": "web", "inject": [<模块 id>] }` + `exports["./client"]`；node 半边 `dsh-client-modules` 扫描 loader 条目组成 `window.__DSH_BOOT__`。
- 客户端内建：`React.createElement/useState/useEffect`、`ctx.get('slots')`、`fetch`。
- UI 挂载点：`sidebar.footer.action`（list，id/order/label）——面板在侧栏底部 "Teams" 按钮上打开。
- 数据通道：宿主插件注册的 `/agent-teams/*` 路由（loopback）。未来升级路径：typert `@Remote` 服务（message-feedback 模式）。

### Bundle / profile 机制（`@deepseek-ai/dsh-app-boot`）

- bundle = package.json 声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`；patch 为顶层 YAML 数组的 loader patch 条目（`{ id, name?, insert?, ...overrides }`），按 profile 的 `dsh.profile.bundles` 顺序叠加。
- profile：`$DSH_HOME/profiles/<name>/package.json`；`dsh plugin --profile <name> add <pkg>` 转发给 pnpm 并自动 reconcile bundles 列表。
- web profile 模板：`["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]`。

## Known breaking changes / 差异（相对本提示词的假设）

1. **没有** `ctx.storageDomain` 的 `defineDomain()` 单独导出可供“另写 JSON/SQLite” —— 正确路径就是 domain 声明 + 路由 backend；插件已按此实现。
2. Tool `parameters` 是**纯 JSON Schema 对象**（非 zod），`output` 必填，且 `output.schema` 走**强制子集校验**：`const` 必须带 `type`（实测 `schema.oneOf[i].properties.ok.const requires type or oneOf` 注册失败）。
3. **Storage domain 名必须匹配 `/^[a-z][a-z0-9_]*$/`**（不允许连字符）→ 本插件 domain 名为 `agent_teams`（实测 `defineDomain` 加载即抛）。
4. **插件行 `inject` 决定激活时序**：`webServer` 不在 inject 列表时，插件先于 webserver 激活、`ctx.get('webServer')` 为 undefined、面板路由静默未注册（无报错）→ inject 必须包含全部时序依赖。
5. **`/api` 前缀被 API 网关占用**（webserver 前缀路由先注册先匹配）→ 面板数据路由用独立前缀 `/agent-teams`。
6. `send_message` 对非直系子代理投递受限 —— 团队消息的**原生投递只能由 lead 对直系子代**执行（`followup` 权限模型）；成员→成员消息先落持久 inbox，由 lead 中转（V1 文档化行为）。
7. web profile 将大多数模型工具行 disable 并移到 agent preset；因此 bundle 的宿主行注册**全局** `team_*` 工具（对所有会话可见），并另附可选 `agent-teams` preset 注入 lead 协议 persona。
8. `dsh plugin` 依赖 pnpm（本机未装）；手工 profile 布局已验证（见 VALIDATION.md）。
9. 客户端静态模块 `dsh.client.inject` 只应引用 wire 图内存在的模块 id（实测 `@deepseek-ai/dsh-client-runtime` 可注入）；React 来自运行期内建，若模块加载早于 slots 提供者，面板自动降级为 no-op 并在控制台告警。
10. 出树（workspace checkout）bundle 的运行时依赖需从其自身树可解析（Node ESM 向上查找）；profile 内 junction + 工作区级 junction 的布局已验证。

## UNSTABLE INTERNAL DEPENDENCY 标记

无。插件只使用上表列出的公开 Service 接口与导出；未 import 任何 `lib/*` 私有实现。
