import { NextResponse } from 'next/server'
import {
  adminPasswordConfigured,
  adminPasswordOk,
  clearLoginFailures,
  createAdminSession,
  ADMIN_COOKIE,
  adminCookie,
  loginLocked,
  noteLoginFailure,
  requestIsSecure,
  sameOrigin,
} from '@/lib/admin-auth'
import { clientKey } from '@/lib/limit'
import { publicUrl } from '@/lib/public-url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function loginRedirect(request: Request, notice: string) {
  const url = publicUrl(request, '/admin/login')
  url.searchParams.set('notice', notice)
  return NextResponse.redirect(url, 303)
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return loginRedirect(request, 'Open this page and try again.')
  const ip = clientKey(request)
  if (loginLocked(ip)) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    return loginRedirect(request, 'Too many attempts. Wait 15 minutes.')
  }
  if (!adminPasswordConfigured()) return loginRedirect(request, 'Admin sign-in is not configured.')
  const form = await request.formData()
  const password = String(form.get('password') || '')
  if (!adminPasswordOk(password)) {
    noteLoginFailure(ip)
    await new Promise((resolve) => setTimeout(resolve, 500))
    return loginRedirect(request, 'That password is wrong.')
  }
  clearLoginFailures(ip)
  const response = NextResponse.redirect(publicUrl(request, '/admin'), 303)
  response.cookies.set(ADMIN_COOKIE, createAdminSession(), adminCookie(requestIsSecure(request)))
  return response
}
