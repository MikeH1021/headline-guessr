import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import fs from 'node:fs'

const N = 16384
const r = 8
const p = 1

function seal(plain, pass) {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = scryptSync(pass, salt, 32, { N, r, p })
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(plain), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['HG1', salt.toString('base64url'), iv.toString('base64url'), tag.toString('base64url'), body.toString('base64url')].join('\n') + '\n'
}

function unseal(stored, pass) {
  const parts = stored.trim().split('\n')
  if (parts.length !== 5 || parts[0] !== 'HG1') throw new Error('bad seal')
  const salt = Buffer.from(parts[1], 'base64url')
  const iv = Buffer.from(parts[2], 'base64url')
  const tag = Buffer.from(parts[3], 'base64url')
  const body = Buffer.from(parts[4], 'base64url')
  if (salt.length < 8 || iv.length !== 12 || tag.length !== 16 || !body.length) throw new Error('bad seal')
  const key = scryptSync(pass, salt, 32, { N, r, p })
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(body), decipher.final()])
}

const pass = process.env.ENV_PASS || process.env.SEAL_PASS || ''
const [mode, input, output] = process.argv.slice(2)
if (!pass || (mode !== '--seal' && mode !== '--unseal') || !input || !output) {
  console.error('Usage: ENV_PASS=... node scripts/unseal-env.mjs --unseal <sealed> <output>')
  process.exit(1)
}
try {
  if (mode === '--seal') fs.writeFileSync(output, seal(fs.readFileSync(input), pass))
  else fs.writeFileSync(output, unseal(fs.readFileSync(input, 'utf8'), pass))
} catch {
  console.error('Could not unlock the server secrets.')
  process.exit(1)
}
