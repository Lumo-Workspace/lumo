/** @jest-environment node */
import { buildPlanClusterPrompt } from '@/lib/llm/plan-cluster-client'

it('cluster prompt embeds idea evidence lines', () => {
  const prompt = buildPlanClusterPrompt([
    {
      id: 'i1',
      statement: 'Add dark mode',
      sourceContext: null,
      evidence: ['slack: 3 msgs in #design', 'web: WCAG contrast guide'],
    },
    { id: 'i2', statement: 'Speed up CI', sourceContext: null }, // no evidence → omitted gracefully
  ])
  expect(prompt).toContain('slack: 3 msgs in #design')
  expect(prompt).toContain('web: WCAG contrast guide')
  // i2 has no evidence line
  expect(prompt.split('i2')[1]).not.toContain('evidence:')
})
