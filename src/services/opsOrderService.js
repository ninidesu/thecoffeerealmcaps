import { supabase } from '../lib/supabase'
import { dispatchOrderEmails } from './orderEmailService'

const ACTIVE_SELECT = 'id,order_number,order_type,status,customer_name,customer_email,customer_phone,delivery_address,schedule_date,schedule_time,subtotal,delivery_fee,final_total,payment_status,payment_confirmed,payment_proof_path,refund_status,cancellation_status,fulfillment_hold,cancellation_reason,cancellation_notes,cancellation_requested_by_role,cancellation_requested_at,cancellation_reviewed_at,cancellation_review_notes,cancelled_by_role,cancelled_at,cancellation_resolved,created_at,updated_at,order_items(id,menu_item_id,item_name,display_name,unit_price,quantity,addons_total,line_total,addons,customizations),payments(method,status,amount_due,reference_number),refunds(id,refund_amount,refund_status,refund_method,reference_number,requested_at,processed_at)'

export async function fetchOpsOrders() {
  const { data, error } = await supabase
    .from('orders')
    .select(ACTIVE_SELECT)
    .in('order_source', ['customer_pos', 'cashier_pos'])
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function fetchAddonNameMap() {
  const { data, error } = await supabase.from('addons').select('id,name')
  if (error) throw error
  return Object.fromEntries((data || []).map((a) => [a.id, a.name]))
}

export async function confirmOrder(orderId) {
  const { data, error } = await supabase.rpc('staff_confirm_order', { p_order_id: orderId })
  if (error) throw error
  return data
}

export async function advanceOrderStatus(orderId, nextStatus) {
  const { data, error } = await supabase.rpc('staff_advance_order_status', { p_order_id: orderId, p_new_status: nextStatus })
  if (error) throw error
  return data
}

export async function cancelOrder(orderId, reason) {
  const { data, error } = await supabase.rpc('staff_cancel_order', { p_order_id: orderId, p_reason: reason })
  if (error) throw error
  const email = await dispatchOrderEmails(orderId)
  return { ...(data || {}), email }
}

export async function reviewCancellation({ orderId, approve, notes, paymentOutcome = null }) {
  const { data, error } = await supabase.rpc('staff_review_cancellation', {
    p_order_id: orderId,
    p_approve: approve,
    p_notes: notes,
    p_refund_amount: null,
    p_payment_outcome: paymentOutcome,
  })
  if (error) throw error
  const email = await dispatchOrderEmails(orderId)
  return { ...(data || {}), email }
}

export async function resolveCancellation(orderId) {
  const { data, error } = await supabase.rpc('staff_resolve_cancellation', { p_order_id: orderId })
  if (error) throw error
  return data
}

export async function completeCancellationRefund({ orderId, refundId, referenceNumber }) {
  const { error } = await supabase.rpc('staff_process_refund', {
    p_refund_id: refundId,
    p_approve: true,
    p_reference_number: referenceNumber,
  })
  if (error) throw error
  const email = await dispatchOrderEmails(orderId)
  return { email }
}

export async function getPaymentProofUrl(path) {
  if (!path) return null
  const { data, error } = await supabase.storage.from('payment-proofs').createSignedUrl(path, 300)
  if (error) throw error
  return data?.signedUrl || null
}
