// Throwaway probe for LUM-1127 (do not merge): two deliberately unsafe
// handlers so the PR reviewer leaves two inline threads.
import { exec } from 'child_process'
import type { NextRequest } from 'next/server'

export function runListing(req: NextRequest): void {
  const dir = req.nextUrl.searchParams.get('dir') ?? '.'
  exec('ls -la ' + dir)
}

export function evaluateFormula(req: NextRequest): unknown {
  const formula = req.nextUrl.searchParams.get('f') ?? '0'
  const n = Number(formula)
  return Number.isFinite(n) ? n : null
}
