import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { ADMIN_COOKIE, adminSessionValid } from '@/lib/admin-auth'
import { pollPending } from '@/lib/xai-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const jar = await cookies()
  if (!adminSessionValid(jar.get(ADMIN_COOKIE)?.value || '')) {
    return NextResponse.json({ error: 'Sign in.' }, { status: 401 })
  }
  const status = await pollPending()
  return NextResponse.json(status)
}
