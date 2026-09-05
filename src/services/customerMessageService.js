import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { isValidEmail, isValidPhone, sanitizePersonName, sanitizePhone } from '../utils/inputValidation'

export async function submitCustomerMessage(payload) {
  if (!isSupabaseConfigured) throw new Error('Messaging is unavailable because Supabase is not configured.')
  const name= sanitizePersonName(payload.name||'',60).trim()
  const email=String(payload.email||'').trim().toLowerCase()
  const phone=sanitizePhone(payload.phone||'')
  const subject=String(payload.subject||'').trim()
  const message=String(payload.message||'').trim()
  const quantity=String(payload.quantity||'').trim()
  if(name.length<2||name!==String(payload.name||'').trim())throw new Error('Enter a valid name using letters only.')
  if(!isValidEmail(email))throw new Error('Enter a valid email address.')
  if(phone&&!isValidPhone(phone))throw new Error('Contact number must contain 11 digits and start with 09.')
  if(!subject||subject.length>100)throw new Error('Enter a subject of up to 100 characters.')
  if(!message||message.length>2000)throw new Error('Enter a message of up to 2,000 characters.')
  if(quantity.length>60)throw new Error('Quantity details must be 60 characters or fewer.')
  const { data, error } = await supabase.rpc('submit_customer_message', {
    p_category: payload.category,
    p_source: payload.source,
    p_name: name,
    p_email: email,
    p_phone: phone || null,
    p_subject: subject,
    p_message: message,
    p_inquiry_type: payload.inquiryType || null,
    p_preferred_date: payload.preferredDate || null,
    p_quantity: quantity || null,
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
