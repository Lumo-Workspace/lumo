import { NextResponse } from 'next/server'

import { prisma } from '@/lib/db/prisma'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { email, name, company, teamSize } = body

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email address' },
        { status: 400 }
      )
    }

    // Check if already on waitlist
    const existing = await prisma.waitlistEntry.findUnique({
      where: { email: email.toLowerCase().trim() },
    })

    if (existing) {
      return NextResponse.json(
        { message: 'You are already on the waitlist!' },
        { status: 200 }
      )
    }

    await prisma.waitlistEntry.create({
      data: {
        email: email.toLowerCase().trim(),
        name: name?.trim() || null,
        company: company?.trim() || null,
        teamSize: teamSize || null,
      },
    })

    return NextResponse.json(
      { message: 'You have been added to the waitlist!' },
      { status: 201 }
    )
  } catch (error) {
    // eslint-disable-next-line no-console -- server-side error logging
    console.error('Waitlist signup error:', error)
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
