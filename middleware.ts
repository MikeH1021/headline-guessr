import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

function randomId() {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers)
  headers.set('x-pathname', request.nextUrl.pathname)
  const day = request.nextUrl.searchParams.get('day') || ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) headers.set('x-round-day', day)
  const existing = request.cookies.get('hg')?.value || ''
  const id = existing || randomId()
  headers.set('x-session', id)
  const response = NextResponse.next({ request: { headers } })
  if (!existing) {
    response.cookies.set('hg', id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
      secure: request.nextUrl.protocol === 'https:',
    })
  }
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
}
