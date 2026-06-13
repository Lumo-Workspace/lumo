import { runInTransaction } from '@/lib/db/transaction'

const mockTransaction = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: (...args: any[]) => mockTransaction(...args),
  },
}))

beforeEach(() => jest.clearAllMocks())

describe('runInTransaction', () => {
  it('delegates to prisma.$transaction, passing the tx client to the callback and returning its result', async () => {
    const fakeTx = { marker: 'tx-client' }
    mockTransaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(fakeTx)
    )

    const seen: unknown[] = []
    const result = await runInTransaction(async tx => {
      seen.push(tx)
      return 'done'
    })

    expect(result).toBe('done')
    expect(seen).toEqual([fakeTx])
    expect(mockTransaction).toHaveBeenCalledTimes(1)
  })
})
