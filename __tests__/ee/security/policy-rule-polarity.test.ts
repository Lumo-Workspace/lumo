/**
 * LUM-770 — text guard telling an obligation ("must run X", a checklist item)
 * from a prohibition ("never run X"). Only obligations are downgraded by the
 * policy compiler; anything carrying a prohibition marker is left alone.
 */
import { isObligationText } from '@/ee/security/services/policy/rule-polarity'

describe('isObligationText', () => {
  it('recognises checklist / must-do wording as an obligation', () => {
    expect(
      isObligationText('Before opening a PR: tests + `npx tsc --noEmit` pass')
    ).toBe(true)
    expect(isObligationText('Tests must pass before opening a PR')).toBe(true)
    expect(isObligationText('Always run npm test before committing')).toBe(true)
    expect(isObligationText('Run `npx tsc --noEmit` before every PR')).toBe(
      true
    )
    expect(isObligationText('提 PR 前必须跑 npx tsc --noEmit')).toBe(true)
    expect(isObligationText('每次提交前都要运行 npm test')).toBe(true)
  })

  it('keeps anything with a prohibition marker as a prohibition', () => {
    expect(isObligationText('Never push to main')).toBe(false)
    expect(isObligationText('never run flush-prod')).toBe(false)
    expect(isObligationText('Do not run prisma migrate reset')).toBe(false)
    expect(isObligationText("Don't run migrations against prod")).toBe(false)
    expect(
      isObligationText('You must never apply prod migrations by hand')
    ).toBe(false)
    expect(isObligationText('You must not push to develop')).toBe(false)
    expect(isObligationText('Migrations must only be applied by CI')).toBe(
      false
    )
    expect(isObligationText('Only CI runs prisma migrate deploy')).toBe(false)
    expect(isObligationText('禁止直接 push 到 main')).toBe(false)
    expect(isObligationText('不要在本地跑 prisma migrate deploy')).toBe(false)
    expect(isObligationText('必须不能手动应用生产迁移')).toBe(false)
    expect(isObligationText('生产迁移仅由 CI 应用')).toBe(false)
  })

  it('treats neutral wording with no obligation marker as not an obligation', () => {
    expect(isObligationText('Use Prisma for all database access')).toBe(false)
    expect(isObligationText('')).toBe(false)
  })
})
