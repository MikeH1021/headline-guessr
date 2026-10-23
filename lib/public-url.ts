const BIND_HOST = /^(0\.0\.0\.0|127\.0\.0\.1|\[::1?\]|localhost)(:\d+)?$/i

function isBindHost(host: string) {
  return BIND_HOST.test(host)
}

function browserHost(request: Request) {
  const host = (request.headers.get('host') || '').split(',')[0].trim()
  if (host && !isBindHost(host)) return host
  const forwarded = (request.headers.get('x-forwarded-host') || '').split(',')[0].trim()
  if (forwarded && !isBindHost(forwarded)) return forwarded
  return ''
}

function configuredOrigin() {
  const value = (process.env.PUBLIC_ORIGIN || '').trim()
  if (!value) return ''
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
    return url.origin
  } catch {
    return ''
  }
}

function detectedOrigin(request: Request, host: string) {
  const origin = request.headers.get('origin')
  if (origin && host) {
    try {
      const url = new URL(origin)
      if (url.host === host) return url.origin
    } catch {
      /* A bad Origin header falls through to the host header. */
    }
  }
  const referer = request.headers.get('referer')
  if (referer && host) {
    try {
      const url = new URL(referer)
      if (url.host === host) return url.origin
    } catch {
      /* A bad Referer falls through to the host header. */
    }
  }
  if (!host) return 'http://127.0.0.1'
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  return `${forwarded === 'https' ? 'https' : 'http'}://${host}`
}

export function publicOrigin(request: Request) {
  const host = browserHost(request)
  const detected = detectedOrigin(request, host)
  const configured = configuredOrigin()
  if (!configured) return detected
  try {
    const wanted = new URL(configured).hostname
    const got = new URL(detected).hostname
    if (got === wanted || got === `www.${wanted}`) return new URL(detected).origin
  } catch {
    return configured
  }
  return configured
}

export function publicUrl(request: Request, path: string) {
  return new URL(path, publicOrigin(request))
}
