import { XAI_URL } from './constants'
import { HeadlineError } from './errors'
import { loadEnv } from './env'
import { currentModel } from './store'

type Json = null | string | number | boolean | Json[] | { [key: string]: Json }

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function grokBody(modelId: string, instructions: string, schemaName: string, schema: unknown, tools?: unknown[]) {
  const body: Record<string, unknown> = {
    model: modelId,
    input: instructions,
    text: {
      format: {
        type: 'json_schema',
        name: schemaName,
        strict: true,
        schema,
      },
    },
  }
  if (tools) body.tools = tools
  if (modelId === 'grok-4.7' || modelId === 'grok-4.6' || modelId === 'grok-4.5') {
    body.reasoning = { effort: 'low' }
  }
  return body
}

function responseText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === 'string') return payload.output_text
  const output = Array.isArray(payload.output) ? payload.output : []
  for (const item of output) {
    const record = asRecord(item)
    if (!record || record.type !== 'message') continue
    const content = Array.isArray(record.content) ? record.content : []
    for (const part of content) {
      const piece = asRecord(part)
      if (piece && piece.type === 'output_text' && typeof piece.text === 'string' && piece.text) return piece.text
    }
  }
  return ''
}

function searchNotes(payload: Record<string, unknown>) {
  const lines: string[] = []
  const output = Array.isArray(payload.output) ? payload.output : []
  for (const item of output) {
    const record = asRecord(item)
    if (!record) continue
    const kind = String(record.type || '')
    const name = String(record.name || '')
    if (!kind.includes('search') && !name.includes('search')) continue
    const action = asRecord(record.action) || {}
    let query: unknown = action.query || record.query || record.arguments || record.input || ''
    if (query && typeof query === 'object') query = JSON.stringify(query)
    const text = String(query || '').trim()
    if (text) lines.push(`Search: ${text.slice(0, 400)}`)
    const urls: string[] = []
    const sources = Array.isArray(action.sources) ? action.sources : []
    for (const source of sources) {
      if (typeof source === 'string') urls.push(source)
      else {
        const row = asRecord(source)
        if (row && typeof row.url === 'string') urls.push(row.url)
      }
    }
    if (urls.length) lines.push(`Sources: ${urls.slice(0, 6).join(', ')}`)
  }
  const citations = Array.isArray(payload.citations) ? payload.citations : []
  if (citations.length) lines.push(`Sources: ${citations.slice(0, 8).map((url) => String(url)).join(', ')}`)
  return lines.join('\n')
}

function reasoningText(payload: Record<string, unknown>) {
  const chunks: string[] = []
  const output = Array.isArray(payload.output) ? payload.output : []
  for (const item of output) {
    const record = asRecord(item)
    if (!record || record.type !== 'reasoning') continue
    const summary = record.summary
    if (typeof summary === 'string' && summary.trim()) chunks.push(summary.trim())
    else if (Array.isArray(summary)) {
      for (const part of summary) {
        if (typeof part === 'string' && part.trim()) chunks.push(part.trim())
        else {
          const piece = asRecord(part)
          if (piece && piece.text) chunks.push(String(piece.text).trim())
        }
      }
    }
  }
  const searches = searchNotes(payload)
  if (searches) chunks.push(searches)
  return chunks.filter(Boolean).join('\n\n').slice(0, 6000)
}

export async function grok(instructions: string, schemaName: string, schema: unknown, step = 'the request', tools?: unknown[]) {
  loadEnv()
  const apiKey = (process.env.XAI_API_KEY || '').trim()
  if (!apiKey) {
    throw new HeadlineError('Add your xAI API key as XAI_API_KEY in a .env file in this folder, then restart the app.')
  }
  let response: Response
  try {
    response = await fetch(XAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(grokBody(currentModel(), instructions, schemaName, schema, tools)),
      signal: AbortSignal.timeout(240_000),
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new HeadlineError(`Grok took too long during ${step}.`)
    }
    throw new HeadlineError(`Grok could not be reached during ${step}.`)
  }
  if (!response.ok) throw new HeadlineError(`Grok could not complete ${step} (HTTP ${response.status}).`)
  let raw: Record<string, unknown>
  try {
    raw = await response.json() as Record<string, unknown>
  } catch {
    throw new HeadlineError('Grok returned a result that could not be read.')
  }
  let parsed: Json
  try {
    parsed = JSON.parse(responseText(raw)) as Json
  } catch {
    throw new HeadlineError('Grok returned a result that could not be read.')
  }
  return { parsed, reasoning: reasoningText(raw) }
}
