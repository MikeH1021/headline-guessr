import { DEFAULT_FEEDS, MAX_FEEDS } from './constants'

export type Feed = { name: string; url: string; kind: 'rss' | 'cnn' | 'nbc' }

export function feedName(value: unknown) {
  if (typeof value !== 'string') return ''
  const name = value.replace(/\s+/g, ' ').trim()
  if (!name || name.length > 40 || !/[A-Za-z0-9]/.test(name)) return ''
  return name
}

export function feedUrl(value: unknown) {
  if (typeof value !== 'string') return ''
  const url = value.trim()
  if (url.length > 300 || !/^https?:\/\/\S+$/.test(url)) return ''
  return url
}

export function isPrivateHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (host.includes(':')) return true
  const parts = host.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return false
  const nums = parts.map((part) => Number(part))
  if (nums.some((part) => part > 255)) return false
  const [a, b] = nums
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

export function publicFeedUrl(value: unknown) {
  const url = feedUrl(value)
  if (!url) return ''
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return ''
  }
  if (parsed.username || parsed.password) return ''
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
  if (isPrivateHost(parsed.hostname)) return ''
  return url
}

export function validRefreshTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

export function parseFeeds(saved: unknown): Feed[] {
  if (!Array.isArray(saved)) return []
  const feeds: Feed[] = []
  const seen = new Set<string>()
  for (const item of saved) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const name = feedName(record.name)
    const url = feedUrl(record.url)
    if (!name || !url || seen.has(url)) continue
    seen.add(url)
    feeds.push({ name, url, kind: 'rss' })
    if (feeds.length >= MAX_FEEDS) break
  }
  return feeds
}

export function defaultFeeds(): Feed[] {
  return DEFAULT_FEEDS.map(([name, url]) => ({ name, url, kind: 'rss' as const }))
}
