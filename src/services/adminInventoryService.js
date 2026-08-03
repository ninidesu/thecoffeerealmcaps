import { supabase } from '../lib/supabase'

const MOVEMENT_TABLES = [
  { table: 'inventory_movements', idColumn: 'ingredient_id', itemType: 'ingredient' },
  { table: 'finished_product_movements', idColumn: 'finished_product_id', itemType: 'finished_product' },
  { table: 'supply_movements', idColumn: 'supply_id', itemType: 'supply' },
]

function normalizeItem(row, itemType, quantity, minStockLevel, highStockLevel) {
  return {
    id: row.id,
    itemType,
    name: row.name,
    sku: row.sku || '',
    category: row.category || 'Uncategorized',
    type: row.type || null,
    unit: row.unit,
    quantity,
    minStockLevel,
    highStockLevel,
    costPerUnit: row.cost_per_unit === null || row.cost_per_unit === undefined ? null : Number(row.cost_per_unit),
    expirationDate: row.expiration_date || null,
    supplier: row.supplier || '',
    notes: row.notes || '',
    updatedAt: row.updated_at || row.created_at,
    menuItemId: row.menu_item_id || null,
  }
}

export async function fetchInventoryItems() {
  const [{ data: ingredients, error: ingredientsError }, { data: finishedProducts, error: finishedError }, { data: supplies, error: suppliesError }] = await Promise.all([
    supabase.from('ingredients').select('id,name,category,type,unit,supplier,notes,cost_per_unit,expiration_date,sku,created_at,inventory_stock(quantity,min_stock_level,high_stock_level,updated_at)').eq('is_archived', false),
    supabase.from('finished_products').select('id,name,category,menu_item_id,unit,quantity,min_stock_level,high_stock_level,supplier,notes,cost_per_unit,expiration_date,sku,updated_at').eq('is_archived', false),
    supabase.from('supplies').select('id,name,category,unit,quantity,min_stock_level,high_stock_level,supplier,notes,cost_per_unit,expiration_date,sku,updated_at').eq('is_archived', false),
  ])
  if (ingredientsError) throw ingredientsError
  if (finishedError) throw finishedError
  if (suppliesError) throw suppliesError

  const { data: recipeLinks, error: recipeError } = await supabase.from('menu_item_ingredients').select('ingredient_id')
  if (recipeError) throw recipeError
  const usedByCount = new Map()
  ;(recipeLinks || []).forEach((r) => usedByCount.set(r.ingredient_id, (usedByCount.get(r.ingredient_id) || 0) + 1))

  const items = [
    ...(ingredients || []).map((i) => ({
      ...normalizeItem(i, 'ingredient', Number(i.inventory_stock?.[0]?.quantity ?? 0), Number(i.inventory_stock?.[0]?.min_stock_level ?? 0), Number(i.inventory_stock?.[0]?.high_stock_level ?? 0)),
      updatedAt: i.inventory_stock?.[0]?.updated_at ?? i.created_at,
      usedByCount: usedByCount.get(i.id) || 0,
    })),
    ...(finishedProducts || []).map((p) => ({ ...normalizeItem(p, 'finished_product', Number(p.quantity), Number(p.min_stock_level), Number(p.high_stock_level)), usedByCount: p.menu_item_id ? 1 : 0 })),
    ...(supplies || []).map((s) => ({ ...normalizeItem(s, 'supply', Number(s.quantity), Number(s.min_stock_level), Number(s.high_stock_level)), usedByCount: 0 })),
  ]
  return items
}

export async function fetchMovements({ limit = 60 } = {}) {
  const results = await Promise.all(MOVEMENT_TABLES.map(({ table, idColumn, itemType }) =>
    supabase.from(table).select(`id,${idColumn},movement_type,quantity,reason,created_at,created_by,profiles(full_name)`).order('created_at', { ascending: false }).limit(limit)
      .then(({ data, error }) => { if (error) throw error; return (data || []).map((row) => ({ ...row, itemType, itemId: row[idColumn] })) }),
  ))
  const merged = results.flat().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, limit)
  return merged.map((m) => ({
    id: m.id, itemType: m.itemType, itemId: m.itemId, movementType: m.movement_type,
    quantity: Number(m.quantity), reason: m.reason, createdAt: m.created_at, staffName: m.profiles?.full_name || 'Unknown',
  }))
}

export async function fetchAffectedMenuItems() {
  const { data, error } = await supabase
    .from('menu_items')
    .select('id,name,unavailable_reason,subcategories(display_name,name)')
    .in('unavailable_reason', ['missing_ingredient', 'insufficient_stock'])
    .eq('is_archived', false)
  if (error) throw error
  return (data || []).map((m) => ({ id: m.id, name: m.name, reason: m.unavailable_reason, category: m.subcategories?.display_name || m.subcategories?.name || '' }))
}

export function stockStatus(item) {
  if (item.quantity <= 0) return 'out'
  if (item.quantity <= item.minStockLevel) return 'low'
  if (item.highStockLevel > 0 && item.quantity > item.highStockLevel) return 'over'
  return 'healthy'
}
export function isExpiringSoon(item, warningDays = 7) {
  if (!item.expirationDate) return false
  const daysLeft = (new Date(item.expirationDate) - new Date()) / 86400000
  return daysLeft >= 0 && daysLeft <= warningDays
}

export function computeOverview(items, movements) {
  const statusCounts = { healthy: 0, low: 0, out: 0, over: 0 }
  let totalValue = 0
  let trackedCostCount = 0
  const valueByCategory = new Map()
  let expiringSoon = 0

  items.forEach((item) => {
    statusCounts[stockStatus(item)] += 1
    if (isExpiringSoon(item)) expiringSoon += 1
    if (item.costPerUnit !== null) {
      trackedCostCount += 1
      const value = item.costPerUnit * item.quantity
      totalValue += value
      valueByCategory.set(item.category, (valueByCategory.get(item.category) || 0) + value)
    }
  })

  const last14 = []
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(); d.setDate(d.getDate() - i)
    last14.push(d.toISOString().slice(0, 10))
  }
  const deductionsByDay = new Map(last14.map((d) => [d, 0]))
  movements.filter((m) => m.movementType === 'deduction').forEach((m) => {
    const day = m.createdAt.slice(0, 10)
    if (deductionsByDay.has(day)) deductionsByDay.set(day, deductionsByDay.get(day) + m.quantity)
  })
  const consumptionTrend = last14.map((day) => ({ day, quantity: deductionsByDay.get(day) || 0 }))

  const consumedByItem = new Map()
  const itemsById = new Map(items.map((i) => [i.id, i]))
  movements.filter((m) => m.movementType === 'deduction').forEach((m) => {
    const item = itemsById.get(m.itemId)
    const name = item?.name || 'Unknown item'
    const unit = item?.unit || ''
    const entry = consumedByItem.get(m.itemId) || { name, unit, qty: 0 }
    entry.qty += m.quantity
    consumedByItem.set(m.itemId, entry)
  })
  const mostConsumed = [...consumedByItem.values()].sort((a, b) => b.qty - a.qty).slice(0, 5)

  const recentDeductions = movements.filter((m) => m.movementType === 'deduction' && m.createdAt.slice(0, 10) === last14[13]).length
  const wasteRecorded = movements.filter((m) => m.movementType === 'waste').length

  return {
    totalActiveIngredients: items.length,
    totalValue, hasCostData: trackedCostCount > 0,
    lowStockCount: statusCounts.low, outOfStockCount: statusCounts.out, healthyCount: statusCounts.healthy, overStockCount: statusCounts.over,
    expiringSoon, recentDeductions, wasteRecorded,
    valueByCategory: [...valueByCategory.entries()].sort(([, a], [, b]) => b - a),
    consumptionTrend, mostConsumed,
  }
}
