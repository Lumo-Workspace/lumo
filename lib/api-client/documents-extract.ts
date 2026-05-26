export type ExtractSelector = { type: 'marked' } | { type: 'all_unchecked' }

export interface ExtractResponse {
  tasks: Array<{ id: string; identifier: string; title: string }>
  updatedContent: string
  updatedAt: string
  skipped: Array<{
    reason: 'empty' | 'too_long' | 'invalid_marker'
    label?: string
  }>
}

export class ExtractTasksError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string
  ) {
    super(message)
  }
}

export async function extractTasks(
  documentId: string,
  body: { content: string; selector: ExtractSelector }
): Promise<ExtractResponse> {
  const res = await fetch(`/api/documents/${documentId}/extract-tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as {
      error?: string
      code?: string
    }
    throw new ExtractTasksError(
      res.status,
      json.code,
      json.error ?? `extract-tasks failed (${res.status})`
    )
  }
  return res.json()
}
