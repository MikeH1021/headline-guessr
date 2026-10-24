import { XMLParser } from 'fast-xml-parser'
import { CHROME_UA, PER_FEED } from './constants'
import type { Feed } from './feeds'
import { cleanTitle, plainText, storyUrl } from './text'

export type GatheredStory = {
  source: string
  headline: string
  url: string
  rssCopy: string
  event?: string
}

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: false,
  processEntities: {
    maxExpansionDepth: 10,
    maxEntitySize: 10_000,
    maxEntityCount: 1000,
    maxTotalExpansions: 50_000,
    maxExpandedLength: 2_000_000,
  },
})

const CNN_STORY = /<a href="([^"]+)"[^>]*class="[^"]*container__link[^"]*"[^>]*>[\s\S]{0,2500}?<span class="container__headline-text"[^>]*data-editable="headline"[^>]*>(.*?)<\/span>/g
const NBC_STORY = /<a href="(https:\/\/www\.nbcnews\.com\/[^"]+)"[^>]*>\s*<(?:h2|h3) class="(?:wide-tease-item__headline|multistoryline__headline)[^"]*"[^>]*>(.*?)</g

function textOf(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    if (typeof record['#text'] === 'string') return record['#text']
    if (typeof record.__cdata === 'string') return record.__cdata
  }
  return ''
}

function asList(value: unknown) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

export function storiesFromRss(xml: string) {
  if (!xml.trim()) return []
  let root: unknown
  try {
    root = parser.parse(xml)
  } catch {
    throw new Error('rss parse')
  }
  const record = root && typeof root === 'object' ? root as Record<string, unknown> : {}
  const rss = record.rss && typeof record.rss === 'object' ? record.rss as Record<string, unknown> : record
  const channel = rss.channel && typeof rss.channel === 'object' ? rss.channel as Record<string, unknown> : rss
  const stories: { headline: string; url: string; rssCopy: string }[] = []
  const seen = new Set<string>()
  for (const item of asList(channel.item)) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const title = cleanTitle(textOf(row.title))
    let link = textOf(row.link)
    if (!link.startsWith('http')) {
      const guid = textOf(row.guid)
      if (guid.startsWith('http')) link = guid
    }
    link = storyUrl(link, '')
    if (!title || !link || seen.has(title) || link.includes('/video/')) continue
    seen.add(title)
    const chunks: string[] = []
    if (row.encoded) chunks.push(textOf(row.encoded))
    const description = textOf(row.description)
    if (description) chunks.push(description)
    stories.push({ headline: title, url: link, rssCopy: plainText(chunks.join('\n')).slice(0, 7000) })
  }
  return stories
}

function storiesFromHtml(html: string, pattern: RegExp, base: string) {
  const stories: { headline: string; url: string; rssCopy: string }[] = []
  const seen = new Set<string>()
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  for (const match of html.matchAll(new RegExp(pattern.source, flags))) {
    const title = cleanTitle(match[2] || '')
    const link = storyUrl(match[1] || '', base)
    if (!title || !link || seen.has(title)) continue
    seen.add(title)
    stories.push({ headline: title, url: link, rssCopy: '' })
  }
  return stories
}

async function fetchBytes(url: string) {
  const candidates = [url]
  if (url.startsWith('https://rss.cnn.com/')) candidates.push(`http://${url.slice('https://'.length)}`)
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, {
        headers: { 'User-Agent': CHROME_UA },
        signal: AbortSignal.timeout(20_000),
        redirect: 'follow',
      })
      if (!response.ok) continue
      const bytes = Buffer.from(await response.arrayBuffer())
      const head = bytes.subarray(0, 240).toString('ascii')
      const encoding = /encoding=["']([^"']+)["']/i.exec(head)?.[1] || 'utf-8'
      let text = ''
      try {
        text = new TextDecoder(encoding).decode(bytes)
      } catch {
        text = bytes.toString('utf8')
      }
      return text
    } catch {
      continue
    }
  }
  return ''
}

export async function fetchText(url: string) {
  return fetchBytes(url)
}

export function takeUnseen<T>(stories: T[], seen: (story: T) => boolean, limit: number) {
  const fresh: T[] = []
  let checked = 0
  for (const story of stories) {
    if (seen(story)) {
      checked += 1
      continue
    }
    fresh.push(story)
    if (fresh.length >= limit) break
  }
  return { fresh, checked }
}

export async function storiesFrom(feed: Feed, limit = PER_FEED): Promise<GatheredStory[]> {
  const body = await fetchBytes(feed.url)
  if (!body.trim()) throw new Error('rss empty')
  const found = feed.kind === 'cnn'
    ? storiesFromHtml(body, CNN_STORY, 'https://www.cnn.com')
    : feed.kind === 'nbc'
      ? storiesFromHtml(body, NBC_STORY, 'https://www.nbcnews.com')
      : storiesFromRss(body)
  return found.slice(0, limit).map((story) => ({ ...story, source: feed.name }))
}

export function jsonStringAt(html: string, key: string) {
  const start = html.indexOf(key)
  if (start === -1) return ''
  let index = start + key.length
  const chars: string[] = []
  while (index < html.length) {
    const char = html[index]
    if (char === '\\') {
      chars.push(html.slice(index, index + 2))
      index += 2
      continue
    }
    if (char === '"') break
    chars.push(char)
    index += 1
  }
  try {
    const parsed = JSON.parse(`"${chars.join('')}"`) as unknown
    return typeof parsed === 'string' ? parsed : ''
  } catch {
    return ''
  }
}

function clipCopy(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 7000)
}

function articleBodyFrom(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = articleBodyFrom(item)
      if (found.length >= 200) return found
    }
    return ''
  }
  const record = value as Record<string, unknown>
  if (typeof record.articleBody === 'string' && record.articleBody.trim().length >= 200) {
    return record.articleBody.trim()
  }
  if (record['@graph']) return articleBodyFrom(record['@graph'])
  return ''
}

export function jsonLdArticle(html: string) {
  for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const found = articleBodyFrom(JSON.parse(match[1] || ''))
      if (found.length >= 200) return found
    } catch {
      continue
    }
  }
  return ''
}

export function articleText(html: string) {
  const structured = jsonLdArticle(html)
    || jsonStringAt(html, '"articleBody":"')
    || jsonStringAt(html, '"articleBody": "')
  if (structured.length >= 200) return clipCopy(structured)
  const copy = paragraphs(html)
  return clipCopy(copy || structured)
}

export function paragraphs(html: string) {
  const article = html.match(/<article\b[^>]*>[\s\S]{0,80000}?<\/article>/i)
  const marker = html.indexOf('single__content entry-content')
  const chunk = article?.[0]
    || (marker === -1 ? html : html.slice(marker, marker + 60000))
  const found: string[] = []
  for (const match of chunk.matchAll(/<p[^>]*>(.*?)<\/p>/gis)) {
    const text = cleanTitle(match[1] || '')
    if (text.length < 80 || text.length > 900 || !text.includes('.')) continue
    if (text.includes('{') || text.includes('function') || text.includes('Primary Menu') || text.includes('not fully supported')) continue
    found.push(text)
  }
  return found.join('\n')
}

export async function articleCopy(url: string) {
  const html = await fetchText(url)
  if (!html) return ''
  return articleText(html)
}

export async function storyCopy(story: GatheredStory) {
  const copy = await articleCopy(story.url)
  if (copy.length >= 200) return copy
  const fallback = (story.rssCopy || '').trim()
  if (fallback.length >= 200) return fallback.slice(0, 7000)
  return copy || fallback
}