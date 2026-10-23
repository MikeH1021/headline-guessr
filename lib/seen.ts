import { db } from './db'
import { feedUrl } from './feeds'
import { headlineKey } from './text'

export function seenKeys(headline: string, url: string) {
  const keys: string[] = []
  const head = headlineKey(headline)
  if (head) keys.push(`h:${head}`)
  const clean = feedUrl(url)
  if (!clean) return keys
  try {
    const parsed = new URL(clean)
    parsed.hash = ''
    const path = parsed.pathname.replace(/\/+$/, '')
    keys.push(`u:${parsed.hostname.toLowerCase()}${path}${parsed.search}`)
  } catch {
    return keys
  }
  return keys
}

export function hasSeen(headline: string, url: string) {
  const keys = seenKeys(headline, url)
  if (!keys.length) return false
  const row = db().prepare(
    `SELECT key FROM seen WHERE key IN (${keys.map(() => '?').join(',')}) LIMIT 1`,
  ).get(...keys)
  return Boolean(row)
}

export function markSeen(headline: string, url: string, status: string) {
  const keys = seenKeys(headline, url)
  if (!keys.length) return
  const insert = db().prepare(
    `INSERT INTO seen (key, status, checked_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET status = excluded.status, checked_at = excluded.checked_at`,
  )
  const now = Date.now()
  for (const key of keys) insert.run(key, status.slice(0, 24), now)
}
