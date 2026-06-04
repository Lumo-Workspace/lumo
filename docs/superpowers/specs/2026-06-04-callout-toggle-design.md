# LUM-221 — Callout 提示块 + Toggle 折叠块 设计文档

- **Task**: LUM-221
- **Milestone**: 文档编辑器优化（Tiptap 富文本编辑器整改）
- **Date**: 2026-06-04
- **Status**: Approved

## 背景与目标

对标飞书/Notion 高频块，当前 Tiptap 编辑器缺少两类常用块：

1. **Callout 提示块** — 带 emoji 图标 + 背景色的提示框。
2. **Toggle 折叠块** — 标题行 + 可折叠隐藏内容。

两者都接入斜杠命令（`lib/editor/slash-command.tsx`）与只读渲染（`RichTextViewer`）。

编辑器与只读视图共用 `getBaseExtensions()`（`lib/editor/extensions.ts`），因此节点的 NodeView 在两处自动复用——只读视图里读者同样能切换 Callout 类型、展开/收起 Toggle。

## 设计决策（已确认）

- **Callout 变体**：5 种 —— 💡 Info / ⚠️ Warning / ✅ Success / 📝 Note（中性灰）/ ❌ Error。
- **emoji**：每种变体固定 emoji，不支持自定义 emoji picker（YAGNI）。切「类型」时 emoji 与配色一起变。
- **切换交互**：点左侧 emoji → 带文字标签的下拉菜单（shadcn `DropdownMenu`），列出 5 种类型。
- **Toggle 标题**：用子节点 `toggleSummary`（行内富文本：加粗 / @提及 / 行内代码）+ `toggleContent`（块内容）。对应标准 `<details>/<summary>` 结构。
- **Toggle 只读行为**：展开/收起状态（`open` 属性）持久化进文档 JSON——作者保存时的状态即读者看到的初始状态，读者仍可自行展开/收起。
- **i18n 范围**：新增的 Callout/Toggle 斜杠菜单文案 + NodeView 内全部新用户可见字符串走 react-intl，16 个 locale 全部补真实翻译；**不改动**现有 11 个硬编码英文斜杠项（超范围）。

## 架构与文件

新增文件（全部位于 `lib/editor/nodes/`）：

| 文件                          | 职责                                                                   |
| ----------------------------- | ---------------------------------------------------------------------- |
| `nodes/callout.ts`            | Callout 节点定义（schema、renderHTML/parseHTML）+ `setCallout` 命令    |
| `nodes/callout-variants.ts`   | 纯函数：`variant` → `{ emoji, labelKey, className }`，可独立单测       |
| `nodes/callout-node-view.tsx` | React NodeView：emoji 按钮 + 带标签下拉切类型 + `NodeViewContent` 正文 |
| `nodes/toggle.ts`             | Toggle / ToggleSummary / ToggleContent 三个节点 + `setToggle` 命令     |
| `nodes/toggle-node-view.tsx`  | React NodeView：▶ 箭头切 `open` + summary/content 渲染                 |

改动文件：

- `lib/editor/extensions.ts` — 在 `getBaseExtensions()` 注册新节点。
- `lib/editor/slash-command.tsx` — 新增 `/callout`、`/toggle` 两项；引入 `intl` 以本地化新项文案。
- `lib/i18n/*.json`（16 个）— 补齐新 key。

## 内容模型（ProseMirror schema）

### Callout

- `name: 'callout'`, `group: 'block'`, `content: 'block+'`, `defining: true`。
- attr `variant`: `'info' | 'warning' | 'success' | 'note' | 'error'`，默认 `'info'`。
- 正文容器可放段落、列表、嵌套块。

### Toggle

- `name: 'toggle'`, `group: 'block'`, `content: 'toggleSummary toggleContent'`。
- attr `open`: boolean，默认 `true`，持久化。
- `toggleSummary`: `content: 'inline*'`，标题行（行内富文本）。
- `toggleContent`: `content: 'block+'`，正文；`open === false` 时由 CSS 隐藏。

## 序列化 / 持久化

存储经 `editor.getHTML()`，加载经 `setContent()` 解析 HTML。每个节点定义 `renderHTML` + `parseHTML` 保证往返：

- Callout → `<div data-callout data-variant="warning">…</div>`，`parseHTML` 匹配 `div[data-callout]`，`variant` 从 `data-variant` 读取。
- Toggle → `<div data-toggle data-open="true"><div data-toggle-summary>…</div><div data-toggle-content>…</div></div>`。
- **emoji 不写入文本**——由 `variant` 在 NodeView 内派生（单一数据源），避免 emoji 与类型漂移。

## 交互细节

- **Callout 切类型**：emoji 按钮（`contentEditable={false}`）触发 `DropdownMenu`，5 行带本地化标签；选中执行
  `editor.commands.command(({ tr }) => { tr.setNodeAttribute(pos, 'variant', v); return true })`。
- **Toggle 展开/收起**：▶ 按钮（`contentEditable={false}`）切 `open` 属性；箭头通过 `data-open` 驱动 CSS 旋转。
- **斜杠命令**：
  - `/callout` → `setCallout({ variant: 'info' })`，插入含空段落的 Callout 并把光标放入正文。
  - `/toggle` → `setToggle()`，插入含空 summary + 空段落 content 的 Toggle，光标放入 summary。
- 选区非空时 `setCallout` 包裹当前块；空段落时插入空 Callout（实现层细节）。

## 配色 / a11y

- 全部使用语义化 token（`bg-muted` / `text-muted-foreground` / `border` 等映射到各变体），自动适配深色模式；**不使用裸 palette 类**（项目 token-lint 会拦截新文件里的 zinc/gray 等裸类）。
- emoji 按钮、箭头按钮均 `contentEditable={false}` 且带本地化 `aria-label`。
- 下拉项可键盘导航（Radix `DropdownMenu` 原生支持）。

## i18n

新增 key（命名对齐现有 `editor.*` 命名空间，实现时以 `en.json` 现状为准微调）：

- `editor.slash.callout.title` / `editor.slash.callout.description`
- `editor.slash.toggle.title` / `editor.slash.toggle.description`
- `editor.callout.variant.info` / `.warning` / `.success` / `.note` / `.error`
- `editor.callout.changeType`（emoji 按钮 aria-label）
- `editor.toggle.toggle`（箭头按钮 aria-label）

16 个 locale 文件全部补真实翻译，不用英文兜底。

## 测试（Jest）

- `callout-variants` 纯函数：5 个变体的 `emoji` / `labelKey` / `className` 映射正确。
- Callout `renderHTML` ↔ `parseHTML` 往返（含 `variant` 默认值与各取值）。
- Toggle `renderHTML` ↔ `parseHTML` 往返（含 `open` true/false）。
- `getSlashCommandItems()` 包含 callout、toggle 两项（title/command 存在）。
- `RichTextViewer` 组件测试（jsdom）：渲染存储的 Callout + Toggle HTML，断言正文文本与 `data-*` 属性。
- ⚠️ 不模拟 Radix 下拉真实打开（jsdom 无 `hasPointerCapture`，已知限制）——切类型逻辑在命令层/纯函数层覆盖。

## 范围之外（YAGNI）

- 自定义 emoji picker。
- 现有 11 个斜杠项的本地化改造。
- Callout 自定义背景色 / 嵌套 Toggle 的特殊样式（嵌套结构本身支持，不额外做样式）。
