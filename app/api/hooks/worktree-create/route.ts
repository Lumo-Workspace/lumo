import { handleHookRequest } from '@/app/api/hooks/_handler'
import { getStringField } from '@/lib/hooks/payload'
import { worktreeService } from '@/lib/services/worktree.service'

export async function POST(request: Request) {
  return handleHookRequest(request, 'WORKTREE_CREATE', {
    // Record the worktree and link sessions running in it (LUM-150 ②), so a
    // later collision warning can name the branch. Best-effort; never throws.
    afterRecord: async ctx => {
      await worktreeService.handleWorktreeCreate({
        workspaceId: ctx.workspaceId,
        path: getStringField(ctx.payload, 'worktree_path'),
        branch: getStringField(ctx.payload, 'branch'),
      })
    },
  })
}
