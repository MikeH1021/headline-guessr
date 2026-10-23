import { ETHNICITIES } from './constants'

export function canonicalEthnicity(value: unknown) {
  if (typeof value !== 'string') return ''
  const folded = value.trim().toLowerCase()
  for (const label of ETHNICITIES) {
    if (label.toLowerCase() === folded) return label
  }
  return ''
}
