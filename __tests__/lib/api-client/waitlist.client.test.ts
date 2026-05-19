import { waitlistClient } from '@/lib/api-client/waitlist'
import { ApiClientError } from '@/lib/api-client/base'

const mockFetch = jest.fn()
global.fetch = mockFetch

const input = {
  email: 'alice@example.com',
  name: 'Alice',
  company: 'Acme',
  teamSize: '2-5',
}

function mockResponse(
  body: unknown,
  init: { status: number; ok?: boolean } = { status: 200 }
) {
  return {
    ok: init.ok ?? init.status < 400,
    status: init.status,
    json: jest.fn().mockResolvedValue(body),
  }
}

beforeEach(() => mockFetch.mockReset())

describe('waitlistClient.join', () => {
  it('maps HTTP 201 to result=created', async () => {
    mockFetch.mockResolvedValue(
      mockResponse(
        { message: 'You have been added to the waitlist!' },
        { status: 201 }
      )
    )

    const result = await waitlistClient.join(input)

    expect(result).toEqual({
      result: 'created',
      message: 'You have been added to the waitlist!',
    })
    expect(mockFetch).toHaveBeenCalledWith('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  })

  it('maps HTTP 200 to result=existing for duplicate signups', async () => {
    mockFetch.mockResolvedValue(
      mockResponse(
        { message: 'You are already on the waitlist!' },
        { status: 200 }
      )
    )

    const result = await waitlistClient.join(input)

    expect(result).toEqual({
      result: 'existing',
      message: 'You are already on the waitlist!',
    })
  })

  it('throws ApiClientError on validation failure', async () => {
    mockFetch.mockResolvedValue(
      mockResponse(
        { error: 'Invalid email address' },
        { status: 400, ok: false }
      )
    )

    await expect(waitlistClient.join(input)).rejects.toBeInstanceOf(
      ApiClientError
    )
    try {
      await waitlistClient.join(input)
    } catch (err) {
      expect((err as ApiClientError).status).toBe(400)
      expect((err as ApiClientError).message).toBe('Invalid email address')
    }
  })

  it('throws ApiClientError with default message on non-JSON failure', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: jest.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
    })

    await expect(waitlistClient.join(input)).rejects.toMatchObject({
      status: 500,
      message: 'Request failed with status 500',
    })
  })
})
