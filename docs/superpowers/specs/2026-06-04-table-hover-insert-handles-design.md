# LUM-218 · 表格 hover 行/列边缘 + 句柄就地插入 — 设计

**日期**: 2026-06-04
**任务**: LUM-218(里程碑「文档编辑器优化」)
**状态**: 设计已确认,待写实现计划

## 背景与问题

当前 Tiptap 表格的浮动 bubble 菜单居中显示、无空间锚点。「在左/右插入列」完全不提示相对哪一列(`app/workspace/[workspaceUrl]/components/BubbleMenuBar.tsx:255-312`),用户无法所见即所得地知道会插到哪里。

目标:参考 Notion,在 hover 行/列边缘时就地出 `+` 句柄,在精确位置插入行/列。

## 既有现状(摸底结论)

- 表格扩展全部用 stock `@tiptap/extension-table*` v3.22(`Table` 配 `resizable: true`),无自定义表格实现 —— `lib/editor/extensions.ts`。
- 表格命令(`addRowBefore/After`、`addColumnBefore/After`、`deleteRow/Column/Table`)已在 bubble 菜单接好。
- codebase **目前没有任何自定义 ProseMirror 插件 / Decoration**;扩展惯例是 `Extension + ReactNodeViewRenderer`(TaskItem)与 `Suggestion`(slash)。整体偏好「React UI 优先」。
- 表格 CSS 在 `app/globals.css:166-212`,单元格已是 `position: relative`。

## 确定的决策

1. **句柄交互形态:Notion 风格**。hover 到行/列之间缝隙(含表格最外侧四边)时,缝隙处冒出小圆 `+` 与一条蓝色定位线,点击在该精确边界插入。无 hover 时完全隐形。
2. **与现有 bubble 菜单的关系:两者都保留**。`+` 句柄负责所见即所得插入;bubble 菜单的插入/删除按钮原样留作键盘 / 无 hover 场景的兜底。本任务不删除 bubble 菜单任何按钮。
3. **技术路线:React DOM 浮层 + `posAtCoords`**(非 ProseMirror 插件、非 NodeView 重写)。贴合现有「React UI 优先」习惯,不引入团队此前没有的 PM 抽象层,改动面可控。

## 架构:文件与职责(SRP / 分层)

| 文件                                                                     | 职责                                                                                                                                                                      | 禁止                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `lib/editor/table/resolve-insert-target.ts`                              | **纯函数**。输入鼠标坐标 + 单元格 rect 列表 → 输出 `{ axis: 'row' \| 'col', side: 'before' \| 'after', anchorCellRect, markerRect } \| null`。无 DOM 依赖。               | 不读 DOM、不调 editor |
| `app/workspace/[workspaceUrl]/components/table/useTableInsertHandles.ts` | hook。接 `editor`,监听目标表格的 `mousemove` / `mouseleave` + 容器 `scroll` + `ResizeObserver`,采集单元格 rect 调纯函数算出 `marker` 状态;暴露 `marker` 与 `onInsert()`。 | 不渲染 UI             |
| `app/workspace/[workspaceUrl]/components/table/TableInsertHandles.tsx`   | 表现层。根据 `marker` 在编辑器容器内绝对定位渲染 `+` 圆钮 + 蓝色定位线。                                                                                                  | 不含几何/命令逻辑     |
| `DescriptionEditor.tsx`                                                  | 仅在 `editable` 时挂载 `<TableInsertHandles editor={editor} />`,置于编辑器容器内。                                                                                        | —                     |
| `app/globals.css`                                                        | `+` 钮、定位线样式,使用语义 token(不写裸色值,过 lint:tokens)。                                                                                                            | —                     |

## 交互细节

- hover 进入任一行/列边界阈值区(缝隙 ±6px,含表格最外侧四边)→ 出 `+` 与蓝线;`mouseleave` 隐藏。
- 点击 `+`:对锚点单元格内一点调 `editor.view.posAtCoords` → `setTextSelection(pos)` → 链式 `addColumnBefore/After` 或 `addRowBefore/After`。**复用 stock 命令,不手算 PM 表格位置。**
- 边界 i↔i+1 等价于「col i 之后」;最外侧左/上边 = 「第 0 列/行之前」。
- 多表格 / 嵌套表格:hook 以「光标当前所在表格」为目标,一次只服务一个表格。

## a11y + i18n

- `+` 是真 `<button>`,带 `aria-label`(react-intl)。新增 key `editor.table.insertColumn` / `editor.table.insertRow`,**所有 locale 文件都补**,不拿英文兜底。
- 仅 `editable` 时渲染;只读模式不出句柄。

## 测试(Jest)

- `resolve-insert-target.test.ts`:喂合成 rect,断言「最近边界」「最外侧边」「阈值外返回 null」「行 vs 列优先」等 case。
- hook / 组件:mock editor,强制 marker 态后模拟点击 → 断言 `addColumnAfter` 等命令被调。几何测量逻辑设计成可注入,绕开 jsdom 中 `getBoundingClientRect` 返回 0 的限制。

## 风险 / 取舍

- jsdom 无真实布局几何 → 几何全部收敛进纯函数单测,组件只测命令接线。
- 纯前端改动,**无 Prisma schema / DB 迁移**。
- 不改 bubble 菜单行为,回归面小。

## 非目标(YAGNI)

- 不做整行/整列的选中、拖拽重排(飞书句柄条范式已放弃)。
- 不把删除操作搬进句柄。
- 不重写表格 NodeView。
