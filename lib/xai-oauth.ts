export const XAI_OAUTH_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828'
export const XAI_OAUTH_SCOPE = 'openid profile email offline_access grok-cli:access api:access'
export const XAI_OAUTH_DISCOVERY_URL = 'https://auth.x.ai/.well-known/openid-configuration'
export const XAI_OAUTH_DEVICE_URL = 'https://auth.x.ai/oauth2/device/code'

export type OauthTransport = {
  getJson(url: string): Promise<{ status: number; json: unknown }>
  postForm(url: string, body: URLSearchParams): Promise<{ status: number; json: unknown }>
}

export function xaiUrlProblem(value: string): '' | 'scheme' | 'host' | 'origin' {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'host'
  }
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'https:') return 'scheme'
  if (!host || url.username || url.password) return 'host'
  if (host !== 'x.ai' && !host.endsWith('.x.ai')) return 'origin'
  return ''
}

export function assertXaiUrl(value: string) {
  const problem = xaiUrlProblem(value)
  if (problem === '') return value
  throw new Error(`Refusing a Grok address that is not on x.ai (${problem}).`)
}

export function jwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const json = Buffer.from(part, 'base64url').toString('utf8')
    const parsed = JSON.parse(json) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

export function jwtExp(token: string) {
  const exp = jwtPayload(token)?.exp
  return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : 0
}

export function emailFromIdToken(token: string) {
  const email = jwtPayload(token)?.email
  if (typeof email !== 'string') return ''
  const clean = email.trim().slice(0, 80)
  return /^[^\s@]+@[^\s@]+$/.test(clean) ? clean : ''
}

export function tokenExpiring(accessToken: string, expiresAt: number, now = Date.now()) {
  const expiry = jwtExp(accessToken) || expiresAt
  if (!expiry) return false
  // Two minutes, not an hour. Device-code tokens often last about 15 minutes, and a
  // longer window would refresh on every call and burn the single-use refresh token.
  return expiry - now <= 120_000
}

export function safeOauthDetail(json: unknown, secret = '') {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return ''
  const record = json as Record<string, unknown>
  const text = String(record.error_description || record.error || '').replace(/\s+/g, ' ').trim().slice(0, 240)
  if (!text || (secret && text.includes(secret))) return ''
  return text
}

export function discoveryEndpoints(json: unknown) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('Grok sign-in discovery could not be read.')
  }
  const record = json as Record<string, unknown>
  const token = typeof record.token_endpoint === 'string' ? record.token_endpoint : ''
  const device = typeof record.device_authorization_endpoint === 'string' && record.device_authorization_endpoint
    ? record.device_authorization_endpoint
    : XAI_OAUTH_DEVICE_URL
  assertXaiUrl(token)
  assertXaiUrl(device)
  return { token, device }
}

export type DeviceChallenge = {
  deviceCode: string
  userCode: string
  verificationUrl: string
  expiresIn: number
  interval: number
}

export function deviceChallenge(json: unknown): DeviceChallenge {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('Grok did not return a sign-in code.')
  }
  const record = json as Record<string, unknown>
  const deviceCode = typeof record.device_code === 'string' ? record.device_code : ''
  const userCode = typeof record.user_code === 'string' ? record.user_code : ''
  const complete = typeof record.verification_uri_complete === 'string' ? record.verification_uri_complete : ''
  const plain = typeof record.verification_uri === 'string' ? record.verification_uri : ''
  const verificationUrl = complete || plain
  const expiresIn = Number(record.expires_in)
  const interval = Number(record.interval)
  if (!deviceCode || !userCode || !verificationUrl || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error('Grok did not return a sign-in code.')
  }
  assertXaiUrl(verificationUrl)
  return {
    deviceCode,
    userCode: userCode.slice(0, 40),
    verificationUrl,
    expiresIn,
    interval: Number.isFinite(interval) && interval > 0 ? Math.min(Math.max(interval, 5), 30) : 5,
  }
}

export function refreshGrant(json: unknown, fallbackRefresh = '') {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null
  const record = json as Record<string, unknown>
  const accessToken = typeof record.access_token === 'string' ? record.access_token : ''
  const rotated = typeof record.refresh_token === 'string' ? record.refresh_token.trim() : ''
  const refreshToken = rotated || fallbackRefresh
  const idToken = typeof record.id_token === 'string' ? record.id_token : ''
  const expiresIn = Number(record.expires_in)
  if (!accessToken || !refreshToken) return null
  return {
    accessToken,
    refreshToken,
    email: emailFromIdToken(idToken),
    expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 900,
  }
}

export function grantFromToken(json: unknown) {
  return refreshGrant(json)
}

export function devicePollKind(status: number, json: unknown): 'ok' | 'pending' | 'slow' | 'denied' | 'dead' {
  if (status === 200 && grantFromToken(json)) return 'ok'
  const error = json && typeof json === 'object' && !Array.isArray(json)
    ? String((json as Record<string, unknown>).error || '')
    : ''
  if (error === 'authorization_pending') return 'pending'
  if (error === 'slow_down') return 'slow'
  if (error === 'access_denied' || error === 'expired_token') return 'denied'
  if (status === 400 || status === 401) return 'dead'
  return 'denied'
}
