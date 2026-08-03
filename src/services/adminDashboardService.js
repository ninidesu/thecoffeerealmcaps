import { supabase } from '../lib/supabase'

const ORDER_SELECT = `id,order_number,order_type,order_source,status,customer_name,customer_id,final_total,discount_amount,delivery_fee,
  payment_status,payment_confirmed,refund_status,is_voided,created_at,
  order_items(item_name,display_name,quantity,line_total),
  payments(method,status)`

function dayStart(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  d.setHours(0, 0, 0, 0)
  return d
}
function isoDay(date) {
  return date.toISOString().slice(0, 10)
}

export async function fetchDashboardData() {
  const windowStart = dayStart(-13) // last 14 days, inclusive of today

  const [
    { data: orders, error: ordersError },
    { data: refunds, error: refundsError },
    { data: allCustomerOrders, error: custError },
    { count: totalCustomers, error: customerCountError },
    { data: ingredients, error: ingredientsError },
    { data: finishedProducts, error: finishedError },
    { data: supplies, error: suppliesError },
    { data: menuItems, error: menuError },
  ] = await Promise.all([
    supabase.from('orders').select(ORDER_SELECT).gte('created_at', windowStart.toISOString()).order('created_at', { ascending: true }),
    supabase.from('refunds').select('id,order_id,refund_status,refund_amount,requested_at,processed_at'),
    supabase.from('orders').select('customer_id,created_at').not('customer_id', 'is', null),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'customer'),
    supabase.from('ingredients').select('id,name,is_archived,inventory_stock(quantity,min_stock_level)').eq('is_archived', false),
    supabase.from('finished_products').select('id,name,quantity,min_stock_level,is_archived').eq('is_archived', false),
    supabase.from('supplies').select('id,name,quantity,min_stock_level,is_archived').eq('is_archived', false),
    supabase.from('menu_items').select('id,name,is_available,is_archived').eq('is_archived', false),
  ])
  if (ordersError) throw ordersError
  if (refundsError && refundsError.code !== '42P01') throw refundsError
  if (custError) throw custError
  if (customerCountError) throw customerCountError
  if (ingredientsError) throw ingredientsError
  if (finishedError) throw finishedError
  if (suppliesError) throw suppliesError
  if (menuError) throw menuError

  return {
    orders: orders || [],
    refunds: refunds || [],
    allCustomerOrders: allCustomerOrders || [],
    totalCustomers: totalCustomers ?? 0,
    ingredients: ingredients || [],
    finishedProducts: finishedProducts || [],
    supplies: supplies || [],
    menuItems: menuItems || [],
  }
}

function isCounted(order) {
  return order.status !== 'Cancelled' && !order.is_voided
}
function isPaidCompleted(order) {
  return order.status === 'Completed' && order.payment_status === 'paid' && !order.is_voided
}
function salesOf(orders) {
  return orders.filter(isPaidCompleted).reduce((s, o) => s + Number(o.final_total || 0), 0)
}

export function computeDashboardMetrics(raw) {
  const { orders, refunds, allCustomerOrders, totalCustomers, ingredients, finishedProducts, supplies, menuItems } = raw

  const today = isoDay(dayStart(0))
  const yesterday = isoDay(dayStart(-1))
  const todayOrders = orders.filter((o) => o.created_at.slice(0, 10) === today)
  const yesterdayOrders = orders.filter((o) => o.created_at.slice(0, 10) === yesterday)

  const countedToday = todayOrders.filter(isCounted)
  const totalSales = salesOf(todayOrders)
  const yesterdaySales = salesOf(yesterdayOrders)
  const salesChangePct = yesterdaySales > 0 ? ((totalSales - yesterdaySales) / yesterdaySales) * 100 : (totalSales > 0 ? 100 : 0)

  const totalOrders = countedToday.length
  const completedOrders = todayOrders.filter((o) => o.status === 'Completed').length
  const cancelledOrders = todayOrders.filter((o) => o.status === 'Cancelled').length
  const paidCompletedToday = todayOrders.filter(isPaidCompleted)
  const avgOrderValue = paidCompletedToday.length ? totalSales / paidCompletedToday.length : 0
  const completionRate = totalOrders ? (completedOrders / totalOrders) * 100 : 0

  const refundedToday = refunds.filter((r) => r.refund_status === 'processed' && r.processed_at?.slice(0, 10) === today)
  const refundedOrders = refundedToday.length
  const refundedAmount = refundedToday.reduce((s, r) => s + Number(r.refund_amount || 0), 0)

  const lowStockItems = [
    ...ingredients.map((i) => ({ id: i.id, name: i.name, unit: 'unit', quantity: Number(i.inventory_stock?.[0]?.quantity ?? 0), min: Number(i.inventory_stock?.[0]?.min_stock_level ?? 0) })),
    ...finishedProducts.map((p) => ({ id: p.id, name: p.name, unit: 'unit', quantity: Number(p.quantity), min: Number(p.min_stock_level) })),
    ...supplies.map((s) => ({ id: s.id, name: s.name, unit: 'unit', quantity: Number(s.quantity), min: Number(s.min_stock_level) })),
  ].filter((i) => i.min > 0 && i.quantity <= i.min)
  const unavailableMenuItems = menuItems.filter((m) => !m.is_available).length

  const salesByDay = new Map()
  orders.filter(isPaidCompleted).forEach((o) => {
    const day = o.created_at.slice(0, 10)
    salesByDay.set(day, (salesByDay.get(day) || 0) + Number(o.final_total || 0))
  })
  const salesTrend = []
  for (let i = 13; i >= 0; i -= 1) {
    const day = isoDay(dayStart(-i))
    salesTrend.push({ day, total: salesByDay.get(day) || 0 })
  }

  const fulfillmentCounts = { delivery: 0, pickup: 0, 'walk-in': 0 }
  countedToday.forEach((o) => { fulfillmentCounts[o.order_type] = (fulfillmentCounts[o.order_type] || 0) + 1 })

  const paymentTotals = {}
  paidCompletedToday.forEach((o) => {
    const method = o.payments?.[0]?.method || 'other'
    paymentTotals[method] = (paymentTotals[method] || 0) + Number(o.final_total || 0)
  })

  const itemAgg = new Map()
  orders.filter(isPaidCompleted).forEach((o) => {
    (o.order_items || []).forEach((item) => {
      const name = item.display_name || item.item_name
      const entry = itemAgg.get(name) || { name, qty: 0, revenue: 0 }
      entry.qty += Number(item.quantity || 0)
      entry.revenue += Number(item.line_total || 0)
      itemAgg.set(name, entry)
    })
  })
  const bestSellers = [...itemAgg.values()].sort((a, b) => b.qty - a.qty).slice(0, 5)

  const recentOrders = [...orders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6)

  const firstOrderByCustomer = new Map()
  allCustomerOrders.forEach((o) => {
    const existing = firstOrderByCustomer.get(o.customer_id)
    if (!existing || o.created_at < existing) firstOrderByCustomer.set(o.customer_id, o.created_at)
  })
  const customersToday = new Set(countedToday.filter((o) => o.customer_id).map((o) => o.customer_id))
  let newCustomers = 0, returningCustomers = 0
  customersToday.forEach((id) => {
    const firstOrder = firstOrderByCustomer.get(id)
    if (firstOrder && firstOrder.slice(0, 10) === today) newCustomers += 1
    else returningCustomers += 1
  })

  return {
    totalSales, salesChangePct, totalOrders, avgOrderValue, completionRate,
    totalCustomers,
    completedOrders, cancelledOrders, refundedOrders, refundedAmount,
    lowStockItems, unavailableMenuItems,
    salesTrend, fulfillmentCounts, paymentTotals, bestSellers, recentOrders, newCustomers, returningCustomers,
  }
}
