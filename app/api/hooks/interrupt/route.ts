import { handleHookRequest } from '@/app/api/hooks/_handler'

// LUM-1051: Codex-only hook event.
export async function POST(request: Request) {
  return handleHookRequest(request, 'INTERRUPT')
}
