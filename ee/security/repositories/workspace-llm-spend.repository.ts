/**
 * LUM-1234 — monthly LLM spend ledger per workspace and feature, used to
 * enforce the reward-hack layer's monthly cap. Amounts are stored as integer
 * micro-USD; the month key is the UTC `YYYY-MM`.
 */
import { prisma } from '@/lib/db/prisma'

export type LlmSpendFeature = 'reward_hack'

function monthKey(now: Date): string {
  return now.toISOString().slice(0, 7)
}

export const workspaceLlmSpendRepository = {
  async monthSpendUsd(
    workspaceId: string,
    feature: LlmSpendFeature,
    now: Date
  ): Promise<number> {
    const row = await prisma.workspaceLlmSpend.findUnique({
      where: {
        workspaceId_feature_month: {
          workspaceId,
          feature,
          month: monthKey(now),
        },
      },
      select: { usdMicros: true },
    })
    return row ? Number(row.usdMicros) / 1e6 : 0
  },

  /**
   * Add `usd` to the month's row (atomic increment). Returns the month's
   * total after the write, or null when nothing was written (a non-positive
   * or sub-micro amount).
   */
  async addSpendUsd(
    workspaceId: string,
    feature: LlmSpendFeature,
    usd: number,
    now: Date
  ): Promise<number | null> {
    if (!Number.isFinite(usd) || usd <= 0) return null
    const micros = BigInt(Math.round(usd * 1e6))
    if (micros <= BigInt(0)) return null
    const row = await prisma.workspaceLlmSpend.upsert({
      where: {
        workspaceId_feature_month: {
          workspaceId,
          feature,
          month: monthKey(now),
        },
      },
      create: { workspaceId, feature, month: monthKey(now), usdMicros: micros },
      update: { usdMicros: { increment: micros } },
      select: { usdMicros: true },
    })
    return Number(row.usdMicros) / 1e6
  },

  /**
   * LUM-1234 — take back part of an earlier charge (an estimate that came
   * out higher than the call's real cost). Only ever lowers an existing row.
   */
  async refundSpendUsd(
    workspaceId: string,
    feature: LlmSpendFeature,
    usd: number,
    now: Date
  ): Promise<void> {
    if (!Number.isFinite(usd) || usd <= 0) return
    const micros = BigInt(Math.round(usd * 1e6))
    if (micros <= BigInt(0)) return
    await prisma.workspaceLlmSpend.updateMany({
      where: { workspaceId, feature, month: monthKey(now) },
      data: { usdMicros: { decrement: micros } },
    })
  },
}
