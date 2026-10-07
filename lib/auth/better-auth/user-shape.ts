/**
 * LUM-1027 — pure translation between Better Auth's single `name` and Lumo's
 * `AuthUser` contract (first/last name, email-address list with verification
 * status). No SDK or database imports: shared by the server hooks, the user
 * directory and their tests.
 */
import type { AuthUser } from '../types'

/** The Better Auth user columns the contract is built from. */
export interface BetterAuthUserFields {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image?: string | null
  firstName?: string | null
  lastName?: string | null
}

export interface NameFields {
  name: string
  firstName: string | null
  lastName: string | null
}

const clean = (s: string | null | undefined): string | null => {
  const t = s?.trim()
  return t ? t : null
}

/** "Ada Lovelace King" → first "Ada", last "Lovelace King". */
export function splitName(name: string | null | undefined): {
  firstName: string | null
  lastName: string | null
} {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: null, lastName: null }
  return {
    firstName: parts[0] ?? null,
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : null,
  }
}

/** First + last joined; falls back to `fallback` when both are empty. */
export function joinName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  fallback = ''
): string {
  const joined = [clean(firstName), clean(lastName)].filter(Boolean).join(' ')
  return joined || fallback
}

/**
 * Name columns for a NEW user: explicit first/last win, otherwise they are
 * derived from `name`; `name` itself falls back to the email's local part
 * (Better Auth requires a non-empty name).
 */
export function nameFieldsForCreate(input: {
  name?: string | null
  email: string
  firstName?: string | null
  lastName?: string | null
}): NameFields {
  const hasExplicit = clean(input.firstName) || clean(input.lastName)
  const split = hasExplicit
    ? { firstName: clean(input.firstName), lastName: clean(input.lastName) }
    : splitName(input.name)
  const name =
    clean(input.name) ??
    joinName(split.firstName, split.lastName, input.email.split('@')[0] ?? '')
  return { name, ...split }
}

/**
 * Name columns for a profile UPDATE. Only fields present in `update` change;
 * the others keep their current value, and `name` is recomputed from the
 * result so the three columns never disagree.
 */
export function nameFieldsForUpdate(
  current: NameFields,
  update: { name?: string; firstName?: string; lastName?: string }
): NameFields {
  if (update.firstName !== undefined || update.lastName !== undefined) {
    const firstName =
      update.firstName !== undefined
        ? clean(update.firstName)
        : current.firstName
    const lastName =
      update.lastName !== undefined ? clean(update.lastName) : current.lastName
    return {
      firstName,
      lastName,
      name: joinName(firstName, lastName, current.name),
    }
  }
  if (update.name !== undefined && clean(update.name)) {
    return { name: clean(update.name)!, ...splitName(update.name) }
  }
  return current
}

/** Stable id of a user's single email address (Better Auth has one). */
export function emailAddressId(userId: string): string {
  return `${userId}:email`
}

/** Better Auth user row → the provider-neutral `AuthUser`. */
export function toAuthUser(user: BetterAuthUserFields): AuthUser {
  const derived =
    user.firstName === undefined && user.lastName === undefined
      ? splitName(user.name)
      : { firstName: user.firstName ?? null, lastName: user.lastName ?? null }
  const email = {
    id: emailAddressId(user.id),
    emailAddress: user.email,
    verification: { status: user.emailVerified ? 'verified' : 'unverified' },
  }
  return {
    id: user.id,
    firstName: derived.firstName,
    lastName: derived.lastName,
    username: null,
    imageUrl: user.image ?? '',
    primaryEmailAddressId: email.id,
    primaryEmailAddress: email,
    emailAddresses: [email],
  }
}
