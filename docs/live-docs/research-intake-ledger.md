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

---

## C. 项目管理与协作(PM / Agent-collaboration domain)

> 未来吸收对象:human-approval loops、agent observability、长程任务执行(2026 Agent Era survey 指向的方向)。除外部条目外,以下为本域已沉淀的内部方法论发现。

**Writing tools for agents** ([Anthropic Engineering blog, 2025-09](https://www.anthropic.com/engineering/writing-tools-for-agents)) — \[采用\] → LUM-392 实测报告 + 三项 CLI 改进 · 2026-06

- Finding: 为 agent 写工具是新型软件契约——按 agent 认知方式整合工作流(`get_customer_context` 式)而非机械包装端点;命名空间划界;返回语义化标识(UUID→自然语言标识显著提升检索精度);token 效率(分页/截断+引导性提示,错误响应给下一步而非裸错误码);工具描述当 prompt 写(微小改进即显著收益,Sonnet 3.5 SWE-bench SOTA 部分来自描述优化)。方法论核心:真实场景 eval + 读 transcript 找摩擦点 + 用 Claude 自动改进工具,闭环迭代。
- 吸收: Lumo 的 agent 工具面 = lumo CLI + SKILL.md + hook 注入,原则全部可迁移。**形态已对**(task context/session wrap/next 是整合形态;LUM-N 语义标识;命名空间无混淆证据;show/context 分层被 agent 自发用对)→ 缺的是**评估闭环**。落地:用 prod HookEvent(325 session/3332 真实调用)建首个 CLI usage eval(`scripts/analysis/lum392-cli-friction/`,可复跑),实测出最大摩擦不是错误率(2.3%)而是:仪式性状态走步 70 链 145 调用(状态机其实允许直达,纯隐性知识未显性化)、13 次 flag 幻觉(位置参数被猜成具名 flag)、错误信息不指路(~25 次死胡同,`doc move` 文案是内部正面先例)。裁决:错误文案 actionable 化+SKILL.md 显性化补强+padEnd bug=做;`--concise` 分级与分页 audit=缓(p90 8.5k 字符可接受,带触发器);命令合并删除=不做(零使用的 21 命令是人类发起场景,非冗余)。详见[实测报告](https://www.uselumo.ai/workspace/lumo/documents/lumo-cli-agent-lum-392-31)。

**落地交付(2026-06-10 两 PR 均已 merge):**

- [PR#462](https://github.com/Lumo-Workspace/lumo/pull/462) — eval harness(`scripts/analysis/lum392-cli-friction/`,只读 prod、`--check` 自检、解析层有单测)+ 实测报告权威源 + 本登记册条目。复跑出 diff 即评估闭环,发版后可重跑。
- [PR#463](https://github.com/Lumo-Workspace/lumo/pull/463) — 三项「做」:① 错误文案 actionable 化(transition 409 列允许目标+DONE 指向 comment,与 TRANSITIONS 矩阵同源;memory 404 说明要完整 cuid;could-not-read-file 统一带 cwd+相对路径提示;commander 加 did-you-mean+`--help` 指引);② `doc list --task` padEnd 崩溃兜底;③ SKILL.md 不存在命令/flag 负面清单 + tasks.md 状态转移矩阵与「可直达」规则。**附加发现并修复:skill frontmatter description 堆到 3981 字符/250 个枚举触发词(每 session 常驻 ~1.3k token)→ 裁到 967 字符类别级,CLAUDE.md 同步规则加 1000 字符硬上限堵根因**——「工具描述当 prompt 写」的反面案例:描述也是 context 预算的一部分,recall 靠语义类别不靠穷举。cli 1.25.1 已发布(npm,2026-06-10)。
- 待观察(带触发器,不占任务):`--concise`/分页(触发器=注入预算告警或任务上百;context-engineering 文的 context-rot 梯度退化给该触发器理论背书——任务显著变长时复查「p90 8.5k 可接受」的判断)、`task status` 与 `task context` 的边界混淆(status 刚上线、样本 4 次,下次 harness 复跑看两个信号:恢复场景误拉 context、查状态字段误调 status)、description 裁剪后的触发 recall(客户端行为,DB 测不到,出现漏触发先查这里)。

**Effective context engineering for AI agents** ([Anthropic Engineering blog, 2025-09](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)) — \[合并→Writing tools for agents / LUM-392 / Memory v6\] · 2026-06

- Finding: context 是有限注意力预算(attention n² → context rot 是梯度退化非悬崖),核心原则=最小高信号 token 集;system prompt 在「过具体-过空泛」之间找 altitude;few-shot 用 canonical 例不堆边角清单;检索推荐 hybrid(upfront 紧凑注入 + just-in-time 标识符按需拉取,progressive disclosure);长程任务三技法=compaction(harness 层)/ structured note-taking(持久笔记)/ sub-agent(编排层)。
- 吸收: 上游理论篇,机制面零新增——工具节同源于已落地的 Writing tools for agents(LUM-392);「最小高信号集」即注入预算 + LUM-279 proven-value 排序 + LUM-328 冷淘汰的既有实践;altitude/canonical 原则即 LUM-392 的 description 裁剪结论;note-taking 即 Memory v6 产品本体;compaction 与 sub-agent 出界(harness/编排层,Claude Code 负责)。确认并点名保住:**hook session-start 一次性注入 + show/context 分层 = 文章推荐的 hybrid 检索形态**(LUM-392 实测 agent 自发用对);mid-session 语义检索继续 defer(「do the simplest thing that works」直接支持 F 队列该条的触发器设计)。新增 F 观望一条:Claude Code 自带 memory tool 与 Lumo memory 的双写/分工边界。

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

---

## F. 观望队列(有 bearing,触发条件未到)

- **关系字段/轻量结构**(StructMem/Zep 方向):LUM-327 已定 defer。触发器:当注入需要把某条 TRAP 与其成因 DECISION 并排呈现、且 merge-rate 排序被证实无法共同浮出时,重开 relatedMemoryIds vs MemoryRelation 选型。
- **更大 embedding 模型**(4B/8B):触发器:LUM-329 eval 显示 0.6b 分离度不足以支撑某个新场景(当前 0.6b 反而最优,无动机)。
- **mid-session 语义检索**(agent 干到一半主动查记忆):当前 session-start 一次性注入 + 按 proven-value 排序够用;触发器:出现明确的「注入集装不下但 agent 需要长尾记忆」证据。
- **遗忘曲线 t 项生效核查**:语料老化(出现 >30d 行)后,复查 LUM-328 排序里 retention 项是否开始判别(预计 2026-07 起)。
- **memory 启动时投毒校验分类器**(containment 文章「plan for persistent state poisoning」的完整形态):当前 memory 写入方=workspace 成员+本 workspace 的 agent,信任域小,来源标注(LUM-347)+`<untrusted-*>` 边界够用。触发器:memory 写入来源扩到外部(公开 intake、跨 workspace 共享、第三方集成直写)或出现实际投毒案例时,上 startup 校验分类器。
- **enforced TTL / expiresAt schema 字段**(context-personalization 文 ephemera 处理的完整形态):LUM-394 先走 extract 端拒收(零 schema)。触发器:eval 或 prod 实测显示 ephemera 仍持续落库(extract 判别拦不住)时,再上 schema 级 TTL 并在冷淘汰里强制执行。
- **Claude Code 自带 memory tool 与 Lumo memory 的分工边界**(context-engineering 文提到 Developer Platform 的 file-based memory tool 已公测,跨 session 持久):Lumo agent 跑在 Claude Code 里,harness 记忆与 Lumo memory 可能双写——同一条工程教训记两处、口径漂移、飞轮信号分流。触发器:观察到 agent 把工程教训写进本地 memory 而非 `lumo memory add`,或两边出现矛盾/重复记录时,定分工约定(候选:SKILL.md 写明「项目工程教训一律走 lumo memory」)。

---

## 附录:首批吸收的交付索引(Memory v6,2026-06)

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
