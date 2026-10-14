import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { errorResponse } from '@/lib/api/route-error'
import { milestoneTestCaseService } from '@/lib/services/milestone-test-case.service'
import {
  EVIDENCE_ALLOWED_TYPES,
  EVIDENCE_MAX_BYTES,
  MAX_EVIDENCE_FILES,
} from '@/lib/validation/test-case'
import { privateFileService } from '@/lib/services/private-file.service'

export const runtime = 'nodejs'
export const maxDuration = 60

type Params = { params: Promise<{ milestoneId: string; caseRef: string }> }

/**
 * POST /api/milestones/[milestoneId]/test-cases/[caseRef]/evidence — upload run evidence.
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
 * LUM-916: blobs are PRIVATE. The returned `url` is Lumo's file route
 * (`/api/files/test-evidence/...`), which serves the bytes only to members of
 * the milestone's workspace — evidence screenshots can show customer data, so an
 * unguessable public URL is not enough (it leaks the moment it is pasted into
 * a PR or a log, and cannot be revoked).
 */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { milestoneId, caseRef } = await params
  let testCase
  try {
    testCase = await milestoneTestCaseService.resolveCase(
      milestoneId,
      caseRef,
      identity.memberId
    )
  } catch (error) {
    return errorResponse(error)
  }

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
    if (!EVIDENCE_ALLOWED_TYPES.includes(file.type))
      return NextResponse.json(
        {
          error: `Unsupported type "${file.type}". Allowed: ${EVIDENCE_ALLOWED_TYPES.join(', ')}`,
        },
        { status: 400 }
      )
    if (file.size > EVIDENCE_MAX_BYTES)
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
  const origin = new URL(request.url).origin
  for (const file of files) {
    const url = await privateFileService.storeMilestoneEvidence(
      milestoneId,
      testCase.id,
      file,
      origin
    )
    uploaded.push({
      url,
      filename: file.name,
      contentType: file.type,
      size: file.size,
    })
  }

  return NextResponse.json({ files: uploaded })
}
