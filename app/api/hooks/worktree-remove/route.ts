import { handleHookRequest } from '@/app/api/hooks/_handler'
import { getStringField } from '@/lib/hooks/payload'
import { worktreeService } from '@/lib/services/worktree.service'

export async function POST(request: Request) {
  return handleHookRequest(request, 'WORKTREE_REMOVE', {
    // Mark the worktree removed (LUM-150 ②). Best-effort; never throws.
    afterRecord: async ctx => {
      await worktreeService.handleWorktreeRemove({
        workspaceId: ctx.workspaceId,
        path: getStringField(ctx.payload, 'worktree_path'),
        now: new Date(),
      })
    },
  })
}
