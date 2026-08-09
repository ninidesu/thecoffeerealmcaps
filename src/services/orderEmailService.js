import { supabase } from '../lib/supabase'

export async function dispatchOrderEmails(orderId) {
  if (!orderId) return { ok: false, reason: 'missing_order_id' }
  const { data, error } = await supabase.functions.invoke('process-order-email-outbox', {
    body: { order_id: orderId },
  })
  if (error) return { ok: false, error }
  const results = data?.results || []
  const failed = results.some((result) => result?.sent === false)
  return { ok: !failed, processed: Number(data?.processed || 0), results }
}
