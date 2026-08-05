const AUTH_WELCOME_STORAGE_KEY = 'tcrv2-auth-welcome'

function isEmailLike(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function normalizeWelcomeName(value) {
  const trimmed = String(value || '').trim()
  if (!trimmed || isEmailLike(trimmed)) return ''
  return trimmed
}

export function resolveAuthWelcomeName(...sources) {
  for (const source of sources) {
    if (!source) continue
    if (typeof source === 'string') {
      const direct = normalizeWelcomeName(source)
      if (direct) return direct
      continue
    }
    const candidate = [
      source.display_name,
      source.full_name,
      source.first_name,
      source.name,
      source.username,
    ].map(normalizeWelcomeName).find(Boolean)
    if (candidate) return candidate
  }
  return ''
}

export function buildAuthWelcomeMessage(name) {
  return name ? `Welcome to The Coffee Realm, ${name}!` : 'Welcome to The Coffee Realm!'
}

export function queueAuthWelcome(...sources) {
  if (typeof window === 'undefined') return
  const name = resolveAuthWelcomeName(...sources)
  window.sessionStorage.setItem(AUTH_WELCOME_STORAGE_KEY, JSON.stringify({ name, queuedAt: Date.now() }))
}

export function readAuthWelcome() {
  if (typeof window === 'undefined') return null
  const raw = window.sessionStorage.getItem(AUTH_WELCOME_STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return {
      name: normalizeWelcomeName(parsed?.name),
      token: String(parsed?.queuedAt || ''),
    }
  } catch {
    return { name: '', token: '' }
  }
}

export function clearAuthWelcome() {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(AUTH_WELCOME_STORAGE_KEY)
}
