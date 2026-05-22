// lib/integrations/og-metadata/parse.ts
import { parse } from 'node-html-parser'

export interface OgData {
  title?: string
  description?: string
  imageUrl?: string
  faviconUrl?: string
}

function resolve(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined
  try {
    return new URL(href, base).toString()
  } catch {
    return undefined
  }
}

export function parseHtml(html: string, baseUrl: string): OgData {
  const root = parse(html)

  const metaContent = (selector: string): string | undefined => {
    const el = root.querySelector(selector)
    const v = el?.getAttribute('content')
    return v?.trim() || undefined
  }

  const title =
    metaContent('meta[property="og:title"]') ??
    metaContent('meta[name="twitter:title"]') ??
    root.querySelector('title')?.text?.trim() ??
    undefined

  const description =
    metaContent('meta[property="og:description"]') ??
    metaContent('meta[name="twitter:description"]') ??
    metaContent('meta[name="description"]') ??
    undefined

  const ogImageRaw =
    metaContent('meta[property="og:image"]') ??
    metaContent('meta[name="twitter:image"]')
  const imageUrl = resolve(ogImageRaw, baseUrl)

  const linkIcon =
    root.querySelector('link[rel="icon"]') ??
    root.querySelector('link[rel="shortcut icon"]')
  const faviconHref = linkIcon?.getAttribute('href')
  const faviconUrl =
    resolve(faviconHref, baseUrl) ?? resolve('/favicon.ico', baseUrl)

  return { title, description, imageUrl, faviconUrl }
}
