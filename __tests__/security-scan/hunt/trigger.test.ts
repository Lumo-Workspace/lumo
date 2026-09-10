/** @jest-environment node */
import { evaluateHuntTrigger } from '@/lib/security-scan/hunt/trigger'

const file = (path: string, ...texts: string[]) => ({
  path,
  lines: texts.map((text, i) => ({ lineNo: i + 1, text })),
})

describe('LUM-739 hunt trigger', () => {
  it('fires on an added route handler, sink call or control call in a TS file', () => {
    expect(
      evaluateHuntTrigger({
        files: [
          file(
            'app/api/x/route.ts',
            'export async function POST(req: Request) {'
          ),
        ],
        hasHighFinding: false,
        hasOpenL4Crossing: false,
      })
    ).toEqual({ hunt: true, reasons: ['diff:entry:next-route-handler'] })
    expect(
      evaluateHuntTrigger({
        files: [file('lib/a.ts', '  await prisma.$queryRawUnsafe(q)')],
        hasHighFinding: false,
        hasOpenL4Crossing: false,
      }).reasons
    ).toEqual(['diff:sink:prisma-raw'])
    expect(
      evaluateHuntTrigger({
        files: [file('lib/a.tsx', 'const body = schema.parse(json)')],
        hasHighFinding: false,
        hasOpenL4Crossing: false,
      }).reasons
    ).toEqual(['diff:control:zod-parse'])
  })

  it('ignores the same text in non-TS files', () => {
    expect(
      evaluateHuntTrigger({
        files: [
          file(
            'docs/a.md',
            'export async function POST(',
            'prisma.$queryRawUnsafe(q)'
          ),
        ],
        hasHighFinding: false,
        hasOpenL4Crossing: false,
      })
    ).toEqual({ hunt: false, reasons: [] })
  })

  it('fires on a HIGH stage-A finding or an OPEN L4 crossing', () => {
    expect(
      evaluateHuntTrigger({
        files: [],
        hasHighFinding: true,
        hasOpenL4Crossing: false,
      }).reasons
    ).toEqual(['stage-a:high'])
    expect(
      evaluateHuntTrigger({
        files: [],
        hasHighFinding: false,
        hasOpenL4Crossing: true,
      }).reasons
    ).toEqual(['l4:open-crossing'])
  })
})
