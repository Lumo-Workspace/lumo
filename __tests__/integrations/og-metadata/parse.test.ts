/** @jest-environment node */
import { parseHtml } from '@/lib/integrations/og-metadata/parse'

const BASE = 'https://example.com/article'

describe('parseHtml', () => {
  it('extracts full OG meta', () => {
    const html = `
      <html><head>
        <meta property="og:title" content="OG Title">
        <meta property="og:description" content="OG Desc">
        <meta property="og:image" content="https://cdn.example.com/og.png">
        <link rel="icon" href="https://example.com/favicon.png">
      </head></html>
    `
    expect(parseHtml(html, BASE)).toEqual({
      title: 'OG Title',
      description: 'OG Desc',
      imageUrl: 'https://cdn.example.com/og.png',
      faviconUrl: 'https://example.com/favicon.png',
    })
  })

  it('falls back to <title> and <meta name=description>', () => {
    const html = `
      <html><head>
        <title>Plain Title</title>
        <meta name="description" content="Plain desc">
      </head></html>
    `
    const result = parseHtml(html, BASE)
    expect(result.title).toBe('Plain Title')
    expect(result.description).toBe('Plain desc')
  })

  it('falls back to twitter:* tags', () => {
    const html = `
      <html><head>
        <meta name="twitter:title" content="TW Title">
        <meta name="twitter:description" content="TW Desc">
        <meta name="twitter:image" content="https://cdn.example.com/tw.png">
      </head></html>
    `
    const result = parseHtml(html, BASE)
    expect(result.title).toBe('TW Title')
    expect(result.description).toBe('TW Desc')
    expect(result.imageUrl).toBe('https://cdn.example.com/tw.png')
  })

  it('resolves a relative og:image against the base URL', () => {
    const html = `
      <html><head>
        <meta property="og:image" content="/static/og.png">
      </head></html>
    `
    expect(parseHtml(html, BASE).imageUrl).toBe(
      'https://example.com/static/og.png'
    )
  })

  it('resolves a relative favicon against the base URL', () => {
    const html = `
      <html><head>
        <link rel="icon" href="/favicon.ico">
      </head></html>
    `
    expect(parseHtml(html, BASE).faviconUrl).toBe(
      'https://example.com/favicon.ico'
    )
  })

  it('defaults faviconUrl to /favicon.ico on origin when no link tag present', () => {
    const html = `<html><head></head></html>`
    expect(parseHtml(html, BASE).faviconUrl).toBe(
      'https://example.com/favicon.ico'
    )
  })

  it('returns undefined fields when nothing is parseable', () => {
    const html = `<html><head></head><body>No meta here.</body></html>`
    expect(parseHtml(html, BASE).title).toBeUndefined()
    expect(parseHtml(html, BASE).description).toBeUndefined()
    expect(parseHtml(html, BASE).imageUrl).toBeUndefined()
  })

  it('prefers og:title over <title>', () => {
    const html = `
      <html><head>
        <title>Plain</title>
        <meta property="og:title" content="OG Wins">
      </head></html>
    `
    expect(parseHtml(html, BASE).title).toBe('OG Wins')
  })
})
