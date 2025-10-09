import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/config'
import { prisma } from '@/lib/db/prisma'
import {
  validateUpdateProfileRequest,
  formatValidationError,
} from '@/lib/validation/profile'
import { triggerProfileUpdate } from '@/lib/realtime/events'

/**
 * GET /api/profile - Get current user profile
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
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

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json(user)
  } catch (error) {
    console.error('Error fetching user profile:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/profile - Update current user profile
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse and validate request body
    const body = await request.json()
    const validation = validateUpdateProfileRequest(body)

    if (!validation.success) {
      const errorResponse = formatValidationError(validation.errors!)
      return NextResponse.json(errorResponse, { status: 400 })
    }

    const { displayName } = validation.data

    // Update user profile
    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: { displayName },
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
    if (displayName !== undefined) {
      triggerProfileUpdate(session.user.id, { displayName })
    }

    return NextResponse.json(updatedUser)
  } catch (error) {
    console.error('Error updating user profile:', error)

    // Handle specific error types
    if (error instanceof Error) {
      if (error.message.includes('Concurrent update conflict')) {
        return NextResponse.json(
          {
            error:
              'Profile was updated by another user. Please refresh and try again.',
          },
          { status: 409 }
        )
      }

      if (error.message.includes('Network timeout')) {
        return NextResponse.json(
          { error: 'Request timed out. Please try again.' },
          { status: 408 }
        )
      }
    }

    return NextResponse.json(
      { error: 'Failed to update profile' },
      { status: 500 }
    )
  }
}
