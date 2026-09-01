const CHECKOUT_DRAFT_PREFIX = 'tcr:customer-checkout:v1:'

const keyFor = (userId) => userId ? `${CHECKOUT_DRAFT_PREFIX}${userId}` : ''

export function readCheckoutDraft(userId) {
  const key = keyFor(userId)
  if (!key || typeof window === 'undefined') return null
  try {
    const draft = JSON.parse(window.sessionStorage.getItem(key))
    return draft && typeof draft === 'object' && draft.form && typeof draft.form === 'object' ? draft : null
  } catch {
    return null
  }
}

export function writeCheckoutDraft(userId, draft) {
  const key = keyFor(userId)
  if (!key || typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(key, JSON.stringify(draft))
  } catch {
    // Checkout remains usable when browser storage is unavailable.
  }
}

export function clearCheckoutDraft(userId) {
  const key = keyFor(userId)
  if (!key || typeof window === 'undefined') return
  window.sessionStorage.removeItem(key)
}
