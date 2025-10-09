/**
 * Server-Sent Events API route for real-time profile updates
 * GET /api/profile/events - Establishes SSE connection for profile updates
 */

import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth/config'
import { prisma } from '@/lib/db/prisma'
import { ProfileUpdateEventManager } from '@/lib/realtime/profile-events'

// Global event manager instance
const eventManager = new ProfileUpdateEventManager()

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        displayName: true,
        avatarUrl: true,
        email: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 })
    }

    // Create SSE response
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        // Send initial connection event
        const connectionEvent = {
          type: 'connection_established',
          timestamp: new Date(),
          message: 'Connected to profile updates',
        }

        const initialData = `event: connection_established\ndata: ${JSON.stringify(connectionEvent)}\n\n`
        controller.enqueue(encoder.encode(initialData))

        // Add connection to event manager
        const abortController = new AbortController()
        eventManager.addConnection(session.user.id, abortController)

        // Handle client disconnect
        request.signal.addEventListener('abort', () => {
          eventManager.removeConnection(session.user.id)
          controller.close()
        })

        // Handle abort controller
        abortController.signal.addEventListener('abort', () => {
          eventManager.removeConnection(session.user.id)
          controller.close()
        })

        // Send heartbeat every 30 seconds to keep connection alive
        const heartbeatInterval = setInterval(() => {
          try {
            const heartbeatEvent = {
              type: 'heartbeat',
              timestamp: new Date(),
              message: 'Connection alive',
            }

            const heartbeatData = `event: heartbeat\ndata: ${JSON.stringify(heartbeatEvent)}\n\n`
            controller.enqueue(encoder.encode(heartbeatData))
          } catch (error) {
            console.error('Error sending heartbeat:', error)
            clearInterval(heartbeatInterval)
            controller.close()
          }
        }, 30000)

        // Clean up on close
        const cleanup = () => {
          clearInterval(heartbeatInterval)
          eventManager.removeConnection(session.user.id)
        }

        request.signal.addEventListener('abort', cleanup)
        abortController.signal.addEventListener('abort', cleanup)
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control',
      },
    })
  } catch (error) {
    console.error('Error in SSE endpoint:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Note: The event manager is available globally for use in other parts of the application
