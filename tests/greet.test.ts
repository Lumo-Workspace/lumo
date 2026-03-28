import { greet } from '../utils/greet'

describe('greet', () => {
  it('returns a personalized greeting for a given name', () => {
    expect(greet('Lumo')).toBe('Hello, Lumo!')
  })

  it('returns "Hello, World!" when name is empty', () => {
    expect(greet('')).toBe('Hello, World!')
  })
})
