import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { resolveTestCaseParam } from '@/lib/api/resolve-test-case-param'
import { MAX_EVIDENCE_FILES } from '@/lib/validation/test-case'

export const runtime = 'nodejs'
export const maxDuration = 60

/** 截图与日志两类够用。不收 PDF / 任意二进制。 */
const ALLOWED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'text/plain',
  'application/json',
]
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB — 与 /api/upload/image 一致

type Params = { params: Promise<{ id: string; caseRef: string }> }

function extFor(mime: string, filename: string): string {
  const fromName = /\.([A-Za-z0-9]{1,8})$/.exec(filename)?.[1]
  if (fromName) return fromName.toLowerCase()
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'application/json') return 'json'
  return 'txt'
}

/**
 * POST /api/tasks/[id]/test-cases/[caseRef]/evidence — upload run evidence.
 *
 * multipart/form-data with one or more `file` parts. Returns
 * `{ files: [{ url, filename, contentType, size }] }`; the caller puts those
 * entries into the run's `evidence` array as `{ type: 'file', ... }`.
 *
 * Auth is `requireIdentity()` — **not** the `requireAuth()` that
 * `/api/upload/image` uses — so an agent calling with an API key can upload.
 * That is the whole reason this route exists separately: do NOT "unify" them
 * by loosening the documents-image route, which serves a different surface.
 *
 * Blobs are `access: 'public'` (repo-wide for @vercel/blob): the URL is
 * unguessable but publicly fetchable, the same exposure as document images.
 * Accepted knowingly — see the design spec §6.3.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId, caseRef } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const testCase = await resolveTestCaseParam(task.id, caseRef)
  if (!testCase)
    return NextResponse.json({ error: 'Test case not found' }, { status: 404 })

  const formData = await request.formData().catch(() => null)
  if (!formData)
    return NextResponse.json(
      { error: 'Expected multipart/form-data' },
      { status: 400 }
    )

  const files = formData
    .getAll('file')
    .filter((f): f is File => f instanceof File)
  if (files.length === 0)
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  if (files.length > MAX_EVIDENCE_FILES)
    return NextResponse.json(
      { error: `At most ${MAX_EVIDENCE_FILES} files per upload` },
      { status: 400 }
    )

  // 先全量校验再上传：避免部分成功留下一半孤儿 blob。
  for (const file of files) {
    if (!ALLOWED_TYPES.includes(file.type))
      return NextResponse.json(
        {
          error: `Unsupported type "${file.type}". Allowed: ${ALLOWED_TYPES.join(', ')}`,
        },
        { status: 400 }
      )
    if (file.size > MAX_BYTES)
      return NextResponse.json(
        { error: `"${file.name}" is larger than 10 MB` },
        { status: 400 }
      )
  }

  const uploaded: Array<{
    url: string
    filename: string
    contentType: string
    size: number
  }> = []
  for (const file of files) {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const pathname = `test-evidence/${task.id}/${testCase.id}/${unique}.${extFor(file.type, file.name)}`
    const blob = await put(pathname, file, {
      access: 'public',
      contentType: file.type,
    })
    uploaded.push({
      url: blob.url,
      filename: file.name,
      contentType: file.type,
      size: file.size,
    })
  }

  return NextResponse.json({ files: uploaded })
}
