# LUM-330 · 通用实体 @ 提及系统 — 设计文档

**日期**: 2026-06-08
**任务**: LUM-330
**Mock**: [2026-06-08-editor-mentions-mock.html](./2026-06-08-editor-mentions-mock.html)

## 背景 / 现状

代码库里 @ 提及**已部分实现**(`@tiptap/extension-mention` + 自定义节点 + 下拉 UI + 通知链路),但存在一个已证实的生产 bug 和若干缺口。本任务在现有基础上**修 bug + 泛化重构 + 扩成五类实体 + 全面接入**。

### 已证实事实(亲自读码确认)

1. **🐛 通知正则 bug(生产级,静默失效)**
   - 节点渲染:`<span class="mention" data-id="user_xxx" data-mention-type="user">`([mention-with-type.ts](../../../lib/editor/nodes/mention-with-type.ts))
   - 服务端解析:`/data-type="mention"[^>]*data-id="([^"]+)"/g`([comment.service.ts:97](../../../lib/services/comment.service.ts)、[documentComment.service.ts:52](../../../lib/services/documentComment.service.ts))
   - `data-type="mention"` 在真实输出里**不存在**(基类那段加 `data-type` 的 renderHTML 被自定义节点整个覆盖)→ `mentionedIds` 恒为空 → 提前 return → **所有 @ 通知(任务评论 + 文档评论)都没发出去**。单测用手写假 HTML 所以一直绿。
   - 两个 service 各有一份**重复**的 `parseMentionedClerkIds`,同一个坏正则。

2. **🔌 多个编辑器面未接入** —— `DescriptionEditor` 始终启用 mention(`buildMentionSuggestion(members, tasks, …)`,默认 `members=[]`/`tasks=[]`),无开关 flag;「未接入」= 没传数据。
   - 文档正文 [DocumentEditorPage.tsx:674](../../../app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx) 没传 members/tasks。
   - New Task Modal、里程碑描述、项目描述、任务评论的「编辑/回复」路径缺 members 或 tasks。

3. **类型**:节点仅 `user` | `task`。无 sprint/project/milestone 类型。
   - 只有 `task-link` mark,**没有** sprint/project/milestone 链接节点。
   - **无统一搜索端点**。但 `useSprints`/`useProjects`/`useMilestones` 客户端查询已存在。
   - 任务节点经 `HTMLAttributes` **确实渲染了 `data-id`**(链接本身没问题)。
   - `@agent` 脚手架在但刻意禁用。

## 目标

一个**可扩展的通用实体 @ 系统**:输入 `@` 弹出分组下拉,可提及 **人 / 任务 / sprint / 项目 / 里程碑**,选中插入可点链接;只有 @人 触发通知。同时修复通知 bug、全面接入所有编辑器面。

## 关键决策(已与用户确认)

| 决策         | 结论                                                                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 分期         | **一锅端** —— 5 型 + bug + 全接入都在 LUM-330(用户接受 bug 修复随大功能一起上)                                                                                                                                            |
| 数据源       | **改进版混合** —— 人走客户端缓存即时过滤;任务/sprint/项目/里程碑走统一 `mention-search` 服务端端点异步查(原因:sprint 无 workspace 级客户端缓存,只有 `useSprintsForTeam(teamId)` 按团队查,文档/里程碑等面无 teamId 上下文) |
| @实体语义    | **仅链接,不通知** —— 解析器只提取 `data-mention-type="user"` 的 clerkId                                                                                                                                                   |
| @agent       | 维持禁用,范围外                                                                                                                                                                                                           |
| 历史漏发通知 | 不回填,只保证今后正确                                                                                                                                                                                                     |

## 架构

### 1. 节点泛化 — `lib/editor/nodes/mention-with-type.ts`

- `mentionType` 扩成 `user | task | sprint | project | milestone`。
- 属性:`data-id`、`data-mention-type`、`data-href`(链接目标)、label;`mentionTitle`/`mentionStatus` 保留(任务用)。
- `renderMentionHTML` 泛化:渲染可点元素,带 `data-id` / `data-mention-type` / `data-href`,class `mention mention-<type>`;人显示 `@label`,实体显示 label(+ 任务标题副信息)。
- 点击导航复用 TaskLink 模式;编辑器 + RichTextViewer 均可点。
- `renderMentionText` 补全新类型。

### 2. suggestion / list 泛化

- `MentionItem` 判别联合扩到 5 kind,统一形状 `{ kind, id, label, sublabel?, icon, href }`,每种实体一个 mapper。
- `buildMentionSuggestion(sources, …)` 吃**一个** `sources`:人内存匹配(即时)+ `searchEntities(query)` 异步回调(debounce,结果回填 tasks/sprints/projects/milestones 分区)。
- `MentionList` 按 kind 通用渲染,分组 **People / Tasks / Sprints / Projects / Milestones**;实体区有「搜索中…」加载态、无匹配空态。键盘导航已对 items 数组通用。
- 加类型 = 加一个 source mapper + 渲染 token,不改旧分支(OCP)。

### 3. 数据源(改进版混合 — 统一搜索端点)

- **新 hook** `useMentionSources()`(`app/workspace/[workspaceUrl]/hooks/`):返回**单一** `mentionSources` prop,内含:
  - `members: MentionItem[]` —— 从现有 `useMembers` 客户端缓存映射,即时过滤(人最常 @,且 workspace 级已加载)。
  - `searchEntities(query): Promise<MentionItem[]>` —— 调统一搜索端点,debounce,返回 tasks+sprints+projects+milestones 的混合候选。
- **新统一端点** `GET /api/workspaces/mention-search?q=&limit=`:严格分层 Route → Service → Repository。Clerk auth(`requireIdentity`)解析 `workspaceId`,Zod 校验 query。Service 并行查四类实体,各 Prisma `select` 精简字段(task: `id/number/title/status/team.identifier`;sprint: `id/number/name/status`;project: `id/name`;milestone: `id/name/slug`),各取前 N,映射成带 `href` 的 `MentionItem`。`lib/api-client/` 封装 fetch。
- 为何不用纯客户端缓存:sprint 无 workspace 级缓存(只有 `useSprintsForTeam(teamId)`),且文档/里程碑等面无 teamId 上下文 → 统一端点既解决该问题,又让每个编辑器面只需 `members + searchEntities` 一个 prop,全站一致。

### 4. 通知解析器(修 #1/#5)— 新 `lib/editor/parse-mentions.ts`

- 纯函数 `parseMentionedUserClerkIds(html, authorClerkId): string[]`:
  - 顺序无关地遍历每个 mention 元素,读 `data-mention-type`(默认 `user`)与 `data-id`;
  - **只**在 type=user 时收集 `data-id`(=clerkId);
  - 排除作者、`__agent__`;去重。
- `comment.service.ts` 与 `documentComment.service.ts` 改用它,删两份重复正则。
- 这同时从根上消除 #5「拿 taskId 当 clerkId 查」的误报。

### 5. 全面接入

统一传 `mentionSources`:文档正文、New Task Modal、里程碑描述、项目描述、任务评论(新建/编辑/回复)、文档评论。

### 6. i18n

新增字符串:`mention.sprints` / `mention.projects` / `mention.milestones`(分组头)、`mention.searching`(加载态)、空态文案(若新增)。`npm run i18n:sync` 后**补齐全 16 locale 真翻译**(替换 `[TODO:…]` 占位)。

## 数据流

编辑器渲染 mention 元素(带 `data-id` + `data-mention-type` + `data-href`)→ 存为 HTML → 评论/文档评论创建时,service 调共享解析器 → user clerkId → member 查找 → inbox + Slack 通知。下游不变,只修对解析器、接上数据源。

## 错误处理

- 解析器纯函数、不抛、返回 `[]`。
- `mentionSources` 空 / 无匹配 → 下拉显示空态(现有行为延续)。
- 任务搜索端点失败 → 任务分区静默退化为空,其余四类不受影响。

## 测试

- **解析器单测(核心回归)**:输入用真实 `renderMentionHTML(...)` 全 5 型的输出(不是手写 HTML),验证只有 user 出 id、task/sprint/project/milestone 被忽略、自我 @ 与 `__agent__` 排除、重复去重。——关掉「假 HTML 一直绿」的根因。
- `useMentionSources` 映射测试。
- `buildMentionSuggestion` 各 kind 构建测试。
- `mention-search` service / repository 测试(四类实体 `select` 字段、各取前 N、映射 href)。
- `MentionList` 各 kind 渲染测试(jsdom;注意 Radix 在 jsdom 不可开,走受控断言)。
- **现有 service 测试改写**:它们用假的 `data-type="mention"` HTML——那种格式真实环境不产生,必须换成真实属性输出,否则测了不存在的格式。
- 验证门:`npx tsc --noEmit`、`npm test`、`npm run i18n:check`、`npm run lint:tokens`、`npm run build`(唯一 CI gate 是 Vercel build)。

## 范围外

- `@agent` 提及(维持禁用)。
- 实体 mention 通知任何人(已定:仅链接)。
- 历史漏发通知回填。
- 统一全局搜索(只为 mention 加任务搜索端点,不做跨实体大搜索)。

## 涉及文件(预估)

- 改:`lib/editor/nodes/mention-with-type.ts`、`app/workspace/[workspaceUrl]/components/mention-suggestion.ts`、`MentionList.tsx`、`DescriptionEditor.tsx`、`comment.service.ts`、`documentComment.service.ts`、各接入面组件、16 个 locale json。
- 新增:`lib/editor/parse-mentions.ts`、`app/workspace/[workspaceUrl]/hooks/useMentionSources.ts`、统一 mention-search route/service/repository/api-client(`app/api/workspaces/mention-search/route.ts`、`lib/services/mention-search.service.ts`、`lib/api-client/` 封装)、对应测试。
- 无 schema 变更、无新增 npm 依赖(`@tiptap/extension-mention`/`suggestion` 已装;图标用现有 lucide / lobehub)。
