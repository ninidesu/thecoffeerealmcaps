import { useContext } from 'react'
import { PricingContext } from './pricingContextValue'

export function usePricing() {
  return useContext(PricingContext)
}
