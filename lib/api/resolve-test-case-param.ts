import {
  testCaseRepository,
  type TestCaseRow,
} from '@/lib/repositories/test-case.repository'

/** Returns true when the segment looks like a Prisma cuid (c + 24 alphanum chars). */
function isLikelyCuid(segment: string): boolean {
  return /^c[a-z0-9]{24}$/.test(segment)
}

/**
 * 解析 `[caseRef]` 路由段。接受 cuid、`TC3`、`3`。
 *
 * CLI 的单一句柄 `LUM-12/TC3` 由 **CLI 侧**在 `/` 处切开——左半走
 * `resolveTaskParam`，右半到这里。服务端不认识带斜杠的复合句柄，避免在 URL
 * 里再嵌一层编码。
 *
 * 始终以 taskId 作用域查询：一个用例号只在它的任务内有意义，cuid 分支也要
 * 校验归属，否则拿到别的任务的 cuid 就能越权读（同 resolveTaskParam 对
 * workspace 的处理）。
 */
export async function resolveTestCaseParam(
  taskId: string,
  caseRef: string
): Promise<TestCaseRow | null> {
  const raw = decodeURIComponent(caseRef).trim()

  if (isLikelyCuid(raw)) {
    const row = await testCaseRepository.findById(raw)
    return row && row.taskId === taskId ? row : null
  }

  const m = /^(?:TC)?(\d+)$/i.exec(raw)
  if (!m) return null
  const number = parseInt(m[1]!, 10)
  if (!Number.isSafeInteger(number) || number < 1) return null

  return testCaseRepository.findByTaskAndNumber(taskId, number)
}
