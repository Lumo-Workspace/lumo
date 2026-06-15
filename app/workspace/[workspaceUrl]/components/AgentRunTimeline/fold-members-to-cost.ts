import type { AgentRunMemberStat, ModelCost } from '../../types'

/** A per-person token row that reuses ModelCost's numeric shape so the same
 *  ModelGroup row logic renders it. `model` carries the workspaceMemberId
 *  (stable React key only); `name`/`imageUrl` drive the avatar header slot. */
export interface MemberCostRow extends ModelCost {
  name: string
  imageUrl: string
}

/** Fold each member's per-model costs into one cross-model row. Members with a
 *  zero grand total are dropped; input order (already spend-desc) is preserved.
 *  The "cross-model not summable" caveat is about comparing models for price,
 *  not about per-person attribution share, so summing here is correct. */
export function foldMembersToCostRows(
  perMember: AgentRunMemberStat[]
): MemberCostRow[] {
  return perMember
    .map(mem => {
      const acc = mem.byModel.reduce(
        (a, b) => ({
          input: a.input + b.input,
          output: a.output + b.output,
          cacheRead: a.cacheRead + b.cacheRead,
          cacheCreation: a.cacheCreation + b.cacheCreation,
          total: a.total + b.total,
        }),
        { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 }
      )
      return {
        model: mem.workspaceMemberId,
        name: mem.name,
        imageUrl: mem.imageUrl,
        ...acc,
      }
    })
    .filter(r => r.total > 0)
}
