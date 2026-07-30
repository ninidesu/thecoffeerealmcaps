import { isSupabaseConfigured, supabase } from '../lib/supabase'
export async function fetchProducts(){if(!isSupabaseConfigured)return null;const {data,error}=await supabase.from('products').select('*, product_variations(*), product_addons(addons(*))').eq('is_active',true).order('display_order');if(error)throw error;return data}
export async function fetchProfile(userId){const {data,error}=await supabase.from('profiles').select('*').eq('id',userId).single();if(error)throw error;return data}
export async function saveProfile(userId,values){
  const metadata={full_name:values.full_name,phone:values.phone}
  const {data:authData,error:authError}=await supabase.auth.updateUser({data:metadata})
  if(authError)throw authError
  const {data}=await supabase.from('profiles').update({...values,updated_at:new Date().toISOString()}).eq('id',userId).select().maybeSingle()
  return data||{id:userId,email:values.email||authData.user?.email,...metadata}
}
export async function fetchAddresses(userId){const {data,error}=await supabase.from('customer_addresses').select('*').eq('customer_id',userId).order('is_default',{ascending:false}).order('created_at',{ascending:false});if(error)throw error;return data}
export async function createAddress(userId,values){const {data,error}=await supabase.from('customer_addresses').insert({customer_id:userId,label:values.label||null,recipient_name:values.recipientName||null,phone:values.phone||null,address_line:values.addressLine,barangay:values.barangay||null,city:values.city||'Quezon City',province:values.province||'Metro Manila',postal_code:values.postalCode||null,delivery_notes:values.deliveryNotes||null,is_default:Boolean(values.isDefault)}).select().single();if(error)throw error;return data}
export async function updateAddress(addressId,values){const {data,error}=await supabase.from('customer_addresses').update({label:values.label||null,recipient_name:values.recipientName||null,phone:values.phone||null,address_line:values.addressLine,barangay:values.barangay||null,city:values.city||'Quezon City',province:values.province||'Metro Manila',postal_code:values.postalCode||null,delivery_notes:values.deliveryNotes||null,is_default:Boolean(values.isDefault),updated_at:new Date().toISOString()}).eq('id',addressId).select().single();if(error)throw error;return data}
export async function deleteAddress(addressId){const {error}=await supabase.from('customer_addresses').delete().eq('id',addressId);if(error)throw error}
export async function setDefaultAddress(addressId){const {data,error}=await supabase.from('customer_addresses').update({is_default:true,updated_at:new Date().toISOString()}).eq('id',addressId).select().single();if(error)throw error;return data}
export async function createCustomerOrder(payload){if(!isSupabaseConfigured)throw new Error('Supabase is not configured.');const {data,error}=await supabase.rpc('create_customer_order',{request_payload:payload});if(error)throw error;return data}

export async function uploadPaymentProof({orderId,userId,file}){
  const extensions={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}
  const extension=extensions[file?.type]
  if(!extension)throw new Error('Upload a JPG, PNG, or WEBP image only.')
  if(file.size>5*1024*1024)throw new Error('The payment proof must be 5 MB or smaller.')
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date())
  const date=Object.fromEntries(parts.map(part=>[part.type,part.value]))
  const filename=`${orderId}_${date.year}${date.month}${date.day}.${extension}`
  const path=`${userId}/${filename}`
  const {error:uploadError}=await supabase.storage.from('payment-proofs').upload(path,file,{contentType:file.type,upsert:false})
  if(uploadError)throw uploadError
  const {error:attachError}=await supabase.rpc('attach_customer_payment_proof',{p_order_id:orderId,p_path:path})
  if(attachError){
    const {error:cleanupError}=await supabase.storage.from('payment-proofs').remove([path])
    if(cleanupError)throw new Error(attachError.message+' The uploaded file could not be cleaned up: '+cleanupError.message)
    throw attachError
  }
  return {path,filename}
}
const ORDER_DETAIL_SELECT='id,order_number,order_type,status,subtotal,delivery_fee,final_total,payment_status,payment_confirmed,payment_proof_path,refund_status,cancellation_reason,cancellation_notes,cancelled_by_role,cancelled_at,schedule_date,schedule_time,created_at,updated_at,delivery_address,delivery_notes,customer_name,customer_phone,customer_email,order_items(id,menu_item_id,item_name,display_name,unit_price,quantity,addons_total,line_total,addons,customizations),payments(method,status,reference_number)'

export async function fetchCustomerOrders(userId){
  const {data,error}=await supabase.from('orders').select(ORDER_DETAIL_SELECT).eq('customer_id',userId).order('created_at',{ascending:false})
  if(error)throw error
  return data||[]
}
export async function fetchCustomerOrder(orderId){
  const {data,error}=await supabase.from('orders').select(ORDER_DETAIL_SELECT).eq('id',orderId).maybeSingle()
  if(error)throw error
  return data||null
}
export async function cancelCustomerOrder(orderId,reason,notes){
  const {data,error}=await supabase.rpc('customer_cancel_order',{p_order_id:orderId,p_reason:reason,p_notes:notes||null})
  if(error)throw error
  return data
}
export async function getCustomerPaymentProofUrl(path){
  if(!path)return null
  const {data,error}=await supabase.storage.from('payment-proofs').createSignedUrl(path,300)
  if(error)throw error
  return data?.signedUrl||null
}
export async function fetchOrderFeedback(orderId,userId){
  const {data,error}=await supabase.from('order_feedback').select('id,rating,comment').eq('order_id',orderId).eq('customer_id',userId).maybeSingle()
  if(error)throw error
  return data||null
}
export async function fetchAddonNameMap(){
  const {data,error}=await supabase.from('addons').select('id,name')
  if(error)throw error
  return Object.fromEntries((data||[]).map(a=>[a.id,a.name]))
}
export async function submitOrderFeedback({orderId,userId,rating,comment}){
  const {data,error}=await supabase.from('order_feedback').insert({order_id:orderId,customer_id:userId,rating,comment:comment||null}).select().single()
  if(error)throw error
  return data
}
