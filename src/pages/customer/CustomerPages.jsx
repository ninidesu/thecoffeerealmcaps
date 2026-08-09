import { AlertTriangle, ArrowRight, Bike, Check, ChevronLeft, Clock3, Coffee, CreditCard, Lock, Mail, MapPin, Minus, PackageCheck, PartyPopper, Pencil, Plus, Printer, Receipt, RotateCcw, Search, ShieldCheck, ShoppingBag, Star, Trash2, X, XCircle } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMenuCatalog } from '../../hooks/useMenuCatalog'
import { useCart } from '../../context/CartContext'
import { useAuth } from '../../context/AuthContext'
import { createCustomerOrder, fetchAddresses, createAddress, updateAddress, deleteAddress, setDefaultAddress, saveProfile, uploadPaymentProof, fetchCustomerOrders, fetchCustomerOrder, cancelCustomerOrder, getCustomerPaymentProofUrl, fetchOrderFeedback, submitOrderFeedback, fetchAddonNameMap } from '../../services/customerService'
import { deliveryAreas } from '../../data/deliveryAreas'
import { money } from '../../utils/money'
import { describeError } from '../../utils/describeError'
import { useProductCustomization } from '../../hooks/useProductCustomization'
import Choice from '../../components/Choice'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { SYSTEM_DEFAULTS, fetchPublicDeliveryAreas, fetchPublicPortalData } from '../../services/adminPortalConfigurationService'
export function MenuPage(){const [query,setQuery]=useState('');const [category,setCategory]=useState('All');const [chipMotion,setChipMotion]=useState('All');const {products,categories,loading,error}=useMenuCatalog();const {addToCart,openProduct,modal}=useProductCustomization({modalVariant:'menu-detail'});useEffect(()=>{const timeout=window.setTimeout(()=>setChipMotion(''),460);return()=>window.clearTimeout(timeout)},[category]);const filtered=products.filter(p=>(category==='All'||p.category===category)&&`${p.name} ${p.description}`.toLowerCase().includes(query.toLowerCase()));return <main className="customer-main"><section className="page-hero"><span>Made fresh in North Fairview</span><h1>Find your next favorite.</h1></section><div className="menu-tools"><label><Search/><span className="sr-only">Search menu</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search drinks, cakes, and meals"/></label><div className="menu-chip-row">{categories.map(c=><button className={`category-chip ${c===category?'active':''} ${c===chipMotion?'is-switching':''}`.trim()} onClick={()=>{setChipMotion(c);setCategory(c)}} key={c} type="button">{c}</button>)}</div></div>{loading?<section className="customer-state">Loading today’s menu…</section>:error?<section className="customer-state error-state"><h2>We couldn’t load the menu.</h2><p>{error}</p></section>:<section className="customer-products menu-results-grid" key={`${category}-${query}`}>{filtered.map(p=><ProductCard key={p.id} product={p} onAddToCart={addToCart} onPreview={openProduct}/>)}</section>}
    {modal}
  </main>
}
function ProductCard({product,onAddToCart,onPreview}){const label=product.variations.length?`From ${money(Math.min(...product.variations.map(v=>v.price)))}`:money(product.basePrice);return <article className={`customer-product ${!product.available?'unavailable':''}`}><button type="button" className="customer-product-media" onClick={()=>onPreview(product)} aria-label={`Preview ${product.name}`}><img src={product.image} alt={product.name}/></button><div><small>{product.category}</small><h2>{product.name}</h2><div className="product-badges">{product.temperatureType==='iced_only'&&<span>Cold only</span>}{product.temperatureType==='hot_only'&&<span>Hot only</span>}{product.temperatureType==='flexible'&&<span>Hot or cold</span>}{product.variations.length>0&&<span>Options available</span>}</div><footer><strong>{label}</strong>{product.available?<button type="button" className="round-action" onClick={()=>onAddToCart(product)} aria-label={`Add ${product.name} to cart`}><Plus/></button>:<span>Unavailable</span>}</footer></div></article>}
export function ProductPage(){const {slug}=useParams();const {products,loading,error}=useMenuCatalog();const product=products.find(p=>p.slug===slug);const {addItem}=useCart();const navigate=useNavigate();const [variationId,setVariationId]=useState('');const [temperature,setTemperature]=useState('');const [ice,setIce]=useState('Default Ice');const [sugar,setSugar]=useState('75%');const [addons,setAddons]=useState([]);const [quantity,setQuantity]=useState(1);const [instructions,setInstructions]=useState('');if(loading)return <main className="customer-state">Loading productâ€¦</main>;if(error)return <main className="customer-state error-state">{error}</main>;if(!product)return <NotFoundPage/>;const variation=product.variations.find(v=>v.id===(variationId||product.variations[0]?.id))||null;const selectedTemperature=temperature||product.temperatures[0]||'';const isCold=/cold|iced/i.test(selectedTemperature);const applicableAddons=product.allowAddons?product.addons.filter(a=>(a.appliesTo==='both'||a.appliesTo===product.itemType)&&(a.targetTemperature==='both'||(isCold&&/iced|cold/.test(a.targetTemperature)))):[];const selectedAddons=addons.filter(a=>applicableAddons.some(valid=>valid.id===a.id));const unitPrice=variation?.price??product.basePrice;const total=(unitPrice+selectedAddons.reduce((s,a)=>s+a.price,0))*quantity;const toggle=a=>setAddons(v=>v.some(x=>x.id===a.id)?v.filter(x=>x.id!==a.id):[...v,a]);return <main className="customer-main"><Link className="back-link" to="/menu"><ChevronLeft/>Back to menu</Link><section className="product-detail"><img src={product.image} alt={product.name}/><div><small>{product.category}</small><h1>{product.name}</h1><p>{product.description}</p>{product.variations.length>0&&<Choice title={product.category==='Cakes'?'Portion':'Option'} options={product.variations} value={variation?.id} onChange={setVariationId}/>} {product.temperatures.length>0&&<Choice title="Temperature" options={product.temperatures.map(x=>({id:x,name:x}))} value={selectedTemperature} onChange={value=>{setTemperature(value);if(!/cold|iced/i.test(value))setAddons(current=>current.filter(a=>a.targetTemperature==='both'))}}/>} {product.allowIce&&isCold&&<Choice title="Ice level" options={product.iceLevels.map(x=>({id:x,name:x}))} value={ice} onChange={setIce}/>} {product.allowSugar&&<Choice title="Sugar level" options={product.sugars.map(x=>({id:x,name:x}))} value={sugar} onChange={setSugar}/>} {applicableAddons.length>0&&<fieldset className="choice-group"><legend>Add-ons</legend>{applicableAddons.map(a=><label className="check-choice" key={a.id}><input type="checkbox" checked={selectedAddons.some(x=>x.id===a.id)} onChange={()=>toggle(a)}/><span>{a.name}</span><b>+{money(a.price)}</b></label>)}</fieldset>}<label className="field"><span>Special instructions</span><textarea value={instructions} onChange={e=>setInstructions(e.target.value)} placeholder="Allergies or preparation notes"/></label><div className="add-bar"><div className="quantity"><button onClick={()=>setQuantity(q=>Math.max(1,q-1))}><Minus/></button><b>{quantity}</b><button onClick={()=>setQuantity(q=>Math.min(99,q+1))}><Plus/></button></div><button className="primary-button" disabled={!product.available} onClick={()=>{addItem({productId:product.id,slug:product.slug,name:product.name,image:product.image,variation,temperature:selectedTemperature,ice:product.allowIce&&isCold?ice:'',sugar:product.allowSugar?sugar:'',addons:selectedAddons,instructions,quantity,unitPrice})}}>Add to cart Â· {money(total)}</button></div></div></section></main>}
const STORE_OPEN_MINUTES=10*60
const STORE_CLOSE_MINUTES=23*60+59
const manilaDate=(offset=0)=>{const date=new Date(Date.now()+offset*86400000);const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);const map=Object.fromEntries(parts.map(part=>[part.type,part.value]));return `${map.year}-${map.month}-${map.day}`}
const scheduleDates=[{id:manilaDate(),name:'Today'},{id:manilaDate(1),name:'Tomorrow'}]
const timeLabel=minutes=>{const hour=Math.floor(minutes/60);const minute=minutes%60;return `${hour%12||12}:${String(minute).padStart(2,'0')} ${hour>=12?'PM':'AM'}`}
const normalizePhone=value=>String(value||'').replace(/\D/g,'').slice(0,11)
const normalizePostal=value=>String(value||'').replace(/\D/g,'').slice(0,6)
const customerOrderNumber=value=>{const raw=String(value||'').trim();if(!raw)return '';if(/^#?D\d{10}$/i.test(raw))return raw.startsWith('#')?raw:`#${raw.toUpperCase()}`;const digits=raw.replace(/\D/g,'');if(digits.length>=10)return `#D${digits.slice(-10)}`;return raw}
const paymentMethodLabel=value=>value==='cod'?'Cash on delivery':value==='bank_transfer'?'Bank transfer':'GCash'
const fulfillmentLabel=value=>value==='pickup'?'Store pickup':'Delivery'
const titleCase=value=>String(value||'').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim().replace(/\b\w/g,letter=>letter.toUpperCase())
const orderPaymentMethod=order=>order?.payments?.[0]?.method||order?.payment_method||order?.payment||'gcash'
const orderPaymentStatus=order=>{
  const raw=String(order?.payments?.[0]?.status||order?.payment_status||'pending').toLowerCase()
  const method=orderPaymentMethod(order)
  if(method==='cod')return raw==='paid'?'Paid':'Pay on delivery'
  if(raw==='paid'||raw==='verified'||raw==='confirmed')return 'Verified'
  if(raw==='failed')return 'Payment issue'
  return 'Pending verification'
}
const initialOrderStatusLabel=payment=>payment==='cod'?'Order Received':'Awaiting Payment Verification'
const orderStatusLabel=(order,{fresh=false}={})=>{
  const method=orderPaymentMethod(order)
  if(fresh)return initialOrderStatusLabel(method)
  const raw=String(order?.status||'').trim()
  if(!raw)return initialOrderStatusLabel(method)
  if(raw==='Pending Confirmation')return 'Awaiting Payment Verification'
  return raw
}
const orderStatusTone=status=>{
  const normalized=String(status||'').trim().toLowerCase()
  if(normalized==='awaiting payment verification')return 'status-chip--attention'
  if(normalized==='order received')return 'status-chip--received'
  if(normalized==='confirmed')return 'status-chip--confirmed'
  if(normalized==='preparing')return 'status-chip--preparing'
  if(normalized==='out for delivery')return 'status-chip--delivery'
  if(normalized==='ready for pickup')return 'status-chip--pickup'
  if(normalized==='completed')return 'status-chip--completed'
  if(normalized==='cancelled')return 'status-chip--cancelled'
  return 'status-chip--neutral'
}
const parseScheduleMinutes=value=>{if(!value)return null;const [hour='0',minute='0']=String(value).split(':');const h=Number(hour);const m=Number(minute);return Number.isFinite(h)&&Number.isFinite(m)?h*60+m:null}
const orderScheduleLabel=order=>{const date=order?.schedule_date||order?.scheduleDate;const time=order?.schedule_time||order?.scheduleTime;if(!date||!time)return 'We’ll confirm your schedule shortly.';const dayLabel=date===manilaDate()?'Today':date===manilaDate(1)?'Tomorrow':new Intl.DateTimeFormat('en-PH',{month:'short',day:'numeric'}).format(new Date(`${date}T00:00:00`));const minutes=parseScheduleMinutes(time);return `${dayLabel} · ${minutes===null?String(time).slice(0,5):timeLabel(minutes)}`}
const orderCount=order=>(order?.order_items||[]).reduce((sum,item)=>sum+Number(item.quantity||item.qty||0),0)
const shortenAddress=value=>{const clean=String(value||'').replace(/\s+/g,' ').trim();if(!clean)return '';const compact=clean.split(',').map(part=>part.trim()).filter(Boolean).slice(0,2).join(', ');if(compact.length>=clean.length)return compact;return compact.length>54?`${compact.slice(0,51)}...`:`${compact}...`}
const completionMessage=order=>orderPaymentMethod(order)==='cod'?'Your order has been received and will be prepared shortly.':'Your payment proof has been submitted for verification.'
const completionNote=order=>{const notes=[];if(orderPaymentMethod(order)==='cod')notes.push('Please prepare the exact amount. Payment will be collected upon delivery.');else notes.push('Your order will be processed after the payment proof is verified.');if((order?.order_type||order?.fulfillment)==='pickup')notes.push('You will be notified when your order is ready for pickup.');return notes.join(' ')}
const estimatedTimeLabel=order=>((order?.order_type||order?.fulfillment)==='pickup'?'Estimated ready time':'Estimated delivery time')
const mergePlacedOrderData=({order,form,items,total})=>{const payment=orderPaymentMethod(order)||form.payment;const fulfillment=order?.order_type||order?.fulfillment||form.fulfillment;return {...order,payment_method:payment,payment_status:order?.payment_status||'pending',payments:order?.payments?.length?order.payments:[{method:payment,status:order?.payment_status||'pending'}],order_type:fulfillment,schedule_date:order?.schedule_date||form.scheduleDate,schedule_time:order?.schedule_time||form.scheduleTime,delivery_address:order?.delivery_address||(fulfillment==='delivery'?`${form.address}, Brgy. ${form.barangay}, ${form.city}, ${form.province} ${form.postal}`:''),final_total:Number(order?.final_total??order?.total??total??0),total:Number(order?.total??order?.final_total??total??0),order_items:order?.order_items?.length?order.order_items:items.map(item=>({id:item.lineId,quantity:item.quantity}))}}
const trackingSteps=order=>((order?.order_type||order?.fulfillment)==='pickup'?[initialOrderStatusLabel(orderPaymentMethod(order)),'Confirmed','Preparing','Ready for Pickup','Completed']:[initialOrderStatusLabel(orderPaymentMethod(order)),'Confirmed','Preparing','Out for Delivery','Completed'])
const trackingStatusCopy=(order,status)=>status==='Awaiting Payment Verification'?'Your payment proof is waiting for review.':status==='Order Received'?'Your order is waiting for store confirmation.':status==='Confirmed'?`Scheduled for ${orderScheduleLabel(order)}`:status==='Preparing'?'The kitchen and bar are preparing your order.':status==='Out for Delivery'?'Your order is on the way.':status==='Ready for Pickup'?'Your order is ready at the store.':status==='Completed'?'This order has been completed.':'Waiting for update'
const clockMinutes=(value,fallback)=>{const [hour,minute]=String(value||'').split(':').map(Number);return Number.isFinite(hour)&&Number.isFinite(minute)?hour*60+minute:fallback}
function scheduleSlots(date,fulfillment,ordering=SYSTEM_DEFAULTS.ordering){if(!date)return[];const nowParts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date());const nowMap=Object.fromEntries(nowParts.map(part=>[part.type,part.value]));const nowMinutes=(Number(nowMap.hour)%24)*60+Number(nowMap.minute);const buffer=fulfillment==='delivery'?60:30;const earliest=date===manilaDate()?nowMinutes+buffer:-1;const open=clockMinutes(ordering.openTime,STORE_OPEN_MINUTES);const close=clockMinutes(ordering.closeTime,STORE_CLOSE_MINUTES);const slots=[];for(let time=open;time<=close;time+=30){if(date===manilaDate()&&time<=earliest)continue;slots.push({id:`${String(Math.floor(time/60)).padStart(2,'0')}:${String(time%60).padStart(2,'0')}`,name:timeLabel(time)})}return slots}
export function CheckoutPage(){
  const {items,subtotal}=useCart();const {user,profile}=useAuth();const navigate=useNavigate();
  const [submitError,setSubmitError]=useState('');
  const [systemSettings,setSystemSettings]=useState(SYSTEM_DEFAULTS);
  const [availableAreas,setAvailableAreas]=useState(deliveryAreas);
  const [addresses,setAddresses]=useState([]);const [selectedAddress,setSelectedAddress]=useState('');const [makeDefaultOnSelect,setMakeDefaultOnSelect]=useState(false);
  const [form,setForm]=useState({fullName:'',email:'',contact:'',fulfillment:'delivery',address:'',barangay:'',city:'Quezon City',province:'Metro Manila',postal:'',instructions:'',payment:'cod',scheduleDate:'',scheduleTime:'',deliveryFee:0,deliveryZone:'',estimatedDeliveryTime:''});
  useEffect(()=>{setForm(current=>({...current,fullName:current.fullName||profile?.full_name||profile?.name||'',email:current.email||profile?.email||user?.email||'',contact:current.contact||normalizePhone(profile?.contact_number||profile?.phone||'')}))},[profile,user]);
  useEffect(()=>{let active=true;fetchPublicPortalData().then(data=>{if(!active)return;setSystemSettings(data.system);setForm(current=>{const delivery=data.system.ordering.deliveryEnabled;const pickup=data.system.ordering.pickupEnabled;const fulfillment=current.fulfillment==='delivery'&&!delivery&&pickup?'pickup':current.fulfillment==='pickup'&&!pickup&&delivery?'delivery':current.fulfillment;const methods=data.system.payments.enabledMethods||[];const allowed=fulfillment==='delivery'?methods:methods.filter(method=>method!=='cod');return {...current,fulfillment,payment:allowed.includes(current.payment)?current.payment:(allowed[0]||'')}})}).catch(()=>{});return()=>{active=false}},[]);
  useEffect(()=>{let active=true;fetchPublicDeliveryAreas().then(data=>{if(active&&data.length)setAvailableAreas(data)}).catch(()=>{});return()=>{active=false}},[])
  useEffect(()=>{let active=true;if(!user?.id)return undefined;fetchAddresses(user.id).then(data=>{
    if(!active)return
    const list=data||[]
    setAddresses(list)
    // Always load the customer's current default address automatically —
    // never a stale/cached one, and never silently overwrite an address the
    // customer is already actively editing on this page.
    const defaultAddress=list.find(address=>address.is_default)
    if(defaultAddress&&!selectedAddress)applyAddress(defaultAddress)
  }).catch(()=>{if(active)setAddresses([])});return()=>{active=false}},[user]);
  const applyAddress=address=>{
    setSelectedAddress(String(address.id))
    setMakeDefaultOnSelect(false)
    setForm(current=>({...current,address:address.address_line||'',barangay:address.barangay||'',city:address.city||'Quezon City',province:address.province||'Metro Manila',postal:address.postal_code||''}))
  }
  const selectedArea=availableAreas.find(area=>area.barangay.toLowerCase()===form.barangay.trim().toLowerCase());const fee=form.fulfillment==='delivery'?(selectedArea?.fee||0):0;const total=subtotal+fee;const slots=useMemo(()=>scheduleSlots(form.scheduleDate,form.fulfillment,systemSettings.ordering),[form.scheduleDate,form.fulfillment,systemSettings.ordering]);
  if(!items.length)return <Empty title="Nothing to checkout" body="Your cart needs at least one item." action="Browse menu" to="/menu"/>;
  const set=(key,value)=>setForm(current=>({...current,[key]:value}));
  const setFulfillment=value=>setForm(current=>{const allowed=(systemSettings.payments.enabledMethods||[]).filter(method=>value==='delivery'||method!=='cod');return {...current,fulfillment:value,payment:allowed.includes(current.payment)?current.payment:(allowed[0]||''),scheduleDate:'',scheduleTime:''}});
  const chooseAddress=id=>{const saved=addresses.find(address=>String(address.id)===String(id));if(!saved)return;applyAddress(saved)};
  const submit=async event=>{
    event.preventDefault();setSubmitError('');if(systemSettings.ordering.storeStatus!=='open'){setSubmitError(systemSettings.ordering.closureMessage);return}if(subtotal<Number(systemSettings.ordering.minimumOrder||0)){setSubmitError(`A minimum order of ${money(systemSettings.ordering.minimumOrder)} is required.`);return}if(!/^\d{11}$/.test(form.contact)){setSubmitError('Contact number must contain exactly 11 digits.');return}if(form.fulfillment==='delivery'&&!/^\d{4,6}$/.test(form.postal)){setSubmitError('Postal code must contain 4 to 6 digits only.');return}if(form.fulfillment==='delivery'&&!selectedArea)return
    // Selecting a saved address never changes the customer's default unless
    // they explicitly opt in here.
    if(makeDefaultOnSelect&&selectedAddress){try{await setDefaultAddress(selectedAddress)}catch{/* non-fatal: proceed with checkout regardless */}}
    const checkout={...form,deliveryFee:fee,deliveryZone:selectedArea?.zone||'',estimatedDeliveryTime:selectedArea?.estimatedTime||''};navigate('/checkout/review',{state:{checkout}})
  };
  return <main className="customer-main checkout-page"><section className="page-title"><span>Secure checkout</span><h1>How should we prepare your order?</h1></section><div className="checkout-layout"><form className="checkout-form" onSubmit={submit}>
    <CheckoutSection n="1" title="Customer information"><div className="form-grid"><Field label="Full name" value={form.fullName} onChange={value=>set('fullName',value)}/><Field label="Email address" type="email" value={form.email} onChange={value=>set('email',value)}/><Field label="Contact number" type="tel" value={form.contact} onChange={value=>set('contact',normalizePhone(value))} inputMode="numeric" maxLength={11} pattern="[0-9]{11}" title="Contact number must contain exactly 11 digits."/></div>{submitError&&<p className="field-hint error">{submitError}</p>}</CheckoutSection>
    <CheckoutSection n="2" title="Fulfillment"><Choice title="Method" options={[systemSettings.ordering.deliveryEnabled&&{id:'delivery',name:'Delivery'},systemSettings.ordering.pickupEnabled&&{id:'pickup',name:'Store pickup'}].filter(Boolean)} value={form.fulfillment} onChange={setFulfillment}/><div className="schedule-fields"><Choice title={`${form.fulfillment==='delivery'?'Delivery':'Pickup'} day`} options={scheduleDates} value={form.scheduleDate} onChange={value=>setForm(current=>({...current,scheduleDate:value,scheduleTime:''}))}/><SelectField label="Time" value={form.scheduleTime} onChange={value=>set('scheduleTime',value)} options={slots} placeholder={form.scheduleDate?(slots.length?'Select time':'No slots available — choose Tomorrow'):'Select a day first'} disabled={!form.scheduleDate||!slots.length}/></div>
    {form.fulfillment==='delivery'?<>{addresses.length>0&&<div className="saved-address-picker"><Choice title="Choose from saved addresses" options={addresses.map((address,index)=>({id:String(address.id),name:address.label||`Address ${index+1}`}))} value={String(selectedAddress)} onChange={chooseAddress}/>{selectedAddress&&!addresses.find(address=>String(address.id)===String(selectedAddress))?.is_default&&<label className="check-choice"><input type="checkbox" checked={makeDefaultOnSelect} onChange={event=>setMakeDefaultOnSelect(event.target.checked)}/><span>Make this my default address</span></label>}</div>}<div className="form-grid"><Field label="House no. / Bldg. / Street / Village" value={form.address} onChange={value=>set('address',value)}/><BarangayField areas={availableAreas} value={form.barangay} onChange={value=>set('barangay',value)} selectedArea={selectedArea}/><Field label="City" value={form.city} readOnly/><Field label="Province" value={form.province} readOnly/><Field label="Postal code" type="tel" value={form.postal} onChange={value=>set('postal',normalizePostal(value))} inputMode="numeric" maxLength={6} pattern="[0-9]{4,6}" title="Postal code must contain 4 to 6 digits only."/></div>{form.barangay&&!selectedArea&&<p className="field-hint error">Please select a Barangay from the delivery list.</p>}</>:<div className="pickup-note"><MapPin/>Lot 1 Block 210 Mark Street corner Dollar Street, North Fairview</div>}<Field label={form.fulfillment==='delivery'?'Delivery instructions':'Pickup note (optional)'} value={form.instructions} onChange={value=>set('instructions',value)} required={false}/></CheckoutSection>
    <CheckoutSection n="3" title="Payment"><Choice title="Payment method" options={(systemSettings.payments.enabledMethods||[]).filter(method=>form.fulfillment==='delivery'||method!=='cod').map(method=>({id:method,name:method==='cod'?'Cash on delivery':method==='bank_transfer'?'Bank':'GCash'}))} value={form.payment} onChange={value=>set('payment',value)}/></CheckoutSection>
    {systemSettings.ordering.storeStatus!=='open'&&<p className="field-hint error">{systemSettings.ordering.closureMessage}</p>}
    <button className="primary-button checkout-submit" disabled={systemSettings.ordering.storeStatus!=='open'||!form.payment||!form.scheduleDate||!form.scheduleTime||(form.fulfillment==='delivery'&&!selectedArea)}>Review order · {money(total)} <ArrowRight/></button>
  </form><CheckoutPreview items={items} subtotal={subtotal} fee={fee} total={total} fulfillment={form.fulfillment} selectedArea={selectedArea}/></div></main>
}
function CheckoutSection({n,title,children}){return <section className="checkout-section"><header><b>{n}</b><h2>{title}</h2></header>{children}</section>}
function Field({label,type='text',value,onChange=()=>{},readOnly=false,required=true,inputMode,pattern,maxLength,title}){return <label className={`field ${readOnly?'locked-field':''}`}><span>{label}</span><input required={required} readOnly={readOnly} aria-readonly={readOnly} value={value} type={type} inputMode={inputMode} pattern={pattern} maxLength={maxLength} title={title} onChange={event=>onChange(event.target.value)}/></label>}
function SelectField({label,value,onChange,options,placeholder,disabled=false}){return <label className="field"><span>{label}</span><select required value={value} onChange={event=>onChange(event.target.value)} disabled={disabled}><option value="">{placeholder}</option>{options.map(option=><option key={option.id} value={option.id}>{option.name}</option>)}</select></label>}
function BarangayField({areas=deliveryAreas,value,onChange,selectedArea}){return <label className="field barangay-field"><span>Barangay</span><input required list="delivery-barangays" autoComplete="off" value={value} onChange={event=>onChange(event.target.value)} placeholder="Type or search Barangay"/><datalist id="delivery-barangays">{areas.map(area=><option key={area.barangay} value={area.barangay}/>)}</datalist>{selectedArea&&<small>Delivery is available in this Barangay.</small>}</label>}
function CheckoutPreview({items,subtotal,fee,total,fulfillment,selectedArea}){return <aside className="checkout-preview"><header><span>Order preview</span><h2>Your order</h2></header><div className="checkout-preview-items">{items.map(item=><article key={item.lineId}><img src={item.image} alt=""/><div><h3>{item.quantity}× {item.name}</h3><p>{[item.variation?.name,item.temperature,item.ice,item.sugar].filter(Boolean).join(' · ')}</p>{item.addons?.length>0&&<small>{item.addons.map(addon=>addon.name).join(', ')}</small>}</div><b>{money((item.unitPrice+(item.addons||[]).reduce((sum,addon)=>sum+addon.price,0))*item.quantity)}</b></article>)}</div><div className="checkout-totals"><p><span>Subtotal</span><b>{money(subtotal)}</b></p>{fulfillment==='delivery'&&<p><span>Delivery fee</span><b>{selectedArea?money(fee):'Select Barangay'}</b></p>}<p className="grand"><span>Total</span><b>{money(total)}</b></p></div></aside>}
function PaymentConfirmationModal({payment,total,paymentConfig=SYSTEM_DEFAULTS.payments,busy,onClose,onConfirm}){
  const isCod=payment==='cod';const isBank=payment==='bank_transfer';const title=isCod?'Confirm Cash on Delivery':isBank?'Bank transfer instructions':'GCash payment instructions';const qr=isBank?(paymentConfig.bankQrUrl||'/assets/img/qr1.jpg'):(paymentConfig.gcashQrUrl||'/assets/img/qr.jpg');const codMaximum=Number(paymentConfig.codMaximum||1000);const instructions=isBank?paymentConfig.bankInstructions:paymentConfig.gcashInstructions
  return <div className="payment-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose()}}><section className="payment-modal order-flow-modal" role="dialog" aria-modal="true" aria-labelledby="payment-modal-title"><button className="payment-modal-close" type="button" onClick={onClose} disabled={busy} aria-label="Close payment dialog">×</button><span className="payment-modal-kicker">{isCod?'Before placing your order':'Complete your payment'}</span><h2 id="payment-modal-title">{title}</h2><div className="payment-modal-total"><span>Amount due</span><strong>{money(total)}</strong></div>{isCod?<><p>Your order will be paid when it arrives. Please confirm that you understand these rules:</p><ul><li>Cash on Delivery is available for delivery orders only.</li><li>COD is available for orders up to {money(codMaximum)}.</li><li>Please prepare the exact amount whenever possible.</li><li>The order is still subject to store confirmation and availability.</li></ul>{total>codMaximum&&<p className="payment-modal-warning">This order exceeds the COD limit. Go back and select GCash or Bank.</p>}</>:<div className="digital-payment-guide"><img src={qr} alt={`${isBank?'Bank':'GCash'} payment QR code`}/><div><p>{instructions}</p>{isBank&&paymentConfig.bankName&&<p><b>{paymentConfig.bankName}</b>{paymentConfig.bankAccountName?` · ${paymentConfig.bankAccountName}`:''}{paymentConfig.bankAccountNumber?` · ${paymentConfig.bankAccountNumber}`:''}</p>}<ol><li>Send the exact total shown above.</li><li>Use your full name as the payment reference.</li><li>Save a clear screenshot or receipt after payment succeeds.</li><li>Continue to upload your proof of payment.</li></ol></div></div>}<div className="payment-modal-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={busy}>Go back</button><button className="primary-button" type="button" onClick={onConfirm} disabled={busy||(isCod&&total>codMaximum)}>{busy?'Placing order…':isCod?'Confirm COD order':'Continue to upload'}</button></div></section></div>
}
function ProofUploadModal({payment,busy,error,onBack,onSubmit}){const [file,setFile]=useState(null);const [fileError,setFileError]=useState('');const choose=event=>{const next=event.target.files?.[0]||null;const allowed=['image/jpeg','image/png','image/webp'];if(next&&!allowed.includes(next.type)){setFile(null);setFileError('Only JPG, PNG, and WEBP images are accepted. GIF, PDF, and documents are not allowed.');event.target.value='';return}if(next&&next.size>5*1024*1024){setFile(null);setFileError('The image is larger than 5 MB. Choose a smaller file.');event.target.value='';return}setFile(next);setFileError('')};return <div className="payment-modal-backdrop"><section className="payment-modal proof-modal" role="dialog" aria-modal="true" aria-labelledby="proof-modal-title"><span className="payment-modal-kicker">{payment==='bank_transfer'?'Bank transfer':'GCash'} payment</span><h2 id="proof-modal-title">Upload proof of payment</h2><p>Upload a clear image showing the successful transaction. The system will securely rename it using the order ID and payment date.</p><label className="proof-dropzone"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={choose}/><ShoppingBag/><strong>{file?file.name:'Choose payment screenshot'}</strong><small>JPG, PNG, or WEBP only · Maximum 5 MB</small></label>{file&&<div className="proof-file"><span>{file.name}</span><b>{(file.size/1024/1024).toFixed(2)} MB</b></div>}{(fileError||error)&&<p className="payment-modal-warning" role="alert">{fileError||error}</p>}<div className="payment-modal-actions"><button className="secondary-button" type="button" onClick={onBack} disabled={busy}>Back to instructions</button><button className="primary-button" type="button" onClick={()=>file&&onSubmit(file)} disabled={!file||busy}>{busy?'Uploading and placing order…':'Submit proof and order'}</button></div></section></div>}
function OrderCompleteModal({order,freshOrder=false,fallbackEstimatedTime='',onTrack,onContinue}){
  const [copied,setCopied]=useState(false)
  const orderNumber=order?.order_number||order?.reference_code||order?.order_id||order?.id
  const displayOrderNumber=customerOrderNumber(orderNumber)
  const fulfillment=order?.order_type||order?.fulfillment||'delivery'
  const status=orderStatusLabel(order,{fresh:freshOrder})
  const paymentMethod=paymentMethodLabel(orderPaymentMethod(order))
  const paymentStatus=orderPaymentStatus(order)
  const itemCount=orderCount(order)
  const totalAmount=Number(order?.final_total??order?.total??0)
  const etaValue=fulfillment==='delivery'?(order?.estimatedDeliveryTime||fallbackEstimatedTime||orderScheduleLabel(order)):orderScheduleLabel(order)
  const shortAddress=fulfillment==='delivery'?shortenAddress(order?.delivery_address):''
  const copyOrderNumber=async()=>{
    if(!displayOrderNumber||!navigator?.clipboard?.writeText)return
    await navigator.clipboard.writeText(String(displayOrderNumber))
    setCopied(true)
    window.setTimeout(()=>setCopied(false),1400)
  }
  return <div className="payment-modal-backdrop">
    <section className="payment-modal order-complete-modal" role="dialog" aria-modal="true" aria-labelledby="complete-modal-title">
      <div className="completion-hero">
        <span className="complete-check"><Check/></span>
        <span className="payment-modal-kicker completion-kicker">Order completed</span>
        <h2 id="complete-modal-title">Your order has been placed.</h2>
        <p className="completion-message">{completionMessage(order)}</p>
      </div>
      <div className="completion-summary">
        <div className="completion-summary-row completion-summary-order-row">
          <span>Order number</span>
          <div className="completion-summary-value completion-summary-inline">
            <b>{displayOrderNumber}</b>
            <button className="completion-copy" type="button" onClick={copyOrderNumber}>{copied?'Copied':'Copy'}</button>
          </div>
        </div>
        <div className="completion-summary-row"><span>Order status</span><div className="completion-summary-value"><b>{status}</b></div></div>
        <div className="completion-summary-row"><span>Payment method</span><div className="completion-summary-value"><b>{paymentMethod}</b></div></div>
        <div className="completion-summary-row"><span>Payment status</span><div className="completion-summary-value"><b>{paymentStatus}</b></div></div>
        <div className="completion-summary-row"><span>Fulfillment</span><div className="completion-summary-value"><b>{fulfillmentLabel(fulfillment)}</b></div></div>
        <div className="completion-summary-row"><span>Items</span><div className="completion-summary-value"><b>{itemCount} item{itemCount===1?'':'s'}</b></div></div>
        <div className="completion-summary-row"><span>Total amount</span><div className="completion-summary-value"><b>{money(totalAmount)}</b></div></div>
        <div className="completion-summary-row"><span>{estimatedTimeLabel(order)}</span><div className="completion-summary-value"><b>{etaValue}</b></div></div>
        {shortAddress&&<div className="completion-summary-row"><span>Delivery address</span><div className="completion-summary-value"><b>{shortAddress}</b></div></div>}
      </div>
      <p className="completion-note">{completionNote(order)}</p>
      <div className="payment-modal-actions completion-actions">
        <button className="secondary-button" type="button" onClick={onContinue}>Continue shopping</button>
        <button className="primary-button" type="button" onClick={onTrack}>Track order</button>
      </div>
    </section>
  </div>
}
export function OrderReviewPage(){
  const {state}=useLocation();const navigate=useNavigate();const {signOut}=useAuth();const {items,subtotal,clearCart}=useCart();const [requestKey]=useState(()=>crypto.randomUUID());const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [modal,setModal]=useState(null);const [createdOrder,setCreatedOrder]=useState(null);const [freshOrder,setFreshOrder]=useState(false);const [paymentConfig,setPaymentConfig]=useState(SYSTEM_DEFAULTS.payments);const form=state?.checkout;
  useEffect(()=>{let active=true;fetchPublicPortalData().then(data=>{if(active)setPaymentConfig(data.system.payments)}).catch(()=>{});return()=>{active=false}},[])
  if(!form||!items.length)return <NotFoundPage/>;
  const fee=form.fulfillment==='delivery'?Number(form.deliveryFee||0):0;const total=subtotal+fee;
  const place=async proof=>{
    if(busy)return
    setBusy(true);setError('')
    try{
      // Confirm Supabase has a genuinely valid session for THIS attempt before
      // touching the database. getUser() (unlike getSession()) revalidates
      // against the Auth server, so this is the only trustworthy signal for
      // "no valid authenticated session" — a downstream database error is
      // never treated as a reason to sign the customer out.
      const {data:sessionCheck,error:sessionError}=await supabase.auth.getUser()
      if(sessionError||!sessionCheck?.user){
        setModal(null)
        await signOut()
        navigate('/login',{replace:true,state:{from:'/checkout',authMessage:'Your session has expired. Please log in again to complete your order.'}})
        return
      }
      let order=createdOrder
      if(!order){
        const response=await createCustomerOrder({request_key:requestKey,customer:{...form},items:items.map(item=>({product_id:item.productId,variation_id:item.variation?.id,temperature:item.temperature,addon_ids:item.addons.map(addon=>addon.id),quantity:item.quantity,special_instructions:item.instructions})),fulfillment_method:form.fulfillment,payment_method:form.payment})
        order=mergePlacedOrderData({order:Array.isArray(response)?response[0]:response,form,items,total})
        setCreatedOrder(order)
      }
      const orderId=order.order_id||order.id
      if(proof)await uploadPaymentProof({orderId,userId:sessionCheck.user.id,file:proof})
      try{const refreshed=await fetchCustomerOrder(orderId);if(refreshed)order=mergePlacedOrderData({order:refreshed,form,items,total})}catch{/* fall back to the freshly created order snapshot */}
      setCreatedOrder(order)
      setFreshOrder(true)
      setModal('complete')
    }catch(cause){
      setError(describeError(cause,'Could not place the order. Please try again.'))
    }finally{
      setBusy(false)
    }
  };
  const finish=destination=>{const orderId=createdOrder?.order_id||createdOrder?.id;if(!orderId)return;clearCart();if(destination==='menu'){navigate('/menu',{replace:true});return}navigate(`/orders/${orderId}/track`,{replace:true,state:{order:createdOrder,freshOrder}})};
  const confirmPayment=()=>form.payment==='cod'?place():setModal('proof');
  return <main className="customer-main narrow"><button className="back-link review-back" type="button" onClick={()=>navigate(-1)}><ChevronLeft/>Back to checkout</button><section className="page-title"><span>Final check</span><h1>Review your order</h1></section><section className="review-card">{items.map(item=><div key={item.lineId}><span>{item.quantity}× {item.name}<small>{item.variation?.name} {item.addons.map(addon=>` · ${addon.name}`)}</small></span><b>{money((item.unitPrice+item.addons.reduce((sum,addon)=>sum+addon.price,0))*item.quantity)}</b></div>)}<hr/><div><span>Subtotal</span><b>{money(subtotal)}</b></div>{form.fulfillment==='delivery'&&<div><span>Delivery · {form.deliveryZone}</span><b>{money(fee)}</b></div>}<div className="grand"><span>Total</span><b>{money(total)}</b></div></section><section className="review-card"><h2>{form.fulfillment==='delivery'?'Delivery details':'Pickup details'}</h2><p>{form.fullName} · {form.contact}</p><p>{form.fulfillment==='delivery'?`${form.address}, Brgy. ${form.barangay}, ${form.city}, ${form.province} ${form.postal}`:'North Fairview store'}</p><p>Scheduled for: {form.scheduleDate===manilaDate()?'Today':'Tomorrow'} · {timeLabel(Number(form.scheduleTime?.slice(0,2))*60+Number(form.scheduleTime?.slice(3,5)))}</p>{form.estimatedDeliveryTime&&<p>Estimated travel time: {form.estimatedDeliveryTime}</p>}<p>Payment: {form.payment==='cod'?'Cash on delivery':form.payment==='bank_transfer'?'Bank':'GCash'}</p></section>{error&&!modal&&<p className="form-error">{error}</p>}<button className="primary-button full" disabled={busy} onClick={()=>{setError('');setModal('payment')}}>Place order</button>{modal==='payment'&&<PaymentConfirmationModal payment={form.payment} paymentConfig={paymentConfig} total={total} busy={busy} onClose={()=>setModal(null)} onConfirm={confirmPayment}/>} {modal==='proof'&&<ProofUploadModal payment={form.payment} busy={busy} error={error} onBack={()=>{setError('');setModal('payment')}} onSubmit={place}/>} {modal==='complete'&&<OrderCompleteModal order={createdOrder||mergePlacedOrderData({order:{},form,items,total})} freshOrder={freshOrder} fallbackEstimatedTime={form.estimatedDeliveryTime} onTrack={()=>finish('track')} onContinue={()=>finish('menu')}/>}</main>
}export function OrderConfirmationPage(){const {state}=useLocation();const {id}=useParams();const order=state?.order||{order_number:id,status:'Pending',fulfillment:'delivery',payment:'pending',total:0};return <main className="customer-main narrow"><section className="success-card"><span><Check/></span><small>Order received</small><h1>Thank you. Weâ€™re on it!</h1><p>Your order <b>{customerOrderNumber(order.order_number)}</b> has been placed and is waiting for store confirmation.</p><div><p><span>Status</span><b>{order.status}</b></p><p><span>Fulfillment</span><b>{order.fulfillment||order.fulfillment_method}</b></p><p><span>Total</span><b>{money(order.total||order.total_amount||0)}</b></p></div><Link className="primary-button" to={`/orders/${id}/track`}>Track order</Link><Link className="secondary-button" to="/orders">View my orders</Link><Link className="text-button" to="/menu">Continue shopping</Link></section></main>}
const CANCELLABLE_RAW_STATUSES=['Order Received','Awaiting Payment Verification','Pending Confirmation']
const isCancellationReview=order=>order?.cancellation_status==='requested'||Boolean(order?.fulfillment_hold)
const canCustomerCancel=order=>CANCELLABLE_RAW_STATUSES.includes(String(order?.status||'').trim())&&!isCancellationReview(order)
const customerCancellationNeedsReview=order=>{
  const payment=order?.payments?.[0]
  const paid=order?.payment_confirmed||order?.payment_status==='paid'||payment?.status==='paid'
  return Boolean(paid||(orderPaymentMethod(order)!=='cod'&&order?.payment_proof_path))
}
const CANCEL_REASONS=['Ordered by mistake','Wrong items or quantities','Wrong delivery address','Wrong payment method','Duplicate order','Delivery or preparation time is too long','Changed my mind','Other']
const STATUS_MESSAGE={'Order Received':'Waiting for the shop to confirm your order.','Awaiting Payment Verification':'Your payment proof is being reviewed.','Confirmed':'Your order has been confirmed.','Preparing':'Your order is currently being prepared.','Ready for Pickup':'Your order is ready for pickup.','Out for Delivery':'Your order is on the way.','Completed':'Your order has been completed.','Cancelled':'This order was cancelled.'}
const STATUS_ICON={'Order Received':Receipt,'Awaiting Payment Verification':CreditCard,'Confirmed':PackageCheck,'Preparing':Coffee,'Ready for Pickup':ShoppingBag,'Out for Delivery':Bike,'Completed':PartyPopper,'Cancelled':XCircle}
const backdropMotion={initial:{opacity:0},animate:{opacity:1},exit:{opacity:0},transition:{duration:0.18}}
const modalMotion={initial:{opacity:0,scale:0.97,y:8},animate:{opacity:1,scale:1,y:0},exit:{opacity:0,scale:0.98,y:6},transition:{duration:0.2,ease:[0.22,1,0.36,1]}}
const drawerPanelMotion={initial:{x:'100%'},animate:{x:0},exit:{x:'100%'},transition:{duration:0.26,ease:[0.22,1,0.36,1]}}
function StatusIcon({status,size=14,className=''}){const Icon=STATUS_ICON[status];return Icon?<Icon size={size} className={className}/>:null}
const refundStatusLabel=value=>value==='pending_review'?'Payment Review Pending':value==='pending'?'Refund Pending':value==='processing'?'Refund Processing':value==='processed'?'Refund Processed':value==='failed'?'Refund Needs Attention':value==='rejected'?'Refund Rejected':''
const orderItemDetail=(item,addonNames)=>{const custom=item.customizations||{};const addonList=(item.addons||[]).map(id=>addonNames[id]||id);return {name:item.display_name||item.item_name,bits:[custom.temperature,custom.variation_id].filter(Boolean),addonList,instructions:custom.special_instructions,qty:item.quantity,total:item.line_total}}

export function MyOrdersPage(){
  const {user}=useAuth()
  const [tab,setTab]=useState('current')
  const [orders,setOrders]=useState([])
  const [addonNames,setAddonNames]=useState({})
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [pastPage,setPastPage]=useState(1)
  const [detailOrder,setDetailOrder]=useState(null)
  const [trackOrder,setTrackOrder]=useState(null)
  const [cancelOrder,setCancelOrderTarget]=useState(null)
  const [receiptOrder,setReceiptOrder]=useState(null)
  const [feedbackOrder,setFeedbackOrder]=useState(null)
  const [reorderState,setReorderState]=useState(null)
  const [toast,setToast]=useState('')
  const {addItem}=useCart()
  const {products}=useMenuCatalog()
  const load=()=>{
    if(!user?.id)return
    setLoading(true)
    Promise.all([fetchCustomerOrders(user.id),fetchAddonNameMap()])
      .then(([data,names])=>{setOrders(data);setAddonNames(names);setError('')})
      .catch(cause=>setError(describeError(cause,'Could not load your orders.')))
      .finally(()=>setLoading(false))
  }
  useEffect(()=>{load()},[user])
  useEffect(()=>{if(!toast)return undefined;const t=setTimeout(()=>setToast(''),4000);return()=>clearTimeout(t)},[toast])

  const currentOrders=orders.filter(o=>!['Completed','Cancelled'].includes(o.status))
  const pastOrders=orders.filter(o=>o.status==='Completed')
  const cancelledOrders=orders.filter(o=>o.status==='Cancelled')
  const visiblePast=pastOrders.slice(0,pastPage*6)

  const patchOrder=(id,patch)=>setOrders(current=>current.map(o=>o.id===id?{...o,...patch}:o))

  const runCancel=async(reason,notes)=>{
    const order=cancelOrder
    try{
      const result=await cancelCustomerOrder(order.id,reason,notes)
      const requested=result.action==='review_requested'
      patchOrder(order.id,requested
        ?{cancellation_status:'requested',fulfillment_hold:true,cancellation_reason:reason,cancellation_notes:notes,cancellation_requested_at:new Date().toISOString(),refund_status:'pending_review'}
        :{status:'Cancelled',cancellation_status:'resolved',fulfillment_hold:false,cancellation_reason:reason,cancellation_notes:notes,cancelled_at:new Date().toISOString(),refund_status:'not_applicable'})
      setCancelOrderTarget(null)
      setToast(requested
        ?`${customerOrderNumber(order.order_number)} is on hold for cancellation review.${result.email?.ok?' We sent you an email.':' The email is queued for retry.'}`
        :`${customerOrderNumber(order.order_number)} was cancelled.${result.email?.ok?' We sent you an email.':' The email is queued for retry.'}`)
    }catch(cause){
      throw new Error(describeError(cause,'Could not cancel this order.'))
    }
  }

  const runReorder=async(order)=>{
    setReorderState({orderId:order.id,busy:true})
    const unavailable=[]
    let addedCount=0
    for(const item of order.order_items||[]){
      const product=products.find(p=>p.id===item.menu_item_id)
      if(!product||!product.available){unavailable.push(item.display_name||item.item_name);continue}
      const custom=item.customizations||{}
      const variation=custom.variation_id?product.variations.find(v=>v.id===custom.variation_id):null
      if(custom.variation_id&&!variation){unavailable.push(`${item.display_name||item.item_name} (option no longer available)`);continue}
      const validAddons=(item.addons||[]).map(id=>product.addons.find(a=>a.id===id)).filter(Boolean)
      if(validAddons.length<(item.addons||[]).length)unavailable.push(`${item.display_name||item.item_name} (some add-ons no longer available)`)
      addItem({productId:product.id,slug:product.slug,name:product.name,image:product.image,variation,temperature:custom.temperature||'',ice:'',sugar:'',addons:validAddons,instructions:'',quantity:item.quantity,unitPrice:variation?.price??product.basePrice})
      addedCount+=1
    }
    setReorderState({orderId:order.id,busy:false,unavailable,addedCount})
  }

  return <main className="customer-main">
    <section className="page-title"><span>Your order history</span><h1>My orders</h1></section>
    <div className="order-tabs">
      <button className={tab==='current'?'active':''} onClick={()=>setTab('current')}>Current Orders{currentOrders.length>0&&<b className="order-tab-count">{currentOrders.length}</b>}</button>
      <button className={tab==='past'?'active':''} onClick={()=>setTab('past')}>Past Orders</button>
      <button className={tab==='cancelled'?'active':''} onClick={()=>setTab('cancelled')}>Cancelled Orders</button>
    </div>
    {toast&&<p className="settings-status" role="status">{toast}</p>}
    {loading?<OrdersSkeleton/>:error?<section className="customer-state error-state"><h2>We couldn't load your orders.</h2><p>{error}</p></section>:<>
      {tab==='current'&&(currentOrders.length===0?<EmptyOrders hasAny={orders.length>0} label="current orders"/>:
        <section className="current-orders-list">{currentOrders.map((order,index)=><CurrentOrderCard key={order.id} order={order} addonNames={addonNames} index={index}
          onView={()=>setDetailOrder(order)} onCancel={()=>setCancelOrderTarget(order)} onTrack={()=>setTrackOrder(order)}/>)}</section>)}
      {tab==='past'&&(pastOrders.length===0?<EmptyOrders hasAny={orders.length>0} label="past orders"/>:<>
        <section className="orders-grid">{visiblePast.map((order,index)=><PastOrderCard key={order.id} order={order} index={index}
          onView={()=>setDetailOrder(order)} onReceipt={()=>setReceiptOrder(order)}
          onReorder={()=>runReorder(order)} onFeedback={()=>setFeedbackOrder(order)}
          reordering={reorderState?.orderId===order.id&&reorderState.busy}/>)}</section>
        {visiblePast.length<pastOrders.length&&<button className="secondary-button full" type="button" onClick={()=>setPastPage(p=>p+1)}>Load more</button>}
      </>)}
      {tab==='cancelled'&&(cancelledOrders.length===0?<EmptyOrders hasAny={orders.length>0} label="cancelled orders"/>:
        <section className="orders-grid">{cancelledOrders.map((order,index)=><CancelledOrderCard key={order.id} order={order} index={index} onView={()=>setDetailOrder(order)}/>)}</section>)}
    </>}
    <AnimatePresence>{detailOrder&&<OrderDetailsDrawer order={orders.find(o=>o.id===detailOrder.id)||detailOrder} addonNames={addonNames} onClose={()=>setDetailOrder(null)}/>}</AnimatePresence>
    <AnimatePresence>{trackOrder&&<TrackOrderModal order={orders.find(o=>o.id===trackOrder.id)||trackOrder} onClose={()=>setTrackOrder(null)}/>}</AnimatePresence>
    <AnimatePresence>{cancelOrder&&<CancelOrderModal order={cancelOrder} onClose={()=>setCancelOrderTarget(null)} onConfirm={runCancel}/>}</AnimatePresence>
    <AnimatePresence>{receiptOrder&&<ReceiptModal order={receiptOrder} addonNames={addonNames} onClose={()=>setReceiptOrder(null)}/>}</AnimatePresence>
    <AnimatePresence>{feedbackOrder&&<FeedbackModal order={feedbackOrder} userId={user?.id} onClose={()=>setFeedbackOrder(null)} onDone={()=>setToast('Thanks for your feedback!')}/>}</AnimatePresence>
    <AnimatePresence>{reorderState&&!reorderState.busy&&<ReorderResultModal state={reorderState} onClose={()=>setReorderState(null)}/>}</AnimatePresence>
  </main>
}

function OrdersSkeleton(){return <div className="orders-skeleton">{Array.from({length:3}).map((_,i)=><div className="orders-skeleton-row" key={i}/>)}</div>}
function EmptyOrders({hasAny,label}){return <section className="orders-empty"><ShoppingBag/><h2>{hasAny?`No ${label} yet`:'No orders yet'}</h2><p>{hasAny?'Orders will appear here as their status changes.':'When you place an order, it will appear here.'}</p>{!hasAny&&<Link className="primary-button" to="/menu">Browse menu</Link>}</section>}

function OrderItemsSummary({order,addonNames,compact}){
  const items=(order.order_items||[]).map(item=>orderItemDetail(item,addonNames))
  return <div className="order-items-summary">{items.map((item,index)=><div className="order-item-row" key={index}>
    <span>{item.qty}× {item.name}{item.bits.length>0?` (${item.bits.join(' | ')})`:''}{!compact&&item.addonList.length>0?` + ${item.addonList.join(', ')}`:''}</span>
    <b>{money(item.total)}</b>
  </div>)}</div>
}

const cardEnter=index=>({initial:{opacity:0,y:10},animate:{opacity:1,y:0},transition:{duration:0.28,delay:Math.min(index*0.05,0.3),ease:[0.22,1,0.36,1]}})

function CurrentOrderCard({order,addonNames,onView,onCancel,onTrack,index=0}){
  const status=orderStatusLabel(order)
  const steps=trackingSteps(order)
  const currentIndex=Math.max(steps.indexOf(status),0)
  return <motion.article className={`current-order-card ${orderStatusTone(status)}`} {...cardEnter(index)}>
    <header>
      <div><h2>{customerOrderNumber(order.order_number)}</h2><p>{new Intl.DateTimeFormat('en-PH',{dateStyle:'medium',timeStyle:'short'}).format(new Date(order.created_at))} · {fulfillmentLabel(order.order_type)}</p></div>
      <span className={`status-chip ${isCancellationReview(order)?'status-chip--attention':orderStatusTone(status)}`}>{isCancellationReview(order)?<AlertTriangle size={14}/>:<StatusIcon status={status}/>} {isCancellationReview(order)?'Cancellation under review':status}</span>
    </header>
    <p className="order-status-message">{isCancellationReview(order)?'Your order is on hold while the store checks payment and refund requirements.':STATUS_MESSAGE[status]||'Waiting for update'}</p>
    <div className="order-mini-tracker">{steps.map((step,index)=><span key={step} className={index<=currentIndex?'done':''} title={step}/>)}</div>
    <OrderItemsSummary order={order} addonNames={addonNames} compact/>
    <div className="order-card-meta-row">
      <span>{paymentMethodLabel(orderPaymentMethod(order))} · {orderPaymentStatus(order)}</span>
      <span>{orderScheduleLabel(order)}</span>
    </div>
    <div className="order-card-total"><span>Total</span><b>{money(Number(order.final_total||0))}</b></div>
    <div className="order-card-actions">
      <button className="secondary-button" type="button" onClick={onView}>View Details</button>
      <button className="primary-button" type="button" onClick={onTrack}>Track Order</button>
      {canCustomerCancel(order)&&<button className="text-button danger" type="button" onClick={onCancel}>Cancel Order</button>}
    </div>
    {isCancellationReview(order)?<p className="order-cancellation-review-hint"><AlertTriangle size={14}/> We will email you after the store reviews your request.</p>:!canCustomerCancel(order)&&<p className="order-cancel-hint">This order can no longer be cancelled because preparation may have already started.</p>}
  </motion.article>
}

function PastOrderCard({order,onView,onReceipt,onReorder,onFeedback,reordering,index=0}){
  const status=orderStatusLabel(order)
  return <motion.article {...cardEnter(index)}><span className={`status-chip ${orderStatusTone(status)}`}>{status}</span><h2>{customerOrderNumber(order.order_number)}</h2>
    <p>{new Intl.DateTimeFormat('en-PH',{dateStyle:'medium',timeStyle:'short'}).format(new Date(order.created_at))} · {orderCount(order)} item{orderCount(order)===1?'':'s'}</p>
    <strong>{money(Number(order.final_total||0))}</strong>
    <div className="past-order-actions">
      <button className="secondary-button" type="button" onClick={onReorder} disabled={reordering}><RotateCcw size={14}/> {reordering?'Adding…':'Reorder'}</button>
      <button className="secondary-button" type="button" onClick={onView}>View</button>
      <button className="secondary-button" type="button" onClick={onReceipt}><Printer size={14}/> Receipt</button>
      {status==='Completed'&&<button className="primary-button" type="button" onClick={onFeedback}><Star size={14}/> Feedback</button>}
    </div>
  </motion.article>
}

function CancelledOrderCard({order,onView,index=0}){
  return <motion.article {...cardEnter(index)}><span className="status-chip status-chip--cancelled"><XCircle size={14}/> Cancelled</span><h2>{customerOrderNumber(order.order_number)}</h2>
    <p>{new Intl.DateTimeFormat('en-PH',{dateStyle:'medium',timeStyle:'short'}).format(new Date(order.cancelled_at||order.created_at))}</p>
    <p className="order-cancel-reason">{order.cancellation_reason}{order.cancellation_notes?` — ${order.cancellation_notes}`:''}</p>
    <dl><div><dt>Payment</dt><dd>{orderPaymentStatus(order)}</dd></div>{order.refund_status!=='not_applicable'&&<div><dt>Refund</dt><dd>{refundStatusLabel(order.refund_status)}</dd></div>}</dl>
    <strong>{money(Number(order.final_total||0))}</strong>
    <button className="secondary-button full" type="button" onClick={onView}>View Details</button>
  </motion.article>
}

function CancelOrderModal({order,onClose,onConfirm}){
  const [reason,setReason]=useState('')
  const [notes,setNotes]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const reviewRequired=customerCancellationNeedsReview(order)
  const submit=async()=>{
    if(!reason)return setError('Please choose a reason.')
    if(reason==='Other'&&!notes.trim())return setError('Please describe your reason.')
    setBusy(true);setError('')
    try{await onConfirm(reason,notes.trim()||null)}
    catch(cause){setError(cause.message||'Could not cancel this order.');setBusy(false)}
  }
  return <motion.div className="payment-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)onClose()}} {...backdropMotion}>
    <motion.section className="payment-modal" role="alertdialog" aria-modal="true" aria-labelledby="cancel-order-title" {...modalMotion}>
      <span className="payment-modal-kicker">{reviewRequired?'Request cancellation':'Cancel order'}</span>
      <h2 id="cancel-order-title">{reviewRequired?`Request cancellation for ${customerOrderNumber(order.order_number)}?`:`Cancel ${customerOrderNumber(order.order_number)}?`}</h2>
      <div className="cancel-order-summary">
        <p><span>Status</span><b>{orderStatusLabel(order)}</b></p>
        <p><span>Payment method</span><b>{paymentMethodLabel(orderPaymentMethod(order))}</b></p>
        <p><span>Total</span><b>{money(Number(order.final_total||0))}</b></p>
      </div>
      <p className="payment-modal-warning">{reviewRequired
        ?'Your order will be placed on hold while staff verifies the payment. If money was received, cancellation approval will create a pending refund.'
        :'No verified payment is recorded, so this order will be cancelled immediately. We will email you a confirmation.'}</p>
      <fieldset className="choice-group"><legend>Reason for cancelling</legend><div className="cancel-reason-list">
        {CANCEL_REASONS.map(option=><label className="check-choice" key={option}><input type="radio" name="cancel-reason" checked={reason===option} onChange={()=>setReason(option)}/><span>{option}</span></label>)}
      </div></fieldset>
      {reason==='Other'&&<label className="field"><span>Please explain</span><textarea rows="3" value={notes} onChange={e=>setNotes(e.target.value)} required/></label>}
      {error&&<p className="form-error">{error}</p>}
      <div className="payment-modal-actions">
        <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>Keep Order</button>
        <button className="danger-button" type="button" onClick={submit} disabled={busy}>{busy?'Please wait…':reviewRequired?'Submit Request':'Confirm Cancellation'}</button>
      </div>
    </motion.section>
  </motion.div>
}

function OrderDetailsDrawer({order,addonNames,onClose}){
  const [proofUrl,setProofUrl]=useState('')
  const method=orderPaymentMethod(order)
  const status=orderStatusLabel(order)
  useEffect(()=>{
    if(!order.payment_proof_path||(method!=='gcash'&&method!=='bank_transfer'))return
    let active=true
    getCustomerPaymentProofUrl(order.payment_proof_path).then(url=>{if(active)setProofUrl(url||'')}).catch(()=>{})
    return()=>{active=false}
  },[order.id,order.payment_proof_path,method])
  return <motion.div className="ops-drawer-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}} {...backdropMotion}>
    <motion.aside className="ops-drawer" role="dialog" aria-modal="true" aria-labelledby="order-drawer-title" {...drawerPanelMotion}>
      <header><div><span className="settings-kicker">{fulfillmentLabel(order.order_type)}</span><h2 id="order-drawer-title">{customerOrderNumber(order.order_number)}</h2></div><button type="button" onClick={onClose} aria-label="Close"><X size={20}/></button></header>
      <div className="ops-drawer-body">
        {isCancellationReview(order)&&<div className="ops-drawer-cancellation-review"><AlertTriangle size={16}/><div><b>Cancellation review in progress</b><p>Your order is on hold while the store checks payment and refund requirements.</p><small>{order.cancellation_reason}{order.cancellation_notes?` - ${order.cancellation_notes}`:''}</small></div></div>}
        {order.status==='Cancelled'&&<div className="ops-drawer-cancelled"><AlertTriangle size={16}/><div><b>Cancelled</b><p>{order.cancellation_reason}{order.cancellation_notes?` — ${order.cancellation_notes}`:''}</p>{order.refund_status!=='not_applicable'&&<p>{refundStatusLabel(order.refund_status)}</p>}</div></div>}
        <section><h3>Items</h3><OrderItemsSummary order={order} addonNames={addonNames}/></section>
        <section><h3>{order.order_type==='pickup'?'Pickup information':'Delivery information'}</h3>{order.order_type==='delivery'&&order.delivery_address&&<p><MapPin size={13}/> {order.delivery_address}</p>}<p>Scheduled: {orderScheduleLabel(order)}</p>{order.delivery_notes&&<p>Notes: {order.delivery_notes}</p>}</section>
        <section><h3>Payment</h3><p>{paymentMethodLabel(method)} · {orderPaymentStatus(order)}</p>
          {(method==='gcash'||method==='bank_transfer')&&(proofUrl?<a href={proofUrl} target="_blank" rel="noreferrer"><img className="ops-proof-image" src={proofUrl} alt="Payment proof"/></a>:<p className="ops-proof-pending">No payment proof on file.</p>)}
        </section>
        <section><h3>Price breakdown</h3><div className="ops-price-rows"><p><span>Subtotal</span><b>{money(order.subtotal)}</b></p>{order.order_type==='delivery'&&<p><span>Delivery fee</span><b>{money(order.delivery_fee||0)}</b></p>}<p className="ops-price-total"><span>Total</span><b>{money(order.final_total)}</b></p></div></section>
        <section><h3>Order timeline</h3><ul className="ops-timeline">{trackingSteps(order).map((step,index)=>{const currentIndex=Math.max(trackingSteps(order).indexOf(status),0);return <li key={step} className={index<=currentIndex?'done':''}>{index<currentIndex?<Check size={13}/>:<StatusIcon status={step} size={13}/>} {step}</li>})}</ul></section>
        <section><h3>Need help?</h3><a className="secondary-button" href="/help">Contact support</a></section>
      </div>
    </motion.aside>
  </motion.div>
}

const receiptMoney=value=>`PHP ${Number(value||0).toFixed(2)}`
const formatReceiptPreviewDate=value=>{if(!value)return'N/A';return new Intl.DateTimeFormat('en-PH',{month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value))}
const receiptReferenceNumber=order=>String(customerOrderNumber(order?.order_number||order?.reference_code||order?.id||'')).replace(/^#/,'')||'N/A'
const receiptOrderNumber=order=>String(order?.order_id||order?.id||'N/A')
const receiptScheduleValue=order=>{const date=order?.schedule_date||order?.scheduleDate;const time=order?.schedule_time||order?.scheduleTime;if(!date||!time)return'To be confirmed';const minutes=parseScheduleMinutes(time);const longDate=new Intl.DateTimeFormat('en-PH',{month:'long',day:'numeric',year:'numeric'}).format(new Date(`${date}T00:00:00`));return `${longDate} at ${minutes===null?String(time).slice(0,5):timeLabel(minutes)}`}
const receiptProofStatus=order=>{const method=orderPaymentMethod(order);if(method==='cod')return'';const raw=String(order?.payments?.[0]?.status||order?.payment_status||'pending').toLowerCase();const uploaded=Boolean(order?.payment_proof_path);if(raw==='paid'||raw==='verified'||raw==='confirmed')return uploaded?'Uploaded and verified':'Verified';if(raw==='failed')return uploaded?'Uploaded with issue':'Payment issue';return uploaded?'Uploaded and pending verification':'Not uploaded'}
const receiptItemDetails=(item,addonNames)=>{const custom=item.customizations||{};const addons=(item.addons||[]).map(id=>addonNames[id]||id);return [custom.sugarLevel,custom.temperature,custom.iceLevel,...addons,custom.special_instructions?`Note: ${custom.special_instructions}`:''].filter(Boolean)}

function ReceiptModal({order,addonNames,onClose}){
  const items=order.order_items||[]
  const paymentMethod=paymentMethodLabel(orderPaymentMethod(order))
  const paymentProof=receiptProofStatus(order)
  const isDelivery=(order.order_type||order.fulfillment)==='delivery'
  return <motion.div className="payment-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}} {...backdropMotion}>
    <motion.section className="payment-modal receipt-modal" role="dialog" aria-modal="true" aria-labelledby="receipt-title" {...modalMotion}>
      <button className="payment-modal-close" type="button" onClick={onClose} aria-label="Close">&times;</button>
      <div className="receipt-preview-shell customer-receipt-shell">
        <div id="printable-receipt" className="receipt-print-area customer-receipt-paper">
          <div className="receipt-header">
            <span className="customer-receipt-brand-badge"><img className="receipt-logo" src="/images/coffeerealmlogo.png" alt="Store logo" /></span>
            <div className="receipt-store-name" id="receipt-title">COFFEE REALM</div>
            <div className="receipt-store-info">Receipt preview</div>
          </div>
          <div className="receipt-line" />
          <div className="receipt-row"><span className="receipt-label">Order #</span><span className="receipt-value">{receiptOrderNumber(order)}</span></div>
          <div className="receipt-row"><span className="receipt-label">Reference #</span><span className="receipt-value">{receiptReferenceNumber(order)}</span></div>
          <div className="receipt-row"><span className="receipt-label">Date</span><span className="receipt-value">{formatReceiptPreviewDate(order.created_at)}</span></div>
          <div className="receipt-row"><span className="receipt-label">Type</span><span className="receipt-value">{fulfillmentLabel(order.order_type)}</span></div>
          <div className="receipt-row"><span className="receipt-label">Payment</span><span className="receipt-value">{paymentMethod}</span></div>
          {order.customer_name&&<div className="receipt-row"><span className="receipt-label">Customer</span><span className="receipt-value">{order.customer_name}</span></div>}
          {order.customer_phone&&<div className="receipt-row"><span className="receipt-label">Contact</span><span className="receipt-value">{order.customer_phone}</span></div>}
          <div className="receipt-row"><span className="receipt-label">Schedule</span><span className="receipt-value">{receiptScheduleValue(order)}</span></div>
          {isDelivery&&order.delivery_address&&<div className="receipt-row"><span className="receipt-label">Customer Address</span><span className="receipt-value">{order.delivery_address}</span></div>}
          {paymentProof&&<div className="receipt-row"><span className="receipt-label">Payment Proof</span><span className="receipt-value">{paymentProof}</span></div>}
          <div className="receipt-line" />
          <div className="receipt-table-header"><div>QTY</div><div>ITEM</div><div>PRICE</div></div>
          <div className="receipt-line" />
          <div className="receipt-items">
            {items.map((item,index)=>{const details=receiptItemDetails(item,addonNames);return <div className="receipt-item" key={item.id||index}>
              <div>{Number(item.quantity||item.qty||0)}</div>
              <div className="receipt-item-name">{item.display_name||item.item_name||'Menu item'}{details.map(detail=><div className="receipt-option" key={detail}>{detail}</div>)}</div>
              <div className="receipt-item-price">{receiptMoney(item.line_total)}</div>
            </div>})}
          </div>
          <div className="receipt-line" />
          <div className="receipt-total-row"><span>Subtotal</span><span>{receiptMoney(order.subtotal)}</span></div>
          {isDelivery&&Number(order.delivery_fee||0)>0&&<div className="receipt-total-row"><span>Delivery Fee</span><span>{receiptMoney(order.delivery_fee)}</span></div>}
          <div className="receipt-total-row"><span>Total</span><span className="receipt-grand-total">{receiptMoney(order.final_total)}</span></div>
          <div className="receipt-row"><span className="receipt-label">Item Count</span><span className="receipt-value">{orderCount(order)}</span></div>
          <div className="receipt-footer">{isDelivery?'Please check your items upon delivery.':'Please check your order before leaving the store.'}<br/>Thank you for choosing the coffee realm.</div>
        </div>
      </div>
      <div className="payment-modal-actions"><button className="primary-button" type="button" onClick={()=>window.print()}><Printer size={15}/> Print</button></div>
    </motion.section>
  </motion.div>
}

function FeedbackModal({order,userId,onClose,onDone}){
  const [existing,setExisting]=useState(null)
  const [loading,setLoading]=useState(true)
  const [rating,setRating]=useState(5)
  const [comment,setComment]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  useEffect(()=>{let active=true;fetchOrderFeedback(order.id,userId).then(data=>{if(active){setExisting(data);setLoading(false)}}).catch(()=>{if(active)setLoading(false)});return()=>{active=false}},[order.id,userId])
  const submit=async()=>{
    setBusy(true);setError('')
    try{await submitOrderFeedback({orderId:order.id,userId,rating,comment});onDone();onClose()}
    catch(cause){setError(describeError(cause,'Could not submit feedback.'));setBusy(false)}
  }
  return <motion.div className="payment-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)onClose()}} {...backdropMotion}>
    <motion.section className="payment-modal" role="dialog" aria-modal="true" aria-labelledby="feedback-title" {...modalMotion}>
      <button className="payment-modal-close" type="button" onClick={onClose} disabled={busy} aria-label="Close">×</button>
      <span className="payment-modal-kicker">{customerOrderNumber(order.order_number)}</span>
      <h2 id="feedback-title">{loading?'Loading…':existing?'Your feedback':'Leave feedback'}</h2>
      {loading?null:existing?<div><div className="feedback-stars">{[1,2,3,4,5].map(n=><Star key={n} size={22} fill={n<=existing.rating?'currentColor':'none'}/>)}</div><p>{existing.comment||'No comment left.'}</p></div>:<>
        <div className="feedback-stars interactive">{[1,2,3,4,5].map(n=><button key={n} type="button" onClick={()=>setRating(n)} aria-label={`${n} star${n===1?'':'s'}`}><Star size={26} fill={n<=rating?'currentColor':'none'}/></button>)}</div>
        <label className="field"><span>Comments (optional)</span><textarea rows="3" value={comment} onChange={e=>setComment(e.target.value)}/></label>
        {error&&<p className="form-error">{error}</p>}
        <div className="payment-modal-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="primary-button" type="button" onClick={submit} disabled={busy}>{busy?'Saving…':'Submit feedback'}</button></div>
      </>}
    </motion.section>
  </motion.div>
}

function ReorderResultModal({state,onClose}){
  return <motion.div className="payment-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}} {...backdropMotion}>
    <motion.section className="payment-modal" role="alertdialog" aria-modal="true" aria-labelledby="reorder-title" {...modalMotion}>
      <span className="payment-modal-kicker">Reorder</span>
      <h2 id="reorder-title">{state.addedCount>0?`${state.addedCount} item${state.addedCount===1?'':'s'} added to your cart`:'Nothing could be added'}</h2>
      {state.unavailable.length>0&&<><p>These items have changed since your last order and were skipped:</p><ul>{state.unavailable.map((name,i)=><li key={i}>{name}</li>)}</ul></>}
      <div className="payment-modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Keep shopping</button><Link className="primary-button" to="/menu">Go to menu</Link></div>
    </motion.section>
  </motion.div>
}

function TrackOrderModal({order,onClose}){
  const status=orderStatusLabel(order)
  const steps=trackingSteps(order)
  const currentIndex=Math.max(steps.indexOf(status),0)
  return <motion.div className="track-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}
    initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:0.2}}>
    <motion.section className="track-modal" role="dialog" aria-modal="true" aria-labelledby="track-modal-title"
      initial={{opacity:0,scale:0.92,y:16}} animate={{opacity:1,scale:1,y:0}} exit={{opacity:0,scale:0.95,y:8}}
      transition={{type:'spring',stiffness:340,damping:28}}>
      <button className="payment-modal-close" type="button" onClick={onClose} aria-label="Close">×</button>
      <span className="payment-modal-kicker">Live order status</span>
      <h2 id="track-modal-title">{customerOrderNumber(order.order_number)}</h2>
      <div className="track-modal-steps">
        {steps.map((step,index)=>{
          const done=index<currentIndex
          const active=index===currentIndex
          return <motion.div className={`track-step${done?' done':''}${active?' active':''}`} key={step}
            initial={{opacity:0,x:-12}} animate={{opacity:1,x:0}} transition={{delay:index*0.07,duration:0.3,ease:[0.22,1,0.36,1]}}>
            <motion.span className="track-step-icon" animate={active?{scale:[1,1.14,1]}:{scale:1}} transition={active?{duration:1.6,repeat:Infinity,ease:'easeInOut'}:{}}>
              {done?<Check size={22}/>:<StatusIcon status={step} size={20}/>}
            </motion.span>
            <div>
              <h3>{step}</h3>
              <p>{active?trackingStatusCopy(order,status):done?'Completed':'Waiting for update'}</p>
            </div>
          </motion.div>
        })}
        <div className="track-modal-line" aria-hidden="true">
          <motion.div className="track-modal-line-fill" initial={{height:0}} animate={{height:`${(currentIndex/(steps.length-1))*100}%`}} transition={{duration:0.6,ease:[0.22,1,0.36,1]}}/>
        </div>
      </div>
      <div className="track-modal-footer">
        <span>{orderCount(order)} item{orderCount(order)===1?'':'s'} · {paymentMethodLabel(orderPaymentMethod(order))}</span>
        <b>{money(Number(order.final_total||0))}</b>
      </div>
    </motion.section>
  </motion.div>
}

export function OrderTrackingPage(){const {id}=useParams();const {state}=useLocation();const [order,setOrder]=useState(state?.order||null);const [loading,setLoading]=useState(!state?.order);const [error,setError]=useState('');const freshOrder=Boolean(state?.freshOrder);useEffect(()=>{let active=true;setLoading(true);fetchCustomerOrder(id).then(data=>{if(!active)return;if(data)setOrder(current=>current?{...current,...data,payments:data.payments?.length?data.payments:current.payments,order_items:data.order_items?.length?data.order_items:current.order_items}:data);setError('')}).catch(cause=>{if(active)setError(cause.message||'Could not load this order.')}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[id]);if(loading&&!order)return <main className="customer-state">Loading order…</main>;if(error&&!order)return <main className="customer-state error-state"><h2>We couldn’t load this order.</h2><p>{error}</p></main>;if(!order)return <NotFoundPage/>;const status=orderStatusLabel(order,{fresh:freshOrder});const steps=trackingSteps(order);const current=Math.max(steps.indexOf(status),0);return <main className="customer-main narrow"><section className="page-title"><span>Live order status</span><h1>Track {customerOrderNumber(order.order_number||id)}</h1></section><section className="tracking-card">{steps.map((step,index)=><div className={index<=current?'done':''} key={step}><span>{index<current?<Check/>:index===current?<Clock3/>:<PackageCheck/>}</span><div><h2>{step}</h2><p>{index===current?trackingStatusCopy(order,status):index<current?'Completed':'Waiting for update'}</p></div></div>)}</section><section className="review-card"><h2>Order details</h2><p>{orderCount(order)} item{orderCount(order)===1?'':'s'} · {paymentMethodLabel(orderPaymentMethod(order))}</p><p>{fulfillmentLabel(order.order_type)}{order.delivery_address?` · ${order.delivery_address}`:''}</p><p>Scheduled for {orderScheduleLabel(order)}</p><strong>Total: {money(Number(order.final_total||0))}</strong></section>{error&&<p className="field-hint error">{error}</p>}</main>}
export function SettingsPage(){
  const {profile,user,updateProfile}=useAuth()
  const navigate=useNavigate()
  const otpDigits=6
  const [values,setValues]=useState({full_name:'',email:'',phone:''})
  const [status,setStatus]=useState('')
  useEffect(()=>{setValues({full_name:profile?.full_name||'',email:profile?.email||user?.email||'',phone:profile?.phone||''})},[profile,user])
  const set=(key,value)=>setValues(current=>({...current,[key]:value}))
  const submit=async event=>{event.preventDefault();setStatus('Saving…');try{const saved=await saveProfile(user.id,values);updateProfile(saved);setStatus('Profile saved. Checkout will use these details.')}catch(error){setStatus(error.message||'Could not save profile.')}}

  const [resetOpen,setResetOpen]=useState(false)
  const [resetStep,setResetStep]=useState('email')
  const [resetOtp,setResetOtp]=useState(Array(otpDigits).fill(''))
  const [resetEmail,setResetEmail]=useState('')
  const [resetPassword,setResetPassword]=useState('')
  const [resetConfirmPassword,setResetConfirmPassword]=useState('')
  const [resetBusy,setResetBusy]=useState(false)
  const [resetError,setResetError]=useState('')
  const [resetMessage,setResetMessage]=useState('')
  const resetLogoutTimerRef=useRef(null)
  const openPasswordReset=()=>{
    setResetEmail((values.email||user?.email||'').trim())
    setResetStep('email')
    setResetOtp(Array(otpDigits).fill(''))
    setResetPassword('')
    setResetConfirmPassword('')
    setResetError('')
    setResetMessage('')
    setResetOpen(true)
  }
  const closePasswordReset=()=>{
    if(resetBusy||resetStep==='success')return
    if(resetLogoutTimerRef.current)window.clearTimeout(resetLogoutTimerRef.current)
    setResetOpen(false)
    setResetStep('email')
    setResetOtp(Array(otpDigits).fill(''))
    setResetPassword('')
    setResetConfirmPassword('')
    setResetError('')
    setResetMessage('')
  }
  const changeResetOtpDigit=(index,value)=>{
    const clean=value.replace(/\D/g,'').slice(-1)
    setResetOtp(current=>current.map((digit,digitIndex)=>digitIndex===index?clean:digit))
  }
  const sendPasswordResetCode=async event=>{
    event.preventDefault()
    setResetError('')
    setResetMessage('')
    if(!isSupabaseConfigured)return setResetError('Supabase is not configured yet.')
    const trimmedEmail=resetEmail.trim()
    if(!trimmedEmail)return setResetError('Enter your email address first.')
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail))return setResetError('Enter a valid email address.')
    setResetBusy(true)
    const {error}=await supabase.auth.resetPasswordForEmail(trimmedEmail)
    setResetBusy(false)
    if(error)return setResetError(error.message||'Could not send the reset code. Please try again.')
    setResetOtp(Array(otpDigits).fill(''))
    setResetStep('otp')
    setResetMessage('A 6-digit password reset code was sent to your email.')
  }
  const verifyPasswordResetCode=async()=>{
    setResetError('')
    const token=resetOtp.join('')
    if(token.length!==otpDigits)return setResetError('Enter the 6-digit OTP code.')
    setResetBusy(true)
    const {error}=await supabase.auth.verifyOtp({email:resetEmail.trim(),token,type:'recovery'})
    setResetBusy(false)
    if(error)return setResetError(error.message||'Unable to verify the reset code.')
    setResetStep('password')
    setResetMessage('')
  }
  const resendPasswordResetCode=async()=>{
    setResetError('')
    setResetMessage('')
    const trimmedEmail=resetEmail.trim()
    if(!trimmedEmail)return setResetError('Enter your email address first.')
    setResetBusy(true)
    const {error}=await supabase.auth.resetPasswordForEmail(trimmedEmail)
    setResetBusy(false)
    if(error)return setResetError(error.message||'Unable to resend the reset code.')
    setResetOtp(Array(otpDigits).fill(''))
    setResetMessage('A new 6-digit password reset code was sent.')
  }
  useEffect(()=>{
    if(resetStep!=='success')return undefined
    resetLogoutTimerRef.current=window.setTimeout(async()=>{
      navigate('/login',{replace:true,state:{authMessage:'Password changed successfully. Please log in with your new password.'}})
      await supabase.auth.signOut()
    },1800)
    return ()=>{
      if(resetLogoutTimerRef.current)window.clearTimeout(resetLogoutTimerRef.current)
      resetLogoutTimerRef.current=null
    }
  },[navigate,resetStep])
  const submitResetPassword=async event=>{
    event.preventDefault()
    setResetError('')
    if(resetPassword.length<6||!/\d/.test(resetPassword))return setResetError('Password must be at least 6 characters and include at least 1 number.')
    if(resetPassword!==resetConfirmPassword)return setResetError('The passwords do not match.')
    setResetBusy(true)
    const {error}=await supabase.auth.updateUser({password:resetPassword})
    setResetBusy(false)
    if(error)return setResetError(error.message||'Unable to update your password.')
    setResetError('')
    setResetMessage('Password updated successfully. Signing you out securely…')
    setResetStep('success')
  }
  const [addresses,setAddresses]=useState([])
  const [addressesLoading,setAddressesLoading]=useState(true)
  const [addressError,setAddressError]=useState('')
  const [formOpen,setFormOpen]=useState(false)
  const [editingAddress,setEditingAddress]=useState(null)
  const [deletingId,setDeletingId]=useState('')
  const [busyId,setBusyId]=useState('')
  const [recentlySavedAddressId,setRecentlySavedAddressId]=useState('')

  const loadAddresses=async()=>{
    if(!user?.id)return
    setAddressesLoading(true)
    try{const data=await fetchAddresses(user.id);setAddresses(data||[]);setAddressError('')}
    catch(cause){setAddressError(describeError(cause,'Could not load your addresses.'))}
    finally{setAddressesLoading(false)}
  }
  useEffect(()=>{loadAddresses()},[user?.id])
  useEffect(()=>{
    if(!recentlySavedAddressId)return undefined
    const timer=window.setTimeout(()=>setRecentlySavedAddressId(''),2200)
    return ()=>window.clearTimeout(timer)
  },[recentlySavedAddressId])

  const openAdd=()=>{setEditingAddress(null);setFormOpen(true)}
  const openEdit=address=>{setEditingAddress(address);setFormOpen(true)}
  const closeForm=()=>{setFormOpen(false);setEditingAddress(null)}

  const saveAddress=async formValues=>{
    const savedAddress=editingAddress?await updateAddress(editingAddress.id,formValues):await createAddress(user.id,formValues)
    closeForm()
    await loadAddresses()
    setRecentlySavedAddressId(String(savedAddress.id))
  }

  const removeAddress=async id=>{
    setBusyId(id)
    try{await deleteAddress(id);await loadAddresses();setDeletingId('')}
    catch(cause){setAddressError(describeError(cause,'Could not delete this address.'))}
    finally{setBusyId('')}
  }

  const makeDefault=async id=>{
    setBusyId(id)
    try{await setDefaultAddress(id);await loadAddresses()}
    catch(cause){setAddressError(describeError(cause,'Could not update your default address.'))}
    finally{setBusyId('')}
  }

  return <main className="customer-main narrow">
    <section className="page-title"><span>Your account</span><h1>Settings</h1><p>Manage your personal information, account security, and delivery addresses in one place.</p></section>
    <section className="settings-stack">
      <form className="account-card settings-section" onSubmit={submit}>
        <header><div><span className="settings-kicker">Profile settings</span><h2>Personal information</h2></div></header>
        <div className="form-grid">
          <Field label="Full name" value={values.full_name} onChange={value=>set('full_name',value)}/>
          <Field label="Email address" type="email" value={values.email} onChange={value=>set('email',value)}/>
          <Field label="Contact number" value={values.phone} onChange={value=>set('phone',value)}/>
        </div>
        <button className="primary-button" type="submit">Save profile</button>
        {status&&<p className="settings-status" role="status">{status}</p>}
        <div className="security-row">
          <div><h3>Password and security</h3><p>We'll send a secure password-reset code to your account email.</p></div>
          <button className="secondary-button" type="button" onClick={openPasswordReset}>Reset password</button>
        </div>
      </form>

      <section className="account-card settings-section">
        <header>
          <div><span className="settings-kicker">Saved addresses</span><h2>Delivery addresses</h2><p>Your default address loads automatically at checkout.</p></div>
          <button className="secondary-button address-add-trigger" type="button" onClick={openAdd}><Plus size={16}/>Add address</button>
        </header>
        {addressError&&<p className="form-error">{addressError}</p>}
        {addressesLoading?<p className="settings-status">Loading your addresses…</p>:addresses.length===0?
          <div className="address-empty"><MapPin/><div><h3>No saved addresses yet</h3><p>Add your first delivery address to make checkout faster.</p></div></div>
        :<div className="address-list">
          {addresses.map(address=><article className={`address-card${address.is_default?' is-default':''}${String(address.id)===recentlySavedAddressId?' address-card-enter':''}`} key={address.id}>
            <div className="address-card-head">
              <div><b>{address.label||'Delivery address'}</b>{address.is_default&&<span className="default-badge"><Star size={12}/> Default</span>}</div>
              <div className="address-card-actions">
                {!address.is_default&&<button type="button" className="icon-text-button" onClick={()=>makeDefault(address.id)} disabled={busyId===address.id}>Make default</button>}
                <button type="button" className="round-action ghost" aria-label={`Edit ${address.label||'address'}`} onClick={()=>openEdit(address)}><Pencil size={16}/></button>
                <button type="button" className="round-action ghost danger" aria-label={`Delete ${address.label||'address'}`} onClick={()=>setDeletingId(address.id)}><Trash2 size={16}/></button>
              </div>
            </div>
            {address.recipient_name&&<p>{address.recipient_name}{address.phone?` · ${address.phone}`:''}</p>}
            <p>{address.address_line}{address.barangay?`, Brgy. ${address.barangay}`:''}, {address.city}, {address.province} {address.postal_code||''}</p>
            {address.delivery_notes&&<small>{address.delivery_notes}</small>}
          </article>)}
        </div>}
      </section>
    </section>

    {resetOpen&&<InlinePasswordResetModal
      step={resetStep}
      email={resetEmail}
      otp={resetOtp}
      password={resetPassword}
      confirmPassword={resetConfirmPassword}
      busy={resetBusy}
      error={resetError}
      message={resetMessage}
      onClose={closePasswordReset}
      onEmailChange={setResetEmail}
      onOtpChange={changeResetOtpDigit}
      onPasswordChange={setResetPassword}
      onConfirmPasswordChange={setResetConfirmPassword}
      onSendCode={sendPasswordResetCode}
      onVerifyCode={verifyPasswordResetCode}
      onResendCode={resendPasswordResetCode}
      onSubmitPassword={submitResetPassword}
    />}
    {formOpen&&<AddressFormModal address={editingAddress} onClose={closeForm} onSave={saveAddress}/>}
    {deletingId&&<ConfirmDeleteAddressModal onCancel={()=>setDeletingId('')} onConfirm={()=>removeAddress(deletingId)} busy={busyId===deletingId}/>}
  </main>
}

function InlinePasswordResetModal({step,email,otp,password,confirmPassword,busy,error,message,onClose,onEmailChange,onOtpChange,onPasswordChange,onConfirmPasswordChange,onSendCode,onVerifyCode,onResendCode,onSubmitPassword}){
  const otpRefs=useRef([])
  useEffect(()=>{
    if(step!=='otp')return
    const targetIndex=Math.min(otp.findIndex(digit=>!digit),otp.length-1)
    const safeIndex=targetIndex===-1?otp.length-1:targetIndex
    otpRefs.current[safeIndex]?.focus()
    otpRefs.current[safeIndex]?.select?.()
  },[otp,step])
  const handleOtpInput=(index,value)=>{
    const digits=value.replace(/\D/g,'')
    if(!digits){
      onOtpChange(index,'')
      return
    }
    digits.slice(0,otp.length-index).split('').forEach((digit,offset)=>onOtpChange(index+offset,digit))
    const nextIndex=Math.min(index+digits.length,otp.length-1)
    otpRefs.current[nextIndex]?.focus()
    otpRefs.current[nextIndex]?.select?.()
  }
  const handleOtpKeyDown=(index,event)=>{
    if(event.key==='Backspace'){
      if(otp[index]){
        event.preventDefault()
        onOtpChange(index,'')
        return
      }
      if(index>0){
        event.preventDefault()
        otpRefs.current[index-1]?.focus()
        otpRefs.current[index-1]?.select?.()
      }
    }
    if(event.key==='ArrowLeft'&&index>0){
      event.preventDefault()
      otpRefs.current[index-1]?.focus()
      otpRefs.current[index-1]?.select?.()
    }
    if(event.key==='ArrowRight'&&index<otp.length-1){
      event.preventDefault()
      otpRefs.current[index+1]?.focus()
      otpRefs.current[index+1]?.select?.()
    }
  }
  const handleOtpPaste=event=>{
    const digits=event.clipboardData.getData('text').replace(/\D/g,'').slice(0,otp.length)
    if(!digits)return
    event.preventDefault()
    digits.split('').forEach((digit,index)=>onOtpChange(index,digit))
    const focusIndex=Math.min(digits.length,otp.length)-1
    otpRefs.current[Math.max(focusIndex,0)]?.focus()
    otpRefs.current[Math.max(focusIndex,0)]?.select?.()
  }
  return <div className="legacy-auth-modal-backdrop" role="dialog" aria-modal="true" aria-label="Reset password">
    <section className="legacy-auth-modal reset-password-modal">
      <header><h2>Reset Password</h2><button type="button" onClick={onClose} disabled={busy||step==='success'} aria-label="Close">&times;</button></header>
      {step==='email'?<form className="reset-password-step" onSubmit={onSendCode}>
        <p>Enter your account email and we will send a 6-digit password reset code.</p>
        {error?<ResetNotice variant="error" message={error}/>:null}
        {message?<ResetNotice variant="success" message={message}/>:null}
        <label className="legacy-auth-input"><span>Email address</span><div><Mail size={19}/><input type="email" value={email} onChange={event=>onEmailChange(event.target.value)} placeholder="Enter your email"/></div></label>
        <button type="submit" className="legacy-auth-submit" disabled={busy}>{busy?'SENDING...':'SEND OTP CODE'}</button>
      </form>:null}
      {step==='otp'?<div className="reset-password-step">
        <div className="legacy-otp-icon"><ShieldCheck size={30}/></div>
        <p>Enter the 6-digit password reset code sent to <b>{email}</b>.</p>
        {error?<ResetNotice variant="error" message={error}/>:null}
        {message?<ResetNotice variant="success" message={message}/>:null}
        <div className="legacy-otp-inputs reset-otp-inputs" aria-label="Password reset OTP inputs" onPaste={handleOtpPaste}>{otp.map((digit,index)=><input key={index} ref={element=>{otpRefs.current[index]=element}} value={digit} onChange={event=>handleOtpInput(index,event.target.value)} onKeyDown={event=>handleOtpKeyDown(index,event)} onFocus={event=>event.target.select()} inputMode="numeric" maxLength="6" aria-label={`Reset OTP digit ${index+1}`}/>)}</div>
        <button type="button" className="legacy-auth-submit" onClick={onVerifyCode} disabled={busy}>{busy?'VERIFYING...':'VERIFY OTP'}</button>
        <button type="button" className="legacy-auth-link-button" onClick={onResendCode} disabled={busy}>Resend code</button>
      </div>:null}
      {step==='password'?<form className="reset-password-step" onSubmit={onSubmitPassword}>
        <p>Your code is verified. Create a new password for your account.</p>
        {error?<ResetNotice variant="error" message={error}/>:null}
        <label className="legacy-auth-input"><span>New password</span><div><Lock size={19}/><input type="password" value={password} onChange={event=>onPasswordChange(event.target.value)} placeholder="Enter new password"/></div></label>
        <label className="legacy-auth-input"><span>Confirm new password</span><div><Lock size={19}/><input type="password" value={confirmPassword} onChange={event=>onConfirmPasswordChange(event.target.value)} placeholder="Repeat new password"/></div></label>
        <p className="legacy-auth-hint">Use at least 6 characters with at least 1 number.</p>
        <button type="submit" className="legacy-auth-submit" disabled={busy}>{busy?'UPDATING...':'UPDATE PASSWORD'}</button>
      </form>:null}
      {step==='success'?<div className="reset-password-step reset-success-state">
        <div className="reset-success-badge"><Check size={38}/></div>
        <h3>Password updated</h3>
        <p>{message||'Your password has been changed. We’re signing you out securely now.'}</p>
        <div className="reset-success-progress" aria-hidden="true"><span/></div>
      </div>:null}
    </section>
  </div>
}

function ResetNotice({variant,message}){
  return <div className={`legacy-auth-notice ${variant}`}>{message}</div>
}

function AddressFormModal({address,onClose,onSave}){
  const [values,setValues]=useState({
    label:address?.label||'',
    recipientName:address?.recipient_name||'',
    phone:address?.phone||'',
    addressLine:address?.address_line||'',
    barangay:address?.barangay||'',
    city:address?.city||'Quezon City',
    province:address?.province||'Metro Manila',
    postalCode:address?.postal_code||'',
    deliveryNotes:address?.delivery_notes||'',
    isDefault:Boolean(address?.is_default),
  })
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const set=(key,value)=>setValues(current=>({...current,[key]:value}))
  const selectedArea=deliveryAreas.find(area=>area.barangay.toLowerCase()===values.barangay.trim().toLowerCase())
  const submit=async event=>{
    event.preventDefault()
    if(!values.addressLine.trim())return setError('Enter a complete address.')
    setSaving(true);setError('')
    try{await onSave(values)}
    catch(cause){setError(describeError(cause,'Could not save this address.'));setSaving(false)}
  }
  return <div className="payment-modal-backdrop address-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!saving)onClose()}}>
    <section className="payment-modal address-form-modal" role="dialog" aria-modal="true" aria-labelledby="address-form-title">
      <button className="payment-modal-close" type="button" onClick={onClose} disabled={saving} aria-label="Close">×</button>
      <span className="payment-modal-kicker">{address?'Edit address':'Add address'}</span>
      <h2 id="address-form-title">{address?'Update delivery address':'New delivery address'}</h2>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Label (e.g. Home, Office)" value={values.label} onChange={value=>set('label',value)} required={false}/>
          <Field label="Recipient name" value={values.recipientName} onChange={value=>set('recipientName',value)} required={false}/>
          <Field label="Contact number" value={values.phone} onChange={value=>set('phone',value)} required={false}/>
          <Field label="House no. / Bldg. / Street / Village" value={values.addressLine} onChange={value=>set('addressLine',value)}/>
          <BarangayField value={values.barangay} onChange={value=>set('barangay',value)} selectedArea={selectedArea}/>
          <Field label="City" value={values.city} readOnly/>
          <Field label="Province" value={values.province} readOnly/>
          <Field label="Postal code" value={values.postalCode} onChange={value=>set('postalCode',value)} required={false}/>
        </div>
        <Field label="Delivery instructions" value={values.deliveryNotes} onChange={value=>set('deliveryNotes',value)} required={false}/>
        <label className="check-choice">
          <input type="checkbox" checked={values.isDefault} onChange={event=>set('isDefault',event.target.checked)}/>
          <span>Set as my default address</span>
        </label>
        {error&&<p className="form-error">{error}</p>}
        <div className="payment-modal-actions">
          <button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="primary-button" type="submit" disabled={saving}>{saving?'Saving…':'Save address'}</button>
        </div>
      </form>
    </section>
  </div>
}

function ConfirmDeleteAddressModal({onCancel,onConfirm,busy}){
  return <div className="payment-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onCancel()}}>
    <section className="payment-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-address-title">
      <span className="payment-modal-kicker">Remove address</span>
      <h2 id="delete-address-title">Delete this delivery address?</h2>
      <p>This can't be undone. If this is your default address, another saved address automatically becomes the default.</p>
      <div className="payment-modal-actions">
        <button className="secondary-button" type="button" onClick={onCancel} disabled={busy}>Keep address</button>
        <button className="danger-button" type="button" onClick={onConfirm} disabled={busy}>{busy?'Deleting…':'Delete address'}</button>
      </div>
    </section>
  </div>
}

export function AboutPage(){return <main className="customer-main"><section className="editorial-page"><img src="/images/craft.JPG" alt="Coffee being prepared at thecoffeerealm"/><div><span>Our story</span><h1>A neighborhood cafÃ© made for slow moments.</h1><p>thecoffeerealm began with a love for the daily ritual of coffee. In North Fairview, we pair thoughtfully brewed drinks with homemade cakes, cookies, and comforting meals.</p><p>Our aim is simple: make every visit feel warm, personal, and worth returning to.</p></div></section></main>}
const helpGroups=[
 {title:'Ordering guide',items:[['How do I browse the menu?','Explore the full selection of drinks, cakes, meals, and handcrafted treats from the Menu tab.'],['Can I customize a product?','Yes. Select the available size, add-ons, sugar level, temperature, and special instructions before adding an item to your cart.'],['How do I place an order?','Review your cart, proceed to checkout, then confirm your delivery or pickup details and payment method.']]},
 {title:'Delivery guide',items:[['What information is required for delivery?','Choose delivery at checkout and provide a complete address, contact number, and delivery instructions.'],['How is the delivery fee calculated?','Standard rates apply based on your distance from the North Fairview branch. The final fee is shown during checkout.'],['Where can I track my delivery?','Open My Orders and select Track order to view the latest order status.']]},
 {title:'Pickup guide',items:[['How does store pickup work?','Choose Store pickup during checkout and collect your order from the North Fairview branch.'],['When should I arrive?','Please arrive within your selected pickup window to help us serve your order at peak freshness.'],['What should I show the barista?','Provide your order number to the barista when you arrive.']]},
 {title:'Payment guide',items:[['Which digital payments are accepted?','The legacy system supported GCash and direct bank transfer. Available methods in the rebuild are shown according to your fulfillment choice.'],['How should I submit proof of payment?','When proof is required, upload a clear screenshot showing the transaction details and reference number.'],['Should I keep my payment reference?','Yes. Keep your transaction reference number available for payment or order inquiries.']]},
 {title:'Common questions',items:[['Can I modify my order?','Once an order is confirmed, modifications are limited. Contact support immediately so the team can check its current preparation status.'],['How long does payment validation take?','The store team usually verifies submitted digital payments within 5â€“15 minutes.']]},
 {title:'Cancellations and refunds',items:[['When can I request cancellation?','You may request cancellation before or during the preparation stage. Requests are reviewed by staff before approval.'],['What happens to an unpaid order?','An unpaid order may be cancelled immediately and will be marked as Cancelled.'],['What happens if the order is already paid?','Paid orders require approval before cancellation and may proceed to refund processing.'],['How can I track a refund?','The order details may show the refund as Pending or Refunded. You will be notified when its status changes.'],['Will a cancelled order disappear?','No. Cancelled orders remain visible in My Orders with their details for reference.']]}]

export function HelpPage(){return <main className="customer-main"><section className="page-hero help-hero"><span>Support center Â· North Fairview</span><h1>How can we help?</h1><p>Find quick answers about ordering, fulfillment, payments, cancellations, and refunds.</p></section><section className="help-layout"><div className="faq-column"><div className="section-heading"><div><span className="eyebrow">Frequently asked questions</span><h2>Everything you need to order smoothly.</h2></div></div><div className="faq-groups">{helpGroups.map((group,groupIndex)=><section className="faq-group" key={group.title}><h3>{group.title}</h3>{group.items.map(([question,answer],itemIndex)=><details key={question} open={groupIndex===0&&itemIndex===0}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</section>)}</div></div><aside className="help-contact"><span className="settings-kicker">Contact us</span><h2>Still need a hand?</h2><p>Send the store a message and include your order number when your question is about an existing order.</p><div className="contact-details"><p><b>Phone</b><a href="tel:+639975337958">+63 997 533 7958</a></p><p><b>Email</b><a href="mailto:main.thecoffeerealm@gmail.com">main.thecoffeerealm@gmail.com</a></p><p><b>Location</b><span>North Fairview, Quezon City</span></p></div><form onSubmit={e=>e.preventDefault()}><label className="field"><span>Your name</span><input required/></label><label className="field"><span>Email address</span><input required type="email"/></label><label className="field"><span>Subject</span><input required/></label><label className="field"><span>How can we help?</span><textarea required placeholder="Tell us what happened or what you need help with."/></label><button className="primary-button full" type="submit">Send message</button></form></aside></section></main>}
export function ContactPage(){return <main className="customer-main"><section className="editorial-page"><div><span>Visit or say hello</span><h1>Find us in North Fairview.</h1><p>Lot 1 Block 210 Mark Street corner Dollar Street, Quezon City</p><p>Open daily, 10:00 AMâ€“12:00 MN</p><p>main.thecoffeerealm@gmail.com Â· +63 997 533 7958</p></div><form className="account-card" onSubmit={e=>e.preventDefault()}><label className="field"><span>Name</span><input required/></label><label className="field"><span>Email</span><input required type="email"/></label><label className="field"><span>Message</span><textarea required/></label><button className="primary-button">Send message</button></form></section></main>}
export function NotFoundPage(){return <main className="customer-main"><Empty title="This page wandered off" body="The link may be old, but the coffee is still fresh." action="Return home" to="/"/></main>}
function Empty({title,body,action,to}){return <section className="empty-state"><ShoppingBag/><h1>{title}</h1><p>{body}</p><Link className="primary-button" to={to}>{action}</Link></section>}




