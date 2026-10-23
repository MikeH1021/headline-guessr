import { ETHNICITIES, type Ethnicity } from './constants'

const ALIASES: Record<string, Ethnicity> = {
  white: 'White',
  caucasian: 'White',
  black: 'Black',
  'african american': 'Black',
  hispanic: 'Hispanic',
  latino: 'Hispanic',
  latina: 'Hispanic',
  asian: 'Asian',
  'middle eastern': 'Middle Eastern',
}

export function canonicalEthnicity(value: unknown) {
  if (typeof value !== 'string') return ''
  const folded = value.trim().toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ')
  if (ALIASES[folded]) return ALIASES[folded]
  for (const label of ETHNICITIES) {
    if (label.toLowerCase() === folded) return label
  }
  return ''
}
