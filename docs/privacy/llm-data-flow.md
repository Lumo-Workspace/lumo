# 客户代码去向:LLM 链路 × 模型 × 供应商 × 留存政策

> LUM-854 · 实测于 2026-09-26(`npx tsx scripts/analysis/lum854-zdr/probe.ts`)。
> 本文是对外隐私说明的**事实依据**,不是对外文案本身;对外发布前需法务审阅。

## 一句话结论

Lumo 发给大模型的所有请求(chat 与 embedding)都经 Vercel AI Gateway,并在**请求线路层强制** `zeroDataRetention: true`:Gateway 只会把请求路由到与 Vercel 签有零数据保留(ZDR)协议的供应商;若某模型没有这样的供应商,请求直接失败(`no_providers_available`),**不会降级**到会留存数据的供应商。ZDR 包含「不用于训练」。

## 怎么保证的(以及怎么防漂移)

| 层         | 位置                                   | 作用                                                                                                                                                                                                                           |
| ---------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 线路层强制 | `lib/ai/zdr-fetch.ts`                  | 改写每个发往 Gateway 的 POST 请求体,强制 `providerOptions.gateway.zeroDataRetention = true`;调用点传 `false` 也会被覆盖;读不懂的请求体直接抛错(fail closed)                                                                    |
| 唯一入口   | `lib/ai/gateway.ts`                    | 运行时唯一可用的 Gateway provider,挂载上面的 fetch                                                                                                                                                                             |
| 防绕过     | `__tests__/lib/ai/zdr-gateway.test.ts` | `lib/` `app/` `shared/` 下任何文件直接 import `@ai-sdk/gateway` 或任何模型厂商 SDK(`@ai-sdk/openai`、`@anthropic-ai/sdk`、`openai` 等)即测试失败;另有端到端断言(真实 provider + 假 fetch)证明 chat 与 embedding 请求体都带 ZDR |
| 真实探针   | `scripts/analysis/lum854-zdr/probe.ts` | 用生产同款 provider 对 `lib/ai/models.ts` 每个模型 + embedding 各发一次请求,任何一个没有经过 ZDR 过滤就非零退出                                                                                                                |

新增模型或换模型:改 `lib/ai/models.ts` 后重跑探针;探针失败说明该模型在 Gateway 上没有 ZDR 供应商,不能用于客户数据。

## 模型 × 实际供应商(ZDR 过滤后)

「实际供应商」是本次探针的落点;Gateway 会在 ZDR 候选集内按可用性/负载切换,故列出完整候选集。「被排除」= Gateway 标记 `zdr_not_supported` 而跳过的供应商——客户数据**不会**到达它们。

| 模型常量                                  | 模型                           | 本次落点  | ZDR 候选集(按 Gateway 执行顺序)                                                                 | 被排除(非 ZDR)                                                                 |
| ----------------------------------------- | ------------------------------ | --------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `REASONING_MODEL`                         | `openai/gpt-5.5`               | openai    | openai → azure                                                                                  | bedrock(`zdr_ineligible_model`:该模型在 bedrock 上不在 ZDR 范围)               |
| `GENERATION_MODEL`                        | `deepseek/deepseek-v4-pro`     | alibaba   | alibaba → baseten → azure → deepinfra                                                           | **deepseek(官方)**、novita                                                     |
| `MEMORY_JUDGE_MODEL`                      | `deepseek/deepseek-v4-pro`     | alibaba   | 同上                                                                                            | 同上                                                                           |
| `FAST_MODEL` / `TRANSLATION_MODEL`        | `deepseek/deepseek-v4-flash`   | alibaba   | alibaba、baseten、digitalocean、azure、deepinfra、wafer                                         | gmicloud、novita                                                               |
| `HUNT_MODEL`                              | `alibaba/qwen3-coder-plus`     | alibaba   | alibaba                                                                                         | —                                                                              |
| `CONTENT_MODEL` / `POLICY_COMPILER_MODEL` | `zai/glm-5.2`                  | baseten   | baseten → runware → alibaba → digitalocean → togetherai → nebius → deepinfra → parasail → wafer | **zai(智谱官方)**、blackbox、novita、streamlake、gmicloud、inceptron、friendli |
| `EMBEDDING_MODEL`                         | `alibaba/qwen3-embedding-0.6b` | deepinfra | (embedding 响应不回显路由;强制 ZDR 下请求成功即证明有 ZDR 供应商)                               | —                                                                              |

各供应商在 Gateway 下的条款(来源:Vercel [ZDR 文档](https://vercel.com/docs/ai-gateway/security-and-compliance/zdr) 的供应商表,2026-09-22 版):

| 供应商                                                           | 不训练 | ZDR | 条款说明                                  |
| ---------------------------------------------------------------- | ------ | --- | ----------------------------------------- |
| OpenAI                                                           | ✓      | ✓   | ZDR with safety retention(见下方注意事项) |
| Alibaba Cloud                                                    | ✓      | ✓   | Custom policy(与 Vercel 的单独协议)       |
| Baseten                                                          | ✓      | ✓   | Security                                  |
| Azure                                                            | ✓      | ✓   | Data privacy                              |
| Bedrock                                                          | ✓      | ✓   | Data protection                           |
| DeepInfra                                                        | ✓      | ✓   | Data handling                             |
| DigitalOcean / Together AI / Nebius / Parasail / Runware / Wafer | ✓      | ✓   | 各自 ZDR / ToS 条款                       |
| Vercel AI Gateway 本身                                           | ✓      | ✓   | 不留存 prompt 与输出,请求完成即删除       |

## 链路 × 模型 × 送出的数据

所有链路都走同一个强制 ZDR 的 provider,下表用于说明「哪些数据会离开 Lumo」。

| 链路                                                                        | 代码位置                                                                                                          | 模型常量                    | 送出的数据                           |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------ |
| L2 安全 judge                                                               | `lib/llm/security-judge-client.ts`                                                                                | REASONING                   | 客户 PR diff / 代码片段              |
| L3 hunt(搜索 / 规划 / 压缩)                                                 | `lib/llm/security-hunt-{,plan-,compress-}client.ts`                                                               | HUNT / FAST                 | 客户仓库代码、diff、沙箱命令输出     |
| 安全 falsifier / 处置 falsifier                                             | `lib/llm/security-{,disposition-}falsifier-client.ts`                                                             | REASONING                   | 客户代码、finding                    |
| 代码规则 judge                                                              | `lib/llm/code-rule-judge-client.ts`                                                                               | REASONING                   | 客户 diff + 项目规则                 |
| 策略编译                                                                    | `lib/llm/policy-compiler-client.ts`                                                                               | POLICY_COMPILER             | 客户仓库的 CLAUDE.md / AGENTS.md     |
| 测试篡改 / 静默修复 / 声明忠实度 / 合同弱化 / spinoff judge、action-confirm | `lib/llm/*-judge-client.ts`、`action-confirm-client.ts`                                                           | REASONING                   | diff、测试文件、agent 声明、验收合同 |
| 越界申辩                                                                    | `lib/llm/crossing-explain-client.ts`                                                                              | GENERATION                  | 越界证据(可含命令与代码)             |
| session / turn / run 摘要、内容摘要                                         | `lib/services/session-summary/*`、`turn-summary/*`、`content-summary.service.ts`、`lib/llm/run-summary-client.ts` | CONTENT / FAST / GENERATION | agent 会话记录(可含代码片段)         |
| 记忆抽取 / 归并 / 折叠 / 去重 / 语言规范化、lineage 使用判定                | `lib/services/memory/*`、`lineage/usage-judge.ts`                                                                 | FAST / MEMORY_JUDGE         | 会话记录片段、团队记忆               |
| 记忆 embedding                                                              | `lib/ai/embedding.ts`                                                                                             | EMBEDDING                   | 记忆文本                             |
| sprint / milestone 摘要、报告、plan 聚类/对齐/生成                          | `lib/llm/{sprint,milestone}-summary-client.ts`、`lib/summaries/report.ts`、`lib/llm/plan-*`                       | GENERATION / REASONING      | 任务、PR 标题、idea 等项目文本       |
| 任务描述 / 拆解 / 优先级 / 查重 / 快速派发                                  | `lib/services/{description,duplicate-check,quick-dispatch}.service.ts`、`app/api/tasks/*`                         | GENERATION                  | 任务文本                             |

## 注意事项(对外说明时必须如实写)

1. **OpenAI 的 ZDR 带「安全留存」例外**:Vercel 标注为 "ZDR with safety retention"——滥用监测场景下可能有有限留存。对外不应写成「任何供应商都绝对零留存」。
2. **开源权重模型的托管方不是模型作者**:DeepSeek / GLM 请求由 Alibaba Cloud、Baseten 等托管方处理,DeepSeek 与智谱官方 API 被排除。对外应写「由签有 ZDR 协议的托管方运行」,而非「由 DeepSeek/智谱处理」。
3. **数据地域未核实**:Gateway 的路由元数据不包含托管区域;Alibaba Cloud 等托管方的服务区域(是否中国大陆境内)本次**无法从 Gateway 侧确认**。若客户要求地域承诺,需向 Vercel 确认,或用 `providerOptions.gateway.only` 把候选集限定到已确认地域的供应商。
4. **托管方会随请求变化**:ZDR 候选集内的具体落点由 Gateway 按可用性选择;保证的是「只在 ZDR 候选集内」,不是「固定某一家」。
5. **provider 级 prompt caching**:Vercel 说明缓存发生在供应商侧,是否符合 ZDR 取决于供应商。
6. **BYOK**:ZDR 生效时 Gateway 默认跳过 BYOK key(除非在控制台标记该 key 为 ZDR)。Lumo 目前使用 Gateway 系统凭证。
7. **范围**:以上覆盖生产运行时(`lib/`、`app/`)。`scripts/` 下的离线评测 / replay 脚本不经此 provider,仅用于内部数据,不处理客户数据。
8. **套餐前提**:按请求 ZDR 需要 Vercel Pro / Enterprise;本次探针在当前团队下全部通过。
