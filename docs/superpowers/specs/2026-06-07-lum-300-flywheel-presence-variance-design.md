# LUM-300 · 修复飞轮归因:存在/使用方差,而非共同加载

**Task**: LUM-300 — Fix flywheel attribution: presence/use variance, not co-loading (prereq for LUM-279)
**Date**: 2026-06-07
**Scope**: 阶段1(presence-variance 排除)**+** 阶段2(agent 完结投票 usage 信号)。
**Milestone**: Context Lineage (System of Record)

---

## 0. 总览

飞轮信号(LUM-278)目前对几乎所有 fragment 非歧视。根因:盖章依据是「共同出现在 context bundle 里」,但 bundle 是**无差别全量加载**。「一起被加载」≠「起了作用」。需要两种方差,现在两种都缺;本任务两个阶段各补一种:

- **阶段1 — presence 方差(诚实过滤)**:把「出现在每一个已闭合任务里」的零方差 fragment 从飞轮排除。纯聚合+渲染,无 schema 变更。**这是 LUM-279 的硬前置**,先做、可独立 ship。
- **阶段2 — use 方差(真信号)**:在任务完结时让 agent 投票「实际用了哪些注入的 fragment」,把 `used` 盖在边上;飞轮改成在「真用了的子集」上算 merge 率。需要加性 schema + 采集链 + wrap 流程改造。

**实现顺序**:阶段1 完整、可 ship 之后再做阶段2;commit 严格 Stage1-first,使其在任何节点都能单独切出去解锁 LUM-279。

---

## 1. 现状(已核对代码)

- merge 率信号 `## 飞轮信号 · 历史 merge 贡献` **只存在于 task-context 的 markdown 输出**(服务端 `assembleLineageSection` 预渲染,CLI 直接打印)。[LineageTab.tsx] 只渲染每条边的 outcome,**不显示 per-fragment merge 率** → 全程不改。
- [`lib/services/lineage-signal.ts`]:`renderLineageSection(entries)` 仅按冷启动门 `resolvedTasks >= LINEAGE_MIN_RESOLVED_TASKS`(=3)过滤,**无 presence/use 方差过滤**。`assembleLineageSection(fragments, memoryContentById, deps)` never-throws(失败降级 `''`)。
- [`lib/repositories/lineage-edge.repository.ts`]:`mergeRateByFragments(refs, tx?)` 按 task 去重;`resolved` = 某 (fragment,task) 有任一 `outcome != UNKNOWN` 的边;`merged` = 任一 `outcome == MERGED`。**不按 workspace 隔离,全局按 fragment ref 查询**。
- **LineageEdge 模型**(prisma/schema.prisma):grain = `(sessionId, taskId, fragmentType, fragmentId)`,`@@unique([sessionId, taskId, fragmentType, fragmentId])`;字段 `workspaceId/taskId/fragmentType/fragmentId/sessionId?/runId?/includedAt/outcome/updatedAt`。**目前无 used/helpful 字段**。
- **边出生**:session-start hook(`app/api/hooks/session-start/route.ts`)各 builder emit `FragmentRef[]`(实际注入、post-budget),经 `lineageService.recordSessionStartEdges()` → `createMany({skipDuplicates})`。**边本身就是「本 session 注入了哪些 fragment」的记录** → wrap 投票的候选清单从这里来。
- **session wrap**(`cli/src/commands/session-wrap.ts`):三段面板 `ProgressCommentSection / MemoryReviewSection / BlockedPromptSection`,每段 `GET draft → 展示 → POST apply + watermark`(`runWrapPanel({yes, dryRun})`)。

**现状交互(重要)**:阶段1 落地后,当前 prod 数据(5 个已闭合任务、106 个 fragment 出现在全部 5 个)下,presence 信号会变「空+注释」——这是诚实状态。阶段2 的 usage 信号需要积累投票数据后才逐步点亮。

---

## 2. 阶段1 — presence 方差(诚实过滤)

### 2.1 口径(已对齐)
- **universe** = 「有 ≥1 条 `outcome != UNKNOWN` 边」的 **distinct taskId 数**(全局,与 `mergeRateByFragments` 的 resolved 定义一致)。
- **零方差排除 = 严格等于**:`resolvedTasks === universe` → 排除(出现在每个已闭合任务 → merge 率定义上就是 base rate)。
- 冷启动门 `>= 3` 不变,叠加在排除之后。
- **透明**:排除后追加一行注释,告知排除数量。

### 2.2 Repository — `lineage-edge.repository.ts`
新增 `countResolvedTasks(tx?): Promise<number>`:`groupBy({ by:['taskId'], where:{ outcome:{ not:'UNKNOWN' } } })` 取 `.length`(distinct taskId 计数)。

### 2.3 Service — `lineage-signal.ts`
- `LineageSignalDeps` 新增 `countResolvedTasks: () => Promise<number>`。
- `assembleLineageSection`:取 `universe`,组装 entries 后**先排除** `universe > 0 && resolvedTasks === universe` 的 entry,累加 `excludedCount`,传给渲染。
- `renderLineageSection(entries, excludedCount)` 改签名,三分支:有存活 → header+口径行+列表+(excludedCount>0)注释;无存活但 excludedCount>0 → header+注释;否则 `''`。
- 注释行(服务端硬编码中文,**不**走 react-intl,沿用现有口径行约定):
  `> 已排除 N 个全量加载(零存在方差)的 fragment:它们出现在每个已闭合任务里,merge 率等于团队 base rate,无判别力。`

### 2.4 接线 — `task-context.service.ts`
`assembleLineageSection` 的 deps 加 `countResolvedTasks: () => lineageEdgeRepository.countResolvedTasks()`。CLI 不改。

---

## 3. 阶段2 — use 方差(agent 完结投票)

### 3.1 口径(已对齐)
- **投票机制**:折进 `session wrap`,候选 = 本 session 出生的边;agent 勾选用过的。
- **未用记 false**:勾中 → `used=true`,其余(本 session 候选)→ `used=false`;未投票的 session 边保持 `null=未知`。→ used 既有正例也有负例,才能算 use 方差。
- **渲染优先级**:每个 fragment 优先显示 usage-based merge 率(够样本时),不够回退到阶段1 过滤后的 presence-based。两者明标口径。

### 3.2 Schema(加性,非破坏)
`prisma/schema.prisma` 给 `LineageEdge` 加:
```prisma
used   Boolean?  // null = 未投票, true = agent 报告用过, false = 注入但未用
usedAt DateTime? // 投票时间;用于"本 session 是否已投过"判定(免新 Session 列)
```
迁移仅新增两个可空列,无数据删除。**prod 需在下次 deploy 跑 `migrate deploy`**(PR 描述注明)。

### 3.3 Repository — `lineage-edge.repository.ts`
1. `findSessionFragmentEdges(sessionId, tx?)`:返回本 session 的边(`fragmentType, fragmentId, used`),供 wrap 候选清单。
2. `applyUsageVote(sessionId, usedRefs: FragmentRef[], tx?)`:在该 session 的边里,`ref ∈ usedRefs` 的置 `used=true`,其余置 `used=false`,统一 `usedAt=now()`。返回 `{ used, unused }` 计数。最后写胜(可重复投票)。
3. `usageMergeRateByFragments(refs, tx?): Promise<FragmentUsageRate[]>`:同 `mergeRateByFragments` 的 task 去重逻辑,但 **(fragment,task) 仅在该对存在 `used=true` 边时计入**。返回 `{ fragmentType, fragmentId, usedResolvedTasks, usedMergedTasks }`(`usedResolvedTasks` = used=true 且 resolved 的去重任务;`usedMergedTasks` = 其中 merged)。

### 3.4 Service — `session.service.ts`
- `getFragmentUsageDraft({ identity, sessionId })`:鉴权后取 `findSessionFragmentEdges`,补 MEMORY 标签(复用 memory 内容查询),返回 `{ taskIdentifier, candidates: [{ fragmentType, fragmentId, label, used }], alreadyVoted: boolean }`(`alreadyVoted` = 任一候选 `usedAt != null`)。
- `applyFragmentUsage({ identity, sessionId, usedRefs })`:session-scoped 鉴权(只允许本 session 的边),调用 `applyUsageVote`,返回 `{ used, unused }`。

### 3.5 API
- `GET /api/sessions/[sessionId]/fragment-usage` → `getFragmentUsageDraft`。
- `POST /api/sessions/[sessionId]/fragment-usage`,body `{ usedRefs: { fragmentType, fragmentId }[] }`(Zod,max 200) → `applyFragmentUsage`。
- 两路由 `verifyBearer` + thin handler,模式与现有 `memory-review` 路由一致。

### 3.6 CLI — `session-wrap.ts` + 新 section
- 新增 `FragmentUsageSection`(第四段,排在 MemoryReview 后、Blocked 前)。流程:`GET fragment-usage` 列出候选(`[idx] [TYPE] label`)。
- **agent 投票方式(非交互)**:wrap 新增 `--used <handles>` flag(逗号分隔候选序号/短 id;`--used none` = 全部未用)。
  - 传了 `--used` → 解析为 `usedRefs`,`POST` 应用。
  - 未传 `--used`(含 `--yes` 默认)→ 仅打印候选 + 一行提示「用 `lumo session wrap --used <序号>` 记录实际使用」,**不写库**(边保持 null=未投票,诚实)。
  - `alreadyVoted` 为真 → 跳过(打印「本 session 已投票」),避免重复 prompt。
  - 重跑 wrap 因 Progress/Memory 走 watermark,是幂等的;usage 最后写胜。
- **SKILL 同步**(CLAUDE.md 强制):更新 `.claude/skills/lumo/SKILL.md`(wrap 触发词/flag)+ `references/sessions.md`(wrap 第四段说明 + `--used` 用法 + 投票口径),指导 agent 在 wrap 时判定并传 `--used`。

### 3.7 Service 渲染 — `lineage-signal.ts`(阶段2 增量)
- 新增 `LINEAGE_MIN_USED_TASKS = 3`(usage 冷启动门)。
- `LineageSignalDeps` 加 `usageMergeRateByFragments: (refs) => Promise<FragmentUsageRate[]>`。
- `assembleLineageSection`:对每个存活 fragment,若 `usedResolvedTasks >= LINEAGE_MIN_USED_TASKS` → 标记为 usage entry;否则走阶段1 的 presence entry(并参与零方差排除)。
- 渲染区分两类行,口径明标:
  - usage:`- [MEMORY] "…" — 用过的 4 个已闭合任务·3 merged (75%) · 真实使用信号`
  - presence(回退):`- [MEMORY] "…" — 出现在 5 个已闭合任务·4 merged (80%) · 仅共同加载,弱信号`
- 口径说明行同步补一句:usage 优先,presence 为回退弱信号。
- **签名演进**:阶段1 落地时 `renderLineageSection(entries, excludedCount)`;阶段2 扩为 `renderLineageSection(usageEntries, presenceEntries, excludedCount)`(usage 行在前、presence 回退行在后)。Stage1-first 的 commit 用前者,阶段2 的 commit 改签名并更新调用点+测试。

---

## 4. 数据流

```
task-context.service.getContextForIdentifier
  └─ assembleLineageSection(fragments, memoryContentById, deps)
       ├─ universe   = deps.countResolvedTasks()                 // 阶段1
       ├─ presence   = deps.mergeRateByFragments(refs)
       ├─ usage      = deps.usageMergeRateByFragments(refs)      // 阶段2
       ├─ per fragment: usage(够样本) ?? presence(零方差排除后)   // 优先 usage 回退 presence
       └─ renderLineageSection(usageEntries, presenceEntries, excludedCount)

session wrap (agent)
  └─ FragmentUsageSection
       ├─ GET  /api/sessions/[id]/fragment-usage  → 候选(本 session 的边)
       └─ POST /api/sessions/[id]/fragment-usage  → applyUsageVote → 边 used=true/false
```

---

## 5. 边界与不变量
- never-throws 契约保持:`assembleLineageSection` 任何失败仍降级 `''`。
- `universe===0` / 无 entry:整段省略(不误排除)。
- 存活(presence 显示)条件:`resolvedTasks >= 3 且 < universe` → 需 `universe >= 4`。
- usage 投票最后写胜;`--used` 缺省不写库;`usedAt` 兼作「已投票」判定,免 Session 新列。
- 排除/usage 选择只影响**渲染**,不动边集本身(与 LUM-279 writer-canonicalize 解耦)。
- 迁移加性,无数据删除。

---

## 6. 测试
**阶段1** — `__tests__/lib/services/lineage-signal.test.ts`:全排除→header+注释、部分排除→列表+注释、universe 边界(在 universe-1 个任务且≥3→保留)、excludedCount==0 且无存活→`''`、universe==0 不误排除。`lineage-edge.repository.test.ts`:`countResolvedTasks` distinct 计数 + 排除 UNKNOWN + 多边同 task 计 1。
**阶段2** — repository:`applyUsageVote`(used/unused 正确盖、最后写胜、仅限本 session 边)、`usageMergeRateByFragments`(仅 used=true 的 (fragment,task) 计入、task 去重、排除 UNKNOWN)。lineage-signal:usage 够样本→显示 usage 行、不够→回退 presence 行、两类共存渲染口径。session.service:`getFragmentUsageDraft`(候选+label+alreadyVoted)、`applyFragmentUsage`(session-scoped 鉴权)。CLI:`FragmentUsageSection` 传 `--used`→POST、缺省→只列不写、alreadyVoted→跳过。API route:GET/POST 鉴权 + Zod。

---

## 7. 范围外(刻意推迟)
- 阶段3(选择性加载 + 反事实,v2 真因果)。
- 事后 LLM judge 投票(本期用 agent 自报)。
- 比例阈值排除(本期严格等于;bimodal 数据下结果相同)。
- usage 自报的事后合理化偏差(已知债;干净解只有阶段3)。
- workspace 级 universe 隔离(沿用 `mergeRateByFragments` 全局口径)。
- LineageTab 的 merge 率/usage 展示(当前不存在)。

---

## 8. 已知风险
- **usage 自报偏差**:成功的 agent 易事后合理化「我用了那条好记忆」,可能把「声称用了」与「成功」spurious 绑定。比共同加载强很多,但非干净因果信号(§7 阶段3 才解)。spec 中口径行已标「真实使用信号 / 弱信号」以示透明。
- **agent 投票覆盖率**:`--used` 缺省即不投票 → 早期 usage 数据稀疏,长期靠 SKILL 引导 agent 养成 wrap 投票习惯。
