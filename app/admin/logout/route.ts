import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { ADMIN_COOKIE, adminCookie, destroyAdminSession, requestIsSecure, sameOrigin } from '@/lib/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const jar = await cookies()
  const id = jar.get(ADMIN_COOKIE)?.value || ''
  if (sameOrigin(request)) destroyAdminSession(id)
  const response = NextResponse.redirect(new URL('/admin/login', request.url), 303)
  response.cookies.set(ADMIN_COOKIE, '', { ...adminCookie(requestIsSecure(request)), maxAge: 0 })
  return response
}
