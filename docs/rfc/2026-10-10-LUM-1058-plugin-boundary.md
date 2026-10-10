# RFC：MIT open-core 拆分的插件边界（LUM-1058）

> 状态：**待用户裁定**。基线 `origin/main` @ e6f0a1d08（2026-10-10）。本文所有数字都可以用附录 A 的命令在该 commit 上复现。
>
> 背景裁定（2026-10-10，记在 LUM-1014 / LUM-1033 / LUM-1035 的 Decisions）：平台从 ELv2 改为 MIT，走 TipTap 式 open-core，安全能力做成插件、不进 MIT 核心；`cli/`、`shared/` 维持 MIT；插件的许可与分发待定；**首次公开发布（LUM-1035）要等拆分完成**。

## 0. 结论摘要

1. **边界**：按真实 import 图核实后，安全相关代码共 226 个文件、54,060 行（`app`+`components`+`lib` 里 220 个 / 51,364 行，占这三个目录 250,590 行的 20.5%）。建议去向：
   - **留 MIT 核心**：53 个文件 / 16,126 行。密钥注册表与脱敏、hook 载荷的代码脱敏、注入防护、越界记录与人工裁定框架（含 read receipt、抑制规则、raw 保留期）、越界复判（确定性）、hook 接入的检测管线与**基线检测器**。
   - **插件**：161 个文件 / 35,129 行。整个 PR 安全扫描（编排、SARIF 导入、托管扫描、AI 审查 / verifier / ranker、hunt、扫描证据保留）、高级越界检测器、项目策略规则编译（LLM）、越界 AI 分诊与系统解释。
   - **私有（评测）**：12 个文件 / 2,805 行，越界检测评测集与基准。
2. **扩展机制**：插件放在私有主仓的树内（`ee/security/`），核心只认 `lib/plugins/` 里的注册表接口；在 OSS 快照里，唯一一个列出已装插件的文件（`lib/plugins/installed.ts`）被 overlay 替换成空列表。API route、workflow 文件留在插件树里按文件路由挂载，OSS 里不存在即 404；核心反向依赖（53 条 import 边、31 个核心文件）全部改为注册点。
3. **Prisma**：推荐方案 A——安全表留在唯一的核心 schema（迁移本来就不能删），核心代码不读写这些表，用测试守住；可选地按 Prisma 7 的多文件 schema 把这些 model 放到单独的 `.prisma` 文件里。方案 B（插件独立 schema + 独立迁移）代价大、与「迁移永不删除」冲突，不推荐。
4. **插件许可**：推荐**商业（专有）许可、首期只在 SaaS 用**，保留以后对自托管单独售卖的选项；ELv2 公开源码作为备选。MIT 下 **CLA 不再必要，建议改用 DCO**（需要推翻 LUM-1035 的 CLA 前置条件）。
5. **首次发布最小路径**：PR 1–7，约 **12–17 人日**。有一个约 5–7 人日的「manifest 排除 + stub」过渡方案可行，但会让公开代码和我们实际运行的代码分叉、并丢掉一部分基线回归测试，**只建议在发布日期压倒一切时使用**。

## 1. 统计方法与误报处理

- **范围**：`git ls-files` 里 `app/ components/ lib/ hooks/ types/ constants/ shared/src/ mcp/ extensions/ security/` 和根目录 `instrumentation.ts`、`proxy.ts`。行数按换行计（等同 `wc -l`）。
- **分类**：附录 A 脚本里的 `MODULES` 表——每个模块一条路径正则 + 去向，先匹配者胜。表是按每个文件的文件头注释（LUM 编号与职责说明）逐个核对后写的，不是按文件名关键词。
- **依赖关系**：import 图用与 `scripts/oss-export/manifest.ts` 相同的规则抽取（`from` / 裸 `import` / `import()` / `require` / `jest.mock` 系列，解析 `@/` 和相对路径），所以这里算出的「核心 → 插件」边，就是将来 `npm run oss:export` 的 import 检查会报出来的那些边。
- **覆盖性检查**（脚本 `--files` 输出的两段）：
  1. **名字像安全、但没被归类的文件**（关键词 `secur|scan|crossing|boundar|hunt|semgrep|sarif|redact|secret|inject|triage|verifier|ranker|falsifier|dispos|polic|sandbox|evasion|sensitive|suppress|guard`）——14 个，逐个核实都与安全产品无关，见下表。
  2. **只被安全文件 import 的未归类生产文件**（排他依赖）——迭代归类过程中查出 `lib/auth/github-oidc.ts`、`lib/integrations/vercel-sandbox/index.ts`、`lib/ai/evaluation.ts`、`lib/integrations/github/mirror-code-strip.ts`、`hook-event-code-backfill` 的 service 与 repository，已归入对应模块。最终输出里剩 3 个，都是通用基础设施、留核心：`lib/blob/client-upload.ts`（blob 直传，目前只有 SARIF 上传在用）、`lib/repositories/repo-spellings.ts`（仓库名拼写变体）、`lib/runtime/vercel-oidc.ts`（10 行的 Vercel OIDC token 读取，`lib/ai/evaluation.ts` 归入插件后它只剩插件在用）。

**名字带关键词但与安全无关（误报）**：

| 文件                                                                                                                                | 实际用途                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `app/security/page.tsx`、`components/security/{SecurityPage,SubprocessorTables,SubprocessorChanges,LanguageSwitcher}.tsx`           | 对外的「安全与信任」页（子处理方清单），法务内容                                                                            |
| `app/api/tasks/[id]/test-case-runs/[runId]/disposition{,/receipt}/route.ts`、`lib/services/test-case-defect-disposition.service.ts` | test case 缺陷裁定（LUM-812）；它**复用**核心的 `lib/disposition/read-receipt.ts`，这正是 read receipt 必须留核心的理由之一 |
| `app/workspace/[workspaceUrl]/hooks/useCurrentUser.ts`                                                                              | `useCurrentUser` 里的 `seCur` 子串命中                                                                                      |
| `lib/context/injection-metrics.ts`                                                                                                  | session-start 注入 context 的 token 统计（LUM-402），不是 prompt 注入防护                                                   |
| `lib/html/rich-html-policy.ts`                                                                                                      | 富文本 HTML 白名单（XSS 防护，LUM-916）。属于核心安全基线，本来就在核心，不在本次拆分范围                                   |
| `lib/services/document-structure-guard.ts`、`lib/services/memory/supersede-guard.ts`、`lib/services/session-binding-guard.ts`       | 文档结构守卫、记忆覆盖守卫、session 绑定守卫，都是产品逻辑                                                                  |

**与任务 brief 粗测的差异**：brief 写的是约 195 个文件 / 4.8 万行、46 个非安全文件 import、5 个安全 model。按上面的口径重跑是 220 个 / 51,364 行（三目录内）、68 个非安全生产文件 import 了安全模块（附录 A `distinct non-security prod importers`）、**6 个**安全专属 model（多了 `ProjectPolicy`，见 §4）。差异来自：brief 按文件名统计，本文按模块归类并补上了排他依赖（vercel-sandbox、github-oidc 等）和 `shared/src`、`security/`。

## 2. 边界：逐模块判定

### 2.1 模块总表

`核心 fan-in` = 不属于任何安全模块的生产文件里，import 了该模块的文件数（测试、脚本、CLI 不算）。

| 模块                                                                                                                | 去向               |    文件 |       行数 | 核心 fan-in | 测试 importer | 理由（代码事实）                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------- | ------------------ | ------: | ---------: | ----------: | ------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| redaction（密钥注册表、`scanSecrets`、`redactForStorage`、存量再脱敏）                                              | 核心               |       8 |      2,376 |          10 |            22 | 7 个核心 repository（activity / comment / memory / session / task / task-artifact / test-case）落库前都调 `redactStoredFields`，hook-event repository、`audit.service`、`validation/hook-payload` 调 `redactForStorage`。拆走会让核心直接把密钥写进库，违反「基线不变弱」 |
| code-redaction（hook 载荷里的客户代码脱敏、PR 评论代码剥离、hook 存储策略）                                         | 核心               |       6 |      1,178 |           8 |            20 | 这是数据保留 / 隐私承诺，不是安全产品功能：`app/api/hooks/_handler.ts`、session 回放、`lib/legal/retention-figures.ts`（法务页数字）都依赖它                                                                                                                              |
| inject-guard（`guardInjectedText` 等 + `shared/src/untrusted-*`）                                                   | 核心               |       3 |      1,447 |          16 |            15 | 记忆渲染、task context、评论 / Slack / web link / artifact 的 repository、PR review todo 渲染都在注入 agent context 前调用它。`shared/src/untrusted-content.ts` 已经以 MIT 随 CLI 发布在 npm                                                                              |
| shared-scan-format（`shared/src/security-scan.ts`、`hunt-audit.ts`）                                                | 核心（shared）     |       2 |        690 |           0 |            21 | 纯展示常量与格式化，CLI 的 `task status` / `pr scan` 在用，已随 `@lumoai/cli` 以 MIT 发到 npm，撤不回也没必要撤                                                                                                                                                           |
| crossing-core（越界记录、裁定、抑制规则、raw 保留期、read receipt、面板、API）                                      | 核心               |      25 |      7,177 |          20 |           105 | 核心的 DONE 裁定（`done-verdict.service`）、里程碑 / next-steps / 时间线、attribution 重标、记忆删除守卫、保留期设置、test case 裁定都直接读写越界记录；是「人工裁定框架」本体                                                                                            |
| crossing-detectors（hook 检测管线 + 基线检测器、`command-shape`、`judge-timeout`）                                  | 核心（拆开）       |       4 |      2,403 |           6 |            36 | `app/api/hooks/post-tool-use` 调 `boundaryDetectorService`；`command-shape` 被 agent-run / attribution 用，`judge-timeout` 被 claim-faithfulness 用。`boundary-detector.service.ts`（1,827 行）是单体，要拆成「管线 + 注册表 + 基线检测器」，高级检测器改为注册（§2.2）   |
| crossing-rejudge（复判，LUM-780）                                                                                   | 核心               |       5 |        855 |           1 |            11 | **核实后修正初步倾向**：复判是确定性的（`rejudge*.ts` 与 service 都不 import LLM），是阻断型越界唯一的出口，属于裁定框架。只有 `POLICY_WEAKENING` 分支依赖策略编译器，改为经策略提供者                                                                                    |
| crossing-detectors-adv（敏感路径读取、不可信代码执行、破坏性文件系统命令、动作类 LLM 二次确认）                     | 插件               |       5 |      1,621 |           0 |            10 | 核心只经 `boundary-detector.service` 间接用到；对应 `SENSITIVE_PATH_READ` / `UNTRUSTED_CODE_EXECUTION` / `DESTRUCTIVE_FS_COMMAND` 与 `EXFILTRATION_PUBLIC` / `CLOUD_DATA_DELETION` / `INFRA_TERMINATION` 的 LLM 确认                                                      |
| policy-rules（CLAUDE.md / AGENTS.md 规则的 LLM 编译、代码规则 judge、push-target / action-rule 匹配）               | 插件               |      13 |      1,541 |           2 |            17 | 核心 fan-in 只有 2：`task-state.service`（IN_REVIEW 时 `dispatchPolicyCheck`）和 `memory/write-gate`（读已编译规则，没有规则时本来就返回空）。编译与判定都靠 LLM。**这一项值得单独裁定**，见 Q2                                                                           |
| crossing-ai（AI 分诊、系统解释 LLM、Jev 评测模型端点）                                                              | 插件               |       8 |        802 |           0 |             8 | 只被越界面板（分诊行）和 `boundary-crossing.service.explainCrossing`（动态 import）用                                                                                                                                                                                     |
| crossing-eval（align-eval 金标语料、离线评测 judge / 统计）                                                         | 私有               |      12 |      2,805 |           0 |             9 | 评测集与调参证据。LUM-1033 D1/D2 已把 `scripts/crossing-eval` 等列为私有，但 `lib/boundary-crossing/eval/**`、`align-eval*.ts` 现在仍按 `lib/**` 进快照，需要一并排除                                                                                                     |
| scan-core（PR 扫描编排 stage A、findings、DONE 闸、提醒、`pr scan` 读出、PR 回写、设置开关）                        | 插件               |      37 |      9,738 |          20 |           122 | 见 §2.3。20 个核心 fan-in 都能归到 6 个扩展点上                                                                                                                                                                                                                           |
| scan-sarif（客户 CI 推 SARIF）                                                                                      | 插件               |      13 |      2,412 |           0 |            26 | 依赖 scan-core 的表与 stage A                                                                                                                                                                                                                                             |
| scan-managed（托管扫描 gitleaks/semgrep/trivy/zizmor/osv、基线扫描、Vercel Sandbox、自写 semgrep 规则 `security/`） | 插件               |      17 |      3,572 |           1 |            55 | 核心只有 GitHub webhook 在 push 默认分支时动态 import `security-baseline.service`                                                                                                                                                                                         |
| scan-ai-review（L2 审查、verifier、ranker、falsifier、建议裁定）                                                    | 插件               |      23 |      2,759 |           0 |            41 | 全部经 stage A 调用                                                                                                                                                                                                                                                       |
| scan-hunt（L3 hunt、子图规则、沙箱命令闸）                                                                          | 插件               |      39 |     12,055 |           1 |            78 | 核心只有 `claim-faithfulness/prefilter` 借用了 `hunt/trigger.ts` 的纯函数 `addedControlCallIds`，把它移到核心即可                                                                                                                                                         |
| scan-retention（扫描证据保留期与清扫）                                                                              | 插件（常量留核心） |       6 |        629 |           4 |            18 | 法务页数字、workspace 设置、保留存量服务只用到天数常量和 `retentionCutoffs`；常量移核心，清扫随插件                                                                                                                                                                       |
| **合计**                                                                                                            |                    | **226** | **54,060** |             |               | 核心 53 / 16,126；插件 161 / 35,129；私有 12 / 2,805                                                                                                                                                                                                                      |

逐文件清单见附录 B。

### 2.2 越界检测器怎么分

`BoundaryCrossingCategory` 共 24 个值，去掉 LUM-942 停产的 `TEST_TAMPERING` / `CONTRACT_WEAKENING` / `SPINOFF_LAUNDERED` / `SILENT_FIX` 和 LUM-750 revert 后保留为废弃值的 `SELF_DISPOSITION`，其余 19 类建议这样分（动作类 3 个在两列都出现：匹配在核心、LLM 确认在插件）：

| 留核心（确定性、与 Lumo 的任务 / DONE 流程直接绑定）                                                                                                                                                                                                                                                                      | 插件（高级规则或依赖 LLM）                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUSH_TO_PROTECTED_BRANCH`、`MIGRATION_FILE_DELETED`、`TEST_FILE_DELETED`、`HARDCODED_SECRET`（复用核心 `scanSecrets`）、`HOOK_BYPASS`、`SESSION_BINDING_MISSING`、`NEW_NPM_DEPENDENCY`、`DESTRUCTIVE_DB_COMMAND`、`USED_TRAP_MEMORY_DELETED`、`STEWARD_IMPLEMENTATION_ARTIFACT`、`SENSITIVE_PATH_EDIT`（内置路径表部分） | `SENSITIVE_PATH_READ`（`sensitive-read.ts`）、`UNTRUSTED_CODE_EXECUTION`（`untrusted-code.ts`）、`DESTRUCTIVE_FS_COMMAND`（`destructive-fs.ts`）、`EXFILTRATION_PUBLIC` / `CLOUD_DATA_DELETION` / `INFRA_TERMINATION` 的 LLM 二次确认（`action-confirm*`）、`PROJECT_RULE_VIOLATION` / `POLICY_WEAKENING` 与项目级 `SENSITIVE_PATH_EDIT/READ` glob（策略编译器） |

说明：

- 无插件时 `EXFILTRATION_PUBLIC` 等动作类仍由核心的确定性匹配器**记录**，只是没有 LLM 二次确认去降噪——召回不降，误报会多一些。这和 LUM-466 之前的行为一致。
- base64 等混淆解码（`evasion.ts` 只是 20 行的标记常量）留核心；解码逻辑目前写在 `boundary-detector.service.ts` 里，拆分时随管线留核心。
- 核心检测器的规则全部公开，这与 LUM-1036 的结论一致：那次已经把各项「公开后可被针对性规避」的盲区修掉或写明威胁模型，拆分不以保密为理由。

### 2.3 PR 安全扫描为什么整体进插件

两种切法：

- **S-a（推荐）**：整个 PR 安全扫描进插件，包括编排和 PR diff 上的确定性密钥扫描、SARIF 导入。核心只提供 6 个扩展点（DONE 闸贡献、agent 提醒、PR / push 事件、任务状态读出、UI 插槽、设置分区）。
- **S-b**：编排 + 确定性密钥扫描 + SARIF 导入留核心，托管扫描 / AI 审查 / hunt 进插件。

代码事实：stage A（`pr-security-scan.service.ts`，1,426 行）直接 import 了 AI 审查 28 处、hunt 15 处、托管扫描 6 处、证据保留 3 处、SARIF 2 处（附录 A `modedges`）。S-b 除了 S-a 的 6 个扩展点之外，还要先把 stage A 改造成「扫描层注册表」，多 4–6 人日，而且收益只是自托管用户能拿到 PR diff 上的确定性密钥扫描——这条能力在核心里已经以 `HARDCODED_SECRET` 越界（agent 写文件时）的形式存在。因此首发选 S-a；S-b 可作为发布后的增强（Q3）。

## 3. 扩展接口

### 3.1 前提：插件住在私有主仓的树内

两个代码事实决定了机制的形状：

1. **Vercel Workflows 不会在 `node_modules` 里找 workflow 文件。** `@workflow/next` 以 `dirs: ['.']` 扫项目，`@workflow/builders/dist/base-builder.js` 的 `getInputFiles()` 把 `**/node_modules/**` 列为 ignore。所以插件如果做成独立 npm 包，`'use workflow'` / `'use step'` 文件（`lib/workflows/` 下 hunt、托管扫描、基线扫描、SARIF 导入、verifier、建议裁定、PR 回写共 12 个安全相关文件）不会被编译，需要额外的构建期拷贝。
2. **Next.js App Router 的路由是文件路由。** 插件的 API route 要么是项目里的真实文件，要么由核心的 catch-all 分发；而现有 URL 已经被已发布的 CLI（`lumo pr scan`、`lumo crossing …`、`lumo workspace security-scan`）和客户 CI（SARIF 上传 `app/api/integrations/security/sarif/*`）写死，不能改。

因此首期推荐**树内插件**：私有主仓新增 `ee/security/`（或在原路径不动、仅靠 manifest 排除，见 §6.3），route 与 workflow 文件留在 `app/`、`lib/workflows/` 的原路径（文件即路由，URL 不变），由 `oss/manifest.json` 排除；核心代码只依赖 `lib/plugins/` 的接口。OSS 快照里这些文件不存在，对应 URL 自然 404。将来若要把插件作为商业包卖给自托管客户，再做包化（届时需要解决上面第 1 条，见 §7 PR 9）。

### 3.2 接口草图（MIT 核心，`lib/plugins/types.ts`）

```ts
import type {
  BoundaryCrossingCategory,
  BoundaryCrossingSeverity,
} from '@prisma/client'
import type { ComponentType } from 'react'

/** 一个插件。register 在每个进程里只被调用一次（见 3.3）。 */
export interface LumoServerPlugin {
  id: string // 'security'
  register(api: PluginRegistrar): void
}

export interface PluginRegistrar {
  /** hook PostToolUse 管线里的额外检测器；核心基线检测器也走同一接口。 */
  crossingDetector(d: CrossingDetector): void
  /** 越界的系统解释（LLM）；没有提供者时核心返回 not_available。 */
  crossingExplainer(e: CrossingExplainer): void
  /** 项目策略规则来源（memory write-gate、复判 POLICY_WEAKENING 用）。 */
  policyRuleSource(s: PolicyRuleSource): void
  /** DONE 裁定的额外阻断项（PR 安全 finding）。 */
  doneGate(g: DoneGateContributor): void
  /** session-start / task context / task status / PreToolUse 提醒的分节。 */
  agentContext(c: AgentContextContributor): void
  /** 核心领域事件订阅（fire-and-forget，处理器自己负责 waitUntil / workflow 启动）。 */
  on<E extends keyof CoreEvents>(
    event: E,
    handler: (p: CoreEvents[E]) => Promise<void>
  ): void
  /** workspace 设置分区：读写校验 + /api/workspaces/me 的序列化。 */
  workspaceSettings(s: WorkspaceSettingsContributor): void
  /** 数据保留：法务页数字、保留存量、workspace 保留期设置。 */
  retention(r: RetentionContributor): void
}

export interface CrossingDetector {
  id: string
  categories: readonly BoundaryCrossingCategory[]
  /** 纯函数优先；需要 I/O 的放 confirm（带 judge-timeout，超时即放弃，不阻塞 hook）。 */
  detect(input: BoundaryDetectionInput): DetectedCrossing[]
  confirm?(
    c: DetectedCrossing[],
    ctx: DetectContext
  ): Promise<DetectedCrossing[]>
}

export interface CrossingExplainer {
  explain(input: {
    crossingId: string
    detail: string
    policyRuleText: string | null
  }): Promise<string>
}

export interface PolicyRuleSource {
  latestRules(projectId: string): Promise<PolicyRule[]> // 无插件：[]
  /** 复判 POLICY_WEAKENING：当前编译器下这条规则是否仍成立。 */
  stillWeakens?(crossing: StoredCrossing): Promise<boolean | null>
}

export interface DoneGateContributor {
  id: string
  openBlockers(taskId: string): Promise<DoneBlocker[]> // 合并进 readDoneVerdict
}

export interface AgentContextContributor {
  id: string
  sessionStart?(taskId: string): Promise<ContextSection | null>
  taskContext?(taskId: string): Promise<ContextSection | null>
  taskStatus?(taskId: string): Promise<StatusSection | null>
  preToolUseReminder?(sessionId: string, taskId: string): Promise<string | null>
}

export interface CoreEvents {
  'github.pullRequest': {
    action: 'opened' | 'synchronize' | 'reopened' | 'closed'
    merged: boolean
    pullRequestId: string
    installationId: number
  }
  'github.push': {
    repositoryId: string
    ref: string
    isDefaultBranch: boolean
    headSha: string
  }
  'task.prLinked': { taskId: string; pullRequestId: string }
  'task.statusChanged': { taskId: string; from: string; to: string }
}

export interface WorkspaceSettingsContributor {
  key: string // 'securityScan'
  read(workspaceId: string): Promise<unknown>
  schema: import('zod').ZodTypeAny // 写入校验（取代 lib/validation/schemas.ts 里的 securityPolicySchema）
  write(workspaceId: string, value: unknown, actorId: string): Promise<void>
}

export interface RetentionContributor {
  key: string // 'scanEvidence'
  figures(): Record<string, number> // 法务页 / 设置页展示的天数
  stock?(workspaceId: string): Promise<RetentionStockLine[]>
}

/** 客户端插槽：只放 'use client' 组件，和服务端注册表分开以免把服务端代码打进 bundle。 */
export interface LumoClientPlugin {
  id: string
  slots: Partial<{
    'task.dossier.section': ComponentType<{
      taskId: string
      workspaceUrl: string
    }>
    'task.pullRequest.badge': ComponentType<{
      taskId: string
      pullRequestNumber: number
    }>
    'task.crossing.annotation': ComponentType<{ crossingId: string }>
    'settings.workspace.section': ComponentType<{ workspaceUrl: string }>
    'settings.retention.row': ComponentType<{ workspaceUrl: string }>
  }>
}
```

`BoundaryDetectionInput` / `DetectedCrossing` / `PolicyRule` 等类型从现有模块原样移到 `lib/plugins/` 或核心对应位置（`PolicyRule` 现在在插件侧的 `lib/services/policy/types.ts`，核心 `rejudge.ts` 和 `boundary-detector.service.ts` 都在用，所以类型本身留核心）。

### 3.3 注册与加载时机

```ts
// lib/plugins/installed.ts —— 私有主仓的版本
import { securityPlugin } from '@/ee/security/server'
export const INSTALLED_SERVER_PLUGINS = [securityPlugin]

// oss/overlay/lib/plugins/installed.ts —— OSS 快照里的版本（manifest 排除原文件 + overlay 替换）
export const INSTALLED_SERVER_PLUGINS = []
```

- **静态 import 列表，不做运行时按名加载**：Next.js / Turbopack 不能解析变量路径的 `import()`，静态列表也让 tree-shaking 和类型检查生效。客户端另有 `installed.client.ts`，同样处理。
- **惰性一次性注册**：`getPluginRegistry()` 第一次被调用时遍历列表执行 `register`，结果缓存在模块作用域。route handler、server component、workflow step、cron 都通过它取扩展点；没有全局启动顺序依赖（`instrumentation.ts` 不参与，避免 edge / 自托管 worker 的差异）。
- **防漂移**：一条测试断言 overlay 版本只导出空数组、且与正式版本同名同类型；`oss:export` 的 import 检查保证核心文件不直接 import `ee/`。

### 3.4 各类挂载点

| 挂载点        | 做法                                                                                                                                                                                                                                 | 无插件时                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| 越界检测器    | `boundaryDetectorService.detectAndRecord` 遍历 `registry.crossingDetectors`（基线检测器也注册到同一表）                                                                                                                              | 只跑基线检测器                                                                                         |
| 扫描层        | 首期不做扫描层注册表（S-a）；stage A 整体在插件内，由 `github.pullRequest` / `task.prLinked` 事件触发                                                                                                                                | 不扫描                                                                                                 |
| workflow 步骤 | 插件自己的 `'use workflow'` 文件放在插件树内的项目目录下（被 `dirs: ['.']` 扫到）                                                                                                                                                    | 文件不存在，不编译                                                                                     |
| cron          | route 文件在插件树；`vercel.json` 的 crons 和 `deploy/self-host/crontab`（由 `scripts/self-host-cron.ts` 从 vercel.json 生成）在 OSS 快照里去掉插件条目（需要给 `oss-export` 加一个 JSON 数组过滤 transform，或 overlay 这两个文件） | 不调度                                                                                                 |
| API route     | 插件 route 文件留原 URL，manifest 排除                                                                                                                                                                                               | 404；CLI 对这几条命令把 404 解释为「该服务器未安装安全插件」（MIT CLI 小改）                           |
| UI 插槽       | 核心组件放 `<PluginSlot name="task.dossier.section" … />`，内部 `next/dynamic` 渲染已注册组件                                                                                                                                        | 渲染 null：任务档案无安全扫描区块、PR 行无扫描徽标、设置页无扫描开关卡片和证据保留行、越界面板无分诊行 |
| 设置页        | `workspaceSettings` 贡献者决定 `/api/workspaces/me` 是否输出 `securityScan` 字段，以及写入校验                                                                                                                                       | 字段不出现；写入该键返回 400                                                                           |
| DONE 闸       | `readDoneVerdict` 合并 `doneGate` 贡献者的阻断项                                                                                                                                                                                     | 只看越界                                                                                               |
| agent 提醒    | `task-context` / `session` / `task-status` / PreToolUse 合并 `agentContext` 分节                                                                                                                                                     | 没有 PR 安全分节                                                                                       |

### 3.5 31 个核心文件的反向依赖如何消解

附录 A `--inversion` 列出了全部 53 条「核心生产文件 → 插件文件」import 边。按处理方式归类：

| 处理                                                          | 涉及的核心文件                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 纯函数 / 类型 / 常量移到核心（不改行为）                      | `security-scan/scan-secrets.ts` 与 `secret-patterns.ts` → `types.ts`；`repositories/project.repository.ts` → `SecurityBaseline` 类型；`claim-faithfulness/prefilter.ts` → `diff-lines`、`hunt/trigger`；`legal/retention-figures.ts`、`services/workspace.service.ts` → 证据保留常量；`boundary-crossing/rejudge.ts` → `policy/types` |
| `doneGate`                                                    | `services/done-verdict.service.ts`                                                                                                                                                                                                                                                                                                    |
| `agentContext`                                                | `app/api/hooks/pre-tool-use/route.ts`、`services/session.service.ts`、`services/task-context.service.ts`、`services/task-status.service.ts`                                                                                                                                                                                           |
| 事件                                                          | `app/api/webhooks/github/handlers.ts`（scan dispatch、baseline）、`services/task-pr-link.service.ts`、`services/task-state.service.ts`（policy check）                                                                                                                                                                                |
| `crossingDetector` / `crossingExplainer` / `policyRuleSource` | `services/boundary-detector.service.ts`（10 条边）、`services/boundary-crossing.service.ts`、`services/boundary-crossing-rejudge.service.ts`、`services/memory/write-gate.ts`                                                                                                                                                         |
| `workspaceSettings`                                           | `app/api/workspaces/me/route.ts`、`api-client/workspaces.ts`、`validation/schemas.ts`、`services/workspace.service.ts`（`SecurityPolicy`）、`services/claim-faithfulness.service.ts`（读 AI review 开关，改为读通用的「AI 功能开关」或经设置贡献者）                                                                                  |
| `retention`                                                   | `services/retention-stock.service.ts`                                                                                                                                                                                                                                                                                                 |
| UI 插槽                                                       | `TaskDossier.tsx`、`PullRequestsSection.tsx`、`pr-helpers.tsx`、`WorkspaceSettingsPage.tsx`、`DataRetentionSection.tsx`、`BoundaryCrossingsPanel.tsx`                                                                                                                                                                                 |
| 桶文件                                                        | `repositories/index.ts` 去掉 `prSecurityScanRepository` 的再导出                                                                                                                                                                                                                                                                      |

## 4. 数据：Prisma

**现状**：安全专属 model 6 个——`PrSecurityScan`、`PrSecurityFinding`（扫描），`BoundaryCrossing`、`BoundaryCrossingExplanation`、`CrossingSuppressionRule`（越界），`ProjectPolicy`（策略规则）；专属 enum 14 个（`PrSecurity*` 11 个、`BoundaryCrossing*` 3 个）。核心 model 上还有安全字段：`Workspace.{securityScanEnabled, securityAiReviewEnabled, securityHuntEnabled, securityPolicy, scanEvidenceRetentionDays, boundaryGateEnabled, crossingRawRetentionDays, crossingRawRetentionSince}`、`ProjectRepository.{lastSarifIngestAt, securityBaseline}`，以及 `Task` / `PullRequest` / `Project` / `Milestone` 上的反向关系。275 个迁移里有 29 个涉及这些表或字段。按 §2 的边界，越界三张表留核心；插件拥有 `PrSecurityScan`、`PrSecurityFinding`、`ProjectPolicy` 和上面的扫描类字段。

|                    | 方案 A：表留核心 schema，核心不用                                                                                                                                          | 方案 B：插件独立 schema + 独立迁移                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 做法               | 保持一份 `schema.prisma` 与一条迁移历史；插件表只被插件 repository 访问。可选：用 Prisma 7 的多文件 schema 把插件 model 放进 `prisma/schema/security.prisma`，只是组织方式 | 插件 model 放 Postgres 另一个 schema（`@@schema("security")`），插件有自己的 Prisma client 和迁移目录                                     |
| 与「迁移永不删除」 | 一致：已有 29 个迁移原样保留                                                                                                                                               | 冲突：这些表已经由核心历史创建，插件历史只能「从现有表 baseline」，核心历史里的建表语句仍在                                               |
| 外键               | 照旧（`Task`、`PullRequest`、`Project` 的级联删除继续生效，workspace 删除不用改）                                                                                          | 跨 schema 外键需要插件 schema 里也声明核心 model，或者放弃外键改用应用层清理，workspace 删除 / 导出要补插件钩子                           |
| 生产迁移           | 照旧由部署网关 `migrate deploy` 自动应用                                                                                                                                   | 需要第二条 `migrate deploy`（网关脚本 `scripts/deploy/vercel-build.sh` 要改），两张 `_prisma_migrations` 的并存方式需先验证，自托管多一步 |
| 自托管用户         | 库里有几张空表和几个用不到的列；表结构公开，但不含检测逻辑                                                                                                                 | 库里没有这些表                                                                                                                            |
| 成本               | 加一条守卫测试（核心文件不得出现 `prisma.prSecurityScan` 等访问）；约 0.5 人日                                                                                             | 估 5–8 人日，且有未验证风险                                                                                                               |

**推荐方案 A。** 表结构不是要保护的东西（LUM-1036 已不依赖保密），而方案 B 唯一的好处是自托管库里少几张空表。核心 schema 里保留 `Workspace` 上的扫描开关列，但核心代码不读写它们（经 `workspaceSettings` 贡献者访问），以后若要清理，按「新增迁移 + 保留旧迁移」的正常流程删列即可。

## 5. 许可与分发

### 5.1 插件许可三选项

|                      | 闭源，只给 SaaS 用                                                        | ELv2 source-available                                                                                                                        | 商业许可（专有，可售卖自托管）                                                       |
| -------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 分发                 | 只在私有主仓，SaaS 构建时带上                                             | 公开（同一公开仓库的 `ee/` 目录，或单独公开仓库）                                                                                            | 私有 npm registry / 私有仓库授权访问（TipTap Pro 的做法）                            |
| 自托管用户能拿到什么 | 只有 MIT 核心                                                             | 核心 + 插件源码，可免费自用，不能做托管服务                                                                                                  | 付费后拿到插件                                                                       |
| 优点                 | 实现最简单：不需要 license key、私有 registry、包化；发布不被分发问题阻塞 | 客户可审计安全逻辑（对安全产品是卖点）；与 LUM-1036「不依赖保密」一致；外部可报问题                                                          | 与「TipTap 式」最贴近；自托管企业可成为收入来源                                      |
| 缺点                 | 自托管用户没有 PR 扫描 / 高级检测；不透明                                 | 公开仓库混合两种许可证，贡献者和使用者容易混淆，manifest 与 LICENSE 范围说明更复杂；ELv2 不是 OSI 许可；自托管拿到免费完整能力，付费理由变弱 | 需要包化（受 §3.1 workflow 发现规则限制）、license key、发版与支持流程；首发前做不完 |

**建议**：许可文本从第一天起就写成**专有商业许可**（插件目录放一份 `LICENSE`，版权 Lumo AI，未授权不得使用），**首期只在 SaaS 部署**。这样首发不被分发机制阻塞；以后决定对自托管售卖时不需要重新许可，只需要补包化与授权（PR 9）。如果用户更看重可审计性和社区信任，次选 ELv2 公开插件源码。

### 5.2 MIT 下还要不要 CLA

LUM-1035 的 Decisions 写着「公开仓库接受外部贡献前必须先配好 CLA」，前提是 ELv2：当时需要 CLA 保证外部代码能用于 SaaS 并能随许可证调整继续使用。改成 MIT 后：

- 贡献以 MIT 进来，任何人（包括 Lumo AI）都可以把它用于 SaaS、并入专有插件、在以后的版本里换许可证（保留原 MIT 声明即可）。CLA 的主要理由不复存在。
- 剩下的需求是**来源证明**（贡献者有权提交这段代码），DCO（`Signed-off-by`）足够，门槛也比 CLA 低，社区接受度更高。
- MIT 没有明示专利授权。如果担心贡献者的专利主张，可以在贡献指南里要求贡献同时以 Apache-2.0 授权（inbound = Apache-2.0，outbound = MIT），或者保留轻量 CLA。这是可选项。

**建议**：用 DCO 取代 CLA（需要用户推翻 LUM-1035 的 CLA 前置条件，见 Q6）。插件不接受外部贡献，不涉及。

## 6. 首次发布

### 6.1 首发前必须做到

1. **安全模块不出现在快照里**：§2 判为插件或私有的 173 个文件全部被 manifest 排除，且 `oss:export` 的 import 检查为 0（核心不 import 它们）。
2. **快照自身能构建、能跑测试**：在导出的快照里 `npx tsc --noEmit --incremental false` 和 `npx jest` 通过（现在的 `oss:export` 只做静态检查，不编译快照，需要补一个验证步骤）。
3. **核心安全基线不变弱**：脱敏、注入防护、越界记录与裁定、基线检测器的测试全部留在核心并在快照里运行（现在有 118 个测试文件只依赖核心侧安全模块，另有 68 个「混合」测试要拆，其中包括 `scan-secrets.test.ts`、`long-line-secret-lum1036.test.ts`、`inject-redact-points.test.ts` 等基线回归，它们是因为经 `lib/security-scan/index.ts` 桶或 `types.ts` 才被算成依赖插件）。
4. **许可证切换完成**：见 §8。

### 6.2 推荐路径：真拆（PR 1–7，约 12–17 人日）

见 §7。做完以后私有主仓与 OSS 快照的差别只剩「被排除的插件树 + 一个 overlay 文件 + cron 过滤」，以后每次发布都是同一个动作。

### 6.3 过渡方案：manifest 排除 + stub（约 5–7 人日）

做法：不改核心代码的依赖方向，直接在 `oss/manifest.json` 里排除插件文件，再用 `oss/overlay/` 在被排除的路径上放 stub（无插件时的空实现），让核心照常 import。

评估（基于 `scripts/oss-export.ts` / `scripts/oss-export/manifest.ts` 的现有能力）：

| 需要的能力            | 现状                                                                                                                          | 要补的工作                                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 按 glob 排除插件文件  | 已有（`exclude`，默认拒绝）                                                                                                   | 约 20 条 glob                                                                                                                                            |
| 被排除路径上放 stub   | overlay 能写文件，但 import 检查（第 3 步）在 overlay（第 4 步）**之前**、只看 `cls.excluded`，核心 import 被排除路径一律报错 | 改工具：overlay 提供的路径视为存在；约 0.5 人日                                                                                                          |
| stub 的数量           | —                                                                                                                             | 被核心 import 的插件文件 37 个，每个 stub 要导出核心用到的同名符号与类型；`boundary-detector.service.ts` 依赖的高级检测器 stub 返回空数组即可。约 2 人日 |
| stub 与真实模块不漂移 | 无                                                                                                                            | 私有仓加类型断言测试（stub 的导出可赋值给真实模块的导出类型）；约 0.5 人日                                                                               |
| 测试                  | 依赖插件的 238 个测试文件要排除；其中 68 个混合测试含基线回归                                                                 | 要么排除（快照里丢掉这部分基线回归），要么拆分（= PR 5 的工作量）；排除约 0.5 人日                                                                       |
| cron                  | `jsonDelete` 不能删数组元素，`vercel.json` / crontab 里的插件 cron 会在快照里留下（指向 404）                                 | 新 transform 或 overlay 两个文件；约 0.5 人日                                                                                                            |
| 快照可构建            | 无                                                                                                                            | 同 6.1 第 2 条；约 1 人日                                                                                                                                |

代价：

- **公开代码与实际运行的代码分叉**：快照里的 37 个 stub 在私有仓根本不存在，外部 PR 一旦改到它们，无法回流；我们也从不在生产跑「核心 + stub」这个组合，自托管用户跑的是没人测过的代码路径。
- **基线回归测试被排除或要拆**：排除会削弱快照里可见的安全基线验证，与 Watch out 第一条相冲突；拆则工作量与真拆的 PR 5 相同。
- **之后仍要真拆**：stub 是一次性工作，PR 2–4 一样要做，总成本更高。

**结论**：可行，但只在发布日期是硬约束时才用；即便用，也建议至少做 PR 1（纯函数 / 类型 / 常量移核心），这样 stub 只剩接口层的约 25 个。

## 7. PR 序列与估算

每个 PR 都能单独合并、单独回滚，前一个不合并后一个也不会坏主线。

| PR                | 范围                                                                                                                                                                                                                                                      | 依赖             | 估算           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | -------------- |
| 0                 | 本 RFC                                                                                                                                                                                                                                                    | —                | —              |
| 1                 | 纯函数 / 类型 / 常量移核心：密钥类型拆出 `security-scan/types.ts`；`diff-lines` → `lib/diff/`；`addedControlCallIds` → 核心；证据保留常量 → `lib/retention/`；`PolicyRule` 等类型 → 核心；核心侧不再经 `lib/security-scan/index.ts` 桶 import。行为零变化 | —                | 1 人日         |
| 2                 | `lib/plugins/` 注册表骨架 + `installed.ts` + 服务端扩展点 `doneGate` / `agentContext` / 事件 / `retention`，把 scan 侧 14 个核心文件的依赖改成注册；安全插件的服务端入口 `ee/security/server.ts` 注册现有实现                                             | 1                | 3 人日         |
| 3                 | UI 插槽与设置分区：6 个组件改用 `<PluginSlot>`；`/api/workspaces/me`、`api-client/workspaces`、`validation/schemas`、`workspace.service` 改用 `workspaceSettings`；CLI 对 404 的降级文案（MIT CLI，同 PR bump 版本并同步 SKILL.md / grammar）             | 2                | 2–3 人日       |
| 4                 | 越界检测器注册表：拆 `boundary-detector.service.ts`（管线 + 基线检测器留核心，高级检测器 / 动作 LLM 确认 / 策略规则注册进来）；`crossingExplainer`、`policyRuleSource`（write-gate、复判、IN_REVIEW policy check 事件）                                   | 2                | 3–4 人日       |
| 5                 | 测试拆分：68 个混合测试拆成核心 / 插件两半，基线回归只依赖核心；加守卫测试：核心文件不得 import 插件路径、不得访问插件表                                                                                                                                  | 1–4              | 2–3 人日       |
| 6                 | 物理归位与快照：插件文件移入 `ee/security/`（route / workflow 留原路径则只排除）；manifest 排除 + overlay `installed.ts` + cron 过滤 transform；`oss:export` 后在快照里跑 `tsc` 与 `jest` 的验证脚本；`crossing-eval` 排除                                | 5                | 1–2 人日       |
| 7                 | 许可证切换（§8 全部条目）                                                                                                                                                                                                                                 | 用户裁定         | 0.5 人日       |
| —                 | **首发最小路径合计（PR 1–7）**                                                                                                                                                                                                                            |                  | **12–17 人日** |
| 8（发布后，可选） | Prisma 多文件 schema 把插件 model 挪进 `security.prisma`；S-b：stage A 改扫描层注册表，把 SARIF 导入 / 确定性密钥扫描提为核心能力                                                                                                                         | 6                | 0.5 + 4–6 人日 |
| 9（按需）         | 插件包化，供商业自托管：构建期把插件的 route / workflow 拷进项目树、license key、私有 registry                                                                                                                                                            | 用户决定卖自托管 | 5–10 人日      |

## 8. 许可证切换的连带改动

| 位置                                                                                 | 现状（@e6f0a1d08）                                                                                                                                                                                                         | 要改成                                                                                       |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `LICENSE`                                                                            | ELv2 全文 + 「cli/、shared/、.claude/skills/lumo 用 MIT」的范围说明                                                                                                                                                        | MIT 全文，版权 Lumo AI；范围说明改为「插件目录不在本仓库 / 不适用」。**本任务不改，PR 7 做** |
| `package.json` 的 `license`、`package-lock.json` 根包                                | `Elastic-2.0`                                                                                                                                                                                                              | `MIT`                                                                                        |
| `README.md` License 段（约 508–523 行）                                              | 「source-available under the Elastic License 2.0 … not an open-source license in the OSI sense」及 ELv2 的三条限制                                                                                                         | 改为 MIT 开源措辞；说明安全能力是 Lumo Cloud 的插件、不在本仓库                              |
| `__tests__/project/license-files.test.ts`、`__tests__/scripts/license-audit.test.ts` | 断言 `Elastic-2.0`                                                                                                                                                                                                         | 断言 `MIT`                                                                                   |
| `oss/manifest.json` 的 reason                                                        | `lib/**` 写着「D2: security scan / crossing detection ship with the core」；`security/**` 写着「D2: security scanning ships with the core」；`LICENSE` 写着「Elastic-2.0 license text …」；`docs/rfc/**` 写着 2/5 的旧理由 | 引用 2026-10-10 MIT 裁定与本 RFC；`security/**` 从 include 改为 exclude；新增插件排除规则    |
| `docs/open-source/dependency-licenses.md` 第 72 行                                   | 「主应用 `Elastic-2.0`，source-available」                                                                                                                                                                                 | 改为 MIT                                                                                     |
| LUM-1035 的 CLA 前置条件、`CONTRIBUTING`（待写）                                     | 要求 CLA                                                                                                                                                                                                                   | 若采纳 §5.2，改为 DCO                                                                        |
| `oss/overlay/CLAUDE.md`                                                              | 对外版贡献者说明                                                                                                                                                                                                           | PR 6 时核对是否提到被排除的安全模块                                                          |

**LUM-1016 依赖许可证审计要不要重看**：结论不变，只改措辞。理由：

- 审计的阻断规则是「生产闭包里不能有 GPL / AGPL / SSPL 等强 copyleft 或未审阅的非 OSI 许可证」，这条规则对 MIT 出站同样是正确的门槛；当前结果是 0 阻断。
- 已接受的例外在 MIT 下都不构成冲突：`@img/sharp-libvips-*` 的 LGPL-3.0-or-later 是 sharp 动态加载的预编译库，源码快照不分发它（只有 lockfile），将来发布 Docker 镜像时的 LGPL 告知义务与 Lumo 自己用什么许可证无关；`dompurify` 双许可选 Apache-2.0；`caniuse-lite` 的 CC-BY-4.0 是构建期数据。
- 审计脚本本来就不审 Lumo 自身（根包与 workspace 只作遍历起点），换许可证只需改上表两条测试的断言和文档措辞。
- 插件侧在 sandbox 里运行时安装的扫描器（semgrep、gitleaks、trivy、zizmor、osv-scanner）不随 Lumo 分发，不影响核心；如果以后走 PR 9 把插件卖给自托管，需要单独对插件做一次同样的审计。

## 9. 需要用户裁定的问题

- **Q1 边界总体**：是否接受 §2.1 的去向（核心 53 / 插件 161 / 私有 12），特别是「越界复判留核心」这一处对初步倾向的修正？
- **Q2 项目策略规则**：`PROJECT_RULE_VIOLATION` / `POLICY_WEAKENING`（CLAUDE.md 规则的 LLM 编译与判定）放插件（本文建议，因为依赖 LLM、核心 fan-in 只有 2），还是作为「agent 遵守项目规则」的产品核心能力留在 MIT？
- **Q3 PR 扫描切法**：首发用 S-a（整体进插件），还是要求 S-b（SARIF 导入 + 确定性密钥扫描留核心，多 4–6 人日）？
- **Q4 Prisma**：采用方案 A？
- **Q5 插件许可**：专有商业许可 + 首期只给 SaaS（建议），还是 ELv2 公开，或首发就做商业自托管？
- **Q6 CLA → DCO**：是否推翻 LUM-1035「接受外部贡献前必须先配 CLA」的前置条件，改用 DCO？
- **Q7 首发路径**：走真拆（PR 1–7，约 12–17 人日），还是在日期压力下用过渡方案（约 5–7 人日，§6.3 的代价）？
- **Q8 插件目录名与位置**：`ee/security/`，还是保持原路径只靠 manifest 排除（少一次大规模搬迁，但边界靠 glob 维护）？

## 附录 A：可复现的统计命令

在 commit e6f0a1d08 的工作区根目录（或任意 worktree）执行。脚本只读 `git ls-files` 列出的已跟踪文件，不依赖 `node_modules`，不写任何文件。把下面的脚本保存为仓库外的 `inventory.mjs`（不提交进仓库）后：

```bash
git rev-parse --short=9 HEAD                       # 应为 e6f0a1d08
node /path/to/inventory.mjs                        # 汇总：总量、模块表、去向合计、反向依赖与测试统计
node /path/to/inventory.mjs --files                # 逐模块文件清单 + 核心 importer + 误报与排他依赖检查
node /path/to/inventory.mjs --inversion            # 53 条「核心生产文件 → 插件文件」import 边
node /path/to/inventory.mjs --mixed                # 68 个同时依赖核心侧与插件侧的测试
node /path/to/inventory.mjs --json > inv.json      # 机器可读
# 迁移里涉及安全表 / 字段的数量（29）
grep -lE 'PrSecurity|BoundaryCrossing|CrossingSuppressionRule|ProjectPolicy|securityScan|securityAiReview|securityHunt|scanEvidenceRetention|crossingRawRetention|securityBaseline|lastSarifIngestAt|boundaryGateEnabled|securityPolicy' prisma/migrations/*/migration.sql | wc -l
# Vercel Workflows 不扫 node_modules 的出处
grep -n "node_modules" node_modules/@workflow/builders/dist/base-builder.js | head -1
```

@e6f0a1d08 上 `node inventory.mjs` 的输出：

```text
HEAD e6f0a1d08
app+components+lib code files: 1860, lines: 250590
security files in app+components+lib: 220, lines: 51364
security files total (incl. shared/src, security/): 226, lines: 54060
distinct non-security prod importers (core fan-in): 68

| module | dest | files | lines | core prod fan-in | test importers | imported by modules |
|---|---|---|---|---|---|---|
| crossing-eval | private | 12 | 2805 | 0 | 9 |  |
| redaction | core | 8 | 2376 | 10 | 22 | crossing-ai, crossing-core, crossing-eval, inject-guard, scan-ai-review, scan-core, scan-sarif |
| code-redaction | core | 6 | 1178 | 8 | 20 | crossing-core, redaction |
| inject-guard | core | 3 | 1447 | 16 | 15 | crossing-ai, scan-core, scan-hunt |
| shared-scan-format | core | 2 | 690 | 0 | 21 | scan-core, scan-hunt |
| crossing-ai | plugin | 8 | 802 | 0 | 8 | crossing-core |
| policy-rules | plugin | 13 | 1541 | 2 | 17 | crossing-detectors, crossing-detectors-adv, crossing-eval, crossing-rejudge |
| crossing-detectors-adv | plugin | 5 | 1621 | 0 | 10 | crossing-detectors, crossing-eval, policy-rules |
| crossing-detectors | core | 4 | 2403 | 6 | 36 | crossing-detectors-adv, crossing-eval, crossing-rejudge, policy-rules, scan-hunt |
| crossing-rejudge | core | 5 | 855 | 1 | 11 | policy-rules |
| crossing-core | core | 25 | 7177 | 20 | 105 | crossing-ai, crossing-detectors, crossing-rejudge, policy-rules, scan-core, scan-hunt |
| scan-hunt | plugin | 39 | 12055 | 1 | 78 | scan-ai-review, scan-core, scan-managed |
| scan-managed | plugin | 17 | 3572 | 1 | 55 | scan-core, scan-hunt, scan-sarif |
| scan-sarif | plugin | 13 | 2412 | 0 | 26 | scan-core, scan-managed |
| scan-ai-review | plugin | 23 | 2759 | 0 | 41 | scan-core, scan-retention |
| scan-retention | plugin | 6 | 629 | 4 | 18 | scan-ai-review, scan-core, scan-hunt, scan-sarif |
| scan-core | plugin | 37 | 9738 | 20 | 122 | crossing-ai, crossing-detectors, policy-rules, redaction, scan-ai-review, scan-hunt, scan-managed, scan-retention, scan-sarif |
dest core: 53 files, 16126 lines
dest plugin: 161 files, 35129 lines
dest private: 12 files, 2805 lines
core->plugin inversion: 53 import edges, from 31 core prod files, into 37 plugin files
test files importing plugin/private files: 238 (of which 170 import no core security module)
  plugin-only tests: 170 files / 44063 lines; mixed tests: 68 files / 24778 lines
  tests importing only core-side security modules: 118
```

脚本全文：

```js
// LUM-1058 plugin-boundary inventory. Run from the repo root:
//   node inventory.mjs [--json] [--files] [--inversion] [--mixed]
//   --files: per-module file list + core importers + name false positives
//   --inversion: every core prod file -> plugin/private file import edge
//   --mixed: tests importing both core-side and plugin-side modules
// Reads `git ls-files` at HEAD (working tree content of tracked files), the
// same import-specifier rules as scripts/oss-export/manifest.ts, and the
// MODULES table below. Prints per-module files / lines / fan-in.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { posix } from 'node:path'

const sh = (c, a) =>
  execFileSync(c, a, { encoding: 'utf8', maxBuffer: 1 << 28 })
const head = sh('git', ['rev-parse', '--short=9', 'HEAD']).trim()
const tracked = sh('git', ['ls-files', '-z']).split('\0').filter(Boolean)
const files = new Set(tracked)

// --- module table: first match wins -------------------------------------
// [module id, regex over the repo path]
const R = s => new RegExp(s)
const MODULES = [
  // [id, destination, path regex] — destination: core | plugin | private
  [
    'crossing-eval',
    'private',
    R(
      '^lib/boundary-crossing/(eval/|align-eval|false-positive-rate)|^lib/llm/offline-eval-client'
    ),
  ],
  [
    'redaction',
    'core',
    R(
      '^lib/security-scan/(redact|scan-secrets|secret-patterns|storage-redaction|secret-stock/)|^lib/services/secret-stock-reredact|^lib/repositories/secret-stock'
    ),
  ],
  [
    'code-redaction',
    'core',
    R(
      '^lib/hook-payload/redact\\.ts$|^lib/services/hook-ingest-policy\\.service|^lib/services/pr-comment-code-scrub|^lib/integrations/github/mirror-code-strip|^lib/services/hook-event-code-backfill|^lib/repositories/hook-event-code-backfill'
    ),
  ],
  [
    'inject-guard',
    'core',
    R(
      '^lib/security-scan/inject-guard|^shared/src/untrusted-(content|fence)\\.ts$'
    ),
  ],
  [
    'shared-scan-format',
    'core',
    R('^shared/src/(security-scan|hunt-audit)\\.ts$'),
  ],
  [
    'crossing-ai',
    'plugin',
    R(
      '^lib/boundary-crossing/triage|^lib/services/boundary-crossing-triage|^lib/llm/crossing-explain-client|^lib/ai/evaluation\\.ts$|^app/api/cron/triage-crossings/|^app/api/tasks/\\[id\\]/boundary-crossings/\\[crossingId\\]/system-explain/|CrossingTriageLine'
    ),
  ],
  [
    'policy-rules',
    'plugin',
    R(
      '^lib/services/policy/|^lib/repositories/project-policy|^lib/llm/(policy-compiler|code-rule-judge)-client|^lib/boundary-crossing/(push-target-match|action-rule-match)|^app/api/internal/policy-check/'
    ),
  ],
  [
    'crossing-detectors-adv',
    'plugin',
    R(
      '^lib/boundary-crossing/(destructive-fs|sensitive-read|untrusted-code|action-confirm)|^lib/llm/action-confirm-client'
    ),
  ],
  [
    'crossing-detectors',
    'core',
    R(
      '^lib/boundary-crossing/(command-shape|judge-timeout)|^lib/services/boundary-detector'
    ),
  ],
  [
    'crossing-rejudge',
    'core',
    R(
      '^lib/boundary-crossing/rejudge|^lib/services/boundary-crossing-rejudge|^app/api/cron/rejudge-crossings/'
    ),
  ],
  [
    'crossing-core',
    'core',
    R(
      '^lib/boundary-crossing/|^lib/services/(boundary-crossing|crossing-raw-retention)|^lib/repositories/(boundary-crossing|crossing-|open-crossing-move)|^lib/disposition/|^lib/validation/boundary-crossing|^app/api/tasks/\\[id\\]/boundary-crossings/|BoundaryCrossingsPanel|boundary-(explain|format)\\.ts$|crossing-groups\\.ts$|useBoundaryCrossings|CrossingRawRetentionRow'
    ),
  ],
  [
    'scan-hunt',
    'plugin',
    R(
      '^lib/security-scan/(hunt|graph)/|^lib/services/security-(hunt|graph-rules)|^lib/llm/security-(hunt|falsifier)|^lib/workflows/security-hunt'
    ),
  ],
  [
    'scan-managed',
    'plugin',
    R(
      '^lib/services/security-(managed-scan|baseline)|^lib/workflows/security-(managed-scan|baseline-scan)|^lib/security-scan/semgrep-rules|^security/|^lib/services/sandbox-credential-scrub|^lib/integrations/vercel-sandbox/'
    ),
  ],
  [
    'scan-sarif',
    'plugin',
    R(
      '^lib/security-scan/sarif\\.ts$|^lib/services/security-sarif|^lib/validation/security-sarif|^lib/auth/(sarif-ingest-auth|github-oidc)|^lib/workflows/security-sarif|^app/api/integrations/security/sarif/|^app/api/cron/prune-security-sarif/'
    ),
  ],
  [
    'scan-ai-review',
    'plugin',
    R(
      '^lib/security-scan/(review-kinds|review-context|related-context|truncate|judge-budget|pr-summary|verifier|diff-snippet|suggestion)\\.ts$|^lib/services/(review-verifier|review-context|security-suggest)|^lib/llm/(security-judge|review-verifier|review-ranker|security-disposition-falsifier)-client|^lib/workflows/(review-verifier|security-suggest)'
    ),
  ],
  [
    'scan-retention',
    'plugin',
    R(
      '^lib/security-scan/evidence-retention|^lib/services/(scan-evidence-retention|scan-code-retention)|^app/api/cron/sweep-(expired-scan-evidence|unconfirmed-scan-code)/|ScanEvidenceRetentionRow'
    ),
  ],
  [
    'scan-core',
    'plugin',
    R(
      '^lib/security-scan/|^lib/services/(pr-security-|pr-scan-readout|security-(pr-review|scan-|workspace-switches))|^lib/repositories/pr-security-scan|^lib/validation/security-scan|^lib/workflows/security-(pr-review|scan-helpers)|^app/api/tasks/\\[id\\]/security-(findings|scans)/|^app/api/pull-requests/\\[number\\]/scans/|^app/api/workspaces/me/security-scan/|^app/api/internal/pr-security-scan/|^app/api/cron/sweep-security-scans/|SecurityScanSection|security-(agent-context|summary-line|summary)\\.ts$|useSecurityScans|SecurityScanSwitchesCard'
    ),
  ],
]
// Keyword net for the false-positive check (files whose NAME looks security-ish).
const KEYWORD =
  /secur|scan|crossing|boundar|hunt|semgrep|sarif|redact|secret|inject|triage|verifier|ranker|falsifier|dispos|polic|sandbox|evasion|sensitive|suppress|guard/i
const SCOPE =
  /^(app|components|lib|hooks|types|constants|shared\/src|mcp|extensions|security)\/|^(instrumentation|proxy)\.ts$/
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/

const moduleOf = p => {
  for (const [id, , re] of MODULES) if (re.test(p)) return id
  return null
}
const kind = p =>
  /^(__tests__|tests|test-utils|__stubs__)\//.test(p) || /\.test\.tsx?$/.test(p)
    ? 'test'
    : /^scripts\//.test(p)
      ? 'script'
      : /^cli\//.test(p)
        ? 'cli'
        : 'prod'

// --- import graph (same specifier rules as scripts/oss-export/manifest.ts) --
const PATS = [
  /\bfrom\s+['"]([^'"\n]+)['"]/g,
  /\bimport\s+['"]([^'"\n]+)['"]/g,
  /\b(?:import|require|require\.resolve|jest\.(?:mock|doMock|unmock|requireActual|requireMock))\s*\(\s*['"]([^'"\n]+)['"]/g,
]
const SUF = [
  '',
  '.ts',
  '.tsx',
  '.d.ts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '/index.ts',
  '/index.tsx',
  '/index.js',
]
const resolve = (from, spec) => {
  let base
  if (spec.startsWith('@/')) base = spec.slice(2)
  else if (spec.startsWith('@lumo/shared'))
    base = 'shared/src' + spec.slice('@lumo/shared'.length)
  else if (spec.startsWith('./') || spec.startsWith('../'))
    base = posix.join(posix.dirname(from), spec)
  else return null
  base = posix.normalize(base)
  for (const s of SUF) if (files.has(base + s)) return base + s
  const js = /\.(m|c)?jsx?$/.exec(base)
  if (js)
    for (const e of ['.ts', '.tsx'])
      if (files.has(base.slice(0, -js[0].length) + e))
        return base.slice(0, -js[0].length) + e
  return null
}
const lines = p => {
  try {
    const t = readFileSync(p, 'utf8')
    return t.length === 0
      ? 0
      : t.split('\n').length - (t.endsWith('\n') ? 1 : 0)
  } catch {
    return 0
  }
}
const imports = new Map() // file -> Set(target)
for (const f of tracked) {
  if (!CODE.test(f) || /^(node_modules|\.agents|\.worktrees)\//.test(f))
    continue
  let src
  try {
    src = readFileSync(f, 'utf8')
  } catch {
    continue
  }
  const out = new Set()
  for (const re of PATS) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(src))) {
      const t = resolve(f, m[1])
      if (t) out.add(t)
    }
  }
  imports.set(f, out)
}

// --- classify ------------------------------------------------------------
const sec = new Map() // file -> module
for (const f of tracked)
  if (SCOPE.test(f)) {
    const m = moduleOf(f)
    if (m) sec.set(f, m)
  }
const byModule = new Map()
for (const [f, m] of sec) {
  if (!byModule.has(m)) byModule.set(m, [])
  byModule.get(m).push(f)
}

// fan-in: non-security importers of each module, split by kind
const fanIn = new Map() // module -> {prod:Set, test:Set, script:Set, cli:Set, otherModules:Set}
for (const [from, targets] of imports) {
  const fromMod = sec.get(from)
  for (const t of targets) {
    const m = sec.get(t)
    if (!m || fromMod === m) continue
    if (!fanIn.has(m))
      fanIn.set(m, {
        prod: new Set(),
        test: new Set(),
        script: new Set(),
        cli: new Set(),
        mods: new Set(),
      })
    const e = fanIn.get(m)
    if (fromMod) e.mods.add(fromMod)
    else e[kind(from)].add(from)
  }
}
const order = MODULES.map(([id]) => id)
const DEST = Object.fromEntries(MODULES.map(([id, d]) => [id, d]))
const json = process.argv.includes('--json')
const rows = order
  .filter(m => byModule.has(m))
  .map(m => {
    const fs = byModule.get(m).sort()
    const e = fanIn.get(m) ?? {
      prod: new Set(),
      test: new Set(),
      script: new Set(),
      cli: new Set(),
      mods: new Set(),
    }
    return {
      module: m,
      dest: DEST[m],
      files: fs.length,
      lines: fs.reduce((a, f) => a + lines(f), 0),
      coreProdFanIn: [...e.prod].sort(),
      testFanIn: e.test.size,
      scriptFanIn: e.script.size,
      fromModules: [...e.mods].sort(),
      list: fs.map(f => [f, lines(f)]),
    }
  })
// keyword hits NOT classified = name false positives (manual review)
const fp = tracked.filter(
  f => SCOPE.test(f) && CODE.test(f) && KEYWORD.test(f) && !sec.has(f)
)
// classified files without a keyword (classified by content, not name)
const noKw = [...sec.keys()].filter(f => !KEYWORD.test(f)).sort()
// scope totals
const scopeFiles = tracked.filter(
  f => /^(app|components|lib)\//.test(f) && CODE.test(f)
)
const scopeLines = scopeFiles.reduce((a, f) => a + lines(f), 0)
const secLib = [...sec.keys()].filter(f => /^(app|components|lib)\//.test(f))
const allCoreProd = new Set(rows.flatMap(r => r.coreProdFanIn))

// exclusive dependencies: unclassified prod files whose every prod/cli importer is a security file
const importersOf = new Map()
for (const [from, ts] of imports)
  for (const t of ts) {
    if (!importersOf.has(t)) importersOf.set(t, new Set())
    importersOf.get(t).add(from)
  }
const exclusive = tracked
  .filter(
    f => SCOPE.test(f) && CODE.test(f) && !sec.has(f) && kind(f) === 'prod'
  )
  .filter(f => {
    const imp = [...(importersOf.get(f) ?? [])].filter(
      i => kind(i) === 'prod' || kind(i) === 'cli'
    )
    return imp.length > 0 && imp.every(i => sec.has(i))
  })
  .map(f => [
    f,
    [
      ...new Set(
        [...importersOf.get(f)].filter(i => sec.has(i)).map(i => sec.get(i))
      ),
    ]
      .sort()
      .join(','),
  ])
const destOf = f => (sec.has(f) ? DEST[sec.get(f)] : 'core')
const inv = []
for (const [from, ts] of imports) {
  if (destOf(from) !== 'core' || kind(from) !== 'prod') continue
  for (const t of ts) if (destOf(t) !== 'core') inv.push([from, t])
}
const invTargets = new Set(inv.map(([, t]) => t))
const invFrom = new Set(inv.map(([f]) => f))
const testsTouchingPlugin = [...imports]
  .filter(
    ([f, ts]) => kind(f) === 'test' && [...ts].some(t => destOf(t) !== 'core')
  )
  .map(([f]) => f)
const testsOnlyPlugin = testsTouchingPlugin.filter(
  f => ![...imports.get(f)].some(t => sec.has(t) && destOf(t) === 'core')
)
const sumDest = d =>
  rows
    .filter(r => r.dest === d)
    .reduce((a, r) => [a[0] + r.files, a[1] + r.lines], [0, 0])
if (json) {
  console.log(JSON.stringify({ head, rows, fp, noKw }, null, 2))
  process.exit(0)
}
console.log(`HEAD ${head}`)
console.log(
  `app+components+lib code files: ${scopeFiles.length}, lines: ${scopeLines}`
)
console.log(
  `security files in app+components+lib: ${secLib.length}, lines: ${secLib.reduce((a, f) => a + lines(f), 0)}`
)
console.log(
  `security files total (incl. shared/src, security/): ${sec.size}, lines: ${[...sec.keys()].reduce((a, f) => a + lines(f), 0)}`
)
console.log(
  `distinct non-security prod importers (core fan-in): ${allCoreProd.size}`
)
console.log(
  '\n| module | dest | files | lines | core prod fan-in | test importers | imported by modules |'
)
console.log('|---|---|---|---|---|---|---|')
for (const r of rows)
  console.log(
    `| ${r.module} | ${r.dest} | ${r.files} | ${r.lines} | ${r.coreProdFanIn.length} | ${r.testFanIn} | ${r.fromModules.join(', ')} |`
  )
for (const d of ['core', 'plugin', 'private']) {
  const [n, l] = sumDest(d)
  console.log(`dest ${d}: ${n} files, ${l} lines`)
}
console.log(
  `core->plugin inversion: ${inv.length} import edges, from ${invFrom.size} core prod files, into ${invTargets.size} plugin files`
)
console.log(
  `test files importing plugin/private files: ${testsTouchingPlugin.length} (of which ${testsOnlyPlugin.length} import no core security module)`
)
const tl = xs => xs.reduce((a, f) => a + lines(f), 0)
const mixed = testsTouchingPlugin.filter(f => !testsOnlyPlugin.includes(f))
console.log(
  `  plugin-only tests: ${testsOnlyPlugin.length} files / ${tl(testsOnlyPlugin)} lines; mixed tests: ${mixed.length} files / ${tl(mixed)} lines`
)
const coreSecTests = [...imports]
  .filter(
    ([f, ts]) =>
      kind(f) === 'test' &&
      [...ts].some(t => sec.has(t) && destOf(t) === 'core') &&
      ![...ts].some(t => destOf(t) !== 'core')
  )
  .map(([f]) => f)
console.log(
  `  tests importing only core-side security modules: ${coreSecTests.length}`
)
if (process.argv.includes('--mixed'))
  for (const f of mixed.sort())
    console.log(
      `  mixed: ${f} -> ${[...imports.get(f)]
        .filter(t => destOf(t) !== 'core')
        .map(t => sec.get(t))
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(',')}`
    )
if (process.argv.includes('--inversion'))
  for (const [f, t] of inv.sort()) console.log(`  ${f} -> ${t} [${sec.get(t)}]`)
if (process.argv.includes('--files')) {
  for (const r of rows) {
    console.log(`\n## ${r.module}`)
    for (const [f, n] of r.list) console.log(`  ${n}\t${f}`)
    console.log(`  (${r.dest})`)
    console.log('  core prod importers:')
    for (const f of r.coreProdFanIn) console.log(`    <- ${f}`)
  }
  console.log('\n## keyword hits NOT classified (review as false positives)')
  for (const f of fp) console.log(`  ${f}`)
  console.log(
    '\n## unclassified prod files imported ONLY by security files (exclusive deps)'
  )
  for (const [f, m] of exclusive) console.log(`  ${lines(f)}\t${f}\t<- ${m}`)
  console.log('\n## classified without keyword in name')
  for (const f of noKw) console.log(`  ${f}`)
}
```

## 附录 B：逐文件清单

去向与理由见 §2.1 模块总表；这里只对需要拆开或有特殊情况的文件写备注。由附录 A 的 `--json` 输出生成。

#### crossing-eval（私有（评测），12 个文件 / 2805 行）

| 文件                                           | 行数 | 备注 |
| ---------------------------------------------- | ---: | ---- |
| `lib/boundary-crossing/align-eval-corpus.ts`   |  933 |      |
| `lib/boundary-crossing/align-eval.ts`          |  474 |      |
| `lib/boundary-crossing/eval/datasets/gold.ts`  |   87 |      |
| `lib/boundary-crossing/eval/recorded-judge.ts` |  200 |      |
| `lib/boundary-crossing/eval/report.ts`         |  129 |      |
| `lib/boundary-crossing/eval/rule-judge.ts`     |  113 |      |
| `lib/boundary-crossing/eval/run.ts`            |  148 |      |
| `lib/boundary-crossing/eval/score.ts`          |  245 |      |
| `lib/boundary-crossing/eval/stats.ts`          |   60 |      |
| `lib/boundary-crossing/eval/types.ts`          |  159 |      |
| `lib/boundary-crossing/false-positive-rate.ts` |  191 |      |
| `lib/llm/offline-eval-client.ts`               |   66 |      |

#### redaction（核心，8 个文件 / 2376 行）

| 文件                                            | 行数 | 备注 |
| ----------------------------------------------- | ---: | ---- |
| `lib/repositories/secret-stock.repository.ts`   |  130 |      |
| `lib/security-scan/redact.ts`                   |  451 |      |
| `lib/security-scan/scan-secrets.ts`             |  650 |      |
| `lib/security-scan/secret-patterns.ts`          |  618 |      |
| `lib/security-scan/secret-stock/classify.ts`    |   98 |      |
| `lib/security-scan/secret-stock/tables.ts`      |  134 |      |
| `lib/security-scan/storage-redaction.ts`        |   77 |      |
| `lib/services/secret-stock-reredact.service.ts` |  218 |      |

#### code-redaction（核心，6 个文件 / 1178 行）

| 文件                                                      | 行数 | 备注 |
| --------------------------------------------------------- | ---: | ---- |
| `lib/hook-payload/redact.ts`                              |  452 |      |
| `lib/integrations/github/mirror-code-strip.ts`            |  103 |      |
| `lib/repositories/hook-event-code-backfill.repository.ts` |  128 |      |
| `lib/services/hook-event-code-backfill.service.ts`        |  307 |      |
| `lib/services/hook-ingest-policy.service.ts`              |   37 |      |
| `lib/services/pr-comment-code-scrub.service.ts`           |  151 |      |

#### inject-guard（核心，3 个文件 / 1447 行）

| 文件                                | 行数 | 备注               |
| ----------------------------------- | ---: | ------------------ |
| `lib/security-scan/inject-guard.ts` |  204 |                    |
| `shared/src/untrusted-content.ts`   | 1115 | 已是 MIT（shared） |
| `shared/src/untrusted-fence.ts`     |  128 | 已是 MIT（shared） |

#### shared-scan-format（核心，2 个文件 / 690 行）

| 文件                          | 行数 | 备注                                                    |
| ----------------------------- | ---: | ------------------------------------------------------- |
| `shared/src/hunt-audit.ts`    |  165 | 已随 @lumoai/cli 以 MIT 发到 npm；纯展示，留 shared     |
| `shared/src/security-scan.ts` |  525 | 已随 @lumoai/cli 以 MIT 发到 npm；纯展示常量，留 shared |

#### crossing-ai（插件，8 个文件 / 802 行）

| 文件                                                                                | 行数 | 备注                                  |
| ----------------------------------------------------------------------------------- | ---: | ------------------------------------- |
| `app/api/cron/triage-crossings/route.ts`                                            |   21 |                                       |
| `app/api/tasks/[id]/boundary-crossings/[crossingId]/system-explain/route.ts`        |   59 |                                       |
| `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/CrossingTriageLine.tsx` |   66 | 经 UI 插槽挂载                        |
| `lib/ai/evaluation.ts`                                                              |  131 | 只有 AI 分诊用（非 ZDR 评测模型端点） |
| `lib/boundary-crossing/triage-threshold.ts`                                         |    6 |                                       |
| `lib/boundary-crossing/triage.ts`                                                   |  193 |                                       |
| `lib/llm/crossing-explain-client.ts`                                                |   85 |                                       |
| `lib/services/boundary-crossing-triage.service.ts`                                  |  241 |                                       |

#### policy-rules（插件，13 个文件 / 1541 行）

| 文件                                             | 行数 | 备注 |
| ------------------------------------------------ | ---: | ---- |
| `app/api/internal/policy-check/route.ts`         |   51 |      |
| `lib/boundary-crossing/action-rule-match.ts`     |   36 |      |
| `lib/boundary-crossing/push-target-match.ts`     |  142 |      |
| `lib/llm/code-rule-judge-client.ts`              |   91 |      |
| `lib/llm/policy-compiler-client.ts`              |   84 |      |
| `lib/repositories/project-policy.repository.ts`  |  149 |      |
| `lib/services/policy/code-pipeline.service.ts`   |  207 |      |
| `lib/services/policy/policy-check-dispatch.ts`   |   98 |      |
| `lib/services/policy/policy-compiler.service.ts` |  436 |      |
| `lib/services/policy/predicate-eval.ts`          |   57 |      |
| `lib/services/policy/push-rule.ts`               |  105 |      |
| `lib/services/policy/rule-polarity.ts`           |   32 |      |
| `lib/services/policy/types.ts`                   |   53 |      |

#### crossing-detectors-adv（插件，5 个文件 / 1621 行）

| 文件                                      | 行数 | 备注 |
| ----------------------------------------- | ---: | ---- |
| `lib/boundary-crossing/action-confirm.ts` |  223 |      |
| `lib/boundary-crossing/destructive-fs.ts` |  150 |      |
| `lib/boundary-crossing/sensitive-read.ts` |  551 |      |
| `lib/boundary-crossing/untrusted-code.ts` |  620 |      |
| `lib/llm/action-confirm-client.ts`        |   77 |      |

#### crossing-detectors（核心，4 个文件 / 2403 行）

| 文件                                               | 行数 | 备注                                                              |
| -------------------------------------------------- | ---: | ----------------------------------------------------------------- |
| `lib/boundary-crossing/command-shape.ts`           |  465 |                                                                   |
| `lib/boundary-crossing/judge-timeout.ts`           |   32 |                                                                   |
| `lib/services/boundary-detector-replay.service.ts` |   79 |                                                                   |
| `lib/services/boundary-detector.service.ts`        | 1827 | 拆开：管线+基线检测器留核心，高级检测器/策略规则/LLM 确认改为注册 |

#### crossing-rejudge（核心，5 个文件 / 855 行）

| 文件                                                | 行数 | 备注                                          |
| --------------------------------------------------- | ---: | --------------------------------------------- |
| `app/api/cron/rejudge-crossings/route.ts`           |   30 |                                               |
| `lib/boundary-crossing/rejudge-cause.ts`            |  278 |                                               |
| `lib/boundary-crossing/rejudge.ts`                  |  176 | 留核心；依赖 policy/types 的类型移到核心      |
| `lib/services/boundary-crossing-rejudge-trigger.ts` |   31 |                                               |
| `lib/services/boundary-crossing-rejudge.service.ts` |  340 | 留核心；POLICY_WEAKENING 分支经策略规则提供者 |

#### crossing-core（核心，25 个文件 / 7177 行）

| 文件                                                                                    | 行数 | 备注                                                             |
| --------------------------------------------------------------------------------------- | ---: | ---------------------------------------------------------------- |
| `app/api/tasks/[id]/boundary-crossings/[crossingId]/disposition/receipt/route.ts`       |   82 |                                                                  |
| `app/api/tasks/[id]/boundary-crossings/[crossingId]/disposition/route.ts`               |  105 |                                                                  |
| `app/api/tasks/[id]/boundary-crossings/[crossingId]/explain/route.ts`                   |   71 |                                                                  |
| `app/api/tasks/[id]/boundary-crossings/[crossingId]/remediation/route.ts`               |   49 |                                                                  |
| `app/api/tasks/[id]/boundary-crossings/[crossingId]/suppression-preview/route.ts`       |   68 |                                                                  |
| `app/api/tasks/[id]/boundary-crossings/disposition/route.ts`                            |   92 |                                                                  |
| `app/api/tasks/[id]/boundary-crossings/route.ts`                                        |   32 |                                                                  |
| `app/api/tasks/[id]/boundary-crossings/suppression-rules/[ruleId]/route.ts`             |   68 |                                                                  |
| `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/BoundaryCrossingsPanel.tsx` | 1851 |                                                                  |
| `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/boundary-explain.ts`        |   27 |                                                                  |
| `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/boundary-format.ts`         |  227 |                                                                  |
| `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/crossing-groups.ts`         |   90 |                                                                  |
| `app/workspace/[workspaceUrl]/components/settings/CrossingRawRetentionRow.tsx`          |   72 |                                                                  |
| `app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings.ts`                            |  212 |                                                                  |
| `lib/boundary-crossing/evasion.ts`                                                      |   20 |                                                                  |
| `lib/boundary-crossing/raw-retention.ts`                                                |  168 |                                                                  |
| `lib/boundary-crossing/suppression.ts`                                                  |  169 |                                                                  |
| `lib/disposition/read-receipt.ts`                                                       |  307 |                                                                  |
| `lib/repositories/boundary-crossing.repository.ts`                                      |  951 |                                                                  |
| `lib/repositories/crossing-raw-retention.repository.ts`                                 |  196 |                                                                  |
| `lib/repositories/crossing-suppression-rule.repository.ts`                              |  202 |                                                                  |
| `lib/repositories/open-crossing-move.ts`                                                |   63 |                                                                  |
| `lib/services/boundary-crossing.service.ts`                                             | 1845 | 留核心；explainCrossing 的 LLM 调用改为 crossingExplainer 提供者 |
| `lib/services/crossing-raw-retention.service.ts`                                        |  111 |                                                                  |
| `lib/validation/boundary-crossing.ts`                                                   |   99 |                                                                  |

#### scan-hunt（插件，39 个文件 / 12055 行）

| 文件                                           | 行数 | 备注                                                        |
| ---------------------------------------------- | ---: | ----------------------------------------------------------- |
| `lib/llm/security-falsifier-client.ts`         |   94 |                                                             |
| `lib/llm/security-hunt-client.ts`              |  896 |                                                             |
| `lib/llm/security-hunt-compress-client.ts`     |  132 |                                                             |
| `lib/llm/security-hunt-plan-client.ts`         |  416 |                                                             |
| `lib/security-scan/graph/agent-loop.ts`        |  332 |                                                             |
| `lib/security-scan/graph/build-subgraph.ts`    |  407 |                                                             |
| `lib/security-scan/graph/imports.ts`           |   29 |                                                             |
| `lib/security-scan/graph/llm-output-flow.ts`   |  482 |                                                             |
| `lib/security-scan/graph/patterns.ts`          |  134 |                                                             |
| `lib/security-scan/graph/query.ts`             |   65 |                                                             |
| `lib/security-scan/graph/types.ts`             |   58 |                                                             |
| `lib/security-scan/hunt/allocation.ts`         |  142 |                                                             |
| `lib/security-scan/hunt/batches.ts`            |  125 |                                                             |
| `lib/security-scan/hunt/budget.ts`             |   83 |                                                             |
| `lib/security-scan/hunt/candidate.ts`          |   61 |                                                             |
| `lib/security-scan/hunt/compress-usable.ts`    |   63 |                                                             |
| `lib/security-scan/hunt/coverage.ts`           |  290 |                                                             |
| `lib/security-scan/hunt/mechanical-verify.ts`  |  381 |                                                             |
| `lib/security-scan/hunt/plan-fallback.ts`      |  167 |                                                             |
| `lib/security-scan/hunt/plan-repair.ts`        |   64 |                                                             |
| `lib/security-scan/hunt/plan-retry.ts`         |  210 |                                                             |
| `lib/security-scan/hunt/progress.ts`           |  111 |                                                             |
| `lib/security-scan/hunt/prompt-safety.ts`      |   68 |                                                             |
| `lib/security-scan/hunt/repo-symbols.ts`       |  266 |                                                             |
| `lib/security-scan/hunt/shell-allowlist.ts`    | 1092 |                                                             |
| `lib/security-scan/hunt/snippet.ts`            |   31 |                                                             |
| `lib/security-scan/hunt/step-output.ts`        |   93 |                                                             |
| `lib/security-scan/hunt/task-context.ts`       |  129 |                                                             |
| `lib/security-scan/hunt/transcript.ts`         |  113 |                                                             |
| `lib/security-scan/hunt/trigger.ts`            |  223 | 拆开：addedControlCallIds 移到核心（claim-faithfulness 用） |
| `lib/services/security-graph-rules.service.ts` |  301 |                                                             |
| `lib/services/security-hunt-ops.service.ts`    |  457 |                                                             |
| `lib/services/security-hunt-sandbox.ts`        |  924 |                                                             |
| `lib/services/security-hunt-start.ts`          |   79 |                                                             |
| `lib/services/security-hunt-task-context.ts`   |  102 |                                                             |
| `lib/services/security-hunt.config.ts`         | 1394 |                                                             |
| `lib/services/security-hunt.service.ts`        | 1021 |                                                             |
| `lib/workflows/security-hunt.steps.ts`         |  135 |                                                             |
| `lib/workflows/security-hunt.ts`               |  885 |                                                             |

#### scan-managed（插件，17 个文件 / 3572 行）

| 文件                                                | 行数 | 备注                   |
| --------------------------------------------------- | ---: | ---------------------- |
| `lib/integrations/vercel-sandbox/index.ts`          |  283 | 只有托管扫描与 hunt 用 |
| `lib/security-scan/semgrep-rules.ts`                |  400 |                        |
| `lib/services/sandbox-credential-scrub.ts`          |  291 |                        |
| `lib/services/security-baseline-scan-start.ts`      |   33 |                        |
| `lib/services/security-baseline.service.ts`         |  169 |                        |
| `lib/services/security-managed-scan-cancel.ts`      |   29 |                        |
| `lib/services/security-managed-scan-ops.service.ts` |  198 |                        |
| `lib/services/security-managed-scan-start.ts`       |   33 |                        |
| `lib/services/security-managed-scan.config.ts`      |  248 |                        |
| `lib/services/security-managed-scan.scripts.ts`     |  151 |                        |
| `lib/services/security-managed-scan.service.ts`     |  723 |                        |
| `lib/workflows/security-baseline-scan.steps.ts`     |   27 |                        |
| `lib/workflows/security-baseline-scan.ts`           |   51 |                        |
| `lib/workflows/security-managed-scan.steps.ts`      |   30 |                        |
| `lib/workflows/security-managed-scan.ts`            |  143 |                        |
| `security/semgrep-rules/llm.ts`                     |  390 |                        |
| `security/semgrep-rules/llm.yaml`                   |  373 |                        |

#### scan-sarif（插件，13 个文件 / 2412 行）

| 文件                                                    | 行数 | 备注                  |
| ------------------------------------------------------- | ---: | --------------------- |
| `app/api/cron/prune-security-sarif/route.ts`            |   24 |                       |
| `app/api/integrations/security/sarif/complete/route.ts` |  112 |                       |
| `app/api/integrations/security/sarif/upload/route.ts`   |  148 |                       |
| `lib/auth/github-oidc.ts`                               |  394 | 只有 SARIF 上传鉴权用 |
| `lib/auth/sarif-ingest-auth.ts`                         |  117 |                       |
| `lib/security-scan/sarif.ts`                            |  582 |                       |
| `lib/services/security-sarif-blob.ts`                   |   59 |                       |
| `lib/services/security-sarif-ingest-start.ts`           |   31 |                       |
| `lib/services/security-sarif-ingest.service.ts`         |  594 |                       |
| `lib/services/security-sarif-rate-limit.ts`             |   35 |                       |
| `lib/validation/security-sarif.ts`                      |  124 |                       |
| `lib/workflows/security-sarif-ingest.steps.ts`          |   66 |                       |
| `lib/workflows/security-sarif-ingest.ts`                |  126 |                       |

#### scan-ai-review（插件，23 个文件 / 2759 行）

| 文件                                                   | 行数 | 备注 |
| ------------------------------------------------------ | ---: | ---- |
| `lib/llm/review-ranker-client.ts`                      |  119 |      |
| `lib/llm/review-verifier-client.ts`                    |  230 |      |
| `lib/llm/security-disposition-falsifier-client.ts`     |   92 |      |
| `lib/llm/security-judge-client.ts`                     |  201 |      |
| `lib/security-scan/diff-snippet.ts`                    |   86 |      |
| `lib/security-scan/judge-budget.ts`                    |   70 |      |
| `lib/security-scan/pr-summary.ts`                      |   92 |      |
| `lib/security-scan/related-context.ts`                 |  459 |      |
| `lib/security-scan/review-context.ts`                  |  210 |      |
| `lib/security-scan/review-kinds.ts`                    |   60 |      |
| `lib/security-scan/suggestion.ts`                      |   18 |      |
| `lib/security-scan/truncate.ts`                        |  224 |      |
| `lib/security-scan/verifier.ts`                        |  152 |      |
| `lib/services/review-context.service.ts`               |   68 |      |
| `lib/services/review-verifier-ops.service.ts`          |   40 |      |
| `lib/services/review-verifier-start.ts`                |   37 |      |
| `lib/services/review-verifier.config.ts`               |   27 |      |
| `lib/services/review-verifier.service.ts`              |  284 |      |
| `lib/services/security-suggest-disposition.service.ts` |  209 |      |
| `lib/services/security-suggest.config.ts`              |   13 |      |
| `lib/workflows/review-verifier.steps.ts`               |   17 |      |
| `lib/workflows/review-verifier.ts`                     |   17 |      |
| `lib/workflows/security-suggest.steps.ts`              |   34 |      |

#### scan-retention（插件，6 个文件 / 629 行）

| 文件                                                                            | 行数 | 备注                                                                  |
| ------------------------------------------------------------------------------- | ---: | --------------------------------------------------------------------- |
| `app/api/cron/sweep-expired-scan-evidence/route.ts`                             |   19 |                                                                       |
| `app/api/cron/sweep-unconfirmed-scan-code/route.ts`                             |   19 |                                                                       |
| `app/workspace/[workspaceUrl]/components/settings/ScanEvidenceRetentionRow.tsx` |  100 |                                                                       |
| `lib/security-scan/evidence-retention.ts`                                       |  235 | 拆开：保留天数常量移到核心（法务页/workspace 设置用），清扫逻辑随插件 |
| `lib/services/scan-code-retention.service.ts`                                   |  108 |                                                                       |
| `lib/services/scan-evidence-retention.service.ts`                               |  148 |                                                                       |

#### scan-core（插件，37 个文件 / 9738 行）

| 文件                                                                                   | 行数 | 备注                                                          |
| -------------------------------------------------------------------------------------- | ---: | ------------------------------------------------------------- |
| `app/api/cron/sweep-security-scans/route.ts`                                           |   62 |                                                               |
| `app/api/internal/pr-security-scan/route.ts`                                           |   63 |                                                               |
| `app/api/pull-requests/[number]/scans/route.ts`                                        |   60 |                                                               |
| `app/api/tasks/[id]/security-findings/[findingId]/disposition/route.ts`                |   69 |                                                               |
| `app/api/tasks/[id]/security-findings/bulk-disposition/route.ts`                       |   66 |                                                               |
| `app/api/tasks/[id]/security-scans/route.ts`                                           |   38 |                                                               |
| `app/api/workspaces/me/security-scan/route.ts`                                         |   56 |                                                               |
| `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/SecurityScanSection.tsx`   | 1199 |                                                               |
| `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/security-agent-context.ts` |   46 |                                                               |
| `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/security-summary-line.ts`  |   73 |                                                               |
| `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/security-summary.ts`       |  276 |                                                               |
| `app/workspace/[workspaceUrl]/components/settings/SecurityScanSwitchesCard.tsx`        |  166 |                                                               |
| `app/workspace/[workspaceUrl]/hooks/useSecurityScans.ts`                               |   25 |                                                               |
| `lib/repositories/pr-security-scan.repository.ts`                                      | 2176 |                                                               |
| `lib/security-scan/agent-reminder.ts`                                                  |  218 |                                                               |
| `lib/security-scan/diff-lines.ts`                                                      |  196 | 移到核心 lib/diff/（claim-faithfulness 也用，纯 diff 解析）   |
| `lib/security-scan/index.ts`                                                           |  108 | 桶文件：核心侧改为直接 import 各模块，桶留给插件              |
| `lib/security-scan/inherit-dispositions.ts`                                            |   50 |                                                               |
| `lib/security-scan/policy.ts`                                                          |   80 |                                                               |
| `lib/security-scan/queue-exit.ts`                                                      |  145 |                                                               |
| `lib/security-scan/reliability.ts`                                                     |  146 |                                                               |
| `lib/security-scan/size-caps.ts`                                                       |   70 |                                                               |
| `lib/security-scan/stages.ts`                                                          |   47 |                                                               |
| `lib/security-scan/types.ts`                                                           |  151 | 拆开：密钥相关类型（scan-secrets/secret-patterns 用）移到核心 |
| `lib/security-scan/workspace-switches.ts`                                              |   98 | 经设置贡献点暴露，核心不再 import                             |
| `lib/services/pr-scan-readout.service.ts`                                              |  647 |                                                               |
| `lib/services/pr-security-reminder.service.ts`                                         |  328 |                                                               |
| `lib/services/pr-security-scan-dispatch.ts`                                            |   56 |                                                               |
| `lib/services/pr-security-scan-gate.ts`                                                |  200 |                                                               |
| `lib/services/pr-security-scan.service.ts`                                             | 1426 |                                                               |
| `lib/services/security-pr-review.service.ts`                                           | 1085 |                                                               |
| `lib/services/security-scan-reliability.service.ts`                                    |   32 |                                                               |
| `lib/services/security-scan-settings.service.ts`                                       |  100 |                                                               |
| `lib/services/security-workspace-switches.service.ts`                                  |   18 |                                                               |
| `lib/validation/security-scan.ts`                                                      |   53 |                                                               |
| `lib/workflows/security-pr-review.steps.ts`                                            |   14 |                                                               |
| `lib/workflows/security-scan-helpers.ts`                                               |   95 |                                                               |
