import { supabase } from '../lib/supabase'

const FETCH_CAP = 5000

const REPORT_SELECT = `id,order_number,receipt_number,order_type,order_source,status,customer_id,customer_name,customer_email,customer_phone,
  subtotal,discount_type,discount_subtotal,discount_amount,vat_exempt_amount,delivery_fee,final_total,payment_status,cancellation_status,cancellation_requested_at,cancellation_requested_by_role,cancellation_reason,cancellation_notes,cancelled_by_role,cancelled_at,
  refund_status,is_voided,voided_reason,voided_at,cashier_id,created_at,updated_at,
  order_items(id,item_name,display_name,unit_price,quantity,addons_total,line_total,addons,customizations,is_discounted,discount_amount,vat_exempt_amount),
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
  pending_review: 'Payment Review',
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
  if (raw === 'pending_review') return 'pending_review'
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
  const dates = [row.cancellation_requested_at, row.cancelled_at, row.voided_at, ...refundDates, row.updated_at, row.created_at]
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
  const cancelledByKey = normalizeCancelledByRole(cancellationAudit?.cancelled_by_role || row.cancelled_by_role || row.cancellation_requested_by_role, row.is_voided)

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
    discountType: row.discount_type || '',
    discountSubtotal: Number(row.discount_subtotal || 0),
    discountAmount: Number(row.discount_amount || 0),
    vatExemptAmount: Number(row.vat_exempt_amount || 0),
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
    cancelledAt: cancellationAudit?.created_at || row.cancellation_requested_at || row.cancelled_at || row.voided_at,
    refundStatus,
    refundAmount: completedRefundAmount,
    refundDisplayAmount: Number(latestRefund?.amount || completedRefundAmount || 0),
    refundMethod: latestRefund?.method || '',
    refundReference: latestRefund?.referenceNumber || '',
    refundRequestedAt: latestRefund?.requestedAt || null,
    refundProcessedAt: latestRefund?.processedAt || null,
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
      isDiscounted: Boolean(item.is_discounted),
      discountAmount: Number(item.discount_amount || 0),
      vatExemptAmount: Number(item.vat_exempt_amount || 0),
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
    .or('status.eq.Cancelled,refund_status.in.(pending_review,pending,processing,processed,completed,failed,rejected),is_voided.eq.true')
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

function printRefundReport({ records, summary, rangeLabel }) {
  const reportWindow = window.open('', '_blank', 'width=980,height=900')
  if (!reportWindow) return false
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]))
  const rows = records.map((record) => `<tr>
    <td>${escape(record.orderNumber)}</td><td>${escape(record.customerName)}</td><td>${escape(PAYMENT_LABEL[record.paymentMethod] || record.paymentMethod)}</td>
    <td>PHP ${record.refundDisplayAmount.toFixed(2)}</td><td>${escape(REFUND_STATUS_LABEL[record.refundStatus] || record.refundStatus)}</td>
    <td>${escape(record.refundMethod || 'Not recorded')}</td><td>${escape(record.refundReference || 'Not provided')}</td><td>${escape(new Date(record.refundProcessedAt || record.refundRequestedAt || record.eventDate).toLocaleString('en-PH'))}</td>
  </tr>`).join('')
  reportWindow.document.write(`<!doctype html><html><head><title>Refunds Report</title><style>
    body{font-family:Arial,sans-serif;color:#1b2f22;padding:32px}h1{margin-bottom:4px}p{color:#68736b}section{display:flex;gap:16px;margin:24px 0}
    article{border:1px solid #dfe4dd;border-radius:12px;padding:14px;flex:1}article span{font-size:11px;color:#68736b;text-transform:uppercase}article b{display:block;font-size:20px;margin-top:8px}
    table{width:100%;border-collapse:collapse;font-size:11px}th,td{padding:9px;border-bottom:1px solid #dfe4dd;text-align:left}th{background:#f5f7f3;text-transform:uppercase}
  </style></head><body><h1>thecoffeerealm - Refunds Report</h1><p>${escape(rangeLabel)} - Generated ${escape(new Date().toLocaleString('en-PH'))}</p>
    <section><article><span>Refund records</span><b>${summary.total}</b></article><article><span>Needs action</span><b>${summary.needsAction}</b></article><article><span>Completed</span><b>${summary.completed}</b></article><article><span>Amount completed</span><b>PHP ${summary.completedAmount.toFixed(2)}</b></article></section>
    <table><thead><tr><th>Order</th><th>Customer</th><th>Payment</th><th>Refund</th><th>Status</th><th>Method</th><th>Reference</th><th>Date</th></tr></thead><tbody>${rows || '<tr><td colspan="8">No refund records in this period.</td></tr>'}</tbody></table></body></html>`)
  reportWindow.document.close()
  reportWindow.focus()
  reportWindow.print()
  return true
}

function safeDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  window.setTimeout(() => { anchor.remove(); URL.revokeObjectURL(url) }, 1000)
}

const cancellationReportColumns = [
  { label: 'Order Number', value: (record) => record.orderNumber || '' },
  { label: 'Customer', value: (record) => record.customerName || '' },
  { label: 'Order Type', value: (record) => ORDER_TYPE_LABEL[record.orderType] || record.orderType || '' },
  { label: 'Payment Method', value: (record) => PAYMENT_LABEL[record.paymentMethod] || record.paymentMethod || '' },
  { label: 'Original Amount', value: (record) => Number(record.originalAmount || 0), money: true },
  { label: 'Reason', value: (record) => record.cancellationReason || 'Not specified' },
  { label: 'Cancelled By', value: (record) => record.cancelledBy || 'System' },
  { label: 'Event Date', value: (record) => safeDate(record.eventDate) || '', date: true },
]

const refundReportColumns = [
  { label: 'Order Number', value: (record) => record.orderNumber || '' },
  { label: 'Customer', value: (record) => record.customerName || '' },
  { label: 'Payment Method', value: (record) => PAYMENT_LABEL[record.paymentMethod] || record.paymentMethod || '' },
  { label: 'Refund Amount', value: (record) => Number(record.refundDisplayAmount || 0), money: true },
  { label: 'Status', value: (record) => REFUND_STATUS_LABEL[record.refundStatus] || record.refundStatus || 'Not recorded' },
  { label: 'Refund Method', value: (record) => record.refundMethod || 'Not recorded' },
  { label: 'Reference', value: (record) => record.refundReference || 'Not provided' },
  { label: 'Event Date', value: (record) => safeDate(record.refundProcessedAt || record.refundRequestedAt || record.eventDate) || '', date: true },
]

function reportDefinition(view) {
  return view === 'refunds'
    ? { label: 'Refunds', title: 'COFFEE REALM - REFUNDS REPORT', sheet: 'Refund Ledger', columns: refundReportColumns }
    : { label: 'Cancellations', title: 'COFFEE REALM - CANCELLATIONS REPORT', sheet: 'Cancellation Ledger', columns: cancellationReportColumns }
}

export async function exportCancellationReportToXlsx({ records = [], summary = {}, rangeLabel = 'Selected period', view = 'cancellations', generatedBy = 'Coffee Realm' }) {
  const { default: ExcelJS } = await import('exceljs')
  const definition = reportDefinition(view)
  const workbook = new ExcelJS.Workbook()
  workbook.creator = generatedBy
  workbook.created = new Date()
  const brand = '1E3932'
  const softGreen = 'EAF2EC'
  const border = { style: 'thin', color: { argb: 'D9E4DB' } }
  const summarySheet = workbook.addWorksheet('Summary', { views: [{ showGridLines: false }] })
  summarySheet.mergeCells('A1:F1')
  const title = summarySheet.getCell('A1')
  title.value = definition.title
  title.font = { bold: true, size: 16, color: { argb: 'FFFFFF' } }
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: brand } }
  title.alignment = { vertical: 'middle' }
  summarySheet.getRow(1).height = 30
  summarySheet.getCell('A3').value = 'Report period'; summarySheet.getCell('B3').value = rangeLabel
  summarySheet.getCell('D3').value = 'Generated'; summarySheet.getCell('E3').value = new Date(); summarySheet.getCell('E3').numFmt = 'mmm d, yyyy h:mm AM/PM'
  summarySheet.getCell('A4').value = 'Generated by'; summarySheet.getCell('B4').value = generatedBy
  const summaryRows = view === 'refunds'
    ? [['Refund records', Number(summary.total || records.length)], ['Needs action', Number(summary.needsAction || 0)], ['Completed refunds', Number(summary.completed || 0)], ['Amount completed', Number(summary.completedAmount || 0)], ['Failed or rejected', Number(summary.failed || 0)]]
    : [['Cancelled orders', Number(summary.cancelledOrders || 0)], ['Refunded orders', Number(summary.refundedOrders || 0)], ['Cancelled order value', Number(summary.cancelledValue || 0)], ['Most common reason', summary.commonReason || 'No cancellations yet']]
  summarySheet.mergeCells('A6:B6')
  const summaryHeader = summarySheet.getCell('A6'); summaryHeader.value = `${definition.label} Summary`; summaryHeader.font = { bold: true, color: { argb: 'FFFFFF' }}; summaryHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: brand } }
  summaryRows.forEach(([label, value], index) => {
    const row = summarySheet.getRow(index + 7); row.getCell(1).value = label; row.getCell(2).value = value
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: softGreen } }; row.getCell(1).font = { bold: true, color: { argb: brand } }
    row.getCell(1).border = { top: border, bottom: border, left: border }; row.getCell(2).border = { top: border, bottom: border, right: border }
    if (['Amount completed', 'Cancelled order value'].includes(label)) row.getCell(2).numFmt = '₱#,##0.00'; else if (typeof value === 'number') row.getCell(2).numFmt = '#,##0'
  })
  summarySheet.columns = [{ width: 25 }, { width: 25 }, { width: 4 }, { width: 20 }, { width: 24 }, { width: 4 }]
  const ledger = workbook.addWorksheet(definition.sheet, { views: [{ state: 'frozen', ySplit: 4 }] })
  const lastColumn = String.fromCharCode(64 + definition.columns.length)
  ledger.mergeCells(`A1:${lastColumn}1`)
  const ledgerTitle = ledger.getCell('A1'); ledgerTitle.value = definition.title.replace('REPORT', 'LEDGER'); ledgerTitle.font = { bold: true, size: 15, color: { argb: 'FFFFFF' }}; ledgerTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: brand }}; ledgerTitle.alignment = { vertical: 'middle' }; ledger.getRow(1).height = 28
  ledger.getCell('A2').value = `Report period: ${rangeLabel}`; ledger.getCell('A3').value = `Generated ${new Date().toLocaleString('en-PH')} by ${generatedBy}`
  const headerRow = ledger.getRow(4); headerRow.values = definition.columns.map((column) => column.label); headerRow.height = 22
  headerRow.eachCell((cell) => { cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: brand } }; cell.alignment = { vertical: 'middle', horizontal: 'center' } })
  records.forEach((record, index) => {
    const row = ledger.getRow(index + 5); row.values = definition.columns.map((column) => column.value(record))
    row.eachCell((cell) => { cell.border = { bottom: border }; cell.alignment = { vertical: 'middle', wrapText: true }; if (index % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F7FAF8' } } })
    definition.columns.forEach((column, columnIndex) => { const cell = row.getCell(columnIndex + 1); if (column.date) cell.numFmt = 'mmm d, yyyy h:mm AM/PM'; if (column.money) cell.numFmt = '₱#,##0.00' })
  })
  ledger.autoFilter = { from: 'A4', to: `${lastColumn}${Math.max(4, records.length + 4)}` }
  ledger.columns = definition.columns.map((column) => ({ width: column.money ? 17 : column.date ? 22 : column.label === 'Reason' ? 32 : 20 }))
  const buffer = await workbook.xlsx.writeBuffer()
  const slug = view === 'refunds' ? 'refunds' : 'cancellations'
  downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `coffee-realm-${slug}-report-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

export async function exportCancellationReportToPdf({ records = [], summary = {}, rangeLabel = 'Selected period', view = 'cancellations', generatedBy = 'Coffee Realm' }) {
  const { jsPDF } = await import('jspdf')
  const definition = reportDefinition(view)
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' })
  const pageWidth = pdf.internal.pageSize.getWidth(); const pageHeight = pdf.internal.pageSize.getHeight(); const green = [30, 57, 50]; const softGreen = [234, 242, 236]
  const moneyValue = (value) => `PHP ${Number(value || 0).toFixed(2)}`; const cellText = (value, width) => pdf.splitTextToSize(String(value == null || value === '' ? '—' : value), width)[0]
  const metrics = view === 'refunds' ? [['Refund records', summary.total || records.length], ['Needs action', summary.needsAction || 0], ['Completed', summary.completed || 0], ['Amount completed', moneyValue(summary.completedAmount)]] : [['Cancelled orders', summary.cancelledOrders || 0], ['Refunded orders', summary.refundedOrders || 0], ['Cancelled value', moneyValue(summary.cancelledValue)], ['Common reason', summary.commonReason || 'None']]
  const drawHeader = (pageLabel) => { pdf.setFillColor(...green); pdf.rect(0, 0, pageWidth, 54, 'F'); pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.text(definition.title, 38, 34); pdf.setTextColor(...green); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.text(pageLabel, 38, 76); pdf.setTextColor(70, 85, 76); pdf.text(`Generated ${new Date().toLocaleString('en-PH')} by ${generatedBy}`, 38, 91) }
  drawHeader(`Report period: ${rangeLabel}`)
  metrics.forEach(([label, value], index) => { const x = 38 + index * 180; pdf.setFillColor(...softGreen); pdf.roundedRect(x, 112, 164, 46, 7, 7, 'F'); pdf.setTextColor(80, 100, 88); pdf.setFontSize(7); pdf.text(String(label).toUpperCase(), x + 10, 128); pdf.setTextColor(...green); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); pdf.text(cellText(value, 144), x + 10, 146) })
  const tableX = 38; const tableWidth = pageWidth - 76; const columnWidth = tableWidth / definition.columns.length; let y = 190
  const drawTableHeader = () => { pdf.setFillColor(...green); pdf.rect(tableX, y, tableWidth, 20, 'F'); pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7); definition.columns.forEach((column, index) => pdf.text(column.label.toUpperCase(), tableX + index * columnWidth + 5, y + 13)); y += 20 }
  drawTableHeader()
  records.forEach((record, index) => { if (y > pageHeight - 40) { pdf.addPage(); y = 78; drawHeader(`${definition.label} ledger - page ${pdf.getNumberOfPages()}`); y = 104; drawTableHeader() }; if (index % 2 === 1) { pdf.setFillColor(247, 250, 248); pdf.rect(tableX, y, tableWidth, 24, 'F') }; pdf.setTextColor(37, 58, 46); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); definition.columns.forEach((column, columnIndex) => { const raw = column.value(record); const value = column.date ? (safeDate(raw)?.toLocaleDateString('en-PH') || '—') : column.money ? moneyValue(raw) : raw; pdf.text(cellText(value, columnWidth - 10), tableX + columnIndex * columnWidth + 5, y + 15) }); pdf.setDrawColor(222, 231, 224); pdf.line(tableX, y + 24, tableX + tableWidth, y + 24); y += 24 })
  const slug = view === 'refunds' ? 'refunds' : 'cancellations'
  downloadBlob(pdf.output('blob'), `coffee-realm-${slug}-report-${new Date().toISOString().slice(0, 10)}.pdf`)
}

export function printCancellationReport({ records, summary, rangeLabel, view = 'cancellations' }) {
  if (view === 'refunds') return printRefundReport({ records, summary, rangeLabel })
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
