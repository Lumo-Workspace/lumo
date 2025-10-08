import { PrismaClient } from '@prisma/client'
import { AuthLogger } from '@/lib/utils/logger'

// Default Prisma client instance
const defaultPrisma = new PrismaClient()

interface UserProfile {
  id: string
  userId: string
  preferences: Record<string, any>
  settings: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

interface UserWithProfile {
  id: string
  email: string
  name: string | null
  profileImage: string | null
  createdAt: Date
  updatedAt: Date
  profile: UserProfile | null
}

/**
 * Looks up an existing user by ID
 */
export async function findUserById(
  userId: string,
  prisma: PrismaClient = defaultPrisma
): Promise<UserWithProfile | null> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
      },
    })

    if (user) {
      AuthLogger.log({
        timestamp: new Date().toISOString(),
        action: 'user_lookup',
        result: 'success',
        userId,
        email: user.email,
      })
    }

    return user as UserWithProfile | null
  } catch (error) {
    console.error('Error looking up user by ID:', error)

    AuthLogger.log({
      timestamp: new Date().toISOString(),
      action: 'user_lookup',
      result: 'failure',
      userId,
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    })

    throw error
  }
}

/**
 * Looks up an existing user by email
 */
export async function findUserByEmail(
  email: string,
  prisma: PrismaClient = defaultPrisma
): Promise<UserWithProfile | null> {
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        profile: true,
      },
    })

    if (user) {
      AuthLogger.log({
        timestamp: new Date().toISOString(),
        action: 'user_lookup_by_email',
        result: 'success',
        userId: user.id,
        email: user.email,
      })
    }

    return user as UserWithProfile | null
  } catch (error) {
    console.error('Error looking up user by email:', error)

    AuthLogger.log({
      timestamp: new Date().toISOString(),
      action: 'user_lookup_by_email',
      result: 'failure',
      email,
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    })

    throw error
  }
}

/**
 * Gets user profile with preferences and settings
 */
export async function getUserProfile(
  userId: string,
  prisma: PrismaClient = defaultPrisma
): Promise<UserProfile | null> {
  try {
    const profile = await prisma.userProfile.findUnique({
      where: { userId },
    })

    return profile as UserProfile | null
  } catch (error) {
    console.error('Error getting user profile:', error)
    throw error
  }
}

/**
 * Updates user profile preferences
 */
export async function updateUserPreferences(
  userId: string,
  preferences: Record<string, any>,
  prisma: PrismaClient = defaultPrisma
): Promise<UserProfile> {
  try {
    const updatedProfile = await prisma.userProfile.upsert({
      where: { userId },
      update: {
        preferences,
        updatedAt: new Date(),
      },
      create: {
        userId,
        preferences,
        settings: {},
      },
    })

    AuthLogger.log({
      timestamp: new Date().toISOString(),
      action: 'profile_update',
      result: 'success',
      userId,
      details: { preferencesUpdated: Object.keys(preferences) },
    })

    return updatedProfile as UserProfile
  } catch (error) {
    console.error('Error updating user preferences:', error)

    AuthLogger.log({
      timestamp: new Date().toISOString(),
      action: 'profile_update',
      result: 'failure',
      userId,
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    })

    throw error
  }
}

/**
 * Updates user profile settings
 */
export async function updateUserSettings(
  userId: string,
  settings: Record<string, any>,
  prisma: PrismaClient = defaultPrisma
): Promise<UserProfile> {
  try {
    const updatedProfile = await prisma.userProfile.upsert({
      where: { userId },
      update: {
        settings,
        updatedAt: new Date(),
      },
      create: {
        userId,
        preferences: {},
        settings,
      },
    })

    AuthLogger.log({
      timestamp: new Date().toISOString(),
      action: 'settings_update',
      result: 'success',
      userId,
      details: { settingsUpdated: Object.keys(settings) },
    })

    return updatedProfile as UserProfile
  } catch (error) {
    console.error('Error updating user settings:', error)

    AuthLogger.log({
      timestamp: new Date().toISOString(),
      action: 'settings_update',
      result: 'failure',
      userId,
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    })

    throw error
  }
}

/**
 * Validates if a user session is still valid
 */
export async function validateUserSession(
  userId: string,
  sessionToken: string,
  prisma: PrismaClient = defaultPrisma
): Promise<{ valid: boolean; user?: UserWithProfile }> {
  try {
    // Check if session exists and is not expired
    const session = await prisma.session.findFirst({
      where: {
        userId,
        sessionToken,
        expires: {
          gt: new Date(),
        },
      },
    })

    if (!session) {
      return { valid: false }
    }

    // Get user data
    const user = await findUserById(userId, prisma)

    if (!user) {
      return { valid: false }
    }

    return { valid: true, user }
  } catch (error) {
    console.error('Error validating user session:', error)
    return { valid: false }
  }
}
