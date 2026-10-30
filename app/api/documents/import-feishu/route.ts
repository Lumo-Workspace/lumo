import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { importFeishuSchema } from '@/lib/validation/document'
import { feishuDocsImportService } from '@/lib/services/feishu-docs-import.service'
import { feishuDocErrorResponse } from '@/lib/api/feishu-doc-error'

/** LUM-1343: import a Feishu / Lark docx or wiki URL as a Lumo Doc. */
export async function POST(request: NextRequest) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const parsed = importFeishuSchema.safeParse(
    await request.json().catch(() => null)
  )
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 }
    )
  }

  try {
    const result = await feishuDocsImportService.importFeishuDoc(
      identity.workspaceId,
      identity.memberId,
      {
        url: parsed.data.url,
        origin: new URL(request.url).origin,
        ...(parsed.data.visibility !== undefined
          ? { visibility: parsed.data.visibility }
          : {}),
      }
    )
    return NextResponse.json(result)
  } catch (error) {
    return feishuDocErrorResponse(error, 'POST /api/documents/import-feishu')
  }
}
