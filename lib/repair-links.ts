import { FEED_SCAN } from './constants'
import { publisherUrl } from './google-news'
import { jobSnapshot } from './job'
import { storiesFrom } from './rss'
import { articleLink, articleUrls, rememberArticle } from './seen'
import { applyCardUrls, currentFeeds, metaValue, setMeta, type StoredRound } from './store'
import { articleHref, headlineKey, isGoogleNewsUrl, matchFeedUrl, preferArticleUrl } from './text'
import type { RoundCard } from './types'
import type { Feed } from './feeds'

const DECODE_AT_ONCE = 4

async function scanFeeds(cards: RoundCard[], feeds: Feed[]) {
  const found = new Map<string, string>()
  const pending = new Map(cards.map((card) => [headlineKey(card.headline), card.headline]))
  for (const feed of feeds) {
    if (!pending.size) break
    let stories: { headline: string; url: string }[] = []
    try {
      stories = await storiesFrom(feed, FEED_SCAN)
    } catch {
      continue
    }
    for (const [key, headline] of [...pending]) {
      const url = matchFeedUrl(headline, feed.name, feed.url, stories)
      if (!url) continue
      found.set(key, url)
      pending.delete(key)
      rememberArticle(headline, url)
    }
  }
  return found
}

function withUrls(round: StoredRound, urls: Map<string, string>) {
  return {
    ...round,
    cards: round.cards.map((card) => {
      const next = preferArticleUrl(card.url, urls.get(headlineKey(card.headline)) || '')
      return next ? { ...card, url: next } : card
    }),
  }
}

async function openPublishers(pending: { headline: string; url: string }[], found: Map<string, string>) {
  let index = 0
  async function worker() {
    while (index < pending.length) {
      const item = pending[index]
      index += 1
      const opened = await publisherUrl(item.url)
      if (!opened) continue
      found.set(headlineKey(item.headline), opened)
      rememberArticle(item.headline, opened)
    }
  }
  const workers = Math.min(DECODE_AT_ONCE, pending.length)
  if (!workers) return
  await Promise.all(Array.from({ length: workers }, () => worker()))
}

export async function repairRoundLinks(round: StoredRound | null) {
  if (!round?.cards.length) return round
  const blanks = round.cards.filter((card) => headlineKey(card.headline) && !articleHref(card.url))
  const googles = round.cards.filter((card) => isGoogleNewsUrl(card.url))
  if (!blanks.length && !googles.length) return round
  const found = new Map<string, string>()
  const remembered = articleUrls()
  for (const card of [...blanks, ...googles]) {
    const key = headlineKey(card.headline)
    const url = preferArticleUrl(articleLink(card.headline), remembered.get(key) || '')
    if (!url || isGoogleNewsUrl(url)) continue
    found.set(key, url)
    rememberArticle(card.headline, url)
  }
  let still = blanks.filter((card) => !found.has(headlineKey(card.headline)))
  const running = jobSnapshot().running
  if (still.length && !running) {
    const feeds = currentFeeds()
    const named = feeds.filter((feed) => still.some((card) => card.source.toLowerCase() === feed.name.toLowerCase()))
    if (named.length) {
      for (const [key, url] of await scanFeeds(still, named)) found.set(key, url)
      still = still.filter((card) => !found.has(headlineKey(card.headline)))
    }
    const unnamed = still.filter((card) => !feeds.some((feed) => feed.name.toLowerCase() === card.source.toLowerCase()))
    const stamp = `link_scan:${round.refreshedOn}`
    if (unnamed.length && metaValue(stamp) !== round.refreshedOn) {
      const namedIds = new Set(named.map((feed) => feed.url))
      for (const [key, url] of await scanFeeds(unnamed, feeds.filter((feed) => !namedIds.has(feed.url)))) found.set(key, url)
      setMeta(stamp, round.refreshedOn)
    }
  }
  if (!running) {
    const pending: { headline: string; url: string }[] = []
    const queued = new Set<string>()
    for (const card of googles) {
      const key = headlineKey(card.headline)
      if (!key || found.has(key) || queued.has(key)) continue
      const url = articleHref(card.url)
      if (!url) continue
      queued.add(key)
      pending.push({ headline: card.headline, url })
    }
    for (const [key, url] of found) {
      if (!isGoogleNewsUrl(url) || queued.has(key)) continue
      const card = round.cards.find((item) => headlineKey(item.headline) === key)
      if (!card) continue
      queued.add(key)
      pending.push({ headline: card.headline, url })
    }
    await openPublishers(pending, found)
  }
  const useful = new Map<string, string>()
  for (const card of round.cards) {
    const key = headlineKey(card.headline)
    const next = found.get(key) || ''
    if (!key || !next) continue
    if (preferArticleUrl(card.url, next) === articleHref(card.url)) continue
    useful.set(key, next)
  }
  if (!useful.size) return round
  if (running) return withUrls(round, useful)
  return applyCardUrls(round.refreshedOn, useful) || withUrls(round, useful)
}
