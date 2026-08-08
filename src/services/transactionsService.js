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
    orderStatus, refundStatus, customerType, staffId, minAmount, maxAmount, search,
  } = filters

  if (dateFrom) query = query.gte('created_at', dateFrom)
  if (dateTo) query = query.lte('created_at', dateTo)
  if (orderSource && orderSource !== 'all') query = query.eq('order_source', orderSource)
  if (fulfillment && fulfillment !== 'all') query = query.eq('order_type', fulfillment)
  if (paymentStatus && paymentStatus !== 'all') query = query.eq('payment_status', paymentStatus)
  if (orderStatus && orderStatus !== 'all') query = query.eq('status', orderStatus)
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

export function exportTransactionsToCsv(transactions, generatedBy) {
  const headers = ['Order Number', 'Receipt Number', 'Payment Reference', 'Date', 'Customer', 'Source', 'Fulfillment', 'Items', 'Payment Method', 'Payment Status', 'Order Status', 'Refund Status', 'Voided', 'Staff', 'Total']
  const rows = transactions.map((transaction) => [
    transaction.orderNumber,
    transaction.receiptNumber,
    transaction.paymentReference,
    new Date(transaction.createdAt).toISOString(),
    transaction.customerName,
    transaction.isOnline ? 'Online' : 'Walk-in',
    transaction.fulfillment,
    transaction.itemCount,
    transaction.paymentMethod || '',
    transaction.paymentStatus,
    transaction.status,
    transaction.refundStatus,
    transaction.isVoided ? 'Yes' : 'No',
    transaction.cashierName || '',
    transaction.finalTotal.toFixed(2),
  ])
  const meta = [
    ['Generated at', new Date().toISOString()],
    ['Generated by', generatedBy || 'Unknown'],
    ['Total records', transactions.length],
    [],
  ]
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`
  return [...meta, headers, ...rows].map((row) => row.map(escape).join(',')).join('\n')
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
