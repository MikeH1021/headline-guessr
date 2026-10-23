import { ETHNICITIES } from './constants'
import { HeadlineError } from './errors'
import { jobSnapshot } from './job'
import { ordinal, rankForScore } from './scoring'
import { currentRefreshTime, readRound, roundKey, roundStats, type StoredRound } from './store'
import { localDateTimeISO, localISO, roundLabel } from './time'
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

export function roundContext(round: StoredRound | null = readRound()) {
  const raw = round?.refreshedOn || ''
  const cards = round?.cards || []
  const labeled = raw ? roundLabel(raw) : { label: '', roundDay: '' }
  return {
    roundLabel: labeled.label,
    roundDay: labeled.roundDay,
    cardCount: cards.length,
    nextRoundIso: localDateTimeISO(nextRoundAt()),
  }
}

export function buildRound() {
  const round = readRound()
  const cards = round?.cards || []
  if (cards.length) return cards
  if (jobSnapshot().running) {
    throw new HeadlineError('The daily refresh is still classifying articles. Watch the progress on the admin page.')
  }
  if (round?.refreshedOn) {
    throw new HeadlineError('Today\'s refresh finished, and none of the articles stated an ethnicity. Change the prompt or run a debug refresh.')
  }
  throw new HeadlineError('The daily round is not ready. Set the refresh time on the admin page, or run a debug refresh.')
}

export function todayPlay(session: SessionData) {
  const result = session.lastResult
  const answers = session.correctAnswers || []
  const guesses = result?.userAnswers || []
  if (!result || !answers.length || guesses.length !== answers.length) return null
  if (result.roundKey !== roundKey(answers.length)) return null
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

export function refreshResult(session: SessionData): LastResult | null {
  const result = session.lastResult
  const answers = session.correctAnswers || []
  if (!result || !answers.length) return null
  const total = answers.length
  const key = result.roundKey || roundKey(total)
  const stats = roundStats(key, result.score, total)
  if (!stats.plays) return { ...result, roundKey: key }
  return {
    ...result,
    roundKey: key,
    percentile: stats.percentile,
    ordinal: ordinal(stats.percentile),
    plays: stats.plays,
    counts: stats.counts,
  }
}

export function hintText(headline: string, correctAnswer: string) {
  return `This is a hint for the headline: ${headline}\nThe correct answer is: ${correctAnswer}`
}

export { ETHNICITIES }
