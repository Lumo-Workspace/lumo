/**
 * User Creation Logic
 *
 * Handles automatic user profile creation from Google OAuth
 *
 * Requirements:
 * - UR-001: Auto-create user profile on first login
 * - UR-004: Store Google profile picture
 * - SR-016: Email verification from Google
 */

import { prisma } from '@/lib/db/prisma'

/**
 * Google profile data from OAuth
 */
export interface GoogleProfile {
  sub: string // Google user ID
  email: string // User email
  email_verified: boolean // Email verification status
  name?: string // Full name
  given_name?: string // First name
  family_name?: string // Last name
  picture?: string // Profile picture URL
  locale?: string // Preferred locale
}

/**
 * Create a new user from Google profile
 * Called automatically on first login via NextAuth Prisma adapter
 *
 * @param profile - Google OAuth profile data
 * @returns Created user record
 */
export async function createGoogleUser(profile: GoogleProfile) {
  try {
    const user = await prisma.user.create({
      data: {
        email: profile.email,
        emailVerified: profile.email_verified ? new Date() : null,
        name: profile.name || null,
        image: profile.picture || null,
      },
    })

    console.log('Created new user from Google profile:', {
      userId: user.id,
      email: user.email,
    })

    return user
  } catch (error) {
    console.error('Failed to create user from Google profile:', error)
    throw error
  }
}

/**
 * Update user profile from Google profile
 * Updates name and picture if they have changed
 *
 * @param userId - Existing user ID
 * @param profile - Google OAuth profile data
 * @returns Updated user record
 */
export async function updateGoogleUser(userId: string, profile: GoogleProfile) {
  try {
    const updateData: any = {
      name: profile.name || null,
      image: profile.picture || null,
    }

    // Update emailVerified only if the profile is verified
    if (profile.email_verified) {
      updateData.emailVerified = new Date()
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
    })

    console.log('Updated user from Google profile:', {
      userId: user.id,
      email: user.email,
    })

    return user
  } catch (error) {
    console.error('Failed to update user from Google profile:', error)
    throw error
  }
}
