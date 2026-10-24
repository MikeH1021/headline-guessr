export type DealCard = {
  source: string
  headline: string
  ethnicity: string
  url?: string
}

export function dealQueue<T extends { source: string; headline: string }>(queue: T[], size: number) {
  const order: string[] = []
  const groups = new Map<string, T[]>()
  for (const item of queue) {
    const bucket = groups.get(item.source)
    if (bucket) bucket.push(item)
    else {
      groups.set(item.source, [item])
      order.push(item.source)
    }
  }
  const dealt: T[] = []
  while (dealt.length < size && order.some((source) => (groups.get(source) || []).length)) {
    for (const source of order) {
      const group = groups.get(source) || []
      while (group.length) {
        const next = group.shift()
        if (!next) break
        if (dealt.some((card) => sameEvent(card.headline, next.headline))) continue
        dealt.push(next)
        break
      }
      if (dealt.length >= size) break
    }
  }
  const rest: T[] = []
  for (const source of order) rest.push(...(groups.get(source) || []))
  return { dealt, rest }
}

export function interleave<T extends { headline: string }>(groups: T[][], cap: number) {
  const mixed: T[] = []
  const seen = new Set<string>()
  while (mixed.length < cap && groups.some((group) => group.length)) {
    for (const group of groups) {
      if (!group.length) continue
      const story = group.shift()
      if (!story) continue
      const key = story.headline.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      mixed.push(story)
      if (mixed.length >= cap) break
    }
  }
  return mixed
}

const EVENT_STOP = new Set(
  'after also been being from have into just more near over police report reports said says than that them then they this were when will with your'.split(' '),
)

function eventTokens(value: string) {
  const tokens = value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').map((word) => {
    let token = word
    if (token.endsWith('ly') && token.length > 5) token = token.slice(0, -2)
    if (token.endsWith('ing') && token.length > 6) token = token.slice(0, -3)
    if (token.endsWith('ed') && token.length > 5) token = token.slice(0, -2)
    if (token.endsWith('s') && token.length > 4 && !token.endsWith('ss')) token = token.slice(0, -1)
    return token
  })
  return [...new Set(tokens.filter((token) => token.length >= 4 && !EVENT_STOP.has(token)))]
}

export function sameEvent(left: string, right: string) {
  const a = left.toLowerCase().replace(/\s+/g, ' ').trim()
  const b = right.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!a || !b) return false
  if (a === b) return true
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  if (shorter.length >= 8 && longer.includes(shorter)) return true
  const leftTokens = eventTokens(a)
  const rightTokens = new Set(eventTokens(b))
  if (leftTokens.length < 4 || rightTokens.size < 4) return false
  const shared = leftTokens.filter((token) => rightTokens.has(token)).length
  return shared >= 4 && shared / Math.min(leftTokens.length, rightTokens.size) >= 0.6
}
