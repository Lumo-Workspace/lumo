# LUM-217 — 表格菜单统一条 + 表头/合并/拆分

**Date**: 2026-06-04
**Task**: LUM-217 — 表格操作选中文字时也可达 + 补表头/合并拆分
**Milestone**: 文档编辑器优化
**File under change**: `app/workspace/[workspaceUrl]/components/BubbleMenuBar.tsx`

## Problem

`BubbleMenuBar.tsx` 当前有两个互斥的表格渲染分支,按 `selection.empty` 切换:

- `isTable && selectionEmpty`(原 255–313 行):只显示表格结构操作(加行/列、删行/列、删表),**没有文字格式**。
- `isTable && !selectionEmpty`(原 316–388 行):只显示文字格式(粗/斜/下划线/删除线/颜色 + 三个对齐 + 链接),**完全没有表格操作**。

后果:光标在表格里、一旦选中单元格文字,菜单就"变身"——表格操作全部消失、按钮集合彻底换一批,体验跳。此外 Tiptap 原生的 `toggleHeaderRow` / `mergeCells` / `splitCell` 三个能力从未接入。

## Goals

1. **消除"变身感"**:光标在表格内时,工具条形状固定,不随选区变化;表格操作始终可达。
2. **补三个 Tiptap 原生能力**:表头行开关、合并单元格、拆分单元格。

## Non-Goals

- 不改表格外的默认工具条(分支 4)。文字对齐控件目前**仅存在于表格分支**,本次保持表格作用域,不引入到默认条。
- 不动链接输入面板(分支 3)。
- 不把"转为任务"(extract)按钮引入表格条——维持现状(仅默认条有)。

## Design

### 统一的"表格内"工具条

把上述两个表格分支合并成**一个** `if (state.isTable)` 分支,无论选区是否为空都渲染同一套(顺序固定):

```
正文▾ | B  I  U  S  A(颜色) | 对齐▾ | 🔗 | 表格▾
```

- `正文▾` — 复用现有 text-style 下拉(`TEXT_STYLES`)。
- `B / I / U / S` — 复用现有 toggleBold/Italic/Underline/Strike。
- `A` — 复用现有 `<ColorPicker>`。
- `对齐▾` — **新增**对齐下拉(见下),把原来三个内联对齐按钮收成一个下拉。
- `🔗` — 复用现有 `openLinkInput`。
- `表格▾` — **新增**表格操作下拉(见下)。

选区(空/非空/多格 CellSelection)只影响下拉内部条目的**禁用态**,不改变条形。`mergeCells` 在选中多个单元格时才有意义、`splitCell` 在合并过的格子里才有意义——其余情形按钮置灰。

### 新组件抽取(SRP / 里程碑"组件拆分"主题)

`BubbleMenuBar.tsx` 已近 680 行。把两个新下拉抽成自包含组件,放在现有的 `app/workspace/[workspaceUrl]/components/bubble-menu/` 目录下:

- **`AlignMenu.tsx`** — 对齐下拉。
  - Props:`{ editor: Editor; alignLeft: boolean; alignCenter: boolean; alignRight: boolean }`(ISP:只传所需 flag,不传整个 state)。
  - 触发按钮显示当前对齐图标(`AlignLeft`/`AlignCenter`/`AlignRight`,按 flag 选)+ `ChevronDown`。
  - 下拉项:左/中/右,各自 `setTextAlign(...)`,当前项高亮。
  - 自管 open state + 外点关闭(沿用 style/list 下拉的手写模式,非 Radix)。

- **`TableActionsMenu.tsx`** — 表格操作下拉。
  - Props:`{ editor: Editor; canMergeCells: boolean; canSplitCell: boolean }`。
  - 触发按钮:`Table2` + `ChevronDown`。
  - 下拉内容(用 `Divider` 分组,**不加文字分组标题**以控制 i18n 面;参考 mockup 的分组但落地为分隔线):
    1. 行/列:`addRowBefore`(`BetweenHorizontalStart`)、`addRowAfter`(`BetweenHorizontalEnd`)、`addColumnBefore`(`BetweenVerticalStart`)、`addColumnAfter`(`BetweenVerticalEnd`)。
    2. 结构:`toggleHeaderRow`(`PanelTop`)、`mergeCells`(`TableCellsMerge`,`!canMergeCells` 时禁用)、`splitCell`(`TableCellsSplit`,`!canSplitCell` 时禁用)。
    3. 删除:`deleteRow`(`Trash2`,红)、`deleteColumn`(`Trash2`,红)、`deleteTable`(`Trash2`,红,**两步确认**)。
  - **删除整表的两步确认逻辑搬进本组件**:把现有的 `confirmDeleteTable` state、`confirmDeleteTimerRef`、3 秒超时清理 effect、`handleDeleteTableClick` 从 `BubbleMenuBar` 移到这里。第一次点"删除整表":条目文案变为确认文案(`table.deleteTableConfirm`)、转红/armed,**下拉不关闭**;3 秒内再点才真正 `deleteTable`(并关闭下拉);超时自动复位。其余条目点击后照常关闭下拉。

> 现有的 `正文▾`、`列表▾` 下拉保持内联,不在本次重构范围。新增两个下拉走相同的手写交互模式以保持一致。

### useEditorState selector 增量

在 `BubbleMenuBar` 的 `useEditorState` selector 里新增两个派生值(触发按钮随事务重渲染):

```ts
canMergeCells: ctx.editor.can().mergeCells(),
canSplitCell: ctx.editor.can().splitCell(),
```

`alignLeft/alignCenter/alignRight` 已存在,直接透传给 `AlignMenu`。`toggleHeaderRow` 始终可用(在表格内),不做禁用/active 指示。

### 图标(全部 lucide-react 1.17.0,已确认存在)

| 操作 | 图标 |
|---|---|
| 表头行开关 | `PanelTop` |
| 合并单元格 | `TableCellsMerge` |
| 拆分单元格 | `TableCellsSplit` |
| 对齐(左/中/右) | `AlignLeft` / `AlignCenter` / `AlignRight`(已用) |
| 表格下拉触发 | `Table2`(已用) |
| 加行/列 | `BetweenHorizontalStart/End`、`BetweenVerticalStart/End`(已用) |
| 删除 | `Trash2`(已用) |
| 下拉箭头 | `ChevronDown`(已用) |

### i18n

新增 5 个 key,**全部 16 个 locale 文件**都要加(`lib/i18n/*.json`),不得用英文兜底:

- `editor.align` — 对齐下拉触发的 tooltip(如 "Alignment" / "对齐")
- `table.actions` — 表格下拉触发的 tooltip(如 "Table" / "表格")
- `table.toggleHeaderRow` — "Toggle header row" / "表头行"
- `table.mergeCells` — "Merge cells" / "合并单元格"
- `table.splitCell` — "Split cell" / "拆分单元格"

复用现有:`table.addRowAbove/addRowBelow/addColLeft/addColRight/deleteRow/deleteCol/deleteTable/deleteTableConfirm`、`editor.alignLeft/alignCenter/alignRight`。

## Testing

更新 `__tests__/components/BubbleMenuBarTable.test.tsx`(现有 7-按钮断言会失效,因为表格条不再是扁平 7 图标):

- **统一条不变身**:`editorState` 设 `isTable:true`,分别在 `selectionEmpty:true` 与 `false` 下渲染,断言可见控件集合一致(正文▾/B/I/U/S/颜色/对齐▾/🔗/表格▾)。
- **表格下拉**:点开 `表格▾`,断言含表头/合并/拆分/加行列/删行列删表条目。
- **合并/拆分禁用**:`canMergeCells:false` → 合并项 `disabled`;`canSplitCell:false` → 拆分项 `disabled`。
- **删表两步确认**(迁移现有用例):先开下拉 → 点"删除整表"仅 arm(不调用 `deleteTable`、文案变确认态、下拉仍开)→ 再点才 `deleteTable`;`jest.advanceTimersByTime(3000)` 后复位。
- **对齐下拉**:点开 `对齐▾` → 点"居中" → 断言 `setTextAlign('center')` 被调用。
- 为 `AlignMenu` / `TableActionsMenu` 各补至少一个直接渲染的单元测试(每个新函数/组件至少一个测试,符合 CLAUDE.md)。

实现说明:这些下拉是**手写**的(mousedown 切 React state),非 Radix,jsdom 下能正常开合(不受 "Radix Select 在 jsdom 打不开" 限制)。editor stub 需补:`can()` 返回带 `mergeCells()/splitCell()` 的对象、以及 `toggleHeaderRow/mergeCells/splitCell/setTextAlign` 链式方法。

## Verification

- `cd .worktrees/LUM-217-table-menu-unify && npx jest BubbleMenuBar` 全绿。
- `npx tsc --noEmit`(注意 `noUncheckedIndexedAccess`、`exactOptionalPropertyTypes` 已开)。
- `npm run lint:tokens`(新组件用语义 token,不要照搬 zinc/gray hex)。
- 浏览器预览受限(见内存),以 tsc + jsdom 组件测试 + lint:tokens 为准。

## Files Touched

- `app/workspace/[workspaceUrl]/components/BubbleMenuBar.tsx`(合并表格分支、selector 增量、渲染两个新组件、移除 confirm 本地逻辑)
- `app/workspace/[workspaceUrl]/components/bubble-menu/AlignMenu.tsx`(新)
- `app/workspace/[workspaceUrl]/components/bubble-menu/TableActionsMenu.tsx`(新)
- `__tests__/components/BubbleMenuBarTable.test.tsx`(更新 + 新增用例)
- `lib/i18n/*.json` × 16(各加 5 个 key)
