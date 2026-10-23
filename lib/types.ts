export type RoundCard = { source: string; headline: string; ethnicity: string }

export type QueueCard = RoundCard & { url: string }

export type LastResult = {
  score: number
  percentile: number
  ordinal: string
  plays: number
  counts: number[]
  userAnswers: string[]
  answers?: string[]
  stories?: { source: string; headline: string }[]
  roundKey: string
  roundDay?: string
}

export type SessionData = {
  userId: string
  stories: { source: string; headline: string }[]
  correctAnswers: string[]
  lastResult: LastResult | null
  playDay?: string
  plays?: Record<string, LastResult>
}

export type RumSummary = {
  views: number
  todayViews: number
  visitors: number
  todayVisitors: number
  finishes: number
  todayFinishes: number
  medianFinish: string
  mix: string
  vitals: string
  right: number
  asked: number
  pages: { label: string; count: number }[]
  recent: { time: string; kind: string; detail: string }[]
  errors: string[]
}
