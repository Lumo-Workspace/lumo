import { render } from '@testing-library/react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

// LUM-285: dialog overlay must sit on the z-overlay tier and the panel on
// z-modal. The numeric ordering (dropdown > modal > overlay) is guarded in
// __tests__/styles/z-index-tokens.test.ts; this asserts the component emits
// the right tier utilities. jsdom can't compute real stacking, so we assert
// on emitted class names. Radix portals overlay+content into document.body.
describe('Dialog z-index tiers', () => {
  it('renders overlay at z-overlay and content at z-modal, with no raw z-50', () => {
    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>hi</DialogTitle>
        </DialogContent>
      </Dialog>
    )
    expect(document.querySelector('.z-overlay')).not.toBeNull()
    expect(document.querySelector('.z-modal')).not.toBeNull()
    expect(document.querySelector('.z-50')).toBeNull()
  })
})
