import { supabase } from '../lib/supabase'

const FETCH_CAP = 5000

const ORDER_SELECT = `id,order_number,receipt_number,order_type,order_source,status,customer_id,customer_name,
  schedule_date,subtotal,discount_type,discount_amount,delivery_fee,final_total,
  payment_status,payment_confirmed,refund_status,is_voided,created_at,
  order_items(menu_item_id,item_name,display_name,quantity,line_total),
  payments(method,status),
  refunds(refund_amount,refund_status,processed_at)`

const PREVIOUS_SELECT = `id,order_type,status,schedule_date,subtotal,discount_amount,delivery_fee,final_total,is_voided,created_at,
  payment_status,payment_confirmed,
  order_items(quantity),
  payments(method,status),
  refunds(refund_amount,refund_status)`

export const PAYMENT_LABEL = { cash: 'Cash', gcash: 'GCash', bank_transfer: 'Bank Transfer', cod: 'Cash on Delivery', other: 'Other' }
export const ORDER_TYPE_LABEL = { 'walk-in': 'Dine-in', pickup: 'Takeout', delivery: 'Delivery', preorder: 'Preorder' }
const PAID_STATES = new Set(['paid', 'verified', 'confirmed'])

function normalizeOrder(row, categoryByMenuItem = {}) {
  const payment = row.payments?.[0] || null
  const items = (row.order_items || []).map((item) => ({
    menuItemId: item.menu_item_id || null,
    name: item.display_name || item.item_name || 'Unknown item',
    category: (item.menu_item_id && categoryByMenuItem[item.menu_item_id]) || 'Other',
    quantity: Number(item.quantity || 0),
    lineTotal: Number(item.line_total || 0),
  }))
  const refundedAmount = (row.refunds || [])
    .filter((refund) => refund.refund_status === 'processed')
    .reduce((sum, refund) => sum + Number(refund.refund_amount || 0), 0)
  return {
    id: row.id,
    orderNumber: row.order_number,
    receiptNumber: row.receipt_number,
    orderType: row.order_type,
    isPreorder: Boolean(row.schedule_date),
    typeKey: row.schedule_date ? 'preorder' : row.order_type,
    orderSource: row.order_source,
    status: row.status,
    customerName: row.customer_name || 'Walk-in Customer',
    isGuest: !row.customer_id,
    subtotal: Number(row.subtotal || 0),
    discountAmount: Number(row.discount_amount || 0),
    deliveryFee: Number(row.delivery_fee || 0),
    finalTotal: Number(row.final_total || 0),
    netRevenue: Number(row.final_total || 0) - Number(row.delivery_fee || 0),
    paymentStatus: row.payment_status,
    paymentRecordStatus: payment?.status || row.payment_status || '',
    paymentConfirmed: Boolean(row.payment_confirmed),
    paymentMethod: payment?.method || 'other',
    refundStatus: row.refund_status,
    refundedAmount,
    isVoided: Boolean(row.is_voided),
    isCancelled: row.status === 'Cancelled' || Boolean(row.is_voided),
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    createdAt: row.created_at,
  }
}

async function fetchCategoryMap(menuItemIds) {
  const ids = [...new Set((menuItemIds || []).filter(Boolean))]
  if (!ids.length) return {}
  const { data, error } = await supabase
    .from('menu_items')
    .select('id,main_categories(name,display_name)')
    .in('id', ids)
  if (error) throw error
  return Object.fromEntries((data || []).map((row) => [
    row.id,
    row.main_categories?.display_name || row.main_categories?.name || 'Other',
  ]))
}

export async function fetchSalesReportData({ dateFrom, dateTo, prevFrom, prevTo }) {
  let currentQuery = supabase.from('orders').select(ORDER_SELECT).order('created_at', { ascending: true }).limit(FETCH_CAP)
  if (dateFrom) currentQuery = currentQuery.gte('created_at', dateFrom)
  if (dateTo) currentQuery = currentQuery.lte('created_at', dateTo)

  let previousQuery = supabase.from('orders').select(PREVIOUS_SELECT).order('created_at', { ascending: true }).limit(FETCH_CAP)
  if (prevFrom) previousQuery = previousQuery.gte('created_at', prevFrom)
  if (prevTo) previousQuery = previousQuery.lte('created_at', prevTo)

  const [{ data: current, error: currentError }, { data: previous, error: previousError }] = await Promise.all([currentQuery, previousQuery])
  if (currentError) throw currentError
  if (previousError) throw previousError

  const menuItemIds = (current || []).flatMap((row) => (row.order_items || []).map((item) => item.menu_item_id))
  let categoryByMenuItem = {}
  try {
    categoryByMenuItem = await fetchCategoryMap(menuItemIds)
  } catch {
    categoryByMenuItem = {}
  }

  return {
    orders: (current || []).map((row) => normalizeOrder(row, categoryByMenuItem)),
    previousOrders: (previous || []).map((row) => normalizeOrder(row)),
    truncated: (current || []).length >= FETCH_CAP,
  }
}

// A sale is only counted after completion and payment confirmation. This keeps
// Sales Reports aligned with the settled-sale definition used by Transaction History.
export function isRevenueOrder(order) {
  if (order.isVoided || String(order.status || '').toLowerCase() !== 'completed') return false
  const orderPayment = String(order.paymentStatus || '').toLowerCase()
  const recordPayment = String(order.paymentRecordStatus || '').toLowerCase()
  return Boolean(order.paymentConfirmed) || PAID_STATES.has(orderPayment) || PAID_STATES.has(recordPayment)
}

export function applyLocalFilters(orders, { orderType = 'all', paymentMethod = 'all' } = {}) {
  return orders.filter((order) => {
    if (orderType !== 'all' && order.typeKey !== orderType) return false
    if (paymentMethod !== 'all' && order.paymentMethod !== paymentMethod) return false
    return true
  })
}

function summarize(orders) {
  const revenueOrders = orders.filter(isRevenueOrder)
  const grossSales = revenueOrders.reduce((sum, order) => sum + order.subtotal, 0)
  const discounts = revenueOrders.reduce((sum, order) => sum + order.discountAmount, 0)
  const deliveryFees = revenueOrders.reduce((sum, order) => sum + order.deliveryFee, 0)
  const refunds = revenueOrders.reduce((sum, order) => sum + order.refundedAmount, 0)
  const netRevenue = grossSales - discounts - refunds
  return {
    grossSales,
    discounts,
    deliveryFees,
    refunds,
    netRevenue,
    totalOrders: revenueOrders.length,
    totalItems: revenueOrders.reduce((sum, order) => sum + order.itemCount, 0),
    cancelledOrders: orders.filter((order) => order.isCancelled).length,
    averageOrderValue: revenueOrders.length ? netRevenue / revenueOrders.length : 0,
  }
}

function changePct(current, previous) {
  if (previous > 0) return ((current - previous) / previous) * 100
  return current > 0 ? 100 : 0
}

const STATUS_BUCKETS = [
  ['completed', 'Completed'],
  ['preparing', 'Preparing'],
  ['ready', 'Ready'],
  ['cancelled', 'Cancelled'],
  ['refunded', 'Refunded'],
]

export function statusBucket(order) {
  if (order.refundedAmount > 0 || order.refundStatus === 'processed') return 'refunded'
  if (order.isCancelled) return 'cancelled'
  if (['Completed', 'Received'].includes(order.status)) return 'completed'
  if (order.status === 'Preparing') return 'preparing'
  if (order.status === 'Ready for Pickup' || order.status === 'Out for Delivery') return 'ready'
  return 'other'
}

export function computeSalesReport(orders, previousOrders) {
  const summary = summarize(orders)
  const previousSummary = summarize(previousOrders)

  const comparison = {
    revenuePct: changePct(summary.netRevenue, previousSummary.netRevenue),
    ordersPct: changePct(summary.totalOrders, previousSummary.totalOrders),
    itemsPct: changePct(summary.totalItems, previousSummary.totalItems),
    cancelledPct: changePct(summary.cancelledOrders, previousSummary.cancelledOrders),
  }

  const ordersByStatus = Object.fromEntries(STATUS_BUCKETS.map(([key]) => [key, 0]))
  ordersByStatus.other = 0
  orders.forEach((order) => { ordersByStatus[statusBucket(order)] += 1 })

  const paymentTotals = {}
  orders.filter(isRevenueOrder).forEach((order) => {
    const method = order.paymentMethod || 'other'
    paymentTotals[method] = (paymentTotals[method] || 0) + Math.max(0, order.netRevenue - order.refundedAmount)
  })

  const orderTypeCounts = { 'walk-in': 0, pickup: 0, delivery: 0, preorder: 0 }
  const orderChannelCounts = { 'walk-in': 0, pickup: 0, delivery: 0 }
  orders.filter(isRevenueOrder).forEach((order) => {
    orderTypeCounts[order.typeKey] = (orderTypeCounts[order.typeKey] || 0) + 1
    const channelKey = ['walk-in', 'pickup', 'delivery'].includes(order.orderType)
      ? order.orderType
      : ['walk-in', 'pickup', 'delivery'].includes(order.typeKey) ? order.typeKey : null
    if (channelKey) orderChannelCounts[channelKey] += 1
  })

  const productAgg = new Map()
  orders.filter(isRevenueOrder).forEach((order) => {
    order.items.forEach((item) => {
      const entry = productAgg.get(item.name) || { name: item.name, category: item.category, qty: 0, revenue: 0 }
      entry.qty += item.quantity
      entry.revenue += item.lineTotal
      productAgg.set(item.name, entry)
    })
  })
  const productRevenue = [...productAgg.values()].reduce((sum, product) => sum + product.revenue, 0)
  const productRows = [...productAgg.values()].map((product) => ({
    ...product,
    pct: productRevenue > 0 ? (product.revenue / productRevenue) * 100 : 0,
  }))
  const topProducts = [...productRows]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)
  const leastOrderedProducts = [...productRows]
    .sort((a, b) => a.qty - b.qty || a.revenue - b.revenue || a.name.localeCompare(b.name))
    .slice(0, 10)

  return { summary, previousSummary, comparison, ordersByStatus, paymentTotals, orderTypeCounts, orderChannelCounts, topProducts, leastOrderedProducts, productRevenue, productCount: productAgg.size }
}

// ---- Trend bucketing ------------------------------------------------------

function isoDay(date) {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function weekStart(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay())
  return d
}

function monthStart(date) {
  const d = new Date(date)
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function bucketKey(date, granularity) {
  if (granularity === 'week') return isoDay(weekStart(date))
  if (granularity === 'month') return isoDay(monthStart(date))
  return isoDay(date)
}

function nextBucket(date, granularity) {
  const d = new Date(date)
  if (granularity === 'week') d.setDate(d.getDate() + 7)
  else if (granularity === 'month') d.setMonth(d.getMonth() + 1)
  else d.setDate(d.getDate() + 1)
  return d
}

function trendBucketStart(date, granularity) {
  if (granularity === 'week') return weekStart(date)
  if (granularity === 'month') return monthStart(date)
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function previousTrendBucketStart(from, to, granularity) {
  const rangeLength = Math.max(1, to.getTime() - from.getTime() + 1)
  return trendBucketStart(new Date(from.getTime() - rangeLength), granularity)
}

function bucketLabel(key, granularity) {
  const date = new Date(`${key}T00:00:00`)
  if (granularity === 'month') return new Intl.DateTimeFormat('en-PH', { month: 'short', year: 'numeric' }).format(date)
  if (granularity === 'week') {
    const end = new Date(date)
    end.setDate(end.getDate() + 6)
    const fmt = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' })
    return `${fmt.format(date)} - ${fmt.format(end)}`
  }
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' }).format(date)
}

const MAX_TREND_BUCKETS = 62

export function buildTrend(orders, previousOrders, { dateFrom, dateTo, granularity = 'day' }) {
  const from = dateFrom ? new Date(dateFrom) : (orders.length ? new Date(orders[0].createdAt) : new Date())
  const to = dateTo ? new Date(dateTo) : new Date()

  const totalsByBucket = new Map()
  orders.filter(isRevenueOrder).forEach((order) => {
    const key = bucketKey(new Date(order.createdAt), granularity)
    const entry = totalsByBucket.get(key) || { revenue: 0, orders: 0 }
    entry.revenue += order.netRevenue - order.refundedAmount
    entry.orders += 1
    totalsByBucket.set(key, entry)
  })

  // Align the previous period to the full comparison range, including empty
  // buckets, so both lines stay on the same chart positions.
  const previousByBucket = new Map()
  previousOrders.filter(isRevenueOrder).forEach((order) => {
    const key = bucketKey(new Date(order.createdAt), granularity)
    previousByBucket.set(key, (previousByBucket.get(key) || 0) + order.netRevenue - order.refundedAmount)
  })
  const hasPreviousData = previousByBucket.size > 0

  const points = []
  let cursor = granularity === 'week' ? weekStart(from) : granularity === 'month' ? monthStart(from) : new Date(from)
  cursor.setHours(0, 0, 0, 0)
  let previousCursor = previousTrendBucketStart(from, to, granularity)
  while (cursor <= to && points.length < MAX_TREND_BUCKETS) {
    const key = bucketKey(cursor, granularity)
    const entry = totalsByBucket.get(key) || { revenue: 0, orders: 0 }
    points.push({
      key,
      label: bucketLabel(key, granularity),
      revenue: entry.revenue,
      orders: entry.orders,
      previousRevenue: hasPreviousData ? previousByBucket.get(bucketKey(previousCursor, granularity)) || 0 : null,
    })
    cursor = nextBucket(cursor, granularity)
    previousCursor = nextBucket(previousCursor, granularity)
  }
  return points
}

function aggregateTrendBuckets(orders, granularity) {
  const buckets = new Map()
  orders.filter(isRevenueOrder).forEach((order) => {
    const key = bucketKey(new Date(order.createdAt), granularity)
    const entry = buckets.get(key) || { revenue: 0, orders: 0, units: 0 }
    entry.revenue += Math.max(0, order.netRevenue - order.refundedAmount)
    entry.orders += 1
    entry.units += order.itemCount
    buckets.set(key, entry)
  })
  return buckets
}

function channelKeyForTrend(order) {
  if (['walk-in', 'pickup', 'delivery'].includes(order.orderType)) return order.orderType
  if (['walk-in', 'pickup', 'delivery'].includes(order.typeKey)) return order.typeKey
  return null
}

// Trend-only series with revenue, order, and unit metrics. Both trend builders
// use the same full-range previous-period alignment for consistent charts.
export function buildTrendMetrics(orders, previousOrders, { dateFrom, dateTo, granularity = 'day' }) {
  const from = dateFrom ? new Date(dateFrom) : (orders.length ? new Date(orders[0].createdAt) : new Date())
  const to = dateTo ? new Date(dateTo) : new Date()
  const currentBuckets = aggregateTrendBuckets(orders, granularity)
  const previousBuckets = aggregateTrendBuckets(previousOrders, granularity)
  const hasPreviousData = previousBuckets.size > 0

  const points = []
  let cursor = granularity === 'week' ? weekStart(from) : granularity === 'month' ? monthStart(from) : new Date(from)
  cursor.setHours(0, 0, 0, 0)
  let previousCursor = previousTrendBucketStart(from, to, granularity)
  while (cursor <= to && points.length < MAX_TREND_BUCKETS) {
    const key = bucketKey(cursor, granularity)
    const entry = currentBuckets.get(key) || { revenue: 0, orders: 0, units: 0 }
    const previous = hasPreviousData
      ? previousBuckets.get(bucketKey(previousCursor, granularity)) || { revenue: 0, orders: 0, units: 0 }
      : null
    points.push({
      key,
      label: bucketLabel(key, granularity),
      revenue: entry.revenue,
      orders: entry.orders,
      units: entry.units,
      previousRevenue: previous ? previous.revenue : null,
      previousOrders: previous ? previous.orders : null,
      previousUnits: previous ? previous.units : null,
    })
    cursor = nextBucket(cursor, granularity)
    previousCursor = nextBucket(previousCursor, granularity)
  }
  return points
}

export function buildChannelTrend(orders, { dateFrom, dateTo, granularity = 'day' }) {
  const from = dateFrom ? new Date(dateFrom) : (orders.length ? new Date(orders[0].createdAt) : new Date())
  const to = dateTo ? new Date(dateTo) : new Date()
  const buckets = new Map()
  orders.filter(isRevenueOrder).forEach((order) => {
    const channel = channelKeyForTrend(order)
    if (!channel) return
    const key = bucketKey(new Date(order.createdAt), granularity)
    const entry = buckets.get(key) || { delivery: 0, pickup: 0, 'walk-in': 0 }
    entry[channel] += 1
    buckets.set(key, entry)
  })

  const points = []
  let cursor = granularity === 'week' ? weekStart(from) : granularity === 'month' ? monthStart(from) : new Date(from)
  cursor.setHours(0, 0, 0, 0)
  while (cursor <= to && points.length < MAX_TREND_BUCKETS) {
    const key = bucketKey(cursor, granularity)
    const entry = buckets.get(key) || { delivery: 0, pickup: 0, 'walk-in': 0 }
    points.push({ key, label: bucketLabel(key, granularity), ...entry, total: entry.delivery + entry.pickup + entry['walk-in'] })
    cursor = nextBucket(cursor, granularity)
  }
  return points
}

function aggregateProductsForMomentum(orders) {
  const products = new Map()
  orders.filter(isRevenueOrder).forEach((order) => {
    order.items.forEach((item) => {
      const entry = products.get(item.name) || { name: item.name, category: item.category, revenue: 0, units: 0 }
      entry.revenue += item.lineTotal
      entry.units += item.quantity
      products.set(item.name, entry)
    })
  })
  return products
}

export function computeProductMomentum(orders, previousOrders, limit = 8) {
  const currentProducts = aggregateProductsForMomentum(orders)
  const previousProducts = aggregateProductsForMomentum(previousOrders)
  const names = new Set([...currentProducts.keys(), ...previousProducts.keys()])
  return [...names]
    .map((name) => {
      const current = currentProducts.get(name) || { name, category: 'Other', revenue: 0, units: 0 }
      const previous = previousProducts.get(name) || { name, category: current.category, revenue: 0, units: 0 }
      const revenueDelta = current.revenue - previous.revenue
      return {
        name,
        category: current.category || previous.category || 'Other',
        revenue: current.revenue,
        previousRevenue: previous.revenue,
        units: current.units,
        previousUnits: previous.units,
        revenueDelta,
        unitsDelta: current.units - previous.units,
        changePct: changePct(current.revenue, previous.revenue),
        direction: revenueDelta > 0 ? 'up' : revenueDelta < 0 ? 'down' : 'flat',
      }
    })
    .filter((product) => product.revenue > 0 || product.previousRevenue > 0)
    .sort((a, b) => Math.abs(b.revenueDelta) - Math.abs(a.revenueDelta) || b.revenue - a.revenue)
    .slice(0, limit)
}

// ---- Exports ---------------------------------------------------------------

const money = (value) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value || 0)

export function exportSalesReportCsv({ orders, summary, filterLabel, generatedBy }) {
  const headers = ['Order Number', 'Date', 'Customer', 'Order Type', 'Payment Method', 'Items Sold', 'Gross Amount', 'Discount', 'Delivery Fee', 'Refunded', 'Net Revenue', 'Status']
  const rows = orders.map((order) => [
    order.orderNumber,
    new Date(order.createdAt).toISOString(),
    order.customerName,
    ORDER_TYPE_LABEL[order.typeKey] || order.typeKey,
    PAYMENT_LABEL[order.paymentMethod] || order.paymentMethod,
    order.itemCount,
    order.subtotal.toFixed(2),
    order.discountAmount.toFixed(2),
    order.deliveryFee.toFixed(2),
    order.refundedAmount.toFixed(2),
    (order.isCancelled ? 0 : order.netRevenue - order.refundedAmount).toFixed(2),
    order.isVoided ? 'Voided' : order.status,
  ])
  const meta = [
    ['Sales Report'],
    ['Period', filterLabel],
    ['Generated at', new Date().toISOString()],
    ['Generated by', generatedBy || 'Unknown'],
    ['Total orders', summary.totalOrders],
    ['Gross sales', summary.grossSales.toFixed(2)],
    ['Discounts', summary.discounts.toFixed(2)],
    ['Refunds', summary.refunds.toFixed(2)],
    ['Delivery fees (excluded from revenue)', summary.deliveryFees.toFixed(2)],
    ['Net revenue', summary.netRevenue.toFixed(2)],
    [],
  ]
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`
  return [...meta, headers, ...rows].map((row) => row.map(escape).join(',')).join('\n')
}

export function printSalesReportPdf({ report, trend, filterLabel, generatedBy }) {
  const win = window.open('', '_blank', 'width=840,height=920')
  if (!win) return false
  const { summary, ordersByStatus, paymentTotals, orderTypeCounts, topProducts } = report
  const row = (label, value) => `<tr><td>${label}</td><td style="text-align:right;font-weight:700">${value}</td></tr>`
  win.document.write(`<!doctype html><html><head><title>Sales Report</title>
    <style>
      body{font-family:Arial,sans-serif;color:#1b2f22;padding:32px;max-width:680px;margin:auto}
      h1{font-size:1.4rem;margin-bottom:4px} p{color:#64748b;font-size:.85rem;margin:2px 0}
      table{width:100%;border-collapse:collapse;margin-top:14px} td,th{padding:9px 4px;border-bottom:1px solid #e5e7eb;font-size:.88rem;text-align:left}
      th{font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:#68736b}
      h2{font-size:1rem;margin-top:28px;border-bottom:2px solid #1b2f22;padding-bottom:6px}
      .num{text-align:right}
    </style></head><body>
    <h1>thecoffeerealm - Sales Report</h1>
    <p>Period: ${filterLabel}</p>
    <p>Generated: ${new Date().toLocaleString('en-PH')} by ${generatedBy || 'Unknown'}</p>
    <h2>Summary</h2>
    <table>
      ${row('Gross Sales', money(summary.grossSales))}
      ${row('Discounts', `- ${money(summary.discounts)}`)}
      ${row('Refunds', `- ${money(summary.refunds)}`)}
      ${row('Net Revenue', money(summary.netRevenue))}
      ${row('Delivery Fees (pass-through)', money(summary.deliveryFees))}
      ${row('Total Orders', summary.totalOrders)}
      ${row('Total Items Sold', summary.totalItems)}
      ${row('Cancelled Orders', summary.cancelledOrders)}
      ${row('Average Order Value', money(summary.averageOrderValue))}
    </table>
    <h2>Orders by Status</h2>
    <table>
      ${row('Completed', ordersByStatus.completed)}
      ${row('Preparing', ordersByStatus.preparing)}
      ${row('Ready / In Transit', ordersByStatus.ready)}
      ${row('Cancelled', ordersByStatus.cancelled)}
      ${row('Refunded', ordersByStatus.refunded)}
      ${ordersByStatus.other ? row('Other', ordersByStatus.other) : ''}
    </table>
    <h2>Revenue by Payment Method</h2>
    <table>
      ${Object.entries(paymentTotals).map(([method, amount]) => row(PAYMENT_LABEL[method] || method, money(amount))).join('') || row('No settled payments', '-')}
    </table>
    <h2>Orders by Type</h2>
    <table>
      ${Object.entries(orderTypeCounts).map(([type, count]) => row(ORDER_TYPE_LABEL[type] || type, count)).join('')}
    </table>
    <h2>Top-Selling Products</h2>
    <table>
      <tr><th>Product</th><th>Category</th><th class="num">Qty</th><th class="num">Revenue</th><th class="num">Share</th></tr>
      ${topProducts.map((product) => `<tr><td>${product.name}</td><td>${product.category}</td><td class="num">${product.qty}</td><td class="num">${money(product.revenue)}</td><td class="num">${product.pct.toFixed(1)}%</td></tr>`).join('') || '<tr><td colspan="5">No product sales in this period.</td></tr>'}
    </table>
    <h2>Revenue Trend</h2>
    <table>
      <tr><th>Period</th><th class="num">Orders</th><th class="num">Revenue</th></tr>
      ${trend.map((point) => `<tr><td>${point.label}</td><td class="num">${point.orders}</td><td class="num">${money(point.revenue)}</td></tr>`).join('')}
    </table>
    </body></html>`)
  win.document.close()
  win.focus()
  win.print()
  return true
}
