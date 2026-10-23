import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { ADMIN_COOKIE, adminSessionValid } from '@/lib/admin-auth'
import { jobSnapshot } from '@/lib/job'
import { rumPublic } from '@/lib/rum'
import { queuePublic, readQueue, readRound } from '@/lib/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const jar = await cookies()
  if (!adminSessionValid(jar.get(ADMIN_COOKIE)?.value || '')) {
    return NextResponse.json({ error: 'Sign in.' }, { status: 401 })
  }
  const job = jobSnapshot()
  const round = readRound()
  const cards = round?.cards || []
  const queue = queuePublic(readQueue())
  return NextResponse.json({
    running: job.running,
    kept: job.kept,
    target: job.target,
    error: job.error,
    finished_at: job.finishedAt,
    events: job.events,
    refreshed_at: round?.refreshedAt || '',
    ready: cards.length,
    cards,
    queued: queue.length,
    queue,
    rum: rumPublic(),
  })
}
