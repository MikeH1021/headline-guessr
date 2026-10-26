import { CHROME_UA } from './constants'
import { isPrivateHost } from './feeds'
import { articleHref, isGoogleNewsUrl } from './text'

const FAIL_FOR_MS = 10 * 60 * 1000
const cooled = new Map<string, number>()
const inflight = new Map<string, Promise<string>>()

// Google News RSS addresses are opaque tokens. Following them stays on news.google.com.
// The publisher address comes back from the signed batchexecute call below.
export function googleArticleId(value: unknown) {
  const href = articleHref(value)
  if (!href) return ''
  try {
    const parsed = new URL(href)
    if (parsed.hostname.toLowerCase().replace(/\.$/, '') !== 'news.google.com') return ''
    if (parsed.username || parsed.password) return ''
    const match = /^\/rss\/articles\/([A-Za-z0-9_-]{20,2000})\/?$/.exec(parsed.pathname)
    return match?.[1] || ''
  } catch {
    return ''
  }
}

export function publisherFromBatch(body: string) {
  const start = body.indexOf('[')
  if (start < 0) return ''
  try {
    return urlFromBatch(JSON.parse(body.slice(start)) as unknown, 0)
  } catch {
    return ''
  }
}

function urlFromBatch(value: unknown, depth: number): string {
  if (depth > 6) return ''
  if (typeof value === 'string') {
    if (!value.includes('garturlres')) return ''
    try {
      return urlFromBatch(JSON.parse(value) as unknown, depth + 1)
    } catch {
      return ''
    }
  }
  if (!Array.isArray(value)) return ''
  if (value[0] === 'garturlres' && typeof value[1] === 'string') return acceptPublisher(value[1])
  for (const item of value) {
    const found = urlFromBatch(item, depth + 1)
    if (found) return found
  }
  return ''
}

function acceptPublisher(value: string) {
  const href = articleHref(value)
  if (!href || isGoogleNewsUrl(href)) return ''
  try {
    const host = new URL(href).hostname.toLowerCase().replace(/\.$/, '')
    if (!host || host === 'google.com' || host.endsWith('.google.com')) return ''
    if (isPrivateHost(host)) return ''
    return href
  } catch {
    return ''
  }
}

function decodingParams(html: string) {
  const timestamp = /data-n-a-ts="(\d{1,16})"/.exec(html)?.[1] || ''
  const signature = /data-n-a-sg="([A-Za-z0-9_-]{10,200})"/.exec(html)?.[1] || ''
  if (!timestamp || !signature) return null
  return { timestamp, signature }
}

function batchBody(id: string, timestamp: string, signature: string) {
  const inner = JSON.stringify([
    'garturlreq',
    [
      ['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1],
      'X',
      'X',
      1,
      [1, 1, 1],
      1,
      1,
      null,
      0,
      0,
      null,
      0,
    ],
    id,
    Number(timestamp),
    signature,
  ])
  return new URLSearchParams({
    'f.req': JSON.stringify([[['Fbv4je', inner, null, 'generic']]]),
  }).toString()
}

function cool(id: string) {
  cooled.set(id, Date.now() + FAIL_FOR_MS)
  if (cooled.size <= 400) return
  const now = Date.now()
  for (const [key, until] of cooled) {
    if (until <= now) cooled.delete(key)
  }
}

async function resolvePublisher(id: string) {
  const until = cooled.get(id) || 0
  if (until > Date.now()) return ''
  try {
    const page = await fetch(`https://news.google.com/rss/articles/${id}`, {
      headers: { 'User-Agent': CHROME_UA, 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
    })
    if (!page.ok) {
      cool(id)
      return ''
    }
    const params = decodingParams((await page.text()).slice(0, 2_000_000))
    if (!params) {
      cool(id)
      return ''
    }
    const query = new URLSearchParams({
      rpcids: 'Fbv4je',
      'source-path': `/rss/articles/${id}`,
      hl: 'en-US',
      gl: 'US',
      ceid: 'US:en',
    })
    const response = await fetch(`https://news.google.com/_/DotsSplashUi/data/batchexecute?${query}`, {
      method: 'POST',
      headers: {
        'User-Agent': CHROME_UA,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: batchBody(id, params.timestamp, params.signature),
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
    })
    if (!response.ok) {
      cool(id)
      return ''
    }
    const publisher = publisherFromBatch((await response.text()).slice(0, 500_000))
    if (!publisher) cool(id)
    return publisher
  } catch {
    cool(id)
    return ''
  }
}

export function publisherUrl(value: unknown) {
  const id = googleArticleId(value)
  if (!id) return Promise.resolve('')
  const existing = inflight.get(id)
  if (existing) return existing
  const run = resolvePublisher(id).finally(() => {
    inflight.delete(id)
  })
  inflight.set(id, run)
  return run
}
