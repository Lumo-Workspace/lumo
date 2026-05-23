import { apiFetch } from './base'
import type { ProposalOperation } from '@/lib/validation/lumo-proposal.schema'

interface ProposalPreview {
  id: string
  operations: ProposalOperation[]
  summary: string
}

interface SyncResult {
  prUrl: string
  prNumber: number
  branchName: string
}

export const lumoSyncClient = {
  generateProposal(taskId: string) {
    return apiFetch<ProposalPreview>(`/api/tasks/${taskId}/lumo-proposals`, {
      method: 'POST',
    })
  },

  sync(proposalId: string) {
    return apiFetch<SyncResult>(`/api/lumo-proposals/${proposalId}/sync`, {
      method: 'POST',
    })
  },

  dismiss(proposalId: string) {
    return apiFetch<{ ok: boolean }>(
      `/api/lumo-proposals/${proposalId}/dismiss`,
      { method: 'POST' }
    )
  },
}
