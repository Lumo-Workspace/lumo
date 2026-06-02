# LUM-161 — 里程碑软归档（archivedAt，区别于删除）

**Status**: Design approved
**Date**: 2026-06-02
**Task**: LUM-161 (Milestone: Milestone 功能增强)

## 背景与问题

当前里程碑只有**硬删除**（`milestone delete` → `prisma.delete`），不可恢复。`CANCELLED` 状态事实上被当作「归档」使用，但语义不清——它本意是「中止」这一生命周期状态，与「从列表下架、保留历史、可恢复」是两回事。

需要新增 `archivedAt` **软归档**：归档后默认从列表隐藏、保留历史与任务关联、可恢复，且明确区别于硬删除。

## 设计决策

1. **`archivedAt` 与 `status` 正交**：任意状态（PLANNED/ACTIVE/COMPLETED/CANCELLED）的里程碑都能归档/恢复。`CANCELLED` 仍保留为「中止」生命周期状态，不与归档联动。归档是独立的「下架」维度。
2. **CLI 新增 `archive` / `unarchive` 子命令**；硬删除 `milestone delete` 行为**保持不变**。三个动作语义分离：archive（下架，可恢复）/ unarchive（恢复）/ delete（彻底硬删）。
3. **列表默认排除归档**：`milestone list` 默认只显示未归档；`--archived` 只看已归档；`--all` 看全部。三态互斥。
4. **归档后冻结内容修改**：已归档里程碑的 `update`、任务 `add`/`remove` 返回 409；仅 `unarchive` 放行。归档 = 只读快照，保护历史关联不被误改。
5. **范围 = 后端 + CLI**：前端 `useMilestones` / `ProjectMilestonesTab` / `MilestoneFilterPicker` 消费同一默认 API，后端默认排除归档后它们**自动**只显示未归档（免费获得）。本任务**不**新增前端归档/恢复按钮或「查看已归档」开关——那另开任务。
6. **slug 唯一约束不变**：`@@unique([projectId, slug])` 保持。归档项仍占用 slug，避免恢复时撞名。

## 分层实现

数据流遵循项目约定：`Component → API Client → API Route → Service → Repository → Prisma`。API route 保持轻薄，业务逻辑在 service，Prisma 查询只在 repository。

### 1. Schema（`prisma/schema.prisma`）

- `Milestone` 模型新增字段：
  ```prisma
  archivedAt DateTime?
  ```
- 新增索引支撑默认过滤：
  ```prisma
  @@index([projectId, archivedAt])
  ```
- Migration：新增**可空**列 + 索引，向后兼容（既有行 `archivedAt` 全为 NULL = 未归档 = 可见；旧代码忽略新列）。本地用 `prisma migrate dev`；worktree 环境按项目惯例走 prisma.config.ts + `db execute`（见项目记忆）。

### 2. Repository（`lib/repositories/milestone.repository.ts`）

- `findByProject(projectId, filter)`：新增 `filter: 'active' | 'archived' | 'all'` 参数，默认 `'active'`。
  - `active` → `where.archivedAt = null`
  - `archived` → `where.archivedAt = { not: null }`
  - `all` → 不加 `archivedAt` 条件
- 新增 `archive(id, archivedAt: Date)`：`update({ where: { id }, data: { archivedAt } })`
- 新增 `unarchive(id)`：`update({ where: { id }, data: { archivedAt: null } })`
- `findSlugsByProject` 不变（保留 slug 占用）。

### 3. Service（`lib/services/milestone.service.ts`）

- `listMilestones(projectId, memberId, filter = 'active')`：权限校验后透传 `filter` 给 repository。
- 新增 `archiveMilestone(milestoneId, memberId)`：权限校验 → 取里程碑 → 幂等（已归档则直接返回当前态）→ `repo.archive(id, now)`，时间戳由 service 计算后传入 repo。
- 新增 `unarchiveMilestone(milestoneId, memberId)`：权限校验 → 幂等（未归档则直接返回）→ `repo.unarchive(id)`。
- **冻结守卫**：`updateMilestone` 入口加载里程碑后，若 `archivedAt != null` → `throw Object.assign(new Error('milestone is archived; unarchive first'), { status: 409 })`。
- **任务绑定守卫**：任务被绑到某里程碑时（task `--milestone`、`milestone add/remove`），目标里程碑若已归档则拒绝。实现计划阶段定位精确落点（task-milestone 绑定校验处），统一加 `archivedAt` 检查。

### 4. Validation（`lib/validation/schemas.ts`）

- 列表查询参数 schema：`filter: z.enum(['active', 'archived', 'all']).default('active')`。
- `createMilestoneSchema` / `updateMilestoneSchema` **不变**——`archivedAt` 不可由用户直接 PATCH，只能经 archive/unarchive 端点变更。

### 5. API Routes（`app/api/`）

- `GET /api/projects/[id]/milestones?filter=active|archived|all`（默认 `active`）：解析 query → 调 `listMilestones`。
- 新增 `POST /api/milestones/[milestoneId]/archive` → `archiveMilestone` → `{ milestone }`。
- 新增 `POST /api/milestones/[milestoneId]/unarchive` → `unarchiveMilestone` → `{ milestone }`。

### 6. CLI API Client（`lib/api-client/milestones.ts`）

- `ApiMilestone` 接口新增 `archivedAt: string | null`。
- `listByProject(projectId, filter?)`：新增 `filter` 参数，拼到 query。
- 新增 `archive(milestoneId)` / `unarchive(milestoneId)`。

### 7. CLI 命令（`cli/src/commands/`）

- `milestone-list.ts`：新增 `--archived` / `--all` flag（互斥，二者都不传 = 默认 active）；映射到 client filter；归档行加视觉标记（末尾 `(archived)`，保持定宽对齐）。
- 新增 `milestone-archive.ts`：`milestone archive <identifier>`，复用现有 identifier 解析（同 show/update），输出 `Archived "<name>"`。
- 新增 `milestone-unarchive.ts`：`milestone unarchive <identifier>`，输出 `Unarchived "<name>"`。
- 在 CLI 命令注册处挂载两个新命令。

### 8. 测试（Jest，`__tests__/`）

- **Repository**：`findByProject` 三态 filter；archive/unarchive 设值与清值。
- **Service**：archive/unarchive 正常路径、幂等、权限拒绝；冻结守卫（对已归档调 update 抛 409）；`listMilestones` 默认排除归档。
- **API**：archive/unarchive 路由；list `filter` 参数解析与默认值。
- **CLI**：list 的 `--archived`/`--all` 互斥校验与归档标记格式；archive/unarchive 输出格式。
- **任务绑定守卫**：不能把任务绑到已归档里程碑。
- 每个新函数至少一个测试（项目约定）。

### 9. 文档（`.claude/skills/lumo/SKILL.md`）

- milestone 章节新增 `archive` / `unarchive` 命令说明、`milestone list --archived/--all` 用法、空/标记语义。
- frontmatter `description` 触发词补充：archive、unarchive、归档、恢复里程碑、archived milestones、取消归档。

### 10. 部署注意（写入 PR 描述）

- 本 PR 含 schema 变更：新增可空列 `archivedAt` + 索引。需在生产 `prisma migrate deploy`（项目踩过 CI 不自动跑迁移、导致读不存在列 500 的坑）。迁移本身无数据破坏（纯加列）。

## 非目标（Out of scope）

- 前端归档/恢复按钮与「查看已归档」开关（另开任务）。
- 归档后释放 slug 以允许同名重建。
- 用 archive 取代 / 迁移既有 `CANCELLED` 数据。
- 自动归档（如完成 N 天后）/ 批量归档命令。

## 风险与缓解

- **生产迁移漂移**：CI/CD 可能不自动跑 `prisma migrate deploy` → PR 描述显式标注需手动迁移；列可空，旧代码兼容，即使迁移延迟也不会让旧前端 500。
- **任务绑定守卫落点**：task-milestone 绑定校验的精确位置需在实现阶段确认；若现有校验已集中在一处则直接加条件，否则按「Prisma 查询移入 service」的项目惯例收口。
