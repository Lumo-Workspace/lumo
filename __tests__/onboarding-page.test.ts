/**
 * @jest-environment node
 */
const mockAuth = jest.fn()
const mockCurrentUser = jest.fn()
const mockGetUserWorkspace = jest.fn()
const mockJoin = jest.fn()
const mockRedirect = jest.fn((url: string) => {
  throw Object.assign(new Error('NEXT_REDIRECT'), { url })
})

jest.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
  currentUser: () => mockCurrentUser(),
}))
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    workspaceMember: {
      // LUM-987: getUserWorkspace resolves from the ordered membership list.
      findMany: async (...args: unknown[]) => {
        const membership = await mockGetUserWorkspace(...args)
        return membership ? [membership] : []
      },
    },
  },
}))
jest.mock('@/lib/services/invite.service', () => ({
  inviteService: {
    joinPendingInvitesForEmails: (...args: unknown[]) => mockJoin(...args),
  },
}))
jest.mock('next/headers', () => ({
  headers: async () => new Headers({ 'user-agent': 'test-agent' }),
}))
jest.mock('next/navigation', () => ({
  redirect: (url: string) => mockRedirect(url),
}))
jest.mock('@/app/onboarding/OnboardingClient', () => ({
  OnboardingClient: function OnboardingClient() {
    return null
  },
}))

import OnboardingPage from '@/app/onboarding/page'
import { OnboardingClient } from '@/app/onboarding/OnboardingClient'

async function render() {
  try {
    return { element: await OnboardingPage(), redirectedTo: null }
  } catch (err) {
    const url = (err as { url?: string }).url
    if (url) return { element: null, redirectedTo: url }
    throw err
  }
}

const user = (...emails: Array<[string, string]>) => ({
  emailAddresses: emails.map(([emailAddress, status]) => ({
    emailAddress,
    verification: { status },
  })),
})

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ userId: 'clerk-1' })
})

describe('onboarding page', () => {
  it('sends an invited user with no workspace straight into the inviting workspace', async () => {
    mockGetUserWorkspace.mockResolvedValue(null)
    mockCurrentUser.mockResolvedValue(user(['Bob@Acme.com', 'verified']))
    mockJoin.mockResolvedValue('acme')

    const { redirectedTo } = await render()

    expect(redirectedTo).toBe('/workspace/acme')
    expect(mockJoin).toHaveBeenCalledWith(
      'clerk-1',
      ['bob@acme.com'],
      expect.objectContaining({
        actor: expect.objectContaining({ clerkId: 'clerk-1' }),
        source: 'WEB',
        userAgent: 'test-agent',
      })
    )
  })

  it('never matches invites against unverified emails', async () => {
    mockGetUserWorkspace.mockResolvedValue(null)
    mockCurrentUser.mockResolvedValue(
      user(['victim@acme.com', 'unverified'], ['me@home.com', 'verified'])
    )
    mockJoin.mockResolvedValue(null)

    await render()

    expect(mockJoin).toHaveBeenCalledWith(
      'clerk-1',
      ['me@home.com'],
      expect.anything()
    )
  })

  it('shows the onboarding form when there is no invite to join', async () => {
    mockGetUserWorkspace.mockResolvedValue(null)
    mockCurrentUser.mockResolvedValue(user(['new@x.com', 'verified']))
    mockJoin.mockResolvedValue(null)

    const { element, redirectedTo } = await render()

    expect(redirectedTo).toBeNull()
    expect(element?.type).toBe(OnboardingClient)
  })

  it('lets an existing member reach onboarding to create another workspace', async () => {
    mockGetUserWorkspace.mockResolvedValue({
      workspaceId: 'ws-1',
      workspace: { slug: 'mine' },
    })

    const { element } = await render()

    expect(mockJoin).not.toHaveBeenCalled()
    expect(element?.type).toBe(OnboardingClient)
  })

  it('redirects signed-out visitors to sign in', async () => {
    mockAuth.mockResolvedValue({ userId: null })

    const { redirectedTo } = await render()

    expect(redirectedTo).toBe('/signin')
  })
})
