# LUM-300 · 修复飞轮归因:存在方差,而非共同加载(阶段1)

**Task**: LUM-300 — Fix flywheel attribution: presence/use variance, not co-loading (prereq for LUM-279)
**Date**: 2026-06-07
**Scope**: 仅阶段1(presence-variance 排除)。纯聚合 + 渲染改动,**无 schema 变更**。
**Milestone**: Context Lineage (System of Record)

---

## 1. 问题

飞轮信号(LUM-278)目前对几乎所有 fragment 非歧视。prod 真数据坐实:122 个 distinct fragment 中,**106 个(87%)出现在全部 5 个有边任务里**(零存在差异),仅 16 个是任务专属(只在 1 个任务出现)。

一个「永远在场」的 fragment,其 merge 率 = 全队任务的平均成功率(base rate),跟 fragment 本身无关——等于在问「呼吸空气的人考得更好吗」。当前面板对这 106 个全显示 100%,是**骗人的**。

**根因**:系统盖章依据是「共同出现在 context bundle 里」,但 bundle 是无差别全量加载。「一起被加载」≠「起了作用」。信号测的是「加载了什么」(恒定),而非「什么帮上忙」(才有信息量)。

本任务做阶段1 —— 任务描述里「最便宜的诚实」:只给「存在会变化」的 fragment 算 merge 率;出现在每一个已闭合任务里的零方差 fragment 从飞轮排除。

---

## 2. 现状(已核对代码)

- merge 率信号 `## 飞轮信号 · 历史 merge 贡献` **只存在于 task-context 的 markdown 输出**(服务端 `assembleLineageSection` 预渲染,CLI 直接打印)。
- [`lib/services/lineage-signal.ts`](../../../lib/services/lineage-signal.ts):
  - `renderLineageSection(entries)` — 仅按冷启动门 `resolvedTasks >= LINEAGE_MIN_RESOLVED_TASKS`(=3)过滤,**无 presence-variance 过滤**。
  - `assembleLineageSection(fragments, memoryContentById, deps)` — 解析 canonical id、批量取 `mergeRateByFragments`、去重、渲染。never-throws(失败降级为 `''`)。
- [`lib/repositories/lineage-edge.repository.ts`](../../../lib/repositories/lineage-edge.repository.ts):
  - `mergeRateByFragments(refs, tx?)` — 按 task 去重;`resolved` = 某 (fragment,task) 存在任一 `outcome != UNKNOWN` 的边;`merged` = 任一 `outcome == MERGED`。**不按 workspace 隔离,全局按 fragment ref 查询**。
- [`LineageTab.tsx`](../../../app/workspace/[workspaceUrl]/components/TaskDetailTimeline/LineageTab.tsx):只渲染每条边的 **outcome**,**不显示 per-fragment merge 率**。→ 本阶段预计**不改**(实现时再确认)。

**现状交互(重要)**:阶段1 落地后,当前 prod 数据(5 个已闭合任务)下飞轮信号会变成「空」——106 个被 presence-variance 排除,16 个被冷启动门(<3)挡掉。这是诚实状态:目前没有任何 fragment 同时满足「样本够」且「存在有方差」。

---

## 3. 设计

### 3.1 口径(已与用户对齐)

- **universe** = 「至少有 1 条 `outcome != UNKNOWN` 的边」的 **distinct taskId 数**。全局口径,与 `mergeRateByFragments` 的 `resolved` 定义完全一致。
- **零方差排除 = 严格等于**:`fragment.resolvedTasks === universe` → 排除。最佳解释:出现在每一个已闭合任务里 → merge 率定义上就是 base rate,零信息量。无魔法数字。
- **冷启动门不变**:`resolvedTasks >= 3`,叠加在排除之后(先排除零方差,再过冷启动)。
- **透明度**:排除后追加一行注释告知排除数量,避免「静默截断」被误读为「没信号」。

### 3.2 Repository 层 — `lineage-edge.repository.ts`

新增:

```ts
/**
 * universe for presence-variance: distinct tasks that have at least one
 * resolved (non-UNKNOWN outcome) edge. Matches mergeRateByFragments' resolved
 * definition (global, not workspace-scoped) so equality checks line up.
 */
async countResolvedTasks(tx?: Prisma.TransactionClient): Promise<number>
```

实现:`groupBy({ by: ['taskId'], where: { outcome: { not: 'UNKNOWN' } } })` 取 `.length`(distinct taskId 计数)。

### 3.3 Service 层 — `lineage-signal.ts`

- `LineageSignalDeps` 新增 `countResolvedTasks: () => Promise<number>`。
- `assembleLineageSection`:
  - 取 `universe = await deps.countResolvedTasks()`。
  - 组装 entries 后,**先排除** `resolvedTasks === universe`(且 universe > 0)的 entry,累加 `excludedCount`。
  - 把 `excludedCount` 传给渲染。
- `renderLineageSection(entries, excludedCount)` 改签名,分支:

| 情况 | 渲染 |
|---|---|
| 有存活(过冷启动)fragment | header + 口径行 + 列表 +(excludedCount>0 时)注释行 |
| 无存活,但 excludedCount>0 | header + 注释行(诚实告知「目前无判别信号」) |
| 无存活且 excludedCount==0 | 整段省略(`''`,同今天) |

注释行文案(zh,服务端预渲染、非 react-intl 路径,与现有口径行同样硬编码中文):

> `> 已排除 N 个全量加载(零存在方差)的 fragment:它们出现在每个已闭合任务里,merge 率等于团队 base rate,无判别力。`

> **i18n 说明**:飞轮信号段现有的口径行/标签均为服务端硬编码中文,不走 react-intl;本注释行沿用同一约定,**不**新增 locale key。

### 3.4 接线 — `task-context.service.ts`

`assembleLineageSection` 的 deps 里新增:

```ts
countResolvedTasks: () => lineageEdgeRepository.countResolvedTasks(),
```

CLI 无需改动(吃服务端预渲染 markdown)。

### 3.5 LineageTab

本阶段不改(不显示 merge 率)。实现时确认无 merge 率展示即收尾。

---

## 4. 数据流

```
task-context.service.getContextForIdentifier
  └─ assembleLineageSection(fragments, memoryContentById, deps)
       ├─ universe        = deps.countResolvedTasks()          // 新
       ├─ stats           = deps.mergeRateByFragments(refs)
       ├─ entries         = join + dedupe
       ├─ exclude         = entries where resolvedTasks === universe   // 新
       └─ renderLineageSection(survivors, excludedCount)              // 改签名
```

---

## 5. 边界与不变量

- `universe === 0`(全无 resolved 边):不排除任何东西(`resolvedTasks === 0` 不会等于已过滤的正数;且无 entry 时整段省略)。
- `universe === 1` 且某 fragment `resolvedTasks === 1`:会被排除,但它也 <3 冷启动门——本就不显示。无回归。
- 存活条件实际为:`resolvedTasks >= 3` 且 `resolvedTasks < universe` → 需要 `universe >= 4` 才可能有存活项。符合「样本够 + 有方差」直觉。
- 排除发生在去重之后,不影响边集本身(只影响渲染),与 LUM-279 的 writer-canonicalize 解耦。
- never-throws 契约保持:任何失败仍降级为 `''`。

---

## 6. 测试

`__tests__/lib/services/lineage-signal.test.ts`(补):
1. 全排除(所有 entry `resolvedTasks === universe`)→ header + 注释行,无列表项。
2. 部分排除 → 列表(存活项)+ 注释行;被排除项不出现在列表。
3. universe 边界:fragment 在 `universe - 1` 个任务(且 ≥3)→ 保留并显示。
4. excludedCount==0 且无存活 → `''`(整段省略)。
5. universe==0 → 不误排除(沿用现有空态)。

`__tests__/lib/repositories/lineage-edge.repository.test.ts`(补):
- `countResolvedTasks`:distinct taskId 计数;同一 task 多条边只计 1;`outcome == UNKNOWN` 的边不计入;混合 outcome 的 task 计入。

---

## 7. 范围外(刻意推迟)

- 阶段2(测「用了没」:agent 标注/事后检测实际引用的 fragment)——需新 schema/采集链。
- 阶段3(选择性加载 + 反事实,v2 真因果)。
- 比例阈值排除(本期用严格等于;bimodal 数据下结果相同)。
- LineageTab 的 merge 率展示(当前不存在)。
- workspace 级 universe 隔离(沿用 `mergeRateByFragments` 的全局口径)。
