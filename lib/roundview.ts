import { ETHNICITIES } from './constants'
import { HeadlineError } from './errors'
import { jobSnapshot } from './job'
import { ordinal, rankForScore } from './scoring'
import { currentRefreshTime, publishQueuedRound, readArchive, readRound, roundStats, type StoredRound } from './store'
import { localDateTimeISO, localISO, roundIsCurrent, roundLabel } from './time'
import type { LastResult, SessionData } from './types'

export function nextRoundAt() {
  const [hour, minute] = currentRefreshTime().split(':').map((part) => Number(part))
  const now = new Date()
  const target = new Date(now)
  target.setHours(hour, minute, 0, 0)
  const refreshed = readRound()?.refreshedOn || ''
  if (refreshed === localISO(now) || now >= target) target.setDate(target.getDate() + 1)
  return target
}

export function liveRound(now = new Date()) {
  publishQueuedRound(now)
  const round = readRound()
  if (!round?.cards.length) return null
  return roundIsCurrent(round.refreshedOn, now, currentRefreshTime()) ? round : null
}

export function roundContext(round: StoredRound | null = liveRound()) {
  const raw = round?.refreshedOn || localISO()
  const cards = round?.cards || []
  const labeled = roundLabel(raw)
  return {
    roundLabel: labeled.label,
    roundDay: labeled.roundDay,
    cardCount: cards.length,
    nextRoundIso: localDateTimeISO(nextRoundAt()),
  }
}

export function playableDay(value: unknown) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''
}

export function resultForDay(session: SessionData, day: string) {
  if (!day) return null
  const saved = session.plays?.[day]
  if (saved) return saved
  const last = session.lastResult
  if (!last) return null
  if (last.roundDay === day || last.roundKey.startsWith(`${day}:`)) return last
  return null
}

export function buildRound(day = '') {
  if (day) {
    const saved = readArchive(day)
    if (!saved?.cards.length) throw new HeadlineError('That day is not saved.')
    return saved.cards
  }
  const round = liveRound()
  const cards = round?.cards || []
  if (cards.length) return cards
  if (jobSnapshot().running) {
    throw new HeadlineError('Today’s round is still being prepared.')
  }
  if (round?.refreshedOn) {
    throw new HeadlineError('Today’s round has no confirmed headlines yet.')
  }
  throw new HeadlineError('Today’s round is not ready yet.')
}

export function todayPlay(session: SessionData) {
  const current = liveRound()
  const today = current?.refreshedOn || ''
  const result = today ? resultForDay(session, today) : null
  if (!current || !result || !today) return null
  const answers = result.answers?.length ? result.answers : session.correctAnswers
  const guesses = result.userAnswers || []
  if (!answers.length || guesses.length !== answers.length || answers.length !== current.cards.length) return null
  const total = answers.length
  const stats = roundStats(result.roundKey, result.score, total)
  const percentile = stats.plays ? stats.percentile : result.percentile
  const tier = rankForScore(result.score, total)
  if (stats.plays && percentile !== result.percentile) {
    result.percentile = percentile
    result.ordinal = ordinal(percentile)
    result.plays = stats.plays
    result.counts = stats.counts
  }
  return {
    score: result.score,
    total,
    title: tier.title,
    tierId: tier.id,
    marks: guesses.map((guess, index) => guess === answers[index]),
  }
}

export function presentResult(result: LastResult | null, fallbackTotal = 0): LastResult | null {
  if (!result?.roundKey) return result
  const total = result.answers?.length || fallbackTotal
  if (!total) return result
  const stats = roundStats(result.roundKey, result.score, total)
  if (!stats.plays) return result
  return {
    ...result,
    percentile: stats.percentile,
    ordinal: ordinal(stats.percentile),
    plays: stats.plays,
    counts: stats.counts,
  }
}

export function refreshResult(session: SessionData): LastResult | null {
  const result = session.lastResult
  const answers = result?.answers?.length ? result.answers : session.correctAnswers || []
  if (!result || !answers.length) return null
  return presentResult(result, answers.length)
}

export function hintText(headline: string, correctAnswer: string) {
  return `This is a hint for the headline: ${headline}\nThe correct answer is: ${correctAnswer}`
}

export { ETHNICITIES }
