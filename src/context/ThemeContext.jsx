import { createContext, useContext, useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'coffee-realm-management-theme'
const ThemeContext = createContext(null)

function savedPreference() {
  const saved = window.localStorage.getItem(STORAGE_KEY)
  return ['light', 'dark'].includes(saved) ? saved : 'light'
}

export function ThemeProvider({ children }) {
  const [preference, setPreference] = useState(savedPreference)
  const resolvedTheme = preference

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, preference)
    document.documentElement.dataset.theme = resolvedTheme
  }, [preference, resolvedTheme])

  const value = useMemo(() => ({ preference, resolvedTheme, setPreference }), [preference, resolvedTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used inside ThemeProvider')
  return value
}
