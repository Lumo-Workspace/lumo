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
  note: z.string().trim().max(MAX_NOTE_LEN).nullish(),
  evidence: z.array(evidenceEntrySchema).max(MAX_EVIDENCE_ENTRIES).optional(),
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
