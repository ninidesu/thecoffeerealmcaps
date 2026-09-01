import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { DEFAULT_PRICING } from '../utils/pricing'
import { validateImageFile } from '../utils/imageUpload'

export const CONTENT_DEFAULTS = {
  hero: {
    eyebrow: 'thecoffeerealm in North Fairview',
    title: 'Fresh coffee, homemade sweets, and slow little moments.',
    body: 'We serve comforting coffee-based drinks, freshly baked cookies, homemade cakes, pasta, rice meals, toasts, and snacks in a warm neighborhood space.',
    primaryLabel: 'View full menu', primaryHref: '/menu', secondaryLabel: 'Send us a message', secondaryHref: '#customer-inquiry-form',
  },
  featured: { eyebrow: 'Customer favorites', title: 'Bestsellers from the realm.', visible: true, itemIds: [] },
  inquiry: {
    kicker: 'Talk to the realm', title: 'Questions, pre-orders, or something we should know?',
    responseTitle: 'Reply by email', responseBody: 'Our team responds directly to the address you provide.', visible: true,
  },
  about: {
    eyebrow: 'About us', title: 'A cozy place for coffee, cakes, and conversations.',
    paragraphs: [
      'We serve freshly baked cookies, homemade cakes, and comforting coffee-based drinks in a space made for slow days, warm conversations, or solo work dates.',
      'We also offer pasta, rice meals, toasts, and snacks. Some bestsellers include homemade tiramisu, biscoff burnt cheesecake, and fresh cookie boxes for gifting or sharing.',
    ],
  },
  footer: {
    tagline: 'Thoughtfully brewed in North Fairview, Quezon City.',
    facebookUrl: 'https://www.facebook.com/thecoffeerealmx', instagramUrl: 'https://www.instagram.com/thecoffeerealmx', tiktokUrl: 'https://www.tiktok.com/@thecoffeerealmx',
  },
}

export const SYSTEM_DEFAULTS = {
  store: {
    name: 'thecoffeerealm', email: 'thecoffeerealmx@gmail.com', phone: '0966 964 7796',
    address: 'Lot 1 Block 210 Mark Street corner Dollar Street, North Fairview, Quezon City', timezone: 'Asia/Manila',
  },
  ordering: {
    storeStatus: 'open', closureMessage: 'Online ordering is temporarily unavailable. Please check again later.',
    openTime: '10:00', closeTime: '23:30', deliveryEnabled: true, pickupEnabled: true, minimumOrder: 0,
  },
  payments: {
    enabledMethods: ['cod', 'gcash', 'bank_transfer'], codMaximum: 1000,
    gcashQrUrl: '/assets/img/qr.jpg', bankQrUrl: '/assets/img/qr1.jpg',
    gcashInstructions: 'Open GCash, scan the QR code, and send the exact order total.',
    bankName: '', bankAccountName: '', bankAccountNumber: '', bankInstructions: 'Transfer the exact order total and save a clear receipt.',
  },
  notices: { checkoutNotice: '', inquiryReplyTarget: '' },
  pricing: { ...DEFAULT_PRICING },
}

export const DEFAULT_TESTIMONIALS = [
  { id: 'default-mika', name: 'Mika S.', label: 'Customer', quote: 'Their coffee and cheesecakes feel homemade in the best way. Cozy place, kind staff, and always worth coming back to.', rating: 5, visible: true, display_order: 0 },
  { id: 'default-ari', name: 'Ari R.', label: 'Customer', quote: 'The cookie boxes are my go-to gift. Every flavor tastes fresh and the packaging feels thoughtful.', rating: 5, visible: true, display_order: 1 },
  { id: 'default-nico', name: 'Nico C.', label: 'Customer', quote: 'Perfect North Fairview coffee stop. Good drinks, comforting meals, and a calm spot to work or meet friends.', rating: 5, visible: true, display_order: 2 },
]

const clone = (value) => JSON.parse(JSON.stringify(value))
const mergeGroup = (defaults, rows) => {
  const result = clone(defaults)
  for (const row of rows || []) result[row.key] = { ...(result[row.key] || {}), ...(row.value || {}) }
  return result
}

function requireSupabase() {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured for this workspace.')
}

export async function fetchPortalConfiguration(scope) {
  requireSupabase()
  const defaults = scope === 'content' ? CONTENT_DEFAULTS : SYSTEM_DEFAULTS
  const { data, error } = await supabase.from('portal_configuration').select('key,value,is_public,updated_at,updated_by').eq('scope', scope)
  if (error) {
    if (error.code === '42P01' || /portal_configuration/i.test(error.message || '')) return { values: clone(defaults), updatedAt: null, setupRequired: true }
    throw error
  }
  const updatedAt = (data || []).map((row) => row.updated_at).filter(Boolean).sort().at(-1) || null
  return { values: mergeGroup(defaults, data), updatedAt, setupRequired: false }
}

export async function savePortalConfiguration(scope, key, value, isPublic = true) {
  requireSupabase()
  const { data: auth } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('portal_configuration').upsert({
    scope, key, value, is_public: Boolean(isPublic), updated_by: auth?.user?.id || null, updated_at: new Date().toISOString(),
  }, { onConflict: 'scope,key' }).select().single()
  if (error) throw error
  return data
}

const storagePathFromPublicUrl = (url) => {
  const marker = '/storage/v1/object/public/portal-assets/'
  const index = String(url || '').indexOf(marker)
  return index < 0 ? null : decodeURIComponent(String(url).slice(index + marker.length))
}

export async function savePaymentConfiguration(settings, qrFiles = {}) {
  requireSupabase()
  const next = { ...settings }
  const uploadedPaths = []
  const replacedPaths = []
  try {
    for (const [method, file] of Object.entries(qrFiles)) {
      if (!file) continue
      const { extension } = await validateImageFile(file, { label: 'Payment QR image' })
      const settingKey = method === 'gcash' ? 'gcashQrUrl' : 'bankQrUrl'
      const path = `payment-qr/${method}-${crypto.randomUUID()}.${extension}`
      const { error: uploadError } = await supabase.storage.from('portal-assets').upload(path, file, { contentType: file.type, upsert: false })
      if (uploadError) throw uploadError
      uploadedPaths.push(path)
      const { data } = supabase.storage.from('portal-assets').getPublicUrl(path)
      if (!data?.publicUrl) throw new Error('The uploaded QR image URL could not be created.')
      const previousPath = storagePathFromPublicUrl(next[settingKey])
      if (previousPath) replacedPaths.push(previousPath)
      next[settingKey] = data.publicUrl
    }
    const row = await savePortalConfiguration('system', 'payments', next, true)
    if (replacedPaths.length) await supabase.storage.from('portal-assets').remove(replacedPaths)
    return { settings: next, row }
  } catch (error) {
    if (uploadedPaths.length) await supabase.storage.from('portal-assets').remove(uploadedPaths)
    throw error
  }
}

export async function fetchTestimonials({ publicOnly = false } = {}) {
  requireSupabase()
  let query = supabase.from('site_testimonials').select('*').order('display_order').order('created_at')
  if (publicOnly) query = query.eq('visible', true)
  const { data, error } = await query
  if (error) {
    if (error.code === '42P01' || /site_testimonials/i.test(error.message || '')) return publicOnly ? DEFAULT_TESTIMONIALS : []
    throw error
  }
  return data || []
}

export async function saveTestimonial(values) {
  requireSupabase()
  const payload = {
    name: values.name.trim(), label: values.label?.trim() || 'Customer', quote: values.quote.trim(),
    rating: Number(values.rating || 5), visible: Boolean(values.visible), display_order: Number(values.display_order || 0), updated_at: new Date().toISOString(),
  }
  const query = values.id && !String(values.id).startsWith('default-')
    ? supabase.from('site_testimonials').update(payload).eq('id', values.id)
    : supabase.from('site_testimonials').insert(payload)
  const { data, error } = await query.select().single()
  if (error) throw error
  return data
}

export async function deleteTestimonial(id) {
  const { error } = await supabase.from('site_testimonials').delete().eq('id', id)
  if (error) throw error
}

export async function fetchContentMenuOptions() {
  requireSupabase()
  const { data, error } = await supabase.from('menu_items')
    .select('id,name,description,price,image_url,is_available,is_bestseller,is_featured,subcategories(display_name,name)')
    .eq('is_archived', false).order('sort_order')
  if (error) throw error
  return (data || []).map((item) => ({ ...item, category: item.subcategories?.display_name || item.subcategories?.name || 'Menu' }))
}

export async function fetchDeliveryZoneSettings() {
  requireSupabase()
  const { data, error } = await supabase.from('delivery_areas').select('barangay,zone,fee,estimated_time,is_active').order('zone').order('barangay')
  if (error) throw error
  const groups = new Map()
  for (const row of data || []) {
    if (!groups.has(row.zone)) groups.set(row.zone, { zone: row.zone, fee: Number(row.fee || 0), estimatedTime: row.estimated_time || '', active: Boolean(row.is_active), barangays: [] })
    groups.get(row.zone).barangays.push(row.barangay)
  }
  return [...groups.values()]
}

export async function fetchPublicDeliveryAreas() {
  if (!isSupabaseConfigured || !supabase) return []
  const { data, error } = await supabase.from('delivery_areas').select('barangay,zone,fee,estimated_time').eq('is_active', true).order('barangay')
  if (error) throw error
  return (data || []).map((row) => ({ barangay: row.barangay, zone: row.zone, fee: Number(row.fee || 0), estimatedTime: row.estimated_time || '' }))
}

export async function saveDeliveryZoneSettings(zones) {
  requireSupabase()
  const updates = zones.flatMap((zone) => zone.barangays.map((barangay) => ({
    barangay, zone: zone.zone, fee: Number(zone.fee || 0), estimated_time: zone.estimatedTime.trim(), is_active: Boolean(zone.active), updated_at: new Date().toISOString(),
  })))
  const { error } = await supabase.from('delivery_areas').upsert(updates, { onConflict: 'barangay' })
  if (error) throw error
}

export async function fetchPublicPortalData() {
  if (!isSupabaseConfigured || !supabase) return { content: clone(CONTENT_DEFAULTS), system: clone(SYSTEM_DEFAULTS), testimonials: DEFAULT_TESTIMONIALS }
  const [content, system, testimonials] = await Promise.all([
    fetchPortalConfiguration('content'), fetchPortalConfiguration('system'), fetchTestimonials({ publicOnly: true }),
  ])
  return { content: content.values, system: system.values, testimonials }
}
