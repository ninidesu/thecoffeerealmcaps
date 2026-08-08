import { supabase } from '../lib/supabase'

const UNIT_ALIASES = {
  ml: ['ml', 'milliliter', 'milliliters', 'mL'], liter: ['l', 'L', 'liter', 'liters'],
  gram: ['g', 'gram', 'grams'], kilogram: ['kg', 'kilogram', 'kilograms'],
  piece: ['pc', 'pcs', 'piece', 'pieces'],
}
function normalizeInventoryPayload(payload) {
  const rawUnit = String(payload.unit || '').trim()
  const unit = rawUnit.toLowerCase()
  const isLiter = UNIT_ALIASES.liter.map((value) => value.toLowerCase()).includes(unit)
  const isKilogram = UNIT_ALIASES.kilogram.includes(unit)
  const factor = isLiter || isKilogram ? 1000 : 1
  const canonicalUnit = isLiter ? 'milliliter' : isKilogram ? 'gram'
    : UNIT_ALIASES.ml.map((value) => value.toLowerCase()).includes(unit) ? 'milliliter'
      : UNIT_ALIASES.gram.includes(unit) ? 'gram'
        : UNIT_ALIASES.piece.includes(unit) ? 'piece' : rawUnit.toLowerCase()
  return {
    ...payload,
    unit: canonicalUnit,
    initialQuantity: Number(payload.initialQuantity ?? 0) * factor,
    minStockLevel: Number(payload.minStockLevel ?? 0) * factor,
    highStockLevel: Number(payload.highStockLevel ?? 0) * factor,
  }
}

export async function fetchIngredients() {
  const { data, error } = await supabase
    .from('ingredients')
    .select('id,name,category,type,unit,supplier,notes,is_archived,created_at,inventory_stock(quantity,min_stock_level,high_stock_level,updated_at)')
    .eq('is_archived', false)
  if (error) throw error
  return (data || []).map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    type: row.type,
    unit: row.unit,
    supplier: row.supplier,
    notes: row.notes,
    quantity: Number(row.inventory_stock?.[0]?.quantity ?? row.inventory_stock?.quantity ?? 0),
    minStockLevel: Number(row.inventory_stock?.[0]?.min_stock_level ?? row.inventory_stock?.min_stock_level ?? 0),
    highStockLevel: Number(row.inventory_stock?.[0]?.high_stock_level ?? row.inventory_stock?.high_stock_level ?? 0),
    updatedAt: row.inventory_stock?.[0]?.updated_at ?? row.inventory_stock?.updated_at ?? row.created_at,
    itemType: 'ingredient',
  }))
}

export async function fetchFinishedProducts() {
  const { data, error } = await supabase
    .from('finished_products')
    .select('id,name,category,menu_item_id,unit,quantity,min_stock_level,high_stock_level,supplier,notes,is_archived,updated_at,finished_product_sale_mappings(menu_item_id,variant_key,units_per_sale)')
    .eq('is_archived', false)
  if (error) throw error
  return (data || []).map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    unit: row.unit,
    supplier: row.supplier,
    notes: row.notes,
    menuItemId: row.menu_item_id,
    saleMappings: (row.finished_product_sale_mappings || []).map((mapping) => ({ menuItemId: mapping.menu_item_id, variantKey: mapping.variant_key || '', unitsPerSale: Number(mapping.units_per_sale) })),
    quantity: Number(row.quantity),
    minStockLevel: Number(row.min_stock_level),
    highStockLevel: Number(row.high_stock_level),
    updatedAt: row.updated_at,
    itemType: 'finished_product',
  }))
}

export async function fetchSupplies() {
  const { data, error } = await supabase
    .from('supplies')
    .select('id,name,category,unit,quantity,min_stock_level,high_stock_level,supplier,notes,is_archived,updated_at')
    .eq('is_archived', false)
  if (error) throw error
  return (data || []).map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    unit: row.unit,
    supplier: row.supplier,
    notes: row.notes,
    quantity: Number(row.quantity),
    minStockLevel: Number(row.min_stock_level),
    highStockLevel: Number(row.high_stock_level),
    updatedAt: row.updated_at,
    itemType: 'supply',
  }))
}

export async function fetchMenuItemOptions() {
  const { data, error } = await supabase.from('menu_items').select('id,name,variant_options').eq('is_archived', false).order('name')
  if (error) throw error
  return data || []
}

const MOVEMENT_TABLES = { ingredient: 'inventory_movements', finished_product: 'finished_product_movements', supply: 'supply_movements' }
const MOVEMENT_ID_COLUMNS = { ingredient: 'ingredient_id', finished_product: 'finished_product_id', supply: 'supply_id' }

export async function fetchMovements(itemType, itemId) {
  const table = MOVEMENT_TABLES[itemType]
  const idColumn = MOVEMENT_ID_COLUMNS[itemType]
  const { data, error } = await supabase
    .from(table)
    .select(`id,movement_type,quantity,reason,created_at,created_by,profiles(full_name)`)
    .eq(idColumn, itemId)
    .order('created_at', { ascending: false })
    .limit(25)
  if (error) throw error
  return (data || []).map((row) => ({ ...row, staffName: row.profiles?.full_name || 'Unknown' }))
}

export async function fetchRecipeUsage(ingredientId) {
  const { data, error } = await supabase
    .from('menu_item_ingredients')
    .select('quantity_per_serving,menu_items(id,name)')
    .eq('ingredient_id', ingredientId)
  if (error) throw error
  return (data || []).map((row) => ({ menuItemId: row.menu_items?.id, name: row.menu_items?.name, quantityPerServing: Number(row.quantity_per_serving) }))
}

export async function upsertIngredient(payload) {
  const normalized = normalizeInventoryPayload(payload)
  const { data, error } = await supabase.rpc('staff_upsert_ingredient', {
    p_id: normalized.id || null, p_name: normalized.name, p_category: normalized.category || null, p_type: normalized.type,
    p_unit: normalized.unit, p_min: normalized.minStockLevel, p_high: normalized.highStockLevel,
    p_supplier: normalized.supplier || null, p_notes: normalized.notes || null, p_initial_quantity: normalized.initialQuantity,
  })
  if (error) throw error
  return data
}
export async function archiveIngredient(id) {
  const { error } = await supabase.rpc('staff_archive_ingredient', { p_id: id })
  if (error) throw error
}

export async function upsertFinishedProduct(payload) {
  const normalized = normalizeInventoryPayload(payload)
  const { data, error } = await supabase.rpc('staff_upsert_finished_product', {
    p_id: normalized.id || null, p_name: normalized.name, p_category: normalized.category || null, p_menu_item_id: normalized.menuItemId || null,
    p_unit: normalized.unit, p_min: normalized.minStockLevel, p_high: normalized.highStockLevel,
    p_supplier: normalized.supplier || null, p_notes: normalized.notes || null, p_initial_quantity: normalized.initialQuantity,
  })
  if (error) throw error
  if (payload.saleMappings) {
    const { error: mappingError } = await supabase.rpc('staff_set_finished_product_sale_mappings', {
      p_finished_product_id: data,
      p_mappings: payload.saleMappings.map((mapping) => ({
        menu_item_id: mapping.menuItemId,
        variant_key: mapping.variantKey || null,
        units_per_sale: Number(mapping.unitsPerSale),
      })),
    })
    if (mappingError) throw mappingError
  }
  return data
}
export async function archiveFinishedProduct(id) {
  const { error } = await supabase.rpc('staff_archive_finished_product', { p_id: id })
  if (error) throw error
}

export async function upsertSupply(payload) {
  const normalized = normalizeInventoryPayload(payload)
  const { data, error } = await supabase.rpc('staff_upsert_supply', {
    p_id: normalized.id || null, p_name: normalized.name, p_category: normalized.category || null,
    p_unit: normalized.unit, p_min: normalized.minStockLevel, p_high: normalized.highStockLevel,
    p_supplier: normalized.supplier || null, p_notes: normalized.notes || null, p_initial_quantity: normalized.initialQuantity,
  })
  if (error) throw error
  return data
}
export async function archiveSupply(id) {
  const { error } = await supabase.rpc('staff_archive_supply', { p_id: id })
  if (error) throw error
}

export async function adjustStock({ itemType, itemId, delta, movementType, reason }) {
  const { data, error } = await supabase.rpc('staff_adjust_stock', {
    p_item_type: itemType, p_item_id: itemId, p_delta: delta, p_movement_type: movementType, p_reason: reason,
  })
  if (error) throw error
  return data
}
