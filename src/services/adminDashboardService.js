import { supabase } from '../lib/supabase'

const ORDER_SELECT = `id,order_number,receipt_number,order_type,order_source,status,customer_name,customer_id,final_total,discount_amount,delivery_fee,
  payment_status,payment_confirmed,payment_proof_path,refund_status,is_voided,created_at,updated_at,
  schedule_date,schedule_time,cancellation_status,fulfillment_hold,cancellation_requested_at,
  order_items(item_name,display_name,quantity,line_total),
  payments(method,status)`

function dayStart(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  d.setHours(0, 0, 0, 0)
  return d
}
function isoDay(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
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
    { data: menuItems, error: menuError },
    { data: customerMessages },
    { data: auditEvents },
    { data: portalConfiguration },
  ] = await Promise.all([
    supabase.from('orders').select(ORDER_SELECT).gte('created_at', windowStart.toISOString()).order('created_at', { ascending: true }),
    supabase.from('refunds').select('id,order_id,refund_status,refund_amount,requested_at,processed_at'),
    supabase.from('orders').select('customer_id,created_at').not('customer_id', 'is', null),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'customer'),
    supabase.from('ingredients').select('id,name,unit,supplier,expiration_date,is_archived,inventory_stock(quantity,min_stock_level,high_stock_level)').eq('is_archived', false),
    supabase.from('finished_products').select('id,name,unit,quantity,min_stock_level,high_stock_level,supplier,expiration_date,is_archived').eq('is_archived', false),
    supabase.from('menu_items').select('id,name,is_available,manual_available,unavailable_reason,is_archived').eq('is_archived', false),
    supabase.from('customer_messages').select('id,customer_name,subject,category,status,created_at').order('created_at', { ascending: false }).limit(100),
    supabase.from('portal_audit_events').select('id,occurred_at,actor_name_snapshot,module,summary,result,severity').order('occurred_at', { ascending: false }).limit(12),
    supabase.from('portal_configuration').select('key,value,updated_at').eq('scope', 'system'),
  ])
  if (ordersError) throw ordersError
  if (refundsError && refundsError.code !== '42P01') throw refundsError
  if (custError) throw custError
  if (customerCountError) throw customerCountError
  if (ingredientsError) throw ingredientsError
  if (finishedError) throw finishedError
  if (menuError) throw menuError

  return {
    orders: orders || [],
    refunds: refunds || [],
    allCustomerOrders: allCustomerOrders || [],
    totalCustomers: totalCustomers ?? 0,
    ingredients: ingredients || [],
    finishedProducts: finishedProducts || [],
    menuItems: menuItems || [],
    customerMessages: customerMessages || [],
    auditEvents: auditEvents || [],
    portalConfiguration: portalConfiguration || [],
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
  const {
    orders, refunds, allCustomerOrders, totalCustomers, ingredients, finishedProducts, menuItems,
    customerMessages = [], auditEvents = [], portalConfiguration = [],
  } = raw

  const today = isoDay(dayStart(0))
  const yesterday = isoDay(dayStart(-1))
  const todayOrders = orders.filter((o) => isoDay(new Date(o.created_at)) === today)
  const yesterdayOrders = orders.filter((o) => isoDay(new Date(o.created_at)) === yesterday)

  const countedToday = todayOrders.filter(isCounted)
  const totalSales = salesOf(todayOrders)
  const yesterdaySales = salesOf(yesterdayOrders)
  const salesChangePct = yesterdaySales > 0 ? ((totalSales - yesterdaySales) / yesterdaySales) * 100 : (totalSales > 0 ? 100 : 0)

  const totalOrders = countedToday.length
  const completedOrders = todayOrders.filter((o) => o.status === 'Completed').length
  const cancelledOrders = todayOrders.filter((o) => o.status === 'Cancelled').length
  const voidedOrders = todayOrders.filter((o) => o.is_voided).length
  const paidCompletedToday = todayOrders.filter(isPaidCompleted)
  const avgOrderValue = paidCompletedToday.length ? totalSales / paidCompletedToday.length : 0
  const completionRate = totalOrders ? (completedOrders / totalOrders) * 100 : 0

  const refundedToday = refunds.filter((r) => r.refund_status === 'processed' && r.processed_at && isoDay(new Date(r.processed_at)) === today)
  const refundedOrders = refundedToday.length
  const refundedAmount = refundedToday.reduce((s, r) => s + Number(r.refund_amount || 0), 0)

  const inventoryItems = [
    ...ingredients.map((i) => ({ id: i.id, name: i.name, unit: i.unit || 'unit', supplier: i.supplier || '', expirationDate: i.expiration_date, quantity: Number(i.inventory_stock?.[0]?.quantity ?? 0), min: Number(i.inventory_stock?.[0]?.min_stock_level ?? 0), healthy: Number(i.inventory_stock?.[0]?.high_stock_level ?? 0) })),
    ...finishedProducts.map((p) => ({ id: p.id, name: p.name, unit: p.unit || 'unit', supplier: p.supplier || '', expirationDate: p.expiration_date, quantity: Number(p.quantity), min: Number(p.min_stock_level), healthy: Number(p.high_stock_level) })),
  ]
  const lowStockItems = inventoryItems.filter((i) => i.min > 0 && i.quantity <= i.min).sort((a, b) => (a.quantity / a.min) - (b.quantity / b.min))
  const outOfStockItems = lowStockItems.filter((item) => item.quantity <= 0)
  const expiringItems = inventoryItems.filter((item) => {
    if (!item.expirationDate) return false
    const days = (new Date(item.expirationDate) - dayStart(0)) / 86400000
    return days >= 0 && days <= 7
  })
  const unavailableMenuItems = menuItems.filter((m) => !m.is_available).length
  const stockBlockedMenuItems = menuItems.filter((m) => ['missing_ingredient', 'insufficient_stock'].includes(m.unavailable_reason)).length

  const salesByDay = new Map()
  const ordersByDay = new Map()
  const paidOrdersByDay = new Map()
  orders.filter(isCounted).forEach((o) => {
    const day = isoDay(new Date(o.created_at))
    ordersByDay.set(day, (ordersByDay.get(day) || 0) + 1)
  })
  orders.filter(isPaidCompleted).forEach((o) => {
    const day = isoDay(new Date(o.created_at))
    salesByDay.set(day, (salesByDay.get(day) || 0) + Number(o.final_total || 0))
    paidOrdersByDay.set(day, (paidOrdersByDay.get(day) || 0) + 1)
  })
  const salesTrend = []
  const ordersTrend = []
  const averageOrderTrend = []
  for (let i = 13; i >= 0; i -= 1) {
    const day = isoDay(dayStart(-i))
    const sales = salesByDay.get(day) || 0
    const paidOrders = paidOrdersByDay.get(day) || 0
    salesTrend.push({ day, total: sales })
    ordersTrend.push({ day, total: ordersByDay.get(day) || 0 })
    averageOrderTrend.push({ day, total: paidOrders ? sales / paidOrders : 0 })
  }

  const fulfillmentCounts = { delivery: 0, pickup: 0, 'walk-in': 0 }
  countedToday.forEach((o) => { fulfillmentCounts[o.order_type] = (fulfillmentCounts[o.order_type] || 0) + 1 })

  const paymentTotals = {}
  const paymentUsage = {}
  paidCompletedToday.forEach((o) => {
    const method = o.payments?.[0]?.method || 'other'
    const amount = Number(o.final_total || 0)
    paymentTotals[method] = (paymentTotals[method] || 0) + amount
    const usage = paymentUsage[method] || { count: 0, revenue: 0 }
    usage.count += 1
    usage.revenue += amount
    paymentUsage[method] = usage
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

  const attentionOrders = orders.filter((order) => {
    const awaitingPayment = ['Order Received', 'Awaiting Payment Verification', 'Pending Confirmation'].includes(order.status)
      && ((order.payment_proof_path && !order.payment_confirmed) || order.payments?.[0]?.method === 'cod')
    return awaitingPayment || order.cancellation_status === 'requested' || order.fulfillment_hold
  })
  const orderStageCounts = { pending: 0, preparing: 0, ready: 0, delivery: 0, completed: 0, overdue: 0 }
  countedToday.forEach((order) => {
    if (['Order Received', 'Awaiting Payment Verification', 'Pending Confirmation', 'Confirmed'].includes(order.status)) orderStageCounts.pending += 1
    else if (order.status === 'Preparing') orderStageCounts.preparing += 1
    else if (order.status === 'Ready for Pickup') orderStageCounts.ready += 1
    else if (order.status === 'Out for Delivery') orderStageCounts.delivery += 1
    else if (order.status === 'Completed') orderStageCounts.completed += 1
    if (order.schedule_date && order.schedule_time && !['Completed', 'Cancelled'].includes(order.status)) {
      const scheduled = new Date(`${order.schedule_date}T${order.schedule_time}`)
      if (!Number.isNaN(scheduled.getTime()) && scheduled < new Date()) orderStageCounts.overdue += 1
    }
  })

  const pendingRefunds = refunds.filter((refund) => ['pending_review', 'pending', 'approved', 'processing', 'failed'].includes(refund.refund_status))
  const pendingRefundAmount = pendingRefunds.reduce((sum, refund) => sum + Number(refund.refund_amount || 0), 0)
  const awaitingMessages = customerMessages.filter((message) => message.status !== 'replied')
  const messagesToday = customerMessages.filter((message) => message.created_at && isoDay(new Date(message.created_at)) === today).length
  const criticalAuditEvents = auditEvents.filter((event) => event.severity === 'critical' || event.result === 'failed')
  const orderingConfig = portalConfiguration.find((entry) => entry.key === 'ordering')?.value || {}

  const firstOrderByCustomer = new Map()
  allCustomerOrders.forEach((o) => {
    const existing = firstOrderByCustomer.get(o.customer_id)
    if (!existing || o.created_at < existing) firstOrderByCustomer.set(o.customer_id, o.created_at)
  })
  const customersToday = new Set(countedToday.filter((o) => o.customer_id).map((o) => o.customer_id))
  let newCustomers = 0, returningCustomers = 0
  customersToday.forEach((id) => {
    const firstOrder = firstOrderByCustomer.get(id)
    if (firstOrder && isoDay(new Date(firstOrder)) === today) newCustomers += 1
    else returningCustomers += 1
  })

  return {
    totalSales, salesChangePct, totalOrders, avgOrderValue, completionRate,
    totalCustomers,
    completedOrders, cancelledOrders, voidedOrders, refundedOrders, refundedAmount,
    lowStockItems, outOfStockItems, expiringItems, unavailableMenuItems, stockBlockedMenuItems,
    salesTrend, ordersTrend, averageOrderTrend, fulfillmentCounts, paymentTotals, paymentUsage, bestSellers, recentOrders, newCustomers, returningCustomers,
    attentionOrders, orderStageCounts, pendingRefunds, pendingRefundAmount,
    awaitingMessages, messagesToday, auditEvents, criticalAuditEvents,
    storeStatus: orderingConfig.storeStatus || 'open',
  }
}
