import { isSupabaseConfigured, supabase } from '../lib/supabase'
export async function fetchProducts(){if(!isSupabaseConfigured)return null;const {data,error}=await supabase.from('products').select('*, product_variations(*), product_addons(addons(*))').eq('is_active',true).order('display_order');if(error)throw error;return data}
export async function fetchProfile(userId){const {data,error}=await supabase.from('profiles').select('*').eq('id',userId).single();if(error)throw error;return data}
export async function saveProfile(userId,values){const {data,error}=await supabase.from('profiles').upsert({id:userId,...values,updated_at:new Date().toISOString()}).select().single();if(error)throw error;return data}
export async function fetchAddresses(userId){const {data,error}=await supabase.from('customer_addresses').select('*').eq('customer_id',userId).order('is_default',{ascending:false});if(error)throw error;return data}
export async function createCustomerOrder(payload){if(!isSupabaseConfigured)throw new Error('Supabase is not configured.');const {data,error}=await supabase.rpc('create_customer_order',{request_payload:payload});if(error)throw error;return data}
