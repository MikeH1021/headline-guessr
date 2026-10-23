const hits = new Map<string, number[]>()

export function tooMany(key: string, limit: number, windowMs: number) {
  const now = Date.now()
  const recent = (hits.get(key) || []).filter((at) => now - at < windowMs)
  if (recent.length >= limit) {
    hits.set(key, recent)
    return true
  }
  recent.push(now)
  hits.set(key, recent)
  if (hits.size > 5000) {
    for (const [name, times] of hits) {
      if (!times.some((at) => now - at < windowMs)) hits.delete(name)
    }
  }
  return false
}

export function clientKey(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || ''
  const real = request.headers.get('x-real-ip')?.trim() || ''
  const ip = (forwarded || real || 'local').slice(0, 80)
  return ip
}
