import { supabase } from '../lib/supabase'

const FETCH_CAP = 5000

const REPORT_SELECT = `id,order_number,receipt_number,order_type,order_source,status,customer_id,customer_name,customer_email,customer_phone,
  subtotal,discount_amount,delivery_fee,final_total,payment_status,cancellation_reason,cancellation_notes,cancelled_by_role,cancelled_at,
  refund_status,is_voided,voided_reason,voided_at,cashier_id,created_at,updated_at,
  order_items(id,item_name,display_name,unit_price,quantity,addons_total,line_total,addons,customizations),
  payments(id,method,status,reference_number,amount_due,amount_received,change_amount,paid_at,confirmed_at),
  refunds(id,refund_amount,original_amount,refund_status,refund_reason,refund_method,reference_number,requested_at,processed_at)`

export const PAYMENT_LABEL = {
  cash: 'Cash',
  cod: 'Cash on Delivery',
  gcash: 'GCash',
  bank_transfer: 'Bank Transfer',
  other: 'Other',
}

export const ORDER_TYPE_LABEL = {
  delivery: 'Delivery',
  pickup: 'Pickup',
  'walk-in': 'Walk-in',
  preorder: 'Preorder',
}

export const REFUND_STATUS_LABEL = {
  pending: 'Pending',
  processing: 'Processing',
  processed: 'Completed',
  completed: 'Completed',
  failed: 'Failed',
  rejected: 'Failed',
  not_applicable: 'Not Applicable',
}

function startCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function normalizeRefundStatus(row, refunds) {
  const statuses = refunds.map((refund) => String(refund.status || '').toLowerCase())
  const raw = String(row.refund_status || '').toLowerCase()
  if (statuses.includes('processed') || statuses.includes('completed') || raw === 'processed' || raw === 'completed') return 'processed'
  if (statuses.includes('processing') || raw === 'processing') return 'processing'
  if (statuses.includes('pending') || raw === 'pending') return 'pending'
  if (statuses.some((status) => status === 'failed' || status === 'rejected') || raw === 'failed' || raw === 'rejected') return 'failed'
  return 'not_applicable'
}

function normalizeCancelledByRole(value, isVoided) {
  const role = String(value || (isVoided ? 'admin' : 'system')).toLowerCase().replace(/[_-]+/g, ' ').trim()
  if (role === 'operations staff' || role === 'operational staff') return 'staff'
  if (role === 'automatic' || role === 'automated') return 'system'
  return role || 'system'
}

function eventDate(row, refunds) {
  const refundDates = refunds.flatMap((refund) => [refund.processedAt, refund.requestedAt]).filter(Boolean)
  const dates = [row.cancelled_at, row.voided_at, ...refundDates, row.updated_at, row.created_at]
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => b - a)
  return dates[0]?.toISOString() || row.created_at
}

function normalize(row, staffNames = {}, cancellationByOrder = {}) {
  const cancellationAudit = cancellationByOrder[row.id] || null
  const payment = row.payments?.[0] || null
  const refunds = (row.refunds || []).map((refund) => ({
    id: refund.id,
    amount: Number(refund.refund_amount || 0),
    originalAmount: Number(refund.original_amount || 0),
    status: refund.refund_status,
    reason: refund.refund_reason || '',
    method: refund.refund_method || '',
    referenceNumber: refund.reference_number || '',
    requestedAt: refund.requested_at,
    processedAt: refund.processed_at,
  }))
  const refundStatus = normalizeRefundStatus(row, refunds)
  const completedRefundAmount = refunds
    .filter((refund) => ['processed', 'completed'].includes(String(refund.status || '').toLowerCase()))
    .reduce((total, refund) => total + refund.amount, 0)
  const latestRefund = [...refunds].sort((a, b) => new Date(b.processedAt || b.requestedAt || 0) - new Date(a.processedAt || a.requestedAt || 0))[0]
  const cancelledByKey = normalizeCancelledByRole(cancellationAudit?.cancelled_by_role || row.cancelled_by_role, row.is_voided)

  const record = {
    id: row.id,
    orderNumber: row.order_number || row.id,
    receiptNumber: row.receipt_number || '',
    orderType: row.order_type || 'walk-in',
    orderSource: row.order_source || '',
    status: row.status || 'Cancelled',
    customerName: row.customer_name || 'Guest Customer',
    customerEmail: row.customer_email || '',
    customerPhone: row.customer_phone || '',
    originalAmount: Number(row.final_total || 0),
    subtotal: Number(row.subtotal || 0),
    discountAmount: Number(row.discount_amount || 0),
    deliveryFee: Number(row.delivery_fee || 0),
    paymentMethod: payment?.method || 'other',
    paymentStatus: payment?.status || row.payment_status || 'unpaid',
    paymentReference: payment?.reference_number || latestRefund?.referenceNumber || '',
    amountReceived: payment?.amount_received == null ? null : Number(payment.amount_received || 0),
    changeAmount: payment?.change_amount == null ? null : Number(payment.change_amount || 0),
    isCancelled: row.status === 'Cancelled' || Boolean(row.cancelled_at) || Boolean(row.is_voided),
    isVoided: Boolean(row.is_voided),
    cancellationReason: cancellationAudit?.cancellation_reason || row.cancellation_reason || row.voided_reason || latestRefund?.reason || 'Reason not specified',
    cancellationNotes: cancellationAudit?.cancellation_notes || row.cancellation_notes || '',
    cancelledByKey,
    cancelledBy: staffNames[cancellationAudit?.cancelled_by] || staffNames[row.cashier_id] || startCase(cancelledByKey) || 'System',
    cancelledAt: cancellationAudit?.created_at || row.cancelled_at || row.voided_at,
    refundStatus,
    refundAmount: completedRefundAmount,
    refunds,
    items: (row.order_items || []).map((item) => ({
      id: item.id,
      name: item.display_name || item.item_name || 'Menu item',
      unitPrice: Number(item.unit_price || 0),
      quantity: Number(item.quantity || 0),
      addonsTotal: Number(item.addons_total || 0),
      lineTotal: Number(item.line_total || 0),
      addons: item.addons || [],
      customizations: item.customizations || {},
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
  record.eventDate = eventDate({ ...row, cancelled_at: record.cancelledAt }, refunds)
  return record
}

async function fetchStaffNames(ids) {
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  if (!uniqueIds.length) return {}
  const { data, error } = await supabase.from('profiles').select('id,full_name').in('id', uniqueIds)
  if (error) throw error
  return Object.fromEntries((data || []).map((profile) => [profile.id, profile.full_name || 'Staff member']))
}

export async function fetchCancellationReportRecords() {
  const { data, error } = await supabase
    .from('orders')
    .select(REPORT_SELECT)
    .or('status.eq.Cancelled,refund_status.in.(pending,processing,processed,completed,failed,rejected),is_voided.eq.true')
    .order('updated_at', { ascending: false })
    .limit(FETCH_CAP)
  if (error) throw error

  let cancellationRows = []
  try {
    const { data: cancellations, error: cancellationError } = await supabase
      .from('order_cancellations')
      .select('order_id,cancellation_reason,cancellation_notes,cancelled_by,cancelled_by_role,created_at')
      .order('created_at', { ascending: false })
      .limit(FETCH_CAP)
    if (cancellationError) throw cancellationError
    cancellationRows = cancellations || []
  } catch {
    cancellationRows = []
  }
  const cancellationByOrder = Object.fromEntries(cancellationRows.map((cancellation) => [cancellation.order_id, cancellation]))
  const staffNames = await fetchStaffNames([
    ...(data || []).map((row) => row.cashier_id),
    ...cancellationRows.map((cancellation) => cancellation.cancelled_by),
  ])
  return {
    records: (data || []).map((row) => normalize(row, staffNames, cancellationByOrder)),
    truncated: (data || []).length >= FETCH_CAP,
  }
}

function countBy(records, valueForRecord) {
  return records.reduce((counts, record) => {
    const value = valueForRecord(record) || 'Not specified'
    counts[value] = (counts[value] || 0) + 1
    return counts
  }, {})
}

function percentageChange(current, previous) {
  if (previous > 0) return ((current - previous) / previous) * 100
  return current > 0 ? 100 : 0
}

export function filterByDateRange(records, from, to) {
  const fromTime = from ? new Date(from).getTime() : -Infinity
  const toTime = to ? new Date(to).getTime() : Infinity
  return records.filter((record) => {
    const eventTime = new Date(record.eventDate).getTime()
    return eventTime >= fromTime && eventTime <= toTime
  })
}

export function computeCancellationSummary(records, previousRecords) {
  const cancelled = records.filter((record) => record.isCancelled)
  const refunded = records.filter((record) => record.refundStatus === 'processed')
  const previousCancelled = previousRecords.filter((record) => record.isCancelled)
  const previousRefunded = previousRecords.filter((record) => record.refundStatus === 'processed')
  const cancelledValue = cancelled.reduce((total, record) => total + record.originalAmount, 0)
  const previousCancelledValue = previousCancelled.reduce((total, record) => total + record.originalAmount, 0)
  const reasons = countBy(cancelled, (record) => record.cancellationReason)
  const previousReasons = countBy(previousCancelled, (record) => record.cancellationReason)
  const commonReasonEntry = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0] || ['', 0]

  return {
    cancelledOrders: cancelled.length,
    refundedOrders: refunded.length,
    cancelledValue,
    commonReason: commonReasonEntry[0] || 'No cancellations yet',
    commonReasonCount: commonReasonEntry[1],
    comparison: {
      cancelled: percentageChange(cancelled.length, previousCancelled.length),
      refunded: percentageChange(refunded.length, previousRefunded.length),
      value: percentageChange(cancelledValue, previousCancelledValue),
      commonReason: percentageChange(commonReasonEntry[1], previousReasons[commonReasonEntry[0]] || 0),
    },
    cancellationReasons: reasons,
    refundReasons: countBy(records.filter((record) => record.refunds.length), (record) => record.refunds[0]?.reason || record.cancellationReason),
    cancelledBy: countBy(cancelled, (record) => startCase(record.cancelledByKey)),
    refundStatuses: countBy(records, (record) => REFUND_STATUS_LABEL[record.refundStatus] || startCase(record.refundStatus)),
  }
}

function bucketStart(date, granularity) {
  const value = new Date(date)
  value.setHours(0, 0, 0, 0)
  if (granularity === 'week') value.setDate(value.getDate() - value.getDay())
  if (granularity === 'month') value.setDate(1)
  return value
}

function nextBucket(date, granularity) {
  const value = new Date(date)
  if (granularity === 'week') value.setDate(value.getDate() + 7)
  else if (granularity === 'month') value.setMonth(value.getMonth() + 1)
  else value.setDate(value.getDate() + 1)
  return value
}

function bucketKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function buildCancellationTrend(records, from, to, granularity = 'day') {
  const start = bucketStart(from, granularity)
  const end = new Date(to)
  const buckets = new Map()

  records.forEach((record) => {
    const key = bucketKey(bucketStart(record.eventDate, granularity))
    const item = buckets.get(key) || { cancellations: 0, refunds: 0 }
    if (record.isCancelled) item.cancellations += 1
    if (record.refundStatus === 'processed') item.refunds += 1
    buckets.set(key, item)
  })

  const points = []
  let cursor = start
  while (cursor <= end && points.length < 100) {
    const key = bucketKey(cursor)
    const item = buckets.get(key) || { cancellations: 0, refunds: 0 }
    const format = granularity === 'month'
      ? { month: 'short' }
      : { month: 'short', day: 'numeric' }
    points.push({ key, label: new Intl.DateTimeFormat('en-PH', format).format(cursor), ...item })
    cursor = nextBucket(cursor, granularity)
  }
  return points
}

export function printCancellationReport({ records, summary, rangeLabel }) {
  const reportWindow = window.open('', '_blank', 'width=980,height=900')
  if (!reportWindow) return false
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]))
  const rows = records.map((record) => `<tr>
    <td>${escape(record.orderNumber)}</td><td>${escape(record.customerName)}</td><td>${escape(ORDER_TYPE_LABEL[record.orderType] || record.orderType)}</td>
    <td>${escape(PAYMENT_LABEL[record.paymentMethod] || record.paymentMethod)}</td><td>PHP ${record.originalAmount.toFixed(2)}</td>
    <td>${escape(record.cancellationReason)}</td><td>${escape(record.cancelledBy)}</td><td>${escape(new Date(record.eventDate).toLocaleString('en-PH'))}</td>
  </tr>`).join('')
  reportWindow.document.write(`<!doctype html><html><head><title>Cancellation Report</title><style>
    body{font-family:Arial,sans-serif;color:#1b2f22;padding:32px}h1{margin-bottom:4px}p{color:#68736b}section{display:flex;gap:16px;margin:24px 0}
    article{border:1px solid #dfe4dd;border-radius:12px;padding:14px;flex:1}article span{font-size:11px;color:#68736b;text-transform:uppercase}article b{display:block;font-size:20px;margin-top:8px}
    table{width:100%;border-collapse:collapse;font-size:11px}th,td{padding:9px;border-bottom:1px solid #dfe4dd;text-align:left}th{background:#f5f7f3;text-transform:uppercase}
  </style></head><body><h1>thecoffeerealm - Cancellation Report</h1><p>${escape(rangeLabel)} · Generated ${escape(new Date().toLocaleString('en-PH'))}</p>
    <section><article><span>Cancelled orders</span><b>${summary.cancelledOrders}</b></article><article><span>Refunded orders</span><b>${summary.refundedOrders}</b></article><article><span>Cancelled order value</span><b>PHP ${summary.cancelledValue.toFixed(2)}</b></article><article><span>Most common reason</span><b>${escape(summary.commonReason)}</b></article></section>
    <table><thead><tr><th>Order</th><th>Customer</th><th>Type</th><th>Payment</th><th>Amount</th><th>Reason</th><th>Cancelled by</th><th>Date</th></tr></thead><tbody>${rows || '<tr><td colspan="8">No records in this period.</td></tr>'}</tbody></table></body></html>`)
  reportWindow.document.close()
  reportWindow.focus()
  reportWindow.print()
  return true
}
