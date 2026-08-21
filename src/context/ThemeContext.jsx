import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'coffee-realm-management-theme'
const ThemeContext = createContext(null)

function savedPreference() {
  const saved = window.localStorage.getItem(STORAGE_KEY)
  return ['light', 'dark'].includes(saved) ? saved : null
}

function systemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }) {
  const [preference, setPreference] = useState(savedPreference)
  const [systemPreference, setSystemPreference] = useState(systemTheme)
  const resolvedTheme = preference || systemPreference

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const updateSystemPreference = (event) => setSystemPreference(event.matches ? 'dark' : 'light')
    query.addEventListener('change', updateSystemPreference)
    return () => query.removeEventListener('change', updateSystemPreference)
  }, [])

  useEffect(() => {
    if (preference) window.localStorage.setItem(STORAGE_KEY, preference)
  }, [preference])

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.style.colorScheme = resolvedTheme
  }, [resolvedTheme])

  const value = useMemo(() => ({ preference, resolvedTheme, setPreference }), [preference, resolvedTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used inside ThemeProvider')
  return value
}
