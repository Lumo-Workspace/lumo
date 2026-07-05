/** @jest-environment node */
import { pickRepresentativeFrame } from '@/lib/integrations/figma/build-client'

describe('pickRepresentativeFrame', () => {
  it('picks the first FRAME node from the first canvas', () => {
    const fileResp = {
      document: {
        children: [
          {
            type: 'CANVAS',
            children: [
              { id: '1:1', name: 'Not a frame', type: 'GROUP' },
              { id: '1:2', name: 'Cover', type: 'FRAME' },
              { id: '1:3', name: 'Second frame', type: 'FRAME' },
            ],
          },
        ],
      },
    }
    expect(pickRepresentativeFrame(fileResp)).toEqual({
      id: '1:2',
      name: 'Cover',
    })
  })

  it('skips non-CANVAS children and returns null when no FRAME exists', () => {
    const fileResp = {
      document: {
        children: [
          {
            type: 'CANVAS',
            children: [{ id: '1:1', name: 'x', type: 'GROUP' }],
          },
        ],
      },
    }
    expect(pickRepresentativeFrame(fileResp)).toBeNull()
  })
})
