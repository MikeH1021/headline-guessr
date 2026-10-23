import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { ETHNICITIES } from '@/lib/constants'
import { clientKey, tooMany } from '@/lib/limit'
import { ordinal } from '@/lib/scoring'
import { loadSession, recordPercentile, saveSession } from '@/lib/store'
import { publicUrl } from '@/lib/public-url'
import { SESSION_COOKIE } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const jar = await cookies()
  const id = jar.get(SESSION_COOKIE)?.value || ''
  const session = id ? loadSession(id) : null
  const form = await request.formData()
  const answers = form.getAll('answer').map((value) => String(value))
  const allowed = new Set<string>(ETHNICITIES)
  const correct = session?.correctAnswers || []
  if (!session || !id || !correct.length || answers.length !== correct.length || answers.some((guess) => !allowed.has(guess))) {
    return NextResponse.redirect(publicUrl(request, '/game'), 303)
  }
  if (tooMany(`play:${id}`, 8, 10 * 60 * 1000) || tooMany(`play:${clientKey(request)}`, 300, 10 * 60 * 1000)) {
    return NextResponse.redirect(publicUrl(request, '/game'), 303)
  }
  const score = answers.reduce((sum, guess, index) => sum + (guess === correct[index] ? 1 : 0), 0)
  const recorded = recordPercentile(score, correct.length, id)
  session.lastResult = {
    score,
    percentile: recorded.percentile,
    ordinal: ordinal(recorded.percentile),
    plays: recorded.plays,
    counts: recorded.counts,
    userAnswers: answers,
    roundKey: recorded.roundKey,
  }
  saveSession(id, session)
  return NextResponse.redirect(publicUrl(request, '/results'), 303)
}
