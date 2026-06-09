# LUM-332 — 只读视图统一渲染 mention(RichTextViewer 复用 mention 节点)

**Date:** 2026-06-08
**Branch:** `lumo/LUM-332-readonly-mention-rendering`
**Depends on:** LUM-330 (universal entity @-mentions, merged in PR #427)

## Problem

LUM-330 把编辑侧的 @ 提及统一到了单一 `MentionWithType` 节点 + `MentionList` 下拉,并接入所有可编辑面。但只读渲染器 `RichTextViewer` 用 `getBaseExtensions()`,而 `getBaseExtensions()` 不含 mention 节点(仅 `DescriptionEditor` 单独条件挂载 `MentionWithType.configure`)。

只读视图里存好的 mention HTML 因此退化:

- 实体 mention(`<a class="mention mention-task" data-href=...>`)→ 被通用 `Link` 扩展当普通链接渲染,丢 `mention-*` class / 图标 / chip 样式。
- 人 mention(`<span class="mention mention-user">@名字</span>`)→ 无扩展认领,退化成纯文本,丢高亮。

**目标:** 只读视图里的 mention 显示与编辑器一致(chip 样式 + 类型图标 + 实体可点)。

## Key facts (verified in code)

- `getBaseExtensions()` — `lib/editor/extensions.ts:26`。零参,返回 18 个扩展,**含** `Link`(`openOnClick:false, autolink:true`),**不含** mention 节点。
- `RichTextViewer` — `app/workspace/[workspaceUrl]/components/RichTextViewer.tsx`。`editable: false`,直接 `extensions: getBaseExtensions()`。
- `MentionWithType = Mention.extend(...)` — `lib/editor/nodes/mention-with-type.ts`。节点名 `'mention'`。`renderHTML` / `renderText` 已就绪;支持 5 类:`user`(span,不可点)+ `task` / `sprint` / `project` / `milestone`(anchor,带 `data-href`、可点)。
- **⚠️ 关键发现(实测确认):节点未覆写 `parseHTML`,继承 tiptap `Mention` 默认的 `span[data-type="mention"]`;而自定义 `renderHTML` 输出的 `<a class="mention mention-*">` / `<span class="mention mention-user">` 都不带 `data-type="mention"` → 存量 HTML 根本无法解析回 mention 节点。** 实测:即使节点挂载,user span 与 entity anchor 双双退化成纯文本。这也是 LUM-330 编辑器重载存量文档时 mention 退化的潜在 bug。**核心修复 = 给节点补 `parseHTML` 覆写**,viewer + editor 共同受益。
- CSS — `app/globals.css:317-369`,chip 样式、`mention-task` 状态图标、`a.mention { cursor: pointer }` 已就绪。**本任务不改 CSS。**
- `DescriptionEditor` — 在 `...getBaseExtensions()` 之后条件挂载 `MentionWithType.configure({ suggestion: buildMentionSuggestion(...) })`(仅当 `mentionSources` 存在)。
- 重复注册约束(tiptap 不能注册两个同名 `'mention'` 节点)**只在同一个 editor 实例内成立**。viewer 与 editor 是独立实例。
- tiptap `Mention` 默认会注册 suggestion 插件,但默认配置无 `render`,且 `editable:false` 下永不触发。

## Chosen approach: 基座参数化(Approach A)

单一 mention 节点由 `getBaseExtensions` 拥有,通过参数决定是否叠加 suggestion——保证任何 editor 实例内只存在一个 `'mention'` 节点,杜绝重复注册,同时让只读与可编辑共用同一渲染基座(单一来源)。

(评估过另两案:**Viewer 本地挂节点** 改动最小但 mention 知识不进共享基座、偏离任务措辞;**节点/下拉拆分** 职责最分离但需手接 Suggestion 插件的 command/node-name、回归风险最高。均不采用。)

### 1. 节点改动 — `lib/editor/nodes/mention-with-type.ts`

**(a) `parseHTML` 覆写(核心修复):** 让节点认领自身 `renderHTML` 实际产出的 DOM——`a.mention`(实体)与 `span.mention`(人):

```ts
parseHTML() {
  return [{ tag: 'a.mention' }, { tag: 'span.mention' }]
}
```

各 attribute 的 `parseHTML`(`data-id`→id、`data-label`→label、`data-mention-type`/`-title`/`-status`、`data-href`)在 `addAttributes` 中已就绪,无需改。**已用最小 schema(Document/Paragraph/Text + 真实 `Link.configure` + 本节点)实测:user span → `mention{type=user}`、entity anchor → `mention{type=task,href,status}` 全属性保留,而普通 `<a href>` 仍归 `Link` mark——Link 不抢 `a.mention`,本节点也不抢普通链接。原"Link vs mention 优先级"风险点据此关闭,无需调 `priority`。**

**(b) `addProseMirrorPlugins` 守卫:** suggestion 插件仅在配置了带 `render` 的真实 suggestion 时挂载:

```ts
addProseMirrorPlugins() {
  if (!this.options.suggestion?.render) return []
  return this.parent?.() ?? []
}
```

效果:同一节点既能作"纯渲染节点"(viewer / 无 suggestion),又能在配置后启用下拉。节点自身从此安全,任何调用方都不会误触发 tiptap 默认 suggestion(默认 suggestion 无 `render`)。

### 2. 基座参数化 — `lib/editor/extensions.ts`

```ts
export function getBaseExtensions(opts?: {
  mentionSuggestion?: Partial<SuggestionOptions>
}): Extensions {
  return [
    /* ...现有 18 个扩展不变... */
    opts?.mentionSuggestion
      ? MentionWithType.configure({ suggestion: opts.mentionSuggestion })
      : MentionWithType,
  ]
}
```

- **始终**含且**仅含一个** `'mention'` 节点。
- 无参 → 裸节点(守卫使其无 suggestion 插件),只做 parse/render。

### 3. 两个调用点

- **RichTextViewer**:`getBaseExtensions()` —— 不传参,自动得到裸 mention 节点,存量 HTML 渲染成 chip。
- **DescriptionEditor**:把现有的 `...getBaseExtensions()` + 条件 `MentionWithType.configure(...)` 改为

  ```ts
  ...getBaseExtensions(
    mentionSources
      ? { mentionSuggestion: buildMentionSuggestion(/* ...现有入参... */) }
      : undefined
  )
  ```

  行为等价(有 `mentionSources` 仍出下拉)。无 `mentionSources` 时编辑器现在也能正确渲染存量 mention(改善,非回归)。

### 4. 范围外(确认不动)

编辑侧逻辑、`buildMentionSuggestion`、`app/globals.css`、Prisma schema —— 均不改。`@agent` 仍禁用。无新增 i18n key(纯渲染)。

## Testing

- **parseHTML 往返(核心)**:用最小 schema(Document/Paragraph/Text + 真实 `Link.configure` + `MentionWithType`)`setContent` 喂存量 HTML,断言 user span → `mention{type=user}`、entity anchor → `mention{type=task,href,status}`(属性保留),且普通 `<a href>` 仍是带 `link` mark 的文本。**回归守卫**:不带 parseHTML 时这些 mention 退化成纯文本(记录现状,确认修复有效)。
- **节点守卫**:`MentionWithType`(无 suggestion 配置)→ `addProseMirrorPlugins` 返回 `[]`;配置带 `render` 的真实 suggestion → 返回非空。
- **基座**:`getBaseExtensions()` 恰含一个名为 `'mention'` 的节点;传 `mentionSuggestion` 时仍只有一个 `'mention'`(不重复)。
- **RichTextViewer**(jsdom 组件测,如需则补 `QueryClientProvider` 兜底):喂含 5 类 mention 的存量 HTML,断言:
  - 实体 → `a.mention-task` / `a.mention-project` 等 chip(非裸 `<a class="text-blue-500">` 链接);
  - 人 → `span.mention-user`(非纯文本);
  - `data-href` / 状态图标属性保留。
- **DescriptionEditor 不回归**:沿用现有 mention 下拉测试。
- 跨 `__tests__/` 与 `tests/` 两个测试根 grep mention 相关测试,全量 `npx jest` 兜底。

## Verification gate

- `npx tsc --noEmit`
- `npx jest`(mention 相关 + 两测试根)
- 必要时 `RichTextViewer` 的 jsdom 渲染断言

无 schema 变更,无 i18n 变更,无新依赖。
