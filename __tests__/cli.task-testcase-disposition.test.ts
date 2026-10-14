/**
 * @jest-environment node
 *
 * LUM-812 — `lumo task testcase disposition` 的纯函数。
 *
 * 这条命令唯一的产出就是两个信封 + 本地顺序检查，所以测的就是这两样。
 * 顺序检查在服务端还会再跑一遍；本地这一道的价值是**在任何请求发出去之前**
 * 把缺的那一步指出来。
 */
import {
  checkStep,
  describeDefectRead,
  describeDefectRuling,
  pickRuling,
  type DefectSubject,
} from '@/cli/src/lib/test-case-disposition'

const SUBJECT: DefectSubject = {
  caseHandle: 'LUM-42/TC3',
  caseTitle: 'Footer keeps the nav row',
  runId: 'run-9',
  recordedAt: '2026-09-22T10:00:00.000Z',
  evidenceCount: 2,
}

describe('pickRuling', () => {
  it('takes exactly one ruling', () => {
    expect(pickRuling({ knownDefect: true })).toEqual({
      ok: true,
      target: 'KNOWN_DEFECT',
    })
    expect(pickRuling({ notADefect: true })).toEqual({
      ok: true,
      target: 'NOT_A_DEFECT',
    })
  })

  it.each([
    ['neither', {}],
    ['both', { knownDefect: true, notADefect: true }],
  ])('refuses %s — there is no default ruling', (_label, flags) => {
    expect(pickRuling(flags)).toMatchObject({ ok: false })
  })
})

describe('checkStep — the local half of the handshake ordering', () => {
  it('no step flag is step 1', () => {
    expect(checkStep({})).toEqual({ ok: true, step: 'READ' })
  })

  it('names the missing receipt rather than firing a doomed request', () => {
    expect(checkStep({ confirm: true })).toMatchObject({ ok: false })
    expect(checkStep({ confirmRead: true })).toMatchObject({ ok: false })
  })

  it('catches a stage-1 receipt presented to --confirm before any request goes out', () => {
    const out = checkStep({ confirm: true, receipt: 'r1.abc' })
    expect(out).toMatchObject({ ok: false })
    expect((out as { error: string }).error).toMatch(
      /read not yet acknowledged/
    )
  })

  it('catches a stage-2 receipt presented to --confirm-read', () => {
    const out = checkStep({ confirmRead: true, receipt: 'r2.abc' })
    expect(out).toMatchObject({ ok: false })
    expect((out as { error: string }).error).toMatch(/already acknowledges/)
  })

  it('refuses both step flags at once', () => {
    expect(
      checkStep({ confirmRead: true, confirm: true, receipt: 'r1.abc' })
    ).toMatchObject({ ok: false })
  })

  it('accepts each step with its own receipt stage', () => {
    expect(checkStep({ confirmRead: true, receipt: 'r1.abc' })).toEqual({
      ok: true,
      step: 'ACK',
    })
    expect(checkStep({ confirm: true, receipt: 'r2.abc' })).toEqual({
      ok: true,
      step: 'WRITE',
    })
  })
})

describe('the envelopes say what is actually being decided', () => {
  it('step 1 names the case, the run and the evidence behind it', () => {
    const lines = describeDefectRead(SUBJECT, 'KNOWN_DEFECT', 'ship it')
    expect(lines.join('\n')).toContain('LUM-42/TC3 "Footer keeps the nav row"')
    expect(lines.join('\n')).toContain('run-9')
    expect(lines.join('\n')).toContain('2 evidence entries')
    expect(lines.join('\n')).toContain('Note: ship it')
  })

  it('step 1 says approving does not mean the defect is fixed', () => {
    // 这一面拦的是「没人拍过板」。信封把这句说死，人才不会以为自己在批准
    // 「bug 已修复」。
    expect(describeDefectRead(SUBJECT, 'KNOWN_DEFECT').join('\n')).toMatch(
      /does NOT mean the defect is fixed/
    )
  })

  it('step 2 replays when the read was shown and acknowledged', () => {
    const lines = describeDefectRuling(SUBJECT, 'NOT_A_DEFECT', {
      readAt: '2026-09-22T10:00:00.000Z',
      readAcknowledgedAt: '2026-09-22T10:01:00.000Z',
    })
    expect(lines.join('\n')).toContain('shown 2026-09-22T10:00:00.000Z')
    expect(lines.join('\n')).toContain('acknowledged 2026-09-22T10:01:00.000Z')
    expect(lines.join('\n')).toMatch(/Step 2 of 2/)
  })

  it('step 2 warns that a later proving run blocks afresh', () => {
    // 裁定绑在 run 上，不是绑在用例上 —— 信封得把这点说出来，否则人会以为
    // 这一次裁定把这条用例永久放行了。
    expect(
      describeDefectRuling(SUBJECT, 'KNOWN_DEFECT', {
        readAt: 'a',
        readAcknowledgedAt: 'b',
      }).join('\n')
    ).toMatch(/later run that proves the defect again will block afresh/)
  })
})

describe('LUM-1135: milestone wording states what each ruling does to the close gate', () => {
  const MS: DefectSubject = { ...SUBJECT, caseHandle: 'Beta/TC1' }
  const ack = { readAt: 'a', readAcknowledgedAt: 'b' }

  it('task wording is unchanged when no owner kind is passed', () => {
    expect(describeDefectRead(SUBJECT, 'NOT_A_DEFECT')).toEqual(
      describeDefectRead(SUBJECT, 'NOT_A_DEFECT', undefined, 'task')
    )
    expect(describeDefectRead(SUBJECT, 'KNOWN_DEFECT').slice(-1)[0]).toBe(
      "⚠ Approving this clears that run's block on DONE. It does NOT mean the defect is fixed — it means a human looked and decided."
    )
    expect(
      describeDefectRuling(SUBJECT, 'KNOWN_DEFECT', ack).slice(-1)[0]
    ).toBe(
      '⚠ This clears the DONE block for that run. A later run that proves the defect again will block afresh.'
    )
  })

  it('NOT_A_DEFECT on a milestone says the case stays held, in both envelopes', () => {
    const read = describeDefectRead(MS, 'NOT_A_DEFECT', undefined, 'milestone')
    expect(read.join('\n')).toContain(
      'the case stays held until it passes on a re-run'
    )
    expect(read.join('\n')).not.toMatch(/DONE/)
    expect(read.slice(-1)[0]).toMatch(/does NOT open the milestone close gate/)
    const ruling = describeDefectRuling(MS, 'NOT_A_DEFECT', ack, 'milestone')
    expect(ruling.slice(-1)[0]).toBe(
      '⚠ The case still holds the milestone close gate until it passes on a re-run.'
    )
  })

  it('KNOWN_DEFECT on a milestone lets the milestone close', () => {
    const read = describeDefectRead(MS, 'KNOWN_DEFECT', undefined, 'milestone')
    expect(read.join('\n')).toContain('let the milestone close anyway')
    expect(read.slice(-1)[0]).toMatch(
      /stops that run holding the milestone close gate/
    )
    expect(
      describeDefectRuling(MS, 'KNOWN_DEFECT', ack, 'milestone').slice(-1)[0]
    ).toMatch(/will hold it afresh/)
  })

  it('pickRuling explains the asymmetric milestone consequence', () => {
    const r = pickRuling({}, 'milestone')
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.error).toMatch(/Only --known-defect lets the milestone close/)
    const t = pickRuling({})
    if (!t.ok) expect(t.error).toMatch(/Both clear the gate/)
  })
})
