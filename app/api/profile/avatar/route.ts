import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/config'
import { prisma } from '@/lib/db/prisma'
import { uploadAvatar, deleteAvatar } from '@/lib/storage/blob'
import { processAvatarImage, fileToBuffer } from '@/lib/utils/image-processing'
import {
  validateAvatarUploadRequest,
  formatAvatarValidationError,
} from '@/lib/validation/avatar'
import { triggerProfileUpdate } from '@/lib/realtime/events'

/**
 * POST /api/profile/avatar - Upload avatar image
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse form data
    const formData = await request.formData()
    const validation = validateAvatarUploadRequest(formData)

    if (!validation.success) {
      const errorResponse = formatAvatarValidationError(validation.errors!)
      return NextResponse.json(errorResponse, { status: 400 })
    }

    const file = formData.get('avatar') as File

    // Convert file to buffer
    const fileBuffer = await fileToBuffer(file)

    // Process image (resize, optimize)
    const processedImage = await processAvatarImage(fileBuffer)

    // Upload to Vercel Blob Storage
    const blobResult = await uploadAvatar(
      processedImage.buffer,
      session.user.id
    )

    // Update user profile in database
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        avatarUrl: blobResult.url,
        avatarBlobId: blobResult.pathname,
      },
      select: {
        id: true,
        displayName: true,
        avatarUrl: true,
        avatarBlobId: true,
        email: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    // Trigger real-time update event
    triggerProfileUpdate(session.user.id, { avatarUrl: blobResult.url })

    return NextResponse.json({
      avatarUrl: blobResult.url,
      avatarBlobId: blobResult.pathname,
      metadata: processedImage.metadata,
    })
  } catch (error) {
    console.error('Error uploading avatar:', error)

    // Handle specific error types
    if (error instanceof Error) {
      if (error.message.includes('File too large')) {
        return NextResponse.json({ error: 'File too large' }, { status: 413 })
      }

      if (error.message.includes('Unsupported file type')) {
        return NextResponse.json(
          { error: 'Unsupported file type' },
          { status: 415 }
        )
      }

      if (error.message.includes('Image processing failed')) {
        return NextResponse.json(
          { error: 'Image processing failed' },
          { status: 422 }
        )
      }
    }

    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}

/**
 * DELETE /api/profile/avatar - Remove avatar image
 */
export async function DELETE() {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get current user to find existing avatar
    const currentUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { avatarBlobId: true },
    })

    // Delete from blob storage if exists
    if (currentUser?.avatarBlobId) {
      await deleteAvatar(currentUser.avatarBlobId)
    }

    // Update user profile to remove avatar
    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        avatarUrl: null,
        avatarBlobId: null,
      },
      select: {
        id: true,
        displayName: true,
        avatarUrl: true,
        avatarBlobId: true,
        email: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    // Trigger real-time update event
    triggerProfileUpdate(session.user.id, { avatarUrl: null })

    return NextResponse.json(updatedUser)
  } catch (error) {
    console.error('Error removing avatar:', error)

    return NextResponse.json(
      { error: 'Failed to remove avatar' },
      { status: 500 }
    )
  }
}
