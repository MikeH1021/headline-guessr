import { feedName } from './feeds'

export function unescapeHtml(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, digits: string) => {
      const code = Number(digits)
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : _
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, digits: string) => {
      const code = parseInt(digits, 16)
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : _
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
}

export function headlineKey(headline: string) {
  return headline.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 240)
}

export function seenArticleUrl(value: unknown) {
  if (typeof value !== 'string') return ''
  const raw = value.trim()
  if (raw.length <= 300 || raw.length > 4000 || !/^https?:\/\/\S+$/.test(raw)) return ''
  try {
    const parsed = new URL(raw)
    if (parsed.username || parsed.password) return ''
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    return raw
  } catch {
    return ''
  }
}

export function chargeFirst<T extends { headline: string }>(stories: T[]) {
  const charges: T[] = []
  const rest: T[] = []
  for (const story of stories) {
    if (chargeHeadline(story.headline)) charges.push(story)
    else rest.push(story)
  }
  return charges.length && rest.length ? [...charges, ...rest] : stories
}

export function chargedStory(source: string, headline: string, google = false) {
  if (!google && source !== 'Charged') return { source, headline }
  const match = /^(.*\S)\s+[-–—|]\s+([^|–—\n-]{2,40})$/.exec(headline.trim())
  if (!match) return { source, headline }
  const title = match[1].trim()
  const name = feedName(match[2])
  if (!name || title.length < 16) return { source, headline }
  return { source: name, headline: title }
}

export function chargeHeadline(headline: string) {
  const text = headline.replace(/\s+/g, ' ').trim()
  if (!text || /\b(sentenced|lawsuit|appeal|appeals|verdict|retrial)\b/i.test(text)) return false
  return /\b(charged|charges|arrested|accused|in custody)\b/i.test(text)
}

export function cleanTitle(raw: string) {
  const title = unescapeHtml(String(raw || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
  if (!title || title.startsWith("'") || title.startsWith('+') || title.startsWith('{') || title.includes('function')) {
    return ''
  }
  return title
}

export function plainText(raw: string) {
  return unescapeHtml(String(raw || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

export function articleHref(value: unknown) {
  if (typeof value !== 'string') return ''
  const raw = value.trim()
  if (!raw || raw.length > 4000 || !/^https?:\/\/\S+$/.test(raw)) return ''
  try {
    const parsed = new URL(raw)
    if (parsed.username || parsed.password) return ''
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    return parsed.href
  } catch {
    return ''
  }
}

export function articleHost(href: string) {
  try {
    const host = new URL(href).hostname.replace(/^www\./, '')
    if (!host || host === 'news.google.com') return ''
    return host
  } catch {
    return ''
  }
}

export function storyUrl(url: string, base: string) {
  let value = unescapeHtml((url || '').trim())
  if (value.startsWith('//')) value = `https:${value}`
  else if (value.startsWith('/')) value = base + value
  if (!value.startsWith('http')) return ''
  return value.split('#')[0]
}

export function isBanner(headline: string) {
  return headline.length > 0 && headline === headline.toUpperCase() && /[A-Z]/.test(headline)
}
