import { supabase } from '../lib/supabase'
import { validateImageFile } from '../utils/imageUpload'

const fallbackImage = '/images/coffeerealmlogo.png'

function imagePath(value) {
  if (!value) return fallbackImage
  const clean = String(value).replace(/^\/+/, '')
  if (clean.startsWith('assets/')) return `/${clean}`
  return value.startsWith('/') ? value : `/${value}`
}

function normalizeMenuItem(row, orderCount = 0) {
  return {
    id: row.id,
    mainCategoryId: row.main_category_id,
    subcategoryId: row.subcategory_id,
    mainCategory: row.main_categories?.display_name || row.main_categories?.name || '',
    subcategory: row.subcategories?.display_name || row.subcategories?.name || '',
    subcategoryKey: row.subcategories?.name || '',
    name: row.name,
    slug: row.slug,
    description: row.description || '',
    price: Number(row.price),
    itemType: row.item_type || 'food',
    temperatureType: row.temperature_type || 'none',
    allowIce: Boolean(row.allow_ice),
    allowSugar: Boolean(row.allow_sugar),
    allowAddons: Boolean(row.allow_addons),
    imageUrl: row.image_url || '',
    image: imagePath(row.image_url),
    manualAvailable: Boolean(row.manual_available),
    available: Boolean(row.is_available),
    unavailableReason: row.unavailable_reason,
    isFeatured: Boolean(row.is_featured),
    isBestseller: Boolean(row.is_bestseller),
    prepTimeMinutes: row.prep_time_minutes,
    availableFrom: row.available_from,
    availableUntil: row.available_until,
    sortOrder: row.sort_order ?? 0,
    variantOptions: row.variant_options || {},
    isArchived: Boolean(row.is_archived),
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    orderCount,
  }
}

export async function fetchMainCategories() {
  const { data, error } = await supabase.from('main_categories').select('id,name,display_name,is_archived,sort_order').order('sort_order')
  if (error) throw error
  return data || []
}

export async function fetchSubcategories() {
  const { data, error } = await supabase.from('subcategories').select('id,name,display_name,main_category_id,is_archived,sort_order').order('sort_order')
  if (error) throw error
  return data || []
}

export async function fetchManageMenuItems() {
  const [menuResult, orderItemsResult] = await Promise.all([
    supabase
      .from('menu_items')
      .select('*, subcategories(id,name,display_name), main_categories(id,name,display_name)')
      .order('sort_order'),
    supabase.from('order_items').select('menu_item_id,quantity'),
  ])
  const { data, error } = menuResult
  if (error) throw error
  const orderCounts = new Map()
  if (!orderItemsResult.error) {
    for (const orderItem of orderItemsResult.data || []) {
      if (!orderItem.menu_item_id) continue
      orderCounts.set(orderItem.menu_item_id, (orderCounts.get(orderItem.menu_item_id) || 0) + Number(orderItem.quantity || 0))
    }
  }
  return (data || []).map((row) => normalizeMenuItem(row, orderCounts.get(row.id) || 0))
}

export async function fetchIngredientOptions() {
  const { data, error } = await supabase.from('ingredients').select('id,name,unit').eq('is_archived', false).order('name')
  if (error) throw error
  return data || []
}

export async function fetchAddonOptions() {
  const { data, error } = await supabase.from('addons').select('id,name,price,is_available').order('sort_order')
  if (error) throw error
  return data || []
}

export async function fetchMenuItemRecipe(menuItemId) {
  const { data, error } = await supabase.from('menu_item_ingredients').select('ingredient_id,quantity_per_serving').eq('menu_item_id', menuItemId)
  if (error) throw error
  return data || []
}

export async function upsertMainCategory(payload) {
  const { data, error } = await supabase.rpc('staff_upsert_main_category', {
    p_id: payload.id || null, p_name: payload.name, p_display_name: payload.displayName || null, p_sort_order: payload.sortOrder ?? 0,
  })
  if (error) throw error
  return data
}
export async function archiveMainCategory(id) {
  const { error } = await supabase.rpc('staff_archive_main_category', { p_id: id })
  if (error) throw error
}

export async function upsertSubcategory(payload) {
  const { data, error } = await supabase.rpc('staff_upsert_subcategory', {
    p_id: payload.id || null, p_main_category_id: payload.mainCategoryId || null, p_name: payload.name,
    p_display_name: payload.displayName || null, p_sort_order: payload.sortOrder ?? 0,
  })
  if (error) throw error
  return data
}
export async function archiveSubcategory(id) {
  const { error } = await supabase.rpc('staff_archive_subcategory', { p_id: id })
  if (error) throw error
}

export async function upsertMenuItem(payload) {
  const { data, error } = await supabase.rpc('staff_upsert_menu_item', {
    p_id: payload.id || null,
    p_main_category_id: payload.mainCategoryId || null,
    p_subcategory_id: payload.subcategoryId || null,
    p_name: payload.name,
    p_slug: payload.slug || null,
    p_description: payload.description || null,
    p_price: payload.price,
    p_item_type: payload.itemType || 'food',
    p_temperature_type: payload.temperatureType || 'none',
    p_allow_ice: Boolean(payload.allowIce),
    p_allow_sugar: Boolean(payload.allowSugar),
    p_allow_addons: Boolean(payload.allowAddons),
    p_image_url: payload.imageUrl || null,
    p_manual_available: payload.manualAvailable ?? true,
    p_is_featured: Boolean(payload.isFeatured),
    p_is_bestseller: Boolean(payload.isBestseller),
    p_prep_time_minutes: payload.prepTimeMinutes ?? null,
    p_available_from: payload.availableFrom || null,
    p_available_until: payload.availableUntil || null,
    p_sort_order: payload.sortOrder ?? 0,
    p_variant_options: payload.variantOptions || {},
  })
  if (error) throw error
  return data
}

export async function setMenuItemAvailability(id, manualAvailable) {
  const { error } = await supabase.rpc('staff_set_menu_item_availability', { p_id: id, p_manual_available: manualAvailable })
  if (error) throw error
}

export async function archiveMenuItem(id) {
  const { error } = await supabase.rpc('staff_archive_menu_item', { p_id: id })
  if (error) throw error
}

export async function duplicateMenuItem(id) {
  const { data, error } = await supabase.rpc('staff_duplicate_menu_item', { p_id: id })
  if (error) throw error
  return data
}

export async function setMenuItemRecipe(menuItemId, ingredients) {
  const { error } = await supabase.rpc('staff_set_menu_item_recipe', {
    p_menu_item_id: menuItemId,
    p_ingredients: ingredients.map((i) => ({ ingredient_id: i.ingredientId, quantity_per_serving: i.quantityPerServing })),
  })
  if (error) throw error
}

export async function uploadMenuItemImage(file) {
  const { extension } = await validateImageFile(file, { label: 'Menu photo' })
  const path = `${crypto.randomUUID()}.${extension}`
  const { error: uploadError } = await supabase.storage.from('menu-images').upload(path, file, { contentType: file.type, upsert: false })
  if (uploadError) throw uploadError
  const { data } = supabase.storage.from('menu-images').getPublicUrl(path)
  return data.publicUrl
}
