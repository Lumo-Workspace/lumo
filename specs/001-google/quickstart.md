# Quickstart Guide: Google OAuth Login Implementation

**Created**: 2025-01-27  
**Feature**: [spec.md](/Users/chaoli/Projects/lumoai/lumo/specs/001-google/spec.md)  
**Target**: Developers implementing Google OAuth authentication

## Prerequisites

- Node.js 18+ installed
- PostgreSQL database running
- Google Cloud Console project with OAuth 2.0 credentials
- Environment variables configured

## Environment Setup

### 1. Google OAuth Configuration

```bash
# Google Cloud Console setup
1. Create new project or select existing
2. Enable Google+ API
3. Create OAuth 2.0 credentials (Web application)
4. Add authorized redirect URIs:
   - http://localhost:3000/api/auth/callback/google (development)
   - https://yourdomain.com/api/auth/callback/google (production)
5. Copy Client ID and Client Secret
```

### 2. Environment Variables

```bash
# .env.local
DATABASE_URL="postgresql://user:password@localhost:5432/lumo_db"
NEXTAUTH_SECRET="your-secret-key-here"
NEXTAUTH_URL="http://localhost:3000"

# Google OAuth
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"

# Encryption keys (generate new ones for production)
ENCRYPTION_KEY_ACCESS="32-byte-base64-encoded-key"
ENCRYPTION_KEY_REFRESH="32-byte-base64-encoded-key"
```

### 3. Database Setup

```bash
# Install dependencies
npm install prisma @prisma/client next-auth

# Initialize Prisma
npx prisma init

# Run database migrations
npx prisma db push

# Generate Prisma client
npx prisma generate
```

## Implementation Steps

### 1. NextAuth.js Configuration

Create `lib/auth/config.ts`:

```typescript
import { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import { PrismaAdapter } from '@next-auth/prisma-adapter'
import { prisma } from '@/lib/db/prisma'

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: 'openid email profile',
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      // Custom sign-in logic for account linking
      return true
    },
    async session({ session, user }) {
      // Add user ID to session
      if (session.user) {
        session.user.id = user.id
      }
      return session
    },
  },
  pages: {
    signIn: '/login',
    error: '/auth/error',
  },
  session: {
    strategy: 'database',
  },
}
```

### 2. Database Schema

Create `lib/db/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
  @@map("accounts")
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("sessions")
}

model User {
  id            String    @id @default(cuid())
  name          String?
  email         String    @unique
  emailVerified DateTime?
  image         String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  accounts Account[]
  sessions Session[]

  @@map("users")
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
  @@map("verification_tokens")
}
```

### 3. API Route Handler

Create `app/api/auth/[...nextauth]/route.ts`:

```typescript
import NextAuth from 'next-auth'
import { authOptions } from '@/lib/auth/config'

const handler = NextAuth(authOptions)

export { handler as GET, handler as POST }
```

### 4. Google Login Button Component

Create `components/auth/google-login-button.tsx`:

```typescript
"use client"

import { signIn } from "next-auth/react"
import { Button } from "@/components/ui/button"

interface GoogleLoginButtonProps {
  children: React.ReactNode
  className?: string
}

export function GoogleLoginButton({ children, className }: GoogleLoginButtonProps) {
  const handleGoogleLogin = () => {
    signIn("google", {
      callbackUrl: "/dashboard",
      redirect: true
    })
  }

  return (
    <Button
      onClick={handleGoogleLogin}
      className={className}
      variant="outline"
    >
      {children}
    </Button>
  )
}
```

### 5. Account Linking Component

Create `components/auth/account-linking.tsx`:

```typescript
"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

interface AccountLinkingProps {
  isOpen: boolean
  onClose: () => void
}

export function AccountLinking({ isOpen, onClose }: AccountLinkingProps) {
  const [isLinking, setIsLinking] = useState(false)

  const handleLinkGoogle = async () => {
    setIsLinking(true)
    try {
      await signIn("google", {
        callbackUrl: "/api/auth/link-account",
        redirect: false
      })
    } catch (error) {
      console.error("Account linking failed:", error)
    } finally {
      setIsLinking(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link Google Account</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p>Link your Google account for easier sign-in.</p>
          <Button
            onClick={handleLinkGoogle}
            disabled={isLinking}
            className="w-full"
          >
            {isLinking ? "Linking..." : "Link Google Account"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

## Testing Implementation

### 1. Unit Tests

Create `tests/auth/google-login-button.test.tsx`:

```typescript
import { render, screen, fireEvent } from "@testing-library/react"
import { GoogleLoginButton } from "@/components/auth/google-login-button"
import { signIn } from "next-auth/react"

jest.mock("next-auth/react")

describe("GoogleLoginButton", () => {
  it("calls signIn with google provider when clicked", () => {
    const mockSignIn = signIn as jest.MockedFunction<typeof signIn>

    render(<GoogleLoginButton>Sign in with Google</GoogleLoginButton>)

    const button = screen.getByText("Sign in with Google")
    fireEvent.click(button)

    expect(mockSignIn).toHaveBeenCalledWith("google", {
      callbackUrl: "/dashboard",
      redirect: true
    })
  })
})
```

### 2. Integration Tests

Create `tests/integration/oauth-flow.test.ts`:

```typescript
import { createMocks } from 'node-mocks-http'
import handler from '@/app/api/auth/[...nextauth]/route'

describe('OAuth Flow Integration', () => {
  it('handles Google OAuth callback successfully', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      url: '/api/auth/callback/google?code=test-code&state=test-state',
    })

    await handler(req, res)

    expect(res._getStatusCode()).toBe(302)
    expect(res._getHeaders().location).toContain('/dashboard')
  })
})
```

## Deployment Checklist

### Production Setup

- [ ] Update Google OAuth redirect URIs for production domain
- [ ] Generate new encryption keys for production
- [ ] Configure production database connection
- [ ] Set up HTTPS certificates
- [ ] Configure environment variables in production
- [ ] Run database migrations in production
- [ ] Test OAuth flow in production environment

### Security Checklist

- [ ] Verify HTTPS-only configuration
- [ ] Validate token encryption is working
- [ ] Test CSRF protection
- [ ] Verify session security settings
- [ ] Test account linking security
- [ ] Validate error handling doesn't leak sensitive data

## Troubleshooting

### Common Issues

1. **"Invalid redirect URI" error**
   - Verify redirect URIs in Google Cloud Console match your domain
   - Check NEXTAUTH_URL environment variable

2. **"Client ID not found" error**
   - Verify GOOGLE_CLIENT_ID environment variable
   - Check Google Cloud Console project configuration

3. **Database connection errors**
   - Verify DATABASE_URL format and credentials
   - Check PostgreSQL server is running
   - Run `npx prisma db push` to sync schema

4. **Session not persisting**
   - Check NEXTAUTH_SECRET is set
   - Verify database session strategy is working
   - Check session table exists in database

### Debug Mode

Enable debug logging by adding to `lib/auth/config.ts`:

```typescript
export const authOptions: NextAuthOptions = {
  // ... other options
  debug: process.env.NODE_ENV === 'development',
}
```
