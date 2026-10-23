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
