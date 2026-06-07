# LUM-298 · Per-run / per-turn token cost on the「Agent 运行」tab (backend-first)

- **Task**: LUM-298 — Surface per-run / per-turn token cost on the 'Agent 运行' tab
- **Milestone**: Context Lineage (System of Record)
- **Date**: 2026-06-07
- **Status**: Design approved, pending spec review

---

## 1. Premise correction (the most important finding)

任务描述假设「AgentRunTab 渲染的是 `AgentRun` 模型,而成本在 `Session` 上,两套 run 概念必须先合并」。**这是个伪命题** —— 核对代码后:

- [`AgentRunTab.tsx`](../../../app/workspace/[workspaceUrl]/components/AgentRunTimeline/AgentRunTab.tsx) → `useAgentRuns` → [`agent-run-timeline.service.ts`](../../../lib/services/agent-run-timeline.service.ts) 的 `getTimeline()`。
- 该 service 用的是 **`Session` + `HookEvent`**:把每个 Claude Code Session 当作一个「Run #N」,再按 `STOP` 事件切成 turns([`segment-turns.ts`](../../../app/workspace/[workspaceUrl]/components/AgentRunTimeline/segment-turns.ts))。
- **`AgentRun` 模型在这条线里一次都没被读。**

结论:这个 tab 早已标准化到 **Session** 作为「run」单元,而 LUM-281 的成本(累计 token)正是落在 `Session` 上。所以:

- **「合并 run 单元」的架构决策历史上已被 UI 解决** —— 无需动 `AgentRun`。
- 「prod 14 个 `AgentRun` 全 NULL」与本 tab 无关(那是 agent-server 采集链,另一个 surface)。**排除出本任务范围。**

任务因此从「重构两套 run 概念」缩小为「**加 per-turn delta 采集 + 按 model 拆分 + 复用已有 Session 成本做展示**」。

## 2. 数据现实(已核对 schema + 真实 transcript)

| 层                                                         | token 现状                                                                                                                                                                                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Session` ([schema:1463](../../../prisma/schema.prisma))   | 有 `inputTokens/outputTokens/cacheReadTokens/cacheCreationTokens/loopCount`,**累计值**,每次 STOP 由 CLI 重读整 transcript **覆盖写** ([`session.repository.ts`](../../../lib/repositories/session.repository.ts))。→ per-run 成本零迁移即得。 |
| `HookEvent` ([schema:1400](../../../prisma/schema.prisma)) | **完全无 token 字段**,只有 STOP 行的 `turnSummary`。→ per-turn 需加列 + 采集。                                                                                                                                                                |
| `AgentRun`                                                 | 有 token 列但 prod 全 NULL —— 本 tab 不渲染,**范围外**。                                                                                                                                                                                      |

**Model 现实**(读真实 transcript `~/.claude/projects/*.jsonl`):

- assistant 条目带 `message.model` + `message.usage`,同条目。
- 40 个 session 抽样:~32 单 model、~6 **混合 model**(`opus+sonnet`、`opus+haiku+sonnet` 等)。
- 脏数据:`<synthetic>`(本地注入、无 API 成本)、裸别名 `opus`/`sonnet`/`haiku`(多半来自 Task 子 agent)。
- ⇒ 混合 session 把 token 加成一个总数 = 把 Opus 和 Sonnet 混在一起,**误导**。

## 3. 决策记录(已逐项确认)

1. **范围**:per-run(读已有 Session 列)+ per-turn(新 HookEvent delta)。**排除** AgentRun/agent-server NULL 修复。
2. **成本展示组件**:抽共享纯展示组件 `<TokenCostBreakdown>`,LineageTab 与 AgentRunTab 共用(行为等价,不改 lineage 成本语义)。
3. **展示密度 = B**:run/turn 显示总量 + 细分解条;run 展开给每 model 一块 4 行明细。loops 用**真实数字**(非 LUM-297 的 "n/a")。
4. **Model = 按 model 拆 token**(最深一档)。规则:**永远按 model 分组**;单 model = 一组(同今天 + model 名);多 model = 分列堆叠,**完全不显示跨 model 合计**。
   - 4a. 混合 model **完全不显示合计**(只标 `跨 model 不可比 · 不合计` chip)。
   - 4b. model 名显示**原始串** `claude-opus-4-8`(turn 行小字可去 `claude-` 前缀仅为省空间)。`<synthetic>` 跳过;别名保持原样。
   - 4c. **每个 turn 都标 model**。

## 4. 架构 / 数据流

数据流不变:`HookEvent POST → hook-event.service → session.repository(原子事务) → Session/HookEvent`;读侧 `agent-runs route → agent-run-timeline.service → 共享组件`。

### 4.1 采集层(CLI)

[`cli/src/lib/transcript-usage.ts`](../../../cli/src/lib/transcript-usage.ts) `sumTranscriptUsage`:

- 现在返回单个 flat `SessionUsage`。**改为返回 `{ total: SessionUsage; byModel: Record<string, SessionUsage> }`**。
- 遍历 assistant 条目时按 `message.model` 分桶累加;**跳过** `model === '<synthetic>'` 与无 usage 的条目。model 串保持原样(raw)。
- `total` = 各 model 之和(向后兼容)。

[`cli/src/lib/hook-runner.ts`](../../../cli/src/lib/hook-runner.ts) `augmentBodyWithUsage`:

- 折叠进 `_lumo_usage` 时**同时带 flat(=total) 与 byModel**:
  ```jsonc
  _lumo_usage: { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, byModel: { "<model>": { input, output, cacheRead, cacheCreation } } }
  ```
- 顶层 flat 字段保留 → 服务端现有 flat 提取器零改动仍可用(lineage 路径不受影响)。

### 4.2 Schema(一次 migration,2 个可空 JSON 列)

- **`Session`**:保留现有 flat 列 + loopCount(继续喂 lineage);**新增 `usageByModel Json?`** —— 累计 per-model map,每次 STOP 覆盖写(与 flat 同语义)。
- **`HookEvent`**:**新增 `usageByModel Json?`** —— **per-turn per-model delta**,仅在 STOP/STOP_FAILURE 行写。不加 flat delta 列;per-turn flat 总量在读侧由 JSON 求和派生(单一来源,避免冗余漂移)。
- 历史行留 null,**不 backfill**(沿用 LUM-281 口径)。
- Prod:纯加列、无数据破坏,需 `migrate deploy`(PR 描述注明);本地若漂移走 offline diff(见 memory)。

### 4.3 采集层(服务端)

[`session.repository.ts`](../../../lib/repositories/session.repository.ts) `upsertForHookEvent`:

- 非 STOP:保持便宜的单 upsert。
- **STOP 且带 usage**:改 `$transaction` —— 读旧 `{ flat 列, usageByModel }` → 逐 model 逐字段算 `delta = max(0, new[m][f] - (old.byModel?.[m]?.[f] ?? 0))`(clamp 防 transcript 压缩致累计变小;best-effort/never-throws) → 写新 flat(覆盖)+ 新 `usageByModel`(覆盖=新累计)+ `loopCount++` → 返回 `{ taskId, turnUsageByModel }`。
- 首个 STOP(旧全空)→ delta = 全量新累计(正确,即第 1 turn)。某 model 仅在 new 出现 → delta = 其全量(首次用该 model)。

[`hook-event.service.ts`](../../../lib/services/hook-event.service.ts) `recordHookEvent`:

- 接 `turnUsageByModel`,传入 `hookEventRepository.createHookEvent` 落到 `HookEvent.usageByModel`。
- `extractInjectedUsage` 扩展为同时解析 `byModel`(沿用 best-effort 数字归一)。

[`hook-event.repository.ts`](../../../lib/repositories/hook-event.repository.ts):`createHookEvent` 加可选 `usageByModel`;`findByTaskId` 的 `select` 加 `usageByModel`。

### 4.4 读取层

[`agent-run-timeline.service.ts`](../../../lib/services/agent-run-timeline.service.ts) `getTimeline`:

- `sessionRepository.listForTask` 的 `select` 加 `usageByModel` + `loopCount` → 映射 `AgentRunSession.cost`。
- STOP 类 HookEvent item 带上 `usageByModel`(delta)→ `AgentRunHookEvent.turnCost`。
- tab 级 `totals`:跨 session 按 model 聚合(同 model 求和;不同 model 不合并)。
- null 语义复用 `lineage-cost.ts` 的 `toCost` 思路:全空 → cost=null → 不渲染。

**Wire 类型**(service + [`types.ts`](../../../app/workspace/[workspaceUrl]/types.ts) 客户端副本):

```ts
interface ModelCost {
  model: string
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  total: number
}
interface RunCost {
  byModel: ModelCost[]
  loopCount: number | null
} // 无跨 model 合计字段
// AgentRunSession.cost: RunCost | null
// AgentRunHookEventItem.turnCost: { byModel: ModelCost[] } | null         // per-turn,loop 恒 1
// AgentRunTimelineResponse.totals: { runCount; turnCount; loopCount; byModel: ModelCost[] }
```

### 4.5 共享组件 `<TokenCostBreakdown>`

纯展示,放两个 timeline 都能 import 的中性位置。

- **Props**:`{ models: ModelCost[]; loopCount?: number | null; variant: 'full' | 'compact'; chips?: ChipDef[]; emptyHint?: ReactNode }`
- **渲染规则**:
  - `models.length === 1`:渲染 2xl 总量 + bar + 4 行明细;**model 名为空串时不显示名字**(lineage 即走这条,字节级保持现状)。
  - `models.length > 1`:堆叠每 model 一组(较小的 per-group 总量 + bar + 4 行),**不渲染跨 model 合计**。
  - `loopCount` 为数字 → 渲染真实「N loops」;为 `null`/缺省 → 渲染「loops n/a」chip(lineage 传 null,保持现状)。
- **持有**:`TOKEN_SEGMENTS` 调色板(chart-1..4,cache-read 用 `/40` 压低,静态字面量类)、bar、明细行、chips、空态。
- **LineageTab 改造**:lineage 是 session 级 flat、无 model 维度 → 构造 `models = [{ model: '', ...tokens }]`、`loopCount = null`、沿用原 chips → **渲染与今天等价**。现有 jsdom 快照/测试锁住不变。

### 4.6 UI 三处

1. **AgentRunTab 顶部**:`<TokenCostBreakdown variant='full' models={totals.byModel} loopCount={totals.loopCount} />` + 「N runs · M turns · K 个 model」行。混合 model 显示分列 + `跨 model 不可比 · 不合计` chip。
2. **AgentRunCard 头行**:`run.cost` 存在时,单 model → `4.1M tok` + 细条 + loops + model chip;多 model → `Opus 4.6M · Sonnet 0.9M`(不合计)+ loops;展开区给每 model 一块 4 行明细。配色走灰阶/typography,不引新彩色。`cost` 为 null → 不渲染。
3. **TurnCard 行**:terminated turn 显示 per-turn 成本(总量 + 细条 + 右下小字 model 名);多 model 的 turn 分列。无 `turnCost` → 静默不显示(**不显示 0**)。

### 4.7 i18n

- 新 `tokenCost.*`(组件自有,不耦合 lineage:`output/input/cacheCreate/cacheRead/unit/none/loops/loopsNa/mixedNoTotal`)+ `agentRun.cost.*`/计数键。
- LineageTab 的 `lineage.token.*` 迁到 `tokenCost.*`。
- 按 CLAUDE.md:`npm run i18n:sync` 后 **16 locale 全填真翻译**,不留 `[TODO]`。
- model 名 / outcome / fragmentType 等**裸数据不走 i18n**(沿用 LUM-297 口径)。

## 5. 单元边界与可测性

| 单元                             | 职责                                         | 测试                                                       |
| -------------------------------- | -------------------------------------------- | ---------------------------------------------------------- |
| `sumTranscriptUsage`             | transcript → `{total, byModel}`,跳 synthetic | per-model 分组、跳 synthetic、无 usage→null                |
| `upsertForHookEvent` (STOP 事务) | 算 per-model delta、覆盖累计、loopCount++    | delta=新−旧、clamp 负→0、首 STOP=全量、新 model 首现       |
| `hookEventService`               | 把 delta 落 HookEvent                        | STOP 存 `usageByModel`,非 STOP 不存                        |
| `agentRunTimelineService`        | 映射 per-model run/turn 成本 + totals        | 单/多 model 聚合、totals 不跨 model 合并、null→省略        |
| `<TokenCostBreakdown>`           | 纯展示                                       | 单 model(无名)/多 model(分列无合计)/loops 数字 vs n/a/空态 |
| `segmentIntoTurns` 消费          | turnCost 归到正确 turn                       | delta 挂到对应 STOP turn                                   |

## 6. 验证(memory:preview 连不上 localhost,不走浏览器)

- `npx tsc --noEmit`(抓 exactOptionalPropertyTypes / noUncheckedIndexedAccess)。
- Jest:上表全部 + **LineageTab 现有测试仍过**(行为等价回归)。
- `npm run lint:tokens`(chart-1..4、无 raw hex)。
- `npm run build`(Vercel 是唯一 CI gate)。
- i18n parity 测试(16 locale)。

## 7. 范围外(刻意)

- **$ 价格加权估算**(token→美元):任务已否。本设计只按 model 拆 token,为以后算钱留口子但不算。
- **AgentRun / agent-server token NULL 修复**:另一 surface,本 tab 不渲染 `AgentRun`。
- **AgentRun ↔ Session 模型合并**:延后的架构评审(memory `project_agentrun_vs_session_review`)。
- **LUM-297 lineage 成本语义**:维持现状(只做行为等价的组件抽取)。

## 8. 已知后续 / 技术债

- **model 别名归一**:裸 `opus`/`sonnet`/`haiku` 当前按原样显示;未来可映射到 canonical model id。
- **lineage 的 per-model**:`LineageEdge` 无 model 维度,lineage 面板暂只 flat(session 级);若要 lineage 也按 model 拆需另一版。
- **累计 `input_tokens` 跨 API 调用求和本身是个怪指标**(缓存重叠导致虚高)—— 继承自 LUM-281,本任务不改口径。
