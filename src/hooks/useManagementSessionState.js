import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_PREFIX = 'tcr:management-session:v1:'
export const MANAGEMENT_REFRESH_EVENT = 'tcr:management-data-refresh'

const storageKey = (scope) => `${STORAGE_PREFIX}${scope}`

function resolveInitial(initialValue) {
  return typeof initialValue === 'function' ? initialValue() : initialValue
}

export function hasManagementSessionState(scope) {
  if (typeof window === 'undefined') return false
  return window.sessionStorage.getItem(storageKey(scope)) !== null
}

export function readManagementSessionState(scope, initialValue) {
  const fallback = resolveInitial(initialValue)
  if (typeof window === 'undefined') return fallback
  try {
    const saved = window.sessionStorage.getItem(storageKey(scope))
    return saved === null ? fallback : JSON.parse(saved)
  } catch {
    return fallback
  }
}

export function writeManagementSessionState(scope, value) {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(storageKey(scope), JSON.stringify(value))
  } catch {
    // Draft persistence is best-effort when browser storage is restricted.
  }
}

export function clearManagementSessionState(scope) {
  if (typeof window === 'undefined') return
  if (scope) {
    window.sessionStorage.removeItem(storageKey(scope))
    return
  }
  Object.keys(window.sessionStorage)
    .filter((key) => key.startsWith(STORAGE_PREFIX) || key.startsWith('tcr:management-scroll:'))
    .forEach((key) => window.sessionStorage.removeItem(key))
}

export function requestManagementDataRefresh(pathname) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(MANAGEMENT_REFRESH_EVENT, { detail: { pathname } }))
}

export function useManagementSessionState(scope, initialValue, options = {}) {
  const [value, setValue] = useState(() => {
    const saved = readManagementSessionState(scope, initialValue)
    return options.deserialize ? options.deserialize(saved) : saved
  })
  const saveTimerRef = useRef(0)

  useEffect(() => {
    saveTimerRef.current = window.setTimeout(() => {
      try {
        window.sessionStorage.setItem(storageKey(scope), JSON.stringify(value))
      } catch {
        // A management draft should never block the page when storage is unavailable.
      }
    }, 100)
    return () => window.clearTimeout(saveTimerRef.current)
  }, [scope, value])

  const clear = useCallback(() => {
    window.clearTimeout(saveTimerRef.current)
    clearManagementSessionState(scope)
  }, [scope])
  return [value, setValue, clear]
}
