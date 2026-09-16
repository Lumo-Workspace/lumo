/** PASS 与 PASS_WITH_FOLLOWUP 都算通过（与 verification-run 仓库的
 *  isPassVerdict 同义；这里本地实现以保持本模块零依赖）。 */
function isPass(
  verdict: 'PASS' | 'FAIL' | 'PASS_WITH_FOLLOWUP' | undefined
): boolean {
  return verdict === 'PASS' || verdict === 'PASS_WITH_FOLLOWUP'
}

/**
 * LUM-789 渲染口径：一条 criterion 是否该呈现为「未满足」。
 *
 * 未裁定的 HUMAN 项是 **tacit pass** —— 没人送回就是默认通过，与 DONE 闸
 * 早已采用的口径一致（task-state.service.ts 的 assertNoUnresolvedSendBack
 * 只对明确 FAIL 返回 409）。把它呈现成待办是纯摩擦：一个总会通过的闸产出
 * 的不是信号，是伪装成信号的噪音。
 *
 * ⚠️ 这是 **渲染** 口径，不是裁决口径。裁决用的是
 * task-human-verdict.service.ts 的 `allMet`（every criterion isPassVerdict），
 * 它必须保持「未裁定 ≠ 通过」，否则在 web 上点一条 PASS 会把整个任务推成
 * DONE。两者不得合并。
 */
export function isUnmetForDisplay(
  criterion: { verifierType: 'MACHINE' | 'HUMAN' },
  latest: { verdict: 'PASS' | 'FAIL' | 'PASS_WITH_FOLLOWUP' } | undefined
): boolean {
  if (isPass(latest?.verdict)) return false
  if (latest === undefined && criterion.verifierType === 'HUMAN') return false
  return true
}
