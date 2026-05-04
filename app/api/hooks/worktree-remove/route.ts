import { handleHookRequest } from '@/app/api/hooks/_handler'

export async function POST(request: Request) {
  return handleHookRequest(request, 'WORKTREE_REMOVE')
}
