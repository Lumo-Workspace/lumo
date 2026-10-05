/**
 * @jest-environment node
 *
 * LUM-946: the /sessions/[id] page end to end on a REAL Postgres (PGlite) —
 * real page, service and repositories; only Clerk, routing and the heavy
 * client sections are stubbed. An OWNER of the session's workspace gets the
 * page with the "whose session" hint and the raw-record section; another
 * member and an owner of a different workspace get notFound().
 */
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { createPgliteHarness } from '../../../scripts/test-support/pglite-harness'
import {
  SESSION_ACCESS,
  VIEWER,
  seedSessionAccess,
} from '../../../scripts/test-support/session-access-seed'

const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient)

jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return harness.prisma
  },
}))

let mockUserId: string | null = null
jest.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: mockUserId }),
}))

jest.mock('@/lib/utils/clerk-helpers', () => ({
  lookupClerkProfiles: async (ids: string[]) =>
    new Map(ids.map(id => [id, { name: 'Mia Member', email: null }])),
}))

jest.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`)
  },
}))

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      d: { defaultMessage?: string },
      values?: Record<string, string>
    ) => {
      let s = d.defaultMessage ?? ''
      for (const [k, v] of Object.entries(values ?? {})) {
        s = s.split(`{${k}}`).join(v)
      }
      return s
    },
  }),
}))

// Heavy client sections: stubs that only mark where they render.
jest.mock('@/app/sessions/[id]/SessionHeader', () => ({
  SessionHeader: ({ id }: { id: string }) => <h1>header {id}</h1>,
}))
jest.mock('@/app/sessions/[id]/SummaryCard', () => ({
  SummaryCard: () => <section>summary</section>,
}))
jest.mock('@/app/sessions/[id]/SessionAttribution', () => ({
  SessionAttribution: () => <section>attribution</section>,
}))
jest.mock('@/app/sessions/[id]/TimelineSection', () => ({
  TimelineSection: () => <section>timeline</section>,
}))
jest.mock('@/app/sessions/[id]/SessionRawRecordSection', () => ({
  SessionRawRecordSection: ({ sessionId }: { sessionId: string }) => (
    <section data-raw-record={sessionId}>raw record</section>
  ),
}))

import SessionDetailPage from '@/app/sessions/[id]/page'

jest.setTimeout(180_000)

beforeAll(async () => {
  await harness.start()
  await seedSessionAccess(harness)
})

afterAll(async () => {
  await harness.stop()
})

async function renderAs(clerkId: string | null, id: string): Promise<string> {
  mockUserId = clerkId
  const el = (await SessionDetailPage({
    params: Promise.resolve({ id }),
  })) as ReactElement
  return renderToStaticMarkup(el)
}

describe('session detail page access', () => {
  it('page renders for the session member without the owner hint', async () => {
    const html = await renderAs(VIEWER.member, SESSION_ACCESS.root)
    expect(html).toContain(`header ${SESSION_ACCESS.root}`)
    expect(html).not.toContain('role="note"')
  })

  it('page renders for the workspace owner with whose session hint and raw record section', async () => {
    const html = await renderAs(VIEWER.ownerA, SESSION_ACCESS.root)
    expect(html).toContain(`header ${SESSION_ACCESS.root}`)
    expect(html).toContain('role="note"')
    expect(html).toContain('This is Mia Member&#x27;s session.')
    expect(html).toContain(`data-raw-record="${SESSION_ACCESS.root}"`)
    expect(html).toContain('content="ws-a"')
  })

  it('page 404s for another member of the same workspace', async () => {
    await expect(
      renderAs(VIEWER.otherMember, SESSION_ACCESS.root)
    ).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('page 404s for an owner of a different workspace', async () => {
    await expect(
      renderAs(VIEWER.ownerBMemberA, SESSION_ACCESS.root)
    ).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(
      renderAs(VIEWER.ownerBOnly, SESSION_ACCESS.root)
    ).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('page renders a child session for the owner and 404s it for another member', async () => {
    const html = await renderAs(VIEWER.ownerA, SESSION_ACCESS.child)
    expect(html).toContain('role="note"')
    await expect(
      renderAs(VIEWER.otherMember, SESSION_ACCESS.child)
    ).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('page 404s a missing id and redirects when signed out', async () => {
    await expect(renderAs(VIEWER.ownerA, 'no-such-session')).rejects.toThrow(
      'NEXT_NOT_FOUND'
    )
    await expect(renderAs(null, SESSION_ACCESS.root)).rejects.toThrow(
      'NEXT_REDIRECT /signin'
    )
  })
})
