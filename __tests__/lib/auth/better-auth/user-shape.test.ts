/**
 * @jest-environment node
 */
import {
  emailAddressId,
  nameFieldsForCreate,
  nameFieldsForUpdate,
  splitName,
  toAuthUser,
} from '@/lib/auth/better-auth/user-shape'

describe('Better Auth user shape (LUM-1027)', () => {
  it('splitName: first token / rest; blanks → nulls', () => {
    expect(splitName('Ada Lovelace King')).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace King',
    })
    expect(splitName('  Ada  ')).toEqual({ firstName: 'Ada', lastName: null })
    expect(splitName('')).toEqual({ firstName: null, lastName: null })
    expect(splitName(null)).toEqual({ firstName: null, lastName: null })
  })

  it('nameFieldsForCreate derives first/last from name, or name from email', () => {
    expect(
      nameFieldsForCreate({ name: 'Grace Hopper', email: 'g@x.io' })
    ).toEqual({ name: 'Grace Hopper', firstName: 'Grace', lastName: 'Hopper' })
    expect(
      nameFieldsForCreate({
        name: 'GH',
        email: 'g@x.io',
        firstName: 'Grace',
        lastName: 'Hopper',
      })
    ).toEqual({ name: 'GH', firstName: 'Grace', lastName: 'Hopper' })
    expect(nameFieldsForCreate({ name: ' ', email: 'grace@x.io' })).toEqual({
      name: 'grace',
      firstName: null,
      lastName: null,
    })
  })

  it('nameFieldsForUpdate keeps the three name columns consistent', () => {
    const current = {
      name: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
    }
    expect(nameFieldsForUpdate(current, { firstName: 'Augusta' })).toEqual({
      name: 'Augusta Lovelace',
      firstName: 'Augusta',
      lastName: 'Lovelace',
    })
    expect(nameFieldsForUpdate(current, { lastName: '' })).toEqual({
      name: 'Ada',
      firstName: 'Ada',
      lastName: null,
    })
    expect(nameFieldsForUpdate(current, { name: 'Countess Lovelace' })).toEqual(
      { name: 'Countess Lovelace', firstName: 'Countess', lastName: 'Lovelace' }
    )
    expect(nameFieldsForUpdate(current, {})).toBe(current)
  })

  it('toAuthUser builds the AuthUser contract with verification status', () => {
    const user = toAuthUser({
      id: 'u1',
      name: 'Ada Lovelace',
      email: 'ada@x.io',
      emailVerified: true,
      image: null,
      firstName: 'Ada',
      lastName: 'Lovelace',
    })
    expect(user).toEqual({
      id: 'u1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      username: null,
      imageUrl: '',
      primaryEmailAddressId: emailAddressId('u1'),
      primaryEmailAddress: {
        id: 'u1:email',
        emailAddress: 'ada@x.io',
        verification: { status: 'verified' },
      },
      emailAddresses: [
        {
          id: 'u1:email',
          emailAddress: 'ada@x.io',
          verification: { status: 'verified' },
        },
      ],
    })
    const unverified = toAuthUser({
      id: 'u2',
      name: 'Grace Hopper',
      email: 'g@x.io',
      emailVerified: false,
      image: 'https://img/1.png',
    })
    expect(unverified.emailAddresses[0]?.verification?.status).toBe(
      'unverified'
    )
    expect(unverified.firstName).toBe('Grace')
    expect(unverified.imageUrl).toBe('https://img/1.png')
  })
})
