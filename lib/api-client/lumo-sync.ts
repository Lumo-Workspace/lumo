import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'
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
    return apiFetch<ProposalPreview>(API.lumoSync.generateProposal(taskId), {
      method: 'POST',
    })
  },

  sync(proposalId: string) {
    return apiFetch<SyncResult>(API.lumoSync.sync(proposalId), {
      method: 'POST',
    })
  },

  dismiss(proposalId: string) {
    return apiFetch<{ ok: boolean }>(API.lumoSync.dismiss(proposalId), {
      method: 'POST',
    })
  },
}
