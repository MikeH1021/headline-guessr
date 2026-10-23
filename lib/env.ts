import fs from 'fs'
import path from 'path'

function applyFile(file: string) {
  if (!fs.existsSync(file)) return
  const text = fs.readFileSync(file, 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const index = trimmed.indexOf('=')
    const key = trimmed.slice(0, index).trim()
    let value = trimmed.slice(index + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key && process.env[key] === undefined) process.env[key] = value
  }
}

export function loadEnv() {
  const files = [process.env.ENV_FILE, path.join(process.cwd(), '.env'), '/app/.env'].filter(
    (file): file is string => Boolean(file),
  )
  for (const file of files) applyFile(file)
}
