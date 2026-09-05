/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from './AuthContext'
import { fetchMenuCatalog } from '../services/menuService'
const CartContext = createContext(null)
const key = 'coffee-realm-guest-cart-v1'
const signature = item => [item.productId,item.variation?.id || '',item.temperature || '',item.ice || '',item.sugar || '',item.instructions || '',...(item.addons || []).map(a=>a.id).sort()].join('|')
export function CartProvider({ children }) {
 const { user } = useAuth()
 const [items,setItems]=useState(()=>{try{return JSON.parse(localStorage.getItem(key))||[]}catch{return[]}})
 const [drawerOpen,setDrawerOpen]=useState(false)
 const [checkingAvailability,setCheckingAvailability]=useState(false)
 useEffect(()=>localStorage.setItem(key,JSON.stringify(items)),[items])
 useEffect(()=>{let active=true;setCheckingAvailability(true);fetchMenuCatalog().then(({products})=>{if(!active)return;const catalog=new Map(products.map(product=>[String(product.id),product]));setItems(current=>current.map(item=>{const product=catalog.get(String(item.productId));const available=Boolean(product?.available);const availabilityReason=available?'':product?'Currently out of stock':'No longer available';const eligible=Boolean(product?.onlineBenefitEligible);return item.available===available&&item.availabilityReason===availabilityReason&&item.onlineBenefitEligible===eligible?item:{...item,available,availabilityReason,onlineBenefitEligible:eligible}}))}).catch(()=>{}).finally(()=>{if(active)setCheckingAvailability(false)});return()=>{active=false}},[user?.id])
 const addItem=(next)=>{setItems(current=>{const candidate={...next,available:true,availabilityReason:''};const sig=signature(candidate);const found=current.find(i=>signature(i)===sig);return found?current.map(i=>signature(i)===sig?{...i,...candidate,quantity:i.quantity+candidate.quantity}:i):[...current,{...candidate,lineId:crypto.randomUUID()}]});setDrawerOpen(true)}
 const updateQuantity=(lineId,quantity)=>setItems(current=>current.map(i=>i.lineId===lineId?{...i,quantity}:i).filter(i=>i.quantity>0))
 const removeItem=lineId=>setItems(current=>current.filter(i=>i.lineId!==lineId))
 const clearCart=()=>setItems([])
 const openCart=()=>setDrawerOpen(true)
 const closeCart=()=>setDrawerOpen(false)
 const itemCount=items.reduce((n,i)=>n+i.quantity,0)
 const subtotal=items.reduce((n,i)=>n+((i.unitPrice+(i.addons||[]).reduce((s,a)=>s+a.price,0))*i.quantity),0)
 const unavailableItems=items.filter(item=>item.available===false)
 const hasUnavailableItems=unavailableItems.length>0
 const value=useMemo(()=>({items,addItem,updateQuantity,removeItem,clearCart,itemCount,subtotal,unavailableItems,hasUnavailableItems,checkingAvailability,drawerOpen,openCart,closeCart}),[items,itemCount,subtotal,unavailableItems,hasUnavailableItems,checkingAvailability,drawerOpen])
 return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}
export const useCart=()=>useContext(CartContext)
