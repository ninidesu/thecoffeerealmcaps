import { supabase } from '../lib/supabase'

function valuesChanged(left, right) {
  return JSON.stringify(left ?? null) !== JSON.stringify(right ?? null)
}

function hasAny(source, keys) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(source || {}, key))
}

function readValue(source, keys) {
  const key = keys.find((candidate) => Object.prototype.hasOwnProperty.call(source || {}, candidate))
  return key ? source[key] : undefined
}

function changed(before, after, keys) {
  return (hasAny(before, keys) || hasAny(after, keys)) && valuesChanged(readValue(before, keys), readValue(after, keys))
}

export function getMenuChangeTypes(item, payload) {
  if (!item) return ['New item']
  const before = item || {}
  const after = payload || {}
  const changes = []
  if (changed(before, after, ['name'])) changes.push('Item name')
  if (changed(before, after, ['description'])) changes.push('Description')
  if (changed(before, after, ['price'])) changes.push('Price')
  if (hasAny(after, ['onlineBenefitEligible', 'online_benefit_eligible']) && Boolean(readValue(before, ['onlineBenefitEligible', 'online_benefit_eligible'])) !== Boolean(readValue(after, ['onlineBenefitEligible', 'online_benefit_eligible']))) changes.push('Online SC/PWD discount eligibility')
  if (changed(before, after, ['imageUrl', 'image_url'])) changes.push('Image')
  if (changed(before, after, ['mainCategoryId', 'main_category_id']) || changed(before, after, ['subcategoryId', 'subcategory_id'])) changes.push('Category')
  if (changed(before, after, ['temperatureType', 'temperature_type'])) changes.push('Temperature')

  const choiceKeys = ['allowIce', 'allow_ice', 'allowSugar', 'allow_sugar', 'variantOptions', 'variant_options', 'choices', 'choiceOptions', 'choice_options']
  if (changed(before, after, choiceKeys)) changes.push('Choices')

  const addonKeys = ['allowAddons', 'allow_addons', 'addons', 'addOns', 'addon_ids', 'add_on_ids']
  if (changed(before, after, addonKeys)) changes.push('Add-ons')

  const ingredientKeys = ['ingredients', 'ingredientIds', 'ingredient_ids', 'recipe', 'recipeItems', 'recipe_items', 'menu_item_ingredients']
  if (changed(before, after, ingredientKeys)) changes.push('Ingredients')

  const readyMadeKeys = ['readyMade', 'ready_made', 'isReadyMade', 'is_ready_made']
  if (changed(before, after, readyMadeKeys)) changes.push('Ready-made')
  else if (changed(before, after, ['itemType', 'item_type'])) changes.push('Item type')

  const displayKeys = ['isFeatured', 'is_featured', 'isBestseller', 'is_bestseller', 'sortOrder', 'sort_order']
  if (changed(before, after, displayKeys)) changes.push('Display settings')
  if (changed(before, after, ['manualAvailable', 'manual_available'])) changes.push('Status')
  if (changed(before, after, ['prepTimeMinutes', 'prep_time_minutes', 'availableFrom', 'available_from', 'availableUntil', 'available_until'])) changes.push('Schedule')
  return changes
}

function menuItemSnapshot(row) {
  if (!row) return null
  return {
    id: row.id, main_category_id: row.main_category_id, subcategory_id: row.subcategory_id,
    name: row.name, description: row.description || '', price: Number(row.price), item_type: row.item_type,
    temperature_type: row.temperature_type, allow_ice: Boolean(row.allow_ice), allow_sugar: Boolean(row.allow_sugar),
    allow_addons: Boolean(row.allow_addons), image_url: row.image_url || '', manual_available: Boolean(row.manual_available),
    is_featured: Boolean(row.is_featured), is_bestseller: Boolean(row.is_bestseller), prep_time_minutes: row.prep_time_minutes,
    available_from: row.available_from, available_until: row.available_until, sort_order: row.sort_order ?? 0,
    variant_options: row.variant_options || {},
    online_benefit_eligible: Boolean(row.online_benefit_eligible),
  }
}

function operationChangeTypes(request) {
  if (request.operation === 'set_online_benefit_eligibility') return ['Online SC/PWD discount eligibility']
  if (request.action === 'add' || request.operation === 'duplicate_menu_item') return ['New item']
  if (request.action === 'remove' || request.operation?.startsWith('archive_')) return ['Item removal']
  if (request.operation === 'upsert_main_category' || request.operation === 'upsert_subcategory') return ['Category']
  return null
}

export async function fetchMenuApprovalRequests() {
  const { data, error } = await supabase.from('menu_change_approvals').select('id,action,item_name,summary,change_types,state,created_at,decided_at,operation,payload,held_item_id').order('created_at', { ascending: false })
  if (error) throw error
  const approvalRows = (data || []).filter((request) => !['set_availability', 'bulk_availability'].includes(request.operation))
  const pendingItemIds = [...new Set(approvalRows.filter((request) => request.state === 'pending' && request.operation === 'upsert_menu_item' && request.payload?.id).map((request) => request.payload.id))]
  const snapshots = new Map()
  if (pendingItemIds.length) {
    const result = await supabase.from('menu_items').select('id,main_category_id,subcategory_id,name,description,price,item_type,temperature_type,allow_ice,allow_sugar,allow_addons,image_url,manual_available,is_featured,is_bestseller,prep_time_minutes,available_from,available_until,sort_order,variant_options,online_benefit_eligible').in('id', pendingItemIds)
    if (!result.error) (result.data || []).forEach((row) => snapshots.set(String(row.id), menuItemSnapshot(row)))
  }
  return approvalRows.map((request) => {
    const storedTypes = request.change_types || []
    const derivedTypes = request.state === 'pending'
      ? (request.operation === 'upsert_menu_item' && request.payload?.id && snapshots.has(String(request.payload.id))
        ? getMenuChangeTypes(snapshots.get(String(request.payload.id)), request.payload)
        : operationChangeTypes(request))
      : null
    return { ...request, itemName: request.item_name, changeTypes: derivedTypes?.length ? derivedTypes : storedTypes, createdAt: request.created_at }
  })
}

export async function createMenuApprovalRequest(request) {
  const { data, error } = await supabase.rpc('staff_create_menu_approval', {
    p_action: request.action, p_item_name: request.itemName, p_summary: request.summary, p_change_types: request.changeTypes,
    p_operation: request.operation, p_payload: request.payload || {},
  })
  if (error) throw error
  window.dispatchEvent(new CustomEvent('menu-approval-requests-changed'))
  return data
}

export async function updateMenuApprovalRequest(id, state) {
  const { error } = await supabase.rpc('admin_decide_menu_approval', { p_id: id, p_state: state })
  if (error) throw error
  window.dispatchEvent(new CustomEvent('menu-approval-requests-changed'))
}
