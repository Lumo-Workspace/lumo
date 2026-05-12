import { z } from 'zod'

export const proposalOperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('add'),
    section: z
      .string()
      .describe('Section heading, e.g. "Traps", "Conventions"'),
    content: z.string().describe('Bullet point text to add'),
    rationale: z.string().describe('Why this should be added to LUMO.md'),
    sourceTaskId: z.string().describe('Task ID this knowledge came from'),
  }),
  z.object({
    type: z.literal('modify'),
    section: z.string().describe('Section heading where the bullet lives'),
    oldContent: z.string().describe('Existing bullet text to find and replace'),
    newContent: z.string().describe('Updated bullet text'),
    rationale: z.string().describe('Why this entry needs updating'),
    sourceTaskId: z.string().describe('Task ID this knowledge came from'),
  }),
  z.object({
    type: z.literal('supersede'),
    section: z.string().describe('Section heading where the bullet lives'),
    content: z.string().describe('Existing bullet text to remove'),
    rationale: z.string().describe('Why this entry is no longer valid'),
    sourceTaskId: z.string().describe('Task ID this knowledge came from'),
  }),
])

export const lumoProposalOutputSchema = z.object({
  operations: z.array(proposalOperationSchema),
  summary: z.string().describe('One sentence summarizing the proposed changes'),
})

export type ProposalOperation = z.infer<typeof proposalOperationSchema>
export type LumoProposalOutput = z.infer<typeof lumoProposalOutputSchema>
