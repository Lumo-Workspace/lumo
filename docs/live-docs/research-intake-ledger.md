# Lumo 研究吸收登记册(Research Intake Ledger)

> **定位**:Lumo 吸收外部研究的唯一登记处——活文档,持续追加。每篇被评估的论文在此留一条记录(key finding → Lumo 吸收了什么 → 落地位置),被拒绝/出界的也登记(防止重复评估)。内部实证发现(eval/活验产出的数字)同样登记,它们是后续吸收的先验。
>
> 首批条目来自 2026-06 的 agent-memory 综述(11 篇 → Memory v6 milestone 8 任务全部上线)。

---

## 0\. 录入规范(新论文照此处理)

**层次过滤(先于一切)**:

- **模型内核层**(context scaling、attention 变体、RL 训记忆、prompt tuning)→ 忽略,交给模型厂商;
- **Agent 工程层**(memory artifacts、生命周期、approval、observability、eval)→ **Lumo 战场,进入评估**;
- **应用/编排层**(multi-agent orchestration、research systems)→ Lumo 不做完整编排,大部分跳过。

**评估纪律**:

1.  每篇只问一句:**它对 Lumo 哪个悬而未决的设计决策有 bearing?** 没有 bearing 的「知道存在」即可,不读全文。
2.  **先测后定**:论文主张落到 Lumo 前,若可测,先在 Lumo 数据上实测再决策(本册已有两次实测推翻预设的先例)。
3.  **defer 优于 adopt**:加性、以后加便宜的东西不预先占位(「保险字段」是 hedge 不是 decision)。
4.  划界与吸收同样重要——出界的也要登记,写明为什么。
5.  吸收产物按 Lumo 自己的 memory schema 归档:证实选择→DECISION,揭示坑→TRAP,给出范式→PROCEDURAL。

**判定标签**:`[采用]`(机制落地)· `[反用]`(取其反面教训)· `[纠偏]`(主张被修正后采用)· `[合并]`(与他篇同源,并入)· `[出界]`(不属 Lumo 层次)· `[观望]`(有 bearing 但触发条件未到)。

**周期追踪源**:[VoltAgent/awesome-ai-agent-papers](https://github.com/VoltAgent/awesome-ai-agent-papers) 可作每周扫描入口。筛选判别力提示:**「有没有消融表」比「分类是否对口」更可靠**——2606 周扫实证:证据最薄的恰是概念最华丽的两篇(SSGM 零实验、AI Harness n=1)。

**全文精读核验纪律**:subagent 经 WebFetch 抓 PDF 的转述层会编造数字、表格甚至整组结论(2606b 批次 8 路精读 3 路命中,均靠 abs/ar5iv 双源对照拦下)——关键数字必须双源核验,单源数字进册须标「单源」。

**条目模板**(追加新论文时复制;来源 id 带链接——arXiv 用 `https://arxiv.org/abs/<id>`,blog/报告直接链原文):

```
**论文名** ([arXiv id 或来源](链接)) — [标签] → 落地任务/决策 · 登记日期
- Finding: 它发现了什么(带关键数字)。
- 吸收: Lumo 学到/采纳/拒绝了什么,为什么。
```

---

## A. 记忆机制(Memory)

### A1 · 写入与去重(reconcile-on-write)

**Mem0** ([2504.19413](https://arxiv.org/abs/2504.19413)) — \[采用\] → LUM-324 · 2026-06

- Finding: 两阶段生产级写入——抽取(滚动摘要+最近 10 条)→ 更新(对 top-10 向量相似记忆做 ADD/UPDATE/DELETE/NOOP)。LOCOMO J 66.88% 逼近全量 72.90%,p95 延迟 −91%(1.44s vs 17.1s)、token −90%(7k vs 26k)。
- 吸收: Lumo 既有两层管线与之同构 → **骨架免重构**;只补「写入前邻居调和」一环。落地为两段式 reconcile-on-write + pgvector 语义检索。

**A-MEM** ([2502.12110](https://arxiv.org/abs/2502.12110)) — \[反用\] → LUM-325 supersede-guard · 2026-06

- Finding: Zettelkasten 式自主记忆:note(上下文/关键词/tags)+ 自动链接 + memory evolution(新记忆回写改旧记忆),6 基模超 SOTA。
- 吸收: **拒绝 evolution**——Lumo 飞轮靠记忆身份与 merge-rate 历史稳定,静默回写毁信号。只取反面护栏:「别静默改写高信任记忆」(强 usage 信任裁决拒绝被 SUPERSEDE)。

**ProMem** ([2601.04463](https://arxiv.org/abs/2601.04463)) — \[采用:grounding 前置\] → LUM-396 · 2026-06

- Finding: 记忆抽取加 grounding 检查(quote-or-discard):每条候选必须引用源材料支撑片段,无依据即丢弃。8B 档位验证机制保留(integrity +12.5、accuracy 几乎不掉)——真实作用是让「激进多抽」在 accuracy 不掉的前提下成立,不是万能消毒。
- 吸收: 对口 Lumo 真实痛点(幻觉,不是漏抽):`manual-dedup.ts:108` 无邻居零 LLM 直接 ADD,幻觉候选只要足够新颖即零审查入库。落地为 extract → ground(**batched 一次调用**,不照搬论文逐条追问+全文重读)→ reconcile,顺序硬约束——幻觉候选若先进 reconcile 可能 SUPERSEDE 掉存量好记忆;fail-open 不阻塞 fire-and-forget 写路径;LUM-329 harness 验收(新增幻觉 fixture case)。**不做**补漏模块 MC(Lumo 4 类 schema 是刻意有损压缩,痛点不是漏抽)、不抄论文阈值(τ 是 8B embedding 上调的,batched 版不需要)。

### A2 · 生命周期与遗忘

**MemGPT** ([2310.08560](https://arxiv.org/abs/2310.08560)) — \[采用\] → LUM-325/328 · 2026-06

- Finding: OS 虚拟内存分层(main working+FIFO / recall / archival);70% context 警告、100% flush、驱逐 50% 递归摘要;agent 自编辑各层。
- 吸收: 冷数据**归档而非硬删**、按压力分页 → MemoryStatus 三态(ACTIVE/SUPERSEDED/ARCHIVED)。Lumo 改进:淘汰信号用「被证明无用」(merge-rate/usage)而非 recency,比 FIFO 精确。

**Zep / Graphiti** ([2501.13956](https://arxiv.org/abs/2501.13956)) — \[纠偏:只借一半\] → LUM-325 · 2026-06

- Finding: 时序知识图谱 + **bi-temporal**(事件时间 valid/invalid + 摄入时间 created/expired),矛盾时旧边置失效而非删除。DMR 94.8% vs MemGPT 93.4%,LongMemEval +18.5%。
- 吸收: 失效模型采纳(validFrom/supersededAt/supersededById,SUPERSEDE = 失效不删 + provenance 链);**图结构拒绝**——对 Lumo 规模(每项目几百条工程教训)过度工程,DMR 仅领先 1.4 分且收益对应 Lumo 没有的实体-关系查询负载。

**MemoryBank** ([2305.10250](https://arxiv.org/abs/2305.10250)) — \[采用+实证修正\] → LUM-328 · 2026-06

- Finding: Ebbinghaus 遗忘曲线 `R = e^(−t/S)`,S 初始 1、每召回 +1 且 t 归零(间隔重复→越用越难忘)。
- 吸收: 「召回」映射为 Lumo 的 usage 投票(S = 1 + usedTasks)。**实证修正**:prod 语料 0 行 >30 天,t 项当前无判别力 → v1 排序以 usage-rate 为主,衰减项留公式里等语料老化生效。

**Memory OS** ([2506.06326](https://arxiv.org/abs/2506.06326)) — \[合并→MemoryBank\] → LUM-328 · 2026-06

- Finding: 三层 STM/MTM/LPM + heat-based 分段页替换,LOCOMO F1 +49.11%。
- 吸收: 其 heat ≡ MemoryBank strength ≡ Lumo usage 投票——同一信号三个名字,识别同源、并入一个任务,不重复造机制。

**BeliefMem** ([2605.05583](https://arxiv.org/abs/2605.05583)) — \[采用:审计警告,裁决不修\] → LUM-395 · 2026-06

- Finding: 信念记忆的 **self-reinforcing error** 警告:被降权的记忆得不到注入机会 → 拿不到使用证据 → 被进一步降权直至淘汰,「曾被矛盾/降权但其实正确」的记忆没有翻案通道。机制面:CONTRADICT op + 竞争组共同注入 + noisy-OR 信念聚合。
- 吸收: 警告映射到 Lumo 现存链:LUM-279 ranking 降权 → LUM-314 投票饥饿(used 恒 NULL)→ LUM-328 冷淘汰 ARCHIVED,四类豁免不含「被降权」。measure-first 审计([PR#469](https://github.com/Lumo-Workspace/lumo/pull/469),prod 快照 2026-06-10,审计本身是交付物):**死亡螺旋未发生**——tier-2(proven-low)=0、never-injected=0(merge base rate ~100% 使 presence 口径下几乎全 tier-0,ranking 只重排不丢卡)、at-risk 池=0(四类豁免全覆盖,出 freshness 的 12 条全靠真实投票存活)、ARCHIVED 存量仅 1 条且零链关联、无错杀证据。**裁决不修**,三候选修法(竞争组豁免/保底注入轮换/复活通道)全否决。审计脚本 `scripts/analysis/lum395-flywheel-rehab/audit.ts` 只读可重复,**~2026-07-10 复跑**(40 条「仅 freshness+零投票」行 06-17~24 出窗;若 wrongful-kill suspects>0 优先重审复活通道——archive 本可逆,status flip 即复活)。第二层机制(CONTRADICT op/竞争组/noisy-OR)等复跑数据再裁决,进 F 队列。

**SSGM** ([2603.11768](https://arxiv.org/abs/2603.11768)) — \[观望:只取归因词表\] · 2026-06

- Finding: 记忆失效二分归因词表:**hallucination**(写入即假)vs **obsolescence**(写入为真后失效)。零实验零实现——本批证据最薄、概念包装最完整的一篇。
- 吸收: 机制层**明确不做**:invalidate-not-delete / later-fact-wins Lumo 已落地(LUM-325)且超前于该文。只收归因词表:三段 waterfall(SubtleMemory)的 Preserve 段「没存好」可再拆一层,判别信号 = supersededAt 链(有链=曾为真后失效,无链直接错=写入即假)。触发器:waterfall 归因实际需要拆 Preserve 段时。

**Agent Memory characterization** ([2606.06448](https://arxiv.org/abs/2606.06448)) — \[观望\] · 2026-06

- Finding: agent 记忆系统成本特征刻画:phase-tagged 成本遥测(construction/retrieval 分相计量)+ reconcile 边际成本随库规模上升的斜率;称 harness 将开源。
- 吸收: 两个候选机制只记不开任务:① phase-tagged 成本遥测(construction/retrieval/flywheel 枚举);② **reconcile 边际成本斜率作为 compaction 的量化触发器**(当前 LUM-328 阈值 >100 是经验值)。**不做** GPU/能耗遥测(Lumo 全托管 gateway,不适用)。触发器:harness repo 开源后评估复用,或 compaction 阈值需要量化校准时。

### A3 · 结构与表示

**On the Structural Memory of LLM Agents** ([2412.15266](https://arxiv.org/abs/2412.15266)) — \[纠偏\] → LUM-327 决策 · 2026-06

- Finding: 4 结构(chunks/triples/atomic-facts/summaries)+ mixed × 3 检索 × 6 数据集系统对比:mixed 最均衡抗噪;triples/atomic 利于关系推理;**iterative retrieval 几乎全任务最优**;检索条数过大引噪声。
- 吸收: 关键纠偏——它的「4」是结构粒度,Lumo 的「4」(TRAP/DECISION/CONVENTION/PROCEDURAL)是语义类型,**两个 4 不能混**。Lumo 记忆 ≈ atomic-fact+summary 已在稳健端 → **prose-only 够,关系机制 defer 到出现具体消费方**(带触发器,不占 schema)。

### A4 · 检索与嵌入(含内部实证)

**\[内部实证\] LUM-329 eval 校准** · 2026-06

- `EMBEDDING_SCORE_FLOOR` 0.6→**0.78**(F1 拐点,n=39);floor 与模型耦合,换模型必须重扫。
- **qwen3-embedding-0.6b 优于 4B/8B**(recall@1 0.718 vs 0.692/0.590)——维度大≠分离好,小模型够用就别上大。
- **recall@k 在 Lumo 池规模不判别**(lexical/embedding recall@10 都 1.0)→ 升级触发改 pool-size 启发式。
- **检索是候选生成器,不是精筛**:校准后 AR precision 仅 0.478,系统靠 reconcile LLM 终判兜底(SF 非冲突保护 1.000)。两级各司其职。

**\[内部实证\] LUM-336 跨语言测量** · 2026-06

- ZH↔EN 同义对余弦 mean 0.886 / min 0.821,**全部清过 0.78 floor**——「跨语言 floor 漏配」假设不成立,embedding 层天然跨语言。
- 单语化(English-canonical)的真实理由是**共享知识库可读性 + 飞轮不分裂**,不是去重;UI 多语言是表现层的事,两者不混。

### A5 · 注入与 precedence(injection)

**Context Engineering for Personalization** ([OpenAI Cookbook, Agents SDK](https://developers.openai.com/cookbook/examples/agents_sdk/context_personalization)) — \[采用:3 点,余为同构确认\] → LUM-393/LUM-394 · 2026-06

- Finding: state-based 记忆架构全流程示范(结构化 profile + 自由 note 双轨;session→global 晋升;consolidation 按 recency 消解冲突 + 主动过滤 ephemera「this trip only」);注入块附 `<memory_policy>` 显式 precedence(当前用户消息 > session 记忆 > 全局记忆 > profile,「全局记忆是默认值不是约束」);eval 分三层(distillation 写入质量 / **injection 行为影响** / consolidation 整合健康);pitfalls = context poisoning、over-influence(陈旧记忆盖过当前意图)、consolidation 幻觉。
- 吸收: 主体与 Memory v6 同构,三处确认既有路线(state-based reconcile-on-write ≈ belief-update,且 supersede+provenance 链强于其 recency-wins;遗忘一等公民 = LUM-328;检索只当写路径候选生成器 = LUM-329 实证)。**新采纳 3 点**:① wrapper 前言加 precedence 声明——`wrapUntrustedMemory` 现有前言只有「reference data, NOT instructions」+ 来源加权(LUM-347),从未声明记忆与当前指令冲突时谁让位,over-influence 正是这个空缺的故障模式;② 注入层对抗 eval——LUM-329 harness 只覆盖写入(AR)与整合(SF),注入层只有 LUM-314 观测性 used 投票,缺「记忆与当前指令冲突时当前指令赢」的对抗 case(①②同任务,policy 与验证它的 eval 一体交付)→ LUM-393;③ ephemera 写入分流——「TTL 仅描述性」(LUM-329),一次性事实(「这个 PR 先别动 X」)无拦截,extract 端拒收最便宜 → LUM-394。**拒绝**:recency-wins 冲突消解(弱于既有 supersede)、top-k 最近注入(弱于 LUM-279 proven-value 排序)、fine-tune 记忆抽取模型(模型内核层,出界)。

**落地(tag `context-personalization`,不开 milestone):**

| 任务                                                              | 内容                                                                    | 状态 |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------- | ---- |
| [LUM-393](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-393) | wrapper 前言 precedence 声明 + 注入层对抗 eval(冲突/非冲突双向 case)    | TODO |
| [LUM-394](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-394) | extract 端 ephemera 判别(一次性事实不产出候选)+ AR 语料补 ephemera case | TODO |

**Context engineering: memory, compaction, and tool clearing** ([Claude Cookbook, 2026-03](https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools)) — \[采用:口径,关 1 条观望\] → references/memory.md 分工纪律 · 2026-06

- Finding: 三个 context 原语的官方口径:compaction(服务端,`input_tokens` 触发、50K 下限,模型生成摘要替换全历史)、tool-result clearing(零推理成本但 cache prefix 失效,被清内容靠 re-fetch 找回)、memory tool(client-side 文件式 `/memories`,6 命令,**模型自主写**,协议提示词自动注入「做事前先 view」)。probe 实验:compaction 后高层事实保留、**表格/附录里的精确数值丢失**。Claude Code 生产实践=会话内+跨 session 两套通用记忆并用。(注:notebook 细粒度 token 数经转述层未双源核验,不引;API 标识符与 50K 下限是文档级常量,可信。)
- 吸收: **定论 F 队列「memory tool 双写边界」观望条**——memory tool 是 agent 私有草稿纸(未 ground、自由写、无治理无飞轮),Lumo memory 是领域结构化 + extract→ground→reconcile + 飞轮的团队记忆面,**分层不双写、不吸纳**(把 `/memories` 草稿搬进 Lumo = 绕过 grounding 引幻觉源,正是 LUM-396 要挡的);纪律落 `.claude/skills/lumo/references/memory.md`。compaction 丢精确数值 → 「精确 usage 只走结构化事件流、不信压缩后摘要」(LUM-340/345 既有教训获官方印证)。mid-session 语义检索的定位 = 为被 clear/compact 掉的内容提供按需召回,留观望、触发器细化(见 F 队列)。

---

## B. 评测与 Harness(Evaluation)

**SubtleMemory** ([2606.05761](https://arxiv.org/abs/2606.05761)) — \[采用框架\] → Memory v6 起点 + 三段归因 · 2026-06

- Finding: 关系记忆辨别 benchmark(互补/微差/冲突三类受控变体埋进 ~211K token 历史,测 11 系统):全员远低于 oracle(70% vs 85.4%);**冲突类最难**(oracle+最强模型仅 68.7%);保留原始交互的系统保真最高(93.5%);Preserve/Retrieve/Answer 三段 waterfall 归因。
- 吸收: 冲突处理真空成为整条 Memory v6 的起点;三段归因成为 Lumo 度量蓝图(Preserve=抽取+reconcile,Retrieve=检索+注入,Answer=使用+飞轮)。

**MemoryAgentBench** ([2507.05257](https://arxiv.org/abs/2507.05257)) — \[采用,小修\] → LUM-326/329 · 2026-06

- Finding: 认知科学四能力(Accurate Retrieval / Test-Time Learning / Long-Range Understanding / **Selective Forgetting**)+ FactConsolidation(counterfactual edit pair,later-fact-wins)。**没有系统同时掌握四能力,SF 普遍最弱**。
- 吸收: 四能力当自检镜子(LRU 对 Lumo N/A,只测 AR/TTL/SF);FactConsolidation 构造直接照搬为冲突测试 fixture。**方法论:管道不变式用确定性测试(mock LLM 决策),LLM 判别质量用 key 门控 eval——两层不混。**

**LOCOMO** ([2402.17753](https://arxiv.org/abs/2402.17753)) — \[纠偏:借管线不借分数\] → LUM-329 · 2026-06

- Finding: 超长期对话评测(persona + 因果 temporal event graph + 人工校验,50 段/300 轮/35 session):长上下文与 RAG 提升 22–66% 仍落后人类 56%,时序推理落后 73%,adversarial 弱 83%。
- 吸收: 域(人格陪伴聊天)与 Lumo(工程教训)不匹配 → **借生成管线方法自建域内集,绝不套用其分数**。「benchmark 选型」的正确答案永远是先查域匹配。

**\[内部实证\] Lumo eval harness 基线** (LUM-329) · 2026-06

- 54 条域内统一语料(`{existing, candidate, relationship, expectedOp}` 一条双驱动 AR+SF,标注减半、两层口径强制一致)。
- **两行 headline 模式**:回归线(AR F1@0.78 = 0.611,离线冻结 fixture,CI 可门控)+ 质量线(SF op-accuracy 0.98/0.91,SUPERSEDE recall 1.000,key 门控活验)——离线守数学,活验守质量,职责不混。
- TTL 用 used 投票当 proxy → **降级为描述性统计**(无 ground truth 的指标不与有 ground truth 的并列)。
- eval 的真实回报:三条校准回改生产 + 暴露 LUM-335 schema drift(生产静默数据丢失)。**harness 是缺陷放大器,不是仪式。**

**ProdCodeBench** ([2604.01527](https://arxiv.org/abs/2604.01527),Meta;v2 已改名 REAP/Harvest,旧版数字勿引) — \[采用:口径警告\] → LUM-397 · 2026-06

- Finding: **merged ≠ ground truth**——merge 只是筛选漏斗入口,叠加执行验证才出可信信号;对 revert 也无显式处理。
- 吸收: Lumo 飞轮把 DONE 当终点信号是更弱口径 → LUM-397 两子项:① outcome 强弱分层 `MERGED_VERIFIED`(存在全 PASS verification round)/`MERGED`,stamp 双路径(DONE 即时 + cron sweep)口径一致,**先落数据不改算分**(样本量够了再议加权);② Memory 出生任务记账(sourceTask 列,现状 Provenance 反查不到出生 task),为 same-task self-credit 排除铺路。**不做**其测试检索基建(前提是 Meta 量级存量测试资产,LUM-343 criteria 验收是 Lumo 的对应形态);其对 revert 无显式处理反印证 LUM-296 DONE-only 口径合理。

**c-CRAB** ([2603.23448](https://arxiv.org/abs/2603.23448)) — \[观望→Acceptance Slice2/3\] · 2026-06

- Finding: 验收 criteria 可验证性分类 + **fail-then-pass 绑定**(criterion 先见 FAIL 再见 PASS 才算真验证)+ 评审期新增标准固化进合约;端到端固化率预期 ~18%,structural check 是覆盖主体。
- 吸收: 归 Acceptance Slice2/3 方向,届时是该 milestone 的核心方法论:可验证性分类细化 MACHINE/HUMAN 二分;fail-then-pass 对应 REVIEW_ADDED 固化飞轮——**check 应编码「问题不复现」,勿编码「特定修复存在」**。现在不开任务。触发器:Acceptance Slice2/3 开工。

**AI Harness** ([2605.13357](https://arxiv.org/abs/2605.13357)) — \[观望\] · 2026-06

- Finding: harness 研究,**n=1 案例**(证据薄,机制候选有价值):consulted(被读过)/ influenced(改变行为)拆分;升级人工时附六字段归因记录;`unverified_success` 标签(声称成功但无验证证据)。另有 H0–H3 消融阶梯。
- 吸收: 三点只记不开任务:① consulted/influenced 拆分可搭 LUM-314 judge 基建便车(used 投票现为单维布尔);② 升级人工附结构化归因;③ unverified_success 对应 Lumo「PASS 必带 evidence」已落地(LUM-343),词收下。**不做** H0–H3 阶梯(研究消融仪器,非产品功能)。触发器:LUM-314 judge 基建复用时机,或 used 信号需要分维度时。

**Config Repair** ([2606.06212](https://arxiv.org/abs/2606.06212)) — \[观望:两条边界原则\] · 2026-06

- Finding: 配置修复 agent:**regression 作为隐式验收标准**(先前通过的检查必须仍通过);LLM 裁判暴露给 agent 自查会被 Goodhart(agent 对裁判优化而非对问题优化),**可执行 check 才可同源开放**。
- 吸收: 两条原则收作 Acceptance 边界条款:① regression 隐式 machine criterion 是 Slice2/3 议题(与 c-CRAB 同向);② LLM 裁判不可免费暴露给 agent 自查——LUM-344 `task status` 只回放结构化 verdict、不内嵌 LLM 裁判,边界正确,点名保住。触发器:Acceptance 引入 LLM 裁判类 criterion 时。

**Are "Solved Issues" in SWE-bench Really Solved Correctly?** ([2503.15223](https://arxiv.org/abs/2503.15223),Wang/Pradel/Liu) — \[纠偏:verified 口径注记\] · 2026-06

- Finding: 877 个「通过」patch 差分测试(PatchDiff)+ 人工审查:**7.8% 实际过不了开发者全量测试套件**;29.6% 与 ground-truth 行为分歧,人工抽查其中 28.6% 确认错误、仅 5.2% 确认正确;**82.7% 的可疑 patch 跑全量回归也抓不出**——「测试」这种 oracle 对行为分歧的覆盖有硬上限;折算三个高排名工具的报告解决率虚高 ~6.2 个绝对百分点。
- 吸收: 给 LUM-397 的 MERGED_VERIFIED 加口径注记:**verified = 信号更强的层,不是 ground-truth 层**(文献锚点:即便人工校准过的测试集也有 ~6pp 假阳底噪)。三条边界:① 不试图「加更多 machine criterion 逼近 correct」(82.7% 抓不到,有硬上限);② PatchDiff 式差分验证出界(需要 ground-truth patch 对照,Lumo 任务没有);③ regression 隐式 criterion(F 队列)收益真实但**有界**——对应 7.8% 那层,支持做、压低承诺。全 PASS→IN_REVIEW 保留人终审被反向支持:66.2% 分歧 patch 人都难判,终审该看行为意图对齐而非测试输出。

**TAR Trajectories + Code Agent Behaviour** ([2506.18824](https://arxiv.org/abs/2506.18824),Bouzenia & Pradel,ASE'25 + [2511.00197](https://arxiv.org/abs/2511.00197),Majgaonkar et al.) — \[采用:选择性,同主题并一条\] → LUM-403 · 2026-06

- Finding: 两篇轨迹研究独立收敛。TAR(120 轨迹/2,822 次 LLM 交互/14K 人工标注,本批唯一同行评审实证):失败轨迹更长更贵且呈重复、非自适应循环;**连续重复动作比例是最强廉价判别信号**(成功→失败:6.1%→13.6%、0.5%→3.8%、0%→8.8%,三 agent 一致数倍);「结果不影响后续动作」(no-influence)在失败中显著更高(1.2%→6.2%、4.9%→14.6%)= 「错误不指路」的轨迹侧镜像。Behaviour 篇(单源抓取,数字弱标注):失败轨迹长 +12.6~82.5%;即使失败 72–81% 也找对了文件(失败不在定位);可在线信号 = 同文件反复读不写/零进展循环/Edit 后无验证即终止。
- 吸收: 回答 LUM-392 悬置的「HookEvent 还能挖什么」——重复动作 n-gram 只需工具名+参数滑窗,**HookEvent 流水够用、不需要 transcript**,且 LUM-397 outcome 分层提供论文没有的现成轨迹标签 → LUM-403 measure-first 离线 EDA(审计本身是交付物,LUM-395 先例)。红线:阈值绝不从论文搬(两篇都证明绝对阈值跨 agent 不迁移);thought 级信号(思考-动作错位/result 误读)明确出界(HookEvent 无 reasoning 数据源)。no-influence 发现与 CLI actionable 错误文案(LUM-392)方向一致但无消融,只算旁证。

**EET: Experience-Driven Early Termination** ([2601.05777](https://arxiv.org/abs/2601.05777),Guo et al.,ACL'26 Findings) — \[采用:measure-first\] → LUM-404 · 2026-06

- Finding: SWE-bench Verified 500 题×3 agent×2 LLM,消融齐全(本批证据强度第二)。历史成功经验(四元组:任务/执行摘要/只存 pass/置信度)TF-IDF top-1 注入 + milestone 节点 LLM confidence 对照,**双向止损**(>90 提前收工、<40 判太难提前放弃):总成本 −19.3%~−55.1%(均值 −31.8%),解决率最大损失 0.2%(不显著),Agentless 配置反 +7.8%;置信度有判别力(>90 的 patch 通过率 63.6–92.6%,<40 仅 8.7–13.8%);**消融拆出双因子:经验注入提质(去掉 −10.4% 解决率)、早停降本,可解耦**;跨仓库零重叠任务仍降本 24.4%。
- 吸收: **「经验复用降本」——飞轮核心主张——的首个量化外部证据**,而 Lumo 自己从未量化验证过 → LUM-404 借其测量框架在 lineage × token 成本 × outcome 分层上做首次观察性对照(分桶控混杂,只报关联不下因果)。其「只存 pass + confidence 分层」与 merge-rate 排序、LUM-397 strength 分层同构;execution_summary 过滤非关键动作与 LUM-314 精简事件日志同路。**不做**早停机制本体;verify 双阈值升级信号(<40 即弃 ≈ 信号判别提前升级,信息量大于固定 cap 3)进 F 队列——错杀 ≤0.2% 的前提是阈值经分桶校准,verify round 样本量未到。

**EvoClaw** ([2603.13428](https://arxiv.org/abs/2603.13428),Deng et al.,USC/UCR/UCSD) — \[纠偏+观望\] · 2026-06

- Finding: 首个连续软件演化 benchmark:7 仓库/98 个已验证 milestone/109 条依赖边,12 前沿模型×4 框架。**孤立单任务 >80% → 连续演化最高 38.03%**(Claude Opus 4.6;全测试通过口径的 Milestone Resolve Rate 最高仅 13.37%);**失败主因 = 回归滚雪球**——Recall(实现新功能)随 milestone 近线性增长,Precision(不破坏既有功能)迅速饱和,未修复回归复合积累快于修复速度;早期逻辑错误沿依赖链污染下游(P1 继承传播最高 12%、PX 下游跳过 17%);SRS 需求描述 500–1500 词最优,**过短过长都掉分(上下文量非单调)**;其 milestone DAG 依赖推断信号(共享文件/PR-Issue 引用)与 LUM-172 的 shared_files/task_mention 几乎一致;**无记忆机制消融**(论文留白)。
- 吸收: 纠偏「milestone 聚合上下文要不要喂 agent」:失败不在信息缺失而在「不知道自己破坏了什么」,且上下文非单调 → **不做全量 milestone 注入**;对症形态 = 沿依赖边注入「上游改了哪些文件/接口 + 哪些行为不能破坏」的窄回归上下文(依赖边 + lineage 是现成选址)→ 进 F 队列带触发器。Precision/Recall 双轨给 regression 隐式 criterion(F 队列既有条)添同向证据——acceptance 现形态偏 F2P(「该做到什么」),缺「不得破坏什么」,Slice2/3 开工时优先级应提前。错误链 P0/P1/PX 分类法待「上游 fail→下游 fail」联动场景复刻简化版。benchmark 本体出界(Lumo 不做模型评测)。

**Inside the Scaffold** ([2604.03515](https://arxiv.org/abs/2604.03515),单作者税系) — \[合并;主体出界\] · 2026-06

- Finding: 13 个开源 scaffold 源码级税系(296 条论断锚定文件行号;零 benchmark 零消融——参考词汇表,不是证据源)。收敛处:工具能力四类(read/search/edit/execute)、str_replace 编辑、Docker 隔离;发散处:**context compaction 7 种策略无共识**、状态管理、多模型路由。**持久记忆是最大生态空白**(5/13 完全没有);真正学习型记忆仅 3 家,其中 **Codex CLI 后台两段管道(小模型 per-rollout 提取→大模型 consolidate,usage 排名+陈旧剪枝)与 Memory v6 + LUM-328 结构同构**。引 Chen et al. 2026:prompt 级加/删测试指令只改结局 ≤2.6pp——验证行为的杠杆在编排层不在提示词。**全语料没有任何 PM/issue-tracker 集成维度**;MCP 仅 5/13 支持且定位传输层。
- 吸收: 三条定位依据:① Codex CLI 记忆管道独立趋同 = 飞轮方向旁证;② **静态指令文件 + bash/execute 是 13/13 收敛接口、PM 集成是全生态空白**——Lumo 的 CLI-first 押注(CLAUDE.md 约定 + hook 注入 + bash 调 lumo)骑在最大公约数上,MCP 优先级继续放低;③ compaction 发散 + LLM 摘要有损 → 注入内容应假设可能被宿主截断/摘要:关键事实前置、每段自含(与 LUM-352 同向;设计注意事项,非任务)。「验证杠杆在编排层」反向支持 verify 做成服务端循环而非提示词要求。scaffold 内核维度(控制环/隔离/路由/edit 格式)按层次过滤出界。

---

## C. 项目管理与协作(PM / Agent-collaboration domain)

> 未来吸收对象:human-approval loops、agent observability、长程任务执行(2026 Agent Era survey 指向的方向)。除外部条目外,以下为本域已沉淀的内部方法论发现。

**Writing tools for agents** ([Anthropic Engineering blog, 2025-09](https://www.anthropic.com/engineering/writing-tools-for-agents)) — \[采用\] → LUM-392 实测报告 + 三项 CLI 改进 · 2026-06

- Finding: 为 agent 写工具是新型软件契约——按 agent 认知方式整合工作流(`get_customer_context` 式)而非机械包装端点;命名空间划界;返回语义化标识(UUID→自然语言标识显著提升检索精度);token 效率(分页/截断+引导性提示,错误响应给下一步而非裸错误码);工具描述当 prompt 写(微小改进即显著收益,Sonnet 3.5 SWE-bench SOTA 部分来自描述优化)。方法论核心:真实场景 eval + 读 transcript 找摩擦点 + 用 Claude 自动改进工具,闭环迭代。
- 吸收: Lumo 的 agent 工具面 = lumo CLI + SKILL.md + hook 注入,原则全部可迁移。**形态已对**(task context/session wrap/next 是整合形态;LUM-N 语义标识;命名空间无混淆证据;show/context 分层被 agent 自发用对)→ 缺的是**评估闭环**。落地:用 prod HookEvent(325 session/3332 真实调用)建首个 CLI usage eval(`scripts/analysis/lum392-cli-friction/`,可复跑),实测出最大摩擦不是错误率(2.3%)而是:仪式性状态走步 70 链 145 调用(状态机其实允许直达,纯隐性知识未显性化)、13 次 flag 幻觉(位置参数被猜成具名 flag)、错误信息不指路(~25 次死胡同,`doc move` 文案是内部正面先例)。裁决:错误文案 actionable 化+SKILL.md 显性化补强+padEnd bug=做;`--concise` 分级与分页 audit=缓(p90 8.5k 字符可接受,带触发器);命令合并删除=不做(零使用的 21 命令是人类发起场景,非冗余)。详见[实测报告](https://www.uselumo.ai/workspace/lumo/documents/lumo-cli-agent-lum-392-31)。

**落地交付(2026-06-10 两 PR 均已 merge):**

- [PR#462](https://github.com/Lumo-Workspace/lumo/pull/462) — eval harness(`scripts/analysis/lum392-cli-friction/`,只读 prod、`--check` 自检、解析层有单测)+ 实测报告权威源 + 本登记册条目。复跑出 diff 即评估闭环,发版后可重跑。
- [PR#463](https://github.com/Lumo-Workspace/lumo/pull/463) — 三项「做」:① 错误文案 actionable 化(transition 409 列允许目标+DONE 指向 comment,与 TRANSITIONS 矩阵同源;memory 404 说明要完整 cuid;could-not-read-file 统一带 cwd+相对路径提示;commander 加 did-you-mean+`--help` 指引);② `doc list --task` padEnd 崩溃兜底;③ SKILL.md 不存在命令/flag 负面清单 + tasks.md 状态转移矩阵与「可直达」规则。**附加发现并修复:skill frontmatter description 堆到 3981 字符/250 个枚举触发词(每 session 常驻 ~1.3k token)→ 裁到 967 字符类别级,CLAUDE.md 同步规则加 1000 字符硬上限堵根因**——「工具描述当 prompt 写」的反面案例:描述也是 context 预算的一部分,recall 靠语义类别不靠穷举。cli 1.25.1 已发布(npm,2026-06-10)。
- 待观察(带触发器,不占任务):`--concise`/分页(触发器自 LUM-402 起**可查询**:SESSION_START 行 `_lumo_context_metrics` 显示 `droppedCards>0` 的 session 占比抬升、或 `totalTokens` p90 逼近 2500 预算上限、或任务上百;此前写「注入预算告警」但零遥测,触发器是死信——context-engineering 文的 context-rot 梯度退化给该触发器理论背书,任务显著变长时复查「p90 8.5k 可接受」的判断)、`task status` 与 `task context` 的边界混淆(status 刚上线、样本 4 次,下次 harness 复跑看两个信号:恢复场景误拉 context、查状态字段误调 status)、description 裁剪后的触发 recall(客户端行为,DB 测不到,出现漏触发先查这里)。

**Effective context engineering for AI agents** ([Anthropic Engineering blog, 2025-09](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)) — \[合并→Writing tools for agents / LUM-392 / Memory v6\] · 2026-06

- Finding: context 是有限注意力预算(attention n² → context rot 是梯度退化非悬崖),核心原则=最小高信号 token 集;system prompt 在「过具体-过空泛」之间找 altitude;few-shot 用 canonical 例不堆边角清单;检索推荐 hybrid(upfront 紧凑注入 + just-in-time 标识符按需拉取,progressive disclosure);长程任务三技法=compaction(harness 层)/ structured note-taking(持久笔记)/ sub-agent(编排层)。
- 吸收: 上游理论篇,机制面零新增——工具节同源于已落地的 Writing tools for agents(LUM-392);「最小高信号集」即注入预算 + LUM-279 proven-value 排序 + LUM-328 冷淘汰的既有实践;altitude/canonical 原则即 LUM-392 的 description 裁剪结论;note-taking 即 Memory v6 产品本体;compaction 与 sub-agent 出界(harness/编排层,Claude Code 负责)。确认并点名保住:**hook session-start 一次性注入 + show/context 分层 = 文章推荐的 hybrid 检索形态**(LUM-392 实测 agent 自发用对);mid-session 语义检索继续 defer(「do the simplest thing that works」直接支持 F 队列该条的触发器设计)。新增 F 观望一条:Claude Code 自带 memory tool 与 Lumo memory 的双写/分工边界。

**Context Engineering: Agent Reliability Playbook 2026** ([digitalapplied.com blog](https://www.digitalapplied.com/blog/context-engineering-agent-reliability-playbook-2026)) — \[合并→Effective context engineering / Writing tools for agents\] → LUM-402 注入遥测 · 2026-06

- Finding: 二手聚合文,**无自有实验(零消融)**——打包 Anthropic 两篇 engineering blog(本册 C 域已各有条目)、LangChain Write/Select/Compress/Isolate 四杠杆、Breunig 四故障模式(poisoning/distraction/confusion/clash)、Chroma context rot、Cognition compaction。其「按 agent 类型分配 token 预算」表为博客自拟数字,无来源,不可引。唯一本册未见过且有真实实验的引文:**LLMs Get Lost in Multi-Turn Conversation**([2505.06120](https://arxiv.org/abs/2505.06120),已核 arXiv 摘要):多轮(sharded)vs 单轮平均 **−39%**(六类生成任务);退化分解=aptitude 小幅下降 + **unreliability 显著上升**(走错一步不回复原)。博客转述的 o3 98.1→64.1 摘要未核实,不引。
- 吸收: 主体已覆盖或出界(Write=Memory v6 本体;Select=session-start 一次性注入+show/context 分层;Compress/Isolate=harness/编排层,Claude Code 负责;poisoning 防护=LUM-396 grounding+D 域三件套)。2505.06120 登记为 **session-start 一次性合并注入设计的反向背书**(信息分片多轮喂劣于合并一次注入)。顺带闭环一个对口微增量:上一行「--concise/分页」触发器写「注入预算告警」但现状零遥测(死信;LUM-346 验收冷探针被预算尾部静默丢弃即此盲区实证)→ **LUM-402** session-start 注入 per-section token 归因:`_lumo_context_metrics` 保留键落 SESSION_START HookEvent(per-section 估算 token + kept/dropped 计数,客户端伪造在边界被剥离),沿 `_lumo_validation`「防护要自带可观测信号」形态,纯观测零行为变化。

**Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?** ([2602.11988](https://arxiv.org/abs/2602.11988),Gloaguen et al.,ETH Zurich) — \[采用:原则级\] → LUM-406 + 两条红线 · 2026-06

- Finding: 本批证据最强(SWE-bench Lite 300 + 自建 AGENTBENCH 138 任务、4 agent×模型、删文档/换生成模型/换 prompt 三组消融、trace 机制分析)。LLM 生成的 context file 略降正确率(−0.5%/−2%)且**推理成本 +20%/+23%**,连 GPT-5.2 代写也 −3%(生成侧不可救);开发者手写在低文档小众仓库 +4% 但成本仍最高 +19%;**目录枚举式 overview 被证伪**(对「首次接触 PR 相关文件的步数」零影响,而 95–100% 的生成文件都含 overview);删掉仓库全部文档后 LLM 生成文件反而一致 +2.7%——**context file 的价值 ≈ 非冗余信息量**;指令确实被遵守(文件提到 uv → 人均调用 1.6 次 vs <0.01),但每条常驻指令都诱发更多探索/测试/reasoning(+14~22%)——不是 agent 不听话,是多余要求让任务变难。
- 吸收: 机制级证据把 LUM-392「description 类别级 + 1000 字符硬上限」从实测经验升格为有对照支撑的原则。两条红线:① **永不做「agent 自动生成/扩写 CLAUDE.md」功能**(被直接证伪);② **CLAUDE.md 新增任何段落前先问「这是 agent 探索不出来的非冗余信息吗」**——冗余即负资产(成本+正确率双输)。现 CLAUDE.md 以禁止项/必须项/仓库专属流程为主 = 论文证实的 minimal-requirements 有效区,Project Structure 目录枚举节不再扩;瘦身审计 → LUM-406。Lumo 注入面的对策(merge-rate 排序/grounding/token 预算/冷淘汰)正是论文缺的「非冗余过滤器」,方向被反向印证。

**On the Impact of AGENTS.md Files on the Efficiency of AI Coding Agents** ([2601.20404](https://arxiv.org/abs/2601.20404),Lulla et al.,ICSE JAWs'26 短文) — \[观望:弱采信\] · 2026-06

- Finding: 124 真实 PR×单 agent(Codex+gpt-5.2-codex)paired 对照:有 AGENTS.md 时 wall-clock −20%、输出 token −20%(p<0.05),但**输入 token 中位数反而 +3.4%**(常驻注入的成本在普通 run 抵消节省,只在尾部高成本 run 回本);零消融、无正确性评测。
- 吸收: 与 ETH 篇在同设置(Codex+GPT-5.2 系)下资源方向相反(它说省、ETH 说费)——**采信消融齐全的 ETH 篇**,本篇只作「精选手写文件在小任务上不拖慢」的下限旁证,不进决策依据。两篇拼起来的一致结论:手写、非冗余、最小化的 context file 小幅有益;无论哪种都不免费——常驻上下文必然换更多步数与 reasoning。触发器:扩展版补多 agent + 正确性 + 内容消融后再重读。

**Codified Context: Infrastructure for AI Agents in a Complex Codebase** ([2602.20478](https://arxiv.org/abs/2602.20478),单作者经验报告) — \[采用:drift detector;余合并\] → LUM-405 · 2026-06

- Finding: n=1(108K 行 C# 项目、70 天 283 session,无对照——数字只当存在性证明与设计先例)把配置基建推到极致:三层热/冷分层(Tier1 宪法 ~660 行常驻 = 代码库 0.6%;Tier2 19 个领域 agent 规格;Tier3 34 个冷文档经自建 MCP 检索按需加载),knowledge-to-code 比 24.2%;agent 规格 >50% 是领域知识(codebase 事实/公式/失败模式)而非行为指令;维护成本 ~1–2 小时/周;**首要失败模式 = spec 陈旧**(实现变了文档没变,agent 按陈旧信息生成代码),缓解工具 = **context drift detector**(session-start 解析近期 commit × subsystem→file 映射表,源码改而文档未改即注入警告)。
- 吸收: 三层热冷 = Lumo 现架构(CLAUDE.md/SKILL.md 常驻 + memory/live-docs 按需)的独立趋同验证,0.6%/24.2% 作宪法体量锚点;「宪法类手写 + drift 检测,经验类走飞轮」分工边界清晰——它人工指挥 AI 更新文档的 1–2 小时/周正是飞轮要打掉的成本。**采用 drift detector**:把「改 cli/src/commands/ 必须同步 SKILL.md」人治规则机械化(commit-diff × 路径→文档映射 → CI/session-start 警告)→ LUM-405。19 个 subagent 的 trigger-table 路由出界(编排层)。

**Configuring Agentic AI Coding Tools** ([2602.14690](https://arxiv.org/abs/2602.14690),Galster et al.,AIware'26) — \[合并:生态基线\] · 2026-06

- Finding: ~2,900 仓库横断面挖掘(描述性快照,无消融,只测「存在」不测「有效」):**context file 统治(90% 仓库有)且常是唯一配置机制**;高级机制采用率极低——Skills 仅 ~5.4% 仓库、Subagents ~4.5%;Skills 中 83.3% 纯静态指令,SKILL.md <500 行 + 细节外移的官方规范 96% 合规;CLAUDE.md(采用率 45.4%)> AGENTS.md(40.6%),CLAUDE.md→AGENTS.md 成对出现 311 次——**AGENTS.md 正在成为跨工具互操作标准**。
- 吸收: 两个产品判断的校准基线:(a) Lumo 配置面(SKILL.md+hooks+MCP 全家桶)在生态极右尾——给团队预置配置是真实差异化,且**不能假设用户仓库已有任何配置基建**(agent 工程层要自带电池);(b) SKILL.md 体量纪律与官方规范及社区主流一致,无新动作。AGENTS.md 互操作进 F 队列观望(触发器见该条)。

**Agent READMEs + Beyond the Prompt(Cursor Rules)** ([2511.12884](https://arxiv.org/abs/2511.12884) + [2512.18925](https://arxiv.org/abs/2512.18925),MSR'26) — \[纠偏+合并:同主题并一条\] → LUM-406 + 飞轮分工实证 · 2026-06

- Finding: 两篇大规模挖掘(2,303 context file/1,925 仓库;1,876 rule 文件/401 仓库),均零效果证据(两文作者自认「写什么有用」留白)。Agent READMEs:**演化「只加不删」**(CLAUDE.md 每 commit 中位 +57 词、删 <15 词,修改中位间隔仅 ~24h——是活配置但单调膨胀);内容以功能性为主(Testing 75%/架构 68%),security 仅 14.5%。Cursor Rules:**28.7% 的行跨仓库精确重复**(awesome-cursorrules 等模板 cargo-cult = 低密度噪声主源);**「变更/弃用警告」类仅 17% 仓库写**——恰是时效性最强、手写最易烂的内容;静态类型语言项目写得显著少(类型系统替代部分手写 context)。
- 吸收: 三个论点:① 只加不删的膨胀实证 → CLAUDE.md 需要瘦身回路(LUM-406;memory 有 LUM-328 冷淘汰,手写文档没有等价物);② **「稳定规范走手写、时效性经验走自动记忆」的分工得到实证侧写**——弃用警告类手写覆盖最低 + TRAP 类(事后才知道)手写天然漏,正是飞轮相对手写的差异化空间;③ 模板搬运 = 噪声 → CLAUDE.md/SKILL.md 保持全项目特异内容,review 时警惕贴通用 best-practice。防漂移机制两篇均无可学(业界没有,Lumo 的同步强制在做其 future work)。触发器:任一后续工作给出「内容类别 × 任务成功率」消融时,重评注入权重与 CLAUDE.md 内容配比。

**Effective harnesses for long-running agents + Scaling Managed Agents** ([Anthropic Engineering, 2025-11](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) / [2026-04](https://www.anthropic.com/engineering/managed-agents)) — \[合并→Effective context engineering 条;主体出界\] · 2026-06

- Finding: 长程 harness 双篇,纯设计主张几乎无量化。harnesses:两阶段 harness(初始化 agent 建 feature_list.json「禁删测试项、只准翻 passes」+ progress 进度文件;编码 agent 每 session 读进度+git log 恢复 → 冒烟 → 单功能 → 必 commit);**明确点名 SDK compaction「不充分」,需应用层状态管理补足**。managed-agents:脑/手/会话三层解耦,**会话 = 外部持久事件日志**(harness 无状态,靠日志 wake 恢复;p95 TTFT −90%);设计教训 =「模型能力假设别编死」(为 Sonnet 4.5 context-anxiety 写的应对到 Opus 4.5 成无用负担)。
- 吸收: 机制面零新增,三处同构确认:feature_list(禁删只翻 passes)≈ acceptance criteria + verify——**Lumo 的服务端裁判 + evidence 红线强于其提示词护栏**;progress 文件 + git log 恢复 ≈ task status 冷启动读模型(LUM-344);「compaction 不充分」+「状态落外部事件日志」≈ Lumo 把状态落自有 HookEvent/Session 流与读模型而非 transcript(LUM-340 同一教训)。一条工程提醒:启发式阈值(冷淘汰 >100、merge-rate 排序参数)随模型升级留可调、别编死。两阶段编排/init 脚本/沙箱抽象出界(harness 内核,Claude Code 负责)。

**Google Agent Bake-Off 5 Tips + I/O '26 agent 栈** ([Google Developers Blog](https://developers.googleblog.com/build-better-ai-agents-5-developer-tips-from-the-agent-bake-off/) + [Google Cloud Blog ×2](https://cloud.google.com/blog/topics/developers-practitioners/io26-news-for-agent-developers-on-google-cloud)) — \[观望:印证,三篇并一条\] · 2026-06

- Finding: hackathon 复盘 + 产品公告,证据弱/无。可迁移点:「LLM 只做推理与意图提取,经 strict schema 校验后由确定性代码执行计算」;「为可淘汰性做架构」(今天的复杂 harness 可能数月内被新模型能力替代);Skill Registry + google/skills 仓库刻意跨工具兼容(明确点名 Claude Code、Cursor);agent eval 框架(合成用户模拟 + LLM 评分 + trace 失败分组)停留在能力清单无方法细节。
- 吸收: 全部为既有路线的行业印证,零新机制:推理/执行分离 = LUM-341/343 verdict 红线(machineVerdict 无自由裁量、可执行 check 才可信);可淘汰性 = 「harness 内核出界」层次过滤本身;google/skills = SKILL.md 形态被竞对采认的利好信号;eval 思路 Lumo 已有更具体实现(LUM-392/329)。不开任务。

**\[内部实证\] 论文吸收工作流** · 2026-06

- 三档分级(Tier 0 必读/1 选读/2 忽略)+ 层次过滤;每篇一句 bearing;时间盒(学术完成主义是最隐蔽的拖延)。
- 论文→任务可追溯映射:任务 description 写论文支撑(研究→方法→数字→结论→bearing),milestone 留判定 digest。

**\[内部实证\] 跨 session 交接(handoff)模式** · 2026-06

- 「前情提要 + 可复用件清单(文件/符号锚点)+ 开工前旋钮 + 验收标准」写进任务 description,新 session 冷启动即开工;交接前实测关键数字(如 usage 覆盖 84%、0 行 >30d)——实测锚点直接改变设计权重。

**\[内部实证\] 验收与评审纪律** · 2026-06

- PASS 要挣:独立核代码 + 实跑复现数字,不信 PR 自述;抓 overclaim(「every run」「上线即生效」)。
- 受评审:先验证可查声称再回应,不表演性同意/反驳;挑战者与被挑战者都可能错,证据仲裁。
- 先测后定:本册两次实测同时推翻设计方与评审方(recall@k 触发、跨语言 floor)。
- 自指 dogfood:去重系统缺陷在「记录自己的修复」时复现——用 Lumo 管 Lumo 是最快的缺陷放大器。
- 运维边界:合并 ≠ prod 已迁移,schema PR 事后核 prod;prod 手动操作仅限当次显式授权 + dry-run 先行。

---

## D. Agent 安全与 Containment(Security)

> 新域(2026-06 开)。Lumo 在此域的特殊位置:**Lumo 本身是一个「持久状态注入系统」**——hook 把 task-context/memory/lineage 注进 agent context,memory 跨 session 持久。所以本域文献既指导「我们怎么安全地跑 agent」,更指导「我们作为注入面怎么不成为攻击向量」。

**How we contain Claude** ([Anthropic Engineering blog, 2026-06](https://www.anthropic.com/engineering/how-we-contain-claude)) — \[采用\] → LUM-346/347/348 + LUM-343 评论(evidencePointer 收口) · 2026-06

- Finding: 三产品三档 containment(claude.ai=gVisor 临时容器 / Claude Code=OS 沙箱 Seatbelt+bubblewrap / Cowork=封死 VM)。关键数字:权限弹窗 **93% 被用户同意**(审批疲劳是真实漏洞,解法是 OS 沙箱砍掉 84% 弹窗而非弹更多窗);直接注入实验 **24/25 次成功**窃出凭证,只有环境层 egress 控制拦住;模型层防御 catch rate 上限 **83%**。核心主张:环境层硬边界 > 模型层引导(数据从被允许路径流出时,日志只是一次「合法授权的调用」);tool output 一律不可信;**持久记忆会被投毒,启动时要校验**;子 agent 结构化输出是高信任注入向量;「最弱的一层是你自己造的那层」(自研 proxy/allowlist 比 gVisor/seccomp 等久经考验原语更易失败)。
- 吸收: 按它的威胁模型自查 Lumo 注入面(hook 注入链/memory 渲染/hook POST 入口/acceptance verdict),三个对口暴露面落地为任务:**LLM 产物回注前清洗**(LUM-346,Slack summary/memory 渲染路径无控制字符清洗)、**memory 注入来源标注**(LUM-347,agent/user/external 三种来源在 agent 眼里无差别)、**hook POST 边界 Zod + 长度上限**(LUM-348,现状 request.json() 直存);**evidencePointer 格式收口**并入 Acceptance v1(评论挂 LUM-343,写路径未实现时收口最便宜)。同时确认两条既有做法正确并点名保住:`<untrusted-*>` 信任边界包裹(=「tool output 标记不可信」,但定位是模型层 defense-in-depth,**不是硬边界**——真硬边界是 API key scope/workspace 隔离/Claude Code 自身沙箱)、machineVerdictInputSchema verdict 红线(=管住多 agent 信任升级)。**拒绝**自建 VM/gVisor/MITM proxy 层——那是「替非技术用户跑任意代码」产品(Cowork 模式)的需求;Lumo agent 跑在用户自己的 Claude Code 里,环境层 containment 外包给 Claude Code 沙箱,正合「别自造安全组件」。团队实践面:开发机建议开 sandbox 模式(network deny-by-default),本仓库 `.claude/settings.json` 的窄 allowlist(仅 `lumo whoami/session`)是正确姿势,保持。

**落地交付(tag** `agent-containment`**,不开 milestone;全部 5 行已 DONE,2026-06-10 收齐):**

| 任务                                                              | 内容                                                                                                                                    | 状态 / PR                                                                                                                                    |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [LUM-346](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-346) | 服务端注入渲染边界给 LLM 产物/外部自由文本过控制字符清洗(`wrapUntrustedMemory`/`wrapUntrustedLinked`)                                   | **DONE** · [PR#446](https://github.com/Lumo-Workspace/lumo/pull/446) · 已验收 ✅                                                             |
| [LUM-347](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-347) | memory/linked context 注入条目级来源标注(agent/user/external)                                                                           | **DONE** · [PR#449](https://github.com/Lumo-Workspace/lumo/pull/449) + [PR#452](https://github.com/Lumo-Workspace/lumo/pull/452) · 已验收 ✅ |
| [LUM-348](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-348) | hook POST 边界 Zod 校验 + 自由文本长度上限                                                                                              | **DONE** · [PR#453](https://github.com/Lumo-Workspace/lumo/pull/453) · 已验收 ✅                                                             |
| [LUM-343](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-343) | `evidencePointer` 格式收口:PASS 必带 evidence + `isValidEvidencePointer` 格式校验(`lib/validation/acceptance.ts`),随 verdict 写路径落地 | **DONE** · [PR#458](https://github.com/Lumo-Workspace/lumo/pull/458) · 已验收 ✅                                                             |
| [LUM-352](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-352) | task-context GET 路径 untrusted-linked 前言去重(逐段包裹最多 7 份相同前言,LUM-347 验收实测发现)                                         | **DONE** · [PR#461](https://github.com/Lumo-Workspace/lumo/pull/461) · 真机 LUM-330 ×3→×1 验证 ✅                                            |

[**LUM-346 验收实证**](https://github.com/Lumo-Workspace/lumo/pull/446) · 2026-06-10

- 做法: 抽 `sanitizeField` 单一实现到 `shared/src/sanitize.ts`,CLI(`cli/src/lib/sanitize.ts`)与服务端(`lib/utils/sanitize.ts`)各自 re-export 同一份(防口径漂移);`wrapUntrustedMemory`/`wrapUntrustedLinked` 在包 `<untrusted-*>` 边界前先 `sanitizeField(section)`。字符类=C0(除 \\t\\n)+ DEL + C1(\\x80-\\x9f),含 ESC(\\x1b)与 8-bit CSI(\\x9b);id/url/enum 不过滤。
- 活验(prod 实跑,非读测试): 纯英文控制字符探针经 `lumo memory add` 落库——**DB 原始字节保留** ESC/BEL/C1(经 `/api/projects/<id>/memories` 不过渲染边界的端点确认);同一条经 session-start 注入端点(`wrapUntrustedMemory` 渲染路径)返回 **零控制字节**,`red \x1b[31mALERT\x1b[0m` → `red [31mALERT[0m`(仅删 ESC 字节、保留可见文本=`sanitizeField` 签名,区别于 LLM 重写)。验毕删探针、复原 session。
- **两个实测发现**(写回本册作后续吸收先验):
  1.  **memory 内容在落库前已被英文归一化 LLM 洗过**——中英混合探针的 ANSI 序列连可见文本一起被翻译重写抹掉,纯英文探针才原样留控制字符到渲染边界。故对 memory 而言渲染边界清洗是 **defense-in-depth**;真正 load-bearing 且可达的是 `wrapUntrustedLinked`(Slack summary / 抓取的 web body 存原始、不过 LLM 归一)。
  2.  **session-start hook 注入路径(**`hook-runner.ts`**)对** `memorySection`**/**`linkedResourcesSection`**/**`layer2ReviewSection` **不 re-sanitize**(仅 `taskTitle` 过),而 CLI `task context` 打印会 re-sanitize——所以服务端边界在 hook 直注 Claude 的路径上是唯一防线,LUM-346 选在服务端做是对的位置。

- 注入预算坑(验收方法论,记给后人): prod 单项目 139 条 PROJECT 记忆按 `createdAt asc` 排、`applyTokenBudget` 累加到上限即 break → **冷探针永远落在被丢弃的尾部**,full-context 路径(默认 1000 token)注不进;改走 session-start 路径(2500 token + LUM-279 lineage 排名,冷记忆进中间档)才把探针顶进注入集见证清洗。

**\[内部实证\] D 域防护 prod 生效核查** · 2026-06-10

- LUM-348 hook 边界校验上线后,prod **2594 个 hook event 中 1 个被真实截断**(某自由文本字段 >64k)、**0 个字段因类型错误被丢**——截断率 0.04%。结论:防护在真实流量里**生效且可审计**(呼应文章「防护要能被审计」);64k 上限**宽松合理**(几乎不误伤正常 hook 流量,只兜超大 payload);dropped=0 印证真实 CLI 是可信发送方,边界校验主防异常/攻击而非日常流量。
- 方法论:`_lumo_validation` 标记让「防护到底拦了什么」可被事后 SQL 查询——**containment 防护要自带可观测信号**,否则无法验证它在不在生效(光看代码合并 ≠ 防护生效)。

**\[判定\] D 域阶段性收口** · 2026-06-10

- 文章点名的、对 Lumo 对口的暴露面(LLM 产物回注 / 来源混淆 / 注入面缺校验 / 多 agent 信任升级)均已各有一个加固任务闭环并独立验收。**无「必须做」的下一步**:再堆防护违反本册「defer 优于 adopt」纪律。
- 仍在 F 观望队列、触发条件未到:**memory 启动时投毒校验分类器**(触发器=写入来源扩到外部)。
- ~~backlog:LUM-352 前言去重~~ → 已闭环([PR#461](https://github.com/Lumo-Workspace/lumo/pull/461),2026-06-10)。本域交付表至此全行 DONE。
- 若 containment 要继续作为主题,正确动作是**吸收下一篇 agent-security 文献扩 D 域**(文章自指 NIST agent identity、六机构 agentic AI guidance),而非无新威胁输入下硬造加固。

---

## E. 出界登记(Out of scope)

**MEM1** ([2506.15841](https://arxiv.org/abs/2506.15841)) — \[出界\] · 2026-06

- Finding: end-to-end RL 训 7B 模型维持恒定内存内部状态(`<IS>` 融合记忆与推理,逐轮弃旧上下文),16-目标 QA 性能 ×3.5、内存 ÷3.7。
- 为什么出界: 模型内核层——记忆-推理协同交给 Claude/模型厂商。Lumo 的杠杆在 agent 工程层。

> 同类先例(未单独登记):Context Scaling 全部(YaRN/LongRoPE/PI)、Neural Memory Architectures、Memory-Augmented Transformers、Prompt Tuning——均为模型内核层,Claude 已解决。

**The End of Software Engineering** ([2606.05608](https://arxiv.org/abs/2606.05608),Cao) — \[出界\] · 2026-06

- Finding: 单作者 vision:许可软件→SaaS→Agent-as-a-Service 叙事 + 「Agentic Engineering 新学科」四阶段路线图。零实验、零机制,引用他人 benchmark 作背书。
- 为什么出界: 无可迁移机制;「agent 工程层是新战场」Lumo 已用脚投票。登记防重评——再遇纯叙事 vision 文,按本条先例快评即弃。

---

## F. 观望队列(有 bearing,触发条件未到)

- **关系字段/轻量结构**(StructMem/Zep 方向):LUM-327 已定 defer。触发器:当注入需要把某条 TRAP 与其成因 DECISION 并排呈现、且 merge-rate 排序被证实无法共同浮出时,重开 relatedMemoryIds vs MemoryRelation 选型。
- **更大 embedding 模型**(4B/8B):触发器:LUM-329 eval 显示 0.6b 分离度不足以支撑某个新场景(当前 0.6b 反而最优,无动机)。
- **mid-session 语义检索**(agent 干到一半主动查记忆):当前 session-start 一次性注入 + 按 proven-value 排序够用;Cookbook(2606b 批次)给出定位 = 为被 clear/compact 掉的内容提供按需召回。触发器:HookEvent 观测到 agent 在同一 session 内重复检索同主题(「注入集装不下但需要长尾记忆」的直接证据)。
- **遗忘曲线 t 项生效核查**:语料老化(出现 >30d 行)后,复查 LUM-328 排序里 retention 项是否开始判别(预计 2026-07 起)。
- **memory 启动时投毒校验分类器**(containment 文章「plan for persistent state poisoning」的完整形态):当前 memory 写入方=workspace 成员+本 workspace 的 agent,信任域小,来源标注(LUM-347)+`<untrusted-*>` 边界够用。触发器:memory 写入来源扩到外部(公开 intake、跨 workspace 共享、第三方集成直写)或出现实际投毒案例时,上 startup 校验分类器。
- **enforced TTL / expiresAt schema 字段**(context-personalization 文 ephemera 处理的完整形态):LUM-394 先走 extract 端拒收(零 schema)。触发器:eval 或 prod 实测显示 ephemera 仍持续落库(extract 判别拦不住)时,再上 schema 级 TTL 并在冷淘汰里强制执行。
- ~~Claude Code 自带 memory tool 与 Lumo memory 的分工边界~~ → **已决**(2026-06,Cookbook 条目见 A5):分层不双写、不吸纳——memory tool = agent 私有草稿纸(未 ground),Lumo memory = 治理记忆面;纪律已落 `.claude/skills/lumo/references/memory.md`(项目工程教训一律走 lumo memory)。
- **BeliefMem 第二层:CONTRADICT op + 竞争组共同注入 + noisy-OR 信念聚合**(2605.05583):LUM-395 审计证明当前死亡螺旋未发生,机制层暂无承载问题。触发器:~2026-07-10 复跑 `scripts/analysis/lum395-flywheel-rehab/audit.ts` 出现 wrongful-kill suspects 或环 1 信号时再裁决。
- **phase-tagged 成本遥测 + reconcile 边际成本斜率作 compaction 量化触发器**(2606.06448):触发器 = 其 harness repo 开源后评估复用,或 LUM-328 阈值(>100 经验值)需要量化校准时。
- **consulted/influenced used-信号分维**(2605.13357):used 投票现为单维布尔。触发器 = LUM-314 judge 基建下次复用时机,或飞轮需要区分「被读过」与「改变了行为」时。
- **fail-then-pass 绑定 + criteria 可验证性分类 + regression 隐式 criterion**(c-CRAB 2603.23448 / Config Repair 2606.06212):触发器 = Acceptance Slice2/3 开工,届时为核心方法论(端到端固化率预期 ~18%,structural check 是覆盖主体)。2606b 批次双证据加强 regression 条:EvoClaw 失败主因 = 回归滚雪球(Precision 饱和)、SWE-bench 正确性研究 7.8% 过不了全量套件——收益真实但有界(82.7% 行为分歧全量回归也抓不到),**Slice2/3 开工时 regression criterion 优先级应提前、承诺压低**。
- **hallucination vs obsolescence 归因词表**(SSGM 2603.11768):触发器 = 三段 waterfall 归因需要拆 Preserve 段时(判别信号 = supersededAt 链)。
- **依赖边窄回归上下文注入**(EvoClaw 2603.13428):沿 CONFIRMED 依赖边注入「上游任务改了哪些文件/接口 + 哪些行为不能破坏」,替代全量 milestone 聚合注入(上下文量非单调,失败不在信息缺失)。触发器:依赖检测 + lineage 攒够「上游 fail→下游 fail」可统计样本,或出现带记忆/上下文消融的 EvoClaw 续作。
- **EET 式 verify 双阈值升级信号**(2601.05777):低置信提前升级人工/高置信提前过,替代或软化固定 round cap 3;EET 错杀 ≤0.2% 的前提是阈值经分桶校准(分桶看通过率)。触发器:verify round 样本量够离线校准,或 LUM-403 轨迹信号 EDA 出判别力。
- **AGENTS.md 互操作镜像**(2602.14690:CLAUDE.md→AGENTS.md 成对 311 次,跨工具标准化中):触发器 = Lumo 决定支持第二个 agent 工具(Copilot/Cursor),或 Anthropic 官方宣布读 AGENTS.md 时,做 CLAUDE.md→AGENTS.md 镜像/软链。

---

## 附录 1:首批吸收的交付索引(Memory v6,2026-06)

| 任务    | 交付                                      | PR                |
| ------- | ----------------------------------------- | ----------------- |
| LUM-324 | reconcile-on-write + pgvector 语义检索    | #426              |
| LUM-325 | 生命周期三态 + 失效不删 + supersede-guard | #431              |
| LUM-326 | 选择性遗忘确定性集成测试                  | #433              |
| LUM-327 | schema 决策:prose-only,defer relations    | decision artifact |
| LUM-329 | 域内 eval harness + 三条校准回改          | #434              |
| LUM-335 | reconcile LLM 鲁棒性(schema drift)        | #436              |
| LUM-336 | 手动 add 接 reconcile + English-canonical | #440              |
| LUM-328 | usage-strength 冷淘汰                     | #441              |

## 附录 2:2606 周扫批次索引(tag `paper-absorption-2606`,2026-06)

8 篇 subagent fan-out 全文精读 → 3 落地任务 + 6 watch 项(进 F 队列 5 行,c-CRAB 与 Config Repair 同向合并)+ 5 明确不做(各登记在条目内防重复评估)。不开 milestone(沿 agent-containment 先例)。

| 任务                                                              | 来源论文                 | 交付                                        | 状态                                                                                            |
| ----------------------------------------------------------------- | ------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [LUM-395](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-395) | BeliefMem 2605.05583     | 飞轮翻案通道审计(measure-first)             | **IN_REVIEW** · [PR#469](https://github.com/Lumo-Workspace/lumo/pull/469) · 裁决不修,07-10 复跑 |
| [LUM-396](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-396) | ProMem 2601.04463        | 抽取 grounding 前置(quote-or-discard)       | TODO                                                                                            |
| [LUM-397](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-397) | ProdCodeBench 2604.01527 | lineage outcome 强弱分层 + 记忆出生任务记账 | TODO                                                                                            |
| [LUM-398](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-398) | (本批登记册吸收)         | 8 条目 + F 队列 5 行 + 录入规范追踪源       | 本 PR                                                                                           |

## 附录 3:2606b 周扫批次索引(milestone「研究吸收 2606b:coding-agent 工程批次」,2026-06)

13 论文 + 7 blog(其中 Effective context engineering 已在册不重收),8 路 subagent fan-out 全文精读(3 路 PDF 转述层幻觉被双源核验拦下)→ 14 条目 + 4 落地任务 + F 队列净 +2(新增 3/关闭 1/改写 2)。本批应用户要求开 milestone(区别于 2606 首批的 tag 形态)。

| 任务                                                              | 来源                                      | 交付                                            | 状态  |
| ----------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------- | ----- |
| [LUM-403](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-403) | TAR 2506.18824 + Behaviour 2511.00197     | HookEvent 轨迹失败信号判别力 EDA(measure-first) | TODO  |
| [LUM-404](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-404) | EET 2601.05777                            | 飞轮「经验复用降本」首次量化验证                | TODO  |
| [LUM-405](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-405) | Codified Context 2602.20478               | context drift detector(commit-diff×文档映射)    | TODO  |
| [LUM-406](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-406) | ETH 2602.11988 + Agent READMEs 2511.12884 | CLAUDE.md 冗余审计与软预算                      | TODO  |
| [LUM-407](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-407) | (本批登记册吸收)                          | 14 条目 + F 队列变更 + memory-tool 分工纪律     | 本 PR |
