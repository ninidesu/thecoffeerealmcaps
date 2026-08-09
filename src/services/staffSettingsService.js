import { isSupabaseConfigured, supabase } from '../lib/supabase'

const STAFF_PREFERENCES_CACHE_KEY = 'tcr:staff-preferences'
const STAFF_PREFERENCES_EVENT = 'tcr:staff-preferences-changed'
const STAFF_FILTER_CACHE_PREFIX = 'tcr:staff-filters:'

export const DEFAULT_STAFF_PREFERENCES = {
  landing_view: 'orders',
  order_queue: 'active',
  order_sort: 'priority',
  fulfillment_filter: 'all',
  overdue_highlighting: true,
  inventory_tab: 'ingredient',
  inventory_filter: 'all',
  table_density: 'comfortable',
  rows_per_page: 25,
  remember_filters: true,
  reduced_motion: 'system',
  high_contrast: false,
  font_size: 'standard',
  notify_new_orders: true,
  notify_payment_proofs: true,
  notify_low_stock: true,
  notify_menu_changes: false,
  notify_customer_cancellations: true,
  system_change_popups: true,
  system_error_popups: true,
}

export const WORKSPACE_STAFF_PREFERENCE_KEYS = [
  'landing_view',
  'order_queue',
  'order_sort',
  'fulfillment_filter',
  'overdue_highlighting',
  'table_density',
  'rows_per_page',
  'remember_filters',
  'reduced_motion',
  'high_contrast',
  'font_size',
]

export const NOTIFICATION_STAFF_PREFERENCE_KEYS = [
  'notify_new_orders',
  'notify_payment_proofs',
  'notify_low_stock',
  'notify_menu_changes',
  'notify_customer_cancellations',
  'system_change_popups',
  'system_error_popups',
]

function readCachedPreferences() {
  if (typeof window === 'undefined') return DEFAULT_STAFF_PREFERENCES
  try {
    return { ...DEFAULT_STAFF_PREFERENCES, ...JSON.parse(window.localStorage.getItem(STAFF_PREFERENCES_CACHE_KEY) || '{}') }
  } catch {
    return DEFAULT_STAFF_PREFERENCES
  }
}

function clearRememberedFilters(scope) {
  if (typeof window === 'undefined') return
  if (scope) {
    window.sessionStorage.removeItem(`${STAFF_FILTER_CACHE_PREFIX}${scope}`)
    return
  }
  Object.keys(window.sessionStorage).filter((key) => key.startsWith(STAFF_FILTER_CACHE_PREFIX)).forEach((key) => window.sessionStorage.removeItem(key))
}

function cachePreferences(preferences) {
  if (typeof window === 'undefined') return
  const previous = readCachedPreferences()
  window.localStorage.setItem(STAFF_PREFERENCES_CACHE_KEY, JSON.stringify(preferences))
  if (!preferences.remember_filters) {
    clearRememberedFilters()
  } else if (
    previous.order_queue !== preferences.order_queue
    || previous.order_sort !== preferences.order_sort
    || previous.fulfillment_filter !== preferences.fulfillment_filter
  ) {
    clearRememberedFilters('orders')
  }
  window.dispatchEvent(new CustomEvent(STAFF_PREFERENCES_EVENT, { detail: preferences }))
}

export function getCachedStaffPreferences() {
  return readCachedPreferences()
}

export function shouldShowSystemNotification(type) {
  const preferences = getCachedStaffPreferences()
  return type === 'error' ? preferences.system_error_popups : preferences.system_change_popups
}

export function subscribeToStaffPreferences(callback) {
  if (typeof window === 'undefined') return () => {}
  const receive = (event) => callback({ ...DEFAULT_STAFF_PREFERENCES, ...(event.detail || {}) })
  window.addEventListener(STAFF_PREFERENCES_EVENT, receive)
  return () => window.removeEventListener(STAFF_PREFERENCES_EVENT, receive)
}

export function previewStaffPreferences(preferences) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(STAFF_PREFERENCES_EVENT, {
    detail: { ...getCachedStaffPreferences(), ...preferences },
  }))
}

export function getRememberedStaffFilters(scope) {
  if (typeof window === 'undefined' || !getCachedStaffPreferences().remember_filters) return null
  try {
    return JSON.parse(window.sessionStorage.getItem(`${STAFF_FILTER_CACHE_PREFIX}${scope}`) || 'null')
  } catch {
    return null
  }
}

export function rememberStaffFilters(scope, values) {
  if (typeof window === 'undefined') return
  const key = `${STAFF_FILTER_CACHE_PREFIX}${scope}`
  if (!getCachedStaffPreferences().remember_filters) {
    window.sessionStorage.removeItem(key)
    return
  }
  window.sessionStorage.setItem(key, JSON.stringify(values))
}

export async function fetchStaffPreferences(userId) {
  if (!isSupabaseConfigured || !userId) {
    cachePreferences(DEFAULT_STAFF_PREFERENCES)
    return DEFAULT_STAFF_PREFERENCES
  }
  const { data, error } = await supabase.from('staff_preferences').select('*').eq('user_id', userId).maybeSingle()
  if (error) throw error
  const preferences = { ...DEFAULT_STAFF_PREFERENCES, ...(data || {}) }
  cachePreferences(preferences)
  return preferences
}

export async function saveStaffPreferences(userId, values, keys = Object.keys(DEFAULT_STAFF_PREFERENCES)) {
  if (!isSupabaseConfigured) throw new Error('Supabase is not configured.')
  const preferences = Object.fromEntries(keys.filter((key) => key in DEFAULT_STAFF_PREFERENCES).map((key) => [key, values[key]]))
  const { data, error } = await supabase
    .from('staff_preferences')
    .upsert({ user_id: userId, ...preferences, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select()
    .single()
  if (error) throw error
  cachePreferences({ ...DEFAULT_STAFF_PREFERENCES, ...data })
  return data
}

export async function saveStaffProfile(userId, values) {
  if (!isSupabaseConfigured) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase
    .from('profiles')
    .update({ full_name: values.full_name.trim(), username: values.username.trim() || null, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function changeStaffPassword(password) {
  if (!isSupabaseConfigured) throw new Error('Supabase is not configured.')
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw error
}

export async function verifyStaffCurrentPassword(email, password) {
  if (!isSupabaseConfigured) throw new Error('Supabase is not configured.')
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error('Your current password is incorrect.')
}

export async function fetchStaffSessionInfo() {
  if (!isSupabaseConfigured) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.functions.invoke('staff-session-info', { body: {} })
  if (error) throw error
  return {
    ip: data?.ip || null,
    city: data?.city || null,
    region: data?.region || null,
    countryCode: data?.countryCode || null,
    approximate: true,
  }
}

export async function fetchPreciseStaffLocation() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) throw new Error('Device location is unavailable.')
  const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 5 * 60 * 1000,
  }))
  const { latitude, longitude } = position.coords
  const response = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&localityLanguage=en`)
  if (!response.ok) throw new Error('Could not resolve the device location.')
  const data = await response.json()
  return {
    city: data?.city || data?.locality || null,
    region: data?.principalSubdivision || null,
  }
}
