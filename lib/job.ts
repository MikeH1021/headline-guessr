import { ROUND_SIZE } from './constants'
import { db } from './db'
import { localClock, localStamp } from './time'

export type JobEvent = { at: string; message: string; reasoning: string }

export type JobState = {
  running: boolean
  kept: number
  target: number
  error: string
  finishedAt: string
  events: JobEvent[]
}

function blank(): JobState {
  return { running: false, kept: 0, target: ROUND_SIZE, error: '', finishedAt: '', events: [] }
}

function slot() {
  const g = globalThis as unknown as { __hgJob?: JobState }
  if (!g.__hgJob) g.__hgJob = blank()
  return g.__hgJob
}

function persist() {
  const job = slot()
  db().prepare(
    `INSERT INTO job (id, running, kept, target, error, finished_at, events_json)
     VALUES (1, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       running = excluded.running,
       kept = excluded.kept,
       target = excluded.target,
       error = excluded.error,
       finished_at = excluded.finished_at,
       events_json = excluded.events_json`,
  ).run(job.running ? 1 : 0, job.kept, job.target, job.error, job.finishedAt, JSON.stringify(job.events))
}

export function jobSnapshot(): JobState {
  const job = slot()
  return {
    running: job.running,
    kept: job.kept,
    target: job.target,
    error: job.error,
    finishedAt: job.finishedAt,
    events: job.events.map((event) => ({ ...event })),
  }
}

export function jobLog(message: string, reasoning = '') {
  const job = slot()
  job.events.push({
    at: localClock(),
    message,
    reasoning: (reasoning || '').slice(0, 6000),
  })
  if (job.events.length > 300) job.events.splice(0, job.events.length - 300)
  persist()
}

export function jobSet(values: Partial<JobState>) {
  Object.assign(slot(), values)
  persist()
}

export function recoverJob() {
  const row = db().prepare(
    'SELECT running, kept, target, error, finished_at, events_json FROM job WHERE id = 1',
  ).get() as
    | { running: number; kept: number; target: number; error: string; finished_at: string; events_json: string }
    | undefined
  const job = slot()
  if (!row) return
  try {
    const events = JSON.parse(row.events_json) as JobEvent[]
    job.events = Array.isArray(events) ? events : []
  } catch {
    job.events = []
  }
  job.kept = Number(row.kept) || 0
  job.target = Number(row.target) || ROUND_SIZE
  job.running = false
  job.error = row.error || ''
  job.finishedAt = row.finished_at || ''
  if (row.running) {
    job.error = 'The last refresh stopped because the app restarted.'
    job.finishedAt = job.finishedAt || localStamp()
  }
  persist()
}

export function markRefreshStarted() {
  const job = slot()
  if (job.running) return false
  job.running = true
  job.kept = 0
  job.target = ROUND_SIZE
  job.error = ''
  job.finishedAt = ''
  job.events = []
  persist()
  return true
}

export function markRefreshFinished(error: string) {
  const job = slot()
  job.running = false
  job.error = error
  job.finishedAt = localStamp()
  persist()
}
