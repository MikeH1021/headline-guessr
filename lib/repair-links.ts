import { FEED_SCAN } from './constants'
import { jobSnapshot } from './job'
import { storiesFrom } from './rss'
import { articleLink, articleUrls, rememberArticle } from './seen'
import { applyCardUrls, currentFeeds, metaValue, setMeta, type StoredRound } from './store'
import { articleHref, headlineKey, matchFeedUrl } from './text'
import type { RoundCard } from './types'
import type { Feed } from './feeds'

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
      const url = urls.get(headlineKey(card.headline))
      return url && !articleHref(card.url) ? { ...card, url } : card
    }),
  }
}

export async function repairRoundLinks(round: StoredRound | null) {
  if (!round?.cards.length) return round
  const missing = round.cards.filter((card) => headlineKey(card.headline) && !articleHref(card.url))
  if (!missing.length) return round
  const found = new Map<string, string>()
  const remembered = articleUrls()
  for (const card of missing) {
    const key = headlineKey(card.headline)
    const url = articleLink(card.headline) || remembered.get(key) || ''
    if (!url) continue
    found.set(key, url)
    rememberArticle(card.headline, url)
  }
  let still = missing.filter((card) => !found.has(headlineKey(card.headline)))
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
  if (!found.size) return round
  if (running) return withUrls(round, found)
  return applyCardUrls(round.refreshedOn, found) || withUrls(round, found)
}
