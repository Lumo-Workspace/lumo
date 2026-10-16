import { z } from 'zod'

/**
 * LUM-801: test case 请求体校验。
 *
 * 这里只管**字段级**约束。跨字段一致性（非 FAIL 不得带失败定位、failedIndex
 * 必须落在该段数组范围内、PR 必须属于这个任务）依赖用例与任务的当前状态，
 * 属业务规则，活在 `lib/services/task-test-case.service.ts`。
 */

/** 防呆上限，不是业务规则——因此活在校验层而不是 service。 */
export const MAX_STEPS = 30
export const MAX_STEP_LEN = 500
export const MAX_TITLE_LEN = 200
export const MAX_TEXT_LEN = 2000
export const MAX_NOTE_LEN = 2000
export const MAX_EVIDENCE_ENTRIES = 10
/** 单次 run 最多上传的文件数（上传路由侧的闸门）。 */
export const MAX_EVIDENCE_FILES = 5
/** 截图与日志两类够用。不收 PDF / 任意二进制。 */
export const EVIDENCE_ALLOWED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'text/plain',
  'application/json',
]
export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024 // 10 MB — 与 /api/upload/image 一致
/** LUM-1011: 单步耗时上限（一天）——防呆，不是业务规则。 */
export const MAX_STEP_DURATION_MS = 86_400_000

/** LUM-1211: SKIP 必须说明为什么没检查这一步。 */
export const MAX_SKIP_REASON_LEN = 200

/**
 * LUM-1011 / LUM-1211: 一步的显式结论。PASS / FAIL / SKIP 都是**上报**出来的；
 * 「没到达」「没逐步记录」是读端从缺席推出来的，这里不给它们值。
 * SKIP = 本次没检查这一步，必须带 reason（跨字段规则在 service）。
 */
export const stepResultEntrySchema = z.object({
  phase: z.enum(['STEPS', 'VERIFICATION']),
  /** 0-based。CLI 表面是 1-based，转换在 CLI 侧完成。 */
  index: z.number().int().nonnegative(),
  status: z.enum(['PASS', 'FAIL', 'SKIP']),
  /** LUM-1211: 只属于 SKIP。 */
  reason: z.string().trim().min(1).max(MAX_SKIP_REASON_LEN).nullish(),
  durationMs: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_STEP_DURATION_MS)
    .nullish(),
  /** 本次 run 的 evidence 数组下标：这一步挂的截图 / 日志。 */
  evidence: z
    .array(z.number().int().nonnegative())
    .max(MAX_EVIDENCE_ENTRIES)
    .optional(),
})

const stepList = (min: number) =>
  z.array(z.string().trim().min(1).max(MAX_STEP_LEN)).min(min).max(MAX_STEPS)

/** 证据条目：链接或已上传文件，二选一。 */
export const evidenceEntrySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('link'),
    url: z.string().url().max(2048),
    label: z.string().trim().max(200).optional(),
  }),
  z.object({
    type: z.literal('file'),
    url: z.string().url().max(2048),
    filename: z.string().trim().min(1).max(255),
    contentType: z.string().trim().min(1).max(127),
    size: z.number().int().nonnegative(),
  }),
])

export const createTestCaseBodySchema = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE_LEN),
  setup: z.string().trim().max(MAX_TEXT_LEN).nullish(),
  /** 至少一条：没有步骤的「用例」不是用例。 */
  steps: stepList(1),
  /** 可以为空：不是每条用例都有复验段。 */
  verification: stepList(0),
  expected: z.string().trim().min(1).max(MAX_TEXT_LEN),
  /**
   * LUM-808: 这条用例只有在该环境跑才证明得了东西。null / 省略 = 不限。
   * 比较是**精确相等**，没有环境层级——一条测本地工具链的用例，在生产跑
   * 并不能证明它。
   */
  requiredEnvironment: z.enum(['LOCAL', 'PREVIEW', 'PRODUCTION']).nullish(),
})

export const updateTestCaseBodySchema = createTestCaseBodySchema
  .partial()
  .refine(v => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
  })

export const recordRunBodySchema = z.object({
  result: z.enum(['PASS', 'FAIL', 'BLOCKED']),
  /**
   * 必填，**没有默认值**。这个 feature 存在的理由就是分清这次跑在哪个环境；
   * 一个默认值会让所有人不假思索地记成 LOCAL。不要「顺手」给它加 .default()。
   */
  environment: z.enum(['LOCAL', 'PREVIEW', 'PRODUCTION']),
  /** 0-based。CLI 表面是 1-based，转换在 CLI 侧完成。 */
  failedPhase: z.enum(['STEPS', 'VERIFICATION']).nullish(),
  failedIndex: z.number().int().nonnegative().nullish(),
  /**
   * LUM-808 步骤 1: FAIL 是谁的锅。跨字段规则（FAIL 必填、非 FAIL 禁带、
   * IMPLEMENTATION_DEFECT 必须带证据）是业务规则，活在 service。
   */
  failureAttribution: z
    .enum([
      'IMPLEMENTATION_DEFECT',
      'CASE_OUTDATED',
      'EXTERNAL_BLOCK',
      'UNKNOWN',
    ])
    .nullish(),
  /**
   * LUM-808 步骤 2: 本次没能观察到的复验条目下标。**0-based**，CLI 表面
   * 1-based。范围校验与原文快照在 service（要读用例当前的 verification[]）。
   */
  unprovenVerification: z
    .array(z.number().int().nonnegative())
    .max(MAX_STEPS)
    .optional(),
  note: z.string().trim().max(MAX_NOTE_LEN).nullish(),
  evidence: z.array(evidenceEntrySchema).max(MAX_EVIDENCE_ENTRIES).optional(),
  /**
   * LUM-1011: 逐步结果，选填。跨字段规则（下标范围、只有 FAIL 能带 FAIL 步、
   * 与 failedPhase/failedIndex 一致、失败点之后不得有 PASS）在 service。
   */
  stepResults: z
    .array(stepResultEntrySchema)
    .max(MAX_STEPS * 2)
    .optional(),
  /** LUM-1011: FAIL 时实际看到的结果。只有 FAIL 能带（service 校验）。 */
  actual: z.string().trim().min(1).max(MAX_TEXT_LEN).nullish(),
  /**
   * 代码坐标。只绑 PR 号是不够的——PR 一 push 这条 run 就过时了，所以
   * commitSha 才是陈旧性判定的锚。两者都可空：不是每次执行都发生在某个 PR
   * 的上下文里。
   *
   * 线上协议用 **PR 号**（不是 cuid）：CLI 的 `--pr 123`、web 的下拉、人眼看
   * 到的都是号；服务端按任务作用域把它解析成 pullRequestId 落库。
   */
  pullRequestNumber: z.number().int().positive().nullish(),
  /** 7–40 位 hex。只校验形状，不去 GitHub 验存在性（离线可记录 > 强一致）。 */
  commitSha: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{7,40}$/i, 'commitSha must be a 7-40 character hex sha')
    .nullish(),
  /** null = 未知。绝不读作「干净」。 */
  commitDirty: z.boolean().nullish(),
})

export type CreateTestCaseBody = z.infer<typeof createTestCaseBodySchema>
export type UpdateTestCaseBody = z.infer<typeof updateTestCaseBodySchema>
export type RecordRunBody = z.infer<typeof recordRunBodySchema>
export type EvidenceEntry = z.infer<typeof evidenceEntrySchema>
export type StepResultEntry = z.infer<typeof stepResultEntrySchema>

/**
 * LUM-812: 对一条 PROVEN_DEFECT run 的裁定。
 *
 * 两个值都清闸——闸门问的是「有没有人拍过板」，不是「缺陷修了没」。
 */
export const defectRulingSchema = z.enum(['KNOWN_DEFECT', 'NOT_A_DEFECT'])

/** 握手的第 1、2 步。`acknowledge` 在场 = 第 2 步。两步都不写任何东西。 */
export const defectReceiptRequestSchema = z
  .object({
    disposition: defectRulingSchema,
    acknowledge: z.string().min(1).max(512).optional(),
  })
  .strict()

/**
 * 落裁定。`receipt` 只在 CLI（bearer）来路上必填——web 面板上就是那个人自己
 * 在点，没有需要转述的批准，也就没有要证明顺序的东西。必填与否由服务层按
 * channel 判，schema 这里保持可选。
 */
export const disposeDefectBodySchema = z
  .object({
    disposition: defectRulingSchema,
    note: z.string().trim().max(MAX_NOTE_LEN).nullish(),
    receipt: z.string().min(1).max(512).optional(),
  })
  .strict()

export type DefectReceiptRequest = z.infer<typeof defectReceiptRequestSchema>
export type DisposeDefectBody = z.infer<typeof disposeDefectBodySchema>

/**
 * LUM-819 (D): 一次抽查复核。`.strict()`：body 里多一个字段（比如有人想顺手
 * 塞一个 reviewedBy）直接 400，复核人只从会话身份取。
 */
export const runReviewBodySchema = z
  .object({
    accepted: z.boolean(),
    note: z.string().trim().max(4_000).nullish(),
  })
  .strict()

export type RunReviewBody = z.infer<typeof runReviewBodySchema>
