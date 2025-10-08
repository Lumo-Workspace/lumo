import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/config'
import { uploadDocument } from '@/lib/storage/blob'
import { AuthLogger } from '@/lib/utils/logger'

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions)
    if (!session?.user || !('id' in session.user)) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      )
    }

    // Parse form data
    const formData = await request.formData()
    const file = formData.get('document') as File
    const projectId = formData.get('projectId') as string

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No file provided' },
        { status: 400 }
      )
    }

    // Upload the file
    const result = await uploadDocument(
      file,
      (session.user as any).id,
      projectId
    )

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      url: result.url,
      message: 'Document uploaded successfully',
    })
  } catch (error) {
    AuthLogger.logError('Document upload API error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })

    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
