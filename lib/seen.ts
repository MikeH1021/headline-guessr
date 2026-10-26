import { db } from './db'
import { feedUrl } from './feeds'
import { articleHref, headlineKey, seenArticleUrl } from './text'

export function seenKeys(headline: string, url: string) {
  const keys: string[] = []
  const head = headlineKey(headline)
  if (head) keys.push(`h:${head}`)
  const clean = feedUrl(url) || seenArticleUrl(url)
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

export function seenStatuses(headline: string, url: string) {
  const keys = seenKeys(headline, url)
  if (!keys.length) return []
  return (
    db().prepare(
      `SELECT status FROM seen WHERE key IN (${keys.map(() => '?').join(',')})`,
    ).all(...keys) as { status: string }[]
  ).map((row) => row.status)
}

export function hasSeen(headline: string, url: string) {
  return seenStatuses(headline, url).length > 0
}

export function rememberArticle(headline: string, url: string) {
  const key = headlineKey(headline)
  const href = articleHref(url)
  if (!key || !href) return
  db().prepare(
    `INSERT INTO article_links (headline_key, url) VALUES (?, ?)
     ON CONFLICT(headline_key) DO UPDATE SET url = excluded.url`,
  ).run(key, href)
}

export function articleLink(headline: string) {
  const key = headlineKey(headline)
  if (!key) return ''
  const row = db().prepare('SELECT url FROM article_links WHERE headline_key = ?').get(key) as { url: string } | undefined
  return articleHref(row?.url)
}

export function articleUrls() {
  const found = new Map<string, string>()
  const rows = db().prepare(
    `SELECT key, checked_at, rowid AS ord
     FROM seen
     WHERE key LIKE 'h:%' OR key LIKE 'u:%'
     ORDER BY checked_at, rowid`,
  ).all() as { key: string; checked_at: number; ord: number }[]
  let index = 0
  while (index < rows.length) {
    const stamp = rows[index].checked_at
    const group: typeof rows = []
    while (index < rows.length && rows[index].checked_at === stamp) {
      group.push(rows[index])
      index += 1
    }
    if (group.length % 2 !== 0) continue
    const links: { head: string; url: string }[] = []
    let paired = true
    for (let pair = 0; pair < group.length; pair += 2) {
      const first = group[pair].key
      const second = group[pair + 1].key
      const head = first.startsWith('h:') ? first : second.startsWith('h:') ? second : ''
      const link = first.startsWith('u:') ? first : second.startsWith('u:') ? second : ''
      const href = link.startsWith('u:') ? articleHref(`https://${link.slice(2)}`) : ''
      if (!head || !href || first.slice(0, 2) === second.slice(0, 2)) {
        paired = false
        break
      }
      links.push({ head: head.slice(2), url: href })
    }
    if (!paired) continue
    for (const item of links) found.set(item.head, item.url)
  }
  return found
}

export function markSeen(headline: string, url: string, status: string) {
  rememberArticle(headline, url)
  const keys = seenKeys(headline, url)
  if (!keys.length) return
  const insert = db().prepare(
    `INSERT INTO seen (key, status, checked_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET status = excluded.status, checked_at = excluded.checked_at`,
  )
  const now = Date.now()
  for (const key of keys) insert.run(key, status.slice(0, 24), now)
}
