import { Prisma, BoundaryCrossingCategory } from '@prisma/client'

test('BoundaryCrossing exposes advisory and policyRuleRef', () => {
  const fields = Prisma.dmmf.datamodel.models
    .find(m => m.name === 'BoundaryCrossing')!
    .fields.map(f => f.name)
  expect(fields).toEqual(expect.arrayContaining(['advisory', 'policyRuleRef']))
})

test('ProjectPolicy model exists with sourceHash and rules', () => {
  const model = Prisma.dmmf.datamodel.models.find(
    m => m.name === 'ProjectPolicy'
  )
  expect(model).toBeDefined()
  expect(model!.fields.map(f => f.name)).toEqual(
    expect.arrayContaining(['projectId', 'sourceHash', 'rules', 'compiledAt'])
  )
})

test('new boundary categories are present', () => {
  // Prisma 7 dmmf.datamodel.enums is empty; use the exported enum object instead
  const values = Object.keys(BoundaryCrossingCategory)
  expect(values).toEqual(
    expect.arrayContaining(['PROJECT_RULE_VIOLATION', 'POLICY_WEAKENING'])
  )
})
