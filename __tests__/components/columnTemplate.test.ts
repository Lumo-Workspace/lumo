// __tests__/components/columnTemplate.test.ts
import {
  ALL_COLUMN_IDS,
  orderColumns,
  buildColumnTemplate,
  COLUMN_GRID_WIDTH,
} from '@/app/workspace/[workspaceUrl]/components/data-table/columnTemplate'

describe('columnTemplate', () => {
  it('orders an arbitrary set into canonical order, dropping unknowns', () => {
    const out = orderColumns(['actions', 'title', 'select', 'bogus' as never])
    expect(out).toEqual(['select', 'title', 'actions'])
  })

  it('builds a grid template with one track per visible column in canonical order', () => {
    const tpl = buildColumnTemplate(['select', 'title', 'updatedAt'])
    expect(tpl).toBe(
      `${COLUMN_GRID_WIDTH.select} ${COLUMN_GRID_WIDTH.title} ${COLUMN_GRID_WIDTH.updatedAt}`
    )
  })

  it('every canonical id has a grid width', () => {
    for (const id of ALL_COLUMN_IDS) {
      expect(COLUMN_GRID_WIDTH[id]).toBeTruthy()
    }
  })
})
