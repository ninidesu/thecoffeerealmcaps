import { supabase } from '../lib/supabase'

const LIST_SELECT = `id,order_number,receipt_number,order_type,order_source,status,customer_id,customer_name,customer_email,customer_phone,
  delivery_address,schedule_date,schedule_time,subtotal,discount_type,discount_amount,delivery_fee,final_total,
  payment_status,payment_confirmed,payment_proof_path,cancellation_reason,cancellation_notes,cancelled_by_role,cancelled_at,
  refund_status,is_voided,voided_reason,voided_at,cashier_id,created_at,updated_at,
  order_items(id,item_name,display_name,unit_price,quantity,addons_total,line_total,addons,customizations),
  payments!inner(id,method,status,amount_due,amount_received,change_amount,reference_number,account_number,bank_name,paid_at,confirmed_at),
  refunds(id,refund_amount,original_amount,refund_status,refund_reason,refund_method,reference_number,requested_at,processed_at)`

const SUMMARY_SELECT = `id,order_type,order_source,status,customer_id,final_total,payment_status,refund_status,is_voided,cashier_id,
  payments!inner(method,status,reference_number),
  refunds(refund_amount,refund_status)`

const DETAIL_SELECT = `id,order_number,receipt_number,order_type,order_source,status,customer_id,customer_name,customer_email,customer_phone,
  delivery_address,schedule_date,schedule_time,subtotal,discount_type,discount_amount,delivery_fee,final_total,
  payment_status,payment_confirmed,payment_proof_path,cancellation_reason,cancellation_notes,cancelled_by_role,cancelled_at,
  refund_status,is_voided,voided_reason,voided_at,cashier_id,created_at,updated_at,
  order_items(id,menu_item_id,item_name,display_name,unit_price,quantity,addons_total,line_total,addons,customizations),
  payments!inner(id,method,status,amount_due,amount_received,change_amount,reference_number,account_number,bank_name,paid_at,confirmed_at),
  refunds(id,refund_amount,original_amount,refund_status,refund_reason,refund_method,reference_number,requested_at,processed_at)`

const SUMMARY_FETCH_CAP = 5000

function safeSearch(value) {
  return String(value || '').replace(/[%_]/g, '').trim()
}

function normalize(row, cashierNames = {}) {
  const payment = row.payments?.[0] || null
  return {
    id: row.id,
    orderNumber: row.order_number,
    receiptNumber: row.receipt_number,
    orderType: row.order_type,
    orderSource: row.order_source,
    fulfillment: row.order_type === 'delivery' ? 'Delivery' : row.order_type === 'pickup' ? 'Pickup' : 'Walk-in',
    isOnline: row.order_source === 'customer_pos',
    status: row.status,
    customerId: row.customer_id,
    isGuest: !row.customer_id,
    customerName: row.customer_name || 'Walk-in Customer',
    customerEmail: row.customer_email || '',
    customerPhone: row.customer_phone || '',
    deliveryAddress: row.delivery_address || '',
    scheduleDate: row.schedule_date,
    scheduleTime: row.schedule_time,
    subtotal: Number(row.subtotal || 0),
    discountType: row.discount_type,
    discountAmount: Number(row.discount_amount || 0),
    deliveryFee: Number(row.delivery_fee || 0),
    finalTotal: Number(row.final_total || 0),
    paymentStatus: row.payment_status,
    paymentRecordStatus: payment?.status || row.payment_status || '',
    paymentConfirmed: Boolean(row.payment_confirmed),
    paymentProofPath: row.payment_proof_path,
    paymentMethod: payment?.method || null,
    paymentReference: payment?.reference_number || '',
    accountNumber: payment?.account_number || '',
    bankName: payment?.bank_name || '',
    amountReceived: payment?.amount_received == null ? null : Number(payment.amount_received || 0),
    changeAmount: payment?.change_amount == null ? null : Number(payment.change_amount || 0),
    cancellationReason: row.cancellation_reason,
    cancellationNotes: row.cancellation_notes,
    cancelledByRole: row.cancelled_by_role,
    cancelledAt: row.cancelled_at,
    refundStatus: row.refund_status,
    refunds: (row.refunds || []).map((refund) => ({
      id: refund.id,
      amount: Number(refund.refund_amount || 0),
      originalAmount: Number(refund.original_amount || 0),
      status: refund.refund_status,
      reason: refund.refund_reason,
      method: refund.refund_method,
      referenceNumber: refund.reference_number,
      requestedAt: refund.requested_at,
      processedAt: refund.processed_at,
    })),
    isVoided: Boolean(row.is_voided),
    voidedReason: row.voided_reason,
    voidedAt: row.voided_at,
    cashierId: row.cashier_id || '',
    cashierName: row.cashier_id ? cashierNames[row.cashier_id] || 'Unknown' : '',
    items: (row.order_items || []).map((item) => ({
      id: item.id,
      name: item.display_name || item.item_name,
      unitPrice: Number(item.unit_price || 0),
      quantity: Number(item.quantity || 0),
      addonsTotal: Number(item.addons_total || 0),
      lineTotal: Number(item.line_total || 0),
      addons: item.addons || [],
      customizations: item.customizations || {},
    })),
    itemCount: (row.order_items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function applyFilters(query, filters = {}) {
  const {
    dateFrom, dateTo, orderSource, fulfillment, paymentMethod, paymentStatus,
    orderStatus, voidedOnly, refundStatus, customerType, staffId, minAmount, maxAmount, search,
  } = filters

  if (dateFrom) query = query.gte('created_at', dateFrom)
  if (dateTo) query = query.lte('created_at', dateTo)
  if (orderSource && orderSource !== 'all') query = query.eq('order_source', orderSource)
  if (fulfillment && fulfillment !== 'all') query = query.eq('order_type', fulfillment)
  if (paymentStatus && paymentStatus !== 'all') query = query.eq('payment_status', paymentStatus)
  if (orderStatus && orderStatus !== 'all') query = query.eq('status', orderStatus)
  if (voidedOnly) query = query.eq('is_voided', true)
  if (refundStatus && refundStatus !== 'all') query = query.eq('refund_status', refundStatus)
  if (paymentMethod && paymentMethod !== 'all') query = query.eq('payments.method', paymentMethod)
  if (customerType === 'registered') query = query.not('customer_id', 'is', null)
  if (customerType === 'guest') query = query.is('customer_id', null)
  if (staffId && staffId !== 'all') query = query.eq('cashier_id', staffId)
  if (minAmount !== '' && minAmount != null) query = query.gte('final_total', Number(minAmount))
  if (maxAmount !== '' && maxAmount != null) query = query.lte('final_total', Number(maxAmount))

  const q = safeSearch(search)
  if (q) {
    query = query.or(`order_number.ilike.%${q}%,receipt_number.ilike.%${q}%,customer_name.ilike.%${q}%,customer_email.ilike.%${q}%,customer_phone.ilike.%${q}%`)
  }

  return query
}

function applySort(query, sortBy = 'newest') {
  if (sortBy === 'oldest') return query.order('created_at', { ascending: true })
  if (sortBy === 'highest') return query.order('final_total', { ascending: false }).order('created_at', { ascending: false })
  if (sortBy === 'lowest') return query.order('final_total', { ascending: true }).order('created_at', { ascending: false })
  return query.order('created_at', { ascending: false })
}

async function fetchCashierNames(cashierIds) {
  const ids = [...new Set((cashierIds || []).filter(Boolean))]
  if (!ids.length) return {}
  const { data, error } = await supabase.from('profiles').select('id,full_name').in('id', ids)
  if (error) throw error
  return Object.fromEntries((data || []).map((profile) => [profile.id, profile.full_name || 'Unknown']))
}

export async function fetchTransactions({ page = 1, pageSize = 20, sortBy = 'newest', ...filters } = {}) {
  const from = Math.max(0, (page - 1) * pageSize)
  const to = from + Math.max(1, pageSize) - 1

  let query = supabase.from('orders').select(LIST_SELECT, { count: 'exact' })
  query = applyFilters(query, filters)
  query = applySort(query, sortBy).range(from, to)

  const { data, error, count } = await query
  if (error) throw error

  const cashierNames = await fetchCashierNames((data || []).map((row) => row.cashier_id))
  return { data: (data || []).map((row) => normalize(row, cashierNames)), count: count || 0 }
}

export async function fetchTransactionsSummary(filters = {}) {
  let query = supabase.from('orders').select(SUMMARY_SELECT)
  query = applyFilters(query, filters).order('created_at', { ascending: false }).limit(SUMMARY_FETCH_CAP)

  const { data, error } = await query
  if (error) throw error

  const cashierNames = await fetchCashierNames((data || []).map((row) => row.cashier_id))
  return (data || []).map((row) => normalize(row, cashierNames))
}

export async function fetchTransactionById(orderId) {
  const { data, error } = await supabase.from('orders').select(DETAIL_SELECT).eq('id', orderId).maybeSingle()
  if (error) throw error
  if (!data) return null
  const cashierNames = await fetchCashierNames([data.cashier_id])
  return normalize(data, cashierNames)
}

export async function fetchTransactionStaffOptions() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id,full_name,role')
    .in('role', ['admin', 'staff', 'operational_staff', 'cashier'])
    .order('full_name', { ascending: true })
  if (error) throw error
  return (data || []).filter((profile) => profile.full_name).map((profile) => ({
    id: profile.id,
    name: profile.full_name,
    role: profile.role,
  }))
}

export async function fetchTransactionAudit(orderId) {
  const { data, error } = await supabase
    .from('transaction_audit_log')
    .select('id,action,reason,previous_value,new_value,performed_by,created_at,profiles(full_name)')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map((row) => ({ ...row, staffName: row.profiles?.full_name || 'Unknown' }))
}

export async function getPaymentProofUrl(path) {
  if (!path) return null
  const { data, error } = await supabase.storage.from('payment-proofs').createSignedUrl(path, 300)
  if (error) throw error
  return data?.signedUrl || null
}

export async function voidOrder(orderId, reason) {
  const { error } = await supabase.rpc('staff_void_order', { p_order_id: orderId, p_reason: reason })
  if (error) throw error
}

export async function requestRefund({ orderId, amount, reason, method }) {
  const { data, error } = await supabase.rpc('staff_request_refund', { p_order_id: orderId, p_amount: amount, p_reason: reason, p_method: method })
  if (error) throw error
  return data
}

export async function processRefund({ refundId, approve, referenceNumber }) {
  const { error } = await supabase.rpc('staff_process_refund', { p_refund_id: refundId, p_approve: approve, p_reference_number: referenceNumber || null })
  if (error) throw error
}

export async function correctPaymentStatus({ orderId, newStatus, reason }) {
  const { error } = await supabase.rpc('staff_correct_payment_status', { p_order_id: orderId, p_new_status: newStatus, p_reason: reason })
  if (error) throw error
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  window.setTimeout(() => {
    anchor.remove()
    URL.revokeObjectURL(url)
  }, 1000)
}

function safeDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export async function exportTransactionsToXlsx({ transactions, summary, reconciliation, filterLabel, generatedBy }) {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = generatedBy || 'Coffee Realm'
  workbook.created = new Date()

  const brand = '1E3932'
  const softGreen = 'EAF2EC'
  const border = { style: 'thin', color: { argb: 'D9E4DB' } }
  const summarySheet = workbook.addWorksheet('Summary', { views: [{ showGridLines: false }] })
  summarySheet.mergeCells('A1:F1')
  const title = summarySheet.getCell('A1')
  title.value = 'COFFEE REALM — TRANSACTION REPORT'
  title.font = { bold: true, size: 16, color: { argb: 'FFFFFF' } }
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: brand } }
  title.alignment = { vertical: 'middle' }
  summarySheet.getRow(1).height = 30
  summarySheet.getCell('A3').value = 'Report period'
  summarySheet.getCell('B3').value = filterLabel
  summarySheet.getCell('D3').value = 'Generated'
  summarySheet.getCell('E3').value = new Date()
  summarySheet.getCell('E3').numFmt = 'mmm d, yyyy h:mm AM/PM'
  summarySheet.getCell('A4').value = 'Generated by'
  summarySheet.getCell('B4').value = generatedBy || 'Coffee Realm'

  summarySheet.mergeCells('A6:B6')
  const summaryHeader = summarySheet.getCell('A6')
  summaryHeader.value = 'Financial Summary'
  summaryHeader.font = { bold: true, color: { argb: 'FFFFFF' } }
  summaryHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: brand } }
  const summaryRows = [
    ['Net Sales', summary.netSales], ['Gross Sales', summary.grossSales], ['Refunded Amount', summary.refundedAmount],
    ['Completed Sales', summary.completedSales], ['Total Transactions', summary.totalTransactions], ['Average Order Value', summary.averageOrderValue],
    ['Cancelled Orders', summary.cancelledOrders], ['Voided Transactions', reconciliation.voids],
  ]
  summaryRows.forEach(([label, value], index) => {
    const row = summarySheet.getRow(index + 7)
    row.getCell(1).value = label
    row.getCell(2).value = value
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: softGreen } }
    row.getCell(1).font = { bold: true, color: { argb: brand } }
    row.getCell(1).border = { top: border, bottom: border, left: border }
    row.getCell(2).border = { top: border, bottom: border, right: border }
    if (['Net Sales', 'Gross Sales', 'Refunded Amount', 'Average Order Value'].includes(label)) row.getCell(2).numFmt = '₱#,##0.00'
    else row.getCell(2).numFmt = '#,##0'
  })
  summarySheet.mergeCells('D6:E6')
  const paymentHeader = summarySheet.getCell('D6')
  paymentHeader.value = 'Payment Breakdown'
  paymentHeader.font = { bold: true, color: { argb: 'FFFFFF' } }
  paymentHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: brand } }
  const paymentRows = [...Object.entries(reconciliation.byMethod), ['Refunds', reconciliation.refunds], ['Voids', reconciliation.voids]]
  paymentRows.forEach(([label, value], index) => {
    const row = summarySheet.getRow(index + 7)
    row.getCell(4).value = label
    row.getCell(5).value = value
    row.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: softGreen } }
    row.getCell(4).font = { bold: true, color: { argb: brand } }
    row.getCell(4).border = { top: border, bottom: border, left: border }
    row.getCell(5).border = { top: border, bottom: border, right: border }
    row.getCell(5).numFmt = label === 'Voids' ? '#,##0' : '₱#,##0.00'
  })
  summarySheet.columns = [{ width: 24 }, { width: 18 }, { width: 4 }, { width: 22 }, { width: 20 }, { width: 4 }]

  const ledger = workbook.addWorksheet('Transaction Ledger', { views: [{ state: 'frozen', ySplit: 4 }] })
  ledger.mergeCells('A1:O1')
  const ledgerTitle = ledger.getCell('A1')
  ledgerTitle.value = 'COFFEE REALM — TRANSACTION LEDGER'
  ledgerTitle.font = { bold: true, size: 15, color: { argb: 'FFFFFF' } }
  ledgerTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: brand } }
  ledgerTitle.alignment = { vertical: 'middle' }
  ledger.getRow(1).height = 28
  ledger.getCell('A2').value = `Report period: ${filterLabel}`
  ledger.getCell('A3').value = `Generated ${new Date().toLocaleString('en-PH')} by ${generatedBy || 'Coffee Realm'}`
  const headers = ['Order Number', 'Receipt Number', 'Payment Reference', 'Date', 'Customer', 'Source', 'Fulfillment', 'Items', 'Payment Method', 'Payment Status', 'Order Status', 'Refund Status', 'Voided', 'Staff', 'Total']
  const headerRow = ledger.getRow(4)
  headerRow.values = headers
  headerRow.height = 22
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: brand } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })
  transactions.forEach((transaction, index) => {
    const row = ledger.getRow(index + 5)
    row.values = [transaction.orderNumber || '', transaction.receiptNumber || '', transaction.paymentReference || '', safeDate(transaction.createdAt) || '', transaction.customerName || '', transaction.isOnline ? 'Online' : 'Walk-in', transaction.fulfillment || '', Number(transaction.itemCount || 0), transaction.paymentMethod || '', transaction.paymentStatus || '', transaction.status || '', transaction.refundStatus || '', transaction.isVoided ? 'Yes' : 'No', transaction.cashierName || '', Number(transaction.finalTotal || 0)]
    row.eachCell((cell) => {
      cell.border = { bottom: border }
      cell.alignment = { vertical: 'middle' }
      if (index % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F7FAF8' } }
    })
    row.getCell(4).numFmt = 'mmm d, yyyy h:mm AM/PM'
    row.getCell(8).numFmt = '#,##0'
    row.getCell(15).numFmt = '₱#,##0.00'
  })
  ledger.autoFilter = { from: 'A4', to: `O${Math.max(4, transactions.length + 4)}` }
  ledger.columns = [18, 18, 20, 21, 24, 12, 14, 9, 16, 18, 20, 18, 10, 20, 15].map((width) => ({ width }))
  const buffer = await workbook.xlsx.writeBuffer()
  downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `coffee-realm-transactions-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

export async function exportTransactionsToPdf({ transactions, summary, reconciliation, filterLabel, generatedBy }) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const green = [30, 57, 50]
  const softGreen = [234, 242, 236]
  const moneyValue = (value) => money(Number(value || 0))
  const addHeader = (pageLabel) => {
    pdf.setFillColor(...green); pdf.rect(0, 0, pageWidth, 54, 'F')
    pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.text('COFFEE REALM — TRANSACTION REPORT', 38, 34)
    pdf.setTextColor(30, 57, 50); pdf.setFontSize(8); pdf.text(pageLabel, 38, 76)
  }
  addHeader(`Report period: ${filterLabel}`)
  pdf.setTextColor(70, 85, 76); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.text(`Generated ${new Date().toLocaleString('en-PH')} by ${generatedBy || 'Coffee Realm'}`, 38, 91)
  const metrics = [['Net Sales', moneyValue(summary.netSales)], ['Gross Sales', moneyValue(summary.grossSales)], ['Refunds', moneyValue(summary.refundedAmount)], ['Completed Sales', String(summary.completedSales)], ['Average Order Value', moneyValue(summary.averageOrderValue)], ['Voids', String(reconciliation.voids)]]
  metrics.forEach(([label, value], index) => {
    const x = 38 + (index % 3) * 174; const y = 112 + Math.floor(index / 3) * 58
    pdf.setFillColor(...softGreen); pdf.roundedRect(x, y, 158, 46, 7, 7, 'F')
    pdf.setTextColor(80, 100, 88); pdf.setFontSize(7); pdf.text(label.toUpperCase(), x + 10, y + 16)
    pdf.setTextColor(...green); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); pdf.text(value, x + 10, y + 34)
  })
  let y = 254
  const columns = [{ label: 'ORDER', x: 38, width: 92 }, { label: 'CUSTOMER', x: 132, width: 110 }, { label: 'DATE', x: 244, width: 95 }, { label: 'PAYMENT', x: 341, width: 74 }, { label: 'STATUS', x: 417, width: 78 }, { label: 'TOTAL', x: 520, width: 36 }]
  const drawTableHeader = () => { pdf.setFillColor(...green); pdf.rect(38, y, 519, 20, 'F'); pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7); columns.forEach((column) => pdf.text(column.label, column.x + 5, y + 13)); y += 20 }
  drawTableHeader()
  transactions.forEach((transaction, index) => {
    if (y > pageHeight - 46) { pdf.addPage(); y = 78; addHeader(`Transaction ledger — page ${pdf.getNumberOfPages()}`); y = 104; drawTableHeader() }
    if (index % 2 === 1) { pdf.setFillColor(247, 250, 248); pdf.rect(38, y, 519, 24, 'F') }
    const values = [transaction.orderNumber || '—', transaction.customerName || '—', safeDate(transaction.createdAt)?.toLocaleDateString('en-PH') || '—', transaction.paymentStatus || '—', transaction.status || '—', moneyValue(transaction.finalTotal)]
    pdf.setTextColor(37, 58, 46); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7)
    columns.forEach((column, valueIndex) => pdf.text(pdf.splitTextToSize(String(values[valueIndex]), column.width)[0], column.x + 5, y + 15))
    pdf.setDrawColor(222, 231, 224); pdf.line(38, y + 24, 557, y + 24); y += 24
  })
  downloadBlob(pdf.output('blob'), `coffee-realm-transaction-report-${new Date().toISOString().slice(0, 10)}.pdf`)
}

export function printSummaryReport({ summary, reconciliation, filterLabel, generatedBy }) {
  const win = window.open('', '_blank', 'width=800,height=900')
  if (!win) return
  const row = (label, value) => `<tr><td>${label}</td><td style="text-align:right;font-weight:700">${value}</td></tr>`
  win.document.write(`<!doctype html><html><head><title>Transaction Summary Report</title>
    <style>
      body{font-family:Arial,sans-serif;color:#1b2f22;padding:32px;max-width:640px;margin:auto}
      h1{font-size:1.4rem;margin-bottom:4px} p{color:#64748b;font-size:.85rem;margin:2px 0}
      table{width:100%;border-collapse:collapse;margin-top:20px} td{padding:10px 4px;border-bottom:1px solid #e5e7eb;font-size:.9rem}
      h2{font-size:1rem;margin-top:28px;border-bottom:2px solid #1b2f22;padding-bottom:6px}
    </style></head><body>
    <h1>thecoffeerealm - Transaction Summary Report</h1>
    <p>Filtered period: ${filterLabel}</p>
    <p>Generated: ${new Date().toLocaleString('en-PH')} by ${generatedBy || 'Unknown'}</p>
    <h2>Sales Summary</h2>
    <table>
      ${row('Total Transactions', summary.totalTransactions)}
      ${row('Completed Sales', summary.completedSales)}
      ${row('Gross Sales', money(summary.grossSales))}
      ${row('Refunded Amount', money(summary.refundedAmount))}
      ${row('Net Sales', money(summary.netSales))}
      ${row('Cancelled Orders', summary.cancelledOrders)}
      ${row('Average Order Value', money(summary.averageOrderValue))}
    </table>
    <h2>Payment Method Reconciliation</h2>
    <table>
      ${Object.entries(reconciliation.byMethod).map(([label, value]) => row(label, money(value))).join('')}
      ${row('Refunds', money(reconciliation.refunds))}
      ${row('Voids', reconciliation.voids)}
    </table>
    </body></html>`)
  win.document.close()
  win.focus()
  win.print()
}

function money(value) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value)
}
