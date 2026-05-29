# Spec Engineering 支持：TaskArtifact 记录 + context 注入 [LUM-109]

> Status: spec approved, ready for planning
> Mockup: [`2026-05-29-spec-artifact-ui-mockup.html`](./2026-05-29-spec-artifact-ui-mockup.html)

## 目标

把 Claude Code 的 spec engineering 产物（spec / plan / design …）记录到对应的 Lumo task 上，并能注入回 `lumo task context`。

第一版只做"记录"——不做审批、不做 gate。一句话闭环：Claude Code 跑完 spec engineering → `lumo task artifact add` 推文件 → 存进新表 → task 详情页定义层可见 → `lumo task context` 注入。

## 范围边界（先读这段，避免 over-build）

**要做：**

1. 新建 `TaskArtifact` 表
2. `lumo task artifact add` / `list` CLI
3. `task-context.service` 注入 artifact section
4. task 详情页"定义层"展示 artifact

**明确不做（这一版一律跳过）：**

- ❌ 不做 approve / gate —— 没有 `status`、没有 `isGate`、没有"待执行"状态
- ❌ 不碰现有的 `Task.spec` 字段，也不碰 agent-server 自动起草 spec 那条流（`SPEC_GENERATED` / `TASK_SPEC_READY` / `confirm_spec` 全部保持原样）
- ❌ 不复用、不修改 `Document` / `DocumentMention` 模型
- ❌ 不解析 `kind` 的语义 —— `kind` 是不透明字符串，由写入方声明，系统不枚举、不翻译、不配图标
- ❌ 不做版本管理、不做多人协作、不做富文本编辑器、不做框架适配器

**核心原则：兼容性靠 CLI 协议，不靠数据模型。** 是各框架（Superpowers / Kiro / …）来适配 Lumo 的通用 `add` 接口，不是 Lumo 去识别每个框架。

## 1. 数据模型

新增一张 task 附属表，和现有的 `TaskWebLink` / `TaskSlackContext` / `TaskFigmaLink` 同构。不要复用 Document。

```prisma
model TaskArtifact {
  id          String   @id @default(cuid())
  taskId      String
  workspaceId String

  kind    String   // "spec" | "plan" | "design" … 不透明，写入方声明
  title   String
  content String   @db.Text
  source  String   // "superpowers" | "claude-code" | "manual"
  order   Int      @default(0)

  createdById String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  task      Task      @relation(fields: [taskId], references: [id], onDelete: Cascade)
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([taskId, order])
  @@index([workspaceId])
  @@map("task_artifacts")
}
```

- 在 `Task` 和 `Workspace` 上加反向关系 `artifacts TaskArtifact[]`
- `onDelete: Cascade` 是关键——artifact 随 task 生灭，这正是它和 Document 的本质区别
- 写 migration（dev 用 `prisma migrate dev`；遇 checksum drift 走 CLAUDE.md 记录的 hand-write SQL + db execute + resolve --applied 流程，**不要** reset DB）

## 2. CLI

通用写入入口，任何框架的产物都走这一个命令：

```
lumo task artifact add <TASK-ID> --kind <kind> --title <title> --file <path> [--source <source>]
lumo task artifact list <TASK-ID>
```

- `--kind` / `--title` / `--source` 原样存库，不做校验（除非为空）
- `--file` 读文件内容存进 `content`
- `order` 默认取当前 task 下已有 artifact 数量（追加到末尾）
- `source` 缺省填 `"claude-code"`
- 一个框架产出多个 artifact 就多次调用（Superpowers: 一次 spec、一次 plan）
- 改了 `cli/src/commands/` → 同步更新 `.claude/skills/lumo/SKILL.md`（见 CLAUDE.md「CLI & Skills 同步」）

数据流遵循分层架构：CLI command → API client → API route → service → repository → Prisma。

## 3. Context 注入

在 `lib/services/task-context.service.ts` 现有的 section（description / memory / slack / web links / figma / 历史 session）后面，加一个 artifact section。

- 无条件注入该 task 下的所有 artifact，按 `order` 升序（没有 approve 判断）
- 每个 artifact 渲染成 `## <title>`（或 `## [<kind>] <title>`）+ `content`
- task 没有任何 artifact 时，不渲染这个 section
- 渲染产物作为 `artifactSection: string` 字段加进 `TaskContext` 接口，CLI 端 verbatim 内联（与 memorySection / slackContextSection 等现有做法一致）

## 4. UI（task 详情页）

**参考 mockup：[`2026-05-29-spec-artifact-ui-mockup.html`](./2026-05-29-spec-artifact-ui-mockup.html)**

落点对到 `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx` 左栏：

- **规格组插在 `<h1>` 之后、description 之前**（现 TaskDetailPage.tsx:275 与 :277 之间），成为标题下第一块内容。不要动现有 `{/* Spec — hidden: agent features disabled for now */}` 占位注释（那是旧 `Task.spec` / agent 流，保持隐藏）。
- 组头一行：`▦ 规格` 标签 + 来源/数量 pill（如 `✦ Superpowers · 2 个产物`；来源取 artifact 的 `source` 去重，数量取总数）+ 右侧 `＋ 添加` 手动入口。
- 每个 artifact 一行：`kind` mono 小标签（原样显示）+ `title` + 折叠/展开 chevron；折叠态右侧可带 `content` 首行预览（省略号截断）。
- 默认折叠，点开看 `content`；展开态底部仅一行 meta（`source` + 时间），无按钮 / 无状态色 / 无徽章 —— 这一版是纯记录，UI 应该是"安静"的。
- 多个 artifact 按 `order` 升序纵向排。
- 所有文案走 react-intl，新增 key 时更新 `lib/i18n/` 下**每个** locale 文件。

**两个超出原 brief 的决策（来自 mockup，已采纳）：**

1. **description 降级为"背景讨论"折叠块**：mockup 把原 description 改成标题「背景讨论（原 description）」、默认收起，位置在规格组下方、Tab 上方。
   - 采纳，但**限定触发条件**：仅当该 task 至少有 1 个 artifact 时，description 才默认折叠为"背景讨论"；无 artifact 的 task 保持现状（description 直接展开、标签不变）。避免对全量历史 task 造成无关的页面回归——与本 feature「只加规格层、不重设计详情页」的范围一致。
2. **上下文 Tab 的「文档」行加注记**：`仅参考资料 · spec 在上方定义层`，把 `DocumentMention` 参考文档与上方规格层显式区分。其余上下文行（Slack / 网页链接 / Figma / PR）保持不变；「文档」section 仍只放 `DocumentMention` 关联文档，不动。

## 验收

- Claude Code 跑完 spec engineering，`lumo task artifact add` 两次（spec + plan），task 详情页定义层能看到这两条
- `lumo task context <TASK-ID>` 的输出包含这两个 artifact 的内容
- 删除 task → 关联 artifact 级联删除
- 现有 `Task.spec` 流程、agent-server、Document 文档 section 全部不受影响
- `kind` 写什么显示什么（试 `spec` / `plan` / `requirements` 都不报错、不需要预注册）
- UI 落点与 mockup 一致：规格组在标题下方、Tab 之上；有 artifact 时 description 收为「背景讨论」，无 artifact 时 description 照旧
- 每个新函数有测试（Jest，`__tests__`，`*.test.ts`）；`npx tsc --noEmit` 无报错；无 `console.log`

## 留给下一版（现在别做，记着就行）

等真有了协作者、或开始让 agent 跑你没逐字看过的 plan，再加回：`status`（DRAFT/APPROVED）+ `isGate`（哪个 artifact 是执行闸门）+ 对应的 approve UI。届时 UI 只是在现有元素上长出徽章和按钮，是加法。
