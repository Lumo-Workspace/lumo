/**
 * @jest-environment jsdom
 *
 * LUM-983 — when POST /api/waitlist answers 429, /signup shows a friendly,
 * localized message (from the locale file), not the raw server string.
 * The real page + real waitlistClient run; only fetch is stubbed.
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { installRadixSelectShims, pickOption } from '../../helpers/radix-select'

installRadixSelectShims()

const enMessages = jest.requireActual('@/lib/i18n/en.json') as Record<
  string,
  string
>

jest.mock('react-intl', () => {
  const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
    string,
    string
  >
  return {
    useIntl: () => ({
      formatMessage: ({ id }: { id: string }) => messages[id] ?? id,
    }),
  }
})

import WaitlistPage from '@/app/signup/[[...signup]]/page'

const mockFetch = jest.fn()

beforeEach(() => {
  mockFetch.mockReset()
  global.fetch = mockFetch as unknown as typeof fetch
})

function respond(status: number, body: unknown) {
  mockFetch.mockResolvedValue({
    ok: status < 400,
    status,
    json: jest.fn().mockResolvedValue(body),
  })
}

function submit(email: string) {
  render(<WaitlistPage />)
  fireEvent.change(screen.getByLabelText(/Work email/), {
    target: { value: email },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Join Waitlist' }))
}

describe('/signup — 429 from the waitlist API', () => {
  it('has a localized rate-limit message in en.json', () => {
    expect(enMessages['waitlist.error.rateLimited']).toEqual(expect.any(String))
  })

  it('shows the localized rate-limit message, not the server string', async () => {
    respond(429, { error: 'SERVER_RAW_429_TEXT' })
    submit('alice@example.com')

    await waitFor(() =>
      expect(
        screen.getByText(
          enMessages['waitlist.error.rateLimited'] ?? '<missing key>'
        )
      ).toBeInTheDocument()
    )
    expect(screen.queryByText('SERVER_RAW_429_TEXT')).not.toBeInTheDocument()
    // The form stays usable so the visitor can retry later.
    expect(screen.getByRole('button', { name: 'Join Waitlist' })).toBeEnabled()
  })

  it('still shows the success state on 201', async () => {
    respond(201, { message: 'You have been added to the waitlist!' })
    submit('bob@example.com')
    await waitFor(() =>
      expect(
        screen.getByText(enMessages['waitlist.success.title']!)
      ).toBeInTheDocument()
    )
  })

  // LUM-1250: the success state uses a decorative Lucide icon, not an emoji.
  it('renders the success icon as an aria-hidden svg, not an emoji', async () => {
    respond(201, { message: 'ok' })
    submit('carol@example.com')
    const title = await screen.findByText(enMessages['waitlist.success.title']!)
    const card = title.parentElement!
    const icon = card.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(icon).toHaveClass('text-muted-foreground')
    expect(card.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})

// LUM-1265: team size is optional, so a picked size can be taken back.
describe('/signup — team size can be cleared', () => {
  it('submits an empty team size after picking a size and then "Prefer not to say"', async () => {
    respond(201, { message: 'ok' })
    render(<WaitlistPage />)
    fireEvent.change(screen.getByLabelText(/Work email/), {
      target: { value: 'carol@example.com' },
    })
    const teamSize = screen.getByLabelText('Team size')
    await pickOption(teamSize, '2–5')
    expect(teamSize).toHaveTextContent('2–5')
    await pickOption(teamSize, 'Prefer not to say')
    expect(teamSize).toHaveTextContent('Select…')
    fireEvent.click(screen.getByRole('button', { name: 'Join Waitlist' }))
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      email: 'carol@example.com',
      teamSize: '',
    })
  })
})
