import { NextResponse } from 'next/server'
import { clientKey, tooMany } from '@/lib/limit'
import { recordRum } from '@/lib/rum'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const raw = await request.text()
  if (raw.length > 4000) return new NextResponse(null, { status: 204 })
  if (tooMany(`rum:${clientKey(request)}`, 40, 60_000) || tooMany('rum:all', 400, 60_000)) {
    return new NextResponse(null, { status: 204 })
  }
  try {
    recordRum(JSON.parse(raw), request.headers.get('user-agent') || '')
  } catch {
    /* Ignore a bad beacon. The page should not hear about it. */
  }
  return new NextResponse(null, { status: 204 })
}
