import { supabase } from '../lib/supabase'

const ACTIVE_SELECT = 'id,order_number,order_type,status,customer_name,customer_email,customer_phone,delivery_address,schedule_date,schedule_time,subtotal,delivery_fee,final_total,payment_status,payment_confirmed,payment_proof_path,cancellation_reason,cancelled_by_role,cancelled_at,cancellation_resolved,created_at,updated_at,order_items(id,menu_item_id,item_name,display_name,unit_price,quantity,addons_total,line_total,addons,customizations),payments(method,status,amount_due,reference_number)'

export async function fetchOpsOrders() {
  const { data, error } = await supabase
    .from('orders')
    .select(ACTIVE_SELECT)
    .eq('order_source', 'customer_pos')
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
  return data
}

export async function resolveCancellation(orderId) {
  const { data, error } = await supabase.rpc('staff_resolve_cancellation', { p_order_id: orderId })
  if (error) throw error
  return data
}

export async function getPaymentProofUrl(path) {
  if (!path) return null
  const { data, error } = await supabase.storage.from('payment-proofs').createSignedUrl(path, 300)
  if (error) throw error
  return data?.signedUrl || null
}
