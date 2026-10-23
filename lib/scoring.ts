import { TIERS } from './constants'

export type Tier = { id: string; title: string; line: string }

/** Python 3 round(): halves go to the even integer. */
export function pythonRound(value: number) {
  if (!Number.isFinite(value)) return 0
  const sign = value < 0 ? -1 : 1
  const abs = Math.abs(value)
  const floor = Math.floor(abs)
  const frac = abs - floor
  if (Math.abs(frac - 0.5) < 1e-10) return sign * (floor % 2 === 0 ? floor : floor + 1)
  if (frac > 0.5) return sign * (floor + 1)
  return sign * floor
}

export function ordinal(number: number) {
  const value = Math.trunc(number)
  const mod100 = value % 100
  let suffix = 'th'
  if (mod100 < 10 || mod100 > 20) {
    suffix = ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[value % 10] || 'th'
  }
  return `${value}${suffix}`
}

export function rankTier(percentile: number): Tier {
  let value = Number.isFinite(percentile) ? Math.trunc(percentile) : 1
  if (value < 1) value = 1
  if (value > 100) value = 100
  for (const [ceiling, id, title, line] of TIERS) {
    if (value <= ceiling) return { id, title, line }
  }
  const last = TIERS[TIERS.length - 1]
  return { id: last[1], title: last[2], line: last[3] }
}

export function rankLadder(): Tier[] {
  return [...TIERS].reverse().map(([, id, title, line]) => ({ id, title, line }))
}

export function accuracyPercentile(score: number, total: number) {
  const cards = Math.trunc(total)
  if (cards <= 0) return 1
  let pct = pythonRound((100 * Math.trunc(score)) / cards)
  if (pct < 1) return 1
  if (pct > 100) return 100
  return pct
}

export function percentileRank(score: number, sample: number[], total: number) {
  const value = Math.trunc(score)
  const values = sample.map((item) => Math.trunc(item))
  const accuracy = accuracyPercentile(value, total)
  if (values.length <= 1) return accuracy
  const better = values.filter((item) => item > value).length
  const worse = values.filter((item) => item < value).length
  if (better === 0 && worse === 0) return accuracy
  let standing = 100
  if (better !== 0) {
    standing = pythonRound((100 * worse) / values.length)
    if (standing < 1) standing = 1
    if (standing > 100) standing = 100
  }
  if (standing > accuracy) return accuracy
  return standing
}

export function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

export function msLabel(value: number) {
  const rounded = pythonRound(value)
  if (rounded < 1000) return `${rounded} ms`
  return `${(rounded / 1000).toFixed(1)} s`
}

export function paceLabel(value: number) {
  const total = Math.max(1, pythonRound(value / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes <= 0) return `${seconds}s`
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}
