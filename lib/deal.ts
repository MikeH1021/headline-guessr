export type DealCard = {
  source: string
  headline: string
  ethnicity: string
  url?: string
}

export function dealQueue<T extends { source: string }>(queue: T[], size: number) {
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
      if (!group.length) continue
      const next = group.shift()
      if (next) dealt.push(next)
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

export function sameEvent(left: string, right: string) {
  if (left === right) return true
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left]
  return shorter.length >= 8 && longer.includes(shorter)
}
