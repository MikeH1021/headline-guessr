import crypto from 'crypto'
import { DEFAULT_ETHNICITY_PROMPT, DEFAULT_REFRESH_TIME, MAX_FEEDS, MODEL_IDS, QUEUE_CAP, ROUND_SIZE, SCORE_CAP } from './constants'
import { db } from './db'
import { dealQueue } from './deal'
import { canonicalEthnicity } from './ethnicity'
import { defaultFeeds, feedName, feedUrl, parseFeeds, publicFeedUrl, validRefreshTime, type Feed } from './feeds'
import { percentileRank } from './scoring'
import { cleanTitle } from './text'
import { localISO } from './time'
import type { LastResult, QueueCard, RoundCard, SessionData } from './types'

type SettingsRow = {
  model: string
  prompt: string
  refresh_time: string
  feeds_json: string | null
}

function settingsRow() {
  return db().prepare('SELECT model, prompt, refresh_time, feeds_json FROM settings WHERE id = 1').get() as SettingsRow
}

export function currentModel() {
  const saved = settingsRow().model
  return MODEL_IDS.has(saved) ? saved : 'grok-4.7'
}

export function currentPrompt() {
  const saved = settingsRow().prompt
  return saved.trim() ? saved : DEFAULT_ETHNICITY_PROMPT
}

export function currentRefreshTime() {
  const saved = settingsRow().refresh_time
  return validRefreshTime(saved) ? saved : DEFAULT_REFRESH_TIME
}

export function currentFeeds(): Feed[] {
  const saved = settingsRow().feeds_json
  if (!saved) return defaultFeeds()
  try {
    const parsed = parseFeeds(JSON.parse(saved))
    return parsed.length ? parsed : defaultFeeds()
  } catch {
    return defaultFeeds()
  }
}

function writeSettings(model: string, prompt: string, refreshTime: string, feeds: Feed[] | null) {
  db().prepare(
    'UPDATE settings SET model = ?, prompt = ?, refresh_time = ?, feeds_json = ? WHERE id = 1',
  ).run(model, prompt, refreshTime, feeds ? JSON.stringify(feeds.map(({ name, url }) => ({ name, url }))) : null)
}

export function saveSettings(modelId: string, prompt: string, refreshTime: string) {
  const feeds = settingsRow().feeds_json
  db().prepare('UPDATE settings SET model = ?, prompt = ?, refresh_time = ? WHERE id = 1').run(modelId, prompt, refreshTime)
  void feeds
}

export function addFeed(name: string, url: string) {
  const cleanName = feedName(name)
  const cleanUrl = publicFeedUrl(url)
  if (!cleanName || !feedUrl(url)) return 'Enter a name and an http or https RSS URL.'
  if (!cleanUrl) return 'Use a public http or https RSS URL.'
  const feeds = currentFeeds()
  if (feeds.some((item) => item.url === cleanUrl)) return 'That feed is already on the list.'
  if (feeds.length >= MAX_FEEDS) return `The list already has ${MAX_FEEDS} feeds.`
  feeds.push({ name: cleanName, url: cleanUrl, kind: 'rss' })
  const row = settingsRow()
  writeSettings(row.model, row.prompt, row.refresh_time, feeds)
  return `Added ${cleanName}. The next refresh reads it.`
}

export function removeFeed(url: string) {
  const target = feedUrl(url)
  const feeds = currentFeeds()
  const kept = feeds.filter((item) => item.url !== target)
  if (kept.length === feeds.length) return 'That feed is not on the list.'
  if (!kept.length) return 'Keep at least one feed.'
  const row = settingsRow()
  writeSettings(row.model, row.prompt, row.refresh_time, kept)
  return 'Removed the feed. The next refresh skips it.'
}

export type StoredRound = { refreshedOn: string; refreshedAt: string; cards: RoundCard[] }

export function readRound(): StoredRound | null {
  const row = db().prepare('SELECT refreshed_on, refreshed_at, cards_json FROM rounds WHERE id = 1').get() as
    | { refreshed_on: string; refreshed_at: string; cards_json: string }
    | undefined
  if (!row) return null
  let cards: RoundCard[] = []
  try {
    const parsed = JSON.parse(row.cards_json) as unknown
    if (Array.isArray(parsed)) {
      cards = parsed.filter((item): item is RoundCard => {
        if (!item || typeof item !== 'object') return false
        const card = item as RoundCard
        return Boolean(card.source && card.headline && card.ethnicity)
      })
    }
  } catch {
    cards = []
  }
  return { refreshedOn: row.refreshed_on, refreshedAt: row.refreshed_at, cards }
}

export function saveRound(cards: RoundCard[], when = new Date()) {
  const payload = JSON.stringify(cards.map((card) => ({
    source: card.source,
    headline: card.headline,
    ethnicity: card.ethnicity,
  })))
  const refreshedOn = localISO(when)
  const refreshedAt = `${refreshedOn} ${[when.getHours(), when.getMinutes(), when.getSeconds()].map((part) => String(part).padStart(2, '0')).join(':')}`
  db().prepare(
    `INSERT INTO rounds (id, refreshed_on, refreshed_at, cards_json) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET refreshed_on = excluded.refreshed_on, refreshed_at = excluded.refreshed_at, cards_json = excluded.cards_json`,
  ).run(refreshedOn, refreshedAt, payload)
}

function queueKey(headline: string) {
  return headline.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 240)
}

export function readQueue(): QueueCard[] {
  const rows = db().prepare(
    'SELECT source, headline, ethnicity, url FROM queue ORDER BY position ASC',
  ).all() as QueueCard[]
  const clean: QueueCard[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const source = feedName(row.source)
    const headline = cleanTitle(row.headline)
    const ethnicity = canonicalEthnicity(row.ethnicity)
    const key = queueKey(headline)
    if (!source || !headline || !ethnicity || !key || seen.has(key)) continue
    seen.add(key)
    clean.push({ source, headline, ethnicity, url: row.url || '' })
  }
  return clean.slice(0, QUEUE_CAP)
}

function replaceQueue(rows: QueueCard[]) {
  const database = db()
  database.prepare('DELETE FROM queue').run()
  const insert = database.prepare(
    'INSERT INTO queue (position, source, headline, ethnicity, url) VALUES (?, ?, ?, ?, ?)',
  )
  rows.slice(0, QUEUE_CAP).forEach((row, index) => {
    insert.run(index + 1, row.source, row.headline, row.ethnicity, row.url || '')
  })
}

export function queuePublic(rows: QueueCard[]) {
  return rows.map((item) => ({
    source: item.source,
    headline: item.headline,
    ethnicity: item.ethnicity,
    key: queueKey(item.headline),
  }))
}

export function appendQueue(card: { source: string; headline: string; ethnicity: string; url?: string }) {
  const key = queueKey(card.headline)
  const ethnicity = canonicalEthnicity(card.ethnicity)
  if (!key || !ethnicity) return { length: readQueue().length, added: false }
  return db().transaction(() => {
    const queue = readQueue()
    if (queue.some((item) => queueKey(item.headline) === key)) return { length: queue.length, added: false }
    queue.push({
      source: card.source,
      headline: card.headline,
      ethnicity,
      url: card.url || '',
    })
    const capped = queue.length > QUEUE_CAP ? queue.slice(-QUEUE_CAP) : queue
    replaceQueue(capped)
    return { length: capped.length, added: true }
  })()
}

export function takeRound() {
  return db().transaction(() => {
    const queue = readQueue()
    const { dealt, rest } = dealQueue(queue, ROUND_SIZE)
    replaceQueue(rest)
    return { dealt, rest }
  })()
}

export function dropQueued(key: string, running: boolean) {
  if (running) return 'A refresh is running. The queue can be edited when it finishes.'
  const wanted = (key || '').trim().toLowerCase()
  return db().transaction(() => {
    const queue = readQueue()
    const kept = queue.filter((item) => queueKey(item.headline) !== wanted)
    if (kept.length === queue.length) return 'That article is not in the queue.'
    replaceQueue(kept)
    return 'Removed from the queue.'
  })()
}

export function roundKey(total: number) {
  const round = readRound()
  const day = round?.refreshedOn || localISO()
  return `${day}:${Math.trunc(total)}`
}

export type RoundStats = { percentile: number; plays: number; counts: number[] }

export function roundStats(key: string, score: number, total: number): RoundStats {
  const rows = db().prepare('SELECT score FROM scores WHERE round_key = ?').all(key) as { score: number }[]
  const sample = rows.map((row) => row.score)
  const counts = Array.from({ length: total + 1 }, () => 0)
  for (const value of sample) {
    if (value >= 0 && value <= total) counts[value] += 1
  }
  return { percentile: percentileRank(score, sample, total), plays: sample.length, counts }
}

export function recordPercentile(score: number, total: number, sessionId: string) {
  const key = roundKey(total)
  const value = Math.max(0, Math.min(Math.trunc(score), Math.trunc(total)))
  const who = (sessionId || '').slice(0, 80)
  const database = db()
  database.transaction(() => {
    const existing = who
      ? database.prepare('SELECT id FROM scores WHERE round_key = ? AND session_id = ?').get(key, who) as
          | { id: number }
          | undefined
      : undefined
    if (existing) {
      database.prepare('UPDATE scores SET score = ?, created_at = ? WHERE id = ?').run(value, Date.now(), existing.id)
      return
    }
    database.prepare(
      'INSERT INTO scores (round_key, score, created_at, session_id) VALUES (?, ?, ?, ?)',
    ).run(key, value, Date.now(), who)
    const count = database.prepare('SELECT COUNT(*) AS n FROM scores').get() as { n: number }
    if (count.n > SCORE_CAP) {
      database.prepare(
        'DELETE FROM scores WHERE id IN (SELECT id FROM scores ORDER BY id ASC LIMIT ?)',
      ).run(count.n - SCORE_CAP)
    }
  })()
  return { ...roundStats(key, value, total), roundKey: key, score: value }
}

const emptySession = (): SessionData => ({
  userId: String(1000 + Math.floor(Math.random() * 9000)),
  stories: [],
  correctAnswers: [],
  lastResult: null,
})

export function loadSession(id: string): SessionData | null {
  if (!id) return null
  const row = db().prepare('SELECT payload_json FROM sessions WHERE id = ?').get(id) as
    | { payload_json: string }
    | undefined
  if (!row) return null
  try {
    const parsed = JSON.parse(row.payload_json) as SessionData
    if (!parsed || typeof parsed !== 'object') return null
    return {
      userId: typeof parsed.userId === 'string' ? parsed.userId : emptySession().userId,
      stories: Array.isArray(parsed.stories) ? parsed.stories : [],
      correctAnswers: Array.isArray(parsed.correctAnswers) ? parsed.correctAnswers : [],
      lastResult: parsed.lastResult && typeof parsed.lastResult === 'object' ? parsed.lastResult as LastResult : null,
    }
  } catch {
    return null
  }
}

export function saveSession(id: string, data: SessionData) {
  db().prepare(
    `INSERT INTO sessions (id, payload_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
  ).run(id, JSON.stringify(data), Date.now())
  if (Math.random() < 0.02) {
    db().prepare('DELETE FROM sessions WHERE updated_at < ?').run(Date.now() - 14 * 24 * 60 * 60 * 1000)
  }
}

export function newSessionId() {
  return crypto.randomBytes(24).toString('base64url')
}
