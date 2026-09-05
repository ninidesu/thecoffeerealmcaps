export const PERSON_NAME_PATTERN = "[\\p{L}][\\p{L} .'-]{1,59}"
export const USERNAME_PATTERN = '[A-Za-z0-9._-]{3,24}'
export const EMAIL_MAX_LENGTH = 160
export const EMAIL_PATTERN = '[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}'
export const PHONE_PATTERN = '09[0-9]{9}'
export const PASSWORD_PATTERN = '(?=.*[0-9]).{8,32}'
export const INTERNAL_PASSWORD_PATTERN = '.{8,32}'

export function sanitizePersonName(value, maxLength = 60) {
  return value.replace(/[^\p{L}\p{M} .'-]/gu, '').replace(/\s{2,}/g, ' ').slice(0, maxLength)
}

export function sanitizeCatalogText(value, maxLength = 80) {
  return value.replace(/[^\p{L}\p{M}0-9 &.'()/+-]/gu, '').replace(/\s{2,}/g, ' ').slice(0, maxLength)
}

export function sanitizeUsername(value, maxLength = 24) {
  return value.replace(/[^A-Za-z0-9._-]/g, '').slice(0, maxLength)
}

export function sanitizeDigits(value, maxLength = 32) {
  return value.replace(/\D/g, '').slice(0, maxLength)
}

export function sanitizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('63')) return `0${digits.slice(2, 12)}`.slice(0, 11)
  if (digits.startsWith('09')) return digits.slice(0, 11)
  if (digits.startsWith('0')) return `09${digits.slice(1)}`.slice(0, 11)
  return `09${digits}`.slice(0, 11)
}

export function isValidEmail(value) {
  const email = String(value || '').trim()
  return email.length <= EMAIL_MAX_LENGTH && new RegExp(`^${EMAIL_PATTERN}$`, 'i').test(email)
}

export function isValidPhone(value) {
  return /^09\d{9}$/.test(value)
}

export function isValidPassword(value) {
  return /^(?=.*\d).{8,32}$/.test(value)
}

export function isValidInternalPassword(value) {
  return /^.{8,32}$/.test(value)
}
