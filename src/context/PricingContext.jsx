import { useEffect, useMemo, useState } from 'react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { fetchPortalConfiguration } from '../services/adminPortalConfigurationService'
import { DEFAULT_PRICING, normalizePricing } from '../utils/pricing'
import { PricingContext } from './pricingContextValue'

export function PricingProvider({ children }) {
  const [pricing, setPricing] = useState(DEFAULT_PRICING)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    const loadPricing = async () => {
      if (!isSupabaseConfigured) {
        if (active) setLoading(false)
        return
      }

      try {
        const configuration = await fetchPortalConfiguration('system')
        if (!active) return
        setPricing(normalizePricing(configuration?.values?.pricing))
        setError('')
      } catch (loadError) {
        if (!active) return
        setPricing(DEFAULT_PRICING)
        setError(loadError?.message || 'Unable to load the global pricing policy.')
      } finally {
        if (active) setLoading(false)
      }
    }

    loadPricing()

    if (!isSupabaseConfigured) {
      return () => {
        active = false
      }
    }

    const channel = supabase
      .channel('global-pricing-policy')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'portal_configuration', filter: 'scope=eq.system' },
        (payload) => {
          const changedRow = payload.eventType === 'DELETE' ? payload.old : payload.new
          if (changedRow?.key !== 'pricing') return
          setPricing(payload.eventType === 'DELETE'
            ? DEFAULT_PRICING
            : normalizePricing(changedRow.value))
        },
      )
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  const value = useMemo(() => ({ pricing, loading, error }), [pricing, loading, error])

  return <PricingContext.Provider value={value}>{children}</PricingContext.Provider>
}
