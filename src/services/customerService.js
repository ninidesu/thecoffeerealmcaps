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
export async function fetchAddresses(userId){const {data,error}=await supabase.from('customer_addresses').select('*').eq('customer_id',userId).order('is_default',{ascending:false});if(error)throw error;return data}
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
  if(attachError)throw attachError
  return {path,filename}
}
export async function setCustomerOrderStatus(orderId,status){
  const {error}=await supabase.rpc('set_customer_order_status',{p_order_id:orderId,p_status:status})
  if(error)throw error
}