import { useCallback, useEffect, useState } from 'react'
import { fetchBenefitApplication } from '../services/benefitsService'

export function useBenefitApplication(customerId) {
  const [state, setState] = useState({ application: null, loading: true, error: '' })
  const [refresh, setRefresh] = useState(0)
  const reload = useCallback(() => setRefresh(value => value + 1), [])
  useEffect(() => {
    let active = true
    if (!customerId) return () => { active = false }
    const load = async () => {
      try {
        const application = await fetchBenefitApplication(customerId)
        if (active) setState({ application, loading: false, error: '' })
      } catch (cause) {
        if (active) setState(current => ({ ...current, loading: false, error: cause.message || 'Could not load your application.' }))
      }
    }
    load()
    const onFocus = () => { if (!document.hidden) load() }
    window.addEventListener('focus', onFocus)
    const interval = window.setInterval(onFocus, 30000)
    return () => { active = false; window.removeEventListener('focus', onFocus); window.clearInterval(interval) }
  }, [customerId, refresh])
  return { ...state, reload }
}
