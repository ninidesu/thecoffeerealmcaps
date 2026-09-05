import { supabase } from '../lib/supabase'
import { validateImageFile } from '../utils/imageUpload'
import { validateBenefitInformation } from '../utils/benefits'
export { BENEFIT_STATUS, benefitKind, benefitLinkLabel, validateBenefitInformation } from '../utils/benefits'

export async function fetchBenefitApplication(customerId) {
  const { data, error } = await supabase.from('benefit_applications').select('*').eq('customer_id', customerId).maybeSingle()
  if (error) throw error
  return data
}
export async function fetchBenefitApplications(status, page = 1) {
  let query = supabase.from('benefit_applications').select('*', { count: 'exact' }).order('submitted_at', { ascending: false }).order('id')
  if (status !== 'all') query = query.eq('status', status)
  const { data, count, error } = await query.range((page - 1) * 10, page * 10 - 1)
  if (error) throw error
  return { items: data || [], count: count || 0 }
}
export async function benefitDocumentUrl(path) {
  const { data, error } = await supabase.storage.from('benefit-documents').createSignedUrl(path, 300)
  if (error) throw error
  return data.signedUrl
}
export async function submitBenefitApplication(values, file, existingPath, consent) {
  const validation = validateBenefitInformation(values)
  if (validation) throw new Error(validation)
  if (!consent) throw new Error('Confirm your information and consent to verification.')
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) throw authError || new Error('Please sign in again.')
  let documentPath = existingPath
  if (file) {
    const { extension, mimeType } = await validateImageFile(file, { label: 'ID image' })
    documentPath = `${user.id}/${crypto.randomUUID()}.${extension}`
    const { error } = await supabase.storage.from('benefit-documents').upload(documentPath, file, { contentType: mimeType, upsert: false })
    if (error) throw error
  }
  if (!documentPath) throw new Error('Upload a clear photo of your valid ID.')
  const { data, error } = await supabase.rpc('submit_benefit_application', {
    p_kind: values.kind, p_full_name: values.full_name.trim(), p_date_of_birth: values.date_of_birth,
    p_id_number: values.id_number.trim(), p_document_path: documentPath, p_consent: consent,
  })
  // On an uncertain response, retain the upload; it may belong to a committed submission.
  if (error) throw error
  return data
}
export async function reviewBenefitApplication(application, status, note) {
  const { data, error } = await supabase.rpc('review_benefit_application', {
    p_id: application.id, p_revision: application.revision, p_status: status, p_note: note.trim(),
  })
  if (error) throw error
  return data
}
