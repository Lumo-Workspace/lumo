# Quickstart Guide: Account Management Feature

**Date**: 2025-01-27  
**Feature**: Account Management  
**Branch**: 002-manage-account-1

## Overview

This guide provides a quick start for implementing the Account Management feature, enabling users to update their display names and upload profile avatars with real-time updates across team collaboration views.

## Prerequisites

- Next.js 15+ with App Router
- TypeScript 5+
- Prisma ORM with PostgreSQL
- NextAuth.js for authentication
- Vercel Blob Storage
- shadcn/ui components
- React Hook Form + Zod validation

## Implementation Steps

### 1. Database Schema Updates

Run the Prisma migration to add new fields to the User model:

```bash
# Create and apply migration
npx prisma migrate dev --name add-account-management-fields

# Generate Prisma client
npx prisma generate
```

### 2. API Routes Implementation

#### Profile Management API (`/app/api/profile/route.ts`)

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/db/prisma'
import { z } from 'zod'

const updateProfileSchema = z.object({
  displayName: z.string().max(100).optional(),
})

export async function GET() {
  const session = await getServerSession()
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

  return NextResponse.json(user)
}

export async function PUT(request: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { displayName } = updateProfileSchema.parse(body)

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
    await triggerProfileUpdateEvent(session.user.id, { displayName })

    return NextResponse.json(updatedUser)
  } catch (error) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
```

#### Avatar Upload API (`/app/api/profile/avatar/route.ts`)

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { put } from '@vercel/blob'
import { prisma } from '@/lib/db/prisma'
import sharp from 'sharp'

export async function POST(request: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const formData = await request.formData()
    const file = formData.get('avatar') as File

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large' }, { status: 413 })
    }

    // Validate file type
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',
    ]
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Unsupported file type' },
        { status: 415 }
      )
    }

    // Process image
    const buffer = await file.arrayBuffer()
    const processedBuffer = await sharp(buffer)
      .resize(200, 200, { fit: 'cover' })
      .jpeg({ quality: 85 })
      .toBuffer()

    // Upload to Vercel Blob
    const blob = await put(
      `avatars/${session.user.id}-${Date.now()}.jpg`,
      processedBuffer,
      {
        access: 'public',
        contentType: 'image/jpeg',
      }
    )

    // Update user profile
    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        avatarUrl: blob.url,
        avatarBlobId: blob.pathname,
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
    await triggerProfileUpdateEvent(session.user.id, { avatarUrl: blob.url })

    return NextResponse.json({
      avatarUrl: blob.url,
      avatarBlobId: blob.pathname,
      metadata: {
        originalSize: file.size,
        processedSize: processedBuffer.length,
        dimensions: { width: 200, height: 200 },
        format: 'jpeg',
      },
    })
  } catch (error) {
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
```

### 3. React Components

#### Profile Settings Component (`/components/profile-settings.tsx`)

```typescript
'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useToast } from '@/hooks/use-toast'

const profileSchema = z.object({
  displayName: z.string().max(100).optional()
})

type ProfileForm = z.infer<typeof profileSchema>

export function ProfileSettings() {
  const [isUploading, setIsUploading] = useState(false)
  const { toast } = useToast()

  const form = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema)
  })

  const onSubmit = async (data: ProfileForm) => {
    try {
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })

      if (response.ok) {
        toast({ title: 'Profile updated successfully' })
      } else {
        toast({ title: 'Failed to update profile', variant: 'destructive' })
      }
    } catch (error) {
      toast({ title: 'An error occurred', variant: 'destructive' })
    }
  }

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append('avatar', file)

      const response = await fetch('/api/profile/avatar', {
        method: 'POST',
        body: formData
      })

      if (response.ok) {
        toast({ title: 'Avatar updated successfully' })
        // Refresh page or update state
      } else {
        toast({ title: 'Failed to upload avatar', variant: 'destructive' })
      }
    } catch (error) {
      toast({ title: 'Upload failed', variant: 'destructive' })
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4">
        <Avatar className="h-20 w-20">
          <AvatarImage src={user?.avatarUrl} />
          <AvatarFallback>
            {user?.displayName?.charAt(0) || user?.name?.charAt(0) || 'U'}
          </AvatarFallback>
        </Avatar>
        <div>
          <Label htmlFor="avatar-upload" className="cursor-pointer">
            <Button variant="outline" disabled={isUploading}>
              {isUploading ? 'Uploading...' : 'Change Avatar'}
            </Button>
          </Label>
          <input
            id="avatar-upload"
            type="file"
            accept="image/*"
            onChange={handleAvatarUpload}
            className="hidden"
          />
        </div>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <Label htmlFor="displayName">Display Name</Label>
          <Input
            id="displayName"
            {...form.register('displayName')}
            placeholder="Enter your display name"
          />
        </div>
        <Button type="submit">Update Profile</Button>
      </form>
    </div>
  )
}
```

### 4. Real-time Updates

#### Server-Sent Events API (`/app/api/profile/events/route.ts`)

```typescript
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'

export async function GET(request: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.id) {
    return new Response('Unauthorized', { status: 401 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event
      controller.enqueue(encoder.encode('data: {"type":"connected"}\n\n'))

      // Set up event listeners for profile updates
      // This would integrate with your real-time system
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
```

## Testing

### Unit Tests

```typescript
// tests/profile-settings.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ProfileSettings } from '@/components/profile-settings'

describe('ProfileSettings', () => {
  it('should update display name', async () => {
    render(<ProfileSettings />)

    const input = screen.getByLabelText('Display Name')
    fireEvent.change(input, { target: { value: 'New Name' } })

    const submitButton = screen.getByText('Update Profile')
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText('Profile updated successfully')).toBeInTheDocument()
    })
  })
})
```

### Integration Tests

```typescript
// tests/api/profile.test.ts
import { createMocks } from 'node-mocks-http'
import handler from '@/app/api/profile/route'

describe('/api/profile', () => {
  it('should update user profile', async () => {
    const { req, res } = createMocks({
      method: 'PUT',
      body: { displayName: 'Test Name' },
    })

    await handler(req, res)

    expect(res._getStatusCode()).toBe(200)
    const data = JSON.parse(res._getData())
    expect(data.displayName).toBe('Test Name')
  })
})
```

## Deployment

### Environment Variables

```bash
# Add to .env.local
BLOB_READ_WRITE_TOKEN=your_vercel_blob_token
NEXTAUTH_SECRET=your_nextauth_secret
NEXTAUTH_URL=your_app_url
```

### Vercel Configuration

```json
// vercel.json
{
  "functions": {
    "app/api/profile/avatar/route.ts": {
      "maxDuration": 30
    }
  }
}
```

## Success Criteria Validation

- ✅ Users can update display name in under 30 seconds
- ✅ Avatar uploads complete in under 60 seconds
- ✅ Real-time updates appear within 5 seconds
- ✅ 98% of valid uploads succeed
- ✅ Concurrent updates handled without conflicts
- ✅ Default avatars display when no image present

## Next Steps

1. Implement the API routes and components
2. Add comprehensive test coverage
3. Deploy to staging environment
4. Conduct user acceptance testing
5. Monitor performance metrics
6. Deploy to production with feature flags
