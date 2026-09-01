import { createContext } from 'react'
import { DEFAULT_PRICING } from '../utils/pricing'

export const PricingContext = createContext({
  pricing: DEFAULT_PRICING,
  loading: false,
  error: '',
})
