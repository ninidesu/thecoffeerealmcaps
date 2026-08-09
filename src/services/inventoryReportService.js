import { supabase } from '../lib/supabase'
import { fetchInventoryItems } from './adminInventoryService'

const FETCH_CAP = 5000

function normalizeMovement(row, itemType, item) {
  const movementType = String(row.movement_type || 'adjustment').toLowerCase()
  const direction = movementType === 'restock' ? 'in' : movementType === 'deduction' || movementType === 'waste' ? 'out' : 'neutral'
  return {
    id: `${itemType}-${row.id}`,
    rawId: row.id,
    itemType,
    itemId: item?.id || row.ingredient_id || row.finished_product_id,
    itemName: item?.name || 'Unknown inventory item',
    category: item?.category || 'Uncategorized',
    unit: item?.unit || '',
    movementType,
    direction,
    quantity: Number(row.quantity || 0),
    reason: row.reason || 'No reason recorded',
    orderId: row.order_id || null,
    orderNumber: row.orders?.order_number || '',
    staffId: row.created_by || null,
    staffName: row.profiles?.full_name || (row.created_by ? 'Staff member' : 'System'),
    reversed: Boolean(row.reversed),
    createdAt: row.created_at,
  }
}

async function fetchIngredientMovements() {
  const { data, error } = await supabase
    .from('inventory_movements')
    .select('id,ingredient_id,order_id,movement_type,quantity,reason,created_by,created_at,reversed,ingredients(id,name,category,unit),profiles(full_name),orders(order_number)')
    .order('created_at', { ascending: false })
    .limit(FETCH_CAP)
  if (error) throw error
  return (data || []).map((row) => normalizeMovement(row, 'ingredient', row.ingredients))
}

async function fetchFinishedProductMovements() {
  const { data, error } = await supabase
    .from('finished_product_movements')
    .select('id,finished_product_id,order_id,movement_type,quantity,reason,created_by,created_at,reversed,finished_products(id,name,category,unit),profiles(full_name),orders(order_number)')
    .order('created_at', { ascending: false })
    .limit(FETCH_CAP)
  if (error) throw error
  return (data || []).map((row) => normalizeMovement(row, 'finished_product', row.finished_products))
}

export async function fetchInventoryReport() {
  const [items, ingredientMovements, finishedMovements] = await Promise.all([
    fetchInventoryItems(),
    fetchIngredientMovements(),
    fetchFinishedProductMovements(),
  ])
  const movements = [...ingredientMovements, ...finishedMovements]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  return {
    items,
    movements,
    truncated: ingredientMovements.length >= FETCH_CAP || finishedMovements.length >= FETCH_CAP,
  }
}

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

export function downloadInventoryMovementCsv(records, rangeLabel) {
  const headers = ['Date and Time', 'Item', 'Inventory Type', 'Category', 'Movement', 'Quantity', 'Unit', 'Source', 'Order', 'Performed By', 'Reason', 'Reversed']
  const rows = records.map((record) => [
    new Date(record.createdAt).toLocaleString('en-PH'), record.itemName,
    record.itemType === 'ingredient' ? 'Ingredient' : 'Finished Product', record.category,
    record.movementType, record.quantity, record.unit, record.orderId ? 'Order' : record.staffId ? 'Manual' : 'System',
    record.orderNumber || '', record.staffName, record.reason, record.reversed ? 'Yes' : 'No',
  ])
  const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n')
  const blob = new Blob([`Inventory Movement Report - ${rangeLabel}\n${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `inventory-movements-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

export function printInventoryMovementReport({ records, summary, rangeLabel }) {
  const reportWindow = window.open('', '_blank', 'width=1080,height=900')
  if (!reportWindow) return false
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]))
  const rows = records.map((record) => `<tr><td>${escape(new Date(record.createdAt).toLocaleString('en-PH'))}</td><td>${escape(record.itemName)}</td><td>${escape(record.movementType)}</td><td>${escape(record.quantity)} ${escape(record.unit)}</td><td>${escape(record.orderNumber || (record.staffId ? 'Manual' : 'System'))}</td><td>${escape(record.staffName)}</td><td>${escape(record.reason)}</td></tr>`).join('')
  reportWindow.document.write(`<!doctype html><html><head><title>Inventory Movement Report</title><style>
    body{font-family:Arial,sans-serif;color:#1b2f22;padding:32px}h1{margin:0 0 4px}p{color:#68736b}section{display:flex;gap:12px;margin:24px 0}article{flex:1;padding:13px;border:1px solid #dfe4dd;border-radius:10px}article span{font-size:10px;color:#68736b;text-transform:uppercase}article b{display:block;margin-top:7px;font-size:19px}table{width:100%;border-collapse:collapse;font-size:10px}th,td{padding:8px;border-bottom:1px solid #dfe4dd;text-align:left;vertical-align:top}th{background:#f5f7f3;text-transform:uppercase}
  </style></head><body><h1>thecoffeerealm - Inventory Movement Report</h1><p>${escape(rangeLabel)} · Generated ${escape(new Date().toLocaleString('en-PH'))}</p><section><article><span>Movement events</span><b>${summary.total}</b></article><article><span>Order deductions</span><b>${summary.orderDeductions}</b></article><article><span>Manual actions</span><b>${summary.manualActions}</b></article><article><span>Waste events</span><b>${summary.waste}</b></article></section><table><thead><tr><th>Date</th><th>Item</th><th>Movement</th><th>Quantity</th><th>Source</th><th>Performed by</th><th>Reason</th></tr></thead><tbody>${rows || '<tr><td colspan="7">No movement records in this period.</td></tr>'}</tbody></table></body></html>`)
  reportWindow.document.close()
  reportWindow.focus()
  reportWindow.print()
  return true
}
