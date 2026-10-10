/**
 * @jest-environment node
 *
 * LUM-1059 — the human-readable crossing ref `<TEAM>-X<n>`: formatting,
 * parsing, and route-param resolution to the cuid.
 */
import {
  formatCrossingRef,
  parseCrossingRef,
} from '@/lib/boundary-crossing/crossing-ref'
import { resolveCrossingParam } from '@/lib/api/resolve-crossing-param'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'

jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: { findIdByTaskAndNumber: jest.fn() },
}))

const mockFind = boundaryCrossingRepository.findIdByTaskAndNumber as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('LUM-1059 formatCrossingRef', () => {
  it('LUM-1059 formats team key + X + number, and falls back to the cuid when unnumbered', () => {
    expect(formatCrossingRef('LUM', 482, 'cuid1')).toBe('LUM-X482')
    expect(formatCrossingRef(null, 3, 'cuid1')).toBe('X3')
    expect(formatCrossingRef('LUM', null, 'cuid1')).toBe('cuid1')
  })
})

describe('LUM-1059 parseCrossingRef', () => {
  it('LUM-1059 parses refs in any case, with or without the team key', () => {
    expect(parseCrossingRef('LUM-X482')).toEqual({
      teamIdentifier: 'LUM',
      number: 482,
    })
    expect(parseCrossingRef(' lum-x7 ')).toEqual({
      teamIdentifier: 'LUM',
      number: 7,
    })
    expect(parseCrossingRef('X12')).toEqual({
      teamIdentifier: null,
      number: 12,
    })
  })

  it('LUM-1059 never mistakes a cuid or a task id for a ref', () => {
    expect(parseCrossingRef('cmv1mvckp000206l5n039w0vu')).toBeNull()
    expect(parseCrossingRef('LUM-482')).toBeNull()
    expect(parseCrossingRef('LUM-X')).toBeNull()
    expect(parseCrossingRef('LUM-X12a')).toBeNull()
  })
})

describe('LUM-1059 resolveCrossingParam', () => {
  it('LUM-1059 resolves a ref to the cuid within the task', async () => {
    mockFind.mockResolvedValue('cuid-7')
    await expect(resolveCrossingParam('lum-x7', 't-1')).resolves.toBe('cuid-7')
    expect(mockFind).toHaveBeenCalledWith('t-1', 7, 'LUM')
  })

  it('LUM-1059 passes a cuid through without a lookup', async () => {
    await expect(
      resolveCrossingParam('cmv1mvckp000206l5n039w0vu', 't-1')
    ).resolves.toBe('cmv1mvckp000206l5n039w0vu')
    expect(mockFind).not.toHaveBeenCalled()
  })

  it('LUM-1059 an unknown ref passes through unchanged so the service 404s', async () => {
    mockFind.mockResolvedValue(null)
    await expect(resolveCrossingParam('LUM-X99', 't-1')).resolves.toBe(
      'LUM-X99'
    )
  })
})
