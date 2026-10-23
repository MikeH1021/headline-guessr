import { randomBytes, scryptSync } from 'node:crypto'

const password = process.argv[2] || ''
if (!password || password.length > 200) {
  console.error('Usage: node scripts/hash-admin-password.mjs <password>')
  process.exit(1)
}
const salt = randomBytes(16)
const hash = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 })
console.log(`ADMIN_PASSWORD_HASH=scrypt:16384:8:1:${salt.toString('base64url')}:${hash.toString('base64url')}`)
