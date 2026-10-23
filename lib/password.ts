import { scryptSync, timingSafeEqual } from 'crypto'

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1

export function passwordMatches(password: string, stored: string) {
  if (!password || password.length > 200) return false
  const parts = stored.split(':')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  if (parts[1] !== String(SCRYPT_N) || parts[2] !== String(SCRYPT_R) || parts[3] !== String(SCRYPT_P)) return false
  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(parts[4], 'base64url')
    expected = Buffer.from(parts[5], 'base64url')
  } catch {
    return false
  }
  if (salt.length < 8 || expected.length !== 32) return false
  const actual = scryptSync(password, salt, expected.length, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}
