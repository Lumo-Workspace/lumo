import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import {
  effectiveReferentKind,
  type EffectiveReferentKind,
  type DeclarableReferentKind,
} from '../../shared/src/referent-kind'

export interface CriteriaAuditReport {
  total: number
  classified: number // total minus UNCLASSIFIED
  byEffectiveKind: Record<EffectiveReferentKind, number>
  /** (AGENT_CONSTRUCTED_STATE + UNVERIFIED_ASSERTION) / classified — the
   * share of "green" that is self-confirming. 0 when classified is 0. */
  selfConfirmingGreenRatio: number
}

const EMPTY: Record<EffectiveReferentKind, number> = {
  EXTERNAL_FACT: 0,
  AGENT_CONSTRUCTED_STATE: 0,
  PENDING_OUTCOME: 0,
  UNVERIFIED_ASSERTION: 0,
  UNCLASSIFIED: 0,
}

export const criteriaAuditService = {
  async forWorkspace(workspaceId: string): Promise<CriteriaAuditReport> {
    const rows =
      await acceptanceCriterionRepository.listClassifyingFieldsForWorkspace(
        workspaceId
      )
    const byEffectiveKind = { ...EMPTY }
    for (const row of rows) {
      const eff = effectiveReferentKind({
        declared: row.referentKind as DeclarableReferentKind | null,
        verifierType: row.verifierType === 'HUMAN' ? 'HUMAN' : 'MACHINE',
        checkpointer: row.checkpointer,
      })
      byEffectiveKind[eff] += 1
    }
    const total = rows.length
    const classified = total - byEffectiveKind.UNCLASSIFIED
    const selfConfirming =
      byEffectiveKind.AGENT_CONSTRUCTED_STATE +
      byEffectiveKind.UNVERIFIED_ASSERTION
    return {
      total,
      classified,
      byEffectiveKind,
      selfConfirmingGreenRatio:
        classified === 0 ? 0 : selfConfirming / classified,
    }
  },
}
