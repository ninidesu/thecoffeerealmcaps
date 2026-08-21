import { supabase } from '../lib/supabase'

const cakeWholePrices={
 'blueberry-cheesecake':1900,'matcha-cheesecake':2100,'leche-flan-cheesecake':2400,
 'basque-burnt-cheesecake':2200,'biscoff-burnt-cheesecake':2600,'carrot-walnut-cake':2400,
 'red-velvet-cake':2400,'tiramisu':2700,
}
const fallbackImage='/images/coffeerealmlogo.png'
const imagePath=value=>{if(!value)return fallbackImage;const clean=String(value).replace(/^\/+/, '');if(clean.startsWith('assets/'))return `/${clean}`;return value.startsWith('/')?value:`/${value}`}
const parseVariants=(row,category)=>{
 const configured=row.variant_options&&typeof row.variant_options==='object'?row.variant_options:null
 if(configured&&Object.keys(configured.prices||{}).length)return Object.entries(configured.prices).map(([id,price])=>({id,name:configured.labels?.[id]||id,price:Number(price),priceAdjustment:Number(price)-Number(row.price)}))
 if(category==='Cakes'&&cakeWholePrices[row.slug])return [{id:'slice',name:'Slice',price:Number(row.price),priceAdjustment:0},{id:'whole',name:'Whole',price:cakeWholePrices[row.slug],priceAdjustment:cakeWholePrices[row.slug]-Number(row.price)}]
 if(row.slug==='bestseller-box')return [{id:'box3',name:'Box of 3',price:365,priceAdjustment:0},{id:'box6',name:'Box of 6',price:750,priceAdjustment:385}]
 return []
}
const temperatures=type=>type==='flexible'?['Hot','Cold']:type==='hot_only'?['Hot']:type==='iced_only'?['Cold']:[]
const normalizeAddon=row=>({id:row.id,name:row.name,price:Number(row.price),appliesTo:row.applies_to||'both',targetTemperature:row.target_temperature||'both'})

export async function fetchMenuCatalog(){
 const [{data:rows,error:menuError},{data:addonRows,error:addonError}]=await Promise.all([
  supabase.from('menu_items').select('*, subcategories(display_name,name), main_categories(display_name,name)').eq('is_archived',false).order('sort_order'),
  supabase.from('addons').select('*').eq('is_available',true).order('sort_order'),
 ])
 if(menuError)throw menuError
 if(addonError)throw addonError
 const foodAddonRows=(rows||[]).filter(row=>(row.subcategories?.name||'')==='add_ons'&&row.is_available)
 const addons=[...(addonRows||[]).map(normalizeAddon),...foodAddonRows.map(row=>({id:row.id,name:row.name,price:Number(row.price),appliesTo:'food',targetTemperature:'both'}))]
 const products=(rows||[]).filter(row=>(row.subcategories?.name||'')!=='add_ons').map(row=>{
  const category=row.subcategories?.display_name||row.subcategories?.name||'Menu'
  return {id:row.id,slug:row.slug,name:row.name,category,description:row.description||'',basePrice:Number(row.price),image:imagePath(row.image_url),available:Boolean(row.is_available),itemType:row.item_type||'food',temperatureType:row.temperature_type||'none',temperatures:temperatures(row.temperature_type),allowIce:Boolean(row.allow_ice),iceLevels:row.allow_ice?['Less Ice','Default Ice','More Ice']:[],allowSugar:Boolean(row.allow_sugar),sugars:row.allow_sugar?['0%','25%','50%','75%','100%']:[],allowAddons:Boolean(row.allow_addons)||(row.subcategories?.name==='meals'),variations:parseVariants(row,category),addons}
 })
 return {products,categories:['All',...new Set(products.map(product=>product.category))]}
}
