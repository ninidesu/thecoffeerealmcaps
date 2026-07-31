import { supabase } from '../lib/supabase'

const SELECT = `id,order_number,receipt_number,order_type,order_source,status,customer_name,customer_email,customer_phone,
  delivery_address,schedule_date,schedule_time,subtotal,discount_type,discount_amount,delivery_fee,final_total,
  payment_status,payment_confirmed,payment_proof_path,cancellation_reason,cancellation_notes,cancelled_by_role,cancelled_at,
  refund_status,is_voided,voided_reason,voided_at,cashier_id,created_at,updated_at,
  order_items(id,menu_item_id,item_name,display_name,unit_price,quantity,addons_total,line_total,addons,customizations),
  payments(id,method,status,amount_due,amount_received,change_amount,reference_number,account_number,bank_name,paid_at,confirmed_at),
  refunds(id,refund_amount,original_amount,refund_status,refund_reason,refund_method,reference_number,requested_at,processed_at)`

const FETCH_CAP = 1000

function normalize(row, cashierNames) {
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
    paymentConfirmed: Boolean(row.payment_confirmed),
    paymentProofPath: row.payment_proof_path,
    paymentMethod: payment?.method || null,
    paymentReference: payment?.reference_number || '',
    accountNumber: payment?.account_number || '',
    bankName: payment?.bank_name || '',
    amountReceived: payment ? Number(payment.amount_received || 0) : null,
    changeAmount: payment ? Number(payment.change_amount || 0) : null,
    cancellationReason: row.cancellation_reason,
    cancellationNotes: row.cancellation_notes,
    cancelledByRole: row.cancelled_by_role,
    cancelledAt: row.cancelled_at,
    refundStatus: row.refund_status,
    refunds: (row.refunds || []).map((r) => ({
      id: r.id, amount: Number(r.refund_amount), originalAmount: Number(r.original_amount),
      status: r.refund_status, reason: r.refund_reason, method: r.refund_method,
      referenceNumber: r.reference_number, requestedAt: r.requested_at, processedAt: r.processed_at,
    })),
    isVoided: Boolean(row.is_voided),
    voidedReason: row.voided_reason,
    voidedAt: row.voided_at,
    cashierId: row.cashier_id,
    cashierName: row.cashier_id ? cashierNames[row.cashier_id] || 'Unknown' : '',
    items: (row.order_items || []).map((i) => ({
      id: i.id, name: i.display_name || i.item_name, unitPrice: Number(i.unit_price || 0), quantity: i.quantity,
      addonsTotal: Number(i.addons_total || 0), lineTotal: Number(i.line_total || 0), addons: i.addons || [], customizations: i.customizations || {},
    })),
    itemCount: (row.order_items || []).reduce((sum, i) => sum + Number(i.quantity || 0), 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function fetchTransactions({ dateFrom, dateTo, orderSource, fulfillment, paymentMethod, paymentStatus, orderStatus, refundStatus } = {}) {
  let query = supabase.from('orders').select(SELECT).order('created_at', { ascending: false }).limit(FETCH_CAP)
  if (dateFrom) query = query.gte('created_at', dateFrom)
  if (dateTo) query = query.lte('created_at', dateTo)
  if (orderSource && orderSource !== 'all') query = query.eq('order_source', orderSource)
  if (fulfillment && fulfillment !== 'all') query = query.eq('order_type', fulfillment)
  if (paymentStatus && paymentStatus !== 'all') query = query.eq('payment_status', paymentStatus)
  if (orderStatus && orderStatus !== 'all') query = query.eq('status', orderStatus)
  if (refundStatus && refundStatus !== 'all') query = query.eq('refund_status', refundStatus)

  const { data, error } = await query
  if (error) throw error
  const rows = data || []

  const cashierIds = [...new Set(rows.map((r) => r.cashier_id).filter(Boolean))]
  let cashierNames = {}
  if (cashierIds.length) {
    const { data: profiles, error: profileError } = await supabase.from('profiles').select('id,full_name').in('id', cashierIds)
    if (profileError) throw profileError
    cashierNames = Object.fromEntries((profiles || []).map((p) => [p.id, p.full_name]))
  }

  let transactions = rows.map((r) => normalize(r, cashierNames))
  if (paymentMethod && paymentMethod !== 'all') transactions = transactions.filter((t) => t.paymentMethod === paymentMethod)
  return transactions
}

export async function fetchTransactionAudit(orderId) {
  const { data, error } = await supabase
    .from('transaction_audit_log')
    .select('id,action,reason,previous_value,new_value,performed_by,created_at,profiles(full_name)')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map((r) => ({ ...r, staffName: r.profiles?.full_name || 'Unknown' }))
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
  const headers = ['Order Number', 'Receipt Number', 'Date', 'Customer', 'Source', 'Fulfillment', 'Items', 'Payment Method', 'Payment Status', 'Order Status', 'Refund Status', 'Voided', 'Cashier', 'Total']
  const rows = transactions.map((t) => [
    t.orderNumber, t.receiptNumber, new Date(t.createdAt).toISOString(), t.customerName, t.isOnline ? 'Online' : 'Walk-in',
    t.fulfillment, t.itemCount, t.paymentMethod || '', t.paymentStatus, t.status, t.refundStatus, t.isVoided ? 'Yes' : 'No',
    t.cashierName || '', t.finalTotal.toFixed(2),
  ])
  const meta = [
    [`Generated at`, new Date().toISOString()],
    [`Generated by`, generatedBy || 'Unknown'],
    [`Total records`, transactions.length],
    [],
  ]
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`
  const csv = [...meta, headers, ...rows].map((row) => row.map(escape).join(',')).join('\n')
  return csv
}
