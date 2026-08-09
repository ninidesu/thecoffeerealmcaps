import { isSupabaseConfigured, supabase } from '../lib/supabase'

export async function submitCustomerMessage(payload) {
  if (!isSupabaseConfigured) throw new Error('Messaging is unavailable because Supabase is not configured.')
  const { data, error } = await supabase.rpc('submit_customer_message', {
    p_category: payload.category,
    p_source: payload.source,
    p_name: payload.name,
    p_email: payload.email,
    p_phone: payload.phone || null,
    p_subject: payload.subject,
    p_message: payload.message,
    p_inquiry_type: payload.inquiryType || null,
    p_preferred_date: payload.preferredDate || null,
    p_quantity: payload.quantity || null,
  })
  if (error) throw error
  return data
}

export async function fetchCustomerMessages() {
  if (!isSupabaseConfigured) return []
  const { data, error } = await supabase
    .from('customer_messages')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function replyToCustomerMessage(messageId, reply) {
  if (!isSupabaseConfigured) throw new Error('Messaging is unavailable because Supabase is not configured.')
  const { data, error } = await supabase.functions.invoke('reply-customer-message', {
    body: { message_id: messageId, reply },
  })
  if (error) throw error
  if (!data?.success) throw new Error(data?.error || 'The reply could not be sent.')
  return data.message
}
